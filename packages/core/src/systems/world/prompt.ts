import { locationCatalog } from "./schema";

/** 地点表：和物品表一样放在系统提示词末尾 */
export function locationSection(data: Readonly<Record<string, unknown>>): string | undefined {
  const places = [...locationCatalog(data).values()];
  if (places.length === 0) return undefined;
  const lines = places.map(
    (p) => `- ${p.id}：${p.name}（${p.district}${p.note ? `，${p.note}` : ""}）`,
  );
  return `【常用地点】
world 指令换地点时，去下面这些地方就用这些 id；表里没有的地方，location 直接写中文地名，例如「沃森 · 无名小巷」。
${lines.join("\n")}`;
}
