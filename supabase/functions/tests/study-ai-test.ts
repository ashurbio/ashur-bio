// Tests for the study-ai edge function: unit tests for prompts.ts and gemini.ts, and integration tests that run the
// real index.ts against a fake Supabase (auth + REST) and a fake Gemini API, so no keys or network are needed.
//
//   deno test --allow-net --allow-env --allow-run --allow-read supabase/functions/tests/study-ai-test.ts
import { assert, assertEquals, assertMatch, assertThrows } from "jsr:@std/assert@1";
import { FORMATS, InvalidRequest, parseRequest, settingsText, studySchema } from "../study-ai/prompts.ts";
import { buildRequest, classifyError, finishProblem, sseJson } from "../study-ai/gemini.ts";

const PDF = btoa("%PDF-1.4 fake");

/* ---------------- prompts.ts ---------------- */

Deno.test("parseRequest: defaults and canonical format order", () => {
  const r = parseRequest({ task: "study", formats: ["mcq", "summary", "mcq"], pieces: [{ kind: "pdf", data: PDF }], start: 5, count: 2, total: 30 });
  assertEquals(r.formats, ["summary", "mcq"]);
  assertEquals([r.depth, r.lang, r.numbering, r.start, r.count, r.total], ["standard", "ar", "page", 5, 2, 30]);
});

Deno.test("parseRequest: rejects bad input", () => {
  const bad = [
    null,
    { task: "hack", pieces: [{ kind: "pdf", data: PDF }] },
    { task: "study", formats: [], pieces: [{ kind: "pdf", data: PDF }] },
    { task: "study", formats: ["poem"], pieces: [{ kind: "pdf", data: PDF }] },
    { task: "translate", pieces: [] },
    { task: "translate", pieces: [{ kind: "pdf", data: "not base64!" }] },
    { task: "translate", pieces: [{ kind: "pdf", data: PDF }, { kind: "pdf", data: PDF }] },
    { task: "translate", pieces: [{ kind: "image", media: "image/svg+xml", data: PDF }] },
    { task: "translate", pieces: [{ kind: "text", text: "  " }] },
    { task: "translate", pieces: [{ kind: "pdf", data: PDF }], start: 0 },
    { task: "translate", pieces: [{ kind: "pdf", data: PDF }], start: 4, count: 2, total: 3 },
  ];
  for (const b of bad) assertThrows(() => parseRequest(b), InvalidRequest);
  assertThrows(() => parseRequest({ task: "translate", pieces: [{ kind: "text", text: "x".repeat(60_001) }] }), InvalidRequest, "too_large");
});

Deno.test("studySchema: only requested formats, strict objects", () => {
  const s = studySchema(["summary", "mcq"]) as { properties: Record<string, unknown>; required: string[]; additionalProperties: boolean };
  assertEquals(Object.keys(s.properties), ["topic", "summary", "mcq", "notes"]);
  assertEquals(s.required, ["topic", "summary", "mcq", "notes"]);
  assertEquals(s.additionalProperties, false);
  const walk = (n: unknown): void => {
    if (!n || typeof n !== "object") return;
    const o = n as Record<string, unknown>;
    if (o.type === "object") {
      assertEquals(o.additionalProperties, false);
      assertEquals((o.required as string[]).sort(), Object.keys(o.properties as object).sort());
    }
    Object.values(o).forEach(walk);
  };
  walk(studySchema([...FORMATS]));
});

Deno.test("settingsText: page markers and ranges", () => {
  const t = settingsText(parseRequest({ task: "translate", target: "ar", pieces: [{ kind: "pdf", data: PDF }], start: 5, count: 2, total: 30 }));
  assertMatch(t, /into Arabic/);
  assertMatch(t, /pages 5-6 of a file with 30 pages/);
  assertMatch(t, /--- صفحة N ---/);
  const s = settingsText(parseRequest({ task: "study", formats: ["lists"], lang: "both", depth: "full", numbering: "image", pieces: [{ kind: "image", data: PDF }], start: 3, count: 1, total: 9 }));
  assertMatch(s, /image 3 of a file with 9 images/);
  assertMatch(s, /Bilingual/);
  assertMatch(s, /Comprehensive/);
});

