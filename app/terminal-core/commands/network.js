'use strict';

/**
 * Reseau : `ping`, `dns`, `wifi`. (`net` et `ports` sont dans system.js.)
 *
 * ping et netsh ecrivent dans la page de code OEM de la console (850 sur un
 * Windows francais), meme apres `chcp 65001` quand la console est cachee :
 * leur sortie est decodee ici. Les libelles de netsh dependent de la langue
 * de Windows : le francais et l'anglais sont reconnus.
 */

const { spawn } = require('child_process');
const dns = require('dns');
const net = require('net');
const { IS_WINDOWS } = require('../platform');
const { killTree } = require('../servers');
const { fold } = require('../text');

/** Octets 0x80 a 0xFF de la page de code 850 (Europe de l'Ouest, console Windows). */
const CP850_HIGH = 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø×ƒáíóúñÑªº¿®¬½¼¡«»░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐'
  + '└┴┬├─┼ãÃ╚╔╩╦╠═╬¤ðÐÊËÈıÍÎÏ┘┌█▄¦Ì▀ÓßÔÒõÕµþÞÚÛÙýÝ¯´'
  + String.fromCharCode(0xad) + '±‗¾¶§÷¸°¨·¹³²■' + String.fromCharCode(0xa0);

/** Sortie d'un outil de la console : UTF-8 si elle en est, sinon page de code 850. */
function decodeConsole(buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    let text = '';
    for (const byte of buffer) text += byte < 0x80 ? String.fromCharCode(byte) : CP850_HIGH[byte - 0x80];
    return text;
  }
}

/** Lance un outil et rend sa sortie decodee (stdout puis stderr). */
function runTool(file, args, { signal, timeout = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { windowsHide: true });
    const chunks = [];
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.stderr.on('data', (chunk) => chunks.push(chunk));
    const stop = () => { try { child.kill(); } catch { /* deja fini */ } };
    const timer = setTimeout(() => { stop(); reject(new Error(`${file} ne repond pas.`)); }, timeout);
    const onAbort = () => { stop(); reject(aborted()); };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    child.once('error', (err) => { clearTimeout(timer); reject(err); });
    child.once('close', () => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve(decodeConsole(Buffer.concat(chunks)));
    });
  });
}

const CATEGORY = 'Reseau';

/** Nom d'hote ou adresse IP : jamais de quoi glisser une autre commande. */
const HOST = /^[A-Za-z0-9][A-Za-z0-9._:%-]{0,252}$/;

function checkHost(value, example) {
  const host = String(value || '').trim();
  if (!host) throw new Error(`Indiquez un nom ou une adresse. Exemple : ${example}`);
  if (!HOST.test(host)) throw new Error(`Nom ou adresse invalide : ${host}`);
  return host;
}

const aborted = () => Object.assign(new Error('Interrompu.'), { name: 'AbortError' });

// --- ping -----------------------------------------------------------------------

/**
 * Une ligne de ping. Reponse : elle porte un TTL (« Réponse de 1.1.1.1 :
 * octets=32 temps=12 ms TTL=57 », « time=12.3 ms ttl=117 »). Le reste de la
 * phase des reponses est un echec (« Délai d'attente de la demande dépassé. »).
 */
function parsePingLine(line) {
  const text = String(line || '').trim();
  if (!text) return null;
  if (/\bttl[=:]/i.test(text)) {
    const time = /[=<]\s*(\d+(?:[.,]\d+)?)\s*ms/i.exec(text);
    const below = /<\s*1\s*ms/i.test(text);
    return { kind: 'reply', ms: below ? 0 : (time ? Number(time[1].replace(',', '.')) : null), below };
  }
  return { kind: 'fail', text };
}

/** Bilan : envoyes, recus, perdus, temps min / moyen / max. */
function pingSummary(times, sent) {
  const received = times.length;
  const lost = Math.max(0, sent - received);
  const known = times.filter((t) => t != null);
  const round = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ','));
  const stats = known.length
    ? { min: Math.min(...known), max: Math.max(...known), avg: known.reduce((a, b) => a + b, 0) / known.length }
    : null;
  return {
    sent,
    received,
    lost,
    lossPercent: sent ? Math.round((lost / sent) * 100) : 0,
    stats,
    label: stats ? `min ${round(stats.min)} - moy ${round(stats.avg)} - max ${round(stats.max)} ms` : '-'
  };
}

