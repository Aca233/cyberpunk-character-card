import { describe, expect, it } from "vitest";
import { fixedRng, seededRng } from "./rng";

describe("fixedRng", () => {
  it("按顺序出骰，用完报错", () => {
    const rng = fixedRng([3, 6]);
    expect(rng.roll(6)).toBe(3);
    expect(rng.roll(6)).toBe(6);
    expect(() => rng.roll(6)).toThrow(/用完/);
  });

  it("拒绝超出面数的值和非法面数", () => {
    expect(() => fixedRng([7]).roll(6)).toThrow(/不在 1–6 之间/);
    expect(() => fixedRng([1]).roll(1)).toThrow(/面数/);
  });
});

describe("seededRng", () => {
  it("同一个种子出同样的序列，且都在范围内", () => {
    const a = seededRng(2077);
    const b = seededRng(2077);
    const rollsA = Array.from({ length: 200 }, () => a.roll(10));
    const rollsB = Array.from({ length: 200 }, () => b.roll(10));
    expect(rollsA).toEqual(rollsB);
    expect(rollsA.every((v) => v >= 1 && v <= 10)).toBe(true);
    expect(new Set(rollsA).size).toBe(10);
  });
});
