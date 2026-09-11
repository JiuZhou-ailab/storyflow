// input: Built Electron app and native rapid sidebar resize events
// output: Light/dark separator paint, per-frame width equality, collapse/reopen, and saved-width assertions
// pos: Offline regression for sidebar resize paint gaps
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {launchApp,evalOn,waitFor,sleep} from '../perf/launch'
const fixture=mkdtempSync(join(tmpdir(),'storyflow-rail-drag-'))
let app
try {
execFileSync(process.execPath,['run','scripts/perf/generate-fixture.ts','--out',fixture,'--scale','0.01'],{cwd:resolve(import.meta.dirname,'../..'),stdio:'pipe'})
app=await launchApp(fixture)
await waitFor(app,`document.querySelector('[aria-label="调整侧边栏宽度"]') && !document.querySelector('.z-splash')`)
await evalOn(app,`Array.from(document.querySelectorAll('[role="dialog"] button')).find(b=>/继续使用|Continue/.test(b.textContent))?.click()`)
await evalOn(app,`window.__dragFrames=[];window.__dragProbe=true;(()=>{const sample=()=>{if(!window.__dragProbe)return;const rail=document.querySelector('[data-testid="activity-rail"]'),wrapper=rail.parentElement;window.__dragFrames.push({time:performance.now(),rail:rail.getBoundingClientRect().width,wrapper:wrapper.getBoundingClientRect().width,background:getComputedStyle(wrapper).backgroundColor});requestAnimationFrame(sample)};sample()})()`)
const p=await evalOn(app,`(()=>{const r=document.querySelector('[aria-label="调整侧边栏宽度"]').getBoundingClientRect();return {x:r.right-3,y:r.top+300}})()`)
// Measure resolved paint, not class names: the visible seam belongs to the wrapper.
for (const theme of ['light', 'dark']) {
  await evalOn(app, `document.documentElement.classList.toggle('dark', ${theme === 'dark'})`)
  for (const state of ['idle', 'hover', 'focus']) {
    await app.cdp.send('Input.dispatchMouseEvent', {type:'mouseMoved', ...(state === 'hover' ? p : {x:600,y:300})}, app.sid)
    if (state === 'focus') {
      await app.cdp.send('Input.dispatchKeyEvent', {type:'keyDown',key:'Tab',code:'Tab'}, app.sid)
      await app.cdp.send('Input.dispatchKeyEvent', {type:'keyUp',key:'Tab',code:'Tab'}, app.sid)
      await evalOn(app, `document.querySelector('[aria-label="调整侧边栏宽度"]').focus()`)
    } else await evalOn(app, `document.activeElement?.blur()`)
    await sleep(250)
    const paint = await evalOn<{border:number;highlight:number;width:string;focus:boolean}>(app, `(() => {
      const handle=document.querySelector('[aria-label="调整侧边栏宽度"]');
      const wrapper=document.querySelector('[data-testid="activity-rail-motion"]');
      const ctx=document.createElement('canvas').getContext('2d');
      const alpha=color=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=color;ctx.fillRect(0,0,1,1);return ctx.getImageData(0,0,1,1).data[3]};
      return {border:alpha(getComputedStyle(wrapper).borderRightColor),highlight:alpha(getComputedStyle(handle.firstElementChild).backgroundColor),width:getComputedStyle(wrapper).borderRightWidth,focus:handle.matches(':focus-visible')};
    })()`)
    assert.equal(paint.width, '1px')
    assert.ok(paint.border > 0 && paint.border <= 8, `${theme}/${state}: visible seam must stay at 3% opacity, got ${paint.border}/255`)
    assert.ok(paint.highlight <= (state === 'focus' ? 16 : 8), `${theme}/${state}: highlight must remain subtle`)
    if (state === 'focus') assert.ok(paint.focus && paint.highlight > 0, 'Keyboard focus retains a visible highlight')
    if (process.env.CRAFT_E2E_SCREENSHOTS) {
      const shot=await app.cdp.send('Page.captureScreenshot',{format:'png'},app.sid)
      writeFileSync(join(process.env.CRAFT_E2E_SCREENSHOTS,`rail-${theme}-${state}.png`),Buffer.from(shot.data,'base64'))
    }
  }
}
await evalOn(app, `document.activeElement?.blur();document.documentElement.classList.remove('dark')`)
console.log('PASS: light/dark separator stays at 3% with bounded hover/focus paint')

await app.cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',...p},app.sid)
await app.cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',buttons:1,clickCount:1},app.sid)
await app.cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:p.x+120,y:p.y,button:'left',buttons:1},app.sid)
await sleep(400)
await app.cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:p.x-40,y:p.y,button:'left',buttons:1},app.sid)
await sleep(40)
if(process.env.CRAFT_E2E_SCREENSHOTS){
const shot=await app.cdp.send('Page.captureScreenshot',{format:'png'},app.sid)
writeFileSync(join(process.env.CRAFT_E2E_SCREENSHOTS,'activity-rail-resize.png'),Buffer.from(shot.data,'base64'))
}
await app.cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:p.x-40,y:p.y,button:'left',buttons:0,clickCount:1},app.sid)
await sleep(700)
const result=await evalOn<{peakGap:number;last:{rail:number;wrapper:number}}>(app,`window.__dragProbe=false;(()=>{const frames=window.__dragFrames;return {peakGap:Math.max(...frames.map(f=>Math.abs(f.wrapper-f.rail))),last:frames.at(-1)}})()`)
assert.ok(result.peakGap<=1,`Rail/container width mismatch: ${result.peakGap}px`)
assert.equal(result.last.rail,200)
assert.equal(result.last.wrapper,200)
await evalOn(app, `document.querySelector('[aria-label="收起侧边栏"]').click()`)
await waitFor(app, `!document.querySelector('[data-testid="activity-rail"]')`)
await evalOn(app, `document.querySelector('[aria-label="展开侧边栏"]').click()`)
await waitFor(app, `document.querySelector('[data-testid="activity-rail-motion"]')?.getBoundingClientRect().width === 200`)
await evalOn(app, `location.reload()`)
await waitFor(app, `document.querySelector('[aria-label="调整侧边栏宽度"]')?.getAttribute('aria-valuenow') === '200' && !document.querySelector('.z-splash')`)
console.log('PASS: every drag frame stays aligned; collapse/reopen and saved width work',result)
}finally{await app?.close();rmSync(fixture,{recursive:true,force:true})}
