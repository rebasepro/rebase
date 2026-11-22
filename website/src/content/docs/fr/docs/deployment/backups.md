---
sourceHash: cd3015585fe4e355
title: Sauvegardes et restauration
sidebar_label: Sauvegardes
description: Effectuez, planifiez, listez et restaurez des sauvegardes de base de données avec pg_dump — ce qu'une sauvegarde contient, le fichier de rôles associé, et le seul élément non couvert, vos fichiers téléversés.
---

## Vue d'ensemble

Rebase sauvegarde une base de données Postgres avec `pg_dump` et la restaure avec
`pg_restore`. Vous pouvez effectuer une sauvegarde manuellement, en planifier une avec une tâche cron,
lister ce que vous avez depuis la CLI ou le panneau **Sauvegardes** de Studio, et restaurer
dans une base de données vierge sans toucher à la base en production.

:::caution[Ceci ne sauvegarde pas vos fichiers]
Une sauvegarde contient la **base de données** et rien d'autre. Les fichiers téléversés résident dans votre
[backend de stockage](/docs/backend/storage/) — un bucket S3 ou GCS, ou le
répertoire défini par `STORAGE_PATH` — et non dans Postgres ; une base de données restaurée pointe donc vers des fichiers que seul ce backend possède.
Sauvegardez le bucket (gestion des versions ou réplication) ou le répertoire des téléversements
séparément, selon un calendrier qui lui est propre.
:::

## Démarrage rapide

```bash
# Sauvegarder dans un répertoire local (format personnalisé, compressé)
rebase db backup --out ./backups

# Sauvegarder directement dans un stockage objet privé
rebase db backup --out s3://my-private-bucket/backups

# Lister vos sauvegardes
rebase db backups list

# Restaurer dans une NOUVELLE base de données (ne touche pas à celle en production)
rebase db restore ./backups/rebase-app-20260714T030000Z.dump \
  --create-db --target-db app_restored
```

La base de données ciblée est celle résolue par toutes les autres [commandes `rebase db`](/docs/cli/database/),
dans le même ordre : `--database-url`, `DATABASE_URL` dans le shell, la
[branche](/docs/backend/branching/) active du checkout, `DATABASE_URL`
dans `.env`, Postgres dans Docker (`--docker`, ou le dernier `rebase dev --docker`),
puis la base de données de développement managée, que `restore` refuse.

Un chemin relatif pour
`--out`, la valeur par défaut `./backups` et un chemin de dump fourni à `rebase db restore`
sont tous résolus par rapport au répertoire depuis lequel vous exécutez `rebase`, normalement la racine du projet,
afin que `rebase db backup` et `rebase db backups list` se rejoignent au même endroit. Un
`BACKUP_DESTINATION` relatif se résout par rapport au répertoire du backend, où le
serveur le lit également. Les trois commandes refusent toute option qu'elles ne prennent pas en charge
avant d'exécuter quoi que ce soit, et suggèrent celle que vous souhaitiez probablement utiliser. Le mot de passe est transmis
à `pg_dump`, `pg_dumpall` et `pg_restore` via `PGPASSWORD`, jamais sur leur
ligne de commande, afin qu'aucun message d'erreur ou liste de processus ne l'affiche.

## Ce qu'est une sauvegarde

`rebase db backup` exécute `pg_dump` au format personnalisé (`-Fc`), qui est compressé
et peut être restauré de manière sélective. Les fichiers sont nommés
`rebase-<db>-<YYYYMMDD>T<HHMMSS>Z.dump` ; l'horodatage UTC présent dans le nom sert
au tri pour la rétention et le listage.

