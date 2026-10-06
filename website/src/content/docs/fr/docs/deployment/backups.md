---
sourceHash: 6c9aa0d1c19006ba
title: Sauvegardes et restauration
sidebar_label: Sauvegardes
description: Prenez, planifiez, listez et restaurez des sauvegardes de base de données avec pg_dump — ce que contient une sauvegarde, le fichier de rôles qui l'accompagne, et la seule chose qu'elle ne couvre pas, vos fichiers téléversés.
---

## Vue d'ensemble

Rebase sauvegarde une base de données Postgres avec `pg_dump` et la restaure avec
`pg_restore`. Vous pouvez prendre une sauvegarde à la main, en planifier une avec une
tâche cron, lister celles dont vous disposez depuis la CLI ou le panneau **Sauvegardes**
de Studio, et restaurer dans une base de données neuve sans toucher à celle en
production.

:::caution[Ceci ne sauvegarde pas vos fichiers]
Une sauvegarde contient la **base de données** et rien d'autre. Les fichiers téléversés
vivent dans votre [backend de stockage](/docs/backend/storage/) — un bucket S3 ou GCS,
ou le répertoire désigné par `STORAGE_PATH` — pas dans Postgres, donc une base de
données restaurée pointe vers des fichiers que seul ce backend possède.
Sauvegardez le bucket (versionnement ou réplication) ou le répertoire de
téléversements séparément, selon son propre calendrier.
:::

## Démarrage rapide

```bash
# Sauvegarder vers un répertoire local (format personnalisé, compressé)
rebase db backup --out ./backups

# Sauvegarder directement vers un stockage d'objets privé
rebase db backup --out s3://my-private-bucket/backups

# Lister ce dont vous disposez
rebase db backups list --out ./backups

# Restaurer dans une base de données NEUVE (ne touche pas à celle en production)
rebase db restore ./backups/rebase-app-20260714T030000Z.dump \
  --create-db --target-db app_restored
```

La chaîne de connexion provient de l'environnement de votre projet, comme pour toute
autre [commande `rebase db`](/docs/cli/) : `DATABASE_URL`, avec repli sur
`ADMIN_CONNECTION_STRING`.

## Ce qu'est une sauvegarde

`rebase db backup` exécute `pg_dump` au format personnalisé (`-Fc`), compressé et
restaurable de façon sélective. Les fichiers sont nommés
`rebase-<db>-<YYYYMMDD>T<HHMMSS>Z.dump` ; l'horodatage UTC dans le nom est ce sur quoi
se basent la rétention et le tri de la liste.

| Option | Description |
| --- | --- |
| `--out`, `-o` | Un chemin local, ou une URL `s3://bucket/prefix` / `gs://bucket/prefix`. Par défaut `$BACKUP_DESTINATION`, puis `./backups`. |
| `--exclude-schema <s>` | Exclut un schéma du dump (répétable). N'excluez jamais `rebase` — voir ci-dessous. |
| `--no-owner` | Omet les commandes de propriété, pour une restauration sous un rôle différent. |
| `--enable-row-security` | Effectue le dump en tant que sujet administrateur plutôt que d'échouer sur la sécurité au niveau des lignes. **Peut produire un dump partiel** — voir [Sécurité au niveau des lignes](#sécurité-au-niveau-des-lignes-et-le-dump-silencieusement-incomplet). |
| `--row-security-role <r>` | Le rôle à utiliser pour la lecture avec l'option ci-dessus. Par défaut `admin`. |

Un dump est validé avant que la commande ne signale son succès : `pg_restore --list`
doit pouvoir lire l'archive entière.

Pour les destinations `s3://`, la CLI construit son client de stockage à partir des
mêmes variables `S3_*` qu'utilise votre backend (`S3_ACCESS_KEY_ID`,
`S3_SECRET_ACCESS_KEY`, `S3_REGION`, `S3_ENDPOINT`, `S3_FORCE_PATH_STYLE`).

### Le fichier de rôles

Chaque sauvegarde écrit un second fichier à côté du dump :
`rebase-<db>-<…>Z.globals.sql`, produit par
`pg_dumpall --globals-only --no-role-passwords`. Un `pg_dump` par base de données ne
peut pas inclure les rôles valables pour tout le cluster, or les attributions
(`GRANT`) et les politiques de sécurité au niveau des lignes du dump en nomment un —
`rebase_user`. Restauré dans un nouveau Postgres sans lui, le premier `GRANT` vers ce
rôle échoue et la restauration s'arrête.

