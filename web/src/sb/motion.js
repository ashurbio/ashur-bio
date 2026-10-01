// "Reduce motion" switch for the animated background (per device, stored locally).
const SLOT = 'ashur-bio-motion';

export function getMotion() {
  try { return localStorage.getItem(SLOT) !== 'off'; } catch { return true; }
}

export function setMotion(on) {
  try { localStorage.setItem(SLOT, on ? 'on' : 'off'); } catch { /* ignore */ }
  document.documentElement.dataset.motion = on ? 'on' : 'off';
}

export function initMotion() {
  document.documentElement.dataset.motion = getMotion() ? 'on' : 'off';
}
