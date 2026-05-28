# 最新动态

## 内部写作发行版

这一版面向内部中文短篇/中篇创作流程做了默认配置收敛。新建写作工作区会优先使用短篇小说模板，适合 5,000-30,000 字强钩子题材，例如情感反转、复仇打脸、追妻火葬场、马甲爽文等项目。内部发行包保留默认模型连接，打开后可以直接进入写作工作区，不需要每台机器重复配置基础模型。

## 桌面端安装

Release 流程发布 macOS `.dmg`、macOS 自动更新用 `.zip` 和 Windows `.exe`。macOS 包按架构区分：Apple Silicon 使用 `Storyflow-arm64.dmg` / `Storyflow-arm64.zip`，Intel Mac 使用 `Storyflow-x64.dmg` / `Storyflow-x64.zip`；Windows 使用 `Storyflow-x64.exe`。macOS 需要 12.0 或更新版本。

macOS 正式包会使用 Apple Developer ID 签名和 notarization。安装脚本会在替换应用前验证签名与 Gatekeeper 信任，并在验证失败时停止安装。

## 本次修复

- **修复聊天滚动与新文件 diff** — 聊天栏在高度切换后不再出现底部空白或无法继续下滑；新文件写入的 diff 不再把红绿两侧渲染成相同内容，新增文件会按新增内容展示。
- **收敛托管模型路径** — 内置托管模型只保留 `wangsu-default`，继续承载 `gemini-3.5-flash`、`gpt-5.5`、`deepseek-v4-pro`；暂不引入 Xiaomi API，后续稳定性问题集中在 Wangsu 的 Cloudflare 自定义 provider 上排查。
- **精简登录与模型链路** — Feishu/Neon 登录只做 App 门禁，不再签发或写入模型网关 JWT；内置模型连接改为直连 Cloudflare AI Gateway，减少一次 Worker 验签和一次本地 token 同步。
- **修复工具调用流式收尾** — 部分 OpenAI-compatible 网关在工具调用后直接结束 SSE 流但缺少 `finish_reason`，现在会在拦截器里补齐 `tool_calls` 收尾事件，避免会话报 `Stream ended without finish_reason`。

## 推荐写作流程

1. 一个工作区只维护一本书，避免世界观、人物和章节上下文混在一起。
2. 先维护 `创作要求.md`，写清长期风格、读者偏好和不能触碰的红线。
3. 在 `简报.md` 填题材定位、主角设置、目标读者、核心钩子、黄金三章和篇幅目标。
4. 在 `简报.md` 里选择小说密度、事件密度和情绪调动程度，避免正文写淡。
5. 在 `大纲.md` 按章列出钩子、冲突、反转和情绪落点，再补 `人物.md` 与 `素材.md`。
6. 正文只放在 `正文/` 目录，每章一个 `NN-标题.md` 文件，章节标题就是钩子。
7. 临时试写、废弃版本和审校笔记放进 `.work/`；正式章节直接覆盖修改，用 git diff 留痕。
