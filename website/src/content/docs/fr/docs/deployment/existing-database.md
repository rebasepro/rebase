---
sourceHash: 8ad9100fe30397b6
title: Exécution sur une base de données existante ou partagée
sidebar_label: Base de données existante ou partagée
description: Exécutez Rebase sur une base de données PostgreSQL dont il n'est pas propriétaire — un cluster partagé avec d'autres applications, un deuxième projet Rebase, Supabase ou une base de données verrouillée par un DBA — grâce aux paramètres rls, rebase doctor --database et rebase db request-role migrate.
---

## Le problème

Rebase exécute chaque requête connectée et anonyme sous un rôle Postgres restreint unique, `rebase_user`, et laisse la sécurité au niveau des lignes (row-level security / RLS) décider des lignes visibles par cette requête. Le rôle de connexion est propriétaire des tables et contourne la RLS ; chaque requête bascule vers `rebase_user` au sein de sa transaction.

Cela fonctionne sur une base de données dont Rebase a la propriété exclusive : Rebase Cloud, la configuration Docker générée par `rebase init`, la base de données de développement gérée. Cela repose sur deux hypothèses :

1. Seul le serveur de ce projet peut devenir `rebase_user`.
2. Seuls `rebase_user` et le propriétaire des tables interagissent avec les tables de Rebase.

Une base de données déjà gérée par ailleurs enfreint souvent ces deux hypothèses :

- **Les rôles appartiennent à l'ensemble du cluster, et non à une seule base de données.** Deux projets Rebase sur un même cluster partagent le même `rebase_user`. Par défaut, chaque rôle peut se connecter à chaque base de données, et n'importe qui peut définir les paramètres de session lus par les stratégies de Rebase. Ainsi, la connexion du projet A peut ouvrir la base de données du projet B, basculer vers `rebase_user` et valider les stratégies de B en tant qu'administrateur de B.
- **Les privilèges (grants) couvrent des schémas entiers.** Par défaut, Rebase accorde au rôle de requête `SELECT, INSERT, UPDATE, DELETE` sur chaque table de `public` pour laquelle il peut accorder des droits, y compris les tables appartenant à une autre application.
- **Les stratégies par défaut s'appliquent `TO public`.** La stratégie de référence que Rebase ajoute à chaque table autorise toute session n'ayant jamais défini l'identité de Rebase. C'est ainsi que passent les requêtes propres au serveur, mais cela autorise également tout autre rôle détenant un privilège sur la table, comme le rôle `anon` de Supabase via son API Data.
- **Les stratégies existantes basées sur les rôles ne s'appliquent jamais.** Une stratégie écrite `TO authenticated` ne s'applique pas à `rebase_user`, car `rebase_user` n'hérite pas des privilèges des autres rôles.
- **Certaines bases de données ne permettent pas du tout à l'application de créer des rôles.** Un DBA crée chaque rôle à la main, ou les rôles sont gérés dans Terraform.

Chacun de ces cas dispose d'un paramètre. Chaque paramètre prend par défaut la valeur correspondant au comportement de Rebase sans celui-ci ; ainsi, un projet qui ne configure rien se comporte exactement comme auparavant.

## Vérifier d'abord la base de données

```bash
rebase doctor --database
```

Elle lit le catalogue de la base de données du projet et ne modifie rien. Elle indique :

- si chaque rôle de requête existe, est restreint, et si cette connexion peut basculer vers celui-ci ;
- les autres rôles de connexion (login) pouvant basculer vers le rôle de requête ;
- si chaque rôle sur le cluster peut se connecter à cette base de données ;
- les tables dans les schémas de Rebase que Rebase ne dessert pas ;
- les autres rôles détenant des privilèges sur les tables de Rebase ;
- les stratégies sur les tables de Rebase écrites `TO` un rôle dont le rôle de requête n'hérite pas ;
- les privilèges par défaut qui attribuent de nouvelles tables à d'autres rôles.

