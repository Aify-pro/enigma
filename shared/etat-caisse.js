// ============================================================
// Enigma — Onglet « État de caisse » (admin.html)
// Journal unique de trésorerie : caisse, Mobile Money, banque.
// Le calcul des écritures est dans shared/tresorerie.js.
// Dépend des aides de admin.html : sb, currentUser, fmt, escHtml,
// formatDate, toast, ENIGMA_CONFIG.
// ============================================================
(function () {
  'use strict';
  const T = window.Tresorerie;
  const A = T.ACCOUNTS;

  const EC = {
    loaded: false,
    entries: [],
    regulations: [],
    controls: [],
    points: new Map(),          // entry_key → ligne de pointage
    hasAccounts: true,          // colonnes account/counter_account présentes (migration appliquée)
    hasPointage: true,
    hasControls: true,
    accounts: new Set(T.ACCOUNT_KEYS),
    natures: new Set(Object.keys(T.NATURES)),
    editingRegId: null,
    limit: 500,
  };
  window._EC = EC;

  const $ = id => document.getElementById(id);
  const todayStr = () => toISO(new Date());
  function toISO(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
  function addDays(iso, k) { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + k); return toISO(d); }
  const money = v => fmt(v);
  const signedMoney = v => (v > 0 ? '+' : v < 0 ? '−' : '') + fmt(Math.abs(v));
  const colorOf = v => (v >= 0 ? 'var(--green)' : 'var(--red)');
  const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  const monthLabel = ym => { const [y, m] = ym.split('-'); return `${MONTHS[+m - 1]} ${y}`; };

  // ── Chargement ─────────────────────────────────────────────
  async function fetchAll(table, select, order) {
    const page = 1000; let from = 0; const rows = [];
    for (;;) {
      let q = sb.from(table).select(select).range(from, from + page - 1);
      if (order) q = q.order(order, { ascending: true });
      const { data, error } = await q;
      if (error) throw error;
      rows.push(...(data || []));
      if (!data || data.length < page) break;
      from += page;
    }
    return rows;
  }

  async function ecLoad() {
    $('ec-body').innerHTML = '<tr><td class="text-muted" style="text-align:center;padding:20px;">Chargement…</td></tr>';
    try {
      const [tickets, advances, expenses, bankTx, regulations] = await Promise.all([
        fetchAll('tickets', 'id,ticket_number,ticket_type,room_name,time_slot,session_date,num_players,client_name,team_name,status,operator_name,created_at,payment_especes_xof,payment_mobile_xof,payment_cheque_xof,payment_virement_xof', 'session_date'),
        fetchAll('advances', '*', 'date'),
        fetchAll('expenses', '*', 'date'),
        fetchAll('bank_transactions', '*', 'date'),
        fetchAll('caisse_regulations', '*', 'date'),
      ]);
      EC.regulations = regulations;
      EC.hasAccounts = regulations.length === 0 ? await probeColumn('caisse_regulations', 'account') : ('account' in regulations[0]);
      EC.entries = T.buildLedger({ tickets, advances, expenses, bankTx, regulations, expenseCategories: ENIGMA_CONFIG.expenseCategories });
    } catch (err) {
      $('ec-body').innerHTML = `<tr><td style="color:var(--red);padding:20px;">Erreur de chargement : ${escHtml(err.message || err)}</td></tr>`;
      return;
    }
    await Promise.all([loadPoints(), loadControls()]);
    EC.loaded = true;
    buildFilterOptions();
    renderNotice();
    ecRender();
  }

  async function probeColumn(table, col) {
    const { error } = await sb.from(table).select(col).limit(1);
    return !error;
  }

  async function loadPoints() {
    const { data, error } = await sb.from('tresorerie_pointages').select('*').range(0, 49999);
    EC.hasPointage = !error;
    EC.points = new Map((data || []).map(p => [p.entry_key, p]));
  }

  async function loadControls() {
    const { data, error } = await sb.from('tresorerie_controles').select('*').order('date', { ascending: false }).order('created_at', { ascending: false });
    EC.hasControls = !error;
    EC.controls = data || [];
  }

  function renderNotice() {
    const missing = [];
    if (!EC.hasAccounts) missing.push('transferts entre comptes');
    if (!EC.hasPointage) missing.push('pointage des lignes');
    if (!EC.hasControls) missing.push('historique des contrôles');
    const el = $('ec-notice');
    if (!missing.length) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    el.innerHTML = `ℹ️ La mise à jour de la base (migration <code>20261102000000_etat_de_caisse_tresorerie</code>) n'est pas encore appliquée :
      ${missing.join(', ')} indisponible(s). La consultation de l'état de caisse fonctionne déjà.`;
  }

  // ── Initialisation de l'onglet ─────────────────────────────
  function initEtatCaisse() {
    if (!$('ec-asof').value) $('ec-asof').value = todayStr();
    if (!$('ec-from').value) applyPreset('month', false);
    if (!$('ec-accounts').children.length) buildToggles();
    if (!EC.loaded) ecLoad(); else ecRender();
  }

  function buildToggles() {
    $('ec-accounts').innerHTML = T.ACCOUNT_KEYS.map(k =>
      `<label class="ec-toggle on" data-acc="${k}"><input type="checkbox" checked onchange="ecToggle(this,'acc','${k}')"> ${A[k].icon} ${A[k].short}</label>`).join('');
    $('ec-natures').innerHTML = Object.entries(T.NATURES).map(([k, v]) =>
      `<label class="ec-toggle on" data-nat="${k}"><input type="checkbox" checked onchange="ecToggle(this,'nat','${k}')"> ${v.icon} ${v.label}</label>`).join('');
    $('ec-presets').addEventListener('click', ev => {
      const b = ev.target.closest('[data-preset]'); if (!b) return;
      applyPreset(b.dataset.preset, true);
    });
  }

  function ecToggle(input, kind, key) {
    const set = kind === 'acc' ? EC.accounts : EC.natures;
    if (input.checked) set.add(key); else set.delete(key);
    input.parentElement.classList.toggle('on', input.checked);
    ecRender();
  }

  function applyPreset(p, render) {
    const t = todayStr(); const [y, m] = t.split('-').map(Number);
    let from, to = t;
    if (p === 'today') from = t;
    else if (p === '7d') from = addDays(t, -6);
    else if (p === 'month') from = `${y}-${String(m).padStart(2, '0')}-01`;
    else if (p === 'prevmonth') { const d = new Date(y, m - 2, 1); from = toISO(d); to = toISO(new Date(y, m - 1, 0)); }
    else if (p === 'year') from = `${y}-01-01`;
    else if (p === 'all') { from = EC.entries.length ? EC.entries[0].date : `${y}-01-01`; }
    $('ec-from').value = from; $('ec-to').value = to;
    document.querySelectorAll('#ec-presets .chip').forEach(c => c.classList.toggle('active', c.dataset.preset === p));
    if (render) ecRender();
  }

  function buildFilterOptions() {
    const cats = new Map(), ops = new Set();
    EC.entries.forEach(e => {
      const k = e.nature + '|' + e.category;
      if (!cats.has(k)) cats.set(k, { nature: e.nature, category: e.category, label: e.categoryLabel || e.category });
      if (e.operator) ops.add(e.operator);
    });
    const byNat = {};
    [...cats.values()].forEach(c => (byNat[c.nature] = byNat[c.nature] || []).push(c));
    const keepCat = $('ec-cat').value, keepOp = $('ec-op').value;
    $('ec-cat').innerHTML = '<option value="">Toutes</option>' + Object.entries(byNat).map(([nat, list]) =>
      `<optgroup label="${escHtml(T.NATURES[nat]?.label || nat)}">${list.sort((a, b) => String(a.label).localeCompare(String(b.label)))
        .map(c => `<option value="${escHtml(c.nature + '|' + c.category)}">${escHtml(c.label)}</option>`).join('')}</optgroup>`).join('');
    $('ec-op').innerHTML = '<option value="">Tous</option>' + [...ops].sort().map(o => `<option>${escHtml(o)}</option>`).join('');
    $('ec-cat').value = keepCat; $('ec-op').value = keepOp;
  }

  function ecResetFilters() {
    ['ec-dir', 'ec-cat', 'ec-op', 'ec-status', 'ec-point', 'ec-min', 'ec-max', 'ec-q'].forEach(id => ($(id).value = ''));
    $('ec-hide-transfers').checked = false;
    $('ec-group').value = 'detail';
    EC.accounts = new Set(T.ACCOUNT_KEYS); EC.natures = new Set(Object.keys(T.NATURES));
    document.querySelectorAll('#ec-accounts input, #ec-natures input').forEach(i => { i.checked = true; i.parentElement.classList.add('on'); });
    applyPreset('month', true);
  }

  // ── Filtrage ───────────────────────────────────────────────
  function readFilters() {
    const from = $('ec-from').value || '0000-01-01';
    const to = $('ec-to').value || '9999-12-31';
    const [natCat, cat] = ($('ec-cat').value || '|').split('|');
    return {
      from, to,
      dir: $('ec-dir').value, nat: natCat, cat: $('ec-cat').value ? cat : '',
      op: $('ec-op').value, status: $('ec-status').value, point: $('ec-point').value,
      min: $('ec-min').value === '' ? null : Number($('ec-min').value),
      max: $('ec-max').value === '' ? null : Number($('ec-max').value),
      q: $('ec-q').value.trim().toLowerCase(),
      hideTransfers: $('ec-hide-transfers').checked,
      group: $('ec-group').value,
    };
  }

  // Filtres « secondaires » : ils retirent des lignes d'un compte, donc le
  // solde progressif n'a plus de sens → on affiche un cumul filtré.
  function hasSecondary(f) {
    return !!(f.dir || f.cat || f.op || f.status || f.point || f.min != null || f.max != null || f.q || f.hideTransfers
      || EC.natures.size !== Object.keys(T.NATURES).length);
  }

  function matches(e, f) {
    if (!EC.accounts.has(e.account)) return false;
    if (e.date < f.from || e.date > f.to) return false;
    if (!EC.natures.has(e.nature)) return false;
    if (f.dir && e.dir !== f.dir) return false;
    if (f.cat && (e.nature !== f.nat || e.category !== f.cat)) return false;
    if (f.op && e.operator !== f.op) return false;
    if (f.status === 'validated' && e.status !== 'validated') return false;
    if (f.status === 'pending' && e.status !== 'pending') return false;
    if (f.point === 'yes' && !EC.points.has(e.key)) return false;
    if (f.point === 'no' && EC.points.has(e.key)) return false;
    if (f.min != null && e.amount < f.min) return false;
    if (f.max != null && e.amount > f.max) return false;
    if (f.hideTransfers && e.nature === 'transfert' && e.counterAccount && EC.accounts.has(e.counterAccount)) return false;
    if (f.q) {
      const hay = `${e.label} ${e.detail} ${e.ref} ${e.operator} ${e.categoryLabel} ${e.warning || ''}`.toLowerCase();
      if (!hay.includes(f.q)) return false;
    }
    return true;
  }

  function sumSelected(bal) { return [...EC.accounts].reduce((s, k) => s + bal[k], 0); }

  // ── Rendu ──────────────────────────────────────────────────
  let soonTimer = null;
  function ecRenderSoon() { clearTimeout(soonTimer); soonTimer = setTimeout(ecRender, 250); }

  function ecRender() {
    if (!EC.loaded) return;
    const f = readFilters();
    renderKpis();
    const rows = EC.entries.filter(e => matches(e, f));
    const secondary = hasSecondary(f);
    const opening = secondary ? 0 : sumSelected(T.balancesAt(EC.entries, addDays(f.from, -1)));
    renderSummary(rows, f, secondary, opening);
    if (f.group === 'detail') renderDetail(rows, secondary, opening);
    else renderGrouped(rows, f.group, secondary, opening);
    renderChecks();
    renderControls();
  }

  function renderKpis() {
    const asof = $('ec-asof').value || todayStr();
    const b = T.balancesAt(EC.entries, asof);
    const prev = T.balancesAt(EC.entries, addDays(asof, -1));
    const card = (label, icon, v, pv, color, big) => `
      <div class="ec-kpi${big ? ' ec-kpi-total' : ''}" style="border-top-color:${color};">
        <div class="kpi-label">${icon} ${label}</div>
        <div class="ec-kpi-value" style="color:${v < 0 ? 'var(--red)' : big ? 'var(--text)' : color};">${money(v)}</div>
        <div class="ec-kpi-sub">Au ${formatDate(asof)} au soir${v !== pv ? ` · ${signedMoney(v - pv)} dans la journée` : ''}</div>
      </div>`;
    $('ec-kpis').innerHTML =
      T.ACCOUNT_KEYS.map(k => card(A[k].label, A[k].icon, b[k], prev[k], A[k].color)).join('') +
      card('Trésorerie totale', '🧮', b.total, prev.total, 'var(--purple)', true);
  }

  function renderSummary(rows, f, secondary, opening) {
    const ins = rows.filter(e => e.dir === 'in').reduce((s, e) => s + e.amount, 0);
    const outs = rows.filter(e => e.dir === 'out').reduce((s, e) => s + e.amount, 0);
    const accs = [...EC.accounts].map(k => A[k].short).join(' + ') || 'aucun compte';
    const period = `${formatDate(f.from === '0000-01-01' ? EC.entries[0]?.date : f.from)} → ${formatDate(f.to === '9999-12-31' ? todayStr() : f.to)}`;
    const box = (label, v, color, sub) => `<div class="ec-sum-box"><div class="kpi-label">${label}</div><div class="ec-sum-value" style="color:${color};">${v}</div>${sub ? `<div class="ec-kpi-sub">${sub}</div>` : ''}</div>`;
    $('ec-summary').innerHTML = `
      <div class="ec-sum-title">Période ${period} · ${escHtml(accs)}${secondary ? ' · <span style="color:var(--yellow);">lignes filtrées</span>' : ''}</div>
      <div class="ec-sum-grid">
        ${secondary ? '' : box('Solde de départ', money(opening), 'var(--text)', 'report de la veille')}
        ${box('Entrées', money(ins), 'var(--green)', rows.filter(e => e.dir === 'in').length + ' lignes')}
        ${box('Sorties', money(outs), 'var(--red)', rows.filter(e => e.dir === 'out').length + ' lignes')}
        ${box(secondary ? 'Net des lignes filtrées' : 'Variation', signedMoney(ins - outs), colorOf(ins - outs))}
        ${secondary ? '' : box('Solde de fin', money(opening + ins - outs), colorOf(opening + ins - outs), 'au ' + formatDate(f.to === '9999-12-31' ? todayStr() : f.to))}
      </div>`;
  }

  function accBadge(k) { return `<span class="ec-acc ec-acc-${k}">${A[k].icon} ${A[k].short}</span>`; }

  function renderDetail(rows, secondary, opening) {
    const pointCol = EC.hasPointage;
    $('ec-thead').innerHTML = `<tr>
      ${pointCol ? '<th title="Pointé (vérifié)"><input type="checkbox" onclick="ecPointAll(this.checked)" title="Pointer / dépointer toutes les lignes affichées"></th>' : ''}
      <th>Date</th><th>Compte</th><th>Nature</th><th>Libellé / motif</th><th>Réf.</th><th>Opérateur</th>
      <th style="text-align:right;">Entrée</th><th style="text-align:right;">Sortie</th>
      <th style="text-align:right;">${secondary ? 'Cumul filtré' : 'Solde'}</th><th></th></tr>`;
    let run = opening;
    const shown = rows.slice(0, EC.limit);
    // le solde progressif doit tenir compte de toutes les lignes, même non affichées
    const html = [];
    if (!secondary) html.push(`<tr class="ec-report"><td colspan="${pointCol ? 10 : 9}">Solde de départ (report)</td><td style="text-align:right;font-weight:700;">${money(opening)}</td><td></td></tr>`);
    shown.forEach(e => {
      run += T.signed(e);
      const pointed = EC.points.has(e.key);
      const nat = T.NATURES[e.nature];
      const transferTxt = e.counterAccount ? `<span class="ec-transfer">${e.dir === 'out' ? '→' : '←'} ${A[e.counterAccount].short}</span>` : '';
      html.push(`<tr class="${pointed ? 'ec-pointed' : ''}${e.status === 'pending' ? ' ec-pending' : ''}">
        ${pointCol ? `<td><input type="checkbox" ${pointed ? 'checked' : ''} onchange="ecPoint('${e.key}','${e.account}',this.checked)"></td>` : ''}
        <td style="white-space:nowrap;">${formatDate(e.date)}</td>
        <td>${accBadge(e.account)}</td>
        <td style="white-space:nowrap;font-size:12px;">${nat.icon} ${nat.label}<div class="ec-sub">${escHtml(e.categoryLabel || '')}</div></td>
        <td>${escHtml(e.label)} ${transferTxt}
          ${e.status === 'pending' ? '<span class="badge badge-yellow">En attente</span>' : ''}
          ${e.warning ? `<span class="badge badge-red" title="${escHtml(e.warning)}">!</span>` : ''}
          ${e.detail ? `<div class="ec-sub">${escHtml(e.detail)}</div>` : ''}</td>
        <td style="font-size:12px;">${escHtml(e.ref)}</td>
        <td style="font-size:11px;color:var(--text3);">${escHtml(e.operator)}</td>
        <td style="text-align:right;color:var(--green);font-weight:600;">${e.dir === 'in' ? money(e.amount) : ''}</td>
        <td style="text-align:right;color:var(--red);font-weight:600;">${e.dir === 'out' ? money(e.amount) : ''}</td>
        <td style="text-align:right;font-weight:700;color:${colorOf(run)};">${money(run)}</td>
        <td>${e.editable ? `<button class="btn btn-ghost btn-sm btn-icon" onclick="ecEditMove('${e.sourceId}')" title="Modifier">✏️</button>` : ''}</td>
      </tr>`);
    });
    if (!rows.length) html.push(`<tr><td colspan="11" class="text-muted" style="text-align:center;padding:20px;">Aucune ligne pour ces filtres</td></tr>`);
    $('ec-body').innerHTML = html.join('');
    const ins = rows.filter(e => e.dir === 'in').reduce((s, e) => s + e.amount, 0);
    const outs = rows.filter(e => e.dir === 'out').reduce((s, e) => s + e.amount, 0);
    $('ec-foot').innerHTML = rows.length ? `<tr><td colspan="${pointCol ? 7 : 6}" style="font-weight:700;">TOTAL (${rows.length} lignes${EC.hasPointage ? ` · ${rows.filter(e => EC.points.has(e.key)).length} pointées` : ''})</td>
      <td style="text-align:right;color:var(--green);font-weight:700;">${money(ins)}</td>
      <td style="text-align:right;color:var(--red);font-weight:700;">${money(outs)}</td>
      <td style="text-align:right;font-weight:700;">${money(opening + ins - outs)}</td><td></td></tr>` : '';
    const more = $('ec-more');
    if (rows.length > shown.length) {
      more.classList.remove('hidden');
      more.innerHTML = `${shown.length} lignes affichées sur ${rows.length}. <button class="btn btn-ghost btn-sm" onclick="ecShowMore()">Afficher plus</button>
        <span class="text-muted">(les totaux portent sur toutes les lignes)</span>`;
    } else more.classList.add('hidden');
  }

  function renderGrouped(rows, mode, secondary, opening) {
    const keyOf = e => (mode === 'month' ? e.date.slice(0, 7) : e.date);
    const groups = new Map();
    rows.forEach(e => {
      const k = keyOf(e);
      const g = groups.get(k) || { ins: 0, outs: 0, n: 0, acc: { caisse: 0, mobile_money: 0, banque: 0 } };
      if (e.dir === 'in') g.ins += e.amount; else g.outs += e.amount;
      g.acc[e.account] += T.signed(e); g.n++;
      groups.set(k, g);
    });
    const accCols = T.ACCOUNT_KEYS.filter(k => EC.accounts.has(k));
    $('ec-thead').innerHTML = `<tr><th>${mode === 'month' ? 'Mois' : 'Jour'}</th><th style="text-align:right;">Lignes</th>
      <th style="text-align:right;">Entrées</th><th style="text-align:right;">Sorties</th>
      ${accCols.map(k => `<th style="text-align:right;">Δ ${A[k].short}</th>`).join('')}
      <th style="text-align:right;">Net</th><th style="text-align:right;">${secondary ? 'Cumul filtré' : 'Solde de fin'}</th></tr>`;
    let run = opening;
    const html = [];
    if (!secondary) html.push(`<tr class="ec-report"><td colspan="${5 + accCols.length}">Solde de départ (report)</td><td style="text-align:right;font-weight:700;">${money(opening)}</td></tr>`);
    let tIn = 0, tOut = 0;
    groups.forEach((g, k) => {
      run += g.ins - g.outs; tIn += g.ins; tOut += g.outs;
      html.push(`<tr style="cursor:pointer;" onclick="ecDrill('${k}','${mode}')" title="Voir le détail">
        <td style="font-weight:600;">${mode === 'month' ? monthLabel(k) : formatDate(k)}</td>
        <td style="text-align:right;color:var(--text3);">${g.n}</td>
        <td style="text-align:right;color:var(--green);">${money(g.ins)}</td>
        <td style="text-align:right;color:var(--red);">${money(g.outs)}</td>
        ${accCols.map(a => `<td style="text-align:right;font-size:12px;color:${g.acc[a] ? colorOf(g.acc[a]) : 'var(--text3)'};">${g.acc[a] ? signedMoney(g.acc[a]) : '—'}</td>`).join('')}
        <td style="text-align:right;font-weight:600;color:${colorOf(g.ins - g.outs)};">${signedMoney(g.ins - g.outs)}</td>
        <td style="text-align:right;font-weight:700;color:${colorOf(run)};">${money(run)}</td></tr>`);
    });
    if (!groups.size) html.push(`<tr><td colspan="${6 + accCols.length}" class="text-muted" style="text-align:center;padding:20px;">Aucune ligne pour ces filtres</td></tr>`);
    $('ec-body').innerHTML = html.join('');
    $('ec-foot').innerHTML = groups.size ? `<tr><td style="font-weight:700;">TOTAL</td><td style="text-align:right;">${rows.length}</td>
      <td style="text-align:right;color:var(--green);font-weight:700;">${money(tIn)}</td>
      <td style="text-align:right;color:var(--red);font-weight:700;">${money(tOut)}</td>
      ${accCols.map(() => '<td></td>').join('')}
      <td style="text-align:right;font-weight:700;">${signedMoney(tIn - tOut)}</td>
      <td style="text-align:right;font-weight:700;">${money(run)}</td></tr>` : '';
    $('ec-more').classList.add('hidden');
  }

  function ecDrill(k, mode) {
    if (mode === 'month') { const [y, m] = k.split('-').map(Number); $('ec-from').value = `${k}-01`; $('ec-to').value = toISO(new Date(y, m, 0)); $('ec-group').value = 'day'; }
    else { $('ec-from').value = k; $('ec-to').value = k; $('ec-group').value = 'detail'; }
    document.querySelectorAll('#ec-presets .chip').forEach(c => c.classList.remove('active'));
    ecRender();
  }

  function ecShowMore() { EC.limit += 1000; ecRender(); }

  // ── Points à vérifier ──────────────────────────────────────
  function renderChecks() {
    const e = EC.entries;
    const items = [];
    const pending = e.filter(x => x.source === 'expenses' && x.status === 'pending' && x.dir === 'out');
    if (pending.length) items.push({ txt: `${pending.length} dépense(s) en attente de validation (${money(pending.reduce((s, x) => s + x.amount, 0))}) — déjà déduites des soldes.`, act: "ecQuick('pending')" });
    const gen = e.filter(x => x.warning && x.account === 'banque');
    if (gen.length) items.push({ txt: `${gen.length} règlement(s) par chèque/virement sans ligne bancaire : l'entrée en banque a été reconstituée depuis le ticket.`, act: "ecQuick('warning')" });
    const over = e.filter(x => x.warning && x.account !== 'banque' && x.warning.includes('supérieurs au prix'));
    const overTickets = new Set(over.map(x => x.sourceId)).size;
    if (overTickets) items.push({ txt: `${overTickets} ticket(s) dont les paiements saisis dépassent le prix (souvent l'acompte ressaisi en espèces ou Mobile Money) : seul le prix du ticket est compté.`, act: "ecQuick('overpaid')" });
    const retraits = e.filter(x => x.source === 'bank_transactions' && x.category === 'retrait');
    if (retraits.length) items.push({ txt: `${retraits.length} retrait(s) bancaire(s) saisi(s) dans l'onglet Banque (${money(retraits.reduce((s, x) => s + x.amount, 0))}) : si l'argent est allé en caisse, vérifiez qu'il y a bien l'entrée correspondante en caisse, sinon c'est une dépense payée par la banque.`, act: "ecQuick('retrait')" });
    const legacy = e.filter(x => x.source === 'caisse_regulations' && x.nature === 'ajustement' && ['depot', 'retrait'].includes(x.category));
    if (legacy.length) items.push({ txt: `${legacy.length} ancienne(s) régulation(s) de type dépôt/retrait sur la caisse : s'il s'agit d'un transfert (ex. « retrait banque pour caisse »), modifiez-la en « Transfert » pour relier les deux comptes.`, act: "ecQuick('legacy')" });
    const neg = T.dailyBalances(e).filter(d => d.caisse < 0 || d.mobile_money < 0 || d.banque < 0);
    if (neg.length) items.push({ txt: `${neg.length} jour(s) où un compte passe en négatif (premier : ${formatDate(neg[0].date)}) — signe d'une entrée oubliée ou d'une sortie en double.`, act: `ecDrill('${neg[0].date}','day')` });
    if (EC.hasPointage) {
      const notPointed = e.filter(x => !EC.points.has(x.key)).length;
      items.push({ txt: `${notPointed} ligne(s) non pointée(s) sur ${e.length}.`, act: "ecQuick('unpointed')" });
    }
    $('ec-checks').innerHTML = items.length
      ? items.map(i => `<div class="ec-check-item"><span>${i.txt}</span>${i.act ? `<button class="btn btn-ghost btn-sm" onclick="${i.act}">Voir</button>` : ''}</div>`).join('')
      : '<div class="text-muted">Rien à signaler.</div>';
  }

  function ecQuick(kind) {
    ecResetFiltersSilently();
    applyPreset('all', false);
    if (kind === 'pending') $('ec-status').value = 'pending';
    if (kind === 'warning') { $('ec-q').value = 'ligne bancaire absente'; EC.accounts = new Set(['banque']); syncToggles(); }
    if (kind === 'overpaid') { $('ec-q').value = 'supérieurs au prix'; EC.natures = new Set(['vente']); syncToggles(); }
    if (kind === 'retrait') { EC.accounts = new Set(['banque']); syncToggles(); $('ec-cat').value = 'banque|retrait'; }
    if (kind === 'legacy') { EC.natures = new Set(['ajustement']); syncToggles(); }
    if (kind === 'unpointed') $('ec-point').value = 'no';
    ecRender();
    $('ec-summary').scrollIntoView({ behavior: 'smooth' });
  }

  function ecResetFiltersSilently() {
    ['ec-dir', 'ec-cat', 'ec-op', 'ec-status', 'ec-point', 'ec-min', 'ec-max', 'ec-q'].forEach(id => ($(id).value = ''));
    $('ec-hide-transfers').checked = false; $('ec-group').value = 'detail';
    EC.accounts = new Set(T.ACCOUNT_KEYS); EC.natures = new Set(Object.keys(T.NATURES)); syncToggles();
  }

  function syncToggles() {
    document.querySelectorAll('#ec-accounts [data-acc]').forEach(l => { const on = EC.accounts.has(l.dataset.acc); l.classList.toggle('on', on); l.querySelector('input').checked = on; });
    document.querySelectorAll('#ec-natures [data-nat]').forEach(l => { const on = EC.natures.has(l.dataset.nat); l.classList.toggle('on', on); l.querySelector('input').checked = on; });
  }

  // ── Pointage ───────────────────────────────────────────────
  async function ecPoint(key, account, on) {
    if (on) {
      const row = { entry_key: key, account, pointe_par: currentUser?.email || null };
      const { data, error } = await sb.from('tresorerie_pointages').upsert([row], { onConflict: 'entry_key' }).select().single();
      if (error) { toast('Pointage impossible : ' + error.message, 'err'); return ecRender(); }
      EC.points.set(key, data);
    } else {
      const { error } = await sb.from('tresorerie_pointages').delete().eq('entry_key', key);
      if (error) { toast('Erreur : ' + error.message, 'err'); return ecRender(); }
      EC.points.delete(key);
    }
    ecRender();
  }

  async function ecPointAll(on) {
    const f = readFilters();
    const rows = EC.entries.filter(e => matches(e, f));
    const target = rows.filter(e => EC.points.has(e.key) !== on);
    if (!target.length) return;
    if (!confirm(`${on ? 'Pointer' : 'Dépointer'} ${target.length} ligne(s) affichée(s) ?`)) return ecRender();
    if (on) {
      const payload = target.map(e => ({ entry_key: e.key, account: e.account, pointe_par: currentUser?.email || null }));
      for (let i = 0; i < payload.length; i += 500) {
        const { data, error } = await sb.from('tresorerie_pointages').upsert(payload.slice(i, i + 500), { onConflict: 'entry_key' }).select();
        if (error) { toast('Erreur : ' + error.message, 'err'); break; }
        (data || []).forEach(p => EC.points.set(p.entry_key, p));
      }
    } else {
      const keys = target.map(e => e.key);
      for (let i = 0; i < keys.length; i += 200) {
        const { error } = await sb.from('tresorerie_pointages').delete().in('entry_key', keys.slice(i, i + 200));
        if (error) { toast('Erreur : ' + error.message, 'err'); break; }
        keys.slice(i, i + 200).forEach(k => EC.points.delete(k));
      }
    }
    ecRender();
  }

  // ── Mouvements manuels (transferts, ajustements) ───────────
  const accountOptions = () => T.ACCOUNT_KEYS.map(k => `<option value="${k}">${A[k].icon} ${A[k].label}</option>`).join('');

  function openDrawer(id) {
    $('ec-backdrop').classList.add('open');
    $(id).classList.add('open');
  }
  function ecCloseDrawers() {
    $('ec-backdrop').classList.remove('open');
    $('ec-move-drawer').classList.remove('open');
    $('ec-control-drawer').classList.remove('open');
  }

  function fillMoveSelects() {
    const types = Object.entries(T.REG_TYPES).filter(([k]) => k !== 'rechargement_mm');
    $('ec-m-type').innerHTML = types.map(([k, v]) => `<option value="${k}"${k === 'transfert' && !EC.hasAccounts ? ' disabled' : ''}>${v}</option>`).join('');
    ['ec-m-from', 'ec-m-to', 'ec-m-account'].forEach(id => ($(id).innerHTML = accountOptions()));
  }

  function ecOpenMove() {
    fillMoveSelects();
    EC.editingRegId = null;
    $('ec-move-title').textContent = '＋ Mouvement de trésorerie';
    $('ec-m-type').value = EC.hasAccounts ? 'transfert' : 'fond_caisse';
    $('ec-m-from').value = 'banque'; $('ec-m-to').value = 'caisse';
    $('ec-m-account').value = 'caisse'; $('ec-m-dir').value = 'credit';
    $('ec-m-date').value = todayStr();
    ['ec-m-amount', 'ec-m-label', 'ec-m-ref', 'ec-m-desc'].forEach(id => ($(id).value = ''));
    $('ec-m-delete').classList.add('hidden');
    ecMoveTypeChanged();
    openDrawer('ec-move-drawer');
  }

  function ecEditMove(id) {
    const r = EC.regulations.find(x => x.id === id);
    if (!r) return;
    fillMoveSelects();
    EC.editingRegId = id;
    $('ec-move-title').textContent = '✏️ Modifier le mouvement';
    const isTransfer = !!r.counter_account;
    $('ec-m-type').value = isTransfer ? 'transfert' : (T.REG_TYPES[r.type] ? r.type : 'autre');
    if (isTransfer) {
      // stockage : direction debit = sortie du compte « account » vers « counter_account »
      $('ec-m-from').value = r.direction === 'debit' ? r.account : r.counter_account;
      $('ec-m-to').value = r.direction === 'debit' ? r.counter_account : r.account;
    }
    $('ec-m-account').value = r.account || 'caisse';
    $('ec-m-dir').value = r.direction;
    $('ec-m-date').value = r.date;
    $('ec-m-amount').value = r.amount_xof;
    $('ec-m-label').value = r.label || '';
    $('ec-m-ref').value = r.reference || '';
    $('ec-m-desc').value = r.description || '';
    $('ec-m-delete').classList.remove('hidden');
    ecMoveTypeChanged();
    openDrawer('ec-move-drawer');
  }

  function ecMoveTypeChanged() {
    const type = $('ec-m-type').value;
    const transfer = type === 'transfert';
    $('ec-m-transfer').style.display = transfer ? '' : 'none';
    $('ec-m-single').style.display = transfer ? 'none' : '';
    $('ec-m-account').disabled = !EC.hasAccounts;
    if (!EC.hasAccounts) $('ec-m-account').value = 'caisse';
    if (type === 'ouverture' || type === 'fond_caisse' || type === 'depot') $('ec-m-dir').value = 'credit';
    if (type === 'retrait') $('ec-m-dir').value = 'debit';
    const hints = {
      transfert: 'Le montant sort du premier compte et entre dans le second : la trésorerie totale ne change pas.',
      ouverture: 'À saisir une seule fois par compte, à la date de démarrage du suivi (ex. solde du relevé bancaire).',
      ecart: 'Pour corriger un écart constaté au comptage. Le contrôle de caisse peut le passer automatiquement.',
      retrait: 'Sortie d\'argent qui n\'est ni une dépense ni un transfert (ex. prélèvement de l\'associé).',
      depot: 'Entrée d\'argent qui n\'est ni une vente ni un transfert (ex. apport de l\'associé).',
    };
    $('ec-m-warn').textContent = (hints[type] || '') + (EC.hasAccounts ? '' : ' (Migration non appliquée : seule la caisse est disponible.)');
  }

  async function ecSaveMove() {
    const type = $('ec-m-type').value;
    const amount = parseInt($('ec-m-amount').value, 10) || 0;
    const date = $('ec-m-date').value;
    const label = $('ec-m-label').value.trim();
    if (!date) return toast('Date requise', 'err');
    if (amount <= 0) return toast('Montant requis', 'err');
    if (!label) return toast('Libellé requis', 'err');
    const payload = { date, type, label, amount_xof: amount, description: $('ec-m-desc').value.trim() || null, created_by: currentUser?.email || null };
    if (EC.hasAccounts) payload.reference = $('ec-m-ref').value.trim() || null;
    if (type === 'transfert') {
      const from = $('ec-m-from').value, to = $('ec-m-to').value;
      if (from === to) return toast('Choisissez deux comptes différents', 'err');
      Object.assign(payload, { account: from, counter_account: to, direction: 'debit' });
    } else {
      payload.direction = $('ec-m-dir').value;
      if (EC.hasAccounts) Object.assign(payload, { account: $('ec-m-account').value, counter_account: null });
    }
    const q = EC.editingRegId
      ? sb.from('caisse_regulations').update(payload).eq('id', EC.editingRegId)
      : sb.from('caisse_regulations').insert([payload]);
    const { error } = await q;
    if (error) return toast('Erreur : ' + error.message, 'err');
    toast(EC.editingRegId ? 'Mouvement mis à jour' : 'Mouvement enregistré', 'ok');
    ecCloseDrawers();
    ecLoad();
  }

  async function ecDeleteMove() {
    if (!EC.editingRegId || !confirm('Supprimer ce mouvement ?')) return;
    const { error } = await sb.from('caisse_regulations').delete().eq('id', EC.editingRegId);
    if (error) return toast('Erreur suppression : ' + error.message, 'err');
    toast('Mouvement supprimé', 'ok');
    ecCloseDrawers();
    ecLoad();
  }

  // ── Contrôles de caisse ────────────────────────────────────
  // ── Comptage physique (inventaire monétaire) ───────────────
  // Coupures du franc CFA (BCEAO) en circulation.
  const DENOMS = [
    { v: 10000, k: 'billet' }, { v: 5000, k: 'billet' }, { v: 2000, k: 'billet' }, { v: 1000, k: 'billet' }, { v: 500, k: 'billet' },
    { v: 500, k: 'piece' }, { v: 250, k: 'piece' }, { v: 200, k: 'piece' }, { v: 100, k: 'piece' },
    { v: 50, k: 'piece' }, { v: 25, k: 'piece' }, { v: 10, k: 'piece' }, { v: 5, k: 'piece' },
  ];
  const denomId = (d, i) => `ec-c-q${i}`;

  async function ecOpenControl() {
    if (!EC.loaded) await ecLoad();
    if (!EC.hasControls) return toast('Migration non appliquée : comptage indisponible', 'err');
    $('ec-c-billetage').innerHTML = `<div class="ec-bill-grid">${DENOMS.map((d, i) => `
      <label class="ec-bill"><span>${d.k === 'billet' ? '💶' : '🪙'} ${fmt(d.v)}</span>
        <input type="number" min="0" step="1" id="${denomId(d, i)}" placeholder="0" oninput="ecControlPreview()" />
        <span class="ec-bill-sub" id="${denomId(d, i)}-t"></span></label>`).join('')}
      <label class="ec-bill"><span>➕ Autre montant</span>
        <input type="number" min="0" id="ec-c-other" placeholder="0" oninput="ecControlPreview()" /><span class="ec-bill-sub"></span></label>
    </div>`;
    $('ec-c-date').value = todayStr();
    ['ec-c-mm', 'ec-c-bank', 'ec-c-note'].forEach(id => ($(id).value = ''));
    $('ec-c-by').value = currentUser?.display_name || '';
    $('ec-c-book').checked = false;
    ecControlPreview();
    openDrawer('ec-control-drawer');
  }

  function controlFigures() {
    const date = $('ec-c-date').value;
    const bal = date ? T.balancesAt(EC.entries, date) : { caisse: 0, mobile_money: 0, banque: 0 };
    const billetage = [];
    let cash = 0, any = false;
    DENOMS.forEach((d, i) => {
      const raw = $(denomId(d, i)).value;
      const q = raw === '' ? 0 : Math.max(0, parseInt(raw, 10) || 0);
      if (raw !== '') any = true;
      if (q) billetage.push({ valeur: d.v, type: d.k, quantite: q });
      cash += q * d.v;
      $(denomId(d, i) + '-t').textContent = q ? fmt(q * d.v) : '';
    });
    const otherRaw = $('ec-c-other').value;
    const other = otherRaw === '' ? 0 : Math.max(0, parseInt(otherRaw, 10) || 0);
    if (otherRaw !== '') any = true;
    if (other) billetage.push({ valeur: other, type: 'autre', quantite: 1 });
    cash += other;
    const read = id => ($(id).value === '' ? null : Math.max(0, parseInt($(id).value, 10) || 0));
    const rows = [
      { account: 'caisse', counted: any ? cash : null, theo: bal.caisse, billetage },
      { account: 'mobile_money', counted: read('ec-c-mm'), theo: bal.mobile_money },
      { account: 'banque', counted: read('ec-c-bank'), theo: bal.banque },
    ];
    return { date, rows };
  }

  function ecControlPreview() {
    const { date, rows } = controlFigures();
    $('ec-c-preview').innerHTML = `<div style="font-size:11px;color:var(--text3);margin-bottom:6px;">Soldes théoriques au ${date ? formatDate(date) : '—'} au soir</div>
      <table style="width:100%;font-size:12.5px;"><thead><tr><th style="text-align:left;">Compte</th><th style="text-align:right;">Théorique</th><th style="text-align:right;">Compté</th><th style="text-align:right;">Écart</th></tr></thead><tbody>
      ${rows.map(r => {
        const ecart = r.counted == null ? null : r.counted - r.theo;
        return `<tr><td>${A[r.account].icon} ${A[r.account].short}</td><td style="text-align:right;">${money(r.theo)}</td>
          <td style="text-align:right;font-weight:700;">${r.counted == null ? '<span class="text-muted">—</span>' : money(r.counted)}</td>
          <td style="text-align:right;font-weight:700;color:${ecart == null ? 'var(--text3)' : ecart === 0 ? 'var(--green)' : 'var(--red)'};">${ecart == null ? '' : ecart === 0 ? '✓' : signedMoney(ecart)}</td></tr>`;
      }).join('')}</tbody></table>`;
  }

  async function ecSaveControl() {
    const { date, rows } = controlFigures();
    if (!date) return toast('Date du comptage requise', 'err');
    if (date > todayStr()) return toast('La date du comptage ne peut pas être dans le futur', 'err');
    if (rows[0].counted == null) return toast('Saisissez le billetage de la caisse (mettez 0 pour une coupure absente)', 'err');
    const by = $('ec-c-by').value.trim();
    const note = [by ? 'Compté par ' + by : '', $('ec-c-note').value.trim()].filter(Boolean).join(' · ') || null;
    const inventaireId = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : null;
    const filled = rows.filter(r => r.counted != null);
    const { error } = await sb.from('tresorerie_controles').insert(filled.map(r => ({
      date, account: r.account, montant_compte_xof: r.counted, solde_theorique_xof: r.theo, note,
      created_by: currentUser?.email || null, inventaire_id: inventaireId,
      billetage: r.account === 'caisse' ? r.billetage : null,
    })));
    if (error) return toast('Erreur : ' + error.message, 'err');
    if ($('ec-c-book').checked) {
      const regs = filled.filter(r => r.counted !== r.theo).map(r => {
        const ecart = r.counted - r.theo;
        const payload = {
          date, type: 'ecart', label: `Écart constaté au comptage (${A[r.account].short})`, amount_xof: Math.abs(ecart),
          direction: ecart > 0 ? 'credit' : 'debit', description: note, created_by: currentUser?.email || null,
        };
        if (EC.hasAccounts) payload.account = r.account;
        return payload;
      }).filter(p => EC.hasAccounts || p.label.includes(A.caisse.short));
      if (regs.length) {
        const r = await sb.from('caisse_regulations').insert(regs);
        if (r.error) toast('Inventaire enregistré, mais ajustement impossible : ' + r.error.message, 'err');
      }
    }
    toast('Inventaire enregistré', 'ok');
    ecCloseDrawers();
    if (typeof window.enigmaInventaireBanner === 'function') window.enigmaInventaireBanner();
    ecLoad();
  }

  function renderControls() {
    const el = $('ec-controls');
    if (!EC.hasControls) { el.innerHTML = '<div class="text-muted">Disponible après application de la migration.</div>'; return; }
    if (!EC.controls.length) { el.innerHTML = '<div class="text-muted">Aucun inventaire enregistré. Bouton « 🧮 Comptage physique » pour compter la caisse.</div>'; return; }
    el.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Compte</th><th style="text-align:right;">Compté</th><th style="text-align:right;">Théorique</th><th style="text-align:right;">Écart</th><th></th></tr></thead><tbody>
      ${EC.controls.slice(0, 30).map(c => {
        const ecart = c.montant_compte_xof - c.solde_theorique_xof;
        return `<tr><td>${formatDate(c.date)}</td><td>${accBadge(c.account)}</td>
          <td style="text-align:right;">${money(c.montant_compte_xof)}</td>
          <td style="text-align:right;color:var(--text3);">${money(c.solde_theorique_xof)}</td>
          <td style="text-align:right;font-weight:700;color:${ecart === 0 ? 'var(--green)' : 'var(--red)'};">${ecart === 0 ? '✓' : signedMoney(ecart)}</td>
          <td style="font-size:11px;color:var(--text3);">${escHtml(c.note || '')}${Array.isArray(c.billetage) && c.billetage.length ? `<div title="Billetage">${c.billetage.map(b => b.type === 'autre' ? 'autre ' + fmt(b.valeur) : b.quantite + ' × ' + fmt(b.valeur)).join(' · ')}</div>` : ''}${c.created_by ? `<div>${escHtml(c.created_by)}</div>` : ''}</td></tr>`;
      }).join('')}</tbody></table></div>
      <div class="text-muted" style="font-size:11px;margin-top:6px;">« Théorique » = solde calculé au moment du contrôle. Si une ligne est saisie après coup, l'écart réel peut avoir changé.</div>`;
  }

  // ── Export et impression ───────────────────────────────────
  function filteredRowsForExport() {
    const f = readFilters();
    return { f, rows: EC.entries.filter(e => matches(e, f)), secondary: hasSecondary(f) };
  }

  function ecExportCsv() {
    const { f, rows, secondary } = filteredRowsForExport();
    let run = secondary ? 0 : sumSelected(T.balancesAt(EC.entries, addDays(f.from, -1)));
    const head = ['Date', 'Compte', 'Nature', 'Catégorie', 'Libellé', 'Détail', 'Contrepartie', 'Référence', 'Opérateur', 'Statut', 'Entrée', 'Sortie', secondary ? 'Cumul filtré' : 'Solde', 'Pointé'];
    const lines = [head];
    if (!secondary) lines.push([f.from, '', '', '', 'Solde de départ', '', '', '', '', '', '', '', run, '']);
    rows.forEach(e => {
      run += T.signed(e);
      lines.push([e.date, A[e.account].label, T.NATURES[e.nature].label, e.categoryLabel || '', e.label, e.detail, e.counterAccount ? A[e.counterAccount].label : '',
        e.ref, e.operator, e.status === 'pending' ? 'En attente' : 'Validé', e.dir === 'in' ? e.amount : '', e.dir === 'out' ? e.amount : '', run, EC.points.has(e.key) ? 'oui' : '']);
    });
    const csv = '﻿' + lines.map(l => l.map(v => {
      const s = String(v ?? '');
      return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(';')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `etat-de-caisse_${f.from === '0000-01-01' ? 'debut' : f.from}_${f.to === '9999-12-31' ? todayStr() : f.to}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  function ecPrint() {
    const f = readFilters();
    const savedLimit = EC.limit; EC.limit = 1e9; ecRender();
    const asof = $('ec-asof').value || todayStr();
    const b = T.balancesAt(EC.entries, asof);
    const w = window.open('', '_blank');
    if (!w) { EC.limit = savedLimit; ecRender(); return toast('Autorisez les fenêtres pour imprimer', 'err'); }
    const clean = html => html.replace(/<input[^>]*>/g, m => (/checked/.test(m) ? '✓' : '')).replace(/<button[\s\S]*?<\/button>/g, '');
    w.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>État de caisse</title><style>
      body{font-family:system-ui,sans-serif;font-size:11px;color:#111;margin:16px;background:#fff}
      h1{font-size:16px;margin:0 0 4px} .muted{color:#666} table{width:100%;border-collapse:collapse;margin-top:10px}
      th,td{border-bottom:1px solid #ddd;padding:4px 6px;text-align:left;vertical-align:top} th{background:#f3f3f3}
      td *{color:#111 !important} .k{display:inline-block;margin-right:18px} .badge{border:1px solid #999;border-radius:3px;padding:0 3px;font-size:9px}
      .ec-sub{color:#666 !important;font-size:10px} .ec-acc{white-space:nowrap}
      @page{size:A4 landscape;margin:10mm}</style></head><body>
      <h1>${escHtml(ENIGMA_CONFIG.businessName)} — État de caisse</h1>
      <div class="muted">Période du ${formatDate(f.from === '0000-01-01' ? EC.entries[0]?.date : f.from)} au ${formatDate(f.to === '9999-12-31' ? todayStr() : f.to)} · imprimé le ${new Date().toLocaleString('fr-FR')}</div>
      <p>${T.ACCOUNT_KEYS.map(k => `<span class="k">${A[k].label} : <strong>${money(b[k])}</strong></span>`).join('')}<span class="k">Total : <strong>${money(b.total)}</strong></span> <span class="muted">(soldes au ${formatDate(asof)})</span></p>
      ${clean($('ec-summary').innerHTML)}
      <table><thead>${clean($('ec-thead').innerHTML)}</thead><tbody>${clean($('ec-body').innerHTML)}</tbody><tfoot>${clean($('ec-foot').innerHTML)}</tfoot></table>
      </body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
    EC.limit = savedLimit; ecRender();
  }

  Object.assign(window, {
    initEtatCaisse, ecLoad, ecRender, ecRenderSoon, ecToggle, ecResetFilters, ecDrill, ecShowMore, ecQuick,
    ecPoint, ecPointAll, ecOpenMove, ecEditMove, ecMoveTypeChanged, ecSaveMove, ecDeleteMove, ecCloseDrawers,
    ecOpenControl, ecControlPreview, ecSaveControl, ecExportCsv, ecPrint,
  });
})();
