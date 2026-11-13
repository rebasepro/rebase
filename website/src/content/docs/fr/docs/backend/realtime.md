---
sourceHash: 8cfa91fb2859caf0
title: Temps réel & WebSocket
sidebar_label: Temps réel
description: Synchronisation des données en temps réel, canaux de diffusion et suivi de présence via WebSocket.
---

Rebase inclut un moteur temps réel intégré qui transmet les modifications de données aux clients connectés via WebSocket.
Lorsqu'un enregistrement est créé, mis à jour ou supprimé, chaque abonné observant cette table ou cette entité reçoit la mise à jour instantanément — aucun polling n'est requis.

## Fonctionnement

Le pipeline temps réel comporte trois étapes :

1. **Déclencheur de base de données (Database trigger)** — Une mutation atteint la base de données PostgreSQL (via l'API REST, le SDK ou Studio).
2. **Distribution serveur (Server fan-out)** — Le serveur Rebase détecte la modification et la diffuse à chaque abonnement WebSocket actif correspondant à la table ou à l'entité concernée.
3. **Rappel client (Client callback)** — Le SDK typé déclenche votre callback `onUpdate` avec les données fraîches.

```
┌──────────────┐      ┌────────────────────┐      ┌──────────────┐
│  PostgreSQL   │─────▶│  Rebase Server     │─────▶│  Client SDK  │
│  LISTEN/NOTIFY│      │  RealtimeService   │      │  WebSocket   │
└──────────────┘      └────────────────────┘      └──────────────┘
```

Pour les déploiements multi-instances, Rebase utilise le mécanisme `LISTEN/NOTIFY` de PostgreSQL pour propager les modifications entre les instances de serveur. Cela est géré automatiquement. Lorsque la [capture des modifications au niveau de la base de données (CDC)](/docs/backend/realtime-cdc/) est activée (par défaut dès lors que le rôle de base de données peut créer des déclencheurs), chaque instance écoute sur le canal `rebase_cdc` sur lequel les déclencheurs de capture publient, de sorte qu'une écriture est détectée quel que soit le processus ou l'outil qui l'a effectuée. Sans capture, chaque instance annonce ses propres écritures sur le canal `rebase_entity_changes`, et une connexion dédiée sur chaque autre instance les relaie à ses abonnés locaux.

### Zéro configuration

Le temps réel est activé par défaut. Il n'y a aucun indicateur à activer ni aucun service à démarrer — si votre serveur Rebase fonctionne, le point de terminaison WebSocket est disponible.

### Chemin d'écoute du socket

Le socket répond aux requêtes d'upgrade sur un seul chemin : le chemin de base de l'API avec le `/api` final supprimé, c'est-à-dire `/` pour une API située à `/api`. C'est là que le SDK se connecte : il se connecte à sa `baseUrl`, tandis que ses requêtes HTTP vont vers `${baseUrl}/api`. Un upgrade vers tout autre chemin est laissé aux autres écouteurs `upgrade` du serveur, ce qui permet à votre application d'exécuter son propre serveur WebSocket sur le même `http.Server`. En l'absence d'autre écouteur, un tel upgrade reçoit une réponse `404`.

Dans un [serveur personnalisé](/docs/backend/custom-server/), `backend.attachRealtime(server, { path })` définit le chemin, et l'option `realtime.path` de l'adaptateur Postgres remplace ce que le serveur a déduit.

> Par défaut, Rebase émet également des événements temps réel pour les écritures effectuées **en dehors** de l'API (via `psql`, un autre service ou l'éditeur SQL de Studio) dès lors que la connexion à la base de données le permet — voir [capture des modifications au niveau de la base de données](/docs/backend/realtime-cdc/).

## Abonnements avec le SDK typé

Le SDK typé de Rebase expose deux méthodes d'abonnement sur chaque accesseur de table :

- **`listen()`** — S'abonner à une table entière (avec des filtres facultatifs).
- **`listenById()`** — S'abonner à une seule entité par son identifiant.

Les deux méthodes renvoient une **fonction de désabonnement** que vous appelez pour cesser de recevoir les mises à jour.

### S'abonner à une table

Utilisez `listen()` pour recevoir des mises à jour à chaque modification d'enregistrements dans une table :

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

Le callback reçoit un `FindResult<M>` contenant :
- `data` — Les lignes, à plat, telles que `find()` les renvoie (`row.name`, et non `row.values.name`).
- `meta` — Les informations de pagination (`total`, `limit`, `offset`, `hasMore`).

### S'abonner à une table avec des filtres

