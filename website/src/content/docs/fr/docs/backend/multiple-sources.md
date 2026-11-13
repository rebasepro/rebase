---
sourceHash: bdf9409c94709498
title: Bases de données et buckets multiples
sidebar_label: Sources multiples
description: Acheminez des tables vers différentes bases de données et des colonnes de stockage vers différents buckets, et configurez chacun d'eux depuis l'environnement.
---

## Vue d'ensemble

Un projet n'est pas limité à une seule base de données et un seul bucket. Tout élément nommé dont un projet a besoin — une base de données, un bucket, un topic, une file d'attente (queue) — est **déclaré avec un constructeur dans `backend/resources.ts`**, et configuré depuis l'environnement par une variable dérivée de sa clé. Les tâches cron et les fonctions sont des fichiers, et ils intègrent le même graphe sous le nom du fichier.

Une règle unique, quel que soit le type : il n'y a aucun autre endroit où chercher, et rien à synchroniser manuellement.

## Déclaration des ressources

Placez-les dans `backend/resources.ts`. Les exporter est une bonne pratique — cela vous donne un élément à importer — mais c'est la déclaration qui les enregistre.

```ts
// backend/resources.ts
import { bucket, database, queue, topic } from "@rebasepro/types";

/** The project's database. Reads DATABASE_URL, as it always did. */
export const main = database();

/** A second one. Reads DATABASE_URL__ANALYTICS. */
export const analytics = database("analytics", { label: "Analytics warehouse" });

/** A bucket. Reads S3_BUCKET__MEDIA. */
export const media = bucket("media", { engine: "s3", label: "Public media" });

/** A topic, delivered through the durable job queue. */
export const signups = topic<{ userId: string }>("signups");

signups.subscription("send-welcome", async (event) => {
    // …
});
```

`database()`, `bucket()` et `topic()` sont déclarables depuis la version 0.17, et `queue()` depuis la 0.18.

Pointez ensuite une table vers l'un d'eux, via son handle — le même nom, écrit une seule fois :

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

```ts
// backend/schema/page_views.ts
import { defineTable, col } from "@rebasepro/server/schema";
import { analytics, media } from "../resources";

export const pageViews = defineTable("page_views", {
    database: analytics,
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        path: col.text().notNull(),
        // A file column, stored in the `media` bucket.
        screenshot: col.storage({ path: "screenshots/", source: media, accept: ["image/*"] })
    },
    rls: "admin-only"
});
```

La table compilée enregistre la clé du handle, donc au-delà de ce point, il s'agit de simples données — elle se sérialise, se compare, et parvient au panneau d'administration via `GET /api/schema/tables`. La forme textuelle (`database: "analytics"`) fonctionne également ; le handle est celui que le renommage suit et sur lequel mène le saut vers la définition.

Dans une fonction, les mêmes handles permettent d'accéder à la ressource :

```ts
import { defineFunction } from "@rebasepro/server/functions";
import { analytics, media } from "../resources";

export default defineFunction((app, { rebase }) => {
    app.post("/report", async (c) => {
        const rows = await rebase.sql("select count(*) from page_views", { database: analytics });
        const file = new File([JSON.stringify(rows)], "report.json", { type: "application/json" });
        await rebase.bucket(media).putObject({ key: "report.json", file });
        return c.json({ ok: true });
    });
});
```

`{ database: analytics }` exécute la requête sur la propre connexion de cette source — quelle que soit la cible de `DATABASE_URL__ANALYTICS`, sur n'importe quel serveur — et sans option, elle est exécutée sur la source par défaut. Une clé qui ne désigne aucune source configurée est rejetée avec une erreur listant celles existantes.

### Visualiser ce que vous avez déclaré

```bash
rebase resources            # list them
rebase resources --write    # regenerate rebase.resources.json
rebase resources --check    # fail if that file is stale
```

`rebase.resources.json` est **généré** et commité. C'est ce qu'un hôte lit pour décider de ce qu'il doit provisionner *avant* d'exécuter quoi que ce soit — c'est ainsi qu'une console peut indiquer « ce projet nécessite un bucket `media` et n'en possède aucun » lors d'un premier déploiement. Modifiez les déclarations, jamais le fichier ; `--check` fait échouer un build si les deux ne concordent pas.

