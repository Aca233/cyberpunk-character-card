"""Create the original six-second MP4 and GIF chip sleeve without remote assets."""

from __future__ import annotations

import argparse
import math
from pathlib import Path
import shutil
import subprocess

from PIL import Image, ImageDraw, ImageFont


def write_gif(ffmpeg: str, movie: Path) -> Path:
    if not movie.is_file():
        raise SystemExit("The local MP4 sleeve is missing; generate it before using --gif-only.")
    gif = movie.with_suffix(".gif")
    subprocess.run(
        [
            ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", str(movie),
            "-filter_complex",
            "fps=10,scale=640:-1:flags=lanczos,split[frames][colors];"
            "[colors]palettegen=max_colors=96:stats_mode=diff[palette];"
            "[frames][palette]paletteuse=dither=bayer:bayer_scale=3",
            "-loop", "0", str(gif),
        ],
        check=True,
    )
    with Image.open(gif) as image:
        frames = getattr(image, "n_frames", 1)
        duration = 0
        for frame in range(frames):
            image.seek(frame)
            duration += image.info.get("duration", 0)
        if image.format != "GIF" or frames <= 1:
            raise SystemExit("The output must be a real animated GIF.")
        print(
            f"Created {gif.name}: {image.width}x{image.height}, "
            f"{frames} frames, {duration / 1000:g}s, {gif.stat().st_size:,} bytes"
        )
    return gif


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--font", type=Path, default=Path("C:/Windows/Fonts/msyh.ttc"))
    parser.add_argument("--gif-only", action="store_true", help="Convert the existing local MP4 to GIF.")
    args = parser.parse_args()
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise SystemExit("FFmpeg must be available on PATH.")

    destination = Path(__file__).resolve().parents[1] / "apps/web/public/media/everyday"
    destination.mkdir(parents=True, exist_ok=True)
    movie = destination / "night-market-sleeve.mp4"
    if args.gif_only:
        write_gif(ffmpeg, movie)
        return
    if not args.font.is_file():
        raise SystemExit("A Chinese font is required; pass its path with --font.")
    width, height, fps, seconds = 960, 540, 24, 6
    fonts = {
        size: ImageFont.truetype(str(args.font), size)
        for size in (14, 17, 19, 22, 27, 56)
    }
    command = [
        ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
        "-f", "rawvideo", "-pixel_format", "rgb24",
        "-video_size", f"{width}x{height}", "-framerate", str(fps),
        "-i", "pipe:0", "-an", "-c:v", "libx264", "-preset", "medium",
        "-crf", "24", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
        "-metadata", "title=Original animated sleeve - Before the Stall Lights Go Out",
        "-metadata", "comment=Original flat-design promotional animation, not recorded braindance footage.",
        str(movie),
    ]
    process = subprocess.Popen(command, stdin=subprocess.PIPE)
    try:
        for frame in range(fps * seconds):
            t = frame / fps
            image = Image.new("RGB", (width, height), "#101b24")
            draw = ImageDraw.Draw(image)
            draw.line((44, 70, 916, 70), fill="#40545a")
            draw.rectangle((44, 104, 916, 468), outline="#40545a")
            draw.polygon(((44, 104), (916, 104), (890, 157), (70, 157)), fill="#263c44")
            for x in range(125, 915, 103):
                draw.line((x, 104, x + 12, 157), fill="#72928a", width=2)
            for index, x in enumerate((116, 300, 484, 668)):
                brightness = 0.84 + 0.16 * math.sin(t * 1.1 + index * 0.7)
                color = tuple(int(c * brightness) for c in (233, 183, 94))
                draw.rounded_rectangle((x, 170, x + 87, 176), radius=3, fill=color)
            draw.text((47, 28), "片角发行 / NEIGHBORHOOD EDITIONS", font=fonts[17], fill="#94b9b2")
            draw.text((809, 28), "BD · 018", font=fonts[17], fill="#e9b75e")
            draw.text((78, 229), "摊灯熄灭以前", font=fonts[56], fill="#f3dfac")
            draw.text((82, 309), "收摊 / 夜宵 / 明天还要用的热水壶", font=fonts[22], fill="#abc1be")
            draw.text((82, 377), "阿娴授权发行", font=fonts[27], fill="#f3dfac")
            draw.text((84, 420), "十八分钟的普通一晚", font=fonts[19], fill="#91aaa8")
            draw.text((47, 497), "原创动态封套 · 非录制画面", font=fonts[17], fill="#abc1be")
            for index in range(34):
                x = 779 + index * 3
                bar = int(12 + 24 * (0.5 + 0.5 * math.sin(index * 0.8 + t * 2)))
                draw.line((x, 432 - bar, x, 432), fill="#e9b75e", width=1)
            draw.rectangle((47, 480, 47 + int(866 * frame / (fps * seconds - 1)), 482), fill="#e9b75e")
            if frame == 0:
                image.save(destination / "night-market-sleeve-poster.jpg", quality=90)
            if process.stdin is None:
                raise RuntimeError("FFmpeg input pipe is unavailable.")
            process.stdin.write(image.tobytes())
        process.stdin.close()
        if process.wait() != 0:
            raise SystemExit("FFmpeg did not finish the promotional animation.")
    except BaseException:
        process.kill()
        process.wait()
        raise
    print(f"Created {movie.name}: {width}x{height}, {seconds}s, {movie.stat().st_size:,} bytes")
    write_gif(ffmpeg, movie)


if __name__ == "__main__":
    main()
