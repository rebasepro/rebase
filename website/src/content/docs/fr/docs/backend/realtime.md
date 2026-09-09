---
sourceHash: 05f7e05823faa1cf
title: Temps réel & WebSocket
sidebar_label: Temps réel
description: Synchronisation des données en temps réel, canaux de diffusion (broadcast) et suivi de présence via WebSocket.
---

Rebase intègre un moteur temps réel qui transmet les modifications de données aux clients connectés via WebSocket.
Lorsqu'un enregistrement est créé, mis à jour ou supprimé, chaque abonné observant cette collection ou entité reçoit la mise à jour instantanément — sans aucun polling nécessaire.

## Comment ça fonctionne

Le pipeline temps réel comporte trois étapes :

1. **Déclencheur en base de données** — Une mutation atteint la base de données PostgreSQL (via l'API REST, le SDK ou Studio).
2. **Diffusion par le serveur** — Le serveur Rebase détecte la modification et la diffuse à chaque abonnement WebSocket actif correspondant à la collection ou à l'entité concernée.
3. **Callback client** — Le SDK client déclenche votre fonction de rappel `onUpdate` avec les données fraîches.

```
┌──────────────┐      ┌────────────────────┐      ┌──────────────┐
│  PostgreSQL   │─────▶│  Rebase Server     │─────▶│  Client SDK  │
│  LISTEN/NOTIFY│      │  RealtimeService   │      │  WebSocket   │
└──────────────┘      └────────────────────┘      └──────────────┘
```

Pour les déploiements multi-instances, Rebase utilise le mécanisme `LISTEN/NOTIFY` de PostgreSQL pour diffuser les modifications entre les instances du serveur. Cela est géré automatiquement — une connexion PostgreSQL dédiée écoute sur le canal `rebase_entity_changes` et relaie les mises à jour aux abonnés locaux.

### Zéro configuration

Le temps réel est activé par défaut. Il n'y a aucun indicateur à basculer ni aucun service à démarrer — si votre serveur Rebase fonctionne, le point de terminaison WebSocket est disponible.

> Par défaut, Rebase émet également des événements temps réel pour les écritures effectuées **en dehors** de l'API (via `psql`, un autre service ou l'éditeur SQL de Studio) dès que la connexion à la base de données le permet — voir [capture des modifications au niveau de la base de données (CDC)](#database-level-change-capture-cdc).

## Abonnements via le SDK Client

Le SDK client Rebase expose deux méthodes d'abonnement sur chaque accesseur de collection :

- **`listen()`** — S'abonner à une collection entière (avec filtres optionnels).
- **`listenById()`** — S'abonner à une entité unique via son identifiant.

Les deux méthodes renvoient une **fonction de désabonnement** que vous appelez pour cesser de recevoir des mises à jour.

### S'abonner à une collection

Utilisez `listen()` pour recevoir des mises à jour dès que des enregistrements d'une collection changent :

```typescript
const unsubscribe = client.data.products.listen(
  undefined, // FindParams — passez undefined pour tous les enregistrements
  (response) => {
    console.log("Products updated:", response.data);
    console.log("Total:", response.meta.total);
  },
  (error) => {
    console.error("Subscription error:", error);
  }
);
```

La fonction de rappel reçoit un `FindResponse<M>` contenant :
- `data` — Tableau d'objets `Entity<M>`.
- `meta` — Informations de pagination (`total`, `limit`, `offset`, `hasMore`).

### S'abonner à une collection avec des filtres

Passez `FindParams` comme premier argument pour filtrer l'abonnement :

```typescript
const unsubscribe = client.data.products.listen(
  {
    where: { status: ["==", "published"] },
    orderBy: ["createdAt", "desc"],
    limit: 50,
  },
  (response) => {
    console.log("Published products:", response.data);
  }
);
```

Le serveur respecte ces filtres — seuls les enregistrements correspondants sont inclus dans les mises à jour.

### S'abonner à une seule entité

Utilisez `listenById()` pour observer un enregistrement spécifique :

```typescript
const unsubscribe = client.data.products.listenById(
  "product-123",
  (entity) => {
    if (entity) {
      console.log("Product updated:", entity.values);
    } else {
      console.log("Product was deleted");
    }
  },
  (error) => {
    console.error("Subscription error:", error);
  }
);
```

Le callback reçoit `Entity<M> | undefined`. Une valeur `undefined` signifie que l'entité a été supprimée.

### Se désabonner

`listen()` et `listenById()` renvoient toutes deux une fonction de désabonnement. Appelez-la pour cesser de recevoir des mises à jour et libérer les ressources côté serveur :

```typescript
const unsubscribe = client.data.products.listen(undefined, (response) => {
  // gérer les mises à jour
});

// Plus tard, lorsque vous n'avez plus besoin des mises à jour :
unsubscribe();
```

:::tip
Appelez toujours la fonction de désabonnement lorsqu'un composant est démonté ou lors d'un changement de page. Cela évite les fuites de mémoire et les traitements inutiles côté serveur.
:::

## Query Builder `.listen()`

Le query builder fluide prend également en charge les abonnements en temps réel. Enchaînez vos filtres, puis appelez `.listen()` au lieu de `.find()` :

```typescript
const unsubscribe = client.data.orders
  .where("status", "==", "pending")
  .orderBy("createdAt", "desc")
  .limit(20)
  .listen(
    (response) => {
      console.log("Pending orders:", response.data);
    },
    (error) => {
      console.error("Error:", error);
    }
  );
```

:::note
La méthode `.listen()` sur le query builder n'est disponible que lorsque le `RebaseClient` est configuré avec une `websocketUrl`. Si la connexion WebSocket n'est pas configurée, l'appel à `.listen()` lèvera une erreur.
:::

## Distribution des mises à jour : Patch instantané + Récupération de cohérence (Refetch)

Une modification ne transite jamais vers un abonné sous forme de données brutes. Elle transite sous forme de notification signalant qu'une modification a eu lieu, et chaque abonné est ensuite informé de ce qu'*il* est autorisé à voir par une requête exécutée sous sa propre identité :

1. **Invalidation.** Lorsqu'une entité change (créée, mise à jour, supprimée), le serveur marque les chemins affectés. La ligne écrite n'est pas transmise telle quelle — elle a été lue sous l'autorisation de l'auteur de l'écriture, ce qui ne garantit pas qu'un abonné ait le droit de la voir.

2. **Refetch RLS avec debounce.** Après **300ms** (`REFETCH_DEBOUNCE_MS`), le serveur récupère à nouveau la collection avec vos filtres et votre ordre de tri initiaux. La requête s'exécute dans une transaction qui définit les variables locales à la transaction `app.user_id` et `app.user_roles` à partir du `SubscriptionAuthContext` de l'abonné, afin que Postgres évalue la sécurité au niveau des lignes (Row-Level Security) sous l'identité de ce client. Ainsi, seules les lignes qu'il est autorisé à voir sont envoyées dans le `collection_update`. Le debounce permet également de regrouper une rafale d'écritures en une seule requête.

Les versions antérieures envoyaient un `collection_patch` immédiat contenant la ligne modifiée avant ce refetch, afin d'offrir un retour instantané entre les onglets. Cette ligne ayant été lue sous le périmètre de l'auteur de l'écriture, elle pouvait — et de fait, parvenait à — atteindre des abonnés dont les politiques l'auraient refusée, et le filtre `where` de l'abonnement ne lui était pas appliqué non plus. Ce patch a été supprimé : la latence perçue pour une mise à jour correspond désormais à la fenêtre de debounce.

### Le refetch correspond à la lecture REST

Le refetch exécute le même pipeline que `GET /api/data/<collection>`, avec la même gestion des `include`. C'est ce qui garantit que `find({ q })` et `listen({ q })` renvoient des lignes identiques champ par champ.

Il s'agissait auparavant d'une méthode distincte — qui encapsulait chaque relation sous une enveloppe `{ "__type": "relation" }` et, dans la mesure où un abonnement ne pouvait pas comporter d'`include`, chargeait de façon agressive **toutes** les relations déclarées par la collection. Ainsi, la même requête renvoyait une structure sur HTTP et une autre sur le socket, et un client affichant les deux voyait la forme de ses données changer dès qu'une écriture survenait.

Une trame d'abonnement accepte donc les mêmes paramètres qu'une requête de liste : `filter`, `logical`, `orderBy`, `limit`, `offset`/`page`, `searchString`, `include` et `fields`. `vectorSearch` fait exception et est **refusé** avec l'erreur `VECTOR_SEARCH_NOT_LIVE` — un abonnement étant réexécuté à chaque écriture correspondante, aucun calcul de distance n'y est effectué.

### `collection_update` transporte ses propres métadonnées

La trame est structurée ainsi : `{ rows, pks, meta }` :

```json
{
    "type": "collection_update",
    "subscriptionId": "…",
    "rows": [ { "id": 1, "title": "Widget" } ],
    "pks": [ { "fieldName": "id", "type": "number" } ],
    "meta": { "total": 150, "limit": 20, "offset": 0, "hasMore": true, "nextCursor": "eyJ…" }
}
```

`meta` est calculé au sein de la même transaction soumise au RLS qui a lu les lignes, et décrit donc exactement les lignes associées. Sans cela, un client ayant besoin d'un total devait émettre un `GET /count` **à chaque push** — soit un aller-retour supplémentaire par écriture, par abonné, et un intervalle durant lequel le total et les lignes décrivaient des états divergents de la collection.

Lorsque le décompte lui-même échoue, la trame comporte `partial: true` et aucun `total` ; il ne s'agit pas d'une erreur d'abonnement, et le client doit conserver le dernier total réel plutôt que de lui substituer la longueur de la page.

## Canaux de diffusion (Broadcast)

Les canaux de diffusion permettent aux clients de s'envoyer des messages arbitraires en temps réel — très pratique pour des fonctionnalités comme les indicateurs de saisie, les curseurs partagés ou les notifications personnalisées.

La diffusion est gérée au niveau du protocole WebSocket. Le serveur prend en charge les types de messages suivants :

| Type de message  | Direction       | Description                                                 |
|-----------------|-----------------|-------------------------------------------------------------|
| `join_channel`    | Client → Serveur | Rejoindre un canal nommé                                    |
| `leave_channel`   | Client → Serveur | Quitter un canal                                            |
| `broadcast`       | Client → Serveur | Envoyer un message à tous les membres du canal             |
| `broadcast`       | Serveur → Client | Recevoir un message d'un autre membre                       |
| `channel_history` | Client → Serveur | Demander les messages conservés après un numéro de séquence |
| `channel_history` | Serveur → Client | Messages conservés qu'un client a manqués                   |

Lorsqu'un client envoie un message `broadcast`, le serveur le relaie à **tous les autres membres** de ce canal (l'expéditeur ne reçoit pas son propre message).

