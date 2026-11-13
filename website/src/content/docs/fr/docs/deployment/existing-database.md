---
sourceHash: 3bff62ceb5aceb62
title: Exécution sur une base de données existante ou partagée
sidebar_label: Base de données existante ou partagée
description: Exécutez Rebase sur une base de données PostgreSQL qu'il ne possède pas — un cluster partagé avec d'autres applications, un second projet Rebase, Supabase, ou une base de données verrouillée par un DBA — grâce aux paramètres rls, rebase doctor --database et rebase db request-role migrate.
---

## Le problème

Rebase exécute chaque requête authentifiée et anonyme sous un rôle Postgres
restreint unique, `rebase_user`, et laisse la sécurité au niveau des lignes (RLS)
décider des lignes visibles par cette requête. Le rôle de connexion est
propriétaire des tables et contourne la RLS ; chaque requête bascule vers
`rebase_user` au sein de sa transaction.

Cela fonctionne sur une base de données dont Rebase a l'entière propriété :
Rebase Cloud, la configuration Docker générée par `rebase init`, la base de
données de développement gérée. Cela repose sur deux hypothèses :

1. Seul le serveur de ce projet peut devenir `rebase_user`.
2. Seuls `rebase_user` et le propriétaire de la table touchent aux tables de Rebase.

Une base de données déjà exploitée par ailleurs enfreint souvent ces deux règles :

- **Les rôles appartiennent à l'ensemble du cluster, pas à une seule base de données.** Deux
  projets Rebase sur un même cluster partagent le même `rebase_user`. Par défaut, chaque rôle
  peut se connecter à chaque base de données, et n'importe qui peut définir les paramètres
  de session que lisent les stratégies de Rebase ; ainsi, la connexion du projet A peut
  ouvrir la base de données du projet B, basculer vers `rebase_user` et valider les
  stratégies de B en tant qu'administrateur de B.
- **Les privilèges couvrent des schémas entiers.** Par défaut, Rebase accorde au rôle
  de requête les droits `SELECT, INSERT, UPDATE, DELETE` sur chaque table de `public`
  sur laquelle il peut accorder des droits, y compris les tables appartenant à une autre application.
- **Les stratégies par défaut s'appliquent `TO public`.** La stratégie de référence que Rebase
  ajoute à chaque table autorise toute session n'ayant jamais défini l'identité Rebase.
  C'est ainsi que passent les propres requêtes du serveur, mais cela autorise également tout
  autre rôle détenant un privilège sur la table, tel que le rôle `anon` de Supabase via son
  API Data.
- **Les stratégies existantes basées sur les rôles ne s'appliquent jamais.** Une stratégie
  rédigée avec `TO authenticated` ne s'applique pas à `rebase_user`, car `rebase_user` n'hérite
  pas des privilèges des autres rôles.
- **Certaines bases de données ne permettent pas du tout à l'application de créer des rôles.** Un
  DBA crée chaque rôle manuellement, ou les rôles sont gérés dans Terraform.

Chacun de ces cas dispose d'un paramètre. Par défaut, chaque paramètre correspond au
comportement standard de Rebase en son absence, de sorte qu'un projet qui ne configure rien
se comporte exactement comme avant.

## Vérifier d'abord la base de données

```bash
rebase doctor --database
```

Cette commande lit le catalogue de la base de données du projet et ne modifie rien. Elle
indique :

- si chaque rôle de requête existe, s'il est restreint, et si cette connexion peut basculer
  vers lui ;
- les autres rôles de connexion (login) qui peuvent basculer vers le rôle de requête ;
- si chaque rôle sur le cluster peut se connecter à cette base de données ;
- les tables situées dans les schémas de Rebase que Rebase ne dessert pas ;
- les autres rôles détenant des privilèges sur les tables de Rebase ;
- les stratégies sur les tables de Rebase écrites avec `TO` pour un rôle dont le rôle de
  requête n'hérite pas ;
- les privilèges par défaut qui attribuent les nouvelles tables à d'autres rôles.

Chaque constat est accompagné du code SQL à exécuter en tant qu'administrateur de base
de données, du paramètre permettant d'adapter Rebase à la base de données, ou des deux.
La commande renvoie le code de sortie 1 en cas d'échec, ce qui permet de bloquer un
déploiement. Elle vérifie la base de données par rapport aux paramètres visibles : les
variables `REBASE_RLS_*`, puis les rôles de requête enregistrés dans la base lors du
démarrage du serveur.

