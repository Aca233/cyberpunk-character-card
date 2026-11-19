import {
  type InstalledWorkshopPack,
  InstalledWorkshopPackSchema,
  type WorkshopPack,
} from "@cp/core";
import type { DocStore } from "./ports";

const FOLDER = "workshop/packs";
const PACK_ID = /^[a-z0-9][a-z0-9-]{0,21}$/;

export class WorkshopStore {
  constructor(private readonly docs: DocStore) {}

  private path(id: string): string {
    if (!PACK_ID.test(id)) throw new Error("内容包 id 不合法");
    return `${FOLDER}/${id}.json`;
  }

  async list(): Promise<InstalledWorkshopPack[]> {
    const names = await this.docs.list(FOLDER);
    const packs: InstalledWorkshopPack[] = [];
    for (const name of names.filter((entry) => entry.endsWith(".json")).sort()) {
      const raw = await this.docs.read(`${FOLDER}/${name}`);
      if (raw === undefined) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new Error(`本地内容包文件损坏：${name}`);
      }
      const result = InstalledWorkshopPackSchema.safeParse(parsed);
      if (!result.success) throw new Error(`本地内容包格式损坏：${name}`);
      packs.push(result.data);
    }
    return packs;
  }

  async install(pack: WorkshopPack, now: Date): Promise<InstalledWorkshopPack> {
    const path = this.path(pack.id);
    if ((await this.docs.read(path)) !== undefined) throw new Error("这个内容包 id 已经安装");
    const installed = InstalledWorkshopPackSchema.parse({
      pack,
      enabled: true,
      installedAt: now.toISOString(),
    });
    await this.docs.write(path, `${JSON.stringify(installed, null, 2)}\n`);
    return installed;
  }

  async setEnabled(id: string, enabled: boolean): Promise<InstalledWorkshopPack | undefined> {
    const path = this.path(id);
    const raw = await this.docs.read(path);
    if (raw === undefined) return undefined;
    const previous = InstalledWorkshopPackSchema.parse(JSON.parse(raw));
    const updated = { ...previous, enabled };
    await this.docs.write(path, `${JSON.stringify(updated, null, 2)}\n`);
    return updated;
  }

  async remove(id: string): Promise<boolean> {
    return this.docs.remove(this.path(id));
  }
}
