# ADR 0018: Storyflow 作为 Pi Runtime Projection

状态：Accepted
日期：2026-08-04

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
- Pi 的 canonical `agentDir`、file-backed `SettingsManager`、`DefaultPackageManager`
  与 `DefaultResourceLoader` 是用户资源、package 和 Extension 的唯一运行时事实源。
- Storyflow Session 的持久化目录继续由显式 `PiSessionManager` 隔离；不得再借用
  `agentDir` 表达会话隔离。
- Storyflow 只保留 Product Host 能力：OS/Electron 生命周期、Workspace 与项目身份、
  内容与协作数据、产品导航、Host 工具权限、远端传输，以及模型凭据和 endpoint 注册。
- Storyflow 的 UI 和 RPC 只投影 Pi 的公共 state、event、command、diagnostic 和资源契约；
  不复制 Pi 的状态机，不依赖 TUI component，也不建立第二套 Extension registry。
- Pi 会话树是 rewind/branch 的运行时事实源；Storyflow 只在 Pi Session 中保存稳定的
  产品消息边界，并在树导航成功后原子裁剪自己的消息投影。不存在边界映射时安全拒绝，
  不用易漂移的消息序号猜测。
- Pi `navigateTree()` 的 leaf 只存在内存中；Storyflow 在目标 leaf 下追加一个不进入模型上下文
  的 Pi custom entry，使重启后的 `continueRecent()` 仍恢复同一条活动分支。
- `agent_settled` 是一次产品请求完成的唯一信号；`agent_end` 只表示 Pi 内部一轮运行结束，
  不得绕过 Pi 原生 retry、compaction 或 queued continuation 提前关闭请求。
- Storyflow 旧 Skills/Extensions 目录暂作为显式兼容输入；新 package 安装、启停、更新
  和删除走 Pi package/settings 契约。兼容输入不成为新的写入目标。
- 用户级 Pi Extensions 默认加载。项目级可执行 Extensions 必须经过明确的 Host 授权
  投影后才可信；在该交互闭环完成前保持不信任。
- Storyflow 默认把 `npm:@ayulab/pi-rewind` 写入 Pi 用户 package 配置；缺失安装与后续
  加载继续由 Pi `DefaultPackageManager` 负责，Storyflow 不复制 package 安装器。
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

本 ADR 修订 ADR 0006 的全局资源根与 Extension 隔离决策，并修订 ADR 0011 中
Storyflow-only Extension 的决策。ADR 0016 的 Provider Protocol 所有权保持不变。
