# 右侧浏览器复用方案：研究与最小实测

状态：选型前评估，尚未实施功能或完成产品验收。适用快照：2026-09-23，仓库 HEAD `f2100057b`，macOS arm64，Electron 39.2.7 / Chromium 142.0.7444.235。任务来源为 #55 拆票前复核；本文提出修订，不自动修改已发布规格或授权发布子票。

本文保留研究阶段的判断与授权状态。随后 #55/#56 已发布，用户已授权实施；当前实施证据及未通过的门禁见[实施门禁报告](2026-09-23-browser-implementation-gate.md)，规格以 GitHub Issues 为准。

## 判断

右侧工作区使用 Electron 官方 WebContentsView、用户与 Agent 共用同一页面，这个方向成立。原方案只比较 playwright-core / puppeteer-core、预先禁止 daemon、强制保留字符串 browser_tool 作为最终形态，研究范围不充分，容易把成熟工具已经提供的 snapshot/ref/schema 再做一遍。

下一轮产品原型优先验证 **Playwright MCP 的公开进程内接口**。本次已证明它可连接既有 WebContentsView，直接提供快照引用、填写与点击，并在节点被替换后拒绝旧 ref。保留 agent-browser 作为完整工具候选，但目前有旧 ref 返回成功而可见页面未改变的反例，不能直接作为高准确率默认执行器。若完整工具无法以少量公共接口限定到授权页面，则回退到 playwright-core 的 page 级适配；puppeteer-core 是已验证可连接的另一库级基线。

这不是“Playwright MCP 已可上线”的结论。最关键的待证事项是 **页面授权范围**：所有本次默认 browser-level CDP 接入都能枚举应用 shell 和网页 target，MCP 的 BrowserContext 与 Storyflow Session 不是同一个概念。不得通过隐藏列表或 prompt 代替真实访问控制，也不应为了复用工具制造一套庞大的自研 CDP 代理。

## 已核查的候选及来源

