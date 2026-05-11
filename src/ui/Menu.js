// Menu UI: title, character select, lobby, settings. Pure DOM.
import { ROSTER, rosterById } from '../characters/roster.js';
import { LEVELS } from '../levels/definitions.js';
import { audio } from '../audio/Audio.js';
import { SPAWN_TABLE, setDisabledWeapons, getDisabledWeapons } from '../weapons/weapons.js';
import { setHapticsEnabled } from '../util/haptics.js';

export class Menu {
  constructor(game) {
    this.game = game;
    this.root = document.getElementById('ui-root');
    this.selectedChar = ROSTER[0].id;
    this.bots = 3;
    this.level = 'arena';
    this.playerName = localStorage.getItem('pn') || 'P1';
    // Per-pad-slot names. Slot 0..2 → P2..P4 defaults. Persisted in localStorage
    // keyed by slot index, NOT physical pad index — so plugging a different pad
    // into slot 0 still picks up the name the user typed for "P2".
    this.padNames = new Map();
    for (let i = 0; i < 3; i++) {
      this.padNames.set(i, localStorage.getItem(`pn-pad${i}`) || `P${i + 2}`);
    }
    // Friend opens a shared `?room=foo` URL → drop them straight into the
    // online character picker for that room. Saves a click and makes the
    // shared-link flow feel instant.
    const params = new URLSearchParams(location.search);
    this.show(params.get('room') ? 'online' : 'main');
    this._applyMobileSettings();
    setHapticsEnabled(localStorage.getItem('mc_haptics') !== '0');
    this._buildFullscreenBtn();
  }

