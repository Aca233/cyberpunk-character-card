import {
  ATTRIBUTE_BASE,
  ATTRIBUTE_CREATE_MAX,
  ATTRIBUTE_POINTS,
  type CharacterCard,
  CharacterCardSchema,
  diceRules,
  pointsSpent,
} from "@cp/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { api, type CharacterEntry } from "../../api/client";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { Panel } from "../../ui/Panel";
import { BoardEditor, emptyBoard } from "./BoardEditor";
import styles from "./characters.module.css";
import { ProseField } from "./ProseField";

type Attribute = keyof CharacterCard["attributes"];

interface Editor {
  readonly id: string | null;
  readonly sample: boolean;
  readonly card: CharacterCard;
  readonly original: string;
}

type Destination = { readonly editor: Editor } | { readonly back: true };

function blankCard(): CharacterCard {
  return {
    name: "",
    alias: "",
    pronoun: "TA",
    origin: "街头小子",
    look: "",
    past: "",
    personality: "",
    voice: "",
    skills: "",
    scene: "",
    greeting: "",
    examples: "",
    locked: [],
    attributes: { body: 3, reflexes: 3, tech: 3, intelligence: 3, cool: 3 },
  };
}

function editorFor(card: CharacterCard, id: string | null = null, sample = false): Editor {
  const copy = { ...card, attributes: { ...card.attributes } };
  return { id, sample, card: copy, original: JSON.stringify(copy) };
}

/** 交给主持人的正文在前；场景、开场白、对话示例只留在卡上 */
const BRIEF_BLOCKS = ["look", "past", "personality", "voice"] as const;
const CARD_BLOCKS = ["scene", "greeting", "examples"] as const;

