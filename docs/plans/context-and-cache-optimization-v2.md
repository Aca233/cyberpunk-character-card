# 上下文优化与提示缓存进阶方案（v2）

- **状态**：全部已完成（第一批 + 第二批协议层 + 第三批瘦身与运行期缓存，2026-11-27）
- **前置基线**：已完成 [context-optimization.md](context-optimization.md)（2026-11-27）
- **原则约束**：严格遵循 `AGENTS.md` 与用户约束——正文质量优先，不裁剪人物口吻、关系与知情边界、世界因果与长线记忆；**绝不改动酒馆预设条目的 `prompt_order` 顺序、`role`（含 `assistant` 预填）与 `depth` 注入深度，不破坏破甲功能**；不改存档 schema；不改动现有界面布局。

---

## 一、实测对比（H10 开局单轮，`estimateTokens` 口径）

| 阶段                      | 优化前 `user`（未缓存） | 优化后 `user`（未缓存） |                                     未缓存降幅 | 优化前 `system` 缓存占比 | 优化后 `system` 缓存占比 |
| ------------------------- | ----------------------: | ----------------------: | ---------------------------------------------: | -----------------------: | -----------------------: |
| `judge`                   |                   8,418 |               **6,425** |    **-23.7%**（中后期含前情/近期原文命中更高） |                    54.0% |                **63.8%** |
| `narrate`（无新人物）     |                   9,645 |               **8,280** | **-14.2%**（中后期 `【前情】` 2K–8K 转入缓存） |                    48.9% |                **55.7%** |
| `narrate`（含新人物参考） |                  13,982 |              **11,590** |                                     **-17.1%** |                    39.8% |                **47.3%** |
| `extract`（无新人物）     |                  14,935 |               **5,841** |                **-60.9%**（直省 9,094 tok/轮） |                    68.3% |                **85.8%** |
| `extract`（含新人物参考） |                  20,141 |               **6,158** |               **-69.4%**（直省 13,983 tok/轮） |                    61.5% |                **85.1%** |

> 补充说明：上述开局测试尚未包含多轮历史与 `【前情】` 摘要；实际游玩进入第 2 场以后，`narrate` 与 `judge` 的 `【前情】`（2K–8K）及 `judge` 步长对齐的 `【最近几轮】`（3K–6K）均已前移至可缓存前缀层（Anthropic 多断点 + OpenAI/Gemini 前缀匹配），缓存命中收益会进一步放大。

---

## 二、P0：立竿见影、零质量损失的高收益项

### 1. 消除 `extract` 中 6K 未缓存噪音：`extractCatalogDetails` 去掉未提及的整店货架长文

- **现状**（`packages/core/src/narrator/prompts/catalogs.ts`）：只要当前地点有商店或诊所，就会把 `view.shops[].shelf` 与 `view.ripperdoc.shelf` 上**全部几十件商品/义体的 80–120 字散文能力说明**全部灌入 `extract` 的未缓存 `user` 消息（实测开局高达 **6,038 tokens**），即便玩家根本没买东西也没提这些枪。
- **方案**：
  - `extract` 只负责记账核对 ID，不需要散文级武器手感描写；
  - 商店/诊所货架不再默认全量展开，改为仅在 `input + narrative` 提及或存在交易意向（`tradePlans` 非空）时展开；
  - 随身/现场/战利品项的展开改用 `summarizeAbility(..., 40)` 或仅在需要时附带（系统层已有完整 `【物品表】` / `【义体表】`）。
- **预期收益**：`extract` 每轮未缓存 `user` 直降 **5,000–6,000 tokens**。

### 2. 把 3 个准常驻模块迁入 `ALWAYS_ON_MODULE_IDS` 静态缓存层

- **现状**（`packages/core/src/narrator/prompts/context.ts`）：`safehouse`（住处与留置物品）、`humanity`（神经症状与现实压力）、`shops`（商店经营）实际在 **90%–100%** 的回合都会激活，但不在 `ALWAYS_ON_MODULE_IDS` 里，导致每轮都留在未缓存 `user` 中（三阶段合计每轮多付 **~3,600 未缓存 tokens**，其中 `extract` 单步就占 **2,364 tokens**）。
- **方案**：将这 3 个准常驻模块纳入 `ALWAYS_ON_MODULE_IDS`（反向评估极少触发的 `shards`（1,702 tok）是否应按需留在动态层，降低 32K 辅助模型 `system` 压力）。
- **预期收益**：每轮约 **3,600 tokens** 从未缓存区迁移至 100% KV 缓存区。