  // One-shot: append a fixed top-right ⛶ toggle. Visible only while a menu
  // screen is up (CSS gates on body.menu-open). iOS Safari throws on
  // requestFullscreen — try/catch swallows. Icon syncs to native fullscreen
  // state via fullscreenchange so F11 / Esc keep the icon honest.
  _buildFullscreenBtn() {
    if (this._fsBtn) return;
    const b = document.createElement('button');
    b.className = 'fs-btn';
    b.type = 'button';
    b.setAttribute('aria-label', 'Toggle fullscreen');
    const sync = () => {
      const on = !!document.fullscreenElement;
      document.body.classList.toggle('fullscreen', on);
      b.textContent = on ? '⛶' : '⛶';
      b.title = on ? 'Exit fullscreen' : 'Enter fullscreen';
    };
    sync();
    b.onclick = async () => {
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      } catch (_) { /* iOS Safari + permissions edge — non-critical */ }
    };
    document.addEventListener('fullscreenchange', sync);
    document.body.appendChild(b);
    this._fsBtn = b;
  }

  show(screen, ...args) {
    audio.click();
    this._stopPadPolling();
    this.root.innerHTML = '';
    document.body.classList.add('menu-open');
    if (screen === 'main') return this._main();
    if (screen === 'play') return this._play();
    if (screen === 'local') return this._local();
    if (screen === 'online') return this._online();
    if (screen === 'settings') return this._settings();
    if (screen === 'pause') return this._pause();
    if (screen === 'over') return this._over(...args);
  }

  hide() {
    this._stopPadPolling();
    this.root.innerHTML = '';
    document.body.classList.remove('menu-open');
  }

  _stopPadPolling() {
    if (this._padPollId) { clearInterval(this._padPollId); this._padPollId = null; }
  }

  // Apply persisted Mobile Controls settings to the live document + input layer.
  // Called from _settings() on every change, and from constructor on boot
  // so left-handed/scale survive page reloads.
  _applyMobileSettings() {
    const sens   = parseFloat(localStorage.getItem('mc_aimSens') || '1') || 1;
    const scale  = localStorage.getItem('mc_btnScale') || 'M';
    const lefty  = localStorage.getItem('mc_lefty') === '1';
    document.documentElement.style.setProperty('--btn-scale', scale === 'S' ? '0.85' : scale === 'L' ? '1.15' : '1');
    document.body.classList.toggle('left-handed', lefty);
    if (this.game?.input?.touch?.applySettings) {
      this.game.input.touch.applySettings({ aimSensitivity: sens });
    }
  }

  _menuShell(html) {
    const el = document.createElement('div');
    el.className = 'menu';
    el.innerHTML = html;
    this.root.appendChild(el);
    return el;
  }

  _main() {
    const el = this._menuShell(`
      <h1>STICK SMASH</h1>
      <div class="tagline">PARTY BRAWLER</div>
      <div class="btn-row" style="flex-direction:column;align-items:center;gap:14px;">
        <button class="btn primary" data-act="online">PLAY ONLINE</button>
        <button class="btn" data-act="play">PLAY SOLO</button>
        <button class="btn" data-act="local">LOCAL MULTIPLAYER</button>
        <button class="btn small" data-act="settings">SETTINGS</button>
      </div>
      <div class="hint" style="margin-top:32px;text-align:center;max-width:560px;line-height:1.7;">
        <b>KEYBOARD</b> &nbsp; Move <kbd>A/D ← →</kbd> &nbsp; Jump <kbd>Space</kbd> &nbsp; Crouch <kbd>S / ↓</kbd> &nbsp; Aim <kbd>Mouse</kbd> &nbsp; Attack <kbd>LMB / J / F</kbd> &nbsp; Grab <kbd>RMB / K / Shift</kbd> &nbsp; Throw <kbd>Q</kbd> &nbsp; Pause <kbd>Esc</kbd>
        <br><b>GAMEPAD</b> &nbsp; Move <kbd>L-stick / D-pad</kbd> &nbsp; Aim <kbd>R-stick</kbd> &nbsp; Crouch <kbd>L-stick ↓</kbd>
        &nbsp; Jump <kbd>A</kbd> &nbsp; Attack <kbd>RT / RB</kbd> &nbsp; Grab <kbd>X / LB / LT</kbd> &nbsp; Throw <kbd>B</kbd> &nbsp; Special <kbd>Y</kbd> &nbsp; Pause <kbd>Start</kbd>
        <br><span style="opacity:0.55">PLAY ONLINE drops you into the live public match. First arrival hosts; everyone else joins. No room codes. <b>?room=name</b> in URL for a private room.</span>
        <br><b>MOBILE</b> &nbsp; rotate to landscape; left joystick + right buttons.
      </div>
    `);
    el.querySelector('[data-act="play"]').onclick = () => this.show('play');
    el.querySelector('[data-act="local"]').onclick = () => this.show('local');
    el.querySelector('[data-act="online"]').onclick = () => this.show('online');
    el.querySelector('[data-act="settings"]').onclick = () => this.show('settings');
  }

  _online() {
    const params = new URLSearchParams(location.search);
    const roomId = params.get('room') || 'public';
    const isPrivate = !!params.get('room');
    const el = this._menuShell(`
      <div class="panel">
        <h2>PLAY ONLINE</h2>
        <p style="opacity:0.8">
          Room: <code>${roomId}</code>${isPrivate ? '' : '  <span style="opacity:0.6">(public — anyone can join)</span>'}
          <br>First arrival hosts. Others drop in. Leave any time.
        </p>
        <hr class="sep">
        <h2>CHARACTER</h2>
        <div class="char-grid"></div>
        <hr class="sep">
        <div class="row">
          <label>Name <input type="text" maxlength="10" value="${this.playerName}" id="pname" /></label>
          <label>Bots <input type="number" min="0" max="6" value="${this.bots}" id="bots" /></label>
          <label>Level <select id="level">${LEVELS.map(l => `<option value="${l.id}" ${l.id === this.level ? 'selected' : ''}>${l.name}</option>`).join('')}</select></label>
        </div>
        <p class="hint" style="margin-top:0">Bots / level only apply if you arrive first and host.</p>
        <div class="btn-row">
          <button class="btn" data-act="back">← BACK</button>
          <button class="btn primary" data-act="go">GO</button>
        </div>
      </div>
    `);
    this._renderRoster(el);
    el.querySelector('#pname').oninput = (e) => { this.playerName = e.target.value || 'P1'; localStorage.setItem('pn', this.playerName); };
    el.querySelector('#bots').oninput = (e) => this.bots = +e.target.value;
    el.querySelector('#level').onchange = (e) => this.level = e.target.value;
    el.querySelector('[data-act="back"]').onclick = () => { this.game.net.disconnect(); this.show('main'); };
    el.querySelector('[data-act="go"]').onclick = () => {
      this.hide();
      this.game.startOnline({
        character: this.selectedChar,
        name: this.playerName,
        bots: this.bots,
        levelId: this.level,
      });
    };
  }

  _play() {
    const el = this._menuShell(`
      <div class="panel">
        <h2>PLAY SOLO</h2>
        <p class="hint" style="margin-top:0">You vs. bots. Keyboard + mouse, or a single gamepad.</p>
        <hr class="sep">
        <h2>SELECT CHARACTER</h2>
        <div class="char-grid"></div>
        <hr class="sep">
        <div class="row">
          <label>Bots <input type="number" min="0" max="7" value="${this.bots}" id="bots" /></label>
          <label>Level
            <select id="level">${LEVELS.map(l => `<option value="${l.id}" ${l.id === this.level ? 'selected' : ''}>${l.name}</option>`).join('')}</select>
          </label>
          <label>Name <input type="text" maxlength="10" value="${this.playerName}" id="pname" /></label>
        </div>
        <div class="btn-row">
          <button class="btn" data-act="back">← BACK</button>
          <button class="btn primary" data-act="start">START</button>
        </div>
      </div>
    `);
    this._renderRoster(el);
    el.querySelector('#bots').oninput = (e) => this.bots = +e.target.value;
    el.querySelector('#level').onchange = (e) => this.level = e.target.value;
    el.querySelector('#pname').oninput = (e) => { this.playerName = e.target.value || 'P1'; localStorage.setItem('pn', this.playerName); };
    el.querySelector('[data-act="back"]').onclick = () => this.show('main');
    el.querySelector('[data-act="start"]').onclick = () => {
      this.hide();
      this.game.startLocal({ character: this.selectedChar, name: this.playerName, bots: this.bots, levelId: this.level, localMP: false });
    };
  }

  // Local multiplayer setup. P1 fixed (kb+mouse). P2-P4 = one connected
  // gamepad each. Each pad gets its own char carousel: L-stick or D-pad
  // left/right cycles, A toggles lock. Locked chars become unavailable to
  // other pads.
  _local() {
    const el = this._menuShell(`
      <div class="panel">
        <h2>LOCAL MULTIPLAYER</h2>
        <p class="hint" style="margin-top:0">P1 = keyboard + mouse. Each gamepad picks its own character — D-pad / L-stick ←→ to cycle, <kbd>A</kbd> to lock. <kbd>B</kbd> to unlock.</p>
        <hr class="sep">
        <h2>YOUR CHARACTER (P1)</h2>
        <div class="char-grid"></div>
        <hr class="sep">
        <h2>PLAYERS</h2>
        <div class="players-list" id="pad-slots"></div>
        <hr class="sep">
        <div class="row">
          <label>Bots <input type="number" min="0" max="7" value="${this.bots}" id="bots" /></label>
          <label>Level
            <select id="level">${LEVELS.map(l => `<option value="${l.id}" ${l.id === this.level ? 'selected' : ''}>${l.name}</option>`).join('')}</select>
          </label>
        </div>
        <div class="btn-row">
          <button class="btn" data-act="back">← BACK</button>
          <button class="btn primary" data-act="start">START</button>
        </div>
      </div>
    `);
    this._renderRoster(el);
    el.querySelector('#bots').oninput = (e) => this.bots = +e.target.value;
    el.querySelector('#level').onchange = (e) => this.level = e.target.value;
    el.querySelector('[data-act="back"]').onclick = () => this.show('main');
    el.querySelector('[data-act="start"]').onclick = () => {
      const extras = this._collectPadExtras();
      this._stopPadPolling();
      this.hide();
      this.game.startLocal({
        character: this.selectedChar,
        name: this.playerName,
        bots: this.bots,
        levelId: this.level,
        localMP: true,
        extras,
      });
    };

    // Per-pad pick state. Map: padIdx → { charIdx, locked, navCD, prev:{a,b,lr} }.
    if (!this.padPicks) this.padPicks = new Map();

    const slotsEl = el.querySelector('#pad-slots');
    const tick = () => {
      this._tickPadPicks();
      this._renderPadSlots(slotsEl);
      this._updateGridCursors(el);
    };
    tick();
    // 60 ms — fast enough for snappy edge-detected button presses, slow
    // enough not to thrash the DOM.
    this._padPollId = setInterval(tick, 60);
  }

  // Cycle direction for one pad. Skips P1's char + already-locked picks
  // from other pads so each player ends up on a unique color.
  _padCycle(padIdx, dir) {
    const taken = this._takenCharIds(padIdx);
    const n = ROSTER.length;
    const cur = this.padPicks.get(padIdx);
    let i = cur?.charIdx ?? 0;
    for (let step = 0; step < n; step++) {
      i = (i + dir + n) % n;
      if (!taken.has(ROSTER[i].id)) {
        cur.charIdx = i;
        return;
      }
    }
  }

  // Char ids reserved by P1 + every other pad (locked OR hovered) except
  // `selfPadIdx`. Treating hovered as taken keeps each player visually on
  // a unique color while picking, even before anyone locks in.
  _takenCharIds(selfPadIdx) {
    const taken = new Set([this.selectedChar]);
    for (const [pi, st] of this.padPicks) {
      if (pi === selfPadIdx) continue;
      taken.add(ROSTER[st.charIdx].id);
    }
    return taken;
  }

  // Read every connected pad, advance its pick state for this tick.
  _tickPadPicks() {
    const gps = navigator.getGamepads?.() || [];
    const connected = [];
    for (let i = 0; i < gps.length && connected.length < 3; i++) {
      if (gps[i] && gps[i].connected) connected.push(i);
    }
    // Drop entries for disconnected pads.
    for (const padIdx of [...this.padPicks.keys()]) {
      if (!connected.includes(padIdx)) this.padPicks.delete(padIdx);
    }
    // Add entries for newly-connected pads. Initial pick = first char not
    // already used by P1 OR by any other pad (locked or just hovered). The
    // any-hovered exclusion stops every pad starting on the same char.
    for (const padIdx of connected) {
      if (this.padPicks.has(padIdx)) continue;
      const taken = new Set([this.selectedChar]);
      for (const [pi, st] of this.padPicks) {
        if (pi !== padIdx) taken.add(ROSTER[st.charIdx].id);
      }
      let initial = 0;
      for (let i = 0; i < ROSTER.length; i++) {
        if (!taken.has(ROSTER[i].id)) { initial = i; break; }
      }
      this.padPicks.set(padIdx, { charIdx: initial, locked: false, navCD: 0, prev: { a: false, b: false, lr: 0 } });
    }
    // Per-pad input edge-detect.
    const now = performance.now();
    for (const padIdx of connected) {
      const gp = gps[padIdx];
      const st = this.padPicks.get(padIdx);
      const ax = gp.axes[0] ?? 0;
      const dpL = !!gp.buttons[14]?.pressed || ax < -0.5;
      const dpR = !!gp.buttons[15]?.pressed || ax > 0.5;
      const lr = dpR ? 1 : dpL ? -1 : 0;
      const a = !!gp.buttons[0]?.pressed;
      const b = !!gp.buttons[1]?.pressed;
      // Cycle on edge (release-to-press) — and also auto-repeat when held
      // past the cooldown so users can scroll quickly.
      if (lr !== 0 && !st.locked) {
        if (st.prev.lr === 0 || now > st.navCD) {
          this._padCycle(padIdx, lr);
          st.navCD = now + (st.prev.lr === 0 ? 250 : 120);
        }
      }
      if (a && !st.prev.a) st.locked = !st.locked;
      if (b && !st.prev.b && st.locked) st.locked = false;
      st.prev.a = a; st.prev.b = b; st.prev.lr = lr;
    }
  }

  // Rebuild the slot rows ONCE per structural change (pad-connect /
  // pad-disconnect), then on every tick update only the inline color +
  // char-name + lock-mark text. Avoids clobbering the name input's focus
  // every 60 ms.
  _renderPadSlots(slotsEl) {
    const gps = navigator.getGamepads?.() || [];
    const connected = [];
    for (let i = 0; i < gps.length && connected.length < 3; i++) {
      if (gps[i] && gps[i].connected) connected.push({ idx: i, id: gps[i].id });
    }
    // Detect structural change to decide whether to rebuild the row DOM.
    const sig = ['P1', ...Array.from({ length: 3 }, (_, i) => connected[i] ? `pad${connected[i].idx}` : 'empty')].join('|');
    if (sig !== this._padSlotsSig) {
      this._padSlotsSig = sig;
      slotsEl.innerHTML = '';
      // P1 row.
      const p1 = document.createElement('div');
      p1.className = 'player-row';
      p1.innerHTML = `<div class="swatch p1-swatch"></div><strong>P1</strong> <input type="text" class="pad-name p1-name" maxlength="10" /> <span class="char-name p1-char" style="opacity:0.85"></span>`;
      slotsEl.appendChild(p1);
      p1.querySelector('.p1-name').value = this.playerName;
      p1.querySelector('.p1-name').oninput = (e) => {
        this.playerName = e.target.value || 'P1';
        localStorage.setItem('pn', this.playerName);
      };
      // P2..P4 slots.
      for (let i = 0; i < 3; i++) {
        const slot = connected[i];
        const row = document.createElement('div');
        row.className = 'player-row';
        row.dataset.slot = String(i);
        if (slot) {
          row.dataset.padIdx = String(slot.idx);
          row.innerHTML = `<div class="swatch"></div><strong>P${i + 2}</strong> <input type="text" class="pad-name" maxlength="10" /> <span class="char-name" style="font-weight:700"></span> <span class="lock-mark"></span> <span style="opacity:0.4;font-size:11px;margin-left:auto">Pad ${slot.idx}</span>`;
          const nameInput = row.querySelector('.pad-name');
          nameInput.value = this.padNames.get(i) || `P${i + 2}`;
          nameInput.oninput = (e) => {
            const v = e.target.value || `P${i + 2}`;
            this.padNames.set(i, v);
            localStorage.setItem(`pn-pad${i}`, v);
          };
        } else {
          row.style.opacity = '0.45';
          row.innerHTML = `<div class="swatch" style="--c:#666"></div><strong>P${i + 2}</strong> <span>plug a gamepad + press any button</span>`;
        }
        slotsEl.appendChild(row);
      }
    }
    // Per-tick state updates — touch only the dynamic bits.
    const p1Row = slotsEl.firstElementChild;
    if (p1Row) {
      const p1Char = rosterById(this.selectedChar);
      const p1Hex = '#' + p1Char.primary.toString(16).padStart(6, '0');
      p1Row.querySelector('.p1-swatch').style.setProperty('--c', p1Hex);
      p1Row.querySelector('.p1-char').textContent = `keyboard + mouse — ${p1Char.name}`;
    }
    for (let i = 0; i < 3; i++) {
      const row = slotsEl.querySelector(`[data-slot="${i}"]`);
      if (!row) continue;
      const slot = connected[i];
      if (!slot) continue;
      const st = this.padPicks.get(slot.idx);
      const c = ROSTER[st?.charIdx ?? 0];
      const hex = '#' + c.primary.toString(16).padStart(6, '0');
      row.querySelector('.swatch').style.setProperty('--c', hex);
      const charName = row.querySelector('.char-name');
      charName.textContent = c.name;
      charName.style.color = hex;
      const lockMark = row.querySelector('.lock-mark');
      if (st?.locked) {
        lockMark.textContent = '🔒 LOCKED';
        lockMark.style.opacity = '1';
        row.style.border = '1px solid ' + hex;
      } else {
        lockMark.innerHTML = '<span style="opacity:0.55">←/→ cycle · A lock</span>';
        row.style.border = '';
      }
    }
  }

  // Add a small "P2"/"P3"/"P4" badge on each char-grid card showing which
  // pads are currently hovering / locked on that char. Solves the bug
  // where the pad's cycle moved the bottom swatch but nothing on the
  // grid itself — making it look like the on-screen cursor desynced.
  _updateGridCursors(rootEl) {
    if (!rootEl) return;
    const grid = rootEl.querySelector('.char-grid');
    if (!grid) return;
    const gps = navigator.getGamepads?.() || [];
    const padsByChar = new Map();   // charId → [{slotIdx, locked}]
    let slotIdx = 0;
    for (let i = 0; i < gps.length && slotIdx < 3; i++) {
      if (!gps[i] || !gps[i].connected) continue;
      const st = this.padPicks.get(i);
      if (st) {
        const cid = ROSTER[st.charIdx].id;
        if (!padsByChar.has(cid)) padsByChar.set(cid, []);
        padsByChar.get(cid).push({ slotIdx, locked: !!st.locked });
      }
      slotIdx++;
    }
    for (const card of grid.querySelectorAll('.char-card')) {
      const cid = card.dataset.id;
      const pads = padsByChar.get(cid) || [];
      let badge = card.querySelector('.pad-cursors');
      if (!badge) {
        badge = document.createElement('div');
        badge.className = 'pad-cursors';
        card.appendChild(badge);
      }
      if (!pads.length) {
        if (badge.innerHTML) badge.innerHTML = '';
        continue;
      }
      const html = pads.map(p =>
        `<span class="pad-cursor s${p.slotIdx}${p.locked ? ' locked' : ''}">P${p.slotIdx + 2}</span>`
      ).join('');
      if (badge.innerHTML !== html) badge.innerHTML = html;
    }
  }

  // Snapshot of pad-bound extras for startLocal. Locked picks honor user's
  // choice; unlocked pads use their currently-hovered char (good default).
  _collectPadExtras() {
    const gps = navigator.getGamepads?.() || [];
    const out = [];
    for (let i = 0; i < gps.length && out.length < 3; i++) {
      if (!gps[i] || !gps[i].connected) continue;
      const st = this.padPicks.get(i);
      const charId = st ? ROSTER[st.charIdx].id : null;
      const slotIdx = out.length;
      const name = this.padNames.get(slotIdx) || `P${slotIdx + 2}`;
      out.push({ padIdx: i, charId, name });
    }
    return out;
  }

  // Stub — Net layer still calls refreshLobby() on peer changes. Drop-in
  // gameplay has no lobby, but the call is harmless. If we later add an
  // in-game players list, populate it here.
  refreshLobby() { /* no-op — drop-in design has no pre-game lobby */ }

  // ── Settings: weapon / item toggles ─────────────────────────────────────
  // The user can disable any spawn-table entry. State lives in localStorage
  // (key `disabledWeapons`, JSON array of ids) so it persists across runs.
  // Game.js reads this on boot. Settings panel groups entries by category.
  _settings() {
    const cats = {
      melee:  { title: 'MELEE',          entries: [] },
      ranged: { title: 'RANGED',         entries: [] },
      joke:   { title: 'JOKE',           entries: [] },
      super:  { title: 'SUPER (RARE)',   entries: [] },
      pickup: { title: 'PICKUPS',        entries: [] },
      power:  { title: 'POWERS',         entries: [] },
    };
    for (const e of SPAWN_TABLE) (cats[e.cat]?.entries || []).push(e);
    const disabled = getDisabledWeapons();
    const renderCat = (key) => {
      const c = cats[key];
      if (!c.entries.length) return '';
      const items = c.entries.map(e => `
        <label class="weapon-toggle">
          <input type="checkbox" data-id="${e.id}" ${disabled.has(e.id) ? '' : 'checked'} />
          <span>${e.label}</span>
        </label>
      `).join('');
      return `<div class="weapon-group"><h3>${c.title}</h3><div class="weapon-grid">${items}</div></div>`;
    };
    const el = this._menuShell(`
      <div class="panel" style="max-width:min(820px,94vw);">
        <h2>SETTINGS</h2>
        <p style="opacity:0.75">Toggle spawn pool. Disabled items never appear in matches.</p>
        <div class="btn-row" style="margin-bottom:8px">
          <button class="btn small" data-act="all">ENABLE ALL</button>
          <button class="btn small" data-act="none">DISABLE ALL</button>
          <button class="btn small" data-act="weaponsonly">WEAPONS ONLY</button>
          <button class="btn small" data-act="powersoff">NO POWERS</button>
        </div>
        <div class="weapon-list">
          ${renderCat('melee')}
          ${renderCat('ranged')}
          ${renderCat('joke')}
          ${renderCat('super')}
          ${renderCat('pickup')}
          ${renderCat('power')}
        </div>
        <hr class="sep">
        <h2>MOBILE CONTROLS</h2>
        <div class="mobile-settings">
          <label>Aim Sensitivity
            <input type="range" min="0.5" max="2" step="0.05" id="mc-sens" value="${parseFloat(localStorage.getItem('mc_aimSens') || '1')}" />
            <span id="mc-sens-val">${parseFloat(localStorage.getItem('mc_aimSens') || '1').toFixed(2)}×</span>
          </label>
          <label>Button Size
            <select id="mc-scale">
              <option value="S" ${(localStorage.getItem('mc_btnScale') || 'M') === 'S' ? 'selected' : ''}>Small</option>
              <option value="M" ${(localStorage.getItem('mc_btnScale') || 'M') === 'M' ? 'selected' : ''}>Medium</option>
              <option value="L" ${(localStorage.getItem('mc_btnScale') || 'M') === 'L' ? 'selected' : ''}>Large</option>
            </select>
          </label>
          <label><input type="checkbox" id="mc-lefty" ${localStorage.getItem('mc_lefty') === '1' ? 'checked' : ''} /> Left-handed (mirror layout)</label>
          <label><input type="checkbox" id="mc-haptics" ${localStorage.getItem('mc_haptics') !== '0' ? 'checked' : ''} /> Haptic feedback</label>
          <button class="btn small" data-act="replay-tut">SHOW TUTORIAL AGAIN</button>
        </div>
        <div class="btn-row">
          <button class="btn primary" data-act="back">← BACK</button>
        </div>
      </div>
    `);
    const weaponBoxes = () => [...el.querySelectorAll('.weapon-toggle input[type=checkbox]')];
    const save = () => {
      const ids = weaponBoxes()
        .filter(cb => !cb.checked)
        .map(cb => cb.dataset.id);
      setDisabledWeapons(ids);
      localStorage.setItem('disabledWeapons', JSON.stringify(ids));
    };
    weaponBoxes().forEach(cb => cb.addEventListener('change', save));
    const setAll = (predicate) => {
      weaponBoxes().forEach(cb => {
        const entry = SPAWN_TABLE.find(e => e.id === cb.dataset.id);
        cb.checked = predicate(entry);
      });
      save();
    };
    el.querySelector('[data-act="all"]').onclick = () => setAll(() => true);
    el.querySelector('[data-act="none"]').onclick = () => setAll(() => false);
    el.querySelector('[data-act="weaponsonly"]').onclick = () =>
      setAll(e => ['melee','ranged','joke','super'].includes(e?.cat));
    el.querySelector('[data-act="powersoff"]').onclick = () =>
      setAll(e => e?.cat !== 'power');
    el.querySelector('[data-act="back"]').onclick = () => this.show('main');
    const sens = el.querySelector('#mc-sens');
    const sensVal = el.querySelector('#mc-sens-val');
    sens.oninput = () => {
      sensVal.textContent = parseFloat(sens.value).toFixed(2) + '×';
      localStorage.setItem('mc_aimSens', sens.value);
      this._applyMobileSettings();
    };
    el.querySelector('#mc-scale').onchange = (e) => {
      localStorage.setItem('mc_btnScale', e.target.value);
      this._applyMobileSettings();
    };
    el.querySelector('#mc-lefty').onchange = (e) => {
      localStorage.setItem('mc_lefty', e.target.checked ? '1' : '0');
      this._applyMobileSettings();
    };
    el.querySelector('#mc-haptics').onchange = (e) => {
      setHapticsEnabled(e.target.checked);  // writes localStorage + updates cache
      this._applyMobileSettings();
    };
    el.querySelector('[data-act="replay-tut"]').onclick = () => {
      localStorage.removeItem('touch_tutorial_done');
      // Trigger overlay open if tutorial module is loaded.
      if (this.game?.tutorial?.show) this.game.tutorial.show();
    };
  }

  _pause() {
    const el = this._menuShell(`
      <div class="panel" style="max-width:380px;">
        <h2>PAUSED</h2>
        <div class="btn-row" style="flex-direction:column;align-items:center;">
          <button class="btn primary" data-act="resume">RESUME</button>
          <button class="btn" data-act="quit">QUIT TO MENU</button>
        </div>
      </div>
    `);
    el.querySelector('[data-act="resume"]').onclick = () => { this.hide(); this.game.paused = false; };
    el.querySelector('[data-act="quit"]').onclick = () => { this.game.endMatch(); this.show('main'); };
  }

  _over(text, sub) {
    const el = this._menuShell(`
      <div class="panel" style="max-width:480px;text-align:center;">
        <h1 style="font-size:48px;background:linear-gradient(90deg,#ffcc33,#ff4d6d,#66e2a3);-webkit-background-clip:text;background-clip:text;color:transparent;">${text}</h1>
        <p>${sub ?? ''}</p>
        <div class="btn-row" style="justify-content:center;">
          <button class="btn primary" data-act="again">PLAY AGAIN</button>
          <button class="btn" data-act="menu">MENU</button>
        </div>
      </div>
    `);
    el.querySelector('[data-act="again"]').onclick = () => { this.hide(); this.game.restart(); };
    el.querySelector('[data-act="menu"]').onclick = () => { this.hide(); this.game.endMatch(); this.show('main'); };
  }

  _renderRoster(el) {
    const grid = el.querySelector('.char-grid');
    if (!grid) return;
    grid.innerHTML = ROSTER.map(c => {
      const p = '#' + c.primary.toString(16).padStart(6, '0');
      const a = '#' + c.accent.toString(16).padStart(6, '0');
      return `<div class="char-card ${c.id === this.selectedChar ? 'selected' : ''}" data-id="${c.id}" tabindex="0" style="--c:${p};--c2:${a}">
        <div class="swatch"></div>
        <div class="name">${c.name}</div>
      </div>`;
    }).join('');
    grid.querySelectorAll('.char-card').forEach(card => {
      card.onclick = () => {
        this.selectedChar = card.dataset.id;
        grid.querySelectorAll('.char-card').forEach(c => c.classList.toggle('selected', c.dataset.id === this.selectedChar));
        audio.click();
      };
    });
  }
}
