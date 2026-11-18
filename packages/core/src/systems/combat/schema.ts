import { z } from "zod";
/** 对手威望与武装成色：决定掉落稀有度与死后寻仇概率，不再对应 T1–T4 骰点难度 */
export const FoeTierSchema = z.enum(["street", "veteran", "elite", "legend"]);
export type FoeTier = z.infer<typeof FoeTierSchema>;

import { BODY_PART_LABELS, type BodyPart, BodyPartSchema } from "../health";
import { ItemDefSchema, WeaponInstanceStateSchema } from "../inventory";

/**
 * 战斗（用户 2026-11-03 定的"重新构建战斗体系"）：打斗过程全交给叙事，代码只记后果。
 * 每一架留下一份案底：死者有名有姓、伤口带着来历、流言会走样、录像在别人手里；战利品照旧
 */

/** 敌人的路数：只用来定身上带什么 */
export const ArchetypeSchema = z.enum(["gunner", "brute", "netrunner", "boss"]);
export type Archetype = z.infer<typeof ArchetypeSchema>;

/** 场上的人后来怎样了 */
export const FoeStateSchema = z.enum(["up", "down", "dead", "fled"]);
export type FoeState = z.infer<typeof FoeStateSchema>;
export const FOE_STATE_LABELS: Readonly<Record<FoeState, string>> = {
  up: "还站着",
  down: "倒下了",
  dead: "死了",
  fled: "跑了",
};

/** 未物化的战利品定制规格：仅在 loot() 实际拾取时随 item gain 写入 InventoryState.objects */
export const LootItemSpecSchema = z.object({
  definition: ItemDefSchema.optional(),
  weaponState: WeaponInstanceStateSchema.optional(),
  origin: z.string().min(1).max(240).optional(),
});
export type LootItemSpec = z.infer<typeof LootItemSpecSchema>;

/** 场上的一个人（有卡的，或一伙杂兵合成一个） */
export const ActiveFoeSchema = z.object({
  /** 有卡的写人物卡 id，杂兵由代码编 foe1、foe2 */
  id: z.string().min(1),
  name: z.string().min(1),
  npc: z.string().min(1).nullable(),
  /** 哪个帮派、公司；死后找上门的人从这里来 */
  gang: z.string().min(1).nullable(),
  archetype: ArchetypeSchema,
  tier: FoeTierSchema.describe(
    "对手成色与威望：street 街头混混，veteran 帮派精锐/公司保安，elite 精锐特勤/重装，legend 传奇大人物；仅影响战利品稀有度与寻仇概率",
  ),
  state: FoeStateSchema,
  /** 身上带着的东西（物品表 id）；倒下或死了能捡，跑了就带走 */
  carry: z.array(z.string().min(1)).default([]),
  /** 待物化定制战利品规格（item id -> 定义/改装状态/来源） */
  carrySpecs: z.record(z.string(), LootItemSpecSchema).default({}),
});
export type ActiveFoe = z.infer<typeof ActiveFoeSchema>;

/** 打完还没捡走的 */
export const LeftLootSchema = z.object({
  from: z.string().min(1),
  name: z.string().min(1),
  npc: z.string().nullable(),
  location: z.string().nullable(),
  leftAt: z.number().int(),
  items: z.array(z.string().min(1)),
  itemSpecs: z.record(z.string(), LootItemSpecSchema).default({}),
});

/** 等死者回家的那个人跟他是什么关系；找上门的就是这个人或他叫来的 */
export const MournerSchema = z.enum(["sibling", "parent", "child", "lover", "boss", "partner"]);
export type Mourner = z.infer<typeof MournerSchema>;
export const MOURNER_LABELS: Readonly<Record<Mourner, string>> = {
  sibling: "兄弟姐妹",
  parent: "爹妈",
  child: "孩子",
  lover: "相好",
  boss: "老大",
  partner: "搭档",
};

