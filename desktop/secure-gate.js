/**
 * Secure token storage is only offered to pages served over https (or loopback for development).
 * Over plain HTTP a network attacker could inject script and read the stored refresh token.
 */
function isSecureBaseUrl(raw) {
  try {
    const u = new URL(raw);
    if (u.protocol === "https:") return true;
    return u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  } catch {
    return false;
  }
}

module.exports = { isSecureBaseUrl };
