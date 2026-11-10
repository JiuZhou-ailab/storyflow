# Managed model fallback QA (Spec #41)

No paid provider is required. Keep production credentials and user settings out of
these fixtures. Runtime acceptance uses real Pi AgentSession instances against
loopback HTTP; only the external provider response and clock are controlled.

The approved chat families now carry explicit `fallbackCapabilities` in
`MANAGED_MODEL_CATALOG`. Gateway `/v1/models` publishes them, the authenticated
catalog refresh validates/persists them, and both runtime creation and refresh
use the same Pi projection. Missing capabilities still exclude a candidate;
discovery never approves a new family. Tests use these product declarations,
not only synthetic fixture metadata.

Capability evidence checked 2026-09-16 (output limits and function/tool calling):

| Models | Declared output ceiling | Primary sources |
| --- | ---: | --- |
| GPT-5.5, GPT-5.6 Sol/Terra/Luna | 128,000 | [5.5](https://developers.openai.com/api/docs/models/gpt-5.5), [Sol](https://developers.openai.com/api/docs/models/gpt-5.6-sol), [Terra](https://developers.openai.com/api/docs/models/compare), [Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna) |
| Claude Sonnet 5 / Opus 5 | 128,000 | [Sonnet](https://platform.claude.com/docs/en/models/sonnet-5/whats-new-sonnet-5), [Opus](https://platform.claude.com/docs/en/models/opus-5/whats-new-opus-5), [tool use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview) |
| Gemini 3.5 / 3.6 / 3.7 / 3.8 Flash | 65,536 | [3.5](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash), [3.6](https://ai.google.dev/gemini-api/docs/models/gemini-3.6-flash), [3.7](https://ai.google.dev/gemini-api/docs/models/gemini-3.7-flash), [3.8](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash) |
| DeepSeek V4 Flash / Pro | 384,000 | [API model details](https://api-docs.deepseek.com/quick_start/pricing/) (conservative interpretation of 384K) |

DeepSeek documents `deepseek-v4-flash` as a retained alias now served by V4.1
Flash; do not infer image equivalence with Pro. Storyflow's existing text-only
DeepSeek contract remains unchanged. These declarations describe documented model
capability, not live NewAPI route availability or verified production health.
A route that changes model identity/limits must update its declaration or be
excluded. `structuredOutput: prompt` records Storyflow's existing prompt-based
schema path; it does not enable native strict-schema mode.

Parent and subagent requests follow Pi's native model output capacity and
remaining-context limits, including after fallback. Storyflow adds no global
8192-token cap. Explicit per-call budgets (such as `call_llm`) remain separate.

## Catalog retirement and Flash connectivity (2026-09-23)

Gemini 3.5, 3.6, 3.7 and 2.5 Flash are retired from Storyflow's managed catalog.
Local retirement policy applies both to persisted account catalogs and live gateway
refreshes, so an older deployed gateway cannot restore them. Account-scoped empty
catalogs remain empty. Earlier capability tables above are historical evidence.

The UI labels the retained `deepseek-v4-flash` route as DeepSeek V4.1 Flash.
A minimal authenticated request through the deployed Storyflow gateway returned
HTTP 200, `OK`, `finish_reason=stop`, and model `deepseek-v4-1-flash-260910`
(33 prompt + 17 completion tokens). The guessed ID `deepseek-v4.1-flash` was
rejected by the gateway with HTTP 403 and was not forwarded upstream. Official
[model documentation](https://api-docs.deepseek.com/quick_start/pricing/) names
`deepseek-flash` and retains `deepseek-v4-flash` as a V4.1 compatibility alias.
This verifies a text completion through the existing route, not tools, images,
load handling or the upstream model's internal identity.

## Automated checks

```sh
bun test packages/pi-agent-server/src/managed-fallback.test.ts packages/pi-agent-server/src/managed-access-contract.test.ts
bun test apps/model-gateway-worker/src/index.test.ts apps/model-gateway-worker/src/upstream-error.test.ts
bun test packages/pi-agent-server/src/provider-hooks.test.ts packages/pi-agent-server/src/subagent-tool.test.ts packages/pi-agent-server/src/pi-sdk-boundary.test.ts
bun run typecheck:all
```

The runtime suite verifies all four native protocols; A,A,B recovery; shared retry
budget; permanent rejection with nonzero provider retry budgets; Retry-After/cancel; partial text/reasoning/tool args;
exactly-once committed tool results; cooldown through resource reload; lazy recovery;
manual selection races; independent parent/two subagents/mini-query state; actual
model persistence; legacy history; fixed mini-model and custom-provider exclusion.

A Model Call ID is stable across its retries and model substitution. A successful
tool-use assistant message closes it; the next generation gets a new ID. Request
headers use correlation version 2, separate Pi retry index and transport attempt.
Provider-internal retries also increment transport attempt. Missing legacy fields
remain unknown. HTTP `phase: headers` is not generation completion; use Pi
`model_stream_end.outcome` and `stop_reason`. Unknown cost is logged as null.

## Renderer QA

1. Run `bun run --cwd apps/electron dev --host 127.0.0.1 --port 5189` and open
   `http://127.0.0.1:5189/playground.html`. Choose **Settings → Managed Fallback**.
2. Confirm default switch on, exactly one localized fallback notice, and
   `deepseek-v4-pro` on the completed response. This uses the actual renderer
   components and a local-only connection-save stub.
3. Turn the switch off; reload the page; confirm it remains off. Turn it back on.
   The fixture uses only the `storyflow-fallback-playground` localStorage key.
4. In an isolated desktop QA profile, repeat against the loopback fixture:
   select primary, trigger A,A,B, verify the selector remains on preferred A,
   the completed response shows B, and history still shows B after restart.
5. Trigger Retry-After then Stop; verify one terminal settlement, no new requests,
   and no hanging retry/busy state. Disable fallback and verify native retries
   remain on A. Auth-generation replacement must cancel old operations.

## Evidence from 2026-09-16

- Full repository test command: 5,829 pass, 11 skip, 0 fail, including isolated
  suites. `typecheck:all`, Pi executable build and all three i18n checks passed.
- Actual renderer Playground checked with ego-browser: default enabled, switch
  off persisted after reload, restored to enabled; one notice and the effective
  model badge rendered. The fixture made no provider calls.
- Independent review exposed cancellation inside awaited model selection and
  cooldown `requested_model` attribution. Both have real-session regressions;
  synchronous retry-event cancellation and config-generation replacement are
  also covered. Empty HTTP 200 streams fail across all four protocols.
- After review fixes, 42 real-session runtime cases pass, including dispose
  cancellation and rejection of unknown capabilities. Host-to-ModelRuntime
  registration tests distinguish declared limits from the synthetic default.
  Final targeted run: 212 pass, 0 fail across Pi, gateway and preference storage.
- Native desktop restart/Stop QA (steps 4–5 above) and production observation have
  not been run. Loopback runtime and renderer checks cover their separate seams.

## Release boundary

These checks do not establish production recovery. Before an authorized release,
refresh the Luna/403/524/Worker CPU observation window and deployment version.
Compare final generation completion, transport attempts per logical call, fallback
recovery and header/first-content latency. Never equate HTTP 200 with completion,
and never create paid probes merely to fill a production metric.

## #72：收回线上目录 v2 与客户端协商

恢复依据是 `recovery/model-gateway-4bbd696a` 分支提交
`b37e418db4f58e5c2cc3ad5ca2fa362b73efdc1c` 的原始 Worker 存档；文件为 multipart
下载内容，SHA256 为 `7f4b32211f87d73606afa8e81e8613aedd15b3fffcdca6c4562492fd540215b6`。
共享目录恢复该版本的模型元数据、六项退役规则和 v2 发现协商。历史模型的协议归属仍保留，
用于保持存档中的旧会话请求兼容；退役模型不会进入目录或新客户端的内置种子。
main 已有的当前权限检查与上游错误规范化继续适用。

0.26.2 最终批准阵容（每系列两项）：发起人已由监督方
[书面确认](https://github.com/JiuZhou-ailab/storyflow/pull/80#issuecomment-6757562544)，
八项均在 [CI run 42743325242](https://github.com/JiuZhou-ailab/storyflow/actions/runs/42743325242)
完成原生协议真实生成调用；此 run 使用 `deploy=false`，未部署生产。

| 系列 | 已发布 0.26.0 / 0.26.1 | 新客户端（拟随 0.26.2 发布） |
| --- | --- | --- |
| GPT | `gpt-5.6-sol` | `gpt-6.1-sol`、`gpt-5.6-sol` |
| Claude | `claude-sonnet-5` | `claude-sonnet-5`、`claude-opus-5-5` |
| Gemini | `gemini-3.8-flash` | `gemini-3.8-flash`、`gemini-4-argon` |
| DeepSeek | `deepseek-v4-pro`、`deepseek-v4-flash` | 同左 |

以上集合还要与账号当前授权取交集。存档中的动态 `gemini-3.6-*` 非退役模型发现规则仍然保留，
若上游返回此类 ID，也必须通过逐模型门禁；上表不是完整上游清单。
按发起人决定，Terra/Luna/Haiku 不进入 0.26.2；待给出上游 ID 后另行更新 gateway，
不恢复已退役 ID。监督方已[确认该决定满足本 PR 的最终阵容要求](https://github.com/JiuZhou-ailab/storyflow/pull/80#issuecomment-6757742218)。

根因：gateway 在认证目录中先去掉退役项，再把三个 `minimumCatalogVersion: 2` 模型仅返回给
`x-storyflow-model-catalog-version: 2` 客户端。旧桌面没有该请求头，服务端返回的 GPT/Claude
各只剩一个，Gemini 4 也不可见。客户端按连接协议接收账号目录，不通过内置目录补全；系列菜单
没有被证明是这次截断的原因。单独重部署旧 main 会撤掉线上 v2，而单独加请求头也不足以验证
新模型调用：Pi 的 Gemini 4 原生思考格式和 Claude Opus 5.5 自适应思考元数据需同步支持。

新客户端在托管目录请求中协商 v2；自定义供应商不参与此协商。当前 Pi 0.87.1 已具备 Responses
工具 call/item ID 的原生回放能力，通过 loopback HTTP 回归验证，不添加消息历史清洗器。
对退役的既有模型首选仅选择同系列、账号目录已有的替代项；Claude Opus 5 优先使用
`claude-opus-5-5`，没有时使用已有的 `claude-sonnet-5`，兼容升级刷新前的旧缓存、离线使用及
只授权 Sonnet 的账号。二者都没有时失败，
不添加模型、不覆盖自定义连接。有效空目录、失败缓存和首选保留沿用既有刷新语义。

生产操作与门禁：

1. 本 PR 不修改 workflow，不部署生产、不发布客户端。App 不具备 Actions dispatch / workflows 写权限。
2. 监督方已在 PR 分支触发 `deploy-managed-auth.yml`，`deploy=false`、
   `verify_skills_market_auth=false`。现有 workflow 已将 broker 响应写到
   `$RUNNER_TEMP/token-response.json`；`verify-managed-model-catalog.ts` 用进程内 capability
   重新请求 v2 目录，验证完整元数据与旧客户端目录，再使用与桌面相同的 `PiModelRuntime`
   对目录中的**每一项**进行原生生成调用。只接受真实文本，失败/中断/空输出均阻止通过。
   该脚本不记录 token、请求正文或上游错误正文；每项只打印 ID、协议和结果。
3. 门禁支持 `MODEL_ACCESS_TOKEN_RESPONSE_PATH` 显式指定临时 broker 响应路径；默认路径严格对应
   现有 workflow 的同目录文件约定。不要把 capability 文件保存到 PR、artifact 或仓库。
4. 八项真实调用与最终阵容确认已有上述独立证据。Claude 退役选择修复不改变目录、模型元数据或
   CI 原生调用路径，复用该 run；本地 loopback 回归仍只证明各自的兼容分支，不代替线上调用。
   后续任何阵容/协议变更仍须重新逐项验证。
5. PR 合并后由监督方执行 `deploy=true`；不要回滚到没有 v2 的旧 main gateway。
   发起人用已安装的 0.26.0/0.26.1 验证旧目录未变，再用新客户端验证完整系列菜单、模型选择、
   请求路由、旧配置升级及重启。[本轮评审已确认](https://github.com/JiuZhou-ailab/storyflow/pull/80#pullrequestreview-5836127201)
   实机菜单复核留在部署之后，不要求本轮返工补 UI 截图。

本改动不把线上目录无条件复制到客户端，不绕过账号授权，也不引入新的远程目录服务。
新客户端已有的响应解析会保存服务端元数据和未知模型 ID，因此不妨碍 #73；需要新增原生协议能力
时仍须通过版本协商保护旧客户端。
