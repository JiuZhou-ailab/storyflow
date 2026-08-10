# ADR 0018: Storyflow 作为 Pi Runtime Projection

状态：Accepted
日期：2026-08-04
修订：2026-08-11

## 背景

Storyflow 已使用 Pi `AgentSession`，但资源加载仍把 `agentDir` 放进单个 Storyflow
会话目录、使用内存 Settings，并通过 `noExtensions` 关闭 Pi Extension。这让
`pi install`、用户 package 配置和 Agent 实际加载结果形成两个事实源，也迫使
Storyflow 重复维护 Pi 已拥有的发现规则。

Storyflow 的长期价值是内容创作产品、Workspace、协作和云端 Host，不是另一套
Agent runtime。产品必须投影 Pi 的公共契约，而不是镜像 Pi 的内部类或 TUI。

## 决策

- Pi `AgentSession` 是唯一 Agent Runtime，拥有会话树、compaction、retry、
  Extension 生命周期、Skill/Prompt/Theme/Context 发现和 Provider 协议。
- Pi 的 retry settings、Provider retry classifier、queued continuation、abort 与 settlement
  是同一个状态机。Storyflow 不覆盖 retry 次数，不改写错误来诱导 retry，也不根据静默时长
  猜测失败；产品层只保留 12 小时绝对安全上限，具体 Provider/Tool 超时归各自原生生命周期。
- Pi 的 canonical `agentDir`、file-backed `SettingsManager`、`DefaultPackageManager`
  与 `DefaultResourceLoader` 是用户资源、package 和 Extension 的唯一运行时事实源。
- Pi 的 System Prompt builder 是最终提示装配权威。Storyflow 只通过
  `DefaultResourceLoader.systemPromptOverride` 提供不可缺失的产品基础契约；用户全局指令、
  项目 `AGENTS.md` / `CLAUDE.md`、Skills、日期与工作目录仍由 Pi 原生装配。Storyflow 只用
  Pi 的 `before_agent_start` hook 把每轮 Host 策略投影为临时 system prompt，并用 `context`
  hook 把路径、Source 与文件事实作为非持久数据投影到当前用户消息；不得把策略降级为用户文本、
  污染会话历史，或手工复制 Pi 已装配的资源。
- Storyflow Session 的持久化目录继续由显式 `PiSessionManager` 隔离；不得再借用
  `agentDir` 表达会话隔离。
- 每个 Storyflow Session 只持有一个 Pi runtime。主 chat 与 Pi 原生的临时 `llm_query`
  可共享稳定的运行时 lease；创建、配置刷新、Source 更新、rewind 与销毁使用独占边界，
  并等待所有兼容操作释放 lease。删除和凭据撤销先失效旧代，排队中的后台操作不得重建
  或持久化已关闭的 Session；异步操作不得把裸 `AgentInstance` 带出对应边界。
- Storyflow 只保留 Product Host 能力：OS/Electron 生命周期、Workspace 与项目身份、
  内容与协作数据、产品导航、Host 工具权限、远端传输，以及模型凭据和 endpoint 注册。
- 两者只通过无策略的 typed Boundary Protocol 连接：Storyflow 向 Pi 提供不可变上下文、
  capability、凭据和显式用户命令；Pi 向 Storyflow 返回事实事件与相关结果。协议层不得把错误
  翻译成 retry/replay/abort/settlement，也不得制造 Pi 原生事件。
- Pi `AuthStorage` 负责 OAuth 刷新与并发锁；Storyflow 只提供初始凭据，并把 Pi 返回的
  轮换凭据持久化到产品凭据存储，不实现第二套 Provider 刷新器。
- Storyflow 托管模型 token 是 Product Host capability，不伪装成第二套 Agent 认证状态机。
  Host 可在显式请求前预检并把轮换 token 推送给 Pi；请求中途失效时只为下一次显式请求刷新，
  不销毁 Agent、不删除消息、不自动重放当前 turn。
- Storyflow 不再按 Provider 选择 Agent Runtime，也不保留单实现 factory。Anthropic、
  OpenAI、Bedrock 与 custom endpoint 都只是 Pi 的模型/认证 Provider。
