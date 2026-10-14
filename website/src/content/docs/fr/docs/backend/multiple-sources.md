---
sourceHash: cc03d759eb4057c2
title: Multiples bases de données et buckets
sidebar_label: Multiples sources
description: Acheminez les collections vers différentes bases de données et les propriétés vers différents buckets de stockage, et configurez chacun depuis l'environnement.
---

## Vue d'ensemble

Un projet n'est pas limité à une seule base de données et un seul bucket. Chaque élément nommé dont un
projet a besoin — une base de données, un bucket, un topic, une file d'attente (queue) — est **déclaré avec un
constructeur dans votre configuration**, et configuré depuis l'environnement par une variable
dérivée de sa clé. Les tâches cron et les fonctions sont des fichiers, et elles intègrent le même
graphe sous le nom du fichier.

Une règle unique, quel que soit le type : il n'y a aucun second endroit où chercher, et rien qui
ne doive être synchronisé à la main.

## Déclarer des ressources

Placez-les dans `config/resources.ts`. Les exporter est une bonne pratique — cela
vous donne de quoi importer —, mais c'est la déclaration qui les enregistre.

```ts
// config/resources.ts
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

`queue()` est nouveau. `database()`, `bucket()` et `topic()`
peuvent être déclarés depuis la version 0.17 ; ainsi, un projet sur la version publiée déclare
ces trois éléments et accède au travail en arrière-plan via `jobs.tasks` à la place.

Pointez ensuite une collection vers l'un d'eux, par son handle — le même nom, orthographié une seule fois :

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

`defineCollection` enregistre la clé du handle, de sorte qu'au-delà de ce point, une collection n'est que
de simples données — elle se sérialise, se compare, atteint l'interface d'administration. La forme sous forme
de chaîne (`dataSource: "analytics"`) fonctionne toujours ; le handle est celui qu'un renommage
suit et sur lequel mène la commande « aller à la définition » (jump-to-definition).

Dans une fonction, les mêmes handles permettent d'accéder à la ressource :

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

### Visualiser ce que vous avez déclaré

```bash
rebase resources            # list them
rebase resources --write    # regenerate rebase.resources.json
rebase resources --check    # fail if that file is stale
```

`rebase.resources.json` est **généré** et versionné dans Git. C'est ce qu'un hôte lit
pour décider quoi provisionner *avant* d'exécuter quoi que ce soit — c'est ainsi qu'une console
peut indiquer « ce projet a besoin d'un bucket `media` et n'en a aucun » lors d'un premier déploiement.
Modifiez les déclarations, jamais le fichier ; `--check` fait échouer un build si les deux
ne concordent pas.

Chaque entrée enregistre également **qui l'utilise** — `collection:page_views` sur une
base de données, `property:posts.cover` sur un bucket, `function:report` sur tout ce
que la fonction importe depuis `resources.ts`. C'est la cartographie dont une console a besoin pour
répondre à la question « qu'est-ce qui casse si je supprime ceci ».

`rebase status` va encore plus loin : pour chaque déclaration, il indique si
l'environnement la lie (bind), en utilisant les mêmes résolveurs que ceux du démarrage, évitant ainsi
de vous rassurer faussement sur un déploiement qui est sur le point de refuser de démarrer.

### Un moteur inconnu du build

Chaque type possède sa propre liste de moteurs, et un moteur inconnu est rejeté au point
d'appel plutôt qu'accepté pour échouer plus tard. Quelque chose de véritablement hors liste
s'écrit avec `custom:` :

```ts
export const objects = bucket("objects", { engine: "custom:minio" });
```

### Corriger un type qui a déjà été livré

Pour les auteurs de pilotes (drivers). La définition enregistrée d'un type de ressource est **gelée** dès lors
qu'un paquet l'intégrant a été publié : chaque pilote publié intègre en ligne sa propre
copie de `@rebasepro/types`, et cette copie compare l'entrée du registre partagé
à son propre littéral et lève une exception à la moindre différence. Modifier le littéral
rendrait donc inopérant tout bundle compilé avec un ancien pilote lors du chargement de ce dernier.

`amendResourceKind` corrige ce qu'un type *lie* — ses bases d'environnement, ses
clés d'options — sans toucher au littéral que toute copie plus ancienne compare :

```ts
import { amendResourceKind } from "@rebasepro/types";

