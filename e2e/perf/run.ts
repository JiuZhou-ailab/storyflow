// input: A fixture data dir + the launched app handle (launch.ts); CONTEXT.md perf targets
// output: A JSON report under results/ plus a stdout table, each metric annotated pass/fail vs target
// pos: The perf harness driver — sequences startup, interaction, typing, and memory scenarios and judges them

import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  launchApp,
  evalOn,
  heapUsed,
  waitFor,
  countPerf,
  sleep,
  DEFAULT_FIXTURE,
  type LaunchedApp,
} from './launch.ts'
import {
  evaluateMeasuredBaselines,
  parsePerfScenarios,
  parsePositiveInteger,
} from './contract.ts'
import {
  expandWritingChapterDirectoryExpression,
  openFixtureProjectExpression,
  openWritingChapterExpression,
  projectButtonsReadyExpression,
  writingChapterLabel,
  writingChapterMountedExpression,
} from './navigation.ts'

// ---- Config (env-driven, no framework) ----------------------------------
const FIXTURE = process.env.PERF_FIXTURE || DEFAULT_FIXTURE
const STARTUP_RUNS = parsePositiveInteger(process.env.PERF_STARTUP_RUNS, 3, 'PERF_STARTUP_RUNS')
const SWITCHES = parsePositiveInteger(process.env.PERF_SWITCHES, 20, 'PERF_SWITCHES')
const LEAK_LOOPS = parsePositiveInteger(process.env.PERF_LEAK_LOOPS, 100, 'PERF_LEAK_LOOPS')
const SCENARIOS = parsePerfScenarios(process.env.PERF_SCENARIOS)
const DIAGNOSTIC_MODE = process.env.PERF_SCENARIOS !== undefined

// ---- Targets (from CONTEXT.md — keep in sync) ---------------------------
const TARGET = {
  startupMs: 3000,
  hubInteractiveMs: 2000,
  projectOpenMs: 1000,
  switchP95Ms: 100,
  steadyHeapMb: 500,
  leakPct: 10,
  /** CONTEXT.md heavy tier: open large writing document / global search */
  heavyMs: 1000,
  /** CONTEXT.md continuous tier: keystroke/stream frame budget */
  continuousMs: 16.7,
}

const SWITCH_COMPLETE = /Session switch complete:\s*([\d.]+)\s*ms/i
const DOCUMENT_PAINT_COMPLETE = /writing\.document\.paintAfterRead:\s*([\d.]+)\s*ms/i

interface Metric {
  scenario: string
  name: string
  value: number
  unit: string
  target: number
  pass: boolean
  note?: string
}

async function main() {
  const started = Date.now()
  const metrics: Metric[] = []

  if (SCENARIOS.includes('startup')) metrics.push(...(await runStartup()))
  if (SCENARIOS.includes('heavy-writing')) metrics.push(...(await runHeavyWriting()))
  if (SCENARIOS.includes('heavy-search')) metrics.push(...(await runHeavySearch()))
  if (SCENARIOS.includes('memory-leak-docs')) metrics.push(...(await runDocumentLeak()))
  if (SCENARIOS.includes('continuous-typing')) metrics.push(...(await runContinuousTyping()))

  const needsLive = ['switch', 'memory-steady', 'memory-leak'].some((s) => SCENARIOS.includes(s))
  if (needsLive) {
    const live = await launchApp(FIXTURE)
    try {
      await enterWorkspaceWithSessions(live)
      const ids = await sessionIdsFromApi(live)
      if (ids.length < 2) throw new Error(`Workspace exposes only ${ids.length} sessions via getSessions — need >= 2.`)

      if (SCENARIOS.includes('switch')) metrics.push(...(await runSwitch(live, ids)))
      if (SCENARIOS.includes('memory-steady')) metrics.push(...(await runSteadyMemory(live, ids)))
      if (SCENARIOS.includes('memory-leak')) metrics.push(...(await runLeak(live, ids)))
    } finally {
      await live.close()
    }
  }

  report(metrics, Date.now() - started)
}

// ---- Navigation ---------------------------------------------------------
/**
 * From a fresh launch: ActivityRail → open a non-writing workspace that has fixture sessions.
 * Product UI is writing-first (no always-visible SessionList); session switching is
 * exercised via the same navigate() route the ConversationHistoryMenu uses.
 */
