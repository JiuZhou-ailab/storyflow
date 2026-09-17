// input: Production marketing preview and the ego-browser Page API
// output: Browser acceptance of the embedded Storyflow product demo
// pos: Public-page test seam for Spec #39; run with ego-browser nodejs
const config = globalThis.marketingQA || {};
const assert = (await import('node:assert/strict')).default;
const task = await taskSpace(config.space || 'Storyflow demo QA');
const page = task.page(config.page || 'p1');
const base = config.url || 'http://127.0.0.1:4176';
console.log({ space: task.spaceId, page: page.label });
await page.cdp('Network.enable');
await page.cdp('Emulation.setEmulatedMedia', { features: [] });
await page.events();
const { identifier: auditScript } = await page.cdp('Page.addScriptToEvaluateOnNewDocument', { source: `
  window.__demoNetworkAttempts = [];
  function observe(object, key, record) {
    const wrap = value => new Proxy(value, {
      apply(target, receiver, args) { record(args); return Reflect.apply(target, receiver, args); },
      construct(target, args, constructor) { record(args); return Reflect.construct(target, args, constructor); }
    });
    let value = wrap(object[key]);
    Object.defineProperty(object, key, { configurable: true, get: () => value, set: next => { value = wrap(next); } });
  }
  for (const key of ['fetch', 'WebSocket', 'EventSource', 'XMLHttpRequest']) {
    observe(window, key, args => window.__demoNetworkAttempts.push({ kind: key, url: String(args[0]?.url ?? args[0] ?? ''), method: args[1]?.method ?? args[0]?.method ?? 'GET' }));
  }
  observe(navigator, 'sendBeacon', args => window.__demoNetworkAttempts.push({ kind: 'beacon', url: String(args[0]) }));
` });
try {
const demoFrames = new Set();
const extensionRequests = new Set();
const requests = [];
async function auditNetwork() {
  const events = await page.events();
  // Logged-in browser extensions run in the same frame but outside the product world.
  // Exclude only requests with an explicit extension initiator, plus their preflights.
  for (const event of events) {
    if (event.method === 'Network.requestWillBeSent' && JSON.stringify(event.params.initiator).includes('chrome-extension://')) extensionRequests.add(event.params.requestId);
  }
  for (const event of events) {
    if (event.method === 'Network.requestWillBeSent') {
      const { request, frameId, type, initiator, requestId } = event.params;
      if (extensionRequests.has(requestId) || extensionRequests.has(initiator?.requestId)) continue;
      const url = new URL(request.url);
      if (['data:', 'blob:'].includes(url.protocol)) continue;
      if (type === 'Document' && url.pathname === '/demo/') demoFrames.add(frameId);
      if (!demoFrames.has(frameId)) continue;
      requests.push({ url: request.url, type });
      assert.equal(url.origin, new URL(base).origin, 'Demo only requests its own static origin');
      assert.ok(url.pathname === '/demo/' || url.pathname.startsWith('/demo/assets/') || url.pathname === '/favicon.ico', `Unexpected request: ${request.url}`);
    }
    if (event.method === 'Network.webSocketCreated') assert.fail(`Unexpected WebSocket: ${event.params.url}`);
  }
  const attempts = await page.evaluate(() => document.querySelector('iframe')?.contentWindow.__demoNetworkAttempts ?? []);
  for (const attempt of attempts) {
    assert.equal(attempt.kind, 'fetch', `Unexpected connection attempt: ${JSON.stringify(attempt)}`);
    assert.equal(attempt.method, 'GET');
    const url = new URL(attempt.url, base);
    assert.equal(url.origin, new URL(base).origin);
    assert.ok(url.pathname.startsWith('/demo/assets/'), `Unexpected fetch attempt: ${url}`);
  }
}

const chapterLink = 'ul a[href="%E7%AC%AC01%E7%AB%A0.md"]';
const body = () => page.evaluate(() => document.querySelector('iframe').contentDocument.body.innerText);
const editor = () => page.evaluate(() => document.querySelector('iframe').contentDocument.querySelector('.tiptap')?.textContent);
const waitText = (text) => page.waitForFunction(text => (document.getElementById('demo-notice')?.textContent + document.querySelector('iframe')?.contentDocument.body.innerText).includes(text), text, { timeout: 6000 }).catch(error => { throw new Error(`Missing visible content: ${text}`, { cause: error }); });
const waitEditor = (text) => page.waitForFunction(text => document.querySelector('iframe')?.contentDocument.querySelector('.tiptap[contenteditable="true"]')?.textContent.includes(text), text, { timeout: 6000 }).catch(error => { throw new Error(`Missing visible content: ${text}`, { cause: error }); });
async function fresh(width = 1440) {
  await auditNetwork();
  await page.cdp('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
  await page.goto(base);
  await page.reload();
  await page.waitForSelector('iframe[title="Storyflow 交互演示"]');
  await page.waitForFunction(() => !document.querySelector('.demo-loading') && document.querySelector('iframe')?.contentDocument.querySelectorAll('ul a[href="%E7%AC%AC01%E7%AB%A0.md"]').length === 1, undefined, { timeout: 15000 });
}
async function reset() {
  await auditNetwork();
  const before = await page.evaluate(() => document.querySelector('iframe').contentWindow.performance.timeOrigin);
  await page.click('#demo-reset');
  await page.waitForFunction(before => { const w = document.querySelector('iframe').contentWindow; return w.performance.timeOrigin !== before && document.getElementById('demo-notice')?.textContent.includes('点击第01章'); }, before, { timeout: 15000 });
}
async function openChapter() { await page.focus(chapterLink); await page.keyboard.press('Enter'); await waitEditor('第一章 · 黑洞直播'); }
async function backToChat(width) {
  if (width < 768) {
    await page.focus('loc=role:button[name="返回对话"]');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => !document.querySelector('iframe').contentDocument.querySelector('[role="dialog"]'));
  }
}
async function append(text) {
  await page.focus('.tiptap');
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type(text);
  await waitEditor(text);
}
async function scenario(id) {
  await page.click(`button[data-scenario="${id}"]`);
  await page.waitForFunction(() => document.querySelector('iframe').contentDocument.querySelector('[role="textbox"]')?.textContent.trim().length > 0);
  if (id === 'continue') await page.click('[data-tutorial="send-button"]');
  else await page.press('[role="textbox"]', 'Enter');
  await waitText('示例任务已完成');
  await waitText('已编辑 1 个文件');
}
for (const width of [1440, 390]) {
  await fresh(width);
  if (width === 1440) {
    const shell = await page.evaluate(() => {
      const d = document.querySelector('iframe').contentDocument;
      const visible = selector => { const r = d.querySelector(selector)?.getBoundingClientRect(); return !!r && r.width > 0 && r.height > 0; };
      const root = d.getElementById('root').getBoundingClientRect();
      const rail = d.querySelector('[aria-label="工作区导航"]')?.getBoundingClientRect();
      const collapse = d.querySelector('button[aria-label="收起侧边栏"]')?.getBoundingClientRect();
      return {
        fullViewport: root.top === 0 && Math.abs(root.height - d.defaultView.innerHeight) <= 1,
        navigation: !!rail && rail.width > 0,
        nativeTitlebar: !!collapse && !!rail && collapse.top >= rail.top && collapse.bottom <= rail.top + 40,
        inputTools: visible('button[aria-label="附加文件 / 选择技能 / 选择数据源"]') && visible('[aria-label^="运行权限："]'),
        model: [...d.querySelectorAll('form button')].some(button => button.textContent.includes('本地演示') && button.getBoundingClientRect().width > 0),
        hostControlsOutsideProduct: !!document.getElementById('demo-toolbar') && !d.getElementById('demo-toolbar'),
      };
    });
    assert.deepEqual(shell, { fullViewport: true, navigation: true, nativeTitlebar: true, inputTools: true, model: true, hostControlsOutsideProduct: true }, 'Preserve the complete product UI and its viewport coordinates');
    await page.click('button[aria-label="附加文件 / 选择技能 / 选择数据源"]');
    await page.waitForSelector('[role="menuitem"]:has-text("附加文件")');
    await page.keyboard.press('Escape');
    await page.click('button[aria-label="收起侧边栏"]');
    await page.click('button[aria-label="展开侧边栏"]');
    for (const destination of ['技能', '数据源']) {
      await page.click(`[aria-label="插件导航"] button:has-text("${destination}")`);
      await page.waitForFunction(() => !document.querySelector('iframe').contentDocument.querySelector('[role="textbox"]'));
      await page.click('button[data-scenario="continue"]');
      await waitText('已返回示例对话');
      await page.waitForSelector('[role="textbox"]');
      await scenario('continue');
      await reset();
    }
    console.log('PASS: full product navigation, native header coordinates, input toolbar, menus and return from auxiliary pages');
  } else {
    const headerFits = await page.evaluate(() => {
      const d = document.querySelector('iframe').contentDocument;
      const badge = d.querySelector('[data-testid="chat-project-badge"]');
      const title = [...d.querySelectorAll('h1')].find(node => node.textContent.includes('第一章'));
      const grid = badge.closest('.grid');
      const controls = grid.lastElementChild.getBoundingClientRect();
      const railControls = d.querySelector('[data-testid="activity-rail-titlebar-actions"]').getBoundingClientRect();
      return title.getBoundingClientRect().left >= railControls.right && badge.getBoundingClientRect().right <= controls.left;
    });
    assert.ok(headerFits, 'Compact product title and badge must not overlap native controls');
  }
  await openChapter();
  await append('这行是读者的手动修改。');
  await page.click('[role="treeitem"]:has-text("人物.md")');
  await waitEditor('科学主播');
  await page.click('[role="treeitem"]:has-text("创作要求.md")');
  await waitEditor('让读者跟着主角一起发现异常');
  await page.click('[role="treeitem"]:has-text("第01章.md")');
  await waitEditor('这行是读者的手动修改。');
  await backToChat(width);
  await scenario('continue');
  await page.click('loc=role:button[name="审核"]');
  await waitText('Pending review');
  await page.click('loc=role:button[name="Reject"]');
  await waitText('Rejected');
  await page.focus('button[aria-label="关闭"]');
  await page.keyboard.press('Enter');
  await openChapter();
  assert.ok(!(await editor()).includes('头像换成了他的房间'));
  assert.ok((await editor()).includes('这行是读者的手动修改。'));
  await backToChat(width);
  await reset();
  await openChapter();
  assert.ok(!(await editor()).includes('读者的手动修改'));
  await backToChat(width);
  await scenario('rewrite');
  await page.click('loc=role:button[name="审核"]');
  await page.click('loc=role:button[name="Accept"]');
  await waitText('Accepted');
  await page.focus('button[aria-label="关闭"]');
  await page.keyboard.press('Enter');
  await openChapter();
  assert.ok((await editor()).includes('螺丝便自己转了半圈'));
  await backToChat(width);
  console.log(`PASS: ${width}px edits, switches files, runs both scenarios, rejects safely, accepts and resets`);
}
await fresh();
await page.press('[role="textbox"]', 'Enter');
assert.ok(!(await body()).includes('已编辑 1 个文件'));
await page.click('button[data-scenario="rewrite"]');
await page.fill('[role="textbox"]', '这是编辑过的示例请求');
await page.press('[role="textbox"]', 'Enter');
await waitText('本页仅执行预设示例任务');
assert.equal(await page.evaluate(() => document.querySelector('iframe').contentDocument.querySelector('[role="textbox"]').textContent), '这是编辑过的示例请求');
assert.ok(!(await body()).includes('已编辑 1 个文件'));
await page.fill('[role="textbox"]', '请把这本小说写完');
await page.press('[role="textbox"]', 'Enter');
await waitText('本页仅执行预设示例任务');
assert.equal(await page.evaluate(() => document.querySelector('iframe').contentDocument.querySelector('[role="textbox"]').textContent), '请把这本小说写完');
await openChapter();
assert.ok(!(await editor()).includes('头像换成了他的房间'));
console.log('PASS: unsupported free text keeps its draft and does not mutate the file');
await auditNetwork();
// A second submit cannot duplicate the running edit; later unrelated edits survive rejection.
await fresh();
await page.click('button[data-scenario="continue"]');
await page.press('[role="textbox"]', 'Enter');
await page.press('[role="textbox"]', 'Enter');
await waitText('示例任务已完成');
await openChapter();
await waitEditor('头像换成了他的房间');
assert.equal((await editor()).split('头像换成了他的房间').length, 2);
await append('这行是在任务完成后写的。');
await page.click('[role="treeitem"]:has-text("人物.md")');
await waitEditor('科学主播');
await page.click('loc=role:button[name="审核"]');
await page.click('loc=role:button[name="Reject"]');
await waitText('Rejected');
await page.focus('button[aria-label="关闭"]');
await page.keyboard.press('Enter');
await openChapter();
assert.ok((await editor()).includes('这行是在任务完成后写的。'));
assert.ok(!(await editor()).includes('头像换成了他的房间'));
console.log('PASS: blank/edited input does not execute; repeated submit stays single; rejection preserves later unrelated edits');

// Reject an overlapping edit without overwriting the visitor's current text.
await fresh();
await scenario('rewrite');
await openChapter();
await page.fill('.tiptap', '第一章 · 黑洞直播\n\n苏白写下了不同的决定。');
await page.click('[role="treeitem"]:has-text("人物.md")');
await waitEditor('科学主播');
await page.click('loc=role:button[name="审核"]');
await page.click('loc=role:button[name="Reject"]');
await waitText('无法');
await page.focus('button[aria-label="关闭"]');
  await page.keyboard.press('Enter');
await openChapter();
assert.ok((await editor()).includes('苏白写下了不同的决定。'));
assert.ok(!(await editor()).includes('螺丝便自己转了半圈'));
console.log('PASS: overlapping manual edit blocks rejection without data loss');

await fresh();
await page.evaluate(() => localStorage.setItem('storyflow-demo-qa-sentinel', 'parent-only'));
assert.equal(await page.evaluate(() => document.querySelector('iframe').contentWindow.localStorage.getItem('storyflow-demo-qa-sentinel')), null);
const invalidFiles = await page.evaluate(async () => {
  const api = document.querySelector('iframe').contentWindow.electronAPI;
  return Promise.all(['/outside/no-file.md', '/demo-project/missing.md'].map(async path => {
    try { await api.readFile(path); return 'unexpected-success'; } catch (error) { return error.message; }
  }));
});
assert.ok(invalidFiles.every(message => message.includes('示例文件不存在')));
await page.click('button[aria-label="打开文件位置"]');
await waitText('完整功能请下载');
assert.ok(await page.evaluate(() => {
  const summary = document.querySelector('.demo-summary');
  const notice = document.getElementById('demo-notice');
  return summary.contains(notice) && Math.abs(summary.querySelector('strong').getBoundingClientRect().y - notice.getBoundingClientRect().y) < 3;
}), 'Temporary-demo label and compact notice share one line');
await page.click('button[data-scenario="continue"]');
await page.press('[role="textbox"]', 'Enter');
await reset();
// Wait past the old task deadline before inspecting the reset result.
await page.waitForFunction(() => document.querySelector('iframe').contentWindow.performance.now() > 1200);
assert.ok(!(await body()).includes('示例任务已完成'));
assert.equal(await page.evaluate(() => localStorage.getItem('storyflow-demo-qa-sentinel')), 'parent-only');
await openChapter();
assert.ok(!(await editor()).includes('头像换成了他的房间'));
await append('只在第一份体验中。');
const other = await task.newPage();
await other.goto(`${base}/demo/`);
await other.waitForSelector('.tiptap[contenteditable="true"]');
assert.ok(!(await other.evaluate(() => document.querySelector('.tiptap').textContent)).includes('只在第一份体验中'));
await other.close();
await page.reload();
await page.waitForFunction(() => !document.querySelector('.demo-loading'), undefined, { timeout: 15000 });
assert.ok(!(await editor()).includes('只在第一份体验中'));
await page.evaluate(() => localStorage.removeItem('storyflow-demo-qa-sentinel'));
console.log('PASS: reset cancels pending work; refresh, second instance, storage and file boundaries stay isolated');

for (const width of [1440, 768, 390, 320]) {
  await fresh(width);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `No page overflow at ${width}px`);
  await openChapter();
  assert.equal(await page.evaluate(() => { const d = document.querySelector('iframe').contentDocument; return d.documentElement.scrollWidth <= d.defaultView.innerWidth + 1; }), true, `No frame overflow at ${width}px`);
  if (config.output) await page.screenshot({ path: `${config.output}/demo-${width}.png` });
  await backToChat(width);
}
// Cross the responsive boundary before the editor's autosave deadline.
await fresh();
await append('宽屏切换前的编辑。');
await page.cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 900, deviceScaleFactor: 1, mobile: true });
await page.waitForFunction(() => document.querySelector('iframe').contentDocument.querySelectorAll('ul a[href="%E7%AC%AC01%E7%AB%A0.md"]').length === 1);
await openChapter();
await waitEditor('宽屏切换前的编辑。');
await append('窄屏切换前的编辑。');
await page.cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await waitEditor('窄屏切换前的编辑。');
await page.click('[role="treeitem"]:has-text("人物.md")');
await waitEditor('科学主播');
await page.click('[role="treeitem"]:has-text("第01章.md")');
await waitEditor('窄屏切换前的编辑。');
assert.ok((await editor()).includes('宽屏切换前的编辑。'));
await page.cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 900, deviceScaleFactor: 1, mobile: true });
await page.waitForFunction(() => document.querySelector('iframe').contentDocument.querySelector('[role="dialog"] .tiptap[contenteditable="true"]'));
await append('再次切换后继续编辑。');
await page.click('[role="treeitem"]:has-text("人物.md")');
await waitEditor('科学主播');
await page.click('[role="treeitem"]:has-text("第01章.md")');
await waitEditor('再次切换后继续编辑。');
console.log('PASS: unsaved text survives both responsive layout transitions');

