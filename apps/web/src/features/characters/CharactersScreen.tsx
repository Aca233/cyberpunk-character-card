import { type CharacterCard, CharacterCardSchema, WorkshopCharacterExportSchema } from "@cp/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { api, type CharacterEntry } from "../../api/client";
import { ActionButton } from "../../ui/ActionButton";
import { Asset, cssUrl, NineSlice } from "../../ui/Asset";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { CellFrame, FrameBox } from "../../ui/FrameBox";
import { useLayer } from "../../ui/layers";
import { GeneratedImage } from "../images/GeneratedImage";
import { CharacterCreator } from "./CharacterCreator";
import { clearDraft, emptyBoard, loadDraft, saveDraft } from "./creator";
import wb from "./workbench.module.css";

/** 原作 panel.frame（1060×1560）：切角和侧边缺口都在离边 120 原图像素以内，按 120 切（同设置页） */
const FRAME_SLICE = 120;

interface Editor {
  readonly id: string | null;
  readonly sample: boolean;
  readonly card: CharacterCard;
  readonly original: string;
  /** 切换角色才换会话，保存拿到 id 时不换，避免打断建档 */
  readonly session: string;
}

type Destination =
  | { readonly editor: Editor }
  | { readonly back: true }
  | { readonly importCard: CharacterCard };

/** 对官方模板忽略仅变更 startLocation 的差异，避免仅挑起点就触发误标脏并强制另存副本。 */
function isCardModified(card: CharacterCard, original: string, sample: boolean): boolean {
  const serialized = JSON.stringify(card);
  if (serialized === original) return false;
  if (!sample) return true;
  try {
    const base = JSON.parse(original) as CharacterCard;
    const stripLoc = (c: CharacterCard) => {
      if (!c.board) return c;
      const { startLocation: _loc, ...restBoard } = c.board;
      return { ...c, board: restBoard };
    };
    return JSON.stringify(stripLoc(card)) !== JSON.stringify(stripLoc(base));
  } catch {
    return true;
  }
}

/** 新角色默认带空白主板 */
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
    locked: [],
    board: emptyBoard(),
  };
}

let sessions = 0;
const newSession = () => `editor-${++sessions}`;

function editorFor(card: CharacterCard, id: string | null = null, sample = false): Editor {
  const board = card.board ?? emptyBoard();
  const copy: CharacterCard = {
    ...card,
    board,
  };
  return {
    id,
    sample,
    card: copy,
    original: JSON.stringify(copy),
    session: newSession(),
  };
}

function downloadCharacter(card: CharacterCard): string {
  const { portrait: _portrait, ...shareable } = card;
  const payload = WorkshopCharacterExportSchema.parse({
    format: "cp2077-character",
    version: 1,
    character: shareable,
  });
  const fileName = `角色-${(card.name || "未命名").replace(/[\\/:*?"<>|]/g, "_")}.json`;
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return fileName;
}

/** 恢复未保存的修改，同时保留原角色 id，避免刷新后再保存生成重复角色。 */
function initialEditor(): Editor {
  const draft = loadDraft(blankCard());
  if (!draft) return editorFor(blankCard());
  return {
    id: draft.characterId ?? null,
    sample: draft.sample ?? false,
    card: {
      ...draft.card,
      board: {
        ...(draft.card.board ?? emptyBoard()),
        ...(draft.startLocation ? { startLocation: draft.startLocation } : {}),
      },
    },
    original: draft.original ?? "",
    session: newSession(),
  };
}

