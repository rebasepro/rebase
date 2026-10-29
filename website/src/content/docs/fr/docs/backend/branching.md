---
sourceHash: 297a89400496895a
title: Branches de base de données
sidebar_label: Branches
description: Créez des branches de base de données isolées pour le développement, le staging et les tests à l'aide de CREATE DATABASE ... TEMPLATE de PostgreSQL — des copies instantanées et parfaitement fidèles, sans temps d'arrêt.
---

## Vue d'ensemble

La création de branches de base de données vous permet de créer des **copies instantanées et isolées** de l'intégralité de votre base de données (schéma et données) afin d'effectuer en toute sécurité des développements, des tests de migration et des procédures d'assurance qualité (QA). 

En tirant parti des templates natifs de PostgreSQL, Rebase provisionne des bases de données clonées au niveau du système de fichiers. Vous obtenez ainsi une réplique parfaitement fidèle contenant l'ensemble des tables, index, types personnalisés, contraintes et politiques de sécurité au niveau des lignes (RLS), sans aucune surcharge de transfert réseau ni délai d'initialisation du schéma.

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

## Fonctionnement interne : les templates PostgreSQL

Lorsqu'une branche de base de données est créée, le `BranchService` de Rebase exécute le code SQL suivant :

```sql
CREATE DATABASE "rb_feature_auth" TEMPLATE "rebase";
```

PostgreSQL traite cette opération en copiant les répertoires sous-jacents du système de fichiers contenant les fichiers de la base de données source. Cela offre :
- **Clones quasi-instantanés** : Aucune génération de SQL ni aucun chargement de données n'est effectué.
- **Schémas et données identiques** : Chaque ligne, index et contrainte est dupliqué instantanément.
- **Isolation complète** : La modification du schéma ou l'insertion d'enregistrements dans la branche n'a aucun impact sur la base de données source.

### Gestion de la limitation des connexions

PostgreSQL exige qu'**aucune autre connexion active** n'existe sur la base de données modèle (source) lors de l'exécution d'une commande `CREATE DATABASE ... TEMPLATE`.

Pour éviter les échecs, le `DatabasePoolManager` de Rebase exécute un processus d'éviction actif avant de cloner ou de supprimer une branche :
1. **Boucle d'éviction** : Il ferme et déconnecte automatiquement tous les pools inactifs pointant vers la base de données ciblée dans le contexte de l'application Rebase.
2. **Blocage par des connexions externes** : Si des clients externes (tels que DBeaver, pgAdmin ou des processus backend externes) maintiennent des transactions actives sur la base de données source, PostgreSQL rejettera l'opération de template avec l'erreur `"being accessed by other users"`.

L'erreur indique clairement ce qui est connecté au lieu de vous laisser deviner :

```
Cannot create branch: the source database "leadgen" has active connections.
  Connected right now:
    2 × psql
  A running `rebase dev` is the usual one — stop it, or re-run with --force to
  disconnect them for you.
```

`--force` met fin à ces sessions avant l'opération de template, aussi bien lors de `create` que de `delete`. Il ne met jamais fin à la session qui exécute la commande elle-même.

