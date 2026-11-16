import { describe, expect, it } from "vitest";
import { merchantEntranceText } from "./merchant-context";

const locations = [
  { id: "street", name: "住处门口", district: "沃森", x: 10, y: 10 },
  { id: "tea-place", name: "茶铺", district: "沃森", x: 11, y: 10 },
  { id: "doc-east", name: "东侧诊所", district: "沃森", x: 90, y: 10 },
  { id: "doc-west", name: "西侧诊所", district: "海伍德", x: 90, y: 90 },
];
const data = {
  locations,
  radar: locations.map((row) => ({ ...row, kind: null })),
  shops: [{ id: "tea", name: "阿青茶铺", keeper: "阿青", shelf: ["secret-tea-stock"] }],
  ripperdocs: [
    { id: "doc-a", name: "同名医生" },
    { id: "doc-b", name: "同名医生" },
  ],
  merchantSites: [
    {
      merchant: "tea",
      kind: "food",
      locations: ["tea-place"],
      services: ["drink"],
      source: "开局经营数据",
    },
    {
      merchant: "doc-a",
      kind: "ripperdoc",
      locations: ["doc-east"],
      services: ["medical"],
      source: "核对入口",
    },
    {
      merchant: "doc-b",
      kind: "ripperdoc",
      locations: ["doc-west"],
      services: ["medical"],
      source: "核对入口",
    },
  ],
};

describe("相关经营入口上下文", () => {
  it("现场显示稳定经营身份与地点，其他城市货架不混入", () => {
    const text = merchantEntranceText({ location: "tea-place", places: [] }, data, "看看周围");
    expect(text).toContain("tea 阿青茶铺");
    expect(text).toContain("tea-place 茶铺（沃森）");
    expect(text).toContain("服务 drink");
    expect(text).not.toContain("doc-a");
    expect(text).not.toContain("secret-tea-stock");
  });
  it("相关附近店可在出发前发现，不相关输入不展开远处商家", () => {
    const clock = { location: "street", places: [] };
    expect(merchantEntranceText(clock, data, "去附近食品店买杯咖啡")).toContain("tea 阿青茶铺");
    expect(merchantEntranceText(clock, data, "看一眼窗外")).toBeUndefined();
  });
  it("明确提到远处同名经营者时保留两个身份与地点供消歧", () => {
    const text = merchantEntranceText({ location: "street", places: [] }, data, "去找同名医生");
    expect(text).toContain("doc-a 同名医生");
    expect(text).toContain("doc-b 同名医生");
    expect(text).toContain("doc-east 东侧诊所（沃森）");
    expect(text).toContain("doc-west 西侧诊所（海伍德）");
    expect(text).not.toContain("tea 阿青茶铺");
  });
});
