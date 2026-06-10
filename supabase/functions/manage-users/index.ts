import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Authorization manquante" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Vérifie que le token est valide et que l'utilisateur est admin
    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Non authentifié" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const role = (user.user_metadata?.role || "staff").toLowerCase();
    if (role !== "admin") {
      return new Response(JSON.stringify({ error: "Accès refusé — rôle admin requis" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Client admin avec la service role key — stockée côté serveur, jamais exposée
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const body = await req.json();
    const { action, ...payload } = body;
    let result: any;

    switch (action) {
      case "list":
        result = await supabaseAdmin.auth.admin.listUsers();
        break;
      case "create":
        result = await supabaseAdmin.auth.admin.createUser({
          email: payload.email,
          password: payload.password,
          user_metadata: payload.user_metadata,
          email_confirm: true,
        });
        break;
      case "update":
        result = await supabaseAdmin.auth.admin.updateUserById(payload.id, {
          user_metadata: payload.user_metadata,
        });
        break;
      case "update_password":
        result = await supabaseAdmin.auth.admin.updateUserById(payload.id, {
          password: payload.password,
        });
        break;
      case "delete":
        if (payload.id === user.id) {
          return new Response(JSON.stringify({ error: "Impossible de supprimer votre propre compte" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        result = await supabaseAdmin.auth.admin.deleteUser(payload.id);
        break;
      default:
        return new Response(JSON.stringify({ error: "Action inconnue : " + action }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }

    if (result.error) {
      return new Response(JSON.stringify({ error: result.error.message }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ data: result.data }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || "Erreur interne" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
