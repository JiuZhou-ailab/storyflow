# Storyflow

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

Storyflow 是一个基于 Bun workspace 的 AI Agent 工作台项目，支持桌面端和无头服务端两种运行形态。核心产品是 Electron 桌面应用，集成聊天会话、本地工作区、外部来源、技能、文件编辑、差异审阅、自动化和写作项目工作流。

当前仓库主要面向源码开发、本地打包和自定义工作区流程。它不只是一个 Claude 包装层：仓库内包含共享 RPC 服务、Pi SDK 子进程适配器、可复用 UI 包、Web 客户端、会话查看器，以及写作方法包脚手架。

## 项目能力

- **Electron 桌面应用**：支持多会话 Agent 工作、来源管理、文件编辑、本地差异审阅和工作区导航。
- **无头服务端**：通过 WebSocket 远程运行会话和工具。
- **CLI 客户端**：用于脚本化访问无头服务端。
- **共享 UI 与协议包**：供 Electron、Web UI 和 Viewer 复用。
- **多 Agent 后端**：支持 Anthropic Claude Agent SDK 和基于 Pi SDK 的 Provider 集成。
- **写作工作区模式**：支持 Markdown 编辑、文件提及、行号、总字数、选区改写、导出、本地版本快照和差异审阅。
- **写作方法包**：内置 Claude-Book、Oh Story、Crucible 和通用创意写作脚手架。
- **来源、技能和自动化**：支持 MCP server、REST API、本地文件、工作区指令和 Agent 原生集成。

## 仓库结构

```text
storyflow/
├── apps/
│   ├── cli/                 # 无头服务端的命令行客户端
│   ├── electron/            # 主桌面应用：main、preload、renderer
│   ├── marketing/           # Storyflow 官网和下载入口
│   ├── viewer/              # 共享会话记录查看器
│   └── webui/               # 无头服务端的浏览器客户端
├── packages/
│   ├── core/                # 共享底层类型和工具
│   ├── messaging-gateway/   # 消息网关集成
│   ├── messaging-whatsapp-worker/
│   ├── pi-agent-server/     # 独立进程 Pi SDK 适配器
│   ├── server/              # 独立无头服务入口
│   ├── server-core/         # RPC 传输、可复用 handler、平台契约
│   ├── session-mcp-server/  # 会话使用的内置 MCP server
│   ├── session-tools-core/  # 多运行时共享的工具实现
│   ├── shared/              # 配置、协议、会话、来源、写作逻辑
│   └── ui/                  # 共享 React UI、Markdown、diff、chat 组件
├── docs/
│   └── plans/               # 设计和实现规划文档
├── scripts/                 # 构建、验证、发布和维护脚本
└── README.md                # 项目总览和开发入口
```

## 环境要求

