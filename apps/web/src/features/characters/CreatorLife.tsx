import {
  type Acquaintance,
  type Board,
  boardPeople,
  npcRules,
  RELATION_INFO,
  RELATIONS,
  type RelationKind,
} from "@cp/core";
import { useMemo, useState } from "react";
import type { BoardData } from "../../api/client";
import { ActionButton } from "../../ui/ActionButton";
import { Asset } from "../../ui/Asset";
import { Button } from "../../ui/Button";
import { CellFrame, FrameBox } from "../../ui/FrameBox";
import { portraitOf } from "../story/art";
import styles from "./characters.module.css";

const { NPC_CIRCLES, NPC_CIRCLE_LABELS, inferNpcCircle } = npcRules;
type NpcCircle = npcRules.NpcCircle;

/**
 * 工作台的人脉选择器（NC CONTACTS）：
 * 按夜之城 7 大圈层清晰分类展示世界角色（支持全量 56+ 原作立绘头像），
 * 清晰展示外貌/圈层/势力/6 种关系真实开局效果，支持已选汇总条、圈层快筛与自定义旧识原地编辑。
 */

const LEDGER_EFFECT_LABELS: Readonly<Record<string, string>> = {
  owesYou: "记人情债（对方欠你一次）",
  youOwe: "记人情债（你欠对方一次）",
  grudge: "挂旧仇标记（见面自带敌意）",
};

/** 6 种关系的开局机制说明（纯事实关系与人情/仇怨账本） */
function relationEffect(r: RelationKind): string {
  const info = RELATION_INFO[r];
  const parts: string[] = [];
  if (info.ledger) {
    parts.push(LEDGER_EFFECT_LABELS[info.ledger] ?? info.ledger);
  }
  if (info.note) {
    parts.push(`写入关系「${info.label}」`);
  }
  return parts.join(" · ");
}

/** 按关系类型提供快捷交集填充词条 */
const RELATION_NOTE_CHIPS: Readonly<Record<RelationKind, readonly string[]>> = {
  nod: ["在酒吧拼过一桌酒", "经中间人介绍打过照面", "在同一场地下交易见过"],
  friend: ["一起扛过一场差点栽掉的活", "低谷时借过我落脚和救命钱", "多年互相照应的过命交情"],
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
  grudge: [
    "一单分赃彻底翻脸，差点拔枪",
    "对方害我丢了关键门路和一笔大钱",
    "旧账一直没算清，见面只剩冷眼",
  ],
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
  /** 原作人物的 id，有原作头像就画头像 */
  readonly npc?: string;
  readonly hasPortrait: boolean;
  readonly fromModule: boolean;
  readonly catalogNpc?: boolean;
  readonly preset?: Acquaintance;
  readonly packId?: string;
}

