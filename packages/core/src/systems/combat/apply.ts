import type { Draft } from "immer";
import type { Rng } from "../../kernel/ports";
import type { ApplyOutcome, SystemContext, TimeSpan } from "../../kernel/system";
import { SERVICES } from "../economy";
import { type InventoryState, type ItemDef, itemCatalog } from "../inventory";
import { currentVitals, type NpcState } from "../npc";
import { locationCatalog, type WorldClockState } from "../world";
import { familyOf, pickName } from "./names";
import {
  type ActiveFoe,
  AVENGE_PERCENT,
  BLACKMAIL_EDDIES,
  BODY_PART_LABELS,
  BUY_RUMOR_EDDIES,
  type CombatCommand,
  type CombatState,
  type Dead,
  type Drift,
  DriftSchema,
  FOE_STATE_LABELS,
  FOOTAGE_DUE_MINUTES,
  HEAL_MINUTES,
  HOLDER_LABELS,
  type Holder,
  LOOT_EXTRA_KINDS,
  LOOT_RARITY,
  LOOT_WEAPONS,
  MOURNER_LABELS,
  MournerSchema,
  RECKON_MINUTES,
  RUMOR_HOP_MINUTES,
  RUMOR_MAX_HOPS,
  SCARRING_TIERS,
} from "./schema";

/**
 * 战斗只记后果：开打登记谁在场，某人倒下、死了、跑了，玩家挨了哪一下，收场时起流言、定录像在谁手里；
 * 时间推进时伤长好或留疤、死者家里人找不找上门、流言往外传并走样、录像到期出事
 */

type Combat = Draft<CombatState>;

const fail = (reason: string): ApplyOutcome => ({ ok: false, reason });
const ok = (...notes: string[]): ApplyOutcome => ({ ok: true, notes });

/** 从表里抽一个；只有一个时不掷（骰子至少两面） */
const at = <T>(list: readonly T[], rng: Rng): T =>
  list.length > 1 ? (list[rng.roll(list.length) - 1] as T) : (list[0] as T);

/** 案底条目的 id：前缀加递增编号 */
function newId(draft: Combat, prefix: string): string {
  const id = `${prefix}${draft.nextId}`;
  draft.nextId += 1;
  return id;
}

/** 玩家现在在哪个地区；地点表里查不到是 null */
function districtHere(ctx: SystemContext): string | null {
  const here = ctx.read<WorldClockState>("world").location;
  return here === null ? null : (locationCatalog(ctx.data).get(here)?.district ?? null);
}

/** 开打时按路数和档位抽这人身上带的：一把武器，一半机会再带一件治疗品或手雷；不朽的不掉 */
export function drawLoot(
  foe: Pick<ActiveFoe, "archetype" | "tier">,
  data: Readonly<Record<string, unknown>>,
  rng: Rng,
): string[] {
  if (data.items === undefined) return [];
  const all = [...itemCatalog(data).values()].filter((d) => !d.iconic);
  if (all.length === 0) return [];
  const rarities: readonly string[] = LOOT_RARITY[foe.tier];
  const pick = (fits: (d: ItemDef) => boolean): string[] => {
    let pool = all.filter((d) => fits(d) && rarities.includes(d.rarity ?? "common"));
    if (pool.length === 0) pool = all.filter((d) => fits(d) && (d.rarity ?? "common") === "common");
    return pool.length === 0 ? [] : [at(pool, rng).id];
  };
  const weapons: readonly string[] = LOOT_WEAPONS[foe.archetype];
  const carry = pick((d) => d.kind === "weapon" && weapons.includes(d.category ?? ""));
  if (rng.roll(2) === 2) carry.push(...pick((d) => LOOT_EXTRA_KINDS.includes(d.kind)));
  return carry;
}

