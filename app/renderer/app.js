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

// Correspondance EXACTE seulement (idee "Terminal", retour utilisateur) -
// la barre du bas envoie desormais au vrai Terminal (terminal-core) tout
// texte qui ne designe pas une page ; un rapprochement approximatif
// (ancien comportement, "secur" -> AURA SECURITY) avalerait par erreur de
// vraies commandes courtes (ls, ps...) qui ressemblent vaguement a un nom
// de page.
function trouverIndexCategorie(texte) {
  const mots = normaliserTexte(texte).split(' ').filter((m) => m && !MOTS_VIDES_ACCES.includes(m));
  const q = mots.join(' ');
  if (!q) return -1;

  const libelles = GRAPH_NODES.map((n) => normaliserTexte(n.label.replace(/^AURA\s+/i, '')));
  let index = libelles.findIndex((label) => label === q);
  if (index !== -1) return index;

  return GRAPH_NODES.findIndex((n) => n.id.toLowerCase() === q.replace(/ /g, ''));
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

function formatMo(ko) {
  return ko == null ? '—' : `${Math.round(ko / 1024 * 10) / 10} Mo`;
}

// started (connectors/systemMonitor.js) arrive au format "AAAA-MM-JJ
// HH:MM:SS" (deja mis en forme par systeminformation cote Windows,
// verifie en pratique - pas le CIM_DATETIME brut de WMI) - remplacer
// l'espace par un T suffit a obtenir un ISO 8601 valide, interprete
// comme heure locale (on reste sur la meme machine que celle mesuree).
function analyserDateProcessus(brut) {
  if (!brut || typeof brut !== 'string') return null;
  const d = new Date(brut.replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? null : d;
}

// "Demarre depuis" tient lieu de temps CPU cumule (§5.7, idee 4) : la
// valeur exacte n'est pas exposee proprement par systeminformation cote
// Windows (utime/stime WMI restent internes, deja consommes pour calculer
// le % de charge) - la duree depuis le lancement reste une information
// utile et disponible, quand WMI l'expose (souvent absente pour un
// processus protege interroge sans privilege eleve).
function formatDemarrage(brut) {
  const d = analyserDateProcessus(brut);
  if (!d) return '—';
  const secondes = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000));
  return `il y a ${formatDuree(secondes)}`;
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
// GPU et disques peuvent etre plusieurs (plusieurs cartes, plusieurs
// volumes) - une liste par CPU/Memoire ne suffit pas, il faut une liste
// par entree. Indexees par position pour le GPU (ordre stable d'un
// cycle a l'autre, voir si.graphics()) et par point de montage pour les
// disques (identifiant naturel, contrairement a une position qui
// changerait si un volume apparait/disparait).
let historiqueGpu = {};
let historiqueDisques = {};

// Persistance de l'historique entre sessions (§5.7) : sans ceci, sparkline
// et historique complet repartaient de zero a chaque lancement d'AURA -
// juste les valeurs brutes (pas d'horodatage par point), coherent avec
// l'affichage lui-meme qui ne porte aucun axe temporel ni graduation - un
// redemarrage cree simplement une continuite dans la forme de la courbe,
// pas une promesse de cadence reguliere entre les points les plus anciens.
const CLE_HISTORIQUE = 'aura.monitorHistorique';

// Recharge un dictionnaire {cle: [valeurs]} (GPU/disques) depuis sa forme
// brute JSON - factorise la validation commune a chargerHistorique.
function chargerHistoriqueIndexe(brut) {
  const resultat = {};
  if (brut && typeof brut === 'object') {
    Object.keys(brut).forEach((cle) => {
      if (Array.isArray(brut[cle])) resultat[cle] = brut[cle].slice(-HISTORIQUE_LONG_MAX);
    });
  }
  return resultat;
}

function chargerHistorique() {
  try {
    const brut = JSON.parse(localStorage.getItem(CLE_HISTORIQUE));
    if (brut && Array.isArray(brut.cpu)) historiqueCpu = brut.cpu.slice(-HISTORIQUE_LONG_MAX);
    if (brut && Array.isArray(brut.memory)) historiqueMemoire = brut.memory.slice(-HISTORIQUE_LONG_MAX);
    if (brut) historiqueGpu = chargerHistoriqueIndexe(brut.gpu);
    if (brut) historiqueDisques = chargerHistoriqueIndexe(brut.disks);
  } catch { /* valeur absente ou corrompue - demarre a vide, comme avant cette fonctionnalite */ }
}

function sauvegarderHistorique() {
  try {
    localStorage.setItem(CLE_HISTORIQUE, JSON.stringify({
      cpu: historiqueCpu,
      memory: historiqueMemoire,
      gpu: historiqueGpu,
      disks: historiqueDisques
    }));
  } catch { /* stockage indisponible - reste actif pour la session en cours */ }
}

function pousserHistorique(liste, valeur) {
  liste.push(valeur ?? 0);
  if (liste.length > HISTORIQUE_LONG_MAX) liste.shift();
}

// Variante indexee (GPU/disques, voir historiqueGpu/historiqueDisques
// ci-dessus) : cree la liste au premier passage pour cette cle plutot
// que d'exiger une initialisation prealable pour chaque GPU/disque
// possible (leur nombre n'est connu qu'a la lecture du premier snapshot).
function pousserHistoriqueIndexe(dictionnaire, cle, valeur) {
  if (!dictionnaire[cle]) dictionnaire[cle] = [];
  pousserHistorique(dictionnaire[cle], valeur);
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
    ? snap.gpu.map((g, i) => {
        pousserHistoriqueIndexe(historiqueGpu, i, g.loadPercent);
        const hist = historiqueGpu[i];
        return `
        <div class="monitor-row${i > 0 ? ' gpu-separateur' : ''}"><span>${g.model}</span><span>${g.temperatureC != null ? g.temperatureC + ' °C' : '—'}</span></div>
        <div ${styleJauge(g.loadPercent, seuilsConfigures.gpu)}><span>Charge</span><span>${g.loadPercent ?? '—'} %${tendance(hist)}</span></div>
        ${sparkline(hist.slice(-HISTORIQUE_MAX), HISTORIQUE_MAX, `gpu:${i}`)}
        <div class="monitor-row"><span>Mémoire</span><span>${formatOctets(moEnGo(g.memoryUsedMB))} / ${formatOctets(moEnGo(g.vramMB))}</span></div>
      `;
      }).join('')
    : 'Aucun GPU dédié détecté.';

  const disks = document.getElementById('monitor-disks');
  disks.innerHTML = (snap.disks.length
    ? snap.disks.map((d) => {
        pousserHistoriqueIndexe(historiqueDisques, d.mount, d.usedPercent);
        const hist = historiqueDisques[d.mount];
        return `
        <div ${styleJauge(d.usedPercent, seuilsConfigures.disk)}><span>${d.mount}</span><span>${formatOctets(d.usedGB)} / ${formatOctets(d.sizeGB)} (${d.usedPercent ?? '—'} %)${tendance(hist)}</span></div>
        ${sparkline(hist.slice(-HISTORIQUE_MAX), HISTORIQUE_MAX, `disk:${d.mount}`)}
      `;
      }).join('')
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
// instances garde l'objet complet de chaque processus du groupe (pas
// seulement son pid) : les details au clic (path/started/priority, voir
// ouvrirDetailsProcessus) sont propres a chaque instance et n'ont pas de
// sens additionnes, contrairement a cpuPercent/memPercent.
function grouperProcessus(liste) {
  const parNom = new Map();
  liste.forEach((p) => {
    const groupe = parNom.get(p.name);
    if (groupe) {
      groupe.cpuPercent = Math.round((groupe.cpuPercent + (p.cpuPercent ?? 0)) * 10) / 10;
      groupe.memPercent = Math.round((groupe.memPercent + (p.memPercent ?? 0)) * 10) / 10;
      groupe.pids.push(p.pid);
      groupe.instances.push(p);
    } else {
      parNom.set(p.name, { name: p.name, cpuPercent: p.cpuPercent ?? 0, memPercent: p.memPercent ?? 0, pids: [p.pid], instances: [p] });
    }
  });
  return Array.from(parNom.values());
}

// Dernier regroupement rendu (§5.7) : ouvrirDetailsProcessus y retrouve
// les instances du groupe sur lequel on vient de cliquer, sans reder
// une deuxieme fois le regroupement au clic.
let dernierGroupesProcessus = [];

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
  dernierGroupesProcessus = processusTries;

  tousProcessus.innerHTML = processusTries.length
    ? processusTries.map((p) => `
        <div ${styleJauge(p.cpuPercent, 101)} data-nom="${echapperHtml(p.name)}"><span>${p.name} ${p.pids.length > 1 ? `(×${p.pids.length})` : `(${p.pids[0]})`}</span><span>${p.cpuPercent} % CPU · ${p.memPercent} % mém.</span></div>
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
  if (id === 'systemMonitor') {
    document.getElementById('page-system-monitor').hidden = false;
    actualiserSystemMonitor();
    if (intervalMonitor) clearInterval(intervalMonitor);
    intervalMonitor = setInterval(actualiserSystemMonitor, intervalleConfigure);
    journal('PAGE_OUVERTE : AURA SYSTEM MONITOR');
  } else if (id === 'productivity') {
    document.getElementById('page-productivity').hidden = false;
    // Pas de minuterie propre : taches/rappels ne changent que par action
    // utilisateur sur cette meme page (pas de polling requis), et un
    // rappel qui se declenche en arriere-plan (checkDueReminders, deja
    // actif en continu toutes les 30s) rafraichit deja les deux
    // emplacements via loadReminders().
    loadTasks();
    loadReminders();
    journal('PAGE_OUVERTE : AURA PRODUCTIVITY');
  } else if (id === 'autonomy') {
    document.getElementById('page-autonomy').hidden = false;
    sortirModeEdition();
    loadRules();
    chargerEstop();
    journal('PAGE_OUVERTE : AURA AUTONOMY');
  } else if (id === 'security') {
    document.getElementById('page-security').hidden = false;
    actualiserHorodatageSecurity();
    chargerDossiersRecents();
    chargerHistoriqueSecurity();
    chargerExclusions(document.getElementById('security-path').value.trim());
    chargerMotifsSecret(document.getElementById('security-path').value.trim());
    journal('PAGE_OUVERTE : AURA SECURITY');
  } else if (id === 'terminal') {
    document.getElementById('page-terminal').hidden = false;
    // Initialise une seule fois (banniere + historique) : les visites
    // suivantes retrouvent le flux tel qu'on l'a laisse, comme un vrai
    // terminal qu'on rouvre plutot qu'on relance a chaque fois.
    initTerminalPage();
    document.getElementById('terminal-page-input').focus();
    // Panneau lateral (idee "ressemble a TERMINAL") : rafraichi tout de
    // suite puis par intervalle, comme AURA SYSTEM MONITOR - "Ouverte
    // depuis"/"Machine" doivent avancer meme sans taper de commande.
    actualiserTerminalSidebar();
    if (intervalTerminalSidebar) clearInterval(intervalTerminalSidebar);
    intervalTerminalSidebar = setInterval(actualiserTerminalSidebar, 5000);
    journal('PAGE_OUVERTE : AURA TERMINAL');
  }
}

function fermerPage() {
  document.querySelectorAll('.app-page').forEach((page) => { page.hidden = true; });
  if (intervalMonitor) { clearInterval(intervalMonitor); intervalMonitor = null; }
  if (intervalTerminalSidebar) { clearInterval(intervalTerminalSidebar); intervalTerminalSidebar = null; }
  // Sans ceci, une modale (historique ou details processus) laissee
  // ouverte en quittant la page reapparaitrait seule a la prochaine
  // ouverture (elle vit dans le DOM de la page, masquee avec elle par
  // [hidden], mais son propre etat hidden n'aurait jamais ete remis).
  if (metriqueModalOuverte) fermerSparklineModal();
  if (!document.getElementById('monitor-processus-modal').hidden) fermerDetailsProcessus();
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
  wireDetailsProcessus();
  wireProductivityPage();
  wireAutonomyPage();
  wireSecurityPage();
  wireTerminalPage();
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

// Resout un identifiant de metrique ('cpu', 'memory', 'gpu:<index>',
// 'disk:<point de montage>', voir sparkline()) vers sa liste d'historique
// et un titre lisible - centralise la logique commune a l'ouverture et
// au suivi en direct (voir la fin de rendreSystemMonitor) de la modale.
function obtenirHistorique(metrique) {
  if (metrique === 'memory') return { liste: historiqueMemoire, titre: 'Mémoire — historique' };
  if (metrique.startsWith('gpu:')) {
    const index = metrique.slice(4);
    const g = dernierSnapshot && dernierSnapshot.gpu && dernierSnapshot.gpu[index];
    return { liste: historiqueGpu[index] || [], titre: `${g ? g.model : 'GPU'} — historique` };
  }
  if (metrique.startsWith('disk:')) {
    const mount = metrique.slice(5);
    return { liste: historiqueDisques[mount] || [], titre: `${mount} — historique` };
  }
  return { liste: historiqueCpu, titre: 'CPU — historique' };
}

function ouvrirSparklineModal(metrique) {
  const { liste, titre } = obtenirHistorique(metrique);
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

// Details d'un processus (ou groupe, §5.7, idee 4), ouverts au clic sur
// une ligne du Gestionnaire des taches - meme principe delegue que la
// sparkline (les lignes sont regenerees a chaque rendu).
function wireDetailsProcessus() {
  document.getElementById('monitor-all-processes').addEventListener('click', (e) => {
    const ligne = e.target.closest('.monitor-row');
    if (ligne && ligne.dataset.nom) ouvrirDetailsProcessus(ligne.dataset.nom);
  });
  document.getElementById('monitor-processus-modal-fermer').addEventListener('click', fermerDetailsProcessus);
  document.getElementById('monitor-processus-modal').addEventListener('click', (e) => {
    if (e.target.id === 'monitor-processus-modal') fermerDetailsProcessus();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !document.getElementById('monitor-processus-modal').hidden) fermerDetailsProcessus();
  });
}

function ouvrirDetailsProcessus(nom) {
  const groupe = dernierGroupesProcessus.find((g) => g.name === nom);
  if (!groupe) return;
  document.getElementById('monitor-processus-modal-titre').textContent =
    groupe.instances.length > 1 ? `${groupe.name} (×${groupe.instances.length})` : groupe.name;
  document.getElementById('monitor-processus-modal-corps').innerHTML = groupe.instances
    .slice()
    .sort((a, b) => (b.cpuPercent ?? 0) - (a.cpuPercent ?? 0))
    .map((p) => `
      <div class="monitor-processus-detail">
        <div class="monitor-row"><span>PID</span><span>${p.pid}${p.priority != null ? ' · priorité ' + p.priority : ''}</span></div>
        <div class="monitor-row"><span>Charge</span><span>${p.cpuPercent ?? 0} % CPU · ${p.memPercent ?? 0} % mém. (${formatMo(p.memRssKB)})</span></div>
        <div class="monitor-row"><span>Démarré</span><span>${formatDemarrage(p.started)}</span></div>
        ${p.path ? `<div class="monitor-processus-chemin"><span>Chemin</span><div>${echapperHtml(p.path)}</div></div>` : ''}
      </div>
    `).join('');
  document.getElementById('monitor-processus-modal').hidden = false;
}

function fermerDetailsProcessus() {
  document.getElementById('monitor-processus-modal').hidden = true;
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
  const popup = document.getElementById('conversation-output');

  input.addEventListener('input', actualiserSurbrillanceCommande);
  input.addEventListener('scroll', actualiserSurbrillanceCommande);

  initTerminalPopup();
  wireTerminalInput({
    input,
    hint: document.getElementById('conversation-hint'),
    session: terminalPopupSession,
    // Echap : masque le popup une fois qu'il est ouvert (rien en cours a
    // interrompre, sinon wireTerminalInput l'a deja fait avant d'arriver
    // ici - voir sa propre gestion d'Echap).
    onEchap: () => { popup.hidden = true; }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const texte = input.value.trim();
    if (!texte) return;

    const index = trouverIndexCategorie(texte);
    if (index !== -1) {
      journal(`ACCES_CATEGORIE : ${GRAPH_NODES[index].label}`);
      zoomVersSoma(index);
      input.value = '';
      input.blur();
      actualiserSurbrillanceCommande();
      return;
    }

    // Ni une commande de navigation exacte (idee "Terminal", retour
    // utilisateur) : la ligne part au vrai Terminal, sa sortie s'affiche
    // juste au-dessus, sans quitter la page principale.
    popup.hidden = false;
    input.value = '';
    actualiserSurbrillanceCommande();
    await terminalPopupSession.soumettre(texte);
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
  'autonomy.simulation': 'Règle AUTONOMY (simulation)',
  'rule.create': 'Règle créée',
  'rule.toggle': 'Règle activée/désactivée',
  'rule.update': 'Règle modifiée',
  'security.scan_secrets': 'Analyse de secrets',
  'security.audit_deps': 'Audit de dépendances',
  'security.fix_dependency': 'Correctif de dépendance'
};

function formatJournalMessage(entry) {
  const label = TYPE_LABELS[entry.typeAction] || entry.typeAction;
  const d = entry.details || {};
  if (entry.statut === 'echoue') return `${label} — ${d.error || 'échec'}`;
  if (entry.typeAction === 'task.create' || entry.typeAction === 'task.complete') return `${label} : ${d.title || ''}`;
  if (entry.typeAction === 'reminder.schedule' || entry.typeAction === 'reminder.fired') return `${label} : ${d.text || ''}`;
  if (entry.typeAction === 'config.api_key') return `${label} : ${d.provider || ''}`;
  if (entry.typeAction === 'rule.create' || entry.typeAction === 'rule.update') return `${label} : ${d.name || ''}`;
  if (entry.typeAction === 'rule.toggle') return `${label} : ${d.name || ''} (${d.enabled ? 'activée' : 'désactivée'})`;
  if (entry.typeAction === 'security.scan_secrets') return `${label} : ${d.trouvailles ?? 0} trouvaille(s) sur ${d.fichiersAnalyses ?? 0} fichier(s)`;
  if (entry.typeAction === 'security.audit_deps') return `${label} : ${d.total ?? 0} vulnérabilité(s)`;
  if (entry.typeAction === 'security.fix_dependency') return `${label} : ${d.correctif || ''}`;
  if (entry.typeAction === 'autonomy.rule_fired' || entry.typeAction === 'autonomy.simulation') {
    return `${label} : ${d.name || ''}${d.summary ? ' — ' + d.summary : ''}`;
  }
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

// Logs du systeme (panneau lateral gauche, §16.1) : memes entrees que le
// panneau Activite (window.aura.getJournal(), meme journal d'actions
// store.js#logAction), mais regroupees par minute et affichees en frise
// chronologique plutot qu'en liste filtrable - un flux "console systeme"
// a l'ouverture du panneau, pas un outil de recherche.
function formatHeureMinute(dateIso) {
  return new Date(dateIso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

// Les entrees arrivent deja triees du plus recent au plus ancien
// (store.js#getJournal) - un groupe se cree des que la minute change,
// jamais re-ouvert ensuite.
function grouperLogsParMinute(entries) {
  const groupes = [];
  for (const entry of entries) {
    const heure = formatHeureMinute(entry.date);
    const dernier = groupes[groupes.length - 1];
    if (dernier && dernier.heure === heure) {
      dernier.entries.push(entry);
    } else {
      groupes.push({ heure, entries: [entry] });
    }
  }
  return groupes;
}

function actualiserPiedSystemLogs() {
  const horloge = document.getElementById('system-logs-clock');
  const version = document.getElementById('system-logs-version');
  if (horloge) {
    horloge.textContent = new Date().toLocaleString('fr-FR', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
  }
  if (version) version.textContent = `AURA v${window.aura.version}`;
}

function renderSystemLogs(entries) {
  const zone = document.getElementById('system-logs-list');
  if (!entries.length) {
    zone.textContent = 'Aucune entrée pour l’instant.';
  } else {
    zone.innerHTML = grouperLogsParMinute(entries).map((groupe) => `
      <div class="system-log-group">
        <div class="system-log-marker">
          <span class="system-log-dot"></span>
          <span class="system-log-time">${groupe.heure}</span>
        </div>
        <div class="system-log-lines">
          ${groupe.entries.map((e) => `<div class="system-log-line${e.statut === 'echoue' ? ' system-log-line-echec' : ''}">&gt; ${echapperHtml(formatJournalMessage(e))}</div>`).join('')}
        </div>
      </div>
    `).join('');
  }
  actualiserPiedSystemLogs();
}

async function loadSystemLogs() {
  try {
    renderSystemLogs(await window.aura.getJournal());
  } catch {
    document.getElementById('system-logs-list').textContent = 'Journal indisponible.';
  }
}

// Rafraichit les zones de rendu des panneaux deja ouverts - reste
// purement passif (n'ouvre jamais un panneau lui-meme) sinon. Suffit a
// tenir les logs du systeme a jour sans minuterie propre : tout endroit
// de l'app qui declenche deja une action (creation de tache, regle
// testee, etc.) appelle cette meme fonction.
function refreshJournalIfOpen() {
  if (document.getElementById('panel-context').classList.contains('open')) loadJournal();
  if (document.getElementById('panel-projects').classList.contains('open')) loadSystemLogs();
}

function wirePanels() {
  document.getElementById('toggle-projects').addEventListener('click', () => {
    const panel = document.getElementById('panel-projects');
    const opening = panel.classList.toggle('open');
    if (opening) loadSystemLogs();
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

// Construit la ligne DOM d'une tache (checkbox/pastille priorite/titre/
// echeance/suppression), independamment de son conteneur - appelee une
// fois par emplacement d'affichage (panneau lateral Projets + page AURA
// Productivity, §16) puisqu'un meme noeud DOM ne peut pas vivre dans
// deux parents a la fois.
function construireLigneTache(task) {
  const row = document.createElement('div');
  row.className = `task-row ${task.status === 'completed' ? 'completed' : ''}`;
  // Titre echappe (echapperHtml) : insere via innerHTML, un titre de
  // tache contenant "<"/">" casserait sinon la structure de la ligne
  // (bouton de suppression masque, balises etrangeres injectees).
  row.innerHTML = `
    <input type="checkbox" ${task.status === 'completed' ? 'checked disabled' : ''}>
    <span class="task-priority-dot ${task.priority}"></span>
    <span class="task-title">${echapperHtml(task.title)}</span>
    ${task.dueDate ? `<span class="task-due">${echapperHtml(task.dueDate)}</span>` : ''}
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
  return row;
}

// Emplacements d'affichage des taches/rappels (§7, §16) : uniquement la
// page AURA Productivity depuis que le panneau lateral gauche affiche les
// logs du systeme a la place (§16.1) - un element absent serait de toute
// facon simplement ignore (filter(Boolean) ci-dessous).
const CIBLES_TACHES = ['productivity-tasks-list'];
const CIBLES_RAPPELS = ['productivity-reminders-list'];

// Horodatage de la page AURA Productivity (§16), meme principe que
// #monitor-updated sur System Monitor - mis a jour a chaque rendu des
// taches/rappels (renderTasks/renderReminders), qu'il soit declenche
// depuis la page elle-meme, le panneau lateral, ou un rappel qui se
// declenche en arriere-plan (checkDueReminders). Sans minuterie propre :
// contrairement a System Monitor, les donnees ne bougent que sur
// evenement, pas de cycle a afficher.
function actualiserHorodatageProductivite() {
  const el = document.getElementById('productivity-updated');
  if (el) el.textContent = new Date().toLocaleTimeString('fr-FR');
}

function renderTasks(tasks) {
  const cibles = CIBLES_TACHES.map((id) => document.getElementById(id)).filter(Boolean);
  const active = tasks.filter((t) => t.status !== 'completed');
  const completed = tasks.filter((t) => t.status === 'completed');
  const ordered = [...active, ...completed];
  cibles.forEach((list) => {
    if (!ordered.length) { list.textContent = 'Aucune tâche.'; return; }
    list.innerHTML = '';
    ordered.forEach((task) => list.appendChild(construireLigneTache(task)));
  });
  actualiserHorodatageProductivite();
}

async function loadTasks() {
  try {
    renderTasks(await window.aura.getTasks());
  } catch {
    CIBLES_TACHES.forEach((id) => { const el = document.getElementById(id); if (el) el.textContent = 'Tâches indisponibles.'; });
  }
}

function construireLigneRappel(reminder) {
  const row = document.createElement('div');
  row.className = 'reminder-row';
  const when = new Date(reminder.at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
  const recur = reminder.recurring === 'daily' ? ' ↻ jour' : reminder.recurring === 'weekly' ? ' ↻ semaine' : '';
  // Texte echappe (voir construireLigneTache) - meme raison.
  row.innerHTML = `
    <span class="task-title">${echapperHtml(reminder.text)}</span>
    <span class="task-due">${when}${recur}</span>
    <button type="button" class="row-delete" title="Supprimer">✕</button>
  `;
  row.querySelector('.row-delete').addEventListener('click', async () => {
    await window.aura.deleteReminder(reminder.id);
    loadReminders();
  });
  return row;
}

function renderReminders(reminders) {
  const cibles = CIBLES_RAPPELS.map((id) => document.getElementById(id)).filter(Boolean);
  const active = reminders.filter((r) => r.active).sort((a, b) => new Date(a.at) - new Date(b.at));
  cibles.forEach((list) => {
    if (!active.length) { list.textContent = 'Aucun rappel.'; return; }
    list.innerHTML = '';
    active.forEach((reminder) => list.appendChild(construireLigneRappel(reminder)));
  });
  actualiserHorodatageProductivite();
}

async function loadReminders() {
  try {
    renderReminders(await window.aura.getReminders());
  } catch {
    CIBLES_RAPPELS.forEach((id) => { const el = document.getElementById(id); if (el) el.textContent = 'Rappels indisponibles.'; });
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

// Cree une tache depuis un formulaire identifie par son prefixe d'id -
// panneau lateral Projets (prefixe vide, ids historiques task-form/
// task-title/...) ou page AURA Productivity (prefixe 'productivity-').
// Factorise plutot que duplique : la seule difference entre les deux
// emplacements est le prefixe des ids, toute la logique de creation
// reste commune.
function wireFormulaireTache(prefixe) {
  document.getElementById(`${prefixe}task-form`).addEventListener('submit', async (e) => {
    e.preventDefault();
    const titreInput = document.getElementById(`${prefixe}task-title`);
    const dueInput = document.getElementById(`${prefixe}task-due`);
    const title = titreInput.value.trim();
    if (!title) return;
    const dueDate = dueInput.value || null;
    const priority = document.getElementById(`${prefixe}task-priority`).value;
    try {
      await window.aura.createTask({ title, dueDate, priority });
      titreInput.value = '';
      dueInput.value = '';
      journal(`TACHE_CREEE : ${title}`);
      loadTasks();
    } catch (err) {
      journal(`TACHE_CREATION_ECHEC : ${err.message}`);
    }
    refreshJournalIfOpen();
  });
}

function wireFormulaireRappel(prefixe) {
  document.getElementById(`${prefixe}reminder-form`).addEventListener('submit', async (e) => {
    e.preventDefault();
    const texteInput = document.getElementById(`${prefixe}reminder-text`);
    const atInput = document.getElementById(`${prefixe}reminder-at`);
    const text = texteInput.value.trim();
    const at = atInput.value;
    const recurring = document.getElementById(`${prefixe}reminder-recurring`).value || null;
    if (!text || !at) return;
    try {
      await window.aura.createReminder({ text, at: new Date(at).toISOString(), recurring });
      texteInput.value = '';
      atInput.value = '';
      journal(`RAPPEL_PROGRAMME : ${text}`);
      loadReminders();
    } catch (err) {
      journal(`RAPPEL_CREATION_ECHEC : ${err.message}`);
    }
    refreshJournalIfOpen();
  });
}

// Page AURA Productivity (§16) - seul emplacement des formulaires
// taches/rappels depuis que le panneau lateral gauche affiche les logs
// du systeme a la place (§16.1). wireFormulaireTache/Rappel restent
// parametrees par prefixe (historique : le panneau lateral en avait
// autrefois sa propre instance, prefixe vide).
function wireProductivityPage() {
  document.getElementById('productivity-back').addEventListener('click', fermerPage);
  wireFormulaireTache('productivity-');
  wireFormulaireRappel('productivity-');
}

// --- Page AURA AUTONOMY (§5.9) -----------------------------------------
// Gestion des regles (creation/activation/suppression) au-dessus du
// moteur reel (autonomy.js#tick(), deja lance en continu par main.js) -
// et arret d'urgence, deja expose cote backend (getEstop/setEstop).

const METRIQUE_LABELS = { cpu: 'CPU', ram: 'Mémoire', gpu: 'GPU' };

function resumeDeclencheur(trigger) {
  if (trigger.type === 'interval') return `toutes les ${trigger.minutes} min`;
  if (trigger.type === 'daily') return `chaque jour à ${trigger.time}`;
  if (trigger.type === 'threshold') {
    const metrique = METRIQUE_LABELS[trigger.metric] || trigger.metric;
    const op = trigger.operator === 'below' ? '<' : '>';
    return `${metrique} ${op} ${trigger.value}%`;
  }
  return '';
}

function resumeAction(action) {
  const params = action.params || {};
  if (action.type === 'notify') return `notifier « ${params.message || ''} »`;
  if (action.type === 'task.create') return `créer tâche « ${params.title || ''} »`;
  if (action.type === 'system.snapshot') return 'instantané système';
  if (action.type === 'security.scan') return `scan de sécurité « ${params.path || ''} »`;
  if (action.type === 'security.audit_deps') return `audit de dépendances « ${params.path || ''} » (notifie dès ${SEVERITE_LABELS[params.graviteMin] || params.graviteMin})`;
  return '';
}

// Lit le declencheur/l'action depuis les champs du formulaire - partage
// entre la soumission (creation/edition) et l'apercu en direct (idee 2,
// retour utilisateur) plutot que de dupliquer la meme lecture de champs
// aux deux endroits.
function lireTriggerFormulaire() {
  const type = document.getElementById('autonomy-rule-trigger-type').value;
  if (type === 'interval') {
    return { type: 'interval', minutes: Number(document.getElementById('autonomy-trigger-minutes').value) };
  }
  if (type === 'daily') {
    return { type: 'daily', time: document.getElementById('autonomy-trigger-time').value };
  }
  return {
    type: 'threshold',
    metric: document.getElementById('autonomy-trigger-metric').value,
    operator: document.getElementById('autonomy-trigger-operator').value,
    value: Number(document.getElementById('autonomy-trigger-value').value)
  };
}

function lireActionFormulaire() {
  const type = document.getElementById('autonomy-rule-action-type').value;
  if (type === 'notify') {
    return { type: 'notify', params: { message: document.getElementById('autonomy-action-message').value.trim() } };
  }
  if (type === 'task.create') {
    return { type: 'task.create', params: { title: document.getElementById('autonomy-action-title').value.trim() } };
  }
  if (type === 'security.scan') {
    return { type: 'security.scan', params: { path: document.getElementById('autonomy-action-security-path').value.trim() } };
  }
  if (type === 'security.audit_deps') {
    return {
      type: 'security.audit_deps',
      params: {
        path: document.getElementById('autonomy-action-audit-path').value.trim(),
        graviteMin: document.getElementById('autonomy-action-audit-gravite').value
      }
    };
  }
  return { type: 'system.snapshot', params: {} };
}

// Apercu en direct (idee 2, retour utilisateur) : meme phrase que
// .rule-meta dans la liste, recalculee a chaque saisie/selection du
// formulaire (voir l'ecouteur delegue dans wireFormulaireRegle).
function actualiserApercuRegle() {
  const preview = document.getElementById('autonomy-form-preview');
  if (!preview) return;
  const action = lireActionFormulaire();
  // Espace reservateur (…) plutot que des guillemets vides « » - message/
  // titre non encore saisis pendant qu'on construit la regle, contrairement
  // a une regle reelle (validee, donc jamais vide a ce stade dans la liste).
  const params = action.params || {};
  if (action.type === 'notify' && !params.message) params.message = '…';
  if (action.type === 'task.create' && !params.title) params.title = '…';
  if ((action.type === 'security.scan' || action.type === 'security.audit_deps') && !params.path) params.path = '…';
  preview.textContent = `${resumeDeclencheur(lireTriggerFormulaire())} → ${resumeAction(action)}`;
}

// Construit la ligne DOM d'une regle : case a cocher, nom + mode (badge
// Simulation/Live, §16 amelioration design - auparavant du texte noye
// dans le resume, peu visible), resume declencheur->action + derniere
// execution en dessous, actions (tester/supprimer) a droite.
// "Derniere execution" (§16, idee 1) : meme principe que formatDemarrage
// (System Monitor) mais sur un ISOString deja normalise (lastRunAt,
// store.js) - pas besoin du reformatage espace->T de analyserDateProcessus.
function formatDerniereExecution(lastRunAt) {
  if (!lastRunAt) return 'jamais';
  const secondes = Math.max(0, Math.round((Date.now() - new Date(lastRunAt).getTime()) / 1000));
  return `il y a ${formatDuree(secondes)}`;
}

function construireLigneRegle(rule) {
  const row = document.createElement('div');
  row.className = `rule-row ${rule.enabled ? '' : 'disabled'}`;
  const meta = `${resumeDeclencheur(rule.trigger)} → ${resumeAction(rule.action)} · ${formatDerniereExecution(rule.lastRunAt)}`;
  const modeClasse = rule.mode === 'simulation' ? 'rule-mode-simulation' : 'rule-mode-live';
  const modeLabel = rule.mode === 'simulation' ? 'Simulation' : 'Live';
  row.innerHTML = `
    <input type="checkbox" ${rule.enabled ? 'checked' : ''}>
    <div class="rule-info">
      <div class="rule-title-row">
        <span class="rule-name">${echapperHtml(rule.name)}</span>
        <span class="rule-mode ${modeClasse}">${modeLabel}</span>
      </div>
      <span class="rule-meta">${echapperHtml(meta)}</span>
    </div>
    <div class="rule-actions">
      <button type="button" class="row-test" title="Tester maintenant">▶</button>
      <button type="button" class="row-edit" title="Modifier">✎︎</button>
      <button type="button" class="row-duplicate" title="Dupliquer">⧉</button>
      <button type="button" class="row-delete" title="Supprimer">✕</button>
    </div>
  `;
  row.querySelector('input[type="checkbox"]').addEventListener('change', async (e) => {
    const active = e.target.checked;
    try {
      await window.aura.toggleRule(rule.id, active);
      journal(`REGLE_${active ? 'ACTIVEE' : 'DESACTIVEE'} : ${rule.name}`);
      loadRules();
    } catch (err) {
      e.target.checked = !active;
      journal(`REGLE_ECHEC : ${err.message}`);
    }
    refreshJournalIfOpen();
  });
  // Retour visuel du test manuel (idee 3, retour utilisateur) : le
  // resultat n'apparaissait auparavant que dans le journal (panneau
  // masque par defaut) - flash vert/rouge directement sur le bouton
  // avant de rafraichir la liste (succes) ou de revenir a l'etat normal
  // (echec), plus immediat.
  const boutonTester = row.querySelector('.row-test');
  boutonTester.addEventListener('click', async () => {
    boutonTester.disabled = true;
    try {
      await window.aura.runRule(rule.id);
      journal(`REGLE_TESTEE : ${rule.name}`);
      boutonTester.textContent = '✓';
      boutonTester.classList.add('row-test-ok');
      await new Promise((r) => setTimeout(r, 900));
      loadRules();
    } catch (err) {
      journal(`REGLE_TEST_ECHEC : ${err.message}`);
      boutonTester.textContent = '✕';
      boutonTester.classList.add('row-test-fail');
      await new Promise((r) => setTimeout(r, 1200));
      boutonTester.textContent = '▶';
      boutonTester.classList.remove('row-test-fail');
      boutonTester.disabled = false;
    }
    refreshJournalIfOpen();
  });
  row.querySelector('.row-edit').addEventListener('click', () => {
    entrerModeEdition(rule);
  });
  // Duplication (idee 6, retour utilisateur) : cree directement une
  // copie via createRule (meme validation, meme journalisation cote
  // backend que rule.create) plutot que de passer par le formulaire -
  // geste rapide, sans friction, l'original reste inchange.
  row.querySelector('.row-duplicate').addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      await window.aura.createRule({
        name: `${rule.name} (copie)`,
        enabled: rule.enabled,
        mode: rule.mode,
        trigger: rule.trigger,
        action: rule.action
      });
      journal(`REGLE_DUPLIQUEE : ${rule.name}`);
      loadRules();
    } catch (err) {
      journal(`REGLE_DUPLICATION_ECHEC : ${err.message}`);
      e.target.disabled = false;
    }
    refreshJournalIfOpen();
  });
  // Suppression a deux temps (idee 1, retour utilisateur) : premier clic
  // arme le bouton (icone + fond changent, meme geste que le reste de
  // l'app plutot qu'une boite de dialogue native hors theme), le
  // deuxieme clic dans les 3s confirme reellement. Seul geste destructif
  // de la page, jusqu'ici sans aucun garde-fou.
  const boutonSupprimer = row.querySelector('.row-delete');
  let minuteurConfirmation = null;
  const desarmer = () => {
    clearTimeout(minuteurConfirmation);
    minuteurConfirmation = null;
    boutonSupprimer.classList.remove('confirm-armed');
    boutonSupprimer.textContent = '✕';
    boutonSupprimer.title = 'Supprimer';
  };
  boutonSupprimer.addEventListener('click', async () => {
    if (!minuteurConfirmation) {
      boutonSupprimer.classList.add('confirm-armed');
      boutonSupprimer.textContent = '✓';
      boutonSupprimer.title = 'Cliquer à nouveau pour confirmer la suppression';
      minuteurConfirmation = setTimeout(desarmer, 3000);
      return;
    }
    desarmer();
    await window.aura.deleteRule(rule.id);
    journal(`REGLE_SUPPRIMEE : ${rule.name}`);
    // Si la regle supprimee est celle en cours de modification, le
    // formulaire restait bloque en mode edition ("Modifier « ... »",
    // bouton "Enregistrer") pour une regle qui n'existe plus - un
    // "Enregistrer" ulterieur aurait echoue avec "Regle introuvable.".
    if (regleEnEdition === rule.id) sortirModeEdition();
    loadRules();
    refreshJournalIfOpen();
  });
  return row;
}

function actualiserHorodatageAutonomy() {
  const el = document.getElementById('autonomy-updated');
  if (el) el.textContent = new Date().toLocaleTimeString('fr-FR');
}

// Filtre par statut (idee 5, retour utilisateur) : purement local, sur
// la derniere liste recuperee - pas besoin de rappeler l'API a chaque
// clic sur Toutes/Actives/Inactives (voir wireAutonomyRuleFilter).
let dernieresRegles = [];
let filtreRegles = 'toutes';

function renderRules(rules) {
  dernieresRegles = rules;
  const list = document.getElementById('autonomy-rules-list');
  const filtrees = rules.filter((r) => {
    if (filtreRegles === 'actives') return r.enabled;
    if (filtreRegles === 'inactives') return !r.enabled;
    return true;
  });
  if (!filtrees.length) {
    list.innerHTML = `<p class="rule-empty">${rules.length ? 'Aucune règle ne correspond au filtre.' : 'Aucune règle pour le moment.'}</p>`;
  } else {
    list.innerHTML = '';
    filtrees.forEach((rule) => list.appendChild(construireLigneRegle(rule)));
  }
  actualiserHorodatageAutonomy();
}

function wireAutonomyRuleFilter() {
  document.getElementById('autonomy-rule-filter').addEventListener('click', (e) => {
    const btn = e.target.closest('.filter-btn');
    if (!btn) return;
    document.querySelectorAll('#autonomy-rule-filter .filter-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    filtreRegles = btn.dataset.filtre;
    renderRules(dernieresRegles);
  });
}

async function loadRules() {
  try {
    renderRules(await window.aura.getRules());
  } catch {
    document.getElementById('autonomy-rules-list').textContent = 'Règles indisponibles.';
  }
}

// Affiche uniquement les champs pertinents pour le type choisi (§5.9) -
// les trois types de declencheur/action partagent le meme formulaire,
// mais leurs parametres sont disjoints (minutes / heure / metrique+
// operateur+valeur, message / titre / aucun).
function wireChampsConditionnels(select, groupes) {
  const appliquer = () => {
    Object.entries(groupes).forEach(([valeur, id]) => {
      document.getElementById(id).hidden = valeur !== select.value;
    });
  };
  select.addEventListener('change', appliquer);
  appliquer();
}

// Bandeau d'alerte (§16, idee 2) : l'unique case a cocher est facile a
// manquer, surtout au retour sur la page - affiche/masque un bandeau
// explicite en plus, sur le meme etat.
function actualiserBanniereEstop(active) {
  const banner = document.getElementById('autonomy-estop-banner');
  if (banner) banner.hidden = !active;
}

// Recharge l'etat reel de l'arret d'urgence (plutot que de se fier au
// dernier clic local) : appelee au chargement initial et a chaque
// reouverture de la page, au cas ou tick() ou une autre voie l'aurait
// change entre-temps.
async function chargerEstop() {
  try {
    const { active } = await window.aura.getEstop();
    // toggle.checked represente "regles actives" (§16), l'inverse de
    // l'estop.active retourne par l'API (actif = regles bloquees).
    document.getElementById('autonomy-estop-toggle').checked = !active;
    actualiserBanniereEstop(active);
  } catch { /* API locale indisponible */ }
}

function wireAutonomyEstop() {
  const toggle = document.getElementById('autonomy-estop-toggle');
  chargerEstop();
  toggle.addEventListener('change', async () => {
    const actif = toggle.checked;
    try {
      await window.aura.setEstop(!actif);
      actualiserBanniereEstop(!actif);
      journal(`AUTONOMY_ESTOP : ${actif ? 'règles réactivées' : 'arrêt d’urgence activé'}`);
    } catch (err) {
      toggle.checked = !actif;
      journal(`AUTONOMY_ESTOP_ECHEC : ${err.message}`);
    }
    refreshJournalIfOpen();
  });
}

// Regle en cours de modification (idee 4, retour utilisateur), ou null
// en mode creation normal - voir entrerModeEdition/sortirModeEdition.
let regleEnEdition = null;

// Remplit le formulaire depuis une regle existante (mode edition) -
// dispatch les evenements change des deux selects pour que
// wireChampsConditionnels revele les bons groupes de champs.
function remplirFormulaireRegle(rule) {
  document.getElementById('autonomy-rule-name').value = rule.name;

  const triggerSelect = document.getElementById('autonomy-rule-trigger-type');
  triggerSelect.value = rule.trigger.type;
  triggerSelect.dispatchEvent(new Event('change'));
  if (rule.trigger.type === 'interval') {
    document.getElementById('autonomy-trigger-minutes').value = rule.trigger.minutes;
  } else if (rule.trigger.type === 'daily') {
    document.getElementById('autonomy-trigger-time').value = rule.trigger.time;
  } else {
    document.getElementById('autonomy-trigger-metric').value = rule.trigger.metric;
    document.getElementById('autonomy-trigger-operator').value = rule.trigger.operator;
    document.getElementById('autonomy-trigger-value').value = rule.trigger.value;
  }

  const actionSelect = document.getElementById('autonomy-rule-action-type');
  actionSelect.value = rule.action.type;
  actionSelect.dispatchEvent(new Event('change'));
  const params = rule.action.params || {};
  if (rule.action.type === 'notify') {
    document.getElementById('autonomy-action-message').value = params.message || '';
  } else if (rule.action.type === 'task.create') {
    document.getElementById('autonomy-action-title').value = params.title || '';
  } else if (rule.action.type === 'security.scan') {
    document.getElementById('autonomy-action-security-path').value = params.path || '';
  } else if (rule.action.type === 'security.audit_deps') {
    document.getElementById('autonomy-action-audit-path').value = params.path || '';
    document.getElementById('autonomy-action-audit-gravite').value = params.graviteMin || 'low';
  }

  document.getElementById('autonomy-rule-simulation').checked = rule.mode === 'simulation';
  actualiserApercuRegle();
}

// Vide le formulaire et revele a nouveau les bons groupes de champs
// (form.reset() seul ne suffit pas : les attributs hidden poses par
// wireChampsConditionnels restent sur leur dernier etat tant que les
// selects ne redeclenchent pas 'change').
function reinitialiserFormulaireRegle() {
  document.getElementById('autonomy-rule-form').reset();
  document.getElementById('autonomy-rule-trigger-type').dispatchEvent(new Event('change'));
  document.getElementById('autonomy-rule-action-type').dispatchEvent(new Event('change'));
  actualiserApercuRegle();
}

function entrerModeEdition(rule) {
  regleEnEdition = rule.id;
  remplirFormulaireRegle(rule);
  document.getElementById('autonomy-form-titre').textContent = `Modifier « ${rule.name} »`;
  document.getElementById('autonomy-rule-submit').textContent = 'Enregistrer';
  document.getElementById('autonomy-rule-cancel').hidden = false;
  document.getElementById('autonomy-rule-name').focus();
}

function sortirModeEdition() {
  regleEnEdition = null;
  document.getElementById('autonomy-form-titre').textContent = 'Nouvelle règle';
  document.getElementById('autonomy-rule-submit').textContent = 'Créer';
  document.getElementById('autonomy-rule-cancel').hidden = true;
  reinitialiserFormulaireRegle();
}

function wireFormulaireRegle() {
  document.getElementById('autonomy-rule-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const nomInput = document.getElementById('autonomy-rule-name');
    const name = nomInput.value.trim();
    if (!name) return;

    const trigger = lireTriggerFormulaire();
    const action = lireActionFormulaire();
    const mode = document.getElementById('autonomy-rule-simulation').checked ? 'simulation' : 'live';

    try {
      if (regleEnEdition) {
        await window.aura.updateRule(regleEnEdition, { name, mode, trigger, action });
        journal(`REGLE_MODIFIEE : ${name}`);
        sortirModeEdition();
      } else {
        await window.aura.createRule({ name, enabled: true, mode, trigger, action });
        nomInput.value = '';
        document.getElementById('autonomy-action-message').value = '';
        document.getElementById('autonomy-action-title').value = '';
        journal(`REGLE_CREEE : ${name}`);
        actualiserApercuRegle();
      }
      loadRules();
    } catch (err) {
      journal(`REGLE_${regleEnEdition ? 'MODIFICATION' : 'CREATION'}_ECHEC : ${err.message}`);
    }
    refreshJournalIfOpen();
  });

  document.getElementById('autonomy-rule-cancel').addEventListener('click', sortirModeEdition);

  // Apercu en direct (idee 2, retour utilisateur) : delegation sur le
  // formulaire entier plutot que de cabler chaque champ individuellement
  // - couvre aussi les groupes conditionnels (declencheur/action) sans
  // ecouteur supplementaire.
  const form = document.getElementById('autonomy-rule-form');
  form.addEventListener('input', actualiserApercuRegle);
  form.addEventListener('change', actualiserApercuRegle);
}

function wireAutonomyPage() {
  document.getElementById('autonomy-back').addEventListener('click', fermerPage);
  wireAutonomyEstop();
  wireChampsConditionnels(document.getElementById('autonomy-rule-trigger-type'), {
    interval: 'autonomy-trigger-interval',
    daily: 'autonomy-trigger-daily',
    threshold: 'autonomy-trigger-threshold'
  });
  wireChampsConditionnels(document.getElementById('autonomy-rule-action-type'), {
    notify: 'autonomy-action-notify',
    'task.create': 'autonomy-action-task',
    'security.scan': 'autonomy-action-security',
    'security.audit_deps': 'autonomy-action-audit'
  });
  document.getElementById('autonomy-action-security-browse').addEventListener('click', async () => {
    try {
      const dossier = await window.aura.chooseFolder();
      if (dossier) {
        document.getElementById('autonomy-action-security-path').value = dossier;
        actualiserApercuRegle();
      }
    } catch { /* dialogue annule/echoue - champ inchange */ }
  });
  document.getElementById('autonomy-action-audit-browse').addEventListener('click', async () => {
    try {
      const dossier = await window.aura.chooseFolder();
      if (dossier) {
        document.getElementById('autonomy-action-audit-path').value = dossier;
        actualiserApercuRegle();
      }
    } catch { /* dialogue annule/echoue - champ inchange */ }
  });
  wireFormulaireRegle();
  wireAutonomyRuleFilter();
  actualiserApercuRegle();
}

// --- Page AURA SECURITY (§5) --------------------------------------------
// Analyse en lecture seule d'un dossier choisi par l'utilisateur : secrets
// en clair et dependances vulnerables (voir security.js). Pas d'etat a
// charger a l'ouverture (contrairement aux autres pages) - tout part d'un
// dossier que l'utilisateur choisit lui-meme, rien a afficher avant ca.

const SEVERITE_LABELS = { critical: 'critique', high: 'élevée', moderate: 'modérée', low: 'faible', info: 'info' };

// Dossier de la derniere analyse de secrets (idee 3, retour utilisateur) :
// les resultats n'ont que des chemins relatifs (security.js#scanSecrets) -
// il faut se souvenir de la racine pour pouvoir recomposer un chemin
// absolu au clic sur "localiser", meme si le champ dossier a change
// entre-temps (nouvelle saisie sans relancer l'analyse).
let dernierDossierSecrets = null;

// Derniers resultats complets de chaque outil (idee 4, export) - permet
// de composer un rapport meme si un seul des deux a ete lance, sans
// devoir tout relancer juste pour l'exporter.
let dernierResultatSecrets = null;
let dernierResultatDeps = null;

function actualiserHorodatageSecurity() {
  const el = document.getElementById('security-updated');
  if (el) el.textContent = new Date().toLocaleTimeString('fr-FR');
}

// Nom court d'un dossier (idee 1) - juste le dernier segment du chemin,
// le chemin complet reste consultable via l'attribut title du jeton.
function nomDossierCourt(chemin) {
  const segments = chemin.replace(/[\\/]+$/, '').split(/[\\/]/);
  return segments[segments.length - 1] || chemin;
}

// Apercu multi-dossiers (idee "apercu dossiers recents", retour
// utilisateur) : un badge par outil sur chaque jeton, tire du dernier scan
// connu de ce dossier (aucune analyse relancee - voir security.js#
// getRecentFoldersResume). Absent (null, jamais scanne avec cet outil) ->
// pas de badge du tout, plutot qu'un "0" qui laisserait croire a un scan
// propre.
function renderRecentFolders(resumes) {
  const zone = document.getElementById('security-recent-folders');
  zone.innerHTML = resumes.map(({ dossier, secrets, deps }) => `
    <button type="button" class="security-recent-chip" title="${echapperHtml(dossier)}">
      ${echapperHtml(nomDossierCourt(dossier))}
      ${secrets ? `<span class="security-recent-badge security-recent-badge-secrets" title="${secrets} résultat(s) de secrets au dernier scan">${secrets}</span>` : ''}
      ${deps ? `<span class="security-recent-badge security-recent-badge-deps" title="${deps} vulnérabilité(s) au dernier audit">${deps}</span>` : ''}
    </button>
  `).join('');
}

async function chargerDossiersRecents() {
  try {
    renderRecentFolders(await window.aura.getRecentFoldersResume());
  } catch { /* API locale indisponible - la liste reste vide, sans consequence */ }
}

// Filtres (idee 2, retour utilisateur) : etat courant + derniers
// resultats bruts, pour re-rendre localement au clic sur un filtre sans
// relancer une analyse. Un seul type/gravite ne vaut pas la peine d'un
// filtre - les boutons ne sont generes que si au moins deux valeurs
// distinctes sont presentes (voir renderSecretsResults/renderDepsResults).
let filtreSecretsMotif = 'toutes';
let filtreDepsGravite = 'toutes';

// Recherche textuelle (idee "recherche", retour utilisateur) : un seul
// champ pour les deux cartes, combine (ET logique) avec le filtre de
// categorie deja en place - re-rend localement depuis les derniers
// resultats bruts, comme les filtres.
let termeRecherche = '';

// Resume nouveaux/resolus (idee "comparaison", retour utilisateur) :
// absent au tout premier scan d'un dossier (rien a comparer) - dans ce
// cas premierScan vaut true et aucune ligne n'est marquee "Nouveau".
function ligneComparaison(premierScan, nouveaux, resolus) {
  if (premierScan) return '';
  return `<p class="security-diff-summary">${nouveaux} nouveau(x) · ${resolus} résolu(s) depuis le dernier scan</p>`;
}

// Filtrage (categorie + recherche textuelle) factorise hors des fonctions
// de rendu (idee "export filtré", retour utilisateur) - construireRapportSecurite
// doit appliquer exactement la meme logique que l'affichage, sans la dupliquer.
function filtrerResultatsSecrets(resultats) {
  const parFiltre = filtreSecretsMotif === 'toutes' ? resultats : resultats.filter((r) => r.motif === filtreSecretsMotif);
  const terme = termeRecherche.toLowerCase();
  return !terme ? parFiltre : parFiltre.filter((r) =>
    r.fichier.toLowerCase().includes(terme) || r.motif.toLowerCase().includes(terme) || r.extrait.toLowerCase().includes(terme)
  );
}

function filtrerPaquetsDeps(paquets) {
  const parFiltre = filtreDepsGravite === 'toutes' ? paquets : paquets.filter((p) => p.gravite === filtreDepsGravite);
  const terme = termeRecherche.toLowerCase();
  return !terme ? parFiltre : parFiltre.filter((p) => p.nom.toLowerCase().includes(terme));
}

function renderSecretsResults({ fichiersAnalyses, resultats, tronque, ignoresAppliques, premierScan, nouveaux, resolus }) {
  const zone = document.getElementById('security-secrets-results');
  const zoneFiltres = document.getElementById('security-secrets-filters');

  const motifs = [...new Set(resultats.map((r) => r.motif))];
  if (!filtreSecretsMotif || (filtreSecretsMotif !== 'toutes' && !motifs.includes(filtreSecretsMotif))) filtreSecretsMotif = 'toutes';
  zoneFiltres.innerHTML = motifs.length < 2 ? '' : ['toutes', ...motifs].map((m) =>
    `<button type="button" class="filter-btn${m === filtreSecretsMotif ? ' active' : ''}" data-motif="${echapperHtml(m)}">${m === 'toutes' ? 'Toutes' : echapperHtml(m)}</button>`
  ).join('');

  if (!resultats.length) {
    zone.innerHTML = `<p class="rule-empty">Aucun secret détecté sur ${fichiersAnalyses} fichier(s) analysé(s).</p>`;
    return;
  }
  const filtres = filtrerResultatsSecrets(resultats);

  const avertissements = [ligneComparaison(premierScan, nouveaux, resolus)];
  if (tronque) avertissements.push('<p class="rule-empty">Dossier volumineux : analyse partielle (limite de fichiers atteinte).</p>');
  if (ignoresAppliques) {
    avertissements.push(`<p class="rule-empty">${ignoresAppliques} résultat(s) marqué(s) faux positif masqué(s) — <button type="button" id="security-reset-ignores" class="security-link-btn">réinitialiser</button></p>`);
  }
  if (!filtres.length) {
    zone.innerHTML = avertissements.join('') + '<p class="rule-empty">Aucun résultat pour ces critères.</p>';
    return;
  }

  zone.innerHTML = avertissements.join('') + filtres.map((r) => `
    <div class="security-finding">
      <div class="security-finding-header">
        <button type="button" class="security-finding-file" data-fichier="${echapperHtml(r.fichier)}" title="Localiser dans l’explorateur">${echapperHtml(r.fichier)}:${r.ligne}</button>
        <span class="security-finding-badges">
          ${r.nouveau ? '<span class="security-badge security-badge-nouveau">Nouveau</span>' : ''}
          <span class="security-badge security-sev-critical">${echapperHtml(r.motif)}</span>
        </span>
      </div>
      <div class="security-finding-snippet">${echapperHtml(r.extrait)}</div>
      <div class="security-finding-actions">
        <button type="button" class="security-link-btn security-copy-btn" data-fichier="${echapperHtml(r.fichier)}">Copier le chemin</button>
        <button type="button" class="security-link-btn security-ignore-btn" data-fichier="${echapperHtml(r.fichier)}" data-ligne="${r.ligne}" data-motif="${echapperHtml(r.motif)}">Ignorer (faux positif)</button>
      </div>
    </div>
  `).join('');
}

function renderDepsResults({ resume, paquets, ignoresAppliques, premierScan, nouveaux, resolus }) {
  const zone = document.getElementById('security-deps-results');
  const zoneFiltres = document.getElementById('security-deps-filters');

  const gravites = [...new Set(paquets.map((p) => p.gravite))];
  if (!filtreDepsGravite || (filtreDepsGravite !== 'toutes' && !gravites.includes(filtreDepsGravite))) filtreDepsGravite = 'toutes';
  zoneFiltres.innerHTML = gravites.length < 2 ? '' : ['toutes', ...gravites].map((g) =>
    `<button type="button" class="filter-btn${g === filtreDepsGravite ? ' active' : ''}" data-gravite="${g}">${g === 'toutes' ? 'Toutes' : (SEVERITE_LABELS[g] || g)}</button>`
  ).join('');

  if (!resume.total) {
    zone.innerHTML = '<p class="rule-empty">Aucune vulnérabilité connue détectée.</p>';
    return;
  }
  // 'info' inclus : sans lui, un audit ne comportant que des
  // vulnerabilites de gravite info (resume.total > 0 malgre tout)
  // affichait un bandeau de resume completement vide, alors que la
  // liste des paquets en dessous les montrait bien.
  const puces = ['critical', 'high', 'moderate', 'low', 'info'].filter((s) => resume[s]).map((s) =>
    `<span class="security-badge security-sev-${s}">${resume[s]} ${SEVERITE_LABELS[s]}</span>`
  ).join('');

  const filtres = filtrerPaquetsDeps(paquets);

  const avertissements = [ligneComparaison(premierScan, nouveaux, resolus)];
  if (ignoresAppliques) {
    avertissements.push(`<p class="rule-empty">${ignoresAppliques} résultat(s) marqué(s) faux positif masqué(s) — <button type="button" id="security-reset-ignores-deps" class="security-link-btn">réinitialiser</button></p>`);
  }
  if (!filtres.length) {
    zone.innerHTML = `${avertissements.join('')}<div class="security-summary">${puces}</div><p class="rule-empty">Aucun résultat pour ces critères.</p>`;
    return;
  }

  // "Tout corriger" (idee "tout corriger") : uniquement affiche quand au
  // moins deux correctifs precis distincts existent - avec un seul, le
  // bouton "Corriger" de la ligne elle-meme suffit deja (meme logique que
  // les filtres, generes seulement si au moins deux valeurs distinctes).
  const paquetsCorrectifPrecis = paquets.filter((p) => p.correctif && p.correctif.includes('@'));
  const correctifsUniques = [...new Set(paquetsCorrectifPrecis.map((p) => p.correctif))];
  // Avertissement mise a jour majeure (idee "avertir avant une mise a jour
  // majeure") : npm signale isSemVerMajor quand le correctif saute une
  // version majeure - potentiellement incompatible avec le code existant.
  const contientMajeur = paquetsCorrectifPrecis.some((p) => p.correctifMajeur);
  const boutonToutCorriger = correctifsUniques.length > 1
    ? `<button type="button" id="security-fix-all" class="security-fix-btn" title="Installe les ${correctifsUniques.length} correctif(s) disponibles dans le dossier analysé${contientMajeur ? ' - au moins un correctif implique une mise à jour majeure' : ''}">Tout corriger (${correctifsUniques.length})${contientMajeur ? ' ⚠' : ''}</button>`
    : '';

  // Correctif generique (idee "correctif generique") : "npm audit fix" est
  // une seule commande qui corrige d'un coup toutes les vulnerabilites
  // sans version precise proposee - affiche une fois au niveau de la
  // carte, pas ligne par ligne (contrairement a "Corriger" ci-dessous).
  const aCorrectifGenerique = paquets.some((p) => p.correctif === 'npm audit fix');
  const boutonGenerique = aCorrectifGenerique
    ? '<button type="button" id="security-fix-generic" class="security-fix-btn" title="Lance npm audit fix - corrige automatiquement les vulnérabilités sans version précise proposée">Corriger automatiquement</button>'
    : '';

  // Bouton "Corriger" (idee 5) uniquement quand le correctif est une
  // specification precise ("paquet@version", produite par npm audit lui-
  // meme) - le cas generique ("npm audit fix", fixAvailable:true sans
  // nom/version precis) est couvert par le bouton "Corriger automatiquement"
  // ci-dessus, pas ligne par ligne.
  const liste = filtres.map((p) => `
    <div class="security-finding">
      <div class="security-finding-header">
        <span class="security-finding-file">${echapperHtml(p.nom)}</span>
        <span class="security-finding-badges">
          ${p.nouveau ? '<span class="security-badge security-badge-nouveau">Nouveau</span>' : ''}
          <span class="security-badge security-sev-${p.gravite}">${SEVERITE_LABELS[p.gravite] || echapperHtml(p.gravite)}</span>
        </span>
      </div>
      <div class="security-finding-snippet">${p.correctif ? `Correctif : ${echapperHtml(p.correctif)}${p.correctifMajeur ? ' <span class="security-correctif-majeur" title="Mise à jour majeure : peut casser des fonctionnalités existantes">⚠ majeur</span>' : ''}` : 'Pas de correctif automatique disponible.'}</div>
      <div class="security-finding-actions">
        ${p.avisUrl ? `<button type="button" class="security-link-btn security-advisory-btn" data-url="${echapperHtml(p.avisUrl)}">Voir l’avis${p.avisTitre ? ` (${echapperHtml(p.avisTitre)})` : ''}</button>` : ''}
        <button type="button" class="security-link-btn security-ignore-dep-btn" data-nom="${echapperHtml(p.nom)}" data-gravite="${echapperHtml(p.gravite)}">Ignorer (faux positif)</button>
        ${p.correctif && p.correctif.includes('@') ? `<button type="button" class="security-fix-btn" data-correctif="${echapperHtml(p.correctif)}" data-nom="${echapperHtml(p.nom)}" title="Installe ${echapperHtml(p.correctif)} dans le dossier analysé${p.correctifMajeur ? ' - mise à jour majeure, risque de rupture' : ''}">Corriger</button>` : ''}
      </div>
    </div>
  `).join('');
  zone.innerHTML = `${avertissements.join('')}<div class="security-summary">${puces}${boutonToutCorriger}${boutonGenerique}</div>${liste}`;
}

// Scan de l'historique Git (idee "scanner l'historique Git", retour
// utilisateur) - meme gabarit visuel que les trouvailles du scan normal
// (.security-finding), mais sans actions "localiser"/"ignorer" : le
// fichier peut avoir change de contenu ou disparu depuis ce commit, une
// action dessus n'aurait pas de sens fiable.
const MAX_COMMITS_HISTORIQUE = 200; // affichage seulement - doit rester coherent avec security.js#MAX_COMMITS_HISTORIQUE

function renderGitHistoryResults({ resultats, tronque }) {
  const zone = document.getElementById('security-git-history-results');
  const entete = `<p class="security-diff-summary">Historique Git : ${resultats.length} résultat(s)${tronque ? ' (limite atteinte)' : ''} sur les ${MAX_COMMITS_HISTORIQUE} derniers commits</p>`;
  if (!resultats.length) {
    zone.innerHTML = `${entete}<p class="rule-empty">Aucun secret détecté dans les commits passés.</p>`;
    return;
  }
  zone.innerHTML = entete + resultats.map((r) => `
    <div class="security-finding">
      <div class="security-finding-header">
        <span class="security-finding-file" title="${echapperHtml(r.fichier)}">${echapperHtml(r.commit)} · ${echapperHtml(r.fichier)}</span>
        <span class="security-finding-badges"><span class="security-badge security-sev-critical">${echapperHtml(r.motif)}</span></span>
      </div>
      <div class="security-finding-snippet">${r.message ? `${echapperHtml(r.message)}<br>` : ''}${echapperHtml(r.extrait)}</div>
    </div>
  `).join('');
}

// Tendance dans le temps (idee "tendance", retour utilisateur) - un
// sparkline SVG minimal, construit a partir des memes entrees d'historique
// que la liste ci-dessous, sans stockage dedie. Trace en polyline (pas de
// bibliotheque de graphiques) : quelques points suffisent, pas besoin
// d'axes/legendes pour "est-ce que ca s'ameliore ou pas" en un coup d'oeil.
function construireSparkline(valeurs, classeCouleur) {
  const largeur = 160;
  const hauteur = 32;
  const marge = 3;
  const max = Math.max(...valeurs, 1);
  const min = Math.min(...valeurs, 0);
  const echelle = max === min ? 0 : (hauteur - marge * 2) / (max - min);
  const pas = (largeur - marge * 2) / (valeurs.length - 1);
  const coord = (v, i) => [marge + i * pas, hauteur - marge - (v - min) * echelle];
  const points = valeurs.map((v, i) => coord(v, i).map((n) => n.toFixed(1)).join(',')).join(' ');
  const [dernierX, dernierY] = coord(valeurs[valeurs.length - 1], valeurs.length - 1);
  return `<svg viewBox="0 0 ${largeur} ${hauteur}" class="security-sparkline ${classeCouleur}" preserveAspectRatio="none">
    <polyline points="${points}" />
    <circle cx="${dernierX.toFixed(1)}" cy="${dernierY.toFixed(1)}" r="2.5" />
  </svg>`;
}

// N=8 scans les plus recents du dossier courant - au-dela, le sparkline
// devient illisible (trop de points serres) sans apporter d'information
// supplementaire utile a "la tendance recente".
const TENDANCE_MAX_POINTS = 8;

function renderTendanceSecurity(entries) {
  const zone = document.getElementById('security-trend');
  if (!zone) return;
  const dossier = document.getElementById('security-path').value.trim();
  if (!dossier) { zone.innerHTML = ''; return; }

  const valeursPour = (typeAction, extraireValeur) => entries
    .filter((e) => e.statut === 'execute' && e.typeAction === typeAction && e.details && e.details.dossier === dossier)
    .slice(0, TENDANCE_MAX_POINTS)
    .reverse()
    .map(extraireValeur);

  const secretsVals = valeursPour('security.scan_secrets', (e) => e.details.trouvailles || 0);
  const depsVals = valeursPour('security.audit_deps', (e) => e.details.total || 0);

  const morceaux = [];
  if (secretsVals.length >= 2) {
    morceaux.push(`<div class="security-trend-item">
      <span class="security-trend-label">Secrets</span>
      ${construireSparkline(secretsVals, 'security-sparkline-secrets')}
      <span class="security-trend-value">${secretsVals[secretsVals.length - 1]}</span>
    </div>`);
  }
  if (depsVals.length >= 2) {
    morceaux.push(`<div class="security-trend-item">
      <span class="security-trend-label">Dépendances</span>
      ${construireSparkline(depsVals, 'security-sparkline-deps')}
      <span class="security-trend-value">${depsVals[depsVals.length - 1]}</span>
    </div>`);
  }
  zone.innerHTML = morceaux.join('');
}

// Historique recent (idee 5) - reutilise le journal existant
// (security.js#getHistory), pas de stockage dedie.
async function chargerHistoriqueSecurity() {
  const zone = document.getElementById('security-history');
  try {
    const entries = await window.aura.getSecurityHistory();
    renderTendanceSecurity(entries);
    if (!entries.length) { zone.innerHTML = 'Aucune analyse effectuée.'; return; }
    zone.innerHTML = entries.slice(0, 15).map((e) => `
      <div class="security-history-entry${e.statut === 'echoue' ? ' security-history-entry-echec' : ''}">
        <span class="security-history-time">${formatDerniereExecution(e.date)}</span>
        <span class="security-history-message">${echapperHtml(formatJournalMessage(e))}</span>
      </div>
    `).join('');
  } catch {
    zone.innerHTML = 'Historique indisponible.';
  }
}

// Factorisees hors des ecouteurs de clic (idee 2, retour utilisateur) :
// "Tout analyser" appelle les deux exactement comme les boutons
// individuels, sans dupliquer la logique de recuperation/rendu/journal.
async function lancerScanSecrets() {
  const chemin = document.getElementById('security-path').value.trim();
  const zone = document.getElementById('security-secrets-results');
  if (!chemin) { zone.innerHTML = '<p class="rule-empty">Choisissez d’abord un dossier.</p>'; return; }
  zone.innerHTML = '<p class="rule-empty">Analyse en cours…</p>';
  try {
    const resultat = await window.aura.scanSecrets(chemin);
    dernierDossierSecrets = chemin;
    dernierResultatSecrets = { dossier: chemin, ...resultat };
    renderSecretsResults(resultat);
    journal(`SECURITY_SCAN_SECRETS : ${resultat.resultats.length} trouvaille(s) sur ${resultat.fichiersAnalyses} fichier(s)`);
    actualiserHorodatageSecurity();
    chargerDossiersRecents();
    chargerHistoriqueSecurity();
  } catch (err) {
    zone.innerHTML = `<p class="rule-empty">${echapperHtml(err.message)}</p>`;
    journal(`SECURITY_SCAN_SECRETS_ECHEC : ${err.message}`);
  }
  refreshJournalIfOpen();
}

async function lancerAuditDeps() {
  const chemin = document.getElementById('security-path').value.trim();
  const zone = document.getElementById('security-deps-results');
  if (!chemin) { zone.innerHTML = '<p class="rule-empty">Choisissez d’abord un dossier.</p>'; return; }
  zone.innerHTML = '<p class="rule-empty">Audit en cours…</p>';
  try {
    const resultat = await window.aura.auditDependencies(chemin);
    dernierResultatDeps = { dossier: chemin, ...resultat };
    renderDepsResults(resultat);
    journal(`SECURITY_AUDIT_DEPS : ${resultat.paquets.length} paquet(s) concerné(s)`);
    actualiserHorodatageSecurity();
    chargerDossiersRecents();
    chargerHistoriqueSecurity();
  } catch (err) {
    zone.innerHTML = `<p class="rule-empty">${echapperHtml(err.message)}</p>`;
    journal(`SECURITY_AUDIT_DEPS_ECHEC : ${err.message}`);
  }
  refreshJournalIfOpen();
}

// Rapport texte combinant les deux derniers resultats (idee 4) - simple
// concatenation lisible, pas de format machine (JSON) : pense pour etre
// relu/partage tel quel, pas reimporte dans l'app.
function construireRapportSecurite() {
  // Export filtré (idee "export filtré", retour utilisateur) - respecte la
  // recherche/les filtres de gravite actuellement affiches a l'ecran plutot
  // que de toujours tout exporter en bloc : sans filtre actif, le
  // comportement reste identique a avant (tout exporte).
  const filtresActifs = !!termeRecherche || filtreSecretsMotif !== 'toutes' || filtreDepsGravite !== 'toutes';
  const lignes = [
    'Rapport de sécurité AURA',
    `Généré le ${new Date().toLocaleString('fr-FR')}`
  ];
  if (filtresActifs) {
    const details = [];
    if (termeRecherche) details.push(`recherche « ${termeRecherche} »`);
    if (filtreSecretsMotif !== 'toutes') details.push(`motif secrets « ${filtreSecretsMotif} »`);
    if (filtreDepsGravite !== 'toutes') details.push(`gravité dépendances « ${SEVERITE_LABELS[filtreDepsGravite] || filtreDepsGravite} »`);
    lignes.push(`Filtré par : ${details.join(', ')}`);
  }
  lignes.push('', '=== Secrets ===');
  if (!dernierResultatSecrets) {
    lignes.push('Aucune analyse effectuée.');
  } else {
    const resultats = filtrerResultatsSecrets(dernierResultatSecrets.resultats);
    lignes.push(`Dossier : ${dernierResultatSecrets.dossier}`);
    lignes.push(`${dernierResultatSecrets.fichiersAnalyses} fichier(s) analysé(s), ${resultats.length} trouvaille(s)${filtresActifs ? ` (sur ${dernierResultatSecrets.resultats.length} au total)` : ''}`);
    resultats.forEach((r) => {
      lignes.push(`- ${r.fichier}:${r.ligne} [${r.motif}] ${r.extrait}`);
    });
  }
  lignes.push('', '=== Dépendances ===');
  if (!dernierResultatDeps) {
    lignes.push('Aucune analyse effectuée.');
  } else {
    const paquets = filtrerPaquetsDeps(dernierResultatDeps.paquets);
    lignes.push(`Dossier : ${dernierResultatDeps.dossier}`);
    lignes.push(`${paquets.length} vulnérabilité(s)${filtresActifs ? ` (sur ${dernierResultatDeps.resume.total || 0} au total)` : ''}`);
    paquets.forEach((p) => {
      lignes.push(`- ${p.nom} [${SEVERITE_LABELS[p.gravite] || p.gravite}] ${p.correctif ? `Correctif : ${p.correctif}` : 'Pas de correctif automatique disponible.'}`);
    });
  }
  return lignes.join('\n');
}

// Exclusions personnalisees (idee "exclure", retour utilisateur) : scope
// par dossier, comme les faux positifs - lues/ecrites contre le champ
// #security-path courant (pas dernierDossierSecrets), une exclusion se
// configure avant de lancer une analyse, pas seulement apres.
async function chargerExclusions(dossier) {
  const zone = document.getElementById('security-exclusions-list');
  if (!dossier) { zone.innerHTML = ''; return; }
  try {
    const motifs = await window.aura.getExclusions(dossier);
    zone.innerHTML = motifs.map((m) => `
      <span class="security-exclusion-chip">${echapperHtml(m)}<button type="button" class="security-exclusion-remove" data-motif="${echapperHtml(m)}" aria-label="Retirer l’exclusion ${echapperHtml(m)}">×</button></span>
    `).join('');
  } catch {
    zone.innerHTML = '';
  }
}

// Motifs de secrets personnalises (idee "motifs personnalises", retour
// utilisateur) - meme principe/gabarit que chargerExclusions ci-dessus.
async function chargerMotifsSecret(dossier) {
  const zone = document.getElementById('security-motifs-list');
  if (!zone) return;
  if (!dossier) { zone.innerHTML = ''; return; }
  try {
    const motifs = await window.aura.getSecretMotifs(dossier);
    zone.innerHTML = motifs.map((m) => `
      <span class="security-exclusion-chip">${echapperHtml(m)}<button type="button" class="security-motif-remove" data-motif="${echapperHtml(m)}" aria-label="Retirer le motif ${echapperHtml(m)}">×</button></span>
    `).join('');
  } catch {
    zone.innerHTML = '';
  }
}

function wireSecurityPage() {
  document.getElementById('security-back').addEventListener('click', fermerPage);

  document.getElementById('security-browse').addEventListener('click', async () => {
    try {
      const dossier = await window.aura.chooseFolder();
      if (dossier) {
        document.getElementById('security-path').value = dossier;
        chargerExclusions(dossier);
        chargerMotifsSecret(dossier);
        chargerHistoriqueSecurity();
      }
    } catch (err) {
      journal(`SECURITY_PARCOURIR_ECHEC : ${err.message}`);
    }
  });

  // 'change' (pas 'input') : ne recharge qu'une fois la saisie terminee
  // (perte de focus/Entree), comme pour ne pas requeter a chaque frappe.
  // chargerHistoriqueSecurity() en plus des exclusions : le sparkline de
  // tendance (idee "tendance") depend du dossier courant, pas seulement
  // du dernier scan lance.
  document.getElementById('security-path').addEventListener('change', (e) => {
    chargerExclusions(e.target.value.trim());
    chargerMotifsSecret(e.target.value.trim());
    chargerHistoriqueSecurity();
  });

  document.getElementById('security-exclusion-add').addEventListener('click', async () => {
    const chemin = document.getElementById('security-path').value.trim();
    const champMotif = document.getElementById('security-exclusion-input');
    const motif = champMotif.value.trim();
    if (!chemin || !motif) return;
    try {
      await window.aura.addExclusion(chemin, motif);
      champMotif.value = '';
      journal(`SECURITY_EXCLUSION_AJOUTEE : ${motif}`);
      await chargerExclusions(chemin);
    } catch (err) {
      journal(`SECURITY_EXCLUSION_ECHEC : ${err.message}`);
    }
    refreshJournalIfOpen();
  });

  document.getElementById('security-exclusions-list').addEventListener('click', async (e) => {
    const bouton = e.target.closest('.security-exclusion-remove');
    if (!bouton) return;
    const chemin = document.getElementById('security-path').value.trim();
    if (!chemin) return;
    await window.aura.removeExclusion(chemin, bouton.dataset.motif);
    journal(`SECURITY_EXCLUSION_RETIREE : ${bouton.dataset.motif}`);
    await chargerExclusions(chemin);
    refreshJournalIfOpen();
  });

  // Recherche textuelle (idee "recherche") : re-rend localement les deux
  // cartes depuis leurs derniers resultats bruts, comme les filtres.
  document.getElementById('security-search').addEventListener('input', (e) => {
    termeRecherche = e.target.value.trim();
    if (dernierResultatSecrets) renderSecretsResults(dernierResultatSecrets);
    if (dernierResultatDeps) renderDepsResults(dernierResultatDeps);
  });

  document.getElementById('security-scan-secrets').addEventListener('click', async (e) => {
    e.target.disabled = true;
    await lancerScanSecrets();
    e.target.disabled = false;
  });

  document.getElementById('security-audit-deps').addEventListener('click', async (e) => {
    e.target.disabled = true;
    await lancerAuditDeps();
    e.target.disabled = false;
  });

  // "Tout analyser" (idee 2) : les deux boutons individuels sont aussi
  // desactives pendant l'execution combinee - sans ca, un clic dessus
  // pendant que "Tout analyser" tourne deja relancerait la meme analyse
  // en double sur la meme zone de resultat.
  document.getElementById('security-scan-all').addEventListener('click', async (e) => {
    const boutonSecrets = document.getElementById('security-scan-secrets');
    const boutonDeps = document.getElementById('security-audit-deps');
    e.target.disabled = true;
    boutonSecrets.disabled = true;
    boutonDeps.disabled = true;
    await Promise.allSettled([lancerScanSecrets(), lancerAuditDeps()]);
    e.target.disabled = false;
    boutonSecrets.disabled = false;
    boutonDeps.disabled = false;
  });

  // Localiser/copier/ignorer un resultat (idees 1 et 3) : delegation sur
  // le conteneur plutot qu'un ecouteur par ligne - renderSecretsResults()
  // remplace entierement le contenu a chaque analyse/filtre, un ecouteur
  // pose directement sur une ligne serait perdu au rendu suivant.
  document.getElementById('security-secrets-results').addEventListener('click', async (e) => {
    const boutonLocaliser = e.target.closest('.security-finding-file');
    if (boutonLocaliser) {
      if (!dernierDossierSecrets) return;
      const resultat = await window.aura.revealFile(dernierDossierSecrets, boutonLocaliser.dataset.fichier);
      if (!resultat.ok) journal(`SECURITY_LOCALISER_ECHEC : ${resultat.error}`);
      return;
    }
    const boutonCopier = e.target.closest('.security-copy-btn');
    if (boutonCopier) {
      if (!dernierDossierSecrets) return;
      await window.aura.copyToClipboard(`${dernierDossierSecrets}/${boutonCopier.dataset.fichier}`);
      journal('SECURITY_CHEMIN_COPIE');
      return;
    }
    const boutonIgnorer = e.target.closest('.security-ignore-btn');
    if (boutonIgnorer) {
      if (!dernierDossierSecrets) return;
      try {
        await window.aura.ignoreFinding(dernierDossierSecrets, boutonIgnorer.dataset.fichier, boutonIgnorer.dataset.ligne, boutonIgnorer.dataset.motif);
        journal(`SECURITY_IGNORE_AJOUTE : ${boutonIgnorer.dataset.fichier}:${boutonIgnorer.dataset.ligne}`);
        // Retire juste cette ligne plutot que de relancer un scan complet
        // - le backend ne la resurfacera plus au prochain scan de toute
        // facon (voir security.js#scanSecrets, filtre des ignores).
        boutonIgnorer.closest('.security-finding').remove();
        if (dernierResultatSecrets) {
          dernierResultatSecrets.resultats = dernierResultatSecrets.resultats.filter((r) =>
            !(r.fichier === boutonIgnorer.dataset.fichier && String(r.ligne) === boutonIgnorer.dataset.ligne && r.motif === boutonIgnorer.dataset.motif)
          );
        }
      } catch (err) {
        journal(`SECURITY_IGNORE_ECHEC : ${err.message}`);
      }
      return;
    }
    const boutonReset = e.target.closest('#security-reset-ignores');
    if (boutonReset) {
      if (!dernierDossierSecrets) return;
      try {
        await window.aura.clearIgnoredFindings(dernierDossierSecrets);
        journal('SECURITY_IGNORES_REINITIALISES');
        await lancerScanSecrets();
      } catch (err) {
        journal(`SECURITY_IGNORES_REINITIALISATION_ECHEC : ${err.message}`);
      }
    }
  });

  // Filtres (idee 2) : re-rendent localement depuis les derniers
  // resultats bruts, sans relancer d'analyse.
  document.getElementById('security-secrets-filters').addEventListener('click', (e) => {
    const bouton = e.target.closest('.filter-btn');
    if (!bouton || !dernierResultatSecrets) return;
    filtreSecretsMotif = bouton.dataset.motif;
    renderSecretsResults(dernierResultatSecrets);
  });

  document.getElementById('security-deps-filters').addEventListener('click', (e) => {
    const bouton = e.target.closest('.filter-btn');
    if (!bouton || !dernierResultatDeps) return;
    filtreDepsGravite = bouton.dataset.gravite;
    renderDepsResults(dernierResultatDeps);
  });

  // Dossiers recents (idee 1) : remplit juste le champ, comme "Parcourir…"
  // - ne relance pas d'analyse automatiquement (choix coherent avec le
  // reste de la page, ou chaque action est explicite).
  document.getElementById('security-recent-folders').addEventListener('click', (e) => {
    const puce = e.target.closest('.security-recent-chip');
    if (!puce) return;
    document.getElementById('security-path').value = puce.title;
    chargerExclusions(puce.title);
    chargerMotifsSecret(puce.title);
    chargerHistoriqueSecurity();
  });

  // Motifs de secrets personnalises (idee "motifs personnalises") - meme
  // gabarit que les exclusions ci-dessus.
  document.getElementById('security-motif-add').addEventListener('click', async () => {
    const chemin = document.getElementById('security-path').value.trim();
    const champMotif = document.getElementById('security-motif-input');
    const motif = champMotif.value.trim();
    if (!chemin || !motif) return;
    try {
      await window.aura.addSecretMotif(chemin, motif);
      champMotif.value = '';
      journal(`SECURITY_MOTIF_AJOUTE : ${motif}`);
      await chargerMotifsSecret(chemin);
    } catch (err) {
      journal(`SECURITY_MOTIF_ECHEC : ${err.message}`);
    }
    refreshJournalIfOpen();
  });

  document.getElementById('security-motifs-list').addEventListener('click', async (e) => {
    const bouton = e.target.closest('.security-motif-remove');
    if (!bouton) return;
    const chemin = document.getElementById('security-path').value.trim();
    if (!chemin) return;
    await window.aura.removeSecretMotif(chemin, bouton.dataset.motif);
    journal(`SECURITY_MOTIF_RETIRE : ${bouton.dataset.motif}`);
    await chargerMotifsSecret(chemin);
    refreshJournalIfOpen();
  });

  // Scanner l'historique Git (idee "scanner l'historique Git") - action
  // distincte du scan normal (plus lente, git log sur N commits) : jamais
  // lancee automatiquement avec "Tout analyser"/"Analyser les secrets".
  document.getElementById('security-scan-git-history').addEventListener('click', async (e) => {
    const chemin = document.getElementById('security-path').value.trim();
    const zone = document.getElementById('security-git-history-results');
    if (!chemin) { zone.innerHTML = '<p class="rule-empty">Choisissez d’abord un dossier.</p>'; return; }
    e.target.disabled = true;
    zone.innerHTML = '<p class="rule-empty">Lecture de l’historique Git en cours…</p>';
    try {
      const resultat = await window.aura.scanGitHistory(chemin);
      renderGitHistoryResults(resultat, chemin);
      journal(`SECURITY_SCAN_GIT_HISTORY : ${resultat.resultats.length} résultat(s)`);
      chargerHistoriqueSecurity();
    } catch (err) {
      zone.innerHTML = `<p class="rule-empty">${echapperHtml(err.message)}</p>`;
      journal(`SECURITY_SCAN_GIT_HISTORY_ECHEC : ${err.message}`);
    }
    e.target.disabled = false;
    refreshJournalIfOpen();
  });

  // Copier le rapport (idee "copier le rapport") - meme rapport que
  // l'export fichier (respecte les filtres actifs), juste vers le
  // presse-papier plutot qu'un dialogue de sauvegarde natif.
  document.getElementById('security-copy-report').addEventListener('click', async () => {
    try {
      await window.aura.copyToClipboard(construireRapportSecurite());
      journal('SECURITY_RAPPORT_COPIE');
    } catch (err) {
      journal(`SECURITY_RAPPORT_COPIE_ECHEC : ${err.message}`);
    }
    refreshJournalIfOpen();
  });

  // Exporter le rapport (idee 4) : dialogue de sauvegarde natif (voir
  // security:export-report, main.js) - l'utilisateur choisit
  // l'emplacement et confirme via le dialogue de l'OS.
  document.getElementById('security-export').addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      const resultat = await window.aura.exportSecurityReport(construireRapportSecurite());
      if (resultat.ok) journal(`SECURITY_EXPORT : ${resultat.path}`);
      else if (!resultat.canceled) journal(`SECURITY_EXPORT_ECHEC : ${resultat.error}`);
    } catch (err) {
      journal(`SECURITY_EXPORT_ECHEC : ${err.message}`);
    }
    e.target.disabled = false;
  });

  // Lien vers l'avis de securite (idee "avis") - shell.openExternal cote
  // main (voir security:open-external), un renderer sandboxe ne peut pas
  // ouvrir de navigateur systeme lui-meme.
  document.getElementById('security-deps-results').addEventListener('click', async (e) => {
    const lien = e.target.closest('.security-advisory-btn');
    if (!lien) return;
    const resultat = await window.aura.openExternal(lien.dataset.url);
    if (!resultat.ok) journal(`SECURITY_AVIS_ECHEC : ${resultat.error}`);
  });

  // Correctif en un clic (idee 5) : confirmation a deux temps, meme
  // geste que la suppression d'une regle AURA AUTONOMY - action reelle
  // sur le dossier analyse, pas une simple lecture. Delegation sur le
  // conteneur pour la meme raison que "localiser" ci-dessus.
  document.getElementById('security-deps-results').addEventListener('click', async (e) => {
    const bouton = e.target.closest('.security-fix-btn');
    if (!bouton) return;
    if (!bouton.classList.contains('confirm-armed')) {
      bouton.classList.add('confirm-armed');
      // Seuls les boutons agreges ("Tout corriger", "Corriger
      // automatiquement") ont un id - les boutons de ligne n'en ont
      // jamais (juste class + dataset), d'ou ce test plutot qu'une liste
      // d'ids en dur a maintenir a chaque nouveau bouton agrege.
      const texteArme = bouton.id ? bouton.textContent : 'Corriger';
      bouton.dataset.texteInitial = texteArme;
      bouton.textContent = 'Confirmer ?';
      bouton.dataset.minuteur = setTimeout(() => {
        bouton.classList.remove('confirm-armed');
        bouton.textContent = bouton.dataset.texteInitial;
      }, 3000);
      return;
    }
    clearTimeout(Number(bouton.dataset.minuteur));
    bouton.disabled = true;
    bouton.textContent = '…';
    // dernierResultatDeps.dossier (le dossier reellement audite), pas le
    // champ #security-path live : si l'utilisateur a tape un autre
    // chemin depuis l'audit sans relancer, "Corriger" agirait sinon sur
    // le mauvais dossier (meme logique que dernierDossierSecrets pour
    // "Localiser" ci-dessus).
    const chemin = dernierResultatDeps ? dernierResultatDeps.dossier : '';

    // "Tout corriger" (idee "tout corriger") : applique sequentiellement
    // chaque correctif distinct disponible sur le dernier audit, pas
    // seulement ceux actuellement visibles sous les filtres/la recherche -
    // le sens du bouton ("tout") resterait ambigu sinon.
    if (bouton.id === 'security-fix-all') {
      const correctifs = [...new Set(
        (dernierResultatDeps ? dernierResultatDeps.paquets : [])
          .filter((p) => p.correctif && p.correctif.includes('@'))
          .map((p) => p.correctif)
      )];
      let ok = 0;
      let echecs = 0;
      for (const correctif of correctifs) {
        try {
          await window.aura.fixDependency(chemin, correctif);
          ok++;
        } catch {
          echecs++;
        }
      }
      journal(`SECURITY_FIX_TOUT : ${ok} correctif(s) appliqué(s)${echecs ? `, ${echecs} échec(s)` : ''}`);
      await lancerAuditDeps();
      refreshJournalIfOpen();
      return;
    }

    // Correctif generique (idee "correctif generique") : une seule
    // commande "npm audit fix" pour tout ce qui n'a pas de version
    // precise proposee - contrairement a "Corriger"/"Tout corriger", pas
    // de paquet cible unique a passer.
    if (bouton.id === 'security-fix-generic') {
      try {
        await window.aura.fixGenericAudit(chemin);
        journal('SECURITY_FIX_GENERIQUE');
      } catch (err) {
        journal(`SECURITY_FIX_GENERIQUE_ECHEC : ${err.message}`);
      }
      await lancerAuditDeps();
      refreshJournalIfOpen();
      return;
    }

    try {
      await window.aura.fixDependency(chemin, bouton.dataset.correctif);
      journal(`SECURITY_FIX : ${bouton.dataset.nom} → ${bouton.dataset.correctif}`);
      await lancerAuditDeps();
    } catch (err) {
      journal(`SECURITY_FIX_ECHEC : ${err.message}`);
      bouton.classList.remove('confirm-armed');
      bouton.textContent = 'Corriger';
      bouton.disabled = false;
    }
    refreshJournalIfOpen();
  });

  // Ignorer/reinitialiser un faux positif cote dependances (idee "ignorer
  // une dependance") - meme geste que pour les secrets ci-dessus.
  document.getElementById('security-deps-results').addEventListener('click', async (e) => {
    const boutonIgnorer = e.target.closest('.security-ignore-dep-btn');
    if (boutonIgnorer) {
      if (!dernierResultatDeps) return;
      try {
        await window.aura.ignoreDependency(dernierResultatDeps.dossier, boutonIgnorer.dataset.nom, boutonIgnorer.dataset.gravite);
        journal(`SECURITY_IGNORE_DEP_AJOUTE : ${boutonIgnorer.dataset.nom}`);
        dernierResultatDeps.paquets = dernierResultatDeps.paquets.filter((p) =>
          !(p.nom === boutonIgnorer.dataset.nom && p.gravite === boutonIgnorer.dataset.gravite)
        );
        renderDepsResults(dernierResultatDeps);
      } catch (err) {
        journal(`SECURITY_IGNORE_DEP_ECHEC : ${err.message}`);
      }
      refreshJournalIfOpen();
      return;
    }
    const boutonReset = e.target.closest('#security-reset-ignores-deps');
    if (boutonReset) {
      if (!dernierResultatDeps) return;
      try {
        await window.aura.clearIgnoredDependencies(dernierResultatDeps.dossier);
        journal('SECURITY_IGNORES_DEP_REINITIALISES');
        await lancerAuditDeps();
      } catch (err) {
        journal(`SECURITY_IGNORES_DEP_REINITIALISATION_ECHEC : ${err.message}`);
      }
      refreshJournalIfOpen();
    }
  });
}

