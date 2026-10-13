// input: Built Electron app and an isolated conversation with real text files
// output: Raw text, autosave, conflict choice, multi-file navigation and writing/source view acceptance
// pos: Offline Electron acceptance for the file workspace; no provider calls
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { launchApp, evalOn, waitFor, type LaunchedApp } from '../perf/launch'
const fixture = mkdtempSync(join(tmpdir(), 'storyflow-text-workspace-'))
let app: LaunchedApp | undefined
try {
  execFileSync(process.execPath, ['run', 'scripts/perf/generate-fixture.ts', '--out', fixture, '--scale', '0.01'], { cwd: resolve(import.meta.dirname, '../..'), stdio: 'pipe' })
  const configPath = join(fixture, 'config.json')
  const config = JSON.parse(readFileSync(configPath, 'utf8'))
  config.workspaces = []; delete config.activeWorkspaceId
  writeFileSync(configPath, JSON.stringify(config))
  app = await launchApp(fixture)
  let live = app
  await waitFor(live, `window.electronAPI && document.querySelector('[data-tutorial="activity-profile"]')`)
  await evalOn(live, `window.electronAPI.switchWorkspace('__storyflow_free__')`)
  await evalOn(live, `(() => { const u = new URL(location.href); u.search = '?workspaceId=__storyflow_free__&ws=__storyflow_free__&route=allSessions'; location.href = u.href })()`)
  await waitFor(live, `document.querySelector('[contenteditable="true"]')`)
  await evalOn(live, `Array.from(document.querySelectorAll('[role="dialog"] button')).find(b=>/继续使用|Continue/.test(b.textContent))?.click()`)
  await waitFor(live, `document.querySelector('button[aria-label="展开右侧栏"]')`)
  await evalOn(live, `document.querySelector('button[aria-label="展开右侧栏"]').click()`)
  const sessions = await evalOn<Array<{id: string; workingDirectory: string}>>(live, 'window.electronAPI.getSessions()')
  const session = sessions[0]!
  const original = '# 原文\n**不能变粗体**\n'
  const path = join(session.workingDirectory, 'source.txt')
  writeFileSync(path, original)
  const clickFile = async (name: string) => {
    const button = `Array.from(document.querySelectorAll('[data-testid="conversation-files"] [role="treeitem"]')).find(e=>e.textContent===${JSON.stringify(name)})`
    await waitFor(live, button)
    await evalOn(live, `${button}.click()`)
  }
  await clickFile('source.txt')
  await waitFor(live, `document.querySelector('[data-testid="text-source"]')?.value === ${JSON.stringify(original)}`)
  assert.equal(await evalOn(live, `document.querySelector('[data-testid="text-source"]').value`), original)
  assert.equal(await evalOn(live, `!!document.querySelector('[data-testid="conversation-preview"] .ProseMirror')`), false)
  assert.equal(readFileSync(path, 'utf8'), original)
  writeFileSync(join(session.workingDirectory, 'data.json'), '{ invalid json\n')
  await clickFile('data.json')
  await waitFor(live, `document.querySelector('[data-testid="text-source"]')?.value === '{ invalid json\\n'`)
  assert.equal(await evalOn(live, `document.querySelectorAll('[data-testid="conversation-files"] [role="tab"]').length`), 2)
  await clickFile('source.txt')
  assert.equal(await evalOn(live, `document.querySelectorAll('[data-testid="conversation-files"] [role="tab"]').length`), 2)
  console.log('PASS: raw text, invalid JSON, unchanged bytes and tab identity')
  await waitFor(live, `document.querySelector('[data-testid="text-source"]')?.value === ${JSON.stringify(original)}`)
  await evalOn(live, `(() => { const e=document.querySelector('[data-testid="text-source"]'); e.focus(); e.setSelectionRange(0,e.value.length) })()`)
  await live.cdp.send('Input.insertText', { text: '# 用户修改\n' }, live.sid)
  const status = `document.querySelector('[data-testid="text-document"] [role="status"]')?.textContent`
  const waitDisk = async (file: string, content: string) => {
    const deadline = Date.now() + 5000
    while (readFileSync(file, 'utf8') !== content) {
      if (Date.now() > deadline) throw new Error(`autosave did not reach ${file}: ${readFileSync(file, 'utf8')}`)
      await new Promise(resolve => setTimeout(resolve, 50))
    }
  }
  const selectSource = `(() => { const e=document.querySelector('[data-testid="text-source"]'); e.focus(); e.setSelectionRange(0,e.value.length) })()`
  const alertText = `document.querySelector('[data-testid="text-document"] [role="alert"]')?.textContent`
  const clickBar = (label: string) => evalOn(live, `Array.from(document.querySelectorAll('[data-testid="text-document"] button')).find(e=>e.textContent===${JSON.stringify(label)}).click()`)
  // The external write lands inside the autosave delay, so the draft always meets a newer disk version.
  const typeAgainstExternalWrite = async (file: string, draft: string, external: string) => {
    await evalOn(live, selectSource)
    await live.cdp.send('Input.insertText', { text: draft }, live.sid)
    writeFileSync(file, external)
    await waitFor(live, `${alertText}?.includes('磁盘内容已变化')`)
    assert.equal(readFileSync(file, 'utf8'), external)
  }
  await waitDisk(path, '# 用户修改\n')
  await waitFor(live, `${status} === '已保存'`)
  // Delay real RPC responses at the transport boundary to control race ordering.
  const contexts: Array<{id:number;name:string}> = []
  live.cdp.on('Runtime.executionContextCreated', event => contexts.push(event.context))
  await live.cdp.send('Runtime.disable',{},live.sid)
  await live.cdp.send('Runtime.enable',{},live.sid)
  const preload = contexts.find(context => context.name === 'Electron Isolated Context')!
  assert.ok(preload)
  const transport = async (expression: string) => {
    const result = await live.cdp.send('Runtime.evaluate',{contextId:preload.id,expression,returnByValue:true},live.sid)
    assert.equal(result.exceptionDetails,undefined)
    return result.result?.value
  }
  await transport(`(() => {
    const send=WebSocket.prototype.send;
    WebSocket.prototype.send=function(data) {
      const request=JSON.parse(data);
      if (request.type==='request' && request.channel===globalThis.__holdChannel) {
        globalThis.__holdChannel=null;
        const socket=this;
        const intercept=event=>{
          const response=JSON.parse(event.data);
          if(response.id!==request.id)return;
          event.stopImmediatePropagation();socket.removeEventListener('message',intercept,true);
          globalThis.__releaseReply=()=>socket.dispatchEvent(new MessageEvent('message',{data:event.data}));
        };
        socket.addEventListener('message',intercept,true);
      }
      return send.call(this,data);
    };
  })()`)
  const waitReply = async () => {
    for(let i=0;i<100;i++) { if(await transport('!!globalThis.__releaseReply'))return; await new Promise(r=>setTimeout(r,50)) }
    throw new Error('Delayed RPC response did not arrive')
  }
  const releaseReply = () => transport('globalThis.__releaseReply(); globalThis.__releaseReply=null')
  await transport("globalThis.__holdChannel='file:readDocument'")
  await evalOn(live, `document.querySelector('[data-testid="conversation-files"] button[aria-label="重试"]').click()`)
  await waitReply()
  await evalOn(live, `(() => {const e=document.querySelector('[data-testid="text-source"]');e.focus();e.setSelectionRange(0,e.value.length)})()`)
  await live.cdp.send('Input.insertText',{text:'保存后的新版本'},live.sid)
  await waitFor(live, `${status} === '已保存'`)
  await releaseReply()
  await new Promise(r=>setTimeout(r,100))
  assert.equal(await evalOn(live, `document.querySelector('[data-testid="text-source"]').value`),'保存后的新版本')
  console.log('PASS: late read cannot roll back a newer saved version')

  await typeAgainstExternalWrite(path, '未保存的草稿', 'Agent 的新版本')
  await clickFile('data.json')
  await waitFor(live, `document.querySelector('[role="dialog"]')?.textContent.includes('未保存修改')`)
  await evalOn(live, `Array.from(document.querySelectorAll('[role="dialog"] button')).find(e=>e.textContent==='取消').click()`)
  assert.equal(await evalOn(live, `document.querySelector('[data-testid="text-source"]').value`), '未保存的草稿')
  assert.equal(readFileSync(path,'utf8'),'Agent 的新版本')
  await clickBar('保留我的版本')
  await waitDisk(path, '未保存的草稿')
  await waitFor(live, `${status} === '已保存' && !${alertText}`)
  await typeAgainstExternalWrite(path, '要放弃的草稿', 'Agent 的第二版')
  await clickFile('data.json')
  await waitFor(live, `document.querySelector('[role="dialog"]')`)
  await evalOn(live, `Array.from(document.querySelectorAll('[role="dialog"] button')).find(e=>e.textContent==='放弃修改').click()`)
  await waitFor(live, `document.querySelector('[data-testid="text-source"]')?.value === '{ invalid json\\n'`)
  assert.equal(readFileSync(path,'utf8'),'Agent 的第二版')
  console.log('PASS: native input, autosave, conflict keeps both sides until the user chooses, keep/discard')
  const dataPath = join(session.workingDirectory, 'data.json')
  await typeAgainstExternalWrite(dataPath, '窗口关闭草稿', '{ agent json }\n')
  await evalOn(live, `void window.electronAPI.closeWindow()`)
  await waitFor(live, `document.querySelector('[role="dialog"]')?.textContent.includes('未保存修改')`)
  await evalOn(live, `Array.from(document.querySelectorAll('[role="dialog"] button')).find(e=>e.textContent==='取消').click()`)
  await new Promise(resolve => setTimeout(resolve, 3200))
  assert.equal(await evalOn(live, `document.querySelector('[data-testid="text-source"]').value`), '窗口关闭草稿')
  await clickBar('保留我的版本')
  await waitDisk(dataPath, '窗口关闭草稿')
  console.log('PASS: native window close cancel survives the close timeout')

  await live.close(); app = undefined
  const projectFixture = join(fixture,'project-run')
  execFileSync(process.execPath, ['run', 'scripts/perf/generate-fixture.ts', '--out', projectFixture, '--scale', '0.01'], { cwd: resolve(import.meta.dirname, '../..'), stdio: 'pipe' })
  const project = JSON.parse(readFileSync(join(projectFixture,'config.json'),'utf8')).workspaces[0]
  const projectFile = join(project.rootPath,'editor-acceptance.txt')
  writeFileSync(projectFile,'# Project 原文\n')
  const chapterFile = join(project.rootPath,'chapter.md')
  writeFileSync(chapterFile,'# 第一章\n\n开头\n')
  const projectSessions = join(project.rootPath,'.craft-agent','sessions')
  const projectSession = readdirSync(projectSessions)[0]!
  const transcript = join(projectSessions,projectSession,'session.jsonl')
  const header = JSON.parse(readFileSync(transcript,'utf8').split('\n')[0]!)
  const message = {id:'file-link',type:'assistant',content:'[editor-acceptance.txt]('+projectFile+')',timestamp:Date.now()}
  writeFileSync(transcript,JSON.stringify({...header,messageCount:1,lastFinalMessageId:'file-link',lastMessageRole:'assistant'})+'\n'+JSON.stringify(message)+'\n')
  app = await launchApp(projectFixture); live = app
  await waitFor(live, `document.querySelector('[data-tutorial="activity-profile"]')`)
  await evalOn(live, `window.electronAPI.switchWorkspace(${JSON.stringify(project.id)})`)
  await evalOn(live, `(() => { const u=new URL(location.href); u.search=new URLSearchParams({workspaceId:${JSON.stringify(project.id)},ws:${JSON.stringify(project.id)},route:'allSessions/session/${projectSession}'}).toString(); location.href=u.href })()`)
  await waitFor(live, `Array.from(document.querySelectorAll('a')).find(a=>a.textContent==='editor-acceptance.txt')`)
  await evalOn(live, `Array.from(document.querySelectorAll('[role="dialog"] button')).find(b=>/继续使用|Continue/.test(b.textContent))?.click()`)
  await evalOn(live, `document.querySelector('button[aria-label="展开右侧栏"]')?.click()`)
  await waitFor(live, `Array.from(document.querySelectorAll('[role="treeitem"]')).find(e=>e.textContent.includes('editor-acceptance.txt'))`)
  await evalOn(live, `Array.from(document.querySelectorAll('[role="treeitem"]')).find(e=>e.textContent.includes('editor-acceptance.txt')).click()`)
  await waitFor(live, `document.querySelector('[data-testid="text-source"]')?.value === ${JSON.stringify('# Project 原文\n')}`).catch(async error => { console.log(await evalOn(live, 'document.body.innerText')); throw error })
  await evalOn(live, `(() => { const e=document.querySelector('[data-testid="text-source"]'); e.focus(); e.setSelectionRange(0,e.value.length) })()`)
  await live.cdp.send('Input.insertText', {text:'Project 已保存\n'},live.sid)
  await waitDisk(projectFile,'Project 已保存\n')
  await waitFor(live, `${status} === '已保存'`)
  console.log('PASS: Project tree opens original text and saves through the same editor')

  const doc = `document.querySelector('[data-testid="text-document"]')`
  await evalOn(live, `Array.from(document.querySelectorAll('[role="treeitem"]')).find(e=>e.textContent.includes('chapter.md')).click()`)
  await waitFor(live, `${doc}?.dataset.documentView === 'writing' && ${doc}.querySelector('[contenteditable="true"]')?.textContent.includes('开头')`)
  await evalOn(live, `(() => { const e=${doc}.querySelector('[contenteditable="true"]'); e.focus(); const r=document.createRange(); r.selectNodeContents(e); r.collapse(false); const s=getSelection(); s.removeAllRanges(); s.addRange(r) })()`)
  await live.cdp.send('Input.insertText', {text:'写作视图输入'},live.sid)
  // Writing view autosaves; no explicit save is needed.
  const deadline = Date.now() + 5000
  while (!readFileSync(chapterFile,'utf8').includes('写作视图输入')) {
    if (Date.now() > deadline) throw new Error('writing view did not autosave: '+readFileSync(chapterFile,'utf8'))
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  await evalOn(live, `Array.from(${doc}.querySelectorAll('[role="radio"]')).find(e=>e.textContent==='原文').click()`)
  await waitFor(live, `${doc}.dataset.documentView === 'source' && document.querySelector('[data-testid="text-source"]')?.value.includes('写作视图输入')`)
  writeFileSync(chapterFile,'# 第一章\n\nagent 改写\n')
  // Project trees resync from disk when the window regains focus.
  await evalOn(live, `window.dispatchEvent(new Event('focus'))`)
  await waitFor(live, `document.querySelector('[data-testid="text-source"]')?.value === ${JSON.stringify('# 第一章\n\nagent 改写\n')}`)
  await evalOn(live, `Array.from(${doc}.querySelectorAll('[role="radio"]')).find(e=>e.textContent==='写作').click()`)
  await waitFor(live, `${doc}.querySelector('[contenteditable="true"]')?.textContent.includes('agent 改写')`)
  console.log('PASS: Markdown writing and source views share one autosaved draft that follows disk changes')

  // Opening, switching views and following a disk change must never rewrite untouched bytes.
  const irregular = 'Setext 标题\n===\n\n* 星号列表\n+ 加号列表\n\n*强调* 与 __粗体__  \n行尾两个空格\n\n| a | b |\n|---|:-:|\n| 1 | 2 |\n\n<div>原样 HTML</div>\n'
  const irregularFile = join(project.rootPath,'irregular.md')
  writeFileSync(irregularFile, irregular)
  await evalOn(live, `window.dispatchEvent(new Event('focus'))`)
  await waitFor(live, `Array.from(document.querySelectorAll('[role="treeitem"]')).find(e=>e.textContent.includes('irregular.md'))`)
  await evalOn(live, `Array.from(document.querySelectorAll('[role="treeitem"]')).find(e=>e.textContent.includes('irregular.md')).click()`)
  await waitFor(live, `${doc}?.dataset.documentView === 'writing' && ${doc}.querySelector('[contenteditable="true"]')?.textContent.includes('星号列表')`)
  await new Promise(resolve => setTimeout(resolve, 2000))
  await evalOn(live, `Array.from(${doc}.querySelectorAll('[role="radio"]')).find(e=>e.textContent==='原文').click()`)
  await waitFor(live, `${doc}.dataset.documentView === 'source'`)
  await evalOn(live, `Array.from(${doc}.querySelectorAll('[role="radio"]')).find(e=>e.textContent==='写作').click()`)
  const irregularExternal = irregular + '\n外部追加\n'
  writeFileSync(irregularFile, irregularExternal)
  await evalOn(live, `window.dispatchEvent(new Event('focus'))`)
  await waitFor(live, `${doc}.querySelector('[contenteditable="true"]')?.textContent.includes('外部追加')`)
  await new Promise(resolve => setTimeout(resolve, 2000))
  assert.equal(readFileSync(irregularFile,'utf8'), irregularExternal)
  console.log('PASS: viewing irregular Markdown in either view never rewrites its bytes')

} finally {
  await app?.close()
  rmSync(fixture, { recursive: true, force: true })
}