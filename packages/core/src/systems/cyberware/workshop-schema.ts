import { z } from "zod";
import { CyberwareTermsSchema } from "./schema";

export const ClinicCommandSchema = z.strictObject({
  type: z.literal("cyberware.clinic"),
  doc: z.string().min(1),
  open: z.boolean().optional(),
  staff: z.array(z.string().min(1)).optional(),
  equipment: z.array(z.string().min(1)).optional(),
  reason: z.string().min(1),
  evidence: z.string().min(1),
  sourceEvent: z.string().min(1).optional(),
});
export const PartCommandSchema = z
  .strictObject({
    type: z.literal("cyberware.part"),
    action: z.enum(["record", "takeStock", "transfer", "condition"]),
    part: z.string().min(1),
    model: z.string().min(1).optional(),
    from: z.string().min(1).optional(),
    holder: z.string().min(1).optional(),
    location: z.string().min(1).optional(),
    condition: z.enum(["intact", "damaged", "scrapped"]).optional(),
    source: z.string().min(1),
    evidence: z.string().min(1),
  })
  .describe(
    "登记实际找到、赠与、转交或检测过的未安装义体实物；必须记录来源与正文证据，不用物品目录生成免费装备。已安装或进行中手术的实物不能直接转交。",
  );
export const SupplyCommandSchema = z
  .strictObject({
    type: z.literal("cyberware.supply"),
    action: z.enum(["order", "cancel"]),
    id: z.string().min(1),
    doc: z.string().min(1).optional(),
    source: z.string().min(1),
    stock: z.record(z.string(), z.number().int().min(1)).optional(),
    route: z.array(z.string().min(1)).optional(),
    due: z.number().int().optional(),
    evidence: z.string().min(1),
  })
  .describe(
    "已确认的真实供货单；必须有供货方、货物、路线与到达时间。到货由游戏时间和物流路况本地推进，不随重访补满。",
  );
export const ServiceCommandSchema = z
  .strictObject({
    type: z.literal("cyberware.service"),
    action: z.enum(["book", "start", "complete", "interrupt", "resume", "cancel"]),
    id: z.string().min(1),
    request: CyberwareTermsSchema.optional(),
    scheduledAt: z.number().int().optional(),
    startAt: z.number().int().optional(),
    reason: z.string().min(1),
    evidence: z.string().min(1),
  })
  .describe(
    "义体服务订单：book 只预约不扣款；start 开始并实际扣款/接收实物/拆旧；complete 完成安装。interrupt/resume 按剩余游戏时间继续；cancel 保留已完成阶段及实物真实去向，不凭空退款或还原身体。",
  );
export type ClinicCommand = z.infer<typeof ClinicCommandSchema>;
export type PartCommand = z.infer<typeof PartCommandSchema>;
export type SupplyCommand = z.infer<typeof SupplyCommandSchema>;
export type ServiceCommand = z.infer<typeof ServiceCommandSchema>;
export type WorkshopCommand = ClinicCommand | PartCommand | SupplyCommand | ServiceCommand;

export const CyberwareStashSchema = z.strictObject({
  type: z.literal("cyberware.stash"),
  part: z.string().min(1),
  action: z.enum(["store", "take"]),
  where: z.string().min(1),
  location: z.string().min(1).nullable(),
});
export type CyberwareStashCommand = z.infer<typeof CyberwareStashSchema>;
