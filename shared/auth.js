// ============================================================
// Enigma — shared/auth.js  (v2)
// ------------------------------------------------------------
// 1. Session Supabase + rôles (comme avant : sb, currentUser,
//    requireAuth(), requireAdmin(), isAdmin(), logout()).
// 2. NOUVEAU : la barre de navigation est générée ici, sur
//    toutes les pages, à partir d'UNE seule liste (ENIGMA_NAV).
//    Ajouter une page = ajouter une ligne ci-dessous.
// 3. NOUVEAU : helpers communs (toast, fmt, escHtml, formatDate)
//    disponibles partout — une page peut toujours redéfinir les siens.
// 4. NOUVEAU : badge temps réel "demandes de réservation en attente",
//    horloge, effets légers (compteurs, bip, confettis, halo boutons).
// ============================================================

// Masquer immédiatement le contenu des pages protégées (évite le flash)
if (!window.location.pathname.match(/login|index/)) {
  document.documentElement.style.visibility = 'hidden';
}

// ── Client Supabase partagé ───────────────────────────────────
const sb = supabase.createClient(
  ENIGMA_CONFIG.supabaseUrl,
  ENIGMA_CONFIG.supabaseAnonKey,
  { auth: { persistSession: true, storageKey: 'enigma_auth' } }
);

let currentUser = null; // { email, role, display_name, avatar_url }

// ── Navigation : source unique de vérité ─────────────────────
const ENIGMA_NAV = [
  { href: 'accueil.html',        ico: '🏠', label: 'Accueil' },
  { href: 'caisse.html',         ico: '🎫', label: 'Caisse' },
  { href: 'reservations.html',   ico: '🌐', label: 'Réservations', badge: 'nav-res-count' },
  { href: 'joueurs.html',        ico: '🏆', label: 'Joueurs' },
  { href: 'depenses.html',       ico: '💸', label: 'Dépenses' },
  { href: 'planning.html',       ico: '📅', label: 'Planning' },
  { href: 'rapprochements.html', ico: '📊', label: 'Rapprochements', admin: true, id: 'nav-rapprochements' },
  { href: 'admin.html',          ico: '⚙️', label: 'Admin',          admin: true, id: 'nav-admin' },
  { href: 'site.html',           ico: '🖥️', label: 'Site public',    admin: true, id: 'nav-site' },
];

function enigmaCurrentPage() {
  const p = window.location.pathname.split('/').pop() || 'accueil.html';
  return p === '' || p === 'index.html' ? 'accueil.html' : p;
}

// Remplace le contenu de <nav class="navbar"> (présent dans toutes les pages)
function enigmaRenderNav() {
  const nav = document.querySelector('nav.navbar');
  if (!nav || nav.dataset.rendered) return;
  const cur = enigmaCurrentPage();
  const links = ENIGMA_NAV.map(n =>
    `<a class="nav-link${n.href === cur ? ' active' : ''}${n.admin ? ' hidden' : ''}" href="${n.href}"${n.id ? ` id="${n.id}"` : ''}${n.admin ? ' data-admin="1"' : ''}>` +
      `<span class="nav-ico">${n.ico}</span><span>${n.label}</span>` +
      (n.badge ? `<span class="nav-count hidden" id="${n.badge}"></span>` : '') +
    `</a>`).join('');
  nav.innerHTML = `
    <a class="navbar-brand" href="accueil.html" title="Accueil">
      <img src="shared/logo.png" alt="Enigma">
      <small>Gestion</small>
    </a>
    <div class="nav-rail" id="nav-rail">${links}<span class="nav-ind" id="nav-ind"></span></div>
    <div class="nav-right">
      <span class="nav-clock" id="nav-clock"></span>
      <span class="nav-user" id="nav-user-pill"><i class="nav-avatar" id="nav-avatar">·</i><span class="nav-name" id="nav-user"></span></span>
      <button class="btn btn-ghost btn-sm" onclick="logout()" title="Se déconnecter"><span class="nav-logout-text">Déconnexion</span><span class="nav-logout-ico" aria-hidden="true">⏻</span></button>
    </div>`;
  nav.dataset.rendered = '1';

  // Repère laiton qui glisse sous le lien actif / survolé
  const rail = nav.querySelector('#nav-rail'), ind = nav.querySelector('#nav-ind');
  const moveTo = el => {
    if (!el) { ind.classList.remove('on'); return; }
    ind.style.left = (el.offsetLeft) + 'px'; ind.style.width = el.offsetWidth + 'px'; ind.classList.add('on');
  };
  const active = () => rail.querySelector('.nav-link.active:not(.hidden)');
  rail.querySelectorAll('.nav-link').forEach(a => a.addEventListener('mouseenter', () => moveTo(a)));
  rail.addEventListener('mouseleave', () => moveTo(active()));
  requestAnimationFrame(() => { moveTo(active()); const a = active(); if (a && a.scrollIntoView) a.scrollIntoView({ block: 'nearest', inline: 'center' }); });
  window.addEventListener('resize', () => moveTo(active()));
  document.fonts && document.fonts.ready.then(() => moveTo(active()));

  // Horloge
  const clock = nav.querySelector('#nav-clock');
  const tick = () => { clock.textContent = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); };
  tick(); setInterval(tick, 15000);
}
if (document.querySelector('nav.navbar')) enigmaRenderNav();
else document.addEventListener('DOMContentLoaded', enigmaRenderNav);

