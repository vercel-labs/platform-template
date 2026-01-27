/**
 * JWE Encryption/Decryption
 *
 * Uses JSON Web Encryption to securely store session data in cookies.
 * Requires JWE_SECRET environment variable (base64-encoded 256-bit key).
 *
 * To generate a secret:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
 */

import { EncryptJWT, jwtDecrypt, base64url } from "jose";

/**
 * Encrypt a payload into a JWE token
 */
export async function encryptJWE<T extends object>(
  payload: T,
  expirationTime: string,
  secret: string | undefined = process.env.JWE_SECRET
): Promise<string> {
  if (!secret) {
    throw new Error("Missing JWE_SECRET environment variable");
  }

  return new EncryptJWT(payload as Record<string, unknown>)
    .setExpirationTime(expirationTime)
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .encrypt(base64url.decode(secret));
}

/**
 * Decrypt a JWE token back to its payload
 */
export async function decryptJWE<T extends object>(
  ciphertext: string,
  secret: string | undefined = process.env.JWE_SECRET
): Promise<T | undefined> {
  if (!secret) {
    throw new Error("Missing JWE_SECRET environment variable");
  }

  if (typeof ciphertext !== "string") {
    return undefined;
  }

  try {
    const { payload } = await jwtDecrypt(ciphertext, base64url.decode(secret));
    const decoded = payload as T & { iat?: number; exp?: number };

    // Remove JWT standard claims that were added during encryption
    if (typeof decoded === "object" && decoded !== null) {
      delete decoded.iat;
      delete decoded.exp;
    }

    return decoded as T;
  } catch {
    // Invalid or expired token
    return undefined;
  }
}
