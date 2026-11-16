import { describe, expect, it } from "vitest";
import { applyNpc } from "./apply";
import { applyNpcBody, applyNpcCondition, sanitizeNpcBody, currentVitals, bodyView } from "./body";
import { NpcSchema, type NpcState } from "./schema";
import { ItemDefSchema } from "../inventory/schema";

function person() {
  return NpcSchema.parse({ id: "resident", name: "阿黎", pronoun: "她", role: "修理工", look: "沾着机油", voice: "直说", want: "修好门", limit: "不拆他人义体", affinity: 0, alive: true, met: true, location: "garage", lastSeenAt: 0, memories: [], body: { gear: [], cyberware: [] } });
}

describe("NPC 的身体与物件持续存在", () => {
  it("浅伤不按次数扣死人物；未治疗重伤不靠跨场等待消失", () => {
    const npc = person();
    for (let i = 0; i < 12; i++) applyNpcBody(npc, { type: "npcHurt", id: npc.id, tier: "graze", part: "left-arm", reason: "擦伤" }, i, {});
    expect(npc.vitals?.condition).toBe("up");
    expect(npc.vitals?.injuries).toHaveLength(12);
    expect(npc.vitals).not.toHaveProperty("hp");
    applyNpcBody(npc, { type: "npcHurt", id: npc.id, tier: "heavy", part: "right-leg", reason: "骨折" }, 20, {});
    const later = currentVitals(npc, {}, 10 * 1440);
    expect(later.injuries).toHaveLength(1);
    expect(later.injuries[0]).toMatchObject({ cause: "骨折", treated: false, healsAt: null });
  });
  it("治疗稳定濒死者后仍留伤口，达到恢复期才消失", () => {
    const npc = person();
    applyNpcBody(npc, { type: "npcHurt", id: npc.id, tier: "lethal", part: "chest", reason: "贯穿伤" }, 0, {});
    expect(currentVitals(npc, {}, 100).condition).toBe("dying");
    applyNpcBody(npc, { type: "npcHeal", id: npc.id, how: "ripperdoc", reason: "抢救与清创" }, 100, {});
    expect(currentVitals(npc, {}, 100)).toMatchObject({ condition: "up", injuries: [{ treated: true, healsAt: 100 + 7 * 1440 }] });
    expect(currentVitals(npc, {}, 100 + 7 * 1440).injuries).toEqual([]);
  });
  it("昏迷事实不伪造伤口，状态指令不能复活或绕过致命伤", () => {
    const npc = person();
    expect(applyNpcCondition(npc, { type: "npc.condition", id: npc.id, condition: "down", reason: "被击昏" }, 0, {}).ok).toBe(true);
    expect(npc.vitals).toMatchObject({ condition: "down", injuries: [] });
    applyNpcBody(npc, { type: "npcHurt", id: npc.id, tier: "lethal", reason: "胸口贯穿伤" }, 1, {});
    applyNpcCondition(npc, { type: "npc.condition", id: npc.id, condition: "down", reason: "倒地" }, 2, {});
    expect(npc.vitals?.condition).toBe("dying");
    expect(applyNpcCondition(npc, { type: "npc.condition", id: npc.id, condition: "up", reason: "试图直接站起" }, 3, {}).ok).toBe(false);
    npc.alive = false;
    expect(applyNpcCondition(npc, { type: "npc.condition", id: npc.id, condition: "up", reason: "试图复活" }, 4, {}).ok).toBe(false);
  });
  it("实际神经症状有稳定身份，恢复仅处理指定症状", () => {
    const npc = person();
    applyNpcBody(npc, { type: "npcHumanity", id: npc.id, action: "affect", symptomId: "rejection", stage: "edge", symptom: "持续幻听", reason: "义眼接口损坏" }, 0, {});
    applyNpcBody(npc, { type: "npcScan", id: npc.id }, 1, {});
    expect(bodyView(npc, {}, 1).scan?.humanityStage).toBe("边缘");
    expect(applyNpcBody(npc, { type: "npcHumanity", id: npc.id, action: "recover", symptomId: "unknown", reason: "未发生的恢复" }, 2, {}).ok).toBe(false);
    applyNpcBody(npc, { type: "npcHumanity", id: npc.id, action: "recover", symptomId: "rejection", reason: "修复受损接口" }, 3, {});
    expect(bodyView(npc, {}, 3).scan?.humanityStage).toBe("稳定");
  });
  it("人物装备与补卡不能复制玩家持有的唯一物件", () => {
    const npc = person();
    const data = { items: [ItemDefSchema.parse({ id: "unique-key", name: "唯一钥匙", kind: "misc" })], worldObjects: { "unique-key": { holder: "player" } } };
    expect(applyNpcBody(npc, { type: "npcGear", id: npc.id, action: "add", item: "unique-key" }, 0, data).ok).toBe(false);
    const notes: string[] = [];
    expect(sanitizeNpcBody({ gear: ["unique-key"], cyberware: [] }, data, notes, npc.id).gear).toEqual([]);
    expect(notes[0]).toContain("不能在人物卡中复制");
    expect(applyNpcBody(npc, { type: "npcGear", id: npc.id, action: "add", item: "unique-key" }, 0, { ...data, worldObjects: { "unique-key": { holder: npc.id } } }).ok).toBe(true);
  });
  it("死者实际持有的物品能被移除一次，但不会给死者添加新东西", () => {
    const npc = person();
    npc.alive = false;
    npc.body = { gear: ["token"], cyberware: [] };
    const state: NpcState = { npcs: { [npc.id]: npc } };
    const data = { items: [ItemDefSchema.parse({ id: "token", name: "钥匙牌", kind: "misc", rarity: "common", price: 0, note: "旧门的钥匙牌" })] };
    expect(applyNpc(state, { type: "npcGear", id: npc.id, action: "remove", item: "token" }, 5, {}, data).ok).toBe(true);
    expect(applyNpc(state, { type: "npcGear", id: npc.id, action: "remove", item: "token" }, 6, {}, data).ok).toBe(false);
    expect(applyNpc(state, { type: "npcGear", id: npc.id, action: "add", item: "token" }, 6, {}, data).ok).toBe(false);
  });
});
