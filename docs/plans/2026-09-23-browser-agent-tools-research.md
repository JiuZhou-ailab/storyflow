# Storyflow 浏览器 Agent 工具与插件调研

核查日期：2026-09-23。范围为官方文档、GitHub release tag、公开 API/包元数据；未安装候选、未实测 Electron 连接或 Agent 成功率。源码主分支与 release tag 分开记录，不能把本文视为生产兼容性验收。

状态：资料研究。随后进行的主任务实验与更新后的优先级见[浏览器复用方案评估](2026-09-23-browser-reuse-assessment.md)，其中已验证基础连接并发现旧 ref 的可见状态反例；本文“未实测”仅描述本资料研究阶段。

## 结论

建议把完整 Agent 工具候选收敛为 **agent-browser 0.38.1 与 Playwright MCP 0.0.82**，同时以项目已有自动化库方案作成本基线。先验证连接现有 Electron 页面与 Session 隔离，再比较定位成功率及适配代码量。最终只留一个执行器；不要同时内置多个浏览器 Agent，也不要复制其 snapshot/ref 引擎。

这是选型建议，尚不是最终选型：浏览器协议兼容不等于 WebContentsView 的完整支持，页面选择也不等于权限隔离。Electron 页面宿主、Storyflow Session 归属与 Pi 工具授权仍由产品拥有；成熟库负责页面观察与动作。项目 Accepted ADR 0018 指定 Pi 为唯一 Agent Runtime，因此重新引入自主 Agent 循环的方案不宜作为默认实现。

## 候选对比

| 候选 | 已核实能力与形式 | 成本 / 未证明边界 | 判断 |
| --- | --- | --- | --- |
| agent-browser | Apache-2.0；0.38.1 为 Rust CLI + Rust daemon，直接 CDP，CLI JSON 与内置 stdio MCP；结构化 snapshot + refs | 需要分平台 binary、daemon 生命周期与版本管理；不是可 import 的 TS 库；CDP attach 仍须验证 Electron target | 值得首轮实测，不能按旧 Node/Playwright daemon 架构排除 |
| Microsoft Playwright MCP | Apache-2.0；CDP endpoint、结构化 snapshot/ref；公开 `createConnection` 可接收现有 BrowserContext | context 范围不自动等于单个产品页面；0.0.82 包依赖 Playwright 1.64 alpha，需锁定整套版本；若为了适配大量改写工具 schema，复用收益会下降 | 与 agent-browser 同轮比较；保留原生语义优于摘抄内部源码 |
| Chrome DevTools MCP | Apache-2.0；Puppeteer 驱动，MCP/CLI，连接既有 Chrome，调试/性能能力完整 | 官方明确只支持 Chrome 与 Chrome for Testing，其他 Chromium 不保证；并不承诺 Electron；默认遥测需纳入产品配置审查 | 适合作开发诊断候选，不默认作为嵌入执行器 |
| Stagehand | MIT；TS SDK，LOCAL CDP attach，observe/act/extract、可缓存动作，也提供 agent() | 核心 AI 方法需要模型配置；增加推理成本、凭据和调用链；文档、主分支与发布版需要锁定对应关系，不能混用 | 只有基准证明语义定位收益足够时再引入 |
| browser-use | MIT；Python BrowserSession 可接 CDP，Agent 控制浏览器，包含模型供应商集成 | 新增 Python/依赖与另一套 Agent 生命周期；对当前 Pi 产品不是最短维护路径 | 不选为默认运行时；可作离线比较对象 |

