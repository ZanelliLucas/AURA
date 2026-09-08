const SVG_NS = 'http://www.w3.org/2000/svg';
const GRAPH_NODES = window.AURA_GRAPH.NODES;
const GRAPH_RELATIONS = window.AURA_GRAPH.RELATIONS;

const CENTER = { x: 800, y: 500 };
const R_PRINCIPAL = 260;
const R_TOOL = 95;

function seededOffset(seed, spread) {
  // Decalage deterministe (pas de vrai hasard) pour un trace organique
  // stable d'un lancement a l'autre, comme dans la maquette de reference.
  const s = Math.sin(seed * 999.7) * 10000;
  return (s - Math.floor(s) - 0.5) * 2 * spread;
}

function layout() {
  const positioned = {};
  const step = (Math.PI * 2) / GRAPH_NODES.length;

  GRAPH_NODES.forEach((node, i) => {
    const angle = i * step + seededOffset(i, 0.06);
    const radius = R_PRINCIPAL + seededOffset(i + 50, 24);
    const x = CENTER.x + Math.cos(angle) * radius;
    const y = CENTER.y + Math.sin(angle) * radius;
    positioned[node.id] = { ...node, x, y, angle };
  });

  GRAPH_NODES.forEach((node) => {
    const p = positioned[node.id];
    const toolSpread = 0.5;
    p.toolPositions = node.tools.map((label, i) => {
      const localAngle = p.angle + (i - (node.tools.length - 1) / 2) * (toolSpread / Math.max(node.tools.length - 1, 1));
      const radius = R_PRINCIPAL + R_TOOL + seededOffset(i * 7 + p.angle * 100, 18);
      return {
        label,
        x: CENTER.x + Math.cos(localAngle) * radius,
        y: CENTER.y + Math.sin(localAngle) * radius
      };
    });
  });

  return positioned;
}

function el(tag, attrs) {
  const node = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs || {}).forEach(([k, v]) => node.setAttribute(k, v));
  return node;
}

function render() {
  const svg = document.getElementById('web');
  const positioned = layout();

  // Liens vers le hub central
  Object.values(positioned).forEach((p) => {
    const line = el('line', {
      x1: CENTER.x, y1: CENTER.y, x2: p.x, y2: p.y,
      class: 'link', 'data-node': p.id
    });
    svg.appendChild(line);
  });

  // Liens transversaux reels entre agents (§5.6.1)
  GRAPH_RELATIONS.forEach(([a, b]) => {
    const pa = positioned[a];
    const pb = positioned[b];
    if (!pa || !pb) return;
    const mx = (pa.x + pb.x) / 2 + (pa.y - pb.y) * 0.08;
    const my = (pa.y + pb.y) / 2 + (pb.x - pa.x) * 0.08;
    const path = el('path', {
      d: `M ${pa.x} ${pa.y} Q ${mx} ${my} ${pb.x} ${pb.y}`,
      class: 'link-relation',
      'data-a': a, 'data-b': b
    });
    svg.appendChild(path);
  });

  // Noeuds principaux + leurs outils
  Object.values(positioned).forEach((p) => {
    const group = el('g', { class: 'node-group', 'data-node': p.id });

    p.toolPositions.forEach((tool) => {
      group.appendChild(el('line', {
        x1: p.x, y1: p.y, x2: tool.x, y2: tool.y, class: 'link-tool'
      }));
      group.appendChild(el('circle', { cx: tool.x, cy: tool.y, r: 3, class: 'node-tool' }));
      const label = el('text', { x: tool.x + 7, y: tool.y + 3, class: 'label label-tool' });
      label.textContent = tool.label;
      group.appendChild(label);
    });

    const circle = el('circle', {
      cx: p.x, cy: p.y, r: p.kind === 'core' ? 8 : 7,
      class: p.kind === 'core' ? 'node-core' : 'node-agent'
    });
    group.appendChild(circle);

    const dx = Math.cos(p.angle) >= 0 ? 12 : -12;
    const label = el('text', {
      x: p.x + dx, y: p.y + 4,
      class: 'label', 'text-anchor': Math.cos(p.angle) >= 0 ? 'start' : 'end'
    });
    label.textContent = p.label;
    group.appendChild(label);

    group.addEventListener('mouseenter', () => setActive(p.id, true));
    group.addEventListener('mouseleave', () => setActive(p.id, false));

    svg.appendChild(group);
  });

  // Hub central
  const hub = el('g', { class: 'node-group', 'data-node': '__hub' });
  hub.appendChild(el('circle', { cx: CENTER.x, cy: CENTER.y, r: 46, class: 'node-hub' }));
  const hubLabel = el('text', {
    x: CENTER.x, y: CENTER.y + 5, class: 'label-hub', 'text-anchor': 'middle'
  });
  hubLabel.textContent = 'AURA';
  hub.appendChild(hubLabel);
  svg.appendChild(hub);
}

function setActive(nodeId, active) {
  document.querySelectorAll(`.link[data-node="${nodeId}"]`)
    .forEach((line) => line.classList.toggle('active', active));
  document.querySelectorAll(`.link-relation[data-a="${nodeId}"], .link-relation[data-b="${nodeId}"]`)
    .forEach((path) => path.classList.toggle('active', active));
}