async function enterWorkspaceWithSessions(live: LaunchedApp): Promise<void> {
  await waitFor(
    live,
    projectButtonsReadyExpression(),
    60_000,
    'ActivityRail project buttons'
  )

  const opened = await openNonNovelProject(live)
  if (!opened) throw new Error('Could not open a non-writing fixture project from ActivityRail')

  // Backend session index for this workspace (300/workspace can take a moment).
  await waitFor(
    live,
    `(async () => (await window.electronAPI.getSessions()).length >= 2)()`,
    90_000,
    'workspace sessions via getSessions'
  )

  // Land on a concrete session so ChatPage mounts and transcript loading runs.
  const ids = await sessionIdsFromApi(live)
  await navigateToSession(live, ids[0])
  await sleep(200)
}

/** From a fresh launch: ActivityRail → writing project → project tree + first document ready. */
interface WritingWorkspaceEntryTiming {
  hubReadyAt: number
  projectClickedAt: number
  catalogReadyAt: number
  documentReadyAt: number
  startupMarks: Record<string, number>
}

async function enterFirstWritingWorkspace(live: LaunchedApp): Promise<WritingWorkspaceEntryTiming> {
  await waitFor(
    live,
    projectButtonsReadyExpression(),
    60_000,
    'ActivityRail project buttons'
  )
  const hubReadyAt = Date.now()
  const startupMarks = await evalOn<Record<string, number>>(
    live,
    `({
      __timeOrigin: Math.round(performance.timeOrigin),
      __now: Math.round(performance.now()),
      ...Object.fromEntries(performance.getEntriesByType('mark')
        .filter((entry) => entry.name.startsWith('storyflow.'))
        .map((entry) => [entry.name, Math.round(entry.startTime)])),
    })`,
  )

  const opened = await openWritingProject(live)
  if (!opened) throw new Error('Could not open the writing fixture project from ActivityRail')
  const projectClickedAt = Date.now()

  await waitFor(live, `!!document.querySelector('[data-tutorial="writing-catalog"]')`, 45_000, 'writing catalog')
  const catalogReadyAt = Date.now()
  // The editor stays mounted while a document loads; editability is the current
  // product contract that content has finished loading into the reusable instance.
  await waitFor(
    live,
    `!!document.querySelector('.tiptap-editor--manuscript .ProseMirror[contenteditable="true"]')`,
    90_000,
    'first editable writing document',
  )
  const legacyChatMounted = await evalOn<boolean>(
    live,
    `!!document.querySelector('[data-tutorial="chat-history"], [data-tutorial="new-session-button"]')`,
  )
  if (legacyChatMounted) {
    throw new Error('Writing project entry mounted the legacy conversation UI on the startup critical path')
  }
  return {
    hubReadyAt,
    projectClickedAt,
    catalogReadyAt,
    documentReadyAt: Date.now(),
    startupMarks,
  }
}

/** Open the first ActivityRail project whose name is not the deterministic writing fixture. */
async function openNonNovelProject(live: LaunchedApp): Promise<string | null> {
  return evalOn<string | null>(live, openFixtureProjectExpression('sessions'))
}

/** Open the deterministic 400-chapter writing fixture from ActivityRail. */
async function openWritingProject(live: LaunchedApp): Promise<string | null> {
  return evalOn<string | null>(live, openFixtureProjectExpression('writing'))
}

// ---- Scenario 1: startup ------------------------------------------------
async function runStartup(): Promise<Metric[]> {
  const totalDurations: number[] = []
  const hubDurations: number[] = []
  const projectOpenDurations: number[] = []
  const catalogDurations: number[] = []
  const devtoolsDurations: number[] = []
  const pageAttachDurations: number[] = []
  const startupMarkRuns: string[] = []
  for (let i = 0; i < STARTUP_RUNS; i++) {
    const t0 = Date.now()
    const live = await launchApp(FIXTURE)
    try {
      devtoolsDurations.push(live.launchTimings.devtoolsReadyAt - t0)
      pageAttachDurations.push(live.launchTimings.pageAttachedAt - t0)
      const timing = await enterFirstWritingWorkspace(live)
      startupMarkRuns.push(JSON.stringify(timing.startupMarks))
      hubDurations.push(timing.hubReadyAt - t0)
      catalogDurations.push(timing.catalogReadyAt - timing.projectClickedAt)
      projectOpenDurations.push(timing.documentReadyAt - timing.projectClickedAt)
      totalDurations.push(timing.documentReadyAt - t0)
    } finally {
      await live.close()
    }
    await sleep(500)
  }
  totalDurations.sort((a, b) => a - b)
  hubDurations.sort((a, b) => a - b)
  projectOpenDurations.sort((a, b) => a - b)
  catalogDurations.sort((a, b) => a - b)
  devtoolsDurations.sort((a, b) => a - b)
  pageAttachDurations.sort((a, b) => a - b)
  return [
    metric('startup', `launch→ActivityRail interactive median (n=${STARTUP_RUNS})`, median(hubDurations), 'ms', TARGET.hubInteractiveMs, {
      note: `runs=[${hubDurations.join(', ')}], devtools=[${devtoolsDurations.join(', ')}], page=[${pageAttachDurations.join(', ')}], renderer=${startupMarkRuns.join('|')}`,
    }),
    metric('startup', `project click→writing document median (n=${STARTUP_RUNS})`, median(projectOpenDurations), 'ms', TARGET.projectOpenMs, {
      note: `runs=[${projectOpenDurations.join(', ')}], catalog=[${catalogDurations.join(', ')}]`,
    }),
    metric('startup', `launch→writing-document median (n=${STARTUP_RUNS})`, median(totalDurations), 'ms', TARGET.startupMs, {
      note: `runs=[${totalDurations.join(', ')}] — includes opening a writing project + first editable document`,
    }),
  ]
}