const ping = {
  name: 'ping',
  category: CATEGORY,
  summary: 'Verifie qu\'une machine repond, et en combien de temps.',
  usage: 'ping <nom|adresse> [--nombre 4]',
  details: [
    'Chaque reponse s\'affiche des qu\'elle arrive, puis le bilan : paquets',
    'perdus et temps de reponse. Aucune reponse : la commande echoue (utile',
    'avec && ou ||). Pour surveiller en continu : watch ping 1.1.1.1 -n 1'
  ].join('\n'),
  flags: { nombre: 'number' },
  flagAliases: { count: 'nombre' },
  flagHelp: { nombre: 'Nombre de paquets envoyes (defaut 4, de 1 a 100).' },
  short: { n: 'nombre' },
  examples: ['ping google.fr', 'ping 192.168.1.1 --nombre 10', 'watch ping 1.1.1.1 -n 1'],
  async run(ctx) {
    const host = checkHost(ctx.args[0], 'ping google.fr');
    const count = Math.min(100, Math.max(1, Math.round(ctx.flags.nombre || 4)));
    const child = spawn('ping', IS_WINDOWS ? ['-n', String(count), host] : ['-c', String(count), host], { windowsHide: true });

    let phase = 'before';
    let header = '';
    let address = host;
    const times = [];
    let failures = 0;

    const onLine = (line) => {
      if (phase === 'after') return;
      if (phase === 'before') {
        if (!line.trim()) return;
        header = line.trim();
        const ip = /\[([0-9a-fA-F:.%]+)\]|\(([0-9a-fA-F:.%]+)\)/.exec(header);
        if (ip) address = ip[1] || ip[2];
        phase = 'replies';
        return;
      }
      const parsed = parsePingLine(line);
      if (!parsed) {
        if (times.length || failures) phase = 'after';
        return;
      }
      if (parsed.kind === 'reply') {
        times.push(parsed.ms);
        ctx.emit(ctx.out.text(`Reponse de ${address} : ${parsed.below ? '<1' : parsed.ms} ms`));
      } else {
        failures += 1;
        ctx.emit(ctx.out.warn(parsed.text));
      }
    };

    // Lignes completes, decodees une a une : un accent n'est jamais coupe en deux.
    let pending = Buffer.alloc(0);
    const feed = (chunk) => {
      pending = Buffer.concat([pending, chunk]);
      let cut;
      while ((cut = pending.indexOf(0x0a)) !== -1) {
        onLine(decodeConsole(pending.subarray(0, cut)).replace(/\r$/, ''));
        pending = pending.subarray(cut + 1);
      }
    };
    child.stdout.on('data', feed);

    const onAbort = () => killTree(child.pid);
    if (ctx.signal) ctx.signal.addEventListener('abort', onAbort, { once: true });
    let code;
    try {
      code = await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('close', (exit) => resolve(exit == null ? -1 : exit));
      });
    } finally {
      if (ctx.signal) ctx.signal.removeEventListener('abort', onAbort);
    }
    if (pending.length) onLine(decodeConsole(pending).replace(/\r$/, ''));
    if (ctx.signal && ctx.signal.aborted) throw aborted();

    if (!times.length && !failures) {
      // Nom inconnu : ping ne dit que cela, dans la langue de Windows.
      ctx.emit(ctx.out.dim(`dns ${host} verifie si ce nom existe.`));
      throw new Error(header || `Aucune reponse de ${host} (code ${code}).`);
    }

    const summary = pingSummary(times, count);
    ctx.emit(ctx.out.kv([
      ['Adresse', address === host ? host : `${host} (${address})`],
      ['Envoyes', String(summary.sent)],
      ['Recus', String(summary.received)],
      ['Perdus', `${summary.lost} (${summary.lossPercent} %)`],
      ['Temps de reponse', summary.label]
    ]));
    if (!summary.received) throw new Error(`Aucune reponse de ${host} : machine eteinte, hors reseau, ou qui ignore le ping.`);
    if (summary.lost) ctx.emit(ctx.out.warn(`${summary.lost} paquet${summary.lost > 1 ? 's' : ''} perdu${summary.lost > 1 ? 's' : ''} sur ${summary.sent} : connexion instable.`));
    return null;
  }
};

