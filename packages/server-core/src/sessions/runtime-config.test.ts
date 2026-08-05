// input: Representative backend connections, runtime lineages, and attachments
// output: Regression coverage for runtime signatures, Pi migration, and attachment filtering
// pos: Focused tests for pure session-runtime policy

import { describe, expect, it } from 'bun:test'
import type { LlmConnection } from '@craft-agent/shared/config'
import type { FileAttachment } from '@craft-agent/shared/protocol'
import { formatAttachmentContextForModel } from '@craft-agent/shared/utils'
import { buildBackendRuntimeSignature, buildRestartRequiredSignature, filterAttachmentsForModelInput, needsPiRuntimeMigrationSeed, resetPortableForkRuntime, type PortableForkRuntimeState } from './runtime-config'

const baseCompat: LlmConnection = {
  slug: 'local',
  name: 'Local',
  providerType: 'pi_compat',
  authType: 'none',
  createdAt: 1,
  baseUrl: 'http://127.0.0.1:1234/v1',
  defaultModel: 'gemma',
  piAuthProvider: 'openai',
  customEndpoint: { api: 'openai-completions', supportsImages: true },
  models: [{ id: 'gemma', supportsImages: true } as never],
}

function sig(connection: LlmConnection) {
  return buildBackendRuntimeSignature({
    connection,
    authType: 'api_key',
    resolvedModel: 'gemma',
  })
}

const imageAttachment: FileAttachment = {
  type: 'image',
  path: '/tmp/image.png',
  name: 'image.png',
  mimeType: 'image/png',
  size: 123,
  base64: 'abc',
}

const textAttachment: FileAttachment = {
  type: 'text',
  path: '/tmp/note.txt',
  name: 'note.txt',
  mimeType: 'text/plain',
  size: 12,
  text: 'hello',
}

it('turns a portable Pi fork into an explicit seeded fresh runtime', () => {
  const state: PortableForkRuntimeState = {
    sdkSessionId: 'pi-session',
    agentRuntime: 'pi' as const,
    branchFromSdkSessionId: 'parent-session',
    branchFromSessionPath: '/source/.pi-sessions',
    branchFromSdkCwd: '/source',
    branchFromSdkTurnId: 'pi-entry',
    branchContextStrategy: 'sdk-fork' as const,
    branchSeedApplied: true,
  }

  resetPortableForkRuntime(state)

  expect(state).toEqual({
    sdkSessionId: undefined,
    agentRuntime: undefined,
    branchFromSdkSessionId: undefined,
    branchFromSessionPath: undefined,
    branchFromSdkCwd: undefined,
    branchFromSdkTurnId: undefined,
    branchContextStrategy: 'seeded-fresh-session',
    branchSeedApplied: false,
  })
})

describe('buildBackendRuntimeSignature', () => {
  it('changes when a custom endpoint model image override changes', () => {
    const enabled = sig(baseCompat)
    const disabled = sig({
      ...baseCompat,
      models: [{ id: 'gemma', supportsImages: false } as never],
    })

    expect(disabled).not.toBe(enabled)
  })

  it('ignores non-runtime metadata such as lastUsedAt', () => {
    expect(sig({ ...baseCompat, lastUsedAt: 1 })).toBe(sig({ ...baseCompat, lastUsedAt: 2 }))
  })
})

describe('buildRestartRequiredSignature', () => {
  it('changes when provider-wide context or cache settings change', () => {
    const base = {
      connection: baseCompat,
      authType: 'api_key' as const,
      resolvedModel: 'gemma',
      enable1MContext: false,
      extendedPromptCache: false,
    }

    expect(buildRestartRequiredSignature({ ...base, enable1MContext: true }))
      .not.toBe(buildRestartRequiredSignature(base))
    expect(buildRestartRequiredSignature({ ...base, extendedPromptCache: true }))
      .not.toBe(buildRestartRequiredSignature(base))
  })
})

describe('filterAttachmentsForModelInput', () => {
  it('omits images for pi_compat text-only models while preserving other attachments', () => {
    const result = filterAttachmentsForModelInput(
      [imageAttachment, textAttachment],
      { ...baseCompat, models: [{ id: 'gemma', supportsImages: false } as never] },
      'gemma',
    )

    expect(result.omittedImages.map(a => a.name)).toEqual(['image.png'])
    expect(result.attachments?.map(a => a.name)).toEqual(['note.txt'])
  })

  it('keeps images when the per-model override enables images', () => {
    const result = filterAttachmentsForModelInput([imageAttachment], baseCompat, 'gemma')

    expect(result.omittedImages).toHaveLength(0)
    expect(result.attachments).toEqual([imageAttachment])
  })

  it('treats explicit supportsImages=false as overriding endpoint-level true', () => {
    const result = filterAttachmentsForModelInput(
      [imageAttachment],
      { ...baseCompat, customEndpoint: { api: 'openai-completions', supportsImages: true }, models: [{ id: 'gemma', supportsImages: false } as never] },
      'gemma',
    )

    expect(result.omittedImages).toEqual([imageAttachment])
    expect(result.attachments).toBeUndefined()
  })
})

describe('formatAttachmentContextForModel', () => {
  it('prefers durable representations while preserving legacy path fallback', () => {
    expect(formatAttachmentContextForModel({
      ...textAttachment,
      storedPath: '/session/original.docx',
      markdownPath: '/legacy/readable.md',
      representations: [
        {
          kind: 'original',
          path: '/session/original.docx',
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          size: 12,
          sha256: 'source',
        },
        {
          kind: 'markdown',
          path: '/session/readable.md',
          mimeType: 'text/markdown',
          size: 10,
          sha256: 'derived',
        },
      ],
    })).toBe([
      '[Attached file: note.txt]',
      '[Stored at: /session/original.docx]',
      '[Readable version: /session/readable.md]',
    ].join('\n'))

    expect(formatAttachmentContextForModel(textAttachment)).toContain('[Stored at: /tmp/note.txt]')
  })
})

describe('needsPiRuntimeMigrationSeed', () => {
  it('seeds legacy sessions that have history but no Pi transcript', () => {
    expect(needsPiRuntimeMigrationSeed({
      legacyAgentRuntime: 'claude-sdk',
      hasPiTranscript: false,
      sdkSessionId: 'legacy-session',
      messageCount: 4,
    })).toBe(true)
  })

  it('does not reseed an existing Pi transcript', () => {
    expect(needsPiRuntimeMigrationSeed({
      legacyAgentRuntime: 'claude-sdk',
      hasPiTranscript: true,
      sdkSessionId: 'pi-session',
      messageCount: 4,
    })).toBe(false)
  })

  it('honors an explicit legacy Pi marker when its transcript is checked elsewhere', () => {
    expect(needsPiRuntimeMigrationSeed({
      legacyAgentRuntime: 'pi',
      hasPiTranscript: false,
      messageCount: 4,
    })).toBe(false)
  })

  it('seeds untagged legacy history instead of trusting an incompatible session id', () => {
    expect(needsPiRuntimeMigrationSeed({
      hasPiTranscript: false,
      sdkSessionId: 'untagged-session',
      messageCount: 1,
    })).toBe(true)
  })
})
