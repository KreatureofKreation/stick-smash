// Manages the 3-2-1-FIGHT countdown timers. Pulled out of Game so the
// cancel-then-reschedule logic — the source of the "double countdown" bug on
// fast PLAY AGAIN / map rotation — is isolated and unit-testable. The timer
// pair is injectable so tests can drive it with a fake clock.
export class Countdown {
  constructor(timers = { set: (fn, ms) => setTimeout(fn, ms), clear: (id) => clearTimeout(id) }) {
    this._timers = timers;
    this._ids = [];
  }

  // Schedule a fresh sequence. Cancels any still-pending sequence FIRST, so a
  // restart mid-countdown can't leave two queues dumping onto the HUD.
  // `steps` is [{ delay, fn }]; delays are ms from now.
  start(steps) {
    this.cancel();
    for (const { delay, fn } of steps) this._ids.push(this._timers.set(fn, delay));
  }

  cancel() {
    for (const id of this._ids) this._timers.clear(id);
    this._ids = [];
  }

  get pending() { return this._ids.length; }
}
