import { type ActionRecord, effectiveTurns, type LogRecord, voidedSeqs } from "./kernel/turnlog";

/**
 * 玩家在界面上直接点击完成的、且在游戏世界里真实发生的行为。
 * 排除纯界面整理/查阅类操作（标已读、翻芯片、改记忆、改习惯、收尾、手机独立私聊）。
 */
const NARRATED_UI_ACTION_TYPES: ReadonlySet<string> = new Set([
  "buyItem",
  "sellItem",
  "gunsmith",
  "buyCyberware",
  "removeCyberware",
  "repairCyberware",
  "repayRipperdoc",
  "deckLoad",
  "equipItem",
  "unequipItem",
  "modWeapon",
  "useHealing",
  "useSuppressant",
  "buyHome",
  "payRent",
  "buyVehicle",
  "callVehicle",
  "placeItem",
  "transferItem",
  "npcCompanion",
  "acceptJob",
  "answerCall",
  "trauma",
  "scanNpc",
]);

/** 内部级噪音备注（例如纯重复的余额明细），如果同条记录已有更完整的主描述就省略 */
const RAW_MONEY_NOTE = /^欧元 [+\-−]/;
const RAW_SERVICE_TIME_NOTE = /完成服务；开始 \d+，结束 \d+$/;

function actionTypeOf(record: ActionRecord): string | undefined {
  const raw = record.action;
  if (typeof raw !== "object" || raw === null) return undefined;
  const type = (raw as { type?: unknown }).type;
  return typeof type === "string" ? type : undefined;
}

/**
 * 把一条 UI action 记录的 notes 整理成给叙事模型和玩家日志看的简洁中文句子。
 * 忽略纯界面管理操作；没有可读描述时返回 null。
 */
export function summarizeUiAction(record: ActionRecord): string | null {
  const type = actionTypeOf(record);
  if (!type || !NARRATED_UI_ACTION_TYPES.has(type)) return null;
  const rawNotes = record.notes.map((n) => n.trim()).filter((n) => n !== "");
  if (rawNotes.length === 0) return null;

  // 过滤冗余的子命令备注：只要存在更具体的业务说明（如“取得……，XX 欧元（商店）”或“神经系统装上……”），就不重复列出纯余额流水或时间戳
  const primary = rawNotes.filter(
    (note) => !RAW_MONEY_NOTE.test(note) && !RAW_SERVICE_TIME_NOTE.test(note),
  );
  const picked = primary.length > 0 ? primary : rawNotes;

  // 义体诊所操作：如果只有“神经系统装上XX”而钱在 money 备注里，补上诊所与金额信息
  if (
    (type === "buyCyberware" || type === "removeCyberware" || type === "repairCyberware") &&
    picked.every((n) => !n.includes("欧元"))
  ) {
    const moneyNote = rawNotes.find((n) => RAW_MONEY_NOTE.test(n));
    if (moneyNote) {
      const cleanedMoney = moneyNote.replace(/，现有 \d+$/, "");
      return `${picked.join("；")}（${cleanedMoney}）`;
    }
  }
  return picked.join("；");
}

export interface UiActionEntry {
  readonly seq: number;
  readonly type: string;
  readonly summary: string;
}

function scanTargetIdOf(record: ActionRecord): string | undefined {
  const raw = record.action;
  if (typeof raw !== "object" || raw === null) return undefined;
  const { type, id } = raw as { type?: unknown; id?: unknown };
  return type === "scanNpc" && typeof id === "string" && id !== "" ? id : undefined;
}

function effectiveUiActions(
  records: readonly LogRecord[],
  afterSeq: number,
  beforeSeq?: number,
): UiActionEntry[] {
  const voided = voidedSeqs(records);
  const previouslyScanned = new Set<string>();
  const out: UiActionEntry[] = [];
  for (const record of records) {
    if (voided.has(record.seq)) continue;
    if (record.kind === "turn") {
      if (record.seq <= afterSeq) {
        for (const cmd of record.commands) {
          if (typeof cmd !== "object" || cmd === null) continue;
          const { type, id } = cmd as { type?: unknown; id?: unknown };
          if (type === "npcScan" && typeof id === "string" && id !== "") {
            previouslyScanned.add(id);
          }
        }
      }
      continue;
    }
    if (record.kind !== "action") continue;
    const scanId = scanTargetIdOf(record);
    if (record.seq <= afterSeq) {
      if (scanId) previouslyScanned.add(scanId);
      continue;
    }
    if (beforeSeq !== undefined && record.seq >= beforeSeq) continue;
    if (scanId) {
      if (previouslyScanned.has(scanId)) continue;
      previouslyScanned.add(scanId);
    }
    const type = actionTypeOf(record);
    const summary = summarizeUiAction(record);
    if (!type || !summary) continue;
    out.push({ seq: record.seq, type, summary });
  }
  return out;
}

/**
 * 上一个有效回合之后、玩家在界面上直接完成的世界内操作（用于下一轮正文续写与防重复记账）。
 * 跳过未定稿草稿回合，避免中断重试时丢失之前的操作。
 */
export function pendingUiActions(records: readonly LogRecord[]): readonly UiActionEntry[] {
  const settledTurns = effectiveTurns(records).filter((t) => t.draft !== true);
  const lastTurnSeq = settledTurns.at(-1)?.seq ?? -1;
  return effectiveUiActions(records, lastTurnSeq);
}

/**
 * 某一个具体回合之前（自上一个非草稿回合以来）发生的界面操作，供 StoryLog 回显。
 */
export function uiActionsBeforeTurn(
  records: readonly LogRecord[],
  turnSeq: number,
  prevTurnSeq: number,
): readonly UiActionEntry[] {
  return effectiveUiActions(records, prevTurnSeq, turnSeq);
}
