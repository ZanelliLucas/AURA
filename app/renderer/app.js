const GRAPH_NODES = window.AURA_GRAPH.NODES;
// Un Soma par categorie reelle d'AURA (data.js) plutot qu'un compte
// decoratif arbitraire - condition necessaire pour que la bulle de
// conversation puisse cibler un Soma precis par son nom.
const SOMA_COUNT = GRAPH_NODES.length;
const ROTATION_IDLE_GLOBE = 0.026;

// Globe stellaire (§13.3, F-21) : le noyau represente AURA elle-meme, les
// Somas ses domaines fonctionnels. Rendu par la classe GlobeStellaire
// (renderer/globe-stellaire.js, chargee avant ce fichier), un composant
// Three.js autonome fourni tel quel - ce fichier se contente de
// l'instancier avec l'identite visuelle d'AURA et de lui relayer
// l'activite generale (pulsation aleatoire, survol, arret d'urgence).
let globe = null;

function initGlobe() {
  globe = new window.GlobeStellaire(document.getElementById('web'), {
    fondTransparent: true,
    etoiles: 0,
    somas: SOMA_COUNT,
    rotation: ROTATION_IDLE_GLOBE,
    // Densite plus haute : la "peau" et la brume qui ferment la surface
    // du globe (et les amas de particules de chaque Soma) sont plus
    // fournies, pour que la silhouette se lise comme une sphere pleine
    // plutot qu'une etoile de branches rayonnant depuis le centre.
    densite: 1.7,
    // Axones amincis : ce sont les branches les plus epaisses de tout le
    // reseau (gaine/corps) - en reduire la largeur laisse la silhouette
    // de la coque (peau/brume/Somas) porter la forme du globe.
    epaisseur: { axoneGaine: 12, axone: 6 },
    // Plus de flux de donnees : decharges spontanees plus frequentes,
    // plus de paquets par emission, cascades qui portent un peu plus
    // loin (relais reste sous 1/relaisMax pour ne pas saturer le globe).
    reseau: { somaSeuil: [1.2, 3.0], rafale: 3, relais: 0.32 },
    // Boules de flux plus petites (defaut halo:9.5, coeur:3.4) : trop
    // grandes, leur lumiere additive s'accumule sur trop de pixels et le
    // tonemapping ACES les fait virer vers un rouge plus clair/orange -
    // reduites, elles restent plus fidèles au rouge normal de l'app.
    boule: { halo: 5, coeur: 2 },
    couleurs: {
      fond: '#050505',
      reseau: '#F5F6F7',
      flux: '#E5261A',
      fluxSoma: '#E5261A',
      etoiles: '#F5F6F7'
    }
  });

  // Le clic droit deplace le globe (voir _initInteraction dans
  // globe-stellaire.js) - sans ce blocage, le menu contextuel natif
  // interromprait le geste des le pointerdown.
  globe.renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
}

function setActive(nodeId, active) {
  if (!globe || !active) return;
  if (nodeId === '__hub') { globe.pulse(); return; }
  const index = GRAPH_NODES.findIndex((n) => n.id === nodeId);
  globe.pulseSoma(index === -1 ? null : index);
}

function pulseRandomActivity() {
  const candidates = GRAPH_NODES.map((n) => n.id);
  const id = candidates[Math.floor(Math.random() * candidates.length)];
  setActive(id, true);
  setTimeout(() => setActive(id, false), 900);
}

// Battement du noyau (§13.3) : AURA elle-meme emet regulierement un flux
// vers tous ses Somas, pas seulement en reponse a leurs propres decharges -
// c'est ce battement de coeur qui donne au globe l'air d'un organisme
// vivant plutot que d'un simple reseau qui reagit au hasard.
function pulseNoyau() {
  setActive('__hub', true);
}

// --- Acces rapide aux categories (bulle de conversation) ---------------
// Le texte tape est compare aux categories reelles d'AURA (data.js) ;
// une correspondance declenche un zoom vers le Soma concerne. Pas de
// langage naturel ni de Terminal complet ici - juste une reconnaissance
// de nom, en attendant qu'AXIS (§6 du cahier des charges) existe pour de
// vrai.
const MOTS_VIDES_ACCES = ['access', 'acceder', 'accede', 'va', 'aller', 'ouvrir', 'ouvre', 'sur', 'a', 'le', 'la', 'les', 'aura'];

