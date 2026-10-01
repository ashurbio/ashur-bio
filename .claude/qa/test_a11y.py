"""axe-core + manual WCAG 2.2 / interface-guideline checks on every screen (mocked backend)."""
import json
import os
import sys
from collections import defaultdict
from pathlib import Path
from playwright.sync_api import sync_playwright
from mock_backend import MockBackend, SUPA

# Use a preinstalled Chromium when present (cloud sessions); otherwise Playwright's own.
_CHROME = os.environ.get("CHROMIUM_PATH", "/opt/pw-browsers/chromium")
LAUNCH = {"executable_path": _CHROME} if os.path.exists(_CHROME) else {}

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8000/"
OUT = Path(sys.argv[2] if len(sys.argv) > 2 else "a11y_before.json")
AXE = (Path(__file__).parent / "node_modules/axe-core/axe.min.js").read_text()

MANUAL = r"""() => {
  const vis = e => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0'; };
  const label = e => (e.getAttribute('aria-label') || e.innerText || e.value || e.id || e.className || e.tagName).toString().trim().replace(/\s+/g,' ').slice(0,40);
  const out = {smallTargets: [], tinyText: [], overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
               scrollWidth: document.documentElement.scrollWidth, skipLink: !!document.querySelector('a[href^="#"][class*="skip"], .skip-link'),
               liveRegions: document.querySelectorAll('[aria-live],[role=status],[role=alert]').length};
  for (const e of document.querySelectorAll('button, a[href], input, select, textarea, [role=button], [role=tab]')) {
    if (!vis(e)) continue;
    const r = e.getBoundingClientRect();
    if (r.width < 24 || r.height < 24) out.smallTargets.push(`${label(e)} ${Math.round(r.width)}x${Math.round(r.height)}`);
  }
  const seen = new Set();
  for (const e of document.querySelectorAll('body *')) {
    if (!e.childNodes.length || ![...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
    if (!vis(e)) continue;
    const fs = parseFloat(getComputedStyle(e).fontSize);
    if (fs < 12) { const k = (e.className || e.tagName) + '@' + fs; if (!seen.has(k)) { seen.add(k); out.tinyText.push(`${fs}px .${e.className} "${e.innerText.trim().slice(0,25)}"`); } }
  }
  return out;
}"""


def run_axe(page):
    page.add_script_tag(content=AXE)
    return page.evaluate("""async () => {
      const r = await axe.run(document, {runOnly: {type: 'tag', values: ['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa','best-practice']}, resultTypes: ['violations']});
      return r.violations.map(v => ({id: v.id, impact: v.impact, help: v.help, n: v.nodes.length,
        nodes: v.nodes.slice(0, 4).map(n => ({target: n.target.join(' '), html: n.html.slice(0, 140), summary: (n.failureSummary||'').slice(0, 220)}))}));
    }""")


def focus_check(page, max_tabs=40):
    """Tab through the page; report elements whose focus has no visible indicator."""
    missing = []
    page.evaluate("document.activeElement && document.activeElement.blur()")
    for _ in range(max_tabs):
        page.keyboard.press("Tab")
        info = page.evaluate("""() => { const e = document.activeElement; if (!e || e === document.body) return null;
          const s = getComputedStyle(e); const r = e.getBoundingClientRect();
          const ring = (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || (s.boxShadow && s.boxShadow !== 'none');
          return {name: (e.getAttribute('aria-label') || e.innerText || e.tagName).trim().replace(/\\s+/g,' ').slice(0,35), ring,
                  covered: (() => { const x = r.left + r.width/2, y = r.top + r.height/2; if (y < 0 || y > innerHeight) return false; const t = document.elementFromPoint(x, y); return t && !e.contains(t) && !t.contains(e); })()}; }""")
        if not info:
            continue
        if not info["ring"] or info["covered"]:
            missing.append(info)
    return missing


