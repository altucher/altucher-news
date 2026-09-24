// Bootstrap: capability checks, then hand control to Game.

import { Game } from './game.js';

function fatal(title, detail) {
  const el = document.getElementById('fatal');
  if (!el) return;
  el.hidden = false;
  el.querySelector('h1').textContent = title;
  el.querySelector('p').textContent = detail;
}

async function boot() {
  const canvas = document.getElementById('game');
  const probe = document.createElement('canvas').getContext('webgl2');
  if (!probe) {
    fatal('WebGL2 is not available', 'BlockCraft needs a browser with WebGL2 (recent Chrome, Edge, Firefox or Safari) and hardware acceleration enabled.');
    return;
  }
  try {
    const game = new Game(canvas);
    await game.start();
  } catch (e) {
    console.error(e);
    fatal('Something went wrong', String(e && e.message ? e.message : e));
  }
}

window.addEventListener('error', (e) => console.error('uncaught', e.error || e.message));
boot();
