---
sourceHash: 0804be5779f90bbb
title: Temps réel & WebSocket
sidebar_label: Temps réel
description: Synchronisation des données en temps réel, canaux de diffusion et suivi de présence via WebSocket.
---

Rebase intègre un moteur temps réel qui transmet les modifications de données aux clients connectés via WebSocket.
Lorsqu'un enregistrement est créé, mis à jour ou supprimé, chaque abonné observant cette table ou cette entité reçoit la mise à jour instantanément — aucun polling n'est nécessaire.

## Fonctionnement

Le pipeline temps réel comporte trois étapes :

1. **Déclencheur de base de données** — Une mutation atteint la base de données PostgreSQL (via l'API REST, le SDK ou Studio).
2. **Diffusion par le serveur (fan-out)** — Le serveur Rebase détecte la modification et la diffuse à chaque abonnement WebSocket actif correspondant à la table ou à l'entité concernée.
3. **Rappel (callback) client** — Le SDK typé déclenche votre callback `onUpdate` avec les données fraîches.

```
┌──────────────┐      ┌────────────────────┐      ┌──────────────┐
│  PostgreSQL   │─────▶│  Rebase Server     │─────▶│  Client SDK  │
│  LISTEN/NOTIFY│      │  RealtimeService   │      │  WebSocket   │
└──────────────┘      └────────────────────┘      └──────────────┘
```

Pour les déploiements multi-instances, Rebase utilise le mécanisme `LISTEN/NOTIFY` de PostgreSQL pour propager les changements entre les instances de serveur. Ceci est géré automatiquement. Lorsque la [capture de changements au niveau de la base de données (CDC)](/docs/backend/realtime-cdc/) est activée (par défaut dès lors que le rôle de base de données peut créer des déclencheurs), chaque instance écoute sur le canal `rebase_cdc` sur lequel les déclencheurs de capture publient, de sorte qu'une écriture est détectée quel que soit le processus ou l'outil qui l'a effectuée. Sans cette capture, chaque instance annonce ses propres écritures sur le canal `rebase_entity_changes`, et une connexion dédiée sur chaque autre instance les relaie à ses abonnés locaux.

### Zéro configuration

Le temps réel est activé par défaut. Il n'y a aucun drapeau à basculer ni aucun service à démarrer — si votre serveur Rebase fonctionne, le point de terminaison WebSocket est disponible.

### Quel chemin emprunte le socket

Le socket répond aux demandes d'upgrade sur un seul chemin : le chemin de base de l'API sans le `/api` final, soit `/` pour une API sur `/api`. C'est là que le SDK se connecte : il se connecte à sa `baseUrl`, tandis que ses requêtes HTTP vont vers `${baseUrl}/api`. Une mise à niveau (upgrade) vers tout autre chemin est laissée aux autres écouteurs `upgrade` du serveur, ce qui permet à votre application d'exécuter son propre serveur WebSocket sur le même `http.Server`. En l'absence d'autre écouteur, un tel upgrade renvoie un `404`.

Dans un [serveur personnalisé](/docs/backend/custom-server/), `backend.attachRealtime(server, { path })` définit le chemin, et le paramètre `realtime.path` de l'adaptateur Postgres remplace ce que le serveur a déduit.

> Par défaut, Rebase émet également des événements en temps réel pour les écritures effectuées **en dehors** de l'API (via `psql`, un autre service ou l'éditeur SQL de Studio) dès que la connexion à la base de données le permet — voir [capture de changements au niveau de la base de données](/docs/backend/realtime-cdc/).

## Abonnements via le SDK typé

Le SDK typé de Rebase expose deux méthodes d'abonnement sur chaque accesseur de table :

- **`listen()`** — S'abonner à une table entière (avec des filtres optionnels).
- **`listenById()`** — S'abonner à une entité individuelle par son identifiant (ID).

Les deux méthodes renvoient une **fonction de désabonnement** que vous appelez pour cesser de recevoir des mises à jour.

### S'abonner à une table

Utilisez `listen()` pour recevoir des mises à jour dès que des enregistrements d'une table changent :

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
- `data` — Les lignes, à plat, telles que renvoyées par `find()` (`row.name`, pas `row.values.name`).
- `meta` — Les informations de pagination (`total`, `limit`, `offset`, `hasMore`).

### S'abonner à une table avec des filtres

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

Le callback reçoit la ligne, à plat, telle que renvoyée par `findById()` (`row.name`, pas `row.values.name`), ou `undefined` lorsque la ligne est supprimée.

