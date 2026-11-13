import { type CSSProperties, useState } from "react";
import { Asset, cssUrl, NineSlice } from "../../ui/Asset";
import { Panel } from "../../ui/Panel";
import { portraitOf } from "./art";
import neural from "./neural.module.css";
import styles from "./profile.module.css";
import type { View } from "./view";

type Npc = View["npcs"][number];
/** 中间人的派单信息（委托系统按好感、声望和势力算）；人物档案里同 id 的中间人才有 */
type Fixer = View["jobs"]["fixers"][number];

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

/** 一句话写这个人现在在哪、死活 */
function whereabouts(npc: Npc): string {
  if (!npc.alive) return "已故";
  if (!npc.met) return npc.nemesis ? "交过手" : "只听说过";
  if (npc.here) return "在场";
  return npc.lastSeen ? `最后见面 ${npc.lastSeen}` : "不在场";
}

/** 原作 cyber.gaugeLabel 小牌，颜色由 tint 给 */
function Tag({ tint, children }: { readonly tint: string; readonly children: string }) {
  return (
    <li className={styles.tag}>
      <NineSlice id="cyber.gaugeLabel" tint={tint} slice={4} />
      <b>{children}</b>
    </li>
  );
}

/** 头一块：左边原作头像格，右边名字、状态牌和信息栏；私信页头像浮层也只用这一块（用户定的，计划第十二节第 14 条） */
export function ProfileHead({
  npc,
  fixer,
}: {
  readonly npc: Npc;
  readonly fixer?: Fixer | undefined;
}) {
  const portrait = portraitOf(npc.id);
  return (
    <header className={styles.head}>
      {/* dialog.lineSelect 是一整块实心条、没有描边层，只铺一层深色底；青色线条留给头像格 */}
      <NineSlice id="dialog.lineSelect" tint="rgb(14 14 23 / 78%)" slice={HEAD_SLICE} />
      {/* 档案底纹（计划第十二节第 9 条、第 14 条）：原作点阵垫在头像和信息下面，不占布局、不接收点击 */}
      <span
        className={styles.headGrid}
        style={{ backgroundImage: cssUrl("fx.grid") }}
        aria-hidden
      />
      <span className={styles.portrait} data-dead={!npc.alive || undefined} aria-hidden>
        <NineSlice id="map.filterCellBg" tint="rgb(14 14 23 / 72%)" slice={CELL_SLICE} />
        {portrait ? (
          <Asset id={portrait} className={styles.portraitArt} />
        ) : (
          <b className={styles.portraitArt}>{[...npc.name][0] ?? "?"}</b>
        )}
        <NineSlice id="map.filterCellFg" tint="var(--cp-cyan)" slice={CELL_SLICE} />
      </span>
      <ProfileInfo npc={npc} fixer={fixer} />
    </header>
  );
}

/** 信息栏：名字和外号、状态牌，见过面的人再列身份、代词、地点和好感条；中间人再列派单上限 */
function ProfileInfo({ npc, fixer }: { readonly npc: Npc; readonly fixer?: Fixer | undefined }) {
  const fill = Math.min(1, Math.abs(npc.affinity) / AFFINITY_MAX);
  return (
    <div className={styles.info}>
      <h3 className={styles.name}>
        {npc.name}
        {npc.alias && <small>外号 {npc.alias}</small>}
      </h3>
      <ul className={styles.tags}>
        <Tag tint={npc.alive ? "var(--cp-cyan)" : "var(--cp-text-dim)"}>{whereabouts(npc)}</Tag>
        {npc.nemesis && <Tag tint="var(--cp-red)">{npc.nemesis.ended ? "旧宿敌" : "宿敌"}</Tag>}
      </ul>
      {npc.met ? (
        /* 信息压成一行小字（计划第十二节第 14 条）：身份、代词、地点、好感按顺序排，没有的就不写，好感条缩成一小截 */
        <div className={styles.brief}>
          <span>{npc.role}</span>
          {/* 所属势力（用户 2026-10-31："npc加个所属势力 没有就填无"）：不属于任何势力显示「无」 */}
          {npc.faction && <span>势力 {npc.faction}</span>}
          <span>{npc.pronoun}</span>
          {npc.lastPlace && <span>最后出现 {npc.lastPlace}</span>}
          {npc.homePlace && <span>常在 {npc.homePlace}</span>}
          <span className={styles.briefAffinity}>
            好感 {npc.affinity > 0 ? "+" : ""}
            {npc.affinity}
            <span
              className={styles.affinity}
              data-neg={npc.affinity < 0 || undefined}
              style={{ "--fill": fill } as CSSProperties}
              aria-hidden
            >
              <NineSlice id="cyber.gaugeBar" tint="rgb(255 190 40 / 18%)" slice={0} />
              <span className={styles.affinityFill}>
                <NineSlice
                  id="cyber.gaugeBar"
                  tint={npc.affinity < 0 ? "var(--cp-red)" : "var(--cp-yellow)"}
                  slice={0}
                />
              </span>
            </span>
          </span>
          {/* 中间人并进人物档案（用户定的，2026-11-02）：派单上限和卡在哪，原先在日志页单独一个中间人面板 */}
          {fixer && (
            <span>
              派单 {fixer.maxRisk > 0 ? `最多 ${fixer.maxRisk} 星` : "暂停"}
              {fixer.capHint && ` · ${fixer.capHint}`}
            </span>
          )}
        </div>
      ) : (
        <p className={styles.note}>
          {npc.nemesis ? "只在交手时照过面，底细还不清楚。" : "还没见过面，下面是听来的。"}
        </p>
      )}
      {/* 外貌：见过面的人才有，一整句放在信息栏最底下 */}
      {npc.met && <p className={styles.look}>{npc.look}</p>}
      {/* 现在穿（用户定的，2026-11-02："长相 + 当前穿着"）：换装后跟着变；旧卡衣着还在外貌里时不显示 */}
      {npc.met && npc.outfit && <p className={styles.look}>现在穿：{npc.outfit}</p>}
    </div>
  );
}

