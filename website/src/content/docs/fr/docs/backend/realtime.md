---
sourceHash: da709fdddc946e75
title: Temps réel & WebSocket
sidebar_label: Temps réel
description: Synchronisation des données en temps réel, canaux de diffusion et suivi de présence via WebSocket.
---

Rebase inclut un moteur temps réel intégré qui transmet les modifications de données aux clients connectés via WebSocket.
Lorsqu'un enregistrement est créé, mis à jour ou supprimé, chaque abonné observant cette collection ou entité reçoit la mise à jour instantanément — aucun sondage (polling) n'est requis.

## Fonctionnement

Le pipeline temps réel comporte trois étapes :

1. **Déclencheur de base de données** — Une mutation atteint la base de données PostgreSQL (via l'API REST, le SDK ou Studio).
2. **Distribution par le serveur (fan-out)** — Le serveur Rebase détecte le changement et le distribue à chaque abonnement WebSocket actif correspondant à la collection ou à l'entité concernée.
3. **Rappel côté client** — Le SDK client exécute votre fonction de rappel `onUpdate` avec les nouvelles données.

```
┌──────────────┐      ┌────────────────────┐      ┌──────────────┐
│  PostgreSQL   │─────▶│  Rebase Server     │─────▶│  Client SDK  │
│  LISTEN/NOTIFY│      │  RealtimeService   │      │  WebSocket   │
└──────────────┘      └────────────────────┘      └──────────────┘
```

Pour les déploiements multi-instances, Rebase utilise le mécanisme `LISTEN/NOTIFY` de PostgreSQL pour diffuser les modifications entre les instances du serveur. Cela est géré automatiquement — une connexion PostgreSQL dédiée écoute sur le canal `rebase_entity_changes` et relaie les mises à jour aux abonnés locaux.

### Zéro configuration

Le temps réel est activé par défaut. Il n'y a aucun paramètre à modifier ni aucun service à démarrer — si votre serveur Rebase fonctionne, le point de terminaison WebSocket est disponible.

> Par défaut, Rebase émet également des événements en temps réel pour les écritures effectuées **en dehors** de l'API (via `psql`, un autre service ou l'éditeur SQL de Studio) dès que la connexion à la base de données le permet — voir [capture de données modifiées au niveau de la base de données](#capture-des-modifications-au-niveau-de-la-base-de-données-cdc).

## Abonnements avec le SDK Client

Le SDK client Rebase expose deux méthodes d'abonnement sur chaque accesseur de collection :

- **`listen()`** — S'abonner à une collection entière (avec des filtres optionnels).
- **`listenById()`** — S'abonner à une entité spécifique par son identifiant.

Les deux méthodes renvoient une **fonction de désabonnement** que vous appelez pour cesser de recevoir les mises à jour.

### S'abonner à une collection

Utilisez `listen()` pour recevoir des mises à jour dès que les enregistrements d'une collection changent :

```typescript
const unsubscribe = client.data.products.listen(
  undefined, // FindParams — pass undefined for all records
  (response) => {
    console.log("Products updated:", response.data);
    console.log("Total:", response.meta.total);
  },
  (error) => {
    console.error("Subscription error:", error);
  }
);
```

La fonction de rappel reçoit un objet `FindResponse<M>` contenant :
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

La fonction de rappel reçoit `Entity<M> | undefined`. Une valeur `undefined` signifie que l'entité a été supprimée.

### Se désabonner

Tant `listen()` que `listenById()` renvoient une fonction de désabonnement. Appelez-la pour cesser de recevoir les mises à jour et libérer les ressources côté serveur :

```typescript
const unsubscribe = client.data.products.listen(undefined, (response) => {
  // handle updates
});

// Later, when you no longer need updates:
unsubscribe();
```

:::tip
Appelez toujours la fonction de désabonnement lorsqu'un composant est démonté ou lors d'une navigation vers une autre page. Cela évite les fuites de mémoire et les calculs inutiles côté serveur.
:::

## `.listen()` avec le Query Builder

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
La méthode `.listen()` sur le query builder n'est disponible que lorsque le `RebaseClient` est configuré avec un `websocketUrl`. Si la connexion WebSocket n'est pas configurée, l'appel de `.listen()` générera une erreur.
:::

## Distribution des mises à jour : Patch instantané + Récupération pour exactitude

Une modification ne voyage jamais vers un abonné sous forme de données brutes. Elle voyage sous la forme du fait que quelque chose a changé, et chaque abonné est ensuite informé de ce qu'*il* est autorisé à voir via une requête exécutée avec son identité :

1. **Invalidation.** Lorsqu'une entité change (créée, mise à jour, supprimée), le serveur marque les chemins affectés. La ligne écrite n'est pas transmise — elle a été lue sous l'autorisation de l'auteur de l'écriture, ce qui ne préjuge en rien de ce qu'un abonné quelconque a le droit de voir.

2. **Nouvelle requête RLS temporisée (debounce).** Après **300 ms** (`REFETCH_DEBOUNCE_MS`), le serveur réexécute la requête sur la collection avec vos filtres et votre ordre de tri d'origine. La requête s'exécute dans une transaction qui définit `app.user_id` et `app.user_roles` au niveau de la transaction à partir du `SubscriptionAuthContext` de l'abonné. Postgres évalue ainsi la sécurité au niveau des lignes (RLS) sous l'identité de ce client, et seules les lignes qu'il est autorisé à voir sont envoyées dans `collection_update`. La temporisation (debounce) permet également de regrouper une rafale d'écritures en une seule requête.

Les versions antérieures envoyaient un `collection_patch` immédiat contenant la ligne écrite avant cette nouvelle requête, pour un retour inter-onglets inférieur à la milliseconde. Cette ligne ayant été lue sous les droits de l'auteur de l'écriture, elle pouvait — et de fait parvenait — à des abonnés dont les propres politiques l'auraient refusée, et le filtre `where` de l'abonnement ne lui était pas non plus appliqué. Ce patch a été supprimé : la latence perçue pour une mise à jour correspond désormais à la fenêtre de temporisation (debounce).

### La nouvelle requête équivaut à la lecture REST

La nouvelle requête exécute le même pipeline que `GET /api/data/<collection>`, avec la même gestion de `include`. C'est ce qui permet à `find({ q })` et `listen({ q })` de renvoyer des lignes rigoureusement identiques, champ par champ.

Auparavant, il s'agissait d'une méthode différente — qui imbriquait chaque relation sous une enveloppe `{ "__type": "relation" }` et, comme un abonnement ne pouvait pas comporter de `include`, chargeait systématiquement (**eager loading**) chaque relation déclarée par la collection. Ainsi, la même requête renvoyait un format via HTTP et un autre via le socket, et un client affichant les deux voyait ses lignes changer de format dès qu'une écriture survenait.

Une trame d'abonnement prend donc les mêmes paramètres qu'une requête de liste : `filter`, `logical`, `orderBy`, `limit`, `offset`/`page`, `searchString`, `include` et `fields`. `vectorSearch` constitue l'exception et est **refusé** avec l'erreur `VECTOR_SEARCH_NOT_LIVE` — un abonnement étant réexécuté à chaque écriture correspondante, rien à ce niveau ne calcule de distances.

### `collection_update` transporte ses propres métadonnées

La trame est de la forme `{ rows, pks, meta }` :

```json
{
    "type": "collection_update",
    "subscriptionId": "…",
    "rows": [ { "id": 1, "title": "Widget" } ],
    "pks": [ { "fieldName": "id", "type": "number" } ],
    "meta": { "total": 150, "limit": 20, "offset": 0, "hasMore": true, "nextCursor": "eyJ…" }
}
```

`meta` est comptabilisé au sein de la même transaction soumise au RLS ayant lu les lignes, il décrit donc précisément les lignes qui l'accompagnent. Sans cela, un client ayant besoin d'un total devait émettre un `GET /count` **par notification reçue** — un aller-retour supplémentaire par écriture et par abonné, et un intervalle durant lequel le total et les lignes décrivaient des états différents de la collection.

Lorsque le décompte lui-même échoue, la trame comporte `partial: true` et aucun `total` ; cela ne constitue pas une erreur d'abonnement, et un client doit conserver le dernier total réel plutôt que de lui substituer la longueur de la page.

## Canaux de diffusion (Broadcast Channels)

Les canaux de diffusion permettent aux clients de s'envoyer mutuellement des messages arbitraires en temps réel — utile pour des fonctionnalités telles que les indicateurs de frappe, la position des curseurs ou les notifications personnalisées.

La diffusion est gérée au niveau du protocole WebSocket. Le serveur prend en charge ces types de messages :

| Type de message | Sens | Description |
|-----------------|-----------------|------------------------------------------|
| `join_channel` | Client → Serveur | Rejoindre un canal nommé |
| `leave_channel` | Client → Serveur | Quitter un canal |
| `broadcast` | Client → Serveur | Envoyer un message à tous les membres du canal |
| `broadcast` | Serveur → Client | Recevoir un message d'un autre membre |
| `channel_history` | Client → Serveur | Demander les messages conservés après une séquence |
| `channel_history` | Serveur → Client | Les messages conservés qu'un client a manqués |

Lorsqu'un client envoie un message `broadcast`, le serveur le relaie à **tous les autres membres** de ce canal (l'expéditeur ne reçoit pas son propre message).

