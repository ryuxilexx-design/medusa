#!/usr/bin/env python3
"""Builds the demo's camera «alert snapshots» from licensed photos (tools/snapshot-sources, see ATTRIBUTION.md there).

Every face, name tag and readable sign is pixelated/blurred *before* anything else, then the frame gets the look of a
Hikvision alarm picture: 16:9 crop, 960×540, day = slightly washed colours, night = IR monochrome with a cold tint,
sensor noise, vignette, the camera's own overlay (time stamp, channel name, detection zone, target box), JPEG ~75.

    python3 tools/make-snapshots.py            → database/seed/snapshots/*.jpg (same file names the seed and the
                                                  simulator already use)

Deterministic (fixed noise seed). The sources are stock photos of hospitals abroad, not the demo clinic; nobody in
them is identifiable after the blur. Re-run after changing a scene.
"""
import os, random
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps, ImageEnhance

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'snapshot-sources')
OUT = os.path.join(HERE, '..', 'database', 'seed', 'snapshots')
W, H = 960, 540
FONT = '/System/Library/Fonts/Supplemental/Arial.ttf'
if not os.path.exists(FONT):
    FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'

# Each scene: source file, crop box in source pixels (any 16:9 box), regions to anonymise (source pixels),
# night?, channel name, time stamp, detection zone polygon and target box (both in output 960×540 pixels),
# optional tamper (the lens being covered).
SCENES = [
    dict(name='cash-night-intrusion', src='reception-wagga.jpg', crop=(0, 120, 1280, 840), night=True,
         blur=[(205, 435, 310, 535), (1215, 400, 1280, 620), (955, 280, 1225, 325)],
         channel='CAM 02 Kassa', time='12-10-2026 02:15:07', zone=[(120, 120), (560, 110), (640, 530), (40, 530)], box=(150, 230, 300, 535)),
    dict(name='cash-tamper', src='reception-dentistry.jpg', crop=(0, 0, 1280, 720), night=False, tamper=True,
         blur=[(560, 290, 660, 380), (630, 220, 820, 320), (840, 400, 920, 500)],
         channel='CAM 02 Kassa', time='27-09-2026 06:58:41', zone=None, box=None),
    dict(name='or-day-loitering', src='corridor-sansalvatore.jpg', crop=(0, 70, 1280, 790), night=False,
         blur=[(985, 345, 1105, 480)],
         channel='CAM 04 Operatsiya bloki', time='18-10-2026 09:48:12', zone=[(420, 150), (940, 150), (960, 540), (380, 540)], box=(455, 200, 870, 535)),
    dict(name='or-day-stranger', src='corridor-eskenazi.jpg', crop=(0, 60, 1280, 780), night=False,
         blur=[(335, 370, 375, 410), (1030, 30, 1240, 150), (615, 215, 690, 270)],
         channel='CAM 04 Operatsiya bloki', time='16-10-2026 14:36:55', zone=[(200, 220), (420, 220), (470, 420), (120, 420)], box=(250, 240, 285, 335)),
    dict(name='reception-night', src='lobby-stpauls.jpg', crop=(0, 120, 1280, 840), night=True,
         blur=[(1095, 465, 1160, 530), (160, 500, 340, 570), (395, 480, 440, 525), (280, 500, 330, 540), (770, 395, 900, 490)],
         channel='CAM 01 Asosiy kirish', time='09-10-2026 01:05:33', zone=[(700, 230), (950, 230), (960, 540), (620, 540)], box=(800, 255, 900, 545)),
    dict(name='store-day-loitering', src='store-30mdg.jpg', crop=(0, 70, 1280, 790), night=False,
         blur=[(820, 90, 1125, 335), (860, 430, 1010, 505), (1105, 525, 1210, 650)],
         channel='CAM 03 Dori ombori', time='14-10-2026 13:20:48', zone=[(560, 40), (960, 40), (960, 540), (480, 540)], box=(600, 60, 940, 540)),
    dict(name='store-night-1', src='store-boxes.jpg', crop=(0, 40, 1280, 760), night=True,
         blur=[(225, 70, 430, 300), (410, 395, 530, 460), (175, 380, 260, 440)],
         channel='CAM 03 Dori ombori', time='05-10-2026 23:40:19', zone=[(60, 20), (640, 20), (700, 540), (20, 540)], box=(120, 30, 640, 520)),
    dict(name='store-night-2', src='store-30mdg.jpg', crop=(320, 100, 1280, 640), night=True,
         blur=[(820, 90, 1125, 335), (860, 430, 1010, 505), (1105, 525, 1210, 650)],
         channel='CAM 03 Dori ombori', time='17-10-2026 23:12:04', zone=[(300, 20), (960, 20), (960, 540), (220, 540)], box=(430, 10, 950, 540)),
    dict(name='yun-cash-night-line', src='reception-arrowe.jpg', crop=(0, 60, 1280, 780), night=True,
         blur=[(945, 355, 1000, 405), (905, 370, 950, 415), (535, 295, 725, 340), (670, 335, 745, 505)],
         channel='CAM 05 Kassa (Yunusobod)', time='01-10-2026 21:35:26', line=[(560, 540), (700, 250)], box=(670, 260, 760, 430)),
    dict(name='yun-cash-night-region', src='corridor-tuenmun.jpg', crop=(0, 120, 1280, 840), night=True,
         blur=[(525, 440, 560, 480), (495, 445, 525, 475), (405, 445, 440, 475), (60, 260, 500, 335), (1130, 320, 1230, 515), (1170, 525, 1250, 580)],
         channel='CAM 05 Kassa (Yunusobod)', time='15-10-2026 22:18:50', zone=[(0, 170), (300, 170), (330, 540), (0, 540)], box=(380, 240, 430, 400)),
    # ---- second set (2026-10-22): entrance, lifts, ward door, pharmacy window, halls ----
    dict(name='entry-night-door', src='entrance-ealing-night.jpg', crop=(0, 200, 1280, 920), night=True, gain=1.9,
         blur=[(540, 475, 600, 650)],
         channel='CAM 01 Asosiy kirish', time='20-09-2026 23:52:18', zone=[(300, 170), (720, 170), (760, 540), (240, 540)], box=(395, 270, 460, 470)),
    dict(name='entry-night-glass', src='entrance-msk-night.jpg', crop=(0, 0, 1280, 677), night=True,
         blur=[(600, 300, 690, 510), (55, 345, 235, 425), (1060, 330, 1250, 400)],
         channel='CAM 01 Asosiy kirish', time='24-09-2026 21:10:44', line=[(180, 540), (330, 300)], box=(330, 250, 440, 460)),
    dict(name='entry-day-stroller', src='entrance-peijas.jpg', crop=(0, 120, 1280, 840), night=False,
         blur=[(755, 540, 815, 605), (150, 670, 220, 705), (365, 610, 415, 635), (465, 610, 515, 635), (685, 495, 775, 525)],
         channel='CAM 01 Asosiy kirish', time='28-09-2026 07:12:03', zone=[(420, 280), (720, 280), (800, 540), (320, 540)], box=(555, 310, 640, 510)),
    dict(name='cash-night-lift', src='lift-lobby-jilin.jpg', crop=(0, 120, 1280, 840), night=True, gain=1.35,
         blur=[(650, 615, 710, 695), (1195, 635, 1245, 695), (95, 580, 165, 655), (775, 555, 885, 765)],
         channel='CAM 02 Kassa', time='29-09-2026 22:05:27', zone=[(380, 300), (900, 300), (960, 540), (320, 540)], box=(480, 360, 545, 540)),
    dict(name='or-day-lifts', src='lift-corridor-uddevalla.jpg', crop=(0, 50, 1280, 770), night=False,
         blur=[(300, 285, 385, 405), (640, 255, 690, 300)],
         channel='CAM 04 Operatsiya bloki', time='02-10-2026 12:30:36', line=[(470, 540), (420, 180)], box=(405, 150, 490, 400)),
    dict(name='store-day-window', src='pharmacy-window-makalapa.jpg', crop=(0, 40, 1280, 760), night=False,
         blur=[(635, 230, 735, 365), (690, 455, 790, 505), (0, 360, 140, 480), (440, 360, 610, 480), (925, 145, 1020, 180), (650, 670, 1000, 710)],
         channel='CAM 03 Dori ombori', time='03-10-2026 19:30:52', zone=[(300, 20), (760, 20), (780, 520), (260, 520)], box=(470, 140, 660, 520)),
    dict(name='or-night-ward-door', src='ward-door-northwick.jpg', crop=(0, 120, 1280, 840), night=True,
         blur=[(565, 315, 725, 395), (235, 490, 365, 650), (370, 560, 460, 700)],
         channel='CAM 04 Operatsiya bloki', time='06-10-2026 03:40:09', zone=[(340, 110), (620, 110), (620, 540), (330, 540)], box=(360, 150, 600, 540)),
    dict(name='yun-cash-night-hall', src='hall-cologne.jpg', crop=(0, 0, 1280, 720), night=True,
         blur=[(685, 190, 720, 230), (270, 170, 565, 560), (660, 110, 790, 170), (800, 165, 900, 195)],
         channel='CAM 05 Kassa (Yunusobod)', time='07-10-2026 00:25:41', zone=[(430, 120), (700, 120), (760, 540), (430, 540)], box=(495, 135, 560, 275)),
    dict(name='cash-day-post', src='medical-post-pirogov.jpg', crop=(0, 60, 1280, 780), night=False,
         blur=[(455, 490, 535, 585), (630, 630, 810, 735)],
         channel='CAM 02 Kassa', time='10-10-2026 18:45:15', zone=[(240, 300), (620, 300), (640, 540), (220, 540)], box=(300, 320, 440, 540)),
    dict(name='entry-night-street', src='entrance-guys-night.jpg', crop=(0, 0, 1280, 720), night=True,
         blur=[(630, 330, 770, 405), (145, 315, 215, 395), (940, 580, 1015, 610), (110, 515, 200, 565), (560, 425, 780, 455)],
         channel='CAM 01 Asosiy kirish', time='11-10-2026 02:50:30', zone=[(380, 300), (700, 300), (720, 540), (300, 540)], box=(400, 345, 560, 540)),
]