function pulseRandomActivity() {
  if (document.body.classList.contains('estopped')) return;
  const candidates = GRAPH_NODES.map((n) => n.id);
  const id = candidates[Math.floor(Math.random() * candidates.length)];
  setActive(id, true);
  setTimeout(() => setActive(id, false), 900);
}

function startClock() {
  const clockEl = document.getElementById('clock');
  const tick = () => {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    clockEl.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  };
  tick();
  setInterval(tick, 1000);
}

function renderJournal(entries) {
  const list = document.getElementById('journal-list');
  if (!entries.length) {
    list.textContent = 'Aucune action enregistrée pour l’instant.';
    return;
  }
  list.innerHTML = '';
  entries.forEach((entry) => {
    const div = document.createElement('div');
    div.className = `journal-entry ${entry.statut}`;
    const time = new Date(entry.date).toLocaleTimeString('fr-FR');
    div.innerHTML = `<div class="journal-time">${time} · ${entry.statut}</div>${entry.typeAction}`;
    list.appendChild(div);
  });
}

async function loadJournal() {
  try {
    const entries = await window.aura.getJournal();
    renderJournal(entries);
  } catch {
    document.getElementById('journal-list').textContent = 'Journal indisponible.';
  }
}

const PROVIDER_LABELS = {
  google: 'Gemini (image/vidéo — bientôt)',
  anthropic: 'Claude (conversation & code)'
};

function toggleProviderForm(provider, container) {
  const existing = container.querySelector('.provider-key-form');
  if (existing) existing.remove();

  const form = document.createElement('form');
  form.className = 'provider-key-form';
  form.innerHTML = `<input type="password" placeholder="Clé ${PROVIDER_LABELS[provider]}" autocomplete="off"><button type="submit">OK</button>`;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = form.querySelector('input');
    const key = input.value.trim();
    if (!key) return;
    try {
      const status = await window.aura.setApiKey(provider, key);
      renderProviders(status.providers);
      journal(`CLE_API_MISE_A_JOUR : ${provider}`);
    } catch (err) {
      journal(`CLE_API_ECHEC : ${err.message}`);
    }
  });
  container.appendChild(form);
  form.querySelector('input').focus();
}

function renderProviders(providers) {
  const list = document.getElementById('provider-list');
  list.innerHTML = '';
  Object.entries(PROVIDER_LABELS).forEach(([id, label]) => {
    const configured = !!providers[id];
    const row = document.createElement('div');
    row.className = 'provider-row';
    row.innerHTML = `<span class="provider-dot ${configured ? 'ok' : ''}"></span><span class="provider-name">${label}</span><button type="button" class="provider-edit" data-provider="${id}">${configured ? 'changer' : 'ajouter'}</button>`;
    list.appendChild(row);
  });
  list.querySelectorAll('.provider-edit').forEach((btn) => {
    btn.addEventListener('click', () => toggleProviderForm(btn.dataset.provider, list));
  });
}

async function loadProviders() {
  try {
    const status = await window.aura.getStatus();
    renderProviders(status.providers);
  } catch {
    document.getElementById('provider-list').textContent = 'Statut indisponible.';
  }
}

function wirePanels() {
  document.getElementById('toggle-projects').addEventListener('click', () => {
    document.getElementById('panel-projects').classList.toggle('open');
  });
  document.getElementById('toggle-context').addEventListener('click', () => {
    const panel = document.getElementById('panel-context');
    const opening = panel.classList.toggle('open');
    if (opening) {
      loadJournal();
      loadProviders();
    }
  });

}

function journal(action) {
  // Trace minimale des decisions d'AURA (§5.9, §12.3 actions_log) en
  // attendant un vrai orchestrateur/backend a brancher ici.
  console.log(`[journal] ${new Date().toISOString()} ${action}`);
}

function wireEmergencyStop() {
  const btn = document.getElementById('estop');
  const label = document.getElementById('estop-label');
  const banner = document.getElementById('estop-banner');
  const input = document.getElementById('message');
  const send = document.getElementById('send');

  btn.addEventListener('click', () => {
    const stopped = document.body.classList.toggle('estopped');

    banner.hidden = !stopped;
    label.textContent = stopped ? 'REPRENDRE' : 'ARRÊT D’URGENCE';
    input.disabled = stopped;
    send.disabled = stopped;

    if (stopped) {
      document.querySelectorAll('.link.active, .link-relation.active')
        .forEach((el) => el.classList.remove('active'));
    }

    journal(stopped ? 'ARRET_URGENCE_ACTIVE : toile et conversation gelees' : 'ARRET_URGENCE_LEVE : reprise normale');
  });
}

function addMessage(role, text) {
  const thread = document.getElementById('thread');
  const bubble = document.createElement('div');
  bubble.className = `msg msg-${role}`;
  bubble.textContent = text;
  thread.appendChild(bubble);
  thread.scrollTop = thread.scrollHeight;
  return bubble;
}

function addPendingMessage() {
  const thread = document.getElementById('thread');
  const bubble = document.createElement('div');
  bubble.className = 'msg msg-aura msg-pending';
  bubble.innerHTML = 'AURA réfléchit<span class="dots"></span>';
  thread.appendChild(bubble);
  thread.scrollTop = thread.scrollHeight;
  return bubble;
}