- [Bun](https://bun.sh/) 1.2 或更高版本。
- Git。
- Electron 相关包所需的 Node 兼容原生工具链。
- Python 3，仅用于文档工具 smoke test。
- 如果要打包 Electron 安装包，需要对应平台的构建工具。

本项目使用 Bun workspaces。安装、测试、构建和脚本执行都应使用 `bun`，不要使用 npm 或 pnpm。

## 快速开始

```bash
git clone https://github.com/JiuZhou-ailab/craft-agents-oss.git storyflow
cd storyflow
bun install
bun run electron:dev
```

生产形态的本地运行：

```bash
bun run electron:start
```

`electron:start` 会构建 Electron main process、preload scripts、renderer、内置资源，然后启动应用。

## 常用开发命令

| 命令 | 用途 |
| --- | --- |
| `bun install` | 安装 workspace 依赖 |
| `bun run electron:dev` | 以开发模式启动 Electron 应用 |
| `bun run electron:start` | 构建并运行 Electron 应用 |
| `bun run electron:build` | 构建 Electron main、preload、renderer、resources 和 assets |
| `bun run electron:dist:dev:mac` | 通过 runtime-staged 打包路径构建未签名的 macOS 开发包 |
| `bun run release -- --platform=darwin --arch=arm64` | 运行版本检查、CI 验证和 runtime-staged 本地打包 |
| `bun run server:start` | 启动独立无头服务端 |
| `bun run server:dev` | 以 debug 设置启动无头服务端 |
| `bun run webui:dev` | 启动浏览器客户端 |
| `bun run viewer:dev` | 启动会话查看器 |
| `bun run marketing:dev` | 启动 Storyflow 官网 landing 页面 |
| `bun run typecheck:all` | 对主要 packages 和 apps 做类型检查 |
| `bun test` | 运行 Bun 测试 |
| `bun run validate:ci` | 运行更完整的验证套件 |
| `bun run lint:i18n:coverage` | 检查字面量 i18n key 是否存在 |

## 桌面应用

Electron 应用位于 `apps/electron`。

关键路径：

```text
apps/electron/src/main/       # Main process、应用生命周期、窗口、本地 handlers
apps/electron/src/preload/    # 暴露给 renderer 的 context bridge
apps/electron/src/transport/  # Channel map 和 RPC client bridge
apps/electron/src/renderer/   # React UI、shell、chat、写作工作区
apps/electron/resources/      # 运行时脚本和打包资源
```

常用命令：

```bash
bun run electron:build:main
bun run electron:build:preload
bun run electron:build:renderer
bun run electron:build
bun run electron:start
```

开发日志通常写入 Electron 日志目录：

```text
~/Library/Logs/@craft-agent/electron/main.log
```

## 写作工作区

写作项目是一等工作区，支持：

- 基于方法包的项目脚手架。
- 带行号和总字数的 Markdown 稿件编辑。
- 面向作者的章节、规划文件标签。
- 按展示名进行 `@file` 提及，同时保留真实文件路径。
- 选区改写：直接编辑当前文档，而不是走普通聊天转录流程。
- 生成文件变更的内联差异审阅。
- 对稿件、大纲、状态、时间线、风格、作品和分析文件的导出控制。
- 通过导出附近的版本历史按钮创建本地 git 版本快照。

内置方法包位于：

```text
packages/shared/src/writing/method-packs/
```

脚手架和写作项目逻辑位于：

```text
packages/shared/src/writing/
packages/shared/src/workspaces/
apps/electron/src/renderer/components/writing/
```

## 无头服务端

独立服务端可以在没有 Electron UI 的情况下运行 Agent 会话和工具。

```bash
CRAFT_SERVER_TOKEN=$(openssl rand -hex 32) bun run server:start
```

常见环境变量：

| 变量 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `CRAFT_SERVER_TOKEN` | 是 | - | 客户端认证 Bearer token |
| `CRAFT_RPC_HOST` | 否 | `127.0.0.1` | 绑定地址 |
| `CRAFT_RPC_PORT` | 否 | `9100` | 绑定端口 |
| `CRAFT_RPC_TLS_CERT` | 否 | - | `wss://` 使用的 PEM 证书路径 |
| `CRAFT_RPC_TLS_KEY` | 否 | - | PEM 私钥路径 |
| `CRAFT_DEBUG` | 否 | `false` | 启用 debug 日志 |

让 Electron 应用连接远程服务端：

```bash
CRAFT_SERVER_URL=ws://127.0.0.1:9100 \
CRAFT_SERVER_TOKEN=<token> \
bun run electron:start
```

## CLI 客户端

CLI 位于 `apps/cli`，用于访问无头服务端。

```bash
bun run apps/cli/src/index.ts --help
bun run apps/cli/src/index.ts --url ws://127.0.0.1:9100 --token <token> ping
```

常见命令：

```bash
bun run apps/cli/src/index.ts workspaces
bun run apps/cli/src/index.ts sessions
bun run apps/cli/src/index.ts send <session-id> "Summarize this workspace"
bun run apps/cli/src/index.ts run --workspace-dir . "Inspect this repository"
```

## 运行时数据

本地用户数据存放在：

```text
~/.craft-agent/
├── config.json
├── credentials.enc
├── preferences.json
├── workspaces/
└── sessions/
```

写作工作区还可能包含项目文件、skills、`craft-writing.json`、`craft-pack-lock.json`，以及用于版本快照的本地 `.git` 目录。

## LLM Provider

项目通过两条运行时路径支持多种连接类型：

- **Claude backend**：Anthropic Claude Agent SDK、Anthropic API key、Claude Max/Pro OAuth，以及兼容的自定义 endpoint。
- **Pi backend**：基于 Pi SDK 的连接，包括 Google AI Studio、ChatGPT/Codex OAuth、GitHub Copilot OAuth、OpenAI API key 和相关 provider 流程。

连接配置保存在用户配置和凭据存储中，不写入仓库源码。

## 来源、技能和自动化

- **Sources**：连接 MCP server、REST API、本地文件和服务集成等外部系统；默认保存在全局 `~/.agents/sources/`，工作区内同名配置可覆盖。
- **Skills**：可在聊天中提及的全局/工作区/项目级指令和工作流。
- **Automations**：可根据标签、计划任务、工具事件、权限变化和会话生命周期创建或更新会话。

这些系统的大部分共享逻辑位于 `packages/shared/src`，可复用服务端 handler 位于 `packages/server-core/src/handlers/rpc`。

## 验证策略

开发中优先使用聚焦检查：

```bash
bun test path/to/test.ts
cd apps/electron && bun run typecheck
cd packages/shared && bun run tsc --noEmit
```

发布前使用更完整检查：

```bash
bun run check-version
bun run typecheck:all
bun run validate:ci
bun run electron:build
```

打包命令：

```bash
bun run electron:dist:dev:mac -- --arch=arm64
bun run electron:dist:dev:mac -- --arch=x64
bun run electron:dist:dev:win
```

当前 GitHub release 只发布 macOS `.dmg` 和 Windows `.exe` 产物。macOS 产物按架构区分：Apple Silicon Mac 使用 `Storyflow-arm64.dmg`，Intel Mac 使用 `Storyflow-x64.dmg`，并且 Electron runtime 需要 macOS 12.0 或更高版本。打开错误架构的 macOS 产物，或在 macOS 11 及更早系统运行，可能会看到系统提示此 Mac 不支持该应用。

### macOS 安全提示

在 macOS 应用使用 Developer ID 证书签名并通过 Apple notarization 之前，macOS Gatekeeper 可能会提示 Apple 无法验证 Storyflow 是否包含恶意软件或是否会影响隐私。下面步骤只适用于从官方 GitHub release 页面下载的 Storyflow。

打开应用：

1. 打开 `System Settings`。
2. 搜索 `Security`，进入 `Privacy & Security`。
3. 滚动到 `Security` 区域。
4. 找到被拦截的 `Storyflow` 条目。
5. 点击 `Open Anyway` 并确认。

长期发布方案是 Developer ID 签名加 Apple notarization。这个手动批准步骤只是未签名或未公证构建的临时绕过方式。

根打包脚本会调用 `apps/electron/scripts` 下的平台构建脚本，确保内置 `uv`、Bun、SDK binary、ripgrep 和辅助子进程等运行时资源在 `electron-builder` 执行前完成 staging。不要直接从仓库根目录运行裸 `electron-builder` 命令作为 release 路径。

完整本地发布门禁：

```bash
bun run release -- --platform=darwin --arch=arm64
```

## 开发注意事项

- Electron IPC/RPC channel 应在 `packages/shared/src/protocol` 声明，在 `apps/electron/src/transport` 映射，在 `apps/electron/src/shared/types.ts` 类型化，并在对应 handler package 中注册。
- 部分 system handler 同时存在于可复用的 `server-core` 和 Electron 本地 GUI/main-process 层。新增运行时 channel 时，需要按场景检查两条注册路径。
- 不要提交生成文件或仅运行时文件，尤其是 `.playwright-mcp/`、打包后的 `dist/` 输出、日志和本地凭据。
- 添加新依赖前，优先使用本地 helper package 和已有抽象。
- 根文档应与实际 package 布局和支持命令保持一致。

## 许可证

本项目使用 Apache License 2.0。详见 [LICENSE](LICENSE)。

第三方 SDK 和服务可能有各自条款。尤其是 Claude Agent SDK 受 Anthropic 条款约束，Pi SDK/provider 使用受对应 provider 条款约束。