function normaliserTexte(texte) {
  // Decompose les caracteres accentues (NFD) puis retire les marques
  // diacritiques combinantes (plage Unicode 0x0300-0x036F) par comparaison
  // de code point plutot qu'une plage \u dans une regex, pour eviter toute
  // ambiguite d'echappement.
  const sansAccents = (texte || '').normalize('NFD').split('')
    .filter((c) => { const code = c.codePointAt(0); return code < 0x0300 || code > 0x036f; })
    .join('');
  return sansAccents.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function trouverIndexCategorie(texte) {
  const mots = normaliserTexte(texte).split(' ').filter((m) => m && !MOTS_VIDES_ACCES.includes(m));
  const q = mots.join(' ');
  if (!q) return -1;

  const libelles = GRAPH_NODES.map((n) => normaliserTexte(n.label.replace(/^AURA\s+/i, '')));
  let index = libelles.findIndex((label) => label === q);
  if (index !== -1) return index;

  index = GRAPH_NODES.findIndex((n) => n.id.toLowerCase() === q.replace(/ /g, ''));
  if (index !== -1) return index;

  return libelles.findIndex((label) => label.includes(q) || q.includes(label));
}

// Plonge la camera A L'INTERIEUR d'un Soma donne (index dans GRAPH_NODES) -
// pas une simple approche : la cible de zoom passe sous le rayon du Soma
// lui-meme, la camera le traverse. GlobeStellaire n'a pas de "flyTo"
// integre - ce sont ses champs publics (monde, amas, somas, camera) qui
// rendent ca possible sans toucher au fichier fourni.
//
// On DEPLACE LA CAMERA elle-meme vers le Soma, plutot que de faire pivoter
// tout le globe pour amener le Soma sur l'axe fixe de la camera (approche
// tentee d'abord) : le noyau est TOUJOURS a l'origine, donc TOUJOURS sur cet
// axe fixe lui aussi - un Soma qu'on y ramene se retrouve exactement
// aligne avec le noyau, qui l'eclipse visuellement (il est plus gros et
// plus dense, avec toutes les branches qui en rayonnent). En bougeant la
// camera plutot que le monde, elle vise reellement l'endroit du Soma sur
// la coque, qui n'a aucune raison de coincider avec le noyau.
let zoomAnimationId = null;
const RENDU_NORMAL = { exposition: 1.35, bloomIntensite: 0.72 };
const RENDU_ZOOM = { exposition: 0.75, bloomIntensite: 0.4 };
const RESEAU_NORMAL = { somaSeuil: [1.2, 3.0], rafale: 3, relais: 0.32 };
const RESEAU_ZOOM = { somaSeuil: [8, 14], rafale: 1, relais: 0.05 };
const DUREE_PLONGEE = 1100;
// Portion de la plongee/du retour reservee au voile (opaque, couleur de
// #zoom-flash) qui masque la bascule vers/depuis la page : les 35%
// restants montrent le deplacement de camera en clair (voir zoomVersSoma
// et reculerDuZoom).
const SEUIL_FLASH = 0.65;

function zoomVersSoma(index) {
  if (!globe) return;
  const somaId = globe.somas[index];
  const amas = somaId != null ? globe.amas[somaId] : null;
  if (!amas) return;

  if (zoomAnimationId) cancelAnimationFrame(zoomAnimationId);
  // Recentre le globe avant de calculer la plongee : le clic droit peut
  // avoir deplace globe.monde.position, or la visee suppose un globe
  // centre sur l'origine - sans ce recentrage, une plongee declenchee
  // apres un deplacement viserait a cote du Soma reel. La rotation reste
  // figee (rotation:0 ci-dessous) pendant toute la plongee, donc la
  // position MONDE du Soma ne bouge plus une fois ce recentrage fait.
  globe.monde.position.set(0, 0, 0);
  const posSoma = new THREE.Vector3(amas.x, amas.y, amas.z).applyQuaternion(globe.monde.quaternion);
  const distanceSoma = posSoma.length();
  const dirCible = posSoma.clone().normalize();

  const camDepart = globe.camera.position.clone();
  const quatDepart = globe.camera.quaternion.clone();
  // distanceSoma est la distance du Soma au noyau (donc a l'origine) - pas
  // sa propre taille (amas.taille, le rayon de son amas de particules,
  // bien plus petit). On vise juste au-dela de sa coque : la camera ne
  // s'arrete pas devant le Soma, elle le traverse, vers l'interieur.
  const distanceArrivee = Math.max(4, distanceSoma - amas.taille * 3);
  const camArrivee = dirCible.clone().multiplyScalar(distanceArrivee);
  // Regarder dans la direction du trajet (depart -> arrivee) ne vise pas
  // forcement le Soma lui-meme : cette direction ne passe par le Soma que
  // si le trajet camera y est deja aligne, ce qui n'est pas garanti pour
  // un point de depart quelconque - la camera finissait par foncer a cote.
  // On recalcule donc a chaque frame, ci-dessous, l'orientation qui
  // regarde reellement le Soma (posSoma) depuis la position courante de la
  // camera, et on y glisse progressivement depuis l'orientation de depart.
  const AXE_CAMERA = new THREE.Vector3(0, 0, -1);

  globe.definirOptions({ rotation: 0, rendu: RENDU_ZOOM, reseau: RESEAU_ZOOM });
  // Vide les influx deja en vol : sans ca, l'activite accumulee avant la
  // plongee continue de flamber a l'ecran le temps qu'elle s'eteigne
  // d'elle meme, precisement quand la camera s'en approche le plus.
  globe.influx.length = 0;

  const flash = document.getElementById('zoom-flash');
  // Le voile ne monte que sur le dernier tiers de la plongee (SEUIL_FLASH) :
  // avant, l'ancien code ajoutait .actif des le depart et laissait la
  // transition CSS (0.5s) monter plus vite que la plongee entiere (1.1s) -
  // l'ecran devenait opaque avant meme d'avoir vu la camera se deplacer
  // vers le Soma, ce qui se lisait comme un simple flash plutot qu'un
  // vrai zoom. L'opacite est desormais pilotee frame par frame,
  // synchronisee sur la progression reelle.
  // La transition CSS de #zoom-flash (0.5s) rechaine sinon a chaque frame
  // pendant la montee pilotee ici, ce qui la fait retarder derriere la
  // valeur reelle - coupee pendant la plongee, elle ne sert que pour la
  // dissipation finale (voir plus bas).
  flash.style.transition = 'none';

  const debut = performance.now();
  function etape(maintenant) {
    const t = Math.min(1, (maintenant - debut) / DUREE_PLONGEE);
    const progression = 1 - Math.pow(1 - t, 3);
    globe.camera.position.lerpVectors(camDepart, camArrivee, progression);
    // Visee recalculee a chaque frame depuis la position courante : garantit
    // que la camera regarde exactement le Soma une fois arrivee (t=1), quel
    // que soit l'angle de depart.
    const versSoma = posSoma.clone().sub(globe.camera.position).normalize();
    const quatVise = new THREE.Quaternion().setFromUnitVectors(AXE_CAMERA, versSoma);
    globe.camera.quaternion.slerpQuaternions(quatDepart, quatVise, progression);
    // La boucle de rendu du composant tire elle-meme camera.position.z
    // vers zoomCible a chaque frame (son mecanisme de zoom normal) - sans
    // le maintenir aligne sur la position qu'on vient d'imposer, il la
    // corrigerait aussitot et casserait le deplacement pilote ici.
    globe.zoomCible = globe.camera.position.z;
    flash.style.opacity = t > SEUIL_FLASH ? (t - SEUIL_FLASH) / (1 - SEUIL_FLASH) : 0;
    if (t < 1) {
      zoomAnimationId = requestAnimationFrame(etape);
    } else {
      zoomAnimationId = null;
      // La camera a fini de traverser le Soma - l'ecran est blanc a cet
      // instant. On ouvre la page derriere ce blanc puis on retire le style
      // en ligne : la transition CSS (0.5s) reprend la main et dissipe le
      // blanc vers la page, plutot qu'un cut brutal visible.
      ouvrirPageCategorie(GRAPH_NODES[index].id);
      flash.style.transition = '';
      flash.style.opacity = '';
    }
  }
  zoomAnimationId = requestAnimationFrame(etape);

  setActive(GRAPH_NODES[index].id, true);
}

// Ramene la camera de l'endroit du dernier Soma visite (ou elle est restee,
// derriere la page) a sa position fixe habituelle (0,0,distance) face a
// l'origine - symetrique inverse de zoomVersSoma, meme technique de
// deplacement/visee anime plutot qu'un cut instantane. Seul declencheur
// pour l'instant : le bouton "Retour" d'une page de categorie (fermerPage).
function reculerDuZoom() {
  if (!globe) return;
  if (zoomAnimationId) { cancelAnimationFrame(zoomAnimationId); zoomAnimationId = null; }
  globe.definirOptions({ rotation: ROTATION_IDLE_GLOBE, rendu: RENDU_NORMAL, reseau: RESEAU_NORMAL });
  globe.monde.position.set(0, 0, 0);

  const camDepart = globe.camera.position.clone();
  const quatDepart = globe.camera.quaternion.clone();
  const camArrivee = new THREE.Vector3(0, 0, globe.o.camera.distance);
  const quatArrivee = new THREE.Quaternion();

  const flash = document.getElementById('zoom-flash');
  // La page se ferme derriere un ecran plein (meme couleur qu'elle, voir
  // #zoom-flash) instantanement, le temps de la reveler puis de dissiper
  // ce voile progressivement pendant que la camera se retire - symetrique
  // inverse de la montee du blanc en fin de plongee (zoomVersSoma).
  flash.style.transition = 'none';
  flash.style.opacity = '1';

  const debut = performance.now();
  function etape(maintenant) {
    const t = Math.min(1, (maintenant - debut) / DUREE_PLONGEE);
    const progression = 1 - Math.pow(1 - t, 3);
    globe.camera.position.lerpVectors(camDepart, camArrivee, progression);
    globe.camera.quaternion.slerpQuaternions(quatDepart, quatArrivee, progression);
    globe.zoomCible = globe.camera.position.z;
    const SEUIL_VOILE = 1 - SEUIL_FLASH;
    flash.style.opacity = t < SEUIL_VOILE ? 1 - t / SEUIL_VOILE : 0;
    if (t < 1) {
      zoomAnimationId = requestAnimationFrame(etape);
    } else {
      zoomAnimationId = null;
      flash.style.transition = '';
      flash.style.opacity = '';
    }
  }
  zoomAnimationId = requestAnimationFrame(etape);
}

// --- Pages de categorie (Systeme de Modules, §16) -----------------------
// Premiere page construite : AURA SYSTEM MONITOR, alimentee par le
// connecteur reel (connectors/systemMonitor.js, §5.7). Les autres
// categories n'ont pas encore de page - seul le zoom se declenche pour
// elles (ouvrirPageCategorie ignore silencieusement tout id inconnu).
let intervalMonitor = null;

function formatOctets(go) {
  return go == null ? '—' : `${go} Go`;
}

function rendreSystemMonitor(snap) {
  const cpu = document.getElementById('monitor-cpu');
  cpu.innerHTML = `
    <div class="monitor-row"><span>Modèle</span><span>${snap.cpu.model || '—'}</span></div>
    <div class="monitor-row"><span>Cœurs</span><span>${snap.cpu.cores ?? '—'}</span></div>
    <div class="monitor-row"><span>Fréquence</span><span>${snap.cpu.speedGhz ?? '—'} GHz</span></div>
    <div class="monitor-row"><span>Charge</span><span>${snap.cpu.loadPercent ?? '—'} %</span></div>
    <div class="monitor-row"><span>Température</span><span>${snap.cpu.temperatureC ?? '—'} °C</span></div>
  `;

  const mem = document.getElementById('monitor-memory');
  mem.innerHTML = `
    <div class="monitor-row"><span>Utilisée</span><span>${formatOctets(snap.memory.usedGB)} / ${formatOctets(snap.memory.totalGB)}</span></div>
    <div class="monitor-row"><span>Charge</span><span>${snap.memory.usedPercent ?? '—'} %</span></div>
  `;

  const gpu = document.getElementById('monitor-gpu');
  gpu.innerHTML = snap.gpu.length
    ? snap.gpu.map((g) => `
        <div class="monitor-row"><span>${g.model}</span><span>${g.loadPercent ?? '—'} %</span></div>
      `).join('')
    : 'Aucun GPU dédié détecté.';

  const disks = document.getElementById('monitor-disks');
  disks.innerHTML = snap.disks.length
    ? snap.disks.map((d) => `
        <div class="monitor-row"><span>${d.mount}</span><span>${formatOctets(d.usedGB)} / ${formatOctets(d.sizeGB)} (${d.usedPercent ?? '—'} %)</span></div>
      `).join('')
    : 'Aucun disque détecté.';

  const network = document.getElementById('monitor-network');
  network.innerHTML = snap.network.length
    ? snap.network.map((n) => `
        <div class="monitor-row"><span>${n.iface}</span><span>↓ ${n.rxKBs ?? 0} Ko/s · ↑ ${n.txKBs ?? 0} Ko/s</span></div>
      `).join('')
    : 'Aucune interface active.';

  const processes = document.getElementById('monitor-processes');
  processes.innerHTML = snap.topProcesses.length
    ? snap.topProcesses.map((p) => `
        <div class="monitor-row"><span>${p.name} (${p.pid})</span><span>${p.cpuPercent ?? 0} % CPU · ${p.memPercent ?? 0} % mém.</span></div>
      `).join('')
    : 'Aucun processus.';
}

async function actualiserSystemMonitor() {
  try {
    rendreSystemMonitor(await window.aura.getSystemSnapshot());
  } catch {
    document.getElementById('monitor-cpu').textContent = 'Indisponible.';
  }
}

function ouvrirPageCategorie(id) {
  if (id !== 'systemMonitor') return;
  document.getElementById('page-system-monitor').hidden = false;
  actualiserSystemMonitor();
  if (intervalMonitor) clearInterval(intervalMonitor);
  intervalMonitor = setInterval(actualiserSystemMonitor, 3000);
  journal('PAGE_OUVERTE : AURA SYSTEM MONITOR');
}

function fermerPage() {
  document.querySelectorAll('.app-page').forEach((page) => { page.hidden = true; });
  if (intervalMonitor) { clearInterval(intervalMonitor); intervalMonitor = null; }
  reculerDuZoom();
  journal('PAGE_FERMEE : retour au globe');
}

function wirePages() {
  document.getElementById('page-back').addEventListener('click', fermerPage);
}

function wireConversation() {
  const form = document.getElementById('conversation-form');
  const input = document.getElementById('conversation');
  const bulle = document.querySelector('.conversation-bubble');

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const texte = input.value.trim();
    if (!texte) return;

    const index = trouverIndexCategorie(texte);
    if (index === -1) {
      bulle.classList.remove('pas-trouve');
      void bulle.offsetWidth;
      bulle.classList.add('pas-trouve');
      journal(`ACCES_CATEGORIE_INTROUVABLE : ${texte}`);
      return;
    }

    journal(`ACCES_CATEGORIE : ${GRAPH_NODES[index].label}`);
    zoomVersSoma(index);
    input.value = '';
    input.blur();
  });
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

