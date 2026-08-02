// Atelier Mémo (version en ligne) — même organisation que l'Atelier des Cartes
// de WikiDeck : une grille de TOUTES les listes d'abord, avec un sommaire, et
// l'éditeur de cadrage en plein écran par-dessus.
//
// La logique d'interface est reprise de l'atelier local (apps/memo/atelier).
// Seule la couche d'enregistrement change : ici il n'y a pas de serveur Node,
// on écrit directement dans le dépôt Blinytz/memo-web par l'API GitHub.

import { Editeur, FORMAT } from './image-editor.js?v=20260802';
import { lireMemo, ecrireMemo, poserImage, cheminsDe, cleDeEntree, clesPrises }
  from './memo-html.js?v=20260802';

const REPO = 'Blinytz/memo-web', BRANCHE = 'main';
const API = `https://api.github.com/repos/${REPO}`;

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const STATUTS = ['manquante', 'importee', 'a_cadrer', 'a_verifier', 'validee',
                 'verrouillee', 'source_cassee', 'conflit'];
const PASTILLE = { validee: '✓', a_verifier: '⚠', manquante: '🚫', importee: '⬇' };

// chemins du dépôt : app.js vit dans /atelier/, les images sont un cran au-dessus
const urlDepot = v => new URL(`../${String(v || '').replace(/^\/+/, '')}`, import.meta.url).href;
const urlImage = v => {
  const brut = String(v || '');
  if (!brut) return '';
  return /^(data:|blob:|https?:)/i.test(brut) ? brut : urlDepot(brut);
};

