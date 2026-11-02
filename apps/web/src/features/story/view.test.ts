import { describe, expect, it } from "vitest";
import { type Speaker, speakersOf, splitSpeakers, type View } from "./view";

/** 正文里可以点的人名和地名（第 3 条，用户定的"本地匹配"，2026-11-02）：只认名字，正文原样不改 */

type Dest = { id: string; name: string; firstVisit: boolean };
type Npc = { id: string; name: string; alias: string | null };

// 只填 speakersOf 要看的字段
const viewOf = (name: string, npcs: Npc[], destinations: Dest[]) =>
  ({ character: { name }, npcs, travel: { destinations } }) as unknown as View;

describe("speakersOf", () => {
  it("人物带 id（连同外号），地点带地点 id，玩家自己两样都没有", () => {
    const list = speakersOf(
      viewOf(
        "V",
        [{ id: "judy", name: "朱迪·阿尔瓦雷兹", alias: "朱迪" }],
        [{ id: "lizzies-bar", name: "丽姿酒吧", firstVisit: false }],
      ),
    );
    const by = new Map(list.map((s) => [s.name, s]));
    expect(by.get("朱迪·阿尔瓦雷兹")?.npc).toBe("judy");
    expect(by.get("朱迪")?.npc).toBe("judy");
    expect(by.get("丽姿酒吧")?.place).toBe("lizzies-bar");
    expect(by.get("丽姿酒吧")?.npc).toBeUndefined();
  });

  it("长的名字排前面，免得短的吃掉长的", () => {
    const list = speakersOf(
      viewOf("瓦伦蒂娜", [{ id: "judy", name: "朱迪·阿尔瓦雷兹", alias: "朱迪" }], []),
    );
    const lengths = list.map((s) => s.name.length);
    expect(lengths).toEqual([...lengths].sort((a, b) => b - a));
  });

  it("同名时人物优先于地点，去过的地点优先于没去过的原作地点", () => {
    const list = speakersOf(
      viewOf(
        "瓦伦蒂娜",
        [{ id: "rogue", name: "罗格", alias: null }],
        [
          { id: "ft:afterlife", name: "来生酒吧", firstVisit: true },
          { id: "afterlife", name: "来生酒吧", firstVisit: false },
          { id: "ft:rogue", name: "罗格", firstVisit: true },
        ],
      ),
    );
    expect(list.filter((s) => s.name === "罗格")).toEqual([
      { name: "罗格", self: false, npc: "rogue" },
    ]);
    expect(list.filter((s) => s.name === "来生酒吧").map((s) => s.place)).toEqual(["afterlife"]);
  });

  it("单个字的名字不标，太容易误伤", () => {
    const list = speakersOf(viewOf("V", [], [{ id: "port", name: "港", firstVisit: false }]));
    expect(list).toEqual([]);
  });
});

describe("splitSpeakers", () => {
  const speakers: Speaker[] = [
    { name: "丽姿酒吧", self: false, place: "lizzies-bar" },
    { name: "朱迪", self: false, npc: "judy" },
    { name: "瓦伦蒂娜", self: true },
  ];

  it("切开以后拼回去和原文一模一样", () => {
    const text = "朱迪在丽姿酒吧的后门等着瓦伦蒂娜，朱迪没说话。";
    expect(
      splitSpeakers(text, speakers)
        .map((p) => p.text)
        .join(""),
    ).toBe(text);
  });

  it("名字片段带上人物或地点的 id", () => {
    const parts = splitSpeakers("朱迪去了丽姿酒吧", speakers);
    expect(parts.map((p) => [p.text, p.speaker?.npc ?? p.speaker?.place ?? null])).toEqual([
      ["朱迪", "judy"],
      ["去了", null],
      ["丽姿酒吧", "lizzies-bar"],
    ]);
  });
});
