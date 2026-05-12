// Test harness for the firearms-overhaul PRs. Self-registers helpers on
// `window` so dev-time `preview_eval` can run them. No production cost — the
// helpers only execute when explicitly called.

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERT FAIL: ' + msg);
}

function assertNear(actual, expected, eps, msg) {
  if (Math.abs(actual - expected) > eps) {
    throw new Error('ASSERT NEAR FAIL: ' + msg + ' — actual=' + actual + ' expected=' + expected + ' eps=' + eps);
  }
}

window.__weaponTest = { assert, assertNear, results: [] };

window.__weaponTest.run = function (name) {
  const fn = window['__test_' + name];
  if (typeof fn !== 'function') throw new Error('No test named __test_' + name);
  try {
    fn();
    window.__weaponTest.results.push({ name, ok: true });
    return 'PASS: ' + name;
  } catch (e) {
    window.__weaponTest.results.push({ name, ok: false, msg: e.message });
    throw e;
  }
};
