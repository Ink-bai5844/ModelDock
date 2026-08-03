import path from "node:path";
import { AppError } from "../core/errors.js";

const LOCAL_FILE_HEADER = 0x04034b50;
const CENTRAL_DIRECTORY_FILE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const UTF8_FLAG = 0x0800;

export interface ZipArchiveEntry {
  name: string;
  data: Buffer;
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

function safeEntryName(value: string): string {
  const normalized = path.posix.normalize(value.replaceAll("\\", "/"));
  if (
    !normalized ||
    normalized === "." ||
    normalized.startsWith("/") ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    /^[A-Za-z]:/.test(normalized) ||
    normalized.includes("\0")
  ) {
    throw new AppError(400, "INVALID_AGENT_ARCHIVE", "交付文件包含不安全的路径。 ");
  }
  return normalized;
}

function dosTimestamp(now: Date): { date: number; time: number } {
  const year = Math.min(2107, Math.max(1980, now.getFullYear()));
  return {
    date: ((year - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate(),
    time: (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2),
  };
}

export function createZipArchive(entries: ZipArchiveEntry[], now = new Date()): Buffer {
  if (!entries.length || entries.length > 0xffff) {
    throw new AppError(400, "INVALID_AGENT_ARCHIVE", "交付文件数量无效。 ");
  }

  const seen = new Set<string>();
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  const timestamp = dosTimestamp(now);
  let localOffset = 0;

  for (const entry of entries) {
    const name = safeEntryName(entry.name);
    const key = name.toLocaleLowerCase("en-US");
    if (seen.has(key)) {
      throw new AppError(400, "INVALID_AGENT_ARCHIVE", "交付文件中存在重复路径。 ");
    }
    seen.add(key);

    const nameBytes = Buffer.from(name, "utf8");
    const data = Buffer.from(entry.data);
    const crc32 = calculateCrc32(data);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(LOCAL_FILE_HEADER, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(UTF8_FLAG, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(timestamp.time, 10);
    localHeader.writeUInt16LE(timestamp.date, 12);
    localHeader.writeUInt32LE(crc32, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(nameBytes.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, nameBytes, data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(CENTRAL_DIRECTORY_FILE, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(UTF8_FLAG, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(timestamp.time, 12);
    centralHeader.writeUInt16LE(timestamp.date, 14);
    centralHeader.writeUInt32LE(crc32, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(nameBytes.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(localOffset, 42);
    centralParts.push(centralHeader, nameBytes);

    localOffset += localHeader.length + nameBytes.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END_OF_CENTRAL_DIRECTORY, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, end]);
}
