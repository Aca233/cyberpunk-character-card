import type { Draft } from "immer";
import type { ApplyOutcome, SystemContext } from "../../kernel/system";
import { tradeEvidence } from "../commerce";
import type { CyberwareState } from "../cyberware";
import { rulingFact } from "../dice";
import type { HackingState } from "../hacking";
import type { HealthState } from "../health";
import { type InventoryState, type ItemDef, itemCatalog } from "../inventory";
import type { WorldClockState } from "../world";
import {
  type ChipCommand,
  type ChipContent,
  ChipContentSchema,
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

function heldDefinition(ctx: SystemContext, id: string): ItemDef | undefined {
  const inventory = ctx.read<InventoryState>("inventory");
  if (!(inventory.backpack[id] ?? 0)) return undefined;
  const object = inventory.objects[id];
  if (object && object.holder !== "player") return undefined;
  return object?.definition ?? (ctx.data.items ? itemCatalog(ctx.data).get(id) : undefined);
}

function deviceAvailable(ctx: SystemContext, id: string, writing = false): boolean {
  const def = heldDefinition(ctx, id);
  if (def?.chipDevice === "reader-writer" || (!writing && def?.chipDevice === "reader"))
    return true;
  const installed = ctx.read<CyberwareState>("cyberware").installed;
  const broken = ctx.read<HealthState>("health").brokenChrome;
  return (
    installed.some((chrome) => chrome.id === id) &&
    !broken.includes(id) &&
    ctx.read<HackingState>("hacking").deck === id
  );
}

function contentFor(draft: ShardsState, ctx: SystemContext, carrier: string) {
  const definition = heldDefinition(ctx, carrier);
  if (!definition) return { error: "没有实际随身携带这块芯片，须先按真实归属取回或借到" } as const;
  const content = definition.chipContentId
    ? chipContentCatalog(ctx.data, draft).get(definition.chipContentId)
    : undefined;
  if (!content) return { error: "载体尚未关联已确立的内容，不能凭追问临时编造原文" } as const;
  return { definition, content } as const;
}

export function readableChipPart(state: ShardsState, content: ChipContent, part: string): boolean {
  const found = content.parts.find((candidate) => candidate.id === part);
  return !!found && (!found.protectionNetwork || !!state.unlocked[content.id]?.includes(part));
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
  if (command.action === "define") {
    if (!tradeEvidence(ctx.facts, command.evidence))
      return { ok: false, reason: "登记资料缺少本轮正文中实际来源的证据" };
    if (chipContentCatalog(ctx.data, draft).has(command.content.id))
      return { ok: false, reason: "该内容身份已经确立，不能重新登记或覆盖" };
    const carrier = heldDefinition(ctx, command.carrier);
    if (!carrier) return { ok: false, reason: "资料载体不在实际随身物品中" };
    if (carrier.chipContentId && carrier.chipContentId !== command.content.id)
      return { ok: false, reason: "载体已经承载另一份内容，不能悄悄覆盖" };
    if (!carrier.chipContentId && !carrier.chipStorage)
      return { ok: false, reason: "这件物品不具备芯片存储条件" };
    if (!carrier.chipContentId && (!command.device || !deviceAvailable(ctx, command.device, true)))
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
                reason: command.evidence,
              },
            ],
          }),
    };
  }
  const resolved = contentFor(draft, ctx, command.carrier);
  if ("error" in resolved) return { ok: false, reason: resolved.error };
  const content = resolved.content;
  if (command.action === "unlock") {
    const network = ctx
      .read<HackingState>("hacking")
      .breachedNetworks.find(
        (entry) =>
          entry.name === command.network &&
          entry.gains.includes("data") &&
          entry.location === ctx.read<WorldClockState>("world").location,
      );
    if (!network || rulingFact(ctx.facts)?.kind === "blocked")
      return { ok: false, reason: "未实际取得这块芯片保护网络的数据权限，不能宣称解密成功" };
    if (
      command.parts.some(
        (part) => content.parts.find((p) => p.id === part)?.protectionNetwork !== command.network,
      )
    )
      return { ok: false, reason: "所解分段不属于该保护网络" };
    draft.unlocked[content.id] = [
      ...new Set([...(draft.unlocked[content.id] ?? []), ...command.parts]),
    ];
    return { ok: true, notes: ["实际解开的部分已保存；解开不等于已经阅读"] };
  }
  if (command.action === "copy") {
    if (!deviceAvailable(ctx, command.device, true))
      return { ok: false, reason: "没有实际可用的芯片读写器，无法制作副本" };
    if (command.carrier === command.destination)
      return { ok: false, reason: "复制来源和去向必须是不同的实际载体" };
    const destination = heldDefinition(ctx, command.destination);
    if (!destination?.chipStorage) return { ok: false, reason: "副本需要实际持有的存储载体" };
    return {
      ok: true,
      emit: [
        {
          type: "inventory.chipWrite",
          source: command.carrier,
          destination: command.destination,
          contentId: content.id,
          reason: command.reason,
        },
      ],
    };
  }
  if (command.action === "use") {
    if (content.purpose !== "function")
      return {
        ok: false,
        reason:
          "只有功能辅助芯片使用 chip use；行为芯片须按真实安装与本人模式启用，作品按实际播放处理",
      };
    const installed = ctx.read<CyberwareState>("cyberware").installed;
    const broken = ctx.read<HealthState>("health").brokenChrome;
    if (
      !content.requirements.length ||
      content.requirements.some(
        (id) =>
          !heldDefinition(ctx, id) &&
          !installed.some((chrome) => chrome.id === id && !broken.includes(id)),
      )
    )
      return { ok: false, reason: "缺少这块功能芯片要求的实际设备或完好接口，不能凭持有获得能力" };
    if (content.parts.some((part) => !readableChipPart(draft, content, part.id)))
      return { ok: false, reason: "功能资料仍有保护部分，需先实际解开" };
    return {
      ok: true,
      notes: [
        `本次辅助：${content.ability ?? content.summary}；用途：${command.reason}。不增加属性或永久技能。`,
      ],
    };
  }
  if (!deviceAvailable(ctx, command.device))
    return { ok: false, reason: "没有实际可用的芯片读取设备" };
  if (command.parts.some((part) => !readableChipPart(draft, content, part)))
    return { ok: false, reason: "请求包含不存在或尚未解开的内容，不能写入角色知识" };
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
  return { ok: true, notes: ["实际读到的原文已归档；文件说法不自动成为世界真相"] };
}

/** 数据库界面打开旧资料：不推进时间，也不改变角色知识或载体归属。 */
export function readShards(draft: Draft<ShardsState>, ids: readonly number[]): ApplyOutcome {
  const wanted = new Set(ids);
  for (const shard of draft.shards) if (wanted.has(shard.id)) shard.read = true;
  return { ok: true };
}
