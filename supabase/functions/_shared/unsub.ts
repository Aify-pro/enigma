// Jeton de désinscription : HMAC-SHA256 de l'adresse e-mail (minuscules).
// Clé : secret CONTACT_UNSUB_SECRET s'il est défini, sinon la clé service du projet
// (jamais exposée : seul le jeton dérivé circule dans les liens).
const enc = new TextEncoder();

function secret(): string {
  return Deno.env.get("CONTACT_UNSUB_SECRET") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
}

export async function unsubToken(email: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret()), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(email.trim().toLowerCase()));
  return Array.from(new Uint8Array(sig)).slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function checkUnsubToken(email: string, token: string): Promise<boolean> {
  if (!email || !token) return false;
  const expected = await unsubToken(email);
  if (expected.length !== token.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ token.charCodeAt(i);
  return diff === 0;
}

export function unsubUrl(email: string, token: string): string {
  return `${Deno.env.get("SUPABASE_URL")}/functions/v1/contact-unsubscribe?e=${encodeURIComponent(email.trim().toLowerCase())}&t=${token}`;
}
