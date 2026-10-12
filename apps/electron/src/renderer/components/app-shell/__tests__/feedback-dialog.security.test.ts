// input: Native clipboard File batches and the real FeedbackDialog in Chromium
// output: User-visible screenshot validation, concurrent paste, and reset coverage
// pos: Exercises the feedback UI boundary without mocking attachment logic
import { expect, it } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'esbuild'

it('shows clear limits and cannot exceed them through concurrent pastes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'feedback-ui-'))
  try {
    const bundle = await build({
      stdin: { resolveDir: import.meta.dir, loader: 'tsx', contents: `
        import React from 'react'; import {createRoot} from 'react-dom/client';
        import i18n from 'i18next'; import {I18nextProvider} from 'react-i18next';
        import en from '@craft-agent/shared/i18n/locales/en.json';
        import {FeedbackDialog} from '../FeedbackDialog';
        function App() { const [open,setOpen]=React.useState(true); window.reopenFeedback=()=>setOpen(true);
          return <FeedbackDialog open={open} onOpenChange={setOpen}/>; }
        i18n.init({lng:'en', resources:{en:{translation:en}}}).then(()=>createRoot(document.getElementById('root')).render(<I18nextProvider i18n={i18n}><App/></I18nextProvider>));
      ` },
      tsconfig: join(import.meta.dir, '../../../../../tsconfig.json'),
      bundle: true, platform: 'browser', format: 'iife', write: false,
    })
    const checks = `async () => {
      const pause = () => new Promise(r => setTimeout(r, 25));
      const wait = async test => { for(let i=0;i<200;i++){if(test()) return; await pause();} throw new Error('UI timeout'); };
      await wait(()=>document.querySelector('#feedback-title'));
      const paste = files => { const data = new DataTransfer(); files.forEach(f=>data.items.add(f)); document.querySelector('#feedback-message').dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true})); };
      const file = size => { const data = new Uint8Array(size); const png=atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='); for(let i=0;i<Math.min(png.length,size);i++) data[i]=png.charCodeAt(i); return new File([data],'screenshot.png',{type:'image/png'}); };
      const error = () => document.querySelector('[role=alert]')?.textContent || '';
      const count = () => document.querySelectorAll('[role=dialog] img').length;
      const reset = async () => { [...document.querySelectorAll('button')].find(b=>b.textContent==='Cancel').click(); await pause(); window.reopenFeedback(); await wait(()=>document.querySelector('#feedback-title')); };
      paste([new File(['<svg/>'],'bad.svg',{type:'image/svg+xml'})]); await pause();
      const svg = { error:error(), count:count() }; await reset();
      paste([file(5*1024*1024+1)]); await pause();
      const single = { error:error(), count:count() }; await reset();
      paste([file(5*1024*1024),file(5*1024*1024),file(5*1024*1024)]); await wait(()=>count()===3);
      paste([file(1)]); await pause(); const total={error:error(),count:count()}; await reset();
      paste([file(4*1024*1024),file(4*1024*1024)]);
      paste([file(4*1024*1024),file(4*1024*1024)]);
      await wait(()=>error().includes('15 MiB')); const concurrent={error:error(),count:count()}; await reset();
      paste([file(5*1024*1024)]); await reset(); await pause();
      return {svg,single,total,concurrent,resetCount:count()};
    }`
    const script = join(dir, 'run.cjs')
    await writeFile(script, `const {app,BrowserWindow}=require('electron');
app.setPath('userData',${JSON.stringify(join(dir, 'profile'))});
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,webPreferences:{sandbox:true}});
 await win.loadURL('data:text/html,<div id="root"></div>');
 await win.webContents.executeJavaScript(${JSON.stringify(bundle.outputFiles[0]!.text)});
 console.log('RESULT:'+JSON.stringify(await win.webContents.executeJavaScript(${JSON.stringify(`(${checks})()`)})));
 app.quit();
}).catch(error=>{console.error(error);app.exit(1)});`)
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
    // Other suites mock electron globally; resolve its binary in a fresh Bun process.
    const binary = Bun.spawnSync([process.execPath, '-e', "process.stdout.write(require('electron'))"])
    expect(binary.exitCode, binary.stderr.toString()).toBe(0)
    const child = Bun.spawn([binary.stdout.toString(), script], { env, stdout: 'pipe', stderr: 'pipe' })
    const timer = setTimeout(() => child.kill(), 25_000)
    const [stdout, stderr, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    clearTimeout(timer)
    expect(exit, stderr).toBe(0)
    const result = JSON.parse(stdout.split('RESULT:')[1]!.trim())
    expect(result.svg.error).toContain('PNG, JPEG, GIF, or WebP')
    expect(result.svg.count).toBe(0)
    expect(result.single.error).toContain('5 MiB')
    expect(result.single.count).toBe(0)
    expect(result.total.error).toContain('15 MiB')
    expect(result.total.count).toBe(3)
    expect(result.concurrent.error).toContain('15 MiB')
    expect(result.concurrent.count).toBe(2)
    expect(result.resetCount).toBe(0)
  } finally { await rm(dir, { recursive: true, force: true }) }
}, 30_000)
