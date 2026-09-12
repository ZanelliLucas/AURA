'use strict';

/**
 * Boite noire : releves reguliers de l'etat du PC (processeur, memoire,
 * disque, programmes les plus actifs), gardes quelques jours dans un fichier.
 * Apres un arret imprevu, ils disent ce que faisait le PC juste avant - ce que
 * le journal de Windows ne dit pas.
 *
 * Chaque releve est une ligne JSON ecrite puis forcee sur le disque (fsync) :
 * apres une coupure, seule la derniere ligne peut manquer ou etre tronquee, et
 * la lecture ignore une ligne illisible.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { run, IS_WINDOWS } = require('./platform');

const INTERVAL_MS = 30000;
const KEEP_MS = 7 * 24 * 3600 * 1000;
const TOP = 5;

/** Temps processeur cumule de toute la machine, en ms. */
function cpuTimes() {
  let idle = 0;
  let total = 0;
  for (const cpu of os.cpus()) {
    for (const [kind, value] of Object.entries(cpu.times)) {
      total += value;
      if (kind === 'idle') idle += value;
    }
  }
  return { idle, total };
}

/** Processus : pid -> { name, cpu (secondes cumulees), mem (octets) }. */
async function processTable() {
  if (!IS_WINDOWS) return new Map();
  const { stdout } = await run('Get-Process | ForEach-Object { "$($_.Id)|$($_.ProcessName)|$($_.CPU)|$($_.WorkingSet64)" }', { timeout: 20000 });
  const table = new Map();
  for (const line of stdout.split(/\r?\n/)) {
    const [pid, name, cpu, mem] = line.trim().split('|');
    if (!pid || !name) continue;
    // Temps processeur ecrit a la francaise (virgule decimale).
    table.set(pid, { name, cpu: Number(String(cpu).replace(',', '.')) || 0, mem: Number(mem) || 0 });
  }
  return table;
}

/**
 * Echantillonneur reel : chaque appel rend un releve, la charge etant mesuree
 * depuis l'appel precedent. Les processus de meme nom (chrome...) sont cumules.
 */
function createSampler() {
  let lastCpu = cpuTimes();
  let lastProcs = null;
  let lastAt = Date.now();

  return async function sample() {
    const now = Date.now();
    const cpu = cpuTimes();
    const spent = cpu.total - lastCpu.total;
    const load = spent > 0 ? Math.round(100 * (1 - (cpu.idle - lastCpu.idle) / spent)) : null;
    lastCpu = cpu;

    const procs = await processTable().catch(() => new Map());
    const seconds = (now - lastAt) / 1000;
    const cores = os.cpus().length || 1;
    const byName = new Map();
    for (const [pid, p] of procs) {
      if (p.name === 'Idle') continue;
      const before = lastProcs && lastProcs.get(pid);
      const share = before && before.name === p.name && seconds > 0
        ? Math.max(0, (100 * (p.cpu - before.cpu)) / (seconds * cores))
        : null;
      const entry = byName.get(p.name) || { n: p.name, c: null, m: 0 };
      entry.m += p.mem;
      if (share != null) entry.c = (entry.c || 0) + share;
      byName.set(p.name, entry);
    }
    lastProcs = procs;
    lastAt = now;

    const rows = [...byName.values()].map((r) => ({ n: r.n, c: r.c == null ? null : Math.round(r.c), m: Math.round(r.m / 1048576) }));
    // Au repos, presque tout est a 0 % : sans ce seuil, n'importe quel processus
    // systeme remonterait parmi « les plus actifs » (constate sur la machine cible).
    const byCpu = rows.filter((r) => r.c != null && r.c >= 1).sort((a, b) => b.c - a.c).slice(0, 3);
    const byMem = rows.slice().sort((a, b) => b.m - a.m).slice(0, 3);
    const top = [...new Set([...byCpu, ...byMem])].slice(0, TOP);

    let disk = null;
    try {
      const s = fs.statfsSync(`${process.env.SystemDrive || 'C:'}\\`);
      disk = Math.round((100 * s.bavail) / s.blocks);
    } catch {
      // Disque illisible : le releve reste utile sans lui.
    }
    return { t: now, cpu: load, mem: Math.round(100 * (1 - os.freemem() / os.totalmem())), disk, top };
  };
}

/** Lignes JSON -> releves ; une ligne tronquee par une coupure est ignoree. */
function parseRecords(text) {
  const records = [];
  for (const line of String(text || '').split('\n')) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line);
      if (record && Number.isFinite(record.t)) records.push(record);
    } catch {
      // Ligne tronquee : la derniere, ecrite au moment d'une coupure.
    }
  }
  return records;
}

function readRecords(file) {
  try {
    return parseRecords(fs.readFileSync(file, 'utf8'));
  } catch {
    return [];
  }
}

class BlackBox {
  /**
   * @param {{file:string, intervalMs?:number, keepMs?:number, sampler?:Function, now?:Function}} options
   */
  constructor({ file, intervalMs = INTERVAL_MS, keepMs = KEEP_MS, sampler = null, now = Date.now }) {
    this.file = file;
    this.intervalMs = intervalMs;
    this.keepMs = keepMs;
    this.sampler = sampler;
    this.now = now;
    this.timer = null;
    this.trimTimer = null;
    this.busy = false;
    this.lastError = null;
  }

  get running() { return Boolean(this.timer); }

  start() {
    if (this.timer) return;
    if (!this.sampler) this.sampler = createSampler();
    this.trim();
    this.write({ type: 'start', t: this.now(), boot: Math.round(this.now() - os.uptime() * 1000) });
    this.timer = setInterval(() => { this.tick(); }, this.intervalMs);
    this.trimTimer = setInterval(() => this.trim(), 3600000);
    // Les minuteries ne retiennent pas le processus : elles suivent sa vie.
    if (this.timer.unref) this.timer.unref();
    if (this.trimTimer.unref) this.trimTimer.unref();
  }