/* ---------------- gemini.ts ---------------- */

Deno.test("buildRequest: translate — PDF inline, low thinking, plain text", () => {
  const body = buildRequest(parseRequest({ task: "translate", pieces: [{ kind: "pdf", data: PDF }], start: 1, count: 2, total: 2 }));
  assertEquals(body.contents[0].role, "user");
  assertEquals(body.contents[0].parts[0], { inlineData: { mimeType: "application/pdf", data: PDF } });
  assertMatch((body.contents[0].parts.at(-1) as { text: string }).text, /<settings>/);
  assertMatch(body.systemInstruction.parts[0].text, /academic translator/);
  assertEquals(body.generationConfig.thinkingConfig, { thinkingLevel: "LOW", includeThoughts: true });
  assert(!("responseMimeType" in body.generationConfig));
});

Deno.test("buildRequest: study — JSON schema, medium thinking, images labelled", () => {
  const body = buildRequest(parseRequest({ task: "study", formats: ["mcq"], numbering: "image", start: 3, count: 2, total: 5,
    pieces: [{ kind: "image", media: "image/jpeg", data: PDF }, { kind: "image", media: "image/png", data: PDF }] }));
  const g = body.generationConfig as Record<string, unknown>;
  assertEquals(g.responseMimeType, "application/json");
  assertEquals(Object.keys((g.responseJsonSchema as { properties: object }).properties), ["topic", "mcq", "notes"]);
  assertEquals(g.thinkingConfig, { thinkingLevel: "MEDIUM", includeThoughts: true });
  const parts = body.contents[0].parts as Record<string, unknown>[];
  assertEquals(parts[0], { text: "Image 3:" });
  assertEquals(parts[3], { inlineData: { mimeType: "image/png", data: PDF } });
});

Deno.test("sseJson: parses data lines across chunk boundaries and CRLF", async () => {
  const raw = 'data: {"a":1}\r\n\r\ndata: {"b":\n\ndata: {"c":3}\n\n'; // middle event is malformed and skipped
  const bytes = new TextEncoder().encode(raw);
  const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes.slice(0, 7)); c.enqueue(bytes.slice(7)); c.close(); } });
  const out = [];
  for await (const x of sseJson(stream)) out.push(x);
  assertEquals(out, [{ a: 1 }, { c: 3 }]);
});

const quota = (quotaId: string, retry?: string) => ({
  error: {
    code: 429, status: "RESOURCE_EXHAUSTED", message: "You exceeded your current quota.",
    details: [
      { "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaMetric: "generativelanguage.googleapis.com/generate_content_free_tier_requests", quotaId }] },
      ...(retry ? [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: retry }] : []),
    ],
  },
});

Deno.test("classifyError: per-minute 429 waits, per-day 429 stops", () => {
  const minute = classifyError(429, quota("GenerateRequestsPerMinutePerProjectPerModel-FreeTier", "33s"));
  assertEquals([minute.code, minute.retryAfter], ["busy", 33]);
  assertEquals(classifyError(429, quota("GenerateRequestsPerMinutePerProjectPerModel-FreeTier")).retryAfter, 20);
  const day = classifyError(429, quota("GenerateRequestsPerDayPerProjectPerModel-FreeTier", "40s"));
  assertEquals(day.code, "daily_quota");
  assertMatch(day.ar, /بتوقيت بغداد/);
  assertEquals(classifyError(429, { error: { code: "quota_exceeded", message: "daily quota" } }).code, "daily_quota");
});

