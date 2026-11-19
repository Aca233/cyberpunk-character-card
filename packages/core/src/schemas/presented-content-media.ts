import { z } from "zod";
import { ContentMediaListSchema } from "./content-media";

/** 回合内实际呈现的媒体快照，之后回看不借用当前片段或重新查询作品目录。 */
export const PresentedContentMediaSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  source: z.enum(["chip", "braindance"]),
  media: ContentMediaListSchema.min(1),
});
export type PresentedContentMedia = z.infer<typeof PresentedContentMediaSchema>;
