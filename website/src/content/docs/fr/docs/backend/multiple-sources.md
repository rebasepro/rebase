---
title: Bases de données et buckets multiples
sidebar_label: Sources multiples
description: Acheminez les collections vers différentes bases de données et les propriétés vers différents buckets de stockage, et configurez chacune d'elles depuis l'environnement.
---

## Overview

Un projet n'est pas limité à une seule base de données et un seul bucket. Les collections sont déjà
acheminées par `dataSource`, et les propriétés de fichier par `storageSource` ; cette page explique
comment chaque source nommée obtient sa configuration.

Deux étapes : **déclarer** les sources dans votre package de configuration, puis **configurer**
chacune d'elles avec des variables d'environnement dérivées de sa clé.

## Declaring sources

Exportez `dataSources` et `storageSources` depuis le fichier `index.ts` de votre package de configuration.
Elles sont partagées avec le frontend, qui utilise ces mêmes déclarations pour décider
s'il communique avec une source via l'API Rebase ou directement.

```ts
// config/index.ts
import type { DataSourceDefinition, StorageSourceDefinition } from "@rebasepro/types";

export const dataSources: DataSourceDefinition[] = [
    { key: "(default)", engine: "postgres" },
    { key: "analytics", engine: "postgres", label: "Analytics warehouse" }
];

export const storageSources: StorageSourceDefinition[] = [
    { key: "(default)", engine: "local", transport: "server" },
    { key: "media", engine: "s3", transport: "server", label: "Public media" }
];
```

Pointer ensuite une collection vers l'une d'elles :

```ts
import { defineCollection } from "@rebasepro/admin-types";
const pageViewsCollection = defineCollection({
    name: "Page Views",
    slug: "page_views",
    table: "page_views",
    dataSource: "analytics",
    properties: { /* … */ }
});
```

...ou une propriété de fichier :

```ts
coverImage: {
    name: "Cover image",
    type: "string",
    storage: { storageSource: "media", acceptedFiles: ["image/*"] }
}
```

## Configuring each source

Les noms des variables d'environnement sont dérivés de la clé de la source, il n'y a donc rien
à synchroniser manuellement :

```
<VARIABLE>              the default source     DATABASE_URL, S3_BUCKET
<VARIABLE>__<KEY>       a named source         DATABASE_URL__ANALYTICS, S3_BUCKET__MEDIA
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
ADMIN_CONNECTION_STRING__ANALYTICS=postgres://…
REBASE_DRIVER__ANALYTICS=@rebasepro/server-postgres
```

Le pilote est choisi à partir du moteur (`engine`) déclaré (`postgres` et `mongodb` sont
connus), et `REBASE_DRIVER__<KEY>` le remplace pour tout autre cas.

### Storage

```bash
STORAGE_TYPE__MEDIA=s3
S3_BUCKET__MEDIA=my-media-bucket
S3_REGION__MEDIA=eu-central-1
S3_ACCESS_KEY_ID__MEDIA=…
S3_SECRET_ACCESS_KEY__MEDIA=…
```

`STORAGE_TYPE__<KEY>` peut être omis lorsque la déclaration nomme déjà le moteur.

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

Une conséquence importante à connaître si vous déclarez explicitement des sources de stockage : aucun
bucket par défaut n'est inventé pour vous. Déclarer uniquement une source `media` signifie qu'il
n'y a pas de source `(default)`, et une propriété qui n'en nomme aucune n'a nulle part où
aller — ceci est délibéré et identique en développement et en production. Déclarez
également `(default)` si vous en souhaitez une.

---
