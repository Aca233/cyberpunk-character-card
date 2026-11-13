import { type CharacterCard, CharacterCardSchema, DEFAULT_CARD_ATTRIBUTES } from "@cp/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { api, type CharacterEntry } from "../../api/client";
import { Asset, cssUrl, NineSlice } from "../../ui/Asset";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { CellFrame } from "../../ui/FrameBox";
import { BoardEditor, emptyBoard } from "./BoardEditor";
import { CharacterCreator, type CreatorStart } from "./CharacterCreator";
import styles from "./characters.module.css";
import { clearDraft, loadDraft, STEPS } from "./creator";
import { ProseField } from "./ProseField";
import { downloadCard, readCardFile } from "./tavernFile";
import wb from "./workbench.module.css";

/** 原作 panel.frame（1060×1560）：切角和侧边缺口都在离边 120 原图像素以内，按 120 切（同设置页） */
const FRAME_SLICE = 120;

interface Editor {
  readonly id: string | null;
  readonly sample: boolean;
  readonly card: CharacterCard;
  readonly original: string;
  /** 分步捏人（creator-plan，2026-10-30）：切换角色才换会话，保存拿到 id 时不换，避免打断建档 */
  readonly session: string;
  /** 新角色从出身开始，草稿恢复进度，已有主板的角色从档案确认开始 */
  readonly start: CreatorStart;
  /** 刚导入、还没保存的卡：导入时的提示 */
  readonly imported?: { readonly warnings: readonly string[]; readonly own: boolean };
}

type Destination = { readonly editor: Editor } | { readonly back: true };

/** 新角色一律带主板（creator-plan "主板必选"）；出身由第 1 步选的出身模块填 */
function blankCard(): CharacterCard {
  return {
    name: "",
    alias: "",
    pronoun: "TA",
    origin: "",
    look: "",
    past: "",
    personality: "",
    voice: "",
    skills: "",
    scene: "",
    greeting: "",
    examples: "",
    locked: [],
    attributes: { ...DEFAULT_CARD_ATTRIBUTES },
    board: emptyBoard(),
  };
}

let sessions = 0;
const newSession = () => `editor-${++sessions}`;

const FRESH: CreatorStart = { step: "origin", reached: 0, startLocation: "", rerolls: 0 };
/** 已有主板的卡：直接到档案确认，走过的步都能点回去 */
const REVIEW: CreatorStart = {
  step: "review",
  reached: STEPS.length - 1,
  startLocation: "",
  rerolls: 0,
};

function editorFor(card: CharacterCard, id: string | null = null, sample = false): Editor {
  const copy = { ...card, attributes: { ...card.attributes } };
  return {
    id,
    sample,
    card: copy,
    original: JSON.stringify(copy),
    session: newSession(),
    start: id === null ? FRESH : REVIEW,
  };
}

/** 打开页面时有没存进角色库的草稿就接着捏；草稿没进过角色库，算未保存（original 留空） */
function initialEditor(): Editor {
  const draft = loadDraft(blankCard());
  if (!draft) return editorFor(blankCard());
  return {
    id: null,
    sample: false,
    card: draft.card,
    original: "",
    session: newSession(),
    start: {
      step: draft.step,
      reached: Math.max(
        Math.floor(draft.reached),
        STEPS.findIndex((s) => s.id === draft.step),
      ),
      startLocation: draft.startLocation,
      rerolls: draft.rerolls,
    },
  };
}

