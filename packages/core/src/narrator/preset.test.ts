import { describe, expect, it } from "vitest";
import type { LlmMessage } from "../kernel/ports";
import {
  applyPreset,
  applyPresetRegex,
  expandMacros,
  type MacroContext,
  readTavernPreset,
  type TavernPreset,
} from "./preset";

/** 骰子固定出最大面，结果可复现 */
const ctx: MacroContext = {
  user: "V",
  char: "叙事者",
  lastUserMessage: "进酒吧",
  roll: (sides) => sides,
};

const raw = {
  temperature: 1.09,
  top_p: 0.98,
  top_k: 64,
  openai_max_tokens: 0,
  prompts: [
    { identifier: "main", name: "主提示", role: "system", content: "写得冷一点，{{user}}是主角" },
    { identifier: "chatHistory", name: "聊天记录", marker: true },
    { identifier: "off", name: "关掉的", role: "system", content: "不该出现" },
    { identifier: "empty", name: "空的", role: "system", content: "   " },
    {
      identifier: "deep",
      name: "深度注入",
      role: "user",
      content: "回应：{{lastUserMessage}}",
      injection_position: 1,
      injection_depth: 0,
    },
  ],
  prompt_order: [
    { character_id: 100000, order: [{ identifier: "main", enabled: true }] },
    {
      character_id: 100001,
      order: [
        { identifier: "main", enabled: true },
        { identifier: "chatHistory", enabled: true },
        { identifier: "off", enabled: false },
        { identifier: "empty", enabled: true },
        { identifier: "deep", enabled: true },
      ],
    },
  ],
  extensions: {
    regex_scripts: [
      {
        id: "r1",
        scriptName: "去思维链",
        findRegex: "/<think>[\\s\\S]*?<\\/think>/g",
        replaceString: "",
        placement: [2],
      },
      { id: "r2", scriptName: "只改输入", findRegex: "/a/g", replaceString: "b", placement: [1] },
      {
        id: "r3",
        scriptName: "美化",
        findRegex: "/x/g",
        replaceString: "y",
        placement: [2],
        markdownOnly: true,
      },
      { id: "r4", scriptName: "坏的", findRegex: "/(/g", replaceString: "", placement: [2] },
      {
        id: "r5",
        scriptName: "只改旧楼层",
        findRegex: "/^([\\s\\S]*?)$/",
        replaceString: "",
        placement: [2],
        minDepth: 80,
      },
    ],
    tavern_helper: { scripts: [] },
  },
};

describe("readTavernPreset", () => {
  it("取最长的排序表，跳过 marker 和空条目，带上开关和深度", () => {
    const read = readTavernPreset(raw, "测试预设.json");
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    const { preset, warnings } = read;
    expect(preset.name).toBe("测试预设");
    expect(preset.entries.map((e) => [e.id, e.enabled, e.depth])).toEqual([
      ["main", true, null],
      ["off", false, null],
      ["deep", true, 0],
    ]);
    expect(preset.sampling).toEqual({ temperature: 1.09, topP: 0.98, topK: 64 });
    // 只收 AI 输出的正则；只改显示的默认关；坏的跳过并提醒
    expect(preset.regex.map((r) => [r.id, r.enabled])).toEqual([
      ["r1", true],
      ["r3", false],
      ["r5", false],
    ]);
    expect(warnings.some((w) => w.includes("坏的"))).toBe(true);
    expect(warnings.some((w) => w.includes("酒馆助手"))).toBe(true);
  });

  it("不是聊天补全预设时报错", () => {
    expect(readTavernPreset([], "x").ok).toBe(false);
    expect(readTavernPreset({ name: "卡" }, "x").ok).toBe(false);
  });
});

describe("expandMacros", () => {
  it("展开常用宏，变量只在同一组里有效，不认识的原样留着", () => {
    const vars = new Map<string, string>();
    const out = expandMacros(
      "{{// 注释}}{{setvar::心情::冷}}{{user}}/{{char}}/{{getvar::心情}}/{{roll:2d6+1}}/{{random::甲::乙}}/{{unknown}}",
      ctx,
      vars,
    );
    expect(out).toBe("V/叙事者/冷/13/乙/{{unknown}}");
    expect(expandMacros("前  {{trim}}  后", ctx, vars)).toBe("前后");
    // 酒馆的 {{roll 20}} 不带 d：一颗 20 面
    expect(expandMacros("{{roll 20}}/{{roll:d6}}", ctx, vars)).toBe("20/6");
  });
});

describe("applyPreset", () => {
  const read = readTavernPreset(raw, "测试");
  if (!read.ok) throw new Error(read.error);
  const preset: TavernPreset = read.preset;
  const game: LlmMessage[] = [
    { role: "system", content: "本作规则" },
    { role: "assistant", content: "上一轮" },
    { role: "user", content: "这一轮的输入" },
  ];

  it("预设在前、本作在后，深度条目插进聊天记录且不压过最后一条", () => {
    const out = applyPreset(game, preset, ctx);
    expect(out[0]).toEqual({ role: "system", content: "写得冷一点，V是主角" });
    expect(out[1]?.content).toContain("两边冲突时以下面为准");
    expect(out.slice(2, 4)).toEqual(game.slice(0, 2));
    expect(out.at(-2)).toEqual({ role: "user", content: "回应：进酒吧" });
    expect(out.at(-1)).toEqual(game[2]);
    expect(out.some((m) => m.content.includes("不该出现"))).toBe(false);
  });

  it("条目全关时原样返回", () => {
    const off = { ...preset, entries: preset.entries.map((e) => ({ ...e, enabled: false })) };
    expect(applyPreset(game, off, ctx)).toEqual(game);
  });
});

describe("applyPresetRegex", () => {
  it("只跑开着的正则", () => {
    const read = readTavernPreset(raw, "测试");
    if (!read.ok) throw new Error(read.error);
    expect(applyPresetRegex("<think>想想</think>x正文", read.preset)).toBe("x正文");
  });
});
