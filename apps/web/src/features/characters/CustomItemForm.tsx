import { type diceRules, economyRules, inventoryRules } from "@cp/core";
import { useState } from "react";
import { ActionButton } from "../../ui/ActionButton";
import { Button } from "../../ui/Button";
import { CellFrame, FrameBox } from "../../ui/FrameBox";
import { ToggleCheck } from "../../ui/ToggleCheck";
import { fallbackItemArtFor } from "../story/art";
import styles from "./characters.module.css";
import { saveLocalCustomItem } from "./creator";
import { GearArtPicker } from "./GearArtPicker";

const RARITY_OPTIONS: readonly economyRules.Rarity[] = [
  "common",
  "uncommon",
  "rare",
  "epic",
  "legendary",
];

const MELEE_CATS = new Set<inventoryRules.WeaponCategory>(["blade", "blunt"]);

const DEFAULT_PRICE_BY_RARITY: Readonly<Record<economyRules.Rarity, number>> = {
  common: 600,
  uncommon: 2200,
  rare: 7500,
  epic: 18000,
  legendary: 42000,
};

const CONCEALMENT_OPTIONS: readonly {
  readonly id: "" | diceRules.WeaponConcealment;
  readonly label: string;
}[] = [
  { id: "", label: "按武器类别自动判断" },
  { id: "pocket", label: "袖珍隐蔽（随身暗藏）" },
  { id: "coat", label: "风衣级（大衣/外套遮掩）" },
  { id: "open", label: "显眼外露（难藏身）" },
];

/**
 * 创角自建武器 / 物品表单：
 * 与自建义体（CustomCyberwareForm）同风格，支持新建或编辑并存入本地自创库，
 * 同时将完整 ItemDef 快照随角色卡保存，不依赖官方目录即可直接带进局内与分享到创意工坊。
 */
