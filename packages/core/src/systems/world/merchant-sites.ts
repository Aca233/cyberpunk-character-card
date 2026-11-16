import { z } from "zod";

/** 经营身份与地图入口的核对表；同名或坐标接近不构成同一家店的证据。 */
export const MerchantSiteSchema = z.object({
  merchant: z.string().min(1),
  kind: z.enum(["gun", "melee", "clothes", "meds", "food", "bar", "ripperdoc", "mixed"]),
  locations: z.array(z.string().min(1)).min(1),
  services: z.array(z.string().min(1)).default([]),
  source: z.string().min(1),
});
export type MerchantSite = z.infer<typeof MerchantSiteSchema>;

type Data = Readonly<Record<string, unknown>>;
const cache = new WeakMap<object, ReadonlyMap<string, MerchantSite>>();

export function merchantSites(data: Data): ReadonlyMap<string, MerchantSite> {
  const raw = data.merchantSites;
  if (raw === undefined) return new Map();
  if (typeof raw === "object" && raw !== null) {
    const previous = cache.get(raw);
    if (previous) return previous;
  }
  const rows = z.array(MerchantSiteSchema).parse(raw);
  const indexed = new Map<string, MerchantSite>();
  for (const row of rows) {
    if (indexed.has(row.merchant)) throw new Error(`经营场所关联重复：${row.merchant}`);
    if (new Set(row.locations).size !== row.locations.length)
      throw new Error(`经营场所地点重复：${row.merchant}`);
    indexed.set(row.merchant, row);
  }
  if (typeof raw === "object" && raw !== null) cache.set(raw, indexed);
  return indexed;
}

/** 一个经营者的已核对入口可以共用库存；相邻店铺与同名分店始终分开。 */
export function merchantAt(
  data: Data,
  merchantId: string,
  configuredLocation: string,
  actualLocation: string | null | undefined,
): boolean {
  if (actualLocation === configuredLocation) return true;
  if (actualLocation == null) return false;
  const site = merchantSites(data).get(merchantId);
  return Boolean(
    site?.locations.includes(configuredLocation) && site.locations.includes(actualLocation),
  );
}

/** undefined 表示未在固定经营索引中登记；空列表表示此场所不提供通用付费服务。 */
export function merchantServices(data: Data, merchantId: string): readonly string[] | undefined {
  return merchantSites(data).get(merchantId)?.services;
}
