import type { ImagePromptLanguage, OffscreenPace } from "@cp/core";
import { type ReactNode, useEffect, useState } from "react";
import { Asset, cssUrl, NineSlice } from "../../ui/Asset";
import { Button } from "../../ui/Button";
import { CellFrame, FrameBox } from "../../ui/FrameBox";
import { ITEM_CELL_SLICE } from "../../ui/Panel";
import { ToggleCheck } from "../../ui/ToggleCheck";
import ms from "./model-settings.module.css";
import {
  type ImageBatchCount,
  type ImagePromptField,
  type NarrativeToggle,
  resetImagePromptFields,
  setImageBatchCount,
  setImagePromptField,
  setImagePromptLanguage,
  setNarrativePref,
  setOffscreenPace,
  useNarrativePrefs,
} from "./prefs";
import styles from "./settings.module.css";

const PACES: readonly {
  readonly id: OffscreenPace;
  readonly title: string;
  readonly sub: string;
}[] = [
  { id: "off", title: "关", sub: "仅聚焦当前" },
  { id: "slow", title: "慢", sub: "每隔 5 场" },
  { id: "normal", title: "常规", sub: "每隔 3 场" },
  { id: "fast", title: "快", sub: "每隔 2 场" },
];

const PROMPT_LANGUAGES: readonly {
  readonly id: ImagePromptLanguage;
  readonly title: string;
  readonly sub: string;
}[] = [
  { id: "en", title: "纯英文自然语言", sub: "Flux / Gemini / DALL·E" },
  { id: "en-tags", title: "纯英文 Tag 词组", sub: "NovelAI V5 / SD 二次元" },
  { id: "zh", title: "纯中文描述", sub: "中文模型 / 本地纯中文拼接" },
];

const BATCH_OPTIONS: readonly {
  readonly count: ImageBatchCount;
  readonly title: string;
  readonly sub: string;
}[] = [
  { count: 1, title: "1 张", sub: "整轮单幅插图" },
  { count: 2, title: "2 张", sub: "两幕分镜穿插" },
  { count: 3, title: "3 张", sub: "三幕分镜穿插" },
  { count: 4, title: "4 张", sub: "四幕分镜穿插" },
];

/** 开关分两组：剧情里看得到的呈现，和只给调试用的剧透 */
const SHOW: readonly [NarrativeToggle, string, string][] = [
  [
    "storyTheme",
    "局内应用界面主题",
    "开启后剧情界面也使用当前所选主题的动态壁纸与配色；关闭则按当前地点与时段显示夜之城实景",
  ],
  ["sceneTitles", "场景标题卡", "城区 · 地点 · 时间 · 天气"],
  [
    "autoTurnImage",
    "回合自动配图",
    "每轮叙事完成后自动生成场景插图（需在「模型连接」中设定文生图模型）",
  ],
  [
    "autoImageUseAux",
    "辅助模型提炼生图提示词",
    "开启时按下方提炼主提示词生成指定语言 Prompt；关闭则按所选语言直接本地拼接设定文本",
  ],
];