**Chaque trame transporte la version de la ligne.** `etagOf(row)` correspond à l'`ETag` renvoyé par un `GET` sur la ligne, de sorte qu'une modification effectuée à partir de ce qu'une trame affichait peut être enregistrée avec `ifMatch: etagOf(row)` et est rejetée avec une erreur `412` si la ligne a évolué entre-temps (voir [Écritures conditionnelles](/docs/backend/writes/)). Sur le réseau, le `subscribe_one` du SDK demande avec `etag: true`, et chaque trame `single_update` pour une ligne existante comporte `"etag"` aux côtés de `"row"`. Un serveur antérieur à cette fonctionnalité ignore la demande et n'envoie aucun tag, et un client qui ne le demande pas reçoit des trames sans ce champ.

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
Appelez toujours la fonction de désabonnement lorsqu'un composant est démonté ou lors d'un changement de page. Cela évite les fuites de mémoire et le travail inutile côté serveur.
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
`.listen()` — aussi bien sur le query builder que sur l'accesseur de table — nécessite la connexion WebSocket du client. Le client déduit son URL à partir de `baseUrl` à moins que `websocketUrl` ne soit spécifié. Sur un client créé avec `realtime: false`, ou qui n'a pas pu déduire d'URL, appeler `.listen()` lève une erreur.
:::

## Distribution des mises à jour : patch instantané + réinterrogation pour garantir l'exactitude

Un changement n'est jamais transmis à un abonné sous forme de données brutes. Il voyage sous la forme d'une notification signalant qu'une modification a eu lieu, et chaque abonné est ensuite informé de ce qu'*il* a le droit de voir au moyen d'une requête exécutée sous sa propre identité :

1. **Invalidation.** Lorsqu'une entité change (création, mise à jour, suppression), le
   serveur marque les chemins affectés. La ligne écrite n'est pas transmise —
   elle a été lue sous l'autorisation de l'auteur de l'écriture, ce qui n'indique en rien ce que
   chaque abonné est autorisé à voir.

2. **Réinterrogation RLS temporisée (debounce).** Après **300 ms** (`REFETCH_DEBOUNCE_MS`), le serveur
   réinterroge la table avec vos filtres et votre ordre de tri initiaux. La requête
   s'exécute au sein d'une transaction qui applique les variables locales à la transaction `app.user_id` et
   `app.user_roles` à partir du `SubscriptionAuthContext` de l'abonné, afin que Postgres
   évalue la sécurité au niveau des lignes (RLS) sous l'identité de ce client et que seules les lignes
   qu'il est autorisé à voir soient envoyées dans le `collection_update`. La temporisation (debounce)
   regroupe également une rafale d'écritures en une seule requête. Elle attend 300 ms sans
   nouvelle modification, sans jamais dépasser **1 s** (`REFETCH_MAX_WAIT_MS`) après
   la première, de sorte qu'une table modifiée plusieurs fois par seconde envoie toujours
   une trame à ses abonnés au moins une fois par seconde. Définissez cette limite avec `REALTIME_REFETCH_MAX_WAIT_MS` (ou `realtime.refetchMaxWaitMs`) : une valeur plus élevée réinterroge moins souvent une table très sollicitée, une valeur plus basse envoie des trames plus fraîches.

   Une réinterrogation qui lit exactement ce qui a été envoyé précédemment à un abonné
   ne lui envoie rien : une écriture sur la 9 000e ligne d'une liste n'affichant que les 50 premières coûte
   la lecture, mais pas l'envoi d'une trame à chaque observateur. Après une trame d'erreur, les lignes suivantes
   sont renvoyées même si elles sont identiques.

Les versions antérieures envoyaient un `collection_patch` immédiat transportant la ligne écrite
avant cette réinterrogation, pour un retour d'information entre onglets en moins d'une milliseconde. Cette ligne avait été
lue dans le contexte de l'auteur de l'écriture, si bien qu'elle pouvait — et c'est ce qui arrivait — parvenir à des abonnés dont
les propres politiques d'accès l'auraient refusée, et le filtre `where` de l'abonnement lui-même
ne lui était pas non plus appliqué. Ce patch a été supprimé : la latence perçue pour une
mise à jour correspond désormais à la fenêtre de temporisation (debounce).

### La réinterrogation correspond à la lecture REST

La réinterrogation exécute le même pipeline que `GET /api/data/<table>`, avec la
même gestion des `include`. C'est ce qui garantit que `find({ q })` et `listen({ q })`
renvoient des lignes identiques champ pour champ.

Auparavant, il s'agissait d'une méthode différente — qui encapsulait chaque relation sous une
enveloppe `{ "__type": "relation" }` et qui, comme un abonnement ne pouvait comporter aucun
`include`, chargeait systématiquement **toutes** les relations déclarées par la table. Ainsi, la même
requête répondait sous un certain format via HTTP et sous un autre via le socket, et un client
qui affichait les deux voyait ses lignes changer de format dès qu'une écriture intervenait.