Chaque entrée enregistre également **qui l'utilise** — `table:page_views` sur une base de données, `column:posts.cover` sur un bucket, `function:report` sur tout ce que la fonction importe depuis `resources.ts`. C'est la cartographie dont une console a besoin pour répondre à la question : « qu'est-ce qui casse si je supprime ceci ? ».

`rebase status` va encore plus loin : pour chaque déclaration, elle indique si l'environnement la lie (bind), en utilisant les mêmes résolveurs que ceux du démarrage, évitant ainsi de vous rassurer à tort sur un déploiement sur le point de refuser de démarrer.

### Un moteur dont le build n'a jamais entendu parler

Chaque type possède sa propre liste de moteurs, et un moteur inconnu est rejeté dès l'appel plutôt qu'accepté pour échouer plus tard. Quelque chose de véritablement hors liste s'écrit avec le préfixe `custom:` :

```ts
export const objects = bucket("objects", { engine: "custom:minio" });
```

### Corriger un type déjà publié

Pour les auteurs de pilotes (drivers). La définition enregistrée d'un type de ressource est **figée** dès qu'un package la contenant a été publié : chaque driver publié intègre sa propre copie de `@rebasepro/types`, et cette copie compare l'entrée du registre partagé avec son propre littéral, levant une exception à la moindre divergence. Modifier le littéral neutralise ainsi tout bundle construit avec un driver plus ancien au chargement du driver.

`amendResourceKind` corrige ce qu'un type *lie* — ses bases de variables d'environnement, ses clés d'options — sans toucher au littéral auquel les anciennes copies se comparent :

```ts
import { amendResourceKind } from "@rebasepro/types";

amendResourceKind("database", {
    envBases: ["DATABASE_URL", "DATABASE_READ_URL", "ADMIN_CONNECTION_STRING"]
});
```

La modification s'applique uniquement aux lectures passant par cette copie ; un driver plus ancien continue donc d'effectuer les liaisons comme il le faisait lors de sa publication. Utilisez cette méthode pour toute correction d'un type déjà distribué ; n'utilisez `registerResourceKind` que pour un type que personne n'a encore publié.

### Transmission au frontend

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Le frontend n'importe pas `backend/resources.ts` : l'importation de valeurs de tout élément situé sous `backend/` depuis `frontend/` est rejetée par `pnpm check:frontend-backend-imports`, car cela enverrait des modules serveur au navigateur. Il n'en a d'ailleurs pas besoin. Le fournisseur `<Rebase>` lit les buckets servis par le backend via `GET /api/storage/sources` et connecte chacun d'eux, et chaque table servie par le backend, quelle que soit la base de données où elle réside, est accessible via l'API.

Ce que le frontend déclare lui-même est une source `direct` — avec laquelle le navigateur communique sans passer par le backend, comme Firestore — transmise à `<Rebase>` sous forme d'instance active via `dataSources` ou `storageSources`. Consultez [Firebase](/docs/frontend/firebase/).

## Configuration de chaque source

Les noms des variables d'environnement sont dérivés de la clé de la ressource, il n'y a donc rien à synchroniser manuellement :

```
<VARIABLE>              the default resource   DATABASE_URL, S3_BUCKET
<VARIABLE>__<KEY>       a named resource       DATABASE_URL__ANALYTICS, S3_BUCKET__MEDIA
```

La clé est mise en majuscules et les caractères non alphanumériques sont remplacés par des tirets bas (underscores), ainsi `media-cdn` lit `S3_BUCKET__MEDIA_CDN`.

Le séparateur est volontairement un **double** tiret bas. Un simple tiret bas entrerait en collision avec de véritables noms de variables — `S3_BUCKET_NAME` serait interprété comme le bucket d'une source nommée `name`.

### Bases de données

```bash
DATABASE_URL=postgres://localhost/app
DATABASE_URL__ANALYTICS=postgres://warehouse.internal/analytics

# Optional, per source:
DB_POOL_MAX__ANALYTICS=5
REBASE_DRIVER__ANALYTICS=@rebasepro/server-postgres
```