| Option | Description |
| --- | --- |
| `--out`, `-o` | Un chemin local, ou une URL `s3://bucket/prefix` / `gs://bucket/prefix`. Valeur par défaut : `$BACKUP_DESTINATION`, puis `./backups` dans le répertoire d'exécution de `rebase`. |
| `--exclude-schema <s>` | Exclure un schéma du dump (répétable). Tout motif correspondant à `rebase` est refusé — voir ci-dessous. |
| `--no-owner` | Omettre les commandes de propriété, pour restaurer sous un rôle différent. |
| `--enable-row-security` | Effectuer le dump en tant que sujet administrateur au lieu d'échouer sur la sécurité au niveau des lignes (RLS). **Peut générer un dump partiel** — voir [Sécurité au niveau des lignes](#sécurité-au-niveau-des-lignes-et-le-dump-silencieusement-incomplet). |
| `--row-security-role <r>` | Le rôle à utiliser pour la lecture avec le flag ci-dessus. Valeur par défaut : `admin`. |

Un dump est validé avant que la commande ne confirme le succès : `pg_restore --list`
doit pouvoir lire l'archive complète.

Pour les destinations `s3://`, la CLI initialise son client de stockage à partir des mêmes
variables `S3_*` que votre backend (`S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`,
`S3_REGION`, `S3_ENDPOINT`, `S3_FORCE_PATH_STYLE`).

### Le fichier de rôles

Chaque sauvegarde écrit un second fichier à côté du dump :
`rebase-<db>-<…>Z.globals.sql`, généré par
`pg_dumpall --globals-only --no-role-passwords`. Un `pg_dump` exécuté au niveau d'une base de données
ne peut pas inclure les rôles globaux du cluster, et les privilèges ainsi que les politiques de sécurité
au niveau des lignes du dump en mentionnent un : `rebase_user`. Restauré dans un nouveau Postgres sans ce rôle, le
premier `GRANT` vers ce rôle échoue et la restauration s'interrompt.

Conservez ces deux fichiers ensemble. La CLI les téléverse et les restaure par paire, une
sauvegarde planifiée les purge ensemble, et `rebase db restore` cherche le fichier `.globals.sql` dans le même
répertoire ou préfixe que le `.dump`. Les rôles sont recréés **sans mot de passe** ;
redéfinissez-les après une restauration dans un nouveau cluster. `PG_DUMPALL_PATH` pointe vers un
binaire `pg_dumpall` spécifique.

### Ce qu'elle contient

L'intégralité de la base de données, y compris le schéma `rebase`. Ce schéma contient tous
les comptes utilisateurs et le reste de l'authentification, les clés d'API, l'historique des enregistrements, la file d'attente des tâches,
les logs des tâches cron, ainsi que les fonctions appelées par vos politiques RLS et vos triggers de capture de changements.
Un dump sans ce schéma ne contient aucun utilisateur et ne peut pas du tout être restauré dans une base
vide : les tables qu'il contient comportent des politiques appelant des fonctions
qui en sont absentes.

Ainsi,
`rebase db backup` refuse un `--exclude-schema` correspondant à `rebase`, selon les
règles de motifs propres à pg_dump (`reb*` et `*` inclus), avant même d'exécuter quoi que ce soit.
Ces règles interprètent la syntaxe des expressions régulières hors des guillemets doubles, donc
`[r]ebase` et `audit|rebase` sont également refusés, et le serveur est interrogé sur
chaque motif avant l'exécution de `pg_dump`, avec le même moteur d'expressions régulières
que celui utilisé par la requête interne de `pg_dump`.

Puisqu'ils contiennent
l'ensemble des empreintes de mots de passe et de clés, un dump local et son fichier `.globals.sql` sont créés
avec des droits de lecture réservés uniquement à leur propriétaire (0600), avant que `pg_dump` n'y écrive ;
il en va de même pour les fichiers locaux d'une sauvegarde planifiée.

## Sauvegardes planifiées

Une sauvegarde planifiée est une [tâche cron](/docs/backend/cron-jobs/) qui exporte la
base de données, téléverse le résultat vers `BACKUP_DESTINATION` et purge les anciennes sauvegardes.
Déposez un fichier dans `backend/crons/` exportant par défaut une tâche :

