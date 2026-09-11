// Connecteur AURA SYSTEM MONITOR (§5.7). Lecture seule (niveau OBSERVE,
// §14.2) - jamais d'action, uniquement de l'observation.
const si = require('systeminformation');

function round1(n) {
  return n === null || n === undefined ? null : Math.round(n * 10) / 10;
}

// cpu.brand contient deja souvent le nom du fabricant (ex. brand="Intel(R)
// Core(TM) i9-12900KF" avec manufacturer="Intel Gen") - le reprefixer sans
// verification donne un nom double ("Intel Gen Intel(R) Core(TM)...").
// Comparer seulement le premier mot du fabricant (le vrai nom de marque,
// "Intel"/"AMD"...) suffit a detecter ce doublon.
function nomCpu(cpu) {
  const brand = (cpu.brand || '').trim();
  const fabricant = (cpu.manufacturer || '').trim();
  const premierMot = fabricant.split(/\s+/)[0] || '';
  if (!fabricant || (premierMot && brand.toLowerCase().includes(premierMot.toLowerCase()))) return brand;
  return `${fabricant} ${brand}`.trim();
}

async function getSnapshot() {
  const [cpu, load, mem, graphics, fsSize, fsStats, netStats, processes, battery] = await Promise.all([
    si.cpu(),
    si.currentLoad(),
    si.mem(),
    si.graphics().catch(() => ({ controllers: [] })),
    si.fsSize(),
    // Resout parfois avec null plutot que de rejeter (pas d'echec a
    // rattraper) quand la lecture des compteurs disque echoue.
    si.fsStats().then((r) => r || { rx_sec: null, wx_sec: null }).catch(() => ({ rx_sec: null, wx_sec: null })),
    si.networkStats().catch(() => []),
    si.processes(),
    // Absente sur un poste fixe (pas d'echec a signaler) - juste rien a
    // afficher cote rendu (voir hasBattery, app.js).
    si.battery().catch(() => ({ hasBattery: false }))
  ]);

  return {
    cpu: {
      model: nomCpu(cpu),
      cores: cpu.cores,
      speedGhz: cpu.speed,
      loadPercent: round1(load.currentLoad)
      // Pas de temperature : si.cpuTemperature() ne renvoie que des null
      // sur ce type de machine (pas de zone thermique ACPI exposee sans
      // logiciel constructeur/tiers) - pas une valeur a essayer d'afficher.
    },
    uptimeSec: si.time().uptime,
    memory: {
      totalGB: round1(mem.total / 1e9),
      usedGB: round1(mem.used / 1e9),
      usedPercent: round1((mem.used / mem.total) * 100),
      swapTotalGB: round1(mem.swaptotal / 1e9),
      swapUsedGB: round1(mem.swapused / 1e9),
      swapUsedPercent: mem.swaptotal ? round1((mem.swapused / mem.swaptotal) * 100) : null
    },
    gpu: (graphics.controllers || [])
      .filter((g) => g.vram)
      .map((g) => ({
        model: g.model,
        vramMB: g.vram,
        loadPercent: g.utilizationGpu ?? null,
        temperatureC: g.temperatureGpu ?? null,
        memoryUsedMB: g.memoryUsed ?? null
      })),
    disks: fsSize.map((d) => ({
      mount: d.mount,
      sizeGB: round1(d.size / 1e9),
      usedGB: round1(d.used / 1e9),
      usedPercent: round1(d.use)
    })),
    // Agrege tous les disques (systeminformation ne ventile pas les debits
    // par point de montage) - lecture/ecriture globales, comme le total
    // reseau ci-dessous mais pour le stockage.
    diskIO: {
      readKBs: fsStats.rx_sec == null ? null : round1(fsStats.rx_sec / 1024),
      writeKBs: fsStats.wx_sec == null ? null : round1(fsStats.wx_sec / 1024)
    },
    network: netStats
      .filter((n) => n.operstate === 'up')
      .map((n) => ({
        iface: n.iface,
        rxKBs: round1(n.rx_sec / 1024),
        txKBs: round1(n.tx_sec / 1024)
      })),
    topProcesses: processes.list
      .slice()
      .sort((a, b) => b.cpu - a.cpu)
      .slice(0, 8)
      .map((p) => ({ pid: p.pid, name: p.name, cpuPercent: round1(p.cpu), memPercent: round1(p.mem) })),
    processCount: processes.all,
    // Liste complete (façon Gestionnaire des taches), triable par CPU ou
    // memoire cote client (app.js). Fusion des top 40 par CPU et top 40
    // par memoire (deduplique par pid) plutot qu'un seul tri par CPU : un
    // processus gourmand en memoire mais inactif en CPU (ex. un onglet en
    // arriere-plan) serait sinon absent du tri par memoire, coupe avant
    // meme d'arriver au client.
    allProcesses: (function() {
      const parPid = new Map();
      const ajouter = (liste) => liste.forEach((p) => parPid.set(p.pid, p));
      ajouter(processes.list.slice().sort((a, b) => b.cpu - a.cpu).slice(0, 40));
      ajouter(processes.list.slice().sort((a, b) => b.mem - a.mem).slice(0, 40));
      return Array.from(parPid.values())
        .sort((a, b) => b.cpu - a.cpu)
        .map((p) => ({ pid: p.pid, name: p.name, cpuPercent: round1(p.cpu), memPercent: round1(p.mem) }));
    })(),
    battery: battery.hasBattery ? {
      percent: round1(battery.percent),
      isCharging: battery.isCharging,
      timeRemainingMin: battery.timeRemaining > 0 ? battery.timeRemaining : null
    } : null,
    takenAt: new Date().toISOString()
  };
}

module.exports = { getSnapshot };