```typescript
// Broadcast message structure (sent by client)
{
  type: "broadcast",
  payload: {
    channel: "room-42",
    event: "typing",
    payload: { userId: "user-1", isTyping: true }
  }
}

// Received by other clients in the channel
{
  type: "broadcast",
  channel: "room-42",
  event: "typing",
  payload: { userId: "user-1", isTyping: true }
}
```

## Rétention des canaux

Par défaut, une diffusion parvient aux membres actuellement connectés, puis disparaît. C'est le compromis idéal pour les notifications et les curseurs, et cela ne coûte rien.

Pour un flux d'opérations — édition collaborative ou toute situation où une interruption silencieuse entraîne une divergence —, un canal peut être configuré pour **retenir** ses messages. Les diffusions retenues se voient attribuer un numéro de séquence par canal et sont stockées, de sorte qu'un client qui se reconnecte puisse demander tout ce qui a suivi le dernier message qu'il a reçu.

:::caution[Où cela se configure]
**Runtime managé : nulle part.** La rétention de canal et `realtime.bus` font partie de l'adaptateur de base de données que le runtime managé construit lui-même, et aucun des deux ne dispose d'une variable d'environnement. Éjectez le projet pour les configurer.
**Éjecté :** `createPostgresAdapter({ realtime })` dans `backend/src/index.ts`.
:::