function wireConversation() {
  const form = document.getElementById('conversation');
  const input = document.getElementById('message');
  const send = document.getElementById('send');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (document.body.classList.contains('estopped')) return;
    const text = input.value.trim();
    if (!text) return;

    setActive('__hub', true);
    input.value = '';
    input.disabled = true;
    send.disabled = true;

    addMessage('user', text);
    const pending = addPendingMessage();

    try {
      const result = await window.aura.sendMessage(text);
      pending.remove();
      addMessage('aura', result.text);
      journal(`MESSAGE_ECHANGE : "${text.slice(0, 60)}"`);
    } catch (err) {
      pending.remove();
      addMessage('error', `AURA ne peut pas répondre : ${err.message}`);
      journal(`MESSAGE_ECHEC : ${err.message}`);
    } finally {
      setActive('__hub', false);
      input.disabled = false;
      send.disabled = false;
      input.focus();
    }
  });
}

async function initConversation() {
  const setupForm = document.getElementById('setup-key');
  const conversationForm = document.getElementById('conversation');
  const apiKeyInput = document.getElementById('api-key');

  const showConversation = () => {
    setupForm.hidden = true;
    conversationForm.hidden = false;
    document.getElementById('message').focus();
  };
  const showSetup = () => {
    setupForm.hidden = false;
    conversationForm.hidden = true;
    apiKeyInput.focus();
  };

  wireConversation();

  setupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const key = apiKeyInput.value.trim();
    if (!key) return;
    try {
      await window.aura.setApiKey('anthropic', key);
      apiKeyInput.value = '';
      showConversation();
      addMessage('aura', 'Clé API enregistrée. Je t’écoute.');
    } catch (err) {
      addMessage('error', `Impossible d’enregistrer la clé : ${err.message}`);
    }
  });

  try {
    const status = await window.aura.getStatus();
    if (status.configured) {
      showConversation();
    } else {
      showSetup();
    }
  } catch {
    showSetup();
  }
}

// --- Ecrans internes (§16.2 a §16.5) ---------------------------------
// Toutes les vues vivent dans la meme fenetre applicative, jamais une
// page ou fenetre separee (§13.2). showScreen(null) revient a la toile.

function showScreen(name) {
  document.querySelectorAll('.app-screen').forEach((el) => {
    el.hidden = el.id !== `screen-${name}`;
  });
  document.getElementById('panel-projects').classList.remove('open');
  if (name === 'memory') loadMemoryScreen();
  if (name === 'gaming') loadGamingScreen();
  if (name === 'dev') loadDevScreen();
  if (name === 'world') {
    initWorldMap();
    setTimeout(() => worldMap && worldMap.invalidateSize(), 0);
  }
}

function closeScreen() {
  document.querySelectorAll('.app-screen').forEach((el) => { el.hidden = true; });
}

function wireScreens() {
  document.querySelectorAll('.module-link').forEach((btn) => {
    btn.addEventListener('click', () => showScreen(btn.dataset.screen));
  });
  document.querySelectorAll('[data-close-screen]').forEach((btn) => {
    btn.addEventListener('click', closeScreen);
  });
}

function renderMemoryPrefs(prefs) {
  const list = document.getElementById('memory-prefs-list');
  const keys = Object.keys(prefs);
  if (!keys.length) {
    list.textContent = 'Aucune préférence mémorisée.';
    return;
  }
  list.innerHTML = '';
  keys.forEach((key) => {
    const { value, updatedAt } = prefs[key];
    const row = document.createElement('div');
    row.className = 'pref-row';
    row.innerHTML = `
      <div class="pref-key">${key}</div>
      <input class="pref-value" type="text" value="${String(value).replace(/"/g, '&quot;')}">
      <span class="pref-updated">${new Date(updatedAt).toLocaleDateString('fr-FR')}</span>
      <button type="button" class="pref-save" title="Enregistrer">✓</button>
      <button type="button" class="pref-delete" title="Supprimer">✕</button>
    `;
    row.querySelector('.pref-save').addEventListener('click', async () => {
      const newValue = row.querySelector('.pref-value').value;
      await window.aura.setPreference(key, newValue);
      journal(`PREFERENCE_MODIFIEE : ${key}`);
      loadMemoryScreen();
    });
    row.querySelector('.pref-delete').addEventListener('click', async () => {
      await window.aura.deletePreference(key);
      journal(`PREFERENCE_SUPPRIMEE : ${key}`);
      loadMemoryScreen();
    });
    list.appendChild(row);
  });
}

async function loadMemoryScreen() {
  try {
    const prefs = await window.aura.getPreferences();
    renderMemoryPrefs(prefs);
  } catch {
    document.getElementById('memory-prefs-list').textContent = 'Préférences indisponibles.';
  }
}

function wireMemoryScreen() {
  document.getElementById('memory-clear-all').addEventListener('click', async () => {
    if (!confirm('Effacer toutes les préférences mémorisées par AURA ? Cette action est irréversible.')) return;
    try {
      await window.aura.clearMemory();
      journal('MEMOIRE_EFFACEE : préférences remises à zéro');
      loadMemoryScreen();
    } catch (err) {
      journal(`MEMOIRE_EFFACEE_ECHEC : ${err.message}`);
    }
  });
}

// --- AURA WORLD (§9, §16.4) -------------------------------------------
// Carte 2D uniquement (F-18), vue mondiale par defaut (F-19), zoom vers
// un lieu sur demande explicite (F-15) via la geocodification Nominatim
// (service public OpenStreetMap, aucune cle requise). Initialisee au
// premier affichage de l'ecran seulement (pas de chargement de tuiles
// tant que l'utilisateur n'a pas ouvert la carte).
let worldMap = null;

