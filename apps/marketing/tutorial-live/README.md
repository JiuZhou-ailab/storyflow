# Storyflow 真实写作练习

正常登录的 `/Applications/Storyflow.app` v0.21.3，使用 `deepseek-v4-flash` 完成两次真实请求：生成开场、局部改写。连续录制 299.998 秒，使用 HyperFrames 剪成 80 秒，输出 2560×1440、30fps，中文神经语音旁白、全文逐句字幕与很轻的背景音乐。没有使用旧版的预置对话或离线运行环境。

## 交付

- `renders/storyflow-live-80s-v2.mp4`：80 秒成片。
- `assets/storyflow-live-raw.mov`：完整 5 分钟、4096×2320 原片，无麦克风音轨。
- `index.html`：可编辑 HyperFrames 工程；`edit.json` 保存原片入点、时长和旁白。
- `transcript.srt`：完整旁白软字幕；`assets/narration/voice-*.wav` 为晓晓神经语音；句子时间戳来自语音服务，覆盖全部旁白。
- `assets/provenance.json`：模型、会话、本地成果、原片校验值和运行中遇到的问题。

## 剪辑逻辑

先给出目标，再按确认模型、提出任务、允许写入、检查初稿、局部修改、审核接受、核对结果的顺序演示。原片中的等待、工具重试、文件名处理被剪短；保留片段按原速播放。采用比例一致的真实界面、局部放大、克制转场和界面外字幕。片中不把耗时说成实时，也不声称这次运行没有错误。

## 真实运行中发现的问题

1. `ask_user` 调用出错，模型自行切换到 `ask_user_question` 后完成确认。
2. 首次 Edit 因未先读取文件失败；模型读取文件后重试成功，用户级操作只允许这一次 Edit。
3. 模型把书名号写进了文件名 `《开场.md》`，导致 Markdown 预览未识别。在原片结束后，通过 Finder 将文件纠正为 `opening.md`，未更改正文。应用内重命名入口未显示可编辑字段。
4. 录制前客户端曾不重绘，正常退出并重启后恢复；录制沿用原登录状态。

实际成果保留在 `/Users/dingzhijian/Documents/Storyflow演示/雨夜便利店/opening.md`。`first-draft.md` 与 `revised-draft.md` 的字节内容来自真实文件，已验证只有最后一段改变。因文件名更正发生在录制之后，片中的旧名称与当前文件名不同。

## 编辑与复核

### 恢复录屏素材

原片与可定位转码文件均超过 GitHub 普通 Git 单文件限制，已在本目录 `.gitignore` 排除，现有本地文件保留。它们不会随 clone 下载，也未上传至公共存储。换机时需从录制者取得本目录原有的 `assets/storyflow-live-raw.mov`，放回同一路径；原片身份以 `assets/provenance.json` 的 `rawSha256` 为准。

在本目录校验原片并生成可定位素材后，再执行下方编辑命令：

```sh
python3 -c 'import hashlib,json,pathlib; p=pathlib.Path("assets"); assert hashlib.sha256((p/"storyflow-live-raw.mov").read_bytes()).hexdigest() == json.loads((p/"provenance.json").read_text())["rawSha256"]'
ffmpeg -y -i assets/storyflow-live-raw.mov -an -c:v libx264 -preset fast -crf 16 \
  -pix_fmt yuv420p -g 30 -keyint_min 30 -sc_threshold 0 -movflags +faststart assets/live-seekable.mp4
```

### 编辑与输出

```sh
NO_PROXY='*' no_proxy='*' uv run --with edge-tts --with numpy make_audio.py
python3 build.py
npm run check
npm run dev -- --port 4568
npm run render -- --quality high --fps 30 --workers 8 --output renders/storyflow-live-80s-v2.mp4
```

字幕封装命令：

```sh
ffmpeg -i renders/storyflow-live-80s-v2.mp4 -i transcript.srt -map 0:v -map 0:a -map 1:0 -c:v copy -c:a copy -c:s mov_text -metadata:s:s:0 language=zho -disposition:s:0 0 -movflags +faststart renders/subtitled.mp4
mv renders/subtitled.mp4 renders/storyflow-live-80s-v2.mp4
python3 verify.py
```

`npm run check` 已完成 lint、对比度及布局检查；同一短片顺序放置 7 个标题、18 条逐句字幕与 8 个转场触发的三条轨道密度建议已人工接受，不为此拆分工程。最终交付另做完整媒体解码和实际渲染帧检查。字幕移到画面上方的独立讲解区，避免渲染器在画面下沿裁切字幕。旧 `../tutorial-video/` 草稿保持独立。

动画映射已检查 80 个主要 tween：80 秒进度条的 paced-slow 为有意设计；转场覆盖、同一窗口的裁切放大属于有意重叠。映射器将无 id 的 span 简化为泛选择器，其碰撞提示需结合实际渲染帧核对，不能当作独立的可见溢出结论。

## 音频与字幕修订

V2 保留原始录屏片段、入点、时长与镜头运动。旁白改用 `zh-CN-XiaoxiaoNeural`，以自然语速生成，文案改为口语表达。完整旁白以 18 条逐句字幕直接渲染进画面，同时保留可选软字幕，不再依赖播放器手动开启字幕。语音生成接口使用 [edge-tts](https://github.com/rany2/edge-tts)。

章节标题改为“按你的想法修改”，旁白明确可以调整句子、章节或整体重写。原始录屏中“只改最后一段”是本次演示选择的范围，不是产品限制。

`make_audio.py` 合成原创的轻柔键音与和弦背景，未使用第三方音乐录音。音乐目标响度 -35 LUFS，旁白约 -16 LUFS；说话时音乐自动压低，首尾淡入淡出。音轨单独保存在 `assets/narration/`，可独立调整。上一版成片另存为 `renders/storyflow-live-80s-v1.mp4`。

逐句字幕采用 0.18 秒轻淡入，动画映射的 18 条 paced-fast 提示已人工接受，避免入场动画占用阅读时间。

`music-original.wav`、`music-quiet.wav` 和 `narration-full.wav` 是 `make_audio.py` 生成的中间音轨，保留本地并由 Git 忽略；最终背景音乐和逐段旁白继续纳入版本控制。