### 3. `【前情】`（`recap`）从末尾易变 `user` 消息前移至 `history` 之前

- **现状**（`packages/core/src/narrator/prompts/narrate.ts`、`judge.ts`）：`recapFor(...)`（中后期可达 **2,000–8,000 tokens**）拼在最后一条 `user` 消息的开头，位于 Anthropic 历史断点与对话历史**之后**，因此每轮命中率为 **0%**。实际上 `【前情】` 仅在收场或 `HISTORY_STRIDE` 跨场边界时变化（同一场景内连续 5–20 轮完全不变）。
- **方案**：
  - `narrate` 消息序列改为：`[system(静态), system/user-prefix(【前情】+ 存档静态基础信息), ...history(stride 对齐), user(本轮动态局面 + 输入)]`；
  - Anthropic 在 `system` 尾部打断点 1、在 `history` 末尾（倒数第 2 条）打断点 2；这样同场景内 `【前情】` 随历史前缀一起被缓存，命中率从 **0% → 75%–90%**。
- **预期收益**：中后期长存档每轮减少 **2,000–8,000 未缓存 tokens**，零内容损失。

### 4. 拆分 `【地点】` 与 `【相关经营入口】` 的静态底座与动态增量

- **现状**（`packages/core/src/systems/world/places.ts`、`merchant-sites.ts`）：
  - `【地点】`（~815 tokens × 3 阶段 = **~2,445 tokens/轮**）把全部内置固定地点表放在未缓存 `user` 里，仅仅为了在其中一行末尾加 `（你在这里）`；
  - `【相关经营入口】`（~825 tokens × 3 阶段 = **~2,475 tokens/轮**）每轮全区平铺所有商户与完整超梦片单说明。
- **方案**：
  - 将静态内置地点目录（去掉 `你在这里` 标签）迁入静态 `system` 层（100% 跨轮缓存）；
  - `user` 层只保留动态增量：当前位置 ID、附近 1500m 雷达结果、存档新建地点（合计 ~100 tokens）；
  - `【相关经营入口】` 的静态商户目录同样上移或按当前地点/输入提及过滤。
- **预期收益**：三阶段合计每轮再转缓存/省去 **~3,500–4,200 未缓存 tokens**。

### 5. `extract` 与 `judge` 的 `【人物】` 义体能力去重（不再在记账步重复倾倒散文）

- **现状**（`packages/core/src/systems/npc/prompt.ts`、`body.ts`）：`bodyLine()` 对每个在场 NPC 的每件义体都展开 60–100 字散文能力，不仅在 `narrate` 中出现，也在 `extract` 和 `judge` 中出现；在 `extract` 里还与 `【本轮相关物件能力】` 双重重复！
- **方案**：
  - `narrate` 保持完整义体能力描写（保障正文演出质量）；
  - `extract` 只列 `名称[id]`（或极简功能标签），因为记账只需准确 ID 与当前装机清单；
  - `judge` 使用 `summarizeAbility(..., 36)` 保留硬条件（如自我 ICE、跳弹、义眼扫描、接入仓）而不带文学修饰。
- **预期收益**：在场 3–5 名 NPC 时，`judge` + `extract` 每轮再省 **1,500–3,000 未缓存 tokens**。

---

## 三、P1：提示缓存协议升级与防穿透（跨供应商降本提速）

### 6. `judge` 最近 4 轮原文改为 stride 对齐的多轮对话前缀

- **现状**（`packages/core/src/narrator/prompts/judge.ts`）：`JUDGE_TURNS = 4` 把最近 4 轮拼成一大块字符串塞进单条 `user` 消息，每轮开头都滑掉 1 轮，导致 `recap + recent`（约 3K–6K tokens）每轮 **0% 缓存命中**。
- **方案**：改用与 `narrate` 一致的多轮消息结构 + `HISTORY_STRIDE` 步长对齐（如每 4 轮推进一次起点，上限 6 轮、下限 3 轮），并在 Anthropic / OpenAI / Gemini 上自然命中 `system + recap + recent[:-1]` 前缀缓存。

### 7. 酒馆预设（SillyTavern Preset）缓存兼容原则（严禁破坏破甲链路）

