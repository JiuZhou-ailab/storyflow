# Issue tracker: GitHub

本仓库的 specs 和 tickets 发布到 `JiuZhou-ailab/storyflow` 的 GitHub Issues。使用 `gh` CLI，所有操作显式指定 `--repo JiuZhou-ailab/storyflow`，避免 fork 的 upstream 歧义。

## Conventions

- 创建：`gh issue create --repo JiuZhou-ailab/storyflow --title "标题" --body-file <正文文件> --label ready-for-agent`。只在规格完整、必要确认完成时使用该标签。
- 读取：`gh issue view <number> --repo JiuZhou-ailab/storyflow --json number,title,body,labels,comments,state,url`。
- 列表：`gh issue list --repo JiuZhou-ailab/storyflow --state open --json number,title,body,labels,url`，按任务需要添加筛选。
- 评论：`gh issue comment <number> --repo JiuZhou-ailab/storyflow --body-file <正文文件>`。
- 标签：`gh issue edit <number> --repo JiuZhou-ailab/storyflow --add-label <label>`；移除时使用 `--remove-label`。
- 关闭：`gh issue close <number> --repo JiuZhou-ailab/storyflow`。
- 多行正文先写入文件，再使用 `--body-file`；保留真实换行，避免 shell 插值。
- 标签角色映射见 [triage labels](triage-labels.md)。复用现有同名标签，缺失时仅在已授权的发布或 triage 操作需要时创建。
- 本地草案是发布前的工作材料；“publish to the issue tracker”表示创建或更新 GitHub issue，不表示只写本地文件。更新既有同一规格优先于重复创建。
- 此配置只定义位置和工具，不自动授权发布、评论、关闭 issue、提交或 push；具体动作遵循当前任务授权。

## Pull requests as a triage surface

**PRs as a request surface: no.**

## Ticket relationships

拆票时优先使用 GitHub 原生 sub-issue 和 blocking 关系；原生能力不可用时，在正文保留 Parent 与 Blocked by 引用。编号用于用户引用，调用要求 issue database id 的 API 时先查询实际 id，不混用。
