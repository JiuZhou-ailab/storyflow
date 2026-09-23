# Pi 0.84.4 → 0.87.1 升级评估

核验日期：2026-09-23。结论：可以安排迁移，但不能直接改版本发布；当前应保留 0.84.4 和补丁，直到新版通过既有产品契约测试。

## 版本与范围

GitHub 与 npm 最新稳定版均为 0.87.1，发布时间 2026-09-22T19:43:43Z。仓库根、packages/shared、packages/pi-agent-server 固定 0.84.4，根 patchedDependencies 包含 pi-ai 与 pi-coding-agent 两份补丁。

官方来源：[0.87.1 release](https://github.com/earendil-works/pi/releases/tag/v0.87.1)、[npm metadata](https://registry.npmjs.org/@earendil-works/pi-coding-agent/latest)。

本次没有升级工作区依赖、修改产品代码或调用付费模型。新版安装在 /tmp/storyflow-pi-upgrade-0871，禁用安装脚本；测试使用现有 loopback HTTP fixture。调查时 HEAD 为 2acf8f36c，但工作区有并行修改，测试数字代表执行时快照，不是冻结提交的发布验收。

## 本地验证

| 既有测试组 | 当前 0.84.4 + patches | 原版 0.87.1 |
| --- | --- | --- |
| managed-access-contract + runtime-budgets | 34 pass / 0 fail | 26 pass / 8 fail |
| managed-fallback + system-prompt-override + project-resource-loader + product-rewind | 73 pass / 0 fail | 60 pass / 13 fail |

候选测试通过临时 tsconfig paths 将三个 Pi 包映射至新版。import.meta.resolve 确認 coding-agent 来自 /private/tmp/storyflow-pi-upgrade-0871/node_modules；getRetrySettings 包含新版 maxAgentDelayMs。Bun 1.4.2 对 tsconfig override 打印 directory mismatch 内部警告，但测试完成并返回结果。因此这是一轮隔离兼容探测，正式迁移仍需真实 lockfile 安装验收。

生产源文件的临时类型检查明确失败于 runtime-budgets.ts:16：原版 CompactionSettings 没有当前补丁提供的 maxSummaryTokens。首次扩大到测试源码的检查也发现 TranscriptContext 等测试适配点；不将这些历史测试类型问题计为新增生产错误。

### 已复现的实质回归

- 永久拒绝仍被重试：四类 provider 均有失败，Google 近上限错误响应案例从预期 1 次变为 8 次请求。
- Retry-After 丢失：原生跨模型重试要求至少 195 ms，候选仅 3 ms；Google body retry_after_ms 要求至少 990 ms，候选 472 ms。
- 取消边界失败：backoff、dispose、cooldown selection 三条测试失败。
- transport attempts 不能完整区分 provider 内层重试和 session 外层重试。
- 摘要请求 max_tokens 预期 8192，候选实际 32768；新版 per-model reserveTokens/keepRecentTokens 不能替代独立摘要输出预算。

21 项失败不是 21 个独立产品缺陷：例如 getRetrySettings 新增 maxAgentDelayMs 导致旧对象精确相等断言失败，只需更新契约断言。

临时原始证据：/tmp/storyflow-pi-upgrade-0871/{baseline-tests,candidate-tests,baseline-integration,candidate-integration,typecheck-production}.log。

## 官方破坏性变更在本项目的落点

| 官方变更 | 本地影响和处理 |
| --- | --- |
| 0.86 底层 Context → TranscriptContext | 本项目主要通过 createAgentSession/ModelRuntime，未发现自定义底层 provider stream 实现；直接调用底层 API 的兼容测试需 normalizeContext。不能把所有公开 Models.stream 调用都误判为不兼容。 |
| 0.86 ToolCall.arguments / ToolResultMessage.details 收紧为 JSON | 重新检查工具桥 payload、readonly JSON 数组和泛型；本次生产类型探测未发现这些位置的直接编译阻塞，不代表所有第三方 Extensions 已兼容。 |
| 0.87 SessionManager 成为请求历史事实源 | 当前 primary-session 的 continueRecent/forkFrom/branch 与产品 navigateTree 路线仍合理，rewind 测试通过。旧补丁中删除 agent.state.messages 最后一条的方式不能照搬；应保留新版 append-only context omission。 |
| 0.87 finishTurn、turn_end boundary、context_edit、新 ExtensionEvent | 未发现产品使用 shouldStopAfterTurn 或直接 emit(turn_end)。事件适配器与全局第三方 Extensions 仍需覆盖新增事件形状；context hook 继续负责临时用户上下文，现有 prompt 测试通过。 |
| 0.86 user_bash fail-closed | 未发现第一方相关 handler；安装的外部 Extensions 需另验。 |

来源：[0.86 release](https://github.com/earendil-works/pi/releases/tag/v0.86.0)、[0.87 release](https://github.com/earendil-works/pi/releases/tag/v0.87.0)、[custom provider](https://github.com/earendil-works/pi/blob/v0.87.1/packages/coding-agent/docs/custom-provider.md)、[agent-core changelog](https://github.com/earendil-works/pi/blob/v0.87.1/packages/agent/CHANGELOG.md)。

## 补丁与新增默认行为

当前 patches/README.md 明确要求真实 SDK 契约通过后才能移除补丁。新版 AgentSession._prepareRetry 仍只按本地 retryDelayMs 计算 backoff；setModel 仍先 await checkAuth 再写 model，不能依据“官方修复取消问题”就删除本地并发保护。新版已经重构请求历史与取消流程，需按行为重新迁移补丁，不能只改 patch 文件名。

另一个不在 Breaking Changes 标题下的行为变化是 cacheWarming 默认 streaming。满足模型缓存寿命与成本阈值时可能发额外刷新请求，usage 进入 session totals。Storyflow 当前未显式配置；升级应先设 off，或先验证其网关鉴权、请求关联和成本归属，再启用。来源：[官方 settings](https://github.com/earendil-works/pi/blob/v0.87.1/packages/coding-agent/docs/settings.md)。

## 最小迁移路径与验收

1. 将三个 Pi 包统一锁至 0.87.1，重做两个版本补丁；保留拒绝语义、Retry-After、取消、并发模型选择、请求关联、摘要预算等仍被测试证明需要的契约。
2. 采用新版 SessionManager/context_edit 语义，不恢复旧的直接 messages 截断；适配底层 Context 测试及新增配置字段。
3. 明确 cacheWarming 策略；验证用户全局 Extensions 的冷启动、reload、主会话与 subagent，不扩大为整体 runtime 重写。
4. 在冻结候选上运行上述六个测试文件、全量相关 typecheck、Bun compiled binary smoke 和 Electron 核心会话恢复/分支/取消 QA，再考虑发布。

升级收益是新模型、provider 修正、会话上下文和压缩可靠性；实际成本集中在 SDK 适配层和既有补丁。当前证据支持“做一次有范围的迁移”，不支持“直接 bump 安全”，也没有证明需要放弃升级或重写整体集成。
