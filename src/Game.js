import * as THREE from 'three';
import { PhysicsWorld, COL_GROUPS } from './physics/PhysicsWorld.js';
import { Stickman, STATE } from './entities/Stickman.js';
import { GameCamera } from './effects/Camera.js';
import { Particles } from './effects/Particles.js';
import { InputManager } from './input/Input.js';
import { rosterById, ROSTER } from './characters/roster.js';
import { Bot } from './ai/Bot.js';
import { Level } from './levels/Level.js';
import { getLevel, LEVELS } from './levels/definitions.js';
import { pickRandomSpawn, PICKUP_CLASSES, setDisabledWeapons } from './weapons/weapons.js';
import { audio } from './audio/Audio.js';
import { HUD } from './ui/HUD.js';
import { Menu } from './ui/Menu.js';
import { Net } from './network/Net.js';
import { rand, clamp, lerp } from './util/math.js';

export class Game {
  constructor() {
    // Renderer
    const canvas = document.getElementById('game');
    const isCoarse = matchMedia('(pointer: coarse)').matches;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !isCoarse, powerPreference: 'high-performance' });
    // Pixel ratio: previously 2 desktop / 1.4 coarse ate fillrate on Retina/dense panels.
    // 1.5 / 1.25 keeps text crisp without quadrupling fragment work for AA.
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, isCoarse ? 1.25 : 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = isCoarse ? THREE.BasicShadowMap : THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.35;
    this._isCoarse = isCoarse;
    this._resize = this._resize.bind(this);
    addEventListener('resize', this._resize);
    addEventListener('orientationchange', this._resize);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
    this.gameCam = new GameCamera(this.camera);

    this.physics = new PhysicsWorld();
    this.fx = { particles: new Particles(this.scene), camera: this.gameCam };

    this.input = new InputManager();
    this.players = [];        // dense list, includes nulls when removed
    this.weapons = [];        // active weapon instances (held + free)
    this.pickups = [];        // health/speed/shield etc
    this.projectiles = [];    // tracked for update (Projectile updates itself but we need to remove dead ones)
    this.level = null;
    this.levelId = 'arena';
    this.localPlayer = null;
    this.localPlayers = []; // dense, P1 at [0]. localPlayer mirrors localPlayers[0] for back-compat.
    this.matchTimer = 0;
    this.weaponSpawnTimer = 0;
    this.killFeed = [];
    this.paused = false;
    this.running = false;

    // Restore the player's weapon-toggle preferences before any spawn pool
    // pick happens. Stored as a JSON array of disabled item ids.
    try {
      const raw = localStorage.getItem('disabledWeapons');
      if (raw) setDisabledWeapons(JSON.parse(raw));
    } catch (_) {}

    this.net = new Net(this);
    this.menu = new Menu(this);
    this.hud = new HUD(this);

    this._tick = this._tick.bind(this);
    this._resize();
    requestAnimationFrame(this._tick);

    // Pause on Escape / "P"
    addEventListener('keydown', (e) => {
      if ((e.code === 'Escape' || e.code === 'KeyP') && this.running) this._togglePause();
    });

    // Hide loading
    setTimeout(() => document.getElementById('loading')?.classList.add('hide'), 500);

    // Auto-route to PLAY ONLINE on `?room=` URLs is handled inside the
    // Menu constructor — no extra hook needed here. Removing the old
    // setTimeout(menu.show('join'), 600) which referenced a screen that
    // no longer exists in the drop-in design.

    this._lastFps = 0;
    this._fpsAcc = 0; this._fpsN = 0;
    this.hitStopTimer = 0;
    // Throttle HUD DOM rebuild — innerHTML reflow each frame murders FPS.
    // 10 Hz matches buff text precision (.1s) and scoreboard cadence.
    this._hudAcc = 0;
    // Reused vectors for mouse aim — avoid per-frame Vector3 allocation.
    this._aimNDC = new THREE.Vector3();
    this._aimDir = new THREE.Vector3();
  }
  hitStop(amount = 0.06) { this.hitStopTimer = Math.max(this.hitStopTimer, amount); }

  _gamepadMenuNav() {
    const gps = navigator.getGamepads?.() || [];
    let gp = null;
    for (const c of gps) if (c && c.connected) { gp = c; break; }
    if (!gp) return;
    if (!this._menuPad) this._menuPad = { down: false, up: false, left: false, right: false, a: false, b: false, ax: 0, ay: 0 };
    const dpadUp = !!gp.buttons[12]?.pressed || (gp.axes[1] ?? 0) < -0.5;
    const dpadDown = !!gp.buttons[13]?.pressed || (gp.axes[1] ?? 0) > 0.5;
    const dpadLeft = !!gp.buttons[14]?.pressed || (gp.axes[0] ?? 0) < -0.5;
    const dpadRight = !!gp.buttons[15]?.pressed || (gp.axes[0] ?? 0) > 0.5;
    const a = !!gp.buttons[0]?.pressed;
    const b = !!gp.buttons[1]?.pressed;
    const focusables = [...document.querySelectorAll('#ui-root button, #ui-root input, #ui-root select, #ui-root .char-card')];
    if (focusables.length === 0) return;
    let active = document.activeElement;
    if (!focusables.includes(active)) { focusables[0].focus(); active = focusables[0]; }
    const idx = focusables.indexOf(active);
    if ((dpadDown || dpadRight) && !(this._menuPad.down || this._menuPad.right)) {
      const next = focusables[(idx + 1) % focusables.length];
      next?.focus();
    } else if ((dpadUp || dpadLeft) && !(this._menuPad.up || this._menuPad.left)) {
      const prev = focusables[(idx - 1 + focusables.length) % focusables.length];
      prev?.focus();
    } else if (a && !this._menuPad.a) {
      active?.click?.();
    } else if (b && !this._menuPad.b) {
      // Back: click any back button if present.
      const back = focusables.find(el => /back|leave|menu/i.test(el.textContent || ''));
      back?.click?.();
    }
    this._menuPad = { down: dpadDown, up: dpadUp, left: dpadLeft, right: dpadRight, a, b };
  }

  _togglePause() {
    this.paused = !this.paused;
    if (this.paused) this.menu.show('pause');
    else this.menu.hide();
  }

  _resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // === Match start variants ===
  startLocal({ character, name, bots, levelId, localMP = false, extras = null }) {
    try {
      this._lastLocalMP = !!localMP;
      this._lastExtras = extras ? extras.map(e => ({ ...e })) : null;
      this._startMatch({ character, name, bots, levelId, isOnline: false, localMP: !!localMP, extras });
      this.running = true;
    } catch (err) {
      console.error('startLocal failed:', err);
      alert('Match start failed: ' + (err?.message || err));
      this.menu.show('main');
    }
  }
  startHosted({ character, name, bots, levelId }) {
    this._startMatch({ character, name, bots, levelId, isOnline: true });
    this.running = true;
    // No lobby + no "press start" any more — drop-in netcode spawns each
    // joiner directly into the live match in Net._handleHostMessage.
  }
  // Drop-in entry: try joining the public room; if it's empty, host it.
  // The Net layer handles the join-or-host fallback transparently.
  async startOnline({ character, name, bots, levelId }) {
    const params = new URLSearchParams(location.search);
    const roomId = params.get('room') || (await import('./network/Net.js')).PUBLIC_ROOM;
    this.net.connect(roomId, { character, name, bots, levelId });
  }
  startAsClient({ levelId }) {
    this._startMatch({ character: null, name: null, bots: 0, levelId, isOnline: true, asClient: true });
    this.running = true;
  }

  _startMatch({ character, name, bots, levelId, isOnline, asClient, localPlayerId, localMP = false, extras = null }) {
    this._cleanup();
    this.levelId = levelId;
    this.level = new Level(this.scene, this.physics, this.fx, getLevel(levelId), this);
    this.camera._level = this.level;

    this.players = [];
    this.weapons = [];
    this.pickups = [];
    this.projectiles = [];
    this.killFeed = [];
    this.matchTimer = 0;
    this.weaponSpawnTimer = 1.5;

    if (!asClient) {
      // Local-MP is offline-only AND opt-in. PLAY SOLO never spawns extras
      // even with pads plugged in; only the LOCAL MULTIPLAYER menu sets the
      // localMP flag.
      const allowExtras = !isOnline && localMP;
      // Pad list: explicit extras from the menu (with chosen char ids), or
      // fall back to live-detected pad indices when caller didn't pass any.
      let padPicks = [];
      if (allowExtras) {
        if (extras && extras.length) {
          padPicks = extras.slice(0, 3).map(e => ({ padIdx: e.padIdx, charId: e.charId }));
        } else {
          const gpsAtStart = navigator.getGamepads?.() || [];
          for (let i = 0; i < gpsAtStart.length && padPicks.length < 3; i++) {
            if (gpsAtStart[i] && gpsAtStart[i].connected) padPicks.push({ padIdx: i, charId: null });
          }
        }
      }
      const padIndices = padPicks.map(p => p.padIdx);
      // Pads bound to P2/P3/P4 must NOT bleed into P1, so P1 reads
      // keyboard+mouse+touch only when extras exist.
      const heroSource = padIndices.length > 0
        ? { kind: 'kb-only' }
        : { kind: 'kb-mouse' };

      // Local hero (P1).
      const hero = this._spawnPlayer({
        name: name || 'P1',
        character: rosterById(character || 'bolt'),
        isLocal: true,
        inputSource: heroSource,
      });
      this.localPlayer = hero;
      this.localPlayers = [hero];
      this.character = hero.character;

      // Each detected gamepad becomes one extra local player. Cap at 3 extras
      // (P1 + 3 = 4 total humans). Use the per-pad char id chosen on the
      // setup screen if provided; otherwise pick a random unused char.
      const used = new Set([hero.character.id]);
      for (let i = 0; i < padPicks.length; i++) {
        const pp = padPicks[i];
        let pick = pp.charId ? rosterById(pp.charId) : null;
        // Fallback / collision: if no char id, or char already used, pick a
        // random unused one.
        if (!pick || used.has(pick.id)) {
          const pool = ROSTER.filter(c => !used.has(c.id));
          pick = pool[Math.floor(Math.random() * pool.length)] || ROSTER[(i + 1) % ROSTER.length];
        }
        used.add(pick.id);
        const lp = this._spawnPlayer({
          name: `P${i + 2}`,
          character: pick,
          isLocal: true,
          inputSource: { kind: 'gamepad', gamepadIdx: pp.padIdx },
        });
        this.localPlayers.push(lp);
      }

      // Bots fill remaining slots — locals replace bots one-for-one.
      const remainingBots = Math.max(0, (bots ?? 0) - padIndices.length);
      for (let i = 0; i < remainingBots; i++) {
        const pool = ROSTER.filter(c => !used.has(c.id));
        const pick = pool[Math.floor(Math.random() * pool.length)] || ROSTER[(i + 1) % ROSTER.length];
        used.add(pick.id);
        const bsm = this._spawnPlayer({
          name: pick.name,
          character: pick,
          isBot: true,
        });
        bsm.botBrain = new Bot(bsm);
      }

      // Net players added later via startMatchAsHost.
    } else {
      // Client: build proxy players from snapshot.
      for (let i = 0; i < 8; i++) this.players.push(null);
    }

    // Spawn initial weapons
    for (let i = 0; i < 3; i++) this._spawnRandomItem();

    this.gameCam.setTargets(this.players);
    // Snap camera to hero spawn so we don't zoom in dramatically from origin.
    if (this.localPlayer) {
      this.gameCam.center.set(this.localPlayer.position.x, this.localPlayer.position.y + 1.2, 0);
      this.gameCam.target.copy(this.gameCam.center);
      this.gameCam.zoom = 14;
      this.gameCam.zoomTarget = 14;
    }

    // 3-2-1-FIGHT countdown — freeze all players until it ends.
    if (!asClient) this._startCountdown();

    // Mark match as live so styles.css un-hides #hud-root / #touch-root.
    document.body.classList.add('in-game');
  }

  _startCountdown() {
    // Cancel any pending countdown from the previous match. Without this,
    // a fast PLAY AGAIN (or map rotation) restarts before the prior 3-2-1
    // setTimeouts have fired — both queues then dump their messages on the
    // HUD, producing the "double countdown" bug.
    if (this._countdownTimers) for (const id of this._countdownTimers) clearTimeout(id);
    this._countdownTimers = [];

    const lockMs = 3 * 700 + 200;
    const until = performance.now() + lockMs;
    for (const p of this.players) if (p) p._frozenUntil = until;
    this.hud.showCenter('3', '', 700);
    this._countdownTimers.push(setTimeout(() => { audio.beep?.(660, 0.08, 'square', 0.15); this.hud.showCenter('2', '', 700); }, 700));
    this._countdownTimers.push(setTimeout(() => { audio.beep?.(660, 0.08, 'square', 0.15); this.hud.showCenter('1', '', 700); }, 1400));
    this._countdownTimers.push(setTimeout(() => { audio.beep?.(990, 0.12, 'square', 0.2); this.hud.showCenter('FIGHT', 'last one standing wins', 1200); }, 2100));
  }

  _cleanup() {
    if (this._countdownTimers) {
      for (const id of this._countdownTimers) clearTimeout(id);
      this._countdownTimers = [];
    }
    if (this.level) { this.level.destroy(); this.level = null; }
    for (const p of this.players) if (p) p.destroy();
    for (const w of this.weapons) w.destroy?.();
    for (const p of this.pickups) p.destroy?.();
    for (const p of this.projectiles) p.destroy?.();
    this.players = []; this.weapons = []; this.pickups = []; this.projectiles = [];
    this.localPlayers = [];
    this.localPlayer = null;
    // Clear scene of static lights and bg props
    while (this.scene.children.length > 0) this.scene.remove(this.scene.children[0]);
    // Re-add particles
    this.fx.particles = new Particles(this.scene);

    // Match no longer live — hide HUD + touch controls + clear stale DOM so
    // they don't peek through behind the menu after game over.
    document.body.classList.remove('in-game');
    document.body.classList.remove('local-mp');
    if (this.hud) this.hud.clear();
  }

  endMatch() {
    this.running = false;
    this._cleanup();
    this.net.disconnect();
  }

  restart() {
    if (this.net.role) this.net.disconnect();
    if (!this.localPlayer) return this.menu.show('main');
    // Round-end map rotation: pick a different level for variety.
    const otherIds = LEVELS.map(l => l.id).filter(id => id !== this.levelId);
    const nextId = otherIds.length ? otherIds[Math.floor(Math.random() * otherIds.length)] : this.levelId;
    // Snapshot the local roster before _cleanup nukes it. P1's character is
    // restored verbatim; P2–P4 will be re-randomized from the live pad list
    // inside _startMatch (so disconnected pads' slots simply drop out).
    const heroChar = this.localPlayer.character.id;
    const heroName = this.localPlayer.name;
    const data = {
      character: heroChar,
      name: heroName,
      bots: this.players.filter(p => p?.isBot).length || 3,
      levelId: nextId,
      localMP: !!this._lastLocalMP,
      extras: this._lastExtras,
    };
    this.levelId = nextId;
    this.startLocal(data);
  }

  // Pick spawn point farthest from existing live players AND clear of
  // tile geometry. Prevents stacking and the "spawned inside the floor /
  // wedged into a 1-cell gap" bug.
  _pickSpawn() {
    const points = this.level?.spawnPoints || [{ x: 0, y: 5 }];
    const live = this.players.filter(p => p?.alive);
    // Score = minDist² to nearest live player + jitter; reject blocked points
    // unless every candidate is blocked, in which case fall back to the
    // best-scoring point with a vertical lift to escape any overlap.
    const scored = points.map(sp => {
      let minD = Infinity;
      for (const p of live) {
        const dx = sp.x - p.position.x, dy = sp.y - p.position.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < minD) minD = d2;
      }
      if (!live.length) minD = 100;
      return { sp, score: minD + Math.random() * 0.5, clear: this._isSpawnClear(sp) };
    });
    scored.sort((a, b) => b.score - a.score);
    for (const s of scored) {
      if (s.clear) return s.sp;
    }
    // Fallback: every spawn was blocked (probably mid-match destruction
    // landed on every spawn point). Lift the highest-scoring spawn above
    // any obstruction and use it.
    const best = scored[0].sp;
    return this._liftSpawnClear(best);
  }

  // Returns true if the player capsule (BODY_HEIGHT 1.5, BODY_RADIUS 0.32)
  // fits at this spawn without overlapping any integer-grid tile. Does not
  // catch off-grid sphere/cylinder tiles or dynamic crates — acceptable
  // because those rarely sit on a spawn cell.
  _isSpawnClear(sp) {
    if (!this.level) return true;
    const radius = 0.32;
    const halfH = 0.75;
    // 1. Reject only if the capsule penetrates a tile by more than the
    //    stand-on slop (0.3 units). The old check rejected ANY AABB
    //    overlap, which falsely killed every spawn point that sits ON
    //    top of a platform — those have a small intended overlap
    //    between capsule bottom and tile top. Symptom was players
    //    spawning nowhere on Gauntlet (every spawn directly above a
    //    chain-suspended tile) until something nudged the world.
    const tiles = this.level.tiles;
    if (tiles) {
      const x0 = Math.floor(sp.x - radius);
      const x1 = Math.floor(sp.x + radius);
      const y0 = Math.floor(sp.y - halfH - 0.1);
      const y1 = Math.floor(sp.y + halfH + 0.1);
      for (let gx = x0; gx <= x1; gx++) {
        for (let gy = y0; gy <= y1; gy++) {
          if (!tiles.has(`${gx},${gy}`)) continue;
          const tileTop = gy + 0.5;
          const tileBot = gy - 0.5;
          const capBot = sp.y - halfH;
          const capTop = sp.y + halfH;
          if (capTop <= tileBot || capBot >= tileTop) continue; // no overlap
          // capsule bottom more than 0.3 inside tile = real interpenetration
          if (capBot < tileTop - 0.3) return false;
        }
      }
    }
    // 2. Reject if a static hazard's trigger volume overlaps the capsule.
    // Skips kinetic hazards (saw, pendulum) since they move — those would
    // give false rejections anywhere they pass through.
    for (const h of this.level.hazards ?? []) {
      if (h.kind !== 'lava' && h.kind !== 'spike') continue;
      const hx = h.body?.position?.x ?? h.x;
      const hy = h.body?.position?.y ?? h.y;
      const hw = (h.w ?? 1) / 2 + radius;
      const hh = (h.h ?? 0.4) / 2 + halfH;
      if (Math.abs(sp.x - hx) < hw && Math.abs(sp.y - hy) < hh) return false;
    }
    return true;
  }

  _liftSpawnClear(sp) {
    // Step the spawn upward in 0.5-unit increments until it's clear OR we
    // exceed the play area. Worst-case fallback: original sp.
    let cur = { x: sp.x, y: sp.y };
    for (let i = 0; i < 20; i++) {
      if (this._isSpawnClear(cur)) return cur;
      cur = { x: cur.x, y: cur.y + 0.5 };
    }
    return sp;
  }

  _spawnPlayer({ name, character, isLocal = false, isBot = false, isNet = false, inputSource = null }) {
    const sp = this._pickSpawn();
    const id = this.players.length;
    const sm = new Stickman(this.physics, this.scene, {
      id, name, character, isLocal, isBot, inputSource, spawn: { x: sp.x, y: sp.y }, game: this,
    });
    this.players.push(sm);
    return sm;
  }

  addNetPlayer(name, character) {
    const sp = this.level ? this._pickSpawn() : { x: 0, y: 5 };
    const sm = new Stickman(this.physics, this.scene, {
      id: this.players.length, name, character, isLocal: false, isNet: true, spawn: { x: sp.x, y: sp.y }, game: this,
    });
    this.players.push(sm);
    return sm;
  }
  removeNetPlayer(id) {
    const sm = this.players.find(p => p?.id === id);
    if (sm) sm.destroy();
    this.players = this.players.map(p => p?.id === id ? null : p);
  }

  _spawnRandomItem(opts = {}) {
    const Cls = pickRandomSpawn();
    const isPickup = PICKUP_CLASSES.includes(Cls);
    // Sky drops only for weapons (have physics bodies). Pickups go to spawn pads.
    const fromSky = opts.fromSky ?? (!isPickup && Math.random() < 0.6);
    let x, y;
    if (fromSky) {
      // pick an x near the action; spawn high
      const players = this.players.filter(p => p?.alive);
      const refX = players.length ? players[Math.floor(Math.random() * players.length)].position.x : 0;
      x = refX + rand(-8, 8);
      y = 16 + rand(0, 4);
    } else {
      const sp = this.level.randomWeaponSpawn();
      x = sp.x; y = sp.y;
    }
    let item;
    if (isPickup) {
      item = new Cls(this);
      item.spawnAt(x, y, 0);
      this.pickups.push(item);
    } else {
      item = new Cls(this);
      item.spawnAt(x, y, 0);
      this.weapons.push(item);
      // Give a slight initial spin so it tumbles down
      if (item.body && fromSky) item.body.angularVelocity.set(0, 0, rand(-3, 3));
    }
    this.fx.particles.burst(x, y, 0, { count: 8, color: 0xffffff });
    audio.beep(440, 0.05, 'square', 0.1);
  }

  // === Main loop ===
  _tick(now) {
    requestAnimationFrame(this._tick);
    const dt = Math.min(0.05, ((now - (this._last || now)) / 1000));
    this._last = now;

    this._fpsAcc += dt; this._fpsN++;
    if (this._fpsAcc > 0.5) {
      this.hud.setFPS(this._fpsN / this._fpsAcc);
      this._fpsAcc = 0; this._fpsN = 0;
    }

    try {
      if (this.running && this.input.consumeGamepadPause?.()) this._togglePause();
    // Gamepad menu nav when not in active gameplay.
    if (!this.running || this.paused) this._gamepadMenuNav();
      if (this.running && !this.paused) this._update(dt);
      this.gameCam.update(dt);
      this.renderer.render(this.scene, this.camera);
    } catch (err) {
      if (this._lastTickErr !== String(err)) {
        console.error('Tick error:', err);
        this._lastTickErr = String(err);
        this._showError(err);
      }
    }
    this.input.endFrame();
  }

  _showError(err) {
    let el = document.getElementById('runtime-err');
    if (!el) {
      el = document.createElement('div');
      el.id = 'runtime-err';
      el.style.cssText = 'position:fixed;top:10px;left:10px;right:10px;background:rgba(180,20,30,0.92);color:#fff;padding:14px;border-radius:8px;font-family:monospace;font-size:13px;z-index:9999;white-space:pre-wrap;max-height:60vh;overflow:auto;border:2px solid #ff4d6d;';
      document.body.appendChild(el);
    }
    el.textContent = `Runtime error:\n${err?.stack || err?.message || err}`;
  }

  _update(dt) {
    this.matchTimer += dt;

    // Drive each local player from its bound input source. Runs in every
    // mode (offline, host, client) because every mode has at least one
    // locally-controlled stickman whose input must be polled.
    {
      const ndc = this.input.getMouseNDC();
      for (const lp of this.localPlayers) {
        if (!lp || !lp.isLocal || !lp.inputSource) continue;
        const snap = this.input.getSnapshotFor(lp.inputSource);
        if (!snap) continue;
        // Mouse aim only for the kb-driven player. Project NDC onto z=0 plane.
        if ((lp.inputSource.kind === 'kb-mouse' || lp.inputSource.kind === 'kb-only') && ndc && !snap.aimActive) {
          this._aimNDC.set(ndc.x, ndc.y, 0.5).unproject(this.camera);
          const dir = this._aimDir.copy(this._aimNDC).sub(this.camera.position).normalize();
          if (Math.abs(dir.z) > 1e-4) {
            const t = -this.camera.position.z / dir.z;
            const wx = this.camera.position.x + dir.x * t;
            const wy = this.camera.position.y + dir.y * t;
            const ax = wx - lp.position.x;
            const ay = wy - (lp.position.y + 0.6);
            const m = Math.hypot(ax, ay) || 1;
            snap.aimX = ax / m; snap.aimY = ay / m; snap.aimActive = true;
          }
        }
        Object.assign(lp.input, snap);
        // Online client mode: only P1 (the bound net player) sends input upstream.
        if (this.net.role === 'client' && lp === this.localPlayer) this.net.sendInput(snap);
      }
    }

    // Drive bot inputs
    if (this.net.role !== 'client') {
      for (const p of this.players) {
        if (p?.botBrain) p.botBrain.update(dt, { players: this.players, weapons: this.weapons, pickups: this.pickups, level: this.level });
      }
    }

    // Apply received inputs to net player slots (host only)
    if (this.net.role === 'host') {
      for (const c of this.net.connections.values()) {
        if (c.playerId == null || !c.lastInput) continue;
        const sm = this.players.find(p => p?.id === c.playerId);
        if (sm && sm.alive) Object.assign(sm.input, c.lastInput);
      }
    }

    // Hit-stop + bullet-time scaling.
    let stepDt = dt;
    if (this.hitStopTimer > 0) {
      this.hitStopTimer -= dt;
      stepDt *= 0.05;
    }
    const owner = this.timeSlowOwner;
    if (owner?.alive && performance.now() < owner.timeSlowUntil) stepDt *= 0.4;
    else if (this.timeSlowOwner) this.timeSlowOwner = null;

    // Step physics
    if (this.net.role !== 'client') {
      // Read inputs into bodies + run game logic.
      for (const p of this.players) {
        if (!p) continue;
        p.update(stepDt, { players: this.players, level: this.level });
      }
      // Now step physics to apply the velocities we just wrote.
      this.physics.step(stepDt);
      // Sync visuals to post-step state. Spawn movement FX along the way.
      for (const p of this.players) {
        if (!p) continue;
        p._syncRig(stepDt, p.state === STATE.DEAD);
        p._updateNameTag();
        // Run dust
        if (p.alive && p.grounded && Math.abs(p.body.velocity.x) > 4) {
          p._dustTimer -= stepDt;
          if (p._dustTimer <= 0) {
            // Slide kicks up much more dust than running.
            p._dustTimer = p.sliding ? 0.04 : 0.08;
            this.fx.particles.smokePuff(p.position.x, p.position.y - 0.55, 0, p.sliding ? 0xaaa090 : 0x666655);
            if (p.sliding) {
              this.fx.particles.spark.spawn({
                x: p.position.x, y: p.position.y - 0.55, z: 0,
                vx: -p.body.velocity.x * 0.3, vy: 1.5, vz: 0,
                life: 0.4, size: 0.1, color: 0xaaa090, gravity: -10, drag: 0.6, shrink: 1,
              });
            }
          }
        }
        // Landing dust
        if (p.alive && p.grounded && !p.prevGrounded && Math.abs(p.body.velocity.y) < 4) {
          this.fx.particles.smokePuff(p.position.x, p.position.y - 0.55, 0, 0x888877);
          this.fx.particles.burst(p.position.x, p.position.y - 0.5, 0, { count: 6, speed: 3, color: 0x999988 });
          audio.land();
        }
      }
      for (const w of this.weapons) w.worldTick?.(dt);
      for (const p of this.pickups) {
        if (p.dead) continue;
        p.worldTick(dt);
        // pickup collision
        for (const player of this.players) {
          if (!player || !player.alive) continue;
          if (p.tryPickup(player)) break;
        }
      }
      // Cull dead pickups/weapons
      this.weapons = this.weapons.filter(w => !w._destroyed && (w.holder || w.body || w.mesh?.parent));
      this.pickups = this.pickups.filter(p => !p.dead);

      // Weapon pickup — only when player has no weapon. Generous touch radius.
      for (const w of this.weapons) {
        if (w.holder || !w.body || w.dropCooldown > 0) continue;
        const wx = w.body.position.x, wy = w.body.position.y;
        for (const p of this.players) {
          if (!p || !p.alive || p.weapon) continue;
          const dx = p.position.x - wx;
          const dy = p.position.y - wy;
          if (dx * dx + dy * dy < 1.1 * 1.1) { p.setWeapon(w); break; }
        }
      }

      // Update projectiles
      for (let i = this.projectiles.length - 1; i >= 0; i--) {
        const pr = this.projectiles[i];
        pr.update(dt);
        if (pr.dead) this.projectiles.splice(i, 1);
      }

      // Respawn dead players
      for (const p of this.players) {
        if (!p) continue;
        if (p.state === STATE.DEAD && p.lives > 0 && p.deathTimer <= 0) {
          const sp = this._pickSpawn();
          p.respawn(sp);
        }
      }

      // Tick level: animate hazards, sync dynamic tile meshes to bodies, run player-hazard contact.
      this.level?.update(stepDt, this.players);

      // Item spawning
      this.weaponSpawnTimer -= dt;
      const targetItems = Math.max(2, Math.floor(this.players.filter(p => p?.alive).length * 0.8));
      const total = this.weapons.length + this.pickups.length;
      if (this.weaponSpawnTimer <= 0 && total < targetItems + 2) {
        this._spawnRandomItem();
        this.weaponSpawnTimer = rand(2.5, 4.5);
      }

      // Kill feed
      this._checkKills();

      // Game over: only one player left alive (multi-player) or local player out of lives
      this._checkGameOver();
    }

    // Client-side interpolation toward last received target.
    if (this.net.role === 'client') {
      for (const p of this.players) {
        if (!p || p._netTargetX == null) continue;
        const k = 0.0008;
        p.body.position.x = lerp(p.body.position.x, p._netTargetX, 1 - Math.pow(k, dt));
        p.body.position.y = lerp(p.body.position.y, p._netTargetY, 1 - Math.pow(k, dt));
        p._syncRig(dt, p.state === STATE.DEAD);
        p._updateNameTag();
      }
    }

    // Effects
    this.fx.particles.update(dt);

    // HUD — throttled to ~10 Hz. innerHTML reflow per frame was a major FPS sink.
    this._hudAcc += dt;
    if (this._hudAcc >= 0.1) {
      this._hudAcc = 0;
      this.hud.update();
    }

    // Net broadcast (host)
    if (this.net.role === 'host') {
      this._netBroadcastTimer = (this._netBroadcastTimer || 0) - dt;
      if (this._netBroadcastTimer <= 0) {
        this._netBroadcastTimer = 1 / 20; // 20 Hz
        this.net.broadcast({ t: 'snap', snap: this._snapshot() });
      }
    }
  }

  _checkKills() {
    if (!this._prevDeaths) this._prevDeaths = new Set();
    for (const p of this.players) {
      if (!p) continue;
      if (p.state === STATE.DEAD && !this._prevDeaths.has(p.id)) {
        this._prevDeaths.add(p.id);
        const killer = p.lastDamager;
        const verb = this._verb(p.lastDamageWeapon);
        const text = killer && killer !== p ? `${killer.name} ${verb} ${p.name}` : `${p.name} died`;
        this.hud.killFeed(text);
        if (this.net.role === 'host') this.net.broadcast({ t: 'event', ev: { t: 'kill', text } });
      } else if (p.state !== STATE.DEAD && this._prevDeaths.has(p.id)) {
        this._prevDeaths.delete(p.id);
      }
    }
  }
  _verb(w) {
    return ({ sword: 'sliced', bat: 'launched', pistol: 'shot', shotgun: 'blasted', minigun: 'shredded', bow: 'pierced',
              grenade: 'exploded', rpg: 'rocketed', chicken: 'chickened', boomerang: 'flung', fish: 'slapped',
              fist: 'KO\'d', super: 'obliterated', gumgum: 'stretched', flame: 'burned', ice: 'froze',
              lightning: 'shocked', nuke: 'NUKED', corpse: 'corpse-bashed', thrown: 'pelted',
              saber: 'lightsabered', forcePush: 'force-pushed', forcePull: 'pulled', choke: 'choked',
              longsword: 'cleaved', mace: 'maced', hammer: 'crushed', halberd: 'halberded',
              explosion: 'blasted', lava: 'cooked', spike: 'spiked', saw: 'sawed', blade: 'guillotined', projectile: 'shot' })[w] || 'KO\'d';
  }

  _checkGameOver() {
    if (!this.localPlayers || this.localPlayers.length === 0) return;
    // A player is still "in the match" while they have lives remaining. Being
    // mid-respawn (state===DEAD with lives>0) does NOT count them out — they'll
    // be back. Only when lives==0 and state===DEAD are they truly eliminated.
    const stillIn = this.players.filter(p => p && p.lives > 0);
    const totalEverIn = this.players.filter(p => p).length;

    // Solo: keep the existing "you died" early exit so the over-screen fires
    // the moment P1 runs out of lives.
    if (this.localPlayers.length === 1) {
      const local = this.localPlayer;
      if (local.lives <= 0 && local.state === STATE.DEAD) {
        this.running = false;
        audio.death();
        setTimeout(() => this.menu.show('over', 'KO!', `${local.name} eliminated.`), 1200);
        return;
      }
    }

    if (totalEverIn <= 1) return;

    // All locals dead AND no one alive → simultaneous wipeout = draw.
    if (stillIn.length === 0) {
      this.running = false;
      audio.death();
      setTimeout(() => this.menu.show('over', 'DRAW', 'Everyone went down.'), 1200);
      return;
    }

    // Last fighter standing wins — anyone, not just P1.
    if (stillIn.length === 1) {
      const winner = stillIn[0];
      this.running = false;
      const localWon = this.localPlayers.includes(winner);
      if (localWon) audio.win(); else audio.death();
      const sub = `${winner.name} wins!`;
      setTimeout(() => this.menu.show('over', 'VICTORY', sub), 800);
    }
  }

  _snapshot() {
    const data = {
      players: this.players.map(p => p ? {
        id: p.id, name: p.name, character: p.character,
        x: p.position.x, y: p.position.y,
        vx: p.body.velocity.x, vy: p.body.velocity.y,
        f: p.facing, ax: p.aimDir.x, ay: p.aimDir.y,
        s: p.state, hp: p.health, l: p.lives, sc: p.score,
        wp: p.weapon ? p.weapon.name : null,
        at: p.attackTimer, gr: p.grabbing ? 1 : 0,
      } : null),
      tiles: [...this.level.tiles.values()].map(t => [t.gx, t.gy, t.hp]),
    };
    // Curved-gravity levels also ship player rotation + wedge HP. Meteors
    // are host-only render in v1 (clients don't simulate them yet).
    if (this.level?.curvedGravity) {
      data.playersQ = this.players.map(p => p
        ? [p.body.quaternion.x, p.body.quaternion.y, p.body.quaternion.z, p.body.quaternion.w]
        : null);
      data.wedges = [];
      for (const planet of (this.level.planets ?? [])) {
        for (const w of planet.wedges) {
          if (w && w.hp < w.maxHp && w.hp > 0) data.wedges.push([planet.id, w.kind, w.idx, w.hp]);
        }
      }
    }
    return data;
  }

  applySnapshot(snap) {
    // Client-side: set players' positions/states from authoritative snapshot.
    if (!this.level) return;
    for (let i = 0; i < snap.players.length; i++) {
      const sp = snap.players[i];
      if (!sp) {
        if (this.players[i]) {
          if (this.players[i] === this.localPlayer) this.localPlayer = null;
          this.players[i].destroy();
          this.players[i] = null;
        }
        continue;
      }
      let p = this.players[i];
      if (!p) {
        p = new Stickman(this.physics, this.scene, {
          id: sp.id, name: sp.name, character: sp.character, isLocal: false, isNet: true,
          spawn: { x: sp.x, y: sp.y }, game: this,
        });
        this.players[i] = p;
        if (sp.id === this.net.localPlayerId) {
          this.localPlayer = p;
          this.localPlayer.isLocal = true;
          this.localPlayer.inputSource = { kind: 'kb-mouse' };
          this.localPlayers = [p];
        }
      }
      // First snapshot for this player: snap to position. Subsequent: interpolate.
      if (!p._firstSnapApplied) {
        p.body.position.set(sp.x, sp.y, 0);
        p._firstSnapApplied = true;
      }
      p._netTargetX = sp.x;
      p._netTargetY = sp.y;
      p.body.velocity.set(sp.vx, sp.vy, 0);
      p.facing = sp.f;
      p.aimDir.set(sp.ax, sp.ay);
      p.state = sp.s;
      p.health = sp.hp;
      p.lives = sp.l;
      p.score = sp.sc;
      p.attackTimer = sp.at;
      p.grounded = Math.abs(sp.vy) < 0.5;
    }
    // Tile HP updates -> destroy locally
    for (const [gx, gy, hp] of snap.tiles) {
      const t = this.level.tiles.get(`${gx},${gy}`);
      if (t && hp <= 0) t.destroy();
      else if (t) t.hp = hp;
    }
    // Curved-gravity: apply player quaternion + wedge HP (sent only by host
    // when level.curvedGravity is true).
    if (snap.playersQ) {
      for (let i = 0; i < snap.playersQ.length; i++) {
        const q = snap.playersQ[i];
        const p = this.players[i];
        if (!p || !q) continue;
        p.body.quaternion.set(q[0], q[1], q[2], q[3]);
      }
    }
    if (snap.wedges && this.level?.planets) {
      for (const [planetId, kind, idx, hp] of snap.wedges) {
        const planet = this.level.planets.find(pp => pp.id === planetId);
        if (!planet) continue;
        const w = planet.wedges.find(ww => ww && ww.kind === kind && ww.idx === idx);
        if (w && hp < w.hp) w.damage(w.hp - hp);
      }
    }
  }

  handleNetEvent(ev) {
    if (ev.t === 'kill') this.hud.killFeed(ev.text);
  }

  // Helper for projectiles to register themselves
  registerProjectile(pr) { this.projectiles.push(pr); }
}
