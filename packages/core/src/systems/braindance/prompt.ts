import type { RuleModule } from "../../kernel/system";
import type { WorldState } from "../../kernel/world";
import { formatGameTime, WorldClockStateSchema } from "../world";
import { braindanceCatalog, braindanceWork } from "./apply";
import type { BdWork, BraindanceState } from "./schema";

const WORDS = /超梦|braindance|BD|选片|看一部|挑片/i;
export const braindanceRules: RuleModule<BraindanceState> = {
  id: "braindance",
  title: "超梦体验与正文查证",
  commands: ["braindance"],
  when: (state, input) =>
    input.mode !== "ooc" &&
    (state.active !== null ||
      WORDS.test(input.text) ||
      Object.values(state.works).some((w) => input.text.includes(w.title))),
  judge:
    "- 超梦选择、正常体验和正文查证不需要小游戏。按实际来源与设备判断能做什么；追问、猜测不是已经查明的事实。",
  text: `- 超梦是日常娱乐，也可以是资料；没有任务仍可选片、正常消费、重看、与朋友交流并离开。不强加危险、奖励或片后委托。
- 使用已有作品 id；正文中新确立作品先 define 固定录制者、简介、各片段梗概、时长和材料中实际可查细节，不能随着玩家猜测改内容。不要照着玩家猜的幕后因果补证据，也不创建标准答案。
- 询价、简介和讨论不扣款。店内先由 commerce.offer 明确 bd-session、作品、范围、总时长和提前结束条件；玩家接受后 trade 成交，再 start 引用该 offer 形成的服务 id。自有载体播放引用实际 carrier 对象及手边的超梦设备；重看不重复购片。
- start 只接入；progress 按下一片段写实际体验，保存作品自身的定稿正文。continue 用下一次 progress，finish 是略写看完剩余内容，exit 仅记录已发生体验。暂停交流用 pause，回来用 resume。重看定稿不能改录制事件，现场朋友的插话不进入作品原文。
- progress/finish/replay/inspect 的游戏分钟由代码结算；不要为同一段观看或分析另发 world.time/phases。略写只省略文字，不免去剩余时间。查阅已经写出的文字不等于实际重播，不发 replay。
- 记录里的人只能按原记录行动，不会回应观看者或因为被观看成为现实熟人。录制者的情绪只是感知输入，不替玩家决定喜好、感情、台词或动作。
- 查证在正文中响应玩家实际追问、请人分析或回放；只可使用本轮提供的可查材料和已知发现。没有录到、设备不支持或无法辨认时保留不确定性，不能临时补真相。观察、文件说法、人物推断分别表达；没有证据也能行动、继续调查或改判断，不自动判任务失败。
- 谁在场、同看过什么、摘设备后听到什么、明确说出的评价，沿用 NPC 与共同记忆规则分别记录。店员不知道私人体验；付款不证明偏好、信任或恋爱。`,
};

const publicWork = (work: BdWork) =>
  `${work.id}「${work.title}」；录制者：${work.recorder}；${work.durationMinutes} 分钟；简介：${work.synopsis}`;

export function braindanceSection(
  state: BraindanceState,
  data: Readonly<Record<string, unknown>>,
  input: { readonly text: string },
  world?: WorldState,
): string {
  const all = [
    ...braindanceCatalog(data),
    ...Object.values(state.works).filter(
      (w) => !braindanceCatalog(data).some((a) => a.id === w.id),
    ),
  ];
  const here = world ? WorldClockStateSchema.parse(world.slices.world).location : null;
  const active = state.active;
  const lines: string[] = [];
  if (WORDS.test(input.text) || active || all.some((w) => input.text.includes(w.title))) {
    const selected = all.filter(
      (w) =>
        w.location === here ||
        input.text.includes(w.title) ||
        input.text.includes(w.id) ||
        active?.work === w.id ||
        (w.location === undefined && WORDS.test(input.text)),
    );
    for (const work of selected) lines.push(`- 固定作品：${publicWork(work)}`);
  }
  if (active) {
    const work = braindanceWork(state, data, active.work);
    if (!work) return lines.join("\n");
    lines.push(
      `- 当前体验 ${active.id}：${work.id}；${active.status === "paused" ? "已暂停" : "播放中"}；下一片段序号 ${active.position}；已看 ${active.watchedMinutes}/${work.durationMinutes} 分钟；含重播分析实际消耗 ${active.elapsed} 分钟；来源 ${JSON.stringify(active.source)}`,
    );
    const next = work.passages[active.position];
    if (next) {
      const fixed = state.passages[work.id]?.[next.id];
      lines.push(
        `- 下一片段 ${next.id}「${next.label}」，${next.minutes} 分钟；${fixed ? `已有定稿原文（保持一致）：${fixed}` : `仅可据此展开，不能改主要事件：${next.outline}`}`,
      );
    } else lines.push("- 全部片段已经实际看过；可以交流、追问、回放或 finish 正常结束。");
    const replay = /回放|重播|重看|再看|刚才|前一段/.test(input.text);
    for (const passage of work.passages.slice(0, active.position)) {
      const fixed = state.passages[work.id]?.[passage.id];
      lines.push(
        `- 已看片段 ${passage.id}「${passage.label}」${passage.minutes} 分钟${replay && (input.text.includes(passage.label) || input.text.includes(passage.id) || passage === work.passages[active.position - 1]) ? `；固定内容：${fixed ?? passage.outline}` : ""}`,
      );
    }
    const seen = new Set(work.passages.slice(0, active.position).map((p) => p.id));
    const requested = work.details.filter(
      (d) => seen.has(d.passage) && d.cues.some((cue) => input.text.includes(cue)),
    );
    for (const detail of requested)
      lines.push(
        `- 本轮主动查证可揭示（原材料内已有，不是结论）：${detail.id}；片段 ${detail.passage}；方法 ${detail.method}；${detail.finding}。实际分析后 inspect 记录，所需分钟按活动判断。`,
      );
    if (/查|分析|辨认|声音|热源|红外|是谁|哪里/.test(input.text) && requested.length === 0)
      lines.push(
        "- 本轮没有匹配到更多可查原材料；可据已经呈现内容讨论或保留不确定性，不能补出未提供的证据。",
      );
  }
  const relevant = new Set(
    all
      .filter(
        (w) =>
          w.id === active?.work ||
          input.text.includes(w.id) ||
          input.text.includes(w.title) ||
          (WORDS.test(input.text) && w.location === here),
      )
      .map((w) => w.id),
  );
  for (const d of state.discoveries.filter((d) => relevant.has(d.work)))
    lines.push(
      `- 已发现材料 ${d.work}/${d.detail}：${d.finding}；来源时间 ${formatGameTime(d.at)}。材料说法不等于幕后因果已证实。`,
    );
  for (const h of state.history.filter((h) => relevant.has(h.work)).slice(-4))
    lines.push(
      `- 实际经历：${h.work}，${formatGameTime(h.at)} ${h.outcome === "finished" ? "看完" : "中途退出"}；已看 ${h.watchedMinutes} 分钟。未说出口的评价不在此推断。`,
    );
  return lines.join("\n");
}
