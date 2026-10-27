import type { ViewContext } from "../../kernel/system";
import { formatGameTime } from "../world";
import { BULLETIN_KIND_LABELS, CityStateSchema } from "./schema";

/** 玩家可见的公开播报，新的在前；不带场外事件和传闻的真假 */
export function bulletinsView({ world }: ViewContext) {
  const city = CityStateSchema.parse(world.slices.city ?? {});
  return [...city.bulletins].reverse().map((b) => ({
    id: b.id,
    kind: b.kind,
    label: BULLETIN_KIND_LABELS[b.kind],
    title: b.title,
    text: b.text,
    time: formatGameTime(b.at),
  }));
}