initGlobe();

// ================= AURA TERMINAL (§5) =================
// Rendu des blocs structures produits par le moteur reel (terminal-core,
// copie de TERMINAL/core) - jamais de HTML/ANSI depuis le moteur lui-meme,
// voir terminal-core/output.js. Deux surfaces partagent ce meme rendu et
// la meme logique de soumission (creerTerminalSession) : la page AURA
// TERMINAL (Soma dedie, historique complet) et le popup de la barre du
// bas (accès rapide, sans quitter la page principale) - chacune sa propre
// session cote interface, mais le meme moteur/dossier courant cote main.js
// (pas d'onglets en v1).

const TERMINAL_TONE_CLASS = {
  normal: '', dim: 'terminal-dim', accent: 'terminal-accent',
  error: 'terminal-error', success: 'terminal-success', warn: 'terminal-warn'
};

function terminalTableHtml(bloc) {
  const thead = bloc.columns.map((c) =>
    `<th class="${c.align === 'right' ? 'terminal-right' : ''}">${echapperHtml(c.label)}</th>`
  ).join('');
  const corps = bloc.rows.map((ligne) => {
    const cellules = bloc.columns.map((c) => {
      const valeur = ligne[c.key] == null ? '' : String(ligne[c.key]);
      const classeTon = c.tone && ligne._tone ? ` terminal-tone-${echapperHtml(String(ligne._tone))}` : '';
      const classeAlign = c.align === 'right' ? ' terminal-right' : '';
      if (c.kind === 'path') {
        return `<td class="${classeAlign}${classeTon}"><button type="button" class="terminal-path-link" data-target="${echapperHtml(ligne._full || valeur)}">${echapperHtml(valeur)}</button></td>`;
      }
      return `<td class="${classeAlign}${classeTon}">${echapperHtml(valeur)}</td>`;
    }).join('');
    return `<tr>${cellules}</tr>`;
  }).join('');
  return `<div class="terminal-table-wrap"><table class="terminal-table"><thead><tr>${thead}</tr></thead><tbody>${corps}</tbody></table></div>`;
}

