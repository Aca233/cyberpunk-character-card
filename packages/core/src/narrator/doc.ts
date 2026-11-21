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

function range(schema: JsonSchema, name: string): string {
  const min = schema.minimum !== undefined && Math.abs(schema.minimum) < SHOWN_LIMIT;
  const max = schema.maximum !== undefined && Math.abs(schema.maximum) < SHOWN_LIMIT;
  if (min && max) return `${name} ${schema.minimum}–${schema.maximum}`;
  if (min) return `${name} ≥${schema.minimum}`;
  if (max) return `${name} ≤${schema.maximum}`;
  return name;
}

function render(schema: JsonSchema): string {
  if (schema.modelDoc !== undefined) return schema.modelDoc;
  if (schema.const !== undefined) return JSON.stringify(schema.const);
  if (schema.enum) return schema.enum.map((v) => JSON.stringify(v)).join("|");
  const union = schema.anyOf ?? schema.oneOf;
  if (union) return union.map(render).join(" | ");
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (types.length > 1) return types.map((t) => render({ ...schema, type: t })).join(" | ");
  switch (types[0]) {
    case "object": {
      const required = new Set(schema.required ?? []);
      const fields = Object.entries(schema.properties ?? {}).map(([key, value]) => {
        const note = value.description ? `（${value.description}）` : "";
        return `${JSON.stringify(key)}${required.has(key) ? "" : "?"}: ${render(value)}${note}`;
      });
      return `{${fields.join(", ")}}`;
    }
    case "array":
      return `[${schema.items ? render(schema.items) : "…"}, …]`;
    case "integer":
      return range(schema, "整数");
    case "number":
      return range(schema, "数字");
    case "string":
      return schema.maxLength !== undefined && schema.maxLength < SHOWN_LIMIT
        ? `文本 ≤${schema.maxLength}字`
        : "文本";
    case "boolean":
      return "true|false";
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
  return render(jsonSchemaOf(schema));
}

/** 一条指令的说明：简写，下一行是 schema 顶层的说明 */
export function commandDoc(type: string, schema: z.ZodType): string {
  const { description, ...shape } = jsonSchemaOf(schema);
  const line = `- ${type}：${render(shape)}`;
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
