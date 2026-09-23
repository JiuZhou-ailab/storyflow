"""Regenerate the HyperFrames edit and fully synchronized narration subtitles from edit.json."""
import html
import json
from pathlib import Path

P = Path(__file__).resolve().parent
edit = json.loads((P / 'edit.json').read_text())
D = edit['duration']
assert 60 <= D <= 90
parts = ['''<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8">
<!-- input: Uninterrupted real Storyflow capture, edit.json and Chinese narration
output: 80-second HyperFrames tutorial with original live model results
pos: Independent tutorial-live composition; does not change the website or previous draft -->
<meta name="viewport" content="width=2560,height=1440">
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<style>
*{box-sizing:border-box;margin:0;padding:0}html,body{width:2560px;height:1440px;overflow:hidden;background:#f5f5f3;color:#202124;font-family:sans-serif;-webkit-font-smoothing:antialiased}
#root{position:relative;width:2560px;height:1440px;overflow:hidden}
.stage{position:absolute;left:200px;top:200px;width:2160px;height:1181.3878px;overflow:hidden;border-radius:18px;border:1px solid #20212422;box-shadow:0 20px 70px #20212414;background:#f5f5f3}
.shot{width:100%;height:100%;position:absolute;inset:0}.shot video{display:block;width:100%;height:100%;object-fit:contain}
.chapter{position:absolute;inset:65px 100px auto;height:70px;display:flex;align-items:center;gap:24px}.number{font-size:25px;color:#2456d6;font-weight:600}h2{font-size:38px;font-weight:600;letter-spacing:-1px}.chapter span:last-child{margin-left:auto;font-size:24px;color:#53565d}
.caption{position:absolute;left:100px;right:100px;top:135px;height:52px;display:flex;align-items:center;justify-content:center;font-size:40px;font-weight:500;z-index:5}
.footer{position:absolute;top:24px;height:30px;left:100px;right:100px;display:flex;justify-content:space-between;align-items:center;color:#53565d;font-size:22px;z-index:4}.footer strong{color:#202124;font-size:24px;margin-right:24px;font-weight:600}
.cover{position:absolute;inset:0;background:#f5f5f3;z-index:2}.scene-content{width:100%;height:100%;padding:160px 240px;display:flex;flex-direction:column;justify-content:center;gap:36px}
.kicker{font-size:28px;color:#2456d6;letter-spacing:4px;font-weight:600}h1{font-size:112px;letter-spacing:-4px;line-height:1.2;font-weight:600;max-width:2000px}.deck{font-size:42px;line-height:1.55;color:#53565d;max-width:1850px}.steps{display:flex;gap:36px;font-size:32px;margin-top:28px}.steps span:nth-child(even){color:#53565d}.rule{height:1px;width:100%;background:#20212422;margin-top:16px}.detail{font-size:26px;color:#53565d}.url{font-size:34px;color:#2456d6}
.transition{position:absolute;inset:0;background:#f5f5f3;z-index:6;pointer-events:none}.progress{position:absolute;bottom:0;left:0;right:0;height:5px;background:#20212412;z-index:8}.fill{height:100%;background:#2456d6;transform:scaleX(0);transform-origin:left center}
</style></head><body><div id="root" data-composition-id="main" data-start="0" data-duration="80" data-width="2560" data-height="1440">
<div class="stage" data-layout-allow-overflow>''']
anim=[]
for i,c in enumerate(edit['cuts']):
 assert c['source'] >= 0 and c['source']+c['duration'] < 300
 parts.append(f'<div class="shot" id="shot-{i}"><video id="video-{i}" class="clip" data-start="{c["start"]}" data-duration="{c["duration"]}" data-media-start="{c["source"]}" data-track-index="0" src="assets/live-seekable.mp4" muted playsinline></video></div>')
 scale,origin=c['focus'];s=c['start']
 anim.append(f"tl.from('#shot-{i}',{{opacity:0,duration:.45,ease:'sine.out'}},{s});tl.to('#shot-{i}',{{scale:{scale},transformOrigin:'{origin}',duration:1.1,ease:'power2.inOut'}},{s+.45});")
