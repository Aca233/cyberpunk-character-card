import { cyberwareRules, economyRules, inventoryRules, worldRules } from "@cp/core";

/** 校验开局经营资料；POI 必须能由真实地图数据解析，不能只凭前缀放行。 */
export function merchantDataIssues(data: Readonly<Record<string, unknown>>): string[] {
  const errors: string[] = [];
  const shops = inventoryRules.ShopListSchema.parse(data.shops ?? []);
  const docs = cyberwareRules.RipperdocListSchema.parse(data.ripperdocs ?? []);
  let sites: ReturnType<typeof worldRules.merchantSites>;
  try {
    sites = worldRules.merchantSites(data);
  } catch (error) {
    return [`经营场所索引：${String(error)}`];
  }
  const itemIds = new Set(
    inventoryRules.ItemCatalogSchema.parse(data.items ?? []).map((i) => i.id),
  );
  const chromeIds = new Set(
    cyberwareRules.CyberwareCatalogSchema.parse(data.cyberware ?? []).map((c) => c.id),
  );
  const merchants = new Map<string, { location: string; clinic: boolean }>();
  const checkPlace = (label: string, location: string) => {
    if (!worldRules.locationForTravel(data, location))
      errors.push(`${label}：引用了不存在的地点「${location}」`);
  };
  for (const [kind, rows] of [
    ["商店", shops],
    ["义体医生", docs],
  ] as const) {
    for (const row of rows) {
      if (merchants.has(row.id)) errors.push(`经营身份跨表重复：${row.id}`);
      merchants.set(row.id, { location: row.location, clinic: kind === "义体医生" });
      checkPlace(`${kind} ${row.id}`, row.location);
      for (const id of Object.keys(row.initialStock ?? {})) {
        if (!row.shelf.includes(id))
          errors.push(`${kind} ${row.id}：开局数量引用了货架外商品「${id}」`);
      }
    }
  }
  for (const shop of shops) {
    for (const id of [...shop.shelf, ...(shop.supply?.items ?? [])]) {
      if (!itemIds.has(id)) errors.push(`商店 ${shop.id}：引用了不存在的物品「${id}」`);
    }
    if (!shop.supply) continue;
    for (const location of shop.supply.route) checkPlace(`商店 ${shop.id} 的供货路线`, location);
    if (
      !shop.supply.route.some((location) =>
        worldRules.merchantAt(data, shop.id, shop.location, location),
      )
    ) {
      errors.push(`商店 ${shop.id}：供货路线未经过自己的经营地点`);
    }
  }
  for (const doc of docs) {
    for (const id of doc.shelf) {
      if (!chromeIds.has(id)) errors.push(`义体医生 ${doc.id}：引用了不存在的义体「${id}」`);
    }
  }
  for (const [id, merchant] of merchants) {
    const site = sites.get(id);
    if (!site) {
      errors.push(`经营者 ${id}：缺少经营场所索引`);
      continue;
    }
    if (!site.locations.includes(merchant.location))
      errors.push(`经营者 ${id}：索引遗漏自己的经营地点`);
    if ((site.kind === "ripperdoc") !== merchant.clinic)
      errors.push(`经营者 ${id}：经营类型与商家表不一致`);
  }
  for (const site of sites.values()) {
    if (!merchants.has(site.merchant)) errors.push(`经营索引 ${site.merchant}：经营者不存在`);
    for (const location of site.locations) checkPlace(`经营索引 ${site.merchant}`, location);
    for (const service of site.services) {
      if (!Object.hasOwn(economyRules.SERVICES, service))
        errors.push(`经营索引 ${site.merchant}：服务不存在「${service}」`);
    }
  }
  return errors;
}
