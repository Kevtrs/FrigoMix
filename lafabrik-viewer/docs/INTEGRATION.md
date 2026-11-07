# Intégration dans la boutique LaFabrik

> **Rien n'a été modifié sur la boutique en ligne.** Ce document décrit la méthode à appliquer
> après votre accord. La technologie de `lafabrik-boutique.fr` n'a pas pu être identifiée depuis
> l'environnement de développement (site injoignable) : indiquez-la-moi (Shopify, WooCommerce,
> PrestaShop, Wix…) ou envoyez une capture du code source d'une fiche produit (`Ctrl+U`).

## Principe : un composant web autonome

La visionneuse est livrée comme une balise HTML `<lafabrik-viewer>`. Elle ne dépend d'aucun framework :
elle fonctionne dans n'importe quel CMS qui autorise un bloc HTML personnalisé.

```html
<script type="module" src="https://VOTRE-HEBERGEMENT/lafabrik-3d/lafabrik-viewer.js"></script>
<lafabrik-viewer
  base="https://VOTRE-HEBERGEMENT/lafabrik-3d/"
  src="products/marquez/config.json"
  poster="products/marquez/poster.webp"
  alt="Cadre Marc Márquez #93 en relief, vue 3D">
</lafabrik-viewer>
```

Comportement sur la fiche :

1. Seuls ~4 Ko de script et l'image `poster.webp` (~35 Ko) sont chargés avec la page.
2. Le moteur 3D (~190 Ko gzip) et le modèle (~100 Ko avec les fichiers de test ; davantage avec vos vrais fichiers) ne sont téléchargés qu'au clic sur « Voir en 3D ».
   Ajoutez l'attribut `autoload` pour charger dès que la visionneuse approche de l'écran.
3. Sans WebGL : l'aperçu reste affiché avec un message ; les photos de la fiche restent utilisables.
4. Plein écran natif sur Android/ordinateur, plein écran simulé sur iPhone (Safari ne le permet pas aux éléments).

Personnalisation CSS depuis la page : `lafabrik-viewer { --lf-aspect: 1 / 1; --lf-bg: #f5f5f5; --lf-radius: 0; }`.

## Fichiers à publier

`npm run build` produit :

```
dist/embed/lafabrik-viewer.js      ← script à inclure
dist/embed/chunks/…                ← moteur 3D chargé à la demande
```

Copiez dans un même dossier d'hébergement : `dist/embed/*` + `public/shared/` + `public/products/`.
(Les fichiers de `sources/` — PNG originaux, 3MF, STL — ne doivent **jamais** être publiés.)

Hébergements possibles : le serveur de la boutique (dossier `/lafabrik-3d/`), Cloudflare Pages /
Netlify (gratuit, CDN), ou les fichiers de la plateforme (Shopify « Files »). Si l'hébergement est sur un
autre domaine que la boutique, il doit renvoyer l'en-tête `Access-Control-Allow-Origin` (actif par défaut
sur Cloudflare Pages, Netlify et GitHub Pages). Types MIME à vérifier : `.glb` → `model/gltf-binary`,
`.webp` → `image/webp`, `.js` → `text/javascript`.

## Selon la plateforme

### Shopify
1. *Contenu → Fichiers* ou hébergement externe pour les fichiers ci-dessus.
2. Thème → *Personnaliser* → fiche produit → bloc **« HTML personnalisé / Liquid personnalisé »**,
   avec le code ci-dessus où `marquez` est remplacé par une métadonnée (metafield) du produit :
   `src="products/{{ product.metafields.lafabrik.viewer_id }}/config.json"`.
3. Le bloc n'est rendu que si la métadonnée existe : `{% if product.metafields.lafabrik.viewer_id %}…{% endif %}`.

### WooCommerce (WordPress)
1. Fichiers dans `wp-content/uploads/lafabrik-3d/` (ou un CDN).
2. Champ personnalisé `lafabrik_viewer_id` sur chaque produit, puis un petit extrait (plugin
   « Code Snippets ») sur le hook `woocommerce_before_single_product_summary` qui affiche la balise.

### PrestaShop
Module « HTML personnalisé » ou hook `displayProductAdditionalInfo`, même balise.

### Wix / Squarespace
Bloc « Intégrer du code » (iframe) pointant vers une page hébergée contenant la balise : fonctionne,
mais le plein écran dépend des réglages de l'iframe (`allow="fullscreen"`).

## Recommandation de mise en page

- Placer la visionneuse **en première position de la galerie** (ou deuxième, après la photo principale),
  avec le bouton « Voir en 3D ».
- Garder les vraies photos : la 3D les complète, elle ne les remplace pas.
- Tester d'abord sur une fiche **masquée** (produit brouillon) avant toute mise en ligne.

## Protection du travail

Le navigateur doit télécharger `relief.glb` et le fond WebP pour les afficher : un visiteur technique
peut les récupérer. Mesures en place : le PNG d'impression et les 3MF/STL ne sont jamais publiés,
le fond publié est plafonné à 4096 px en WebP, et la géométrie est compressée (meshopt). Pour aller
plus loin : fond publié en 2048 px uniquement, ou filigrane discret dans le fond publié.
