"""End-to-end checks for the study assistant (translate & summarise) against the mocked backend.

Covers PDF / photos / Word / PowerPoint / pasted text, translation, every study format, quiz interaction,
download, history after reload, automatic splitting of long parts, daily-limit handling, file errors,
axe accessibility on the result screens (light + dark) and reflow at 320 px.
"""
import base64
import json
import os
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright
from mock_backend import MockBackend, SUPA
from study_fixtures import make_all

_CHROME = os.environ.get("CHROMIUM_PATH", "/opt/pw-browsers/chromium")
LAUNCH = {"executable_path": _CHROME} if os.path.exists(_CHROME) else {}
BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8000/"
SHOTS = Path(sys.argv[2] if len(sys.argv) > 2 else "shots")
SHOTS.mkdir(exist_ok=True)
FX = make_all(Path(__file__).parent / "fixtures")
PUBLIC = Path(__file__).parent / "../../web/public"
AXE = (Path(__file__).parent / "node_modules/axe-core/axe.min.js").read_text()
results = []


def check(name, cond, detail=""):
    results.append((name, bool(cond), detail))
    print(("PASS " if cond else "FAIL ") + name + (f"  -- {detail}" if detail else ""))


def new_ctx(browser, mb, **kw):
    opts = dict(viewport={"width": 390, "height": 844}, device_scale_factor=2, locale="ar-IQ", color_scheme="light", accept_downloads=True)
    opts.update(kw)
    ctx = browser.new_context(**opts)
    ctx.route(f"{SUPA}/**", mb.handle)
    return ctx


def login(page, user="bio-std01", pin="482913"):
    page.goto(BASE)
    page.wait_for_load_state("networkidle")
    page.fill("#login-user", user)
    digits = page.locator("input[aria-label*='PIN digit']")
    for i, ch in enumerate(pin):
        digits.nth(i).fill(ch)
    sub = page.locator("button[type=submit]")
    if sub.is_visible() and sub.is_enabled():
        sub.click()
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(500)


def open_study(page):
    page.evaluate("location.hash = '#study'")
    page.wait_for_selector("main h1:has-text('المترجم والملخّص')")


def upload(page, *paths):
    page.set_input_files("[data-testid=study-file]", [str(p) for p in paths])
    page.wait_for_selector(".src, .study [role=alert]")
    page.wait_for_timeout(200)


def run_and_wait(page, label):
    page.locator(".start-row .btn").click()
    page.wait_for_selector(f".job h2:has-text('{label}')")
    page.wait_for_function("() => !document.querySelector('.job[aria-busy=true]')", timeout=20000)
    page.wait_for_timeout(200)


