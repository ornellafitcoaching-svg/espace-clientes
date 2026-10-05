"""Génère les visuels de la campagne "Objectif Fêtes / Été 2027" (PNG 1080x1350).

Règles de lisibilité mobile (un post s'affiche ~3x plus petit sur téléphone) :
- une seule typo bold, aucun texte sous 30 px (sauf mention légale de la pub) ;
- doré uniquement sur fond noir, texte noir sur beige ;
- textes clés à plus de 60 px des bords (recadrage 3:4 de la grille Instagram).
"""
import os
from PIL import Image, ImageDraw, ImageFont, ImageOps

SITE = os.environ.get("SITE_IMAGES", "/home/user/ornellafitcoaching-svg/ornellafit-site/images")
FONTS = os.environ.get("FONTS_DIR", "/mnt/skills/examples/canvas-design/canvas-fonts")
OUT = os.path.dirname(os.path.abspath(__file__))

W, H = 1080, 1350
NUDE = (240, 230, 218)
BLACK = (20, 17, 15)
GOLD = (218, 181, 110)       # doré : uniquement sur noir
GOLD_D = (122, 88, 28)       # doré foncé : lisible sur beige / blanc
WHITE = (255, 252, 247)
SOFT = (225, 216, 204)       # texte secondaire sur noir

BOLD, REG = "Outfit-Bold.ttf", "Outfit-Regular.ttf"
CTA = "ÉCRIS « GO » EN MESSAGE"
CTA_SUB = "→ ton bilan gratuit de 30 min"

def font(name, size):
    return ImageFont.truetype(os.path.join(FONTS, name), size)

def load(name):
    return ImageOps.exif_transpose(Image.open(os.path.join(SITE, name))).convert("RGB")

def cover(img, w, h, fy=0.5):
    iw, ih = img.size
    if iw / ih > w / h:
        nw = int(ih * w / h); x = (iw - nw) // 2; img = img.crop((x, 0, x + nw, ih))
    else:
        nh = int(iw * h / w); y = int((ih - nh) * fy); img = img.crop((0, y, iw, y + nh))
    return img.resize((w, h), Image.LANCZOS)

def tw(d, s, f, sp=0):
    return d.textlength(s, font=f) + sp * max(len(s) - 1, 0)

def text(d, xy, s, f, fill, sp=0, anchor="la"):
    x, y = xy
    if not sp:
        d.text((x, y), s, font=f, fill=fill, anchor=anchor); return
    total = tw(d, s, f, sp)
    x -= {"l": 0, "m": total / 2, "r": total}[anchor[0]]
    for ch in s:
        d.text((x, y), ch, font=f, fill=fill, anchor="l" + anchor[1])
        x += d.textlength(ch, font=f) + sp

def fit(d, s, name, max_w, size):
    while d.textlength(s, font=font(name, size)) > max_w:
        size -= 2
    return font(name, size)

def marker(d, cx, y, s, f, bg, fg, pad=(22, 10)):
    """Texte centré sur un surlignage (effet feutre) : lisible et accrocheur."""
    w = tw(d, s, f)
    asc, desc = f.getmetrics()
    h = asc + desc * 0.6
    d.rounded_rectangle((cx - w / 2 - pad[0], y - pad[1] + 6, cx + w / 2 + pad[0], y + h + pad[1]), radius=10, fill=bg)
    d.text((cx, y), s, font=f, fill=fg, anchor="ma")