```ts
// backend/crons/backup.ts
import { backupStorageFromEnv, type StorageController } from "@rebasepro/server";
import { createBackupCron, backupCronConfigFromEnv } from "@rebasepro/server-postgres";

const resolved = backupCronConfigFromEnv(process.env);
if (resolved.error) throw new Error(resolved.error);

function backupStorage(): StorageController | undefined {
    const destination = resolved.config?.destination;
    if (!destination || destination.kind === "local") return undefined; // local: written to disk directly
    // The same S3_* (or application-default GCS) client the CLI and the Backups panel build.
    return backupStorageFromEnv(destination, process.env);
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

Le contrôleur de stockage est passé en argument plutôt que récupéré depuis le contexte de la tâche,
car le `rebase.storage` du contexte correspond à l'API de stockage côté client, et non à un
contrôleur dédié au bucket de sauvegarde.

Une sauvegarde n'est pas soumise aux limites d'upload du contrôleur. `maxFileSize` (50 Mo
sauf indication contraire) et `allowedMimeTypes` s'appliquent à ce que les utilisateurs téléversent ; un dump de n'importe
quelle taille peut donc être téléversé, y compris s'il passe par le contrôleur servant les
fichiers de votre application.

| Variable | Signification |
| --- | --- |
| `BACKUP_SCHEDULE` | Expression cron, par ex. `0 3 * * *` pour tous les jours à 03:00. Non définie, elle désactive les sauvegardes planifiées. |
| `BACKUP_DESTINATION` | Un chemin local, ou `s3://bucket/prefix` / `gs://bucket/prefix`. |
| `BACKUP_RETENTION_DAYS` | Supprime les sauvegardes antérieures à ce nombre de jours. Non définie ou `0`, elle conserve tout. |
| `BACKUP_KEEP_MINIMUM` | Conserve toujours au moins ce nombre de sauvegardes récentes, quel que soit leur âge — pour qu'une panne prolongée ne supprime pas tout. |

Chaque nouveau dump est validé **avant** que toute purge ne soit effectuée, afin qu'un dump corrompu
ne puisse jamais être la cause de la suppression de votre dernière sauvegarde valide. La purge ne concerne
que les fichiers dont les noms correspondent au motif de sauvegarde ; tout autre fichier partageant le
bucket ou le préfixe reste intact.

La tâche cron exécute `pg_dump` au sein du processus serveur. L'image de runtime
officielle (`rebasepro/server`, voir [Auto-hébergement](/docs/deployment/self-hosting/))
inclut les outils clients de PostgreSQL 18 à cet effet.
Partout ailleurs — un VPS, votre propre image —
installez vous-même les outils clients (voir la section suivante).

## Compatibilité des versions

`pg_dump` et `pg_restore` doivent être dans la **même version majeure que le serveur, ou une version
plus récente**. `rebase db backup` et `rebase db restore` comparent la version majeure du client
au `server_version_num` du serveur en ligne avant d'effectuer l'export ou la restauration, et
s'arrêtent en indiquant la marche à suivre en cas d'incompatibilité ou si
le binaire est introuvable :

```
✗ Client tool is Postgres 15 but the server is Postgres 16. pg_dump/pg_restore
  must be the same major version as the server or newer. Install Postgres 16
  client tools.
```

Installez-les avec `brew install libpq` ou `apt-get install postgresql-client-18`
(depuis le dépôt apt de PostgreSQL, celui de Debian étant plus ancien), ou spécifiez un
binaire précis avec `PG_DUMP_PATH`, `PG_RESTORE_PATH` et `PG_DUMPALL_PATH`.
`restore --clean` exécute également `psql`, qui est fourni avec ces outils ; `PSQL_PATH` permet d'en
désigner un autre.

## Sécurité au niveau des lignes, et le dump silencieusement incomplet

Sur un Postgres managé — Cloud SQL, RDS et consorts — aucun rôle superutilisateur n'est
fourni ; le rôle utilisé pour la connexion ne possède donc généralement aucune de vos tables et ne dispose
pas de `BYPASSRLS`. La sécurité au niveau des lignes lui est appliquée, et `pg_dump` refuse d'opérer :

