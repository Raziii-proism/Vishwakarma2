/**
 * Notifications & Loading utilities
 */

// ── Loading screen ────────────────────────────────────────────────────────────
export function setLoadingStatus(msg) {
  const el = document.getElementById('loading-status');
  if (el) el.textContent = msg;
}

export function setLoadingProgress(pct) {
  const fill = document.getElementById('loading-fill');
  if (fill) fill.style.width = `${pct}%`;
}

export function hideLoadingScreen() {
  const screen = document.getElementById('loading-screen');
  if (!screen) return;
  screen.style.transition = 'opacity 0.6s ease';
  screen.style.opacity = '0';
  setTimeout(() => { screen.style.display = 'none'; }, 650);
}

// ── Toast notifications ───────────────────────────────────────────────────────
export function notify(message, type = 'info') {
  const container = document.getElementById('notifications');
  if (!container) { console.log(`[${type.toUpperCase()}] ${message}`); return; }

  const el = document.createElement('div');
  el.className = `notification ${type}`;
  el.textContent = message;
  container.appendChild(el);

  setTimeout(() => {
    el.style.transition = 'opacity 0.3s, transform 0.3s';
    el.style.opacity = '0';
    el.style.transform = 'translateY(-8px)';
    setTimeout(() => el.remove(), 350);
  }, 3000);
}
