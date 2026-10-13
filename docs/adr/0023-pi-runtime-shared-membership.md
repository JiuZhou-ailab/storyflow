# ADR 0023: Pi runtime 宿主与 shared 子域边界

状态：Proposed
日期：2026-10-13

推荐方案是新建 `@craft-agent/pi-runtime`，只迁出进程宿主；权限模式与 thinking level 契约留在 `packages/shared`。此结论需要用户决策后才能实施。本文不改代码，不授权迁包。

本决定不改变 ADR 0018：Pi `AgentSession` 仍是唯一 Agent Runtime，Storyflow 仍是 Product Host。这里只决定宿主适配代码放在哪个包。不新增第二套 runtime，因此不推翻 ADR 0006 的单一 Agent Kernel。

## 背景

`packages/shared/README.md` 的成员资格宪法要求同时满足两点：至少两个异构宿主消费，且模块是跨上下文契约或原语。子域之间禁止互相 import。新增或迁出顶层子目录都要先有 ADR。

`packages/shared/src/agent/` 同时装着两类东西。`thinking-levels.ts`、`mode-types.ts` 和 `modes` 是无进程副作用的契约。`pi-agent.ts`、`pi-agent-transport.ts`、`pi-agent-tool-host.ts`、`pi-agent-host.ts` 是 Pi 子进程宿主：`pi-agent.ts` 的文件头写明它 spawn `pi-agent-server`，用 JSONL 走 stdin/stdout。生产代码里 4 个文件引用 `node:child_process`，10 个文件引用 `node:fs`，`pi-agent-transport.ts` 调用 `spawn`。

`packages/pi-agent-server` 已是被拉起的子进程，不是父进程宿主。二者不能合成一个包。

## 事实

计数日为 2026-10-13，工作树基线 HEAD `9af9d940c`。下面每个数字都由对应命令在仓库根目录复现。`rg -l` 计文件，不计出现次数。

### 目录规模

```bash
rg --files packages/shared/src/agent -g '*.ts' | wc -l
rg --files packages/shared/src/agent -g '*.ts' -g '!*.test.ts' -g '!*.isolated.ts' -g '!**/__tests__/**' | wc -l
```

| 范围 | 文件数 |
| --- | ---: |
| `src/agent` 下全部 `.ts` | 105 |
| 其中生产文件（排除 `*.test.ts`、`*.isolated.ts`、`__tests__/`） | 47 |
| 测试文件 | 58 |

### 入向：谁 import `src/agent`

包说明符与相对路径分开搜，再取并集。`packages/shared/src/index.ts` 第 8 行只在块注释里举例，命令会命中它，计数时排除。

```bash
rg -l --glob '!**/node_modules/**' --glob '!**/dist/**' --glob '!packages/shared/src/agent/**' \
  "(?:from|import\\(|mock\\.module\\()\\s*['\"]@craft-agent/shared/agent(/|['\"\`])"
rg -l --glob '!**/node_modules/**' --glob '!packages/shared/src/agent/**' \
  "from ['\"](?:\\.\\./)+agent(?:/|['\"])" packages/shared
```

两条 `rg -l` 的并集去掉 `packages/shared/src/index.ts` 后是 **66** 个文件。其中路径匹配 `\.(test|isolated)\.ts$` 的是 **13** 个，生产文件 **53** 个。位置分布是对这 66 行做 `^<前缀>/` 计数：`apps/electron` 22，`packages/server-core/src/sessions` 16，`handlers` 6，`model-fetchers` 2，server-core 其余 3，`packages/shared/src/config` 7，`automations` 3，`sessions` 2，`workspaces` 2，`prompts`、`protocol`、`skills` 各 1。

非契约引用用下面的命令。它会多命中 `packages/shared/src/index.ts` 的注释，排除后是 **37**。66 减 37 是 **29**，即只引用 `thinking-levels`、`mode-types` 或 `modes` 的文件。37 里匹配 `\.(test|isolated)\.ts$` 的是 **11**。

```bash
rg -l --glob '!**/node_modules/**' --glob '!**/dist/**' --glob '!packages/shared/src/agent/**' \
  "(?:from|import\\(|mock\\.module\\()\\s*['\"](?:@craft-agent/shared/agent(?:['\"\`]|/backend|/pi-agent|/permissions-config|/core|/session-scoped)|(?:\\.\\./)+agent/(?:mode-manager|permissions-config|index|__tests__))" \
  packages apps
```

