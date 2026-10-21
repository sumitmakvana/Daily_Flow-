/**
 * Secure token storage is only offered to pages served over https (or loopback for development).
 * Over plain HTTP a network attacker could inject script and read the stored refresh token.
 */
const LOOPBACK = ["localhost", "127.0.0.1", "[::1]"];

function isSecureBaseUrl(raw) {
  try {
    const u = new URL(raw);
    if (u.protocol === "https:") return true;
    return u.protocol === "http:" && LOOPBACK.includes(u.hostname);
  } catch {
    return false;
  }
}

/**
 * Whether a page at `senderUrl` (the real, post-redirect URL of the calling frame) may use the
 * token store, given the configured Operon `baseUrl`.
 *
 * - The sender itself must be secure (https, or loopback http for development).
 * - It must be the Operon host: same origin as `baseUrl`, or, when `baseUrl` is plain http on a
 *   non-loopback host, the https upgrade of that same host on the default port (the production
 *   server redirects http -> https, so the page's origin differs from the configured one).
 * - A plain-http sender on a non-loopback host is always rejected.
 */
function isTrustedSenderUrl(senderUrl, baseUrl) {
  try {
    if (!isSecureBaseUrl(senderUrl)) return false;
    const sender = new URL(senderUrl);
    const base = new URL(baseUrl);
    if (sender.origin === base.origin) return true;
    return (
      base.protocol === "http:" &&
      !LOOPBACK.includes(base.hostname) &&
      sender.protocol === "https:" &&
      sender.hostname === base.hostname &&
      sender.port === ""
    );
  } catch {
    return false;
  }
}

module.exports = { isSecureBaseUrl, isTrustedSenderUrl };
