---
sourceHash: 72daf47d8a15bafe
title: Recherche
sidebar_label: Recherche
description: Comment .search() se comporte par défaut, et comment une table active la recherche plein texte classée sur les colonnes spécifiées — y compris le contenu JSONB et de tableaux.
---

`.search("term")` fonctionne sur chaque table sans configuration. Ce en quoi il
se compile dépend de ce que la table a demandé en plus.

## Le comportement par défaut

Sans configuration, `.search()` effectue une **correspondance de sous-chaîne insensible à la casse**,
combinée avec un `OU` sur toutes les colonnes de texte de la table. La chaîne de recherche
est découpée selon les espaces et chaque terme doit correspondre — mais ils peuvent correspondre
à différentes colonnes, ainsi un nom conservé dans deux colonnes distinctes est quand même trouvé :

```sql
-- .search("ada lovelace")
WHERE (first_name ILIKE '%ada%'      OR last_name ILIKE '%ada%')
  AND (first_name ILIKE '%lovelace%' OR last_name ILIKE '%lovelace%')
```

Entourez une séquence de guillemets doubles — `.search('"ada lovelace"')` — pour rechercher plutôt
l'expression exacte, de la même manière que le chemin plein texte ci-dessous les interprète.

Cela suffit pour une petite table dont le texte réside dans des colonnes simples. Cela présente
trois limites qu'aucun paramètre interne ne peut corriger :

- **Il ne peut pas inspecter l'intérieur des colonnes JSON ou tableaux.** Une table qui conserve
  son contenu recherchable dans du JSONB — tags, certifications, un questionnaire — a
  une boîte de recherche qui ne correspond silencieusement à rien.
- **Il n'y a pas de pertinence.** Les lignes sont renvoyées dans l'ordre de `orderBy`, le meilleur résultat
  pouvant donc se trouver à la page sept.
- **Il ne peut pas utiliser d'index.** Un `%` initial neutralise un index B-tree, chaque recherche devenant
  donc un balayage séquentiel (*sequential scan*). Très bien à mille lignes ; un gouffre à un million.
  `rebase doctor` signale les tables où cela commence à poser problème : absence de
  bloc `search` et plus d'environ 10 000 lignes.

Le terme fait l'objet d'une correspondance **littérale** : `%` et `_` sont des métacaractères LIKE, et ils
sont échappés avant la construction du motif, de sorte que rechercher `50%` cherche réellement
`50%` au lieu de renvoyer toutes les lignes. Si vous souhaitez des jokers (*wildcards*), l'opérateur de filtre
`like` accepte un motif (`.where("title", "like", "post-%")`) ; `.search()` ne le
fait pas.

Une recherche d'un seul mot se compile exactement dans le SQL habituel.

## Activation explicite

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Déclarez `search` sur une table, en nommant les colonnes que vous souhaitez indexer :

```ts
import { defineTable, col, json } from "@rebasepro/server/schema";

export const talents = defineTable("talents", {
    columns: {
        id:            col.uuid().primaryKey().defaultRandom(),
        fullName:      col.text().notNull(),
        bio:           col.text(),
        interests:     col.text().array(),
        questionnaire: col.jsonb(json.object({ certifications: json.array(json.string()) }, { additional: true })),
    },
    search: {
        language: "spanish",
        unaccent: true,
        fields: [
            { path: "fullName", weight: "A" },
            { path: "bio", weight: "D" },
            "interests",
            "questionnaire.certifications",
        ],
    },
    rls: [{ operation: "select", access: "authenticated" }],
});
```

Rien n'est déduit implicitement. Un champ n'est recherché que si et seulement si vous le nommez, et un chemin
qui ne peut être résolu est rejeté lors de la compilation du schéma plutôt que d'être
ignoré silencieusement — un champ de recherche que vous croyez actif alors qu'il ne l'est pas est exactement
l'erreur que ce bloc vise à éviter. Il en va de même pour une colonne restreinte par `.private()` ou
`.access({ read })` : l'index est partagé par tous les appelants.

`.search()` se compile alors en une correspondance plein texte classée par pertinence, et les lignes retournées comportent un
`_score` :

```typescript
const { data } = await client.data.talents
    .search("auditor iso 14001")
    .orderBy("_score", "desc")
    .find();
```

### Ce que crée cette déclaration

Une colonne `tsvector`, `GENERATED ALWAYS AS … STORED`, et un index GIN sur celle-ci.
Postgres recalcule la colonne à chaque écriture sur un champ source et refuse toute
tentative d'écriture directe, de sorte que l'index ne peut pas diverger de la ligne. La colonne
n'est jamais retournée par l'API.

