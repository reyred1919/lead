import json, glob, os
from PIL import Image, ImageDraw, ImageFont
PACK = "/home/user/lead/deliverables/leados-phase1-presentation-pack"
font = None
for f in ["/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"]:
    if os.path.exists(f): font = ImageFont.truetype(f, 13)
font = font or ImageFont.load_default()
def sheet(name, files, tw, maxh, cols):
    tiles = []
    for f in files:
        im = Image.open(f).convert("RGB"); w, h = im.size
        th = int(h * tw / w); im = im.resize((tw, th), Image.LANCZOS).crop((0, 0, tw, min(th, maxh)))
        tiles.append((os.path.relpath(f, PACK + "/screenshots"), im, w, h))
    cw, ch = tw + 24, maxh + 66
    rows = (len(tiles) + cols - 1) // cols
    S = Image.new("RGB", (cols * cw + 24, rows * ch + 24), (244, 246, 250)); d = ImageDraw.Draw(S)
    for i, (k, im, w, h) in enumerate(tiles):
        x = 24 + (i % cols) * cw; y = 24 + (i // cols) * ch
        lbl = os.path.basename(k)[:-4]
        while d.textlength(lbl, font=font) > tw and len(lbl) > 8: lbl = lbl[:-2]
        d.text((x, y), lbl, fill=(20, 30, 50), font=font); d.text((x, y + 19), f"{w}x{h} px", fill=(90, 100, 120), font=font)
        S.paste(im, (x, y + 42)); d.rectangle((x - 1, y + 41, x + im.width, y + 42 + im.height), outline=(200, 205, 215))
    S = S.quantize(256, dither=Image.Dither.NONE)
    S.save(f"{PACK}/contact-sheets/{name}.png", optimize=True); print(name, S.size, os.path.getsize(f"{PACK}/contact-sheets/{name}.png"))
os.makedirs(PACK + "/contact-sheets", exist_ok=True)
g = lambda p: sorted(glob.glob(f"{PACK}/screenshots/{p}"))
sheet("desktop-overview", g("desktop/*.png") + g("roles/*.png") + g("states/*.png"), 480, 300, 3)
sheet("tablet-overview", g("tablet/*.png"), 300, 560, 4)
sheet("mobile-overview", g("mobile/*.png"), 240, 520, 4)
sheet("before-after-overview", sorted(g("before-after/*.png"), key=lambda f: (f.rsplit("-", 1)[0], not f.endswith("before.png"))), 340, 520, 2)