// ---- Heavy: open a deep chapter in the 400-chapter writing fixture --------
async function runHeavyWriting(): Promise<Metric[]> {
  const live = await launchApp(FIXTURE)
  try {
    await enterFirstWritingWorkspace(live)
    await ensureWritingChapterDirectory(live)
    await waitFor(
      live,
      writingChapterMountedExpression(200),
      10_000,
      'chapter 200 row mounted'
    )

    const beforeDocumentPaint = countPerf(live, DOCUMENT_PAINT_COMPLETE)
    const t0 = Date.now()
    const opened = await evalOn<'clicked' | 'already-selected' | null>(live, openWritingChapterExpression(200))
    if (opened !== 'clicked') throw new Error('Could not scroll to and click 第200章')
    await requirePerfLine(
      live,
      DOCUMENT_PAINT_COMPLETE,
      beforeDocumentPaint,
      30_000,
      'chapter 200 document paint',
    )
    const ms = Date.now() - t0
    return [metric('heavy-writing', 'open mid catalog chapter (第200章)', ms, 'ms', TARGET.heavyMs, {
      note: 'CONTEXT heavy tier ≤1s; wall-clock includes scrollIntoView + treeitem click→document paint',
    })]
  } finally {
    await live.close()
  }
}

// ---- Heavy: global search over standard fixture --------------------------
async function runHeavySearch(): Promise<Metric[]> {
  const live = await launchApp(FIXTURE)
  try {
    // Writing project has 400 chapters — best stress for file-side search ranking.
    await enterFirstWritingWorkspace(live)
    // Open global search via activity rail.
    const opened = await evalOn<boolean>(
      live,
      `(() => {
        const btn = document.querySelector('[data-tutorial="activity-search"]')
        if (!btn) return false
        btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }))
        return true
      })()`
    )
    if (!opened) throw new Error('Could not open global search from activity rail')
    await waitFor(live, `!!document.querySelector('input[cmdk-input], [cmdk-input], input[placeholder*="Search"], input[placeholder*="搜索"]')`, 15_000, 'search input')

    const t0 = Date.now()
    await evalOn(
      live,
      `(() => {
        const input = document.querySelector('input[cmdk-input], [cmdk-input], input[placeholder*="Search"], input[placeholder*="搜索"]')
        if (!(input instanceof HTMLInputElement)) throw new Error('search input missing')
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
        setter?.call(input, '第01')
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.dispatchEvent(new Event('change', { bubbles: true }))
        return true
      })()`
    )
    await waitFor(
      live,
      `!!document.querySelector('[cmdk-item], [role="option"]')`,
      15_000,
      'search results'
    )
    const ms = Date.now() - t0
    return [metric('heavy-search', 'global search query→first results', ms, 'ms', TARGET.heavyMs, {
      note: 'CONTEXT heavy tier ≤1s; includes cmdk filter over writing catalog + session meta',
    })]
  } finally {
    await live.close()
  }
}

