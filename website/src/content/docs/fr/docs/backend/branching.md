---
sourceHash: f9ad18cf03580c13
title: Branching de base de données
sidebar_label: Branching
description: Créez des branches de base de données isolées pour le développement, le staging et les tests à l'aide de CREATE DATABASE ... TEMPLATE de PostgreSQL — des copies instantanées et fidèles à 100 % sans interruption de service.
---

## Vue d'ensemble

Le branching de base de données vous permet de créer des **copies instantanées et isolées** de l'ensemble de votre base de données (schéma et données) afin d'effectuer en toute sécurité des développements, des tests de migration et des procédures d'assurance qualité (QA). 

En s'appuyant sur les modèles (templates) natifs de PostgreSQL, Rebase provisionne des bases de données clones au niveau du système de fichiers. Cela signifie que vous obtenez un réplica d'une fidélité absolue contenant l'ensemble des tables, index, types personnalisés, contraintes et politiques de sécurité au niveau des lignes (Row-Level Security, RLS), sans aucune surcharge de transfert réseau ni délai de configuration du schéma.

```
                  ┌────────────────────────┐
                  │ Production DB (rebase) │
                  └───────────┬────────────┘
                              │
               (CREATE DATABASE ... TEMPLATE)
                              │
            ┌─────────────────┴─────────────────┐
            ▼                                   ▼
┌───────────────────────┐           ┌───────────────────────┐
│ rb_feature_auth (Dev) │           │ rb_staging (Staging)  │
└───────────────────────┘           └───────────────────────┘
```

---

## Sous le capot : les modèles PostgreSQL

Lorsqu'une branche de base de données est créée, le `BranchService` de Rebase exécute le SQL suivant :

```sql
CREATE DATABASE "rb_feature_auth" TEMPLATE "rebase";
```

PostgreSQL traite cette opération en copiant les répertoires sous-jacents du système de fichiers contenant les fichiers de la base de données source. Cela offre :
- **Des clones en moins d'une seconde** : aucune génération SQL ni aucun chargement de données n'est effectué.
- **Schémas et données identiques** : chaque ligne, index et contrainte est dupliqué instantanément.
- **Isolation complète** : la modification du schéma ou l'insertion d'enregistrements dans la branche n'a aucun impact sur la base de données source.

### Protection contre la limitation des connexions

PostgreSQL exige qu'**aucune autre connexion active** n'existe sur la base de données modèle (source) lors de l'exécution d'une commande `CREATE DATABASE ... TEMPLATE`.

Pour éviter les échecs, le `DatabasePoolManager` de Rebase exécute un processus d'éviction active avant de cloner ou de supprimer une branche :
1. **Boucle d'éviction** : il ferme et déconnecte automatiquement tous les pools inactifs pointant vers la base de données ciblée au sein du contexte applicatif de Rebase.
2. **Blocage des connexions externes** : si des clients externes (tels que DBeaver, pgAdmin ou des processus backend externes) maintiennent des transactions actives sur la base de données source, PostgreSQL rejettera l'opération de templating avec une erreur `"being accessed by other users"`.

L'échec indique explicitement ce qui est connecté plutôt que de vous laisser deviner :

```
Cannot create branch: the source database "leadgen" has active connections.
  Connected right now:
    2 × psql
  A running `rebase dev` is the usual one — stop it, or re-run with --force to
  disconnect them for you.
```

`--force` met fin à ces sessions avant le templating, aussi bien sur `create` que sur `delete`. Il ne met jamais fin à la session qui exécute la commande elle-même.

`create --force`
ferme également la source aux nouvelles connexions pendant la copie
(`ALTER DATABASE … ALLOW_CONNECTIONS false`, exécuté depuis la base de données
`postgres` du serveur) et la rouvre ensuite : en cas d'échec, ainsi que sur tout signal
qu'il peut intercepter (fermeture du terminal, Ctrl-C, SIGTERM, SIGQUIT). Tué brutalement
(SIGKILL), il laisse la source fermée jusqu'à la prochaine commande `rebase db branch`,
quelle qu'elle soit, qui la rouvre au préalable en le signalant ;
`ALTER DATABASE "<db>" ALLOW_CONNECTIONS true`, exécuté depuis la base de données
`postgres`, fait la même chose manuellement. Pendant qu'une création forcée maintient sa source fermée,
elle conserve un verrou consultatif (advisory lock) sur celle-ci dans la base de données `postgres`, de sorte que la réouverture
ne perturbe pas la source d'une copie en cours, et qu'une seconde création forcée depuis la même
source attende que la première se termine. Un client
qui se reconnecte dès qu'il est déconnecté, comme le fait un `rebase dev` en cours d'exécution,
ne peut alors pas se réinsérer avant le début de la copie. Cela nécessite d'être le propriétaire de la source ;
sans cela, et lors d'un `delete`, `--force` déconnecte les sessions jusqu'à trois
fois avant d'abandonner. Si une session est toujours présente après cela, l'erreur
indique qu'elle s'est reconnectée et qu'il faut l'arrêter, et non de réexécuter avec `--force`.

