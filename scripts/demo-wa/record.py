import os, shutil, subprocess, sys, glob
from playwright.sync_api import sync_playwright

ROOT = "/root/aigoogle/scripts/demo-wa"
OUT = os.path.join(ROOT, "wa-demo.mp4")
VID_DIR = "/tmp/opencode/wa-demo-rec"

shutil.rmtree(VID_DIR, ignore_errors=True)
os.makedirs(VID_DIR, exist_ok=True)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/root/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome")
    ctx = b.new_context(
        viewport={"width": 1080, "height": 1920},
        device_scale_factor=1,
        record_video_dir=VID_DIR,
        record_video_size={"width": 1080, "height": 1920},
    )
    pg = ctx.new_page()
    pg.goto(f"file://{ROOT}/index.html", wait_until="load")
    pg.wait_for_function("window.__done === true", timeout=120_000)
    pg.wait_for_timeout(500)
    video = pg.video.path()
    ctx.close()
    b.close()

webm = video
print("webm:", webm, os.path.getsize(webm))

cmd = [
    "ffmpeg", "-y", "-i", webm,
    "-vf", "scale=1080:1920:flags=lanczos,fps=30",
    "-c:v", "libx264", "-preset", "medium", "-crf", "20",
    "-pix_fmt", "yuv420p", "-movflags", "+faststart",
    "-an", OUT,
]
r = subprocess.run(cmd, capture_output=True, text=True)
if r.returncode != 0:
    print(r.stderr[-3000:])
    sys.exit(1)
print("mp4:", OUT, os.path.getsize(OUT))
subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration,size", "-of", "default=nw=1", OUT])
