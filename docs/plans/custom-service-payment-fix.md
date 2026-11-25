# 自定义剧情服务付款与防死循环修复计划

## 问题根因

复盘「老方收 1000 欧破译芯片硬控 7 回合」事故，根因不在提示词缓存，而在交易预校验与自由剧情付费服务之间的四处机制冲突：
1. **自定义剧情服务无法传递口头约定金额**：`BuyProposalSchema` 与 `TradeCommandSchema` 只支持固定服务枚举（`SERVICES`）或事先落盘的单一 `commerce.offer`，无法为自由剧情服务（破译、定金/尾款、打点、买情报）传入本轮玩家明确支付的金额。
2. **多选项报价互相顶掉导致 500/1000 乒乓死锁**：`commerce.offer` 对同一 `(seller, kind, action, target)` 会自动撤回旧报价；当 NPC 提出「500 定金或 1000 全款」时，新旧报价来回覆盖，导致 `quoteTrade` 强锁死与玩家本轮输入相反的金额，正文模型被迫编造「口子锁死 500 上限 / 网关不认拆零」的荒诞理由。
3. **店铺 `merchantServices` 误拦截通用剧情服务**：`trade.ts` 对任何登记了 `services` 列表的店铺/诊所都会拒绝列表外的 `favor` / `info` 服务，导致在店里找店主/技术员付费破译或打点直接报错「没有已登记的这项服务」。
4. **`commerce` 模块激活词漏掉常见付款词，且缺少防拖延约束**：`commerce` 的 `when` 正则未匹配「转账/付钱/定金/尾款/现钞/扫码/破译/打点」；正文提示词缺少「核验通过且玩家明确付款时须当轮爽快收款、禁止编造支付通道故障拖回合」的防鬼打墙指令。

## 实施方案

- [x] **阶段一：内核支持自由剧情服务（`favor` / `info`）显式约定金额与通用放行**
  - `packages/core/src/systems/inventory/schema.ts`、`packages/core/src/narrator/stages.ts`：为 `TradeCommandSchema` 与 `BuyProposalSchema` 增加可选 `amount`（正整数、`1..MONEY_CAP`），通过 schema 约束**仅允许 `service: "favor" | "info"` 使用**，绝不影响任何目录物品、武器、义体、载具、枪匠或创伤小组的价格校验安全线。
  - `packages/core/src/systems/inventory/trade.ts`：`quoteTrade` 将 `favor` / `info` 视为所有在场存活交易对象（NPC、店铺、诊所、已登记对方）均可承接的通用剧情服务；若传入合法 `amount`，优先采用该金额核验余额与大额消费确认，避免被过期的不同金额 `offer` 劫持；仅在 `offer` 金额与 `amount` 一致时消费该 `offer`。
  - `packages/core/src/narrator/merchant-settlement.ts`：`purchaseCommand` 透传 `amount`；`applyMerchantCommands` 匹配已授权的 `favor`/`info` 服务时，若抽取漏写 `amount` 则自动补齐本轮正文前已核准的 `amount`，防止记账回滚。
- [x] **阶段二：完善提示词引导与防鬼打墙规则**
  - `packages/core/src/systems/commerce/index.ts`：补全 `when` 触发正则（覆盖转账、付款、定金、尾款、现钞、扫码、破译、打点、酬金等）。
  - `packages/core/src/narrator/prompts/judge.ts`、`extract.ts`、`narrate.ts`、`packages/core/src/systems/economy/prompt.ts`、`packages/core/src/narrator/turn.ts`：
    - 指导 `judge` 对破译/办事/定金/尾款/买情报等自由剧情付款填 `service: "favor" | "info"` 与精确 `amount`；
    - 指导 `extract` 在对应 `trade` 中带同值 `amount`；
    - 明确告知 `narrate`：一旦玩家明确付款且 `【本次交易报价】` 核验通过，当轮干脆完成收款并推进办事，禁止以匿名口子、实名限制、拆分网关报错等借口多轮硬控玩家。
- [x] **阶段三：全量静态检查与数据校验**
  - 通过 `biome lint .`（694 文件 0 错 0 警）、5 包 `tsc --noEmit` 与 `tsx tools/check-data.ts`。
