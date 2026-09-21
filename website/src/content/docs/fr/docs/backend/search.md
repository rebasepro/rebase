---
sourceHash: 7047b4fd73bde89d
title: Recherche
sidebar_label: Recherche
description: Comment .search() se comporte par défaut, et comment activer la recherche en texte intégral classée par pertinence sur les champs de votre choix pour une collection Postgres — y compris les contenus JSONB et tableaux.
---

`.search("term")` fonctionne sur chaque collection sans aucune configuration. Ce en quoi il se compile dépend de ce que la collection a configuré ou non.

## Le comportement par défaut

Sans configuration, `.search()` effectue une **recherche de sous-chaîne insensible à la casse**, combinée par un `OU` logique (OR) sur l'ensemble des propriétés `string` de premier niveau de la collection. La chaîne de recherche est découpée selon les espaces et chaque terme doit correspondre — mais ils peuvent correspondre à différentes propriétés, ce qui permet de trouver un nom réparti sur deux colonnes :

```sql
-- .search("ada lovelace")
WHERE (first_name ILIKE '%ada%'      OR last_name ILIKE '%ada%')
  AND (first_name ILIKE '%lovelace%' OR last_name ILIKE '%lovelace%')
```

Entourez une suite de mots de guillemets doubles — `.search('"ada lovelace"')` — pour chercher l'expression exacte à la place, de la même manière que le chemin en recherche plein texte décrit plus bas les interprète.

C'est suffisant pour une petite collection dont le texte se trouve dans des colonnes classiques. Cela présente trois limites qu'aucun paramètre interne ne peut résoudre :

- **Il ne peut pas inspecter l'intérieur des propriétés `map` ou `array`.** Une collection qui stocke son contenu interrogeable dans du JSONB — étiquettes, certifications, questionnaire — dispose d'un champ de recherche qui ne renverra silencieusement rien.
- **Il n'y a pas de notion de pertinence.** Les lignes sont renvoyées dans l'ordre du `orderBy`, de sorte que la meilleure correspondance peut se trouver à la page sept.
- **Il ne peut pas utiliser d'index.** Un caractère `%` en début de motif empêche l'utilisation d'un B-tree, donc chaque recherche effectue un parcours séquentiel (sequential scan). Cela convient pour un millier de lignes, mais devient critique à un million.

Le terme fait l'objet d'une correspondance **littérale** : `%` et `_` sont des métacaractères LIKE, et ils sont échappés avant la construction du motif. Ainsi, chercher `50%` recherche bien `50%` plutôt que de renvoyer toutes les lignes. Si vous souhaitez utiliser des caractères génériques (wildcards), l'opérateur de filtre `like` accepte un motif (`.where("title", "like", "post-%")`) ; ce n'est pas le cas de `.search()`.

Une recherche d'un seul mot se compile exactement dans le même SQL qu'auparavant.

## Activer l'option

Déclarez un bloc `search` sur une collection Postgres, en indiquant les champs que vous souhaitez indexer :

```typescript
import type { PostgresCollectionConfig } from "@rebasepro/types";

const talents: PostgresCollectionConfig = {
    slug: "talents",
    table: "talents",
    name: "Candidates",
    properties: {
        id: { name: "ID", type: "string", isId: "uuid" },
        full_name: { name: "Full name", type: "string" },
        bio: { name: "Bio", type: "string" },
        interests: { name: "Interests", type: "array", of: { name: "Interest", type: "string" } },
        questionnaire: { name: "Questionnaire", type: "map", properties: {} }
    },
    search: {
        language: "spanish",
        unaccent: true,
        fields: [
            { path: "full_name", weight: "A" },
            { path: "bio", weight: "D" },
            "interests",
            "questionnaire.certifications"
        ]
    }
};
```

Rien n'est déduit implicitement. Un champ n'est recherché que si et seulement si vous le nommez, et un chemin qui ne peut être résolu échoue au démarrage au lieu d'être ignoré silencieusement — un champ de recherche que vous croyez actif alors qu'il ne l'est pas est précisément l'erreur que ce bloc vise à éviter.

`.search()` se compile alors en une recherche plein texte classée par pertinence, et les lignes sont renvoyées avec un `_score` :

```typescript
const { data } = await client.data.talents
    .search("auditor iso 14001")
    .orderBy("_score", "desc")
    .find();
```

### Ce que sa déclaration génère

Une colonne `tsvector`, `GENERATED ALWAYS AS … STORED`, et un index GIN associé. Postgres recalcule la colonne à chaque écriture sur un champ source et refuse toute tentative d'écriture directe, de sorte que l'index ne peut pas diverger de la ligne. La colonne n'est jamais renvoyée par l'API.

