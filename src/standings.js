export function rankPlayers(game) {
  const players = Array.isArray(game?.players) ? game.players : [];

  const sorted = players
    .map((player, index) => ({
      player,
      total: player?.total ?? 0,
      tiebreak: Number.isInteger(player?.order) ? player.order : index
    }))
    .sort((a, b) => (b.total - a.total) || (a.tiebreak - b.tiebreak));

  const ranked = [];
  let previousTotal = null;
  let previousRank = 0;

  sorted.forEach((row, position) => {
    const rank = previousTotal === row.total ? previousRank : position + 1;
    ranked.push({ player: row.player, rank });
    previousTotal = row.total;
    previousRank = rank;
  });

  return ranked;
}

export function podiumRows(game) {
  return rankPlayers(game).filter((row) => row.rank <= 3);
}

// "Rest of the table" (refine-ui-after-testing): every ranked row above the
// podium steps, in ranking order. Pure and display-only — guards come from
// rankPlayers, the input is never mutated, and every call returns a fresh
// array referencing the original player objects.
export function podiumRestRows(game) {
  return rankPlayers(game).filter((row) => row.rank > 3);
}

// Score distribution (show-score-distribution): a derived, display-only view
// over the current totals — computed at render time, never persisted. Eligible
// rows are the players with a positive finite total in rankPlayers display
// order (descending total, competition ties in display order); zero and
// negative totals hold no share and are omitted from both bar and legend,
// while a positive-total player whose rounded share is 0% keeps its row so the
// segment↔legend correspondence stays exactly 1:1. The share denominator is
// the sum of positive totals (not the signed game total), so displayed
// percentages always sum to exactly 100 — even in mixed-sign games, where the
// signed total still travels out as `gameTotal` for the honest caption.
// Rounding is largest-remainder (Hamilton): floor every raw share, then hand
// the leftover units (100 − Σ floors) one each to the largest fractional
// remainders, ties topped up in display order — naive per-row rounding has no
// sum guarantee (2/2/2/1/1/1 of 9 naively rounds to 99). Guards return
// `{ gameTotal: 0, rows: [] }` for non-object games and non-array/missing
// players (the playerNumbers precedent); the input is never mutated and every
// call returns a fresh array referencing the original player objects.
export function scoreDistribution(game) {
  if (!game || typeof game !== "object" || !Array.isArray(game.players)) {
    return { gameTotal: 0, rows: [] };
  }

  const gameTotal = game.players.reduce((sum, player) => {
    const total = player && typeof player === "object" ? player.total : undefined;
    return sum + (Number.isFinite(total) ? total : 0);
  }, 0);

  const ranked = rankPlayers(game).filter((row) => {
    const total = row.player?.total;
    return Number.isFinite(total) && total > 0;
  });

  const positiveSum = ranked.reduce((sum, row) => sum + row.player.total, 0);

  if (gameTotal <= 0 || positiveSum <= 0) {
    return { gameTotal, rows: [] };
  }

  const shares = ranked.map((row) => {
    const raw = (row.player.total / positiveSum) * 100;
    const floor = Math.floor(raw);
    return { player: row.player, percent: floor, remainder: raw - floor };
  });

  const leftover = 100 - shares.reduce((sum, share) => sum + share.percent, 0);
  const byRemainder = shares
    .map((share, index) => ({ index, remainder: share.remainder }))
    .sort((a, b) => (b.remainder - a.remainder) || (a.index - b.index));

  for (let unit = 0; unit < leftover; unit += 1) {
    shares[byRemainder[unit].index].percent += 1;
  }

  return {
    gameTotal,
    rows: shares.map((share) => ({ player: share.player, percent: share.percent }))
  };
}
