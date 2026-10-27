import { type CSSProperties, useEffect, useState } from "react";
import { Asset, cssUrl } from "../../ui/Asset";
import styles from "./neural.module.css";

/** 神经界面九页，页名照原作文本库；没有原作键位的留空 */
const MENU_PAGES = [
  { name: "人物", key: "P" },
  { name: "义体", key: "" },
  { name: "物品栏", key: "O" },
  { name: "制作", key: "K" },
  { name: "日志", key: "J" },
  { name: "地图", key: "M" },
  { name: "消息", key: "T" },
  { name: "联系人", key: "" },
  { name: "数据库", key: "" },
] as const;

/** 消息页样例：四个频道合在一个列表里 */
const THREADS = [
  { channel: "消息", from: "罗格", preview: "人到了就进来，别在门口晃。" },
  { channel: "消息", from: "米丝蒂", preview: "今晚的牌说你会遇到麻烦。" },
  { channel: "新闻", from: "54 台晚间新闻", preview: "沃森区今夜再次停电……" },
  { channel: "警用频段", from: "NCPD 调度", preview: "小唐人街，可疑交易，暂无警力。" },
  { channel: "街头", from: "来生吧台", preview: "听说码头那边有人在收芯片。" },
] as const;

/**
 * U0 视觉稿：不接数据的静态页，只用来定神经界面的风格（见 2077-interface-plan.md 第九节）。
 * 演示键：I 神经界面、按住 Tab 扫描、B 交战横幅、N 弹系统通知、D 掉血、R 重放开机
 */

const PEOPLE = [
  { name: "罗格", line: "来生的老板，欠她一个人情", threat: "中等", known: true },
  { name: "穿防弹夹克的人", line: "站在吧台边，一直看你", threat: "高", known: false },
  { name: "米丝蒂", line: "朋友", threat: "低", known: true },
] as const;

const STORY = [
  "来生的灯光压得很低。罗格没抬头，指节在吧台上敲了两下，像在数你迟到了几分钟。",
  "「东西带来了？」她问。你把芯片推过去，她用指甲拨了一下，没急着拿。",
  "吧台另一头，穿防弹夹克的人放下了杯子。",
] as const;

const OPTIONS = [
  { key: "1", tag: "镇定", text: "我就是来送货的。" },
  { key: "2", tag: "技术 6", text: "先看看那台终端。" },
  { key: "3", tag: "", text: "（看向那个穿夹克的人）" },
] as const;

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
}