function initWorldMap() {
  if (worldMap) return;

  worldMap = L.map('world-map', {
    center: [20, 0],
    zoom: 2,
    minZoom: 2,
    maxZoom: 18,
    worldCopyJump: true
  });

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19
  }).addTo(worldMap);
}

async function worldSearch(query) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { 'Accept-Language': 'fr' } });
  if (!res.ok) throw new Error(`Service de recherche indisponible (${res.status}).`);
  const results = await res.json();
  if (!results.length) throw new Error('Lieu introuvable.');
  const { lat, lon, display_name } = results[0];
  worldMap.flyTo([parseFloat(lat), parseFloat(lon)], 10, { duration: 1.2 });
  return display_name;
}

function wireWorldMap() {
  document.getElementById('world-search').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('world-search-input');
    const query = input.value.trim();
    if (!query) return;
    try {
      const name = await worldSearch(query);
      journal(`CARTE_ZOOM : ${name}`);
    } catch (err) {
      journal(`CARTE_ZOOM_ECHEC : ${err.message}`);
    }
  });
}

// --- AURA Image Lab (§10, §16.5) --------------------------------------
// Traitement local (Canvas 2D), aucune IA requise pour ces fonctions de
// base : agrandissement (reechantillonnage, pas de super-resolution IA),
// nettete, reduction de bruit, lumiere/couleur. L'original n'est jamais
// ecrase (§10.4) - le fichier source n'est jamais reouvert en ecriture,
// l'export demande toujours un nouvel emplacement.

const IL_MAX_DIM = 1400;
const IL_IDENTITY_KERNEL = [0, 0, 0, 0, 1, 0, 0, 0, 0];
const IL_SHARPEN_KERNEL = [0, -1, 0, -1, 5, -1, 0, -1, 0];
const IL_BLUR_KERNEL = [1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9];

let ilBaseCanvas = null;

function ilClamp(v) { return Math.max(0, Math.min(255, v)); }

function ilLerpKernel(from, to, t) {
  return from.map((v, i) => v + (to[i] - v) * t);
}

function ilConvolve3x3(imageData, kernel) {
  const { width, height, data } = imageData;
  const src = new Uint8ClampedArray(data);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0, k = 0;
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const sx = Math.min(width - 1, Math.max(0, x + kx));
          const sy = Math.min(height - 1, Math.max(0, y + ky));
          const idx = (sy * width + sx) * 4;
          const kv = kernel[k++];
          r += src[idx] * kv; g += src[idx + 1] * kv; b += src[idx + 2] * kv;
        }
      }
      const idx = (y * width + x) * 4;
      data[idx] = ilClamp(r); data[idx + 1] = ilClamp(g); data[idx + 2] = ilClamp(b);
    }
  }
  return imageData;
}

function ilAdjustColor(imageData, brightness, contrast, saturation) {
  const data = imageData.data;
  const cf = (259 * (contrast + 255)) / (255 * (259 - contrast));
  const sf = 1 + saturation / 100;
  for (let i = 0; i < data.length; i += 4) {
    let r = data[i] + brightness, g = data[i + 1] + brightness, b = data[i + 2] + brightness;
    r = cf * (r - 128) + 128; g = cf * (g - 128) + 128; b = cf * (b - 128) + 128;
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
    r = gray + (r - gray) * sf; g = gray + (g - gray) * sf; b = gray + (b - gray) * sf;
    data[i] = ilClamp(r); data[i + 1] = ilClamp(g); data[i + 2] = ilClamp(b);
  }
  return imageData;
}

function ilGetControls() {
  return {
    scale: Number(document.getElementById('ctl-scale').value),
    sharpen: Number(document.getElementById('ctl-sharpen').value),
    denoise: Number(document.getElementById('ctl-denoise').value),
    brightness: Number(document.getElementById('ctl-brightness').value),
    contrast: Number(document.getElementById('ctl-contrast').value),
    saturation: Number(document.getElementById('ctl-saturation').value)
  };
}

function ilSyncLabels() {
  const ctl = ilGetControls();
  document.getElementById('val-scale').textContent = `${ctl.scale} %`;
  document.getElementById('val-sharpen').textContent = ctl.sharpen;
  document.getElementById('val-denoise').textContent = ctl.denoise;
  document.getElementById('val-brightness').textContent = ctl.brightness;
  document.getElementById('val-contrast').textContent = ctl.contrast;
  document.getElementById('val-saturation').textContent = ctl.saturation;
}

function ilSetImage(img) {
  let w = img.naturalWidth, h = img.naturalHeight;
  const scale = Math.min(1, IL_MAX_DIM / Math.max(w, h));
  w = Math.round(w * scale); h = Math.round(h * scale);

  ilBaseCanvas = document.createElement('canvas');
  ilBaseCanvas.width = w;
  ilBaseCanvas.height = h;
  ilBaseCanvas.getContext('2d').drawImage(img, 0, 0, w, h);

  const original = document.getElementById('imagelab-canvas-original');
  original.width = w;
  original.height = h;
  original.getContext('2d').drawImage(ilBaseCanvas, 0, 0);

  document.getElementById('imagelab-empty').hidden = true;
  document.getElementById('imagelab-workspace').hidden = false;
  document.getElementById('imagelab-status').textContent = '';

  ['ctl-scale', 'ctl-sharpen', 'ctl-denoise', 'ctl-brightness', 'ctl-contrast', 'ctl-saturation']
    .forEach((id) => { document.getElementById(id).value = id === 'ctl-scale' ? 100 : 0; });
  ilSyncLabels();
  ilApply('vision.enhance_image', { reason: 'chargement initial' });
}

