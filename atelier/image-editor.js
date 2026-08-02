// Éditeur de cadrage — repris de l'atelier WikiDeck, qui fonctionne.
//
// Principe : la photo ENTIÈRE glisse sous un cadre 4:3 fixe, et le cadre est
// exactement ce que Mémo affichera.
//
// Par défaut le zoom minimum couvre le cadre et le recadrage est borné : il est
// donc impossible de fabriquer une image trouée. C'est ce garde-fou qui manquait
// à la version précédente, où ouvrir une entrée héritée suffisait à produire une
// image transparente à 90 %.
//
// Ce garde-fou se relâche à la demande (« cadrage libre »). Certaines images ne
// PEUVENT pas remplir un cadre 4:3 sans qu'on les ampute : les logos des
// départements sont carrés ou verticaux. Là, reculer est le bon geste. Le vide
// laissé autour n'est jamais transparent : il est rempli avec la couleur des
// bords de l'image elle-même, donc invisible sur un logo posé sur fond uni.
//
// La miniature est dessinée depuis le même cadrage et la même source que la
// grande image : un seul geste, deux fichiers cohérents.

export const FORMAT = Object.freeze({
  full: Object.freeze([800, 600]),    // grande image de Mémo
  thumb: Object.freeze([400, 300]),   // miniature de Mémo (son format d'origine)
  originalMax: 2400,
  ratio: 4 / 3,
});

const BLANC = '#ffffff';

/**
 * Borne la position de l'image sur un axe. `marge` vaut « taille du cadre moins
 * taille de l'image » : négative quand l'image déborde, positive quand elle est
 * plus petite que le cadre.
 *
 * Les deux cas sont symétriques et c'est tout l'intérêt : quand l'image
 * déborde, ses bords ne peuvent pas se décoller du cadre — donc jamais de vide
 * involontaire ; quand elle est plus petite, elle ne peut pas s'échapper du
 * cadre — donc elle reste toujours visible.
 */
export function calerAxe(position, marge) {
  return marge <= 0
    ? Math.min(0, Math.max(marge, position))
    : Math.min(marge, Math.max(0, position));
}

/**
 * Couleur des bords d'une image, pour combler le vide sans que cela se voie.
 *
 * On échantillonne le pourtour d'une réduction de l'image et on retient la
 * teinte la plus fréquente. Un pixel transparent compte pour du blanc : un logo
 * PNG détouré donnera donc du blanc, ce qu'attend Mémo.
 */
export function couleurDeBord(im) {
  try {
    const T = 32;
    const c = document.createElement('canvas');
    c.width = T; c.height = T;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(im, 0, 0, T, T);
    const d = ctx.getImageData(0, 0, T, T).data;
    const comptes = new Map();
    const ajouter = (x, y) => {
      const i = (y * T + x) * 4;
      const a = d[i + 3];
      // arrondi à 16 niveaux : les dégradés légers ne comptent pas pour 300 teintes
      const q = v => Math.round(v / 16) * 16;
      const cle = a < 16 ? '255,255,255' : `${q(d[i])},${q(d[i + 1])},${q(d[i + 2])}`;
      comptes.set(cle, (comptes.get(cle) || 0) + 1);
    };
    for (let i = 0; i < T; i++) { ajouter(i, 0); ajouter(i, T - 1); ajouter(0, i); ajouter(T - 1, i); }
    const [meilleur] = [...comptes.entries()].sort((a, b) => b[1] - a[1]);
    return meilleur ? `rgb(${meilleur[0]})` : BLANC;
  } catch {
    // canvas rendu illisible par une image d'un autre domaine
    return BLANC;
  }
}

/**
 * Rend une image depuis un cadrage enregistré, sans passer par l'écran.
 *
 * Utilisé pour la reprise en lot depuis WikiDeck : on applique le cadrage déjà
 * validé là-bas aux formats de Mémo. Les mêmes règles qu'à l'écran s'appliquent
 * — le rectangle retenu est ramené dans l'image et ne peut jamais déborder,
 * donc jamais de bande vide.
 */