/** 死者：有名有姓，有人在等他；过几天按他的分量掷一次，看有没有人找上门 */
export const DeadSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  gang: z.string().min(1).nullable(),
  tier: FoeTierSchema.describe(
    "对手成色与威望：street 街头混混，veteran 帮派精锐/公司保安，elite 精锐特勤/重装，legend 传奇大人物；仅影响战利品稀有度与寻仇概率",
  ),
  /** 等他的人：关系和名字 */
  mourner: MournerSchema,
  mournerName: z.string().min(1),
  killedAt: z.number().int(),
  /** 死在哪个地区 */
  district: z.string().nullable(),
  /** 什么时候掷找不找上门；掷过了是 null */
  reckonAt: z.number().int().nullable(),
  /** 找上门了：pending 等叙事写出来，came 写过了，settled 了结了；没人来是 null */
  avenger: z.enum(["pending", "came", "settled"]).nullable(),
});
export type Dead = z.infer<typeof DeadSchema>;

/** 伤在哪（沿用 health 部位定义） */
export { BODY_PART_LABELS, type BodyPart, BodyPartSchema };

/** 一处伤：谁、用什么、打在哪；恢复需要时间，处理过的不留疤，未处理的 heavy/lethal 留疤，graze 自然愈合不留疤 */
export const WoundSchema = z.object({
  id: z.string().min(1),
  /** 谁打的：名字，和他属于哪伙人 */
  by: z.string().min(1).max(30),
  gang: z.string().min(1).max(30).nullable(),
  /** 用什么打的："一把螳螂刀""霰弹枪" */
  weapon: z.string().min(1).max(30),
  part: BodyPartSchema,
  tier: z.enum(["graze", "heavy", "lethal"]),
  at: z.number().int(),
  district: z.string().nullable(),
  /** 什么时候长好；治了提前 */
  healsAt: z.number().int().nullable(),
  treated: z.boolean(),
});
export type Wound = z.infer<typeof WoundSchema>;

/** 疤：未处理的 heavy/lethal 伤愈合后永久留下；保留伤口来历，认得的人会认出来 */
export const ScarSchema = WoundSchema.pick({
  by: true,
  gang: true,
  weapon: true,
  part: true,
  at: true,
}).extend({
  /** 旧存档未记录地区时保留未知 */
  district: z.string().nullable().default(null),
});
export type Scar = z.infer<typeof ScarSchema>;

/** 流言每传一个地区变一处：人数翻倍、动机传歪、长相传错、手段传邪乎 */
export const DriftSchema = z.enum(["count", "motive", "face", "method"]);
export type Drift = z.infer<typeof DriftSchema>;
export const DRIFT_LABELS: Readonly<Record<Drift, string>> = {
  count: "人数翻了一倍",
  motive: "自卫传成了下黑手",
  face: "长相传歪了",
  method: "手段传得更邪乎",
};

/** 流言到了一个地区时的样子 */
export const RumorHopSchema = z.object({
  district: z.string().min(1),
  at: z.number().int(),
  /** 传到这里时死了几个（越传越多） */
  count: z.number().int().min(0),
  /** 到这一站为止走样了哪几处，按先后 */
  drifts: z.array(DriftSchema),
});
export type RumorHop = z.infer<typeof RumorHopSchema>;

/** 一条流言：从这一架起，一天传一个地区，每传一次走样一处；压下去或收买了就停 */
export const RumorSchema = z.object({
  id: z.string().min(1),
  /** 真实发生的：一句话 */
  truth: z.string().min(1).max(80),
  /** 真死了几个 */
  dead: z.number().int().min(0),
  hops: z.array(RumorHopSchema).min(1),
  /** 下一次往外传的时间；停了是 null */
  nextAt: z.number().int().nullable(),
  /** 被坐实了（录像卖成了超梦）：再传也不会被当成谣言 */
  confirmed: z.boolean(),
  /** 停了：silenced 压下去了，bought 收买了，faded 传到头了 */
  stopped: z.enum(["silenced", "bought", "faded"]).nullable(),
});
export type Rumor = z.infer<typeof RumorSchema>;

/** 录像落在谁手里：决定到期后出什么事 */
export const HolderSchema = z.enum(["ncpd", "dealer", "blackmailer", "bystander"]);
export type Holder = z.infer<typeof HolderSchema>;
export const HOLDER_LABELS: Readonly<Record<Holder, string>> = {
  ncpd: "NCPD",
  dealer: "超梦贩子",
  blackmailer: "想敲你一笔的人",
  bystander: "一个路人",
};

