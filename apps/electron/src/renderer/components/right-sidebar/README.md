# Session file surfaces

- `ConversationFilesPanel.tsx` owns Free Conversation file membership, open intents, live queries, and a single read-only preview. It reuses `WorkspaceDockLayout`, `WorkspaceFileTree`, `FileViewer`, and platform file actions; tree mutation callbacks are not supplied. The compact session drawer reuses the same keyed surface.
- `SessionFilesSection.tsx` preserves the legacy session-info directory view.
- `session-files-watch.ts` restores the legacy file subscription after reconnect; conversation surfaces use their own consumer ids on the same RPC watcher service.
- `__tests__/` covers legacy reconnect behavior. Conversation acceptance runs at the session files RPC and real Electron boundaries.

File membership comes from the server's conversation content view. Previews have no editor identity, draft, save, or leave gate. Source Document attachments use their original paths and can be located but never sent to a writable system application. These components do not own attachment storage or filesystem authorization.
