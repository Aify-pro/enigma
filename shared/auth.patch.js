// ── À AJOUTER dans shared/auth.js, dans requireAuth(), juste après le bloc
//    qui gère rapLink / adminLink (le lien "Site public" est réservé aux admins) :
  const siteLink = document.getElementById('nav-site');
  if (siteLink) siteLink.classList.toggle('hidden', currentUser.role !== 'admin');