```
pg_dump: error: query failed: ERROR: query would be affected by row-level
security policy for table "company_leads"
```

Ce refus est le comportement le plus sûr. Ajouter manuellement `--enable-row-security` à `pg_dump`
est la démarche risquée : l'opération réussit, se termine avec un code de retour 0, et le dump contient
silencieusement uniquement les lignes autorisées par les politiques du rôle exécutant l'opération. Il existe deux solutions viables :

1. **Accorder au rôle de sauvegarde le droit `BYPASSRLS`, ou en faire le propriétaire des tables.** Le
   dump contiendra alors toutes les lignes.

   ```sql
   ALTER ROLE my_backup_role BYPASSRLS;
   ```

2. **`rebase db backup --enable-row-security`.** Rebase définit `app.uid` et
   `app.user_roles` pour que la politique générée `admin_full_access` autorise le
   dump, et affiche un avertissement précisant le compromis effectué : une table dont
   les politiques n'incluent aucune règle d'administration sera exportée incomplète, sans qu'aucun message ne le signale.

## Restauration

```bash
rebase db restore <backup> [--target-db <name>] [--create-db] [--clean] [--yes]
```

`restore` exécute `pg_restore`, et étant une opération destructive, elle n'est jamais automatique :
sans l'option `--yes`, une confirmation interactive `yes` est demandée, et dans un
shell non interactif, l'exécution s'arrête en demandant de spécifier `--yes`. `<backup>` est un fichier `.dump` local ou une clé `s3://…` / `gs://…`,
préalablement téléchargée.

Dans une base de données
contenant déjà les éléments créés par la sauvegarde, l'option `--clean` est nécessaire : sans elle,
l'opération est refusée avant toute exécution, en mentionnant les schémas et tables bloquants, et
indique de passer `--clean` ou de restaurer dans une nouvelle base de données avec
`--create-db --target-db <name>`. Elle refuse la
base de développement managée, qui ne peut pas accepter les données COPY d'un dump ; restaurez
plutôt dans Postgres sous Docker avec `--docker`.

Avec `--clean`,
la restauration remplace ce que contient la sauvegarde au sein d'une transaction unique. Elle supprime chaque
schéma intégralement créé par la sauvegarde (comme `rebase`), ainsi que chaque table créée par la sauvegarde dans un schéma
qu'elle ne crée pas elle-même (`public`), avec `CASCADE`, puis restaure le
dump dans cette même transaction. Avant confirmation, elle liste les éléments supprimés qui ne sont
pas contenus dans la sauvegarde, tels que `rebase.atlas_schema_revisions` issu de
`rebase db migrate`, une fonction, un type ou une séquence dans un schéma remplacé, ou une
vue ou clé étrangère externe référençant l'une des tables de la sauvegarde. Une restauration interrompue à n'importe quelle étape est annulée (rollback), et confirme
que la base de données conserve son état antérieur. Elle applique le dump via `psql`, qui
est fourni avec `pg_restore` (`PSQL_PATH` permet d'en désigner un autre), et attend au maximum
15 secondes l'acquisition d'un verrou, qu'un processus `rebase dev` actif peut détenir.
L'option `--continue-on-error` exécute tout de même le `--clean` propre à pg_restore.

Avant de procéder à la restauration, les rôles de cluster sont recréés à partir du fichier
`.globals.sql` de la sauvegarde — un rôle déjà existant est ignoré sans provoquer d'erreur — afin que les
privilèges et politiques du dump puissent s'appliquer. L'opération s'arrête ensuite à la première erreur rencontrée (`--exit-on-error`,
ou `ON_ERROR_STOP` sous `--clean`) : une restauration qui
noterait un échec sur un `GRANT` et poursuivrait son cours signalerait un succès alors que la
sécurité au niveau des lignes ne serait pas appliquée. En l'absence de fichier `.globals.sql` aux côtés de la sauvegarde, un avertissement signale
que des rôles pourraient manquer.

