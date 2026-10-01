// Study assistant: translates or summarises one part of a handout with Claude and streams the result back.
// The browser splits big files into small parts and calls this once per part (see web/src/sb/study/run.js).
//
// Request:  POST, Authorization: Bearer <student access token>, JSON body (see prompts.ts → parseRequest).
// Response: errors before streaming are JSON {ok:false, error, message, message_en} with a 4xx/5xx status.
//           Otherwise newline-delimited JSON events:
//             {"type":"status","phase":"thinking"|"writing"|"fallback"}   progress
//             {"type":"delta","text":"..."}                                output text (Markdown, or JSON for "study")
//             {"type":"ping"}                                              keep-alive every 10 s
//             {"type":"done","stop":"end_turn"}                            finished
//             {"type":"error","code":"...","message":"...","message_en":"..."}
import Anthropic from "npm:@anthropic-ai/sdk@0.129.0";
import { admin, cors, json, m, rateOk } from "../_shared/common.ts";
import { InvalidRequest, parseRequest, settingsText, STUDY_SYSTEM, studySchema, TRANSLATE_SYSTEM, type StudyRequest } from "./prompts.ts";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

const env = (k: string, fallback: string) => Deno.env.get(k) || fallback;
const MODEL = env("AI_MODEL", "claude-opus-5-5");
// Calls (parts) each student may make per 24 h, and for the whole department per 24 h. Each call is a few pages.
const USER_DAILY = Number(env("AI_USER_DAILY", "120"));
const GLOBAL_DAILY = Number(env("AI_GLOBAL_DAILY", "1500"));
// Stop a call a little before the platform's wall-clock limit (150 s on the free plan, 400 s on paid plans),
// so the browser gets a clean "too_long" and retries with a smaller part instead of a dropped connection.
const TIME_LIMIT_MS = Number(env("AI_TIME_LIMIT_SEC", "135")) * 1000;
// "default" retries a request on Anthropic's recommended model if the requested one declines it
// (Claude Opus 5.5 has a biology classifier that can misfire on life-science handouts). "off" disables it.
const FALLBACKS = env("AI_FALLBACKS", "default");

let client: Anthropic | null = null;
function anthropic(): Anthropic | null {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return null;
  client ??= new Anthropic({ apiKey: key, maxRetries: 1 });
  return client;
}

const fail = (status: number, error: string, ar: string, en: string) => json({ ok: false, error, ...m(ar, en) }, status);

async function activeMember(req: Request): Promise<string | null> {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) return null;
  const { data: prof } = await admin.from("profiles").select("status").eq("id", data.user.id).maybeSingle();
  return prof?.status === "active" ? data.user.id : null;
}

function buildParams(r: StudyRequest) {
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  let n = r.start;
  for (const p of r.pieces) {
    if (p.kind === "pdf") {
      content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: p.data } });
    } else if (p.kind === "image") {
      content.push({ type: "text", text: `Image ${n++}:` });
      content.push({ type: "image", source: { type: "base64", media_type: p.media, data: p.data } });
    } else {
      content.push({ type: "document", source: { type: "text", media_type: "text/plain", data: p.text } });
    }
  }
  content.push({ type: "text", text: `<settings>\n${settingsText(r)}\n</settings>` });

  const study = r.task === "study";
  return {
    model: MODEL,
    max_tokens: 32000,
    system: [{ type: "text" as const, text: study ? STUDY_SYSTEM : TRANSLATE_SYSTEM, cache_control: { type: "ephemeral" as const } }],
    messages: [{ role: "user" as const, content }],
    // Translation is close to mechanical, so it runs light; question writing gets more thinking so answers are checked.
    output_config: study
      ? { effort: "medium" as const, format: { type: "json_schema" as const, schema: studySchema(r.formats) } }
      : { effort: "low" as const },
    ...(FALLBACKS === "off" ? {} : { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }),
  };
}

