// Connecteur Gaming - Steam (§8). Strictement en lecture.
// steam.get_playtime (§8, Lecture)
async function getOwnedGames({ apiKey, steamId }) {
  const url = `https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/?key=${apiKey}&steamid=${steamId}&include_appinfo=1&include_played_free_games=1&format=json`;
  const res = await fetch(url);
  if (!res.ok) {
    const err = new Error(`Steam API (${res.status})`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  const games = (data.response && data.response.games) || [];
  return games
    .sort((a, b) => b.playtime_forever - a.playtime_forever)
    .slice(0, 15)
    .map((g) => ({
      name: g.name,
      appid: g.appid,
      playtimeHours: Math.round((g.playtime_forever / 60) * 10) / 10,
      playtimeRecentHours: g.playtime_2weeks ? Math.round((g.playtime_2weeks / 60) * 10) / 10 : 0
    }));
}

module.exports = { getOwnedGames };
