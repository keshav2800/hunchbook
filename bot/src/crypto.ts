/**
 * AES-256-GCM envelope for ed25519 secret keys.
 *
 * Threat model: protects user secret keys at rest. If the SQLite file leaks
 * but the env-supplied master key does not, the ciphertext is useless.
 * Each row stores its own random 12-byte IV — never reuse IVs under a key.
 *
 * Master key format: HUNCHBOOK_BOT_MASTER_KEY env var, base64 of 32 raw bytes.
 * Generate with: openssl rand -base64 32
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 12; // NIST-recommended for GCM
const KEY_LEN = 32;

function loadMasterKey(): Buffer {
  const b64 = process.env.HUNCHBOOK_BOT_MASTER_KEY;
  if (!b64) {
    throw new Error(
      "HUNCHBOOK_BOT_MASTER_KEY env var not set. Generate with: openssl rand -base64 32",
    );
  }
  const key = Buffer.from(b64, "base64");
  if (key.length !== KEY_LEN) {
    throw new Error(
      `HUNCHBOOK_BOT_MASTER_KEY must decode to ${KEY_LEN} bytes, got ${key.length}`,
    );
  }
  return key;
}

export interface SealedSecret {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
}

export function seal(plaintext: Uint8Array): SealedSecret {
  const key = loadMasterKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return { ciphertext, iv, authTag };
}

export function unseal(sealed: SealedSecret): Buffer {
  const key = loadMasterKey();
  const decipher = createDecipheriv(ALGO, key, sealed.iv);
  decipher.setAuthTag(sealed.authTag);
  return Buffer.concat([decipher.update(sealed.ciphertext), decipher.final()]);
}