def pixelate(im, box, strength=14):
    """Pixelates + blurs one region (faces, badges, signs) so nothing in it can be read or recognised."""
    x0, y0, x1, y1 = [max(0, v) for v in box]
    region = im.crop((x0, y0, x1, y1))
    small = region.resize((max(1, region.width // strength), max(1, region.height // strength)), Image.BILINEAR)
    region = small.resize(region.size, Image.BILINEAR).filter(ImageFilter.GaussianBlur(3))
    im.paste(region, (x0, y0))


def noise_layer(size, amount, seed):
    rnd = random.Random(seed)
    n = Image.effect_noise(size, amount)  # gaussian grey noise around 128
    return n


def cctv(im, night, seed, gain=1.0):
    im = im.resize((W, H), Image.LANCZOS)
    if night:
        g = ImageOps.grayscale(im)
        g = ImageEnhance.Contrast(g).enhance(1.25)
        g = ImageEnhance.Brightness(g).enhance(0.72 * gain)
        # IR: highlights bloom a little, shadows go deep
        g = g.filter(ImageFilter.GaussianBlur(0.6))
        im = ImageOps.colorize(g, black=(8, 12, 16), mid=(96, 110, 112), white=(230, 240, 236))
        noise = noise_layer((W, H), 26, seed).convert('RGB')
        im = Image.blend(im, noise, 0.16)
    else:
        im = ImageEnhance.Color(im).enhance(0.62)
        im = ImageEnhance.Contrast(im).enhance(1.08)
        im = ImageEnhance.Brightness(im).enhance(0.96)
        im = im.filter(ImageFilter.GaussianBlur(0.4))
        noise = noise_layer((W, H), 14, seed).convert('RGB')
        im = Image.blend(im, noise, 0.07)
    # vignette + faint scan lines
    mask = Image.new('L', (W, H), 0)
    d = ImageDraw.Draw(mask)
    d.ellipse((-W * 0.25, -H * 0.35, W * 1.25, H * 1.35), fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(120))
    dark = Image.new('RGB', (W, H), (0, 0, 0))
    im = Image.composite(im, Image.blend(im, dark, 0.45), mask)
    lines = Image.new('L', (W, H), 0)
    ld = ImageDraw.Draw(lines)
    for y in range(0, H, 3):
        ld.line((0, y, W, y), fill=22)
    im = Image.composite(dark, im, lines) if False else Image.blend(im, Image.composite(dark, im, lines), 0.5)
    return im


def tamper(im, seed):
    """The lens being covered: most of the frame dark and defocused, a bright smear at one edge."""
    im = im.filter(ImageFilter.GaussianBlur(6))
    im = ImageEnhance.Brightness(im).enhance(0.7)
    cover = Image.new('L', (W, H), 0)
    d = ImageDraw.Draw(cover)
    d.ellipse((-260, -160, 620, 560), fill=255)
    d.ellipse((200, 240, 820, 760), fill=255)
    cover = cover.filter(ImageFilter.GaussianBlur(36))
    hand = Image.new('RGB', (W, H), (34, 26, 24))
    im = Image.composite(hand, im, cover)
    noise = noise_layer((W, H), 30, seed).convert('RGB')
    return Image.blend(im, noise, 0.14)


def overlay(im, sc):
    d = ImageDraw.Draw(im, 'RGBA')
    f = ImageFont.truetype(FONT, 20)
    fs = ImageFont.truetype(FONT, 17)
    if sc.get('zone'):
        d.polygon(sc['zone'], outline=(90, 255, 120, 210), width=2)
    if sc.get('line'):
        (x0, y0), (x1, y1) = sc['line']
        d.line((x0, y0, x1, y1), fill=(255, 220, 60, 230), width=3)
        d.text(((x0 + x1) / 2 + 8, (y0 + y1) / 2), 'A → B', font=fs, fill=(255, 220, 60, 230))
    if sc.get('box'):
        d.rectangle(sc['box'], outline=(255, 60, 60, 235), width=3)
    # Hikvision-style OSD: time stamp top-left, channel bottom-right, with a soft shadow
    def text(xy, s, font):
        x, y = xy
        d.text((x + 1, y + 1), s, font=font, fill=(0, 0, 0, 200))
        d.text((x, y), s, font=font, fill=(255, 255, 255, 240))
    text((14, 10), sc['time'], f)
    tw = d.textlength(sc['channel'], font=f)
    text((W - tw - 14, H - 34), sc['channel'], f)
    if sc.get('tamper'):
        text((14, H - 34), 'VIDEO TAMPERING', f)
    return im


def build(sc, idx):
    im = Image.open(os.path.join(SRC, sc['src'])).convert('RGB')
    for b in sc.get('blur', []):
        pixelate(im, b)
    im = im.crop(sc['crop'])
    im = cctv(im, sc['night'], 1000 + idx, sc.get('gain', 1.0))
    if sc.get('tamper'):
        im = tamper(im, 2000 + idx)
    im = overlay(im, sc)
    path = os.path.join(OUT, sc['name'] + '.jpg')
    im.save(path, 'JPEG', quality=74, optimize=True, progressive=True)
    return os.path.getsize(path)


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    for i, sc in enumerate(SCENES):
        size = build(sc, i)
        print(f'{sc["name"]:24s} {size // 1024:4d} KB')