```typescript
// Structure d'un message broadcast (envoyé par le client)
{
  type: "broadcast",
  payload: {
    channel: "room-42",
    event: "typing",
    payload: { userId: "user-1", isTyping: true }
  }
}

// Reçu par les autres clients dans le canal
{
  type: "broadcast",
  channel: "room-42",
  event: "typing",
  payload: { userId: "user-1", isTyping: true }
}
```

## Rétention des canaux

Par défaut, un message diffusé atteint les membres actuellement connectés puis disparaît. C'est le compromis idéal pour les notifications et les curseurs, sans aucun surcoût de stockage.

Pour un flux d'opérations — édition collaborative, ou tout cas d'usage où une interruption silencieuse entraîne une désynchronisation — un canal peut être configuré pour **retenir** ses messages. Les diffusions retenues reçoivent un numéro de séquence propre au canal et sont stockées, de sorte qu'un client qui se reconnecte peut demander tous les messages postérieurs au dernier qu'il a reçu.

:::caution[Où cela se configure]
**Runtime géré : nulle part.** La rétention des canaux et `realtime.bus` font partie de l'adaptateur de base de données que le runtime géré instancie lui-même, et aucun des deux ne dispose de variable d'environnement. Effectuez un eject pour les configurer.
**Après eject :** `createPostgresAdapter({ realtime })` dans `backend/src/index.ts`.
:::

