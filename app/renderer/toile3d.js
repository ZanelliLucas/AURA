// Globe stellaire (§13.3, F-21) : rendu 3D (Three.js/WebGL) du noyau AURA
// et, a terme, des Somas principaux/secondaires relies par des liaisons de
// flux de donnees. Script classique (pas de modules ES) : le chargement de
// modules via fetch() est bloque par Chromium pour les pages file:// (deux
// origines file:// distinctes sont traitees comme opaques l'une envers
// l'autre) - three.js est donc charge en global classique (vendor/three.min.js,
// r128, dernier a fournir ce build) plutot qu'en import ES.
//
// La seule surface d'echange avec app.js (qui gere le reste de
// l'interface) est window.AuraToile3D, exposee en bas de ce fichier, pour
// declencher une activite (survol, pulsation aleatoire, arret d'urgence)
// sans que ce module ait besoin de connaitre le reste de l'UI.
//
// Etape 1 de la reconstruction : uniquement le noyau, au centre, dans une
// scene qu'on peut faire pivoter a la souris - avant d'ajouter les Somas et
// leurs liaisons par-dessus.
(function () {
  // Blanc de l'identite AURA (--white, style.css) plutot qu'un blanc pur -
  // coeur lumineux neutre, distinct du rouge reserve aux accents/alertes.
  const BLANC = 0xf5f6f7;

  const canvas = document.getElementById('web');

  // Fond transparent : la toile reste un calque au-dessus du fond de page
  // (#grid, --bg), sous l'horloge et les panneaux, exactement comme l'ancien
  // rendu SVG (jamais de fond opaque) - sinon le canvas les recouvre.
  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(50, 1, 1, 4000);
  camera.position.set(0, 0, 260);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);

  const monde = new THREE.Group();
  scene.add(monde);

  // Texture radiale generee en canvas 2D pour un halo au fondu doux plutot
  // qu'un disque a bord net (meme logique que l'ancien halo SVG).
  function texteurRadiale(couleur, alphaCentre) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, couleur.replace('ALPHA', String(alphaCentre)));
    grad.addColorStop(1, couleur.replace('ALPHA', '0'));
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  }

  const noyauGroupe = new THREE.Group();
  monde.add(noyauGroupe);

  // Coeur plein : le centre net et lumineux du noyau.
  const coeur = new THREE.Mesh(
    new THREE.SphereGeometry(9, 32, 32),
    new THREE.MeshBasicMaterial({ color: BLANC })
  );
  noyauGroupe.add(coeur);

  // Couronne de particules autour du coeur : donne du volume et une
  // texture "vivante" plutot qu'une simple sphere lisse (esprit du globe
  // stellaire de reference - un amas dense, pas un disque uni).
  const NB_PARTICULES = 700;
  const positions = new Float32Array(NB_PARTICULES * 3);
  const phases = new Float32Array(NB_PARTICULES);
  for (let i = 0; i < NB_PARTICULES; i++) {
    // Direction aleatoire uniforme sur la sphere + rayon concentre pres
    // du coeur (racine cubique d'un tirage elevee a une puissance) pour
    // une densite qui decroit doucement vers l'exterieur.
    let x, y, z, l;
    do {
      x = Math.random() * 2 - 1; y = Math.random() * 2 - 1; z = Math.random() * 2 - 1;
      l = Math.sqrt(x * x + y * y + z * z);
    } while (l > 1 || l < 1e-4);
    const rayon = 10 + Math.pow(Math.random(), 1.6) * 16;
    positions[i * 3] = (x / l) * rayon;
    positions[i * 3 + 1] = (y / l) * rayon;
    positions[i * 3 + 2] = (z / l) * rayon;
    phases[i] = Math.random() * Math.PI * 2;
  }
  const geoParticules = new THREE.BufferGeometry();
  geoParticules.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const particules = new THREE.Points(geoParticules, new THREE.PointsMaterial({
    color: BLANC,
    map: texteurRadiale('rgba(245,246,247,ALPHA)', 1),
    size: 3.4,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    sizeAttenuation: true,
    blending: THREE.AdditiveBlending
  }));
  noyauGroupe.add(particules);

  // Halo en deux couches : un glow serre et lumineux, et un halo plus
  // large et plus doux par-dessus - plus de profondeur qu'un seul disque.
  const haloProche = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texteurRadiale('rgba(245,246,247,ALPHA)', 0.65),
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  }));
  haloProche.scale.set(52, 52, 1);
  noyauGroupe.add(haloProche);

  const haloLarge = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texteurRadiale('rgba(245,246,247,ALPHA)', 0.3),
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  }));
  haloLarge.scale.set(110, 110, 1);
  noyauGroupe.add(haloLarge);

  // Anneau en pointilles, legerement incline, qui tourne independamment
  // du reste - une touche HUD qui donne au noyau une structure plutot
  // qu'une simple boule lumineuse.
  const anneauGroupe = new THREE.Group();
  anneauGroupe.rotation.x = 1.15;
  noyauGroupe.add(anneauGroupe);

  const SEGMENTS_ANNEAU = 96;
  const pointsAnneau = [];
  for (let i = 0; i <= SEGMENTS_ANNEAU; i++) {
    const a = (i / SEGMENTS_ANNEAU) * Math.PI * 2;
    pointsAnneau.push(new THREE.Vector3(Math.cos(a) * 34, Math.sin(a) * 34, 0));
  }
  const geoAnneau = new THREE.BufferGeometry().setFromPoints(pointsAnneau);
  const anneau = new THREE.Line(geoAnneau, new THREE.LineDashedMaterial({
    color: BLANC,
    transparent: true,
    opacity: 0.35,
    dashSize: 2.2,
    gapSize: 2.6
  }));
  anneau.computeLineDistances();
  anneauGroupe.add(anneau);

  function redimensionner() {
    const largeur = canvas.clientWidth || 1;
    const hauteur = canvas.clientHeight || 1;
    camera.aspect = largeur / hauteur;
    camera.updateProjectionMatrix();
    renderer.setSize(largeur, hauteur, false);
  }
  window.addEventListener('resize', redimensionner);
  redimensionner();

  // Interaction : glisser pour faire tourner le globe, avec une inertie
  // legere une fois relache - la rotation continue seule quand on ne
  // touche a rien (esprit "vivant" du globe stellaire).
  let glisse = false;
  let dernierX = 0;
  let dernierY = 0;
  let inertieX = 0;
  let inertieY = 0;

  canvas.style.cursor = 'grab';

  canvas.addEventListener('pointerdown', (e) => {
    glisse = true;
    dernierX = e.clientX;
    dernierY = e.clientY;
    canvas.style.cursor = 'grabbing';
  });
  window.addEventListener('pointermove', (e) => {
    if (!glisse) return;
    const dx = e.clientX - dernierX;
    const dy = e.clientY - dernierY;
    monde.rotation.y += dx * 0.005;
    monde.rotation.x += dy * 0.005;
    monde.rotation.x = Math.max(-1.2, Math.min(1.2, monde.rotation.x));
    inertieX = dx * 0.05;
    inertieY = dy * 0.05;
    dernierX = e.clientX;
    dernierY = e.clientY;
  });
  window.addEventListener('pointerup', () => {
    glisse = false;
    canvas.style.cursor = 'grab';
  });

  const ROTATION_IDLE = 0.05;
  let activite = 0;

  function boucle(maintenant) {
    const t = maintenant / 1000;

    if (!glisse) {
      monde.rotation.y += (ROTATION_IDLE + inertieY) * 0.016;
      monde.rotation.x += inertieX * 0.016;
      monde.rotation.x = Math.max(-1.2, Math.min(1.2, monde.rotation.x));
      inertieX *= 0.94;
      inertieY *= 0.94;
    }

    activite = Math.max(0, activite - 0.02);
    const respiration = 1 + Math.sin(t * 1.6) * 0.05 + activite * 0.18;
    coeur.scale.setScalar(respiration);
    particules.scale.setScalar(1 + Math.sin(t * 1.6 + 0.4) * 0.06 + activite * 0.22);
    particules.material.opacity = 0.85 + Math.sin(t * 2.1) * 0.1 + activite * 0.15;
    haloProche.scale.setScalar(52 * (1 + Math.sin(t * 1.6) * 0.08 + activite * 0.3));
    haloLarge.scale.setScalar(110 * (1 + Math.sin(t * 1.1) * 0.06 + activite * 0.35));
    anneauGroupe.rotation.z += 0.004 + activite * 0.01;

    renderer.render(scene, camera);
    requestAnimationFrame(boucle);
  }
  requestAnimationFrame(boucle);

  // API minimale pour app.js (classique) : pulse le noyau quand une activite
  // generale se declenche. Les Somas n'existent pas encore a cette etape -
  // tout id inconnu est ignore sans erreur.
  window.AuraToile3D = {
    setActive(nodeId, active) {
      if (active) activite = Math.min(1, activite + 0.6);
    }
  };
})();
