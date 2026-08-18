#!/usr/bin/env python3
"""
Enigma — tools/apply_update.py
================================
À lancer UNE fois à la racine du dépôt GitHub (logiciel de gestion), après avoir
copié le contenu du dossier `backend/` du paquet de mise à jour :

    python3 tools/apply_update.py            # applique
    python3 tools/apply_update.py --check    # montre ce qui serait modifié, sans écrire

Ce qu'il fait sur chaque page HTML existante (caisse, depenses, planning,
rapprochements, admin… et toute autre page qui contient une <nav class="navbar">) :
  1. remplace l'ancienne barre de navigation codée en dur par une balise vide
     <nav class="navbar"></nav> — shared/auth.js la génère désormais sur toutes les
     pages (les nouveaux liens Accueil / Réservations / Joueurs / Site public
     apparaissent partout, avec le badge "demandes en attente") ;
  2. ajoute le favicon ;
  3. remplace les redirections vers caisse.html par accueil.html (page d'accueil).
Le script est idempotent : le relancer ne change rien.
Rien n'est supprimé : git diff vous montre exactement les changements.
"""
import re, sys, pathlib

CHECK = '--check' in sys.argv
ROOT = pathlib.Path(__file__).resolve().parent.parent
NAV_RE = re.compile(r'<nav class="navbar">.*?</nav>', re.S)
NAV_NEW = '<nav class="navbar"><!-- généré par shared/auth.js --></nav>'
FAVICON = '<link rel="icon" href="shared/favicon.png">'
SKIP = {'index.html', 'login.html'}

def patch(path: pathlib.Path):
    src = path.read_text(encoding='utf-8')
    out = src
    changes = []
    if NAV_RE.search(out) and NAV_NEW not in out:
        out = NAV_RE.sub(NAV_NEW, out, count=1); changes.append('nav dynamique')
    if 'shared/favicon.png' not in out and '<link rel="stylesheet" href="shared/style.css">' in out:
        out = out.replace('<link rel="stylesheet" href="shared/style.css">', FAVICON + '\n  <link rel="stylesheet" href="shared/style.css">', 1); changes.append('favicon')
    # navbar-brand pointait vers caisse.html ; l'accueil est désormais accueil.html
    n = out.count("window.location.href = 'caisse.html'")
    if n and path.name not in ('caisse.html',):
        out = out.replace("window.location.href = 'caisse.html'", "window.location.href = 'accueil.html'"); changes.append(f'{n} redirection(s) → accueil')
    if out != src:
        if not CHECK: path.write_text(out, encoding='utf-8')
        print(f"{'[check] ' if CHECK else ''}{path.name}: {', '.join(changes)}")
        return True
    return False

def main():
    if not (ROOT / 'shared' / 'auth.js').exists():
        sys.exit("Lancez ce script depuis le dépôt (shared/auth.js introuvable). Avez-vous copié le dossier backend/ ?")
    if 'ENIGMA_NAV' not in (ROOT / 'shared' / 'auth.js').read_text(encoding='utf-8'):
        sys.exit("shared/auth.js n'est pas la version 2 : copiez d'abord les fichiers du paquet (shared/auth.js, shared/style.css…).")
    touched = 0
    for p in sorted(ROOT.glob('*.html')):
        if p.name in SKIP: continue
        touched += patch(p)
    print(f"\n{touched} fichier(s) {'à modifier' if CHECK else 'modifié(s)'}." if touched else "\nRien à faire : tout est déjà à jour.")
    if touched and not CHECK:
        print("Vérifiez avec `git diff`, puis `git add -A && git commit -m \"Backend v2 : navigation, accueil, réservations, joueurs, site\" && git push`.")

if __name__ == '__main__':
    main()
