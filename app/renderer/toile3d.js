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
  const ROUGE = 0xe5261a;

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
  function texteurHalo(couleur) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, couleur.replace('ALPHA', '0.55'));
    grad.addColorStop(1, couleur.replace('ALPHA', '0'));
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  }

  // Noyau central : AURA elle-meme, coeur du globe stellaire (§13.3, F-21).
  const noyau = new THREE.Mesh(
    new THREE.SphereGeometry(14, 32, 32),
    new THREE.MeshBasicMaterial({ color: ROUGE })
  );
  monde.add(noyau);

  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texteurHalo('rgba(229,38,26,ALPHA)'),
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  }));
  halo.scale.set(80, 80, 1);
  monde.add(halo);

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
    noyau.scale.setScalar(respiration);
    halo.scale.setScalar(80 * (1 + Math.sin(t * 1.6) * 0.08 + activite * 0.3));

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