const jeton = () => sessionStorage.getItem('memoGithubToken') || '';
const entetesGithub = () => ({
  Authorization: `Bearer ${jeton()}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
});

const etat = {
  data: null,
  listeCourante: null,
  entreeCourante: null,
  modifie: false,
  undo: [],
  redo: [],
};
// aperçus des images enregistrées pendant la session : la grille les montre
// tout de suite, sans attendre que GitHub Pages ait republié le fichier
const apercus = {};
let editeur = null;
let remplacementEnCours = false;

/* ================= chargement ================= */

async function demarrer() {
  brancherOnglets();
  brancherFiltres();
  brancherEditeur();
  brancherTableau();
  try {
    await recharger();
  } catch (err) {
    $('#vue-grille').innerHTML = `<p class="doux">Impossible de charger les données : ${esc(err.message)}</p>`;
    message('erreur de chargement');
    return;
  }
  rendreTout();
  message(jeton() ? 'GitHub connecté' : 'lecture seule');
  window.addEventListener('beforeunload', ev => {
    if (etat.modifie) { ev.preventDefault(); ev.returnValue = ''; }
  });
}

async function recharger() {
  const r = await fetch(`${urlDepot('data/atelier/workspace.json')}?t=${Date.now()}`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`données indisponibles (${r.status})`);
  etat.data = await r.json();
  etat.data.notes ||= [];
  etat.data.trash ||= [];
  etat.listeCourante ||= listesVivantes()[0]?.id || null;
}

function message(texte) { $('#etat').textContent = texte; }
function listesVivantes() { return etat.data.lists.filter(l => !l.deletedAt); }
function listeParId(id) { return etat.data.lists.find(l => l.id === id); }
function entreesDe(listId) {
  return etat.data.entries.filter(e => e.listId === listId && !e.deletedAt)
    .sort((a, b) => a.order - b.order);
}

function instantane() {
  etat.undo.push(JSON.stringify({ lists: etat.data.lists, entries: etat.data.entries, notes: etat.data.notes }));
  if (etat.undo.length > 30) etat.undo.shift();
  etat.redo = [];
}

function modifier(fn) {
  instantane();
  fn();
  etat.modifie = true;
  message('modifications en cours');
}

function rendreTout() {
  remplirFiltres();
  rendreGrille();
  rendreTableau();
  rendreNotes();
}

/* ================= onglets ================= */

function afficherVue(nom) {
  for (const b of document.querySelectorAll('#onglets button')) {
    b.classList.toggle('actif', b.dataset.vue === nom);
  }
  for (const v of document.querySelectorAll('.vue')) {
    v.classList.toggle('visible', v.id === `vue-${nom}`);
  }
  $('#barre-filtres').hidden = nom !== 'grille';
}

function brancherOnglets() {
  for (const b of document.querySelectorAll('#onglets button')) {
    b.addEventListener('click', () => {
      afficherVue(b.dataset.vue);
      if (b.dataset.vue === 'tableau') rendreTableau();
      if (b.dataset.vue === 'config') rendreConfig();
    });
  }
  $('#btn-enregistrer').addEventListener('click', () => enregistrerAvecRetour());
  $('#btn-annuler').addEventListener('click', () => permuterHistorique(etat.undo, etat.redo));
  $('#btn-refaire').addEventListener('click', () => permuterHistorique(etat.redo, etat.undo));
}

function permuterHistorique(source, cible) {
  if (!source.length) return;
  cible.push(JSON.stringify({ lists: etat.data.lists, entries: etat.data.entries, notes: etat.data.notes }));
  Object.assign(etat.data, JSON.parse(source.pop()));
  etat.modifie = true;
  message('modifications en cours');
  rendreTout();
}

/* ================= filtres et grille ================= */

function remplirFiltres() {
  const select = $('#f-liste');
  const garde = select.value;
  select.innerHTML = '<option value="">Toutes les listes</option>' +
    listesVivantes().map(l =>
      `<option value="${esc(l.id)}">${esc(l.icon || '📚')} ${esc(l.name)}</option>`).join('');
  select.value = garde;
}

function brancherFiltres() {
  for (const id of ['#f-liste', '#f-statut', '#f-texte']) {
    $(id).addEventListener('input', rendreGrille);
  }
  $('#btn-nouvelle').addEventListener('click', ajouterLigne);
}

function statutDe(entree) { return entree.image?.status || 'manquante'; }
function aUneImage(entree) { return !!entree.image?.thumb; }

function sourceVignette(entree) {
  if (apercus[entree.id]) return apercus[entree.id];
  return entree.image?.thumb ? urlImage(entree.image.thumb) : null;
}

function entreeVisible(entree) {
  const st = $('#f-statut').value;
  const q = $('#f-texte').value.trim().toLowerCase();
  if (st === 'sans' && aUneImage(entree)) return false;
  if (st === 'verrouillee') { if (!entree.image?.locked) return false; }
  else if (st && st !== 'sans' && statutDe(entree) !== st) return false;
  if (q && !`${entree.name} ${entree.number}`.toLowerCase().includes(q)) return false;
  return true;
}

function rendreGrille() {
  const filtreListe = $('#f-liste').value;
  const morceaux = [];
  const sommaire = [];
  let total = 0;

  for (const liste of listesVivantes()) {
    if (filtreListe && liste.id !== filtreListe) continue;
    const visibles = entreesDe(liste.id).filter(entreeVisible);
    if (!visibles.length) continue;
    total += visibles.length;
    sommaire.push(`<a href="#liste-${esc(liste.id)}">${esc(liste.name)} (${visibles.length})</a>`);
    morceaux.push(`<h2 id="liste-${esc(liste.id)}">${esc(liste.icon || '📚')} ${esc(liste.name)}
      <small>${visibles.length}</small></h2>
      <div class="grille">` + visibles.map(vignette).join('') + '</div>');
  }

  $('#vue-grille').innerHTML = morceaux.length
    ? `<nav class="sommaire">${sommaire.join('')}</nav>
       <p class="doux">${total} entrée(s) affichée(s)</p>` + morceaux.join('')
    : '<p class="doux">Aucune entrée ne correspond à ces filtres.</p>';

  $('#vue-grille').onclick = ev => {
    const pastille = ev.target.closest('[data-statut]');
    if (pastille) {
      const entree = etat.data.entries.find(e => e.id === pastille.dataset.statut);
      const suite = { validee: 'a_verifier', a_verifier: 'validee' };
      modifier(() => { entree.image.status = suite[statutDe(entree)] || 'a_verifier'; });
      rafraichirVignette(entree.id);   // pas toute la grille : on ne perd pas sa place
      return;
    }
    const v = ev.target.closest('.vignette');
    if (v) ouvrirEditeur(v.dataset.id);
  };
}

function vignette(entree) {
  const src = sourceVignette(entree);
  const st = statutDe(entree);
  const liste = listeParId(entree.listId);
  return `<div class="vignette" data-id="${esc(entree.id)}">
    ${src ? `<img loading="lazy" src="${esc(src)}" alt="">`
          : '<div class="sans-image">🚫</div>'}
    <button class="v-statut ${esc(st)}" data-statut="${esc(entree.id)}"
            title="${esc(st.replaceAll('_', ' '))}">${PASTILLE[st] || '·'}</button>
    ${entree.image?.locked ? '<span class="v-verrou" title="verrouillée">🔒</span>' : ''}
    <div class="v-nom" title="${esc(entree.name)}">${esc(entree.name)}</div>
    <div class="v-liste">n° ${esc(entree.number)} · ${esc(liste?.name || '')}</div>
  </div>`;
}

/* ================= éditeur ================= */

function brancherEditeur() {
  editeur = new Editeur($('#ed-conteneur'), $('#ed-image'), $('#ed-canvas-apercu'), majMesures);
  $('#ed-f-statut').innerHTML = STATUTS.map(s =>
    `<option value="${s}">${s.replaceAll('_', ' ')}</option>`).join('');

  $('#ed-fermer').addEventListener('click', fermerEditeur);
  $('#ed-plus').addEventListener('click', () => editeur.zoomer(1.2));
  $('#ed-moins').addEventListener('click', () => editeur.zoomer(1 / 1.2));
  $('#ed-reset').addEventListener('click', () => editeur.recadrerAuto());
  $('#ed-precedent').addEventListener('click', () => naviguer(-1));
  $('#ed-suivant').addEventListener('click', () => naviguer(1));
  $('#ed-enregistrer').addEventListener('click', enregistrerImage);
  $('#ed-remplacer').addEventListener('click', modaleRemplacement);
  $('#ed-note').addEventListener('click', () => etat.entreeCourante && modaleNote([etat.entreeCourante]));
  $('#ed-fichier').addEventListener('change', async ev => {
    const f = ev.target.files[0];
    if (f) { await chargerRemplacement(f); ev.target.value = ''; }
  });

  const champs = [['#ed-f-numero', 'number'], ['#ed-f-nom', 'name'], ['#ed-f-titre', 'title'],
                  ['#ed-f-soustitre', 'subtitle'], ['#ed-f-wiki', 'wikipedia'],
                  ['#ed-f-description', 'description']];
  for (const [sel, cle] of champs) {
    $(sel).addEventListener('input', ev => {
      const e = entreeCourante();
      if (!e) return;
      e[cle] = ev.target.value;
      etat.modifie = true;
      message('modifications en cours');
      if (cle === 'wikipedia') $('#ed-f-wiki-ouvrir').href = ev.target.value || '#';
      if (cle === 'name') $('#ed-nom').textContent = ev.target.value;
    });
  }
  $('#ed-f-statut').addEventListener('change', ev => {
    const e = entreeCourante(); if (!e) return;
    modifier(() => { e.image.status = ev.target.value; });
  });
  $('#ed-f-verrou').addEventListener('change', ev => {
    const e = entreeCourante(); if (!e) return;
    modifier(() => { e.image.locked = ev.target.checked; });
  });
  $('#ed-champs-liste').addEventListener('input', ev => {
    const e = entreeCourante(); if (!e || !ev.target.dataset.champ) return;
    (e.fields ||= {})[ev.target.dataset.champ] = ev.target.value;
    etat.modifie = true;
    message('modifications en cours');
  });

  // coller une image ou une URL n'importe où dans l'éditeur
  document.addEventListener('paste', async ev => {
    if ($('#editeur').hidden) return;
    if (ev.target.closest('input, textarea, select, [contenteditable]')) return;
    const item = [...(ev.clipboardData?.items || [])].find(i => i.type.startsWith('image/'));
    if (item) { ev.preventDefault(); await chargerRemplacement(item.getAsFile()); return; }
    const texte = ev.clipboardData?.getData('text');
    if (texte && /^https?:\/\//.test(texte.trim())) {
      ev.preventDefault();
      await chargerRemplacementURL(texte.trim());
    }
  });
  const ed = $('#editeur');
  ed.addEventListener('dragover', ev => ev.preventDefault());
  ed.addEventListener('drop', async ev => {
    ev.preventDefault();
    const f = ev.dataTransfer?.files?.[0];
    if (f && f.type.startsWith('image/')) await chargerRemplacement(f);
  });
  document.addEventListener('keydown', ev => {
    if (ev.key === 'Escape' && !$('#editeur').hidden && $('#modale').hidden) fermerEditeur();
  });
}

function entreeCourante() {
  return etat.data.entries.find(e => e.id === etat.entreeCourante);
}

function majMesures() {
  const out = $('#ed-mesures');
  if (!editeur?.source) { out.textContent = ''; return; }
  const couverture = Math.round(editeur.s / editeur.sCouvre * 100);
  out.textContent = `source ${editeur.iw} × ${editeur.ih} px · cadre rempli à ${couverture} %`
    + (editeur.aDuFond ? ' · fond comblé autour' : '');
}

async function ouvrirEditeur(entryId) {
  etat.entreeCourante = entryId;
  const e = entreeCourante();
  if (!e) return;
  const liste = listeParId(e.listId);
  remplacementEnCours = false;

  $('#ed-nom').textContent = e.name;
  $('#ed-infos').textContent = `${liste?.name || ''} · n° ${e.number}`;
  $('#ed-f-numero').value = e.number || '';
  $('#ed-f-nom').value = e.name || '';
  $('#ed-f-titre').value = e.title || '';
  $('#ed-f-soustitre').value = e.subtitle || '';
  $('#ed-f-wiki').value = e.wikipedia || '';
  $('#ed-f-wiki-ouvrir').href = e.wikipedia || '#';
  $('#ed-f-description').value = e.description || '';
  $('#ed-f-statut').value = statutDe(e);
  $('#ed-f-verrou').checked = !!e.image?.locked;
  $('#ed-champs-liste').innerHTML = Object.entries(e.fields || {})
    .filter(([k]) => !/^image$/i.test(k))
    .map(([k, v]) => `<label>${esc(k)}<input data-champ="${esc(k)}" value="${esc(v)}"></label>`).join('');

  const voisins = entreesDe(e.listId);
  const rang = voisins.findIndex(x => x.id === entryId);
  $('#ed-precedent').disabled = rang <= 0;
  $('#ed-suivant').disabled = rang < 0 || rang >= voisins.length - 1;

  $('#editeur').hidden = false;   // le cadre doit avoir sa taille avant tout calcul
  $('#editeur').scrollTop = 0;
  editeur.vider();
  $('#ed-vide').hidden = false;
  $('#ed-vide').textContent = 'Aucune image — colle une URL, une image (Ctrl+V) ou choisis un fichier.';

  const bust = `?v=${Date.now()}`;
  const sources = [e.image?.source, e.image?.full, e.image?.thumb]
    .filter(Boolean).map(p => urlImage(p) + bust);
  if (!sources.length) { majMesures(); return; }
  try {
    await editeur.chargerPremiereDisponible(sources);
    $('#ed-vide').hidden = true;
    editeur.setCadrage(e.image?.crop);
  } catch {
    $('#ed-vide').hidden = false;
    $('#ed-vide').textContent = 'Image d’origine illisible — remplace-la pour continuer.';
  }
  majMesures();
}

function naviguer(pas) {
  const e = entreeCourante();
  if (!e) return;
  const voisins = entreesDe(e.listId);
  const cible = voisins[voisins.findIndex(x => x.id === e.id) + pas];
  if (cible) ouvrirEditeur(cible.id);
}

// Comme dans l'atelier WikiDeck : on masque, on ne reconstruit pas. Reconstruire
// la grille remplacerait les 2131 vignettes et renverrait en haut de page, alors
// qu'on veut retrouver exactement l'endroit qu'on était en train de traiter.
function fermerEditeur() {
  const id = etat.entreeCourante;
  $('#editeur').hidden = true;
  etat.entreeCourante = null;
  if (id) {
    rafraichirVignette(id);
    document.querySelector(`.vignette[data-id="${CSS.escape(id)}"]`)
      ?.scrollIntoView({ block: 'center' });
  }
}

// Met à jour une seule vignette sur place : image, pastille de statut, verrou et
// nom. Évite de rejouer toute la grille pour une seule entrée modifiée.
function rafraichirVignette(id) {
  const noeud = document.querySelector(`.vignette[data-id="${CSS.escape(id)}"]`);
  const entree = etat.data.entries.find(e => e.id === id);
  if (!noeud || !entree) return;
  const provisoire = document.createElement('div');
  provisoire.innerHTML = vignette(entree);
  noeud.replaceWith(provisoire.firstElementChild);
}

function modaleRemplacement() {
  ouvrirModale(`
    <h3>Remplacer l'image</h3>
    <p class="doux">Trois moyens :</p>
    <input type="url" id="m-url" placeholder="Coller l'URL d'une image puis Entrée…">
    <p class="doux">— ou colle l'image elle-même (Ctrl+V) n'importe où dans l'éditeur —</p>
    <div class="m-boutons">
      <button class="btn" id="m-fichier">📁 Choisir un fichier…</button>
      <button class="btn btn-discret" id="m-annuler">Annuler</button>
    </div>`);
  $('#m-url').addEventListener('keydown', async ev => {
    if (ev.key === 'Enter' && ev.target.value.trim()) {
      const url = ev.target.value.trim();
      fermerModale();
      await chargerRemplacementURL(url);
    }
  });
  $('#m-fichier').onclick = () => { fermerModale(); $('#ed-fichier').click(); };
  $('#m-annuler').onclick = fermerModale;
}

async function chargerRemplacementURL(url) {
  // essai direct, puis via un relais si le serveur d'origine refuse le partage
  const candidats = [url,
    'https://images.weserv.nl/?url=' + encodeURIComponent(url.replace(/^https?:\/\//, '')) + '&w=2000'];
  for (const u of candidats) {
    try {
      await editeur.chargerURL(u);
      remplacementEnCours = true;
      $('#ed-vide').hidden = true;
      majMesures();
      return;
    } catch { /* candidat suivant */ }
  }
  alert('Impossible de charger cette URL. Essaie de copier l’image elle-même puis Ctrl+V.');
}

async function chargerRemplacement(blob) {
  await editeur.chargerBlob(blob);
  remplacementEnCours = true;
  $('#ed-vide').hidden = true;
  majMesures();
}

/* ================= enregistrement GitHub ================= */

function blobEnBase64(blob) {
  return new Promise((ok, non) => {
    const fr = new FileReader();
    fr.onload = () => ok(String(fr.result).split(',')[1]);
    fr.onerror = non;
    fr.readAsDataURL(blob);
  });
}

const texteEnBase64 = t => btoa(unescape(encodeURIComponent(t)));

// Un seul commit pour tous les fichiers : l'arbre est construit d'abord, la
// référence n'avance qu'à la fin. Un échec en cours de route ne laisse donc
// jamais le dépôt à moitié écrit.
async function commiterGithub(fichiers, messageCommit) {
  if (!jeton()) {
    // l'éditeur couvre tout l'écran : sans le fermer, l'onglet ⚙ s'ouvrirait
    // derrière lui et le message resterait sans suite visible
    fermerEditeur();
    afficherConfig();
    throw new Error('Connecte GitHub (onglet ⚙) pour enregistrer.');
  }
  const rRef = await fetch(`${API}/git/ref/heads/${BRANCHE}`, { headers: entetesGithub(), cache: 'no-store' });
  if (!rRef.ok) throw new Error(`connexion GitHub refusée (${rRef.status})`);
  const parent = (await rRef.json()).object.sha;
  const commitParent = await (await fetch(`${API}/git/commits/${parent}`, { headers: entetesGithub() })).json();

  const arbre = [];
  for (const f of fichiers) {
    const rBlob = await fetch(`${API}/git/blobs`, {
      method: 'POST',
      headers: { ...entetesGithub(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: f.base64 ?? texteEnBase64(f.texte), encoding: 'base64' }),
    });
    if (!rBlob.ok) throw new Error(`échec du fichier ${f.chemin}`);
    arbre.push({ path: f.chemin, mode: '100644', type: 'blob', sha: (await rBlob.json()).sha });
  }

  const rArbre = await fetch(`${API}/git/trees`, {
    method: 'POST',
    headers: { ...entetesGithub(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ base_tree: commitParent.tree.sha, tree: arbre }),
  });
  if (!rArbre.ok) throw new Error('échec de la construction de l’arbre');
  const rCommit = await fetch(`${API}/git/commits`, {
    method: 'POST',
    headers: { ...entetesGithub(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: messageCommit, tree: (await rArbre.json()).sha, parents: [parent] }),
  });
  if (!rCommit.ok) throw new Error('échec de la création du commit');
  const rMaj = await fetch(`${API}/git/refs/heads/${BRANCHE}`, {
    method: 'PATCH',
    headers: { ...entetesGithub(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ sha: (await rCommit.json()).sha, force: false }),
  });
  if (!rMaj.ok) throw new Error('conflit : recharge la page avant de réessayer.');
}

// Le texte d'un fichier tel qu'il est DANS LE DÉPÔT, pas tel que GitHub Pages
// le sert : Pages peut avoir plusieurs minutes de retard, et commiter à partir
// d'une version périmée effacerait les modifications entre-temps.
async function lireFichierDepot(chemin) {
  const r = await fetch(`${API}/contents/${chemin}?ref=${BRANCHE}&t=${Date.now()}`, {
    headers: { ...entetesGithub(), Accept: 'application/vnd.github.raw' },
    cache: 'no-store',
  });
  if (!r.ok) throw new Error(`lecture de ${chemin} impossible (${r.status})`);
  return r.text();
}

function fichierWorkspace() {
  etat.data.revision = Number(etat.data.revision || 0) + 1;
  etat.data.updatedAt = new Date().toISOString();
  return { chemin: 'data/atelier/workspace.json', texte: JSON.stringify(etat.data, null, 2) + '\n' };
}

async function enregistrerAvecRetour() {
  const bouton = $('#btn-enregistrer');
  bouton.disabled = true;
  try {
    message('enregistrement…');
    await commiterGithub([fichierWorkspace()], 'Atelier Mémo : mise à jour des données');
    etat.modifie = false;
    message('enregistré sur GitHub');
  } catch (err) {
    message('erreur');
    alert('Échec : ' + err.message);
  } finally {
    bouton.disabled = false;
  }
}

async function enregistrerImage() {
  const e = entreeCourante();
  if (!e) return;
  if (!editeur.source) return alert('Charge d’abord une image (🔄 Remplacer).');
  if (e.image?.locked && !confirm('Cette image est verrouillée. La remplacer quand même ?')) return;
  const bouton = $('#ed-enregistrer');
  bouton.disabled = true;
  message('enregistrement de l’image…');
  try {
    const sorties = await editeur.exporter();
    const liste = listeParId(e.listId);

    // memo.html est l'application : c'est lui qui décide quelles images
    // s'affichent. On part de la version réellement dans le dépôt.
    const memo = lireMemo(await lireFichierDepot('memo.html'));
    const dansApplication = memo.idsListes.has(liste?.legacyId);

    // La clé de fichier suit la convention de memo.html : « thumbs/<liste>/<clé> ».
    const voisines = etat.data.entries
      .filter(x => x.listId === e.listId && !x.deletedAt && x.id !== e.id);
    const cle = cleDeEntree(e, clesPrises(voisines));

    let cheminMemoHtml = null;
    let chemins;
    if (dansApplication) {
      chemins = poserImage(memo, liste.legacyId, e.order, cle);
      cheminMemoHtml = ecrireMemo(memo);
    } else {
      // liste absente de l'application : on dépose quand même les fichiers,
      // prêts à servir, mais on ne prétend pas avoir mis l'application à jour
      chemins = cheminsDe(liste?.legacyId || 'divers', cle);
    }

    const fichiers = [
      { chemin: chemins.original, base64: await blobEnBase64(sorties.original) },
      { chemin: chemins.full, base64: await blobEnBase64(sorties.full) },
      { chemin: chemins.thumb, base64: await blobEnBase64(sorties.thumb) },
    ];
    if (cheminMemoHtml) fichiers.push({ chemin: 'memo.html', texte: cheminMemoHtml });

    e.image.source = chemins.original;
    e.image.full = chemins.full;
    e.image.thumb = chemins.thumb;
    e.image.crop = editeur.getCadrage();
    e.image.status = e.image.locked ? 'verrouillee' : 'validee';
    e.image.provenance = {
      kind: remplacementEnCours ? 'manuel' : 'recadrage',
      at: new Date().toISOString(),
    };
    fichiers.push(fichierWorkspace());

    await commiterGithub(fichiers, `Atelier Mémo : ${e.name}`);
    apercus[e.id] = URL.createObjectURL(sorties.thumb);
    etat.modifie = false;
    message(dansApplication ? 'image enregistrée dans Mémo' : 'image enregistrée (liste hors application)');
    if (!dansApplication) {
      alert('Les fichiers sont écrits, mais memo.html ne contient pas cette liste :\n' +
            'l’application n’affichera pas encore cette image.');
    }
    fermerEditeur();
  } catch (err) {
    message('erreur');
    alert('Échec : ' + err.message);
  } finally {
    bouton.disabled = false;
  }
}

/* ================= tableau ================= */

function brancherTableau() {
  $('#btn-ligne').addEventListener('click', ajouterLigne);
  $('#btn-dupliquer').addEventListener('click', dupliquerLigne);
  $('#btn-corbeille').addEventListener('click', mettreALaCorbeille);
  $('#btn-renumeroter').addEventListener('click', renumeroter);
  $('#tbody').addEventListener('click', ev => {
    const tr = ev.target.closest('tr');
    if (tr && ev.target.closest('[data-ouvrir]')) ouvrirEditeur(tr.dataset.id);
  });
  $('#tbody').addEventListener('input', ev => {
    const tr = ev.target.closest('tr');
    const e = etat.data.entries.find(x => x.id === tr?.dataset.id);
    if (!e) return;
    if (ev.target.dataset.champ === 'number') e.number = ev.target.textContent.trim();
    else if (ev.target.dataset.champ === 'name') e.name = ev.target.textContent.trim();
    else if (ev.target.dataset.extra) (e.fields ||= {})[ev.target.dataset.extra] = ev.target.textContent.trim();
    etat.modifie = true;
    message('modifications en cours');
  });
}

function listeTableau() {
  return listeParId($('#f-liste').value) || listeParId(etat.listeCourante) || listesVivantes()[0];
}

function rendreTableau() {
  const liste = listeTableau();
  if (!liste) return;
  etat.listeCourante = liste.id;
  const entrees = entreesDe(liste.id);
  const sans = entrees.filter(e => !aUneImage(e)).length;
  $('#tableau-titre').textContent = `${liste.icon || '📚'} ${liste.name}`;
  $('#tableau-metriques').textContent = `${entrees.length} entrées · ${sans} sans image`;
  const extra = (liste.columns || []).filter(c => !/^(num[ée]ro|image|nom)$/i.test(c));
  $('#thead').innerHTML = `<tr><th>N°</th><th>Image</th><th>Nom</th>${
    extra.map(c => `<th>${esc(c)}</th>`).join('')}</tr>`;
  $('#tbody').innerHTML = entrees.map(e => {
    const src = sourceVignette(e);
    return `<tr data-id="${esc(e.id)}">
      <td contenteditable data-champ="number">${esc(e.number)}</td>
      <td data-ouvrir>${src ? `<img loading="lazy" src="${esc(src)}" alt="">` : '—'}</td>
      <td contenteditable data-champ="name">${esc(e.name)}</td>
      ${extra.map(c => `<td contenteditable data-extra="${esc(c)}">${esc(e.fields?.[c] || '')}</td>`).join('')}
    </tr>`;
  }).join('');
}

function ajouterLigne() {
  const liste = listeTableau();
  if (!liste) return;
  let cree = null;
  modifier(() => {
    const rang = entreesDe(liste.id).length;
    cree = {
      id: crypto.randomUUID(), listId: liste.id, slug: '', number: String(rang + 1),
      name: 'Nouvelle entrée', title: 'Nouvelle entrée', subtitle: '', description: '',
      extraText: '', wikipedia: '', fields: {}, order: rang, deletedAt: null, externalIds: {},
      image: { source: null, full: null, thumb: null, crop: { cx: .5, cy: .5, w: 1 },
               status: 'manquante', locked: false, provenance: {} },
    };
    etat.data.entries.push(cree);
  });
  rendreTableau();
  rendreGrille();
  if (cree) ouvrirEditeur(cree.id);
}

function dupliquerLigne() {
  const e = entreeCourante() || entreesDe(listeTableau()?.id)[0];
  if (!e) return;
  modifier(() => {
    const rang = entreesDe(e.listId).length;
    etat.data.entries.push({
      ...structuredClone(e), id: crypto.randomUUID(), order: rang,
      name: `${e.name} (copie)`,
      number: String(Number(e.number || 0) + 1),
      image: { ...structuredClone(e.image), locked: false },
    });
  });
  rendreTableau();
  rendreGrille();
}

function mettreALaCorbeille() {
  const e = entreeCourante();
  if (!e) return alert('Ouvre d’abord une entrée.');
  if (!confirm(`Placer « ${e.name} » dans la corbeille ?`)) return;
  modifier(() => {
    e.deletedAt = new Date().toISOString();
    etat.data.trash.push({ type: 'entry', id: e.id, at: e.deletedAt });
  });
  etat.entreeCourante = null;
  $('#editeur').hidden = true;
  rendreTout();
}

function renumeroter() {
  const liste = listeTableau();
  if (!liste) return;
  const depart = Number(prompt('Premier numéro', '1'));
  if (!Number.isFinite(depart)) return;
  const entrees = entreesDe(liste.id);
  ouvrirModale(`
    <h3>Renuméroter ${entrees.length} entrée(s)</h3>
    <div style="max-height:40vh;overflow:auto">${entrees.map((e, i) =>
      `<div class="diff"><s>${esc(e.number)}</s><span>→</span><b>${depart + i}</b></div>`).join('')}</div>
    <div class="m-boutons">
      <button class="btn btn-primaire" id="m-ok">Confirmer</button>
      <button class="btn btn-discret" id="m-annuler">Annuler</button>
    </div>`);
  $('#m-ok').onclick = () => {
    modifier(() => entrees.forEach((e, i) => { e.number = String(depart + i); }));
    fermerModale();
    rendreTableau();
  };
  $('#m-annuler').onclick = fermerModale;
}

/* ================= notes ================= */

function rendreNotes() {
  const notes = etat.data.notes || [];
  $('#nb-notes').textContent = notes.length ? `(${notes.length})` : '';
  $('#vue-notes').innerHTML = `
    <div class="panneau">
      <h3>Nouvelle note</h3>
      <textarea id="n-texte" placeholder="Remarque à traiter plus tard…"></textarea>
      <div class="m-boutons">
        <select id="n-priorite"><option>normale</option><option>haute</option><option>basse</option></select>
        <button class="btn btn-primaire" id="n-ajouter">Ajouter sur la liste affichée</button>
      </div>
    </div>` +
    (notes.length ? notes.map(n => `<div class="note">
      <b>${esc(n.status || 'todo')} · ${esc(n.priority || 'normale')}</b>
      <p>${esc(n.text)}</p>
      <small class="doux">${(n.targets?.entryIds || []).length} entrée(s), ${(n.targets?.listIds || []).length} liste(s)</small>
      <div class="m-boutons"><button class="btn btn-discret" data-note-suppr="${esc(n.id)}">Supprimer</button></div>
    </div>`).join('') : '<p class="doux">Aucune note.</p>');

  $('#n-ajouter').onclick = () => {
    const texte = $('#n-texte').value.trim();
    if (!texte) return;
    modifier(() => etat.data.notes.push({
      id: crypto.randomUUID(), text: texte,
      targets: { entryIds: [], listIds: [etat.listeCourante].filter(Boolean) },
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      status: 'todo', priority: $('#n-priorite').value,
    }));
    rendreNotes();
  };
  $('#vue-notes').onclick = ev => {
    const id = ev.target.dataset?.noteSuppr;
    if (id && confirm('Supprimer cette note ?')) {
      modifier(() => { etat.data.notes = etat.data.notes.filter(n => n.id !== id); });
      rendreNotes();
    }
  };
}

function modaleNote(entryIds) {
  ouvrirModale(`
    <h3>Note sur cette entrée</h3>
    <textarea id="m-texte" rows="4" placeholder="Remarque…"></textarea>
    <div class="m-boutons">
      <button class="btn btn-primaire" id="m-ok">Enregistrer</button>
      <button class="btn btn-discret" id="m-annuler">Annuler</button>
    </div>`);
  $('#m-ok').onclick = () => {
    const texte = $('#m-texte').value.trim();
    if (!texte) return fermerModale();
    modifier(() => etat.data.notes.push({
      id: crypto.randomUUID(), text: texte,
      targets: { entryIds, listIds: [] },
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      status: 'todo', priority: 'normale',
    }));
    fermerModale();
    rendreNotes();
  };
  $('#m-annuler').onclick = fermerModale;
}

/* ================= config ================= */

function rendreConfig() {
  const total = etat.data.entries.filter(e => !e.deletedAt).length;
  const avec = etat.data.entries.filter(e => !e.deletedAt && aUneImage(e)).length;
  $('#vue-config').innerHTML = `
    <div class="panneau">
      <h3>Connexion GitHub</h3>
      <p class="doux">Le jeton autorisé à modifier <code>${REPO}</code> reste dans cet
      onglet seulement (il est oublié à la fermeture).</p>
      <input id="c-jeton" type="password" autocomplete="off" placeholder="Jeton d'accès…">
      <div class="m-boutons">
        <button class="btn btn-primaire" id="c-connecter">Vérifier et utiliser</button>
        <button class="btn btn-discret" id="c-oublier">Oublier le jeton</button>
      </div>
    </div>
    <div class="panneau">
      <h3>État</h3>
      <p class="doux">
        ${listesVivantes().length} listes · ${total} entrées · ${avec} avec image
        (${total - avec} sans)<br>
        Formats écrits : grande image ${FORMAT.full.join(' × ')},
        miniature ${FORMAT.thumb.join(' × ')}, découpées dans le même cadrage.<br>
        Révision des données : ${esc(String(etat.data.revision ?? '?'))}
      </p>
    </div>`;
  $('#c-jeton').value = jeton();
  $('#c-connecter').onclick = async () => {
    const v = $('#c-jeton').value.trim();
    sessionStorage.setItem('memoGithubToken', v);
    const r = await fetch(API, { headers: entetesGithub() });
    if (!r.ok) {
      sessionStorage.removeItem('memoGithubToken');
      return alert('Jeton refusé ou accès insuffisant.');
    }
    message('GitHub connecté');
    alert('GitHub connecté.');
  };
  $('#c-oublier').onclick = () => {
    sessionStorage.removeItem('memoGithubToken');
    $('#c-jeton').value = '';
    message('lecture seule');
  };
}

function afficherConfig() {
  afficherVue('config');
  rendreConfig();
}

/* ================= modale ================= */

function ouvrirModale(html) { $('#modale-boite').innerHTML = html; $('#modale').hidden = false; }
function fermerModale() { $('#modale').hidden = true; }
$('#modale').addEventListener('click', ev => { if (ev.target.id === 'modale') fermerModale(); });

demarrer();
