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
