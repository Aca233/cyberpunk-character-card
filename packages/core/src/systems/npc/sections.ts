import type { SystemSection } from "../../kernel/system";
import { districtResolver, WorldClockStateSchema } from "../world";
import { castSection } from "./prompt";
import { EverydayLifeSchema, NpcCardSchema, NpcStateSchema } from "./schema";

type Raw = Readonly<Record<string, unknown>>;
const isRaw = (v: unknown): v is Raw => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * 势力 id 与人物 id 换成「势力名、态度、成员/靠山关系与内部派系立场」：
 * 人物卡上带着所属势力与内部派系关系，模型演这个人时照着定冷热与口风。
 * 不引势力系统，直接读内容数据的 factions 和势力切片。
 */
function factionResolver(
  data: Raw | undefined,
  slice: unknown,
): ((faction: string, npcId?: string) => string | undefined) | undefined {
  const raw = data?.factions;
  if (!Array.isArray(raw)) return undefined;
  const stances = isRaw(slice) && isRaw(slice.stances) ? slice.stances : {};
  const membership = isRaw(slice) && isRaw(slice.membership) ? slice.membership : null;
  const wingsState = isRaw(slice) && isRaw(slice.wings) ? slice.wings : {};

  const memberFaction =
    membership && typeof membership.faction === "string" ? membership.faction : null;
  const memberRank = membership && typeof membership.rank === "string" ? membership.rank : "";
  const memberSponsor =
    membership && typeof membership.sponsor === "string" ? membership.sponsor : null;
  const memberStrikes = membership && Array.isArray(membership.strikes) ? membership.strikes : [];
  const memberDef = memberFaction
    ? raw.find((f): f is Raw => isRaw(f) && f.id === memberFaction)
    : undefined;
  const memberFactionName =
    memberDef && typeof memberDef.name === "string" ? memberDef.name : memberFaction;

  return (faction, npcId) => {
    const isSponsor = npcId !== undefined && memberSponsor === npcId;
    if (faction === "none") {
      return isSponsor && memberFactionName ? `玩家加入${memberFactionName}的引荐人` : undefined;
    }
    const def = raw.find((f): f is Raw => isRaw(f) && f.id === faction);
    if (!def || typeof def.name !== "string") return undefined;
    const stance = stances[faction];
    const attitude =
      isRaw(stance) && typeof stance.attitude === "string"
        ? stance.attitude
        : typeof def.initial === "string"
          ? def.initial
          : "neutral";
    const parts = [`${def.name}，对玩家 ${attitude}`];
    if (memberFaction === faction) {
      parts.push(
        `同属组织（玩家：${memberRank}${memberStrikes.length > 0 ? `，污点 ${memberStrikes.length}/3` : ""}）`,
      );
    }
    if (isSponsor) parts.push("当年引荐玩家入伙的人");
    if (npcId !== undefined && Array.isArray(def.wings) && def.wings.length > 0) {
      const ws = isRaw(wingsState[faction]) ? wingsState[faction] : null;
      const rulingId =
        ws && typeof ws.ruling === "string"
          ? ws.ruling
          : isRaw(def.wings[0]) && typeof def.wings[0].id === "string"
            ? def.wings[0].id
            : null;
      const playerSide = ws && typeof ws.playerSide === "string" ? ws.playerSide : null;
      const leaderNpc = ws && typeof ws.leaderNpc === "string" ? ws.leaderNpc : null;
      const matchedWing = def.wings.find((w): w is Raw => {
        if (!isRaw(w) || typeof w.id !== "string") return false;
        const leaders = Array.isArray(w.leaders) ? w.leaders : [];
        return leaders.includes(npcId) || (w.id === rulingId && leaderNpc === npcId);
      });
      if (matchedWing && typeof matchedWing.name === "string") {
        const isRuling = matchedWing.id === rulingId;
        const sideNote =
          playerSide === matchedWing.id ? "，与玩家同派" : playerSide ? "，与玩家对立派系" : "";
        parts.push(`属「${matchedWing.name}」${isRuling ? "（当前掌权）" : "（在野）"}${sideNote}`);
      }
    }
    return parts.join("；");
  };
}

