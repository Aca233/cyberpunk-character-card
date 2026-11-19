import { z } from "zod";
import { type MerchantSite, merchantSites } from "./merchant-sites";
import { locationForTravel } from "./places";
import { type RadarAnchor, radarAround } from "./radar";
import type { WorldClockState } from "./schema";

const NamesSchema = z.array(
  z.object({ id: z.string(), name: z.string(), keeper: z.string().optional() }),
);
const WorkLabelSchema = z.object({ id: z.string(), title: z.string() });
const KIND_LABELS: Record<MerchantSite["kind"], string> = {
  gun: "武器店",
  melee: "近战武器店",
  clothes: "服装店",
  meds: "药店",
  food: "食品店",
  bar: "酒吧",
  ripperdoc: "义体医生",
  netrunner: "黑客商店",
  mixed: "综合商店",
};
const KIND_WORDS: Record<MerchantSite["kind"], RegExp> = {
  gun: /武器店|枪店|买枪/,
  melee: /近战|刀店|买刀/,
  clothes: /服装|衣服|夹克/,
  meds: /药店|买药|药品/,
  food: /食品|饭店|餐厅|吃饭|咖啡/,
  bar: /酒吧|喝酒/,
  ripperdoc: /义体|诊所|医生/,
  netrunner: /黑客|潜网|网络行者|黑客商店|EMP|芯片/,
  mixed: /商店|商街/,
};
const tradeInput =
  /买|卖|交易|商店|店主|店员|商贩|店铺|订货|取货|供货|到货|饭店|餐厅|酒吧|诊所|医生|义体/;
const normalize = (text: string) =>
  text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}]/gu, "");

/** 只给现场、附近候选和本轮明确提到的经营身份；不把全城货架装进判断。 */
export function merchantEntranceText(
  clock: Pick<WorldClockState, "location" | "places">,
  data: Readonly<Record<string, unknown>>,
  input: string,
): string | undefined {
  const sites = [...merchantSites(data).values()];
  if (sites.length === 0) return undefined;
  const names = new Map(
    [...NamesSchema.parse(data.shops ?? []), ...NamesSchema.parse(data.ripperdocs ?? [])].map(
      (row) => [row.id, row],
    ),
  );
  const query = normalize(input);
  const workLabels = new Map(
    [
      ...z.array(WorkLabelSchema).parse(data.braindances ?? []),
      ...Object.values(z.record(z.string(), WorkLabelSchema).parse(data.braindanceWorks ?? {})),
    ].map((work) => [work.id, work.title]),
  );
  const mentioned = (name: string | undefined) => {
    const key = name ? normalize(name) : "";
    return key.length >= 2 && query.includes(key);
  };
  const requestedKinds = new Set(
    sites.filter((site) => KIND_WORDS[site.kind].test(input)).map((site) => site.kind),
  );
  const nearbyIds = new Set<string>();
  if (tradeInput.test(input) && clock.location) {
    const candidates = new Set(
      sites
        .filter((site) => requestedKinds.size === 0 || requestedKinds.has(site.kind))
        .flatMap((site) => site.locations),
    );
    const radar = Array.isArray(data.radar) ? (data.radar as RadarAnchor[]) : [];
    for (const hit of radarAround(
      { ...data, radar: radar.filter((row) => candidates.has(row.id)) },
      locationForTravel(data, clock.location),
    ))
      nearbyIds.add(hit.id);
  }
  const selected = sites.filter((site) => {
    if (
      site.locations.includes(clock.location ?? "") ||
      site.locations.some((id) => nearbyIds.has(id))
    )
      return true;
    const person = names.get(site.merchant);
    const namedKeeper =
      person?.keeper && !/店员|商贩|酒保|摊主/.test(person.keeper) ? person.keeper : undefined;
    return (
      mentioned(site.merchant) ||
      mentioned(person?.name) ||
      mentioned(namedKeeper) ||
      site.locations.some((id) => mentioned(id) || mentioned(locationForTravel(data, id)?.name))
    );
  });
  if (selected.length === 0) return undefined;
  const lines = selected.map((site) => {
    const places = site.locations.map((id) => {
      const place = locationForTravel(data, id);
      return `${id}${place ? ` ${place.name}（${place.district}）` : ""}`;
    });
    const works = site.braindanceWorks.map((id) =>
      workLabels.has(id) ? `${id}「${workLabels.get(id)}」` : id,
    );
    const playback = site.services.includes("bd-session")
      ? `；店内固定片单 ${works.join("、") || "尚无已登记作品"}；片单来源 ${site.source}`
      : "";
    return `- ${site.merchant} ${names.get(site.merchant)?.name ?? "已登记经营者"}（${KIND_LABELS[site.kind]}）；地点 ${places.join(" / ")}；服务 ${site.services.join("、") || "无通用付费服务"}${playback}`;
  });
  return `${lines.join("\n")}\n交易 with 写经营身份，出行 destination/world.location 写地点；同名且地点仍不明确时先确认，不能猜一家。这里是经营索引，不保证现货、营业或接单；实际报价与交付另行核验。`;
}