await fresh();
await page.focus('#demo-reset');
await page.keyboard.press('Tab');
assert.equal(await page.evaluate(() => document.activeElement?.tagName), 'IFRAME', 'Keyboard enters product from the external demo controls');
await page.keyboard.press('Shift+Tab');
assert.notEqual(await page.evaluate(() => document.activeElement?.tagName), 'IFRAME', 'Keyboard can leave backwards');
await page.keyboard.press('Tab');
let exitedFrame = false;
for (let step = 0; step < 80; step++) {
  await page.keyboard.press('Tab');
  if (await page.evaluate(() => document.activeElement?.tagName !== 'IFRAME')) { exitedFrame = true; break; }
}
assert.ok(exitedFrame, 'Keyboard can leave the demo without a focus trap');
console.log('PASS: keyboard enters and exits iframe');
await page.cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
await fresh();
await scenario('rewrite');
await page.focus('loc=role:button[name="审核"]');
await page.keyboard.press('Enter');
await page.waitForSelector('loc=role:button[name="Accept"]');
await page.click('loc=role:button[name="Accept"]');
await waitText('Accepted');
await page.cdp('Emulation.setEmulatedMedia', { features: [] });
await auditNetwork();
console.log('PASS: four viewport widths, reduced motion and static-only request/connection audit');