| 候选 | 适用部分 | 当前判断 |
| --- | --- | --- |
| Electron WebContentsView | 页面嵌入、Chromium、原生事件 | 保留；无需另一份浏览器引擎。[官方 API](https://www.electronjs.org/docs/latest/api/web-contents-view) |
| Playwright MCP 0.0.82 | 完整 Agent snapshot/ref/动作工具，公开 createConnection | 首选产品原型；可进程内使用，需锁定其 Playwright alpha 依赖并证明授权范围。[公开 API](https://github.com/microsoft/playwright-mcp/blob/v0.0.82/index.d.ts)、[包依赖](https://github.com/microsoft/playwright-mcp/blob/v0.0.82/package.json) |
| agent-browser 0.38.1 | Rust CLI/daemon、JSON、MCP、快照引用、目标 pin | 完整工具备选；无需第二份 Chromium，但有二进制打包/进程管理及旧 ref 语义成本。[发布版](https://github.com/vercel-labs/agent-browser/blob/v0.38.1/README.md) |
| playwright-core 1.63.0 | typed Page/Locator、等待、iframe、导航 | 已通过基础连接与动作；若直接选库，Agent refs/schema 仍要另找成熟实现或维护适配，不能把它与完整工具视为同一层。[CDP API](https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp) |
| puppeteer-core 25.11.0 | Chromium CDP、Page/Locator | 同样通过基础动作；并不自动交付 Agent 工具契约。[连接](https://pptr.dev/api/puppeteer.puppeteer.connect)、[交互](https://pptr.dev/guides/page-interactions) |
| Chrome DevTools MCP | 调试、性能与 Chrome 自动化 | 官方支持范围是 Chrome / Chrome for Testing，不默认承诺 Electron；不作为本产品首选。[官方仓库](https://github.com/ChromeDevTools/chrome-devtools-mcp) |
| Stagehand | AI observe/act/extract 与 Agent 能力 | 需要另计模型调用与编排成本；当前 Pi runtime 中不作为确定性执行层首选，不意味着 SDK 所有方法都要求另起 Agent。[官方仓库](https://github.com/browserbase/stagehand)、[API](https://docs.stagehand.dev/v3/references/stagehand) |
| browser-use | Python BrowserSession 与浏览器 Agent | 可连接 CDP，但整套默认方案增加 Python/Agent 生命周期，当前优先级低；不排除以后单独比较局部能力。[官方仓库](https://github.com/browser-use/browser-use) |
| electron-tabs | 标签 UI 与 webview 封装 | 官方已停止维护并归档，基于 webviewTag；本项目已有标签布局，不引入。[官方 README](https://github.com/brrd/electron-tabs) |
| electron-browser-shell | 完整 Electron 浏览器示例、扩展支持包 | 可参考，不整体搬入。项目重点是 Chrome 扩展，README 仍列未完成的权限支持，部分包采用区别于 MIT 的许可，超出当前标签浏览范围。[官方 README](https://github.com/samuelmaddock/electron-browser-shell) |
| puppeteer-in-electron | Electron / Puppeteer glue | npm 最新 3.0.5 发布于 2021-06-29，仓库 API 查询 pushed_at 为 2023-03-04；不能因名称匹配就作为当前兼容性保障。[仓库](https://github.com/TrevorSundberg/puppeteer-in-electron)、[包元数据](https://registry.npmjs.org/puppeteer-in-electron) |
| electron-playwright-helpers | Electron 测试辅助 | 适合测试菜单、原生 dialog 等，不是生产网页自动化或浏览器宿主替代品。[官方 README](https://github.com/spaceagetv/electron-playwright-helpers) |

更详细的发布版源码/许可证与工具成本见[工具调研](2026-09-23-browser-agent-tools-research.md)。未以 stars 或厂商 benchmark 代替本项目准确率。

## 实测方法与结果

所有新 npm 依赖仅安装到临时研究目录，没有修改仓库 package.json / lockfile。使用仓库现有 Electron binary，独立 userData 与本地 HTTP 夹具，不加载用户 Storyflow 数据，不访问真实登录或付费网站。宿主包含一个模拟应用 shell 和一个原生 WebContentsView；跨 origin iframe 使用不同端口。主进程通过独立验证入口读取实际 DOM，避免只相信自动化工具的 success。

| 执行器 | 版本 | 实测结果 | 尚不能推断 |
| --- | --- | --- | --- |
| Playwright core | 1.63.0 | 可见窗口 3/3：发现既有 WebContentsView、填写/点击、延迟元素、跨 origin iframe、open shadow DOM、popup 关闭、截图均通过；连接耗时 6–29 ms | 真实 Storyflow 所有启动路径、打包产物、目标隔离和所有站点兼容 |
| Puppeteer core | 25.11.0 | 相同可见场景 3/3 通过；连接耗时 2–7 ms | 不构成性能胜负结论或长期稳定性保证 |
| Playwright MCP | 0.0.82 / 内部 Playwright 1.64.0-alpha-1789764292000 | 使用 createConnection + 内存 MCP transport，真实 list/select/snapshot/fill/click 闭环通过；主进程验证当前输入值及点击计数；替换同名输入节点后旧 ref 明确报错，当前值保持空 | 仅一次定向 smoke；未运行真实 LLM、全量矩阵、并发和平台验收 |
| agent-browser | 0.38.1 | 显式固定 CDP + targetId + pin 后，既有页面 snapshot/ref/fill/click 通过；关闭目标后返回 tab_gone，不回退应用 shell | pin 不是授权；节点替换反例未通过严格成功语义门禁 |

### 有判别力的反例

**旧引用与可见状态。** 两种完整工具均先获得 Name 输入框引用，再由页面替换为新的同名输入框。Playwright MCP 返回 `Ref e3 not found in the current page snapshot`。agent-browser 返回 `success: true` / `filled: @e5`，但独立读取当前输入框值仍为空。本次观测是“成功反馈与可见状态不一致”，不能声称已证明它写入了另一个业务对象。其发布源码另有 backend node 失败后按 role/name/nth 回退的分支，因此同名列表重排仍需加入正式反例。[发布源码](https://github.com/vercel-labs/agent-browser/blob/v0.38.1/cli/src/native/element.rs#L399)

**隐藏窗口。** 初始 `show:false` 的夹具中，两种 core 库均能连接并填写，但 click 的 actionability/stability 等待超时；改为 `showInactive()` 的可见窗口后通过。这不能归为库不支持 Electron，也没有证明所有后台标签均失败；它说明 hidden、minimized、detached 与渲染调度应分别纳入宿主契约，不可用 force-click 掩盖。

**连接身份。** agent-browser 在首次 `connect` 后不持续传 CDP 的一次试验中，后续列表只出现独立 about:blank，未操作目标 Electron。之后每次传相同 `--cdp`、按 targetId 绑定即可通过。实际连接漂移原因尚未定位，不能仅凭 `browserLaunched:true` 判定新开浏览器：源码这个字段也覆盖 attached 状态。调查过程中未发现继承的 AGENT_BROWSER_* 环境变量；因此“环境覆盖导致”只是候选解释，不是已确认根因。产品不得依赖隐式连接记忆。

**历史握手故障。** Accepted ADR 0001 与旧 harness 记录的握手挂起是历史实测。本次当前版本最小 Electron 夹具中，Playwright 与 Puppeteer 的连接均成功。两者条件不同；既不能继续说 Playwright 普遍不可用，也不能据此删除历史 ADR 或改造整个性能 harness。

实验中还修正了两个测试自身问题：iframe/popup 服务最初未显式设置 HTML Content-Type；MCP 首次请求用了旧 ref 参数名，实际安装版公开 schema 要求 target。最终结果来自修正后的有效夹具与发布版 schema；这些不是候选库故障。

## 对规格和拆票的必要修正

1. **扩大成熟复用层级。** 第一张票先验证 Playwright MCP/agent-browser 等完整工具的集成成本，再与 core 库比较；不从“自己包装低层库”出发默认重做 refs。仅在隔离或契约限制确实无法低成本满足时降到库级。
2. **把隔离前置。** 第一张票就包含两个 Session 的同 URL 页面、应用 shell 不可访问、目标关闭/切换和 popup 归属。原生 pin 或 BrowserContext 参数本身不能作为授权证明；不能把这项风险推到第五张票才发现。
3. **工具入口服从复用收益。** 优先通过现有 Pi 工具分发复用上游原生 typed schema。browser_tool 是现有消费者兼容责任，不必成为永久字符串解析平台；若原生 MCP 明显减少维护，记录有退出条件的迁移并保留旧消费者，不同时暴露两套竞争执行器。这是对 #55 的待确认修订。
4. **比较真实生命周期成本。** 不预设禁止受控 daemon；仍排除第二份浏览器、另一套自主 Agent runtime、私有 API/fork 和不受保护的调试入口。Playwright MCP 的当前 alpha 依赖需要明确锁版和升级 smoke，agent-browser 的分平台 Rust binary/daemon 需要退出清理与配置固定。
5. **避免无谓大迁移。** 票 2 的必要局部 prefactor 只拆“网页自动化”与“宿主呈现”；先迁移可验收闭环，再按实际调用方删除替代实现。现有浏览器管理模块 3241 行、CDP helpers 1061 行，另有 CLI 命令解析层；仅包一层新库而全部保留旧职责，不能算降低维护成本。

临时六张草案已修订首票与工具接入票，尚未发布。父 Issue #55 未修改；上述三项架构约束变化需要先在规格层达成一致，不能让子票与父规格暗中冲突。

## 补充：Codex 架构材料的证据边界与 Storyflow 映射

用户提供的 Codex 架构分析强调资源与呈现分离，这适合作为设计原则；其五层组件图和 TypeScript 模型是推断，不是已公开验证的完整实现。

| 材料中的判断 | 核查后的结论 |
| --- | --- |
| 用户和 Agent 操作同一真实页面 | 官方帮助确认共享页面及独立浏览器状态；没有公开内部类图。[官方帮助](https://help.openai.com/en/articles/20001277-using-the-built-in-browser-in-the-chatgpt-desktop-app) |
| 逻辑 tab 对应 guest WebContents | 用户提交日志确有 `iab createTab mapped page to tab` 与 webContentsId；可借鉴显式身份映射。[#33514](https://github.com/openai/codex/issues/33514) |
| guest WebContents 意味着 WebContentsView | 不成立。日志不足以区分宿主实现，另有用户声称打包代码使用 `<webview>`。Storyflow 选 WebContentsView 的依据应是 Electron 官方建议与本机实测。[用户观察](https://github.com/openai/codex/issues/34239#issuecomment-5585654318)、[Electron 建议](https://www.electronjs.org/docs/latest/api/webview-tag) |
| native pipe 证明权限隔离 | 仅证明相关运行时能力/连接问题，不能证明端点鉴权、方法授权或不存在其他 CDP 入口。pipe 是传输，授权是另一职责。[#20248](https://github.com/openai/codex/issues/20248) |
| debugger 日志证明完整 CDP 能力和视觉兜底策略 | 核查票中存在 debugger listener、CDP 方法路径，但未找到材料所引 `Runtime.evaluate` 的直接证据，更不能推导所有协议域和视觉使用比例。[#23267](https://github.com/openai/codex/issues/23267)、[#34239](https://github.com/openai/codex/issues/34239) |
| browse 状态证明 Human/Agent 独占控制协议 | 单个状态字段不能证明取消、排队或接管语义。页面可见却没有 Agent route 的报告反而说明呈现与可操作性应分别验收。[#47270](https://github.com/openai/codex/issues/47270) |

关闭、恢复、GPU 故障等报告可转成生命周期测试案例，但没有充分证据归为同一根因。[恢复报告](https://github.com/openai/codex/issues/35637)、[route/window 状态报告](https://github.com/openai/codex/issues/29585)、[GPU 报告](https://github.com/openai/codex/issues/32094)。本文没有独立审计 Codex 打包源码。

### 复用现有链路，只改变必要职责

当前代码已经是 Pi tool request → Host session-scoped callback → BrowserPaneManager → BrowserCDP → 真实网页。Pi 子进程已有 `tool_execute_request` 通道，Host 从自身 Session 获取 callback，而非让模型决定请求身份。因此不需要再增加 Node REPL、native pipe 或第二套 Agent runtime。

可核查入口：`packages/pi-agent-server/src/pi-tool-runtime.ts` 的 requestHostTool、`packages/shared/src/agent/pi-agent-tool-host.ts` 的 browser_tool 分支、`packages/server-core/src/sessions/browser-pane-bridge.ts` 的 wireBrowserPaneTools、`apps/electron/src/main/browser-pane-manager.ts` 的 instances/createForSession/setAgentControl。

最小职责划分：

- **Product Host**：复用现有实例注册表，管理 tab 身份、Session 归属、目标存活、控制交接和销毁；维护 WebContentsView 的挂载与 bounds。
- **成熟执行器**：优先验证 Playwright MCP，承担 snapshot、引用、定位、等待与动作；Host 必须限制其可访问目标，不能只过滤对 Agent 展示的列表。
- **右侧工作区**：复用布局与标签 UI，呈现 Host 状态，提交导航/选中/关闭意图；React 卸载不等于销毁页面。
- **Pi**：沿用现有工具分发、权限和产物链路；只看到授权工具和逻辑 tab，不直接取得 Electron 对象或全局调试端口。

现有 createForSession 返回首个匹配实例，且会自动复用未绑定的手工窗口。多 tab 不能继续以“当前窗口/第一个实例”代替明确目标；跨 Session 领取手工页面应有明确产品行为。现有 setAgentControl/clearAgentControl 管理 overlay 和窗口锁状态，不能仅凭它们断言在途命令已取消。

### 保持四个正交维度，避免通用资源平台

| 维度 | 最小责任 |
| --- | --- |
| 归属 | 稳定 tabId 与现有 ownerSessionId；授权身份由 Host 推导。无需复制一套 BrowserSession/threadId，也不能强制 Free Conversation 具有 projectId。 |
| 呈现 | 挂载窗口、bounds、用户选中 tab；用户切标签不应悄悄改变已发出的 Agent 命令目标。 |
| 控制 | 当前控制者与取消边界；接管时停止后续派发并等待/处理在途操作。generation 检查只能拒绝迟到结果，不能撤销已送达 Chromium 的点击。 |
| 运行时绑定 | tab 对应的 WebContents/Page/target 及其存活代次；这些对象保留具体类型，不压成无法表达生命周期的 runtimeHandle 字符串。 |

这里的“浏览器不知道 Agent”应限定为底层 Chromium/执行器不依赖 Pi；Host 仍须知道 Session 授权与控制状态。浏览器 cookie partition 是登录状态维度，与任务 tab 归属分别决策，不能默认为每个任务重建独立登录环境。

暂不引入统一 Browser/Canvas/Terminal/Editor 的 InteractiveResource、跨进程通用 lease 或可切换云浏览器平台。它们目前没有共同且已验证的生命周期合同；本地页面、文件编辑与终端进程的持久化/关闭语义不同。稳定工具契约能降低以后更换执行器的成本，不保证登录、文件传输、权限和呈现可无痛迁移。

### 收敛后的首个验证目标

用两个 Session 的同 URL 页面及应用 shell，验证 Agent 只能操作所属 tab；随后验证用户切页/隐藏再挂载、旧 ref、目标关闭和用户接管时的排队/在途动作。成功标准包含独立读取真实页面状态，不只看工具 success。接管完成后旧操作不得再输入；接管前已发生的动作如实反馈，不能宣称已回滚。

若 Playwright MCP 仅通过公共接口无法低成本完成目标限制，就降到 page 级库适配，不为保住选型引入私有接口、fork 或庞大 CDP 网关。现有 webContents.debugger 是页面 CDP 传输，不能未经验证当作 browser-level connectOverCDP 的直接替换。

本补充只更新研究判断，不改变 #55 或发布子票。已批准的真实 Electron + 现有 browser_tool 验收边界继续保留；工具接口迁移是另一个待确认决定。

## 证据与复跑

临时实验目录：`/tmp/storyflow-browser-research-20260923`。

- `electron-fixture.cjs`：隔离的 Electron 原生网页夹具与独立主进程验证入口。
- `probe.mjs` / `results.json` / `results-hidden.json`：两个 core 库的可见与隐藏结果。复跑：`PROBE_VISIBLE=1 node /tmp/storyflow-browser-research-20260923/probe.mjs`。
- `mcp-probe.mjs` / `mcp-results.json`：公开进程内接口和旧引用反例。复跑：`node /tmp/storyflow-browser-research-20260923/mcp-probe.mjs`。
- `agent-browser-probe.mjs` / `agent-browser-results.json`：现有页面绑定、旧 ref 与 tab_gone。复跑：`node /tmp/storyflow-browser-research-20260923/agent-browser-probe.mjs`。

实验脚本为本机临时研究材料，不是新增产品接口或常驻测试基础设施；清理临时目录后需重建。记录中的通过率只描述这些本地 smoke，未达到 #55 的完整 10 次矩阵、真实 Agent 与 macOS/Windows 产物门禁。当前足够纠正方案和排序候选，尚不足以宣称最终执行器已选定或任意网页高准确率。
