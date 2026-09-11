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
// Verbes de commande : sous-ensemble des mots vides qui representent une
// action plutot qu'un simple mot de liaison - ce sont eux qu'on colorise en
// rouge dans le Terminal (voir actualiserSurbrillanceCommande), pas les
// articles/prepositions/"aura" qui les accompagnent.
const VERBES_COMMANDE = ['start', 'access', 'acceder', 'accede', 'va', 'aller', 'ouvrir', 'ouvre'];
const MOTS_VIDES_ACCES = [...VERBES_COMMANDE, 'sur', 'a', 'le', 'la', 'les', 'aura'];

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
// Dernier instantane recu (getSystemSnapshot) - permet au tri et au
// filtre de la liste de processus de se reappliquer instantanement (voir
// rendreListeProcessus) sans attendre un nouveau cycle de rafraichissement.
let dernierSnapshot = null;

function formatOctets(go) {
  return go == null ? '—' : `${go} Go`;
}

function formatDuree(secondes) {
  if (secondes == null) return '—';
  const j = Math.floor(secondes / 86400);
  const h = Math.floor((secondes % 86400) / 3600);
  const min = Math.floor((secondes % 3600) / 60);
  if (j > 0) return `${j} j ${h} h`;
  if (h > 0) return `${h} h ${min} min`;
  return `${min} min`;
}

// vramMB/memoryUsedMB (connectors/systemMonitor.js) arrivent en Mo bruts,
// non arrondis cote serveur contrairement aux autres tailles - convertis et
// arrondis ici, en preservant null (GPU sans lecture memoire disponible).
function moEnGo(mo) {
  return mo == null ? null : Math.round(mo / 100) / 10;
}

// Seuils d'alerte configurables, un par metrique (§5.7, "Alertes
// configurables") : au-dela de sa propre charge, chaque metrique
// (CPU/Memoire/GPU/Disques) se signale visuellement (voir styleJauge).
// Purement une preference d'affichage local (pas une action sur le
// systeme) - un seul objet JSON dans localStorage, pas cote serveur.
const CLE_SEUILS = 'aura.monitorSeuils';
const SEUIL_DEFAUT = 85;
const METRIQUES_SEUIL = ['cpu', 'memory', 'gpu', 'disk'];
let seuilsConfigures = { cpu: SEUIL_DEFAUT, memory: SEUIL_DEFAUT, gpu: SEUIL_DEFAUT, disk: SEUIL_DEFAUT };

function chargerSeuils() {
  let brut = null;
  try { brut = JSON.parse(localStorage.getItem(CLE_SEUILS)); } catch { /* valeur absente ou corrompue - retombe sur les defauts */ }
  METRIQUES_SEUIL.forEach((cle) => {
    const v = Number(brut && brut[cle]);
    seuilsConfigures[cle] = Number.isFinite(v) && v >= 50 && v <= 99 ? v : SEUIL_DEFAUT;
  });
  return seuilsConfigures;
}

function definirSeuil(metrique, valeur) {
  const v = Math.max(50, Math.min(99, Math.round(valeur) || SEUIL_DEFAUT));
  seuilsConfigures[metrique] = v;
  try { localStorage.setItem(CLE_SEUILS, JSON.stringify(seuilsConfigures)); } catch { /* stockage indisponible (navigation privee, quota) - le reglage reste actif pour la session */ }
  return v;
}

// Jauge de charge en fond de ligne (voir .monitor-row.avec-jauge, style.css) :
// une classe et une variable CSS inline plutot qu'un chiffre isole, pour
// que les charges se comparent d'un coup d'oeil. Au-dela de seuilAlerte,
// la jauge et la valeur se distinguent visuellement (§5.7, "Alertes
// configurables") - passer 101 (ou omettre) desactive l'alerte (ex. charge
// par processus, ou un pic isole n'indique pas un probleme systeme).
function styleJauge(pourcentage, seuilAlerte) {
  const p = Math.max(0, Math.min(100, pourcentage ?? 0));
  const alerte = seuilAlerte != null && p >= seuilAlerte ? ' jauge-alerte' : '';
  return `class="monitor-row avec-jauge${alerte}" style="--jauge:${p}%"`;
}