La rétention est optionnelle et se configure côté serveur :

```typescript
import { initializeRebaseBackend } from "@rebasepro/server";
import { createPostgresAdapter } from "@rebasepro/server-postgres";

await initializeRebaseBackend({
    app,
    server,
    database: createPostgresAdapter({
        connection: db,
        schema: { tables, enums, relations },
        realtime: {
            channels: [
                // Du plus spécifique au plus général — la première correspondance l'emporte.
                { match: "doc:draft:*", limit: 100 },
                { match: "doc:*", limit: 500, ttl: "24h" }
            ]
        }
    })
});
```

| Champ   | Description                                                                 |
|---------|-----------------------------------------------------------------------------|
| `match` | Nom exact du canal (`"doc:42"`) ou préfixe terminé par `*` (`"doc:*"`)       |
| `limit` | Nombre maximal de messages récents à conserver par canal                    |
| `ttl`   | Durée maximale de conservation des messages — `"30s"`, `"15m"`, `"24h"`, `"7d"` ou en millisecondes |

Une règle nécessite au moins `limit` ou `ttl`. Une règle ne comportant ni l'un ni l'autre est ignorée et journalisée, car une rétention illimitée n'est presque jamais souhaitée et ne peut plus être annulée une fois que la table a grossi.

:::note[Pourquoi ne pas laisser les clients demander l'historique ?]
Un canal est créé par quiconque le nomme. Si un client pouvait choisir la profondeur de son propre historique, n'importe quel visiteur pourrait imposer un stockage illimité à votre backend. La configuration côté serveur garantit également que les canaux de présence et de notification — l'écrasante majorité — ne coûtent rien : sans règle configurée, aucune table n'est créée et la diffusion emprunte le même chemin synchrone qu'auparavant.
:::

### Stockage

Les canaux avec rétention s'appuient sur deux tables dans le schéma `rebase`, créées automatiquement au démarrage dès qu'au moins une règle est configurée :

| Table                     | Contenu                                                         |
|---------------------------|-----------------------------------------------------------------|
| `rebase.channel_messages` | Les messages retenus, indexés par `(channel, seq)`              |
| `rebase.channel_cursors`  | Le numéro de séquence le plus élevé émis par canal              |

La purge s'effectue au fil de l'arrivée des messages, régulée par canal pour que le coût dépende du temps écoulé plutôt que du volume d'écriture. Elle ne supprime des lignes que dans `channel_messages` — les curseurs sont conservés indéfiniment (il s'agit d'une seule petite ligne par canal), car réinitialiser la séquence d'un canal modifierait la signification du point de reprise sauvegardé par un client.

### Garanties de livraison

- **Ordonnée.** Les numéros de séquence sont alloués par canal, et l'ordre de livraison correspond à l'ordre des séquences.
- **Durable avant livraison.** Un message qui ne peut pas être stocké n'est livré à personne, et l'expéditeur en est informé. Le livrer l'afficherait aux abonnés connectés tout en l'omettant de tous les replays futurs, et aucun message ultérieur ne pourrait combler ce vide.
- **Au moins une fois lors du rattrapage.** Une plage de replay peut chevaucher des messages qu'un client a déjà reçus ; le SDK ignore ceux qu'il a déjà livrés.

:::caution[L'historique partage le même modèle d'accès que le canal]
Un client ayant rejoint un canal peut rejouer ses messages retenus, y compris ceux diffusés avant son arrivée — l'adhésion est la seule vérification, et rejoindre un canal est ouvert à tout client connaissant son nom. La rétention étant activée par motif de canal, l'activer rend le passé de ce canal lisible par tout visiteur qui en devine le nom. C'est dans le cadre des canaux retenus que cet accès devient persistant plutôt qu'éphémère : considérez donc le contenu d'un canal retenu comme public pour vos utilisateurs.
:::

## Suivi de présence (Presence)

Le suivi de présence permet de savoir quels utilisateurs sont actuellement en ligne dans un canal et autorise chaque utilisateur à partager un état personnalisé (ex. position du curseur, statut).

| Type de message   | Direction       | Description                                                 |
|-------------------|-----------------|-------------------------------------------------------------|
| `presence_track`  | Client → Serveur | Démarrer le suivi de présence avec un état personnalisé      |
| `presence_untrack`| Client → Serveur | Arrêter le suivi de présence                                |
| `presence_state`  | Client → Serveur | Demander l'état de présence complet d'un canal              |
| `presence_state`  | Serveur → Client | Entité complète de toutes les présences dans un canal        |
| `presence_diff`   | Serveur → Client | Mise à jour incrémentielle (arrivées et départs)            |

Lorsqu'un client envoie `presence_track`, le serveur l'ajoute automatiquement au canal (pas besoin d'un `join_channel` distinct) et diffuse un `presence_diff` à tous les membres du canal.

```typescript
// Suivre la présence
{
  type: "presence_track",
  payload: {
    channel: "document-edit-42",
    state: { name: "Alice", cursor: { line: 10, col: 5 } }
  }
}

// Diff de présence reçu par les autres clients
{
  type: "presence_diff",
  channel: "document-edit-42",
  joins: { "client-abc": { name: "Alice", cursor: { line: 10, col: 5 } } },
  leaves: {}
}

// Réponse d'état de présence complet
{
  type: "presence_state",
  channel: "document-edit-42",
  presences: {
    "client-abc": { name: "Alice", cursor: { line: 10, col: 5 } },
    "client-def": { name: "Bob", cursor: { line: 22, col: 0 } }
  }
}
```

Les présences obsolètes sont automatiquement nettoyées après 30 secondes d'inactivité.

## Reconnexion automatique

Le SDK client se reconnecte automatiquement en cas d'interruption de la connexion WebSocket :

- **Backoff exponentiel** — Le délai de reconnexion commence à 1 seconde et double à chaque tentative, avec un plafond de 30 secondes.
- **5 tentatives maximum** — Après 5 tentatives infructueuses, le client cesse d'essayer.
- **Réabonnement automatique** — Lors d'une reconnexion réussie, tous les abonnements actifs sont réenregistrés auprès du serveur, sans intervention manuelle.
- **File d'attente des messages** — Les messages envoyés pendant la déconnexion sont mis en file d'attente et transmis après la reconnexion.

Vous pouvez écouter les événements du cycle de vie de la connexion :

```typescript
// `ws` est indéfini sur un client initialisé sans temps réel, à vérifier au préalable.
const ws = client.ws;
if (ws) {
    ws.on("connect", () => console.log("Connected"));
    ws.on("disconnect", () => console.log("Disconnected"));
    ws.on("reconnect", () => console.log("Reconnected"));
    ws.on("error", (error) => console.error("Error:", error));
}
```

## Authentification & RLS

Les abonnements WebSocket respectent automatiquement les politiques de sécurité au niveau des lignes (RLS). Lorsque le client est authentifié :

1. La connexion WebSocket s'authentifie en utilisant le même jeton JWT que l'API REST.
2. Chaque refetch d'abonnement s'exécute au sein d'une transaction PostgreSQL avec `set_config('app.user_id', ...)` et `set_config('app.user_roles', ...)` — garantissant l'application des politiques RLS.
3. Si un jeton expire pendant une session active, le client se ré-authentifie et se réabonne automatiquement.

Cela garantit que chaque utilisateur ne reçoit que les mises à jour des enregistrements qu'il est autorisé à consulter.

L'exécution sur plusieurs instances — le bus LISTEN/NOTIFY, le comportement de la présence entre processus, et l'écriture de votre propre transport — fait l'objet d'une page dédiée :
[Le temps réel entre plusieurs instances](/docs/backend/realtime-transports/).

## Capture de données de changement au niveau base de données (CDC)

**La capture de données de changement (CDC) est activée par défaut.** Rebase capture les modifications directement au niveau de la base de données et émet des événements temps réel pour **chaque écriture validée (commit), quelle que soit sa provenance** — REST, SDK, Studio, `psql`, une tâche cron dans un autre service, du code Drizzle/SQL brut ou l'**éditeur SQL** de Studio. Il s'agit du même modèle que Supabase Realtime observant le journal de transactions (write-ahead log).

Aucune configuration n'est requise. Sur une connexion de base de données qui le supporte, la CDC s'auto-initialise au démarrage ; sur une connexion qui ne le supporte pas (ex. un rôle restreint ne pouvant pas créer de triggers), Rebase bascule silencieusement sur le temps réel au niveau applicatif — rien à activer, aucun dysfonctionnement.

### Configuration

La CDC est contrôlée par la variable d'environnement `REALTIME_CDC` :

| Valeur | Comportement |
| --- | --- |
| `auto` *(par défaut)* | Active la capture au niveau base de données si la connexion le permet ; **bascule silencieusement** sur le temps réel applicatif sinon. Zéro configuration. |
| `trigger` | Force la capture basée sur les triggers. Fonctionne sur tout PostgreSQL, y compris les instances managées sans réplication logique. Émet un avertissement (au lieu de basculer silencieusement) si l'initialisation échoue. |
| `wal` | Privilégie la réplication logique WAL. Pas encore inclus — se rabat sur `trigger` et journalise le mode actif. |
| `off` | Temps réel au niveau applicatif uniquement. À utiliser pour éviter la surcharge des triggers par écriture sur des charges très intensives en écriture. |

Au démarrage, une ligne de log indique le mode actif, par exemple :

```
📡 [CDC] Realtime source = database-level change capture (mode: trigger).
   All writes now emit realtime events regardless of origin.
```

Si la connexion ne le permet pas, `auto` consigne une ligne informative et poursuit avec le temps réel applicatif :

```
ℹ️ [CDC] Database-level change capture unavailable (likely insufficient
   privileges to create triggers…) — using app-level realtime.
```

### Fonctionnement

1. **Auto-initialisation** — Au démarrage (contexte serveur/propriétaire), Rebase installe un trigger idempotent `AFTER INSERT/UPDATE/DELETE` sur chaque table gérée. Le trigger émet une notification de modification compacte sur le canal `rebase_cdc`. Une charge utile qui dépasserait la limite de 8&nbsp;Ko du `NOTIFY` PostgreSQL bascule sur un message contenant uniquement l'identifiant, garantissant que la CDC ne puisse jamais faire échouer l'écriture déclencheuse.
2. **Capture** — Un client `LISTEN` dédié et non mutualisé par instance consomme `rebase_cdc`, fait correspondre la table modifiée à sa collection, et injecte le changement dans le même pipeline `RealtimeService` que celui utilisé par les mutations API. Tout comme l'écouteur multi-instances, il privilégie `DATABASE_DIRECT_URL` et se reconnecte automatiquement.
3. **Distribution sécurisée avec RLS** — La ligne brute issue du flux de modifications n'est **jamais** transmise directement aux abonnés. La modification est marquée comme invalidée, et chaque abonnement relit la ligne sous son **propre** contexte d'authentification. Le filtrage est donc propre à chaque abonné et jamais à l'émetteur : un client ne reçoit que les lignes autorisées par ses politiques RLS.
4. **Multi-instances** — Chaque instance observant chaque commit à travers le flux de modifications, la CDC *constitue* également le canal inter-instances ; l'ancien mécanisme de diffusion par mutation `rebase_entity_changes` n'est pas utilisé lorsque la CDC est active.
5. **Déduplication** — Une mutation effectuée via l'API Rebase est distribuée localement dès sa validation et est également renvoyée en écho via le flux de modifications. L'instance d'origine supprime cet écho (via un registre temporaire de ses propres émissions), de sorte que les abonnés ne voient jamais une écriture API en double.

### Prérequis & Remarques

- La CDC nécessite une chaîne de connexion directe (`DATABASE_DIRECT_URL` ou la connexion principale) pour le client `LISTEN` — les poolers de connexions en mode transaction ne gèrent pas les sessions `LISTEN` longue durée.
- Les triggers ne sont installés que sur les tables adossées à une collection enregistrée. Les écritures sur des tables non mappées sont ignorées.
- Une collection dont la table n'a pas encore fait l'objet d'une migration est ignorée avec un avertissement au lieu de bloquer la CDC pour le reste.
- Le streaming par réplication logique native WAL (`wal2json`/`pgoutput`) est prévu ; actuellement, `REALTIME_CDC=wal` bascule sur le fonctionnement par trigger, qui offre une couverture équivalente au niveau de la base de données.

## Délai d'expiration des requêtes en attente (Timeout)

Afin d'éviter que les requêtes clientes ne restent bloquées indéfiniment, toutes les opérations WebSocket en attente d'une réponse serveur (telles que la récupération ponctuelle de collection `FETCH_COLLECTION`, la récupération d'une entité unique `FETCH_ONE`, la création/mise à jour `SAVE`, les suppressions `DELETE`, les comptages `COUNT` et les vérifications d'unicité `CHECK_UNIQUE_FIELD`) disposent d'un délai d'expiration par défaut de 30 secondes.

Si le serveur ne répond pas dans cet intervalle de 30 secondes, le client supprime automatiquement la requête en attente et rejette la promesse avec une `ApiError` portant le message `"Request timed out"`.

Les messages unidirectionnels qui n'attendent pas de réponse (comme `subscribe_collection`, `subscribe_one`, `unsubscribe`, `join_channel`, `leave_channel`, `broadcast`, `presence_track`, `presence_untrack` et `presence_state`) sont résolus immédiatement dès leur émission et ne déclenchent pas de timeout.

### Lorsqu'une trame de canal est refusée

Une trame de canal fonctionne en mode fire-and-forget : `await channel.broadcast(...)` est résolu dès que la trame est écrite sur le socket, et **non** lorsque le serveur l'a acceptée. Ce comportement est délibéré — une application collaborative diffuse la position d'un curseur soixante fois par seconde, et attendre un accusé de réception pour chacune transformerait chaque émission en un aller-retour réseau complet.

Par conséquent, un refus ne peut pas prendre la forme d'une promesse rejetée. Il est transmis via `onError` :

```typescript
const channel = client.realtime.channel("doc:42");

channel.onError((error) => {
    if (error.code === "CHANNEL_FORBIDDEN") showReadOnlyBanner();
    if (error.code === "RATE_LIMITED") throttleCursorUpdates();
});
```

| Code | Signification |
|------|---------------|
| `CHANNEL_FORBIDDEN` | Vous n'êtes pas membre du canal — rejoignez-le avant d'émettre ou de lire son historique |
| `RATE_LIMITED` | Dépassement du quota de trames alloué au canal ci-dessus |
| `CHANNEL_HISTORY_WRITE_FAILED` | Une diffusion retenue n'a pas pu être enregistrée et a donc été ignorée |
| `CHANNEL_HISTORY_READ_FAILED` | Une demande de rattrapage d'historique n'a pas pu être traitée |
| `CHANNEL_BUS_PAYLOAD_TOO_LARGE` | La diffusion n'a atteint que cette instance locale — voir [La limite de 8 Ko sur le bus Postgres](#the-8-kb-limit-on-the-postgres-bus) |

Sans gestionnaire attaché, ces erreurs sont journalisées en tant qu'avertissements. Auparavant, elles étaient totalement ignorées : il n'y avait ni promesse à rejeter ni canal où délivrer l'erreur, rendant impossible la distinction entre une diffusion interdite et une diffusion délivrée.

## Prochaines étapes

- [SDK Client](/docs/sdk) — Référence complète du SDK incluant les accesseurs de collections typés.
- [Authentification](/docs/backend/authentication) — Configurer l'authentification JWT et les politiques RLS.
- [Architecture Backend](/docs/backend) — Vue d'ensemble de l'architecture du serveur Rebase.

---
