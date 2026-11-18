import { produce } from "immer";
import { describe, expect, it } from "vitest";
import { BoardSchema, normalizeBoard } from "../../schemas/board";
import { install } from "./apply";
import {
  type CyberwareDef,
  CyberwareDefSchema,
  CyberwareStateSchema,
  SLOT_CAPACITY,
} from "./schema";
import { bonusText } from "./view";

/**
 * 每个部位按原作格数装（用户 2026-10-31："为什么每个地方的义体只能选一个""现在 ui 和能装的义体数量对不上"）：
 * 没装满直接加，装满需要明确授权替换；开局主板超过格数不收
 */

const def = (id: string, slot: CyberwareDef["slot"]) =>
  CyberwareDefSchema.parse({
    id,
    name: id,
    slot,
    rarity: "common",
    price: 1000,
    humanityCost: 2,
    ability: "能",
  });

const parts = [
  def("cortex-a", "frontalCortex"),
  def("cortex-b", "frontalCortex"),
  def("cortex-c", "frontalCortex"),
  def("cortex-d", "frontalCortex"),
  def("arm-a", "arms"),
  def("arm-b", "arms"),
];
const catalog = new Map(parts.map((p) => [p.id, p]));

const installAll = (ids: readonly string[]) =>
  produce(CyberwareStateSchema.parse({}), (draft) => {
    ids.forEach((id, i) => {
      install(draft, id, catalog, i);
    });
  }).installed.map((c) => c.id);

describe("义体按部位格数装", () => {
  it("格数和人体图一致", () => {
    expect(SLOT_CAPACITY.frontalCortex).toBe(3);
    expect(SLOT_CAPACITY.arms).toBe(1);
  });

  it("没装满时同一部位能装好几件", () => {
    expect(installAll(["cortex-a", "cortex-b", "cortex-c"])).toEqual([
      "cortex-a",
      "cortex-b",
      "cortex-c",
    ]);
  });

  it("装满后没有指定替换目标，不自行删除最早安装的旧件", () => {
    expect(installAll(["cortex-a", "cortex-b", "cortex-c", "cortex-d"])).toEqual([
      "cortex-a",
      "cortex-b",
      "cortex-c",
    ]);
  });

  it("只有一格的部位也必须指定目标才替换", () => {
    expect(installAll(["arm-a", "arm-b"])).toEqual(["arm-a"]);
    const replaced = produce(CyberwareStateSchema.parse({}), (draft) => {
      install(draft, "arm-a", catalog, 0);
      expect(
        install(draft, "arm-b", catalog, 1, { price: 0, eddies: 0, replace: "arm-a" }).ok,
      ).toBe(true);
    });
    expect(replaced.installed.map((c) => c.id)).toEqual(["arm-b"]);
  });
});

describe("开局主板的义体", () => {
  const snap = (id: string) => ({ id, name: id, humanityCost: 2 });
  const tables = { cyberware: parts };

  it("同一部位没超过格数就收", () => {
    const board = BoardSchema.parse({
      cyberware: [snap("cortex-a"), snap("cortex-b"), snap("cortex-c")],
    });
    expect(normalizeBoard(board, tables).ok).toBe(true);
  });

  it("超过格数不收", () => {
    const board = BoardSchema.parse({ cyberware: [snap("arm-a"), snap("arm-b")] });
    expect(normalizeBoard(board, tables).ok).toBe(false);
  });

  it("义体面板文案不输出属性加值或检定词条", () => {
    const ware = CyberwareDefSchema.parse({
      id: "k-test",
      name: "克伦齐科夫",
      slot: "nervous",
      rarity: "rare",
      price: 1000,
      humanityCost: 4,
      ability: "闪避加速",
      checks: ["reflexes"],
      attributes: { reflexes: 2 },
      armor: true,
      accelerator: true,
    });
    const text = bonusText(ware);
    expect(text).not.toMatch(/反应|检定|\+2/);
    expect(text.length).toBeGreaterThan(0);
  });
});
