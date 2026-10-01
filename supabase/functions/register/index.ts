import { admin, clientIp, m, cors, credentialsEmail, EMAIL_RE, isTestMode, json, loginEmail, mailConfig, newPin, newUsername, rateOk, sendMail } from "../_shared/common.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed", ...m("طلب غير صالح.", "Invalid request.") }, 405);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ ok: false, error: "bad_json", ...m("طلب غير صالح.", "Invalid request.") }, 400); }

  const email = String(body.email ?? "").trim().toLowerCase();
  const joinCode = String(body.join_code ?? "").trim();
  const fullName = String(body.full_name ?? "").trim().replace(/\s+/g, " ");
  const studentNo = String(body.student_no ?? "").trim();

  if (!EMAIL_RE.test(email) || email.length > 254) return json({ ok: false, error: "bad_email", ...m("اكتب إيميل صحيح.", "Enter a valid email.") }, 400);
  if (fullName.length < 3 || fullName.length > 80) return json({ ok: false, error: "bad_name", ...m("اكتب اسمك الثلاثي (3 أحرف على الأقل).", "Enter your full name (at least 3 characters).") }, 400);
  if (studentNo.length > 30) return json({ ok: false, error: "bad_student_no", ...m("الرقم الجامعي طويل جداً.", "The student ID is too long.") }, 400);
  if (!joinCode) return json({ ok: false, error: "bad_join_code", ...m("اكتب رمز القسم اللي أعطاك إياه الممثل.", "Enter the department code your representative gave you.") }, 400);

  try {
    const test = await isTestMode(req);
    const ip = clientIp(req);
    const tooMany = () => json({ ok: false, error: "rate_limited", ...m("محاولات كثيرة. انتظر شوية وحاول مرة ثانية.", "Too many attempts. Wait a moment and try again.") }, 429);

    // Per-IP limit on every attempt: this is what stops someone guessing the department code.
    // It is generous because a whole class often shares one campus Wi-Fi or mobile-carrier address.
    if (!(await rateOk(`reg:ip:${ip}`, 60, 3600))) return tooMany();

    const { data: codeOk, error: codeErr } = await admin.rpc("check_join_code", { p_code: joinCode });
    if (codeErr) throw codeErr;
    if (!codeOk) return json({ ok: false, error: "bad_join_code", ...m("رمز القسم غير صحيح. تأكد منه عند الممثل.", "The department code is wrong. Check it with your representative.") }, 403);

    // Per-email limit only after the code is right, so a mistyped code never locks a student out.
    if (!(await rateOk(`reg:email:${email}`, 5, 86400))) return tooMany();

    const { data: existing, error: exErr } = await admin.from("profiles").select("id").eq("email", email).maybeSingle();
    if (exErr) throw exErr;
    if (existing) return json({ ok: false, error: "email_taken", ...m("هذا الإيميل مسجل مسبقاً. إذا نسيت معلوماتك استخدم «نسيت الرمز».", "This email is already registered. If you forgot your details, use \"Forgot your PIN\".") }, 409);

    const { count, error: cntErr } = await admin.from("profiles").select("id", { count: "exact", head: true });
    if (cntErr) throw cntErr;
    const role = (count ?? 0) === 0 ? "owner" : "student";

    const pin = newPin();
    let username = "";
    let userId = "";
    for (let attempt = 0; attempt < 12 && !userId; attempt++) {
      const candidate = newUsername();
      const { data: taken } = await admin.from("profiles").select("id").eq("username", candidate).maybeSingle();
      if (taken) continue;
      const { data, error } = await admin.auth.admin.createUser({
        email: loginEmail(candidate),
        password: pin,
        email_confirm: true,
        app_metadata: { app: "ashur-bio" },
      });
      if (error) {
        if (/already|exists|registered/i.test(error.message)) continue;
        throw error;
      }
      username = candidate;
      userId = data.user.id;
    }
    if (!userId) throw new Error("could_not_allocate_username");

    const { error: profErr } = await admin.from("profiles").insert({
      id: userId, username, email, full_name: fullName, student_no: studentNo, role,
      last_pin_sent_at: new Date().toISOString(),
    });
    if (profErr) {
      await admin.auth.admin.deleteUser(userId);
      if (profErr.code === "23505") return json({ ok: false, error: "email_taken", ...m("هذا الإيميل مسجل مسبقاً.", "This email is already registered.") }, 409);
      throw profErr;
    }

    if (!test) {
      try {
        const cfg = await mailConfig();
        await sendMail(email, credentialsEmail({ name: fullName, username, pin, isReset: false, appUrl: cfg.appUrl }), cfg);
      } catch (mailErr) {
        console.error("register mail error", mailErr);
        await admin.auth.admin.deleteUser(userId); // cascades to profile
        return json({ ok: false, error: "mail_failed", ...m("ما كدرنا ندز الإيميل حالياً. حاول بعد شوية، وإذا تكررت المشكلة بلّغ الممثل.", "We couldn't send the email right now. Try again shortly, and tell your representative if it keeps happening.") }, 502);
      }
    }

    return json({
      ok: true,
      ...m("تم إنشاء حسابك. دزينا اسم المستخدم ورمز الدخول على إيميلك.", "Your account is ready. We emailed you your username and PIN."),
      ...(test ? { test: { username, pin, role } } : {}),
    });
  } catch (err) {
    console.error("register error", err);
    return json({ ok: false, error: "server_error", ...m("صار خطأ بالخادم. حاول مرة ثانية.", "Server error. Please try again.") }, 500);
  }
});
