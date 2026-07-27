// input: One to four structured questions and a session UI callback
// output: User answers returned to the waiting agent tool call
// pos: Provider-independent human-in-the-loop session tool handler

import type { SessionToolContext } from '../context.ts';
import { errorResponse, successResponse } from '../response.ts';
import { generateRequestId } from '../source-helpers.ts';
import type { UserQuestion } from '../types.ts';

export interface AskUserQuestionArgs {
  questions: UserQuestion[];
}

export async function handleAskUserQuestion(
  ctx: SessionToolContext,
  args: AskUserQuestionArgs,
) {
  if (!ctx.callbacks.onAskUserQuestion) {
    return errorResponse('Interactive questions are not supported by this host.');
  }

  const response = await ctx.callbacks.onAskUserQuestion({
    requestId: generateRequestId('question'),
    sessionId: ctx.sessionId,
    questions: args.questions,
  });

  return successResponse(JSON.stringify(response));
}
