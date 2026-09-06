---
sourceHash: 7dadf2d57e6bfecf
title: Bases de données et buckets multiples
sidebar_label: Sources multiples
description: Acheminez les collections vers différentes bases de données et les propriétés vers différents buckets de stockage, et configurez chacune d'elles depuis l'environnement.
---

## Overview

Un projet n'est pas limité à une seule base de données et un seul bucket. Tout
ce dont un projet a besoin et qui porte un nom — une base de données, un bucket,
un topic, une file — est **déclaré avec un constructeur dans votre
configuration**, et configuré depuis l'environnement par une variable dérivée de
sa clé. Les crons et les fonctions sont des fichiers, et ils entrent dans le
même graphe sous le nom du fichier.

Une seule règle, quel que soit le type : il n'y a pas de second endroit où
chercher, et rien à maintenir synchronisé à la main.

## Déclarer les ressources

Placez-les dans `config/resources.ts`. Les exporter est une bonne pratique —
cela vous donne quelque chose à importer —, mais c'est la déclaration qui les
enregistre.

```ts
// config/resources.ts
import { bucket, database, queue, topic } from "@rebasepro/types";

/** La base de données du projet. Lit DATABASE_URL, comme auparavant. */
export const main = database();

/** Une seconde. Lit DATABASE_URL__ANALYTICS. */
export const analytics = database("analytics", { label: "Analytics warehouse" });

/** Un bucket. Lit S3_BUCKET__MEDIA. */
export const media = bucket("media", { engine: "s3", label: "Public media" });

/** Un topic, distribué via la file de tâches durable. */
export const signups = topic<{ userId: string }>("signups");

signups.subscription("send-welcome", async (event) => {
    // …
});
```

`queue()` est nouveau <span class="since-badge" data-since="0.18">Since 0.18</span>. `database()`, `bucket()` et `topic()`
sont déclarables depuis 0.17 : un projet sur la version publiée déclare donc ces
trois-là et atteint le travail en arrière-plan via `jobs.tasks`.

Pointez ensuite une collection vers l'une d'elles, par handle — le même nom,
écrit une seule fois :

```ts
import { defineCollection } from "@rebasepro/cms-types";
import { analytics } from "../resources";

const pageViewsCollection = defineCollection({
    name: "Page Views",
    slug: "page_views",
    table: "page_views",
    dataSource: analytics,
    properties: { /* … */ }
});
```

...ou une propriété de fichier :

```ts
import { media } from "../resources";

coverImage: {
    name: "Cover image",
    type: "string",
    storage: { storageSource: media, acceptedFiles: ["image/*"] }
}
```

`defineCollection` retient la clé du handle : passé ce point, une collection est
de la donnée simple — elle se sérialise, elle se compare, elle atteint
l'interface d'administration. La forme chaîne (`dataSource: "analytics"`)
fonctionne toujours ; c'est le handle qu'un renommage suit et sur lequel « aller
à la définition » atterrit.

Dans une fonction, ces mêmes handles atteignent la ressource :

```ts
import { defineFunction } from "@rebasepro/server/functions";
import { analytics, media } from "../../config/resources";

export default defineFunction((app, { rebase }) => {
    app.post("/report", async (c) => {
        const rows = await rebase.sql("select count(*) from page_views", { database: analytics });
        const file = new File([JSON.stringify(rows)], "report.json", { type: "application/json" });
        await rebase.bucket(media).putObject({ key: "report.json", file });
        return c.json({ ok: true });
    });
});
```

### Voir ce que vous avez déclaré

<span class="since-badge" data-since="0.18">Since 0.18</span>

```bash
rebase resources            # les lister
rebase resources --write    # régénérer rebase.resources.json
rebase resources --check    # échouer si ce fichier est périmé
```

`rebase.resources.json` est **généré** et versionné. C'est ce qu'un hôte lit
pour décider quoi provisionner *avant* d'exécuter quoi que ce soit — c'est ainsi
qu'une console peut dire « ce projet veut un bucket `media` et n'en a aucun » au
premier déploiement. Modifiez les déclarations, jamais le fichier ; `--check`
fait échouer une build si les deux divergent.

Chaque entrée enregistre aussi **qui l'utilise** — `collection:page_views` sur
une base de données, `property:posts.cover` sur un bucket, `function:report` sur
ce que la fonction importe de `resources.ts`. C'est la carte dont une console a
besoin pour répondre à « qu'est-ce qui casse si je retire ceci ».

`rebase status` va un cran plus loin : pour chaque déclaration, il dit si
l'environnement la lie, en utilisant les mêmes résolveurs que le démarrage — il
ne peut donc pas vous rassurer sur un déploiement qui est sur le point de
refuser de démarrer.

