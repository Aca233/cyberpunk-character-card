import {
  BoardModuleSchema,
  BoardSchema,
  type CharacterCard,
  type Loadout,
  WorkshopPackSchema,
} from "@cp/core";
import { describe, expect, it } from "vitest";
import type { BoardData } from "../../api/client";
import {
  CREATOR_STEPS,
  creatorChecks,
  emptyBoard,
  humanityStageInfo,
  inherentCyberware,
  mergeCreatorCatalog,
  originDefaultLoadout,
  originEcosystem,
  pruneKitForOrigin,
  rollTraits,
  stepForCheckTarget,
  stepProgress,
  totalStartHumanityCost,
  traitCategory,
} from "./creator";

/** 2077 赛博档案工作台纯逻辑测试：无点数上限束缚，仅受槽位容量与人性耐受约束 */

const mod = (id: string, slot: "origin" | "past" | "skill" | "flaw", tags: string[] = []) =>
  BoardModuleSchema.parse({ id, slot, label: id, tags });

describe("emptyBoard / 五步引导工作台辅助函数", () => {
  const blank = {
    name: "",
    alias: "",
    pronoun: "TA",
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
    attributes: { body: 2, reflexes: 2, tech: 2, intelligence: 2, cool: 2 },
    board: emptyBoard(),
  } as unknown as CharacterCard;

  it("CREATOR_STEPS 按 5 步顺序定义且映射全部 CheckTarget", () => {
    expect(CREATOR_STEPS.map((s) => s.id)).toEqual([
      "identity",
      "traits",
      "chrome_kit",
      "people_prose",
      "review",
    ]);
    expect(stepForCheckTarget("identity")).toBe("identity");
    expect(stepForCheckTarget("origin")).toBe("identity");
    expect(stepForCheckTarget("build")).toBe("traits");
    expect(stepForCheckTarget("cyber")).toBe("chrome_kit");
    expect(stepForCheckTarget("kit")).toBe("chrome_kit");
    expect(stepForCheckTarget("people")).toBe("people_prose");
    expect(stepForCheckTarget("person")).toBe("people_prose");
  });

  it("stepProgress 正确统计各步就绪态与摘要计数", () => {
    const emptyProg = stepProgress(blank);
    expect(emptyProg.identity.ready).toBe(false);
    expect(emptyProg.identity.issueCount).toBe(2); // 缺姓名和出身
    expect(emptyProg.review.ready).toBe(false);

    const readyCard = {
      ...blank,
      name: "V",
      origin: "街头小子",
      look: "义眼泛着冷光",
      board: BoardSchema.parse({
        origin: mod("street-kid", "origin"),
        skills: [mod("s1", "skill")],
        pasts: [mod("p1", "past")],
        acquaintances: [{ id: "jackie", name: "杰克", relation: "friend", note: "" }],
      }),
    } as CharacterCard;
    const readyProg = stepProgress(readyCard);
    expect(readyProg.identity).toMatchObject({ ready: true, filled: true, badge: "street-kid" });
    expect(readyProg.traits).toMatchObject({ ready: true, filled: true, badge: "2 项" });
    expect(readyProg.people_prose).toMatchObject({
      ready: true,
      filled: true,
      badge: "1人 · 1/7段",
    });
    expect(readyProg.review).toMatchObject({ ready: true, issueCount: 0, badge: "可开局" });
  });
});