/** 宿敌：怎么输给你的、在准备什么，了结了写怎么了结的 */
function NemesisSection({ nemesis }: { readonly nemesis: NonNullable<Npc["nemesis"]> }) {
  return (
    <Panel as="section" title={nemesis.ended ? "旧宿敌" : "宿敌"} line="var(--cp-red)">
      <ul className={styles.list}>
        <li>
          怎么输给你的：{nemesis.how}
          <small>{nemesis.since} 结下梁子</small>
        </li>
        {nemesis.ended ? (
          <li className={styles.relation}>{nemesis.ended}</li>
        ) : (
          nemesis.prep && <li>在准备：{nemesis.prep}</li>
        )}
      </ul>
    </Panel>
  );
}

/** 身体：伤势和装备；扫描过的列出精神稳定性与义体 */
function BodySection({
  body,
  onScan,
}: {
  readonly body: NonNullable<Npc["body"]>;
  readonly onScan?: (() => void) | undefined;
}) {
  const { scan } = body;
  return (
    <Panel as="section" title="身体" line="var(--cp-cyan)">
      <dl className={styles.facts}>
        <dt>伤势</dt>
        <dd>{body.wound}</dd>
        <dt>装备</dt>
        <dd>{body.gear.join("、") || "—"}</dd>
        {scan && (
          <>
            <dt>精神稳定性</dt>
            <dd>{scan.humanityStage}</dd>
          </>
        )}
      </dl>
      {scan ? (
        <ul className={styles.list}>
          {/* 义体带部位和效果（用户 2026-11-02："npc的义体是不是太简单了，只有一个文字描述"）：沿用列表样式，部位放小牌 */}
          {scan.chrome.length === 0 ? (
            <li>义体：没扫出义体</li>
          ) : (
            scan.chrome.map((c) => (
              <li key={c.name}>
                {c.slot && <span className={styles.kind}>{c.slot}</span>}
                {c.name}
                {c.ability && <small>{c.ability}</small>}
              </li>
            ))
          )}
        </ul>
      ) : (
        <p className={styles.note}>没扫描过；用义眼扫一下能看出对方装了什么义体和精神状态。</p>
      )}
      {/* 点一下立刻扫（用户定的，计划第十二节第 14 条）：按钮用原作 tab.bg，同上面的页签；没装义眼由后端拒绝、提示条说明 */}
      {onScan && (
        <button type="button" className={`${neural.tab} ${styles.scanButton}`} onClick={onScan}>
          <NineSlice id="tab.bg" tint="currentColor" slice={14} className={neural.tabBg} />
          <span className={neural.inner}>
            <Asset id="interaction.scan" tint="currentColor" height={14} />
            {scan ? "再扫一次" : "扫描"}
          </span>
        </button>
      )}
    </Panel>
  );
}

type TabId = "relation" | "ties" | "nemesis" | "body" | "known" | "arc" | "ledger" | "memories";
type Tab = readonly [TabId, string, number];

/** 下面各栏的页签（计划第十二节第 14 条）：只列这个人有的栏，角标是条数 */
function profileTabs(npc: Npc): Tab[] {
  const tabs: Tab[] = [["relation", "关系", 0]];
  // 认识的人（用户 2026-10-31："npc也有自己的生活，也有认识的npc"）：有才列
  if (npc.ties.length > 0) tabs.push(["ties", "认识的人", npc.ties.length]);
  if (npc.nemesis) tabs.push(["nemesis", npc.nemesis.ended ? "旧宿敌" : "宿敌", 0]);
  if (npc.body) tabs.push(["body", "身体", 0]);
  tabs.push(["known", "你知道的", npc.known.length]);
  if (npc.arc) tabs.push(["arc", "心事", npc.arc.concerns.length]);
  if (npc.ledger.length > 0) tabs.push(["ledger", "人情和仇", npc.ledger.length]);
  tabs.push(["memories", "共同记忆", npc.memories.length]);
  return tabs;
}

