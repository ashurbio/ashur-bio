// Web fonts are cosmetic. On a first visit they load only after the first paint, so on a slow
// connection they never compete with the app script; the page shows the system font until they
// arrive. Once they have loaded in this browser they are cached, so later visits add them straight
// away and the page paints with them from the start.
import faces from '@/fonts/fonts.css?inline';

const SLOT = 'ashur-bio-fonts';

function addFonts() {
  const style = document.createElement('style');
  style.textContent = faces;
  document.head.append(style);
  document.fonts?.addEventListener('loadingdone', () => {
    try { localStorage.setItem(SLOT, '1'); } catch { /* ignore */ }
  }, { once: true });
}

function afterFirstPaint(fn) {
  let done = false;
  const run = () => { if (!done) { done = true; fn(); } };
  if (window.PerformanceObserver?.supportedEntryTypes?.includes('paint')) {
    new PerformanceObserver((list, obs) => {
      if (list.getEntriesByName('first-contentful-paint').length) { obs.disconnect(); run(); }
    }).observe({ type: 'paint', buffered: true });
    setTimeout(run, 5000); // e.g. a tab opened in the background, which reports no paint until shown
  } else {
    requestAnimationFrame(() => setTimeout(run, 0));
  }
}

export function initFonts() {
  let cached = false;
  try { cached = localStorage.getItem(SLOT) === '1'; } catch { /* ignore */ }
  if (cached) addFonts();
  else afterFirstPaint(addFonts);
}