Chaque constat est accompagné du code SQL à exécuter en tant qu'administrateur de base de données, du paramètre permettant d'adapter Rebase à la base de données à la place, ou des deux. La commande renvoie le code de sortie 1 lorsqu'un constat constitue un échec, ce qui lui permet de bloquer un déploiement. Elle vérifie la base de données par rapport aux paramètres visibles : les variables `REBASE_RLS_*`, puis les rôles de requête enregistrés dans la base de données lors du démarrage d'un serveur.

`npx @rebasepro/rls-check` audite les stratégies elles-mêmes, sur n'importe quel Postgres. Sur une base de données Rebase, il lit le rôle de requête de la même manière ; spécifiez-le avec `--request-role` lorsqu'il n'est pas encore enregistré.

## Les paramètres

Définissez-les sur la déclaration de la base de données dans `backend/resources.ts` :

```ts
import { database } from "@rebasepro/types";

export const main = database({
    rls: {
        requestRole: "acme_prod_user",
        grants: "managed"
    }
});
```

Ou depuis l'environnement, qui prévaut sur la déclaration. L'environnement est ce dont vous avez besoin pour une valeur qui diffère entre deux déploiements du même code, comme le nom du rôle lorsque la préproduction et la production partagent un cluster.

| Paramètre | Variable d'environnement | Par défaut | Alternatives |
|---|---|---|---|
| `requestRole` | `REBASE_RLS_REQUEST_ROLE` (un seul nom) | `"rebase_user"` | Tout nom de rôle. `{ anonymous, signedIn }` pour exécuter les appelants sans session sous un rôle et les appelants connectés sous un autre. Dans le code du pilote, une fonction de l'identité de la requête. |
| `requestRoles` | aucun | dérivé de `requestRole` | Chaque rôle qu'un `requestRole` défini sous forme de fonction peut renvoyer, afin que chacun puisse être provisionné, doté de privilèges et vérifié. Requis avec une fonction. |
| `provisionRole` | `REBASE_RLS_PROVISION_ROLE` | `"auto"` : crée le rôle s'il est manquant et accorde à cette connexion le droit de basculer vers lui | `"never"` : le rôle et l'appartenance sont de votre ressort. Le démarrage vérifie les deux et échoue en affichant le SQL à exécuter. |
| `grants` | `REBASE_RLS_GRANTS` | `"schema"` : chaque table et séquence dans les schémas desservis par Rebase sur lesquelles la connexion peut accorder des droits, plus les privilèges par défaut pour les tables créées ultérieurement | `"managed"` : uniquement les tables desservies par Rebase, et aucun privilège par défaut. `"none"` : Rebase n'accorde rien ; une table sur laquelle vous n'avez pas accordé de droits est refusée. |
| `policyTarget` | `REBASE_RLS_POLICY_TARGET` | `"public"` | `"requestRole"` : les stratégies permissives s'appliquent uniquement au(x) rôle(s) de requête. Les stratégies restrictives s'appliquent toujours à tout le monde. |
| `adminPolicies` | `REBASE_RLS_ADMIN_POLICIES` | `"adminRole"` : les stratégies que seuls le contexte du serveur ou un administrateur peuvent valider (la référence, `roles: ["admin"]`) sont écrites `TO rebase_admin`, et les requêtes admin s'exécutent en tant que `<request role>_admin` | `"public"` : ces stratégies sont `TO public` et les administrateurs s'exécutent en tant que rôle de requête, comme avant l'existence de ce paramètre. |
| `defaultPolicies` | `REBASE_RLS_DEFAULT_POLICIES` | `true` | `false` : aucune table ne reçoit la référence serveur-ou-admin. La propriété `defaultPolicies: false` propre à une table prévaut toujours pour celle-ci. |
| `required` | aucun | `true` : une table déclarée que la base de données ne protège pas (sécurité au niveau des lignes désactivée, ses stratégies déclarées manquantes) n'est pas desservie lorsque le démarrage ne provisionne rien | `false` : dessert tout de même les tables de cette base de données et les liste au démarrage. Pour un schéma appartenant à un autre outil et une application qui applique elle-même le contrôle d'accès ; voir « Un autre outil est propriétaire du schéma » ci-dessous. Le `rlsRequired` propre à une table prévaut pour celle-ci. |
| `inheritRoles` | aucun | `[]` | Rôles accordés au rôle de requête `WITH INHERIT TRUE`, afin que les stratégies écrites `TO` à leur intention s'appliquent. Avec un rôle de requête `{ anonymous, signedIn }`, seul le rôle connecté les reçoit ; avec une fonction, le paramètre est refusé. PostgreSQL 16 et plus récent ; refusé sur la version 15 et les versions antérieures. |
| `identity` | `REBASE_RLS_IDENTITY` (formes nommées) | `"rebase"` : `app.uid`, `app.user_roles`, `app.is_anonymous`, `app.jwt` | `"supabase"` : également `request.jwt.claims`, `request.jwt.claim.sub` et `request.jwt.claim.role`, pour que `auth.uid()` et `auth.jwt()` voient l'appelant. Dans le code du pilote, une fonction renvoyant des paramètres supplémentaires. Les paramètres `app.*` sont toujours définis. |
| `sharedRole` | `REBASE_RLS_SHARED_ROLE` | `"warn"` lorsqu'un autre rôle de connexion peut basculer vers le rôle de requête | `"refuse"` : fait échouer le démarrage. `"ignore"` : ne signale rien. |

