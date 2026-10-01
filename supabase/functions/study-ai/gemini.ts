// Gemini API (Google AI Studio) adapter for the study assistant: request body, stream parsing and error mapping.
// Uses the stateless generateContent REST API (streamGenerateContent?alt=sse), so nothing about a student's file
// is kept on Google's side between requests. Reference: https://ai.google.dev/api/generate-content
import { settingsText, STUDY_SYSTEM, studySchema, TRANSLATE_SYSTEM, type StudyRequest } from "./prompts.ts";

type Part = { text: string } | { inlineData: { mimeType: string; data: string } };

export function buildRequest(r: StudyRequest) {
  const parts: Part[] = [];
  let n = r.start;
  for (const p of r.pieces) {
    if (p.kind === "pdf") parts.push({ inlineData: { mimeType: "application/pdf", data: p.data } });
    else if (p.kind === "image") {
      parts.push({ text: `Image ${n++}:` });
      parts.push({ inlineData: { mimeType: p.media, data: p.data } });
    } else parts.push({ text: `<document>\n${p.text}\n</document>` });
  }
  parts.push({ text: `<settings>\n${settingsText(r)}\n</settings>` });

  const study = r.task === "study";
  return {
    systemInstruction: { parts: [{ text: study ? STUDY_SYSTEM : TRANSLATE_SYSTEM }] },
    contents: [{ role: "user", parts }],
    generationConfig: {
      maxOutputTokens: 32768,
      // Translation is close to mechanical, so it thinks little; question writing thinks more so answers get checked.
      // (Gemini 3.8 Flash accepts LOW / MEDIUM / HIGH; MINIMAL is rejected.) Thought summaries are streamed (and
      // skipped by index.ts) so a working model answers within seconds; index.ts relies on that to spot a stuck one.
      thinkingConfig: { thinkingLevel: study ? "MEDIUM" : "LOW", includeThoughts: true },
      ...(study ? { responseMimeType: "application/json", responseJsonSchema: studySchema(r.formats) } : {}),
    },
  };
}

/* ---------------------------------------------------------------- streaming */

// Server-sent events → parsed JSON payloads of the "data:" lines.
export async function* sseJson(body: ReadableStream<Uint8Array>): AsyncGenerator<Record<string, unknown>> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const flush = function* (block: string) {
    const data = block.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trimStart()).join("\n");
    if (!data || data === "[DONE]") return;
    try { yield JSON.parse(data); } catch { /* ignore a malformed event */ }
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true }).replace(/\r/g, "");
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        yield* flush(buf.slice(0, i));
        buf = buf.slice(i + 2);
      }
    }
    if (buf.trim()) yield* flush(buf);
  } finally {
    reader.releaseLock();
  }
}

/* ---------------------------------------------------------------- errors */

export type Failure = { code: string; ar: string; en: string; retryAfter?: number; log?: boolean };

const BUSY = { ar: "خدمة Gemini المجانية مزدحمة هسه. راح نعيد المحاولة تلقائياً.", en: "The free Gemini service is busy. Retrying automatically." };
const DAILY = {
  ar: "خلصت الحصة المجانية اليومية لخدمة Gemini للقسم. ترجع تشتغل بعد منتصف الليل بتوقيت كاليفورنيا (حوالي الساعة 10 أو 11 الصبح بتوقيت بغداد).",
  en: "The department's free daily Gemini quota is used up. It resets at midnight Pacific time (about 10–11 am in Baghdad).",
};
const NOT_CONFIGURED = { ar: "إعدادات خدمة Gemini غير صحيحة (المفتاح أو اسم الموديل). بلّغ ممثل المرحلة.", en: "The Gemini service isn't set up correctly (key or model name). Tell your class representative." };

// "33s" / "1.5s" → whole seconds.
function seconds(v: unknown): number | undefined {
  const m = /^(\d+(?:\.\d+)?)s$/.exec(String(v ?? ""));
  return m ? Math.ceil(Number(m[1])) : undefined;
}

