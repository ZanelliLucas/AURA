'use strict';

/**
 * Surveillance de fond du Terminal integre a AURA (copie fidele de
 * TERMINAL/app/monitors.js, adaptee aux chemins de terminal-core) :
 *  - boite noire : un releve de l'etat du PC toutes les 30 s (terminal-core/blackbox.js) ;
 *  - suivi de la sante : l'examen de `sante` toutes les heures, et une
 *    notification quand un voyant se degrade ou qu'un nouvel arret imprevu
 *    apparait.
 *
 * Version installee seulement (voir start()) : l'instance de developpement
 * (`npm start`) partage le meme dossier utilisateur qu'AURA installee et
 * ecrirait dans les memes fichiers.
 */

const fs = require('fs');
const path = require('path');
const { BlackBox } = require('./terminal-core/blackbox');
const health = require('./terminal-core/commands/health').internals;

const HOUR = 3600000;
const FIRST_EXAM_MS = 2 * 60000;

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * @param {{userData:string, packaged:boolean, readSettings:Function, writeSettings:Function, notify:Function}} options
 * @returns {{ blackbox, healthWatch, start(), stop() }} `blackbox` et `healthWatch` : hotes pour createTerminal
 */
function createMonitors({ userData, packaged, readSettings, writeSettings, notify }) {
  const installedOnly = () => {
    if (!packaged) throw new Error('Reglable dans la version installee seulement : l\'instance de developpement partage ses fichiers.');
  };
  const setSetting = (key, value) => writeSettings({ ...readSettings(), [key]: value });

  // --- Boite noire ------------------------------------------------------------------
  const blackboxFile = path.join(userData, 'terminal-boite-noire.jsonl');
  const box = new BlackBox({ file: blackboxFile });
  const boxWanted = () => readSettings().blackbox !== false;

  const blackbox = {
    get: () => ({ enabled: boxWanted(), recording: box.running, file: blackboxFile, intervalMs: box.intervalMs, lastError: box.lastError }),
    set(enabled) {
      installedOnly();
      setSetting('blackbox', Boolean(enabled));
      if (enabled) box.start(); else box.stop();
    },
    clear() {
      installedOnly();
      const was = box.running;
      box.stop();
      try { fs.unlinkSync(blackboxFile); } catch { /* deja absent */ }
      if (was) box.start();
    }
  };

  // --- Suivi de la sante --------------------------------------------------------------
  const healthFile = path.join(userData, 'terminal-sante-suivi.json');
  const watchWanted = () => readSettings().healthWatch !== false;
  let firstTimer = null;
  let timer = null;
  let examining = false;
  let lastRun = null;

  async function examineOnce() {
    if (examining) return;
    examining = true;
    try {
      const checks = await health.examine();
      const previous = readJson(healthFile);
      // Premier examen : il sert de reference, sans prevenir de l'existant.
      const changes = previous ? health.compareHealth(previous.checks, checks) : [];
      fs.mkdirSync(userData, { recursive: true });
      fs.writeFileSync(healthFile, JSON.stringify({
        time: Date.now(),
        checks: checks.map(({ id, status, value, detail }) => ({ id, status, value, detail }))
      }, null, 2));
      lastRun = Date.now();
      if (changes.length) notify(health.describeHealthChanges(changes));
    } catch (err) {
      console.error(`[sante] ${err.message}`);
    } finally {
      examining = false;
    }
  }

  function startWatch() {
    if (timer) return;
    firstTimer = setTimeout(examineOnce, FIRST_EXAM_MS);
    timer = setInterval(examineOnce, HOUR);
  }

  function stopWatch() {
    clearTimeout(firstTimer);
    clearInterval(timer);
    firstTimer = null;
    timer = null;
  }

  const healthWatch = {
    get: () => ({
      enabled: watchWanted(),
      active: Boolean(timer),
      lastRun: lastRun || (readJson(healthFile) || {}).time || null
    }),
    set(enabled) {
      installedOnly();
      setSetting('healthWatch', Boolean(enabled));
      if (enabled) startWatch(); else stopWatch();
    }
  };

  return {
    blackbox,
    healthWatch,
    start() {
      if (!packaged) return;
      if (boxWanted()) box.start();
      if (watchWanted()) startWatch();
    },
    /** A la fermeture : la boite noire note un arret propre. */
    stop() {
      box.stop();
      stopWatch();
    }
  };
}

module.exports = { createMonitors };
