import {
  BoardModuleSchema,
  BoardSchema,
  type CharacterCard,
  ComboSchema,
  LifepathEntrySchema,
  type Loadout,
  SKILL_MAX,
  WorkshopPackSchema,
} from "@cp/core";
import { describe, expect, it } from "vitest";
import type { BoardData } from "../../api/client";
import {
  applyOriginPreset,
  budgetKind,
  comboHints,
  creatorChecks,
  DIFFICULTY_BUDGET,
  inherentCyberware,
  isAnyOriginPreset,
  isOriginPreset,
  kitPoints,
  mergeCreatorCatalog,
  ORIGIN_KEYS,
  ORIGIN_PRESETS,
  originEcosystem,
  originLean,
  originNever,
  rollTraits,
  totalStartHumanityCost,
  traitCategory,
  unifiedBudget,
} from "./creator";

/** 分步捏人的纯逻辑（docs/creator-plan.md 分期第 1 条）：不碰界面和 localStorage */

const mod = (id: string, slot: "origin" | "past" | "skill" | "flaw", tags: string[] = []) =>
  BoardModuleSchema.parse({ id, slot, label: id, points: slot === "origin" ? 0 : 1, tags });

describe("budgetKind", () => {
  it("背景点只在过往、旧识、特长、义体四步", () => {
    expect(budgetKind("origin")).toBeNull();
    expect(budgetKind("past")).toBe("background");
    expect(budgetKind("people")).toBe("background");
    expect(budgetKind("skills")).toBe("background");
    expect(budgetKind("cyberware")).toBe("background");
    expect(budgetKind("review")).toBeNull();
  });
});

describe("originLean / originNever", () => {
  const modules = [mod("a", "past"), mod("b", "past"), mod("c", "past"), mod("s", "skill")];
  // 走 schema 解析：生命路径表加了 costs 一栏（第 2 步的代价，2026-10-31），默认空着
  const lifepath = LifepathEntrySchema.array().parse([
    { id: "a", weights: { street: 2 } },
    { id: "b", weights: { street: 3 } },
    { id: "c", weights: { street: 0 } },
    { id: "s", weights: { street: 5 } },
  ]);

  it("只列权重大于 1 的过往，权重高的在前，不混进别的插槽", () => {
    expect(originLean("street", lifepath, modules).map((m) => m.id)).toEqual(["b", "a"]);
  });

  it("没写这个出身的按 1，不算更容易", () => {
    expect(originLean("corpo", lifepath, modules)).toEqual([]);
  });

  it("权重 0 是掷不到", () => {
    expect(originNever("street", lifepath, modules).map((m) => m.id)).toEqual(["c"]);
  });
});

describe("comboHints", () => {
  const combo = ComboSchema.parse({
    id: "x",
    label: "X",
    requires: ["gun", "fast"],
    ability: "能",
  });
  const gun = mod("gun-1", "skill", ["gun"]);
  const fast = mod("fast-1", "skill", ["fast"]);

  it("差一项时列出能补上的本事", () => {
    const board = BoardSchema.parse({ skills: [gun] });
    const hints = comboHints(board, [combo], [gun, fast]);
    expect(hints.map((h) => h.candidates.map((c) => c.id))).toEqual([["fast-1"]]);
  });

  it("一块模块同时满足两项不算（至少两块不同的模块）", () => {
    const both = mod("both", "skill", ["gun", "fast"]);
    const board = BoardSchema.parse({});
    expect(comboHints(board, [combo], [both])).toEqual([]);
  });

  it("本事插满了就没有候选", () => {
    const filler = Array.from({ length: SKILL_MAX }, (_, i) => mod(`f${i}`, "skill"));
    const board = BoardSchema.parse({ skills: [...filler.slice(1), gun] });
    expect(comboHints(board, [combo], [fast])).toEqual([]);
  });
});

