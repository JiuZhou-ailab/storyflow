// input: Current built Electron app and isolated authored sample files
// output: Three-minute native UI recording with timestamps and capture provenance
// pos: Reproducible marketing material capture using the existing desktop harness
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  renameSync,
} from "node:fs";
import { join } from "node:path";
import { launchApp, evalOn, waitFor } from "../../../e2e/perf/launch";
const root = new URL("../../../", import.meta.url).pathname;
const destination = join(root, "apps/marketing/tutorial-video/assets");
mkdirSync(destination,{recursive:true});
const output = mkdtempSync("/tmp/storyflow-video-frames-");
const fixture = mkdtempSync("/tmp/storyflow-marketing-capture-");
execFileSync(
  "bun",
  [
    "run",
    "scripts/perf/generate-fixture.ts",
    "--out",
    fixture,
    "--scale",
    "0.01",
  ],
  { cwd: root, stdio: "pipe" },
);
const config = JSON.parse(readFileSync(join(fixture, "config.json"), "utf8"));
const ws = config.workspaces[0];
ws.name = "黑洞直播 · 示例项目";
writeFileSync(join(fixture, "config.json"), JSON.stringify(config));
const wc = join(ws.rootPath, ".craft-agent/config.json");
const wconfig = JSON.parse(readFileSync(wc, "utf8"));
wconfig.name = ws.name;
writeFileSync(wc, JSON.stringify(wconfig));
const directory = join(ws.rootPath, "黑洞直播");
mkdirSync(directory);
for (const name of ["全局", "正文"])
  rmSync(join(ws.rootPath, name), { recursive: true, force: true });
const chapter =
  "# 第一章 · 黑洞直播\n\n“兄弟们，今天给大家做一个很简单的物理小实验。”\n\n晚上八点十分，苏白准时开播。\n\n镜头里是一间不足十平米的出租屋。桌上摆着一颗黑色金属球。\n\n直播间人数：37。\n\n弹幕稀稀拉拉。\n\n【来了，苏老师今天又带大家养生啊。】\n\n苏白扫了眼弹幕，神色平静。他把金属球推到镜头前。\n\n“先说明，这不是玩具，也不是模型。”\n\n桌上的螺丝轻轻一颤，向球体滑了一寸。\n";
writeFileSync(join(directory, "第01章.md"), chapter);
writeFileSync(
  join(directory, "人物.md"),
  "# 人物\n\n## 苏白\n\n科学主播。平静、克制，让观众亲眼看到实验发生。\n",
);
writeFileSync(
  join(directory, "创作要求.md"),
  "# 创作要求\n\n让读者跟着主角一起发现异常。\n\n- 用动作制造悬念，不提前解释。\n- 对白自然，叙述克制。\n- 从只有 37 位观众的直播开始。\n",
);
const skillDir = join(ws.rootPath, ".pi/skills/chapter-review");
mkdirSync(skillDir, { recursive: true });
writeFileSync(
  join(skillDir, "SKILL.md"),
  "---\nname: chapter-review\ndescription: 逐章审查人物动机、叙事节奏与伏笔衔接，先给出原文依据，再提出修改建议。\n---\n\n# 章节审查\n\n## 检查顺序\n\n1. 阅读人物设定和前文章节。\n2. 标记动机不连贯、信息重复和悬念提前揭示的位置。\n3. 引用原文，说明原因，再给出可选改写。\n4. 等作者确认后，再修改文件。\n",
);
const sr = join(ws.rootPath, ".craft-agent/sessions");
const sid = readdirSync(sr)[0];
const sp = join(sr, sid, "session.jsonl");
const h = JSON.parse(readFileSync(sp, "utf8").split("\n")[0]);
for (const other of readdirSync(sr))
  if (other !== sid) rmSync(join(sr, other), { recursive: true });
const messages = [
  {
    id: "u1",
    type: "user",
    content:
      "参考人物设定和创作要求，写第一章的直播开场。先有异常，再揭示原因。",
    timestamp: Date.now() - 120000,
  },
  {
    id: "a1",
    type: "assistant",
    content:
      "第一章已整理到项目文件。开场先建立直播场景，再通过金属球附近的细节制造悬念。\n\n- [第01章.md](黑洞直播/第01章.md)：正文与开场钩子\n- [人物.md](黑洞直播/人物.md)：苏白的动机与表达方式\n- [创作要求.md](黑洞直播/创作要求.md)：叙述语气和悬念安排\n\n你可以在右侧阅读正文，选中需要调整的段落后继续讨论。",
    timestamp: Date.now() - 60000,
  },
];
writeFileSync(
  sp,
  [
    JSON.stringify({
      ...h,
      name: "第一章：让异常先发生",
      workingDirectory: ws.rootPath,
      messageCount: messages.length,
      lastFinalMessageId: "a1",
      lastMessageRole: "assistant",
    }),
    ...messages.map((x) => JSON.stringify(x)),
  ].join("\n") + "\n",
);