function ilApply(actionType, extraDetails) {
  if (!ilBaseCanvas) return;
  const status = document.getElementById('imagelab-status');
  status.textContent = 'Traitement en cours…';

  // setTimeout plutot que requestAnimationFrame : rAF peut etre fortement
  // retarde/suspendu quand la fenetre n'a pas le focus ou est masquee
  // (throttling par occlusion de Chromium), ce qui laisserait le
  // traitement bloque indefiniment si l'utilisateur change de fenetre.
  setTimeout(() => {
    const ctl = ilGetControls();
    const resultCanvas = document.getElementById('imagelab-canvas-result');
    const outW = Math.round(ilBaseCanvas.width * ctl.scale / 100);
    const outH = Math.round(ilBaseCanvas.height * ctl.scale / 100);
    resultCanvas.width = outW;
    resultCanvas.height = outH;

    const rctx = resultCanvas.getContext('2d', { willReadFrequently: true });
    rctx.imageSmoothingEnabled = true;
    rctx.imageSmoothingQuality = 'high';
    rctx.drawImage(ilBaseCanvas, 0, 0, outW, outH);

    let imageData = rctx.getImageData(0, 0, outW, outH);
    if (ctl.denoise > 0) {
      imageData = ilConvolve3x3(imageData, ilLerpKernel(IL_IDENTITY_KERNEL, IL_BLUR_KERNEL, ctl.denoise / 100));
    }
    if (ctl.sharpen > 0) {
      imageData = ilConvolve3x3(imageData, ilLerpKernel(IL_IDENTITY_KERNEL, IL_SHARPEN_KERNEL, ctl.sharpen / 100));
    }
    if (ctl.brightness || ctl.contrast || ctl.saturation) {
      imageData = ilAdjustColor(imageData, ctl.brightness, ctl.contrast, ctl.saturation);
    }
    rctx.putImageData(imageData, 0, 0);

    status.textContent = `Terminé (${outW}×${outH}px).`;

    if (actionType) {
      window.aura.logAction({
        typeAction: actionType,
        sensibilite: 'reversible',
        statut: 'execute',
        details: { ...ctl, ...extraDetails }
      }).catch(() => {});
    }
  }, 0);
}

function ilReset() {
  ['ctl-scale', 'ctl-sharpen', 'ctl-denoise', 'ctl-brightness', 'ctl-contrast', 'ctl-saturation']
    .forEach((id) => { document.getElementById(id).value = id === 'ctl-scale' ? 100 : 0; });
  ilSyncLabels();
  ilApply(null);
  document.getElementById('imagelab-status').textContent = 'Réinitialisé à l’original.';
}

function ilAutoPreset() {
  document.getElementById('ctl-sharpen').value = 25;
  document.getElementById('ctl-denoise').value = 15;
  document.getElementById('ctl-contrast').value = 8;
  ilSyncLabels();
  ilApply('vision.enhance_image', { mode: 'automatique (preset fixe)' });
}

async function ilExport() {
  const resultCanvas = document.getElementById('imagelab-canvas-result');
  const dataUrl = resultCanvas.toDataURL('image/png');
  const status = document.getElementById('imagelab-status');
  try {
    const { saved, filePath } = await window.aura.saveImage(dataUrl);
    status.textContent = saved ? `Exporté vers ${filePath}` : 'Export annulé.';
    if (saved) {
      window.aura.logAction({
        typeAction: 'vision.export_image',
        sensibilite: 'reversible',
        statut: 'execute',
        details: { filePath }
      }).catch(() => {});
    }
  } catch (err) {
    status.textContent = `Échec de l’export : ${err.message}`;
  }
}

function wireImageLab() {
  document.getElementById('imagelab-file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => ilSetImage(img);
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });

  document.getElementById('imagelab-slider').addEventListener('input', (e) => {
    const pct = e.target.value;
    document.getElementById('imagelab-canvas-result').style.clipPath = `inset(0 ${100 - pct}% 0 0)`;
    document.getElementById('imagelab-divider').style.left = `${pct}%`;
  });

  ['ctl-scale', 'ctl-sharpen', 'ctl-denoise', 'ctl-brightness', 'ctl-contrast', 'ctl-saturation']
    .forEach((id) => document.getElementById(id).addEventListener('input', ilSyncLabels));

  document.getElementById('imagelab-preview').addEventListener('click', () => {
    const ctl = ilGetControls();
    const actions = [];
    if (ctl.sharpen > 0) actions.push('vision.sharpen_image');
    if (ctl.denoise > 0) actions.push('vision.denoise_image');
    if (ctl.scale !== 100) actions.push('vision.upscale_image');
    ilApply(actions[0] || 'vision.enhance_image');
  });
  document.getElementById('imagelab-auto').addEventListener('click', ilAutoPreset);
  document.getElementById('imagelab-reset').addEventListener('click', ilReset);
  document.getElementById('imagelab-export').addEventListener('click', ilExport);
  document.getElementById('imagelab-new').addEventListener('click', () => {
    ilBaseCanvas = null;
    document.getElementById('imagelab-file').value = '';
    document.getElementById('imagelab-workspace').hidden = true;
    document.getElementById('imagelab-empty').hidden = false;
  });
}