describe("creatorChecks", () => {
  // 只填检查要看的字段，其余空着；草稿本来就可能没填完
  const draft = {
    name: "测试",
    alias: "",
    pronoun: "她",
    origin: "",
    look: "",
    past: "",
    personality: "",
    voice: "",
    skills: "",
    scene: "",
    greeting: "",
    examples: "",
    locked: [],
    attributes: { body: 3, reflexes: 3, tech: 3, intelligence: 3, cool: 3 },
    board: BoardSchema.parse({}),
  } as unknown as CharacterCard;

  // 2026-10-31 浏览器检查发现：出身插槽空着时又多报一条"出身不能为空"
  it("出身插槽空着只报一次，链回出身那一步", () => {
    const origin = creatorChecks(draft).filter((c) => c.step === "origin");
    expect(origin).toHaveLength(1);
  });

  it("姓名或代词未填写时链回出身与身份那一步", () => {
    const unnamed = { ...draft, name: "", pronoun: "" } as CharacterCard;
    const checks = creatorChecks(unnamed);
    expect(checks.find((c) => c.text === "尚未填写角色姓名")?.step).toBe("origin");
    expect(checks.find((c) => c.text === "尚未设定人称代词")?.step).toBe("origin");
  });

  it("零过往、零特长与超出 5 点的属性沙盒构筑不阻塞保存", () => {
    const sandbox = {
      ...draft,
      origin: "街头流浪小子",
      attributes: { body: 5, reflexes: 5, tech: 5, intelligence: 5, cool: 5 },
      board: BoardSchema.parse({
        origin: mod("street-kid", "origin"),
        pasts: [],
        skills: [],
      }),
    } as CharacterCard;
    expect(creatorChecks(sandbox)).toEqual([]);
  });
});

describe("ORIGIN_PRESETS and applyOriginPreset", () => {
  const streetMod = mod("street-kid", "origin");
  const skill1 = mod("brawling", "skill", ["近战", "格斗"]);
  const skill2 = mod("lockpick", "skill");
  const skill3 = mod("streetwise", "skill");
  const skill4 = mod("pain-editor-nerve", "skill", ["禀赋"]);
  const allMods = [streetMod, skill1, skill2, skill3, skill4];

  const blankCard = {
    name: "V",
    alias: "",
    pronoun: "他",
    origin: "",
    look: "",
    past: "",
    personality: "",
    voice: "",
    skills: "",
    scene: "",
    greeting: "",
    examples: "",
    locked: [],
    attributes: { body: 3, reflexes: 3, tech: 3, intelligence: 3, cool: 3 },
    board: BoardSchema.parse({}),
  } as unknown as CharacterCard;

  it("各出身预设无强制过往、配齐 4 项特质", () => {
    for (const key of ORIGIN_KEYS) {
      const preset = ORIGIN_PRESETS[key];
      expect(preset.pasts).toHaveLength(0);
      expect(preset.skills).toHaveLength(4);
    }
  });

  it("一键载入街头小子预设，写入出身与 4 项特质，且不生成联动组合", () => {
    const updated = applyOriginPreset("street-kid", blankCard, allMods, []);
    expect(updated.origin).toBe("street-kid");
    expect(updated.board?.origin?.id).toBe("street-kid");
    expect(updated.board?.pasts).toEqual([]);
    expect(updated.board?.skills.map((s) => s.id)).toEqual([
      "brawling",
      "lockpick",
      "streetwise",
      "pain-editor-nerve",
    ]);
    expect(updated.board?.combos).toEqual([]);
    if (!updated.board) throw new Error("board should be defined");
    expect(isOriginPreset("street-kid", updated.board)).toBe(true);
    expect(isAnyOriginPreset(updated.board)).toBe(true);
  });
});