Ils sont générés dans `drizzle/search.sql`, aux côtés de `schema.sql` et `policies.sql`, et `rebase db push` les applique pour vous — aucune commande supplémentaire n'est requise. Ils disposent de leur propre fichier car une colonne `tsvector` générée nécessite au préalable l'existence d'une fonction utilitaire `IMMUTABLE` (`unaccent` n'est que `STABLE`, et aplatir un document `jsonb` requiert une fonction renvoyant un ensemble d'enregistrements), et Atlas — le moteur derrière `db push` — ne peut pas gérer les fonctions dans son offre gratuite.

Une conséquence importante à connaître si vous déployez via des migrations plutôt que par push : l'ajout d'un bloc `search` seul ne produit aucune migration, car le schéma comparé par Atlas n'a pas changé. `rebase db generate` vous le signale le cas échéant. Le bloc est tout de même appliqué par `rebase db push` et par la vérification du schéma au démarrage (schema ensure) ; pour l'inclure explicitement dans une migration, ajoutez le contenu de `drizzle/search.sql` à celle-ci.

### Modifier le bloc ultérieurement

Une colonne générée porte son expression, et Postgres ne peut pas modifier cette expression sur place — ainsi, ajouter un champ, modifier un poids, changer la langue ou activer `unaccent` n'est **pas** une opération que `ADD COLUMN IF NOT EXISTS` peut appliquer à une colonne existante.

Rebase enregistre une empreinte (fingerprint) de l'expression sur la colonne lors de sa création et la compare à chaque démarrage et à chaque `db push`. Toute modification est explicitement refusée, en indiquant les deux instructions nécessaires pour l'appliquer — un `DROP COLUMN` et un `ADD COLUMN`, qui réécrivent la table et reconstruisent l'index GIN. Exécutez-les au moment de votre choix ; rien ne réécrira une table en production à votre place.

