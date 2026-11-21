# Test: does the Wraith Prism fan LED follow the ASUS board's 12V RGB headers instead of the cooler's USB?
# Sets "RGB Header 1" and "RGB Header 2" on the ASUS board to one color for a few seconds, then back to Off.
# Watch the fan blade LED. No admin needed. Needs the OpenRGB server on :6742.
# uv run --with openrgb-python python scripts/wraith-header-test.py [r g b] [seconds]
import sys, time
from openrgb import OpenRGBClient
from openrgb.utils import RGBColor

r, g, b = (int(x) for x in sys.argv[1:4]) if len(sys.argv) >= 4 else (0, 255, 0)
secs = float(sys.argv[4]) if len(sys.argv) >= 5 else 10

c = OpenRGBClient(name="wraith-header-test")
board = next(d for d in c.devices if d.name.startswith("ASUS"))
headers = [l for l in board.leds if "RGB Header" in l.name]
assert headers, f"no RGB Header LEDs on {board.name}"
board.set_mode("direct")
for l in headers:
    l.set_color(RGBColor(r, g, b))
print(f"{', '.join(l.name for l in headers)} -> {r},{g},{b} for {secs:g}s. Look at the fan LED.")
time.sleep(secs)
board.set_mode("off")
print("board back to Off")
