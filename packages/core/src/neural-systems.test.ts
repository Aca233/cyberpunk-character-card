import { describe, expect, it } from "vitest";
import { seededRng } from "./kernel/rng";
import type { WorldState } from "./kernel/world";
import type { BraindanceState } from "./systems/braindance";
import type { CyberwareState } from "./systems/cyberware";
import type { EconomyState } from "./systems/economy";
import type { InventoryState } from "./systems/inventory";
import { NpcSchema, type NpcState } from "./systems/npc";
import { registry } from "./systems/registry";
import type { ShardsState } from "./systems/shards";

const testData = {
  items: [
    {
      id: "bd-portable-player",
      name: "便携超梦播放头环",
      kind: "misc" as const,
      price: 250,
      description: "支持沉浸回放。",
      braindanceDevice: { playback: true, analysis: [] },
    },
    {
      id: "bd-editor-wreath",
      name: "专业超梦编辑头环",
      kind: "misc" as const,
      price: 1200,
      description: "支持沉浸回放与三层编辑扫描。",
      braindanceDevice: { playback: true, analysis: ["visual", "audio", "thermal"] as const },
    },
    {
      id: "chip-reader-writer",
      name: "隔离芯片读写器",
      kind: "misc" as const,
      price: 450,
      description: "离线沙盒查毒与刻录。",
      chipDevice: "reader-writer" as const,
    },
    {
      id: "blank-shard",
      name: "空白数据芯片",
      kind: "misc" as const,
      price: 50,
      description: "可写入新内容。",
      chipStorage: true,
    },
    {
      id: "shard-raw-heist",
      name: "调查原片：绀碧大厦偷拍",
      kind: "misc" as const,
      price: 0,
      description: "超梦原片芯片。",
      chipContentId: "content-bd-heist",
    },
    {
      id: "shard-skill-gun",
      name: "技能芯片：荒坂战术射击协议",
      kind: "misc" as const,
      price: 800,
      description: "战术手枪肌电校准协议。",
      chipContentId: "content-skill-gun",
    },
    {
      id: "shard-skill-stealth",
      name: "技能芯片：夜行脚步协议",
      kind: "misc" as const,
      price: 800,
      description: "静音步态协调协议。",
      chipContentId: "content-skill-stealth",
    },
    {
      id: "shard-behavior-combat",
      name: "行为协议芯片：格斗托管",
      kind: "misc" as const,
      price: 900,
      description: "玩偶格斗协议。",
      chipContentId: "content-behavior-combat",
    },
    {
      id: "shard-cred-militech",
      name: "军用科技加密信用芯片",
      kind: "misc" as const,
      price: 0,
      description: "带黑冰的加密信用芯片。",
      chipContentId: "content-cred-militech",
    },
    {
      id: "shard-intel-plain",
      name: "歌舞伎货单芯片",
      kind: "misc" as const,
      price: 0,
      description: "未加密普通情报芯片。",
      chipContentId: "content-intel-plain",
    },
  ],
  cyberware: [
    {
      id: "deck-basic",
      name: "野狼基础接入仓",
      slot: "os" as const,
      rarity: "common" as const,
      price: 2000,
      humanityCost: 4,
      ability: "基础网络接入仓。",
      deckTraits: [],
      deckProfile: "基础接入仓",
    },
    {
      id: "braindance-recorder",
      name: "个人超梦录制器",
      slot: "frontalCortex" as const,
      rarity: "rare" as const,
      price: 1800,
      humanityCost: 4,
      ability: "实时录制客观感官原片。",
    },
    {
      id: "doll-behavior-chip",
      name: "玩偶行为芯片",
      slot: "frontalCortex" as const,
      rarity: "uncommon" as const,
      price: 1500,
      humanityCost: 4,
      ability: "允许离线切入玩偶托管或外置行为协议。",
      behaviorChip: {
        purpose: "允许在清醒、玩偶托管、改装协议与故障态之间切换",
        awareness: "absent" as const,
        recall: "none" as const,
        logging: "local-summary" as const,
        safeword: "山茶花",
      },
    },
  ],
  chipContents: [
    {
      id: "content-bd-heist",
      title: "绀碧大厦顶楼监控原片",
      category: "braindance" as const,
      kind: "recording" as const,
      from: "匿名录制者",
      summary: "一段 10 分钟的未剪辑原片。",
      parts: [],
      encryption: "none" as const,
      hazard: "none" as const,
      eddies: 0,
      braindance: "bd-heist-raw",
      related: ["lizzies-bar"],
    },
    {
      id: "content-skill-gun",
      title: "荒坂战术射击协议",
      category: "skill" as const,
      kind: "data" as const,
      from: "军用教范",
      summary: "快速换弹与中近距急停点射协议。",
      parts: [{ id: "p1", label: "协议说明", text: "校准扳机复位与双手握持。", encrypted: false }],
      encryption: "none" as const,
      hazard: "none" as const,
      eddies: 0,
      ability: "中近距手枪速射与快换弹匣动作精准干脆",
      related: [],
    },
    {
      id: "content-skill-stealth",
      title: "夜行脚步协议",
      category: "skill" as const,
      kind: "data" as const,
      from: "黑市流片",
      summary: "压低落脚重心与呼吸频率。",
      parts: [{ id: "p1", label: "协议说明", text: "静音步态。", encrypted: false }],
      encryption: "none" as const,
      hazard: "none" as const,
      eddies: 0,
      ability: "在松动金属或积水地面保持极轻脚步声",
      related: [],
    },
    {
      id: "content-behavior-combat",
      title: "改装玩偶格斗协议",
      category: "behavior" as const,
      kind: "data" as const,
      from: "朱迪改造版",
      summary: "近身拆招与反关节托管协议。",
      parts: [{ id: "p1", label: "协议说明", text: "近战托管。", encrypted: false }],
      encryption: "none" as const,
      hazard: "none" as const,
      eddies: 0,
      ability: "激活行为芯片进入格斗托管模式，身体自主执行近身反制",
      protocol: "改装格斗协议",
      related: [],
    },
    {
      id: "content-cred-militech",
      title: "军用科技加密信用芯片",
      category: "daemon" as const,
      kind: "data" as const,
      from: "梅瑞德斯",
      summary: "内含 1500 欧元与恶意病毒陷阱。",
      parts: [
        { id: "header", label: "明文编号", text: "MT-2077-884", encrypted: false },
        { id: "vault", label: "加密密钥", text: "军用科技外勤经费批次 884。", encrypted: true },
      ],
      encryption: "corp" as const,
      hazard: "malware" as const,
      eddies: 1500,
      related: [],
    },
    {
      id: "content-intel-plain",
      title: "歌舞伎货单",
      category: "intel" as const,
      kind: "data" as const,
      from: "阿岚",
      summary: "今晚到港芯片清单。",
      parts: [
        { id: "p1", label: "正文", text: "三箱二手超梦头环在北码头四号仓。", encrypted: false },
      ],
      encryption: "none" as const,
      hazard: "none" as const,
      eddies: 0,
      related: [],
    },
  ],
  braindances: [
    {
      id: "bd-heist-raw",
      title: "绀碧顶楼原片",
      tier: "raw" as const,
      recorder: "无名线人",
      synopsis: "一段未编辑的调查原片。",
      durationMinutes: 10,
      location: "lizzies-bar",
      passages: [
        { id: "p1", label: "步入套房", minutes: 5, outline: "推开顶层套房大门。" },
        { id: "p2", label: "暗格交易", minutes: 5, outline: "两人在吧台旁低声交接。" },
      ],
      details: [
        {
          id: "d-vis",
          passage: "p1",
          layer: "visual" as const,
          finding: "桌面平板闪过 4419 门禁码。",
        },
        {
          id: "d-aud",
          passage: "p1",
          layer: "audio" as const,
          finding: "背景电话低语提到“北码头仓库”。",
        },
        {
          id: "d-thm",
          passage: "p1",
          layer: "thermal" as const,
          finding: "墙角冷藏柜呈现低温异常轮廓。",
        },
      ],
    },
  ],
  places: [
    {
      id: "lizzies-bar",
      name: "丽姿酒吧",
      district: "歌舞伎区",
      description: "莫克斯帮据点与超梦俱乐部。",
    },
  ],
  shops: [
    {
      id: "lizzies-bar-site",
      name: "丽姿酒吧地下室",
      keeper: "玛特奥",
      location: "lizzies-bar",
      services: ["bd-session"],
      braindanceWorks: ["bd-heist-raw"],
      braindanceDevice: { playback: true, analysis: ["visual", "audio", "thermal"] as const },
      shelf: ["blank-shard"],
    },
  ],
};

