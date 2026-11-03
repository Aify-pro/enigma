// Envoi d'e-mails aux contacts depuis Admin › Contacts (administrateurs uniquement).
// Corps attendu : { subject, message, recipients: [{ email, name }] }
// - {nom} et {prenom} dans l'objet ou le message sont remplacés par le nom du contact ;
// - les adresses désinscrites (contact_optouts) sont ignorées ;
// - chaque e-mail porte un lien de désinscription (et l'en-tête List-Unsubscribe) ;
// - l'envoi est journalisé dans contact_messages / contact_message_recipients.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { unsubToken, unsubUrl } from "../_shared/unsub.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const MAX_RECIPIENTS = 1000;
const BATCH = 100; // limite de l'API batch de Resend

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

function escapeHtml(s: string) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] || c));
}
const firstName = (name: string) => (String(name || "").trim().split(/\s+/)[0] || "");
const personalize = (text: string, name: string) =>
  text.replace(/\{nom\}/gi, String(name || "").trim() || "cher joueur").replace(/\{prenom\}/gi, firstName(name) || "cher joueur");
const isEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

function linkify(escaped: string) {
  return escaped.replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}" style="color:#7c6af7;">${u}</a>`);
}

function renderHtml(subject: string, message: string, unsub: string) {
  const body = linkify(escapeHtml(message)).replace(/\n/g, "<br>");
  return `
    <div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a;">
      <h2 style="color:#7c6af7;margin-bottom:12px;">${escapeHtml(subject)}</h2>
      <div style="font-size:15px;line-height:1.55;">${body}</div>
      <p style="margin-top:28px;color:#999;font-size:12px;">Enigma Escape Game — Abidjan · <a href="https://enigma.ci" style="color:#999;">enigma.ci</a></p>
      <p style="color:#aaa;font-size:11px;">Vous recevez cet e-mail car vous avez un compte joueur ou avez réservé chez Enigma.
        <a href="${unsub}" style="color:#aaa;">Se désinscrire</a></p>
    </div>`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Méthode non autorisée" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Appelant : administrateur connecté uniquement (rôle lu dans app_metadata)
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: who, error: whoErr } = await admin.auth.getUser(jwt);
  if (whoErr || !who?.user) return json({ error: "Non authentifié" }, 401);
  if ((who.user.app_metadata?.role || "") !== "admin") return json({ error: "Réservé aux administrateurs" }, 403);

  let payload: { subject?: string; message?: string; recipients?: { email?: string; name?: string }[] };
  try { payload = await req.json(); } catch (_e) { return json({ error: "JSON invalide" }, 400); }
  const subject = String(payload.subject || "").trim();
  const message = String(payload.message || "").trim();
  if (!subject || !message) return json({ error: "Objet et message requis" }, 400);
  if (subject.length > 200 || message.length > 20000) return json({ error: "Objet ou message trop long" }, 400);

  // Dédoublonnage + validation des adresses
  const seen = new Set<string>();
  const list: { email: string; name: string }[] = [];
  for (const r of payload.recipients || []) {
    const email = String(r.email || "").trim().toLowerCase();
    if (!isEmail(email) || seen.has(email)) continue;
    seen.add(email);
    list.push({ email, name: String(r.name || "").trim() });
  }
  if (!list.length) return json({ error: "Aucune adresse e-mail valide" }, 400);
  if (list.length > MAX_RECIPIENTS) return json({ error: `Maximum ${MAX_RECIPIENTS} destinataires par envoi` }, 400);

  const { data: outs } = await admin.from("contact_optouts").select("email").in("email", list.map((l) => l.email));
  const optedOut = new Set((outs || []).map((o: { email: string }) => o.email));
  const toSend = list.filter((l) => !optedOut.has(l.email));

  const { data: msg, error: msgErr } = await admin.from("contact_messages").insert({
    channel: "email", subject, body: message, recipients_count: list.length,
    skipped_count: list.length - toSend.length, sent_by: who.user.email,
  }).select("id").single();
  if (msgErr) return json({ error: "Journalisation impossible : " + msgErr.message }, 500);

  const rows: Record<string, unknown>[] = list.filter((l) => optedOut.has(l.email))
    .map((l) => ({ message_id: msg.id, email: l.email, name: l.name, status: "skipped", error: "désinscrit" }));
  let sent = 0, failed = 0;

  for (let i = 0; i < toSend.length; i += BATCH) {
    const chunk = toSend.slice(i, i + BATCH);
    const emails = await Promise.all(chunk.map(async (c) => {
      const link = unsubUrl(c.email, await unsubToken(c.email));
      const subj = personalize(subject, c.name);
      return {
        from: "Enigma Escape Game <noreply@enigma.ci>",
        reply_to: "contact@enigma.ci",
        to: [c.email],
        subject: subj,
        html: renderHtml(subj, personalize(message, c.name), link),
        text: personalize(message, c.name) + `\n\n—\nEnigma Escape Game · enigma.ci\nSe désinscrire : ${link}`,
        headers: { "List-Unsubscribe": `<${link}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
      };
    }));
    try {
      const res = await fetch("https://api.resend.com/emails/batch", {
        method: "POST",
        headers: { "Authorization": `Bearer ${Deno.env.get("RESEND_API_KEY")}`, "Content-Type": "application/json" },
        body: JSON.stringify(emails),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out?.message || out?.error?.message || `HTTP ${res.status}`);
      const ids: { id?: string }[] = Array.isArray(out?.data) ? out.data : [];
      chunk.forEach((c, k) => rows.push({ message_id: msg.id, email: c.email, name: c.name, status: "sent", provider_id: ids[k]?.id || null }));
      sent += chunk.length;
    } catch (e) {
      const err = String((e as Error).message || e).slice(0, 500);
      console.error("Erreur Resend:", err);
      chunk.forEach((c) => rows.push({ message_id: msg.id, email: c.email, name: c.name, status: "failed", error: err }));
      failed += chunk.length;
    }
  }

  for (let i = 0; i < rows.length; i += 500) await admin.from("contact_message_recipients").insert(rows.slice(i, i + 500));
  await admin.from("contact_messages").update({ sent_count: sent, failed_count: failed }).eq("id", msg.id);

  return json({ message_id: msg.id, sent, failed, skipped: list.length - toSend.length });
});
