import { characterRules, inventoryRules } from "@cp/core";
import { type CSSProperties, type ReactNode, useState } from "react";
import { ActionButton } from "../../ui/ActionButton";
import { Asset, cssUrl, NineSlice } from "../../ui/Asset";
import { Button } from "../../ui/Button";
import { CellFrame, FrameBox } from "../../ui/FrameBox";
import { Panel } from "../../ui/Panel";
import { GeneratedImage } from "../images/GeneratedImage";
import { useSaveImages } from "../images/SaveImagesContext";
import { baseWeaponIdOf, itemArtOf } from "./art";
import { BiomonitorPanel } from "./BiomonitorPanel";
import { CYBER_LABELS, CyberDoll, type CyberSlot } from "./CyberDoll";
import { rarityLabelOf, rarityTintOf } from "./cyberwareMeta";
import { FactionsBody } from "./FactionsPanel";
import { type HabitAction, Habits } from "./Habits";
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
}: {
  readonly view: View;
  readonly onHabit?: ((action: HabitAction, text: string) => void) | undefined;
}) {
  const { character } = view;
  const saveImages = useSaveImages();
  const portraitId = saveImages?.bindings.playerPortrait ?? character.portrait ?? null;
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
      {character.name !== null && (portraitId || saveImages) && (
        <div className={styles.playerPortraitStrip}>
          {portraitId && (
            <button
              type="button"
              className={styles.playerPortraitThumb}
              title="点击查看大图"
              onClick={() =>
                saveImages?.openLightbox(portraitId, `${character.name ?? "主角"} · 人物立绘`)
              }
            >
              <CellFrame />
              <GeneratedImage
                imageId={portraitId}
                alt={`${character.name}立绘`}
                className={styles.playerPortraitImg}
              />
            </button>
          )}
          <div className={styles.playerPortraitInfo}>
            <strong>{character.name}</strong>
            <span className={styles.dim}>{character.credTier} · 夜之城佣兵</span>
            {saveImages && (
              <div className={styles.playerPortraitActions}>
                <Button
                  small
                  onClick={() =>
                    saveImages.openImageModal({
                      title: "AI 生成主角立绘",
                      ...(character.name ? { subtitle: character.name } : {}),
                      defaultAspectRatio: "3:4",
                      bind: { kind: "character" },
                      promptRequest: {
                        kind: "character",
                        name: character.name ?? "Merc",
                        alias: "",
                        pronoun: "TA",
                        origin: origins[0]?.label ?? "",
                        look: character.brief.slice(0, 480),
                        personality: "",
                        skills: modules.map((m) => m.label).join("、"),
                        cyberware: view.cyberware.map((c) => c.name),
                        gear: view.inventory.carriedWeapons
                          .map((w) => displayItemName(view.names.items, w.id))
                          .slice(0, 6),
                        instruction: "",
                      },
                    })
                  }
                >
                  {portraitId ? "AI 重绘立绘" : "AI 生成立绘"}
                </Button>
                {saveImages.bindings.playerPortrait && (
                  <Button small onClick={() => void saveImages.unbindImage({ kind: "character" })}>
                    恢复建档立绘
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
      <BiomonitorPanel view={view} />

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
  return (
    <section className={styles.slotInspector} aria-label="武器改装槽位">
      <header className={styles.slotInspectorHead}>
        <span>改装槽位</span>
        {detail.weaponState?.smartLink && (
          <span className={styles.slotInspectorBadge}>智能联锁</span>
        )}
      </header>
      <ul className={styles.slotList}>
        {inventoryRules.ModSlotSchema.options.map((slot) => {
          const slotLabel = inventoryRules.MOD_SLOT_LABELS[slot];
          const isAllowed = detail.modSlots.includes(slot);
          const installedEntry = installedList?.find((m) => m.slot === slot);
          const installedId = detail.weaponState?.mods[slot] ?? installedEntry?.id;
          const isLocked =
            detail.weaponState?.lockedSlots.includes(slot) ?? installedEntry?.locked ?? false;

          if (!isAllowed) {
            return (
              <li key={slot} className={styles.slotCard} data-state="unsupported">
                <div className={styles.slotTop}>
                  <strong className={styles.slotLabel}>{slotLabel}</strong>
                  <span className={styles.slotStatusTag}>不支持</span>
                </div>
                <p className={styles.slotMutedNote}>
                  {unsupportedSlotReason(detail.subLabel, slot)}
                </p>
              </li>
            );
          }

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
  onShop,
  onBuyHome,
  onHeal,
  onSuppressant,
  onUse,
  disabledReason,
}: {
  readonly view: View;
  /** 非战斗治疗和压制剂直接结算；情境性使用交给行动输入，由玩家确认。 */
  readonly onHeal?: ((id: string) => Promise<void>) | undefined;
  readonly onSuppressant?: (() => Promise<void>) | undefined;
  readonly onUse?: ((id: string) => void) | undefined;
  readonly disabledReason?: string | undefined;
  /** 换服装或快捷药剂/手雷；正在生成时不传，按钮不显示 */
  readonly onEquip?: ((id: string) => void) | undefined;
  readonly onUnequip?: ((id: string) => void) | undefined;
  /** 改装件：attach 从背包装到武器上，detach 拆下放回背包 */
  readonly onMod?: ((action: "attach" | "detach", weapon: string, mod: string) => void) | undefined;
  readonly onShop: (id: string) => void;
  /** 买下当前地点的一处公寓；正在生成时不传，按钮不显示 */
  readonly onBuyHome?: ((id: string) => void) | undefined;
}) {
  const { inventory } = view;
  const quickItems = [inventory.healing, inventory.grenade].flatMap((item) => (item ? [item] : []));
  const carried = { ...inventory.backpack };
  for (const item of quickItems) carried[item.id] = (carried[item.id] ?? 0) + 1;

  const [filter, setFilter] = useState<InventoryFilter>("all");
  const [search, setSearch] = useState("");
  const [pickedItem, setPickedItem] = useState<{ id: string; worn?: boolean } | null>(null);
  const [openSlotPicker, setOpenSlotPicker] = useState<{
    weaponId: string;
    slot: inventoryRules.ModSlot;
  } | null>(null);
  const [usingItem, setUsingItem] = useState(false);
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
            inventory.details?.[id]?.kind === "weapon" &&
            inventory.details?.[id]?.baseId === baseWeaponIdOf(pickedItem.id),
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
    if (usingItem || disabledReason) return;
    setUsingItem(true);
    setUseError("");
    try {
      await task();
    } catch (error) {
      setUseError(error instanceof Error ? error.message : "使用失败，请重试");
    } finally {
      setUsingItem(false);
    }
  };

  const places = view.shops.length > 0 || view.safehouse.forSale.length > 0;
  const { bulky } = inventory;

  return (
    <div className={styles.inventoryRoot}>
      {(inventory.clothing.length > 0 || bulky.count > 0 || bulky.overloaded) && (
        <section className={styles.loadoutSection} aria-label="随身行装">
          <header className={styles.loadoutBar}>
            <span className={styles.loadoutTitle}>随身行装</span>
            {(bulky.count > 0 || bulky.overloaded) && (
              <span className={styles.loadoutMeta}>
                <span className={styles.loadoutMeter} data-over={bulky.overloaded || undefined}>
                  <span>随身大件</span>
                  <b className={styles.loadoutCount}>
                    {bulky.count}/{bulky.max}
                  </b>
                  {bulky.overloaded && <span>沉重显眼</span>}
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
                        <ActionButton onClick={() => onUnequip(c.id)}>脱下</ActionButton>
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
                      : (kind === "healing" || kind === "grenade") && remaining === 0
                        ? "次数已用完，休整或场景结束后恢复"
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
                        onMod={onMod}
                        openSlot={openSlotPicker?.weaponId === id ? openSlotPicker.slot : null}
                        onToggleSlot={(slot) =>
                          setOpenSlotPicker(slot ? { weaponId: id, slot } : null)
                        }
                      />
                    )}

                    <div className={styles.detailActions}>
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
                        <Button small onClick={() => onUnequip(id)}>
                          脱下
                        </Button>
                      )}

                      {to === "clothing" && onEquip && (
                        <Button small primary onClick={() => onEquip(id)}>
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
            {view.shops.map((shop) => (
              <Button key={shop.id} small onClick={() => onShop(shop.id)}>
                进{shop.name}
              </Button>
            ))}
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

/** 追踪（J）：只列眼下揽在手里的单子、正在查的超梦与期限约定；点开看笔记详情 */
export function JournalPage({
  view,
  onBraindance,
}: {
  readonly view: View;
  /** 打开超梦体验编辑器；有在查的超梦时才有按钮 */
  readonly onBraindance: () => void;
}) {
  const track = trackTelemetry(view);
  const placeNames = new Map((view.travel?.destinations ?? []).map((d) => [d.id, d.name]));
  const activeJobs = [...view.jobs.list.filter((j) => j.status === "active")].sort((a, b) => {
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    if (a.dueIn !== null && b.dueIn !== null) return a.dueIn - b.dueIn;
    if (a.dueIn !== null) return -1;
    if (b.dueIn !== null) return 1;
    return 0;
  });
  const otherActive = track.active.filter(
    (item) => item.kind !== "braindance" && item.source !== "jobs",
  );
  const nothingActive =
    !view.braindance.active && activeJobs.length === 0 && otherActive.length === 0;

  return (
    <div className={styles.trackPane}>
      {view.braindance.active && (
        <div className={styles.trackBdCard}>
          <div className={styles.trackBdInfo}>
            <span className={styles.trackBdTag}>超梦调查中</span>
            <strong>
              {view.braindance.active.title}（{view.braindance.active.recorder}的录像）
            </strong>
            <small className={styles.dim}>
              {view.braindance.active.ready
                ? "关键线索找全了，可以下结论"
                : `关键线索找到 ${view.braindance.active.keys.found}/${view.braindance.active.keys.total} 条`}
            </small>
          </div>
          <Button small onClick={onBraindance}>
            打开超梦编辑器
          </Button>
        </div>
      )}

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
  chatSending,
  pendingChat,
  busy,
  onLocatePlace,
  onOpenRipperdoc,
  onOpenShop,
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
    chatSending,
    pendingChat,
    busy,
    onLocatePlace,
    onOpenRipperdoc,
    onOpenShop,
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

/** 芯片阅读器：放入左下未读终端，左侧列表点开即标已读，右侧显示原文 */
export function ShardsPanel({
  view,
  onReadShard,
}: {
  readonly view: View;
  /** 打开一张没读过的芯片：记成已读 */
  readonly onReadShard: (id: number) => void;
}) {
  const shards = view.shards.list;
  const [picked, setPicked] = useState<number | null>(null);
  const current = shards.find((s) => s.id === picked) ?? null;

  const open = (id: number, read: boolean) => {
    setPicked(id);
    if (!read) onReadShard(id);
  };

  if (shards.length === 0) {
    return (
      <div className={styles.phoneEmpty}>
        <p className={styles.dim}>还没拾获过数据芯片。</p>
      </div>
    );
  }

  return (
    <div className={styles.dbSplit}>
      <ul className={`${styles.contactList} ${styles.dbList}`} aria-label="芯片">
        {shards.map((s) => (
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
      </ul>
      <article className={styles.dbReader}>
        {current ? (
          <>
            <h3 className={styles.dbReaderTitle}>{current.title}</h3>
            <p className={styles.dim}>
              {current.kindLabel}
              {current.from && ` · ${current.from}`} · {current.at}
            </p>
            <p className={styles.factionReason}>{current.text}</p>
          </>
        ) : (
          <p className={styles.dim}>从左侧选择一张芯片阅读原文。</p>
        )}
      </article>
    </div>
  );
}
