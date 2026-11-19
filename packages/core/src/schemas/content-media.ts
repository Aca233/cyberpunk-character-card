import { z } from "zod";

const HttpMediaUrlSchema = z.url({ protocol: /^https?$/ });

/** 内容附件只引用真实网页或媒体资源，不接受脚本、内联数据或本机文件协议。 */
export function isSafeContentMediaUrl(value: string): boolean {
  if (!value || value.length > 2048 || value.includes("\\")) return false;
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 32 || (code >= 127 && code <= 159) || /\s/u.test(character)) return false;
  }
  const rootPath = value.startsWith("/") && !value.startsWith("//");
  if (!rootPath && !/^https?:\/\//i.test(value)) return false;
  const absolute = rootPath ? `https://content.invalid${value}` : value;
  if (/^https?:\/\/[^/?#]*@/i.test(absolute)) return false;
  return HttpMediaUrlSchema.safeParse(absolute).success;
}

const ContentMediaUrlSchema = z
  .string()
  .min(1)
  .max(2048)
  .refine(isSafeContentMediaUrl, "媒体地址须为 http/https 网页或单斜杠开头的同源路径");
const Common = {
  url: ContentMediaUrlSchema.describe("已经存在且可用的媒体文件或网页地址，不得编造"),
  label: z.string().trim().min(1).max(120),
  caption: z.string().trim().min(1).max(800).optional(),
};

/** 与芯片分段、超梦片段一起定稿的附件；浏览器加载不代表游戏内联网或获得知识。 */
export const ContentMediaSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("link"), ...Common }),
  z.object({ kind: z.literal("image"), ...Common }),
  z.object({
    kind: z.literal("video"),
    ...Common,
    poster: ContentMediaUrlSchema.optional(),
    captionsUrl: ContentMediaUrlSchema.optional(),
  }),
  z.object({ kind: z.literal("audio"), ...Common }),
]);
export type ContentMedia = z.infer<typeof ContentMediaSchema>;
export const ContentMediaListSchema = z.array(ContentMediaSchema).max(8);
