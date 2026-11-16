import { describe, expect, it } from "vitest";
import { applyHumanity, neuralStage } from "./apply";
import { humanity } from "./index";
import { HumanityCommandSchema } from "./schema";
import { applyBoost, install } from "../cyberware/apply";
import { cyberware } from "../cyberware/index";
import { CyberwareDefSchema } from "../cyberware/schema";
import { applyEpisode } from "../psychosis/apply";
import { psychosis } from "../psychosis/index";
import { fixedRng } from "../../kernel/rng";
import type { SystemContext } from "../../kernel/system";

describe("神经症状事实", () => {
  it("具体症状独立持续，恢复一处不会凭分数治疗其他症状", () => {
    const state = humanity.initial();
    applyHumanity(state, { type: "humanity", action: "affect", id: "ringing", stage: "unstable", symptom: "耳鸣", reason: "电极烧伤", event: "shock" }, 0);
    applyHumanity(state, { type: "humanity", action: "affect", id: "grief", stage: "detached", symptom: "抽离", reason: "亲友离世" }, 1);
    expect(neuralStage(state)).toBe("unstable");
    expect(applyHumanity(state, { type: "humanity", action: "affect", id: "ringing", stage: "edge", symptom: "耳鸣", reason: "同一事件", event: "shock" }, 2).ok).toBe(false);
    applyHumanity(state, { type: "humanity", action: "recover", id: "ringing", reason: "修复损坏电极后症状消失" }, 60);
    expect(neuralStage(state)).toBe("detached");
    expect(state.symptoms.map((s) => s.id)).toEqual(["grief"]);
    expect(state).not.toHaveProperty("current");
    expect(HumanityCommandSchema.safeParse({ type: "humanity", delta: -5, reason: "旧扣分" }).success).toBe(false);
  });
  it("安装和连续启动加速器不扣人性，不产生动作格配额", () => {
    const state = cyberware.initial();
    const def = CyberwareDefSchema.parse({ id: "sandy", name: "加速器", slot: "os", rarity: "legendary", price: 100, humanityCost: 20, ability: "加快神经与动作", accelerator: true });
    const catalog = new Map([[def.id, def]]);
    const fitted = install(state, def.id, catalog, 0);
    expect(fitted.ok && fitted.emit?.some((c) => c.type.startsWith("humanity"))).toBe(false);
    for (let i = 0; i < 8; i++) {
      const result = applyBoost(state, def.id, catalog, i, []);
      expect(result).toMatchObject({ ok: true });
      expect(result).not.toHaveProperty("emit");
    }
    expect(state.boost).toEqual({ id: "sandy", lastAt: 7 });
    expect(applyBoost(state, def.id, catalog, 8, [def.id]).ok).toBe(false);
  });
  it("同场新诱因可以发作，但同一事件不能重复记；场景本身不治疗", () => {
    const neural = humanity.initial();
    applyHumanity(neural, { type: "humanity", action: "affect", id: "sensory", stage: "edge", symptom: "持续失真", reason: "严重排异" }, 0);
    const state = psychosis.initial();
    const ctx: SystemContext = { rng: fixedRng([]), data: {}, facts: {}, now: 10,
      read: <T>(id: string) => (id === "humanity" ? neural : { scene: 1 }) as T };
    const event = { type: "episode", action: "start", trigger: "新的强烈刺激", severity: "mild", reason: "持续症状加剧", event: "trigger-1" } as const;
    expect(applyEpisode(state, event, ctx).ok).toBe(true);
    expect(applyEpisode(state, event, ctx).ok).toBe(false);
    expect(applyEpisode(state, { ...event, event: "trigger-2" }, ctx).ok).toBe(true);
    expect(psychosis.on?.["scene.end"]).toBeUndefined();
  });
});
