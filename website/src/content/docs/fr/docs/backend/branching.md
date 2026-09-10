---
sourceHash: bba1fa1dd7f34bed
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
    name         TEXT PRIMARY KEY,              -- Sanitize user branch name (alphanumeric & underscores)
    db_name      TEXT NOT NULL UNIQUE,          -- Actual PostgreSQL database name (prefixed with 'rb_')
    parent_db    TEXT NOT NULL,                 -- Source database cloned from
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata     JSONB DEFAULT '{}'
);
```

---

## API programmatique

L'API de gestion des branches est exposée via le `BranchService` du backend. Vous trouverez ci-dessous la référence de l'interface principale :

### Créer une branche de base de données

Génère une nouvelle base de données de branche à partir de la base de données par défaut ou d'un template source explicite.

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
    parentDatabase: "rebase",
    createdAt: 2026-06-20T22:00:00.000Z,
    sizeBytes: 83886080 // 80 MB
  }
]
*/
```

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
> Protection de sécurité : La base de données principale (nom de la base configuré par défaut dans les chaînes de connexion) est protégée. Si vous tentez de supprimer la base de données parente, le `BranchService` lève une erreur `"Cannot delete the main database"` et s'interrompt.

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

# Delete a branch
rebase db branch delete dev_sandbox
```

`switch` est ce qui rend une branche utilisable. Il enregistre la branche dans `.rebase/branch.json` — un nom, jamais une chaîne de connexion, de sorte que vos identifiants restent uniquement dans `.env` — et chaque commande `rebase` dans cet espace de travail résout alors la base de données de la branche à la place : `dev`, `db push`, `db migrate`, `db backup`.

Il s'intercale entre le shell et le fichier de projet dans l'ordre de résolution :

1. `--database-url` sur la ligne de commande
2. `DATABASE_URL` dans l'environnement du shell
3. **la branche sur laquelle cet espace de travail est basculé**
4. `DATABASE_URL` dans le fichier `.env` du projet

Une branche doit avoir la priorité sur `.env`, sinon le basculement n'aurait aucun effet sur un projet qui définit `DATABASE_URL` ; elle ne doit pas avoir la priorité sur les deux éléments supérieurs, car une option sur la ligne de commande est une instruction plus immédiate qu'un basculement effectué hier.

`.rebase/` est ignoré par Git, donc la branche sur laquelle vous vous trouvez est propre à votre machine et ne concerne jamais le projet lui-même.

Les branches sont des bases de données PostgreSQL ordinaires nommées d'après la branche avec un préfixe `rb_` ; ainsi, `dev_sandbox` ci-dessus correspond à la base de données `rb_dev_sandbox` sur le même serveur.

Créer une branche ne modifie **pas** la base de données avec laquelle votre projet communique. `rebase db branch create` effectue la copie et s'arrête là ; rien n'est écrit dans `.env`, et le prochain `rebase dev` utilisera toujours la base de données qu'il utilisait auparavant. Pour travailler sur une branche, faites pointer `DATABASE_URL` dessus vous-même — la chaîne de connexion est celle que vous avez déjà, avec le nom de la base de données remplacé :

```bash
# .env
DATABASE_URL=postgresql://user:pass@localhost:5432/rb_dev_sandbox
```

---

## Le branching nécessite un véritable serveur PostgreSQL

Le branching ne fonctionne **pas** avec la base de données de développement gérée — la base PGlite sans configuration que `rebase dev` démarre lorsqu'un projet n'a pas de `DATABASE_URL`.

PGlite ne dessert qu'une seule base de données. Exécuter `CREATE DATABASE ... TEMPLATE` dessus écrit une entrée dans le catalogue et ne copie rien, de sorte que la « branche » pointe vers la base de données à partir de laquelle elle a été clonée : les écritures que vous croyez isolées atterrissent dans votre base de données de développement, et il n'existe aucune seconde copie vers laquelle revenir.

Utilisez le branching avec un véritable serveur — votre propre instance PostgreSQL via `DATABASE_URL`, ou `rebase dev --docker`.

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

- [Commandes CLI](/docs/cli/) — `rebase db branch` et ses options
- [Génération de schéma](/docs/cli/schema/) — comment est généré le schéma qu'une branche copie
- [Environnement et configuration](/docs/getting-started/configuration/) — `DATABASE_URL`, et ordre de priorité d'une branche active

---
