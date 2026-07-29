# Workspace Surface

承载进入项目后才加载的写作工作台与虚拟化文件目录，使项目中心不依赖编辑器、diff 和文件树交互代码。

- `WorkspaceSurface.tsx`：延迟装载 AppShell 与编辑器专用主题 Provider。
- `WorkspaceEmptyState.tsx`：在共享文件标签栏下提供不写入磁盘的创建、导入与 Skills 开始页。
- `WorkspaceProjectSidebar.tsx`：延迟装载真实项目文件树，并呈现空白项目提示。
- `WorkspaceFileTree.tsx`：受控、虚拟化的文件树与拖动/重命名适配层。
- `WorkspaceFileTreeRow.tsx`：文件树可见行、右键菜单和行内编辑。
- `useWorkspaceProjectSurface.ts`：冷启动状态与创建、导入、Skills 命令的编排边界。
- `workspace-file-actions.ts`：文件级本地系统操作的可测试应用边界。
- `workspace-file-tree-model.ts`：原生文件快照到稳定层级节点的纯投影。
- `__tests__/`：目录投影、空目录与文件级本地操作回归测试。