| Option | Description |
| --- | --- |
| `--target-db <name>` | Restaurer dans cette base de données au lieu de celle définie par `DATABASE_URL`. |
| `--create-db` | Créer d'abord la base de données cible si elle n'existe pas. |
| `--clean` | Remplacer ce que contient la sauvegarde, dans une seule transaction avec la restauration : ses schémas en totalité, et ses tables ailleurs. Précise d'abord ce qui sera supprimé au-delà de la sauvegarde. |
| `--no-owner` | Ignorer les informations de propriété enregistrées dans le dump. |
| `--continue-on-error` | Journaliser et poursuivre malgré les erreurs. **Peut laisser la sécurité RLS non appliquée** ; ne l'utilisez qu'en connaissance de cause. |
| `--yes`, `-y` | Ignorer la confirmation interactive. |

La procédure sûre consiste à restaurer à côté de la base de données en production, de vérifier le résultat, et de
ne basculer l'application qu'ensuite :

1. `rebase db restore <backup> --create-db --target-db app_restored`
2. Pointez un processus temporaire (ou `psql`) sur `app_restored` et vérifiez le nombre de lignes,
   une connexion, ainsi que vos tables critiques.
3. Modifiez `DATABASE_URL` pour pointer dessus, ou renommez les bases de données, pendant une courte
   fenêtre de maintenance.
4. Restaurez vos fichiers téléversés depuis leur propre sauvegarde, au point dans le temps
   le plus proche possible.

## Le panneau Sauvegardes

Le panneau **Sauvegardes** de Studio, dans la section *Base de données*, répertorie les sauvegardes présentes dans
`BACKUP_DESTINATION`, de la plus récente à la plus ancienne, avec leur date/heure (et leur taille pour une destination
locale). **Télécharger**
récupère le dump ; **Fichier de rôles** récupère son fichier `.globals.sql`. Téléchargez les deux et
gardez-les dans le même répertoire. Une sauvegarde étiquetée **Aucun fichier de rôles** n'a pas de fichier associé :
recréez ses rôles manuellement avant de la restaurer dans une nouvelle instance Postgres.

Au-dessus de la liste, le panneau affiche l'état de la tâche de sauvegarde planifiée et de sa dernière exécution. Un échec d'exécution est signalé sous la forme d'une
erreur accompagnée de son message, rendant une sauvegarde nocturne en échec visible là où
les sauvegardes sont listées, et pas uniquement dans le panneau des Tâches planifiées.

Détails fournis sur la tâche :

- **Dernière sauvegarde planifiée** indique la dernière exécution déclenchée par le calendrier. Une exécution lancée
  manuellement depuis (**Exécuter maintenant** dans les Tâches planifiées) bénéficie de sa propre ligne, afin qu'un
  test réussi ne masque pas un échec de la tâche nocturne, et qu'une tentative échouée ne soit pas
  présentée comme la sauvegarde nocturne.
- Une tâche configurée avec `enabled: false` est indiquée comme étant **désactivée**.
  C'est ce que le fichier cron ci-dessus exporte tant que `BACKUP_SCHEDULE` n'est pas défini, et
  renseigner `BACKUP_SCHEDULE` permet de les activer. **En pause** signifie qu'un administrateur a suspendu la
  tâche dans les Tâches planifiées ; la réactiver à cet endroit la remet en marche.
- Une tâche rejetée par le planificateur en raison d'une fréquence, d'un fuseau horaire ou d'un délai d'expiration invalide
  est signalée avec la raison correspondante. Elle ne s'exécutera jamais tant que son fichier cron n'aura pas été corrigé.
- Lorsque l'historique d'exécution dans `rebase.cron_logs` est illisible, le panneau le
  signale explicitement, plutôt que d'indiquer que la sauvegarde n'a pas encore tourné.

La liste est lue par le processus serveur répondant à `GET /api/admin/backups`,
et il ne s'agit pas nécessairement du processus exécutant la planification :