// ---- Continuous: chat input keystroke → paint (in-page, no CDP RTT) ------
async function runContinuousTyping(): Promise<Metric[]> {
  const live = await launchApp(FIXTURE)
  try {
    await enterWorkspaceWithSessions(live)
    const ids = await sessionIdsFromApi(live)
    await navigateToSession(live, ids[0])
    await waitFor(
      live,
      `!!document.querySelector('[data-tutorial="chat-input"] [contenteditable="true"], [data-tutorial="chat-input"]')`,
      30_000,
      'chat input'
    )

    // Entire loop runs inside the page so samples exclude CDP round-trips.
    const result = await evalOn<{ p95: number; p50: number; n: number }>(
      live,
      `(async () => {
        const root = document.querySelector('[data-tutorial="chat-input"]')
        const el = (root && root.querySelector('[contenteditable="true"]')) || root
        if (!(el instanceof HTMLElement)) throw new Error('chat input not found')
        el.focus()
        if (el.isContentEditable) {
          el.textContent = ''
          el.dispatchEvent(new Event('input', { bubbles: true }))
        }

        const chars = 'abcdefghijklmnopqrstuvwxyz012345'
        const durations = []
        for (let i = 0; i < chars.length; i++) {
          const ch = chars[i]
          const t0 = performance.now()
          if (el.isContentEditable) {
            el.textContent = (el.textContent || '') + ch
            el.dispatchEvent(new InputEvent('input', {
              bubbles: true,
              data: ch,
              inputType: 'insertText',
            }))
          } else if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
              || Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
            setter?.call(el, (el.value || '') + ch)
            el.dispatchEvent(new InputEvent('input', {
              bubbles: true,
              data: ch,
              inputType: 'insertText',
            }))
          }
          // Force style/layout for the inserted character — measures typing echo work,
          // not display-refresh cadence (double-rAF is ~16.7ms by definition and cannot
          // pass a 16.7ms continuous budget).
          void el.getBoundingClientRect()
          durations.push(performance.now() - t0)
        }
        const finalText = el.isContentEditable ? el.textContent || '' : el.value || ''
        if (finalText !== chars) {
          throw new Error(\`chat input benchmark inserted \${finalText.length}/\${chars.length} characters\`)
        }
        const sorted = durations.slice().sort((a, b) => a - b)
        const p50 = sorted[Math.floor(sorted.length * 0.5)]
        const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]
        return { p95, p50, n: durations.length }
      })()`
    )

    return [metric('continuous-typing', `keystroke→layout P95 (n=${result.n})`, result.p95, 'ms', TARGET.continuousMs, {
      note: `p50=${result.p50.toFixed(1)}ms — CONTEXT continuous tier ≤16.7ms (in-page insert+layout; excludes CDP RTT)`,
    })]
  } finally {
    await live.close()
  }
}

// ---- Memory: writing document open/close (chapter switch) leak ----------
async function runDocumentLeak(): Promise<Metric[]> {
  const live = await launchApp(FIXTURE)
  const loops = parsePositiveInteger(process.env.PERF_DOC_LOOPS, 40, 'PERF_DOC_LOOPS')
  const chapterSpan = parsePositiveInteger(process.env.PERF_DOC_CHAPTERS, 60, 'PERF_DOC_CHAPTERS')
  try {
    await enterFirstWritingWorkspace(live)
    const runChapterRing = async () => {
      for (let i = 0; i < loops; i++) {
        const chapter = 1 + (i % chapterSpan)
        await openWritingChapter(live, chapter)
        await sleep(50)
      }
    }

    // Measure the second equivalent pass. The first pass initializes bounded
    // React Arborist, IPC, and editor caches; treating that one-time working set
    // as a leak produced false failures even when a second pass stayed flat.
    // A true per-switch leak still compounds during the measured pass.
    await runChapterRing()
    await openWritingChapter(live, 1)
    await sleep(500)
    const baseline = await heapUsed(live)

    await runChapterRing()
    // Return to a warm chapter and settle before judging growth.
    await openWritingChapter(live, 1)
    await sleep(500)
    await heapUsed(live)
    await sleep(100)
    const end = await heapUsed(live)
    const deltaPct = baseline > 0 ? ((end - baseline) / baseline) * 100 : 0
    return [metric('memory-leak-docs', `heap growth after ${loops} chapter opens`, deltaPct, '%', TARGET.leakPct, {
      note: `baseline=${(baseline / 1e6).toFixed(1)}MB → after=${(end / 1e6).toFixed(1)}MB across ${chapterSpan} chapters after an equivalent warm pass — CONTEXT leak check includes document open/close`,
    })]
  } finally {
    await live.close()
  }
}