La rétention est optionnelle et se configure ici, sur le serveur :

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
                // Most specific first — the first match wins.
                { match: "doc:draft:*", limit: 100 },
                { match: "doc:*", limit: 500, ttl: "24h" }
            ]
        }
    })
});
```

| Champ | Description |
|---------|-----------------------------------------------------------------------------|
| `match` | Nom exact du canal (`"doc:42"`) ou préfixe terminé par un astérisque `*` (`"doc:*"`) |
| `limit` | Conserver au maximum ce nombre de messages les plus récents par canal |
| `ttl` | Conserver les messages pendant cette durée au maximum — `"30s"`, `"15m"`, `"24h"`, `"7d"` ou millisecondes |

Une règle nécessite au moins `limit` ou `ttl`. Une règle ne comportant ni l'un ni l'autre est ignorée et journalisée, car une rétention illimitée n'est presque jamais souhaitée et il est impossible de revenir en arrière une fois que la table a grossi.

:::note[Pourquoi ne pas laisser les clients demander l'historique ?]
Un canal est créé par quiconque le nomme. Si un client pouvait choisir la profondeur de son propre historique, n'importe quel visiteur pourrait contraindre votre backend à un stockage illimité. La configurer ici signifie également que les canaux de présence et de notification — l'écrasante majorité — ne coûtent rien : en l'absence de règles configurées, aucune table n'est créée et la diffusion emprunte le même chemin synchrone qu'auparavant.
:::

### Stockage

Les canaux avec rétention utilisent deux tables dans le schéma `rebase`, créées automatiquement au démarrage lorsqu'au moins une règle est configurée :

| Table | Contenu |
|---------------------------|-----------------------------------------------------------------|
| `rebase.channel_messages` | Les messages retenus, indexés par `(channel, seq)` |
| `rebase.channel_cursors` | Le numéro de séquence le plus élevé émis par canal |

Le nettoyage (pruning) s'effectue à l'arrivée des messages, régulé par canal afin que le coût soit proportionnel au temps écoulé plutôt qu'au volume d'écriture. Il ne supprime jamais que des lignes de `channel_messages` — les curseurs sont conservés indéfiniment (ils représentent une petite ligne par canal), car réinitialiser la séquence d'un canal modifierait la signification du point de reprise enregistré d'un client.

### Garanties de livraison

- **Ordonnée.** Les numéros de séquence sont alloués par canal, et l'ordre de livraison correspond à l'ordre des séquences.
- **Durable avant d'être livré.** Un message qui ne peut pas être stocké n'est livré à personne, et l'expéditeur en est informé. Le livrer le présenterait aux abonnés connectés en direct tout en l'excluant de tout rejeu futur, et aucun message ultérieur ne pourrait combler cet écart.
- **Au moins une fois lors du rattrapage (At-least-once).** Une plage de rejeu peut chevaucher des messages qu'un client a déjà reçus ; le SDK élimine ceux qu'il a déjà livrés.

:::caution[L'historique partage le même modèle d'accès que le canal]
Un client qui a rejoint un canal peut rejouer ses messages retenus, y compris ceux diffusés avant son arrivée — l'appartenance au canal est le seul contrôle, et le rejoindre est ouvert à tout client connaissant son nom. La rétention s'active par motif de canal (pattern), son activation rend donc le passé de ce canal accessible à tout visiteur qui en devine le nom. Les canaux avec rétention rendent cette accessibilité durable plutôt qu'éphémère ; considérez par conséquent le contenu d'un canal avec rétention comme public pour vos utilisateurs.
:::

## Suivi de présence (Presence Tracking)

La présence permet de suivre quels utilisateurs sont actuellement en ligne dans un canal et permet à chacun de partager un état personnalisé (ex. : position du curseur, statut).

| Type de message | Sens | Description |
|-------------------|-----------------|------------------------------------------------------|
| `presence_track` | Client → Serveur | Commencer à suivre la présence avec un état personnalisé |
| `presence_untrack`| Client → Serveur | Arrêter le suivi de présence |
| `presence_state` | Client → Serveur | Demander l'état de présence complet d'un canal |
| `presence_state` | Serveur → Client | Entité complète de toutes les présences dans un canal |
| `presence_diff` | Serveur → Client | Mise à jour incrémentielle (arrivées et départs) |

Lorsqu'un client envoie `presence_track`, le serveur l'ajoute automatiquement au canal (nul besoin d'un `join_channel` distinct) et diffuse un `presence_diff` à tous les membres du canal.

```typescript
// Track presence
{
  type: "presence_track",
  payload: {
    channel: "document-edit-42",
    state: { name: "Alice", cursor: { line: 10, col: 5 } }
  }
}

