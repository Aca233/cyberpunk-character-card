import {
  ACQUAINTANCE_LABEL_CHARS,
  type Acquaintance,
  acquaintanceRelationLabel,
  type Board,
  boardPeople,
  CUSTOM_NPCS_MAX,
  NPC_OVERRIDES_MAX,
  npcRules,
  RELATION_INFO,
  type RelationKind,
} from "@cp/core";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { api, type BoardData } from "../../api/client";
import { ActionButton } from "../../ui/ActionButton";
import { Asset, cssUrl } from "../../ui/Asset";
import { Button } from "../../ui/Button";
import { CellFrame, FrameBox } from "../../ui/FrameBox";
import { useLayer } from "../../ui/layers";
import { portraitOf } from "../story/art";
import styles from "./characters.module.css";
import {
  loadLocalCustomNpcs,
  loadLocalNpcOverrides,
  removeLocalCustomNpc,
  saveLocalCustomNpc,
  subscribeLocalCustomNpcs,
} from "./creator";
import { NpcCreatorWorkbench, type NpcWorkbenchMode } from "./NpcCreatorWorkbench";
import wb from "./workbench.module.css";

const { NO_FACTION, NPC_CIRCLES, NPC_CIRCLE_LABELS, inferNpcCircle } = npcRules;
type NpcCircle = npcRules.NpcCircle;

/**
 * 工作台的人脉选择器（NC CONTACTS）：
 * 按夜之城 7 大圈层清晰分类展示世界角色（支持全量 56+ 原作立绘头像），
 * 支持完整自建 NPC、修改自建/原作/工坊人物卡（原作生平与秘密默认防剧透折叠），
 * 清晰展示外貌/圈层/势力/6 种关系真实开局效果，并支持本地自建库跨角色复用与打包工坊。
 */

const LEDGER_EFFECT_LABELS: Readonly<Record<string, string>> = {
  owesYou: "开局自动记入人情账（对方欠你一次）",
  youOwe: "开局自动记入人情账（你欠对方一次）",
  grudge: "开局自动挂旧仇标记（见面自带敌意）",
};

const RELATION_GROUPS: readonly {
  readonly id: string;
  readonly label: string;
  readonly items: readonly RelationKind[];
}[] = [
  { id: "bond", label: "亲密羁绊", items: ["family", "lover", "partner", "friend", "mentor"] },
  { id: "work", label: "往来人情", items: ["boss", "subordinate", "nod", "owesYou", "youOwe"] },
  { id: "edge", label: "纠葛自定", items: ["ex", "rival", "grudge", "custom"] },
];

const LEDGER_TAG_SHORT: Readonly<Record<string, string>> = {
  owesYou: "人情",
  youOwe: "人情",
  grudge: "仇",
};

/** 按关系类型提供快捷交集填充词条 */
const RELATION_NOTE_CHIPS: Readonly<Record<RelationKind, readonly string[]>> = {
  family: [
    "从小把我带大，虽立场不同却暗中护着我",
    "原生家庭破裂后各自谋生，久未联系",
    "在夜之城相依为命，互为最后的底牌",
  ],
  lover: [
    "刀口舔血的日子里彼此依靠，互相留着门禁密钥",
    "在夜之城的霓虹暗角相恋，对彼此的底细了如指掌",
    "表面各自跑单，私下约定干完大活一起离开夜之城",
  ],
  partner: [
    "一起扛过几场硬仗，背靠背把后背交给对方",
    "常年搭档跑单，分工默契从不抢功",
    "同一个小队里活下来的老拍档",
  ],
  mentor: [
    "初入夜之城时手把手带我上道、立规矩",
    "传过我看家手艺，关键时刻点醒过我",
    "虽已各奔前程，仍敬对方三分师徒情分",
  ],
  boss: [
    "曾在其手下办过几件见不得光的差事",
    "目前仍保持上下级或长期雇佣往来",
    "对方手握资源与话语权，对我既提防又看重",
  ],
  subordinate: [
    "我一手带出来的新人，干活利落听招呼",
    "在我的地盘或项目里做事，欠我一份提拔",
    "关键时刻能帮我跑腿放风的得力后辈",
  ],
  friend: ["一起扛过一场差点栽掉的活", "低谷时借过我落脚和救命钱", "多年互相照应的过命交情"],
  nod: ["在酒吧拼过一桌酒", "经中间人介绍打过照面", "在同一场地下交易见过"],
  owesYou: [
    "上次失手是我把对方从火场拉出来的",
    "替对方压下过一笔要命的黑料",
    "帮对方垫付过一笔救急义体款",
  ],
  youOwe: [
    "被帮派堵死时是对方出面保的我",
    "靠对方牵线才保住现在的落脚点",
    "欠着对方一笔还没还清的急难钱",
  ],
  ex: [
    "合作跑单走到一起，又因一场失误闹掰",
    "分得不算难看，但各自换了圈子",
    "互相还留着紧急联络频段",
  ],
  rival: [
    "同一个圈子里抢单抢地盘的老对手",
    "棋逢对手，嘴上互不相让心里各有忌惮",
    "几次任务撞车，彼此都想压对方一头",
  ],
  grudge: [
    "一单分赃彻底翻脸，差点拔枪",
    "对方害我丢了关键门路和一笔大钱",
    "旧账一直没算清，见面只剩冷眼",
  ],
  custom: [
    "掌握着彼此关键秘密的特殊联系人",
    "私下长期合作，各取所需互不越界",
    "牵扯着一段不愿外扬的旧日渊源",
  ],
};

