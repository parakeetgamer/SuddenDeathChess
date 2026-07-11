const { isVip } = require('./vip');

function safeUser(u) {
  const vip = isVip(u.username);
  return {
    id: u.id, username: u.username, rating: u.rating, peak_rating: u.peak_rating,
    wins: u.wins, losses: u.losses, games: u.games,
    no_ads: u.no_ads === 1 || vip, is_premium: u.is_premium === 1 || vip, vip: vip
  };
}

module.exports = { safeUser };
