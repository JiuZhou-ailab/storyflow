// input: The independently built, browser-only Storyflow demo
// output: Accessible product frame with loading, retry and tutorial recovery
// pos: Marketing boundary; no product state crosses into the parent page
import { useEffect, useRef, useState } from 'react'

export function InteractiveDemo() {
  const frame = useRef<HTMLIFrameElement>(null)
  const [attempt, setAttempt] = useState(0)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
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
      }
    }
    window.addEventListener('message', receive)
    return () => { clearTimeout(timeout); window.removeEventListener('message', receive) }
  }, [attempt])
  return (
    <div className="interactive-demo">
      <iframe key={attempt} ref={frame} src="/demo/" title="Storyflow 交互演示" sandbox="allow-scripts allow-same-origin" />
      {status !== 'ready' && <div className="demo-loading" role="status">
        <p>{status === 'loading' ? '正在打开示例项目…' : '示例项目暂时无法打开。'}</p>
        {status === 'error' && <div className="button-row">
          <button className="button" onClick={() => { setStatus('loading'); setAttempt(value => value + 1) }}>重新打开</button>
          <a href="/docs/" className="button button-secondary" data-storyflow-page-link="true">阅读新手教程 →</a>
        </div>}
      </div>}
    </div>
  )
}
