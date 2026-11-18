import type { AbortSignalLike, LlmClient, LlmEvent, LlmRequest } from "@cp/core";
import type { EvalCase } from "./case";

/**
 * 只测记账的用例：判断和写正文由用例写死，不调叙事模型；抽取和核对照常交给辅助模型。
 * 这样测的是漏抽和误抽，不受正文写得怎样影响
 */
export function scriptedNarrator(c: EvalCase, aux: LlmClient): LlmClient {
  const narrative = c.narrative;
  if (narrative === undefined) return aux;
  const judged = JSON.stringify({
    read: null,
    ooc: false,
    ruling: null,
    buy: null,
    recall: [],
    foes: null,
    ...c.judged,
  });
  return {
    async *stream(request: LlmRequest, signal?: AbortSignalLike): AsyncIterable<LlmEvent> {
      if (request.responseFormat?.name === "judge") {
        yield { type: "text", text: judged };
        yield { type: "done", finishReason: "stop" };
        return;
      }
      if (request.purpose === "aux") {
        yield* aux.stream(request, signal);
        return;
      }
      // 叙事模型仅在写正文时调用一次
      yield { type: "text", text: narrative };
      yield { type: "done", finishReason: "stop" };
    },
  };
}
