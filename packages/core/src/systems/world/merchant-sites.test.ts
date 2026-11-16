import { describe, expect, it } from "vitest";
import { merchantAt, merchantServices, merchantSites } from "./merchant-sites";

const data = {
  merchantSites: [
    {
      merchant: "doctor",
      kind: "ripperdoc",
      locations: ["clinic", "poi:clinic"],
      services: ["medical"],
      source: "已核对诊所入口",
    },
    {
      merchant: "guns",
      kind: "gun",
      locations: ["building", "poi:guns"],
      services: [],
      source: "已核对枪店入口",
    },
  ],
};

describe("经营场所的明确地点关联", () => {
  it("同一经营身份的剧情地点与地图入口双向对应", () => {
    expect(merchantAt(data, "doctor", "clinic", "poi:clinic")).toBe(true);
    expect(merchantAt(data, "doctor", "poi:clinic", "clinic")).toBe(true);
    expect(merchantAt(data, "doctor", "clinic", "clinic")).toBe(true);
  });

  it("其他商家不能借相同或相邻地点占用这个关联", () => {
    expect(merchantAt(data, "other-doctor", "clinic", "poi:clinic")).toBe(false);
    expect(merchantAt(data, "doctor", "neighbor-clinic", "poi:clinic")).toBe(false);
    expect(merchantAt(data, "doctor", "clinic", "poi:guns")).toBe(false);
    expect(merchantAt(data, "doctor", "clinic", null)).toBe(false);
  });

  it("未索引场所只认自己的确切地点，不按名字合并", () => {
    expect(merchantAt({}, "same-name-a", "poi:a", "poi:a")).toBe(true);
    expect(merchantAt({}, "same-name-a", "poi:a", "poi:b")).toBe(false);
    expect(merchantServices({}, "temporary-vendor")).toBeUndefined();
  });

  it("服务能力按经营类型显式登记，枪店不因有价格表就能看病", () => {
    expect(merchantServices(data, "doctor")).toEqual(["medical"]);
    expect(merchantServices(data, "guns")).toEqual([]);
  });

  it("重复经营身份和无效数据拒收，不靠后写的覆盖先写的", () => {
    expect(() =>
      merchantSites({ merchantSites: [...data.merchantSites, data.merchantSites[0]] }),
    ).toThrow("经营场所关联重复");
    expect(() =>
      merchantSites({
        merchantSites: [{ ...data.merchantSites[0], locations: ["clinic", "clinic"] }],
      }),
    ).toThrow("经营场所地点重复");
  });
});
