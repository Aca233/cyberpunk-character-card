import { type AnySystem, createRegistry } from "../kernel/system";

/** 所有游戏系统；新系统在这里登记，顺序无关，结算顺序由 dependsOn 决定 */
export const systems: readonly AnySystem[] = [];

export const registry = createRegistry(systems);
