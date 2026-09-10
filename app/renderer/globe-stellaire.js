/**
 * Globe stellaire — réseau neuronal en champ stellaire.
 *
 * Composant autonome, sans dépendance autre que three.js.
 * Il s'attache à un conteneur, s'adapte à sa taille, se met en pause
 * quand il sort de l'écran, et se démonte proprement.
 *
 *   import { GlobeStellaire } from './GlobeStellaire.js';
 *   const globe = new GlobeStellaire(document.querySelector('#globe'));
 *   // ... plus tard
 *   globe.detruire();
 */

(function () {

// ---------------------------------------------------------------- presets

const PRESETS = {
  bas:   { somas: 28, etoiles: 3500, densite: 0.45, bloomPasses: 1, bloomDivision: 4, dprMax: 1.0, ss: 1.0, seuil: 0.75 },
  moyen: { somas: 40, etoiles: 6000, densite: 0.7,  bloomPasses: 2, bloomDivision: 3, dprMax: 1.4, ss: 1.0, seuil: 0.78 },
  haut:  { somas: 54, etoiles: 9000, densite: 1.0,  bloomPasses: 2, bloomDivision: 2, dprMax: 1.75, ss: 1.15, seuil: 0.82 }
};

const DEFAUTS = {
  qualite: 'haut',          // 'bas' | 'moyen' | 'haut'
  graine: null,             // nombre : même graine = même globe, à chaque chargement

  rayon: 80,
  seuil: null,              // portée des liaisons du maillage ; null = preset
  somas: null,              // null = valeur du preset
  etoiles: null,
  densite: null,            // multiplicateur global du nombre de particules

  couleurs: {
    fond: '#010103',
    reseau: '#cce2ff',      // teinte des particules et des liaisons
    flux: '#ff8c2e',        // influx émis par le noyau
    fluxSoma: '#ffb46e',    // influx échangés entre somas
    etoiles: '#ffffff'
  },
  fondTransparent: false,   // true : le canvas laisse voir la page dessous

  camera: { distance: 210, min: 45, max: 800, fov: 55 },
  rotation: 0.026,          // rad/s ; 0 pour figer
  vitesse: 1,               // multiplicateur global de l'animation

  reseau: {
    somaSeuil: [2.4, 6.0],  // secondes entre deux décharges spontanées
    excitation: 0.55,
    // Critère de survie du réseau : relais x relaisMax est le nombre moyen
    // d'influx engendrés par décharge. Au-dessus de 1, chaque cascade se
    // multiplie jusqu'à saturer le globe et le débit s'effondre. On reste
    // juste en dessous : les ondes portent loin mais s'éteignent.
    relais: 0.3,
    relaisMax: 3,
    rafale: 2,              // boules par émission
    vitesseInflux: 30,
    metabolisme: 1.6,
    noyauActif: false       // true : le noyau réagit et relaie les influx reçus
  },

  rendu: {
    bloomSeuil: 0.32,
    bloomIntensite: 0.72,
    bloomRayon: 1.0,
    bloomLarge: 0.55,        // poids de la seconde chaîne, plus diffuse
    superEchantillon: 1.15,  // rendu interne agrandi puis réduit : anti-aliasing
    exposition: 1.35,
    nettete: 0.45,
    vignette: 0.85,
    grain: 0.007,            // bruit final, contre le banding des dégradés sombres
    limbe: 2.2
  },

  epaisseur: {              // en pixels écran
    axoneGaine: 18, axone: 8, axoneFilet: 2.4,
    brancheCorps: 4, brancheFilet: 1.5,
    synapse: 3.8, peau: 2.4, fine: 1.9
  },
  boule: { halo: 9.5, coeur: 3.4 },

  interaction: { rotation: true, zoom: true, clic: true },
  autoPause: true,          // suspend le rendu hors écran ou onglet caché
  adaptatif: true,          // dégrade automatiquement si le débit s'effondre
  fpsCible: 45,
  surEvenement: null        // (type, infos) => {}  — 'decharge' | 'terminaison'
};

// ------------------------------------------------------------------ outils

function fusion(base, sur) {
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const k in sur) {
    if (sur[k] == null) continue;
    out[k] = (typeof sur[k] === 'object' && !Array.isArray(sur[k]) && typeof base[k] === 'object')
      ? fusion(base[k], sur[k])
      : sur[k];
  }
  return out;
}

/** Générateur déterministe : une graine donnée reproduit exactement le même globe. */
function alea(graine) {
  let a = (graine == null ? (Math.random() * 4294967296) : graine) >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rgb(hex) {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
}

// ================================================================= composant

class GlobeStellaire {
  constructor(conteneur, options = {}) {
    if (!conteneur) throw new Error('GlobeStellaire : conteneur manquant');
    this.conteneur = conteneur;
    this.o = fusion(DEFAUTS, options);

    const preset = PRESETS[this.o.qualite] || PRESETS.haut;
    this.preset = preset;
    this.nbSomas = this.o.somas ?? preset.somas;
    this.nbEtoiles = this.o.etoiles ?? preset.etoiles;
    this.densite = this.o.densite ?? preset.densite;

    this.rnd = alea(this.o.graine);
    this.enPause = false;
    this.detruit = false;
    this._raf = null;
    this._jetables = [];

    this._initRendu();
    this._initScene();
    this._construire();
    this._initPost();
    this._initInteraction();
    this._initObservateurs();

    this._dernier = performance.now();
    this._niveau = 0;
    this._budget = 1000 / this.o.fpsCible;
    this._tempsMoyen = this._budget;
    this._compteurNiveau = 0;
    this._boucle = this._boucle.bind(this);
    this._raf = requestAnimationFrame(this._boucle);
  }

  // ---------------------------------------------------------- API publique

  /** Décharge le noyau : onde qui part vers tous les somas. */
  pulse(force = 1.15) {
    const N = this.amas[this.NOYAU];
    N.activite = 1.8;
    for (const v of N.voisins) this._emettre(v.arete, this.NOYAU, force, 'noyau');
    return this;
  }

  /**
   * Position à l'écran d'un soma, en pixels CSS relatifs au conteneur.
   * Sert à accrocher des libellés HTML sur les nœuds du globe.
   * `devant` distingue la face visible de la face arrière, `profondeur`
   * permet d'atténuer ce qui est loin.
   */
  positionSoma(index) {
    const id = this.somas[index % this.somas.length];
    const a = this.amas[id];
    const v = this._proj || (this._proj = new THREE.Vector3());
    v.set(a.x, a.y, a.z).applyMatrix4(this.monde.matrixWorld);
    const versCam = v.clone().sub(this.camera.position).normalize();
    const normale = new THREE.Vector3(a.x, a.y, a.z).normalize()
      .applyQuaternion(this.monde.quaternion);
    const devant = normale.dot(versCam) < 0;
    const dist = v.distanceTo(this.camera.position);
    v.project(this.camera);
    const l = this.conteneur.clientWidth, h = this.conteneur.clientHeight;
    return {
      x: (v.x * 0.5 + 0.5) * l,
      y: (-v.y * 0.5 + 0.5) * h,
      devant,
      profondeur: dist,
      activite: a.activite,
      dansLeCadre: v.z < 1
    };
  }

  /** Position à l'écran du noyau, même convention. */
  positionNoyau() {
    const v = (this._projN || (this._projN = new THREE.Vector3())).set(0, 0, 0);
    v.applyMatrix4(this.monde.matrixWorld).project(this.camera);
    return {
      x: (v.x * 0.5 + 0.5) * this.conteneur.clientWidth,
      y: (-v.y * 0.5 + 0.5) * this.conteneur.clientHeight
    };
  }

  /** Décharge un soma au hasard, ou celui d'indice donné. */
  pulseSoma(index = null) {
    const id = index == null
      ? this.somas[Math.floor(this.rnd() * this.somas.length)]
      : this.somas[index % this.somas.length];
    this._dechargerSoma(id);
    return this;
  }

  /** Options modifiables à chaud : couleurs, rotation, vitesse, rendu, interaction. */
  definirOptions(partiel) {
    this.o = fusion(this.o, partiel);
    const c = this.o.couleurs;
    this.fluxCouleur = { noyau: rgb(c.flux), soma: rgb(c.fluxSoma) };
    // .set(r, g, b) sur cette version de three.js n'assigne pas les
    // composantes RGB (elle retombe a (0,0,0)) - seul le constructeur
    // THREE.Color(r,g,b) le fait correctement. setRGB() est l'equivalent
    // correct pour mettre a jour une instance existante.
    this.teinteReseau.setRGB(...rgb(c.reseau));
    if (!this.o.fondTransparent) this.renderer.setClearColor(new THREE.Color(c.fond), 1);
    const r = this.o.rendu;
    this.matSeuil.uniforms.uSeuil.value = r.bloomSeuil;
    this.matCompo.uniforms.uForce.value = r.bloomIntensite;
    this.matCompo.uniforms.uNettete.value = r.nettete;
    this.matCompo.uniforms.uVignette.value = r.vignette;
    this.matCompo.uniforms.uLarge.value = r.bloomLarge;
    this.matCompo.uniforms.uExposition.value = r.exposition;
    this.matCompo.uniforms.uGrain.value = r.grain;
    this.uLimbe.value = r.limbe;
    return this;
  }

  pause() { this.enPause = true; return this; }
  reprendre() {
    if (this.detruit) return this;
    this.enPause = false;
    this._dernier = performance.now();
    return this;
  }

  /** À appeler si le conteneur change de taille sans que ResizeObserver le voie. */
  redimensionner() {
    const l = Math.max(1, this.conteneur.clientWidth);
    const h = Math.max(1, this.conteneur.clientHeight);
    this.camera.aspect = l / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(l, h, false);
    const pr = this.renderer.getPixelRatio();
    this.LARG = Math.max(1, Math.floor(l * pr));
    this.HAUT = Math.max(1, Math.floor(h * pr));
    const ss = this.SS || 1;
    this.rtScene.setSize(Math.max(1, Math.floor(this.LARG * ss)), Math.max(1, Math.floor(this.HAUT * ss)));
    const d = this.preset.bloomDivision, q = d * 2;
    this.rtA.setSize(Math.max(1, Math.floor(this.LARG / d)), Math.max(1, Math.floor(this.HAUT / d)));
    this.rtB.setSize(Math.max(1, Math.floor(this.LARG / d)), Math.max(1, Math.floor(this.HAUT / d)));
    this.rtC.setSize(Math.max(1, Math.floor(this.LARG / q)), Math.max(1, Math.floor(this.HAUT / q)));
    this.rtD.setSize(Math.max(1, Math.floor(this.LARG / q)), Math.max(1, Math.floor(this.HAUT / q)));
    this.matCompo.uniforms.uTexel.value.set(1 / (this.LARG * ss), 1 / (this.HAUT * ss));
    for (const m of this.rubansMat) m.uniforms.uRes.value.set(this.LARG, this.HAUT);
    return this;
  }

  /** Libère tout : boucle, écouteurs, observateurs, mémoire GPU, canvas. */
  detruire() {
    if (this.detruit) return;
    this.detruit = true;
    cancelAnimationFrame(this._raf);
    this._ro?.disconnect();
    this._io?.disconnect();
    document.removeEventListener('visibilitychange', this._surVisibilite);
    const el = this.renderer.domElement;
    for (const [type, fn] of this._ecouteurs) el.removeEventListener(type, fn);
    for (const j of this._jetables) j.dispose?.();
    this.rtScene.dispose(); this.rtA.dispose(); this.rtB.dispose();
    this.rtC.dispose(); this.rtD.dispose();
    this.renderer.dispose();
    el.parentNode?.removeChild(el);
    this.scene = null;
  }

  // ------------------------------------------------------------ init rendu

  _initRendu() {
    const o = this.o;
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: o.fondTransparent,
      powerPreference: 'high-performance'
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.preset.dprMax));
    this.renderer.setClearColor(new THREE.Color(o.couleurs.fond), o.fondTransparent ? 0 : 1);

    const el = this.renderer.domElement;
    el.style.display = 'block';
    el.style.width = '100%';
    el.style.height = '100%';
    el.style.touchAction = 'none';
    if (getComputedStyle(this.conteneur).position === 'static') this.conteneur.style.position = 'relative';
    this.conteneur.appendChild(el);

    const l = Math.max(1, this.conteneur.clientWidth);
    const h = Math.max(1, this.conteneur.clientHeight);
    this.renderer.setSize(l, h, false);
    this.camera = new THREE.PerspectiveCamera(o.camera.fov, l / h, 1, 4000);
    this.camera.position.set(0, 0, o.camera.distance);
    this.zoomCible = o.camera.distance;
  }

  _initScene() {
    this.scene = new THREE.Scene();
    this.ciel = new THREE.Group();
    this.monde = new THREE.Group();
    this.scene.add(this.ciel, this.monde);
    this.teinteReseau = new THREE.Color(...rgb(this.o.couleurs.reseau));
    this.fluxCouleur = { noyau: rgb(this.o.couleurs.flux), soma: rgb(this.o.couleurs.fluxSoma) };
    this.uT = { value: 0 };
    this.uLimbe = { value: this.o.rendu.limbe };
    this.rubansMat = [];
  }

  _sprite(douceur) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const rad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    rad.addColorStop(0, 'rgba(255,255,255,1)');
    rad.addColorStop(douceur, 'rgba(255,255,255,0.35)');
    rad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = rad; g.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c);
    t.needsUpdate = true;
    this._jetables.push(t);
    return t;
  }

  // --------------------------------------------------------- géométrie 3D

  _dir() {
    let x, y, z, l;
    do {
      x = this.rnd() * 2 - 1; y = this.rnd() * 2 - 1; z = this.rnd() * 2 - 1;
      l = Math.sqrt(x * x + y * y + z * z);
    } while (l > 1 || l < 1e-4);
    return [x / l, y / l, z / l];
  }
  _gauss() {
    let u = 0, v = 0;
    while (u === 0) u = this.rnd();
    while (v === 0) v = this.rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  _fibo(n, i) {
    const phi = Math.PI * (3 - Math.sqrt(5));
    const y = 1 - (i / Math.max(1, n - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const t = phi * i;
    return [Math.cos(t) * r, y, Math.sin(t) * r];
  }

  _construire() {
    this._ciel();
    this._noeuds();
    this._graphe();
    this._particules();
    this._liaisons();
    this._influxRendu();
  }

  _ciel() {
    const n = this.nbEtoiles, R = this.o.rayon;
    const p = new Float32Array(n * 3), ph = new Float32Array(n), ec = new Float32Array(n), tn = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const d = this._dir(), r = R * (2.0 + Math.pow(this.rnd(), 0.45) * 3.2);
      p[i * 3] = d[0] * r; p[i * 3 + 1] = d[1] * r; p[i * 3 + 2] = d[2] * r;
      ph[i] = this.rnd() * 6.2832;
      ec[i] = 0.22 + Math.pow(this.rnd(), 2.4) * 1.0;
      // Température stellaire : un champ monochrome paraît artificiel,
      // la variation de teinte suffit à le rendre crédible.
      tn[i] = Math.pow(this.rnd(), 1.6);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    g.setAttribute('aPh', new THREE.BufferAttribute(ph, 1));
    g.setAttribute('aEc', new THREE.BufferAttribute(ec, 1));
    g.setAttribute('aTn', new THREE.BufferAttribute(tn, 1));
    this.texNet = this._sprite(0.62);
    this.texPoint = this._sprite(0.30);
    this.texHalo = this._sprite(0.06);
    const m = new THREE.ShaderMaterial({
      uniforms: {
        uT: this.uT, uMap: { value: this.texNet },
        uCouleur: { value: new THREE.Color(...rgb(this.o.couleurs.etoiles)) }
      },
      vertexShader: `
        attribute float aPh; attribute float aEc; attribute float aTn;
        uniform float uT; varying float vI; varying float vTn;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          // Deux sinusoïdes non harmoniques : sans ça toutes les étoiles
          // clignotent au même rythme et ça fait guirlande.
          vI = aEc * (0.70 + 0.30 * sin(uT * 1.7 + aPh) * sin(uT * 0.53 + aPh * 1.7));
          vTn = aTn;
          gl_PointSize = (0.6 + aEc * 1.8) * (330.0 / max(1.0, -mv.z));
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform sampler2D uMap; uniform vec3 uCouleur; varying float vI; varying float vTn;
        void main() {
          vec3 froide = vec3(0.72, 0.83, 1.0);
          vec3 chaude = vec3(1.0, 0.86, 0.68);
          gl_FragColor = vec4(uCouleur * mix(froide, chaude, vTn) * vI,
                              texture2D(uMap, gl_PointCoord).a * vI * 0.9);
        }`,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false
    });
    this._jetables.push(g, m);
    this.ciel.add(new THREE.Points(g, m));
  }

  _poser(x, y, z, type, taille) {
    this.amas.push({
      x, y, z, type, taille,
      ph: this.rnd() * 6.2832, vit: 0.18 + this.rnd() * 0.5,
      dPh: [this.rnd() * 6.2832, this.rnd() * 6.2832, this.rnd() * 6.2832],
      dVit: [0.06 + this.rnd() * 0.1, 0.06 + this.rnd() * 0.1, 0.06 + this.rnd() * 0.1],
      dAmp: this.o.rayon * (type === 'noyau' ? 0 : 0.003 + this.rnd() * 0.009),
      activite: 0, refract: 0, charge: 0, seuilCharge: Infinity, voisins: []
    });
    return this.amas.length - 1;
  }

  _noeuds() {
    const R = this.o.rayon, r = this.o.reseau;
    this.amas = [];
    this.NOYAU = this._poser(0, 0, 0, 'noyau', 0.115 * R);

    const surCoque = (k, type, taille, i, n) => {
      const u = this._fibo(n, i), d = this._dir();
      // Jitter angulaire : une répartition de Fibonacci pure laisse
      // apparaître des spirales à la surface, l'œil les repère aussitôt.
      const x = u[0] + d[0] * 0.055, y = u[1] + d[1] * 0.055, z = u[2] + d[2] * 0.055;
      const l = Math.hypot(x, y, z);
      return this._poser(x / l * k * R, y / l * k * R, z / l * k * R, type, taille);
    };

    this.somas = [];
    for (let i = 0; i < this.nbSomas; i++) {
      const k = 0.88 + this.rnd() * 0.12;
      const id = surCoque(k, 'soma', (0.028 + this.rnd() * 0.022) * R, i, this.nbSomas);
      this.amas[id].seuilCharge = r.somaSeuil[0] + this.rnd() * (r.somaSeuil[1] - r.somaSeuil[0]);
      this.amas[id].charge = this.rnd() * this.amas[id].seuilCharge;
      this.somas.push(id);
    }
    this.peau = [];
    const nPeau = Math.round(340 * this.densite);
    for (let i = 0; i < nPeau; i++) {
      this.peau.push(surCoque(0.90 + this.rnd() * 0.12, 'peau', 0.016 * R * (0.5 + this.rnd()), i, nPeau));
    }
    this._nBrume = Math.round(130 * this.densite);
  }

  _graphe() {
    const R = this.o.rayon;
    this.aretes = [];
    const A = this.amas;

    const arc = (ia, ib, courbure, classe) => {
      if (ia === ib || ia == null || ib == null) return;
      for (const e of A[ia].voisins) if (e.autre === ib) return;
      const a = A[ia], b = A[ib], u = this._dir();
      const f = courbure * (0.6 + this.rnd() * 0.8);
      const courbe = new THREE.QuadraticBezierCurve3(
        new THREE.Vector3(a.x, a.y, a.z),
        new THREE.Vector3((a.x + b.x) / 2 + u[0] * R * f, (a.y + b.y) / 2 + u[1] * R * f, (a.z + b.z) / 2 + u[2] * R * f),
        new THREE.Vector3(b.x, b.y, b.z));
      this._lier(ia, ib, courbe, classe);
    };
    const proches = (src, cands, k) => {
      const d = [];
      for (const c of cands) {
        if (c === src) continue;
        const a = A[src], b = A[c];
        d.push([(a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2, c]);
      }
      d.sort((p, q) => p[0] - q[0]);
      return d.slice(0, k).map(v => v[1]);
    };

    const tmp = new THREE.Vector3();
    this.axones = []; this.branches = [];

    for (const s of this.somas) {
      const B = A[s], u = this._dir(), f = 0.09 + this.rnd() * 0.09;
      const courbe = new THREE.QuadraticBezierCurve3(
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(B.x / 2 + u[0] * R * f, B.y / 2 + u[1] * R * f, B.z / 2 + u[2] * R * f),
        new THREE.Vector3(B.x, B.y, B.z));
      this.axones.push({ courbe });

      const n = 2 + Math.floor(this.rnd() * 2);
      const chaine = [this.NOYAU];
      for (let i = 0; i < n; i++) {
        courbe.getPoint((i + 1) / (n + 1), tmp);
        const d = this._dir(), lat = Math.abs(this._gauss()) * R * 0.022;
        chaine.push(this._poser(tmp.x + d[0] * lat, tmp.y + d[1] * lat, tmp.z + d[2] * lat,
                                'relais', 0.015 * R * (0.6 + this.rnd() * 0.8)));
      }
      chaine.push(s);
      for (let i = 0; i < chaine.length - 1; i++) arc(chaine[i], chaine[i + 1], 0.025, 'axone');

      // Ramifications : départs échelonnés le long du tronc. Un éventail
      // depuis un point unique se lit comme une patte d'oie ; des départs
      // décalés se lisent comme une fibre qui se divise.
      const nb = 2 + Math.floor(this.rnd() * 3);
      for (let k = 0; k < nb; k++) {
        const iD = chaine[1 + Math.floor(this.rnd() * Math.max(1, chaine.length - 2))];
        const D = A[iD];
        const lr = Math.hypot(D.x, D.y, D.z) || 1;
        const rad = [D.x / lr, D.y / lr, D.z / lr];
        let e = this._dir();
        const pr = e[0] * rad[0] + e[1] * rad[1] + e[2] * rad[2];
        e = [e[0] - rad[0] * pr * 0.7, e[1] - rad[1] * pr * 0.7, e[2] - rad[2] * pr * 0.7];
        const le = Math.hypot(e[0], e[1], e[2]);
        const port = R * (0.1 + this.rnd() * 0.22);
        const fin = new THREE.Vector3(
          D.x + (e[0] / le * 0.75 + rad[0] * 0.5) * port,
          D.y + (e[1] / le * 0.75 + rad[1] * 0.5) * port,
          D.z + (e[2] / le * 0.75 + rad[2] * 0.5) * port);
        const c = this._dir(), amp = R * (0.02 + this.rnd() * 0.05);
        const courbeB = new THREE.QuadraticBezierCurve3(
          new THREE.Vector3(D.x, D.y, D.z),
          new THREE.Vector3((D.x + fin.x) / 2 + c[0] * amp, (D.y + fin.y) / 2 + c[1] * amp, (D.z + fin.z) / 2 + c[2] * amp),
          fin);
        this.branches.push({ courbe: courbeB });
        const bouton = this._poser(fin.x, fin.y, fin.z, 'terminal', 0.012 * R * (0.6 + this.rnd() * 0.8));
        this._lier(iD, bouton, courbeB, 'branche');
      }
    }

    // Dendrites tangentes : projetées sur le plan tangent, sinon elles
    // percent la coque et cassent la silhouette du globe.
    for (const s of this.somas) {
      const S = A[s];
      const l0 = Math.hypot(S.x, S.y, S.z) || 1;
      const nr = [S.x / l0, S.y / l0, S.z / l0];
      const n = 4 + Math.floor(this.rnd() * 5);
      for (let i = 0; i < n; i++) {
        let d = this._dir();
        const pr = d[0] * nr[0] + d[1] * nr[1] + d[2] * nr[2];
        d = [d[0] - nr[0] * pr * 0.85, d[1] - nr[1] * pr * 0.85, d[2] - nr[2] * pr * 0.85];
        const l = Math.hypot(d[0], d[1], d[2]);
        const r = S.taille * (2 + this.rnd() * 1.8);
        const id = this._poser(S.x + d[0] / l * r, S.y + d[1] / l * r, S.z + d[2] / l * r,
                               'dendrite', 0.013 * R * (0.55 + this.rnd() * 0.9));
        arc(s, id, 0.01, 'dendrite');
      }
    }

    for (const s of this.somas) for (const v of proches(s, this.somas, 3)) arc(s, v, 0.05, 'synapse');
    const surface = this.somas.concat(this.peau);
    for (const p of this.peau) for (const v of proches(p, surface, 2)) arc(p, v, 0.012, 'peau');

    const debut = A.length;
    for (let i = 0; i < this._nBrume; i++) {
      const d = this._dir(), k = 0.22 + 0.54 * Math.pow(this.rnd(), 1 / 3);
      this._poser(d[0] * k * R, d[1] * k * R, d[2] * k * R, 'brume', 0.014 * R * (0.5 + this.rnd() * 0.9));
    }
    const greffables = [];
    for (let i = 1; i < debut; i++) greffables.push(i);
    for (let i = debut; i < A.length; i++) for (const j of proches(i, greffables, 1)) arc(i, j, 0.02, 'brume');
  }

  _lier(ia, ib, courbe, classe) {
    const A = this.amas, a = A[ia], b = A[ib];
    const id = this.aretes.length;
    this.aretes.push({ a: ia, b: ib, courbe, long: Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z), classe });
    a.voisins.push({ arete: id, autre: ib });
    b.voisins.push({ arete: id, autre: ia });
  }

  // ------------------------------------------------------------ particules

  _particules() {
    const R = this.o.rayon, A = this.amas, D = this.densite;
    const TEINTE = { noyau: 1, soma: 0.95, peau: 0.62, dendrite: 0.6, relais: 0.55, terminal: 0.7, brume: 0.34 };
    const COQUE = { soma: 1, peau: 1, dendrite: 0.7 };
    const aCentre = [], aLocal = [], aPhase = [], aVit = [], aTeinte = [], aId = [], aNorm = [], aCoque = [], aChaud = [], pos = [];

    const pousser = (id, cx, cy, cz, lx, ly, lz, t, chaud, coque, nx, ny, nz, ph, vit) => {
      aCentre.push(cx, cy, cz); aLocal.push(lx, ly, lz);
      aPhase.push(ph); aVit.push(vit);
      aTeinte.push(t); aChaud.push(chaud); aCoque.push(coque);
      aNorm.push(nx, ny, nz); aId.push(id);
      pos.push(cx + lx, cy + ly, cz + lz);
    };

    // Noyau en trois couches : cœur compact, chromosphère, couronne en
    // jets. La décroissance de densité est ce qui donne l'éclat d'astre.
    const Rn = A[this.NOYAU].taille;
    // Le coeur etait sature : 1400 particules dans un volume minuscule,
    // en additif, donnent un aplat blanc ou les trois couches disparaissent.
    const nC = Math.round(620 * D), nH = Math.round(640 * D), nK = Math.round(1200 * D);
    for (let i = 0; i < nC; i++) {
      const d = this._dir(), r = Math.pow(this.rnd(), 0.55) * 0.62;
      pousser(this.NOYAU, 0, 0, 0, d[0] * r * Rn, d[1] * r * Rn, d[2] * r * Rn, 0.5, 1, 0, d[0], d[1], d[2], this.rnd() * 6.2832, 0.5 + this.rnd());
    }
    for (let i = 0; i < nH; i++) {
      const d = this._dir(), r = 0.62 + Math.pow(this.rnd(), 0.7) * 0.42;
      pousser(this.NOYAU, 0, 0, 0, d[0] * r * Rn, d[1] * r * Rn, d[2] * r * Rn, 0.42, 0.86, 0, d[0], d[1], d[2], this.rnd() * 6.2832, 0.7 + this.rnd() * 1.2);
    }
    const axes = [];
    for (let j = 0; j < 72; j++) axes.push(this._fibo(72, j));
    for (let i = 0; i < nK; i++) {
      const ax = axes[Math.floor(this.rnd() * axes.length)];
      const d = this._dir(), et = 0.16 + this.rnd() * 0.2;
      const vx = ax[0] + d[0] * et, vy = ax[1] + d[1] * et, vz = ax[2] + d[2] * et;
      const l = Math.hypot(vx, vy, vz), r = 1.05 + Math.pow(this.rnd(), 1.8) * 1.55;
      pousser(this.NOYAU, 0, 0, 0, vx / l * r * Rn, vy / l * r * Rn, vz / l * r * Rn,
              0.26 + this.rnd() * 0.22, 0.72, 0, vx / l, vy / l, vz / l, this.rnd() * 6.2832, 0.3 + this.rnd() * 0.8);
    }

    const NB = {
      soma: [140, 260], peau: [10, 26], dendrite: [12, 30],
      relais: [10, 24], terminal: [12, 30], brume: [8, 18]
    };
    const MEM = { soma: 0.36, peau: 0.15, dendrite: 0.1, relais: 0.1, terminal: 0.25, brume: 0 };
    for (let a = 1; a < A.length; a++) {
      const c = A[a], pl = NB[c.type] || NB.brume;
      const n = Math.max(4, Math.round((pl[0] + Math.floor(this.rnd() * (pl[1] - pl[0]))) * D));
      const mem = MEM[c.type] ?? 0;
      const dist = Math.hypot(c.x, c.y, c.z) || 1;
      for (let i = 0; i < n; i++) {
        const d = this._dir();
        // Une part des particules est posée sur la membrane : c'est ce
        // contour net qui fait lire une cellule plutôt qu'un nuage.
        const r = (this.rnd() < mem) ? (0.9 + this.rnd() * 0.12) : Math.min(0.95, Math.abs(this._gauss()) * 0.38);
        pousser(a, c.x, c.y, c.z, d[0] * r * c.taille, d[1] * r * c.taille, d[2] * r * c.taille,
                (TEINTE[c.type] ?? 0.5) * (0.8 + this.rnd() * 0.2), 0, COQUE[c.type] || 0,
                c.x / dist, c.y / dist, c.z / dist, c.ph, c.vit);
      }
    }
    this.N = aId.length;
    this.posInit = pos;

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aCentre', new THREE.Float32BufferAttribute(aCentre, 3));
    g.setAttribute('aLocal', new THREE.Float32BufferAttribute(aLocal, 3));
    g.setAttribute('aNorm', new THREE.Float32BufferAttribute(aNorm, 3));
    g.setAttribute('aPhase', new THREE.Float32BufferAttribute(aPhase, 1));
    g.setAttribute('aVit', new THREE.Float32BufferAttribute(aVit, 1));
    g.setAttribute('aTeinte', new THREE.Float32BufferAttribute(aTeinte, 1));
    g.setAttribute('aChaud', new THREE.Float32BufferAttribute(aChaud, 1));
    g.setAttribute('aCoque', new THREE.Float32BufferAttribute(aCoque, 1));
    g.setAttribute('aId', new THREE.Float32BufferAttribute(aId, 1));
    this.geo = g;
    this._jetables.push(g);

    // État vivant transmis par texture : quelques centaines d'amas tiennent
    // dans 64×N texels. Aucun buffer de particules n'est réécrit par frame.
    this.TW = 64;
    this.TH = Math.ceil(A.length / 64);
    this.donnees = new Float32Array(this.TW * this.TH * 4);
    this.texEtat = new THREE.DataTexture(this.donnees, this.TW, this.TH, THREE.RGBAFormat, THREE.FloatType);
    this.texEtat.minFilter = this.texEtat.magFilter = THREE.NearestFilter;
    this.texEtat.generateMipmaps = false;
    this.texEtat.needsUpdate = true;
    this._jetables.push(this.texEtat);

    const COMMUN = `
      attribute vec3 aCentre; attribute vec3 aLocal; attribute vec3 aNorm;
      attribute float aPhase; attribute float aVit; attribute float aTeinte;
      attribute float aChaud; attribute float aCoque; attribute float aId;
      uniform float uT; uniform sampler2D uEtat; uniform vec2 uDim; uniform float uLimbe;
      varying float vProf; varying float vTeinte; varying float vFeu; varying float vLimbe; varying float vChaud;
      vec3 vivant() {
        vec2 uv = (vec2(mod(aId, uDim.x), floor(aId / uDim.x)) + 0.5) / uDim;
        vec4 e = texture2D(uEtat, uv);
        vFeu = e.w; vChaud = aChaud;
        // Éclaircissement de limbe : plus la normale de coque est rasante,
        // plus la particule brille. C'est le signal optique qui fait lire
        // une sphère pleine et non un nuage de points.
        vec3 nv = normalize(normalMatrix * aNorm);
        vLimbe = 1.0 + aCoque * uLimbe * pow(1.0 - abs(nv.z), 2.6);
        float s = 1.0 + e.w * 0.45;
        return (aCentre + e.xyz) + aLocal * s * (1.0 + sin(uT * aVit + aPhase) * 0.07);
      }`;

    const FS = `
      uniform float uDensite; uniform float uOpacite; uniform vec3 uCouleur;
      varying float vProf; varying float vTeinte; varying float vFeu; varying float vLimbe; varying float vChaud;
      vec4 teinte(float alpha) {
        float d = uDensite * vProf;
        float brume = 1.0 - exp(-d * d);
        float m = clamp(max(vChaud, vFeu), 0.0, 1.0);
        vec3 c = uCouleur * vTeinte * vLimbe * (1.0 + vFeu * 1.15 + vChaud * 0.6 + m * 0.15);
        return vec4(c, alpha * uOpacite * (1.0 - brume) * min(1.6, vLimbe));
      }`;

    this.uDim = { value: new THREE.Vector2(this.TW, this.TH) };
    this.uBrume = { value: 0.003 };
    this.uCouleurReseau = { value: this.teinteReseau };
    const base = () => ({
      uT: this.uT, uEtat: { value: this.texEtat }, uDim: this.uDim,
      uDensite: this.uBrume, uLimbe: this.uLimbe, uCouleur: this.uCouleurReseau
    });
    this._baseUniforms = base;

    const matPts = new THREE.ShaderMaterial({
      uniforms: Object.assign(base(), { uMap: { value: this.texNet }, uSize: { value: 1.05 }, uOpacite: { value: 0.78 } }),
      vertexShader: COMMUN + `
        uniform float uSize;
        void main() {
          vec4 mv = modelViewMatrix * vec4(vivant(), 1.0);
          vProf = -mv.z; vTeinte = aTeinte;
          gl_PointSize = uSize * (330.0 / max(1.0, -mv.z)) * (1.0 + vFeu * 0.9 + aChaud * 0.35);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: 'uniform sampler2D uMap;\n' + FS + 'void main() { gl_FragColor = teinte(texture2D(uMap, gl_PointCoord).a); }',
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false
    });
    this._jetables.push(matPts);
    this.monde.add(new THREE.Points(g, matPts));

    this._COMMUN = COMMUN;
    this._FS = FS;
    this._maillage();
    this._astre();
  }

  _maillage() {
    // Topologie figée : les amas sont rigides, leurs voisins ne changent
    // jamais. Recalculer la proximité chaque frame coûterait plus cher
    // que tout le rendu réuni.
    // Le maillage est le premier poste de remplissage : chaque liaison est
    // un segment additif, et leur nombre croît au cube du seuil. Diviser
    // le seuil par 1.15 retire un tiers des liaisons pour une différence
    // visuelle à peine perceptible.
    const seuil = (this.o.seuil ?? this.preset.seuil) * (this.o.rayon / 80);
    const pos = this.posInit, N = this.N;
    const cell = seuil, grille = new Map();
    for (let i = 0; i < N; i++) {
      const cle = Math.floor(pos[i * 3] / cell) + ',' + Math.floor(pos[i * 3 + 1] / cell) + ',' + Math.floor(pos[i * 3 + 2] / cell);
      let s = grille.get(cle); if (!s) { s = []; grille.set(cle, s); } s.push(i);
    }
    const idx = [], S2 = seuil * seuil, plafond = 260000 * 2;
    for (let i = 0; i < N && idx.length < plafond; i++) {
      const gx = Math.floor(pos[i * 3] / cell), gy = Math.floor(pos[i * 3 + 1] / cell), gz = Math.floor(pos[i * 3 + 2] / cell);
      for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) for (let oz = -1; oz <= 1; oz++) {
        const s = grille.get((gx + ox) + ',' + (gy + oy) + ',' + (gz + oz));
        if (!s) continue;
        for (let m = 0; m < s.length; m++) {
          const j = s[m]; if (j <= i) continue;
          const dx = pos[i * 3] - pos[j * 3], dy = pos[i * 3 + 1] - pos[j * 3 + 1], dz = pos[i * 3 + 2] - pos[j * 3 + 2];
          if (dx * dx + dy * dy + dz * dz < S2) idx.push(i, j);
        }
      }
    }
    this.nbLiaisons = idx.length / 2;
    const gl = this.geo.clone();
    gl.setIndex(idx);
    const m = new THREE.ShaderMaterial({
      uniforms: Object.assign(this._baseUniforms(), { uOpacite: { value: 0.36 } }),
      vertexShader: this._COMMUN + `
        void main() {
          vec4 mv = modelViewMatrix * vec4(vivant(), 1.0);
          vProf = -mv.z; vTeinte = aTeinte * 1.05;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: this._FS + 'void main() { gl_FragColor = teinte(1.0); }',
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false
    });
    this._jetables.push(gl, m);
    this.monde.add(new THREE.LineSegments(gl, m));
  }

  _astre() {
    const R = this.o.rayon;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array([0.16, 0.16, 0.17, 0.40, 0.40, 0.42]), 3));
    g.setAttribute('aTaille', new THREE.BufferAttribute(new Float32Array([0.115 * R * 5.4, 0.115 * R * 2.1]), 1));
    const m = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: this.texHalo } },
      vertexShader: `
        attribute float aTaille; varying vec3 vC;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vC = color;
          gl_PointSize = aTaille * (330.0 / max(1.0, -mv.z));
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform sampler2D uMap; varying vec3 vC;
        void main() { gl_FragColor = vec4(vC, texture2D(uMap, gl_PointCoord).a); }`,
      vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false
    });
    this._jetables.push(g, m);
    this.monde.add(new THREE.Points(g, m));
  }

  // -------------------------------------------------------------- rubans

  /**
   * Les lignes GL sont plafonnées à 1 pixel sur la quasi-totalité des
   * pilotes. Chaque segment devient donc un quad dont le shader écarte
   * les bords en espace écran : épaisseur réelle, constante en distance.
   */
  _ruban(liste, seg, largeur, opacite, douceur, fondu) {
    const nSeg = liste.length * seg;
    if (!nSeg) return null;
    const aP = new Float32Array(nSeg * 12), aAutre = new Float32Array(nSeg * 12);
    const aCote = new Float32Array(nSeg * 4), aT = new Float32Array(nSeg * 4);
    const index = new Uint32Array(nSeg * 6);
    let v = 0, w = 0, q = 0;
    for (const l of liste) {
      const p = l.courbe.getPoints(seg);
      for (let s = 0; s < seg; s++) {
        const a = p[s], b = p[s + 1], ta = s / seg, tb = (s + 1) / seg;
        // A l'extremite b, aAutre vaut a : la direction du segment est
        // donc inversee, et la normale aussi. Sans inverser le cote, le
        // quad se croise en sablier — c'est ce qui produisait les
        // triangles parasites partout dans le globe.
        const paires = [[a, b, -1, ta], [a, b, 1, ta], [b, a, 1, tb], [b, a, -1, tb]];
        for (const [pt, autre, cote, t] of paires) {
          aP[v] = pt.x; aP[v + 1] = pt.y; aP[v + 2] = pt.z;
          aAutre[v] = autre.x; aAutre[v + 1] = autre.y; aAutre[v + 2] = autre.z;
          aCote[w] = cote; aT[w] = t;
          v += 3; w += 1;
        }
        const o = q * 4;
        index[q * 6] = o; index[q * 6 + 1] = o + 1; index[q * 6 + 2] = o + 3;
        index[q * 6 + 3] = o; index[q * 6 + 4] = o + 3; index[q * 6 + 5] = o + 2;
        q++;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(aP, 3));
    g.setAttribute('aAutre', new THREE.BufferAttribute(aAutre, 3));
    g.setAttribute('aCote', new THREE.BufferAttribute(aCote, 1));
    g.setAttribute('aT', new THREE.BufferAttribute(aT, 1));
    g.setIndex(new THREE.BufferAttribute(index, 1));

    const m = new THREE.ShaderMaterial({
      uniforms: {
        uRes: { value: new THREE.Vector2(this.LARG || 1, this.HAUT || 1) },
        uLargeur: { value: largeur },
        uOpacite: { value: opacite },
        uDouceur: { value: douceur ?? 0.6 },
        uFondu: { value: fondu ? new THREE.Vector2(fondu[0], fondu[1]) : new THREE.Vector2(-1, -0.5) },
        uDensite: this.uBrume,
        uCouleur: this.uCouleurReseau
      },
      vertexShader: `
        attribute vec3 aAutre; attribute float aCote; attribute float aT;
        uniform vec2 uRes; uniform float uLargeur;
        varying float vProf; varying float vCote; varying float vT; varying float vAtt;
        void main() {
          mat4 mvp = projectionMatrix * modelViewMatrix;
          vec4 c0 = mvp * vec4(position, 1.0);
          vec4 c1 = mvp * vec4(aAutre, 1.0);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vProf = -mv.z; vCote = aCote; vT = aT;
          // Direction mesurée en pixels : en NDC, l'écartement se déforme
          // avec le rapport d'aspect de la fenêtre.
          vec2 n0 = c0.xy / c0.w * uRes;
          vec2 n1 = c1.xy / c1.w * uRes;
          vec2 d = n1 - n0;
          float l = length(d);
          // Un segment presque parallele a l'axe de vue se projette sur
          // quelques pixels : la direction devient du bruit et le quad
          // s'ouvre en coin. On annule l'ecartement et on l'efface.
          vec2 dir = l > 0.5 ? d / l : vec2(0.0);
          vAtt = smoothstep(0.35, 2.5, l);
          c0.xy += (vec2(-dir.y, dir.x) * aCote * uLargeur * 0.5) / uRes * c0.w;
          gl_Position = c0;
        }`,
      fragmentShader: `
        uniform float uOpacite; uniform float uDensite; uniform float uDouceur;
        uniform vec2 uFondu; uniform vec3 uCouleur;
        varying float vProf; varying float vCote; varying float vT; varying float vAtt;
        void main() {
          float d = uDensite * vProf;
          float brume = 1.0 - exp(-d * d);
          // Dégradé transversal : un ruban large rendu à plat se lit comme
          // une bande de papier ; atténué sur les bords, il redevient un fil.
          float profil = mix(1.0, 1.0 - vCote * vCote, uDouceur);
          // Fondu longitudinal : la liaison s'éteint près de son origine,
          // pour ne pas s'empiler dans une zone déjà saturée.
          float f = smoothstep(uFondu.x, uFondu.y, vT);
          gl_FragColor = vec4(uCouleur, uOpacite * profil * f * vAtt * (1.0 - brume));
        }`,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
    });
    this.rubansMat.push(m);
    this._jetables.push(g, m);
    const mesh = new THREE.Mesh(g, m);
    this.monde.add(mesh);
    return mesh;
  }

  _liaisons() {
    const e = this.o.epaisseur;
    const parClasse = c => this.aretes.filter(a => a.classe === c);
    // Trois couches pour un axone net : halo de présence, corps à bords
    // francs, filet à profil plat. C'est le filet qui fait la netteté —
    // un dégradé, aussi lumineux soit-il, reste flou.
    this._ruban(this.axones, 48, e.axoneGaine, 0.030, 1.0, [0.09, 0.50]);
    this._ruban(this.axones, 48, e.axone, 0.17, 0.16, [0.08, 0.40]);
    this._ruban(this.axones, 48, e.axoneFilet, 0.42, 0.0, [0.07, 0.34]);
    this._ruban(this.branches, 32, e.brancheCorps, 0.13, 0.5);
    this._ruban(this.branches, 32, e.brancheFilet, 0.30, 0.0);
    this._ruban(parClasse('synapse'), 24, e.synapse, 0.19, 0.45);
    this._ruban(parClasse('peau'), 14, e.peau, 0.14, 0.4);
    this._ruban(parClasse('dendrite').concat(parClasse('brume')), 10, e.fine, 0.12, 0.35);
  }

  _influxRendu() {
    // Chaque influx est une boule : halo large et cœur brûlant à la même
    // position. PointsMaterial n'a qu'une taille, il faut donc deux
    // matériaux partageant la même géométrie.
    // Plafond de sécurité : chaque influx dessine un halo large en additif,
    // le coût est en surface, pas en nombre d'objets.
    const max = 900, b = this.o.boule;
    this.MAX_INFLUX = max;
    this.TRAINE = 3;
    this.posTete = new Float32Array(max * 3);
    this.colTete = new Float32Array(max * 3);
    this.geoTete = new THREE.BufferGeometry();
    this.geoTete.setAttribute('position', new THREE.BufferAttribute(this.posTete, 3));
    this.geoTete.setAttribute('color', new THREE.BufferAttribute(this.colTete, 3));
    const mHalo = new THREE.PointsMaterial({
      size: b.halo, map: this.texHalo, vertexColors: true, transparent: true,
      opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true
    });
    const mCoeur = new THREE.PointsMaterial({
      size: b.coeur, map: this.texNet, vertexColors: true, transparent: true,
      opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true
    });
    this.monde.add(new THREE.Points(this.geoTete, mHalo));
    this.monde.add(new THREE.Points(this.geoTete, mCoeur));

    this.posQueue = new Float32Array(max * this.TRAINE * 3);
    this.colQueue = new Float32Array(max * this.TRAINE * 3);
    this.geoQueue = new THREE.BufferGeometry();
    this.geoQueue.setAttribute('position', new THREE.BufferAttribute(this.posQueue, 3));
    this.geoQueue.setAttribute('color', new THREE.BufferAttribute(this.colQueue, 3));
    const mQueue = new THREE.PointsMaterial({
      size: b.coeur * 0.55, map: this.texPoint, vertexColors: true, transparent: true,
      opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true
    });
    this.monde.add(new THREE.Points(this.geoQueue, mQueue));
    this._jetables.push(this.geoTete, this.geoQueue, mHalo, mCoeur, mQueue);

    this.influx = [];
    this._tmp = new THREE.Vector3();
  }

  // ------------------------------------------------------------ post-effet

  _initPost() {
    const o = this.o.rendu, d = this.preset.bloomDivision;
    const pr = this.renderer.getPixelRatio();
    this.LARG = Math.max(1, Math.floor(this.conteneur.clientWidth * pr));
    this.HAUT = Math.max(1, Math.floor(this.conteneur.clientHeight * pr));
    const opts = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat, stencilBuffer: false };
    // Le supersampling suit la qualité : inutile de payer 1.8x de fill
    // rate sur une machine qui a déjà choisi le preset bas.
    this.SS = Math.min(o.superEchantillon, this.preset.ss);

    // Le `antialias` du renderer ne s'applique PAS quand on rend dans une
    // cible : sans ça, tout le post-traitement se paie d'un crénelage sur
    // les fibres. Deux parades, cumulables : MSAA quand le contexte le
    // permet, et un rendu interne agrandi puis réduit par filtrage.
    const sw = Math.floor(this.LARG * this.SS), sh = Math.floor(this.HAUT * this.SS);
    // MSAA et supersampling font le même travail : les cumuler multipliait
    // le nombre d'échantillons par sept sans gain visible. On ne prend le
    // MSAA que si le rendu interne est à l'échelle 1.
    const msaa = this.SS <= 1.05 && this.renderer.capabilities.isWebGL2;
    if (msaa && typeof THREE.WebGLMultisampleRenderTarget === 'function') {
      this.rtScene = new THREE.WebGLMultisampleRenderTarget(sw, sh, { ...opts, depthBuffer: true });
      this.rtScene.samples = 4;
    } else {
      this.rtScene = new THREE.WebGLRenderTarget(sw, sh, { ...opts, depthBuffer: true });
      if (msaa && 'samples' in this.rtScene) this.rtScene.samples = 4;
    }
    const q = d * 2;
    this.rtA = new THREE.WebGLRenderTarget(Math.floor(this.LARG / d), Math.floor(this.HAUT / d), { ...opts, depthBuffer: false });
    this.rtB = new THREE.WebGLRenderTarget(Math.floor(this.LARG / d), Math.floor(this.HAUT / d), { ...opts, depthBuffer: false });
    this.rtC = new THREE.WebGLRenderTarget(Math.floor(this.LARG / q), Math.floor(this.HAUT / q), { ...opts, depthBuffer: false });
    this.rtD = new THREE.WebGLRenderTarget(Math.floor(this.LARG / q), Math.floor(this.HAUT / q), { ...opts, depthBuffer: false });

    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quadScene = new THREE.Scene();
    this.quadMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null);
    this.quadScene.add(this.quadMesh);
    this._jetables.push(this.quadMesh.geometry);

    const VS = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

    // Extraction : on soustrait le seuil au lieu de couper net, sinon le
    // halo garde un bord dur là où il devrait se fondre.
    this.matSeuil = new THREE.ShaderMaterial({
      uniforms: { uTex: { value: null }, uSeuil: { value: o.bloomSeuil } },
      vertexShader: VS,
      fragmentShader: `
        uniform sampler2D uTex; uniform float uSeuil; varying vec2 vUv;
        void main() {
          vec3 c = texture2D(uTex, vUv).rgb;
          float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
          gl_FragColor = vec4(c * (max(0.0, l - uSeuil) / max(0.0001, l)), 1.0);
        }`,
      depthTest: false, depthWrite: false
    });

    // Flou séparable : 9 + 9 échantillons au lieu de 81 pour le même flou.
    this.matFlou = new THREE.ShaderMaterial({
      uniforms: { uTex: { value: null }, uPas: { value: new THREE.Vector2() } },
      vertexShader: VS,
      fragmentShader: `
        uniform sampler2D uTex; uniform vec2 uPas; varying vec2 vUv;
        void main() {
          float p[5];
          p[0] = 0.227027; p[1] = 0.194594; p[2] = 0.121621; p[3] = 0.054054; p[4] = 0.016216;
          vec3 s = texture2D(uTex, vUv).rgb * p[0];
          for (int i = 1; i < 5; i++) {
            vec2 o = uPas * float(i);
            s += texture2D(uTex, vUv + o).rgb * p[i];
            s += texture2D(uTex, vUv - o).rgb * p[i];
          }
          gl_FragColor = vec4(s, 1.0);
        }`,
      depthTest: false, depthWrite: false
    });

    this.matCompo = new THREE.ShaderMaterial({
      uniforms: {
        uScene: { value: null }, uBloom: { value: null }, uBloomLarge: { value: null },
        uForce: { value: o.bloomIntensite },
        uLarge: { value: o.bloomLarge },
        uTexel: { value: new THREE.Vector2(1 / (this.LARG * this.SS), 1 / (this.HAUT * this.SS)) },
        uNettete: { value: o.nettete },
        uVignette: { value: o.vignette },
        uExposition: { value: o.exposition },
        uGrain: { value: o.grain },
        uOpaque: { value: this.o.fondTransparent ? 0 : 1 }
      },
      vertexShader: VS,
      fragmentShader: `
        uniform sampler2D uScene; uniform sampler2D uBloom; uniform sampler2D uBloomLarge;
        uniform float uForce; uniform float uLarge; uniform vec2 uTexel;
        uniform float uNettete; uniform float uVignette; uniform float uExposition;
        uniform float uGrain; uniform float uOpaque;
        varying vec2 vUv;

        // Courbe filmique ACES : elle écrase les hautes lumières en
        // conservant leur teinte, là où une simple division les décolore
        // vers le blanc. C'est ce qui garde l'ambre des flux dans le halo.
        vec3 aces(vec3 x) {
          return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
        }

        void main() {
          vec3 c = texture2D(uScene, vUv).rgb;
          // Masque flou : on relève le contraste local. Un point isolé
          // gagne en netteté, une zone uniforme n'est pas touchée.
          vec3 moy = (texture2D(uScene, vUv + vec2(uTexel.x, 0.0)).rgb
                    + texture2D(uScene, vUv - vec2(uTexel.x, 0.0)).rgb
                    + texture2D(uScene, vUv + vec2(0.0, uTexel.y)).rgb
                    + texture2D(uScene, vUv - vec2(0.0, uTexel.y)).rgb) * 0.25;
          c = max(c + (c - moy) * uNettete, vec3(0.0));

          // Deux échelles de halo : la fine cerne les sources, la large
          // porte l'atmosphère. Une seule échelle donne soit un liseré
          // dur, soit une brume sans point d'accroche.
          c += texture2D(uBloom, vUv).rgb * uForce;
          c += texture2D(uBloomLarge, vUv).rgb * uForce * uLarge;

          c = aces(c * uExposition);

          vec2 d = vUv - 0.5;
          c *= 1.0 - dot(d, d) * uVignette;

          // Bruit d'un demi-niveau : sur un dégradé sombre étendu, le 8 bits
          // laisse des anneaux visibles ; le grain les casse.
          float bruit = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
          c += (bruit - 0.5) * uGrain;

          float a = mix(clamp(max(c.r, max(c.g, c.b)) * 1.7, 0.0, 1.0), 1.0, uOpaque);
          gl_FragColor = vec4(c, a);
        }`,
      depthTest: false, depthWrite: false, transparent: true
    });
    this._jetables.push(this.matSeuil, this.matFlou, this.matCompo);
    this.redimensionner();
  }

  _rendu() {
    const r = this.renderer, o = this.o.rendu;
    const passes = this._passes ?? this.preset.bloomPasses;
    r.setRenderTarget(this.rtScene); r.clear(); r.render(this.scene, this.camera);

    const passe = (mat, sortie) => {
      this.quadMesh.material = mat;
      r.setRenderTarget(sortie); r.clear(); r.render(this.quadScene, this.quadCam);
    };
    this.matSeuil.uniforms.uTex.value = this.rtScene.texture;
    passe(this.matSeuil, this.rtA);

    // Chaîne fine, en demi-résolution : le halo serré autour des sources.
    for (let i = 0; i < passes; i++) {
      const ec = o.bloomRayon * (i + 1);
      this.matFlou.uniforms.uTex.value = this.rtA.texture;
      this.matFlou.uniforms.uPas.value.set(ec / this.rtA.width, 0);
      passe(this.matFlou, this.rtB);
      this.matFlou.uniforms.uTex.value = this.rtB.texture;
      this.matFlou.uniforms.uPas.value.set(0, ec / this.rtA.height);
      passe(this.matFlou, this.rtA);
    }

    // Chaîne large, en quart de résolution, repartant du résultat fin :
    // on obtient un halo bien plus étendu pour un coût quatre fois moindre
    // qu'en élargissant simplement le rayon de la première chaîne.
    this.matFlou.uniforms.uTex.value = this.rtA.texture;
    this.matFlou.uniforms.uPas.value.set(o.bloomRayon * 1.5 / this.rtC.width, 0);
    passe(this.matFlou, this.rtD);
    for (let i = 0; i < passes; i++) {
      const ec = o.bloomRayon * 2.2 * (i + 1);
      this.matFlou.uniforms.uTex.value = this.rtD.texture;
      this.matFlou.uniforms.uPas.value.set(0, ec / this.rtC.height);
      passe(this.matFlou, this.rtC);
      this.matFlou.uniforms.uTex.value = this.rtC.texture;
      this.matFlou.uniforms.uPas.value.set(ec / this.rtC.width, 0);
      passe(this.matFlou, this.rtD);
    }

    this.matCompo.uniforms.uScene.value = this.rtScene.texture;
    this.matCompo.uniforms.uBloom.value = this.rtA.texture;
    this.matCompo.uniforms.uBloomLarge.value = this.rtD.texture;
    this.matCompo.uniforms.uLarge.value = (this._large ?? 1) * o.bloomLarge;
    this.quadMesh.material = this.matCompo;
    r.setRenderTarget(null); r.clear(); r.render(this.quadScene, this.quadCam);
  }

  // ------------------------------------------------------------------ vie

  _emettre(idArete, depuis, force, source) {
    const r = this.o.reseau;
    if (this.influx.length >= this.MAX_INFLUX - r.rafale) return;
    const A = this.aretes[idArete];
    const sens = A.a === depuis ? 1 : -1;
    const v = r.vitesseInflux / Math.max(6, A.long);
    // Un train de paquets : le premier porte le signal, les suivants ne
    // sont que du trafic. Densité visible multipliée, dynamique intacte.
    for (let n = 0; n < r.rafale; n++) {
      this.influx.push({
        e: idArete, sens, t: -n * 0.085, porteur: n === 0,
        v: v * (0.94 + this.rnd() * 0.14),
        force: force * (n === 0 ? 1 : 0.55 + this.rnd() * 0.3),
        source
      });
    }
  }

  _decharger(ia, depuis, force, source) {
    const r = this.o.reseau, A = this.amas[ia];
    if (A.refract > 0) return;
    A.activite = Math.min(1.5, A.activite + force);
    A.refract = 0.3 + this.rnd() * 0.5;
    A.charge = 0;
    if (A.type === 'terminal') this.o.surEvenement?.('terminaison', { amas: ia });
    let br = 0;
    for (const v of A.voisins) {
      if (v.autre === depuis || br >= r.relaisMax) continue;
      // Probabilité < 1 : à 1.0 la première impulsion embrase tout
      // l'organisme et plus rien ne se distingue.
      if (this.rnd() > r.relais * Math.min(1, force)) continue;
      this._emettre(v.arete, ia, force * (0.74 + this.rnd() * 0.2), source);
      br++;
    }
  }

  _recevoir(ia, depuis, force, source) {
    const A = this.amas[ia];
    if (ia === this.NOYAU && !this.o.reseau.noyauActif) return;
    if (A.type === 'soma') A.charge += this.o.reseau.excitation * force;
    this._decharger(ia, depuis, force, source);
  }

  _dechargerSoma(id) {
    const A = this.amas[id];
    A.charge = 0;
    A.activite = Math.min(1.5, A.activite + 1.2);
    A.refract = 0.4;
    this.o.surEvenement?.('decharge', { amas: id, soma: this.somas.indexOf(id) });
    for (const v of A.voisins) {
      if (this.rnd() > 0.8) continue;
      this._emettre(v.arete, id, 1.0, 'soma');
    }
  }

  // ---------------------------------------------------------- interaction

  _initInteraction() {
    const el = this.renderer.domElement;
    const it = this.o.interaction;
    this._ecouteurs = [];
    this.vx = 0; this.vy = 0;
    let drag = false, lx = 0, ly = 0, bouge = false, dragBouton = -1;

    const on = (type, fn, opts) => { el.addEventListener(type, fn, opts); this._ecouteurs.push([type, fn]); };

    on('pointerdown', e => {
      const deplacement = e.button === 2;
      if (!it.rotation && !it.clic && !deplacement) return;
      drag = true; bouge = false; lx = e.clientX; ly = e.clientY; dragBouton = e.button;
      el.setPointerCapture?.(e.pointerId);
    });
    on('pointermove', e => {
      if (!drag) return;
      const dx = e.clientX - lx, dy = e.clientY - ly;
      if (Math.abs(dx) + Math.abs(dy) > 2) bouge = true;
      if (dragBouton === 2) {
        // Clic droit : deplace le globe dans le plan de la camera, sans le faire tourner.
        const visible = 2 * Math.tan((this.o.camera.fov * Math.PI / 180) / 2) * this.camera.position.z;
        const echelle = visible / Math.max(1, el.clientHeight);
        this.monde.position.x += dx * echelle;
        this.monde.position.y -= dy * echelle;
      } else if (it.rotation) {
        this.monde.rotation.y += dx * 0.004; this.monde.rotation.x += dy * 0.004;
        this.ciel.rotation.y += dx * 0.001; this.ciel.rotation.x += dy * 0.001;
        this.vx = dx * 0.06; this.vy = dy * 0.06;
      }
      lx = e.clientX; ly = e.clientY;
    });
    const relacher = () => {
      if (drag && !bouge && it.clic && dragBouton !== 2) this.pulse();
      drag = false; dragBouton = -1;
    };
    on('pointerup', relacher);
    on('pointercancel', relacher);
    on('wheel', e => {
      if (!it.zoom) return;
      e.preventDefault();
      const c = this.o.camera;
      this.zoomCible = Math.max(c.min, Math.min(c.max, this.zoomCible + e.deltaY * 0.28));
    }, { passive: false });
  }

  _initObservateurs() {
    // ResizeObserver sur le conteneur, pas sur window : le composant peut
    // vivre dans un panneau redimensionnable sans que la fenêtre bouge.
    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(() => this.redimensionner());
      this._ro.observe(this.conteneur);
    }
    if (this.o.autoPause) {
      if (typeof IntersectionObserver !== 'undefined') {
        this._io = new IntersectionObserver(entries => {
          this._visible = entries[0].isIntersecting;
        }, { threshold: 0.01 });
        this._io.observe(this.conteneur);
      }
      this._visible = true;
      this._surVisibilite = () => { this._ongletVisible = !document.hidden; if (!document.hidden) this._dernier = performance.now(); };
      this._ongletVisible = !document.hidden;
      document.addEventListener('visibilitychange', this._surVisibilite);
    } else {
      this._visible = true; this._ongletVisible = true;
    }
  }

  // ----------------------------------------------------------- boucle

  _boucle(now) {
    if (this.detruit) return;
    this._raf = requestAnimationFrame(this._boucle);
    if (this.enPause || (this.o.autoPause && (!this._visible || !this._ongletVisible))) {
      this._dernier = now;
      return;
    }

    const brut = Math.min((now - this._dernier) / 1000, 0.05);
    this._dernier = now;
    const dt = brut * this.o.vitesse;
    const T = now / 1000;
    this.uT.value = T;

    this.monde.rotation.y += (this.o.rotation + this.vy) * dt;
    this.monde.rotation.x += this.vx * dt;
    this.ciel.rotation.y += this.o.rotation * 0.2 * dt;
    this.vx *= 0.94; this.vy *= 0.94;
    this.monde.rotation.x = Math.max(-1.2, Math.min(1.2, this.monde.rotation.x));
    this.camera.position.z += (this.zoomCible - this.camera.position.z) * Math.min(1, brut * 5.5);

    const r = this.o.reseau, A = this.amas, don = this.donnees;
    for (let i = 0; i < A.length; i++) {
      const a = A[i];
      a.activite = Math.max(0, a.activite - dt * r.metabolisme);
      a.refract = Math.max(0, a.refract - dt);
      if (a.type === 'soma') {
        a.charge += dt;
        if (a.charge >= a.seuilCharge && a.refract <= 0) this._dechargerSoma(i);
      }
      let lueur = a.activite;
      if (i === this.NOYAU && !r.noyauActif) lueur = 0;
      if (a.type === 'soma') {
        // Montée quadratique : en linéaire tout le globe scintille en
        // permanence ; en quadratique la charge ne se voit qu'à la fin.
        const pret = Math.min(1, a.charge / a.seuilCharge);
        lueur = Math.max(lueur, pret * pret * 0.3);
      }
      const o = i * 4;
      don[o] = Math.sin(T * a.dVit[0] + a.dPh[0]) * a.dAmp;
      don[o + 1] = Math.sin(T * a.dVit[1] + a.dPh[1]) * a.dAmp;
      don[o + 2] = Math.sin(T * a.dVit[2] + a.dPh[2]) * a.dAmp;
      don[o + 3] = lueur;
    }
    this.texEtat.needsUpdate = true;

    let k = 0, h = 0;
    const tmp = this._tmp, TR = this.TRAINE;
    for (let i = this.influx.length - 1; i >= 0; i--) {
      const f = this.influx[i], E = this.aretes[f.e];
      f.t += f.v * dt;
      if (f.t >= 1) {
        if (f.porteur) this._recevoir(f.sens > 0 ? E.b : E.a, f.sens > 0 ? E.a : E.b, f.force, f.source);
        this.influx.splice(i, 1);
        continue;
      }
      if (f.t < 0) continue;
      const col = this.fluxCouleur[f.source] || this.fluxCouleur.soma;
      const b = f.sens > 0 ? f.t : 1 - f.t;
      const g0 = Math.min(1, f.force);
      E.courbe.getPoint(b, tmp);
      if (h < this.MAX_INFLUX) {
        this.posTete[h * 3] = tmp.x; this.posTete[h * 3 + 1] = tmp.y; this.posTete[h * 3 + 2] = tmp.z;
        this.colTete[h * 3] = col[0] * g0; this.colTete[h * 3 + 1] = col[1] * g0; this.colTete[h * 3 + 2] = col[2] * g0;
        h++;
      }
      for (let q = 1; q <= TR && k < this.MAX_INFLUX * TR; q++) {
        const t = Math.max(0, Math.min(1, b - q * 0.035 * f.sens));
        E.courbe.getPoint(t, tmp);
        this.posQueue[k * 3] = tmp.x; this.posQueue[k * 3 + 1] = tmp.y; this.posQueue[k * 3 + 2] = tmp.z;
        const g = (1 - q / (TR + 1)) * g0 * 0.7;
        this.colQueue[k * 3] = col[0] * g; this.colQueue[k * 3 + 1] = col[1] * g; this.colQueue[k * 3 + 2] = col[2] * g;
        k++;
      }
    }
    // Les emplacements libres passent en noir : en additif ils n'ajoutent
    // rien, inutile de redimensionner les géométries.
    for (let z = h; z < this.MAX_INFLUX; z++) { this.colTete[z * 3] = 0; this.colTete[z * 3 + 1] = 0; this.colTete[z * 3 + 2] = 0; }
    for (let z = k; z < this.MAX_INFLUX * TR; z++) { this.colQueue[z * 3] = 0; this.colQueue[z * 3 + 1] = 0; this.colQueue[z * 3 + 2] = 0; }
    this.geoTete.attributes.position.needsUpdate = true;
    this.geoTete.attributes.color.needsUpdate = true;
    this.geoQueue.attributes.position.needsUpdate = true;
    this.geoQueue.attributes.color.needsUpdate = true;

    this._rendu();
    // Intervalle réel entre deux images, et non durée du seul JS : les
    // commandes GL partent en file et se paient plus tard, mesurer notre
    // propre code donnerait un débit imaginaire.
    if (this.o.adaptatif) {
      if (this._avant) this._gouverner(Math.min(now - this._avant, 400));
      this._avant = now;
    }
  }

  /**
   * Gouverneur : sur une machine faible, mieux vaut un globe un peu moins
   * fin qui tourne que le rendu complet à deux images par seconde. Les
   * quatre niveaux retirent d'abord du remplissage, jamais de la structure.
   */
  _gouverner(ms) {
    // Moyenne glissante : une image lente isolée ne doit pas déclencher
    // une dégradation, seule une tendance compte.
    this._tempsMoyen += (ms - this._tempsMoyen) * 0.06;
    const lent = this._tempsMoyen > this._budget * 1.35;
    const rapide = this._tempsMoyen < this._budget * 0.65;

    // Le compteur s'exprime en millisecondes écoulées, pas en images :
    // sur une machine à 2 fps, compter les images ferait attendre une
    // demi-minute avant la moindre réaction — exactement le cas où il
    // faut réagir vite.
    if (lent && this._niveau < 3) this._compteurNiveau += ms;
    else if (rapide && this._niveau > 0) this._compteurNiveau -= ms * 0.35;
    else this._compteurNiveau *= 0.92;

    if (this._compteurNiveau > 1200) { this._appliquerNiveau(this._niveau + 1); this._compteurNiveau = 0; }
    // Remontée bien plus exigeante que la descente : sans cette asymétrie,
    // le rendu oscille entre deux niveaux à la frontière.
    else if (this._compteurNiveau < -7000) { this._appliquerNiveau(this._niveau - 1); this._compteurNiveau = 0; }
  }

  _appliquerNiveau(n) {
    n = Math.max(0, Math.min(3, n));
    if (n === this._niveau) return;
    this._niveau = n;
    const p = this.preset;
    // 0 : tout ; 1 : plus de supersampling ; 2 : bloom réduit et netteté
    // coupée ; 3 : demi-résolution.
    this.SS = n >= 1 ? 1 : Math.min(this.o.rendu.superEchantillon, p.ss);
    this._passes = n >= 2 ? 1 : p.bloomPasses;
    this._large = n >= 2 ? 0 : 1;
    this.matCompo.uniforms.uNettete.value = n >= 2 ? 0 : this.o.rendu.nettete;
    const dpr = n >= 3 ? 1 : Math.min(window.devicePixelRatio || 1, p.dprMax);
    if (this.renderer.getPixelRatio() !== dpr) this.renderer.setPixelRatio(dpr);
    this.redimensionner();
    this._tempsMoyen = this._budget;
    this.o.surEvenement?.('qualite', { niveau: n });
  }

  /** Quelques chiffres, utiles pour un affichage de debug. */
  statistiques() {
    return {
      amas: this.amas.length,
      somas: this.somas.length,
      particules: this.N,
      liaisons: this.nbLiaisons,
      niveauQualite: this._niveau,
      msParImage: +this._tempsMoyen.toFixed(1),
      connexions: this.aretes.length,
      etoiles: this.nbEtoiles,
      influx: this.influx.length
    };
  }
}

window.GlobeStellaire = GlobeStellaire;
})();
