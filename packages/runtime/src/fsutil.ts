import { open, rename, rm } from "node:fs/promises";
import { randomHex } from "./random";

/** 先写临时文件并刷盘，再改名替换，写到一半崩溃也不会留下半个文件；mode 是新文件的权限 */
export async function atomicWrite(path: string, data: string, mode = 0o644): Promise<void> {
  const tmp = `${path}.${process.pid}.${Date.now()}.${randomHex(4)}.tmp`;
  const handle = await open(tmp, "w", mode);
  try {
    await handle.writeFile(data, "utf8");
    await handle.sync();
  } catch (error) {
    await handle.close().catch(() => {});
    await rm(tmp, { force: true }).catch(() => {});
    throw error;
  }
  await handle.close();
  try {
    await rename(tmp, path);
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => {});
    throw error;
  }
}

export function hasCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === code;
}

export function isNotFound(error: unknown): boolean {
  return hasCode(error, "ENOENT");
}