// control (clear/frame/progress/exit...) n'est jamais rendu ici : c'est un
// ordre pour l'interface, gere a part par creerTerminalSession#ajouterBlocs.
function terminalBlocHtml(bloc) {
  switch (bloc.type) {
    case 'text':
      return `<div class="terminal-line ${TERMINAL_TONE_CLASS[bloc.tone] || ''}">${echapperHtml(bloc.text)}</div>`;
    case 'title':
      return `<div class="terminal-title"><span>${echapperHtml(bloc.label)}</span>${bloc.note ? `<span class="terminal-title-note">${echapperHtml(bloc.note)}</span>` : ''}</div>`;
    case 'blank':
      return '<div class="terminal-blank"></div>';
    case 'rule':
      return '<div class="terminal-rule"></div>';
    case 'kv':
      return `<dl class="terminal-kv">${bloc.pairs.map(([k, v]) => `<dt>${echapperHtml(k)}</dt><dd>${echapperHtml(v)}</dd>`).join('')}</dl>`;
    case 'list':
      return `<ul class="terminal-list">${bloc.items.map((i) => `<li>${echapperHtml(i)}</li>`).join('')}</ul>`;
    case 'code':
      return `<pre class="terminal-code">${echapperHtml(bloc.text)}</pre>`;
    case 'path':
      return `<div class="terminal-line"><button type="button" class="terminal-path-link" data-target="${echapperHtml(bloc.path)}">${echapperHtml(bloc.path)}</button></div>`;
    case 'gauge': {
      const pct = Math.round(bloc.ratio * 100);
      return `<div class="terminal-gauge">
        <span class="terminal-gauge-label">${echapperHtml(bloc.label)}</span>
        <div class="terminal-gauge-track"><div class="terminal-gauge-fill${bloc.ratio > 0.85 ? ' terminal-gauge-high' : ''}" style="width:${pct}%"></div></div>
        ${bloc.note ? `<span class="terminal-gauge-note">${echapperHtml(bloc.note)}</span>` : ''}
      </div>`;
    }
    case 'table':
      return terminalTableHtml(bloc);
    case 'console':
      // Console interactive (`run python`) : pas de PTY en v1 (voir main.js#
      // getTerminal) - `run` bascule alors deja sur sa sortie texte
      // cote moteur ; ce bloc n'apparait donc pas en pratique aujourd'hui.
      return '<div class="terminal-line terminal-dim">[console interactive non disponible dans cette version - sortie en texte]</div>';
    default:
      return `<div class="terminal-line terminal-dim">[bloc non pris en charge : ${echapperHtml(String(bloc.type))}]</div>`;
  }
}

