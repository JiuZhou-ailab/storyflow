// input: Abort requests interleaved with Pi prompt preparation
// output: Deterministic cancellation coverage before SDK prompt execution
// pos: Guards the JSONL prompt/abort concurrency boundary
import { expect, it, spyOn } from 'bun:test'
import { handleAbort, handlePrompt } from './index'

function gate() {
  let resolve!: () => void
  const promise = new Promise<void>(r => { resolve = r })
  return { promise, resolve }
}

for (const phase of ['creation', 'reload', 'compaction'] as const) {
  it(`does not prompt when aborted during ${phase}`, async () => {
    const entered = gate(), resume = gate()
    let prompts = 0
    const output: string[] = []
    const stdout = spyOn(process.stdout, 'write').mockImplementation((chunk: any) => { output.push(String(chunk)); return true })
    const session = {
      isCompacting: phase === 'compaction',
      isIdle: true,
      async reload() { if (phase === 'reload') { entered.resolve(); await resume.promise } },
      extensionRunner: { getRegisteredCommands: () => [] },
      subscribe() { if (phase === 'compaction') entered.resolve(); return () => {} },
      async prompt() { prompts++ },
    }
    try {
      const pending = handlePrompt({ type: 'prompt', id: phase, message: 'hello', systemPrompt: '' }, async () => {
        if (phase === 'creation') { entered.resolve(); await resume.promise }
        return session as never
      })
      await entered.promise
      await handleAbort()
      session.isCompacting = false
      resume.resolve()
      await pending
      expect(prompts).toBe(0)
      const results = output.flatMap(line => line.trim().split('\n')).map(line => JSON.parse(line))
      expect(results).toContainEqual({ type: 'prompt_result', id: phase, status: 'completed_without_agent' })
      expect(results.some(result => result.type === 'error')).toBe(false)
    } finally { stdout.mockRestore() }
  })
}
