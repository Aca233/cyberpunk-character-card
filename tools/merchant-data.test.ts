import { describe, expect, it } from "vitest";
import { merchantDataIssues } from "./merchant-data";

const data = {
  items: [{ id: "tea", name: "茶", kind: "consumable", price: 10 }],
  locations: [{ id: "hub", name: "配送点", district: "沃森" }],
  mapAreas: { centers: { 沃森: { x: 20, y: 20 } }, districts: [], kinds: [] },
  servicePoints: [{ id: "food_a", kind: "food", name: "街角茶摊", x: 20, y: 20 }],
  shops: [
    {
      id: "tea-stall",
      name: "街角茶摊",
      keeper: "摊主",
      location: "poi:food_a",
      shelf: ["tea"],
      initialStock: { tea: 2 },
      supply: {
        supplier: "tea-distributor",
        origin: "配送点送货",
        route: ["hub", "poi:food_a"],
        leadMinutes: 30,
      },
    },
  ],
  merchantSites: [
    {
      merchant: "tea-stall",
      kind: "food",
      locations: ["poi:food_a"],
      services: ["drink"],
      source: "原作服务点",
    },
  ],
};

describe("商家内容引用校验", () => {
  it("接受实际存在但尚未访问的 POI 和供货路线", () => {
    expect(merchantDataIssues(data)).toEqual([]);
  });
  it("拒绝拼错的 POI，不以 poi 前缀替代真实存在性检查", () => {
    const bad = { ...data, shops: [{ ...data.shops[0], location: "poi:food_typo" }] };
    expect(merchantDataIssues(bad).join("\n")).toContain("不存在的地点「poi:food_typo」");
  });
  it("拒绝供货不存在商品、无效路段与遗漏目的地", () => {
    const shop = data.shops[0];
    const bad = {
      ...data,
      shops: [{ ...shop, supply: { ...shop?.supply, items: ["imaginary"], route: ["poi:wrong"] } }],
    };
    const issues = merchantDataIssues(bad).join("\n");
    expect(issues).toContain("不存在的物品「imaginary」");
    expect(issues).toContain("不存在的地点「poi:wrong」");
    expect(issues).toContain("供货路线未经过自己的经营地点");
  });
  it("拒绝孤立经营身份、重复经营索引和无效服务", () => {
    expect(merchantDataIssues({ ...data, merchantSites: [] }).join("\n")).toContain(
      "缺少经营场所索引",
    );
    expect(
      merchantDataIssues({
        ...data,
        merchantSites: [...data.merchantSites, ...data.merchantSites],
      }).join("\n"),
    ).toContain("经营场所关联重复");
    expect(
      merchantDataIssues({
        ...data,
        merchantSites: [{ ...data.merchantSites[0], services: ["teleport"] }],
      }).join("\n"),
    ).toContain("服务不存在「teleport」");
  });
});