Deux modifications font exception. L'activation de `fuzzy` est cumulative — elle ajoute une seconde colonne — et s'applique sans cette contrainte. Définir [`mode`](#mode) modifie la requête plutôt que la colonne, cela s'applique donc simplement lors d'un déploiement.

Le démarrage est bloqué plutôt que de servir du trafic, car l'alternative est ce que cette vérification remplace : une colonne qui continuerait d'indexer l'ancien ensemble de champs, et une recherche qui ne renverrait rien pour un contenu pourtant présent dans la ligne.

## Ce que vous pouvez spécifier dans `fields`

| Chemin | Correspond à | Exemple |
|------|-------------|---------|
| Une propriété `string` | la colonne | `"full_name"` |
| Une propriété `string[]` | chaque élément | `"interests"` |
| Une propriété `map` | chaque valeur de chaîne dans le document | `"questionnaire"` |
| Un chemin au sein d'une `map` | chaque valeur de chaîne à ce niveau ou en dessous | `"questionnaire.certifications"` |

Un chemin au sein d'une map indexe les **valeurs de chaîne à n'importe quelle profondeur** en dessous — tableaux de chaînes, objets imbriqués, tableaux d'objets. Les *clés* JSON ne sont jamais indexées, seulement les valeurs, de sorte qu'un nom de champ commun à chaque ligne ne devient pas un terme qui correspondrait à toutes les lignes.

Spécifier un enum, un UUID, une colonne `json` (au lieu de `jsonb`) ou un tableau de nombres produit une erreur au démarrage expliquant la raison. Les enums en particulier constituent un vocabulaire fixe : filtrez-les avec `where`, qui est exact et tire parti d'un index.

## Options

### `language`

La configuration de recherche de texte de Postgres, qui détermine la racinisation (stemming) et les mots vides (stopwords). `"spanish"` ramène `auditores` à `auditor` et supprime `de` ; la valeur par défaut, `"simple"`, ne fait ni l'un ni l'autre.

`"simple"` est la valeur par défaut car c'est le seul choix qui ne produit jamais d'erreur — un racinisateur appliqué à la mauvaise langue déforme silencieusement les lexèmes. Définissez-le sur la langue de votre contenu pour activer la racinisation.

### `mode`

La manière dont une chaîne de recherche est mise en correspondance avec les champs indiqués.

| `mode` | Correspondances | Trouve `Muñoz` à partir de `munoz` | Trouve `sebastian` à partir de `seb` |
|---|---|---|---|
| `"fts"` (par défaut) | lexèmes entiers, via le `tsvector` et son index GIN | avec `unaccent` | non |
| `"hybrid"` | cela, `OU` une recherche de sous-chaîne sur les mêmes champs | **toujours** | **oui** |

```typescript
search: {
    language: "spanish",
    mode: "hybrid",
    fields: ["full_name", "questionnaire.certifications"]
}
```

Le comportement par défaut et le comportement sans bloc présentent des lacunes opposées, et c'est ce que ce mode comble. Mesuré sur une vraie instance Postgres avec cinq lignes (`search-mode-matrix.test.ts` dans `@rebasepro/server-postgres`) :

| requête | sans bloc (ILIKE) | `"fts"` + `unaccent` | `"hybrid"` |
|---|---|---|---|
| `munoz` | `Ana Munoz` | `Ana Munoz`, `Sebastian Muñoz` | `Ana Munoz`, `Sebastian Muñoz` |
| `seb` | les deux Sebastian | — | les deux Sebastian |
| `audit` | la ligne `Lead Auditor` | — | la ligne `Lead Auditor` |
| `iso 14001` | la ligne `ISO 14001` | la ligne `ISO 14001` | la ligne `ISO 14001` |

`fuzzy` permet d'obtenir les mêmes lignes, mais seulement après ajustement de son seuil de similarité : avec la valeur par défaut de 0,3, `iso 14001` renvoie également une ligne `ISO 9001`. `"hybrid"` n'a aucun seuil à ajuster — une sous-chaîne est présente ou ne l'est pas.

**Son coût.** La partie recherche de sous-chaîne ne peut pas utiliser l'index GIN ; un `%` initial ne le peut jamais. La partie `@@` s'exécute toujours en premier et utilise l'index, ce que le mode ajoute est donc un scan sur les lignes rejetées par l'index. Sur une grande table, c'est la différence entre un parcours d'index et un parcours séquentiel, ce qui explique pourquoi il s'agit d'un mode optionnel et non du comportement par défaut.

**Le modifier sur une collection en production est sans risque** — c'est la seule option de ce bloc dans ce cas. `mode` agit côté requête : il ne modifie aucune colonne générée, aucune expression de génération et aucun index, et ne déclenche donc pas le refus décrit dans [Modifier le bloc ultérieurement](#changing-the-block-later). Son activation ne nécessite qu'un simple déploiement.

Il supprime les accents sur la partie sous-chaîne, **que `unaccent` soit défini ou non**, car cette suppression s'effectue également côté requête. C'est délibéré : `unaccent` est l'option que vous ne pouvez pas activer plus tard sans réécrire la table ; ainsi, une collection qui n'en dispose pas peut quand même cesser d'ignorer `Muñoz`. Ce que `unaccent` apporte de plus, c'est la suppression des accents sur la partie `@@`, où sont stockés les lexèmes.

Il ajoute l'extension `unaccent` et une fonction utilitaire `IMMUTABLE` à la base de données si elles ne sont pas déjà présentes. Les deux instructions utilisent `IF NOT EXISTS` / `CREATE OR REPLACE`, et aucune ne touche aux tables.

### `unaccent`

Supprime les accents avant l'indexation, de sorte que `auditoria` corresponde à `auditoría`.

Ce n'est pas anecdotique dans une langue accentuée. Postgres racinise les deux orthographes en **lexèmes différents** — `to_tsvector('spanish', 'auditoría')` produit `auditor` tandis que `'auditoria'` produit `auditori` — ainsi, sans cela, une requête saisie sans accent ignore toutes les lignes qui en comportent, ce qui représente la majorité des requêtes des utilisateurs.

Nécessite l'extension `unaccent`.

### `fuzzy`

Effectue également une correspondance sur la similarité des trigrammes, pour que les approximations soient quand même classées : `iso14000` trouvera `ISO 14001`, ce qu'aucune racinisation ne permettrait de faire car il s'agit simplement de lexèmes différents.

```typescript
search: {
    fields: ["full_name", "questionnaire.certifications"],
    fuzzy: true,
    fuzzyThreshold: 0.3   // default
}
```

Ajoute une seconde colonne générée et un index trigramme, et nécessite `pg_trgm`. Cela coûte du temps d'écriture et de l'espace disque, mais résout la cause la plus courante d'échec de recherche.

### `weight`

Chaque champ porte l'une des quatre classes de poids de Postgres, de `A` (la plus forte) à `D`. `ts_rank` attribue à une correspondance de classe `A` un score bien supérieur à une classe `D`, permettant ainsi à un nom d'avoir plus de poids qu'une simple mention dans une longue description. Les champs ont par défaut le poids `B`.

### `column`

La colonne générée est nommée `search_vector`. Ne la modifiez que si ce nom entre en conflit avec une colonne existante — elle fait partie intégrante de votre schéma une fois créée, et la renommer plus tard nécessite une suppression et une recréation, ce qui réécrit la table.

## Classement

`_score` correspond au `ts_rank` calculé avec la même requête que celle ayant servi à trouver les lignes, et n'est présent que si la collection a activé l'option *et* que la requête contenait une chaîne de recherche.

Avec `mode: "hybrid"`, une ligne trouvée uniquement par la partie sous-chaîne obtient un score constant faible (0.001) plutôt que zéro — en dessous du plus petit `ts_rank` qu'une correspondance exacte de lexème peut produire. Ainsi, une correspondance sur un mot entier surpasse toujours une correspondance partielle, et les lignes issues uniquement d'une correspondance par sous-chaîne se départagent selon les critères secondaires de la requête au lieu d'être renvoyées dans un ordre aléatoire.

Lorsque `fuzzy` est activé, la similarité de trigrammes est **ajoutée** à ce rang. Ce n'est pas un simple affinement — c'est ce qui permet à `fuzzy` de proposer un classement. Une faute de frappe ne correspond à rien sur le chemin exact, donc chaque ligne trouvée a un `ts_rank` valant exactement zéro ; trier uniquement par rang renverrait la meilleure correspondance dans n'importe quel ordre. Les deux termes sont additionnés plutôt que pondérés, de sorte qu'une ligne correspondant exactement cumule les deux et surpasse une ligne simplement similaire sans avoir besoin d'un coefficient explicite. En dehors de ces deux conditions, `orderBy: "_score"` est un champ inconnu et renvoie une erreur 400 au lieu de renvoyer silencieusement des lignes non triées.

`_score` ne peut pas être combiné avec la pagination par curseur (`startAfter`). La pertinence est calculée par requête et non stockée ; il n'y a donc aucune valeur sur la ligne curseur permettant de la comparer à la page suivante, et deux requêtes avec des chaînes de recherche différentes produisent des scores qui ne sont pas sur la même échelle. Utilisez `limit`/`offset` pour les pages ordonnées par pertinence.

## Pourquoi cette ligne correspond-elle ?

Une liste classée indique *quelles* lignes correspondent, mais jamais *pourquoi* une ligne est présente. Demandez à chaque ligne de s'expliquer :

```typescript
const { data } = await client.data.talents
    .search("iso 14001", { explain: true })
    .orderBy("_score", "desc")
    .find();

data[0]._matches;
// [{ field: "questionnaire.certifications",
//    snippet: "<mark>ISO</mark> <mark>14001</mark> Lead Auditor" }]
```

`field` est le chemin exactement tel que déclaré dans `fields`, ce qui vous permet de le mapper à un libellé pour l'affichage. Les champs sont renvoyés dans l'ordre où vous les avez déclarés.

Par requête, et non par collection, car le coût est par requête : un `ts_headline` par champ déclaré pour chaque ligne renvoyée, et `ts_headline` réanalyse le document plutôt que de lire l'index. Adapté pour une page de résultats, inadapté pour un export.

**L'extrait (snippet) contient du balisage par construction** — chaque correspondance est entourée de balises `<mark>`. Affichez-le sous forme de HTML ou supprimez les balises, mais ne le traitez pas comme du texte brut, et ne faites pas confiance au texte environnant : il s'agit de ce que l'utilisateur a saisi. Découper selon `<mark>` et afficher les morceaux est plus sûr que d'utiliser `dangerouslySetInnerHTML`.

Avec le `mode: "hybrid"`, un champ qui ne correspond que par sous-chaîne est également signalé — c'est le champ qui a déclenché le résultat. Son extrait est renvoyé sans aucune mise en valeur : `ts_headline` met en évidence les lexèmes, or une moitié de mot n'en est pas un.

Lorsque `unaccent` est activé, les extraits sont présentés sans accents — `Auditoria`, et non `Auditoría`. `ts_headline` sur le texte original ne peut pas trouver une correspondance produite par une requête sans accent, et renverrait donc le texte sans aucune mise en valeur ; un extrait lisible avec surbrillance vaut mieux qu'un extrait plus élégant qui n'en surligne aucune silencieusement.

## Ajouter le bloc à une collection en production

La colonne générée est ajoutée lors de la vérification du schéma au démarrage (schema ensure), comme n'importe quelle autre colonne, et son index est créé avec `CREATE INDEX CONCURRENTLY` afin de ne pas bloquer les écritures. L'ajout d'une colonne générée *stockée* (stored) réécrit la table ; sur une table volumineuse, planifiez cela comme toute autre réécriture.

## Moteurs pris en charge

Le bloc `search` est réservé à Postgres et est rejeté au démarrage sur les autres moteurs plutôt qu'ignoré silencieusement. Les collections MongoDB conservent leur correspondance basée sur les regex ; les collections Firestore utilisent le contrôleur externe de recherche textuelle.

## Voir aussi

- [REST API](/docs/backend/api/) — les paramètres de requête sous lesquels une recherche parvient au serveur
- [Indexes](/docs/backend/indexes/) — ce que le bloc search crée, et ce qu'il coûte
- [Querying Data](/docs/sdk/querying/) — effectuer des recherches depuis le SDK client
