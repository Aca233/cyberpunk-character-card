import { z } from "zod";

/** 武器技术体系（Power 动能机械 / Tech 电磁穿甲 / Smart 微陀螺智能制导） */
export const WeaponTechSchema = z.enum(["power", "tech", "smart"]);
export type WeaponTech = z.infer<typeof WeaponTechSchema>;

/** 武器隐蔽度（pocket 贴身藏匿 / coat 风衣遮蔽 / open 显眼长械 / heavy 重型车载军火） */
export const WeaponConcealmentSchema = z.enum(["pocket", "coat", "open", "heavy"]);
export type WeaponConcealment = z.infer<typeof WeaponConcealmentSchema>;

/** 武器声学特征（silent 消音或冷兵器暗杀 / loud 常规枪声 / explosive 剧烈爆炸） */
export const WeaponNoiseSchema = z.enum(["silent", "loud", "explosive"]);
export type WeaponNoise = z.infer<typeof WeaponNoiseSchema>;

/** 伤害档位：擦伤（轻伤）、重击（贯通重创）、致命（失能重残/濒死） */
export const DamageTierSchema = z.enum(["graze", "heavy", "lethal"]);
export type DamageTier = z.infer<typeof DamageTierSchema>;
