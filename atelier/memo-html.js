// Lecture et modification chirurgicale de memo.html — version navigateur.
//
// Porté de apps/memo/atelier/memo-html.mjs. La logique est identique au geste
// près ; seules les deux extrémités changent : le module local lit et écrit un
// fichier sur le disque, celui-ci reçoit et rend une chaîne de caractères, que
// app.js va chercher dans le dépôt puis y renvoie par l'API GitHub.
//
// Rappel du principe (inchangé) : memo.html EST l'application, et deux choses y
// déterminent les images :
//   - la colonne 1 de chaque ligne de liste, qui porte le chemin de la
//     miniature « thumbs/<liste>/<clé>.<ext> » ;
//   - IMAGE_FILES_MAP, qui donne la grande image, indexée par <liste> puis par
//     la <clé> lue dans le nom de fichier de la miniature.
//
// Les listes arrivent par trois chemins qui se cumulent, dont un écrit à la
// main : les réécrire serait risqué. L'Atelier ne touche donc pas aux listes.
// Il tient un bloc à part, ATELIER_IMAGES, appliqué à DEFAULT_LISTS au
// chargement — un seul endroit à écrire, valable pour les trois provenances.
//
// Il n'y a pas de sauvegarde datée ici, contrairement à la version locale :
// chaque écriture passe par un commit, et l'historique Git joue ce rôle.

// Point d'insertion : juste après le dernier apport à DEFAULT_LISTS.
const ANCRE = 'DEFAULT_LISTS.push(...CURATED_LISTS_V3);';

const BLOC = (json) => `
/* ══════════ IMAGES DE L'ATELIER ══════════
   Bloc régénéré par l'Atelier (atelier/memo-html.js) : ne pas modifier à la
   main. Il porte les miniatures recadrées, par identifiant de liste puis par
   rang de ligne. Les grandes images correspondantes sont dans IMAGE_FILES_MAP. */
const ATELIER_IMAGES = ${json};
for (const [idListe, lignes] of Object.entries(ATELIER_IMAGES)) {
  const liste = DEFAULT_LISTS.find(l => l.id === idListe);
  if (!liste) continue;
  for (const [rang, chemin] of Object.entries(lignes)) {
    if (liste.rows[rang]) liste.rows[rang][1] = chemin;
  }
}`;

/* ---------- extraction ---------- */

// Bornes du littéral JSON qui suit « const <nom> = ».
export function bornes(html, nom, obligatoire = true) {
  const prefixe = `const ${nom} = `;
  const ancre = html.indexOf(prefixe);
  if (ancre < 0) {
    if (obligatoire) throw new Error(`${nom} introuvable dans memo.html`);
    return null;
  }
  const debut = ancre + prefixe.length;
  const ouvrant = html[debut];
  if (ouvrant !== '[' && ouvrant !== '{') throw new Error(`${nom} n'est pas un littéral JSON`);
  const fermant = ouvrant === '[' ? ']' : '}';
  let profondeur = 0, dansTexte = false, echappe = false;
  for (let i = debut; i < html.length; i++) {
    const c = html[i];
    if (dansTexte) {
      if (echappe) echappe = false;
      else if (c === '\\') echappe = true;
      else if (c === '"') dansTexte = false;
      continue;
    }
    if (c === '"') dansTexte = true;
    else if (c === ouvrant) profondeur++;
    else if (c === fermant && --profondeur === 0) return { debut, fin: i + 1 };
  }
  throw new Error(`${nom} : littéral jamais refermé`);
}