- **硬约束（用户明确要求）**：**绝不改动酒馆预设条目的 `prompt_order` 顺序、`role`（含 `assistant` 预填）或 `depth` 注入深度**，不把预设前置条目挪到游戏规则之后，也不改写 `depth >= 1` 的注入位置，确保各类预设的破甲、思维链引导与文风控制 100% 原样生效。
- **零侵入缓存策略**：
  - 仅在原有消息序列边界上叠加 `cache_control` 断点（如第一批已完成的 `staticSystem` / `【前情】` / 历史末尾三断点），绝不移动任何预设文本；
  - 对不含动态宏且无 `depth >= 1` 的主流预设自动完整命中缓存；对含动态宏或中段 `depth` 注入的破甲预设，保持其完整原样执行，最多仅在剧透/诊断视图里被动展示缓存命中率，绝不自动改写或降级预设行为。

### 8. Anthropic 1 小时扩展 TTL（`ttl: "1h"`）与中转站 Claude 透传支持

- **现状**：
  - `anthropic.ts` 固定 `{ type: "ephemeral" }`（默认仅 **5 分钟 TTL**）。文字 RPG 玩家经常阅读正文、翻看角色卡/地图/商店超过 5 分钟，导致缓存频繁过期并反复支付 +25% 写入费；
  - `openai.ts` 中 `prompt_cache_key` 仅对 `api.openai.com` 生效，且对经由 OpenRouter / New API / One API 走 OpenAI 兼容协议调用 `claude-*` 的用户**未注入 `cache_control`**（缓存命中率为 0%）。
- **方案**：
  - 在模型连接高级选项中支持：
    - Anthropic 缓存时长：`5m`（默认） / `1h`（适合慢节奏 RPG，读长文不掉缓存）；
    - OpenAI 官方端点可选 `prompt_cache_retention: "24h"`（适配支持的模型）；
    - OpenAI 兼容连接可选「兼容中转站缓存标记（Claude `cache_control` / `prompt_cache_key`）」，OpenRouter + `claude` 模型可自动启用。

### 9. Gemini / Vertex AI 显式上下文缓存（Explicit Context Caching：`cachedContents`）

- **现状**（`packages/runtime/src/providers/gemini.ts`、`vertex.ts`）：目前仅依赖隐式缓存，跨节点或长间隔易 miss；而本作 `extract`（~20K–32K）、`judge`（~10K）、`narrate`（~9K–15K）的静态 `system` 全部远超 Gemini 显式缓存最低门槛。
- **方案**：
  - 新增可选的客户端 `GeminiContextCacheManager`（按 `profile + model + hash(staticSystem)` 维护 `cachedContents` 资源名称与过期时间，TTL 默认 30–60 分钟，活跃游玩期间自动 `PATCH` 续期）；
  - 发起 `streamGenerateContent` 时携带 `cachedContent: "cachedContents/..."`（并从请求体省略已包含在缓存中的 `systemInstruction`）；若创建失败/配额限制/中转站不支持则自动静默回退到常规请求；
  - 锁定 **75%–90%** 的确定性输入 token 折扣。

### 10. 预算裁剪保持 `HISTORY_STRIDE` 对齐 & 大窗口放宽步长

- **现状**（`packages/core/src/narrator/budget.ts`、`turn.ts:1163`）：
  - 紧窗口触发裁剪循环时逐轮 `hot -= 1`，会破坏 `HISTORY_STRIDE = 4` 的起点对齐；
  - 128K+ 窗口给 `history` 分配了 40,000 token，但 `HISTORY_TURNS` 硬上限仍为 12、`HISTORY_STRIDE` 固定为 4（缓存命中周期仅 3/4 = 75%）。
- **方案**：
  - 裁剪循环在 `hot - HISTORY_STRIDE >= MIN_HISTORY` 时优先按步长对齐裁减，保护历史前缀缓存；
  - 按窗口自适应步长与历史上限（如 ≥128K 窗口允许 `HISTORY_TURNS = 16`、`HISTORY_STRIDE = 6` 或 `8`，将历史前缀命中周期提升至 **83%–87.5%**）。

---

## 四、P2：深度瘦身与本地运行期缓存（适配 32K 辅助模型 + 降低延迟）

### 11. `npcEquipmentReference` 静态化（彻底消除 4.4K–5.2K 未缓存波动）

- **现状**（`packages/core/src/narrator/prompts/npc-equipment.ts`）：因 `seed = "${world.time}:${npcs.length}"` 每轮随游戏时间变化，整段 4.4K–5.2K tokens 无法缓存；且 `extract` 系统层已有完整物品表与义体表，仍再贴一份 5.2K 的装备参考。
- **方案**：
  - 将基础代表表改为**纯静态**（或仅每新增 5 名自创 NPC 才轮换一次分桶），`user` 侧只保留 1 行 `近期已重复型号：...`；
  - `extract` 直接复用 `system` 的物品/义体索引，只附带 1 行业务提醒 + 13 件常见基础义体 ID 提示（从 5,206 tokens 压到 **< 300 tokens**）。