/** 从倒下或死了的人身上捡一件，直接进物品栏；打完了从剩下的里捡 */
export function loot(draft: Combat, command: CombatCommand, ctx: SystemContext): ApplyOutcome {
  const { target, item } = command;
  if (target === undefined || item === undefined) return fail("loot 要写 target 和 item");
  let bag: string[];
  let name: string;
  let npc: string | null;
  const here = ctx.read<WorldClockState>("world").location;
  const foe = draft.active?.foes.find((f) => f.id === target || f.npc === target);
  if (foe) {
    if (draft.active?.location !== here) return fail("这些物件不在当前地点，不能隔空拾取");
    if (foe.state === "fled") return fail(`${foe.name}跑了，东西也带走了`);
    if (foe.state === "up") return fail(`${foe.name}还站着，捡不了他身上的东西`);
    bag = foe.carry;
    name = foe.name;
    npc = foe.npc;
  } else {
    const left = draft.groundLoot.find((l) => l.from === target && l.location === here);
    if (!left) return fail(`${target}身上没有剩下的东西`);
    bag = left.items;
    name = left.name;
    npc = left.npc;
  }
  if (npc !== null) {
    const card = ctx.read<NpcState>("npc").npcs[npc];
    if (!card?.body?.gear.includes(item)) return fail(`${name}已经不再带着 ${item}，不能重复取得`);
    if (card.location !== null && card.location !== here)
      return fail(`${name}已经带着物件离开这里`);
  }
  const i = bag.indexOf(item);
  if (i < 0) return fail(`${name}身上没有 ${item}`);
  bag.splice(i, 1);
  const trackedObject = ctx.read<InventoryState>("inventory")?.objects[item];
  return {
    ok: true,
    notes: [],
    emit: [
      ...(npc === null || trackedObject
        ? []
        : [{ type: "npcGear", id: npc, action: "remove", item }]),
      { type: "item", action: "gain", id: item, reason: `从${name}身上捡的` },
    ],
  };
}

/** 开打：登记谁在场、在哪个地区；过程由叙事写，代码只等后果 */
export function startCombat(
  draft: Combat,
  command: CombatCommand,
  ctx: SystemContext,
): ApplyOutcome {
  if (draft.active) return fail("已经在打了");
  const cards = ctx.read<NpcState>("npc").npcs;
  const foes: ActiveFoe[] = [];
  for (const f of command.foes ?? []) {
    const card = f.npc === undefined ? undefined : cards[f.npc];
    if (f.npc !== undefined && !card) return fail(`没有 ${f.npc} 的人物卡；杂兵不写 npc`);
    if (card && !card.alive) return fail(`${card.name}已经死了`);
    const id = f.npc ?? `foe${draft.nextFoe++}`;
    if (foes.some((x) => x.id === id)) return fail(`${f.name}写了两次`);
    const foe: ActiveFoe = {
      id,
      name: card?.name ?? f.name,
      npc: f.npc ?? null,
      gang: f.gang ?? null,
      archetype: f.archetype,
      tier: f.tier,
      state: card && currentVitals(card, ctx.data, ctx.now).condition !== "up" ? "down" : "up",
      carry: [],
    };
    // 已有卡的人带着已记录的物品；空装备也是事实，不能因开战重新抽奖。
    foe.carry = card ? [...(card.body?.gear ?? [])] : drawLoot(foe, ctx.data, ctx.rng);
    if (card) draft.groundLoot = draft.groundLoot.filter((l) => l.npc !== f.npc);
    foes.push(foe);
  }
  if (foes.length === 0) return fail("开打要写 foes");
  draft.active = {
    startedAt: ctx.now,
    district: districtHere(ctx),
    location: ctx.read<WorldClockState>("world").location,
    foes,
  };
  const named = foes.map((f) => (f.gang ? `${f.gang}的${f.name}` : f.name));
  return ok(`动手了：${named.join("、")}`);
}

/** 死者进案底：没名没姓的由代码起名，再定一个等他回家的人；过几天掷有没有人找上门 */
function recordDead(draft: Combat, foe: ActiveFoe, ctx: SystemContext): Dead {
  // 有卡的用卡上的名字；一伙杂兵合成的那条，死的是其中一个具体的人
  const name = foe.npc ? foe.name : pickName(ctx.rng);
  const mourner = at(MournerSchema.options, ctx.rng);
  const kin = mourner === "sibling" || mourner === "parent" || mourner === "child";
  const dead: Dead = {
    id: newId(draft, "d"),
    name,
    gang: foe.gang,
    tier: foe.tier,
    mourner,
    mournerName: pickName(ctx.rng, kin ? familyOf(name) : undefined),
    killedAt: ctx.now,
    district: draft.active?.district ?? districtHere(ctx),
    reckonAt: ctx.now + RECKON_MINUTES,
    avenger: null,
  };
  draft.dead.push(dead);
  return dead;
}