| 位置 | 文件数 |
| --- | ---: |
| `apps/electron` | 22 |
| `packages/server-core/src/sessions` | 16 |
| `packages/server-core/src/handlers` | 6 |
| `packages/server-core/src/model-fetchers` | 2 |
| `packages/server-core` 其余（`domain`、`mcp`、`services` 各 1） | 3 |
| `packages/shared/src/config` | 7 |
| `packages/shared/src/automations` | 3 |
| `packages/shared/src/sessions` | 2 |
| `packages/shared/src/workspaces` | 2 |
| `packages/shared/src/prompts`、`protocol`、`skills` 各 1 | 3 |
| 合计 | 66 |

这 66 个文件里，**29** 个只引用 `thinking-levels`、`mode-types` 或 `modes`。另外 **37** 个还引用 barrel、`backend`、`permissions-config`、`mode-manager`、`pi-agent`、`core` 或 `session-scoped-tool-callback-registry`。37 里有 11 个测试文件。其中 3 个生产文件只是 `import type { PermissionMode }` 来自 `mode-manager.ts`：`config/config-defaults-schema.ts`、`sessions/types.ts`、`workspaces/types.ts`。

`credentials` 入向为 0：

```bash
rg -l "from ['\"](?:\\.\\./)+agent(?:/|['\"])|@craft-agent/shared/agent(/|['\"\`])" \
  packages/shared/src/credentials
```

该命令无匹配。

直接点名四个宿主文件的外部 import 很少。生产代码之外只有 `packages/server-core/src/sessions/permission-response.test.ts` import `@craft-agent/shared/agent/pi-agent`。宿主能力主要通过 barrel `@craft-agent/shared/agent` 和 `backend` 出口。

### 出向：`src/agent` import 哪些 shared 子域

生产文件口径（排除测试）使用：

```bash
rg -l -g '!**/__tests__/**' -g '!*.test.ts' -g '!*.isolated.ts' \
  "from ['\"](?:\\.\\./)+SUB(?:/|['\"])|@craft-agent/shared/SUB(/|['\"])" \
  packages/shared/src/agent
```

把 `SUB` 换成子域名。根文件 `feature-flags` 用 `from ['\"](?:\\.\\./)+feature-flags(?:\\.ts)?['\"]`。

| 子域 | 生产文件数 | 全部文件数 |
| --- | ---: | ---: |
| config | 16 | 19 |
| utils | 15 | 17 |
| sources | 9 | 13 |
| sessions | 8 | 10 |
| prompts | 6 | 7 |
| workspaces | 6 | 6 |
| i18n | 4 | 4 |
| mcp | 4 | 4 |
| automations | 3 | 3 |
| credentials | 2 | 2 |
| skills | 2 | 3 |
| auth | 1 | 1 |
| mentions | 1 | 1 |
| protocol | 1 | 1 |
| writing | 1 | 1 |
| `feature-flags.ts`（根模块，非子目录） | 4 | 4 |

未出现在表中的 shared 子目录，上述命令结果为 0。

双向 import（生产代码）发生在 config、sessions、automations、prompts、protocol、workspaces。`credentials` 与 `auth` 只被 agent 引用，自己不引用 agent。

包外依赖（同一排除测试的 `rg -l`）：`@craft-agent/core` 9 个文件，`@craft-agent/session-tools-core` 12 个，`@earendil-works/pi-` 6 个。全部文件口径下 `node:fs` 是 29，因为测试也读盘；生产口径是 10。

## 判断

进入门槛的第一款成立：Electron main 与 server-core 都消费宿主能力，renderer 则主要消费契约。第二款不成立：子进程与文件系统实现不是跨上下文契约或原语。子域隔离也不成立：上表的出向加上反向 import，同一职责穿过多个子域。

因此不能把整个 `src/agent` 继续当成一个合格的 shared 成员，也不能整目录搬走。契约留下，宿主迁出。

## 方案

### A. 原位保留，只加 lint

步骤：在 `packages/shared/eslint-rules/` 增加一条子域规则，并在 `packages/shared/eslint.config.mjs` 以现有 `craft-shared` 插件方式登记；对包说明符再用 ESLint 自带的 `no-restricted-imports`。不搬文件。

影响：0 个运行时文件。现有 66 个引用方保持不变。

风险：隔离仍然只是新代码约束。16 个生产文件对 config 的出向和反向 import 都还在。规则上线时若直接 error，当前双向边会先失败，所以只能先 warn，或给现有边列清单。

回滚：删掉规则文件和登记。无数据与公共 API 变化。

