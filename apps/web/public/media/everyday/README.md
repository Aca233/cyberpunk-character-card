# 日常芯片媒体样例

本目录全部为本项目原创的平面宣传与提示材料，不是《赛博朋克 2077》截图、真实演出录像或生成式超梦正文。
- `night-market-sleeve.svg`：夜市作品的平面封套。
- `needle-drop-program.svg`：《返场第三首》的随片节目单。
- `repair-reference.svg`：维修资料的检查顺序示意，不是具体接线图。
- `night-market-sleeve.mp4`：6 秒静音动态封套，画面持续标明“原创动态封套 · 非录制画面”；片长不计作作品的体验时长。
- `night-market-sleeve.gif`：同一份动态封套的循环 GIF，作为 `image` 附件直接显示动图。
- `night-market-sleeve-poster.jpg`：动态封套首帧，供原生播放器显示。
- `night-market-sleeve.vtt`：对应中文说明字幕。

视频和首帧由 `python tools/generate-everyday-media.py` 在本机离线生成，需要 Pillow、FFmpeg，以及可显示中文的字体。默认读取 Windows 微软雅黑，也可以传入 `--font` 指定字体。

完整生成也会从视频输出 GIF；已有视频时可运行 `python tools/generate-everyday-media.py --gif-only` 单独生成动图。

所有引用使用站内 `/media/everyday/` 地址，不需要外部账户、第三方媒体网站或远程下载。图片与视频只在对应芯片原文实际读取、超梦片段实际呈现后进入玩家视图；打开播放器本身不推进游戏时间。
