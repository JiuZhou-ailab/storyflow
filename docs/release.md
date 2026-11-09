# 发版与撤回操作手册

适用于桌面正式版；从仓库根目录执行命令。事实源是 [Release workflow](../.github/workflows/release.yml)、[Validate](../.github/workflows/validate.yml)、[Windows installed startup](../.github/workflows/windows-startup.yml)、[R2 上传脚本](../scripts/upload-r2-release-assets.ts)。本说明不授权发布；执行者需有本次发布或撤回的授权。准备 Git、gh（仓库写权限）、Bun 1.3.14、Node 22+、uv；本地打包还需对应平台工具链。

## 门禁

PR 合并以**当前 head** 的 GitHub 具名检查为准：

- `validate`（完整 `validate:ci`：类型、文档工具、lint、测试、i18n）。
- `startup-contract (ubuntu-latest)`、`startup-contract (macos-latest)`、`startup-contract (windows-latest)`。
- Windows workflow 路径过滤命中时的 `installed-startup`；文档 PR 不触发它属于正常情况。其他领域 workflow 若触发，其具名检查也需成功。

```bash
gh pr view "$PR" --repo JiuZhou-ailab/storyflow --json headRefOid,baseRefName,state
gh pr checks "$PR" --repo JiuZhou-ailab/storyflow --watch
```

未完成、失败或取消的必要检查不能当绿灯。没有 check run 的第三方 App queued check suite 不属于 CI。评审按当前任务和仓库保护规则执行；不要自行追加「本机 full 必须通过」「另找一份正式 GitHub Approve」等发布门禁，也不要绕过已有保护或任务指定的评审。此类开发 Task 交 PR 后由独立 reviewer 评审，开发者不自行批准合并。

正式发布另需 Release 的 full/full 检查成功，以及下面的安装包用户效果验证。不能用 PR CI 代替 Release 检查，也不能用成功打包代替用户效果验证。

### mini 本地 full 的历史失败