const IMAGE_PROMPT_FIELDS: readonly {
  readonly key: ImagePromptField;
  readonly label: string;
  readonly hint: string;
  readonly placeholder: string;
  readonly rows: number;
  readonly max: number;
}[] = [
  {
    key: "imageCustomPrompt",
    label: "通用自定义提示词（前缀 / 画质词 / 画师串）",
    hint: "总是固定拼在生成提示词最前面，无论是否开启辅助模型提炼均生效（例如 NovelAI 画质词或 LoRA 触发词）",
    placeholder: "例如：masterpiece, best quality, very aesthetic, absurdres",
    rows: 2,
    max: 1200,
  },
  {
    key: "imageAuxSystemPrompt",
    label: "辅助模型提炼主提示词（System Prompt · 可直接替换接管）",
    hint: "直接决定辅助模型如何把角色/剧情转化为生图 Prompt；可把你自己的生图导演提示词整段粘进来",
    placeholder: "你是《赛博朋克 2077》角色扮演游戏的专业 AI 视觉分镜与生图提示词导演…",
    rows: 4,
    max: 4000,
  },
  {
    key: "imagePortraitPrompt",
    label: "角色 / NPC 肖像画风提示词",
    hint: "附加到角色立绘与 NPC 肖像的基准风格描述（切换上方语言时默认画风会自动同步中英文）",
    placeholder: "Cyberpunk 2077 aesthetic, Night City neo-noir character portrait...",
    rows: 3,
    max: 1200,
  },
  {
    key: "imageScenePrompt",
    label: "回合场景插图画风提示词",
    hint: "附加到剧情回合插图的基准风格、光影与构图描述",
    placeholder: "Cyberpunk 2077 aesthetic, Night City cinematic scene illustration...",
    rows: 3,
    max: 1200,
  },
  {
    key: "imageNegativePrompt",
    label: "默认反向提示词（Negative Prompt）",
    hint: "告知生图模型尽量避开的元素，例如水印、文字框、崩坏手部等",
    placeholder: "lowres, blurry, watermark, text...",
    rows: 3,
    max: 1200,
  },
  {
    key: "imageAuxInstruction",
    label: "补充微调要求（可选）",
    hint: "附加在主提示词或本地拼接末尾的额外风格、色调或镜头要求",
    placeholder: "例如：采用《边缘行者》动画赛璐璐质感，偏冷青与洋红霓虹光影",
    rows: 2,
    max: 2400,
  },
];

const DEBUG: readonly [NarrativeToggle, string, string][] = [
  ["spoilers", "显示剧透", "解锁上下文调试视图，展示人物隐藏动机、判定过程与城市暗线"],
];

/**
 * 叙事偏好：存在这台浏览器里，换设备要重新选。
 * 桌面端采用上排双栏（左呈现 / 右节奏+调试）+ 下排生图提示词工作区
 */
