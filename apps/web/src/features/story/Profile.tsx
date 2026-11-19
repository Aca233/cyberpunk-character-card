import { worldRules } from "@cp/core";
import { type CSSProperties, useState } from "react";
import { ActionButton } from "../../ui/ActionButton";
import { Asset, cssUrl, NineSlice } from "../../ui/Asset";
import { GeneratedImage } from "../images/GeneratedImage";
import { useSaveImages } from "../images/SaveImagesContext";
import { baseWeaponIdOf, itemArtOf, portraitOf } from "./art";
import neural from "./neural.module.css";
import styles from "./profile.module.css";
import { npcWoundSummary, type View } from "./view";

type Npc = View["npcs"][number];
/** 中间人的派单信息（委托系统按好感、声望和势力算）；人物档案里同 id 的中间人才有 */
type Fixer = View["jobs"]["fixers"][number];
export type SquadMember = View["squad"]["members"][number];
export type CombatFoe = NonNullable<View["combat"]["active"]>["foes"][number];

/** 同四角在场的人用的 map.filterCell*、map.panel* 切法（计划第九节） */
const CELL_SLICE = [20, 30, 30, 20] as const;
/**
 * 档案头用原作对话选中行 dialog.lineSelect（480×72 实心条，右下切角约 14 原图像素），
 * 切线 上 4、右 20、下 20、左 4；和四角块的 map.panel 区分开，不再所有框都一个样（用户定的，计划第十二节第 14 条）。
 * 圆角的 panel.cell* 看过预览不像原作切角风格，不用
 */
const HEAD_SLICE = [4, 20, 20, 4] as const;
/** 好感的范围，同 core 的 AFFINITY_MAX */
const AFFINITY_MAX = 100;

/** 扫描出的人性阶段转威胁档位 */
export function threatOfHumanity(stage: string): "high" | "even" | "low" {
  if (stage === "边缘" || stage === "临界" || stage === "危机") return "high";
  if (stage === "不稳定" || stage === "疏离") return "even";
  return "low";
}

/** 好感度语气档位 */
export function affinityTone(affinity: number): "pos" | "neg" | "neutral" {
  if (affinity >= 20) return "pos";
  if (affinity <= -10) return "neg";
  return "neutral";
}

/** 带符号的好感度文本 */
export function formatAffinity(affinity: number): string {
  return affinity > 0 ? `+${affinity}` : `${affinity}`;
}

/** 人物关系/战斗态势的统一边框语气 */
export function profileTone(
  npc: Pick<Npc, "met" | "affinity" | "nemesis">,
  squad?: SquadMember,
  foe?: CombatFoe,
): "hostile" | "nemesis" | "ally" | undefined {
  if (foe) return "hostile";
  if (npc.nemesis && !npc.nemesis.ended) return "nemesis";
  if (squad || (npc.met && npc.affinity >= 50)) return "ally";
  return undefined;
}

/** 共用双向好感刻度条（原作 cyber.gaugeBar，0 为中线，正黄负红） */
export function AffinityMeter({
  affinity,
  className,
}: {
  readonly affinity: number;
  readonly className?: string | undefined;
}) {
  const fill = Math.min(1, Math.abs(affinity) / AFFINITY_MAX);
  return (
    <span
      className={className}
      data-neg={affinity < 0 || undefined}
      style={{ "--fill": fill } as CSSProperties}
      aria-hidden
    >
      <NineSlice
        id="cyber.gaugeBar"
        tint={affinity < 0 ? "rgb(255 97 88 / 32%)" : "rgb(94 246 255 / 32%)"}
        slice={0}
      />
      <span className={styles.affinityFill}>
        <NineSlice
          id="cyber.gaugeBar"
          tint={affinity < 0 ? "var(--cp-red)" : "var(--cp-yellow)"}
          slice={0}
        />
      </span>
    </span>
  );
}

/**
 * 切角头像格：有原作头像用原作图，未照面且无原作头像时显示 portrait.unknown 全息轮廓，
 * 认识但无原作头像的显示名字首字；框用原作 map.filterCell*
 */
