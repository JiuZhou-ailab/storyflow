/**
 * input: Current Pi init config, credential updates, and custom endpoint model definitions.
 * output: One authenticated Pi ModelRuntime, resolved models, and credential update propagation.
 * pos: Owns provider authentication and model registration for the Pi child process.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import type { Credential } from '@earendil-works/pi-ai';
import type {
  PiCustomEndpointApi,
  PiInboundMessage,
  PiOutboundMessage,
} from '../../shared/src/agent/backend/pi/protocol.ts';
import {
  buildCustomEndpointModelDef,
  normalizeCustomEndpointModelEntry,
  resolveCustomEndpointProviderApiKey,
  resolveCustomEndpointProviderName,
  resolveRuntimeCredentialProviderNames,
  shouldUseCustomEndpointBearerAuthHeader,
  stripPiPrefix,
  type CustomEndpointModelEntry,
  type CustomEndpointModelOverrides,
} from './custom-endpoint-models.ts';
import { resolvePiModel } from './model-resolution.ts';
import { ProductCredentialStore } from './product-auth-storage.ts';

type InitConfig = Extract<PiInboundMessage, { type: 'init' }>;

export class PiModelRuntime {
  private credentialStore: ProductCredentialStore | null = null;
  private runtimePromise: Promise<ModelRuntime> | null = null;
  private lastReportedOAuthCredential = '';
  private customEndpointModelIds = new Set<string>();
  private readonly customModelOverrides = new Map<string, CustomEndpointModelOverrides>();

  constructor(
    private readonly getConfig: () => InitConfig | null,
    private readonly send: (message: PiOutboundMessage) => void,
    private readonly debug: (message: string) => void,
  ) {}

  resolvedCwd(): string {
    const config = this.getConfig();
    const cwd = config?.cwd || config?.workingDirectory || process.cwd();
    if (cwd.startsWith('~/')) return join(homedir(), cwd.slice(2));
    if (cwd === '~') return homedir();
    return cwd;
  }

  prefersCustomEndpoint(): boolean {
    const config = this.getConfig();
    return Boolean(config?.customEndpoint && config.baseUrl?.trim());
  }

  resetAuth(): void {
    this.credentialStore = null;
    this.runtimePromise = null;
    this.lastReportedOAuthCredential = '';
  }

  getModelsRuntime(): Promise<ModelRuntime> {
    if (!this.runtimePromise) {
      const pending = this.createModelsRuntime();
      this.runtimePromise = pending;
      void pending.catch(() => {
        if (this.runtimePromise === pending) {
          this.runtimePromise = null;
          this.credentialStore = null;
        }
      });
    }
    return this.runtimePromise;
  }

  private async createModelsRuntime(): Promise<ModelRuntime> {
    const config = this.getConfig();
    const initialCredentials: Record<string, Credential> = {};
    const hasCustomEndpoint = !!config?.baseUrl?.trim();
    if (config?.piAuth) {
      const { provider, credential } = config.piAuth;
      if (credential.type !== 'iam') {
        for (const credentialProvider of resolveRuntimeCredentialProviderNames(
          provider,
          hasCustomEndpoint && !!config.customEndpoint,
        )) {
          initialCredentials[credentialProvider] = credential;
        }
        this.lastReportedOAuthCredential = credential.type === 'oauth'
          ? JSON.stringify(credential)
          : '';
        this.debug(`Injected ${credential.type} credential for provider(s): ${Object.keys(initialCredentials).join(', ')}`);
      }
    } else if (config?.apiKey) {
      initialCredentials.anthropic = { type: 'api_key', key: config.apiKey };
      this.debug('Injected API key into credential storage (legacy fallback)');
    }

    this.credentialStore = await ProductCredentialStore.create(
      initialCredentials,
      (providerId, credential) => this.reportCredentialChange(providerId, credential),
    );
    const models = await ModelRuntime.create({
      credentials: this.credentialStore,
      modelsPath: null,
    });
    this.refreshCustomEndpointModels(models);
    return models;
  }

  refreshCustomEndpointModels(models: ModelRuntime): void {
    const config = this.getConfig();
    const hasCustomEndpoint = !!config?.baseUrl?.trim();
    this.customEndpointModelIds.clear();
    this.customModelOverrides.clear();
    if (hasCustomEndpoint && config?.customEndpoint) {
      const modelEntries = (config.customModels?.length
        ? config.customModels
        : [config.model || 'default']
      ).map(normalizeCustomEndpointModelEntry);
      this.registerCustomEndpointModels(
        models,
        config.customEndpoint.api,
        config.baseUrl!.trim(),
        modelEntries,
      );
    } else if (hasCustomEndpoint) {
      this.debug('Custom endpoint without protocol config — models may not resolve. Set customEndpoint.api for proper routing.');
    }
  }

  resolveModel(models: ModelRuntime, modelId: string, scope: string) {
    const config = this.getConfig();
    let model = resolvePiModel(
      models,
      modelId,
      config?.piAuth?.provider,
      this.prefersCustomEndpoint(),
    );
    if (!model && config?.baseUrl?.trim() && config.customEndpoint) {
      const bareId = stripPiPrefix(modelId);
      this.registerCustomEndpointModels(
        models,
        config.customEndpoint.api,
        config.baseUrl.trim(),
        [{ id: bareId }],
      );
      model = models.getModel(this.getCustomEndpointProviderName(), bareId) ?? undefined;
      this.debug(`[${scope}] Dynamically registered custom endpoint model: ${bareId}`);
    }
    return model;
  }

  async updateCredential(piAuth: InitConfig['piAuth']): Promise<void> {
    if (!this.credentialStore || !this.runtimePromise) {
      throw new Error('ModelRuntime is not initialized');
    }
    if (!piAuth) throw new Error('Credential update is missing provider auth');
    const config = this.getConfig();
    const { provider, credential } = piAuth;
    if (credential.type === 'iam') {
      throw new Error('IAM credentials require a subprocess restart');
    }
    const credentialProviders = resolveRuntimeCredentialProviderNames(
      provider,
      !!config?.baseUrl?.trim() && !!config.customEndpoint,
    );
    const previousFingerprint = this.lastReportedOAuthCredential;
    if (credential.type === 'oauth') {
      this.lastReportedOAuthCredential = JSON.stringify(credential);
    }
    try {
      for (const credentialProvider of credentialProviders) {
        await this.credentialStore.modify(credentialProvider, async () => credential);
      }
      const models = await this.runtimePromise;
      const refreshed = await models.refresh({
        allowNetwork: false,
        providers: credentialProviders,
      });
      const refreshError = credentialProviders
        .map(providerId => refreshed.errors.get(providerId))
        .find((error): error is Error => error !== undefined);
      if (refreshError) throw refreshError;
    } catch (error) {
      this.lastReportedOAuthCredential = previousFingerprint;
      throw error;
    }
    if (config) config.piAuth = piAuth;
    if (credential.type !== 'oauth') this.lastReportedOAuthCredential = '';
    this.debug(`Updated ${credential.type} credential for provider(s): ${credentialProviders.join(', ')}`);
  }

  private registerCustomEndpointModels(
    modelsRuntime: ModelRuntime,
    api: PiCustomEndpointApi,
    baseUrl: string,
    models: CustomEndpointModelEntry[],
  ): void {
    const config = this.getConfig();
    for (const model of models) {
      this.customEndpointModelIds.add(model.id);
      if (
        model.contextWindow
        || model.supportsImages !== undefined
        || model.supportsThinking !== undefined
        || model.thinkingLevelMap !== undefined
      ) {
        this.customModelOverrides.set(model.id, {
          ...(model.contextWindow ? { contextWindow: model.contextWindow } : {}),
          ...(model.supportsImages !== undefined ? { supportsImages: model.supportsImages } : {}),
          ...(model.supportsThinking !== undefined ? { supportsThinking: model.supportsThinking } : {}),
          ...(model.thinkingLevelMap !== undefined ? { thinkingLevelMap: model.thinkingLevelMap } : {}),
        });
      }
    }
    const modelIds = [...this.customEndpointModelIds];
    const providerName = this.getCustomEndpointProviderName();
    modelsRuntime.registerProvider(providerName, {
      baseUrl,
      apiKey: this.resolveCustomEndpointApiKey(),
      api,
      authHeader: shouldUseCustomEndpointBearerAuthHeader(providerName),
      models: modelIds.map(id => buildCustomEndpointModelDef(
        id,
        { supportsImages: config?.customEndpoint?.supportsImages === true },
        this.customModelOverrides.get(id),
      )),
    });
    this.debug(`Registered custom endpoint provider=${providerName}: ${baseUrl} with ${modelIds.length} model(s) [${modelIds.join(', ')}], api: ${api}`);
  }

  private getCustomEndpointProviderName(): string {
    return resolveCustomEndpointProviderName(this.getConfig()?.piAuth?.provider);
  }

  private resolveCustomEndpointApiKey(): string {
    const config = this.getConfig();
    if (config?.piAuth?.credential.type === 'api_key') {
      return config.piAuth.credential.key;
    }
    const apiKey = config?.apiKey || '';
    if (!apiKey && config?.baseUrl) {
      this.debug('[custom-endpoint] Warning: no API key found; using placeholder key for provider registration');
    }
    return resolveCustomEndpointProviderApiKey({
      apiKey,
      baseUrl: config?.baseUrl,
      authType: config?.authType,
    });
  }

  private reportCredentialChange(providerId: string, credential: Credential | undefined): void {
    const config = this.getConfig();
    const provider = config?.piAuth?.provider;
    if (!provider || providerId !== provider) return;
    if (credential?.type !== 'oauth') return;
    const fingerprint = JSON.stringify(credential);
    if (fingerprint === this.lastReportedOAuthCredential) return;
    this.lastReportedOAuthCredential = fingerprint;
    config.piAuth = { provider, credential };
    this.send({ type: 'credential_update', provider, credential });
  }
}
