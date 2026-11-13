---
sourceHash: f385a35cc59df9c6
title: Sécurité au niveau des lignes
sidebar_label: Sécurité au niveau des lignes
description: "Chaque table déclare sa posture rls — admin-only, inherit ou une liste de règles — et Rebase la compile en politiques de sécurité au niveau des lignes Postgres. Formes de règles, conditions raccourcies, defaultRls et verrouillage par défaut."
---

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Chaque table définit qui accède à ses lignes dans sa clé `rls`. Rebase compile
cela en sécurité au niveau des lignes Postgres : `ENABLE ROW LEVEL SECURITY` sur
la table et un `CREATE POLICY` par règle et opération. Postgres filtre ensuite
chaque instruction, sur chaque route — REST, realtime, MCP, le CMS et le SQL
exécuté en tant qu'appelant — car les règles se trouvent dans la base de données,
et non dans le code applicatif.

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const posts = defineTable("posts", {
    columns: {
        id:       col.uuid().primaryKey().defaultRandom(),
        status:   col.enum(["draft", "published"]).notNull().default("draft"),
        authorId: col.uuid().notNull().onCreateUser(),
    },
    rls: [
        // Anyone reads the published posts.
        { operation: "select", access: "public", condition: { status: "published" } },
        // Authors read and edit their own, drafts included.
        { operations: ["select", "insert", "update"], ownerField: "authorId" },
        // Editors may delete.
        { operation: "delete", roles: ["editor"] },
    ],
});
```

`rls` n'a pas de valeur par défaut. L'omettre constitue une erreur de type, et
une table qui parvient au compilateur sans posture utilisable est refusée. Voir
[Ce qui se verrouille par défaut](#ce-qui-se-verrouille-par-défaut).

:::note[Vous venez des collections ?]
`rls` remplace `securityRules`, et il est obligatoire. Une règle écrite pour
`securityRules` est une entrée valide pour `rls` en l'état. Le guide de mise à
niveau pour cette version couvre `defaultSecurityRules` et
`disableDefaultPolicies`.
:::

## Les trois postures

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

| `rls` | Signification |
|---|---|
| `"admin-only"` | Sécurité au niveau des lignes activée, et uniquement les politiques de référence pour l'administrateur : le rôle `admin` et le propre code du serveur accèdent aux lignes. Tous les autres appelants n'obtiennent aucune ligne, et leurs écritures sont refusées. |
| `"inherit"` | Le `defaultRls` exporté depuis `backend/schema/index.ts`. Refusé lorsqu'il n'y en a aucun. |
| une liste de règles | Les politiques à générer, une ou plusieurs. `[]` est refusé : écrivez `"admin-only"` pour verrouiller une table aux administrateurs. |

`"admin-only"` est la posture recommandée pour démarrer une table lorsque vous
n'avez pas encore décidé qui doit y avoir accès. Rien n'est exposé tant que vous
n'écrivez pas les règles qui l'exposent.

### `defaultRls`

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

`backend/schema/index.ts` peut exporter une posture pour les tables qui
indiquent `rls: "inherit"` :

```ts
// backend/schema/index.ts
import type { DefaultRls } from "@rebasepro/server/schema";

export { posts } from "./posts";
export { comments } from "./comments";