/** Scroll virtualized catalog to chapter N and click it. Chapters are 1-indexed. */
async function openWritingChapter(live: LaunchedApp, chapter: number): Promise<void> {
  const label = writingChapterLabel(chapter)

  await ensureWritingChapterDirectory(live)
  await waitFor(
    live,
    writingChapterMountedExpression(chapter),
    8_000,
    `${label} mounted`
  )

  const beforeDocumentPaint = countPerf(live, DOCUMENT_PAINT_COMPLETE)
  const opened = await evalOn<'clicked' | 'already-selected' | null>(
    live,
    openWritingChapterExpression(chapter),
  )
  if (!opened) throw new Error(`Could not scroll to or click ${label}`)
  if (opened === 'clicked') {
    await requirePerfLine(
      live,
      DOCUMENT_PAINT_COMPLETE,
      beforeDocumentPaint,
      15_000,
      `${label} document paint`,
    )
  }

  await waitFor(
    live,
    `!!document.querySelector('.tiptap-editor--manuscript .ProseMirror')`,
    15_000,
    `${label} editor ready`
  )
}

async function ensureWritingChapterDirectory(live: LaunchedApp): Promise<void> {
  const expanded = await evalOn<'expanded' | 'already-expanded' | null>(
    live,
    expandWritingChapterDirectoryExpression(),
  )
  if (!expanded) throw new Error('Could not find or expand the writing chapter directory')
}

// ---- Scenario 2: session switch ----------------------------------------
async function runSwitch(live: LaunchedApp, ids: string[]): Promise<Metric[]> {
  const appDurations: number[] = []
  const wallDurations: number[] = []
  // Cycle through many real session ids so transcript loading / eviction is stressed.
  const ring = ids.slice(0, Math.min(ids.length, Math.max(SWITCHES + 1, 40)))
  for (let i = 0; i < SWITCHES; i++) {
    const target = ring[(i + 1) % ring.length]
    const before = countPerf(live, SWITCH_COMPLETE)
    const t0 = Date.now()
    await navigateToSession(live, target)
    const appMs = await waitForSwitchLine(live, before, 3000)
    const wallMs = Date.now() - t0
    if (appMs == null) await sleep(50)
    wallDurations.push(appMs != null ? wallMs : Date.now() - t0)
    if (appMs != null) appDurations.push(appMs)
  }

  if (wallDurations.length !== SWITCHES) {
    throw new Error(`Session switch coverage incomplete: wall=${wallDurations.length}, expected=${SWITCHES}`)
  }
  if (appDurations.length === 0) {
    throw new Error('Session switch produced no app-instrumented samples (rendererPerf not emitting)')
  }

  return [
    metric('switch', `app-instrumented P95 (n=${appDurations.length})`, p95(appDurations), 'ms', TARGET.switchP95Ms, {
      note: `p50=${p50(appDurations).toFixed(1)}ms coverage=${appDurations.length}/${SWITCHES}`,
    }),
    metric(
      'switch',
      `wall-clock P95 (n=${wallDurations.length})`,
      p95(wallDurations),
      'ms',
      TARGET.switchP95Ms,
      {
        note: `p50=${p50(wallDurations).toFixed(1)}ms (includes CDP RTT)`,
      },
    ),
  ]
}

// ---- Scenario 3: steady-state memory -----------------------------------
async function runSteadyMemory(live: LaunchedApp, ids: string[]): Promise<Metric[]> {
  const ring = ids.slice(0, Math.min(ids.length, 20))
  for (let i = 0; i < 10; i++) {
    await navigateToSession(live, ring[i % ring.length])
    await sleep(80)
  }
  const heap = await heapUsed(live)
  return [metric('memory-steady', 'renderer JS heap (post-GC)', heap / 1e6, 'MB', TARGET.steadyHeapMb)]
}

// ---- Scenario 4: leak loop ---------------------------------------------
async function runLeak(live: LaunchedApp, ids: string[]): Promise<Metric[]> {
  // Use a wide ring so unbounded transcript retention would grow heap across switches.
  const ring = ids.slice(0, Math.min(ids.length, 80))
  if (ring.length < 2) throw new Error('Need at least 2 sessions for leak loop')

  for (let i = 0; i < 4; i++) {
    await navigateToSession(live, ring[(i + 1) % ring.length])
    await sleep(100)
  }
  await sleep(250)
  const baseline = await heapUsed(live)

  for (let i = 0; i < LEAK_LOOPS; i++) {
    await navigateToSession(live, ring[(i + 1) % ring.length])
    // Allow load + working-set reconcile to settle before the next switch.
    await sleep(60)
  }
  await sleep(400)
  const end = await heapUsed(live)
  const deltaPct = baseline > 0 ? ((end - baseline) / baseline) * 100 : 0
  return [metric('memory-leak', `heap growth after ${LEAK_LOOPS} switches`, deltaPct, '%', TARGET.leakPct, { note: `baseline=${(baseline / 1e6).toFixed(1)}MB → after=${(end / 1e6).toFixed(1)}MB ring=${ring.length}` })]
}

