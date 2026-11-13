import { type Board, boardPeople, RELATION_INFO, RELATIONS, type RelationKind } from "@cp/core";
import { useState } from "react";
import type { BoardData } from "../../api/client";
import { Asset } from "../../ui/Asset";
import { Button } from "../../ui/Button";
import { CellFrame } from "../../ui/FrameBox";
import { portraitOf } from "../story/art";
import styles from "./characters.module.css";

/**
 * 工作台的人脉选择器。点数只提示不拦截（超出难度预算算传奇沙盒开局）
 */

/** 关系按钮上的小字：开局好感、花不花点（用户定的关系表，2026-10-30） */
function relationNote(r: RelationKind): string {
  const info = RELATION_INFO[r];
  const affinity = info.affinity > 0 ? `+${info.affinity}` : `${info.affinity}`;
  return `好感 ${affinity}${info.points > 0 ? ` · ${info.points} 点` : ""}`;
}

interface Person {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  /** 原作人物的 id，有原作头像就画头像 */
  readonly npc?: string;
  readonly fromModule: boolean;
}

const customId = () => `custom-${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;

/**
 * 旧识不限人数：原作人物全部能选、出身带出的故人也能改关系，还能新建自己的旧识；
 * 每人可以写一句"是什么事"，不写由一键成稿补
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
  const modulePeople: Person[] = boardPeople(board)
    .filter((p) => !board.acquaintances.some((a) => a.id === p.id && a.custom))
    .map((p) => ({ id: p.id, name: p.name, role: p.role, fromModule: true }));
  const own: Person[] = board.acquaintances
    .filter((a) => a.custom)
    .map((a) => ({ id: a.id, name: a.name, role: a.role || "自定义旧识", fromModule: false }));
  const canon: Person[] = data.npcs.map((n) => ({
    id: n.id,
    name: n.alias ? `${n.name}（${n.alias}）` : n.name,
    role: n.role,
    npc: n.id,
    fromModule: false,
  }));
  const byId = new Map(board.acquaintances.map((a) => [a.id, a]));
  const [picked, setPicked] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftRole, setDraftRole] = useState("");
  const current = [...modulePeople, ...own, ...canon].find((p) => p.id === picked) ?? canon[0];

  const setRelation = (p: Person, relation: RelationKind | "") => {
    const had = byId.get(p.id);
    const next = relation
      ? had
        ? board.acquaintances.map((a) => (a.id === p.id ? { ...a, relation } : a))
        : [...board.acquaintances, { id: p.id, name: p.name.slice(0, 20), relation, note: "" }]
      : board.acquaintances.filter((a) => a.id !== p.id);
    commit({ ...board, acquaintances: next });
  };
  const setNote = (id: string, note: string) =>
    commit({
      ...board,
      acquaintances: board.acquaintances.map((a) => (a.id === id ? { ...a, note } : a)),
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
            {face ? <Asset id={face} className={styles.peopleFaceArt} /> : ([...p.name][0] ?? "?")}
          </span>
          <span className={styles.peopleName}>
            <b className={styles.peopleTitle}>{p.name}</b>
            <small className={styles.peopleSub}>
              {a ? RELATION_INFO[a.relation].label : p.role}
            </small>
          </span>
        </button>
      </li>
    );
  };

  const a = current ? byId.get(current.id) : undefined;
  const face = portraitOf(current?.npc);
  const chosen = board.acquaintances.filter((x) => data.npcs.some((n) => n.id === x.id)).length;
  const isOwn = current ? own.some((p) => p.id === current.id) : false;

  return (
    <div className={styles.people}>
      <nav className={styles.peopleList} aria-label="联系人">
        {modulePeople.length > 0 && (
          <>
            <h3 className={styles.peopleGroup}>出身与特质带出的故人</h3>
            <ul>{modulePeople.map(contact)}</ul>
          </>
        )}
        <h3 className={styles.peopleGroup}>自定义旧识</h3>
        <ul>{own.map(contact)}</ul>
        {adding ? (
          <div className={styles.customForm}>
            <label className={styles.field}>
              <span>名字</span>
              <input
                maxLength={20}
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
              />
            </label>
            <label className={styles.field}>
              <span>身份</span>
              <input
                maxLength={80}
                value={draftRole}
                placeholder="例如：沃森区的黑市药贩"
                onChange={(e) => setDraftRole(e.target.value)}
              />
            </label>
            <div className={styles.slotTools}>
              <Button small disabled={draftName.trim() === ""} onClick={addOwn}>
                加入旧识
              </Button>
              <Button small onClick={() => setAdding(false)}>
                取消
              </Button>
            </div>
          </div>
        ) : (
          <Button small onClick={() => setAdding(true)}>
            ＋ 新建自定义旧识
          </Button>
        )}
        <h3 className={styles.peopleGroup}>
          夜之城人脉网络<small className={styles.peopleCount}>已建立联系 {chosen} 人</small>
        </h3>
        <ul>{canon.map(contact)}</ul>
      </nav>
      {current && (
        <section className={styles.peopleCard} aria-label={current.name}>
          <CellFrame />
          <header className={styles.peopleHead}>
            <span className={styles.peopleFace} data-big="" aria-hidden="true">
              {face ? (
                <Asset id={face} className={styles.peopleFaceArt} />
              ) : (
                ([...current.name][0] ?? "?")
              )}
            </span>
            <span className={styles.peopleName}>
              <b className={styles.peopleTitle}>{current.name}</b>
              <small className={styles.peopleSub}>{current.role}</small>
            </span>
          </header>
          <fieldset className={styles.relations} aria-label={`和${current.name}的关系`}>
            <button
              type="button"
              className={styles.relation}
              aria-pressed={!a}
              onClick={() => (isOwn ? dropOwn(current.id) : setRelation(current, ""))}
            >
              <b className={styles.relationLabel}>
                {isOwn ? "移除这位旧识" : current.fromModule ? "沿用默认关系" : "暂无交集"}
              </b>
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
                <b className={styles.relationLabel}>{RELATION_INFO[r].label}</b>
                <small className={styles.relationNote}>{relationNote(r)}</small>
              </button>
            ))}
          </fieldset>
          {a && (
            <input
              className={styles.startInput}
              maxLength={60}
              value={a.note}
              aria-label={`和${current.name}是什么事`}
              placeholder="过往过节或交情（留空则由 AI 自由推演）"
              onChange={(e) => setNote(current.id, e.target.value)}
            />
          )}
        </section>
      )}
    </div>
  );
}
