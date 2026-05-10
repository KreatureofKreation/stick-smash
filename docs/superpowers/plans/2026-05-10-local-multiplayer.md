# Local Multiplayer (up to 4 players) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add quick-start local multiplayer up to 4 players (P1 = keyboard+mouse, P2–P4 = gamepads auto-detected at match start) without changing the existing solo / bot / online flows.

**Architecture:** Introduce `Game.localPlayers[]` while keeping `Game.localPlayer` aimed at slot 0 for back-compat. Per-player input dispatch via a new `InputManager.getSnapshotFor(source)` reading either keyboard+mouse or a strict gamepad index. Bot count is reduced by the number of extra locals. HUD gains a per-local strip in the four screen corners.

**Tech Stack:** Vanilla ES modules, Three.js, Cannon-es, browser Gamepad API. No test framework — verification is manual via the dev server (`npm start` → http://localhost:5173) and the in-game match flow.

**Spec:** `docs/superpowers/specs/2026-05-10-local-multiplayer-design.md`

---

## File Map

- **Modify** `src/entities/Stickman.js` — store `inputSource` on the player.
- **Modify** `src/input/Input.js` — add `getSnapshotFor(source)`, strict gamepad-by-index polling, multi-pad pause check.
- **Modify** `src/Game.js` — `localPlayers[]`, multi-local input loop, extra-local spawn at match start, `restart()` preservation, `_checkGameOver` rework.
- **Modify** `src/ui/HUD.js` — N-slot HP + weapon strip.
- **Modify** `src/ui/styles.css` — slot positioning for the four corners.

---

### Task 1: Stickman stores its input source

**Files:**
- Modify: `src/entities/Stickman.js:34` (constructor field block)

- [ ] **Step 1: Add the field**

In the constructor, immediately after `this.isBot = opts.isBot ?? false;` (line 35), add:

```js
this.inputSource = opts.inputSource ?? null;  // {kind:'kb-mouse'} | {kind:'gamepad', gamepadIdx:N} | null (bot/net)
```

- [ ] **Step 2: Verify import / no syntax errors**

Run: `node --check src/entities/Stickman.js`
Expected: no output (file parses).

- [ ] **Step 3: Commit**

```bash
git add src/entities/Stickman.js
git commit -m "feat(stickman): add inputSource field for local-MP routing"
```

---

### Task 2: Input dispatcher per source

**Files:**
- Modify: `src/input/Input.js` (append two methods, keep existing API)

- [ ] **Step 1: Add strict per-index gamepad polling**

In `src/input/Input.js`, immediately AFTER the existing `getGamepadSnapshot(idx)` method (ends at line 135 with the closing `}`), add a new method that does **not** fall through to other pads:

```js
  // Strict-by-index gamepad poll. Used by local MP where P2/P3/P4 must each
  // bind to one specific pad. Unlike getGamepadSnapshot(), this returns an
  // empty snapshot if that exact slot is null/disconnected — never bleeds
  // input from another pad into a different player.
  getGamepadSnapshotByIndex(idx) {
    const out = { moveX: 0, moveY: 0, jump: false, attack: false, grab: false, special: false, throw: false, aimX: 1, aimY: 0, aimActive: false };
    const gps = navigator.getGamepads?.() || [];
    const gp = gps[idx];
    if (!gp || !gp.connected) return out;
    const dz = (v) => Math.abs(v) < 0.2 ? 0 : v;
    const btn = (i) => !!gp.buttons[i]?.pressed;
    const axis = (i) => gp.axes[i] ?? 0;
    const trig = (i) => Math.max(0, gp.buttons[i]?.value ?? 0);

    let mx = dz(axis(0));
    let my = -dz(axis(1));
    if (btn(14)) mx = -1;
    if (btn(15)) mx = 1;
    if (btn(12)) my = 1;
    if (btn(13)) my = -1;
    out.moveX = mx;
    out.moveY = my;

    const ax = dz(axis(2)), ay = -dz(axis(3));
    if (Math.hypot(ax, ay) > 0.35) {
      out.aimX = ax; out.aimY = ay; out.aimActive = true;
    }

    out.jump = btn(0);
    out.attack = btn(5) || trig(7) > 0.35;
    out.grab   = btn(2) || btn(4) || trig(6) > 0.35;
    out.throw  = btn(1);
    out.special = btn(3);
    return out;
  }
```

- [ ] **Step 2: Add the source dispatcher**

Immediately after `getGamepadSnapshotByIndex`, add:

```js
  // Returns an input snapshot for any local source descriptor.
  // Used by the per-local-player input loop.
  getSnapshotFor(source) {
    if (!source) return null;
    if (source.kind === 'kb-mouse') return this.getCombined();
    if (source.kind === 'gamepad') return this.getGamepadSnapshotByIndex(source.gamepadIdx);
    return null;
  }
```

- [ ] **Step 3: Multi-pad pause polling**

Replace the existing `consumeGamepadPause()` method (currently lines 138–145) with a version that scans every connected pad:

```js
  // True for one frame on Start/Back press from ANY connected gamepad.
  // Local-MP: any local player's Start triggers pause.
  consumeGamepadPause() {
    const gps = navigator.getGamepads?.() || [];
    let pressed = false;
    for (const gp of gps) {
      if (!gp || !gp.connected) continue;
      if (gp.buttons[8]?.pressed || gp.buttons[9]?.pressed) { pressed = true; break; }
    }
    if (pressed && !this._pausePrev) { this._pausePrev = true; return true; }
    if (!pressed) this._pausePrev = false;
    return false;
  }
```

- [ ] **Step 4: Verify**

Run: `node --check src/input/Input.js`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add src/input/Input.js
git commit -m "feat(input): per-source snapshot dispatcher + strict gamepad-by-index"
```

---

### Task 3: Game tracks localPlayers and routes input per-source

**Files:**
- Modify: `src/Game.js:46` (constructor)
- Modify: `src/Game.js:173` (`_startMatch`)
- Modify: `src/Game.js:251` (`_cleanup`)
- Modify: `src/Game.js:382` (`_spawnPlayer`)
- Modify: `src/Game.js:478` (`_update` local-input block)

- [ ] **Step 1: Constructor — add the array**

In the constructor, find the line:

```js
this.localPlayer = null;
```

(currently `src/Game.js:51`). Add immediately AFTER it:

```js
this.localPlayers = []; // dense, P1 at [0]. localPlayer mirrors localPlayers[0] for back-compat.
```

- [ ] **Step 2: Cleanup — reset the array**

In `_cleanup()` (currently `src/Game.js:251`), find:

```js
this.players = []; this.weapons = []; this.pickups = []; this.projectiles = [];
```

Add immediately AFTER it:

```js
this.localPlayers = [];
```

- [ ] **Step 3: `_spawnPlayer` accepts inputSource**

Replace the existing `_spawnPlayer` method (lines 382–390) with:

```js
  _spawnPlayer({ name, character, isLocal = false, isBot = false, isNet = false, inputSource = null }) {
    const sp = this._pickSpawn();
    const id = this.players.length;
    const sm = new Stickman(this.physics, this.scene, {
      id, name, character, isLocal, isBot, inputSource, spawn: { x: sp.x, y: sp.y }, game: this,
    });
    this.players.push(sm);
    return sm;
  }
```

- [ ] **Step 4: `_startMatch` — spawn locals + adjust bot count**

In `_startMatch` (lines 173–232), replace the entire `if (!asClient) { ... }` block (currently lines 187–211) with:

```js
    if (!asClient) {
      // Local hero (P1) — keyboard + mouse.
      const hero = this._spawnPlayer({
        name: name || 'P1',
        character: rosterById(character || 'bolt'),
        isLocal: true,
        inputSource: { kind: 'kb-mouse' },
      });
      this.localPlayer = hero;
      this.localPlayers = [hero];
      this.character = hero.character;

      // Detect connected gamepads — each becomes one extra local player.
      // Cap at 3 extras (P1 + 3 = 4 total humans).
      const used = new Set([hero.character.id]);
      const gps = navigator.getGamepads?.() || [];
      const padIndices = [];
      for (let i = 0; i < gps.length && padIndices.length < 3; i++) {
        if (gps[i] && gps[i].connected) padIndices.push(i);
      }
      for (let i = 0; i < padIndices.length; i++) {
        const pool = ROSTER.filter(c => !used.has(c.id));
        const pick = pool[Math.floor(Math.random() * pool.length)] || ROSTER[(i + 1) % ROSTER.length];
        used.add(pick.id);
        const lp = this._spawnPlayer({
          name: `P${i + 2}`,
          character: pick,
          isLocal: true,
          inputSource: { kind: 'gamepad', gamepadIdx: padIndices[i] },
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
```

- [ ] **Step 5: `_update` — drive every local from its source**

In `_update`, replace the block that currently begins `// Drive local player input` (line 481) and ends with the line `if (this.net.role === 'client') this.net.sendInput(snap);` (line 500) — i.e. lines 481–501 — with:

```js
    // Drive each local player from its bound input source. Runs in every
    // mode (offline, host, client) because every mode has at least one
    // locally-controlled stickman whose input must be polled.
    {
      const ndc = this.input.getMouseNDC();
      for (const lp of this.localPlayers) {
        if (!lp || !lp.isLocal || !lp.inputSource) continue;
        const snap = this.input.getSnapshotFor(lp.inputSource);
        if (!snap) continue;
        // Mouse aim only for the kb+mouse player. Project NDC onto z=0 plane.
        if (lp.inputSource.kind === 'kb-mouse' && ndc && !snap.aimActive) {
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
```

- [ ] **Step 6: Verify parse**

Run: `node --check src/Game.js`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add src/Game.js
git commit -m "feat(game): localPlayers[] + per-source input routing for couch MP"
```

---

### Task 4: Multi-local game-over handling

**Files:**
- Modify: `src/Game.js:685` (`_checkGameOver`)

- [ ] **Step 1: Replace the function**

Replace the entire `_checkGameOver()` method (currently lines 685–702) with:

```js
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
```

- [ ] **Step 2: Verify parse**

Run: `node --check src/Game.js`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/Game.js
git commit -m "feat(game): last-fighter-standing win + draw handling for local MP"
```

---

### Task 5: Restart preserves the local roster

**Files:**
- Modify: `src/Game.js:274` (`restart`)

- [ ] **Step 1: Replace the method**

Replace the entire `restart()` method (currently lines 274–291) with:

```js
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
    };
    this.levelId = nextId;
    this.startLocal(data);
  }
```

- [ ] **Step 2: Verify parse**

Run: `node --check src/Game.js`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/Game.js
git commit -m "feat(game): restart preserves P1 char; respawns extras from live pads"
```

---

### Task 6: HUD per-local strip

**Files:**
- Modify: `src/ui/HUD.js:5` (constructor markup)
- Modify: `src/ui/HUD.js:71` (`update`)

- [ ] **Step 1: Replace the HUD root markup + cached refs**

Replace the constructor body (currently lines 5–36) with:

```js
  constructor(game) {
    this.game = game;
    this.root = document.getElementById('hud-root');
    this.root.innerHTML = `
      <div id="hud">
        <div class="scoreboard"></div>
        <div class="fps"></div>
      </div>
      <div class="kill-feed"></div>
      <div class="local-strips">
        ${[0,1,2,3].map(i => `
          <div class="local-strip slot-${i}" data-slot="${i}" style="display:none">
            <div class="ls-name"></div>
            <div class="ls-hp-bar"><div class="ls-hp-fill"></div><div class="ls-armor-fill"></div><div class="ls-hp-text"></div></div>
            <div class="ls-weapon" style="display:none"><div class="ls-ico"></div><div class="ls-name-w"></div><div class="ls-ammo"></div></div>
          </div>`).join('')}
      </div>
      <div class="buffs"></div>
      <div class="dmg-flash"></div>
      <div class="time-vignette"></div>
      <div id="center-msg" style="display:none"></div>
    `;
    this.dmgFlashEl = this.root.querySelector('.dmg-flash');
    this.buffsEl = this.root.querySelector('.buffs');
    this.vignetteEl = this.root.querySelector('.time-vignette');
    this.scoreEl = this.root.querySelector('.scoreboard');
    this.fpsEl = this.root.querySelector('.fps');
    this.feedEl = this.root.querySelector('.kill-feed');
    this.centerEl = this.root.querySelector('#center-msg');
    this.localStrips = [...this.root.querySelectorAll('.local-strip')].map(el => ({
      root: el,
      name: el.querySelector('.ls-name'),
      hpBar: el.querySelector('.ls-hp-bar'),
      hpFill: el.querySelector('.ls-hp-fill'),
      armorFill: el.querySelector('.ls-armor-fill'),
      hpText: el.querySelector('.ls-hp-text'),
      weapon: el.querySelector('.ls-weapon'),
      ico: el.querySelector('.ls-ico'),
      nameW: el.querySelector('.ls-name-w'),
      ammo: el.querySelector('.ls-ammo'),
    }));
  }
```

- [ ] **Step 2: Replace `update()` HP + weapon block**

Replace the entire `update()` method (currently lines 71–147) with:

```js
  update() {
    // Scoreboard
    let html = '';
    for (const p of this.game.players) {
      if (!p) continue;
      const hex = (p.character.primary ?? 0xffffff).toString(16).padStart(6, '0');
      const dead = p.state === 'dead' ? 'dead' : '';
      html += `<div class="score-pill ${dead}" style="--c:#${hex}">
        <span class="dot"></span>
        <span>${p.name}</span>
        <span style="opacity:0.7">${p.score}</span>
        <span class="deaths">×${p.lives}</span>
      </div>`;
    }
    this.scoreEl.innerHTML = html;

    // Per-local HP + weapon strips. Slot 0 = P1 (top-left), 1 = P2 (top-right),
    // 2 = P3 (bottom-left), 3 = P4 (bottom-right).
    const locals = this.game.localPlayers || (this.game.localPlayer ? [this.game.localPlayer] : []);
    for (let i = 0; i < this.localStrips.length; i++) {
      const slot = this.localStrips[i];
      const p = locals[i];
      if (!p) { slot.root.style.display = 'none'; continue; }
      slot.root.style.display = '';
      const hex = (p.character.primary ?? 0xffffff).toString(16).padStart(6, '0');
      slot.root.style.setProperty('--c', `#${hex}`);
      slot.name.textContent = p.name;
      if (p.alive) {
        slot.hpBar.style.display = '';
        const pct = Math.max(0, p.health) / p.maxHealth;
        slot.hpFill.style.width = `${pct * 100}%`;
        const hue = pct > 0.5 ? 130 : pct > 0.25 ? 50 : 0;
        slot.hpFill.style.background = `linear-gradient(180deg, hsl(${hue} 80% 60%), hsl(${hue} 70% 40%))`;
        const armorPct = p.armor / p.maxArmor;
        slot.armorFill.style.width = `${armorPct * 100}%`;
        slot.hpText.textContent = p.armor > 0
          ? `${Math.ceil(p.armor)} 🛡 ${Math.ceil(Math.max(0, p.health))} / ${p.maxHealth}`
          : `${Math.ceil(Math.max(0, p.health))} / ${p.maxHealth}`;
      } else {
        slot.hpBar.style.display = 'none';
      }
      if (p.weapon) {
        slot.weapon.style.display = '';
        slot.ico.textContent = p.weapon.icon || '⚔';
        slot.nameW.textContent = p.weapon.name;
        slot.ammo.textContent = isFinite(p.weapon.ammo) ? `× ${p.weapon.ammo}` : '∞';
      } else {
        slot.weapon.style.display = 'none';
      }
    }

    // Active buffs — P1 only (single overlay).
    const local = this.game.localPlayer;
    if (local && local.alive && this.buffsEl) {
      const now = performance.now();
      const buffs = [
        { name: 'flight',  icon: '🪽', until: local.flightUntil,     col: '#9be8ff' },
        { name: 'invis',   icon: '👻', until: local.invisibleUntil, col: '#aaaaaa' },
        { name: 'time',    icon: '⏱', until: local.timeSlowUntil,  col: '#ff4d6d' },
        { name: 'super',   icon: '👊', until: local.superPunchUntil, col: '#ffcc33' },
        { name: 'speed',   icon: '⚡', until: local.speedBoostUntil, col: '#66e2a3' },
        { name: 'gum',     icon: '🟣', until: local.gumGumUntil,    col: '#c870ff' },
        { name: 'push',    icon: '🌀', until: local.forcePushUntil, col: '#77aaff' },
        { name: 'pull',    icon: '🧲', until: local.forcePullUntil, col: '#4dccff' },
        { name: 'lightng', icon: '⚡', until: local.forceLightningUntil, col: '#c870ff' },
        { name: 'choke',   icon: '👐', until: local.forceChokeUntil, col: '#ff4d6d' },
      ];
      let html = '';
      for (const b of buffs) {
        const left = (b.until || 0) - now;
        if (left <= 0) continue;
        const sec = (left / 1000).toFixed(1);
        html += `<div class="buff" style="border-color:${b.col};color:${b.col}"><span>${b.icon}</span><span>${sec}s</span></div>`;
      }
      this.buffsEl.innerHTML = html;
    } else if (this.buffsEl) {
      this.buffsEl.innerHTML = '';
    }

    // Bullet-time vignette
    if (this.vignetteEl) {
      const owner = this.game.timeSlowOwner;
      const slow = owner?.alive && performance.now() < owner.timeSlowUntil;
      this.vignetteEl.style.opacity = slow ? '1' : '0';
    }

    if (this._fpsAcc == null) { this._fpsAcc = 0; this._fpsN = 0; }
  }
```

- [ ] **Step 3: Verify parse**

Run: `node --check src/ui/HUD.js`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add src/ui/HUD.js
git commit -m "feat(hud): per-local HP + weapon strip in four corners"
```

---

### Task 7: HUD slot styling

**Files:**
- Modify: `src/ui/styles.css` (append after line 134)

- [ ] **Step 1: Append the slot CSS**

Add at the END of `src/ui/styles.css`:

```css
/* Local-MP per-player strip — one slot per screen corner. P1=top-left,
   P2=top-right, P3=bottom-left, P4=bottom-right. Slots without a player
   stay display:none and don't affect layout. */
.local-strips { position: absolute; inset: 0; pointer-events: none; }
.local-strip {
  position: absolute;
  display: flex; flex-direction: column; gap: 6px;
  background: rgba(0,0,0,0.42);
  border: 1px solid var(--c, var(--panel-border));
  border-radius: 12px;
  padding: 8px 12px;
  backdrop-filter: blur(6px);
  min-width: 180px;
  box-shadow: 0 0 0 1px rgba(0,0,0,0.3), 0 0 20px -8px var(--c, transparent);
}
.local-strip .ls-name { font-weight: 800; letter-spacing: 1px; font-size: 12px; color: var(--c, #fff); text-shadow: 0 1px 2px rgba(0,0,0,0.7); }
.local-strip .ls-hp-bar { position: relative; height: 16px; background: rgba(0,0,0,0.6); border-radius: 8px; overflow: hidden; border: 1px solid var(--panel-border); }
.local-strip .ls-hp-fill { position: absolute; inset: 0; width: 100%; transition: width 0.18s ease-out, background 0.3s; }
.local-strip .ls-armor-fill { position: absolute; inset: 0; width: 0%; background: linear-gradient(180deg, #c0c8d8, #707888); opacity: 0.85; transition: width 0.18s ease-out; }
.local-strip .ls-hp-text { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 11px; letter-spacing: 1px; text-shadow: 0 1px 2px rgba(0,0,0,0.8); font-variant-numeric: tabular-nums; z-index: 1; }
.local-strip .ls-weapon { display: flex; align-items: center; gap: 8px; font-size: 12px; }
.local-strip .ls-weapon .ls-ico { font-size: 16px; }
.local-strip .ls-weapon .ls-name-w { font-weight: 700; }
.local-strip .ls-weapon .ls-ammo { opacity: 0.7; font-variant-numeric: tabular-nums; }

.local-strip.slot-0 { top: max(12px, var(--safe-t)); left: max(12px, var(--safe-l)); }
.local-strip.slot-1 { top: max(12px, var(--safe-t)); right: max(12px, var(--safe-r)); }
.local-strip.slot-2 { bottom: max(12px, var(--safe-b)); left: max(12px, var(--safe-l)); }
.local-strip.slot-3 { bottom: max(12px, var(--safe-b)); right: max(12px, var(--safe-r)); }

/* Solo play (only slot-0 visible): hide it so the original centered HP bar
   visual isn't doubled up. */
body.solo-mp .local-strip.slot-0 { display: none !important; }
```

> Note: the `body.solo-mp` rule is forward-compat — Task 8 won't actually toggle that class; instead we keep the slot strip even in solo so the user sees the same widget always. Leave the rule in (harmless when class is absent) so a future tweak can switch to a centered solo bar without code edits.

- [ ] **Step 2: Verify file is syntactically valid CSS**

Open the file in the browser (next task) — there's no CSS linter wired in. Skip parse-check.

- [ ] **Step 3: Commit**

```bash
git add src/ui/styles.css
git commit -m "style(hud): four-corner local-MP strip layout"
```

---

### Task 8: Manual end-to-end verification

**Files:** none (verification only).

- [ ] **Step 1: Start the dev server**

Use the preview tools to start the server on the project root (port 5173). Open `http://localhost:5173`.

- [ ] **Step 2: Solo smoke test — no gamepad**

- Click PLAY (BOTS) → pick any character → set Bots=3 → START.
- Confirm: P1 strip shows in top-left with HP/HP-text. No other slots visible.
- Confirm: scoreboard shows 4 pills (P1 + 3 bots).
- Confirm: pause (Esc) works; resume; quit-to-menu works.
- Confirm: console has no errors during the match.

- [ ] **Step 3: 1-pad couch test (if a gamepad is available)**

- Connect a single gamepad. Press any button on it so the browser registers it (open the JS console on a blank tab and run `navigator.getGamepads()` to verify before clicking start).
- PLAY (BOTS) → set Bots=3 → START.
- Confirm: P2 strip appears top-right with a different character color.
- Confirm: gamepad moves P2 (not P1). Mouse aim still controls P1.
- Confirm: total fighters in match = 4 (P1 + P2 + 2 bots — bot count dropped from 3 to 2).
- Confirm: console has no errors.

- [ ] **Step 4: 4-player simulation (no extra hardware)**

- If only one pad is available, use the browser DevTools Gamepad emulator (Chrome: `chrome://gamepad` is read-only; instead use the "Gamepad Tester" extension or simply trust the multi-pad code path was exercised by Task 3's logic).
- Accept that real 4-player verification requires hardware — log this as a follow-up if no pads are available.

- [ ] **Step 5: Game-over flow**

- Use a 1-pad setup. Let bots+P2 kill each other; survive as P1.
- When only P1 is alive → "VICTORY P1 wins!" appears.
- Click PLAY AGAIN → confirm a new match starts with P1 char preserved + P2 still spawned (same pad).
- Now lose deliberately as P1 with P2 still alive: confirm match does **not** end early — it keeps running while P2 fights.

- [ ] **Step 6: Commit any verification fixes**

If issues surfaced, fix them in their respective files and commit individually. If verification passed, no commit needed for this task.

---

## Out-of-band notes

- Damage flash + buffs + bullet-time vignette stay P1-only by design (single full-screen overlays).
- Online mode (`startOnline` / `startHosted`) still spawns a single local — `_startMatch` with `isOnline=true` never enters the gamepad-detection branch because the local-MP code lives inside `if (!asClient)` and `bots/extras` are only spawned for the host of an online match. This matches the spec ("online + local-MP combo" is out of scope).
- Restart from the over-screen randomizes P2–P4 characters again because the gamepad list is re-read at `_startMatch`. Documented; acceptable.