describe("DIFFICULTY_BUDGET / unifiedBudget / kitPoints", () => {
  const streetLoadout: Loadout = {
    id: "street-kid",
    label: "街头小子行装",
    kind: "origin",
    keywords: ["街头", "street-kid"],
    eddies: 500,
    cyberware: ["kiroshi-mk1"],
    gear: [{ id: "street-jacket" }],
    vehicles: ["archer-hella"],
  };
  const data = {
    loadouts: [streetLoadout],
    weapons: [
      { id: "unity", name: "统一手枪", rarity: "common" as const, points: 1, ability: "可靠" },
      { id: "katana", name: "武士刀", rarity: "rare" as const, points: 3, ability: "利刃" },
    ],
    vehicles: [
      {
        id: "archer-hella",
        name: "赫拉",
        class: "sedan" as const,
        maker: "Archer",
        seats: 4,
        trunk: 8,
        points: 2,
      },
      {
        id: "kusanagi",
        name: "草薙",
        class: "bike" as const,
        maker: "Yaiba",
        seats: 2,
        trunk: 2,
        points: 4,
      },
    ],
  } as Pick<BoardData, "weapons" | "vehicles" | "loadouts">;

  it("三种战局难度给到不同的统一定制点数上限", () => {
    expect(DIFFICULTY_BUDGET).toEqual({
      streetLegend: 24,
      nightCity: 17,
      deathCity: 12,
    });
  });

  it("统一结算属性、特质、义体、耐受、人脉、行装开销与负面返还，且不阻塞传奇沙盒超限", () => {
    const flaw1 = BoardModuleSchema.parse({ id: "debt", slot: "flaw", label: "高利贷", points: 4 });
    const flaw2 = BoardModuleSchema.parse({ id: "wanted", slot: "flaw", label: "通缉", points: 4 });
    const flaw3 = BoardModuleSchema.parse({
      id: "insomnia",
      slot: "flaw",
      label: "失眠",
      points: 4,
    });
    const card = {
      name: "V",
      alias: "",
      pronoun: "她",
      origin: "街头小子",
      look: "",
      past: "",
      personality: "",
      voice: "",
      skills: "",
      scene: "",
      greeting: "",
      examples: "",
      locked: [],
      attributes: { body: 4, reflexes: 4, tech: 3, intelligence: 3, cool: 3 }, // attr = 7
      board: BoardSchema.parse({
        origin: BoardModuleSchema.parse({
          id: "street-kid",
          slot: "origin",
          label: "街头小子",
          points: 1,
        }),
        skills: [BoardModuleSchema.parse({ id: "gun", slot: "skill", label: "神枪手", points: 3 })],
        flaws: [flaw1, flaw2, flaw3], // 4 + 4 + 4 = 12, capped at 10 (wasted 2)
        cyberware: [{ id: "optics", name: "义眼", points: 3, humanityCost: 4 }],
        tolerance: "low", // refund 2
        acquaintances: [{ id: "jackie", name: "杰克", relation: "friend", note: "" }], // 2 pts
        kit: { cashTier: "stash", weapons: ["katana"], vehicle: "archer-hella" }, // stash=2, katana=3, free vehicle=0
      }),
    } as unknown as CharacterCard;

    const u = unifiedBudget(card, "deathCity", data);
    expect(u.limit).toBe(12);
    expect(u.traitSpent).toBe(4); // 1 + 3
    expect(u.cyberwareSpent).toBe(3);
    expect(u.peopleSpent).toBe(2);
    expect(u.kitSpent).toBe(5); // 2 + 3 + 0 (free vehicle)
    expect(u.grossSpent).toBe(14);
    expect(u.refund).toBe(12); // 10 (capped) + 2 (low tolerance)
    expect(u.wastedRefund).toBe(2);
    expect(u.netSpent).toBe(2);
    expect(u.remaining).toBe(10);
    expect(u.overLimit).toBe(false);

    // 换算成非免费载具 + 巨额黑金且无负面缺陷 -> 超过死城 12 点上限，标记 overLimit 而不报错
    if (!card.board) throw new Error("board should be defined");
    const richCard = {
      ...card,
      board: {
        ...card.board,
        flaws: [],
        tolerance: "normal" as const,
        kit: { cashTier: "windfall" as const, weapons: ["katana"], vehicle: "kusanagi" },
      },
    } as CharacterCard;
    expect(kitPoints(richCard, data)).toEqual({ spent: 4 + 3 + 4, refund: 0 });
    const over = unifiedBudget(richCard, "deathCity", data);
    expect(over.overLimit).toBe(true);
    expect(over.remaining).toBeLessThan(0);
  });

  it("一贫如洗档位返还 1 点定制点数", () => {
    const brokeCard = {
      name: "V",
      alias: "",
      pronoun: "她",
      origin: "街头小子",
      attributes: { body: 2, reflexes: 2, tech: 2, intelligence: 2, cool: 2 },
      board: BoardSchema.parse({ kit: { cashTier: "broke", weapons: [], vehicle: null } }),
    } as unknown as CharacterCard;
    expect(kitPoints(brokeCard, data)).toEqual({ spent: 0, refund: 1 });
    const u = unifiedBudget(brokeCard, "nightCity", data);
    expect(u.refund).toBe(1);
    expect(u.netSpent).toBe(-1);
    expect(u.remaining).toBe(18);
  });
});

