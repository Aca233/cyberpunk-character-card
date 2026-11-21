import { AbortedError, UpstreamError } from "./http";

export const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
const MAX_IMAGE_EDGE = 8192;
const MAX_IMAGE_PIXELS = 32 * 1024 * 1024;
const IMAGE_DECODE_TIMEOUT_MS = 60_000;

export interface ValidatedImageAsset {
  readonly dataUrl: string;
  readonly mimeType: "image/png" | "image/jpeg" | "image/webp";
  readonly width: number;
  readonly height: number;
  readonly byteLength: number;
}

function active(signal?: AbortSignal): void {
  if (signal?.aborted) throw new AbortedError();
}

function invalid(detail = "文件内容不是有效的 PNG、JPEG 或静态 WebP"): never {
  throw new UpstreamError(`生成图片校验失败：${detail}`);
}

function dimensions(width: number, height: number): { width: number; height: number } {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    return invalid("图片尺寸无效");
  }
  if (width > MAX_IMAGE_EDGE || height > MAX_IMAGE_EDGE || width * height > MAX_IMAGE_PIXELS) {
    return invalid("图片尺寸过大，单边最多 8192 像素、总像素最多 33554432");
  }
  return { width, height };
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function uint32(bytes: Uint8Array, offset: number, littleEndian = false): number {
  if (offset < 0 || offset + 4 > bytes.length) return invalid("图片数据已截断");
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(
    offset,
    littleEndian,
  );
}

function pngDimensions(bytes: Uint8Array): { width: number; height: number } {
  if (bytes.length < 45 || uint32(bytes, 8) !== 13 || ascii(bytes, 12, 4) !== "IHDR") {
    return invalid("PNG 文件头不完整");
  }
  const result = dimensions(uint32(bytes, 16), uint32(bytes, 20));
  let offset = 8;
  let hasPixels = false;
  let ended = false;
  while (offset + 12 <= bytes.length) {
    const size = uint32(bytes, offset);
    const type = ascii(bytes, offset + 4, 4);
    if (size > bytes.length - offset - 12) return invalid("PNG 数据块已截断");
    if (type === "acTL") return invalid("暂不保存动画 PNG，请生成静态图片");
    if (type === "IDAT" && size > 0) hasPixels = true;
    offset += size + 12;
    if (type === "IEND") {
      if (size !== 0) return invalid("PNG 结束块无效");
      ended = true;
      break;
    }
  }
  if (!hasPixels || !ended || offset !== bytes.length) return invalid("PNG 图片数据不完整");
  return result;
}

function jpegDimensions(bytes: Uint8Array): { width: number; height: number } {
  // 允许合法 JPEG 在 EOI (FF D9) 之后带少量尾随填充字节（如部分编码器写入的 0x00 / 0xFF）
  let end = bytes.length;
  while (end >= 2 && (bytes[end - 1] === 0x00 || bytes[end - 1] === 0xff)) {
    if (bytes[end - 2] === 0xff && bytes[end - 1] === 0xd9) break;
    end -= 1;
  }
  if (end < 4 || bytes[end - 2] !== 0xff || bytes[end - 1] !== 0xd9) {
    return invalid("JPEG 图片数据不完整");
  }
  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) return invalid("JPEG 标记无效");
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === undefined || marker === 0xda || marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) return invalid("JPEG 数据已截断");
    const size = (bytes[offset] ?? 0) * 256 + (bytes[offset + 1] ?? 0);
    if (size < 2 || offset + size > bytes.length) return invalid("JPEG 数据块已截断");
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (size < 8) return invalid("JPEG 尺寸数据不完整");
      return dimensions(
        (bytes[offset + 5] ?? 0) * 256 + (bytes[offset + 6] ?? 0),
        (bytes[offset + 3] ?? 0) * 256 + (bytes[offset + 4] ?? 0),
      );
    }
    offset += size;
  }
  return invalid("JPEG 缺少尺寸信息");
}

function webpDimensions(bytes: Uint8Array): { width: number; height: number } {
  if (bytes.length < 26 || uint32(bytes, 4, true) + 8 !== bytes.length) {
    return invalid("WebP 文件长度无效");
  }
  let result: { width: number; height: number } | undefined;
  let hasPixels = false;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const type = ascii(bytes, offset, 4);
    const size = uint32(bytes, offset + 4, true);
    const start = offset + 8;
    if (size > bytes.length - start) return invalid("WebP 数据块已截断");
    if (type === "ANIM" || type === "ANMF") return invalid("暂不保存动画 WebP，请生成静态图片");
    if (type === "VP8X") {
      if (size !== 10 || ((bytes[start] ?? 0) & 0x02) !== 0)
        return invalid("WebP 扩展头无效或为动画");
      result = dimensions(
        1 +
          ((bytes[start + 4] ?? 0) |
            ((bytes[start + 5] ?? 0) << 8) |
            ((bytes[start + 6] ?? 0) << 16)),
        1 +
          ((bytes[start + 7] ?? 0) |
            ((bytes[start + 8] ?? 0) << 8) |
            ((bytes[start + 9] ?? 0) << 16)),
      );
    } else if (type === "VP8 ") {
      if (size < 10 || ascii(bytes, start + 3, 3) !== "\x9d\x01\x2a")
        return invalid("WebP 像素头无效");
      const frame = dimensions(
        ((bytes[start + 6] ?? 0) | ((bytes[start + 7] ?? 0) << 8)) & 0x3fff,
        ((bytes[start + 8] ?? 0) | ((bytes[start + 9] ?? 0) << 8)) & 0x3fff,
      );
      result ??= frame;
      hasPixels = true;
    } else if (type === "VP8L") {
      if (size < 5 || bytes[start] !== 0x2f) return invalid("WebP 无损像素头无效");
      const packed = uint32(bytes, start + 1, true);
      const frame = dimensions(1 + (packed & 0x3fff), 1 + ((packed >>> 14) & 0x3fff));
      result ??= frame;
      hasPixels = true;
    }
    offset = start + size + (size % 2);
  }
  if (!hasPixels || !result || offset !== bytes.length) return invalid("WebP 图片数据不完整");
  return result;
}

