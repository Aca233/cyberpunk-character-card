/** 中间人：开档时写进委托系统；和出身、过往有关的中间人信任度从 25 起步，其余从 10 起步 */
export const fixers: readonly {
  readonly id: string;
  readonly name: string;
  readonly trust?: number;
}[] = [{ id: "faraday", name: "法拉第", trust: 10 }];