Les formes fonctionnelles de `requestRole` et `identity` ne sont acceptées que dans le bloc `rls` propre au pilote, qui prend en charge les mêmes paramètres. `policyTarget`, `adminPolicies` et `defaultPolicies` modifient le SQL des stratégies que `rebase db generate` génère, et la CLI ne peut pas lire le code du pilote ; définissez-les donc sur la déclaration ou dans l'environnement. Un démarrage qui ne les trouve que dans le code du pilote refusera de se lancer.

Au démarrage, la ligne qui indique comment les requêtes sont isolées liste chaque paramètre qui n'est pas à sa valeur par défaut. Un paramètre qui vous délègue une tâche, comme `grants: "none"`, précise une fois de quelle tâche il s'agit.

Le premier démarrage avec provisionnement enregistre le ou les rôles de requête dans `rebase.schema_meta`. Un démarrage ultérieur configuré avec un rôle différent refuse de se lancer et indique la commande permettant de migrer la base de données, ci-dessous. Sans cette vérification, l'ancien rôle conserverait ses privilèges tandis qu'un nouveau serait configuré à ses côtés.

## Recettes

### Un cluster partagé avec d'autres applications ou projets

Attribuez à chaque projet, et à chaque déploiement partageant un cluster, son propre rôle :

```bash
REBASE_RLS_REQUEST_ROLE=acme_prod_user
```

Une base de données qui a déjà tourné avec `rebase_user` l'enregistre ; commencez donc par la migrer :

```bash
rebase db request-role migrate --to acme_prod_user --dry-run
rebase db request-role migrate --to acme_prod_user
```

La commande crée le nouveau rôle s'il est manquant, réattribue dans cette base de données uniquement chaque privilège détenu par l'ancien rôle (tables, colonnes, séquences, schémas, fonctions, privilèges par défaut définis par cette connexion et appartenances), redirige les stratégies qui nomment l'ancien rôle et enregistre le nouveau rôle. Elle s'exécute en une seule transaction. L'ancien rôle est laissé tel quel, car une autre base de données du cluster peut encore l'utiliser. Lorsqu'elle se termine, elle affiche les instructions `REVOKE` qui révoquent les privilèges de l'ancien rôle dans cette base de données, à exécuter dès que plus rien ici n'en a besoin. `--dry-run` affiche les mêmes instructions et ne modifie rien. Dans un terminal, elle demande confirmation avant de s'exécuter ; sans terminal, elle refuse de s'exécuter sans `--yes`.

Définissez ensuite `REBASE_RLS_REQUEST_ROLE` sur chaque serveur utilisant la base de données.

`rebase doctor --database` signale également si chaque rôle sur le cluster peut se connecter à la base de données, avec la commande `REVOKE CONNECT … FROM PUBLIC` qui permet de l'empêcher. Rebase n'exécute pas cela lui-même sur une base de données dont il n'est pas propriétaire.

### Supabase

Un schéma Supabase existant possède déjà `anon` et `authenticated`, ainsi que des stratégies écrites pour eux avec `auth.uid()`. Pour que ces stratégies s'appliquent sans modification aux requêtes de Rebase :

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

