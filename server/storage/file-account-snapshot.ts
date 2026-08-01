import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { decodeBase64 } from "../core/base64.js";
import type { EncryptedDocument } from "../core/crypto.js";
import type { AccountRecord } from "./account-storage.js";
import type { AccountImportRecord } from "./mysql-account-storage.js";

interface AccountIndex {
  version: 1;
  accounts: AccountRecord[];
}

export interface FileAccountSnapshot {
  records: AccountImportRecord[];
  sourceManifest: string;
  sourceBytes: number;
}

export async function loadFileAccountSnapshot(
  dataDirectory: string,
): Promise<FileAccountSnapshot> {
  const accountsPath = path.join(dataDirectory, "accounts.json");
  const accountsBuffer = await readFile(accountsPath);
  const index = JSON.parse(accountsBuffer.toString("utf8")) as AccountIndex;
  if (index.version !== 1 || !Array.isArray(index.accounts)) {
    throw new Error("Unsupported accounts.json format.");
  }

  const ids = new Set<string>();
  const usernames = new Set<string>();
  const records: AccountImportRecord[] = [];
  const manifest = createHash("sha256");
  manifest.update("accounts.json\0");
  manifest.update(accountsBuffer);
  let sourceBytes = accountsBuffer.byteLength;

  for (const account of [...index.accounts].sort((left, right) =>
    left.id.localeCompare(right.id),
  )) {
    validateAccount(account);
    if (ids.has(account.id)) throw new Error(`Duplicate account id: ${account.id}`);
    if (usernames.has(account.normalizedUsername)) {
      throw new Error(`Duplicate normalized username: ${account.normalizedUsername}`);
    }
    ids.add(account.id);
    usernames.add(account.normalizedUsername);

    const relativeStatePath = path.join("users", account.id, "state.enc.json");
    const stateBuffer = await readFile(path.join(dataDirectory, relativeStatePath));
    const state = JSON.parse(stateBuffer.toString("utf8")) as EncryptedDocument;
    validateState(state, account.id);
    manifest.update("\0");
    manifest.update(relativeStatePath.replaceAll("\\", "/"));
    manifest.update("\0");
    manifest.update(stateBuffer);
    sourceBytes += stateBuffer.byteLength;
    records.push({ account, state });
  }

  const usersDirectory = path.join(dataDirectory, "users");
  const userEntries = await readdir(usersDirectory, { withFileTypes: true });
  const orphanDirectories = userEntries
    .filter((entry) => entry.isDirectory() && !ids.has(entry.name))
    .map((entry) => entry.name);
  if (orphanDirectories.length) {
    throw new Error(`Orphan user state directories: ${orphanDirectories.join(", ")}`);
  }

  return {
    records,
    sourceManifest: manifest.digest("hex"),
    sourceBytes,
  };
}

function validateAccount(account: AccountRecord): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(account.id)) {
    throw new Error(`Invalid account id: ${account.id}`);
  }
  if (
    typeof account.username !== "string" ||
    typeof account.normalizedUsername !== "string" ||
    account.password?.algorithm !== "scrypt" ||
    !isBase64Bytes(account.password.salt, 16) ||
    !isBase64Bytes(account.password.hash, 32) ||
    !isBase64Bytes(account.vaultSalt, 16) ||
    !Number.isFinite(new Date(account.createdAt).getTime()) ||
    !Number.isFinite(new Date(account.updatedAt).getTime())
  ) {
    throw new Error(`Invalid account record: ${account.id}`);
  }
}

function validateState(state: EncryptedDocument, accountId: string): void {
  if (
    state.version !== 1 ||
    state.algorithm !== "aes-256-gcm" ||
    !isBase64Bytes(state.iv, 12) ||
    !isBase64Bytes(state.tag, 16) ||
    !isBase64Bytes(state.ciphertext)
  ) {
    throw new Error(`Invalid encrypted state document: ${accountId}`);
  }
}

function isBase64Bytes(value: unknown, expectedBytes?: number): value is string {
  if (typeof value !== "string") return false;
  try {
    decodeBase64(value, "snapshot field", expectedBytes);
    return true;
  } catch {
    return false;
  }
}