/** 血亲与自定义关系的快捷称谓词条 */
const RELATION_LABEL_CHIPS: Readonly<Partial<Record<RelationKind, readonly string[]>>> = {
  family: ["母亲", "父亲", "姐姐", "哥哥", "妹妹", "弟弟", "养母", "养父", "血亲"],
  lover: ["恋人", "伴侣", "未婚妻", "未婚夫", "秘密情人"],
  mentor: ["师父", "引路人", "前辈", "教官"],
  boss: ["直属上司", "大老板", "幕后雇主", "公司高管"],
  custom: ["监护人", "金主", "线人", "主治医生", "义姐", "义兄", "房东"],
};

interface Person {
  readonly id: string;
  /** 写入 Acquaintance.name 的干净本名（不含括号别称，避免 20 字截断） */
  readonly rawName: string;
  /** 列表与卡片标题展示名 */
  readonly name: string;
  readonly role: string;
  readonly look?: string;
  readonly faction?: string;
  readonly circle?: NpcCircle;
  /** 原作/工坊预制人物的 id，有原作头像就画头像 */
  readonly npc?: string;
  readonly hasPortrait: boolean;
  readonly fromModule: boolean;
  readonly isCustom?: boolean;
  readonly hasFullCard?: boolean;
  readonly inBoardCustom?: boolean;
  readonly hasOverride?: boolean;
  readonly catalogNpc?: boolean;
  readonly preset?: Acquaintance;
  readonly packId?: string;
}

type PeopleFilter = "all" | "linked" | "custom" | "workshop" | NpcCircle;

interface ActiveNpcEditor {
  readonly mode: NpcWorkbenchMode;
  readonly initial?: npcRules.NpcCard | undefined;
  readonly hasOverride?: boolean | undefined;
}

function isWorkshopSource(packId?: string): boolean {
  return Boolean(packId && packId !== "local");
}

function isCircleFilter(f: PeopleFilter): f is NpcCircle {
  return (NPC_CIRCLES as readonly string[]).includes(f);
}

function resolveCircle(raw: {
  readonly circle?: string | undefined;
  readonly faction?: string | undefined;
  readonly role?: string | undefined;
}): NpcCircle {
  if (raw.circle && (NPC_CIRCLES as readonly string[]).includes(raw.circle)) {
    return raw.circle as NpcCircle;
  }
  return inferNpcCircle({ faction: raw.faction, role: raw.role });
}

function matchesPerson(
  p: Person,
  query: string,
  factionNameMap: ReadonlyMap<string, string>,
): boolean {
  if (!query) return true;
  const circleLabel = p.circle ? NPC_CIRCLE_LABELS[p.circle] : "";
  const factionLabel = p.faction ? (factionNameMap.get(p.faction) ?? p.faction) : "";
  return `${p.name} ${p.rawName} ${p.role} ${p.faction ?? ""} ${factionLabel} ${circleLabel} ${p.look ?? ""} ${p.preset?.note ?? ""}`
    .toLowerCase()
    .includes(query);
}

function upsertCard(
  list: readonly npcRules.NpcCard[],
  card: npcRules.NpcCard,
  max: number,
): npcRules.NpcCard[] {
  const exists = list.some((item) => item.id === card.id);
  const next = exists ? list.map((item) => (item.id === card.id ? card : item)) : [...list, card];
  return next.slice(-max);
}

/**
 * 旧识与人物管理器：世界角色按夜之城 7 大圈层清晰分类，圈内优先展示带原作头像的人物，
 * 支持新建完整自建 NPC（同步写入本地自建库供跨角色复用与工坊打包）、编辑自建 NPC 与修改原作/工坊人物卡。
 */
