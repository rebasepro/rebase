---
sourceHash: b05865d9a4f8b3f2
title: Temps réel et WebSocket
sidebar_label: Temps réel
description: Synchronisation des données en temps réel, canaux de diffusion et suivi de présence via WebSocket.
---

Rebase inclut un moteur temps réel intégré qui pousse les changements de données vers les clients connectés via WebSocket.
Lorsqu'un enregistrement est créé, mis à jour ou supprimé, chaque abonné qui surveille cette collection ou entité reçoit la mise à jour instantanément — aucun polling requis.

## Fonctionnement

Le pipeline temps réel comporte trois étapes :

1. **Déclencheur de base de données** — Une mutation atteint la base de données PostgreSQL (via l'API REST, le SDK ou Studio).
2. **Fan-out du serveur** — Le serveur Rebase détecte le changement et le diffuse à chaque abonnement WebSocket actif qui correspond à la collection ou entité concernée.
3. **Callback client** — Le SDK client déclenche votre callback `onUpdate` avec les données fraîches.

```
┌──────────────┐      ┌────────────────────┐      ┌──────────────┐
│  PostgreSQL   │─────▶│  Rebase Server     │─────▶│  Client SDK  │
│  LISTEN/NOTIFY│      │  RealtimeService   │      │  WebSocket   │
└──────────────┘      └────────────────────┘      └──────────────┘
```

Pour les déploiements multi-instances, Rebase utilise `LISTEN/NOTIFY` de PostgreSQL pour diffuser les changements entre les instances du serveur. Ceci est géré automatiquement — une connexion PostgreSQL dédiée écoute sur le canal `rebase_entity_changes` et relaie les mises à jour aux abonnés locaux.

### Zéro configuration

Le temps réel est activé d'emblée. Il n'y a aucun indicateur à basculer ni service à démarrer — si votre serveur Rebase fonctionne, l'endpoint WebSocket est disponible.

> Par défaut, Rebase émet également des événements temps réel pour les écritures effectuées **en dehors** de l'API (via `psql`, un autre service ou l'éditeur SQL de Studio) chaque fois que la connexion à la base de données le prend en charge — voir [capture des changements au niveau de la base de données](#capture-des-changements-au-niveau-de-la-base-de-données-cdc).

## Abonnements du SDK client

Le SDK client Rebase expose deux méthodes d'abonnement sur chaque accesseur de collection :

- **`listen()`** — S'abonner à une collection entière (avec des filtres optionnels).
- **`listenById()`** — S'abonner à une seule entité par son ID.

Les deux méthodes renvoient une **fonction de désabonnement** que vous appelez pour cesser de recevoir des mises à jour.

### S'abonner à une collection

Utilisez `listen()` pour recevoir des mises à jour chaque fois que les enregistrements d'une collection changent :

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

Le callback reçoit un `FindResponse<M>` contenant :
- `data` — Tableau d'objets `Entity<M>`.
- `meta` — Infos de pagination (`total`, `limit`, `offset`, `hasMore`).

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

Utilisez `listenById()` pour surveiller un enregistrement spécifique :

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

`listen()` et `listenById()` renvoient tous deux une fonction de désabonnement. Appelez-la pour cesser de recevoir des mises à jour et libérer les ressources côté serveur :

```typescript
const unsubscribe = client.data.products.listen(undefined, (response) => {
  // handle updates
});

// Later, when you no longer need updates:
unsubscribe();
```

:::tip
Appelez toujours la fonction de désabonnement lorsqu'un composant est démonté ou qu'une page est quittée. Cela évite les fuites de mémoire et le travail inutile côté serveur.
:::

## `.listen()` du Query Builder

Le constructeur de requêtes fluide prend également en charge les abonnements temps réel. Enchaînez vos filtres, puis appelez `.listen()` au lieu de `.find()` :

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
La méthode `.listen()` du constructeur de requêtes n'est disponible que lorsque le `RebaseClient` est configuré avec une `websocketUrl`. Si la connexion WebSocket n'est pas configurée, l'appel de `.listen()` lèvera une erreur.
:::

## Livraison des mises à jour : patch instantané + refetch de correction

Rebase utilise une stratégie de mise à jour en deux phases pour les abonnements de collection, afin de combiner une vitesse extrême avec une exactitude absolue :

1. **Phase 1 — Patch d'entité instantané :** Lorsqu'une seule entité change (créée, mise à jour, supprimée), le serveur pousse immédiatement un message léger `collection_patch` contenant les valeurs modifiées de l'entité directement aux abonnés. Le client fusionne cela dans ses données de collection en cache pour un retour inter-onglets quasi instantané — contournant entièrement la base de données pour des mises à jour perçues en moins d'une milliseconde.

2. **Phase 2 — Refetch RLS avec debounce :** Après un court délai de **300 ms** (`REFETCH_DEBOUNCE_MS`), le serveur effectue un refetch faisant autorité de la base de données pour la collection correspondant à vos filtres et à votre ordre de tri d'origine. Ceci est essentiel car les mutations de champs pourraient modifier la visibilité de l'entité (par ex. si son statut a changé et ne correspond plus à un filtre `where`).

   Pour maintenir des limites de sécurité strictes, cette requête de refetch est exécutée dans une transaction qui définit les variables locales à la transaction `app.userId` et `app.user_roles` dérivées du `SubscriptionAuthContext` de l'abonné. Cela garantit que les contraintes de sécurité au niveau des lignes (RLS) de PostgreSQL sont évaluées correctement sous la session d'authentification du client, et que seuls les enregistrements que l'utilisateur est autorisé à voir sont envoyés dans le `collection_update` final.

Cette approche garantit que les filtres de liste et les politiques d'accès restent parfaitement cohérents tout en maintenant une haute réactivité de l'interface.

## Canaux de diffusion (Broadcast)

Les canaux de diffusion permettent aux clients de s'envoyer des messages arbitraires en temps réel — utile pour des fonctionnalités comme les indicateurs de frappe, les positions de curseur ou les notifications personnalisées.

La diffusion est gérée au niveau du protocole WebSocket. Le serveur prend en charge ces types de messages :

| Type de message  | Direction       | Description                              |
|-----------------|-----------------|------------------------------------------|
| `join_channel`  | Client → Serveur | Rejoindre un canal nommé                |
| `leave_channel` | Client → Serveur | Quitter un canal                        |
| `broadcast`     | Client → Serveur | Envoyer un message à tous les membres du canal |
| `broadcast`     | Serveur → Client | Recevoir un message d'un autre membre   |
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

## Conservation des canaux

Par défaut, une diffusion atteint les membres connectés à cet instant, puis disparaît. C'est le bon compromis pour les notifications et les curseurs, et cela ne coûte rien.

Pour un flux d'opérations — édition collaborative, tout ce où un trou silencieux provoque une divergence — un canal peut être configuré pour **conserver** ses messages. Les diffusions conservées reçoivent un numéro de séquence par canal et sont stockées, de sorte qu'un client qui se reconnecte peut demander tout ce qui suit la dernière qu'il a vue.

La conservation est optionnelle et se configure ici, côté serveur :

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
|-------|-------------|
| `match` | Nom exact du canal (`"doc:42"`) ou un préfixe terminé par `*` (`"doc:*"`) |
| `limit` | Conserver au plus ce nombre de messages les plus récents par canal |
| `ttl` | Conserver les messages au plus pendant cette durée — `"30s"`, `"15m"`, `"24h"`, `"7d"`, ou des millisecondes |

Une règle exige au moins `limit` ou `ttl`. Une règle sans ni l'un ni l'autre est ignorée et journalisée, car une conservation illimitée n'est presque jamais voulue et ne peut plus être annulée une fois la table grossie.

:::note[Pourquoi ne pas laisser les clients demander l'historique ?]
Un canal est créé par celui qui le nomme. Si un client pouvait choisir sa propre profondeur d'historique, n'importe quel visiteur pourrait engager votre backend sur un stockage illimité. Le configurer ici signifie aussi que les canaux de présence et de notification — l'immense majorité — ne paient rien : sans règle configurée, aucune table n'est créée et la diffusion emprunte le même chemin synchrone qu'auparavant.
:::

### Stockage

Les canaux avec conservation utilisent deux tables du schéma `rebase`, créées automatiquement au démarrage dès qu'au moins une règle est configurée :

| Table | Contenu |
|-------|-----------|
| `rebase.channel_messages` | Les messages conservés, indexés par `(channel, seq)` |
| `rebase.channel_cursors` | La séquence la plus élevée émise par canal |

L'élagage a lieu à mesure que les messages arrivent, limité par canal pour que le coût suive le temps écoulé plutôt que le volume d'écriture. Il ne supprime que des lignes de `channel_messages` — les curseurs sont conservés indéfiniment (une petite ligne par canal), car redémarrer la séquence d'un canal changerait le sens du point de reprise enregistré par un client.

### Garanties de livraison

- **Ordonné.** Les numéros de séquence sont attribués par canal, et l'ordre de livraison correspond à l'ordre de séquence.
- **Durable avant d'être livré.** Un message qui ne peut pas être stocké n'est livré à personne, et l'expéditeur en est informé. Le livrer le placerait devant les abonnés en direct tout en le laissant hors de tout rejeu futur, et aucun message ultérieur ne pourrait réparer ce trou.
- **Au moins une fois au rattrapage.** Une plage de rejeu peut recouvrir des messages qu'un client a déjà reçus ; le SDK écarte ceux qu'il a déjà livrés.

:::caution[L'historique a le même modèle d'accès que le canal]
Quiconque peut rejoindre un canal peut rejouer ses messages conservés, y compris ceux diffusés avant son arrivée. La conservation est optionnelle par motif de canal : activez-la sur un canal ouvert au public en sachant que le passé de ce canal devient lisible par n'importe quel visiteur.
:::
## Suivi de présence

La présence suit quels utilisateurs sont actuellement en ligne dans un canal et permet à chaque utilisateur de partager un état personnalisé (par ex. position du curseur, statut).

| Type de message    | Direction       | Description                                          |
|-------------------|-----------------|------------------------------------------------------|
| `presence_track`  | Client → Serveur | Commencer à suivre la présence avec un état personnalisé |
| `presence_untrack`| Client → Serveur | Cesser de suivre la présence                        |
| `presence_state`  | Client → Serveur | Demander l'état de présence complet d'un canal      |
| `presence_state`  | Serveur → Client | État complet de toutes les présences dans un canal  |
| `presence_diff`   | Serveur → Client | Mise à jour incrémentale (arrivées et départs)      |

Lorsqu'un client envoie `presence_track`, le serveur le rejoint automatiquement au canal (pas de `join_channel` séparé nécessaire) et diffuse un `presence_diff` à tous les membres du canal.

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

Les présences obsolètes sont automatiquement nettoyées après 30 secondes d'inactivité.

## Reconnexion automatique

Le SDK client se reconnecte automatiquement lorsque la connexion WebSocket tombe :

- **Backoff exponentiel** — Les délais de reconnexion commencent à 1 seconde et doublent à chaque tentative, plafonnés à 30 secondes.
- **Maximum 5 tentatives** — Après 5 tentatives de reconnexion échouées, le client cesse d'essayer.
- **Réabonnement automatique** — En cas de reconnexion réussie, tous les abonnements actifs sont réenregistrés auprès du serveur. Aucune intervention manuelle nécessaire.
- **File d'attente des messages** — Les messages envoyés pendant la déconnexion sont mis en file d'attente et livrés après la reconnexion.

Vous pouvez écouter les événements du cycle de vie de la connexion :

```typescript
const ws = client.ws; // Access the WebSocket client

ws.on("connect", () => console.log("Connected"));
ws.on("disconnect", () => console.log("Disconnected"));
ws.on("reconnect", () => console.log("Reconnected"));
ws.on("error", (error) => console.error("Error:", error));
```

## Authentification & RLS

Les abonnements WebSocket respectent automatiquement les politiques de sécurité au niveau des lignes (RLS). Lorsque le client est authentifié :

1. La connexion WebSocket s'authentifie à l'aide du même token JWT que l'API REST.
2. Chaque refetch d'abonnement s'exécute dans une transaction PostgreSQL avec `set_config('app.userId', ...)` et `set_config('app.user_roles', ...)` — garantissant l'application des politiques RLS.
3. Si un token expire pendant une session active, le client se réauthentifie et se réabonne automatiquement.

Cela signifie que chaque utilisateur ne reçoit que les mises à jour des enregistrements qu'il est autorisé à voir.

## Diffusion inter-instances & architecture LISTEN/NOTIFY

Pour les environnements de cluster multi-instances (par ex. exécutés dans des conteneurs Kubernetes ou Docker derrière un équilibreur de charge), Rebase s'appuie sur `LISTEN/NOTIFY` de PostgreSQL pour synchroniser les opérations mutatives et l'état temps réel entre les instances.

### Contourner les pools pgBouncer

Comme les gestionnaires de pool de connexions tels que **pgBouncer** ne prennent pas en charge le modèle de connexion persistante requis pour les sessions SQL `LISTEN` de longue durée, le superviseur temps réel ouvre un client Postgres dédié et non poolé (`PgClient`) directement vers la base de données. Cette connexion directe utilise la variable d'environnement `DATABASE_DIRECT_URL` si elle est configurée, garantissant la stabilité et évitant l'épuisement du pool ou les coupures brutales.

### Mécanique des notifications & disposition du payload

Lorsqu'une entité est modifiée sur l'Instance A, celle-ci diffuse une notification sur le canal `rebase_entity_changes`. Pour minimiser la charge sur la base de données et la bande passante réseau, le payload de notification est maintenu extrêmement compact :

```json
{
  "sid": "inst_7a9c1b",
  "p": "posts",
  "eid": "45",
  "db": null
}
```

*Note : `sid` représente l'ID d'instance aléatoire et unique du serveur généré au démarrage, `p` est le slug (chemin) de la collection et `eid` est l'ID de l'entité cible.*

- **Auto-filtrage** : À la réception d'un message, chaque instance lit le `sid`. S'il correspond à son propre ID d'instance, le serveur rejette la notification pour éviter les boucles de routage infinies.
- **Relais et fan-out** : Si la notification provient d'une autre instance, le serveur planifie un refetch avec debounce et relaie la mise à jour à ses abonnés WebSocket connectés localement.
- **Boucle de reconnexion du superviseur** : Si la connexion à la base de données tombe, un superviseur de connexion en arrière-plan surveille l'état et déclenche une séquence de reconnexion automatique après un délai fixe de **3 secondes**, restaurant la boucle `LISTEN` sans affecter le cycle de vie principal de l'application Hono.

## Capture des changements au niveau de la base de données (CDC)

**La capture des données de changement est activée par défaut.** Rebase capture les changements au niveau de la base de données et émet des événements temps réel pour **chaque écriture validée, quelle que soit la manière dont elle a été effectuée** — REST, SDK, Studio, `psql`, une tâche cron dans un autre service, Drizzle/SQL brut ou l'**éditeur SQL** de Studio. C'est le même modèle que Supabase Realtime lisant le journal d'écriture anticipée (WAL).

Aucune configuration n'est requise. Sur une connexion de base de données qui le prend en charge, CDC s'auto-provisionne au démarrage ; sur une connexion qui ne le prend pas en charge (par ex. un rôle restreint ne pouvant pas créer de déclencheurs), Rebase utilise silencieusement le temps réel au niveau applicatif à la place — rien à activer, rien qui casse.

### Configuration

CDC est contrôlé par la variable d'environnement `REALTIME_CDC` :

| Valeur | Comportement |
| --- | --- |
| `auto` *(par défaut)* | Active la capture au niveau de la base de données là où la connexion le permet ; **revient silencieusement** au temps réel au niveau applicatif sinon. Zéro configuration. |
| `trigger` | Force la capture basée sur les déclencheurs. Fonctionne sur tout PostgreSQL, y compris les instances gérées sans réplication logique. Avertit (au lieu de revenir silencieusement) s'il ne peut pas provisionner. |
| `wal` | Préfère la réplication logique WAL. Pas encore intégrée — se dégrade en `trigger` et journalise le mode actif. |
| `off` | Temps réel au niveau applicatif uniquement. Utilisez ceci pour éviter la surcharge du déclencheur par écriture sur les charges à forte intensité d'écriture. |

Au démarrage, vous verrez une ligne de journal indiquant le mode actif, par ex. :

```
📡 [CDC] Realtime source = database-level change capture (mode: trigger).
   All writes now emit realtime events regardless of origin.
```

Si la connexion ne peut pas le prendre en charge, `auto` journalise plutôt une ligne informative et continue avec le temps réel au niveau applicatif :

```
ℹ️ [CDC] Database-level change capture unavailable (likely insufficient
   privileges to create triggers…) — using app-level realtime.
```

### Fonctionnement

1. **Auto-provisionnement** — Au démarrage (contexte serveur/propriétaire), Rebase installe un déclencheur idempotent `AFTER INSERT/UPDATE/DELETE` sur chaque table gérée. Le déclencheur émet une notification de changement compacte sur le canal `rebase_cdc`. Un payload qui dépasserait la limite de 8&nbsp;Ko de `NOTIFY` de PostgreSQL se rabat sur un message d'identité seule, de sorte que CDC ne peut jamais interrompre l'écriture déclenchante.
2. **Capture** — Un client `LISTEN` dédié et non poolé par instance consomme `rebase_cdc`, remappe la table modifiée vers sa collection et alimente le changement dans le même pipeline `RealtimeService` utilisé par les mutations de l'API. Comme l'écouteur inter-instances, il préfère `DATABASE_DIRECT_URL` et se reconnecte automatiquement.
3. **Livraison sûre pour RLS** — La ligne brute du flux de changements n'est **jamais** transmise aux abonnés. Le changement est marqué comme invalidé, et chaque abonnement relit la ligne sous son **propre** contexte d'authentification. Le filtrage est donc par abonné, jamais par éditeur : un client ne reçoit jamais que les lignes que ses politiques RLS autorisent.
4. **Inter-instances** — Comme chaque instance observe chaque commit via le flux de changements, CDC *est* aussi le canal inter-instances ; l'ancienne diffusion `rebase_entity_changes` par mutation n'est pas utilisée tant que CDC est actif.
5. **Dé-duplication** — Une mutation effectuée via l'API Rebase est livrée localement à l'instant où elle est validée et est aussi renvoyée en écho via le flux de changements. L'instance d'origine supprime cet écho (un enregistrement éphémère de ses propres émissions), de sorte que les abonnés ne voient jamais une écriture de l'API deux fois.

### Prérequis & remarques

- CDC nécessite une chaîne de connexion directe (`DATABASE_DIRECT_URL` ou la connexion principale) pour le client `LISTEN` — les gestionnaires de pool de connexions en mode transaction ne prennent pas en charge les sessions `LISTEN` de longue durée.
- Les déclencheurs ne sont installés que sur les tables adossées à une collection enregistrée. Les écritures sur les tables non mappées sont ignorées.
- Une collection dont la table n'a pas encore été migrée est ignorée avec un avertissement plutôt que de bloquer CDC pour le reste.
- Le streaming natif de réplication logique WAL (`wal2json`/`pgoutput`) est prévu ; aujourd'hui `REALTIME_CDC=wal` se dégrade vers le chemin basé sur les déclencheurs, qui offre une couverture équivalente au niveau de la base de données.

## Délai d'expiration des requêtes en attente

Pour éviter que les requêtes client ne restent bloquées indéfiniment, toutes les opérations WebSocket en attente qui attendent une réponse du serveur (comme les récupérations ponctuelles de collection `FETCH_COLLECTION`, les récupérations d'entité unique `FETCH_ONE`, la création/mise à jour `SAVE`, les suppressions `DELETE`, les comptages `COUNT` et les vérifications d'unicité `CHECK_UNIQUE_FIELD`) ont un délai d'expiration par défaut de 30 secondes.

Si le serveur ne répond pas dans cette fenêtre de 30 secondes, le client supprime automatiquement la requête en attente et rejette la promesse avec une `ApiError` portant le message `"Request timed out"`.

Les messages à sens unique qui n'attendent pas de réponse (comme `subscribe_collection`, `subscribe_one`, `unsubscribe`, `join_channel`, `leave_channel`, `broadcast`, `presence_track`, `presence_untrack` et `presence_state`) se résolvent immédiatement lors de la transmission et ne déclenchent pas de délais d'expiration.

## Étapes suivantes

- [SDK client](/docs/sdk) — Référence complète du SDK, y compris les accesseurs de collection typés.
- [Authentification](/docs/backend/authentication) — Configurer l'authentification JWT et les politiques RLS.
- [Architecture du backend](/docs/backend) — Vue d'ensemble de l'architecture du serveur Rebase.
