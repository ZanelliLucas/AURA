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

function wirePanels() {
  document.getElementById('toggle-projects').addEventListener('click', () => {
    document.getElementById('panel-projects').classList.toggle('open');
  });
  document.getElementById('toggle-context').addEventListener('click', () => {
    document.getElementById('panel-context').classList.toggle('open');
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
      await window.aura.setApiKey(key);
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

render();
startClock();
wirePanels();
wireEmergencyStop();
initConversation();
setInterval(pulseRandomActivity, 2600);