export function NpcPortrait({
  npc,
  className,
  artClassName,
  line = "var(--cp-cyan)",
  tint = "rgb(14 14 23 / 78%)",
}: {
  readonly npc: Pick<Npc, "id" | "name" | "met" | "alive">;
  readonly className?: string | undefined;
  readonly artClassName?: string | undefined;
  readonly line?: string;
  readonly tint?: string;
}) {
  const saveImages = useSaveImages();
  const customId = saveImages?.bindings.npcs[npc.id] ?? null;
  const portrait = portraitOf(npc.id);
  return (
    <span className={className} data-dead={!npc.alive || undefined} aria-hidden>
      <NineSlice id="map.filterCellBg" tint={tint} slice={CELL_SLICE} />
      {customId ? (
        <GeneratedImage
          imageId={customId}
          alt={npc.name}
          className={artClassName}
          fallback={
            portrait ? (
              <Asset id={portrait} className={artClassName} />
            ) : !npc.met ? (
              <Asset id="portrait.unknown" className={artClassName} />
            ) : (
              <b className={artClassName}>{[...npc.name][0] ?? "?"}</b>
            )
          }
        />
      ) : portrait ? (
        <Asset id={portrait} className={artClassName} />
      ) : !npc.met ? (
        <Asset id="portrait.unknown" className={artClassName} />
      ) : (
        <b className={artClassName}>{[...npc.name][0] ?? "?"}</b>
      )}
      <NineSlice id="map.filterCellFg" tint={line} slice={CELL_SLICE} />
    </span>
  );
}

/** 一句话写这个人现在在哪、死活 */
function whereabouts(npc: Npc): string {
  if (!npc.alive) return "已故";
  if (!npc.met) return npc.nemesis ? "交过手" : "只听说过";
  if (npc.here) return "在场";
  return npc.lastSeen ? `最后见面 ${npc.lastSeen}` : "不在场";
}

/** 原作 cyber.gaugeLabel 小牌，颜色由 tint 给 */
function Tag({
  tint,
  lightInk,
  title,
  children,
}: {
  readonly tint: string;
  readonly lightInk?: boolean | undefined;
  readonly title?: string | undefined;
  readonly children: string;
}) {
  return (
    <li className={styles.tag} data-ink={lightInk ? "light" : undefined} title={title}>
      <NineSlice id="cyber.gaugeLabel" tint={tint} slice={4} />
      <b>{children}</b>
    </li>
  );
}

