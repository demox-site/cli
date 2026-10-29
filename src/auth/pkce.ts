/**
 * OAuth 2.0 PKCE (S256) helpers for the Demox CLI login flow.
 */

import { createHash, randomBytes } from "crypto";

/** RFC 7636: 43-char base64url SHA-256 challenge. */
const PKCE_CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
/** RFC 7636: 43–128 char verifier alphabet. */
const PKCE_VERIFIER_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/;

export interface PkcePair {
  verifier: string;
  challenge: string;
}

export function createPkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

/**
 * 32 random bytes → 43-char base64url verifier + S256 challenge.
 * Matches auth-api `isValidPkceVerifier` / `isValidPkceChallenge`.
 */
export function createPkcePair(): PkcePair {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createPkceChallenge(verifier);
  if (!PKCE_VERIFIER_PATTERN.test(verifier) || !PKCE_CHALLENGE_PATTERN.test(challenge)) {
    throw new Error("生成的 PKCE 参数格式无效");
  }
  return { verifier, challenge };
}

export function isValidPkceChallenge(value: string): boolean {
  return PKCE_CHALLENGE_PATTERN.test(value);
}

export function isValidPkceVerifier(value: string): boolean {
  return PKCE_VERIFIER_PATTERN.test(value);
}
