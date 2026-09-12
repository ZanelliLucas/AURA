'use strict';

const os = require('os');
const { run, runJson, psQuote, formatBytes, formatDuration, IS_WINDOWS } = require('../platform');

const { findProtected } = require('../protect');

const CATEGORY = 'Systeme';

function requireWindows(what) {
  if (!IS_WINDOWS) throw new Error(`${what} n'est disponible que sous Windows pour l'instant.`);
}

const sys = {
  name: 'sys',
  aliases: ['systeme', 'info'],
  category: CATEGORY,
  summary: 'Vue d\'ensemble de la machine : OS, processeur, memoire, charge.',
  usage: 'sys',
  async run(ctx) {
    const total = os.totalmem();
    const free = os.freemem();
    const used = total - free;
    const cpus = os.cpus();

    const blocks = [
      ctx.out.title('Machine'),
      ctx.out.kv([
        ['Hote', os.hostname()],
        ['Utilisateur', os.userInfo().username],
        ['Systeme', `${os.type()} ${os.release()} (${os.arch()})`],
        ['Demarre depuis', formatDuration(os.uptime())],
        ['Processeur', cpus.length ? `${cpus[0].model.trim()} - ${cpus.length} coeurs` : 'inconnu']
      ]),
      ctx.out.title('Memoire'),
      ctx.out.gauge('RAM', used / total, `${formatBytes(used)} / ${formatBytes(total)}`)
    ];

    if (IS_WINDOWS) {
      try {
        // Compteur de charge processeur : instantane, suffisant pour un apercu.
        const [load] = await runJson(
          "Get-CimInstance Win32_Processor | Select-Object -First 1 -Property LoadPercentage",
          { signal: ctx.signal, timeout: 8000 }
        );
        if (load && load.LoadPercentage != null) {
          blocks.push(ctx.out.gauge('CPU', Number(load.LoadPercentage) / 100, `${load.LoadPercentage} %`));
        }
      } catch {
        // Le compteur peut etre indisponible : l'apercu reste utile sans lui.
      }
    } else {
      const [m1] = os.loadavg();
      blocks.push(ctx.out.gauge('Charge', m1 / (cpus.length || 1), `${m1.toFixed(2)} (1 min)`));
    }

    return blocks;
  }
};

const disk = {
  name: 'disk',
  aliases: ['disques'],
  category: CATEGORY,
  summary: 'Espace disponible sur chaque disque.',
  usage: 'disk',
  async run(ctx) {
    requireWindows('La lecture des disques');
    const drives = await runJson(
      'Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3 or DriveType=2" '
      + '| Select-Object DeviceID, VolumeName, Size, FreeSpace, DriveType',
      { signal: ctx.signal }
    );

    if (!drives.length) return ctx.out.warn('Aucun disque detecte.');

    const blocks = [ctx.out.title('Disques')];
    for (const drive of drives) {
      const size = Number(drive.Size) || 0;
      const free = Number(drive.FreeSpace) || 0;
      const used = size - free;
      const label = `${drive.DeviceID} ${drive.VolumeName ? `(${drive.VolumeName})` : ''}`.trim();
      if (!size) {
        blocks.push(ctx.out.dim(`${label} - taille inconnue`));
        continue;
      }
      blocks.push(ctx.out.gauge(label, used / size, `${formatBytes(free)} libres sur ${formatBytes(size)}`));
    }
    return blocks;
  }
};