function setupWorld(): WorldState {
  const base = registry.initialWorld(0);
  const doll = NpcSchema.parse({
    id: "clouds-doll",
    name: "丝凯",
    role: "云顶玩偶",
    pronoun: "她",
    look: "短发、柔和霓虹眼妆，颈侧带有玩偶芯片接口。",
    voice: "声线轻柔平稳，切入托管后会带出细微机械停顿。",
    want: "早点还清违约金离开云顶。",
    limit: "不泄露云顶高管的私密名单。",
    affinity: 0,
    alive: true,
    lastSeenAt: 0,
    memories: [],
    location: "lizzies-bar",
    met: true,
    adult: true,
    body: { cyberware: ["doll-behavior-chip"], gear: [] },
  });
  return {
    ...base,
    slices: {
      ...base.slices,
      world: { ...(base.slices.world as Record<string, unknown>), location: "lizzies-bar" },
      inventory: {
        ...(base.slices.inventory as Record<string, unknown>),
        backpack: {
          "bd-portable-player": 1,
          "bd-editor-wreath": 1,
          "chip-reader-writer": 1,
          "blank-shard": 1,
          "shard-raw-heist": 1,
          "shard-skill-gun": 1,
          "shard-skill-stealth": 1,
          "shard-behavior-combat": 1,
          "shard-cred-militech": 1,
          "shard-intel-plain": 1,
        },
      },
      cyberware: {
        ...(base.slices.cyberware as Record<string, unknown>),
        installed: [
          { id: "deck-basic", slot: "os", installedAt: 0 },
          { id: "braindance-recorder", slot: "frontalCortex", installedAt: 0 },
          { id: "doll-behavior-chip", slot: "frontalCortex", installedAt: 0 },
        ],
      },
      hacking: { ...(base.slices.hacking as Record<string, unknown>), deck: "deck-basic" },
      npc: { npcs: { "clouds-doll": doll } },
    },
  };
}

