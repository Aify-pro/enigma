#!/usr/bin/env python3
"""
Enigma — Synchronisation MC Houdini -> Supabase
================================================
Tourne sur chaque poste Game Master. Lit les fichiers que MC Houdini écrit pour
son scoreboard (rooms/<Salle>/ScoreBoard_Json.txt) et envoie chaque ligne dans
la table `houdini_scores` de Supabase, sans doublon.

Le scoreboard.html de Houdini fait exactement ceci côté navigateur :
    $.getJSON('rooms/' + room + '/ScoreBoard_Json.txt')  -> tableau d'objets
    { Escape_Room_Name, Team_Name, Escaped ("true"/"false"), Remaining_Time,
      HMCScore, GivenClues, Score, ... }
On reproduit la même lecture en Python.

Installation (Windows) :
    pip install -r requirements.txt
    copier .env.example -> .env et remplir
    python houdini_sync.py            (boucle toutes les 60 s)
    python houdini_sync.py --once     (un seul passage)
Pour lancer au démarrage : Planificateur de tâches Windows -> "Au démarrage" -> pythonw.exe houdini_sync.py
"""
import os, sys, json, time, hashlib, glob, logging, argparse
from datetime import datetime, timezone
from pathlib import Path

try:
    from dotenv import load_dotenv
    from supabase import create_client
except ImportError:
    print("Dépendances manquantes : pip install -r requirements.txt"); sys.exit(1)

load_dotenv(Path(__file__).with_name('.env'))
SUPABASE_URL  = os.getenv('SUPABASE_URL', 'https://lkklkceakfmufgtzzjwy.supabase.co')
SUPABASE_KEY  = os.getenv('SUPABASE_ANON_KEY', '')
SYNC_EMAIL    = os.getenv('SYNC_EMAIL', '')          # utilisateur Supabase Auth dédié (role "sync")
SYNC_PASSWORD = os.getenv('SYNC_PASSWORD', '')
HOUDINI_DIR   = os.getenv('HOUDINI_DIR', r'C:\MCHoudini\Web')  # dossier contenant "rooms/"
STATION       = os.getenv('STATION_NAME', os.environ.get('COMPUTERNAME', 'GM'))
INTERVAL      = int(os.getenv('INTERVAL_SECONDS', '60'))

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s',
                    handlers=[logging.FileHandler(Path(__file__).with_name('houdini_sync.log'), encoding='utf-8'), logging.StreamHandler()])
log = logging.getLogger('houdini')

def as_bool(v):
    return str(v).strip().lower() in ('true', '1', 'yes', 'oui')

def read_scores(rooms_dir: Path):
    """Renvoie une liste de lignes (dict) pour tous les fichiers ScoreBoard_Json.txt trouvés."""
    rows = []
    for f in glob.glob(str(rooms_dir / '*' / 'ScoreBoard_Json.txt')):
        p = Path(f); room_folder = p.parent.name
        try:
            raw = p.read_text(encoding='utf-8-sig', errors='ignore').strip()
            if not raw: continue
            data = json.loads(raw)
        except Exception as e:
            log.warning('Lecture impossible %s : %s', f, e); continue
        if isinstance(data, dict): data = [data]
        mtime = datetime.fromtimestamp(p.stat().st_mtime, tz=timezone.utc)
        for i, d in enumerate(data):
            if not isinstance(d, dict) or not d.get('Team_Name'): continue   # Houdini termine souvent le tableau par un objet vide
            room_name = d.get('Escape_Room_Name') or room_folder
            # date : Houdini n'en met pas toujours ; on prend celle du fichier si absente
            played = d.get('Date') or d.get('Played_At') or d.get('DateTime')
            try:
                played_at = datetime.fromisoformat(str(played)).astimezone(timezone.utc) if played else mtime
            except Exception:
                played_at = mtime
            base = f"{STATION}|{room_name}|{d.get('Team_Name')}|{d.get('Remaining_Time')}|{d.get('Score')}|{d.get('HMCScore')}|{d.get('GivenClues')}|{played or ''}|{i}"
            rows.append({
                'station': STATION, 'room_name': str(room_name).strip(), 'team_name': str(d.get('Team_Name')).strip(),
                'escaped': as_bool(d.get('Escaped')),
                'remaining_time': str(d.get('Remaining_Time') or ''), 'elapsed_time': str(d.get('Elasped_Time') or d.get('Elapsed_Time') or ''),
                'hmc_score': str(d.get('HMCScore') or ''), 'given_clues': str(d.get('GivenClues') or ''), 'score': str(d.get('Score') or ''),
                'played_at': played_at.isoformat(), 'row_hash': hashlib.sha1(base.encode()).hexdigest(), 'raw': d,
            })
    return rows

def sync_once(sb):
    rooms_dir = Path(HOUDINI_DIR) / 'rooms'
    if not rooms_dir.exists():
        log.error('Dossier introuvable : %s (vérifiez HOUDINI_DIR dans .env)', rooms_dir); return 0
    rows = read_scores(rooms_dir)
    if not rows: log.info('Aucun score à envoyer'); return 0
    sent = 0
    for chunk in (rows[i:i+200] for i in range(0, len(rows), 200)):
        # upsert sur row_hash : les lignes déjà envoyées sont ignorées
        res = sb.table('houdini_scores').upsert(chunk, on_conflict='row_hash', ignore_duplicates=True).execute()
        sent += len(res.data or [])
    log.info('%d ligne(s) lue(s), %d nouvelle(s) envoyée(s)', len(rows), sent)
    return sent

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--once', action='store_true'); args = ap.parse_args()
    if not (SUPABASE_KEY and SYNC_EMAIL and SYNC_PASSWORD):
        log.error('Renseignez SUPABASE_ANON_KEY, SYNC_EMAIL et SYNC_PASSWORD dans .env'); sys.exit(1)
    sb = create_client(SUPABASE_URL, SUPABASE_KEY)
    sb.auth.sign_in_with_password({'email': SYNC_EMAIL, 'password': SYNC_PASSWORD})
    log.info('Connecté. Poste = %s, dossier = %s', STATION, HOUDINI_DIR)
    while True:
        try: sync_once(sb)
        except Exception as e:
            log.exception('Erreur de synchronisation : %s', e)
            try: sb.auth.refresh_session()
            except Exception: pass
        if args.once: break
        time.sleep(INTERVAL)

if __name__ == '__main__':
    main()