/** 角色库和手写角色卡；改卡只影响以后新建的存档 */
export function CharactersScreen() {
  const navigate = useNavigate();
  const client = useQueryClient();
  const characters = useQuery({ queryKey: ["characters"], queryFn: api.characters });
  const boardData = useQuery({
    queryKey: ["characterBoard"],
    queryFn: api.characterBoard,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const [editor, setEditor] = useState<Editor>(() => editorFor(blankCard()));
  const [destination, setDestination] = useState<Destination | null>(null);
  const [deleting, setDeleting] = useState<CharacterEntry | null>(null);

  const dirty = !editor.sample && JSON.stringify(editor.card) !== editor.original;
  const parsed = CharacterCardSchema.safeParse(editor.card);
  const remaining = ATTRIBUTE_POINTS - pointsSpent(editor.card.attributes);

  const save = useMutation({
    mutationFn: ({ id, card }: { id: string | null; card: CharacterCard }) =>
      id === null ? api.createCharacter(card) : api.updateCharacter(id, card),
    onSuccess: (entry) => {
      setEditor(editorFor(entry.card, entry.id));
      void client.invalidateQueries({ queryKey: ["characters"] });
    },
  });
  const remove = useMutation({
    mutationFn: api.deleteCharacter,
    onSuccess: (_result, id) => {
      if (editor.id === id) setEditor(editorFor(blankCard()));
      setDeleting(null);
      void client.invalidateQueries({ queryKey: ["characters"] });
    },
  });
  const busy = save.isPending || remove.isPending;

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const go = (next: Destination) => {
    if ("back" in next) navigate("/menu");
    else {
      setEditor(next.editor);
      save.reset();
      remove.reset();
    }
  };
  const requestGo = (next: Destination) => {
    if (busy) return;
    if (dirty) setDestination(next);
    else go(next);
  };
  const change = (patch: Partial<CharacterCard>) => {
    setEditor((old) => ({ ...old, card: { ...old.card, ...patch } }));
    save.reset();
  };
  const dropBoard = () => {
    setEditor((old) => {
      const { board: _, ...card } = old.card;
      return { ...old, card };
    });
    save.reset();
  };

  return (
    <main className={styles.screen}>
      <header className={styles.head}>
        <div>
          <span className={styles.eyebrow}>NIGHT CITY / 身份档案</span>
          <h1>你的角色</h1>
        </div>
        <Button disabled={busy} onClick={() => requestGo({ back: true })}>
          返回主菜单
        </Button>
      </header>

      <div className={styles.workspace}>
        <aside className={styles.library} aria-label="角色库">
          <Button
            primary
            disabled={busy}
            onClick={() => requestGo({ editor: editorFor(blankCard()) })}
          >
            ＋ 新建角色
          </Button>
          <p className={styles.note}>你决定自己是谁，夜之城决定如何回应。</p>
          {characters.isPending && <p role="status">正在读取角色库…</p>}
          {characters.isError && (
            <div role="alert">
              <p className={styles.error}>{characters.error.message}</p>
              <Button onClick={() => void characters.refetch()}>重新读取</Button>
            </div>
          )}
          {characters.isSuccess && characters.data.length === 0 && (
            <p className={styles.note}>还没有角色，从一张空白档案开始。</p>
          )}
          <ul className={styles.cards}>
            {(characters.data ?? []).map((entry) => (
              <li key={entry.id}>
                <button
                  type="button"
                  className={styles.card}
                  aria-pressed={editor.id === entry.id}
                  disabled={busy}
                  onClick={() =>
                    requestGo({ editor: editorFor(entry.card, entry.id, entry.sample) })
                  }
                >
                  <span className={styles.cardKind}>
                    {entry.sample ? "示例 / 只读" : "自建角色"}
                  </span>
                  <strong>{entry.card.name}</strong>
                  <span>
                    {entry.card.origin}
                    {entry.card.alias ? ` · ${entry.card.alias}` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <form
          className={styles.editor}
          onSubmit={(event) => {
            event.preventDefault();
            if (!busy && !editor.sample && parsed.success) {
              save.mutate({ id: editor.id, card: parsed.data });
            }
          }}
        >
          <div className={styles.editorHead}>
            <div>
              <span className={styles.eyebrow}>
                {editor.sample ? "示例档案" : editor.id ? "编辑档案" : "新身份"}
              </span>
              <h2>{editor.card.name.trim() || "尚未命名"}</h2>
            </div>
            <span className={styles.note}>{dirty ? "有未保存的修改" : "本地角色库"}</span>
          </div>

          {editor.sample && (
            <div className={styles.notice}>
              <p>示例角色可以直接用于新存档。想改写背景，先复制成自己的角色。</p>
              <Button disabled={busy} onClick={() => requestGo({ editor: editorFor(editor.card) })}>
                复制并编辑
              </Button>
            </div>
          )}

          <fieldset className={styles.fields} disabled={busy || editor.sample}>
            <legend className={styles.sectionTitle}>01 / 名片</legend>
            <div className={styles.identity}>
              <label className={styles.field}>
                <span>姓名 *</span>
                <input
                  required
                  maxLength={20}
                  value={editor.card.name}
                  onChange={(event) => change({ name: event.target.value })}
                  autoComplete="off"
                />
              </label>
              <label className={styles.field}>
                <span>外号</span>
                <input
                  maxLength={20}
                  value={editor.card.alias}
                  onChange={(event) => change({ alias: event.target.value })}
                />
              </label>
              <label className={styles.field}>
                <span>代词</span>
                <input
                  required
                  maxLength={4}
                  value={editor.card.pronoun}
                  onChange={(event) => change({ pronoun: event.target.value })}
                  placeholder="他 / 她 / TA"
                />
              </label>
              <label className={styles.field}>
                <span>出身 *</span>
                <input
                  required
                  maxLength={40}
                  value={editor.card.origin}
                  onChange={(event) => change({ origin: event.target.value })}
                  placeholder="街头小子、流浪者，或自己的出身"
                />
              </label>
            </div>

            <div className={styles.sectionHead}>
              <h3 className={styles.sectionTitle}>02 / 属性</h3>
              <span className={styles.points} role="status">
                剩余 {remaining} / {ATTRIBUTE_POINTS} 点
              </span>
            </div>
            <p className={styles.note}>
              各项从 {ATTRIBUTE_BASE} 起步，额外分配 {ATTRIBUTE_POINTS} 点，创建时单项最高{" "}
              {ATTRIBUTE_CREATE_MAX}。
            </p>
            <div className={styles.attributes}>
              {(Object.entries(diceRules.ATTRIBUTE_LABELS) as [Attribute, string][]).map(
                ([key, label]) => (
                  <div className={styles.attribute} key={key}>
                    <label htmlFor={`character-${key}`}>{label}</label>
                    <div className={styles.stepper}>
                      <button
                        type="button"
                        aria-label={`减少${label}`}
                        disabled={editor.card.attributes[key] <= ATTRIBUTE_BASE}
                        onClick={() =>
                          change({
                            attributes: {
                              ...editor.card.attributes,
                              [key]: editor.card.attributes[key] - 1,
                            },
                          })
                        }
                      >
                        −
                      </button>
                      <output id={`character-${key}`}>{editor.card.attributes[key]}</output>
                      <button
                        type="button"
                        aria-label={`增加${label}`}
                        disabled={
                          remaining <= 0 || editor.card.attributes[key] >= ATTRIBUTE_CREATE_MAX
                        }
                        onClick={() =>
                          change({
                            attributes: {
                              ...editor.card.attributes,
                              [key]: editor.card.attributes[key] + 1,
                            },
                          })
                        }
                      >
                        ＋
                      </button>
                    </div>
                  </div>
                ),
              )}
            </div>

            <div className={styles.sectionHead}>
              <h3 className={styles.sectionTitle}>03 / 角色主板</h3>
              {editor.card.board && !editor.sample && (
                <button type="button" className={styles.toolButton} onClick={dropBoard}>
                  拆掉主板
                </button>
              )}
            </div>
            {!editor.card.board && (
              <div className={styles.notice}>
                <p>
                  主板把出身、过往、本事做成一块块模块：每块写明你能做到什么、带着什么麻烦，主持人据此判断行动和给出专属选项。
                  只写下面的文字也能玩。
                </p>
                {boardData.isError && <p className={styles.error}>{boardData.error.message}</p>}
                {!editor.sample && (
                  <Button
                    disabled={!boardData.isSuccess}
                    reason="正在读取模块库"
                    onClick={() => change({ board: emptyBoard() })}
                  >
                    启用角色主板
                  </Button>
                )}
              </div>
            )}
            {editor.card.board && boardData.isSuccess && (
              <BoardEditor
                board={editor.card.board}
                data={boardData.data}
                onChange={(board, origin) => change({ board, ...(origin ? { origin } : {}) })}
              />
            )}
            {editor.card.board && boardData.isPending && <p role="status">正在读取模块库…</p>}

            <h3 className={styles.sectionTitle}>04 / 这个人</h3>
            <p className={styles.note}>
              每块都可以手写，也可以交给辅助模型生成、重写、续写或润色（每次花一次模型调用）；
              模型按名片、属性、主板和别的区块来写，锁定的区块不会被改。说话方式不代表模型可以替你说话。
            </p>
            <div className={styles.proseBlocks}>
              {BRIEF_BLOCKS.map((block) => (
                <ProseField key={block} block={block} card={editor.card} onChange={change} />
              ))}
              <label className={styles.field}>
                <span>
                  本事
                  <small>{editor.card.skills.length} / 400</small>
                </span>
                <textarea
                  rows={3}
                  maxLength={400}
                  value={editor.card.skills}
                  placeholder="会什么、不会什么；已有的能力，不是希望将来获得的能力。"
                  onChange={(event) => change({ skills: event.target.value })}
                />
              </label>
            </div>
            <h4 className={styles.subTitle}>
              卡面{" "}
              <small className={styles.subNote}>
                场景、开场白和对话示例只留在卡上，不交给主持人
              </small>
            </h4>
            <div className={styles.proseBlocks}>
              {CARD_BLOCKS.map((block) => (
                <ProseField key={block} block={block} card={editor.card} onChange={change} />
              ))}
            </div>
          </fieldset>

          {!editor.sample && (
            <footer className={styles.actions}>
              <p className={styles.note}>修改或删除角色卡不会改写已有存档里的角色。</p>
              {!parsed.success && <p className={styles.note}>{parsed.error.issues[0]?.message}</p>}
              {save.isError && (
                <p className={styles.error} role="alert">
                  {save.error.message}
                </p>
              )}
              {save.isSuccess && (
                <p className={styles.success} role="status">
                  角色已保存，可以用于新存档。
                </p>
              )}
              <div className={styles.buttons}>
                <Button type="submit" primary disabled={busy || !parsed.success}>
                  {save.isPending ? "保存中…" : "保存角色"}
                </Button>
                {editor.id !== null && (
                  <Button
                    disabled={busy}
                    onClick={() => {
                      const entry = characters.data?.find((item) => item.id === editor.id);
                      if (entry && !entry.sample) {
                        remove.reset();
                        setDeleting(entry);
                      }
                    }}
                  >
                    删除角色
                  </Button>
                )}
              </div>
            </footer>
          )}
        </form>

        <aside className={styles.guide}>
          <Panel title="你来扮演">
            <p>台词、行动和心里话都由你写。背景只是让世界更了解你，不替你决定下一步。</p>
            <p>
              主板上的模块是你已经会的、已经欠下的；联动和钩子是夜之城找上门的理由。自写模块、角色卡正文生成和导入还没开放。
            </p>
          </Panel>
        </aside>
      </div>

      {destination && (
        <Dialog
          title="放弃未保存的修改？"
          onClose={() => setDestination(null)}
          actions={
            <>
              <Button onClick={() => setDestination(null)}>继续编辑</Button>
              <Button
                onClick={() => {
                  const next = destination;
                  setDestination(null);
                  go(next);
                }}
              >
                放弃修改
              </Button>
            </>
          }
        >
          <p>当前角色卡的修改还没有保存。</p>
        </Dialog>
      )}
      {deleting && (
        <Dialog
          title={`删除「${deleting.card.name}」？`}
          tone="danger"
          onClose={() => {
            if (!remove.isPending) setDeleting(null);
          }}
          actions={
            <>
              <Button disabled={remove.isPending} onClick={() => setDeleting(null)}>
                取消
              </Button>
              <Button disabled={remove.isPending} onClick={() => remove.mutate(deleting.id)}>
                {remove.isPending ? "删除中…" : "确认删除"}
              </Button>
            </>
          }
        >
          <p>角色卡会从本地角色库删除，未保存的修改会丢弃。已有存档不受影响。</p>
          {remove.isError && (
            <p className={styles.error} role="alert">
              {remove.error.message}
            </p>
          )}
        </Dialog>
      )}
    </main>
  );
}
