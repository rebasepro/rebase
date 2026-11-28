---
sourceHash: 4107937aed2a477c
title: Exécution sur une base de données existante ou partagée
sidebar_label: Base de données existante ou partagée
description: Exécutez Rebase sur une base de données PostgreSQL dont il n'est pas propriétaire — un cluster partagé avec d'autres applications, un second projet Rebase, Supabase ou une base de données verrouillée par un DBA — avec les paramètres rls, rebase doctor --database et rebase db request-role migrate.
---

## Le problème

Rebase exécute chaque requête authentifiée ou anonyme sous un rôle Postgres
restreint unique, `rebase_user`, et laisse la sécurité au niveau des lignes
(row-level security ou RLS) décider des lignes que cette requête peut voir. Le
rôle de connexion est propriétaire des tables et contourne la RLS ; chaque
requête bascule vers `rebase_user` au sein de sa transaction.

Cela fonctionne sur une base de données dont Rebase est le propriétaire
exclusif : Rebase Cloud, la configuration Docker générée par `rebase init`,
la base de données de développement gérée. Cela repose sur deux hypothèses :

1. Seul le serveur de ce projet peut devenir `rebase_user`.
2. Seuls `rebase_user` et le propriétaire de la table touchent aux tables de Rebase.

Une base de données déjà exploitée par ailleurs enfreint souvent ces deux
hypothèses :

- **Les rôles appartiennent à l'ensemble du cluster, pas à une seule base de données.**
  Deux projets Rebase sur un même cluster partagent le même `rebase_user`. Par
  défaut, chaque rôle peut se connecter à chaque base de données, et n'importe
  qui peut définir les paramètres de session que lisent les politiques de
  Rebase ; ainsi, la connexion du projet A peut ouvrir la base de données du
  projet B, basculer vers `rebase_user` et valider les politiques de B en tant
  qu'administrateur de B.
- **Les privilèges (grants) couvrent des schémas entiers.** Par défaut, Rebase
  accorde au rôle de requête les privilèges `SELECT, INSERT, UPDATE, DELETE` sur
  chaque table de `public` sur laquelle il peut accorder des droits, y compris les
  tables appartenant à une autre application.
- **Les politiques par défaut s'appliquent `TO public`.** La politique de base
  que Rebase ajoute à chaque table autorise toute session qui n'a jamais défini
  l'identité de Rebase. C'est ainsi que passent les propres requêtes du
  serveur, mais cela autorise également tout autre rôle détenant un droit sur la
  table, comme le rôle `anon` de Supabase via son API Data.
- **Les politiques existantes basées sur les rôles ne s'appliquent jamais.** Une
  politique écrite avec `TO authenticated` ne s'applique pas à `rebase_user`, car
  `rebase_user` n'hérite pas des privilèges des autres rôles.
- **Certaines bases de données ne permettent pas du tout à l'application de créer des rôles.**
  Un administrateur de base de données (DBA) crée chaque rôle manuellement, ou
  les rôles sont gérés dans Terraform.

Chacun de ces cas dispose d'un paramètre. Chaque paramètre prend par défaut la
valeur correspondant au comportement de Rebase sans lui, de sorte qu'un projet
qui ne définit rien se comporte exactement comme auparavant.

## Vérifier d'abord la base de données

```bash
rebase doctor --database
```

Cette commande lit le catalogue de la base de données du projet et ne modifie
rien. Elle signale :

- si chaque rôle de requête existe, est restreint, et si cette connexion peut
  basculer vers lui ;
- les autres rôles de connexion (login) pouvant basculer vers le rôle de
  requête ;
- si chaque rôle sur le cluster peut se connecter à cette base de données ;
- les tables dans les schémas de Rebase que Rebase ne dessert pas ;
- les autres rôles détenant des privilèges sur les tables de Rebase ;
- les politiques sur les tables de Rebase écrites `TO` un rôle dont le rôle de
  requête n'hérite pas ;
- les privilèges par défaut qui attribuent de nouvelles tables à d'autres
  rôles.

Chaque constat est accompagné du code SQL à exécuter en tant qu'administrateur
de base de données, du paramètre permettant d'adapter Rebase à la base de
données, ou des deux. La commande renvoie le code de sortie 1 lorsqu'un problème
bloquant est détecté, ce qui permet de l'intégrer dans un pipeline de
déploiement. Elle vérifie la base de données par rapport aux paramètres
visibles : les variables `REBASE_RLS_*`, puis les rôles de requête enregistrés
dans la base de données lors d'un démarrage du serveur.