/** 某人倒下、死了或跑了 */
export function setFoe(draft: Combat, command: CombatCommand, ctx: SystemContext): ApplyOutcome {
  const foe = draft.active?.foes.find((f) => f.id === command.target || f.npc === command.target);
  if (!foe || command.state === undefined) return fail(`场上没有 ${command.target}`);
  if (foe.state === command.state || foe.state === "dead") return ok();
  foe.state = command.state;
  if (command.state !== "dead")
    return {
      ok: true,
      notes: [`${foe.name}${FOE_STATE_LABELS[command.state]}`],
      emit:
        command.state === "down" && foe.npc !== null
          ? [
              {
                type: "npc.condition",
                id: foe.npc,
                condition: "down",
                reason: "在已记录的冲突中倒下",
              },
            ]
          : [],
    };
  const d = recordDead(draft, foe, ctx);
  const who = d.gang ? `${d.gang}的${d.name}` : d.name;
  return {
    ok: true,
    notes: [`${who}死了；家里有${MOURNER_LABELS[d.mourner]}${d.mournerName}在等他`],
    emit:
      foe.npc !== null && ctx.read<NpcState>("npc").npcs[foe.npc]?.alive
        ? [{ type: "npcDeath", id: foe.npc, reason: "在已记录的这次冲突中死亡" }]
        : [],
  };
}

/** 玩家挨了一下：伤口记下谁、用什么、打在哪、什么时候长好；扣血交给 health */
export function wound(draft: Combat, command: CombatCommand, ctx: SystemContext): ApplyOutcome {
  const { by, weapon, part, tier } = command;
  if (by === undefined || weapon === undefined || part === undefined || tier === undefined) {
    return fail("wound 要写 by、weapon、part、tier");
  }
  // by 写的是场上那人的 id 时换成名字，帮派跟着他
  const foe = draft.active?.foes.find((f) => f.id === by || f.npc === by || f.name === by);
  const w = {
    id: newId(draft, "w"),
    by: foe?.name ?? by,
    gang: foe?.gang ?? null,
    weapon,
    part,
    tier,
    at: ctx.now,
    district: draft.active?.district ?? districtHere(ctx),
    healsAt: tier === "graze" ? ctx.now + HEAL_MINUTES[tier] : null,
    treated: false,
  };
  draft.wounds.push(w);
  const from = w.gang ? `${w.gang}的${w.by}` : w.by;
  return {
    ok: true,
    notes: [`${BODY_PART_LABELS[part]}挨了${from}的${weapon}`],
    emit: [{ type: "health.hit", tier, part, injuryId: w.id, reason: `${from}的${weapon}` }],
  };
}

/** 处理一处伤：缩短恢复时间、不留疤；医疗费与治疗由内核连锁事务一起结算，失败一起回滚 */
export function treat(draft: Combat, target: string | undefined, ctx: SystemContext): ApplyOutcome {
  const w = draft.wounds.find((x) => x.id === target);
  if (!w) return fail(`没有 ${target} 这处伤`);
  if (w.treated) return ok();
  w.treated = true;
  w.healsAt ??= ctx.now + HEAL_MINUTES[w.tier];
  return {
    ok: true,
    notes: [`${BODY_PART_LABELS[w.part]}的伤处理过了，不会留疤`],
    emit: [
      { type: "health.treat", id: w.id },
      {
        type: "money",
        delta: -SERVICES.medical.price,
        reason: `处理伤口 ${w.id}（${BODY_PART_LABELS[w.part]}）`,
      },
    ],
  };
}

/** 起一条流言：从当地起，一天往外传一站 */
function startRumor(
  draft: Combat,
  truth: string,
  dead: number,
  district: string | null,
  ctx: SystemContext,
) {
  const rumor = {
    id: newId(draft, "r"),
    truth,
    dead,
    hops: [{ district: district ?? "本地", at: ctx.now, count: dead, drifts: [] }],
    nextAt: ctx.now + RUMOR_HOP_MINUTES,
    confirmed: false,
    stopped: null,
  };
  draft.rumors.push(rumor);
  return rumor;
}

const OWNERS: readonly Holder[] = ["ncpd", "dealer", "blackmailer"];