Passez `FindParams` en premier argument pour filtrer l'abonnement :

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
  (row) => {
    if (row) {
      console.log("Product updated:", row.name);
    } else {
      console.log("Product was deleted");
    }
  },
  (error) => {
    console.error("Subscription error:", error);
  }
);
```

Le callback reçoit la ligne, à plat, telle que `findById()` la renvoie (`row.name`, et non `row.values.name`), ou `undefined` lorsque la ligne est supprimée.

**Chaque trame transporte la version de la ligne.** `etagOf(row)` correspond à l'en-tête `ETag` renvoyé par un `GET` sur la ligne ; ainsi, une modification apportée à ce qu'affichait une trame peut être enregistrée avec `ifMatch: etagOf(row)` et se verra refusée avec une erreur `412` si la ligne a évolué entre-temps (voir [Écritures conditionnelles](/docs/backend/writes/)). Sur le réseau, le message `subscribe_one` du SDK demande `etag: true`, et chaque trame `single_update` pour une ligne existante comporte `"etag"` aux côtés de `"row"`. Un serveur antérieur à cette fonctionnalité ignore cette demande et n'envoie aucune balise, et un client qui ne la demande pas reçoit des trames sans celle-ci.

### Se désabonner

`listen()` et `listenById()` renvoient toutes deux une fonction de désabonnement. Appelez-la pour cesser de recevoir des mises à jour et libérer les ressources côté serveur :

```typescript
const unsubscribe = client.data.products.listen(undefined, (response) => {
  // handle updates
});

