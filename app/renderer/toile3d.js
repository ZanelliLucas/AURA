// Globe stellaire (§13.3, F-21) : rendu 3D (Three.js/WebGL) du noyau AURA,
// des Somas principaux/secondaires et de leurs liaisons de flux de
// donnees. Script classique (pas de modules ES) : le chargement de
// modules via fetch() est bloque par Chromium pour les pages file:// (deux
// origines file:// distinctes sont traitees comme opaques l'une envers
// l'autre) - three.js est donc charge en global classique (vendor/three.min.js,
// r128, dernier a fournir ce build) plutot qu'en import ES.
//
// La seule surface d'echange avec app.js (qui gere le reste de
// l'interface) est window.AuraToile3D, exposee en bas de ce fichier, pour
// declencher une activite (survol, pulsation aleatoire, arret d'urgence)
// sans que ce module ait besoin de connaitre le reste de l'UI.
(function () {
  // Blanc de l'identite AURA (--white, style.css) plutot qu'un blanc pur -
  // structure neutre, le rouge (--red) restant reserve a l'activite reelle
  // (§13.3 : les liaisons "s'illuminent en rouge selon l'activite").
  const BLANC = 0xf5f6f7;
  const ROUGE = 0xe5261a;

  const GRAPH_NODES = window.AURA_GRAPH.NODES;
  const RELATIONS = window.AURA_GRAPH.RELATIONS;

  const canvas = document.getElementById('web');

  // Fond transparent : la toile reste un calque au-dessus du fond de page
  // (#grid, --bg), sous l'horloge et les panneaux, exactement comme l'ancien
  // rendu SVG (jamais de fond opaque) - sinon le canvas les recouvre.
  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(50, 1, 1, 4000);
  camera.position.set(0, 0, 320);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);

  const monde = new THREE.Group();
  scene.add(monde);

  // Texture radiale generee en canvas 2D pour un point/halo au fondu doux
  // plutot qu'un disque a bord net (meme logique que l'ancien halo SVG).
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

  // ============================= NOYAU =================================
  // Le noyau central : AURA elle-meme (§13.3, F-21). Coeur plein entoure
  // d'une couronne de particules pour donner du volume - pas de halo
  // lumineux autour (retire sur demande).
  const noyauGroupe = new THREE.Group();
  monde.add(noyauGroupe);

  const coeur = new THREE.Mesh(
    new THREE.SphereGeometry(5.5, 32, 32),
    new THREE.MeshBasicMaterial({ color: BLANC })
  );
  noyauGroupe.add(coeur);

  const NB_PARTICULES = 700;
  const positionsNoyau = new Float32Array(NB_PARTICULES * 3);
  for (let i = 0; i < NB_PARTICULES; i++) {
    // Direction aleatoire uniforme sur la sphere + rayon concentre pres
    // du coeur (puissance > 1 sur un tirage uniforme) pour une densite
    // qui decroit doucement vers l'exterieur.
    let x, y, z, l;
    do {
      x = Math.random() * 2 - 1; y = Math.random() * 2 - 1; z = Math.random() * 2 - 1;
      l = Math.sqrt(x * x + y * y + z * z);
    } while (l > 1 || l < 1e-4);
    const rayon = 5.5 + Math.pow(Math.random(), 1.6) * 8;
    positionsNoyau[i * 3] = (x / l) * rayon;
    positionsNoyau[i * 3 + 1] = (y / l) * rayon;
    positionsNoyau[i * 3 + 2] = (z / l) * rayon;
  }
  const geoParticulesNoyau = new THREE.BufferGeometry();
  geoParticulesNoyau.setAttribute('position', new THREE.BufferAttribute(positionsNoyau, 3));
  const particulesNoyau = new THREE.Points(geoParticulesNoyau, new THREE.PointsMaterial({
    color: BLANC,
    map: texteurRadiale('rgba(245,246,247,ALPHA)', 1),
    size: 2.1,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    sizeAttenuation: true,
    blending: THREE.AdditiveBlending
  }));
  noyauGroupe.add(particulesNoyau);

  // ============================= SOMAS ==================================
  // Repartition reguliere sur une sphere (spirale de Fibonacci) - evite
  // les poles denses et les bandes visibles d'une grille lat/long.
  function sphereFibonacci(n) {
    const pts = [];
    if (n <= 0) return pts;
    if (n === 1) { pts.push({ x: 0, y: 1, z: 0 }); return pts; }
    const phi = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < n; i++) {
      const y = 1 - (i / (n - 1)) * 2;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const a = phi * i;
      pts.push({ x: Math.cos(a) * r, y, z: Math.sin(a) * r });
    }
    return pts;
  }

  const RAYON_PRINCIPAL = 65;
  const RAYON_SECONDAIRE = 115;
  const TAILLE_PRINCIPAL = 3.4;
  const TAILLE_SECONDAIRE = 2.5;

  const somasGroupe = new THREE.Group();
  monde.add(somasGroupe);
  const lignesGroupe = new THREE.Group();
  monde.add(lignesGroupe);

  const somas = {};
  const lignesParNoeud = {};

  function enregistrerLigne(idA, idB, ligne) {
    [idA, idB].forEach((id) => {
      if (id === '__hub') return;
      if (!lignesParNoeud[id]) lignesParNoeud[id] = [];
      lignesParNoeud[id].push(ligne);
    });
  }

  function creerSoma(node, direction, rayon, taille) {
    const position = new THREE.Vector3(direction.x * rayon, direction.y * rayon, direction.z * rayon);

    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(taille, 16, 16),
      new THREE.MeshBasicMaterial({ color: BLANC })
    );
    mesh.position.copy(position);
    mesh.userData.id = node.id;
    somasGroupe.add(mesh);

    // Liaison directe vers le noyau (§5.6 : chaque agent est relie a
    // AURA CORE, au-dela de ses liens transversaux eventuels).
    const geoSpoke = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), position]);
    const matSpoke = new THREE.LineBasicMaterial({ color: BLANC, transparent: true, opacity: 0.22 });
    const spoke = new THREE.Line(geoSpoke, matSpoke);
    spoke.userData = { activite: 0, opaciteBase: 0.22 };
    lignesGroupe.add(spoke);
    enregistrerLigne('__hub', node.id, spoke);

    somas[node.id] = { node, mesh, position, tailleBase: taille, phase: Math.random() * Math.PI * 2, activite: 0 };
  }

  const principaux = GRAPH_NODES.filter((n) => n.kind === 'core');
  const secondaires = GRAPH_NODES.filter((n) => n.kind === 'agent');
  const dirsPrincipaux = sphereFibonacci(principaux.length);
  const dirsSecondaires = sphereFibonacci(secondaires.length);
  principaux.forEach((node, i) => creerSoma(node, dirsPrincipaux[i], RAYON_PRINCIPAL, TAILLE_PRINCIPAL));
  secondaires.forEach((node, i) => creerSoma(node, dirsSecondaires[i], RAYON_SECONDAIRE, TAILLE_SECONDAIRE));

  // Liens transversaux reels entre Somas (§5.6.1) - independants des
  // liaisons vers le noyau, c'est ce qui donne au globe un vrai reseau
  // maille plutot qu'une simple etoile.
  RELATIONS.forEach(([idA, idB]) => {
    const a = somas[idA];
    const b = somas[idB];
    if (!a || !b) return;
    const geo = new THREE.BufferGeometry().setFromPoints([a.position, b.position]);
    const mat = new THREE.LineBasicMaterial({ color: BLANC, transparent: true, opacity: 0.14 });
    const ligne = new THREE.Line(geo, mat);
    ligne.userData = { activite: 0, opaciteBase: 0.14 };
    lignesGroupe.add(ligne);
    enregistrerLigne(idA, idB, ligne);
  });

  function redimensionner() {
    const largeur = canvas.clientWidth || 1;
    const hauteur = canvas.clientHeight || 1;
    camera.aspect = largeur / hauteur;
    camera.updateProjectionMatrix();
    renderer.setSize(largeur, hauteur, false);
  }
  window.addEventListener('resize', redimensionner);
  redimensionner();

  // ========================= INTERACTION ================================
  // Glisser pour faire tourner le globe, avec une inertie legere une fois
  // relache - la rotation continue seule quand on ne touche a rien.
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
    canvas.style.cursor = idSurvole ? 'pointer' : 'grab';
  });

  // Survol d'un Soma : le met en activite (§13.3, "s'illuminent en rouge
  // selon l'activite"), comme le faisait l'ancienne toile SVG au survol
  // d'un noeud. Le rayon est recalcule a chaque frame (boucle) plutot que
  // seulement au mouvement de la souris, car les Somas tournent avec le
  // globe meme quand la souris reste immobile.
  const raycaster = new THREE.Raycaster();
  const souris = new THREE.Vector2(-2, -2);
  let idSurvole = null;

  canvas.addEventListener('pointermove', (e) => {
    const rect = canvas.getBoundingClientRect();
    souris.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    souris.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  });
  canvas.addEventListener('pointerleave', () => {
    souris.set(-2, -2);
  });

  function activerNoeud(id, montant) {
    const soma = somas[id];
    if (soma) soma.activite = Math.min(1, soma.activite + montant);
    (lignesParNoeud[id] || []).forEach((ligne) => {
      ligne.userData.activite = Math.min(1, ligne.userData.activite + montant);
    });
  }

  const ROTATION_IDLE = 0.05;
  let activiteNoyau = 0;
  const couleurBlanc = new THREE.Color(BLANC);
  const couleurRouge = new THREE.Color(ROUGE);

  function boucle(maintenant) {
    const t = maintenant / 1000;

    if (!glisse) {
      monde.rotation.y += (ROTATION_IDLE + inertieY) * 0.016;
      monde.rotation.x += inertieX * 0.016;
      monde.rotation.x = Math.max(-1.2, Math.min(1.2, monde.rotation.x));
      inertieX *= 0.94;
      inertieY *= 0.94;
    }

    // Survol : desactive au clic-glisse pour ne pas declencher de faux
    // survols pendant la rotation du globe.
    if (!glisse) {
      raycaster.setFromCamera(souris, camera);
      const hits = raycaster.intersectObjects(somasGroupe.children);
      const nouveauId = hits.length ? hits[0].object.userData.id : null;
      if (nouveauId !== idSurvole) {
        idSurvole = nouveauId;
        canvas.style.cursor = idSurvole ? 'pointer' : 'grab';
      }
      if (idSurvole) activerNoeud(idSurvole, 0.3);
    }

    activiteNoyau = Math.max(0, activiteNoyau - 0.02);
    const respiration = 1 + Math.sin(t * 1.6) * 0.05 + activiteNoyau * 0.18;
    coeur.scale.setScalar(respiration);
    particulesNoyau.scale.setScalar(1 + Math.sin(t * 1.6 + 0.4) * 0.06 + activiteNoyau * 0.22);
    particulesNoyau.material.opacity = 0.85 + Math.sin(t * 2.1) * 0.1 + activiteNoyau * 0.15;

    Object.values(somas).forEach((soma) => {
      soma.activite = Math.max(0, soma.activite - 0.02);
      const pulse = 1 + Math.sin(t * 1.4 + soma.phase) * 0.05 + soma.activite * 0.5;
      soma.mesh.scale.setScalar(pulse);
      soma.mesh.material.color.copy(couleurBlanc).lerp(couleurRouge, soma.activite);
    });

    lignesGroupe.children.forEach((ligne) => {
      const info = ligne.userData;
      info.activite = Math.max(0, info.activite - 0.02);
      ligne.material.color.copy(couleurBlanc).lerp(couleurRouge, info.activite);
      ligne.material.opacity = info.opaciteBase + info.activite * 0.65;
    });

    renderer.render(scene, camera);
    requestAnimationFrame(boucle);
  }
  requestAnimationFrame(boucle);

  // API pour app.js (classique) : pulse un Soma (et ses liaisons) quand
  // une activite se declenche (pulsation aleatoire, arret d'urgence...).
  // '__hub' cible le noyau lui-meme ; tout autre id inconnu est ignore
  // sans erreur.
  window.AuraToile3D = {
    setActive(nodeId, active) {
      if (!active) return;
      if (nodeId === '__hub') { activiteNoyau = Math.min(1, activiteNoyau + 0.6); return; }
      activerNoeud(nodeId, 0.7);
      activiteNoyau = Math.min(1, activiteNoyau + 0.15);
    }
  };
})();
