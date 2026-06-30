// Drop-in / drop-out networking on top of PeerJS.
//
// Design: ONE shared room per URL (default `stick-smash-public`, override
// with `?room=foo`). Anyone who clicks PLAY ONLINE tries to connect to
// that peer ID as a CLIENT first. If nobody owns the ID, the connect
// errors with `peer-unavailable` → the visitor claims the ID themselves
// and becomes the HOST. First arrival hosts; everyone after joins them.
//
// Drop-in: host spawns each new peer into the LIVE match the moment the
// peer says hello. This is the DEFAULT path (Quick Play). A room-code lobby
// with ready-up (Create/Join Room) is ALSO available when opts.lobby=true.
//
// Room-code lobby (NEW): pass opts.lobby=true + opts.code to enter a
// pre-match lobby instead of immediately starting. Host broadcasts
// roster state; clients ready-up; host clicks START. Drop-in stays
// default and is completely unchanged when lobby:false (the default).
//
// Drop-out / host migration: if a client loses their conn (host left,
// flaky network, etc.), they automatically reconnect, which kicks off the
// same auto-detect flow — somebody will become the new host. Random
// jitter on retry minimizes simultaneous-claim races.
import Peer from 'peerjs';
import { rosterById } from '../characters/roster.js';
import { sanitizeSnapshot, sanitizeInput } from './Snapshot.js';

export const PUBLIC_ROOM = 'stick-smash-public';

export class Net {
  constructor(game) {
    this.game = game;
    this.peer = null;
    this.role = null;
    this.roomId = null;
    this.connections = new Map(); // peerId -> { conn, name, character, lastInput, playerId, ready }
    this.peers = [];
    this.localPlayerId = null;
    this._connectOpts = null;
    this._migrating = false;
    this._intentionalDisconnect = false;
    this._joinResolveTimer = null;
    // Lobby state (host-side)
    this._lobby = false;
    this._code = null;
    this._hostName = null;
    this._hostChar = null;
    this._lobbyLevel = 'arena';
    this._lobbyBots = 2;
  }

