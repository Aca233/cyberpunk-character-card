import {
  type BoardModule,
  type InstalledWorkshopPack,
  type StartCyberware,
  type WorkshopGenerateFocus,
  type WorkshopPack,
  WorkshopPackSchema,
} from "@cp/core";
import { useMutation, useQuery } from "@tanstack/react-query";
import { type ChangeEvent, type DragEvent, useEffect, useMemo, useRef, useState } from "react";
import { api, type CharacterEntry } from "../../api/client";
import { communityCoverUrl, compressCoverImage } from "../../api/communityWorkshop";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { FrameBox } from "../../ui/FrameBox";
import { ToggleCheck } from "../../ui/ToggleCheck";
import { loadLocalCustomCyberware, loadLocalCustomModules } from "../characters/creator";
import styles from "./workshop.module.css";

export type PublishSourceTab = "local" | "ai" | "json";

export interface PublishSubmitPayload {
  readonly pack: WorkshopPack;
  readonly mode: "create" | "update";
  readonly tokenInput: string;
  readonly coverBlob: Blob | null;
  readonly clearExistingCover: boolean;
}

interface WorkshopPublishModalProps {
  readonly initialTab?: PublishSourceTab;
  readonly initialPack?: WorkshopPack | null;
  readonly initialExistingCoverHash?: string | null;
  readonly installedPacks: readonly InstalledWorkshopPack[];
  readonly savedTokens: Readonly<Record<string, string>>;
  readonly busy: boolean;
  readonly onClose: () => void;
  readonly onInstallLocal: (pack: WorkshopPack) => void;
  readonly onPublishCommunity: (payload: PublishSubmitPayload) => void;
  readonly onGoCharacters: () => void;
}

const AI_FOCUS_OPTIONS: readonly { readonly id: WorkshopGenerateFocus; readonly label: string }[] =
  [
    { id: "auto", label: "智能搭配" },
    { id: "cyberware", label: "偏义体" },
    { id: "items", label: "偏武器装备" },
    { id: "modules", label: "偏出身特质" },
    { id: "npcs", label: "偏原创人物" },
    { id: "mixed", label: "综合主题包" },
  ];

const AI_PROMPT_EXAMPLES: readonly { readonly label: string; readonly prompt: string }[] = [
  {
    label: "边缘行者军用套件",
    prompt:
      "做一套偏《边缘行者》风格的高风险军用义体、一把街头改装武器和一条义体狂热特质，上架到维克多和威尔逊。",
  },
  {
    label: "公司暗影潜入包",
    prompt:
      "做一套荒坂/军用科技离职特工主题包：包含 1 个隐匿义体、1 把消音手枪、1 个前公司情报员出身和 1 条潜入特质。",
  },
  {
    label: "歌舞伎暗巷人物志",
    prompt:
      "创作 2 位盘踞在歌舞伎市场和日本街的原创夜之城人物（带鲜明口吻、秘密和诉求），配 1 件黑市小装备并开局登场。",
  },
];

function slugifyPackId(raw: string, fallbackPrefix = "pack"): string {
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 18);
  if (cleaned.length >= 2) return cleaned;
  return `${fallbackPrefix}-${Date.now().toString(36).slice(-6)}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(bytes >= 10 * 1024 ? 0 : 1)} KB`;
}

function packEntryTotal(pack: WorkshopPack): number {
  return (
    pack.characters.length +
    pack.modules.length +
    pack.acquaintances.length +
    pack.npcs.length +
    pack.seedNpcs.length +
    pack.items.length +
    pack.cyberware.length +
    pack.braindances.length +
    pack.chipContents.length +
    pack.shopListings.length +
    pack.ripperdocListings.length
  );
}

