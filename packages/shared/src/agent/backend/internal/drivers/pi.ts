// input: Provider connection settings, credentials, and the installed Pi model catalog
// output: Direct Pi runtime configuration and model discovery functions
// pos: Minimal Storyflow configuration bridge into the sole Pi runtime

import type { LlmConnection } from '../../../../config/storage.ts';
import { InMemoryCredentialStore } from '@earendil-works/pi-ai';
import { builtinModels } from '@earendil-works/pi-ai/providers/all';
import { getAllPiModels, getPiModelsForAuthProvider } from '../../../../config/models-pi.ts';
import type { ModelFetchResult } from '../../../../config/model-fetcher.ts';
import type { ResolvedBackendRuntimePaths } from '../runtime-resolver.ts';
import type {
  BackendModelFetchCredentials,
  BackendProviderOptions,
  BackendResolutionContext,
  BackendRuntimePayload,
} from '../driver-types.ts';

function resolvePiAuthProvider(connection: { providerType?: string; piAuthProvider?: string }): string | undefined {
  return connection.piAuthProvider || (connection.providerType === 'anthropic' ? 'anthropic' : undefined);
}

async function fetchCopilotModels(
  githubToken: string,
): Promise<ReturnType<typeof getPiModelsForAuthProvider>> {
  const credentials = new InMemoryCredentialStore();
  await credentials.modify('github-copilot', async () => ({
    type: 'oauth',
    access: '',
    refresh: githubToken,
    expires: 0,
  }));
  const models = builtinModels({ credentials });
  await models.getAuth('github-copilot');
  const refreshed = await credentials.read('github-copilot');
  const availableModelIds = refreshed?.type === 'oauth'
    ? refreshed.availableModelIds
    : undefined;
  if (!Array.isArray(availableModelIds)) {
    throw new Error('Pi did not return the available GitHub Copilot models');
  }
  const availableIds = new Set(
    availableModelIds.filter((id): id is string => typeof id === 'string'),
  );
  return getPiModelsForAuthProvider('github-copilot')
    .filter(model => availableIds.has(model.id.replace(/^pi\//, '')));
}

export function buildPiRuntime(args: {
  context: BackendResolutionContext;
  providerOptions?: BackendProviderOptions;
  resolvedPaths: ResolvedBackendRuntimePaths;
}): BackendRuntimePayload {
  const { context, providerOptions, resolvedPaths } = args;
  return {
    paths: {
      piServer: resolvedPaths.piServerPath,
      node: resolvedPaths.nodeRuntimePath,
    },
    piAuthProvider: providerOptions?.piAuthProvider
      || (context.connection ? resolvePiAuthProvider(context.connection) : undefined),
    baseUrl: context.connection?.baseUrl,
    customEndpoint: context.connection?.customEndpoint,
    customModels: context.connection?.models?.map(m => {
      if (typeof m === 'string') return m;
      const supportsImages = typeof m.supportsImages === 'boolean'
        ? m.supportsImages
        : undefined;
      const supportsThinking = typeof m.supportsThinking === 'boolean'
        ? m.supportsThinking
        : undefined;
      const thinkingLevelMap = m.thinkingLevelMap;
      if (
        m.contextWindow
        || supportsImages !== undefined
        || supportsThinking !== undefined
        || thinkingLevelMap !== undefined
      ) {
        return {
          id: m.id,
          ...(m.contextWindow ? { contextWindow: m.contextWindow } : {}),
          ...(supportsImages !== undefined ? { supportsImages } : {}),
          ...(supportsThinking !== undefined ? { supportsThinking } : {}),
          ...(thinkingLevelMap !== undefined ? { thinkingLevelMap } : {}),
        };
      }
      return m.id;
    }),
  };
}

export async function fetchPiModels(args: {
  connection: LlmConnection;
  credentials: BackendModelFetchCredentials;
}): Promise<ModelFetchResult> {
  const { connection, credentials } = args;
  const piAuthProvider = resolvePiAuthProvider(connection);
  const copilotGitHubToken = credentials.oauthRefreshToken || credentials.oauthAccessToken;
  if (piAuthProvider === 'github-copilot' && copilotGitHubToken) {
    return { models: await fetchCopilotModels(copilotGitHubToken) };
  }

  const models = piAuthProvider
    ? getPiModelsForAuthProvider(piAuthProvider)
    : getAllPiModels();

  if (models.length === 0) {
    throw new Error(`No Pi models found for provider: ${piAuthProvider ?? 'all'}`);
  }

  return { models };
}
