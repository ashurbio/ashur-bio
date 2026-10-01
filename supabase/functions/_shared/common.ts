import { createClient } from "npm:@supabase/supabase-js@2";

export const LOGIN_DOMAIN = "users.ashur-bio.app";

export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-test-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
  });
}

// Every user-facing message travels in both languages: Arabic in `message`, English in `message_en`.
export const m = (ar: string, en: string) => ({ message: ar, message_en: en });

export const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const LETTERS = "abcdefghjkmnpqrstuvwxyz23456789"; // no 0/o/1/l/i to avoid confusion

function randomFrom(alphabet: string, n: number): string {
  const out: string[] = [];
  const buf = new Uint32Array(1);
  const max = Math.floor(0xffffffff / alphabet.length) * alphabet.length; // rejection sampling, no bias
  while (out.length < n) {
    crypto.getRandomValues(buf);
    if (buf[0] < max) out.push(alphabet[buf[0] % alphabet.length]);
  }
  return out.join("");
}

export function newUsername(): string {
  return "bio-" + randomFrom(LETTERS, 5);
}

export function newPin(): string {
  let pin = "";
  // avoid trivially guessable PINs (all same digit or straight runs)
  do { pin = randomFrom("0123456789", 6); }
  while (/^(\d)\1{5}$/.test(pin) || "0123456789".includes(pin) || "9876543210".includes(pin));
  return pin;
}

export function loginEmail(username: string): string {
  return `${username}@${LOGIN_DOMAIN}`;
}

export function clientIp(req: Request): string {
  const xf = req.headers.get("x-forwarded-for") || "";
  return (xf.split(",")[0] || req.headers.get("cf-connecting-ip") || "unknown").trim();
}

export async function rateOk(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const { data, error } = await admin.rpc("rate_hit", {
    p_key: key, p_limit: limit, p_window_seconds: windowSeconds,
  });
  if (error) throw error;
  return data === true;
}

export async function isTestMode(req: Request): Promise<boolean> {
  const provided = req.headers.get("x-test-key");
  if (!provided) return false;
  const { data, error } = await admin.rpc("get_test_key");
  if (error || !data) return false;
  if (provided.length !== String(data).length) return false;
  let diff = 0;
  for (let i = 0; i < provided.length; i++) diff |= provided.charCodeAt(i) ^ String(data).charCodeAt(i);
  return diff === 0;
}

export const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

type MailConfig = { key: string; from: string; fromName: string; appUrl: string };

export async function mailConfig(): Promise<MailConfig> {
  const { data } = await admin.rpc("get_mail_config");
  const row = (Array.isArray(data) ? data[0] : data) || {};
  return {
    key: Deno.env.get("BREVO_API_KEY") || row.brevo_api_key || "",
    from: Deno.env.get("MAIL_FROM") || row.mail_from || "",
    fromName: Deno.env.get("MAIL_FROM_NAME") || row.mail_from_name || "بوابة علوم الحياة | Life Sciences Portal",
    appUrl: Deno.env.get("APP_URL") || row.app_url || "",
  };
}

