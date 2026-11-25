# 向量模型检索补强方案

- **状态**：已完成（2026-11-24，含二期重排模型与两阶段检索）
- **目标**：补齐独立向量模型角色、多提供方（OpenAI 兼容 / Ollama / Gemini 原生）支持、浏览器本地持久化向量缓存，以及独立重排模型（`/v1/rerank`，如 `Qwen/Qwen3-Reranker-8B`）与「向量粗排 + 重排精排」两阶段检索。

## 1. 现状问题

1. **无持久化缓存**：每回合都将全部候选旧记忆池重新发送到 `/embeddings`，长档下重复消耗 token 与等待耗时。
2. **缺少独立向量角色**：只能在 `aux` 或 `narrator` 对话方案里附带 `embeddingModel` 字段，无法在主对话使用 Anthropic/Gemini 时单独挂载硅基流动、OpenAI 或本地 Ollama 向量服务。
3. **提供方受限**：仅支持 OpenAI/Ollama `/v1/embeddings`，不支持 Gemini 原生 `:batchEmbedContents`。
4. **设置页体验缺口**：已填写的 `embeddingModel` 无法通过留空清除；专用向量连接无法走向量协议完成测试连接。

## 2. 实施方案

### 2.1 Core 接口与检索调用

- [packages/core/src/kernel/ports.ts](../../packages/core/src/kernel/ports.ts)：为 `Embedder.embed` 增加可选 `EmbedOptions`（`task?: "query" | "document"`、`signal?: AbortSignalLike`），兼容旧调用方式。
- [packages/core/src/narrator/turn.ts](../../packages/core/src/narrator/turn.ts)：`computeVectorScores` 拆分查询向量（`task: "query"`）与记忆文档向量（`task: "document"`）请求，使缓存层可仅对未命中的文档增量请求，且查询不污染文档缓存。

### 2.2 独立向量角色、多协议客户端与配置清空

- [packages/runtime/src/config.ts](../../packages/runtime/src/config.ts)：
  - `ConfigSchema` / `RolesSchema` 新增可选角色 `embedding`（支持传 `null` 停用）。
  - `ProfilePatchSchema` 允许 `embeddingModel: null` 以支持留空清除。
  - `removeProfile()` 防止删除正在充当 `embedding` 的连接。
- [packages/runtime/src/providers/embedding.ts](../../packages/runtime/src/providers/embedding.ts)：
  - 统一实现 `createEmbedder()`：同时支持 OpenAI/Ollama `/embeddings` 与 Gemini 原生 `:batchEmbedContents`（自动区分 `RETRIEVAL_QUERY` / `RETRIEVAL_DOCUMENT`）。
  - 内置分批切片（每批 64 条），避免上游 batch 限制报错。
- [packages/runtime/src/providers/index.ts](../../packages/runtime/src/providers/index.ts)：
  - `resolveEmbedder()` 优先解析独立 `config.embedding` 方案（模型取 `embeddingModel || model`），未配置时回退至 `aux` / `narrator` 的 `embeddingModel`，并返回可识别模型身份的元数据以便缓存按模型隔离。

### 2.3 本地持久化向量缓存

- [packages/runtime/src/embedding-cache.ts](../../packages/runtime/src/embedding-cache.ts)（新增）：
  - 基于现有 `DocStore` 按存档存放在 `embeddings/<saveId>.json`（无需升级 IndexedDB 版本号，兼容浏览器与本地文件存储）。
  - 以 `modelKey`（`type|baseUrl|model`）校验模型维度一致性，切换向量模型后自动重建。
  - 按文本确定性哈希缓存文档向量，内置内存热缓存、`KeyedMutex` 并发写锁与 512 条 LRU 容量上限。
  - 删档时同步清理对应存档的向量缓存文件。

### 2.4 路由、健康检查与设置页 UI

- [packages/runtime/src/routes/profiles.ts](../../packages/runtime/src/routes/profiles.ts)：纯向量方案点击「测试连接」时直接发向量探测并返回维度与耗时。
- [packages/runtime/src/app.ts](../../packages/runtime/src/app.ts) & [packages/runtime/src/browser.ts](../../packages/runtime/src/browser.ts) & [packages/runtime/src/game.ts](../../packages/runtime/src/game.ts)：接入 `EmbeddingCacheStore`，并在 `/api/health` 汇报 `models.embedding` 状态。
- [apps/web/src/api/client.ts](../../apps/web/src/api/client.ts)、[apps/web/src/features/settings/ModelSettings.tsx](../../apps/web/src/features/settings/ModelSettings.tsx)、[apps/web/src/features/settings/model-settings.module.css](../../apps/web/src/features/settings/model-settings.module.css)：
  - 顶部角色状态槽位扩展为 4 格（叙事 / 辅助 / 文生图 / 向量检索）。
  - 左侧连接徽标与右侧分配区新增「设为向量模型 / 停用向量模型」按钮。
  - 高级选项支持 `openai` / `ollama` / `gemini` 填写或留空清空 `embeddingModel`。

### 2.5 语义重排（Reranker）与两阶段检索

- [packages/core/src/kernel/ports.ts](../../packages/core/src/kernel/ports.ts)：新增 `Reranker` 接口（`rerank(query, documents, options)`）。
- [packages/core/src/narrator/retrieve.ts](../../packages/core/src/narrator/retrieve.ts) & [packages/core/src/narrator/turn.ts](../../packages/core/src/narrator/turn.ts)：`MemoryQuery` 新增 `rerankScores`（权重 `0.6`），回合检索升级为两阶段——先用向量（含缓存）+ 规则粗排筛出 Top 20，再送重排模型精排；支持单用向量、单用重排或两者共用。
- [packages/runtime/src/providers/rerank.ts](../../packages/runtime/src/providers/rerank.ts)（新增）：兼容 SiliconFlow / Jina / Cohere / vLLM `/rerank` 协议（如 `Qwen/Qwen3-Reranker-8B`），提供容错 `createReranker` 与连接测试 `probeReranker`。
- [packages/runtime/src/config.ts](../../packages/runtime/src/config.ts)、[packages/runtime/src/providers/index.ts](../../packages/runtime/src/providers/index.ts)、[packages/runtime/src/routes/profiles.ts](../../packages/runtime/src/routes/profiles.ts)、[packages/runtime/src/app.ts](../../packages/runtime/src/app.ts)、[packages/runtime/src/game.ts](../../packages/runtime/src/game.ts)、[apps/web/src/features/settings/ModelSettings.tsx](../../apps/web/src/features/settings/ModelSettings.tsx)：新增第 5 个可选角色槽位 `reranker`、独立开关按钮、专用 `/rerank` 测试连接与 `/api/health` 状态汇报。

## 3. 验收标准

- `biome check`（全部改动文件）0 报错。
- `tsc --noEmit` 覆盖全部 5 个工作区包通过。
- `tsx tools/check-data.ts` 通过。
- 模拟验证 `EmbeddingCacheStore` 命中/增量更新/切换模型失效/删档清理逻辑及 `resolveEmbedder` 优先级。
