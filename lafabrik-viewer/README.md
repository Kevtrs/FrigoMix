# LaFabrik — visionneuse 3D des cadres en relief

Visionneuse 3D interactive (Three.js) pour les cadres LaFabrik : un **cadre IKEA RÖDALM commun**,
modélisé de zéro, + pour chaque produit **le PNG original du fond** et **les vraies pièces imprimées**
(3MF Bambu Studio ou STL), assemblés en millimètres.

> **État du prototype Márquez #93** : toute la chaîne fonctionne et est testée, mais avec des
> **fichiers de substitution** (mire graphique + « 93 » générique dans un 3MF de test façon Bambu
> Studio). Il suffit de déposer vos vrais fichiers (voir « Remplacer les fichiers de substitution »).

## Démarrage

```bash
cd lafabrik-viewer
npm install
npm run dev            # http://localhost:5173
```

| Page | Rôle |
|---|---|
| `index.html` | visionneuse publique + comparaison avec vos photos |
| `editor.html` | **mode édition** (préparation des produits, enregistre `config.json`) |
| `demo-fiche-produit.html` | exemple d'intégration dans une fiche produit |

Ajoutez `?product=marquez` pour choisir le produit, `&quality=low|medium|high` pour forcer un niveau.

## Commandes

| Commande | Effet |
|---|---|
| `npm run build:frame` | régénère `public/shared/rodalm.glb` depuis les cotes `rodalm.json` |
| `npm run import -- <id> [fichiers]` | 3MF/STL → `relief.glb` + mise à jour de `config.json` (positions conservées) |
| `npm run textures [-- <id>]` | PNG original → `background.webp` (≤4096 px) + `background-2048.webp` |
| `npm run posters [-- <id>]` | rend l'image d'aperçu `poster.webp` depuis la vraie scène |
| `npm run new-product -- <id> "<Nom>" fond.png pièces.3mf` | crée un produit complet en une commande |
| `npm test` | tests unitaires (lecture 3MF, peinture AMS, cotes du cadre) |
| `npm run check` (`-- --dist`) | test de bout en bout dans Chromium : bureau, iPhone, Android + captures |
| `npm run build` | site de démonstration (`dist/site`) + composant à intégrer (`dist/embed`) |

## Organisation

```
public/                      ← publié sur le web
  shared/rodalm.json         cotes du cadre (mm) — source unique
  shared/rodalm.glb          cadre généré (15 Ko, 808 triangles)
  products/index.json        liste des produits
  products/marquez/
    config.json              fond, pièces, positions, filaments, caméra, photos
    relief.glb               pièces imprimées (une node par pièce, une couleur par filament)
    background.webp          fond (dérivé du PNG original)
    background-2048.webp     fond allégé pour mobiles
    poster.webp              aperçu affiché avant chargement
sources/                     ← JAMAIS publié : vos fichiers originaux
  marquez/background.png     PNG d'impression original
  marquez/*.3mf, *.stl       projets Bambu Studio / STL
  marquez/import.json        liste des sources à importer
src/core/rodalm.js           générateur paramétrique du RÖDALM
src/core/viewer.js           moteur de la visionneuse
src/embed/lafabrik-viewer.js composant <lafabrik-viewer> (aperçu, chargement différé, barre d'outils)
src/editor/editor.js         mode édition
tools/                       import 3MF/STL, textures, aperçus, tests
docs/ANALYSE_IKEA.md         étape 1 : modèle IKEA (non exploitable) et cotes à mesurer
docs/INTEGRATION.md          intégration dans la boutique
```

La structure diffère volontairement de `products/<id>/background.png` du brief : le PNG
d'impression reste dans `sources/` pour ne jamais être téléchargeable sur le site.

## Repère et unités

Tout est en **millimètres**. Origine = **centre de la surface du papier**, X vers la droite,
Y vers le haut, Z vers le spectateur. Une pièce à `Z = 0` est posée sur le papier.

- Le fond est un plan de `widthMm × heightMm` (210 × 300) : les proportions viennent du PNG, jamais
  d'un étirement. `npm run textures` alerte si le PNG n'a pas les proportions déclarées.
- À l'import, chaque pièce est recentrée (centre XY = 0, base Z = 0) : les coordonnées du plateau
  ne sont pas celles du cadre. La **disposition relative des objets sur le plateau** sert de position
  initiale (centrée sur le cadre) : si vous disposez les pièces sur le plateau comme sur le cadre,
  le placement est juste immédiatement.

## Ce que l'import 3MF récupère

- Géométrie exacte et dimensions réelles (unité du 3MF respectée), objets et sous-pièces Bambu
  (`3D/Objects/*.model`, composants, matrices de transformation, miroirs).
- Filament de chaque pièce (`Metadata/model_settings.config`) et **palette AMS** (couleur, type :
  `Metadata/project_settings.config`).
