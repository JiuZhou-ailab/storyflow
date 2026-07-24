# Writing Editor

在通用项目文件树之上提供 Markdown 编辑、选区操作、版本历史和兼容旧写作文件的展示标签；不拥有项目创建或目录结构。

- `NovelDocumentEditorPanel.tsx`：Markdown 编辑与文件级 diff 审阅。
- `NovelDocumentPreview.tsx`：只读 Markdown 预览。
- `NovelVersionHistoryDialog.tsx`：项目本地版本列表与恢复。
- `NovelSectionList.tsx`、`NovelWorkspaceTabs.tsx`、`WritingChatDropdown.tsx`：旧写作工作台的展示组件。
- `novel-file-display.ts`、`novel-workspace-config.ts`：旧写作文件的兼容展示配置。
- `__tests__/`：编辑、审阅和历史布局回归。