function packChips(pack: WorkshopPack): readonly string[] {
  const out: string[] = [];
  if (pack.characters.length > 0) out.push(`角色卡 ${pack.characters.length}`);
  if (pack.cyberware.length > 0) out.push(`义体 ${pack.cyberware.length}`);
  const weapons = pack.items.filter((i) => i.kind === "weapon").length;
  if (weapons > 0) out.push(`武器 ${weapons}`);
  const otherItems = pack.items.length - weapons;
  if (otherItems > 0) out.push(`物品 ${otherItems}`);
  if (pack.modules.length > 0) out.push(`模块 ${pack.modules.length}`);
  if (pack.npcs.length > 0) out.push(`人物 ${pack.npcs.length}`);
  if (pack.acquaintances.length > 0) out.push(`人脉 ${pack.acquaintances.length}`);
  if (pack.braindances.length > 0) out.push(`超梦 ${pack.braindances.length}`);
  if (pack.chipContents.length > 0) out.push(`芯片 ${pack.chipContents.length}`);
  const listings = pack.shopListings.length + pack.ripperdocListings.length;
  if (listings > 0) out.push(`货架 ${listings}`);
  return out;
}

function convertStartCyberwareToDef(
  item: StartCyberware,
): WorkshopPack["cyberware"][number] | null {
  if (!item.slot) return null;
  const safeId = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.id)
    ? item.id.slice(0, 33)
    : `cw-${Date.now().toString(36).slice(-6)}`;
  const rarity = item.rarity ?? "rare";
  const price =
    rarity === "common"
      ? 4000
      : rarity === "uncommon"
        ? 9000
        : rarity === "epic"
          ? 36000
          : rarity === "legendary"
            ? 72000
            : 18000;
  return {
    id: safeId,
    name: item.name,
    slot: item.slot,
    rarity,
    price,
    humanityCost: item.category === "lifestyle" ? 0 : item.humanityCost,
    ability: item.ability || item.summary || "自定义义体模块",
    armor: Boolean(item.armor),
    accelerator: Boolean(item.accelerator),
    iconic: false,
    ...(item.deckProfile ? { deckProfile: item.deckProfile, deckTraits: [] } : {}),
    ...(item.exclusiveGroup ? { exclusiveGroup: item.exclusiveGroup } : {}),
    ...(item.category ? { category: item.category } : {}),
    ...(item.defaultArmSide ? { defaultArmSide: item.defaultArmSide } : {}),
    ...(item.capacityBonus !== undefined ? { capacityBonus: item.capacityBonus } : {}),
    ...(item.safeLineBonus !== undefined ? { safeLineBonus: item.safeLineBonus } : {}),
    ...(item.chassisProfile ? { chassisProfile: item.chassisProfile } : {}),
    ...(item.smartLink ? { smartLink: true } : {}),
    ...(item.carryBonus !== undefined ? { carryBonus: item.carryBonus } : {}),
    ...(item.defenses ? { defenses: item.defenses } : {}),
  };
}