Le pilote est choisi à partir du `engine` déclaré — `postgres` est celui pour lequel Rebase fournit un pilote serveur, et le seul vers lequel une table peut être acheminée — et `REBASE_DRIVER__<KEY>` le surcharge pour utiliser votre propre pilote. Une base de données Firestore n'est pas une ressource backend : le CMS la lit depuis le navigateur, via [`defineFirestoreCollection`](/docs/frontend/firebase/). `REBASE_DB_POOL_MAX` est une limite globale au processus, et non une liaison par source ; elle ne prend donc aucun suffixe.

En développement, vous n'avez rien de tout cela à configurer : `rebase dev` dessert chaque base de données déclarée à partir de son instance Postgres gérée — une deuxième instance pour `analytics`, démarrée à la demande — et exporte lui-même `DATABASE_URL__ANALYTICS`. Une variable que vous définissez manuellement n'est jamais écrasée.

Les tables et les stratégies de sécurité au niveau des lignes (row-level security) sont provisionnées **par source** : une table acheminée vers `analytics` obtient sa table et ses politiques dans la base de données `analytics`.

### Stockage

```bash
S3_BUCKET__MEDIA=my-media-bucket
S3_REGION__MEDIA=eu-central-1
S3_ACCESS_KEY_ID__MEDIA=…
S3_SECRET_ACCESS_KEY__MEDIA=…
```

Le moteur provient de la déclaration, il n'y a donc aucun `STORAGE_TYPE` à définir.

#### Quel bucket reçoit un téléversement non qualifié

Une colonne de stockage qui ne spécifie aucune `source` écrit dans le bucket **par défaut**. Déclarer des buckets nommés ne déplace jamais celui-ci. Le bucket par défaut conserve sa propre configuration indépendamment de ce que déclare `backend/resources.ts` : `STORAGE_TYPE`, `STORAGE_PATH` (`<project>/uploads` lorsqu'il n'est pas défini), et les variables sans suffixe `S3_*` / `GCS_*`. Ajouter `bucket("media", { engine: "s3" })` à un projet qui contient déjà des fichiers dans `./uploads` les laisse là où ils se trouvent et continue de les servir. `media` lit ses propres variables `__MEDIA` et, en développement, prend la forme de son propre répertoire, `uploads__media`.

Pour envoyer plutôt les téléversements non qualifiés vers un bucket nommé, marquez-le :

```ts
export const media = bucket("media", { engine: "s3", default: true });
```

Le bucket par défaut *devient* alors `media`. Les fichiers que le bucket par défaut contenait auparavant restent là où ils sont et ne sont plus servis par son intermédiaire ; copiez-les donc au préalable : `rebase storage move --from "(default)" --to media`.

Deux sources ne peuvent pas partager le même emplacement. Si un bucket nommé devait pointer vers le répertoire du bucket par défaut (ou un sous-répertoire de celui-ci), ou vers le même bucket de stockage d'objets sur le même point de terminaison (endpoint), le démarrage est refusé et indique quelle variable modifier.

### Plusieurs buckets sur un même compte

Chaque variable est lue par clé, ce qui est adapté pour le nom du bucket mais pas pour les identifiants — quinze buckets sur une même installation MinIO impliqueraient quinze copies de la même clé d'accès. Définissez un `account` et les variables au niveau du fournisseur seront lues une seule fois :

```ts
export const media   = bucket("media",   { engine: "s3", account: "minio" });
export const avatars = bucket("avatars", { engine: "s3", account: "minio" });
```

```bash
S3_BUCKET__MEDIA=project-media       # per bucket, never shared
S3_BUCKET__AVATARS=project-avatars
S3_ACCESS_KEY_ID__MINIO=…            # read once, by both
S3_SECRET_ACCESS_KEY__MINIO=…
S3_ENDPOINT__MINIO=https://minio.internal
```

La forme de compte couvre les variables qui décrivent le *fournisseur* : `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_ENDPOINT`, `S3_REGION`, `S3_FORCE_PATH_STYLE`, `GCS_PROJECT_ID` et `GCS_KEY_FILENAME`. Le nom du bucket n'en fait pas partie et ne bascule jamais vers une valeur par défaut — si c'était le cas, deux buckets sur un même compte n'en deviendraient silencieusement qu'un seul.