### B. 新包 `@craft-agent/pi-runtime`（推荐）

步骤：

1. `thinking-levels`、`mode-types`、`modes` 留在 `packages/shared/src/agent`，路径不变。29 个只引用它们的文件不动。
2. 新建 `packages/pi-runtime`。迁入宿主与其直接实现（四个 `pi-agent*.ts`、`backend/`、权限执行、session tool host）。47 个生产文件是候选上限，契约文件不在迁移集里。
3. 改 37 个 runtime 引用方的 import。server-core 与 Electron 依赖新包；shared 的领域子域不得依赖新包。
4. 先断开双向边：shared 子域只留类型契约，宿主通过参数或 shared 里已有的显式接口读取 config、sessions、sources、workspaces。否则新包依赖 shared、shared 又依赖新包。
5. 旧的 `@craft-agent/shared/agent` 运行时出口保留一个再导出垫片，一个版本后删除。垫片是唯一兼容层。

影响：37 个引用方改路径；58 个 agent 测试中属于宿主的那部分随文件移动。`packages/pi-agent-server` 不动。

风险：垫片期间同一符号有两个出口。切分若把仍被 shared 值引用的函数一起搬走，会留下半迁移。权限 `mode-manager.ts` 同时含有 `PermissionMode` 类型和写盘，必须先拆开，不能整文件留或整文件走。

回滚：还原该迁移提交。垫片还在时，调用方不必二次改路径。

### C. 迁入 `packages/server-core`

步骤与 B 相同，落点改为 server-core。Electron 已经依赖 server-core，main 可以引用。renderer 不能为了模式枚举去依赖 server-core，所以契约仍须留在 shared。

影响文件数与 B 相同。

风险：server-core 已经依赖 shared。只要 config、sessions、automations、prompts、protocol、workspaces 仍 import 迁走后的模块，就形成 `server-core ↔ shared` 环。server-core 的职责是 WS/headless 基础设施，塞进父进程宿主后，所有 server-core 消费者都会带上 Pi SDK 与 `child_process`。这比 B 的环更难拆，因为落点包本身就是 shared 的消费者。

回滚：同样是还原迁移提交。环一旦进主干，还原前不能发布。

## 子域依赖规则（草案，不实现）

| 从 | 可以依赖 | 不可以依赖 |
| --- | --- | --- |
| 任意子域 | `utils`、`i18n`、`validation`、`colors`、`icons`、根上的 `branding` 与 `feature-flags` | 其他领域子域的实现 |
| 领域子域（`credentials`、`auth`、`config`、`sources`、`workspaces`、`sessions`、`skills`、`labels`、`statuses`、`automations`、`prompts`、`writing`、`resources`） | 上表原语，以及无副作用契约：`protocol` 类型、`mcp/types`、`agent/mode-types`、`agent/thinking-levels` | `pi-agent*`、`agent/backend`、`permissions-config` 的读写实现；不得依赖 `@craft-agent/pi-runtime` |
| `credentials`、`auth` | 原语与自己的类型 | `src/agent` 的任何实现文件。当前入向已是 0 |
| Pi runtime 宿主 | shared 的原语、契约，以及它真正需要的领域模块 | `server-core`、Electron、`pi-agent-server` 源码 |

强制方式分两层，都复用现成机制：

- 跨包说明符用 ESLint `no-restricted-imports`。`apps/electron/eslint.config.mjs` 已经用它禁止 main 直接 import `@craft-agent/shared/agent/pi-agent` 等旧后端路径。
- shared 内部的相对路径用新的自定义规则，放在 `packages/shared/eslint-rules/`，登记方式照 `no-direct-open-import.cjs`：CJS `RuleModule`，挂到 `craft-shared`。`packages/ui/eslint-rules` 只管 z-index 和阴影，不承载这条边界。

规则按“解析后的目标子目录”判断，不按字符串前缀。`import type` 同样算边，因为宪法禁止的是子域互相 import。现有双向边先列清单，不在本 ADR 里把它们一次性打成 error。

## 后果

未决策前，宿主继续留在 shared，隔离继续靠人工。决策采纳 B 之后，shared 不再因为 Pi 子进程改变依赖闭包；server-core 与 Electron 显式依赖 runtime 包。代价是要先拆 `mode-manager.ts` 的类型与写盘，并在一个版本内维持 barrel 垫片。

不采纳的部分：不把宿主放进 `pi-agent-server`，不把契约搬出 shared，不在本 ADR 中改 lint 或移动源码。