export function WorkshopPublishModal({
  initialTab = "local",
  initialPack = null,
  initialExistingCoverHash = null,
  installedPacks,
  savedTokens,
  busy,
  onClose,
  onInstallLocal,
  onPublishCommunity,
  onGoCharacters,
}: WorkshopPublishModalProps) {
  const [tab, setTab] = useState<PublishSourceTab>(initialTab);
  const charactersQuery = useQuery({ queryKey: ["characters"], queryFn: api.characters });
  const customCharacters = useMemo<readonly CharacterEntry[]>(
    () => (charactersQuery.data ?? []).filter((entry) => !entry.sample),
    [charactersQuery.data],
  );
  const localCyberware = useMemo<readonly StartCyberware[]>(() => loadLocalCustomCyberware(), []);
  const localModules = useMemo<readonly BoardModule[]>(() => loadLocalCustomModules(), []);

  // ———— Tab 1: 从本地打包（选择已安装包，或勾选角色卡/自创义体/自创模块） ————
  const [pickedExistingPackId, setPickedExistingPackId] = useState<string | null>(
    initialPack?.id ?? null,
  );
  const [selectedCharIds, setSelectedCharIds] = useState<readonly string[]>([]);
  const [selectedCwIds, setSelectedCwIds] = useState<readonly string[]>(() =>
    initialPack ? [] : localCyberware.map((c) => c.id),
  );
  const [selectedModIds, setSelectedModIds] = useState<readonly string[]>(() =>
    initialPack ? [] : localModules.map((m) => m.id),
  );

  // ———— 共享元信息（包名、作者、简介、ID、更新密钥） ————
  const [packId, setPackId] = useState<string>(
    () => initialPack?.id ?? `pack-${Date.now().toString(36).slice(-6)}`,
  );
  const [title, setTitle] = useState<string>(() => initialPack?.title ?? "");
  const [author, setAuthor] = useState<string>(() => initialPack?.author ?? "");
  const [description, setDescription] = useState<string>(() => initialPack?.description ?? "");
  const [publishMode, setPublishMode] = useState<"create" | "update">(() =>
    initialPack && savedTokens[initialPack.id] ? "update" : "create",
  );
  const [tokenInput, setTokenInput] = useState<string>(() =>
    initialPack ? (savedTokens[initialPack.id] ?? "") : "",
  );

  // ———— 封面图状态 ————
  const coverInputRef = useRef<HTMLInputElement>(null);
  const [coverBlob, setCoverBlob] = useState<Blob | null>(null);
  const [coverPreviewUrl, setCoverPreviewUrl] = useState<string | null>(null);
  const [coverByteSize, setCoverByteSize] = useState<number | null>(null);
  const [clearExistingCover, setClearExistingCover] = useState(false);
  const [coverError, setCoverError] = useState<string | null>(null);
  const [compressingCover, setCompressingCover] = useState(false);

  const existingCoverUrl = useMemo(
    () =>
      initialPack && initialExistingCoverHash && pickedExistingPackId === initialPack.id
        ? communityCoverUrl(initialPack.id, initialExistingCoverHash)
        : null,
    [initialPack, initialExistingCoverHash, pickedExistingPackId],
  );

  useEffect(() => {
    return () => {
      if (coverPreviewUrl) URL.revokeObjectURL(coverPreviewUrl);
    };
  }, [coverPreviewUrl]);

  // ———— Tab 2: AI 一句话生成 ————
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiFocus, setAiFocus] = useState<WorkshopGenerateFocus>("auto");
  const [aiPack, setAiPack] = useState<WorkshopPack | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  const aiGenerate = useMutation({
    mutationFn: () =>
      api.generateWorkshopPack({
        prompt: aiPrompt.trim(),
        focus: aiFocus,
        author: author.trim(),
      }),
    onMutate: () => {
      setAiError(null);
    },
    onSuccess: ({ pack }) => {
      setAiPack(pack);
      setPackId(pack.id);
      setTitle(pack.title);
      if (pack.author && !author.trim()) setAuthor(pack.author);
      setDescription(pack.description);
      setPublishMode(savedTokens[pack.id] ? "update" : "create");
      setTokenInput(savedTokens[pack.id] ?? "");
    },
    onError: (err) => {
      setAiError(err.message);
    },
  });

  // ———— Tab 3: 上传 JSON 文件 ————
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [jsonPack, setJsonPack] = useState<WorkshopPack | null>(null);
  const [jsonIssues, setJsonIssues] = useState<readonly string[]>([]);
  const [jsonPasteOpen, setJsonPasteOpen] = useState(false);
  const [jsonPasteText, setJsonPasteText] = useState("");
  const [dragOver, setDragOver] = useState(false);

  const validateJsonText = async (text: string) => {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      setJsonPack(null);
      setJsonIssues(["文件内容不是合法的 JSON"]);
      return;
    }
    const parsed = WorkshopPackSchema.safeParse(raw);
    if (!parsed.success) {
      setJsonPack(null);
      setJsonIssues(
        parsed.error.issues.map((i) =>
          i.path.length > 0 ? `${i.path.join(".")}：${i.message}` : i.message,
        ),
      );
      return;
    }
    try {
      const check = await api.validateWorkshopPack(parsed.data, parsed.data.id);
      if (!check.valid) {
        setJsonPack(null);
        setJsonIssues(check.issues);
        return;
      }
    } catch (err) {
      setJsonPack(null);
      setJsonIssues([err instanceof Error ? err.message : "校验失败"]);
      return;
    }
    setJsonPack(parsed.data);
    setJsonIssues([]);
    setPackId(parsed.data.id);
    setTitle(parsed.data.title);
    setAuthor(parsed.data.author);
    setDescription(parsed.data.description);
    setPublishMode(savedTokens[parsed.data.id] ? "update" : "create");
    setTokenInput(savedTokens[parsed.data.id] ?? "");
  };

  const handleJsonFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) {
      setJsonIssues(["文件太大，内容包 JSON 不能超过 4 MB"]);
      return;
    }
    try {
      const text = await file.text();
      await validateJsonText(text);
    } catch {
      setJsonIssues(["读取文件失败"]);
    }
  };

  const onDropJson = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDragOver(false);
    void handleJsonFile(event.dataTransfer.files?.[0]);
  };

  const handleCoverFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setCompressingCover(true);
    setCoverError(null);
    try {
      const compressed = await compressCoverImage(file);
      if (coverPreviewUrl) URL.revokeObjectURL(coverPreviewUrl);
      setCoverBlob(compressed.blob);
      setCoverPreviewUrl(compressed.previewUrl);
      setCoverByteSize(compressed.byteSize);
      setClearExistingCover(false);
    } catch (err) {
      setCoverError(err instanceof Error ? err.message : "封面处理失败");
    } finally {
      setCompressingCover(false);
    }
  };

  const toggleId = (list: readonly string[], id: string): readonly string[] =>
    list.includes(id) ? list.filter((item) => item !== id) : [...list, id];

  const selectExistingPack = (pack: WorkshopPack | null) => {
    if (!pack) {
      setPickedExistingPackId(null);
      setPackId(`pack-${Date.now().toString(36).slice(-6)}`);
      setPublishMode("create");
      setTokenInput("");
      return;
    }
    setPickedExistingPackId(pack.id);
    setPackId(pack.id);
    setTitle(pack.title);
    setAuthor(pack.author);
    setDescription(pack.description);
    setPublishMode(savedTokens[pack.id] ? "update" : "create");
    setTokenInput(savedTokens[pack.id] ?? "");
  };

  // 计算当前激活的待发布/待安装内容包
  const activePack = useMemo<WorkshopPack | null>(() => {
    if (tab === "ai") {
      if (!aiPack) return null;
      return {
        ...aiPack,
        id: slugifyPackId(packId || aiPack.id, "ai"),
        title: title.trim() || aiPack.title,
        author: author.trim(),
        description: description.trim(),
      };
    }
    if (tab === "json") {
      if (!jsonPack) return null;
      return {
        ...jsonPack,
        id: slugifyPackId(packId || jsonPack.id, "pack"),
        title: title.trim() || jsonPack.title,
        author: author.trim(),
        description: description.trim(),
      };
    }

    // tab === "local"
    if (pickedExistingPackId) {
      const base =
        (initialPack?.id === pickedExistingPackId ? initialPack : null) ??
        installedPacks.find((e) => e.pack.id === pickedExistingPackId)?.pack ??
        null;
      if (!base) return null;
      return {
        ...base,
        title: title.trim() || base.title,
        author: author.trim(),
        description: description.trim(),
      };
    }

    const pickedChars = customCharacters
      .filter((entry) => selectedCharIds.includes(entry.id))
      .map((entry) => entry.card);
    const pickedCw = localCyberware
      .filter((c) => selectedCwIds.includes(c.id))
      .map(convertStartCyberwareToDef)
      .filter((c): c is WorkshopPack["cyberware"][number] => c !== null);
    const pickedMods = localModules.filter((m) => selectedModIds.includes(m.id));
    if (pickedChars.length === 0 && pickedCw.length === 0 && pickedMods.length === 0) {
      return null;
    }

    const autoTitle =
      pickedChars.length === 1 && pickedCw.length === 0 && pickedMods.length === 0
        ? `${pickedChars[0]?.name ?? "原创角色"} · 角色卡`
        : "我的夜之城创作包";
    const autoDesc =
      pickedChars.length === 1 && pickedCw.length === 0 && pickedMods.length === 0
        ? `${pickedChars[0]?.origin || "原创角色"}：${pickedChars[0]?.look.slice(0, 80) ?? ""}`
        : `收录 ${[
            pickedChars.length ? `${pickedChars.length} 张角色卡` : "",
            pickedCw.length ? `${pickedCw.length} 件自创义体` : "",
            pickedMods.length ? `${pickedMods.length} 项自创模块` : "",
          ]
            .filter(Boolean)
            .join("、")}`;

    const candidate = {
      format: "cp2077-workshop-pack" as const,
      version: 2 as const,
      id: slugifyPackId(packId, "pack"),
      title: (title.trim() || autoTitle).slice(0, 40),
      author: author.trim().slice(0, 40),
      description: (description.trim() || autoDesc).slice(0, 300),
      characters: pickedChars,
      modules: pickedMods,
      acquaintances: [],
      npcs: [],
      seedNpcs: [],
      items: [],
      cyberware: pickedCw,
      braindances: [],
      chipContents: [],
      shopListings: [],
      ripperdocListings: [],
    };
    const parsed = WorkshopPackSchema.safeParse(candidate);
    return parsed.success ? parsed.data : null;
  }, [
    tab,
    aiPack,
    jsonPack,
    pickedExistingPackId,
    initialPack,
    installedPacks,
    customCharacters,
    selectedCharIds,
    localCyberware,
    selectedCwIds,
    localModules,
    selectedModIds,
    packId,
    title,
    author,
    description,
  ]);

  const entryCount = activePack ? packEntryTotal(activePack) : 0;
  const chips = activePack ? packChips(activePack) : [];
  const canSubmitCommunity =
    Boolean(activePack) &&
    entryCount > 0 &&
    !busy &&
    !compressingCover &&
    !aiGenerate.isPending &&
    (publishMode === "create" || tokenInput.trim() !== "");
  const canInstallLocal = Boolean(activePack) && entryCount > 0 && !busy && !aiGenerate.isPending;

  const hasAnyLocalAsset =
    customCharacters.length > 0 ||
    localCyberware.length > 0 ||
    localModules.length > 0 ||
    installedPacks.length > 0;

  return (
    <Dialog
      title={initialPack ? `发布 / 更新「${initialPack.title}」` : "发布或创作工坊作品"}
      onClose={() => {
        if (!busy && !aiGenerate.isPending) onClose();
      }}
      actions={
        <>
          <Button disabled={busy || aiGenerate.isPending} onClick={onClose}>
            取消
          </Button>
          {tab !== "local" || !pickedExistingPackId ? (
            <Button
              disabled={!canInstallLocal}
              onClick={() => {
                if (activePack) onInstallLocal(activePack);
              }}
            >
              仅装到本地启用
            </Button>
          ) : null}
          <Button
            primary
            disabled={!canSubmitCommunity}
            onClick={() => {
              if (!activePack) return;
              onPublishCommunity({
                pack: activePack,
                mode: publishMode,
                tokenInput,
                coverBlob,
                clearExistingCover,
              });
            }}
          >
            {busy ? "上传中…" : publishMode === "update" ? "更新到社区广场" : "发布到社区广场"}
          </Button>
        </>
      }
    >
      <div className={styles.publishModalBody}>
        <input
          ref={coverInputRef}
          hidden
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={handleCoverFile}
        />
        <input
          ref={fileInputRef}
          hidden
          type="file"
          accept=".json,application/json"
          onChange={(e) => {
            void handleJsonFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />

        {/* ———— 顶部三合一来源切换 ———— */}
        <div className={styles.publishTabBar} role="tablist" aria-label="选择发布方式">
          <Button
            small
            primary={tab === "local"}
            pressed={tab === "local"}
            disabled={busy || aiGenerate.isPending}
            onClick={() => setTab("local")}
          >
            从本地打包
          </Button>
          <Button
            small
            primary={tab === "ai"}
            pressed={tab === "ai"}
            disabled={busy || aiGenerate.isPending}
            onClick={() => setTab("ai")}
          >
            AI 一句话生成
          </Button>
          <Button
            small
            primary={tab === "json"}
            pressed={tab === "json"}
            disabled={busy || aiGenerate.isPending}
            onClick={() => setTab("json")}
          >
            上传 JSON 文件
          </Button>
        </div>

        {/* ———— Tab 1: 从本地勾选打包 ———— */}
        {tab === "local" && (
          <div className={styles.publishSection}>
            {!hasAnyLocalAsset ? (
              <div className={styles.modalEmptyHint}>
                <strong>本地还没有可分享的自创内容</strong>
                <p className={styles.note}>
                  你可以去角色档案里捏好角色卡、自创义体或出身特质，回来一键勾选发布；或者直接切到「AI
                  一句话生成」让模型帮你生成一整套！
                </p>
                <div className={styles.actions}>
                  <Button small primary onClick={() => setTab("ai")}>
                    试试 AI 一句话生成
                  </Button>
                  <Button small onClick={onGoCharacters}>
                    前往角色档案创作
                  </Button>
                </div>
              </div>
            ) : (
              <>
                {installedPacks.length > 0 && (
                  <div className={styles.pickGroup}>
                    <div className={styles.pickGroupHead}>
                      <strong>直接选择已安装的本地内容包</strong>
                      {pickedExistingPackId && (
                        <Button small onClick={() => selectExistingPack(null)}>
                          改回勾选散件
                        </Button>
                      )}
                    </div>
                    <div className={styles.filterPills}>
                      {installedPacks.map((entry) => (
                        <Button
                          key={entry.pack.id}
                          small
                          pressed={pickedExistingPackId === entry.pack.id}
                          onClick={() =>
                            selectExistingPack(
                              pickedExistingPackId === entry.pack.id ? null : entry.pack,
                            )
                          }
                        >
                          {entry.pack.title}
                          {savedTokens[entry.pack.id] ? " · 已发云端" : ""}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}

                {!pickedExistingPackId && (
                  <>
                    {customCharacters.length > 0 && (
                      <div className={styles.pickGroup}>
                        <div className={styles.pickGroupHead}>
                          <strong>我的角色卡 ({customCharacters.length})</strong>
                          <span className={styles.paneCount}>已选 {selectedCharIds.length}</span>
                        </div>
                        <ul className={styles.pickList}>
                          {customCharacters.map((entry) => {
                            const checked = selectedCharIds.includes(entry.id);
                            return (
                              <li key={entry.id} className={styles.pickItem}>
                                <ToggleCheck
                                  checked={checked}
                                  aria-label={`选择角色卡 ${entry.card.name}`}
                                  onChange={() =>
                                    setSelectedCharIds((cur) => toggleId(cur, entry.id))
                                  }
                                />
                                <div className={styles.pickItemText}>
                                  <strong>{entry.card.name}</strong>
                                  <span>{entry.card.origin || "原创角色"}</span>
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    )}

                    {localCyberware.length > 0 && (
                      <div className={styles.pickGroup}>
                        <div className={styles.pickGroupHead}>
                          <strong>角色工作台自创义体 ({localCyberware.length})</strong>
                          <span className={styles.paneCount}>已选 {selectedCwIds.length}</span>
                        </div>
                        <ul className={styles.pickList}>
                          {localCyberware.map((item) => {
                            const checked = selectedCwIds.includes(item.id);
                            return (
                              <li key={item.id} className={styles.pickItem}>
                                <ToggleCheck
                                  checked={checked}
                                  aria-label={`选择自创义体 ${item.name}`}
                                  onChange={() => setSelectedCwIds((cur) => toggleId(cur, item.id))}
                                />
                                <div className={styles.pickItemText}>
                                  <strong>{item.name}</strong>
                                  <span>{item.ability || item.summary || "自定义义体"}</span>
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    )}

                    {localModules.length > 0 && (
                      <div className={styles.pickGroup}>
                        <div className={styles.pickGroupHead}>
                          <strong>角色工作台自创出身 / 特质 / 缺陷 ({localModules.length})</strong>
                          <span className={styles.paneCount}>已选 {selectedModIds.length}</span>
                        </div>
                        <ul className={styles.pickList}>
                          {localModules.map((mod) => {
                            const checked = selectedModIds.includes(mod.id);
                            return (
                              <li key={mod.id} className={styles.pickItem}>
                                <ToggleCheck
                                  checked={checked}
                                  aria-label={`选择自创模块 ${mod.label}`}
                                  onChange={() => setSelectedModIds((cur) => toggleId(cur, mod.id))}
                                />
                                <div className={styles.pickItemText}>
                                  <strong>{mod.label}</strong>
                                  <span>{mod.ability || mod.hook || "自定义模块"}</span>
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        )}

        {/* ———— Tab 2: AI 一句话生成 ———— */}
        {tab === "ai" && (
          <div className={styles.publishSection}>
            <div className={styles.filterPills}>
              {AI_PROMPT_EXAMPLES.map((ex) => (
                <Button
                  key={ex.label}
                  small
                  disabled={aiGenerate.isPending}
                  onClick={() => setAiPrompt(ex.prompt)}
                >
                  示例：{ex.label}
                </Button>
              ))}
            </div>
            <label className={styles.editField}>
              <span>用一句话描述你想做的内容包（会调用你在设置里配置的辅助模型）</span>
              <FrameBox className={styles.compactTextarea}>
                <textarea
                  rows={3}
                  maxLength={1200}
                  value={aiPrompt}
                  disabled={aiGenerate.isPending}
                  placeholder="例如：帮我做一套荒坂叛逃黑客主题包，包含 1 个高隐蔽接入仓、1 把智能手枪和 2 条黑客特质…"
                  onChange={(e) => setAiPrompt(e.target.value)}
                />
              </FrameBox>
            </label>
            <div className={styles.aiControlsRow}>
              <div className={styles.filterPills}>
                {AI_FOCUS_OPTIONS.map((opt) => (
                  <Button
                    key={opt.id}
                    small
                    pressed={aiFocus === opt.id}
                    disabled={aiGenerate.isPending}
                    onClick={() => setAiFocus(opt.id)}
                  >
                    {opt.label}
                  </Button>
                ))}
              </div>
              <Button
                small
                primary
                disabled={aiGenerate.isPending || aiPrompt.trim().length < 4}
                onClick={() => aiGenerate.mutate()}
              >
                {aiGenerate.isPending ? "AI 正在生成…" : aiPack ? "重新生成" : "生成内容包"}
              </Button>
            </div>
            {aiError && (
              <div className={styles.validation} role="alert">
                <strong>⚠ {aiError}</strong>
              </div>
            )}
          </div>
        )}

        {/* ———— Tab 3: 上传 JSON 文件 ———— */}
        {tab === "json" && (
          <div className={styles.publishSection}>
            <section
              className={styles.modalDropzone}
              data-drag={dragOver || undefined}
              aria-label="拖放内容包 JSON"
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDropJson}
            >
              <strong>
                {dragOver ? "松开鼠标读取内容包" : "拖入 .json 内容包文件，或点击选择"}
              </strong>
              <p className={styles.note}>
                校验通过后可直接安装到本地，或配封面图一键发布到社区广场。
              </p>
              <div className={styles.actions}>
                <Button small primary onClick={() => fileInputRef.current?.click()}>
                  选择本地 JSON 文件
                </Button>
                <Button small pressed={jsonPasteOpen} onClick={() => setJsonPasteOpen((v) => !v)}>
                  {jsonPasteOpen ? "收起粘贴框" : "粘贴 JSON 文本"}
                </Button>
              </div>
              {jsonPasteOpen && (
                <div className={styles.pasteBox}>
                  <FrameBox className={styles.compactTextarea}>
                    <textarea
                      rows={5}
                      value={jsonPasteText}
                      placeholder="粘贴完整 v2 内容包 JSON…"
                      onChange={(e) => setJsonPasteText(e.target.value)}
                    />
                  </FrameBox>
                  <div className={styles.actions}>
                    <Button
                      small
                      primary
                      disabled={jsonPasteText.trim() === ""}
                      onClick={() => void validateJsonText(jsonPasteText)}
                    >
                      解析并校验
                    </Button>
                  </div>
                </div>
              )}
            </section>
            {jsonIssues.length > 0 && (
              <div className={styles.validation} role="alert">
                <strong>⚠ 发现 {jsonIssues.length} 个校验问题</strong>
                <ul>
                  {[...new Set(jsonIssues)].map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* ———— 待发布作品摘要 + 元信息 + 封面图 ———— */}
        {activePack && entryCount > 0 && (
          <div className={styles.publishReadyBox}>
            <div className={styles.publishPreviewHead}>
              <strong>作品已就绪 · 共 {entryCount} 项内容</strong>
              <div className={styles.chipRow}>
                {chips.map((label) => (
                  <span key={label} className={styles.chip}>
                    {label}
                  </span>
                ))}
              </div>
            </div>

            <div className={styles.editMetaGrid}>
              <label className={styles.editField}>
                <span>作品名称 *</span>
                <FrameBox className={styles.compactInput}>
                  <input
                    maxLength={40}
                    value={title}
                    placeholder={activePack.title}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </FrameBox>
              </label>
              <label className={styles.editField}>
                <span>创作者署名</span>
                <FrameBox className={styles.compactInput}>
                  <input
                    maxLength={40}
                    value={author}
                    placeholder="你的昵称（选填）"
                    onChange={(e) => setAuthor(e.target.value)}
                  />
                </FrameBox>
              </label>
            </div>

            <label className={styles.editField}>
              <span>作品简介</span>
              <FrameBox className={styles.compactInput}>
                <input
                  maxLength={300}
                  value={description}
                  placeholder={activePack.description || "一句话介绍这个作品的亮点…"}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </FrameBox>
            </label>

            {/* 封面图上传 */}
            <div className={styles.coverPicker}>
              <div className={styles.coverPickerHead}>
                <span>作品封面图（可选 · 自动裁切为 16:9 WebP ≤ 180 KB）</span>
                <div className={styles.actions}>
                  <Button
                    small
                    disabled={busy || compressingCover}
                    onClick={() => coverInputRef.current?.click()}
                  >
                    {compressingCover
                      ? "压缩中…"
                      : coverPreviewUrl || (existingCoverUrl && !clearExistingCover)
                        ? "更换封面"
                        : "选择封面图"}
                  </Button>
                  {(coverPreviewUrl || (existingCoverUrl && !clearExistingCover)) && (
                    <Button
                      small
                      disabled={busy || compressingCover}
                      onClick={() => {
                        if (coverPreviewUrl) URL.revokeObjectURL(coverPreviewUrl);
                        setCoverBlob(null);
                        setCoverPreviewUrl(null);
                        setCoverByteSize(null);
                        setClearExistingCover(Boolean(existingCoverUrl));
                        setCoverError(null);
                      }}
                    >
                      移除封面
                    </Button>
                  )}
                </div>
              </div>
              {coverError && <p className={styles.coverError}>{coverError}</p>}
              {(coverPreviewUrl || (existingCoverUrl && !clearExistingCover)) && (
                <div className={styles.coverPreviewBox}>
                  <img
                    src={coverPreviewUrl ?? existingCoverUrl ?? ""}
                    alt="封面预览"
                    className={styles.previewCoverImg}
                  />
                  {coverByteSize !== null && (
                    <span className={styles.coverSizeTag}>已压缩 {formatBytes(coverByteSize)}</span>
                  )}
                </div>
              )}
            </div>

            {/* 首次发布 vs 凭密钥更新 */}
            <div className={styles.modeSwitchRow}>
              <Button
                small
                pressed={publishMode === "create"}
                onClick={() => setPublishMode("create")}
              >
                作为新作品发布
              </Button>
              <Button
                small
                pressed={publishMode === "update"}
                onClick={() => setPublishMode("update")}
              >
                更新已有社区作品（凭密钥）
              </Button>
            </div>
            {publishMode === "update" && (
              <div className={styles.editMetaGrid}>
                <label className={styles.editField}>
                  <span>目标作品 ID</span>
                  <FrameBox className={styles.compactInput}>
                    <input
                      maxLength={22}
                      value={packId}
                      onChange={(e) => setPackId(e.target.value.trim())}
                    />
                  </FrameBox>
                </label>
                <label className={styles.editField}>
                  <span>
                    管理密钥
                    <small>{savedTokens[activePack.id] ? "已填入本机缓存" : "粘贴发布密钥"}</small>
                  </span>
                  <FrameBox className={styles.compactInput}>
                    <input
                      type="password"
                      value={tokenInput}
                      placeholder="cpwk_..."
                      onChange={(e) => setTokenInput(e.target.value)}
                    />
                  </FrameBox>
                </label>
              </div>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}
