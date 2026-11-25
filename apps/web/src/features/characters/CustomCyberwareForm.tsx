import { cyberwareRules, type StartCyberware, StartCyberwareSchema } from "@cp/core";
import { useState } from "react";
import { ActionButton } from "../../ui/ActionButton";
import { Button } from "../../ui/Button";
import { CellFrame, FrameBox } from "../../ui/FrameBox";
import { CYBER_LABELS, type CyberSlot } from "../story/CyberDoll";
import styles from "./characters.module.css";
import { saveLocalCustomCyberware } from "./creator";

type LoadLevel = "zero" | "standard" | "heavy";

const LOAD_LEVELS: readonly {
  readonly id: LoadLevel;
  readonly label: string;
  readonly cost: number;
  readonly hint: string;
}[] = [
  { id: "zero", label: "零负荷（生活/时尚/感官/亲密）", cost: 0, hint: "不占神经负荷" },
  { id: "standard", label: "常规实战负荷", cost: 4, hint: "正常佣兵义体" },
  { id: "heavy", label: "高压神经重器", cost: 12, hint: "军用重装/全身改造级" },
];

function inferLoadLevel(cost: number): LoadLevel {
  if (cost <= 0) return "zero";
  if (cost >= 10) return "heavy";
  return "standard";
}

const EXCLUSIVE_OPTIONS: readonly {
  readonly id: "" | cyberwareRules.ExclusiveGroup;
  readonly label: string;
}[] = [
  { id: "", label: "不互斥（可自由叠加）" },
  ...cyberwareRules.EXCLUSIVE_GROUPS.map((g) => ({
    id: g,
    label: `${cyberwareRules.EXCLUSIVE_GROUP_LABELS[g]}（限 ${cyberwareRules.EXCLUSIVE_GROUP_LIMIT[g]}）`,
  })),
];

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
  readonly onAccept: (item: StartCyberware) => void;
  readonly onCancel: () => void;
}) {
  const editing = Boolean(initial);
  const [name, setName] = useState(() => initial?.name ?? "");
  const [ability, setAbility] = useState(() => initial?.ability ?? initial?.summary ?? "");
  const [loadLevel, setLoadLevel] = useState<LoadLevel>(() =>
    inferLoadLevel(initial?.humanityCost ?? 0),
  );
  const [exclusiveGroup, setExclusiveGroup] = useState<"" | cyberwareRules.ExclusiveGroup>(
    () => initial?.exclusiveGroup ?? "",
  );
  const [armor, setArmor] = useState(() => Boolean(initial?.armor));
  const [accelerator, setAccelerator] = useState(() => Boolean(initial?.accelerator));
  const [isDeck, setIsDeck] = useState(() => Boolean(initial?.deckProfile));

  const cost = LOAD_LEVELS.find((l) => l.id === loadLevel)?.cost ?? 0;
  const candidate: StartCyberware = {
    id: initial?.id ?? `custom-cw-${Date.now().toString(36)}`,
    name: name.trim(),
    slot,
    humanityCost: cost,
    ability: ability.trim() || "自定义义体模块",
    ...(armor ? { armor: true } : {}),
    ...(accelerator ? { accelerator: true } : {}),
    ...(isDeck ? { deckProfile: "自定义网络接入仓" } : {}),
    ...(exclusiveGroup ? { exclusiveGroup } : {}),
    custom: true,
    packId: initial?.packId ?? "local",
  };
  const valid = name.trim().length > 0 && StartCyberwareSchema.safeParse(candidate).success;

  return (
    <div className={styles.customForm}>
      <CellFrame />
      <label className={styles.field}>
        <span>
          {editing
            ? `编辑自创义体（${CYBER_LABELS[slot]}）`
            : `自创义体名称（${CYBER_LABELS[slot]}）`}
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
        <span>
          实际效果与限制说明（写给叙事与裁决模型）
          <small>{ability.length} / 200</small>
        </span>
        <FrameBox className={styles.inputBox}>
          <textarea
            rows={3}
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

      <label className={styles.field}>
        <span>物理互斥规则</span>
        <FrameBox className={styles.compactBox}>
          <select
            value={exclusiveGroup}
            aria-label="选择物理互斥规则"
            onChange={(e) =>
              setExclusiveGroup(e.target.value as "" | cyberwareRules.ExclusiveGroup)
            }
          >
            {EXCLUSIVE_OPTIONS.map((opt) => (
              <option key={opt.id || "none"} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </select>
        </FrameBox>
      </label>

      <div className={styles.field}>
        <span>硬件标签（按需勾选）</span>
        <fieldset className={styles.shelfFilter} aria-label="自创义体硬件标签">
          <Button small pressed={armor} onClick={() => setArmor((v) => !v)}>
            {armor ? "✓ 护甲防护" : "护甲防护"}
          </Button>
          <Button small pressed={accelerator} onClick={() => setAccelerator((v) => !v)}>
            {accelerator ? "✓ 神经加速" : "神经加速"}
          </Button>
          <Button small pressed={isDeck} onClick={() => setIsDeck((v) => !v)}>
            {isDeck ? "✓ 网络接入仓" : "网络接入仓"}
          </Button>
        </fieldset>
      </div>

      <div className={styles.slotTools}>
        <Button
          small
          primary
          disabled={!valid}
          reason="请先填写义体名称"
          onClick={() => {
            saveLocalCustomCyberware(candidate);
            onAccept(candidate);
          }}
        >
          {editing ? "保存修改" : "保存并装上义体"}
        </Button>
        <ActionButton onClick={onCancel}>取消</ActionButton>
      </div>
    </div>
  );
}
