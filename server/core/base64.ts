export function decodeBase64(
  value: string,
  field: string,
  expectedBytes?: number,
): Buffer {
  if (!hasCanonicalBase64Shape(value)) {
    throw new Error(`Invalid base64 in ${field}.`);
  }
  const decoded = Buffer.from(value, "base64");
  if (expectedBytes !== undefined && decoded.byteLength !== expectedBytes) {
    throw new Error(
      `Invalid ${field} length: expected ${expectedBytes}, received ${decoded.byteLength}.`,
    );
  }
  return decoded;
}

function hasCanonicalBase64Shape(value: string): boolean {
  if (value.length % 4 !== 0) return false;
  let contentLength = value.length;
  if (value.endsWith("==")) {
    contentLength -= 2;
  } else if (value.endsWith("=")) {
    contentLength -= 1;
  }
  for (let index = 0; index < contentLength; index += 1) {
    const code = value.charCodeAt(index);
    const valid =
      (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122) ||
      (code >= 48 && code <= 57) ||
      code === 43 ||
      code === 47;
    if (!valid) return false;
  }
  for (let index = contentLength; index < value.length; index += 1) {
    if (value.charCodeAt(index) !== 61) return false;
  }
  return true;
}
