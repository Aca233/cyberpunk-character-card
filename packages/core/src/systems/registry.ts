import { type AnySystem, createRegistry } from "../kernel/system";
import { dice } from "./dice";
import { humanity } from "./humanity";

/** 所有游戏系统；新系统在这里登记，顺序无关，结算顺序由 dependsOn 决定 */
export const systems: readonly AnySystem[] = [dice, humanity];

export const registry = createRegistry(systems);
