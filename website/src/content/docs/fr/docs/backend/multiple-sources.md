---
sourceHash: 7dadf2d57e6bfecf
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

## Déclarer les ressources

Tout ce dont un projet a besoin et qui porte un nom — une base de données, un
bucket, un topic — se **déclare avec un constructeur**, dans
`config/resources.ts`. Une seule règle, quel que soit le type : il n'y a pas de
second endroit où chercher.

```ts
// config/resources.ts
import { bucket, database, topic } from "@rebasepro/types";

/** La base de données du projet. Lit DATABASE_URL, comme auparavant. */
export const main = database();

/** Une seconde. Lit DATABASE_URL__ANALYTICS. */
export const analytics = database("analytics", { label: "Analytics warehouse" });

/** Un bucket. Lit S3_BUCKET__MEDIA. */
export const media = bucket("media", { engine: "s3", label: "Public media" });

/** Un topic, distribué via la file de tâches durable. */
export const signups = topic<{ userId: string }>("signups");
```

`rebase resources` liste ce qu'un projet déclare, `--write` régénère
`rebase.resources.json` et `--check` échoue si ce fichier est périmé. Ce fichier
est **généré** et versionné : c'est ce qu'un hôte lit pour décider quoi
provisionner *avant* d'exécuter quoi que ce soit.

Un moteur inconnu est refusé à l'endroit de l'appel, et non plus tard. Pour un
moteur que cette build ne connaît pas, on écrit `custom:` — par exemple
`bucket("objects", { engine: "custom:minio" })`.

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

### Quel bucket reçoit un envoi non qualifié

Une propriété de stockage qui ne nomme aucune `storageSource` écrit dans le
bucket **par défaut**, et un projet à buckets nommés doit dire lequel c'est.
Soit vous déclarez le bucket par défaut — `export const uploads = bucket();` —
soit vous marquez l'un des buckets nommés :

```ts
export const media = bucket("media", { engine: "s3", default: true });
```

Le démarrage refuse un projet dont les buckets sont tous nommés et dont aucun
n'est le défaut, et il nomme les deux solutions. Auparavant le premier déclaré
était retenu, avec un avertissement : cela décidait de l'endroit où atterrissent
les fichiers d'un utilisateur par ordre de déclaration, et la réponse différait
de part et d'autre d'un déploiement, car le bucket local dont le développement
se sert comme doublure est écarté en production — la promotion, non.

Pointer ensuite une collection vers l'une d'elles :

```ts
import { defineCollection } from "@rebasepro/cms-types";
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

### Plusieurs buckets sur un seul compte

Chaque variable est lue par clé : c'est juste pour le *nom* du bucket et faux
pour les identifiants — quinze buckets sur la même installation MinIO
signifieraient quinze copies de la même clé d'accès. Nommez un `account` et les
variables au niveau du fournisseur ne sont lues qu'une fois :

```ts
export const media   = bucket("media",   { engine: "s3", account: "minio" });
export const avatars = bucket("avatars", { engine: "s3", account: "minio" });
```

```
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
