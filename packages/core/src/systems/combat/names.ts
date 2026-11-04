import type { Rng } from "../../kernel/ports";

/** 夜之城街头的名和姓：给没名没姓的死者、等他回家的人起名（暂定，可以往里加） */
const GIVEN = [
  "马科",
  "丽塔",
  "何塞",
  "阿奈",
  "德米特里",
  "米娅",
  "胡安",
  "卡拉",
  "健二",
  "莉娜",
  "奥马尔",
  "苏菲",
  "拉蒙",
  "艾薇",
  "托马斯",
  "妮可",
] as const;

const FAMILY = [
  "冈萨雷斯",
  "沃克",
  "佐藤",
  "伊万诺夫",
  "陈",
  "奥孔科",
  "里维拉",
  "金",
  "费雷拉",
  "哈桑",
  "米勒",
  "阮",
] as const;

const at = <T>(list: readonly T[], rng: Rng): T =>
  list[rng.roll(list.length) - 1] ?? (list[0] as T);

/** 起一个全名；family 给了就沿用这个姓（死者的家里人跟他同姓） */
export function pickName(rng: Rng, family?: string): string {
  return `${at(GIVEN, rng)}·${family ?? at(FAMILY, rng)}`;
}

/** 从全名里取姓；取不到就是 undefined */
export function familyOf(name: string): string | undefined {
  const i = name.lastIndexOf("·");
  return i < 0 ? undefined : name.slice(i + 1);
}
