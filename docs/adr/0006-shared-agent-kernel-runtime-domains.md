# ADR 0006: 自由对话与项目对话共享 Agent 内核

状态：Accepted
日期：2026-07-23

## 背景

Storyflow 需要同时支持应用级自由对话和项目级写作对话。两者必须隔离历史、文件视野和工作区，
但继续复用相同的 Agent 能力与全局资源。当前会话已经按 `workspaceRootPath` 存储，
因此为自由对话复制 Agent、SessionManager、资源加载器或持久化系统只会增加同步与兼容胶水。

当前 Activity Rail 的 UI-only 方案把“对话”直接路由到当前项目的 `allSessions`。这只是项目会话的
另一个入口，不满足自由对话在未打开项目时可用、切换项目后身份不变、且无法读取项目目录的产品边界。

## 决策

Storyflow 采用一个 Agent 实现和两个 Runtime Domain：

```text
Free Conversation ─┐
                   ├─ workspaceId → Workspace → Agent Kernel
Project Conversation ┘                         ├─ SessionManager
                                               └─ Resource Resolver
```

- 全应用只保留一个 Agent Kernel、一个 SessionManager 和一个 Resource Resolver。
- API 与运行时只传递 `workspaceId`，并解析为现有 `Workspace`；不再增加 owner、runtime context
  或 navigation key 等平行身份模型。
- 自由对话使用稳定的隐藏 workspace id，项目对话使用项目 workspace id。会话存储、工作目录、
  文件边界和资源视图均从这一个 workspace 事实源推导。
- 自由对话通过应用内部的隐藏 Workspace 复用现有 workspace-scoped session
  持久化；它不出现在项目列表中，每个自由对话使用独立工作目录。
- 项目对话继续使用现有项目 workspace 和原有会话数据，不迁移历史内容。
- 全局资源的唯一根是 `~/.craft-agent`。全局 Skills、Sources、Extensions 和模型连接定义均由
  应用管理；Resource Resolver 负责加载前三者，存在项目时再叠加项目 Skills 和 Sources。
  Extensions 只允许全局安装，模型连接继续由现有全局配置与会话引用机制选择。
- `<project>/.pi/skills/` 继续是该项目 Skill 覆盖层的事实源。ADR 0004 的项目 Skills Market
  边界不变，但它不再被解释为所有 Runtime Domain 的唯一 Skill 来源。
- `~/.agents`、`~/.codex` 和 `~/.pi` 不参与运行时隐式发现或同步；如需迁入，只执行显式的一次性导入。
- 自由对话与项目对话之间只能显式转移。当前最小契约只传递一次性生成的会话摘要，
  并按目标域默认权限与资源配置创建新会话；不继承源会话权限、状态或标签，不复制 provider transcript、
  项目文件或附件，不改变源会话，也不建立实时历史链接。
- Activity Rail 的“自由对话”始终查询隐藏 workspace；项目会话继续只出现在相应项目 workspace。
- 会话列表 RPC 只接受显式 workspaceId（`sessions:listByWorkspace`）。协议层不提供跨 workspace
  返回会话的通道，边界由协议保证而非调用方自觉。跨域聚合只允许返回不含会话身份的计数
  （`sessions:getUnreadSummary`）。
- 每个 Runtime Domain 恰好拥有一个会话列表界面：自由对话域由 Activity Rail 承担，项目域由项目
  自己的 SessionList 承担。任何"统一的全局最近对话列表"都会重新合并两个域。

## 后果

优点：

- 隔离由少量类型和路径解析表达，而不是由重复系统表达。
- 现有 SessionManager、JSONL 持久化、Agent backend 和项目会话可以原样复用。
- 全局资源没有跨目录同步状态，项目资源也不会污染全局。
- 自由对话和项目对话在 UI、历史和文件权限上具有可验证的所有权边界。

代价：

- 隐藏 workspace 解析处必须处理一个明确的自由对话 id。
- Prompt、工具权限和文件树必须读取当前 Workspace 的工作区边界，不能继续默认使用当前项目根。
- 跨域转移不能直接使用只支持同 workspace 的 provider-native fork；只能从不可变摘要创建
  seeded fresh session。若未来确有逐条消息或附件选择需求，应扩展 Transfer Snapshot 契约，
  而不是恢复整个 SessionBundle 复制。

## 非目标

- 不新增第二套 Agent runtime、SessionManager、数据库或资源加载器。
- 不允许自由对话临时挂载整个项目目录。
- 不把 Project Skill Package 扩展成可执行 Extension。
- 不为外部 Agent 配置目录维护双向同步或长期兼容层。
- 不提供跨 Runtime Domain 的统一会话列表，即使它在交互上更省一次点击。

## 回归记录：2026-07-26

本 ADR 落地（`3a174fb5e`）之后，Codex 风格侧边栏改造（`3f20237a7`）引入了跨 workspace 的
`sessions:getAll` 与"最近对话"全局列表，边界被重新打穿。侧边栏同时出现两个互斥语义：区块内容
是全局的，而新建按钮是自由对话域的；`RecentConversationRow` 用一行 workspaceName 小字标注每条
会话属于哪个项目——这个标签正是"知道混了、用补丁缓解"的信号。

三条独立泄漏路径，缺一不可修：

1. `sessions:getAll` 服务端不过滤 workspace。
2. 即使服务端过滤，`localSessionMetaMap` overlay 仍会把当前运行项目的会话并进列表。
3. 泄漏是双向的——点击项目会话会切走整个运行时，列表成了跨域跳板。

修复同时移除了两处以字符串匹配锁定该实现的静态测试。教训：静态源码断言会把违反 ADR 的实现
一起冻结，涉及所有权边界的不变量应当用行为测试表达。
