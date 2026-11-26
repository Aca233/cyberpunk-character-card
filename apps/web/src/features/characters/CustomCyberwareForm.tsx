import { cyberwareRules, economyRules, type StartCyberware, StartCyberwareSchema } from "@cp/core";
import { useState } from "react";
import { ActionButton } from "../../ui/ActionButton";
import { Button } from "../../ui/Button";
import { CellFrame, FrameBox } from "../../ui/FrameBox";
import type { CyberSlot } from "../story/CyberDoll";
import styles from "./characters.module.css";
import { saveLocalCustomCyberware } from "./creator";

type CategoryId = cyberwareRules.CyberwareCategoryId;

const CORE_CATEGORIES: readonly CategoryId[] = [
  "chassis",
  "cyberdeck",
  "spineDrive",
  "optics",
  "arms",
  "legDrive",
  "skinArmor",
];

const EXTENSION_CATEGORIES: readonly CategoryId[] = cyberwareRules.EXTENSION_ZONE_IDS;

const RARITY_OPTIONS: readonly economyRules.Rarity[] = [
  "common",
  "uncommon",
  "rare",
  "epic",
  "legendary",
];

const LOAD_PRESETS: readonly { readonly label: string; readonly cost: number }[] = [
  { label: "轻型（2）", cost: 2 },
  { label: "常规（5）", cost: 5 },
  { label: "重型（9）", cost: 9 },
  { label: "军用重器（14）", cost: 14 },
];

function slotForCategory(category: CategoryId): CyberSlot {
  switch (category) {
    case "chassis":
      return "skeleton";
    case "cyberdeck":
    case "spineDrive":
      return "os";
    case "optics":
    case "sensory":
      return "eyes";
    case "arms":
      return "arms";
    case "legDrive":
      return "legs";
    case "skinArmor":
    case "lifestyle":
      return "integumentary";
    case "neural":
      return "frontalCortex";
    case "torso":
      return "circulatory";
    case "extremities":
      return "hands";
  }
}

function defaultLoadForCategory(category: CategoryId): number {
  switch (category) {
    case "lifestyle":
      return 0;
    case "chassis":
      return 15;
    case "spineDrive":
    case "arms":
      return 8;
    case "cyberdeck":
    case "skinArmor":
      return 5;
    case "optics":
    case "legDrive":
      return 3;
    default:
      return 4;
  }
}

function inferCategory(initial: StartCyberware | undefined, fallback: CategoryId): CategoryId {
  if (!initial) return fallback;
  if (initial.category) return initial.category;
  if (initial.slot) {
    return cyberwareRules.cyberwareCategoryOf({
      id: initial.id,
      name: initial.name,
      slot: initial.slot,
      ...(initial.armor ? { armor: true } : {}),
      ...(initial.accelerator ? { accelerator: true } : {}),
      ...(initial.deckProfile ? { deckProfile: initial.deckProfile } : {}),
      ...(initial.exclusiveGroup ? { exclusiveGroup: initial.exclusiveGroup } : {}),
    });
  }
  return fallback;
}

const EXTENSION_ORGAN_OPTIONS: Readonly<
  Partial<
    Record<
      CategoryId,
      readonly { readonly group: cyberwareRules.ExclusiveGroup; readonly label: string }[]
    >
  >
> = {
  torso: [
    { group: "skinStealth", label: "表皮隐匿层（与光学迷彩 / 全息伪装互斥）" },
    { group: "painOverride", label: "痛觉覆写（与疼痛编辑器 / 疼痛置换互斥）" },
    { group: "exoskeletonFrame", label: "承重外骨骼（与 Σ 外骨骼 / 负重脊柱架互斥）" },
  ],
  extremities: [{ group: "footTread", label: "足底主改（与猞猁爪 / 磁吸攀爬足互斥）" }],
  lifestyle: [{ group: "intimateCore", label: "核心亲密义体（与午夜绅士 / 午夜佳人互斥）" }],
};

/**
 * 自建义体 v2 表单（一屏 4 行，与「8 核心主位 + 5 扩展区」完全对齐，零后台黑话）：
 * - 选定归属定位后自动推导底层部位、主位规则与对应能力；
 * - 选「外观与生活」自动锁 0 承载、不占功能空间。
 */