const ps = {
  name: 'ps',
  aliases: ['processus'],
  category: CATEGORY,
  summary: 'Liste les processus en cours.',
  usage: 'ps [nom] [--tri ram|cpu|nom] [--limit 20]',
  flags: { tri: 'string', limit: 'number' },
  flagAliases: { sort: 'tri' },
  flagHelp: { tri: 'Trier par ram (defaut), cpu ou nom.', limit: 'Nombre de lignes (defaut 20).' },
  short: { n: 'limit', t: 'tri' },
  examples: ['ps', 'ps chrome', 'ps --tri cpu --limit 10'],
  async run(ctx) {
    requireWindows('La liste des processus');
    const filter = (ctx.args[0] || '').toLowerCase();
    const limit = Math.max(1, ctx.flags.limit || 20);
    const tri = (ctx.flags.tri || 'ram').toLowerCase();
    if (!['ram', 'cpu', 'nom'].includes(tri)) throw new Error('--tri accepte : ram, cpu, nom.');

    const list = await runJson(
      'Get-Process | Select-Object Id, ProcessName, WorkingSet64, CPU',
      { signal: ctx.signal, timeout: 15000 }
    );

    let rows = list.map((p) => ({
      pid: String(p.Id),
      nom: p.ProcessName,
      ram: formatBytes(Number(p.WorkingSet64) || 0),
      cpu: p.CPU == null ? '-' : `${Number(p.CPU).toFixed(1)} s`,
      _ram: Number(p.WorkingSet64) || 0,
      _cpu: Number(p.CPU) || 0
    }));

    if (filter) rows = rows.filter((r) => r.nom.toLowerCase().includes(filter));
    if (!rows.length) return ctx.out.warn(filter ? `Aucun processus « ${ctx.args[0]} ».` : 'Aucun processus.');

    const comparators = {
      ram: (a, b) => b._ram - a._ram,
      cpu: (a, b) => b._cpu - a._cpu,
      nom: (a, b) => a.nom.localeCompare(b.nom, 'fr')
    };
    rows.sort(comparators[tri]);

    const total = rows.length;
    rows = rows.slice(0, limit);

    return [
      ctx.out.table(
        [
          { key: 'pid', label: 'PID', align: 'right' },
          { key: 'nom', label: 'Processus' },
          { key: 'ram', label: 'Memoire', align: 'right' },
          { key: 'cpu', label: 'CPU', align: 'right' }
        ],
        rows
      ),
      ctx.out.dim(`${rows.length} sur ${total} processus - tri par ${tri}`)
    ];
  }
};

const kill = {
  name: 'kill',
  aliases: ['tuer'],
  category: CATEGORY,
  summary: 'Termine un processus par son PID ou son nom.',
  usage: 'kill <pid|nom> [--force]',
  details: 'Par nom, tous les processus portant ce nom sont vises : verifiez d\'abord avec `ps <nom>`.',
  flags: { force: 'boolean' },
  flagHelp: { force: 'Terminer sans attendre la fermeture propre.' },
  dangerous: true,
  examples: ['kill 12345', 'ps bloc-notes', 'kill notepad --force'],
  async run(ctx) {
    requireWindows('L\'arret de processus');
    const target = ctx.args[0];
    if (!target) throw new Error('Indiquez un PID ou un nom de processus.');

    // La cible est d'abord traduite en PID : c'est ce qui permet de refuser
    // de tuer le Terminal ou son hote, y compris par leur nom (`kill electron`).
    let pids;
    if (/^\d+$/.test(target)) {
      pids = [Number(target)];
    } else {
      const rows = await runJson(
        `Get-Process -Name ${psQuote(target.replace(/\.exe$/i, ''))} -ErrorAction SilentlyContinue | Select-Object Id`,
        { signal: ctx.signal }
      );
      pids = rows.map((row) => Number(row.Id)).filter(Number.isInteger);
      if (!pids.length) throw new Error(`Processus introuvable : ${target}`);
    }

    const blocked = await findProtected(ctx, pids);
    if (blocked.length) {
      const detail = blocked.map((b) => `PID ${b.pid} : ${b.reason}`).join(' ; ');
      const others = pids.length > blocked.length
        ? ' Aucun processus n\'a ete arrete : visez les autres par leur PID.'
        : '';
      throw new Error(`Refus - ${detail}.${others}`);
    }

    const script = `Stop-Process -Id ${pids.join(',')}${ctx.flags.force ? ' -Force' : ''} -ErrorAction Stop`;
    const { code, stderr } = await run(script, { signal: ctx.signal });
    if (code !== 0) {
      const message = stderr.trim().split('\n')[0] || 'Echec de l\'arret du processus.';
      throw new Error(message.includes('Cannot find') ? `Processus introuvable : ${target}` : message);
    }
    return ctx.out.success(pids.length > 1
      ? `${pids.length} processus arretes : ${target}`
      : `Processus arrete : ${target}`);
  }
};