  /** Arret propre : un marqueur dit que le Terminal a ete ferme, pas coupe. */
  stop() {
    if (!this.timer) return;
    clearInterval(this.timer);
    clearInterval(this.trimTimer);
    this.timer = null;
    this.trimTimer = null;
    this.write({ type: 'stop', t: this.now() });
  }

  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      const record = await this.sampler();
      if (this.timer) this.write(record);
      this.lastError = null;
    } catch (err) {
      this.lastError = err.message;
    } finally {
      this.busy = false;
    }
  }

  /** Ajoute une ligne et la force sur le disque. */
  write(record) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const fd = fs.openSync(this.file, 'a');
    try {
      fs.writeSync(fd, `${JSON.stringify(record)}\n`);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  }

  /** Ne garde que les derniers jours. */
  trim() {
    const records = readRecords(this.file);
    const limit = this.now() - this.keepMs;
    const kept = records.filter((r) => r.t >= limit);
    if (kept.length === records.length) return;
    const temp = `${this.file}.tmp`;
    fs.writeFileSync(temp, kept.map((r) => `${JSON.stringify(r)}\n`).join(''));
    fs.renameSync(temp, this.file);
  }
}

// --- Lecture apres coup ------------------------------------------------------------

const samplesOf = (records) => records.filter((r) => !r.type).sort((a, b) => a.t - b.t);

/** Instants d'arret imprevu (ms), sans doublon : 41 et 6008 d'un meme redemarrage. */
function dedupeShutdowns(times, spanMs = 5 * 60000) {
  const sorted = times.filter(Number.isFinite).sort((a, b) => a - b);
  const kept = [];
  for (const t of sorted) if (!kept.length || t - kept[kept.length - 1] > spanMs) kept.push(t);
  return kept;
}

/**
 * Pour chaque arret imprevu survenu pendant l'enregistrement : le dernier
 * releve avant lui, les minutes qui precedent, et un eventuel arret propre du
 * Terminal entre les deux.
 */
function incidents(records, shutdowns, { windowMs = 10 * 60000 } = {}) {
  const samples = samplesOf(records);
  const stops = records.filter((r) => r.type === 'stop');
  const first = records.length ? Math.min(...records.map((r) => r.t)) : Infinity;
  return dedupeShutdowns(shutdowns)
    .filter((at) => at > first)
    .sort((a, b) => b - a)
    .map((at) => {
      const before = samples.filter((s) => s.t < at);
      const last = before[before.length - 1] || null;
      const window = last ? before.filter((s) => s.t >= last.t - windowMs) : [];
      const stop = last ? stops.filter((s) => s.t >= last.t && s.t < at).pop() || null : null;
      return { at, last, window, stop, gapMs: last ? at - last.t : null };
    });
}

/** Le programme le plus souvent en tete, sur une serie de releves. */
function leader(samples, key) {
  const scores = new Map();
  for (const s of samples) {
    const top = (s.top || []).filter((p) => p[key] != null).sort((a, b) => b[key] - a[key])[0];
    if (top) scores.set(top.n, (scores.get(top.n) || 0) + 1);
  }
  return [...scores].sort((a, b) => b[1] - a[1]).map(([name]) => name)[0] || null;
}

const clock = (t) => new Date(t).toLocaleTimeString('fr-FR');

/** Ce que disent les minutes qui precedent un arret. */
function verdict(incident) {
  if (!incident.last) return 'Aucun releve avant cet arret : la boite noire ne tournait pas encore.';
  if (incident.stop && incident.at - incident.stop.t < 10 * 60000) {
    return `Le Terminal a ete ferme a ${clock(incident.stop.t)}, comme lors d'un arret normal de Windows : l'arret a sans doute commence normalement, puis s'est bloque.`;
  }
  if (incident.stop) return `Le Terminal avait ete ferme a ${clock(incident.stop.t)} : pas de releve au moment de l'arret.`;
  if (incident.gapMs > 15 * 60000) {
    return `Dernier releve ${Math.round(incident.gapMs / 60000)} min avant l'arret : le Terminal ne tournait sans doute pas a ce moment-la.`;
  }

  const w = incident.window;
  const maxCpu = Math.max(0, ...w.map((s) => s.cpu || 0));
  const maxMem = Math.max(0, ...w.map((s) => s.mem || 0));
  const minDisk = Math.min(100, ...w.map((s) => (s.disk == null ? 100 : s.disk)));
  const findings = [];
  if (maxMem >= 90) {
    const hog = leader(w, 'm');
    findings.push(`memoire saturee (${maxMem} %)${hog ? `, surtout par ${hog}` : ''}`);
  }
  if (maxCpu >= 90) {
    const busy = leader(w, 'c');
    findings.push(`processeur sature (${maxCpu} %)${busy ? `, surtout par ${busy}` : ''}`);
  }
  if (minDisk <= 3) findings.push(`disque systeme presque plein (${minDisk} % libre)`);
  if (findings.length) return `Juste avant l'arret : ${findings.join(' ; ')}.`;
  return 'Rien d\'anormal dans les minutes precedentes : arret soudain, sans surcharge visible - cela oriente plutot vers le materiel (alimentation, surchauffe, carte graphique) ou un pilote que vers un programme.';
}

module.exports = { BlackBox, createSampler, parseRecords, readRecords, samplesOf, dedupeShutdowns, incidents, verdict, leader, INTERVAL_MS, KEEP_MS };
