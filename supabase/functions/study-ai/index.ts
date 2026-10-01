// Study assistant: translates or summarises one part of a handout with Gemini Flash (free tier, Google AI Studio)
// and streams the result back. The browser splits big files into small parts and sends them one at a time
// (see web/src/sb/study/run.js).
//
// Request:  POST, Authorization: Bearer <student access token>, JSON body (see prompts.ts → parseRequest).
// Response: errors before streaming are JSON {ok:false, error, message, message_en[, retry_after]} with a 4xx/5xx
//           status. Otherwise newline-delimited JSON events:
//             {"type":"status","phase":"thinking"|"writing"}      progress
//             {"type":"delta","text":"..."}                        output text (Markdown, or JSON for "study")
//             {"type":"ping"}                                      keep-alive every 10 s
//             {"type":"done","stop":"STOP","model":"..."}          finished (model = the one that answered)
//             {"type":"error","code":"...","message":"...","message_en":"...","retry_after"?:seconds}
//           Codes: busy (wait retry_after, then retry), daily_quota / user_limit / global_limit / not_configured
//           (stop the job), too_long (split the part), refused / bad_input (this part failed), server.
import { admin, cors, json, m, rateOk } from "../_shared/common.ts";
import { InvalidRequest, parseRequest, type StudyRequest } from "./prompts.ts";
import { buildRequest, classifyError, finishProblem, sseJson } from "./gemini.ts";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

const env = (k: string, fallback: string) => Deno.env.get(k) || fallback;
const MODEL = env("AI_MODEL", "gemini-3.8-flash");
// The newest free model is often "experiencing high demand" (503). When it is busy, try this older stable Flash model
// at once (it has its own free quota) instead of making the student wait. "off" disables it.
const FALLBACK = env("AI_FALLBACK_MODEL", "gemini-3.5-flash");
const MODELS = FALLBACK === "off" || FALLBACK === MODEL ? [MODEL] : [MODEL, FALLBACK];
const API = env("GEMINI_BASE_URL", "https://generativelanguage.googleapis.com");
// Under heavy load a request can sit in Google's queue with no answer and no error. If the main model hasn't started
// answering after this long, give up on it and ask the fallback model with the time that is left.
const FIRST_BYTE_MS = Number(env("AI_FIRST_BYTE_SEC", "40")) * 1000;
// The free tier is shared by the whole Google project (roughly 10–15 requests a minute and ~1000 a day; the exact
// numbers are shown in AI Studio). These keep the department under it.
const USER_DAILY = Number(env("AI_USER_DAILY", "20")); // parts per student per 24 h (charged once Gemini answers)
const USER_TRIES = Number(env("AI_USER_TRIES", "60")); // calls per student per 24 h, retries included
const GLOBAL_DAILY = Number(env("AI_GLOBAL_DAILY", "800")); // parts for the whole department per 24 h
const GLOBAL_RPM = Number(env("AI_GLOBAL_RPM", "10")); // parts per minute for the whole department
// Stop a call a little before the platform's wall-clock limit (150 s on Supabase's free plan, 400 s on paid plans),
// so the browser gets a clean "too_long" (split the part) or "busy" (nothing came back) instead of a dropped connection.
const TIME_LIMIT_MS = Number(env("AI_TIME_LIMIT_SEC", "135")) * 1000;

const fail = (status: number, error: string, ar: string, en: string, extra: Record<string, unknown> = {}) =>
  json({ ok: false, error, ...m(ar, en), ...extra }, status);