Deno.test("classifyError: server, key, region and input problems", () => {
  assertEquals(classifyError(503, { error: { code: 503, status: "UNAVAILABLE" } }).code, "busy");
  assertEquals(classifyError(400, { error: { code: 400, status: "INVALID_ARGUMENT", message: "API key not valid. Please pass a valid API key.", details: [{ reason: "API_KEY_INVALID" }] } }).code, "not_configured");
  assertEquals(classifyError(404, { error: { code: 404, message: "models/gemini-x is not found" } }).code, "not_configured");
  assertMatch(classifyError(400, { error: { code: 400, status: "FAILED_PRECONDITION", message: "User location is not supported for the API use." } }).ar, /موقع الخادم/);
  assertEquals(classifyError(400, { error: { code: 400, status: "INVALID_ARGUMENT", message: "The document has no pages." } }).code, "bad_input");
});

Deno.test("finishProblem: finish reasons", () => {
  assertEquals(finishProblem("STOP", undefined), null);
  assertEquals(finishProblem("MAX_TOKENS", undefined)?.code, "too_long");
  assertEquals(finishProblem("SAFETY", undefined)?.code, "refused");
  assertEquals(finishProblem("RECITATION", undefined)?.code, "refused");
  assertEquals(finishProblem(undefined, "PROHIBITED_CONTENT")?.code, "refused");
});

/* ---------------- integration: real index.ts against fakes ---------------- */

type Seen = { url: string; key: string | null; body: Record<string, any> };
const seen: Seen[] = [];
type Mode = "ok" | "json" | "safety" | "blocked" | "max_tokens" | "minute" | "daily" | "unavailable" | "badkey" | "slow" | "cut" | "stream_error"
  | "primary_busy" | "primary_hang" | "primary_silent" | "hang" | "thinking_then_503"
  | "primary_daily" | "primary_404" | "primary_thinking_503";
let mode: Mode = "ok";
let denyKey = ""; // rate_hit answers false for keys starting with this
const rateKeys: string[] = []; // every key rate_hit was asked about

const sse = (chunks: unknown[]) => chunks.map((c) => `data: ${JSON.stringify(c)}\r\n\r\n`).join("");
function answer(text: string, finishReason: string | null = "STOP") {
  const half = Math.ceil(text.length / 2);
  const chunk = (t: string, extra: Record<string, unknown> = {}) => ({ candidates: [{ content: { role: "model", parts: [{ text: t }] }, ...extra }], modelVersion: "gemini-3.8-flash" });
  return [
    // Thought summary first, as Gemini sends with includeThoughts; it must never reach the student.
    { candidates: [{ content: { role: "model", parts: [{ text: "**Reading the page**\nThinking...", thought: true }] } }] },
    chunk(text.slice(0, half)),
    chunk(text.slice(half), finishReason ? { finishReason } : {}),
    ...(finishReason ? [{ candidates: [], usageMetadata: { promptTokenCount: 600, candidatesTokenCount: 40, thoughtsTokenCount: 120 } }] : []),
  ];
}

