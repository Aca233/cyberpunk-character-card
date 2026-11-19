import type { SystemSection } from "../../kernel/system";
import { districtResolver, WorldClockStateSchema } from "../world";
import { castSection } from "./prompt";
import { EverydayLifeSchema, NpcCardSchema, NpcStateSchema } from "./schema";

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
    render: ({ world, data, input }) => {
      const clock = WorldClockStateSchema.parse(world.slices.world);
      return castSection(NpcStateSchema.parse(world.slices.npc), {
        location: clock.location,
        sceneStartedAt: clock.sceneStartedAt,
        districtOf: districtResolver(data),
        factionOf: factionResolver(data, world.slices.factions),
        data,
        now: world.time,
        input: input.text,
      });
    },
  },
  {
    order: 11,
    title: "街坊与日常来往",
    render: ({ world, data, input }) => {
      const rows = EverydayLifeSchema.safeParse(data?.everydayLife);
      if (!rows.success) return undefined;
      const clock = WorldClockStateSchema.parse(world.slices.world);
      const state = NpcStateSchema.parse(world.slices.npc);
      const people = NpcCardSchema.array().safeParse(data?.everydayPeople);
      const cards = people.success ? people.data : [];
      const cardById = new Map(cards.map((card) => [card.id, card]));
      const relevant = rows.data.filter(
        (row) =>
          row.location === clock.location ||
          row.people.some((id) => {
            const name = cardById.get(id)?.name;
            return input.text.includes(id) || (name !== undefined && input.text.includes(name));
          }),
      );
      if (!relevant.length) return undefined;
      return relevant
        .map((row) => {
          const lines = [`场所 ${row.id}［${row.location}］：${row.note}`];
          for (const id of row.people) {
            const person = state.npcs[id];
            if (person) {
              lines.push(
                `沿用人物 ${id}（${person.name}）；实际位置、近况、身体与共同记忆以人物卡为准，不因重访刷新人和关系。`,
              );
            } else {
              const card = cardById.get(id);
              if (card)
                lines.push(
                  `固定街坊资料（尚未正式接触，不代表玩家已经知道）：${JSON.stringify(card)}。实际发生实质来往时沿用此 id 与已定资料用 npc 建卡，不重抽陌生人。`,
                );
            }
          }
          for (const service of row.services)
            lines.push(
              `已定日常服务参考 ${JSON.stringify(service)}；这些是店内参考条件，实际本人是否有空、是否接受及本次最终条件由对话确认。先 commerce.offer，再由玩家接受 trade；不是已经消费、启用设备或同意记录。`,
            );
          lines.push(
            "可以只问候、聊天、买东西或离开；接上已经发生的小事，不强塞委托、危险、关系奖励或私人感情。价格和服务只说明商业来往。",
          );
          return lines.join("\n");
        })
        .join("\n");
    },
  },
];
