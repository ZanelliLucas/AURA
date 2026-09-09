const SVG_NS = 'http://www.w3.org/2000/svg';
const GRAPH_NODES = window.AURA_GRAPH.NODES;

const CENTER = { x: 800, y: 500 };
const R_PRINCIPAL = 300;
const VIEW_W = 1600;
const VIEW_H = 1000;

function el(tag, attrs) {
  const node = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs || {}).forEach(([k, v]) => node.setAttribute(k, v));
  return node;
}

// Placeholder : la precedente toile (tendons organiques, maillage,
// poussiere, flux...) a ete retiree pour repartir de zero sur une
// nouvelle direction visuelle. Ne reste que le hub et les agents en
// cercle simple, sans aucune ligne.
function layout() {
  const positioned = {};
  const step = (Math.PI * 2) / GRAPH_NODES.length;

  GRAPH_NODES.forEach((node, i) => {
    const angle = i * step;
    const x = CENTER.x + Math.cos(angle) * R_PRINCIPAL;
    const y = CENTER.y + Math.sin(angle) * R_PRINCIPAL;
    positioned[node.id] = { ...node, x, y, angle };
  });

  return positioned;
}

function render() {
  const svg = document.getElementById('web');
  svg.innerHTML = '';
  const positioned = layout();
  const nodeList = Object.values(positioned);

  nodeList.forEach((p) => {
    const group = el('g', { class: 'node-group', 'data-node': p.id });

    group.addEventListener('mouseenter', () => setActive(p.id, true));
    group.addEventListener('mouseleave', () => setActive(p.id, false));

    svg.appendChild(group);
  });

  // Hub central
  const hub = el('g', { class: 'node-group', 'data-node': '__hub' });
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

// Zone de rendu du panneau Activité (§12.3) : traduit chaque entree du
// journal backend (succes/echec, deja journalisees cote serveur par
// core.js/productivity.js/autonomy.js) en un message lisible plutot que
// d'exposer typeAction/statut bruts.
const STATUT_LABELS = { execute: 'Succès', echoue: 'Échec' };

const TYPE_LABELS = {
  'task.create': 'Tâche créée',
  'task.complete': 'Tâche terminée',
  'reminder.schedule': 'Rappel programmé',
  'reminder.fired': 'Rappel déclenché',
  'core.send_message': 'Message envoyé',
  'config.api_key': 'Clé API',
  'autonomy.estop': 'Arrêt d’urgence',
  'autonomy.rule_fired': 'Règle AUTONOMY',
  'autonomy.simulation': 'Règle AUTONOMY (simulation)'
};

function formatJournalMessage(entry) {
  const label = TYPE_LABELS[entry.typeAction] || entry.typeAction;
  const d = entry.details || {};
  if (entry.statut === 'echoue') return `${label} — ${d.error || 'échec'}`;
  if (entry.typeAction === 'task.create' || entry.typeAction === 'task.complete') return `${label} : ${d.title || ''}`;
  if (entry.typeAction === 'reminder.schedule' || entry.typeAction === 'reminder.fired') return `${label} : ${d.text || ''}`;
  if (entry.typeAction === 'config.api_key') return `${label} : ${d.provider || ''}`;
  return label;
}

// Filtre d'affichage du flux (§12.3) : "tous" | "execute" | "echoue".
// Purement cote client - ne refait pas d'appel reseau, filtre la
// derniere page recuperee.
let journalEntriesCache = [];
let journalFilter = 'tous';

const JOURNAL_EMPTY_LABELS = {
  tous: 'Aucune action enregistrée pour l’instant.',
  execute: 'Aucun succès enregistré pour l’instant.',
  echoue: 'Aucune erreur enregistrée pour l’instant.'
};

function renderJournal(entries) {
  journalEntriesCache = entries;
  renderJournalFiltered();
}

function renderJournalFiltered() {
  const list = document.getElementById('journal-list');
  const entries = journalFilter === 'tous'
    ? journalEntriesCache
    : journalEntriesCache.filter((entry) => entry.statut === journalFilter);

  if (!entries.length) {
    list.textContent = JOURNAL_EMPTY_LABELS[journalFilter];
    return;
  }
  list.innerHTML = '';
  entries.forEach((entry) => {
    const div = document.createElement('div');
    div.className = `journal-entry ${entry.statut}`;
    const time = new Date(entry.date).toLocaleTimeString('fr-FR');
    const label = STATUT_LABELS[entry.statut] || entry.statut;
    div.innerHTML = `<div class="journal-time">${time} · ${label}</div>${formatJournalMessage(entry)}`;
    list.appendChild(div);
  });
}

function setJournalFilter(filter) {
  journalFilter = filter;
  document.querySelectorAll('#journal-filters .filter-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.filter === filter);
  });
  renderJournalFiltered();
}