- `requestRole` exécute les appelants sans session sous `anon` et toute personne connectée (invités inclus) sous `authenticated`.
- `identity: "supabase"` définit les paramètres `request.jwt.*` que lit `auth.uid()`. Sans eux, chaque test `auth.uid() = owner_id` échoue, ou réussit alors qu'il ne le devrait pas.
- `policyTarget: "requestRole"` empêche les propres stratégies de Rebase de s'appliquer aux sessions qui ne sont pas des requêtes Rebase, telles que celles de l'API Data de Supabase.

Comme les requêtes s'exécutent directement en tant que `anon` et `authenticated`, les stratégies écrites `TO anon` ou `TO authenticated` s'appliquent telles quelles, et `inheritRoles` n'est pas nécessaire. Cette option s'adresse à un projet dont les requêtes s'exécutent sous un rôle propre, par exemple `requestRole: "acme_user", inheritRoles: ["authenticated"]`. Avec une paire `{ anonymous, signedIn }`, il n'est accordé qu'au rôle connecté, jamais au rôle anonyme.

Les privilèges par défaut standards de Supabase accordent les tables créées dans `public` à `anon` et `authenticated` ; vérifiez ceux de votre projet. Exécutez `rebase doctor --database` et `rls-check` après le premier démarrage pour voir ce à quoi ces rôles peuvent accéder.

### Un autre outil est propriétaire du schéma et l'application applique le contrôle d'accès

Certaines bases de données n'ont pas à être sécurisées par Rebase. Alembic, Prisma ou un DBA détient la propriété des tables, rien n'y active la sécurité au niveau des lignes, et l'application décide elle-même qui voit quoi : seul le personnel peut se connecter, des hooks vérifient chaque écriture, une portée (scope) contrôle chaque route. Un démarrage qui ne provisionne rien (`REBASE_PROVISION=false`, `REBASE_MIGRATE_ON_BOOT=none`) retient chacune de ces tables par défaut (`503 TABLE_WITHHELD`), car Postgres livrerait chaque ligne à chaque appelant connecté.

Indiquez que l'application applique elle-même le contrôle d'accès, pour l'ensemble de la base de données :

```ts
// backend/resources.ts
export const main = database({ rls: { required: false } });
```

ou pour une table :

```ts
export const invoices = defineTable("invoices", {
    columns: { id: col.uuid().primaryKey().defaultRandom(), total: col.numeric() },
    rls: "admin-only",
    rlsRequired: false
});
```

Les tables sont alors desservies quel que soit l'état du catalogue, et le démarrage les mentionne dans un avertissement unique. La présence de `rlsRequired: true` sur une table la maintient obligatoire au sein d'une base de données indiquant `required: false`. Rien ne change dans la base de données : un démarrage avec provisionnement active toujours la sécurité au niveau des lignes et écrit les stratégies déclarées, et `rebase doctor` continue de signaler les tables comme non protégées.

Avec la sécurité au niveau des lignes désactivée, le `rls` déclaré n'est pas appliqué par Postgres : `"admin-only"` n'empêche pas un utilisateur connecté non-administrateur d'y accéder. Conservez la connexion, les rôles et les hooks pour effectuer ce travail.

### Un administrateur de base de données crée les rôles

Lorsque la connexion ne peut pas créer de rôles, ou que les rôles sont gérés dans Terraform :

```bash
REBASE_RLS_PROVISION_ROLE=never
```

Le démarrage vérifie alors le rôle et l'appartenance et échoue en affichant le SQL à exécuter, au lieu de tenter de les créer. Pour transmettre ce SQL à l'administrateur au préalable :

```bash
rebase db provision --print > request-role.sql
```

La commande affiche, pour chaque rôle de requête, les instructions qui le créent (`NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT`), accordent au rôle de connexion le droit de basculer vers lui (`WITH SET TRUE, INHERIT FALSE` sur PostgreSQL 16 et plus récent), et lui accordent les schémas selon `grants: "schema"`. Les explications sont rédigées sous forme de commentaires SQL, de sorte que le fichier peut être exécuté tel quel. Elle lit le rôle de connexion depuis la base de données et n'exécute rien d'autre. Chaque instruction peut être réexécutée en toute sécurité.