Ils sont générés dans `.rebase/sql/search.sql`, aux côtés de `schema.sql` et
`policies.sql`, et `rebase db push` les applique pour vous — rien d'autre à
exécuter. Ils disposent de leur propre fichier car une colonne `tsvector` générée nécessite au préalable
l'existence d'une fonction utilitaire `IMMUTABLE` (`unaccent` n'étant que `STABLE`, et
l'aplatissement d'un document `jsonb` nécessitant une fonction renvoyant un ensemble), et Atlas — le
moteur derrière `db push` — ne peut pas gérer les fonctions dans son offre gratuite.

Une conséquence importante à connaître si vous déployez par migration plutôt que par push :
l'ajout d'un bloc `search` seul ne produit aucune migration, car le schéma
comparé par Atlas n'a pas changé. `rebase db generate` le signale lorsque cela se produit.
Le bloc est toujours appliqué par `rebase db push` et par la vérification du schéma
au démarrage ; pour l'inclure explicitement dans une migration, ajoutez `.rebase/sql/search.sql`,
que `rebase db generate` vient d'écrire, à celle-ci.

### Modifier le bloc ultérieurement

Une colonne générée contient son expression, et Postgres ne peut pas modifier cette
expression sur place — ajouter un champ, changer un poids, modifier la langue
ou activer `unaccent` n'est donc **pas** quelque chose que `ADD COLUMN IF NOT EXISTS` peut
appliquer à une colonne existante.

Rebase enregistre une empreinte de l'expression sur la colonne lors de sa création
et la compare à chaque démarrage et à chaque `db push`. Toute modification est refusée explicitement,
accompagnée des deux instructions permettant de l'appliquer — un `DROP COLUMN` et un `ADD COLUMN`,
qui réécrivent la table et reconstruisent l'index GIN. Exécutez-les au moment de
votre choix ; rien ne réécrit une table en production à votre place.

Deux modifications font exception. L'activation de `fuzzy` est additive — une seconde colonne — et
s'applique sans tout cela. La définition de [`mode`](#mode) modifie la requête plutôt
que la colonne, elle s'applique donc lors d'un déploiement.

Le démarrage échoue plutôt que de servir le trafic, car l'alternative est précisément ce que cette
vérification remplace : une colonne qui continue d'indexer l'ancien jeu de champs, et une recherche
qui ne retourne rien pour un contenu pourtant bien présent dans la ligne.

## Ce que vous pouvez spécifier dans `fields`

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Un chemin commence par une clé de colonne.

| Chemin | Résout vers | Exemple |
|------|-------------|---------|
| Une colonne texte | la colonne | `"fullName"` |
| Une colonne `col.text().array()` | chaque élément | `"interests"` |
| Une colonne `col.jsonb()` | chaque valeur de chaîne dans le document | `"questionnaire"` |
| Un chemin dans une colonne `col.jsonb()` | chaque valeur de chaîne à ce niveau ou en dessous | `"questionnaire.certifications"` |

Un chemin vers un objet indexe les **valeurs de chaîne à n'importe quelle profondeur**
sous celui-ci — tableaux de chaînes, objets imbriqués, tableaux d'objets. Les *clés* JSON
ne sont jamais indexées, uniquement les valeurs, afin qu'un nom de champ commun à toutes les lignes ne devienne
pas un terme qui correspond à chaque ligne.

Spécifier un enum, un UUID, une colonne `json` (plutôt que `jsonb`) ou un tableau de
nombres est refusé, avec la raison indiquée. Les enums en particulier constituent un vocabulaire
fixe : filtrez-les avec `where`, qui est exact et utilise un index.

## Options

### `language`

La configuration de recherche textuelle de Postgres, qui détermine la racinisation (*stemming*) et les mots vides (*stopwords*).
`"spanish"` ramène `auditores` à `auditor` et supprime `de` ; la valeur par défaut,
`"simple"`, ne fait ni l'un ni l'autre.

`"simple"` est la valeur par défaut car c'est le seul choix qui n'est jamais erroné — un
racinisateur appliqué à la mauvaise langue déforme silencieusement les lexèmes. Définissez-le sur la
langue de votre contenu pour bénéficier du stemming.

### `mode`

La façon dont une chaîne de recherche est comparée aux champs que vous avez spécifiés.

| `mode` | Correspondance | Trouve `Muñoz` à partir de `munoz` | Trouve `sebastian` à partir de `seb` |
|---|---|---|---|
| `"fts"` (par défaut) | lexèmes entiers, via le `tsvector` et son index GIN | avec `unaccent` | non |
| `"hybrid"` | cela, `OU` une correspondance de sous-chaîne sur les mêmes champs | **toujours** | **oui** |

```typescript
search: {
    language: "spanish",
    mode: "hybrid",
    fields: ["fullName", "questionnaire.certifications"]
}
```

Le comportement par défaut et le comportement par défaut sans bloc ont des lacunes opposées, ce que ce
mode vient combler. Mesuré sur un vrai Postgres sur cinq lignes
(`search-mode-matrix.test.ts` dans `@rebasepro/server-postgres`) :

