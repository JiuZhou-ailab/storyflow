# Session file surfaces

- `ConversationFilesPanel.tsx` owns the Free Conversation file dock, file-open intents, live content queries, and read-only preview. The compact session drawer reuses the same keyed surface.
- `SessionFilesSection.tsx` preserves the legacy session-info directory view and exports its controlled file tree row for both views.
- `session-files-watch.ts` restores the legacy file subscription after reconnect; conversation surfaces use their own consumer ids on the same RPC watcher service.
- `__tests__/` covers legacy reconnect behavior. Conversation acceptance runs at the session files RPC and real Electron boundaries.

File membership comes from the server's conversation content view. These components do not own project editing, attachment storage, or filesystem permissions.