// Later, when you no longer need updates:
unsubscribe();
```

:::tip
Appelez toujours la fonction de désabonnement lors du démontage d'un composant ou lorsque l'utilisateur quitte une page. Cela évite les fuites de mémoire et les opérations inutiles côté serveur.
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
`.listen()` — sur le query builder comme sur l'accesseur de table — nécessite le WebSocket du client. Le client déduit son URL à partir de `baseUrl`, sauf si `websocketUrl` est spécifié. Sur un client créé avec `realtime: false`, ou sur un client n'ayant pu déduire aucune URL, l'appel à `.listen()` lève une erreur.
:::

## Distribution des mises à jour : Patch instantané + Récupération pour exactitude

Une modification ne parvient jamais à un abonné sous forme de données. Elle est transmise sous la forme du fait qu'un changement a eu lieu, et chaque abonné est ensuite informé de ce qu'*il* a le droit de voir au moyen d'une requête exécutée sous sa propre identité :

1. **Invalidation.** Lorsqu'une entité est modifiée (création, mise à jour, suppression), le serveur marque les chemins concernés. La ligne écrite n'est pas transférée directement — elle a été lue sous l'autorisation du rédacteur, ce qui ne donne aucune indication sur ce que chaque abonné est autorisé à voir.

2. **Nouvelle requête RLS avec debounce (Debounced RLS refetch).** Après **300 ms** (`REFETCH_DEBOUNCE_MS`), le serveur réinterroge la table avec vos filtres et votre ordre de tri initiaux. La requête s'exécute au sein d'une transaction qui définit les variables locales de transaction `app.user_id` et `app.user_roles` à partir du `SubscriptionAuthContext` de l'abonné, afin que Postgres évalue la sécurité au niveau des lignes (RLS) sous l'identité de ce client et que seules les lignes qu'il est autorisé à voir soient envoyées dans le `collection_update`. Le debounce permet également de regrouper une rafale d'écritures en une seule requête. Il attend 300 ms sans modification supplémentaire, mais jamais plus de **1 s** (`REFETCH_MAX_WAIT_MS`) après la première, de sorte qu'une table modifiée plusieurs fois par seconde envoie tout de même une trame à ses abonnés au moins une fois par seconde. Définissez cette limite avec `REALTIME_REFETCH_MAX_WAIT_MS` (ou `realtime.refetchMaxWaitMs`) : une valeur plus élevée réinterroge une table très sollicitée moins souvent, une valeur plus basse envoie des trames plus fraîches.

   Une réinterrogation qui lit exactement ce qui a été envoyé précédemment à un abonné ne lui envoie rien : une écriture sur la ligne 9 000 d'une liste affichant les 50 premières coûte la lecture, mais n'envoie pas de trame à chaque observateur. Après une trame d'erreur, les lignes suivantes sont renvoyées même si elles sont identiques.

Les versions antérieures envoyaient un `collection_patch` immédiat contenant la ligne écrite avant cette réinterrogation, pour un retour d'information inter-onglets inférieur à la milliseconde. Cette ligne ayant été lue sous le périmètre de l'auteur de l'écriture, elle pouvait — et de fait, arrivait à — atteindre des abonnés dont les propres politiques l'auraient refusée, et le filtre `where` de l'abonnement ne lui était pas appliqué non plus. Le patch a été supprimé : la latence perçue pour une mise à jour correspond désormais à la fenêtre de debounce.

### La réinterrogation est la lecture REST

La réinterrogation exécute le même pipeline que `GET /api/data/<collection>`, avec la même gestion de `include`. C'est ce qui permet à `find({ q })` et `listen({ q })` de renvoyer des lignes identiques champ pour champ.

Il s'agissait auparavant d'une méthode différente — qui imbriquait chaque relation sous une enveloppe `{ "__type": "relation" }` et, comme un abonnement ne pouvait pas comporter de `include`, chargeait hâtivement **toutes** les relations déclarées par la table. Ainsi, la même requête répondait sous une forme via HTTP et sous une autre via le socket, et un client effectuant le rendu des deux voyait ses lignes changer de structure dès qu'une écriture survenait.

Une trame d'abonnement accepte donc les mêmes paramètres qu'une requête de liste : `filter`, `logical`, `orderBy`, `limit`, `offset`/`page`, `searchString`, `include` et `fields`. `vectorSearch` constitue l'exception et se voit **refusé** avec `VECTOR_SEARCH_NOT_LIVE` — un abonnement étant réexécuté à chaque écriture correspondante, rien n'y calcule les distances.

### `collection_update` transporte ses propres métadonnées

La trame est `{ rows, pks, meta }` :

```json
{
    "type": "collection_update",
    "subscriptionId": "…",
    "rows": [ { "id": 1, "title": "Widget" } ],
    "pks": [ { "fieldName": "id", "type": "number" } ],
    "meta": { "total": 150, "limit": 20, "offset": 0, "hasMore": true, "nextCursor": "eyJ…" }
}
```

`meta` est calculé au sein de la même transaction soumise aux RLS qui a lu les lignes, il décrit donc exactement les lignes qui l'accompagnent. Sans cela, un client ayant besoin d'un total devait envoyer un `GET /count` **par push** — un aller-retour supplémentaire par écriture et par abonné, créant une fenêtre temporelle durant laquelle le décompte et les lignes décrivaient des états différents de la table.

Lorsque le décompte lui-même échoue, la trame comporte `partial: true` et aucun `total` ; il ne s'agit pas d'une erreur d'abonnement, et le client doit conserver le dernier total réel plutôt que de lui substituer la taille de la page. Sur une grande table, le comptage représente la majeure partie du coût d'une trame. Lorsque `REALTIME_RECOUNT_INTERVAL_MS` est configuré, une liste dont le dernier total était d'au moins `REALTIME_RECOUNT_MIN_ROWS` (100 000 par défaut) réutilise ce total pendant la durée de l'intervalle au lieu de recalculer à chaque écriture, et une telle trame inclut `meta.totalAsOf`, indiquant la date/heure à laquelle le total a été relevé. Une fois l'intervalle écoulé, une liste dont la dernière trame réutilisait le total est recalculée et reçoit le nouveau total, que des écritures aient eu lieu ou non entre-temps. Si cette option n'est pas définie (comportement par défaut), chaque trame effectue un décompte.

### Coût d'une écriture et limites

Puisque chaque trame est une requête exécutée sous l'identité de son abonné, le coût d'une écriture augmente avec le nombre de **questions distinctes posées par des entités (principals) distinctes** sur la table concernée — et non avec le nombre de sockets ouverts :

- Les abonnements qui posent la même question (mêmes chemin, filtres, tri, page, `include`, `fields`, recherche) sous la même identité (mêmes identifiant utilisateur, rôles, indicateur invité et revendications/claims) partagent une seule réinterrogation. Une écriture sur une liste coûte **une transaction par groupe de ce type** — la lecture et son décompte — quel que soit le nombre de sockets concernés ; chaque membre reçoit tout de même une trame construite à partir de lignes lues sous cette identité. Une première page qui renvoie moins d'éléments que sa `limit` représente l'ensemble complet, et n'est donc pas recomptée du tout.
- Un abonnement à un enregistrement unique n'est exécuté que lorsque son propre enregistrement change.
- Des entités différentes ne partagent jamais une lecture — c'est ce qui empêche une trame de contenir une ligne que son lecteur n'est pas autorisé à voir. Une liste observée par un millier d'utilisateurs connectés différents entraîne un millier de lectures et un millier de décomptes à chaque écriture, dans un millier de transactions.

Mesuré sur un ordinateur portable avec un PostgreSQL local disposant d'un pool de 20 connexions, pour une écriture sur une liste :

| Abonnés | Transactions pour l'écriture | Dernière trame après l'écriture |
|---|---|---|
| 1 000, un seul principal | 2 | ~310 ms |
| 1 000, chacun un principal différent | ~1 000 | ~600 ms |

300 ms de chaque durée correspondent au debounce. La seconde ligne représente le plafond à prévoir. Les réinterrogations s'exécutent sur le même pool que votre trafic REST, mais utilisent au maximum un quart de ses connexions à la fois (5 sur les 20 par défaut, jamais moins de 2) ; le reste attend son tour sur le serveur, de sorte que la distribution d'une écriture retarde ses propres trames plutôt que vos requêtes. Une table modifiée plusieurs fois par seconde alors que **des centaines d'utilisateurs différents** observent la même liste est la situation où ces trames commencent à accuser du retard. Au-delà, privilégiez des abonnements plus ciblés (une page, un filtre sur les lignes propres à l'utilisateur) ou un [canal de diffusion](#canaux-de-diffusion-broadcast-channels) transmettant la modification pour que les clients réinterrogent les données selon leur propre calendrier.

**Un socket peut comporter au maximum 1 000 abonnements.** Tout abonnement supplémentaire est refusé avec une trame d'erreur portant le code `TOO_MANY_SUBSCRIPTIONS` ; se réabonner avec un identifiant que le socket possède déjà remplace cet abonnement sans être recompté. Le SDK mutualise les abonnements identiques sur un socket, ce qui permet de compter uniquement les listes et enregistrements distincts ouverts par une page. Modifiez cette valeur avec `REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET` ou `realtime.maxSubscriptionsPerSocket` sur l'adaptateur Postgres (la variable d'environnement prévaut) ; une valeur qui n'est pas un nombre entier positif interrompt le démarrage du serveur. **Les sockets détenus par un utilisateur peuvent également être limités**, par instance de serveur : définissez `REALTIME_MAX_SOCKETS_PER_USER` (ou `realtime.maxSocketsPerUser`), et toute connexion au-delà de cette limite est refusée avec `TOO_MANY_SOCKETS` et le socket fermé avec le code 4002. Les sockets authentifiés avec une clé d'API sont décomptés pour cette clé spécifiquement, chaque clé de manière isolée, et non pour le compte qui l'a créée ; la clé de service étant un identifiant unique, tous ses sockets sont décomptés ensemble. Les sockets d'un administrateur usurpant l'identité d'un utilisateur sont imputés à l'administrateur, parmi ses propres sockets, et non à l'utilisateur dont il prend l'identité. Le SDK avertit immédiatement chaque abonnement actif ainsi que `onConnectionLost`, avec une erreur `CONNECTION_LOST` dont le champ `details.reason` est `TOO_MANY_SOCKETS`, et continue de réessayer en espaçant chaque tentative jusqu'à 30 s, afin que l'onglet puisse se connecter dès qu'un autre socket se ferme. Sans configuration (comportement par défaut), aucun plafond n'est appliqué.

L'identifiant d'un abonnement est propre au socket : deux clients nommant tous deux un abonnement `"sub-1"` conservent chacun le leur, et un `unsubscribe` ne met fin qu'à celui de l'expéditeur.

**L'abonnement est décompté du rate limit de données.** La première trame d'un abonnement est une lecture, exécutée sous l'identité de l'abonné, tout comme une requête d'historique de canal. Ainsi, `subscribe_collection`, `subscribe_one` et `channel_history` sont comptabilisés comme des requêtes de données dans le quota de l'appelant (celui partagé par ses requêtes HTTP et ses autres sockets) une fois le quota propre au socket épuisé. Chaque socket peut en envoyer 1 000 sans qu'elles soient décomptées, ou autant que son plafond d'abonnements si celui-ci est supérieur, et ce quota se régénère sur 15 minutes. Cela correspond à tout ce qu'un socket peut contenir, de sorte que le réabonnement après une reconnexion n'est jamais refusé et ne consomme jamais le quota de l'utilisateur. Au-delà de ce quota, toute trame dépassant la limite est refusée avec une trame d'erreur portant le code `RATE_LIMITED`, que le SDK transmet au gestionnaire `onError` de cet abonnement, ou à celui du canal.

### Sockets qui ne répondent plus

Un client peut disparaître sans fermer son socket : un téléphone perd le signal, un ordinateur portable se met en veille, un routeur NAT oublie la connexion. Aucune trame de fermeture ne parvient au serveur, rien ne l'en informe donc. Le serveur envoie par conséquent un ping à chaque socket toutes les 30 secondes et met fin à celui qui n'a pas répondu au ping suivant ; un client disparu est ainsi libéré en moins d'une minute. Les navigateurs et le SDK répondent automatiquement aux pings ; un client communiquant directement avec le protocole doit également y répondre, comme le font la plupart des bibliothèques WebSocket.

**Côté navigateur.** Un navigateur ne peut ni envoyer de ping ni en voir, de sorte qu'un socket semi-ouvert lui paraît connecté indéfiniment. Le SDK ouvre le socket avec `?rebase_caps=heartbeat,channel_seq,cancel_sql` ; un serveur qui les prend en charge répond avec `{"type":"hello","capabilities":[…],"heartbeatMs":30000}`, listant celles qu'il honore (`cancel_sql` : il accepte la trame `CANCEL_SQL` de la console SQL), et envoie `{"type":"heartbeat"}` toutes les 30 secondes. Le SDK ferme alors le socket et [se reconnecte](#reconnexion-automatique) après deux battements manqués. Un client qui ne spécifie rien ne reçoit ni l'un ni l'autre, et un serveur plus ancien ignore ce paramètre, de sorte qu'un SDK communiquant avec lui conserve son comportement antérieur.

Un socket est également interrompu lorsque plus de 16&nbsp;MiB de trames qui lui ont été envoyées restent non lues. Cela correspond à un client qui ne lit pas ce qui lui est envoyé, ou à un client ayant pris un tel retard que ce qu'il lirait serait obsolète. Et lorsque l'ensemble des sockets d'un serveur contient collectivement plus de 256&nbsp;MiB de données non lues (ou un quart de la limite de mémoire allouée au serveur, si cette valeur est plus faible), ceux qui ont le plus de données non lues sont fermés en premier, jusqu'à ce que le reste respecte la limite.

Un socket interrompu est nettoyé de la même manière qu'un socket fermé. Ses abonnements prennent fin, il quitte ses canaux et sa présence est supprimée, le départ étant notifié aux autres membres. Un client toujours présent constate la coupure de la connexion, et le SDK [se reconnecte](#reconnexion-automatique) puis s'abonne de nouveau.

## Canaux de diffusion (Broadcast Channels)

Les canaux de diffusion permettent aux clients de s'envoyer des messages arbitraires en temps réel — très utile pour des fonctionnalités telles que les indicateurs de saisie, les positions de curseur ou les notifications personnalisées.

La diffusion est gérée au niveau du protocole WebSocket. Le serveur prend en charge les types de messages suivants :

| Message Type     | Direction       | Description                              |
|-----------------|-----------------|------------------------------------------|
| `join_channel`    | Client → Server | Join a named channel                     |
| `leave_channel`   | Client → Server | Leave a channel                          |
| `broadcast`       | Client → Server | Send a message to all channel members    |
| `broadcast`       | Server → Client | Receive a message from another member    |
| `channel_history` | Client → Server | Request retained messages after a sequence |
| `channel_history` | Server → Client | The retained messages a client missed    |

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

Par défaut, une diffusion parvient aux membres actuellement connectés puis disparaît. C'est le compromis idéal pour les notifications et les curseurs, et cela ne coûte rien.

Pour un flux d'opérations — édition collaborative ou tout cas où un silence/interruption entraîne une divergence — un canal peut être configuré pour **retenir** ses messages. Les messages diffusés retenus se voient attribuer un numéro de séquence par canal et sont stockés, afin qu'un client qui se reconnecte puisse demander tout ce qui a été émis après le dernier message qu'il a vu.

:::caution[Où configurer cela]
**Runtime managé : nulle part.** La rétention des canaux et `realtime.bus` font partie de l'adaptateur de base de données que le runtime managé construit lui-même, et aucun des deux ne dispose d'une variable d'environnement équivalente. Éjectez le projet pour les configurer.
**Projet éjecté :** `createPostgresAdapter({ realtime })` dans `backend/src/index.ts`.
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

| Field   | Description                                                                 |
|---------|-----------------------------------------------------------------------------|
| `match` | Exact channel name (`"doc:42"`) or a trailing-`*` prefix (`"doc:*"`)        |
| `limit` | Keep at most this many of the most recent messages per channel               |
| `ttl`   | Keep messages for at most this long — `"30s"`, `"15m"`, `"24h"`, `"7d"`, or milliseconds |

Une règle requiert au moins `limit` ou `ttl`. Une règle ne comportant ni l'un ni l'autre est ignorée et journalisée, car une rétention illimitée n'est presque jamais souhaitée et il est impossible de revenir en arrière une fois que la table a grossi.

:::note[Pourquoi ne pas laisser les clients demander l'historique ?]
Un canal est créé par quiconque le nomme. Si un client pouvait choisir sa propre profondeur d'historique, n'importe quel visiteur pourrait contraindre votre backend à un stockage illimité. La configuration à ce niveau permet également aux canaux de présence et de notification — l'écrasante majorité — de ne rien coûter : sans règle configurée, aucune table n'est créée et la diffusion emprunte le même chemin synchrone qu'auparavant.
:::

### Stockage

Les canaux avec rétention utilisent deux tables dans le schéma `rebase`, créées automatiquement au démarrage lorsqu'au moins une règle est configurée :

| Table                     | Contents                                                        |
|---------------------------|-----------------------------------------------------------------|
| `rebase.channel_messages` | The retained messages, keyed by `(channel, seq)`                 |
| `rebase.channel_cursors`  | The highest sequence issued per channel                          |

Le nettoyage (pruning) s'effectue au fur et à mesure de l'arrivée des messages, avec une régulation par canal afin que le coût suive le temps écoulé plutôt que le volume d'écritures. Il ne supprime que des lignes dans `channel_messages` — les curseurs sont conservés indéfiniment (ils représentent une seule petite ligne par canal), car réinitialiser la séquence d'un canal modifierait la signification du point de reprise sauvegardé par un client.

### Garanties de distribution

- **Ordonnée.** Les numéros de séquence sont alloués par canal, et l'ordre de distribution correspond à l'ordre des séquences — sur une instance unique, ainsi qu'entre instances sur le bus `postgres`, où l'instruction qui numérote un message l'annonce également, de sorte que chaque instance (y compris celle de l'expéditeur) reçoit les annonces dans l'ordre des séquences. Un bus fourni par vos soins transporte les trames dans l'ordre où il les délivre.
- **Durable avant distribution.** Un message qui ne peut pas être stocké n'est distribué à personne, et l'expéditeur en est averti. Le distribuer le présenterait aux abonnés en direct tout en l'excluant de toute relecture future, et aucun message ultérieur ne pourrait combler ce vide.
- **Au moins une fois lors du rattrapage (At-least-once).** Une plage de relecture peut chevaucher des messages qu'un client a déjà reçus ; le SDK ignore ceux qu'il a déjà distribués.
- **Aucune perte (No holes).** Un message retenu atteint chaque membre : l'expéditeur, à qui son propre message n'est jamais renvoyé, reçoit à la place `{"type":"broadcast_ack","channel","seq"}` s'il a activé `channel_seq`. Ainsi, un message au-delà de `lastSeq + 1` signifie qu'un message a été manqué : le SDK le retient, demande l'historique intermédiaire, et les délivre tous dans l'ordre. Face à un serveur sans `channel_seq`, un saut de séquence est distribué tel quel dès son arrivée.

:::caution[L'historique partage le même modèle d'accès que le canal]
Un client ayant rejoint un canal peut rejouer ses messages conservés, y compris ceux diffusés avant son arrivée — l'appartenance au canal est la seule vérification, et rejoindre un canal est ouvert à tout client capable de nommer ce canal. La rétention s'active par motif de canal, donc l'activer rend le passé de ce canal lisible par tout visiteur qui en devine le nom. Les canaux avec rétention rendent ces données durables plutôt qu'éphémères ; traitez donc le contenu d'un canal avec rétention comme public pour vos utilisateurs.
:::

## Suivi de présence (Presence Tracking)

La présence permet de suivre quels utilisateurs sont actuellement en ligne dans un canal et autorise chaque utilisateur à partager un état personnalisé (ex. : position du curseur, statut).

| Message Type       | Direction       | Description                                          |
|-------------------|-----------------|------------------------------------------------------|
| `presence_track`  | Client → Server | Start tracking presence with custom state            |
| `presence_untrack`| Client → Server | Stop tracking presence                               |
| `presence_state`  | Client → Server | Request the full presence state for a channel        |
| `presence_state`  | Server → Client | Every presence in the channel, in full               |
| `presence_diff`   | Server → Client | Incremental update (joins and leaves)                |

Lorsqu'un client envoie `presence_track`, le serveur l'ajoute automatiquement au canal (aucun `join_channel` séparé n'est nécessaire) et diffuse un `presence_diff` à tous les membres du canal. Le SDK renvoie son état toutes les ~20 secondes sous forme de battement de cœur (heartbeat) ; un heartbeat dont l'état n'a pas changé rafraîchit uniquement le délai d'expiration du client et n'envoie aucun `presence_diff`.

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

Le SDK typé se reconnecte automatiquement en cas de perte de connexion WebSocket :

- **Backoff exponentiel** — Chaque nouvelle tentative attend selon un intervalle qui commence à 2 secondes et double à chaque fois, jusqu'à 30 secondes. Le délai est tiré au sort n'importe où dans cette plage, mais jamais en dessous d'un quart de seconde, de sorte que les clients déconnectés simultanément par un déploiement se reconnectent de manière étalée plutôt qu'au même instant.
- **Aucun abandon tant que des éléments restent actifs** — Tant qu'un abonnement ou un canal rejoint existe, le client continue de retenter avec le plafond de 30 secondes pendant toute la durée de l'interruption. Si rien n'est enregistré, il s'arrête après 5 tentatives infructueuses, et le prochain abonnement relancera la connexion. Dans un navigateur, l'événement `online` et le retour de l'onglet au premier plan déclenchent tous deux une reconnexion immédiate sans attendre la fin du backoff.
- **Les interruptions ne sont signalées qu'une seule fois** — Lorsque la connexion est interrompue depuis 14 secondes, quel que soit le nombre de tentatives effectuées, le callback `onError` de chaque abonnement actif et de chaque canal rejoint reçoit une erreur `RebaseApiError` avec le code `CONNECTION_LOST`. L'abonnement est **conservé** : l'erreur indique simplement que ses données ne sont plus mises à jour, et non qu'il a pris fin.
- **Réabonnement automatique** — Lors d'une reconnexion réussie, tous les abonnements actifs sont réenregistrés auprès du serveur, et le prochain `onUpdate` de chacun transmet tout ce qui a été écrit pendant l'absence du client. Cette mise à jour constitue le signal de reprise. Aucune intervention manuelle n'est requise.
- **Requêtes au plus une fois (at-most-once)** — Une requête effectuée alors que le socket est indisponible attend la reconnexion jusqu'à 30 secondes à compter de l'appel, puis échoue avec `REQUEST_TIMEOUT` sans jamais avoir été envoyée. Une requête qui avait déjà été envoyée lorsque la connexion a été interrompue échoue avec `CONNECTION_LOST` et n'est **pas** renvoyée : le serveur a pu ou non l'exécuter, et seul l'appelant sait s'il est sans danger de l'exécuter une seconde fois.

`client.ws.state` indique l'état de la connexion, et `onStateChange` est notifié à chaque changement :

| State | Meaning |
|---|---|
| `idle` | No socket, and none wanted yet (the connection is lazy), or a sign-out dropped it. |
| `connecting` | Dialling, with no outage in progress. |
| `connected` | The socket is open. |
| `reconnecting` | The socket dropped and the client is redialling. Nothing has been reported yet. |
| `disconnected` | The outage has lasted 14 seconds or more. `CONNECTION_LOST` has been reported, and the client keeps redialling. |
| `closed` | `client.close()` was called. Final. |

```typescript
// `ws` is undefined on a client built without realtime, so narrow it once.
const ws = client.ws;
if (ws) {
    ws.onStateChange((state) => {
        showOfflineBanner(state === "disconnected");
    });
    ws.on("connect", () => console.log("Connected"));
    ws.on("disconnect", () => console.log("Disconnected"));
    ws.on("reconnect", () => console.log("Reconnected"));
    ws.on("error", (error) => console.error("Error:", error));
}
```

L'interface d'administration de Rebase affiche sa propre bannière lorsque l'état est `disconnected`, et conserve les lignes et enregistrements déjà présents à l'écran au lieu de les remplacer par une erreur.

## Authentification & RLS

Les abonnements WebSocket respectent automatiquement les politiques de sécurité au niveau des lignes (RLS). Lorsque le client est authentifié :

1. La connexion WebSocket s'authentifie à l'aide du même jeton JWT que l'API REST.
2. Chaque réinterrogation d'abonnement s'exécute au sein d'une transaction PostgreSQL avec `set_config('app.user_id', ...)` et `set_config('app.user_roles', ...)` — garantissant ainsi l'application des politiques RLS.
3. L'identité est vérifiée en continu tant que le socket est ouvert, et pas seulement lors de l'authentification initiale. Avant chaque trame, le serveur effectue les mêmes vérifications qu'une requête HTTP : le jeton est-il toujours valide, sa session a-t-elle été déconnectée ou révoquée, le compte existe-t-il toujours et quels rôles détient-il désormais. Pour les trames de canaux, cette vérification est effectuée au plus une fois par seconde. Les trames qui arrivent sur un socket pendant qu'une vérification est déjà en cours — par exemple un client renvoyant ses abonnements après une reconnexion — partagent cette vérification au lieu de redemander chacune leur tour ; la trame suivante après sa résolution effectuera une nouvelle requête. Un socket qui ne fait qu'écouter est vérifié au moins toutes les 30 secondes, et un jeton cesse d'être accepté dès l'instant où il expire. Un rôle retiré s'applique dès la trame suivante (ou, pour une trame ayant partagé une vérification en cours, dès la suivante), qu'il s'agisse de lectures, d'écritures ou d'abonnements ouverts. Un socket dont l'identité n'est plus valide reçoit une trame `AUTH_ERROR` et est fermé avec le code `4001`. Avec l'authentification intégrée, le code de la trame en explique la raison, comme le font les routes HTTP : `SESSION_REVOKED` (déconnecté, révoqué ou compte supprimé), `ACCOUNT_DISABLED` ou `TOKEN_EXPIRED` ; pour un autre adaptateur d'authentification, le code est `SESSION_ENDED`. Un message `AUTHENTICATE` pour une session révoquée ou un compte désactivé est rejeté avec `SESSION_REVOKED` ou `ACCOUNT_DISABLED` (un jeton non vérifiable ou expiré reçoit `INVALID_TOKEN`). Le SDK ne réessaie pas avec le même jeton et transmet le refus, code compris, au `onError` de l'opération qui nécessitait le compte. Le SDK réauthentifie son socket à chaque rafraîchissement de son jeton ; un nouveau jeton pour la même identité (mêmes identifiant utilisateur, rôles, indicateur invité et revendications) conserve les abonnements ouverts tels quels, tandis qu'un jeton pour une identité différente réexécute chacun d'eux sous cette nouvelle identité. Après une erreur `4001`, il se reconnecte avec la session qu'il détient alors, ou sans aucune session. Un client utilisant directement le protocole doit envoyer un jeton actualisé via `AUTHENTICATE` avant que l'ancien n'expire.

Cela signifie que chaque socket ne reçoit que les mises à jour des enregistrements que son identité authentifiée est autorisée à voir.

Une [clé d'API](/docs/backend/api-keys/) permet également d'authentifier le socket : envoyez la clé `rk_…` là où le jeton d'accès serait placé. Le socket vérifie alors chaque trame par rapport aux [scopes](/docs/backend/roles-and-scopes/) de la clé : une récupération, un décompte ou un abonnement requiert `data:read` sur sa table, un enregistrement `data:write`, une suppression `data:delete`. Un chemin imbriqué nécessite le scope simple. Les canaux (diffusion et présence) sont refusés pour une clé d'API, car aucun scope ne les couvre. Les messages de l'éditeur SQL et de branches requièrent `database:read` ou `database:write`, qu'il s'agisse d'une clé ou d'une personne.

L'exécution sur plusieurs instances — le bus LISTEN/NOTIFY, le fonctionnement de la présence entre processus et la mise en œuvre de votre propre transport — dispose de sa propre page : [Realtime across instances](/docs/backend/realtime-transports/).

## Capture des modifications au niveau de la base de données (CDC)

Chaque écriture validée émet des événements en temps réel, quelle que soit son origine : REST, le SDK, Studio, `psql`, ou un cron job dans un autre service. Pour comprendre le fonctionnement de la capture, le paramètre `REALTIME_CDC` et ses prérequis : [Database change capture](/docs/backend/realtime-cdc/).

## Délai d'expiration des requêtes en attente (Pending Request Timeout)

Pour éviter que les requêtes client ne restent bloquées indéfiniment, toutes les opérations WebSocket en attente qui prévoient une réponse du serveur (telles que les récupérations ponctuelles de table `FETCH_COLLECTION`, les récupérations d'une entité unique `FETCH_ONE`, la création/mise à jour `SAVE`, les suppressions `DELETE`, les décomptes `COUNT` et les vérifications d'unicité `CHECK_UNIQUE_FIELD`) disposent d'un délai d'expiration par défaut de 30 secondes.

Si le serveur ne répond pas dans cette fenêtre de 30 secondes, le client supprime automatiquement la requête en attente et rejette la promesse avec une `RebaseApiError` dont le code est `REQUEST_TIMEOUT`.

Les messages unidirectionnels qui n'attendent pas de réponse (comme `subscribe_collection`, `subscribe_one`, `unsubscribe`, `join_channel`, `leave_channel`, `broadcast`, `presence_track`, `presence_untrack`, `presence_state` et `channel_history`) sont résolus immédiatement lors de la transmission et ne déclenchent pas ce délai d'expiration. Un abonnement dont la première trame n'est pas arrivée 30 secondes après l'envoi de la souscription échoue quant à lui avec `SUBSCRIPTION_TIMEOUT` sur son `onError`.

### Lorsqu'une trame de canal est refusée

Une trame de canal fonctionne selon le principe du « tir et oubli » (fire-and-forget) : `await channel.broadcast(...)` se résout lorsque la trame est écrite sur le socket, et **non** lorsque le serveur l'a acceptée. C'est délibéré — une application collaborative diffuse la position d'un curseur soixante fois par seconde, et attendre un accusé de réception pour chacune transformerait chaque envoi en aller-retour réseau complet.

Par conséquent, un refus ne peut pas être une promesse rejetée. Il est transmis à `onError` :

```typescript
const channel = client.realtime.channel("doc:42");

