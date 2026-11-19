import { characterRules, inventoryRules, type PlayerAction } from "@cp/core";
import { type CSSProperties, type ReactNode, useRef, useState } from "react";
import { ActionButton } from "../../ui/ActionButton";
import { Asset, cssUrl, NineSlice } from "../../ui/Asset";
import { Button } from "../../ui/Button";
import { CellFrame, FrameBox } from "../../ui/FrameBox";
import { Panel } from "../../ui/Panel";
import { baseWeaponIdOf, itemArtOf } from "./art";
import { BiomonitorPanel } from "./BiomonitorPanel";
import { ContentMediaList, InlineContentText } from "./ContentMedia";
import { CYBER_LABELS, CyberDoll, type CyberSlot } from "./CyberDoll";
import mediaStyles from "./content-media.module.css";
import { rarityLabelOf, rarityTintOf } from "./cyberwareMeta";
import { FactionsBody } from "./FactionsPanel";
import { type HabitAction, Habits } from "./Habits";
import { InventoryStorage, type PlaceInventoryItem } from "./InventoryStorage";
import storageStyles from "./inventory-storage.module.css";
import { countdown } from "./Journal";
import { NewsBody } from "./NewsPanel";
import neural from "./neural.module.css";
import { Avatar, type PhoneActions, PhoneBody, UnreadBadge } from "./Phone";
import { Profile } from "./Profile";
import { type SquadAction, SquadPanel } from "./SquadPanel";
import styles from "./story.module.css";
import {
  CONCEALMENT_LABELS,
  displayItemName,
  NOISE_LABELS,
  trackTelemetry,
  type View,
  woundTelemetry,
} from "./view";

/**
 * 神经界面里由旧左侧栏拆出来的几页（2077-interface-plan.md 第五节第 4 条）：
 * 人物、义体、物品栏、制作、联系人。写法照旧侧栏，按页分开；商店、义体医生、买公寓的入口
 * 暂时挂在物品栏和义体页，U3 改走 F 交互
 */

/** 物品格九宫格切法，同四角在场的人用的 map.filterCell*（计划第九节） */
const CELL_SLICE = [20, 30, 30, 20] as const;