`npx @rebasepro/rls-check` audite les politiques elles-mêmes, sur n'importe quel
Postgres. Sur une base de données Rebase, il lit le rôle de requête de la même
manière ; spécifiez-le avec `--request-role` lorsqu'il n'est pas encore
enregistré.

## Les paramètres

Définissez-les dans la déclaration de la base de données dans `backend/resources.ts` :

```ts
import { database } from "@rebasepro/types";

export const main = database({
    rls: {
        requestRole: "acme_prod_user",
        grants: "managed"
    }
});
```

Ou depuis l'environnement, qui prévaut sur la déclaration. L'environnement est
la solution idéale pour une valeur qui diffère entre deux déploiements du même
code, comme le nom du rôle lorsque les environnements de staging et de production
partagent un cluster.

| Paramètre | Variable d'environnement | Valeur par défaut | Alternatives |
|---|---|---|---|
| `requestRole` | `REBASE_RLS_REQUEST_ROLE` (un nom unique) | `"rebase_user"` | Tout nom de rôle. `{ anonymous, signedIn }` pour exécuter les appelants sans session sous un rôle et les appelants connectés sous un autre. Dans le code du driver, une fonction de l'identité de la requête. |
| `requestRoles` | aucun | dérivé de `requestRole` | Chaque rôle qu'un `requestRole` sous forme de fonction peut renvoyer, afin que chacun puisse être provisionné, recevoir des privilèges et être vérifié. Obligatoire avec une fonction. |
| `provisionRole` | `REBASE_RLS_PROVISION_ROLE` | `"auto"` : crée le rôle s'il est manquant et accorde à cette connexion le droit de basculer vers lui | `"never"` : le rôle et l'appartenance relèvent de votre responsabilité. Le démarrage vérifie les deux et échoue en affichant le SQL à exécuter. |
| `grants` | `REBASE_RLS_GRANTS` | `"schema"` : chaque table et séquence dans les schémas desservis par Rebase sur lesquelles la connexion peut accorder des droits, plus les privilèges par défaut pour les tables créées ultérieurement | `"managed"` : uniquement les tables desservies par Rebase, et aucun privilège par défaut. `"none"` : Rebase n'accorde rien ; une table sur laquelle vous n'avez pas accordé de droits est refusée. |
| `policyTarget` | `REBASE_RLS_POLICY_TARGET` | `"public"` | `"requestRole"` : les politiques permissives s'appliquent uniquement au(x) rôle(s) de requête. Les politiques restrictives s'appliquent toujours à tout le monde. |
| `adminPolicies` | `REBASE_RLS_ADMIN_POLICIES` | `"adminRole"` : les politiques que seuls le contexte du serveur ou un administrateur peuvent valider (la base de référence, `roles: ["admin"]`) sont écrites `TO rebase_admin`, et les requêtes administrateur s'exécutent en tant que `<request role>_admin` | `"public"` : ces politiques sont `TO public` et les administrateurs s'exécutent sous le rôle de requête, comme avant l'existence de ce paramètre. |
| `defaultPolicies` | `REBASE_RLS_DEFAULT_POLICIES` | `true` | `false` : aucune table ne reçoit la base de référence serveur-ou-administrateur. La valeur `defaultPolicies: false` propre à une table reste prioritaire pour celle-ci. |
| `required` | aucun | `true` : une table déclarée que la base de données ne protège pas (sécurité au niveau des lignes désactivée, politiques déclarées manquantes) n'est pas desservie lorsque le démarrage ne provisionne rien | `false` : dessert quand même les tables de cette base de données et les liste au démarrage. Pour un schéma appartenant à un autre outil et une application qui applique elle-même le contrôle d'accès ; voir « Un autre outil est propriétaire du schéma » ci-dessous. Le paramètre `rlsRequired` propre à une table reste prioritaire pour celle-ci. |
| `inheritRoles` | aucun | `[]` | Rôles accordés au rôle de requête avec `WITH INHERIT TRUE`, afin que les politiques écrites `TO` avec ces rôles s'appliquent. Avec un rôle de requête `{ anonymous, signedIn }`, seul le rôle connecté les reçoit ; avec une fonction, le paramètre est refusé. PostgreSQL 16 et versions ultérieures ; refusé sur la version 15 et les versions antérieures. |
| `identity` | `REBASE_RLS_IDENTITY` (formes nommées) | `"rebase"` : `app.uid`, `app.user_roles`, `app.is_anonymous`, `app.jwt` | `"supabase"` : également `request.jwt.claims`, `request.jwt.claim.sub` et `request.jwt.claim.role`, de sorte que `auth.uid()` et `auth.jwt()` voient l'appelant. Dans le code du driver, une fonction retournant des paramètres supplémentaires. Les paramètres `app.*` sont toujours définis. |
| `sharedRole` | `REBASE_RLS_SHARED_ROLE` | `"warn"` lorsqu'un autre rôle de connexion peut basculer vers le rôle de requête | `"refuse"` : fait échouer le démarrage. `"ignore"` : ne signale rien. |