/**
 * Session Terminal cote interface : soumission, historique de navigation
 * (fleches), flux de sortie. Le moteur (main.js) ne connait ni onglets ni
 * "session UI" - c'est purement un regroupement des elements DOM d'une
 * des deux surfaces (page ou popup) et de leur etat de navigation local.
 */
function creerTerminalSession({ output, statut, prompt, onMiseAJour }) {
  // commandes/echecs/debut : alimentent le panneau lateral "Session" (idee
  // "ressemble a TERMINAL", retour utilisateur) - propres a cette instance
  // d'interface, pas au moteur (qui ne compte rien de tel).
  const etat = { historique: [], curseur: 0, brouillon: '', enCours: null, commandes: 0, echecs: 0, debut: Date.now(), journal: [] };

  function coller(cible, html) {
    cible.insertAdjacentHTML('beforeend', html);
  }

  function nouvelleEntree(ligne) {
    coller(output, `<div class="terminal-entry"><div class="terminal-echo"><span class="terminal-echo-chevron">&gt;</span> ${echapperHtml(ligne)}</div><div class="terminal-entry-body"></div></div>`);
    const corps = output.querySelectorAll('.terminal-entry-body');
    return corps[corps.length - 1];
  }

  // Ordres adresses a l'interface (idee reprise de TERMINAL, ui/view.js#
  // handleControl) - jamais affiches comme du contenu.
  function appliquerControle(bloc, cible) {
    if (bloc.action === 'clear') { output.replaceChildren(); return; }
    // `watch` : chaque image remplace la precedente, dans l'entree courante
    // seulement (pas tout le flux) - meme portee que le moteur (offset).
    if (bloc.action === 'frame') { cible.replaceChildren(); return; }
    if (bloc.action === 'progress') {
      if (!statut) return;
      const p = bloc.payload || {};
      statut.textContent = p.done
        ? `${p.found ?? 0} résultat(s) — ${p.scanned ?? 0} dossier(s) exploré(s)`
        : `${p.found ?? 0} trouvé(s) — ${p.scanned ?? 0} dossier(s)${p.current ? ` — ${p.current}` : ''}`;
      statut.hidden = false;
      return;
    }
    if (bloc.action === 'exit') {
      coller(cible, terminalBlocHtml({ type: 'text', tone: 'dim', text: 'Session terminée (serveurs éventuels arrêtés).' }));
    }
    // close-tab, noop : sans effet en v1 (pas d'onglets).
  }

  function ajouterBlocs(cible, blocs) {
    const proche = output.scrollHeight - output.scrollTop - output.clientHeight < 60;
    for (const bloc of blocs) {
      if (bloc.type === 'control') { appliquerControle(bloc, cible); continue; }
      coller(cible, terminalBlocHtml(bloc));
    }
    if (proche) output.scrollTop = output.scrollHeight;
  }

  async function soumettre(ligneBrute) {
    const ligne = String(ligneBrute || '').trim();
    if (!ligne || etat.enCours) return;

    // Confirmation native pour une commande sensible (rm, kill, run...) -
    // meme geste que l'application TERMINAL d'origine (dialog natif,
    // inaccessible depuis un renderer sandboxe sans passer par main.js).
    let autorise = true;
    try {
      const confirmation = await window.aura.terminal.confirmation(ligne);
      if (confirmation && confirmation.required) {
        autorise = await window.aura.terminal.confirm({
          title: 'Confirmation',
          message: 'Confirmer cette commande ?',
          detail: confirmation.reasons.join('\n')
        });
      }
    } catch { /* verification indisponible - la commande part quand meme */ }

    const cible = nouvelleEntree(ligne);
    if (!autorise) {
      ajouterBlocs(cible, [{ type: 'text', tone: 'warn', text: 'Annulé.' }]);
      etat.historique.push(ligne);
      etat.curseur = etat.historique.length;
      etat.commandes += 1;
      etat.journal.push({ ligne, ok: false });
      if (typeof onMiseAJour === 'function') onMiseAJour();
      return;
    }
    if (statut) statut.hidden = true;

    // Meme logique de rattrapage que ui/view.js#submit (application
    // TERMINAL d'origine) : les blocs arrivent deux fois (au fil de l'eau,
    // puis en entier dans la reponse) - `rendu`/`etabli` evitent de les
    // afficher deux fois sans en perdre si des messages arrivent apres la
    // fin de l'appel.
    let rendu = 0;
    let etabli = false;
    const handle = window.aura.terminal.execute(ligne, (bloc, index) => {
      if (etabli || index !== rendu) return;
      ajouterBlocs(cible, [bloc]);
      rendu += 1;
    });
    etat.enCours = handle;

    let resultat;
    try {
      resultat = await handle.promise;
      const offset = Number(resultat.offset) || 0;
      const garde = Array.isArray(resultat.blocks) ? resultat.blocks : [];
      if (offset + garde.length > rendu) {
        ajouterBlocs(cible, garde.slice(Math.max(rendu - offset, 0)));
        rendu = offset + garde.length;
      }
      etabli = true;
    } catch (err) {
      etabli = true;
      ajouterBlocs(cible, [{ type: 'text', tone: 'error', text: err.message }]);
      resultat = { ok: false };
    } finally {
      etat.enCours = null;
      if (statut) statut.hidden = true;
    }

    if (resultat.display && prompt) prompt.textContent = resultat.display;

    etat.historique.push(ligne);
    etat.curseur = etat.historique.length;
    etat.commandes += 1;
    if (!resultat.ok) etat.echecs += 1;
    etat.journal.push({ ligne, ok: resultat.ok });
    if (typeof onMiseAJour === 'function') onMiseAJour();
  }

  // Chemin cliquable (bloc "path", ou colonne kind:"path" d'un tableau) -
  // delegation sur le conteneur, les blocs etant inseres via innerHTML.
  output.addEventListener('click', (e) => {
    const lien = e.target.closest('.terminal-path-link');
    if (lien) window.aura.terminal.reveal(lien.dataset.target);
  });

  return { soumettre, etat, output };
}