// Identifiants de toutes les listes de l'application, quelle que soit leur
// provenance. Un relevé des « id » suffit : on ne réécrit jamais ces blocs.
function idsDeListes(html) {
  const ids = new Set();
  for (const nom of ['DEFAULT_LISTS', 'EXPANSION_LISTS', 'CURATED_LISTS_V3']) {
    const b = bornes(html, nom, false);
    if (!b) continue;
    const bloc = html.slice(b.debut, b.fin);
    for (const m of bloc.matchAll(/(?:^|[{,\s])"?id"?\s*:\s*['"]([a-z0-9_]+)['"]/gi)) ids.add(m[1]);
  }
  return ids;
}

/** Analyse le texte de memo.html. Rend l'objet manipulé par poserImage. */
export function lireMemo(html) {
  const bImages = bornes(html, 'IMAGE_FILES_MAP');
  const bAtelier = bornes(html, 'ATELIER_IMAGES', false);
  return {
    html,
    bImages,
    bAtelier,
    imagesFull: JSON.parse(html.slice(bImages.debut, bImages.fin)),
    imagesAtelier: bAtelier ? JSON.parse(html.slice(bAtelier.debut, bAtelier.fin)) : {},
    idsListes: idsDeListes(html),
  };
}

/* ---------- écriture ---------- */

// IMAGE_FILES_MAP tient sur une seule ligne dans le fichier d'origine : on
// garde cette forme pour que le diff reste d'une ligne.
function serialiser(map) {
  return '{' + Object.entries(map)
    .map(([k, v]) => `${JSON.stringify(k)}:${JSON.stringify(v)}`).join(',') + '}';
}

/** Rend le nouveau texte de memo.html. N'écrit rien : c'est app.js qui commite. */
export function ecrireMemo(memo) {
  const { html, bImages, bAtelier } = memo;
  const jsonImages = serialiser(memo.imagesFull);
  const jsonAtelier = JSON.stringify(memo.imagesAtelier, null, 1);
  for (const bloc of [jsonImages, jsonAtelier]) {
    // une donnée ne doit jamais pouvoir refermer le <script>
    if (/<\/script/i.test(bloc)) throw new Error('Données contenant </script : écriture refusée');
  }

  let sortie;
  if (bAtelier) {
    // les deux littéraux existent : on remplace le plus loin d'abord, sinon
    // les bornes du premier glisseraient
    const [premier, second] = bImages.debut < bAtelier.debut
      ? [[bImages, jsonImages], [bAtelier, jsonAtelier]]
      : [[bAtelier, jsonAtelier], [bImages, jsonImages]];
    sortie = html.slice(0, second[0].debut) + second[1] + html.slice(second[0].fin);
    sortie = sortie.slice(0, premier[0].debut) + premier[1] + sortie.slice(premier[0].fin);
  } else {
    const ancre = html.indexOf(ANCRE);
    if (ancre < 0) throw new Error(`point d'insertion « ${ANCRE} » introuvable dans memo.html`);
    const apres = ancre + ANCRE.length;
    sortie = html.slice(0, apres) + BLOC(jsonAtelier) + html.slice(apres);
    // IMAGE_FILES_MAP se trouve après le point d'insertion : ses bornes ont
    // bougé, on les relit sur le texte produit
    const b = bornes(sortie, 'IMAGE_FILES_MAP');
    sortie = sortie.slice(0, b.debut) + jsonImages + sortie.slice(b.fin);
  }

  // relecture de contrôle avant de rendre le texte : si un littéral n'est plus
  // du JSON valide, mieux vaut échouer ici que publier une application cassée
  for (const nom of ['IMAGE_FILES_MAP', 'ATELIER_IMAGES', 'DEFAULT_LISTS', 'CURATED_LISTS_V3']) {
    const b = bornes(sortie, nom, false);
    if (b) JSON.parse(sortie.slice(b.debut, b.fin));
  }
  return sortie;
}

/* ---------- correspondance entrée ↔ ligne de l'application ---------- */

// Clé de fichier d'une entrée : celle que porte déjà sa miniature, sinon son
// numéro. Deux entrées d'une même liste ne peuvent pas partager la même clé.
export function cleDeEntree(entree, prises) {
  const actuel = String(entree.image?.thumb || '');
  const m = actuel.match(/^thumbs\/[^/]+\/([^/.]+)\.[a-z0-9]+$/i);
  if (m) return m[1];
  const base = String(entree.number || entree.order + 1).replace(/[^a-z0-9_-]+/gi, '-') || String(entree.order + 1);
  if (!prises?.has(base)) return base;
  if (!prises.has(`${base}b`)) return `${base}b`;
  let n = 2;
  while (prises.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

export function clesPrises(entrees) {
  const prises = new Set();
  for (const e of entrees) {
    const m = String(e.image?.thumb || '').match(/^thumbs\/[^/]+\/([^/.]+)\.[a-z0-9]+$/i);
    if (m) prises.add(m[1]);
  }
  return prises;
}

/** Chemins de fichiers d'une entrée, sans toucher à l'application. */
export function cheminsDe(idListe, cle) {
  return {
    original: `originaux/${idListe}/${cle}.webp`,
    full: `full/${idListe}/${cle}.webp`,
    thumb: `thumbs/${idListe}/${cle}.webp`,
  };
}

/**
 * Inscrit une image dans l'application : la miniature via ATELIER_IMAGES (par
 * rang de ligne) et la grande image via IMAGE_FILES_MAP (par clé de fichier).
 * Les deux nomment le même fichier : ils ne peuvent pas diverger.
 */
export function poserImage(memo, idListe, rang, cle) {
  if (!memo.idsListes.has(idListe)) throw new Error(`liste ${idListe} absente de l'application`);
  const chemins = cheminsDe(idListe, cle);
  (memo.imagesAtelier[idListe] ||= {})[String(rang)] = chemins.thumb;
  (memo.imagesFull[idListe] ||= {})[cle] = chemins.full;
  return chemins;
}