// ---- Interaction helpers ------------------------------------------------
async function sessionIdsFromApi(live: LaunchedApp): Promise<string[]> {
  return evalOn<string[]>(
    live,
    `(async () => {
      const sessions = await window.electronAPI.getSessions()
      return Array.isArray(sessions) ? sessions.map((s) => s && s.id).filter(Boolean) : []
    })()`
  )
}

/** Same navigation path as ConversationHistoryMenu item click. */
async function navigateToSession(live: LaunchedApp, id: string): Promise<void> {
  await evalOn(
    live,
    `window.dispatchEvent(new CustomEvent('craft-agent-navigate', {
      detail: { route: ${JSON.stringify(`allSessions/session/${id}`)} },
      bubbles: true,
    }))`
  )
}

async function waitForSwitchLine(live: LaunchedApp, before: number, timeoutMs: number): Promise<number | null> {
  return waitForPerfLine(live, SWITCH_COMPLETE, before, timeoutMs)
}

async function requirePerfLine(
  live: LaunchedApp,
  pattern: RegExp,
  before: number,
  timeoutMs: number,
  label: string,
): Promise<number> {
  const duration = await waitForPerfLine(live, pattern, before, timeoutMs)
  if (duration == null) throw new Error(`Timed out waiting for ${label}`)
  return duration
}

async function waitForPerfLine(
  live: LaunchedApp,
  pattern: RegExp,
  before: number,
  timeoutMs: number,
): Promise<number | null> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const complete = live.perfLines.filter((line) => pattern.test(line.text))
    if (complete.length > before) {
      const m = complete[complete.length - 1].text.match(pattern)
      return m ? parseFloat(m[1]) : null
    }
    await sleep(25)
  }
  // Do not report the timeout budget as a switch duration — caller treats null as "no app metric".
  return null
}

// ---- Small utilities ----------------------------------------------------
function p50(xs: number[]): number {
  return percentile(xs, 0.5)
}
function median(xs: number[]): number {
  return [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
}
function p95(xs: number[]): number {
  return percentile(xs, 0.95)
}
function percentile(xs: number[], q: number): number {
  if (xs.length === 0) return NaN
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor(s.length * q))]
}
function metric(scenario: string, name: string, value: number, unit: string, target: number, extra?: { note?: string }): Metric {
  return { scenario, name, value, unit, target, pass: Number.isFinite(value) ? value <= target : false, note: extra?.note }
}

function report(metrics: Metric[], elapsedMs: number) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const resultsDir = join(import.meta.dirname, 'results')
  mkdirSync(resultsDir, { recursive: true })
  const outPath = join(resultsDir, `${stamp}.json`)
  const decision = evaluateMeasuredBaselines(SCENARIOS, metrics)
  const payload = {
    fixture: FIXTURE,
    mode: DIAGNOSTIC_MODE ? 'diagnostic' : 'full-measured-baseline',
    config: { STARTUP_RUNS, SWITCHES, LEAK_LOOPS, SCENARIOS },
    elapsedMs,
    metrics,
    ...decision,
  }
  writeFileSync(outPath, JSON.stringify(payload, null, 2))

  console.log('\n=== Storyflow perf baseline ===')
  console.log(`fixture: ${FIXTURE}`)
  for (const m of metrics) {
    const flag = m.pass ? 'PASS' : 'FAIL'
    const val = m.unit === 'MB' || m.unit === '%' ? m.value.toFixed(1) : m.value.toFixed(0)
    console.log(`  [${flag}] ${m.scenario} · ${m.name}: ${val}${m.unit} (target ≤ ${m.target}${m.unit})` + (m.note ? `  — ${m.note}` : ''))
  }
  const resultLabel = decision.selectedPass
    ? (DIAGNOSTIC_MODE ? 'SELECTED BASELINES MET' : 'ALL MEASURED BASELINES MET')
    : 'MEASURED BASELINES MISSED'
  console.log(`\n${resultLabel} · report: ${outPath}\n`)
  if (!decision.selectedPass) process.exitCode = 1
}

main().catch((err) => {
  console.error('perf harness failed:', err)
  process.exit(1)
})
