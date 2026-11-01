import { LifepathEntrySchema } from "@cp/core";

/**
 * 生命路径表：掷过往时按出身加权，没写的出身按 1；权重暂定，试玩后再调。
 * costs 是掷到这段后提出的代价（docs/creator-plan.md 第 2 步："给出 1–2 个跟这段经历沾边的代价，
 * 比如跟过佣兵小队 → 有仇家"），按每段过往的钩子挑的负面经历，同样暂定
 */
export const lifepath = LifepathEntrySchema.array().parse([
  {
    id: "arasaka-ex",
    weights: { corpo: 4, "street-kid": 0.5, nomad: 0.3 },
    costs: ["corpo-blacklist"],
  },
  {
    id: "betrayed-arasaka",
    weights: { corpo: 3, "street-kid": 0.5, nomad: 0.5 },
    costs: ["corpo-blacklist", "enemy"],
  },
  {
    id: "gang-runner",
    weights: { "street-kid": 4, nomad: 1, corpo: 0.3 },
    costs: ["debt", "enemy"],
  },
  { id: "clinic-apprentice", weights: { "street-kid": 2 }, costs: ["addiction", "debt"] },
  {
    id: "netrunner-self-taught",
    weights: { "street-kid": 1.5, corpo: 1.5 },
    costs: ["enemy", "wanted"],
  },
  {
    id: "ex-ncpd",
    weights: { "street-kid": 1, corpo: 1, nomad: 0.3 },
    costs: ["enemy", "wanted"],
  },
  { id: "merc-crew", weights: { "street-kid": 2, nomad: 2 }, costs: ["enemy", "old-wound"] },
  {
    id: "braindance-editor",
    weights: { "street-kid": 1.5, corpo: 1 },
    costs: ["enemy", "addiction"],
  },
  {
    id: "pit-fighter",
    weights: { "street-kid": 2.5, nomad: 1.5, corpo: 0.3 },
    costs: ["old-wound", "enemy"],
  },
  {
    id: "smuggler",
    weights: { nomad: 4, "street-kid": 1.5, corpo: 0.3 },
    costs: ["debt", "wanted"],
  },
]);