const fake = Deno.serve({ port: 8787, onListen() {} }, async (req) => {
  const url = new URL(req.url);
  const j = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
  // --- Supabase
  if (url.pathname === "/auth/v1/user") {
    const tok = req.headers.get("authorization");
    if (tok === "Bearer good" || tok === "Bearer disabled") return j({ id: tok === "Bearer good" ? "u1" : "u2", aud: "authenticated", role: "authenticated" });
    return j({ code: 401, msg: "invalid JWT" }, 401);
  }
  if (url.pathname === "/rest/v1/profiles") return j(url.searchParams.get("id") === "eq.u1" ? { status: "active" } : { status: "disabled" });
  if (url.pathname === "/rest/v1/rpc/rate_hit") {
    const { p_key } = await req.json();
    rateKeys.push(String(p_key));
    return j(!(denyKey && String(p_key).startsWith(denyKey)));
  }
  // --- Gemini
  if (url.pathname.startsWith("/v1beta/models/")) {
    seen.push({ url: url.pathname + url.search, key: req.headers.get("x-goog-api-key"), body: await req.json() });
    const headers = { "content-type": "text/event-stream" };
    const primary = url.pathname.includes("gemini-3.8-flash");
    // Gemini's real "high demand" answer
    const overloaded = () => j({ error: { code: 503, status: "UNAVAILABLE", message: "This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later." } }, 503);
    const fallbackAnswer = () => new Response(sse(answer("--- صفحة 5 ---\nمن النموذج البديل")), { headers });
    // Stuck in Google's queue: no answer and no error until the caller gives up.
    // (Ends by itself after a while so the fake server can shut down.)
    const hang = () => new Promise<Response>((resolve) => setTimeout(() => resolve(j({}, 504)), 3000));
    // Headers, then nothing.
    const silent = () => new Response(new ReadableStream({ start(c) { setTimeout(() => { try { c.close(); } catch { /* gone */ } }, 3000); } }), { headers });
    const thinkingThen503 = () => new Response(sse([answer("x")[0], { error: { code: 503, status: "UNAVAILABLE", message: "This model is currently experiencing high demand." } }]), { headers });
    if (mode === "primary_busy") return primary ? overloaded() : fallbackAnswer();
    if (mode === "primary_daily") return primary ? j(quota("GenerateRequestsPerDayPerProjectPerModel-FreeTier", "26s"), 429) : fallbackAnswer();
    if (mode === "primary_404") return primary ? j({ error: { code: 404, status: "NOT_FOUND", message: "models/x is not found" } }, 404) : fallbackAnswer();
    if (mode === "primary_thinking_503") return primary ? thinkingThen503() : fallbackAnswer();
    if (mode === "primary_hang") return primary ? hang() : fallbackAnswer();
    if (mode === "primary_silent") return primary ? silent() : fallbackAnswer();
    if (mode === "hang") return hang();
    switch (mode) {
      case "minute": return j(quota("GenerateRequestsPerMinutePerProjectPerModel-FreeTier", "33s"), 429);
      case "daily": return j(quota("GenerateRequestsPerDayPerProjectPerModel-FreeTier"), 429);
      case "unavailable": return overloaded();
      case "badkey": return j({ error: { code: 400, status: "INVALID_ARGUMENT", message: "API key not valid.", details: [{ reason: "API_KEY_INVALID" }] } }, 400);
      case "safety": return new Response(sse(answer("", "SAFETY")), { headers });
      case "blocked": return new Response(sse([{ promptFeedback: { blockReason: "PROHIBITED_CONTENT" } }]), { headers });
      case "max_tokens": return new Response(sse(answer("--- صفحة 5 ---\nنص طويل", "MAX_TOKENS")), { headers });
      case "cut": return new Response(sse(answer("--- صفحة 5 ---\nنص", null)), { headers });
      // Seen for real under heavy load: thoughts stream, then a 503 inside the stream before any answer text.
      case "thinking_then_503": return thinkingThen503();
      case "stream_error": return new Response(sse([...answer("--- صفحة", null).slice(0, 2), { error: { code: 503, status: "UNAVAILABLE", message: "overloaded" } }]), { headers });
      case "slow": {
        const stream = new ReadableStream({
          async start(c) {
            c.enqueue(new TextEncoder().encode(sse(answer("x", null).slice(0, 1))));
            await new Promise((r) => setTimeout(r, 5000));
            try { c.close(); } catch { /* aborted */ }
          },
        });
        return new Response(stream, { headers });
      }
      case "json": return new Response(sse(answer(JSON.stringify({ topic: "Cell", summary: [], mcq: [], notes: [] }))), { headers });
      default: return new Response(sse(answer("--- صفحة 5 ---\n# الخلية (Cell)")), { headers });
    }
  }
  return j({ message: "not found" }, 404);
});

