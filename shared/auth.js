// Masquer immédiatement le contenu des pages protégées
// pour éviter le flash avant la vérification de session.
// (Ne s'applique pas à login.html ni index.html)
if (!window.location.pathname.match(/login|index/)) {
  document.documentElement.style.visibility = 'hidden';
}

// ── Client Supabase partagé ───────────────────────────────────
const sb = supabase.createClient(
  ENIGMA_CONFIG.supabaseUrl,
  ENIGMA_CONFIG.supabaseAnonKey,
  { auth: { persistSession: true, storageKey: 'enigma_auth' } }
);

let currentUser = null; // { email, role }

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
    role:         (session.user.app_metadata?.role || 'staff').toLowerCase(),
    display_name: session.user.user_metadata?.display_name || session.user.email.split('@')[0],
  };
  document.documentElement.style.visibility = 'visible';
  // Afficher le nom dans la nav
  const navUser = document.getElementById('nav-user');
  if (navUser) navUser.textContent = currentUser.display_name;
  // Afficher Rapprochements et Admin uniquement pour les admins
  const rapLink   = document.getElementById('nav-rapprochements');
  const adminLink = document.getElementById('nav-admin');
  if (currentUser.role === 'admin') {
    if (rapLink)   rapLink.classList.remove('hidden');
    if (adminLink) adminLink.classList.remove('hidden');
  } else {
    if (adminLink) adminLink.classList.add('hidden');
  }
  return session;
}

// Vérifie session ET rôle admin ; redirige sinon.
async function requireAdmin() {
  const session = await requireAuth();
  if (currentUser.role !== 'admin') {
    window.location.href = 'caisse.html';
    throw new Error('unauthorized');
  }
  return session;
}

function isAdmin() {
  return currentUser?.role === 'admin';
}

async function logout() {
  await sb.auth.signOut();
  window.location.href = 'login.html';
}
