import { admin, clientIp, m, cors, credentialsEmail, EMAIL_RE, isTestMode, json, mailConfig, newPin, rateOk, sendMail } from "../_shared/common.ts";

const GENERIC = m(
  "إذا الإيميل مسجل عندنا، راح يوصلك رمز دخول جديد خلال دقائق. تأكد من مجلد الرسائل غير المرغوبة (Spam).",
  "If this email is registered with us, a new PIN will arrive within a few minutes. Check your Spam folder.",
);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed", ...m("طلب غير صالح.", "Invalid request.") }, 405);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ ok: false, error: "bad_json", ...m("طلب غير صالح.", "Invalid request.") }, 400); }
  const email = String(body.email ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return json({ ok: false, error: "bad_email", ...m("اكتب إيميل صحيح.", "Enter a valid email.") }, 400);

  try {
    const test = await isTestMode(req);
    const ip = clientIp(req);
    if (!(await rateOk(`reset:ip:${ip}`, 10, 3600)) || !(await rateOk(`reset:email:${email}`, 3, 3600))) {
      return json({ ok: false, error: "rate_limited", ...m("طلبت رمز أكثر من مرة. انتظر ساعة وحاول مرة ثانية.", "You've requested a PIN too many times. Wait an hour and try again.") }, 429);
    }

    const { data: prof, error } = await admin.from("profiles")
      .select("id, username, full_name, status").eq("email", email).maybeSingle();
    if (error) throw error;
    if (!prof || prof.status !== "active") return json({ ok: true, ...GENERIC });

    const pin = newPin();
    if (!test) {
      try {
        const cfg = await mailConfig();
        await sendMail(email, credentialsEmail({ name: prof.full_name, username: prof.username, pin, isReset: true, appUrl: cfg.appUrl }), cfg);
      } catch (mailErr) {
        console.error("reset mail error", mailErr);
        return json({ ok: false, error: "mail_failed", ...m("ما كدرنا ندز الإيميل حالياً. حاول بعد شوية.", "We couldn't send the email right now. Try again shortly.") }, 502);
      }
    }
    const { error: upErr } = await admin.auth.admin.updateUserById(prof.id, { password: pin });
    if (upErr) throw upErr;
    await admin.from("profiles").update({ last_pin_sent_at: new Date().toISOString() }).eq("id", prof.id);

    return json({ ok: true, ...GENERIC, ...(test ? { test: { username: prof.username, pin } } : {}) });
  } catch (err) {
    console.error("reset error", err);
    return json({ ok: false, error: "server_error", ...m("صار خطأ بالخادم. حاول مرة ثانية.", "Server error. Please try again.") }, 500);
  }
});