parts.append('</div>')
parts.append('''<div id="intro" class="cover clip" data-start="0" data-duration="5" data-track-index="4"><div class="scene-content"><div class="kicker">STORYFLOW / 第一次真实写作</div><h1>把想法，写成故事。</h1><p class="deck">从一句任务，到一份经过审阅的开场。</p><div class="steps"><span>说清任务</span><span>→</span><span>检查正文</span><span>→</span><span>审阅修改</span></div><div class="rule"></div><p class="detail">5 分钟真实操作，剪成 80 秒。</p></div></div>
<div id="outro" class="cover clip" data-start="73" data-duration="7" data-track-index="4"><div class="scene-content"><div class="kicker">现在，换你来试一次</div><h1>开始你的创作。</h1><p class="deck">给出目标，读懂结果，再决定保留什么。</p><div class="url">分步教程 · story.zjding.com/docs/</div></div></div>
<div class="footer"><div><strong>Storyflow</strong>真实运行 · DeepSeek V4 Flash</div><span>等待与排障已剪短 · 中文合成旁白 · 01:20</span></div><div class="progress"><div class="fill"></div></div>''')
for i,c in enumerate(edit['cuts']):
 s=c['start'];parts.append(f'<div id="chapter-{i}" class="chapter clip" data-start="{s}" data-duration="{c["duration"]}" data-track-index="3"><span class="number">{i+1:02}</span><h2>{c["title"]}</h2><span>雨夜便利店 / 第一次练习</span></div>')
 anim.append(f"tl.from('#chapter-{i} .number',{{opacity:0,y:8,duration:.4,ease:'sine.out'}},{s+.1});tl.from('#chapter-{i} h2',{{opacity:0,y:14,duration:.55,ease:'power3.out'}},{s+.15});tl.from('#chapter-{i} span:last-child',{{opacity:0,duration:.5,ease:'power1.out'}},{s+.2});")
sub=[]
def stamp(t):
 n=round(t*1000);return f'{n//3600000:02}:{n//60000%60:02}:{n//1000%60:02},{n%1000:03}'
for i,c in enumerate(edit['cues']):
 s=c['start'];d=c['duration'];end=s+d;assert end<=D
 parts.append(f'<audio id="voice-{i}" data-start="{s}" data-duration="{d}" data-track-index="1" src="{c["audio"]}" data-volume="1"></audio>')
parts.append('<audio id="music" data-start="0" data-duration="80" data-track-index="9" src="assets/narration/music-ducked.wav" data-volume="1"></audio>')
for i,c in enumerate(json.loads((P/'subtitles.json').read_text())):
 s=c['start'];end=c['end'];d=end-s
 parts.append(f'<div id="caption-{i}" class="caption clip" data-start="{s}" data-duration="{d}" data-track-index="2">{html.escape(c["text"])}</div>')
 anim.append(f"tl.from('#caption-{i}',{{opacity:0,duration:.18,ease:'sine.out'}},{s});tl.set('#caption-{i}',{{opacity:0}},{end});")
 sub.append(f'{i+1}\n{stamp(s)} --> {stamp(end)}\n{c["text"]}\n')
for i,t in enumerate([5,13,23,31,43,53,65,73]):
 parts.append(f'<div id="transition-{i}" class="transition clip" data-start="{t-.25}" data-duration=".5" data-track-index="7"></div>')
 anim.append(f"tl.fromTo('#transition-{i}',{{opacity:0}},{{opacity:1,duration:.25,ease:'sine.inOut'}},{t-.25});tl.to('#transition-{i}',{{opacity:0,duration:.25,ease:'sine.inOut'}},{t});")
parts.append('</div><script>const tl=gsap.timeline({paused:true});')
for which,s in [('intro',0),('outro',73)]:
 for selector,y,d,ease,offset in [('.kicker',12,.4,'sine.out',.15),('h1',32,.7,'power3.out',.3),('.deck',18,.6,'power2.out',.55)]:
  anim.append(f"tl.from('#{which} {selector}',{{opacity:0,y:{y},duration:{d},ease:'{ease}'}},{s+offset});")
anim += ["tl.from('#intro .steps',{opacity:0,y:18,duration:.5,ease:'sine.out'},.8);tl.from('#intro .rule',{scaleX:0,transformOrigin:'left center',duration:.8,ease:'power2.out'},.9);tl.from('#intro .detail',{opacity:0,duration:.5,ease:'power1.out'},1.1);tl.from('#outro .url',{opacity:0,y:12,duration:.5,ease:'sine.out'},73.8);tl.to('.fill',{scaleX:1,duration:80,ease:'none'},0);"]
parts.extend(anim);parts.append('window.__timelines=window.__timelines||{};window.__timelines["main"]=tl;</script></body></html>')
(P/'index.html').write_text('\n'.join(parts))
(P/'transcript.srt').write_text('\n'.join(sub))
print('Built 80 seconds, 7 real footage cuts, 9 narration cues.')
