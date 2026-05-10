// First-run mobile tutorial — shows ghost-finger animations over the game
// canvas to teach the 5 core gestures. Triggered once per browser; gated
// by localStorage('touch_tutorial_done'). Replayable via Settings.
//
// Steps (each ~3s):
//   1. Left thumb traces joystick arc        — "drag to move"
//   2. Right thumb taps Attack twice         — "tap to attack"
//   3. Right thumb holds Attack + drags      — "hold + drag to aim"
//   4. Grab held + joy push + grab release   — "release grab + push = throw"
//   5. Grab + diagonal swipe                 — "swipe grab to throw weapon"
//
// Auto-advances. Skip button bottom-right dismisses immediately.

const STORAGE_KEY = 'touch_tutorial_done';
const STEP_MS = 3200;

const STEPS = [
  { caption: 'drag to move',                  side: 'left',  anim: 'tut-arc' },
  { caption: 'tap to attack',                 side: 'right', anim: 'tut-tap', target: '.tbtn.attack' },
  { caption: 'hold + drag to aim',            side: 'right', anim: 'tut-drag', target: '.tbtn.attack' },
  { caption: 'release grab + push = throw',   side: 'split' },
  { caption: 'swipe grab to throw weapon',    side: 'right', anim: 'tut-swipe', target: '.tbtn.grab' },
];

export class TutorialOverlay {
  constructor() {
    this.root = null;
    this.timer = null;
    this.idx = 0;
  }

  static isDone() { return localStorage.getItem(STORAGE_KEY) === '1'; }
  static markDone() { localStorage.setItem(STORAGE_KEY, '1'); }
  static reset() { localStorage.removeItem(STORAGE_KEY); }

  show() {
    if (this.root) this.dismiss();
    document.body.classList.add('tutorial-active');
    const el = document.createElement('div');
    el.className = 'tut-root';
    el.innerHTML = `
      <div class="tut-dim"></div>
      <div class="tut-caption" id="tut-caption"></div>
      <div class="tut-finger" id="tut-finger-left"></div>
      <div class="tut-finger" id="tut-finger-right"></div>
      <button class="tut-skip" id="tut-skip">SKIP</button>
    `;
    document.body.appendChild(el);
    this.root = el;
    el.querySelector('#tut-skip').onclick = () => this.dismiss();
    this.idx = 0;
    this._showStep(0);
    this._onResize = () => this._showStep(this.idx);
    addEventListener('resize', this._onResize);
  }

  _showStep(i) {
    if (i >= STEPS.length) { this.dismiss(); return; }
    const step = STEPS[i];
    const cap = this.root.querySelector('#tut-caption');
    const fL  = this.root.querySelector('#tut-finger-left');
    const fR  = this.root.querySelector('#tut-finger-right');
    cap.textContent = step.caption;
    fL.className = 'tut-finger';
    fR.className = 'tut-finger';
    // Resolve absolute positions of any target buttons so the ghost finger
    // animates over the real cluster.
    const place = (el, sideKey, targetSel) => {
      if (targetSel) {
        const t = document.querySelector(targetSel);
        if (t) {
          const r = t.getBoundingClientRect();
          el.style.left = (r.left + r.width / 2) + 'px';
          el.style.top  = (r.top + r.height / 2) + 'px';
        }
      } else if (sideKey === 'left') {
        el.style.left = (innerWidth * 0.25) + 'px';
        el.style.top  = (innerHeight * 0.65) + 'px';
      } else {
        el.style.left = (innerWidth * 0.75) + 'px';
        el.style.top  = (innerHeight * 0.65) + 'px';
      }
    };
    if (step.side === 'left') {
      place(fL, 'left');
      fL.classList.add('show', step.anim);
    } else if (step.side === 'right') {
      place(fR, 'right', step.target);
      fR.classList.add('show', step.anim);
    } else { // split
      place(fL, 'left');
      place(fR, 'right', '.tbtn.grab');
      fL.classList.add('show', 'tut-arc');
      fR.classList.add('show', 'tut-tap');
    }
    this.timer = setTimeout(() => {
      this.idx++;
      this._showStep(this.idx);
    }, STEP_MS);
  }

  dismiss() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this._onResize) { removeEventListener('resize', this._onResize); this._onResize = null; }
    if (this.root && this.root.parentNode) this.root.parentNode.removeChild(this.root);
    this.root = null;
    document.body.classList.remove('tutorial-active');
    TutorialOverlay.markDone();
  }
}