2026-11-09 的 v0.26.1 候选 `e4f2cca1`，macOS arm64、Bun 1.3.14，执行 `RELEASE_VERSION=v0.26.1 bun run release -- --platform=darwin --arch=arm64` 得到 5988 pass / 11 skip / 6 fail。记录来源：[PR #70 完整报告](https://github.com/JiuZhou-ailab/storyflow/pull/70#issuecomment-6747770754)。

| 用例 | 实际观察与已知原因 |
| --- | --- |
| `CliRpcClient > connects over wss:// with TLS` | Bun.serve TLS fixture 报 BoringSSL DECODE_ERROR；具体根因未确认 |
| `enforces the configured IP limit in local workerd` | 30 秒超时；根因未确认 |
| `registers only real OS files across Electron context isolation` | 30 秒超时；根因未确认 |
| `failed Pi termination remains retryable and never reports a live child as stopped` | EACCES：`/tmp/sessions` 为 patrickstar 所有且权限 700，执行用户为 lhagent；已确认环境权限冲突 |
| `removes active SVG content and preserves renderable currentColor geometry` | 30 秒超时；根因未确认 |
| `shows clear limits and cannot exceed them through concurrent pastes` | 30 秒超时；根因未确认 |

更早的记录有 Electron binary 缺失；该轮已执行 `node node_modules/electron/install.js`，实际是超时，不能继续解释成缺 Electron。同源码树 Ubuntu Validate 六项通过。本地 full 是诊断手段，不是独立合并/发布门禁；已确认的设备环境问题不阻塞 GitHub full。TLS/超时不能擅自归为环境问题：保留日志、关联 #64 或另报问题；若可在标准 CI/候选安装包复现产品故障，先修复。不要修改别人的 `/tmp/sessions` 权限或删测试来造绿。

## 准备版本和安装包验收

1. 普通发版从通过 CI 的 `main` 发；明确限定范围的补丁从上一个稳定 tag 建 `release/<version>`，只挑本次授权改动，以 PR 合入该分支。0.26.1 曾以 v0.26.0 为基线走补丁分支，这不是以后所有版本都从该分支发。
2. 在准备 PR 中同步根、`apps/*`、`packages/*` 的所有 package.json 版本及 bun.lock workspace 版本，写 `apps/electron/resources/release-notes/<version>.md`。`bun install` 后检查 lock diff，避免带入无关依赖更新。执行 `RELEASE_VERSION=vX.Y.Z bun run check-version`，确认相对稳定 tag 的完整 diff 符合范围。CI 绿后合并版本 PR，记录最终提交 SHA。
3. **触发 Release 前**，在最终候选 SHA 上构建安装包。macOS 用 `bun run electron:dist:mac -- --arch=arm64` / `--arch=x64`（需签名、公证配置），Windows 用 `bun run electron:dist:win`；本机开发预检可用 `bun run electron:dist:dev:mac -- --arch=arm64`，但未签名开发包不能冒充最终签名产物。不要裸跑 electron-builder，脚本负责 runtime staging。
4. 从 `apps/electron/release/` 的 DMG/EXE 安装后启动，确认 About 中版本。使用隔离测试用户/数据，验证干净安装和上一稳定版升级两条路径。逐项操作本次 issue 的用户场景，记录平台、架构、候选 SHA、包名和 SHA256、操作、结果及截图/录屏。模型改动须在真实登录/连接后打开模型选择器，确认预期 Gemini/GPT/Claude **完整列表**、选择并实际发起会话；不能只 grep 源码或看预置模型测试。还要验证重启后配置保留及基础对话可用。任一场景失败则停止发版。
5. Release workflow **没有人工暂停点**，会自动从草稿发布到公网。不要先触发它再等人验包。正式产物生成后还需下载复核同一场景；若与候选不同或失败，立即按下文撤回，不能继续宣称发布成功。

## 触发正式发布

以下变量替换为本次已批准的值；不要照抄历史版本。工作目录必须是干净的候选 checkout。

```bash
RELEASE_TAG=vX.Y.Z
RELEASE_BRANCH=main # 范围补丁则为 release/X.Y.Z
git fetch origin --tags
git switch --detach "origin/$RELEASE_BRANCH"
RELEASE_SHA=$(git rev-parse HEAD)
git status --short
RELEASE_VERSION="$RELEASE_TAG" bun run check-version
git tag -a "$RELEASE_TAG" "$RELEASE_SHA" -m "Storyflow $RELEASE_TAG"
git push origin "refs/tags/$RELEASE_TAG"
```

tag `v*` 自动触发 full/full。另一种是手动 dispatch，**两种只选一种**，不要重复触发：

```bash
gh workflow run release.yml --repo JiuZhou-ailab/storyflow --ref "$RELEASE_BRANCH" \
  -f version="$RELEASE_TAG" -f validation_mode=full -f release_profile=full
```

dispatch checkout 是触发时该 ref 的 `github.sha`，不是 version 字符串指定的任意提交；新建 Release 的 tag target 也是这个 SHA。已有 tag 时先确认 peeled SHA 相同；不移动旧 tag。`electron-hotfix`、`windows-hotfix`、`macos-hotfix` 是缩减模式，不用于普通正式版绕过 full。

```bash
gh run list --repo JiuZhou-ailab/storyflow --workflow release.yml --limit 10 \
  --json databaseId,headSha,event,status,conclusion,url
# 找到 headSha 等于 RELEASE_SHA 的本次运行后填写 RUN_ID
gh run watch "$RUN_ID" --repo JiuZhou-ailab/storyflow --exit-status
gh run view "$RUN_ID" --repo JiuZhou-ailab/storyflow --json headSha,conclusion,jobs,url
```

full/full 执行：`validate`（check-version、完整 validate:ci），`preflight-release-secrets`，`verify-managed-auth` 可复用 workflow 的各 job，`verify-market-contracts`，`create-release`，两个 `build-macos`（arm64/x64），`build-windows`，`verify-release`，`publish-r2`。草稿创建只依赖 secrets，构建与 validate 可并行，看到草稿不代表验证通过。构建含打包后 core E2E、Pi loader、包内容/体积；macOS 还验签、公证，Windows 还验证迁移、安装启动和升级。最后合并 mac manifest、核验资产集合，再发布 GitHub Release、上传 R2 并检查公开下载/清单。所有应运行 job 成功才算流水线完成。

配置由授权运维提供：Apple 签名/公证凭据、`STORYFLOW_R2_BUCKET`、`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`、session JWT 及客户端认证配置，具体键以 preflight 为准。权限错误应报告，不打印 secret、不临时改验证脚本。

## 确认发布成功

```bash
gh release view "$RELEASE_TAG" --repo JiuZhou-ailab/storyflow \
  --json url,isDraft,isPrerelease,tagName,assets
PUBLIC_BASE=${STORYFLOW_R2_PUBLIC_BASE_URL:-https://story-storage.zjding.com}
LATEST_PREFIX=${STORYFLOW_R2_LATEST_PREFIX:-latest}
PUBLIC_LATEST="${PUBLIC_BASE%/}/${LATEST_PREFIX#/}"
for name in Storyflow-arm64.dmg Storyflow-x64.dmg Storyflow-x64.exe install-app.sh install-app.ps1; do
  curl --fail --silent --show-error --head "$PUBLIC_LATEST/$name" || exit 1
done
for name in latest-mac.yml latest.yml whats-new.json; do
  curl --fail --silent --show-error "$PUBLIC_LATEST/$name" || exit 1
done
```

确认非 draft、非 prerelease、GitHub Latest 指向目标版（`gh api repos/JiuZhou-ailab/storyflow/releases/latest --jq .tag_name`），清单和 whats-new 版本均正确。GitHub 资产包括两架构 DMG/ZIP、Windows EXE、blockmap、mac 合并及分架构清单、Windows 清单、安装脚本和 whats-new。R2 同时有 `releases/<tag>/` 和 `latest/`；前者还包含带版本号的安装包别名，后者给官网和更新器使用。

HEAD 200 只证明 URL 可达。将 GitHub 和 R2 的三个安装包实际下载到不同目录，比较 SHA256，按安装包验收步骤安装复核；检查 YAML 内每个引用文件的下载地址、size 和 sha512 与实际字节相符。检查 `releases/<tag>/` 对应资产也可下载。最后在旧稳定版客户端手动检查更新，确认目标版本、下载和重启升级成功，保存证据。R2 latest 缓存为 300 秒且 must-revalidate；遇到旧值要核对源站并等待/按运维流程清缓存，不能只凭一次 HEAD 判成功。

## 紧急撤回

撤回两个渠道要分别完成。2026-11-10 [#69 撤回记录](https://github.com/JiuZhou-ailab/storyflow/issues/69#issuecomment-6748978288) 显示 v0.26.1 GitHub 已转草稿，但 R2 当时仍是坏版本且缺写凭据；这不是全渠道完成。以下为通用操作步骤，不表示本次已执行。

先找出并停止该版本仍在进行的 Release run，防止撤回后被覆盖；记录坏版本、最后稳定版、run ID 和当前清单备份。保留 tag 和提交用于追溯，不重新发布已撤回版本。

```bash
BAD_TAG=vX.Y.Z
GOOD_TAG=vA.B.C # 已验证的上一稳定版，不要自动取可能已污染的 latest
gh run list --repo JiuZhou-ailab/storyflow --workflow release.yml --limit 20
# 仅当坏版本运行仍 queued/in_progress 时：
gh run cancel "$BAD_RUN_ID" --repo JiuZhou-ailab/storyflow
gh run watch "$BAD_RUN_ID" --repo JiuZhou-ailab/storyflow # 确认已停止；已完成的 run 不需 cancel
gh release edit "$BAD_TAG" --repo JiuZhou-ailab/storyflow --draft=true --latest=false
gh release edit "$GOOD_TAG" --repo JiuZhou-ailab/storyflow --latest=true
gh release view "$BAD_TAG" --repo JiuZhou-ailab/storyflow --json isDraft
gh api repos/JiuZhou-ailab/storyflow/releases/latest --jq .tag_name
```

GitHub 草稿不影响 R2。用已有授权的 Cloudflare 凭据执行以下命令；`STORYFLOW_R2_BUCKET` 是实际 bucket 名，不能从公开域名猜。缺凭据时交授权运维并明确标记「R2 未完成」。不要运行 Release workflow 来撤回。

```bash
: "${STORYFLOW_R2_BUCKET:?需要授权运维配置 bucket}"
: "${CLOUDFLARE_ACCOUNT_ID:?需要授权运维配置 account}"
: "${CLOUDFLARE_API_TOKEN:?需要授权运维配置 token}"
ROLLBACK_DIR=$(mktemp -d)
mkdir -p "$ROLLBACK_DIR/backup" "$ROLLBACK_DIR/good"
LATEST_PREFIX=${STORYFLOW_R2_LATEST_PREFIX:-latest}
for name in latest-mac.yml latest.yml whats-new.json; do
  bunx wrangler@4.114.0 r2 object get "$STORYFLOW_R2_BUCKET/$LATEST_PREFIX/$name" \
    --file "$ROLLBACK_DIR/backup/$name" --remote || exit 1
done
gh release download "$GOOD_TAG" --repo JiuZhou-ailab/storyflow --dir "$ROLLBACK_DIR/good"
# 先确认稳定版包、清单和 whats-new 确实属于 GOOD_TAG，再预览写入计划。
bun run release:upload-r2 -- --tag="$GOOD_TAG" --assets-dir="$ROLLBACK_DIR/good" --profile=full --dry-run
# 复核预览无误后执行；不传 retain-releases，避免撤回顺便清理历史版本。
bun run release:upload-r2 -- --tag="$GOOD_TAG" --assets-dir="$ROLLBACK_DIR/good" --profile=full
```

上传脚本先写 `releases/<GOOD_TAG>/`，再覆盖所有平台 latest 安装包、ZIP、blockmap、安装脚本、whats-new 和分架构清单，**最后写 latest-mac.yml/latest.yml**。不要只改 version 字段、只删清单或只覆盖两个 YAML，否则哈希和包字节可能不一致。若过程失败，保留备份和错误，在补齐前保持撤回未完成。

按「确认发布成功」对 GOOD_TAG 重做公开 GET、版本、安装包哈希和客户端检查更新验证。GitHub 与 R2 都指向稳定版才登记撤回完成。已安装坏版本的用户不会自动降级，需告知退出应用、备份数据后手动安装稳定版；不得承诺覆盖安装必然兼容。

上述恢复停止默认下载与更新推荐，但坏版 `releases/<BAD_TAG>/` 直链仍存在。若授权要求下架直链，在 latest 恢复后，从上传日志枚举坏版精确 key（包括版本号别名），逐个执行 `bunx wrangler@4.114.0 r2 object delete "$STORYFLOW_R2_BUCKET/$BAD_KEY" --remote`，并验证这些 URL 不再返回包；不要误删 GOOD_TAG 或整个 bucket。immutable 历史资产可能仍有 CDN 缓存，需要运维清理。回报中分别列明 GitHub、R2 latest、坏版历史直链、缓存及已安装用户的处置状态。
