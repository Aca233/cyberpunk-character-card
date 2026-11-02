import { produce } from "immer";
import { describe, expect, it } from "vitest";
import { applyNpc, currentOutfit } from "./apply";
import { castSection } from "./prompt";
import { type Npc, NpcSchema, type NpcState } from "./schema";

/** 长相 + 当前穿着（用户定的，2026-11-02） */

function npc(extra: Partial<Npc> = {}): Npc {
  return NpcSchema.parse({
    id: "judy",
    name: "朱迪",
    pronoun: "她",
    role: "超梦剪辑师",
    look: "头发一侧剃短",
    voice: "直来直去",
    want: "靠手艺活着",
    limit: "欺负玩偶",
    affinity: 0,
    alive: true,
    met: true,
    location: "lizzies-bar",
    lastSeenAt: 0,
    memories: [],
    ...extra,
  });
}

const stage = { location: "lizzies-bar", sceneStartedAt: 0 };

describe("npcOutfit", () => {
  it("换装后现在穿的跟着变，长相不动", () => {
    const state: NpcState = { npcs: { judy: npc({ outfit: "工装背带裤" }) } };
    const next = produce(state, (d) => {
      expect(applyNpc(d, { type: "npcOutfit", id: "judy", text: "潜水服" }, 30).ok).toBe(true);
    });
    const judy = next.npcs.judy as Npc;
    expect(currentOutfit(judy)).toBe("潜水服");
    expect(judy.wearing).toEqual({ text: "潜水服", at: 30 });
    expect(judy.look).toBe("头发一侧剃短");
  });

  it("和现在穿的一样就不记", () => {
    const state: NpcState = { npcs: { judy: npc({ outfit: "工装背带裤" }) } };
    const next = produce(state, (d) => {
      applyNpc(d, { type: "npcOutfit", id: "judy", text: "工装背带裤" }, 30);
    });
    expect(next.npcs.judy?.wearing).toBeNull();
  });

  it("死了的人不能换装", () => {
    const state: NpcState = { npcs: { judy: npc({ alive: false }) } };
    produce(state, (d) => {
      expect(applyNpc(d, { type: "npcOutfit", id: "judy", text: "潜水服" }, 30).ok).toBe(false);
    });
  });
});

describe("人物卡上的样子", () => {
  it("有穿着时分「长相」「现在穿」两行", () => {
    const text = castSection({ npcs: { judy: npc({ outfit: "工装背带裤" }) } }, stage);
    expect(text).toContain("长相：头发一侧剃短");
    expect(text).toContain("现在穿：工装背带裤");
    expect(text).not.toContain("外貌：");
  });

  it("旧卡没有穿着时照旧一行「外貌」", () => {
    const text = castSection({ npcs: { judy: npc() } }, stage);
    expect(text).toContain("外貌：头发一侧剃短");
    expect(text).not.toContain("现在穿");
  });
});
