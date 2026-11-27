import {
  type CharacterCard,
  CharacterCardSchema,
  type npcRules,
  TAROT_INFO,
  WorkshopCharacterExportSchema,
} from "@cp/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { api, type CanonNpcBrief, type CharacterEntry } from "../../api/client";
import type { AssetId } from "../../assets";
import { useCharactersPreload } from "../../assets/usePreload";
import { ActionButton } from "../../ui/ActionButton";
import { Asset, cssUrl, NineSlice } from "../../ui/Asset";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { CellFrame, FrameBox } from "../../ui/FrameBox";
import { useLayer } from "../../ui/layers";
import { useCardTilt } from "../../ui/useCardTilt";
import { GeneratedImage } from "../images/GeneratedImage";
import { ShellBackdrop } from "../theme";
import { CharacterCreator } from "./CharacterCreator";
import {
  clearDraft,
  emptyBoard,
  LOCAL_CYBERWARE_EVENT,
  LOCAL_ITEMS_EVENT,
  loadDraft,
  loadLocalCustomCyberware,
  loadLocalCustomItems,
  loadLocalCustomNpcs,
  loadLocalNpcOverrides,
  mergeCreatorCatalog,
  removeLocalCustomNpc,
  removeLocalNpcOverride,
  saveDraft,
  saveLocalCustomNpc,
  saveLocalNpcOverride,
  subscribeLocalCustomNpcs,
} from "./creator";
import { NpcCreatorWorkbench, type NpcWorkbenchMode } from "./NpcCreatorWorkbench";
import { NpcRosterPanel } from "./NpcRosterPanel";
import wb from "./workbench.module.css";

interface Editor {
  readonly id: string | null;
  readonly sample: boolean;
  readonly card: CharacterCard;
  readonly original: string;
  /** 切换角色才换会话，保存拿到 id 时不换，避免打断建档 */
  readonly session: string;
}

type RosterTab = "characters" | "npcs";

interface NpcEditorState {
  readonly mode: NpcWorkbenchMode;
  readonly initial?: npcRules.NpcCard | undefined;
  readonly hasOverride?: boolean | undefined;
  readonly session: string;
}

type Destination =
  | { readonly editor: Editor }
  | { readonly roster: true }
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

/** 读取浏览器中上次未保存的角色草稿（若有）；不直接劫持角色库入口 */
function readSavedDraft(): Editor | null {
  const draft = loadDraft(blankCard());
  if (!draft) return null;
  const card: CharacterCard = {
    ...draft.card,
    board: {
      ...(draft.card.board ?? emptyBoard()),
      ...(draft.startLocation ? { startLocation: draft.startLocation } : {}),
    },
  };
  const original = draft.original ?? "";
  if (!isCardModified(card, original, draft.sample ?? false)) {
    clearDraft();
    return null;
  }
  return {
    id: draft.characterId ?? null,
    sample: draft.sample ?? false,
    card,
    original,
    session: newSession(),
  };
}