Les formes fonctionnelles de `requestRole` et `identity` ne sont acceptées que
dans le bloc `rls` du driver lui-même, qui accepte les mêmes paramètres.
`policyTarget`, `adminPolicies` et `defaultPolicies` modifient le SQL des
politiques généré par `rebase db generate`, et la CLI ne peut pas lire le code
du driver ; définissez donc ces options sur la déclaration ou dans
l'environnement. Un démarrage qui ne les trouve que dans le code du driver
refusera de s'exécuter.

Au démarrage, la ligne qui indique comment les requêtes sont isolées liste chaque
paramètre qui n'est pas à sa valeur par défaut. Un paramètre qui vous délègue une
tâche, tel que `grants: "none"`, précise une fois de quelle tâche il s'agit.

Le premier démarrage avec provisionnement enregistre le ou les rôles de requête
dans `rebase.schema_meta`. Un démarrage ultérieur configuré avec un rôle
différent refusera de se lancer et indiquera la commande permettant de migrer la
base de données, décrite ci-dessous. Sans cette vérification, l'ancien rôle
conserverait ses privilèges tandis qu'un nouveau serait configuré à ses côtés.

## Recettes

### Un cluster partagé avec d'autres applications ou projets

Attribuez à chaque projet, et à chaque déploiement partageant un cluster, son
propre rôle :

```bash
REBASE_RLS_REQUEST_ROLE=acme_prod_user
```

Une base de données qui a déjà fonctionné sous `rebase_user` conserve cette
information ; commencez donc par la migrer :

```bash
rebase db request-role migrate --to acme_prod_user --dry-run
rebase db request-role migrate --to acme_prod_user
```

La commande crée le nouveau rôle s'il est manquant, réattribue dans cette base de
données uniquement chaque privilège détenu par l'ancien rôle (tables, colonnes,
séquences, schémas, fonctions, privilèges par défaut définis par cette connexion
et appartenances), redirige les politiques qui mentionnent l'ancien rôle, et
enregistre le nouveau rôle. Elle s'exécute au sein d'une seule transaction.
L'ancien rôle est laissé tel quel, car une autre base de données sur le cluster
peut encore l'utiliser. Une fois terminée, elle affiche les instructions
`REVOKE` qui révoquent les privilèges de l'ancien rôle dans cette base de
données, à exécuter dès que plus rien ici n'en a besoin. L'option `--dry-run`
affiche les mêmes instructions et ne modifie rien. Dans un terminal interactif,
elle demande confirmation avant de s'exécuter ; sans terminal, elle refuse de
s'exécuter sans `--yes`.

Définissez ensuite `REBASE_RLS_REQUEST_ROLE` sur chaque serveur qui utilise la
base de données.

`rebase doctor --database` signale également si chaque rôle sur le cluster peut
se connecter à la base de données, en fournissant l'instruction `REVOKE CONNECT
… FROM PUBLIC` permettant de l'empêcher. Rebase n'exécute pas cette commande de
lui-même sur une base de données dont il n'est pas propriétaire.

### Supabase

Un schéma Supabase existant possède déjà `anon` et `authenticated`, ainsi que des
politiques écrites pour ces rôles avec `auth.uid()`. Pour que ces politiques
s'appliquent sans modification aux requêtes de Rebase :

```ts
import { database } from "@rebasepro/types";

