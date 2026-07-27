# Runtime Domains

Runtime Domains define which product context owns a conversation. They do not create a second operating-system permission boundary.

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
The hidden application-managed Workspace that owns Free Conversation history; each session receives a private default working directory for its files, generated artifacts, and Explicit Attachments.
_Avoid_: Selected working directory, project root

**Explicit Attachment**:
A file deliberately surfaced in a Free Conversation as relevant input. It changes context, not local filesystem authority.
_Avoid_: Security grant, mounted folder

**Project Work Domain**:
A Runtime Domain owned by one project whose history, default working directory, source overlay, and deliverables stay with that project.
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
The existing Workspace resolved from one workspace id. It binds history, default working directory, navigation identity, and the resource view without a parallel owner or context wrapper.
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

**Project Source Overlay**:
Project-owned Sources that extend one Project Work Domain without modifying or copying global Sources.
_Avoid_: Project Skill overlay, global resource copy

**Resource Resolver**:
The single resource-loading entry point that always reads global Skills and Extensions, and optionally applies one Project Source Overlay over global Sources.
_Avoid_: Domain-specific loader, resource synchronization layer

**Local User Trust Space**:
The filesystem authority already held by the operating-system user running Storyflow. Local Agents use this same authority across projects; a Project selects context and defaults, not authorization.
_Avoid_: Project sandbox, attachment grant

**Trusted Extension**:
An executable Agent extension installed through the Global Resource Root and instantiated by the shared Agent Kernel.
_Avoid_: Skill Package extension
