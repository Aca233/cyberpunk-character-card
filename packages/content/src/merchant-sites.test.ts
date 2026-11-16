import { describe, expect, it } from "vitest";
import { cyberware, gameContent, items, merchantSites, ripperdocs, shops } from "./index";

describe("content merchant index", () => {
  it("ships one shared content set into gameContent and mapData", () => {
    expect(gameContent.shops).toBe(shops);
    expect(gameContent.ripperdocs).toBe(ripperdocs);
    expect(gameContent.mapData.merchantSites).toBe(merchantSites);
  });

  it("keeps all shelves inside the corresponding static catalogs", () => {
    const itemIds = new Set(items.map((item) => item.id));
    const cyberwareIds = new Set(cyberware.map((part) => part.id));
    expect(shops.flatMap((shop) => shop.shelf.filter((id) => !itemIds.has(id)))).toEqual([]);
    expect(ripperdocs.flatMap((doc) => doc.shelf.filter((id) => !cyberwareIds.has(id)))).toEqual(
      [],
    );
  });

  it("preserves explicit multi-entrance identities and separate same-name clinics", () => {
    const indexed = new Map(merchantSites.map((site) => [site.merchant, site]));
    expect(indexed.get("wilson")?.locations).toEqual([
      "megabuilding-h10",
      "poi:wat_lch_gunsmith_01",
    ]);
    expect(indexed.get("viktor")?.locations).toEqual(["vik-clinic", "poi:wat_lch_ripperdoc_01"]);
    const hatch = ripperdocs.filter((doc) => doc.name === "哈奇·斯宾德勒");
    expect(hatch).toHaveLength(2);
    expect(hatch[0]?.id).not.toBe(hatch[1]?.id);
    expect(hatch.map((doc) => doc.location)).toEqual([
      "poi:bls_ina_se1_ripperdoc_01",
      "poi:bls_ina_se1_ripperdoc_01b",
    ]);
  });
});
