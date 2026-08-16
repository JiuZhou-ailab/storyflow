# Tool Access

Tool Access lets signed-in Storyflow users invoke approved network capabilities without installing or receiving provider credentials. Installable methods remain portable instructions; the product host and cloud gateways own authorization and secret use.

## Language

**Managed Tool Capability**:
A short-lived, scope-bound authorization derived from an Identity Session for one approved product capability such as `web:search`.
_Avoid_: Provider API key, model token, installed Skill credential

**Local Capability Broker**:
The loopback-only host boundary that authenticates a trusted child process with a random process capability, obtains fresh Managed Tool Capability, and proxies only named tool operations.
_Avoid_: Generic HTTP proxy, credential server, MCP registry

**Tool Gateway**:
The cloud resource server that verifies Managed Tool Capability, validates a stable product operation, invokes one Provider Tool Adapter, and returns the product contract.
_Avoid_: Skill runtime, raw provider proxy, key store UI

**Provider Tool Adapter**:
The server-side translation from a stable Storyflow tool operation to one provider protocol.
_Avoid_: Client SDK, Skill script, provider selection prompt

**Provider Tool Credential**:
Server-only authentication material used by a Provider Tool Adapter. It is never distributed to desktop clients, Skills, MCP configurations, or child processes.
_Avoid_: Managed Tool Capability, local broker token, user setting

**Tool Operation**:
A named, validated Storyflow capability route with its own input, output, scope, timeout, and size bounds.
_Avoid_: Arbitrary URL, passthrough MCP method, provider endpoint

**Tool Method Package**:
An installable Skill Package or future MCP/CLI integration that teaches when and how to call Tool Operations but owns no provider authentication state.
_Avoid_: Credential bundle, gateway implementation, runtime plugin
