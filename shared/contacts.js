// ============================================================
// Enigma — module Contacts (contacts.html, administrateurs)
// Abonnés (comptes joueurs du site) + clients ayant réservé en ligne,
// envoi d'e-mails (fonction send-contact-email, via Resend) et de
// messages WhatsApp (liens wa.me pré-remplis), suivi du parrainage.
// ============================================================
(function () {
  'use strict';

  // ── Fonctions pures (testées) ──────────────────────────────
  // Numéro ivoirien → format international sans « + » (pour wa.me).
  function normalizePhone(raw) {
    let d = String(raw || '').replace(/\D/g, '');
    if (!d) return '';
    if (d.startsWith('00')) d = d.slice(2);
    if (d.length === 10) return '225' + d;            // 07 01 02 03 04
    if (d.length === 13 && d.startsWith('225')) return d;
    if (d.length >= 11 && d.length <= 15) return d;   // autre pays déjà en international
    return '';
  }
  const firstName = name => (String(name || '').trim().split(/\s+/)[0] || '');
  function personalize(text, name) {
    return String(text || '')
      .replace(/\{nom\}/gi, String(name || '').trim() || 'cher joueur')
      .replace(/\{prenom\}/gi, firstName(name) || 'cher joueur');
  }
  function waLink(phone, text) {
    const n = normalizePhone(phone);
    return n ? `https://wa.me/${n}?text=${encodeURIComponent(text)}` : '';
  }
  const DAY = 86400000;
  function matchContact(c, f, today) {
    if (f.src === 'sub' && !c.is_subscriber) return false;
    if (f.src === 'resa' && !c.reservations) return false;
    if (f.src === 'both' && !(c.is_subscriber && c.reservations)) return false;
    if (f.src === 'resa_only' && (c.is_subscriber || !c.reservations)) return false;
    if (f.chan === 'email' && !c.email) return false;
    if (f.chan === 'phone' && !normalizePhone(c.phone)) return false;
    if (f.opt === 'hide' && c.opted_out) return false;
    if (f.opt === 'only' && !c.opted_out) return false;
    if (f.resa === 'ok' && !c.reservations_confirmed) return false;
    if (f.resa === 'none' && c.reservations_confirmed) return false;
    const ago = c.last_reservation ? (today - new Date(c.last_reservation + 'T12:00:00')) / DAY : null;
    if (f.resa === 'recent' && !(ago != null && ago <= 90)) return false;
    if (f.resa === 'old' && !(ago == null || ago > 90)) return false;
    if (f.ref === 'parrain' && !(c.filleuls_valides || c.filleuls_en_attente)) return false;
    if (f.ref === 'filleul' && !c.parrain_name) return false;
    if (f.q) {
      const hay = [c.name, c.email, c.phone, c.player_code, String(c.phone || '').replace(/\D/g, '')].join(' ').toLowerCase();
      if (!f.q.split(/\s+/).every(w => hay.includes(w))) return false;
    }
    return true;
  }
  const lib = { normalizePhone, personalize, waLink, matchContact, firstName };
  if (typeof window !== 'undefined') window.ContactsLib = lib;
  if (typeof module !== 'undefined') module.exports = lib;
  if (typeof document === 'undefined') return;

  // ── État ───────────────────────────────────────────────────
  const CT = { contacts: [], selected: new Set(), limit: 300, wa: null, settings: null, messages: [] };
  window._CT = CT;
  const $ = id => document.getElementById(id);

  async function ctInit() {
    await ctLoad();
  }

  async function ctLoad() {
    const { data, error } = await sb.rpc('admin_list_contacts');
    if (error) {
      $('ct-body').innerHTML = `<tr><td colspan="8" style="color:var(--red);padding:20px;">Erreur : ${escHtml(error.message)}${/admin_list_contacts/.test(error.message) ? ' — la migration du module Contacts n\'est pas encore appliquée.' : ''}</td></tr>`;
      return;
    }
    CT.contacts = (data || []).sort((a, b) => String(b.last_reservation || b.subscribed_at || '').localeCompare(String(a.last_reservation || a.subscribed_at || '')));
    renderKpis();
    ctRender();
  }

  function renderKpis() {
    const c = CT.contacts;
    const k = [
      [c.length, 'Contacts'],
      [c.filter(x => x.is_subscriber).length, 'Abonnés'],
      [c.filter(x => x.reservations).length, 'Ont réservé sur le site'],
      [c.filter(x => x.email && !x.opted_out).length, 'Joignables par e-mail'],
      [c.filter(x => normalizePhone(x.phone)).length, 'Joignables WhatsApp'],
      [c.filter(x => x.opted_out).length, 'Désinscrits'],
    ];
    $('ct-kpis').innerHTML = k.map(([v, l]) => `<div class="ct-kpi"><b>${v}</b><span>${l}</span></div>`).join('');
  }

  function readFilters() {
    return {
      q: $('f-q').value.trim().toLowerCase(), src: $('f-src').value, chan: $('f-chan').value,
      resa: $('f-resa').value, ref: $('f-ref').value, opt: $('f-opt').value,
    };
  }
  const filtered = () => { const f = readFilters(), t = new Date(); return CT.contacts.filter(c => matchContact(c, f, t)); };

  let soon = null;
  function ctRenderSoon() { clearTimeout(soon); soon = setTimeout(ctRender, 200); }

  function ctRender() {
    const rows = filtered();
    const shown = rows.slice(0, CT.limit);
    $('ct-body').innerHTML = shown.map(c => {
      const key = escHtml(c.contact_key);
      const origin = [c.is_subscriber ? `<span class="badge badge-purple">Abonné${c.player_code ? ' · ' + escHtml(c.player_code) : ''}</span>` : '',
        c.reservations ? '<span class="badge badge-cyan">Réservation site</span>' : ''].join(' ');
      const ref = [c.filleuls_valides || c.filleuls_en_attente ? `🏅 ${c.filleuls_valides} filleul(s)${c.filleuls_en_attente ? ` + ${c.filleuls_en_attente} en attente` : ''}` : '',
        c.parrain_name ? `<div class="ct-sub">Filleul de ${escHtml(c.parrain_name)}</div>` : ''].join('');
      return `<tr class="${c.opted_out ? 'ct-optout' : ''}">
        <td><input type="checkbox" data-k="${key}" ${CT.selected.has(c.contact_key) ? 'checked' : ''} onchange="ctToggle(this.dataset.k, this.checked)"></td>
        <td><strong>${escHtml(c.name || '—')}</strong>${c.subscribed_at ? `<div class="ct-sub">Inscrit le ${formatDate(c.subscribed_at)}</div>` : ''}</td>
        <td>${c.email ? escHtml(c.email) : '<span class="text-muted">—</span>'}${c.opted_out ? '<div class="ct-sub" style="color:var(--red);">Désinscrit des e-mails</div>' : ''}</td>
        <td>${c.phone ? escHtml(c.phone) : '<span class="text-muted">—</span>'}</td>
        <td>${origin}</td>
        <td style="text-align:right;">${c.reservations || ''}${c.reservations ? `<div class="ct-sub">${c.reservations_confirmed} confirmée(s)</div>` : ''}</td>
        <td>${c.last_reservation ? formatDate(c.last_reservation) : ''}</td>
        <td style="font-size:12px;">${ref}</td></tr>`;
    }).join('') || '<tr><td colspan="8" class="text-muted" style="padding:20px;text-align:center;">Aucun contact ne correspond aux filtres.</td></tr>';
    $('ct-more').innerHTML = rows.length > shown.length
      ? `${shown.length} affichés sur ${rows.length} — <a href="#" onclick="_CT.limit+=1000;ctRender();return false;">afficher plus</a>`
      : `${rows.length} contact(s)`;
    updateSel();
  }

  function updateSel() {
    const sel = CT.contacts.filter(c => CT.selected.has(c.contact_key));
    const em = sel.filter(c => c.email && !c.opted_out).length, wa = sel.filter(c => normalizePhone(c.phone)).length;
    $('ct-selinfo').textContent = sel.length ? `${sel.length} sélectionné(s) · ${em} par e-mail · ${wa} par WhatsApp` : 'Aucune sélection : les envois portent sur la liste filtrée.';
  }

  function ctToggle(key, on) { if (on) CT.selected.add(key); else CT.selected.delete(key); updateSel(); }
  function ctSelectAll(on) {
    if (on) filtered().forEach(c => CT.selected.add(c.contact_key)); else CT.selected.clear();
    $('ct-all').checked = !!on; ctRender();
  }
  // Destinataires : la sélection, sinon toute la liste filtrée.
  function targets() {
    const sel = CT.contacts.filter(c => CT.selected.has(c.contact_key));
    return sel.length ? sel : filtered();
  }

  function ctExport() {
    const rows = filtered();
    const head = ['Nom', 'E-mail', 'Téléphone', 'Abonné', 'Code joueur', 'Inscrit le', 'Réservations', 'Confirmées', 'Dernière réservation', 'Filleuls validés', 'Parrain', 'Désinscrit'];
    const esc = v => { const s = String(v ?? ''); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const lines = [head, ...rows.map(c => [c.name, c.email, c.phone, c.is_subscriber ? 'oui' : 'non', c.player_code, c.subscribed_at ? formatDate(c.subscribed_at) : '',
      c.reservations, c.reservations_confirmed, c.last_reservation ? formatDate(c.last_reservation) : '', c.filleuls_valides, c.parrain_name, c.opted_out ? 'oui' : ''])];
    const blob = new Blob(['﻿' + lines.map(l => l.map(esc).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `contacts-enigma_${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ── E-mail ─────────────────────────────────────────────────
  function open(id) { $('ct-backdrop').classList.add('open'); $(id).classList.add('open'); }
  function ctClose() { ['ct-backdrop', 'ct-email', 'ct-wa'].forEach(id => $(id).classList.remove('open')); }

  function emailTargets() {
    const t = targets();
    return { ok: t.filter(c => c.email && !c.opted_out), noEmail: t.filter(c => !c.email).length, out: t.filter(c => c.email && c.opted_out).length };
  }
  function ctOpenEmail() {
    const { ok, noEmail, out } = emailTargets();
    if (!ok.length) return toast('Aucun destinataire joignable par e-mail', 'err');
    $('em-info').innerHTML = `<strong>${ok.length}</strong> destinataire(s)${noEmail ? ` · ${noEmail} sans e-mail ignoré(s)` : ''}${out ? ` · ${out} désinscrit(s) ignoré(s)` : ''}.
      ${CT.selected.size ? '' : '<br>Aucune sélection : envoi à toute la liste filtrée.'}`;
    open('ct-email'); ctEmailPreview();
  }
  function ctEmailPreview() {
    const { ok } = emailTargets();
    const c = ok[0] || { name: 'Aïcha Koné' };
    const body = escHtml(personalize($('em-message').value, c.name)).replace(/https?:\/\/[^\s<]+/g, u => `<a href="${u}">${u}</a>`).replace(/\n/g, '<br>');
    $('em-preview').innerHTML = `<h3>${escHtml(personalize($('em-subject').value, c.name)) || '<span style="color:#aaa">Objet</span>'}</h3>${body || '<span style="color:#aaa">Message…</span>'}
      <p style="color:#aaa;font-size:11px;margin-top:14px;">Enigma Escape Game — Abidjan · Se désinscrire</p>`;
  }
  async function ctSendEmail() {
    const subject = $('em-subject').value.trim(), message = $('em-message').value.trim();
    if (!subject || !message) return toast('Objet et message requis', 'err');
    const { ok } = emailTargets();
    if (!confirm(`Envoyer cet e-mail à ${ok.length} destinataire(s) ?`)) return;
    const btn = $('em-send'); btn.disabled = true; btn.textContent = 'Envoi en cours…';
    try {
      const { data, error } = await sb.functions.invoke('send-contact-email', {
        body: { subject, message, recipients: ok.map(c => ({ email: c.email, name: c.name })) },
      });
      if (error) throw error;
      if (data?.error) throw new Error(typeof data.error === 'string' ? data.error : JSON.stringify(data.error));
      toast(`E-mail envoyé : ${data.sent} envoyé(s)${data.failed ? `, ${data.failed} échec(s)` : ''}${data.skipped ? `, ${data.skipped} ignoré(s)` : ''}`, data.failed ? 'err' : 'ok');
      ctClose(); $('em-subject').value = ''; $('em-message').value = '';
      CT.messages = null;
    } catch (e) {
      toast('Échec de l\'envoi : ' + (e.message || e), 'err');
    } finally { btn.disabled = false; btn.textContent = 'Envoyer'; }
  }

  // ── WhatsApp ───────────────────────────────────────────────
  function ctOpenWhatsapp() {
    const list = targets().filter(c => normalizePhone(c.phone));
    if (!list.length) return toast('Aucun destinataire avec un numéro de téléphone valide', 'err');
    CT.wa = { list, done: new Set(), messageId: null, text: null };
    renderWa(); open('ct-wa');
  }
  function renderWa() {
    const w = CT.wa;
    $('wa-info').textContent = `${w.done.size} / ${w.list.length} contact(s) ouvert(s).`;
    $('wa-list').innerHTML = w.list.map((c, i) => `<div class="ct-wa-item ${w.done.has(i) ? 'done' : ''}">
      <span><strong>${escHtml(c.name || '—')}</strong><div class="ct-sub">${escHtml(c.phone)}</div></span>
      <button class="btn btn-ghost btn-sm" onclick="ctWaOpen(${i})">${w.done.has(i) ? '✓ Rouvrir' : 'Ouvrir'}</button></div>`).join('');
  }
  async function ctWaOpen(i) {
    const w = CT.wa, text = $('wa-message').value.trim();
    if (!text) return toast('Rédigez le message d\'abord', 'err');
    const c = w.list[i];
    const link = waLink(c.phone, personalize(text, c.name));
    window.open(link, '_blank', 'noopener');
    const first = !w.done.has(i);
    w.done.add(i); renderWa();
    if (!first) return;
    try {
      if (!w.messageId || w.text !== text) {
        const { data, error } = await sb.from('contact_messages').insert([{ channel: 'whatsapp', body: text, recipients_count: w.list.length, sent_by: currentUser?.email || null }]).select('id').single();
        if (error) throw error;
        w.messageId = data.id; w.text = text;
      }
      await sb.from('contact_message_recipients').insert([{ message_id: w.messageId, name: c.name, phone: c.phone, email: c.email, status: 'sent' }]);
      await sb.from('contact_messages').update({ sent_count: w.done.size }).eq('id', w.messageId);
      CT.messages = null;
    } catch (e) { console.warn('Journal WhatsApp', e); }
  }
  function ctWaNext() {
    const w = CT.wa; const i = w.list.findIndex((_, k) => !w.done.has(k));
    if (i < 0) return toast('Tous les contacts ont été ouverts', 'ok');
    ctWaOpen(i);
  }

  // ── Historique des messages ────────────────────────────────
  async function loadMessages() {
    const { data, error } = await sb.from('contact_messages').select('*').order('created_at', { ascending: false }).limit(200);
    if (error) { $('msg-body').innerHTML = `<tr><td colspan="8" style="color:var(--red);">${escHtml(error.message)}</td></tr>`; return; }
    CT.messages = data || [];
    $('msg-body').innerHTML = CT.messages.map(m => `<tr style="cursor:pointer;" onclick="ctMsgDetail('${m.id}')">
      <td>${new Date(m.created_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</td>
      <td>${m.channel === 'email' ? '✉️ E-mail' : '💬 WhatsApp'}</td>
      <td><strong>${escHtml(m.subject || '')}</strong><div class="ct-sub">${escHtml(String(m.body).slice(0, 120))}${m.body.length > 120 ? '…' : ''}</div></td>
      <td style="text-align:right;">${m.recipients_count}</td><td style="text-align:right;color:var(--green);">${m.sent_count}</td>
      <td style="text-align:right;color:${m.failed_count ? 'var(--red)' : 'inherit'};">${m.failed_count || ''}</td>
      <td style="text-align:right;">${m.skipped_count || ''}</td><td class="ct-sub">${escHtml(m.sent_by || '')}</td></tr>`).join('')
      || '<tr><td colspan="8" class="text-muted" style="padding:20px;text-align:center;">Aucun message envoyé pour l\'instant.</td></tr>';
  }
  async function ctMsgDetail(id) {
    const m = CT.messages.find(x => x.id === id);
    const { data } = await sb.from('contact_message_recipients').select('*').eq('message_id', id).order('created_at');
    const el = $('msg-detail'); el.classList.remove('hidden');
    const st = { sent: '<span class="badge badge-green">envoyé</span>', failed: '<span class="badge badge-red">échec</span>', skipped: '<span class="badge badge-muted">ignoré</span>' };
    el.innerHTML = `<div class="card-title">${escHtml(m.subject || (m.channel === 'whatsapp' ? 'Message WhatsApp' : ''))}</div>
      <div style="white-space:pre-wrap;font-size:13px;margin:8px 0 12px;">${escHtml(m.body)}</div>
      <div class="table-wrap"><table class="ct-table"><thead><tr><th>Destinataire</th><th>E-mail / téléphone</th><th>Statut</th><th>Détail</th></tr></thead><tbody>
      ${(data || []).map(r => `<tr><td>${escHtml(r.name || '')}</td><td>${escHtml(r.email || r.phone || '')}</td><td>${st[r.status] || r.status}</td><td class="ct-sub">${escHtml(r.error || '')}</td></tr>`).join('')}
      </tbody></table></div>`;
    el.scrollIntoView({ behavior: 'smooth' });
  }

  // ── Parrainage ─────────────────────────────────────────────
  const DEFAULTS = { enabled: true, points_par_filleul: 1, seuil_points: 5, coupon_montant_xof: 15000, coupon_validite_jours: 90, validation: 'premiere_partie' };
  async function loadParrainage() {
    const [{ data: st }, { data: refs, error: e1 }, { data: rewards }, { data: players }] = await Promise.all([
      sb.from('site_settings').select('value').eq('key', 'parrainage').maybeSingle(),
      sb.from('referrals').select('*').order('created_at', { ascending: false }),
      sb.from('referral_rewards').select('*, vouchers(code, remaining_amount_xof, valid_until, is_active)').order('created_at', { ascending: false }),
      sb.from('players').select('id, display_name, player_code'),
    ]);
    if (e1) { $('p-parrains').innerHTML = `<tr><td colspan="6" style="color:var(--red);">${escHtml(e1.message)} — migration non appliquée ?</td></tr>`; return; }
    const s = CT.settings = { ...DEFAULTS, ...(st?.value || {}) };
    $('p-enabled').checked = !!s.enabled; $('p-validation').value = s.validation; $('p-points').value = s.points_par_filleul;
    $('p-seuil').value = s.seuil_points; $('p-montant').value = s.coupon_montant_xof; $('p-validite').value = s.coupon_validite_jours;
    const nFilleuls = Math.ceil(s.seuil_points / Math.max(1, s.points_par_filleul));
    $('p-summary').textContent = `Actuellement : ${nFilleuls} filleul(s) validé(s) = un coupon de ${fmt(s.coupon_montant_xof)}${s.coupon_validite_jours ? `, valable ${s.coupon_validite_jours} jours` : ''}.`;
    const P = Object.fromEntries((players || []).map(p => [p.id, p]));
    const by = {};
    (refs || []).forEach(r => { const b = by[r.referrer_id] = by[r.referrer_id] || { ok: 0, wait: 0, pts: 0, used: 0, coupons: [] }; if (r.status === 'validated') { b.ok++; b.pts += r.points; } if (r.status === 'pending') b.wait++; });
    (rewards || []).forEach(w => { const b = by[w.referrer_id] = by[w.referrer_id] || { ok: 0, wait: 0, pts: 0, used: 0, coupons: [] }; b.used += w.points_used; b.coupons.push(w); });
    const kp = [
      [(refs || []).length, 'Filleuls inscrits'], [(refs || []).filter(r => r.status === 'validated').length, 'Filleuls validés'],
      [(refs || []).filter(r => r.status === 'pending').length, 'En attente'], [(rewards || []).length, 'Coupons gagnés'],
      [fmt((rewards || []).reduce((a, w) => a + w.amount_xof, 0)), 'Valeur des coupons'],
    ];
    $('p-kpis').innerHTML = kp.map(([v, l]) => `<div class="ct-kpi"><b>${v}</b><span>${l}</span></div>`).join('');
    const rows = Object.entries(by).sort((a, b) => b[1].ok - a[1].ok);
    $('p-parrains').innerHTML = rows.map(([id, b]) => `<tr><td><strong>${escHtml(P[id]?.display_name || '—')}</strong></td><td style="font-family:var(--mono);">${escHtml(P[id]?.player_code || '')}</td>
      <td style="text-align:right;">${b.ok}</td><td style="text-align:right;">${b.wait || ''}</td><td style="text-align:right;">${b.pts - b.used} / ${s.seuil_points}</td>
      <td>${b.coupons.map(w => `<span class="badge ${w.vouchers?.is_active ? 'badge-green' : 'badge-muted'}" title="${w.vouchers?.valid_until ? 'jusqu\'au ' + formatDate(w.vouchers.valid_until) : ''}">${escHtml(w.vouchers?.code || 'supprimé')} · ${fmt(w.amount_xof)}</span>`).join(' ')}</td></tr>`).join('')
      || '<tr><td colspan="6" class="text-muted" style="padding:16px;text-align:center;">Aucun parrainage pour l\'instant.</td></tr>';
    const stl = { pending: '<span class="badge badge-yellow">en attente</span>', validated: '<span class="badge badge-green">validé</span>', rejected: '<span class="badge badge-red">refusé</span>' };
    $('p-filleuls').innerHTML = (refs || []).map(r => `<tr><td>${formatDate(r.created_at)}</td><td>${escHtml(P[r.referee_id]?.display_name || '—')}</td>
      <td>${escHtml(P[r.referrer_id]?.display_name || '—')}</td><td>${stl[r.status] || r.status}${r.note ? `<div class="ct-sub">${escHtml(r.note)}</div>` : ''}</td>
      <td style="text-align:right;">${r.points || ''}</td>
      <td>${r.status === 'pending' ? `<button class="btn btn-ghost btn-sm" onclick="ctRefSet('${r.id}','validated')">Valider</button> <button class="btn btn-ghost btn-sm" onclick="ctRefSet('${r.id}','rejected')">Refuser</button>` : ''}</td></tr>`).join('')
      || '<tr><td colspan="6" class="text-muted" style="padding:16px;text-align:center;">Aucun filleul.</td></tr>';
  }
  async function ctRefSet(id, status) {
    const note = status === 'rejected' ? (prompt('Motif du refus (facultatif) :') ?? null) : null;
    const { error } = await sb.rpc('admin_referral_set_status', { p_id: id, p_status: status, p_note: note });
    if (error) return toast('Erreur : ' + error.message, 'err');
    toast(status === 'validated' ? 'Filleul validé' : 'Parrainage refusé', 'ok');
    loadParrainage(); ctLoad();
  }
  async function ctSaveSettings() {
    const int = (id, min) => Math.max(min, parseInt($(id).value, 10) || 0);
    const value = {
      enabled: $('p-enabled').checked, validation: $('p-validation').value,
      points_par_filleul: int('p-points', 1), seuil_points: int('p-seuil', 1),
      coupon_montant_xof: int('p-montant', 0), coupon_validite_jours: int('p-validite', 0),
    };
    const { error } = await sb.from('site_settings').upsert({ key: 'parrainage', value, updated_at: new Date().toISOString(), updated_by: currentUser?.display_name || currentUser?.email });
    if (error) return toast('Erreur : ' + error.message, 'err');
    toast('Règles du parrainage enregistrées', 'ok');
    loadParrainage();
  }

  function ctTab(name) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + name));
    if (name === 'messages') loadMessages();
    if (name === 'parrainage') loadParrainage();
  }

  Object.assign(window, {
    ctInit, ctLoad, ctRender, ctRenderSoon, ctToggle, ctSelectAll, ctExport, ctTab, ctClose,
    ctOpenEmail, ctEmailPreview, ctSendEmail, ctOpenWhatsapp, ctWaOpen, ctWaNext, ctMsgDetail,
    ctRefSet, ctSaveSettings,
  });
})();
