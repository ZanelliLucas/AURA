// API locale d'AURA (§13.1/§13.2 : "Backend / orchestrateur - Node.js +
// Express"). Ecoute uniquement sur 127.0.0.1 : jamais expose au reseau,
// jamais un site accessible par navigateur/URL externe (F-12, §18) -
// c'est un service interne pour que la fenetre applicative (et plus tard
// d'autres clients, ex. bot Discord F-13) parlent a AURA CORE de la meme
// maniere. Ne demarre qu'au lancement de l'app (F-22).
const express = require('express');
const core = require('./core');
const store = require('./store');

const PORT = 8420;
const HOST = '127.0.0.1';

function startServer() {
  const server = express();
  server.use(express.json());

  server.get('/api/status', (req, res) => {
    res.json(core.getStatus());
  });

  server.post('/api/config/api-key', (req, res) => {
    try {
      res.json(core.setApiKey(req.body.provider, req.body.key));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  server.post('/api/message', async (req, res) => {
    try {
      const result = await core.sendMessage(req.body.text);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Memory Layer (§12) - alimente les panneaux Projets/Contexte de la toile.
  server.get('/api/journal', (req, res) => {
    res.json(store.getJournal(20));
  });

  server.get('/api/preferences', (req, res) => {
    res.json(store.getPreferences());
  });

  server.post('/api/preferences', (req, res) => {
    const { key, value } = req.body || {};
    if (!key) return res.status(400).json({ error: 'Clé de préférence manquante.' });
    res.json(store.setPreference(key, value));
  });

  // F-06 : l'utilisateur doit pouvoir tout effacer. La confirmation
  // explicite (§14.1) est geree cote UI avant cet appel.
  server.delete('/api/memory', (req, res) => {
    store.clearPreferences();
    res.json({ cleared: true });
  });

  return new Promise((resolve, reject) => {
    const instance = server.listen(PORT, HOST, () => {
      console.log(`[server] API AURA locale sur http://${HOST}:${PORT}`);
      resolve(instance);
    });
    instance.on('error', reject);
  });
}

module.exports = { startServer, PORT, HOST };
