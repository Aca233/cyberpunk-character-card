import type { TurnInput } from "@cp/core";
import { type CSSProperties, useEffect, useState } from "react";
import type { AssetId } from "../../assets";
import { Asset, cssUrl, NineSlice } from "../../ui/Asset";
import { Bar } from "../../ui/Bar";
import { KeyBar, KeyHint } from "../../ui/KeyHint";
import { MenuItem } from "../../ui/MenuItem";
import { Panel } from "../../ui/Panel";
import { InputBar } from "../story/InputBar";
import { ChoiceList } from "../story/StoryLog";
import type { Choice } from "../story/view";
import styles from "./neural.module.css";

/**
 * U0 视觉稿：不接数据的静态页，只用来定神经界面的风格（见 2077-interface-plan.md 第九节）。
 * 边框、按钮、输入框一律用原作素材或正式页面已有的组件，不用 CSS 自己画。
 * 演示键：I 神经界面、按住 Tab 扫描、B 交战横幅、N 弹系统通知、D 掉血、R 重放开机
 */

/** 九宫格切法照正式页面里同一张素材的用法抄，不另调 */
const CELL_SLICE = [20, 30, 30, 20] as const; // MapPanel 筛选格 map.filterCell*
const TOOLTIP_SLICE = [10, 30, 70, 10] as const; // MapPanel 地图提示 map.tooltip*
const PANEL_SLICE = [20, 20, 30, 30] as const; // MapPanel 侧板 map.panel*
const SLOT_SLICE = [20, 38, 50, 38] as const; // Hud 武器格 hud.slot*
const QH_SLICE = [60, 25, 15, 25] as const; // QuickhackWheel qh.cell*
const TAG_SLICE = [0, 0, 20, 20] as const; // StoryLog 选项标签 dialog.skillSelect

/** 神经界面八页，页名照原作文本库；键位图标是原作 icons_keyboard，没有原作键位的留空；
 * 制作页随物品栏精简去掉（用户定的方案 A） */
const MENU_PAGES: readonly { readonly name: string; readonly key: AssetId | null }[] = [
  { name: "人物", key: "key.p" },
  { name: "义体", key: null },
  { name: "物品栏", key: "key.o" },
  { name: "日志", key: "key.j" },
  { name: "地图", key: "key.m" },
  { name: "消息", key: "key.t" },
  { name: "联系人", key: null },
  { name: "数据库", key: null },
];

/** 消息页样例：三个频道合在一个列表里 */
const THREADS = [
  { channel: "消息", from: "罗格", preview: "人到了就进来，别在门口晃。" },
  { channel: "消息", from: "米丝蒂", preview: "今晚的牌说你会遇到麻烦。" },
  { channel: "新闻", from: "54 台晚间新闻", preview: "沃森区今夜再次停电……" },
  { channel: "街头", from: "来生吧台", preview: "听说码头那边有人在收芯片。" },
] as const;

const PEOPLE = [
  { name: "罗格", line: "来生的老板，欠她一个人情", threat: "中等", known: true },
  { name: "穿防弹夹克的人", line: "站在吧台边，一直看你", threat: "高", known: false },
  { name: "米丝蒂", line: "朋友", threat: "低", known: true },
] as const;

const STORY = [
  "你推开来生的门，雨声被关在身后。",
  "来生的灯光压得很低。罗格没抬头，指节在吧台上敲了两下，像在数你迟到了几分钟。",
  "「东西带来了？」她问。你把芯片推过去，她用指甲拨了一下，没急着拿。",
  "吧台另一头，穿防弹夹克的人放下了杯子。",
] as const;

/** 演示选项：形状照投影里的 offers.choices，交给正式剧情页的 ChoiceList 画 */
const CHOICES: readonly Choice[] = [
  { text: "我就是来送货的。", gate: null, checkId: "demo.1", source: null },
  {
    text: "先看看那台终端。",
    gate: null,
    checkId: null,
    source: "黑客专长",
  },
  { text: "（看向那个穿夹克的人）", gate: null, checkId: null, source: "过往：街头小子" },
];

/** 舞台按 1920×1080 画，再整体缩放到窗口 */
const fit = () => Math.min(window.innerWidth / 1920, window.innerHeight / 1080);

