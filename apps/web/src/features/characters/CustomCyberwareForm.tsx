import { cyberwareRules, economyRules, type StartCyberware, StartCyberwareSchema } from "@cp/core";
import { useState } from "react";
import { ActionButton } from "../../ui/ActionButton";
import { Button } from "../../ui/Button";
import { CellFrame, FrameBox } from "../../ui/FrameBox";
import { CYBER_LABELS, type CyberSlot } from "../story/CyberDoll";
import styles from "./characters.module.css";
import { saveLocalCustomCyberware } from "./creator";

type LoadLevel = "zero" | "standard" | "heavy";

const RARITY_OPTIONS: readonly economyRules.Rarity[] = [
  "common",
  "uncommon",
  "rare",
  "epic",
  "legendary",
];

const LOAD_LEVELS: readonly {
  readonly id: LoadLevel;
  readonly label: string;
  readonly cost: number;
}[] = [
  { id: "zero", label: "零负荷（生活/时尚/感官）", cost: 0 },
  { id: "standard", label: "常规负荷（实战义体）", cost: 4 },
  { id: "heavy", label: "高压重器（军用重装/全身改造）", cost: 12 },
];

function inferLoadLevel(cost: number): LoadLevel {
  if (cost <= 0) return "zero";
  if (cost >= 10) return "heavy";
  return "standard";
}

function deckSlotsForRarity(rarity: economyRules.Rarity): number {
  if (rarity === "legendary") return 8;
  if (rarity === "epic" || rarity === "rare") return 6;
  return 4;
}

/** 各部位允许手动指定的同部位主槽互斥组；手臂本身固定走左右双臂上限，其余由下方机制开关自动推断时不再重复问 */
const SLOT_EXCLUSIVE_GROUPS: Readonly<Record<CyberSlot, readonly cyberwareRules.ExclusiveGroup[]>> =
  {
    os: ["cyberdeck", "spineDrive"],
    eyes: ["optics"],
    arms: [],
    legs: ["legDrive"],
    integumentary: ["skinArmor"],
    skeleton: ["fullBorg"],
    circulatory: ["intimateCore"],
    nervous: [],
    frontalCortex: [],
    hands: [],
  };

function exclusiveOptionLabel(group: cyberwareRules.ExclusiveGroup): string {
  const limit = cyberwareRules.EXCLUSIVE_GROUP_LIMIT[group];
  const name = cyberwareRules.EXCLUSIVE_GROUP_LABELS[group];
  return limit === 1
    ? `占用「${name}」主槽（限 1，装新替换旧）`
    : `归入「${name}」（最多装 ${limit} 件）`;
}

/**
 * 创角义体货架内置自创义体表单：
 * 支持直接手写与原地编辑，无需手工编写 JSON，保存后同步进入本地自创池并可即时装配进存档。
 */
