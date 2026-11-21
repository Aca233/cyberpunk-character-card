import type { SystemSection } from "../../kernel/system";
import { locationCatalog, WorldClockStateSchema } from "../world";
import { citySection, playerRumorLine, rumorSection } from "./prompt";
import { CityStateSchema } from "./schema";

function threadIdsOf(slice: unknown): ReadonlySet<string> {
  if (typeof slice !== "object" || slice === null) return new Set();
  const raw = slice as { threads?: readonly { id?: unknown }[]; closed?: readonly { id?: unknown }[] };
  const ids = new Set<string>();
  for (const item of [...(raw.threads ?? []), ...(raw.closed ?? [])]) {
    if (typeof item?.id === "string") ids.add(item.id);
  }
  return ids;
}

/** 给叙事模型的情境节：未被统一局势覆盖的独立动静、按当前城区优先排序的街头传闻、传闻里的你 */
export const citySections: readonly SystemSection[] = [
  {
    order: 80,
    title: "城里的动静",
    stages: ["judge", "narrate"],
    render: ({ world }) =>
      citySection(
        CityStateSchema.parse(world.slices.city ?? {}),
        threadIdsOf(world.slices.threads),
      ) || undefined,
  },
  {
    order: 90,
    title: "街头传闻",
    render: ({ world, data }) => {
      const clock = WorldClockStateSchema.parse(world.slices.world);
      const district =
        clock.location !== null && data
          ? locationCatalog(data).get(clock.location)?.district
          : undefined;
      return rumorSection(CityStateSchema.parse(world.slices.city ?? {}), district) || undefined;
    },
  },
  {
    order: 100,
    title: "传闻里的你",
    stages: ["judge", "narrate"],
    render: ({ world }) => {
      const heard = playerRumorLine(CityStateSchema.parse(world.slices.city ?? {}));
      if (!heard) return undefined;
      return `${heard}\n听过这些说法的人第一反应照这个版本来，和状态里的「别人眼里的你」合起来看。`;
    },
  },
];
