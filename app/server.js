// API locale d'AURA (§13.1/§13.2 : "Backend / orchestrateur - Node.js +
// Express"). Ecoute uniquement sur 127.0.0.1 : jamais expose au reseau,
// jamais un site accessible par navigateur/URL externe (F-12, §18) -
// c'est un service interne pour que la fenetre applicative (et plus tard
// d'autres clients, ex. bot Discord F-13) parlent a AURA CORE de la meme
// maniere. Ne demarre qu'au lancement de l'app (F-22).
const express = require('express');
const core = require('./core');

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
      res.json(core.setApiKey(req.body.key));
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

  return new Promise((resolve, reject) => {
    const instance = server.listen(PORT, HOST, () => {
      console.log(`[server] API AURA locale sur http://${HOST}:${PORT}`);
      resolve(instance);
    });
    instance.on('error', reject);
  });
}

module.exports = { startServer, PORT, HOST };