/**
 * Raccourcis clavier d'une ligne de saisie Terminal - fleches (historique),
 * Tab (completion), Ctrl+L (effacer), Echap (interrompre/masquer). Entree
 * n'est PAS geree ici : chaque surface a sa propre logique de soumission
 * (la barre du bas verifie d'abord une correspondance de Soma) et
 * l'appelle depuis son propre ecouteur `submit` du formulaire englobant -
 * la gerer aussi ici doublonnerait la soumission ou la court-circuiterait
 * selon l'ordre des ecouteurs.
 */
function wireTerminalInput({ input, hint, session, onEchap }) {
  input.addEventListener('input', () => { if (hint) hint.hidden = true; });

  input.addEventListener('keydown', async (e) => {
    if (e.key === 'ArrowUp') {
      if (!session.etat.historique.length) return;
      e.preventDefault();
      if (session.etat.curseur === session.etat.historique.length) session.etat.brouillon = input.value;
      session.etat.curseur = Math.max(0, session.etat.curseur - 1);
      input.value = session.etat.historique[session.etat.curseur] || '';
      return;
    }
    if (e.key === 'ArrowDown') {
      if (!session.etat.historique.length) return;
      e.preventDefault();
      session.etat.curseur = Math.min(session.etat.historique.length, session.etat.curseur + 1);
      input.value = session.etat.curseur === session.etat.historique.length ? session.etat.brouillon : session.etat.historique[session.etat.curseur];
      return;
    }
    if (e.key === 'l' && e.ctrlKey) {
      e.preventDefault();
      session.output.replaceChildren();
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      if (!hint) return;
      try {
        const completions = await window.aura.terminal.complete(input.value);
        if (completions.length === 1) {
          const mots = input.value.split(/(\s+)/);
          mots[mots.length - 1] = completions[0];
          input.value = `${mots.join('')} `;
          hint.hidden = true;
        } else if (completions.length > 1) {
          hint.textContent = completions.join('   ');
          hint.hidden = false;
        }
      } catch { /* completion indisponible - sans consequence */ }
      return;
    }
    if (e.key === 'Escape') {
      if (session.etat.enCours) { session.etat.enCours.abort(); return; }
      if (typeof onEchap === 'function') onEchap();
    }
  });
}

