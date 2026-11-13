---
sourceHash: e086faac3624de8d
title: Index
sidebar_label: Index
description: Déclarez des index Postgres ordinaires sur une table — btree, GIN et BRIN, partiels, composites, couvrants et uniques — et découvrez pourquoi un index écrit à la main avait tendance à disparaître.
---

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Une table déclare les index dont ses requêtes ont besoin, aux côtés des colonnes qu'ils couvrent :

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const posts = defineTable("posts", {
    columns: {
        id:          col.uuid().primaryKey().defaultRandom(),
        title:       col.text().notNull(),
        status:      col.enum(["draft", "published"]).notNull().default("draft"),
        publishDate: col.timestamp({ withTimezone: true }),
    },
    indexes: [
        {
            columns: ["status", { column: "publishDate", direction: "desc" }],
            reason: "admin list: filter by status, newest first",
        },
    ],
    rls: "admin-only",
});
```

## Pourquoi cela existe

Le générateur DDL a toujours émis des instructions d'index pour exactement deux éléments, et tous deux sont des structures appartenant à une *fonctionnalité* plutôt qu'à des requêtes que vous avez écrites : l'index GIN derrière un [bloc `search`](/docs/backend/search), et l'index ANN derrière une [colonne `col.vector()`](/docs/sdk/aggregates-and-search#the-index). Le cas classique — le btree derrière une clause `where` — ne disposait d'aucun emplacement de déclaration.

La seule façon d'en avoir un était donc de l'écrire à la main. Et :

:::caution[Si vous avez des index écrits à la main sur une table gérée par Rebase]
`rebase db push` est déclaratif. Un index sur une table gérée qui était absent de `schema.sql` était considéré comme une dérive (drift), et Atlas planifiait un `DROP INDEX` pour celui-ci — ce qui ne figure pas dans la liste des instructions destructives, de sorte que l'application auto-approuvée l'exécutait sans demander confirmation. Chaque index écrit à la main sur une table gérée était en sursis.

Cela est corrigé par la règle de propriété ci-dessous : un index que Rebase n'a pas créé est désormais exclu du diff par son nom et n'est jamais modifié. Déclarer vos index écrits à la main reste le meilleur état final — un index déclaré est créé sur une base de données vierge et sur chaque tenant, alors qu'un index écrit à la main ne l'est pas — mais rien ne les supprime entre-temps.
:::

## La structure

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

| Champ | Type | Description |
|-------|------|-------------|
| `columns` | `(string \| { column, direction?, nulls? })[]` | **Requis.** Les colonnes clés, dans l'ordre. 1 à 5 entrées. |
| `reason` | `string` | Pourquoi cet index existe, en une ligne. Fortement recommandé. |
| `using` | `"btree" \| "gin" \| "brin"` | Méthode d'accès. Vaut `btree` par défaut. |
| `where` | `IndexPredicate` | Rend l'index partiel — il ne couvre que les lignes correspondant à ceci. |
| `unique` | `boolean` | btree uniquement. Une garantie d'unicité composite. |
| `include` | `string[]` | btree uniquement. Colonnes de charge utile (payload) incluses pour les index-only scans. |

### `columns` prend des clés de colonne, jamais des noms SQL

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Le nom d'une relation `belongsTo` représente sa colonne de clé étrangère ; ainsi, la relation `author` correspond à la colonne `author_id` :

```ts
indexes: [
    // `author` is the relation; its key is the column author_id.
    { columns: ["author"], reason: "an author's posts, and the ON DELETE cascade" },
]
```

Écrire `author_id` ici est refusé : il s'agit d'un nom de colonne SQL, pas d'une clé de la table, et `columns` désigne des clés. Postgres n'indexe pas de colonne de clé étrangère à votre place — sans cet index, la commande « lister les publications de cet auteur » et la cascade `ON DELETE` entraînent toutes deux des scans séquentiels.

Une relation `hasMany` ou many-to-many n'a pas de colonne sur cette table et est refusée : déclarez l'index sur la table propriétaire de la clé étrangère.

### L'ordre compte, et seul un sous-ensemble initial est utilisable

Postgres peut utiliser un sous-ensemble initial des colonnes clés : `["ownerId", "createdAt"]` dessert donc une requête filtrant sur `ownerId`, ainsi qu'une requête filtrant sur les deux, mais **jamais** une requête filtrant sur `createdAt` seul.

`direction` et `nulls` ne sont pertinents que lorsque le `ORDER BY` d'une requête mélange les directions. Un index `DESC` isolé est redondant avec son homologue `ASC` — Postgres parcourt un btree en sens inverse tout aussi rapidement — ainsi, un seul index dessert le filtre *et* le tri dans l'exemple situé en haut de cette page.

```ts
indexes: [{ columns: [{ column: "createdAt", direction: "desc", nulls: "last" }], reason: "…" }]
```

Écrire explicitement la valeur par défaut de Postgres ne coûte rien : le nom dérivé hache l'ordre *effectif*, donc ajouter `direction: "asc"` à une colonne qui était déjà ascendante n'est pas une redéfinition et ne reconstruit rien.

La limite est fixée à cinq clés. Postgres en autorise trente-deux ; au-delà de quatre, les colonnes suivantes constituent un poids mort à chaque écriture, et la déclaration traduit généralement l'espoir d'accélérer une requête par accumulation. Les colonnes de charge utile qui ne sont pas interrogées doivent être placées dans `include`, qui ne compte pas dans cette limite.

### `where` est structuré, pas en SQL

```ts
indexes: [{
    columns: ["publishDate"],
    where: { column: "status", op: "=", value: "published" },
    reason: "public feed: published posts by date",
}]
```

L'index ne conserve alors que les lignes publiées et reste compact à mesure que les brouillons s'accumulent.

Les opérateurs disponibles sont `=`, `!=`, `<`, `<=`, `>`, `>=`, `in`, `is null` et `is not null`, combinés avec `and` :

```ts
indexes: [{
    columns: ["assignee"],
    where: {
        and: [
            { column: "status", op: "in", value: ["open", "in_progress"] },
            { column: "archivedAt", op: "is null" },
        ],
    },
    reason: "the open-work queue, which is a fraction of the table",
}]
```

Il n'y a délibérément aucun opérateur `or`. Un prédicat OR signifie presque toujours que l'index ne devrait pas être partiel du tout ; si vous en avez réellement besoin, déclarez deux index.

Un prédicat est une structure plutôt qu'une chaîne de caractères car une chaîne ne pourrait pas être vérifiée par rapport aux colonnes de la table, ne pourrait pas être empreinte (fingerprinted) sans injecter son propre texte dans le nom de l'index — ainsi, la reformater renommerait un index en production — et constituerait le seul endroit où un appelant solliciterait une classe d'opérateurs d'extension que le planificateur ne peut pas rejouer.

### `unique` est réservé aux composites uniquement

L'unicité sur une seule colonne s'exprime par `.unique()` sur la colonne, et la déclarer ici également est refusé au lieu d'être accepté comme un synonyme. `.unique()` se compile en un `UNIQUE` inline dont l'index sous-jacent est nommé par Postgres — et non par Rebase — sous la forme `<table>_<column>_key`.

```ts
indexes: [{ columns: ["workspaceId", "slug"], unique: true, reason: "one slug per workspace" }]
```

### `include` permet un index-only scan

Les colonnes de charge utile résident dans les pages feuilles : elles ne sont pas interrogeables, ne sont pas ordonnées, et elles évitent une lecture de tas (heap fetch) au détriment d'un index plus lourd. Elles ne doivent pas chevaucher `columns`.

```ts
indexes: [{ columns: ["status"], include: ["title"], reason: "the status sidebar counts, without touching the heap" }]
```

### `using`

`btree` (par défaut) répond aux critères d'égalité, d'intervalle, de `ORDER BY` et d'unicité.

`gin` sert pour l'inclusion sur une colonne de tableau ou une colonne `jsonb`. `brin` est destiné à une colonne naturellement ordonnée sur une table en ajout seul (append-only) — minuscule, et inutile dès lors que les lignes commencent à arriver dans le désordre. Ni l'un ni l'autre ne possèdent d'ordre, donc `direction` et `nulls` sont impossibles à représenter sur eux plutôt que d'être refusés plus tard par Postgres.

Il n'y a ni `gist` ni `hash` : chaque classe d'opérateurs gist intéressante est fournie dans une extension, et les index hash ne peuvent être ni uniques, ni composites, ni ordonnés. Cette restriction permet de maintenir l'ensemble du modèle sur la voie d'Atlas — `rebase db push` matérialise l'état souhaité dans une base de données temporaire vierge sur laquelle planifier, et `CREATE EXTENSION` ne peut pas figurer dans ce fichier. **La recherche par trigrammes correspond à [`search:`](/docs/backend/search) ; l'ANN correspond à une [colonne `col.vector()`](/docs/sdk/aggregates-and-search#the-index).** Un index nécessitant `gin_trgm_ops` ou `vector_cosine_ops` est refusé au moment du build plutôt qu'émis pour échouer plus tard face à une base de données que vous n'avez jamais vue.

### `reason`

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

C'est le seul champ qui n'a aucun équivalent SQL derrière lui, et il est facultatif — mais renseignez-le.

Un index est la seule chose qu'un schéma peut déclarer qui coûte de l'argent indéfiniment et dont le bénéfice est invisible depuis la configuration. La raison (`reason`) est ce qui s'affiche à côté de « 0 scans en 34 jours, 412 Mo », ce qui constitue l'unique moment où quiconque est en mesure de décider de le supprimer ou non. Sans cela, personne ne peut décider, donc personne ne le fait, et la table accumule des index pendant toute la durée de vie du produit.

Elle ne fait délibérément **pas** partie de l'identité de l'index — reformuler une justification ne reconstruit jamais un index.

## Comment une déclaration est nommée

`<table>_<columns>_ix_<7 hex>`, ou `_ux_` lorsqu'il est unique. Par exemple `posts_status_publish_date_ix_a91c3f4`.

Le hash est calculé sur la *sémantique* de l'index — méthode, colonnes, ordre, unicité, colonnes incluses, prédicat — et non sur son SQL généré, de sorte qu'une modification de la façon dont Rebase formate le DDL ne renomme jamais rien dans votre base de données.

Le hash joue un rôle déterminant. `CREATE INDEX IF NOT EXISTS` effectue la correspondance sur le **nom**, et non sur la définition : avec un nom lisible, modifier une déclaration conserverait l'ancien index et signalerait un succès indéfiniment. Avec le hash dans le nom, une redéfinition constitue un objet différent, de sorte qu'il est créé et que l'ancien est supprimé.

Deux conséquences méritent d'être soulignées :

- **Modifier une déclaration équivaut à un DROP et un CREATE**, émis de manière brute — sans `CONCURRENTLY`, et avec une période intermédiaire sans index. Cela convient parfaitement sur une base de données de développement ; sur une grande table en production, appliquez-le au moment de votre choix.
- Le nom est [un nom dérivé figé](/docs/architecture/schema-as-code). Il est consigné dans `contracts/derived-names.txt` et ne peut pas changer d'une version à l'autre.

## À qui appartient un index

`_ix_`/`_ux_` suivi de sept caractères hexadécimaux est inaccessible à tous les autres mécanismes de nommage ici — `_fkey`, `_gin`, `_trgm`, `_pkey`, `_key`, les distances vectorielles, le préfixe `idx_` de l'authentification. Le nom seul détermine donc la propriété :

| L'index | Dans le plan ? | Nommé par Rebase ? | Ce qui se passe |
|---|---|---|---|
| déclaré | oui | oui | créé, puis conservé |
| déclaration supprimée | non | oui | **supprimé**, comme prévu |
| écrit à la main, ou issu de l'introspection | non | non | **exclu — jamais touché** |

Aucun des cas ne requiert d'invite de confirmation. Supprimer une déclaration *doit* retirer l'index silencieusement ; ce qui ne doit jamais être supprimé, c'est un index que Rebase n'a pas créé. C'est également ce qui fiabilise l'aller-retour d'introspection : les index existants d'une base de données vers laquelle vous avez pointé Rebase sont considérés comme étrangers jusqu'à ce que quelqu'un les déclare.

### Déclarer un index que vous possédez déjà

Lorsque vous déclarez un index que la base de données possède déjà sous un autre nom, Rebase prend en charge cet index au lieu d'en construire une deuxième copie. Avant de construire un index déclaré manquant, `rebase db push`, `rebase db migrate` et le démarrage (boot) recherchent un index existant sur la même table qui lui correspond en tout point. Une correspondance est renommée vers le nom déclaré avec `ALTER INDEX … RENAME TO …`, ce qui modifie le catalogue et ne reconstruit rien. Dès lors, il s'agit de l'index déclaré : retrouvé par son nom, conservé, et supprimé si la déclaration est retirée.

Ces éléments doivent tous correspondre :

- la méthode d'accès ;
- l'unicité ;
- les colonnes clés, dans l'ordre, chacune avec sa direction et son positionnement `NULLS` (la direction ne compte que pour `btree`) ;
- les colonnes `INCLUDE` ;
- le prédicat. Les guillemets, transtypages littéraux et parenthèses de Postgres sont ignorés ; toute autre différence empêche la correspondance.

Rebase laisse un index existant intact et construit l'index déclaré à côté dès lors que cet index diffère sur l'un de ces éléments. Il le laisse également intact lorsqu'une clé est une expression, qu'une clé utilise une classe d'opérateurs ou un collationnement non par défaut, que l'index sous-tend une contrainte, que l'index est `INVALID`, ou qu'il porte déjà un nom Rebase.

`rebase db generate` écrit chaque index déclaré dans la migration sous la forme `CREATE INDEX IF NOT EXISTS`, de sorte que l'instruction réussit lorsque `rebase db migrate` vient de renommer un index existant vers ce nom.

## Quand sont-ils créés

Les deux producteurs les émettent, ce qui importe car tous les déploiements n'exécutent pas `db push` :

- **`rebase db push` / `rebase db generate`** les placent dans `schema.sql`, sur le chemin habituel d'Atlas — ils bénéficient ainsi des migrations, de la détection de dérive et du retour arrière (rollback) comme n'importe quel autre objet.
- **`rebase schema generate`** les écrit également dans `schema.generated.ts`, afin que le schéma Drizzle décrive la même table que celle présente dans la base de données. Les colonnes `INCLUDE` d'un index couvrant sont la seule exception : Drizzle ne peut pas les exprimer, et la ligne générée comporte un commentaire le signalant et pointant vers `schema.sql`, qui les prend en charge.
- **L'assurance du schéma au démarrage (Boot-time schema ensure)** les crée également, selon les mêmes modalités que les index de recherche et ANN adjacents. Un tenant en environnement managé provisionne au démarrage et n'exécute jamais `db push` ; sans cela, il démarrerait sans aucun de ses index déclarés et rien ne l'indiquerait. Une table créée par le démarrage reçoit ses index en même temps que la table. Sur une table déjà existante, le démarrage construit un index manquant une fois que le serveur est prêt à traiter les requêtes, en arrière-plan, de la même manière qu'il construit les [index de clé étrangère](#impact-de-la-mise-à-niveau-sur-une-base-de-données-existante). Il utilise `CREATE INDEX CONCURRENTLY` sur sa propre connexion, afin que le `statement_timeout` de 30 s du pool ne puisse pas annuler une construction prolongée. Un index qu'une construction interrompue a laissé `INVALID` sous son nom est supprimé et reconstruit. `IF NOT EXISTS` effectuant la correspondance sur le nom, il ne répare jamais un index défaillant. Un index `unique` est construit de la même façon mais avant que le serveur ne commence à traiter les requêtes, et le démarrage échoue s'il ne peut pas être construit. Servir du trafic sans lui risquerait de laisser entrer des lignes dupliquées.

## Les clés étrangères sont indexées pour vous

Postgres crée l'index vers lequel *pointe* une clé étrangère — la clé primaire de la cible — et jamais sur la colonne qui la *détient*. Chaque lecture depuis l'autre côté d'une liaison filtre sur cette colonne : une inclusion `hasMany` ou `hasOne`, une liste imbriquée telle que `/authors/5/posts` (sa page et son décompte), le côté inverse d'un `manyToMany`, et la vérification `ON DELETE` lorsqu'une ligne parente est supprimée. Sans index, chacune de ces opérations lit l'intégralité des lignes de la table enfant.

Rebase dérive donc un btree standard pour :

- la `localKey` de chaque [`belongsTo`](/docs/collections/relations/#belongsto--the-key-is-on-this-table) — qui est également la colonne que lit le `hasOne` / `hasMany` du côté opposé ;
- la colonne cible de chaque table de jonction `manyToMany`. La clé primaire de la jonction `(source, target)` sert déjà les recherches par la colonne source ; le côté inverse de la liaison a besoin de celle-ci. Une jonction étant une table de Rebase, celle-ci ne permet aucune option de désactivation.

Mesuré sur Postgres 18 avec un cache chaud, 1M de commentaires sur 50k publications :

| La lecture | Sans l'index | Avec l'index |
|---|---|---|
| `include=comments` sur une page de 25 publications (`post_id IN (…)`) | 38 ms | 0.3 ms |
| `GET /posts/77/comments?limit=25` — la page | 28 ms | 0.3 ms |
| …et son `count(*)` | 29 ms | 0.2 ms |
| suppression d'une publication (vérification `ON DELETE SET NULL`) | 129 ms | 1.7 ms |

Rien n'est indexé deux fois. L'index dérivé est ignoré lorsque la colonne figure déjà en tête de la clé primaire, porte un `UNIQUE` (`.unique()` sur une colonne liée, ou `unique: true` sur la relation), ou se trouve en tête d'un index dans `indexes:` — simple ou composite, tant qu'il s'agit d'un btree sans `where`. Un index partiel ne peut pas servir une recherche qui doit atteindre chaque ligne, et un index GIN ou BRIN répond à une question différente ; aucun des deux ne compte donc ici.

Le nom est celui que dérive [une déclaration](#comment-une-déclaration-est-nommée) d'un index simple sur cette colonne — `posts_author_id_ix_00ad191` — ainsi l'index dérivé et `indexes: [{ columns: ["author"], … }]` constituent un seul objet, pas deux. Il s'agit d'un [nom dérivé figé](/docs/architecture/schema-as-code) comme les autres.

Pour conserver la contrainte et supprimer l'index — par exemple sur une table tellement orientée écriture que l'index coûte plus cher que les lectures qu'il dessert, ou bien une table sur laquelle vous conservez votre propre index en dehors de `indexes:` — précisez-le sur la relation :

```ts
relations: {
    author: rel.belongsTo(() => authors, { index: false }),
}
```

`index` n'existe que sur `belongsTo` : sur les autres types, la clé étrangère est une colonne sur la cible (définissez `index` sur le `belongsTo` de la cible) ou dans une jonction.

Rebase lit uniquement vos tables pour prendre cette décision, jamais la base de données : `db push` et le démarrage doivent aboutir au même ensemble d'index avec les mêmes noms, sinon le push suivant supprimerait ce que le démarrage a construit. Un index que vous avez écrit à la main sur la même colonne, en dehors de `indexes:`, n'est donc pas vu — déclarez-le dans `indexes:`, ou définissez `index: false`, afin de conserver un seul index plutôt que deux.

### Impact de la mise à niveau sur une base de données existante

Les index sont de nouveaux objets sur des tables qui contiennent déjà des données, et les deux voies les construisent différemment :

- **Le démarrage ne les attend pas.** Sur une table existante, l'assurance de schéma exclut du démarrage les index de clé étrangère manquants et les construit une fois que le serveur est prêt à traiter les requêtes, un par un, avec `CREATE INDEX CONCURRENTLY` sur sa propre connexion (le `statement_timeout` de 30 s du pool ne s'applique pas à celle-ci). Cela ne prend aucun verrou qui ferait patienter les lectures ou les écritures. Une table détenue par une autre session — le build d'une autre instance, un `ALTER TABLE` — est abandonnée dans la limite du budget de verrouillage du démarrage et réessayée au démarrage suivant. Un index qu'un build interrompu a laissé `INVALID` (un déploiement qui a remplacé le processus en cours de build, deux instances en concurrence sur le même nom) est supprimé puis reconstruit. Chacun est consigné dans les logs au début et à la fin de l'opération ; un échec génère un avertissement, jamais un échec de démarrage. Une table créée par ce démarrage reçoit ses index en même temps que la table, avant que quoi que ce soit ne puisse y écrire. Sous `REBASE_PROVISION_ONLY`, les builds s'exécutent avant l'arrêt du processus, puisque rien après lui ne les exécuterait.
- **`rebase db push` les construit avant de planifier**, avec le même constructeur et selon les mêmes modalités que le démarrage : `CREATE INDEX CONCURRENTLY`, un à la fois, afin que les lectures et écritures se poursuivent pendant son exécution (environ 0,4 s pour 1M de lignes et 6 s pour 10M pour un build standard sur un SSD d'ordinateur portable, `maintenance_work_mem` à 64 Mo ; une version concurrente prend plus de temps et ne bloque rien). Atlas constate ensuite que chaque index est en place et ne planifie rien pour lui. Un index qu'il n'a pas pu construire au préalable — une table retenue par une autre session pendant toute la durée du budget de verrouillage — est confié à Atlas, qui le construit dans la transaction du push et bloque ainsi les écritures sur cette table pendant le build ; le push précise de laquelle il s'agit. Une colonne de clé étrangère que le push lui-même ajoute reçoit son index via Atlas en même temps que la colonne, avant qu'aucune donnée n'y soit présente. `--dry-run` ne construit rien : il liste les index qu'un push réel construirait en premier, et le plan qu'il affiche les mentionne, puisqu'ils n'existent pas encore.

## Ce qui est refusé, et quand

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Tous ces cas sont refusés lors de la compilation du schéma, avec indication de la table et de la position dans le tableau — un index qui n'existerait silencieusement pas est l'anomalie que toute cette fonctionnalité supprime :

- une clé qui n'est ni une colonne ni une relation `belongsTo` de la table, ou une relation dont la clé étrangère réside sur l'autre table
- plus de cinq clés dans `columns`, ou la même colonne deux fois
- exactement les colonnes de la clé primaire — `<table>_pkey` les indexe déjà
- une colonne présente à la fois dans `columns` et dans `include`
- `unique` sur une colonne unique qui déclare déjà `.unique()`
- `direction` ou `nulls` sous `gin` ou `brin`
- une liste `in` qui répète une valeur
- deux déclarations qui dérivent le même nom — il s'agit du même index, deux fois
- une `reason` vide

## Voir aussi

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

- [Recherche](/docs/backend/search) — recherche en texte intégral avec classement, qui construit son propre index GIN sur un `tsvector` généré
- [Recherche vectorielle](/docs/sdk/aggregates-and-search#vector-search) — l'index ANN sur une colonne d'embeddings, configuré sur `col.vector()`
- [Schema as code](/docs/architecture/schema-as-code) — comment les déclarations parviennent à la base de données, et ce qu'est un nom dérivé
- [Tables](/docs/schema/) — chaque clé de `defineTable`