  _newPeer(id) {
    // Multiple STUN endpoints + free TURN relays so symmetric NAT users can
    // still establish data channels. Without TURN, ~30% of users behind home
    // routers will silently fail at ICE gathering.
    const iceServers = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun.cloudflare.com:3478' },
      { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
      { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
      { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
    ];
    return new Peer(id, {
      debug: 1,
      config: { iceServers, iceCandidatePoolSize: 10 },
    });
  }

  // ── Public entry point ─────────────────────────────────────────────────
  // The user clicks PLAY ONLINE → menu gathers (character, name, bots,
  // levelId), then calls this. We try to JOIN the shared room first; if
  // the host slot is empty we claim it and host instead.
  //
  // opts.lobby=true → room-code lobby mode (Create/Join Room).
  // opts.code      → the 4-char room code (lobby mode only).
  // No lobby (default) → drop-in, starts match immediately on host.
  async connect(roomId, opts) {
    if (this.peer) try { this.peer.destroy(); } catch (_) {}
    this.role = null;
    this.roomId = roomId;
    this._connectOpts = opts;
    this._intentionalDisconnect = false;
    this._migrating = false;

    // Store lobby settings so _becomeHost can read them.
    this._lobby = !!opts?.lobby;
    this._code = opts?.code ?? null;
    this._hostName = opts?.name ?? null;
    this._hostChar = opts?.character ?? null;
    this._lobbyLevel = opts?.levelId ?? 'arena';
    this._lobbyBots = opts?.bots ?? 2;

    // Anonymous peer first — try connecting AS A CLIENT to the well-known
    // host ID. If nobody owns that ID (peer-unavailable), promote ourselves.
    this.peer = this._newPeer();
    this.peer.on('open', () => this._tryJoin(roomId, opts));
    this.peer.on('error', (err) => this._onAnonError(err, roomId, opts));
  }

  _tryJoin(roomId, opts) {
    const conn = this.peer.connect(roomId, { reliable: true });
    this.conn = conn;
    let resolved = false;
    const fallbackToHost = () => {
      if (resolved) return;
      resolved = true;
      clearTimeout(this._joinResolveTimer);
      this._becomeHost(roomId, opts);
    };
    conn.on('open', () => {
      resolved = true;
      clearTimeout(this._joinResolveTimer);
      this._asClient(conn, opts);
    });
    conn.on('error', () => fallbackToHost());
    // Some PeerJS errors arrive on the peer (not the conn). Cap the wait so
    // a silent failure still triggers host promotion.
    this._joinResolveTimer = setTimeout(fallbackToHost, 6000);
  }

  _onAnonError(err, roomId, opts) {
    if (err.type === 'peer-unavailable' || err.type === 'unavailable-id') {
      // The host slot is empty. Claim it.
      this._becomeHost(roomId, opts);
    } else if (err.type === 'browser-incompatible') {
      alert('This browser does not support WebRTC. Try Chrome / Firefox / Edge.');
      this.disconnect();
    } else {
      console.warn('peer error', err);
      // Most other errors (network, server-error) — try host fallback as
      // a last resort. Still useful when the broker is down.
      this._becomeHost(roomId, opts);
    }
  }

  // ── Client path ────────────────────────────────────────────────────────
  _asClient(conn, opts) {
    this.role = 'client';
    this.conn = conn;
    // Send hello with lobby flag so host knows we're in lobby mode.
    try { conn.send({ t: 'hello', name: opts.name, character: opts.character, lobby: !!opts?.lobby }); } catch (_) {}
    conn.on('data', (data) => this._handleClientMessage(data));
    conn.on('close', () => this._onClientLost());
    conn.on('error', (e) => console.warn('conn err', e));
  }

  _onClientLost() {
    if (this._intentionalDisconnect) return;
    if (this._migrating) return;
    this._migrating = true;
    // If the host dropped while we were still in the lobby (match never started),
    // just return to the main menu — don't auto-reconnect into a new host lobby.
    if (this._lobby) {
      this._migrating = false;
      this._lobby = false;
      try { this.game.lobbyActive = false; } catch (_) {}
      try { this.game.menu.show('main'); } catch (_) {}
      return;
    }
    // Tear down match — we're either reconnecting or becoming the new host.
    try { this.game.endMatch(); } catch (_) {}
    // Random jitter so multiple displaced clients don't all race to claim
    // the host slot at the same instant.
    const delay = 500 + Math.random() * 2000;
    setTimeout(() => {
      this._migrating = false;
      this.connect(this.roomId, this._connectOpts);
    }, delay);
  }

  _handleClientMessage(data) {
    if (!data || !data.t) return;
    if (data.t === 'lobby') {
      // Host is broadcasting lobby state. Enter/update lobby screen.
      this.game.enterLobby({
        isHost: false,
        code: data.code,
        levelId: data.levelId,
        bots: data.bots,
        players: data.players,
      });
    } else if (data.t === 'start') {
      this.localPlayerId = data.playerId;
      // Clear lobby state on match start.
      this._lobby = false;
      this.game.startAsClient({ levelId: data.level });
      if (data.snap) { const clean = sanitizeSnapshot(data.snap); if (clean) this.game.applySnapshot(clean); }
    } else if (data.t === 'snap') {
      const clean = sanitizeSnapshot(data.snap);
      if (clean) this.game.applySnapshot(clean);
    } else if (data.t === 'gameover') {
      this.game.running = false;
      setTimeout(() => this.game.menu?.show('over', data.text, data.sub), 800);
    } else if (data.t === 'event') {
      this.game.handleNetEvent(data.ev);
    } else if (data.t === 'pong') {
      this._lastPing = performance.now() - data.ts;
    }
  }

  // Client sends ready state to host.
  sendReady(ready) {
    if (this.role !== 'client' || !this.conn?.open) return;
    try { this.conn.send({ t: 'ready', ready: !!ready }); } catch (_) {}
  }

  // ── Host path ──────────────────────────────────────────────────────────
  _becomeHost(roomId, opts) {
    opts = opts || {};
    if (this.peer) try { this.peer.destroy(); } catch (_) {}
    this.role = 'host';
    this.roomId = roomId;
    this.peer = this._newPeer(roomId);
    let opened = false;
    this.peer.on('open', () => {
      opened = true;
      if (this._lobby) {
        // Lobby mode: show the lobby screen instead of starting immediately.
        // The host's own roster entry is always ready (they're the host).
        this.game.enterLobby({
          isHost: true,
          code: this._code,
          levelId: this._lobbyLevel,
          bots: this._lobbyBots,
          players: this._buildRoster(),
        });
      } else {
        // Drop-in: match starts immediately. Late joiners will be spawned
        // mid-match as they come in.
        this.game.startHosted({
          character: opts.character,
          name: opts.name,
          bots: opts.bots ?? 2,
          levelId: opts.levelId ?? 'arena',
        });
      }
    });
    this.peer.on('error', (err) => {
      if (err.type === 'unavailable-id') {
        // Race condition: another visitor claimed the host slot between
        // our peer-unavailable read and our claim. Retry as client.
        const delay = 400 + Math.random() * 1600;
        setTimeout(() => this.connect(roomId, opts), delay);
        return;
      }
      if (err.type === 'browser-incompatible') {
        alert('This browser does not support WebRTC.');
        return;
      }
      // Don't tear the user out of an established match for transient
      // connection errors — log and keep going.
      console.warn('peer error (host)', err);
      if (!opened) {
        alert('Network error: ' + err.type);
        this.disconnect();
        try { this.game.menu.show('main'); } catch (_) {}
      }
    });
    this.peer.on('connection', (conn) => this._onIncoming(conn));
  }

  _onIncoming(conn) {
    conn.on('open', () => {
      const slot = {
        conn, name: 'P', character: rosterById('bolt'),
        lastInput: null, playerId: null, ready: false,
      };
      this.connections.set(conn.peer, slot);
      conn.on('data', (data) => this._handleHostMessage(conn, data));
      conn.on('close', () => this._dropPeer(conn.peer));
      conn.on('error', () => this._dropPeer(conn.peer));
    });
  }

  _dropPeer(id) {
    const c = this.connections.get(id);
    if (c?.playerId != null) this.game.removeNetPlayer(c.playerId);
    this.connections.delete(id);
    this._refreshPeers();
  }

  _refreshPeers() {
    this.peers = [...this.connections.values()].map(c => ({
      id: c.conn.peer, name: c.name, character: c.character,
    }));
    if (this._lobby) {
      this._broadcastLobby();
    } else {
      this.game.menu?.refreshLobby?.();
    }
  }

  // Build the full lobby roster array (host + all connected clients).
  _buildRoster() {
    const hostChar = this._hostChar
      ? rosterById(this._hostChar)
      : rosterById('bolt');
    const roster = [
      {
        id: 'host',
        name: this._hostName || 'Host',
        character: hostChar,
        ready: true,
        isHost: true,
      },
    ];
    for (const c of this.connections.values()) {
      roster.push({
        id: c.conn.peer,
        name: c.name,
        character: c.character,
        ready: !!c.ready,
      });
    }
    return roster;
  }

  // Broadcast current lobby state to all clients and update host UI.
  _broadcastLobby() {
    const roster = this._buildRoster();
    const msg = {
      t: 'lobby',
      code: this._code,
      levelId: this._lobbyLevel,
      bots: this._lobbyBots,
      players: roster,
    };
    this.broadcast(msg);
    // Update the host's own lobby UI.
    this.game.menu?.refreshLobby?.(roster, true, this._code, this._lobbyLevel);
  }

  // Host: update the selected level and re-broadcast.
  setLobbyLevel(id) {
    this._lobbyLevel = id;
    if (this._lobby) this._broadcastLobby();
  }

  // Host: update the bot count and re-broadcast.
  setLobbyBots(n) {
    this._lobbyBots = n;
    if (this._lobby) this._broadcastLobby();
  }

  // Host: start the match for all lobby participants.
  startLobbyMatch() {
    if (!this._lobby) return;
    this._lobby = false;
    this.game.startHostedMatch(this._lobbyLevel, this._lobbyBots);
  }

  _handleHostMessage(conn, data) {
    if (!data || !data.t) return;
    const slot = this.connections.get(conn.peer);
    if (!slot) return;
    if (data.t === 'hello') {
      // Defensive guard: if slot is already onboarded (playerId set), ignore duplicate hellos.
      if (slot.playerId != null) return;
      slot.name = (data.name || 'P').slice(0, 10);
      slot.character = rosterById(data.character || 'bolt');
      if (this._lobby && !this.game.running) {
        // Lobby mode: record the joiner in the roster, don't spawn yet.
        slot.ready = false;
        this._broadcastLobby();
      } else if (this.game.running && slot.playerId == null) {
        // Drop-in: the match is already running on the host. Spawn the
        // joiner immediately and ship them a fresh snapshot so they enter
        // the world without waiting for a lobby.
        const sm = this.game.addNetPlayer(slot.name, slot.character);
        slot.playerId = sm.id;
        try {
          conn.send({
            t: 'start',
            level: this.game.levelId,
            playerId: sm.id,
            snap: this.game._snapshot(),
          });
        } catch (_) {}
        this._refreshPeers();
      } else {
        this._refreshPeers();
      }
    } else if (data.t === 'ready') {
      // Client toggled ready status in the lobby.
      slot.ready = !!data.ready;
      if (this._lobby) this._broadcastLobby();
    } else if (data.t === 'input') {
      slot.lastInput = sanitizeInput(data.in);
    } else if (data.t === 'ping') {
      try { conn.send({ t: 'pong', ts: data.ts }); } catch (_) {}
    }
  }

  sendInput(input) {
    if (this.role !== 'client' || !this.conn?.open) return;
    try { this.conn.send({ t: 'input', in: input }); } catch (_) {}
  }

  broadcast(msg) {
    if (this.role !== 'host') return;
    for (const c of this.connections.values()) {
      if (c.conn.open) try { c.conn.send(msg); } catch (_) {}
    }
  }

  disconnect() {
    this._intentionalDisconnect = true;
    if (this.peer) try { this.peer.destroy(); } catch (_) {}
    this.peer = null;
    this.role = null;
    this.connections.clear();
    this.peers = [];
    this.localPlayerId = null;
    this._lobby = false;
    this._code = null;
    clearTimeout(this._joinResolveTimer);
  }
}
