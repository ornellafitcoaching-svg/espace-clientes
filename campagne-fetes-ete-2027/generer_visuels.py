"""Génère les visuels de la campagne "Objectif Fêtes / Été 2027" (PNG 1080x1350)."""
import os, sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageOps

SITE = os.environ.get("SITE_IMAGES", "/home/user/ornellafitcoaching-svg/ornellafit-site/images")
FONTS = os.environ.get("FONTS_DIR", "/mnt/skills/examples/canvas-design/canvas-fonts")
OUT = os.path.dirname(os.path.abspath(__file__))

W, H = 1080, 1350
NUDE = (240, 230, 218)
SAND = (225, 209, 189)
BLACK = (22, 19, 17)
GOLD = (185, 146, 72)
GOLD_L = (214, 178, 108)
WHITE = (255, 252, 247)
GREY = (110, 98, 88)

def font(name, size):
    return ImageFont.truetype(os.path.join(FONTS, name), size)

BOLD = "Outfit-Bold.ttf"
REG = "Outfit-Regular.ttf"
SERIF = "InstrumentSerif-Italic.ttf"

def load(name):
    return ImageOps.exif_transpose(Image.open(os.path.join(SITE, name))).convert("RGB")

def cover(img, w, h, fy=0.5, fx=0.5):
    """Recadre img au ratio w/h (point focal fx, fy) puis redimensionne."""
    iw, ih = img.size
    r = w / h
    if iw / ih > r:
        nw = int(ih * r); x = int((iw - nw) * fx); box = (x, 0, x + nw, ih)
    else:
        nh = int(iw / r); y = int((ih - nh) * fy); box = (0, y, iw, y + nh)
    return img.crop(box).resize((w, h), Image.LANCZOS)

def tw(d, text, f, spacing=0):
    return d.textlength(text, font=f) + spacing * max(len(text) - 1, 0)

def text(d, xy, s, f, fill, spacing=0, anchor="la"):
    """Texte avec interlettrage optionnel. anchor: 'la' gauche, 'ma' centre, 'ra' droite."""
    x, y = xy
    if spacing == 0:
        d.text((x, y), s, font=f, fill=fill, anchor=anchor); return
    total = tw(d, s, f, spacing)
    if anchor[0] == "m": x -= total / 2
    elif anchor[0] == "r": x -= total
    for ch in s:
        d.text((x, y), ch, font=f, fill=fill, anchor="l" + anchor[1])
        x += d.textlength(ch, font=f) + spacing

def fit(d, s, name, max_w, size, min_size=20):
    while size > min_size and d.textlength(s, font=font(name, size)) > max_w:
        size -= 2
    return font(name, size)

