// Connecteur Gaming - Riot Games (§8). Strictement en lecture (§18.2) :
// aucune action d'automatisation ou d'ecriture cote jeu.
async function riotFetch(url, apiKey) {
  const res = await fetch(url, { headers: { 'X-Riot-Token': apiKey } });
  if (!res.ok) {
    const err = new Error(`Riot API (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// riot.get_match_history (§8, Lecture)
async function getMatchHistory({ apiKey, region, gameName, tagLine, count = 5 }) {
  const account = await riotFetch(
    `https://${region}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`,
    apiKey
  );

  const matchIds = await riotFetch(
    `https://${region}.api.riotgames.com/lol/match/v5/matches/by-puuid/${account.puuid}/ids?start=0&count=${count}`,
    apiKey
  );

  const matches = await Promise.all(
    matchIds.map((id) => riotFetch(`https://${region}.api.riotgames.com/lol/match/v5/matches/${id}`, apiKey))
  );

  return matches.map((match) => {
    const p = match.info.participants.find((pp) => pp.puuid === account.puuid) || {};
    return {
      matchId: match.metadata.matchId,
      champion: p.championName,
      win: !!p.win,
      kills: p.kills || 0,
      deaths: p.deaths || 0,
      assists: p.assists || 0,
      gameDurationSec: match.info.gameDuration,
      gameMode: match.info.gameMode,
      endedAt: new Date(match.info.gameEndTimestamp).toISOString()
    };
  });
}

module.exports = { getMatchHistory };
