---
sourceHash: a6c102be4bcc017e
title: Recherche
sidebar_label: Recherche
description: Comment .search() se comporte par défaut, et comment activer la recherche en texte intégral classée par pertinence sur les champs de votre choix pour une collection Postgres — y compris le contenu JSONB et les tableaux.
---

`.search("term")` fonctionne sur chaque collection sans configuration. Ce en quoi il
se compile dépend de si la collection a demandé des options supplémentaires.

## Le comportement par défaut

Sans configuration, `.search()` effectue une **recherche de sous-chaîne insensible à la casse**,
combinée par un opérateur OU (OR) sur les propriétés `string` de premier niveau de la collection. La chaîne de recherche
est découpée sur les espaces et chaque terme doit correspondre — mais ils peuvent correspondre
à des propriétés différentes, de sorte qu'un nom stocké dans deux colonnes distinctes est quand même trouvé :

```sql
-- .search("ada lovelace")
WHERE (first_name ILIKE '%ada%'      OR last_name ILIKE '%ada%')
  AND (first_name ILIKE '%lovelace%' OR last_name ILIKE '%lovelace%')
```

Entourez une séquence de guillemets doubles — `.search('"ada lovelace"')` — pour rechercher
l'expression exacte à la place, de la même manière que le chemin en recherche plein texte ci-dessous les interprète.

Cela suffit pour une petite collection dont le texte se trouve dans des colonnes simples. Cela présente
trois limites qu'aucun paramètre interne ne peut résoudre :

- **Il ne peut pas inspecter l'intérieur des propriétés `map` ou `array`.** Une collection qui conserve
  son contenu interrogeable dans du JSONB — tags, certifications, un questionnaire — a
  une barre de recherche qui, silencieusement, ne trouve rien.
- **Il n'y a pas de pertinence.** Les lignes sont renvoyées selon l'ordre défini par `orderBy`, de sorte que le meilleur résultat
  peut se retrouver à la page sept.
- **Il ne peut pas utiliser d'index.** Un `%` en début de chaîne empêche l'utilisation d'un arbre B (B-tree), chaque recherche est donc
  un parcours séquentiel (sequential scan). Parfait à mille lignes ; catastrophique à un million.

Le terme est recherché **littéralement** : `%` et `_` sont des métacaractères LIKE, et ils
sont échappés avant la construction du motif, donc chercher `50%` recherche `50%` plutôt
que de renvoyer chaque ligne. Si vous souhaitez des caractères génériques, l'opérateur de filtre
`like` accepte un motif (`.where("title", "like", "post-%")`) ; `.search()` ne le permet pas.

Une recherche d'un seul mot se compile exactement dans le même SQL qu'auparavant.

## Activer la recherche avancée

Déclarez un bloc `search` sur une collection Postgres, en nommant les champs que vous souhaitez
indexer :

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

Rien n'est déduit implicitement. Un champ n'est recherché que si et seulement si vous le nommez, et un chemin
qui ne se résout pas échoue au démarrage plutôt que d'être ignoré silencieusement — un champ de
recherche que vous croyez actif alors qu'il ne l'est pas est exactement l'erreur que ce bloc vise
à empêcher.

`.search()` se compile alors en une recherche plein texte avec classement par pertinence, et les lignes sont renvoyées avec un
`_score` :

```typescript
const { data } = await client.data.talents
    .search("auditor iso 14001")
    .orderBy("_score", "desc")
    .find();
```

### Ce que sa déclaration crée

Une colonne `tsvector`, `GENERATED ALWAYS AS … STORED`, et un index GIN sur celle-ci.
Postgres recalcule la colonne à chaque écriture d'un champ source et refuse toute
tentative de l'écrire directement, de sorte que l'index ne peut pas diverger de la ligne. La colonne
n'est jamais renvoyée par l'API.

