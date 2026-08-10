# Sessions

`SessionManager.ts` owns Product Host session persistence and Pi event projection, never Pi retry or turn settlement; `managed-session.ts`, `runtime-config.ts`, `pi-turn-anchors.ts`, `tool-display.ts`, and `turn-watchdog.ts` own state assembly, runtime signatures, provider anchors, UI projection, and the absolute turn safety limit respectively. Adjacent `*.test.ts` files verify these boundaries and durable session behavior.
