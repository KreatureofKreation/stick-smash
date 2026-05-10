// Menu UI: title, character select, lobby, settings. Pure DOM.
import { ROSTER } from '../characters/roster.js';
import { LEVELS } from '../levels/definitions.js';
import { audio } from '../audio/Audio.js';
import { SPAWN_TABLE, setDisabledWeapons, getDisabledWeapons } from '../weapons/weapons.js';

export class Menu {
  constructor(game) {
    this.game = game;
    this.root = document.getElementById('ui-root');
    this.selectedChar = ROSTER[0].id;
    this.bots = 3;
    this.level = 'arena';
    this.playerName = localStorage.getItem('pn') || 'P1';
    // Friend opens a shared `?room=foo` URL → drop them straight into the
    // online character picker for that room. Saves a click and makes the
    // shared-link flow feel instant.
    const params = new URLSearchParams(location.search);
    this.show(params.get('room') ? 'online' : 'main');
  }

  show(screen, ...args) {
    audio.click();
    this._stopPadPolling();
    this.root.innerHTML = '';
    if (screen === 'main') return this._main();
    if (screen === 'play') return this._play();
    if (screen === 'local') return this._local();
    if (screen === 'online') return this._online();
    if (screen === 'settings') return this._settings();
    if (screen === 'pause') return this._pause();
    if (screen === 'over') return this._over(...args);
  }

  hide() { this._stopPadPolling(); this.root.innerHTML = ''; }

  _stopPadPolling() {
    if (this._padPollId) { clearInterval(this._padPollId); this._padPollId = null; }
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
  // gamepad each. Live pad list updates as pads connect/disconnect.
  _local() {
    const el = this._menuShell(`
      <div class="panel">
        <h2>LOCAL MULTIPLAYER</h2>
        <p class="hint" style="margin-top:0">P1 = keyboard + mouse. Plug a gamepad for each extra player (up to 3 more). Press any button on the pad to wake it up.</p>
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
      this._stopPadPolling();
      this.hide();
      this.game.startLocal({ character: this.selectedChar, name: this.playerName, bots: this.bots, levelId: this.level, localMP: true });
    };

    // Live pad-slot rendering. Polls every 250ms — gamepadconnected events
    // alone don't fire reliably until the pad gets its first input.
    const slotsEl = el.querySelector('#pad-slots');
    const renderSlots = () => {
      const gps = navigator.getGamepads?.() || [];
      const connected = [];
      for (let i = 0; i < gps.length && connected.length < 3; i++) {
        if (gps[i] && gps[i].connected) connected.push({ idx: i, id: gps[i].id });
      }
      const rows = [];
      rows.push(`<div class="player-row"><div class="swatch" style="--c:#ffcc33"></div><strong>P1</strong> &nbsp;<span style="opacity:0.7">keyboard + mouse</span></div>`);
      for (let i = 0; i < 3; i++) {
        const slot = connected[i];
        if (slot) {
          rows.push(`<div class="player-row"><div class="swatch" style="--c:#66e2a3"></div><strong>P${i + 2}</strong> &nbsp;<span style="opacity:0.7">Pad ${slot.idx} — ${slot.id.split('(')[0].trim().slice(0, 32) || 'gamepad'}</span></div>`);
        } else {
          rows.push(`<div class="player-row" style="opacity:0.45"><div class="swatch" style="--c:#666"></div><strong>P${i + 2}</strong> &nbsp;<span>plug a gamepad + press any button</span></div>`);
        }
      }
      slotsEl.innerHTML = rows.join('');
    };
    renderSlots();
    this._padPollId = setInterval(renderSlots, 250);
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
        <div class="btn-row">
          <button class="btn primary" data-act="back">← BACK</button>
        </div>
      </div>
    `);
    const save = () => {
      const ids = [...el.querySelectorAll('input[type=checkbox]')]
        .filter(cb => !cb.checked)
        .map(cb => cb.dataset.id);
      setDisabledWeapons(ids);
      localStorage.setItem('disabledWeapons', JSON.stringify(ids));
    };
    el.querySelectorAll('input[type=checkbox]').forEach(cb => cb.addEventListener('change', save));
    const setAll = (predicate) => {
      el.querySelectorAll('input[type=checkbox]').forEach(cb => {
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
