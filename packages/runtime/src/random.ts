import type { Rng } from "@cp/core";

/** 随机数都走 Web Crypto（Node 19+ 和浏览器都有 globalThis.crypto），不用 node:crypto */

/** n 个随机字节的十六进制，用在存档、角色卡、预设的 id 里 */
export function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function randomId(): string {
  return globalThis.crypto.randomUUID();
}

/** [min, max) 里均匀的整数；拒绝采样，不偏向小数 */
export function randomInt(min: number, max: number): number {
  const range = max - min;
  if (!Number.isInteger(min) || !Number.isInteger(max) || range < 1 || range > 2 ** 32) {
    throw new Error(`随机数范围不对：${min}..${max}`);
  }
  const limit = 2 ** 32 - (2 ** 32 % range);
  const buf = new Uint32Array(1);
  for (;;) {
    globalThis.crypto.getRandomValues(buf);
    const value = buf[0] as number;
    if (value < limit) return min + (value % range);
  }
}

/** 真随机骰子：玩家的检定都用它 */
export const cryptoRng: Rng = {
  roll(sides) {
    if (!Number.isInteger(sides) || sides < 2) throw new Error(`骰子面数不对：${sides}`);
    return randomInt(1, sides + 1);
  },
};
