// ============================================================
// Enigma — Trésorerie : moteur de l'état de caisse réel
// ------------------------------------------------------------
// Transforme les données brutes (tickets, acomptes, dépenses,
// mouvements bancaires, mouvements manuels) en un journal unique
// d'écritures, chacune rattachée à un compte de trésorerie :
//   caisse (espèces) · mobile_money · banque
//
// Règles :
//  - Ticket : la part espèces entre en caisse, la part Mobile Money
//    entre en Mobile Money. Chèque/virement : on prend la ligne
//    bancaire créée par la caisse (bank_transactions.ticket_id) ; si
//    elle manque, l'écriture banque est générée depuis le ticket.
//    Bons cadeaux et acomptes déduits ne sont pas de l'argent reçu
//    ce jour-là (l'acompte a déjà été compté le jour où il a été versé).
//  - Acompte : l'argent entre le jour du versement, sur le compte de
//    son moyen de paiement, quel que soit son statut (utilisé, en
//    attente, pénalité). Un acompte remboursé ressort à sa date de
//    remboursement (used_at).
//  - Dépense (non rejetée) : sort du compte de son moyen de paiement.
//    Les catégories « recharge MM », « dépôt espèces », « dépôt MM »
//    ne sont pas des dépenses mais des transferts entre comptes : on
//    génère la sortie ET l'entrée correspondante.
//  - Mouvement bancaire : entre/sort de la banque, sauf s'il est la
//    contrepartie d'une dépense-transfert (déjà comptée ci-dessus).
//  - Mouvement manuel (caisse_regulations) : entrée/sortie sur son
//    compte ; s'il a un compte de contrepartie, c'est un transfert
//    et l'écriture inverse est passée sur l'autre compte.
// ============================================================
(function (root) {
  'use strict';

  const ACCOUNTS = {
    caisse:       { label: 'Caisse (espèces)', short: 'Caisse',  icon: '💵', color: 'var(--green)' },
    mobile_money: { label: 'Mobile Money',     short: 'Mobile M.', icon: '📱', color: 'var(--cyan)' },
    banque:       { label: 'Banque',           short: 'Banque',  icon: '🏛', color: 'var(--yellow)' },
  };
  const ACCOUNT_KEYS = Object.keys(ACCOUNTS);

  const NATURES = {
    vente:      { label: 'Vente',               icon: '🎫' },
    acompte:    { label: 'Acompte',             icon: '🧾' },
    depense:    { label: 'Dépense',             icon: '🧾' },
    transfert:  { label: 'Transfert',           icon: '🔄' },
    banque:     { label: 'Opération bancaire',  icon: '🏛' },
    ajustement: { label: 'Ajustement / régul.', icon: '⚖️' },
  };
  NATURES.depense.icon = '💸';

  // Catégories de dépenses qui sont en réalité des transferts entre comptes
  const TRANSFER_EXPENSE_CATS = {
    rechargement_mm:    'mobile_money',
    depot_especes:      'banque',
    depot_mobile_money: 'banque',
    banque:             'banque',  // ancienne catégorie
  };

  const REG_TYPES = {
    transfert:   '🔄 Transfert entre comptes',
    ouverture:   '🏁 Solde d\'ouverture',
    fond_caisse: '💰 Fond de caisse',
    ecart:       '⚖️ Écart constaté',
    retrait:     '💸 Retrait',
    depot:       '📥 Dépôt / apport',
    autre:       '📋 Autre',
    rechargement_mm: '🔄 Recharge MM (auto)',
  };

  const BANK_CATS = {
    cheque: 'Chèque', virement: 'Virement', depot_especes: 'Dépôt espèces',
    retrait: 'Retrait', frais_bancaires: 'Frais bancaires', autre: 'Autre',
  };

  const ADVANCE_STATUS = { pending: 'en attente', used: 'utilisé', penalty: 'pénalité (conservé)', refunded: 'remboursé' };

  function accountFromMethod(m) {
    if (!m || m === 'especes' || m === 'cash') return 'caisse';
    if (m === 'mobile' || m === 'mobile_money' || m === 'wave' || m === 'orange_money') return 'mobile_money';
    if (m === 'cheque' || m === 'virement' || m === 'banque') return 'banque';
    return 'caisse';
  }

  const n = v => Math.round(Number(v) || 0);
  const day = v => (v ? String(v).slice(0, 10) : null);

  /**
   * @param {object} src { tickets, advances, expenses, bankTx, regulations, expenseCategories }
   * @returns {Array} écritures triées par date puis heure de saisie
   */
  function buildLedger(src) {
    const out = [];
    const catLabels = {};
    (src.expenseCategories || []).forEach(c => { catLabels[c.value] = c.label; });

    const push = e => {
      if (!e.amount || e.amount <= 0 || !e.date) return;
      e.key = `${e.source}:${e.sourceId}:${e.account}:${e.dir}`;
      out.push(e);
    };

    // ── Tickets ──────────────────────────────────────────────
    const bankByTicket = new Set((src.bankTx || []).filter(b => b.ticket_id).map(b => b.ticket_id));
    (src.tickets || []).filter(t => t.status === 'confirmed').forEach(t => {
      const what = t.ticket_type === 'forfait' ? 'Forfait' : 'Ticket';
      const base = {
        date: day(t.session_date), nature: 'vente', category: t.ticket_type || 'standard',
        categoryLabel: what,
        label: `${what} ${t.ticket_number || ''} · ${t.room_name || 'Articles'}${t.time_slot ? ' ' + t.time_slot : ''}`,
        detail: [t.client_name, t.team_name, t.num_players ? t.num_players + ' joueurs' : ''].filter(Boolean).join(' · '),
        ref: t.ticket_number || '', operator: t.operator_name || '', status: 'validated',
        source: 'tickets', sourceId: t.id, createdAt: t.created_at,
      };
      push({ ...base, account: 'caisse',       dir: 'in', amount: n(t.payment_especes_xof) });
      push({ ...base, account: 'mobile_money', dir: 'in', amount: n(t.payment_mobile_xof) });
      if (!bankByTicket.has(t.id)) {
        const bankPart = n(t.payment_cheque_xof) + n(t.payment_virement_xof);
        push({ ...base, account: 'banque', dir: 'in', amount: bankPart, warning: 'Ligne bancaire absente : générée depuis le ticket' });
      }
    });

    // ── Acomptes ─────────────────────────────────────────────
    (src.advances || []).forEach(a => {
      const account = accountFromMethod(a.payment_method);
      const base = {
        nature: 'acompte', category: a.status, categoryLabel: 'Acompte ' + (ADVANCE_STATUS[a.status] || a.status),
        label: `Acompte ${a.client_name || ''}${a.reservation_date ? ' · résa du ' + a.reservation_date.split('-').reverse().join('/') : ''}`,
        detail: [a.client_phone, a.notes].filter(Boolean).join(' · '),
        ref: '', operator: a.operator_name || '', status: 'validated',
        source: 'advances', sourceId: a.id, account, createdAt: a.created_at,
      };
      push({ ...base, date: day(a.date), dir: 'in', amount: n(a.amount_xof) });
      if (a.status === 'refunded') {
        push({ ...base, date: day(a.used_at) || day(a.date), dir: 'out', amount: n(a.amount_xof), label: 'Remboursement ' + base.label });
      }
    });

    // ── Dépenses ─────────────────────────────────────────────
    const transferExpenseIds = new Set();
    (src.expenses || []).filter(e => e.status !== 'rejected').forEach(e => {
      const from = accountFromMethod(e.payment_method);
      const to = TRANSFER_EXPENSE_CATS[e.category];
      const base = {
        date: day(e.date), category: e.category, categoryLabel: catLabels[e.category] || e.category,
        detail: e.receipt_ref ? 'Pièce ' + e.receipt_ref : '',
        ref: e.receipt_ref || '', operator: e.operator_name || '', status: e.status || 'pending',
        source: 'expenses', sourceId: e.id, createdAt: e.created_at,
      };
      if (to && to !== from) {
        transferExpenseIds.add(e.id);
        const lbl = e.description || catLabels[e.category] || 'Transfert';
        push({ ...base, nature: 'transfert', account: from, dir: 'out', amount: n(e.amount_xof), label: lbl, counterAccount: to });
        push({ ...base, nature: 'transfert', account: to,   dir: 'in',  amount: n(e.amount_xof), label: lbl, counterAccount: from });
      } else {
        push({ ...base, nature: 'depense', account: from, dir: 'out', amount: n(e.amount_xof), label: e.description || base.categoryLabel });
      }
    });

    // ── Banque ───────────────────────────────────────────────
    (src.bankTx || []).forEach(b => {
      if (b.expense_id && transferExpenseIds.has(b.expense_id)) return; // contrepartie déjà passée
      push({
        date: day(b.date), account: 'banque', dir: b.type === 'debit' ? 'out' : 'in', amount: n(b.amount_xof),
        nature: b.ticket_id ? 'vente' : 'banque', category: b.category, categoryLabel: BANK_CATS[b.category] || b.category,
        label: b.description || BANK_CATS[b.category] || 'Opération bancaire', detail: '',
        ref: b.reference || '', operator: b.created_by || '', status: 'validated',
        source: 'bank_transactions', sourceId: b.id, createdAt: b.created_at,
      });
    });

    // ── Mouvements manuels ───────────────────────────────────
    (src.regulations || []).forEach(r => {
      if (r.type === 'rechargement_mm') return; // contrepartie automatique d'une dépense « recharge MM »
      const account = r.account || 'caisse';
      const counter = r.counter_account || null;
      const dir = r.direction === 'debit' ? 'out' : 'in';
      const base = {
        date: day(r.date), category: r.type, categoryLabel: REG_TYPES[r.type] || r.type,
        label: r.label || REG_TYPES[r.type] || 'Mouvement', detail: r.description || '',
        ref: r.reference || '', operator: r.created_by || '', status: 'validated',
        source: 'caisse_regulations', sourceId: r.id, createdAt: r.created_at, editable: true,
      };
      if (counter && counter !== account) {
        push({ ...base, nature: 'transfert', account, dir, amount: n(r.amount_xof), counterAccount: counter });
        push({ ...base, nature: 'transfert', account: counter, dir: dir === 'in' ? 'out' : 'in', amount: n(r.amount_xof), counterAccount: account });
      } else {
        push({ ...base, nature: 'ajustement', account, dir, amount: n(r.amount_xof) });
      }
    });

    out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : String(a.createdAt || '').localeCompare(String(b.createdAt || ''))));
    return out;
  }

  const signed = e => (e.dir === 'in' ? e.amount : -e.amount);

  /** Soldes par compte de toutes les écritures datées au plus tard `date` (incluse). */
  function balancesAt(entries, date) {
    const b = { caisse: 0, mobile_money: 0, banque: 0 };
    entries.forEach(e => { if (!date || e.date <= date) b[e.account] += signed(e); });
    b.total = b.caisse + b.mobile_money + b.banque;
    return b;
  }

  /** Solde quotidien (fin de journée) par compte, de la première écriture à `until`. */
  function dailyBalances(entries, until) {
    const days = [];
    const b = { caisse: 0, mobile_money: 0, banque: 0 };
    let cur = null;
    entries.forEach(e => {
      if (until && e.date > until) return;
      if (cur !== e.date) { if (cur) days.push({ date: cur, ...b }); cur = e.date; }
      b[e.account] += signed(e);
    });
    if (cur) days.push({ date: cur, ...b });
    return days;
  }

  const api = { ACCOUNTS, ACCOUNT_KEYS, NATURES, REG_TYPES, BANK_CATS, TRANSFER_EXPENSE_CATS, accountFromMethod, buildLedger, balancesAt, dailyBalances, signed };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Tresorerie = api;
})(typeof window !== 'undefined' ? window : globalThis);