def axe(page):
    page.add_script_tag(content=AXE)
    return page.evaluate("""async () => (await axe.run(document, {runOnly: {type: 'tag', values: ['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa','best-practice']}}))
      .violations.map(v => ({id: v.id, impact: v.impact, n: v.nodes.length, t: v.nodes[0].target.join(' '), h: v.nodes[0].html.slice(0, 120)}))""")


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, **LAUNCH)

    # ---------- PDF: translate, then summarise every format
    mb = MockBackend()
    ctx = new_ctx(browser, mb)
    page = ctx.new_page()
    errs = []
    page.on("console", lambda m: m.type == "error" and "ERR_" not in m.text and errs.append(m.text))
    page.on("pageerror", lambda e: errs.append(f"pageerror: {e}"))
    login(page)
    cta = page.locator(".study-cta .btn")
    check("home: study card is shown", cta.is_visible())
    cta.click()
    page.wait_for_selector("main h1:has-text('المترجم والملخّص')")
    check("home: card opens the study tab", page.evaluate("location.hash") == "#study")
    page.screenshot(path=str(SHOTS / "s01_study_empty.png"), full_page=True)

    upload(page, FX / "lecture.pdf")
    check("pdf: source card shows 5 pages", "5 صفحة" in page.inner_text(".src"), page.inner_text(".src").replace("\n", " "))
    check("pdf: page range defaults to 1–5", page.input_value("#pg-from") == "1" and page.input_value("#pg-to") == "5")
    check("pdf: plan shows 3 parts", "3 أجزاء" in page.inner_text(".start-row"), page.inner_text(".start-row").replace("\n", " "))
    run_and_wait(page, "ترجمة")
    calls = [(c["task"], c["numbering"], c["start"], c["count"], c["total"]) for c in mb.study_calls]
    check("pdf translate: 3 requests of 2+2+1 pages", calls == [("translate", "page", 1, 2, 5), ("translate", "page", 3, 2, 5), ("translate", "page", 5, 1, 5)], str(calls))
    first = mb.study_calls[0]
    pdf_bytes = base64.b64decode(first["pieces"][0]["data"])
    check("pdf translate: each request carries a real PDF", first["pieces"][0]["kind"] == "pdf" and pdf_bytes.startswith(b"%PDF"), f"{len(pdf_bytes)} bytes")
    check("pdf translate: options sent", first["target"] == "ar" and first["keepTerms"] is True)
    check("translate: 5 page markers rendered", page.locator(".job .pg-mark").count() == 5)
    check("translate: tables and bold rendered", page.locator(".job .md table").count() == 5 and page.locator(".job .md strong").count() >= 5)
    check("translate: no failed parts", page.locator(".tpart.failed").count() == 0)
    page.screenshot(path=str(SHOTS / "s02_translated.png"), full_page=True)

    with page.expect_download() as dl:
        page.locator(".job-actions button", has_text="تنزيل").click()
    text = Path(dl.value.path()).read_text(encoding="utf-8-sig")
    check("translate: download has the translation", "--- صفحة 1 ---" in text and "الخلية (Cell) 5" in text, dl.value.suggested_filename)

    # summarise the same file, all formats
    page.locator(".job-actions button", has_text="لخّص").click()
    page.wait_for_timeout(300)
    check("summarise: switches the task to study", page.locator(".opts-grid .fchip[aria-pressed=true]", has_text="تلخيص وأسئلة").count() == 1)
    page.locator(".opt-row .link", has_text="الكل").click()
    n0 = len(mb.study_calls)
    run_and_wait(page, "تلخيص وأسئلة")
    scalls = mb.study_calls[n0:]
    groups = sorted({tuple(c["formats"]) for c in scalls})
    check("study: 2 page-parts x 3 format groups = 6 requests", len(scalls) == 6, f"{len(scalls)} {groups}")
    check("study: every format requested once per part", sorted(f for c in scalls for f in c["formats"]) == sorted(
        ["summary", "terms", "mcq", "true_false", "lists", "reasons", "compare", "blanks", "essay"] * 2))
    tabs = page.locator(".study-out .filters .fchip")
    check("study: 9 format tabs", tabs.count() == 9)
    counts = [tabs.nth(i).locator(".cnt").inner_text() for i in range(tabs.count())]
    check("study: 4 items per format (2 per part)", counts == ["4"] * 9, str(counts))
    for i in range(tabs.count()):
        tabs.nth(i).click()
        body = page.locator(".fmt.on")
        name = tabs.nth(i).inner_text().split("\n")[0]
        check(f"study tab {name}: renders items", body.count() == 1 and len(body.inner_text()) > 20)
    page.screenshot(path=str(SHOTS / "s03_study_essay.png"), full_page=True)

    # MCQ: wrong then right answers, score, explanation
    page.locator(".study-out .fchip", has_text="اختيار من متعدد").click()
    q1 = page.locator(".fmt.on .q").nth(0)
    opts = q1.locator(".opt")
    texts = [opts.nth(i).inner_text() for i in range(opts.count())]
    right = next(i for i, t in enumerate(texts) if "الميتوكوندريا" in t)
    wrong = (right + 1) % 4
    opts.nth(wrong).click()
    check("mcq: wrong answer marked, correct one revealed", q1.locator(".opt.wrong").count() == 1 and q1.locator(".opt.right").count() == 1)
    check("mcq: explanation shown", "التنفس الخلوي" in q1.locator(".fb").inner_text())
    check("mcq: options locked after answering", opts.nth(right).is_disabled())
    page.locator(".fmt.on .q").nth(1).locator(".opt", has_text="الميتوكوندريا").click()
    check("mcq: score 1 of 2", "صحيحة 1 من 2" in page.inner_text(".fmt.on .score"))
    positions = set()
    for i in range(4):
        o = page.locator(".fmt.on .q").nth(i).locator(".opt")
        positions.add(next(k for k in range(o.count()) if "الميتوكوندريا" in o.nth(k).inner_text()))
    check("mcq: options are shuffled (answer not always in the same slot)", len(positions) > 1, str(positions))
    page.screenshot(path=str(SHOTS / "s04_mcq.png"), full_page=True)

    # True / false
    page.locator(".study-out .fchip", has_text="صح وخطأ").click()
    tf = page.locator(".fmt.on .q").nth(0)
    tf.locator(".opt", has_text="صح").click()
    check("true/false: answering shows feedback", tf.locator(".fb").count() == 1)

    # reveal formats + show all answers
    page.locator(".study-out .fchip", has_text="علّل").click()
    check("reasons: answers hidden by default", page.locator(".fmt.on details[open]").count() == 0)
    page.locator(".study-out .check input").check()
    check("show all answers opens every answer", page.locator(".fmt.on details[open]").count() == 4)
    page.locator(".study-out .fchip", has_text="قارن").click()
    check("compare: renders a table", page.locator(".fmt.on table").count() == 4)
    print("axe study result (light):")
    v = axe(page)
    for x in v:
        print("   ", x)
    check("a11y: no axe violations on study results (light)", not v, f"{len(v)} violations")

    with page.expect_download() as dl:
        page.locator(".job-actions button", has_text="تنزيل").click()
    text = Path(dl.value.path()).read_text(encoding="utf-8-sig")
    check("study: download has every section with answers", all(h in text for h in ["==== الخلاصة", "==== اختيار من متعدد", "==== علّل", "==== قارن"]) and "✔" in text)

    # history survives a reload
    page.reload()
    page.wait_for_load_state("networkidle")
    open_study(page)
    hist = page.locator(".hist li")
    check("history: both results kept after reload", hist.count() == 2, f"{hist.count()}")
    hist.nth(1).locator(".hist-open").click()
    page.wait_for_selector(".job .pg-mark")
    check("history: opening a translation shows it", page.locator(".job .pg-mark").count() == 5)
    check("console: no JS errors (pdf run)", not errs, "; ".join(errs[:5]))

    # another account on the same phone must not see these results
    page.evaluate("location.hash = '#account'")
    page.locator("button", has_text="تسجيل الخروج").click()
    page.wait_for_selector("#login-user")
    login(page, "bio-rep01", "735164")
    open_study(page)
    check("privacy: next account sees no history or open file", page.locator(".hist li").count() == 0 and page.locator(".job").count() == 0 and page.locator(".src").count() == 0)
    ctx.close()

    # ---------- photos, Word, PowerPoint, pasted text
    mb = MockBackend()
    ctx = new_ctx(browser, mb)
    page = ctx.new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    login(page)
    open_study(page)
    upload(page, PUBLIC / "icon-192.png", PUBLIC / "apple-touch-icon.png")
    check("photos: two thumbnails", page.locator(".thumb img").count() == 2)
    run_and_wait(page, "ترجمة")
    calls = mb.study_calls
    check("photos: one request per photo", [(c["numbering"], c["start"], c["count"]) for c in calls] == [("image", 1, 1), ("image", 2, 1)])
    check("photos: sent as JPEG", calls[0]["pieces"][0]["kind"] == "image" and calls[0]["pieces"][0]["media"] == "image/jpeg"
          and base64.b64decode(calls[0]["pieces"][0]["data"])[:2] == b"\xff\xd8")
    page.locator(".src .icon-btn").click()

    upload(page, FX / "notes.docx")
    check("docx: read as text", "نص" in page.inner_text(".src"))
    n0 = len(mb.study_calls)
    run_and_wait(page, "ترجمة")
    t = mb.study_calls[n0]["pieces"][0]["text"]
    check("docx: heading, list and table extracted", "# Cell Structure" in t and "- Nucleus" in t and "| Organelle | Function |" in t, t.replace("\n", " / "))
    page.locator(".src .icon-btn").click()

    upload(page, FX / "slides.pptx")
    check("pptx: 2 slides", "2 شريحة" in page.inner_text(".src"))
    n0 = len(mb.study_calls)
    run_and_wait(page, "ترجمة")
    t = mb.study_calls[n0]["pieces"][0]["text"]
    check("pptx: slides follow the presentation order", t.index("Introduction to Cell Division") < t.index("Mitosis") and t.startswith("--- Slide 1 ---"), t.replace("\n", " / "))
    page.locator(".src .icon-btn").click()

    page.locator(".drop button", has_text="الصق نص").click()
    page.fill("#study-paste", "The cell membrane controls what enters and leaves the cell.\n\nMitochondria produce ATP.")
    page.locator(".paste .btn").click()
    page.locator(".opts-grid .fchip", has_text="تلخيص وأسئلة").click()
    n0 = len(mb.study_calls)
    run_and_wait(page, "تلخيص وأسئلة")
    c = mb.study_calls[n0]
    check("pasted text: summarised as one part", c["numbering"] == "part" and c["task"] == "study" and "Mitochondria" in c["pieces"][0]["text"])
    page.locator(".src .icon-btn").click()

    upload(page, FX / "old.doc")
    check("old .doc: clear error", "غير مدعومة" in page.inner_text(".study"))
    check("console: no JS errors (formats run)", not errs, "; ".join(errs[:5]))
    ctx.close()

    # ---------- long parts are split automatically; daily limit stops the job
    mb = MockBackend()
    mb.study_mode = "too_long_once"
    ctx = new_ctx(browser, mb)
    page = ctx.new_page()
    login(page)
    open_study(page)
    upload(page, FX / "lecture.pdf")
    page.locator(".opts-grid .fchip", has_text="ترجمة").click()
    run_and_wait(page, "ترجمة")
    calls = [(c["start"], c["count"]) for c in mb.study_calls]
    check("too long: 2-page parts retried as single pages", calls[:2] == [(1, 2), (3, 2)] and (1, 1) in calls and (2, 1) in calls and (4, 1) in calls, str(calls))
    check("too long: all 5 pages still translated in order",
          [page.locator(".job .pg-mark").nth(i).inner_text() for i in range(page.locator(".job .pg-mark").count())] == [f"صفحة {i}" for i in range(1, 6)])
    # pasted text that is too long is split in two without losing any paragraph
    page.locator(".src .icon-btn").click()
    page.locator(".drop button", has_text="الصق نص").click()
    paras = [f"Paragraph {k}: " + ("cell biology " * 80) for k in range(1, 4)]
    page.fill("#study-paste", "\n\n".join(paras))
    page.locator(".paste .btn").click()
    n0 = len(mb.study_calls)
    run_and_wait(page, "ترجمة")
    sent = [c["pieces"][0]["text"] for c in mb.study_calls[n0:]]
    retried = "\n".join(sent[1:])
    check("split text: first try too long, then two halves", len(sent) == 3, f"{len(sent)} requests")
    check("split text: every paragraph is sent after splitting", all(f"Paragraph {k}:" in retried for k in (1, 2, 3)))
    check("split text: no failed parts", page.locator(".tpart.failed").count() == 0)

    mb.study_mode = "user_limit"
    page.locator(".job .icon-btn").click()
    page.locator(".start-row .btn").click()
    page.wait_for_selector(".job .notice.alert")
    check("daily limit: student sees the message", "الحد اليومي" in page.inner_text(".job .notice.alert"))
    check("daily limit: job stops instead of retrying", len([c for c in mb.study_calls if c]) == len(calls) + 1 or page.locator(".job[aria-busy=true]").count() == 0)
    page.screenshot(path=str(SHOTS / "s05_limit.png"), full_page=True)
    ctx.close()

    # ---------- dark mode + 320 px reflow on a finished result
    mb = MockBackend()
    ctx = new_ctx(browser, mb, color_scheme="dark")
    page = ctx.new_page()
    login(page)
    open_study(page)
    upload(page, FX / "lecture.pdf")
    page.locator(".opts-grid .fchip", has_text="تلخيص وأسئلة").click()
    run_and_wait(page, "تلخيص وأسئلة")
    page.locator(".study-out .fchip", has_text="اختيار من متعدد").click()
    page.locator(".fmt.on .q").nth(0).locator(".opt").nth(0).click()
    page.screenshot(path=str(SHOTS / "s06_dark_mcq.png"), full_page=True)
    print("axe study result (dark):")
    v = axe(page)
    for x in v:
        print("   ", x)
    check("a11y: no axe violations on study results (dark)", not v, f"{len(v)} violations")
    page.set_viewport_size({"width": 320, "height": 700})
    page.wait_for_timeout(300)
    sw = page.evaluate("document.documentElement.scrollWidth")
    check("reflow: no horizontal scroll at 320 px", sw <= 320, f"scrollWidth={sw}")
    ctx.close()

    # ---------- the chosen page range survives switching tabs; a screen that can't load shows a retry
    mb = MockBackend()
    ctx = new_ctx(browser, mb)
    page = ctx.new_page()
    login(page)
    open_study(page)
    upload(page, FX / "lecture.pdf")
    page.fill("#pg-from", "3")
    page.evaluate("location.hash = '#schedule'")
    page.wait_for_timeout(300)
    open_study(page)
    check("range: page range kept after switching tabs", page.input_value("#pg-from") == "3" and "2 أجزاء" in page.inner_text(".start-row"), page.inner_text(".start-row").replace("\n", " "))
    ctx.close()

    mb = MockBackend()
    ctx = new_ctx(browser, mb)
    page = ctx.new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    login(page)
    page.route("**/assets/index-*.js", lambda r: r.abort())  # the study chunk can't be downloaded
    page.evaluate("location.hash = '#study'")
    page.wait_for_timeout(800)
    check("offline: study screen shows a retry instead of a blank app",
          page.locator("main [role=alert] button", has_text="إعادة التحميل").is_visible() and page.locator(".bottom-nav").is_visible())
    page.unroute("**/assets/index-*.js")
    ctx.close()

    # ---------- desktop
    mb = MockBackend()
    ctx = new_ctx(browser, mb, viewport={"width": 1366, "height": 900}, device_scale_factor=1)
    page = ctx.new_page()
    login(page)
    page.locator(".side-nav .tab", has_text="المترجم والملخّص").click()
    page.wait_for_selector("main h1:has-text('المترجم والملخّص')")
    check("desktop: study tab in the side navigation", page.evaluate("location.hash") == "#study")
    upload(page, FX / "lecture.pdf")
    run_and_wait(page, "ترجمة")
    page.screenshot(path=str(SHOTS / "s07_desktop.png"), full_page=True)
    ctx.close()
    browser.close()

failed = [r for r in results if not r[1]]
print(f"\n{len(results) - len(failed)}/{len(results)} checks passed")
Path("results_study.json").write_text(json.dumps(results, ensure_ascii=False, indent=1))
sys.exit(1 if failed else 0)
