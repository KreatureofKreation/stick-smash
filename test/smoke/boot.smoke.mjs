// Headless boot + match smoke test. Catches the "white screen on load",
// "players don't spawn", and "main loop throws" regression families that
// dominate the bug history — none of which the pure unit tests can see
// because they need the real Three.js + physics + DOM wired together.
//
// Run: npm run test:smoke
//
// Loads the real index.html in headless Chromium, starts an offline match,
// lets it run, and asserts the game booted, spawned fighters, and ticked
// without throwing. Pure resource-load failures (CDN/PeerJS broker blocked
// by a sandbox proxy) are treated as noise; uncaught JS errors are fatal.
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { serve } from './server.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Resolve Playwright from a local install (CI) or the global one (sandbox).
async function loadChromium() {
  try {
    const pw = await import('playwright');
    return (pw.default ?? pw).chromium;
  } catch {
    const pw = await import('/opt/node22/lib/node_modules/playwright/index.js');
    return (pw.default ?? pw).chromium;
  }
}

// Console errors that are just blocked network fetches (no JS impact) — the
// public PeerJS broker and any CDN the sandbox proxy refuses. Not fatal.
const NETWORK_NOISE = /Failed to load resource|ERR_TUNNEL|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION|net::|peerjs|broker/i;

function fail(msg) {
  console.error(`✗ smoke: ${msg}`);
  process.exitCode = 1;
}

async function main() {
  const chromium = await loadChromium();
  const site = await serve(ROOT);
  const browser = await chromium.launch();
  const page = await browser.newPage();

  const jsErrors = [];   // uncaught exceptions — always fatal
  const badConsole = []; // console.error that isn't network noise
  const blockedCdns = new Set(); // CDN hosts the environment refused
  page.on('pageerror', e => jsErrors.push(e.message));
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (!NETWORK_NOISE.test(t)) badConsole.push(t);
  });
  // The app pulls Three/Rapier/PeerJS from CDNs (see index.html importmap).
  // A locked-down CI/sandbox proxy may refuse them, which means the game
  // can't boot at all — that's an environment limitation, not a regression,
  // so we skip rather than fail.
  page.on('requestfailed', r => {
    const u = r.url();
    if (/esm\.sh|unpkg\.com|jsdelivr/.test(u)) blockedCdns.add(new URL(u).host);
  });

  try {
    await page.goto(site.url + '/', { waitUntil: 'load', timeout: 30000 });

    // 1. Boots: the real Game is constructed and assigned to window.game.
    //    NOTE: <canvas id="game"> clobbers window.game via DOM named access
    //    until boot finishes, so we must probe for a Game-only method, not
    //    just "window.game is an object".
    try {
      await page.waitForFunction('typeof window.game?.startLocal === "function"', { timeout: 25000 });
    } catch (e) {
      if (blockedCdns.size) {
        console.warn(`⚠ SKIP: game CDN dependencies unreachable in this environment (${[...blockedCdns].join(', ')}). Smoke test needs outbound network to boot.`);
        return; // exit 0 — not a regression
      }
      throw e;
    }
    console.log('✓ booted (Game constructed)');

    // 2. Starting an offline match spawns a full roster of fighters.
    await page.evaluate(() => {
      window.game.startLocal({ character: 'bolt', name: 'P1', bots: 3, levelId: 'arena' });
    });
    const spawn = await page.evaluate(() => {
      const g = window.game;
      const live = g.players.filter(Boolean);
      return {
        running: g.running,
        count: live.length,
        hasLocal: !!g.localPlayer,
        allFinite: live.every(p => Number.isFinite(p.position.x) && Number.isFinite(p.position.y)),
        items: g.weapons.length + g.pickups.length,
      };
    });
    if (!spawn.running) fail('match did not enter running state');
    if (spawn.count < 4) fail(`expected >=4 fighters (hero + 3 bots), got ${spawn.count}`);
    if (!spawn.hasLocal) fail('no localPlayer after startLocal');
    if (!spawn.allFinite) fail('a fighter spawned with a non-finite position');
    if (spawn.items < 1) fail('no weapons/pickups spawned into the match');
    console.log(`✓ spawned ${spawn.count} fighters, ${spawn.items} items`);

    // 3. Run the live loop for a few seconds; the tick must not throw.
    //    Game._tick wraps _update in try/catch and renders a #runtime-err
    //    overlay on the first error, so its presence is a hard failure.
    const t0 = await page.evaluate(() => window.game.matchTimer);
    await page.waitForTimeout(4000);
    const after = await page.evaluate(() => {
      const g = window.game;
      return {
        matchTimer: g.matchTimer,
        // _tickErrs is the distinct-error ring buffer Game._tick fills on a throw.
        tickErr: g._tickErrs?.[0] ?? null,
        overlay: !!document.getElementById('runtime-err'),
      };
    });
    if (after.overlay || after.tickErr) fail(`main loop threw: ${after.tickErr ?? 'runtime-err overlay shown'}`);
    if (!(after.matchTimer > t0)) fail(`matchTimer did not advance (${t0} -> ${after.matchTimer})`);
    console.log(`✓ ran ${(after.matchTimer - t0).toFixed(1)}s of match, loop clean`);

    // 4. No uncaught JS errors / unexpected console errors over the whole run.
    if (jsErrors.length) fail(`uncaught JS error(s):\n  ${jsErrors.join('\n  ')}`);
    if (badConsole.length) fail(`unexpected console error(s):\n  ${badConsole.join('\n  ')}`);
    if (!process.exitCode) console.log('✓ no JS errors over full run');
  } catch (err) {
    fail(err?.message ?? String(err));
  } finally {
    await browser.close();
    await site.close();
  }

  if (process.exitCode) console.error('\nsmoke test FAILED');
  else console.log('\nsmoke test passed');
}

main();
