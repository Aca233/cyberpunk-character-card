import { locationCatalog } from "./schema";

/**
 * 地点 id 所在的城区：先查地点表；表外的地点按「沃森 · 无名小巷」这种写法认开头的城区名，
 * 开头不是地点表里的城区就查不到
 */
export function districtResolver(
  data: Readonly<Record<string, unknown>> | undefined,
): (location: string) => string | undefined {
  const catalog = data ? locationCatalog(data) : new Map<string, { readonly district: string }>();
  const districts = new Set([...catalog.values()].map((p) => p.district));
  return (location) => {
    const def = catalog.get(location);
    if (def) return def.district;
    const head = location.split(/[·・|/]/)[0]?.trim();
    return head !== undefined && districts.has(head) ? head : undefined;
  };
}
