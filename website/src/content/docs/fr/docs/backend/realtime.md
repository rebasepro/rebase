---
sourceHash: 512b1a9970d23a5b
title: Temps réel & WebSocket
sidebar_label: Temps réel
description: Synchronisation des données en temps réel, canaux de diffusion et suivi de présence via WebSocket.
---

Rebase inclut un moteur temps réel intégré qui diffuse les modifications de données aux clients connectés via WebSocket.
Lorsqu'un enregistrement est créé, mis à jour ou supprimé, chaque abonné qui surveille cette table ou entité reçoit la mise à jour instantanément — sans aucun sondage (polling) nécessaire.

## Fonctionnement

Le pipeline temps réel comporte trois étapes :

1. **Déclencheur de base de données** — Une mutation atteint la base de données PostgreSQL (via l'API REST, le SDK ou Studio).
2. **Fan-out du serveur** — Le serveur Rebase détecte la modification et la diffuse (fan-out) à chaque abonnement WebSocket actif correspondant à la table ou entité affectée.
3. **Callback client** — Le SDK typé déclenche votre callback `onUpdate` avec les nouvelles données.

```
┌──────────────┐      ┌────────────────────┐      ┌──────────────┐
│  PostgreSQL   │─────▶│  Rebase Server     │─────▶│  Client SDK  │
│  LISTEN/NOTIFY│      │  RealtimeService   │      │  WebSocket   │
└──────────────┘      └────────────────────┘      └──────────────┘
```

Pour les déploiements multi-instances, Rebase utilise le mécanisme `LISTEN/NOTIFY` de PostgreSQL pour transmettre les modifications entre les instances de serveur. Ceci est géré automatiquement. Lorsque la [capture des modifications au niveau base de données](/docs/backend/realtime-cdc/) est activée (par défaut dès que le rôle de la base de données peut créer des déclencheurs), chaque instance écoute sur le canal `rebase_cdc` sur lequel les déclencheurs de capture publient, afin qu'une écriture soit reçue quel que soit le processus ou l'outil qui l'a effectuée. Sans capture, chaque instance annonce ses propres écritures sur le canal `rebase_entity_changes`, et une connexion dédiée sur chaque autre instance les relaie à ses abonnés locaux.

### Zéro configuration

Le temps réel est activé par défaut. Il n'y a aucun indicateur à basculer ni aucun service à démarrer — si votre serveur Rebase fonctionne, le point de terminaison WebSocket est disponible.

### À quel chemin le socket répond

Le socket prend en charge les mises à niveau (upgrades) sur un seul chemin : le chemin de base de l'API avec le `/api` final supprimé, c'est-à-dire `/` pour une API à `/api`. C'est là que le SDK se connecte : il se connecte à son `baseUrl`, tandis que ses requêtes HTTP vont vers `${baseUrl}/api`. Une mise à niveau vers tout autre chemin est laissée aux autres écouteurs `upgrade` du serveur, ce qui permet à votre application d'exécuter son propre serveur WebSocket sur le même `http.Server`. En l'absence d'autre écouteur, une telle mise à niveau renvoie une réponse `404`.

Dans un [serveur personnalisé](/docs/backend/custom-server/), `backend.attachRealtime(server, { path })` définit le chemin, et l'option `realtime.path` de l'adaptateur Postgres remplace ce que le serveur a déduit.

> Par défaut, Rebase émet également des événements en temps réel pour les écritures effectuées **en dehors** de l'API (via `psql`, un autre service, ou l'éditeur SQL de Studio) dès que la connexion à la base de données le prend en charge — voir la [capture des modifications au niveau base de données](/docs/backend/realtime-cdc/).

## Abonnements avec le SDK typé

Le SDK typé de Rebase expose deux méthodes d'abonnement sur chaque accesseur de table :

- **`listen()`** — S'abonner à une table entière (avec des filtres facultatifs).
- **`listenById()`** — S'abonner à une seule entité via son identifiant.

Les deux méthodes renvoient une **fonction de désabonnement** que vous appelez pour cesser de recevoir les mises à jour.

### S'abonner à une table

Utilisez `listen()` pour recevoir des mises à jour dès que des enregistrements changent dans une table :

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
- `data` — Les lignes, à plat, telles que `find()` les renvoie (`row.name`, pas `row.values.name`).
- `meta` — Informations de pagination (`total`, `limit`, `offset`, `hasMore`).

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

Utilisez `listenById()` pour surveiller un enregistrement spécifique :

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

Le callback reçoit la ligne, à plat, telle que `findById()` la renvoie (`row.name`, pas `row.values.name`), ou `undefined` dès que la ligne est supprimée.

**Chaque trame transporte la version de la ligne.** `etagOf(row)` correspond à l'`ETag` auquel un `GET` de la ligne répond ; ainsi, une modification apportée à ce qu'affichait une trame peut être enregistrée avec `ifMatch: etagOf(row)` et est rejetée avec une erreur `412` si la ligne a évolué entre-temps (voir [Écritures conditionnelles](/docs/backend/writes/)). Sur le réseau, la méthode `subscribe_one` du SDK demande `etag: true`, et chaque trame `single_update` pour une ligne existante transporte `"etag"` à côté de `"row"`. Un serveur antérieur ignore cette demande et n'envoie pas d'étiquette, et un client qui ne la demande pas reçoit des trames sans celle-ci.