上述事实来源：[agent-browser 0.38.1 README](https://github.com/vercel-labs/agent-browser/blob/v0.38.1/README.md)、[package](https://github.com/vercel-labs/agent-browser/blob/v0.38.1/package.json)；[Playwright MCP 0.0.82 README](https://github.com/microsoft/playwright-mcp/blob/v0.0.82/README.md)、[公开 API](https://github.com/microsoft/playwright-mcp/blob/v0.0.82/index.d.ts)、[依赖](https://github.com/microsoft/playwright-mcp/blob/v0.0.82/package.json)；[Chrome DevTools MCP README](https://github.com/ChromeDevTools/chrome-devtools-mcp)、[连接配置](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/configuration.md)；[Stagehand API](https://docs.stagehand.dev/v3/references/stagehand)、[release 3.7.3](https://github.com/browserbase/stagehand/releases/tag/%40browserbasehq%2Fstagehand%403.7.3)、[仓库](https://github.com/browserbase/stagehand)；[browser-use 仓库](https://github.com/browser-use/browser-use)、[Browser 配置](https://github.com/browser-use/browser-use/blob/main/skills/open-source/references/browser.md)、[Python 依赖](https://github.com/browser-use/browser-use/blob/0.13.10/pyproject.toml)。

## 两个容易误判的细节

1. **agent-browser 的 Session pinning 不是授权边界。** 官方 CDP 文档支持用 targetId 绑定页面及 `--pin-tab`；被绑定页面关闭时返回 `tab_gone`，避免静默操作邻页。但初次无绑定会新开页，必须验证怎样绑定 Storyflow 已创建的目标；CLI 仍可主动切换 target。产品不能把完整 Electron 调试端口或任意 tab 命令无约束交给模型。连接已有 Electron 时不用下载第二份 Chrome；发行包仍须锁 binary 并验证 macOS/Windows。[CDP 模式](https://agent-browser.dev/cdp-mode)、[Sessions](https://agent-browser.dev/sessions)
2. **有 refs 不等于高准确率已获保证。** refs 减少模型猜 CSS selector 的负担；动态 DOM、同名按钮、过期 refs、iframe、遮挡与切页依然要测试。agent-browser 文档提供精简 snapshot 和交互元素过滤；Playwright MCP 同样提供结构化快照。二者都不应替产品决定错误页面上可以执行动作，也不应在超时后盲目重放提交。[Snapshots](https://agent-browser.dev/snapshots)、[Playwright MCP](https://github.com/microsoft/playwright-mcp)

## 最小有判别力的选型验收

### agent-browser 发布版源码补充

0.38.1 的 `resolve_element_center` 与 `resolve_element_object_id` 先解析缓存的 backend node；失败后会重新按 role/name/nth 找节点。这是可恢复定位策略，**不是旧 ref 对节点身份的严格保证**。同名业务项在快照后被替换或重排，是首轮必须实测的反例；不能仅凭 README 的 deterministic 描述宣称不会点错。[发布版 element.rs](https://github.com/vercel-labs/agent-browser/blob/v0.38.1/cli/src/native/element.rs#L399)

复现实验可按发布文档从专用 `--session`、`--cdp <port>`、`--pin-tab`、`tab <targetId>` 开始，再 `snapshot -i --json` 与 `click @eN`。初次连接是否产生额外页、退出是否只断开外部宿主、选页前是否触及应用 shell 均需观察，不把命令建议当成已经验证的集成方法。Browser 级 CDP 默认暴露多个 target；pin-tab 不会隐藏 shell，也不禁止主动切页。若要限制 target，必须证明所选公共连接面支持所需范围，不能把 prompt 提示当隔离。

以既定“真实 Electron 右侧网页标签 + browser_tool”为唯一主验收入口，同一组页面、同一模型、同一任务预算进行比较：

- 证明用户与 Agent 操作同一个 WebContents：人工输入后 Agent 读取，Agent 填写后用户可见；不用 URL 猜目标。
- 两个 Session 同时打开相同 URL；用户换标签、目标关闭、daemon/连接重建后，不得误操作另一页；越权目标必须拒绝。
- 动态列表重排、同名按钮、iframe、弹窗与覆盖层：正确命中，或明确拒绝/请求新快照；统计任务成功、错误操作、重试与 token/耗时。
- 保留上传下载及 popup 归属的端到端样例；disconnect/close 不误关主窗口，不泄露无主资源；打包后不要求用户临时装 Node/Chrome/浏览器插件。
- 记录新依赖、产物体积、进程数、适配代码与对非公开 API 的依赖。先过同页与隔离硬门槛，再按任务成功率和维护成本选择，不用 stars 或供应商 benchmark 替代本项目证据。

本资料研究本身没有证明某个候选“准确率最高”或“已支持 Storyflow WebContentsView”；随后最小实验已证明部分基础能力，完整产品结论仍须由首张验证票交付，见方案评估。