async function startFn(extraEnv: Record<string, string> = {}) {
  const proc = new Deno.Command(Deno.execPath(), {
    args: ["run", "--allow-net", "--allow-env", "--allow-read", "--no-prompt", new URL("../study-ai/index.ts", import.meta.url).pathname],
    env: {
      SUPABASE_URL: "http://127.0.0.1:8787", SUPABASE_SERVICE_ROLE_KEY: "service", GEMINI_BASE_URL: "http://127.0.0.1:8787",
      GEMINI_API_KEY: "test-key", ...extraEnv,
    },
    stdout: "piped", stderr: "piped",
  }).spawn();
  for (let i = 0; i < 200; i++) {
    try { await fetch("http://127.0.0.1:8000/", { method: "OPTIONS" }).then((r) => r.body?.cancel()); return proc; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error("function did not start");
}
async function stopFn(proc: Deno.ChildProcess) {
  proc.kill();
  await proc.status;
  await proc.stdout.cancel();
  await proc.stderr.cancel();
}

async function call(body: unknown, token = "good") {
  const res = await fetch("http://127.0.0.1:8000/", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
  const text = await res.text();
  const ct = res.headers.get("content-type") || "";
  const events = ct.includes("ndjson") ? text.trim().split("\n").map((l) => JSON.parse(l)) : [];
  return { status: res.status, json: ct.includes("application/json") ? JSON.parse(text) : null, events };
}
const last = (r: { events: Record<string, unknown>[] }) => r.events.at(-1) as Record<string, unknown>;

const translateBody = { task: "translate", target: "ar", pieces: [{ kind: "pdf", data: PDF }], start: 5, count: 2, total: 30 };

Deno.test({ name: "integration: auth, limits, streaming, errors", sanitizeOps: false, sanitizeResources: false }, async (t) => {
  const proc = await startFn({ AI_TIME_LIMIT_SEC: "2", AI_FIRST_BYTE_SEC: "0.5" });
  try {
    await t.step("rejects missing/invalid/disabled users", async () => {
      assertEquals((await call(translateBody, "nope")).status, 401);
      assertEquals((await call(translateBody, "disabled")).status, 401);
    });
    await t.step("rejects bad requests before calling Gemini", async () => {
      const n = seen.length;
      const r = await call({ task: "translate", pieces: [] });
      assertEquals(r.status, 400);
      assertEquals(r.json.error, "bad_request");
      assertEquals(seen.length, n);
    });
    await t.step("department per-minute pacing → busy with retry_after, nothing sent to Gemini", async () => {
      denyKey = "ai:min";
      const n = seen.length;
      const r = await call(translateBody);
      denyKey = "";
      assertEquals([r.status, r.json.error, r.json.retry_after], [429, "busy", 15]);
      assertEquals(seen.length, n);
    });
    await t.step("daily limits: department and student attempts stop before Gemini, with Arabic messages", async () => {
      const n = seen.length;
      denyKey = "ai:all";
      let r = await call(translateBody);
      assertEquals([r.status, r.json.error], [429, "global_limit"]);
      assertMatch(r.json.message, /الحد اليومي للقسم/);
      denyKey = "ai:try:";
      r = await call(translateBody);
      assertEquals([r.status, r.json.error], [429, "user_limit"]);
      assertMatch(r.json.message, /حاولت هواية مرات اليوم/);
      denyKey = "";
      assertEquals(seen.length, n);
    });
    await t.step("student's 20 parts: charged once Gemini answers, so a used-up day stops the part", async () => {
      mode = "ok";
      denyKey = "ai:user:";
      const r = await call(translateBody);
      denyKey = "";
      assertEquals(r.status, 200);
      assertEquals(r.events.filter((e) => e.type === "delta").length, 0); // nothing of the answer is shown
      assertEquals(last(r).code, "user_limit");
      assertMatch(String(last(r).message), /خلصت حصتك اليومية \(20 جزء\)/);
    });
    await t.step("a busy model doesn't use up the student's parts; an answered part uses one", async () => {
      for (const m of ["unavailable", "thinking_then_503"] as const) {
        mode = m;
        const k = rateKeys.length;
        assertEquals(last(await call(translateBody)).code, "busy", m);
        assertEquals(rateKeys.slice(k), ["ai:min", "ai:all", "ai:try:u1"], m);
      }
      mode = "ok";
      const k = rateKeys.length;
      assertEquals(last(await call(translateBody)).type, "done");
      assertEquals(rateKeys.slice(k), ["ai:min", "ai:all", "ai:try:u1", "ai:user:u1"]);
    });
    await t.step("translate streams deltas and sends the right Gemini request", async () => {
      mode = "ok";
      const r = await call(translateBody);
      assertEquals(r.status, 200);
      const text = r.events.filter((e) => e.type === "delta").map((e) => e.text).join("");
      assertEquals(text, "--- صفحة 5 ---\n# الخلية (Cell)");
      assertEquals(last(r), { type: "done", stop: "STOP", model: "gemini-3.8-flash" });
      assert(r.events.some((e) => e.type === "status" && e.phase === "writing"));
      const req = seen.at(-1)!;
      assertEquals(req.url, "/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse");
      assertEquals(req.key, "test-key");
      assertEquals(req.body.contents[0].parts[0].inlineData.mimeType, "application/pdf");
      assertEquals(req.body.generationConfig.thinkingConfig.thinkingLevel, "LOW");
      assertMatch(req.body.contents[0].parts.at(-1).text, /pages 5-6 of a file with 30 pages/);
    });
    await t.step("study asks for JSON with only the chosen formats", async () => {
      mode = "json";
      const r = await call({ task: "study", formats: ["mcq", "summary"], pieces: [{ kind: "text", text: "Cells are..." }], numbering: "part", start: 1, count: 1, total: 1 });
      const text = r.events.filter((e) => e.type === "delta").map((e) => e.text).join("");
      assertEquals(JSON.parse(text).topic, "Cell");
      const g = seen.at(-1)!.body.generationConfig;
      assertEquals(g.responseMimeType, "application/json");
      assertEquals(Object.keys(g.responseJsonSchema.properties), ["topic", "summary", "mcq", "notes"]);
      assertEquals(g.thinkingConfig.thinkingLevel, "MEDIUM");
    });
    await t.step("main model busy, used up, unknown, or failing while thinking → same part answered by the next model", async () => {
      for (const m of ["primary_busy", "primary_daily", "primary_404", "primary_thinking_503"] as const) {
        mode = m;
        const n = seen.length;
        const r = await call(translateBody);
        assertEquals(last(r), { type: "done", stop: "STOP", model: "gemini-3.7-flash" }, m);
        assertEquals(seen.slice(n).map((x) => x.url.split(":")[0]), ["/v1beta/models/gemini-3.8-flash", "/v1beta/models/gemini-3.7-flash"], m);
        assertEquals(seen.at(-1)!.body, seen.at(-2)!.body); // same request, only the model changes
        assertEquals(r.events.filter((e) => e.type === "delta").map((e) => e.text).join(""), "--- صفحة 5 ---\nمن النموذج البديل");
      }
    });
    await t.step("main model stuck (no answer, or headers then nothing) → fallback model after AI_FIRST_BYTE_SEC", async () => {
      for (const m of ["primary_hang", "primary_silent"] as const) {
        mode = m;
        const n = seen.length;
        const t0 = Date.now();
        const r = await call(translateBody);
        assertEquals(last(r), { type: "done", stop: "STOP", model: "gemini-3.7-flash" }, m);
        assertEquals(seen.slice(n).map((x) => x.url.split(":")[0]), ["/v1beta/models/gemini-3.8-flash", "/v1beta/models/gemini-3.7-flash"]);
        assert(Date.now() - t0 < 1900, `${m} should not wait for the whole time limit`);
      }
    });
    await t.step("nothing answers before the time limit → busy (retry), not too_long", async () => {
      mode = "hang";
      const r = await call(translateBody);
      assertEquals([last(r).code, last(r).retry_after], ["busy", 30]);
      assertMatch(String(last(r).message), /ما ردّت بالوقت/);
    });
    const chain = ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash"].map((x) => `/v1beta/models/${x}`);
    await t.step("Gemini per-minute 429 on every model → busy with Gemini's retry delay", async () => {
      mode = "minute";
      const n = seen.length;
      const r = await call(translateBody);
      assertEquals([last(r).code, last(r).retry_after], ["busy", 33]);
      assertEquals(seen.slice(n).map((x) => x.url.split(":")[0]), chain);
    });
    await t.step("every model used up for today → daily_quota with a clear Arabic message", async () => {
      mode = "daily";
      const n = seen.length;
      const r = await call(translateBody);
      assertEquals(seen.length - n, 4);
      assertEquals(last(r).code, "daily_quota");
      assertMatch(String(last(r).message), /خلصت الحصة المجانية اليومية/);
    });
    await t.step("503 everywhere → busy with a 30 s back-off; error after text started → busy, no hand-over", async () => {
      mode = "unavailable";
      let n = seen.length;
      let r = await call(translateBody);
      assertEquals([last(r).code, last(r).retry_after], ["busy", 30]);
      assertEquals(seen.length - n, 4);
      mode = "stream_error";
      n = seen.length;
      r = await call(translateBody);
      assertEquals(last(r).code, "busy");
      assertEquals(seen.length - n, 1); // part of the answer was already shown, so no other model starts over
    });
    await t.step("bad key → not_configured at once (same for every model)", async () => {
      mode = "badkey";
      const n = seen.length;
      assertEquals(last(await call(translateBody)).code, "not_configured");
      assertEquals(seen.length - n, 1);
    });
    await t.step("safety stop and blocked prompt → refused; MAX_TOKENS → too_long; cut-off → busy", async () => {
      mode = "safety";
      assertEquals(last(await call(translateBody)).code, "refused");
      mode = "blocked";
      assertEquals(last(await call(translateBody)).code, "refused");
      mode = "max_tokens";
      assertEquals(last(await call(translateBody)).code, "too_long");
      mode = "cut";
      assertEquals(last(await call(translateBody)).code, "busy");
    });
    await t.step("soft time limit while answering → too_long", async () => {
      mode = "slow";
      assertEquals(last(await call(translateBody)).code, "too_long");
    });
  } finally {
    await stopFn(proc);
  }
});

Deno.test({ name: "integration: settings from env (model name, fallback off)", sanitizeOps: false, sanitizeResources: false }, async () => {
  const proc = await startFn({ AI_MODEL: "gemini-3.7-flash", AI_FALLBACK_MODELS: "off" });
  try {
    mode = "ok";
    await call(translateBody);
    assertEquals(seen.at(-1)!.url, "/v1beta/models/gemini-3.7-flash:streamGenerateContent?alt=sse");
    mode = "unavailable";
    const n = seen.length;
    assertEquals(last(await call(translateBody)).code, "busy");
    assertEquals(seen.length - n, 1);
  } finally {
    await stopFn(proc);
  }
});

Deno.test({ name: "integration: custom fallback list (trimmed, duplicates dropped)", sanitizeOps: false, sanitizeResources: false }, async () => {
  const proc = await startFn({ AI_MODEL: "gemini-3.7-flash", AI_FALLBACK_MODELS: " gemini-3.7-flash , gemini-3.5-flash-lite " });
  try {
    mode = "unavailable";
    const n = seen.length;
    assertEquals(last(await call(translateBody)).code, "busy");
    assertEquals(seen.slice(n).map((x) => x.url.split(":")[0]), ["/v1beta/models/gemini-3.7-flash", "/v1beta/models/gemini-3.5-flash-lite"]);
  } finally {
    await stopFn(proc);
  }
});

Deno.test({ name: "integration: no API key → not_configured", sanitizeOps: false, sanitizeResources: false }, async () => {
  const proc = await startFn({ GEMINI_API_KEY: "" });
  try {
    const r = await call(translateBody);
    assertEquals([r.status, r.json.error], [503, "not_configured"]);
  } finally {
    await stopFn(proc);
    await fake.shutdown();
  }
});
