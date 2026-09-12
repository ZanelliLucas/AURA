'use strict';

const { spawn } = require('child_process');
const os = require('os');

const IS_WINDOWS = process.platform === 'win32';

/**
 * Execute une commande dans le shell natif et renvoie sa sortie.
 * Utilise pour tout ce que Node n'expose pas (processus, disques, reseau).
 *
 * @param {string} command
 * @param {{cwd?:string, timeout?:number, signal?:AbortSignal, shell?:'powershell'|'cmd'|'sh'}} options
 * @returns {Promise<{code:number, stdout:string, stderr:string}>}
 */
function run(command, options = {}) {
  const { cwd, timeout = 30000, signal, shell } = options;
  const kind = shell || (IS_WINDOWS ? 'powershell' : 'sh');

  let file;
  let args;
  if (kind === 'powershell') {
    file = 'powershell.exe';
    // Sortie en UTF-8, comme on la lit : sans cela, PowerShell 5 ecrit dans la
    // page de code OEM et tout accent arrive casse - un chemin comme
    // « Fond écran.jpeg » ne designait plus aucun fichier.
    const utf8 = '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ';
    args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', utf8 + command];
  } else if (kind === 'cmd') {
    file = 'cmd.exe';
    args = ['/d', '/s', '/c', command];
  } else {
    file = '/bin/sh';
    args = ['-c', command];
  }

  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(file, args, { cwd, windowsHide: true });
    } catch (err) {
      reject(err);
      return;
    }

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = timeout
      ? setTimeout(() => {
          if (settled) return;
          settled = true;
          try { child.kill(); } catch { /* deja termine */ }
          reject(new Error(`Delai depasse (${Math.round(timeout / 1000)} s).`));
        }, timeout)
      : null;

    const onAbort = () => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      try { child.kill(); } catch { /* deja termine */ }
      reject(new Error('Commande interrompue.'));
    };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });

    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      reject(err);
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve({ code: code == null ? -1 : code, stdout, stderr });
    });
  });
}

/**
 * Execute un script PowerShell qui renvoie du JSON et le desserialise.
 * `ConvertTo-Json` produit un objet seul quand il n'y a qu'un element :
 * on normalise toujours en tableau quand `asArray` est vrai.
 */
async function runJson(script, options = {}) {
  const { asArray = true, ...rest } = options;
  const wrapped = `${script} | ConvertTo-Json -Depth 4 -Compress`;
  const { stdout, stderr, code } = await run(wrapped, rest);
  if (code !== 0 && !stdout.trim()) {
    throw new Error(stderr.trim() || `Echec de la commande systeme (code ${code}).`);
  }
  const text = stdout.trim();
  if (!text) return asArray ? [] : null;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Reponse systeme illisible.');
  }
  if (!asArray) return parsed;
  return Array.isArray(parsed) ? parsed : [parsed];
}

/** Echappe une chaine pour l'inserer dans un litteral PowerShell entre apostrophes. */
function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

const UNITS = ['o', 'Ko', 'Mo', 'Go', 'To', 'Po'];

/** Taille lisible : 1536 -> "1,5 Ko". */
function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return '-';
  if (n < 1024) return `${n} o`;
  let value = n;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1).replace('.', ',')} ${UNITS[unit]}`;
}

/** Date lisible et triable : "2026-09-10 14:32". */
function formatDate(input) {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return '-';
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Duree lisible : 3725 s -> "1 h 02 min". */
function formatDuration(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (days) return `${days} j ${String(hours).padStart(2, '0')} h`;
  if (hours) return `${hours} h ${String(minutes).padStart(2, '0')} min`;
  if (minutes) return `${minutes} min ${String(secs).padStart(2, '0')} s`;
  return `${secs} s`;
}

/** Lettres de lecteurs presents (Windows) ou `/` (POSIX). */
function driveRoots() {
  if (!IS_WINDOWS) return ['/'];
  const fs = require('fs');
  const roots = [];
  for (let code = 65; code <= 90; code += 1) {
    const root = `${String.fromCharCode(code)}:\\`;
    try {
      fs.accessSync(root);
      roots.push(root);
    } catch {
      // lecteur absent
    }
  }
  return roots;
}

function hostInfo() {
  return {
    host: os.hostname(),
    user: os.userInfo().username,
    platform: os.platform(),
    release: os.release(),
    arch: os.arch()
  };
}

/**
 * Ouvre un fichier, un dossier ou une adresse web avec le programme par
 * defaut. Ouvreur par defaut du Terminal ; un hote peut fournir le sien
 * (`createTerminal({ opener })`), comme Electron avec `shell.openPath`.
 */
async function openTarget(target) {
  const value = String(target);
  const result = IS_WINDOWS
    ? await run(`Start-Process -FilePath ${psQuote(value)}`, { timeout: 15000 })
    : await run(`${process.platform === 'darwin' ? 'open' : 'xdg-open'} '${value.replace(/'/g, `'\\''`)}'`, { timeout: 15000 });
  if (result.code !== 0) throw new Error(result.stderr.trim() || `Ouverture impossible : ${value}`);
}

/** Code de sortie Windows « operation annulee par l'utilisateur ». */
const ERROR_CANCELLED = 1223;

/**
 * Execute un script PowerShell avec les droits administrateur. Windows
 * affiche sa demande d'autorisation (UAC) : rien ne se passe sans l'accord de
 * l'utilisateur. La sortie d'un processus eleve n'est pas lisible d'ici : le
 * script signale un echec par son code de sortie, et l'appelant relit l'etat.
 *
 * @returns {Promise<number>} 0 si le script a abouti
 * @throws si l'autorisation est refusee
 */
async function runElevated(script, { signal, timeout = 180000 } = {}) {
  if (!IS_WINDOWS) throw new Error('Les droits administrateur ne se demandent que sous Windows.');
  const body = `$ErrorActionPreference = 'Stop'\ntry {\n${script}\n} catch { exit 1 }\nexit 0`;
  const encoded = Buffer.from(body, 'utf16le').toString('base64');
  const launcher = [
    `$a = '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', ${psQuote(encoded)}`,
    'try {',
    '  $p = Start-Process -FilePath powershell.exe -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ArgumentList $a -ErrorAction Stop',
    '} catch {',
    `  exit ${ERROR_CANCELLED}`,
    '}',
    'exit $p.ExitCode'
  ].join('\n');
  const { code } = await run(launcher, { signal, timeout });
  if (code === ERROR_CANCELLED) throw new Error('Autorisation administrateur refusee : rien n\'a ete modifie.');
  return code;
}

module.exports = { IS_WINDOWS, run, runJson, runElevated, psQuote, formatBytes, formatDate, formatDuration, driveRoots, hostInfo, openTarget };
