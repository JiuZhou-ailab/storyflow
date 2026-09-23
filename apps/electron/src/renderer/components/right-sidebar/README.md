# Session file surfaces

- `ConversationFilesPanel.tsx` owns Free Conversation file membership, open intents, live queries, and runtime-scoped editable text files. It reuses `WorkspaceDockLayout`, `NovelDocumentTabStrip`, and `WorkspaceFileTree` from the existing workbench; tree mutation callbacks are not supplied; text saves use the versioned file RPC. The compact session drawer reuses the same keyed surface.
- `SessionFilesSection.tsx` preserves the legacy session-info directory view.
- `session-files-watch.ts` restores the legacy file subscription after reconnect; conversation surfaces use their own consumer ids on the same RPC watcher service.
- `__tests__/` covers legacy reconnect behavior. Conversation acceptance runs at the session files RPC and real Electron boundaries.

File membership comes from the server's conversation content view. Text files use `FileViewer` and `TextDocument` with Session identity, independent tabs, and one filtered directory. Dirty drafts survive watcher updates and view remounts; changing files or leaving the Session passes through the shared document leave gate. Source Document attachments remain read-only. Media retains its previews. These components do not own attachment storage or filesystem authorization.