describe("creatorChecks", () => {
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

  it("出身插槽空着只报一次，跳转目标指向 origin", () => {
    const origin = creatorChecks(draft).filter((c) => c.target === "origin");
    expect(origin).toHaveLength(1);
  });

  it("姓名或代词未填写时跳转目标指向 identity", () => {
    const unnamed = { ...draft, name: "", pronoun: "" } as CharacterCard;
    const checks = creatorChecks(unnamed);
    expect(checks.find((c) => c.text === "尚未填写角色姓名")?.target).toBe("identity");
    expect(checks.find((c) => c.text === "尚未设定人称代词")?.target).toBe("identity");
  });

  it("零过往、零特长与自由高属性构筑不阻塞保存", () => {
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

describe("originDefaultLoadout & pruneKitForOrigin", () => {
  const streetLoadout: Loadout = {
    id: "street-kid",
    label: "街头小子行装",
    kind: "origin",
    keywords: ["街头", "street-kid"],
    eddies: 500,
    cyberware: ["kiroshi-mk1"],
    gear: [{ id: "unity" }],
    vehicles: ["archer-hella"],
  };
  const data = {
    loadouts: [streetLoadout],
    names: {
      unity: "统一手枪",
      "archer-hella": "赫拉 EC-D",
    },
    cyberware: [],
  } as unknown as Pick<BoardData, "loadouts" | "names" | "cyberware">;

  it("按资金档位折算实际进场欧元，不再计算定制点数", () => {
    const makeCard = (cashTier: "broke" | "standard" | "stash" | "windfall") =>
      ({
        origin: "街头小子",
        board: BoardSchema.parse({
          origin: mod("street-kid", "origin"),
          kit: { cashTier, weapons: [], vehicle: null },
        }),
      }) as unknown as CharacterCard;

    expect(originDefaultLoadout(makeCard("broke"), data).finalEddies).toBe(0);
    expect(originDefaultLoadout(makeCard("standard"), data).finalEddies).toBe(500);
    expect(originDefaultLoadout(makeCard("stash"), data).finalEddies).toBe(3000);
    expect(originDefaultLoadout(makeCard("windfall"), data).finalEddies).toBe(6500);
  });

  it("切换出身时自动清理已被新出身免费附带的武器与载具", () => {
    const board = BoardSchema.parse({
      origin: mod("street-kid", "origin"),
      kit: { cashTier: "standard", weapons: ["unity", "katana"], vehicle: "archer-hella" },
    });
    const card = { origin: "街头小子", board } as unknown as CharacterCard;
    const pruned = pruneKitForOrigin(card, board, data);
    expect(pruned.kit.weapons).toEqual(["katana"]);
    expect(pruned.kit.vehicle).toBeNull();
  });
});

describe("inherentCyberware, totalStartHumanityCost & humanityStageInfo", () => {
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
        humanityCost: 2,
        ability: "扫描",
      },
      {
        id: "kiroshi-mk2",
        name: "Kiroshi Mk.2",
        slot: "eyes",
        rarity: "uncommon",
        humanityCost: 4,
        ability: "增强",
      },
      {
        id: "militech-paraline",
        name: "Paraline",
        slot: "os",
        rarity: "common",
        humanityCost: 6,
        ability: "入侵",
      },
      {
        id: "sandevistan",
        name: "斯安威斯坦",
        slot: "os",
        rarity: "rare",
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
    const card = {
      origin: "街头小子",
      board: BoardSchema.parse({
        origin: mod("street-kid", "origin"),
        skills: [
          BoardModuleSchema.parse({
            id: "quickhacking",
            slot: "skill",
            label: "快速入侵",
            tags: ["黑客"],
          }),
        ],
        cyberware: [
          { id: "kiroshi-mk2", name: "Kiroshi Mk.2", humanityCost: 4, slot: "eyes" },
          { id: "sandevistan", name: "斯安威斯坦", humanityCost: 12, slot: "os" },
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

  it("humanityStageInfo 返回准确的神经阶段与感知失真阈值（<40）", () => {
    expect(humanityStageInfo(85)).toMatchObject({
      stage: "stable",
      label: "稳定",
      tone: "ok",
      glitchZone: false,
    });
    expect(humanityStageInfo(50)).toMatchObject({
      stage: "detached",
      label: "疏离",
      tone: "ok",
      glitchZone: false,
    });
    expect(humanityStageInfo(35)).toMatchObject({
      stage: "unstable",
      label: "不稳定",
      tone: "warn",
      glitchZone: true,
    });
    expect(humanityStageInfo(12)).toMatchObject({
      stage: "edge",
      label: "边缘",
      tone: "danger",
      glitchZone: true,
    });
    expect(humanityStageInfo(0)).toMatchObject({
      stage: "crisis",
      label: "临界",
      tone: "danger",
      glitchZone: true,
    });
  });
});

describe("分类、随机特质与工坊合并", () => {
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
          custom: true,
        }),
      ),
    ).toBe("custom");
  });

  it("traitCategory 正确识别身心禀赋、专长技艺、过往履历与自定义", () => {
    expect(traitCategory(mod("ice-veins", "skill", ["禀赋"]))).toBe("innate");
    expect(traitCategory(mod("gun", "skill", ["枪械"]))).toBe("craft");
    expect(traitCategory(mod("old-past", "past"))).toBe("past");
    expect(
      traitCategory(
        BoardModuleSchema.parse({
          id: "c",
          slot: "skill",
          label: "自定义",
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
      cyberware: [],
      npcs: [],
    } as unknown as BoardData;
    const localMod = BoardModuleSchema.parse({
      id: "local-1",
      slot: "skill",
      label: "本地",
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
