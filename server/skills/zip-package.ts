import { inflateRawSync } from "node:zlib";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { AppError } from "../core/errors.js";

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_DIRECTORY_FILE = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;
const MAX_ARCHIVE_ENTRIES = 3_000;
const MAX_FILE_BYTES = 128 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 256 * 1024 * 1024;

interface ZipEntry {
  name: string;
  directory: boolean;
  compression: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

function invalidArchive(message: string): AppError {
  return new AppError(400, "INVALID_SKILL_ARCHIVE", message);
}

function findEndOfCentralDirectory(archive: Buffer): number {
  const minimum = Math.max(0, archive.length - 65_557);
  for (let offset = archive.length - 22; offset >= minimum; offset -= 1) {
    if (archive.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY) return offset;
  }
  throw invalidArchive("ZIP 文件缺少中央目录。 ");
}

function safeEntryName(rawName: string): string {
  const normalized = path.posix.normalize(rawName.replaceAll("\\", "/"));
  if (
    !normalized ||
    normalized === "." ||
    normalized.startsWith("/") ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    /^[A-Za-z]:/.test(normalized) ||
    normalized.includes("\0")
  ) {
    throw invalidArchive("ZIP 中包含不安全的文件路径。 ");
  }
  return normalized;
}

function parseEntries(archive: Buffer): ZipEntry[] {
  if (archive.length < 22) throw invalidArchive("ZIP 文件不完整。 ");
  const eocd = findEndOfCentralDirectory(archive);
  if (archive.readUInt16LE(eocd + 4) !== 0 || archive.readUInt16LE(eocd + 6) !== 0) {
    throw invalidArchive("不支持分卷 ZIP 文件。 ");
  }
  const entriesOnDisk = archive.readUInt16LE(eocd + 8);
  const entryCount = archive.readUInt16LE(eocd + 10);
  const centralSize = archive.readUInt32LE(eocd + 12);
  const centralOffset = archive.readUInt32LE(eocd + 16);
  if (
    entryCount === 0xffff ||
    centralSize === 0xffffffff ||
    centralOffset === 0xffffffff
  ) {
    throw invalidArchive("暂不支持 ZIP64 成品包。 ");
  }
  if (entriesOnDisk !== entryCount || entryCount < 1 || entryCount > MAX_ARCHIVE_ENTRIES) {
    throw invalidArchive("ZIP 文件数量无效或超过上限。 ");
  }
  if (centralOffset + centralSize > eocd) {
    throw invalidArchive("ZIP 中央目录范围无效。 ");
  }

  const entries: ZipEntry[] = [];
  const seen = new Set<string>();
  let expandedBytes = 0;
  let offset = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > archive.length || archive.readUInt32LE(offset) !== CENTRAL_DIRECTORY_FILE) {
      throw invalidArchive("ZIP 中央目录条目损坏。 ");
    }
    const flags = archive.readUInt16LE(offset + 8);
    const compression = archive.readUInt16LE(offset + 10);
    const crc32 = archive.readUInt32LE(offset + 16);
    const compressedSize = archive.readUInt32LE(offset + 20);
    const uncompressedSize = archive.readUInt32LE(offset + 24);
    const nameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const diskStart = archive.readUInt16LE(offset + 34);
    const externalAttributes = archive.readUInt32LE(offset + 38);
    const localHeaderOffset = archive.readUInt32LE(offset + 42);
    const nextOffset = offset + 46 + nameLength + extraLength + commentLength;
    if (nextOffset > archive.length || diskStart !== 0) {
      throw invalidArchive("ZIP 条目范围无效。 ");
    }
    if (flags & 0x1) throw invalidArchive("不支持加密 ZIP。 ");
    if (![0, 8].includes(compression)) {
      throw invalidArchive("ZIP 中包含不支持的压缩算法。 ");
    }
    const unixMode = externalAttributes >>> 16;
    if ((unixMode & 0o170000) === 0o120000) {
      throw invalidArchive("ZIP 中不能包含符号链接。 ");
    }
    const rawName = archive.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    const name = safeEntryName(rawName);
    const directory = rawName.endsWith("/") || (unixMode & 0o170000) === 0o040000;
    const key = name.toLocaleLowerCase("en-US");
    if (seen.has(key)) throw invalidArchive("ZIP 中包含重复文件路径。 ");
    seen.add(key);
    if (!directory) {
      if (uncompressedSize > MAX_FILE_BYTES) {
        throw invalidArchive("ZIP 中的单个文件超过 128 MB。 ");
      }
      expandedBytes += uncompressedSize;
      if (expandedBytes > MAX_EXPANDED_BYTES) {
        throw invalidArchive("ZIP 解压后的总大小超过 256 MB。 ");
      }
    }
    entries.push({
      name,
      directory,
      compression,
      crc32,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    });
    offset = nextOffset;
  }
  return entries;
}

let crcTable: Uint32Array | undefined;

function calculateCrc32(value: Buffer): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let current = index;
      for (let bit = 0; bit < 8; bit += 1) {
        current = (current & 1) ? (0xedb88320 ^ (current >>> 1)) : (current >>> 1);
      }
      crcTable[index] = current >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of value) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function readEntry(archive: Buffer, entry: ZipEntry): Buffer {
  const offset = entry.localHeaderOffset;
  if (offset + 30 > archive.length || archive.readUInt32LE(offset) !== LOCAL_FILE_HEADER) {
    throw invalidArchive("ZIP 本地文件头损坏。 ");
  }
  const nameLength = archive.readUInt16LE(offset + 26);
  const extraLength = archive.readUInt16LE(offset + 28);
  const start = offset + 30 + nameLength + extraLength;
  const end = start + entry.compressedSize;
  if (end > archive.length) throw invalidArchive("ZIP 压缩数据范围无效。 ");
  const compressed = archive.subarray(start, end);
  let output: Buffer;
  try {
    output = entry.compression === 0 ? Buffer.from(compressed) : inflateRawSync(compressed);
  } catch {
    throw invalidArchive("ZIP 文件解压失败。 ");
  }
  if (output.length !== entry.uncompressedSize || calculateCrc32(output) !== entry.crc32) {
    throw invalidArchive("ZIP 文件完整性校验失败。 ");
  }
  return output;
}

export async function extractSkillArchive(archive: Buffer, targetDirectory: string): Promise<void> {
  const entries = parseEntries(archive);
  for (const entry of entries) {
    const destination = path.resolve(targetDirectory, ...entry.name.split("/"));
    const relative = path.relative(targetDirectory, destination);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw invalidArchive("ZIP 中包含越界文件路径。 ");
    }
    if (entry.directory) {
      await mkdir(destination, { recursive: true });
      continue;
    }
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, readEntry(archive, entry), { flag: "wx" });
  }
}