export async function rendreDepuisCadrage(url, cadrage) {
  const im = await new Promise((ok, non) => {
    const i = new Image();
    i.crossOrigin = 'anonymous';
    i.onload = () => ok(i);
    i.onerror = () => non(new Error('image illisible : ' + String(url).slice(0, 90)));
    i.src = url;
  });
  const iw = im.naturalWidth, ih = im.naturalHeight;
  // rectangle de couverture par défaut : le plus grand 4:3 contenu dans l'image
  let w = Math.min(iw, ih * FORMAT.ratio);
  let cx = 0.5, cy = 0.5;
  let libre = false;
  if (cadrage?.w > 0) {
    w = Math.max(cadrage.w * iw, 16);
    cx = cadrage.cx ?? 0.5;
    cy = cadrage.cy ?? 0.5;
    // un cadrage plus large que l'image vient d'un cadrage libre assumé :
    // on le respecte au lieu de le rogner
    libre = cadrage.w > 1;
  }
  let h = w / FORMAT.ratio;
  if (!libre) {
    if (h > ih) { h = ih; w = h * FORMAT.ratio; }
    if (w > iw) { w = iw; h = w / FORMAT.ratio; }
  }
  const borner = (v, min, max) => (min > max ? (min + max) / 2 : Math.min(Math.max(v, min), max));
  const x = borner(cx * iw - w / 2, Math.min(0, iw - w), Math.max(0, iw - w));
  const y = borner(cy * ih - h / 2, Math.min(0, ih - h), Math.max(0, ih - h));
  const fond = couleurDeBord(im);

  const versBlob = (taille, qualite) => {
    const c = document.createElement('canvas');
    c.width = taille[0]; c.height = taille[1];
    const ctx = c.getContext('2d');
    // fond d'abord : le vide éventuel n'est jamais transparent
    ctx.fillStyle = fond;
    ctx.fillRect(0, 0, taille[0], taille[1]);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(im, x, y, w, h, 0, 0, taille[0], taille[1]);
    return new Promise(ok => c.toBlob(ok, 'image/webp', qualite));
  };
  const original = () => {
    const c = document.createElement('canvas');
    const k = Math.min(1, FORMAT.originalMax / Math.max(iw, ih));
    c.width = Math.round(iw * k); c.height = Math.round(ih * k);
    c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
    return new Promise(ok => c.toBlob(ok, 'image/webp', 0.92));
  };
  return {
    full: await versBlob(FORMAT.full, 0.9),
    thumb: await versBlob(FORMAT.thumb, 0.85),
    original: await original(),
    cadrage: { cx: (x + w / 2) / iw, cy: (y + h / 2) / ih, w: w / iw },
  };
}

export class Editeur {
  constructor(cadre, img, apercu, surChangement = () => {}) {
    this.cadre = cadre;          // le conteneur : ses bords SONT le cadre
    this.img = img;              // <img> déplacée en CSS
    this.apercu = apercu;        // <canvas> de la miniature, en direct
    this.surChangement = surChangement;
    this.pointeurs = new Map();
    this.historique = [];
    this.source = null;
    this.s = 1; this.tx = 0; this.ty = 0; this.iw = 0; this.ih = 0;
    this.borne = true;           // par défaut, interdit de dézoomer hors cadre
    this.fond = BLANC;
    this._brancher();
  }

  /* ---------- géométrie ---------- */

  get fw() { return this.cadre.clientWidth; }
  get fh() { return this.cadre.clientHeight; }
  // zoom qui couvre le cadre : au-dessus, rien ne manque jamais
  get sCouvre() { return Math.max(this.fw / this.iw, this.fh / this.ih); }
  // zoom qui fait tenir l'image entière dans le cadre
  get sContient() { return Math.min(this.fw / this.iw, this.fh / this.ih); }
  // plancher réellement autorisé, selon le garde-fou
  get sMin() { return this.borne ? this.sCouvre : this.sContient * 0.25; }

  // Change le garde-fou. En le remettant, un cadrage devenu trop large est
  // ramené dans les clous tout seul.
  setBorne(valeur) {
    this.borne = !!valeur;
    if (this.source) { this.memoriser(); this._rendre(); }
  }

  /* ---------- chargement ---------- */

  chargerURL(url) {
    return new Promise((ok, non) => {
      const im = new Image();
      im.crossOrigin = 'anonymous';
      im.onload = () => { this._prendre(im); ok(); };
      im.onerror = () => non(new Error('image illisible : ' + String(url).slice(0, 90)));
      im.src = url;
    });
  }

