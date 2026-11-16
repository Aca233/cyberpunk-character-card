import "fake-indexeddb/auto";
import type { SaveMeta, Snapshot } from "@cp/core";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { IdbDocStore, IdbSaveStore, openGameDb } from "./idb-store";
import { SaveExistsError, SaveMovedError, SaveNotFoundError, SNAPSHOT_KEEP } from "./ports";

/** 每个测试一份新的空数据库 */
const freshDb = () => openGameDb("test", new IDBFactory());

const META: SaveMeta = {
  title: "测试存档",
  characterId: "unassigned",
  createdAt: "2026-01-01T00:00:00.000Z",
  startTime: 0,
};

const snap = (nextSeq: number) =>
  ({ nextSeq, world: { time: nextSeq, slices: {} } }) as unknown as Snapshot;

describe("IdbDocStore", () => {
  it("按路径存取整份文本，list 只列下一层", async () => {
    const docs = new IdbDocStore(await freshDb());
    expect(await docs.read("config.json")).toBeUndefined();
    expect(await docs.list("characters")).toEqual([]);
    await docs.write("characters/c-2.json", "two");
    await docs.write("characters/c-1.json", "one");
    await docs.write("characters/deep/x.json", "deep");
    await docs.write("config.json", "{}", { secret: true });
    expect(await docs.read("characters/c-1.json")).toBe("one");
    expect(await docs.list("characters")).toEqual(["c-1.json", "c-2.json"]);
    await docs.write("characters/c-1.json", "one again");
    expect(await docs.read("characters/c-1.json")).toBe("one again");
    expect(await docs.remove("characters/c-1.json")).toBe(true);
    expect(await docs.remove("characters/c-1.json")).toBe(false);
    expect(await docs.list("characters")).toEqual(["c-2.json"]);
  });

  it("拒绝不合法的路径", async () => {
    const docs = new IdbDocStore(await freshDb());
    await expect(docs.write("../x.json", "")).rejects.toThrow("路径不合法");
    await expect(docs.read("a//b")).rejects.toThrow("路径不合法");
    await expect(docs.list("a\\b")).rejects.toThrow("路径不合法");
  });
});

describe("IdbSaveStore", () => {
  it("新建、列出、读 meta；重复新建和读不存在的存档都报错", async () => {
    const saves = new IdbSaveStore(await freshDb());
    await saves.create("s-b", META);
    await saves.create("s-a", META);
    expect(await saves.list()).toEqual(["s-a", "s-b"]);
    expect(await saves.readMeta("s-a")).toEqual(META);
    expect(await saves.readLog("s-a")).toBe("");
    expect((await saves.loadLog("s-a")).records).toEqual([]);
    await expect(saves.create("s-a", META)).rejects.toBeInstanceOf(SaveExistsError);
    await expect(saves.readMeta("s-x")).rejects.toBeInstanceOf(SaveNotFoundError);
    await expect(saves.readLog("s-x")).rejects.toBeInstanceOf(SaveNotFoundError);
    await expect(saves.appendLog("s-x", "{}\n")).rejects.toBeInstanceOf(SaveNotFoundError);
    await expect(saves.create("Bad Id", META)).rejects.toThrow("存档 id 不合法");
  });

  it("追加只收一整行，日志按追加顺序拼回来", async () => {
    const saves = new IdbSaveStore(await freshDb());
    await saves.create("s-1", META);
    await saves.appendLog("s-1", "a\n");
    await saves.appendLog("s-1", "b\n");
    await expect(saves.appendLog("s-1", "c")).rejects.toThrow("一行完整");
    await expect(saves.appendLog("s-1", "c\nd\n")).rejects.toThrow("一行完整");
    expect(await saves.readLog("s-1")).toBe("a\nb\n");
  });

  it("写回前核对：条数对得上才追加，对不上抛 SaveMovedError、什么都不写", async () => {
    const saves = new IdbSaveStore(await freshDb());
    await saves.create("s-1", META);
    await saves.appendAt("s-1", 0, "a\n");
    await saves.appendAt("s-1", 1, "b\n");
    const moved = saves.appendAt("s-1", 1, "stale\n");
    await expect(moved).rejects.toBeInstanceOf(SaveMovedError);
    await expect(moved).rejects.toMatchObject({ expected: 1, actual: 2 });
    expect(await saves.readLog("s-1")).toBe("a\nb\n");
  });

  it("两次写回基于同一个版本同时进来，只有一次成功", async () => {
    const saves = new IdbSaveStore(await freshDb());
    await saves.create("s-1", META);
    const results = await Promise.allSettled([
      saves.appendAt("s-1", 0, "first\n"),
      saves.appendAt("s-1", 0, "second\n"),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect((failed[0] as PromiseRejectedResult).reason).toBeInstanceOf(SaveMovedError);
    expect((await saves.readLog("s-1")).split("\n").filter(Boolean)).toHaveLength(1);
  });

  it("导入整份日志后可以接着按条数追加", async () => {
    const saves = new IdbSaveStore(await freshDb());
    await saves.create("s-1", META);
    await saves.importLog("s-1", "a\nb\nc\n");
    expect(await saves.readLog("s-1")).toBe("a\nb\nc\n");
    await saves.appendAt("s-1", 3, "d\n");
    expect(await saves.readLog("s-1")).toBe("a\nb\nc\nd\n");
    await expect(saves.importLog("s-1", "half")).rejects.toThrow("不完整");
  });

  it("快照按 nextSeq 排好，只留最近几个，存档之间互不影响", async () => {
    const saves = new IdbSaveStore(await freshDb());
    await saves.create("s-1", META);
    await saves.create("s-2", META);
    for (let i = 1; i <= SNAPSHOT_KEEP + 3; i++) await saves.writeSnapshot("s-1", snap(i * 10));
    await saves.writeSnapshot("s-2", snap(5));
    const kept = await saves.readSnapshots("s-1");
    expect(kept.map((s) => s.nextSeq)).toEqual(
      Array.from({ length: SNAPSHOT_KEEP }, (_, i) => (i + 4) * 10),
    );
    expect((await saves.readSnapshots("s-2")).map((s) => s.nextSeq)).toEqual([5]);
  });
});
