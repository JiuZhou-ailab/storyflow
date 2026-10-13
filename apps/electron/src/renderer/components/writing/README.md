# Writing Editor

在通用项目文件树之上提供 Markdown 编辑、选区操作和兼容旧写作文件的展示标签；不拥有项目创建或目录结构。

- `NovelDocumentEditorPanel.tsx`：Markdown 编辑与文件级 diff 审阅；调用方按正文读取状态控制可编辑性。
- `useWritingDocument.ts`：Project 文件的文档生命周期。同一文件只有一份 `text-document-state` 草稿，写作视图（仅 Markdown）和原文视图共用；负责富文本 flush、自动保存与磁盘重载。
- `novel-file-display.ts`：旧写作文件的兼容展示标签。
- `__tests__/`：编辑与审阅布局回归。
