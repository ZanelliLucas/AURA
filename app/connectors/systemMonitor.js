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
  const [cpu, load, temp, mem, graphics, fsSize, netStats, processes] = await Promise.all([
    si.cpu(),
    si.currentLoad(),
    si.cpuTemperature().catch(() => ({ main: null })),
    si.mem(),
    si.graphics().catch(() => ({ controllers: [] })),
    si.fsSize(),
    si.networkStats().catch(() => []),
    si.processes()
  ]);

  return {
    cpu: {
      model: nomCpu(cpu),
      cores: cpu.cores,
      speedGhz: cpu.speed,
      loadPercent: round1(load.currentLoad),
      temperatureC: temp.main
    },
    memory: {
      totalGB: round1(mem.total / 1e9),
      usedGB: round1(mem.used / 1e9),
      usedPercent: round1((mem.used / mem.total) * 100)
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
    takenAt: new Date().toISOString()
  };
}

module.exports = { getSnapshot };