/** 把固定街坊资料渲染成自然语言（供 judge/narrate 使用，不灌原始 JSON） */
function formatEverydayCard(card: {
  readonly id: string;
  readonly name: string;
  readonly alias?: string | undefined;
  readonly pronoun: string;
  readonly role: string;
  readonly faction: string;
  readonly age?: number | undefined;
  readonly adult?: boolean | undefined;
  readonly entity?: string | undefined;
  readonly look: string;
  readonly outfit?: string | undefined;
  readonly voice: string;
  readonly samples?: readonly string[] | undefined;
  readonly bio?: string | undefined;
  readonly want: string;
  readonly limit: string;
  readonly secret?: string | undefined;
}): string {
  const identity = [
    card.age !== undefined ? `${card.age}岁` : undefined,
    card.adult === true ? "已确认成年" : card.adult === false ? "未成年" : undefined,
    card.entity === "human"
      ? "真人"
      : card.entity === "synthetic"
        ? "合成人"
        : card.entity === "robot"
          ? "机器人"
          : undefined,
  ].filter(Boolean);
  const parts = [
    `${card.name}${card.alias ? `（外号${card.alias}）` : ""}［${card.id}，${card.pronoun}，${card.role}${card.faction && card.faction !== "none" ? `，势力 ${card.faction}` : ""}］`,
    identity.length > 0 ? `身份：${identity.join("、")}` : undefined,
    `长相：${card.look}`,
    card.outfit ? `穿着：${card.outfit}` : undefined,
    `说话：${card.voice}`,
    card.samples?.length ? `样本：${card.samples.map((s) => `「${s}」`).join(" ")}` : undefined,
    card.bio ? `生平与底色：${card.bio}` : undefined,
    `诉求：${card.want}；底线：${card.limit}`,
    card.secret ? `幕后秘密：${card.secret}` : undefined,
  ].filter(Boolean);
  return parts.join("；");
}

/** 给叙事模型的情境节：【人物】每轮都带，在【当前状态】之后 */
export const npcSections: readonly SystemSection[] = [
  {
    order: 10,
    title: "人物",
    render: ({ world, data, input, stage }) => {
      const clock = WorldClockStateSchema.parse(world.slices.world);
      return castSection(NpcStateSchema.parse(world.slices.npc), {
        location: clock.location,
        sceneStartedAt: clock.sceneStartedAt,
        districtOf: districtResolver(data),
        factionOf: factionResolver(data, world.slices.factions),
        data,
        now: world.time,
        input: input.text,
        stage,
      });
    },
  },
  {
    order: 11,
    title: "街坊与日常来往",
    render: ({ world, data, input, stage }) => {
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
              if (card) {
                lines.push(
                  stage === "extract"
                    ? `固定街坊资料（尚未正式接触，不代表玩家已经知道）：${JSON.stringify(card)}。实际发生实质来往时沿用此 id 与已定资料用 npc 建卡，不重抽陌生人。`
                    : `固定街坊资料（尚未正式接触，不代表玩家已经知道）：${formatEverydayCard(card)}。`,
                );
              }
            }
          }
          for (const service of row.services) {
            lines.push(
              stage === "extract"
                ? `参考服务 ${JSON.stringify(service)}；价格与项目随现场对话确认，谈妥后走 trade，不自动扣款或开启行为芯片。`
                : `参考服务：${service.subject}（${service.scope}，参考价 ${service.price} 欧元，卖方 ${service.seller}）；价格与项目随现场对话确认，不自动成交或开启行为芯片。`,
            );
          }
          lines.push(
            "可以只问候、聊天、买东西或离开；接上已经发生的小事，不强塞委托、危险、关系奖励或私人感情。价格和服务只说明商业来往。",
          );
          return lines.join("\n");
        })
        .join("\n");
    },
  },
];
