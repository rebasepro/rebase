---
sourceHash: d74cc2ea4835551d
title: Index
sidebar_label: Index
description: Déclarez des index Postgres ordinaires sur une collection — btree, GIN et BRIN, partiels, composites, couvrants et uniques — et comprenez pourquoi un index écrit à la main disparaissait auparavant.
---

Une collection déclare les index dont ses requêtes ont besoin, dans le même fichier que les propriétés qu'ils couvrent :

```typescript
import type { PostgresCollectionConfig } from "@rebasepro/types";

const posts: PostgresCollectionConfig = {
    slug: "posts",
    table: "posts",
    name: "Blog posts",
    properties: {
        id: { name: "ID", type: "string", isId: "uuid" },
        title: { name: "Title", type: "string" },
        status: { name: "Status", type: "string", enum: { draft: "Draft", published: "Published" } },
        publish_date: { name: "Publish date", type: "date" }
    },
    indexes: [
        {
            on: ["status", { prop: "publish_date", direction: "desc" }],
            reason: "admin list: filter by status, newest first"
        }
    ]
};
```

Postgres uniquement. Sur un autre moteur, la clé est refusée au démarrage plutôt qu'ignorée silencieusement.

## Pourquoi cela existe

Le générateur DDL a toujours émis des instructions d'index pour exactement deux choses, et toutes deux sont des structures appartenant à une *fonctionnalité* plutôt qu'à des requêtes que vous avez écrites : l'index GIN derrière un [bloc `search`](/docs/backend/search), et l'index ANN derrière une [propriété `vector`](/docs/sdk/aggregates-and-search#the-index). Le cas classique — le btree derrière une clause `where` — ne disposait d'aucun emplacement de déclaration.

La seule façon d'en avoir un était donc de l'écrire à la main. Et :

:::caution[Si vous avez des index écrits à la main sur une table gérée par Rebase]
`rebase db push` est déclaratif. Un index sur une table gérée qui était absent de `schema.sql` était considéré comme une dérive (drift), et Atlas planifiait un `DROP INDEX` pour celui-ci — ce qui ne figure pas dans la liste des instructions destructives, de sorte que l'application auto-approuvée l'exécutait sans demander confirmation. Chaque index écrit à la main sur une table gérée vivait en sursis.

Cela est corrigé par la règle d'appartenance ci-dessous : un index que Rebase n'a pas créé est désormais exclu du diff par son nom et n'est jamais touché. Déclarer vos index écrits à la main reste la meilleure solution à terme — un index déclaré est créé sur une base de données neuve et sur chaque tenant, alors qu'un index écrit à la main ne l'est pas — mais rien ne les supprime entre-temps.
:::

## La structure

| Champ | Type | Description |
|-------|------|-------------|
| `on` | `(string \| IndexKey)[]` | **Requis.** Les colonnes clés, dans l'ordre. 1 à 5 entrées. |
| `reason` | `string` | **Requis.** La raison d'être de cet index, en une ligne. |
| `using` | `"btree" \| "gin" \| "brin"` | Méthode d'accès. Vaut `btree` par défaut. |
| `where` | `IndexPredicate` | Rend l'index partiel — il ne couvre que les lignes correspondant à ceci. |
| `unique` | `boolean` | btree uniquement. Une garantie d'unicité composite. |
| `include` | `string[]` | btree uniquement. Colonnes de charge utile (payload) incluses pour les index-only scans. |

### `on` prend des clés de propriété, jamais des noms de colonnes

C'est le piège classique. Une relation `belongsTo` se compile vers sa `localKey` résolue, ainsi la propriété `author` correspond à la colonne `author_id` :

```typescript
// Correct — `author` is the relation property.
{ on: ["author"], reason: "an author's posts, and the ON DELETE cascade" }
```

Écrire `author_id` ici est refusé à la construction : c'est une colonne, et non une propriété de la collection, alors que `on` nomme des propriétés. Postgres n'indexe pas de colonne de clé étrangère à votre place — sans cet index, « lister les publications de cet auteur » et la cascade `ON DELETE` sont tous deux des scans séquentiels.

Une relation `hasMany` ou many-to-many ne possède aucune colonne sur cette table, et est rejetée en indiquant la collection qui possède effectivement la clé étrangère.

### L'ordre compte, et seul un sous-ensemble initial est utilisable

Postgres peut utiliser un sous-ensemble initial (leading subset) des colonnes clés, ainsi `["ownerId", "createdAt"]` dessert une requête filtrant sur `ownerId`, ainsi qu'une requête filtrant sur les deux, mais **jamais** une requête filtrant uniquement sur `createdAt`.

`direction` et `nulls` ne méritent leur place que lorsque le `ORDER BY` d'une requête mélange les directions. Un index `DESC` seul est redondant avec son équivalent `ASC` — Postgres parcourt un btree en sens inverse tout aussi rapidement — ainsi un seul index dessert le filtre *et* le tri dans l'exemple situé en haut de cette page.

```typescript
{ on: [{ prop: "createdAt", direction: "desc", nulls: "last" }], reason: "…" }
```

Écrire explicitement la valeur par défaut de Postgres ne coûte rien : le nom dérivé hache l'ordre *effectif*, donc ajouter `direction: "asc"` à une colonne qui était déjà ascendante n'est pas une redéfinition et ne reconstruit rien.

La limite est de cinq clés. Postgres en autorise trente-deux ; au-delà de quatre, les colonnes de fin sont un poids mort à chaque écriture, et la déclaration traduit généralement l'espoir d'accélérer une requête par accumulation. Les colonnes de charge utile qui ne sont pas recherchées ont leur place dans `include`, qui ne compte pas dans cette limite.

### `where` est structuré, pas du SQL

```typescript
{
    on: ["publish_date"],
    where: { prop: "status", op: "=", value: "published" },
    reason: "public feed: published posts by date"
}
```

L'index ne contient alors que les lignes publiées et reste petit à mesure que les brouillons s'accumulent.

Les opérateurs sont `=`, `!=`, `<`, `<=`, `>`, `>=`, `in`, `is null` et `is not null`, combinés avec `and` :

```typescript
{
    on: ["assignee"],
    where: {
        and: [
            { prop: "status", op: "in", value: ["open", "in_progress"] },
            { prop: "archived_at", op: "is null" }
        ]
    },
    reason: "the open-work queue, which is a fraction of the table"
}
```

Il n'y a volontairement pas de `or`. Un prédicat OR signifie presque toujours que l'index ne devrait pas être partiel du tout ; si vous en avez réellement besoin, déclarez deux index.

Un prédicat est une structure plutôt qu'une chaîne de caractères car une chaîne ne pourrait pas être validée par rapport aux propriétés de la collection, ne pourrait pas être empreintée sans inclure son propre texte dans le nom de l'index — ainsi, un simple reformatage renommerait un index en production — et serait le seul endroit où un appelant ferait appel à une classe d'opérateurs d'extension que le planificateur ne pourrait pas rejouer.

### `unique` est réservé aux index composites

L'unicité sur une seule colonne se définit avec `validation.unique` sur la propriété, et la déclarer ici également est refusé plutôt qu'accepté comme synonyme. `validation.unique` compile vers une contrainte `UNIQUE` en ligne dont l'index sous-jacent est nommé par Postgres — et non par Rebase — sous la forme `<table>_<column>_key`.

```typescript
{ on: ["workspaceId", "slug"], unique: true, reason: "one slug per workspace" }
```

### `include` permet un index-only scan

Les colonnes de charge utile résident dans les pages feuilles : non recherchables, non ordonnées, et elles évitent une récupération dans le heap au prix d'un index plus volumineux. Elles ne peuvent pas chevaucher les colonnes de `on`.

```typescript
{ on: ["status"], include: ["title"], reason: "the status sidebar counts, without touching the heap" }
```

### `using`

`btree` (par défaut) prend en charge l'égalité, les plages, `ORDER BY` et l'unicité.

`gin` sert à l'inclusion sur une propriété `array` ou un `map` JSONB. `brin` est destiné à une colonne naturellement ordonnée sur une table en ajout seul (append-only) — minuscule, et inutile dès lors que les lignes commencent à arriver dans le désordre. Aucun des deux n'a d'ordonnancement, ainsi `direction` et `nulls` ne sont pas représentables sur ceux-ci plutôt que d'être rejetés plus tard par Postgres.

Il n'y a ni `gist` ni `hash` : chaque classe d'opérateurs gist intéressante est fournie dans une extension, et les index hash ne peuvent pas être uniques, composites ou ordonnés. Cette restriction est ce qui maintient l'ensemble du modèle sur la voie d'Atlas — `rebase db push` matérialise l'état souhaité dans une base de données temporaire vierge pour planifier les modifications, et `CREATE EXTENSION` ne peut pas figurer dans ce fichier. **La recherche trigramme est [`search:`](/docs/backend/search) ; ANN est une [propriété `vector`](/docs/sdk/aggregates-and-search#the-index).** Un index nécessitant `gin_trgm_ops` ou `vector_cosine_ops` est refusé au moment du build plutôt qu'émis pour échouer plus tard sur une base de données que vous n'avez jamais vue.

### `reason` est obligatoire

C'est le seul champ obligatoire qui n'a pas de SQL derrière lui.

Un index est la seule chose qu'une configuration Rebase peut déclarer qui coûte de l'argent pour toujours et dont le bénéfice est invisible depuis la configuration. La raison est ce qui s'affiche à côté de « 0 scans in 34 days, 412 MB », ce qui est le seul moment où quelqu'un est en mesure de décider de le supprimer ou non. Sans cela, personne ne peut décider, donc personne ne le fait, et la table accumule des index pendant toute la durée de vie du produit.

Elle ne fait délibérément **pas** partie de l'identité de l'index — reformuler une justification ne reconstruit jamais un index.

## Comment une déclaration est nommée

`<table>_<colonnes>_ix_<7 hex>`, ou `_ux_` lorsqu'il est unique. Par exemple `posts_status_publish_date_ix_a91c3f4`.

Le hash porte sur la *sémantique* de l'index — méthode, colonnes, ordre, unicité, colonnes incluses, prédicat — et non sur son SQL généré, de sorte qu'une modification de la manière dont Rebase formate le DDL ne renomme jamais rien dans votre base de données.

Le hash a un rôle structurel fondamental. `CREATE INDEX IF NOT EXISTS` effectue la correspondance sur le **nom**, et non sur la définition : avec un nom lisible, modifier une déclaration conserverait l'ancien index et indiquerait un succès indéfiniment. Avec le hash dans le nom, une redéfinition devient un objet différent, il est donc créé et l'ancien est supprimé.

Deux conséquences méritent d'être soulignées :

- **Modifier une déclaration équivaut à un DROP et un CREATE**, émis bruts — sans `CONCURRENTLY`, et avec une période intermédiaire sans index. Cela convient très bien pour une base de données de développement ; sur une grande table en production, appliquez-le au moment de votre choix.
- Le nom est [un nom dérivé figé](/docs/architecture/schema-as-code). Il figure dans `contracts/derived-names.txt` et ne peut pas changer d'une version à l'autre.

## À qui appartient un index

`_ix_`/`_ux_` suivi de sept caractères hexadécimaux est inaccessible à tous les autres générateurs de noms ici — `_fkey`, `_gin`, `_trgm`, `_pkey`, `_key`, les distances vectorielles, le préfixe `idx_` d'authentification. Ainsi, le nom seul détermine l'appartenance :

| L'index | Dans le plan ? | Nommé par Rebase ? | Ce qui se passe |
|---|---|---|---|
| déclaré | oui | oui | créé, puis conservé |
| déclaration supprimée | non | oui | **supprimé**, comme prévu |
| écrit à la main, ou issu de l'introspection | non | non | **exclu — jamais touché** |

Aucun de ces cas ne nécessite d'invite de confirmation. La suppression d'une déclaration *doit* retirer l'index discrètement ; ce qui ne doit jamais être supprimé, c'est un index que Rebase n'a pas créé. C'est également ce qui rend l'aller-retour d'introspection sûr : les index existants d'une base de données vers laquelle vous avez pointé Rebase restent étrangers jusqu'à ce que quelqu'un les déclare.

## Quand sont-ils créés

Les deux producteurs les émettent, ce qui est important car tous les déploiements n'exécutent pas `db push` :

- **`rebase db push` / `rebase db generate`** les placent dans `schema.sql`, selon le parcours Atlas habituel — ils bénéficient ainsi des migrations, de la détection de dérive et du rollback comme n'importe quel autre objet.
- **`rebase schema generate`** les écrit également dans `schema.generated.ts`, de sorte que le schéma Drizzle décrive la même table que celle présente dans la base de données. Les colonnes `INCLUDE` d'un index couvrant constituent la seule exception : Drizzle ne peut pas les exprimer, et la ligne générée comporte un commentaire le signalant et renvoyant vers `schema.sql`, qui les gère.
- **L'assurance de schéma au démarrage (boot-time schema ensure)** les crée aussi, selon les mêmes modalités que les index de recherche et ANN à leurs côtés. Un tenant de runtime managé provisionne au démarrage et n'exécute jamais `db push` ; sans cela, il démarrerait sans aucun de ses index déclarés et rien ne le signalerait. Une table que le démarrage crée reçoit ses index avec la table. Sur une table qui existe déjà, le démarrage construit un index manquant une fois le serveur en service, en arrière-plan, comme il construit les [index de clés étrangères](#ce-que-fait-la-mise-à-niveau-sur-une-base-de-données-existante). Il utilise `CREATE INDEX CONCURRENTLY` sur une connexion à part, de sorte que le `statement_timeout` de 30 s du pool ne peut pas annuler une longue construction. Un index qu'une construction interrompue a laissé `INVALID` sous son nom est supprimé puis reconstruit. `IF NOT EXISTS` compare le nom, il ne répare donc jamais un tel index. Un index `unique` est construit de la même façon, mais avant que le serveur ne soit en service, et le démarrage échoue s'il ne peut pas être construit. Servir sans lui laisserait entrer des lignes en double.

## Les clés étrangères sont indexées pour vous

Postgres crée l'index vers lequel une clé étrangère *pointe* — la clé primaire de la cible — et jamais
un index sur la colonne qui la *porte*. Chaque lecture depuis l'autre côté d'un lien filtre sur cette
colonne : un include `hasMany` ou `hasOne`, une liste imbriquée comme `/authors/5/posts` (sa page et son
comptage), le côté inverse d'un `manyToMany`, et la vérification `ON DELETE` lorsqu'une ligne parente est
supprimée. Sans index, chacune de ces lectures parcourt toutes les lignes de la table enfant.

Rebase dérive donc un btree simple pour :

- la `localKey` de chaque [`belongsTo`](/docs/collections/relations#belongsto--the-key-is-on-this-table)
  — qui est aussi la colonne que lit le `hasOne` / `hasMany` du côté opposé ;
- la colonne cible de chaque table de jonction `manyToMany`. La clé primaire `(source, target)` de la
  jonction sert déjà les recherches par la colonne source ; le côté inverse du lien a besoin de celui-ci.
  Une jonction est une table de Rebase, celui-ci n'a donc aucune option de désactivation.

Mesuré sur Postgres 18 avec un cache chaud, 1 M de commentaires répartis sur 50 k articles :

| La lecture | Sans l'index | Avec |
|---|---|---|
| `include=comments` sur une page de 25 articles (`post_id IN (…)`) | 38 ms | 0,3 ms |
| `GET /posts/77/comments?limit=25` — la page | 28 ms | 0,3 ms |
| …et son `count(*)` | 29 ms | 0,2 ms |
| suppression d'un article (vérification `ON DELETE SET NULL`) | 129 ms | 1,7 ms |

Rien n'est indexé deux fois. L'index dérivé est omis lorsque la colonne est déjà en tête de la clé primaire,
porte un `UNIQUE` (`validation.unique` sur la relation ou sur la propriété qui possède la colonne), ou est
en tête d'un index de `indexes:` — simple ou composite, tant que c'est un btree sans `where`. Un index
partiel ne peut pas servir une recherche qui doit atteindre toutes les lignes, et un index GIN ou BRIN
répond à une autre question ; aucun des deux ne compte.

Le nom est celui que dérive [une déclaration](#comment-une-déclaration-est-nommée) d'un index simple sur
cette colonne — `posts_author_id_ix_00ad191` — si bien que l'index dérivé et
`indexes: [{ on: ["author"], … }]` forment un seul objet, et non deux. C'est un
[nom dérivé figé](/docs/architecture/schema-as-code) comme tous les autres.

Pour garder la contrainte et supprimer l'index — une table si intensive en écriture que l'index coûte
plus que les recherches qu'il sert, ou une table où vous gardez un index à vous en dehors de
`indexes:` — dites-le sur la relation :

```typescript
author: {
    name: "Author",
    type: "relation",
    relation: { kind: "belongsTo", target: () => authors, index: false }
}
```

`index` n'est accepté que sur un `belongsTo` ; sur les autres types, le validateur de configuration le
refuse, car leur clé étrangère est une colonne de la cible (définissez `index` sur le `belongsTo` de la
cible) ou d'une jonction.

Rebase ne lit que vos collections pour en décider, jamais la base de données : `db push` et le
démarrage doivent aboutir au même ensemble d'index avec les mêmes noms, faute de quoi le `push` suivant
supprimerait ce que le démarrage a construit. Un index que vous avez écrit à la main sur la même
colonne, en dehors de `indexes:`, n'est donc pas vu — déclarez-le dans `indexes:`, ou définissez
`index: false`, pour garder un seul index au lieu de deux.

### Ce que fait la mise à niveau sur une base de données existante

Les index sont de nouveaux objets sur des tables qui contiennent déjà des données, et les deux portes
les construisent différemment :

- **Le démarrage ne les attend pas.** Sur une table qui existe déjà, l'assurance de schéma laisse les
  index de clés étrangères manquants hors du démarrage et les construit une fois le serveur en
  service, un par un, avec `CREATE INDEX CONCURRENTLY` sur une connexion à part (le `statement_timeout`
  de 30 s du pool ne s'y applique pas). Cela ne prend aucun verrou que les lectures ou les écritures
  attendent. Une table qu'une autre session retient — la construction d'une autre instance, un
  `ALTER TABLE` — est abandonnée dans le budget de verrou du démarrage et retentée au démarrage suivant.
  Un index qu'une construction interrompue a laissé `INVALID` (un déploiement qui a remplacé le
  processus en pleine construction, deux instances en concurrence sur un même nom) est supprimé puis
  reconstruit. Chacun est journalisé à son début et à sa fin ; un échec est un avertissement, jamais un
  démarrage en échec. Une table que ce démarrage crée reçoit ses index avec la table, avant que quoi que
  ce soit puisse y écrire. Avec `REBASE_PROVISION_ONLY`, les constructions s'exécutent avant que le
  processus ne se termine, puisque rien après lui ne les exécuterait.
- **`rebase db push` les construit avant de planifier**, avec le même constructeur et dans les mêmes
  conditions que le démarrage : `CREATE INDEX CONCURRENTLY`, un par un, de sorte que les lectures et les
  écritures continuent pendant son exécution (environ 0,4 s pour 1 M de lignes et 6 s pour 10 M en
  construction simple sur un SSD d'ordinateur portable, `maintenance_work_mem` à 64 Mo ; une
  construction concurrente est plus longue et ne bloque rien). Atlas trouve alors chaque index déjà en
  place et ne planifie rien pour lui. Un index qu'il n'a pas pu construire d'abord — une table qu'une
  autre session a retenue pendant tout le budget de verrou — est laissé à Atlas, qui le construit
  dans la transaction du push et bloque donc les écritures sur cette table pendant la construction ;
  le push indique lesquels. Une colonne de clé étrangère que le push ajoute lui-même reçoit son index
  d'Atlas avec la colonne, avant qu'elle ne contienne quoi que ce soit. `--dry-run` ne construit rien :
  il nomme les index qu'un vrai push construirait d'abord, et le plan qu'il affiche les liste, puisqu'ils
  n'existent pas encore.

## Ce qui est refusé, et quand

Toutes ces situations lèvent une erreur au moment du build, en indiquant la collection et la position dans le tableau — un index qui n'existe silencieusement pas est précisément le problème que cette fonctionnalité élimine :

- une propriété qui ne se trouve pas sur la collection, ou une relation dont la clé étrangère réside sur l'autre table
- plus de cinq clés dans `on`, ou deux fois la même colonne
- exactement les colonnes de la clé primaire — `<table>_pkey` indexe déjà celles-ci
- une colonne présente à la fois dans `on` et dans `include`
- `unique` sur une seule colonne dont la propriété déclare déjà `validation.unique`
- `direction` ou `nulls` sous `gin` ou `brin`
- une liste `in` qui répète une valeur
- deux déclarations qui dérivent vers le même nom — il s'agit du même index, deux fois
- un champ `reason` vide ou manquant

## Voir aussi

- [Recherche](/docs/backend/search) — recherche en texte intégral avec classement, qui construit son propre index GIN sur un `tsvector` généré
- [Recherche vectorielle](/docs/sdk/aggregates-and-search#vector-search) — l'index ANN sur une colonne d'embedding, configuré sur la propriété
- [Schéma as code](/docs/architecture/schema-as-code) — comment les déclarations parviennent à la base de données, et ce qu'est un nom dérivé