// Presence diff received by other clients
{
  type: "presence_diff",
  channel: "document-edit-42",
  joins: { "client-abc": { name: "Alice", cursor: { line: 10, col: 5 } } },
  leaves: {}
}

// Full presence state response
{
  type: "presence_state",
  channel: "document-edit-42",
  presences: {
    "client-abc": { name: "Alice", cursor: { line: 10, col: 5 } },
    "client-def": { name: "Bob", cursor: { line: 22, col: 0 } }
  }
}
```

Les présences inactives sont automatiquement nettoyées après 30 secondes d'inactivité.

## Reconnexion automatique

Le SDK client se reconnecte automatiquement lorsque la connexion WebSocket est interrompue :

- **Temporisation exponentielle (Exponential backoff)** — Les délais de reconnexion débutent à 1 seconde et doublent à chaque tentative, avec un plafond à 30 secondes.
- **5 tentatives au maximum** — Après 5 tentatives infructueuses de reconnexion, le client cesse d'essayer.
- **Réabonnement automatique** — En cas de reconnexion réussie, tous les abonnements actifs sont réenregistrés auprès du serveur. Aucune intervention manuelle n'est requise.
- **Mise en file d'attente des messages** — Les messages envoyés pendant la déconnexion sont mis en file d'attente et délivrés après la reconnexion.

Vous pouvez écouter les événements liés au cycle de vie de la connexion :

```typescript
// `ws` is undefined on a client built without realtime, so narrow it once.
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
2. Chaque réévaluation d'abonnement s'exécute dans une transaction PostgreSQL avec `set_config('app.user_id', ...)` et `set_config('app.user_roles', ...)` — garantissant ainsi l'application des politiques RLS.
3. Le jeton est vérifié une seule fois, lors de l'authentification du socket, et le serveur ne le revérifie pas pendant toute la durée de la connexion. Un jeton d'accès qui expire, une session révoquée ou un rôle retiré ne modifie pas ce qu'un socket ouvert peut lire tant qu'il ne se réauthentifie pas ou ne se reconnecte pas. Le SDK réauthentifie son socket chaque fois qu'il actualise son jeton, et le déconnecte lors de la déconnexion ; un client utilisant directement le protocole conserve l'identité avec laquelle il a ouvert la connexion jusqu'à ce qu'il se reconnecte.