/** 一段录像：谁录的、在谁手里、什么时候出事；追回、销毁或付钱就了结 */
export const FootageSchema = z.object({
  id: z.string().min(1),
  /** 拍下了什么：一句话 */
  shows: z.string().min(1).max(80),
  /** 谁录的："街角的监控""一个路人的义眼" */
  source: z.string().min(1).max(30),
  holder: HolderSchema,
  /** 路人的录像到期前会转手：转给谁 */
  passTo: HolderSchema.nullable(),
  at: z.number().int(),
  district: z.string().nullable(),
  /** 什么时候出事；出过了或了结了是 null */
  dueAt: z.number().int().nullable(),
  /** 出事了：evidence 进了 NCPD 证据库，sold 卖成了超梦，demand 上门要钱 */
  fired: z.enum(["evidence", "sold", "demand"]).nullable(),
  /** 出事的游戏时间：热度系统在自己的 tick 里按这个给进了证据库的录像涨星（tick 不能互相发指令） */
  firedAt: z.number().int().nullable().default(null),
  /** 了结：recovered 追回，destroyed 销毁，paid 付钱了 */
  resolved: z.enum(["recovered", "destroyed", "paid"]).nullable(),
  /** 由哪条流言跟着它：卖成超梦时坐实这条 */
  rumor: z.string().min(1).nullable(),
});
export type Footage = z.infer<typeof FootageSchema>;

/** 正在打的那一架：只记谁在场、在哪；过程由叙事写 */
export const ActiveCombatSchema = z.object({
  startedAt: z.number().int(),
  district: z.string().nullable(),
  location: z.string().nullable().default(null),
  foes: z.array(ActiveFoeSchema),
});
export type ActiveCombat = z.infer<typeof ActiveCombatSchema>;

export const CombatStateSchema = z.object({
  active: ActiveCombatSchema.nullable(),
  /** 上一架：有卡的人后来怎样（给宿敌用）、倒下的人身上剩的东西 */
  last: z
    .object({
      endedAt: z.number().int(),
      foes: z.array(
        z.object({ npc: z.string().min(1), name: z.string().min(1), state: FoeStateSchema }),
      ),
    })
    .nullable(),
  /** 留在各个实际地点的遗留物；不随下一场冲突清空。 */
  groundLoot: z.array(LeftLootSchema).default([]),
  nextFoe: z.number().int().min(1).default(1),
  /** 案底：一直留着，后面的故事从这里长出来 */
  dead: z.array(DeadSchema).default([]),
  wounds: z.array(WoundSchema).default([]),
  scars: z.array(ScarSchema).default([]),
  rumors: z.array(RumorSchema).default([]),
  footage: z.array(FootageSchema).default([]),
  /** 案底条目的递增编号 */
  nextId: z.number().int().min(1).default(1),
});
export type CombatState = z.infer<typeof CombatStateSchema>;

/** start 写进来的人：有卡的写 npc，杂兵一伙写一条 */
export const FoeInputSchema = z.object({
  name: z.string().min(1).max(30),
  npc: z.string().min(1).optional(),
  gang: z.string().min(1).max(30).optional(),
  archetype: ArchetypeSchema,
  tier: FoeTierSchema.describe(
    "对手成色与威望：street 街头混混，veteran 帮派精锐/公司保安，elite 精锐特勤/重装，legend 传奇大人物；仅影响战利品稀有度与寻仇概率",
  ),
});
export type FoeInput = z.infer<typeof FoeInputSchema>;