export function CustomItemForm({
  initial,
  initialKind = "weapon",
  onAccept,
  onCancel,
}: {
  readonly initial?: inventoryRules.ItemDef;
  readonly initialKind?: inventoryRules.ItemKind;
  readonly onAccept: (item: inventoryRules.ItemDef, equipToKit: boolean) => void;
  readonly onCancel: () => void;
}) {
  const isEditing = Boolean(initial);
  const [kind, setKind] = useState<inventoryRules.ItemKind>(initial?.kind ?? initialKind);
  const [name, setName] = useState(initial?.name ?? "");
  const [rarity, setRarity] = useState<economyRules.Rarity>(initial?.rarity ?? "rare");
  const [iconic, setIconic] = useState(Boolean(initial?.iconic));
  // 「登场」开关：默认登场——黑市摊位/商店街有售、可能被 NPC 持有；关掉则只随卡面与行装存在
  const [worldSpawn, setWorldSpawn] = useState(initial?.worldSpawn ?? true);
  const [price, setPrice] = useState<number>(
    initial?.price ?? DEFAULT_PRICE_BY_RARITY[initial?.rarity ?? "rare"],
  );
  const [ability, setAbility] = useState(initial?.ability ?? "");

  // 武器专属字段
  const [weaponCategory, setWeaponCategory] = useState<inventoryRules.WeaponCategory>(
    initial?.category ?? "pistol",
  );
  const [weaponType, setWeaponType] = useState<inventoryRules.WeaponType>(
    initial?.weaponType ?? "power",
  );
  const [concealment, setConcealment] = useState<"" | diceRules.WeaponConcealment>(
    initial?.concealment ?? "",
  );
  const [grantsSmartLink, setGrantsSmartLink] = useState(Boolean(initial?.grantsSmartLink));

  // 服装专属字段
  const [clothingSlot, setClothingSlot] = useState<inventoryRules.ClothingSlot>(
    initial?.clothingSlot ?? "outer",
  );
  const [clothingStyle, setClothingStyle] = useState<inventoryRules.ClothingStyle>(
    initial?.clothingStyle ?? "street",
  );
  const [concealsCoatWeapon, setConcealsCoatWeapon] = useState(
    Boolean(initial?.concealsCoatWeapon),
  );

  // 治疗品 / 手雷字段
  const [charges, setCharges] = useState<number>(initial?.charges ?? 3);
  const [healPercent, setHealPercent] = useState<number>(initial?.healPercent ?? 40);
  const [suppressant, setSuppressant] = useState(Boolean(initial?.suppressant));

  // 改装件字段
  const [modSlot, setModSlot] = useState<inventoryRules.ModSlot>(initial?.modSlot ?? "plugin");
  const [modFits, setModFits] = useState<readonly inventoryRules.WeaponCategory[]>(
    initial?.modFits ?? ["pistol"],
  );

  // 图标与自定义配图
  const [art, setArt] = useState<string | undefined>(initial?.art);
  const [customImage, setCustomImage] = useState<string | undefined>(initial?.customImage);

  const [error, setError] = useState<string | null>(null);

  const isMelee = MELEE_CATS.has(weaponCategory);

  const toggleModFit = (cat: inventoryRules.WeaponCategory) => {
    setModFits((cur) => {
      if (cur.includes(cat)) {
        return cur.length > 1 ? cur.filter((x) => x !== cat) : cur;
      }
      return [...cur, cat];
    });
  };

  const submit = (equipToKit: boolean) => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("请填写名称");
      return;
    }
    const id =
      initial?.id ??
      `custom-${kind === "weapon" ? "wp" : "item"}-${Date.now().toString(36).slice(-6)}-${Math.random().toString(36).slice(2, 5)}`;

    const effectiveModFits =
      kind === "mod" && modSlot !== "plugin" ? modFits.filter((c) => !MELEE_CATS.has(c)) : modFits;
    if (kind === "mod" && effectiveModFits.length === 0) {
      setError("枪口或瞄准镜改装件请至少选择一个远程武器类别");
      return;
    }

    const candidate: Record<string, unknown> = {
      id,
      name: trimmedName.slice(0, 40),
      kind,
      rarity,
      iconic,
      ...(worldSpawn ? {} : { worldSpawn: false }),
      price: Math.max(0, Math.round(price)),
      ...(ability.trim() ? { ability: ability.trim().slice(0, 240) } : {}),
      ...(art ? { art } : {}),
      ...(customImage ? { customImage } : {}),
    };

    if (kind === "weapon") {
      candidate.category = weaponCategory;
      if (!isMelee) candidate.weaponType = weaponType;
      if (concealment) candidate.concealment = concealment;
      if (!isMelee && grantsSmartLink) candidate.grantsSmartLink = true;
    } else if (kind === "clothing") {
      candidate.clothingSlot = clothingSlot;
      candidate.clothingStyle = clothingStyle;
      if (concealsCoatWeapon) candidate.concealsCoatWeapon = true;
    } else if (kind === "healing") {
      candidate.charges = Math.max(1, Math.min(20, Math.round(charges)));
      candidate.healPercent = Math.max(5, Math.min(100, Math.round(healPercent)));
      if (suppressant) candidate.suppressant = true;
    } else if (kind === "grenade") {
      candidate.charges = Math.max(1, Math.min(20, Math.round(charges)));
    } else if (kind === "mod") {
      candidate.modSlot = modSlot;
      candidate.modFits = effectiveModFits;
    } else if (kind === "consumable" && suppressant) {
      candidate.suppressant = true;
    }

    const parsed = inventoryRules.ItemDefSchema.safeParse(candidate);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "条目参数校验未通过");
      return;
    }
    saveLocalCustomItem(parsed.data);
    setError(null);
    onAccept(parsed.data, equipToKit);
  };

  return (
    <section
      className={styles.customForm}
      aria-label={isEditing ? "编辑自建物品" : "自建武器与物品"}
    >
      <CellFrame />
      <div className={styles.customFormHead}>
        <strong className={styles.pickName}>
          {isEditing
            ? `编辑自建${inventoryRules.ITEM_KIND_LABELS[kind]}`
            : kind === "weapon"
              ? "自建专属武器"
              : "自建随身物品"}
        </strong>
        <ActionButton onClick={onCancel}>收起</ActionButton>
      </div>

      {/* 类型切换（编辑时也可跨类型，新建时可快速选武器/物品） */}
      <fieldset className={styles.shelfFilter} aria-label="物品类别">
        {(
          Object.entries(inventoryRules.ITEM_KIND_LABELS) as [inventoryRules.ItemKind, string][]
        ).map(([k, label]) => (
          <Button
            key={k}
            small
            pressed={kind === k}
            onClick={() => {
              setKind(k);
              setError(null);
            }}
          >
            {label}
          </Button>
        ))}
      </fieldset>

      <div className={styles.customFormGrid}>
        <label className={styles.field}>
          <span>名称 *</span>
          <FrameBox className={styles.compactBox}>
            <input
              maxLength={40}
              value={name}
              placeholder={
                kind === "weapon" ? "例如：荒坂特制消音手枪·幽影" : "例如：高纯度神经稳压剂"
              }
              onChange={(e) => setName(e.target.value)}
            />
          </FrameBox>
        </label>

        <label className={styles.field}>
          <span>参考价格（€$）</span>
          <FrameBox className={styles.compactBox}>
            <input
              type="number"
              min={0}
              step={100}
              value={price}
              onChange={(e) => setPrice(Math.max(0, Number(e.target.value) || 0))}
            />
          </FrameBox>
        </label>
      </div>

      {/* 稀有度 + 不朽 */}
      <div className={styles.slotTools}>
        <fieldset className={styles.shelfFilter} aria-label="稀有度">
          {RARITY_OPTIONS.map((r) => (
            <Button
              key={r}
              small
              pressed={rarity === r}
              onClick={() => {
                setRarity(r);
                if (!isEditing) setPrice(DEFAULT_PRICE_BY_RARITY[r]);
              }}
            >
              {economyRules.RARITY_LABELS[r]}
            </Button>
          ))}
        </fieldset>
        <div className={styles.toggleRow}>
          <ToggleCheck checked={iconic} aria-label="标记为不朽" onChange={setIconic} />
          <span>不朽（Iconic）</span>
        </div>
        <div className={styles.toggleRow}>
          <ToggleCheck
            checked={worldSpawn}
            aria-label="登场：夜之城流通"
            onChange={setWorldSpawn}
          />
          <span>
            登场：夜之城流通
            <small>——黑市摊位/商店街有售、可能被 NPC 持有；关掉则只随卡面与行装存在</small>
          </span>
        </div>
      </div>

      {/* 武器专属属性 */}
      {kind === "weapon" && (
        <div className={styles.customFormGrid}>
          <label className={styles.field}>
            <span>武器类别</span>
            <FrameBox className={styles.compactBox}>
              <select
                value={weaponCategory}
                onChange={(e) => setWeaponCategory(e.target.value as inventoryRules.WeaponCategory)}
              >
                {(
                  Object.entries(inventoryRules.WEAPON_CATEGORY_LABELS) as [
                    inventoryRules.WeaponCategory,
                    string,
                  ][]
                ).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </FrameBox>
          </label>

          {!isMelee && (
            <label className={styles.field}>
              <span>弹道体系</span>
              <FrameBox className={styles.compactBox}>
                <select
                  value={weaponType}
                  onChange={(e) => setWeaponType(e.target.value as inventoryRules.WeaponType)}
                >
                  {(
                    Object.entries(inventoryRules.WEAPON_TYPE_LABELS) as [
                      inventoryRules.WeaponType,
                      string,
                    ][]
                  ).map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </select>
              </FrameBox>
            </label>
          )}

          <label className={styles.field}>
            <span>隐蔽携带</span>
            <FrameBox className={styles.compactBox}>
              <select
                value={concealment}
                onChange={(e) => setConcealment(e.target.value as "" | diceRules.WeaponConcealment)}
              >
                {CONCEALMENT_OPTIONS.map((opt) => (
                  <option key={opt.id || "auto"} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </FrameBox>
          </label>

          {!isMelee && (
            <div className={styles.toggleRow}>
              <ToggleCheck
                checked={grantsSmartLink}
                aria-label="内置智能靶向握把"
                onChange={setGrantsSmartLink}
              />
              <span>自带智能靶向模块（免手部智能连接）</span>
            </div>
          )}
        </div>
      )}

      {/* 服装专属属性 */}
      {kind === "clothing" && (
        <div className={styles.customFormGrid}>
          <label className={styles.field}>
            <span>穿戴部位</span>
            <FrameBox className={styles.compactBox}>
              <select
                value={clothingSlot}
                onChange={(e) => setClothingSlot(e.target.value as inventoryRules.ClothingSlot)}
              >
                {(
                  Object.entries(inventoryRules.CLOTHING_SLOT_LABELS) as [
                    inventoryRules.ClothingSlot,
                    string,
                  ][]
                ).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </FrameBox>
          </label>
          <label className={styles.field}>
            <span>风格定位</span>
            <FrameBox className={styles.compactBox}>
              <select
                value={clothingStyle}
                onChange={(e) => setClothingStyle(e.target.value as inventoryRules.ClothingStyle)}
              >
                {(
                  Object.entries(inventoryRules.CLOTHING_STYLE_LABELS) as [
                    inventoryRules.ClothingStyle,
                    string,
                  ][]
                ).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </FrameBox>
          </label>
          <div className={styles.toggleRow}>
            <ToggleCheck
              checked={concealsCoatWeapon}
              aria-label="自带宽大暗袋可遮掩短枪"
              onChange={setConcealsCoatWeapon}
            />
            <span>宽大衣摆/暗袋（可遮掩风衣级武器）</span>
          </div>
        </div>
      )}

      {/* 治疗品 / 手雷 / 消耗品专属属性 */}
      {(kind === "healing" || kind === "grenade") && (
        <div className={styles.customFormGrid}>
          <label className={styles.field}>
            <span>单份可用次数</span>
            <FrameBox className={styles.compactBox}>
              <input
                type="number"
                min={1}
                max={20}
                value={charges}
                onChange={(e) => setCharges(Math.max(1, Number(e.target.value) || 1))}
              />
            </FrameBox>
          </label>
          {kind === "healing" && (
            <label className={styles.field}>
              <span>每次回复比例（%）</span>
              <FrameBox className={styles.compactBox}>
                <input
                  type="number"
                  min={5}
                  max={100}
                  value={healPercent}
                  onChange={(e) => setHealPercent(Math.max(5, Number(e.target.value) || 30))}
                />
              </FrameBox>
            </label>
          )}
        </div>
      )}

      {(kind === "healing" || kind === "consumable") && (
        <div className={styles.toggleRow}>
          <ToggleCheck
            checked={suppressant}
            aria-label="属于赛博精神病神经压制剂"
            onChange={setSuppressant}
          />
          <span>神经压制剂（可用于快捷压制赛博精神病征兆）</span>
        </div>
      )}

      {/* 改装件专属属性 */}
      {kind === "mod" && (
        <div className={styles.pickerBody}>
          <label className={styles.field}>
            <span>改装槽位</span>
            <FrameBox className={styles.compactBox}>
              <select
                value={modSlot}
                onChange={(e) => setModSlot(e.target.value as inventoryRules.ModSlot)}
              >
                {(
                  Object.entries(inventoryRules.MOD_SLOT_LABELS) as [
                    inventoryRules.ModSlot,
                    string,
                  ][]
                ).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </FrameBox>
          </label>
          <fieldset className={styles.shelfFilter} aria-label="适用武器类别">
            {(
              Object.entries(inventoryRules.WEAPON_CATEGORY_LABELS) as [
                inventoryRules.WeaponCategory,
                string,
              ][]
            )
              .filter(([id]) => modSlot === "plugin" || !MELEE_CATS.has(id))
              .map(([id, label]) => (
                <Button
                  key={id}
                  small
                  pressed={modFits.includes(id)}
                  onClick={() => toggleModFit(id)}
                >
                  {label}
                </Button>
              ))}
          </fieldset>
        </div>
      )}

      <GearArtPicker
        group={kind === "weapon" ? "weapon" : "item"}
        subGroup={
          kind === "weapon"
            ? weaponCategory
            : kind === "clothing"
              ? `clothing:${clothingSlot}`
              : kind === "mod"
                ? `mod:${modSlot}`
                : kind
        }
        fallbackArt={fallbackItemArtFor({
          kind,
          category: weaponCategory,
          clothingSlot,
          modSlot,
        })}
        art={art}
        customImage={customImage}
        onChange={(next) => {
          setArt(next.art);
          setCustomImage(next.customImage);
        }}
      />

      <label className={styles.field}>
        <span>能力、手感与外观说明（写给 AI 叙事与检定参考）</span>
        <FrameBox className={styles.inputBox}>
          <textarea
            rows={2}
            maxLength={240}
            value={ability}
            placeholder="例如：加装低噪膛线与陶瓷护木，暗巷中拔枪极快且不易被金属安检仪检出…"
            onChange={(e) => setAbility(e.target.value)}
          />
        </FrameBox>
      </label>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      <div className={styles.customFormActions}>
        <Button small onClick={() => submit(false)}>
          仅存入自创库
        </Button>
        <Button small primary onClick={() => submit(true)}>
          {isEditing ? "保存修改并带入行装" : "保存并加入开局行装"}
        </Button>
      </div>
    </section>
  );
}