// Map a Gemini error (HTTP status + JSON body, or an error object inside the stream) to what the browser needs.
// A per-minute 429 is retried after a wait; a per-day 429 stops the job, because nothing will work until the reset.
export function classifyError(status: number, body: unknown): Failure {
  const e = ((body as { error?: Record<string, unknown> })?.error ?? {}) as Record<string, unknown>;
  const message = String(e.message ?? "");
  const state = String(e.status ?? "");
  const code = typeof e.code === "string" ? e.code : "";
  const details = Array.isArray(e.details) ? e.details as Record<string, unknown>[] : [];
  const typed = (suffix: string) => details.filter((d) => String(d["@type"] ?? "").endsWith(suffix));
  const retryAfter = typed("RetryInfo").map((d) => seconds(d.retryDelay)).find((s) => s !== undefined);
  const quotaIds = typed("QuotaFailure").flatMap((d) => (Array.isArray(d.violations) ? d.violations : []) as Record<string, unknown>[])
    .map((v) => `${v.quotaId ?? ""} ${v.quotaMetric ?? ""}`);
  const daily = code === "quota_exceeded" || quotaIds.some((q) => /per ?day|perday|daily/i.test(q)) || /per day|daily quota|perday/i.test(message);
  const keyProblem = details.some((d) => /API_KEY_INVALID|API_KEY_EXPIRED/.test(String(d.reason ?? ""))) || /api key (not valid|expired|invalid)/i.test(message);

  if (status === 429 || state === "RESOURCE_EXHAUSTED") {
    return daily ? { code: "daily_quota", ...DAILY } : { code: "busy", retryAfter: retryAfter ?? 20, ...BUSY };
  }
  if (status === 500 || status === 502 || status === 503 || status === 504 || state === "UNAVAILABLE" || state === "INTERNAL") {
    return { code: "busy", retryAfter: retryAfter ?? 10, ...BUSY };
  }
  if (status === 401 || status === 403 || status === 404 || keyProblem) return { code: "not_configured", log: true, ...NOT_CONFIGURED };
  if (state === "FAILED_PRECONDITION" || /location is not supported|not available in your country/i.test(message)) {
    return {
      code: "not_configured", log: true,
      ar: "خدمة Gemini المجانية غير متاحة من موقع الخادم حالياً. بلّغ ممثل المرحلة.",
      en: "The free Gemini service isn't available from the server's location. Tell your class representative.",
    };
  }
  if (status === 400) {
    return { code: "bad_input", ar: "ما كدرنا نقرأ هذا الجزء من الملف (ممكن يكون محمي أو تالف).", en: "This part of the file couldn't be read (it may be protected or damaged)." };
  }
  return { code: "server", log: true, ar: "صار خطأ أثناء المعالجة.", en: "Something went wrong while processing." };
}

// After the stream ends: did the model finish normally? (finishReason / promptFeedback.blockReason)
export function finishProblem(finishReason: string | undefined, blockReason: string | undefined): Failure | null {
  if (blockReason) return { code: "refused", ar: "ما كدرنا نعالج هذا الجزء من الملف.", en: "This part of the file couldn't be processed." };
  if (!finishReason || finishReason === "STOP" || finishReason === "FINISH_REASON_UNSPECIFIED") return null;
  if (finishReason === "MAX_TOKENS") return { code: "too_long", ar: "الجزء طويل، راح نقسمه.", en: "This part is long; splitting it." };
  if (finishReason === "RECITATION") {
    return { code: "refused", ar: "Gemini ما رضى يكمل هذا الجزء لأن النص منقول حرفياً من مصدر منشور.", en: "Gemini stopped this part because the text matches a published source." };
  }
  if (["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "LANGUAGE", "OTHER"].includes(finishReason)) {
    return { code: "refused", ar: "ما كدرنا نعالج هذا الجزء من الملف.", en: "This part of the file couldn't be processed." };
  }
  return { code: "server", ar: "صار خطأ أثناء المعالجة.", en: "Something went wrong while processing." };
}
