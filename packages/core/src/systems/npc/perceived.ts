import { z } from "zod";
import type { ViewContext } from "../../kernel/system";
import { CharacterStateSchema, type KnownDeed, reputationOverview } from "../character";
import { CyberwareStateSchema, cyberwareCatalog, SLOT_LABELS } from "../cyberware";
import { HealthStateSchema, LIMB_LABELS, woundTag } from "../health";
import { ClothingSlotSchema, InventoryStateSchema, type ItemDef, itemCatalog } from "../inventory";

const CLOTHING_SLOTS = ClothingSlotSchema.options;

/**
 * 只读热度的星数：heat 运行时引用 npc，这里不反过来引用 heat 入口。
 * 和热度系统一样只算整星，攒着的半星路人看不出来
 */
const HeatStarsSchema = z.object({ stars: z.number().default(0) });

/** 出身带出来的口音和做派；查不到的出身只写出身 */
const ORIGIN_ACCENTS: Readonly<Record<string, string>> = {
  街头小子: "一口夜之城街头腔，黑话张嘴就来",
  流浪者: "带着荒地口音，说话直来直去",
  公司员工: "一口公司腔，用词客气、句句留余地",
};

/** 别人一眼看得见的义体部位 */
const VISIBLE_CHROME: ReadonlySet<string> = new Set([
  "eyes",
  "integumentary",
  "hands",
  "arms",
  "legs",
]);
/** 装到这么多件，路人会觉得浑身是铬 */
const CHROME_HEAVY = 6;
/** 热度到这么多星，街上算是有悬赏、被通缉 */
const WANTED_STARS = 3;

const WOUND_LOOKS: Readonly<Record<string, string>> = {
  light: "身上带着伤",
  severe: "伤得很重，走路都不稳",
  zero: "浑身是血，随时会倒下",
};

export interface Looks {
  readonly traits: readonly { readonly slot: string; readonly label: string }[];
  readonly deeds: readonly KnownDeed[];
  readonly clothing: Readonly<Partial<Record<string, string>>>;
  readonly installed: readonly { readonly id: string; readonly slot: string }[];
  readonly lostLimbs: readonly string[];
  readonly wound: string;
  readonly heatStars: number;
}

/** 别人眼里的你：每轮从出身、口音、穿着、看得见的义体、伤势、外界传开的事迹和热度拼一行 */
export function perceivedLine(
  looks: Looks,
  parts: ReadonlyMap<string, { readonly name: string }>,
  items: ReadonlyMap<
    string,
    {
      readonly name: string;
      readonly stealthTags?: readonly string[] | undefined;
      readonly factionDisguise?: string | undefined;
    }
  >,
): string {
  const bits: string[] = [];
  const origin = looks.traits.find((t) => t.slot === "origin")?.label;
  if (origin) {
    const accent = ORIGIN_ACCENTS[origin];
    bits.push(accent ? `${origin}出身，${accent}` : `${origin}出身`);
  }
  const wornDefs = CLOTHING_SLOTS.flatMap((slot) => {
    const id = looks.clothing[slot];
    return id === undefined ? [] : [{ id, def: items.get(id) }];
  });
  const worn = wornDefs.map((w) => w.def?.name ?? w.id);
  const faceConcealed = wornDefs.some((w) => w.def?.stealthTags?.includes("face-conceal"));
  const disguises = [
    ...new Set(wornDefs.flatMap((w) => (w.def?.factionDisguise ? [w.def.factionDisguise] : []))),
  ];
  bits.push(worn.length > 0 ? `穿着${worn.join("、")}` : "衣着不起眼");
  if (faceConcealed) bits.push("面部有遮蔽（路人与常规监控不易直接认脸）");
  if (disguises.length > 0) bits.push(`外观看似${disguises.join("/")}人员`);
  const slotLabels = SLOT_LABELS as Readonly<Record<string, string>>;
  const shown = looks.installed
    .filter((c) => VISIBLE_CHROME.has(c.slot))
    .map((c) => `${parts.get(c.id)?.name ?? c.id}（${slotLabels[c.slot] ?? c.slot}）`);
  if (looks.installed.length >= CHROME_HEAVY) {
    bits.push(`浑身是铬${shown.length > 0 ? `，看得见${shown.join("、")}` : ""}`);
  } else if (shown.length > 0) {
    bits.push(`看得见${shown.join("、")}`);
  } else {
    bits.push(looks.installed.length > 0 ? "装的义体都藏在身体里，一眼看不出来" : "看不出装了义体");
  }
  if (looks.lostLimbs.length > 0) {
    const limbLabels = LIMB_LABELS as Readonly<Record<string, string>>;
    bits.push(`少了${looks.lostLimbs.map((l) => limbLabels[l] ?? l).join("、")}`);
  }
  const wound = WOUND_LOOKS[looks.wound];
  if (wound) bits.push(wound);
  if (looks.deeds.length === 0) {
    bits.push("外界印象：籍籍无名，街上还没传开你的事");
  } else {
    const rep = reputationOverview(looks.deeds);
    const recent = looks.deeds
      .slice(-2)
      .map((d) => `「${d.summary}」`)
      .join("、");
    bits.push(`外界风声（${rep.label}）：有人听过${recent}`);
  }
  if (looks.heatStars >= WANTED_STARS) {
    bits.push(`NCPD 通缉中（${looks.heatStars} 星），赏金猎人和眼尖的人认得出`);
  } else if (looks.heatStars > 0) {
    bits.push(`NCPD 在留意（${looks.heatStars} 星）`);
  }
  return bits.join("；");
}

/** 别人眼里的你：交给叙事模型，NPC 的第一反应照这一行写 */
export function perceivedView({ world, data }: ViewContext): string {
  const character = CharacterStateSchema.parse(world.slices.character);
  const inventory = InventoryStateSchema.parse(world.slices.inventory);
  const health = HealthStateSchema.parse(world.slices.health);
  const { installed } = CyberwareStateSchema.parse(world.slices.cyberware ?? {});
  // 旧快照里没有热度系统
  const heat = HeatStarsSchema.parse(world.slices.heat ?? {});
  const items = data.items === undefined ? new Map<string, ItemDef>() : itemCatalog(data);
  return perceivedLine(
    {
      traits: character.traits,
      deeds: character.deeds,
      clothing: inventory.clothing,
      installed,
      lostLimbs: health.lostLimbs,
      wound: woundTag(health),
      heatStars: Math.floor(heat.stars),
    },
    cyberwareCatalog(data),
    items,
  );
}
