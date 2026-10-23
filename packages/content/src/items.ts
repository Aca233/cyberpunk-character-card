import { inventoryRules } from "@cp/core";

/** M1 的物品表：少量武器和治疗品；数值照原作 2.0 核对后再调 */
export const items = inventoryRules.ItemCatalogSchema.parse([
  { id: "unity", name: "Unity 手枪", kind: "weapon", attribute: "reflexes", price: 300 },
  { id: "lexington", name: "列克星敦手枪", kind: "weapon", attribute: "reflexes", price: 250 },
  { id: "copperhead", name: "铜斑蛇突击步枪", kind: "weapon", attribute: "reflexes", price: 900 },
  { id: "carnage", name: "卡内基霰弹枪", kind: "weapon", attribute: "body", price: 1100 },
  { id: "baseball-bat", name: "棒球棍", kind: "weapon", attribute: "body", price: 60 },
  { id: "knife", name: "折叠刀", kind: "weapon", attribute: "reflexes", price: 80 },
  { id: "maxdoc", name: "MaxDoc Mk.1", kind: "healing", charges: 2, healPercent: 40, price: 150 },
  {
    id: "bounce-back",
    name: "Bounce Back",
    kind: "healing",
    charges: 3,
    healPercent: 20,
    price: 100,
  },
  { id: "frag-grenade", name: "破片手雷", kind: "grenade", charges: 2, price: 200 },
  { id: "shard", name: "数据芯片", kind: "misc" },
]);
