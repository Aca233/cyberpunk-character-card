import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type AuthoringDraft,
  AuthoringDraftSchema,
  type AuthoringInput,
  AuthoringInputSchema,
  type AuthoringIssue,
  authoringReviewIssues,
  validateAuthoringContent,
} from "@cp/core";
import { atomicWrite, isNotFound } from "./fsutil";
import { KeyedMutex } from "./mutex";

const DRAFT_ID = /^a-[a-z0-9-]{1,60}$/;

export class AuthoringError extends Error {
  constructor(
    readonly status: 400 | 404 | 409 | 422,
    message: string,
    readonly issues: readonly AuthoringIssue[] = [],
  ) {
    super(message);
    this.name = "AuthoringError";
  }
}

/** 本机草稿仓库；root 由服务端指定，请求只能提供受限 id，不能提供路径。 */
export class AuthoringStore {
  private readonly locks = new KeyedMutex();

  constructor(private readonly root: string) {}

  private path(id: string): string {
    if (!DRAFT_ID.test(id)) throw new AuthoringError(400, "草稿 id 不合法");
    return join(this.root, `${id}.json`);
  }

  async get(id: string): Promise<AuthoringDraft | undefined> {
    const path = this.path(id);
    let text: string;
    try {
      text = await readFile(path, "utf8");
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw error;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new AuthoringError(422, "草稿文件不是合法 JSON，请检查本机文件");
    }
    const parsed = AuthoringDraftSchema.safeParse(raw);
    if (!parsed.success || parsed.data.id !== id) {
      throw new AuthoringError(422, "草稿文件结构不合法，请检查本机文件");
    }
    return parsed.data;
  }

  async list(): Promise<AuthoringDraft[]> {
    let names: string[];
    try {
      names = await readdir(this.root);
    } catch (error) {
      if (isNotFound(error)) return [];
      throw error;
    }
    const drafts: AuthoringDraft[] = [];
    for (const name of names.sort()) {
      if (!name.endsWith(".json") || !DRAFT_ID.test(name.slice(0, -5))) continue;
      const draft = await this.get(name.slice(0, -5));
      if (draft) drafts.push(draft);
    }
    return drafts.sort(
      (a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id),
    );
  }

  private async write(draft: AuthoringDraft): Promise<AuthoringDraft> {
    const checked = AuthoringDraftSchema.parse(draft);
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    await atomicWrite(this.path(checked.id), `${JSON.stringify(checked, null, 2)}\n`, 0o600);
    return checked;
  }

  async create(input: AuthoringInput, now: Date): Promise<AuthoringDraft> {
    const body = AuthoringInputSchema.parse(input);
    const id = `a-${randomBytes(12).toString("hex")}`;
    return this.locks.run(id, async () => {
      if (await this.get(id)) throw new AuthoringError(409, "草稿 id 冲突，请重新创建");
      return this.write({
        ...body,
        id,
        revision: 1,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        status: "draft",
        reviewedAt: null,
      });
    });
  }

  private async current(id: string, revision: number): Promise<AuthoringDraft> {
    const draft = await this.get(id);
    if (!draft) throw new AuthoringError(404, "没有这份草稿");
    if (draft.revision !== revision) {
      throw new AuthoringError(409, "草稿已经更新，请刷新后再操作");
    }
    return draft;
  }

  /** 每次编辑都撤销审核；包括来源或核对清单的修改。 */
  async update(
    id: string,
    revision: number,
    input: AuthoringInput,
    now: Date,
  ): Promise<AuthoringDraft> {
    const body = AuthoringInputSchema.parse(input);
    return this.locks.run(id, async () => {
      const previous = await this.current(id, revision);
      return this.write({
        ...body,
        id,
        revision: previous.revision + 1,
        createdAt: previous.createdAt,
        updatedAt: now.toISOString(),
        status: "draft",
        reviewedAt: null,
      });
    });
  }

  /** 只能由独立的人工确认接口调用；这里没有模型调用，也不发布内容。 */
  async review(id: string, revision: number, now: Date): Promise<AuthoringDraft> {
    return this.locks.run(id, async () => {
      const previous = await this.current(id, revision);
      if (previous.status !== "draft") {
        throw new AuthoringError(409, "这份条目已经标记已核对，无需重复审核");
      }
      const issues = authoringReviewIssues(previous);
      if (issues.length > 0) {
        throw new AuthoringError(422, "尚未满足审核条件", issues);
      }
      const parsed = validateAuthoringContent(previous.kind, previous.content);
      if (!parsed.ok) throw new AuthoringError(422, "条目校验未通过", parsed.issues);
      return this.write({
        ...previous,
        content: parsed.content,
        revision: previous.revision + 1,
        updatedAt: now.toISOString(),
        status: "reviewed",
        reviewedAt: now.toISOString(),
      });
    });
  }
}
