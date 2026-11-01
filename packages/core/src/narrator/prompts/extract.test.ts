import { describe, expect, it } from "vitest";
import { extractRules } from "./extract";

/** 模型可用的指令都要有规则说明；物品栏精简拿掉零件规则后 parts 没跟着挪走，发回合直接报错（2026-10-30 实测） */
describe("extractRules", () => {
  it("每种模型可用指令都写进了规则模块", () => {
    expect(() => extractRules()).not.toThrow();
  });
});
