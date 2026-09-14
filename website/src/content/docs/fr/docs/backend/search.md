---
sourceHash: 04421ade309db1ce
title: Recherche
sidebar_label: Recherche
description: Comment .search() se comporte par défaut, et comment activer la recherche en texte intégral classée sur une collection Postgres sur les champs de votre choix — y compris le contenu JSONB et les tableaux.
---

`.search("term")` fonctionne sur chaque collection sans configuration. Ce en quoi il se compile dépend du fait que la collection ait demandé ou non des fonctionnalités supplémentaires.

## Le comportement par défaut

Sans aucune configuration, `.search()` est une **correspondance de sous-chaîne insensible à la casse**, combinée avec des OR sur les propriétés `string` de premier niveau de la collection :

```sql
WHERE name ILIKE '%term%' OR description ILIKE '%term%'
```

Cela suffit pour une petite collection dont le texte se trouve dans des colonnes ordinaires. Cela comporte trois limites qu'aucun réglage interne ne peut corriger :

- **Il ne peut pas inspecter l'intérieur des propriétés `map` ou `array`.** Une collection qui stocke son contenu interrogeable dans du JSONB — tags, certifications, questionnaire — possède une barre de recherche qui, silencieusement, ne trouvera rien.
- **Il n'y a aucune notion de pertinence.** Les lignes sont renvoyées selon l'ordre `orderBy`, de sorte que la meilleure correspondance peut se trouver en page sept.
- **Il ne peut pas utiliser d'index.** Un `%` en début de chaîne empêche l'utilisation d'un B-tree, ce qui fait de chaque recherche un parcours séquentiel (sequential scan). Parfait à mille lignes ; catastrophique à un million.

Le terme fait l'objet d'une correspondance **littérale** : `%` et `_` sont des métacaractères LIKE, et ils sont échappés avant la construction du motif, ainsi la recherche de `50%` cherche réellement `50%` au lieu de renvoyer toutes les lignes. Si vous souhaitez des caractères génériques (wildcards), l'opérateur de filtre `like` accepte un motif (`.where("title", "like", "post-%")`) ; `.search()` ne le fait pas.

Le comportement par défaut ne change pas, et une collection qui n'a pas activé cette option compile exactement le même SQL qu'auparavant.

## Activer la fonctionnalité

Déclarez un bloc `search` sur une collection Postgres, en spécifiant les champs que vous souhaitez indexer :

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

Rien n'est déduit implicitement. Un champ est recherché si et seulement si vous le nommez, et un chemin qui ne peut pas être résolu provoque une erreur au démarrage plutôt que d'être discrètement ignoré — un champ de recherche que vous croyez actif alors qu'il ne l'est pas est exactement le problème que ce bloc vise à éviter.

`.search()` se compile alors en une correspondance full-text classée, et les lignes retournées contiennent un `_score` :

```typescript
const { data } = await client.data.talents
    .search("auditor iso 14001")
    .orderBy("_score", "desc")
    .find();
```

### Ce que cette déclaration crée

Une colonne `tsvector`, `GENERATED ALWAYS AS … STORED`, ainsi qu'un index GIN sur celle-ci. Postgres recalcule la colonne à chaque écriture d'un champ source et refuse toute tentative d'écriture directe, de sorte que l'index ne peut pas diverger de la ligne. La colonne n'est jamais renvoyée par l'API.