// --- Gaming & Streaming (§8, §16.3) -----------------------------------
// Connecteur gaming strictement en lecture (§18.2). OBS reste de la
// supervision de diffusion, jamais une automatisation du jeu.

const CONNFIELD_LABELS = {
  riotApiKey: 'Clé API Riot',
  steamApiKey: 'Clé API Steam',
  steamId: 'SteamID64',
  obsHost: 'Hôte OBS (ex. 127.0.0.1)',
  obsPort: 'Port OBS (ex. 4455)',
  obsPassword: 'Mot de passe OBS'
};

function renderGamingStatus(status) {
  document.getElementById('dot-riot').classList.toggle('ok', status.riot);
  document.getElementById('label-riot').textContent = status.riot ? 'Clé configurée' : 'Non configuré';
  document.getElementById('dot-steam').classList.toggle('ok', status.steam);
  document.getElementById('label-steam').textContent = status.steam ? 'Configuré' : 'Non configuré';
  document.getElementById('dot-obs').classList.toggle('ok', status.obs.connected);
  document.getElementById('label-obs').textContent = status.obs.connected
    ? 'Connecté'
    : (status.obs.configured ? 'Configuré (non connecté)' : 'Non configuré');
  document.getElementById('obs-connect').hidden = status.obs.connected;
  document.getElementById('obs-disconnect').hidden = !status.obs.connected;
  document.getElementById('obs-controls').hidden = !status.obs.connected;
}

async function loadGamingScreen() {
  try {
    const status = await window.aura.getGamingStatus();
    renderGamingStatus(status);
    if (status.obs.connected) loadObsScenes();
  } catch {
    // API locale indisponible : les indicateurs restent sur leur etat par defaut
  }
}

function renderMatches(matches) {
  const el = document.getElementById('riot-results');
  if (!matches.length) { el.textContent = 'Aucune partie récente.'; return; }
  el.innerHTML = '';
  matches.forEach((m) => {
    const row = document.createElement('div');
    row.className = `match-row ${m.win ? 'win' : 'loss'}`;
    const mins = Math.round(m.gameDurationSec / 60);
    row.innerHTML = `<span>${m.champion} — ${m.win ? 'Victoire' : 'Défaite'}</span><span>${m.kills}/${m.deaths}/${m.assists} · ${mins} min</span>`;
    el.appendChild(row);
  });
}

function renderGames(games) {
  const el = document.getElementById('steam-results');
  if (!games.length) { el.textContent = 'Aucun jeu trouvé.'; return; }
  el.innerHTML = '';
  games.forEach((g) => {
    const row = document.createElement('div');
    row.className = 'game-row';
    row.innerHTML = `<span>${g.name}</span><span>${g.playtimeHours} h</span>`;
    el.appendChild(row);
  });
}

async function loadObsScenes() {
  try {
    const { current, scenes } = await window.aura.obsScenes();
    const el = document.getElementById('obs-scenes');
    el.innerHTML = '';
    scenes.forEach((name) => {
      const row = document.createElement('div');
      row.className = `scene-row ${name === current ? 'current' : ''}`;
      row.textContent = name;
      row.addEventListener('click', async () => {
        try {
          await window.aura.obsSwitchScene(name);
          journal(`OBS_SCENE : ${name}`);
          loadObsScenes();
        } catch (err) {
          journal(`OBS_SCENE_ECHEC : ${err.message}`);
        }
      });
      el.appendChild(row);
    });
  } catch (err) {
    document.getElementById('obs-status').textContent = err.message;
  }
}

function wireGamingScreen() {
  document.querySelectorAll('[data-connfield]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const key = btn.dataset.connfield;
      const value = prompt(CONNFIELD_LABELS[key] || key);
      if (value === null) return;
      try {
        const status = await window.aura.setGamingConfig(key, value);
        renderGamingStatus(status);
        journal(`CONNECTEUR_CONFIG : ${key}`);
      } catch (err) {
        journal(`CONNECTEUR_CONFIG_ECHEC : ${err.message}`);
      }
    });
  });

  document.getElementById('riot-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const gameName = document.getElementById('riot-name').value.trim();
    const tagLine = document.getElementById('riot-tag').value.trim();
    const region = document.getElementById('riot-region').value;
    if (!gameName || !tagLine) return;
    const el = document.getElementById('riot-results');
    el.textContent = 'Chargement…';
    try {
      renderMatches(await window.aura.fetchRiotMatches(gameName, tagLine, region));
    } catch (err) {
      el.textContent = err.message;
    }
  });

  document.getElementById('steam-load').addEventListener('click', async () => {
    const el = document.getElementById('steam-results');
    el.textContent = 'Chargement…';
    try {
      renderGames(await window.aura.fetchSteamGames());
    } catch (err) {
      el.textContent = err.message;
    }
  });

  document.getElementById('obs-connect').addEventListener('click', async () => {
    const status = document.getElementById('obs-status');
    status.textContent = 'Connexion…';
    try {
      await window.aura.obsConnect();
      status.textContent = 'Connecté.';
      loadGamingScreen();
    } catch (err) {
      status.textContent = err.message;
    }
  });

  document.getElementById('obs-disconnect').addEventListener('click', async () => {
    await window.aura.obsDisconnect();
    loadGamingScreen();
  });

  document.getElementById('obs-overlay-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const sourceName = document.getElementById('obs-source-name').value.trim();
    const text = document.getElementById('obs-overlay-text').value;
    if (!sourceName) return;
    try {
      await window.aura.obsUpdateOverlay(sourceName, text);
      journal(`OBS_OVERLAY : ${sourceName}`);
    } catch (err) {
      document.getElementById('obs-status').textContent = err.message;
    }
  });

  document.getElementById('obs-start-stream').addEventListener('click', async () => {
    if (!confirm('Démarrer la diffusion en direct maintenant ?')) return;
    try {
      await window.aura.obsStartStream();
      journal('OBS_STREAM_DEMARRE');
    } catch (err) {
      document.getElementById('obs-status').textContent = err.message;
    }
  });
}