### 12. 压缩 `extract` 静态 `system`（让 32K 辅助模型真正装得下）

- **现状**：`extract` 的 `system` 单独就占 **32,153 tokens**（其中 `【规则：人物】` 占 7,529、`【输出格式】` 占 2,907），超过 32K 辅助模型的 `auxBudget`（~27,904）。
- **方案**：
  - 在 `packages/core/src/narrator/doc.ts` 的 `commandDoc()` 中提取共享枚举字典（身体部位、伤势档位、八大城区、物品类型等），避免在 60+ 条指令说明里反复展开相同枚举串，预计压缩 `extract` `system` **25%–35%**（降至 ~21K–24K），指令语义零损；
  - 将低频专用子系统（如 `shards` 1,702 tok、诊所/商店经营管理指令）保留为按状态动态加载。

### 13. 本地运行时缓存与预热（零延迟、零额外 Token）

- **`projectState()` 同回合跨阶段弱引用记忆化**：目前 `judge` / `narrate`（及预算裁剪 `for` 循环每次迭代）/ `extract` 在同一份不可变 `(world, records, data)` 上重复执行 3–6 次全量 34 系统 Zod 解析与投影；增加 `WeakMap` 记忆化可省去冗余 CPU 开销。
- **Embedding 异步预热**：在每轮结算写盘后（新回合原文、新场景摘要、新记忆锚点落盘时），后台空闲期提前调用 `embedder.embed(..., { task: "document" })` 写入 `EmbeddingCacheStore`，使下一轮 `judge` 阶段的文档向量 **100% 命中本地缓存**，消除首字等待前的网络串行延迟。

---

## 五、已落地实施清单（2026-11-27 全部验收通过）

1. **第一批（纯核心提示词与分层，全供应商通吃）**：
   - [x] P0-1：`extractCatalogDetails` 去掉未提及整店货架长文并精简摘要（`6,038` → `668` tok）
   - [x] P0-2：`safehouse`、`cyberpsychosis`、`merchant` 迁入 `ALWAYS_ON_MODULE_IDS` 静态缓存层
   - [x] P0-3：`【前情】` 前移至 `history` 之前作独立 `system` 块（+ Anthropic 三断点）
   - [x] P0-4：`staticPlacesSection` 固定地点表进 `system`、`placesText` 仅留周边雷达与新建地点、精简 `merchantEntranceText`
   - [x] P0-5：NPC `bodyLine` 按 `narrate`/`judge`/`extract` 分级输出义体信息
   - [x] P1-6：`judge` 近期原文改步长对齐多轮 `system` 块（不污染 `assistant` 角色）
   - [x] P2-11：`npcEquipmentReference` 按每 5 名自创 NPC 稳定分桶，`extract` 直接复用系统层表（`5,206` → `317` tok）
2. **第二批（供应商缓存协议增强；零触碰酒馆预设顺序/深度/角色）**：
   - [x] P1-8：`ProfileSchema` 新增可选 `promptCacheMode`（`auto|on|off`）与 `cacheTtl`（`default|5m|1h|24h`）；Anthropic 支持 `1h` TTL；OpenAI 官方支持 `24h` retention；OpenRouter / 显式开启中转站的 Claude 模型在原位透传 `cache_control`
   - [x] P1-9：新增 [gemini-cache.ts](../../packages/runtime/src/providers/gemini-cache.ts)，支持 Gemini & Vertex AI（完整项目路径）显式 `cachedContents` 创建、临期后台 `PATCH` 续期、负缓存防抖与失效单次静默回退
3. **第三批（32K 瘦身与本地运行期缓存）**：
   - [x] P1-10：`historyStrideFor` / `historyMaxFor`（≥128K 步长 6、上限 16）与 `stepDownHistory` 裁剪保对齐
   - [x] P2-12：`commandDoc` 共享枚举图例 `COMMAND_DOC_LEGEND` + 紧凑类型简写（`extract` 静态 `system` 再降 ~970 tok）
   - [x] P2-13：`projectState` / `stateSummary` / `memoryRecords` `WeakMap` 记忆化 + 回合落盘后 `prewarmEmbeddings` 后台异步预热

### 验收记录

- `biome lint packages apps tools functions`（690 文件）：0 错误 / 0 警告
- `pnpm typecheck`（5 个工作区 / 6 份 `tsconfig`）：全部通过
- `pnpm check-data`：全部通过