Gardez les deux fichiers ensemble. La CLI les téléverse, les liste, les purge et les
restaure en paire, et `rebase db restore` cherche le `.globals.sql` dans le même
répertoire ou préfixe que le `.dump`. Les rôles sont recréés **sans mots de passe** ;
redéfinissez-les après une restauration dans un nouveau cluster. `PG_DUMPALL_PATH`
pointe vers un binaire `pg_dumpall` spécifique.

### Ce qu'elle contient

Toute la base de données, schéma `rebase` compris. Ce schéma contient chaque compte
utilisateur et le reste de l'authentification, les clés d'API, l'historique des
enregistrements, la file d'attente de tâches, les journaux cron, et les fonctions
qu'appellent vos politiques RLS et vos déclencheurs de capture de modifications. Un
dump sans lui ne comporte aucun utilisateur, et ne peut pas du tout être restauré dans
une base de données vide : les tables qu'il contient ont des politiques qui appellent
des fonctions qu'il ne contient pas.

## Sauvegardes planifiées

Une sauvegarde planifiée est une [tâche cron](/docs/backend/cron-jobs/) qui effectue
un dump de la base de données, téléverse le résultat vers `BACKUP_DESTINATION` et
purge les anciennes sauvegardes. Déposez un fichier dans `backend/crons/` qui en
exporte une par défaut :

```ts
// backend/crons/backup.ts
import { GCSStorageController, S3StorageController, type StorageController } from "@rebasepro/server";
import { createBackupCron, backupCronConfigFromEnv } from "@rebasepro/server-postgres";

const resolved = backupCronConfigFromEnv(process.env);
if (resolved.error) throw new Error(resolved.error);

function backupStorage(): StorageController | undefined {
    const destination = resolved.config?.destination;
    if (destination?.kind === "gcs") {
        return new GCSStorageController({ type: "gcs", bucket: destination.bucket });
    }
    if (destination?.kind !== "s3") return undefined; // local: written to disk directly
    return new S3StorageController({
        type: "s3",
        bucket: destination.bucket,
        region: process.env.S3_REGION || "auto",
        accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
        endpoint: process.env.S3_ENDPOINT,
        forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true"
    });
}

// With BACKUP_SCHEDULE unset, export a disabled job so discovery still works.
export default resolved.config
    ? createBackupCron({ ...resolved.config, storage: backupStorage() })
    : createBackupCron({
        schedule: "0 3 * * *",
        connectionString: process.env.DATABASE_URL ?? "",
        destination: { kind: "local", path: "./backups" },
        enabled: false
    });
```

Le contrôleur de stockage est transmis en paramètre plutôt que récupéré depuis le
contexte de la tâche, car le `rebase.storage` du contexte est l'API de stockage côté
client, pas un contrôleur pour le bucket de sauvegarde.

| Variable | Signification |
| --- | --- |
| `BACKUP_SCHEDULE` | Expression cron, par ex. `0 3 * * *` pour 03h00 chaque jour. Non définie désactive les sauvegardes planifiées. |
| `BACKUP_DESTINATION` | Un chemin local, ou `s3://bucket/prefix` / `gs://bucket/prefix`. |
| `BACKUP_RETENTION_DAYS` | Supprime les sauvegardes plus anciennes que ce nombre de jours. Non définie ou `0` conserve tout. |
| `BACKUP_KEEP_MINIMUM` | Conserve toujours au moins ce nombre de sauvegardes récentes, quel que soit leur âge — pour qu'une longue interruption ne purge pas tout. |

Chaque nouveau dump est validé **avant** toute purge, si bien qu'un dump corrompu ne
peut jamais être la raison pour laquelle votre dernière bonne sauvegarde a été
supprimée. La purge ne touche que les fichiers dont le nom correspond au motif de
sauvegarde ; tout ce qui partage le bucket ou le préfixe sans y correspondre est
laissé intact.

La tâche cron exécute `pg_dump` à l'intérieur du processus serveur.
<span class="since-badge" data-since="0.24">Depuis 0.24</span> l'image de runtime
officielle (`rebasepro/server`, voir [Auto-hébergement](/docs/deployment/self-hosting/))
embarque les outils client PostgreSQL 18 pour cela ;
sur la 0.23 et les versions antérieures elle n'en avait aucun, et chaque exécution
planifiée échouait avec `Could not find the 'pg_dump' binary`. Ailleurs — un VPS,
votre propre image — installez vous-même les outils client (voir la section
suivante).

## Compatibilité de version

`pg_dump` et `pg_restore` doivent être de la **même version majeure que le serveur,
ou plus récente**. Chaque commande vérifie d'abord la version majeure du client par
rapport au `server_version_num` du serveur en production et s'arrête en indiquant le
correctif si elles ne correspondent pas, ou si le binaire est manquant :

