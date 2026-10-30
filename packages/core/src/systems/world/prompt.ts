import { locationCatalog } from "./schema";

/** 地点表：和物品表一样放在系统提示词末尾 */
export function locationSection(data: Readonly<Record<string, unknown>>): string | undefined {
  // 地点簿（place:、poi:、ft:）在【地点簿】里列，有 20 条上限（places-plan §八），这里不重复列
  const places = [...locationCatalog(data).values()].filter((p) => !/^(place|poi|ft):/.test(p.id));
  if (places.length === 0) return undefined;
  const lines = places.map(
    (p) => `- ${p.id}：${p.name}（${p.district}${p.note ? `，${p.note}` : ""}）`,
  );
  return `【常用地点】
world 指令换地点时，去下面这些地方就用这些 id；【地点簿】里的用那边的 id。两边都没有的新地方，同一轮附一条 place 记进地点簿（见"新地点和地点簿"），location 可以不写。
${lines.join("\n")}`;
}