const sourcePath = join(ws.rootPath, ".craft-agent/sources/story-notes");
mkdirSync(sourcePath, { recursive: true });
writeFileSync(
  join(sourcePath, "config.json"),
  JSON.stringify({
    id: "story-notes",
    slug: "story-notes",
    name: "作品参考资料",
    enabled: true,
    provider: "local",
    type: "local",
    local: { path: directory, format: "filesystem" },
    tagline: "人物设定、创作要求与前文章节。",
    connectionStatus: "untested",
  }),
);
writeFileSync(
  join(sourcePath, "guide.md"),
  "# 作品参考资料\n\n先阅读人物与创作要求，再引用与当前任务有关的前文章节。\n",
);
const reviewId = "260911-review-example";
const reviewFolder = join(sr, reviewId);
mkdirSync(reviewFolder);
const edits = [
  {
    id: "u2",
    type: "user",
    content: "最后一句不要直接解释黑洞。改成一个看得见的动作。",
    timestamp: Date.now() - 5000,
  },
  {
    id: "edit-hook",
    type: "tool",
    toolName: "Edit",
    toolUseId: "edit-hook",
    toolInput: {
      file_path: join(directory, "第01章.md"),
      old_string: "桌上的金属球产生了引力，这就是黑洞。",
      new_string: "桌上的螺丝轻轻一颤，向球体滑了一寸。",
    },
    toolStatus: "completed",
    content: "已更新第01章.md",
    turnId: "turn-hook",
    timestamp: Date.now() - 3000,
  },
  {
    id: "a2",
    type: "assistant",
    content: "已把解释改成可观察的动作。比较修改前后的句子，再决定是否保留。",
    turnId: "turn-hook",
    timestamp: Date.now() - 1000,
  },
];
writeFileSync(
  join(reviewFolder, "session.jsonl"),
  [
    JSON.stringify({
      ...h,
      id: reviewId,
      name: "第一章：审阅悬念改写",
      workingDirectory: ws.rootPath,
      messageCount: edits.length,
      lastFinalMessageId: "a2",
      lastMessageRole: "assistant",
    }),
    ...edits.map((x) => JSON.stringify(x)),
  ].join("\n") + "\n",
);

