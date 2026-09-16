# Auth Broker Worker Source

- `index.ts` owns public identity exchange, bounded capability issuance and idempotent session revoke.
- `worker.ts` exposes the HTTP handler and private `AccessAuthority` Service Binding entrypoint.
- `access-state.ts` owns primary D1 authorization, sessions and validated operator SQL; migrations define atomic audit/revocation triggers.
- `index.test.ts` preserves legacy contracts. `managed-access.test.ts` runs signed-token/D1 HTTP tests and the Node-native `managed-access.integration.ts` Worker binding acceptance.