// Filtres d'affichage du flux (§12.3), deux dimensions combinables :
// statut ("tous" | "execute" | "echoue") et sensibilite ("tous" |
// "lecture" | "reversible"). Purement cote client - ne refait pas
// d'appel reseau, filtre la derniere page recuperee.
let journalEntriesCache = [];
let journalFilter = 'tous';
let journalSensFilter = 'tous';

const SENSIBILITE_LABELS = { lecture: 'lecture', reversible: 'réversible' };

function journalEmptyMessage() {
  if (journalFilter === 'tous' && journalSensFilter === 'tous') {
    return 'Aucune action enregistrée pour l’instant.';
  }
  const parts = [];
  if (journalFilter !== 'tous') parts.push(STATUT_LABELS[journalFilter].toLowerCase());
  if (journalSensFilter !== 'tous') parts.push(SENSIBILITE_LABELS[journalSensFilter]);
  return `Aucune action (${parts.join(', ')}) pour ce filtre.`;
}

function renderJournal(entries) {
  journalEntriesCache = entries;
  renderJournalFiltered();
}

function renderJournalFiltered() {
  const list = document.getElementById('journal-list');
  let entries = journalEntriesCache;
  if (journalFilter !== 'tous') entries = entries.filter((entry) => entry.statut === journalFilter);
  if (journalSensFilter !== 'tous') entries = entries.filter((entry) => entry.sensibilite === journalSensFilter);

  if (!entries.length) {
    list.textContent = journalEmptyMessage();
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

function setJournalFilter(type, filter) {
  if (type === 'statut') journalFilter = filter;
  else journalSensFilter = filter;
  document.querySelectorAll(`.filter-btn[data-filter-type="${type}"]`).forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.filter === filter);
  });
  renderJournalFiltered();
}

