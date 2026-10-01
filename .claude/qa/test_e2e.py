"""End-to-end checks for the Life Sciences portal against a mocked Supabase backend."""
import json
import os
import re
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
from mock_backend import MockBackend, SUPA

# Use a preinstalled Chromium when present (cloud sessions); otherwise Playwright's own.
_CHROME = os.environ.get("CHROMIUM_PATH", "/opt/pw-browsers/chromium")
LAUNCH = {"executable_path": _CHROME} if os.path.exists(_CHROME) else {}

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8000/"
SHOTS = Path(sys.argv[2] if len(sys.argv) > 2 else "shots")
SHOTS.mkdir(exist_ok=True)
results = []


def check(name, cond, detail=""):
    results.append((name, bool(cond), detail))
    print(("PASS " if cond else "FAIL ") + name + (f"  -- {detail}" if detail else ""))


def new_ctx(browser, mb, **kw):
    opts = dict(viewport={"width": 390, "height": 844}, device_scale_factor=2, locale="ar-IQ",
                ignore_https_errors=True, color_scheme="light")
    opts.update(kw)
    ctx = browser.new_context(**opts)
    ctx.route(f"{SUPA}/**", mb.handle)
    return ctx


def watch(page, sink):
    page.on("console", lambda m: m.type == "error" and "ERR_" not in m.text and sink.append(m.text))
    page.on("pageerror", lambda e: sink.append(f"pageerror: {e}"))


def login(page, user, pin):
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
    page.wait_for_timeout(600)


