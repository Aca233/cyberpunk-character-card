import { npcRules } from "@cp/core";
import { useMutation } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { api, type BoardData } from "../../api/client";
import { ActionButton } from "../../ui/ActionButton";
import { Asset, cssUrl } from "../../ui/Asset";
import { Button } from "../../ui/Button";
import { FrameBox } from "../../ui/FrameBox";
import { portraitOf } from "../story/art";
import { embedNpcBodyDefs } from "./creator";
import { NpcGearPanel, type NpcLoadoutTab } from "./NpcGearPanel";
import wb from "./workbench.module.css";

const {
  BIO_CHARS,
  INITIAL_DOING_CHARS,
  LIMIT_CHARS,
  LOOK_CHARS,
  NAME_CHARS,
  NO_FACTION,
  NPC_CHROME_MAX,
  NPC_CIRCLES,
  NPC_CIRCLE_LABELS,
  NPC_GEAR_MAX,
  NPC_SAMPLES_MAX,
  OUTFIT_CHARS,
  ROLE_CHARS,
  SAMPLE_CHARS,
  SECRET_CHARS,
  VOICE_CHARS,
  WANT_CHARS,
  inferNpcCircle,
} = npcRules;

export type NpcWorkbenchMode = "create" | "edit-custom" | "edit-canon";
type NpcStepId = "identity" | "persona" | "gear";

const PRONOUN_PRESETS = ["他", "她", "TA"] as const;
const ENTITY_OPTIONS = [
  { id: "human", label: "人类" },
  { id: "synthetic", label: "合成人" },
  { id: "robot", label: "机器人" },
] as const;

const AI_PRESETS = [
  {
    label: "歌舞伎改枪老匠",
    prompt:
      "歌舞伎市场暗巷里帮佣兵改枪的暴躁老匠人，左手是老旧工业义肢，嘴毒但手艺顶尖，暗中替莫克斯改装军规手枪。",
  },
  {
    label: "离职荒坂黑客",
    prompt:
      "从荒坂反情报部逃出来的年轻女黑客，躲在沃森区破旧公寓里靠卖情报维生，说话冷静克制，手里攥着前上司的黑料。",
  },
  {
    label: "恶土走私车手",
    prompt:
      "常年在恶土和海伍德之间跑黑货的爽朗车手，开改装越野车，讲义气但绝不碰帮派人体零件生意，最近被乱刀会盯上。",
  },
] as const;

const NPC_STEPS: readonly {
  readonly id: NpcStepId;
  readonly code: string;
  readonly label: string;
  readonly title: string;
  readonly lead: string;
}[] = [
  {
    id: "identity",
    code: "01",
    label: "身份与归属",
    title: "身份铭牌与夜之城归属",
    lead: "设定人物姓名、外号、身份行当、所属势力、活动圈层与常驻地点；也可用 AI 一句话起草或局部润色。",
  },
  {
    id: "persona",
    code: "02",
    label: "外貌与性格",
    title: "外貌衣着、说话口吻与幕后设定",
    lead: "刻画体貌记忆点、衣着风格、语气与示范台词，以及人物的核心诉求、底线与幕后秘密。",
  },
  {
    id: "gear",
    code: "03",
    label: "义体与行装",
    title: "义体装配、随身武器与物品",
    lead: "完全复用角色创建工作台的义体人体拓扑、三段神经承载与全量武器/物品货架（含不朽与传说义体）。",
  },
];

function makeCustomNpcId(): string {
  const stamp = Date.now().toString(36).slice(-6);
  const rand = Math.floor(Math.random() * 1296)
    .toString(36)
    .padStart(2, "0");
  return `custom-npc-${stamp}${rand}`;
}

export interface NpcCreatorWorkbenchProps {
  readonly mode: NpcWorkbenchMode;
  readonly initial?: npcRules.NpcCard | undefined;
  readonly data: BoardData;
  readonly hasOverride?: boolean | undefined;
  readonly onSave: (card: npcRules.NpcCard) => void;
  readonly onReset?: (() => void) | undefined;
  readonly onDelete?: (() => void) | undefined;
  readonly onCancel: () => void;
}

/**
 * 2077 赛博人物档案工作台（NPC 版）：
 * 完整复用角色创建工作台（CharacterCreator）的整套界面框架：
 * - 顶部进度轨（01 身份与归属 / 02 外貌与性格 / 03 义体与行装）
 * - 左侧主编辑舞台（Step 03 直接挂载完整义体人体剪影 + 承载条 + 货架 + 武器/物品选择器）
 * - 右侧常驻 NC LIVE DOSSIER 实时人物档案栏 + 底部步骤导航与保存操作
 */
