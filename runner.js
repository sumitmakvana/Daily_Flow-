import http from 'http';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

const port = process.env.PORT || 8080;
// Build output directory. Default 'dist' (unchanged); the local read-only build
// uses 'dist-local-safe' so it can never be mistaken for a production build.
const DIST_DIR = process.env.OPERON_DIST_DIR || 'dist';
const CLIENT_DIR = path.join(process.cwd(), DIST_DIR, 'client');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf'
};

// --- Compression + caching -------------------------------------------------
// The app is served straight from this process (no proxy in front of it), so it
// compresses text responses itself. Static files are compressed once per file and
// kept in memory; dynamic responses are compressed as a stream.
const COMPRESSIBLE = new Set(['.html', '.css', '.js', '.json', '.svg']);
const compressedCache = new Map(); // `${enc}:${filePath}:${mtimeMs}` -> Promise<Buffer>

function pickEncoding(req) {
  const ae = String(req.headers['accept-encoding'] || '');
  if (/\bbr\b/.test(ae)) return 'br';
  if (/\bgzip\b/.test(ae)) return 'gzip';
  return null;
}

function compressedFile(enc, filePath, mtimeMs) {
  const key = `${enc}:${filePath}:${mtimeMs}`;
  let p = compressedCache.get(key);
  if (!p) {
    p = fs.promises.readFile(filePath).then(
      (buf) =>
        new Promise((resolve, reject) => {
          const done = (e, out) => (e ? reject(e) : resolve(out));
          if (enc === 'br') {
            zlib.brotliCompress(
              buf,
              { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 6, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length } },
              done,
            );
          } else {
            zlib.gzip(buf, { level: 6 }, done);
          }
        }),
    );
    p.catch(() => compressedCache.delete(key));
    compressedCache.set(key, p);
  }
  return p;
}

// Lazy import server bundle to avoid issues during startup sequence
let serverInstance = null;
async function getServerInstance() {
  if (!serverInstance) {
    const mod = await import(new URL(`./${DIST_DIR}/server/server.js`, import.meta.url).href);
    serverInstance = mod.default ?? mod;
  }
  return serverInstance;
}

const httpServer = http.createServer(async (req, res) => {
  try {
    const host = req.headers.host || 'localhost';
    const protocol = req.headers['x-forwarded-proto'] || 'http';
    const url = new URL(req.url || '/', `${protocol}://${host}`);
    
    // 1. Try to serve static file from dist/client
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === '/') {
      pathname = '';
    }

    if (pathname !== '') {
      const safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
      const filePath = path.join(CLIENT_DIR, safePath);

      // Check if file exists and is indeed a file within the CLIENT_DIR
      if (filePath.startsWith(CLIENT_DIR) && fs.existsSync(filePath)) {
        const stat = fs.statSync(filePath);
        if (stat.isFile()) {
          const ext = path.extname(filePath).toLowerCase();
          const contentType = MIME_TYPES[ext] || 'application/octet-stream';
          const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
          const headers = {
            'Content-Type': contentType,
            ETag: etag,
            'Last-Modified': stat.mtime.toUTCString(),
            // Vite output under /assets/ is content-hashed, so it never changes under the same URL.
            'Cache-Control': pathname.startsWith('/assets/')
              ? 'public, max-age=31536000, immutable'
              : 'no-cache',
          };
          if (COMPRESSIBLE.has(ext)) headers.Vary = 'Accept-Encoding';

          if (req.headers['if-none-match'] === etag) {
            res.writeHead(304, headers);
            res.end();
            return;
          }

          const enc = COMPRESSIBLE.has(ext) && stat.size > 1024 ? pickEncoding(req) : null;
          if (enc) {
            const body = await compressedFile(enc, filePath, stat.mtimeMs);
            res.writeHead(200, { ...headers, 'Content-Encoding': enc, 'Content-Length': body.length });
            res.end(req.method === 'HEAD' ? undefined : body);
            return;
          }
          res.writeHead(200, { ...headers, 'Content-Length': stat.size });
          if (req.method === 'HEAD') res.end();
          else fs.createReadStream(filePath).pipe(res);
          return;
        }
      }
    }

    // 2. Fallback to SSR / Fetch Handler
    const server = await getServerInstance();

    // Build headers
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (value === undefined) continue;
      if (Array.isArray(value)) {
        for (const v of value) {
          headers.append(key, v);
        }
      } else {
        headers.append(key, value);
      }
    }

    // Read body
    let body = null;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const chunks = [];
      for await (const chunk of req) {
        chunks.push(chunk);
      }
      body = Buffer.concat(chunks);
    }

    // Create Web Request
    const webReq = new Request(url.toString(), {
      method: req.method,
      headers,
      body,
      duplex: 'half'
    });

    // Call fetch
    const webRes = await server.fetch(webReq);

    // Write response headers
    res.statusCode = webRes.status;
    webRes.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });

    // Compress text responses as a stream (flushing each chunk, so streamed HTML still
    // arrives progressively). Skipped for tiny known sizes, event streams, and anything
    // already encoded.
    const resType = String(webRes.headers.get('content-type') || '');
    const knownLen = Number(webRes.headers.get('content-length') || NaN);
    const enc = pickEncoding(req);
    const compress =
      !!enc &&
      !!webRes.body &&
      req.method !== 'HEAD' &&
      webRes.status !== 204 &&
      webRes.status !== 304 &&
      !webRes.headers.get('content-encoding') &&
      /^(text\/(html|css|plain)|application\/(json|javascript|x-ndjson))/.test(resType) &&
      !(knownLen < 1024);
    let out = res;
    if (compress) {
      res.removeHeader('content-length');
      res.setHeader('Content-Encoding', enc);
      res.setHeader('Vary', 'Accept-Encoding');
      out =
        enc === 'br'
          ? zlib.createBrotliCompress({ flush: zlib.constants.BROTLI_OPERATION_FLUSH, params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 } })
          : zlib.createGzip({ level: 6, flush: zlib.constants.Z_SYNC_FLUSH });
      out.pipe(res);
    }

    // Write response body
    if (webRes.body) {
      const reader = webRes.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        out.write(value);
      }
    }
    out.end();
  } catch (err) {
    console.error('Runner error:', err);
    res.statusCode = 500;
    res.end('Internal Server Error');
  }
});

// Load the server bundle eagerly (it also starts the cron ticker and the
// Postgres notification listener) and attach Socket.IO to this same HTTP
// server, so /socket.io/ shares the existing port. A failure here must not
// stop the web app from serving, so fall back to the lazy behaviour.
try {
  await getServerInstance();
  if (typeof globalThis.__attachRealtime === 'function') {
    globalThis.__attachRealtime(httpServer);
  } else {
    console.warn('[Realtime] __attachRealtime not found; Socket.IO disabled');
  }
} catch (err) {
  console.error('[Realtime] failed to attach Socket.IO:', err);
}

httpServer.listen(port, '0.0.0.0', () => {
  console.log(`Server running at http://0.0.0.0:${port}`);
});
