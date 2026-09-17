// input: The independently built, browser-only Storyflow demo
// output: Full product viewport with external demo controls, loading and recovery
// pos: Marketing boundary; no product state crosses into the parent page
import { useEffect, useRef, useState } from 'react'

export function InteractiveDemo() {
  const frame = useRef<HTMLIFrameElement>(null)
  const [attempt, setAttempt] = useState(0)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [notice, setNotice] = useState('正在打开示例项目…')
  const reset = () => { setStatus('loading'); setNotice('正在打开示例项目…'); setAttempt(value => value + 1) }
  useEffect(() => {
    const timeout = window.setTimeout(() => setStatus('error'), 20000)
    const receive = (event: MessageEvent) => {
      if (event.origin !== location.origin || event.source !== frame.current?.contentWindow) return
      if (event.data?.type === 'storyflow-demo-ready') {
        clearTimeout(timeout)
        setStatus('ready')
      } else if (event.data?.type === 'storyflow-demo-error') {
        clearTimeout(timeout)
        setStatus('error')
      } else if (event.data?.type === 'storyflow-demo-notice' && typeof event.data.message === 'string') {
        setNotice(event.data.message)
      }
    }
    window.addEventListener('message', receive)
    return () => { clearTimeout(timeout); window.removeEventListener('message', receive) }
  }, [attempt])
  return (
    <div className="interactive-demo">
      <div id="demo-toolbar" aria-label="示例操作">
        <div><strong>交互演示</strong><span>示例内容 · 修改仅在本次体验中有效</span></div>
        <div>
          {([['continue', '续写一段'], ['rewrite', '改写悬念']] as const).map(([id, label]) => (
            <button key={id} data-scenario={id} disabled={status !== 'ready'} onClick={() => frame.current?.contentWindow?.postMessage({ type: 'storyflow-demo-scenario', id }, location.origin)}>{label}</button>
          ))}
          <button id="demo-reset" onClick={reset}>重置体验</button>
        </div>
      </div>
      <p id="demo-notice" role="status">{notice}</p>
      <iframe key={attempt} ref={frame} src="/demo/" title="Storyflow 交互演示" sandbox="allow-scripts allow-same-origin" />
      {status !== 'ready' && <div className="demo-loading" role="status">
        <p>{status === 'loading' ? '正在打开示例项目…' : '示例项目暂时无法打开。'}</p>
        {status === 'error' && <div className="button-row">
          <button className="button" onClick={reset}>重新打开</button>
          <a href="/docs/" className="button button-secondary" data-storyflow-page-link="true">阅读新手教程 →</a>
        </div>}
      </div>}
    </div>
  )
}