// --- dns ------------------------------------------------------------------------

const DNS_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'NS', 'TXT', 'SOA', 'SRV', 'PTR', 'CAA'];

function recordText(type, record) {
  if (typeof record === 'string') return record;
  if (type === 'MX') return `${record.priority} ${record.exchange}`;
  if (type === 'TXT') return record.join('');
  if (type === 'SOA') return `${record.nsname} ${record.hostmaster} (serie ${record.serial})`;
  if (type === 'SRV') return `${record.priority} ${record.weight} ${record.port} ${record.name}`;
  if (type === 'CAA') return `${record.critical} ${Object.keys(record).filter((k) => k !== 'critical').map((k) => `${k} ${record[k]}`).join(' ')}`;
  return JSON.stringify(record);
}

function dnsError(err, target) {
  if (err && (err.code === 'ENOTFOUND' || err.code === 'ENODATA')) return new Error(`Nom introuvable : ${target}. Verifiez l'orthographe.`);
  if (err && ['EAI_AGAIN', 'ETIMEOUT', 'ECONNREFUSED', 'ESERVFAIL'].includes(err.code)) {
    return new Error(`Les serveurs DNS ne repondent pas (${err.code}) : connexion Internet coupee ? ping 1.1.1.1 pour le verifier.`);
  }
  return err;
}

const dnsCommand = {
  name: 'dns',
  aliases: ['nslookup'],
  category: CATEGORY,
  summary: 'Resout un nom de domaine, ou retrouve le nom d\'une adresse IP.',
  usage: 'dns <nom|adresse> [--type MX,TXT]',
  details: [
    'Sans --type : l\'adresse que Windows donne aux programmes (resolveur du',
    'systeme, fichier hosts compris), puis les enregistrements A et AAAA',
    'demandes aux serveurs DNS. Une difference entre les deux trahit souvent',
    'une ligne du fichier hosts ou un cache perime.',
    `Types : ${DNS_TYPES.join(', ')}.`
  ].join('\n'),
  flags: { type: 'list' },
  flagHelp: { type: 'Types d\'enregistrements a demander (MX pour la messagerie, TXT, NS...).' },
  short: { t: 'type' },
  examples: ['dns google.fr', 'dns gmail.com --type MX', 'dns 8.8.8.8'],
  async run(ctx) {
    const { out } = ctx;
    const target = checkHost(ctx.args[0], 'dns google.fr');
    const resolver = new dns.promises.Resolver({ timeout: 4000, tries: 2 });
    const servers = dns.getServers();
    const blocks = [];

    if (net.isIP(target)) {
      let names = [];
      try {
        names = await resolver.reverse(target);
      } catch (err) {
        if (!['ENOTFOUND', 'ENODATA'].includes(err.code)) throw dnsError(err, target);
      }
      blocks.push(out.title(target, 'recherche inverse'));
      blocks.push(names.length ? out.list(names) : out.dim('Aucun nom enregistre pour cette adresse.'));
    } else {
      const types = (ctx.flags.type || []).map((t) => t.toUpperCase());
      const unknown = types.filter((t) => !DNS_TYPES.includes(t));
      if (unknown.length) throw new Error(`Type inconnu : ${unknown.join(', ')}. Types : ${DNS_TYPES.join(', ')}.`);

      const rows = [];
      if (!types.length) {
        let system;
        try {
          system = await dns.promises.lookup(target, { all: true });
        } catch (err) {
          throw dnsError(err, target);
        }
        for (const entry of system) rows.push({ type: entry.family === 6 ? 'AAAA' : 'A', valeur: entry.address, source: 'systeme' });
      }

      const notes = [];
      for (const type of types.length ? types : ['A', 'AAAA']) {
        try {
          const records = await resolver.resolve(target, type);
          for (const record of records) rows.push({ type, valeur: recordText(type, record), source: 'serveur DNS' });
        } catch (err) {
          if (['ENODATA', 'ENOTFOUND'].includes(err.code)) {
            if (types.length) notes.push(`Aucun enregistrement ${type}.`);
          } else {
            notes.push(`${type} : ${dnsError(err, target).message}`);
          }
        }
      }

      blocks.push(out.title(target, 'DNS'));
      if (rows.length) {
        blocks.push(out.table([
          { key: 'type', label: 'Type' },
          { key: 'valeur', label: 'Valeur' },
          { key: 'source', label: 'Source' }
        ], rows));
      } else if (types.length) {
        blocks.push(out.warn(`Aucun enregistrement ${types.join(', ')} pour ${target}.`));
      }
      notes.forEach((note) => blocks.push(out.dim(note)));
    }
    blocks.push(out.dim(`Serveurs DNS : ${servers.join(', ') || '(aucun)'}`));
    return blocks;
  }
};

