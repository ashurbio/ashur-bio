// Tests for the study-ai edge function: unit tests for prompts.ts, and integration tests that run the real
// index.ts against a fake Supabase (auth + REST) and a fake Claude API, so no keys or network are needed.
//
//   deno test --allow-net --allow-env --allow-run --allow-read supabase/functions/tests/study-ai-test.ts
import { assert, assertEquals, assertMatch, assertThrows } from "jsr:@std/assert@1";
import { FORMATS, InvalidRequest, parseRequest, settingsText, studySchema } from "../study-ai/prompts.ts";

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
  // every object in every format is closed and fully required (structured-output requirement)
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

/* ---------------- integration: real index.ts against fakes ---------------- */

type Seen = { body: Record<string, any>; beta: string | null };
const seen: Seen[] = [];
let mode: "ok" | "json" | "refusal" | "busy" | "slow" = "ok";
let rateAllowed = true;

function sse(events: [string, unknown][]): string {
  return events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join("");
}
function messageEvents(text: string, stop = "end_turn"): [string, unknown][] {
  const half = Math.ceil(text.length / 2);
  return [
    ["message_start", { type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } } }],
    ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } }],
    ["content_block_stop", { type: "content_block_stop", index: 0 }],
    ["content_block_start", { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } }],
    ["content_block_delta", { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: text.slice(0, half) } }],
    ["content_block_delta", { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: text.slice(half) } }],
    ["content_block_stop", { type: "content_block_stop", index: 1 }],
    ["message_delta", { type: "message_delta", delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 7 } }],
    ["message_stop", { type: "message_stop" }],
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
  if (url.pathname === "/rest/v1/profiles") {
    const id = url.searchParams.get("id");
    return j(id === "eq.u1" ? { status: "active" } : { status: "disabled" });
  }
  if (url.pathname === "/rest/v1/rpc/rate_hit") return j(rateAllowed);
  // --- Claude
  if (url.pathname === "/v1/messages") {
    const body = await req.json();
    seen.push({ body, beta: req.headers.get("anthropic-beta") });
    const headers = { "content-type": "text/event-stream" };
    if (mode === "busy") return j({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } }, 529);
    if (mode === "slow") {
      const stream = new ReadableStream({
        async start(c) {
          c.enqueue(new TextEncoder().encode(sse(messageEvents("x").slice(0, 4))));
          await new Promise((r) => setTimeout(r, 5000));
          try { c.close(); } catch { /* aborted */ }
        },
      });
      return new Response(stream, { headers });
    }
    if (mode === "refusal") return new Response(sse(messageEvents("", "refusal")), { headers });
    const text = mode === "json" ? JSON.stringify({ topic: "Cell", summary: [], mcq: [], notes: [] }) : "--- صفحة 5 ---\n# الخلية (Cell)";
    return new Response(sse(messageEvents(text)), { headers });
  }
  return j({ message: "not found" }, 404);
});

async function startFn(extraEnv: Record<string, string> = {}) {
  const deno = Deno.execPath();
  const proc = new Deno.Command(deno, {
    args: ["run", "--allow-net", "--allow-env", "--allow-read", "--no-prompt", new URL("../study-ai/index.ts", import.meta.url).pathname],
    env: {
      SUPABASE_URL: "http://127.0.0.1:8787", SUPABASE_SERVICE_ROLE_KEY: "service", ANTHROPIC_BASE_URL: "http://127.0.0.1:8787",
      ANTHROPIC_API_KEY: "test-key", ...extraEnv,
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

const translateBody = { task: "translate", target: "ar", pieces: [{ kind: "pdf", data: PDF }], start: 5, count: 2, total: 30 };

Deno.test({ name: "integration: auth, limits, streaming, errors", sanitizeOps: false, sanitizeResources: false }, async (t) => {
  const proc = await startFn({ AI_TIME_LIMIT_SEC: "2" });
  try {
    await t.step("rejects missing/invalid/disabled users", async () => {
      assertEquals((await call(translateBody, "nope")).status, 401);
      assertEquals((await call(translateBody, "disabled")).status, 401);
    });
    await t.step("rejects bad requests before calling Claude", async () => {
      const n = seen.length;
      const r = await call({ task: "translate", pieces: [] });
      assertEquals(r.status, 400);
      assertEquals(r.json.error, "bad_request");
      assert(r.json.message && r.json.message_en);
      assertEquals(seen.length, n);
    });
    await t.step("daily limit", async () => {
      rateAllowed = false;
      const r = await call(translateBody);
      rateAllowed = true;
      assertEquals(r.status, 429);
      assertEquals(r.json.error, "user_limit");
    });
    await t.step("translate streams deltas and sends the right request", async () => {
      mode = "ok";
      const r = await call(translateBody);
      assertEquals(r.status, 200);
      const text = r.events.filter((e) => e.type === "delta").map((e) => e.text).join("");
      assertEquals(text, "--- صفحة 5 ---\n# الخلية (Cell)");
      assertEquals(r.events.at(-1), { type: "done", stop: "end_turn" });
      assert(r.events.some((e) => e.type === "status" && e.phase === "thinking"));
      const req = seen.at(-1)!;
      assertEquals(req.body.model, "claude-opus-5-5");
      assertEquals(req.body.fallbacks, "default");
      assertMatch(req.beta || "", /server-side-fallback-2026-07-01/);
      assertEquals(req.body.output_config, { effort: "low" });
      assertEquals(req.body.system[0].cache_control, { type: "ephemeral" });
      assertEquals(req.body.messages[0].content[0].type, "document");
      assertMatch(req.body.messages[0].content.at(-1).text, /pages 5-6 of a file with 30 pages/);
      assert(!("thinking" in req.body), "thinking is left to the model default (adaptive)");
    });
    await t.step("study sends a JSON schema with only the chosen formats", async () => {
      mode = "json";
      const r = await call({ task: "study", formats: ["mcq", "summary"], pieces: [{ kind: "text", text: "Cells are..." }], numbering: "part", start: 1, count: 1, total: 1 });
      const text = r.events.filter((e) => e.type === "delta").map((e) => e.text).join("");
      assertEquals(JSON.parse(text).topic, "Cell");
      const req = seen.at(-1)!;
      assertEquals(req.body.output_config.effort, "medium");
      assertEquals(Object.keys(req.body.output_config.format.schema.properties), ["topic", "summary", "mcq", "notes"]);
      assertEquals(req.body.messages[0].content[0].source.type, "text");
    });
    await t.step("refusal is reported, not shown as output", async () => {
      mode = "refusal";
      const r = await call(translateBody);
      assertEquals(r.events.at(-1).type, "error");
      assertEquals(r.events.at(-1).code, "refused");
    });
    await t.step("overloaded upstream → busy (after the SDK's own retry)", async () => {
      mode = "busy";
      const n = seen.length;
      const r = await call(translateBody);
      assertEquals(r.events.at(-1).code, "busy");
      assertEquals(seen.length - n, 2);
    });
    await t.step("soft time limit → too_long", async () => {
      mode = "slow";
      const r = await call(translateBody);
      assertEquals(r.events.at(-1).code, "too_long");
    });
  } finally {
    await stopFn(proc);
  }
});

Deno.test({ name: "integration: no API key → not_configured", sanitizeOps: false, sanitizeResources: false }, async () => {
  const proc = await startFn({ ANTHROPIC_API_KEY: "" });
  try {
    const r = await call(translateBody);
    assertEquals(r.status, 503);
    assertEquals(r.json.error, "not_configured");
  } finally {
    await stopFn(proc);
    await fake.shutdown();
  }
});
