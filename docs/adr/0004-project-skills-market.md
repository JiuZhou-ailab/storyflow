# ADR 0004: 项目级 Skills Market 与声明式贡献

状态：Accepted
日期：2026-07-17

## 背景

Storyflow 的运行时是 Pi，项目 Skill 的唯一真相源是
`<project>/.pi/skills/<slug>/SKILL.md`。公共生态需要支持发现、贡献、版本化和一键导入，
同时不能让上传内容获得执行宿主代码、修改全局 Agent 配置或绕过项目边界的能力。

现有 `ResourceBundle` 已提供跨工作区文件封装、路径校验、冲突模式和 staging + rename
原子安装。写作侧边栏也已经投影真实项目文件树，而不是只显示固定栏目。

## 决策

采用两个责任域和一个稳定包合同：

```text
Public Skills Market (Cloudflare Worker)
  ├─ discover / provenance / versions / moderation
  ├─ D1 metadata
  └─ private R2 immutable ResourceBundle bytes
                 │
                 │ craftagents://action/install-skill?slug&version&sha256
                 ▼
Storyflow project client
  ├─ fixed registry download
  ├─ SHA-256 verification
  ├─ visible user confirmation
  └─ existing resources:import → <project>/.pi/skills
                 │
                 ▼
Pi ResourceLoader → project Skill invocation → project files → sidebar projection
```

Market 包是只含一个 Skill 的 `ResourceBundle v1`。Skill 必须包含：

- `SKILL.md`：Pi 读取的方法与指令；frontmatter `name` 必须等于目录 slug。
- `storyflow.json`：版本、作者、许可、来源和声明式项目目录建议。
- 可选 `references/`、`assets/`、模板；MVP 仅接受 UTF-8 文本。

`storyflow.json` 的目录贡献不是 UI 命令。它描述方法期望的项目结构；Skill 被用户调用后，
Agent 可以在当前项目中创建相应文件。侧边栏继续以真实文件系统为唯一真相源，因此任何
方法论都能形成自己的目录，而宿主无需增加 `正文/全局/自由区` 一类枚举。

## 信任边界

- 公共浏览、搜索和下载匿名可用；贡献与管理路径由 Cloudflare Access 保护。
- Market 不执行 Skill，也不允许脚本、二进制、symlink、路径穿越或多资源包。
- 公开包不可覆盖；`slug + version + sha256` 对应不可变 R2 object。
- deep link 不携带任意 URL，只携带结构化身份与摘要；客户端始终从固定 registry 拉取。
- 客户端先核对 SHA-256，再展示明确确认，最后调用现有原子导入链。
- 首次发布和许可升级需要审核。AI 可辅助标记风险，但不是发布裁决者。

## 方法论目录

首批目录包含 30 个经过来源核对的方法。13 个公共领域、CC0、CC BY 或可明确署名的原创
改造提供下载；其余作为 `reference-only` 条目，只展示原创摘要和来源外链，获得授权前不
生成包。这样把“发现价值”与“再分发权利”分开。

## Cloudflare 部署

MVP 是一个 Worker：Static Assets + API，D1 保存身份、元数据与审核状态，私有 R2 保存包。
不引入 KV、Durable Objects、Vectorize、Workflows 或微服务。若未来审核出现长时间暂停、
外部扫描或多阶段恢复，再引入 Queue/Workflows，而不是预先维护第二套状态机。

当前部署资源由 `apps/skills-market/wrangler.resources.example.toml` 描述。资源创建和正式
发布必须在有效 Cloudflare 登录后执行，staging 与 production 使用独立 binding。

## 后果

优点：Pi 兼容、项目隔离、安装链复用、供应链可审计、方法目录不被宿主硬编码。
代价：MVP 不支持任意脚本、依赖自动安装、付费市场、私有组织 registry 或自动覆盖升级。
