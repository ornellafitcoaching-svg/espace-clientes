#!/usr/bin/env python3
"""Chiffre une page du site (AES-GCM, clé dérivée du code par PBKDF2-SHA256).
La page publiée ne contient plus que le texte chiffré : sans le code, son contenu est illisible.
Déverrouillage : ?code=XXXX, code saisi, code mémorisé sur l'appareil, ou preuve d'achat Stripe
(?session_id=cs_…) vérifiée par la fonction acces-achat.
Usage :  proteger.py chiffrer <page.html> <CODE> <slug> <titre> [--merci|--cliente]
         proteger.py dechiffrer <page.html> <CODE>   (affiche le HTML d'origine)
"""
import sys, os, json, base64, re, html
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes

ITER = 150000
FN = "https://xvetwfqzkkcfchxxifuu.supabase.co/functions/v1/acces-achat"

def derive(code, salt):
    return PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=ITER).derive(code.strip().upper().encode())

def chiffrer(src, code):
    salt, iv = os.urandom(16), os.urandom(12)
    ct = AESGCM(derive(code, salt)).encrypt(iv, src.encode("utf-8"), None)
    b = lambda x: base64.b64encode(x).decode()
    return {"s": b(salt), "i": b(iv), "c": b(ct), "n": ITER}

def dechiffrer(page, code):
    m = re.search(r'<script type="application/json" id="ofc-data">(.*?)</script>', page, re.S)
    d = json.loads(m.group(1)); bd = base64.b64decode
    return AESGCM(derive(code, bd(d["s"]))).decrypt(bd(d["i"]), bd(d["c"]), None).decode()

WRAP = open(os.path.join(os.path.dirname(__file__), "proteger-modele.html"), encoding="utf-8").read()

if __name__ == "__main__":
    action = sys.argv[1]
    if action == "dechiffrer":
        print(dechiffrer(open(sys.argv[2], encoding="utf-8").read(), sys.argv[3])); sys.exit()
    path, code, slug, titre = sys.argv[2:6]
    merci = "2" if "--cliente" in sys.argv else ("1" if "--merci" in sys.argv else "0")
    src = open(path, encoding="utf-8").read()
    if "ofc-data" in src: sys.exit("déjà protégée : " + path)
    # La page déchiffrée n'affiche plus son ancien écran « code d'accès » (déjà validé ici).
    src = re.sub(r"<head([^>]*)>", r'<head\1><style>#contentGate,#agGate{display:none!important}</style>', src, count=1)
    src = src.replace("<body class=\"content-locked\">", "<body>").replace("<body class=\"ag-locked\">", "<body>")
    data = chiffrer(src, code)
    out = (WRAP.replace("{{TITRE}}", html.escape(titre)).replace("{{SLUG}}", slug)
              .replace("{{MERCI}}", merci).replace("{{FN}}", FN)
              .replace("{{DATA}}", json.dumps(data)))
    open(path, "w", encoding="utf-8").write(out)
    print("protégée :", path)
