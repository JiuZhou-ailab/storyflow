/**
 * Agent Backend Abstraction Layer
 *
 * This module provides a unified interface for the Pi agent runtime while Pi
 * handles model-provider switching internally.
 *
 * Naming convention:
 * - PiAgent: the production unified agent runtime
 * - AgentBackend: Interface implemented by the runtime
 * - createAgent: Factory function to create agents
 *
 * Usage:
 * ```typescript
 * import { createAgent, type AgentBackend } from '@craft-agent/shared/agent/backend';
 *
 * const agent = createAgent({
 *   provider: 'pi',
 *   workspace: myWorkspace,
 *   model: 'claude-sonnet-4-6',
 * });
 *
 * for await (const event of agent.chat('Hello')) {
 *   console.log(event);
 * }
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
  createBackend,
  createAgent,
  detectProvider,
  getAvailableProviders,
  isProviderAvailable,
  // LLM Connection support
  connectionTypeToProvider,
  connectionAuthTypeToBackendAuthType,
  resolveSessionConnection,
  resolveBackendContext,
  resolveSetupTestConnectionHint,
  createConfigFromConnection,
  createBackendFromConnection,
  createBackendFromResolvedContext,
  initializeBackendHostRuntime,
  resolveBackendHostTooling,
  fetchBackendModels,
  validateStoredBackendConnection,
  providerTypeToAgentProvider,
  // Capabilities and utilities
  BACKEND_CAPABILITIES,
  resolveModelForConnection,
  getDefaultAuthType,
  cleanupSourceRuntimeArtifacts,
  testBackendConnection,
  // Connection validation
} from './factory.ts';

// Shared infrastructure
export { BaseEventAdapter } from './base-event-adapter.ts';
export { EventQueue } from './event-queue.ts';

// Provider-specific event adapter
export { PiEventAdapter } from './pi/event-adapter.ts';

// Agent implementations are imported directly by factory.ts
// Consumers should use createAgent() / createBackend() instead of concrete classes