// Favicon (si la page n'en a pas)
if (!document.querySelector('link[rel~="icon"]')) {
  const l = document.createElement('link'); l.rel = 'icon'; l.href = 'shared/favicon.png'; document.head.appendChild(l);
}

// ── Session ──────────────────────────────────────────────────
function enigmaApplyUserToNav() {
  if (!currentUser) return;
  const navUser = document.getElementById('nav-user');
  if (navUser) navUser.textContent = currentUser.display_name;
  const av = document.getElementById('nav-avatar');
  if (av) {
    if (currentUser.avatar_url) av.innerHTML = `<img src="${currentUser.avatar_url}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
    else av.textContent = currentUser.display_name.trim().split(/\s+/).map(s => s[0]).join('').slice(0, 2).toUpperCase();
  }
  const pill = document.getElementById('nav-user-pill');
  if (pill && currentUser.role === 'admin' && !pill.querySelector('.nav-role')) {
    const r = document.createElement('span'); r.className = 'nav-role'; r.textContent = 'admin'; pill.appendChild(r);
  }
  // Liens réservés aux admins
  document.querySelectorAll('[data-admin="1"], #nav-rapprochements, #nav-admin, #nav-site').forEach(a => a.classList.toggle('hidden', currentUser.role !== 'admin'));
  const ind = document.getElementById('nav-ind'), act = document.querySelector('#nav-rail .nav-link.active:not(.hidden)');
  if (ind && act) { ind.style.left = act.offsetLeft + 'px'; ind.style.width = act.offsetWidth + 'px'; ind.classList.add('on'); }
}

// Vérifie la session ; redirige vers login.html si absente.
async function requireAuth() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
    window.location.href = 'login.html';
    throw new Error('unauthenticated');
  }
  currentUser = {
    email:        session.user.email,
    // Rôle lu depuis app_metadata uniquement — non modifiable par l'utilisateur
    // IMPORTANT : un rôle absent/vide NE DOIT JAMAIS être traité comme 'staff'.
    role:         (session.user.app_metadata?.role || 'user').toLowerCase(),
    display_name: session.user.user_metadata?.display_name || session.user.email.split('@')[0],
    avatar_url:   session.user.user_metadata?.avatar_url || '',
  };
  // Un compte "joueur" (site public) ou "sync" n'a rien à faire ici
  if (!['admin', 'staff'].includes(currentUser.role)) {
    await sb.auth.signOut();
    window.location.href = 'login.html?e=role';
    throw new Error('unauthorized');
  }
  document.documentElement.style.visibility = 'visible';
  enigmaApplyUserToNav();
  enigmaStartPendingBadge();
  return session;
}

// Vérifie session ET rôle admin ; redirige sinon.
async function requireAdmin() {
  const session = await requireAuth();
  if (currentUser.role !== 'admin') {
    window.location.href = 'accueil.html';
    throw new Error('unauthorized');
  }
  return session;
}

function isAdmin() { return currentUser?.role === 'admin'; }

async function logout() {
  await sb.auth.signOut();
  window.location.href = 'login.html';
}

// Session expirée / déconnexion depuis un autre onglet → retour au login
sb.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT' && !window.location.pathname.match(/login|index/)) window.location.href = 'login.html';
});

// ── Badge "demandes en attente" (nav) — temps réel + secours ─
let _pendingStarted = false;
function enigmaStartPendingBadge() {
  if (_pendingStarted) return; _pendingStarted = true;
  const badge = document.getElementById('nav-res-count'); if (!badge) return;
  let last = null;
  const upd = async () => {
    try {
      const { count, error } = await sb.from('reservation_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending');
      if (error) return;
      const n = count || 0;
      badge.textContent = n; badge.classList.toggle('hidden', !n); badge.classList.toggle('hot', n > 0);
      if (last !== null && n > last && !enigmaCurrentPage().startsWith('reservations')) {
        toast(`🌐 Nouvelle demande de réservation en ligne (${n} en attente)`, 'info'); uiPing();
      }
      last = n;
      document.title = document.title.replace(/^\(\d+\)\s*/, '');
      if (n) document.title = `(${n}) ` + document.title;
    } catch (e) { /* silencieux */ }
  };
  setTimeout(upd, 600);
  try { sb.channel('nav-resreq').on('postgres_changes', { event: '*', schema: 'public', table: 'reservation_requests' }, upd).subscribe(); } catch (e) {}
  setInterval(upd, 90000); // secours si le temps réel est indisponible
}

// ── Helpers communs (une page peut redéfinir les siens) ──────
window.fmt = window.fmt || function (n) { return Number(n || 0).toLocaleString('fr-FR') + ' ' + (ENIGMA_CONFIG.currency || 'FCFA'); };
window.escHtml = window.escHtml || function (s) { return String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); };
window.formatDate = window.formatDate || function (d) { if (!d) return ''; const [y, m, day] = String(d).slice(0, 10).split('-'); return `${day}/${m}/${y}`; };
window.toast = window.toast || function (msg, type = 'info') {
  let c = document.getElementById('toast-container');
  if (!c) { c = document.createElement('div'); c.id = 'toast-container'; document.body.appendChild(c); }
  const t = document.createElement('div');
  t.className = `toast toast-${type === 'ok' ? 'ok' : type === 'err' ? 'err' : 'info'}`;
  t.textContent = msg; c.appendChild(t);
  setTimeout(() => { t.style.transition = 'opacity .3s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 3500);
};

// ── Effets légers partagés ───────────────────────────────────
// Compteurs animés : <span class="stat-value" data-count="42">0</span>
function uiCountUp(root) {
  (root || document).querySelectorAll('[data-count]').forEach(el => {
    if (el.dataset.counted) return; el.dataset.counted = '1';
    const target = parseFloat(el.dataset.count) || 0, suffix = el.dataset.suffix || '', start = performance.now(), dur = 700;
    const f = v => (Number.isInteger(target) ? Math.round(v).toLocaleString('fr-FR') : v.toFixed(1)) + suffix;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { el.textContent = f(target); return; }
    (function step(t) { const p = Math.min((t - start) / dur, 1); el.textContent = f(target * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(step); })(start);
  });
}
// Halo suivant la souris sur les boutons
document.addEventListener('pointermove', e => {
  const b = e.target.closest && e.target.closest('.btn'); if (!b) return;
  const r = b.getBoundingClientRect();
  b.style.setProperty('--x', ((e.clientX - r.left) / r.width * 100) + '%');
  b.style.setProperty('--y', ((e.clientY - r.top) / r.height * 100) + '%');
}, { passive: true });
// Bip discret
function uiPing() {
  try {
    const c = new (window.AudioContext || window.webkitAudioContext)();
    const o = c.createOscillator(), g = c.createGain(); o.connect(g); g.connect(c.destination);
    o.frequency.value = 880; g.gain.setValueAtTime(.06, c.currentTime); g.gain.exponentialRampToValueAtTime(.0001, c.currentTime + .4);
    o.start(); o.stop(c.currentTime + .4);
  } catch (e) {}
}
// Confettis
function uiConfetti() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const cv = document.createElement('canvas'); cv.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:999'; document.body.appendChild(cv);
  const ctx = cv.getContext('2d'); cv.width = innerWidth; cv.height = innerHeight;
  const cols = ['#857af5', '#38c8de', '#c8a75c', '#4ade80', '#e0526e', '#e3c78a'];
  const ps = Array.from({ length: 140 }, () => ({ x: innerWidth / 2, y: innerHeight / 3, vx: (Math.random() - .5) * 14, vy: -Math.random() * 12 - 4, r: Math.random() * 6 + 3, c: cols[Math.random() * cols.length | 0], a: Math.random() * 6 }));
  let f = 0; (function loop() { ctx.clearRect(0, 0, cv.width, cv.height); ps.forEach(p => { p.vy += .35; p.x += p.vx; p.y += p.vy; p.a += .1; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.fillStyle = p.c; ctx.fillRect(-p.r / 2, -p.r / 2, p.r, p.r * .6); ctx.restore(); }); if (++f < 100) requestAnimationFrame(loop); else cv.remove(); })();
}

// Raccourcis clavier : Alt+1 … Alt+9 = pages de la nav
document.addEventListener('keydown', e => {
  if (!e.altKey || e.ctrlKey || e.metaKey) return;
  const i = parseInt(e.key, 10); if (!(i >= 1 && i <= 9)) return;
  const links = [...document.querySelectorAll('#nav-rail .nav-link:not(.hidden)')];
  if (links[i - 1]) { e.preventDefault(); window.location.href = links[i - 1].getAttribute('href'); }
});