| requête | sans bloc (ILIKE) | `"fts"` + `unaccent` | `"hybrid"` |
|---|---|---|---|
| `munoz` | `Ana Munoz` | `Ana Munoz`, `Sebastian Muñoz` | `Ana Munoz`, `Sebastian Muñoz` |
| `seb` | les deux Sebastians | — | les deux Sebastians |
| `audit` | la ligne `Lead Auditor` | — | la ligne `Lead Auditor` |
| `iso 14001` | la ligne `ISO 14001` | la ligne `ISO 14001` | la ligne `ISO 14001` |

`fuzzy` atteint les mêmes lignes, mais seulement une fois son seuil de similarité ajusté : avec
la valeur par défaut de 0.3, `iso 14001` renvoie également une ligne `ISO 9001`. `"hybrid"` n'a
aucun seuil à régler — une sous-chaîne est présente ou elle ne l'est pas.

**Ce que cela coûte.** La partie sous-chaîne ne peut pas utiliser l'index GIN ; un `%` initial
ne le peut jamais. La partie `@@` s'exécute toujours en premier et continue d'utiliser l'index, donc ce que
ce mode ajoute est un scan sur les lignes rejetées par l'index. Sur une grande table, c'est
la différence entre un parcours d'index et un parcours séquentiel, raison pour laquelle il s'agit
d'un mode optionnel et non du comportement par défaut.