Ils sont générés dans `drizzle/search.sql`, aux côtés de `schema.sql` et `policies.sql`, et `rebase db push` les applique pour vous — rien d'autre à exécuter. Ils disposent de leur propre fichier car une colonne `tsvector` générée nécessite au préalable l'existence d'une fonction d'aide `IMMUTABLE` (`unaccent` n'étant que `STABLE`, et l'aplatissement d'un document `jsonb` nécessitant une fonction renvoyant un ensemble), et Atlas — le moteur derrière `db push` — ne peut pas gérer les fonctions dans son offre gratuite.

Une conséquence à connaître si vous déployez par migration plutôt que par push : l'ajout d'un bloc `search` seul ne produit aucune migration, car le schéma comparé par Atlas n'a pas changé. `rebase db generate` vous en avertit lorsque cela se produit. Le bloc est toujours appliqué par `rebase db push` et par la vérification du schéma au démarrage ; pour l'inclure explicitement dans une migration, ajoutez `drizzle/search.sql` à celle-ci.

### Modifier le bloc ultérieurement

Une colonne générée porte son expression, et Postgres ne peut pas modifier cette expression sur place — ainsi, ajouter un champ, modifier un poids, changer la langue ou activer `unaccent` n'est **pas** quelque chose que `ADD COLUMN IF NOT EXISTS` peut appliquer à une colonne existante.

Rebase enregistre une empreinte numérique (fingerprint) de l'expression sur la colonne lors de sa création, et la compare à chaque démarrage et à chaque `db push`. Toute modification est refusée explicitement, accompagnée des deux instructions nécessaires à son application — un `DROP COLUMN` et un `ADD COLUMN`, qui réécrivent la table et reconstruisent l'index GIN. Exécutez-les au moment de votre choix ; rien ne réécrit une table en production à votre insu. (L'activation de `fuzzy` est additive — une deuxième colonne — et s'applique sans tout cela.)

Le démarrage refuse de servir l'application plutôt que d'ignorer le problème, car l'alternative est précisément ce que cette vérification remplace : une colonne qui continue d'indexer l'ancien ensemble de champs, et une recherche qui ne renvoie rien pour un contenu pourtant présent dans la ligne.

## Ce que vous pouvez indiquer dans `fields`

| Chemin | Résout vers | Exemple |
|------|-------------|---------|
| Une propriété `string` | la colonne | `"full_name"` |
| Une propriété `string[]` | chaque élément | `"interests"` |
| Une propriété `map` | chaque valeur chaîne du document | `"questionnaire"` |
| Un chemin à l'intérieur d'un `map` | chaque valeur chaîne à cet endroit ou en dessous | `"questionnaire.certifications"` |

Un chemin menant dans un map indexe les **valeurs de type chaîne à n'importe quelle profondeur** sous ce chemin — tableaux de chaînes, objets imbriqués, tableaux d'objets. Les *clés* JSON ne sont jamais indexées, seules les valeurs le sont, de sorte qu'un nom de champ commun à chaque ligne ne devient pas un terme correspondant à toutes les lignes.

Indiquer un enum, un UUID, une colonne `json` (plutôt que `jsonb`), ou un tableau de nombres produit une erreur au démarrage expliquant la raison. Les enums en particulier constituent un vocabulaire fixe : filtrez-les avec `where`, qui est exact et utilise un index.

## Options

### `language`

La configuration de recherche textuelle de Postgres, qui régit la racinisation (stemming) et les mots vides (stopwords). `"spanish"` ramène `auditores` à sa racine `auditor` et supprime `de` ; la valeur par défaut, `"simple"`, ne fait ni l'un ni l'autre.

`"simple"` est la valeur par défaut car c'est le seul choix qui n'est jamais incorrect — un outil de racinisation appliqué à la mauvaise langue déforme silencieusement les lexèmes. Définissez-le sur la langue de votre contenu pour activer la racinisation.

### `unaccent`

Supprime les accents avant l'indexation, de sorte que `auditoria` corresponde à `auditoría`.

Ce n'est pas un détail cosmétique dans une langue accentuée. Postgres racinise les deux orthographes en **lexèmes différents** — `to_tsvector('spanish', 'auditoría')` produit `auditor` tandis que `'auditoria'` produit `auditori` — ainsi, sans cela, une requête saisie sans accents manquera chaque ligne qui en comporte, ce qui correspond à la majorité des requêtes saisies par les utilisateurs.

Nécessite l'extension `unaccent`.

### `fuzzy`

Fait également correspondre selon la similarité des trigrammes, afin que les correspondances approximatives soient tout de même classées : `iso14000` pouvant trouver `ISO 14001`, ce qu'aucun algorithme de racinisation ne fera car il s'agit simplement de lexèmes différents.

```typescript
search: {
    fields: ["full_name", "questionnaire.certifications"],
    fuzzy: true,
    fuzzyThreshold: 0.3   // default
}
```

Ajoute une seconde colonne générée et un index trigramme, et nécessite `pg_trgm`. Cela coûte du temps d'écriture et de l'espace disque, mais résout la classe d'échecs de recherche la plus fréquente.

### `weight`

Chaque champ porte l'une des quatre classes de poids de Postgres, de `A` (la plus forte) à `D`. `ts_rank` attribue à une correspondance `A` un score bien supérieur à une correspondance `D`, ce qui permet à un nom de prévaloir sur une simple mention dans une longue description. Les champs prennent la valeur par défaut `B`.

### `column`

La colonne générée est nommée `search_vector`. Ne la modifiez que si ce nom entre en conflit avec une colonne existante — elle fait partie intégrante de votre schéma une fois créée, et la renommer ultérieurement nécessite une suppression et une recréation, ce qui réécrit la table.

## Classement

`_score` est le `ts_rank` calculé sur la même requête que celle utilisée pour faire correspondre les lignes, et n'est présent que si la collection a activé la recherche *et* que la requête contenait une chaîne de recherche.

Lorsque `fuzzy` est activé, la similarité trigramme est **ajoutée** à ce rang. Il ne s'agit pas d'un simple ajustement — c'est ce qui permet à `fuzzy` de constituer un véritable classement. Une faute de frappe ne correspond à rien sur le chemin exact, de sorte que chaque ligne trouvée a un `ts_rank` exactement égal à zéro ; ordonner uniquement par rang renverrait la meilleure correspondance dans n'importe quel ordre arbitraire de la table. Les deux termes sont additionnés plutôt que pondérés, ainsi une ligne qui correspond exactement cumule les deux scores et surpasse une ligne simplement similaire, sans avoir besoin d'un coefficient pour l'indiquer. En dehors de ces deux conditions, `orderBy: "_score"` est un champ inconnu et renvoie une erreur 400 au lieu de renvoyer silencieusement des lignes non triées.

`_score` ne peut pas être combiné avec la pagination par curseur (`startAfter`). La pertinence est calculée par requête plutôt que stockée, il n'y a donc aucune valeur sur la ligne du curseur à laquelle comparer la page suivante, et deux requêtes avec des chaînes de recherche différentes produisent des scores qui ne sont pas sur la même échelle. Utilisez `limit`/`offset` pour les pages ordonnées par pertinence.

## Pourquoi cette ligne a-t-elle correspondu ?

Une liste classée vous indique *quelles* lignes correspondent, mais jamais *pourquoi* une ligne est présente. Demandez à chaque ligne de s'expliquer :

```typescript
const { data } = await client.data.talents
    .search("iso 14001", { explain: true })
    .orderBy("_score", "desc")
    .find();

data[0]._matches;
// [{ field: "questionnaire.certifications",
//    snippet: "<mark>ISO</mark> <mark>14001</mark> Lead Auditor" }]
```

`field` est le chemin exactement tel que déclaré dans `fields`, ce qui vous permet de le faire correspondre à un libellé pour l'affichage. Les champs sont renvoyés dans l'ordre où vous les avez déclarés.

Cela s'applique par requête et non par collection, car le coût est par requête : un `ts_headline` par champ déclaré pour chaque ligne renvoyée, et `ts_headline` réanalyse le document plutôt que de lire l'index. Idéal pour une page de résultats, inadapté pour un export.

**L'extrait (snippet) contient du balisage par conception** — chaque occurrence est enveloppée dans `<mark>`. Affichez-le en tant que HTML ou supprimez les balises, mais ne le traitez pas comme du texte brut, et ne faites pas confiance au texte environnant : il s'agit de ce que l'utilisateur a saisi. Découper la chaîne selon `<mark>` et en afficher les parties est plus sûr que d'utiliser `dangerouslySetInnerHTML`.

Lorsque `unaccent` est activé, les extraits apparaissent sans les accents — `Auditoria`, et non `Auditoría`. Un `ts_headline` sur le texte d'origine ne peut pas trouver une correspondance produite par une requête sans accent, ce qui renverrait le texte sans aucune mise en surbrillance ; un extrait lisible qui surligne les correspondances vaut mieux qu'un extrait plus élégant qui, silencieusement, ne surligne rien.

## Ajouter le bloc à une collection en production

La colonne générée est ajoutée par la vérification du schéma au démarrage, comme toute autre colonne, et son index est construit avec `CREATE INDEX CONCURRENTLY` afin que les écritures ne soient pas bloquées. L'ajout d'une colonne générée *stockée* (stored) réécrit la table ; sur une table volumineuse, planifiez donc cette opération comme n'importe quelle autre réécriture.

## Moteurs compatibles

Le bloc `search` est réservé à Postgres et est rejeté au démarrage sur les autres moteurs plutôt que d'être ignoré silencieusement. Les collections MongoDB conservent leur correspondance basée sur les regex ; les collections Firestore utilisent le contrôleur de recherche de texte externe.

## Voir aussi

- [API REST](/docs/backend/api/) — les paramètres de requête sous lesquels une recherche parvient au serveur
- [Index](/docs/backend/indexes/) — ce que le bloc search crée, et ce qu'il coûte
- [Interroger les données](/docs/sdk/querying/) — effectuer des recherches depuis le SDK client