### Un moteur dont la build n'a jamais entendu parler

Chaque type possède sa propre liste de moteurs, et un moteur inconnu est refusé
à l'endroit de l'appel plutôt qu'accepté puis mis en échec plus tard. Quelque
chose de véritablement hors de la liste s'écrit `custom:` :

```ts
export const objects = bucket("objects", { engine: "custom:minio" });
```

### Corriger un kind déjà publié

<span class="since-badge" data-since="0.18">Since 0.18</span>

Pour les auteurs de drivers. La définition enregistrée d'un kind de ressource
est **figée** dès qu'un paquet la contenant est publié : chaque driver publié
embarque sa propre copie de `@rebasepro/types`, et cette copie compare l'entrée
du registre partagé à son propre littéral et lève une erreur à la moindre
différence. Modifier le littéral tue donc tout bundle construit avec un driver
plus ancien, au chargement du driver.

`amendResourceKind` corrige ce à quoi un kind *se lie* — ses bases de variables
d'environnement, ses clés d'options — sans toucher au littéral que compare une
copie plus ancienne :

```ts
import { amendResourceKind } from "@rebasepro/types";

amendResourceKind("database", {
    envBases: ["DATABASE_URL", "DATABASE_READ_URL", "ADMIN_CONNECTION_STRING"]
});
```

La correction ne s'applique qu'aux lectures passant par cette copie : un driver
plus ancien continue donc de se lier comme au jour de sa publication. Utilisez-la
pour toute correction d'un kind publié ; `registerResourceKind` ne sert que pour
un kind que personne n'a publié.

### Les transmettre au frontend

Le provider `<Rebase>` doit savoir quelles sources existent et comment chacune
est atteinte — une source `direct` est une source à laquelle le navigateur parle
lui-même. Il importe le même package de configuration que le backend, il peut
donc réutiliser les déclarations plutôt que de les répéter :

```tsx
import "../config/resources";                 // les enregistre
import { declaredDataSources, declaredStorageSources } from "@rebasepro/types";

<Rebase
    dataSources={declaredDataSources()}
    storageSources={declaredStorageSources()}
>
    {children}
</Rebase>
```

L'import à effet de bord est délibéré : c'est la déclaration qui enregistre, et
un bundler qui supprimerait un module inutilisé laisserait les deux listes
vides.

## Configuring each source

Les noms des variables d'environnement sont dérivés de la clé de la ressource, il n'y a donc rien
à synchroniser manuellement :

```
<VARIABLE>              the default resource   DATABASE_URL, S3_BUCKET
<VARIABLE>__<KEY>       a named resource       DATABASE_URL__ANALYTICS, S3_BUCKET__MEDIA
```

La clé est mise en majuscules et les caractères non alphanumériques deviennent des tirets bas,
ainsi `media-cdn` lit `S3_BUCKET__MEDIA_CDN`.

Le séparateur est un **double** tiret bas à dessein. Un seul tiret bas entrerait en collision
avec de vrais noms de variables — `S3_BUCKET_NAME` serait interprété comme le bucket pour une
source appelée `name`.

### Databases

```bash
DATABASE_URL=postgres://localhost/app
DATABASE_URL__ANALYTICS=postgres://warehouse.internal/analytics

# Optional, per source:
DB_POOL_MAX__ANALYTICS=5
REBASE_DRIVER__ANALYTICS=@rebasepro/server-postgres
```

Le pilote est choisi à partir du moteur (`engine`) déclaré (`postgres` et `mongodb` sont
connus), et `REBASE_DRIVER__<KEY>` le remplace pour tout autre cas.
`REBASE_DB_POOL_MAX` est un plafond valable pour tout le processus, pas une
liaison par source : il ne prend donc pas de suffixe.

En développement, vous ne réglez rien de tout cela : `rebase dev` sert chaque
base de données déclarée depuis son Postgres managé — une seconde instance pour
`analytics`, démarrée à la demande — et exporte `DATABASE_URL__ANALYTICS`
lui-même. Une variable que vous définissez à la main n'est jamais écrasée.

Les tables et les politiques de sécurité au niveau des lignes sont provisionnées
**par source** : une collection acheminée vers `analytics` obtient sa table, et
ses politiques, dans la base de données analytics.

### Storage

```bash
S3_BUCKET__MEDIA=my-media-bucket
S3_REGION__MEDIA=eu-central-1
S3_ACCESS_KEY_ID__MEDIA=…
S3_SECRET_ACCESS_KEY__MEDIA=…
```

Le moteur vient de la déclaration : il n'y a donc pas de `STORAGE_TYPE` à
définir.

