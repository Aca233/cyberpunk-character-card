import type { Draft } from "immer";
import type { ApplyOutcome, SystemContext } from "../../kernel/system";
import { type FactionNpcRef, readNpcMap } from "./npcs";
import {
  ATTITUDE_MAX_STEP,
  ATTITUDES,
  type Attitude,
  attitudeLabel,
  FACTION_DEFAULT_RANKS,
  FactionCatalogSchema,
  type FactionCommand,
  type FactionDef,
  type FactionSeed,
  type FactionsState,
  MAX_FACTION_STRIKES,
} from "./schema";
import { currentTurf } from "./turf";

const catalogs = new WeakMap<object, ReadonlyMap<string, FactionDef>>();

/** 读取并校验势力表；没有势力表时是空表 */
export function factionCatalog(
  data: Readonly<Record<string, unknown>>,
): ReadonlyMap<string, FactionDef> {
  const raw = data.factions;
  if (typeof raw !== "object" || raw === null) return new Map();
  const cached = catalogs.get(raw);
  if (cached) return cached;
  const catalog = new Map(FactionCatalogSchema.parse(raw).map((f) => [f.id, f] as const));
  catalogs.set(raw, catalog);
  return catalog;
}

/** 现在的态度：变过的按记录，没变过的按势力卡 */
export function currentAttitude(state: FactionsState, def: FactionDef): Attitude {
  return state.stances[def.id]?.attitude ?? def.initial;
}

/** 对头连带降档最低降到这一档（暂定，试玩时调） */
export const RIVAL_FLOOR: Attitude = "hostile";

const fail = (reason: string): ApplyOutcome => ({ ok: false, reason });

function pushRivalFallout(
  draft: Draft<FactionsState>,
  def: FactionDef,
  catalog: ReadonlyMap<string, FactionDef>,
  now: number,
  reason: string,
  notes: string[],
  floor: Attitude = RIVAL_FLOOR,
): void {
  const floorIdx = ATTITUDES.indexOf(floor);
  for (const id of def.enemies) {
    const rival = catalog.get(id);
    if (!rival || rival.id === def.id) continue;
    const was = currentAttitude(draft as FactionsState, rival);
    const at = ATTITUDES.indexOf(was);
    if (at <= floorIdx) continue;
    const next = ATTITUDES[Math.max(floorIdx, at - 1)];
    if (next === undefined || next === was) continue;
    draft.stances[rival.id] = { attitude: next, reason, at: now };
    notes.push(
      `${rival.name}：${attitudeLabel(rival.kind, was)} → ${attitudeLabel(rival.kind, next)}（${reason}）`,
    );
  }
}

function pushAllyChill(
  draft: Draft<FactionsState>,
  def: FactionDef,
  catalog: ReadonlyMap<string, FactionDef>,
  now: number,
  reason: string,
  notes: string[],
): void {
  for (const allyId of def.allies) {
    const ally = catalog.get(allyId);
    if (!ally || ally.id === def.id) continue;
    const was = currentAttitude(draft as FactionsState, ally);
    const at = ATTITUDES.indexOf(was);
    if (at <= ATTITUDES.indexOf("neutral")) continue;
    const next = ATTITUDES[at - 1];
    if (!next) continue;
    draft.stances[ally.id] = { attitude: next, reason, at: now };
    notes.push(
      `${ally.name}：${attitudeLabel(ally.kind, was)} → ${attitudeLabel(ally.kind, next)}（${reason}）`,
    );
  }
}

function readLiveNpcs(ctx: SystemContext): ReadonlyMap<string, FactionNpcRef> {
  try {
    return readNpcMap(ctx.read("npc"));
  } catch {
    return new Map();
  }
}

/** 人物死亡信号联动：靠山身亡自动标记帮内失势；派系当前主领袖身亡自动进入权力真空/动荡 */
export function onNpcDied(draft: Draft<FactionsState>, ctx: SystemContext): void {
  const npcs = readLiveNpcs(ctx);
  if (npcs.size === 0) return;

  // 1. 玩家的入帮靠山死了
  if (draft.membership?.sponsor && !draft.membership.sponsorLost) {
    const sponsor = npcs.get(draft.membership.sponsor);
    if (sponsor && !sponsor.alive) {
      draft.membership.sponsorLost = true;
    }
  }

  // 2. 大势力掌权派系的领头人死了 → 自动置为权力真空/动荡
  const catalog = factionCatalog(ctx.data);
  for (const def of catalog.values()) {
    if (def.wings.length === 0) continue;
    const cur = draft.wings[def.id];
    const rulingId = cur?.ruling ?? def.wings[0]?.id;
    if (!rulingId) continue;
    const wingDef = def.wings.find((w) => w.id === rulingId) ?? def.wings[0];
    if (!wingDef) continue;
    const primaryId = cur?.leaderNpc ?? wingDef.leaders[0];
    if (!primaryId) continue;
    const primary = npcs.get(primaryId);
    if (primary && !primary.alive && !cur?.vacant) {
      draft.wings[def.id] = {
        ruling: rulingId,
        leaderNpc: primaryId,
        vacant: true,
        ...(cur?.playerSide ? { playerSide: cur.playerSide } : {}),
        note: `${primary.name}身亡，${wingDef.name}群龙无首、内部动荡`,
        at: ctx.now,
      };
    }
  }
}

