import http from 'http';
import fs from 'fs';
import path from 'path';

const port = process.env.PORT || 8080;
const CLIENT_DIR = path.join(process.cwd(), 'dist/client');

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

// Lazy import server bundle to avoid issues during startup sequence
let serverInstance = null;
async function getServerInstance() {
  if (!serverInstance) {
    const mod = await import('./dist/server/server.js');
    serverInstance = mod.default ?? mod;
  }
  return serverInstance;
}

http.createServer(async (req, res) => {
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
          res.writeHead(200, {
            'Content-Type': contentType,
            'Content-Length': stat.size
          });
          fs.createReadStream(filePath).pipe(res);
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

    // Write response body
    if (webRes.body) {
      const reader = webRes.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
    }
    res.end();
  } catch (err) {
    console.error('Runner error:', err);
    res.statusCode = 500;
    res.end('Internal Server Error');
  }
}).listen(port, '0.0.0.0', () => {
  console.log(`Server running at http://0.0.0.0:${port}`);
});
