import type { Draft } from "immer";
import type { ApplyOutcome } from "../../kernel/system";
import type { WorldState } from "../../kernel/world";
import { PHONE_KEPT, type PhoneState, PhoneStateSchema } from "./schema";

export function receiveMessage(
  draft: Draft<PhoneState>,
  from: string,
  name: string,
  text: string,
  now: number,
): ApplyOutcome {
  draft.messages.push({ id: draft.nextId, from, name, text, at: now, read: false, replied: false });
  draft.nextId += 1;
  while (draft.messages.length > PHONE_KEPT) draft.messages.shift();
  return { ok: true, notes: [`手机消息：${name}：${text}`] };
}

export function readAll(draft: Draft<PhoneState>): ApplyOutcome {
  let n = 0;
  for (const m of draft.messages) {
    if (!m.read) {
      m.read = true;
      n += 1;
    }
  }
  return { ok: true, notes: n > 0 ? [`看了 ${n} 条手机消息`] : [] };
}

export function replyMessage(draft: Draft<PhoneState>, id: number): ApplyOutcome {
  const m = draft.messages.find((x) => x.id === id);
  if (!m) return { ok: false, reason: `手机里没有第 ${id} 条消息` };
  m.read = true;
  m.replied = true;
  return { ok: true, notes: [`回复${m.name}的消息`] };
}

/** 后端在调模型前检查：要回复的消息得还在手机里 */
export function replyBlock(world: WorldState, id: number): string | undefined {
  const phone = PhoneStateSchema.parse(world.slices.phone ?? {});
  return phone.messages.some((m) => m.id === id) ? undefined : `手机里没有第 ${id} 条消息`;
}