`npx @rebasepro/rls-check` audite les stratégies elles-mêmes, sur n'importe quel Postgres.
Sur une base de données Rebase, il lit le rôle de requête de la même manière ; spécifiez-le
avec `--request-role` lorsqu'il n'est pas encore enregistré.

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

Ou depuis l'environnement, qui prévaut sur la déclaration. L'environnement est recommandé
pour une valeur qui diffère entre deux déploiements du même code, comme le nom de rôle
lorsque la préproduction et la production partagent un cluster.

| Paramètre | Variable d'environnement | Valeur par défaut | Alternatives |
|---|---|---|---|
| `requestRole` | `REBASE_RLS_REQUEST_ROLE` (un seul nom) | `"rebase_user"` | Tout nom de rôle. `{ anonymous, signedIn }` pour exécuter les appelants sans session sous un rôle et les appelants connectés sous un autre. Dans le code du pilote, une fonction de l'identité de la requête. |
| `requestRoles` | aucune | dérivé de `requestRole` | Chaque rôle qu'un `requestRole` sous forme de fonction peut renvoyer, afin que chacun puisse être provisionné, recevoir des privilèges et être vérifié. Requis avec une fonction. |
| `provisionRole` | `REBASE_RLS_PROVISION_ROLE` | `"auto"` : crée le rôle s'il est manquant et accorde à cette connexion le droit de basculer vers lui | `"never"` : le rôle et l'appartenance sont gérés par vous. Le démarrage vérifie les deux et échoue en affichant le SQL à exécuter. |
| `grants` | `REBASE_RLS_GRANTS` | `"schema"` : chaque table et séquence dans les schémas desservis par Rebase sur lesquelles la connexion peut accorder des droits, plus les privilèges par défaut pour les tables créées ultérieurement | `"managed"` : uniquement les tables desservies par Rebase, et aucun privilège par défaut. `"none"` : Rebase n'accorde rien ; une table pour laquelle vous n'avez pas accordé de droits est refusée. |
| `policyTarget` | `REBASE_RLS_POLICY_TARGET` | `"public"` | `"requestRole"` : les stratégies permissives s'appliquent uniquement au(x) rôle(s) de requête. Les stratégies restrictives continuent de s'appliquer à tout le monde. |
| `adminPolicies` | `REBASE_RLS_ADMIN_POLICIES` | `"adminRole"` : les stratégies que seuls le contexte serveur ou un administrateur peuvent valider (la référence, `roles: ["admin"]`) sont rédigées avec `TO rebase_admin`, et les requêtes administrateur s'exécutent en tant que `<request role>_admin` | `"public"` : ces stratégies sont définies avec `TO public` et les administrateurs s'exécutent sous le rôle de requête, comme avant l'existence de ce paramètre. |
| `defaultPolicies` | `REBASE_RLS_DEFAULT_POLICIES` | `true` | `false` : aucune table ne reçoit la référence serveur-ou-administrateur. La configuration propre d'une table avec `defaultPolicies: false` reste prioritaire pour celle-ci. |
| `inheritRoles` | aucune | `[]` | Rôles accordés au rôle de requête avec `WITH INHERIT TRUE`, afin que les stratégies rédigées avec `TO` à leur intention s'appliquent. Avec une paire de rôles de requête `{ anonymous, signedIn }`, seul le rôle connecté les reçoit ; avec une fonction, le paramètre est refusé. PostgreSQL 16 et versions supérieures ; refusé sur la version 15 et les versions antérieures. |
| `identity` | `REBASE_RLS_IDENTITY` (formes nommées) | `"rebase"` : `app.uid`, `app.user_roles`, `app.is_anonymous`, `app.jwt` | `"supabase"` : également `request.jwt.claims`, `request.jwt.claim.sub` et `request.jwt.claim.role`, pour que `auth.uid()` et `auth.jwt()` identifient l'appelant. Dans le code du pilote, une fonction renvoyant des paramètres supplémentaires. Les paramètres `app.*` sont toujours définis. |
| `sharedRole` | `REBASE_RLS_SHARED_ROLE` | `"warn"` lorsqu'un autre rôle de connexion peut basculer vers le rôle de requête | `"refuse"` : faire échouer le démarrage. `"ignore"` : ne rien afficher. |

