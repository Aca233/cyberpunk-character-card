import type { AssetId } from "../../assets";
import { Asset } from "../../ui/Asset";
import { CellFrame } from "../../ui/FrameBox";
import styles from "./story.module.css";
import type { View } from "./view";

type Faction = View["factions"]["list"][number];

const GROUPS: readonly [Faction["kind"], string][] = [
  ["gang", "帮派"],
  ["corp", "公司"],
  ["law", "执法"],
  ["service", "服务"],
];

const FACTION_ASSETS: Readonly<Record<string, AssetId>> = {
  maelstrom: "gang.maelstrom",
  "tyger-claws": "gang.tygerClaws",
  valentinos: "gang.valentinos",
  "sixth-street": "gang.sixthStreet",
  animals: "gang.animals",
  "voodoo-boys": "gang.voodooBoys",
  mox: "gang.mox",
  scavengers: "gang.scavengers",
  wraiths: "gang.wraiths",
  aldecaldos: "gang.aldecaldos",
  barghest: "gang.barghest",
  ncpd: "map.poi.police",
  maxtac: "map.poi.police",
  netwatch: "interaction.netrunner",
  "trauma-team": "brand.traumaTeam",
  arasaka: "brand.arasaka",
  militech: "brand.militech",
  "kang-tao": "brand.kangTao",
  biotechnica: "brand.biotechnica",
  petrochem: "brand.petrochem",
};

const FACTION_MONOGRAMS: Readonly<Record<string, string>> = {
  arasaka: "荒",
  militech: "米",
  "kang-tao": "康",
  biotechnica: "生",
  petrochem: "沛",
};

function FactionMark({ faction }: { readonly faction: Faction }) {
  const asset = FACTION_ASSETS[faction.id];
  const corporate = faction.kind === "corp";
  return (
    <span
      className={styles.factionIcon}
      style={{
        color: faction.color,
        width: corporate ? 82 : undefined,
        height: corporate ? 42 : undefined,
      }}
    >
      {asset ? (
        <Asset
          id={asset}
          height={corporate ? 42 : 34}
          width={corporate ? 82 : 34}
          alt={`${faction.name}标志`}
        />
      ) : (
        <span
          className={styles.factionMonogram}
          style={{ borderColor: faction.color }}
          role="img"
          aria-label={`${faction.name}标志`}
        >
          {FACTION_MONOGRAMS[faction.id] ?? faction.name.slice(0, 1)}
        </span>
      )}
    </span>
  );
}

interface FactionQuickAction {
  readonly label: string;
  readonly draft: string;
  readonly tone?: "accent" | "danger";
}