describe("新版超梦、芯片与行为芯片核心机制", () => {
  it("芯片：安全芯片直插读取、隔离查毒、离线破译提款、防复制印钱与 2 槽硬上限", () => {
    let world = setupWorld();

    let res = registry.applyCommands(
      world,
      [{ type: "chip", action: "read", carrier: "shard-intel-plain", parts: ["p1"] }],
      { data: testData, rng: seededRng(42) },
    );
    expect(res.results.every((r) => r.result.ok)).toBe(true);
    world = res.world;
    expect((world.slices.shards as ShardsState).shards).toHaveLength(1);

    res = registry.applyCommands(
      world,
      [{ type: "chip", action: "read", carrier: "shard-cred-militech", parts: ["vault"] }],
      { data: testData, rng: seededRng(42) },
    );
    expect(res.results.every((r) => r.result.ok)).toBe(false);

    res = registry.applyCommands(
      world,
      [
        {
          type: "chip",
          action: "inspect",
          carrier: "shard-cred-militech",
          device: "chip-reader-writer",
        },
      ],
      { data: testData, rng: seededRng(42) },
    );
    expect(res.results.every((r) => r.result.ok)).toBe(true);
    world = res.world;
    expect((world.slices.shards as ShardsState).inspected).toContain("shard-cred-militech");

    res = registry.applyCommands(
      world,
      [
        {
          type: "chip",
          action: "decrypt",
          carrier: "shard-cred-militech",
          cleanHazard: true,
          extractEddies: true,
        },
      ],
      { data: testData, rng: seededRng(42) },
    );
    expect(res.results.every((r) => r.result.ok)).toBe(true);
    world = res.world;
    expect((world.slices.economy as EconomyState).eddies).toBe(1500);
    expect((world.slices.shards as ShardsState).cleansed).toContain("shard-cred-militech");

    res = registry.applyCommands(
      world,
      [
        {
          type: "chip",
          action: "copy",
          carrier: "shard-cred-militech",
          destination: "blank-shard",
          device: "chip-reader-writer",
          reason: "试图复制信用芯片",
        },
      ],
      { data: testData, rng: seededRng(42) },
    );
    expect(res.results.every((r) => r.result.ok)).toBe(false);

    res = registry.applyCommands(
      world,
      [{ type: "chip", action: "decrypt", carrier: "shard-cred-militech", extractEddies: true }],
      { data: testData, rng: seededRng(42) },
    );
    expect(res.results.every((r) => r.result.ok)).toBe(false);

    res = registry.applyCommands(
      world,
      [
        { type: "chip", action: "equip", carrier: "shard-skill-gun" },
        { type: "chip", action: "equip", carrier: "shard-skill-stealth" },
      ],
      { data: testData, rng: seededRng(42) },
    );
    expect(res.results.every((r) => r.result.ok)).toBe(true);
    world = res.world;
    expect((world.slices.shards as ShardsState).slots).toHaveLength(2);

    res = registry.applyCommands(
      world,
      [{ type: "chip", action: "equip", carrier: "shard-behavior-combat" }],
      { data: testData, rng: seededRng(42) },
    );
    expect(res.results.every((r) => r.result.ok)).toBe(false);

    res = registry.applyCommands(
      world,
      [
        { type: "chip", action: "unequip", carrier: "shard-skill-stealth" },
        { type: "chip", action: "equip", carrier: "shard-behavior-combat" },
      ],
      { data: testData, rng: seededRng(42) },
    );
    expect(res.results.every((r) => r.result.ok)).toBe(true);
    world = res.world;
    expect((world.slices.shards as ShardsState).slots.map((s) => s.carrier)).toEqual([
      "shard-skill-gun",
      "shard-behavior-combat",
    ]);
    expect(
      (world.slices.cyberware as CyberwareState).behaviorChips?.["doll-behavior-chip"]?.mode,
    ).toBe("protocol");
    expect(
      (world.slices.cyberware as CyberwareState).behaviorChips?.["doll-behavior-chip"]?.carrier,
    ).toBe("shard-behavior-combat");

    res = registry.applyCommands(
      world,
      [{ type: "chip", action: "unequip", carrier: "shard-behavior-combat" }],
      { data: testData, rng: seededRng(42) },
    );
    expect(res.results.every((r) => r.result.ok)).toBe(true);
    world = res.world;
    expect(
      (world.slices.cyberware as CyberwareState).behaviorChips?.["doll-behavior-chip"]?.mode,
    ).toBe("off");
  });

  it("超梦：便携头环禁编辑、编辑头环三层扫描、以及安装录制器现场录制原片", () => {
    let world = setupWorld();

    let res = registry.applyCommands(
      world,
      [
        {
          type: "braindance",
          event: "ev-1",
          action: "play",
          id: "exp-1",
          work: "bd-heist-raw",
          mode: "edit",
          source: { kind: "carrier", carrier: "shard-raw-heist", device: "bd-portable-player" },
        },
      ],
      { data: testData, rng: seededRng(42) },
    );
    expect(res.results.every((r) => r.result.ok)).toBe(false);

    res = registry.applyCommands(
      world,
      [
        {
          type: "braindance",
          event: "ev-2",
          action: "play",
          id: "exp-2",
          work: "bd-heist-raw",
          mode: "edit",
          source: { kind: "carrier", carrier: "shard-raw-heist", device: "bd-editor-wreath" },
        },
        {
          type: "braindance",
          event: "ev-3",
          action: "progress",
          passage: "p1",
          text: "推开顶层套房大门，玻璃幕墙外是雨夜霓虹。",
        },
        { type: "braindance", event: "ev-4", action: "scan", layer: "visual", minutes: 3 },
        { type: "braindance", event: "ev-5", action: "scan", layer: "thermal", minutes: 2 },
        { type: "braindance", event: "ev-6", action: "stop", outcome: "exited" },
      ],
      { data: testData, rng: seededRng(42) },
    );
    expect(res.results.every((r) => r.result.ok)).toBe(true);
    world = res.world;
    const bd = world.slices.braindance as BraindanceState;
    expect(bd.active).toBeNull();
    expect(bd.discoveries.map((d) => d.layer)).toEqual(["visual", "thermal"]);
    expect(bd.history).toHaveLength(1);

    res = registry.applyCommands(
      world,
      [
        {
          type: "braindance",
          event: "ev-rec",
          action: "record",
          workId: "bd-live-1",
          carrierId: "carrier-live-1",
          title: "丽姿吧台暗录",
          synopsis: "记下角落两名帮派分子交接货箱的画面。",
          durationMinutes: 4,
          text: "霓虹闪烁，两人迅速交换银色金属箱。",
        },
      ],
      { data: testData, rng: seededRng(42) },
    );
    expect(res.results.every((r) => r.result.ok)).toBe(true);
    world = res.world;
    expect((world.slices.braindance as BraindanceState).works["bd-live-1"]?.tier).toBe("raw");
    expect((world.slices.inventory as InventoryState).backpack["carrier-live-1"]).toBe(1);
    expect((world.slices.shards as ShardsState).contents["chip-bd-live-1"]?.braindance).toBe(
      "bd-live-1",
    );
  });

  it("行为芯片四态模型：玩家与 NPC 均支持 doll/protocol/glitch/off，安全词停机并留记忆空窗", () => {
    let world = setupWorld();

    let res = registry.applyCommands(
      world,
      [
        {
          type: "cyberware.behavior",
          device: "doll-behavior-chip",
          action: "mode",
          mode: "protocol",
          protocol: "改装格斗协议",
          reason: "接入朱迪改写的近身反制协议",
        },
      ],
      { data: testData, rng: seededRng(42) },
    );
    expect(res.results.every((r) => r.result.ok)).toBe(true);
    world = res.world;
    expect(
      (world.slices.cyberware as CyberwareState).behaviorChips?.["doll-behavior-chip"]?.mode,
    ).toBe("protocol");

    res = registry.applyCommands(
      world,
      [
        {
          type: "cyberware.behavior",
          device: "doll-behavior-chip",
          action: "mode",
          mode: "doll",
          reason: "托管接单",
        },
        {
          type: "cyberware.behavior",
          device: "doll-behavior-chip",
          action: "mode",
          mode: "off",
          reason: "念出安全词山茶花退出托管",
        },
      ],
      { data: testData, rng: seededRng(42) },
    );
    expect(res.results.every((r) => r.result.ok)).toBe(true);
    world = res.world;
    const playerChip = (world.slices.cyberware as CyberwareState).behaviorChips?.[
      "doll-behavior-chip"
    ];
    expect(playerChip?.mode).toBe("off");
    expect(playerChip?.memoryGap).toBe(true);

    res = registry.applyCommands(
      world,
      [
        {
          type: "npcBehavior",
          id: "clouds-doll",
          device: "doll-behavior-chip",
          action: "mode",
          mode: "doll",
          reason: "云顶包厢上钟",
        },
      ],
      { data: testData, rng: seededRng(42) },
    );
    expect(res.results.every((r) => r.result.ok)).toBe(true);
    world = res.world;
    expect(
      (world.slices.npc as NpcState).npcs["clouds-doll"]?.behaviorChips?.["doll-behavior-chip"]
        ?.mode,
    ).toBe("doll");

    res = registry.applyCommands(
      world,
      [
        {
          type: "memory",
          id: "clouds-doll",
          source: "told",
          text: "托管期间对客人说了情报",
        },
      ],
      { data: testData, rng: seededRng(42) },
    );
    expect(res.results.every((r) => r.result.ok)).toBe(false);
  });
});
