# FrigoMix

**Dis-moi ce que tu as, je te dis quoi cuisiner.**

FrigoMix résout un problème très simple : *« J'ai plein de choses chez moi mais je ne
sais pas quoi chercher sur Cookidoo. »* Au lieu de chercher une recette puis de vérifier
si on a les ingrédients, FrigoMix fait l'inverse : tu dis ce qu'il y a dans ton frigo et
tes placards, il te propose les recettes Cookidoo les plus adaptées, classées par
compatibilité. Une fois une recette choisie, tu la retrouves en un clic sur Cookidoo, ou
tu recopies son nom exact dans la recherche de ton Thermomix.

Aucun compte Cookidoo, aucun mot de passe, aucune clé API personnelle n'est jamais
demandé. Toutes tes données (favoris, historique, préférences) restent uniquement dans
ton navigateur.

## Démo

Une fois publié sur GitHub Pages : `https://<utilisateur>.github.io/<repo>/`
(à mettre à jour après le premier déploiement).

## Fonctionnement

```
Ingrédients du frigo
        ↓
  Normalisation + parsing (js/parser.js, js/ingredients.js)
        ↓
  Scoring de compatibilité pour chaque recette (js/matching.js)
        ↓
  Classement + affichage (js/app.js)
        ↓
  "Voir sur Cookidoo" → ouvre la vraie fiche recette dans un nouvel onglet
```

Les recettes viennent d'un index statique (`data/recipes-fr.json`), reconstruit une
fois par semaine par une GitHub Action à partir de sources publiques et non
authentifiées de cookidoo.fr (voir [`docs/COOKIDOO_RESEARCH.md`](docs/COOKIDOO_RESEARCH.md)
pour le détail complet de l'analyse technique). Le matching (score, ingrédients
manquants, anti-gaspillage...) tourne entièrement dans le navigateur.

## Installation locale

Aucune dépendance, aucun build : c'est du HTML/CSS/JS vanilla servi tel quel.

```bash
git clone <url-du-depot>
cd frigomix
python -m http.server 8080
# ou : npx serve .
```

Puis ouvrir `http://localhost:8080`.

Pour lancer les tests unitaires (nécessite Node ≥ 20) :

```bash
npm test
```

Pour régénérer l'index de recettes localement (voir les limites de fréquence
ci-dessous avant de le faire trop souvent) :

```bash
npm run update-recipes
```

## Déploiement GitHub Pages

Le déploiement est automatique via `.github/workflows/deploy.yml` : chaque push sur
`main` fait tourner les tests puis publie le site sur GitHub Pages.

Pour l'activer sur un nouveau dépôt :
1. Aller dans **Settings → Pages**.
2. Source : **GitHub Actions**.
3. Pousser sur `main` — le workflow s'occupe du reste.

`.github/workflows/update-recipes.yml` rafraîchit `data/recipes-fr.json` chaque lundi
et pousse un commit s'il y a du nouveau (peut aussi être lancé manuellement depuis
l'onglet Actions).

## Architecture

```
index.html              écran principal (mobile-first)
css/style.css            design system (palette, composants, dark mode)
js/
  config.js               nom de l'app, provider actif, valeurs par défaut
  ingredients.js           dictionnaire FR + normalisation + pondération
  parser.js                saisie libre -> ingrédients structurés
  matching.js               calculateRecipeMatch() : le cœur du produit
  storage.js                favoris / historique / préférences (localStorage)
  app.js                     orchestration UI
  providers/
    index.js                 fabrique de provider (mock | local-index)
    mock-provider.js          data/mock-recipes.json (dev/tests)
    local-index-provider.js   data/recipes-fr.json (production)
    cookidoo-search-link-provider.js  dernier recours : lien de recherche Cookidoo
data/
  mock-recipes.json        30 recettes de démonstration
  recipes-fr.json           index réel, régénéré chaque semaine
scripts/update-recipes.mjs  scraper respectueux (voir plus bas)
docs/COOKIDOO_RESEARCH.md   spike technique complet
tests/                      normalisation, parsing, matching (node --test)
```

Changer `CONFIG.PROVIDER` dans `js/config.js` entre `'mock'` et `'local-index'` bascule
toute l'app d'une source de données à l'autre sans toucher au reste du code.

## Comment l'index de recettes est construit

`scripts/update-recipes.mjs` (lancé une fois par semaine par GitHub Actions) :

1. Récupère une clé de recherche Algolia fraîche depuis le HTML public de
   `cookidoo.fr/search/fr-FR` (cette clé, générée par Cookidoo lui-même pour sa propre
   page de recherche, expire au bout de 7 jours — d'où la fréquence hebdomadaire).
2. Interroge Algolia avec les mots du dictionnaire d'ingrédients de FrigoMix, pour
   découvrir des identifiants de recettes pertinents.
3. Pour chaque recette nouvellement découverte (les recettes déjà connues ne sont pas
   re-téléchargées), va chercher sa fiche publique — accessible sans compte — et en
   extrait les vrais ingrédients, le temps, les portions et la difficulté à partir du
   bloc de données structurées `schema.org/Recipe` que Cookidoo publie lui-même dans
   le HTML de chaque fiche (destiné aux moteurs de recherche).
4. Limite le nombre de nouvelles fiches par exécution, avec un cache basé sur l'id pour
   ne jamais re-télécharger une recette déjà indexée : l'index se complète
   progressivement sur plusieurs semaines plutôt que de solliciter le site d'un coup.

Aucun identifiant, mot de passe ou token Cookidoo n'est utilisé à aucune étape.

## Limites connues

- Cookidoo ne propose pas d'API publique documentée : cette intégration repose sur
  l'observation du comportement réel du site (recherche Algolia + données structurées
  publiques des fiches recettes). Si Cookidoo change la structure de ces pages, le
  scraper peut cesser de fonctionner — il est conçu pour échouer proprement (une
  recette mal extraite est simplement ignorée) plutôt que de produire des données
  fausses.
- L'index ne contient pas toutes les recettes Cookidoo, seulement celles découvertes
  via les mots-clés du dictionnaire d'ingrédients, dans la limite du nombre de
  nouvelles fiches traitées chaque semaine.
- Pas de reconnexion automatique au compte Cookidoo de l'utilisateur (hors périmètre
  V1, volontairement — voir le cahier des charges).

## Confidentialité

Aucune donnée utilisateur ne quitte le navigateur. Aucun compte, aucun tracking, aucun
Google Analytics.

---

FrigoMix est un projet indépendant et n'est ni affilié, ni sponsorisé, ni approuvé par
Vorwerk ou Cookidoo®. Thermomix® et Cookidoo® sont des marques de leurs propriétaires
respectifs.
