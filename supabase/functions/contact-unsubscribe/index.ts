// Désinscription des e-mails du module Contacts (lien en pied de chaque e-mail).
// GET  → page de confirmation (un simple clic d'un antivirus ne désinscrit pas) ;
// POST → désinscription (bouton de la page, ou « un clic » des messageries : RFC 8058).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { checkUnsubToken } from "../_shared/unsub.ts";

function page(title: string, body: string, status = 200) {
  return new Response(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} — Enigma</title></head>
<body style="font-family:system-ui,-apple-system,sans-serif;background:#0d0d12;color:#eee;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:16px;">
<div style="max-width:440px;background:#17171f;border:1px solid #2a2a36;border-radius:12px;padding:28px;text-align:center;">
<h1 style="font-size:20px;color:#a99cff;margin:0 0 12px;">${title}</h1>${body}
<p style="margin-top:22px;font-size:12px;"><a href="https://enigma.ci" style="color:#888;">enigma.ci</a></p></div></body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] || c));

Deno.serve(async (req: Request) => {
  const u = new URL(req.url);
  const email = (u.searchParams.get("e") || "").trim().toLowerCase();
  const token = u.searchParams.get("t") || "";
  if (!(await checkUnsubToken(email, token))) {
    return page("Lien invalide", "<p>Ce lien de désinscription n'est pas valide. Écrivez-nous à contact@enigma.ci.</p>", 400);
  }
  if (req.method === "GET") {
    return page("Se désinscrire ?", `<p>Ne plus recevoir les e-mails d'Enigma Escape Game à l'adresse <strong>${esc(email)}</strong> ?</p>
      <form method="post" action="?e=${encodeURIComponent(email)}&t=${esc(token)}"><button type="submit"
      style="margin-top:10px;background:#7c6af7;color:#fff;border:0;border-radius:8px;padding:10px 18px;font-size:15px;cursor:pointer;">Me désinscrire</button></form>
      <p style="font-size:12px;color:#888;margin-top:14px;">Les e-mails liés à vos réservations (confirmation, rappel) continueront d'arriver.</p>`);
  }
  if (req.method !== "POST") return page("Méthode non autorisée", "", 405);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { error } = await admin.from("contact_optouts").upsert({ email, source: "lien e-mail" }, { onConflict: "email", ignoreDuplicates: true });
  if (error) return page("Erreur", "<p>La désinscription n'a pas pu être enregistrée. Réessayez plus tard ou écrivez à contact@enigma.ci.</p>", 500);
  return page("C'est fait", `<p>L'adresse <strong>${esc(email)}</strong> ne recevra plus nos e-mails d'information.</p>`);
});
