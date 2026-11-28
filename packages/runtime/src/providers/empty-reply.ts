import type { LlmUsage } from "@cp/core";
import { UpstreamError } from "./http";

export interface EmptyReplyDetails {
  readonly finishReason: string;
  readonly maxOutputTokens: number | undefined;
  readonly usage: LlmUsage | undefined;
  readonly hasThought: boolean;
  readonly thinkingTokens?: number | undefined;
}

/** 空回复也保留上游结束原因和用量，不能把思考耗尽额度误报成模型名错误。 */
export class EmptyReplyError extends UpstreamError {
  constructor(
    provider: string,
    readonly details: EmptyReplyDetails,
  ) {
    const stats = [
      `结束原因：${details.finishReason || "上游未提供"}`,
      `最大输出：${details.maxOutputTokens === undefined ? "上游默认" : `${details.maxOutputTokens} token`}`,
      details.usage
        ? `输入 ${details.usage.inputTokens}、输出 ${details.usage.outputTokens} token`
        : "上游未返回用量",
      `已收到思考内容：${details.hasThought ? "是" : "否"}`,
      ...(details.thinkingTokens !== undefined ? [`思考 ${details.thinkingTokens} token`] : []),
    ].join("；");
    const finish = details.finishReason.trim().toLowerCase();
    const exhausted = finish === "length" || finish === "max_tokens";
    super(
      exhausted
        ? `${provider} 在返回可用正文前已用尽输出额度（${stats}）。思考过程也会占用输出额度；请提高该连接的最大输出，或在上游降低思考预算后重试。`
        : `${provider} 没有返回可用正文（${stats}）。请检查上游服务与模型是否支持当前请求后重试。`,
    );
    this.name = "EmptyReplyError";
  }
}