Les formes fonctionnelles de `requestRole` et `identity` sont acceptées uniquement dans
le bloc `rls` propre au pilote, qui accepte les mêmes paramètres. `policyTarget`,
`adminPolicies` et `defaultPolicies` modifient le SQL des stratégies généré par `rebase db
generate`, et la CLI ne peut pas lire le code du pilote ; définissez-les donc sur la
déclaration ou dans l'environnement. Un démarrage qui ne les trouve que dans le code du
pilote refuse de démarrer.

Au démarrage, la ligne qui indique comment les requêtes sont isolées liste chaque paramètre
qui n'est pas à sa valeur par défaut. Un paramètre qui vous délègue une tâche, comme
`grants: "none"`, indique une fois de quelle tâche il s'agit.

Le premier démarrage de provisionnement enregistre le ou les rôles de requête dans
`rebase.schema_meta`. Un démarrage ultérieur configuré avec un rôle différent refuse de
démarrer et indique la commande permettant de migrer la base de données, détaillée ci-dessous.
Sans cette vérification, l'ancien rôle conserverait ses privilèges tandis qu'un nouveau
serait configuré à ses côtés.

## Recettes

### Un cluster partagé avec d'autres applications ou projets

Attribuez à chaque projet, et à chaque déploiement partageant un cluster, son propre
rôle :

```bash
REBASE_RLS_REQUEST_ROLE=acme_prod_user
```

Une base de données qui s'est déjà exécutée sous `rebase_user` l'enregistre ; commencez
donc par la migrer :

```bash
rebase db request-role migrate --to acme_prod_user --dry-run
rebase db request-role migrate --to acme_prod_user
```

La commande crée le nouveau rôle s'il est manquant, réattribue dans cette base de
données uniquement chaque privilège détenu par l'ancien rôle (tables, colonnes,
séquences, schémas, fonctions, les privilèges par défaut définis par cette connexion
et les appartenances), redirige les stratégies qui désignent l'ancien rôle, et enregistre
le nouveau rôle. Elle s'exécute dans une seule transaction. L'ancien rôle reste inchangé,
car une autre base de données sur le cluster peut encore l'utiliser. Une fois terminée,
elle affiche les instructions `REVOKE` qui révoquent les privilèges de l'ancien rôle
dans cette base de données, à exécuter dès que plus rien n'en a besoin ici. `--dry-run`
affiche les mêmes instructions et ne modifie rien. Dans un terminal, la commande
demande confirmation avant d'être exécutée ; sans terminal, elle refuse de s'exécuter
sans `--yes`.

Définissez ensuite `REBASE_RLS_REQUEST_ROLE` sur chaque serveur qui utilise la base de
données.

`rebase doctor --database` signale également si chaque rôle sur le cluster peut se
connecter à la base de données, avec la commande `REVOKE CONNECT … FROM PUBLIC`
permettant de l'empêcher. Rebase ne l'exécute pas de lui-même sur une base de données
qu'il ne possède pas.

### Supabase

Un schéma Supabase existant contient déjà `anon` et `authenticated`, ainsi que des
stratégies écrites pour ces rôles avec `auth.uid()`. Pour que ces stratégies s'appliquent
sans modification aux requêtes de Rebase :

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

- `requestRole` exécute les appelants sans session sous `anon` et tous les utilisateurs
  connectés (invités compris) sous `authenticated`.
- `identity: "supabase"` définit les paramètres `request.jwt.*` que lit `auth.uid()`.
  Sans eux, chaque test `auth.uid() = owner_id` échoue, ou réussit alors qu'il ne le
  devrait pas.
- `policyTarget: "requestRole"` empêche les propres stratégies de Rebase de s'appliquer
  aux sessions qui ne sont pas des requêtes Rebase, comme l'API Data de Supabase.

