/**
 * 界面操作基准：S2 把 actions 拆进各系统前后，同一批操作的结算结果要逐字相同。
 * 用示例世界在内存里把 21 种操作各跑若干遍（成立的、不成立的、schema 不过的都有），不读写存档。
 * 记下每一次的拒绝理由，或者结算出的指令、备注，以及结算后世界和补丁的摘要。
 * 用法：tsx action-baseline.ts 存基准到 /tmp/action-baseline；加 --check 和基准逐条比对。
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  apartments,
  braindances,
  cyberware,
  DEFAULT_LOADOUT,
  DEFAULT_OPENING,
  gameContent,
  gameData,
  items,
  ripperdocs,
  shops,
} from "@cp/content";
import {
  applyPlayerAction,
  chronicleRules,
  memoryRules,
  newGameWorld,
  PlayerActionSchema,
  withAllSlices,
} from "@cp/core";

const DIR = "/tmp/action-baseline";
const OUT = `${DIR}/cases.json`;
const check = process.argv.includes("--check");

type World = ReturnType<typeof newGameWorld>;
type Slice = Record<string, unknown>;

const base: World = withAllSlices(
  newGameWorld(
    {
      startTime: Date.UTC(2077, 9, 1, 22) / 60000,
      opening: DEFAULT_OPENING,
      loadouts: [DEFAULT_LOADOUT],
    },
    gameContent,
  ),
);

function slice(world: World, name: string): Slice {
  return ((world.slices as Readonly<Record<string, unknown>>)[name] ?? {}) as Slice;
}
function set(world: World, name: string, value: Slice): World {
  return { ...world, slices: { ...world.slices, [name]: { ...slice(world, name), ...value } } };
}
const at = (world: World, location: string): World => set(world, "world", { location });
const rich = (world: World): World => set(world, "economy", { eddies: 999_999 });
const poor = (world: World): World => set(world, "economy", { eddies: 0 });
const fight = (world: World): World => set(world, "combat", { active: { current: 0 } });

const inventory = slice(base, "inventory");
const backpack = Object.keys((inventory.backpack ?? {}) as Record<string, number>);
const weapons = ((inventory.weapons ?? []) as (string | null)[]).filter(
  (w): w is string => w !== null,
);
const installed = ((slice(base, "cyberware").installed ?? []) as { id: string }[]).map((c) => c.id);
const rawJobs = slice(base, "jobs").jobs ?? [];
const jobIds = (Array.isArray(rawJobs) ? rawJobs : Object.values(rawJobs as object)).map(
  (j) => (j as { id: string }).id,
);
const npcIds = Object.keys((slice(base, "npc").npcs ?? {}) as Record<string, unknown>);
const modIds = items.filter((i) => i.modFits !== undefined).map((i) => i.id);

interface Case {
  readonly name: string;
  readonly world: World;
  readonly action: unknown;
}
const cases: Case[] = [];
function add(name: string, world: World, action: unknown): void {
  cases.push({ name: `${cases.length}:${name}`, world, action });
}

// acceptJob
for (const id of [...jobIds, "no-such-job"]) add("acceptJob", base, { type: "acceptJob", id });

// 义体医生
add("buyCyberware 没这位医生", base, { type: "buyCyberware", doc: "nobody", id: "x" });
for (const doc of ripperdocs) {
  const here = rich(at(base, doc.location));
  const broke = poor(at(base, doc.location));
  add("buyCyberware 不在诊所", rich(base), {
    type: "buyCyberware",
    doc: doc.id,
    id: cyberware[0]?.id ?? "x",
  });
  for (const c of cyberware) {
    add("buyCyberware 有钱", here, { type: "buyCyberware", doc: doc.id, id: c.id });
    add("buyCyberware 没钱赊账", broke, {
      type: "buyCyberware",
      doc: doc.id,
      id: c.id,
      credit: true,
    });
    add("buyCyberware 没钱", broke, { type: "buyCyberware", doc: doc.id, id: c.id });
  }
  add("buyCyberware 恢复期", set(here, "psychosis", { crisis: { status: "recovering" } }), {
    type: "buyCyberware",
    doc: doc.id,
    id: cyberware[0]?.id ?? "x",
  });
  for (const id of [...installed, "no-such-chrome"]) {
    add("removeCyberware", here, { type: "removeCyberware", doc: doc.id, id });
    add("repairCyberware 没坏", here, { type: "repairCyberware", doc: doc.id, id });
    add("repairCyberware 坏了", set(here, "health", { brokenChrome: [id] }), {
      type: "repairCyberware",
      doc: doc.id,
      id,
    });
    add("repairCyberware 坏了没钱", set(broke, "health", { brokenChrome: [id] }), {
      type: "repairCyberware",
      doc: doc.id,
      id,
    });
  }
  add("repayRipperdoc 不欠钱", here, { type: "repayRipperdoc", doc: doc.id });
  const owing = (w: World): World => {
    const deadline = `debt-${doc.id}`;
    const due = w.time + 1440;
    const withDeadline = set(w, "world", {
      deadlines: [
        ...((slice(w, "world").deadlines ?? []) as readonly unknown[]),
        { id: deadline, label: `还${doc.name} 300 欧元`, due, handledAt: null },
      ],
    });
    return set(withDeadline, "cyberware", {
      debts: [{ doc: doc.id, docName: doc.name, amount: 300, due, deadline }],
    });
  };
  add("repayRipperdoc 欠钱", owing(here), { type: "repayRipperdoc", doc: doc.id });
  add("repayRipperdoc 欠钱没钱", owing(broke), { type: "repayRipperdoc", doc: doc.id });
}

// 装备栏
for (const id of [...backpack, "no-such-item"]) {
  add("equipItem", base, { type: "equipItem", id });
  add("equipItem 打斗中", fight(base), { type: "equipItem", id });
}
for (const id of weapons) {
  add("equipItem 换格", base, { type: "equipItem", id, slot: 2 });
  add("unequipItem", base, { type: "unequipItem", id });
  add("unequipItem 打斗中", fight(base), { type: "unequipItem", id });
}
// 改装件
for (const mod of modIds.slice(0, 4)) {
  const withMod = set(base, "inventory", {
    backpack: { ...(inventory.backpack as Record<string, number>), [mod]: 1 },
  });
  for (const weapon of [...weapons, "no-such-weapon"]) {
    add("modWeapon attach", withMod, { type: "modWeapon", action: "attach", weapon, mod });
    add("modWeapon detach", withMod, { type: "modWeapon", action: "detach", weapon, mod });
  }
  add("modWeapon 打斗中", fight(withMod), {
    type: "modWeapon",
    action: "attach",
    weapon: weapons[0] ?? "x",
    mod,
  });
}
// 工作台
for (const id of [...backpack, "no-such-item"]) {
  add("craft dismantle", base, { type: "craft", action: "dismantle", id });
}
for (const id of weapons) {
  add("craft tune 没零件", base, { type: "craft", action: "tune", id });
  add("craft tune 有零件", set(base, "inventory", { parts: 99 }), {
    type: "craft",
    action: "tune",
    id,
  });
}
add("craft 打斗中", fight(base), { type: "craft", action: "dismantle", id: backpack[0] ?? "x" });
// 小队
for (const npc of [...npcIds.slice(0, 3), "no-such-npc"]) {
  for (const action of ["accept", "decline", "dismiss", "pay"]) {
    add("squad", base, { type: "squad", action, npc });
    add("squad 打斗中", fight(base), { type: "squad", action, npc });
  }
}
// 商店
add("buyItem 没这家店", base, { type: "buyItem", shop: "nowhere", id: "x" });
for (const shop of shops) {
  const here = rich(at(base, shop.location));
  add("buyItem 不在店里", rich(base), { type: "buyItem", shop: shop.id, id: items[0]?.id ?? "x" });
  for (const item of items) add("buyItem", here, { type: "buyItem", shop: shop.id, id: item.id });
  for (const item of items.slice(0, 5)) {
    add("buyItem 没钱", poor(at(base, shop.location)), {
      type: "buyItem",
      shop: shop.id,
      id: item.id,
    });
  }
  for (const id of [...backpack, ...weapons, "no-such-item"]) {
    add("sellItem", here, { type: "sellItem", shop: shop.id, id });
  }
}
// 公寓
add("buyHome 没这处", base, { type: "buyHome", id: "no-such-home" });
for (const a of apartments) {
  add("buyHome 不在那里", rich(base), { type: "buyHome", id: a.id });
  add("buyHome 有钱", rich(at(base, a.location)), { type: "buyHome", id: a.id });
  add("buyHome 没钱", poor(at(base, a.location)), { type: "buyHome", id: a.id });
  add("buyHome 打斗中", fight(rich(at(base, a.location))), { type: "buyHome", id: a.id });
}
// 消息、习惯
add("readMessages", base, { type: "readMessages" });
for (const action of ["add", "confirm", "dismiss", "remove"]) {
  add("habit", base, { type: "habit", action, text: "按时吃饭" });
}
// 记忆
for (const action of ["edit", "remove"]) {
  add("editMemory scene", base, {
    type: "editMemory",
    what: "scene",
    action,
    scene: 0,
    before: "原文",
    text: "改过的摘要",
  });
  add("editMemory scene 缺场次", base, {
    type: "editMemory",
    what: "scene",
    action,
    before: "原文",
  });
  for (const npc of [...npcIds.slice(0, 2), "no-such-npc"]) {
    add("editMemory bond", base, {
      type: "editMemory",
      what: "bond",
      action,
      npc,
      index: 0,
      before: "原文",
      ...(action === "edit" ? { text: "改过的记忆" } : {}),
    });
  }
  add("editMemory bond 缺人", base, { type: "editMemory", what: "bond", action, before: "原文" });
}
add("editMemory bond 太长", base, {
  type: "editMemory",
  what: "bond",
  action: "edit",
  npc: npcIds[0] ?? "x",
  index: 0,
  before: "原文",
  text: "长".repeat(121),
});
// 收尾
for (const how of chronicleRules.StoryEndSchema.options) {
  add("endStory", base, { type: "endStory", how });
  add("endStory 墓志铭", base, { type: "endStory", how, epitaph: "活过，烧过" });
  add("endStory 打斗中", fight(base), { type: "endStory", how });
}
// 超梦
add("braindance mark", base, { type: "braindance", action: "mark", point: "clue-1" });
add("braindance 点名不合法", base, { type: "braindance", action: "mark", point: "Bad Point" });
// 补成功覆盖：把世界摆成操作能成立的样子
const offeredJobs = set(base, "jobs", {
  jobs: ((slice(base, "jobs").jobs ?? []) as Slice[]).map((j) => ({ ...j, status: "offered" })),
});
for (const id of jobIds) add("acceptJob 挂着的", offeredJobs, { type: "acceptJob", id });
const mate = npcIds[0];
if (mate !== undefined) {
  const name =
    ((slice(base, "npc").npcs ?? {}) as Record<string, { name?: string }>)[mate]?.name ?? mate;
  const terms = { npc: mate, name, specialty: "开车", trouble: "欠了帮派的钱" };
  const offered = set(base, "squad", {
    offers: [{ ...terms, kind: "friend", share: 10, wage: 0, at: base.time }],
  });
  for (const action of ["accept", "decline"]) {
    add(`squad ${action} 有请求`, offered, { type: "squad", action, npc: mate });
  }
  const hired = rich(
    set(base, "squad", {
      members: [
        {
          ...terms,
          kind: "hired",
          share: 0,
          wage: 500,
          since: base.time,
          status: "ok",
          paidUntil: base.time,
        },
      ],
    }),
  );
  for (const action of ["dismiss", "pay"]) {
    add(`squad ${action} 有队员`, hired, { type: "squad", action, npc: mate });
  }
}
const summarized = set(base, "memory", {
  scenes: [
    {
      scene: 0,
      title: "开场",
      text: "原文",
      people: [],
      place: null,
      importance: memoryRules.ImportanceSchema.options[0],
      keywords: [],
      at: base.time,
    },
  ],
});
for (const action of ["edit", "remove"]) {
  add("editMemory scene 有摘要", summarized, {
    type: "editMemory",
    what: "scene",
    action,
    scene: 0,
    before: "原文",
    ...(action === "edit" ? { text: "改过的摘要" } : {}),
  });
}
const sample = braindances[0];
if (sample) {
  const diving = (marked: readonly string[]) =>
    set(base, "braindance", {
      active: { recording: sample.recording, startedAt: base.time, marked },
    });
  for (const p of sample.recording.points) {
    add("braindance mark 在查", diving([]), { type: "braindance", action: "mark", point: p.id });
  }
  add("braindance mark 没这个点", diving([]), {
    type: "braindance",
    action: "mark",
    point: "no-such-point",
  });
  const first = sample.recording.points[0]?.id ?? "x";
  add("braindance mark 标过了", diving([first]), {
    type: "braindance",
    action: "mark",
    point: first,
  });
}
// schema 不过的
add("没有这种操作", base, { type: "nope" });
add("多了字段", base, { type: "readMessages", extra: 1 });

const digest = (v: unknown): string =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 16);

const results = cases.map((c) => {
  const parsed = PlayerActionSchema.safeParse(c.action);
  if (!parsed.success) {
    return {
      name: c.name,
      action: c.action,
      schema: parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`),
    };
  }
  try {
    const r = applyPlayerAction(c.world, parsed.data, { rng: { roll: () => 1 }, data: gameData });
    if (!r.ok) return { name: c.name, action: c.action, reason: r.reason };
    return {
      name: c.name,
      action: c.action,
      commands: r.commands,
      notes: r.notes,
      world: digest(r.world),
      patches: digest(r.patches),
    };
  } catch (e) {
    return { name: c.name, action: c.action, threw: e instanceof Error ? e.message : String(e) };
  }
});

// 每种操作成立了几次：没有一次成立的，基准就没覆盖到它的结算
const okBy = new Map<string, number>();
for (const r of results) {
  const type = (r.action as { type?: string }).type ?? "?";
  okBy.set(type, (okBy.get(type) ?? 0) + ("commands" in r ? 1 : 0));
}
const summary = [...okBy].map(([t, n]) => `${t} ${n}`).join("、");
const count = (k: string) => results.filter((r) => k in r).length;
console.log(
  `操作 ${results.length} 次：成立 ${count("commands")}，拒绝 ${count("reason")}，schema 不过 ${count("schema")}，抛错 ${count("threw")}`,
);
console.log(`各类成立次数：${summary}`);
for (const r of results) {
  if ("threw" in r) console.log(`抛错用例 ${r.name}：${r.threw}`);
}
for (const [type, successes] of okBy) {
  if (successes > 0) continue;
  const refused = results.find(
    (r) => (r.action as { type?: string }).type === type && "reason" in r,
  );
  if (refused && "reason" in refused)
    console.log(`缺成功覆盖 ${type}：${refused.name} → ${refused.reason}`);
}

if (!check) {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(results, null, 2)}\n`);
  console.log(`基准写到 ${OUT}`);
} else {
  if (!existsSync(OUT)) throw new Error(`没有基准 ${OUT}，先不带 --check 跑一遍`);
  const before = JSON.parse(readFileSync(OUT, "utf8")) as unknown[];
  let bad = 0;
  const n = Math.max(before.length, results.length);
  for (let i = 0; i < n; i += 1) {
    const a = JSON.stringify(before[i] ?? null);
    const b = JSON.stringify(results[i] ?? null);
    if (a === b) continue;
    bad += 1;
    if (bad <= 5) console.log(`✗ 第 ${i} 条\n  之前：${a}\n  现在：${b}`);
  }
  console.log(`比对：${n} 次操作，${bad} 次不一致`);
  if (bad > 0) process.exitCode = 1;
}