Une trame d'abonnement prend donc les mêmes paramètres qu'une requête de liste : `filter`,
`logical`, `orderBy`, `limit`, `offset`/`page`, `searchString`, `include` et
`fields`. `vectorSearch` fait exception et est **refusé** avec
`VECTOR_SEARCH_NOT_LIVE` — un abonnement étant réexécuté à chaque écriture correspondante,
rien n'y calcule les distances vectorielles.

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

`meta` est calculé au sein de la même transaction soumise à la RLS qui a lu les lignes,
ce qui lui permet de décrire exactement les lignes qui l'accompagnent. Sans cela, un client ayant besoin du total
devait émettre un `GET /count` **à chaque push** — soit un aller-retour supplémentaire par écriture, par
abonné, et une fenêtre de temps durant laquelle le total et les lignes décrivaient des
états différents de la table.

Lorsque le décompte échoue, la trame porte `partial: true` et aucun `total` ;
il ne s'agit pas d'une erreur d'abonnement, et le client doit conserver le dernier total réel
plutôt que de lui substituer la longueur de la page. Sur une grande table, le comptage représente la majeure partie du coût d'une trame. Lorsque `REALTIME_RECOUNT_INTERVAL_MS` est configuré, une liste dont le dernier total était d'au moins `REALTIME_RECOUNT_MIN_ROWS` (100 000 par défaut) réutilise ce total pendant l'intervalle au lieu de recalculer à chaque écriture, et une telle trame indique `meta.totalAsOf`, l'instant où le total a été relevé. Une fois l'intervalle écoulé, une liste dont la dernière trame a réutilisé le total est recomptée et reçoit le nouveau total, que des écritures aient eu lieu ou non depuis. Si ce paramètre n'est pas défini, comme c'est le cas par défaut, chaque trame effectue un décompte.

### Coût d'une écriture et limites

Comme chaque trame correspond à une requête exécutée en tant qu'abonné, le coût d'une écriture augmente
avec le nombre de **requêtes distinctes posées par des entités (principals) distinctes** sur la
table concernée — et non avec le nombre de sockets ouverts :

- Les abonnements qui posent la même question (mêmes chemin, filtres, tri, page,
  `include`, `fields`, recherche) sous la même entité (même identifiant utilisateur, rôles,
  indicateur invité et revendications/claims) partagent une seule réinterrogation. Une écriture dans une liste coûte **une
  seule transaction par groupe de ce type** — la lecture et son décompte — quel que soit le nombre de sockets
  qui la détiennent ; chaque membre reçoit toujours une trame construite à partir des lignes lues sous cette
  identité. Une première page qui renvoie moins d'éléments que sa limite (`limit`) constitue l'ensemble complet,
  elle n'est donc pas recomptée du tout.
- Un abonnement à un enregistrement unique n'est sollicité que lorsque son propre enregistrement change.
- Des entités différentes ne partagent jamais une lecture — c'est ce qui empêche une trame de
  transporter une ligne que son destinataire n'a pas le droit de voir. Une liste observée par un millier
  d'utilisateurs connectés distincts représente mille lectures et mille comptages à chaque
  écriture qui la concerne, dans mille transactions.

Mesuré sur un ordinateur portable avec une base PostgreSQL locale et un pool de 20 connexions, une
écriture sur une liste donne :

| Abonnés | Transactions pour l'écriture | Dernière trame après l'écriture |
|-------------|----------------------------|----------------------------|
| 1 000, une seule entité | 2 | ~310 ms |
| 1 000, chacun une entité différente | ~1 000 | ~600 ms |

