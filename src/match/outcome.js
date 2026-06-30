// Match-end decision logic — pure, no Three/Stickman imports so the rules
// (who won / draw / KO) are unit-tested in isolation. Game._checkGameOver
// calls this for the verdict and keeps the audio/menu/net side effects.
//
// `isDead(player)` is injected so this module needn't import the Stickman
// STATE enum (which would pull in Three).

// Returns null while the match continues, or { reason, winner } when it's over:
//   reason 'ko'      — solo player ran out of lives (winner null)
//   reason 'draw'    — everyone went down simultaneously (winner null)
//   reason 'victory' — one fighter left standing (winner = that player)
export function evaluateGameOver(players, localPlayers, isDead) {
  if (!localPlayers || localPlayers.length === 0) return null;

  // A player is still "in" while they have lives left. Mid-respawn
  // (dead with lives>0) does NOT count them out — only lives==0 && dead does.
  const stillIn = players.filter(p => p && p.lives > 0);
  const totalEverIn = players.filter(p => p).length;

  // Solo: fire the over-screen the moment P1 runs out of lives.
  if (localPlayers.length === 1) {
    const local = localPlayers[0];
    if (local && local.lives <= 0 && isDead(local)) return { reason: 'ko', winner: null };
  }

  if (totalEverIn <= 1) return null;

  // All down at once → draw.
  if (stillIn.length === 0) return { reason: 'draw', winner: null };

  // Last fighter standing wins — anyone, not just P1.
  if (stillIn.length === 1) return { reason: 'victory', winner: stillIn[0] };

  return null;
}
