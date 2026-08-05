import type { RecoveryMessage } from './core/index.ts';

const MAX_MESSAGE_CHARS = 500;
const MAX_TRANSCRIPT_CHARS = 12_000;

export interface ConversationSummaryOptions {
  maxMessageChars?: number;
  maxTranscriptChars?: number;
}

export function buildConversationSummaryTranscript(
  messages: RecoveryMessage[],
  options?: ConversationSummaryOptions,
): string {
  const maxMessageChars = options?.maxMessageChars ?? MAX_MESSAGE_CHARS;
  const maxTranscriptChars = options?.maxTranscriptChars ?? MAX_TRANSCRIPT_CHARS;

  const transcript = messages
    .map((message) => `${message.type === 'user' ? 'User' : 'Assistant'}: ${message.content.slice(0, maxMessageChars)}`)
    .join('\n\n');

  return transcript.slice(0, maxTranscriptChars);
}

export function buildConversationSummaryPrompt(messages: RecoveryMessage[]): string | null {
  if (messages.length === 0) return null;

  const transcript = buildConversationSummaryTranscript(messages);
  if (!transcript) return null;

  return (
    'Summarize this conversation concisely. Preserve: key decisions, ongoing tasks, ' +
    `technical context, and the user's current goal. Be specific, not generic.\n\n${transcript}`
  );
}

export async function generateConversationSummary(
  messages: RecoveryMessage[],
  runMiniCompletion: (prompt: string) => Promise<string | null>,
): Promise<string | null> {
  const prompt = buildConversationSummaryPrompt(messages);
  if (!prompt) return null;
  return runMiniCompletion(prompt);
}

export function buildTransferredSessionContext(summary: string): string {
  return `<session_transfer_summary>\nThis session was transferred from another workspace. The original conversation was summarized before transfer.\nUse the summary below as prior context for the next turn.\n\n${summary}\n</session_transfer_summary>`;
}

export function buildBranchSeedContext(messages?: RecoveryMessage[]): string | null {
  if (!messages?.length) return null;

  const transcript = messages
    .slice(-24)
    .map(message => {
      const role = message.type === 'user' ? 'User' : 'Assistant';
      const content = message.content.length > 1200
        ? `${message.content.slice(0, 1200)}...[truncated]`
        : message.content;
      return `[${role}]: ${content}`;
    })
    .join('\n\n');

  return `<branch_seed_context>
This is a branched conversation. The context below is the parent transcript up to the selected branch point.
Ignore and do not assume any parent messages that came after this cutoff.

${transcript}
</branch_seed_context>`;
}
