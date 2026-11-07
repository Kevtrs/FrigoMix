# Étape 1 — Le modèle 3D IKEA du RÖDALM : analyse et décision

## Ce qui a pu être vérifié

| Source | Résultat |
|---|---|
| `www.ikea.com` (fiche 005.488.82) | **Inaccessible depuis l'environnement de développement** : le domaine est bloqué par la politique réseau du conteneur (échec DNS/proxy). Les cotes officielles n'ont donc **pas** pu être relevées automatiquement. |
| `lafabrik-boutique.fr` | Inaccessible pour la même raison : la technologie de la boutique n'a pas pu être identifiée (voir « Ce qu'il me faut »). |
| Outil `apinanaivot/IKEA-3D-Model-Download-Button` | Code source lu en entier (GitHub accessible). |

## Comment fonctionne la visionneuse IKEA (d'après le code de l'outil)

- La visionneuse est un composant `<model-viewer>` (Google), qui charge un **GLB**.
- Le GLB est compressé en **Draco** (géométrie) et ses textures sont en **WebP**
  (l'outil propose une conversion « compatible » qui décompresse Draco et convertit le WebP en PNG/JPG).
- Adresse du modèle : `https://web-api.ikea.com/{pays}/{langue}/rotera/data/model/{id}/` renvoie un JSON
  `{ modelUrl }`. Ce point d'accès **répond 401 aux requêtes simples** : il faut la session du navigateur
  sur ikea.com. Repli connu : `…/rotera/static/models/{id}-mini.glb`.
- L'outil intercepte aussi les URL `.glb` / `glb_draco` chargées par la page.
- Aucune ressource USDZ n'est mentionnée par l'outil (sur iOS, `<model-viewer>` peut générer l'USDZ à la volée
  pour la réalité augmentée).

## Peut-on utiliser ce modèle sur la boutique ? **Non.**

1. Le modèle est une création d'IKEA (ou de son prestataire 3D), protégée par le droit d'auteur.
   Son téléchargement n'est permis par aucune licence publique.
2. Le point d'accès exige une session ikea.com (401 sinon) : l'extraire revient à contourner l'usage prévu.
3. L'auteur de l'outil le limite lui-même à un **usage personnel** de planification d'intérieur
   (« use the saved models only for personal home design projects »).
4. Une utilisation commerciale (fiche produit d'une boutique) exposerait LaFabrik à une réclamation.

**Décision :** le cadre est **modélisé de zéro**, de façon paramétrique, à partir de cotes
(`public/shared/rodalm.json` → `public/shared/rodalm.glb`). Le modèle nous appartient et s'ajuste au
dixième de millimètre dès qu'on dispose de mesures réelles.

La visionneuse IKEA reste une **référence visuelle** légitime : vos captures d'écran et surtout un
cadre réel mesuré au pied à coulisse servent à caler les cotes et l'aspect.

> Rappel juridique : je ne suis pas juriste. Pour la mention du nom « IKEA RÖDALM » dans vos fiches
> (usage descriptif d'une marque), un avis professionnel peut être utile.

## Cotes utilisées (mesurées sur un modèle de référence)

Relevées sur un GLB de référence reçu ensuite (voir « Origine du GLB reçu » ci-dessous). Ce sont des
dimensions d'un objet réel, reprises dans notre propre modèle ; aucune géométrie n'a été copiée.

| Cote | Valeur |
|---|---|
| Extérieur | 228 × 318 mm (et non 230 × 320) |
| Profondeur totale | 32,2 mm |
| Largeur de moulure vue de face | 15 mm → **ouverture visible 198 × 287,6 mm** |
| Format du papier | 210 × 300 mm : 6 mm de papier restent cachés sous la moulure de chaque côté |
| Plan du papier | à 13,3 mm de l'arrière, soit **18,9 mm sous la face avant** |
| Panneau arrière | panneau de fibres brun, ~4 mm |
| Hauteur libre pour les reliefs sous la protection | **15,9 mm** (avec protection placée à 2 mm sous la face avant) |

À confirmer sur un vrai cadre : position et nature de la protection, rayon des arêtes, pattes de fixation.

## Origine du GLB reçu (`R_DALM_cadre_-_noir_by_sankah.glb`)

Les métadonnées internes du fichier contiennent : le numéro d'article IKEA `00548882`, un nom de nœud
`ASY_ART_00548882_S01_NV01`, des matériaux nommés `IKEA BLACK no 1 Foil Flat pre gloss 10 Q2` et
`HARDBOARD Brown backpanel…`, et un identifiant `cascade-scene-0`. Ce sont des traces du fichier 3D
**d'IKEA lui-même** (2 060 triangles, textures réduites). Je ne peux pas prouver comment le prestataire
l'a obtenu, mais le fichier ne ressemble pas à une modélisation originale.

Conséquence : **ne pas publier ce fichier sur la boutique** (voir section « Peut-on utiliser ce modèle »).
Il n'a pas été ajouté au dépôt. Seules ses dimensions ont servi de référence.