await page.cdp('Network.setBlockedURLs', { urls: ['*/demo/assets/*.js'] });
await page.cdp('Network.setCacheDisabled', { cacheDisabled: true });
await page.reload();
await page.waitForFunction(() => document.querySelector('.demo-loading')?.textContent.includes('暂时无法'), undefined, { timeout: 25000 });
assert.ok(await page.evaluate(() => !!document.querySelector('.hero a[href="/docs/"]')));
assert.ok(await page.evaluate(() => document.querySelector('.hero').textContent.includes('下载')));
await page.cdp('Network.setBlockedURLs', { urls: [] });
await page.click('loc=role:button[name="重新打开"]');
await page.waitForFunction(() => !document.querySelector('.demo-loading'), undefined, { timeout: 15000 });
await openChapter();
await auditNetwork();
await page.cdp('Network.setCacheDisabled', { cacheDisabled: false });

if (config.output) {
  const fs = await import('node:fs/promises');
  await fs.writeFile(`${config.output}/demo-requests.json`, JSON.stringify(requests, null, 2));
}
console.log('PASS: static-load failure keeps navigation usable and retry restores the working product');
} finally {
  await page.cdp('Emulation.setEmulatedMedia', { features: [] });
  await page.cdp('Page.removeScriptToEvaluateOnNewDocument', { identifier: auditScript });
  await page.cdp('Network.setBlockedURLs', { urls: [] });
  await page.cdp('Network.setCacheDisabled', { cacheDisabled: false });
}
if (!config.space) await task.finish({ keep: [] });