/** 定录像在谁手里：监控拍的直接落到某一方；路人录的先在路人手里，到期前转手 */
function startFootage(
  draft: Combat,
  shows: string,
  cameras: boolean,
  district: string | null,
  rumor: string,
  ctx: SystemContext,
) {
  const tape = {
    id: newId(draft, "f"),
    shows,
    source: cameras ? "街角的监控" : "一个路人的义眼",
    holder: cameras ? at(OWNERS, ctx.rng) : ("bystander" as Holder),
    passTo: cameras ? null : at(OWNERS, ctx.rng),
    at: ctx.now,
    district,
    dueAt: ctx.now + FOOTAGE_DUE_MINUTES,
    fired: null,
    firedAt: null,
    resolved: null,
    rumor,
  };
  draft.footage.push(tape);
  return tape;
}

/** 收场：有卡的人后来怎样记给宿敌；倒下和死了的人身上剩的留着搜；有人看见就起流言、有录像 */
export function endCombat(draft: Combat, command: CombatCommand, ctx: SystemContext): ApplyOutcome {
  const active = draft.active;
  if (!active) return fail("没在打");
  const foes = active.foes.flatMap((f) =>
    f.npc === null ? [] : [{ npc: f.npc, name: f.name, state: f.state }],
  );
  const left = active.foes.flatMap((f) =>
    (f.state === "down" || f.state === "dead") && f.carry.length > 0
      ? [
          {
            from: f.id,
            name: f.name,
            npc: f.npc,
            location: active.location,
            leftAt: ctx.now,
            items: [...f.carry],
          },
        ]
      : [],
  );
  draft.groundLoot.push(...left);
  draft.last = { endedAt: ctx.now, foes };
  draft.active = null;
  const witnesses = command.witnesses ?? 0;
  const cameras = command.cameras ?? false;
  const notes = ["收场了"];
  if (witnesses > 0 || cameras) {
    const dead = active.foes.filter((f) => f.state === "dead").length;
    const truth = command.truth ?? `在${active.district ?? "街上"}和人动了手`;
    const rumor = startRumor(draft, truth, dead, active.district, ctx);
    notes.push(`有人看见了：流言从${rumor.hops[0]?.district}传开`);
    const tape = startFootage(draft, truth, cameras, active.district, rumor.id, ctx);
    notes.push(`${tape.source}录下了这一架，现在在${HOLDER_LABELS[tape.holder]}手里`);
  }
  return {
    ok: true,
    notes,
    signals: ["combat.end"],
  };
}

/** 压下或收买一条流言：停在现在传到的地方；收买要花钱 */
export function settleRumor(draft: Combat, command: CombatCommand): ApplyOutcome {
  const r = draft.rumors.find((x) => x.id === command.target);
  if (!r) return fail(`没有 ${command.target} 这条流言`);
  if (command.how !== "silenced" && command.how !== "bought")
    return fail("rumor 的 how 写 silenced 或 bought");
  if (r.stopped) return ok();
  if (r.confirmed) return fail("录像已经卖成了超梦，这条流言压不住了");
  r.stopped = command.how;
  r.nextAt = null;
  if (command.how === "silenced") return ok("流言压下去了，不再往外传");
  return {
    ok: true,
    notes: ["收买了传话的人，流言停了"],
    emit: [{ type: "money", delta: -BUY_RUMOR_EDDIES, reason: "收买传流言的人" }],
  };
}

/** 了结一段录像：追回、销毁，或者付钱给敲诈的人 */
export function settleFootage(draft: Combat, command: CombatCommand): ApplyOutcome {
  const f = draft.footage.find((x) => x.id === command.target);
  if (!f) return fail(`没有 ${command.target} 这段录像`);
  const how = command.how;
  if (how !== "recovered" && how !== "destroyed" && how !== "paid") {
    return fail("footage 的 how 写 recovered、destroyed 或 paid");
  }
  if (f.resolved) return ok();
  if (f.fired === "evidence" || f.fired === "sold") return fail("录像已经流出去了，追不回来");
  f.resolved = how;
  f.dueAt = null;
  if (how !== "paid") return ok(how === "recovered" ? "录像追回来了" : "录像销毁了");
  return {
    ok: true,
    notes: ["付了钱，录像交到了你手里"],
    emit: [{ type: "money", delta: -BLACKMAIL_EDDIES, reason: "买下拍了你的录像" }],
  };
}

/** 死者那边找上门的人：came 叙事里写他来了，settled 了结了 */
export function settleAvenger(draft: Combat, command: CombatCommand): ApplyOutcome {
  const d = draft.dead.find((x) => x.id === command.target);
  if (!d) return fail(`案底里没有 ${command.target}`);
  if (command.how !== "came" && command.how !== "settled")
    return fail("avenger 的 how 写 came 或 settled");
  if (d.avenger === null) return fail(`${d.name}那边还没人找上门`);
  if (d.avenger === "settled") return ok();
  d.avenger = command.how;
  return ok(command.how === "came" ? `${d.mournerName}找上门了` : `${d.name}的事了结了`);
}