// --- wifi -----------------------------------------------------------------------

/** Lignes « Cle   : valeur » de netsh, en sections separees par une ligne vide. */
function parseNetsh(text) {
  const sections = [];
  let current = null;
  for (const line of String(text || '').split(/\r?\n/)) {
    const match = /^\s*([^:]+?)\s+:\s?(.*)$/.exec(line);
    if (!match) {
      if (!line.trim()) current = null;
      continue;
    }
    if (!current) {
      current = [];
      sections.push(current);
    }
    current.push([fold(match[1]).replace(/[’']/g, ' ').trim(), match[2].trim()]);
  }
  return sections;
}

/** Premiere valeur dont la cle (repliee) commence par l'un des libelles. */
function pick(section, ...labels) {
  const found = section.find(([key]) => labels.some((label) => key === label || key.startsWith(label)));
  return found ? found[1] : '';
}

/** Une carte Wi-Fi decrite par `netsh wlan show interfaces`. */
function describeInterface(section) {
  const signal = Number((pick(section, 'signal').match(/\d+/) || [])[0]);
  const state = pick(section, 'etat', 'state');
  return {
    name: pick(section, 'nom', 'name'),
    description: pick(section, 'description'),
    state,
    connected: Boolean(pick(section, 'ssid')) && !/deconnect|disconnect|non connect|not connect/.test(fold(state)),
    ssid: pick(section, 'ssid'),
    bssid: pick(section, 'ap bssid', 'bssid'),
    signal: Number.isFinite(signal) ? signal : null,
    radio: pick(section, 'type de radio', 'radio type'),
    band: pick(section, 'bande', 'band'),
    channel: pick(section, 'canal', 'channel'),
    auth: pick(section, 'authentification', 'authentication'),
    receive: pick(section, 'debit de reception', 'receive rate'),
    transmit: pick(section, 'debit de transmission', 'transmit rate'),
    profile: pick(section, 'profil', 'profile')
  };
}

/** Reseaux a portee (`netsh wlan show networks mode=bssid`) : le meilleur signal de chacun. */
function parseNetworks(text) {
  const networks = [];
  let current = null;
  for (const line of String(text || '').split(/\r?\n/)) {
    const ssid = /^\s*SSID\s+\d+\s*:\s?(.*)$/i.exec(line);
    if (ssid) {
      current = { ssid: ssid[1].trim() || '(reseau masque)', auth: '', signal: null, band: '', channel: '' };
      networks.push(current);
      continue;
    }
    if (!current) continue;
    const match = /^\s*([^:]+?)\s+:\s?(.*)$/.exec(line);
    if (!match) continue;
    const key = fold(match[1]).trim();
    const value = match[2].trim();
    if (key.startsWith('authentification') || key.startsWith('authentication')) current.auth = current.auth || value;
    else if (key === 'signal') {
      const n = Number((value.match(/\d+/) || [])[0]);
      if (Number.isFinite(n) && (current.signal == null || n > current.signal)) current.signal = n;
    } else if ((key === 'bande' || key === 'band') && !current.band) current.band = value;
    else if ((key === 'canal' || key === 'channel') && !current.channel) current.channel = value;
  }
  return networks.sort((a, b) => (b.signal || 0) - (a.signal || 0));
}

/** Message de netsh qui explique pourquoi il ne peut rien dire, traduit en conseil. */
function wifiProblem(text) {
  const folded = fold(text);
  if (/ms-settings:privacy-location|location permission|autorisation.*(localisation|emplacement)/.test(folded)) {
    return 'Windows demande l\'acces a la localisation pour lire le Wi-Fi : Parametres > Confidentialite et securite > Localisation, puis autorisez les applications de bureau.';
  }
  if (/wlansvc/.test(folded)) {
    return 'Le service Wi-Fi de Windows (WlanSvc) ne tourne pas : pas de carte Wi-Fi, ou service desactive. `service wlansvc` pour le detail.';
  }
  if (/pas d.interface sans fil|no wireless interface/.test(folded)) {
    return null;
  }
  return undefined;
}

const netsh = (args, signal) => runTool('netsh', args, { signal });

const wifi = {
  name: 'wifi',
  aliases: ['wi-fi'],
  category: CATEGORY,
  summary: 'Connexion Wi-Fi : reseau, signal, debit ; --reseaux pour ceux a portee.',
  usage: 'wifi [--reseaux]',
  details: 'Un PC relie par cable n\'a souvent pas de carte Wi-Fi : `net` liste alors ses interfaces.',
  flags: { reseaux: 'boolean' },
  flagHelp: { reseaux: 'Lister les reseaux a portee, du meilleur signal au plus faible.' },
  examples: ['wifi', 'wifi --reseaux', 'watch wifi'],
  async run(ctx) {
    const { out } = ctx;
    if (!IS_WINDOWS) throw new Error('wifi s\'appuie sur netsh : disponible sous Windows seulement.');

    const text = await netsh(['wlan', 'show', 'interfaces'], ctx.signal);
    const problem = wifiProblem(text);
    if (problem) throw new Error(problem);
    const cards = parseNetsh(text).filter((s) => pick(s, 'nom', 'name') && pick(s, 'description')).map(describeInterface);
    if (!cards.length) {
      return out.text('Aucune carte Wi-Fi sur ce PC : il est probablement relie par cable. `net` liste ses interfaces reseau.');
    }

    const blocks = [];
    for (const card of cards) {
      blocks.push(out.title(card.name || 'Wi-Fi', card.description));
      if (!card.connected) {
        blocks.push(out.warn(`Non connecte${card.state ? ` (${card.state})` : ''}.`));
        continue;
      }
      if (card.signal != null) blocks.push(out.gauge('Signal', card.signal / 100, `${card.signal} %`));
      const pairs = [['Reseau', card.ssid]];
      if (card.auth) pairs.push(['Securite', card.auth]);
      if (card.radio) pairs.push(['Norme', card.radio]);
      if (card.band || card.channel) pairs.push(['Bande / canal', [card.band, card.channel && `canal ${card.channel}`].filter(Boolean).join(' - ')]);
      if (card.receive || card.transmit) pairs.push(['Debit', `${card.receive || '?'} Mbit/s en reception, ${card.transmit || '?'} en emission`]);
      if (card.bssid) pairs.push(['Borne (BSSID)', card.bssid]);
      blocks.push(out.kv(pairs));
      if (card.signal != null && card.signal < 40) {
        blocks.push(out.warn(`Signal faible (${card.signal} %) : la connexion peut etre lente ou se couper.`));
      }
    }

    if (ctx.flags.reseaux) {
      const networks = parseNetworks(await netsh(['wlan', 'show', 'networks', 'mode=bssid'], ctx.signal));
      blocks.push(out.title('Reseaux a portee', `${networks.length}`));
      blocks.push(networks.length
        ? out.table([
            { key: 'ssid', label: 'Reseau' },
            { key: 'signal', label: 'Signal', align: 'right' },
            { key: 'band', label: 'Bande' },
            { key: 'channel', label: 'Canal', align: 'right' },
            { key: 'auth', label: 'Securite' }
          ], networks.map((n) => ({ ...n, signal: n.signal == null ? '' : `${n.signal} %` })))
        : out.dim('Aucun reseau visible.'));
    }
    return blocks;
  }
};

module.exports = [ping, dnsCommand, wifi];
Object.assign(module.exports, { parsePingLine, pingSummary, parseNetsh, describeInterface, parseNetworks, wifiProblem, checkHost, decodeConsole, CP850_HIGH });
