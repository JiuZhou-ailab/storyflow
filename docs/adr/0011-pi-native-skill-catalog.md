# ADR 0011: Pi 原生 Skill Catalog

状态：Accepted
日期：2026-07-28

## 背景

Storyflow 自建的 `~/.craft-agent/skills` 单目录规则与 Pi、Agent Skills CLI
和项目仓库的实际生态不一致。它造成两个事实源：Agent 运行时、技能栏和
`npx skills add` 可能看到不同结果；默认 Skill 也只能在应用启动复制后出现。

Skill 是方法与说明，不是 Storyflow 私有状态。其发现规则应由执行它的 Agent
runtime 定义，Storyflow 只应拥有产品投影、写入确认和包安装安全边界。

## 决策

- Pi 的 `DefaultResourceLoader` 是 Skill 发现、frontmatter 校验、作用域、
  优先级、软链接去重和同名冲突的唯一事实源。
- 运行时和技能栏按当前工作目录解析同一份 catalog。
- 支持 Pi 原生用户级目录 `~/.pi/agent/skills`、`~/.agents/skills`，以及
  项目级 `.pi/skills`、`.agents/skills`。
- Storyflow 创建的新用户 Skill 和内置默认 Skill 写入
  `~/.pi/agent/skills`。`~/.craft-agent/skills` 作为只读兼容输入继续交给
  Pi 解析，避免已有用户内容消失；不自动覆盖或删除。
- 技能栏显示 Pi scope，并使用 Pi 返回的精确 `filePath` 打开资源。
  package 来源的 Skill 必须经其包管理器删除。
- Pi diagnostics 保留在 catalog，并在服务端记录；不另造一套冲突规则。
- Storyflow Extensions 仍只从显式的 Storyflow 根加载并执行软链接检查。
  Skill 发现与可执行 Extension 信任是正交边界。
- Market/ResourceBundle 导入仍执行摘要、路径穿越、软链接、frontmatter 和
  禁止静默覆盖检查，安装目标改为 Pi 用户 Skill 目录。

## 后果

优点：`npx skills add`、项目仓库、Agent runtime 与技能栏共享同一事实；
项目可以随仓库携带 Skills，用户 Skills 仍可跨项目复用；Pi 升级发现规则时
Storyflow 不需要维护平行实现。

代价：同名 Skill 可能产生 Pi collision diagnostics，项目 Skill 也可能来自
软链接。读取遵循 Pi 语义；写入、包导入和删除仍由 Storyflow 在明确目标上校验。

本 ADR 取代 ADR 0010 的“单一全局 Skill 目录”决策，并修订 ADR 0005、
ADR 0006 中涉及 Skill 安装目标与 Project Resource Overlay 的部分。