300 ms correspondent pour chaque cas à la temporisation (debounce). La seconde ligne représente le plafond à anticiper. Les
réinterrogations s'exécutent sur le même pool que votre trafic REST, mais n'utilisent au maximum qu'un quart de
ses connexions à la fois (5 sur les 20 par défaut, jamais moins de 2) ; le reste
attend son tour dans le serveur, de sorte que la diffusion d'une écriture retarde ses propres trames
plutôt que vos requêtes. Une table modifiée plusieurs fois par seconde pendant que
**des centaines d'utilisateurs différents** observent la même liste est le cas de figure où ces trames
commencent à accuser du retard. Au-delà, privilégiez des abonnements plus restreints (une page, un filtre sur
les propres lignes de l'utilisateur) ou un [canal de diffusion (broadcast)](#canaux-de-diffusion-broadcast-channels) transmettant
la modification pour que les clients la récupèrent selon leur propre calendrier.

**Un socket peut contenir au maximum 1 000 abonnements.** Le suivant est refusé avec une trame d'erreur au code `TOO_MANY_SUBSCRIPTIONS` ; se réabonner sous un identifiant que le socket détient déjà remplace cet abonnement et n'est pas comptabilisé en plus. Le SDK mutualise les abonnements identiques sur un socket, ce qui comptabilise donc les listes et enregistrements distincts ouverts par une page. Modifiez cette limite via `REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET` ou `realtime.maxSubscriptionsPerSocket` sur l'adaptateur Postgres (la variable d'environnement prévaut) ; une valeur qui n'est pas un entier positif arrête le serveur au démarrage. **Les sockets détenus par un utilisateur peuvent également être limités**, par instance de serveur : définissez `REALTIME_MAX_SOCKETS_PER_USER` (ou `realtime.maxSocketsPerUser`), et toute connexion au-delà est refusée avec `TOO_MANY_SOCKETS`, le socket étant fermé avec le code 4002. Les sockets connectés avec une clé d'API sont comptabilisés pour cette clé, chaque clé individuellement, et non pour le compte qui l'a créée ; la clé de service étant un identifiant unique, tous ses sockets sont comptabilisés ensemble. Les sockets d'un administrateur usurpant l'identité d'un utilisateur sont comptabilisés pour l'administrateur, avec ses propres sockets, et non pour l'utilisateur dont il emprunte l'identité. Le SDK avertit simultanément chaque abonnement actif et `onConnectionLost`, avec une erreur `CONNECTION_LOST` dont `details.reason` est `TOO_MANY_SOCKETS`, et continue de réessayer en espaçant les tentatives jusqu'à 30 s, afin que l'onglet puisse se connecter dès qu'un autre socket se ferme. Sans configuration, comme par défaut, il n'y a pas de plafond.

L'identifiant d'abonnement est propre au socket : deux clients nommant tous deux un abonnement `"sub-1"` conservent chacun le leur, et un `unsubscribe` ne met fin qu'à celui de l'émetteur.

**L'abonnement est pris en compte dans la limite de débit de données (rate limit).** La première trame d'un abonnement est une lecture, exécutée sous l'identité de l'abonné, tout comme une requête d'historique de canal. Ainsi, `subscribe_collection`, `subscribe_one` et `channel_history` sont comptabilisés comme des requêtes de données dans le quota de débit de l'appelant (celui que partagent ses requêtes HTTP et ses autres sockets) une fois le quota propre au socket épuisé. Chaque socket peut en envoyer 1 000 sans qu'elles soient décomptées, ou autant que son plafond d'abonnements si celui-ci est supérieur, et ce quota se régénère sur 15 minutes. Cela correspond à tout ce qu'un socket peut contenir, de sorte que le réabonnement après une reconnexion n'est jamais refusé et ne consomme jamais le quota de l'utilisateur. Au-delà du quota, une trame excédentaire est rejetée avec une trame d'erreur au code `RATE_LIMITED`, que le SDK transmet au gestionnaire `onError` de cet abonnement, ou à celui du canal.

### Sockets qui ne répondent plus

Un client peut disparaître sans fermer son socket : un téléphone perd
le réseau, un ordinateur portable se met en veille, un routeur NAT oublie la connexion. Aucune trame de fermeture
ne parvient au serveur, rien ne l'en informe donc. Le serveur envoie par conséquent un ping à chaque socket
toutes les 30 secondes et met fin à ceux qui n'ont pas répondu lors du ping suivant ; un client disparu
est ainsi libéré en moins d'une minute. Les navigateurs et le SDK répondent automatiquement aux
pings ; un client qui communique directement avec le protocole doit également y répondre, comme le font la plupart des bibliothèques WebSocket.

**Côté navigateur.** Un navigateur ne peut pas envoyer de ping ni en voir un ; un socket à moitié ouvert lui paraît donc connecté indéfiniment. Le SDK ouvre le socket avec `?rebase_caps=heartbeat,channel_seq,cancel_sql` ; un serveur qui les reconnaît répond par `{"type":"hello","capabilities":[…],"heartbeatMs":30000}`, énumérant celles qu'il prend en charge (`cancel_sql` : il accepte la trame `CANCEL_SQL` de la console SQL), et envoie `{"type":"heartbeat"}` toutes les 30 secondes. Le SDK ferme alors le socket et [se reconnecte](#reconnexion-automatique) après deux battements manqués. Un client qui ne spécifie rien ne reçoit ni l'un ni l'autre, et un serveur plus ancien ignore le paramètre, de sorte qu'un SDK communiquant avec lui conserve son comportement antérieur.

Un socket est également interrompu lorsque plus de 16&nbsp;Mio de trames qui lui ont été envoyées
demeurent non lues. Cela correspond à un client qui ne lit pas ce qui lui est envoyé, ou qui a pris un tel
retard que ce qu'il lirait serait obsolète. Et lorsque l'ensemble des sockets d'un serveur
cumulent plus de 256&nbsp;Mio non lus (ou un quart de la limite de mémoire allouée au serveur
si celle-ci est inférieure), ceux ayant le plus de données non lues sont fermés
en premier, jusqu'à ce que le volume restant redevienne acceptable.

