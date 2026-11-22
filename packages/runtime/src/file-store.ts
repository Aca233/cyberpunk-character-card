import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { atomicWrite, isNotFound } from "./fsutil";
import type { DocStore } from "./ports";

/** 带密钥的文件（config.json）只让当前用户能读写 */
const SECRET_MODE = 0o600;

/** 路径只能是 root 下面的相对路径：不能是绝对路径，不能有 .. 或空的段 */
function safe(path: string): string[] {
  const parts = path.split("/");
  if (parts.some((p) => p === "" || p === "." || p === ".." || p.includes("\\"))) {
    throw new Error(`存储路径不合法：${path}`);
  }
  return parts;
}

/** 文件版 DocStore：路径对应 root 下的文件，写入先写临时文件再改名 */
export class FileDocStore implements DocStore {
  constructor(private readonly root: string) {}

  private file(path: string): string {
    return join(this.root, ...safe(path));
  }

  async list(folder: string): Promise<string[]> {
    try {
      const entries = await readdir(this.file(folder), { withFileTypes: true });
      return entries.filter((e) => e.isFile()).map((e) => e.name);
    } catch (error) {
      if (isNotFound(error)) return [];
      throw error;
    }
  }

  async read(path: string): Promise<string | undefined> {
    try {
      return await readFile(this.file(path), "utf8");
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw error;
    }
  }

  async write(path: string, text: string, options?: { readonly secret?: boolean }): Promise<void> {
    const file = this.file(path);
    await mkdir(dirname(file), { recursive: true });
    await atomicWrite(file, text, options?.secret ? SECRET_MODE : undefined);
  }

  async remove(path: string): Promise<boolean> {
    try {
      await rm(this.file(path));
      return true;
    } catch (error) {
      if (isNotFound(error)) return false;
      throw error;
    }
  }
}