export const CombatCommandSchema = z
  .object({
    type: z.literal("combat"),
    action: z.enum([
      "start",
      "foe",
      "wound",
      "end",
      "loot",
      "treat",
      "rumor",
      "footage",
      "avenger",
    ]),
    foes: z.array(FoeInputSchema).min(1).max(5).optional(),
    /** foe、loot：场上那人的 id；treat、rumor、footage、avenger：案底条目的 id */
    target: z.string().min(1).optional(),
    state: z.enum(["down", "dead", "fled"]).optional(),
    /** wound：谁打的（场上那人的 id 或名字）、用什么、打在哪、多重 */
    by: z.string().min(1).max(30).optional(),
    weapon: z.string().min(1).max(30).optional(),
    part: BodyPartSchema.optional(),
    tier: z.enum(["graze", "heavy", "lethal"]).optional(),
    /** end：看见的人数、有没有摄像头、真实发生了什么（一句话） */
    witnesses: z.number().int().min(0).max(1000).optional(),
    cameras: z.boolean().optional(),
    truth: z.string().min(1).max(80).optional(),
    /** loot：捡哪件（物品表 id） */
    item: z.string().min(1).optional(),
    /** rumor：silenced 压下去、bought 收买；footage：recovered 追回、destroyed 销毁、paid 付钱；avenger：came 找上门了、settled 了结了 */
    how: z
      .enum(["silenced", "bought", "recovered", "destroyed", "paid", "came", "settled"])
      .optional(),
  })
  .superRefine((c, ctx) => {
    const need = (ok: boolean, message: string) => {
      if (!ok) ctx.addIssue({ code: "custom", message });
    };
    const has = (v: unknown) => v !== undefined;
    if (c.action === "start") need(has(c.foes), "开打要写 foes");
    if (c.action === "foe") need(has(c.target) && has(c.state), "foe 要写 target 和 state");
    if (c.action === "wound")
      need(
        has(c.by) && has(c.weapon) && has(c.part) && has(c.tier),
        "wound 要写 by、weapon、part、tier",
      );
    if (c.action === "end")
      need(has(c.witnesses) && has(c.cameras), "end 要写 witnesses 和 cameras");
    if (c.action === "loot") need(has(c.target) && has(c.item), "loot 要写 target 和 item");
    if (c.action === "treat") need(has(c.target), "treat 要写 target（伤口 id）");
    if (["rumor", "footage", "avenger"].includes(c.action))
      need(has(c.target) && has(c.how), `${c.action} 要写 target 和 how`);
  })
  .describe(
    "战斗只记后果，过程写在正文里：start 开打（foes）；foe 某人 down、dead、fled；wound 玩家挨了一下（by、weapon、part、tier）；end 收场（witnesses、cameras、truth）；loot 从倒下或死了的人身上捡 item；treat 付费处理一处伤，处理后仍需等待恢复；rumor 压下或收买流言；footage 了结录像；avenger 找上门的人来了或了结了",
  );
export type CombatCommand = z.infer<typeof CombatCommandSchema>;

const DAY = 1440;
/** 伤多久长好（分钟）；治了按这个的一半（暂定，试玩时调） */
export const HEAL_MINUTES: Readonly<Record<Wound["tier"], number>> = {
  graze: 1 * DAY,
  heavy: 4 * DAY,
  lethal: 7 * DAY,
};
/** 只有这几档的伤没治就长好会留疤 */
export const SCARRING_TIERS: readonly Wound["tier"][] = ["heavy", "lethal"];
/** 人死后多久掷找不找上门 */
export const RECKON_MINUTES = 3 * DAY;
/** 按死者的分量，有几成机会有人找上门（百分比） */
export const AVENGE_PERCENT: Readonly<Record<FoeTier, number>> = {
  street: 25,
  veteran: 45,
  elite: 70,
  legend: 90,
};
/** 流言多久往外传一个地区；最多传几站就淡了 */
export const RUMOR_HOP_MINUTES = DAY;
export const RUMOR_MAX_HOPS = 4;
/** 录像多久出事；路人手里的先转手再出事 */
export const FOOTAGE_DUE_MINUTES = 2 * DAY;
/** 找上门的、压流言、收买、敲诈要多少钱（暂定） */
export const BUY_RUMOR_EDDIES = 500;
export const BLACKMAIL_EDDIES = 2000;
/** 录像进了 NCPD 证据库涨几星 */
export const EVIDENCE_STARS = 1;

/** 掉落表（暂定）：各路数身上带哪几类武器（物品表的 category），抽一把 */
export const LOOT_WEAPONS: Readonly<Record<Archetype, readonly string[]>> = {
  gunner: ["pistol", "revolver", "smg", "assaultRifle", "shotgun"],
  brute: ["blade", "blunt", "shotgun", "lmg"],
  netrunner: ["pistol", "smg"],
  boss: ["assaultRifle", "precisionRifle", "sniperRifle", "shotgun", "blade"],
};
/** 档位决定能抽到哪几档稀有度；抽不到就找普通的。不朽物品不会掉 */
export const LOOT_RARITY: Readonly<Record<FoeTier, readonly string[]>> = {
  street: ["common"],
  veteran: ["common", "uncommon"],
  elite: ["uncommon", "rare"],
  legend: ["rare", "epic"],
};
/** 除了武器，有一半机会再带一件这几类里的东西 */
export const LOOT_EXTRA_KINDS: readonly string[] = ["healing", "grenade"];