amendResourceKind("database", {
    envBases: ["DATABASE_URL", "DATABASE_READ_URL", "ADMIN_CONNECTION_STRING"]
});
```

La modification s'applique uniquement aux lectures via cette copie, de sorte qu'un pilote plus ancien continue
d'effectuer les liaisons comme il le faisait lors de sa publication. Utilisez-le pour chaque correction apportée à un
type livré ; n'utilisez `registerResourceKind` que pour un type que personne n'a publié.

### Les transmettre au frontend

Le fournisseur `<Rebase>` a besoin de savoir quelles sources existent et comment chacune est
jointe — une source `direct` est une source avec laquelle le navigateur communique directement. Il importe
le même paquet de configuration que le backend, ce qui lui permet de réutiliser les déclarations plutôt
que de les répéter :

```tsx
import "../config/resources";                 // registers them
import { declaredDataSources, declaredStorageSources } from "@rebasepro/types";

<Rebase
    dataSources={declaredDataSources()}
    storageSources={declaredStorageSources()}
>
    {children}
</Rebase>
```

L'import à effet de bord est délibéré : c'est la déclaration qui effectue l'enregistrement, donc un bundler
qui supprimerait un module inutilisé laisserait les deux listes vides.

## Configurer chaque source

Les noms des variables d'environnement sont dérivés de la clé de la ressource, il n'y a donc
rien à synchroniser manuellement :

```
<VARIABLE>              the default resource   DATABASE_URL, S3_BUCKET
<VARIABLE>__<KEY>       a named resource       DATABASE_URL__ANALYTICS, S3_BUCKET__MEDIA
```

La clé est mise en majuscules et les caractères non alphanumériques sont remplacés par des tirets bas, ainsi
`media-cdn` lit `S3_BUCKET__MEDIA_CDN`.

Le séparateur est volontairement un **double** tiret bas. Un simple tiret bas entrerait en collision
avec de vrais noms de variables — `S3_BUCKET_NAME` serait interprété comme le bucket d'une
source nommée `name`.

### Bases de données

```bash
DATABASE_URL=postgres://localhost/app
DATABASE_URL__ANALYTICS=postgres://warehouse.internal/analytics

# Optional, per source:
DB_POOL_MAX__ANALYTICS=5
REBASE_DRIVER__ANALYTICS=@rebasepro/server-postgres
```

Le pilote est choisi à partir du moteur (`engine`) déclaré (`postgres` et `mongodb` sont
connus), et `REBASE_DRIVER__<KEY>` le surcharge pour tout le reste.
`REBASE_DB_POOL_MAX` est une limite globale au niveau du processus, pas une liaison par source, donc il
ne prend aucun suffixe.

En développement, vous ne configurez rien de tout cela : `rebase dev` dessert chaque base de données
déclarée depuis son instance Postgres gérée — une deuxième instance pour `analytics`, démarrée
à la demande — et exporte `DATABASE_URL__ANALYTICS` lui-même. Une variable définie
manuellement n'est jamais écrasée.

Les tables et les politiques de sécurité au niveau des lignes (row-level-security) sont provisionnées **par source** : une
collection acheminée vers `analytics` obtient sa table, ainsi que ses politiques, dans la
base de données analytics.

### Stockage

```bash
S3_BUCKET__MEDIA=my-media-bucket
S3_REGION__MEDIA=eu-central-1
S3_ACCESS_KEY_ID__MEDIA=…
S3_SECRET_ACCESS_KEY__MEDIA=…
```

Le moteur provient de la déclaration, il n'y a donc aucun `STORAGE_TYPE` à définir.

#### Quel bucket reçoit un téléversement non qualifié

<span class="since-badge" data-since="0.25">Depuis 0.25</span>

Une propriété de stockage qui ne spécifie aucun `storageSource` écrit dans le bucket par **défaut**.
Déclarer des buckets nommés ne le déplace jamais. Le bucket par défaut garde sa propre
configuration, quoi que déclare `config/resources.ts` : `STORAGE_TYPE`,
`STORAGE_PATH` (`./uploads` s'il n'est pas défini), et les variables `S3_*` / `GCS_*`
sans suffixe. Ajouter `bucket("media", { engine: "s3" })` à un projet qui a déjà
des fichiers dans `./uploads` les laisse où ils sont, et toujours servis. `media`
lit ses propres variables `__MEDIA` et, en développement, se rabat sur son propre
répertoire, `uploads__media`.

Pour envoyer plutôt les téléversements non qualifiés vers un bucket nommé, marquez-le :

```ts
export const media = bucket("media", { engine: "s3", default: true });
```

Le bucket par défaut *est* alors `media`. Les fichiers que contenait l'ancien bucket par défaut
restent où ils sont et ne sont plus servis par lui ; copiez-les donc d'abord :
`rebase storage move --from "(default)" --to media`.

Deux sources ne peuvent pas partager un emplacement. Si un bucket nommé se résolvait vers le
répertoire du bucket par défaut (ou un répertoire qu'il contient), ou vers le même bucket d'un
magasin d'objets sur le même point de terminaison, le démarrage refuse et nomme la variable à modifier.

En 0.24, un projet qui ne déclare que des buckets nommés voit le premier d'entre eux déclaré
promu bucket par défaut au démarrage, avec un avertissement : ajouter `bucket("media")`
déplace donc le bucket par défaut vers `uploads__media`.

### Plusieurs buckets sur un même compte

Chaque variable est lue par clé, ce qui est adapté pour le nom du bucket mais inadapté pour
les identifiants — quinze buckets sur une même installation MinIO signifieraient quinze copies
de la même clé d'accès. Renseignez un compte (`account`) et les variables au niveau du fournisseur
ne seront lues qu'une seule fois :

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

La configuration par compte couvre les variables décrivant le *fournisseur* :
`S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_ENDPOINT`, `S3_REGION`,
`S3_FORCE_PATH_STYLE`, `GCS_PROJECT_ID` et `GCS_KEY_FILENAME`. Le nom du bucket
n'en fait pas partie et ne bascule jamais vers une valeur par défaut — si c'était le cas, deux buckets sur un même compte
fusionneraient silencieusement en un seul.

Une valeur définie par bucket reste prioritaire si vous en spécifiez une, de sorte qu'une source unique peut être déplacée
vers un autre fournisseur sans détacher les autres de leur compte partagé. Il n'y a
délibérément aucun repli vers la variable sans suffixe : celle-ci appartient à la
source par défaut, et permettre à un bucket nommé d'en hériter risquerait de faire signer une clé
mal orthographiée avec les identifiants d'une autre source.

## Topics et files d'attente (queues)

Un topic est distribué via la file de tâches durables : la publication écrit **une ligne
par abonnement**, de sorte que chaque abonné réessaie selon son propre calendrier et qu'un abonné
défaillant ne bloque pas les autres et ne les force pas à s'exécuter à nouveau.

```ts
await signups.publish({ userId });
```

Une file d'attente (queue) représente l'autre forme de travail en arrière-plan : une liste de tâches avec **un
seul gestionnaire (handler)**, où l'appelant détient l'identifiant de la tâche. Les files d'attente sont nouvelles
 — les topics ont été introduits dans la version 0.17.

```ts
export const thumbnails = queue<{ key: string }>("thumbnails");
thumbnails.handler(async ({ key }, { attempt }) => { /* … */ });