export function credentialsEmail(opts: { name: string; username: string; pin: string; isReset: boolean; appUrl?: string }) {
  const appUrl = opts.appUrl || "";
  const T = opts.isReset
    ? {
        arTitle: "رمز الدخول الجديد",
        arIntro: "طلبت رمز دخول جديد. هذا رمزك الجديد، والرمز القديم ما يشتغل بعد الآن.",
        enTitle: "Your new access PIN",
        enIntro: "You asked for a new PIN. Here it is — your old PIN no longer works.",
      }
    : {
        arTitle: "أهلاً بك في بوابة قسم علوم الحياة",
        arIntro: "تم إنشاء حسابك. هذه معلومات الدخول الخاصة بيك:",
        enTitle: "Welcome to the Life Sciences Portal",
        enIntro: "Your account has been created. Here are your private login details:",
      };
  const btn = (label: string) => appUrl
    ? `<p style="margin:22px 0 0"><a href="${esc(appUrl)}" style="background:#1D64E8;color:#fff;text-decoration:none;padding:12px 24px;border-radius:12px;font-weight:700;display:inline-block">${label}</a></p>`
    : "";
  const rows = (ar: boolean) => `<table role="presentation" style="width:100%;border-collapse:collapse;background:#E4ECFF;border-radius:12px">
<tr><td style="padding:14px 16px;color:#465A7C;font-size:13px">${ar ? "اسم المستخدم" : "Username"}</td><td dir="ltr" style="padding:14px 16px;font-family:Consolas,monospace;font-size:20px;font-weight:700;text-align:${ar ? "left" : "right"}">${esc(opts.username)}</td></tr>
<tr><td style="padding:14px 16px;color:#465A7C;font-size:13px;border-top:1px solid #CFDBF7">${ar ? "رمز الدخول PIN" : "Access PIN"}</td><td dir="ltr" style="padding:14px 16px;font-family:Consolas,monospace;font-size:24px;font-weight:700;letter-spacing:4px;text-align:${ar ? "left" : "right"};border-top:1px solid #CFDBF7">${esc(opts.pin)}</td></tr>
</table>`;
  const html = `<!doctype html><html lang="ar" dir="rtl"><body style="margin:0;background:#EEF3FF;font-family:Tahoma,Arial,sans-serif;color:#0B1E3F">
<div style="max-width:500px;margin:0 auto;padding:28px 18px">
<div style="background:#fff;border:1px solid #D3DEF5;border-radius:18px;padding:26px">
<div dir="rtl" style="text-align:right">
<div style="font-size:13px;color:#465A7C">جامعة آشور · قسم علوم الحياة</div>
<h1 style="font-size:20px;margin:6px 0 14px">${esc(T.arTitle)}</h1>
<p style="margin:0 0 6px">${opts.name ? "مرحباً " + esc(opts.name) + "،" : "مرحباً،"}</p>
<p style="margin:0 0 18px;line-height:1.7">${esc(T.arIntro)}</p>
${rows(true)}
${btn("افتح التطبيق")}
<p style="margin:20px 0 0;font-size:12.5px;color:#465A7C;line-height:1.7">لا تشارك رمزك مع أحد. إذا نسيته، استخدم «نسيت الرمز» بصفحة الدخول ويوصلك رمز جديد على هذا الإيميل.</p>
</div>
<hr style="border:0;border-top:1px solid #D3DEF5;margin:26px 0">
<div dir="ltr" style="text-align:left;font-family:'Segoe UI',Arial,sans-serif">
<div style="font-size:13px;color:#465A7C">Ashur University · Department of Life Sciences</div>
<h1 style="font-size:19px;margin:6px 0 14px">${esc(T.enTitle)}</h1>
<p style="margin:0 0 6px">${opts.name ? "Hello " + esc(opts.name) + "," : "Hello,"}</p>
<p style="margin:0 0 18px;line-height:1.7">${esc(T.enIntro)}</p>
${rows(false)}
${btn("Open the app")}
<p style="margin:20px 0 0;font-size:12.5px;color:#465A7C;line-height:1.7">Don't share your PIN with anyone. If you forget it, choose "Forgot your PIN" on the sign-in page and a new one will be sent to this email.</p>
</div>
</div></div></body></html>`;
  const text = `${T.arTitle}\n\nاسم المستخدم: ${opts.username}\nرمز الدخول: ${opts.pin}\n${appUrl ? "\nرابط التطبيق: " + appUrl + "\n" : ""}\nلا تشارك رمزك مع أحد.\n\n----\n\n${T.enTitle}\n\nUsername: ${opts.username}\nAccess PIN: ${opts.pin}\n${appUrl ? "\nApp: " + appUrl + "\n" : ""}\nDon't share your PIN with anyone.`;
  return {
    subject: opts.isReset ? "رمز الدخول الجديد | Your new PIN - بوابة علوم الحياة" : "معلومات دخولك | Your login details - بوابة علوم الحياة",
    html,
    text,
  };
}

export async function sendMail(to: string, mail: { subject: string; html: string; text: string }, cfg: MailConfig): Promise<void> {
  const key = cfg.key;
  const from = cfg.from;
  if (!key || !from) throw new Error("mail_not_configured");
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": key, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      sender: { email: from, name: cfg.fromName },
      to: [{ email: to }],
      subject: mail.subject,
      htmlContent: mail.html,
      textContent: mail.text,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`mail_failed ${res.status} ${body.slice(0, 300)}`);
  }
}
