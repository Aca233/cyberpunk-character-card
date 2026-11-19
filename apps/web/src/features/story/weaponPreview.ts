import type { View } from "./view";

type CarriedWeapon = View["inventory"]["carriedWeapons"][number];

const RARITY_RANK: Readonly<Record<string, number>> = {
  common: 0,
  uncommon: 1,
  rare: 2,
  epic: 3,
  legendary: 4,
};

/** 常态栏展示当前持用与不同用途的代表；不改变背包顺序或武器可用性。 */
export function weaponPreview(inventory: View["inventory"], limit = 3) {
  const weapons = inventory.carriedWeapons;
  const ranked = weapons
    .map((weapon, index) => ({ weapon, index }))
    .sort(
      (a, b) =>
        Number(b.weapon.iconic) - Number(a.weapon.iconic) ||
        (RARITY_RANK[b.weapon.rarity ?? "common"] ?? 0) -
          (RARITY_RANK[a.weapon.rarity ?? "common"] ?? 0) ||
        a.index - b.index,
    )
    .map(({ weapon }) => weapon);
  const shown: CarriedWeapon[] = [];
  const ids = new Set<string>();
  const categories = new Set<string>();
  const categoryOf = (weapon: CarriedWeapon) =>
    weapon.category ?? (weapon.isRanged ? "ranged" : "melee");
  const add = (weapon: CarriedWeapon | undefined) => {
    if (!weapon || ids.has(weapon.id) || shown.length >= limit) return;
    shown.push(weapon);
    ids.add(weapon.id);
    categories.add(categoryOf(weapon));
  };

  for (const id of inventory.heldWeapons ?? []) add(weapons.find((weapon) => weapon.id === id));

  // 留一个近战摘要位，其他位置先覆盖不同远程类别；明确持用始终优先。
  const hasMelee = ranked.some((weapon) => !weapon.isRanged);
  const rangedTarget = Math.max(0, limit - Number(hasMelee));
  for (const weapon of ranked) {
    if (shown.filter((item) => item.isRanged).length >= rangedTarget) break;
    if (weapon.isRanged && !categories.has(categoryOf(weapon))) add(weapon);
  }
  if (!shown.some((weapon) => !weapon.isRanged)) {
    add(ranked.find((weapon) => !weapon.isRanged));
  }
  for (const weapon of ranked) {
    if (!categories.has(categoryOf(weapon))) add(weapon);
  }
  for (const weapon of ranked) add(weapon);

  return { shown, extra: weapons.filter((weapon) => !ids.has(weapon.id)) };
}
