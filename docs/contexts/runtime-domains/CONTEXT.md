# Runtime Domains

Runtime Domains define which product context owns a conversation and the state visible to its Agent.

## Language

**Runtime Domain**:
The ownership boundary that determines a conversation's state, context, and accessible workspace.
_Avoid_: Page, mode, route

**Free Conversation Domain**:
The application-owned Runtime Domain that exists independently of every project and retains its identity when projects are opened or switched.
_Avoid_: Project chat, contextless project session

**Free Conversation**:
A conversation owned by the Free Conversation Domain whose history and workspace remain independent of every project.
_Avoid_: Project conversation without a selected project

**Free Conversation Workspace**:
The hidden application-managed Workspace that owns Free Conversation history; each session receives a private working directory for its files, generated artifacts, and Explicit Attachments.
_Avoid_: Selected working directory, project root

**Explicit Attachment**:
A file deliberately added to a Free Conversation without granting access to its containing directory or project.
_Avoid_: Mounted folder, implicit workspace

**Project Work Domain**:
A Runtime Domain owned by one project and limited to that project's state and workspace.
_Avoid_: Global chat, free conversation

**Project Conversation**:
A conversation owned by one Project Work Domain whose history, context, and deliverables remain with that project.
_Avoid_: Free conversation with a selected folder

**Domain Transfer**:
An explicit user action that starts a conversation in another Runtime Domain from a Transfer Snapshot without changing the ownership of the source conversation.
_Avoid_: Directory switch, implicit project attachment

**Transfer Snapshot**:
The immutable generated summary copied once to seed a conversation in another Runtime Domain, with no provider transcript, workspace files, attachments, or live history link afterward.
_Avoid_: Shared conversation, synchronized history

**Agent Kernel**:
The single shared Agent implementation used by every Runtime Domain; domain differences come from the resolved Workspace rather than separate Agent systems.
_Avoid_: Free-conversation system, project Agent

**Runtime Workspace**:
The existing Workspace resolved from one workspace id. It binds history, filesystem boundaries, navigation identity, and the resource view without a parallel owner or context wrapper.
_Avoid_: Runtime context wrapper, navigation identity

**Application Workspace**:
The hidden Workspace that lets Free Conversations reuse the existing session infrastructure without becoming a project.
_Avoid_: Default project, visible workspace

**Domain Adapter**:
The single `workspaceId → Workspace` resolution boundary; it contains no Agent behavior.
_Avoid_: Domain-specific Agent implementation, orchestration layer, owner wrapper

**Global Resource Root**:
The single application-owned source of global Skills, Sources, trusted Extensions, and model-connection definitions shared by every Runtime Domain.
_Avoid_: Project defaults, implicitly discovered user directory

**Project Resource Overlay**:
Project-owned Skills and Sources that extend one Project Work Domain without modifying or copying the Global Resource Root.
_Avoid_: Global resource copy, shared project resources

**Resource Resolver**:
The single resource-loading entry point that always reads the Global Resource Root and optionally applies one Project Resource Overlay.
_Avoid_: Domain-specific loader, resource synchronization layer

**Trusted Extension**:
An executable Agent extension installed through the Global Resource Root and instantiated within a Runtime Domain's boundaries.
_Avoid_: Project Skill, Skill Package extension
