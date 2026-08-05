/**
 * Agent Backend Abstraction Layer
 *
 * This module provides a unified interface for the Pi agent runtime while Pi
 * handles model-provider switching internally.
 *
 * Naming convention:
 * - PiAgent: the production unified agent runtime
 * - AgentBackend: Interface implemented by the runtime
 * - resolvePiAgentConfig: pure connection-to-Pi configuration resolution
 *
 * Usage:
 * ```typescript
 * import { PiAgent } from '@craft-agent/shared/agent';
 * import { resolvePiAgentConfig } from '@craft-agent/shared/agent/backend';
 * const agent = new PiAgent(resolvePiAgentConfig({ context, coreConfig, hostRuntime }));
 * ```
 */

// Core types
export type {
  AgentBackend,
  AgentProvider,
  CoreBackendConfig,
  BackendConfig,
  BackendHostRuntimeContext,
  PermissionCallback,
  PlanCallback,
  AuthCallback,
  SourceChangeCallback,
  SourceActivationCallback,
  ChatOptions,
  RecoveryMessage,
  SdkMcpServerConfig,
  LlmAuthType,
  LlmProviderType,
  PostInitResult,
} from './types.ts';

// Enums need to be exported as values, not just types
export { AbortReason } from './types.ts';

// Connection and Pi runtime configuration
export {
  // LLM Connection support
  connectionAuthTypeToBackendAuthType,
  resolveSessionConnection,
  resolveBackendContext,
  resolveRequiredBackendContext,
  resolveSetupTestConnectionHint,
  resolvePiAgentConfig,
  initializeBackendHostRuntime,
  resolveBackendHostTooling,
  fetchBackendModels,
  validateStoredBackendConnection,
  // Utilities
  resolveModelForConnection,
  cleanupSourceRuntimeArtifacts,
  testBackendConnection,
  // Connection validation
} from './connection-runtime.ts';

// Shared infrastructure
export { BaseEventAdapter } from './base-event-adapter.ts';
export { EventQueue } from './event-queue.ts';

// Provider-specific event adapter
export { PiEventAdapter } from './pi/event-adapter.ts';

// Pi is Storyflow's only production agent runtime.