/**
 * 人物档案（计划第十二节第 14 条）：照原作资料卡排，头一块小头像、名字和一行信息；
 * 下面各栏改成原作 tab.bg 页签切换、一次只显示一栏，不再整页往下滚。
 * 你知道的信息、关系、心事、人情和仇、共同记忆；诉求、底线和秘密不在这里
 */
export function Profile({
  npc,
  fixer,
  onScan,
}: {
  readonly npc: Npc;
  /** 这个人是中间人时传委托系统算的派单信息（用户定的，2026-11-02：中间人并进人物档案） */
  readonly fixer?: Fixer | undefined;
  /** 有就在身体栏里出「扫描」按钮：点一下立刻用义眼扫，不调模型（用户定的，计划第十二节第 14 条） */
  readonly onScan?: ((id: string) => void) | undefined;
}) {
  const tabs = profileTabs(npc);
  const [picked, setPicked] = useState<TabId>("relation");
  // 换了人、这一栏没有时退回关系
  const tab = tabs.some(([id]) => id === picked) ? picked : "relation";
  return (
    <article className={styles.profile} aria-label={`${npc.name}的档案`}>
      <ProfileHead npc={npc} fixer={fixer} />
      {/* 左右排：左边头像和信息，右边页签和当前一栏；窄的时候自动折成上下（计划第十二节第 14 条） */}
      <div className={styles.side}>
        <nav className={styles.tabs} aria-label="档案分栏">
          {tabs.map(([id, name, count]) => (
            <button
              key={id}
              type="button"
              className={neural.tab}
              aria-pressed={id === tab}
              onClick={() => setPicked(id)}
            >
              <NineSlice id="tab.bg" tint="currentColor" slice={14} className={neural.tabBg} />
              <span className={neural.inner}>
                {name}
                {count > 0 && <b className={neural.badge}>{count}</b>}
              </span>
            </button>
          ))}
        </nav>
        <div className={styles.pane} key={tab}>
          {tab === "relation" && (
            <Panel as="section" title="关系" line="var(--cp-yellow)">
              <p className={styles.relation}>{npc.relation ?? "还说不上什么关系。"}</p>
            </Panel>
          )}
          {/* 认识的人（用户 2026-10-31："npc也有自己的生活，也有认识的npc"）：沿用列表样式，不加新框 */}
          {tab === "ties" && npc.ties.length > 0 && (
            <Panel as="section" title="认识的人" line="var(--cp-cyan)">
              <ul className={styles.list}>
                {npc.ties.map((t) => (
                  <li key={t.id} data-settled={!t.alive || undefined}>
                    <span className={styles.kind}>{t.name}</span>
                    {t.text}
                    {!t.alive && <small>已故</small>}
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          {tab === "nemesis" && npc.nemesis && <NemesisSection nemesis={npc.nemesis} />}
          {tab === "body" && npc.body && (
            <BodySection body={npc.body} onScan={onScan && (() => onScan(npc.id))} />
          )}
          {tab === "known" && (
            <Panel as="section" title="你知道的" line="var(--cp-cyan)">
              {npc.known.length === 0 ? (
                <p className={styles.note}>还没打听到什么。</p>
              ) : (
                <ul className={styles.list}>
                  {npc.known.map((k) => (
                    <li key={k.text}>
                      <span className={styles.kind}>{k.sourceLabel}</span>
                      {k.text}
                      <small>{k.at}</small>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          )}
          {tab === "arc" && npc.arc && (
            <Panel
              as="section"
              title={`心事${npc.arc.done ? "（都有了结果）" : ""}`}
              line="var(--cp-yellow)"
            >
              {npc.arc.concerns.length === 0 ? (
                <p className={styles.note}>还没提过什么心事。</p>
              ) : (
                <ul className={styles.list}>
                  {npc.arc.concerns.map((c) => (
                    <li key={c.id}>
                      <span className={styles.kind}>{c.statusLabel}</span>
                      {c.title}
                      {c.outcome && <small>{c.outcome}</small>}
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          )}
          {tab === "ledger" && npc.ledger.length > 0 && (
            <Panel as="section" title="人情和仇" line="var(--cp-red)">
              <ul className={styles.list}>
                {npc.ledger.map((e) => (
                  <li
                    key={`${e.at}|${e.kind}|${e.text}`}
                    data-settled={e.settled !== null || undefined}
                  >
                    <span className={styles.kind}>{e.label}</span>
                    {e.text}
                    <small>
                      {e.at}
                      {e.settled !== null && `，${e.settled} 了结${e.how ? `：${e.how}` : ""}`}
                    </small>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          {tab === "memories" && (
            <Panel as="section" title="共同记忆" line="var(--cp-yellow)">
              {npc.memories.length === 0 ? (
                <p className={styles.note}>还没有记录。</p>
              ) : (
                <ul className={styles.list}>
                  {npc.memories.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              )}
            </Panel>
          )}
        </div>
      </div>
    </article>
  );
}