  chargerBlob(blob) { return this.chargerURL(URL.createObjectURL(blob)); }

  // Essaie plusieurs sources dans l'ordre : jamais d'échec parce qu'un seul
  // chemin manque.
  async chargerPremiereDisponible(sources) {
    for (const s of sources.filter(Boolean)) {
      try { await this.chargerURL(s); return s; } catch { /* suivante */ }
    }
    throw new Error('aucune source lisible');
  }

  _prendre(im) {
    this.source = im;
    this.iw = im.naturalWidth; this.ih = im.naturalHeight;
    this.img.src = im.src;
    this.historique = [];
    this.fond = couleurDeBord(im);
    // le cadre à l'écran prend la couleur de comblement : ce qu'on voit est
    // exactement ce qui sera enregistré
    this.cadre.style.background = this.fond;
    this.recadrerAuto();
  }

  vider() {
    this.source = null; this.iw = 0; this.ih = 0;
    this.historique = []; this.pointeurs.clear();
    this.img.removeAttribute('src');
    this.img.style.transform = '';
    if (this.apercu) {
      this.apercu.getContext('2d').clearRect(0, 0, this.apercu.width, this.apercu.height);
    }
    this.surChangement(null);
  }

  /* ---------- cadrage ---------- */

  memoriser() {
    this.historique.push({ s: this.s, tx: this.tx, ty: this.ty });
    if (this.historique.length > 30) this.historique.shift();
  }

  annuler() {
    const e = this.historique.pop();
    if (e) { this.s = e.s; this.tx = e.tx; this.ty = e.ty; this._rendre(); }
  }

  // Remplit le cadre : rien ne dépasse du cadre, mais l'image est rognée.
  recadrerAuto() {
    if (!this.source) return;
    this._poser(this.sCouvre);
  }

  // Fait tenir l'image entière : rien n'est rogné, mais il reste de la place
  // autour. Disponible seulement quand le garde-fou est levé.
  contenir() {
    if (!this.source || this.borne) return;
    this.memoriser();
    this._poser(this.sContient);
  }

  _poser(echelle) {
    this.s = echelle;
    this.tx = (this.fw - this.iw * this.s) / 2;
    this.ty = (this.fh - this.ih * this.s) / 2;
    this._rendre();
  }

  /**
   * Le garde-fou.
   *
   * Quand l'image couvre un axe, elle ne peut pas s'en décoller : pas de vide.
   * Quand elle est plus petite que le cadre — cadrage libre assumé — la borne
   * s'inverse et la maintient à l'intérieur : elle ne peut pas s'échapper.
   */
  _borner() {
    this.s = Math.max(this.sMin, Math.min(this.s, this.sCouvre * 12));
    this.tx = calerAxe(this.tx, this.fw - this.iw * this.s);
    this.ty = calerAxe(this.ty, this.fh - this.ih * this.s);
  }

  // Vrai quand l'image ne remplit pas le cadre : du fond sera visible.
  get aDuFond() {
    return !!this.source
      && (this.iw * this.s < this.fw - 0.5 || this.ih * this.s < this.fh - 0.5);
  }

  _rendre() {
    if (!this.source) return;
    this._borner();
    this.img.style.transform = `translate(${this.tx}px, ${this.ty}px) scale(${this.s})`;
    if (this.apercu) this.dessiner(this.apercu, [this.apercu.width, this.apercu.height]);
    this.surChangement(this.getCadrage());
  }

  zoomer(facteur, px = this.fw / 2, py = this.fh / 2) {
    if (!this.source) return;
    this.memoriser();
    const avant = this.s;
    this.s *= facteur;
    this._borner();
    const reel = this.s / avant;
    this.tx = px - (px - this.tx) * reel;
    this.ty = py - (py - this.ty) * reel;
    this._rendre();
  }

  // rectangle retenu, en pixels de l'image source
  _rectSource() {
    return { x: -this.tx / this.s, y: -this.ty / this.s,
             w: this.fw / this.s, h: this.fh / this.s };
  }

  // cadrage persistable, en fractions de l'image — compatible WikiDeck
  getCadrage() {
    const r = this._rectSource();
    return { cx: (r.x + r.w / 2) / this.iw, cy: (r.y + r.h / 2) / this.ih, w: r.w / this.iw };
  }

