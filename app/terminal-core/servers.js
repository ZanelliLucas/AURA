'use strict';

/**
 * Serveurs pilotes par le Terminal : demarrage, suivi, journal, arret.
 *
 * Aucune dependance a une interface : le gestionnaire vit sur l'instance du
 * Terminal (`terminal.servers`) et les commandes `start`, `stop`, `access`
 * et `exit` s'appuient dessus. L'application Electron appelle aussi
 * `terminal.servers.stopAll()` a sa fermeture.
 */

const net = require('net');
const { EventEmitter } = require('events');
const { spawn } = require('child_process');
const { runJson, IS_WINDOWS } = require('./platform');
const out = require('./output');

const MAX_LOG_LINES = 500;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function probe(port, host, timeout) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    const done = (ok) => { socket.destroy(); resolve(ok); };
    socket.setTimeout(timeout, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

/**
 * Le port accepte-t-il des connexions ?
 * `localhost` se resout en ::1 sur les Node recents : un serveur qui
 * n'ecoute qu'en IPv6 serait invisible si l'on ne testait que 127.0.0.1.
 */
async function isListening(port) {
  return (await probe(port, '127.0.0.1', 400)) || (await probe(port, '::1', 400));
}

/** Processus qui ecoute sur un port (Windows), ou null. */
async function portOwner(port) {
  if (!IS_WINDOWS) return null;
  const rows = await runJson(
    `Get-NetTCPConnection -State Listen -LocalPort ${Number(port)} -ErrorAction SilentlyContinue | Select-Object -First 1 OwningProcess`,
    { timeout: 10000 }
  );
  const pid = rows[0] && rows[0].OwningProcess;
  if (!pid) return null;
  let name = '?';
  try {
    const [proc] = await runJson(`Get-Process -Id ${Number(pid)} -ErrorAction SilentlyContinue | Select-Object ProcessName`, { timeout: 8000 });
    if (proc && proc.ProcessName) name = proc.ProcessName;
  } catch {
    // Le nom n'est qu'un confort d'affichage.
  }
  return { pid: Number(pid), name };
}

/**
 * Arrete un processus et toute sa descendance.
 * Indispensable sous Windows : le serveur tourne sous un cmd.exe (shell) ;
 * ne tuer que ce cmd laisserait le vrai serveur orphelin, port occupe.
 */
function killTree(pid) {
  return new Promise((resolve) => {
    if (!IS_WINDOWS) {
      try { process.kill(pid, 'SIGTERM'); } catch { /* deja termine */ }
      resolve();
      return;
    }
    const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
    killer.once('error', () => resolve());
    killer.once('close', () => resolve());
  });
}

/**
 * Ce qu'on dit d'un serveur arrete seul : titre et texte d'une notification,
 * et blocs pour la fenetre ou la console.
 */
function describeCrash(info) {
  const when = new Date(info.at).toLocaleTimeString('fr-FR');
  const tail = (info.tail || []).filter(Boolean);
  const last = tail[tail.length - 1];
  return {
    title: `Serveur arrete : ${info.label}`,
    body: `${info.label} s'est arrete a ${when} (code ${info.code}).${last ? `\n${last.slice(0, 180)}` : ''}`,
    blocks: [
      out.warn(`${info.label} s'est arrete a ${when} (code ${info.code}).`),
      ...(tail.length ? [out.code(tail.join('\n'), 'stderr')] : []),
      out.dim(`access ${info.key} --journal pour sa sortie - start ${info.key} pour le relancer.`)
    ]
  };
}

/**
 * Evenement `crash` ({ key, label, code, pid, at, tail }) : un serveur
 * demarre avec succes s'est arrete sans qu'on le lui demande. Un echec au
 * demarrage, lui, remonte deja par `start` ; `stop`, `exit` et la fermeture
 * ne previennent pas.
 */
class ServerManager extends EventEmitter {
  constructor() {
    super();
    /** cle -> { key, def, child, pid, startedAt, logs, exitCode, stopped, ready, exited } */
    this.entries = new Map();
  }

  get(key) { return this.entries.get(key) || null; }

  isRunning(key) {
    const entry = this.entries.get(key);
    return Boolean(entry && entry.exitCode === null);
  }

  running() {
    return [...this.entries.values()].filter((entry) => entry.exitCode === null);
  }

  /** Dernieres lignes de sortie, conservees meme apres l'arret (utile apres un plantage). */
  logs(key) {
    const entry = this.entries.get(key);
    return entry ? entry.logs.slice() : null;
  }

  /**
   * Demarre un serveur et attend qu'il soit pret.
   * `def` : { label, command, cwd, port?, gui?, delai? }
   *
   * Pret = son port accepte des connexions ; sans port declare, il suffit
   * qu'il survive 1,5 s. Un arret prematuree remonte avec la fin de sa
   * sortie, pour qu'on sache pourquoi sans aller fouiller.
   */
  async start(key, def, { signal } = {}) {
    if (this.isRunning(key)) {
      throw new Error(`${def.label} est deja demarre (PID ${this.entries.get(key).pid}).`);
    }
    this.entries.delete(key);

    if (def.port && await isListening(def.port)) {
      let owner = null;
      try { owner = await portOwner(def.port); } catch { /* inconnu */ }
      throw new Error(
        `Le port ${def.port} est deja occupe${owner ? ` par ${owner.name} (PID ${owner.pid})` : ''} : `
        + `${def.label} tourne peut-etre deja hors du Terminal. \`stop ${key} --force\` pour liberer le port.`
      );
    }

    // `gui` : une application fenetree (Electron...) ne doit pas etre lancee
    // masquee, sans quoi sa fenetre pourrait ne jamais apparaitre.
    const child = spawn(def.command, { cwd: def.cwd, shell: true, windowsHide: !def.gui, env: process.env });
    const entry = { key, def, child, pid: child.pid, startedAt: Date.now(), logs: [], exitCode: null, stopped: false, ready: false };

    const push = (chunk) => {
      for (const line of String(chunk).split(/\r?\n/)) {
        if (!line) continue;
        entry.logs.push(line);
        if (entry.logs.length > MAX_LOG_LINES) entry.logs.shift();
      }
    };
    child.stdout.on('data', push);
    child.stderr.on('data', push);
    child.once('error', (err) => push(`[erreur] ${err.message}`));
    entry.exited = new Promise((resolve) => {
      child.once('exit', (code) => {
        entry.exitCode = code == null ? -1 : code;
        resolve(entry.exitCode);
        if (!entry.stopped && entry.ready) {
          this.emit('crash', { key, label: def.label, code: entry.exitCode, pid: entry.pid, at: Date.now(), tail: entry.logs.slice(-3) });
        }
      });
    });
    this.entries.set(key, entry);

    const deadline = Date.now() + Math.max(1, def.delai || 20) * 1000;
    for (;;) {
      if (entry.exitCode !== null) {
        const tail = entry.logs.slice(-6).join('\n');
        throw new Error(`${def.label} s'est arrete aussitot (code ${entry.exitCode}).${tail ? `\n${tail}` : ''}`);
      }
      if (signal && signal.aborted) {
        await this.stop(key);
        throw Object.assign(new Error('Demarrage interrompu.'), { name: 'AbortError' });
      }
      // Demarre : desormais, un arret non demande sera signale (`crash`).
      if (def.port) {
        if (await isListening(def.port)) { entry.ready = true; return { pid: entry.pid, listening: true }; }
      } else if (Date.now() - entry.startedAt > 1500) {
        entry.ready = true;
        return { pid: entry.pid, listening: false };
      }
      // Toujours en vie mais port muet : on rend la main sans l'arreter,
      // certains serveurs mettent longtemps a s'initialiser.
      if (Date.now() > deadline) { entry.ready = true; return { pid: entry.pid, listening: false, timedOut: true }; }
      await sleep(250);
    }
  }

  async stop(key) {
    const entry = this.entries.get(key);
    if (!entry || entry.exitCode !== null) return false;
    entry.stopped = true;
    await killTree(entry.pid);
    await Promise.race([entry.exited, sleep(5000)]);
    return true;
  }

  /** Arrete tout ce qui a ete demarre ici ; renvoie les libelles arretes. */
  async stopAll() {
    const running = this.running();
    for (const entry of running) await this.stop(entry.key);
    return running.map((entry) => entry.def.label);
  }
}

module.exports = { ServerManager, isListening, portOwner, killTree, describeCrash };
