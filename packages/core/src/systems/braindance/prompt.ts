import type { RuleModule } from "../../kernel/system";
import type { WorldState } from "../../kernel/world";
import type { ContentMedia } from "../../schemas/content-media";
import { formatGameTime, WorldClockStateSchema } from "../world";
import { braindanceCatalog, braindanceSources, braindanceWork } from "./apply";
import {
  BD_LAYER_LABELS,
  BD_MODE_LABELS,
  BD_TIER_LABELS,
  type BdWork,
  type BraindanceState,
} from "./schema";

const WORDS = /超梦|braindance|BD|选片|看一部|挑片|黑超梦|XBD|录制|热成像|音轨|编辑模式/i;
const RETURN_WORDS = /回放|重播|重看|上一部|刚才那部|刚看|继续看片|再看|扫描|分析/;

export const braindanceRules: RuleModule<BraindanceState> = {
  id: "braindance",
  title: "超梦体验、三层扫描与现场录制",
  commands: ["braindance"],
  when: (state, input) =>
    input.mode !== "ooc" &&
    (state.active !== null ||
      WORDS.test(input.text) ||
      (state.history.length > 0 && RETURN_WORDS.test(input.text)) ||
      Object.values(state.works).some((w) => input.text.includes(w.title))),
  judge: `- 超梦分级：commercial（商业娱乐）、sensory（感官调谐）、raw（调查原片）、xbd（地下黑超梦）。无需骰点或数值属性检定，全按硬件条件与情境定性裁决。
- 模式硬限制：普通便携播放器（bd-portable-player）仅能沉浸回放（immerse）；进入编辑分析（edit）扫描视觉/音频/热成像三层线索必须持有专业编辑头环（bd-editor-wreath）或在具备调谐工作站的场馆（如丽姿酒吧地下室）操作。
- 地下黑超梦（xbd）缺少安全滤波，沉浸观看时可能引发剧烈感官过载、短暂解离或闪回等具体精神症状，不做数值扣除。
- 现场录制原片必须已安装且完好的「超梦录制器（braindance-recorder）」义体。`,
  narrate: `- 超梦既是夜之城的日常消遣（如丽姿酒吧包厢），也是调查取证工具；不因看片强加任务、奖励或危险。
- 已有作品的片段、定稿原文与三层细节是固定记录，不随玩家猜测改写原片。片中人物只按原记录行动；录制者的感官与情绪是传入神经的刺激，不替玩家决定好恶或立场。
- 沉浸模式以录制者第一人称感官经历呈现；编辑模式下玩家脱离感官束缚，切换视觉、音频或热成像图层逐一排查已看片段里的细节。地下黑超梦（XBD）缺少安全滤波，仅在确实冲击感官时写出过载或短暂抽离，不按次数预设症状。`,
  text: `- 超梦既是夜之城日常娱乐（如丽姿酒吧），也是调查取证工具。不强加任务、奖励或强制危险。
- 使用已有作品 id；新确立作品先 define 固定层级（tier）、录制者、简介、片段与三层细节（visual/audio/thermal），不能随玩家猜测篡改原片。
- 场馆消费（如丽姿酒吧包厢）走普通口头报价+trade 结账，不再强制五项条款；自有芯片载体配播放器/编辑头环直接用 play(source={kind:"carrier",carrier,device}) 接入。
- play 接入或恢复/切换模式（immerse/edit）；progress 呈现下一片段（初次写定稿原文 text；重播旧片段写 replay:true）；scan 在编辑模式下扫描 visual/audio/thermal 图层揭示已看片段中的隐藏细节；record 用已安装的超梦录制器现场录下 raw 原片并生成芯片载体；stop 暂停（paused）、退出（exited）或略写看完（finished）。
- progress / scan / stop(finished) 的游戏分钟由代码结算，不要重复发 world.time。
- 媒体附件（media）只引用已确立资源，不编造链接。片中人物只按原记录行动，录制者的情绪只是感官输入，不替玩家决定喜好或立场。`,
};

const publicWork = (work: BdWork) =>
  `${work.id}「${work.title}」[${BD_TIER_LABELS[work.tier]}]；录制者：${work.recorder}；${work.durationMinutes} 分钟；简介：${work.synopsis}${work.xbdRisk ? `；XBD风险：${work.xbdRisk}` : ""}`;

const fixedMedia = (
  media: readonly ContentMedia[] | undefined,
  stage?: "judge" | "narrate" | "extract",
): string =>
  media?.length && stage === "extract"
    ? `；同段固定媒体元数据：${JSON.stringify(media)}（不据链接补出未知内容）`
    : "";

function sourceLabel(
  source: {
    readonly kind: string;
    readonly venue?: string;
    readonly carrier?: string;
    readonly device?: string;
  },
  stage?: "judge" | "narrate" | "extract",
): string {
  if (stage === "extract") return JSON.stringify(source);
  if (source.kind === "venue") return `场馆设备（${source.venue ?? "现场"}）`;
  return `随身芯片载体 ${source.carrier ?? ""}${source.device ? ` / 播放设备 ${source.device}` : ""}`;
}

