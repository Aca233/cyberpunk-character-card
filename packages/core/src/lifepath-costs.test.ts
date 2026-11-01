import { describe, expect, it } from "vitest";
import {
  BoardModuleSchema,
  BoardSchema,
  LifepathEntrySchema,
  lifepathCosts,
} from "./schemas/board";

/** 第 2 步的代价（docs/creator-plan.md："给出 1–2 个跟这段经历沾边的代价"）：按生命路径表从插着的过往取 */

const mod = (id: string, slot: "past" | "flaw") =>
  BoardModuleSchema.parse({ id, slot, label: id, points: slot === "past" ? 2 : 1 });

const modules = [
  mod("merc", "past"),
  mod("fighter", "past"),
  mod("quiet", "past"),
  mod("enemy", "flaw"),
  mod("wound", "flaw"),
];

const table = LifepathEntrySchema.array().parse([
  { id: "merc", costs: ["enemy", "wound"] },
  { id: "fighter", costs: ["wound", "missing"] },
  { id: "quiet" },
]);

const pasts = (...ids: string[]) =>
  BoardSchema.parse({ pasts: ids.map((id) => modules.find((m) => m.id === id)) });

describe("lifepathCosts", () => {
  it("同一块负面经历只列一次，记下是哪几段过往带出来的", () => {
    const costs = lifepathCosts(pasts("merc", "fighter"), table, modules);
    expect(costs.map((c) => c.module.id)).toEqual(["enemy", "wound"]);
    expect(costs[1]?.from.map((p) => p.id)).toEqual(["merc", "fighter"]);
  });

  it("模块库里没有的 id 跳过；没写代价、没插过往就是空的", () => {
    expect(lifepathCosts(pasts("fighter"), table, modules).map((c) => c.module.id)).toEqual([
      "wound",
    ]);
    expect(lifepathCosts(pasts("quiet"), table, modules)).toEqual([]);
    expect(lifepathCosts(pasts(), table, modules)).toEqual([]);
  });
});