`DatabasePoolManager` déconnecte ses propres pools inactifs avant de cloner ou de supprimer — mais uniquement les pools **à l'intérieur du processus effectuant l'opération**. `rebase db branch` s'exécute dans son propre processus, cela n'affecte donc rien d'autre sur votre machine :

- **Un `rebase dev` en cours d'exécution bloque le branching.** C'est le cas le plus fréquent, et non un cas marginal : vouloir créer une branche et faire tourner l'application arrivent généralement au même moment. Arrêtez le serveur de développement, créez la branche, puis redémarrez-le.
- **Tout autre client fait de même.** DBeaver, pgAdmin, une session `psql`, une deuxième instance d'application — PostgreSQL rejette l'opération avec `is being accessed by other users` et ces connexions doivent être fermées manuellement.

Il n'existe aucun moyen de contourner cela dans PostgreSQL lui-même ; `CREATE DATABASE ... TEMPLATE` est une copie au niveau du système de fichiers et le modèle doit rester inactif pendant toute l'opération.

---

## Schéma des métadonnées

Les configurations de branche sont stockées dans la base de données par défaut sous la table `rebase.branches`, qui est provisionnée lors de l'initialisation (bootstrapping) :

```sql
CREATE SCHEMA IF NOT EXISTS rebase;

CREATE TABLE IF NOT EXISTS rebase.branches (
    name         TEXT PRIMARY KEY,              -- Branch name as given (letters, digits, underscores, hyphens)
    db_name      TEXT NOT NULL UNIQUE,          -- Actual PostgreSQL database name (prefixed with 'rb_')
    parent_db    TEXT NOT NULL,                 -- Source database cloned from
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata     JSONB DEFAULT '{}'
);
```

