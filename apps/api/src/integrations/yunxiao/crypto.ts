import crypto from "node:crypto";
import { ApiError } from "../../errors";

const ALGORITHM = "aes-256-gcm";
const VERSION = "v1";

export function parseEncryptionKey(value: string | undefined): Buffer | null {
  if (!value) return null;
  if (/^[0-9a-fA-F]{64}$/.test(value)) return Buffer.from(value, "hex");
  try {
    const decoded = Buffer.from(value, "base64");
    if (decoded.length === 32 && decoded.toString("base64").replace(/=+$/, "") === value.replace(/=+$/, "")) return decoded;
  } catch {
    // Converted to a configuration error below.
  }
  throw new ApiError(503, "YUNXIAO_ENCRYPTION_KEY_INVALID", "YUNXIAO_ENCRYPTION_KEY must be 32-byte base64 or 64 hexadecimal characters");
}

export function requireEncryptionKey(value: string | undefined): Buffer {
  const key = parseEncryptionKey(value);
  if (!key) throw new ApiError(503, "YUNXIAO_ENCRYPTION_KEY_MISSING", "YUNXIAO_ENCRYPTION_KEY is required for credentials and external calls");
  return key;
}

export function encryptSecret(value: string, key: Buffer): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(":");
}

export function decryptSecret(value: string, key: Buffer): string {
  try {
    const [version, ivValue, tagValue, encryptedValue, extra] = value.split(":");
    if (version !== VERSION || !ivValue || !tagValue || !encryptedValue || extra) throw new Error("Invalid encrypted value");
    const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivValue, "base64url"));
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(encryptedValue, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    throw new ApiError(503, "YUNXIAO_CREDENTIAL_DECRYPTION_FAILED", "Stored Yunxiao credentials cannot be decrypted with the configured key");
  }
}

export function safeSecretEqual(expected: string, actual: string): boolean {
  const left = crypto.createHash("sha256").update(expected).digest();
  const right = crypto.createHash("sha256").update(actual).digest();
  return crypto.timingSafeEqual(left, right);
}
