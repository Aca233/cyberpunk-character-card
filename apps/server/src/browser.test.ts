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
  it("空数据库：第一次打开就有一份空配置，示例角色能列出来", async () => {
    const local = await backend();
    const health = await call(local, "GET", "/health");
    expect(health.status).toBe(200);
    // 浏览器版没有「文件」，启动时直接照示例建好 config.json
    expect(health.data.config).toBe("ok");
    const models = health.data.models as { ready: boolean; narrator: { error: string | null } };
    expect(models.ready).toBe(false);
    expect(models.narrator.error).toContain("还没有选叙事模型");
    const characters = await call(local, "GET", "/characters");
    expect(characters.status).toBe(200);
    expect((characters.data.characters as unknown[]).length).toBeGreaterThan(0);
  });

  it("示例配置不带任何连接，加一条就能设成叙事模型", async () => {
    const local = await backend();
    const profiles = await call(local, "GET", "/profiles");
    expect(profiles.status).toBe(200);
    expect(profiles.data.status).toBe("ok");
    expect(profiles.data.profiles).toEqual([]);
    expect(profiles.data.narrator).toBeUndefined();
    // 启动时已经建过了，这里再建会被拒绝
    expect((await call(local, "POST", "/profiles/-/init")).status).toBe(409);

    const created = await call(local, "POST", "/profiles", {
      name: "mine",
      type: "openai",
      baseUrl: "https://example.com/v1",
      model: "demo-model",
      contextWindow: 8192,
    });
    expect(created.status).toBe(200);
    expect((await call(local, "PUT", "/profiles/-/roles", { narrator: "mine" })).status).toBe(200);

    const after = await call(local, "GET", "/profiles");
    expect(after.data.narrator).toBe("mine");
    expect(after.data.aux).toBeUndefined();
    expect((after.data.profiles as { keyStatus: string }[])[0]?.keyStatus).toBe("missing");
  });

  it("建存档、列出、读状态都走 IndexedDB", async () => {
    const local = await backend();
    const created = await call(local, "POST", "/saves", {
      title: "本地存档",
      characterId: "sample-1",
    });
    expect(created.status).toBe(201);
    const id = String(created.data.id);
    const saves = await call(local, "GET", "/saves");
    expect((saves.data.saves as { id: string }[]).map((s) => s.id)).toEqual([id]);
    const state = await call(local, "GET", `/saves/${id}/state`);
    expect(state.status).toBe(200);
    expect(state.data.version).toBe(0);
  });

  it("一个后端导出的存档能导入另一个全新的浏览器后端（服务器版换到网页版也走这条）", async () => {
    const from = await backend();
    const created = await call(from, "POST", "/saves", {
      title: "要搬走的存档",
      characterId: "sample-1",
    });
    const exported = await call(from, "GET", `/saves/${String(created.data.id)}/export`);
    expect(exported.status).toBe(200);

    const to = await backend();
    expect(((await call(to, "GET", "/saves")).data.saves as unknown[]).length).toBe(0);
    const imported = await call(to, "POST", "/saves/import", exported.data);
    expect(imported.status).toBeLessThan(300);
    const id = String(imported.data.id);
    const saves = await call(to, "GET", "/saves");
    expect((saves.data.saves as { id: string; title: string }[]).map((s) => s.id)).toEqual([id]);
    const state = await call(to, "GET", `/saves/${id}/state`);
    expect(state.status).toBe(200);
  });
});
