import type { Draft } from "immer";
import type { ApplyOutcome } from "../../kernel/system";
import {
  type CharacterState,
  DEED_REACH_LABELS,
  DEEDS_MAX,
  type DeedReach,
  type KnownDeed,
  type RecordDeed,
  type ReputationCommand,
  type SetCharacter,
} from "./schema";

const REACH_RANK: Readonly<Record<DeedReach, number>> = {
  local: 1,
  district: 2,
  city: 3,
};

/** 界面与叙事用的极简名声概括：纯由外界记住的事迹推导，不引入等级或分数 */
export interface ReputationOverview {
  readonly label: string;
  readonly world: string;
}

export function reputationOverview(deeds: readonly KnownDeed[]): ReputationOverview {
  if (deeds.length === 0) {
    return {
      label: "籍籍无名",
      world: "街上还没传开你的事；陌生人只看穿着、义体与眼前做派",
    };
  }
  const cityCount = deeds.filter((d) => d.reach === "city").length;
  const districtCount = deeds.filter((d) => d.reach === "district").length;
  const latest = deeds[deeds.length - 1];
  const latestBrief = latest ? `最新传开的是「${latest.summary}」` : "";

  if (cityCount >= 2) {
    return {
      label: "全城皆知",
      world: `你的事迹已在夜之城多处传开（${latestBrief}），不同圈子按各自听到的版本看待你`,
    };
  }
  if (cityCount === 1) {
    return {
      label: "城中热议",
      world: `至少有一件事闹得全城都在议论（${latestBrief}），知情者和媒体都在留意你的动向`,
    };
  }
  if (districtCount > 0) {
    const districts = [
      ...new Set(deeds.filter((d) => d.reach === "district" && d.district).map((d) => d.district)),
    ];
    const area = districts.length > 0 ? districts.join("、") : "几个街区";
    return {
      label: "城区有名",
      world: `${area}一带流传着你干过的事（${latestBrief}），当地混混、店东和中间人更可能听过你的名号`,
    };
  }
  return {
    label: "圈内有风声",
    world: `只在亲历者或小圈子里有你的风声（${latestBrief}），出了圈子大多数人还不认得你`,
  };
}

/** 比较单条事迹范围是否达到偶遇等需要的门槛 */
export function hasDeedAtLeast(
  deeds: readonly KnownDeed[],
  minReach: DeedReach,
  district?: string,
): boolean {
  const target = REACH_RANK[minReach];
  return deeds.some((d) => {
    if (REACH_RANK[d.reach] < target) return false;
    if (d.reach === "city" || !district) return true;
    return !d.district || d.district === district;
  });
}

/** 格式化单条事迹，给模型或界面直接阅读 */
export function formatDeed(deed: KnownDeed): string {
  const scope =
    deed.reach === "city"
      ? DEED_REACH_LABELS.city
      : deed.district
        ? `${deed.district}·${DEED_REACH_LABELS[deed.reach]}`
        : DEED_REACH_LABELS[deed.reach];
  const who = deed.knownBy.length > 0 ? `；知情圈子：${deed.knownBy.join("、")}` : "";
  return `${deed.summary}（${scope}${who}）`;
}

/** 建档：写入角色，外界事迹从空开始 */
export function setCharacter(draft: Draft<CharacterState>, command: SetCharacter): ApplyOutcome {
  draft.name = command.name;
  draft.brief = command.brief;
  if (command.visual !== undefined) draft.visual = { ...command.visual };
  else delete draft.visual;
  draft.deeds = [];
  draft.traits = (command.traits ?? []).map((t) => ({ ...t }));
  draft.flashbackUsed = [];
  draft.flashback = null;
  draft.pastFacts = [];
  if (command.portrait) draft.portrait = command.portrait;
  else delete draft.portrait;
  if (command.replacesNpcId) draft.replacesNpcId = command.replacesNpcId;
  else delete draft.replacesNpcId;
  return { ok: true };
}

function mergeKnownBy(existing: readonly string[], incoming: readonly string[]): string[] {
  const merged: string[] = [];
  for (const item of [...existing, ...incoming]) {
    const trimmed = item.trim();
    if (!trimmed || merged.includes(trimmed)) continue;
    merged.push(trimmed);
    if (merged.length >= 4) break;
  }
  return merged;
}

/** 登记或更新外界知道你干过的一件事：同一 id 再次上报会升级传播范围/更新说法，不重复记账 */
export function recordDeed(
  draft: Draft<CharacterState>,
  command: Pick<
    ReputationCommand | RecordDeed,
    "id" | "summary" | "knownBy" | "reach" | "district"
  >,
  now: number,
): ApplyOutcome {
  const id = command.id.trim();
  const summary = command.summary.trim();
  const reach: DeedReach = command.reach ?? "local";
  const district = reach === "city" ? undefined : command.district?.trim() || undefined;
  const knownBy = mergeKnownBy([], command.knownBy ?? []);

  const idx = draft.deeds.findIndex((d) => d.id === id);
  if (idx >= 0) {
    const prev = draft.deeds[idx];
    if (!prev) return { ok: true };
    const nextReach: DeedReach = REACH_RANK[reach] >= REACH_RANK[prev.reach] ? reach : prev.reach;
    const nextDistrict = nextReach === "city" ? undefined : (district ?? prev.district);
    const nextKnownBy = mergeKnownBy(prev.knownBy, knownBy);
    const changed =
      prev.summary !== summary ||
      prev.reach !== nextReach ||
      prev.district !== nextDistrict ||
      nextKnownBy.length !== prev.knownBy.length;
    prev.summary = summary;
    prev.reach = nextReach;
    if (nextDistrict !== undefined) prev.district = nextDistrict;
    else delete prev.district;
    prev.knownBy = nextKnownBy;
    prev.updatedAt = now;
    if (!changed) return { ok: true };
    // 移至末尾，保持最近更新在后
    draft.deeds.splice(idx, 1);
    draft.deeds.push(prev);
    return {
      ok: true,
      notes: [`外界风声更新（${DEED_REACH_LABELS[nextReach]}）：${summary}`],
    };
  }

  const next: KnownDeed = {
    id,
    summary,
    knownBy,
    reach,
    ...(district !== undefined ? { district } : {}),
    at: now,
    updatedAt: now,
  };
  draft.deeds.push(next);
  while (draft.deeds.length > DEEDS_MAX) {
    // 优先淘汰最早的局部风声，尽量保留全城/城区级大事
    const dropIdx = draft.deeds.findIndex((d) => d.reach === "local");
    draft.deeds.splice(Math.max(dropIdx, 0), 1);
  }
  return {
    ok: true,
    notes: [`外界传开（${DEED_REACH_LABELS[reach]}）：${summary}`],
  };
}
