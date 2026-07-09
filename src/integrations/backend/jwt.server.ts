/**
 * Backend abstraction — server-side JWT verify.
 *
 * Today, the auth middleware uses `supabase.auth.getClaims(token)`.
 * After cutover, `BACKEND_MODE=self` flips to using Keycloak JWKS endpoint
 * to verify tokens issued by Keycloak.
 *
 * Filename uses the `.server.ts` extension so the bundler refuses any
 * client-side import.
 */
import type { JWTPayload } from "jose";

type VerifiedClaims = JWTPayload & { sub?: string; email?: string; role?: string };

// Cache JWKS client to avoid recreating it on every request
let _jwks: any;

function getJwksClient(jwksUrl: string) {
  if (!_jwks) {
    const { createRemoteJWKSet } = require("jose");
    _jwks = createRemoteJWKSet(new URL(jwksUrl));
  }
  return _jwks;
}

export async function verifyBackendJwt(token: string): Promise<VerifiedClaims> {
  const mode = process.env.BACKEND_MODE ?? "supabase";

  if (mode === "self") {
    // Debug token details before verification
    try {
      const parts = token.split('.');
      if (parts.length === 3) {
        const header = JSON.parse(Buffer.from(parts[0], 'base64').toString('utf8'));
        console.log('[DEBUG JWT] Header:', JSON.stringify(header));
        const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
        console.log('[DEBUG JWT] Payload (iss, sub, email):', JSON.stringify({ iss: payload.iss, sub: payload.sub, email: payload.email }));
      } else {
        console.log('[DEBUG JWT] Token is not a valid 3-part JWT:', token);
      }
    } catch (e: any) {
      console.error('[DEBUG JWT] Failed to parse token header/payload:', e.message);
    }

    // Self-hosted: Verify Keycloak tokens using JWKS endpoint
    const { jwtVerify } = await import("jose");
    const keycloakInternalUrl = process.env.KEYCLOAK_INTERNAL_URL ?? "http://keycloak:8080";
    const jwksUrl = `${keycloakInternalUrl}/realms/lovable/protocol/openid-connect/certs`;
    
    // We use a helper function to require createRemoteJWKSet lazily
    const { createRemoteJWKSet } = await import("jose");
    const jwks = createRemoteJWKSet(new URL(jwksUrl));

    try {
      const { payload } = await jwtVerify(token, jwks);
      return {
        ...payload,
        sub: payload.sub,
        email: payload.email as string,
        role: "authenticated", // map all successfully authenticated users to the 'authenticated' role
      } as VerifiedClaims;
    } catch (err: any) {
      console.error('[DEBUG JWT] jwtVerify failed. error name:', err.name, 'code:', err.code, 'message:', err.message);
      throw err;
    }
  }

  // Default: delegate to Supabase Auth (unchanged behaviour).
  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!);
  const { data, error } = await sb.auth.getClaims(token);
  if (error || !data) throw error ?? new Error("invalid token");
  return data.claims as VerifiedClaims;
}