const { id } = await thumbnails.enqueue({ key }, { runAt: new Date(Date.now() + 60_000) });
```

Les deux fonctionnent selon le principe du **au moins une fois (at-least-once)**. Un worker qui s'interrompt
alors qu'il traite une tâche la libère, et le suivant relance le gestionnaire depuis le début ; un gestionnaire doit donc
tolérer de recevoir un événement deux fois. Une publication ou un ajout à la file au sein d'une transaction qui est annulée (rollback)
est considéré comme n'ayant jamais eu lieu — il s'agit d'une insertion de ligne.

Déclarer l'un ou l'autre active automatiquement la file de tâches, sur chaque chemin de démarrage — un
projet sur le runtime géré, qui n'a pas de point d'entrée pour transmettre `jobs.tasks`,
obtient ses gestionnaires de cette façon. Publier sur un topic que rien ne déclare, ou
ajouter à une file d'attente sans gestionnaire, lève une exception plutôt que d'écrire des lignes
qu'aucun worker ne traite.

## Tâches cron et fonctions

Toutes deux sont des fichiers — `backend/crons/<name>.ts`, `backend/functions/<name>.ts` —
et toutes deux intègrent le graphe sous le nom du fichier, qui est également l'identifiant sous lequel le
planificateur exécute une tâche cron et le chemin sur lequel une fonction est montée. Aucune des deux ne se lie à partir
de l'environnement ; elles figurent dans le graphe afin qu'un hôte connaisse les planifications d'un projet
avant d'exécuter quoi que ce soit.

```ts
export default defineCron({
    name: "Nightly cleanup",
    schedule: "0 3 * * *",
    timezone: "Europe/Madrid",
    async handler({ rebase }) { /* … */ }
});
```

Sans `timezone`, la planification est interprétée dans le fuseau horaire propre à l'hôte — UTC dans presque
tous les conteneurs, le vôtre sur un ordinateur portable — de sorte que `0 3 * * *` correspond à une heure différente
avant et après un déploiement. Un fuseau horaire inconnu est refusé lors du chargement de la tâche.

## Comportement en cas d'erreur

Une source de données déclarée avec un transport serveur ne disposant d'aucune chaîne de connexion **fait échouer
le démarrage**, en indiquant la variable à définir. Ce comportement est délibéré et mérite d'être compris :
l'alternative serait que les collections acheminées vers la source manquante basculent
silencieusement vers la base de données par défaut. Cela conduirait à enregistrer des données au mauvais endroit derrière un
serveur qui s'affiche comme sain — ce qui est bien pire qu'un conteneur qui refuse de
démarrer.

Deux clés qui dériveraient vers le même nom de variable sont également rejetées, car l'une
d'elles lirait silencieusement la configuration de l'autre.

Les sources déclarées avec `transport: "direct"` sont complètement ignorées : le client
communique directement avec elles, le backend ne maintient donc aucune connexion et n'exige
aucune configuration pour celles-ci.

## Contrôle d'accès au stockage

Les clés de stockage partagent un espace de noms plat unique et ne sont pas soumises à la sécurité au niveau des lignes, donc
sans modèle de contrôle d'accès explicite, le comportement par défaut serait « tout utilisateur connecté
peut lire, écraser, supprimer ou lister n'importe quel objet ». L'environnement de production refuse de démarrer
plutôt que d'adopter cette supposition.

La façon de définir ce que signifie l'accès pour votre projet est d'exporter `storageAuthorize`
depuis le paquet de configuration — une fonction, car aucune variable d'environnement ne peut exprimer
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

Il existe deux échappatoires via l'environnement pour les cas où cela correspond réellement au modèle souhaité :

- `STORAGE_PUBLIC_READ=true` — le bucket est un CDN public en lecture seule. Les écritures,
  suppressions et listages nécessitent toujours une authentification.
- `STORAGE_ALLOW_ANY_AUTHENTICATED=true` — chaque utilisateur authentifié a un accès de confiance à
  l'ensemble des fichiers. Défendable pour une application mono-tenant, jamais pour une application multi-tenant.

## Le stockage en production

Si aucun bucket n'est configuré, le stockage est **désactivé** en production et les téléversements renvoient
`501`. Le disque local étant le système de fichiers du conteneur, les fichiers qui y sont écrits disparaissent
au redémarrage suivant — un téléversement qui échoue bruyamment peut être retenté, alors qu'un téléversement réussi
sur un disque sur le point d'être effacé ne le peut pas. Ne définissez `FORCE_LOCAL_STORAGE=true` que lorsqu'un
volume persistant est réellement monté.

Ce volume doit contenir chaque bucket local, et pas seulement celui par défaut. Le répertoire d'un bucket
local nommé se situe aux côtés de celui par défaut, `<STORAGE_PATH>__<key>`.
Avec `STORAGE_PATH=/storage/uploads`, `bucket("media", { engine: "local" })`
écrit dans `/storage/uploads__media`. Montez le volume sur leur dossier parent,
`/storage`, comme le fait le fichier compose généré par `rebase init`, et non sur
`STORAGE_PATH` directement. `STORAGE_PATH__MEDIA` définit explicitement le répertoire d'un bucket spécifique. Consultez [Auto-hébergement](/docs/deployment/self-hosting/#file-storage).

<span class="since-badge" data-since="0.25">Depuis 0.25</span> Déclarer des
buckets ne change pas le bucket par défaut. Avec seulement `bucket("media")`
déclaré, le bucket par défaut lit toujours ses propres variables. En développement, c'est
`./uploads`. En production, sans liaison, il est désactivé comme tout bucket non lié :
les téléversements qui ne nomment aucun `storageSource` répondent `501 STORAGE_NOT_CONFIGURED`.
Le démarrage le dit une fois, avec les deux solutions : le lier (`STORAGE_TYPE=s3` et
`S3_BUCKET`, ou `STORAGE_TYPE=gcs` et `GCS_BUCKET`), ou marquer un bucket nommé `default: true`.

En développement, un bucket déclaré que rien ne lie est un répertoire local —
`uploads__media` aux côtés de `uploads` par défaut — quel que soit le moteur déclaré, de sorte que
`bucket("media", { engine: "s3" })` combiné à `rebase dev` suffit pour téléverser un
fichier. Le démarrage indique quel moteur le répertoire remplace, et `rebase
status` l'affiche en jaune à côté de la coche. Cela ne se produit jamais en production,
ni sur le runtime géré : un bucket inventé à cet endroit écrirait les téléversements sur un
système de fichiers de conteneur qui disparaît au déploiement suivant, ainsi un bucket non lié
reste non lié et répond 501.

## Liens associés

- [Vue d'ensemble du backend](/docs/backend/) — `dataSources` et l'emplacement de la déclaration
- [Configuration du stockage](/docs/backend/storage/) — la même structure pour les buckets
- [Environnement et configuration](/docs/getting-started/configuration/) — la convention `__SUFFIX` qui lie une source à ses variables
