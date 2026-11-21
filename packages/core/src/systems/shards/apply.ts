import type { Draft } from "immer";
import type { ApplyOutcome, Command, SystemContext } from "../../kernel/system";
import { type CyberwareState, cyberwareCatalog } from "../cyberware";
import { rulingFact } from "../dice";
import type { HackingState } from "../hacking";
import type { HealthState } from "../health";
import { type InventoryState, type ItemDef, itemCatalog } from "../inventory";
import type { WorldClockState } from "../world";
import {
  CHIP_ENCRYPTION_LABELS,
  CHIP_HAZARD_LABELS,
  type ChipCommand,
  type ChipContent,
  ChipContentSchema,
  NEURAL_CHIP_SLOTS,
  type ShardCommand,
  type ShardsState,
} from "./schema";

/** 固定内容与存档中新确立的资料共用稳定身份；不允许覆盖目录。 */
export function chipContentCatalog(
  data: Readonly<Record<string, unknown>>,
  state?: Pick<ShardsState, "contents">,
): ReadonlyMap<string, ChipContent> {
  const result = new Map<string, ChipContent>();
  const rows = data.chipContents ?? [];
  if (!Array.isArray(rows)) throw new Error("data.chipContents 必须是固定芯片内容数组");
  for (const raw of rows) {
    const content = ChipContentSchema.parse(raw);
    if (result.has(content.id)) throw new Error(`芯片内容 id 重复：${content.id}`);
    result.set(content.id, content);
  }
  for (const content of Object.values(state?.contents ?? {})) {
    if (result.has(content.id)) throw new Error(`存档芯片内容与目录冲突：${content.id}`);
    result.set(content.id, content);
  }
  return result;
}

export function heldChipDefinition(
  inventory: InventoryState,
  data: Readonly<Record<string, unknown>>,
  id: string,
): ItemDef | undefined {
  if (!(inventory.backpack[id] ?? 0)) return undefined;
  const object = inventory.objects[id];
  if (object && object.holder !== "player") return undefined;
  return object?.definition ?? (data.items ? itemCatalog(data).get(id) : undefined);
}

function heldDefinition(ctx: SystemContext, id: string): ItemDef | undefined {
  return heldChipDefinition(ctx.read<InventoryState>("inventory"), ctx.data, id);
}

function hasIntactDeck(ctx: SystemContext, deviceId?: string): boolean {
  const installed = ctx.read<CyberwareState>("cyberware").installed;
  const broken = ctx.read<HealthState>("health").brokenChrome;
  const deckId = ctx.read<HackingState>("hacking").deck;
  if (deviceId) {
    return (
      installed.some((chrome) => chrome.id === deviceId) &&
      !broken.includes(deviceId) &&
      deckId === deviceId
    );
  }
  return !!deckId && installed.some((c) => c.id === deckId) && !broken.includes(deckId);
}

function readerDeviceAvailable(ctx: SystemContext, id: string, writing = false): boolean {
  const def = heldDefinition(ctx, id);
  if (def?.chipDevice === "reader-writer" || (!writing && def?.chipDevice === "reader")) {
    return true;
  }
  return !writing && hasIntactDeck(ctx, id);
}

function contentFor(draft: ShardsState, ctx: SystemContext, carrier: string) {
  const definition = heldDefinition(ctx, carrier);
  if (!definition)
    return { error: "没有实际随身携带这块芯片，须先按真实归属取回或拿到手" } as const;
  const content = definition.chipContentId
    ? chipContentCatalog(ctx.data, draft).get(definition.chipContentId)
    : undefined;
  if (!content) return { error: "载体尚未关联已确立的内容，先 define 登记或确认来源" } as const;
  return { definition, content } as const;
}

export function intactBehaviorDevice(
  installed: readonly { readonly id: string }[],
  broken: readonly string[],
  data: Readonly<Record<string, unknown>>,
): string | undefined {
  if (!data.cyberware) return undefined;
  const catalog = cyberwareCatalog(data);
  return installed.find((c) => catalog.get(c.id)?.behaviorChip && !broken.includes(c.id))?.id;
}