def pill(d, box, fill, label, f, color, sp=0):
    x0, y0, x1, y1 = box
    d.rounded_rectangle(box, radius=(y1 - y0) // 2, fill=fill)
    text(d, ((x0 + x1) / 2, (y0 + y1) / 2), label, f, color, sp, anchor="mm")

def tag(d, xy, label, dark=True, size=28):
    f = font(BOLD, size)
    w = tw(d, label, f, 2) + 40
    x, y = xy
    if x < 0:  # aligné à droite
        x = -x - w
    d.rounded_rectangle((x, y, x + w, y + size + 22), radius=(size + 22) // 2, fill=BLACK if dark else WHITE)
    text(d, (x + w / 2, y + (size + 22) / 2), label, f, WHITE if dark else BLACK, 2, anchor="mm")

def before_after(c, img, box, fy=0.5, radius=28, trim=0.022, caption=None):
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    iw, ih = img.size
    m = int(iw * trim)
    ph = cover(img.crop((m, m, iw - m, ih - m)), w, h, fy=fy)
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, w, h), radius=radius, fill=255)
    c.paste(ph, (x0, y0), mask)
    d = ImageDraw.Draw(c)
    tag(d, (x0 + 22, y0 + 22), "AVANT", dark=False)
    tag(d, (x0 + w // 2 + 22, y0 + 22), "APRÈS", dark=True)
    if caption:
        tag(d, (-(x1 - 22), y1 - 72), caption, dark=False, size=28)

def gradient(c, y0, y1, color, a0=0, a1=255):
    ov = Image.new("RGBA", (W, y1 - y0)); od = ImageDraw.Draw(ov)
    for i in range(y1 - y0):
        od.line([(0, i), (W, i)], fill=color + (int(a0 + (a1 - a0) * i / (y1 - y0)),))
    c.alpha_composite(ov, (0, y0))

def cta_block(d, y, dark_bg=True):
    """Bouton CTA + bénéfice immédiat (bilan gratuit existant sur le site)."""
    pill(d, (60, y, W - 60, y + 84), GOLD if dark_bg else BLACK, CTA, font(BOLD, 38), BLACK if dark_bg else WHITE, 2)

def result_band(c, big_left, big_right, right_lines, y=1062):
    d = ImageDraw.Draw(c)
    d.rectangle((0, y, W, H), fill=BLACK)
    big = font(BOLD, 124)
    x = 60
    text(d, (x, y + 14), big_left, big, GOLD)
    x += tw(d, big_left, big)
    if big_right:
        x += 26; d.line([(x, y + 44), (x, y + 128)], fill=GOLD, width=4); x += 26
        text(d, (x, y + 14), big_right, big, WHITE)
        x += tw(d, big_right, big)
    for i, (s, col) in enumerate(right_lines):
        if not s:
            continue
        f = fit(d, s, BOLD, W - 60 - x - 30, 44)
        text(d, (W - 60, y + 40 + i * 54), s, f, col, anchor="ra")
    cta_block(d, y + 176)
    return d

# ---------------------------------------------------------------- POST 1
def post_louise(hook2="Elle a commencé 4 mois avant."):
    c = Image.new("RGB", (W, H), NUDE); d = ImageDraw.Draw(c)
    text(d, (W / 2, 44), "Les fêtes arrivent.", font(BOLD, 84), BLACK, anchor="ma")
    marker(d, W / 2, 152, hook2, fit(d, hook2, BOLD, 900, 64), BLACK, GOLD)
    before_after(c, load("louise-face.jpg"), (40, 250, W - 40, 1042), fy=0.06, caption="LOUISE · MAMAN DE 2")
    result_band(c, "−9 cm", "−5 kg", [("", WHITE), ("EN 4 MOIS", WHITE)])
    return c

# ---------------------------------------------------------------- POST 2
def post_emeline():
    c = Image.new("RGB", (W, H), NUDE); d = ImageDraw.Draw(c)
    text(d, (W / 2, 44), "Ton été 2027", font(BOLD, 84), BLACK, anchor="ma")
    marker(d, W / 2, 152, "se construit maintenant.", font(BOLD, 64), BLACK, GOLD)
    before_after(c, load("avant-apres-emeline-2.jpg"), (40, 250, W - 40, 1042), fy=0.22, caption="EMELINE · MAMAN DE 2")
    result_band(c, "2 mois", None, [("FESSIERS GALBÉS", WHITE), ("TAILLE AFFINÉE", GOLD)])
    return c

# ---------------------------------------------------------------- POST 3
def post_postpartum():
    c = Image.new("RGB", (W, H), BLACK); d = ImageDraw.Draw(c)
    f = font(BOLD, 66)
    text(d, (W / 2, 40), "Si je l'ai fait après", f, WHITE, anchor="ma")
    text(d, (W / 2, 122), "une grossesse difficile,", f, WHITE, anchor="ma")
    before_after(c, load("ornella-avant-apres-postpartum.jpg"), (40, 230, W - 40, 1000), fy=0.35, caption="ORNELLA · MAMAN")
    marker(d, W / 2, 1036, "tu peux le faire.", font(BOLD, 96), GOLD, BLACK, pad=(28, 8))
    text(d, (W / 2, 1172), "COACH DIPLÔMÉE D'ÉTAT", font(BOLD, 32), SOFT, 4, anchor="ma")
    cta_block(d, 1236)
    return c

# ---------------------------------------------------------------- CARROUSEL
def slide_num(d, n, color):
    text(d, (W - 60, 60), f"{n}/4", font(BOLD, 32), color, anchor="ra")

def carrousel():
    slides = []
    # 1. Couverture : promesse + frise
    c = Image.new("RGB", (W, H), BLACK); d = ImageDraw.Draw(c)
    slide_num(d, 1, GOLD)
    tag(d, (60, 52), "OBJECTIF FÊTES + ÉTÉ 2027", dark=False, size=28)
    f = font(BOLD, 100)
    for i, (s, col) in enumerate([("Les fêtes", WHITE), ("sans reprendre.", WHITE), ("L'été 2027", GOLD), ("avec 3 mois", GOLD), ("d'avance.", GOLD)]):
        text(d, (60, 180 + i * 112), s, f, col)
    ty = 900
    d.line([(190, ty), (W - 190, ty)], fill=(90, 82, 74), width=6)
    d.line([(190, ty), (W / 2, ty)], fill=GOLD, width=8)
    for x, t1, t2, col in [(190, "MAINTENANT", "tu commences", GOLD),
                           (W / 2, "LES FÊTES", "tu tiens le cap", WHITE),
                           (W - 190, "ÉTÉ 2027", "tu es prête", WHITE)]:
        r = 24 if col == GOLD else 18
        d.ellipse((x - r, ty - r, x + r, ty + r), fill=col)
        text(d, (x, ty + 50), t1, font(BOLD, 34), col, 1, anchor="ma")
        text(d, (x, ty + 96), t2, font(REG, 34), SOFT, anchor="ma")
    pill(d, (60, 1210, 520, 1294), GOLD, "LE PLAN  →", font(BOLD, 40), BLACK, 3)
    slides.append(c)
    # 2. Preuves
    c = Image.new("RGB", (W, H), NUDE); d = ImageDraw.Draw(c)
    slide_num(d, 2, BLACK)
    text(d, (60, 40), "Elles ont commencé avant.", font(BOLD, 64), BLACK)
    y = 140
    for img, fy, who, res in [("louise-face.jpg", 0.14, "LOUISE", "−9 cm en 4 mois"),
                              ("avant-apres-emeline-2.jpg", 0.32, "EMELINE", "fessiers + taille, 2 mois")]:
        before_after(c, load(img), (40, y, W - 40, y + 480), fy=fy)
        d.rounded_rectangle((40, y + 492, W - 40, y + 572), radius=22, fill=BLACK)
        text(d, (72, y + 532), who, font(BOLD, 34), WHITE, 2, anchor="lm")
        text(d, (W - 72, y + 532), res, font(BOLD, 42), GOLD, anchor="rm")
        y += 600
    slides.append(c)
    # 3. Formules (libellés du site)
    c = Image.new("RGB", (W, H), NUDE); d = ImageDraw.Draw(c)
    slide_num(d, 3, BLACK)
    text(d, (60, 40), "Choisis ta formule.", font(BOLD, 76), BLACK)
    cards = [("DOMICILE", "Je viens chez toi (91/92)", "260", "LA FORMULE DE LOUISE"),
             ("HYBRIDE", "Séances avec moi + programme", "99", "LA FORMULE D'EMELINE"),
             ("DISTANCIEL", "Programme + suivi WhatsApp", "89", "OÙ QUE TU SOIS")]
    y = 160
    for i, (name, sub, price, note) in enumerate(cards):
        dark = i == 0
        bg, fg, sc, pc = (BLACK, WHITE, SOFT, GOLD) if dark else (WHITE, BLACK, (70, 62, 55), BLACK)
        d.rounded_rectangle((40, y, W - 40, y + 310), radius=30, fill=bg)
        text(d, (84, y + 44), name, font(BOLD, 60), fg, 2)
        text(d, (84, y + 130), sub, font(REG, 34), sc)
        tag(d, (84, y + 206), note, dark=not dark, size=26) if not dark else pill(d, (84, y + 206, 84 + tw(d, note, font(BOLD, 26), 2) + 40, y + 254), GOLD, note, font(BOLD, 26), BLACK, 2)
        text(d, (W - 84, y + 46), "dès", font(BOLD, 34), sc, anchor="ra")
        euro = font(BOLD, 64)
        text(d, (W - 84 - tw(d, "€", euro), y + 88), price, font(BOLD, 124), pc, anchor="ra")
        text(d, (W - 84, y + 120), "€", euro, pc, anchor="ra")
        text(d, (W - 84, y + 232), "/ mois", font(BOLD, 34), sc, anchor="ra")
        y += 334
    text(d, (60, 1196), "Tu hésites ?", font(BOLD, 52), BLACK)
    text(d, (60, 1260), "Je te dis laquelle te correspond.", font(REG, 36), (70, 62, 55))
    text(d, (W - 60, 1214), "→", font(BOLD, 80), BLACK, anchor="ra")
    slides.append(c)
    # 4. CTA
    c = Image.new("RGB", (W, H), BLACK)
    c.paste(cover(load("ornella-ext-arbre.jpg"), W, 700, fy=0.12), (0, 0)); c = c.convert("RGBA")
    gradient(c, 420, 700, BLACK)
    d = ImageDraw.Draw(c)
    slide_num(d, 4, WHITE)
    text(d, (W / 2, 690), "ÉCRIS", font(BOLD, 64), GOLD, 8, anchor="ma")
    text(d, (W / 2, 760), "GO", font(BOLD, 230), WHITE, anchor="ma")
    text(d, (W / 2, 1000), "EN MESSAGE", font(BOLD, 64), GOLD, 8, anchor="ma")
    pill(d, (90, 1110, W - 90, 1194), GOLD, "BILAN GRATUIT DE 30 MIN", font(BOLD, 40), BLACK, 2)
    text(d, (W / 2, 1230), "On choisit ta formule ensemble.", font(REG, 38), SOFT, anchor="ma")
    slides.append(c.convert("RGB"))
    return slides

# ---------------------------------------------------------------- PUB META (sans avant/après)
def pub_meta():
    c = Image.new("RGB", (W, H), BLACK)
    c.paste(cover(load("ornella-ext-arbre.jpg"), W, 820, fy=0.0), (0, 0)); c = c.convert("RGBA")
    gradient(c, 560, 820, BLACK)
    d = ImageDraw.Draw(c)
    tag(d, (50, 50), "COACH DIPLÔMÉE D'ÉTAT", dark=True, size=28)
    marker(d, W / 2, 720, "Louise, maman de 2 enfants :", font(BOLD, 48), GOLD, BLACK, pad=(24, 8))
    text(d, (W / 2, 800), "−9 cm", font(BOLD, 230), WHITE, anchor="ma")
    text(d, (W / 2, 1036), "DE TOUR DE TAILLE EN 4 MOIS", font(BOLD, 46), GOLD, 2, anchor="ma")
    pill(d, (60, 1130, W - 60, 1214), GOLD, CTA, font(BOLD, 38), BLACK, 2)
    text(d, (W / 2, 1240), "Bilan gratuit 30 min · domicile 91/92 ou en ligne", font(REG, 32), SOFT, anchor="ma")
    text(d, (W / 2, 1302), "Résultat individuel, variable selon les personnes.", font(REG, 22), (150, 140, 128), anchor="ma")
    return c.convert("RGB")

if __name__ == "__main__":
    jobs = {
        "01-post-louise.png": post_louise,
        "01b-post-louise-variante-noel.png": lambda: post_louise("Noël dernier, elle a commencé."),
        "02-post-emeline.png": post_emeline,
        "03-post-postpartum.png": post_postpartum,
        "05-pub-meta-louise.png": pub_meta,
    }
    for name, fn in jobs.items():
        fn().save(os.path.join(OUT, name), optimize=True)
    for i, s in enumerate(carrousel(), 1):
        s.save(os.path.join(OUT, f"04-carrousel-slide-{i}.png"), optimize=True)
    print("ok")
