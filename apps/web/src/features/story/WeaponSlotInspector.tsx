import { inventoryRules } from "@cp/core";
import type { CSSProperties } from "react";
import { ActionButton } from "../../ui/ActionButton";
import { Asset } from "../../ui/Asset";
import { itemArtOf } from "./art";
import { rarityLabelOf, rarityTintOf } from "./cyberwareMeta";
import styles from "./inventory.module.css";
import type { View } from "./view";

type ItemDetailsMap = NonNullable<View["inventory"]["details"]>;
type ItemDetail = ItemDetailsMap[string];

export interface ShopModMeta {
  readonly rarity: string | null;
  readonly rarityLabel: string | null;
  readonly ability: string | null;
}

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

/** 武器中心化槽位检视器：单列全宽逐槽展示已装配件、内联可装抽屉与精简未开放说明 */
export function WeaponSlotInspector({
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
  readonly shopModMeta: ReadonlyMap<string, ShopModMeta>;
  readonly itemName: (id: string) => string;
  readonly onMod?: ((action: "attach" | "detach", weapon: string, mod: string) => void) | undefined;
  readonly openSlot: inventoryRules.ModSlot | null;
  readonly onToggleSlot: (slot: inventoryRules.ModSlot | null) => void;
}) {
  const allowedSlots = inventoryRules.ModSlotSchema.options.filter((slot) =>
    detail.modSlots.includes(slot),
  );
  const unsupportedSlots = inventoryRules.ModSlotSchema.options
    .filter((slot) => !detail.modSlots.includes(slot))
    .map((slot) => ({
      label: inventoryRules.MOD_SLOT_LABELS[slot],
      reason: unsupportedSlotReason(detail.subLabel, slot),
    }));

  const occupiedCount = allowedSlots.filter((slot) => {
    const installedEntry = installedList?.find((m) => m.slot === slot);
    return Boolean(detail.weaponState?.mods[slot] ?? installedEntry?.id);
  }).length;

  return (
    <section className={styles.slotInspector} aria-label="武器改装槽位">
      <header className={styles.slotInspectorHead}>
        <span>改装槽位</span>
        <div className={styles.slotInspectorBadges}>
          <span className={styles.slotInspectorCount}>
            {occupiedCount}/{allowedSlots.length} 已装
          </span>
          {detail.weaponState?.smartLink && (
            <span className={styles.slotInspectorBadge}>智能联锁</span>
          )}
        </div>
      </header>

      {allowedSlots.length > 0 && (
        <ul className={styles.slotList}>
          {allowedSlots.map((slot) => {
            const slotLabel = inventoryRules.MOD_SLOT_LABELS[slot];
            const installedEntry = installedList?.find((m) => m.slot === slot);
            const installedId = detail.weaponState?.mods[slot] ?? installedEntry?.id;
            const isLocked =
              detail.weaponState?.lockedSlots.includes(slot) ?? installedEntry?.locked ?? false;

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
                  <div className={styles.slotHeaderRow}>
                    <div className={styles.slotLabelGroup}>
                      <strong className={styles.slotLabel}>{slotLabel}</strong>
                      {modRarityLabel && (
                        <span className={styles.slotRarText}>{modRarityLabel}</span>
                      )}
                      {isLocked && <span className={styles.slotLockTag}>已固锁</span>}
                    </div>
                    {!isLocked && onMod && (
                      <div className={styles.slotInlineActions}>
                        {compatibleMods.length > 0 && (
                          <ActionButton onClick={() => onToggleSlot(pickerOpen ? null : slot)}>
                            {pickerOpen ? "收起" : `更换 (${compatibleMods.length})`}
                          </ActionButton>
                        )}
                        <ActionButton
                          onClick={() => {
                            onToggleSlot(null);
                            onMod("detach", weaponId, installedId);
                          }}
                        >
                          拆下
                        </ActionButton>
                      </div>
                    )}
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
                  {isLocked && <p className={styles.slotLockNote}>已固锁 · 需前往枪匠工坊拆改</p>}
                  {pickerOpen && !isLocked && compatibleMods.length > 0 && (
                    <div className={styles.slotPickerWrap}>
                      <p className={styles.slotPickerHint}>
                        更换后，原「{modName}」将退回随身背包（按 Esc 收起）
                      </p>
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
                    </div>
                  )}
                </li>
              );
            }

            return (
              <li key={slot} className={styles.slotCard} data-state="empty">
                <div className={styles.slotHeaderRow}>
                  <div className={styles.slotLabelGroup}>
                    <strong className={styles.slotLabel}>{slotLabel}</strong>
                    <span className={styles.slotEmptyTag}>空余</span>
                  </div>
                  {!isLocked && compatibleMods.length > 0 && (
                    <div className={styles.slotInlineActions}>
                      <ActionButton onClick={() => onToggleSlot(pickerOpen ? null : slot)}>
                        {pickerOpen ? "收起" : `加装 (${compatibleMods.length})`}
                      </ActionButton>
                    </div>
                  )}
                </div>
                {isLocked ? (
                  <p className={styles.slotLockNote}>已锁定 · 需前往枪匠工坊解锁</p>
                ) : compatibleMods.length === 0 ? (
                  <p className={styles.slotNote}>背包暂无可用{slotLabel}配件</p>
                ) : pickerOpen ? (
                  <div className={styles.slotPickerWrap}>
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
                          {onMod ? (
                            <ActionButton
                              onClick={() => {
                                onToggleSlot(null);
                                onMod("attach", weaponId, mod.id);
                              }}
                            >
                              装上
                            </ActionButton>
                          ) : (
                            <small className={styles.slotEmptyTag}>不可拆装</small>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {unsupportedSlots.length > 0 && (
        <p className={styles.unsupportedFoot}>
          未开放：{unsupportedSlots.map(({ label, reason }) => `${label}（${reason}）`).join(" · ")}
        </p>
      )}
    </section>
  );
}
