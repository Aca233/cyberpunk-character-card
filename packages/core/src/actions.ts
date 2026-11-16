/** 玩家在界面上直接做的操作：不调用模型，结算后作为 action 记录写进日志 */
import type { Patch } from "immer";
import { z } from "zod";
import type { ApplyContext, Command } from "./kernel/system";
import type { WorldState } from "./kernel/world";
import { BraindanceActionSchema } from "./systems/braindance";
import { HabitActionSchema } from "./systems/character";
import { EndStoryActionSchema } from "./systems/chronicle";
import {
  BuyCyberwareActionSchema,
  RemoveCyberwareActionSchema,
  RepairCyberwareActionSchema,
  RepayRipperdocActionSchema,
} from "./systems/cyberware";
import {
  BuyItemActionSchema,
  EquipItemActionSchema,
  ModWeaponActionSchema,
  OutfitActionSchema,
  SellItemActionSchema,
  UnequipItemActionSchema,
  UseHealingActionSchema,
} from "./systems/inventory";
import { EditMemoryActionSchema } from "./systems/memory";
import { ScanNpcActionSchema } from "./systems/npc";
import { AnswerCallActionSchema, ReadMessagesActionSchema } from "./systems/phone";
import { UseSuppressantActionSchema } from "./systems/psychosis";
import { registry } from "./systems/registry";
import { BuyHomeActionSchema, StashActionSchema } from "./systems/safehouse";
import { ReadShardsActionSchema } from "./systems/shards";
import { SquadActionSchema } from "./systems/squad";

export const PlayerActionSchema = z.discriminatedUnion("type", [
  /** 在义体医生那里买一件装上；部位装满了（SLOT_CAPACITY）才换下最早装的那件折价；credit 是钱不够时赊账 */
  BuyCyberwareActionSchema,
  /** 请义体医生卸下一件，医生折价回收 */
  RemoveCyberwareActionSchema,
  /** 还清欠义体医生的钱 */
  RepayRipperdocActionSchema,
  /** 请义体医生修好一件打坏的义体 */
  RepairCyberwareActionSchema,
  /** 从背包装上一件：治疗品和手雷进快捷栏，服装穿到对应的格子 */
  EquipItemActionSchema,
  /** 非战斗时使用当前治疗品，回复生命并扣除一次使用次数 */
  UseHealingActionSchema,
  /** 非战斗时在背包主动注射神经压制剂 */
  UseSuppressantActionSchema,
  /** 把装备栏里穿着的一件脱下放回背包 */
  UnequipItemActionSchema,
  /** 存放箱和后备箱：store 从背包放进去，take 拿回背包；where 写安全屋 id 或车的 id */
  StashActionSchema,
  /** 整套外观：save 存下身上穿着的，wear 照存下的一次换好 */
  OutfitActionSchema,
  /** 改装件：attach 从背包装到武器上，detach 拆下放回背包 */
  ModWeaponActionSchema,
  /** 小队面板：accept、decline 回应入队请求，dismiss 请队员离开，pay 发雇佣型队员的薪水 */
  SquadActionSchema,
  /** 在商店买一件，放进背包 */
  BuyItemActionSchema,
  /** 把背包里的一件卖给商店 */
  SellItemActionSchema,
  /** 买下一处公寓：人要在那个地点，一次付清，之后就是自己的安全屋 */
  BuyHomeActionSchema,
  /** 打开消息：没给 feed 时把人发来的消息都标成已读；给了只标这几条 */
  ReadMessagesActionSchema,
  /** 全息电话来电：接起或拒接正在响的那通 */
  AnswerCallActionSchema,
  /** 角色卡上的习惯：add 自己写一条，confirm 认下叙事模型的提议，dismiss 不要这条提议，remove 删掉 */
  HabitActionSchema,
  /**
   * 记忆面板：改写或删掉一条场景摘要（what scene，写 scene）或共同记忆（what bond，写 npc 和 index）；
   * before 是玩家看到的原文，对不上就不改；每次修改都记进修改记录
   */
  EditMemoryActionSchema,
  /** 履历页：玩家给这个角色的故事收尾（退休或停在这里），之后存档只读，角色进传说名册 */
  EndStoryActionSchema,
  /** 超梦体验编辑器：标出一个线索点，看它的扫描结果；下结论走回合（input.braindance） */
  BraindanceActionSchema,
  /** 数据库页：打开芯片，只标这几块已读 */
  ReadShardsActionSchema,
  /** 在场的人：点「扫描」立刻用义眼扫一下，不调用模型、不花时间；要人在场、义眼装着没坏（计划第十二节第 14 条） */
  ScanNpcActionSchema,
]);
export type PlayerAction = z.infer<typeof PlayerActionSchema>;

/** POST /api/saves/:id/actions 的请求体 */
export const ActionRequestSchema = z.strictObject({
  requestId: z
    .string()
    .regex(/^[A-Za-z0-9_-]{8,64}$/, "requestId 只能是 8–64 位字母、数字、- 或 _"),
  baseVersion: z.number().int().min(0),
  action: PlayerActionSchema,
});
export type ActionRequest = z.infer<typeof ActionRequestSchema>;

/** 每种操作对应的指令：按注册表找到交出这个操作的系统，由它翻成指令。返回字符串表示操作不成立 */
function commandsFor(
  world: WorldState,
  action: PlayerAction,
  data: Readonly<Record<string, unknown>>,
): Command[] | string {
  return registry.actionCommands(action, { world, data });
}

export type ActionResult =
  | {
      readonly ok: true;
      readonly world: WorldState;
      readonly commands: readonly Command[];
      readonly notes: readonly string[];
      readonly patches: readonly Patch[];
    }
  | { readonly ok: false; readonly reason: string };

/** 结算一个界面操作；任何一条指令不生效，整个操作都不生效 */
export function applyPlayerAction(
  world: WorldState,
  action: PlayerAction,
  ctx: ApplyContext,
): ActionResult {
  const commands = commandsFor(world, action, ctx.data ?? {});
  if (typeof commands === "string") return { ok: false, reason: commands };
  const parsed: Command[] = [];
  for (const raw of commands) {
    const result = registry.parseInternal(raw);
    if (!result.ok) return { ok: false, reason: result.error };
    parsed.push(result.command);
  }
  const applied = registry.applyCommands(world, parsed, ctx);
  const notes: string[] = [];
  for (const { result } of applied.results) {
    if (!result.ok) return { ok: false, reason: result.reason };
    notes.push(...result.notes);
  }
  return { ok: true, world: applied.world, commands: parsed, notes, patches: applied.patches };
}