### Se désabonner

`listen()` et `listenById()` renvoient toutes deux une fonction de désabonnement. Appelez-la pour cesser de recevoir des mises à jour et nettoyer les ressources côté serveur :

```typescript
const unsubscribe = client.data.products.listen(undefined, (response) => {
  // handle updates
});

// Later, when you no longer need updates:
unsubscribe();
```

:::tip
Appelez toujours la fonction de désabonnement lorsqu'un composant est démonté ou lors d'un changement de page. Cela évite les fuites de mémoire et les opérations inutiles côté serveur.
:::

## `.listen()` du Query Builder

Le constructeur de requêtes fluide (Query Builder) prend également en charge les abonnements temps réel. Enchaînez vos filtres, puis appelez `.listen()` au lieu de `.find()` :

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
`.listen()` — aussi bien sur le query builder que sur l'accesseur de table — nécessite le WebSocket du client. Le client déduit son URL à partir de `baseUrl`, sauf si `websocketUrl` est renseigné. Sur un client créé avec `realtime: false`, ou qui n'a pas pu déduire d'URL, l'appel à `.listen()` lève une erreur.
:::

## Distribution des mises à jour : patch instantané + ré-interrogation pour exactitude

Une modification ne voyage jamais vers un abonné sous forme de données brutes. Elle voyage sous la forme du constat que quelque chose a changé, et chaque abonné est ensuite informé de ce qu'*il* a le droit de voir au moyen d'une requête exécutée avec ses propres droits :

1. **Invalidation.** Lorsqu'une entité change (création, mise à jour, suppression), le serveur marque les chemins affectés. La ligne écrite n'est pas transmise — elle a été lue sous les autorisations de l'auteur de l'écriture, ce qui ne dit rien sur ce qu'un abonné donné a le droit de voir.

2. **Ré-interrogation RLS temporisée (debounce).** Après **300 ms** (`REFETCH_DEBOUNCE_MS`), le serveur ré-interroge la table avec vos filtres et votre ordre de tri d'origine. La requête s'exécute à l'intérieur d'une transaction qui définit `app.user_id` et `app.user_roles` au niveau de la transaction à partir du `SubscriptionAuthContext` de l'abonné, de sorte que Postgres évalue la sécurité au niveau des lignes (Row-Level Security / RLS) sous l'identité de ce client et que seules les lignes qu'il est autorisé à voir soient envoyées dans le `collection_update`. La temporisation regroupe également une salve d'écritures en une seule requête. Elle attend 300 ms sans modification supplémentaire, mais jamais plus de **1 s** (`REFETCH_MAX_WAIT_MS`) après la première, de sorte qu'une table modifiée plusieurs fois par seconde envoie tout de même une trame à ses abonnés au moins une fois par seconde. Définissez cette limite avec `REALTIME_REFETCH_MAX_WAIT_MS` (ou `realtime.refetchMaxWaitMs`) : une valeur plus élevée ré-interroge une table occupée moins souvent, une valeur plus basse envoie des trames plus fraîches.

   Une ré-interrogation qui lit exactement ce qui a été envoyé la dernière fois à un abonné ne lui envoie rien : une écriture sur la ligne 9 000 d'une liste affichant les 50 premières ne coûte que la lecture, et non l'envoi d'une trame à chaque utilisateur qui la consulte. Après une trame d'erreur, les lignes suivantes sont réexpédiées même si elles sont identiques.

Les versions antérieures envoyaient un `collection_patch` immédiat transportant la ligne écrite avant cette ré-interrogation, pour un retour d'information entre onglets en moins d'une milliseconde. Cette ligne avait été lue avec le périmètre de l'auteur de l'écriture ; elle pouvait donc — et c'était le cas — parvenir à des abonnés dont les propres règles l'auraient refusée, et le filtre `where` de l'abonnement ne lui était pas appliqué non plus. Le patch a été supprimé : la latence perçue pour une mise à jour correspond désormais à la fenêtre de temporisation.

### La ré-interrogation correspond à la lecture REST

La ré-interrogation exécute le même pipeline que `GET /api/data/<table>`, avec la même gestion de `include`. C'est ce qui fait que `find({ q })` et `listen({ q })` renvoient des lignes identiques champ par champ.

Il s'agissait auparavant d'une méthode différente — qui encapsulait chaque relation dans une enveloppe `{ "__type": "relation" }` et, comme un abonnement ne pouvait pas comporter de `include`, chargeait hâtivement (eager loading) **chaque** relation déclarée par la table. Ainsi, la même requête répondait sous une certaine forme via HTTP et sous une autre via le socket, et un client affichant les deux voyait la structure de ses lignes changer dès qu'une écriture survenait.

