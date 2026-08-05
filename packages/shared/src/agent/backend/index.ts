/**
 * Agent Backend Abstraction Layer
 *
 * This module provides a unified interface for the Pi agent runtime while Pi
 * handles model-provider switching internally.
 *
 * Naming convention:
 * - PiAgent: the production unified agent runtime
 * - AgentBackend: Interface implemented by the runtime
 * - createBackendFromResolvedContext: Pi construction from resolved connection state
 *
 * Usage:
 * ```typescript
 * import { createBackendFromResolvedContext } from '@craft-agent/shared/agent/backend';
 * const agent = createBackendFromResolvedContext({ context, coreConfig, hostRuntime });
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

// Factory
export {
  // LLM Connection support
  connectionAuthTypeToBackendAuthType,
  resolveSessionConnection,
  resolveBackendContext,
  resolveSetupTestConnectionHint,
  createBackendFromConnection,
  createBackendFromResolvedContext,
  initializeBackendHostRuntime,
  resolveBackendHostTooling,
  fetchBackendModels,
  validateStoredBackendConnection,
  // Utilities
  resolveModelForConnection,
  cleanupSourceRuntimeArtifacts,
  testBackendConnection,
  // Connection validation
} from './factory.ts';

// Shared infrastructure
export { BaseEventAdapter } from './base-event-adapter.ts';
export { EventQueue } from './event-queue.ts';

// Provider-specific event adapter
export { PiEventAdapter } from './pi/event-adapter.ts';

// Pi is Storyflow's only production agent runtime.