const net = {
  name: 'net',
  aliases: ['reseau', 'ip'],
  category: CATEGORY,
  summary: 'Interfaces reseau et adresses IP.',
  usage: 'net [--tout]',
  flags: { tout: 'boolean' },
  flagHelp: { tout: 'Inclure les interfaces internes et l\'IPv6.' },
  run(ctx) {
    const interfaces = os.networkInterfaces();
    const rows = [];

    for (const [name, addresses] of Object.entries(interfaces)) {
      for (const address of addresses || []) {
        if (!ctx.flags.tout && (address.internal || address.family === 'IPv6')) continue;
        rows.push({
          interface: name,
          famille: address.family,
          adresse: address.address,
          mac: address.mac === '00:00:00:00:00:00' ? '-' : address.mac
        });
      }
    }

    if (!rows.length) return ctx.out.warn('Aucune interface reseau active.');
    return ctx.out.table(
      [
        { key: 'interface', label: 'Interface' },
        { key: 'famille', label: 'Famille' },
        { key: 'adresse', label: 'Adresse' },
        { key: 'mac', label: 'MAC' }
      ],
      rows
    );
  }
};

const ports = {
  name: 'ports',
  category: CATEGORY,
  summary: 'Ports en ecoute et processus qui les occupent.',
  usage: 'ports [numero]',
  details: 'Pratique pour savoir ce qui bloque un port de developpement.',
  examples: ['ports', 'ports 3000'],
  async run(ctx) {
    requireWindows('La liste des ports');
    const wanted = ctx.args[0] ? Number(ctx.args[0]) : null;
    if (ctx.args[0] && !Number.isInteger(wanted)) throw new Error('Indiquez un numero de port valide.');

    const filter = wanted ? ` | Where-Object { $_.LocalPort -eq ${wanted} }` : '';
    const entries = await runJson(
      `Get-NetTCPConnection -State Listen${filter} `
      + '| Select-Object LocalAddress, LocalPort, OwningProcess '
      + '| Sort-Object LocalPort',
      { signal: ctx.signal, timeout: 15000 }
    );

    if (!entries.length) {
      return ctx.out.warn(wanted ? `Le port ${wanted} n'est pas ecoute.` : 'Aucun port en ecoute.');
    }

    // Une seule requete pour tous les noms de processus, plutot qu'une par port.
    let names = new Map();
    try {
      const processes = await runJson('Get-Process | Select-Object Id, ProcessName', { signal: ctx.signal });
      names = new Map(processes.map((p) => [String(p.Id), p.ProcessName]));
    } catch {
      // Sans les noms, les PID restent exploitables.
    }

    const rows = entries.map((entry) => ({
      port: String(entry.LocalPort),
      adresse: entry.LocalAddress,
      pid: String(entry.OwningProcess),
      processus: names.get(String(entry.OwningProcess)) || '-'
    }));

    return [
      ctx.out.table(
        [
          { key: 'port', label: 'Port', align: 'right' },
          { key: 'adresse', label: 'Adresse' },
          { key: 'pid', label: 'PID', align: 'right' },
          { key: 'processus', label: 'Processus' }
        ],
        rows
      ),
      ctx.out.dim(`${rows.length} port(s) en ecoute - \`kill <pid>\` pour liberer`)
    ];
  }
};

const env = {
  name: 'env',
  aliases: ['variables'],
  category: CATEGORY,
  summary: 'Affiche les variables d\'environnement, celles du Terminal (set) en tete.',
  usage: 'env [filtre]',
  examples: ['env', 'env PATH'],
  run(ctx) {
    const filter = (ctx.args[0] || '').toLowerCase();
    const matches = ([key]) => !filter || key.toLowerCase().includes(filter);
    const own = [...ctx.session.variables.entries()].filter(matches).sort(([a], [b]) => a.localeCompare(b));
    const pairs = Object.entries(process.env)
      .filter(matches)
      .sort(([a], [b]) => a.localeCompare(b));

    if (!pairs.length && !own.length) return ctx.out.warn(`Aucune variable correspondant a « ${ctx.args[0]} ».`);

    // PATH tient sur une ligne illisible : on l'eclate en liste.
    if (!own.length && pairs.length === 1 && /^path$/i.test(pairs[0][0])) {
      const entries = pairs[0][1].split(require('path').delimiter).filter(Boolean);
      return [ctx.out.title('PATH', `${entries.length} entrees`), ctx.out.list(entries)];
    }

    const shorten = ([key, value]) => [key, value.length > 120 ? `${value.slice(0, 117)}...` : value];
    if (!own.length) return ctx.out.kv(pairs.map(shorten));
    const blocks = [ctx.out.title('Variables du Terminal', 'set'), ctx.out.kv(own.map(shorten))];
    if (pairs.length) blocks.push(ctx.out.title('Systeme'), ctx.out.kv(pairs.map(shorten)));
    return blocks;
  }
};

module.exports = [sys, disk, ps, kill, net, ports, env];
