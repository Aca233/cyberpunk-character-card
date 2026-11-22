import { type CSSProperties, useMemo } from "react";
import type { AssetId } from "../../assets";
import { Asset } from "../../ui/Asset";
import { useCardTilt } from "../../ui/useCardTilt";
import styles from "./story.module.css";
import type { View } from "./view";

export interface OpeningPrompt {
  readonly source: string;
  readonly label: string;
  readonly text: string;
}

export interface OpeningGuideActions {
  readonly onSendPrompt?: ((text: string) => void) | undefined;
}

const KEYS: readonly AssetId[] = ["key.1", "key.2", "key.3"];

/** 按当前存档真实开局状态生成 3 条沉浸式起手行动（全本地读取，不新增模型调用） */
function buildOpeningPrompts(view: View): readonly OpeningPrompt[] {
  const loc = view.names.location ?? view.location ?? "这里";
  const hereNpcs = view.npcs.filter((n) => n.here && n.alive);
  const firstNpc = hereNpcs[0];
  const unreadMsg = view.phone.messages.find((m) => !m.read);
  const firstJob = view.jobs.list.find((j) => j.open);
  const firstHome = view.safehouse.homes[0];
  const prompts: OpeningPrompt[] = [];

  prompts.push({
    source: "环顾",
    label: `打量${loc}周围的人和动静`,
    text: `先打量一下${loc}周围的环境、灯光和在场的人，看看眼下是什么情况。`,
  });

  if (firstNpc) {
    prompts.push({
      source: firstNpc.name,
      label: `过去跟${firstNpc.name}打声招呼`,
      text: `走到${firstNpc.name}身边打声招呼，顺便问问最近有什么动静。`,
    });
  } else if (unreadMsg) {
    prompts.push({
      source: "终端",
      label: `看看${unreadMsg.name}发来的消息`,
      text: `低头翻出全息终端，查看${unreadMsg.name}发来的消息内容。`,
    });
  } else if (firstJob) {
    prompts.push({
      source: "委托",
      label: `核对「${firstJob.title}」的细节`,
      text: `翻出终端核对「${firstJob.title}」的委托细节，准备动手。`,
    });
  } else {
    prompts.push({
      source: "打探",
      label: "找店里或街口的人搭句话，打听最近风声",
      text: "找附近最显眼的熟人或店里的人搭句话，打听最近城里有什么活儿和风声。",
    });
  }

  if (view.ripperdoc) {
    prompts.push({
      source: "诊所",
      label: `找${view.ripperdoc.name}看看身上义体`,
      text: `和${view.ripperdoc.name}打招呼，顺便让他看看身上这副义体的状态。`,
    });
  } else if (view.shops.length > 0 && view.shops[0]) {
    prompts.push({
      source: "逛店",
      label: `去${view.shops[0].name}看看摆着什么货`,
      text: `到${view.shops[0].name}柜台前转一圈，看看今天摆着什么货。`,
    });
  } else if (firstHome && view.location !== firstHome.location) {
    prompts.push({
      source: "落脚处",
      label: `先回${firstHome.name}整理行装`,
      text: `整理一下随身的东西，盘算先回${firstHome.name}还是去街上转转。`,
    });
  } else {
    prompts.push({
      source: "上街",
      label: "推门出去，顺着街面走一段",
      text: "推门出去，顺着街面走一段，看看今晚的夜之城有什么动静。",
    });
  }

  return prompts.slice(0, 3);
}

function OpeningChoiceItem({
  prompt,
  index,
  disabled,
  onPick,
}: {
  readonly prompt: OpeningPrompt;
  readonly index: number;
  readonly disabled: boolean;
  readonly onPick: () => void;
}) {
  const key = KEYS[index];
  const tilt = useCardTilt<HTMLButtonElement>({
    disabled,
    maxRotate: 1.8,
    shadowShift: 1.5,
  });
  return (
    <li style={{ "--i": index } as CSSProperties}>
      <button
        type="button"
        className={styles.choice}
        disabled={disabled}
        onClick={onPick}
        {...tilt}
      >
        {key ? (
          <Asset id={key} tint="currentColor" height={20} />
        ) : (
          <span className={styles.num}>{index + 1}</span>
        )}
        <span className={styles.source}>{prompt.source}</span>
        <span className={styles.choiceText}>{prompt.label}</span>
        <span className={styles.choiceArrow} aria-hidden>
          ▸
        </span>
      </button>
    </li>
  );
}

/** 0 轮新档序幕：沿用本作场景标题卡与 2077 对话选项样式，自然起手进入第一幕 */
export function OpeningGuide({
  view,
  busy,
  actions,
}: {
  readonly view: View;
  readonly busy: boolean;
  readonly actions: OpeningGuideActions;
}) {
  const prompts = useMemo(() => buildOpeningPrompts(view), [view]);
  const loc = view.names.location ?? view.location ?? "夜之城";
  const district = view.names.district;
  const hereNpcs = view.npcs.filter((n) => n.here && n.alive);
  const firstJob = view.jobs.list.find((j) => j.open);
  const deadline = view.deadlines[0];
  const disabled = busy || view.death !== null || view.ended !== null;

  const sceneLine = [loc, district, `${view.time.text} · ${view.time.periodLabel}`]
    .filter(Boolean)
    .join("  //  ");

  const leadBits: string[] = [];
  if (hereNpcs.length > 0) {
    leadBits.push(
      `视野里能看到 ${hereNpcs
        .map((n) => n.name)
        .slice(0, 3)
        .join("、")}。`,
    );
  }
  if (deadline) {
    leadBits.push(`眼下期限：${deadline.label}（${deadline.due} 前）。`);
  } else if (firstJob) {
    leadBits.push(`手头有一笔「${firstJob.title}」的线索。`);
  }

  return (
    <section className={styles.opening} aria-label="开场序幕">
      <p className={styles.sceneTitle}>{sceneLine}</p>

      <div className={styles.openingIntro}>
        <p className={styles.openingLead}>
          夜之城的霓虹在雨雾里明灭。此刻你身在 <b>{loc}</b>，正准备迈出第一步。
          {leadBits.length > 0 ? ` ${leadBits.join("")}` : ""}
        </p>
      </div>

      {actions.onSendPrompt && (
        <div className={styles.openingChoices}>
          <ol className={styles.choices}>
            {prompts.map((p, i) => (
              <OpeningChoiceItem
                key={p.source}
                prompt={p}
                index={i}
                disabled={disabled}
                onPick={() => actions.onSendPrompt?.(p.text)}
              />
            ))}
          </ol>
        </div>
      )}

      <p className={styles.openingFoot}>
        选一条起手，或在下方直接写下你想做的事 · 四角可展开人物、装备、委托与消息，按 M 看地图
      </p>
    </section>
  );
}
