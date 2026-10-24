import { LifepathEntrySchema } from "@cp/core";

/** 生命路径表：掷过往时按出身加权，没写的出身按 1；权重暂定，试玩后再调 */
export const lifepath = LifepathEntrySchema.array().parse([
  { id: "arasaka-ex", weights: { corpo: 4, "street-kid": 0.5, nomad: 0.3 } },
  { id: "betrayed-arasaka", weights: { corpo: 3, "street-kid": 0.5, nomad: 0.5 } },
  { id: "gang-runner", weights: { "street-kid": 4, nomad: 1, corpo: 0.3 } },
  { id: "clinic-apprentice", weights: { "street-kid": 2 } },
  { id: "netrunner-self-taught", weights: { "street-kid": 1.5, corpo: 1.5 } },
  { id: "ex-ncpd", weights: { "street-kid": 1, corpo: 1, nomad: 0.3 } },
  { id: "merc-crew", weights: { "street-kid": 2, nomad: 2 } },
  { id: "braindance-editor", weights: { "street-kid": 1.5, corpo: 1 } },
  { id: "pit-fighter", weights: { "street-kid": 2.5, nomad: 1.5, corpo: 0.3 } },
  { id: "smuggler", weights: { nomad: 4, "street-kid": 1.5, corpo: 0.3 } },
]);