`create --force`
ferme aussi la source aux nouvelles connexions pendant la copie
(`ALTER DATABASE … ALLOW_CONNECTIONS false`, exécuté depuis la base de données `postgres`
du serveur) et la rouvre ensuite : en cas d'échec, et sur tout signal qu'elle peut
intercepter (fermeture du terminal, Ctrl-C, SIGTERM, SIGQUIT). Tuée net (SIGKILL), elle laisse la
source fermée jusqu'à la prochaine commande `rebase db branch`, quelle qu'elle soit, qui la rouvre
d'abord et le signale ; `ALTER DATABASE "<db>" ALLOW_CONNECTIONS true`, exécuté depuis la base de
données `postgres`, fait la même chose à la main. Tant qu'une création forcée tient sa source
fermée, elle détient sur celle-ci un verrou consultatif (advisory lock) dans la base de données
`postgres`, de sorte que la réouverture laisse tranquille la source d'une copie en cours, et
qu'une seconde création forcée depuis la même source attend que la première se termine. Un client
qui se reconnecte dès qu'il est déconnecté, comme le fait un `rebase dev` en cours d'exécution,
ne peut alors plus se glisser à nouveau avant le début de la copie. Cela exige les droits du
propriétaire de la source ; sans eux, et pour `delete`, `--force` déconnecte les sessions jusqu'à
trois fois avant d'abandonner. Quand une session est encore là après cela, l'erreur dit qu'elles
se sont reconnectées et qu'il faut les arrêter, et non de repasser `--force`. En 0.24, il les
déconnectait une seule fois, et environ un `create --force` sur sept sous un `rebase dev` en
cours d'exécution échouait en conseillant de relancer avec `--force`.

`DatabasePoolManager` déconnecte ses propres pools inactifs avant de cloner ou de supprimer — mais uniquement les pools **au sein du processus qui effectue le travail**. `rebase db branch` s'exécute en tant que processus distinct, cela ne touche donc à rien d'autre sur votre machine :

- **Une instance de `rebase dev` en cours d'exécution bloque la création de branches.** C'est le cas le plus fréquent, et non un cas particulier : vouloir une branche et faire tourner l'application arrivent généralement au même moment. Arrêtez le serveur de développement, créez la branche, puis redémarrez-le.
- **Tout autre client également.** DBeaver, pgAdmin, une session `psql`, une seconde instance de l'application — PostgreSQL rejette l'opération avec `is being accessed by other users` et ces connexions doivent être fermées manuellement.

Il n'y a aucun moyen de contourner cela dans PostgreSQL lui-même ; `CREATE DATABASE ... TEMPLATE` est une copie au niveau du système de fichiers et le modèle doit rester inactif pendant toute la durée de l'opération.

---

## Schéma des métadonnées

Les configurations de branche sont stockées dans la base de données par défaut sous la table `rebase.branches`, qui est provisionnée lors de l'initialisation :

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

Un serveur qui s'exécute sur une branche conserve les branches dans la base de données à partir de laquelle la branche a été copiée. Le `rebase.branches` propre à la branche n'est qu'un instantané, pris avant que sa ligne ne soit écrite. Ainsi, `rebase dev` dans un espace de travail [basculé](#intégration-cli) définit `REBASE_BRANCH_PARENT_DATABASE` sur la base de données que nomme `.env`, et un serveur doté de cette variable lit et écrit le registre dans celle-ci, et copie par défaut les nouvelles branches à partir d'elle. Sur une branche, le panneau Branches de Studio liste les branches de la base de données principale, y compris la branche courante, et une branche créée depuis ce panneau apparaît dans `rebase db branch list`.

---

## API programmatique

L'API de gestion des branches est exposée via le `BranchService` du backend. Vous trouverez ci-dessous la référence de l'interface principale :

### Créer une branche de base de données

Génère une nouvelle base de données de branche à partir de la base de données par défaut ou d'un template source explicite.

La base par défaut est celle sur laquelle se trouve la connexion propre du serveur, ou `REBASE_BRANCH_PARENT_DATABASE` lorsque le serveur s'exécute sur une branche. Ce n'est jamais la base de données que nomme `ADMIN_CONNECTION_STRING`, lorsque celle-ci en désigne une autre.

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

`database` est la base de données PostgreSQL que constitue la branche, telle que l'indique son enregistrement : celle à laquelle se connecter, et celle à passer comme `source` pour copier la branche. Ce n'est pas le nom de la branche (`staging` correspond à la base de données `rb_staging`).

### Obtenir des informations sur une branche

Récupère les métadonnées d'une branche spécifique. Si la branche existe, le service tente d'interroger son utilisation actuelle sur le disque physique :