def goto_tab(page, tab):
    page.evaluate(f"location.hash = '#{tab}'")
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(500)


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, **LAUNCH)

    # ---------- 1. Login screen
    mb = MockBackend()
    ctx = new_ctx(browser, mb)
    page = ctx.new_page()
    errs = []
    watch(page, errs)
    page.goto(BASE)
    page.wait_for_load_state("networkidle")
    page.screenshot(path=str(SHOTS / "01_login.png"))
    check("login: form renders", page.locator("#login-user").is_visible())

    # wrong PIN
    login(page, "bio-std01", "111111")
    page.wait_for_timeout(400)
    body_text = page.inner_text("body")
    check("login: wrong PIN shows an error", "غير صحيح" in body_text or "Wrong username" in body_text)
    page.screenshot(path=str(SHOTS / "02_login_error.png"))
    errs.clear()  # the 400 from the deliberate wrong-PIN attempt is expected

    # correct PIN
    login(page, "bio-std01", "482913")
    check("login: student reaches home", page.locator("h1", has_text="مرحباً").is_visible())
    page.screenshot(path=str(SHOTS / "03_home.png"), full_page=True)

    # session survives reload
    page.reload()
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(500)
    check("session: persists after reload", page.locator("h1", has_text="مرحباً").is_visible())

    # ---------- 2. Every tab
    tabs = ["schedule", "announcements", "exams", "materials", "absences", "account"]
    for i, tab in enumerate(tabs, start=4):
        goto_tab(page, tab)
        h1 = page.locator("main h1").first
        ok = h1.count() > 0 and h1.is_visible()
        check(f"tab {tab}: renders a heading", ok, h1.inner_text().replace("\n", " / ") if ok else "")
        page.screenshot(path=str(SHOTS / f"{i:02d}_{tab}.png"), full_page=True)

    # student must not see admin
    goto_tab(page, "admin")
    check("authz: student is redirected away from admin", "admin" not in page.evaluate("location.hash") or page.locator("h1", has_text="مرحباً").is_visible())

    # bottom nav + More sheet on mobile
    goto_tab(page, "home")
    more = page.locator(".bottom-nav button", has_text="المزيد")
    check("mobile: bottom nav has More", more.count() == 1)
    if more.count():
        more.click()
        page.wait_for_timeout(500)
        dialog = page.locator("[role=dialog]")
        check("mobile: More opens a dialog", dialog.count() > 0 and dialog.first.is_visible())
        page.screenshot(path=str(SHOTS / "10_more_sheet.png"))
        page.keyboard.press("Escape")
        page.wait_for_timeout(400)
        check("mobile: Escape closes the More dialog", page.locator("[role=dialog]").count() == 0 or not page.locator("[role=dialog]").first.is_visible())

    # ---------- 3. Absences: increment one subject
    goto_tab(page, "absences")
    before = len([c for c in mb.calls if c.startswith("POST /rest/v1/absences")])
    plus = page.locator("button[aria-label*='زيادة'], button[aria-label*='Add'], button[aria-label*='add'], button:has-text('+')").first
    if plus.count():
        plus.click()
        page.wait_for_timeout(800)
        after = len([c for c in mb.calls if c.startswith("POST /rest/v1/absences")])
        check("absences: + saves an upsert", after == before + 1, f"upserts {before}->{after}")
    else:
        check("absences: + button found", False, "no increment button matched")
    page.screenshot(path=str(SHOTS / "11_absences_after_click.png"), full_page=True)

    # ---------- 4. Logout
    goto_tab(page, "account")
    out = page.locator("button", has_text=re.compile("تسجيل الخروج|خروج"))
    if out.count():
        out.first.click()
        page.wait_for_timeout(600)
        confirm = page.locator("[role=dialog] button", has_text=re.compile("خروج"))
        if confirm.count():
            confirm.last.click()
            page.wait_for_timeout(600)
        check("logout: returns to login", page.locator("#login-user").is_visible())
    else:
        check("logout: button found", False)
    check("console: no JS errors (student run)", not errs, "; ".join(errs[:5]))
    ctx.close()

    # ---------- 5. Representative / owner
    mb2 = MockBackend()
    ctx = new_ctx(browser, mb2)
    page = ctx.new_page()
    errs2 = []
    watch(page, errs2)
    login(page, "bio-rep01", "735164")
    goto_tab(page, "admin")
    check("rep: admin page opens", "admin" in page.evaluate("location.hash") and page.locator("main h1").first.is_visible(),
          page.locator("main h1").first.inner_text().replace("\n", " / ") if page.locator("main h1").count() else "")
    page.wait_for_timeout(500)
    check("rep: join code loaded", "ASHUR-25" in page.inner_text("main"))
    page.screenshot(path=str(SHOTS / "12_admin.png"), full_page=True)
    goto_tab(page, "announcements")
    page.screenshot(path=str(SHOTS / "13_rep_announcements.png"), full_page=True)
    check("console: no JS errors (rep run)", not errs2, "; ".join(errs2[:5]))
    ctx.close()

    # ---------- 6. Dark mode + desktop
    mb3 = MockBackend()
    ctx = new_ctx(browser, mb3, color_scheme="dark")
    page = ctx.new_page()
    page.goto(BASE)
    page.wait_for_load_state("networkidle")
    page.screenshot(path=str(SHOTS / "14_login_dark.png"))
    login(page, "bio-std01", "482913")
    page.screenshot(path=str(SHOTS / "15_home_dark.png"), full_page=True)
    ctx.close()

    mb4 = MockBackend()
    ctx = new_ctx(browser, mb4, viewport={"width": 1366, "height": 860}, device_scale_factor=1)
    page = ctx.new_page()
    login(page, "bio-std01", "482913")
    page.screenshot(path=str(SHOTS / "16_home_desktop.png"))
    goto_tab(page, "schedule")
    page.screenshot(path=str(SHOTS / "17_schedule_desktop.png"))
    ctx.close()

    # ---------- 7. Register + forgot PIN
    mb5 = MockBackend()
    ctx = new_ctx(browser, mb5)
    page = ctx.new_page()
    page.goto(BASE)
    page.wait_for_load_state("networkidle")
    page.locator("button", has_text="سجّل").first.click()
    page.wait_for_timeout(500)
    page.screenshot(path=str(SHOTS / "18_register.png"), full_page=True)
    inputs = page.locator("main input, form input")
    check("register: form shows inputs", inputs.count() >= 3, f"{inputs.count()} inputs")
    ctx.close()

    browser.close()

failed = [r for r in results if not r[1]]
print(f"\n{len(results) - len(failed)}/{len(results)} checks passed")
Path("results.json").write_text(json.dumps(results, ensure_ascii=False, indent=1))
