import { randomInt } from "node:crypto";
import type { Rng } from "@cp/core";

/** 真随机骰子：玩家的检定都用它 */
export const cryptoRng: Rng = {
  roll(sides) {
    if (!Number.isInteger(sides) || sides < 2) throw new Error(`骰子面数不对：${sides}`);
    return randomInt(1, sides + 1);
  },
};
