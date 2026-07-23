# Project Hub package (legacy helpers)

Product UI no longer mounts the full-page ProjectHub gallery. Day-to-day project switch/create/import/remote/rename/remove lives in `app-shell/ProjectManagerPanel` (rail popover + cold-start standalone).

This folder still owns:
- `ProjectHubNavigation.ts` — reversible return-route helpers for cold-start shell
- `ProjectHub.tsx` — legacy gallery component kept for helper tests / playground until fully deleted