Un serveur fonctionnant sur une branche conserve les branches dans la base de données à partir de laquelle la branche a été
copiée. La table `rebase.branches` propre à la branche n'est qu'un instantané (snapshot), pris avant
que sa ligne ne soit écrite. Ainsi, `rebase dev` sur un checkout [basculé](#intégration-cli)
définit `REBASE_BRANCH_PARENT_DATABASE` sur la base de données désignée par `.env`, et un serveur
avec cette variable lit et écrit le registre à cet endroit, et copie par défaut les nouvelles branches
depuis celle-ci. Le volet Branches de Studio sur une branche liste les branches de la base de données
principale, y compris l'actuelle, et une branche créée ici apparaît dans
`rebase db branch list`.

---

## API programmatique

L'API de branching est exposée via le `BranchService` du backend. Vous trouverez ci-dessous une référence de l'interface principale :

### Créer une branche de base de données

Génère une nouvelle base de données de branche à partir de la base de données par défaut ou d'un modèle source explicite.

Par défaut, il s'agit de la base de données sur laquelle se trouve la propre connexion du serveur, ou
de `REBASE_BRANCH_PARENT_DATABASE` lorsque le serveur s'exécute sur une branche. Il ne s'agit jamais
de la base de données désignée par `ADMIN_CONNECTION_STRING`, lorsque celle-ci est différente.

```typescript no-verify
import { initializeRebaseBackend } from "@rebasepro/server";

const backend = await initializeRebaseBackend({ /* ... */ });
const admin = backend.driver.admin;

// Create a branch from the default database
const newBranch = await admin.createBranch("feature_oauth");

// Create a branch from a specific staging database
const stagingBranch = await admin.createBranch("pr_review_42", { 
    source: "rb_staging" 
});
```

### Lister les branches actives

Récupère la liste des branches enregistrées ainsi que leurs tailles physiques obtenues via la fonction système PostgreSQL `pg_database_size`.

```typescript
const branches = await admin.listBranches();
/*
Output:
[
  {
    name: "feature_oauth",
    database: "rb_feature_oauth",
    parentDatabase: "rebase",
    createdAt: 2026-06-20T22:00:00.000Z,
    sizeBytes: 83886080 // 80 MB
  }
]
*/
```

`database` est la base de données PostgreSQL correspondant à la branche, comme l'indique son enregistrement :
ce à quoi se connecter, et ce qu'il faut passer comme `source` pour copier la branche. Il ne s'agit pas
du nom de la branche (`staging` correspond à la base de données `rb_staging`).

### Obtenir les informations d'une branche

Récupère les métadonnées d'une seule branche. Si la branche existe, le service tente d'interroger son utilisation actuelle de l'espace disque physique :

```typescript
const info = await admin.getBranchInfo("feature_oauth");
```

### Supprimer une branche

Supprime la base de données cible du serveur et nettoie son enregistrement dans la table de métadonnées `rebase.branches`.

```typescript
await admin.deleteBranch("feature_oauth");
```

> [!CAUTION]
> Garde-fou de sécurité : la base de données principale (nom de base de données par défaut configuré dans les chaînes de connexion) est protégée. Il s'agit de la base de données sur laquelle se trouve la connexion propre du serveur, ou de `REBASE_BRANCH_PARENT_DATABASE` sur une branche. Si vous tentez de supprimer la base de données parente, le `BranchService` renvoie une erreur `"Cannot delete the main database"` et s'interrompt.

---

## Intégration CLI

Les branches de base de données peuvent être gérées directement à l'aide de la CLI Rebase.

```bash
# Create a new branch named 'dev_sandbox'
rebase db branch create dev_sandbox

# Clone from a database other than the default
rebase db branch create pr_review_42 --from rb_staging

# List all branches and disk utilization
rebase db branch list

# Work on it — every later command in this checkout uses it
rebase db branch switch dev_sandbox

# Which branch am I on?
rebase db branch switch

# Back to the main database
rebase db branch switch --off

# Show one branch's parent, age and size
rebase db branch info dev_sandbox

# What the branch changed: schema, RLS policies and rows (--json for all of it)
rebase db branch diff dev_sandbox

# Delete a branch
rebase db branch delete dev_sandbox
```

`switch` est ce qui rend une branche utilisable. Il enregistre la branche dans
`.rebase/branch.json` — un simple nom, jamais une chaîne de connexion, de sorte que vos identifiants
restent uniquement dans `.env` — et chaque commande `rebase` dans ce checkout résout
ensuite la base de données de la branche à la place : `dev`, `db push`, `db migrate`, `db backup`.
Un `rebase dev` déjà en cours d'exécution conserve la base de données sur laquelle il a démarré jusqu'à
ce que vous le redémarriez, ce que `switch` signale.

`rebase db branch
list` marque la branche sur laquelle se trouve ce checkout, et `prune` ne la supprime jamais, tout comme
`delete` refuse de le faire : le plan l'indique comme conservée, et invite à la quitter d'abord avec
`rebase db branch switch --off`.

Il s'insère entre le shell et le fichier de projet dans l'ordre de résolution :

1. `--database-url` sur la ligne de commande
2. `DATABASE_URL` dans l'environnement du shell
3. **la branche sur laquelle ce checkout a basculé**
4. `DATABASE_URL` dans le fichier `.env` du projet
5. `--docker`, ou le fait que le dernier `rebase dev` ait tourné avec celui-ci
6. la base de données de développement gérée

Le niveau 5 suit le
dernier `rebase dev --docker`, de sorte qu'une commande de branche exécutée après n'a pas besoin de son propre
`--docker`, et un `--docker` surpassé par un niveau supérieur ne démarre aucun conteneur et
signale qu'il a été ignoré.

Une branche doit avoir priorité sur `.env`, sinon le basculement n'aurait aucun effet sur tout projet qui
définit `DATABASE_URL` ; elle ne doit pas avoir priorité sur les deux niveaux supérieurs, car une option sur cette
ligne de commande constitue une instruction plus immédiate qu'un basculement effectué hier.

`.rebase/` est ignoré par git, donc la branche sur laquelle vous vous trouvez est propre à votre machine
et ne concerne jamais le projet dans son ensemble.

Sur un checkout
basculé, `rebase db branch create`, `list`, `info`, `delete` et `prune` opèrent
sur la base de données principale, où se trouve le registre, et le précisent. `create` copie
toujours la branche sur laquelle vous êtes sauf si vous passez `--from` ; elle est enregistrée dans la base
de données principale, de sorte que `list` l'affiche depuis n'importe quel checkout.

Les branches sont des bases de données PostgreSQL ordinaires nommées d'après la branche avec un préfixe `rb_`, ainsi `dev_sandbox` ci-dessus correspond à la base de données `rb_dev_sandbox` sur le même serveur.

Créer une branche ne change **pas** la base de données avec laquelle votre projet communique. `rebase db branch create` effectue la copie et s'arrête là ; rien n'est écrit dans `.env`, et le prochain `rebase dev` utilisera toujours la base de données qu'il utilisait auparavant. Pour travailler sur une branche, basculez dessus avec `rebase db branch switch <name>`, comme indiqué plus haut. Pour y accéder depuis tout ce qui n'est pas une commande `rebase`, sa chaîne de connexion est celle que vous possédez déjà en remplaçant simplement le nom de la base de données :

```bash
postgresql://user:pass@localhost:5432/rb_dev_sandbox
```

---

## Examiner et fusionner une branche

Une branche est l'endroit où un agent, ou une migration dont vous n'êtes pas certain, peut modifier une
base de données sans toucher à la vraie. Avant que quoi que ce soit n'atteigne la base de données
à partir de laquelle la branche a été créée, vous pouvez visualiser les modifications et la fusionner depuis
[Studio](/docs/studio/) : ouvrez **Branches** et sélectionnez-en une.

- **Schema & RLS policies** répertorie l'ensemble des tables, colonnes, clés primaires,
  contraintes (unicité, clé étrangère, check, exclusion), index, déclencheurs (triggers), politiques,
  types enum (avec leurs valeurs/labels), vues et fonctions que la branche a ajoutés, supprimés ou
  modifiés, sous forme de SQL, avec la définition du parent à côté de celle de la branche.
- **Data changes** comptabilise, par table, les lignes que la branche a insérées, mises à jour et
  supprimées, associées par clé primaire, et en affiche jusqu'à 100 par table (au
  maximum 1 000 lorsque vous en demandez plus) avec les colonnes modifiées. Une colonne
  dont le nom évoque un identifiant ou secret — `password_hash`, un `*_token`, tout élément contenant
  `secret`, un `*_hash` — affiche `[redacted]` à la place de sa valeur.

