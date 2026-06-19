// ============================================================
// Enigma Escape Game — Configuration
// ============================================================
const ENIGMA_CONFIG = {
  supabaseUrl:     'https://lkklkceakfmufgtzzjwy.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxra2xrY2Vha2ZtdWZndHp6and5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwMjczMTYsImV4cCI6MjA5NjYwMzMxNn0.L-I5xh53vycuAFPr0QsOBAeiIEtG0D1rVIWSGjFvils',
  // La service role key n'est plus nécessaire ici — elle est stockée dans la Edge Function Supabase.

  // ── Planning / Calendrier ──────────────────────────────────
  // Google Calendar : Settings → Integrate calendar → "Embed code" → copier l'URL src de l'iframe
  calendarEmbedUrl: '',
  // ICS feed : Google Calendar → Settings → "Secret/Public address in iCal format"
  // Ou le lien .ics de votre site officiel
  calendarIcsUrl:   '',

  businessName:   'Enigma Escape Game',
  currency:       'FCFA',
  thermalMm:      80,   // largeur du papier thermique : 58 ou 80

  expenseCategories: [
    { value: 'loyer',        label: '🏢 Loyer' },
    { value: 'salaires',     label: '👤 Salaires' },
    { value: 'fournitures',  label: '📦 Fournitures' },
    { value: 'marketing',    label: '📢 Marketing' },
    { value: 'maintenance',  label: '🔧 Maintenance' },
    { value: 'rechargement_mm',    label: '🔄 Recharge Mobile Money (depuis caisse)' },
    { value: 'depot_especes',      label: '💵 Dépôt espèces (vers banque)' },
    { value: 'depot_mobile_money', label: '📱 Dépôt Mobile Money (vers banque)' },
    { value: 'autres',       label: '📋 Autres' },
  ],
};