function wireJournalFilters() {
  document.querySelectorAll('#journal-filters .filter-btn').forEach((btn) => {
    btn.addEventListener('click', () => setJournalFilter(btn.dataset.filter));
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

// Rafraichit la zone de rendu si le panneau Activité est deja ouvert -
// reste purement passif (n'ouvre jamais le panneau lui-meme) sinon.
function refreshJournalIfOpen() {
  if (document.getElementById('panel-context').classList.contains('open')) loadJournal();
}

// Point d'alerte sur l'onglet Activité : signale une erreur non vue sans
// jamais ouvrir le panneau lui-meme (reste purement passif). "Vu" est
// horodate dans localStorage pour survivre a un redemarrage d'AURA.
const LAST_SEEN_ERROR_KEY = 'aura_context_last_seen_error';

function getLastSeenErrorAt() {
  try { return localStorage.getItem(LAST_SEEN_ERROR_KEY) || ''; } catch { return ''; }
}

function markErrorsSeen() {
  try { localStorage.setItem(LAST_SEEN_ERROR_KEY, new Date().toISOString()); } catch { /* stockage indisponible */ }
  document.getElementById('context-alert-dot').hidden = true;
}

async function checkContextAlert() {
  try {
    const entries = await window.aura.getJournal();
    const lastSeen = getLastSeenErrorAt();
    const hasUnseenError = entries.some((entry) => entry.statut === 'echoue' && entry.date > lastSeen);
    document.getElementById('context-alert-dot').hidden = !hasUnseenError;
  } catch { /* API indisponible, on laisse le point tel quel */ }
}

// A appeler apres toute commande pouvant reussir/echouer : rafraichit le
// Journal s'il est visible et met a jour le point d'alerte sinon.
function afterJournalAction() {
  refreshJournalIfOpen();
  checkContextAlert();
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
      markErrorsSeen();
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

  btn.addEventListener('click', async () => {
    const stopped = document.body.classList.toggle('estopped');

    banner.hidden = !stopped;
    label.textContent = stopped ? 'REPRENDRE' : 'ARRÊT D’URGENCE';
    btn.title = stopped ? 'Reprendre' : 'Arrêt d’urgence global';
    input.disabled = stopped;
    send.disabled = stopped;

    if (stopped) {
      document.querySelectorAll('.link.active, .link-relation.active')
        .forEach((el) => el.classList.remove('active'));
      stopSpeaking();
    }

    journal(stopped ? 'ARRET_URGENCE_ACTIVE : toile et conversation gelees' : 'ARRET_URGENCE_LEVE : reprise normale');

    // Meme bouton, meme etat : suspend aussi les regles AURA AUTONOMY
    // cote backend (§5.9) - une seule source de verite pour "arrete".
    try {
      await window.aura.setEstop(stopped);
    } catch { /* backend indisponible, l'UI reste geree localement */ }
    afterJournalAction();
  });
}

// Interrompt une synthese vocale en cours, notamment au declenchement
// de l'arret d'urgence.
function stopSpeaking() {
  if (window.speechSynthesis && window.speechSynthesis.speaking) {
    window.speechSynthesis.cancel();
  }
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
      afterJournalAction();
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
        afterJournalAction();
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
    if (fired.length) { loadReminders(); afterJournalAction(); }
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
    afterJournalAction();
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
    afterJournalAction();
  });
}

render();
startClock();
wirePanels();
wireJournalFilters();
wireProductivity();
wireEmergencyStop();
initConversation();
loadTasks();
loadReminders();
checkContextAlert();
setInterval(pulseRandomActivity, 2600);
setInterval(checkDueReminders, 30000);
setInterval(checkContextAlert, 30000);
