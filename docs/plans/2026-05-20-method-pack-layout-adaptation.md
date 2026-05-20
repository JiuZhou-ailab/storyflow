# Method Pack Layout Adaptation Plan

## 结论

短文/中篇网文继续使用中文心智结构：

```text
创作要求.md
简报.md
大纲.md
人物.md
素材.md
正文/
自由区/
```

这不是通用宇宙结构，也不应直接推广到长篇、剧本、拆文或通用创意写作。后续适配以「方法先行、布局从属」为原则：每个 method pack 先证明自己的创作流程、事实源和成稿边界，再决定是否需要抽象层。

## 已执行的小修

- `short-form.article` 不再生成 `目录说明.md`，避免重复事实源。
- 目录职责进入 method pack 运行契约和 `AGENTS.md`。
- `正文/` 保持唯一成稿目录，允许按卷、篇或阶段建立子目录；目录内仍只放章节 Markdown 文件。
- `自由区/` 取代短文包里的 `.work/`，作为可自由创建文件和文件夹的临时空间。
- UI 文件搜索和短文工作区投影不再把 `目录说明.md` 当内置文件。

## 共享抽象边界

下一步不要抽象 `plan / knowledge / text / work` 作为强制目录。更稳的共享层是一个 `shared layout prompt`，只描述通用行为：

- 哪些路径是持久事实源。
- 哪些路径是成稿目录。
- 哪些路径是临时空间。
- 成稿目录是否允许子目录。
- UI 可开放哪些创建、重命名能力。

method pack 保留写作方法、节奏门禁、文件角色和命名规则；目录解释不要在每个 pack 里重复铺开。

## 各 Method 适配计划

| Method Pack | 当前判断 | 适配动作 |
| --- | --- | --- |
| `short-form.article` | 已完成最小收敛。 | 使用 `正文/` 与 `自由区/` 两个可扩展目录；`正文/` 允许章节子目录，`自由区/` 允许任意临时内容。旧工作区若已有 `.work/`，不要自动迁移，先按兼容路径识别。 |
| `novel.oh-story` | 中文网文长篇/连载结构已有明显业务语义。 | 保留 `设定/ 大纲/ 正文/ 追踪/ 拆文库/ 对标/ 参考资料/ .work/`；先补清「正典/追踪/对标/临时」边界，不迁移到英文统一目录。 |
| `novel.claude-book` | 长篇连续性结构成熟，`bible/story/state/timeline/.work` 足够正交。 | 保留原布局；只把公共目录解释抽到 shared layout prompt，pack 保留章节工作流、状态更新和连续性门禁。 |
| `novel.crucible` | 结构型规划方法强依赖 `planning/ outline/ draft/ story-bible.json`。 | 保留结构术语；重点检查 `draft/chapters/` 是否是成稿还是工作稿，必要时在 artifact contract 中更明确。 |
| `novel.creative-writing` | 当前最接近 `knowledge/work/text` 抽象，但仍是通用写作包，不应反向污染短文包。 | 保留 `story/ work/ kb/`；用它验证共享 layout prompt 是否足够，而不是要求其他包迁移到它的布局。 |

## UI 能力分层

第一阶段只针对短文工作区开放低风险写作能力：

- `正文/`：新建章节文件、新建章节子目录、重命名章节文件或子目录。
- `自由区/`：新建文件、新建文件夹、重命名文件或文件夹。
- 其他根文件：只编辑内容，不开放随意新建同级文件。

第二阶段再按 pack 增加能力：

- 长篇章节目录：根据章节命名规则新建章节。
- 正典/知识库目录：只允许创建符合该 pack contract 的条目。
- 临时目录：默认自由。

## 推进顺序

1. 为 method pack 增加共享 layout prompt 渲染层，避免每个 pack 重复解释目录。
2. 为 UI 增加「目录能力声明」字段，先服务 `short-form.article`。
3. 分别审计 `oh-story`、`claude-book`、`crucible`、`creative-writing` 的 artifact contract，补足成稿/事实源/临时空间边界。
4. 等新增长篇、剧本、拆文 pack 后，再判断是否需要引入更高层的 `Craft layout`，而不是现在预设。

## 路径迁移注意事项

- 新建 `short-form.article` 工作区使用 `自由区/`。
- 旧短文工作区如果已有 `.work/`，先继续归类为临时工作区内容，不自动重命名，避免无声移动用户文件。
- Agent 写新临时材料时优先写 `自由区/`；只有用户明确指向旧 `.work/` 时才继续使用旧路径。
- `正文/` 内允许子目录后，下一章编号不能只看根目录文件，必须扫描 `正文/` 下所有章节 Markdown。
