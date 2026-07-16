# Workspace Surface

承载进入项目后才加载的写作工作台与虚拟化文件目录，使项目中心不依赖编辑器、diff 和文件树交互代码。

- `WorkspaceSurface.tsx`：延迟装载 AppShell 与编辑器专用主题 Provider。
- `WorkspaceFileTree.tsx`：受控、虚拟化的文件树与拖动/重命名适配层。
- `WorkspaceFileTreeRow.tsx`：文件树可见行、右键菜单和行内编辑。
- `workspace-file-tree-model.ts`：原生文件快照到稳定层级节点的纯投影。
- `__tests__/workspace-file-tree-model.test.ts`：目录投影与空目录回归测试。