function behaviorDeviceFromCtx(ctx: SystemContext): string | undefined {
  return intactBehaviorDevice(
    ctx.read<CyberwareState>("cyberware").installed,
    ctx.read<HealthState>("health").brokenChrome,
    ctx.data,
  );
}

export function readableChipPart(
  state: ShardsState,
  carrier: string,
  content: ChipContent,
  partId: string,
): boolean {
  const found = content.parts.find((candidate) => candidate.id === partId);
  if (!found) return false;
  if (!found.encrypted) return true;
  return !!state.unlocked[carrier]?.includes(partId);
}

export function activeChipHazard(
  state: ShardsState,
  carrier: string,
  content: ChipContent,
): ChipContent["hazard"] {
  if (content.hazard === "none") return "none";
  return state.cleansed.includes(carrier) ? "none" : content.hazard;
}

/** 清理已不在背包中或失去完好行为芯片义体支持的神经槽记录 */
export function pruneSlots(draft: Draft<ShardsState>, ctx: SystemContext) {
  const contents = chipContentCatalog(ctx.data, draft);
  const hasBehavior = Boolean(behaviorDeviceFromCtx(ctx));
  draft.slots = draft.slots.filter((slot) => {
    if (!heldDefinition(ctx, slot.carrier)) return false;
    const content = contents.get(slot.contentId);
    if (content?.category === "behavior" && !hasBehavior) return false;
    return true;
  });
}

/** 原文按内容和分段去重；已读知识不随实物交出、复制或档案数量增长消失。 */
export function applyShard(
  draft: Draft<ShardsState>,
  command: ShardCommand,
  now: number,
  location: string | null = null,
): ApplyOutcome {
  const existing = draft.shards.find(
    (s) => s.contentId === command.contentId && s.partId === command.partId,
  );
  if (existing)
    return existing.text === command.text &&
      existing.title === command.title &&
      existing.kind === command.kind &&
      existing.from === (command.from ?? null) &&
      JSON.stringify(existing.media ?? []) === JSON.stringify(command.media ?? [])
      ? { ok: true }
      : { ok: false, reason: "该资料片段已经定稿，重读不能改写原文、媒体、来源或标题" };
  const previous = draft.shards.find((s) => s.contentId === command.contentId);
  if (
    previous &&
    (previous.title !== command.title ||
      previous.kind !== command.kind ||
      previous.from !== (command.from ?? null))
  )
    return { ok: false, reason: "同一内容的后续分段须沿用已确立的标题、类别和来源" };
  draft.shards.push({
    id: draft.nextShard++,
    contentId: command.contentId,
    partId: command.partId,
    carrier: command.carrier ?? null,
    category: command.category,
    kind: command.kind,
    title: command.title,
    from: command.from ?? null,
    text: command.text,
    ...(command.media ? { media: command.media } : {}),
    at: now,
    location,
    related: [...command.related],
    read: false,
  });
  return { ok: true };
}

