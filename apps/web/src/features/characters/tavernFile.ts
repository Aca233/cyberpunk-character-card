import { type CharacterCard, exportTavernCard } from "@cp/core";

/** Character Card 文件的读写：JSON 直接读；PNG 卡的数据在 tEXt 块里（V2 叫 chara，V3 叫 ccv3），是 base64 编码的 JSON */

const MAX_BYTES = 20 * 1024 * 1024;
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

function isPng(bytes: Uint8Array): boolean {
  return PNG_SIGNATURE.every((b, i) => bytes[i] === b);
}

/** 按块走一遍 PNG，取出角色卡那一块的文字 */
function pngCardText(bytes: Uint8Array): string {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const latin1 = new TextDecoder("latin1");
  const found = new Map<string, string>();
  let at = PNG_SIGNATURE.length;
  while (at + 8 <= bytes.length) {
    const length = view.getUint32(at);
    const type = latin1.decode(bytes.subarray(at + 4, at + 8));
    const start = at + 8;
    const end = start + length;
    if (end > bytes.length) break;
    if (type === "tEXt") {
      const data = bytes.subarray(start, end);
      const zero = data.indexOf(0);
      if (zero > 0) {
        const key = latin1.decode(data.subarray(0, zero)).toLowerCase();
        if (key === "chara" || key === "ccv3")
          found.set(key, latin1.decode(data.subarray(zero + 1)));
      }
    }
    if (type === "IEND") break;
    at = end + 4;
  }
  const encoded = found.get("chara") ?? found.get("ccv3");
  if (encoded === undefined) throw new Error("这张 PNG 里没有角色卡数据（找不到 chara 块）");
  let binary: string;
  try {
    binary = atob(encoded.trim());
  } catch {
    throw new Error("PNG 里的角色卡数据不是合法的 base64");
  }
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}

/** 读出文件里的角色卡 JSON；字段对不对交给后端判断 */
export async function readCardFile(file: File): Promise<unknown> {
  if (file.size > MAX_BYTES) throw new Error("文件超过 20 MB，不像是角色卡");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const text = isPng(bytes) ? pngCardText(bytes) : new TextDecoder().decode(bytes);
  try {
    return JSON.parse(text.replace(/^﻿/, ""));
  } catch {
    throw new Error(
      isPng(bytes) ? "PNG 里的角色卡数据不是合法的 JSON" : "文件不是 JSON，也不是带角色卡的 PNG",
    );
  }
}

/** 把角色卡导出成 Character Card V2 的 JSON 文件并下载 */
export function downloadCard(card: CharacterCard): void {
  const blob = new Blob([JSON.stringify(exportTavernCard(card), null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${card.name.replace(/[\\/:*?"<>|]/g, "_") || "角色"}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
