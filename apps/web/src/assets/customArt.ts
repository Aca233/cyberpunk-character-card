import type { AssetId } from "./ids.gen";

/** 物品 / 武器 / 义体统一图标 ID：内置官方 2077 图标或本机上传缩略图键 */
export type CustomImageAssetId = `custom-img:${string}`;
export type GearArtId = AssetId | CustomImageAssetId;

const CUSTOM_IMG_PREFIX = "custom-img:";
const customImageUrls = new Map<string, string>();

export function isCustomImageAssetId(id: string | null | undefined): id is CustomImageAssetId {
  return typeof id === "string" && id.startsWith(CUSTOM_IMG_PREFIX);
}

export function toCustomImageAssetId(key: string): CustomImageAssetId {
  return `${CUSTOM_IMG_PREFIX}${key}`;
}

export function setCustomImageDataUrl(key: string, dataUrl: string): CustomImageAssetId {
  customImageUrls.set(key, dataUrl);
  return toCustomImageAssetId(key);
}

export function deleteCustomImageDataUrl(key: string): void {
  customImageUrls.delete(key);
}

export function customImageDataUrlOf(id: string): string | undefined {
  if (!isCustomImageAssetId(id)) return undefined;
  return customImageUrls.get(id.slice(CUSTOM_IMG_PREFIX.length));
}