```typescript
const info = await admin.getBranchInfo("feature_oauth");
```

### Supprimer une branche

Supprime la base de données cible du serveur et nettoie son enregistrement dans la table de métadonnées `rebase.branches`.

```typescript
await admin.deleteBranch("feature_oauth");
```

> [!CAUTION]
> Protection de sécurité : La base de données principale (nom de la base configuré par défaut dans les chaînes de connexion) est protégée. Il s'agit de la base de données sur laquelle se trouve la connexion propre du serveur, ou de `REBASE_BRANCH_PARENT_DATABASE` sur une branche. Si vous tentez de supprimer la base de données parente, le `BranchService` lève une erreur `"Cannot delete the main database"` et s'interrompt.

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

`switch` est ce qui rend une branche utilisable. Il enregistre la branche dans `.rebase/branch.json` — un nom, jamais une chaîne de connexion, de sorte que vos identifiants restent uniquement dans `.env` — et chaque commande `rebase` dans cet espace de travail résout alors la base de données de la branche à la place : `dev`, `db push`, `db migrate`, `db backup`.
Un `rebase dev` déjà en cours d'exécution garde la base de données sur laquelle il a démarré jusqu'à ce
que vous le redémarriez, et `switch` le signale.

`rebase db branch list`
marque la branche sur laquelle se trouve cet espace de travail, et `prune` ne la supprime jamais,
pas plus que `delete` n'accepte de le faire : le plan la liste comme conservée, et dit de la quitter
d'abord avec `rebase db branch switch --off`. En 0.24, `prune --older-than … --yes` la supprimait,
et l'espace de travail faisait alors pointer chaque commande vers une base de données qui
n'existait plus.

Il s'intercale entre le shell et le fichier de projet dans l'ordre de résolution :

1. `--database-url` sur la ligne de commande
2. `DATABASE_URL` dans l'environnement du shell
3. **la branche sur laquelle cet espace de travail est basculé**
4. `DATABASE_URL` dans le fichier `.env` du projet
5. `--docker`, ou le dernier `rebase dev` lancé avec cette option
6. la base de données de développement gérée

Le cinquième rang suit
le dernier `rebase dev --docker` : une commande de branche lancée après lui n'a donc
pas besoin de son propre `--docker`, et un `--docker` qu'un rang supérieur écarte ne
démarre aucun conteneur et signale qu'il a été ignoré. En 0.24, seule l'option
compte, et une option écartée démarre quand même le conteneur.

Une branche doit avoir la priorité sur `.env`, sinon le basculement n'aurait aucun effet sur un projet qui définit `DATABASE_URL` ; elle ne doit pas avoir la priorité sur les deux éléments supérieurs, car une option sur la ligne de commande est une instruction plus immédiate qu'un basculement effectué hier.

`.rebase/` est ignoré par Git, donc la branche sur laquelle vous vous trouvez est propre à votre machine et ne concerne jamais le projet lui-même.

Sur un espace de travail basculé,
`rebase db branch create`, `list`, `info`, `delete` et `prune` opèrent sur la base de données principale,
là où se trouve le registre, et l'indiquent. `create` copie toujours la branche sur laquelle vous êtes, sauf
si vous passez `--from` ; elle est enregistrée dans la base de données principale, donc `list` la montre
depuis n'importe quel espace de travail. Avant la 0.25, seul `list` le faisait, et une branche créée depuis
un espace de travail basculé n'était enregistrée que dans le snapshot de la branche.

Les branches sont des bases de données PostgreSQL ordinaires nommées d'après la branche avec un préfixe `rb_` ; ainsi, `dev_sandbox` ci-dessus correspond à la base de données `rb_dev_sandbox` sur le même serveur.

