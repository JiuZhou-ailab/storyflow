# Workspace Surface

承载写作工作台的共享布局与虚拟化文件目录，自由对话复用同一布局和目录呈现。项目中心不依赖编辑器、diff 和文件树交互代码。

- `WorkspaceSurface.tsx`：延迟装载 AppShell 与编辑器专用主题 Provider。
- `WorkspaceDockLayout.tsx`：项目和自由对话共用的文件标签栏、内容区及右侧可折叠目录布局。
- `WorkspaceEmptyState.tsx`：在共享文件标签栏下提供不写入磁盘的创建、导入与 Skills 开始页。
- `WorkspaceProjectSidebar.tsx`：延迟装载真实项目文件树，并呈现空白项目提示。
- `WorkspaceFileTree.tsx`：受控、虚拟化的文件树；仅在提供相应回调时启用拖动、重命名和删除。
- `WorkspaceFileTreeRow.tsx`：文件树可见行、右键菜单和行内编辑。
- `useWorkspaceProjectSurface.ts`：冷启动状态与创建、导入、Skills 命令的编排边界。
- `workspace-file-actions.ts`：文件级本地系统操作的可测试应用边界。
- `workspace-file-tree-model.ts`：原生文件快照到稳定层级节点的纯投影。
- `__tests__/`：目录投影、空目录与文件级本地操作回归测试。
