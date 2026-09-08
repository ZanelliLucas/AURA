// API locale d'AURA (§13.1/§13.2 : "Backend / orchestrateur - Node.js +
// Express"). Ecoute uniquement sur 127.0.0.1 : jamais expose au reseau,
// jamais un site accessible par navigateur/URL externe (F-12, §18) -
// c'est un service interne pour que la fenetre applicative (et plus tard
// d'autres clients, ex. bot Discord F-13) parlent a AURA CORE de la meme
// maniere. Ne demarre qu'au lancement de l'app (F-22).
const express = require('express');
const core = require('./core');
const store = require('./store');
const gaming = require('./gaming');
const productivity = require('./productivity');
const dev = require('./dev');
const communication = require('./communication');
const systemMonitor = require('./systemMonitor');
const analytics = require('./analytics');
const security = require('./security');

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

  // Actions locales (AURA IMAGE LAB, §10.3) journalisees sans passer par
  // AURA CORE : traitement fait cote renderer (Canvas), pas d'appel IA.
  const ALLOWED_LOCAL_ACTIONS = new Set([
    'vision.enhance_image', 'vision.upscale_image', 'vision.denoise_image',
    'vision.sharpen_image', 'vision.export_image'
  ]);
  server.post('/api/journal', (req, res) => {
    const { typeAction, sensibilite, statut, details } = req.body || {};
    if (!ALLOWED_LOCAL_ACTIONS.has(typeAction)) {
      return res.status(400).json({ error: 'Action inconnue.' });
    }
    store.logAction({ typeAction, sensibilite, statut, details });
    res.json({ logged: true });
  });

  server.get('/api/preferences', (req, res) => {
    res.json(store.getPreferences());
  });

  server.post('/api/preferences', (req, res) => {
    const { key, value } = req.body || {};
    if (!key) return res.status(400).json({ error: 'Clé de préférence manquante.' });
    res.json(store.setPreference(key, value));
  });

  server.delete('/api/preferences/:key', (req, res) => {
    res.json(store.deletePreference(req.params.key));
  });

  // F-06 : l'utilisateur doit pouvoir tout effacer. La confirmation
  // explicite (§14.1) est geree cote UI avant cet appel.
  server.delete('/api/memory', (req, res) => {
    store.clearPreferences();
    res.json({ cleared: true });
  });

  // Gaming & Streaming (§8, §16.3)
  server.get('/api/gaming/status', (req, res) => {
    res.json(gaming.getConnectorStatus());
  });

  server.post('/api/gaming/config', (req, res) => {
    try {
      res.json(gaming.setConnectorField(req.body.key, req.body.value));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  server.get('/api/gaming/riot', async (req, res) => {
    try {
      const { gameName, tagLine, region } = req.query;
      res.json(await gaming.fetchMatchHistory(gameName, tagLine, region || 'europe'));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  server.get('/api/gaming/steam', async (req, res) => {
    try {
      res.json(await gaming.fetchOwnedGames(req.query.steamId));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  server.post('/api/streaming/obs/connect', async (req, res) => {
    try {
      res.json(await gaming.obsConnect());
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  server.post('/api/streaming/obs/disconnect', async (req, res) => {
    res.json(await gaming.obsDisconnect());
  });

  server.get('/api/streaming/obs/scenes', async (req, res) => {
    try {
      res.json(await gaming.obsScenes());
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  server.post('/api/streaming/obs/scene', async (req, res) => {
    try {
      res.json(await gaming.obsSwitchScene(req.body.sceneName));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  server.post('/api/streaming/obs/overlay', async (req, res) => {
    try {
      res.json(await gaming.obsUpdateOverlay(req.body.sourceName, req.body.text));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  server.post('/api/streaming/obs/start', async (req, res) => {
    try {
      res.json(await gaming.obsStartStream());
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
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

  // Connecteur Developpement (§6)
  server.get('/api/dev/config', (req, res) => {
    res.json(dev.getDevConfig());
  });

  server.post('/api/dev/config', (req, res) => {
    try {
      res.json(dev.setDevField(req.body.key, req.body.value));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  server.get('/api/dev/git/status', async (req, res) => {
    try {
      res.json(await dev.gitStatus());
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  server.post('/api/dev/git/commit', async (req, res) => {
    try {
      res.json(await dev.gitCommit(req.body.message, req.body.files));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  server.post('/api/dev/git/push', async (req, res) => {
    try {
      res.json(await dev.gitPush(req.body.remote, req.body.branch));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  server.post('/api/dev/unity/build', async (req, res) => {
    try {
      res.json(await dev.unityBuildAction(req.body));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Connecteur Communication (§3 : mail/Discord)
  server.get('/api/comm/status', (req, res) => {
    res.json(communication.getCommStatus());
  });

  server.post('/api/comm/config', (req, res) => {
    try {
      res.json(communication.setCommField(req.body.key, req.body.value));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  server.post('/api/comm/mail/send', async (req, res) => {
    try {
      res.json(await communication.mailSend(req.body));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  server.post('/api/comm/discord/send', async (req, res) => {
    try {
      res.json(await communication.discordSend(req.body.content));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // AURA SYSTEM MONITOR (§5.7) - lecture seule, aucune confirmation requise.
  server.get('/api/system/snapshot', async (req, res) => {
    try {
      res.json(await systemMonitor.snapshot());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  server.get('/api/system/thresholds', (req, res) => {
    res.json(systemMonitor.getThresholds());
  });

  server.post('/api/system/thresholds', (req, res) => {
    try {
      res.json(systemMonitor.setThreshold(req.body.key, req.body.value));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  server.get('/api/system/alerts', (req, res) => {
    res.json(systemMonitor.getAlerts());
  });

  server.post('/api/system/alerts/:id/ack', (req, res) => {
    res.json(systemMonitor.acknowledgeAlert(req.params.id));
  });

  // AURA ANALYTICS (§5.5, §15) - lecture seule, jamais de confirmation.
  server.get('/api/analytics/summary', (req, res) => {
    res.json(analytics.summary());
  });

  server.get('/api/analytics/anomalies', (req, res) => {
    res.json(analytics.anomalies());
  });

  server.get('/api/analytics/forecast', (req, res) => {
    try {
      const stepsAhead = Number(req.query.stepsAhead) || 5;
      res.json(analytics.forecastMetric(req.query.metric, stepsAhead));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  server.get('/api/analytics/predictions', (req, res) => {
    res.json(analytics.getPredictions());
  });

  // AURA SECURITY (§5.8, §18.2)
  server.get('/api/security/dependencies', async (req, res) => {
    try {
      res.json(await security.checkDependencies());
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  server.get('/api/security/audit', async (req, res) => {
    try {
      res.json(await security.auditProject());
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  server.get('/api/security/logs', (req, res) => {
    res.json(security.scanLogs());
  });

  server.post('/api/security/pentest', async (req, res) => {
    try {
      res.json(await security.pentestScan(req.body || {}));
    } catch (err) {
      res.status(400).json({ error: err.message });
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
