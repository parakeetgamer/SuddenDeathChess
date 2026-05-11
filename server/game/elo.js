/**
 * Elo rating system
 * K-factor adjusts based on rating and games played
 */

function kFactor(rating, games) {
  if (games < 30) return 40;   // New player — high volatility
  if (rating < 1400) return 32;
  if (rating < 1800) return 24;
  return 16;                    // Strong players — more stable
}

function expectedScore(ratingA, ratingB) {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

/**
 * Calculate new ratings after a game.
 * @param {number} winnerRating
 * @param {number} loserRating
 * @param {number} winnerGames
 * @param {number} loserGames
 * @returns {{ winnerDelta, loserDelta, winnerNew, loserNew }}
 */
function calculateElo(winnerRating, loserRating, winnerGames, loserGames) {
  const expectedWinner = expectedScore(winnerRating, loserRating);
  const expectedLoser  = expectedScore(loserRating, winnerRating);

  const kWinner = kFactor(winnerRating, winnerGames);
  const kLoser  = kFactor(loserRating,  loserGames);

  const winnerDelta = Math.round(kWinner * (1 - expectedWinner));
  const loserDelta  = Math.round(kLoser  * (0 - expectedLoser));

  return {
    winnerDelta,
    loserDelta,
    winnerNew: Math.max(100, winnerRating + winnerDelta),
    loserNew:  Math.max(100, loserRating  + loserDelta),
  };
}

module.exports = { calculateElo };
