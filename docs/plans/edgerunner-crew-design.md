# 边缘行者小队（`crew`）沙盘设计方案（复盘加固版）

> 状态：已搁置（2026-11-26 评估投入产出比偏低，现有 `npc.following` + 叙事已覆盖大部分体验，暂不新增第 35 套系统）  
> 核心原则：极简沙盘 + 严格物理因果 + 独狼零开销；补齐现有架构下玩长档的 4 个硬断点，并规避 7 处常见设计与同步陷阱。

---

## 一、对上一版方案的 7 处硬伤复盘与修正

1. **避免「僵尸小队」**：不另起一套独立的 NPC 小队推进定时器；城里其他活跃小队只在与玩家交集或挂进现有 `threads`（城里在发酵的事）时记录与演进，保持轻量鲜活。
2. **杜绝 `withPlayer` 与 `npc.following` 双真相源撕裂 & 站位残留**：
   - 不在 `crew` 里重复存 `withPlayer`，贴身同行直接以 `npc.following` 为唯一真相源；
   - `crew` 只记录**分头部署的临时战术位**（`overwatch` / `getaway` / `remote`），并绑定 `deployedLocation`（部署地点）；玩家离开该地点且脱战切场后，留在原地的 `overwatch / getaway` 自动退回常态，绝不出现「人都在恶土了，她还挂着在沃森天台架枪」。
3. **防止 `remote` 远程切网击穿黑客物理硬约束**：
   - 远程支援严格沿用 `hacking/prompt.ts` 的物理边界：公开监控/查车牌/警频可远程办；涉密内网与气隙系统必须由玩家现场插线桥接或黑客在信号半径内，且她同样承受接入仓热负荷与敌方反追踪（被反查到面包车坐标时甚至会触发救队友戏码）。
4. **焊死「玩家控制权」红线（入伙当新人时不失控）**：
   - 玩家加入现成小队当新人时，NPC 老大可以布置方案、催促或下指令，但**绝不替玩家行动或强制转场**；玩家随时可以顶嘴、阳奉阴违、拒单、跳槽或反水夺权。
5. **杜绝「隔空凭空领遗物」穿帮**：
   - 队友战死后，其标志性武器/义体不会凭空刷进玩家背包，而是留在案发现场（或由幸存同伙/义体医生收存）；只有玩家亲自在现场拾取或从同伙手中接过时，才正式落袋并写入永久 `origin: "已故同伙 XXX 的遗物"`。
6. **避免手机群聊写成“每人一句报幕”**：
   - 群聊单次调用自然产出 1–3 条错落消息（正在忙、养伤或没信号的队员不回或晚回，性格相克的会互怼）；交火中或断网场景照现实限制。
7. **降低模型抽取负担、独狼零开销**：
   - 将所有小队变更收口为 **1 个统一指令 `crew`**（`action: "form" | "join" | "leave" | "deploy" | "plan" | "leader" | "disband"`，与 `combat` / `nemesis` 风格一致）；
   - 通过 `when()` 按需挂载：玩家是独狼且本轮未提及组队/同伙时，**0 token 额外注入、0 干扰**。

---

## 二、精简后的核心模型（`packages/core/src/systems/crew/`）

- `crews: Record<string, Crew>`：
  - `id`、`name`、`leaderId`（`"player"` 或 NPC id）、`hangout`
  - `members[]`：`{ npcId, callsign, standing ("leader"|"core"|"rookie"), recruitedBy?, deployment?: { role: "overwatch"|"getaway"|"remote", location: string, note: string, at: number } }`
  - `plan?`：`{ target, approach, escape, dissent?, setAt }`（可选，行动收场清除）
  - `fallen[]`：`{ npcId, name, callsign, diedAt, cause, keepsake?: { kind, id, name, location, claimed } }`
- `playerCrewId: string | null`：玩家当前所属小队（可随时退队、换队、另起炉灶或独狼）。
- **核心联动**：
  - `npc/prompt.ts`：只要某 NPC 处于玩家小队的 `deployment`（分头站位/远程支援），即使不在玩家同一地点也保留精炼战术卡（含武器、接入仓、伤势、精神征兆与当前站位），彻底打通长档不断联。
  - `health`：直连现有 `secondHeartOrAlly` 生死通道，濒死时激活在场/外围活队友的绝境捞人判定。
  - `npcDeath`：死者属于任一小队时自动入 `fallen` 并记录现场遗物；同场可经由 `crewGive` 动作直接把背包物品/急救针/压制剂递给身边同伙。

---

## 三、实施步骤

- **Step 1**：`crew` 核心系统 + 统一 `crew` 指令 + `when()` 按需注入 + 跨地点战术卡保活 + 绝境捞人/阵亡遗物联动 + 左栏极简战术条 & 人物页「小队」视图（含同场递东西）。
- **Step 2**：手机「小队加密群聊」频道 + 现有 `threads` 与城中其他小队的自然联动。