```
✗ Client tool is Postgres 15 but the server is Postgres 16. pg_dump/pg_restore
  must be the same major version as the server or newer. Install Postgres 16
  client tools.
```

Installez-les avec `brew install libpq` ou
`apt-get install postgresql-client-18` (depuis le dépôt apt de PostgreSQL, celui de
Debian étant plus ancien), ou pointez vers un binaire spécifique avec
`PG_DUMP_PATH`, `PG_RESTORE_PATH` et `PG_DUMPALL_PATH`.

## Sécurité au niveau des lignes, et le dump silencieusement incomplet

Sur un Postgres managé — Cloud SQL, RDS et les autres — il n'y a aucun superutilisateur
à distribuer, donc le rôle avec lequel vous vous connectez ne possède généralement
aucune de vos tables et n'a pas `BYPASSRLS`. La sécurité au niveau des lignes s'applique
alors à lui, et `pg_dump` refuse :

```
pg_dump: error: query failed: ERROR: query would be affected by row-level
security policy for table "company_leads"
```

Ce refus est l'issue sûre. Ajouter `--enable-row-security` à `pg_dump` à la main est
l'issue dangereuse : elle réussit, se termine avec le code 0, et le dump ne contient
alors silencieusement que les lignes que les politiques du rôle effectuant le dump
admettent. Deux véritables solutions :

1. **Accordez au rôle effectuant le dump `BYPASSRLS`, ou faites-en le propriétaire des
   tables.** Le dump contient alors toutes les lignes.

   ```sql
   ALTER ROLE my_backup_role BYPASSRLS;
   ```

2. **`rebase db backup --enable-row-security`.** Rebase définit `app.uid` et
   `app.user_roles` afin que la politique `admin_full_access` générée admette le dump,
   et affiche un avertissement indiquant ce que vous avez sacrifié : une table dont les
   politiques ne comportent aucune règle admin ressort incomplète, sans que rien ne le
   signale.

## Restauration

```bash
rebase db restore <backup> [--target-db <name>] [--create-db] [--clean] [--yes]
```

`restore` exécute `pg_restore`, et c'est destructif, donc jamais automatique : sans
`--yes`, elle demande une confirmation `yes` interactive, et dans un shell non
interactif, elle s'arrête. `<backup>` est un `.dump` local ou une clé `s3://…` /
`gs://…`, téléchargée au préalable.

Avant de restaurer, elle recrée les rôles du cluster à partir du `.globals.sql` de la
sauvegarde — un rôle déjà existant est ignoré, pas une erreur — afin que les
attributions et politiques du dump s'appliquent. Elle s'exécute ensuite avec
`--exit-on-error` : une restauration qui journalise un `GRANT` échoué et continue
signalerait un succès alors que la sécurité au niveau des lignes n'est pas appliquée.
Sans `.globals.sql` à côté de la sauvegarde, elle avertit que des rôles peuvent
manquer.

| Option | Description |
| --- | --- |
| `--target-db <name>` | Restaure dans cette base de données plutôt que celle de `DATABASE_URL`. |
| `--create-db` | Crée d'abord la base de données cible si elle n'existe pas. |
| `--clean` | Supprime les objets existants avant de les recréer (`--clean --if-exists`). |
| `--no-owner` | Ignore la propriété enregistrée dans le dump. |
| `--continue-on-error` | Journalise les erreurs et continue malgré elles. **Peut laisser la RLS non appliquée** ; utilisez-la seulement si vous savez pourquoi. |
| `--yes`, `-y` | Ignore la confirmation. |

La procédure sûre consiste à restaurer à côté de la base de données en production, à la
vérifier, et seulement ensuite à y faire basculer l'application :

1. `rebase db restore <backup> --create-db --target-db app_restored`
2. Pointez un processus de test (ou `psql`) vers `app_restored` et vérifiez les
   comptages de lignes, une connexion, et les tables qui vous importent le plus.
3. Redirigez `DATABASE_URL` vers elle, ou renommez les bases de données, pendant une
   courte fenêtre de maintenance.
4. Restaurez vos fichiers téléversés depuis leur propre sauvegarde, au point dans le
   temps le plus proche possible.

## Le panneau Sauvegardes

Le panneau **Sauvegardes** de Studio, dans le groupe *Base de données*, liste les
sauvegardes présentes à `BACKUP_DESTINATION`, les plus récentes en premier, avec leur
taille et leur date. **Télécharger** récupère le dump ; **Fichier de rôles** récupère
son `.globals.sql`. Téléchargez les deux et conservez-les dans un même répertoire. Une
sauvegarde marquée **Pas de fichier de rôles** n'a pas de fichier associé : recréez ses
rôles à la main avant de la restaurer dans un nouveau Postgres.