// Historique de charge CPU/Memoire, pousse a chaque cycle de
// rafraichissement. Une seule liste par metrique sert les deux vues : la
// sparkline reduite de la carte (derniers HISTORIQUE_MAX points) et
// l'historique complet ouvert au clic (derniers HISTORIQUE_LONG_MAX
// points, voir ouvrirSparklineModal) - HISTORIQUE_LONG_MAX borne aussi la
// taille memoire de la liste elle-meme.
const HISTORIQUE_MAX = 20;
const HISTORIQUE_LONG_MAX = 100;
let historiqueCpu = [];
let historiqueMemoire = [];

// Persistance de l'historique entre sessions (§5.7) : sans ceci, sparkline
// et historique complet repartaient de zero a chaque lancement d'AURA -
// juste les valeurs brutes (pas d'horodatage par point), coherent avec
// l'affichage lui-meme qui ne porte aucun axe temporel ni graduation - un
// redemarrage cree simplement une continuite dans la forme de la courbe,
// pas une promesse de cadence reguliere entre les points les plus anciens.
const CLE_HISTORIQUE = 'aura.monitorHistorique';

function chargerHistorique() {
  try {
    const brut = JSON.parse(localStorage.getItem(CLE_HISTORIQUE));
    if (brut && Array.isArray(brut.cpu)) historiqueCpu = brut.cpu.slice(-HISTORIQUE_LONG_MAX);
    if (brut && Array.isArray(brut.memory)) historiqueMemoire = brut.memory.slice(-HISTORIQUE_LONG_MAX);
  } catch { /* valeur absente ou corrompue - demarre a vide, comme avant cette fonctionnalite */ }
}

function sauvegarderHistorique() {
  try { localStorage.setItem(CLE_HISTORIQUE, JSON.stringify({ cpu: historiqueCpu, memory: historiqueMemoire })); } catch { /* stockage indisponible - reste actif pour la session en cours */ }
}

function pousserHistorique(liste, valeur) {
  liste.push(valeur ?? 0);
  if (liste.length > HISTORIQUE_LONG_MAX) liste.shift();
}