Cela signifie que chaque socket ne reçoit que les mises à jour relatives aux enregistrements que son identité authentifiée est autorisée à voir.

L'exécution de plusieurs instances — le bus LISTEN/NOTIFY, le comportement de la présence inter-processus et l'écriture de votre propre transport — dispose de sa propre page :
[Le temps réel multi-instances](/docs/backend/realtime-transports/).

## Capture des modifications au niveau de la base de données (CDC)

**Le Change Data Capture (CDC) est activé par défaut.** Rebase capture les modifications au niveau de la base de données et émet des événements en temps réel pour **chaque écriture validée (commit), quelle que soit sa provenance** — REST, SDK, Studio, `psql`, une tâche cron dans un autre service, Drizzle/SQL brut, ou l'**éditeur SQL** de Studio. Il s'agit du même modèle que Supabase Realtime suivant le journal de réécriture (WAL).

Aucune configuration n'est requise. Sur une connexion de base de données qui le prend en charge, le CDC s'auto-provisionne au démarrage ; sur une connexion qui ne le permet pas (par exemple, un rôle restreint qui ne peut pas créer de déclencheurs), Rebase bascule silencieusement sur le temps réel au niveau applicatif — rien à activer, aucun dysfonctionnement.

### Configuration

Le CDC est contrôlé par la variable d'environnement `REALTIME_CDC` :

| Valeur | Comportement |
| --- | --- |
| `auto` *(par défaut)* | Activer la capture au niveau de la base de données lorsque la connexion le permet ; **basculer silencieusement** sur le temps réel au niveau applicatif dans le cas contraire. Zéro configuration. |
| `trigger` | Forcer la capture basée sur les déclencheurs (triggers). Fonctionne sur tout PostgreSQL, y compris les instances managées sans réplication logique. Émet un avertissement (au lieu de basculer silencieusement) si le provisionnement échoue. |
| `wal` | Préférer la réplication logique WAL. Pas encore inclus — se rabat sur `trigger` et journalise le mode actif. |
| `off` | Temps réel au niveau applicatif uniquement. À utiliser pour éviter la surcharge liée aux déclencheurs sur les charges de travail à forte intensité d'écriture. |

Au démarrage, vous verrez une ligne de log indiquant le mode actif, par ex. :

```
📡 [CDC] Realtime source = database-level change capture (mode: trigger).
   All writes now emit realtime events regardless of origin.
```

Si la connexion ne le prend pas en charge, `auto` consigne une ligne d'information à la place et poursuit avec le temps réel au niveau applicatif :

```
ℹ️ [CDC] Database-level change capture unavailable (likely insufficient
   privileges to create triggers…) — using app-level realtime.
```

### Fonctionnement

1. **Auto-provisionnement** — Au démarrage (contexte serveur/propriétaire), Rebase installe un déclencheur idempotent `AFTER INSERT/UPDATE/DELETE` sur chaque table managée. Le déclencheur émet une notification de modification compacte sur le canal `rebase_cdc`. Une charge utile qui dépasserait la limite de 8&nbsp;Ko de `NOTIFY` dans PostgreSQL se rabat sur un message d'identité uniquement, de sorte que le CDC ne puisse jamais interrompre l'écriture déclencheuse.
2. **Capture** — Un client `LISTEN` dédié et hors pool par instance consomme `rebase_cdc`, associe la table modifiée à sa collection correspondante, et transmet la modification au même pipeline `RealtimeService` que celui utilisé par les mutations d'API. Tout comme le récepteur multi-instances, il privilégie `DATABASE_DIRECT_URL` et se reconnecte automatiquement.
3. **Livraison sécurisée avec RLS** — La ligne brute provenant du flux de modifications n'est **jamais** transmise aux abonnés. La modification est marquée comme invalidée, et chaque abonnement relit la ligne sous son **propre** contexte d'authentification. Le filtrage s'effectue donc par abonné, jamais par émetteur : un client ne reçoit jamais que les lignes permises par ses politiques RLS.
4. **Multi-instances** — Étant donné que chaque instance observe chaque commit via le flux de modifications, le CDC *est* également le canal inter-instances ; l'ancienne diffusion par mutation `rebase_entity_changes` n'est pas utilisée tant que le CDC est actif.
5. **Déduplication** — Une mutation effectuée via l'API Rebase est livrée localement dès sa validation (commit) et est également répercutée en écho via le flux de modifications. L'instance d'origine supprime cet écho (via un enregistrement éphémère de ses propres émissions), de sorte que les abonnés ne voient jamais une écriture API en double.

