// input: Electron ipcMain and the feedback submission adapter
// output: The preload feedback:submitIssue handler
// pos: Main-process feedback boundary; the renderer never holds the submit endpoint

import { ipcMain } from 'electron'
import { normalizeFeedbackIssueInput, submitFeedbackIssue } from '../feedback'

export function registerFeedbackIpc(deps: {
  fetch: (url: string, init?: RequestInit) => Promise<Response>
}): void {
  ipcMain.handle('feedback:submitIssue', async (_event, input: unknown) => {
    return submitFeedbackIssue(normalizeFeedbackIssueInput(input), {
      fetch: (url, init) => deps.fetch(url, init),
    })
  })
}