Créer une branche ne modifie **pas** la base de données avec laquelle votre projet communique. `rebase db branch create` effectue la copie et s'arrête là ; rien n'est écrit dans `.env`, et le prochain `rebase dev` utilisera toujours la base de données qu'il utilisait auparavant. Pour travailler sur une branche, basculez dessus avec `rebase db branch switch <name>`, comme ci-dessus. Pour l'atteindre depuis tout ce qui n'est pas une commande `rebase`, sa chaîne de connexion est celle que vous avez déjà, avec le nom de la base de données remplacé :

```bash
postgresql://user:pass@localhost:5432/rb_dev_sandbox
```

---

## Examiner et fusionner une branche

Une branche est l'endroit où un agent, ou une migration dont vous n'êtes pas sûr, peut modifier une base de données sans toucher à la vraie. Avant que quoi que ce soit n'atteigne la base dont la branche a été créée, vous pouvez voir ce qui a changé et le fusionner depuis [Studio](/docs/studio/) : ouvrez **Branches** et choisissez-en une.

- **Schéma et politiques RLS** liste chaque table, colonne, clé primaire,
  contrainte (unique, clé étrangère, check, exclusion), index, trigger, politique,
  type enum (avec ses libellés), vue et fonction que la branche a ajoutés, supprimés ou
  modifiés, en SQL, avec la définition du parent à côté de celle de la branche.
- **Modifications des données** compte, par table, les lignes que la branche a insérées, mises à jour et supprimées, appariées par clé primaire, et en montre jusqu'à 100 par table (au
  plus 1 000 si vous en demandez davantage) avec les colonnes qui ont changé. Une colonne
  nommée comme un identifiant secret — `password_hash`, un `*_token`, tout ce qui contient
  `secret`, un `*_hash` — affiche `[redacted]` au lieu de sa valeur.

Examiner une branche exige la portée `database:write`, celle qui exécute du SQL en tant que
propriétaire de la base de données : les échantillons sont des lignes des deux bases, lues en dehors de la
sécurité au niveau des lignes. `database:read` liste les branches mais ne lit pas leurs
lignes.

Le même diff est `rebase db branch diff <name>` dans un terminal, `GET /api/admin/branches/<name>/diff` en HTTP, l'outil MCP `rebase_db_branch_diff` et `admin.diffBranch(name)` dans le code. Les tables propres à Rebase (sessions, historique, le registre des branches) sont laissées de côté.

### Quel côté a modifié une ligne

Le parent continue de recevoir des écritures pendant qu'on travaille sur la branche, donc « les deux bases diffèrent » ne veut pas dire « la branche l'a modifié » : une ligne que le parent a insérée après la création de la branche ressemble exactement à une ligne que la branche a supprimée. Rebase les distingue par le moment où chaque ligne a été écrite. Les identifiants de transaction appartiennent au serveur, pas à une base, et la copie par template les conserve : une ligne écrite après la création de la branche — d'un côté comme de l'autre — est plus récente que la transaction qui a créé la base de la branche. Cette transaction est lue lorsque
la branche est créée et conservée dans son enregistrement : un `GRANT` ou un
`ALTER DATABASE` ultérieur sur la base de la branche ne la déplace donc pas.

| La ligne de la branche | La ligne du parent | Comptée comme |
| --- | --- | --- |
| écrite depuis la bifurcation | absente | insérée par la branche |
| absente | d'avant la bifurcation | supprimée par la branche |
| écrite depuis la bifurcation | d'avant la bifurcation | mise à jour par la branche |
| d'avant la bifurcation, ou absente | écrite depuis la bifurcation, ou absente | changement du parent : conservé |
| écrite depuis la bifurcation | écrite depuis la bifurcation | un **conflit** |

Deux cas se ressemblent et sont lus de la façon qui ne perd rien : une ligne que la branche a supprimée et que le parent a modifiée ensuite est conservée, et une ligne que le parent a supprimée et que la branche a modifiée ensuite est une insertion de la branche. Un `UPDATE` qui écrit les valeurs qu'une ligne avait déjà compte quand même comme une écriture.