export const defaultRls: DefaultRls = [
    { operation: "select", access: "authenticated" },
    { operations: ["insert", "update", "delete"], roles: ["editor"] },
];
```

`defaultRls` est soit `"admin-only"`, soit une liste non vide de règles. Il ne
s'applique qu'aux tables qui spécifient `"inherit"` ; une table dotée de ses
propres règles n'en prend aucune, et les deux listes ne sont jamais fusionnées.
`rls: "inherit"` sans `defaultRls` exporté interrompt `rebase db generate`,
`rebase db push` et le démarrage avec une erreur indiquant d'en exporter un.

## Politiques obtenues automatiquement par une table

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Les politiques appliquées à une table ne se limitent pas à ses propres règles :

- **La référence administrateur.** Chaque table reçoit les politiques
  `<table>_default_admin_read` et `<table>_default_admin_write` pour insert,
  update et delete. Elles sont permissives et autorisent le contexte serveur et
  le rôle `admin`, de sorte que les administrateurs lisent et écrivent chaque
  ligne. Les politiques permissives sont combinées avec un OU logique (ORed), la
  référence élargit donc tout ce que vos règles autorisent ; elle ne les
  restreint jamais.
- **La table des utilisateurs.** Une table déclarée avec
  [`defineAuthTable`](/docs/schema/auth-table/) reçoit également une politique
  permettant à un utilisateur connecté de lire sa propre ligne, ainsi qu'un
  verrou restrictif qui n'autorise qu'un administrateur à écrire dans les
  colonnes de privilèges (`roles`), peu importe ce que disent ses règles.
- **Multi-tenance (Tenancy).** Une table avec
  [`tenant`](/docs/collections/tenancy/) reçoit une politique restrictive qui
  cantonne chaque opération au tenant de l'appelant.
- **Tables de jonction.** La jonction d'une relation
  [`manyToMany`](/docs/collections/relations/#manytomany--through-a-junction)
  reçoit ses propres politiques.

`defaultPolicies: false` sur une table supprime la référence administrateur
permissive et conserve les verrous restrictifs, de sorte que la table applique
exactement les règles que vous avez écrites. Cette option est refusée lorsqu'elle
est associée à `"admin-only"`, qui n'est rien d'autre que la référence de base :
cette combinaison produirait une table qu'aucun appelant ne pourrait atteindre,
administrateurs compris.

Le DDL généré marque chaque politique injectée, et `rebase db push` restaure
toute politique supprimée manuellement.

## Formes de règles

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Une règle adopte l'une des formes suivantes. En combiner deux au sein d'une même
règle constitue une erreur de type, également rejetée par le compilateur, ce qui
permet de détecter les erreurs en JavaScript et les transtypages (casts) :
`access` aux côtés de `ownerField`, `using` ou `withCheck` ; `ownerField` aux
côtés de `using`, `withCheck`, `condition` ou `check` ; `condition` ou `check`
aux côtés de `using` ou `withCheck`. Il en va de même pour une valeur en dehors
de la liste autorisée pour `access`, `mode`, `operation(s)` ou `roles` (une faute
de frappe dans `"restrictive"` est refusée, et non interprétée comme
permissive). Une règle ne devient jamais une politique qui ignore silencieusement
la moitié de ce qui a été écrit.

| Forme | Exemple | `USING` (quelles lignes) | `WITH CHECK` (ce qui peut être écrit) |
|---|---|---|---|
| Propriétaire | `{ ownerField: "authorId" }` | la colonne est égale à l'id de l'appelant | identique |
| Public | `{ access: "public" }` | chaque ligne | chaque ligne |
| Connecté | `{ access: "authenticated" }` | chaque ligne, pour un appelant connecté | identique |
| Connecté avec un compte | `{ access: "registered" }` | chaque ligne, pour un appelant connecté qui n'est pas un invité | identique |
| Accès avec condition | `{ access: "public", condition: { status: "published" } }` | la condition (et connecté, pour `"authenticated"` et `"registered"`) | `check`, sinon la condition, filtrée de la même façon |
| Accès avec vérification (check) | `{ access: "authenticated", check: { state: "open" } }` | le test d'accès seul | le check, filtré par le test d'accès |
| Structuré | `{ condition: policy.rolesOverlap(["moderator"]) }` | la condition | `check`, sinon la condition |
| SQL brut | `{ using: "{published_at} > now() - interval '30 days'" }` | le SQL | `withCheck`, sinon `using` |
| Check brut uniquement | `{ operation: "insert", withCheck: "{owner_id} = rebase.uid()" }` | aucune ligne | le SQL |
| Rôles uniquement | `{ operation: "delete", roles: ["admin"] }` | chaque ligne, pour les rôles | identique |

Chaque forme accepte également les clés communes :

| Clé | Par défaut | Ce qu'elle fait |
|---|---|---|
| `operation` | `"all"` | `"select"`, `"insert"`, `"update"`, `"delete"` ou `"all"`. |
| `operations` | | Plusieurs opérations à la fois ; une politique est générée par opération. Prévaudra sur `operation`. |
| `roles` | | Rôles applicatifs ; la règle s'applique uniquement à un appelant possédant l'un d'eux. Combiné par un ET logique (ANDed) avec le reste de la règle. |
| `mode` | `"permissive"` | `"restrictive"` transforme la règle en un filtre restrictif qui doit également être validé. Voir [Permissif et restrictif](#permissif-et-restrictif). |
| `name` | dérivé | Le nom de la politique. En son absence, le nom est dérivé de la table, de l'opération et d'un hash de la règle, ce qui signifie que modifier une règle renomme sa politique. |
| `pgRoles` | `["public"]` | Rôles natifs Postgres : la clause `TO` de `CREATE POLICY`. Différent de `roles`. |

`roles` correspond aux rôles applicatifs de Rebase, stockés dans la colonne
`roles` de la table des utilisateurs et lus au sein d'une politique via
`rebase.roles()`. Ce ne sont pas des rôles Postgres : les noms comme `anon` ou
`authenticated` appartiennent à `pgRoles`, et placés dans `roles`, ils
produisent une condition qu'aucun utilisateur ne remplit. Presque tous les
projets utilisent `roles`.

:::note[Règles migrées depuis la version 0.30]
Le compilateur 0.30 ne lisait qu'une seule clause d'une règle et ne connaissait
aucune autre valeur d'`access` que `"public"`. Quatre configurations accordent
donc désormais des droits différents — un simple `access: "authenticated"`
n'accordait rien auparavant et autorise désormais tout appelant connecté.
`rebase migrate collections-to-tables` liste chacune d'elles sous « Review
before deploying » ; voir [le guide de mise à niveau](/docs/upgrading/0-30-to-0-31/#review-before-deploying-these-rules-change-meaning).
:::

### Propriétaire

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const notes = defineTable("notes", {
    columns: {
        id:      col.uuid().primaryKey().defaultRandom(),
        ownerId: col.uuid().notNull().onCreateUser(),
        body:    col.text(),
    },
    rls: [{ operation: "all", ownerField: "ownerId" }],
});
```

