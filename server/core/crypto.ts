import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const KEY_BYTES = 32;
const IV_BYTES = 12;
const AAD = Buffer.from("modeldock:user-state:v1", "utf8");
const FINGERPRINT_CONTEXT = Buffer.from("modeldock:state-fingerprint:v1\0", "utf8");

export interface PasswordDigest {
  algorithm: "scrypt";
  salt: string;
  hash: string;
}

export interface EncryptedDocument {
  version: 1;
  algorithm: "aes-256-gcm";
  iv: string;
  tag: string;
  ciphertext: string;
}

async function derive(password: string, salt: Buffer): Promise<Buffer> {
  return (await scrypt(password, salt, KEY_BYTES)) as Buffer;
}

export async function createPasswordDigest(password: string): Promise<PasswordDigest> {
  const salt = randomBytes(16);
  const hash = await derive(password, salt);
  return {
    algorithm: "scrypt",
    salt: salt.toString("base64"),
    hash: hash.toString("base64"),
  };
}

export async function verifyPassword(
  password: string,
  digest: PasswordDigest,
): Promise<boolean> {
  const expected = Buffer.from(digest.hash, "base64");
  const actual = await derive(password, Buffer.from(digest.salt, "base64"));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function deriveVaultKey(password: string, saltBase64: string): Promise<Buffer> {
  return derive(password, Buffer.from(saltBase64, "base64"));
}

export function createVaultSalt(): string {
  return randomBytes(16).toString("base64");
}

export function encryptJson(key: Buffer, value: unknown): EncryptedDocument {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(AAD);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    version: 1,
    algorithm: "aes-256-gcm",
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

export function fingerprintJson(key: Buffer, value: unknown): string {
  return createHmac("sha256", key)
    .update(FINGERPRINT_CONTEXT)
    .update(JSON.stringify(value), "utf8")
    .digest("base64");
}

export function decryptJson<T>(key: Buffer, document: EncryptedDocument): T {
  if (document.version !== 1 || document.algorithm !== "aes-256-gcm") {
    throw new Error("Unsupported encrypted document format.");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(document.iv, "base64"),
  );
  decipher.setAAD(AAD);
  decipher.setAuthTag(Buffer.from(document.tag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(document.ciphertext, "base64")),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString("utf8")) as T;
}