function quickActionsFor(
  f: Faction,
  membership: View["factions"]["membership"],
): readonly FactionQuickAction[] {
  const liveContact = f.keyNpcs.find((n) => n.alive && n.met) ?? f.keyNpcs.find((n) => n.alive);
  const contactName = liveContact?.name;
  const firstTurf = f.turf[0];

  if (f.member) {
    const actions: FactionQuickAction[] = [
      {
        label: "找同伙照应",
        draft: contactName
          ? `我通过${f.name}内部渠道联系${contactName}或附近同伙，看看眼下有没有能搭把手或照应的地方。`
          : `我通过${f.name}内部渠道联系附近的同伙，看看眼下有没有能搭把手或照应的地方。`,
        tone: "accent",
      },
    ];
    if (membership && membership.strikes.length > 0) {
      actions.push({
        label: "办活销污点",
        draft: contactName
          ? `我找${contactName}当面谈，看能不能接一趟硬活或拿出诚意，把我在${f.name}背着的帮规污点销掉。`
          : `我找${f.name}能拍板的管事人谈，看怎么把背着的帮规污点销掉。`,
        tone: "accent",
      });
    } else if (f.wings.length > 0 && !f.playerWingName) {
      actions.push({
        label: "内部站队",
        draft: `我打量着${f.name}内部几股势力的动向，打算私下递话表个态，选一条线靠过去。`,
      });
    }
    actions.push({
      label: "提出脱离",
      draft: contactName
        ? `我打算找${contactName}或${f.name}能拍板的人把话说开，正式提出脱离组织。`
        : `我打算找${f.name}能拍板的管事人把话说开，正式提出脱离组织。`,
      tone: "danger",
    });
    return actions;
  }

  if (f.attitude === "hostile" || f.attitude === "kos") {
    const actions: FactionQuickAction[] = [];
    if (firstTurf) {
      actions.push({
        label: `端${firstTurf}据点`,
        draft: `我打算摸清${f.name}在${firstTurf}的一处核心据点或货仓，准备动手端掉它、把这片地盘搅乱。`,
        tone: "danger",
      });
    }
    actions.push({
      label: "找门路摆平",
      draft: `我想找中间人或门路递个话，探探${f.name}那边还有没有把梁子揭过的余地。`,
      tone: "danger",
    });
    return actions;
  }

  // neutral / friendly / family（中立及以上均可自由谈入伙）
  const actions: FactionQuickAction[] = [];
  if (!membership) {
    actions.push({
      label: contactName ? `找${contactName.split("·")[0]}谈入伙` : "申请加入",
      draft: contactName
        ? `我想找${contactName}聊聊，看看有没有机会通过这条线正式加入${f.name}。`
        : `我想摸清${f.name}的收人路子，找能拍板的人或渠道谈谈正式加入的事。`,
      tone: "accent",
    });
  }
  if (f.wings.length > 0) {
    actions.push({
      label: f.rulingVacant ? "趁乱扶植新派" : "搅动内部派系",
      draft: f.rulingVacant
        ? `趁着${f.name}眼下领袖出事、群龙无首，我想私下接触他们内部的人，看看能不能趁机扶植一派上位。`
        : `我打听${f.name}内部不同派系之间的矛盾，看看有没有借机站队或搅局的机会。`,
    });
  } else if (firstTurf && membership && membership.faction !== f.id) {
    actions.push({
      label: `争${firstTurf}地盘`,
      draft: `我踩点${f.name}在${firstTurf}的盘口，盘算着帮${membership.name}把这片地盘抢过来。`,
      tone: "danger",
    });
  } else {
    actions.push({
      label: "打听动静",
      draft: `我顺着街头风声打听${f.name}最近的动向，看看有没有机会搭上线。`,
    });
  }
  return actions;
}

