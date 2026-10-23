import { type AnySystem, createRegistry } from "../kernel/system";
import { combat } from "./combat";
import { dice } from "./dice";
import { health } from "./health";
import { humanity } from "./humanity";
import { inventory } from "./inventory";
import { world } from "./world";

/** 所有游戏系统；新系统在这里登记，顺序无关，结算顺序由 dependsOn 决定 */
export const systems: readonly AnySystem[] = [dice, humanity, inventory, health, world, combat];

export const registry = createRegistry(systems);
