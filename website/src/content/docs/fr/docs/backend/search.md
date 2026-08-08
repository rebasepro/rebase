---
title: Recherche
sidebar_label: Recherche
description: Comment se comporte .search() par défaut, et comment configurer une collection Postgres pour utiliser la recherche plein texte classée sur les champs que vous nommez — y compris le contenu JSONB et tableau.
---

`.search("term")` fonctionne sur chaque collection sans configuration. Ce en quoi il
se compile dépend de si la collection a demandé quelque chose de plus.

## Le comportement par défaut

Sans configuration, `.search()` est une **correspondance de sous-chaîne insensible à la casse**,
combinée avec un OU (OR) sur les propriétés `string` de premier niveau de la collection :

```sql
WHERE name ILIKE '%term%' OR description ILIKE '%term%'
```

Cela suffit pour une petite collection dont le texte se trouve dans des colonnes simples. Cela
présente trois limites qu'aucun paramètre interne ne peut résoudre :

- **Il ne peut pas voir à l'intérieur des propriétés `map` ou `array`.** Une collection qui
  conserve son contenu recherchable dans du JSONB — tags, certifications, un questionnaire — a
  une zone de recherche qui ne renvoie silencieusement rien.
- **Il n'a aucune pertinence.** Les lignes sont renvoyées dans l'ordre du `orderBy`, la meilleure
  correspondance peut donc se trouver à la page sept.
- **Il ne peut pas utiliser d'index.** Un `%` au début empêche l'utilisation d'un B-tree, donc
  chaque recherche est un balayage séquentiel (sequential scan). C'est acceptable à mille lignes ;
  désastreux à un million.

Le comportement par défaut ne change pas, et une collection qui ne l'a pas activé se
compile exactement vers le même SQL qu'auparavant.

## Activer la recherche avancée

Déclarez un bloc `search` sur une collection Postgres, en nommant les champs que vous souhaitez indexer :

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

Rien n'est déduit. Un champ est recherché si et seulement si vous le nommez, et un chemin
qui ne peut pas être résolu échoue au démarrage au lieu d'être ignoré silencieusement — un champ de
recherche que vous pensez actif mais qui ne l'est pas est exactement le genre de défaillance que ce bloc
vise à éviter.

`.search()` se compile alors en une recherche plein texte classée, et les lignes sont renvoyées
avec un `_score` :

```typescript
const { data } = await client.data.talents
    .search("auditor iso 14001")
    .orderBy("_score", "desc")
    .find();
```

### Ce que sa déclaration crée

Une colonne `tsvector`, `GENERATED ALWAYS AS … STORED`, et un index GIN sur celle-ci.
Postgres recalcule la colonne à chaque écriture d'un champ source et refuse toute
tentative d'écriture directe, afin que l'index ne s'écarte jamais de la ligne. La colonne
n'est jamais renvoyée par l'API.

Ils sont générés dans `drizzle/search.sql`, à côté de `schema.sql` et
`policies.sql`, et `rebase db push` les applique pour vous — rien d'autre à exécuter.
Ils bénéficient de leur propre fichier car une colonne `tsvector` générée a besoin d'une
fonction auxiliaire `IMMUTABLE` pour exister (`unaccent` est seulement `STABLE`, et
l'aplatissement d'un document `jsonb` nécessite une fonction renvoyant un ensemble), et Atlas — le
moteur derrière `db push` — ne peut pas gérer les fonctions dans son offre gratuite.

Une conséquence à connaître si vous déployez par migration plutôt que par push :
l'ajout d'un bloc `search` seul ne produit aucune migration, car le schéma
comparé par Atlas n'a pas changé. `rebase db generate` l'indique lorsque cela se produit.
Le bloc est toujours appliqué par `rebase db push` et par la vérification du schéma
au démarrage ; pour l'inclure explicitement dans une migration, ajoutez `drizzle/search.sql` à l'une d'entre elles.

## Ce que vous pouvez nommer dans `fields`

| Chemin | Résolu en | Exemple |
|--------|-----------|---------|
| Une propriété `string` | la colonne | `"full_name"` |
| Une propriété `string[]` | chaque élément | `"interests"` |
| Une propriété `map` | chaque valeur de chaîne dans le document | `"questionnaire"` |
| Un chemin à l'intérieur d'un `map` | chaque valeur de chaîne à ou sous ce niveau | `"questionnaire.certifications"` |

Un chemin vers une carte (map) indexe les **valeurs de chaîne à n'importe quelle profondeur** en
dessous de celui-ci — tableaux de chaînes, objets imbriqués, tableaux d'objets. Les *clés* JSON ne
sont jamais indexées, seules les valeurs le sont, ainsi un nom de champ commun à chaque ligne ne devient pas un terme qui correspond à chaque ligne.

Nommer un enum, un UUID, une colonne `json` (plutôt que `jsonb`), ou un tableau de nombres produit
une erreur au démarrage expliquant pourquoi. Les enums en particulier constituent un vocabulaire
fixe : filtrez-les avec `where`, ce qui est exact et utilise un index.

## Options

### `language`

La configuration de recherche de texte Postgres, qui détermine la racinisation (stemming) et les mots vides (stopwords).
`"spanish"` racinise `auditores` en `auditor` et supprime `de` ; la valeur par défaut,
`"simple"`, ne fait ni l'un ni l'autre.

`"simple"` est l'option par défaut car c'est le seul choix qui n'est jamais erroné — un
racinisateur (stemmer) appliqué à la mauvaise langue déforme silencieusement les lexèmes.
Définissez-le sur la langue de votre contenu pour bénéficier de la racinisation.

### `unaccent`

Supprime/rabat les accents avant l'indexation, ainsi `auditoria` correspond à `auditoría`.