// Ecrit "24,3 Go" (virgule francaise) a partir d'un nombre d'octets brut -
// meme convention que les autres pages AURA (System Monitor), a la place
// du point de os.totalmem()/os.freemem().
function formatGoVirgule(octets) {
  return `${(octets / (1024 ** 3)).toFixed(1).replace('.', ',')} Go`;
}

// Panneau lateral "Session" (idee "ressemble a TERMINAL") - relit
// directement l'etat de la session UI, mis a jour par creerTerminalSession
// a chaque soumission (voir son parametre onMiseAJour).
function actualiserTerminalSidebarSession() {
  if (!terminalPageSession) return;
  const { commandes, echecs, debut, journal } = terminalPageSession.etat;
  document.getElementById('terminal-stat-commandes').textContent = String(commandes);
  document.getElementById('terminal-stat-echecs').textContent = String(echecs);
  document.getElementById('terminal-stat-duree').textContent = formatDuree(Math.floor((Date.now() - debut) / 1000));

  const zone = document.getElementById('terminal-sidebar-journal');
  if (!journal.length) { zone.textContent = 'Aucune commande pour l’instant.'; return; }
  zone.innerHTML = journal.slice(-8).reverse().map((e) => `
    <div class="terminal-sidebar-journal-entry${e.ok ? '' : ' echoue'}">
      <span class="terminal-sidebar-journal-dot"></span>
      <span class="terminal-sidebar-journal-line">${echapperHtml(e.ligne)}</span>
    </div>
  `).join('');
}