Une trame d'abonnement accepte donc les mêmes paramètres qu'une requête de liste : `filter`, `logical`, `orderBy`, `limit`, `offset`/`page`, `searchString`, `include` et `fields`. `vectorSearch` fait exception et est **refusé** avec `VECTOR_SEARCH_NOT_LIVE` — un abonnement est réexécuté à chaque écriture correspondante, et aucun calcul de distance n'y est effectué.

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

`meta` est calculé à l'intérieur de la même transaction soumise aux RLS qui a lu les lignes, il décrit donc exactement les lignes qui l'accompagnent. Sans cela, un client ayant besoin d'un total devait envoyer un `GET /count` **à chaque push** — un aller-retour supplémentaire par écriture et par abonné, créant une fenêtre temporelle pendant laquelle le total et les lignes décrivaient des états différents de la table.

Lorsque le comptage lui-même échoue, la trame transporte `partial: true` et aucun `total` ; il ne s'agit pas d'une erreur d'abonnement, et un client doit conserver le dernier total réel plutôt que d'y substituer la taille de la page. Sur une table volumineuse, le comptage représente l'essentiel du coût d'une trame. Lorsque `REALTIME_RECOUNT_INTERVAL_MS` est défini, une liste dont le dernier total était d'au moins `REALTIME_RECOUNT_MIN_ROWS` (100 000 par défaut) réutilise ce total pendant l'intervalle au lieu de recompter à chaque écriture, et une telle trame transporte `meta.totalAsOf`, qui indique le moment où le total a été relevé. Lorsque l'intervalle est écoulé, une liste dont la dernière trame a réutilisé le total est recomptée et reçoit le nouveau total, que des écritures aient eu lieu ou non entre-temps. Si cette option n'est pas définie (comme c'est le cas par défaut), chaque trame recalcule le total.

### Coût d'une écriture et limites

Puisque chaque trame est une requête exécutée sous l'identité de son abonné, le coût d'une écriture augmente avec le nombre de **questions distinctes posées par des entités (principals) distinctes** sur la table concernée — et non avec le nombre de sockets ouverts :

- Les abonnements posant la même question (mêmes chemin, filtres, tri, page, `include`, `fields`, recherche) en tant que même entité (mêmes identifiant utilisateur, rôles, statut invité et revendications/claims) partagent une même ré-interrogation. Une écriture sur une liste coûte **une seule transaction par groupe** — la lecture et son décompte — quel que soit le nombre de sockets qui l'écoutent ; chaque membre reçoit toujours une trame construite à partir de lignes lues sous cette identité. Une première page renvoyant moins d'éléments que sa limite (`limit`) constitue l'ensemble complet, elle n'est donc pas comptabilisée du tout.
- Un abonnement à un enregistrement unique n'est sollicité que lorsque son propre enregistrement change.
- Une liste filtrée avec `==` ou `in` sur une colonne de la table n'est sollicitée que lorsque l'écriture peut la concerner : quand la ligne correspondait au filtre avant l'écriture ou y correspond après. `listen({ where: { owner: ["==", me] } })` détenu par cinq mille utilisateurs ne coûte qu'une seule lecture lorsque l'un d'eux écrit l'une de ses lignes, et non cinq mille. Cela détermine uniquement *qui* ré-interroge, jamais ce que chacun reçoit : chaque liste sollicitée effectue toujours sa lecture sous le périmètre de son propre abonné, de sorte qu'une liste demandant les lignes de quelqu'un d'autre est interrogée et ne trouve rien de ce que sa politique lui masque.
- Des entités différentes ne partagent jamais une lecture — c'est ce qui empêche une trame de transporter une ligne que son lecteur n'est pas autorisé à voir. Une liste restreinte uniquement par les RLS (la même liste non filtrée, observée par un millier d'utilisateurs connectés différents) génère mille lectures à chaque écriture sur celle-ci, réparties dans mille transactions.

Le pré-filtrage interroge chaque liste de la table, comme auparavant, dès qu'il ne peut pas garantir qu'une liste n'est pas affectée :

- Il prend en compte `==` et `in` sur les colonnes de type texte, `varchar`, uuid, enum, entier et booléen. Les autres conditions (plages, motifs, chemins JSON, relations, groupes `or(...)`, recherche) sont ignorées, ce qui ne fait qu'élargir ce qu'il admet. Une liste qui charge des relations (`include`), une table avec un hook `afterRead`, et une colonne avec un hook au niveau champ ne sont jamais pré-filtrées.
- Il a besoin des valeurs de la ligne avant et après l'écriture. Une écriture via l'API les fournit lors d'une création, ainsi que pour une mise à jour qui a préalablement lu la ligne (ce que fait chaque mise à jour REST). Une modification lue à partir du WAL (`REALTIME_CDC=wal`, ou `auto` lorsque le WAL est disponible) fournit la totalité de la nouvelle ligne, mais l'ancienne uniquement sous forme de clé, sauf si la table dispose de `REPLICA IDENTITY FULL` — ainsi, un `UPDATE` ou un `DELETE` externe sur une colonne ne faisant pas partie de la clé sollicite chaque liste. Le déclencheur de capture (`REALTIME_CDC=trigger`) n'envoie que la clé, il ne peut donc écarter que les listes filtrées sur cette clé. Une suppression via l'API, ainsi qu'une clé trop volumineuse pour une notification, sollicitent chaque liste.

Mesuré sur un ordinateur portable avec PostgreSQL 18 dans Docker, avec un pool de 20 connexions (`tooling/scripts/bench-realtime-fanout.mts`), pour une écriture sur une table dont la politique affiche à chaque utilisateur ses propres lignes :

| Abonnés sur la table | Transactions pour l'écriture | Fan-out effectué après l'écriture |
|----------------------|------------------------------|-----------------------------------|
| 5 000 utilisateurs, chacun `where owner == me`, écriture via l'API | 1 | ~305 ms |
| 5 000 utilisateurs, chacun `where owner == me`, SQL brut lu depuis le WAL | 1 | ~307 ms |
| 5 000 sockets d'un même utilisateur, une seule liste | 1 | ~311 ms |
| 1 000 utilisateurs, la même liste non filtrée | 1 000 | ~780 ms |
| 5 000 utilisateurs, la même liste non filtrée | 5 000 | ~2,6 s |

300 ms de chaque durée correspondent à la temporisation (debounce). Les deux dernières lignes représentent le plafond à anticiper : une liste que seules les politiques RLS restreignent coûte une lecture par utilisateur distinct et par écriture. Les ré-interrogations s'exécutent sur le même pool que votre trafic REST, mais sur au maximum un quart de ses connexions à la fois (5 sur les 20 par défaut, jamais moins de 2) ; les autres attendent leur tour sur le serveur, de sorte que le fan-out d'une écriture retarde ses propres trames plutôt que vos requêtes. Une table modifiée plusieurs fois par seconde pendant que **des milliers d'utilisateurs différents** observent la même liste non filtrée est le cas de figure où ces trames commencent à prendre du retard. Filtrez l'abonnement sur la colonne que lit votre politique (`where owner == me` en parallèle de `owner = app.uid`) et cela ne coûte à nouveau qu'une seule lecture ; ou utilisez un [canal de broadcast](#canaux-de-diffusion-broadcast-channels) transportant la modification pour que les clients ré-interrogent les données selon leur propre calendrier.

**Un socket peut détenir au maximum 1 000 abonnements.** Le suivant est refusé avec une trame d'erreur portant le code `TOO_MANY_SUBSCRIPTIONS` ; se réabonner avec un identifiant déjà détenu par le socket remplace cet abonnement sans être recompté. Le SDK mutualise les abonnements identiques sur un socket, cette limite compte donc les listes et enregistrements distincts ouverts par une page. Modifiez-la avec `REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET` ou `realtime.maxSubscriptionsPerSocket` sur l'adaptateur Postgres (la variable d'environnement prévaut) ; une valeur qui n'est pas un nombre entier positif interrompt le démarrage du serveur. **Les sockets détenus par un même utilisateur peuvent également être limités**, par instance de serveur : configurez `REALTIME_MAX_SOCKETS_PER_USER` (ou `realtime.maxSocketsPerUser`), et toute connexion au-delà de cette limite est refusée avec `TOO_MANY_SOCKETS` et le socket est fermé avec le code 4002. Les sockets authentifiés avec une clé API sont comptabilisés pour cette clé spécifique, chaque clé de manière indépendante, et non pour le compte qui l'a créée ; la clé de service étant un identifiant unique, tous ses sockets sont comptabilisés ensemble. Les sockets d'un administrateur usurpant l'identité d'un utilisateur (impersonation) sont comptabilisés pour l'administrateur, avec ses propres sockets, et non pour l'utilisateur qu'il incarne. Le SDK avertit simultanément chaque abonnement actif et `onConnectionLost`, avec une erreur `CONNECTION_LOST` dont `details.reason` est `TOO_MANY_SOCKETS`, et continue de réessayer en espaçant chaque tentative jusqu'à 30 s, afin que l'onglet puisse se connecter dès qu'un autre socket se ferme. Si cette option n'est pas définie (par défaut), il n'y a pas de plafond.

Un identifiant d'abonnement est propre au socket : deux clients nommant tous deux un abonnement `"sub-1"` conservent chacun le leur, et un `unsubscribe` ne met fin qu'à celui de l'expéditeur.

**S'abonner est décompté de la limite de débit des données.** La première trame d'un abonnement est une lecture, exécutée sous l'identité de l'abonné, tout comme une requête d'historique de canal. Ainsi, `subscribe_collection`, `subscribe_one` et `channel_history` sont comptabilisés comme des requêtes de données dans le quota (rate limit bucket) de l'appelant (celui partagé par ses requêtes HTTP et ses autres sockets) une fois le quota propre au socket épuisé. Chaque socket peut en envoyer 1 000 sans qu'elles ne soient comptabilisées, ou autant que son plafond d'abonnements si celui-ci est supérieur, et ce quota est renouvelé sur 15 minutes. Cela couvre tout ce qu'un socket peut détenir, garantissant que le réabonnement consécutif à une reconnexion n'est jamais refusé et ne consomme jamais le quota de l'utilisateur. Au-delà de ce quota, une trame excédentaire est refusée avec une trame d'erreur portant le code `RATE_LIMITED`, que le SDK transmet au `onError` de cet abonnement, ou à celui du canal.

### Sockets qui ne répondent plus

Un client peut disparaître sans fermer son socket : perte de signal d'un téléphone, mise en veille d'un ordinateur portable, oubli de la connexion par une passerelle NAT. Aucune trame de fermeture n'arrivant, le serveur n'en est pas informé. Le serveur envoie donc un ping à chaque socket toutes les 30 secondes et met fin à tout socket n'ayant pas répondu avant le ping suivant, de sorte qu'un client déconnecté est libéré en moins d'une minute. Les navigateurs et le SDK répondent automatiquement aux pings ; un client qui utilise directement le protocole doit également y répondre, comme le font la plupart des bibliothèques WebSocket.

**Côté navigateur.** Un navigateur ne peut pas envoyer de ping ni en intercepter un ; un socket semi-ouvert (half-open) lui semble donc connecté indéfiniment. Le SDK ouvre le socket avec `?rebase_caps=heartbeat,channel_seq,cancel_sql` ; un serveur qui les prend en charge répond avec `{"type":"hello","capabilities":[…],"heartbeatMs":30000}`, en listant celles qu'il honore (`cancel_sql` : il accepte la trame `CANCEL_SQL` de la console SQL), et envoie `{"type":"heartbeat"}` toutes les 30 secondes. Le SDK abandonne alors le socket et [se reconnecte](#reconnexion-automatique) après deux signaux manqués. Un client qui ne spécifie rien ne reçoit ni l'un ni l'autre, et un serveur plus ancien ignore ce paramètre, de sorte qu'un SDK communiquant avec ce dernier conserve son comportement antérieur.

Un socket est également interrompu lorsque plus de 16&nbsp;Mio de trames qui lui ont été envoyées restent non lues. Cela correspond à un client qui ne lit pas ce qu'on lui envoie, ou à un client ayant pris tellement de retard que ce qu'il lirait serait obsolète. Et lorsque l'ensemble des sockets d'un serveur cumule plus de 256&nbsp;Mio non lus (ou un quart de la limite de mémoire allouée au serveur, si celle-ci est inférieure), ceux présentant le plus grand volume non lu sont interrompus en premier, jusqu'à ce que le reste respecte la limite.

Un socket interrompu est nettoyé de la même manière qu'un socket fermé. Ses abonnements prennent fin, il quitte ses canaux et sa présence est supprimée, le départ étant notifié aux autres membres. Un client toujours présent constate la rupture de connexion, puis le SDK [se reconnecte](#reconnexion-automatique) et s'abonne à nouveau.

## Canaux de diffusion (Broadcast Channels)

Les canaux de broadcast permettent aux clients de s'envoyer mutuellement des messages arbitraires en temps réel — très pratique pour des fonctionnalités telles que les indicateurs de saisie, les positions de curseur ou des notifications personnalisées.

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

Pour un flux d'opérations — édition collaborative ou tout cas où une interruption silencieuse entraînerait une divergence —, un canal peut être configuré pour **conserver** ses messages. Les diffusions conservées reçoivent un numéro de séquence par canal et sont stockées, de sorte qu'un client qui se reconnecte peut demander tout ce qui a été émis après le dernier message qu'il a reçu.

:::caution[Où configurer cela]
**Environnement géré (Managed runtime) : nulle part.** La rétention des canaux et `realtime.bus` font partie de l'adaptateur de base de données que l'environnement géré configure lui-même, et aucun des deux ne dispose d'équivalent sous forme de variable d'environnement. Éjectez l'application pour les configurer.
**Application éjectée :** `createPostgresAdapter({ realtime })` dans `backend/src/index.ts`.
:::

La rétention est activable sur option et se configure ici, côté serveur :

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
| `match` | Nom exact du canal (`"doc:42"`) ou préfixe se terminant par `*` (`"doc:*"`) |
| `limit` | Conserver au maximum ce nombre de messages récents par canal |
| `ttl` | Conserver les messages au maximum pendant cette durée — `"30s"`, `"15m"`, `"24h"`, `"7d"`, ou en millisecondes |

Une règle doit définir au moins `limit` ou `ttl`. Une règle ne définissant aucun des deux est ignorée et consignée dans les logs, car une rétention illimitée n'est presque jamais souhaitée et il est impossible de revenir en arrière une fois que la table a grossi.

:::note[Pourquoi ne pas laisser les clients demander l'historique ?]
Un canal est créé par quiconque le nomme. Si un client pouvait choisir sa propre profondeur d'historique, n'importe quel visiteur pourrait contraindre votre backend à un stockage démesuré. Le fait de le configurer ici garantit également que les canaux de présence et de notification — l'écrasante majorité — ne coûtent rien : en l'absence de règles configurées, aucune table n'est créée et le broadcast emprunte le même chemin synchrone qu'auparavant.
:::

### Stockage

Les canaux avec rétention utilisent deux tables dans le schéma `rebase`, créées automatiquement au démarrage dès qu'au moins une règle est configurée :

| Table | Contenu |
|---|---|
| `rebase.channel_messages` | Les messages conservés, indexés par `(channel, seq)` |
| `rebase.channel_cursors` | Le numéro de séquence le plus élevé émis par canal |

La purge a lieu au fur et à mesure de l'arrivée des messages, avec une régulation (throttle) par canal afin que le coût dépende du temps écoulé plutôt que du volume d'écriture. Elle ne supprime jamais que des lignes de `channel_messages` — les curseurs sont conservés indéfiniment (il s'agit d'une petite ligne par canal), car réinitialiser la séquence d'un canal modifierait la signification du point de reprise sauvegardé par un client.

### Garanties de livraison

- **Ordonnée.** Les numéros de séquence sont attribués par canal, et l'ordre de livraison correspond à l'ordre des séquences — sur une instance unique, ainsi qu'entre instances sur le bus `postgres`, où l'instruction qui numérote un message l'annonce également, de sorte que chaque instance (y compris celle de l'expéditeur) reçoit les annonces dans l'ordre séquentiel. Un bus fourni par vos soins transporte les trames dans l'ordre où il les délivre.
- **Durable avant livraison.** Un message qui ne peut pas être stocké n'est livré à personne, et l'expéditeur en est informé. Le livrer le présenterait aux abonnés en direct tout en l'excluant de tout rejeu futur, et aucun message ultérieur ne pourrait combler ce manque.
- **Au moins une fois (At-least-once) lors du rattrapage.** Une plage de rejeu peut chevaucher des messages qu'un client a déjà reçus ; le SDK élimine ceux qu'il a déjà délivrés.
- **Sans trou (No holes).** Un message conservé parvient à chaque membre : l'expéditeur, à qui son propre message n'est jamais renvoyé, reçoit à la place `{"type":"broadcast_ack","channel","seq"}` lorsqu'il a activé `channel_seq`. Ainsi, un message supérieur à `lastSeq + 1` signifie qu'un message a été manqué : le SDK le met en attente, demande l'historique intermédiaire et les livre tous dans l'ordre. Avec un serveur sans `channel_seq`, un saut de séquence est livré dès son arrivée.

:::caution[L'historique a le même modèle d'accès que le canal]
Un client qui a rejoint un canal peut rejouer ses messages conservés, y compris ceux diffusés avant son arrivée — l'appartenance au canal est la seule vérification, et rejoindre un canal est ouvert à tout client connaissant son nom. La rétention s'active par motif de canal ; l'activer rend donc le passé de ce canal lisible pour tout visiteur qui en devine le nom. Les canaux avec rétention représentent le cas où cela devient durable plutôt qu'éphémère : traitez donc le contenu d'un canal avec rétention comme public pour vos utilisateurs.
:::

## Suivi de présence

La présence permet de savoir quels utilisateurs sont actuellement en ligne dans un canal et permet à chacun de partager un état personnalisé (par exemple, position du curseur, statut).

| Type de message | Direction | Description |
|---|---|---|
| `presence_track` | Client → Serveur | Commencer à suivre la présence avec un état personnalisé |
| `presence_untrack` | Client → Serveur | Arrêter le suivi de présence |
| `presence_state` | Client → Serveur | Demander l'état de présence complet pour un canal |
| `presence_state` | Serveur → Client | L'ensemble des présences dans le canal, au complet |
| `presence_diff` | Serveur → Client | Mise à jour incrémentielle (arrivées et départs) |

Lorsqu'un client envoie `presence_track`, le serveur le fait automatiquement rejoindre le canal (aucun `join_channel` distinct n'est nécessaire) et diffuse un `presence_diff` à tous les membres du canal. Le SDK renvoie son état environ toutes les 20 secondes sous forme de heartbeat ; un heartbeat dont l'état n'a pas changé réinitialise simplement le délai d'expiration du client sans envoyer de `presence_diff`.

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

- **Backoff exponentiel** — Chaque reconnexion attend selon un intervalle qui commence à 2 secondes et double à chaque tentative, jusqu'à 30 secondes. Le délai est tiré au sort à n'importe quel moment de cet intervalle, mais jamais en dessous d'un quart de seconde, de sorte que les clients déconnectés en même temps lors d'un déploiement se reconnectent de manière étalée plutôt qu'au même instant.
- **Aucun abandon tant qu'un élément est actif** — Tant qu'un abonnement ou un canal rejoint existe, le client continue de tenter de se reconnecter au plafond de 30 secondes pendant toute la durée de la panne. Si rien n'est enregistré, il s'arrête après 5 tentatives infructueuses, et le prochain abonnement déclenchera une nouvelle tentative. Dans un navigateur, l'événement `online` et le fait que l'onglet redevienne visible déclenchent tous deux une reconnexion immédiate au lieu d'attendre la fin du délai de backoff.
- **Les interruptions sont signalées une seule fois** — Lorsque la connexion est interrompue depuis 14 secondes, quel que soit le nombre de tentatives de reconnexion effectuées, le gestionnaire `onError` de chaque abonnement actif et de chaque canal rejoint reçoit une erreur `RebaseApiError` avec le code `CONNECTION_LOST`. L'abonnement est **conservé** : l'erreur indique que ses données ne sont plus mises à jour, et non qu'il a pris fin.
- **Réabonnement automatique** — Lors d'une reconnexion réussie, tous les abonnements actifs sont réenregistrés auprès du serveur, et le prochain `onUpdate` de chacun d'eux transmet tout ce qui a été écrit pendant l'absence du client. Cette mise à jour fait office de signal de reprise. Aucune intervention manuelle n'est requise.
- **Les requêtes sont au plus une fois (at-most-once)** — Une requête effectuée pendant que le socket est indisponible attend son rétablissement pendant un maximum de 30 secondes à compter de l'appel, puis échoue avec `REQUEST_TIMEOUT` sans jamais avoir été envoyée. Une requête qui avait déjà été envoyée lorsque la connexion a été coupée échoue avec `CONNECTION_LOST` et n'est **pas** renvoyée : le serveur a pu l'exécuter ou non, et seul l'appelant sait s'il est sans danger de l'exécuter deux fois.

`client.ws.state` indique l'état de la connexion, et `onStateChange` est notifié de chaque changement :

| État | Signification |
|---|---|
| `idle` | Pas de socket, et aucun n'est encore requis (la connexion est paresseuse/lazy), ou une déconnexion l'a fermé. |
| `connecting` | Connexion en cours, sans panne préalable. |
| `connected` | Le socket est ouvert. |
| `reconnecting` | Le socket s'est déconnecté et le client tente de se reconnecter. Rien n'a encore été signalé. |
| `disconnected` | L'interruption dure depuis 14 secondes ou plus. `CONNECTION_LOST` a été signalé, et le client continue de tenter de se reconnecter. |
| `closed` | `client.close()` a été appelé. Définitif. |

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
2. Chaque ré-interrogation d'abonnement s'exécute à l'intérieur d'une transaction PostgreSQL avec `set_config('app.user_id', ...)` et `set_config('app.user_roles', ...)` — garantissant l'application des politiques RLS.
3. L'identité est revérifiée tant que le socket reste ouvert, et pas seulement au moment de l'authentification. Avant chaque trame, le serveur effectue les mêmes vérifications qu'une requête HTTP : le jeton est-il toujours valide, sa session a-t-elle été fermée ou révoquée, le compte existe-t-il toujours et quels rôles détient-il désormais. Les trames de canaux sont vérifiées au maximum une fois par seconde. Les trames arrivant sur un socket alors que sa vérification est déjà en cours — un client renvoyant ses abonnements après une reconnexion — partagent cette vérification au lieu d'interroger à nouveau ; la trame suivante une fois la vérification terminée déclenchera une nouvelle interrogation. Un socket qui ne fait qu'écouter est vérifié au moins toutes les 30 secondes, et un jeton cesse d'être accepté dès l'instant où il expire. Un rôle retiré s'applique dès la trame suivante (ou, pour une trame ayant partagé une vérification déjà en cours, dès celle d'après), pour les lectures, les écritures et les abonnements ouverts indistinctement. Un socket dont l'identité a pris fin reçoit une trame `AUTH_ERROR` et est fermé avec le code `4001`. Avec l'authentification intégrée, le code de la trame en précise la raison, tout comme le font les routes HTTP : `SESSION_REVOKED` (déconnexion, révocation ou compte supprimé), `ACCOUNT_DISABLED` ou `TOKEN_EXPIRED` ; pour un autre adaptateur d'authentification, ce sera `SESSION_ENDED`. Un message `AUTHENTICATE` pour une session révoquée ou un compte désactivé est refusé avec `SESSION_REVOKED` ou `ACCOUNT_DISABLED` (un jeton non vérifié ou expiré avec `INVALID_TOKEN`). Le SDK ne réessaye pas avec le même jeton et transmet le refus, code inclus, au gestionnaire `onError` de l'opération qui nécessitait le compte. Le SDK réauthentifie son socket à chaque rafraîchissement de son jeton ; un nouveau jeton pour la même identité (mêmes identifiant utilisateur, rôles, statut invité et revendications) conserve les abonnements ouverts tels quels, tandis qu'un jeton pour une identité différente ré-interroge chacun d'eux sous cette nouvelle identité. Après une erreur `4001`, il se reconnecte avec la session qu'il détient à ce moment-là, ou sans aucune session. Un client utilisant directement le protocole doit envoyer un nouveau jeton via `AUTHENTICATE` avant que l'ancien n'expire.

Cela garantit que chaque socket ne reçoit que les mises à jour des enregistrements que son identité authentifiée est autorisée à voir.

Une [clé API](/docs/backend/api-keys/) authentifie également le socket : envoyez la clé `rk_…` là où le jeton d'accès serait placé. Le socket vérifie alors chaque trame par rapport aux [périmètres (scopes)](/docs/backend/roles-and-scopes/) de la clé : une récupération, un décompte ou un abonnement nécessite `data:read` sur sa table, un enregistrement nécessite `data:write`, une suppression `data:delete`. Un chemin imbriqué nécessite le périmètre simple. Les canaux (broadcast et présence) sont refusés avec une clé, car aucun périmètre ne les couvre. L'éditeur SQL et les messages de branche nécessitent `database:read` ou `database:write`, tant pour une clé que pour un utilisateur.

L'exécution de plusieurs instances — le bus LISTEN/NOTIFY, le comportement de la présence entre processus, et l'écriture de votre propre transport — dispose d'une page dédiée : [Le temps réel entre instances](/docs/backend/realtime-transports/).

## Capture des modifications au niveau base de données (CDC)

Chaque écriture validée (committed) émet des événements en temps réel, quelle que soit la manière dont elle a été effectuée : REST, SDK, Studio, `psql`, une tâche cron dans un autre service. Pour découvrir le fonctionnement de la capture, le paramètre `REALTIME_CDC` et ses prérequis : [Capture des modifications de base de données](/docs/backend/realtime-cdc/).

## Délai d'expiration des requêtes en attente

Pour éviter que les requêtes clientes ne restent bloquées indéfiniment, toutes les opérations WebSocket en attente qui prévoient une réponse du serveur (telles que les récupérations ponctuelles de table `FETCH_COLLECTION`, les récupérations d'une entité unique `FETCH_ONE`, la création/mise à jour `SAVE`, les suppressions `DELETE`, les décomptes `COUNT` et les vérifications d'unicité `CHECK_UNIQUE_FIELD`) disposent d'un délai d'expiration par défaut de 30 secondes.

Si le serveur ne répond pas dans cette fenêtre de 30 secondes, le client supprime automatiquement la requête en attente et rejette la promesse avec une `RebaseApiError` dont le code est `REQUEST_TIMEOUT`.

Les messages unidirectionnels qui n'attendent pas de réponse (comme `subscribe_collection`, `subscribe_one`, `unsubscribe`, `join_channel`, `leave_channel`, `broadcast`, `presence_track`, `presence_untrack`, `presence_state` et `channel_history`) sont résolus immédiatement lors de la transmission et ne déclenchent pas ce délai d'expiration. Un abonnement dont la première trame n'est pas arrivée 30 secondes après l'envoi de son abonnement échoue en revanche avec `SUBSCRIPTION_TIMEOUT` sur son `onError`.

### Quand une trame de canal est refusée

Une trame de canal fonctionne selon le principe du « fire-and-forget » (tirer et oublier) : `await channel.broadcast(...)` est résolu dès que la trame est écrite sur le socket, et **non** lorsque le serveur l'a acceptée. Ceci est délibéré — une application collaborative diffuse la position d'un curseur soixante fois par seconde, et attendre un accusé de réception pour chacune transformerait chaque envoi en un aller-retour réseau complet.

Par conséquent, un refus ne peut pas prendre la forme d'une promesse rejetée. Il arrive sur `onError` :

```typescript
const channel = client.realtime.channel("doc:42");

channel.onError((error) => {
    if (error.code === "CHANNEL_FORBIDDEN") showReadOnlyBanner();
    if (error.code === "RATE_LIMITED") throttleCursorUpdates();
});
```

| Code | Signification |
|------|---------------|
| `CHANNEL_FORBIDDEN` | Vous n'êtes pas membre du canal — rejoignez-le avant de diffuser ou de lire son historique |
| `RATE_LIMITED` | Dépassement du quota de trames de canal (7 200 trames de canal par minute et par socket) ou, pour une requête d'historique, dépassement de la [limite de débit des données](#coût-dune-écriture-et-limites) |
| `CHANNEL_HISTORY_WRITE_FAILED` | Une diffusion conservée n'a pas pu être persistée, elle a donc été abandonnée |
| `CHANNEL_HISTORY_READ_FAILED` | Une requête de rattrapage n'a pas pu être servie |
| `CHANNEL_HISTORY_GAP` | Déclenché par le client : un rattrapage a constaté que le serveur ne conserve plus des messages que ce client n'a jamais reçus. `details` contient `{ from, to }`, les numéros de séquence manqués. Resynchronisez l'état du canal depuis sa source de vérité |
| `CHANNEL_BUS_PAYLOAD_TOO_LARGE` | La diffusion n'a atteint que cette instance — voir [La limite de 8 Ko sur le bus Postgres](/docs/backend/realtime-transports/#the-8-kb-limit-on-the-postgres-bus) |

Si aucun gestionnaire n'est attaché, ces erreurs sont consignées sous forme d'avertissement. Auparavant, elles étaient totalement ignorées : il n'y avait aucune promesse à rejeter et aucun canal auquel les transmettre, de sorte qu'une diffusion interdite ne pouvait pas être distinguée d'une diffusion réussie.

## Prochaines étapes

- [SDK typé](/docs/sdk) — Référence complète du SDK, y compris les accesseurs de table typés.
- [Authentification](/docs/backend/authentication) — Configurer l'authentification JWT et les politiques RLS.
- [Architecture Backend](/docs/backend) — Présentation de l'architecture du serveur Rebase.