/** 人物（P）：3.0 生物检测读数、角色主板与习惯（无桌面端数值属性栏） */
export function CharacterPage({
  view,
  onHabit,
  onTrauma,
  busy,
}: {
  readonly view: View;
  readonly onHabit?: ((action: HabitAction, text: string) => void) | undefined;
  readonly onTrauma?:
    | ((action: Extract<PlayerAction, { type: "trauma" }>) => Promise<void>)
    | undefined;
  readonly busy?: boolean | undefined;
}) {
  const { character } = view;
  const firstWithAbility = character.traits.find((t) => Boolean(t.ability));
  const [activeTraitKey, setActiveTraitKey] = useState<string | null>(
    firstWithAbility ? `${firstWithAbility.slot}-${firstWithAbility.label}` : null,
  );
  const activeTrait =
    character.traits.find((t) => `${t.slot}-${t.label}` === activeTraitKey) ??
    firstWithAbility ??
    null;

  const origins = character.traits.filter((t) => t.slot === "origin");
  const modules = character.traits.filter((t) => t.slot !== "origin");

  const bindTrait = (t: View["character"]["traits"][number]) => {
    const key = `${t.slot}-${t.label}`;
    return {
      key,
      selected: activeTrait ? `${activeTrait.slot}-${activeTrait.label}` === key : false,
      title: t.ability || undefined,
      onClick: () => setActiveTraitKey(key),
      onMouseEnter: () => {
        if (t.ability) setActiveTraitKey(key);
      },
      onFocus: () => {
        if (t.ability) setActiveTraitKey(key);
      },
    };
  };

  return (
    <div className={styles.characterRoot}>
      {character.name === null && (
        <p className={styles.dim}>这是未绑定角色的旧存档。新建存档时可以选择自己的角色。</p>
      )}
      <BiomonitorPanel view={view} onTrauma={onTrauma} busy={busy} />

      {character.traits.length > 0 && (
        <section className={styles.traitSection} aria-label="角色主板">
          <div className={styles.traitBoard}>
            {origins.map((t) => {
              const { key, selected, ...interactive } = bindTrait(t);
              return (
                <button
                  key={key}
                  type="button"
                  className={styles.originPlaque}
                  aria-pressed={selected}
                  {...interactive}
                >
                  <small className={styles.originStamp}>
                    {characterRules.TRAIT_LABELS[t.slot]}
                  </small>
                  <span className={styles.originLabel}>{t.label}</span>
                </button>
              );
            })}
            {origins.length > 0 && modules.length > 0 && (
              <span className={styles.traitSep} aria-hidden />
            )}
            {modules.length > 0 && (
              <ul className={styles.traits}>
                {modules.map((t) => {
                  const { key, selected, ...interactive } = bindTrait(t);
                  return (
                    <li key={key}>
                      <button
                        type="button"
                        className={styles.traitChip}
                        data-slot={t.slot}
                        aria-pressed={selected}
                        {...interactive}
                      >
                        <i className={styles.traitDot} aria-hidden />
                        <small className={styles.traitKind}>
                          {characterRules.TRAIT_LABELS[t.slot]}
                        </small>
                        <span className={styles.traitLabel}>{t.label}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          {activeTrait?.ability && (
            <div className={styles.traitDetail} data-slot={activeTrait.slot} role="status">
              <div className={styles.traitDetailHead}>
                <small
                  className={activeTrait.slot === "origin" ? styles.originStamp : styles.traitKind}
                >
                  {characterRules.TRAIT_LABELS[activeTrait.slot]}
                </small>
                <b>{activeTrait.label}</b>
              </div>
              <p className={styles.traitDetailText}>{activeTrait.ability}</p>
            </div>
          )}
        </section>
      )}
      <Habits habits={character.habits} offers={character.habitOffers} onHabit={onHabit} />
    </div>
  );
}

type CyberPart = View["cyberware"][number];

/** 义体（原作 2077 义体页面布局：人体部位图 + 左侧人性条 + 悬停精简详情 + 右下角义体医生入口） */
export function CyberwarePage({
  view,
  onRipperdoc,
}: {
  readonly view: View;
  readonly onRipperdoc: () => void;
}) {
  // 一个部位按原作格数能装几件，按装上的先后排
  const bySlot = new Map<CyberSlot, CyberPart[]>();
  for (const c of view.cyberware) bySlot.set(c.slot, [...(bySlot.get(c.slot) ?? []), c]);
  const brokenCount = view.cyberware.filter((c) => c.broken).length;

  const tip = (slot: CyberSlot, _parts: readonly unknown[], index: number) => {
    const list = bySlot.get(slot) ?? [];
    const part = list[index];
    if (!part) {
      return (
        <p className={neural.cyberTipMuted}>
          {view.ripperdoc
            ? `空余槽位，可在${view.ripperdoc.name}的诊所安装或更换。`
            : "空余槽位，可前往义体医生诊所安装。"}
        </p>
      );
    }
    const rarityLabel = rarityLabelOf(part.rarity, part.iconic);
    return (
      <>
        <h3 className={neural.cyberName} data-broken={part.broken || undefined}>
          {part.name}
        </h3>
        <p className={neural.cyberTipMeta} data-broken={part.broken || undefined}>
          {[rarityLabel, CYBER_LABELS[slot], part.broken ? "已损毁（待修）" : null]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {part.ability && <p className={styles.cyberAbility}>{part.ability}</p>}
        {!part.broken && (part.deckProfile || (part.deckTraits && part.deckTraits.length > 0)) && (
          <p className={styles.dim}>
            {[part.deckTraits?.join(" · "), part.deckProfile].filter(Boolean).join(" — ")}
          </p>
        )}
      </>
    );
  };

  return (
    <div className={neural.cyberPage}>
      <CyberDoll
        parts={bySlot}
        humanity={view.humanity}
        tip={tip}
        tipLine={(_slot, list, index) => {
          const part = list[index];
          if (!part) return "var(--cp-cyan)";
          return part.broken ? "var(--cp-danger)" : rarityTintOf(part.rarity, part.iconic);
        }}
        corner={
          (view.health.lostLimbs.length > 0 || view.ripperdoc) && (
            <>
              {view.health.lostLimbs.length > 0 && (
                <Panel as="section" title="断肢" line="var(--cp-red)">
                  <p className={styles.lostLimbs}>
                    {view.health.lostLimbs.map((l) => l.label).join("、")}
                  </p>
                </Panel>
              )}
              {view.ripperdoc && (
                <div>
                  {brokenCount > 0 && (
                    <p className={neural.cyberClinicHint}>{brokenCount} 件义体损毁待修</p>
                  )}
                  <Button primary onClick={onRipperdoc}>
                    义体医生 · {view.ripperdoc.name}
                  </Button>
                </div>
              )}
            </>
          )
        }
      />
    </div>
  );
}

/** 页内分栏：原作按钮素材，按下的那一栏 pressed */
function SubTabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  readonly tabs: readonly (readonly [T, ReactNode])[];
  readonly value: T;
  readonly onChange: (tab: T) => void;
}) {
  return (
    <nav className={neural.sub}>
      {tabs.map(([id, label]) => (
        <Button key={id} small pressed={id === value} onClick={() => onChange(id)}>
          {label}
        </Button>
      ))}
    </nav>
  );
}

type InventoryFilter = "all" | "usable" | "weapon" | "clothing" | "mod" | "misc";
type ItemDetailsMap = NonNullable<View["inventory"]["details"]>;
type ItemDetail = ItemDetailsMap[string];

function unsupportedSlotReason(subLabel: string, slot: inventoryRules.ModSlot): string {
  const slotLabel = inventoryRules.MOD_SLOT_LABELS[slot];
  if (subLabel.includes("刀剑") || subLabel.includes("钝器")) {
    return `近战武器没有${slotLabel}槽位`;
  }
  if (subLabel.includes("技术") && slot === "muzzle") {
    return "技术电磁武器不支持机械消音器";
  }
  if (subLabel.includes("智能")) {
    return slot === "muzzle" ? "智能制导武器不支持机械消音器" : "智能武器无传统光学瞄具导轨";
  }
  return `当前枪型未开放${slotLabel}槽位`;
}

/** 武器中心化槽位检视器：逐槽展示已装配件、可装背包配件与不支持原因 */
function WeaponSlotInspector({
  weaponId,
  detail,
  installedList,
  allCarried,
  details,
  modTargets,
  shopModMeta,
  itemName,
  onMod,
  openSlot,
  onToggleSlot,
}: {
  readonly weaponId: string;
  readonly detail: ItemDetail;
  readonly installedList: View["inventory"]["mods"][string] | undefined;
  readonly allCarried: readonly (readonly [string, number])[];
  readonly details: View["inventory"]["details"];
  readonly modTargets: View["inventory"]["modTargets"];
  readonly shopModMeta: ReadonlyMap<
    string,
    {
      readonly rarity: string | null;
      readonly rarityLabel: string | null;
      readonly ability: string | null;
    }
  >;
  readonly itemName: (id: string) => string;
  readonly onMod?: ((action: "attach" | "detach", weapon: string, mod: string) => void) | undefined;
  readonly openSlot: inventoryRules.ModSlot | null;
  readonly onToggleSlot: (slot: inventoryRules.ModSlot | null) => void;
}) {
  const unsupportedSlots = inventoryRules.ModSlotSchema.options
    .filter((slot) => !detail.modSlots.includes(slot))
    .map((slot) => ({
      label: inventoryRules.MOD_SLOT_LABELS[slot],
      reason: unsupportedSlotReason(detail.subLabel, slot),
    }));

  return (
    <section className={styles.slotInspector} aria-label="武器改装槽位">
      <header className={styles.slotInspectorHead}>
        <span>改装槽位</span>
        <div className={styles.slotInspectorMeta}>
          {unsupportedSlots.length > 0 && (
            <span
              className={styles.slotInspectorNote}
              title={unsupportedSlots.map(({ label, reason }) => `${label}：${reason}`).join(" · ")}
            >
              未开放：{unsupportedSlots.map(({ label }) => label).join("、")}
            </span>
          )}
          {detail.weaponState?.smartLink && (
            <span className={styles.slotInspectorBadge}>智能联锁</span>
          )}
        </div>
      </header>
      <ul className={styles.slotList}>
        {inventoryRules.ModSlotSchema.options.map((slot) => {
          const slotLabel = inventoryRules.MOD_SLOT_LABELS[slot];
          const isAllowed = detail.modSlots.includes(slot);
          const installedEntry = installedList?.find((m) => m.slot === slot);
          const installedId = detail.weaponState?.mods[slot] ?? installedEntry?.id;
          const isLocked =
            detail.weaponState?.lockedSlots.includes(slot) ?? installedEntry?.locked ?? false;

          if (!isAllowed) return null;

          const compatibleMods = allCarried
            .filter(([modId]) => {
              if (modId === installedId) return false;
              const modDetail = details?.[modId];
              return (
                modDetail?.kind === "mod" &&
                modDetail.subLabel === `改装 · ${slotLabel}` &&
                (modTargets[modId] ?? []).includes(weaponId)
              );
            })
            .map(([modId, count]) => {
              const modDetail = details?.[modId];
              return {
                id: modId,
                count,
                name: itemName(modId),
                rarity: modDetail?.rarity ?? null,
                rarityLabel: modDetail?.rarityLabel ?? null,
                ability: modDetail?.ability ?? "",
                art: itemArtOf(modId),
              };
            });

          const pickerOpen = openSlot === slot;

          if (installedId) {
            const modDetail = details?.[installedId];
            const shopMeta = shopModMeta.get(installedId);
            const modRarity = modDetail?.rarity ?? shopMeta?.rarity ?? null;
            const modRarityLabel =
              modDetail?.rarityLabel ?? shopMeta?.rarityLabel ?? rarityLabelOf(modRarity);
            const modAbility = modDetail?.ability || shopMeta?.ability || "";
            const modArt = itemArtOf(installedId);
            const modName = itemName(installedId);

            return (
              <li
                key={slot}
                className={styles.slotCard}
                data-state="occupied"
                data-locked={isLocked || undefined}
                data-rarity={modRarity ?? undefined}
                style={{ "--slot-rar": rarityTintOf(modRarity) } as CSSProperties}
              >
                <span className={styles.slotRarBar} aria-hidden />
                <div className={styles.slotTop}>
                  <strong className={styles.slotLabel}>{slotLabel}</strong>
                  <div className={styles.slotStatusGroup}>
                    {modRarityLabel && <span className={styles.slotRarText}>{modRarityLabel}</span>}
                    {isLocked && <span className={styles.slotLockTag}>已固锁</span>}
                  </div>
                </div>
                <div className={styles.slotBody}>
                  {modArt && (
                    <span className={styles.slotThumb} aria-hidden>
                      <Asset id={modArt} className={styles.slotArt} />
                    </span>
                  )}
                  <div className={styles.slotCopy}>
                    <b className={styles.slotModName}>{modName}</b>
                    {modAbility && <p className={styles.slotAbility}>{modAbility}</p>}
                  </div>
                </div>
                {isLocked ? (
                  <p className={styles.slotLockNote}>已锁定 · 需前往枪匠工坊改动</p>
                ) : (
                  onMod && (
                    <div className={styles.slotActions}>
                      <ActionButton
                        onClick={() => {
                          onToggleSlot(null);
                          onMod("detach", weaponId, installedId);
                        }}
                      >
                        拆下
                      </ActionButton>
                      {compatibleMods.length > 0 && (
                        <ActionButton onClick={() => onToggleSlot(pickerOpen ? null : slot)}>
                          {pickerOpen ? "收起" : `更换 (${compatibleMods.length})`}
                        </ActionButton>
                      )}
                    </div>
                  )
                )}
                {pickerOpen && !isLocked && compatibleMods.length > 0 && (
                  <ul className={styles.slotPicker} aria-label={`更换${slotLabel}配件`}>
                    {compatibleMods.map((mod) => (
                      <li
                        key={mod.id}
                        className={styles.slotPickItem}
                        style={{ "--slot-rar": rarityTintOf(mod.rarity) } as CSSProperties}
                      >
                        <span className={styles.slotPickBar} aria-hidden />
                        {mod.art && <Asset id={mod.art} className={styles.slotPickArt} />}
                        <div className={styles.slotPickCopy}>
                          <b>
                            {mod.name}
                            {mod.count > 1 ? ` ×${mod.count}` : ""}
                          </b>
                          {mod.ability && <small>{mod.ability}</small>}
                        </div>
                        {onMod && (
                          <ActionButton
                            onClick={() => {
                              onToggleSlot(null);
                              onMod("attach", weaponId, mod.id);
                            }}
                          >
                            换上
                          </ActionButton>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          }

          return (
            <li key={slot} className={styles.slotCard} data-state="empty">
              <div className={styles.slotTop}>
                <strong className={styles.slotLabel}>{slotLabel}</strong>
                <span className={styles.slotStatusTag}>空余</span>
              </div>
              {isLocked ? (
                <p className={styles.slotLockNote}>已锁定 · 需前往枪匠工坊改动</p>
              ) : compatibleMods.length === 0 ? (
                <p className={styles.slotEmptyNote}>背包暂无可用{slotLabel}配件</p>
              ) : (
                <>
                  <div className={styles.slotActions}>
                    <ActionButton onClick={() => onToggleSlot(pickerOpen ? null : slot)}>
                      {pickerOpen ? "收起配件" : `加装${slotLabel} (${compatibleMods.length})`}
                    </ActionButton>
                    {!onMod && <small className={styles.slotMutedNote}>当前不可拆装</small>}
                  </div>
                  {pickerOpen && (
                    <ul className={styles.slotPicker} aria-label={`加装${slotLabel}配件`}>
                      {compatibleMods.map((mod) => (
                        <li
                          key={mod.id}
                          className={styles.slotPickItem}
                          style={{ "--slot-rar": rarityTintOf(mod.rarity) } as CSSProperties}
                        >
                          <span className={styles.slotPickBar} aria-hidden />
                          {mod.art && <Asset id={mod.art} className={styles.slotPickArt} />}
                          <div className={styles.slotPickCopy}>
                            <b>
                              {mod.name}
                              {mod.count > 1 ? ` ×${mod.count}` : ""}
                            </b>
                            {mod.ability && <small>{mod.ability}</small>}
                          </div>
                          {onMod && (
                            <ActionButton
                              onClick={() => {
                                onToggleSlot(null);
                                onMod("attach", weaponId, mod.id);
                              }}
                            >
                              装上
                            </ActionButton>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * 物品栏（O）：上方展示随身大件负担与当前穿着，中间单行筛选与左列表右详情浏览。
 */
export function InventoryPage({
  view,
  onEquip,
  onUnequip,
  onMod,
  onBuyHome,
  onHeal,
  onSuppressant,
  onUse,
  onPlaceItem,
  disabledReason,
}: {
  readonly view: View;
  /** 非战斗治疗和压制剂直接结算；情境性使用交给行动输入，由玩家确认。 */
  readonly onHeal?: ((id: string) => Promise<void>) | undefined;
  readonly onSuppressant?: (() => Promise<void>) | undefined;
  readonly onUse?: ((id: string) => void) | undefined;
  /** 在当前地点的自有住所或车辆中，每次存入或取回一件物品。 */
  readonly onPlaceItem?: PlaceInventoryItem | undefined;
  readonly disabledReason?: string | undefined;
  /** 换服装或快捷药剂/手雷；正在生成时不传，按钮不显示 */
  readonly onEquip?: ((id: string) => void) | undefined;
  readonly onUnequip?: ((id: string) => void) | undefined;
  /** 改装件：attach 从背包装到武器上，detach 拆下放回背包 */
  readonly onMod?: ((action: "attach" | "detach", weapon: string, mod: string) => void) | undefined;
  /** 买下当前地点的一处公寓；正在生成时不传，按钮不显示 */
  readonly onBuyHome?: ((id: string) => void) | undefined;
}) {
  const { inventory } = view;
  const quickItems = [inventory.healing, inventory.grenade].flatMap((item) => (item ? [item] : []));
  const carried = { ...inventory.backpack };
  for (const item of quickItems) carried[item.id] = (carried[item.id] ?? 0) + 1;

  const [filter, setFilter] = useState<InventoryFilter>("all");
  const [inventoryTab, setInventoryTab] = useState<"carried" | "stored">("carried");
  const [storageKey, setStorageKey] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [pickedItem, setPickedItem] = useState<{ id: string; worn?: boolean } | null>(null);
  const [openSlotPicker, setOpenSlotPicker] = useState<{
    weaponId: string;
    slot: inventoryRules.ModSlot;
  } | null>(null);
  const [usingItem, setUsingItem] = useState(false);
  const actionPending = useRef(false);
  const [useError, setUseError] = useState("");

  const isUsable = (id: string) => {
    const kind = inventory.details?.[id]?.kind;
    return (
      quickItems.some((item) => item.id === id) ||
      kind === "healing" ||
      kind === "grenade" ||
      kind === "consumable"
    );
  };

  const itemName = (id: string) =>
    displayItemName(view.names.items, id, inventory.details?.[id]?.baseId);
  const allCarried = Object.entries(carried).filter(([, count]) => count > 0);
  const shopModMeta = new Map<
    string,
    {
      readonly rarity: string | null;
      readonly rarityLabel: string | null;
      readonly ability: string | null;
    }
  >();
  for (const shop of view.shops) {
    for (const s of shop.shelf) {
      if (s.kind === "mod") {
        shopModMeta.set(s.id, { rarity: s.rarity, rarityLabel: s.rarityLabel, ability: s.ability });
      }
    }
    for (const w of shop.gunsmith?.weapons ?? []) {
      for (const slot of w.slots) {
        if (slot.installed) {
          shopModMeta.set(slot.installed.id, {
            rarity: slot.installed.rarity,
            rarityLabel: slot.installed.rarityLabel,
            ability: slot.installed.ability,
          });
        }
        for (const opt of slot.options) {
          shopModMeta.set(opt.id, {
            rarity: opt.rarity,
            rarityLabel: opt.rarityLabel,
            ability: opt.ability,
          });
        }
      }
    }
  }
  const backpack = allCarried.filter(([id]) => {
    const kind = inventory.details?.[id]?.kind;
    const matches = filter === "all" || (filter === "usable" ? isUsable(id) : kind === filter);
    return matches && itemName(id).toLocaleLowerCase().includes(search.trim().toLocaleLowerCase());
  });
  const wornMatch = pickedItem?.worn
    ? inventory.clothing.find((c) => c.id === pickedItem.id)
    : undefined;
  const packMatch =
    !wornMatch && !pickedItem?.worn && pickedItem?.id
      ? (backpack.find(([id]) => id === pickedItem.id) ??
        backpack.find(
          ([id]) =>
            inventory.details?.[id]?.baseId ===
            (inventory.details?.[pickedItem.id]?.baseId ?? baseWeaponIdOf(pickedItem.id)),
        ))
      : undefined;
  const selectedEntry = wornMatch
    ? ([wornMatch.id, 1] as const)
    : (packMatch ?? backpack[0] ?? null);
  const selectedId = selectedEntry?.[0] ?? null;
  const selectedIsWorn = Boolean(wornMatch);

  const selectItem = (id: string, worn = false) => {
    setPickedItem({ id, worn });
    setOpenSlotPicker(null);
    setUseError("");
  };

  const runDirectUse = async (task: () => Promise<void>) => {
    if (actionPending.current || disabledReason) return;
    actionPending.current = true;
    setUsingItem(true);
    setUseError("");
    try {
      await task();
    } catch (error) {
      setUseError(error instanceof Error ? error.message : "操作失败，请重试");
    } finally {
      actionPending.current = false;
      setUsingItem(false);
    }
  };

  const places = view.safehouse.forSale.length > 0;
  const load = inventory.loadout;
  const storage = view.safehouse.storage;
  const storeTargets = storage.filter((group) => group.canStore);
  const storeTarget = storeTargets.find((group) => group.key === storageKey) ?? storeTargets[0];
  const storeBlocked =
    disabledReason ||
    (usingItem
      ? "正在处理物品，请稍候"
      : view.combat.active
        ? "交战中存取物品需要在行动里描述"
        : view.health.condition !== "up"
          ? "当前无法自行存取物品"
          : !storeTarget
            ? "到自有住处或车辆所在地点后可存放"
            : !onPlaceItem
              ? "当前无法存放物品"
              : undefined);
  const navigation = (
    <SubTabs<"carried" | "stored">
      tabs={[
        ["carried", "随身"],
        ["stored", "存放"],
      ]}
      value={inventoryTab}
      onChange={(next) => {
        setInventoryTab(next);
        setUseError("");
      }}
    />
  );
  const feedback = (
    <>
      {disabledReason && (
        <p role="status" className={styles.inventoryNotice}>
          {disabledReason}
        </p>
      )}
      {useError && (
        <p role="alert" className={styles.warn}>
          {useError}
        </p>
      )}
    </>
  );

  if (inventoryTab === "stored") {
    return (
      <div className={styles.inventoryRoot}>
        {navigation}
        {feedback}
        <InventoryStorage
          groups={storage}
          selectedKey={storageKey}
          onSelect={(key) => {
            setStorageKey(key);
            setUseError("");
          }}
          busy={usingItem}
          disabledReason={disabledReason}
          onTake={
            onPlaceItem
              ? (id, where) => void runDirectUse(() => onPlaceItem("take", id, where))
              : undefined
          }
        />
      </div>
    );
  }

  return (
    <div className={styles.inventoryRoot}>
      {navigation}
      {feedback}
      {(inventory.clothing.length > 0 || load.carryUnits > 0) && (
        <section className={styles.loadoutSection} aria-label="随身行装">
          <header className={styles.loadoutBar}>
            <span className={styles.loadoutTitle}>随身行装</span>
            {load.carryUnits > 0 && (
              <span className={styles.loadoutMeta}>
                <span
                  className={styles.loadoutMeter}
                  data-over={load.carryLevel !== "light" || undefined}
                  title="携带分值综合重量、体积和取用负担，不是公斤；小武器 1、中短武器 2、大件武器 4。"
                >
                  <span>{load.carryLabel}</span>
                  <b className={styles.loadoutCount}>
                    {load.carryUnits}/{load.carryMax}
                  </b>
                </span>
              </span>
            )}
          </header>

          {inventory.clothing.length > 0 && (
            <div className={styles.clothingRow}>
              <span className={styles.clothingLabel}>当前着装</span>
              <ul className={styles.clothingStrip} aria-label="当前穿着">
                {inventory.clothing.map((c) => {
                  const art = itemArtOf(c.id);
                  const isSelected = selectedIsWorn && selectedId === c.id;
                  return (
                    <li
                      key={c.slot}
                      className={styles.clothingChip}
                      data-active={isSelected || undefined}
                    >
                      <CellFrame />
                      <button
                        type="button"
                        className={styles.clothingPick}
                        aria-pressed={isSelected}
                        onClick={() => selectItem(c.id, true)}
                      >
                        {art && (
                          <span className={styles.clothingThumb} aria-hidden>
                            <span
                              className={styles.clothingThumbGrid}
                              style={{ backgroundImage: cssUrl("fx.grid") }}
                            />
                            <Asset id={art} className={styles.clothingArt} />
                          </span>
                        )}
                        <span className={styles.clothingMeta}>
                          <small className={styles.dim}>{c.label}</small>
                          <b className={styles.clothingName}>{itemName(c.id)}</b>
                        </span>
                      </button>
                      {onUnequip && (
                        <ActionButton
                          disabled={usingItem || Boolean(disabledReason)}
                          onClick={() => onUnequip(c.id)}
                        >
                          脱下
                        </ActionButton>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </section>
      )}

      <section className={styles.packSection} aria-label="随身背包">
        <div className={styles.inventoryToolbar}>
          <SubTabs<InventoryFilter>
            tabs={[
              ["all", allCarried.length > 0 ? `全部 ${allCarried.length}` : "全部"],
              ["usable", "可使用"],
              ["weapon", "武器"],
              ["clothing", "服装"],
              ["mod", "改装件"],
              ["misc", "杂物"],
            ]}
            value={filter}
            onChange={(next) => {
              setFilter(next);
              setPickedItem(null);
              setUseError("");
            }}
          />
          <FrameBox className={styles.inventorySearchBox}>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索物品…"
              aria-label="搜索物品"
              className={styles.inventorySearch}
            />
          </FrameBox>
        </div>

        {backpack.length === 0 && !selectedIsWorn ? (
          <div className={styles.inventoryEmpty}>
            <CellFrame />
            {allCarried.length === 0 ? "随身背包是空的。" : "没有符合筛选条件的物品。"}
          </div>
        ) : (
          <div className={styles.inventoryBrowser}>
            {backpack.length === 0 ? (
              <div className={styles.inventoryEmpty}>
                <CellFrame />
                {allCarried.length === 0 ? "随身背包是空的。" : "没有符合筛选条件的物品。"}
              </div>
            ) : (
              <ul className={styles.inventoryGrid} aria-label="选择背包物品">
                {backpack.map(([id, count]) => {
                  const quick = quickItems.find((item) => item.id === id);
                  const detail = inventory.details?.[id];
                  const art = itemArtOf(detail?.baseId ?? id);
                  const rarity = detail?.rarity ?? inventory.rarity[id];
                  const isSelected = !selectedIsWorn && selectedId === id;
                  return (
                    <li key={id}>
                      <button
                        type="button"
                        className={styles.gridItem}
                        aria-pressed={isSelected}
                        data-rarity={rarity ?? undefined}
                        data-iconic={detail?.iconic || undefined}
                        onClick={() => selectItem(id)}
                      >
                        <NineSlice
                          id="map.filterCellBg"
                          tint="var(--item-fill, rgb(14 14 23 / 80%))"
                          slice={CELL_SLICE}
                        />
                        <NineSlice
                          id="map.filterCellFg"
                          tint="var(--item-line)"
                          slice={CELL_SLICE}
                        />
                        {rarity && (
                          <NineSlice
                            id="cyber.cellRarity"
                            tint="var(--rarity)"
                            slice={0}
                            className={styles.gridRarity}
                          />
                        )}
                        <span className={styles.gridThumb} aria-hidden>
                          {art ? (
                            <Asset id={art} className={styles.weaponArt} />
                          ) : (
                            <Asset id="notify.inventory" tint="var(--cp-cyan)" height={20} />
                          )}
                        </span>
                        <span className={styles.gridInfo}>
                          <strong className={styles.gridName}>{itemName(id)}</strong>
                          <small className={styles.gridSub}>
                            {detail?.subLabel ?? "物品"}
                            {detail?.rarityLabel ? ` · ${detail.rarityLabel}` : ""}
                          </small>
                        </span>
                        <span className={styles.gridMeta}>
                          {quick ? (
                            <UnreadBadge>{`${quick.charges}/${quick.max} 次`}</UnreadBadge>
                          ) : count > 1 ? (
                            <b className={styles.gridCount}>×{count}</b>
                          ) : null}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            {selectedEntry &&
              (() => {
                const [id, count] = selectedEntry;
                const to = selectedIsWorn ? undefined : inventory.equipTo[id];
                const detail = inventory.details?.[id];
                const art = itemArtOf(detail?.baseId ?? id);
                const rarity = detail?.rarity ?? inventory.rarity[id];
                const quick = selectedIsWorn ? undefined : quickItems.find((q) => q.id === id);
                const kind = detail?.kind;
                const modSlot =
                  kind === "mod"
                    ? inventoryRules.ModSlotSchema.options.find(
                        (s) => detail?.subLabel === `改装 · ${inventoryRules.MOD_SLOT_LABELS[s]}`,
                      )
                    : undefined;
                const usable =
                  !selectedIsWorn &&
                  (kind === "healing" || kind === "grenade" || kind === "consumable");
                const remaining = quick?.charges ?? detail?.remaining;
                const useSpare = Boolean(
                  quick &&
                    remaining === 0 &&
                    (kind === "healing"
                      ? inventory.quickSupplyAvailable.healing
                      : kind === "grenade"
                        ? inventory.quickSupplyAvailable.grenade
                        : false),
                );
                const ceiling =
                  view.health.wound === "severe"
                    ? Math.floor(view.health.max * 0.29)
                    : view.health.max;
                const directHeal = kind === "healing" && !view.combat.active;
                const directSuppressant = id === "psycho-suppressant" && !view.combat.active;
                const suppressantUntil = view.psychosis.suppressant.until;
                const useBlocked =
                  disabledReason ||
                  (usingItem
                    ? "正在使用物品…"
                    : view.health.condition !== "up"
                      ? "当前无法自行使用物品"
                      : (kind === "healing" || kind === "grenade") && remaining === 0 && !useSpare
                        ? "这份补给已耗尽，需要取得另一份补给"
                        : kind === "healing" && view.health.hp >= ceiling
                          ? "已达到当前治疗上限"
                          : directSuppressant && suppressantUntil
                            ? `压制剂仍在起效中（到 ${suppressantUntil}）`
                            : !quick &&
                                (kind === "grenade" ||
                                  (kind === "healing" && Boolean(view.combat.active)))
                              ? "先设为当前使用的物品"
                              : undefined);
                const directUseMissing = directHeal
                  ? !onHeal
                  : directSuppressant
                    ? !onSuppressant
                    : !onUse;
                const modTargets = selectedIsWorn ? [] : (inventory.modTargets[id] ?? []);

                return (
                  <article
                    key={id}
                    className={styles.inventoryDetail}
                    data-rarity={rarity ?? undefined}
                    data-iconic={detail?.iconic || undefined}
                    aria-label="选中物品详情"
                  >
                    <CellFrame />
                    <span
                      className={styles.detailGrid}
                      style={{ backgroundImage: cssUrl("fx.grid") }}
                      aria-hidden
                    />
                    {rarity && (
                      <NineSlice
                        id="cyber.cellRarity"
                        tint="var(--rarity)"
                        slice={0}
                        className={styles.detailRarity}
                      />
                    )}

                    <header className={styles.detailHead}>
                      <div className={styles.detailTitleRow}>
                        <strong className={styles.detailTitle}>{itemName(id)}</strong>
                        {count > 1 && <b className={styles.detailCount}>×{count}</b>}
                      </div>
                      <div className={styles.detailTags}>
                        {detail?.rarityLabel && (
                          <span className={styles.detailRarityTag}>
                            <NineSlice
                              id="cyber.gaugeLabel"
                              tint="var(--rarity, var(--cp-cyan))"
                              slice={4}
                            />
                            <span className={styles.pillText}>{detail.rarityLabel}</span>
                          </span>
                        )}
                        {detail?.subLabel && (
                          <span className={styles.detailTag}>
                            <NineSlice
                              id="cyber.gaugeLabel"
                              tint="rgb(94 246 255 / 16%)"
                              slice={4}
                            />
                            <span className={styles.pillText}>{detail.subLabel}</span>
                          </span>
                        )}
                        {detail?.bulky && (
                          <span className={styles.detailTag}>
                            <NineSlice
                              id="cyber.gaugeLabel"
                              tint="rgb(148 163 184 / 16%)"
                              slice={4}
                            />
                            <span className={styles.pillText}>大件装备</span>
                          </span>
                        )}
                        {kind === "weapon" && detail?.concealment && (
                          <span className={styles.detailTag}>
                            <NineSlice
                              id="cyber.gaugeLabel"
                              tint="rgb(94 246 255 / 12%)"
                              slice={4}
                            />
                            <span className={styles.pillText}>
                              {CONCEALMENT_LABELS[detail.concealment]}
                            </span>
                          </span>
                        )}
                        {kind === "weapon" &&
                          detail?.noise === "silent" &&
                          !detail.subLabel.includes("刀剑") &&
                          !detail.subLabel.includes("钝器") && (
                            <span className={styles.detailTag}>
                              <NineSlice
                                id="cyber.gaugeLabel"
                                tint="rgb(94 246 255 / 22%)"
                                slice={4}
                              />
                              <span className={styles.pillText}>{NOISE_LABELS[detail.noise]}</span>
                            </span>
                          )}
                        {kind === "weapon" && detail?.grantsSmartLink && (
                          <span className={styles.detailTag}>
                            <NineSlice
                              id="cyber.gaugeLabel"
                              tint="rgb(252 238 10 / 20%)"
                              slice={4}
                            />
                            <span className={styles.pillText}>智能联锁</span>
                          </span>
                        )}
                        {selectedIsWorn && (
                          <span className={styles.detailTagActive}>
                            <NineSlice id="cyber.gaugeLabel" tint="var(--cp-yellow)" slice={4} />
                            <span className={styles.pillText}>当前穿着</span>
                          </span>
                        )}
                        {kind === "weapon" && inventory.heldWeapons?.includes(id) && (
                          <span className={styles.detailTagActive}>
                            <NineSlice id="cyber.gaugeLabel" tint="var(--cp-yellow)" slice={4} />
                            <span className={styles.pillText}>当前持用</span>
                          </span>
                        )}
                        {quick ? (
                          <span className={styles.detailTagActive}>
                            <NineSlice id="cyber.gaugeLabel" tint="var(--cp-yellow)" slice={4} />
                            <span className={styles.pillText}>
                              快捷栏 · {quick.charges}/{quick.max} 次
                            </span>
                          </span>
                        ) : remaining !== null && remaining !== undefined && detail?.charges ? (
                          <span className={styles.detailTag}>
                            <NineSlice
                              id="cyber.gaugeLabel"
                              tint="rgb(94 246 255 / 16%)"
                              slice={4}
                            />
                            <span className={styles.pillText}>
                              剩余 {remaining}/{detail.charges} 次
                            </span>
                          </span>
                        ) : null}
                      </div>
                    </header>

                    {art && (
                      <div className={styles.detailShowcase} aria-hidden>
                        <CellFrame />
                        <span
                          className={styles.detailShowcaseGrid}
                          style={{ backgroundImage: cssUrl("fx.grid") }}
                        />
                        <Asset id={art} className={styles.detailArt} />
                      </div>
                    )}

                    {(detail?.ability || (kind === "healing" && detail?.healPercent)) && (
                      <div className={styles.detailBodyCopy}>
                        {detail?.ability && <p className={styles.detailDesc}>{detail.ability}</p>}

                        {kind === "healing" && detail?.healPercent && (
                          <p className={styles.detailStat}>
                            便携医疗急救 · 当前伤势：
                            {woundTelemetry(view.health, view.combat, view.cyberware).title}
                          </p>
                        )}
                      </div>
                    )}

                    {kind === "weapon" && detail && (
                      <WeaponSlotInspector
                        weaponId={id}
                        detail={detail}
                        installedList={inventory.mods[id]}
                        allCarried={allCarried}
                        details={inventory.details}
                        modTargets={inventory.modTargets}
                        shopModMeta={shopModMeta}
                        itemName={itemName}
                        onMod={usingItem ? undefined : onMod}
                        openSlot={openSlotPicker?.weaponId === id ? openSlotPicker.slot : null}
                        onToggleSlot={(slot) =>
                          setOpenSlotPicker(slot ? { weaponId: id, slot } : null)
                        }
                      />
                    )}

                    <div className={styles.detailActions}>
                      <div className={styles.detailActionGroup}>
                        {storeTargets.length > 1 && storeTarget && (
                          <label className={storageStyles.storagePicker}>
                            <span>存入</span>
                            <select
                              className={storageStyles.storageSelect}
                              value={storeTarget.key}
                              disabled={usingItem}
                              onChange={(event) => setStorageKey(event.target.value)}
                            >
                              {storeTargets.map((group) => (
                                <option key={group.key} value={group.key}>
                                  {group.name}
                                </option>
                              ))}
                            </select>
                          </label>
                        )}
                        <Button
                          small
                          disabled={Boolean(storeBlocked)}
                          reason={storeBlocked}
                          onClick={() => {
                            if (!storeBlocked && storeTarget && onPlaceItem) {
                              void runDirectUse(() =>
                                onPlaceItem(
                                  "leave",
                                  id,
                                  storeTarget.target,
                                  selectedIsWorn ? "worn" : quick ? "quick" : "backpack",
                                ),
                              );
                            }
                          }}
                        >
                          {usingItem ? "正在处理…" : count > 1 ? "存放 1 件" : "存放"}
                        </Button>
                        <small className={styles.detailHint}>
                          {storeBlocked ?? `存入${storeTarget?.name}，从随身物品移出。`}
                        </small>
                      </div>
                      {usable && (
                        <div className={styles.detailActionGroup}>
                          <Button
                            small
                            primary={!useBlocked}
                            disabled={Boolean(useBlocked) || directUseMissing}
                            onClick={() => {
                              if (useBlocked) return;
                              if (directHeal && onHeal) void runDirectUse(() => onHeal(id));
                              else if (directSuppressant && onSuppressant) {
                                void runDirectUse(onSuppressant);
                              } else onUse?.(id);
                            }}
                          >
                            {directHeal
                              ? "使用治疗品"
                              : directSuppressant
                                ? "注射压制剂"
                                : kind === "grenade"
                                  ? "准备投掷"
                                  : "准备使用"}
                          </Button>
                          {useBlocked ? (
                            <small className={styles.detailHint}>{useBlocked}</small>
                          ) : useSpare ? (
                            <small className={styles.detailHint}>
                              将取用随身携带的同款备用补给。
                            </small>
                          ) : (
                            !directHeal &&
                            !directSuppressant && (
                              <small className={styles.detailHint}>填入行动框，确认后执行。</small>
                            )
                          )}
                        </div>
                      )}

                      {to === "quick" && !quick && (
                        <div className={styles.detailActionGroup}>
                          <Button
                            small
                            disabled={
                              !onEquip ||
                              Boolean(disabledReason) ||
                              usingItem ||
                              Boolean(view.combat.active)
                            }
                            onClick={() => onEquip?.(id)}
                          >
                            {kind === "healing" ? "设为当前治疗品" : "设为当前手雷"}
                          </Button>
                          {view.combat.active && (
                            <small className={styles.detailHint}>
                              战斗中更换物品需要在行动中进行。
                            </small>
                          )}
                        </div>
                      )}

                      {selectedIsWorn && onUnequip && (
                        <Button
                          small
                          disabled={usingItem || Boolean(disabledReason)}
                          onClick={() => onUnequip(id)}
                        >
                          脱下
                        </Button>
                      )}

                      {to === "clothing" && onEquip && (
                        <Button
                          small
                          primary
                          disabled={usingItem || Boolean(disabledReason)}
                          onClick={() => onEquip(id)}
                        >
                          穿上
                        </Button>
                      )}

                      {onMod && modTargets.length > 0 && (
                        <div className={styles.modTargetList}>
                          {modTargets.map((w) => {
                            const existingId = modSlot
                              ? inventory.details?.[w]?.weaponState?.mods[modSlot]
                              : undefined;
                            const alreadyFitted = existingId === id;
                            const label = alreadyFitted
                              ? `已在 ${itemName(w)} 上`
                              : existingId
                                ? `替换 ${itemName(w)} 的${itemName(existingId)}`
                                : `装到 ${itemName(w)}`;
                            return (
                              <ActionButton
                                key={w}
                                disabled={alreadyFitted}
                                onClick={() => onMod("attach", w, id)}
                              >
                                {label}
                              </ActionButton>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </article>
                );
              })()}
          </div>
        )}
      </section>

      {places && (
        <section className={styles.placesBar} aria-label="当前地点服务">
          <CellFrame />
          <span className={styles.placesLabel}>当前地点</span>
          <div className={styles.placesActions}>
            {view.safehouse.forSale.map((home) => (
              <div className={styles.docLink} key={home.id}>
                <small className={styles.dim}>{home.locked ?? home.note}</small>
                {onBuyHome && !home.locked && (
                  <Button
                    small
                    disabled={home.price > view.money.eddies}
                    onClick={() => onBuyHome(home.id)}
                  >
                    买下{home.name}（{home.price.toLocaleString("en-US")} 欧元）
                  </Button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// 物品栏精简（用户定的方案 A）：制作页（拆解、升级）去掉；后台的 craft 动作和零件规则留着，以后想加回来再接界面

/** 追踪（J）：只列眼下揽在手里的单子与期限约定；日常超梦不自动生成待办。 */
export function JournalPage({ view }: { readonly view: View }) {
  const track = trackTelemetry(view);
  const placeNames = new Map((view.travel?.destinations ?? []).map((d) => [d.id, d.name]));
  const activeJobs = [...view.jobs.list.filter((j) => j.status === "active")].sort((a, b) => {
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    if (a.dueIn !== null && b.dueIn !== null) return a.dueIn - b.dueIn;
    if (a.dueIn !== null) return -1;
    if (b.dueIn !== null) return 1;
    return 0;
  });
  const otherActive = track.active.filter((item) => item.source !== "jobs");
  const nothingActive = activeJobs.length === 0 && otherActive.length === 0;

  return (
    <div className={styles.trackPane}>
      {nothingActive && (
        <p className={styles.trackQuietNote}>
          手头眼下没有在办单子或约定；街头走动、回消息时谈妥的事会记到这里。
        </p>
      )}

      {activeJobs.length > 0 && (
        <section className={styles.trackSection}>
          <h3 className={styles.trackMicroHead}>手头在办</h3>
          <div className={styles.trackCleanList}>
            {activeJobs.map((job) => {
              const place =
                job.location === null ? null : (placeNames.get(job.location) ?? job.location);
              const metaTag = job.overdue
                ? "已超期"
                : job.dueIn !== null
                  ? countdown(job.dueIn)
                  : (job.kindLabel ?? (job.fixer ? `${job.fixer} 递话` : job.client));
              const detailsLine = [
                job.kindLabel,
                place,
                `委托方 ${job.client}`,
                job.fixer ? `牵线 ${job.fixer}` : null,
                job.reward > 0 ? `谈妥 ${job.reward.toLocaleString("en-US")} 欧元` : null,
              ]
                .filter(Boolean)
                .join(" · ");

              return (
                <details
                  key={job.id}
                  className={styles.trackGigItem}
                  data-overdue={job.overdue || undefined}
                >
                  <summary>
                    <strong>{job.title}</strong>
                    <span className={styles.trackGigMeta}>{metaTag}</span>
                  </summary>
                  <div className={styles.trackGigDetail}>
                    {detailsLine && <p>{detailsLine}</p>}
                    {job.due !== null && (
                      <p>
                        期限：{job.due}
                        {job.dueIn !== null ? ` · ${countdown(job.dueIn)}` : ""}
                      </p>
                    )}
                    {job.notes.length > 0 && (
                      <ol className={styles.trackNotes}>
                        {job.notes.map((note, i) => (
                          // biome-ignore lint/suspicious/noArrayIndexKey: 进展笔记按序追加
                          <li key={i}>{note}</li>
                        ))}
                      </ol>
                    )}
                  </div>
                </details>
              );
            })}
          </div>
        </section>
      )}

      {otherActive.length > 0 && (
        <section className={styles.trackSection}>
          <h3 className={styles.trackMicroHead}>
            {activeJobs.length > 0 ? "约定与进行中" : "正在进行"}
          </h3>
          <ul className={styles.trackCleanList}>
            {otherActive.map((item) => (
              <li
                key={item.id}
                className={styles.trackCleanRow}
                data-kind={item.kind}
                data-overdue={item.status === "overdue" || undefined}
              >
                <div className={styles.trackCleanTop}>
                  <strong>{item.title}</strong>
                  {item.dueLabel && (
                    <time
                      className={styles.trackCleanTime}
                      data-overdue={item.status === "overdue" || undefined}
                    >
                      {item.dueIn !== null && item.status !== "overdue"
                        ? `${item.dueLabel} · ${countdown(item.dueIn)}`
                        : item.dueLabel}
                    </time>
                  )}
                </div>
                <div className={styles.trackCleanMeta}>
                  <span>{item.sourceLabel}</span>
                  {item.location && !item.progress?.includes(item.location) && (
                    <span>{item.location}</span>
                  )}
                  {item.progress && <span>{item.progress}</span>}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

type MessagesTab = "dm" | "news";

/** 消息（T）：私信和新闻；四个频道的完整版在 U4 */
export function MessagesPage({
  view,
  onReply,
  onMessageNpc,
  onSendChat,
  onReadThread,
  onReadCall,
  chatSending,
  pendingChat,
  busy,
  onLocatePlace,
  onOpenRipperdoc,
  onNews,
  initialTab = "dm",
  hideTabs = false,
}: {
  readonly view: View;
  /** 切到新闻栏：把新闻记成已读 */
  readonly onNews: () => void;
  readonly initialTab?: MessagesTab;
  /** 外面已经有页签（钉住的未读块）时不再出页内分栏 */
  readonly hideTabs?: boolean;
} & PhoneActions) {
  const [tab, setTab] = useState<MessagesTab>(initialTab);
  const actions: PhoneActions = {
    onReply,
    onMessageNpc,
    onSendChat,
    onReadThread,
    onReadCall,
    chatSending,
    pendingChat,
    busy,
    onLocatePlace,
    onOpenRipperdoc,
  };
  return (
    <>
      {!hideTabs && (
        <SubTabs<MessagesTab>
          tabs={[
            ["dm", view.phone.unread > 0 ? `私信 ${view.phone.unread}` : "私信"],
            ["news", "新闻"],
          ]}
          value={tab}
          onChange={(t) => {
            setTab(t);
            if (t === "news") onNews();
          }}
        />
      )}
      {hideTabs ? (
        tab === "dm" ? (
          <PhoneBody view={view} {...actions} />
        ) : (
          <NewsBody view={view} />
        )
      ) : (
        <Panel as="section" title={tab === "dm" ? "私信" : "新闻"} line="var(--cp-cyan)" frame>
          {tab === "dm" ? <PhoneBody view={view} {...actions} /> : <NewsBody view={view} />}
        </Panel>
      )}
    </>
  );
}

type ContactsTab = "people" | "squad" | "factions";

/** 联系人：人物档案（含宿敌）、小队、势力 */
export function ContactsPage({
  view,
  onSquad,
}: {
  readonly view: View;
  /** 小队的动作；正在生成时不传，按钮不显示 */
  readonly onSquad?: ((action: SquadAction, npc: string) => void) | undefined;
}) {
  const [tab, setTab] = useState<ContactsTab>("people");
  const people = view.npcs.filter((n) => n.met || n.nemesis || n.known.length > 0);
  const [picked, setPicked] = useState<string | null>(null);
  const current = people.find((n) => n.id === picked) ?? people[0];

  return (
    <>
      <SubTabs<ContactsTab>
        tabs={[
          ["people", "人物"],
          ["squad", `小队 ${view.squad.members.length}/${view.squad.max}`],
          ["factions", "势力"],
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === "people" &&
        (people.length === 0 || !current ? (
          <p className={styles.dim}>还没有认识的人。</p>
        ) : (
          <div className={neural.split}>
            <Panel as="section" title="人物" line="var(--cp-cyan)">
              <ul className={styles.contactList} aria-label="人物">
                {people.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      className={styles.contact}
                      aria-pressed={n.id === current.id}
                      onClick={() => setPicked(n.id)}
                    >
                      <Avatar npc={n.id} name={n.name} dead={!n.alive} />
                      <span className={styles.contactName}>
                        <b>{n.name}</b>
                        <small className={styles.dim}>
                          {!n.alive
                            ? "已故"
                            : n.met
                              ? `${n.role} · 好感 ${n.affinity > 0 ? "+" : ""}${n.affinity}`
                              : n.nemesis
                                ? "交过手"
                                : "只听说过"}
                        </small>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </Panel>
            <Profile npc={current} fixer={view.jobs.fixers.find((f) => f.id === current.id)} />
          </div>
        ))}
      {tab === "squad" && <SquadPanel squad={view.squad} onSquad={onSquad} />}
      {tab === "factions" && (
        <Panel as="section" title="势力" line="var(--cp-yellow)">
          <FactionsBody view={view} />
        </Panel>
      )}
    </>
  );
}

/** 已读资料档案：界面打开只标记已浏览，不替角色读取尚未接触的芯片。 */
export function ShardsPanel({
  view,
  onReadShard,
}: {
  readonly view: View;
  /** 打开已归档原文：仅标记界面已浏览 */
  readonly onReadShard: (id: number) => void;
}) {
  const [tab, setTab] = useState<"chips" | "braindance">("chips");
  const viewedPassages = view.braindance.works.reduce((sum, work) => sum + work.passages.length, 0);
  return (
    <div className={mediaStyles.archive}>
      <nav className={mediaStyles.tabs} aria-label="已读内容">
        <Button small pressed={tab === "chips"} onClick={() => setTab("chips")}>
          芯片原文 · {view.shards.list.length}
        </Button>
        <Button small pressed={tab === "braindance"} onClick={() => setTab("braindance")}>
          超梦回看 · {viewedPassages}
        </Button>
      </nav>
      {tab === "chips" ? (
        <ChipArchive view={view} onReadShard={onReadShard} />
      ) : (
        <BraindanceArchive view={view} />
      )}
    </div>
  );
}

/** 翻看已读原文不调用模型、不推进时间，也不读取尚未接触的载体。 */
function ChipArchive({
  view,
  onReadShard,
}: {
  readonly view: View;
  readonly onReadShard: (id: number) => void;
}) {
  const shards = view.shards.list;
  const [picked, setPicked] = useState<number | null>(null);
  const [page, setPage] = useState(0);
  const pageSize = 40;
  const pageCount = Math.max(1, Math.ceil(shards.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const visible = shards.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  const current = shards.find((s) => s.id === picked) ?? null;

  const open = (id: number, read: boolean) => {
    setPicked(id);
    if (!read) onReadShard(id);
  };

  if (shards.length === 0) {
    return (
      <div className={styles.phoneEmpty}>
        <p className={styles.dim}>还没有实际读过的资料。拿到芯片后，可以在正文中用可用设备读取。</p>
      </div>
    );
  }

  return (
    <div className={styles.dbSplit}>
      <ul className={`${styles.contactList} ${styles.dbList}`} aria-label="芯片">
        {visible.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              className={styles.contact}
              aria-pressed={s.id === current?.id}
              onClick={() => open(s.id, s.read)}
            >
              <span className={styles.contactName}>
                <b>{s.title}</b>
                <small className={styles.dim}>
                  {s.kindLabel} · {s.at}
                </small>
              </span>
              {!s.read && <UnreadBadge>新</UnreadBadge>}
            </button>
          </li>
        ))}
        {pageCount > 1 && (
          <li>
            <nav aria-label="资料分页">
              <button
                type="button"
                disabled={currentPage === 0}
                onClick={() => setPage(currentPage - 1)}
              >
                上一页
              </button>
              <span className={styles.dim}>
                {" "}
                {currentPage + 1} / {pageCount} · 共 {shards.length} 段原文{" "}
              </span>
              <button
                type="button"
                disabled={currentPage + 1 === pageCount}
                onClick={() => setPage(currentPage + 1)}
              >
                下一页
              </button>
            </nav>
          </li>
        )}
      </ul>
      <article className={styles.dbReader}>
        {current ? (
          <>
            <h3 className={styles.dbReaderTitle}>{current.title}</h3>
            <p className={styles.dim}>
              {current.kindLabel}
              {current.from && ` · ${current.from}`} · {current.at}
            </p>
            <p className={styles.dim}>
              {current.contentId} · {current.partId}
              {current.carrier && ` · 来源载体 ${current.carrier}`}
            </p>
            <p className={styles.factionReason}>
              <InlineContentText text={current.text} />
            </p>
            <ContentMediaList media={current.media ?? []} />
          </>
        ) : (
          <p className={styles.dim}>从左侧选择一张芯片阅读原文。</p>
        )}
      </article>
    </div>
  );
}

/** 回看界面仅展示服务端已投影的定稿片段，浏览器播放附件不构成游戏内再次观看。 */
function BraindanceArchive({ view }: { readonly view: View }) {
  const passages = view.braindance.works.flatMap((work) =>
    work.passages.map((passage) => ({
      ...passage,
      key: `${work.id}/${passage.id}`,
      title: work.title,
      recorder: work.recorder,
    })),
  );
  const [picked, setPicked] = useState<string | null>(null);
  const current = passages.find((passage) => passage.key === picked) ?? passages[0];
  if (!current) {
    return (
      <div className={styles.phoneEmpty}>
        <p className={styles.dim}>还没有已呈现的超梦片段。实际体验后的定稿原文和媒体会留在这里。</p>
      </div>
    );
  }
  return (
    <div className={styles.dbSplit}>
      <ul className={`${styles.contactList} ${styles.dbList}`} aria-label="已呈现超梦片段">
        {passages.map((passage) => (
          <li key={passage.key}>
            <button
              type="button"
              className={styles.contact}
              aria-pressed={passage.key === current.key}
              onClick={() => setPicked(passage.key)}
            >
              <span className={styles.contactName}>
                <b>{passage.title}</b>
                <small className={styles.dim}>{passage.label ?? passage.id}</small>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <article className={styles.dbReader} key={current.key}>
        <h3 className={styles.dbReaderTitle}>{current.title}</h3>
        <p className={styles.dim}>
          {current.label ?? current.id} · 录制者：{current.recorder}
        </p>
        <p className={styles.factionReason}>
          <InlineContentText text={current.text} />
        </p>
        <ContentMediaList media={current.media ?? []} />
      </article>
    </div>
  );
}