/** 势力页：按帮派、公司、执法、服务分组；展示成员归属、帮规污点、内部派系、真人 NPC 与地盘争夺。不调用模型 */
export function FactionsBody({
  view,
  onDraftAction,
}: {
  readonly view: View;
  readonly onDraftAction?: ((text: string) => void) | undefined;
}) {
  const here = view.factions.list.filter((f) => f.here);
  const membership = view.factions.membership;
  const hereContested = view.factions.hereContested;

  return (
    <>
      <p className={`${styles.dim} ${styles.docNote}`} data-factions-note>
        <span>{view.factions.district ? `当前位置 · ${view.factions.district}` : "当前位置"}</span>
        <b>{here.length > 0 ? here.map((f) => f.name).join("、") : "无帮派控制"}</b>
        {hereContested && (
          <span className={styles.factionWarPill}>
            火拼争夺 · {hereContested.factionNames.join(" vs ")}
          </span>
        )}
        <span className={styles.factionAffil} data-joined={membership ? "" : undefined}>
          {membership ? (
            <>
              归属 · <b>{membership.name}</b>
              {membership.rank ? `（${membership.rank}）` : ""}
              {membership.sponsorName && (
                <>
                  {" · 引荐 "}
                  {membership.sponsorName}
                  {membership.sponsorLost ? "（已故）" : ""}
                </>
              )}
            </>
          ) : (
            "自由佣兵"
          )}
        </span>
        {membership && membership.strikes.length > 0 && (
          <span className={styles.factionStrikePill}>
            帮规污点 {membership.strikes.length}/{membership.maxStrikes}
          </span>
        )}
        <span>{view.factions.list.length} 个组织</span>
      </p>
      <div className={styles.docBody} data-factions>
        {GROUPS.map(([kind, label]) => {
          const list = view.factions.list.filter((f) => f.kind === kind);
          if (list.length === 0) return null;
          return (
            <section key={kind} className={styles.factionGroup}>
              <h3 className={styles.feedSubhead}>
                {label} <span className={styles.dim}>{list.length}</span>
              </h3>
              <ul className={styles.factionList}>
                {list.map((f) => {
                  const actions = onDraftAction ? quickActionsFor(f, membership) : [];
                  return (
                    <li
                      key={f.id}
                      className={styles.feedCard}
                      data-channel="street"
                      data-here={f.here || undefined}
                      data-member={f.member || undefined}
                    >
                      <CellFrame />
                      <header className={styles.factionHead}>
                        <FactionMark faction={f} />
                        <span className={styles.factionName}>
                          <b>{f.name}</b>
                          <small>{f.en}</small>
                        </span>
                        <span className={styles.factionBadges}>
                          {f.member && (
                            <span className={styles.factionMemberBadge}>
                              已加入{f.memberRank ? ` · ${f.memberRank}` : ""}
                            </span>
                          )}
                          {f.contestedDistricts.length > 0 && (
                            <span className={styles.factionWarPill}>火拼中</span>
                          )}
                          <span
                            className={styles.contactBadge}
                            data-tone={
                              f.attitude === "kos" || f.attitude === "hostile"
                                ? "danger"
                                : f.attitude === "friendly" || f.attitude === "family"
                                  ? "cyan"
                                  : undefined
                            }
                          >
                            {f.attitudeLabel}
                          </span>
                        </span>
                      </header>
                      {f.member && membership && membership.strikes.length > 0 && (
                        <p className={styles.factionStrikeNote}>
                          帮规污点（{membership.strikes.length}/{membership.maxStrikes}，满{" "}
                          {membership.maxStrikes} 笔除名清理门户）：
                          {membership.strikes
                            .map((s) => `${s.reason}${s.byNpcName ? `（${s.byNpcName}）` : ""}`)
                            .join("；")}
                        </p>
                      )}
                      {f.reason && (
                        <p className={styles.feedNote}>
                          {f.reason}
                          {f.changedAt && <span className={styles.dim}>（{f.changedAt}）</span>}
                        </p>
                      )}
                      <p className={styles.feedText}>{f.style}</p>
                      {f.wings.length > 0 && (
                        <div className={styles.factionWings}>
                          {f.wings.map((w) => (
                            <span
                              key={w.id}
                              className={styles.factionWingTag}
                              data-ruling={w.ruling || undefined}
                              data-vacant={w.vacant || undefined}
                              data-side={w.playerSide || undefined}
                              title={w.style}
                            >
                              <b>{w.name}</b>
                              {w.ruling && (w.vacant ? " · 领袖已亡动荡" : " · 掌权")}
                              {w.playerSide && " · 你站队"}
                              {w.leaders.length > 0 && (
                                <small>
                                  {" "}
                                  (
                                  {w.leaders
                                    .map((l) => `${l.name}${l.alive ? "" : "†"}`)
                                    .join("、")}
                                  )
                                </small>
                              )}
                            </span>
                          ))}
                        </div>
                      )}
                      {f.keyNpcs.length > 0 && (
                        <div className={styles.factionNpcs}>
                          <span className={styles.factionNpcLabel}>在册人物</span>
                          {f.keyNpcs.map((n) => (
                            <button
                              key={n.id}
                              type="button"
                              className={styles.factionNpcChip}
                              data-dead={!n.alive || undefined}
                              data-sponsor={n.isSponsor || undefined}
                              disabled={!onDraftAction || !n.alive}
                              title={`${n.role}${n.wingName ? ` · ${n.wingName}` : ""}${n.alive ? "" : "（已身亡）"}`}
                              onClick={() => {
                                if (!onDraftAction || !n.alive) return;
                                onDraftAction(
                                  `我想找${n.name}聊聊关于${f.name}的事${n.wingName ? `（尤其是${n.wingName}这边的动向）` : ""}。`,
                                );
                              }}
                            >
                              {n.name}
                              {n.isSponsor && <small>引荐</small>}
                              {!n.alive && <small>已故</small>}
                            </button>
                          ))}
                        </div>
                      )}
                      {f.id === "ncpd" &&
                        view.ncpd.alerts.map((a) => (
                          <p key={a.id} className={styles.feedNote}>
                            警情「{a.label}」在{a.locationName}（{a.district}，赏金 {a.reward}{" "}
                            欧元，
                            {a.until} 前）：{a.note}
                          </p>
                        ))}
                      {f.id === "trauma-team" && (
                        <p className={styles.feedNote}>
                          {view.trauma.active
                            ? `会籍：${view.trauma.tierLabel}，到 ${view.trauma.until}；${view.trauma.coverage.ok ? "救援保障待命" : `现在不会来（${view.trauma.coverage.why}）`}`
                            : `没有会籍${view.trauma.lapsed ? `（${view.trauma.lapsed} 过期了）` : ""}：银卡 ${view.trauma.prices.silver.toLocaleString("en-US")}、白金卡 ${view.trauma.prices.platinum.toLocaleString("en-US")} 欧元一期 30 天。银卡交火结束后来、只救倒下；白金卡交火中也来、能救濒死；恶土、狗镇不进`}
                          {view.trauma.rescues > 0 && ` · 救过你 ${view.trauma.rescues} 次`}
                        </p>
                      )}
                      {f.id === "ncpd" && view.ncpd.cleared > 0 && (
                        <p className={styles.feedNote}>处理过 {view.ncpd.cleared} 条警情</p>
                      )}
                      {f.id === "ncpd" &&
                        view.heat.bounties.map((b) => (
                          <p key={b.id} className={styles.feedNote}>
                            悬赏 {b.reward.toLocaleString("en-US")} 欧元（{b.since} 起）：
                            {b.reasons.join("；")}
                            {b.hunterName ? ` · 赏金猎人${b.hunterName}在追你` : ""}
                          </p>
                        ))}
                      <p className={styles.feedNote}>
                        {f.turf.length > 0
                          ? `地盘：${f.turf.join("、")}${f.turfNote ? `（${f.turfNote}）` : ""}`
                          : "暂无固定地盘"}
                        {f.contestedDistricts.length > 0 &&
                          ` · 争夺中：${f.contestedDistricts.join("、")}`}
                        {f.allies.length > 0 && ` · 盟友：${f.allies.join("、")}`}
                        {f.enemies.length > 0 && ` · 仇敌：${f.enemies.join("、")}`}
                        {f.turf.join("、") !== f.baseTurf.join("、") &&
                          ` · 原来的地盘：${f.baseTurf.length > 0 ? f.baseTurf.join("、") : "没有"}`}
                      </p>
                      {f.news.map((n) => (
                        <p key={`${n.at}-${n.turf}`} className={styles.feedNote}>
                          {n.turf}
                          <span className={styles.dim}>（{n.time}）</span>
                        </p>
                      ))}
                      {actions.length > 0 && onDraftAction && (
                        <div className={styles.factionActions}>
                          {actions.map((action) => (
                            <button
                              key={action.label}
                              type="button"
                              className={styles.factionActionBtn}
                              data-tone={action.tone}
                              onClick={() => onDraftAction(action.draft)}
                            >
                              {action.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </>
  );
}