<span class="since-badge" data-since="0.24">Depuis 0.24</span> au-dessus de la liste,
le panneau indique la tâche de sauvegarde planifiée et sa dernière exécution. Une
exécution en échec s'affiche comme une erreur avec son message, de sorte qu'une
sauvegarde nocturne qui ne peut pas s'exécuter est visible là où les sauvegardes sont
listées, et pas seulement dans le panneau Tâches Cron.

<span class="since-badge" data-since="0.24">Depuis 0.24</span> ce qu'il indique sur la tâche :

- **Dernière sauvegarde planifiée** est la dernière exécution effectuée par la
  planification. Une exécution lancée à la main depuis lors (**Run Now** dans Tâches
  Cron) a sa propre ligne, de sorte qu'une exécution de test réussie ne peut pas masquer
  l'échec de la sauvegarde nocturne, et qu'une exécution en échec n'est pas présentée
  comme la sauvegarde nocturne.
- Une tâche déclarée `enabled: false` se lit comme des sauvegardes planifiées
  **désactivées**. C'est ce qu'exporte le fichier cron ci-dessus tant que
  `BACKUP_SCHEDULE` n'est pas définie, et définir `BACKUP_SCHEDULE` les active.
  **En pause** signifie qu'un administrateur a mis la tâche en pause dans Tâches Cron,
  et la reprendre à cet endroit les réactive.
- Une tâche que le planificateur a refusée, pour une planification, un fuseau horaire
  ou un délai d'expiration invalide, est signalée avec la raison. Elle ne s'exécute
  jamais tant que son fichier cron n'est pas corrigé.
- Lorsque l'historique d'exécution dans `rebase.cron_logs` ne peut pas être lu, le
  panneau l'indique, plutôt que d'affirmer que la sauvegarde ne s'est pas encore
  exécutée.

<span class="since-badge" data-since="0.24">Depuis 0.24</span> la liste est lue
par le processus serveur qui répond à `GET /api/admin/backups`, et ce n'est pas
toujours le processus qui exécute la planification :

- Une destination `s3://` est listée et téléchargée via un client pour ce bucket,
  construit à partir des mêmes variables `S3_*` qu'utilise le cron de sauvegarde. Une
  destination `gs://` utilise les identifiants par défaut de l'application (application
  default credentials). Fournissez-les à **chaque** processus qui sert `/api/admin`, y
  compris le rôle `api` d'un [déploiement scindé](/docs/deployment/split-processes/),
  et pas seulement à celui qui exécute le cron. Une destination que le processus ne
  peut pas lire répond `503` avec la destination et la raison, et le panneau affiche
  cela au lieu d'une liste vide.
- Un chemin local est le disque propre de ce processus. Lorsque la planification
  s'exécute dans un autre processus (un `api` avec `REBASE_CRON_SCHEDULER=false` à
  côté d'un `worker`), le panneau indique qu'il liste le disque de ce processus : les
  sauvegardes planifiées n'y apparaissent que si les deux processus montent le même
  répertoire. Un déploiement scindé devrait sauvegarder vers un stockage d'objets.

Les téléchargements transitent par `GET /api/admin/backups/download?key=…`, réservé
aux administrateurs, de sorte que le bucket n'a jamais besoin d'être public ; une clé
hors du préfixe de la destination est refusée. Avec `BACKUP_DESTINATION` non définie,
le panneau indique que les sauvegardes ne sont pas configurées.

## Gardez les sauvegardes privées

Une sauvegarde contient toutes vos données, y compris les identifiants et les données
personnelles.

- N'utilisez jamais un bucket public. Gardez son accès privé et journalisez-le.
- Activez le chiffrement au repos : chiffrement côté serveur pour S3, chiffrement par
  défaut pour GCS, ou chiffrement de disque pour un répertoire local.
- Restreignez qui peut lire l'emplacement de sauvegarde, et faites tourner ses
  identifiants.
- Préférez un bucket dédié, séparé des téléversements des utilisateurs.

## Récupération à un point dans le temps

Une sauvegarde `pg_dump` restaure l'état au moment où le dump a été exécuté. Récupérer
à n'importe quelle seconde entre deux dumps nécessite l'archivage des WAL et des
sauvegardes de base, que la distribution open source n'exécute pas pour vous. Si vous
en avez besoin en auto-hébergement, exécutez `pgBackRest` ou `wal-g` aux côtés de votre
Postgres et gardez ces dumps comme une seconde copie, portable.