Examiner une branche nécessite la portée (scope) `database:write`, celle qui exécute du SQL en tant
que propriétaire de la base de données : les échantillons sont des lignes des deux bases de données, lues en dehors
de la sécurité au niveau des lignes. `database:read` liste les branches mais ne lit pas leurs
lignes.

Le même diff s'obtient avec `rebase db branch diff <name>` dans un terminal, `GET
/api/admin/branches/<name>/diff` via HTTP, l'outil MCP `rebase_db_branch_diff`,
et `admin.diffBranch(name)` dans le code. Les tables propres à Rebase (sessions,
historique, registre des branches) sont exclues.

### Quel côté a modifié une ligne

Le parent continue de recevoir des écritures pendant que l'on travaille sur la branche, donc « les deux
bases de données diffèrent » n'est pas équivalent à « la branche l'a modifié » : une ligne insérée
par le parent après la création de la branche ressemble exactement à une ligne supprimée par la branche.
Rebase les distingue grâce au moment où chaque ligne a été écrite. Les identifiants de transaction (xid) appartiennent
au serveur, et non à une seule base de données, et la copie de modèle les conserve ; ainsi, une ligne
écrite après la création de la branche — d'un côté comme de l'autre — est plus récente que la
transaction qui a créé la base de données de la branche. Cette transaction est lue lors de
la création de la branche et conservée dans son enregistrement, de sorte qu'un `GRANT` ou
`ALTER DATABASE` ultérieur sur la base de données de la branche ne la modifie pas.

| Ligne de la branche | Ligne du parent | Comptabilisée comme |
| --- | --- | --- |
| écrite depuis le fork | absente | insérée par la branche |
| absente | antérieure au fork | supprimée par la branche |
| écrite depuis le fork | antérieure au fork | mise à jour par la branche |
| antérieure au fork, ou absente | écrite depuis le fork, ou absente | modification du parent : conservée |
| écrite depuis le fork | écrite depuis le fork | un **conflit** |

Deux cas se ressemblent et sont interprétés de manière à ne rien perdre : une ligne supprimée
par la branche puis modifiée par le parent est conservée, et une ligne supprimée par le parent
puis modifiée par la branche est considérée comme une insertion de la branche. Un `UPDATE` qui réécrit
les valeurs qu'une ligne possédait déjà compte tout de même comme une écriture.

Une branche créée avant que Rebase ne conserve cette transaction la lit depuis la
ligne `pg_database` de la base de données de la branche telle qu'elle est actuellement ; tout ce qui a réécrit cette ligne depuis
la décale. Lorsque le point de bifurcation (fork) ne peut pas du tout être lu — par exemple une branche ancienne
dont la ligne a été figée (freeze) par un vacuum — le diff le signale, et comptabilise chaque différence comme
provenant de la branche.

### Ce que fait une fusion

**Merge** écrit sur le parent les lignes que la branche a insérées, mises à jour et supprimées.
Ce qui l'emporte :

- **Les lignes modifiées uniquement par la branche** sont appliquées : insérées, écrasées ou
  supprimées.
- **Les lignes modifiées uniquement par le parent** depuis la création de la branche sont laissées exactement en
  l'état — à moins que l'une d'elles ne référence une ligne supprimée par la branche, ce qui constitue un
  conflit (voir ci-dessous).
- **Les lignes modifiées par les deux** sont des conflits. Par défaut, la fusion n'écrit absolument
  rien ; choisissez `onConflict: "branch"` pour écraser la ligne du parent par celle de la
  branche, ou `"target"` pour conserver celle du parent.
- **Une ligne supprimée par la branche et toujours référencée par de nouvelles lignes du parent** constitue
  également un conflit. Supposons que la branche ait supprimé un auteur, et que le parent ait depuis
  enregistré un article rédigé par celui-ci : supprimer l'auteur sur le parent se répercuterait en cascade sur
  cet article, mettrait sa colonne à null, ou échouerait sur la clé étrangère. Le diff considère
  l'auteur comme un conflit et désigne les lignes qui le référencent (`referencedBy` : la
  table, la clé étrangère, son `ON DELETE` et le nombre de lignes). Par défaut, la
  fusion refuse l'opération, en nommant la table, les lignes et l'alternative possible ; `"target"` conserve
  l'auteur, et avec lui l'article ; `"branch"` supprime l'auteur, laisse la
  clé étrangère agir selon sa configuration, et liste les éléments affectés dans `warnings`.
- **Les modifications de schéma et de politiques ne sont jamais fusionnées.** Elles relèvent de vos
  définitions de tables et de leurs migrations : appliquez-les avec `rebase db push` (ou
  `migrate`), puis fusionnez les lignes.

Une table dont les lignes ne peuvent pas être mises en correspondance bloque la fusion : une table que la branche a ajoutée ou
supprimée, une table dont les colonnes ou la clé primaire diffèrent entre les deux, une table sans
clé primaire, ou une table contenant plus de 100 000 lignes d'un côté. Ses compteurs affichent 0,
car on ne sait pas quelles lignes ont changé ; `rowCounts` donne le nombre de lignes de
chaque côté. Une telle table qui n'a été modifiée que par le parent — la branche n'a écrit aucune
de ses lignes, et celles antérieures au fork sont identiques — n'est pas bloquée.
Passez `skipBlocked` (dans Studio, cochez **Merge the other tables**) pour fusionner le
reste et laisser celles-ci de côté.

Une table réécrite depuis la création de la branche est également bloquée (`TABLE_REWRITTEN`).
Un changement de type de colonne, un `ADD COLUMN` avec une valeur par défaut volatile, un `VACUUM FULL` ou
`CLUSTER` réécrit chaque ligne à neuf, si bien que chaque ligne apparaît comme écrite depuis et qu'il
n'est plus possible de savoir quel côté a modifié quoi. Lorsque la branche a modifié le type d'une
colonne, fusionnez ses lignes avant d'appliquer ce changement au parent, ou recréez la
branche après coup.

Chaque écriture s'effectue en une seule instruction sur le parent — tout est appliqué ou rien ne l'est,
les clés étrangères étant vérifiées à la fin. Une fusion transporte l'empreinte (`fingerprint`) du diff
que vous avez examiné, et n'écrit rien si l'une ou l'autre base de données a été modifiée depuis :
rechargez le diff et réexaminez-le. Les séquences sont avancées au-delà des identifiants (IDs) insérés par la fusion.

```typescript
const diff = await admin.diffBranch("agent_run_17");
// …review diff.schema and diff.data…
const result = await admin.mergeBranch("agent_run_17", {
    expectedFingerprint: diff.fingerprint,
    onConflict: "abort" // or "branch", or "target"
});
```

La fusion n'est délibérément pas proposée comme un outil MCP : un agent fait des propositions sur sa branche, et un
humain procède à la fusion.

---

## Le branching nécessite un véritable serveur PostgreSQL

Le branching ne fonctionne **pas** avec la base de données de développement gérée — la base PGlite sans configuration que `rebase dev` démarre lorsqu'un projet n'a pas de `DATABASE_URL`.

PGlite ne gère qu'une seule et unique base de données. L'exécution de `CREATE DATABASE ... TEMPLATE` sur celle-ci écrit une entrée de catalogue et ne copie rien, si bien que la « branche » pointe vers la base de données dont elle a été clonée : les écritures que vous croyez isolées atterrissent dans votre base de développement, et il n'y a pas de deuxième copie vers laquelle revenir en arrière.

Utilisez le branching avec un vrai serveur — votre propre PostgreSQL via `DATABASE_URL`, ou `rebase dev --docker`, que les commandes de branche suivront alors.

---

## Bonnes pratiques et limitations

### Utilisation de l'espace disque
Étant donné que PostgreSQL duplique les fichiers sur le disque, chaque branche consomme un espace équivalent à celui de la base de données source. Si vous avez une base de production de 100 Go, la création de 5 branches consommera 500 Go de stockage supplémentaire. 
* *Recommandation* : utilisez des bases de données restreintes (sous-ensembles) ou des modèles de développement légers comme sources de clonage plutôt que des clones complets de la production.

`rebase db branch prune` est la commande qui vous permet de récupérer cet espace :

```bash
rebase db branch prune                      # orphans only — always safe
rebase db branch prune --older-than 2w      # and anything older than two weeks
```

Rien n'expire sans que vous le demandiez : une branche peut être l'unique copie d'une après-midi
de travail, `--older-than` est donc optionnel (opt-in) et les durées sont arrondies vers le bas, la commande affichant son
plan et demandant confirmation avant de supprimer quoi que ce soit, sauf si vous passez `--yes`.

Prune détecte également les deux cas de désynchronisation des branches par rapport à leurs métadonnées — une entrée dont
la base de données a été supprimée avec du SQL brut (que `list` continuerait de signaler indéfiniment),
et une base de données de branche dont l'entrée n'a jamais été enregistrée (un crash entre les deux
instructions exécutées par `create`). Les bases de travail temporaires `<db>_dev_diff` d'Atlas sont signalées
en parallèle, mais supprimées uniquement avec `--include-dev-diff` : ce ne sont pas des branches, et
l'une d'elles peut être liée à un `db push` en cours d'exécution.

### Compatibilité avec pgBouncer
Lors d'un déploiement derrière pgBouncer ou des gestionnaires de pools de connexions, assurez-vous que le pooler prenne en charge les opérations administratives sur les bases de données. La création et la suppression de bases de données contournent les pools transactionnels classiques et nécessitent des connexions directes au serveur Postgres (avec des privilèges utilisateur élevés) via la configuration `adminConnectionString`.

### Requêtes inter-bases de données
Puisque les branches sont des bases de données PostgreSQL distinctes, vous ne pouvez pas exécuter de jointures SQL (`JOIN`) entre différentes branches. Toutes les relations doivent être confinées au périmètre de la seule base de données de branche active.


## Voir aussi

- [Commandes de base de données](/docs/cli/database/#rebase-db-branch) — `rebase db branch` et ses options
- [Génération de schéma](/docs/cli/schema/) — comment le schéma copié par une branche est généré
- [Environnement et configuration](/docs/getting-started/configuration/) — `DATABASE_URL`, et l'ordre de priorité d'une branche basculée