export function applyChip(
  draft: Draft<ShardsState>,
  command: ChipCommand,
  ctx: SystemContext,
): ApplyOutcome {
  pruneSlots(draft, ctx);

  if (command.action === "define") {
    if (rulingFact(ctx.facts)?.kind === "blocked") {
      return { ok: false, reason: "本轮裁决已判定写入受阻，未能登记或刻录芯片内容" };
    }
    if (chipContentCatalog(ctx.data, draft).has(command.content.id))
      return { ok: false, reason: "该内容身份已经确立，不能重新登记或覆盖" };
    const carrier = heldDefinition(ctx, command.carrier);
    if (!carrier) return { ok: false, reason: "资料载体不在实际随身物品中" };
    if (carrier.chipContentId && carrier.chipContentId !== command.content.id)
      return { ok: false, reason: "载体已经承载另一份内容，不能悄悄覆盖" };
    if (!carrier.chipContentId && !carrier.chipStorage)
      return { ok: false, reason: "这件物品不具备芯片存储条件" };
    if (
      !carrier.chipContentId &&
      (!command.device || !readerDeviceAvailable(ctx, command.device, true))
    )
      return { ok: false, reason: "向空白载体写入新内容需要实际可用的读写器" };
    draft.contents[command.content.id] = command.content;
    return {
      ok: true,
      ...(carrier.chipContentId
        ? {}
        : {
            emit: [
              {
                type: "inventory.chipWrite",
                destination: command.carrier,
                contentId: command.content.id,
                title: command.content.title,
                reason: command.reason ?? `写入内容：${command.content.title}`,
              },
            ],
          }),
    };
  }

  if (command.action === "unequip") {
    const index = draft.slots.findIndex((s) => s.carrier === command.carrier);
    if (index < 0) return { ok: false, reason: "个人神经槽里目前没有插着这块芯片" };
    const [removed] = draft.slots.splice(index, 1);
    const catalog = chipContentCatalog(ctx.data, draft);
    const removedContent = removed ? catalog.get(removed.contentId) : undefined;
    const title = removedContent?.title ?? removed?.contentId ?? command.carrier;
    const emit: Command[] = [];
    if (removedContent?.category === "behavior") {
      const behaviorDevice = behaviorDeviceFromCtx(ctx);
      const chipState = behaviorDevice
        ? ctx.read<CyberwareState>("cyberware").behaviorChips?.[behaviorDevice]
        : undefined;
      const fallbackBehavior = draft.slots.find(
        (slot) => catalog.get(slot.contentId)?.category === "behavior",
      );
      if (
        behaviorDevice &&
        chipState?.mode === "protocol" &&
        (chipState.carrier === null || chipState.carrier === command.carrier)
      ) {
        if (fallbackBehavior) {
          const nextContent = catalog.get(fallbackBehavior.contentId);
          emit.push({
            type: "cyberware.behavior",
            device: behaviorDevice,
            action: "mode",
            mode: "protocol",
            protocol: nextContent?.protocol ?? nextContent?.title ?? fallbackBehavior.contentId,
            carrier: fallbackBehavior.carrier,
            reason: `拔出《${title}》，行为芯片切换为仍在槽内的《${nextContent?.title ?? fallbackBehavior.contentId}》`,
          });
        } else {
          emit.push({
            type: "cyberware.behavior",
            device: behaviorDevice,
            action: "mode",
            mode: "off",
            reason: `从个人神经槽拔出行为协议芯片《${title}》`,
          });
        }
      }
    }
    return {
      ok: true,
      notes: [`从神经芯片槽拔出《${title}》，其即时协议效果停止`],
      ...(emit.length ? { emit } : {}),
    };
  }

  if (rulingFact(ctx.facts)?.kind === "blocked") {
    return { ok: false, reason: "本轮裁决已判定该芯片操作受阻，未能完成" };
  }

  const resolved = contentFor(draft, ctx, command.carrier);
  if ("error" in resolved) return { ok: false, reason: resolved.error };
  const content = resolved.content;

  if (command.action === "inspect") {
    const def = heldDefinition(ctx, command.device);
    if (def?.chipDevice !== "reader-writer") {
      return { ok: false, reason: "沙盒查毒需要实际持有的隔离芯片读写器（chip-reader-writer）" };
    }
    if (!draft.inspected.includes(command.carrier)) draft.inspected.push(command.carrier);
    const hazard = activeChipHazard(draft, command.carrier, content);
    const lockedCount = content.parts.filter(
      (p) => !readableChipPart(draft, command.carrier, content, p.id),
    ).length;
    const eddiesNote =
      content.eddies > 0 && !draft.drained.includes(command.carrier)
        ? `；检测到 ${content.eddies} 欧元加密凭证`
        : "";
    return {
      ok: true,
      notes: [
        `隔离读写器查验《${content.title}》：加密 ${CHIP_ENCRYPTION_LABELS[content.encryption]}，隐患 ${CHIP_HAZARD_LABELS[hazard]}${lockedCount ? `，${lockedCount} 个加密分段未解开` : ""}${eddiesNote}`,
      ],
    };
  }

  if (command.action === "decrypt") {
    const deckOk = command.device
      ? hasIntactDeck(ctx, command.device) ||
        (readerDeviceAvailable(ctx, command.device, true) && hasIntactDeck(ctx))
      : hasIntactDeck(ctx);
    if (!deckOk) {
      return {
        ok: false,
        reason: "离线破译加密芯片需要完好的网络接入仓（可配合隔离芯片读写器沙盒操作）",
      };
    }
    const encryptedParts = content.parts.filter((p) => p.encrypted).map((p) => p.id);
    const wantedParts = command.parts && command.parts.length > 0 ? command.parts : encryptedParts;
    if (wantedParts.some((id) => !content.parts.some((p) => p.id === id))) {
      return { ok: false, reason: "请求的解密分段不存在" };
    }
    const notes: string[] = [];
    const emit: Command[] = [];
    if (wantedParts.length > 0) {
      draft.unlocked[command.carrier] = [
        ...new Set([...(draft.unlocked[command.carrier] ?? []), ...wantedParts]),
      ];
      notes.push(`已解开《${content.title}》的 ${wantedParts.length} 个加密分段`);
    }
    if (
      command.cleanHazard &&
      content.hazard !== "none" &&
      !draft.cleansed.includes(command.carrier)
    ) {
      draft.cleansed.push(command.carrier);
      notes.push(`已剥离《${content.title}》上的${CHIP_HAZARD_LABELS[content.hazard]}`);
    }
    if (command.extractEddies && content.eddies > 0) {
      if (draft.drained.includes(command.carrier)) {
        return { ok: false, reason: "这块信用芯片里的欧元已经被提空了" };
      }
      draft.drained.push(command.carrier);
      emit.push(
        {
          type: "money",
          delta: content.eddies,
          reason: `破译信用芯片：${content.title}`,
          event: `chip-eddies:${command.carrier}`,
        },
        {
          type: "inventory.chipDrain",
          carrier: command.carrier,
          reason: `已提取《${content.title}》内含 ${content.eddies} 欧元`,
        },
      );
      notes.push(`从《${content.title}》提取了 ${content.eddies} 欧元`);
    }
    if (!draft.inspected.includes(command.carrier)) draft.inspected.push(command.carrier);
    if (!notes.length) notes.push(`已完成《${content.title}》的破译校验`);
    return { ok: true, notes, ...(emit.length ? { emit } : {}) };
  }

  if (command.action === "equip") {
    if (content.category !== "skill" && content.category !== "behavior") {
      return {
        ok: false,
        reason:
          "只有技能协议（skill）或行为协议（behavior）芯片需要常驻插入个人神经槽；普通情报芯片直接 read 即可",
      };
    }
    if (draft.slots.some((s) => s.carrier === command.carrier)) {
      return { ok: true, notes: [`《${content.title}》已经插在个人神经槽里`] };
    }
    if (draft.slots.some((s) => s.contentId === content.id)) {
      return {
        ok: false,
        reason: `个人神经槽里已经运行着同款协议《${content.title}》，不能重复叠加`,
      };
    }
    if (draft.slots.length >= NEURAL_CHIP_SLOTS) {
      return {
        ok: false,
        reason: `个人颈后神经芯片槽已满（上限 ${NEURAL_CHIP_SLOTS} 槽），先 unequip 拔出一块再插`,
      };
    }
    if (content.parts.some((p) => !readableChipPart(draft, command.carrier, content, p.id))) {
      return { ok: false, reason: "芯片协议仍处于加密状态，需先 decrypt 解密后再插入运行" };
    }
    const emit: Command[] = [];
    if (content.category === "behavior") {
      const behaviorDevice = behaviorDeviceFromCtx(ctx);
      if (!behaviorDevice) {
        return {
          ok: false,
          reason:
            "运行行为协议芯片需要先在义体医生处安装完好的行为芯片植入体（doll-behavior-chip）",
        };
      }
      if (
        draft.slots.some(
          (slot) =>
            chipContentCatalog(ctx.data, draft).get(slot.contentId)?.category === "behavior",
        )
      ) {
        return {
          ok: false,
          reason: "行为芯片植入体一次只能加载一块行为协议芯片，请先 unequip 拔出当前行为芯片再换装",
        };
      }
      emit.push({
        type: "cyberware.behavior",
        device: behaviorDevice,
        action: "mode",
        mode: "protocol",
        protocol: content.protocol ?? content.title,
        carrier: command.carrier,
        reason: `插入行为协议芯片《${content.title}》`,
      });
    }
    const hazard = activeChipHazard(draft, command.carrier, content);
    draft.slots.push({ carrier: command.carrier, contentId: content.id, at: ctx.now });
    const hazardWarn =
      hazard !== "none"
        ? `；警告：该芯片仍携带未清除的${CHIP_HAZARD_LABELS[hazard]}，按本轮裁决结算反噬后果`
        : "";
    return {
      ok: true,
      notes: [
        `将《${content.title}》插入个人神经槽（已用 ${draft.slots.length}/${NEURAL_CHIP_SLOTS}）：${content.ability ?? content.summary}${hazardWarn}`,
      ],
      ...(emit.length ? { emit } : {}),
    };
  }

  if (command.action === "copy") {
    if (!readerDeviceAvailable(ctx, command.device, true))
      return { ok: false, reason: "没有实际可用的芯片读写器（chip-reader-writer），无法刻录副本" };
    if (command.carrier === command.destination)
      return { ok: false, reason: "复制来源和去向必须是不同的实际载体" };
    if (content.eddies > 0)
      return { ok: false, reason: "信用芯片内的加密欧元凭证有硬件序列绑定，不能通过复制凭空印钱" };
    const destination = heldDefinition(ctx, command.destination);
    if (!destination?.chipStorage)
      return { ok: false, reason: "刻录副本需要随身携带的空白存储芯片" };
    return {
      ok: true,
      emit: [
        {
          type: "inventory.chipWrite",
          source: command.carrier,
          destination: command.destination,
          contentId: content.id,
          title: content.title,
          reason: command.reason,
        },
      ],
    };
  }

  // action === "read"
  if (command.device && !readerDeviceAvailable(ctx, command.device)) {
    return { ok: false, reason: "指定的芯片读取设备不在手边或已损坏" };
  }
  if (command.parts.some((part) => !readableChipPart(draft, command.carrier, content, part))) {
    return { ok: false, reason: "请求包含不存在或尚未解密的分段，先 decrypt 破译后再读" };
  }
  const location = ctx.read<WorldClockState>("world").location;
  for (const id of [...new Set(command.parts)]) {
    const part = content.parts.find((entry) => entry.id === id);
    if (!part) continue;
    const result = applyShard(
      draft,
      {
        type: "shard",
        contentId: content.id,
        partId: part.id,
        carrier: command.carrier,
        category: content.category,
        kind: content.kind,
        title: content.title,
        ...(content.from ? { from: content.from } : {}),
        text: part.text,
        ...(part.media ? { media: part.media } : {}),
        related: content.related,
      },
      ctx.now,
      location,
    );
    if (!result.ok) return result;
  }
  const hazard = activeChipHazard(draft, command.carrier, content);
  const directSlot = !command.device;
  const hazardNote =
    directSlot && hazard !== "none"
      ? `；警告：未查毒直插触发了${CHIP_HAZARD_LABELS[hazard]}风险，实际神经/身体后果依本轮裁决记录`
      : "";
  return { ok: true, notes: [`已读取并归档《${content.title}》${hazardNote}`] };
}

/** 数据库界面打开旧资料：不推进时间，也不改变角色知识或载体归属。 */
export function readShards(draft: Draft<ShardsState>, ids: readonly number[]): ApplyOutcome {
  const wanted = new Set(ids);
  for (const shard of draft.shards) if (wanted.has(shard.id)) shard.read = true;
  return { ok: true };
}
