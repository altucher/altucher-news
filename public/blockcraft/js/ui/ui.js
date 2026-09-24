// STUB — minimal UI (real implementation replaces this).
export class UI {
  constructor(game) {
    this.game = game;
    this.root = document.getElementById('ui-root');
    this.el = document.createElement('div');
    this.el.style.cssText = 'position:fixed;left:8px;top:8px;color:#fff;font:12px monospace;white-space:pre;pointer-events:none;text-shadow:0 1px 2px #000';
    this.root.appendChild(this.el);
  }
  setState(state) { this.state = state; }
  setLoading(p, label) { this.el.textContent = `${label} ${(p * 100) | 0}%`; }
  update(s) {
    if (!s.player) return;
    const p = s.player.position;
    this.el.textContent = `fps ${s.fps.toFixed(0)}  xyz ${p.map((v) => v.toFixed(1)).join(' ')}`;
  }
  toast(msg) { console.log('[toast]', msg); }
}