### Prérequis & Remarques

- Le CDC nécessite une chaîne de connexion directe (`DATABASE_DIRECT_URL` ou la connexion principale) pour le client `LISTEN` — les gestionnaires de pools de connexions (connection poolers) en mode transaction ne prennent pas en charge les sessions `LISTEN` de longue durée.
- Les déclencheurs ne sont installés que sur les tables adossées à une collection enregistrée. Les écritures sur des tables non associées sont ignorées.
- Une collection dont la table n'a pas encore fait l'objet d'une migration est ignorée avec un avertissement au lieu de bloquer le CDC pour le reste.
- Le streaming natif par réplication logique WAL (`wal2json`/`pgoutput`) est prévu ; aujourd'hui, `REALTIME_CDC=wal` se rabat sur la méthode basée sur les déclencheurs, qui fournit une couverture équivalente au niveau de la base de données.

## Expiration des requêtes en attente (Timeout)

Pour éviter que les requêtes des clients ne restent indéfiniment bloquées, toutes les opérations WebSocket en attente qui attendent une réponse du serveur (telles que les requêtes ponctuelles de collection `FETCH_COLLECTION`, les requêtes d'entité unique `FETCH_ONE`, la création/mise à jour `SAVE`, les suppressions `DELETE`, les comptages `COUNT` et les vérifications d'unicité `CHECK_UNIQUE_FIELD`) ont un délai d'expiration par défaut de 30 secondes.

Si le serveur ne répond pas dans cet intervalle de 30 secondes, le client supprime automatiquement la requête en attente et rejette la promesse avec une erreur `ApiError` portant le message `"Request timed out"`.

Les messages unidirectionnels qui n'attendent pas de réponse (comme `subscribe_collection`, `subscribe_one`, `unsubscribe`, `join_channel`, `leave_channel`, `broadcast`, `presence_track`, `presence_untrack` et `presence_state`) sont résolus immédiatement lors de l'envoi et ne déclenchent pas de délai d'expiration.

### Lorsqu'une trame de canal est refusée

Une trame de canal fonctionne selon le principe « tirer et oublier » (fire-and-forget) : `await channel.broadcast(...)` est résolu dès que la trame est écrite sur le socket, et **non** lorsque le serveur l'a acceptée. C'est délibéré — une application collaborative diffuse la position d'un curseur soixante fois par seconde, et attendre un accusé de réception pour chacune transformerait chaque envoi en un aller-retour réseau.

Un refus ne peut donc pas être une promesse rejetée. Il parvient via `onError` :

```typescript
const channel = client.realtime.channel("doc:42");

channel.onError((error) => {
    if (error.code === "CHANNEL_FORBIDDEN") showReadOnlyBanner();
    if (error.code === "RATE_LIMITED") throttleCursorUpdates();
});
```

| Code | Signification |
|------|-------|
| `CHANNEL_FORBIDDEN` | Vous n'êtes pas membre du canal — rejoignez-le avant d'émettre ou de lire son historique |
| `RATE_LIMITED` | Dépassement du quota de trames de canal ci-dessus |
| `CHANNEL_HISTORY_WRITE_FAILED` | Une diffusion retenue n'a pas pu être persistée et a donc été abandonnée |
| `CHANNEL_HISTORY_READ_FAILED` | Une requête de rattrapage n'a pas pu être satisfaite |
| `CHANNEL_BUS_PAYLOAD_TOO_LARGE` | La diffusion n'a atteint que cette instance — voir [La limite de 8 Ko sur le bus Postgres](/docs/backend/realtime-transports/#the-8-kb-limit-on-the-postgres-bus) |

Si aucun gestionnaire n'est attaché, ces événements sont journalisés sous forme d'avertissement. Auparavant, ils étaient entièrement ignorés : il n'y avait aucune promesse à rejeter ni aucun canal auquel les transmettre, de sorte qu'une diffusion interdite ne pouvait pas être distinguée d'une diffusion menée à bien.

## Prochaines étapes

- [SDK Client](/docs/sdk) — Référence complète du SDK, y compris les accesseurs de collection typés.
- [Authentification](/docs/backend/authentication) — Configurer l'authentification JWT et les politiques RLS.
- [Architecture Backend](/docs/backend) — Vue d'ensemble de l'architecture du serveur Rebase.