export function CustomCyberwareForm({
  slot,
  initial,
  onAccept,
  onCancel,
}: {
  readonly slot: CyberSlot;
  readonly initial?: StartCyberware;
  readonly onAccept: (item: StartCyberware, options: { readonly equip: boolean }) => void;
  readonly onCancel: () => void;
}) {
  const editing = Boolean(initial);
  const [targetSlot, setTargetSlot] = useState<CyberSlot>(() => initial?.slot ?? slot);
  const [name, setName] = useState(() => initial?.name ?? "");
  const [ability, setAbility] = useState(() => initial?.ability ?? initial?.summary ?? "");
  const [rarity, setRarity] = useState<economyRules.Rarity>(() => initial?.rarity ?? "rare");
  const [loadLevel, setLoadLevel] = useState<LoadLevel>(() =>
    inferLoadLevel(initial?.humanityCost ?? 0),
  );
  const [exclusiveGroup, setExclusiveGroup] = useState<"" | cyberwareRules.ExclusiveGroup>(
    () => initial?.exclusiveGroup ?? "",
  );
  const [armor, setArmor] = useState(() => Boolean(initial?.armor));
  const [accelerator, setAccelerator] = useState(() => Boolean(initial?.accelerator));
  const [isDeck, setIsDeck] = useState(() => Boolean(initial?.deckProfile));

  const autoGroup: cyberwareRules.ExclusiveGroup | null =
    targetSlot === "arms"
      ? "armMount"
      : targetSlot === "os" && isDeck
        ? "cyberdeck"
        : targetSlot === "os" && accelerator
          ? "spineDrive"
          : targetSlot === "integumentary" && armor
            ? "skinArmor"
            : null;

  const allowedManualGroups = SLOT_EXCLUSIVE_GROUPS[targetSlot];
  const manualOptions = allowedManualGroups.filter((g) => g !== autoGroup);
  const effectiveExclusive = autoGroup ?? (exclusiveGroup || undefined);

  const handleSlotChange = (nextSlot: CyberSlot) => {
    setTargetSlot(nextSlot);
    if (exclusiveGroup && !SLOT_EXCLUSIVE_GROUPS[nextSlot].includes(exclusiveGroup)) {
      setExclusiveGroup("");
    }
    if (nextSlot !== "os" && isDeck) {
      setIsDeck(false);
    }
  };

  const toggleDeck = () => {
    const next = !isDeck;
    setIsDeck(next);
    if (next) {
      setAccelerator(false);
      setExclusiveGroup("");
    }
  };

  const toggleAccelerator = () => {
    const next = !accelerator;
    setAccelerator(next);
    if (next && targetSlot === "os") {
      setIsDeck(false);
      setExclusiveGroup("");
    }
  };

  const cost = LOAD_LEVELS.find((l) => l.id === loadLevel)?.cost ?? 0;
  const candidate: StartCyberware = {
    id: initial?.id ?? `custom-cw-${Date.now().toString(36)}`,
    name: name.trim(),
    slot: targetSlot,
    rarity,
    humanityCost: cost,
    ability: ability.trim() || "自定义义体模块",
    ...(armor ? { armor: true } : {}),
    ...(accelerator ? { accelerator: true } : {}),
    ...(targetSlot === "os" && isDeck ? { deckProfile: "自定义网络接入仓" } : {}),
    ...(effectiveExclusive ? { exclusiveGroup: effectiveExclusive } : {}),
    custom: true,
    packId: initial?.packId ?? "local",
  };
  const valid = name.trim().length > 0 && StartCyberwareSchema.safeParse(candidate).success;

  const submit = (equip: boolean) => {
    saveLocalCustomCyberware(candidate);
    onAccept(candidate, { equip });
  };

  return (
    <div className={styles.customForm}>
      <CellFrame />
      <div className={styles.customFormHead}>
        <strong className={styles.customFormTitle}>
          {editing ? "编辑自创义体" : "新建自创义体"} · {CYBER_LABELS[targetSlot]}
        </strong>
        <ActionButton onClick={onCancel}>返回货架</ActionButton>
      </div>

      <div className={styles.customFormGrid}>
        <label className={styles.field}>
          <span>
            义体名称
            <small>{name.length} / 40</small>
          </span>
          <FrameBox className={styles.compactBox}>
            <input
              maxLength={40}
              value={name}
              placeholder="例如：黑市微声纹变声器、定制热能义臂、双人共感神经桥…"
              onChange={(e) => setName(e.target.value)}
            />
          </FrameBox>
        </label>

        <label className={styles.field}>
          <span>安装部位</span>
          <FrameBox className={styles.compactBox}>
            <select
              value={targetSlot}
              aria-label="选择义体安装部位"
              onChange={(e) => handleSlotChange(e.target.value as CyberSlot)}
            >
              {cyberwareRules.CYBERWARE_SLOTS.map((s) => (
                <option key={s} value={s}>
                  {CYBER_LABELS[s]}
                </option>
              ))}
            </select>
          </FrameBox>
        </label>
      </div>

      <div className={styles.field}>
        <span>稀有度品级</span>
        <fieldset className={styles.shelfFilter} aria-label="自创义体稀有度">
          {RARITY_OPTIONS.map((r) => (
            <button
              key={r}
              type="button"
              className={styles.rarityPickBtn}
              data-rarity={r}
              aria-pressed={rarity === r}
              onClick={() => setRarity(r)}
            >
              {economyRules.RARITY_LABELS[r]}
            </button>
          ))}
        </fieldset>
      </div>

      <label className={styles.field}>
        <span>
          实际效果与限制说明（写给叙事与裁决模型）
          <small>{ability.length} / 200</small>
        </span>
        <FrameBox className={styles.inputBox}>
          <textarea
            rows={2}
            maxLength={200}
            value={ability}
            placeholder="写清楚装上后能做到什么、在哪些场景生效、有什么现实代价或局限……"
            onChange={(e) => setAbility(e.target.value)}
          />
        </FrameBox>
      </label>

      <div className={styles.field}>
        <span>神经负荷档位</span>
        <fieldset className={styles.shelfFilter} aria-label="神经负荷档位">
          {LOAD_LEVELS.map((l) => (
            <Button
              key={l.id}
              small
              pressed={loadLevel === l.id}
              onClick={() => setLoadLevel(l.id)}
            >
              {l.label}
            </Button>
          ))}
        </fieldset>
      </div>

      <div className={styles.field}>
        <span>
          联动系统机制（可选）
          <small>仅纯文字/剧情效果可全不勾选</small>
        </span>
        <fieldset className={styles.featureToggleList} aria-label="自创义体联动系统机制">
          <button
            type="button"
            className={styles.featureToggleRow}
            aria-pressed={armor}
            onClick={() => setArmor((v) => !v)}
          >
            <span className={styles.featureToggleName}>{armor ? "✓ 护甲防护" : "护甲防护"}</span>
            <span className={styles.featureToggleDesc}>
              {targetSlot === "integumentary"
                ? "计入义体护甲抵挡伤害；装在皮肤部位时视为全覆式主甲（限 1）"
                : "计入义体护甲栏，受击裁决时抵挡流弹与近战创伤"}
            </span>
          </button>

          <button
            type="button"
            className={styles.featureToggleRow}
            aria-pressed={accelerator}
            onClick={toggleAccelerator}
          >
            <span className={styles.featureToggleName}>
              {accelerator ? "✓ 主动神经加速（斯安威斯坦类）" : "主动神经加速（斯安威斯坦类）"}
            </span>
            <span className={styles.featureToggleDesc}>
              剧情输入框解锁主动开启的爆发加速按钮（每次启动消耗人性；普通被动加反应不要勾）
            </span>
          </button>

          {targetSlot === "os" && (
            <button
              type="button"
              className={styles.featureToggleRow}
              aria-pressed={isDeck}
              onClick={toggleDeck}
            >
              <span className={styles.featureToggleName}>
                {isDeck ? "✓ 黑客网络接入仓" : "黑客网络接入仓"}
              </span>
              <span className={styles.featureToggleDesc}>
                解锁快速破解与程序槽（按当前「{economyRules.RARITY_LABELS[rarity]}」稀有度提供{" "}
                {deckSlotsForRarity(rarity)} 槽，占用主接入仓槽位）
              </span>
            </button>
          )}
        </fieldset>
      </div>

      {autoGroup ? (
        <p className={styles.note}>
          槽位规则：自动归入「{cyberwareRules.EXCLUSIVE_GROUP_LABELS[autoGroup]}」 （最多装{" "}
          {cyberwareRules.EXCLUSIVE_GROUP_LIMIT[autoGroup]} 件
          {cyberwareRules.EXCLUSIVE_GROUP_LIMIT[autoGroup] === 1
            ? "，装上时自动替换同槽旧件"
            : "，支持左右臂混搭"}
          ）。
        </p>
      ) : manualOptions.length > 0 ? (
        <label className={styles.field}>
          <span>
            同部位主槽替换规则
            <small>普通外挂/辅助件保持默认即可</small>
          </span>
          <FrameBox className={styles.compactBox}>
            <select
              value={exclusiveGroup}
              aria-label="选择同部位主槽替换规则"
              onChange={(e) =>
                setExclusiveGroup(e.target.value as "" | cyberwareRules.ExclusiveGroup)
              }
            >
              <option value="">不占主槽，可与其他义体自由叠加（默认）</option>
              {manualOptions.map((g) => (
                <option key={g} value={g}>
                  {exclusiveOptionLabel(g)}
                </option>
              ))}
            </select>
          </FrameBox>
        </label>
      ) : null}

      <div className={styles.slotTools}>
        <Button
          small
          primary
          disabled={!valid}
          reason="请先填写义体名称"
          onClick={() => submit(true)}
        >
          {editing ? "保存修改" : "保存并装上"}
        </Button>
        {!editing && (
          <Button small disabled={!valid} reason="请先填写义体名称" onClick={() => submit(false)}>
            仅存入自创库
          </Button>
        )}
        <ActionButton onClick={onCancel}>取消</ActionButton>
      </div>
    </div>
  );
}
