import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);

export async function verifyPasswordHash(password, encoded) {
  if (typeof password !== "string" || typeof encoded !== "string") return false;
  const [saltText, hashText] = encoded.split("$");
  if (!saltText || !hashText) return false;
  try {
    const salt = Buffer.from(saltText, "base64url");
    const expected = Buffer.from(hashText, "base64url");
    const actual = await scrypt(password, salt, expected.length || 64);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `${salt.toString("base64url")}$${hash.toString("base64url")}`;
}