#### Quel bucket reçoit un envoi non qualifié

Une propriété de stockage qui ne nomme aucune `storageSource` écrit dans le
bucket **par défaut**, et un projet à buckets nommés doit dire lequel c'est.
Soit vous déclarez le bucket portant la clé par défaut — `export const uploads =
bucket();` — soit vous marquez l'un des buckets nommés :

```ts
export const media = bucket("media", { engine: "s3", default: true });
```

Le démarrage refuse un projet dont les buckets sont tous nommés et dont aucun
n'est le défaut, et il nomme les deux solutions. Auparavant le premier déclaré
était retenu, avec un avertissement : cela décidait de l'endroit où atterrissent
les fichiers d'un utilisateur par ordre de déclaration, et la réponse différait
de part et d'autre d'un déploiement, car le bucket local dont le développement
se sert comme doublure est écarté en production — la promotion, non.

### Plusieurs buckets sur un seul compte

Chaque variable est lue par clé : c'est juste pour le *nom* du bucket et faux
pour les identifiants — quinze buckets sur la même installation MinIO
signifieraient quinze copies de la même clé d'accès. Nommez un `account` et les
variables au niveau du fournisseur ne sont lues qu'une fois :

```ts
export const media   = bucket("media",   { engine: "s3", account: "minio" });
export const avatars = bucket("avatars", { engine: "s3", account: "minio" });
```

```bash
S3_BUCKET__MEDIA=project-media       # par bucket, jamais partagé
S3_BUCKET__AVATARS=project-avatars
S3_ACCESS_KEY_ID__MINIO=…            # lue une fois, par les deux
S3_SECRET_ACCESS_KEY__MINIO=…
S3_ENDPOINT__MINIO=https://minio.internal
```

La forme compte couvre les variables qui décrivent le *fournisseur* :
`S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_ENDPOINT`, `S3_REGION`,
`S3_FORCE_PATH_STYLE`, `GCS_PROJECT_ID` et `GCS_KEY_FILENAME`. Le nom du bucket
n'en fait pas partie et ne retombe jamais sur le compte — si c'était le cas,
deux buckets sur un même compte deviendraient silencieusement un seul.

Une valeur par bucket l'emporte toujours, de sorte qu'une source peut être
déplacée vers un autre fournisseur sans détacher les autres de leur compte
partagé. Il n'y a délibérément aucun repli sur la variable sans suffixe : celle-ci
appartient à la source par défaut, et laisser un bucket nommé en hériter
signifierait qu'une clé mal saisie signe avec les identifiants d'une autre source.

## Topics et files

Un topic est distribué via la file de tâches durable : publier écrit **une ligne
par abonnement**, de sorte que chaque abonné réessaie selon son propre rythme et
qu'un abonné cassé ne bloque pas les autres et ne les fait pas rejouer.

```ts
await signups.publish({ userId });
```

Une file est l'autre forme du travail en arrière-plan : une liste de travaux
avec **un seul handler**, où l'appelant conserve l'id de la tâche. Les files
sont nouvelles <span class="since-badge" data-since="0.18">Since 0.18</span> — les topics sont arrivés en 0.17.

```ts
export const thumbnails = queue<{ key: string }>("thumbnails");
thumbnails.handler(async ({ key }, { attempt }) => { /* … */ });

const { id } = await thumbnails.enqueue({ key }, { runAt: new Date(Date.now() + 60_000) });
```

Les deux sont **at-least-once**. Un worker qui meurt en tenant une tâche la
libère, et le suivant reprend le handler depuis le début : un handler doit donc
tolérer de voir un événement deux fois. Publier ou mettre en file à l'intérieur
d'une transaction annulée n'a jamais eu lieu — c'est une insertion de ligne.

Déclarer l'un ou l'autre allume la file de tâches à elle seule, sur tous les
chemins de démarrage — un projet sur le runtime managé, qui n'a pas de point
d'entrée par lequel passer `jobs.tasks`, obtient ses handlers ainsi. Publier
dans un topic que personne ne déclare, ou mettre en file sur une file sans
handler, lève une erreur au lieu d'écrire des lignes qu'aucun worker ne traite.

## Crons et fonctions

Les deux sont des fichiers — `backend/crons/<name>.ts`,
`backend/functions/<name>.ts` — et les deux entrent dans le graphe sous le nom
du fichier, qui est aussi l'id sous lequel le planificateur exécute un cron et le
chemin où une fonction est montée. Ni l'un ni l'autre ne se lie depuis
l'environnement ; ils sont dans le graphe pour qu'un hôte connaisse les
plannings d'un projet avant d'exécuter quoi que ce soit.