Une valeur par bucket prévaut toujours si vous en définissez une, ce qui permet de migrer une source unique vers un autre fournisseur sans rompre le compte partagé des autres. Il n'y a délibérément aucun repli (fallback) vers la variable sans suffixe : celle-ci appartient à la source par défaut, et permettre à un bucket nommé d'en hériter signifierait qu'une faute de frappe dans une clé utiliserait les identifiants d'une autre source.

## Topics et files d'attente

Un topic est distribué via la file de jobs durable : la publication écrit **une ligne par souscription**, de sorte que chaque abonné réessaie selon son propre calendrier et qu'un abonné en échec ne bloque ni ne relance les autres.

```ts
await signups.publish({ userId });
```

Une queue (file d'attente) est l'autre forme de tâche d'arrière-plan : une liste de travail avec **un seul gestionnaire (handler)**, où l'appelant conserve l'identifiant du job. Les queues sont disponibles depuis la version 0.18, les topics depuis la 0.17.

```ts
export const thumbnails = queue<{ key: string }>("thumbnails");
thumbnails.handler(async ({ key }, { attempt }) => { /* … */ });

const { id } = await thumbnails.enqueue({ key }, { runAt: new Date(Date.now() + 60_000) });
```

Les deux fonctionnent en mode **au moins une fois** (at-least-once). Un worker qui s'interrompt alors qu'il traite un job le libère, et le suivant relance le gestionnaire depuis le début ; un gestionnaire doit donc tolérer de recevoir un événement deux fois. Une publication ou une mise en file d'attente au sein d'une transaction qui subit un rollback n'a jamais eu lieu — il s'agit d'une simple insertion de ligne.

Déclarer l'un ou l'autre active automatiquement la file de jobs, sur chaque chemin de démarrage — un projet sur le runtime managé, qui ne possède pas de point d'entrée pour transmettre `jobs.tasks`, obtient ses gestionnaires par ce biais. Publier sur un topic que rien ne déclare, ou empiler sur une file d'attente sans gestionnaire, lève une exception plutôt que d'écrire des lignes qu'aucun worker ne traitera.

## Crons et fonctions

Tous deux sont des fichiers — `backend/crons/<name>.ts`, `backend/functions/<name>.ts` — et tous deux intègrent le graphe sous le nom du fichier, qui est également l'identifiant sous lequel le planificateur exécute un cron et le chemin où une fonction est montée. Aucun des deux ne se lie à l'environnement ; ils sont présents dans le graphe afin qu'un hôte connaisse les planifications du projet avant d'exécuter quoi que ce soit.

```ts
export default defineCron({
    name: "Nightly cleanup",
    schedule: "0 3 * * *",
    timezone: "Europe/Madrid",
    async handler({ rebase }) { /* … */ }
});
```

Sans `timezone`, la planification est interprétée dans le fuseau horaire de l'hôte — UTC dans presque tous les conteneurs, le vôtre sur un ordinateur portable — de sorte que `0 3 * * *` correspond à une heure différente d'un côté ou de l'autre d'un déploiement. Un fuseau horaire inconnu est refusé lors du chargement du job.

## Comportement en cas d'échec

Une source de données déclarée avec un transport serveur et sans chaîne de connexion **fait échouer le démarrage**, en nommant la variable à définir. Ce comportement est délibéré et important à comprendre : l'alternative serait que les tables acheminées vers la source manquante se replient silencieusement sur la base de données par défaut. Cela signifierait que des données atterrissent au mauvais endroit derrière un serveur qui se déclare en bonne santé — une situation bien pire qu'un conteneur qui refuse de démarrer.

Deux clés qui produiraient le même nom de variable sont également rejetées, car l'une d'entre elles lirait silencieusement la configuration de l'autre.

Les sources déclarées avec `transport: "direct"` sont totalement ignorées : le client communique directement avec elles, de sorte que le backend ne maintient aucune connexion et n'exige aucune configuration à leur sujet.

## Contrôle d'accès au stockage

Les clés de stockage partagent un espace de noms plat et ne sont pas soumises à la sécurité au niveau des lignes. Sans modèle de contrôle d'accès explicite, le comportement par défaut serait donc « tout utilisateur connecté peut lire, écraser, supprimer ou lister n'importe quel objet ». La production refuse de démarrer plutôt que de faire cette supposition.

La méthode pour définir ce que signifie l'accès pour votre projet est d'exporter `storageAuthorize` depuis `backend/storage.ts` — une fonction, car aucune variable d'environnement ne peut exprimer « cet utilisateur a le droit de lire cette clé » :

```ts
// backend/storage.ts
import type { StorageAuthorize } from "@rebasepro/types";

export const storageAuthorize: StorageAuthorize = async ({ key, user, operation }) => {
    if (!user) return false;
    const [ownerId] = key.split("/");
    return ownerId === user.uid || operation === "read";
};
```

Deux options d'échappement par variables d'environnement existent pour les cas où tel est réellement le modèle souhaité :

- `STORAGE_PUBLIC_READ=true` — le bucket est un CDN public en lecture seule. Sans hook `storageAuthorize`, les écritures, suppressions et listages sont réservés aux administrateurs.
- `STORAGE_ALLOW_ANY_AUTHENTICATED=true` — chaque utilisateur connecté a tous les droits sur chaque fichier. Défendable pour une application mono-tenant, jamais pour une application multi-tenant.

## Le stockage en production

Sans bucket configuré, le stockage est **désactivé** en production et les téléversements renvoient une erreur `501`. Le disque local correspond au système de fichiers du conteneur, de sorte que les fichiers qui y sont écrits disparaissent au redémarrage suivant — un téléversement qui échoue explicitement peut être retenté, un téléversement qui a réussi sur un disque sur le point d'être effacé ne le peut pas. Ne définissez `FORCE_LOCAL_STORAGE=true` que lorsqu'un volume persistant est réellement monté.

Ce volume doit héberger chaque bucket local, pas seulement celui par défaut. Le répertoire d'un bucket local nommé se situe aux côtés de celui par défaut, sous `<STORAGE_PATH>__<key>`. Avec `STORAGE_PATH=/storage/uploads`, `bucket("media", { engine: "local" })` écrit dans `/storage/uploads__media`. Montez le volume sur leur répertoire parent, `/storage`, comme le fait le fichier Compose généré par `rebase init`, et non sur `STORAGE_PATH` lui-même. `STORAGE_PATH__MEDIA` définit explicitement le répertoire d'un bucket particulier. Consultez [Auto-hébergement](/docs/deployment/self-hosting/#file-storage).

Déclarer des buckets ne modifie pas le bucket par défaut. Avec seulement `bucket("media")` déclaré, le bucket par défaut lit toujours ses propres variables. En développement, il s'agit de `./uploads`. En production, non lié, il est désactivé comme n'importe quel bucket non lié : les téléversements qui ne spécifient aucune `source` renvoient `501 STORAGE_NOT_CONFIGURED`. Le démarrage le signale une fois, avec les deux correctifs possibles : le lier (`STORAGE_TYPE=s3` et `S3_BUCKET`, ou `STORAGE_TYPE=gcs` et `GCS_BUCKET`), ou marquer un bucket nommé avec `default: true`.

En développement, un bucket déclaré auquel rien n'est lié correspond à un répertoire local — `uploads__media` aux côtés du dossier `uploads` par défaut — quel que soit le moteur qu'il déclare, de sorte que `bucket("media", { engine: "s3" })` combiné à `rebase dev` suffit pour téléverser un fichier. Le démarrage indique quel moteur le répertoire remplace, et `rebase status` l'affiche en jaune à côté de la coche. Cela ne se produit jamais en production, ni sur le runtime managé : un bucket improvisé à cet endroit écrirait les téléversements sur un système de fichiers de conteneur voué à disparaître lors du prochain déploiement, donc un bucket non lié reste non lié et renvoie une erreur 501.

## Voir aussi

- [Vue d'ensemble du backend](/docs/backend/) — où réside chaque déclaration
- [Configuration du stockage](/docs/backend/storage/) — la même structure pour les buckets
- [Environnement & Configuration](/docs/getting-started/configuration/) — la convention `__SUFFIXE` qui lie une source à ses variables
