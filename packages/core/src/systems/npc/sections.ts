import type { SystemSection } from "../../kernel/system";
import { districtResolver, WorldClockStateSchema } from "../world";
import { castSection } from "./prompt";
import { NpcStateSchema } from "./schema";

type Raw = Readonly<Record<string, unknown>>;
const isRaw = (v: unknown): v is Raw => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * 势力 id 换成「名字，对玩家什么态度」（用户 2026-10-31："势力还是感觉好没存在感"）：
 * 人物卡上带着所属势力现在的态度，模型演这个人时照着定冷热。
 * 不能引势力系统，直接读内容数据的 factions 和势力切片的 stances；态度写势力规则里的那几档 id
 * （kos、hostile、neutral、friendly、family），没变过的按势力卡的 initial；没有势力表时只写 id
 */
function factionResolver(
  data: Raw | undefined,
  slice: unknown,
): ((faction: string) => string | undefined) | undefined {
  const raw = data?.factions;
  if (!Array.isArray(raw)) return undefined;
  const stances = isRaw(slice) && isRaw(slice.stances) ? slice.stances : {};
  return (faction) => {
    const def = raw.find((f): f is Raw => isRaw(f) && f.id === faction);
    if (!def || typeof def.name !== "string") return undefined;
    const stance = stances[faction];
    const attitude =
      isRaw(stance) && typeof stance.attitude === "string"
        ? stance.attitude
        : typeof def.initial === "string"
          ? def.initial
          : "neutral";
    return `${def.name}，对玩家 ${attitude}`;
  };
}

/** 给叙事模型的情境节：【人物】每轮都带，在【当前状态】之后 */
export const npcSections: readonly SystemSection[] = [
  {
    order: 10,
    title: "人物",
    render: ({ world, data }) => {
      const clock = WorldClockStateSchema.parse(world.slices.world);
      return castSection(NpcStateSchema.parse(world.slices.npc), {
        location: clock.location,
        sceneStartedAt: clock.sceneStartedAt,
        districtOf: districtResolver(data),
        factionOf: factionResolver(data, world.slices.factions),
        data,
        now: world.time,
      });
    },
  },
];
