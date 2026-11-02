import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { createLocalBackend, LOCAL_ORIGIN } from "./browser";

/** 每个测试一份新的空数据库 */
const backend = () => createLocalBackend({ dbName: "test", factory: new IDBFactory() });

async function call(
  local: Awaited<ReturnType<typeof backend>>,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; data: Record<string, unknown> }> {
  const response = await local.fetch(
    new Request(`${LOCAL_ORIGIN}/api${path}`, {
      method,
      ...(body === undefined
        ? {}
        : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    }),
  );
  return { status: response.status, data: (await response.json()) as Record<string, unknown> };
}

describe("本地服务层（浏览器里直接跑 app.fetch）", () => {
  it("空数据库：健康检查说还没有配置，示例角色能列出来", async () => {
    const local = await backend();
    const health = await call(local, "GET", "/health");
    expect(health.status).toBe(200);
    expect(health.data.config).toBe("missing");
    const characters = await call(local, "GET", "/characters");
    expect(characters.status).toBe(200);
    expect((characters.data.characters as unknown[]).length).toBeGreaterThan(0);
  });

  it("照示例建配置，存在浏览器里，再建一次会被拒绝", async () => {
    const local = await backend();
    expect((await call(local, "POST", "/profiles/-/init")).status).toBe(200);
    const profiles = await call(local, "GET", "/profiles");
    expect(profiles.status).toBe(200);
    expect(profiles.data.status).toBe("ok");
    expect((profiles.data.profiles as unknown[]).length).toBeGreaterThan(0);
    expect((await call(local, "POST", "/profiles/-/init")).status).toBe(409);
  });

  it("建存档、列出、读状态都走 IndexedDB", async () => {
    const local = await backend();
    const created = await call(local, "POST", "/saves", {
      title: "本地存档",
      characterId: "sample-1",
      difficulty: "nightCity",
    });
    expect(created.status).toBe(201);
    const id = String(created.data.id);
    const saves = await call(local, "GET", "/saves");
    expect((saves.data.saves as { id: string }[]).map((s) => s.id)).toEqual([id]);
    const state = await call(local, "GET", `/saves/${id}/state`);
    expect(state.status).toBe(200);
    expect(state.data.version).toBe(0);
  });
});