// stroke="currentColor" plutot qu'une couleur fixe : la teinte suit
// .monitor-sparkline en CSS, coherent avec le reste du thème.
// fenetre fixe la largeur "en nombre de points" que represente le graphe
// (les points manquants au debut d'un historique encore court restent
// alignes a droite, comme une fenetre qui se remplit progressivement) -
// HISTORIQUE_MAX pour la version reduite, HISTORIQUE_LONG_MAX pour la
// modale (voir ouvrirSparklineModal). metrique alimente data-metrique,
// utilise par le clic delegue (voir wireSparklineModal) pour savoir quel
// historique ouvrir en plein ecran.
function sparkline(liste, fenetre, metrique) {
  if (liste.length < 2) return '';
  const largeur = 100;
  const hauteur = 26;
  const pas = largeur / (fenetre - 1);
  const decalage = fenetre - liste.length;
  const points = liste.map((v, i) => {
    const x = (decalage + i) * pas;
    const y = hauteur - (Math.max(0, Math.min(100, v)) / 100) * hauteur;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return `<svg class="monitor-sparkline" data-metrique="${metrique}" viewBox="0 0 ${largeur} ${hauteur}" preserveAspectRatio="none" title="Cliquer pour l'historique complet"><polyline points="${points}" fill="none" stroke="currentColor" stroke-width="1.5" /></svg>`;
}

// Tendance CPU/Memoire (§5.7) : compare le dernier point d'historique au
// precedent (donc "depuis le dernier rafraichissement") - une marge morte
// de 2 points evite de faire clignoter la fleche sur le simple bruit de
// mesure d'un systeme par ailleurs stable.
function tendance(liste) {
  if (liste.length < 2) return '';
  const delta = liste[liste.length - 1] - liste[liste.length - 2];
  if (Math.abs(delta) < 2) return '<span class="monitor-tendance" title="Stable">→</span>';
  return delta > 0
    ? '<span class="monitor-tendance" title="En hausse">↑</span>'
    : '<span class="monitor-tendance" title="En baisse">↓</span>';
}

// Intervalle de rafraichissement configurable (§5.7) - preference locale
// (localStorage), comme les seuils. Une valeur hors de la liste des
// options (select, index.html) retombe sur le defaut plutot que d'etre
// acceptee telle quelle - pas de saisie libre ici, donc pas besoin d'un
// clamp min/max comme pour les seuils.
const CLE_INTERVALLE = 'aura.monitorIntervalle';
const INTERVALLE_DEFAUT = 3000;
const INTERVALLES_VALIDES = [1000, 3000, 5000, 10000];
let intervalleConfigure = INTERVALLE_DEFAUT;

function chargerIntervalle() {
  const brut = Number(localStorage.getItem(CLE_INTERVALLE));
  intervalleConfigure = INTERVALLES_VALIDES.includes(brut) ? brut : INTERVALLE_DEFAUT;
  return intervalleConfigure;
}

function definirIntervalle(valeur) {
  const v = INTERVALLES_VALIDES.includes(valeur) ? valeur : INTERVALLE_DEFAUT;
  intervalleConfigure = v;
  try { localStorage.setItem(CLE_INTERVALLE, String(v)); } catch { /* stockage indisponible - le reglage reste actif pour la session */ }
  return v;
}

// Meme jauge que styleJauge, mais l'alerte se declenche EN DESSOUS du
// seuil plutot qu'au-dessus - pour la batterie, ou c'est un niveau bas
// (pas haut) qui est critique.
function styleJaugeBatterie(pourcentage, seuilAlerte = 20) {
  const p = Math.max(0, Math.min(100, pourcentage ?? 0));
  const alerte = p <= seuilAlerte ? ' jauge-alerte' : '';
  return `class="monitor-row avec-jauge${alerte}" style="--jauge:${p}%"`;
}

function rendreSystemMonitor(snap) {
  dernierSnapshot = snap;
  pousserHistorique(historiqueCpu, snap.cpu.loadPercent);
  pousserHistorique(historiqueMemoire, snap.memory.usedPercent);
  sauvegarderHistorique();

  const cpu = document.getElementById('monitor-cpu');
  cpu.innerHTML = `
    <div class="monitor-row"><span>Modèle</span><span>${snap.cpu.model || '—'}</span></div>
    <div class="monitor-row"><span>Cœurs</span><span>${snap.cpu.cores ?? '—'}</span></div>
    <div class="monitor-row"><span>Fréquence</span><span>${snap.cpu.speedGhz ?? '—'} GHz</span></div>
    <div ${styleJauge(snap.cpu.loadPercent, seuilsConfigures.cpu)}><span>Charge</span><span>${snap.cpu.loadPercent ?? '—'} %${tendance(historiqueCpu)}</span></div>
    ${sparkline(historiqueCpu.slice(-HISTORIQUE_MAX), HISTORIQUE_MAX, 'cpu')}
    <div class="monitor-row"><span>Actif depuis</span><span>${formatDuree(snap.uptimeSec)}</span></div>
  `;

  const mem = document.getElementById('monitor-memory');
  mem.innerHTML = `
    <div class="monitor-row"><span>Utilisée</span><span>${formatOctets(snap.memory.usedGB)} / ${formatOctets(snap.memory.totalGB)}</span></div>
    <div ${styleJauge(snap.memory.usedPercent, seuilsConfigures.memory)}><span>Charge</span><span>${snap.memory.usedPercent ?? '—'} %${tendance(historiqueMemoire)}</span></div>
    ${sparkline(historiqueMemoire.slice(-HISTORIQUE_MAX), HISTORIQUE_MAX, 'memory')}
    ${snap.memory.swapTotalGB ? `
    <div class="monitor-row"><span>Swap</span><span>${formatOctets(snap.memory.swapUsedGB)} / ${formatOctets(snap.memory.swapTotalGB)}</span></div>
    ` : ''}
  `;

  const gpu = document.getElementById('monitor-gpu');
  gpu.innerHTML = snap.gpu.length
    ? snap.gpu.map((g, i) => `
        <div class="monitor-row${i > 0 ? ' gpu-separateur' : ''}"><span>${g.model}</span><span>${g.temperatureC != null ? g.temperatureC + ' °C' : '—'}</span></div>
        <div ${styleJauge(g.loadPercent, seuilsConfigures.gpu)}><span>Charge</span><span>${g.loadPercent ?? '—'} %</span></div>
        <div class="monitor-row"><span>Mémoire</span><span>${formatOctets(moEnGo(g.memoryUsedMB))} / ${formatOctets(moEnGo(g.vramMB))}</span></div>
      `).join('')
    : 'Aucun GPU dédié détecté.';

  const disks = document.getElementById('monitor-disks');
  disks.innerHTML = (snap.disks.length
    ? snap.disks.map((d) => `
        <div ${styleJauge(d.usedPercent, seuilsConfigures.disk)}><span>${d.mount}</span><span>${formatOctets(d.usedGB)} / ${formatOctets(d.sizeGB)} (${d.usedPercent ?? '—'} %)</span></div>
      `).join('')
    : 'Aucun disque détecté.')
    + `<div class="monitor-row"><span>Débit</span><span>↓ ${snap.diskIO.readKBs ?? 0} Ko/s · ↑ ${snap.diskIO.writeKBs ?? 0} Ko/s</span></div>`;

  const network = document.getElementById('monitor-network');
  network.innerHTML = snap.network.length
    ? snap.network.map((n) => `
        <div class="monitor-row"><span>${n.iface}</span><span>↓ ${n.rxKBs ?? 0} Ko/s · ↑ ${n.txKBs ?? 0} Ko/s</span></div>
      `).join('')
    : 'Aucune interface active.';

  const processes = document.getElementById('monitor-processes');
  const compteProcessus = snap.processCount != null
    ? `<div class="monitor-row legende"><span>Affichés</span><span>${snap.topProcesses.length} sur ${snap.processCount} processus actifs</span></div>`
    : '';
  processes.innerHTML = compteProcessus + (snap.topProcesses.length
    ? snap.topProcesses.map((p) => `
        <div ${styleJauge(p.cpuPercent, 101)}><span>${p.name} (${p.pid})</span><span>${p.cpuPercent ?? 0} % CPU · ${p.memPercent ?? 0} % mém.</span></div>
      `).join('')
    : 'Aucun processus.');

  rendreListeProcessus();

  const batteryCard = document.getElementById('monitor-battery-card');
  batteryCard.hidden = !snap.battery;
  // Sans batterie, Reseau s'etend sur 2 colonnes pour combler la case
  // vide que laisserait sinon la carte Batterie masquee.
  document.getElementById('monitor-network-card').classList.toggle('monitor-card-2col', !snap.battery);
  if (snap.battery) {
    const b = snap.battery;
    document.getElementById('monitor-battery').innerHTML = `
      <div ${b.isCharging ? styleJauge(b.percent, 101) : styleJaugeBatterie(b.percent)}><span>${b.isCharging ? 'En charge' : 'Charge'}</span><span>${b.percent ?? '—'} %</span></div>
      ${b.timeRemainingMin != null ? `<div class="monitor-row"><span>Restant</span><span>${formatDuree(b.timeRemainingMin * 60)}</span></div>` : ''}
    `;
  }

  const heure = new Date(snap.takenAt).toLocaleTimeString('fr-FR');
  document.getElementById('monitor-updated').textContent = heure;

  // Rejoue le halo (.actualise, style.css) sur chaque carte visible a
  // chaque cycle - la classe est deja presente depuis le cycle precedent
  // (l'animation ne boucle pas), il faut forcer un reflow pour la
  // redemarrer plutot que de se contenter d'un classList.add ignore.
  document.querySelectorAll('#page-system-monitor .monitor-card:not([hidden])').forEach((carte) => {
    carte.classList.remove('actualise');
    void carte.offsetWidth;
    carte.classList.add('actualise');
  });

  // Si la modale d'historique complet est ouverte, son graphe suit lui
  // aussi les nouveaux points plutot que de rester fige au moment ou elle
  // a ete ouverte.
  if (metriqueModalOuverte) ouvrirSparklineModal(metriqueModalOuverte);
}

// Liste complete (facon Gestionnaire des taches) - toutes les
// applications/processus en cours, pas seulement le top 8 par CPU.
// Triable par CPU ou par memoire (triProcessus) et filtrable par nom
// (filtreProcessus, boutons/champ #monitor-tri-*/#monitor-filtre-processus).
// Fonction dediee (plutot qu'inline dans rendreSystemMonitor) : le tri et
// le filtre se reappliquent instantanement sur dernierSnapshot, sans
// attendre un nouveau cycle de rafraichissement (qui peut prendre
// plusieurs secondes, voir si.processes() dans le connecteur).
// Regroupe les instances multiples d'un meme executable (ex. plusieurs
// firefox.exe) en une seule ligne, comme le vrai Gestionnaire des taches
// Windows - sinon une appli avec beaucoup d'onglets/fenetres noie la
// liste sous des lignes quasi identiques. cpuPercent/memPercent sont deja
// des pourcentages du total systeme (voir connectors/systemMonitor.js) :
// les additionner reste donc un pourcentage valide pour le groupe.
function grouperProcessus(liste) {
  const parNom = new Map();
  liste.forEach((p) => {
    const groupe = parNom.get(p.name);
    if (groupe) {
      groupe.cpuPercent = Math.round((groupe.cpuPercent + (p.cpuPercent ?? 0)) * 10) / 10;
      groupe.memPercent = Math.round((groupe.memPercent + (p.memPercent ?? 0)) * 10) / 10;
      groupe.pids.push(p.pid);
    } else {
      parNom.set(p.name, { name: p.name, cpuPercent: p.cpuPercent ?? 0, memPercent: p.memPercent ?? 0, pids: [p.pid] });
    }
  });
  return Array.from(parNom.values());
}

function rendreListeProcessus() {
  const tousProcessus = document.getElementById('monitor-all-processes');
  if (!dernierSnapshot || !dernierSnapshot.allProcesses) { tousProcessus.textContent = 'Chargement…'; return; }

  const processusGroupes = grouperProcessus(dernierSnapshot.allProcesses);
  const filtre = normaliserTexte(filtreProcessus);
  const processusFiltres = filtre
    ? processusGroupes.filter((p) => normaliserTexte(p.name).includes(filtre))
    : processusGroupes;
  const processusTries = processusFiltres.slice().sort((a, b) =>
    triProcessus === 'memory' ? (b.memPercent ?? 0) - (a.memPercent ?? 0) : (b.cpuPercent ?? 0) - (a.cpuPercent ?? 0)
  );

  tousProcessus.innerHTML = processusTries.length
    ? processusTries.map((p) => `
        <div ${styleJauge(p.cpuPercent, 101)}><span>${p.name} ${p.pids.length > 1 ? `(×${p.pids.length})` : `(${p.pids[0]})`}</span><span>${p.cpuPercent} % CPU · ${p.memPercent} % mém.</span></div>
      `).join('')
    : (filtre ? 'Aucun processus ne correspond.' : 'Aucun processus.');
}

// Sur echec, les cartes qui n'affichaient encore que "Chargement…"
// restaient ainsi indefiniment - toutes doivent basculer sur un etat
// d'erreur explicite, pas seulement le CPU.
const CARTES_MONITEUR = ['monitor-cpu', 'monitor-memory', 'monitor-gpu', 'monitor-disks', 'monitor-network', 'monitor-processes', 'monitor-all-processes'];

// getSystemSnapshot() peut prendre plusieurs secondes (si.processes(), voir
// connectors/systemMonitor.js) - avec l'intervalle le plus court disponible
// (1s, §5.7 "Rafraichissement"), un nouveau cycle peut demarrer avant que
// le precedent n'ait fini. Sans ce garde-fou, les appels s'empileraient
// indefiniment et pourraient se resoudre dans le desordre (un fetch plus
// ancien mais plus lent ecrasant un rendu plus recent) - un cycle deja en
// cours se contente d'etre ignore, le suivant reprendra normalement.
let recuperationEnCours = false;

async function actualiserSystemMonitor() {
  if (recuperationEnCours) return;
  recuperationEnCours = true;
  try {
    rendreSystemMonitor(await window.aura.getSystemSnapshot());
  } catch {
    CARTES_MONITEUR.forEach((id) => { document.getElementById(id).textContent = 'Indisponible.'; });
  } finally {
    recuperationEnCours = false;
  }
}

function ouvrirPageCategorie(id) {
  if (id !== 'systemMonitor') return;
  document.getElementById('page-system-monitor').hidden = false;
  actualiserSystemMonitor();
  if (intervalMonitor) clearInterval(intervalMonitor);
  intervalMonitor = setInterval(actualiserSystemMonitor, intervalleConfigure);
  journal('PAGE_OUVERTE : AURA SYSTEM MONITOR');
}

function fermerPage() {
  document.querySelectorAll('.app-page').forEach((page) => { page.hidden = true; });
  if (intervalMonitor) { clearInterval(intervalMonitor); intervalMonitor = null; }
  // Sans ceci, une modale d'historique (ouvrirSparklineModal) laissee
  // ouverte en quittant la page reapparaitrait seule a la prochaine
  // ouverture (elle vit dans le DOM de la page, masquee avec elle par
  // [hidden], mais son propre etat hidden n'aurait jamais ete remis).
  if (metriqueModalOuverte) fermerSparklineModal();
  reculerDuZoom();
  journal('PAGE_FERMEE : retour au globe');
}

function wirePages() {
  document.getElementById('page-back').addEventListener('click', fermerPage);
  wireSeuils();
  wireIntervalle();
  wireTriProcessus();
  wireFiltreProcessus();
  wireSparklineModal();
}

// Seuils d'alerte configurables (§5.7) : charge les valeurs enregistrees au
// demarrage, et sauvegarde + reactualise immediatement l'affichage a
// chaque changement (sans attendre le prochain cycle de 3s).
function wireSeuils() {
  chargerSeuils();
  METRIQUES_SEUIL.forEach((metrique) => {
    const input = document.getElementById(`monitor-seuil-${metrique}`);
    input.value = seuilsConfigures[metrique];
    input.addEventListener('change', () => {
      input.value = definirSeuil(metrique, input.valueAsNumber);
      if (!document.getElementById('page-system-monitor').hidden) actualiserSystemMonitor();
    });
  });
}

// Intervalle de rafraichissement configurable (§5.7) : charge la valeur
// enregistree au demarrage, relance la minuterie avec la nouvelle periode
// des le changement (au lieu d'attendre que l'ancienne s'ecoule).
function wireIntervalle() {
  const select = document.getElementById('monitor-intervalle');
  select.value = String(chargerIntervalle());
  select.addEventListener('change', () => {
    const v = definirIntervalle(Number(select.value));
    select.value = String(v);
    if (!document.getElementById('page-system-monitor').hidden && intervalMonitor) {
      clearInterval(intervalMonitor);
      intervalMonitor = setInterval(actualiserSystemMonitor, intervalleConfigure);
      actualiserSystemMonitor();
    }
  });
}

// Tri du Gestionnaire des taches (§5.7) : CPU par defaut, bascule sur
// memoire au clic - reapplique instantanement sur dernierSnapshot (voir
// rendreListeProcessus), pas de nouvel appel reseau.
let triProcessus = 'cpu';

function wireTriProcessus() {
  document.getElementById('monitor-tri-cpu').addEventListener('click', () => definirTriProcessus('cpu'));
  document.getElementById('monitor-tri-memory').addEventListener('click', () => definirTriProcessus('memory'));
}

function definirTriProcessus(tri) {
  triProcessus = tri;
  document.getElementById('monitor-tri-cpu').classList.toggle('active', tri === 'cpu');
  document.getElementById('monitor-tri-memory').classList.toggle('active', tri === 'memory');
  rendreListeProcessus();
}

// Filtre par nom du Gestionnaire des taches (§5.7) : reapplique lui aussi
// instantanement sur dernierSnapshot a chaque frappe, sans requete reseau.
let filtreProcessus = '';

function wireFiltreProcessus() {
  document.getElementById('monitor-filtre-processus').addEventListener('input', (e) => {
    filtreProcessus = e.target.value;
    rendreListeProcessus();
  });
}

// Historique complet d'une sparkline (§5.7), ouvert au clic sur la
// version reduite - un seul ecouteur delegue sur la grille plutot qu'un
// ecouteur par sparkline (elles sont regenerees a chaque rendu, un
// ecouteur direct serait perdu des le cycle suivant).
let metriqueModalOuverte = null;

function wireSparklineModal() {
  document.querySelector('.monitor-grid').addEventListener('click', (e) => {
    const svg = e.target.closest('.monitor-sparkline');
    if (svg) ouvrirSparklineModal(svg.dataset.metrique);
  });
  document.getElementById('monitor-sparkline-modal-fermer').addEventListener('click', fermerSparklineModal);
  document.getElementById('monitor-sparkline-modal').addEventListener('click', (e) => {
    if (e.target.id === 'monitor-sparkline-modal') fermerSparklineModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !document.getElementById('monitor-sparkline-modal').hidden) fermerSparklineModal();
  });
}

function ouvrirSparklineModal(metrique) {
  const liste = metrique === 'memory' ? historiqueMemoire : historiqueCpu;
  const titre = metrique === 'memory' ? 'Mémoire — historique' : 'CPU — historique';
  metriqueModalOuverte = metrique;
  document.getElementById('monitor-sparkline-modal-titre').textContent = titre;
  document.getElementById('monitor-sparkline-modal-graphe').innerHTML =
    sparkline(liste, HISTORIQUE_LONG_MAX, metrique) || '<p>Pas encore assez de données.</p>';
  document.getElementById('monitor-sparkline-modal').hidden = false;
}

function fermerSparklineModal() {
  metriqueModalOuverte = null;
  document.getElementById('monitor-sparkline-modal').hidden = true;
}

function echapperHtml(texte) {
  return texte.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Colorise en rouge les verbes de commande (VERBES_COMMANDE, ex. "start")
// dans le calque #conversation-highlight superpose au champ de saisie -
// l'input natif ne peut pas colorer une partie de son propre texte, voir
// le commentaire sur .conversation-input-wrap dans style.css.
function actualiserSurbrillanceCommande() {
  const input = document.getElementById('conversation');
  const surbrillance = document.getElementById('conversation-highlight');
  surbrillance.innerHTML = input.value
    .split(/(\s+)/)
    .map((morceau) => (
      VERBES_COMMANDE.includes(normaliserTexte(morceau))
        ? `<span class="mot-commande">${echapperHtml(morceau)}</span>`
        : echapperHtml(morceau)
    ))
    .join('');
  // L'input natif defile tout seul quand le texte depasse sa largeur
  // visible (curseur en bout de saisie) - le calque de surbrillance doit
  // suivre ce defilement pour rester aligne avec le texte reel (invisible).
  surbrillance.style.transform = `translateX(${-input.scrollLeft}px)`;
}

function wireConversation() {
  const form = document.getElementById('conversation-form');
  const input = document.getElementById('conversation');
  const bulle = document.querySelector('.conversation-bubble');

  input.addEventListener('input', actualiserSurbrillanceCommande);
  input.addEventListener('scroll', actualiserSurbrillanceCommande);

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
    actualiserSurbrillanceCommande();
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
chargerHistorique();
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