Une branche créée avant que Rebase ne conserve cette transaction la lit dans la ligne `pg_database`
de la base de la branche telle qu'elle est maintenant ; tout ce qui a réécrit la ligne depuis
la déplace. Quand le point de bifurcation ne peut pas être lu du tout — une branche ancienne
dont la ligne a été gelée par un vacuum — le diff le signale et compte chaque différence comme venant de
la branche.

### Ce que fait une fusion

**Fusionner** écrit dans le parent les lignes que la branche a insérées, mises à jour et supprimées. Ce qui l'emporte :

- **Les lignes que seule la branche a modifiées** sont écrites : insérées, écrasées ou supprimées.
- **Les lignes que seul le parent a modifiées** depuis la création de la branche restent exactement telles quelles
  — sauf si l'une référence une ligne que la branche a supprimée, ce qui est un
  conflit (ci-dessous).
- **Les lignes modifiées des deux côtés** sont des conflits. Par défaut, la fusion n'écrit alors rien du tout ; choisissez `onConflict: "branch"` pour écrire la ligne de la branche par-dessus celle du parent, ou `"target"` pour garder celle du parent.
- **Une ligne que la branche a supprimée et que des lignes plus récentes du parent référencent encore** est
  aussi un conflit. Supposons que la branche ait supprimé un auteur et que le parent ait écrit depuis
  un article de cet auteur : supprimer l'auteur sur le parent se propagerait en cascade à
  cet article, mettrait sa colonne à null, ou échouerait sur la clé étrangère. Le diff compte
  l'auteur comme un conflit et nomme les lignes qui le référencent (`referencedBy` : la
  table, la clé étrangère, son `ON DELETE` et le nombre de lignes). Par défaut, la
  fusion refuse, en nommant la table, les lignes et la façon d'en sortir ; `"target"` garde
  l'auteur, et avec lui l'article ; `"branch"` supprime l'auteur, laisse la clé
  étrangère faire ce qu'elle dit, et liste ce qu'elle a atteint dans `warnings`.
- **Les modifications de schéma et de politiques ne sont jamais fusionnées.** Elles relèvent de vos collections et de leurs migrations : appliquez-les avec `rebase db push` (ou `migrate`), puis fusionnez les lignes.

Une table dont les lignes ne peuvent pas être appariées bloque la fusion : une table que la branche a ajoutée ou supprimée, dont les colonnes ou la clé primaire diffèrent entre les deux, sans clé primaire, ou avec plus de 100 000 lignes d'un côté. Ses compteurs valent 0, car on ne sait pas quelles lignes ont changé ; `rowCounts` donne le nombre
de lignes de chaque côté. Une telle table que seul le parent a modifiée — la branche n'a écrit aucune
de ses lignes, et celles d'avant la bifurcation sont identiques — n'est pas bloquée.
Passez `skipBlocked` (dans Studio, cochez **Fusionner les autres tables**) pour fusionner le
reste et laisser celles-ci tranquilles.

Une table réécrite depuis la création de la branche est bloquée aussi (`TABLE_REWRITTEN`).
Un changement de type de colonne, un `ADD COLUMN` avec une valeur par défaut volatile, `VACUUM FULL` ou
`CLUSTER` réécrit chaque ligne, de sorte que chaque ligne apparaît comme écrite depuis et que l'on ne peut plus
dire quel côté a changé quoi. Quand la branche a changé le type d'une colonne, fusionnez ses lignes
avant d'appliquer ce changement au parent, ou recréez la branche après celui-ci.

Toutes les écritures se font en une seule instruction sur le parent — tout ou rien, clés étrangères vérifiées à la fin. Une fusion transmet le `fingerprint` du diff que vous avez examiné et n'écrit rien si l'une des deux bases a changé depuis : rechargez le diff et regardez à nouveau. Les séquences sont avancées au-delà de tout id que la fusion a inséré.

