import type { EventContext, SystemEvent } from "../../kernel/system";
import { formatGameTime } from "../world";
import { suppressantStatus } from "./apply";
import { PsychosisStateSchema } from "./schema";

/** 赛博精神病系统交的系统通知：压制剂药效、耐受、依赖、戒断、发作与失控 */
export function psychosisEvents({ before, after }: EventContext): readonly SystemEvent[] {
  const was = PsychosisStateSchema.parse(before.world.slices.psychosis);
  const now = PsychosisStateSchema.parse(after.world.slices.psychosis);
  const wasS = suppressantStatus(was.doses, before.world.time);
  const nowS = suppressantStatus(now.doses, after.world.time);
  const events: SystemEvent[] = [];

  const wasLatest = was.doses.length === 0 ? null : Math.max(...was.doses);
  const nowLatest = now.doses.length === 0 ? null : Math.max(...now.doses);
  const dosed = nowLatest !== null && nowLatest !== wasLatest;

  if (dosed) {
    const until = nowS.until ?? after.world.time;
    events.push({
      source: "psychosis",
      icon: "attention",
      text: `已注射神经压制剂（起效到 ${formatGameTime(until)}）`,
      tone: "good",
    });
    if (wasS.withdrawal && !nowS.withdrawal) {
      events.push({
        source: "psychosis",
        icon: "attention",
        text: "戒断症状缓和下来",
        tone: "good",
      });
    }
    if (nowS.tolerant && !wasS.tolerant) {
      events.push({
        source: "psychosis",
        icon: "warning",
        text: "压制剂出现耐受：药效时长减半",
        tone: "bad",
      });
    }
    if (nowS.dependent && !wasS.dependent) {
      events.push({
        source: "psychosis",
        icon: "warning",
        text: "已形成压制剂依赖：停药一天后出现戒断",
        tone: "bad",
      });
    }
  } else {
    if (wasS.until !== null && nowS.until === null) {
      events.push({
        source: "psychosis",
        icon: "warning",
        text: "神经压制剂药效已过",
        tone: "info",
      });
    }
    if (!wasS.withdrawal && nowS.withdrawal) {
      events.push({
        source: "psychosis",
        icon: "warning",
        text: "压制剂戒断发作：焦躁、手抖、失眠",
        tone: "bad",
      });
    }
  }

  if (now.episodeScene !== was.episodeScene && now.episodeScene !== null) {
    const wasLast = was.blackouts.at(-1);
    const nowLast = now.blackouts.at(-1);
    const newBlackout =
      nowLast !== undefined &&
      nowLast.to === null &&
      (wasLast === undefined ||
        wasLast.to !== null ||
        wasLast.scene !== nowLast.scene ||
        wasLast.from !== nowLast.from);
    events.push({
      source: "psychosis",
      icon: "warning",
      text: newBlackout
        ? "赛博精神病重度发作（事后将出现记忆空白）"
        : "赛博精神病发作：感知出现失真",
      tone: "bad",
    });
  }

  if (now.lostControl > was.lostControl) {
    events.push({
      source: "psychosis",
      icon: "warning",
      text: "精神防线失守：出现短暂失控",
      tone: "bad",
    });
  }

  return events;
}
