import { describe, expect, it } from "vitest";
import { z } from "zod";
import { RepairBudget, validateEntries } from "./validation";

const entrySchema = z.object({ count: z.number().int().positive() });

describe("有限批量格式修复", () => {
  it("多个错误只修一次，合法值不能被修复响应改写", async () => {
    let calls = 0;
    const result = await validateEntries(
      [
        { key: "valid", raw: { count: 1 }, schema: entrySchema },
        { key: "first", raw: { count: "2" }, schema: entrySchema },
        { key: "second", raw: { count: "3" }, schema: entrySchema },
      ],
      async (_task, raw) => {
        calls++;
        expect(JSON.parse(raw).map((e: { key: string }) => e.key)).toEqual(["first", "second"]);
        return {
          fixes: [
            { key: "first", value: { count: 2 } },
            { key: "second", value: { count: 3 } },
            { key: "valid", value: { count: 99 } },
            { key: "invented", value: { count: 99 } },
          ],
        };
      },
    );
    expect(calls).toBe(1);
    expect(Object.fromEntries(result.values)).toEqual({
      valid: { count: 1 },
      first: { count: 2 },
      second: { count: 3 },
    });
    expect(result.failures).toEqual([]);
  });

  it("含糊的重复修复和仍然非法的条目继续失败", async () => {
    const result = await validateEntries(
      [
        { key: "duplicate", raw: { count: "1" }, schema: entrySchema },
        { key: "invalid", raw: { count: "2" }, schema: entrySchema },
      ],
      async () => ({
        fixes: [
          { key: "duplicate", value: { count: 1 } },
          { key: "duplicate", value: { count: 2 } },
          { key: "invalid", value: { count: -1 } },
        ],
      }),
    );
    expect(result.values.size).toBe(0);
    expect(result.failures.map((f) => f.entry.key)).toEqual(["duplicate", "invalid"]);
  });

  it("过大的错误不挤掉可修的关键条目", async () => {
    let calls = 0;
    const result = await validateEntries(
      [
        { key: "large", raw: { count: "很长".repeat(10_000) }, schema: entrySchema },
        { key: "small", raw: { count: "2" }, schema: entrySchema, priority: 1 },
      ],
      async (_task, raw) => {
        calls++;
        expect(JSON.parse(raw).map((e: { key: string }) => e.key)).toEqual(["small"]);
        return { fixes: [{ key: "small", value: { count: 2 } }] };
      },
    );
    expect(calls).toBe(1);
    expect(result.failures.map((f) => f.entry.key)).toEqual(["large"]);
  });

  it("每阶段顶层修复与条目修复共用一次额度，超预算不会发请求", () => {
    const budget = new RepairBudget();
    expect(budget.claim("judge", "判断的错误")).toBeUndefined();
    expect(budget.claim("judge", "同阶段第二次错误")).toBeDefined();
    expect(budget.claim("extract", "字".repeat(8_001))).toBeDefined();
    expect(budget.claim("extract", "抽取的错误")).toBeUndefined();
    expect(budget.claim("extract", "同阶段第二次错误")).toBeDefined();
  });
});