export function CustomCyberwareForm({
  category: initialCategory,
  initial,
  onAccept,
  onCancel,
}: {
  readonly category: CategoryId;
  readonly initial?: StartCyberware;
  readonly onAccept: (item: StartCyberware, options: { readonly equip: boolean }) => void;
  readonly onCancel: () => void;
}) {
  const editing = Boolean(initial);
  const [category, setCategory] = useState<CategoryId>(() =>
    inferCategory(initial, initialCategory),
  );
  const [name, setName] = useState(() => initial?.name ?? "");
  const [ability, setAbility] = useState(() => initial?.ability ?? initial?.summary ?? "");
  const [rarity, setRarity] = useState<economyRules.Rarity>(() => initial?.rarity ?? "rare");
  const [loadCost, setLoadCost] = useState<number>(() =>
    initial ? initial.humanityCost : defaultLoadForCategory(initialCategory),
  );
  const [extraArmor, setExtraArmor] = useState(() => Boolean(initial?.armor));
  const [activeBoost, setActiveBoost] = useState(() =>
    initial ? Boolean(initial.accelerator) : initialCategory === "spineDrive",
  );
  const [capacityCore, setCapacityCore] = useState(
    () => initial?.exclusiveGroup === "capacityCore",
  );
  const [armSide, setArmSide] = useState<cyberwareRules.ArmSide>(() => initial?.armSide ?? "both");
  const [organGroup, setOrganGroup] = useState<"" | cyberwareRules.ExclusiveGroup>(() =>
    initial?.exclusiveGroup &&
    cyberwareRules.EXTENSION_EXCLUSIVE_GROUPS.includes(initial.exclusiveGroup)
      ? initial.exclusiveGroup
      : "",
  );

  const handleCategoryChange = (next: CategoryId) => {
    setCategory(next);
    if (!editing) {
      setLoadCost(defaultLoadForCategory(next));
    } else if (next === "lifestyle") {
      setLoadCost(0);
    }
    if (next === "spineDrive") {
      setActiveBoost(true);
      setCapacityCore(false);
    } else {
      setCapacityCore(false);
      if (next !== "neural") setActiveBoost(false);
    }
    const allowed = EXTENSION_ORGAN_OPTIONS[next] ?? [];
    if (organGroup && !allowed.some((opt) => opt.group === organGroup)) {
      setOrganGroup("");
    }
  };

  const isLifestyle = category === "lifestyle";
  const effectiveLoad = isLifestyle || capacityCore ? 0 : Math.max(0, Math.min(18, loadCost));
  const slot = slotForCategory(category);

  const exclusiveGroup: cyberwareRules.ExclusiveGroup | undefined =
    category === "chassis"
      ? "fullBorg"
      : category === "cyberdeck"
        ? "cyberdeck"
        : category === "spineDrive"
          ? capacityCore
            ? "capacityCore"
            : "spineDrive"
          : category === "optics"
            ? "optics"
            : category === "arms"
              ? "armMount"
              : category === "legDrive"
                ? "legDrive"
                : category === "skinArmor"
                  ? "skinArmor"
                  : organGroup || undefined;

  const isArmor = category === "skinArmor" || (category === "torso" && extraArmor);
  const isAccelerator =
    (category === "spineDrive" && !capacityCore && activeBoost) ||
    (category === "neural" && activeBoost);
  const isDeck = category === "cyberdeck";

  const candidate: StartCyberware = {
    id: initial?.id ?? `custom-cw-${Date.now().toString(36)}`,
    name: name.trim(),
    slot,
    category,
    rarity,
    humanityCost: effectiveLoad,
    ability: ability.trim() || "自定义义体模块",
    ...(isArmor ? { armor: true } : {}),
    ...(isAccelerator ? { accelerator: true } : {}),
    ...(isDeck ? { deckProfile: "自定义网络接入仓" } : {}),
    ...(exclusiveGroup ? { exclusiveGroup } : {}),
    ...(category === "arms" ? { armSide } : {}),
    custom: true,
    packId: initial?.packId ?? "local",
  };
  const valid = name.trim().length > 0 && StartCyberwareSchema.safeParse(candidate).success;

  const submit = (equip: boolean) => {
    saveLocalCustomCyberware(candidate);
    onAccept(candidate, { equip });
  };

  const organChoices = EXTENSION_ORGAN_OPTIONS[category] ?? [];

  return (
    <div className={styles.customForm}>
      <CellFrame />
      <div className={styles.customFormHead}>
        <strong className={styles.customFormTitle}>
          {editing ? "编辑自创义体" : "新建自创义体"} ·{" "}
          {cyberwareRules.CYBERWARE_CATEGORY_LABELS[category]}
        </strong>
        <ActionButton onClick={onCancel}>返回货架</ActionButton>
      </div>

      {/* 第一行：义体名称 + 归属定位 */}
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
          <span>归属定位</span>
          <FrameBox className={styles.compactBox}>
            <select
              value={category}
              aria-label="选择义体归属定位"
              onChange={(e) => handleCategoryChange(e.target.value as CategoryId)}
            >
              <optgroup label="核心主位（一坑一物）">
                {CORE_CATEGORIES.map((id) => (
                  <option key={id} value={id}>
                    {cyberwareRules.CYBERWARE_CATEGORY_LABELS[id]}
                  </option>
                ))}
              </optgroup>
              <optgroup label="扩展与生活">
                {EXTENSION_CATEGORIES.map((id) => (
                  <option key={id} value={id}>
                    {cyberwareRules.CYBERWARE_CATEGORY_LABELS[id]}
                    {id === "lifestyle" ? "（零承载）" : ""}
                  </option>
                ))}
              </optgroup>
            </select>
          </FrameBox>
        </label>
      </div>

      {/* 第二行：稀有度 + 神经承载 */}
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

      <div className={styles.field}>
        <span>
          神经承载
          <small>
            {isLifestyle
              ? "外观与生活件固定 0 承载、不占功能空间"
              : capacityCore
                ? "神经扩容主控固定 0 承载，并将上限由 50 扩至 70"
                : `当前 ${effectiveLoad} 点（可点档位或微调 0–18）`}
          </small>
        </span>
        {!isLifestyle && !capacityCore && (
          <div className={styles.shelfFilter}>
            {LOAD_PRESETS.map((preset) => (
              <Button
                key={preset.cost}
                small
                pressed={effectiveLoad === preset.cost}
                onClick={() => setLoadCost(preset.cost)}
              >
                {preset.label}
              </Button>
            ))}
            <input
              type="number"
              min={0}
              max={18}
              value={effectiveLoad}
              aria-label="微调神经承载数值"
              style={{ width: 64, padding: "4px 8px" }}
              onChange={(e) => {
                const n = Number.parseInt(e.target.value, 10);
                setLoadCost(Number.isNaN(n) ? 0 : Math.max(0, Math.min(18, n)));
              }}
            />
          </div>
        )}
      </div>

      {/* 第三行：效果与限制说明 */}
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

      {/* 第四行：按定位收起的精简机制选项（零后台黑话） */}
      {category === "arms" && (
        <div className={styles.field}>
          <span>默认装配侧别</span>
          <fieldset className={styles.shelfFilter} aria-label="手臂默认装配侧别">
            {(["both", "left", "right"] as const).map((side) => (
              <Button key={side} small pressed={armSide === side} onClick={() => setArmSide(side)}>
                {cyberwareRules.ARM_SIDE_LABELS[side]}
                {side === "both" ? "（100% 承载）" : "（60% 承载）"}
              </Button>
            ))}
          </fieldset>
        </div>
      )}

      {category === "spineDrive" && (
        <div className={styles.field}>
          <span>脊柱主控类型</span>
          <fieldset className={styles.shelfFilter} aria-label="脊柱主控类型">
            <Button
              small
              pressed={!capacityCore && activeBoost}
              onClick={() => {
                setCapacityCore(false);
                setActiveBoost(true);
              }}
            >
              主动加速 / 狂暴（解锁爆发按钮）
            </Button>
            <Button
              small
              pressed={!capacityCore && !activeBoost}
              onClick={() => {
                setCapacityCore(false);
                setActiveBoost(false);
              }}
            >
              常驻被动脊柱主驱
            </Button>
            <Button
              small
              pressed={capacityCore}
              onClick={() => {
                setCapacityCore(true);
                setActiveBoost(false);
              }}
            >
              神经扩容模组（弃接入仓换 +20 上限）
            </Button>
          </fieldset>
        </div>
      )}

      {category === "neural" && (
        <div className={styles.field}>
          <span>联动机制（可选）</span>
          <fieldset className={styles.shelfFilter}>
            <Button small pressed={activeBoost} onClick={() => setActiveBoost((v) => !v)}>
              {activeBoost ? "✓ 解锁输入框主动加速按钮" : "解锁输入框主动加速按钮"}
            </Button>
          </fieldset>
        </div>
      )}

      {category === "torso" && (
        <div className={styles.field}>
          <span>联动机制（可选）</span>
          <fieldset className={styles.shelfFilter}>
            <Button small pressed={extraArmor} onClick={() => setExtraArmor((v) => !v)}>
              {extraArmor ? "✓ 提供额外护甲防护" : "提供额外护甲防护"}
            </Button>
          </fieldset>
        </div>
      )}

      {organChoices.length > 0 && (
        <label className={styles.field}>
          <span>同类器官替换（可选，仅在同器官只能装 1 件时选择）</span>
          <FrameBox className={styles.compactBox}>
            <select
              value={organGroup}
              aria-label="选择同类器官替换关系"
              onChange={(e) => setOrganGroup(e.target.value as "" | cyberwareRules.ExclusiveGroup)}
            >
              <option value="">不与其他扩展件互斥</option>
              {organChoices.map((opt) => (
                <option key={opt.group} value={opt.group}>
                  {opt.label}
                </option>
              ))}
            </select>
          </FrameBox>
        </label>
      )}

      <div className={styles.customFormActions}>
        <Button small onClick={onCancel}>
          取消
        </Button>
        <Button small disabled={!valid} onClick={() => submit(false)}>
          {editing ? "仅保存修改" : "仅存入自创库"}
        </Button>
        <Button small primary disabled={!valid} onClick={() => submit(true)}>
          {editing ? "保存并更新装配" : "保存并装上"}
        </Button>
      </div>
    </div>
  );
}