describe("inherentCyberware & totalStartHumanityCost", () => {
  const streetLoadout: Loadout = {
    id: "street-kid",
    label: "街头小子",
    kind: "origin",
    keywords: ["街头", "street-kid"],
    eddies: 500,
    cyberware: ["kiroshi-mk1"],
    gear: [],
  };
  const netLoadout: Loadout = {
    id: "netrunner",
    label: "黑客",
    kind: "background",
    keywords: ["入侵", "黑客"],
    eddies: 300,
    cyberware: ["militech-paraline"],
    gear: [],
  };
  const data = {
    loadouts: [streetLoadout, netLoadout],
    names: {
      "kiroshi-mk1": "岐路司义眼 Mk.1",
      "militech-paraline": "军用科技平行线",
    },
    cyberware: [
      {
        id: "kiroshi-mk1",
        name: "Kiroshi Mk.1",
        slot: "eyes",
        rarity: "common",
        points: 1,
        humanityCost: 2,
        ability: "扫描",
      },
      {
        id: "kiroshi-mk2",
        name: "Kiroshi Mk.2",
        slot: "eyes",
        rarity: "uncommon",
        points: 2,
        humanityCost: 4,
        ability: "增强",
      },
      {
        id: "militech-paraline",
        name: "Paraline",
        slot: "os",
        rarity: "common",
        points: 2,
        humanityCost: 6,
        ability: "入侵",
      },
      {
        id: "sandevistan",
        name: "斯安威斯坦",
        slot: "os",
        rarity: "rare",
        points: 3,
        humanityCost: 12,
        ability: "子弹时间",
      },
    ],
  } as unknown as Pick<BoardData, "cyberware" | "loadouts" | "names">;

  it("自动显示出身与黑客履历自带的免费义体并计入真实开局人性消耗", () => {
    const card = {
      origin: "街头小子",
      board: BoardSchema.parse({
        origin: mod("street-kid", "origin"),
        skills: [
          BoardModuleSchema.parse({
            id: "quickhacking",
            slot: "skill",
            label: "快速入侵",
            points: 2,
            tags: ["黑客"],
          }),
        ],
        tolerance: "normal",
      }),
    } as unknown as CharacterCard;

    const inherent = inherentCyberware(card, data);
    expect(inherent.map((i) => i.id)).toEqual(["kiroshi-mk1", "militech-paraline"]);
    expect(inherent.every((i) => !i.replaced)).toBe(true);
    expect(totalStartHumanityCost(card, data)).toBe(8); // 2 + 6
  });

  it("自选义体占满槽位后标配义体自动标为已顶替，未占满部位的标配共存", () => {
    // 眼部容量 2、操作系统容量 1：各装 1 件时，操作系统标配被顶替，眼部标配仍保留
    const card = {
      origin: "街头小子",
      board: BoardSchema.parse({
        origin: mod("street-kid", "origin"),
        skills: [
          BoardModuleSchema.parse({
            id: "quickhacking",
            slot: "skill",
            label: "快速入侵",
            points: 2,
            tags: ["黑客"],
          }),
        ],
        cyberware: [
          { id: "kiroshi-mk2", name: "Kiroshi Mk.2", points: 2, humanityCost: 4, slot: "eyes" },
          { id: "sandevistan", name: "斯安威斯坦", points: 3, humanityCost: 12, slot: "os" },
        ],
        tolerance: "high", // TOLERANCE_FACTOR.high = 0.7
      }),
    } as unknown as CharacterCard;

    const inherent = inherentCyberware(card, data);
    expect(inherent).toEqual([
      expect.objectContaining({ id: "kiroshi-mk1", replaced: false }),
      expect.objectContaining({ id: "militech-paraline", replaced: true }),
    ]);
    // 保留的 kiroshi-mk1 (2) + kiroshi-mk2 (4) + sandevistan (12) = 18; 18 * 0.7 = 12.6 -> round 13
    expect(totalStartHumanityCost(card, data)).toBe(13);
  });
});

