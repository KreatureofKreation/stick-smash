// Boot. Rapier WASM init must happen before Game is constructed.
import { initRapier } from './physics/cannon-shim.js';
import './util/__weaponDebug.js';

async function boot() {
  try {
    await initRapier();
  } catch (err) {
    document.getElementById('loading').textContent = 'Physics engine failed to load: ' + (err?.message || err);
    return;
  }
  const { Game } = await import('./Game.js');
  window.game = new Game();

  document.getElementById('game').addEventListener('contextmenu', (e) => e.preventDefault());

  function checkOrientation() {
    if (window.innerHeight > window.innerWidth && matchMedia('(pointer: coarse)').matches) {
      document.body.classList.add('portrait');
    } else {
      document.body.classList.remove('portrait');
    }
  }
  addEventListener('resize', checkOrientation);
  addEventListener('orientationchange', checkOrientation);
  checkOrientation();
}

boot();
