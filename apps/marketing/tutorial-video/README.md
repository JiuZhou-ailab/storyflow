# Storyflow 第一次写作练习

180 秒原生界面教程，使用 HyperFrames 0.6.33 剪辑，2560 × 1440 / 30 fps。围绕同一个示例项目讲解资料、任务要求、逐句审阅和保存版本。中文系统合成旁白（macOS Tingting），画外短字幕、克制转场与局部放大。

## 素材边界

`assets/native-recording.mp4` 为本次连续录制的 2880 × 1800 原生 Electron 界面。项目文件、对话和 Edit 历史为预置示例，没有调用模型。文件点击、Accept 和保存当前版本通过真实 UI 处理，保存记录已核验。影片标注“示例项目实录 · 对话为预置示例”。本片不演示安装、登录或现场生成，不应宣传为现场模型运行。

`assets/native-seekable.mp4` 是每秒一个关键帧的剪辑素材，避免浏览器定位长录屏时停在旧帧。原生 16:10 画面装入 16:9 成片，局部放大时有意裁去非当前操作区域。没有伪造界面。

## 编辑与输出

- `index.html`：HyperFrames 画面、字幕和动效时间线。
- `script.json`：15 段旁白原文、简洁字幕、起点和音频时长。
- `transcript.srt`：完整中文旁白字幕，方便阅读或另行导入播放器。
- `chapters.ffmetadata`：6 个章节的标题与时间边界，用于成片封装。
- `record.ts`：复用仓库 Electron harness 的独立示例录制。运行前需要现有 Electron build。
- `assets/provenance.json`：录制时间、录制时仓库提交、画面尺寸和真实操作时间点。
- `renders/storyflow-first-practice.mp4`：最终成片（本地生成文件）。

在本目录运行：

```sh
npm run check
npm run render -- --quality high --fps 30 --workers 8 --output renders/storyflow-first-practice.raw.mp4
ffmpeg -y -i renders/storyflow-first-practice.raw.mp4 -i transcript.srt -i chapters.ffmetadata \
  -map 0:v:0 -map 0:a:0 -map 1:s:0 -map_metadata 2 -map_chapters 2 \
  -c:v copy -c:a copy -c:s mov_text -metadata:s:s:0 language=zho \
  -disposition:s:0 0 -movflags +faststart renders/storyflow-first-practice.mp4
python3 verify.py
```

HyperFrames 只渲染画面和音频；FFmpeg 步骤将完整字幕及章节加入最终 MP4，不能省略。预览可另开终端运行 `npm run dev -- --port 4567`，该命令会持续运行。

Studio 地址为 http://localhost:4567/#project/tutorial-video 。录制可从仓库根目录运行 `bun apps/marketing/tutorial-video/record.ts`。录制脚本同时生成每秒关键帧的 `native-seekable.mp4`。重新录制后，按 `script.json` 核对操作与旁白时序。

## 验收

- HyperFrames lint：零错误；保留三条轨道密度建议。字幕、章节和转场各用一条顺序轨道便于编辑，不为三分钟单片拆分更多子工程。
- validate：零控制台错误，123 个文字检查项通过 WCAG AA。
- inspect：9 个时间采样点，零布局问题。
- 原录屏确认：文件打开、修改对比、接受、保存记录；未调用模型。
- `python3 verify.py`：检查成片时长、尺寸、帧率、音轨、完整字幕轨、6 个章节和旁白时序。
- 已核对实际渲染的 33、85、110、145.5、166 秒画面，人物、正文、修改对比、版本记录与旁白对应。
- animation-map：48 条动效已采样；进度条的 180 秒慢动画为预期行为，4 条碰撞提示来自遮罩转场与入场重叠。
- Studio 缩略图服务偶尔在视频解码前截帧；最终渲染采用提取帧，验收以成片为准。