async function activeMember(req: Request): Promise<string | null> {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) return null;
  const { data: prof } = await admin.from("profiles").select("status").eq("id", data.user.id).maybeSingle();
  return prof?.status === "active" ? data.user.id : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail(405, "method_not_allowed", "طلب غير صالح.", "Invalid request.");

  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) return fail(503, "not_configured", "ميزة الترجمة والتلخيص غير مفعّلة بعد. بلّغ ممثل المرحلة.", "Translation and summaries aren't switched on yet. Tell your class representative.");

  let r: StudyRequest;
  try {
    r = parseRequest(await req.json());
  } catch (e) {
    if (e instanceof InvalidRequest && e.message === "too_large") {
      return fail(413, "too_large", "هذا الجزء كبير جداً. جرّب ملف أصغر أو صور أوضح بحجم أقل.", "This part is too large. Try a smaller file or lighter photos.");
    }
    return fail(400, "bad_request", "طلب غير صالح.", "Invalid request.");
  }

  let uid: string | null;
  try {
    uid = await activeMember(req);
  } catch (e) {
    console.error("study-ai auth error", e);
    return fail(500, "server_error", "صار خطأ بالخادم. حاول مرة ثانية.", "Server error. Please try again.");
  }
  if (!uid) return fail(401, "unauthorized", "انتهت الجلسة. سجّل دخول مرة ثانية.", "Your session expired. Please sign in again.");

  try {
    // Per-minute pacing first: a busy minute asks the browser to wait, without using up anyone's daily quota.
    if (!(await rateOk("ai:min", GLOBAL_RPM, 60))) {
      return fail(429, "busy", "خدمة Gemini المجانية مزدحمة هسه. راح نعيد المحاولة تلقائياً.", "The free Gemini service is busy. Retrying automatically.", { retry_after: 15 });
    }
    // Every call to Gemini counts here (Google's daily quota counts calls), department first so a used-up department
    // day doesn't also eat into each student's attempts. The student's 20 parts are charged later, once Gemini
    // actually answers, so the retries after a busy model don't use them up.
    if (!(await rateOk("ai:all", GLOBAL_DAILY, 86400))) {
      return fail(429, "global_limit", "خلص الحد اليومي للقسم كله للترجمة والتلخيص. جرّب باچر.", "The department has used today's limit for translations and summaries. Try again tomorrow.");
    }
    if (!(await rateOk(`ai:try:${uid}`, USER_TRIES, 86400))) {
      return fail(429, "user_limit", "حاولت هواية مرات اليوم لأن خدمة Gemini المجانية مزدحمة. كمّل باچر.", "Too many attempts today because the free Gemini service is busy. Continue tomorrow.");
    }
  } catch (e) {
    console.error("study-ai rate error", e);
    return fail(500, "server_error", "صار خطأ بالخادم. حاول مرة ثانية.", "Server error. Please try again.");
  }

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const enc = new TextEncoder();
  let open = true;
  const send = async (o: Record<string, unknown>) => {
    if (!open) return;
    try { await writer.write(enc.encode(JSON.stringify(o) + "\n")); } catch { open = false; }
  };
  const sendFailure = (f: ReturnType<typeof classifyError>) =>
    send({ type: "error", code: f.code, ...m(f.ar, f.en), ...(f.retryAfter ? { retry_after: f.retryAfter } : {}) });

  const work = (async () => {
    const ctrl = new AbortController();
    let timedOut = false;
    const stop = () => ctrl.abort();
    req.signal.addEventListener("abort", stop); // student pressed stop or closed the page
    const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, TIME_LIMIT_MS);
    const ping = setInterval(() => { void send({ type: "ping" }); }, 10_000);
    const t0 = Date.now();
    let model = MODEL;
    let answered = false; // Gemini started answering (thoughts or text)
    try {
      const payload = JSON.stringify(buildRequest(r));
      // The first event is awaited inside the attempt: a stuck model may send headers and then nothing.
      let stream: AsyncIterator<Record<string, unknown>> | null = null;
      let next: IteratorResult<Record<string, unknown>> | null = null;
      for (const name of MODELS) {
        model = name;
        const lastModel = name === MODELS[MODELS.length - 1];
        // Own signal per attempt, so a stuck main model can be dropped without cancelling the whole request.
        const attempt = new AbortController();
        ctrl.signal.addEventListener("abort", () => attempt.abort());
        let stuck = false;
        const wait = lastModel ? undefined : setTimeout(() => { stuck = true; attempt.abort(); }, FIRST_BYTE_MS);
        let res: Response;
        try {
          res = await fetch(`${API}/v1beta/models/${encodeURIComponent(name)}:streamGenerateContent?alt=sse`, {
            method: "POST",
            headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
            body: payload,
            signal: attempt.signal,
          });
          if (res.ok && res.body) {
            stream = sseJson(res.body)[Symbol.asyncIterator]();
            next = await stream.next();
          }
        } catch (e) {
          if (!stuck) throw e;
          console.error("study-ai gemini no answer", name, Date.now() - t0);
          stream = null;
          continue;
        } finally {
          clearTimeout(wait);
        }
        if (stream) break;
        const body = await res.json().catch(() => null);
        const f = classifyError(res.status, body);
        // Always log Gemini's error (status and message only; error bodies don't contain the student's file).
        console.error("study-ai gemini error", name, res.status, f.code, JSON.stringify(body)?.slice(0, 800));
        // Only a busy model is worth trying the next one for; a daily quota, key or input problem stops here.
        if (f.code !== "busy" || lastModel) {
          await sendFailure(f);
          return;
        }
      }
      if (!stream || !next) return;
      answered = true;
      await send({ type: "status", phase: "thinking" });
      let writing = false;
      let firstText: number | undefined;
      let finish: string | undefined;
      let block: string | undefined;
      let usage: Record<string, unknown> | undefined;
      for (; !next.done; next = await stream.next()) {
        const chunk = next.value;
        if (!open) { ctrl.abort(); break; }
        if (chunk.error) {
          const err = chunk.error as { code?: unknown };
          const f = classifyError(typeof err.code === "number" ? err.code : 500, chunk);
          console.error("study-ai gemini stream error", f.code, JSON.stringify(chunk).slice(0, 800));
          await sendFailure(f);
          return;
        }
        const cand = (chunk.candidates as Record<string, unknown>[] | undefined)?.[0];
        const parts = ((cand?.content as { parts?: Record<string, unknown>[] })?.parts) ?? [];
        for (const p of parts) {
          if (p.thought || typeof p.text !== "string" || !p.text) continue;
          if (!writing) {
            // The answer itself has started: only now does this part count towards the student's daily parts
            // (a model that fails while still thinking, which happens under heavy load, costs the student nothing).
            let allowed = true;
            try {
              allowed = await rateOk(`ai:user:${uid}`, USER_DAILY, 86400);
            } catch (e) {
              console.error("study-ai rate error", e); // don't fail a part that is already being answered
            }
            if (!allowed) {
              ctrl.abort();
              await send({ type: "error", code: "user_limit", ...m(`خلصت حصتك اليومية (${USER_DAILY} جزء). تكدر تكمل باچر بنفس الوقت تقريباً.`, `You've used today's limit (${USER_DAILY} parts). You can continue tomorrow at about the same time.`) });
              return;
            }
            writing = true;
            firstText = Date.now() - t0;
            await send({ type: "status", phase: "writing" });
          }
          await send({ type: "delta", text: p.text });
        }
        if (cand?.finishReason) finish = String(cand.finishReason);
        const pf = chunk.promptFeedback as { blockReason?: string } | undefined;
        if (pf?.blockReason) block = pf.blockReason;
        if (chunk.usageMetadata) usage = chunk.usageMetadata as Record<string, unknown>;
      }
      if (!open) return;
      console.log(JSON.stringify({
        fn: "study-ai", task: r.task, model, finish, block, ms: Date.now() - t0, first_text_ms: firstText,
        in: usage?.promptTokenCount, out: usage?.candidatesTokenCount, thoughts: usage?.thoughtsTokenCount,
      }));
      if (!finish && !block) {
        // Gemini always ends with a finishReason; without one the answer was cut off on the way.
        await send({ type: "error", code: "busy", retry_after: 5, ...m("وصلت النتيجة ناقصة. راح نعيد المحاولة.", "The answer arrived incomplete. Retrying.") });
        return;
      }
      const problem = finishProblem(finish, block);
      if (problem) await sendFailure(problem);
      else await send({ type: "done", stop: finish, model });
    } catch (err) {
      if (timedOut) {
        console.error("study-ai time limit", model, answered ? "answering" : "no answer", Date.now() - t0);
        if (answered) {
          await send({ type: "error", code: "too_long", ...m("الجزء طويل، راح نقسمه.", "This part is long; splitting it.") });
        } else {
          // Nothing came back at all: Google is overloaded, and a smaller part wouldn't help.
          await send({ type: "error", code: "busy", retry_after: 30, ...m("خدمة Gemini المجانية ما ردّت بالوقت. راح نعيد المحاولة.", "The free Gemini service didn't answer in time. Retrying.") });
        }
      } else if (open && !req.signal.aborted) {
        console.error("study-ai upstream error", err);
        await send({ type: "error", code: "busy", retry_after: 10, ...m("انقطع الاتصال بخدمة Gemini. راح نعيد المحاولة.", "Lost the connection to Gemini. Retrying.") });
      }
    } finally {
      clearTimeout(timer);
      clearInterval(ping);
      req.signal.removeEventListener("abort", stop);
      open = false;
      try { await writer.close(); } catch { /* client already gone */ }
    }
  })();
  // Keep the worker alive until the stream has been fully forwarded.
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(work);

  return new Response(readable, {
    headers: { ...cors, "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" },
  });
});