// --- Connecteur Productivite (§7) -------------------------------------
// task.create / task.complete / reminder.schedule. Les rappels ne sont
// verifies que pendant qu'une session AURA est ouverte (F-22, §5.9) -
// aucune surveillance hors session.

function renderTasks(tasks) {
  const list = document.getElementById('tasks-list');
  const active = tasks.filter((t) => t.status !== 'completed');
  const completed = tasks.filter((t) => t.status === 'completed');
  const ordered = [...active, ...completed];
  if (!ordered.length) { list.textContent = 'Aucune tâche.'; return; }
  list.innerHTML = '';
  ordered.forEach((task) => {
    const row = document.createElement('div');
    row.className = `task-row ${task.status === 'completed' ? 'completed' : ''}`;
    row.innerHTML = `
      <input type="checkbox" ${task.status === 'completed' ? 'checked disabled' : ''}>
      <span class="task-priority-dot ${task.priority}"></span>
      <span class="task-title">${task.title}</span>
      ${task.dueDate ? `<span class="task-due">${task.dueDate}</span>` : ''}
      <button type="button" class="row-delete" title="Supprimer">✕</button>
    `;
    if (task.status !== 'completed') {
      row.querySelector('input[type="checkbox"]').addEventListener('change', async () => {
        try {
          await window.aura.completeTask(task.id);
          journal(`TACHE_TERMINEE : ${task.title}`);
          loadTasks();
        } catch (err) {
          journal(`TACHE_ECHEC : ${err.message}`);
        }
      });
    }
    row.querySelector('.row-delete').addEventListener('click', async () => {
      await window.aura.deleteTask(task.id);
      loadTasks();
    });
    list.appendChild(row);
  });
}

async function loadTasks() {
  try {
    renderTasks(await window.aura.getTasks());
  } catch {
    document.getElementById('tasks-list').textContent = 'Tâches indisponibles.';
  }
}

function renderReminders(reminders) {
  const list = document.getElementById('reminders-list');
  const active = reminders.filter((r) => r.active);
  if (!active.length) { list.textContent = 'Aucun rappel.'; return; }
  list.innerHTML = '';
  active
    .sort((a, b) => new Date(a.at) - new Date(b.at))
    .forEach((reminder) => {
      const row = document.createElement('div');
      row.className = 'reminder-row';
      const when = new Date(reminder.at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
      const recur = reminder.recurring === 'daily' ? ' ↻ jour' : reminder.recurring === 'weekly' ? ' ↻ semaine' : '';
      row.innerHTML = `
        <span class="task-title">${reminder.text}</span>
        <span class="task-due">${when}${recur}</span>
        <button type="button" class="row-delete" title="Supprimer">✕</button>
      `;
      row.querySelector('.row-delete').addEventListener('click', async () => {
        await window.aura.deleteReminder(reminder.id);
        loadReminders();
      });
      list.appendChild(row);
    });
}

async function loadReminders() {
  try {
    renderReminders(await window.aura.getReminders());
  } catch {
    document.getElementById('reminders-list').textContent = 'Rappels indisponibles.';
  }
}

async function checkDueReminders() {
  try {
    const fired = await window.aura.checkDueReminders();
    fired.forEach((reminder) => {
      if (!reminder) return;
      try { new Notification('AURA — Rappel', { body: reminder.text }); } catch { /* notifications indisponibles */ }
      journal(`RAPPEL_DECLENCHE : ${reminder.text}`);
    });
    if (fired.length) loadReminders();
  } catch {
    // API locale indisponible - reessaiera au prochain intervalle
  }
}

function wireProductivity() {
  document.getElementById('task-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = document.getElementById('task-title').value.trim();
    if (!title) return;
    const dueDate = document.getElementById('task-due').value || null;
    const priority = document.getElementById('task-priority').value;
    try {
      await window.aura.createTask({ title, dueDate, priority });
      document.getElementById('task-title').value = '';
      document.getElementById('task-due').value = '';
      journal(`TACHE_CREEE : ${title}`);
      loadTasks();
    } catch (err) {
      journal(`TACHE_CREATION_ECHEC : ${err.message}`);
    }
  });

  document.getElementById('reminder-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = document.getElementById('reminder-text').value.trim();
    const at = document.getElementById('reminder-at').value;
    const recurring = document.getElementById('reminder-recurring').value || null;
    if (!text || !at) return;
    try {
      await window.aura.createReminder({ text, at: new Date(at).toISOString(), recurring });
      document.getElementById('reminder-text').value = '';
      document.getElementById('reminder-at').value = '';
      journal(`RAPPEL_PROGRAMME : ${text}`);
      loadReminders();
    } catch (err) {
      journal(`RAPPEL_CREATION_ECHEC : ${err.message}`);
    }
  });
}