// Panneau lateral "Machine" - constantes vitales (main.js#terminal:vitals,
// meme principe que l'application TERMINAL d'origine) : uniquement ce que
// `os` sait donner instantanement, rafraichi par intervalle plutot qu'a
// chaque commande (independant de l'activite du Terminal).
async function actualiserTerminalSidebarMachine() {
  try {
    const v = await window.aura.terminal.vitals();
    const pct = Math.round((v.ramUsed / v.ramTotal) * 100);
    const remplissage = document.getElementById('terminal-vitals-ram-fill');
    remplissage.style.width = `${pct}%`;
    remplissage.classList.toggle('terminal-gauge-high', pct > 85);
    document.getElementById('terminal-vitals-ram-pct').textContent = `${pct} %`;
    document.getElementById('terminal-vitals-host').textContent = v.host;
    document.getElementById('terminal-vitals-user').textContent = v.user;
    document.getElementById('terminal-vitals-cpu').textContent = String(v.cpuCount);
    document.getElementById('terminal-vitals-mem').textContent = `${formatGoVirgule(v.ramUsed)} / ${formatGoVirgule(v.ramTotal)}`;
    document.getElementById('terminal-vitals-uptime').textContent = formatDuree(v.uptime);
  } catch { /* vitals indisponibles - le panneau garde ses dernieres valeurs affichees */ }
}

