/** 中间人自动登记（用户定的，2026-10-30："llm 也要能生成中间人"）：有人物卡就能派单，没卡、死了的照旧拒收 */
import { describe, expect, it } from "vitest";
import { type FixerCard, offerJob } from "./apply";
import type { JobOffer, JobsState } from "./schema";

const offer = (fixer: string | undefined, risk = 1): JobOffer => ({
  type: "jobOffer",
  id: `job-${fixer ?? "none"}-${risk}`,
  title: "测试委托",
  ...(fixer === undefined ? {} : { fixer }),
  client: "身份不明",
  risk,
  reward: 1000,
  conflict: "有人想要，有人不给",
});

const empty = (): JobsState => ({ fixers: {}, jobs: [] });

const cards: Record<string, FixerCard> = {
  rogue: { name: "罗格", alive: true, affinity: 0 },
  ghost: { name: "死掉的中间人", alive: false, affinity: 50 },
  liked: { name: "老熟人", alive: true, affinity: 45 },
};
const cardOf = (id: string) => cards[id];

describe("offerJob 登记中间人", () => {
  it("没登记但有活人物卡的：登记成中间人，委托挂出", () => {
    const state = empty();
    const result = offerJob(state, offer("rogue"), 0, cardOf);
    expect(result.ok).toBe(true);
    expect(state.fixers.rogue).toEqual({ id: "rogue", name: "罗格" });
    expect(state.jobs[0]?.fixer).toBe("rogue");
    if (result.ok) expect(result.notes).toContain("登记中间人：罗格");
  });

  it("新中间人可以基于实际引荐托付高危约定，不按星级锁定", () => {
    const state = empty();
    const result = offerJob(state, offer("rogue", 3), 0, cardOf);
    expect(result.ok).toBe(true);
    expect(state.jobs[0]?.risk).toBe(3);
  });

  it("已有交往的人可按实际需求托付高危约定", () => {
    const state = empty();
    expect(offerJob(state, offer("liked", 4), 0, cardOf).ok).toBe(true);
  });

  it("没有人物卡的：拒收，提示先用 npc 建卡", () => {
    const result = offerJob(empty(), offer("nobody"), 0, cardOf);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("先用 npc");
  });

  it("人物卡死了的：拒收", () => {
    const state = empty();
    expect(offerJob(state, offer("ghost"), 0, cardOf).ok).toBe(false);
    expect(state.fixers.ghost).toBeUndefined();
  });

  it("已经登记的中间人不重复登记", () => {
    const state: JobsState = { fixers: { rogue: { id: "rogue", name: "罗格" } }, jobs: [] };
    const result = offerJob(state, offer("rogue"), 0, cardOf);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.notes?.some((n) => n.startsWith("登记中间人"))).toBe(false);
  });

  it("登记过的中间人死亡后不能继续发出新委托", () => {
    const state = empty();
    expect(offerJob(state, offer("rogue"), 0, cardOf).ok).toBe(true);
    const before = JSON.stringify(state);
    const result = offerJob(state, offer("rogue", 2), 100, (id) =>
      id === "rogue" ? { name: "罗格", alive: false, affinity: 50 } : cardOf(id),
    );
    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining("已经死了") });
    expect(JSON.stringify(state)).toBe(before);
  });

  it("不写 fixer 的熟人求助照旧", () => {
    const state = empty();
    expect(offerJob(state, offer(undefined, 5), 0, cardOf).ok).toBe(true);
    expect(state.fixers).toEqual({});
  });
});