// --- AURA CODE (§6) ---------------------------------------------------
// git.push est "Irreversible" (§14.1) : confirmation explicite avant
// l'appel. Le connecteur gaming reste en lecture (§18.2) ; ici, commit
// et push agissent reellement sur le depot configure - à utiliser avec
// discernement.

const DEVFIELD_LABELS = {
  devRepoPath: 'Chemin du dépôt Git (dossier local)',
  devUnityEditorPath: 'Chemin complet vers Unity.exe',
  devUnityProjectPath: 'Chemin du projet Unity'
};

function renderDevStatus(config) {
  document.getElementById('dot-dev-repo').classList.toggle('ok', !!config.repoPath);
  document.getElementById('label-dev-repo').textContent = config.repoPath || 'Dépôt non configuré';
  const unityOk = !!(config.unityEditorPath && config.unityProjectPath);
  document.getElementById('dot-dev-unity').classList.toggle('ok', unityOk);
  document.getElementById('label-dev-unity').textContent = unityOk
    ? 'Éditeur et projet configurés'
    : 'Non configuré';
}

async function loadDevScreen() {
  try {
    renderDevStatus(await window.aura.getDevConfig());
  } catch {
    // API locale indisponible
  }
}

function renderGitStatus(result) {
  const el = document.getElementById('git-status-result');
  if (!result.files.length) {
    el.innerHTML = `<div>Branche <strong>${result.branch}</strong> — aucun changement.</div>`;
    return;
  }
  el.innerHTML = `<div>Branche <strong>${result.branch}</strong> — ${result.files.length} changement(s) :</div>`;
  result.files.forEach((f) => {
    const row = document.createElement('div');
    row.className = 'file-status-row';
    row.innerHTML = `<span class="file-status-code">${f.status}</span><span class="file-status-path">${f.path}</span>`;
    el.appendChild(row);
  });
}

function wireDevScreen() {
  document.querySelectorAll('[data-devfield]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const key = btn.dataset.devfield;
      const value = prompt(DEVFIELD_LABELS[key] || key);
      if (value === null) return;
      try {
        renderDevStatus(await window.aura.setDevConfig(key, value));
        journal(`DEV_CONFIG : ${key}`);
      } catch (err) {
        journal(`DEV_CONFIG_ECHEC : ${err.message}`);
      }
    });
  });

  document.getElementById('git-status-btn').addEventListener('click', async () => {
    const el = document.getElementById('git-status-result');
    el.textContent = 'Vérification…';
    try {
      renderGitStatus(await window.aura.gitStatus());
    } catch (err) {
      el.textContent = err.message;
    }
  });

  document.getElementById('git-commit-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const message = document.getElementById('git-commit-message').value.trim();
    if (!message) return;
    const status = document.getElementById('git-status-message');
    try {
      const result = await window.aura.gitCommit(message);
      status.textContent = `Commit créé : ${result.hash.slice(0, 8)}`;
      document.getElementById('git-commit-message').value = '';
      journal(`GIT_COMMIT : ${result.hash.slice(0, 8)}`);
      document.getElementById('git-status-btn').click();
    } catch (err) {
      status.textContent = err.message;
    }
  });

  document.getElementById('git-push-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const remote = document.getElementById('git-push-remote').value.trim() || 'origin';
    const branch = document.getElementById('git-push-branch').value.trim() || null;
    if (!confirm(`Publier les commits locaux sur "${remote}"${branch ? ` (${branch})` : ''} ? Action irréversible.`)) return;
    const status = document.getElementById('git-status-message');
    status.textContent = 'Push en cours…';
    try {
      const result = await window.aura.gitPush(remote, branch);
      status.textContent = result.output || 'Push terminé.';
      journal(`GIT_PUSH : ${remote}`);
    } catch (err) {
      status.textContent = err.message;
      journal(`GIT_PUSH_ECHEC : ${err.message}`);
    }
  });

  document.getElementById('unity-build-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const buildTarget = document.getElementById('unity-build-target').value;
    const outputPath = document.getElementById('unity-output-path').value.trim() || null;
    const status = document.getElementById('unity-status');
    status.textContent = 'Build en cours (cela peut prendre plusieurs minutes)…';
    try {
      const result = await window.aura.unityBuild({ buildTarget, outputPath });
      status.textContent = `Build terminé (code ${result.exitCode}).`;
      journal('UNITY_BUILD');
    } catch (err) {
      status.textContent = err.message;
      journal(`UNITY_BUILD_ECHEC : ${err.message}`);
    }
  });
}

render();
startClock();
wirePanels();
wireScreens();
wireMemoryScreen();
wireWorldMap();
wireImageLab();
wireGamingScreen();
wireProductivity();
wireDevScreen();
wireEmergencyStop();
initConversation();
loadTasks();
loadReminders();
setInterval(pulseRandomActivity, 2600);
setInterval(checkDueReminders, 30000);