/** 建档初始化时写入出身初始态度（不触发对头连带降档） */
export function applyFactionSeed(
  draft: Draft<FactionsState>,
  command: FactionSeed,
  ctx: SystemContext,
): ApplyOutcome {
  const catalog = factionCatalog(ctx.data);
  if (!catalog.has(command.id)) return fail(`势力表里没有 ${command.id}`);
  draft.stances[command.id] = {
    attitude: command.attitude,
    reason: command.reason,
    at: ctx.now,
  };
  return { ok: true };
}

export function applyFaction(
  draft: Draft<FactionsState>,
  command: FactionCommand,
  ctx: SystemContext,
): ApplyOutcome {
  const catalog = factionCatalog(ctx.data);
  const def = catalog.get(command.id);
  if (!def) return fail(`势力表里没有 ${command.id}；现有：${[...catalog.keys()].join("、")}`);
  const action = command.action ?? "stance";
  const current = currentAttitude(draft as FactionsState, def);
  const nowLabel = attitudeLabel(def.kind, current);
  const npcs = readLiveNpcs(ctx);

  // 1. 正式加入势力（自由松绑：中立以上均可谈入伙；sponsor 可选，填了就校验真人存活）
  if (action === "join") {
    if (draft.membership?.faction === def.id) {
      return fail(`你已经是${def.name}的「${draft.membership.rank}」，调整头衔请写 action:"rank"`);
    }
    if (draft.membership !== null) {
      const prevName = catalog.get(draft.membership.faction)?.name ?? draft.membership.faction;
      return fail(
        `你当前仍隶属${prevName}（${draft.membership.rank}），须先脱离原组织再加入${def.name}`,
      );
    }
    if (current === "hostile" || current === "kos") {
      return fail(`${def.name}目前对你「${nowLabel}」，须先缓和关系到中立以上才能正式加入`);
    }
    let sponsorRef: FactionNpcRef | undefined;
    if (command.sponsor !== undefined) {
      sponsorRef = npcs.get(command.sponsor);
      if (!sponsorRef) return fail(`找不到引荐人人物卡 ${command.sponsor}`);
      if (!sponsorRef.alive) return fail(`引荐人${sponsorRef.name}已经死了，不能替你担保入伙`);
    }
    const rank = command.rank?.trim() || FACTION_DEFAULT_RANKS[def.kind];
    draft.membership = {
      faction: def.id,
      rank,
      joinedAt: ctx.now,
      note: command.reason,
      ...(sponsorRef ? { sponsor: sponsorRef.id } : {}),
      sponsorLost: false,
      strikes: [],
    };
    const notes: string[] = [
      `正式加入${def.name}（${rank}${sponsorRef ? `，引荐人：${sponsorRef.name}` : ""}）：${command.reason}`,
    ];
    if (current !== "family") {
      draft.stances[def.id] = {
        attitude: "family",
        reason: `正式加入：${command.reason}`,
        at: ctx.now,
      };
      notes.push(`${def.name}：${nowLabel} → ${attitudeLabel(def.kind, "family")}`);
    }
    // 入帮天然与对头结仇（拉至敌对）
    for (const enemyId of def.enemies) {
      const rival = catalog.get(enemyId);
      if (!rival || rival.id === def.id) continue;
      const was = currentAttitude(draft as FactionsState, rival);
      if (ATTITUDES.indexOf(was) > ATTITUDES.indexOf("hostile")) {
        draft.stances[rival.id] = {
          attitude: "hostile",
          reason: `玩家加入了死对头${def.name}`,
          at: ctx.now,
        };
        notes.push(
          `${rival.name}：${attitudeLabel(rival.kind, was)} → ${attitudeLabel(rival.kind, "hostile")}（玩家加入了死对头${def.name}）`,
        );
      }
    }
    // 盟友若是中立，顺带给面子升到友好（不洗白已有仇怨）
    for (const allyId of def.allies) {
      const ally = catalog.get(allyId);
      if (!ally || ally.id === def.id) continue;
      const was = currentAttitude(draft as FactionsState, ally);
      if (was === "neutral") {
        draft.stances[ally.id] = {
          attitude: "friendly",
          reason: `玩家加入了盟友${def.name}`,
          at: ctx.now,
        };
        notes.push(
          `${ally.name}：${attitudeLabel(ally.kind, was)} → ${attitudeLabel(ally.kind, "friendly")}（玩家加入了盟友${def.name}）`,
        );
      }
    }
    return { ok: true, notes };
  }

  // 2. 帮内/公司内晋升或调职
  if (action === "rank") {
    if (draft.membership?.faction !== def.id) {
      return fail(`你目前不是${def.name}的正式成员，不能调整帮内头衔`);
    }
    const nextRank = command.rank?.trim();
    if (!nextRank) return fail("调整势力头衔需要填写新的 rank");
    const prevRank = draft.membership.rank;
    if (prevRank === nextRank) return fail(`你在${def.name}的头衔已经是「${nextRank}」`);
    draft.membership = { ...draft.membership, rank: nextRank, note: command.reason };
    return {
      ok: true,
      notes: [`${def.name}头衔变更：${prevRank} → ${nextRank}（${command.reason}）`],
    };
  }

  // 3. 脱离 / 退出 / 叛帮
  if (action === "leave") {
    if (draft.membership?.faction !== def.id) {
      return fail(`你目前并不隶属${def.name}，无需脱离`);
    }
    const prevRank = draft.membership.rank;
    draft.membership = null;
    const targetAttitude: Attitude = command.betrayal ? "kos" : (command.attitude ?? "neutral");
    draft.stances[def.id] = {
      attitude: targetAttitude,
      reason: command.reason,
      at: ctx.now,
    };
    const notes: string[] = [
      command.betrayal
        ? `背叛并脱离${def.name}（原${prevRank}）：${command.reason}；${def.name}转为「${attitudeLabel(def.kind, targetAttitude)}」`
        : `脱离${def.name}（原${prevRank}）：${command.reason}；${def.name}转为「${attitudeLabel(def.kind, targetAttitude)}」`,
    ];
    if (command.betrayal) {
      pushAllyChill(draft, def, catalog, ctx.now, `玩家背叛了盟友${def.name}`, notes);
    }
    return { ok: true, notes };
  }

  // 4. 记一笔帮规污点（满 3 笔自动除名并清理门户）
  if (action === "strike") {
    if (draft.membership?.faction !== def.id) {
      return fail(`你目前不是${def.name}的正式成员，无需记帮规污点`);
    }
    let byRef: FactionNpcRef | undefined;
    if (command.byNpc !== undefined) {
      byRef = npcs.get(command.byNpc);
      if (!byRef) return fail(`找不到追责人物卡 ${command.byNpc}`);
    }
    draft.membership.strikes.push({
      at: ctx.now,
      reason: command.reason,
      ...(byRef ? { byNpc: byRef.id } : {}),
    });
    const count = draft.membership.strikes.length;
    const byLabel = byRef ? `（追责：${byRef.name}）` : "";
    if (count >= MAX_FACTION_STRIKES) {
      const prevRank = draft.membership.rank;
      draft.membership = null;
      const purgeReason = `累计 ${MAX_FACTION_STRIKES} 笔帮规污点，清理门户：${command.reason}`;
      draft.stances[def.id] = { attitude: "kos", reason: purgeReason, at: ctx.now };
      const notes = [
        `${def.name}帮规污点满 ${MAX_FACTION_STRIKES} 笔${byLabel}：已除名（原${prevRank}）并下达清理门户（${attitudeLabel(def.kind, "kos")}）`,
      ];
      pushAllyChill(draft, def, catalog, ctx.now, `玩家被盟友${def.name}清理门户`, notes);
      return { ok: true, notes };
    }
    return {
      ok: true,
      notes: [
        `${def.name}记帮规污点（${count}/${MAX_FACTION_STRIKES}）${byLabel}：${command.reason}`,
      ],
    };
  }

  // 5. 销掉一笔帮规污点
  if (action === "clearStrike") {
    if (draft.membership?.faction !== def.id) {
      return fail(`你目前不是${def.name}的正式成员`);
    }
    if (draft.membership.strikes.length === 0) {
      return fail(`你在${def.name}目前没有未销的帮规污点`);
    }
    let byRef: FactionNpcRef | undefined;
    if (command.byNpc !== undefined) {
      byRef = npcs.get(command.byNpc);
      if (!byRef) return fail(`找不到受理人物卡 ${command.byNpc}`);
      if (!byRef.alive) return fail(`${byRef.name}已经死了，不能替你销账`);
    }
    draft.membership.strikes.shift();
    const left = draft.membership.strikes.length;
    return {
      ok: true,
      notes: [
        `${def.name}销去 1 笔污点${byRef ? `（受理：${byRef.name}）` : ""}，余 ${left}/${MAX_FACTION_STRIKES}：${command.reason}`,
      ],
    };
  }

  // 6. 内部派系站队与政变易主（与真实领袖 NPC 联动，拒绝空口扶植已亡派系掌权）
  if (action === "wing") {
    if (def.wings.length === 0) {
      return fail(`${def.name}没有拆分内部派系`);
    }
    if (!command.wing && !command.ruling) {
      return fail(
        `调整${def.name}内部派系须至少填写 wing（玩家站队）或 ruling（新掌权派）；可选：${def.wings.map((w) => `${w.id}(${w.name})`).join("、")}`,
      );
    }
    const cur = draft.wings[def.id];
    const currentRuling = cur?.ruling ?? def.wings[0]?.id ?? "";
    const wingMap = new Map(def.wings.map((w) => [w.id, w] as const));
    if (command.wing && !wingMap.has(command.wing)) {
      return fail(
        `${def.name}没有派系 ${command.wing}；可选：${def.wings.map((w) => `${w.id}(${w.name})`).join("、")}`,
      );
    }
    if (command.ruling && !wingMap.has(command.ruling)) {
      return fail(
        `${def.name}没有派系 ${command.ruling}；可选：${def.wings.map((w) => `${w.id}(${w.name})`).join("、")}`,
      );
    }
    let nextRuling = currentRuling;
    let nextLeader = cur?.leaderNpc;
    let nextVacant = cur?.vacant ?? false;
    const notes: string[] = [];

    if (command.leaderNpc !== undefined) {
      const leaderRef = npcs.get(command.leaderNpc);
      if (!leaderRef) return fail(`找不到掌权领头人物卡 ${command.leaderNpc}`);
      if (!leaderRef.alive) return fail(`${leaderRef.name}已经死了，不能出任掌权领袖`);
      nextLeader = leaderRef.id;
      nextVacant = false;
    }

    if (command.ruling) {
      const targetWing = wingMap.get(command.ruling);
      if (!targetWing) return fail(`${def.name}没有派系 ${command.ruling}`);
      const alivePreset = targetWing.leaders.find((id) => npcs.get(id)?.alive);
      if (!command.leaderNpc) {
        if (alivePreset) {
          nextLeader = alivePreset;
          nextVacant = false;
        } else {
          return fail(
            `让${def.name}「${targetWing.name}」掌权须有活着的领头人物：请先用 npc 建卡并在 leaderNpc 填入该人物 id`,
          );
        }
      }
      nextRuling = targetWing.id;
      const leaderName = nextLeader ? (npcs.get(nextLeader)?.name ?? nextLeader) : undefined;
      notes.push(
        `${def.name}内部掌权易主：${targetWing.name}${leaderName ? `（领头：${leaderName}）` : ""}掌权——${command.reason}`,
      );
    }

    const nextPlayerSide = command.wing ?? cur?.playerSide;
    if (command.wing) {
      const sideDef = wingMap.get(command.wing);
      if (sideDef) {
        notes.push(`玩家在${def.name}内部站队「${sideDef.name}」：${command.reason}`);
      }
    }

    draft.wings[def.id] = {
      ruling: nextRuling,
      ...(nextLeader ? { leaderNpc: nextLeader } : {}),
      vacant: nextVacant,
      ...(nextPlayerSide ? { playerSide: nextPlayerSide } : {}),
      note: command.reason,
      at: ctx.now,
    };
    return { ok: true, notes };
  }

  // 7. 玩家剧情主动推动地盘争夺 / 易主（可挂坐镇或被斩首的关键 NPC）
  if (action === "turf") {
    const district = command.district?.trim();
    const turfChange = command.turfChange;
    if (!district || !turfChange) {
      return fail("地盘争夺须填写 district（城区名）与 turfChange（contest / gain / lose）");
    }
    let leadRef: FactionNpcRef | undefined;
    if (command.leadNpc !== undefined) {
      leadRef = npcs.get(command.leadNpc);
      if (!leadRef) return fail(`找不到关键人物卡 ${command.leadNpc}`);
    }
    const turfMap = currentTurf(draft as FactionsState, ctx.data, false);
    const holders = [...turfMap.entries()]
      .filter(([, districts]) => districts.includes(district))
      .map(([fid]) => fid);
    const threadTag = `player:${ctx.now}:${def.id}`;
    const leadLabel = leadRef ? `（关键人物：${leadRef.name}）` : "";

    if (turfChange === "contest") {
      const involved = new Set<string>([...holders, def.id]);
      if (command.rival && catalog.has(command.rival)) involved.add(command.rival);
      draft.contested[district] = {
        district,
        factions: [...involved],
        reason: command.reason,
        ...(leadRef ? { leadNpc: leadRef.id } : {}),
        at: ctx.now,
      };
      return {
        ok: true,
        notes: [
          `${district}进入地盘火拼争夺（${[...involved].map((id) => catalog.get(id)?.name ?? id).join(" vs ")}）${leadLabel}：${command.reason}`,
        ],
      };
    }

    if (turfChange === "gain") {
      const notes: string[] = [];
      if (!(turfMap.get(def.id) ?? []).includes(district)) {
        draft.turf.push({
          at: ctx.now,
          thread: threadTag,
          faction: def.id,
          district,
          change: "gain",
          told: true,
        });
        notes.push(`${def.name}拿下了${district}地盘${leadLabel}：${command.reason}`);
      }
      if (
        command.rival &&
        command.rival !== def.id &&
        (turfMap.get(command.rival) ?? []).includes(district)
      ) {
        draft.turf.push({
          at: ctx.now,
          thread: threadTag,
          faction: command.rival,
          district,
          change: "lose",
          told: true,
        });
        notes.push(`${catalog.get(command.rival)?.name ?? command.rival}丢了${district}地盘`);
      }
      delete draft.contested[district];
      if (notes.length === 0) return fail(`${def.name}已经在${district}拥有地盘`);
      return { ok: true, notes };
    }

    // turfChange === "lose"
    if (!(turfMap.get(def.id) ?? []).includes(district)) {
      return fail(`${def.name}在${district}本来就没有地盘`);
    }
    draft.turf.push({
      at: ctx.now,
      thread: threadTag,
      faction: def.id,
      district,
      change: "lose",
      told: true,
    });
    delete draft.contested[district];
    return {
      ok: true,
      notes: [`${def.name}失去了${district}地盘${leadLabel}：${command.reason}`],
    };
  }

  // 8. 常规态度变更（stance）
  if (!command.attitude) return fail("变更势力态度需要填写 attitude");
  if (current === command.attitude) return fail(`${def.name}现在就是「${nowLabel}」，不用再写`);
  const step = Math.abs(ATTITUDES.indexOf(command.attitude) - ATTITUDES.indexOf(current));
  if (step > ATTITUDE_MAX_STEP)
    return fail(
      `态度一次最多变 ${ATTITUDE_MAX_STEP} 档：${def.name}现在是「${nowLabel}」，要变更多得再出一件事`,
    );
  draft.stances[def.id] = { attitude: command.attitude, reason: command.reason, at: ctx.now };
  const notes = [
    `${def.name}：${nowLabel} → ${attitudeLabel(def.kind, command.attitude)}（${command.reason}）`,
  ];

  // 若玩家隶属该势力但态度跌至敌对/见面就打，自动除名
  const to = ATTITUDES.indexOf(command.attitude);
  if (draft.membership?.faction === def.id && to <= ATTITUDES.indexOf("hostile")) {
    const prevRank = draft.membership.rank;
    draft.membership = null;
    notes.push(`你已被${def.name}除名（原${prevRank}）`);
  }

  // 帮了一边就得罪它的对头：态度往好里变、变到友好以上时，对头各降一档（最低到 hostile）
  if (to > ATTITUDES.indexOf(current) && to >= ATTITUDES.indexOf("friendly")) {
    pushRivalFallout(
      draft,
      def,
      catalog,
      ctx.now,
      `玩家和对头${def.name}走得近`,
      notes,
      RIVAL_FLOOR,
    );
  }

  // 彻底闹翻到见面就打（kos）时，其友好/自己人盟友轻度受牵连降一档（最低到 neutral）
  if (command.attitude === "kos") {
    pushAllyChill(draft, def, catalog, ctx.now, `玩家与盟友${def.name}彻底翻脸`, notes);
  }

  return { ok: true, notes };
}