```typescript
const diff = await admin.diffBranch("agent_run_17");
// …review diff.schema and diff.data…
const result = await admin.mergeBranch("agent_run_17", {
    expectedFingerprint: diff.fingerprint,
    onConflict: "abort" // or "branch", or "target"
});
```

La fusion n'est volontairement pas un outil MCP : un agent propose sur sa branche, et une personne fusionne.

---

## Le branching nécessite un véritable serveur PostgreSQL

Le branching ne fonctionne **pas** avec la base de données de développement gérée — la base PGlite sans configuration que `rebase dev` démarre lorsqu'un projet n'a pas de `DATABASE_URL`.

PGlite ne dessert qu'une seule base de données. Exécuter `CREATE DATABASE ... TEMPLATE` dessus écrit une entrée dans le catalogue et ne copie rien, de sorte que la « branche » pointe vers la base de données à partir de laquelle elle a été clonée : les écritures que vous croyez isolées atterrissent dans votre base de données de développement, et il n'existe aucune seconde copie vers laquelle revenir.

Utilisez le branching avec un véritable serveur — votre propre instance PostgreSQL via `DATABASE_URL`, ou `rebase dev --docker`, que les commandes de branche suivent alors.

---

## Bonnes pratiques et limitations

### Utilisation de l'espace disque
Étant donné que PostgreSQL duplique les fichiers sur le disque, chaque branche consomme un espace équivalent à celui de la base de données source. Si vous disposez d'une base de données de production de 100 Go, créer 5 branches consommera 500 Go de stockage supplémentaire. 
* *Recommandation* : Utilisez des sous-ensembles de bases de données ou des templates de développement légers comme sources de clonage plutôt que des clones complets de production.

`rebase db branch prune` est la commande permettant de récupérer cet espace :

```bash
rebase db branch prune                      # orphans only — always safe
rebase db branch prune --older-than 2w      # and anything older than two weeks
```

Rien n'expire sauf si vous le demandez : une branche peut être la seule copie d'un après-midi de travail, donc `--older-than` est optionnel et les durées sont arrondies à l'inférieur. De plus, la commande affiche son plan d'action et demande confirmation avant de supprimer quoi que ce soit, sauf si vous passez l'option `--yes`.

`prune` détecte également les deux cas où les branches dérivent de leurs métadonnées : une entrée dont la base de données a été supprimée via du simple SQL (ce que `list` continuerait de rapporter indéfiniment), et une base de données de branche dont l'entrée n'a jamais été enregistrée (un crash survenu entre les deux instructions exécutées par `create`). Les bases de données de travail `<db>_dev_diff` d'Atlas sont signalées en parallèle mais ne sont supprimées qu'avec `--include-dev-diff` : ce ne sont pas des branches, et l'une d'entre elles pourrait appartenir à un `db push` en cours d'exécution.

### Compatibilité avec pgBouncer
Lors d'un déploiement derrière pgBouncer ou des gestionnaires de pools de connexions, assurez-vous que le pooler prend en charge les opérations administratives sur la base de données. La création et la suppression de bases de données contournent les pools standards au niveau transactionnel et nécessitent des connexions directes au serveur Postgres (avec des privilèges utilisateur élevés) via la configuration `adminConnectionString`.

### Requêtes inter-bases de données
Dans la mesure où les branches sont des bases de données PostgreSQL distinctes, vous ne pouvez pas effectuer de jointures SQL (`JOIN`) entre différentes branches. Toutes les relations doivent être confinées au périmètre de la seule base de données de branche active.


## Ressources associées

- [Commandes de base de données](/docs/cli/database/#rebase-db-branch) — `rebase db branch` et ses options
- [Génération de schéma](/docs/cli/schema/) — comment est généré le schéma qu'une branche copie
- [Environnement et configuration](/docs/getting-started/configuration/) — `DATABASE_URL`, et ordre de priorité d'une branche active
