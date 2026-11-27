import { z } from "zod";
import type { LlmResponseFormat } from "../kernel/ports";

/** 从 Zod schema 生成给模型看的简写格式，例如 {"type": "heal", "source": "maxdoc"|"rest"} */

interface JsonSchema {
  readonly type?: string | readonly string[];
  readonly enum?: readonly unknown[];
  readonly const?: unknown;
  readonly properties?: Readonly<Record<string, JsonSchema>>;
  readonly required?: readonly string[];
  readonly items?: JsonSchema;
  readonly anyOf?: readonly JsonSchema[];
  readonly oneOf?: readonly JsonSchema[];
  readonly description?: string;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly maxLength?: number;
  /** schema 的 meta 里指定的写法，代替自动生成的（例如能接受两种输入、只想让模型用一种） */
  readonly modelDoc?: string;
}

/** 超过这个范围的上下限是 Zod 默认的安全整数边界，不写出来 */
const SHOWN_LIMIT = 1_000_000;

/** 抽取指令中高频重复的枚举简写表（在 extractRules 顶层统一给出一次，避免在 80+ 条指令里重复展开） */
const COMMON_ENUM_ALIASES: readonly (readonly [string, string])[] = [
  [
    '"pistol"|"revolver"|"smg"|"assaultRifle"|"shotgun"|"precisionRifle"|"sniperRifle"|"lmg"|"blade"|"blunt"',
    "<武器类>",
  ],
  ['"head"|"face"|"chest"|"belly"|"left-arm"|"right-arm"|"left-leg"|"right-leg"', "<部位>"],
  ['"left-arm"|"right-arm"|"left-leg"|"right-leg"', "<肢体>"],
  ['"weapon"|"healing"|"grenade"|"consumable"|"clothing"|"mod"|"misc"', "<物品类>"],
  ['"common"|"uncommon"|"rare"|"epic"|"legendary"', "<稀有度>"],
  ['"head"|"face"|"outer"|"inner"|"legs"|"feet"', "<服装位>"],
  ['"detached"|"unstable"|"edge"|"crisis"', "<神经阶段>"],
  ['"intel"|"daemon"|"skill"|"braindance"|"behavior"', "<芯片类>"],
  ['"off"|"doll"|"protocol"|"glitch"', "<行为态>"],
  ['"muzzle"|"scope"|"plugin"', "<改装槽>"],
  ['"visual"|"audio"|"thermal"', "<轨道>"],
  ['"power"|"tech"|"smart"', "<武器型>"],
  ['"graze"|"heavy"|"lethal"', "<伤档>"],
  ['"keep"|"sell"|"scrap"', "<旧件去向>"],
];

const ENUM_ALIAS_MAP = new Map<string, string>(COMMON_ENUM_ALIASES);

/** 抽取指令共享类型与枚举图例，在系统层顶部只打印一次 */
export const COMMAND_DOC_LEGEND = [
  "格式缩写：str=文本，int=整数，num=数字，bool=true|false，字段后 ? 表示可选。",
  `常用枚举：${COMMON_ENUM_ALIASES.map(([raw, alias]) => `${alias}=${raw}`).join("；")}`,
].join("\n");

function range(schema: JsonSchema, name: string): string {
  const min = schema.minimum !== undefined && Math.abs(schema.minimum) < SHOWN_LIMIT;
  const max = schema.maximum !== undefined && Math.abs(schema.maximum) < SHOWN_LIMIT;
  if (min && max) return `${name} ${schema.minimum}–${schema.maximum}`;
  if (min) return `${name} ≥${schema.minimum}`;
  if (max) return `${name} ≤${schema.maximum}`;
  return name;
}

function render(schema: JsonSchema, compact = false): string {
  if (schema.modelDoc !== undefined) return schema.modelDoc;
  if (schema.const !== undefined) return JSON.stringify(schema.const);
  if (schema.enum) {
    const joined = schema.enum.map((v) => JSON.stringify(v)).join("|");
    return compact ? (ENUM_ALIAS_MAP.get(joined) ?? joined) : joined;
  }
  const union = schema.anyOf ?? schema.oneOf;
  if (union) return union.map((s) => render(s, compact)).join(compact ? "|" : " | ");
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (types.length > 1) {
    return types.map((t) => render({ ...schema, type: t }, compact)).join(compact ? "|" : " | ");
  }
  switch (types[0]) {
    case "object": {
      const required = new Set(schema.required ?? []);
      const fields = Object.entries(schema.properties ?? {}).map(([key, value]) => {
        const note = value.description ? `（${value.description}）` : "";
        const sep = compact ? ":" : ": ";
        return `${JSON.stringify(key)}${required.has(key) ? "" : "?"}${sep}${render(value, compact)}${note}`;
      });
      return `{${fields.join(compact ? "," : ", ")}}`;
    }
    case "array":
      return `[${schema.items ? render(schema.items, compact) : "…"},…]`;
    case "integer":
      return range(schema, compact ? "int" : "整数");
    case "number":
      return range(schema, compact ? "num" : "数字");
    case "string":
      if (schema.maxLength !== undefined && schema.maxLength < SHOWN_LIMIT) {
        return compact ? `str≤${schema.maxLength}` : `文本 ≤${schema.maxLength}字`;
      }
      return compact ? "str" : "文本";
    case "boolean":
      return compact ? "bool" : "true|false";
    case "null":
      return "null";
    default:
      return "任意";
  }
}

export function jsonSchemaOf(schema: z.ZodType): JsonSchema {
  return z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) as JsonSchema;
}

/** 一行简写：字段后的问号表示可以不写，括号里是字段说明 */
export function schemaDoc(schema: z.ZodType): string {
  return render(jsonSchemaOf(schema), false);
}

/** 一条指令的说明：紧凑简写（共享枚举见 COMMAND_DOC_LEGEND），下一行是 schema 顶层的说明 */
export function commandDoc(type: string, schema: z.ZodType): string {
  const { description, ...shape } = jsonSchemaOf(schema);
  const line = `- ${type}：${render(shape, true)}`;
  return description ? `${line}\n  ${description}` : line;
}

/** 构造传给模型供应商的原生 JSON 输出约束；不传 schema 时仅约束返回合法 JSON */
export function responseJsonSchema(name: string, schema?: z.ZodType): LlmResponseFormat {
  return {
    type: "json",
    name,
    ...(schema
      ? {
          schema: z.toJSONSchema(schema, {
            io: "input",
            unrepresentable: "any",
          }) as Record<string, unknown>,
        }
      : {}),
  };
}
