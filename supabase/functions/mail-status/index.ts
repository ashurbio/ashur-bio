import { createClient } from "npm:@supabase/supabase-js@2";
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
Deno.serve(async (req) => {
  const provided = req.headers.get("x-test-key") || "";
  const { data } = await admin.rpc("get_test_key");
  if (!data || provided !== data) return new Response("not found", { status: 404 });
  const key = Deno.env.get("BREVO_API_KEY") || "";
  let brevo = "no_key";
  if (key) {
    const r = await fetch("https://api.brevo.com/v3/account", { headers: { "api-key": key, accept: "application/json" } });
    brevo = r.ok ? "key_valid" : "key_rejected_" + r.status;
  }
  return new Response(JSON.stringify({
    has_key: !!key, brevo,
    mail_from_set: !!Deno.env.get("MAIL_FROM"),
    mail_from_name_set: !!Deno.env.get("MAIL_FROM_NAME"),
    app_url_set: !!Deno.env.get("APP_URL"),
  }), { headers: { "content-type": "application/json" } });
});