  setCadrage(c) {
    if (!this.source) return;
    if (!c || !c.w) { this.recadrerAuto(); return; }
    this.s = this.fw / (c.w * this.iw);
    const r = { w: this.fw / this.s, h: this.fh / this.s };
    this.tx = -(c.cx * this.iw - r.w / 2) * this.s;
    this.ty = -(c.cy * this.ih - r.h / 2) * this.s;
    this._rendre();   // _borner() rattrape un cadrage hérité impossible
  }

  /* ---------- exports ---------- */

  dessiner(canvas, [W, H]) {
    if (!this.source) return;
    const r = this._rectSource();
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    // fond d'abord : ce qui dépasse de l'image est comblé, jamais transparent.
    // drawImage rogne un rectangle source débordant en ajustant la destination
    // dans la même proportion : l'image atterrit donc au bon endroit du cadre.
    ctx.fillStyle = this.fond;
    ctx.fillRect(0, 0, W, H);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.source, r.x, r.y, r.w, r.h, 0, 0, W, H);
  }

  _blob(canvas, qualite, type = 'image/webp') {
    return new Promise(ok => canvas.toBlob(ok, type, qualite));
  }

  _rendu(taille, qualite) {
    const c = document.createElement('canvas');
    this.dessiner(c, taille);
    return this._blob(c, qualite);
  }

  // la source complète ré-encodée, pour pouvoir recadrer plus tard sans perte
  _original() {
    const c = document.createElement('canvas');
    const k = Math.min(1, FORMAT.originalMax / Math.max(this.iw, this.ih));
    c.width = Math.round(this.iw * k); c.height = Math.round(this.ih * k);
    c.getContext('2d').drawImage(this.source, 0, 0, c.width, c.height);
    return this._blob(c, 0.92);
  }

  async exporter() {
    if (!this.source) throw new Error('aucune image chargée');
    return {
      full: await this._rendu(FORMAT.full, 0.9),
      thumb: await this._rendu(FORMAT.thumb, 0.85),
      original: await this._original(),
    };
  }

  async copier() {
    if (!this.source) throw new Error('aucune image chargée');
    const c = document.createElement('canvas');
    this.dessiner(c, FORMAT.full);
    const blob = await this._blob(c, 1, 'image/png');
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  }

  /* ---------- interactions ---------- */

  _brancher() {
    const el = this.cadre;
    el.addEventListener('pointerdown', ev => {
      if (!this.source) return;
      el.setPointerCapture(ev.pointerId);
      this.pointeurs.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (this.pointeurs.size === 1) this.memoriser();
      el.classList.add('glisse');
      ev.preventDefault();
    });
    el.addEventListener('pointermove', ev => {
      const p = this.pointeurs.get(ev.pointerId);
      if (!p) return;
      const autre = [...this.pointeurs.entries()].find(([id]) => id !== ev.pointerId);
      if (!autre) {
        this.tx += ev.clientX - p.x;
        this.ty += ev.clientY - p.y;
        this._rendre();
      } else {
        // pincement : zoom autour du milieu des deux doigts
        const q = autre[1];
        const avant = Math.hypot(p.x - q.x, p.y - q.y);
        const apres = Math.hypot(ev.clientX - q.x, ev.clientY - q.y);
        const r = el.getBoundingClientRect();
        if (avant > 0) {
          this.zoomer(apres / avant, (ev.clientX + q.x) / 2 - r.left, (ev.clientY + q.y) / 2 - r.top);
        }
      }
      p.x = ev.clientX; p.y = ev.clientY;
      ev.preventDefault();
    });
    const fin = ev => {
      this.pointeurs.delete(ev.pointerId);
      if (!this.pointeurs.size) el.classList.remove('glisse');
    };
    el.addEventListener('pointerup', fin);
    el.addEventListener('pointercancel', fin);
    el.addEventListener('wheel', ev => {
      if (!this.source) return;
      ev.preventDefault();
      const r = el.getBoundingClientRect();
      this.zoomer(ev.deltaY < 0 ? 1.1 : 1 / 1.1, ev.clientX - r.left, ev.clientY - r.top);
    }, { passive: false });
  }
}
