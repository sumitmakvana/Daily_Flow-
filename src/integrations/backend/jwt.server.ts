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

// Cache the remote JWKS set so keys are fetched once and reused across
// requests (and websocket handshakes) instead of being re-fetched per call.
let _jwks: ReturnType<typeof import("jose").createRemoteJWKSet> | undefined;

async function getJwks() {
  if (!_jwks) {
    const { createRemoteJWKSet } = await import("jose");
    const keycloakInternalUrl = process.env.KEYCLOAK_INTERNAL_URL ?? "http://keycloak:8080";
    _jwks = createRemoteJWKSet(
      new URL(`${keycloakInternalUrl}/realms/lovable/protocol/openid-connect/certs`),
    );
  }
  return _jwks;
}

export async function verifyBackendJwt(token: string): Promise<VerifiedClaims> {
  const mode = process.env.BACKEND_MODE ?? "supabase";

  if (mode === "self") {
    // Self-hosted: Verify Keycloak tokens using JWKS endpoint
    const { jwtVerify } = await import("jose");
    const jwks = await getJwks();

    const { payload } = await jwtVerify(token, jwks);
    return {
      ...payload,
      sub: payload.sub,
      email: payload.email as string,
      role: "authenticated", // map all successfully authenticated users to the 'authenticated' role
    } as VerifiedClaims;
  }

  // Default: delegate to Supabase Auth (unchanged behaviour).
  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!);
  const { data, error } = await sb.auth.getClaims(token);
  if (error || !data) throw error ?? new Error("invalid token");
  return data.claims as VerifiedClaims;
}

