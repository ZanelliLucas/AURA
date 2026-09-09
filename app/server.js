// API locale d'AURA (§13.1/§13.2 : "Backend / orchestrateur - Node.js +
// Express"). Ecoute uniquement sur 127.0.0.1 : jamais expose au reseau,
// jamais un site accessible par navigateur/URL externe (F-12, §18) -
// c'est un service interne pour que la fenetre applicative (et plus tard
// d'autres clients, ex. bot Discord F-13) parlent a AURA CORE de la meme
// maniere. Ne demarre qu'au lancement de l'app (F-22).
const express = require('express');
const core = require('./core');
const store = require('./store');
const productivity = require('./productivity');
const autonomy = require('./autonomy');

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

  // Memory Layer (§12) - alimente le panneau Activité de la toile.
  server.get('/api/journal', (req, res) => {
    res.json(store.getJournal(20));
  });

  // Connecteur Productivite (§7)
  server.get('/api/tasks', (req, res) => {
    res.json(productivity.getTasks());
  });

  server.post('/api/tasks', (req, res) => {
    try {
      res.json(productivity.taskCreate(req.body));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  server.post('/api/tasks/:id/complete', (req, res) => {
    try {
      res.json(productivity.taskComplete(req.params.id));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  server.delete('/api/tasks/:id', (req, res) => {
    res.json(productivity.taskDelete(req.params.id));
  });

  server.get('/api/reminders', (req, res) => {
    res.json(productivity.getReminders());
  });

  server.post('/api/reminders', (req, res) => {
    try {
      res.json(productivity.reminderSchedule(req.body));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  server.delete('/api/reminders/:id', (req, res) => {
    res.json(productivity.reminderDelete(req.params.id));
  });

  // Verifie a interval regulier (main.js) plutot qu'a chaque poll du
  // renderer : evite de manquer une echeance si aucun ecran ne l'affiche.
  server.get('/api/reminders/due', (req, res) => {
    res.json(productivity.checkDueReminders());
  });

  // AURA AUTONOMY (§5.9)
  server.get('/api/autonomy/estop', (req, res) => {
    res.json(autonomy.getEstop());
  });

  server.post('/api/autonomy/estop', (req, res) => {
    res.json(autonomy.setEstop(!!req.body.active));
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
