import type { RuleModule } from "../../kernel/system";
import { formatGameTime } from "../world";
import { braindanceExamples, canConclude, keyProgress } from "./apply";
import {
  BD_ABANDON,
  BD_KEYS_MAX,
  BD_KEYS_MIN,
  BD_LAYER_LABELS,
  type BdInvestigation,
  type BraindanceState,
} from "./schema";

type Data = Readonly<Record<string, unknown>>;

const WORDS = /超梦|braindance|BD/i;

export const braindanceRules: RuleModule<BraindanceState> = {
  id: "braindance",
  title: "超梦调查",
  commands: ["braindance"],
  when: (state, input) => input.mode !== "ooc" && (state.active !== null || WORDS.test(input.text)),
  text: `- 玩家拿到一段要查的超梦（委托给的、找超梦编辑借来或请人剪的、正文里捡到的芯片）并真的接上时，写 braindance start，把整段录像一次写好；录像写定以后不能改，你之后说的也要和它一致。
- 超梦里只有录制者当时感知到的东西：录制者没看见、没听见的不会在录像里。视频层写画面，音频层写声音（能分辨远近、方向），红外层写热源、体温、刚开过火的枪管。
- 线索点要分散在不同段、不同层里，关键线索 ${BD_KEYS_MIN}–${BD_KEYS_MAX} 条且至少分在两层，再放几条看着可疑、其实无关的；扫描结果照原作写成「类型：」「状态：」这种名目加一句结论。结论选项里要有看着说得通的错误答案，正确答案只有找全关键线索才推得出来。
- 玩家在超梦体验编辑器里自己切编码层、拖时间轴、标线索，不经过你，也不掷骰；你不要替玩家说出线索或答案。玩家在正文里说看到了什么，以【超梦】里的录像为准，录像里没有的就是没有。
- 玩家下结论（或退出）的那一轮，【超梦】会写明推对还是推错：照这个往下写，推错了就让错误的判断产生后果；为委托查的，委托照这个结局收场（推错了一般是 failed 或 flawed，写 jobEnd）。不要在正文里直接宣布「你推错了」，让局面说话。`,
};

function investigationLines(inv: BdInvestigation): string[] {
  const r = inv.recording;
  const { found, total } = keyProgress(inv);
  const lines = [
    `- 正在查：「${r.title}」，${r.recorder}录制${r.job ? `，为委托 ${r.job} 查的` : ""}，${formatGameTime(inv.startedAt)}接上；关键线索找到 ${found}/${total}${canConclude(inv) ? "，玩家可以下结论了" : ""}`,
  ];
  r.segments.forEach((s, i) => {
    lines.push(
      `  - 第 ${i} 段 ${s.time}「${s.label}」视频：${s.visual}｜音频：${s.audio}｜红外：${s.thermal}`,
    );
  });
  for (const p of r.points) {
    const facts = p.scan.facts.map((f) => `${f.name}${f.value}`).join("，");
    lines.push(
      `  - 线索点 ${p.id}：第 ${p.segment} 段${BD_LAYER_LABELS[p.layer]}层「${p.label}」${p.key ? "【关键】" : ""}${inv.marked.includes(p.id) ? "，玩家标出来了" : ""}；扫描：${facts}；${p.scan.conclusion}`,
    );
  }
  lines.push(
    `  - 结论选项：${r.conclusions.map((o) => `${o.id}「${o.text}」${o.id === r.answer ? "（正确）" : ""}`).join("；")}`,
  );
  lines.push(`  - 真相（只给你）：${r.truth}`);
  return lines;
}

/**
 * 给叙事模型的【超梦】：正在查的录像全文（含关键线索、答案、真相）、玩家这一轮下的结论和对错、
 * 最近查完的两次；没在查、玩家又提到超梦时附一段示例录像照着写
 */
export function braindanceSection(
  state: BraindanceState,
  data: Data,
  input: { readonly text: string; readonly braindance?: string | undefined },
): string {
  const lines: string[] = [];
  const inv = state.active;
  if (inv) {
    lines.push(...investigationLines(inv));
    const chosen = input.braindance;
    if (chosen === BD_ABANDON) {
      lines.push("- 这一轮玩家没下结论，退出了超梦：录像里看到的照常记得，只是没推出结论");
    } else if (chosen !== undefined) {
      const option = inv.recording.conclusions.find((o) => o.id === chosen);
      if (option && canConclude(inv)) {
        const right = chosen === inv.recording.answer;
        lines.push(
          `- 这一轮玩家下了结论：「${option.text}」——${right ? "推对了" : "推错了"}。${right ? "照真相往下写，玩家可以据此行动" : "玩家会照这个错误的判断行动；照真相写后果，不要直接点破"}`,
        );
      }
    }
  }
  for (const h of state.history.slice(-2)) {
    const verdict = h.correct === null ? "没下结论就退出了" : h.correct ? "推对了" : "推错了";
    lines.push(
      `- 查过：「${h.title}」${formatGameTime(h.at)}，${h.optionText ? `结论「${h.optionText}」，` : ""}${verdict}；真相：${h.truth}`,
    );
  }
  if (!inv && WORDS.test(input.text)) {
    const list = braindanceExamples(data);
    const example = list.length > 0 ? list[state.history.length % list.length] : undefined;
    if (example) {
      lines.push(
        `- 示例录像（${example.when}；照这个格式按眼下的局面写，不要照搬）：${JSON.stringify(example.recording)}`,
      );
    }
  }
  return lines.join("\n");
}