- Une destination `s3://` est listée et téléchargée via un client dédié à ce
  bucket, configuré avec les mêmes variables `S3_*` que celles de la tâche cron de sauvegarde. Une destination `gs://`
  utilise les identifiants par défaut de l'application (ADC). Fournissez-les à **chaque** processus qui
  dessert `/api/admin`, y compris le rôle `api` d'un
  [déploiement fractionné](/docs/deployment/split-processes/), et pas seulement à
  celui exécutant la tâche cron. Une destination inaccessible par le processus répond par un code `503`
  mentionnant la destination et la cause de l'erreur, et le panneau affiche cette information au lieu d'une
  liste vide.
- Un chemin local correspond au disque propre à ce processus. Lorsque la planification tourne dans un autre
  processus (une instance `api` avec `REBASE_CRON_SCHEDULER=false` à côté d'un `worker`), le
  panneau indique qu'il liste le disque de ce processus précis : les sauvegardes planifiées n'y apparaîtront
  que si les deux processus montent le même répertoire. Un déploiement fractionné
  devrait privilégier des sauvegardes sur un stockage objet.

Les téléchargements transitent via `GET /api/admin/backups/download?key=…`, réservé aux administrateurs,
ce qui évite de devoir rendre le bucket public ; toute clé située en dehors du préfixe de destination est
refusée. Si `BACKUP_DESTINATION` n'est pas configuré, le panneau signale que les sauvegardes ne sont
pas paramétrées.

### Télécharger une sauvegarde

Un navigateur ne pouvant pas
adjoindre d'en-tête `Authorization` à un téléchargement direct, Studio et le SDK demandent d'abord
un lien. `POST /api/admin/backups/download-url` avec `{ "key": "…" }` (mêmes
restrictions de droits d'administration et contrôles de clé que pour le téléchargement direct) retourne
`{ url, token, expiresIn }` : une URL dont le jeton remplace l'en-tête, pour
cette sauvegarde précise à l'emplacement actuel, valable pendant 60 secondes. Ce jeton est
rejeté pour tout autre usage — en tant que session, jeton de téléchargement de stockage, ou pour une autre
sauvegarde — ainsi qu'une fois expiré. Le navigateur diffuse ensuite le dump directement vers
le disque, ce qui évite de charger en mémoire dans un onglet une sauvegarde de la taille de votre base de données.

```ts
// In a browser: the browser saves the file.
await client.backups.download(key);

// Anywhere: a link that needs no header, for 60 seconds.
const { url } = await client.backups.downloadUrl(key);

// In Node: stream the bytes to a file.
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const { stream, name } = await client.backups.stream(key);
await pipeline(Readable.fromWeb(stream), createWriteStream(name));
```

`backups.download(key)` enregistre le fichier dans un navigateur et lève une exception ailleurs ; utilisez `stream(key)`
dans Node. Face à un serveur ne prenant pas en charge les liens de téléchargement (une version antérieure à 0.25, ou
sans secret JWT pour les signer), `download()` bascule sur la lecture directe des octets.

## Préserver la confidentialité des sauvegardes

Une sauvegarde contient l'ensemble de vos données, y compris les identifiants et les données personnelles.

- N'utilisez jamais de bucket public. Maintenez un accès privé et activez les logs d'accès.
- Activez le chiffrement au repos : chiffrement côté serveur S3, chiffrement par défaut GCS,
  ou chiffrement de disque pour un répertoire local.
- Restreignez les accès en lecture à l'emplacement de sauvegarde et effectuez une rotation de ses identifiants.
- Privilégiez un bucket dédié, distinct de celui des fichiers téléversés par les utilisateurs.

## Restauration à un instant précis (Point-in-time recovery)

Une sauvegarde `pg_dump` restaure les données à l'instant précis où le dump a été exécuté. Pour restaurer
à la seconde près entre deux sauvegardes, l'archivage WAL et des sauvegardes de base (base backups) sont requis,
ce que la distribution open source ne gère pas automatiquement. Si vous avez besoin de cette fonctionnalité en auto-hébergement, configurez `pgBackRest`
ou `wal-g` aux côtés de votre serveur Postgres, et conservez ces dumps sous forme de copies secondaires portables.