describe("CK3 分类、随机特质与工坊合并", () => {
  it("按标签将出身分成企业/潜网/恶土/街头/自定义五大类", () => {
    expect(originEcosystem(mod("corpo", "origin"))).toBe("corpo");
    expect(originEcosystem(mod("o-net", "origin", ["黑客"]))).toBe("net");
    expect(originEcosystem(mod("o-bad", "origin", ["恶土"]))).toBe("badlands");
    expect(originEcosystem(mod("o-street", "origin", ["帮派"]))).toBe("street");
    expect(
      originEcosystem(
        BoardModuleSchema.parse({
          id: "o-custom",
          slot: "origin",
          label: "自写",
          points: 0,
          custom: true,
        }),
      ),
    ).toBe("custom");
  });

  it("traitCategory 正确识别身心禀赋、专长技艺、旧履历与自定义", () => {
    expect(traitCategory(mod("ice-veins", "skill", ["禀赋"]))).toBe("innate");
    expect(traitCategory(mod("gun", "skill", ["枪械"]))).toBe("craft");
    expect(traitCategory(mod("old-past", "past"))).toBe("past");
    expect(
      traitCategory(
        BoardModuleSchema.parse({
          id: "c",
          slot: "skill",
          label: "自定义",
          points: 1,
          custom: true,
        }),
      ),
    ).toBe("custom");
  });

  it("rollTraits 仅从非自定义 skill 特质抽取并避开已有特质", () => {
    const s1 = mod("s1", "skill");
    const pool = [
      s1,
      mod("s2", "skill"),
      mod("p1", "past"),
      BoardModuleSchema.parse({
        id: "s-custom",
        slot: "skill",
        label: "自定义",
        points: 1,
        custom: true,
      }),
    ];
    const start = BoardSchema.parse({ skills: [s1] });
    const next = rollTraits(start, pool, () => 0, 3);
    expect(next.skills.map((s) => s.id)).toEqual(["s1", "s2"]);
  });

  it("mergeCreatorCatalog 按 id 去重合并官方目录、本地自定义模块与工坊扩展包", () => {
    const base = {
      modules: [mod("core-1", "skill")],
      combos: [],
      lifepath: [],
      cyberware: [],
      npcs: [],
    } as unknown as BoardData;
    const localMod = BoardModuleSchema.parse({
      id: "local-1",
      slot: "skill",
      label: "本地",
      points: 1,
      custom: true,
    });
    const pack = WorkshopPackSchema.parse({
      id: "pack-1",
      title: "扩展包",
      author: "Modder",
      modules: [
        mod("core-1", "skill"), // 重复 id 应被忽略，不覆盖官方模块
        mod("pack-mod", "origin"),
      ],
    });

    const merged = mergeCreatorCatalog(base, [localMod], [pack]);
    expect(merged.modules.map((m) => m.id)).toEqual(["core-1", "local-1", "pack-mod"]);
    expect(merged.modules[0]?.custom).toBe(false);
    expect(merged.modules[2]?.custom).toBe(true);
  });
});