- Web Search 是独立 Host capability，只使用自己的 AnySearch 凭据或无凭据的 fallback；
  不复用模型 Provider 的 API key/OAuth token，也不在 Storyflow 复制其私有搜索协议。
- Storyflow 的 UI 和 RPC 只投影 Pi 的公共 state、event、command、diagnostic 和资源契约；
  不复制 Pi 的状态机，不依赖 TUI component，也不建立第二套 Extension registry。
- Storyflow Source 激活只改变下一轮可用 capability。它不得中断当前 Pi turn、发出自动重试
  effect，或重放原始用户消息；当前工具调用按现有授权结果完成或失败。
- Pi 内置 read/bash/edit/grep/find/ls 使用 SDK 原生实现。Storyflow 工具和权限通过 Pi 官方
  registry/Extension hooks 注入；唯一内置覆盖是 create-only write 数据安全契约，防止无损恢复
  之前覆盖已有文件。
- Pi 会话树是 rewind/branch 的运行时事实源；Storyflow 只在 Pi Session 中保存稳定的
  产品消息边界，并在树导航成功后原子裁剪自己的消息投影。不存在边界映射时安全拒绝，
  不用易漂移的消息序号猜测。
- Pi `navigateTree()` 的 leaf 只存在内存中；Storyflow 在目标 leaf 下追加一个不进入模型上下文
  的 Pi custom entry，使重启后的 `continueRecent()` 仍恢复同一条活动分支。
- 对真实 Agent turn，`agent_settled` 是唯一完成信号；`agent_end` 只表示 Pi 内部一轮运行结束，
  不得绕过 Pi 原生 retry、compaction 或 queued continuation 提前关闭请求。未启动 Agent 的
  Extension command 或 prompt preflight failure 使用相关 `prompt_result` 关闭 Host 请求，不能
  伪造 `agent_settled`。
- Storyflow 旧 Skills 目录暂作为显式兼容输入；旧 Extensions 不再扫描或执行。新 package
  安装、启停、更新和删除走 Pi package/settings 契约。兼容输入不成为新的写入目标。
- 用户级 Pi Extensions 默认加载。项目级可执行 Extensions 必须经过明确的 Host 授权
  投影后才可信；在该交互闭环完成前保持不信任。项目 Skills 仍由第二个只读的 Pi
  `DefaultResourceLoader` 加载，避免 Pi 的统一 project trust 开关误伤非执行资源。
- Storyflow 暂停默认加载 `npm:@ayulab/pi-rewind`，并从先前由产品写入的 Pi 用户 package
  配置中移除该源，但保留已安装文件和其余用户 package。待 Git capability preflight、
  写作工作区恢复状态收敛和跨 Host UI 达到产品要求后再重新启用。
- 工具为空、无持久状态的内部 mini-completion 与受限 Subagent Run 可以显式关闭
  Extensions/Skills，避免重复执行副作用；它们不是用户主会话的生态入口。

## 后果

`pi install npm:<package>` 写入的用户 package 能被 Storyflow 主 AgentSession 直接解析；
Pi 升级 package、Extension 或资源规则时，Storyflow 不再同步一套扫描器。代价是桌面端
只投影 Pi RPC 可表达的 `select`、`confirm`、`input`、`notify`；TUI-only custom component
不属于跨 Host 的稳定契约。Pi 子进程发布为 Bun compiled binary，使用 Pi 官方的 virtual
module loader 向 npm Extension 提供 Pi API；普通单文件 JS bundle 不满足该加载契约。
旧会话没有产品边界映射时仍可走 Storyflow 自身的消息 rewind，但 Extension 发起的树导航
会明确拒绝，避免把 Pi 树与产品消息裁成两个不一致的事实版本。
历史文件中的 `agentRuntime: "claude-sdk"` 只作为读取期迁移标记存在；第一次进入 Pi 时
丢弃不兼容的旧 runtime 指针，并由持久化的产品消息一次性重建 Pi 上下文，不存在对应执行路径。

本 ADR 修订 ADR 0006 的全局资源根与 Extension 隔离决策，并修订 ADR 0011 中
Storyflow-only Extension 的决策。ADR 0016 的 Provider Protocol 所有权保持不变。
