# Technical spike — Cookidoo (2026-08-22)

Objectif : déterminer comment FrigoMix peut découvrir des recettes Cookidoo depuis un
site statique GitHub Pages, **sans compte Cookidoo, sans secret, sans proxy douteux**.

Méthode : inspection réelle du navigateur (DOM, `window.__NEXT_DATA__`, `performance`
resource entries, appels `fetch` reproduits manuellement) sur `https://cookidoo.fr/search/fr-FR`
et sur une page recette publique. Aucune donnée protégée n'a été copiée ; ce document ne
contient que des observations techniques et des extraits de réponse tronqués à but de
documentation.

## 1. Ce que fait réellement le site cookidoo.fr/search

- Le front est un **Next.js** (chunks `_next/static/...`).
- La recherche ne passe **pas** par une API Cookidoo classique : elle interroge
  directement **Algolia** (`https://3ta8nt85xj-dsn.algolia.net`, appId `3TA8NT85XJ`)
  depuis le navigateur, via le SDK JS officiel Algolia.
- La clé Algolia utilisée est une **clé sécurisée générée côté serveur**
  (« secured API key », format `base64(hmac + querystring)`), embarquée dans
  `window.__NEXT_DATA__.props.pageProps.algoliaApiKeyData` à **chaque rendu serveur**
  de la page (donc une clé différente à chaque chargement).

### 1.1 Contenu de la clé sécurisée (décodée)

```
attributesToRetrieve=id,title,image,rating,numberOfRatings,totalTime,category,publishedAt,description,url
filters=allowedRoles:public OR recipes-production-fr.facets.exact_matches.allowedRoles.value:public
restrictIndices=recipes-production-fr, recipes-production-fr-by-*, collections-production-fr, ...
validUntil=<timestamp unix>
```

- `validUntil` observé = généré au chargement + **exactement 7 jours**.
- La clé restreint l'accès aux seuls contenus `allowedRoles:public` (donc rien de payant),
  et limite les attributs renvoyés (voir 1.2).
- Aucun identifiant de compte n'est nécessaire pour obtenir/utiliser cette clé : elle est
  publique par construction (c'est le mécanisme standard d'Algolia pour la recherche
  côté client sur un site public).

### 1.2 Champs réellement renvoyés par l'index `recipes-production-fr`

Testé avec plusieurs requêtes (`poulet`, `risotto poulet champignon`) :

```json
{
  "id": "r106056",
  "title": "Risotto de poulet aux champignons",
  "rating": 4.4,
  "numberOfRatings": 4381,
  "publishedAt": "2022-09-22T15:31:08Z",
  "image": "https://{assethost}/image/upload/{transformation}/img/recipe/ras/Assets/.../Derivates/...",
  "totalTime": 1800,
  "objectID": "r106056"
}
```

- `category`, `description`, `url` sont dans `attributesToRetrieve` mais **jamais peuplés**
  dans les résultats observés (probablement vides côté index pour la plupart des recettes).
- **Aucun champ ingrédients** n'est exposé par Algolia. C'est la limite majeure de cette
  source : elle sert à trouver un titre/une note/un temps, pas la liste d'ingrédients.
- `image` est un template avec deux placeholders. En observant les `<img>` réellement
  rendues sur le site, on trouve : `{assethost}` → `assets.tmecosys.com` et
  `{transformation}` → un preset Cloudinary-like, ex. `t_web_shared_recipe_221x240`.
  Ces images sont déjà hotlinkées publiquement par Cookidoo lui-même.
- L'URL de la recette peut être reconstruite de façon fiable à partir de l'`id` :
  `https://cookidoo.fr/recipes/recipe/fr-FR/{id}` (pattern confirmé sur les liens de la
  page de résultats).

### 1.3 CORS — le point décisif