export function braindanceSection(
  state: BraindanceState,
  data: Readonly<Record<string, unknown>>,
  input: { readonly text: string },
  world?: WorldState,
  stage?: "judge" | "narrate" | "extract",
): string {
  const all = [
    ...braindanceCatalog(data),
    ...Object.values(state.works).filter(
      (w) => !braindanceCatalog(data).some((a) => a.id === w.id),
    ),
  ];
  const here = world ? WorldClockStateSchema.parse(world.slices.world).location : null;
  const active = state.active;
  const recent = state.history.at(-1);
  const focusId =
    active?.work ??
    all.find((w) => input.text.includes(w.id) || input.text.includes(w.title))?.id ??
    (recent && RETURN_WORDS.test(input.text) ? recent.work : undefined);
  const lines: string[] = [];

  if (WORDS.test(input.text) || active || focusId) {
    const selected = all.filter(
      (w) =>
        w.location === here ||
        input.text.includes(w.title) ||
        input.text.includes(w.id) ||
        active?.work === w.id ||
        focusId === w.id ||
        (w.location === undefined && WORDS.test(input.text)),
    );
    for (const work of selected) {
      lines.push(`- 固定作品：${publicWork(work)}`);
      const sources = world ? braindanceSources(work, data, world.slices) : [];
      for (const option of sources) {
        lines.push(
          `  - 可用来源：${sourceLabel(option.source, stage)}；支持编辑图层：${option.analysis.map((l) => `${l}(${BD_LAYER_LABELS[l]})`).join("、") || "仅沉浸回放"}`,
        );
      }
      if (!active && (focusId === work.id || sources.length > 0)) {
        const previous = state.history.filter((h) => h.work === work.id).at(-1);
        if (previous) {
          lines.push(
            `  - 历史记录 ${previous.id}：位置 ${previous.position}/${work.passages.length}，已看 ${previous.watchedMinutes} 分钟${stage === "extract" ? `（续接可填 from="${previous.id}"）` : ""}。`,
          );
        }
        const first = work.passages[0];
        if (first && sources.length > 0) {
          lines.push(
            `  - 首片段 ${first.id}「${first.label}」${first.minutes} 分钟：${state.passages[work.id]?.[first.id] ?? first.outline}${fixedMedia(first.media, stage)}`,
          );
        }
      }
    }
  }

  if (active) {
    const work = braindanceWork(state, data, active.work);
    if (!work) return lines.join("\n");
    lines.push(
      `- 当前体验 ${active.id}：${work.id}［${BD_TIER_LABELS[work.tier]}｜${BD_MODE_LABELS[active.mode]}｜${active.status === "paused" ? "已暂停" : "播放中"}］；进度 ${active.position}/${work.passages.length}（已看 ${active.watchedMinutes}/${work.durationMinutes} 分钟，耗时 ${active.elapsed} 分钟）；来源 ${sourceLabel(active.source, stage)}`,
    );
    const next = work.passages[active.position];
    if (next) {
      const fixed = state.passages[work.id]?.[next.id];
      lines.push(
        `- 下一片段 ${next.id}「${next.label}」${next.minutes} 分钟：${fixed ? `已有定稿原文（保持一致）：${fixed}` : `梗概：${next.outline}`}${fixedMedia(next.media, stage)}`,
      );
    } else {
      lines.push(
        stage === "narrate"
          ? "- 全部片段已看完；可以切编辑模式排查图层、重播片段或摘下头环结束。"
          : "- 全部片段已看完；可切编辑模式扫描图层、重播片段或 stop(finished) 结束。",
      );
    }
    const seen = new Set(work.passages.slice(0, active.position).map((p) => p.id));
    for (const passage of work.passages.slice(0, active.position)) {
      const fixed = state.passages[work.id]?.[passage.id];
      lines.push(
        `- 已看片段 ${passage.id}「${passage.label}」${passage.minutes} 分钟${RETURN_WORDS.test(input.text) ? `：${fixed ?? passage.outline}${fixedMedia(passage.media, stage)}` : ""}`,
      );
    }
    if (active.mode === "edit" && seen.size > 0) {
      const undiscovered = work.details.filter(
        (d) =>
          seen.has(d.passage) &&
          !state.discoveries.some((found) => found.work === work.id && found.detail === d.id),
      );
      if (undiscovered.length > 0) {
        lines.push(
          stage === "narrate"
            ? "- 编辑模式下已看片段的隐藏细节（玩家实际扫到对应图层时才揭露）："
            : "- 编辑模式下已看片段的可扫描细节（玩家实际扫到对应图层后用 scan 揭示）：",
        );
        for (const d of undiscovered) {
          lines.push(
            `  - [${d.layer}/${BD_LAYER_LABELS[d.layer]}] ${d.id}（片段 ${d.passage}）：${d.finding}`,
          );
        }
      } else {
        lines.push("- 已看片段的三层材料已全部扫出。");
      }
    }
  }

  const relevant = new Set(
    all
      .filter(
        (w) =>
          w.id === active?.work ||
          w.id === focusId ||
          input.text.includes(w.id) ||
          input.text.includes(w.title) ||
          (WORDS.test(input.text) && w.location === here),
      )
      .map((w) => w.id),
  );
  for (const d of state.discoveries.filter((d) => relevant.has(d.work))) {
    lines.push(
      `- 已发现材料 [${BD_LAYER_LABELS[d.layer]}] ${d.work}/${d.detail}：${d.finding}（${formatGameTime(d.at)}）`,
    );
  }
  for (const h of state.history.filter((h) => relevant.has(h.work)).slice(-4)) {
    lines.push(
      `- 历史体验 ${h.id}：${h.work}，${formatGameTime(h.at)} ${h.outcome === "finished" ? "看完" : "中途退出"}（已看 ${h.watchedMinutes} 分钟）`,
    );
  }
  return lines.join("\n");
}
