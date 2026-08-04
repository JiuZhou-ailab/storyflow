// input: Provider connection settings, credentials, and the installed Pi model catalog
// output: Internal Pi driver configuration and model discovery
// pos: Minimal Storyflow configuration bridge into the Pi runtime

import type { ProviderDriver } from '../driver-types.ts';
import { getAllPiModels, getPiModelsForAuthProvider } from '../../../../config/models-pi.ts';

function resolvePiAuthProvider(connection: { providerType?: string; piAuthProvider?: string }): string | undefined {
  return connection.piAuthProvider || (connection.providerType === 'anthropic' ? 'anthropic' : undefined);
}

async function fetchCopilotModels(
  githubToken: string,
): Promise<ReturnType<typeof getPiModelsForAuthProvider>> {
  const { refreshGitHubCopilotToken } = await import('@earendil-works/pi-ai/oauth');
  const credentials = await refreshGitHubCopilotToken(githubToken);
  if (!Array.isArray(credentials.availableModelIds)) {
    throw new Error('Pi did not return the available GitHub Copilot models');
  }
  const availableModelIds = new Set(
    credentials.availableModelIds.filter((id): id is string => typeof id === 'string'),
  );
  return getPiModelsForAuthProvider('github-copilot')
    .filter(model => availableModelIds.has(model.id.replace(/^pi\//, '')));
}

export const piDriver: ProviderDriver = {
  provider: 'pi',
  buildRuntime: ({ context, providerOptions, resolvedPaths }) => ({
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
  }),
  fetchModels: async ({ connection, credentials }) => {
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
  },
  validateStoredConnection: async () => ({ success: true }),
};