/** 左栏身份卡：统一沿用 dialog.lineSelect 软底与点阵；独立悬停浮层额外保留柔光与侧边色条 */
export function ProfileHead({
  npc,
  fixer,
  squad,
  foe,
  embedded = false,
}: {
  readonly npc: Npc;
  readonly fixer?: Fixer | undefined;
  readonly squad?: SquadMember | undefined;
  readonly foe?: CombatFoe | undefined;
  readonly embedded?: boolean | undefined;
}) {
  const tone = profileTone(npc, squad, foe);
  const wound = npcWoundSummary(npc.body);
  const hasFaction = Boolean(npc.faction && npc.faction !== "无");
  const showLastPlace = !npc.here && Boolean(npc.lastPlace);
  const showBlocked = Boolean(fixer?.blocked && fixer.blockReason);
  const metaRows: readonly (readonly [string, string])[] = [
    ...(hasFaction && npc.faction ? ([["势力", npc.faction]] as const) : []),
    ...(showLastPlace && npc.lastPlace ? ([["最后出现", npc.lastPlace]] as const) : []),
    ...(npc.homePlace ? ([["常在地点", npc.homePlace]] as const) : []),
    ...(npc.doing ? ([["近期动向", npc.doing]] as const) : []),
    ...(showBlocked && fixer?.blockReason ? ([["中间人渠道", fixer.blockReason]] as const) : []),
  ];
  const hasAppearance = npc.met && Boolean(npc.look || npc.outfit);
  const saveImages = useSaveImages();
  const customPortraitId = saveImages?.bindings.npcs[npc.id] ?? null;
  const hasBuiltinPortrait = Boolean(portraitOf(npc.id));

  return (
    <header
      className={embedded ? styles.head : `${styles.head} ${styles.headStandalone}`}
      data-tone={tone}
      data-dead={!npc.alive || undefined}
    >
      <NineSlice
        id="dialog.lineSelect"
        tint="var(--head-bg, rgb(14 14 23 / 84%))"
        slice={HEAD_SLICE}
      />
      {!embedded && (
        <>
          <NineSlice
            id="panel.glowLeft"
            tint="var(--head-glow, rgb(94 246 255 / 14%))"
            slice={[16, 20, 16, 20]}
            className={styles.headGlow}
          />
          <NineSlice
            id="cyber.cellRarity"
            tint="var(--portrait-line, var(--cp-cyan))"
            slice={0}
            className={styles.headRail}
          />
        </>
      )}
      {/* 档案点阵：原作 fx.grid 按约半尺寸平铺，静态低透明度，不影响阅读 */}
      <span
        className={styles.headGrid}
        style={{ backgroundImage: cssUrl("fx.grid") }}
        aria-hidden
      />

      <div className={styles.headTop}>
        <NpcPortrait
          npc={npc}
          className={styles.portrait}
          artClassName={styles.portraitArt}
          line="var(--portrait-line, var(--cp-cyan))"
        />
        <div className={styles.identity}>
          <h3 className={styles.name}>
            {npc.name}
            {npc.alias && <small>{`// ${npc.alias}`}</small>}
            {npc.pronoun && <small className={styles.pronoun}>· {npc.pronoun}</small>}
          </h3>
          <ul className={styles.tags}>
            <Tag tint={npc.alive ? "var(--cp-cyan)" : "var(--cp-text-dim)"}>{whereabouts(npc)}</Tag>
            {foe && (
              <Tag tint="var(--cp-danger)" lightInk>
                {foe.stateLabel}
              </Tag>
            )}
            {npc.nemesis && (
              <Tag tint="var(--cp-red)" lightInk={!npc.nemesis.ended}>
                {npc.nemesis.ended ? "旧宿敌" : "宿敌"}
              </Tag>
            )}
            {squad && (
              <Tag tint="var(--cp-yellow)">
                {squad.specialty ? `小队 · ${squad.specialty}` : "小队"}
              </Tag>
            )}
            {fixer && <Tag tint="var(--cp-yellow)">中间人</Tag>}
            {npc.body?.scan?.chrome.some((c) => c.netTag === "deck") && (
              <Tag tint="var(--cp-cyan)">接入仓</Tag>
            )}
            {npc.body?.scan?.chrome.some((c) => c.netTag === "selfIce") && (
              <Tag tint="var(--cp-yellow)">自我 ICE</Tag>
            )}
            {wound.badge && (
              <Tag
                tint={wound.threat === "high" ? "var(--cp-danger)" : "var(--cp-yellow)"}
                lightInk={wound.threat === "high"}
                title={wound.detail ?? undefined}
              >
                {wound.badge}
              </Tag>
            )}
          </ul>
          {saveImages && npc.met && (
            <div className={styles.portraitTools}>
              <ActionButton
                onClick={() =>
                  saveImages.openImageModal({
                    title: customPortraitId ? `重绘 ${npc.name} 肖像` : `AI 生成 ${npc.name} 肖像`,
                    subtitle: [npc.role, npc.faction && npc.faction !== "无" ? npc.faction : ""]
                      .filter(Boolean)
                      .join(" · "),
                    defaultAspectRatio: "3:4",
                    bind: { kind: "npc", npcId: npc.id },
                    promptRequest: {
                      kind: "npc",
                      name: npc.name,
                      alias: npc.alias,
                      pronoun: npc.pronoun,
                      role: npc.role,
                      faction: npc.faction,
                      look: npc.look,
                      outfit: npc.outfit,
                      wounds: wound.detail,
                      cyberware: npc.body?.scan?.chrome.map((item) => item.name) ?? [],
                      gear: npc.body?.gear.map((item) => item.name) ?? [],
                      instruction: "",
                    },
                  })
                }
              >
                {customPortraitId ? "重绘肖像" : hasBuiltinPortrait ? "AI 定制肖像" : "AI 生成肖像"}
              </ActionButton>
              {customPortraitId && (
                <>
                  <ActionButton
                    onClick={() => saveImages.openLightbox(customPortraitId, `${npc.name} · 肖像`)}
                  >
                    查看大图
                  </ActionButton>
                  <ActionButton
                    onClick={() => void saveImages.unbindImage({ kind: "npc", npcId: npc.id })}
                  >
                    恢复默认
                  </ActionButton>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {npc.met ? (
        <div className={styles.brief}>
          <p className={styles.briefRole}>{npc.role}</p>
          {metaRows.length > 0 && (
            <dl className={styles.briefFacts}>
              {metaRows.map(([label, value]) => (
                <div key={label} className={styles.briefRow}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          )}
          <div className={styles.affinityBlock} data-tone={affinityTone(npc.affinity)}>
            <div className={styles.affinityTop}>
              <span>关系好感</span>
              <b className={styles.affinityVal} data-tone={affinityTone(npc.affinity)}>
                {formatAffinity(npc.affinity)}
              </b>
            </div>
            <AffinityMeter affinity={npc.affinity} className={styles.affinity} />
          </div>
        </div>
      ) : (
        <p className={styles.note}>
          {npc.nemesis ? "只在交手时照过面，底细还不清楚。" : "还没见过面，下面是听来的。"}
        </p>
      )}

      {hasAppearance && (
        <>
          <span
            className={styles.headRule}
            style={{ maskImage: cssUrl("tab.line"), WebkitMaskImage: cssUrl("tab.line") }}
            aria-hidden
          />
          <div className={styles.lookStrip}>
            {/* 外貌：见过面的人才有 */}
            {npc.look && (
              <p className={styles.look}>
                <em className={styles.lookKey}>外貌</em>
                <span>{npc.look}</span>
              </p>
            )}
            {/* 现在穿（用户定的，2026-11-02："长相 + 当前穿着"）：换装后跟着变；旧卡衣着还在外貌里时不显示 */}
            {npc.outfit && (
              <p className={styles.look}>
                <em className={styles.lookKey}>衣着</em>
                <span>{npc.outfit}</span>
              </p>
            )}
          </div>
        </>
      )}
    </header>
  );
}

/** 关系与情报分栏：细左竖线与轻衬底平铺关系态势、共同记忆（含人情和仇）、已知情报与认识的人 */
function OverviewSection({
  npc,
  squad,
  foe,
}: {
  readonly npc: Npc;
  readonly squad?: SquadMember | undefined;
  readonly foe?: CombatFoe | undefined;
}) {
  const unsettledLedger = npc.ledger.filter((e) => e.settled === null);
  const settledLedger = npc.ledger.filter((e) => e.settled !== null);
  const concerns = npc.arc?.concerns ?? [];
  const hasMemories = npc.ledger.length > 0 || npc.memories.length > 0;
  const hasKnownInfo = npc.known.length > 0 || concerns.length > 0;
  const hasTies = npc.ties.length > 0;
  const hasOther = hasKnownInfo || hasTies;
  const showSquadDoing = Boolean(squad?.doing && squad.doing !== npc.doing);
  const tone = profileTone(npc, squad, foe);
  const relationTone =
    tone === "hostile" || tone === "nemesis"
      ? "danger"
      : tone === "ally" || npc.affinity >= 20
        ? "ally"
        : "neutral";
  const memoryCount = npc.ledger.length + npc.memories.length;
  const knownCount = npc.known.length + concerns.length;

  const memoryBlock = hasMemories && (
    <div className={styles.subSection}>
      <header className={styles.subHead}>
        <h3 className={styles.subTitle}>共同记忆</h3>
        <span className={styles.subCount}>{memoryCount}</span>
      </header>
      <ul className={styles.list}>
        {unsettledLedger.map((e) => (
          <li key={`${e.at}|${e.kind}|${e.text}`}>
            <span className={styles.kind} data-tone={e.kind === "grudge" ? "danger" : "accent"}>
              {e.label}
            </span>
            {e.text}
            <small>{e.at} · 未了结</small>
          </li>
        ))}
        {npc.memories.map((m) => (
          <li key={m}>
            <span className={styles.kind} data-tone="memory">
              记忆
            </span>
            {m}
          </li>
        ))}
        {settledLedger.map((e) => (
          <li key={`${e.at}|${e.kind}|${e.text}`} data-settled>
            <span className={styles.kind} data-tone={e.kind === "grudge" ? "danger" : "accent"}>
              {e.label}
            </span>
            {e.text}
            <small>
              {e.at}，{e.settled} 了结{e.how ? `：${e.how}` : ""}
            </small>
          </li>
        ))}
      </ul>
    </div>
  );

  const knownBlock = hasKnownInfo && (
    <div className={styles.subSection}>
      <header className={styles.subHead}>
        <h3 className={styles.subTitle}>已知情报</h3>
        <span className={styles.subCount}>{knownCount}</span>
      </header>
      <ul className={styles.list}>
        {npc.known.map((k) => (
          <li key={k.text}>
            <span className={styles.kind}>{k.sourceLabel}</span>
            {k.text}
            <small>{k.at}</small>
          </li>
        ))}
        {concerns.map((c) => (
          <li key={c.id}>
            <span className={styles.kind} data-tone="warn">
              心事 · {c.statusLabel}
            </span>
            {c.title}
            {c.outcome && <small>{c.outcome}</small>}
          </li>
        ))}
      </ul>
    </div>
  );

  const tiesBlock = hasTies && (
    <div className={styles.subSection}>
      <header className={styles.subHead}>
        <h3 className={styles.subTitle}>认识的人</h3>
        <span className={styles.subCount}>{npc.ties.length}</span>
      </header>
      <ul className={styles.list}>
        {npc.ties.map((t) => (
          <li key={t.id} data-settled={!t.alive || undefined}>
            <span className={styles.kind} data-tone="tie">
              {t.name}
            </span>
            {t.text}
            {!t.alive && <small>已故</small>}
          </li>
        ))}
      </ul>
    </div>
  );

  return (
    <section className={styles.sectionBody} aria-label="关系与情报">
      <div className={styles.overviewStack}>
        <div
          className={styles.relationCallout}
          data-tone={relationTone}
          data-empty={!npc.relation || undefined}
        >
          <p className={styles.relationText}>{npc.relation ?? "还说不上什么关系。"}</p>
        </div>

        {foe && (
          <div className={styles.contextCallout} data-tone="danger">
            <p className={styles.contextMeta}>
              <strong>交战状态：{foe.stateLabel}</strong>
              {foe.gang && ` · ${foe.gang}`}
            </p>
            {foe.carry.length > 0 && (
              <p className={styles.contextMeta}>
                随身可拾取：{foe.carry.map((i) => i.name).join("、")}
              </p>
            )}
          </div>
        )}

        {squad && (
          <div className={styles.contextCallout} data-tone="ally">
            <p className={styles.contextMeta}>
              <strong>
                小队 · {squad.statusLabel}（{squad.kindLabel}）
              </strong>{" "}
              · {squad.terms}
            </p>
            {showSquadDoing && <p className={styles.contextMeta}>在忙：{squad.doing}</p>}
            <p className={styles.contextMeta}>个人麻烦：{squad.trouble}</p>
            {squad.owed > 0 && (
              <p className={styles.contextWarn}>
                欠薪 {squad.owed} 周{squad.leavesAt ? `（${squad.leavesAt} 前不发就走）` : ""}
              </p>
            )}
          </div>
        )}

        {npc.nemesis && (
          <div className={styles.contextCallout} data-tone="danger">
            <p className={styles.contextMeta}>
              <strong>{npc.nemesis.ended ? "旧宿敌恩怨" : "宿敌恩怨"}</strong> · {npc.nemesis.since}
              ：{npc.nemesis.how}
            </p>
            {npc.nemesis.ended ? (
              <p className={styles.contextMeta}>结局：{npc.nemesis.ended}</p>
            ) : (
              npc.nemesis.prep && <p className={styles.contextWarn}>动向：{npc.nemesis.prep}</p>
            )}
          </div>
        )}

        {hasMemories && hasOther ? (
          <div className={styles.duoGrid}>
            {memoryBlock}
            <div className={styles.subStack}>
              {knownBlock}
              {tiesBlock}
            </div>
          </div>
        ) : (
          <>
            {memoryBlock}
            {knownBlock}
            {tiesBlock}
          </>
        )}

        {!hasMemories && !hasOther && (
          <p className={styles.emptyNote}>还没攒下共同记忆，也还没打听到更多消息。</p>
        )}
      </div>
    </section>
  );
}

/** 身体与扫描：生物监测风格细线指标条 + 具体创伤明细 + 植入体行 + 底栏扫描动作 */
function BodySection({
  body,
  onScan,
}: {
  readonly body: NonNullable<Npc["body"]>;
  readonly onScan?: (() => void) | undefined;
}) {
  const { scan } = body;
  const wound = npcWoundSummary(body);
  const injuries = body.injuries ?? [];
  const scanTimeText = scan
    ? scan.at > 0
      ? `扫于 ${worldRules.formatGameTime(scan.at)}`
      : "已建档"
    : null;
  const scanFootText = scan
    ? scan.chrome.length === 0
      ? `${scanTimeText} · 未检出植入体`
      : `${scanTimeText} · 检出 ${scan.chrome.length} 件植入体`
    : "尚未扫描；用义眼扫描可识别神经稳态与植入体。";

  return (
    <section className={styles.sectionBody} aria-label="身体与扫描">
      <dl className={styles.telemetry}>
        <div className={styles.telemetryRow}>
          <dt>伤势状态</dt>
          <dd className={styles.telemetryVal} data-threat={wound.threat}>
            {wound.headline}
          </dd>
        </div>
        <div className={`${styles.telemetryRow} ${styles.gearRow}`}>
          <dt>随身装备</dt>
          <dd className={styles.telemetryVal}>
            {body.gear.length > 0 ? (
              <ul className={styles.gearList} aria-label="随身装备清单">
                {body.gear.map((item) => {
                  const baseId =
                    "baseId" in item && typeof item.baseId === "string" ? item.baseId : item.id;
                  const art = itemArtOf(baseId);
                  const label = item.name.startsWith("wpn:")
                    ? baseWeaponIdOf(item.name)
                    : item.name;
                  return (
                    <li key={item.id} className={styles.gearItem}>
                      {art && <Asset id={art} alt={label} className={styles.gearArt} />}
                      <span>{label}</span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              "—"
            )}
          </dd>
        </div>
        {scan && (
          <div className={styles.telemetryRow}>
            <dt>神经稳态</dt>
            <dd className={styles.telemetryVal} data-threat={threatOfHumanity(scan.humanityStage)}>
              {scan.humanityStage}
            </dd>
          </div>
        )}
      </dl>

      {injuries.length > 0 ? (
        <div className={styles.subSection}>
          <header className={styles.subHead}>
            <h3 className={styles.subTitle}>创伤明细</h3>
            <span className={styles.subCount}>{injuries.length}</span>
          </header>
          <ul className={styles.woundList} aria-label="具体伤势">
            {injuries.map((inj) => (
              <li key={inj.id} className={styles.woundItem} data-tier={inj.tier}>
                <span className={styles.woundPart}>{inj.partLabel}</span>
                <span className={styles.woundInfo}>
                  <b>
                    {inj.tierLabel} · {inj.cause}
                  </b>
                  <small>{worldRules.formatGameTime(inj.at)}</small>
                </span>
                <span className={styles.woundTag} data-treated={inj.treated || undefined}>
                  {inj.treated ? "已处理" : "未处理"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        body.wound !== "没受伤" && (
          <p className={styles.emptyNote}>当前呈{body.wound}状态，暂无具体部位创口记录。</p>
        )
      )}

      {scan && scan.chrome.length > 0 && (
        <div className={styles.subSection}>
          <header className={styles.subHead}>
            <h3 className={styles.subTitle}>已检出植入体</h3>
            <span className={styles.subCount}>{scan.chrome.length}</span>
          </header>
          <ul className={styles.chromeList}>
            {scan.chrome.map((c) => {
              const art = itemArtOf(c.id);
              return (
                <li key={c.id} className={styles.chromeItem} data-art={art ? true : undefined}>
                  {art && <Asset id={art} alt={c.name} className={styles.chromeArt} />}
                  <div className={styles.chromeCopy}>
                    <div className={styles.chromeHead}>
                      <b>{c.name}</b>
                      {c.slot && <span className={styles.chromeSlot}>{c.slot}</span>}
                      {c.netTag === "deck" && <span className={styles.chromeSlot}>接入仓</span>}
                      {c.netTag === "selfIce" && (
                        <span className={styles.chromeSlot}>自我 ICE</span>
                      )}
                    </div>
                    {c.ability && <p className={styles.chromeDesc}>{c.ability}</p>}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className={styles.bodyFoot}>
        <span className={styles.scanFootNote}>{scanFootText}</span>
        {/* 点一下立刻扫（用户定的，计划第十二节第 14 条）：沿用 tab.bg 与义眼青色体系 */}
        {onScan && (
          <button type="button" className={`${neural.tab} ${styles.scanButton}`} onClick={onScan}>
            <NineSlice id="tab.bg" tint="currentColor" slice={14} className={neural.tabBg} />
            <span className={neural.inner}>
              <Asset id="interaction.scan" tint="currentColor" height={14} />
              {scan ? "再扫一次" : "义眼扫描"}
            </span>
          </button>
        )}
      </div>
    </section>
  );
}

type TabId = "relation" | "body";
type Tab = readonly [TabId, string, number];

/** 下面各栏的页签：整合为「关系与情报」「身体与扫描」两栏，避免碎片化 */
function profileTabs(npc: Npc): Tab[] {
  const relationAlerts =
    npc.ledger.filter((e) => e.settled === null).length +
    (npc.nemesis && !npc.nemesis.ended ? 1 : 0);
  const tabs: Tab[] = [["relation", "关系与情报", relationAlerts]];
  if (npc.body) tabs.push(["body", "身体与扫描", npc.body.injuries.length]);
  return tabs;
}

/**
 * 人物档案：左栏 Kiroshi 身份卡 + 右栏双页签（关系与情报、身体与扫描）；
 * 去掉多层套框与空心方块格，宽容器左右并排、窄容器自然叠排。
 */
export function Profile({
  npc,
  fixer,
  squad,
  foe,
  onScan,
}: {
  readonly npc: Npc;
  /** 这个人是中间人时传委托系统算的派单信息（用户定的，2026-11-02：中间人并进人物档案） */
  readonly fixer?: Fixer | undefined;
  readonly squad?: SquadMember | undefined;
  readonly foe?: CombatFoe | undefined;
  /** 有就在身体栏里出「扫描」按钮：点一下立刻用义眼扫，不调模型（用户定的，计划第十二节第 14 条） */
  readonly onScan?: ((id: string) => void) | undefined;
}) {
  const tabs = profileTabs(npc);
  const [picked, setPicked] = useState<TabId | null>(null);
  // 未照面且有身体情报时默认切到「身体与扫描」（如战场上扫描陌生敌人），否则留在「关系与情报」
  const fallback: TabId = !npc.met && npc.body ? "body" : "relation";
  const wanted = picked ?? fallback;
  // 换了人、这一栏没有时退回关系与情报
  const tab = tabs.some(([id]) => id === wanted) ? wanted : "relation";
  return (
    <article className={styles.profile} aria-label={`${npc.name}的档案`}>
      <div className={styles.profileGrid}>
        <ProfileHead npc={npc} fixer={fixer} squad={squad} foe={foe} embedded />
        <div className={styles.workspace}>
          <nav className={styles.tabs} aria-label="档案分栏">
            {tabs.map(([id, name, count]) => (
              <button
                key={id}
                type="button"
                className={neural.tab}
                aria-pressed={id === tab}
                data-danger={
                  (id === "relation" &&
                    (Boolean(foe) || Boolean(npc.nemesis && !npc.nemesis.ended))) ||
                  (id === "body" && npcWoundSummary(npc.body).threat === "high") ||
                  undefined
                }
                onClick={() => setPicked(id)}
              >
                <NineSlice id="tab.bg" tint="currentColor" slice={14} className={neural.tabBg} />
                <span className={neural.inner}>
                  {name}
                  {count > 0 && <b className={neural.badge}>{count}</b>}
                </span>
                {id === tab && (
                  <span
                    className={styles.tabActiveLine}
                    style={{ maskImage: cssUrl("tab.line"), WebkitMaskImage: cssUrl("tab.line") }}
                    aria-hidden
                  />
                )}
              </button>
            ))}
          </nav>
          <div className={styles.pane} key={tab}>
            {tab === "relation" && <OverviewSection npc={npc} squad={squad} foe={foe} />}
            {tab === "body" && npc.body && (
              <BodySection body={npc.body} onScan={onScan && (() => onScan(npc.id))} />
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