Cela génère `USING ((owner_id)::text = (SELECT rebase.uid()))`.
`ownerField` désigne une clé de colonne, une colonne SQL ou une relation
`belongsTo` (sa colonne de clé étrangère). Il compare la colonne avec l'id de
l'appelant ; il ne la remplit pas. `.onCreateUser()` indique au serveur d'écrire
l'id de l'appelant à la création, peu importe ce que la requête a envoyé, ce qui
donne tout son sens à la comparaison.

### Accès public

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

`{ operation: "select", access: "public" }` génère `USING (true)` : aucun filtre
de ligne en lecture, donc chaque appelant autorisé par l'API lit toutes les
lignes.

Cela élargit les lignes qu'un appelant peut voir, mais pas qui a le droit
d'appeler l'API. Par défaut, l'API renvoie toujours une erreur 401 à une requête
sans token. Définissez `AUTH_REQUIRE=false` (`auth.requireAuth: false`) pour
supprimer cette barrière et laisser les politiques décider seules ; un appelant
non authentifié pourra alors lire ces lignes également.

`{ access: "authenticated" }` fonctionne de la même manière, avec en plus un
test de connexion : l'appelant possède une session. Un invité créé par
connexion anonyme en possède une. `{ access: "registered" }` exclut également les
invités ; privilégiez-le sur un projet acceptant les connexions anonymes. Les
deux se combinent avec `condition` et `check` comme `"public"`. Voir
[`authenticated()` et `registered()`](#authenticated-et-registered).

### Conditions

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Une `condition` définit quelles lignes existantes sont couvertes par une règle ;
un `check` définit quelles valeurs nouvelles ou modifiées elle autorise, et
prend par défaut la valeur de la condition. Les deux acceptent la syntaxe objet
raccourcie ou une expression structurée.

La **syntaxe raccourcie** (shorthand) est un simple objet composé de clés de
colonnes et de valeurs littérales. Elle est satisfaite lorsque chaque colonne est
égale à sa valeur, une valeur `null` signifiant `IS NULL` :

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const reports = defineTable("reports", {
    columns: {
        id:        col.uuid().primaryKey().defaultRandom(),
        state:     col.enum(["open", "closed"]).notNull().default("open"),
        public:    col.boolean().notNull().default(false),
        deletedAt: col.timestamp({ withTimezone: true }),
    },
    rls: [
        // Anyone reads public reports that are not deleted.
        { operation: "select", access: "public", condition: { public: true, deletedAt: null } },
        // Signed-in callers may file a report, but only as an open one.
        { operation: "insert", access: "authenticated", check: { state: "open" } },
    ],
});
```

La syntaxe raccourcie nécessite au moins une clé, et aucune clé ne peut être
nommée `kind` (c'est ainsi qu'une expression structurée est identifiée ; pour
comparer une colonne appelée `kind`, utilisez la forme explicite). Ses clés sont
vérifiées par rapport à la table lors de la compilation du schéma : une clé qui
ne correspond à aucune colonne est refusée, la table et la clé étant indiquées
dans l'erreur.

Une condition **structurée** est construite avec `policy`, importé depuis
`@rebasepro/types`. Elle se compile en SQL pour la base de données et est évaluée
en JavaScript par le CMS, de sorte que le CMS ne propose jamais une action que
la base de données refuserait :

```ts
import { defineTable, col } from "@rebasepro/server/schema";
import { policy } from "@rebasepro/types";

export const documents = defineTable("documents", {
    columns: {
        id:     col.uuid().primaryKey().defaultRandom(),
        teamId: col.uuid().notNull(),
        userId: col.uuid().notNull(),
    },
    rls: [
        // The owner, or anyone holding `moderator`.
        {
            operation: "update",
            condition: policy.or(
                policy.compare(policy.field("userId"), "eq", policy.authUid()),
                policy.rolesOverlap(["moderator"])
            ),
        },
        // Members of the document's team read it.
        {
            operation: "select",
            condition: policy.existsIn({
                table: "team_members",
                where: policy.and(
                    policy.compare(policy.field("team_id"), "eq", policy.outerField("teamId")),
                    policy.compare(policy.field("user_id"), "eq", policy.authUid())
                ),
            }),
        },
    ],
});
```

À l'intérieur de `existsIn`, `policy.field()` désigne une colonne de l'autre
table et `policy.outerField()` une colonne de la ligne en cours de vérification.
Cela compile en une sous-requête `EXISTS` corrélée.

| Expression | Compile en |
|---|---|
| `policy.true()` / `policy.false()` | `true` / `false` |
| `policy.and(…)` / `policy.or(…)` / `policy.not(e)` | conjonction, disjonction, négation |
| `policy.compare(left, op, right)` | une comparaison ; `op` vaut `"eq"`, `"neq"`, `"lt"`, `"lte"`, `"gt"` ou `"gte"` |
| `policy.rolesOverlap(roles)` | l'appelant possède **au moins un** de ces rôles |
| `policy.rolesContain(roles)` | l'appelant possède **tous** ces rôles |
| `policy.authenticated()` | un appelant connecté |
| `policy.registered()` | un appelant connecté avec un compte, pas un invité |
| `policy.serverContext()` | `rebase.uid() IS NULL` ; voir l'avertissement ci-dessous |
| `policy.existsIn({ table, where })` | un `EXISTS` corrélé sur une autre table ; une déclaration sans `table` est refusée à la compilation du schéma |
| `policy.raw(sql)` | le SQL, inséré tel quel |

| Opérande | Signification |
|---|---|
| `policy.field(name)` | une colonne de la ligne en cours de vérification, ou à l'intérieur de `existsIn` de l'autre table |
| `policy.outerField(name)` | à l'intérieur de `existsIn`, une colonne de la ligne en cours de vérification |
| `policy.literal(value)` | une chaîne, un nombre, un booléen ou `null` |
| `policy.authUid()` | `rebase.uid()` |
| `policy.authRoles()` | les rôles de l'appelant sous forme de tableau |
| `policy.authClaim(name)` | une revendication personnalisée (custom claim) sur le jeton de session, convertie vers le type de la colonne avec laquelle elle est comparée |

`existsIn`, `raw` et `authClaim` sont évalués uniquement par la base de données ;
le CMS les traite comme inconnus et reflète ce que le serveur renvoie.

### SQL brut

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

`using` et `withCheck` acceptent du SQL. `{column}` est résolu vers la colonne de
la table, et l'appelant est accessible via `rebase.uid()`, `rebase.roles()`
(rôles séparés par des virgules) et `rebase.jwt()` (les claims du token sous
forme de `jsonb`) :

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const tasks = defineTable("tasks", {
    columns: {
        id:       col.uuid().primaryKey().defaultRandom(),
        orgId:    col.uuid().notNull(),
        isLocked: col.boolean().notNull().default(false),
    },
    rls: [
        {
            operation: "select",
            using: "EXISTS (SELECT 1 FROM org_members m WHERE m.org_id = {org_id} AND m.user_id = rebase.uid())",
        },
        { operation: "update", mode: "restrictive", using: "{is_locked} = false", withCheck: "{is_locked} = false" },
    ],
});
```

Le SQL brut est appliqué uniquement par Postgres : le CMS ne peut pas l'évaluer.
Privilégiez une syntaxe raccourcie ou une condition structurée dès lors qu'elles
permettent d'exprimer la même chose.

## Évalué une seule fois par instruction

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Chaque partie d'une règle qui ne lit pas la ligne — l'id de l'appelant, une
vérification de rôles, un claim, `serverContext()` — est compilée au sein d'une
sous-requête scalaire. Une règle de propriétaire devient
`(user_id)::text = (SELECT rebase.uid())`. Postgres calcule cette sous-requête
une seule fois par instruction plutôt qu'une fois par ligne, et planifie comme
si la vérification correspondait à la moitié de la table plutôt qu'à 1,5 %, ce
qui permet aux pages profondes d'une grande table d'utiliser leur index. Les
droits d'accès en lecture et écriture restent inchangés.

Le SQL brut reçoit le même traitement lorsque Rebase peut lire sa structure
(c'est le cas de `owner_id = rebase.uid()`). Tout le reste est inséré tel quel,
veillez donc à encapsuler vous-même les appels : `(SELECT rebase.uid())`.

## `authenticated()` et `registered()`

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Une requête sans aucune session se voit attribuer un identifiant sentinelle, de
sorte que `rebase.uid()` n'est jamais `NULL` lors d'une requête, et
`policy.authenticated()` (tout comme `access: "authenticated"`) l'exclut.

Un **invité** est différent : `POST /auth/anonymous` crée une vraie ligne
d'utilisateur avec une vraie session, de sorte qu'un invité passe avec succès
chaque test qui examine l'id. `policy.registered()` (et `access: "registered"`)
équivaut à `authenticated()` plus « pas un invité ». Utilisez-le chaque fois
qu'une règle concerne une personne qui pourrait être tenue pour responsable —
rédiger un avis, rejoindre une organisation, effectuer un paiement — et
`authenticated()` lorsqu'un invité est le bienvenu : un panier avant le
paiement, un brouillon avant l'inscription.

:::caution[`serverContext()` n'est pas satisfait par `dataAsAdmin`]
Il se compile en `rebase.uid() IS NULL`, ce qui n'est vrai que pour les flux
intégrés qui s'exécutent sans utilisateur (inscription, migrations).
`rebase.dataAsAdmin` s'exécute avec `uid: "service"` et le rôle `admin`, il est
donc **faux** dans ce cas. Une table avec `defaultPolicies: false` dont la seule
règle est `serverContext()` refusera ces écritures et ne renverra aucune ligne
pour ces lectures. `rebase.sql()` est l'accesseur qui contourne les politiques.
:::

## Permissif et restrictif

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Les règles permissives (par défaut) sont combinées avec un OU logique (ORed) :
une ligne est accessible dès lors que l'une d'entre elles l'autorise. Les
règles restrictives sont combinées avec un ET logique (ANDed) avec celles-ci :
chaque règle restrictive doit également être validée. Une règle permissive
élargit l'accès ; une règle restrictive ne peut que le restreindre. Le
cloisonnement multi-tenant (tenancy) est une règle restrictive pour cette
raison : une règle `access: "public"` définie par ailleurs sur la table ne peut
pas outrepasser la frontière du tenant.

## Ce qui se verrouille par défaut

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Une table ne peut pas devenir accessible par accident :

- **Dans l'éditeur**, `rls` est obligatoire et `[]` n'est pas une valeur
  valide.
- **Au chargement du module**, `defineTable` lève une exception lorsque `rls`
  est manquant, vide ou ne correspond pas à l'une des trois postures, ce qui
  permet de détecter également les erreurs en JavaScript et les transtypages.
- **Lors de la compilation du schéma** — `rebase db generate`,
  `rebase db push`, `rebase doctor` et au démarrage du serveur — le schéma est
  refusé pour `"inherit"` sans `defaultRls`, `"admin-only"` avec
  `defaultPolicies: false`, ainsi que pour toute règle désignant une colonne
  absente de la table (dans `ownerField`, une clé de syntaxe raccourcie ou un
  `policy.field()`). Une faute de frappe dans une règle parviendrait sinon
  jusqu'à `CREATE POLICY` et y échouerait, sur une table dont la sécurité au
  niveau des lignes est déjà activée, la laissant ainsi inaccessible à tout le
  monde.
- **Sans schéma**, lorsque le backend lit les tables depuis la base de données,
  une table sans `ENABLE ROW LEVEL SECURITY` n'est pas servie. Le démarrage
  l'indique explicitement, avec la commande
  `ALTER TABLE … ENABLE ROW LEVEL SECURITY` permettant de la protéger. Voir
  [Backend uniquement](/docs/getting-started/headless/).

Chaque requête exécute ses instructions sous un rôle de base de données auquel la
sécurité au niveau des lignes s'applique, au sein d'une transaction véhiculant
l'id, les rôles et les revendications (claims) de l'appelant. C'est ce que
lisent `rebase.uid()`, `rebase.roles()` et `rebase.jwt()`.

## Requêtes sans session

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Une requête sans token n'atteint les politiques que si `AUTH_REQUIRE=false` ;
dans le cas contraire, l'API renvoie d'abord une erreur 401. Elle s'exécute alors
avec `rebase.uid()` défini sur `'anonymous'` et aucun rôle : les règles
`access: "public"` l'autorisent, tandis que `access: "authenticated"` et les
règles de propriétaire la refusent.

Un formulaire de contact accepte les insertions de n'importe qui et n'est lu que
par les administrateurs :

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const contactMessages = defineTable("contact_messages", {
    columns: {
        id:      col.uuid().primaryKey().defaultRandom(),
        email:   col.text().notNull().validate({ email: true }),
        message: col.text().notNull().validate({ max: 5000 }),
    },
    rls: [
        { operation: "insert", access: "public" },
        { operations: ["select", "update", "delete"], roles: ["admin"] },
    ],
});
```

## Les lignes d'un côté, les colonnes de l'autre

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

`rls` détermine à quelles lignes un appelant accède. Il n'a aucun impact sur les
colonnes d'une ligne atteinte : une règle permettant à un employé de lire les
lignes de son équipe lui permet de lire chaque colonne de ces lignes, salaire
compris. Les règles par colonne se définissent avec
[`.access()`](/docs/collections/field-access/) sur la colonne :

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const staff = defineTable("staff", {
    columns: {
        id:     col.integer().primaryKey().generatedByDefaultAsIdentity(),
        name:   col.text().notNull(),
        // Everyone the rules let read the row; only HR receives this column.
        salary: col.numeric({ precision: 10, scale: 2 }).access({ read: ["hr"], write: [] }),
    },
    rls: [{ operation: "select", access: "authenticated" }],
});
```

Les rôles sont les mêmes rôles : `policy.rolesOverlap(["hr"])` dans une règle et
`.access({ read: ["hr"] })` sur une colonne désignent le même `hr`. Les règles
de colonne sont appliquées par le serveur, elles couvrent donc chaque route
d'API ; une requête exécutée via `rebase.sql()` voit toutes les colonnes, car
elle contourne la sécurité au niveau des lignes.

## Prochaines étapes

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

- [Accès aux champs](/docs/collections/field-access/) : rôles de lecture et d'écriture par colonne
- [Multi-tenance (Tenancy)](/docs/collections/tenancy/) : une frontière restrictive par tenant
- [Rôles et portées (scopes)](/docs/backend/roles-and-scopes/) : d'où proviennent les rôles
- [La table des utilisateurs](/docs/schema/auth-table/) : les politiques ajoutées par `defineAuthTable`
