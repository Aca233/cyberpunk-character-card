import type {
  AuthoringDraft,
  AuthoringInput,
  OfficialTextResult,
  TextSearchRequest,
} from "@cp/core";

/**
 * 内容工坊给路由用的接口，不依赖 Node：app.ts 和 routes/authoring.ts 只认这里，
 * 网页的类型检查顺着 app.ts 查过来时不会碰到 node:fs / node:sqlite。
 * 实现在 authoring.ts（AuthoringStore）和 authoring-search.ts（AuthoringTextSearch），只由 main.ts 创建
 */
export interface AuthoringDrafts {
  get(id: string): Promise<AuthoringDraft | undefined>;
  list(): Promise<AuthoringDraft[]>;
  create(input: AuthoringInput, now: Date): Promise<AuthoringDraft>;
  update(id: string, revision: number, input: AuthoringInput, now: Date): Promise<AuthoringDraft>;
  review(id: string, revision: number, now: Date): Promise<AuthoringDraft>;
}

/** 本机官方文本库的只读检索 */
export interface OfficialTextSearch {
  search(raw: TextSearchRequest): OfficialTextResult;
  source(rawKey: string): OfficialTextResult;
}