const SAMPLE_NOTES = [
  "拿到 500 欧元",
  "岐路司义眼已断开",
  "罗格发来一条消息",
  "街头声望 +1",
] as const;

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
  const [notes, setNotes] = useState<readonly Note[]>(() =>
    q.has("notes") ? SAMPLE_NOTES.slice(0, 3).map((text, id) => ({ id: -1 - id, text })) : [],
  );

  useEffect(() => {
    let next = 1;
    const push = () => {
      const id = next++;
      const text = SAMPLE_NOTES[id % SAMPLE_NOTES.length] ?? "";
      setNotes((n) => [...n, { id, text }].slice(-3));
      window.setTimeout(() => setNotes((n) => n.filter((x) => x.id !== id)), 4400);
    };
    const down = (e: KeyboardEvent) => {
      if (e.repeat) return;
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

  return (
    <div className={styles.viewport}>
      <div className={styles.stage} style={{ transform: `scale(${scale})` }}>
        <div key={boot} className={styles.world} data-menu={menu || undefined}>
          {/* A 生物监测：神经界面层 */}
          <section
            className={`${styles.block} ${styles.bio}`}
            data-layer="os"
            data-low={hp < 30 || undefined}
          >
            <header className={styles.label}>生物监测</header>
            <div className={styles.bioRow}>
              <span className={styles.level}>12</span>
              <div className={styles.hpBar} style={{ "--hp": hp / 100 } as CSSProperties}>
                <span className={styles.hpGhost} />
                <span className={styles.hpFill} />
              </div>
              <b className={styles.hpNum}>{Math.round(hp * 3.4)}</b>
            </div>
            <div className={styles.ram} role="img" aria-label="网络接入仓 RAM 5/8">
              {Array.from({ length: 8 }, (_, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: 格子位置就是身份
                <i key={i} data-on={i < 5 || undefined} style={{ "--i": i } as CSSProperties} />
              ))}
            </div>
          </section>

          {/* S 在场的人：义眼叠加层 */}
          <section
            className={`${styles.block} ${styles.present}`}
            data-layer="optics"
            data-scan={scan || undefined}
          >
            <header className={styles.label}>{scan ? "岐路司义眼 - 正在扫描…" : "在场"}</header>
            <ul>
              {PEOPLE.map((p, i) => (
                <li key={p.name} className={styles.person} style={{ "--i": i } as CSSProperties}>
                  <span className={styles.corners} aria-hidden />
                  <b>{p.name}</b>
                  <small>{p.line}</small>
                  <span className={styles.scanCard}>
                    威胁 <em data-threat={p.threat}>{p.threat}</em>
                    {p.known ? " · 认识" : " · 底细不明"}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          {/* G 未读 */}
          <section className={`${styles.block} ${styles.unread}`} data-layer="os">
            <span>
              消息 <b>2</b>
            </span>
            <span>
              新闻 <b>5</b>
            </span>
            <span>
              警用频段 <b>1</b>
            </span>
          </section>

          {/* B 地点：义眼叠加层 */}
          <section className={`${styles.block} ${styles.zone}`} data-layer="optics">
            <div className={styles.zoneHead}>
              <Asset id="hud.zoneIcon" tint="var(--cp-cyan)" height={28} />
              <b>沃森 · 小唐人街</b>
            </div>
            <p>22:47 · 小雨</p>
            <p className={styles.heat}>
              <span>NCPD</span> <em>★★</em>☆☆☆
            </p>
          </section>

          {/* C 追踪：待办里最急的几条 */}
          <section className={`${styles.block} ${styles.track}`} data-layer="optics">
            <header className={styles.label}>追踪</header>
            <p>
              <b>把芯片交给罗格</b>
              <small>来生 · 还剩 1 小时 13 分</small>
            </p>
            <p>
              <b>超梦：码头那一夜</b>
              <small>关键线索 2/3</small>
            </p>
          </section>

          {/* D 系统通知 */}
          <ol className={styles.notes} aria-live="polite">
            {notes.map((n) => (
              <li key={n.id} className={styles.note} data-layer="os">
                <small>系统通知</small>
                {n.text}
              </li>
            ))}
          </ol>

          {/* H 武器和快速破解 */}
          <section className={`${styles.block} ${styles.weapon}`} data-layer="os">
            <div className={styles.slot}>
              <b>M-10AF 莱克星顿</b>
              <small>弹药 14/28</small>
            </div>
            <div className={styles.slot} data-layer="deck">
              <Asset id="interaction.hack" tint="var(--cp-cyan)" height={24} />
              <small>快速破解 · 定位</small>
            </div>
          </section>

          <main className={styles.center} aria-label="剧情与行动">
            {combat && (
              <section className={styles.combatBanner} aria-label="交战演示">
                <Asset id="notify.warning" tint="var(--cp-red)" height={24} />
                <div>
                  <b>交战</b>
                  <span>保持掩护 · 找到离开吧台的路线</span>
                </div>
                <small>演示状态</small>
              </section>
            )}
            <article className={styles.story} aria-labelledby="neural-scene-title">
              <header>
                <p className={styles.kicker}>U0 / 视觉演示 · 不写入存档</p>
                <h1 id="neural-scene-title">来生</h1>
                <span className={styles.sceneMeta}>22:47 / 芯片交接</span>
              </header>
              <div className={styles.prose}>
                {STORY.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
              </div>
              <small className={styles.sampleNotice}>
                自拟演示片段，未核对原作任务；不代表正式剧情。
              </small>
            </article>
            {/* 操作区：交互行属于义眼叠加，选项和输入属于现实层 */}
            <section className={styles.ops} aria-label="操作区">
              <div className={styles.interactRow} data-layer="optics">
                <span className={styles.interact} data-active="">
                  <Asset id="key.f" height={22} alt="F" />
                  <Asset id="interaction.talk" tint="var(--cp-cyan)" height={20} />
                  <span>吧台：罗格</span>
                </span>
                <span className={styles.interact}>
                  <Asset id="interaction.vendor" tint="var(--cp-cyan)" height={20} />
                  <span>吧台点单</span>
                </span>
                <span className={styles.interactHint}>←/→ 切换</span>
              </div>
              <ol className={styles.options}>
                {OPTIONS.map((o, i) => (
                  <li
                    key={o.key}
                    className={styles.optionItem}
                    style={{ "--i": i } as CSSProperties}
                  >
                    <button type="button" className={styles.option}>
                      <Asset id={`key.${o.key}`} height={24} alt={o.key} />
                      {o.tag ? <span className={styles.optionTag}>（{o.tag}）</span> : null}
                      <span className={styles.optionText}>{o.text}</span>
                    </button>
                  </li>
                ))}
              </ol>
              <div className={styles.inputRow}>
                <span className={styles.modes}>
                  {["做", "说", "想", "出戏"].map((m, i) => (
                    <button type="button" key={m} className={styles.mode} aria-pressed={i === 0}>
                      {m}
                    </button>
                  ))}
                </span>
                <input
                  className={styles.input}
                  placeholder="输入你想做的事……"
                  aria-label="输入行动"
                />
                <span className={styles.send}>
                  <Asset id="key.enter" height={22} alt="Enter" />
                  发送
                </span>
              </div>
            </section>
          </main>

          {/* 按键栏：游戏外的提示，不套叠加样式 */}
          <footer className={styles.keyBar}>
            <span>
              <kbd>I</kbd>神经界面
            </span>
            <span>
              <kbd>T</kbd>消息
            </span>
            <span>
              <Asset id="key.tab" height={20} alt="Tab" />
              扫描（长按）
            </span>
            <span>
              <Asset id="key.esc" height={20} alt="Esc" />
              返回
            </span>
            <span className={styles.demoKeys}>
              演示：<kbd>B</kbd>交战 <kbd>N</kbd>通知 <kbd>D</kbd>掉血 <kbd>R</kbd>重放开机
            </span>
          </footer>

          {/* 生命低于三成：四周压暗 */}
          <span
            className={styles.vignette}
            data-on={hp < 30 || undefined}
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
              <nav className={styles.tabs}>
                <b className={styles.tabsTitle}>神经界面</b>
                {MENU_PAGES.map((p) => (
                  <span
                    key={p.name}
                    className={styles.tab}
                    data-active={p.name === "消息" || undefined}
                  >
                    {p.key ? <kbd>{p.key}</kbd> : null}
                    {p.name}
                  </span>
                ))}
              </nav>
              <div className={styles.menuBody}>
                <ul className={styles.menuList}>
                  {THREADS.map((t, i) => (
                    <li key={t.from} data-active={i === 0 || undefined} data-channel={t.channel}>
                      <small>{t.channel}</small>
                      <b>{t.from}</b>
                      <span>{t.preview}</span>
                    </li>
                  ))}
                </ul>
                <article className={styles.menuDetail}>
                  <header>
                    <small>消息</small>
                    <h2>罗格</h2>
                  </header>
                  <p className={styles.msgIn}>人到了就进来，别在门口晃。</p>
                  <p className={styles.msgIn}>东西别给别人看。</p>
                  <div className={styles.jobCard}>
                    <Asset id="notify.questUpdate" tint="var(--cp-yellow)" height={28} />
                    <div>
                      <b>委托：芯片交接</b>
                      <small>来生 · 报酬 1,500 欧元 · 期限今晚</small>
                    </div>
                  </div>
                  <small className={styles.sampleNotice}>自拟演示内容，未核对原作。</small>
                </article>
              </div>
              <p className={styles.menuKeys}>
                <kbd>Q</kbd>/<kbd>E</kbd> 切换页面　
                <Asset id="key.esc" height={20} alt="Esc" /> 关闭
              </p>
            </section>
          )}

          {/* 开机：正在读取用户界面（原作原文），不超过 1.5 秒 */}
          <div className={styles.boot} aria-hidden>
            <Asset
              id="loading.circle"
              tint="var(--cp-red)"
              height={56}
              className={styles.bootCircle}
            />
            <span className={styles.bootText}>正在读取用户界面</span>
          </div>
        </div>
      </div>
    </div>
  );
}
