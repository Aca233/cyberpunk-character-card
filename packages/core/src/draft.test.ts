import { describe, expect, it } from "vitest";
import {
  buildDraftPrompt,
  DraftRequestSchema,
  draftProblem,
  draftTargets,
  ProseCardSchema,
  splitDraft,
} from "./narrator/prose";
import { BoardSchema } from "./schemas/board";
import { PROSE_BLOCK_INFO } from "./schemas/character";

/** 一键成稿（第三期，用户定的 2026-10-30："加一键成稿"）：拆输出、锁定当定稿、补旧识 */

const L = (b: keyof typeof PROSE_BLOCK_INFO) => PROSE_BLOCK_INFO[b].label;

const board = BoardSchema.parse({
  acquaintances: [
    { id: "npc-a", name: "阿甲", relation: "friend" },
    { id: "npc-b", name: "阿乙", relation: "grudge", note: "抢过他的货" },
    { id: "npc-c", name: "阿丙", relation: "owesYou" },
  ],
});

const card = (extra: Record<string, unknown> = {}) =>
  ProseCardSchema.parse({ name: "林", board, ...extra });

describe("一键成稿", () => {
  it("按【】标记拆出四块，补空着的旧识，按编号和名字都认", () => {
    const out = [
      `【${L("look")}】`,
      "左手小指是便宜货义体。",
      `【${L("past")}（旧稿）】`,
      "在沃森还了三年账。",
      `【${L("personality")}】`,
      "不欠人情。",
      `【${L("voice")}】`,
      "话少。",
      "【旧识】",
      "1：一起在诊所打过工",
      "- 阿丙：替他扛过一次黑锅",
      "2：不该被写",
    ].join("\n");
    const r = splitDraft(out, card());
    expect(r.blocks).toEqual({
      look: "左手小指是便宜货义体。",
      past: "在沃森还了三年账。",
      personality: "不欠人情。",
      voice: "话少。",
    });
    // 阿乙原来写了，不在要补的名单里；编号按要补的名单数
    expect(r.notes).toEqual({ "npc-a": "一起在诊所打过工", "npc-c": "替他扛过一次黑锅" });
    expect(r.cut).toEqual([]);
  });

  it("锁定的区块写了也不要，超字数截短并报出来", () => {
    const long = "字".repeat(PROSE_BLOCK_INFO.voice.max + 5);
    const c = card({ locked: ["look"], look: "定稿外貌" });
    const r = splitDraft(`【${L("look")}】\n别的外貌\n【${L("voice")}】\n${long}`, c);
    expect(r.blocks.look).toBeUndefined();
    expect(r.blocks.voice).toHaveLength(PROSE_BLOCK_INFO.voice.max);
    expect(r.cut).toEqual(["voice"]);
  });

  it("没有标记就拆不出东西", () => {
    expect(splitDraft("随便写了一段", card())).toEqual({ blocks: {}, notes: {}, cut: [] });
  });

  it("提示词：定稿当硬约束、只要求写没锁定的，带上要补的旧识", () => {
    const c = card({ locked: ["look"], look: "定稿外貌" });
    expect(draftTargets(c)).toEqual(["past", "personality", "voice"]);
    const [system, user] = buildDraftPrompt(DraftRequestSchema.parse({ card: c }));
    expect(system?.content).not.toContain(`【${L("look")}】\n`);
    expect(system?.content).toContain("【旧识】");
    expect(user?.content).toContain(`【${L("look")}（定稿）】\n定稿外貌`);
    expect(user?.content).toContain("1：阿甲，老朋友");
    expect(user?.content).toContain("2：阿丙，他欠你人情");
    expect(user?.content).not.toContain("阿乙，旧仇");
  });

  it("四块都锁定、旧识都写了，就不调模型", () => {
    const full = BoardSchema.parse({
      acquaintances: [{ id: "npc-b", name: "阿乙", relation: "grudge", note: "抢过货" }],
    });
    const c = ProseCardSchema.parse({
      name: "林",
      board: full,
      locked: ["look", "past", "personality", "voice"],
    });
    expect(draftProblem(DraftRequestSchema.parse({ card: c }))).not.toBeNull();
    expect(draftProblem(DraftRequestSchema.parse({ card: card() }))).toBeNull();
  });
});
