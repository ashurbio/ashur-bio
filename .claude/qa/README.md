# QA harness for the Life Sciences portal

Playwright tests that run the built site (`web/dist`) against a **mocked Supabase backend**, so every screen
(student and representative) can be exercised without touching real data or needing network access
to Supabase.

| File | What it does |
|------|--------------|
| `mock_backend.py` | Fakes `/auth/v1`, `/rest/v1` and `/functions/v1` with sample subjects, schedule, exams, materials and announcements. Users: `bio-std01` / `482913` (student), `bio-rep01` / `735164` (owner). |
| `test_e2e.py` | Login (wrong and right PIN), session persistence, every tab, student blocked from admin, More sheet + Escape, absence +1 saves, logout, rep admin panel, dark mode, desktop, register form. Saves screenshots. |
| `test_a11y.py` | axe-core (WCAG 2.2 AA + best practices) on every screen in light and dark, plus manual checks: text under 12px, tap targets under 24px, focus hidden behind the fixed bars, reflow at 320px. |
| `gzserver.py` | Static server that gzips like GitHub Pages, for realistic Lighthouse runs. |

## Run

```bash
pip install playwright==1.56.0          # Chromium: preinstalled in cloud sessions, else `playwright install chromium`
cd web && npm install && npm run build && cd ..   # tests run against web/dist
cd .claude/qa && npm install --no-save axe-core@4 lighthouse@12

# from .claude/qa — use `exec` so the helper can stop the server cleanly
python3 ../skills/webapp-testing/scripts/with_server.py \
  --server "exec python3 -m http.server 8000 --directory ../../web/dist" --port 8000 \
  -- python3 test_e2e.py http://localhost:8000/ shots

python3 ../skills/webapp-testing/scripts/with_server.py \
  --server "exec python3 -m http.server 8000 --directory ../../web/dist" --port 8000 \
  -- python3 test_a11y.py http://localhost:8000/ a11y.json

# Lighthouse (mobile) on the login page
python3 ../skills/webapp-testing/scripts/with_server.py \
  --server "exec python3 gzserver.py 8001 ../../web/dist" --port 8001 \
  -- npx lighthouse http://127.0.0.1:8001/ --chrome-flags="--headless=new --no-sandbox" --output=html --output-path=./lh.html
```

If the app's REST queries or tables change, update `mock_backend.py` to match.
