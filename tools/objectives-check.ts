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
import { newGameWorld, projectState, registry, withAllSlices } from "@cp/core";
import { readOffscreen } from "../packages/core/src/narrator/offscreen";

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
    ["消息", v.feed],
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

// 威胁：宿敌的准备
{
  const foe = {
    npc: "foe",
    name: "疤脸",
    since: base.time,
    how: "跳进排水渠逃了",
    prep: { against: "guns", text: "没揭露的准备", at: base.time },
    known: false,
  };
  const hidden = view(set(base, "nemesis", { nemeses: [foe] }));
  const t = hidden.threats.find((x) => x.id === "nemesis:foe");
  expect("准备没揭露时 3 级", t?.level === 3, t);
  expect("没揭露的准备不出现", !text(hidden).includes("没揭露的准备"));
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
  expect("自由沙盘开局不强塞委托", jobs.length === 0, jobs);
  const first: Slice = jobs[0] ?? {
    id: "probe-job",
    title: "试测委托",
    kind: null,
    fixer: "regina",
    asker: null,
    client: "匿名客户",
    location: null,
    risk: 1,
    reward: 1000,
    due: null,
    conflict: "测试利益冲突",
    twist: null,
    notes: [],
    status: "offered",
    offeredAt: base.time,
    acceptedAt: null,
    closedAt: null,
    overdue: false,
    dueHandled: false,
    paid: null,
    summary: null,
    humanityAtAccept: null,
    settlement: null,
  };
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

// 消息：警方频段只播实际涨了的星；传闻听说了才进街头；快讯进新闻，不带真假
const ctx = { rng: { roll: () => 1 }, data: gameData };
const run = (world: World, commands: Parameters<typeof registry.applyCommands>[1]) => {
  const r = registry.applyCommands(world, commands, ctx);
  const bad = r.results.filter((x) => !x.result.ok);
  expect(`指令都生效：${commands.map((c) => c.type).join("、")}`, bad.length === 0, bad);
  return r.world;
};
{
  const kill = { type: "event", kind: "kill", witnesses: 5, public: true, reason: "街头枪战" };
  const once = run(base, [kill]);
  const police = view(once, base).feed.filter((x) => x.channel === "police" && x.source === "heat");
  expect("涨星进警方频段并提醒", police.length === 1 && police[0]?.notify === true, police);
  const top = run(set(base, "heat", { stars: 5 }), [kill]);
  expect("封顶不再播", !view(top).feed.some((x) => x.source === "heat"));

  const rumor = {
    type: "city.rumor",
    text: "有人说他一个人端了据点",
    truth: "exaggerated",
    reach: "city",
  };
  const told = run(base, [rumor]);
  expect("没听说的传闻不进街头", !view(told).feed.some((x) => x.channel === "street"));
  const heard = run(told, [{ type: "rumorHeard", id: 1 }]);
  const street = view(heard).feed.filter((x) => x.channel === "street");
  expect("听说的传闻进街头", street.length === 1 && street[0]?.text === rumor.text, street);
  expect("传闻真假不出现", !/夸大|exaggerated/.test(JSON.stringify(street)));

  const aired = run(base, [
    { type: "city.bulletin", kind: "news", title: "快讯", text: "公司口径" },
  ]);
  const news = view(aired).feed.filter((x) => x.channel === "news");
  expect("快讯进新闻、不弹提醒", news.length === 1 && news[0]?.notify === false, news);
}

// 消息：派单附件只认挂着的委托；一轮最多两条提醒，别的来源一天一条；已读按频道记
{
  const jobs = (slice(base, "jobs").jobs ?? []) as Slice[];
  const first = jobs[0];
  if (first) {
    const offered = set(base, "jobs", {
      jobs: [{ ...first, status: "offered", due: base.time + 600 }],
    });
    const sent = run(offered, [{ type: "phone.receive", from: "x", text: "有活", job: first.id }]);
    const msg = view(sent).feed.find((x) => x.channel === "messages");
    expect("派单消息带委托卡", msg?.attachments[0]?.id === first.id, msg);
    const bad = registry.applyCommands(
      base,
      [{ type: "phone.receive", from: "x", text: "有活", job: "no-such-job" }],
      ctx,
    );
    expect("不存在的委托不能附", bad.results[0]?.result.ok === false, bad.results);
  }

  const three = run(base, [
    { type: "phone.receive", from: "a", text: "一" },
    { type: "phone.receive", from: "b", text: "二" },
    { type: "phone.receive", from: "c", text: "三" },
  ]);
  const n = view(three, base).notifications;
  expect("一轮最多两条提醒，多的记 more", n.items.length === 2 && n.more === 1, n);
  expect("刷新不重复提醒", view(three).notifications.items.length === 0);

  const kill = { type: "event", kind: "kill", witnesses: 5, public: true, reason: "枪战" };
  const twice = run(base, [kill, kill]);
  const p = view(twice, base).notifications.items.filter((x) => x.source === "heat");
  expect("同一来源一天只提醒一条", p.length === 1, p);

  const aired = run(base, [{ type: "city.bulletin", kind: "news", title: "快讯", text: "原文" }]);
  const unread = view(aired).phone.feedUnread.news;
  const read = run(aired, [{ type: "phone.read", feed: [...unread] }]);
  expect("打开新闻后新闻已读", view(read).phone.feedUnread.news.length === 0, unread);
  expect(
    "标新闻不动人发的消息",
    view(run(three, [{ type: "phone.read", feed: [...unread] }])).phone.unread === 3,
  );
}

// 全息电话：来电只露身份和状态；接起、拒接各走一遍；响过时限记成没接，进消息频道
{
  const about = "想当面谈那批货的事，只给叙事模型";
  const ringing = run(base, [{ type: "phone.call", from: "x", about }]);
  const rv = view(ringing);
  expect("来电出现在投影里", rv.calls.incoming?.status === "ringing", rv.calls);
  expect("打来的用意不进投影", !JSON.stringify(rv).includes(about));
  const twice = registry.applyCommands(ringing, [{ type: "phone.call", from: "y", about }], ctx);
  expect("同一时间只响一通", twice.results[0]?.result.ok === false, twice.results);
  const id = rv.calls.incoming?.id ?? 0;

  const answered = run(ringing, [{ type: "phone.answer", id, answer: true }]);
  const av = view(answered);
  expect(
    "接起后不再响，记录是接了",
    av.calls.incoming === null && av.calls.history[0]?.status === "answered",
    av.calls,
  );
  const again = registry.applyCommands(
    answered,
    [{ type: "phone.answer", id, answer: false }],
    ctx,
  );
  expect("接过的不能再拒接", again.results[0]?.result.ok === false, again.results);

  const declined = run(ringing, [{ type: "phone.answer", id, answer: false }]);
  expect("拒接记录是拒接", view(declined).calls.history[0]?.status === "declined");
  expect("拒接不算没接", !view(declined).feed.some((x) => x.id.startsWith("phone:call:")));

  const later = registry.advanceTo(ringing, ringing.time + 10, ctx).world;
  const mv = view(later, ringing);
  const missed = mv.feed.filter((x) => x.id.startsWith("phone:call:"));
  expect(
    "响过时限记成全息电话没接！",
    missed.length === 1 &&
      missed[0]?.text === "全息电话没接！" &&
      missed[0]?.channel === "messages",
    missed,
  );
  expect(
    "没接的来电弹提醒",
    mv.notifications.items.some((x) => x.id.startsWith("phone:call:")),
    mv.notifications,
  );
  expect("没接时用意也不进投影", !JSON.stringify(mv).includes(about));
  const readMissed = run(later, [{ type: "phone.read", feed: missed.map((x) => x.id) }]);
  expect(
    "没接的来电可以标已读",
    view(readMissed).feed.every((x) => !x.id.startsWith("phone:call:") || !x.unread),
  );
}

// 场外来电：解析后真正结算；来意不泄露，和消息共用额度
{
  const npcs = slice(base, "npc").npcs as Record<string, Slice>;
  const id = Object.keys(npcs)[0];
  expect("有可测的来电人物", id !== undefined);
  if (id) {
    const ready = set(base, "npc", {
      npcs: { ...npcs, [id]: { ...npcs[id], met: true, alive: true, affinity: 60 } },
    });
    const about = "仅供叙事模型的来电用意";
    const raw = JSON.stringify({ calls: [{ from: id, about }] });
    const got = readOffscreen(raw, ready, { data: gameData, messages: 2 });
    expect(
      "场外提议产生一通来电",
      got.commands.filter((c) => c.type === "phone.call").length === 1,
    );
    const v = view(run(ready, got.commands));
    expect("场外来电接入玩家投影", v.calls.incoming?.from === id);
    expect("场外来意不进玩家投影", !JSON.stringify(v).includes(about));
    const full = readOffscreen(raw, ready, { data: gameData, messages: 0 });
    expect("联系额度用完不能来电", !full.commands.some((c) => c.type === "phone.call"));
  }
}

// 芯片：读到的原文收进数据库，同一块不重复收，打开后标已读
{
  const shard = {
    type: "shard",
    kind: "email",
    title: "给老莫的邮件",
    from: "无名氏",
    text: "货在码头三号仓，别带人。",
  };
  const once = run(base, [shard]);
  const sv = view(once).shards;
  expect(
    "读到的芯片进数据库、未读",
    sv.list.length === 1 && sv.list[0]?.kindLabel === "邮件" && sv.unread === 1,
    sv,
  );
  expect("同一块芯片不重复收", view(run(once, [shard])).shards.list.length === 1);
  const id = sv.list[0]?.id ?? 0;
  const read = run(once, [{ type: "shards.read", ids: [id] }]);
  expect("打开后芯片已读", view(read).shards.unread === 0);
  const bad = registry.applyCommands(base, [{ ...shard, kind: "video" }], ctx);
  expect("不认识的芯片种类不收", bad.results[0]?.result.ok === false, bad.results);
}

// 期限将至：神经界面自己发，进消息频道；离得远、办完了、过期了都不发；同一来源一天只弹一条
{
  const deadline = (id: string, due: number, handledAt: number | null = null) => ({
    id,
    label: `期限 ${id}`,
    due,
    handledAt,
  });
  const withDeadlines = (list: ReturnType<typeof deadline>[]) =>
    set(base, "world", { deadlines: list });
  const far = view(withDeadlines([deadline("far", base.time + 600)]));
  expect("离期限还远不提醒", !far.feed.some((x) => x.source === "world"));
  const near = withDeadlines([
    deadline("near", base.time + 60),
    deadline("done", base.time + 60, base.time - 200),
    deadline("late", base.time - 10, base.time - 300),
  ]);
  const nv = view(near, withDeadlines([]));
  const warn = nv.feed.filter((x) => x.source === "world");
  expect(
    "快到期的才进消息频道",
    warn.length === 1 && warn[0]?.id === "world:deadline:near" && warn[0]?.channel === "messages",
    warn,
  );
  expect(
    "期限提醒弹出",
    nv.notifications.items.some((x) => x.id === "world:deadline:near"),
    nv.notifications,
  );
  const two = withDeadlines([deadline("a", base.time + 60), deadline("b", base.time + 90)]);
  const tn = view(two, withDeadlines([])).notifications.items.filter((x) => x.source === "world");
  expect("系统自己发的同一来源一天只弹一条", tn.length === 1, tn);
  const readNear = run(near, [{ type: "phone.read", feed: ["world:deadline:near"] }]);
  expect(
    "期限提醒可以标已读",
    view(readNear).feed.every((x) => x.source !== "world" || !x.unread),
  );
}

// 心事结果：系统自己发，只露名字和标题，场外原文不进投影
{
  const seeds = ((gameData as Readonly<Record<string, unknown>>).arcs ?? []) as {
    npc: string;
    concerns: { id: string; title: string }[];
  }[];
  const seed = seeds[0];
  const concern = seed?.concerns[0];
  if (seed && concern) {
    const result = "暗中落定的结果原文";
    const arcWith = (known: boolean) =>
      set(base, "arcs", {
        arcs: {
          [seed.npc]: {
            unlockedAt: base.time,
            concerns: {
              [concern.id]: {
                status: "resolved",
                toldAt: base.time,
                notes: [{ text: "场外推了一步", at: base.time, by: "offscreen" }],
                outcome: { text: result, fate: "worse", at: base.time, by: "offscreen", known },
              },
            },
            doneAt: null,
          },
        },
      });
    const quiet = view(arcWith(false));
    expect("没听说的心事结果不发", !quiet.feed.some((x) => x.source === "arcs"));
    const heard = view(arcWith(true));
    const af = heard.feed.filter((x) => x.source === "arcs");
    expect(
      "听说了的心事结果进消息",
      af.length === 1 && af[0]?.text.includes(concern.title) === true,
      af,
    );
    expect(
      "心事结果原文和场外进展不进消息",
      !/暗中落定的结果原文|场外推了一步/.test(JSON.stringify(heard.feed)),
    );
  }
}

// 连跑几天：每两小时一轮，混着人发的消息、枪战、快讯、期限，统计弹出的提醒
{
  type Cmd = Parameters<typeof registry.applyCommands>[1][number];
  let world = base;
  let maxPerTurn = 0;
  let total = 0;
  let moreTotal = 0;
  const perSourceDay = new Map<string, number>();
  const TURNS = 48;
  for (let turn = 0; turn < TURNS; turn += 1) {
    const before = world;
    const cmds: Cmd[] = [];
    if (turn % 3 === 0) cmds.push({ type: "phone.receive", from: `p${turn}`, text: "在吗" });
    if (turn % 4 === 1) {
      cmds.push({ type: "event", kind: "kill", witnesses: 5, public: true, reason: "枪战" });
    }
    if (turn % 5 === 2) {
      cmds.push({ type: "city.bulletin", kind: "news", title: `快讯${turn}`, text: "公司口径" });
    }
    if (turn % 6 === 0) {
      cmds.push({
        type: "deadline",
        action: "add",
        id: `d${turn}`,
        label: `期限${turn}`,
        due: world.time + 240,
      });
    }
    if (cmds.length > 0) world = run(world, cmds);
    world = registry.advanceTo(world, world.time + 120, ctx).world;
    const n = projectState(world, [], gameData, before).notifications;
    maxPerTurn = Math.max(maxPerTurn, n.items.length);
    total += n.items.length;
    moreTotal += n.more;
    for (const item of n.items) {
      if (item.source === "phone") continue;
      const key = `${item.source}|${Math.floor(item.at / 1440)}`;
      perSourceDay.set(key, (perSourceDay.get(key) ?? 0) + 1);
    }
  }
  const worst = Math.max(0, ...perSourceDay.values());
  console.log(
    `  连跑 ${TURNS} 轮（${(TURNS * 2) / 24} 天）：弹出 ${total} 条，合并进「还有 n 条」${moreTotal} 条，单轮最多 ${maxPerTurn} 条`,
  );
  expect("连跑几天每轮最多弹两条", maxPerTurn <= 2, maxPerTurn);
  expect("系统自己发的同一来源一天最多一条", worst <= 1, [...perSourceDay]);
}

console.log(failed === 0 ? "S4、S5、S6 验收通过" : `S4–S6 验收：${failed} 条不通过`);
if (failed > 0) process.exitCode = 1;