/** 角色库与 2077 赛博档案工作台 */
export function CharactersScreen() {
  const navigate = useNavigate();
  const client = useQueryClient();
  const importRef = useRef<HTMLInputElement>(null);
  const characters = useQuery({ queryKey: ["characters"], queryFn: api.characters });
  const boardData = useQuery({
    queryKey: ["characterBoard"],
    queryFn: api.characterBoard,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const [editor, setEditor] = useState<Editor>(initialEditor);
  const currentEditor = useRef(editor);
  currentEditor.current = editor;
  const [destination, setDestination] = useState<Destination | null>(null);
  const [deleting, setDeleting] = useState<CharacterEntry | null>(null);
  const [shareNotice, setShareNotice] = useState<{
    readonly tone: "ok" | "error";
    readonly text: string;
  } | null>(null);
  const [showLibrary, setShowLibrary] = useState(false);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [launching, setLaunching] = useState(false);
  const [draftSaved, setDraftSaved] = useState(true);

  useLayer(() => setShowLibrary(false), showLibrary && !destination && !deleting);

  const modified = isCardModified(editor.card, editor.original, editor.sample);
  const dirty = modified;
  const parsed = CharacterCardSchema.safeParse(editor.card);

  const save = useMutation({
    mutationFn: ({ id, card }: { id: string | null; card: CharacterCard; session: string }) =>
      id === null ? api.createCharacter(card) : api.updateCharacter(id, card),
    onSuccess: (entry, submitted) => {
      setEditor((old) => {
        if (old.session !== submitted.session) return old;
        const copy: CharacterCard = {
          ...entry.card,
          board: entry.card.board ?? emptyBoard(),
        };
        return {
          ...old,
          id: entry.id,
          sample: false,
          card: JSON.stringify(old.card) === JSON.stringify(submitted.card) ? copy : old.card,
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

  const commitImport = useMutation({
    mutationFn: (card: CharacterCard) => api.createCharacter(card),
    onSuccess: async (entry) => {
      await client.invalidateQueries({ queryKey: ["characters"] });
      clearDraft();
      setEditor(editorFor(entry.card, entry.id));
      setShowLibrary(false);
      save.reset();
      remove.reset();
      setShareNotice({ tone: "ok", text: `已导入角色「${entry.card.name}」并加入本地角色库` });
    },
    onError: (error) => setShareNotice({ tone: "error", text: `角色卡导入失败：${error.message}` }),
  });

  const importCard = useMutation({
    mutationFn: async (file: File) => {
      const raw: unknown = JSON.parse(await file.text());
      const parsed = WorkshopCharacterExportSchema.safeParse(raw);
      if (!parsed.success) throw new Error("文件不是本作导出的角色卡");
      return CharacterCardSchema.parse(parsed.data.character);
    },
    onSuccess: (card) => {
      const current = currentEditor.current;
      if (isCardModified(current.card, current.original, current.sample)) {
        setDestination({ importCard: card });
      } else {
        commitImport.mutate(card);
      }
    },
    onError: (error) => setShareNotice({ tone: "error", text: `角色卡导入失败：${error.message}` }),
  });

  const busy =
    save.isPending ||
    remove.isPending ||
    launching ||
    importCard.isPending ||
    commitImport.isPending;

  const importCharacter = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file && !busy) importCard.mutate(file);
  };

  useEffect(() => {
    if (!dirty) {
      clearDraft();
      return;
    }
    setDraftSaved(
      saveDraft({
        card: editor.card,
        startLocation: editor.card.board?.startLocation ?? "",
        characterId: editor.id,
        sample: editor.sample,
        original: editor.original,
      }),
    );
  }, [editor, dirty]);

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
    clearDraft();
    if ("back" in next) navigate("/menu");
    else if ("importCard" in next) commitImport.mutate(next.importCard);
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

  const handleCardChange = (next: CharacterCard | ((current: CharacterCard) => CharacterCard)) => {
    setEditor((old) => ({ ...old, card: typeof next === "function" ? next(old.card) : next }));
    if (!save.isPending && save.isError) save.reset();
  };

  const allCharacters = characters.data ?? [];
  const filteredCharacters = useMemo(() => {
    const q = libraryQuery.trim().toLowerCase();
    if (!q) return allCharacters;
    return allCharacters.filter((entry) => {
      const hay = `${entry.card.name} ${entry.card.alias} ${entry.card.origin} ${entry.card.board?.origin?.label ?? ""}`;
      return hay.toLowerCase().includes(q);
    });
  }, [allCharacters, libraryQuery]);
  const customCharacters = filteredCharacters.filter((entry) => !entry.sample);
  const sampleCharacters = filteredCharacters.filter((entry) => entry.sample);

  const renderEntryCard = (entry: CharacterEntry) => {
    const b = entry.card.board;
    const traitCount = (b?.skills.length ?? 0) + (b?.pasts.length ?? 0);
    const cyberCount = b?.cyberware.length ?? 0;
    return (
      <li key={entry.id}>
        <button
          type="button"
          className={wb.card}
          aria-pressed={editor.id === entry.id}
          disabled={busy}
          onClick={() => requestGo({ editor: editorFor(entry.card, entry.id, entry.sample) })}
        >
          <CellFrame />
          <div className={wb.cardRow}>
            {entry.card.portrait && (
              <span className={wb.cardThumb}>
                <GeneratedImage
                  imageId={entry.card.portrait}
                  alt={entry.card.name}
                  className={wb.portraitImg}
                />
              </span>
            )}
            <div className={wb.cardMetaCol}>
              <span className={wb.cardKind}>
                {entry.sample ? "官方预设 · 可直接开局或另存" : "自建角色"}
              </span>
              <strong>
                {entry.card.name}
                {entry.card.alias ? `「${entry.card.alias}」` : ""}
              </strong>
              <span>
                {entry.card.origin || b?.origin?.label || "未知出身"}
                {b ? ` · 特质 ${traitCount} · 义体 ${cyberCount}` : ""}
              </span>
            </div>
          </div>
        </button>
      </li>
    );
  };

  return (
    <main className={wb.screen}>
      <span className={wb.bg} style={{ backgroundImage: cssUrl("menu.nightCity") }} aria-hidden />
      <span className={wb.shade} aria-hidden />
      <span className={wb.scan} style={{ backgroundImage: cssUrl("fx.scanlines") }} aria-hidden />
      <NineSlice id="panel.frame" tint="var(--cp-red)" slice={FRAME_SLICE} className={wb.frame} />
      <header className={wb.head}>
        <Asset id="menu.header" tint="var(--cp-red)" height={52} className={wb.headBg} />
        <Asset id="panel.glowLeft" height={28} tint="var(--cp-cyan)" className={wb.headGlow} />
        <div className={wb.headTitleWrap}>
          <span className={wb.headCode}>{"ID // DOSSIER"}</span>
          <h1>身份档案</h1>
        </div>
        <Asset id="fluff.code" tint="var(--cp-red)" height={14} className={wb.headFluff} />
        <span className={wb.headSpacer} />
        <input
          ref={importRef}
          hidden
          type="file"
          accept=".json,application/json"
          onChange={importCharacter}
        />
        <fieldset className={wb.headGroup} aria-label="角色库与分享">
          <Button
            small
            disabled={busy}
            pressed={showLibrary}
            onClick={() => setShowLibrary((open) => !open)}
          >
            角色库{characters.data ? ` (${characters.data.length})` : ""}
          </Button>
          <Button
            small
            disabled={busy}
            onClick={() => requestGo({ editor: editorFor(blankCard()) })}
          >
            ＋ 新建
          </Button>
          <Button small disabled={busy} onClick={() => importRef.current?.click()}>
            {importCard.isPending || commitImport.isPending ? "导入中…" : "导入"}
          </Button>
          <Button
            small
            disabled={!parsed.success || busy}
            reason={!parsed.success ? "先填写角色名与基本资料后即可导出" : undefined}
            onClick={() => {
              const fileName = downloadCharacter(editor.card);
              setShareNotice({ tone: "ok", text: `已导出角色档案 ${fileName}` });
            }}
          >
            导出
          </Button>
        </fieldset>
        <span className={wb.headDivider} aria-hidden />
        <fieldset className={wb.headGroup} aria-label="页面导航">
          <Button small disabled reason="创意工坊尚未完成，暂未启用">
            创意工坊（未完成）
          </Button>
          <Button small disabled={busy} onClick={() => requestGo({ back: true })}>
            返回主菜单
          </Button>
        </fieldset>
      </header>
      <span
        className={wb.headLine}
        style={{
          maskImage: cssUrl("tab.line"),
          WebkitMaskImage: cssUrl("tab.line"),
        }}
        aria-hidden
      />

      <div className={wb.workspace}>
        {showLibrary && (
          <>
            <button
              type="button"
              aria-label="收起角色库"
              className={wb.libraryBackdrop}
              onClick={() => setShowLibrary(false)}
            />
            <aside className={wb.libraryDrawer} aria-label="角色库">
              <NineSlice
                id="notify.itemCellBg"
                tint="rgb(8 8 14 / 97%)"
                slice={30}
                className={wb.drawerLayer}
              />
              <NineSlice
                id="notify.itemCellFg"
                tint="var(--cp-red)"
                slice={30}
                className={wb.drawerLayer}
              />
              <div className={wb.drawerScroll}>
                <div className={wb.topBar}>
                  <strong className={wb.drawerTitle}>夜之城角色库</strong>
                  <span className={wb.headSpacer} />
                  <Button small disabled={busy} onClick={() => importRef.current?.click()}>
                    导入 JSON
                  </Button>
                  <Button small keyId="key.esc" onClick={() => setShowLibrary(false)}>
                    收起
                  </Button>
                </div>
                {allCharacters.length > 3 && (
                  <FrameBox className={wb.drawerSearch}>
                    <input
                      type="search"
                      value={libraryQuery}
                      placeholder="搜索角色名、代号或出身…"
                      aria-label="搜索角色库"
                      onChange={(e) => setLibraryQuery(e.target.value)}
                    />
                  </FrameBox>
                )}
                {characters.isPending && <p role="status">正在读取角色库…</p>}
                {characters.isError && (
                  <div role="alert">
                    <p className={wb.error}>{characters.error.message}</p>
                    <Button small onClick={() => void characters.refetch()}>
                      重新读取
                    </Button>
                  </div>
                )}
                {characters.isSuccess && allCharacters.length === 0 && (
                  <p className={wb.note}>还没有角色。</p>
                )}
                {characters.isSuccess &&
                  allCharacters.length > 0 &&
                  filteredCharacters.length === 0 && (
                    <p className={wb.note}>没有匹配「{libraryQuery}」的角色档案。</p>
                  )}
                {customCharacters.length > 0 && (
                  <section className={wb.libraryGroup} aria-label="自建角色">
                    <h2 className={wb.libraryGroupTitle}>自建角色（{customCharacters.length}）</h2>
                    <ul className={wb.cards}>{customCharacters.map(renderEntryCard)}</ul>
                  </section>
                )}
                {sampleCharacters.length > 0 && (
                  <section className={wb.libraryGroup} aria-label="官方预设模板">
                    <h2 className={wb.libraryGroupTitle}>
                      官方预设模板（{sampleCharacters.length}）
                    </h2>
                    <ul className={wb.cards}>{sampleCharacters.map(renderEntryCard)}</ul>
                  </section>
                )}
              </div>
            </aside>
          </>
        )}

        <section className={wb.editorWrap} aria-label="角色设计工作台">
          {shareNotice && (
            <div
              className={wb.shareBanner}
              data-tone={shareNotice.tone}
              role={shareNotice.tone === "error" ? "alert" : "status"}
            >
              <CellFrame />
              <p className={wb.shareBannerText}>{shareNotice.text}</p>
              <ActionButton onClick={() => setShareNotice(null)}>关闭</ActionButton>
            </div>
          )}
          {boardData.isPending && <p role="status">正在读取出身、特质与义体目录…</p>}
          {boardData.isError && (
            <div role="alert">
              <p className={wb.error}>{boardData.error.message}</p>
              <Button small onClick={() => void boardData.refetch()}>
                重新读取创角目录
              </Button>
            </div>
          )}
          <div className={wb.benchHost}>
            <CharacterCreator
              key={editor.session}
              card={{ ...editor.card, board: editor.card.board ?? emptyBoard() }}
              boardData={boardData.data}
              busy={busy}
              canSave={parsed.success}
              canDelete={editor.id !== null && !editor.sample}
              isSample={editor.sample}
              dirty={modified}
              characterId={editor.id}
              saveError={save.isError ? save.error.message : null}
              saved={editor.id !== null && !editor.sample && !dirty}
              draftSaved={draftSaved}
              onLaunchingChange={setLaunching}
              onChange={handleCardChange}
              onSave={(card) =>
                save.mutateAsync({
                  id: editor.sample ? null : editor.id,
                  card,
                  session: editor.session,
                })
              }
              onDelete={() => {
                if (!editor.id || editor.sample) return;
                const entry = characters.data?.find((item) => item.id === editor.id);
                if (entry && !entry.sample) {
                  remove.reset();
                  setDeleting(entry);
                }
              }}
              onLaunch={(saveId) => navigate(`/play/${saveId}`)}
            />
          </div>
        </section>
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
            <p className={wb.error} role="alert">
              {remove.error.message}
            </p>
          )}
        </Dialog>
      )}
    </main>
  );
}
