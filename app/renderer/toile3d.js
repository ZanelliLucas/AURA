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

  // Coeur plein : le centre net et lumineux du noyau. Pas de halo autour
  // (retire sur demande) - le volume vient uniquement du coeur, de la
  // couronne de particules et des anneaux.
  const coeur = new THREE.Mesh(
    new THREE.SphereGeometry(5.5, 32, 32),
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
    const rayon = 5.5 + Math.pow(Math.random(), 1.6) * 8;
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
    size: 2.1,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    sizeAttenuation: true,
    blending: THREE.AdditiveBlending
  }));
  noyauGroupe.add(particules);

  // Deux anneaux en pointilles, inclines differemment et tournant en sens
  // oppose - une structure gyroscopique plutot qu'une simple boule
  // lumineuse, dans l'esprit HUD de l'identite AURA.
  function creerAnneau(rayon, dashSize, gapSize, opacite) {
    const segments = 96;
    const pts = [];
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * rayon, Math.sin(a) * rayon, 0));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const ligne = new THREE.Line(geo, new THREE.LineDashedMaterial({
      color: BLANC, transparent: true, opacity: opacite, dashSize, gapSize
    }));
    ligne.computeLineDistances();
    return ligne;
  }

  const anneauGroupe1 = new THREE.Group();
  anneauGroupe1.rotation.x = 1.15;
  anneauGroupe1.add(creerAnneau(19, 1.3, 1.6, 0.35));
  noyauGroupe.add(anneauGroupe1);

  const anneauGroupe2 = new THREE.Group();
  anneauGroupe2.rotation.x = -0.55;
  anneauGroupe2.rotation.y = 0.9;
  anneauGroupe2.add(creerAnneau(23, 1.1, 1.9, 0.22));
  noyauGroupe.add(anneauGroupe2);

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
    anneauGroupe1.rotation.z += 0.004 + activite * 0.01;
    anneauGroupe2.rotation.z -= 0.0026 + activite * 0.008;

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