Comme les requêtes s'exécutent directement en tant que `anon` et `authenticated`, les
stratégies écrites avec `TO anon` ou `TO authenticated` s'appliquent telles quelles,
et `inheritRoles` n'est pas nécessaire. Ce dernier est destiné à un projet dont les
requêtes s'exécutent sous un rôle propre, comme `requestRole: "acme_user",
inheritRoles: ["authenticated"]`. Avec une paire `{ anonymous, signedIn }`, il n'est
accordé qu'au rôle connecté, jamais au rôle anonyme.

Les privilèges par défaut standards de Supabase ont accordé les tables créées dans
`public` à `anon` et `authenticated` ; vérifiez ceux de votre projet. Exécutez `rebase
doctor --database` et `rls-check` après le premier démarrage pour voir à quoi ces rôles
ont accès.

### Un administrateur de base de données crée les rôles

Lorsque la connexion ne peut pas créer de rôles, ou que les rôles sont gérés dans Terraform :

```bash
REBASE_RLS_PROVISION_ROLE=never
```

Le démarrage vérifie alors le rôle et l'appartenance et échoue en affichant le SQL à
exécuter, au lieu de tenter de les créer. Pour transmettre ce code SQL à l'administrateur
à l'avance :

```bash
rebase db provision --print > request-role.sql
```

Cette commande affiche, pour chaque rôle de requête, les instructions qui le créent
(`NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT`), accordent au rôle de connexion le droit
de basculer vers lui (`WITH SET TRUE, INHERIT FALSE` sur PostgreSQL 16 et versions
supérieures), et lui accordent les schémas selon `grants: "schema"`. Les explications
sont rédigées sous forme de commentaires SQL, de sorte que le fichier peut être exécuté
tel quel. Elle lit le rôle de connexion depuis la base de données et n'exécute rien d'autre.
Chaque instruction peut être réexécutée en toute sécurité.

### Requêtes administrateur et `rebase_admin`

Postgres combine les stratégies permissives applicables à un rôle avec un OR. Rédigée
avec `TO public`, la référence présente sur chaque table (`rebase.uid() IS NULL OR`
le rôle `admin`) s'appliquerait également aux utilisateurs connectés, et un OR dont
l'autre branche est constante pour l'ensemble de l'instruction ne peut pas utiliser
d'index : un listage ou un comptage limité au propriétaire pour un utilisateur entraînerait
un balayage complet (scan) de la table. Les stratégies que seuls le contexte serveur ou un
administrateur peuvent valider sont donc rédigées avec `TO rebase_admin`, et n'apparaissent
jamais dans le plan d'exécution d'un utilisateur.

`rebase_admin` ne détient aucun privilège et ne peut pas se connecter. Un appelant détenant
le rôle `admin`, y compris `rebase.dataAsAdmin`, s'exécute en tant que `<request role>_admin`
(`rebase_user_admin` par défaut), qui hérite du rôle de requête et de `rebase_admin`. Une
connexion elle-même soumise à la sécurité au niveau des lignes hérite de `rebase_admin`
pour le contexte serveur. Le démarrage crée tout cela lorsque la connexion a le droit de
créer des rôles. Sous `provisionRole: "never"`, créez-les vous-même :

```sql
CREATE ROLE rebase_admin NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
CREATE ROLE rebase_user_admin NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
GRANT rebase_user, rebase_admin TO rebase_user_admin WITH INHERIT TRUE, SET FALSE;
GRANT rebase_user_admin TO <connection role> WITH SET TRUE, INHERIT FALSE;
```

Sur PostgreSQL 15 et versions antérieures, créez `rebase_user_admin` avec `INHERIT` et
omettez les options `WITH`. Si `rebase_admin` ne peut pas être créé du tout, le démarrage
et `rebase db push` écrivent ces stratégies avec `TO public`, comme c'était le cas
auparavant, et les administrateurs continuent de s'exécuter sous le rôle de requête.
`rebase doctor --database` indique la situation de votre base.

#### Les lectures administrateur utilisent les index du propriétaire

Une stratégie qui n'est pas constante empêche Postgres d'utiliser un index pour un
opérateur qui n'est pas étanche (leakproof), comme `&&` sur un tableau, `~` ou un
opérateur jsonb. Sans l'étape ci-dessous, la requête `tags && $1` d'un administrateur
balayait toute la table, alors que la même requête exécutée par le propriétaire utilisait
l'index GIN. Cela concernait aussi bien `rebase.sqlAsAdmin`, `rebase.dataAsAdmin` que
les utilisateurs administrateurs.

Le démarrage attribue donc à chaque stratégie réservée aux administrateurs (que chaque
administrateur valide) une stratégie associée (companion) `TO rebase_admin_request USING (true)`,
nommée `<policy>_ar_<hash>`. Pour une requête administrateur, Postgres réduit les stratégies
à `true` et planifie la requête comme il le ferait pour le propriétaire. Les stratégies
restrictives s'appliquent toujours. Seuls les rôles `<request role>_admin` peuvent détenir
`rebase_admin_request`. À chaque démarrage, Rebase vérifie quels rôles détiennent ses
privilèges. Si un autre rôle soumis à la sécurité au niveau des lignes les détient, le
démarrage n'écrit aucun companion et supprime tous ceux qu'il trouve. Les companions
nécessitent PostgreSQL 16 ou plus récent, car sur la version 15 et les versions antérieures,
la connexion hériterait du rôle. Seul le démarrage les écrit. `policies.sql` et les
migrations n'en créent jamais, mais ils suppriment le companion de toute stratégie
réécrite qui n'en justifie plus. `rebase db push` et `rebase db migrate` suppriment
également tout companion dont la règle a disparu. Une règle d'administration restreinte ou
supprimée cesse donc d'autoriser tous les administrateurs, même lorsque le démarrage ne
provisionne rien. Sous `provisionRole: "never"`, créez le rôle vous-même :

```sql
CREATE ROLE rebase_admin_request NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
GRANT rebase_admin_request TO rebase_user_admin WITH INHERIT TRUE, SET FALSE;
```

Avant de revenir à une version antérieure à celle qui a introduit les companions,
désactivez-les. Un runtime plus ancien ne les reconnaît pas et n'en supprimera aucun,
de sorte qu'une règle que vous modifieriez ultérieurement laisserait son companion
autoriser chaque administrateur sur chaque ligne. Une seule instruction par rôle de
requête d'administration permet de faire en sorte que chaque companion n'admette personne :

```sql
REVOKE rebase_admin_request FROM rebase_user_admin;
```

Ou supprimez-les : chaque stratégie dont le nom se termine par `_ar_` suivi de huit
caractères hexadécimaux, et dont le rôle est `rebase_admin_request`.

### Un schéma `public` partagé

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Lorsque `public` contient des tables auxquelles Rebase ne devrait pas accéder :

```bash
REBASE_RLS_GRANTS=managed
```

Rebase accorde alors au rôle de requête des droits uniquement sur les tables qu'il dessert :
les tables déclarées, les tables de jonction et ses propres tables sécurisées au niveau des
lignes. Il ne définit aucun privilège par défaut dans les schémas partagés et ne révoque
rien de ce qui a déjà été accordé. `rebase doctor --database` répertorie les tables situées
dans les schémas de Rebase qu'il ne dessert pas.

Une autre solution consiste à utiliser un schéma propre à Rebase : définissez `schema` sur
chaque `defineTable`.

## Fournisseurs

Ce que le rôle de connexion peut faire varie selon les fournisseurs, et détermine si
Rebase peut créer lui-même le rôle de requête. Les remarques ci-dessous correspondent à
ce que nous prévoyons ; vérifiez-les auprès de votre fournisseur.

| Fournisseur | Rôle de connexion habituel | Remarques |
|---|---|---|
| Supabase | `postgres` (n'est pas superutilisateur, possède CREATEROLE) | Une base de données par projet. `anon`, `authenticated` et `authenticator` existent, avec des privilèges par défaut dans `public`. Voir la recette Supabase ci-dessus. |
| Neon | le propriétaire du projet, membre de `neon_superuser` | Les rôles appartiennent à une branche, et chaque base de données sur une branche les partage. Deux bases de données Rebase dans un même projet Neon partagent `rebase_user` ; définissez donc `requestRole` par base de données. |
| AWS RDS / Aurora | l'utilisateur principal (master user), membre de `rds_superuser` | Possède CREATEROLE mais n'est pas superutilisateur. Les instances sont souvent partagées entre plusieurs applications. |
| Google Cloud SQL | `postgres`, membre de `cloudsqlsuperuser` | Comme RDS. |
| Azure Flexible Server | l'utilisateur administrateur, membre de `azure_pg_admin` | Comme RDS. |
| InstaPods | `instapod` ; superutilisateur via `sudo -u postgres` | [Le guide InstaPods](/docs/deployment/instapods/) crée le rôle au préalable. |
| Hostman | `gen_user` ; CREATE ROLE accordé depuis le panneau d'administration | Non disponible sur l'offre d'entrée de gamme. [Le guide Hostman](/docs/deployment/hostman/) crée le rôle au préalable. |

## Voir aussi

- [Commandes de base de données](/docs/cli/database/) : `rebase db request-role` et
  `rebase db provision`
- [Référence de la CLI](/docs/cli/#rebase-doctor) : `rebase doctor --database`
- [rls-check](/docs/rls-check/) : auditer les stratégies sur n'importe quel Postgres
- [Règles de sécurité (RLS)](/docs/collections/security-rules/) : les stratégies que
  Rebase écrit pour chaque table