/** 流言往外传一站：挑一个还没传到的地区，走样一处；人数走样就翻倍 */
function hop(r: Combat["rumors"][number], districts: readonly string[], at_: number, rng: Rng) {
  const seen = new Set(r.hops.map((h) => h.district));
  const fresh = districts.filter((d) => !seen.has(d));
  const prev = r.hops[r.hops.length - 1];
  if (!prev || fresh.length === 0 || r.hops.length > RUMOR_MAX_HOPS) {
    r.stopped = "faded";
    r.nextAt = null;
    return;
  }
  const drift: Drift = at(DriftSchema.options, rng);
  r.hops.push({
    district: at(fresh, rng),
    at: at_,
    count: drift === "count" ? Math.max(1, prev.count * 2) : prev.count,
    drifts: [...prev.drifts, drift],
  });
  r.nextAt = at_ + RUMOR_HOP_MINUTES;
}

/** 时间推进：伤长好（没治的重伤留疤）、死者那边掷找不找上门、流言往外传、录像到期出事 */
export function tickCombat(draft: Combat, span: TimeSpan, ctx: SystemContext): void {
  const now = span.to;
  const injuries = ctx.read<{
    injuries?: { id: string; healsAt: number | null; treated: boolean }[];
  }>("health").injuries;
  for (const w of [...draft.wounds]) {
    const injury = injuries?.find((i) => i.id === w.id);
    // health 先结算时间；一次跳过整个恢复期时，已愈合的镜像记录可能已被移除。
    if (injuries !== undefined && !injury) {
      draft.wounds.splice(draft.wounds.indexOf(w), 1);
      continue;
    }
    if (injury) {
      w.healsAt = injury.healsAt;
      w.treated = injury.treated;
    }
    if (w.healsAt === null || w.healsAt > now) continue;
    if (!w.treated && SCARRING_TIERS.includes(w.tier)) {
      draft.scars.push({
        by: w.by,
        gang: w.gang,
        weapon: w.weapon,
        part: w.part,
        at: w.at,
        district: w.district,
      });
    }
    draft.wounds.splice(draft.wounds.indexOf(w), 1);
  }
  for (const d of draft.dead) {
    if (d.reckonAt === null || d.reckonAt > now) continue;
    d.reckonAt = null;
    if (ctx.rng.roll(100) <= AVENGE_PERCENT[d.tier]) d.avenger = "pending";
  }
  const districts = [...new Set([...locationCatalog(ctx.data).values()].map((l) => l.district))];
  for (const r of draft.rumors) {
    while (r.nextAt !== null && r.nextAt <= now) hop(r, districts, r.nextAt, ctx.rng);
  }
  for (const f of draft.footage) {
    if (f.dueAt === null || f.dueAt > now) continue;
    // 路人手里的先转手，再过一阵才出事
    if (f.holder === "bystander" && f.passTo !== null) {
      f.holder = f.passTo;
      f.passTo = null;
      f.dueAt += FOOTAGE_DUE_MINUTES;
      if (f.dueAt > now) continue;
    }
    f.firedAt = f.dueAt;
    f.dueAt = null;
    f.fired = f.holder === "ncpd" ? "evidence" : f.holder === "dealer" ? "sold" : "demand";
    if (f.fired === "sold") {
      const r = draft.rumors.find((x) => x.id === f.rumor);
      if (r) r.confirmed = true;
    }
  }
}

export function applyCombat(
  draft: Combat,
  command: CombatCommand,
  ctx: SystemContext,
): ApplyOutcome {
  switch (command.action) {
    case "start":
      return startCombat(draft, command, ctx);
    case "foe":
      return setFoe(draft, command, ctx);
    case "wound":
      return wound(draft, command, ctx);
    case "end":
      return endCombat(draft, command, ctx);
    case "loot":
      return loot(draft, command, ctx);
    case "treat":
      return treat(draft, command.target, ctx);
    case "rumor":
      return settleRumor(draft, command);
    case "footage":
      return settleFootage(draft, command);
    case "avenger":
      return settleAvenger(draft, command);
  }
}