function useStageScale(): number {
  const [scale, setScale] = useState(fit);
  useEffect(() => {
    const onResize = () => setScale(fit());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return scale;
}

interface Note {
  readonly id: number;
  readonly text: string;
  readonly icon: AssetId;
}

/** 通知图标照 Toasts：原作 notification_assets */
const SAMPLE_NOTES: readonly Omit<Note, "id">[] = [
  { text: "拿到 500 欧元", icon: "notify.cash" },
  { text: "岐路司义眼已断开", icon: "notify.warning" },
  { text: "罗格发来一条消息", icon: "notify.attention" },
  { text: "街头名声升至 · 小有名气", icon: "notify.streetCred" },
];

const HP_MAX = 340;

export function NeuralMock() {
  const scale = useStageScale();
  // 截图用：?menu=1&scan=1&combat=1&low=1&notes=1 直接进到对应状态
  const [q] = useState(() => new URLSearchParams(window.location.search));
  // 开机过场的轮次：换一个值就重放一遍
  const [boot, setBoot] = useState(0);
  const [menu, setMenu] = useState(q.has("menu"));
  const [scan, setScan] = useState(q.has("scan"));
  const [combat, setCombat] = useState(q.has("combat"));
  const [hp, setHp] = useState(q.has("low") ? 18 : 82);
  const [thread, setThread] = useState(0);
  // 复用原来的单一输入框；演示输入只保存在本页，不调用模型或写入存档。
  const [draft, setDraft] = useState<TurnInput>({ text: "" });
  const [notes, setNotes] = useState<readonly Note[]>(() =>
    q.has("notes") ? SAMPLE_NOTES.slice(0, 3).map((n, i) => ({ ...n, id: -1 - i })) : [],
  );

  useEffect(() => {
    let next = 1;
    const push = () => {
      const id = next++;
      const sample = SAMPLE_NOTES[id % SAMPLE_NOTES.length];
      if (!sample) return;
      setNotes((n) => [...n, { ...sample, id }].slice(-3));
      window.setTimeout(() => setNotes((n) => n.filter((x) => x.id !== id)), 4400);
    };
    const down = (e: KeyboardEvent) => {
      if (e.repeat) return;
      // 在输入框里打字时不触发演示键
      if (e.target instanceof HTMLTextAreaElement && e.key !== "Escape") return;
      const k = e.key.toLowerCase();
      if (k === "tab") {
        e.preventDefault();
        setScan(true);
      } else if (k === "i") setMenu((m) => !m);
      else if (k === "escape") setMenu(false);
      else if (k === "b") setCombat((c) => !c);
      else if (k === "n") push();
      else if (k === "d") setHp((h) => (h <= 20 ? 82 : h - 22));
      else if (k === "r") setBoot((b) => b + 1);
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === "Tab") setScan(false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  const low = hp < 30;
  const hpNow = Math.round((hp / 100) * HP_MAX);
  const active = THREADS[thread] ?? THREADS[0];

  return (
    <div className={styles.viewport}>
      <div className={styles.stage} style={{ transform: `scale(${scale})` }}>
        <div key={boot} className={styles.world} data-menu={menu || undefined}>
          {/* A 生物监测：神经界面层。面板 ui/Panel，等级框 hud.levelFrame，血条 hud.healthbar，RAM hud.ramBar，写法同 Hud */}
          <div
            className={`${styles.block} ${styles.bio}`}
            data-layer="os"
            data-low={low || undefined}
          >
            <Panel as="section" title="生物监测" line="var(--cp-red)">
              <div className={styles.bioRow}>
                <span className={styles.level} title="街头名声 · 小有名气">
                  <Asset id="hud.levelFrame" tint="var(--cp-red)" height={44} />
                  <Asset
                    id="notify.streetCred"
                    tint="var(--cp-red)"
                    height={20}
                    className={styles.levelIcon}
                  />
                </span>
                <div className={styles.hp}>
                  <Bar
                    id="hud.healthbar"
                    value={hpNow}
                    max={HP_MAX}
                    color={low ? "var(--cp-hp-low)" : "var(--cp-hp)"}
                    width={280}
                    label={`生命 ${hpNow}/${HP_MAX}`}
                  />
                  <span className={styles.hpText} data-low={low || undefined}>
                    HP {hpNow}/{HP_MAX}
                  </span>
                </div>
              </div>
              <div className={styles.ram} role="img" aria-label="网络接入仓 RAM 5/8">
                {Array.from({ length: 8 }, (_, i) => (
                  <span
                    // biome-ignore lint/suspicious/noArrayIndexKey: 格子位置就是身份
                    key={i}
                    className={styles.ramCell}
                    data-on={i < 5 || undefined}
                    style={{ "--i": i } as CSSProperties}
                  >
                    <Asset id="hud.ramBar" tint="var(--cp-cyan)" height={14} />
                  </span>
                ))}
              </div>
            </Panel>
          </div>

          {/* S 在场的人：义眼叠加层。每人一格 map.filterCell，扫描卡 map.tooltip */}
          <section
            className={`${styles.block} ${styles.present}`}
            data-layer="optics"
            data-scan={scan || undefined}
          >
            <header className={styles.label}>
              <Asset id="interaction.scan" tint="currentColor" height={18} />
              {scan ? "岐路司义眼 - 正在扫描…" : "在场"}
            </header>
            <ul>
              {PEOPLE.map((p, i) => (
                <li key={p.name} className={styles.person} style={{ "--i": i } as CSSProperties}>
                  <NineSlice id="map.filterCellBg" tint="rgb(14 14 23 / 72%)" slice={CELL_SLICE} />
                  <NineSlice id="map.filterCellFg" tint="var(--person-line)" slice={CELL_SLICE} />
                  <div className={styles.inner}>
                    <b>{p.name}</b>
                    <small>{p.line}</small>
                  </div>
                  <span className={styles.scanCard}>
                    <NineSlice
                      id="map.tooltipBg"
                      tint="rgb(14 14 23 / 88%)"
                      slice={TOOLTIP_SLICE}
                    />
                    <NineSlice id="map.tooltipFg" tint="var(--cp-cyan)" slice={TOOLTIP_SLICE} />
                    <span className={styles.inner}>
                      威胁 <em data-threat={p.threat}>{p.threat}</em>
                      {p.known ? " · 认识" : " · 底细不明"}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </section>

          {/* G 未读：map.panel 侧板，图标是原作通知图标 */}
          <section className={`${styles.block} ${styles.unread}`} data-layer="os">
            <NineSlice id="map.panelBg" tint="rgb(14 14 23 / 72%)" slice={PANEL_SLICE} />
            <NineSlice id="map.panelFg" tint="var(--cp-red)" slice={PANEL_SLICE} />
            <div className={styles.inner}>
              <span>
                <Asset id="notify.attention" tint="var(--cp-red)" height={18} />
                消息 <b>2</b>
              </span>
              <span>
                <Asset id="notify.journal" tint="var(--cp-red)" height={18} />
                新闻 <b>5</b>
              </span>
            </div>
          </section>

          {/* B 地点：义眼叠加层。原作 zone_update 的框和图标，地区图标同 Hud */}
          <section className={`${styles.block} ${styles.zone}`} data-layer="optics">
            <Asset
              id="hud.zoneFrame"
              tint="var(--cp-yellow)"
              height={96}
              className={styles.zoneFrame}
            />
            <div className={styles.zoneText}>
              <b>沃森 · 小唐人街</b>
              <span>22:47 · 夜晚 · 小雨</span>
              <span className={styles.heat}>
                ★★<span className={styles.starsEmpty}>★★★</span>
              </span>
            </div>
            {/* 原作地区徽章自带颜色，有的没有透明底，不能当蒙版染色 */}
            <Asset id="district.watson" height={44} />
          </section>

          {/* C 追踪：待办里最急的几条，ui/Panel */}
          <div className={`${styles.block} ${styles.track}`} data-layer="optics">
            <Panel as="section" title="追踪" line="var(--cp-yellow)">
              <ul className={styles.trackList}>
                <li>
                  <Asset id="notify.questUpdate" tint="var(--cp-yellow)" height={22} />
                  <span>
                    <b>把芯片交给罗格</b>
                    <small>来生 · 还剩 1 小时 13 分</small>
                  </span>
                </li>
                <li>
                  <Asset id="braindance.clue" tint="var(--cp-yellow)" height={22} />
                  <span>
                    <b>超梦：码头那一夜</b>
                    <small>关键线索 2/3</small>
                  </span>
                </li>
              </ul>
            </Panel>
          </div>

          {/* D 系统通知：原作 notification_assets 的物品格和图标 */}
          <ol className={styles.notes} aria-live="polite">
            {notes.map((n) => (
              <li key={n.id} className={styles.note} data-layer="os">
                <NineSlice id="notify.itemCellBg" tint="var(--cp-panel)" slice={30} />
                <NineSlice id="notify.itemCellFg" tint="var(--cp-yellow)" slice={30} />
                <div className={styles.inner}>
                  <Asset id={n.icon} tint="var(--cp-yellow)" height={22} />
                  <span>
                    <small>系统通知</small>
                    {n.text}
                  </span>
                </div>
              </li>
            ))}
          </ol>

          {/* H 武器和快速破解：武器格同 Hud（hud.slot*），快速破解格同轮盘（qh.cell*） */}
          <section className={`${styles.block} ${styles.weapon}`} data-layer="os">
            <div className={styles.slot}>
              <NineSlice id="hud.slotBg" tint="rgb(14 14 23 / 85%)" slice={SLOT_SLICE} />
              <NineSlice id="hud.slotFg" tint="rgb(94 246 255 / 80%)" slice={SLOT_SLICE} />
              <div className={styles.inner}>
                <Asset id="weapon.pistol" tint="var(--cp-cyan)" height={30} />
                <span>
                  <b>M-10AF 莱克星顿</b>
                  <small>14 / 28</small>
                </span>
              </div>
            </div>
            <div className={styles.qhSlot} data-layer="deck">
              <NineSlice id="qh.cellBg" tint="rgb(14 14 23 / 61%)" slice={QH_SLICE} />
              <NineSlice id="qh.cellFg" tint="rgb(40 255 255)" slice={QH_SLICE} />
              <div className={styles.inner}>
                <Asset id="interaction.hack" tint="var(--cp-cyan)" height={24} />
                <small>定位</small>
              </div>
            </div>
          </section>

          <main className={styles.center} aria-label="剧情与行动">
            {combat && (
              <Panel as="section" line="var(--cp-red)" className={styles.combatBanner}>
                <div className={styles.combatRow}>
                  <Asset id="notify.warning" tint="var(--cp-red)" height={26} />
                  <b>交战</b>
                  <span>保持掩护 · 找到离开吧台的路线</span>
                  <small>演示状态</small>
                </div>
              </Panel>
            )}
            {/* 正文贴底排，旧段落往上渐暗 */}
            <article className={styles.story} aria-label="剧情">
              <div className={styles.prose}>
                {STORY.map((paragraph, i) => (
                  <p key={paragraph} style={{ "--age": STORY.length - 1 - i } as CSSProperties}>
                    {paragraph}
                  </p>
                ))}
              </div>
              <small className={styles.sampleNotice}>
                U0 视觉演示，不写入存档；自拟片段，未核对原作任务。
              </small>
            </article>
            {/* 操作区：交互行属于义眼叠加，选项和输入属于现实层 */}
            <section className={styles.ops} aria-label="操作区">
              <div className={styles.interactRow} data-layer="optics">
                <span className={styles.interact} data-active="">
                  <NineSlice
                    id="dialog.skillSelect"
                    tint="rgb(94 246 255 / 22%)"
                    slice={TAG_SLICE}
                  />
                  <span className={styles.inner}>
                    <Asset id="key.f" height={22} alt="F" />
                    <Asset id="interaction.talk" tint="var(--cp-cyan)" height={20} />
                    吧台：罗格
                  </span>
                </span>
                <span className={styles.interact}>
                  <span className={styles.inner}>
                    <Asset id="interaction.vendor" tint="var(--cp-cyan)" height={20} />
                    吧台点单
                  </span>
                </span>
              </div>
              {/* 选项和输入框直接用正式剧情页的组件，不另做一套 */}
              <ChoiceList choices={CHOICES} locked={false} onChoose={() => undefined} />
              <InputBar
                busy={false}
                streaming={false}
                disabled={false}
                draft={draft}
                onDraft={(d) => setDraft((old) => ({ ...old, ...d }))}
                onSend={() => setDraft({ text: "" })}
                onStop={() => undefined}
              />
            </section>
          </main>

          {/* 按键栏：正式页面的 KeyBar/KeyHint，键位图标是原作 icons_keyboard */}
          <div className={styles.keyBar}>
            <KeyBar>
              <KeyHint keyId="key.i" label="神经界面" onClick={() => setMenu((m) => !m)} />
              <KeyHint keyId="key.t" label="消息" />
              <KeyHint keyId="key.tab" label="扫描（长按）" />
              <KeyHint keyId="key.esc" label="返回" />
              <span className={styles.demoKeys}>演示</span>
              <KeyHint keyId="key.b" label="交战" />
              <KeyHint keyId="key.n" label="通知" />
              <KeyHint keyId="key.d" label="掉血" />
              <KeyHint keyId="key.r" label="重放开机" />
            </KeyBar>
          </div>

          {/* 生命低于三成：四周压暗 */}
          <span
            className={styles.vignette}
            data-on={low || undefined}
            style={{ backgroundImage: cssUrl("fx.vignette") }}
            aria-hidden
          />

          {/* 神经界面（I）：压暗、扫描线扫一遍、标签栏落下 */}
          {menu && (
            <section className={styles.menu} data-layer="os" aria-label="神经界面">
              <span className={styles.menuDim} aria-hidden />
              <span
                className={styles.menuScan}
                style={{ backgroundImage: cssUrl("fx.scanlines") }}
                aria-hidden
              />
              <header className={styles.menuHead}>
                <Asset
                  id="menu.header"
                  tint="var(--cp-red)"
                  height={120}
                  className={styles.menuHeadBg}
                />
                <b className={styles.tabsTitle}>神经界面</b>
                <Asset id="fluff.code" tint="var(--cp-red)" height={18} />
              </header>
              {/* 标签：原作 atlas_tabs 的 tab.bg 九宫格，底线 tab.line；切法同 Button */}
              <nav className={styles.tabs}>
                {MENU_PAGES.map((p) => (
                  <span
                    key={p.name}
                    className={styles.tab}
                    data-active={p.name === "消息" || undefined}
                  >
                    <NineSlice
                      id="tab.bg"
                      tint="currentColor"
                      slice={14}
                      className={styles.tabBg}
                    />
                    <span className={styles.inner}>
                      {p.key && <Asset id={p.key} tint="currentColor" height={20} />}
                      {p.name}
                    </span>
                  </span>
                ))}
              </nav>
              <span
                className={styles.tabLine}
                style={{ maskImage: cssUrl("tab.line"), WebkitMaskImage: cssUrl("tab.line") }}
                aria-hidden
              />
              <div className={styles.menuBody}>
                {/* 列表：正式主菜单的 MenuItem */}
                <nav className={styles.menuList} aria-label="对话">
                  {THREADS.map((t, i) => (
                    <MenuItem
                      key={t.from}
                      label={t.from}
                      hint={t.channel}
                      selected={i === thread}
                      onSelect={() => setThread(i)}
                      onFocus={() => setThread(i)}
                    />
                  ))}
                </nav>
                <Panel
                  as="section"
                  title={active.from}
                  line="var(--cp-cyan)"
                  className={styles.menuDetail}
                >
                  <small className={styles.channel}>{active.channel}</small>
                  <p className={styles.msgIn}>{active.preview}</p>
                  {thread === 0 && (
                    <>
                      <p className={styles.msgIn}>东西别给别人看。</p>
                      <div className={styles.jobCard}>
                        <NineSlice
                          id="map.tooltipBg"
                          tint="rgb(14 14 23 / 88%)"
                          slice={TOOLTIP_SLICE}
                        />
                        <NineSlice
                          id="map.tooltipFg"
                          tint="var(--cp-yellow)"
                          slice={TOOLTIP_SLICE}
                        />
                        <div className={styles.inner}>
                          <Asset id="notify.questUpdate" tint="var(--cp-yellow)" height={28} />
                          <span>
                            <b>委托：芯片交接</b>
                            <small>来生 · 报酬 1,500 欧元 · 期限今晚</small>
                          </span>
                        </div>
                      </div>
                    </>
                  )}
                  <small className={styles.sampleNotice}>自拟演示内容，未核对原作。</small>
                </Panel>
              </div>
              <div className={styles.menuKeys}>
                <KeyBar>
                  <KeyHint keyId="key.q" label="上一个面板" />
                  <KeyHint keyId="key.e" label="下一个面板" />
                  <KeyHint keyId="key.esc" label="关闭" onClick={() => setMenu(false)} />
                </KeyBar>
              </div>
            </section>
          )}

          {/* 开机：正在读取用户界面（原作原文），原作 default_loading 的框和圈，不超过 1.5 秒 */}
          <div className={styles.boot} aria-hidden>
            <span className={styles.bootMark}>
              <Asset id="loading.frame" tint="var(--cp-red)" height={72} />
              <Asset
                id="loading.circle"
                tint="var(--cp-red)"
                height={56}
                className={styles.bootCircle}
              />
            </span>
            <span className={styles.bootText}>正在读取用户界面</span>
          </div>
        </div>
      </div>
    </div>
  );
}
