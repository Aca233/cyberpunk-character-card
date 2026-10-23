import type { Rng } from "./ports";

/** 可复现的伪随机骰子（mulberry32），用于测试和测评 */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return {
    roll(sides) {
      assertSides(sides);
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      const u = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      return Math.floor(u * sides) + 1;
    },
  };
}

/** 按给定顺序出骰，用完就报错；用于固定骰子的单元测试和测评用例 */
export function fixedRng(values: readonly number[]): Rng {
  let i = 0;
  return {
    roll(sides) {
      assertSides(sides);
      const v = values[i];
      if (v === undefined) throw new Error(`固定骰子已用完（共 ${values.length} 个）`);
      if (!Number.isInteger(v) || v < 1 || v > sides) {
        throw new Error(`第 ${i + 1} 个固定骰子 ${v} 不在 1–${sides} 之间`);
      }
      i += 1;
      return v;
    },
  };
}

function assertSides(sides: number): void {
  if (!Number.isInteger(sides) || sides < 2) {
    throw new Error(`骰子面数必须是不小于 2 的整数：${sides}`);
  }
}