def pill(d, box, fill, label, f, color, spacing=0):
    x0, y0, x1, y1 = box
    d.rounded_rectangle(box, radius=(y1 - y0) // 2, fill=fill)
    text(d, ((x0 + x1) / 2, (y0 + y1) / 2), label, f, color, spacing, anchor="mm")

def tag(d, xy, label, dark=True):
    f = font(BOLD, 22)
    w = tw(d, label, f, 3) + 36
    x, y = xy
    d.rounded_rectangle((x, y, x + w, y + 40), radius=20, fill=BLACK if dark else WHITE)
    text(d, (x + w / 2, y + 20), label, f, WHITE if dark else BLACK, 3, anchor="mm")

def before_after(canvas, img, box, fy=0.5, labels=True, radius=28, trim=0.022):
    """Colle un montage avant/après (déjà côte à côte) avec étiquettes AVANT / APRÈS."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    iw, ih = img.size
    m = int(iw * trim)
    img = img.crop((m, m, iw - m, ih - m))
    ph = cover(img, w, h, fy=fy)
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, w, h), radius=radius, fill=255)
    canvas.paste(ph, (x0, y0), mask)
    if labels:
        d = ImageDraw.Draw(canvas)
        tag(d, (x0 + 22, y0 + 22), "AVANT", dark=False)
        tag(d, (x0 + w // 2 + 22, y0 + 22), "APRÈS", dark=True)

def brand(d, y, color=GREY, x=None):
    f = font(BOLD, 20)
    s = "ORNELLA FIT COACHING  ·  COACH DIPLÔMÉE D'ÉTAT"
    text(d, (W / 2 if x is None else x, y), s, f, color, 3, anchor="ma" if x is None else "la")

def gradient(canvas, y0, y1, color, a0=0, a1=255):
    ov = Image.new("RGBA", (W, y1 - y0))
    od = ImageDraw.Draw(ov)
    for i in range(y1 - y0):
        a = int(a0 + (a1 - a0) * (i / (y1 - y0)) ** 1.3)
        od.line([(0, i), (W, i)], fill=color + (a,))
    canvas.alpha_composite(ov, (0, y0))

# ---------------------------------------------------------------- POST 1
def post_louise():
    c = Image.new("RGB", (W, H), NUDE); d = ImageDraw.Draw(c)
    text(d, (W / 2, 52), "OBJECTIF FÊTES  ·  ÉTÉ 2027", font(BOLD, 24), GOLD, 6, anchor="ma")
    text(d, (W / 2, 96), "Les fêtes arrivent.", font(BOLD, 72), BLACK, anchor="ma")
    f = fit(d, "Elle, elle a commencé 4 mois avant.", SERIF, 980, 70)
    text(d, (W / 2, 178), "Elle, elle a commencé 4 mois avant.", f, BLACK, anchor="ma")
    before_after(c, load("louise-face.jpg"), (40, 270, W - 40, 270 + 810), fy=0.06)
    # bande résultat
    d.rectangle((0, 1100, W, H), fill=BLACK)
    big = font(BOLD, 112)
    text(d, (60, 1116), "−9 cm", big, GOLD_L)
    x = 60 + tw(d, "−9 cm", big) + 28
    d.line([(x, 1140), (x, 1214)], fill=GOLD, width=3)
    text(d, (x + 28, 1116), "−5 kg", big, WHITE)
    text(d, (W - 60, 1134), "EN 4 MOIS", font(BOLD, 34), GOLD_L, 4, anchor="ra")
    text(d, (W - 60, 1182), "Louise, maman de 2", font(REG, 24), (200, 190, 178), anchor="ra")
    pill(d, (60, 1258, W - 60, 1318), GOLD_L, "ÉCRIS « GO » EN MESSAGE", font(BOLD, 30), BLACK, 3)
    return c

# ---------------------------------------------------------------- POST 2
def post_emeline():
    c = Image.new("RGB", (W, H), NUDE); d = ImageDraw.Draw(c)
    text(d, (W / 2, 52), "OBJECTIF ÉTÉ 2027", font(BOLD, 24), GOLD, 6, anchor="ma")
    text(d, (W / 2, 96), "Ton été 2027", font(BOLD, 76), BLACK, anchor="ma")
    text(d, (W / 2, 180), "se construit maintenant.", font(SERIF, 74), BLACK, anchor="ma")
    before_after(c, load("avant-apres-emeline-2.jpg"), (40, 270, W - 40, 270 + 810), fy=0.22)
    d.rectangle((0, 1100, W, H), fill=BLACK)
    text(d, (60, 1116), "2 mois", font(BOLD, 112), GOLD_L)
    text(d, (W - 60, 1128), "FESSIERS GALBÉS", font(BOLD, 34), WHITE, 3, anchor="ra")
    text(d, (W - 60, 1172), "TAILLE AFFINÉE", font(BOLD, 34), WHITE, 3, anchor="ra")
    text(d, (W - 60, 1218), "Emeline, maman de 2", font(REG, 26), (200, 190, 178), anchor="ra")
    pill(d, (60, 1258, W - 60, 1318), GOLD_L, "ÉCRIS « GO » EN MESSAGE", font(BOLD, 30), BLACK, 3)
    return c

# ---------------------------------------------------------------- POST 3
def post_postpartum():
    c = Image.new("RGB", (W, H), BLACK); d = ImageDraw.Draw(c)
    text(d, (W / 2, 52), "MON HISTOIRE", font(BOLD, 24), GOLD_L, 6, anchor="ma")
    f = font(BOLD, 64)
    text(d, (W / 2, 96), "Si je l'ai fait après", f, WHITE, anchor="ma")
    text(d, (W / 2, 168), "une grossesse difficile,", f, WHITE, anchor="ma")
    before_after(c, load("ornella-avant-apres-postpartum.jpg"), (40, 270, W - 40, 270 + 810), fy=0.35)
    text(d, (W / 2, 1090), "tu peux le faire.", font(SERIF, 96), GOLD_L, anchor="ma")
    text(d, (W / 2, 1212), "Ornella  ·  maman  ·  coach diplômée d'État", font(REG, 28), (200, 190, 178), anchor="ma")
    pill(d, (140, 1266, W - 140, 1322), GOLD_L, "ÉCRIS « GO » EN MESSAGE", font(BOLD, 28), BLACK, 3)
    return c

# ---------------------------------------------------------------- CARROUSEL
def slide_num(d, n, color):
    text(d, (W - 60, 56), f"{n}/4", font(BOLD, 24), color, 2, anchor="ra")

def carrousel():
    slides = []
    # 1. Accroche + frise "maintenant -> fêtes -> été 2027"
    c = Image.new("RGB", (W, H), BLACK); d = ImageDraw.Draw(c)
    slide_num(d, 1, GOLD_L)
    text(d, (60, 56), "OBJECTIF FÊTES  ·  ÉTÉ 2027", font(BOLD, 24), GOLD_L, 6)
    f = font(BOLD, 132)
    text(d, (56, 190), "Commence", f, WHITE)
    text(d, (56, 335), "maintenant.", f, GOLD_L)
    text(d, (60, 540), "Le plan pour passer les fêtes sans reprendre", font(REG, 34), (200, 190, 178))
    text(d, (60, 586), "et arriver à l'été 2027 avec 3 mois d'avance.", font(REG, 34), (200, 190, 178))
    # frise
    ty = 860
    d.line([(190, ty), (W - 190, ty)], fill=(80, 72, 64), width=4)
    d.line([(190, ty), (W / 2, ty)], fill=GOLD_L, width=6)
    pts = [(190, "MAINTENANT", "tu commences", GOLD_L),
           (W / 2, "LES FÊTES", "sans reprendre", WHITE),
           (W - 190, "ÉTÉ 2027", "3 mois d'avance", WHITE)]
    for x, t1, t2, col in pts:
        r = 22 if col == GOLD_L else 16
        d.ellipse((x - r, ty - r, x + r, ty + r), fill=col)
        text(d, (x, ty + 56), t1, font(BOLD, 28), col, 3, anchor="ma")
        text(d, (x, ty + 98), t2, font(SERIF, 42), (200, 190, 178), anchor="ma")
    pill(d, (60, 1210, 380, 1274), GOLD_L, "GLISSE  →", font(BOLD, 28), BLACK, 4)
    slides.append(c)
    # 2. Preuves
    c = Image.new("RGB", (W, H), NUDE); d = ImageDraw.Draw(c)
    slide_num(d, 2, GREY)
    text(d, (60, 56), "ELLES ONT COMMENCÉ AVANT", font(BOLD, 24), GOLD, 6)
    rows = [("louise-face.jpg", 0.14, "LOUISE", "−9 cm · −5 kg en 4 mois"),
            ("avant-apres-emeline-2.jpg", 0.32, "EMELINE", "fessiers + taille en 2 mois")]
    y = 100
    for img, fy, who, res in rows:
        before_after(c, load(img), (40, y, W - 40, y + 500), fy=fy)
        d.rounded_rectangle((40, y + 512, W - 40, y + 580), radius=20, fill=BLACK)
        text(d, (72, y + 546), who, font(BOLD, 28), WHITE, 4, anchor="lm")
        text(d, (W - 72, y + 546), res, font(BOLD, 34), GOLD_L, anchor="rm")
        y += 620
    slides.append(c)
    # 3. Formules (libellés repris du site)
    c = Image.new("RGB", (W, H), NUDE); d = ImageDraw.Draw(c)
    slide_num(d, 3, GREY)
    text(d, (60, 56), "3 FAÇONS DE COMMENCER", font(BOLD, 24), GOLD, 6)
    text(d, (60, 104), "Choisis ta formule.", font(BOLD, 76), BLACK)
    cards = [
        ("DOMICILE", "Je viens chez toi · 91/92", "260", "La formule de Louise"),
        ("HYBRIDE", "Séances avec moi + programme", "99", "La formule d'Emeline"),
        ("DISTANCIEL", "Programme + suivi WhatsApp", "89", "Où que tu sois"),
    ]
    y = 236
    for i, (name, sub, price, note) in enumerate(cards):
        dark = i == 0
        bg, fg, sc = (BLACK, WHITE, (190, 180, 168)) if dark else (WHITE, BLACK, GREY)
        d.rounded_rectangle((40, y, W - 40, y + 290), radius=30, fill=bg)
        text(d, (90, y + 46), name, font(BOLD, 52), fg, 4)
        text(d, (90, y + 120), sub, font(REG, 30), sc)
        text(d, (90, y + 194), note, font(SERIF, 44), GOLD_L if dark else GOLD)
        text(d, (W - 90, y + 56), "dès", font(REG, 30), sc, anchor="ra")
        euro = font(BOLD, 60)
        text(d, (W - 90 - tw(d, "€", euro), y + 90), price, font(BOLD, 112), GOLD_L if dark else BLACK, anchor="ra")
        text(d, (W - 90, y + 120), "€", euro, GOLD_L if dark else BLACK, anchor="ra")
        text(d, (W - 90, y + 220), "/ mois", font(REG, 30), sc, anchor="ra")
        y += 312
    text(d, (60, 1226), "Tu hésites ?", font(SERIF, 52), BLACK)
    text(d, (W - 60, 1236), "GLISSE  →", font(BOLD, 30), GOLD, 4, anchor="ra")
    slides.append(c)
    # 4. CTA
    c = Image.new("RGB", (W, H), BLACK)
    ph = cover(load("ornella-ext-arbre.jpg"), W, 760, fy=0.15)
    c.paste(ph, (0, 0)); c = c.convert("RGBA")
    gradient(c, 380, 760, BLACK)
    d = ImageDraw.Draw(c)
    slide_num(d, 4, WHITE)
    text(d, (W / 2, 800), "Écris", font(SERIF, 80), GOLD_L, anchor="ma")
    text(d, (W / 2, 880), "GO", font(BOLD, 210), WHITE, anchor="ma")
    text(d, (W / 2, 1100), "en message", font(SERIF, 80), GOLD_L, anchor="ma")
    text(d, (W / 2, 1216), "Je te dis quelle formule te correspond.", font(REG, 32), (200, 190, 178), anchor="ma")
    brand(d, 1290, (150, 140, 128))
    slides.append(c.convert("RGB"))
    return slides

# ---------------------------------------------------------------- PUB META (sans avant/après)
def pub_meta():
    c = cover(load("ornella-ext-arbre.jpg"), W, H, fy=0.0).convert("RGBA")
    gradient(c, 500, 940, BLACK, 0, 225)
    c.alpha_composite(Image.new("RGBA", (W, H - 940), BLACK + (225,)), (0, 940))
    d = ImageDraw.Draw(c)
    tag(d, (50, 50), "COACH DIPLÔMÉE D'ÉTAT", dark=True)
    text(d, (60, 820), "Louise a commencé 4 mois avant les fêtes.", fit(d, "Louise a commencé 4 mois avant les fêtes.", SERIF, 960, 58), GOLD_L)
    text(d, (52, 884), "−9 cm", font(BOLD, 196), WHITE)
    text(d, (60, 1096), "DE TOUR DE TAILLE EN 4 MOIS", font(BOLD, 38), WHITE, 3)
    text(d, (60, 1148), "Maman de 2 enfants · coachée à domicile par Ornella", font(REG, 28), (215, 205, 192))
    pill(d, (60, 1210, 640, 1274), GOLD_L, "ÉCRIS « GO » EN MESSAGE", font(BOLD, 30), BLACK, 3)
    text(d, (60, 1306), "Résultat individuel, variable selon les personnes.", font(REG, 20), (160, 150, 138))
    return c.convert("RGB")

if __name__ == "__main__":
    jobs = {
        "01-post-louise.png": post_louise,
        "02-post-emeline.png": post_emeline,
        "03-post-postpartum.png": post_postpartum,
        "05-pub-meta-louise.png": pub_meta,
    }
    for name, fn in jobs.items():
        fn().save(os.path.join(OUT, name), optimize=True)
    for i, s in enumerate(carrousel(), 1):
        s.save(os.path.join(OUT, f"04-carrousel-slide-{i}.png"), optimize=True)
    print("ok")
