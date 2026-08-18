// ── Enigma backend — petits effets partagés ─────────────────
// Compteurs animés sur les .stat-value[data-count]
function uiCountUp(root) {
  (root || document).querySelectorAll('[data-count]').forEach(el => {
    const target = parseFloat(el.dataset.count) || 0, start = performance.now(), dur = 700;
    const fmt = v => Number.isInteger(target) ? Math.round(v).toLocaleString('fr-FR') : v.toFixed(1);
    (function step(t) { const p = Math.min((t - start) / dur, 1); el.textContent = fmt(target * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(step); })(start);
  });
}
// Halo suivant la souris sur les boutons
document.addEventListener('pointermove', e => { const b = e.target.closest && e.target.closest('.btn'); if (!b) return; const r = b.getBoundingClientRect(); b.style.setProperty('--x', ((e.clientX - r.left) / r.width * 100) + '%'); b.style.setProperty('--y', ((e.clientY - r.top) / r.height * 100) + '%'); }, { passive:true });
// Bip discret (nouvelle réservation)
function uiPing() { try { const c = new (window.AudioContext || window.webkitAudioContext)(); const o = c.createOscillator(), g = c.createGain(); o.connect(g); g.connect(c.destination); o.frequency.value = 880; g.gain.setValueAtTime(.08, c.currentTime); g.gain.exponentialRampToValueAtTime(.0001, c.currentTime + .4); o.start(); o.stop(c.currentTime + .4); } catch (e) {} }
// Confettis (fin de partie enregistrée)
function uiConfetti() {
  const cv = document.createElement('canvas'); cv.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:999'; document.body.appendChild(cv);
  const ctx = cv.getContext('2d'); cv.width = innerWidth; cv.height = innerHeight;
  const cols = ['#7c6af7','#22d3ee','#facc15','#4ade80','#e85d75'];
  const ps = Array.from({ length: 120 }, () => ({ x: innerWidth / 2, y: innerHeight / 3, vx: (Math.random() - .5) * 14, vy: -Math.random() * 12 - 4, r: Math.random() * 6 + 3, c: cols[Math.random() * cols.length | 0], a: Math.random() * 6 }));
  let f = 0; (function loop() { ctx.clearRect(0, 0, cv.width, cv.height); ps.forEach(p => { p.vy += .35; p.x += p.vx; p.y += p.vy; p.a += .1; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.fillStyle = p.c; ctx.fillRect(-p.r / 2, -p.r / 2, p.r, p.r * .6); ctx.restore(); }); if (++f < 90) requestAnimationFrame(loop); else cv.remove(); })();
}
// Compteur de demandes en attente dans la nav (toutes les pages)
(async function () {
  try {
    if (typeof sb === 'undefined') return;
    const badge = document.getElementById('nav-res-count'); if (!badge) return;
    const upd = async () => { const { count } = await sb.from('reservation_requests').select('id', { count:'exact', head:true }).eq('status', 'pending'); badge.textContent = count || 0; badge.classList.toggle('hidden', !count); };
    setTimeout(upd, 800);
    sb.channel('nav-resreq').on('postgres_changes', { event:'*', schema:'public', table:'reservation_requests' }, upd).subscribe();
  } catch (e) {}
})();