const customId = () => `custom-${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;

type PeopleFilter = "all" | "linked" | "custom" | "workshop" | NpcCircle;

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

function matchesPerson(p: Person, query: string): boolean {
  if (!query) return true;
  const circleLabel = p.circle ? NPC_CIRCLE_LABELS[p.circle] : "";
  return `${p.name} ${p.rawName} ${p.role} ${p.faction ?? ""} ${circleLabel} ${p.look ?? ""} ${p.preset?.note ?? ""}`
    .toLowerCase()
    .includes(query);
}

/**
 * 旧识不限人数：世界角色按夜之城 7 大圈层清晰分类，圈内优先展示带原作头像的人物，
 * 出身/特质带出故人可覆盖关系，自定义旧识支持原地改名改身份。
 */
export function PeoplePicker({
  board,
  data,
  commit,
}: {
  readonly board: Board;
  readonly data: BoardData;
  readonly commit: (board: Board) => void;
}) {
  const byId = useMemo(
    () => new Map(board.acquaintances.map((a) => [a.id, a])),
    [board.acquaintances],
  );

  const modulePeople: Person[] = useMemo(
    () =>
      boardPeople(board)
        .filter((p) => !board.acquaintances.some((a) => a.id === p.id && a.custom))
        .map((p) => ({
          id: p.id,
          rawName: p.name,
          name: p.name,
          role: p.role || "出身/特质带出故人",
          hasPortrait: false,
          fromModule: true,
        })),
    [board],
  );

  const own: Person[] = useMemo(
    () =>
      board.acquaintances
        .filter((a) => a.custom)
        .map((a) => ({
          id: a.id,
          rawName: a.name,
          name: a.name,
          role: a.role || "自定义旧识",
          hasPortrait: false,
          fromModule: false,
          ...(a.packId ? { packId: a.packId } : {}),
        })),
    [board.acquaintances],
  );

  const canon: Person[] = useMemo(() => {
    const list = data.npcs.map((n) => {
      const preset = data.acquaintances?.find((entry) => entry.id === n.id);
      const hasPortrait = Boolean(portraitOf(n.id));
      const circle = resolveCircle(n);
      return {
        id: n.id,
        rawName: n.name,
        name: n.alias ? `${n.name}（${n.alias}）` : n.name,
        role: n.role,
        ...(n.look ? { look: n.look } : {}),
        ...(n.faction ? { faction: n.faction } : {}),
        circle,
        npc: n.id,
        hasPortrait,
        fromModule: false,
        ...(n.packId || preset?.catalogNpc ? { catalogNpc: true } : {}),
        ...(n.packId ? { packId: n.packId } : {}),
        ...(preset ? { preset } : {}),
      };
    });
    // 同圈层内带原作头像的标志人物排在前面
    return [...list].sort((x, y) => Number(y.hasPortrait) - Number(x.hasPortrait));
  }, [data.npcs, data.acquaintances]);

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
  const [adding, setAdding] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftRole, setDraftRole] = useState("");
  const [ownNameDraft, setOwnNameDraft] = useState<{
    readonly id: string;
    readonly value: string;
  } | null>(null);
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
        if (filter === "custom" && !p.fromModule && !own.some((o) => o.id === p.id)) return false;
        if (filter === "workshop" && !isWorkshopSource(p.packId)) return false;
        if (isCircleFilter(filter) && p.circle !== filter) return false;
        return matchesPerson(p, normalizedQuery);
      }),
    [filter, byId, own, normalizedQuery],
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
    const next = relation
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
              ...(p.preset?.role ? { role: p.preset.role } : {}),
              ...(!p.catalogNpc && p.preset?.custom ? { custom: true } : {}),
            },
          ]
      : board.acquaintances.filter((a) => a.id !== p.id);
    commit({ ...board, acquaintances: next });
  };

  const setNote = (id: string, note: string) =>
    commit({
      ...board,
      acquaintances: board.acquaintances.map((a) => (a.id === id ? { ...a, note } : a)),
    });

  const updateOwnField = (id: string, patch: Partial<Pick<Acquaintance, "name" | "role">>) =>
    commit({
      ...board,
      acquaintances: board.acquaintances.map((a) => (a.id === id ? { ...a, ...patch } : a)),
    });

  const addOwn = () => {
    const name = draftName.trim().slice(0, 20);
    if (!name) return;
    const id = customId();
    commit({
      ...board,
      acquaintances: [
        ...board.acquaintances,
        {
          id,
          name,
          relation: "nod",
          note: "",
          role: draftRole.trim().slice(0, 80),
          custom: true,
          packId: "local",
        },
      ],
    });
    setPicked(id);
    setAdding(false);
    setDraftName("");
    setDraftRole("");
  };

  const dropOwn = (id: string) => {
    commit({ ...board, acquaintances: board.acquaintances.filter((a) => a.id !== id) });
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
          aria-pressed={p.id === current?.id}
          data-on={a ? "" : undefined}
          onClick={() => setPicked(p.id)}
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
              {fromWorkshop && <span className={styles.peopleTag}>工坊</span>}
            </span>
            <small className={styles.peopleSub}>
              {a ? `${RELATION_INFO[a.relation].label} · ${p.role}` : p.role}
            </small>
          </span>
        </button>
      </li>
    );
  };

  const a = current ? byId.get(current.id) : undefined;
  const face = portraitOf(current?.npc);
  const isOwn = current ? own.some((p) => p.id === current.id) : false;

  return (
    <div className={styles.peopleWrap}>
      {/* 顶部紧凑已选旧识汇总条 */}
      <section className={styles.peopleSummary} aria-label="已建立联系的旧识">
        <CellFrame />
        <div className={styles.peopleSummaryHead}>
          <span className={styles.peopleSummaryTitle}>
            已建交集 <b>{board.acquaintances.length}</b> 人
          </span>
          <span className={styles.note}>
            {board.acquaintances.length > 0
              ? "点击标签快速定位详情；所设关系将在入城时写入通讯录、关系档案与人情/仇怨账本。"
              : "尚未建立额外旧识：从下方名录点选人物设定关系，或保持孤狼状态入城。"}
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
                    setFilter("all");
                    setQuery("");
                    setPicked(item.id);
                  }}
                >
                  <b>{item.name}</b>
                  <small>{RELATION_INFO[item.relation].label}</small>
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
          <Button small primary={adding} onClick={() => setAdding((v) => !v)}>
            {adding ? "收起新建" : "＋ 新建自定义旧识"}
          </Button>
        </div>

        {adding && (
          <div className={styles.customForm}>
            <CellFrame />
            <div className={styles.ownEditGrid}>
              <label className={styles.field}>
                <span>名字</span>
                <FrameBox className={styles.compactBox}>
                  <input
                    maxLength={20}
                    value={draftName}
                    placeholder="例如：老陈、莎拉"
                    onChange={(e) => setDraftName(e.target.value)}
                  />
                </FrameBox>
              </label>
              <label className={styles.field}>
                <span>身份</span>
                <FrameBox className={styles.compactBox}>
                  <input
                    maxLength={80}
                    value={draftRole}
                    placeholder="例如：沃森区的黑市药贩"
                    onChange={(e) => setDraftRole(e.target.value)}
                  />
                </FrameBox>
              </label>
            </div>
            <div className={styles.slotTools}>
              <Button
                small
                primary
                disabled={draftName.trim() === ""}
                reason="请先填写旧识的名字"
                onClick={addOwn}
              >
                加入旧识
              </Button>
              <ActionButton onClick={() => setAdding(false)}>取消</ActionButton>
            </div>
          </div>
        )}

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
                <span>自定义旧识</span>
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
                  {current.faction && <span className={styles.moduleBadge}>{current.faction}</span>}
                  {isWorkshopSource(current.packId) && (
                    <span className={styles.moduleBadge} data-tone="workshop">
                      工坊
                    </span>
                  )}
                  {isOwn && !isWorkshopSource(current.packId) && (
                    <span className={styles.moduleBadge}>自建</span>
                  )}
                </span>
                <small className={styles.peopleSub}>{current.role}</small>
              </span>
            </header>

            {current.look && <p className={styles.peopleBio}>{current.look}</p>}

            {isOwn && a && (
              <div className={styles.ownEditGrid}>
                <label className={styles.field}>
                  <span>旧识姓名</span>
                  <FrameBox className={styles.compactBox}>
                    <input
                      maxLength={20}
                      value={ownNameDraft?.id === current.id ? ownNameDraft.value : a.name}
                      onChange={(e) => {
                        const v = e.target.value.slice(0, 20);
                        setOwnNameDraft({ id: current.id, value: v });
                        if (v.trim() !== "") updateOwnField(current.id, { name: v.trim() });
                      }}
                      onBlur={() => setOwnNameDraft(null)}
                    />
                  </FrameBox>
                </label>
                <label className={styles.field}>
                  <span>身份简介</span>
                  <FrameBox className={styles.compactBox}>
                    <input
                      maxLength={80}
                      value={a.role ?? ""}
                      placeholder="例如：沃森区的黑市义体掮客"
                      onChange={(e) =>
                        updateOwnField(current.id, { role: e.target.value.slice(0, 80) })
                      }
                    />
                  </FrameBox>
                </label>
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

            <fieldset className={styles.relations} aria-label={`和${current.name}的关系`}>
              <button
                type="button"
                className={styles.relation}
                aria-pressed={!a}
                onClick={() => (isOwn ? dropOwn(current.id) : setRelation(current, ""))}
              >
                <CellFrame />
                <b className={styles.relationLabel}>
                  {isOwn ? "移除这位旧识" : current.fromModule ? "沿用默认关系" : "暂无交集"}
                </b>
                <small className={styles.relationNote}>
                  {isOwn ? "从通讯录中删除" : "不写入额外初始关系"}
                </small>
              </button>
              {RELATIONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  className={styles.relation}
                  aria-pressed={a?.relation === r}
                  data-tone={r === "grudge" ? "bad" : undefined}
                  onClick={() => setRelation(current, r)}
                >
                  <CellFrame />
                  <b className={styles.relationLabel}>{RELATION_INFO[r].label}</b>
                  <small className={styles.relationNote}>{relationEffect(r)}</small>
                </button>
              ))}
            </fieldset>

            {a && (
              <div className={styles.noteEditor}>
                <label className={styles.field}>
                  <span>
                    过往交集或恩怨
                    <small>{a.note.length} / 60</small>
                  </span>
                  <FrameBox className={styles.compactBox}>
                    <input
                      maxLength={60}
                      value={a.note}
                      aria-label={`和${current.name}是什么事`}
                      placeholder="写一句具体交集，或点下方快捷模板填入"
                      onChange={(e) => setNote(current.id, e.target.value)}
                    />
                  </FrameBox>
                </label>
                <fieldset className={styles.quickNotes} aria-label="快捷交集模板">
                  {RELATION_NOTE_CHIPS[a.relation].map((chip) => (
                    <button
                      key={chip}
                      type="button"
                      className={styles.quickNoteBtn}
                      onClick={() => setNote(current.id, chip)}
                    >
                      ＋ {chip}
                    </button>
                  ))}
                </fieldset>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
