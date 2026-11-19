import type { RuleModule } from "../../kernel/system";
import type { WorldState } from "../../kernel/world";
import { CommerceStateSchema } from "../commerce";
import { formatGameTime, merchantAt, merchantSites, WorldClockStateSchema } from "../world";
import { braindanceCatalog, braindanceSources, braindanceWork } from "./apply";
import type { BdWork, BraindanceState } from "./schema";

const WORDS = /超梦|braindance|BD|选片|看一部|挑片/i;
const RETURN_WORDS = /回放|重播|重看|上一部|刚才那部|刚看|继续看片|再看/;
export const braindanceRules: RuleModule<BraindanceState> = {
  id: "braindance",
  title: "超梦体验与正文查证",
  commands: ["braindance"],
  when: (state, input) =>
    input.mode !== "ooc" &&
    (state.active !== null ||
      WORDS.test(input.text) ||
      (state.history.length > 0 && RETURN_WORDS.test(input.text)) ||
      Object.values(state.works).some((w) => input.text.includes(w.title))),
  judge:
    "- 超梦选择、正常体验和正文查证不需要小游戏。按实际来源与设备判断能做什么；追问、猜测不是已经查明的事实。",
  text: `- 超梦是日常娱乐，也可以是资料；没有任务仍可选片、正常消费、重看、与朋友交流并离开。不强加危险、奖励或片后委托。
- 使用已有作品 id；正文中新确立作品先 define 固定录制者、简介、各片段梗概、时长和材料中实际可查细节，不能随着玩家猜测改内容。不要照着玩家猜的幕后因果补证据，也不创建标准答案。
- 询价、简介和讨论不扣款。店内先由 commerce.offer 明确 bd-session、作品、范围、总时长和提前结束条件；玩家接受后 trade 成交，再 start 引用该 offer 形成的服务 id。自有载体播放引用实际 carrier 对象及手边的超梦设备；重看不重复购片。
- start 只接入；progress 按下一片段写实际体验，初次 text 必须引用本轮正文中作品自身的定稿原文，重播已有定稿省略 text。continue 用下一次 progress，finish 是略写看完剩余内容，exit 仅记录已发生体验。暂停交流用 pause，回来用 resume。已结束后要在实际来源上接着查证或续看，可用新 start 并填 from=原体验 id；自有作品不再买片，已结束的按次服务不能复用。重看定稿不能改录制事件，现场朋友的插话不进入作品原文。
- progress/finish/replay/inspect 的游戏分钟由代码结算；不要为同一段观看或分析另发 world.time/phases。略写只省略文字，不免去剩余时间；此前略写的片段后来首次重播展开时，replay.text 仍须保存这次的实际定稿原文。查阅已经写出的文字不等于实际重播，不发 replay。
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
  const recent = state.history.at(-1);
  const paidWork = world
    ? Object.values(CommerceStateSchema.parse(world.slices.commerce).sessions).find(
        (s) =>
          s.service === "bd-session" &&
          ["active", "paused"].includes(s.status) &&
          s.location === here,
      )?.terms.subject
    : undefined;
  const focusId =
    active?.work ??
    paidWork ??
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
      const pending = world
        ? Object.values(CommerceStateSchema.parse(world.slices.commerce).quotes).filter(
            (q) =>
              q.status === "offered" &&
              q.kind === "service" &&
              q.target === "bd-session" &&
              q.session?.subject === work.id &&
              (q.expiresAt === null || q.expiresAt > world.time) &&
              merchantSites(data).get(q.seller)?.braindanceDevice?.playback &&
              merchantSites(data)
                .get(q.seller)
                ?.locations.some((loc) => merchantAt(data, q.seller, loc, here)),
          )
        : [];
      for (const option of sources)
        lines.push(
          `  - 当前实际可用来源：${JSON.stringify(option.source)}；支持分析 ${option.analysis.join("、") || "无"}。已持有作品不再付购片费；服务来源必须引用此已成交 id。`,
        );
      const paid = sources.some((s) => s.source.kind === "service");
      for (const quote of pending)
        lines.push(
          `  - 尚未成交报价 ${quote.id}：${quote.price} 欧元。仅当本轮玩家明确接受并且 trade 成功，才可 start.source={"kind":"service","id":"${quote.id}"}；报价本身不代表可播放。`,
        );
      if (!active && (focusId === work.id || paid || pending.length)) {
        const previous = state.history.filter((h) => h.work === work.id).at(-1);
        if (previous)
          lines.push(
            `  - 如续接/查证可 start.from=${previous.id}，位置 ${previous.position}，已看 ${previous.watchedMinutes} 分钟；从头重看则不写 from。已结束的原服务不是当前可用来源。`,
          );
        const first = work.passages[0];
        if (first && (sources.length || pending.length))
          lines.push(
            `  - 从头开始时的首片段 ${first.id}「${first.label}」${first.minutes} 分钟：${state.passages[work.id]?.[first.id] ?? first.outline}。必须先 start，再记录 progress；仅询价不能演成已经观看。`,
          );
        const watched = previous?.position ?? 0;
        for (const passage of work.passages.slice(0, watched)) {
          if (
            RETURN_WORDS.test(input.text) &&
            (input.text.includes(passage.label) || passage === work.passages[watched - 1])
          )
            lines.push(
              `  - 已看片段 ${passage.id}「${passage.label}」${passage.minutes} 分钟：${state.passages[work.id]?.[passage.id] ?? passage.outline}`,
            );
        }
        for (const detail of work.details.filter(
          (d) =>
            work.passages.slice(0, watched).some((p) => p.id === d.passage) &&
            d.cues.some((cue) => input.text.includes(cue)) &&
            sources.some((s) => s.analysis.includes(d.method)),
        ))
          lines.push(
            `  - 本轮有来源的查证材料 ${detail.id}（${detail.passage}/${detail.method}）：${detail.finding}。只有实际重新接入并分析后才 inspect 记为新发现；没有来源则不能声称又播了一次。`,
          );
      }
    }
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
    const device = world
      ? braindanceSources(work, data, world.slices).find(
          (s) => JSON.stringify(s.source) === JSON.stringify(active.source),
        )
      : undefined;
    const requested = work.details.filter(
      (d) =>
        seen.has(d.passage) &&
        d.cues.some((cue) => input.text.includes(cue)) &&
        device?.analysis.includes(d.method),
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
          w.id === focusId ||
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
      `- 实际经历 ${h.id}：${h.work}，${formatGameTime(h.at)} ${h.outcome === "finished" ? "看完" : "中途退出"}；已看 ${h.watchedMinutes} 分钟。未说出口的评价不在此推断。`,
    );
  return lines.join("\n");
}