export function NpcCreatorWorkbench({
  mode,
  initial,
  data,
  hasOverride = false,
  onSave,
  onReset,
  onDelete,
  onCancel,
}: NpcCreatorWorkbenchProps) {
  const isCanonEdit = mode === "edit-canon";
  const [activeStep, setActiveStep] = useState<NpcStepId>("identity");
  const [gearTab, setGearTab] = useState<NpcLoadoutTab>("topology");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const stageRef = useRef<HTMLElement | null>(null);

  const [aiPrompt, setAiPrompt] = useState("");
  const [aiSuccessNote, setAiSuccessNote] = useState<string | null>(null);

  const [name, setName] = useState(initial?.name ?? "");
  const [alias, setAlias] = useState(initial?.alias ?? "");
  const [pronoun, setPronoun] = useState(initial?.pronoun ?? "TA");
  const [role, setRole] = useState(initial?.role ?? "");
  const [faction, setFaction] = useState(initial?.faction ?? NO_FACTION);
  const [circle, setCircle] = useState<"" | npcRules.NpcCircle>(initial?.circle ?? "");
  const [home, setHome] = useState(initial?.home ?? "");
  const [entity, setEntity] = useState<"human" | "synthetic" | "robot">(initial?.entity ?? "human");
  const [ageText, setAgeText] = useState(initial?.age !== undefined ? String(initial.age) : "");

  const [look, setLook] = useState(initial?.look ?? "");
  const [outfit, setOutfit] = useState(initial?.outfit ?? "");
  const [voice, setVoice] = useState(initial?.voice ?? "");
  const [samplesText, setSamplesText] = useState((initial?.samples ?? []).join("\n"));

  const [want, setWant] = useState(initial?.want ?? "");
  const [limit, setLimit] = useState(initial?.limit ?? "");
  const [initialDoing, setInitialDoing] = useState(initial?.initialDoing ?? "");

  const [spoilerOpen, setSpoilerOpen] = useState(!isCanonEdit);
  const [bio, setBio] = useState(initial?.bio ?? "");
  const [secret, setSecret] = useState(initial?.secret ?? "");

  const [gear, setGear] = useState<string[]>(initial?.body?.gear ?? []);
  const [cyberware, setCyberware] = useState<string[]>(initial?.body?.cyberware ?? []);
  const [error, setError] = useState<string | null>(null);

  const aiMutation = useMutation({
    mutationFn: () => {
      const preserveSpoilers = isCanonEdit && !spoilerOpen;
      const existingSnapshot: Partial<npcRules.NpcCard> | undefined =
        mode === "create" && !name.trim() && !role.trim()
          ? undefined
          : {
              ...(initial ?? {}),
              ...(name.trim() ? { name: name.trim() } : {}),
              ...(alias.trim() ? { alias: alias.trim() } : {}),
              pronoun,
              ...(role.trim() ? { role: role.trim() } : {}),
              faction,
              ...(circle ? { circle } : {}),
              ...(home ? { home } : {}),
              entity,
              ...(look.trim() ? { look: look.trim() } : {}),
              ...(outfit.trim() ? { outfit: outfit.trim() } : {}),
              ...(voice.trim() ? { voice: voice.trim() } : {}),
              ...(want.trim() ? { want: want.trim() } : {}),
              ...(limit.trim() ? { limit: limit.trim() } : {}),
              ...(initialDoing.trim() ? { initialDoing: initialDoing.trim() } : {}),
              ...(!preserveSpoilers && bio.trim() ? { bio: bio.trim() } : {}),
              ...(!preserveSpoilers && secret.trim() ? { secret: secret.trim() } : {}),
              body: {
                gear,
                cyberware,
                ...(initial?.body?.symptoms ? { symptoms: initial.body.symptoms } : {}),
              },
            };
      return api.interpretNpc({
        text: aiPrompt.trim(),
        existing: existingSnapshot,
        preserveSpoilers,
      });
    },
    onMutate: () => {
      setError(null);
      setAiSuccessNote(null);
    },
    onSuccess: (generated) => {
      setName(generated.name);
      setAlias(generated.alias ?? "");
      setPronoun(generated.pronoun);
      setRole(generated.role);
      setFaction(generated.faction);
      setCircle(generated.circle ?? "");
      setHome(generated.home ?? "");
      setEntity(generated.entity ?? "human");
      setAgeText(generated.age !== undefined ? String(generated.age) : "");
      setLook(generated.look);
      setOutfit(generated.outfit ?? "");
      setVoice(generated.voice);
      setSamplesText((generated.samples ?? []).join("\n"));
      setWant(generated.want);
      setLimit(generated.limit);
      setInitialDoing(generated.initialDoing ?? "");
      if (!isCanonEdit || spoilerOpen) {
        setBio(generated.bio ?? "");
        setSecret(generated.secret ?? "");
      }
      setAiSuccessNote("已按描述生成人物卡，可直接点击右侧保存，或切换步骤微调细节。");
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "AI 生成失败，请重试");
    },
  });

  const factionName = useMemo(() => {
    if (!faction || faction === NO_FACTION) return "无（独立）";
    return data.factions?.find((f) => f.id === faction)?.name ?? faction;
  }, [data.factions, faction]);

  const homeLabel = useMemo(() => {
    if (!home) return "随剧情出没";
    const found = data.locations?.find((l) => l.id === home);
    return found ? `${found.name}（${found.district}）` : home;
  }, [data.locations, home]);

  const resolvedCircle = useMemo(
    () =>
      circle ||
      inferNpcCircle({
        faction: faction || NO_FACTION,
        role: role.trim(),
      }),
    [circle, faction, role],
  );

  const nameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const [k, v] of Object.entries(data.names ?? {})) map.set(k, v);
    for (const c of data.npcCyberware ?? data.cyberware) map.set(c.id, c.name);
    for (const w of data.weapons ?? []) map.set(w.id, w.name);
    for (const i of data.items ?? []) map.set(i.id, i.name);
    return map;
  }, [data]);

  const checks = useMemo(() => {
    const list: { readonly step: NpcStepId; readonly text: string }[] = [];
    if (!name.trim()) list.push({ step: "identity", text: "填写人物姓名" });
    if (!role.trim()) list.push({ step: "identity", text: "填写人物身份或行当" });
    if (ageText.trim() !== "") {
      const n = Number(ageText.trim());
      if (!Number.isInteger(n) || n < 0 || n > 200) {
        list.push({ step: "identity", text: "年龄需为 0–200 的整数" });
      }
    }
    return list;
  }, [name, role, ageText]);

  const handleSubmit = () => {
    setError(null);
    const trimmedName = name.trim();
    const trimmedRole = role.trim();
    if (!trimmedName) {
      setActiveStep("identity");
      setError("请填写人物姓名");
      return;
    }
    if (!trimmedRole) {
      setActiveStep("identity");
      setError("请填写人物身份或行当（例如：歌舞伎暗巷改枪匠）");
      return;
    }
    let parsedAge: number | undefined;
    if (ageText.trim() !== "") {
      const n = Number(ageText.trim());
      if (!Number.isInteger(n) || n < 0 || n > 200) {
        setActiveStep("identity");
        setError("年龄需为 0 到 200 之间的整数，或留空");
        return;
      }
      parsedAge = n;
    }

    const samples = samplesText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, NPC_SAMPLES_MAX)
      .map((line) => line.slice(0, SAMPLE_CHARS));

    const finalLook =
      look.trim() || `${trimmedName}，${trimmedRole}，在夜之城街角一眼就能认出的熟面孔`;
    const finalVoice = voice.trim() || "语速平稳直接，带着夜之城街头人特有的分寸感与警惕";
    const finalWant = want.trim() || `在夜之城稳住作为${trimmedRole}的门路与生计`;
    const finalLimit = limit.trim() || "绝不为不值得的人搭上性命，也不容忍背后捅刀";

    const id = initial?.id ?? makeCustomNpcId();
    const nextBio = spoilerOpen ? bio.trim() : (initial?.bio ?? "");
    const nextSecret = spoilerOpen ? secret.trim() : (initial?.secret ?? "");

    const candidate = {
      id,
      name: trimmedName.slice(0, NAME_CHARS),
      ...(alias.trim() ? { alias: alias.trim().slice(0, NAME_CHARS) } : {}),
      pronoun: pronoun.trim() || "TA",
      role: trimmedRole.slice(0, ROLE_CHARS),
      faction: faction || NO_FACTION,
      ...(circle ? { circle } : {}),
      ...(parsedAge !== undefined ? { age: parsedAge } : {}),
      ...(initial?.adult !== undefined ? { adult: initial.adult } : {}),
      entity,
      look: finalLook.slice(0, LOOK_CHARS),
      ...(outfit.trim() ? { outfit: outfit.trim().slice(0, OUTFIT_CHARS) } : {}),
      voice: finalVoice.slice(0, VOICE_CHARS),
      samples,
      want: finalWant.slice(0, WANT_CHARS),
      limit: finalLimit.slice(0, LIMIT_CHARS),
      ...(nextBio ? { bio: nextBio.slice(0, BIO_CHARS) } : {}),
      ...(nextSecret ? { secret: nextSecret.slice(0, SECRET_CHARS) } : {}),
      ...(home ? { home } : {}),
      ...(initial?.hangouts?.length ? { hangouts: initial.hangouts } : {}),
      ...(initialDoing.trim()
        ? { initialDoing: initialDoing.trim().slice(0, INITIAL_DOING_CHARS) }
        : {}),
      canon: isCanonEdit ? Boolean(initial?.canon) : false,
      body: {
        gear,
        cyberware,
        ...(initial?.body?.symptoms ? { symptoms: initial.body.symptoms } : {}),
      },
    };

    const parsed = npcRules.NpcCardSchema.safeParse(candidate);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      setError(first ? `${first.path.join(".") || "人物卡"}：${first.message}` : "人物卡校验失败");
      return;
    }
    // 装备/义体里引用到的本地自建定义随卡面内嵌，开新档时服务端按快照进目录
    onSave(embedNpcBodyDefs(parsed.data));
  };

  const goToStep = (step: NpcStepId) => {
    setActiveStep(step);
    setSidebarOpen(false);
    stageRef.current?.scrollTo({ top: 0, behavior: "auto" });
  };

  const currentStepIndex = NPC_STEPS.findIndex((s) => s.id === activeStep);
  const currentStep = NPC_STEPS[currentStepIndex] ?? NPC_STEPS[0];
  const tabLineMask = cssUrl("tab.line");
  const gridUrl = cssUrl("fx.grid");
  const face = initial?.id ? portraitOf(initial.id) : undefined;
  const displayName = name.trim() || initial?.name || "未命名 NPC";
  const samplesCount = samplesText
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean).length;

  const stepMeta: Record<
    NpcStepId,
    { readonly badge: string; readonly ready: boolean; readonly warn: boolean }
  > = {
    identity: {
      badge: checks.length > 0 ? `待填 ${checks.length} 项` : displayName,
      ready: checks.length === 0,
      warn: checks.length > 0,
    },
    persona: {
      badge: look.trim() || voice.trim() || want.trim() ? "已刻画" : "可按默认补全",
      ready: Boolean(look.trim() || voice.trim() || want.trim()),
      warn: false,
    },
    gear: {
      badge: `义体 ${cyberware.length} · 装备 ${gear.length}`,
      ready: cyberware.length > 0 || gear.length > 0,
      warn: false,
    },
  };

  const gearNames = gear.map((id) => nameMap.get(id) ?? id);
  const chromeNames = cyberware.map((id) => nameMap.get(id) ?? id);

  return (
    <div className={wb.bench}>
      {/* —————— 顶部三步进度轨（对齐角色创建工作台） —————— */}
      <div className={wb.railBar}>
        <nav className={wb.stepRail} data-cols="3" aria-label="NPC 档案编辑步骤">
          {NPC_STEPS.map((step) => {
            const meta = stepMeta[step.id];
            const active = activeStep === step.id;
            const icon = meta.warn ? "⚠ " : meta.ready ? "✓ " : "";
            return (
              <button
                key={step.id}
                type="button"
                className={wb.stepBtn}
                aria-current={active ? "step" : undefined}
                data-warn={meta.warn ? "" : undefined}
                data-ready={meta.ready && !meta.warn ? "" : undefined}
                onClick={() => goToStep(step.id)}
              >
                <span className={wb.stepTopRow}>
                  <span className={wb.stepCode}>{step.code}</span>
                  <span className={wb.stepLabel}>{step.label}</span>
                  <span
                    className={wb.stepBadge}
                    data-warn={meta.warn ? "" : undefined}
                    data-ready={meta.ready && !meta.warn ? "" : undefined}
                  >
                    {icon}
                    {meta.badge}
                  </span>
                </span>
                <span
                  className={wb.stepUnderline}
                  style={{
                    maskImage: tabLineMask,
                    WebkitMaskImage: tabLineMask,
                  }}
                  aria-hidden
                />
              </button>
            );
          })}
        </nav>

        <div className={wb.mobileSummaryToggle}>
          <span className={wb.note}>
            {displayName} · 义体 {cyberware.length} · 装备 {gear.length}
          </span>
          <Button small pressed={sidebarOpen} onClick={() => setSidebarOpen((open) => !open)}>
            {sidebarOpen ? "收起档案" : "人物档案与保存"}
          </Button>
        </div>
      </div>

      {/* —————— 中央双栏：主编辑舞台 + 右侧常驻 NC LIVE DOSSIER —————— */}
      <div className={wb.mainSplit}>
        <div className={wb.stageShell}>
          <section
            ref={stageRef}
            className={wb.stageScroll}
            data-locked-scroll={activeStep === "gear" && gearTab === "topology" ? "" : undefined}
            aria-label={currentStep?.title}
          >
            <header className={wb.stageHead}>
              <div className={wb.stageHeadRow}>
                <span className={wb.stageCode}>STEP {currentStep?.code}</span>
                <h2 className={wb.stageTitle}>{currentStep?.title}</h2>
                <span className={wb.tag}>
                  {isCanonEdit
                    ? hasOverride
                      ? "原作人物 · 已自定义"
                      : "原作预设人物"
                    : mode === "create"
                      ? "新建 NPC"
                      : "自建 NPC"}
                </span>
              </div>
              <p className={wb.stageLead}>{currentStep?.lead}</p>
            </header>

            {/* ———— Step 01：身份与归属 ———— */}
            {activeStep === "identity" && (
              <div key="npc-step-identity" className={wb.stepBody}>
                {/* AI 一句话生成 / 润色条 */}
                <section className={wb.formCard} aria-label="AI 辅助起草或润色">
                  <div className={wb.npcAiBarHead}>
                    <h3 className={wb.cardTitle}>AI 人物起草 / 局部润色</h3>
                    <span className={wb.note}>
                      {mode === "create"
                        ? "一句话描述你想要的夜之城人物，交给辅助模型填满档案细节"
                        : "输入想调整的方向，交给辅助模型局部润色人物卡"}
                    </span>
                  </div>
                  {mode === "create" && (
                    <div className={wb.npcAiPresets}>
                      {AI_PRESETS.map((preset) => (
                        <Button
                          key={preset.label}
                          small
                          disabled={aiMutation.isPending}
                          onClick={() => setAiPrompt(preset.prompt)}
                        >
                          灵感：{preset.label}
                        </Button>
                      ))}
                    </div>
                  )}
                  <FrameBox className={wb.compactBox}>
                    <textarea
                      rows={2}
                      maxLength={600}
                      className={wb.npcTextarea}
                      value={aiPrompt}
                      placeholder={
                        mode === "create"
                          ? "例如：沃森区靠黑市义体维生的老独眼医生，嘴上嫌麻烦却总给街头穷小子赊账…"
                          : "例如：把性格改得更圆滑些、常驻改去来生酒吧，或补充几句更犀利的台词…"
                      }
                      onChange={(e) => setAiPrompt(e.target.value)}
                    />
                  </FrameBox>
                  <div className={wb.npcAiBarFoot}>
                    <Button
                      small
                      primary
                      disabled={aiMutation.isPending || aiPrompt.trim().length < 3}
                      reason="请先输入至少 3 个字的描述"
                      onClick={() => aiMutation.mutate()}
                    >
                      {aiMutation.isPending
                        ? "生成中…"
                        : mode === "create"
                          ? "✦ AI 生成人物卡"
                          : "✦ AI 润色人物卡"}
                    </Button>
                    {aiSuccessNote && <span className={wb.footerSaved}>{aiSuccessNote}</span>}
                  </div>
                </section>

                {/* 身份铭牌（对齐 CharacterCreator Step 01 的 CITIZEN ID） */}
                <section className={wb.formCard} aria-label="人物身份铭牌">
                  <h3 className={wb.cardTitle}>身份铭牌 · NPC ID</h3>
                  <div className={wb.nameGrid}>
                    <label className={wb.field}>
                      <span>
                        姓名 <b className={wb.req}>*</b>
                        <small>
                          {name.length} / {NAME_CHARS}
                        </small>
                      </span>
                      <FrameBox className={wb.compactBox}>
                        <input
                          value={name}
                          maxLength={NAME_CHARS}
                          placeholder="例如：阿九、蕾拉·陈"
                          onChange={(e) => setName(e.target.value)}
                        />
                      </FrameBox>
                    </label>
                    <label className={wb.field}>
                      <span>
                        外号 / 简称{" "}
                        <small>
                          {alias.length} / {NAME_CHARS}
                        </small>
                      </span>
                      <FrameBox className={wb.compactBox}>
                        <input
                          value={alias}
                          maxLength={NAME_CHARS}
                          placeholder="选填，如：修枪佬、老维"
                          onChange={(e) => setAlias(e.target.value)}
                        />
                      </FrameBox>
                    </label>
                    <div className={wb.field}>
                      <span>
                        人称代词 <b className={wb.req}>*</b>
                      </span>
                      <div className={wb.pronounRow}>
                        <fieldset className={wb.pronounPills} aria-label="常用人称代词">
                          {PRONOUN_PRESETS.map((p) => (
                            <Button
                              key={p}
                              small
                              pressed={pronoun === p}
                              onClick={() => setPronoun(p)}
                            >
                              {p}
                            </Button>
                          ))}
                        </fieldset>
                      </div>
                    </div>
                  </div>

                  <div className={wb.npcMetaGrid}>
                    <label className={wb.field} style={{ gridColumn: "1 / -1" }}>
                      <span>
                        身份 / 行当 <b className={wb.req}>*</b>
                        <small>
                          {role.length} / {ROLE_CHARS}
                        </small>
                      </span>
                      <FrameBox className={wb.compactBox}>
                        <input
                          value={role}
                          maxLength={ROLE_CHARS}
                          placeholder="例如：歌舞伎暗巷改枪匠 / 前荒坂反情报分析员"
                          onChange={(e) => setRole(e.target.value)}
                        />
                      </FrameBox>
                    </label>

                    <div className={wb.field}>
                      <span>实体类型</span>
                      <fieldset className={wb.pronounPills} aria-label="实体类型">
                        {ENTITY_OPTIONS.map((opt) => (
                          <Button
                            key={opt.id}
                            small
                            pressed={entity === opt.id}
                            onClick={() => setEntity(opt.id)}
                          >
                            {opt.label}
                          </Button>
                        ))}
                      </fieldset>
                    </div>

                    <label className={wb.field}>
                      <span>年龄（选填）</span>
                      <FrameBox className={wb.compactBox}>
                        <input
                          inputMode="numeric"
                          maxLength={3}
                          value={ageText}
                          placeholder="例如：34"
                          onChange={(e) => setAgeText(e.target.value.replace(/[^\d]/g, ""))}
                        />
                      </FrameBox>
                    </label>
                  </div>
                </section>

                {/* 势力、圈层与常驻地 */}
                <section className={wb.formCard} aria-label="夜之城归属与落脚点">
                  <h3 className={wb.cardTitle}>夜之城归属 · AFFILIATION</h3>
                  <div className={wb.npcMetaGrid}>
                    <label className={wb.field}>
                      <span>所属势力</span>
                      <FrameBox className={wb.compactBox}>
                        <select value={faction} onChange={(e) => setFaction(e.target.value)}>
                          <option value={NO_FACTION}>无（独立 / 自由人）</option>
                          {(data.factions ?? []).map((f) => (
                            <option key={f.id} value={f.id}>
                              {f.name}
                            </option>
                          ))}
                        </select>
                      </FrameBox>
                    </label>

                    <label className={wb.field}>
                      <span>夜之城圈层</span>
                      <FrameBox className={wb.compactBox}>
                        <select
                          value={circle}
                          onChange={(e) => setCircle(e.target.value as "" | npcRules.NpcCircle)}
                        >
                          <option value="">
                            自动归类（当前：{NPC_CIRCLE_LABELS[resolvedCircle]}）
                          </option>
                          {NPC_CIRCLES.map((c) => (
                            <option key={c} value={c}>
                              {NPC_CIRCLE_LABELS[c]}
                            </option>
                          ))}
                        </select>
                      </FrameBox>
                    </label>

                    <label className={wb.field} style={{ gridColumn: "1 / -1" }}>
                      <span>常驻地点</span>
                      <FrameBox className={wb.compactBox}>
                        <select value={home} onChange={(e) => setHome(e.target.value)}>
                          <option value="">不固定 / 随剧情出没</option>
                          {(data.locations ?? []).map((loc) => (
                            <option key={loc.id} value={loc.id}>
                              {loc.name}（{loc.district}）
                            </option>
                          ))}
                        </select>
                      </FrameBox>
                    </label>
                  </div>
                </section>
              </div>
            )}

            {/* ———— Step 02：外貌与性格 ———— */}
            {activeStep === "persona" && (
              <div key="npc-step-persona" className={wb.stepBody}>
                <section className={wb.formCard} aria-label="外貌与说话风格">
                  <h3 className={wb.cardTitle}>外貌与口吻 · APPEARANCE &amp; VOICE</h3>
                  <div className={wb.npcFormStack}>
                    <label className={wb.field}>
                      <span>
                        外貌特征{" "}
                        <small>
                          {look.length} / {LOOK_CHARS}
                        </small>
                      </span>
                      <FrameBox className={wb.compactBox}>
                        <textarea
                          rows={2}
                          maxLength={LOOK_CHARS}
                          className={wb.npcTextarea}
                          value={look}
                          placeholder="选填，留空将按姓名与身份自动补全一句可见外观"
                          onChange={(e) => setLook(e.target.value)}
                        />
                      </FrameBox>
                    </label>

                    <label className={wb.field}>
                      <span>
                        常穿衣着{" "}
                        <small>
                          {outfit.length} / {OUTFIT_CHARS}
                        </small>
                      </span>
                      <FrameBox className={wb.compactBox}>
                        <input
                          maxLength={OUTFIT_CHARS}
                          value={outfit}
                          placeholder="选填，如：油污工装背心、发光翻领旧夹克"
                          onChange={(e) => setOutfit(e.target.value)}
                        />
                      </FrameBox>
                    </label>

                    <label className={wb.field}>
                      <span>
                        说话口吻{" "}
                        <small>
                          {voice.length} / {VOICE_CHARS}
                        </small>
                      </span>
                      <FrameBox className={wb.compactBox}>
                        <textarea
                          rows={2}
                          maxLength={VOICE_CHARS}
                          className={wb.npcTextarea}
                          value={voice}
                          placeholder="选填，例如：嘴硬心软、语速利落、夹带海伍德街头俚语"
                          onChange={(e) => setVoice(e.target.value)}
                        />
                      </FrameBox>
                    </label>

                    <label className={wb.field}>
                      <span>
                        经典台词样本（每行一句，最多 {NPC_SAMPLES_MAX} 句）
                        <small>{samplesCount} 句</small>
                      </span>
                      <FrameBox className={wb.compactBox}>
                        <textarea
                          rows={3}
                          className={wb.npcTextarea}
                          value={samplesText}
                          placeholder="选填，每行写一句能体现此人口气的典型台词"
                          onChange={(e) => setSamplesText(e.target.value)}
                        />
                      </FrameBox>
                    </label>
                  </div>
                </section>

                <section className={wb.formCard} aria-label="核心诉求、底线与幕后秘密">
                  <h3 className={wb.cardTitle}>性格与幕后 · MOTIVATION &amp; SECRETS</h3>
                  <div className={wb.npcFormStack}>
                    <label className={wb.field}>
                      <span>
                        核心诉求 / 想要什么{" "}
                        <small>
                          {want.length} / {WANT_CHARS}
                        </small>
                      </span>
                      <FrameBox className={wb.compactBox}>
                        <textarea
                          rows={2}
                          maxLength={WANT_CHARS}
                          className={wb.npcTextarea}
                          value={want}
                          placeholder="近期最在意的事、长期目标或放不下的执念"
                          onChange={(e) => setWant(e.target.value)}
                        />
                      </FrameBox>
                    </label>

                    <label className={wb.field}>
                      <span>
                        底线 / 绝不触碰{" "}
                        <small>
                          {limit.length} / {LIMIT_CHARS}
                        </small>
                      </span>
                      <FrameBox className={wb.compactBox}>
                        <textarea
                          rows={2}
                          maxLength={LIMIT_CHARS}
                          className={wb.npcTextarea}
                          value={limit}
                          placeholder="一碰就会彻底翻脸的规矩、逆鳞或对象"
                          onChange={(e) => setLimit(e.target.value)}
                        />
                      </FrameBox>
                    </label>

                    <label className={wb.field}>
                      <span>
                        开局幕后近况{" "}
                        <small>
                          {initialDoing.length} / {INITIAL_DOING_CHARS}
                        </small>
                      </span>
                      <FrameBox className={wb.compactBox}>
                        <input
                          maxLength={INITIAL_DOING_CHARS}
                          value={initialDoing}
                          placeholder="选填，开局时此人正在忙什么"
                          onChange={(e) => setInitialDoing(e.target.value)}
                        />
                      </FrameBox>
                    </label>

                    <div className={wb.npcSpoilerBox}>
                      <div className={wb.npcSpoilerHead}>
                        <span className={wb.cardTitle}>生平背景与隐藏秘密</span>
                        {isCanonEdit && (
                          <ActionButton onClick={() => setSpoilerOpen((v) => !v)}>
                            {spoilerOpen ? "收起幕后" : "含剧透 · 点击展开查看/编辑"}
                          </ActionButton>
                        )}
                      </div>
                      {spoilerOpen ? (
                        <div className={wb.npcFormStack}>
                          <label className={wb.field}>
                            <span>
                              生平背景与性格底色{" "}
                              <small>
                                {bio.length} / {BIO_CHARS}
                              </small>
                            </span>
                            <FrameBox className={wb.compactBox}>
                              <textarea
                                rows={2}
                                maxLength={BIO_CHARS}
                                className={wb.npcTextarea}
                                value={bio}
                                placeholder="选填，供叙事模型在幕后把握人物履历与反差感"
                                onChange={(e) => setBio(e.target.value)}
                              />
                            </FrameBox>
                          </label>
                          <label className={wb.field}>
                            <span>
                              隐藏秘密 / 致命软肋{" "}
                              <small>
                                {secret.length} / {SECRET_CHARS}
                              </small>
                            </span>
                            <FrameBox className={wb.compactBox}>
                              <textarea
                                rows={2}
                                maxLength={SECRET_CHARS}
                                className={wb.npcTextarea}
                                value={secret}
                                placeholder="选填，暗中瞒着的事或私下交易（不会直接透给玩家）"
                                onChange={(e) => setSecret(e.target.value)}
                              />
                            </FrameBox>
                          </label>
                        </div>
                      ) : (
                        <p className={wb.note}>
                          已折叠原作生平与秘密防剧透；未展开直接保存时，将原样保留原作设定。
                        </p>
                      )}
                    </div>
                  </div>
                </section>
              </div>
            )}

            {/* ———— Step 03：义体与行装（完整复用角色创建同款界面） ———— */}
            {activeStep === "gear" && (
              <NpcGearPanel
                data={data}
                gear={gear}
                cyberware={cyberware}
                onChangeGear={setGear}
                onChangeCyberware={setCyberware}
                subTab={gearTab}
                onSubTabChange={setGearTab}
              />
            )}
          </section>
        </div>

        {/* —————— 右侧常驻实时档案栏（NC LIVE DOSSIER · NPC 版） —————— */}
        <aside
          className={wb.dossierAside}
          data-open={sidebarOpen || undefined}
          aria-label="实时 NPC 档案与保存台"
        >
          <span className={wb.hudGridBg} style={{ backgroundImage: gridUrl }} aria-hidden />
          <div className={wb.asideScroll}>
            <div className={wb.asideHead}>
              <span className={wb.asideCode}>{"NC // NPC DOSSIER"}</span>
              <span className={wb.asideStatus} data-ready={checks.length === 0 ? "" : undefined}>
                {checks.length === 0 ? "✓ READY" : `待填 ${checks.length} 项`}
              </span>
            </div>

            <div className={wb.dossierHero}>
              <div className={wb.dossierPortraitFrame}>
                {face ? (
                  <Asset id={face} className={wb.portraitImg} />
                ) : (
                  <div className={wb.npcPortraitFallback} aria-hidden="true">
                    <span>{displayName.slice(0, 1)}</span>
                  </div>
                )}
              </div>

              <div className={wb.dossierHeroMeta}>
                <div className={wb.asideIdentity}>
                  <strong className={wb.asideName}>
                    {displayName}
                    {alias.trim() && <small>「{alias.trim()}」</small>}
                  </strong>
                  <span className={wb.asideSub}>
                    {role.trim() || "待填身份 / 行当"} · {pronoun}
                  </span>
                </div>
                <div className={wb.asideMeter}>
                  <div className={wb.asideMeterHead}>
                    <span>夜之城圈层</span>
                    <b>{NPC_CIRCLE_LABELS[resolvedCircle]}</b>
                  </div>
                  <p className={wb.humanityNote}>
                    {factionName} · {homeLabel}
                  </p>
                </div>
              </div>
            </div>

            <div className={wb.dossierTelemetry}>
              <div className={wb.teleCell}>
                <span className={wb.teleKey}>装配义体</span>
                <strong className={wb.teleVal}>
                  {cyberware.length}/{NPC_CHROME_MAX}
                </strong>
                <span className={wb.teleSub}>含不朽与传说</span>
              </div>
              <div className={wb.teleCell}>
                <span className={wb.teleKey}>随身行装</span>
                <strong className={wb.teleVal}>
                  {gear.length}/{NPC_GEAR_MAX}
                </strong>
                <span className={wb.teleSub}>武器/服装/物品</span>
              </div>
              <div className={wb.teleCell}>
                <span className={wb.teleKey}>台词样本</span>
                <strong className={wb.teleVal}>{samplesCount} 句</strong>
                <span className={wb.teleSub}>
                  {entity === "human" ? "人类" : entity === "synthetic" ? "合成人" : "机器人"}
                </span>
              </div>
            </div>

            <dl className={wb.asideList}>
              <div>
                <dt>外貌</dt>
                <dd>{look.trim() || "保存时按姓名与身份自动补全"}</dd>
              </div>
              {outfit.trim() && (
                <div>
                  <dt>衣着</dt>
                  <dd>{outfit.trim()}</dd>
                </div>
              )}
              <div>
                <dt>口吻</dt>
                <dd>{voice.trim() || "保存时自动补全默认街头口吻"}</dd>
              </div>
              <div>
                <dt>义体</dt>
                <dd>{chromeNames.length > 0 ? chromeNames.join(" / ") : "未装配"}</dd>
              </div>
              <div>
                <dt>行装</dt>
                <dd>{gearNames.length > 0 ? gearNames.join(" / ") : "未选配"}</dd>
              </div>
            </dl>

            {checks.length > 0 && (
              <section className={wb.asideChecks} aria-label="待完善项">
                <span className={wb.asideCheckTitle}>需完善后方可保存</span>
                <ul>
                  {checks.map((c) => (
                    <li key={c.text}>
                      <button
                        type="button"
                        className={wb.checkJump}
                        onClick={() => goToStep(c.step)}
                      >
                        ⚠ {c.text} →
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>

          <div className={wb.launchDock}>
            {error && (
              <p className={wb.error} role="alert">
                {error}
              </p>
            )}
            <div className={wb.launchActionsRow}>
              <Button primary disabled={checks.length > 0} onClick={handleSubmit}>
                {mode === "create"
                  ? "✦ 保存自建 NPC"
                  : mode === "edit-custom"
                    ? "✦ 保存 NPC 修改"
                    : "✦ 保存人物覆写"}
              </Button>
            </div>
            <div className={wb.launchSubActions}>
              <Button small onClick={onCancel}>
                取消返回
              </Button>
              {mode === "edit-canon" && hasOverride && onReset && (
                <ActionButton onClick={onReset}>恢复原作默认</ActionButton>
              )}
              {mode === "edit-custom" && onDelete && (
                <ActionButton onClick={onDelete}>删除自建 NPC</ActionButton>
              )}
            </div>
          </div>
        </aside>
      </div>

      {/* —————— 底部步骤导航条 —————— */}
      <footer className={wb.footerBar}>
        <div className={wb.footerLeft}>
          <span className={wb.footerMeta}>
            第 {currentStepIndex + 1} / {NPC_STEPS.length} 步 · {currentStep?.label}
          </span>
          <span className={wb.footerHint}>
            {isCanonEdit
              ? "修改原作人物后将立即生效于后续开局，且随时可一键恢复原作默认"
              : "保存后存入本地 NPC 档案库，可在任意新档与人物关系中复用"}
          </span>
        </div>
        <div className={wb.footerRight}>
          {currentStepIndex > 0 && (
            <Button
              small
              onClick={() => {
                const prev = NPC_STEPS[currentStepIndex - 1];
                if (prev) goToStep(prev.id);
              }}
            >
              ← 上一步
            </Button>
          )}
          {currentStepIndex < NPC_STEPS.length - 1 && (
            <Button
              small
              primary
              onClick={() => {
                const next = NPC_STEPS[currentStepIndex + 1];
                if (next) goToStep(next.id);
              }}
            >
              下一步 →
            </Button>
          )}
        </div>
      </footer>
    </div>
  );
}
