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

/**
 * 每个部位按原作格数装（用户 2026-10-31："为什么每个地方的义体只能选一个""现在 ui 和能装的义体数量对不上"）：
 * 没装满直接加，装满了换下最早装的那件；开局主板超过格数才不收
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

  it("装满了再装，换下这个部位最早装的那件", () => {
    expect(installAll(["cortex-a", "cortex-b", "cortex-c", "cortex-d"])).toEqual([
      "cortex-b",
      "cortex-c",
      "cortex-d",
    ]);
  });

  it("只有一格的部位还是换下旧的", () => {
    expect(installAll(["arm-a", "arm-b"])).toEqual(["arm-b"]);
  });
});

describe("开局主板的义体", () => {
  const snap = (id: string) => ({ id, name: id, points: 1, humanityCost: 2 });
  const tables = { cyberware: parts, combos: [] };

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
});
