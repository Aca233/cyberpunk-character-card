/**
 * S4、S5 验收：新开局在内存里摆出各种状态，检查投影里的待办、威胁、交互和系统通知。
 * 等级、状态、期限对不对，id 唯一，只给模型看的东西（转折、未公开的结局和准备、场外动静、答案）不出现，
 * 暗中的变化也不触发通知。不调用模型，不读写存档。用法：tsx objectives-check.ts
 */
import {
  braindances,
  DEFAULT_LOADOUT,
  DEFAULT_OPENING,
  gameContent,
  gameData,
  ripperdocs,
  shops,
} from "@cp/content";
import { newGameWorld, projectState, withAllSlices } from "@cp/core";

type World = ReturnType<typeof newGameWorld>;
type Slice = Record<string, unknown>;

const base: World = withAllSlices(
  newGameWorld(
    {
      startTime: Date.UTC(2077, 9, 1, 22) / 60000,
      difficulty: "nightCity",
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

let failed = 0;
function expect(name: string, ok: boolean, detail?: unknown): void {
  if (ok) {
    console.log(`✓ ${name}`);
  } else {
    failed += 1;
    console.log(`✗ ${name}${detail === undefined ? "" : `：${JSON.stringify(detail)}`}`);
  }
}

function view(world: World, before?: World) {
  const v = projectState(world, [], gameData, before);
  for (const [label, entries] of [
    ["待办", v.objectives],
    ["威胁", v.threats],
    ["交互", v.interactions],
  ] as const) {
    const ids = entries.map((entry) => entry.id);
    expect(`${label} id 不重复`, new Set(ids).size === ids.length, ids);
  }
  return v;
}
const text = (v: ReturnType<typeof view>) => JSON.stringify([v.objectives, v.threats]);

// 威胁：热度和悬赏
{
  const v = view(set(base, "heat", { stars: 3.5 }));
  const t = v.threats.find((x) => x.id === "heat:ncpd");
  expect("热度 3.5 星按整星算 3 级", t?.level === 3, t);
  const hunted = view(
    set(base, "heat", {
      stars: 0,
      bounties: [
        {
          id: "b1",
          at: base.time,
          reward: 10000,
          reasons: ["枪战"],
          hunter: "x",
          resolvedAt: null,
          resolution: null,
        },
        {
          id: "b2",
          at: base.time,
          reward: 5000,
          reasons: [],
          hunter: null,
          resolvedAt: base.time,
          resolution: "settled",
        },
      ],
    }),
  );
  const b = hunted.threats.filter((x) => x.source === "heat");
  expect("0 星没有热度条，了结的悬赏不列", b.length === 1 && b[0]?.id === "heat:bounty:b1", b);
  expect("赏金猎人找上来算 5 级", b[0]?.level === 5, b[0]);
}

// 威胁：宿敌的准备和场外动静
{
  const foe = {
    npc: "foe",
    name: "疤脸",
    since: base.time,
    how: "跳进排水渠逃了",
    prep: { against: "guns", text: "没揭露的准备", at: base.time },
    known: false,
    moves: [{ text: "场外的动静", at: base.time }],
    lastMoveAt: base.time,
  };
  const hidden = view(set(base, "nemesis", { nemeses: [foe] }));
  const t = hidden.threats.find((x) => x.id === "nemesis:foe");
  expect("准备没揭露时 3 级", t?.level === 3, t);
  expect("没揭露的准备和场外动静不出现", !/没揭露的准备|场外的动静/.test(text(hidden)));
  const known = view(set(base, "nemesis", { nemeses: [{ ...foe, known: true }] }));
  expect("准备揭露后 4 级并写出来", known.threats.find((x) => x.id === "nemesis:foe")?.level === 4);
}

// 威胁：势力态度
{
  const factions = ((gameData as Readonly<Record<string, unknown>>).factions ?? []) as {
    id: string;
  }[];
  const f = factions[0];
  expect("内容包有势力可以测", f !== undefined);
  if (f) {
    const stance = (attitude: string) =>
      view(
        set(base, "factions", {
          stances: { [f.id]: { attitude, reason: "测试理由", at: base.time } },
        }),
      );
    const kos = stance("kos").threats.find((x) => x.id === `factions:${f.id}`);
    expect(
      "见面就打的势力 3 或 4 级，带理由",
      (kos?.level === 3 || kos?.level === 4) && kos.reason.includes("测试理由"),
      kos,
    );
    expect(
      "友好的势力不算威胁",
      !stance("friendly").threats.some((x) => x.id === `factions:${f.id}`),
    );
  }
}

// 待办：委托
{
  const jobs = (slice(base, "jobs").jobs ?? []) as Slice[];
  const first = jobs[0];
  expect("开局有委托可以测", first !== undefined);
  if (first) {
    const withJob = (j: Slice) =>
      set(base, "jobs", { jobs: [{ ...first, twist: "隐藏的转折", ...j }] });
    const offered = view(withJob({ status: "offered", due: base.time + 600 }));
    const o = offered.objectives.find((x) => x.id === `jobs:${first.id}`);
    expect("挂着的委托是 offered，期限 600 分钟", o?.status === "offered" && o?.dueIn === 600, o);
    expect("委托转折不出现", !text(offered).includes("隐藏的转折"));
    const late = view(withJob({ status: "active", due: base.time - 10 }));
    const l = late.objectives.find((x) => x.id === `jobs:${first.id}`);
    expect("过了期限的在办委托是 overdue", l?.status === "overdue" && l?.dueIn === -10, l);
    const done = view(withJob({ status: "clean" }));
    expect("结束的委托不进待办", !done.objectives.some((x) => x.id === `jobs:${first.id}`));
  }
}

// 待办：心事；场外暗中出了结局，待办和人物卡都不能变
{
  const seeds = ((gameData as Readonly<Record<string, unknown>>).arcs ?? []) as {
    npc: string;
    concerns: { id: string }[];
  }[];
  const npcs = (slice(base, "npc").npcs ?? {}) as Record<string, Slice>;
  const seed = seeds.find((s) => npcs[s.npc] !== undefined);
  expect("开局有能测的心事", seed !== undefined);
  const concern = seed?.concerns[0];
  if (seed && concern) {
    const at = base.time;
    const note = { text: "场上的进展", at, by: "scene" };
    const met = set(base, "npc", {
      npcs: { ...npcs, [seed.npc]: { ...npcs[seed.npc], met: true } },
    });
    const arc = (p: Slice) =>
      set(met, "arcs", {
        arcs: {
          [seed.npc]: {
            unlockedAt: at,
            concerns: { [concern.id]: p },
            lastOffscreenAt: null,
            doneAt: null,
          },
        },
      });
    const told = view(arc({ status: "told", toldAt: at, notes: [note], outcome: null }));
    const hidden = view(
      arc({
        status: "resolved",
        toldAt: at,
        notes: [note, { text: "场外推了一步", at, by: "offscreen" }],
        outcome: {
          text: "暗中的结局",
          fate: "canon",
          at,
          by: "offscreen",
          known: false,
          previousStatus: "told",
        },
      }),
    );
    const id = `arcs:${seed.npc}:${concern.id}`;
    const a = told.objectives.find((x) => x.id === id);
    const b = hidden.objectives.find((x) => x.id === id);
    expect("说出口的心事是 offered", a?.status === "offered" && a?.progress === "场上的进展", a);
    expect("暗中出结局后待办不变", JSON.stringify(a) === JSON.stringify(b), [a, b]);
    expect("暗中的结局和场外动静不出现", !/暗中的结局|场外推了一步/.test(JSON.stringify(hidden)));
    const card = (v: ReturnType<typeof view>) => v.npcs.find((n) => n.id === seed.npc)?.arc;
    expect("人物卡上的心事也不变", JSON.stringify(card(told)) === JSON.stringify(card(hidden)), [
      card(told),
      card(hidden),
    ]);
  }
}

// 待办：超梦；答案和真相不进来
{
  const sample = braindances[0];
  expect("内容包有超梦录像可以测", sample !== undefined);
  if (sample) {
    const idle = view(base);
    expect("没在查超梦时没有超梦待办", !idle.objectives.some((x) => x.source === "braindance"));
    const diving = view(
      set(base, "braindance", {
        active: { recording: sample.recording, startedAt: base.time, marked: [] },
      }),
    );
    const bd = diving.objectives.filter((x) => x.source === "braindance");
    expect("在查的超梦一条，状态 active", bd.length === 1 && bd[0]?.status === "active", bd);
    const secrets = [
      JSON.stringify(sample.recording.answer),
      JSON.stringify(sample.recording.truth),
    ].filter((s) => s.length > 6);
    const shown = JSON.stringify(bd);
    expect(
      "超梦答案和真相不出现",
      secrets.every((s) => !shown.includes(s.slice(1, -1))),
      bd,
    );
  }
}

// 交互：商店、义体医生按当前地点出现；没在查超梦时没有编辑器入口
{
  const at = (location: string) => set(base, "world", { location });
  const shop = shops[0];
  if (shop) {
    const here = view(at(shop.location)).interactions;
    expect(
      "在店里有进店交互",
      here.some((x) => x.id === `inventory:shop:${shop.id}` && x.target === shop.id),
      here,
    );
  }
  const doc = ripperdocs[0];
  if (doc) {
    const here = view(at(doc.location)).interactions;
    expect(
      "在诊所有义体医生交互",
      here.some((x) => x.id === `cyberware:ripperdoc:${doc.id}`),
      here,
    );
  }
  expect(
    "没在查超梦时没有编辑器交互",
    !view(base).interactions.some((x) => x.source === "braindance"),
  );
}

// 事件：没给前态时不出；只比玩家看得到的变化，暗中的准备和结局不触发
{
  expect("没有前态时没有事件", view(base).events.length === 0);
  const foe = {
    npc: "foe",
    name: "疤脸",
    since: base.time,
    how: "逃了",
    prep: null,
    known: false,
    moves: [],
    lastMoveAt: null,
  };
  const was = set(base, "nemesis", { nemeses: [foe] });
  const rose = view(was, base).events;
  expect(
    "宿敌升级出一条事件",
    rose.some((e) => e.text.includes("成了你的宿敌")),
    rose,
  );
  const prepped = set(base, "nemesis", {
    nemeses: [{ ...foe, prep: { against: "guns", text: "暗中的准备", at: base.time } }],
  });
  const quiet = view(prepped, was).events;
  expect("没揭露的准备不出事件", quiet.length === 0, quiet);
  const hp = set(base, "health", { condition: "down" });
  const down = view(hp, base).events;
  expect(
    "倒下出状态事件",
    down.some((e) => e.source === "health"),
    down,
  );
}

console.log(failed === 0 ? "S4、S5 验收通过" : `S4、S5 验收：${failed} 条不通过`);
if (failed > 0) process.exitCode = 1;