export const main = database({
    rls: {
        requestRole: { anonymous: "anon", signedIn: "authenticated" },
        identity: "supabase",
        policyTarget: "requestRole"
    }
});
```

- `requestRole` exécute les appelants sans session sous `anon` et tous les
  utilisateurs connectés (invités inclus) sous `authenticated`.
- `identity: "supabase"` définit les paramètres `request.jwt.*` que lit
  `auth.uid()`. Sans eux, chaque test `auth.uid() = owner_id` échoue, ou passe
  alors qu'il ne le devrait pas.
- `policyTarget: "requestRole"` empêche les propres politiques de Rebase de
  s'appliquer aux sessions qui ne sont pas des requêtes Rebase, comme l'API Data
  de Supabase.

Puisque les requêtes s'exécutent directement en tant que `anon` et
`authenticated`, les politiques rédigées `TO anon` ou `TO authenticated`
s'appliquent telles quelles, et `inheritRoles` n'est pas nécessaire. Cette option
est destinée aux projets dont les requêtes s'exécutent sous un rôle propre, par
exemple `requestRole: "acme_user", inheritRoles: ["authenticated"]`. Avec une
paire `{ anonymous, signedIn }`, elle n'est accordée qu'au rôle connecté,
jamais au rôle anonyme.

Les privilèges par défaut standards de Supabase ont accordé des droits sur les
tables créées dans `public` à `anon` et `authenticated` ; vérifiez ceux de votre
projet. Exécutez `rebase doctor --database` et `rls-check` après le premier
démarrage pour voir à quoi ces rôles ont accès.

### Un autre outil est propriétaire du schéma et l'application applique le contrôle d'accès

Certaines bases de données ne relèvent pas de la responsabilité de Rebase en
matière de sécurité. Alembic, Prisma ou un DBA détient les tables, rien n'y active
la sécurité au niveau des lignes, et l'application décide elle-même de qui voit
quoi : seuls les membres de l'équipe peuvent se connecter, des hooks vérifient
chaque écriture, un scope contrôle l'accès à chaque route.

Déclarez cette configuration directement sur la table :

```ts
export const invoices = defineTable("invoices", {
    columns: { id: col.uuid().primaryKey().defaultRandom(), total: col.numeric() },
    rls: "unmanaged"
});
```

Ou pour l'ensemble du projet via `defaultRls = "unmanaged"` dans
`backend/schema/index.ts` accompagné de `rls: "inherit"` sur chaque table. Rebase
n'émet aucun DDL de type `ENABLE ROW LEVEL SECURITY` ou de création de politique
pour les tables `"unmanaged"` (lors d'un `db push` ou de démarrages avec
provisionnement), les dessert sans restriction et les mentionne une fois au
démarrage. Conservez l'authentification, les rôles, les scopes et les hooks pour
faire respecter les accès.

Si Postgres applique **bien** la sécurité au niveau des lignes sur ces tables,
avec des politiques créées dans des migrations SQL, Supabase ou Terraform plutôt
que dans Rebase, utilisez plutôt `rls: "external"` :

```ts
export const invoices = defineTable("invoices", {
    columns: { id: col.uuid().primaryKey().defaultRandom(), total: col.numeric() },
    rls: "external"
});
```

Rebase n'émet aucun DDL de RLS ou de politique pour les tables `"external"` et
ne purge jamais leurs politiques (`--prune-policies`), tandis que le démarrage
et `rebase doctor` continuent de vérifier que `ENABLE ROW LEVEL SECURITY` est
activé sur la table dans Postgres.

Pour les tables qui déclarent tout de même des règles Rebase sur une base de
données appartenant à un autre outil, `rlsRequired: false` (ou `database({ rls:
{ required: false } })` pour l'ensemble de la base de données) les dessert lors
d'un démarrage sans provisionnement même si les politiques déclarées ne sont pas
présentes, en les signalant dans un unique avertissement :

```ts
// backend/resources.ts
export const main = database({ rls: { required: false } });
```

La directive `rlsRequired: true` sur une table maintient son obligation sous
une base de données configurée avec `required: false`. Lorsque la sécurité au
niveau des lignes est désactivée, une règle déclarée n'est pas appliquée par
Postgres : conservez l'authentification, les rôles et les hooks pour assurer ce
rôle.

### Un administrateur de base de données crée les rôles

Lorsque la connexion n'est pas autorisée à créer des rôles, ou que les rôles sont
gérés dans Terraform :

```bash
REBASE_RLS_PROVISION_ROLE=never
```

Le démarrage vérifie alors le rôle et l'appartenance et échoue en affichant le
SQL à exécuter, au lieu d'essayer de les créer. Pour transmettre ce SQL à
l'administrateur au préalable :

```bash
rebase db provision --print > request-role.sql
```

Cette commande affiche, pour chaque rôle de requête, les instructions permettant
de le créer (`NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT`), de donner au rôle de
connexion le droit de basculer vers lui (`WITH SET TRUE, INHERIT FALSE` sur
PostgreSQL 16 et versions ultérieures), et de lui accorder l'accès aux schémas
sous `grants: "schema"`. L'explication est rédigée sous forme de commentaires
SQL, de sorte que le fichier peut être exécuté tel quel. Elle lit le rôle de
connexion depuis la base de données et n'exécute rien d'autre. Chaque instruction
peut être réexécutée en toute sécurité.

### Requêtes administrateur et `rebase_admin`

Postgres combine les politiques permissives applicables à un rôle avec
l'opérateur OR. Écrite avec `TO public`, la base de référence portée par chaque
table (`rebase.uid() IS NULL OR` le rôle `admin`) s'appliquerait également aux
utilisateurs connectés, et un OR dont l'autre branche est constante pour
l'ensemble de l'instruction ne peut pas utiliser d'index : une liste ou un
comptage restreint au propriétaire d'un utilisateur analyserait toute la table
(table scan). Ainsi, les politiques que seuls le contexte du serveur ou un
administrateur peuvent valider sont écrites `TO rebase_admin`, et n'apparaissent
jamais dans le plan d'exécution des requêtes d'un utilisateur.

La table des utilisateurs fait exception. L'authentification la lit et l'écrit
dans le contexte du serveur sous le propre rôle de la connexion, qui n'est pas
basculé vers `rebase_admin` ; ses politiques restent donc `TO public` quel que
soit le paramètre : derrière un rôle de connexion qui n'est pas propriétaire de
la table, l'inscription et la connexion fonctionnent tout de même.

`rebase_admin` ne détient aucun privilège et ne peut pas se connecter. Un
appelant détenant le rôle `admin`, y compris `rebase.dataAsAdmin`, s'exécute sous
`<request role>_admin` (`rebase_user_admin` par défaut), qui hérite du rôle de
requête et de `rebase_admin`. Une connexion qui est elle-même soumise à la
sécurité au niveau des lignes hérite de `rebase_admin` pour le contexte du
serveur. Le démarrage crée tout cela lorsque la connexion est autorisée à créer
des rôles. Avec `provisionRole: "never"`, créez-les vous-même :

```sql
CREATE ROLE rebase_admin NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
CREATE ROLE rebase_user_admin NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
GRANT rebase_user, rebase_admin TO rebase_user_admin WITH INHERIT TRUE, SET FALSE;
GRANT rebase_user_admin TO <connection role> WITH SET TRUE, INHERIT FALSE;
```

Sur PostgreSQL 15 et les versions antérieures, créez `rebase_user_admin` avec
`INHERIT` et omettez les options `WITH`. Dans les cas où `rebase_admin` ne peut
pas du tout être créé, le démarrage et `rebase db push` écrivent ces politiques
`TO public`, comme auparavant, et les administrateurs continuent de s'exécuter
sous le rôle de requête. `rebase doctor --database` indique la configuration
présente.

#### Les lectures administrateur utilisent les index du propriétaire

Une politique qui n'est pas une constante empêche Postgres d'utiliser un index
pour un opérateur qui n'est pas étanche (leakproof), comme `&&` sur un tableau,
`~` ou un opérateur jsonb. Sans l'étape ci-dessous, la requête `tags && $1` d'un
administrateur parcourait l'ensemble de la table, là où la même requête exécutée
en tant que propriétaire utilisait l'index GIN. Cela concernait aussi bien
`rebase.sqlAsAdmin`, `rebase.dataAsAdmin` que les utilisateurs administrateurs.

Ainsi, le démarrage associe à chaque politique réservée aux administrateurs (que
tout administrateur valide) une politique complémentaire `TO rebase_admin_request
USING (true)`, nommée `<policy>_ar_<hash>`. Pour une requête administrateur,
Postgres réduit les politiques à `true` et planifie la requête comme il le ferait
pour le propriétaire. Les politiques restrictives s'appliquent toujours. Seuls les
rôles `<request role>_admin` peuvent détenir `rebase_admin_request`. À chaque
démarrage, Rebase vérifie quels rôles détiennent ses privilèges. Si un autre
rôle soumis à la sécurité au niveau des lignes les détient, le démarrage n'écrit
aucune politique complémentaire et supprime celles qu'il trouve. Les politiques
complémentaires nécessitent PostgreSQL 16 ou ultérieur, car sur la version 15 et
les versions antérieures, la connexion hériterait du rôle. Seul le démarrage les
écrit. `policies.sql` et les migrations n'en créent jamais, mais elles
suppriment la politique complémentaire de chaque politique réécrite qui n'en
justifie plus une. `rebase db push` et `rebase db migrate` suppriment également
toute politique complémentaire dont la règle a disparu. Une règle
d'administration restreinte ou supprimée cesse donc d'admettre tous les
administrateurs, même lorsque le démarrage ne provisionne rien. Avec
`provisionRole: "never"`, créez le rôle vous-même :

```sql
CREATE ROLE rebase_admin_request NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
GRANT rebase_admin_request TO rebase_user_admin WITH INHERIT TRUE, SET FALSE;
```

Avant de revenir à une version antérieure à celle qui a introduit les politiques
complémentaires, rendez-les inopérantes. Une version antérieure du runtime ne sait
pas ce qu'elles sont et n'en supprimera jamais aucune ; ainsi, une règle
modifiée ultérieurement laisserait sa politique complémentaire autoriser chaque
administrateur à accéder à chaque ligne. Une instruction par rôle de requête
d'administration permet de faire en sorte qu'aucune politique complémentaire
n'autorise qui que ce soit :

```sql
REVOKE rebase_admin_request FROM rebase_user_admin;
```

Ou supprimez-les : chaque politique dont le nom se termine par `_ar_` suivi de
huit caractères hexadécimaux, et dont le rôle est `rebase_admin_request`.

### Un schéma `public` partagé

Lorsque `public` contient des tables auxquelles Rebase ne doit pas accéder :

```bash
REBASE_RLS_GRANTS=managed
```

Rebase n'accorde alors au rôle de requête des droits que sur les tables qu'il
dessert : les tables déclarées, les tables de jonction et ses propres tables
sécurisées au niveau des lignes. Il ne définit aucun privilège par défaut dans
les schémas partagés et ne révoque rien de ce qui a déjà été accordé.
`rebase doctor --database` liste les tables des schémas de Rebase qu'il ne dessert
pas.

Une autre solution consiste à utiliser un schéma propre à Rebase : définissez
`schema` sur chaque `defineTable`.

## Fournisseurs

Ce que le rôle de connexion peut faire varie selon les fournisseurs et détermine
si Rebase peut créer le rôle de requête lui-même. Les remarques ci-dessous
correspondent à ce qui est attendu ; vérifiez-les auprès de votre fournisseur.

| Fournisseur | Rôle de connexion habituel | Remarques |
|---|---|---|
| Supabase | `postgres` (pas superutilisateur, possède CREATEROLE) | Une base de données par projet. `anon`, `authenticated` et `authenticator` existent, avec des privilèges par défaut dans `public`. Voir la recette Supabase ci-dessus. |
| Neon | le propriétaire du projet, membre de `neon_superuser` | Les rôles appartiennent à une branche, et chaque base de données d'une branche les partage. Deux bases de données Rebase dans un même projet Neon partagent `rebase_user`, définissez donc `requestRole` par base de données. |
| AWS RDS / Aurora | l'utilisateur principal (master user), membre de `rds_superuser` | Possède CREATEROLE mais n'est pas superutilisateur. Les instances sont souvent partagées entre applications. |
| Google Cloud SQL | `postgres`, membre de `cloudsqlsuperuser` | Identique à RDS. |
| Azure Flexible Server | l'utilisateur administrateur, membre de `azure_pg_admin` | Identique à RDS. |
| InstaPods | `instapod` ; superutilisateur via `sudo -u postgres` | [Le guide InstaPods](/docs/deployment/instapods/) crée le rôle au préalable. |
| Hostman | `gen_user` ; CREATE ROLE accordé depuis le panneau de configuration | Non disponible sur l'offre la plus petite. [Le guide Hostman](/docs/deployment/hostman/) crée le rôle au préalable. |

## Voir aussi

- [Commandes de base de données](/docs/cli/database/) : `rebase db request-role` et
  `rebase db provision`
- [Référence CLI](/docs/cli/#rebase-doctor) : `rebase doctor --database`
- [rls-check](/docs/rls-check/) : auditer les politiques sur n'importe quel Postgres
- [Règles de sécurité (RLS)](/docs/collections/security-rules/) : les politiques
  que Rebase écrit pour chaque table