def login(page, user, pin):
    page.goto(BASE)
    page.wait_for_load_state("networkidle")
    page.fill("#login-user", user)
    d = page.locator("input[aria-label*='PIN digit']")
    for i, ch in enumerate(pin):
        d.nth(i).fill(ch)
    s = page.locator("button[type=submit]")
    if s.is_visible() and s.is_enabled():
        s.click()
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(600)


report = {}
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, **LAUNCH)
    for scheme in ("light", "dark"):
        mb = MockBackend()
        ctx = browser.new_context(viewport={"width": 390, "height": 844}, locale="ar-IQ", ignore_https_errors=True, color_scheme=scheme)
        ctx.route(f"{SUPA}/**", mb.handle)
        page = ctx.new_page()
        page.goto(BASE)
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(500)
        report[f"{scheme}:login"] = {"axe": run_axe(page), "manual": page.evaluate(MANUAL), "focus": focus_check(page, 15)}
        for user, pin, tabs in (("bio-std01", "482913", ["home", "schedule", "announcements", "exams", "materials", "absences", "account"]),
                                ("bio-rep01", "735164", ["admin"])):
            login(page, user, pin)
            for tab in tabs:
                page.evaluate(f"location.hash = '#{tab}'")
                page.wait_for_load_state("networkidle")
                page.wait_for_timeout(500)
                key = f"{scheme}:{tab}"
                report[key] = {"axe": run_axe(page), "manual": page.evaluate(MANUAL)}
                if scheme == "light":
                    report[key]["focus"] = focus_check(page)
            page.evaluate("localStorage.clear()")
        ctx.close()

    # Reflow at 320 CSS px (WCAG 1.4.10)
    mb = MockBackend()
    ctx = browser.new_context(viewport={"width": 320, "height": 640}, locale="ar-IQ", ignore_https_errors=True)
    ctx.route(f"{SUPA}/**", mb.handle)
    page = ctx.new_page()
    page.goto(BASE)
    page.wait_for_load_state("networkidle")
    reflow = {"login": page.evaluate("document.documentElement.scrollWidth")}
    login(page, "bio-std01", "482913")
    for tab in ["home", "schedule", "announcements", "exams", "materials", "absences", "account"]:
        page.evaluate(f"location.hash = '#{tab}'")
        page.wait_for_timeout(500)
        reflow[tab] = page.evaluate("document.documentElement.scrollWidth")
    report["reflow_320"] = reflow
    browser.close()

OUT.write_text(json.dumps(report, ensure_ascii=False, indent=1))

# ---- summary
agg = defaultdict(lambda: {"impact": "", "help": "", "screens": [], "n": 0, "example": None})
for screen, r in report.items():
    if screen == "reflow_320":
        continue
    for v in r["axe"]:
        a = agg[v["id"]]
        a.update(impact=v["impact"], help=v["help"])
        a["screens"].append(screen)
        a["n"] += v["n"]
        a["example"] = a["example"] or v["nodes"][0]
print("=== axe violations (aggregated) ===")
for k, a in sorted(agg.items(), key=lambda kv: ["critical", "serious", "moderate", "minor"].index(kv[1]["impact"] or "minor")):
    print(f"[{a['impact']}] {k}: {a['help']} — {a['n']} nodes on {len(a['screens'])} screens ({', '.join(a['screens'][:6])})")
    print(f"     e.g. {a['example']['target']} :: {a['example']['html'][:110]}")
    print(f"     {a['example']['summary'][:200]}")
print("\n=== manual checks ===")
for screen, r in report.items():
    if screen == "reflow_320":
        continue
    m = r["manual"]
    line = f"{screen}: overflowX={m['overflowX']} liveRegions={m['liveRegions']} skipLink={m['skipLink']} smallTargets={len(m['smallTargets'])} tinyText={len(m['tinyText'])}"
    if r.get("focus"):
        line += f" focusIssues={len(r['focus'])}"
    print(line)
    for t in m["smallTargets"][:4]:
        print("    target<24px:", t)
    for t in m["tinyText"][:4]:
        print("    text<12px:", t)
    for f in (r.get("focus") or [])[:4]:
        print("    focus:", f)
print("\nreflow @320px scrollWidth:", report["reflow_320"])