function wireJournalFilters() {
  document.querySelectorAll('.filter-btn').forEach((btn) => {
    btn.addEventListener('click', () => setJournalFilter(btn.dataset.filterType, btn.dataset.filter));
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

function wirePanels() {
  document.getElementById('toggle-projects').addEventListener('click', () => {
    document.getElementById('panel-projects').classList.toggle('open');
  });
  document.getElementById('toggle-context').addEventListener('click', () => {
    const panel = document.getElementById('panel-context');
    const opening = panel.classList.toggle('open');
    if (opening) {
      loadJournal();
    }
  });

}

function journal(action) {
  // Trace minimale des decisions d'AURA (§5.9, §12.3 actions_log) en
  // attendant un vrai orchestrateur/backend a brancher ici.
  console.log(`[journal] ${new Date().toISOString()} ${action}`);
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
        refreshJournalIfOpen();
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
    if (fired.length) { loadReminders(); refreshJournalIfOpen(); }
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
    refreshJournalIfOpen();
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
    refreshJournalIfOpen();
  });
}

initGlobe();
startClock();
wirePanels();
wireJournalFilters();
wireProductivity();
wireConversation();
wirePages();
loadTasks();
loadReminders();
setInterval(pulseRandomActivity, 1300);
setInterval(pulseNoyau, 2600);
setInterval(checkDueReminders, 30000);