function actualiserTerminalSidebar() {
  actualiserTerminalSidebarSession();
  actualiserTerminalSidebarMachine();
}

let intervalTerminalSidebar = null;
let terminalPageSession = null;

function initTerminalPage() {
  if (terminalPageSession) return;
  const session = creerTerminalSession({
    output: document.getElementById('terminal-page-output'),
    statut: document.getElementById('terminal-page-status'),
    prompt: document.getElementById('terminal-page-prompt'),
    onMiseAJour: actualiserTerminalSidebarSession
  });
  const input = document.getElementById('terminal-page-input');
  const hint = document.getElementById('terminal-page-hint');
  wireTerminalInput({ input, hint, session });
  document.getElementById('terminal-page-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const ligne = input.value;
    input.value = '';
    hint.hidden = true;
    await session.soumettre(ligne);
  });
  terminalPageSession = session;

  window.aura.terminal.boot().then((boot) => {
    document.getElementById('terminal-page-prompt').textContent = boot.display || '';
    session.etat.historique = Array.isArray(boot.history) ? boot.history.slice() : [];
    session.etat.curseur = session.etat.historique.length;
    (boot.banner || []).forEach((bloc) => {
      document.getElementById('terminal-page-output').insertAdjacentHTML('beforeend', terminalBlocHtml(bloc));
    });
  }).catch(() => { /* moteur indisponible - la page reste utilisable, chaque commande le redira */ });
}

function wireTerminalPage() {
  document.getElementById('terminal-back').addEventListener('click', fermerPage);
}

// --- Popup de la barre du bas (idee "Terminal", retour utilisateur) ------

let terminalPopupSession = null;

function initTerminalPopup() {
  if (terminalPopupSession) return;
  terminalPopupSession = creerTerminalSession({
    output: document.getElementById('conversation-output')
    // Pas de `statut`/`prompt` dedies ici : le popup est deliberement
    // minimal (progression/dossier courant restent l'affaire de la page
    // AURA TERMINAL, pensee pour un usage plus soutenu).
  });
}

startClock();
chargerHistorique();
wirePanels();
wireJournalFilters();
wireConversation();
wirePages();
loadTasks();
loadReminders();
setInterval(pulseRandomActivity, 1300);
setInterval(pulseNoyau, 2600);
setInterval(checkDueReminders, 30000);
