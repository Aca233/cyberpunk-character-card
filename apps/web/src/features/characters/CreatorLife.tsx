import {
  type Acquaintance,
  type Board,
  boardPeople,
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

/**
 * 工作台的人脉选择器（NC CONTACTS）：
 * 优先呈现 12 位带原作立绘的核心人物，清晰展示外貌/势力/6 种关系真实开局效果，
 * 支持已选汇总条、快捷交集模板与自定义旧识原地编辑。
 */

const LEDGER_EFFECT_LABELS: Readonly<Record<string, string>> = {
  owesYou: "记人情债（对方欠你一次）",
  youOwe: "记人情债（你欠对方一次）",
  grudge: "挂旧仇标记（见面自带敌意）",
};

/** 6 种关系的完整开局数值与机制说明 */
function relationEffect(r: RelationKind): string {
  const info = RELATION_INFO[r];
  const affinity = info.affinity > 0 ? `+${info.affinity}` : `${info.affinity}`;
  const parts = [`好感 ${affinity}`];
  if (info.ledger) {
    parts.push(LEDGER_EFFECT_LABELS[info.ledger] ?? info.ledger);
  }
  if (info.note) {
    parts.push("写入私人关系备注");
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
  /** 原作人物的 id，有原作头像就画头像 */
  readonly npc?: string;
  readonly hasPortrait: boolean;
  readonly fromModule: boolean;
  readonly catalogNpc?: boolean;
  readonly preset?: Acquaintance;
  readonly packId?: string;
}

const customId = () => `custom-${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;

type PeopleFilter = "all" | "portrait" | "linked" | "custom" | "workshop";

function isWorkshopSource(packId?: string): boolean {
  return Boolean(packId && packId !== "local");
}

function matchesPerson(p: Person, query: string): boolean {
  if (!query) return true;
  return `${p.name} ${p.rawName} ${p.role} ${p.faction ?? ""} ${p.look ?? ""} ${p.preset?.note ?? ""}`
    .toLowerCase()
    .includes(query);
}

/**
 * 旧识不限人数：原作人物（已过滤 2075 已故角色）优先展示 12 位核心立绘人物，
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
      return {
        id: n.id,
        rawName: n.name,
        name: n.alias ? `${n.name}（${n.alias}）` : n.name,
        role: n.role,
        ...(n.look ? { look: n.look } : {}),
        ...(n.faction ? { faction: n.faction } : {}),
        npc: n.id,
        hasPortrait,
        fromModule: false,
        ...(n.packId || preset?.catalogNpc ? { catalogNpc: true } : {}),
        ...(n.packId ? { packId: n.packId } : {}),
        ...(preset ? { preset } : {}),
      };
    });
    // 核心立绘人物（12 位原作头像）排在前面
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
  const portraitCount = canon.filter((p) => p.hasPortrait).length;

  const filterList = useMemo(
    () => (list: readonly Person[]) =>
      list.filter((p) => {
        if (filter === "portrait" && !p.hasPortrait) return false;
        if (filter === "linked" && !byId.has(p.id)) return false;
        if (filter === "custom" && !p.fromModule && !own.some((o) => o.id === p.id)) return false;
        if (filter === "workshop" && !isWorkshopSource(p.packId)) return false;
        return matchesPerson(p, normalizedQuery);
      }),
    [filter, byId, own, normalizedQuery],
  );

  const shownModule = filterList(modulePeople);
  const shownOwn = filterList(own);
  const shownCanonPortrait = filterList(canon.filter((p) => p.hasPortrait));
  const shownCanonOther = filterList(canon.filter((p) => !p.hasPortrait));
  const shownPresets = filterList(availableWorkshopPresets);
  const visiblePeople = [
    ...shownModule,
    ...shownOwn,
    ...shownCanonPortrait,
    ...shownCanonOther,
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
      {/* 顶部常驻已选旧识汇总条 */}
      <section className={styles.peopleSummary} aria-label="已建立联系的旧识">
        <CellFrame />
        <div className={styles.peopleSummaryHead}>
          <span className={styles.peopleSummaryTitle}>
            已建交集 <b>{board.acquaintances.length}</b> 人
          </span>
          <span className={styles.note}>
            点击下方旧识卡片定位详情；关系将在入城时直接写入通讯录好感与人情债账本。
          </span>
        </div>
        {board.acquaintances.length > 0 ? (
          <div className={styles.peopleChips}>
            {board.acquaintances.map((item) => (
              <span
                key={item.id}
                className={styles.peopleChip}
                data-active={current?.id === item.id || undefined}
                data-tone={RELATION_INFO[item.relation].affinity < 0 ? "bad" : undefined}
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
        ) : (
          <p className={styles.note}>
            尚未建立额外旧识：可直接从右侧通讯录勾选，或保持孤狼状态入城。
          </p>
        )}
      </section>

      <div className={styles.people}>
        <nav className={styles.peopleList} aria-label="联系人">
          <div className={styles.peopleTools}>
            <FrameBox className={styles.searchBox}>
              <input
                type="search"
                value={query}
                placeholder="搜索姓名、身份、势力或外貌…"
                aria-label="搜索联系人"
                onChange={(e) => setQuery(e.target.value)}
              />
            </FrameBox>
            <fieldset className={styles.shelfFilter} aria-label="按圈层筛选联系人">
              <Button small pressed={filter === "all"} onClick={() => setFilter("all")}>
                全部 ({allPeople.length})
              </Button>
              {portraitCount > 0 && (
                <Button small pressed={filter === "portrait"} onClick={() => setFilter("portrait")}>
                  核心名录 ({portraitCount})
                </Button>
              )}
              <Button small pressed={filter === "linked"} onClick={() => setFilter("linked")}>
                已建联系 ({board.acquaintances.length})
              </Button>
              <Button small pressed={filter === "custom"} onClick={() => setFilter("custom")}>
                故人与自建 ({modulePeople.length + own.length})
              </Button>
              {hasWorkshop && (
                <Button small pressed={filter === "workshop"} onClick={() => setFilter("workshop")}>
                  工坊
                </Button>
              )}
            </fieldset>
          </div>

          {shownModule.length > 0 && (
            <>
              <h3 className={styles.peopleGroup}>出身与特质带出的故人</h3>
              <ul>{shownModule.map(contact)}</ul>
            </>
          )}

          <h3 className={styles.peopleGroup}>自定义旧识</h3>
          {shownOwn.length > 0 && <ul>{shownOwn.map(contact)}</ul>}
          {adding ? (
            <div className={styles.customForm}>
              <CellFrame />
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
          ) : (
            <div>
              <Button small onClick={() => setAdding(true)}>
                ＋ 新建自定义旧识
              </Button>
            </div>
          )}

          {shownCanonPortrait.length > 0 && (
            <>
              <h3 className={styles.peopleGroup}>
                夜之城核心名录
                <small className={styles.peopleCount}>{shownCanonPortrait.length} 人</small>
              </h3>
              <ul>{shownCanonPortrait.map(contact)}</ul>
            </>
          )}

          {shownCanonOther.length > 0 && (
            <>
              <h3 className={styles.peopleGroup}>
                其他原作熟面孔
                <small className={styles.peopleCount}>{shownCanonOther.length} 人</small>
              </h3>
              <ul>{shownCanonOther.map(contact)}</ul>
            </>
          )}

          {shownPresets.length > 0 && (
            <>
              <h3 className={styles.peopleGroup}>工坊人脉预设</h3>
              <ul>{shownPresets.map(contact)}</ul>
            </>
          )}

          {visiblePeople.length === 0 && (
            <p className={styles.note}>没有匹配当前筛选条件的联系人。</p>
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
                      value={a.name}
                      onChange={(e) => {
                        const v = e.target.value.slice(0, 20);
                        if (v.trim() !== "") updateOwnField(current.id, { name: v });
                      }}
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
                  data-tone={RELATION_INFO[r].affinity < 0 ? "bad" : undefined}
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