Un socket interrompu est nettoyé de la même manière qu'un socket fermé. Ses abonnements prennent fin, il
quitte ses canaux et sa présence est retirée, le départ étant notifié
aux autres membres. Un client toujours en ligne constate la perte de connexion,
et le SDK [se reconnecte](#reconnexion-automatique) puis s'abonne à nouveau.

## Canaux de diffusion (Broadcast Channels)

Les canaux de diffusion permettent aux clients de s'envoyer des messages arbitraires en temps réel — très pratique pour des fonctionnalités telles que les indicateurs de frappe, la position des curseurs ou des notifications personnalisées.

La diffusion est gérée au niveau du protocole WebSocket. Le serveur prend en charge les types de messages suivants :

| Type de message | Direction | Description |
|---|---|---|
| `join_channel` | Client → Serveur | Rejoindre un canal nommé |
| `leave_channel` | Client → Serveur | Quitter un canal |
| `broadcast` | Client → Serveur | Envoyer un message à tous les membres du canal |
| `broadcast` | Serveur → Client | Recevoir un message d'un autre membre |
| `channel_history` | Client → Serveur | Demander les messages conservés après un numéro de séquence |
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

Par défaut, une diffusion parvient aux membres actuellement connectés puis disparaît. C'est le compromis idéal pour les notifications et les curseurs, et cela ne coûte rien.

Pour un flux d'opérations — édition collaborative ou tout cas où une interruption silencieuse entraîne une divergence —, un canal peut être configuré pour **retenir** (conserver) ses messages. Les messages diffusés et retenus reçoivent un numéro de séquence par canal et sont stockés, afin qu'un client qui se reconnecte puisse demander tout ce qui a été émis après le dernier message qu'il a reçu.

:::caution[Où configurer cela]
**Runtime géré : nulle part.** La rétention de canal et `realtime.bus` font partie
de l'adaptateur de base de données que le runtime géré instancie lui-même, et aucun des deux ne dispose d'une
forme par variable d'environnement. Éjectez le projet pour les configurer.
**Éjecté :** `createPostgresAdapter({ realtime })` dans `backend/src/index.ts`.
:::

La rétention est optionnelle et se configure ici, côté serveur :

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
|---|---|
| `match` | Nom exact du canal (`"doc:42"`) ou préfixe terminé par `*` (`"doc:*"`) |
| `limit` | Conserver au maximum ce nombre de messages les plus récents par canal |
| `ttl` | Conserver les messages au maximum pendant cette durée — `"30s"`, `"15m"`, `"24h"`, `"7d"` ou en millisecondes |

Une règle nécessite au moins `limit` ou `ttl`. Une règle ne comportant ni l'un ni l'autre est ignorée et consignée dans les logs, car une rétention illimitée n'est presque jamais souhaitée et s'avère irréversible une fois la table volumineuse.

:::note[Pourquoi ne pas laisser les clients demander l'historique ?]
Un canal est créé par quiconque le nomme. Si un client pouvait choisir sa propre profondeur d'historique, n'importe quel visiteur pourrait engager votre backend dans un stockage illimité. Le configurer ici permet également de s'assurer que les canaux de présence et de notification — l'immense majorité — ne coûtent rien : sans règle configurée, aucune table n'est créée et la diffusion emprunte la même voie synchrone qu'auparavant.
:::

### Stockage

Les canaux avec rétention utilisent deux tables dans le schéma `rebase`, créées automatiquement au démarrage dès qu'au moins une règle est configurée :

| Table | Contenu |
|---|---|
| `rebase.channel_messages` | Les messages retenus, indexés par `(channel, seq)` |
| `rebase.channel_cursors` | Le numéro de séquence le plus élevé émis par canal |

La purge s'effectue au fil de l'arrivée des messages, avec une régulation par canal pour que le coût suive le temps écoulé plutôt que le volume d'écritures. Elle ne supprime jamais que des lignes de `channel_messages` — les curseurs sont conservés indéfiniment (il s'agit d'une seule petite ligne par canal), car réinitialiser la séquence d'un canal modifierait la signification du point de reprise sauvegardé par un client.

### Garanties de distribution

- **Ordonnée.** Les numéros de séquence sont alloués par canal, et l'ordre de distribution correspond à l'ordre des séquences — sur une seule instance, ainsi qu'entre instances sur le bus `postgres`, où l'instruction qui numérote un message est également celle qui l'annonce, de sorte que chaque instance (y compris celle de l'émetteur) reçoit les annonces dans l'ordre de la séquence. Un bus fourni par vos soins transporte les trames dans l'ordre où il les délivre.
- **Durable avant distribution.** Un message qui ne peut pas être stocké n'est délivré à personne, et l'expéditeur en est informé. Le distribuer le présenterait aux abonnés actifs tout en l'excluant de toute relecture ultérieure, et aucun message postérieur ne pourrait combler ce vide.
- **Au moins une fois lors du rattrapage.** Une plage de relecture peut chevaucher des messages qu'un client a déjà reçus ; le SDK ignore ceux qu'il a déjà délivrés.
- **Sans lacunes.** Un message retenu parvient à chaque membre : l'expéditeur, qui ne reçoit jamais son propre message, reçoit à la place `{"type":"broadcast_ack","channel","seq"}` lorsqu'il a activé l'option `channel_seq`. Ainsi, un message supérieur à `lastSeq + 1` signifie qu'un message a été manqué : le SDK le met en attente, réclame l'historique intermédiaire et les distribue tous dans l'ordre. Face à un serveur sans `channel_seq`, un saut de séquence est distribué tel quel dès son arrivée.

:::caution[L'historique partage le même modèle d'accès que le canal]
Un client ayant rejoint un canal peut rejouer ses messages conservés, y compris ceux diffusés avant son arrivée — l'appartenance au canal est le seul contrôle, et rejoindre un canal est accessible à tout client capable d'en indiquer le nom. La rétention étant activée à la demande par motif de canal, son activation rend le passé de ce canal lisible par tout visiteur qui en devine le nom. Les canaux avec rétention rendent ces données durables plutôt qu'éphémères ; traitez donc le contenu d'un canal retenu comme public pour vos utilisateurs.
:::

## Suivi de présence

Le suivi de présence permet de savoir quels utilisateurs sont actuellement en ligne dans un canal et permet à chacun de partager un état personnalisé (ex. : position du curseur, statut).

| Type de message | Direction | Description |
|---|---|---|
| `presence_track` | Client → Serveur | Commencer le suivi de présence avec un état personnalisé |
| `presence_untrack` | Client → Serveur | Arrêter le suivi de présence |
| `presence_state` | Client → Serveur | Demander l'état de présence complet pour un canal |
| `presence_state` | Serveur → Client | L'ensemble des présences dans le canal, dans leur intégralité |
| `presence_diff` | Serveur → Client | Mise à jour incrémentielle (arrivées et départs) |

Lorsqu'un client envoie `presence_track`, le serveur l'ajoute automatiquement au canal (aucun `join_channel` séparé n'est requis) et diffuse un `presence_diff` à tous les membres du canal. Le SDK renvoie son état toutes les ~20 secondes sous forme de heartbeat (battement de cœur) ; un battement dont l'état n'a pas changé se contente de rafraîchir le délai d'expiration du client sans envoyer de `presence_diff`.

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

Le SDK typé se reconnecte automatiquement en cas de coupure de la connexion WebSocket :

- **Backoff exponentiel** — Chaque nouvelle tentative attend un intervalle qui commence à 2 secondes et double à chaque fois, jusqu'à un maximum de 30 secondes. Le délai est tiré au hasard au sein de cet intervalle, sans jamais descendre sous un quart de seconde, de sorte que les clients déconnectés simultanément lors d'un déploiement se reconnectent de manière échelonnée plutôt qu'au même instant.
- **Aucun abandon tant qu'un élément est actif** — Tant qu'il existe un abonnement ou un canal rejoint, le client continue de retenter avec le plafond de 30 secondes aussi longtemps que dure la panne. Si rien n'est enregistré, il s'arrête après 5 tentatives infructueuses, et le prochain abonnement relancera une tentative. Dans un navigateur, l'événement `online` ainsi que le retour de l'onglet au premier plan déclenchent immédiatement une reconnexion sans attendre l'expiration du backoff.
- **Les coupures ne sont signalées qu'une seule fois** — Lorsque la connexion est interrompue depuis 14 secondes, quel que soit le nombre de tentatives effectuées, le callback `onError` de chaque abonnement actif et de chaque canal rejoint reçoit une `RebaseApiError` avec le code `CONNECTION_LOST`. L'abonnement est **conservé** : l'erreur indique simplement que ses données ne se mettent plus à jour, non pas qu'il a pris fin.
- **Réabonnement automatique** — Lors d'une reconnexion réussie, tous les abonnements actifs sont réenregistrés auprès du serveur, et le prochain `onUpdate` de chacun d'eux apporte tout ce qui a été écrit pendant l'absence du client. Cette mise à jour fait office de signal de rétablissement. Aucune intervention manuelle n'est requise.
- **Les requêtes sont traitées « au plus une fois » (at-most-once)** — Une requête effectuée pendant que le socket est indisponible l'attend pendant 30 secondes au maximum à compter de l'appel, puis échoue avec `REQUEST_TIMEOUT` sans jamais avoir été envoyée. Une requête déjà envoyée au moment où la connexion a été coupée échoue avec `CONNECTION_LOST` et n'est **pas** renvoyée : le serveur a pu l'exécuter ou non, et seul l'appelant sait si une double exécution est sans danger.

`client.ws.state` indique l'état de la connexion, et `onStateChange` est notifié à chaque
changement :

| State | Meaning |
|---|---|
| `idle` | Aucun socket, et aucun n'est encore nécessaire (la connexion est paresseuse/lazy), ou une déconnexion l'a fermé. |
| `connecting` | Connexion en cours, sans panne préalable. |
| `connected` | Le socket est ouvert. |
| `reconnecting` | Le socket a été coupé et le client tente de se reconnecter. Rien n'a encore été signalé. |
| `disconnected` | La panne dure depuis 14 secondes ou plus. `CONNECTION_LOST` a été signalé, et le client continue de retenter. |
| `closed` | `client.close()` a été appelé. État final. |

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

L'interface d'administration de Rebase affiche son propre bandeau lorsque l'état est `disconnected`, et conserve les lignes et enregistrements déjà présents à l'écran au lieu de les remplacer par une erreur.

## Authentification & RLS

Les abonnements WebSocket respectent automatiquement les politiques de sécurité au niveau des lignes (RLS). Lorsque le client est authentifié :

1. La connexion WebSocket s'authentifie en utilisant le même jeton JWT que l'API REST.
2. Chaque réinterrogation d'abonnement s'exécute au sein d'une transaction PostgreSQL avec `set_config('app.user_id', ...)` et `set_config('app.user_roles', ...)` — garantissant l'application des politiques RLS.
3. L'identité est revérifiée tant que le socket est ouvert, et pas seulement lors de son authentification initiale. Avant chaque trame, le serveur effectue les mêmes vérifications qu'une requête HTTP : le jeton est-il toujours valide, sa session a-t-elle été fermée ou révoquée, le compte existe-t-il toujours et quels rôles détient-il désormais. Pour les trames de canaux, cette vérification a lieu au maximum une fois par seconde. Les trames qui parviennent sur un socket alors que sa vérification est déjà en cours — par exemple un client renvoyant ses abonnements après une reconnexion — partagent cette vérification au lieu de redemander chacune de leur côté ; la trame suivante une fois celle-ci terminée lancera une nouvelle vérification. Un socket qui se contente d'écouter est vérifié au moins toutes les 30 secondes, et un jeton cesse d'être accepté dès la seconde où il expire. Le retrait d'un rôle s'applique dès la trame suivante (ou, pour une trame ayant partagé une vérification déjà en cours, dès la trame d'après), aussi bien pour les lectures, les écritures que les abonnements ouverts. Un socket dont l'identité n'est plus valide reçoit une trame `AUTH_ERROR` et est fermé avec le code `4001`. Avec l'authentification intégrée, le code de la trame en précise la raison, de la même manière que les routes HTTP : `SESSION_REVOKED` (déconnexion, révocation ou compte supprimé), `ACCOUNT_DISABLED` ou `TOKEN_EXPIRED` ; pour un autre adaptateur d'authentification, le code est `SESSION_ENDED`. Une requête `AUTHENTICATE` pour une session révoquée ou un compte désactivé est rejetée avec `SESSION_REVOKED` ou `ACCOUNT_DISABLED` (un jeton non vérifiable ou expiré donne lieu à `INVALID_TOKEN`). Le SDK ne réessaye pas avec le même jeton et transmet le refus, code inclus, au `onError` de l'opération qui nécessitait le compte. Le SDK réauthentifie son socket à chaque rafraîchissement de son jeton ; un nouveau jeton pour la même identité (mêmes identifiant utilisateur, rôles, indicateur invité et revendications) conserve les abonnements ouverts tels quels, tandis qu'un jeton pour une identité différente réinterroge chacun d'eux sous cette nouvelle identité. Après une erreur `4001`, il se reconnecte avec la session dont il dispose à ce moment-là, ou sans session. Un client utilisant directement le protocole doit envoyer un jeton actualisé via `AUTHENTICATE` avant que l'ancien n'expire.

Cela signifie que chaque socket ne reçoit que les mises à jour des enregistrements que son identité authentifiée est autorisée à voir.

Une [clé d'API](/docs/backend/api-keys/) permet également d'authentifier le socket : envoyez la
clé `rk_…` à l'emplacement où se trouverait le jeton d'accès. Le socket vérifie alors chaque trame
au regard des [portées (scopes)](/docs/backend/roles-and-scopes/) de la clé : une récupération (fetch), un décompte ou un
abonnement requiert `data:read` sur sa table, une sauvegarde `data:write`, une suppression
`data:delete`. Un chemin imbriqué nécessite la portée standard. Les canaux (broadcast et
présence) sont refusés pour une clé, car aucune portée ne les couvre. Les messages de l'éditeur SQL et
de gestion des branches requièrent `database:read` ou `database:write`, tant pour une clé que pour une personne
physique.

L'exécution de plusieurs instances — le bus LISTEN/NOTIFY, le comportement de la présence
entre les processus et l'écriture de votre propre transport — fait l'objet d'une page dédiée :
[Temps réel sur plusieurs instances](/docs/backend/realtime-transports/).

## Capture de changements au niveau de la base de données (CDC)

Chaque écriture validée (commit) émet des événements en temps réel, quel que soit son mode d'exécution : REST, le
SDK, Studio, `psql`, une tâche cron dans un autre service. Pour comprendre le fonctionnement de la capture, le
paramètre `REALTIME_CDC` et ses prérequis : [Capture de changements de base de données](/docs/backend/realtime-cdc/).

## Délai d'expiration des requêtes en attente

Pour éviter que les requêtes clientes ne restent bloquées indéfiniment, toutes les opérations WebSocket en attente qui prévoient une réponse du serveur (telles que les récupérations ponctuelles de table `FETCH_COLLECTION`, les récupérations d'une entité unique `FETCH_ONE`, la création/mise à jour `SAVE`, les suppressions `DELETE`, les décomptes `COUNT` et les vérifications d'unicité `CHECK_UNIQUE_FIELD`) ont un délai d'expiration (timeout) par défaut de 30 secondes.

Si le serveur ne répond pas dans cette fenêtre de 30 secondes, le client supprime automatiquement la requête en attente et rejette la promesse avec une `RebaseApiError` dont le code est `REQUEST_TIMEOUT`.

Les messages unidirectionnels qui n'attendent pas de réponse (comme `subscribe_collection`, `subscribe_one`, `unsubscribe`, `join_channel`, `leave_channel`, `broadcast`, `presence_track`, `presence_untrack`, `presence_state` et `channel_history`) sont résolus immédiatement dès leur émission et ne déclenchent pas ce délai d'expiration. En revanche, un abonnement dont la première trame n'est pas arrivée 30 secondes après l'envoi de la souscription échoue avec l'erreur `SUBSCRIPTION_TIMEOUT` transmise à son `onError`.

### Lorsqu'une trame de canal est refusée

Une trame de canal fonctionne selon le principe « tirer et oublier » (fire-and-forget) : `await channel.broadcast(...)` se résout lorsque
la trame est écrite sur le socket, et **non pas** lorsque le serveur l'a acceptée. C'est
délibéré — une application collaborative diffuse la position d'un curseur soixante fois par
seconde, et attendre un accusé de réception pour chacune transformerait chaque émission en un aller-retour
complet.

Un refus ne peut donc pas se manifester par une promesse rejetée. Il parvient via `onError` :

```typescript
const channel = client.realtime.channel("doc:42");

channel.onError((error) => {
    if (error.code === "CHANNEL_FORBIDDEN") showReadOnlyBanner();
    if (error.code === "RATE_LIMITED") throttleCursorUpdates();
});
```

| Code | Signification |
|------|-------|
| `CHANNEL_FORBIDDEN` | Vous n'êtes pas membre du canal — rejoignez-le avant de diffuser ou de lire son historique |
| `RATE_LIMITED` | Dépassement du quota de trames de canal (7 200 trames de canal par minute par socket) ou, pour une demande d'historique, dépassement de la [limite de débit de données](#coût-dune-écriture-et-limites) |
| `CHANNEL_HISTORY_WRITE_FAILED` | Une diffusion retenue n'a pas pu être persistée et a été abandonnée |
| `CHANNEL_HISTORY_READ_FAILED` | Une demande de rattrapage n'a pas pu être honorée |
| `CHANNEL_HISTORY_GAP` | Déclenché par le client : un rattrapage a révélé que le serveur ne conserve plus des messages que ce client n'a jamais reçus. `details` vaut `{ from, to }`, les numéros de séquence manqués. Resynchronisez l'état du canal depuis sa source de référence |
| `CHANNEL_BUS_PAYLOAD_TOO_LARGE` | La diffusion n'a atteint que cette seule instance — voir [La limite de 8 Ko sur le bus Postgres](/docs/backend/realtime-transports/#the-8-kb-limit-on-the-postgres-bus) |

Sans gestionnaire attaché, ces erreurs sont consignées sous forme d'avertissement. Auparavant, elles étaient
purement ignorées : il n'y avait aucune promesse à rejeter et aucun canal auquel les transmettre,
de sorte qu'une diffusion refusée était impossible à distinguer d'une diffusion distribuée.

## Prochaines étapes

- [Typed SDK](/docs/sdk) — Documentation complète du SDK incluant les accesseurs de tables typés.
- [Authentication](/docs/backend/authentication) — Configurer l'authentification JWT et les politiques RLS.
- [Backend Architecture](/docs/backend) — Vue d'ensemble de l'architecture du serveur Rebase.