/** 角色库总览与 2077 赛博档案工作台：默认先展示角色库，再按需新建或编辑 */
export function CharactersScreen() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const client = useQueryClient();
  const importRef = useRef<HTMLInputElement>(null);
  const characters = useQuery({ queryKey: ["characters"], queryFn: api.characters });
  const boardData = useQuery({
    queryKey: ["characterBoard"],
    queryFn: api.characterBoard,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const [editor, setEditor] = useState<Editor | null>(() =>
    params.get("new") === "1" ? editorFor(blankCard()) : null,
  );
  const [pendingDraft, setPendingDraft] = useState<Editor | null>(() => readSavedDraft());
  const currentEditor = useRef(editor);
  currentEditor.current = editor;
  const handledParamRef = useRef<string | null>(null);
  const [destination, setDestination] = useState<Destination | null>(null);
  const [deleting, setDeleting] = useState<CharacterEntry | null>(null);
  const [shareNotice, setShareNotice] = useState<{
    readonly tone: "ok" | "error";
    readonly text: string;
  } | null>(null);
  const [showLibrary, setShowLibrary] = useState(false);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [rosterTab, setRosterTab] = useState<RosterTab>("characters");
  const [npcEditor, setNpcEditor] = useState<NpcEditorState | null>(null);
  const [loadingNpcId, setLoadingNpcId] = useState<string | null>(null);
  const [deletingNpc, setDeletingNpc] = useState<npcRules.NpcCard | null>(null);
  const [localCustomNpcs, setLocalCustomNpcs] = useState<readonly npcRules.NpcCard[]>(() =>
    loadLocalCustomNpcs(),
  );
  const [localNpcOverrides, setLocalNpcOverrides] = useState<readonly npcRules.NpcCard[]>(() =>
    loadLocalNpcOverrides(),
  );
  const [localChrome, setLocalChrome] = useState(() => loadLocalCustomCyberware());
  const [localItems, setLocalItems] = useState(() => loadLocalCustomItems());
  const [launching, setLaunching] = useState(false);
  const [draftSaved, setDraftSaved] = useState(true);

  useEffect(
    () =>
      subscribeLocalCustomNpcs(() => {
        setLocalCustomNpcs(loadLocalCustomNpcs());
        setLocalNpcOverrides(loadLocalNpcOverrides());
      }),
    [],
  );

  useEffect(() => {
    const syncChrome = () => setLocalChrome(loadLocalCustomCyberware());
    const syncItems = () => setLocalItems(loadLocalCustomItems());
    window.addEventListener(LOCAL_CYBERWARE_EVENT, syncChrome);
    window.addEventListener(LOCAL_ITEMS_EVENT, syncItems);
    return () => {
      window.removeEventListener(LOCAL_CYBERWARE_EVENT, syncChrome);
      window.removeEventListener(LOCAL_ITEMS_EVENT, syncItems);
    };
  }, []);

  const npcBoardData = useMemo(
    () =>
      boardData.data
        ? mergeCreatorCatalog(boardData.data, [], [], localChrome, localItems)
        : undefined,
    [boardData.data, localChrome, localItems],
  );

  const preloadCard = useMemo(() => editor?.card ?? blankCard(), [editor]);
  useCharactersPreload(preloadCard, characters.data, client);

  useLayer(() => setShowLibrary(false), showLibrary && !destination && !deleting);

  // 支持从主菜单携带 ?new=1 / ?id=<characterId> / ?tab=npcs / ?newNpc=1 / ?npc=<npcId> 直达对应动作
  const paramNew = params.get("new");
  const paramId = params.get("id");
  const paramTab = params.get("tab");
  const paramNewNpc = params.get("newNpc");
  const paramNpc = params.get("npc");
  useEffect(() => {
    if (paramNew === "1") {
      if (handledParamRef.current === "new") return;
      handledParamRef.current = "new";
      setNpcEditor(null);
      setEditor((cur) => cur ?? editorFor(blankCard()));
      setParams({}, { replace: true });
      return;
    }
    if (paramNewNpc === "1") {
      if (handledParamRef.current === "newNpc") return;
      handledParamRef.current = "newNpc";
      setEditor(null);
      setRosterTab("npcs");
      setNpcEditor({ mode: "create", session: newSession() });
      setParams({}, { replace: true });
      return;
    }
    if (paramNpc) {
      if (handledParamRef.current === `npc:${paramNpc}`) return;
      const customMatched = loadLocalCustomNpcs().find((c) => c.id === paramNpc);
      if (customMatched) {
        handledParamRef.current = `npc:${paramNpc}`;
        setEditor(null);
        setRosterTab("npcs");
        setNpcEditor({ mode: "edit-custom", initial: customMatched, session: newSession() });
        setParams({}, { replace: true });
        return;
      }
      if (!boardData.data) return;
      handledParamRef.current = `npc:${paramNpc}`;
      setEditor(null);
      setRosterTab("npcs");
      const overrideMatched = loadLocalNpcOverrides().find((c) => c.id === paramNpc);
      if (overrideMatched) {
        setNpcEditor({
          mode: "edit-canon",
          initial: overrideMatched,
          hasOverride: true,
          session: newSession(),
        });
        setParams({}, { replace: true });
        return;
      }
      const canonBrief = boardData.data.npcs.find((n) => n.id === paramNpc);
      if (!canonBrief) {
        setShareNotice({ tone: "error", text: "未找到该 NPC 档案，已回到人物库" });
        setParams({}, { replace: true });
        return;
      }
      setLoadingNpcId(canonBrief.id);
      void api
        .characterBoardNpc(canonBrief.id)
        .then((full) => {
          setNpcEditor({
            mode: "edit-canon",
            initial: full,
            hasOverride: false,
            session: newSession(),
          });
        })
        .catch((err) => {
          setShareNotice({
            tone: "error",
            text: err instanceof Error ? err.message : "读取人物档案失败",
          });
        })
        .finally(() => {
          setLoadingNpcId(null);
        });
      setParams({}, { replace: true });
      return;
    }
    if (paramTab === "npcs") {
      if (handledParamRef.current === "tab:npcs") return;
      handledParamRef.current = "tab:npcs";
      setRosterTab("npcs");
      setParams({}, { replace: true });
      return;
    }
    if (!paramId) return;
    if (handledParamRef.current === `id:${paramId}`) return;
    if (!characters.data) return;
    handledParamRef.current = `id:${paramId}`;
    const matched = characters.data.find((entry) => entry.id === paramId);
    if (matched) {
      setEditor(editorFor(matched.card, matched.id, matched.sample));
    } else {
      setShareNotice({ tone: "error", text: "未找到该角色档案，已回到角色库" });
    }
    setParams({}, { replace: true });
  }, [
    paramNew,
    paramId,
    paramTab,
    paramNewNpc,
    paramNpc,
    characters.data,
    boardData.data,
    setParams,
  ]);

  const modified = editor ? isCardModified(editor.card, editor.original, editor.sample) : false;
  const dirty = modified;
  const parsed = useMemo(
    () => (editor ? CharacterCardSchema.safeParse(editor.card) : { success: false as const }),
    [editor],
  );

  const save = useMutation({
    mutationFn: ({ id, card }: { id: string | null; card: CharacterCard; session: string }) =>
      id === null ? api.createCharacter(card) : api.updateCharacter(id, card),
    onSuccess: (entry, submitted) => {
      setEditor((old) => {
        if (!old || old.session !== submitted.session) return old;
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
      setPendingDraft(null);
      void client.invalidateQueries({ queryKey: ["characters"] });
    },
  });

  const remove = useMutation({
    mutationFn: api.deleteCharacter,
    onSuccess: (_result, id) => {
      const deletedName = deleting?.card.name;
      if (editor?.id === id) {
        clearDraft();
        setEditor(null);
        setShowLibrary(false);
      }
      if (pendingDraft?.id === id) {
        clearDraft();
        setPendingDraft(null);
      }
      setDeleting(null);
      setShareNotice({
        tone: "ok",
        text: deletedName ? `已删除角色「${deletedName}」` : "已删除角色档案",
      });
      void client.invalidateQueries({ queryKey: ["characters"] });
    },
  });

  const commitImport = useMutation({
    mutationFn: (card: CharacterCard) => api.createCharacter(card),
    onSuccess: async (entry) => {
      await client.invalidateQueries({ queryKey: ["characters"] });
      clearDraft();
      setPendingDraft(null);
      if (currentEditor.current) {
        setEditor(editorFor(entry.card, entry.id));
      }
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
      const parsedFile = WorkshopCharacterExportSchema.safeParse(raw);
      if (!parsedFile.success) throw new Error("文件不是本作导出的角色卡");
      return CharacterCardSchema.parse(parsedFile.data.character);
    },
    onSuccess: (card) => {
      const current = currentEditor.current;
      if (current && isCardModified(current.card, current.original, current.sample)) {
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
    if (!editor) return;
    if (!dirty) {
      clearDraft();
      setPendingDraft(null);
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

  // NPC 工作台按 Esc 返回人物档案库（未在弹窗/输入框内时）
  useEffect(() => {
    if (npcEditor === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector("[role=dialog], [role=alertdialog]")) return;
      if (e.target instanceof HTMLElement && e.target.closest("input, textarea, select")) return;
      setNpcEditor(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [npcEditor]);

  // 角色库总览页按 Esc 返回主菜单
  useEffect(() => {
    if (editor !== null || npcEditor !== null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector("[role=dialog], [role=alertdialog]")) return;
      if (e.target instanceof HTMLElement && e.target.closest("input, textarea, select")) return;
      navigate("/menu");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editor, npcEditor, navigate]);

  const go = (next: Destination) => {
    clearDraft();
    setPendingDraft(null);
    if ("back" in next) navigate("/menu");
    else if ("roster" in next) {
      setEditor(null);
      setShowLibrary(false);
      save.reset();
      remove.reset();
    } else if ("importCard" in next) commitImport.mutate(next.importCard);
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
    setEditor((old) =>
      old ? { ...old, card: typeof next === "function" ? next(old.card) : next } : old,
    );
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
          aria-pressed={editor?.id === entry.id}
          disabled={busy}
          onClick={() => requestGo({ editor: editorFor(entry.card, entry.id, entry.sample) })}
        >
          <CellFrame />
          <div className={wb.cardRow}>
            {(entry.card.portrait || b?.tarot) && (
              <span className={wb.cardThumb}>
                {entry.card.portrait ? (
                  <GeneratedImage
                    imageId={entry.card.portrait}
                    alt={entry.card.name}
                    className={wb.portraitImg}
                    fallback={
                      b?.tarot ? (
                        <Asset
                          id={`tarot.${b.tarot}` as AssetId}
                          alt={TAROT_INFO[b.tarot].label}
                          className={wb.portraitImg}
                        />
                      ) : null
                    }
                  />
                ) : b?.tarot ? (
                  <Asset
                    id={`tarot.${b.tarot}` as AssetId}
                    alt={TAROT_INFO[b.tarot].label}
                    className={wb.portraitImg}
                  />
                ) : null}
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

  const renderRosterCard = (entry: CharacterEntry) => (
    <RosterCard
      key={entry.id}
      entry={entry}
      busy={busy}
      onOpen={() => requestGo({ editor: editorFor(entry.card, entry.id, entry.sample) })}
      onExport={() => {
        const fileName = downloadCharacter(entry.card);
        setShareNotice({ tone: "ok", text: `已导出角色档案 ${fileName}` });
      }}
      onDelete={() => {
        remove.reset();
        setDeleting(entry);
      }}
    />
  );

  const openNewNpcWorkbench = () => {
    setShareNotice(null);
    setNpcEditor({ mode: "create", session: newSession() });
  };

  const openCustomNpcWorkbench = (card: npcRules.NpcCard) => {
    setShareNotice(null);
    setNpcEditor({ mode: "edit-custom", initial: card, session: newSession() });
  };

  const openCanonNpcWorkbench = async (
    brief: CanonNpcBrief,
    existingOverride?: npcRules.NpcCard,
  ) => {
    setShareNotice(null);
    if (existingOverride) {
      setNpcEditor({
        mode: "edit-canon",
        initial: existingOverride,
        hasOverride: true,
        session: newSession(),
      });
      return;
    }
    setLoadingNpcId(brief.id);
    try {
      const full = await api.characterBoardNpc(brief.id);
      setNpcEditor({
        mode: "edit-canon",
        initial: full,
        hasOverride: false,
        session: newSession(),
      });
    } catch (err) {
      setShareNotice({
        tone: "error",
        text: err instanceof Error ? err.message : "读取人物档案失败",
      });
    } finally {
      setLoadingNpcId(null);
    }
  };

  const handleSaveNpc = (card: npcRules.NpcCard) => {
    if (!npcEditor) return;
    if (npcEditor.mode === "edit-canon") {
      saveLocalNpcOverride(card);
      setShareNotice({
        tone: "ok",
        text: `已保存原作人物「${card.name}」的自定义档案，新建存档时将自动生效`,
      });
    } else {
      saveLocalCustomNpc(card);
      setShareNotice({
        tone: "ok",
        text: `已保存自建 NPC「${card.name}」至本地人物库`,
      });
    }
    setNpcEditor(null);
    setRosterTab("npcs");
  };

  const handleResetNpcOverride = (id: string, displayName?: string) => {
    removeLocalNpcOverride(id);
    setNpcEditor(null);
    setShareNotice({
      tone: "ok",
      text: displayName ? `已恢复「${displayName}」的原作默认设定` : "已恢复原作默认设定",
    });
  };

  const handleDeleteCustomNpc = (card: npcRules.NpcCard) => {
    removeLocalCustomNpc(card.id);
    setDeletingNpc(null);
    setNpcEditor(null);
    setShareNotice({ tone: "ok", text: `已删除自建 NPC「${card.name}」` });
  };

  const headCode =
    npcEditor !== null ? "NC // NPC DOSSIER" : editor === null ? "ID // ROSTER" : "ID // DOSSIER";
  const headTitle =
    npcEditor !== null
      ? npcEditor.mode === "create"
        ? "新建 NPC"
        : npcEditor.mode === "edit-canon"
          ? `修改原作人物 · ${npcEditor.initial?.name ?? ""}`
          : `编辑 NPC · ${npcEditor.initial?.name ?? ""}`
      : editor === null
        ? "角色档案库"
        : editor.id === null
          ? "新建角色"
          : editor.sample
            ? "预设档案"
            : "编辑档案";
  const totalCustom = allCharacters.filter((entry) => !entry.sample).length;
  const totalSample = allCharacters.length - totalCustom;

  return (
    <main className={wb.screen}>
      <ShellBackdrop variant="characters" />
      <header className={wb.head}>
        <Asset id="menu.header" tint="var(--cp-red)" height={52} className={wb.headBg} />
        <Asset id="panel.glowLeft" height={28} tint="var(--cp-cyan)" className={wb.headGlow} />
        <div className={wb.headTitleWrap}>
          <span className={wb.headCode}>{headCode}</span>
          <h1>{headTitle}</h1>
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
        {npcEditor !== null ? (
          <>
            <fieldset className={wb.headGroup} aria-label="NPC 工作台操作">
              <Button small onClick={() => setNpcEditor(null)}>
                ← 返回人物档案库
              </Button>
              <Button small onClick={openNewNpcWorkbench}>
                ＋ 新建 NPC
              </Button>
            </fieldset>
            <span className={wb.headDivider} aria-hidden />
            <fieldset className={wb.headGroup} aria-label="页面导航">
              <Button small onClick={() => requestGo({ back: true })}>
                返回主菜单
              </Button>
            </fieldset>
          </>
        ) : editor === null ? (
          <>
            <fieldset className={wb.headGroup} aria-label="角色库操作">
              <Button
                small
                primary={rosterTab === "characters"}
                disabled={busy}
                onClick={() => requestGo({ editor: editorFor(blankCard()) })}
              >
                ＋ 新建角色
              </Button>
              <Button
                small
                primary={rosterTab === "npcs"}
                disabled={busy}
                onClick={openNewNpcWorkbench}
              >
                ＋ 新建 NPC
              </Button>
              <Button small disabled={busy} onClick={() => importRef.current?.click()}>
                {importCard.isPending || commitImport.isPending ? "导入中…" : "导入 JSON"}
              </Button>
            </fieldset>
            <span className={wb.headDivider} aria-hidden />
            <fieldset className={wb.headGroup} aria-label="页面导航">
              <Button
                small
                keyId="key.esc"
                disabled={busy}
                onClick={() => requestGo({ back: true })}
              >
                返回主菜单
              </Button>
            </fieldset>
          </>
        ) : (
          <>
            <fieldset className={wb.headGroup} aria-label="角色库与分享">
              <Button small disabled={busy} onClick={() => requestGo({ roster: true })}>
                ← 返回角色库
              </Button>
              <Button
                small
                disabled={busy}
                pressed={showLibrary}
                onClick={() => setShowLibrary((open) => !open)}
              >
                快速切换{characters.data ? ` (${characters.data.length})` : ""}
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
              <Button small disabled={busy} onClick={() => requestGo({ back: true })}>
                返回主菜单
              </Button>
            </fieldset>
          </>
        )}
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
        {npcEditor !== null ? (
          <section className={wb.editorWrap} aria-label="NPC 档案工作台">
            {boardData.isPending && <p role="status">正在读取义体、武器与势力目录…</p>}
            {boardData.isError && (
              <div role="alert">
                <p className={wb.error}>{boardData.error.message}</p>
                <Button small onClick={() => void boardData.refetch()}>
                  重新读取目录
                </Button>
              </div>
            )}
            {npcBoardData && (
              <div className={wb.benchHost}>
                <NpcCreatorWorkbench
                  key={npcEditor.session}
                  mode={npcEditor.mode}
                  initial={npcEditor.initial}
                  data={npcBoardData}
                  hasOverride={npcEditor.hasOverride}
                  onSave={handleSaveNpc}
                  onReset={
                    npcEditor.mode === "edit-canon" && npcEditor.initial
                      ? () => {
                          if (npcEditor.initial) {
                            handleResetNpcOverride(npcEditor.initial.id, npcEditor.initial.name);
                          }
                        }
                      : undefined
                  }
                  onDelete={
                    npcEditor.mode === "edit-custom" && npcEditor.initial
                      ? () => {
                          if (npcEditor.initial) setDeletingNpc(npcEditor.initial);
                        }
                      : undefined
                  }
                  onCancel={() => setNpcEditor(null)}
                />
              </div>
            )}
          </section>
        ) : editor === null ? (
          <section className={wb.rosterView} aria-label="角色档案库">
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

            {pendingDraft && (
              <div className={wb.draftBanner} role="status">
                <CellFrame />
                <p className={wb.draftBannerText}>
                  检测到上次未保存的角色草稿
                  {pendingDraft.card.name.trim() ? `「${pendingDraft.card.name.trim()}」` : ""}
                </p>
                <div className={wb.draftBannerActions}>
                  <Button
                    small
                    primary
                    onClick={() => {
                      setEditor(pendingDraft);
                      setPendingDraft(null);
                    }}
                  >
                    继续编辑
                  </Button>
                  <Button
                    small
                    onClick={() => {
                      clearDraft();
                      setPendingDraft(null);
                    }}
                  >
                    丢弃草稿
                  </Button>
                </div>
              </div>
            )}

            <div className={wb.subTabs} role="tablist" aria-label="档案库分类">
              <button
                type="button"
                role="tab"
                className={wb.subTab}
                aria-selected={rosterTab === "characters"}
                onClick={() => setRosterTab("characters")}
              >
                <span>主角与预设角色 ({allCharacters.length})</span>
                <span
                  className={wb.subTabLine}
                  style={{
                    maskImage: cssUrl("tab.line"),
                    WebkitMaskImage: cssUrl("tab.line"),
                  }}
                  aria-hidden
                />
              </button>
              <button
                type="button"
                role="tab"
                className={wb.subTab}
                aria-selected={rosterTab === "npcs"}
                onClick={() => setRosterTab("npcs")}
              >
                <span>
                  夜之城 NPC ({localCustomNpcs.length + (boardData.data?.npcs.length ?? 0)}
                  {localNpcOverrides.length > 0 ? ` · 已改 ${localNpcOverrides.length}` : ""})
                </span>
                <span
                  className={wb.subTabLine}
                  style={{
                    maskImage: cssUrl("tab.line"),
                    WebkitMaskImage: cssUrl("tab.line"),
                  }}
                  aria-hidden
                />
              </button>
            </div>

            <div className={wb.rosterToolbar}>
              <FrameBox className={wb.rosterSearch}>
                <input
                  type="search"
                  value={libraryQuery}
                  placeholder={
                    rosterTab === "npcs"
                      ? "搜索 NPC 姓名、外号、身份、势力或外貌…"
                      : "搜索角色名、代号或出身…"
                  }
                  aria-label={rosterTab === "npcs" ? "搜索 NPC 档案库" : "搜索角色库"}
                  onChange={(e) => setLibraryQuery(e.target.value)}
                />
              </FrameBox>
              {rosterTab === "npcs" ? (
                <span className={wb.rosterCount}>
                  共{" "}
                  <strong className="num">
                    {localCustomNpcs.length + (boardData.data?.npcs.length ?? 0)}
                  </strong>{" "}
                  位人物 · 自建 <span className="num">{localCustomNpcs.length}</span> · 原作{" "}
                  <span className="num">{boardData.data?.npcs.length ?? 0}</span>
                  {localNpcOverrides.length > 0 ? (
                    <>
                      {" "}
                      · 已改写 <span className="num">{localNpcOverrides.length}</span>
                    </>
                  ) : null}
                </span>
              ) : (
                <span className={wb.rosterCount}>
                  共 <strong className="num">{allCharacters.length}</strong> 张档案 · 自建{" "}
                  <span className="num">{totalCustom}</span> · 官方预设{" "}
                  <span className="num">{totalSample}</span>
                </span>
              )}
            </div>

            <div className={wb.rosterScroll}>
              {rosterTab === "npcs" ? (
                boardData.isPending ? (
                  <p role="status">正在读取夜之城人物档案…</p>
                ) : boardData.isError ? (
                  <div role="alert">
                    <p className={wb.error}>{boardData.error.message}</p>
                    <Button small onClick={() => void boardData.refetch()}>
                      重新读取
                    </Button>
                  </div>
                ) : (
                  <NpcRosterPanel
                    data={npcBoardData}
                    localCustomNpcs={localCustomNpcs}
                    localOverrides={localNpcOverrides}
                    query={libraryQuery}
                    loadingNpcId={loadingNpcId}
                    busy={busy}
                    onCreateNpc={openNewNpcWorkbench}
                    onEditCustom={openCustomNpcWorkbench}
                    onEditCanon={(brief, ov) => void openCanonNpcWorkbench(brief, ov)}
                    onResetOverride={(id) => {
                      const matched = boardData.data?.npcs.find((n) => n.id === id);
                      handleResetNpcOverride(id, matched?.name);
                    }}
                    onDeleteCustom={(card) => setDeletingNpc(card)}
                    onClearQuery={() => setLibraryQuery("")}
                  />
                )
              ) : (
                <>
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
                    <div className={wb.rosterEmpty}>
                      <p className={wb.note}>
                        还没有角色档案，点击「＋ 新建角色」创建你的第一位夜之城来客。
                      </p>
                      <Button primary onClick={() => requestGo({ editor: editorFor(blankCard()) })}>
                        ＋ 新建角色
                      </Button>
                    </div>
                  )}
                  {characters.isSuccess &&
                    allCharacters.length > 0 &&
                    filteredCharacters.length === 0 && (
                      <div className={wb.rosterEmpty}>
                        <p className={wb.note}>没有匹配「{libraryQuery}」的角色档案。</p>
                        <Button small onClick={() => setLibraryQuery("")}>
                          清空搜索
                        </Button>
                      </div>
                    )}

                  {customCharacters.length > 0 && (
                    <section className={wb.rosterSection} aria-label="自建角色">
                      <div className={wb.rosterSectionHead}>
                        <h2 className={wb.rosterSectionTitle}>
                          自建角色（{customCharacters.length}）
                        </h2>
                      </div>
                      <ul className={wb.rosterGrid}>{customCharacters.map(renderRosterCard)}</ul>
                    </section>
                  )}

                  {sampleCharacters.length > 0 && (
                    <section className={wb.rosterSection} aria-label="官方预设模板">
                      <div className={wb.rosterSectionHead}>
                        <h2 className={wb.rosterSectionTitle}>
                          官方预设模板（{sampleCharacters.length}）
                        </h2>
                        <span className={wb.rosterSectionHint}>
                          可直接用于新建存档，或打开另存为自建副本
                        </span>
                      </div>
                      <ul className={wb.rosterGrid}>{sampleCharacters.map(renderRosterCard)}</ul>
                    </section>
                  )}
                </>
              )}
            </div>
          </section>
        ) : (
          <>
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
                        <h2 className={wb.libraryGroupTitle}>
                          自建角色（{customCharacters.length}）
                        </h2>
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
                    const found = characters.data?.find((item) => item.id === editor.id);
                    if (found?.sample) return;
                    remove.reset();
                    setDeleting(
                      found ?? {
                        id: editor.id,
                        card: editor.card,
                        updatedAt: "",
                        sample: false,
                      },
                    );
                  }}
                  onLaunch={(saveId) => navigate(`/play/${saveId}`)}
                />
              </div>
            </section>
          </>
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
      {deletingNpc && (
        <Dialog
          title={`删除自建 NPC「${deletingNpc.name}」？`}
          tone="danger"
          onClose={() => setDeletingNpc(null)}
          actions={
            <>
              <Button onClick={() => setDeletingNpc(null)}>取消</Button>
              <Button onClick={() => handleDeleteCustomNpc(deletingNpc)}>确认删除</Button>
            </>
          }
        >
          <p>该自建 NPC 会从本地人物库删除，已有存档不受影响。</p>
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

function RosterCard({
  entry,
  busy,
  onOpen,
  onExport,
  onDelete,
}: {
  readonly entry: CharacterEntry;
  readonly busy: boolean;
  readonly onOpen: () => void;
  readonly onExport: () => void;
  readonly onDelete: () => void;
}) {
  const b = entry.card.board;
  const traitCount = (b?.skills.length ?? 0) + (b?.pasts.length ?? 0);
  const cyberCount = b?.cyberware.length ?? 0;
  const originText = entry.card.origin || b?.origin?.label || "未知出身";
  const summaryText = entry.card.personality || entry.card.past || entry.card.look || "";
  const tarot = b?.tarot;
  const monogram = (entry.card.name.trim()[0] ?? "V").toUpperCase();
  const fallbackVisual = tarot ? (
    <Asset
      id={`tarot.${tarot}` as AssetId}
      alt={TAROT_INFO[tarot].label}
      className={wb.portraitImg}
    />
  ) : (
    <span className={wb.rosterMonogram} aria-hidden>
      {monogram}
    </span>
  );
  const tilt = useCardTilt<HTMLLIElement>({
    maxRotate: 4.8,
    shadowShift: 4,
    disabled: busy,
  });

  return (
    <li className={wb.rosterCard} {...tilt}>
      <CellFrame />
      <button type="button" className={wb.rosterCardMain} disabled={busy} onClick={onOpen}>
        <span className={wb.rosterThumb}>
          {entry.card.portrait ? (
            <GeneratedImage
              imageId={entry.card.portrait}
              alt={entry.card.name}
              className={wb.portraitImg}
              fallback={fallbackVisual}
            />
          ) : (
            fallbackVisual
          )}
        </span>
        <div className={wb.rosterMeta}>
          <div className={wb.rosterTopRow}>
            <span className={wb.rosterBadge} data-sample={entry.sample || undefined}>
              {entry.sample ? "官方预设" : "自建角色"}
            </span>
            <span className={wb.rosterOrigin}>{originText}</span>
          </div>
          <strong className={wb.rosterName}>
            {entry.card.name}
            {entry.card.alias ? (
              <span className={wb.rosterAlias}>「{entry.card.alias}」</span>
            ) : null}
          </strong>
          <span className={wb.rosterStats}>
            {b ? `特质 ${traitCount} · 义体 ${cyberCount}` : "自定义文本角色卡"}
          </span>
          {summaryText && <p className={wb.rosterSummary}>{summaryText}</p>}
        </div>
      </button>
      <div className={wb.rosterActions}>
        <Button small primary disabled={busy} onClick={onOpen}>
          {entry.sample ? "查看 / 另存" : "编辑档案"}
        </Button>
        <Button small disabled={busy} onClick={onExport}>
          导出
        </Button>
        {!entry.sample && (
          <Button small disabled={busy} onClick={onDelete}>
            删除
          </Button>
        )}
      </div>
    </li>
  );
}