// Map SDK errors to a code the browser understands. Retryable: busy, server. Not retryable: bad_input, not_configured.
function classify(err: unknown): { code: string; ar: string; en: string } {
  if (err instanceof Anthropic.RateLimitError || err instanceof Anthropic.InternalServerError || err instanceof Anthropic.APIConnectionError) {
    return { code: "busy", ar: "الخدمة مشغولة حالياً. راح نعيد المحاولة.", en: "The service is busy. Retrying." };
  }
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return { code: "not_configured", ar: "مفتاح خدمة الذكاء الاصطناعي غير صالح. بلّغ ممثل المرحلة.", en: "The AI service key is invalid. Tell your class representative." };
  }
  if (err instanceof Anthropic.BadRequestError) {
    return { code: "bad_input", ar: "ما كدرنا نقرأ هذا الجزء من الملف (ممكن يكون محمي أو تالف).", en: "This part of the file couldn't be read (it may be protected or damaged)." };
  }
  return { code: "server", ar: "صار خطأ أثناء المعالجة.", en: "Something went wrong while processing." };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail(405, "method_not_allowed", "طلب غير صالح.", "Invalid request.");

  const ai = anthropic();
  if (!ai) return fail(503, "not_configured", "ميزة الترجمة والتلخيص غير مفعّلة بعد. بلّغ ممثل المرحلة.", "Translation and summaries aren't switched on yet. Tell your class representative.");

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
    // Department limit first, so a day when it is used up doesn't also eat into each student's own quota.
    if (!(await rateOk("ai:all", GLOBAL_DAILY, 86400))) {
      return fail(429, "global_limit", "وصل القسم للحد اليومي للترجمة والتلخيص. جرّب باچر.", "The department has reached today's limit. Try again tomorrow.");
    }
    if (!(await rateOk(`ai:user:${uid}`, USER_DAILY, 86400))) {
      return fail(429, "user_limit", "وصلت الحد اليومي للترجمة والتلخيص. جرّب باچر.", "You've reached today's limit for translations and summaries. Try again tomorrow.");
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

  const work = (async () => {
    const stream = ai.beta.messages.stream(buildParams(r));
    let timedOut = false;
    const stop = () => stream.abort();
    req.signal.addEventListener("abort", stop); // student pressed stop or closed the page: stop paying for tokens
    const timer = setTimeout(() => { timedOut = true; stream.abort(); }, TIME_LIMIT_MS);
    const ping = setInterval(() => { void send({ type: "ping" }); }, 10_000);
    const t0 = Date.now();
    try {
      for await (const ev of stream) {
        if (!open) { stream.abort(); break; }
        if (ev.type === "content_block_start") {
          const t = ev.content_block.type;
          if (t === "thinking" || t === "redacted_thinking") await send({ type: "status", phase: "thinking" });
          else if (t === "text") await send({ type: "status", phase: "writing" });
          else if (t === "fallback") await send({ type: "status", phase: "fallback" });
        } else if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
          await send({ type: "delta", text: ev.delta.text });
        }
      }
      if (!open) return;
      const final = await stream.finalMessage();
      console.log(JSON.stringify({
        fn: "study-ai", task: r.task, model: final.model, stop: final.stop_reason, ms: Date.now() - t0,
        in: final.usage.input_tokens, cache_read: final.usage.cache_read_input_tokens, out: final.usage.output_tokens,
      }));
      if (final.stop_reason === "refusal") {
        await send({ type: "error", code: "refused", ...m("ما كدرنا نعالج هذا الجزء من الملف.", "This part of the file couldn't be processed.") });
      } else if (final.stop_reason === "max_tokens") {
        await send({ type: "error", code: "too_long", ...m("الجزء طويل، راح نقسمه.", "This part is long; splitting it.") });
      } else {
        await send({ type: "done", stop: final.stop_reason });
      }
    } catch (err) {
      if (timedOut) {
        await send({ type: "error", code: "too_long", ...m("الجزء طويل، راح نقسمه.", "This part is long; splitting it.") });
      } else if (open && !req.signal.aborted) {
        const c = classify(err);
        if (c.code !== "busy" && c.code !== "bad_input") console.error("study-ai upstream error", err);
        await send({ type: "error", code: c.code, ...m(c.ar, c.en) });
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