function imageInfo(bytes: Uint8Array): {
  mimeType: ValidatedImageAsset["mimeType"];
  width: number;
  height: number;
} {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    ascii(bytes, 1, 3) === "PNG" &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  )
    return { mimeType: "image/png", ...pngDimensions(bytes) };
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mimeType: "image/jpeg", ...jpegDimensions(bytes) };
  }
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
    return { mimeType: "image/webp", ...webpDimensions(bytes) };
  }
  return invalid();
}

export function imageBytesToBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    parts.push(String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)));
  }
  return btoa(parts.join(""));
}

/** Read downloads with a byte budget; a failed download must never become a stored remote URL. */
export async function readImageResponseBytes(
  response: Response,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  active(signal);
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) {
    void response.body?.cancel().catch(() => {});
    return invalid("图片文件超过 32 MiB");
  }
  if (!response.body) return invalid("图片下载内容为空");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      active(signal);
      const part = await reader.read();
      active(signal);
      if (part.done) break;
      total += part.value.byteLength;
      if (total > MAX_IMAGE_BYTES) {
        await reader.cancel();
        return invalid("图片文件超过 32 MiB");
      }
      chunks.push(part.value);
    }
  } finally {
    signal?.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

/** Native decoders cannot be interrupted; stop awaiting them and release any late result. */
function awaitImageDecode<T>(
  decode: () => Promise<T>,
  signal?: AbortSignal,
  releaseLate?: (value: T) => void,
): Promise<T> {
  active(signal);
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const cancel = () => fail(new AbortedError());
    const timer = setTimeout(
      () => fail(new UpstreamError("生成图片校验失败：图片解码等待超时，请检查浏览器状态")),
      IMAGE_DECODE_TIMEOUT_MS,
    );
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) {
      cancel();
      return;
    }
    let pending: Promise<T>;
    try {
      pending = decode();
    } catch {
      fail(new UpstreamError("生成图片校验失败：图片字节无法解码，可能已经损坏"));
      return;
    }
    void pending.then(
      (value) => {
        if (settled) {
          releaseLate?.(value);
          return;
        }
        settled = true;
        cleanup();
        resolve(value);
      },
      () => {
        fail(
          signal?.aborted
            ? new AbortedError()
            : new UpstreamError("生成图片校验失败：图片字节无法解码，可能已经损坏"),
        );
      },
    );
  });
}

async function decodeImage(
  bytes: Uint8Array,
  mimeType: string,
  signal?: AbortSignal,
): Promise<{ width: number; height: number }> {
  active(signal);
  const blob = new Blob([bytes.slice().buffer], { type: mimeType });
  if (typeof createImageBitmap === "function") {
    const bitmap = await awaitImageDecode(
      () => createImageBitmap(blob),
      signal,
      (lateBitmap) => lateBitmap.close(),
    );
    try {
      active(signal);
      return dimensions(bitmap.width, bitmap.height);
    } finally {
      bitmap.close();
    }
  }
  if (typeof Image === "undefined" || typeof URL.createObjectURL !== "function") {
    return invalid("当前环境缺少图片解码能力，请在支持图片解码的浏览器中生成");
  }
  const img = new Image();
  const url = URL.createObjectURL(blob);
  try {
    img.src = url;
    await awaitImageDecode(() => img.decode(), signal);
    active(signal);
    return dimensions(img.naturalWidth, img.naturalHeight);
  } finally {
    img.removeAttribute("src");
    URL.revokeObjectURL(url);
  }
}

/** Trust decoded bytes, not a declared MIME type, file extension, or requested canvas size. */
export async function validateImageDataUrl(
  dataUrl: string,
  signal?: AbortSignal,
): Promise<ValidatedImageAsset> {
  active(signal);
  const comma = dataUrl.indexOf(",");
  if (comma < 0 || !/^data:[^,]*;base64$/i.test(dataUrl.slice(0, comma)))
    return invalid("图片未完整下载到本地");
  if (dataUrl.length - comma - 1 > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 4096)
    return invalid("图片文件超过 32 MiB");
  const encoded = dataUrl.slice(comma + 1).replace(/\s/g, "");
  if (!encoded || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 === 1)
    return invalid("图片 base64 编码无效");
  let binary: string;
  try {
    binary = atob(encoded);
  } catch {
    return invalid("图片 base64 编码无效");
  }
  if (binary.length > MAX_IMAGE_BYTES) return invalid("图片文件超过 32 MiB");
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const info = imageInfo(bytes);
  const decoded = await decodeImage(bytes, info.mimeType, signal);
  return {
    dataUrl: `data:${info.mimeType};base64,${imageBytesToBase64(bytes)}`,
    mimeType: info.mimeType,
    width: decoded.width,
    height: decoded.height,
    byteLength: bytes.byteLength,
  };
}