Ce n'est pas cosmétique dans une langue accentuée. Postgres racinise les deux orthographes
en **lexèmes différents** — `to_tsvector('spanish', 'auditoría')` produit
`auditor` tandis que `'auditoria'` produit `auditori` — donc sans cela, une requête saisie
sans accent manque toutes les lignes qui en comportent, ce qui correspond à la plupart des
requêtes saisies par la plupart des utilisateurs.

Nécessite l'extension `unaccent`.

### `fuzzy`

Effectue également une correspondance sur la similitude des trigrammes, afin que les correspondances approximatives soient tout de même classées : `iso14000` atteignant
`ISO 14001`, ce qu'aucune racinisation ne permettra de faire car il s'agit simplement de lexèmes différents.

```typescript
search: {
    fields: ["full_name", "questionnaire.certifications"],
    fuzzy: true,
    fuzzyThreshold: 0.3   // default
}
```

Ajoute une seconde colonne générée et un index trigramme, et nécessite `pg_trgm`.
Cela coûte du temps d'écriture et de l'espace disque ; mais résout la classe la plus courante d'échecs de recherche.

### `weight`

Chaque champ porte l'une des quatre classes de poids de Postgres, de `A` (la plus forte)
à `D`. `ts_rank` évalue une correspondance `A` bien au-dessus d'une correspondance `D`, c'est ainsi
qu'un nom l'emporte sur une simple mention dans une longue description. Les champs prennent la valeur `B` par défaut.

### `column`

La colonne générée est nommée `search_vector`. Ne la modifiez que si elle entre en collision
avec une colonne existante — elle fait partie de votre schéma une fois créée, et
la renommer plus tard nécessite une suppression et une recréation, ce qui réécrit la table.

## Classement

`_score` est `ts_rank` exécuté par rapport à la même requête que celle avec laquelle les lignes ont été mises en correspondance, et n'est
présent que si la collection a activé la recherche *et* que la requête contenait une chaîne de recherche.

Lorsque `fuzzy` est activé, la similitude des trigrammes est **ajoutée** à ce rang. Ce n'est pas un
affinement — c'est ce qui fait que `fuzzy` offre un classement. Une faute de frappe ne correspond à rien
sur le chemin exact, de sorte que chaque ligne trouvée a un `ts_rank` d'exactement zéro ; ordonner par rang seul renverrait la meilleure correspondance dans n'importe quel ordre arbitraire de la table.
Les deux termes sont additionnés plutôt que pondérés, de sorte qu'une ligne correspondant exactement contribue
aux deux et l'emporte sur une ligne simplement similaire sans avoir besoin d'un coefficient
pour l'indiquer. En dehors de ces deux conditions, `orderBy: "_score"` est un champ inconnu et
renvoie une erreur 400 au lieu de renvoyer silencieusement des lignes non triées.

`_score` ne peut pas être combiné avec la pagination par curseur (`startAfter`). La pertinence est
calculée par requête plutôt que stockée, il n'y a donc pas de valeur sur la ligne du curseur à
laquelle comparer la page suivante, et deux requêtes avec des chaînes de recherche différentes produisent
des scores qui ne sont pas sur la même échelle. Utilisez `limit`/`offset` pour les pages ordonnées par pertinence.

## Pourquoi cette ligne a-t-elle correspondu ?

Une liste classée vous indique *quelles* lignes, jamais *pourquoi* une ligne est présente. Demandez à chaque ligne de
s'expliquer :

```typescript
const { data } = await client.data.talents
    .search("iso 14001", { explain: true })
    .orderBy("_score", "desc")
    .find();

data[0]._matches;
// [{ field: "questionnaire.certifications",
//    snippet: "<mark>ISO</mark> <mark>14001</mark> Lead Auditor" }]
```

`field` est le chemin exact tel qu'il a été déclaré dans `fields`, ce qui vous permet de l'associer à
une étiquette pour l'affichage. Les champs sont renvoyés dans l'ordre dans lequel vous les avez déclarés.

Cela s'applique par requête, pas par collection, car le coût est par requête : un `ts_headline`
par champ déclaré et par ligne renvoyée, et `ts_headline` re-analyse le document au lieu de
lire l'index. C'est adapté pour une page de résultats, mais pas pour une exportation.

**Le extrait (snippet) contient du balisage par construction** — chaque correspondance est entourée de
`<mark>`. Affichez-le sous forme d'HTML ou nettoyez les balises, mais ne le traitez pas comme du texte
brut, et ne faites pas confiance au texte environnant : il s'agit de ce que l'utilisateur a saisi.
Découper sur `<mark>` et afficher les parties est plus sûr que d'utiliser `dangerouslySetInnerHTML`.

Lorsque `unaccent` est activé, les extraits s'affichent avec les accents retirés — `Auditoria`, et non
`Auditoría`. `ts_headline` sur le texte original ne peut pas trouver une correspondance produite par
une requête sans accent, et renverrait donc le texte sans rien surligner du tout ; un extrait lisible
qui surligne est préférable à un extrait plus joli qui ne surligne rien sans rien dire.

## Ajouter le bloc à une collection en production

La colonne générée est ajoutée par la vérification du schéma au démarrage (boot-time schema ensure), comme
n'importe quelle autre colonne, et son index est construit avec `CREATE INDEX CONCURRENTLY`
pour ne pas bloquer les écritures. L'ajout d'une colonne générée *stockée* (stored) réécrit la table ; sur une grande table, planifiez cela comme n'importe quelle autre réécriture.

## Moteurs pris en charge

Le bloc `search` est réservé à Postgres, et est rejeté au démarrage sur les autres moteurs
plutôt d'être ignoré en silence. Les collections MongoDB conservent leur correspondance basée
sur les expressions régulières ; les collections Firestore utilisent le contrôleur de recherche de texte externe.

---