export function PeoplePicker({
  board,
  data,
  commit,
  replacesNpcId,
}: {
  readonly board: Board;
  readonly data: BoardData;
  readonly commit: (board: Board) => void;
  readonly replacesNpcId?: string | undefined;
}) {
  const [localNpcs, setLocalNpcs] = useState<readonly npcRules.NpcCard[]>(() =>
    loadLocalCustomNpcs(),
  );
  const [globalOverrides, setGlobalOverrides] = useState<readonly npcRules.NpcCard[]>(() =>
    loadLocalNpcOverrides(),
  );
  useEffect(
    () =>
      subscribeLocalCustomNpcs(() => {
        setLocalNpcs(loadLocalCustomNpcs());
        setGlobalOverrides(loadLocalNpcOverrides());
      }),
    [],
  );

  const factionNameMap = useMemo(
    () => new Map((data.factions ?? []).map((f) => [f.id, f.name] as const)),
    [data.factions],
  );

  const byId = useMemo(
    () => new Map(board.acquaintances.map((a) => [a.id, a])),
    [board.acquaintances],
  );

  const boardCustomSet = useMemo(
    () => new Set((board.customNpcs ?? []).map((c) => c.id)),
    [board.customNpcs],
  );

  const customNpcMap = useMemo(() => {
    const map = new Map<string, npcRules.NpcCard>();
    for (const card of localNpcs) map.set(card.id, card);
    for (const card of board.customNpcs ?? []) map.set(card.id, card);
    return map;
  }, [localNpcs, board.customNpcs]);

  const overrideMap = useMemo(() => {
    const map = new Map<string, npcRules.NpcCard>();
    for (const card of globalOverrides) map.set(card.id, card);
    for (const card of board.npcOverrides ?? []) map.set(card.id, card);
    return map;
  }, [globalOverrides, board.npcOverrides]);

  const modulePeople: Person[] = useMemo(
    () =>
      boardPeople(board)
        .filter(
          (p) =>
            !customNpcMap.has(p.id) && !board.acquaintances.some((a) => a.id === p.id && a.custom),
        )
        .map((p) => ({
          id: p.id,
          rawName: p.name,
          name: p.name,
          role: p.role || "出身/特质带出故人",
          hasPortrait: false,
          fromModule: true,
        })),
    [board, customNpcMap],
  );

  const own: Person[] = useMemo(() => {
    const list: Person[] = [];
    for (const card of customNpcMap.values()) {
      const faction = card.faction && card.faction !== NO_FACTION ? card.faction : undefined;
      list.push({
        id: card.id,
        rawName: card.name,
        name: card.alias ? `${card.name}（${card.alias}）` : card.name,
        role: card.role,
        look: card.look,
        ...(faction ? { faction } : {}),
        circle: resolveCircle(card),
        hasPortrait: false,
        fromModule: false,
        isCustom: true,
        hasFullCard: true,
        inBoardCustom: boardCustomSet.has(card.id),
        packId: "local",
      });
    }
    for (const a of board.acquaintances) {
      if (!a.custom || customNpcMap.has(a.id)) continue;
      list.push({
        id: a.id,
        rawName: a.name,
        name: a.name,
        role: a.role || "自定义旧识",
        hasPortrait: false,
        fromModule: false,
        isCustom: true,
        hasFullCard: false,
        inBoardCustom: false,
        ...(a.packId ? { packId: a.packId } : {}),
      });
    }
    return list;
  }, [customNpcMap, boardCustomSet, board.acquaintances]);

  const canon: Person[] = useMemo(() => {
    const list = data.npcs
      .filter((n) => n.id !== replacesNpcId)
      .map((n) => {
        const ov = overrideMap.get(n.id);
        const preset = data.acquaintances?.find((entry) => entry.id === n.id);
        const hasPortrait = Boolean(portraitOf(n.id));
        const effectiveName = ov?.name ?? n.name;
        const effectiveAlias = ov ? ov.alias : n.alias;
        const effectiveRole = ov?.role ?? n.role;
        const effectiveLook = ov?.look ?? n.look;
        const effectiveFaction = ov
          ? ov.faction !== NO_FACTION
            ? ov.faction
            : undefined
          : n.faction;
        const circle = resolveCircle(ov ?? n);
        return {
          id: n.id,
          rawName: effectiveName,
          name: effectiveAlias ? `${effectiveName}（${effectiveAlias}）` : effectiveName,
          role: effectiveRole,
          ...(effectiveLook ? { look: effectiveLook } : {}),
          ...(effectiveFaction ? { faction: effectiveFaction } : {}),
          circle,
          npc: n.id,
          hasPortrait,
          fromModule: false,
          ...(ov ? { hasOverride: true } : {}),
          ...(n.packId || preset?.catalogNpc ? { catalogNpc: true } : {}),
          ...(n.packId ? { packId: n.packId } : {}),
          ...(preset ? { preset } : {}),
        };
      });
    // 同圈层内带原作头像的标志人物排在前面
    return [...list].sort((x, y) => Number(y.hasPortrait) - Number(x.hasPortrait));
  }, [data.npcs, data.acquaintances, overrideMap, replacesNpcId]);

  const workshopPresets: Person[] = useMemo(() => {
    const catalogIds = new Set(data.npcs.map((npc) => npc.id));
    return (data.acquaintances ?? [])
      .filter((preset) => !catalogIds.has(preset.id))
      .map((preset) => ({
        id: preset.id,
        rawName: preset.name,
        name: preset.name,
        role: preset.role || "工坊旧识",
        hasPortrait: false,
        fromModule: false,
        preset,
        ...(preset.packId ? { packId: preset.packId } : {}),
      }));
  }, [data.npcs, data.acquaintances]);

  const [picked, setPicked] = useState<string | null>(null);
  const [editor, setEditor] = useState<ActiveNpcEditor | null>(null);
  useLayer(() => setEditor(null), editor !== null);
  const [loadingNpcId, setLoadingNpcId] = useState<string | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<PeopleFilter>("all");

  const normalizedQuery = query.trim().toLowerCase();
  const availableWorkshopPresets = useMemo(
    () => workshopPresets.filter((p) => !byId.has(p.id)),
    [workshopPresets, byId],
  );
  const allPeople = useMemo(
    () => [...modulePeople, ...own, ...canon, ...availableWorkshopPresets],
    [modulePeople, own, canon, availableWorkshopPresets],
  );
  const hasWorkshop = allPeople.some((p) => isWorkshopSource(p.packId));
  const circleCounts = useMemo(() => {
    const map = new Map<NpcCircle, number>();
    for (const c of NPC_CIRCLES) map.set(c, 0);
    for (const p of canon) {
      if (p.circle) map.set(p.circle, (map.get(p.circle) ?? 0) + 1);
    }
    return map;
  }, [canon]);

  const filterList = useMemo(
    () => (list: readonly Person[]) =>
      list.filter((p) => {
        if (filter === "linked" && !byId.has(p.id)) return false;
        if (filter === "custom" && !p.fromModule && !p.isCustom) return false;
        if (filter === "workshop" && !isWorkshopSource(p.packId)) return false;
        if (isCircleFilter(filter) && p.circle !== filter) return false;
        return matchesPerson(p, normalizedQuery, factionNameMap);
      }),
    [filter, byId, normalizedQuery, factionNameMap],
  );

  const shownModule = filterList(modulePeople);
  const shownOwn = filterList(own);
  const shownCanonByCircle = useMemo(
    () =>
      NPC_CIRCLES.map((circle) => ({
        circle,
        label: NPC_CIRCLE_LABELS[circle],
        list: filterList(canon.filter((p) => p.circle === circle)),
      })).filter((g) => g.list.length > 0),
    [canon, filterList],
  );
  const shownPresets = filterList(availableWorkshopPresets);
  const visiblePeople = [
    ...shownModule,
    ...shownOwn,
    ...shownCanonByCircle.flatMap((g) => g.list),
    ...shownPresets,
  ];

  // 让右侧详情卡始终与当前可见清单保持同步（若筛选后当前项不可见则自动切到首个可见项）
  const current =
    visiblePeople.find((p) => p.id === picked) ??
    visiblePeople[0] ??
    allPeople.find((p) => p.id === picked) ??
    canon[0];

  const setRelation = (p: Person, relation: RelationKind | "") => {
    const had = byId.get(p.id);
    const nextAcq = relation
      ? had
        ? board.acquaintances.map((a) => (a.id === p.id ? { ...a, relation } : a))
        : [
            ...board.acquaintances,
            {
              id: p.id,
              name: p.rawName.slice(0, 20),
              relation,
              note: p.preset?.note ?? "",
              ...(p.catalogNpc ? { catalogNpc: true } : {}),
              ...(p.packId ? { packId: p.packId } : {}),
              ...(p.isCustom ? { custom: true, role: p.role } : {}),
              ...(!p.isCustom && p.preset?.role ? { role: p.preset.role } : {}),
              ...(!p.isCustom && !p.catalogNpc && p.preset?.custom ? { custom: true } : {}),
            },
          ]
      : board.acquaintances.filter((a) => a.id !== p.id);

    // 若为跨角色本地自建 NPC 建立关系，同时将其完整人物卡随当前角色卡打包入局
    const fullCard = relation ? customNpcMap.get(p.id) : undefined;
    const nextCustomNpcs =
      fullCard && !boardCustomSet.has(p.id)
        ? upsertCard(board.customNpcs ?? [], fullCard, CUSTOM_NPCS_MAX)
        : (board.customNpcs ?? []);

    commit({
      ...board,
      acquaintances: nextAcq,
      customNpcs: nextCustomNpcs,
    });
  };

  const toggleCustomInBoard = (id: string, include: boolean) => {
    const card = customNpcMap.get(id);
    if (!card) return;
    if (include) {
      commit({
        ...board,
        customNpcs: upsertCard(board.customNpcs ?? [], card, CUSTOM_NPCS_MAX),
      });
    } else {
      commit({
        ...board,
        customNpcs: (board.customNpcs ?? []).filter((c) => c.id !== id),
        acquaintances: board.acquaintances.filter((a) => a.id !== id),
      });
    }
  };

  const setNote = (id: string, note: string) =>
    commit({
      ...board,
      acquaintances: board.acquaintances.map((a) => (a.id === id ? { ...a, note } : a)),
    });

  const setCustomLabel = (id: string, customLabel: string) =>
    commit({
      ...board,
      acquaintances: board.acquaintances.map((a) => {
        if (a.id !== id) return a;
        const next = { ...a };
        if (customLabel) next.customLabel = customLabel;
        else delete next.customLabel;
        return next;
      }),
    });

  const openEditorFor = async (person: Person) => {
    setEditorError(null);
    if (person.isCustom) {
      const existing = customNpcMap.get(person.id);
      if (existing) {
        setEditor({ mode: "edit-custom", initial: existing });
        return;
      }
      // 兼容早期仅填了姓名和身份的轻量旧识，打开完整表单补全升级
      const stub = byId.get(person.id);
      setEditor({
        mode: "edit-custom",
        initial: {
          id: person.id,
          name: stub?.name ?? person.rawName,
          pronoun: "TA",
          role: stub?.role || person.role || "自定义旧识",
          faction: NO_FACTION,
          entity: "human",
          look: "",
          voice: "",
          samples: [],
          want: "",
          limit: "",
          canon: false,
          body: { gear: [], cyberware: [] },
        },
      });
      return;
    }

    if (!person.npc) return;
    const existingOverride = overrideMap.get(person.id);
    if (existingOverride) {
      setEditor({ mode: "edit-canon", initial: existingOverride, hasOverride: true });
      return;
    }

    setLoadingNpcId(person.id);
    try {
      const npc = await api.characterBoardNpc(person.id);
      setEditor({ mode: "edit-canon", initial: npc, hasOverride: false });
    } catch (err) {
      setEditorError(err instanceof Error ? err.message : "读取人物卡失败");
    } finally {
      setLoadingNpcId(null);
    }
  };

  const handleEditorSave = (card: npcRules.NpcCard) => {
    if (!editor) return;
    setEditorError(null);
    if (editor.mode === "edit-canon") {
      const nextOverrides = upsertCard(board.npcOverrides ?? [], card, NPC_OVERRIDES_MAX);
      const nextAcq = board.acquaintances.map((item) =>
        item.id === card.id ? { ...item, name: card.name.slice(0, 20) } : item,
      );
      commit({
        ...board,
        npcOverrides: nextOverrides,
        acquaintances: nextAcq,
      });
      setEditor(null);
      setPicked(card.id);
      return;
    }

    // 自建 NPC：同步持久化到本地自建库（可跨角色复用 / 打包工坊）并挂载到当前角色卡
    saveLocalCustomNpc(card);
    const nextCustomNpcs = upsertCard(board.customNpcs ?? [], card, CUSTOM_NPCS_MAX);
    const nextAcq = board.acquaintances.map((item) =>
      item.id === card.id
        ? {
            ...item,
            name: card.name.slice(0, 20),
            role: card.role,
            custom: true,
            packId: "local",
          }
        : item,
    );
    commit({
      ...board,
      customNpcs: nextCustomNpcs,
      acquaintances: nextAcq,
    });
    setEditor(null);
    setPicked(card.id);
  };

  const resetCanonOverride = (id: string) => {
    const orig = data.npcs.find((n) => n.id === id);
    const nextOverrides = (board.npcOverrides ?? []).filter((o) => o.id !== id);
    const nextAcq = orig
      ? board.acquaintances.map((item) =>
          item.id === id ? { ...item, name: orig.name.slice(0, 20) } : item,
        )
      : board.acquaintances;
    commit({
      ...board,
      npcOverrides: nextOverrides,
      acquaintances: nextAcq,
    });
    setEditor(null);
  };

  const toggleVGender = async (toMale: boolean) => {
    setEditorError(null);
    if (!toMale) {
      resetCanonOverride("v");
      return;
    }
    setLoadingNpcId("v");
    try {
      const maleCard = await api.characterBoardNpc("v", "male");
      const nextOverrides = upsertCard(board.npcOverrides ?? [], maleCard, NPC_OVERRIDES_MAX);
      const nextAcq = board.acquaintances.map((item) =>
        item.id === "v" ? { ...item, name: maleCard.name.slice(0, 20) } : item,
      );
      commit({
        ...board,
        npcOverrides: nextOverrides,
        acquaintances: nextAcq,
      });
    } catch (err) {
      setEditorError(err instanceof Error ? err.message : "切换男 V 失败");
    } finally {
      setLoadingNpcId(null);
    }
  };

  const deleteCustomNpc = (id: string) => {
    removeLocalCustomNpc(id);
    commit({
      ...board,
      customNpcs: (board.customNpcs ?? []).filter((c) => c.id !== id),
      acquaintances: board.acquaintances.filter((a) => a.id !== id),
    });
    setEditor(null);
    setPicked(null);
  };

  const contact = (p: Person) => {
    const a = byId.get(p.id);
    const face = portraitOf(p.npc);
    const fromWorkshop = isWorkshopSource(p.packId);
    return (
      <li key={p.id}>
        <button
          type="button"
          className={styles.peopleRow}
          aria-pressed={!editor && p.id === current?.id}
          data-on={a || p.inBoardCustom || p.hasOverride ? "" : undefined}
          onClick={() => {
            setEditor(null);
            setPicked(p.id);
          }}
        >
          <span className={styles.peopleFace} aria-hidden="true">
            {face ? (
              <Asset id={face} className={styles.peopleFaceArt} />
            ) : (
              ([...p.rawName][0] ?? "?")
            )}
          </span>
          <span className={styles.peopleName}>
            <span className={styles.peopleTitleRow}>
              <b className={styles.peopleTitle}>{p.name}</b>
              {p.hasOverride && <span className={styles.peopleTag}>已改</span>}
              {p.isCustom && <span className={styles.peopleTag}>自建</span>}
              {fromWorkshop && <span className={styles.peopleTag}>工坊</span>}
            </span>
            <small className={styles.peopleSub}>
              {a
                ? `${acquaintanceRelationLabel(a)} · ${p.role}`
                : p.inBoardCustom
                  ? `入局人物 · ${p.role}`
                  : p.role}
            </small>
          </span>
        </button>
      </li>
    );
  };

  const a = current ? byId.get(current.id) : undefined;
  const face = portraitOf(current?.npc);
  const isOwn = Boolean(current?.isCustom);
  const canEditCard = Boolean(current && (current.isCustom || current.npc));
  const customInBoardCount = (board.customNpcs ?? []).length;
  const overrideCount = (board.npcOverrides ?? []).length;

  return (
    <div className={styles.peopleWrap}>
      {/* 顶部紧凑已选旧识汇总条 */}
      <section className={styles.peopleSummary} aria-label="已建立联系的旧识">
        <CellFrame />
        <div className={styles.peopleSummaryHead}>
          <span className={styles.peopleSummaryTitle}>
            已建交集 <b>{board.acquaintances.length}</b> 人
            {customInBoardCount > 0 && (
              <>
                {" "}
                · 自建入局 <b>{customInBoardCount}</b> 人
              </>
            )}
            {overrideCount > 0 && (
              <>
                {" "}
                · 改写原作 <b>{overrideCount}</b> 人
              </>
            )}
          </span>
          <span className={styles.note}>
            {board.acquaintances.length > 0
              ? "点击标签快速定位详情；所设关系与人物卡改写将在入城时写入世界、通讯录与账本。"
              : "可点选人物设定初始关系、新建自建 NPC，或修改任意原作/工坊人物卡。"}
          </span>
        </div>
        {board.acquaintances.length > 0 && (
          <div className={styles.peopleChips}>
            {board.acquaintances.map((item) => (
              <span
                key={item.id}
                className={styles.peopleChip}
                data-active={current?.id === item.id || undefined}
                data-tone={item.relation === "grudge" ? "bad" : undefined}
              >
                <button
                  type="button"
                  className={styles.peopleChipMain}
                  onClick={() => {
                    setEditor(null);
                    setFilter("all");
                    setQuery("");
                    setPicked(item.id);
                  }}
                >
                  <b>{item.name}</b>
                  <small>{acquaintanceRelationLabel(item)}</small>
                </button>
                <button
                  type="button"
                  className={styles.peopleChipRemove}
                  title={`移除与 ${item.name} 的关系`}
                  aria-label={`移除与 ${item.name} 的关系`}
                  onClick={() =>
                    commit({
                      ...board,
                      acquaintances: board.acquaintances.filter((x) => x.id !== item.id),
                    })
                  }
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </section>

      {/* 通栏搜索、新建与圈层筛选栏 */}
      <div className={styles.peopleToolbar}>
        <div className={styles.peopleSearchRow}>
          <FrameBox className={styles.searchBox}>
            <input
              type="search"
              value={query}
              placeholder="搜索姓名、代号、身份、势力或外貌…"
              aria-label="搜索联系人"
              onChange={(e) => setQuery(e.target.value)}
            />
          </FrameBox>
          <span className={styles.peopleMatchStat}>
            显示 <b>{visiblePeople.length}</b> / {allPeople.length}
          </span>
          {(query.trim() !== "" || filter !== "all") && (
            <ActionButton
              onClick={() => {
                setQuery("");
                setFilter("all");
              }}
            >
              重置筛选
            </ActionButton>
          )}
          <Button
            small
            primary={editor?.mode !== "create"}
            onClick={() => {
              setEditorError(null);
              setEditor((cur) => (cur?.mode === "create" ? null : { mode: "create" }));
            }}
          >
            {editor?.mode === "create" ? "收起新建" : "＋ 自建 NPC"}
          </Button>
        </div>

        <fieldset className={styles.peopleFilters} aria-label="按圈层筛选联系人">
          <button
            type="button"
            className={styles.peopleFilterTab}
            aria-pressed={filter === "all"}
            onClick={() => setFilter("all")}
          >
            <span>全部</span>
            <small className={styles.peopleFilterNum}>{allPeople.length}</small>
          </button>
          <button
            type="button"
            className={styles.peopleFilterTab}
            aria-pressed={filter === "linked"}
            onClick={() => setFilter("linked")}
          >
            <span>已建联系</span>
            <small className={styles.peopleFilterNum}>{board.acquaintances.length}</small>
          </button>
          <button
            type="button"
            className={styles.peopleFilterTab}
            aria-pressed={filter === "custom"}
            onClick={() => setFilter("custom")}
          >
            <span>故人与自建</span>
            <small className={styles.peopleFilterNum}>{modulePeople.length + own.length}</small>
          </button>
          {hasWorkshop && (
            <button
              type="button"
              className={styles.peopleFilterTab}
              aria-pressed={filter === "workshop"}
              onClick={() => setFilter("workshop")}
            >
              <span>工坊</span>
            </button>
          )}
          <span className={styles.peopleFilterSep} aria-hidden="true" />
          {NPC_CIRCLES.map((circle) => {
            const count = circleCounts.get(circle) ?? 0;
            if (count === 0) return null;
            return (
              <button
                key={circle}
                type="button"
                className={styles.peopleFilterTab}
                aria-pressed={filter === circle}
                onClick={() => setFilter(circle)}
              >
                <span>{NPC_CIRCLE_LABELS[circle]}</span>
                <small className={styles.peopleFilterNum}>{count}</small>
              </button>
            );
          })}
        </fieldset>
      </div>

      {editorError && (
        <p className={styles.error} role="alert">
          {editorError}
        </p>
      )}

      <div className={styles.people}>
        <nav className={styles.peopleList} aria-label="联系人">
          {shownModule.length > 0 && (
            <section className={styles.peopleSection}>
              <h3 className={styles.peopleGroup}>
                <span>出身与特质带出的故人</span>
                <small className={styles.peopleCount}>{shownModule.length} 人</small>
              </h3>
              <ul className={styles.peopleGrid}>{shownModule.map(contact)}</ul>
            </section>
          )}

          {shownOwn.length > 0 && (
            <section className={styles.peopleSection}>
              <h3 className={styles.peopleGroup}>
                <span>自建 NPC 与自定义旧识</span>
                <small className={styles.peopleCount}>{shownOwn.length} 人</small>
              </h3>
              <ul className={styles.peopleGrid}>{shownOwn.map(contact)}</ul>
            </section>
          )}

          {shownCanonByCircle.map((group) => (
            <section key={group.circle} className={styles.peopleSection}>
              <h3 className={styles.peopleGroup}>
                <span>{group.label}</span>
                <small className={styles.peopleCount}>{group.list.length} 人</small>
              </h3>
              <ul className={styles.peopleGrid}>{group.list.map(contact)}</ul>
            </section>
          ))}

          {shownPresets.length > 0 && (
            <section className={styles.peopleSection}>
              <h3 className={styles.peopleGroup}>
                <span>工坊人脉预设</span>
                <small className={styles.peopleCount}>{shownPresets.length} 人</small>
              </h3>
              <ul className={styles.peopleGrid}>{shownPresets.map(contact)}</ul>
            </section>
          )}

          {visiblePeople.length === 0 && (
            <div className={styles.peopleEmpty}>
              <p className={styles.note}>没有匹配当前筛选条件的联系人。</p>
              <ActionButton
                onClick={() => {
                  setQuery("");
                  setFilter("all");
                }}
              >
                查看全部联系人
              </ActionButton>
            </div>
          )}
        </nav>

        {current && (
          <section className={styles.peopleCard} aria-label={current.name}>
            <CellFrame />
            <header className={styles.peopleHead}>
              <span className={styles.peopleFace} data-big="" aria-hidden="true">
                {face ? (
                  <Asset id={face} className={styles.peopleFaceArt} />
                ) : (
                  ([...current.rawName][0] ?? "?")
                )}
              </span>
              <span className={styles.peopleName}>
                <span className={styles.peopleTitleRow}>
                  <b className={styles.peopleTitle}>{current.name}</b>
                  {current.circle && (
                    <span className={styles.moduleBadge} data-tone="active">
                      {NPC_CIRCLE_LABELS[current.circle]}
                    </span>
                  )}
                  {current.faction && (
                    <span className={styles.moduleBadge}>
                      {factionNameMap.get(current.faction) ?? current.faction}
                    </span>
                  )}
                  {isWorkshopSource(current.packId) && (
                    <span className={styles.moduleBadge} data-tone="workshop">
                      工坊
                    </span>
                  )}
                  {isOwn && !isWorkshopSource(current.packId) && (
                    <span className={styles.moduleBadge}>自建</span>
                  )}
                  {current.hasOverride && (
                    <span className={styles.moduleBadge} data-tone="active">
                      已修改
                    </span>
                  )}
                </span>
                <small className={styles.peopleSub}>{current.role}</small>
              </span>
              {canEditCard && (
                <div className={styles.peopleHeadActions}>
                  {current.id === "v" && (
                    <Button
                      small
                      primary
                      disabled={loadingNpcId === "v"}
                      onClick={() => void toggleVGender(current.rawName !== "文森特")}
                    >
                      {loadingNpcId === "v"
                        ? "切换中…"
                        : current.rawName === "文森特"
                          ? "切回女 V（瓦莱丽）"
                          : "切为男 V（文森特）"}
                    </Button>
                  )}
                  <Button
                    small
                    disabled={loadingNpcId === current.id}
                    onClick={() => void openEditorFor(current)}
                  >
                    {loadingNpcId === current.id
                      ? "读取中…"
                      : current.isCustom
                        ? current.hasFullCard
                          ? "编辑人物卡"
                          : "补全人物卡"
                        : "修改人物卡"}
                  </Button>
                  {current.hasOverride && (
                    <ActionButton onClick={() => resetCanonOverride(current.id)}>
                      恢复默认
                    </ActionButton>
                  )}
                </div>
              )}
            </header>

            {current.look && <p className={styles.peopleBio}>{current.look}</p>}

            {isOwn && current.hasFullCard && (
              <div className={styles.presetHint}>
                <p className={styles.note}>
                  {current.inBoardCustom
                    ? a
                      ? "该自建 NPC 已随本角色卡入局，且开局即认识。"
                      : "该自建 NPC 已加入本局世界（开局暂不相识，可在夜之城自然偶遇）。"
                    : "该自建 NPC 保存在本地自建库中；设定关系或点击右侧按钮即可带入本局世界。"}
                </p>
                {current.inBoardCustom ? (
                  <ActionButton onClick={() => toggleCustomInBoard(current.id, false)}>
                    移出本局世界
                  </ActionButton>
                ) : (
                  <Button small onClick={() => toggleCustomInBoard(current.id, true)}>
                    加入本局世界
                  </Button>
                )}
              </div>
            )}

            {current.preset && !a && (
              <div className={styles.presetHint}>
                <p className={styles.note}>
                  工坊推荐关系：<b>{RELATION_INFO[current.preset.relation].label}</b>
                  {current.preset.note ? ` · ${current.preset.note}` : ""}
                </p>
                <Button
                  small
                  primary
                  onClick={() => setRelation(current, current.preset?.relation ?? "nod")}
                >
                  按预设建立关系
                </Button>
              </div>
            )}

            <section className={styles.relPanel} aria-label={`和${current.name}的关系`}>
              <div className={styles.relStatusBar} data-active={a ? "" : undefined}>
                <div className={styles.relStatusMain}>
                  <span className={styles.relStatusCode}>
                    {a ? "RELATION // 已建联系" : "RELATION // 初始关系"}
                  </span>
                  <strong className={styles.relStatusPreview}>
                    {a
                      ? a.note.trim()
                        ? `${acquaintanceRelationLabel(a)}：${a.note.trim()}`
                        : acquaintanceRelationLabel(a)
                      : current.fromModule
                        ? "沿用模块默认关系"
                        : isOwn && current.inBoardCustom
                          ? "暂不相识（保留在世界中自然偶遇）"
                          : "暂无交集（点下方标签快速建立关系）"}
                  </strong>
                </div>
                {a && (
                  <ActionButton onClick={() => setRelation(current, "")}>清除关系</ActionButton>
                )}
              </div>

              <div className={styles.relGroups}>
                {RELATION_GROUPS.map((group) => (
                  <div key={group.id} className={styles.relGroupRow}>
                    <span className={styles.relGroupLabel}>{group.label}</span>
                    <div className={styles.relPills}>
                      {group.items.map((r) => {
                        const info = RELATION_INFO[r];
                        const ledgerBadge = info.ledger ? LEDGER_TAG_SHORT[info.ledger] : undefined;
                        return (
                          <button
                            key={r}
                            type="button"
                            className={styles.relPill}
                            aria-pressed={a?.relation === r}
                            data-tone={
                              r === "grudge" || r === "rival"
                                ? "bad"
                                : r === "custom"
                                  ? "custom"
                                  : undefined
                            }
                            onClick={() => setRelation(current, a?.relation === r ? "" : r)}
                          >
                            <span>{r === "custom" ? "✦ 自定义" : info.label}</span>
                            {ledgerBadge && <em className={styles.relPillTag}>{ledgerBadge}</em>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>

              {a && (
                <div className={styles.relEditor}>
                  {RELATION_INFO[a.relation].ledger && (
                    <p
                      className={styles.relLedgerTip}
                      data-tone={a.relation === "grudge" ? "bad" : undefined}
                    >
                      {LEDGER_EFFECT_LABELS[RELATION_INFO[a.relation].ledger ?? ""]}
                    </p>
                  )}

                  <div className={styles.relInputGrid}>
                    <label className={styles.field}>
                      <span>
                        具体称谓{a.relation === "custom" ? " *" : "（可选）"}
                        <small>
                          {(a.customLabel ?? "").length}/{ACQUAINTANCE_LABEL_CHARS}
                        </small>
                      </span>
                      <FrameBox className={styles.compactBox}>
                        <input
                          maxLength={ACQUAINTANCE_LABEL_CHARS}
                          value={a.customLabel ?? ""}
                          aria-label={`和${current.name}的具体关系称谓`}
                          placeholder={
                            a.relation === "family"
                              ? "母亲、父亲、姐姐…"
                              : a.relation === "custom"
                                ? "母亲、监护人、金主…"
                                : RELATION_INFO[a.relation].label
                          }
                          onChange={(e) => setCustomLabel(current.id, e.target.value)}
                        />
                      </FrameBox>
                    </label>
                    <label className={styles.field}>
                      <span>
                        过往交集或恩怨（可选）
                        <small>{a.note.length}/60</small>
                      </span>
                      <FrameBox className={styles.compactBox}>
                        <input
                          maxLength={60}
                          value={a.note}
                          aria-label={`和${current.name}是什么事`}
                          placeholder="一句具体渊源，或点下方词条快速填入"
                          onChange={(e) => setNote(current.id, e.target.value)}
                        />
                      </FrameBox>
                    </label>
                  </div>

                  {RELATION_LABEL_CHIPS[a.relation] && (
                    <div className={styles.relChipRow}>
                      <span className={styles.relChipKey}>称谓</span>
                      <div className={styles.relChipList}>
                        {RELATION_LABEL_CHIPS[a.relation]?.map((chip) => (
                          <button
                            key={chip}
                            type="button"
                            className={styles.relChip}
                            aria-pressed={(a.customLabel ?? "").trim() === chip}
                            onClick={() => setCustomLabel(current.id, chip)}
                          >
                            {chip}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className={styles.relChipRow}>
                    <span className={styles.relChipKey}>模板</span>
                    <div className={styles.relChipList}>
                      {RELATION_NOTE_CHIPS[a.relation].map((chip) => (
                        <button
                          key={chip}
                          type="button"
                          className={styles.relChip}
                          aria-pressed={a.note === chip}
                          onClick={() => setNote(current.id, chip)}
                        >
                          {chip}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </section>
          </section>
        )}
      </div>

      {editor &&
        createPortal(
          <div
            className={wb.npcOverlayBackdrop}
            role="dialog"
            aria-modal="true"
            aria-label={
              editor.mode === "create"
                ? "新建 NPC 工作台"
                : `编辑 NPC · ${editor.initial?.name ?? ""}`
            }
          >
            <header className={wb.npcOverlayHead}>
              <span className={wb.headCode}>{"NC // NPC DOSSIER"}</span>
              <h2>
                {editor.mode === "create"
                  ? "新建 NPC"
                  : editor.mode === "edit-canon"
                    ? `修改原作人物 · ${editor.initial?.name ?? ""}`
                    : `编辑 NPC · ${editor.initial?.name ?? ""}`}
              </h2>
              <span className={wb.headSpacer} />
              <Button small keyId="key.esc" onClick={() => setEditor(null)}>
                ← 返回当前角色创建
              </Button>
            </header>
            <span
              className={wb.headLine}
              style={{
                maskImage: cssUrl("tab.line"),
                WebkitMaskImage: cssUrl("tab.line"),
              }}
              aria-hidden
            />
            <div className={wb.npcOverlayBody}>
              <NpcCreatorWorkbench
                key={`${editor.mode}:${editor.initial?.id ?? "new"}`}
                mode={editor.mode}
                initial={editor.initial}
                data={data}
                hasOverride={editor.hasOverride}
                onSave={handleEditorSave}
                onReset={
                  editor.mode === "edit-canon" && editor.initial
                    ? () => {
                        if (editor.initial) resetCanonOverride(editor.initial.id);
                      }
                    : undefined
                }
                onDelete={
                  editor.mode === "edit-custom" && editor.initial
                    ? () => {
                        if (editor.initial) deleteCustomNpc(editor.initial.id);
                      }
                    : undefined
                }
                onCancel={() => setEditor(null)}
              />
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
