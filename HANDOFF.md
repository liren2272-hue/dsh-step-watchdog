# 反复停止 + 切换模型失效：取证结论与看门狗修复

> 交接文档。给换模型后的自己看：这里记录现象、根因、证据、已改内容、未完成事项。

## 一、问题的真面目

**用户体感**：某些对话执行时反复停止，切换模型完全无效。

**真实根因**：问题出在**自动压缩（compaction）**把整个回合吃掉了，与模型无关。压缩跑在 `agent/pre-step` 里、**当前 step 的模型请求之前**。压缩慢或卡住时，这一轮连 `request/header` 都发不出去就结束了。

### 决定性证据（会话 `66533ff6` 第 1 回合）

```
    0ms  turn/start
  162ms  step/start
  165ms  request/header   qodercn/dfmodel  reason=initial
60999ms  assistant/attempt  stream frames=0 (NO COMMIT)   ← 61 秒零帧
61000ms  turn/end  {"kind":"aborted","reason":{"kind":"hook",...}}
```

### 决定性的因果链（会话 `a5348096`，连续 10 个回合同形）

| 回合 | 时长 | 压缩耗时 | 发出的请求数 | 结果 |
|---|---|---|---|---|
| 4 | 60108ms | 59955ms | **0** | aborted/hook |
| 5 | 60100ms | 59961ms | **0** | aborted/hook |
| 6 | 60113ms | 59961ms | **0** | aborted/hook |
| 10 | 61360ms | 61217ms | **0** | aborted/hook |

`compaction/end` 与 `turn/end` 之间只隔 **3ms**——压缩是被打断才失败的，不是上游报错。

### 全库统计（117 个会话 / 189 个回合）

| 指标 | 数值 |
|---|---|
| 有压缩的回合 | 47 |
| 压缩跑完但整轮从未发出任何模型请求 | **34** |
| 压缩成功 | 6 次（p50 **45.4 秒**） |
| 压缩失败 | 43 次（p50 **59.2 秒**） |
| 失败落在 55–70 秒（正好卡在 60 秒闸门） | **26 / 43** |
| 被 hook cancel（看门狗）中断的回合 | 25 |

43 次压缩失败里 26 次精确落在 55–70 秒，说明压缩是被**同一个 60 秒上限**反复切断，而不是自己算不完。

## 二、为什么切换模型毫不动效

压缩取模型的来源和主请求不是同一条路：

```js
// dsh-compaction-basic:743
function routedTarget(session) {
    const config = session.requestHeader()?.config;   // 上一次「真正发出」的请求
    ...
}
```

- 切换模型只写 `model/selection` 事件 + 改内存 `selection.current`，**不碰 `requestHeader()`**；
- 新模型要等**下一次 `system-prompt/assemble`** 才被快照进 `selection.assembled`；
- 而压缩在 `pre-step`，读的永远是**旧 header**。

于是：切到 B → 写 selection → pre-step 开始压缩 → 用**旧的 A** 跑 60 秒 → 被打断 → 回合结束、请求从未发出 → 下一轮又压缩、又是 A。`selection` 永远等不到消费者。

**日志实证**：`a5348096` 连续切了 8 次模型（workbuddy→buddy→qodercn→deepseek-account→…），但 `request/header` 从头到尾只有 `buddy/hy3` 一种路由。

## 三、次要缺陷：错误原因被丢弃

43 次压缩失败，落盘全是：

```json
{"compactionId":"…","turn":3,"error":"[object Object]"}
```

`errorChain()`（`dsh-llm:196`）只在对象有 `message` 时取它，否则 `String(current)` → `"[object Object]"`。全库找不到一条可读的压缩失败原因。

## 四、已实施的修复（全部落在看门狗里）

改动文件：
- `dsh-step-watchdog/index.js`
- `dsh-step-watchdog/cordis.patch.yml`
- `dsh-step-watchdog/test/run.mjs`（新增 7 个场景）
- `dsh-step-watchdog/test/harness.mjs`（补 `session.requestHeader()` 与 `cancel` 选项记录）

### 修复 1：压缩独立计时，不再被当作模型卡死

- 新增 `compaction/start`、`compaction/end`、`compaction/prune` 为进度事件；
- 新增 `s.compactStartedAt`；压缩期间**完全豁免** `stallMs`；
- 新增配置 `compactionMs`（默认 **300000**，即 5 分钟）；`0` = 永不打断压缩；
- 只有超过 `compactionMs` 才以 `cause: 'compaction'` 中断。

这样「合法的 45–60 秒压缩」不再被误杀，也解释了为什么之前每次都在 60 秒整点停。

### 修复 2：压缩失败必须可诊断

新增 `reportCompaction()`，对每条 `compaction/end` 输出主机日志：

- 记录耗时与**实际路由**（`buddy/hy3` 这类），因为压缩永远钉在上一次请求的模型上；
- 遇到 `"[object Object]"` 时，按 `s.cancelling` 判定并**显式命名真实原因**（`aborted by this watchdog` / `aborted, not a provider error`），**不再回显那串不可读的字面量**；
- 连续 3 次压缩失败时告警一次：`the transcript is likely pinned near the context ceiling`。

### 修复 3：中断后提醒换模型

重驱动消息现在会附带 `switchModelReminder()`，内容基于日志里已有的事实：

- 压缩导致的中断 → 明说「整个回合都花在上下文压缩上，模型请求从未发出——不是你选的那个模型慢」；
- 若存在未消费的 `model/selection` 且与实发路由不同 → 同时点名两者：
  「你已经把本会话切到 `X`，但最近一次请求仍由 `Y` 发出：切换要等下一次请求才会被消费，而压缩始终沿用上一次请求的模型」；