Ils sont générés dans `drizzle/search.sql`, aux côtés de `schema.sql` et
`policies.sql`, et `rebase db push` les applique pour vous — rien de plus à
exécuter. Ils bénéficient de leur propre fichier car une colonne générée `tsvector` nécessite l'existence
préalable d'une fonction d'aide `IMMUTABLE` (`unaccent` n'est que `STABLE`, et
l'aplatissement d'un document `jsonb` nécessite une fonction qui renvoie un ensemble d'enregistrements), et Atlas — le
moteur derrière `db push` — ne peut pas gérer les fonctions sur son offre gratuite.

Une conséquence utile à savoir si vous déployez par migration plutôt que par push :
ajouter un bloc `search` seul ne produit aucune migration, car le schéma
comparé par Atlas n'a pas changé. `rebase db generate` vous en avertit le cas échéant.
Le bloc est tout de même appliqué par `rebase db push` et par la vérification du schéma
au démarrage ; pour l'inclure explicitement dans une migration, ajoutez le contenu de `drizzle/search.sql` à celle-ci.

### Modifier le bloc ultérieurement

Une colonne générée contient son expression, et Postgres ne peut pas modifier cette
expression sur place — ainsi, ajouter un champ, modifier un poids, changer la langue
ou activer `unaccent` n'est **pas** quelque chose que `ADD COLUMN IF NOT EXISTS` peut
appliquer à une colonne existante.

Rebase enregistre une empreinte (fingerprint) de l'expression sur la colonne lors de sa création,
et la compare à chaque démarrage et à chaque `db push`. Une modification est refusée explicitement,
avec les deux instructions permettant de l'appliquer — un `DROP COLUMN` et un `ADD COLUMN`,
qui réécrivent la table et reconstruisent l'index GIN. Exécutez-les au moment de
votre choix ; rien ne réécrit une table en production à votre insu. (L'activation de `fuzzy` est
additive — une seconde colonne — et s'applique sans rien de tout cela.)

Le démarrage refuse de se lancer plutôt que de servir du trafic, car l'alternative correspond à ce que cette
vérification est venue remplacer : une colonne qui continue d'indexer l'ancien ensemble de champs, et une recherche qui
ne renvoie rien pour un contenu pourtant présent dans la ligne.

## Ce que vous pouvez nommer dans `fields`

| Chemin | Résolu en | Exemple |
|------|-------------|---------|
| Une propriété `string` | la colonne | `"full_name"` |
| Une propriété `string[]` | chaque élément | `"interests"` |
| Une propriété `map` | chaque valeur de type chaîne dans le document | `"questionnaire"` |
| Un chemin à l'intérieur d'une `map` | chaque valeur de type chaîne à ce niveau ou en dessous | `"questionnaire.certifications"` |

Un chemin pointant vers une map indexe les **valeurs textuelles à n'importe quelle profondeur**
en dessous — tableaux de chaînes, objets imbriqués, tableaux d'objets. Les *clés* JSON ne sont jamais indexées, uniquement
les valeurs, de sorte qu'un nom de champ commun à chaque ligne ne devient pas un terme qui correspond à
chaque ligne.

Nommer un enum, un UUID, une colonne `json` (plutôt que `jsonb`) ou un tableau de
nombres produit une erreur au démarrage expliquant pourquoi. Les enums en particulier constituent un
vocabulaire fixe : filtrez-les avec `where`, qui est exact et utilise un index.

## Options

### `language`

La configuration de recherche textuelle de Postgres, qui détermine la racinisation (stemming) et les mots vides (stopwords).
`"spanish"` ramène `auditores` à sa racine `auditor` et supprime `de` ; la valeur par défaut,
`"simple"`, ne fait ni l'un ni l'autre.

`"simple"` est la valeur par défaut car c'est le seul choix qui n'est jamais incorrect — un
racinisateur appliqué à la mauvaise langue altère silencieusement les lexèmes. Définissez-le sur la
langue de votre contenu pour bénéficier du stemming.

### `unaccent`

Supprime les accents avant l'indexation, de sorte qu'`auditoria` corresponde à `auditoría`.

Ce n'est pas un détail cosmétique dans une langue accentuée. Postgres ramène les deux orthographes
à des **lexèmes différents** — `to_tsvector('spanish', 'auditoría')` produit
`auditor` tandis qu'`'auditoria'` produit `auditori` — ainsi, sans cette option, une requête saisie
sans accent passe à côté de chaque ligne qui en comporte, ce qui correspond à la majorité des requêtes
saisies par les utilisateurs.

Nécessite l'extension `unaccent`.

### `fuzzy`

Permet également la recherche par similarité de trigrammes, afin que les approximations soient quand même classées : `iso14000` trouvant
`ISO 14001`, ce qu'aucun niveau de racinisation ne permettra car il s'agit simplement
de lexèmes différents.

```typescript
search: {
    fields: ["full_name", "questionnaire.certifications"],
    fuzzy: true,
    fuzzyThreshold: 0.3   // default
}
```

Ajoute une seconde colonne générée ainsi qu'un index trigramme, et nécessite `pg_trgm`.
Augmente le temps d'écriture et l'espace disque ; résout la cause la plus fréquente d'échec de recherche.

### `weight`

Chaque champ se voit attribuer l'une des quatre classes de poids de Postgres, de `A` (la plus forte)
à `D`. `ts_rank` attribue à une correspondance de classe `A` un score bien supérieur à celui d'une classe `D`, permettant ainsi à un
nom d'avoir la priorité sur une mention secondaire au sein d'une longue description. Les champs prennent la valeur par défaut `B`.

### `column`

La colonne générée est nommée `search_vector`. Ne la modifiez que si cela entre en conflit
avec une colonne que vous possédez déjà — elle fera partie de votre schéma une fois créée, et
la renommer plus tard nécessite une suppression et une recréation, ce qui réécrit la table.

## Classement (Ranking)

`_score` correspond à `ts_rank` évalué par rapport à la même requête que celle avec laquelle les lignes ont été mises en correspondance, et n'est
présent que lorsque la collection a activé l'option *et* que la requête contenait une
chaîne de recherche.

Lorsque `fuzzy` est activé, la similarité trigramme est **ajoutée** à ce rang. Il ne s'agit pas d'un simple
ajustement — c'est ce qui fait de `fuzzy` un véritable classement. Une faute de frappe ne correspond à rien dans le
chemin exact, donc chaque ligne trouvée a un `ts_rank` valant exactement zéro ; trier
uniquement par rang renverrait le meilleur résultat dans un ordre arbitraire dicté par la table.
Les deux termes sont additionnés plutôt que pondérés, de sorte qu'une ligne correspondant exactement
contribue aux deux scores et surclasse une ligne simplement similaire sans nécessiter de coefficient
particulier. En dehors de ces deux conditions, `orderBy: "_score"` est un champ inconnu et
renvoie une erreur 400 plutôt que de renvoyer silencieusement des lignes non triées.

`_score` ne peut pas être combiné avec la pagination par curseur (`startAfter`). La pertinence est
calculée par requête plutôt que stockée, il n'y a donc aucune valeur sur la ligne du curseur à
comparer avec la page suivante, et deux requêtes avec des chaînes de recherche différentes
génèrent des scores qui ne sont pas sur la même échelle. Utilisez `limit`/`offset` pour
les pages ordonnées par pertinence.

## Pourquoi cette ligne a-t-elle correspondu ?

Une liste classée vous indique *quelles* lignes correspondent, jamais *pourquoi* une ligne s'y trouve. Demandez à chaque ligne
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

`field` correspond au chemin exactement tel qu'il a été déclaré dans `fields`, ce qui vous permet de le mapper à
un libellé pour l'affichage. Les champs sont renvoyés dans l'ordre où vous les avez déclarés.

Ce traitement s'applique par requête et non par collection, car le coût est engagé par requête : un `ts_headline`
par champ déclaré pour chaque ligne retournée, et `ts_headline` réanalyse le document
au lieu de lire l'index. Adapté pour une page de résultats, inadapté pour un export.

**L'extrait (snippet) contient du balisage par conception** — chaque terme trouvé est entouré de
`<mark>`. Affichez-le en tant que HTML ou supprimez les balises, mais ne le traitez pas comme du texte
brut, et ne faites pas confiance au texte environnant : il s'agit de ce que l'utilisateur a saisi.
Découper la chaîne selon `<mark>` et en afficher les parties est plus sûr que
d'utiliser `dangerouslySetInnerHTML`.

Lorsque `unaccent` est activé, les extraits sont générés sans accents — `Auditoria`, non
`Auditoría`. `ts_headline` appliqué au texte original ne peut pas trouver de correspondance issue d'une
requête désaccentuée, et renverrait donc le texte sans aucune mise en surbrillance ;
un extrait lisible qui surligne les correspondances vaut mieux qu'un extrait plus élégant qui, silencieusement,
ne surligne rien.

## Ajouter le bloc à une collection existante

La colonne générée est ajoutée par la vérification du schéma au démarrage, comme n'importe quelle autre
colonne, et son index est créé avec `CREATE INDEX CONCURRENTLY` afin que les écritures ne soient
pas bloquées. L'ajout d'une colonne générée *stockée* (stored) réécrit la table ; sur une
table volumineuse, planifiez cette opération comme n'importe quelle autre réécriture.

## Quels moteurs de base de données

Le bloc `search` est exclusif à Postgres et est rejeté au démarrage sur d'autres moteurs
au lieu d'être ignoré silencieusement. Les collections MongoDB conservent leur correspondance
basée sur des expressions régulières ; les collections Firestore utilisent le contrôleur de recherche de texte externe.

## Voir aussi

- [REST API](/docs/backend/api/) — les paramètres de requête sous lesquels une recherche parvient au serveur
- [Index](/docs/backend/indexes/) — ce que le bloc search crée, et ce que cela coûte
- [Interroger les données](/docs/sdk/querying/) — effectuer des recherches depuis le SDK client

---