export function NarrativeSettings({ onOpenContext }: { readonly onOpenContext?: () => void }) {
  const prefs = useNarrativePrefs();
  const [resetDone, setResetDone] = useState(false);

  useEffect(() => {
    if (!resetDone) return;
    const timer = window.setTimeout(() => setResetDone(false), 2600);
    return () => window.clearTimeout(timer);
  }, [resetDone]);

  const currentPaceLabel = PACES.find((p) => p.id === prefs.offscreen)?.title ?? "常规";
  const currentLangLabel =
    PROMPT_LANGUAGES.find((l) => l.id === prefs.imagePromptLanguage)?.title ?? "纯英文";

  const toggle = ([key, label, hint]: readonly [NarrativeToggle, string, string]) => (
    <Row key={key} id={`pref-${key}`} label={label} hint={hint}>
      <ToggleCheck
        id={`pref-${key}`}
        variant="switch"
        checked={prefs[key]}
        onChange={(checked) => setNarrativePref(key, checked)}
      />
    </Row>
  );

  return (
    <div className={styles.prefsRoot}>
      <div className={styles.prefsSummary}>
        <div className={styles.prefsSummaryLeft}>
          <span className={styles.prefsTag}>{"PREFS // LOCAL"}</span>
          <span className={styles.dim}>仅存于本浏览器 · 修改后即时生效</span>
        </div>
        <div className={styles.presetStats}>
          <span className={styles.statChip} data-tone={prefs.storyTheme ? "ok" : undefined}>
            局内主题：{prefs.storyTheme ? "开" : "关"}
          </span>
          <span
            className={styles.statChip}
            data-tone={prefs.offscreen === "off" ? undefined : "ok"}
          >
            城市节奏：{currentPaceLabel}
          </span>
          <span className={styles.statChip} data-tone="ok">
            生图语言：{currentLangLabel} · {prefs.imageBatchCount} 张
          </span>
        </div>
      </div>

      <div className={styles.prefsTwoCol}>
        <section className={styles.prefGroup} aria-label="呈现">
          <NineSlice
            id="notify.itemCellBg"
            slice={ITEM_CELL_SLICE}
            tint="var(--cp-surface)"
            className={styles.slice}
          />
          <NineSlice
            id="notify.itemCellFg"
            slice={ITEM_CELL_SLICE}
            tint="var(--cp-red-dim)"
            className={styles.slice}
          />
          <div className={styles.groupHeader}>
            <Asset id="panel.glowLeft" height={18} tint="var(--cp-cyan)" />
            <span className={ms.kicker}>01 / 呈现</span>
          </div>
          <span
            className={styles.thinLine}
            style={{ maskImage: cssUrl("tab.line"), WebkitMaskImage: cssUrl("tab.line") }}
            aria-hidden
          />
          <div className={styles.prefRows}>{SHOW.map(toggle)}</div>
        </section>

        <div className={styles.prefsSideStack}>
          <section className={styles.prefGroup} aria-label="城市节奏">
            <NineSlice
              id="notify.itemCellBg"
              slice={ITEM_CELL_SLICE}
              tint="var(--cp-surface)"
              className={styles.slice}
            />
            <NineSlice
              id="notify.itemCellFg"
              slice={ITEM_CELL_SLICE}
              tint="var(--cp-red-dim)"
              className={styles.slice}
            />
            <div className={styles.groupHeader}>
              <Asset id="panel.glowLeft" height={18} tint="var(--cp-cyan)" />
              <span className={ms.kicker}>02 / 城市节奏</span>
            </div>
            <span
              className={styles.thinLine}
              style={{ maskImage: cssUrl("tab.line"), WebkitMaskImage: cssUrl("tab.line") }}
              aria-hidden
            />
            <div className={styles.paceBlock}>
              <div className={styles.prefText}>
                <strong>城里的动静</strong>
                <small>你不在场时夜之城的场外生态运转与人物动向推演频率</small>
              </div>
              <fieldset className={styles.paceSegment} aria-label="城里的动静推演频率">
                {PACES.map((pace) => {
                  const selected = prefs.offscreen === pace.id;
                  return (
                    <button
                      key={pace.id}
                      type="button"
                      aria-pressed={selected}
                      className={styles.paceBtn}
                      onClick={() => setOffscreenPace(pace.id)}
                    >
                      <CellFrame />
                      <strong>{pace.title}</strong>
                      <span>{pace.sub}</span>
                    </button>
                  );
                })}
              </fieldset>
            </div>
          </section>

          <section className={styles.prefGroup} aria-label="调试">
            <NineSlice
              id="notify.itemCellBg"
              slice={ITEM_CELL_SLICE}
              tint="var(--cp-surface)"
              className={styles.slice}
            />
            <NineSlice
              id="notify.itemCellFg"
              slice={ITEM_CELL_SLICE}
              tint="var(--cp-yellow)"
              className={styles.slice}
            />
            <div className={styles.groupHeader}>
              <Asset id="panel.glowLeft" height={18} tint="var(--cp-yellow)" />
              <span className={ms.kicker}>04 / 调试</span>
            </div>
            <span
              className={styles.thinLine}
              style={{ maskImage: cssUrl("tab.line"), WebkitMaskImage: cssUrl("tab.line") }}
              aria-hidden
            />
            <div className={styles.prefRows}>{DEBUG.map(toggle)}</div>
            {prefs.spoilers && onOpenContext && (
              <div className={styles.debugJump}>
                <span className={styles.dim}>剧透调试已开启，可查看完整提示词与结算明细。</span>
                <Button small onClick={onOpenContext}>
                  打开上下文（调试）
                </Button>
              </div>
            )}
          </section>
        </div>
      </div>

      <section className={styles.prefGroup} aria-label="文生图提示词与数量设置">
        <NineSlice
          id="notify.itemCellBg"
          slice={ITEM_CELL_SLICE}
          tint="var(--cp-surface)"
          className={styles.slice}
        />
        <NineSlice
          id="notify.itemCellFg"
          slice={ITEM_CELL_SLICE}
          tint="var(--cp-red-dim)"
          className={styles.slice}
        />
        <div className={styles.groupHeader}>
          <Asset id="panel.glowLeft" height={18} tint="var(--cp-cyan)" />
          <span className={ms.kicker}>03 / 文生图提示词与数量控制</span>
          <div className={styles.groupAction}>
            {resetDone && <span className={styles.savedPill}>已恢复默认</span>}
            <Button
              small
              onClick={() => {
                resetImagePromptFields();
                setResetDone(true);
              }}
            >
              恢复默认提示词
            </Button>
          </div>
        </div>
        <span
          className={styles.thinLine}
          style={{ maskImage: cssUrl("tab.line"), WebkitMaskImage: cssUrl("tab.line") }}
          aria-hidden
        />

        <div className={styles.prefsTwoCol}>
          <div className={styles.paceBlock}>
            <div className={styles.prefText}>
              <strong>提示词语言与格式（消除中英混合）</strong>
              <small>
                辅助模型提炼与本地拼接均严格按此语言输出；NovelAI 推荐「纯英文 Tag 词组」
              </small>
            </div>
            <fieldset className={styles.paceSegment} aria-label="提示词语言与格式">
              {PROMPT_LANGUAGES.map((lang) => {
                const selected = prefs.imagePromptLanguage === lang.id;
                return (
                  <button
                    key={lang.id}
                    type="button"
                    aria-pressed={selected}
                    className={styles.paceBtn}
                    onClick={() => setImagePromptLanguage(lang.id)}
                  >
                    <CellFrame />
                    <strong>{lang.title}</strong>
                    <span>{lang.sub}</span>
                  </button>
                );
              })}
            </fieldset>
          </div>

          <div className={styles.paceBlock}>
            <div className={styles.prefText}>
              <strong>单轮正文默认插图数量（分段穿插）</strong>
              <small>
                单轮剧情正文内自动分镜生成并穿插展示的插图张数（1~4
                张），自动配图与弹窗均按此数量默认切分
              </small>
            </div>
            <fieldset className={styles.paceSegment} aria-label="单轮正文默认插图数量">
              {BATCH_OPTIONS.map((opt) => {
                const selected = prefs.imageBatchCount === opt.count;
                return (
                  <button
                    key={opt.count}
                    type="button"
                    aria-pressed={selected}
                    className={styles.paceBtn}
                    onClick={() => setImageBatchCount(opt.count)}
                  >
                    <CellFrame />
                    <strong>{opt.title}</strong>
                    <span>{opt.sub}</span>
                  </button>
                );
              })}
            </fieldset>
          </div>
        </div>

        <div className={styles.promptGrid}>
          {IMAGE_PROMPT_FIELDS.map((field) => {
            const value = prefs[field.key];
            return (
              <label key={field.key} className={styles.promptField} htmlFor={`pref-${field.key}`}>
                <div className={styles.promptFieldHead}>
                  <div className={styles.prefText}>
                    <strong>{field.label}</strong>
                    <small>{field.hint}</small>
                  </div>
                  <span className={styles.charCount}>
                    {value.length} / {field.max}
                  </span>
                </div>
                <FrameBox>
                  <textarea
                    id={`pref-${field.key}`}
                    rows={field.rows}
                    maxLength={field.max}
                    value={value}
                    placeholder={field.placeholder}
                    onChange={(e) => setImagePromptField(field.key, e.target.value)}
                  />
                </FrameBox>
              </label>
            );
          })}
        </div>
      </section>
    </div>
  );
}

/** 一项偏好：左边名字和一句说明（label 指向控件，点文字也能切换），右边控件 */
function Row({
  id,
  label,
  hint,
  children,
}: {
  readonly id: string;
  readonly label: string;
  readonly hint: string;
  readonly children: ReactNode;
}) {
  return (
    <div className={styles.prefRow}>
      <label className={styles.prefText} htmlFor={id}>
        <strong>{label}</strong>
        <small>{hint}</small>
      </label>
      <span className={styles.prefControl}>{children}</span>
    </div>
  );
}