### Requêtes admin et `rebase_admin`

Postgres combine les stratégies permissives qui s'appliquent à un rôle avec l'opérateur OR. Écrite avec `TO public`, la référence que comporte chaque table (`rebase.uid() IS NULL OR` le rôle `admin`) s'appliquerait également aux utilisateurs connectés, et un OR dont l'autre branche est constante pour l'ensemble de l'instruction ne peut pas utiliser d'index : la liste ou le décompte d'un utilisateur limité à ses propres éléments analyserait toute la table (table scan). Ainsi, les stratégies que seuls le contexte du serveur ou un administrateur peuvent valider sont écrites `TO rebase_admin`, et n'atteignent jamais le plan d'exécution de la requête d'un utilisateur.

La table des utilisateurs fait exception. Auth la lit et l'écrit dans le contexte serveur avec le rôle même de la connexion, qui ne bascule pas vers `rebase_admin` : ses politiques restent donc `TO public` quel que soit le réglage, et derrière un rôle de connexion qui ne possède pas la table, l'inscription et la connexion fonctionnent quand même.

`rebase_admin` ne détient aucun privilège et ne peut pas se connecter. Un appelant détenant le rôle `admin`, y compris via `rebase.dataAsAdmin`, s'exécute en tant que `<request role>_admin` (`rebase_user_admin` par défaut), qui hérite du rôle de requête et de `rebase_admin`. Une connexion qui est elle-même soumise à la sécurité au niveau des lignes hérite de `rebase_admin` pour le contexte serveur. Le démarrage crée tout cela lorsque la connexion a le droit de créer des rôles. Avec `provisionRole: "never"`, créez-les vous-même :

```sql
CREATE ROLE rebase_admin NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
CREATE ROLE rebase_user_admin NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
GRANT rebase_user, rebase_admin TO rebase_user_admin WITH INHERIT TRUE, SET FALSE;
GRANT rebase_user_admin TO <connection role> WITH SET TRUE, INHERIT FALSE;
```

Sur PostgreSQL 15 et versions antérieures, créez `rebase_user_admin` avec `INHERIT` et omettez les options `WITH`. Dans les cas où `rebase_admin` ne peut pas être créé du tout, le démarrage et `rebase db push` écrivent ces stratégies `TO public`, comme c'était le cas auparavant, et les administrateurs continuent de s'exécuter sous le rôle de requête. `rebase doctor --database` indique la situation dans laquelle vous vous trouvez.

#### Les lectures admin utilisent les index du propriétaire

Une stratégie qui n'est pas une constante empêche Postgres d'utiliser un index pour un opérateur qui n'est pas étanche (leakproof), tel que `&&` sur un tableau, `~` ou un opérateur jsonb. Sans l'étape ci-dessous, la requête `tags && $1` d'un administrateur parcourait toute la table, là où la même requête exécutée en tant que propriétaire utilisait l'index GIN. Cela concernait `rebase.sqlAsAdmin`, `rebase.dataAsAdmin` ainsi que les utilisateurs administrateurs.

Le démarrage associe donc à chaque stratégie réservée aux administrateurs (que tout administrateur valide) une stratégie associée `TO rebase_admin_request USING (true)`, nommée `<policy>_ar_<hash>`. Pour une requête admin, Postgres simplifie les stratégies à `true` et planifie la requête comme il le ferait pour le propriétaire. Les stratégies restrictives s'appliquent toujours. Seuls les rôles `<request role>_admin` peuvent détenir `rebase_admin_request`. À chaque démarrage, Rebase vérifie quels rôles détiennent ses privilèges. Si un autre rôle soumis à la sécurité au niveau des lignes les détient, le démarrage n'écrit aucune stratégie associée et supprime celles qu'il trouve. Les stratégies associées nécessitent PostgreSQL 16 ou ultérieur, car sur la version 15 et les versions antérieures, la connexion hériterait du rôle. Seul le démarrage les écrit. `policies.sql` et les migrations n'en créent jamais, mais elles suppriment la stratégie associée de chaque stratégie réécrite qui n'en justifie plus une. `rebase db push` et `rebase db migrate` suppriment également toute stratégie associée dont la règle a disparu. Une règle d'administration restreinte ou supprimée cesse ainsi d'admettre chaque administrateur, même lorsque le démarrage ne provisionne rien. Avec `provisionRole: "never"`, créez le rôle vous-même :

