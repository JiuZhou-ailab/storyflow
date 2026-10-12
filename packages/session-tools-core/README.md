# Session tools core

Portable session-tool definitions and handlers. `src/context.ts` defines the Host
capabilities, `src/tool-defs.ts` registers tool schemas/handlers, `src/handlers/`
implements operations, and `src/index.ts` exports the shared surface. Runtime
connection pools, credentials, and session state belong to the implementing Host.

`source_test` validates Host access before testing a Source. For an MCP Source it
calls the optional `clearSourceBackoff(slug)` Host capability before the connection
probe, including tests with `autoEnable: false` and probes that subsequently fail.
The callback only resets retry eligibility; it does not grant access or activate
a Source. Activation still requires successful validation and the existing policy.
