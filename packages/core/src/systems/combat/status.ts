import type { StatusContext, SystemStatus } from "../../kernel/system";
import type { combatView } from "./view";

/** 【当前状态】里战斗的几行：正在打的这一架、没捡走的东西；案底里的伤、疤、找上门的人、流言、录像 */

type CombatView = ReturnType<typeof combatView>;

const combatOf = (ctx: StatusContext) => ctx.views.combat as CombatView;

const goods = (items: readonly { id: string; name: string }[]) =>
  items.map((i) => `${i.name}（${i.id}）`).join("、");

/** 正在打的这一架，和打完没捡走的 */
function fightLines(view: CombatView): string[] {
  const a = view.active;
  if (!a) {
    return view.loot.map(
      (l) => `此地${l.name}（id ${l.from}）身上还剩：${goods(l.items)}；玩家搜身拿走发 combat loot`,
    );
  }
  const foes = a.foes.map((f) => {
    const bits = [`id ${f.id}`, f.stateLabel];
    if (f.gang) bits.push(f.gang);
    if (f.carry.length > 0) bits.push(`身上有${goods(f.carry)}，能捡`);
    return `${f.name}（${bits.join("，")}）`;
  });
  return [`正在打：${foes.join("、")}；过程写在正文里，只把后果发成 combat 指令`];
}

/** 案底：还没好的伤、疤、找上门的人、还在传的流言、没了结的录像 */
function recordLines(view: CombatView): string[] {
  const lines: string[] = [];
  const from = (by: string, gang: string | null) => (gang ? `${gang}的${by}` : by);
  for (const w of view.wounds) {
    const care = w.treated
      ? "处理过了"
      : w.tier === "graze"
        ? "没处理，自然长好不留疤"
        : "尚未处理，深层创伤不能仅靠切场或休息消失";
    lines.push(
      `伤 ${w.id}：${w.partLabel}，${from(w.by, w.gang)}的${w.weapon}，${w.healsAt === null ? "尚未开始愈合过程" : `还要 ${w.daysLeft} 天`}，${care}；付费处理伤口发 combat treat，处理后仍需等待恢复`,
    );
  }
  if (view.scars.length > 0) {
    const scars = view.scars.map(
      (s) =>
        `${s.partLabel}上${from(s.by, s.gang)}的${s.weapon}留的疤${s.district ? `（在${s.district}留下）` : ""}`,
    );
    lines.push(`疤（认得的人会认出来，下雨天会疼）：${scars.join("、")}`);
  }
  for (const d of view.dead) {
    if (d.avenger !== "pending" && d.avenger !== "came") continue;
    const who = `${d.name}${d.gang ? `（${d.gang}）` : ""}的${d.mournerLabel}${d.mournerName}`;
    lines.push(
      d.avenger === "pending"
        ? `死者 ${d.id}：${who}找上门来了，挑合适的时候写他出场，写完发 combat avenger came`
        : `死者 ${d.id}：${who}已经找上门，了结了发 combat avenger settled`,
    );
  }
  for (const r of view.rumors) {
    if (r.stopped || !r.latest) continue;
    const places = r.hops.map((h) => h.district).join("→");
    const drift = r.driftLabels.length > 0 ? `，传歪了：${r.driftLabels.join("、")}` : "";
    const sure = r.confirmed
      ? "；录像卖成了超梦，大家都信，压不住了"
      : "；压下去发 combat rumor silenced，收买发 bought";
    lines.push(
      `流言 ${r.id}：真相是「${r.truth}」，现在传到${places}，说死了 ${r.latest.count} 个${drift}；那边的人信的是流言里的玩家${sure}`,
    );
  }
  for (const f of view.footage) {
    if (f.resolved) continue;
    const what = `录像 ${f.id}：${f.source}拍下了「${f.shows}」`;
    if (f.fired === "evidence") lines.push(`${what}，进了 NCPD 证据库，追不回来了`);
    else if (f.fired === "sold") lines.push(`${what}，被卖成了超梦，正在街上流传`);
    else if (f.fired === "demand")
      lines.push(
        `${what}，在${f.holderLabel}手里，他上门要钱了；付钱发 combat footage paid，抢回来发 recovered，毁掉发 destroyed`,
      );
    else
      lines.push(
        `${what}，现在在${f.holderLabel}手里，过阵子会出事；追回发 combat footage recovered，毁掉发 destroyed`,
      );
  }
  return lines;
}

export const combatStatus: readonly SystemStatus[] = [
  {
    order: 280,
    lines: (ctx) => [...fightLines(combatOf(ctx)), ...recordLines(combatOf(ctx))],
  },
];