```sql
CREATE ROLE rebase_admin_request NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
GRANT rebase_admin_request TO rebase_user_admin WITH INHERIT TRUE, SET FALSE;
```

Avant de rétrograder vers une version antérieure à celle qui a introduit les stratégies associées, rendez-les inactives. Un runtime plus ancien ne les connaît pas et n'en supprimera jamais aucune ; une règle modifiée ultérieurement laisserait donc sa stratégie associée continuer d'admettre chaque administrateur à toutes les lignes. Une seule instruction par rôle de requête admin permet de faire en sorte qu'aucune stratégie associée n'admette qui que ce soit :

```sql
REVOKE rebase_admin_request FROM rebase_user_admin;
```

Ou supprimez-les : chaque stratégie dont le nom se termine par `_ar_` suivi de huit caractères hexadécimaux, et dont le rôle est `rebase_admin_request`.

### Un schéma `public` partagé

Lorsque `public` contient des tables auxquelles Rebase ne doit pas accéder :

```bash
REBASE_RLS_GRANTS=managed
```

Rebase n'accorde alors au rôle de requête des privilèges que sur les tables qu'il dessert : les tables déclarées, les tables de jonction et ses propres tables sécurisées par RLS. Il ne définit aucun privilège par défaut dans les schémas partagés et ne révoque rien de ce qui a déjà été accordé. `rebase doctor --database` liste les tables présentes dans les schémas de Rebase qu'il ne dessert pas.

Une autre solution consiste à utiliser un schéma propre à Rebase : définissez `schema` sur chaque `defineTable`.

## Fournisseurs

Ce que le rôle de connexion peut faire varie selon les fournisseurs et détermine si Rebase peut créer lui-même le rôle de requête. Les remarques ci-dessous correspondent à ce que nous prévoyons ; vérifiez-les auprès de votre fournisseur.

| Fournisseur | Rôle de connexion habituel | Remarques |
|---|---|---|
| Supabase | `postgres` (non superutilisateur, possède CREATEROLE) | Une seule base de données par projet. `anon`, `authenticated` et `authenticator` existent, avec des privilèges par défaut dans `public`. Voir la recette Supabase ci-dessus. |
| Neon | le propriétaire du projet, membre de `neon_superuser` | Les rôles appartiennent à une branche, et chaque base de données sur une branche les partage. Deux bases de données Rebase dans un même projet Neon partagent `rebase_user` ; définissez donc `requestRole` par base de données. |
| AWS RDS / Aurora | l'utilisateur maître (master user), membre de `rds_superuser` | Possède CREATEROLE mais n'est pas superutilisateur. Les instances sont souvent partagées entre applications. |
| Google Cloud SQL | `postgres`, membre de `cloudsqlsuperuser` | Comme RDS. |
| Azure Flexible Server | l'utilisateur administrateur, membre de `azure_pg_admin` | Comme RDS. |
| InstaPods | `instapod` ; superutilisateur via `sudo -u postgres` | [Le guide InstaPods](/docs/deployment/instapods/) crée le rôle au préalable. |
| Hostman | `gen_user` ; CREATE ROLE accordé depuis le panneau de gestion | Non disponible sur l'offre d'entrée de gamme. [Le guide Hostman](/docs/deployment/hostman/) crée le rôle au préalable. |

## Voir aussi

- [Commandes de base de données](/docs/cli/database/) : `rebase db request-role` et `rebase db provision`
- [Référence de la CLI](/docs/cli/#rebase-doctor) : `rebase doctor --database`
- [rls-check](/docs/rls-check/) : auditer les stratégies sur n'importe quel Postgres
- [Règles de sécurité (RLS)](/docs/collections/security-rules/) : les stratégies écrites par Rebase pour chaque table