const app = await launchApp(fixture);
const pause = (ms:number) => new Promise(r=>setTimeout(r,ms));
const actions: any[] = [];
let start=0;
const click = async (expression:string, label:string) => {
  await waitFor(app,expression,15000);
  const point = await evalOn(app,`(()=>{const e=${expression};e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await app.cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',...point},app.sid);
  await pause(400);
  await evalOn(app,`(${expression}).click()`);
  actions.push({at:(performance.now()-start)/1000,label,...point});
  console.log('ACTION',label);
};
const link=(name:string)=>`[...document.querySelectorAll('a')].find(a=>a.textContent===${JSON.stringify(name)})`;
const button=(name:string)=>`[...document.querySelectorAll('button')].find(a=>a.textContent.trim()===${JSON.stringify(name)})`;
const go=async(route:string)=>{
 await evalOn(app,`(()=>{const u=new URL(location.href);u.search=new URLSearchParams({workspaceId:${JSON.stringify(ws.id)},ws:${JSON.stringify(ws.id)},route:${JSON.stringify(route)}}).toString();location.href=u.href})()`);
 await waitFor(app,'document.querySelector("[data-tutorial=activity-profile]")');
};
const frames:{name:string,at:number}[]=[];
const shot=async(name:string)=>{
 const r=await app.cdp.send('Page.captureScreenshot',{format:'png'},app.sid);
 writeFileSync(join(destination,name+'.png'),Buffer.from(r.data,'base64'));
};
const at=async(seconds:number)=>{await pause(Math.max(0,seconds*1000-(performance.now()-start)));};
try{
 await waitFor(app,'document.querySelector("[data-tutorial=activity-profile]")');
 await evalOn(app,`[...document.querySelectorAll('[role="dialog"] button')].find(b=>/继续使用|Continue/.test(b.textContent))?.click()`);
 await app.cdp.send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:2,mobile:false},app.sid);
 await go('allSessions/session/'+sid);
 await click(link('第01章.md'),'打开正文');
 await waitFor(app,`document.querySelector('.ProseMirror')?.textContent.includes('第一章')`);
 await shot('before');
 actions.length=0;
 start=performance.now();
 app.cdp.on('Page.screencastFrame',(p)=>{
   const name=`frame-${String(frames.length).padStart(6,'0')}.jpg`;
   writeFileSync(join(output,name),Buffer.from(p.data,'base64'));
   frames.push({name,at:(performance.now()-start)/1000});
   void app.cdp.send('Page.screencastFrameAck',{sessionId:p.sessionId},app.sid);
 });
 await app.cdp.send('Page.startScreencast',{format:'jpeg',quality:94,maxWidth:2880,maxHeight:1800,everyNthFrame:2},app.sid);
 await at(23);await click(link('人物.md'),'阅读人物设定');
 await at(39);await click(link('创作要求.md'),'阅读创作要求');
 await at(57);await click(link('第01章.md'),'查看任务要求和正文');
 await at(78);
 await evalOn(app,`document.querySelector('.ProseMirror')?.scrollIntoView({block:'center'})`);
 await at(97);await go('allSessions/session/'+reviewId);
 await waitFor(app,`document.body.textContent.includes('已把解释改成')`);
 await at(104);await click(`document.querySelector('button:has(svg.lucide-files)')`,'打开修改对比');
 await waitFor(app,`document.body.textContent.includes('Accept') && document.body.textContent.includes('Reject')`);
 await shot('review');
 console.log('REVIEW_BUTTONS',await evalOn(app,`[...document.querySelectorAll('button')].map(e=>({text:e.textContent,aria:e.getAttribute('aria-label')})).filter(x=>/Accept|Reject/.test(x.text||''))`));
 await at(128);await click(button('Accept'),'接受示例修改');
 await at(141);await go('allSessions/session/'+sid);await click(link('第01章.md'),'返回正文');
 await at(150);await click(`document.querySelector('button[aria-label="版本管理"]')`,'打开版本管理');
 console.log('VERSION_DIALOG',await evalOn(app,`document.querySelector('[role="dialog"]')?.innerText`));
 await at(160);await click(button('保存'),'保存当前版本');
 await pause(1000);await shot('saved');
 console.log('SAVED_DIALOG',await evalOn(app,`document.querySelector('[role="dialog"]')?.innerText`));
 await at(176);
 for(const type of ['keyDown','keyUp'])await app.cdp.send('Input.dispatchKeyEvent',{type,key:'Escape',code:'Escape',windowsVirtualKeyCode:27},app.sid);
 await at(180);await app.cdp.send('Page.stopScreencast',{},app.sid);
 const end=(performance.now()-start)/1000;
 if(frames.length<10)throw new Error('Insufficient screencast frames');
 let concat='';
 frames.forEach((f,i)=>{concat+=`file '${join(output,f.name)}'\noption framerate 1000\nduration ${Math.max(.001,(frames[i+1]?.at??end)-f.at)}\n`;});
 concat+=`file '${join(output,frames.at(-1)!.name)}'\noption framerate 1000\n`;
 writeFileSync(join(output,'frames.txt'),concat);
 execFileSync('ffmpeg',['-y','-v','error','-f','concat','-safe','0','-i',join(output,'frames.txt'),'-vf','setpts=PTS-STARTPTS,fps=30','-t','180','-fps_mode','passthrough','-c:v','libx264','-preset','fast','-crf','16','-pix_fmt','yuv420p','-movflags','+faststart',join(destination,'native-recording.mp4')]);
 writeFileSync(join(destination,'provenance.json'),JSON.stringify({capturedAt:new Date().toISOString(),commit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),viewport:{width:1440,height:900},deviceScaleFactor:2,seconds:end,frames:frames.length,method:'Continuous CDP screencast of unmodified native Electron renderer. Isolated sample files and pre-authored conversations/tool trace; no model invocation. UI clicks, review acceptance and version save are real. No UI injection.',actions},null,2));
 execFileSync('ffmpeg',['-y','-v','error','-i',join(destination,'native-recording.mp4'),'-c:v','libx264','-preset','fast','-crf','16','-g','30','-keyint_min','30','-sc_threshold','0','-movflags','+faststart',join(destination,'native-seekable.mp4')]);
 rmSync(output,{recursive:true,force:true});
 console.log('DONE',end,frames.length);
} catch(error){await shot('failed');console.error(await evalOn(app,'document.body.innerText.slice(-4500)'));throw error;}
finally{await app.close();rmSync(fixture,{recursive:true,force:true});}
