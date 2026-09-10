# Session file surfaces

- `ConversationFilesPanel.tsx` owns Free Conversation file membership, open intents, live queries, and read-only previews. It reuses `WorkspaceDockLayout`, `NovelDocumentTabStrip`, and `WorkspaceFileTree` from the existing workbench; no mutation callbacks are supplied. The compact session drawer reuses the same keyed surface.
- `SessionFilesSection.tsx` preserves the legacy session-info directory view.
- `session-files-watch.ts` restores the legacy file subscription after reconnect; conversation surfaces use their own consumer ids on the same RPC watcher service.
- `__tests__/` covers legacy reconnect behavior. Conversation acceptance runs at the session files RPC and real Electron boundaries.

File membership comes from the server's conversation content view. Markdown and text files reuse the project's `NovelDocumentEditorPanel` in read-only mode through `FileViewer`; other formats retain their existing previews. These components do not own project editing, attachment storage, or filesystem permissions.