Test réalisé en rechargeant le navigateur sur `https://example.com` (origine totalement
différente de cookidoo.fr) puis en rejouant le même appel `fetch(...)` vers
`3ta8nt85xj-dsn.algolia.net` : **réponse 200, JSON lisible**. Algolia autorise les appels
cross-origin (c'est le fonctionnement normal de leur offre "search côté navigateur").

→ **Un site hébergé sur GitHub Pages peut donc interroger Algolia directement**, à
condition de disposer d'une clé sécurisée valide.

### 1.4 Contrainte réelle : la rotation de la clé (7 jours)

La clé n'est pas embarquée dans le bundle JS statique : elle est régénérée **par
rendu serveur** de `cookidoo.fr/search/fr-FR`, avec une validité de 7 jours. Un site
statique ne peut pas générer cette clé lui-même (le secret parent n'est jamais exposé
au navigateur — heureusement). Il faut donc une source externe qui la récupère
périodiquement.

## 2. Ce que fait la page recette publique (sans compte)

Testé sur `https://cookidoo.fr/recipes/recipe/fr-FR/r106056` sans être connecté :

Visibles publiquement (aucun mur d'inscription) :
- titre, note, nombre d'avis
- temps de préparation, temps total, nombre de portions
- **liste complète des ingrédients avec quantités** (ex. « 400 g de champignons de Paris
  frais », « 300 g de filet de poulet, sans peau »)
- niveau de difficulté (« facile »)
- infos nutritionnelles

Non visibles sans compte : les étapes de préparation guidées (le bandeau « Créez un
compte gratuitement... 100 000 recettes vous attendent » concerne le mode guidé pas à
pas, pas la fiche recette elle-même).

→ C'est une bien meilleure source d'ingrédients structurés qu'Algolia, et elle est
publique et non authentifiée.

## 3. Solutions envisagées

### Solution A — Interrogation Algolia en direct depuis le navigateur
**Avantages** : résultats toujours à jour, pas de build de données.
**Inconvénients** : pas d'ingrédients (uniquement titre/note/temps/image) → matching
impossible sans deviner les ingrédients à partir du titre (peu fiable) ; nécessite de
récupérer une clé fraîche quelque part (rotation 7 jours) donc dépend quand même d'une
tâche planifiée.
**Stabilité** : moyenne (dépend d'un mécanisme non documenté officiellement).
**Backend nécessaire** : non. **Compte Cookidoo** : non.

### Solution B — Index local construit à partir des pages recettes publiques
**Avantages** : ingrédients réels et structurés → matching fiable (c'est le cœur du
produit) ; site 100 % statique au runtime, aucune dépendance réseau à Cookidoo pour la
recherche elle-même ; fonctionne hors-ligne une fois l'index en cache ; respecte
« pas de spam » (une passe hebdomadaire, avec cache/dédup).
**Inconvénients** : recettes limitées à celles indexées lors de la dernière mise à jour
(pas les toutes dernières nouveautés du jour) ; nécessite un petit script de collecte
(GitHub Actions) qui doit rester raisonnable en fréquence et en volume.
**Stabilité** : bonne (repose sur du HTML public stable, pas sur un mécanisme interne
fragile comme la clé Algolia).
**Backend nécessaire** : non (juste une Action GitHub qui tourne une fois par semaine).
**Compte Cookidoo** : non.

### Solution C — Uniquement un lien de recherche vers Cookidoo (fallback pur)
**Avantages** : zéro dépendance technique.
**Inconvénients** : ne remplit pas l'objectif produit (afficher les recettes dans
FrigoMix). C'est le fallback ultime prévu par le cahier des charges, pas une solution
principale.

**Limite constatée** : `cookidoo.fr/search/fr-FR` est une SPA qui ne lit pas sa propre
query string au chargement — ouvrir directement `?q=poulet+riz` (même avec
`&countries=fr&languages=fr`, les paramètres observés lors d'une recherche réelle)
affiche le catalogue complet non filtré, pas les résultats de "poulet riz". La
recherche ne se déclenche que via l'interaction JS dans la barre de recherche. Il n'est
donc pas possible de proposer un vrai lien "préconfiguré" qui affiche déjà les
résultats. Le fallback de FrigoMix (`cookidoo-search-link-provider.js`) compense en
copiant la liste d'ingrédients dans le presse-papiers en plus d'ouvrir la page, pour que
l'utilisateur n'ait qu'à coller.

## 4. Décision retenue

**Solution B en principal (`LocalRecipeIndexProvider`), Solution C en secours ultime
(`CookidooSearchLinkProvider`).**

Raisons :
1. Le matching intelligent (section 21-26 du cahier des charges) a besoin d'une vraie
   liste d'ingrédients par recette — seule la Solution B la fournit légalement et
   publiquement.
2. Respecte à 100 % les contraintes : pas de compte, pas de backend payant, gratuit,
   simple, GitHub Pages.
3. Le site fonctionne hors-ligne (PWA) puisque l'index est un fichier JSON statique
   servi avec le reste de l'app.
4. Une Action GitHub hebdomadaire (`.github/workflows/update-recipes.yml`) :
   - interroge Algolia (Solution A, réutilisée ici uniquement côté serveur, pas de CORS
     à gérer) avec une clé fraîchement récupérée sur `cookidoo.fr/search/fr-FR`, pour
     une liste raisonnable de mots-clés d'ingrédients courants (poulet, bœuf, saumon,
     riz, pâtes, tomate, courgette, ...) ;
   - déduplique les identifiants de recettes obtenus ;
   - récupère la page publique de chaque recette (délai entre requêtes, cache basé sur
     l'id pour ne pas re-télécharger une recette déjà connue) pour en extraire les
     ingrédients, le temps, les portions, la difficulté ;
   - écrit `data/recipes-fr.json` (uniquement les métadonnées nécessaires à la
     découverte, jamais les étapes de préparation).
5. `CookidooPublicProvider` (Algolia live) reste défini dans le code comme provider
   optionnel/expérimental pour une évolution future (recherche « en direct » en
   complément), mais n'est pas le chemin principal en V1 à cause de l'absence
   d'ingrédients.

Aucun identifiant, mot de passe ou token Cookidoo n'est utilisé ni stocké à aucune étape.