**Le modifier sur une table en production est sans risque** — c'est la seule option
de ce bloc dans ce cas. `mode` se situe côté requête : il ne modifie aucune colonne générée,
aucune expression de génération et aucun index, et ne déclenche donc pas le refus décrit dans
[Modifier le bloc ultérieurement](#modifier-le-bloc-ultérieurement). Son activation ne nécessite qu'un
déploiement et rien d'autre.

Il supprime les accents sur la partie sous-chaîne, **que `unaccent` soit défini ou non**,
car cette suppression s'effectue également côté requête. C'est délibéré : `unaccent` est le
paramètre que vous ne pouvez pas activer plus tard sans réécrire la table, ainsi une table
bloquée sans celui-ci peut tout de même trouver `Muñoz`. Ce que `unaccent` apporte toujours,
c'est la suppression des accents sur la partie `@@`, où sont stockés les lexèmes.

Il ajoute l'extension `unaccent` et une fonction utilitaire `IMMUTABLE` à la
base de données s'ils ne sont pas déjà présents. Les deux instructions utilisent
`IF NOT EXISTS` / `CREATE OR REPLACE`, et aucune ne touche à une table.

### `unaccent`

Supprime les accents avant l'indexation, de sorte que `auditoria` corresponde à `auditoría`.

Ce n'est pas cosmétique dans une langue comportant des accents. Postgres racinise les deux orthographes
en **lexèmes différents** — `to_tsvector('spanish', 'auditoría')` produit
`auditor` tandis que `'auditoria'` produit `auditori` — donc sans cela, une requête saisie
sans accents manque toutes les lignes qui en comportent, ce qui représente la majorité des requêtes
des utilisateurs.

Nécessite l'extension `unaccent`.

### `fuzzy`

Effectue également une correspondance sur la similarité trigramme, afin que les correspondances approximatives soient tout de même classées : `iso14000` trouvant
`ISO 14001`, ce qu'aucune racinisation ne fera car il s'agit simplement de
lexèmes différents.

```typescript
search: {
    fields: ["fullName", "questionnaire.certifications"],
    fuzzy: true,
    fuzzyThreshold: 0.3   // default
}
```

Ajoute une seconde colonne générée et un index trigramme, et nécessite `pg_trgm`.
Cela coûte du temps d'écriture et de l'espace disque ; mais résout la cause la plus courante d'échec de recherche.

### `weight`

Chaque champ porte l'une des quatre classes de poids de Postgres, de `A` (le plus fort)
à `D`. `ts_rank` attribue à une correspondance de classe `A` un score bien supérieur à celui d'une classe `D`, ce qui
permet à un nom d'avoir plus de poids qu'une mention fortuite dans une longue description. Les champs prennent la valeur `B` par défaut.

### `column`

La colonne générée est nommée `search_vector`. Ne la modifiez que si ce nom entre en conflit
avec une colonne existante — elle fait partie de votre schéma une fois créée, et
la renommer ultérieurement nécessite une suppression et une recréation, ce qui réécrit la table.

## Classement

`_score` correspond au `ts_rank` calculé pour la même requête que celle ayant servi à faire correspondre les lignes,
et n'est présent que si la table a activé cette option *et* que la requête contenait une chaîne de
recherche.

Avec `mode: "hybrid"`, une ligne trouvée uniquement par la partie sous-chaîne reçoit un petit
score constant (0.001) au lieu de zéro — inférieur au plus petit `ts_rank` qu'une véritable correspondance
de lexème peut produire, de sorte qu'une correspondance de mot entier l'emporte toujours sur une sous-chaîne,
et les lignes trouvées uniquement par sous-chaîne se rabattent sur le critère de départage propre à la requête au lieu d'être
renvoyées dans un ordre arbitraire.

Lorsque `fuzzy` est activé, la similarité trigramme est **ajoutée** à ce rang. Ce n'est pas un
simple raffinement — c'est ce qui confère à `fuzzy` un véritable classement. Une faute de frappe ne correspond à rien
sur le chemin exact, de sorte que chaque ligne trouvée a un `ts_rank` exactement égal à zéro ; ordonner
uniquement par rang renverrait la meilleure correspondance dans un ordre arbitraire.
Les deux termes sont additionnés plutôt que pondérés, de sorte qu'une ligne correspondant exactement
cumule les deux et surclasse une ligne simplement similaire sans avoir besoin d'un coefficient
pour le spécifier. En dehors de ces deux conditions, `orderBy: "_score"` est un champ inconnu et
renvoie une erreur 400 plutôt que de renvoyer silencieusement des lignes non triées.

`_score` ne peut pas être combiné avec la pagination par curseur (`startAfter`). La pertinence étant
calculée par requête plutôt que stockée, il n'y a aucune valeur sur la ligne du curseur à
comparer pour la page suivante, et deux requêtes avec des chaînes de recherche différentes
produisent des scores qui ne sont pas sur la même échelle. Utilisez `limit`/`offset` pour
les pages ordonnées par pertinence.

## Pourquoi cette ligne a-t-elle correspondu ?

Une liste classée vous indique *quelles* lignes correspondent, mais jamais *pourquoi* une ligne est présente. Demandez à chaque ligne
de s'expliquer :

```typescript
const { data } = await client.data.talents
    .search("iso 14001", { explain: true })
    .orderBy("_score", "desc")
    .find();

data[0]._matches;
// [{ field: "questionnaire.certifications",
//    snippet: "<mark>ISO</mark> <mark>14001</mark> Lead Auditor" }]
```

`field` correspond exactement au chemin tel que déclaré dans `fields`, ce qui vous permet de le mapper vers un
libellé pour l'affichage. Les champs sont renvoyés dans l'ordre où vous les avez déclarés.

Par requête et non par table, car le coût s'applique par requête : un `ts_headline`
par champ déclaré et par ligne renvoyée, et `ts_headline` réanalyse le document
plutôt que de lire l'index. Idéal pour une page de résultats, inadapté pour un export.

**L'extrait contient du balisage par construction** — chaque correspondance est entourée de
`<mark>`. Affichez-le en HTML ou supprimez les balises, mais ne le traitez pas comme du texte
brut, et ne faites pas confiance au texte environnant : il s'agit de ce que l'utilisateur a saisi.
Découper selon les balises `<mark>` et restituer les segments est plus sûr que
d'utiliser `dangerouslySetInnerHTML`.

Avec `mode: "hybrid"`, un champ qui ne correspond que par sous-chaîne est également signalé — c'est
le champ qui a déclenché le résultat. Son extrait revient sans balisage :
`ts_headline` marque les lexèmes, et la moitié d'un mot n'en est pas un.

Lorsque `unaccent` est activé, les extraits s'affichent avec les accents supprimés — `Auditoria`, et non
`Auditoría`. L'exécution de `ts_headline` sur le texte original ne peut pas retrouver une correspondance produite
par une requête sans accent, et renverrait donc le texte sans aucune mise en surbrillance ;
un extrait lisible qui surligne vaut mieux qu'un extrait plus élégant qui
n'affiche silencieusement rien.

## Ajouter le bloc à une table en production

La colonne générée est ajoutée lors de la vérification du schéma au démarrage, comme n'importe quelle
autre colonne. Son index est construit en arrière-plan une fois que le serveur répond aux requêtes, avec
`CREATE INDEX CONCURRENTLY` afin de ne pas bloquer les écritures (voir
[Indexes](/docs/backend/indexes#when-they-are-created)). Jusqu'à ce que l'index soit
construit, la recherche fonctionne mais parcourt toute la table. L'ajout d'une colonne générée *stockée*
(stored) réécrit la table ; sur une table volumineuse, planifiez donc cette opération comme n'importe quelle
réécriture.

## Voir aussi

- [REST API](/docs/backend/api/) — les paramètres de requête sous lesquels une recherche parvient au serveur
- [Indexes](/docs/backend/indexes/) — ce que le bloc de recherche crée, et ce que cela coûte
- [Querying Data](/docs/sdk/querying/) — effectuer des recherches depuis le SDK typé