- 第 N 次中断 → 「请手动切换到其它模型（或降低思考档位）后再继续；模型自身无法切换自己的路由」。

配置 `remindSwitchAfter`（默认 1）控制从第几次中断开始提醒。

### 附带修复：cancel 保留队列

`agent.cancel(cause)` 改为 `agent.cancel(cause, { keepInbox: true })`。

宿主默认 `keepInbox: false` 会 `inbox.clear()`；用户自己的停止按钮用的是 `keepInbox: true`。看门狗原先比用户停止更暴力，会把「换这个模型再试」这类救援消息直接吞掉。

## 五、验证状态

- 测试：**18 / 18 通过**（`node test/run.mjs`）
- 新增场景覆盖：长时间压缩免打扰、超 `compactionMs` 才打断、`compactionMs: 0` 永不打断、换模型提醒内容、提醒可关闭、`[object Object]` 被正确命名、连续 3 次失败告警一次、`keepInbox` 保留队列
- 模块可正常 import（语法检查通过）
- 插件在 profile 里是 `link:` 符号链接到工作区，**改动已落盘**；但**运行中的宿主仍加载旧模块**，需要重启 DSH 才生效

## 六、未完成 / 下一步

### 必须先做
1. **重启 DSH**，让新代码与新配置（`compactionMs`、`remindSwitchAfter`）生效。
2. 重启后在一个卡过的会话里复现一次，确认日志出现：
   - `step-watchdog: session "…" compacted in Nms on provider/model (tolerated: …)` —— 说明压缩被豁免；
   - 或 `… and did not complete: aborted by this watchdog` —— 说明不再出现 `[object Object]`。

### 待决策（需要用户拍板）
3. **压缩 87% 失败率本身没修**。当前只做到「不误杀 + 可诊断」，没有解决「38/47 回合压缩必然跑满 60 秒」。
   可选方向：
   - 给压缩配一个**更快的专用模型**（`summarizationProvider` / `summarizationModel`），避免用 max 思考档的模型做摘要；
   - 调 `dsh-compaction-basic` 的 `thresholdRatio` / `headroomTokens`，降低触发频率；
   - 压缩失败时直接跳过继续请求，而不是让整轮停在那里。
4. **上下文长期贴着上限**（已出现 `100001 tokens > 100000 maximum`）。压缩是症状不是病根，会话历史需要更积极的分层或归档策略。

### 可选
5. `waitingOnHuman` 是**全局**计数器而非 per-agent：任何一个会话弹审批，所有会话的看门狗同时停摆。低优先级，未修。
6. `abandon()` 置 `complained = true` 后只在非中断的 `turn/end` 复位；若那轮永不收敛，该 agent 会永久失明。低优先级，未修。

## 七、取证工具（可复用）

`_probe/` 下留着这次用的脚本，都可用 `ELECTRON_RUN_AS_NODE=1 "D:/Program Files/Deepseek/DeepSeek Harness.exe" <script>` 运行：

| 脚本 | 用途 |
|---|---|
| `frames.mjs` | 按 zstd 帧魔数逐帧解压会话日志（单次解压只出第一帧，这是关键坑） |
| `scan2.mjs` | 全库统计 `turn/end` 原因分布 |
| `hooks.mjs` | 提取 hook 中断的具体原因文本 |
| `causal.mjs` | 证明「压缩跑了但整轮无请求」的因果链 |
| `compsum.mjs` | 压缩成功/失败耗时对比 |
| `switching.mjs` | 校验每次切换后下一次请求是否真的走到新路由 |
| `trace.mjs` / `window.mjs` | 单回合 / 指定 seq 区间的逐事件时间线 |
| `asar2.mjs` | 从 app.asar 提取任意源码（`process.noAsar = true` 绕过拦截） |

会话日志位置：`C:\Users\15940\.dsh\sessions\<workspace>\<session>\session.v4.jsonl.zstd`

## 八、部署状态核对（2026-10-22 更新）

> 此前一度误判「新代码已在生产运行」（基于 `c0844108` 会话里 `step-watchdog:` 子串）。该判断**错误**：那些字符串是 agent 自己引用的文字与测试脚本输出，并非运行时事件；且会话 `.jsonl` 根本不记录 `ctx.logger` 输出（无 `log`/`logger` 事件类型）。Liveness 只能看「最近一次重启时间 vs `index.js` mtime」。

- 插件是 `link:`，进程启动时从磁盘加载，**没有热重载**。
- 关键判据：`verify-deploy.mjs` 比较「最近一次 `desktop-restart/*.log` 时间戳」与「`index.js` 修改时间」。
- 截至核对时：`index.js` 改于 `2026-10-22 11:04`（+0800），最近重启 `2026-10-22 01:11` → **STALE**：运行中的宿主仍加载旧看门狗，必须重启才生效。
- 之前 HANDOFF 第三节「87% 失败率」与「每次都在 60 秒整点停」是方向性正确、非绝对：实测生产会话 `1ebd9f16` 出现过 **101 秒压缩且 `error=null` 跑完**——说明老代码的 stall 计时会被间歇事件重置，bug 是间歇性的。修复后「压缩显式豁免」彻底消除该不确定性。

**部署后验证**：重启 DSH，再跑 `verify-deploy.mjs`（应打印 `DEPLOYED ✓`），并确认某个卡过的会话日志出现
`step-watchdog: session "…" compacted in Nms on provider/model (tolerated: …)` —— 说明压缩被豁免、不再被误杀。