/** 交给叙事模型的正文在前；场景、开场白、对话示例只留在卡上 */
const BRIEF_BLOCKS = ["look", "past", "personality", "voice"] as const;

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
  const [editor, setEditor] = useState<Editor>(initialEditor);
  const [destination, setDestination] = useState<Destination | null>(null);
  const [deleting, setDeleting] = useState<CharacterEntry | null>(null);
  const [showLibrary, setShowLibrary] = useState(false);

  const dirty = !editor.sample && JSON.stringify(editor.card) !== editor.original;
  const parsed = CharacterCardSchema.safeParse(editor.card);

  const save = useMutation({
    mutationFn: ({ id, card }: { id: string | null; card: CharacterCard }) =>
      id === null ? api.createCharacter(card) : api.updateCharacter(id, card),
    onSuccess: (entry) => {
      // 同一个会话里保存：只换 id、卡和"已保存"的基准，分步外壳不重建（保存并开新档还在等这一步）
      setEditor((old) => {
        const { imported: _, ...current } = old;
        const copy = { ...entry.card, attributes: { ...entry.card.attributes } };
        return {
          ...current,
          id: entry.id,
          sample: false,
          card: copy,
          original: JSON.stringify(copy),
        };
      });
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
  const [useModel, setUseModel] = useState(true);
  const fileInput = useRef<HTMLInputElement>(null);
  const importCard = useMutation({
    mutationFn: async ({ file, model }: { file: File; model: boolean }) =>
      api.importCharacter({ raw: await readCardFile(file), useModel: model }),
    onSuccess: ({ card, warnings, own }) => {
      // 导入的卡不保存，original 留空让它算作未保存
      const next: Destination = {
        editor: {
          ...editorFor(card),
          original: "",
          imported: { warnings, own },
        },
      };
      if (dirty) setDestination(next);
      else go(next);
    },
  });
  const busy = save.isPending || remove.isPending || importCard.isPending;

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
    // 从新角色离开（换新会话、看示例、切到已存角色、回主菜单）时，草稿要么已经在确认框里放弃、要么没改过，
    // 清掉免得下次打开又被接上（2026-10-30 浏览器走查发现：点了"放弃修改"草稿还在）。
    // 关页面、刷新不经过这里，草稿照旧留着接着捏
    if (editor.id === null) clearDraft();
    if ("back" in next) navigate("/menu");
    else {
      setEditor(next.editor);
      setShowLibrary(false);
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
      {/*
       * 外框照设置页和神经界面（用户 2026-10-30 反馈"这UI好丑而且完全没有排版"）：
       * 夜之城远景压暗、扫描线、原作 panel.frame 红框，顶部 menu.header 垫标题；都不挡点击
       */}
      <span
        className={styles.bg}
        style={{ backgroundImage: cssUrl("menu.nightCity") }}
        aria-hidden
      />
      <span className={styles.shade} aria-hidden />
      <span
        className={styles.scan}
        style={{ backgroundImage: cssUrl("fx.scanlines") }}
        aria-hidden
      />
      <NineSlice
        id="panel.frame"
        tint="var(--cp-red)"
        slice={FRAME_SLICE}
        className={styles.frame}
      />
      <header className={styles.head}>
        <Asset id="menu.header" tint="var(--cp-red)" height={56} className={styles.headBg} />
        <h1>身份档案</h1>
        <Asset id="fluff.code" tint="var(--cp-red)" height={14} />
        <span className={styles.headSpacer} />
        <Button
          small
          disabled={busy}
          pressed={showLibrary}
          onClick={() => setShowLibrary((open) => !open)}
        >
          角色库{characters.data ? `（${characters.data.length}）` : ""}
        </Button>
        <Button small disabled={busy} onClick={() => requestGo({ back: true })}>
          返回主菜单
        </Button>
      </header>

      <div className={wb.workspace}>
        {showLibrary && (
          <aside className={wb.libraryDrawer} aria-label="角色库">
            <div className={wb.topBar}>
              <strong>角色库</strong>
              <span className={styles.headSpacer} />
              <button
                type="button"
                className={styles.toolButton}
                onClick={() => setShowLibrary(false)}
              >
                收起
              </button>
            </div>
            <Button
              primary
              disabled={busy}
              onClick={() => requestGo({ editor: editorFor(blankCard()) })}
            >
              ＋ 新建角色
            </Button>
            <div className={styles.importBox}>
              <Button disabled={busy} onClick={() => fileInput.current?.click()}>
                {importCard.isPending ? "正在导入…" : "导入角色卡"}
              </Button>
              <label className={styles.importOption}>
                <input
                  type="checkbox"
                  className={styles.importCheck}
                  checked={useModel}
                  disabled={busy}
                  onChange={(event) => setUseModel(event.target.checked)}
                />
                <span>由 AI 自动配置主板与属性（消耗一次模型调用；导入本作导出的角色卡除外）</span>
              </label>
              <input
                ref={fileInput}
                type="file"
                hidden
                accept=".json,.png,application/json,image/png"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) importCard.mutate({ file, model: useModel });
                }}
              />
              {importCard.isError && (
                <p className={styles.error} role="alert">
                  {importCard.error.message}
                </p>
              )}
            </div>
            {characters.isPending && <p role="status">正在读取角色库…</p>}
            {characters.isError && (
              <div role="alert">
                <p className={styles.error}>{characters.error.message}</p>
                <Button onClick={() => void characters.refetch()}>重新读取</Button>
              </div>
            )}
            {characters.isSuccess && characters.data.length === 0 && (
              <p className={styles.note}>还没有角色。</p>
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
                    <CellFrame />
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
        )}

        {editor.card.board && !editor.sample ? (
          <section className={wb.editorWrap} aria-label="角色设计工作台">
            {editor.imported && (
              <div className={styles.notice} role="status">
                <p>
                  {editor.imported.own
                    ? "这是本作导出的角色卡，已经原样还原。"
                    : "从角色卡导入：文本已填入对应区块，主板模块与属性已由 AI 匹配。"}
                  检查一遍再保存，保存后才进角色库。
                </p>
                {editor.imported.warnings.length > 0 && (
                  <ul className={styles.warnings}>
                    {editor.imported.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {boardData.isError && <p className={styles.error}>{boardData.error.message}</p>}
            {boardData.isPending && <p role="status">正在读取模块库…</p>}
            {boardData.isSuccess && (
              <div className={wb.benchHost}>
                <CharacterCreator
                  key={editor.session}
                  card={{ ...editor.card, board: editor.card.board }}
                  data={boardData.data}
                  onChange={change}
                  start={editor.start}
                  draftable={editor.id === null && !editor.imported}
                  saving={save.isPending}
                  saveError={save.isError ? save.error.message : null}
                  saved={save.isSuccess && !dirty}
                  onSave={(card) => save.mutateAsync({ id: editor.id, card })}
                  onExport={parsed.success ? () => downloadCard(parsed.data) : undefined}
                  onDelete={
                    editor.id !== null
                      ? () => {
                          const entry = characters.data?.find((item) => item.id === editor.id);
                          if (entry && !entry.sample) {
                            remove.reset();
                            setDeleting(entry);
                          }
                        }
                      : undefined
                  }
                />
              </div>
            )}
          </section>
        ) : (
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
              <div className={styles.headTools}>
                <span className={styles.note}>{dirty ? "有未保存的修改" : "本地角色库"}</span>
                <Button
                  disabled={busy || !parsed.success}
                  reason="角色卡还没填完整"
                  onClick={() => {
                    if (parsed.success) downloadCard(parsed.data);
                  }}
                >
                  导出角色卡
                </Button>
              </div>
            </div>

            {editor.imported && (
              <div className={styles.notice} role="status">
                <p>
                  {editor.imported.own
                    ? "这是本作导出的角色卡，已经原样还原。"
                    : "从角色卡导入：文本已填入对应区块，主板模块与属性已由 AI 匹配并完成合规校准。"}
                  检查一遍再保存，保存后才进角色库。
                </p>
                {editor.imported.warnings.length > 0 && (
                  <ul className={styles.warnings}>
                    {editor.imported.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {editor.sample && (
              <div className={styles.notice}>
                <p>示例角色可以直接用于新存档。想改写背景，先复制成自己的角色。</p>
                <Button
                  disabled={busy}
                  onClick={() => requestGo({ editor: editorFor(editor.card) })}
                >
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
                <h3 className={styles.sectionTitle}>02 / 角色主板</h3>
                {editor.card.board && !editor.sample && (
                  <button type="button" className={styles.toolButton} onClick={dropBoard}>
                    拆掉主板
                  </button>
                )}
              </div>
              {!editor.card.board && (
                <div className={styles.notice}>
                  {/* 旧卡兼容（creator-plan "主板必选"）：照旧能编辑、能开档；补上主板后换成分步捏人，按新流程校验 */}
                  {!editor.sample && (
                    <p>这是旧式纯文字卡，可以照旧编辑，也可以补一块主板，改用分步捏人。</p>
                  )}
                  {boardData.isError && <p className={styles.error}>{boardData.error.message}</p>}
                  {!editor.sample && (
                    <Button
                      disabled={!boardData.isSuccess}
                      reason="正在读取模块库"
                      onClick={() => change({ board: emptyBoard() })}
                    >
                      补一块主板
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

              <h3 className={styles.sectionTitle}>03 / 这个人</h3>
              <p className={styles.note}>
                可调用辅助模型生成、重写、续写或润色（消耗一次调用）；锁定的区块不会被改写。
              </p>
              <div className={styles.proseBlocks}>
                {BRIEF_BLOCKS.map((block) => (
                  <ProseField key={block} block={block} card={editor.card} onChange={change} />
                ))}
              </div>
            </fieldset>

            {!editor.sample && (
              <footer className={styles.actions}>
                <p className={styles.note}>修改或删除角色卡不会改写已有存档里的角色。</p>
                {!parsed.success && (
                  <p className={styles.note}>{parsed.error.issues[0]?.message}</p>
                )}
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
        )}
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
