import type { AuthoringIssue } from "@cp/core";

/**
 * 内容工坊的错误类。单独放在这里、不依赖 Node：路由按值导入它们，
 * 浏览器里打包 app.ts 时不会顺带把 node:fs、node:sqlite 拉进来
 */

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

export class OfficialTextError extends Error {
  constructor() {
    super("官方文本库暂时无法读取，请检查本机数据库及全文索引");
    this.name = "OfficialTextError";
  }
}
