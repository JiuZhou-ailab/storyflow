// input: Pi SDK write tool factory and local filesystem operations.
// output: Craft write tool definition whose write operation can only create files.
// pos: Pi subprocess tool-contract adapter for file creation.

import { mkdir as fsMkdir, writeFile as fsWriteFile } from 'node:fs/promises';
import {
  createWriteToolDefinition,
  type WriteOperations,
} from '@earendil-works/pi-coding-agent';

function isFileExistsError(error: unknown): boolean {
  return error instanceof Error
    && 'code' in error
    && (error as NodeJS.ErrnoException).code === 'EEXIST';
}

export function createCreateOnlyWriteOperations(): WriteOperations {
  return {
    writeFile: async (absolutePath, content) => {
      try {
        await fsWriteFile(absolutePath, content, { encoding: 'utf-8', flag: 'wx' });
      } catch (error) {
        if (isFileExistsError(error)) {
          throw new Error(
            `File already exists: ${absolutePath}. Use edit with edits[].oldText/newText to modify existing files.`
          );
        }
        throw error;
      }
    },
    mkdir: async (dir) => {
      await fsMkdir(dir, { recursive: true });
    },
  };
}

export function createCreateOnlyWriteToolDefinition(cwd: string): ReturnType<typeof createWriteToolDefinition> {
  const tool = createWriteToolDefinition(cwd, {
    operations: createCreateOnlyWriteOperations(),
  });

  return {
    ...tool,
    description: 'Create a new file. Fails if the file already exists. Automatically creates parent directories.',
    promptSnippet: 'Create new files only',
    promptGuidelines: [
      'Use write only to create files that do not exist.',
      'To modify existing files, use edit with edits[].oldText/newText.',
    ],
  };
}
