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

## Cotes utilisées (PROVISOIRES)

| Cote | Valeur | Origine |
|---|---|---|
| Extérieur | 230 × 320 mm | brief |
| Profondeur | 30 mm | brief |
| Format papier | 210 × 300 mm | brief |
| Largeur de moulure vue de face | 11,5 mm → ouverture visible 207 × 297 mm | hypothèse |
| Retrait du papier sous la face avant | 24,3 mm | hypothèse (dos enfoncé de 3 mm, panneau 2,5 mm) |
| Protection | PET 1 mm, à 2 mm sous la face avant | hypothèse |
| Hauteur libre pour les reliefs sous la protection | **21,3 mm** | calculée |

### À mesurer sur un vrai RÖDALM (10 minutes au pied à coulisse)

1. Largeur et hauteur extérieures, profondeur totale.
2. Largeur de la moulure vue de face (ou directement l'ouverture visible).
3. Distance entre la face avant et le papier (profondeur intérieure).
4. Distance face avant → protection, épaisseur de la protection, matière (verre ou plastique).
5. Recul du panneau arrière, son épaisseur et sa couleur.
6. Nombre et position des pattes de fixation, type d'attache murale, pied éventuel.
7. Rayon des arêtes avant (arrondies ou vives).

Il suffit ensuite de modifier `public/shared/rodalm.json` et de lancer `npm run build:frame` :
tous les produits en profitent.