channel.onError((error) => {
    if (error.code === "CHANNEL_FORBIDDEN") showReadOnlyBanner();
    if (error.code === "RATE_LIMITED") throttleCursorUpdates();
});
```

| Code | Means |
|------|-------|
| `CHANNEL_FORBIDDEN` | You are not a member of the channel — join it before broadcasting or reading its history |
| `RATE_LIMITED` | Past the channel frame budget (7,200 channel frames a minute per socket), or, for a history request, past the [data rate limit](#coût-dune-écriture-et-limites) |
| `CHANNEL_HISTORY_WRITE_FAILED` | A retained broadcast could not be persisted, so it was dropped |
| `CHANNEL_HISTORY_READ_FAILED` | A catch-up request could not be served |
| `CHANNEL_HISTORY_GAP` | Raised by the client: a catch-up found that the server no longer retains messages this client never received. `details` is `{ from, to }`, the sequence numbers missed. Resync the channel's state from its source of truth |
| `CHANNEL_BUS_PAYLOAD_TOO_LARGE` | The broadcast reached this instance only — see [The 8 KB limit on the Postgres bus](/docs/backend/realtime-transports/#the-8-kb-limit-on-the-postgres-bus) |

Sans gestionnaire attaché, ces erreurs sont journalisées sous forme d'avertissement. Auparavant, elles étaient totalement ignorées : il n'y avait aucune promesse à rejeter et aucun canal auquel les délivrer, de sorte qu'une diffusion refusée était indiscernable d'une diffusion réussie.

## Prochaines étapes

- [Typed SDK](/docs/sdk) — Référence complète du SDK incluant les accesseurs de table typés.
- [Authentication](/docs/backend/authentication) — Configurer l'authentification JWT et les politiques RLS.
- [Backend Architecture](/docs/backend) — Vue d'ensemble de l'architecture du serveur Rebase.