```ts
export default defineCron({
    name: "Nightly cleanup",
    schedule: "0 3 * * *",
    timezone: "Europe/Madrid",
    async handler({ rebase }) { /* … */ }
});
```

Sans `timezone`, le planning est lu dans le fuseau de l'hôte — UTC dans presque
tous les conteneurs, le vôtre sur un portable —, si bien que `0 3 * * *` désigne
une heure différente de part et d'autre d'un déploiement. Un fuseau inconnu est
refusé au chargement de la tâche.

## Failure behaviour

Une source de données déclarée avec un transport serveur qui ne possède aucune chaîne de connexion **fait échouer le démarrage**,
en indiquant le nom de la variable à définir. C'est délibéré et important à comprendre :
l'alternative serait que les collections acheminées vers la source manquante basculent silencieusement
sur la base de données par défaut. Cela entraînerait l'enregistrement de données au mauvais endroit derrière
un serveur qui se déclare en bonne santé — ce qui est bien pire qu'un conteneur qui refuse de démarrer.

Deux clés qui dériveraient le même nom de variable sont également rejetées, car l'une
d'elles lirait silencieusement la configuration de l'autre.

Les sources déclarées avec `transport: "direct"` sont entièrement ignorées : le client
communique directement avec elles, le backend ne maintient donc aucune connexion et n'exige
aucune configuration pour celles-ci.

## Storage access control

Les clés de stockage partagent un espace de noms plat et ne relèvent pas de la sécurité au niveau des lignes (row-level security),
donc sans modèle de contrôle d'accès explicite, le comportement par défaut serait « tout utilisateur connecté
peut lire, écraser, supprimer ou lister n'importe quel objet ». L'environnement de production refuse de démarrer
plutôt que d'assumer cela.

La façon de définir ce que signifie l'accès pour votre projet est un export `storageAuthorize`
depuis le package de configuration — une fonction, car aucune variable d'environnement ne peut exprimer
« cet utilisateur peut lire cette clé » :

```ts
// config/index.ts
import type { StorageAuthorize } from "@rebasepro/types";

export const storageAuthorize: StorageAuthorize = async ({ key, user, operation }) => {
    if (!user) return false;
    const [ownerId] = key.split("/");
    return ownerId === user.uid || operation === "read";
};
```

Deux exceptions par variables d'environnement existent pour les cas où c'est réellement ce modèle qui est souhaité :

- `STORAGE_PUBLIC_READ=true` — le bucket est un CDN public en lecture seule. Les écritures,
  suppressions et listages nécessitent toujours une authentification.
- `STORAGE_ALLOW_ANY_AUTHENTICATED=true` — chaque utilisateur connecté a accès à
  tous les fichiers. Défendable pour une application mono-tenant, jamais pour une application multi-tenant.

## Storage in production

Lorsqu'aucun bucket n'est configuré, le stockage est **désactivé** en production et les téléversements répondent
`501`. Le disque local correspond au système de fichiers du conteneur, donc les fichiers qui y sont écrits disparaissent au
redémarrage suivant — un téléversement qui échoue de manière explicite peut être réessayé, alors qu'un téléversement
ayant réussi sur un disque sur le point d'être effacé ne le peut pas. Ne définissez `FORCE_LOCAL_STORAGE=true` que lorsqu'un
volume durable est réellement monté.

Une conséquence importante à connaître si vous déclarez explicitement des
buckets : aucun bucket par défaut n'est inventé pour vous. Déclarer seulement
`bucket("media")` signifie qu'il n'y a pas de bucket par défaut, et une
propriété qui n'en nomme aucun n'a nulle part où aller — délibérément, et de
façon identique en développement et en production. Ajoutez aussi `bucket()` si
vous en voulez un.

En développement, un bucket déclaré que rien ne lie est un répertoire local —
`uploads__media` à côté du `uploads` par défaut — quel que soit le moteur qu'il
déclare : `bucket("media", { engine: "s3" })` plus `rebase dev` suffit donc à
téléverser un fichier. Le démarrage indique pour quel moteur le répertoire fait
la doublure, et `rebase status` l'affiche en jaune à côté de la coche. Cela
n'arrive jamais en production, ni sur le runtime managé : un bucket inventé
là-bas écrirait les téléversements dans un système de fichiers de conteneur qui
disparaît au prochain déploiement — un bucket non lié reste donc non lié et
répond 501.

## Voir aussi

- [Aperçu du backend](/docs/backend/) — `dataSources` et l'endroit où vit la déclaration
- [Configuration du stockage](/docs/backend/storage/) — la même forme pour les buckets
- [Environnement et configuration](/docs/getting-started/configuration/) — la convention `__SUFFIX` qui lie une source à ses variables

---
