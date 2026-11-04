import {
  BoardModuleSchema,
  BoardSchema,
  type CharacterCard,
  ComboSchema,
  LifepathEntrySchema,
  SKILL_MAX,
} from "@cp/core";
import { describe, expect, it } from "vitest";
import {
  applyOriginPreset,
  attributeReliance,
  budgetKind,
  comboHints,
  creatorChecks,
  isAnyOriginPreset,
  isOriginPreset,
  ORIGIN_KEYS,
  ORIGIN_PRESETS,
  originLean,
  originNever,
  recommendAttributes,
} from "./creator";

/** 第 5 步（计划第 5 步："每项属性标出你插的本事里有几块靠它"，加一键推荐分配） */
describe("attributeReliance / recommendAttributes", () => {
  const skill = (id: string, checks: string[]) =>
    BoardModuleSchema.parse({ id, slot: "skill", label: id, points: 1, checks });
  const total = (a: Record<string, number>) => Object.values(a).reduce((s, v) => s + v, 0);

  it("按模块的 checks 归到属性上", () => {
    const board = BoardSchema.parse({
      skills: [skill("gun", ["reflexes"]), skill("net", ["intelligence", "tech"])],
    });
    const r = attributeReliance(board);
    expect(r.reflexes.map((m) => m.id)).toEqual(["gun"]);
    expect(r.tech.map((m) => m.id)).toEqual(["net"]);
    expect(r.body).toEqual([]);
  });

  it("7 点分完、单项不过 6，靠得多的那项分得多", () => {
    const board = BoardSchema.parse({
      skills: [skill("a", ["reflexes"]), skill("b", ["reflexes"]), skill("c", ["cool"])],
    });
    const a = recommendAttributes(board);
    expect(total(a)).toBe(15 + 7);
    expect(Math.max(...Object.values(a))).toBeLessThanOrEqual(6);
    expect(a.reflexes).toBeGreaterThanOrEqual(a.cool);
    expect(a.cool).toBeGreaterThan(a.body);
  });

  it("没有本事写 checks 时平均分", () => {
    const a = recommendAttributes(BoardSchema.parse({}));
    expect(total(a)).toBe(15 + 7);
    expect(Math.max(...Object.values(a)) - Math.min(...Object.values(a))).toBeLessThanOrEqual(1);
  });
});

/** 分步捏人的纯逻辑（docs/creator-plan.md 分期第 1 条）：不碰界面和 localStorage */

const mod = (id: string, slot: "origin" | "past" | "skill" | "flaw", tags: string[] = []) =>
  BoardModuleSchema.parse({ id, slot, label: id, points: slot === "origin" ? 0 : 1, tags });

describe("budgetKind", () => {
  // 本事和义体拆成两步（用户 2026-10-31："本事和义体分开两块"），两步都显示背景点
  it("背景点只在过往、旧识、本事、义体四步，属性点只在属性那步", () => {
    expect(budgetKind("origin")).toBeNull();
    expect(budgetKind("past")).toBe("background");
    expect(budgetKind("people")).toBe("background");
    expect(budgetKind("skills")).toBe("background");
    expect(budgetKind("cyberware")).toBe("background");
    expect(budgetKind("attributes")).toBe("attributes");
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
    expect(checks.find((c) => c.text === "尚未命名")?.step).toBe("origin");
    expect(checks.find((c) => c.text === "尚未设定代词")?.step).toBe("origin");
  });
});

describe("ORIGIN_PRESETS and applyOriginPreset", () => {
  const streetMod = mod("street-kid", "origin");
  const past1 = mod("gang-runner", "past");
  const past2 = mod("clinic-apprentice", "past");
  const past3 = mod("pit-fighter", "past");
  const skill1 = mod("brawling", "skill", ["近战", "格斗"]);
  const skill2 = mod("lockpick", "skill");
  const skill3 = mod("streetwise", "skill");
  const allMods = [streetMod, past1, past2, past3, skill1, skill2, skill3];

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

  it("各出身预设的属性点总消耗严格等于 7", () => {
    for (const key of ORIGIN_KEYS) {
      const preset = ORIGIN_PRESETS[key];
      const spent = Object.values(preset.attributes).reduce((s, v) => s + (v - 3), 0);
      expect(spent).toBe(7);
      expect(preset.pasts).toHaveLength(3);
      expect(preset.skills).toHaveLength(3);
    }
  });

  it("一键载入街头小子预设，生成完整的过往、特长和属性分配", () => {
    const updated = applyOriginPreset("street-kid", blankCard, allMods, []);
    expect(updated.origin).toBe("street-kid");
    expect(updated.board?.origin?.id).toBe("street-kid");
    expect(updated.board?.pasts.map((p) => p.id)).toEqual([
      "gang-runner",
      "clinic-apprentice",
      "pit-fighter",
    ]);
    expect(updated.board?.skills.map((s) => s.id)).toEqual(["brawling", "lockpick", "streetwise"]);
    expect(updated.attributes).toEqual(ORIGIN_PRESETS["street-kid"].attributes);
    if (!updated.board) throw new Error("board should be defined");
    expect(isOriginPreset("street-kid", updated.board)).toBe(true);
    expect(isAnyOriginPreset(updated.board)).toBe(true);
  });
});
