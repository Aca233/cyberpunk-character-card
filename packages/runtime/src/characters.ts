import { sampleCharacters } from "@cp/content";
import { type CharacterCard, type StoredCharacter, StoredCharacterSchema } from "@cp/core";
import type { DocStore } from "./ports";
import { randomHex } from "./random";

const CHARACTER_ID = /^c-[a-z0-9-]{1,40}$/;
const SAMPLE_PREFIX = "sample-";
const FOLDER = "characters";

export interface CharacterEntry extends StoredCharacter {
  /** 示例角色：内容包里手写的，不能改也不能删 */
  readonly sample: boolean;
}

function sampleEntries(): CharacterEntry[] {
  return sampleCharacters.map((card, i) => ({
    id: `${SAMPLE_PREFIX}${i + 1}`,
    updatedAt: "",
    card,
    sample: true,
  }));
}

/** characters/<id>.json：玩家自己建的角色卡；存在哪由 DocStore 决定（文件或 IndexedDB） */
export class CharacterStore {
  constructor(private readonly docs: DocStore) {}

  private path(id: string): string {
    if (!CHARACTER_ID.test(id)) throw new Error(`角色 id 不合法：${id}`);
    return `${FOLDER}/${id}.json`;
  }

  async list(): Promise<CharacterEntry[]> {
    const names = await this.docs.list(FOLDER);
    const own: CharacterEntry[] = [];
    for (const name of names.filter((n) => n.endsWith(".json")).sort()) {
      const entry = await this.get(name.slice(0, -5));
      if (entry) own.push(entry);
    }
    own.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return [...own, ...sampleEntries()];
  }

  /** 找不到或文件坏了返回 undefined */
  async get(id: string): Promise<CharacterEntry | undefined> {
    if (id.startsWith(SAMPLE_PREFIX)) return sampleEntries().find((e) => e.id === id);
    if (!CHARACTER_ID.test(id)) return undefined;
    const text = await this.docs.read(this.path(id));
    if (text === undefined) return undefined;
    try {
      const parsed = StoredCharacterSchema.safeParse(JSON.parse(text));
      return parsed.success ? { ...parsed.data, sample: false } : undefined;
    } catch (error) {
      if (error instanceof SyntaxError) return undefined;
      throw error;
    }
  }

  async save(id: string | undefined, card: CharacterCard, now: Date): Promise<CharacterEntry> {
    const stored: StoredCharacter = {
      id: id ?? `c-${now.getTime().toString(36)}-${randomHex(3)}`,
      updatedAt: now.toISOString(),
      card,
    };
    await this.docs.write(this.path(stored.id), `${JSON.stringify(stored, null, 2)}\n`);
    return { ...stored, sample: false };
  }

  async remove(id: string): Promise<boolean> {
    if (!CHARACTER_ID.test(id)) return false;
    return this.docs.remove(this.path(id));
  }
}