- Faces **peintes** multi-couleurs (`paint_color` Bambu / `mmu_segmentation` Prusa) : chaque triangle
  prend le filament majoritaire de sa peinture (une peinture très fine à l'intérieur d'un seul grand
  triangle est donc approchée).
- Matériaux et couleurs standard 3MF (`basematerials`, `colorgroup`).
- Les modificateurs, volumes négatifs et bloqueurs de supports sont ignorés (signalés).

Blender n'est pas nécessaire : la conversion se fait en Node (glTF-Transform + meshoptimizer).
Option `--simplify 0.5` pour alléger un modèle très dense (garde 50 % des triangles).

## Mode édition

`npm run dev` puis `http://localhost:5173/editor.html?product=marquez`

- Cliquer une pièce → poignées de déplacement / rotation ; flèches du clavier 0,5 mm
  (Maj = 5 mm, Alt = 0,1 mm), Pg↑/Pg↓ pour Z, Q/D pour pivoter, Ctrl+Z, Ctrl+S.
- Panneau : X, Y, Z, rotation, inclinaisons, échelle (globale et Z seule), visibilité, couleur forcée ;
  couleur et finition de chaque filament (mat, standard, brillant, silk, métallisé) ; décalage /
  rotation / largeur du fond (proportions verrouillées) ; présence de la protection ; vue initiale
  (« utiliser la vue actuelle »).
- **Photo de référence** : ouvrez une photo de face du vrai cadre, réglez opacité / échelle / décalage
  pour la superposer et ajuster les pièces au millimètre.
- Alertes : pièce qui toucherait la protection, qui s'enfonce dans le fond ou déborde de l'ouverture.
- « Enregistrer » écrit `public/products/<id>/config.json` (serveur de dev). Ailleurs : téléchargement.

## Ajouter un produit (procédure)

```bash
npm run new-product -- senna "Ayrton Senna — McLaren" chemin/fond.png chemin/senna.3mf
npm run dev   # puis editor.html?product=senna : placer les pièces, régler les couleurs, Enregistrer
npm run posters -- senna
```

Pour des STL séparés, décrivez-les dans `sources/<id>/import.json` :

```json
{ "sources": [
  { "file": "93_face.stl",   "piece": "numero-93", "part": "face",   "filament": 1 },
  { "file": "93_lisere.stl", "piece": "numero-93", "part": "liseré", "filament": 2 }
] }
```

et définissez les couleurs dans `config.json → filaments`. Puis `npm run import -- <id>`.

## Remplacer les fichiers de substitution (Márquez #93)

1. PNG original → `sources/marquez/background.png`, puis `npm run textures -- marquez`
   et retirer `"placeholder": true` dans `config.json`.
2. Projet Bambu Studio → `sources/marquez/`, l'indiquer dans `sources/marquez/import.json`
   (et supprimer `placeholder-93.*`), puis `npm run import -- marquez --reset-positions`.
3. Photos → `public/products/marquez/photos/`, déclarées dans `config.json` :
   `"photos": [{ "src": "photos/face.jpg", "label": "Face", "view": "front" }]`.
4. `editor.html?product=marquez` : caler les pièces sur la photo de face, Enregistrer.
5. `npm run posters -- marquez`.

## Rendu

- Éclairage studio : environnement « pièce » + lumière principale qui projette de **vraies ombres** des
  reliefs sur le fond et des moulures sur le papier, contre-jour pour le dos ; ombre de contact au sol.
- Tone mapping « Neutral » (couleurs du PNG peu altérées), fond gris très clair.
- Stries de couches FDM (0,2 mm) simulées sur les flancs des pièces, visibles en gros plan.
- Protection : **désactivée par défaut** (les cadres LaFabrik n'ont pas de vitre). Le code est conservé : mettre
  `"glass": { "enabled": true, "visibleByDefault": true }` dans `config.json` (ou cocher « Protection présente »
  dans l'éditeur) la réactive ; plastique très transparent, masquable, jamais traversée par les reliefs.

## Performances mesurées (fichiers de test)

| | |
|---|---|
| Page produit avant clic | ~4 Ko de script + aperçu 36 Ko |
| Moteur 3D (au clic) | ~175–190 Ko gzip |
| Données Márquez de test | cadre 15 Ko + relief 26 Ko + fond 48 Ko (mobile) / 85 Ko |
| Scène | ~4 300 triangles, 18 appels de dessin |
| Chargement (Chromium logiciel, local) | 0,3–0,5 s |

Mobile : rendu à la demande (aucun calcul quand rien ne bouge), pause hors écran, plafond de résolution,
baisse automatique de résolution sous ~40 i/s, textures 2048 px, niveau « low » (ombres 1024, sans
anticrénelage ni stries) pour les appareils modestes ou en mode économie de données.
