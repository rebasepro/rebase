---
sourceHash: a82dd911da9d58ef
title: Abonnements en temps réel
sidebar_label: Temps réel
description: Abonnez-vous aux changements de données en direct avec le SDK Client de Rebase à l'aide d'écouteurs temps réel basés sur WebSocket.
---

## Vue d'ensemble

Le SDK Client de Rebase fournit des abonnements de données en temps réel via WebSocket. Lorsque les enregistrements changent sur le serveur, vos callbacks abonnés se déclenchent immédiatement avec les données mises à jour.

La connexion WebSocket est établie automatiquement dès qu'une `websocketUrl` est disponible (dérivée de `baseUrl` par défaut). La reconnexion et le rafraîchissement des tokens sont gérés de manière transparente.

## S'abonner à une collection

Utilisez `listen()` pour vous abonner à une requête de collection. Le callback se déclenche chaque fois que l'ensemble de données correspondant change :

```typescript
const unsubscribe = client.data.products.listen(
    { where: { active: ["==", true] }, limit: 50 },
    (response) => {
        console.log("Products updated:", response.data);
        console.log("Total:", response.meta.total);
    }
);

// Stop listening when done
unsubscribe();
```

La méthode `listen()` accepte les mêmes `FindParams` que `find()` — vous pouvez filtrer, trier et paginer votre abonnement :

```typescript
const unsubscribe = client.data.orders.listen(
    {
        where: { status: ["==", "pending"] },
        orderBy: ["createdAt", "desc"],
        limit: 20
    },
    (response) => {
        renderOrders(response.data);
    },
    (error) => {
        console.error("Subscription error:", error);
    }
);
```

### Signature

```typescript no-verify
listen(
    params: FindParams<M> | undefined,
    onUpdate: (result: FindResult<M>) => void,
    onError?: (error: Error) => void
): () => void   // returns unsubscribe function
```

`FindResult<M>` est la forme que renvoie `find()` : des lignes plates dans `data` et
`{ total, limit, offset, hasMore }` dans `meta`.

### Une émission par changement

Chaque envoi du serveur appelle votre callback **une fois**, avec des métadonnées qui
décrivent les lignes qui l'accompagnent. Il n'y a pas de première émission distincte ni
d'indicateur à vérifier :

- Un `count()` est exécuté pour la requête avant l'émission, donc `meta.total` et
  `meta.hasMore` font autorité.
- Si un envoi arrive pendant que ce comptage est en cours, l'émission plus ancienne est
  abandonnée — vous n'êtes jamais rappelé avec un total appartenant à une page
  précédente.
- Si le comptage **échoue**, le dernier total réellement renvoyé par un comptage est
  réutilisé. Un comptage en échec ne dit rien de la taille de la collection : il ne doit
  donc pas écraser une vraie réponse. Ce n'est pas une erreur d'abonnement, et `onError`
  n'est pas appelé.
- Si aucun comptage n'a jamais abouti pour cet abonnement, `meta.total` est une **borne
  inférieure** — les lignes de cette page plus celles sautées pour y arriver — et
  `meta.hasMore` vaut `true` quand la page est revenue pleine.

```typescript
client.data.products.listen(
    { where: { active: ["==", true] }, limit: 50 },
    (result) => {
        renderProducts(result.data);
        renderPager({ total: result.meta.total, hasMore: result.meta.hasMore });
    }
);
```

## S'abonner à une seule entité

Utilisez `listenById()` pour surveiller un enregistrement spécifique par son ID :

```typescript
const unsubscribe = client.data.products.listenById(
    42,
    (entity) => {
        if (entity) {
            console.log("Product changed:", entity.values.name);
        } else {
            console.log("Product was deleted");
        }
    },
    (error) => {
        console.error("Subscription error:", error);
    }
);
```

### Signature

```typescript
listenById(
    id: string | number,
    onUpdate: (row: M | undefined) => void,
    onError?: (error: Error) => void
): () => void   // returns unsubscribe function
```

Le callback reçoit une ligne plate — pas une `Entity`, donc pas de `.values` — et
`undefined` lorsque l'enregistrement est supprimé.

## Constructeur de requêtes fluide

Vous pouvez également vous abonner via le constructeur de requêtes fluide. C'est équivalent à appeler `listen()` avec des paramètres, mais cela permet d'enchaîner `.where()`, `.orderBy()`, etc. :

```typescript
const unsubscribe = client.data.products
    .where("active", "==", true)
    .orderBy("createdAt", "desc")
    .limit(20)
    .listen(
        (response) => console.log("Updated:", response.data),
        (error) => console.error("Error:", error)
    );
```

## Se désabonner

Chaque abonnement renvoie une fonction `unsubscribe`. Appelez-la pour cesser de recevoir des mises à jour et nettoyer l'écouteur WebSocket :

```typescript
const unsubscribe = client.data.products.listen(
    undefined,
    (response) => { /* ... */ }
);

// Later, when the component unmounts or you no longer need updates:
unsubscribe();
```

En React, utilisez le nettoyage de `useEffect` :

```tsx
useEffect(() => {
    const unsubscribe = client.data.products.listen(
        { where: { active: ["==", true] } },
        (response) => setProducts(response.data)
    );
    return () => unsubscribe();
}, []);
```

## Authentification et reconnexion

Le client WebSocket gère l'authentification automatiquement :

- Lors de la **connexion** ou du **rafraîchissement du token**, le nouveau token est envoyé au serveur WebSocket via un message `authenticate`.
- Lors de la **déconnexion**, la connexion WebSocket est fermée.
- Si la connexion tombe, le client **se reconnecte automatiquement** et rétablit tous les abonnements actifs.

Aucune gestion manuelle des tokens n'est nécessaire — l'intégration entre `client.auth` et la couche WebSocket est gérée en interne.

## Canaux de diffusion (Broadcast)

Les canaux de diffusion vous permettent d'envoyer des messages arbitraires entre clients connectés — idéal pour le chat, les notifications ou les fonctionnalités collaboratives :

```typescript
// Obtain a channel. This alone opens no connection.
const channel = client.realtime.channel("chat-room");

// Listen for broadcasts. Pass an event name to filter, or omit it for all.
channel.onBroadcast("message", (payload) => {
    console.log("New message:", payload);
});

// Send to every other member — the sender never receives its own message.
await channel.broadcast("message", {
    text: "Hello, world!",
    userId: currentUser.id
});

// Leave, releasing handlers and timers.
await channel.leave();
```

Les canaux sont légers et éphémères — ils existent tant qu'au moins un client est abonné.

> **Par défaut, les diffusions ne sont pas rejouées.** Elles n'atteignent que les membres connectés à cet instant. C'est ce qu'on veut pour des notifications qui se corrigent d'elles-mêmes — un signal « quelqu'un a enregistré » est supplanté par l'enregistrement suivant — et cela ne coûte rien. Pour un flux d'opérations, où un trou silencieux provoque une divergence, activez l'[historique des messages](#historique-des-messages-et-rattrapage) sur le canal.

## Historique des messages et rattrapage

Un canal peut être configuré pour conserver ses diffusions, afin qu'un client qui se reconnecte rattrape ce qu'il a manqué au lieu de se resynchroniser depuis zéro. C'est ce qui rend les canaux utilisables comme transport pour l'édition collaborative.

La conservation se configure **côté serveur**, par motif de canal — voir [Backend temps réel](/fr/docs/backend/realtime#conservation-des-canaux). Un client ne peut pas l'activer lui-même : un canal est créé par celui qui le nomme, et une profondeur d'historique choisie par le client permettrait à n'importe quel visiteur d'engager votre backend sur un stockage illimité.

Sur un canal avec conservation, passez `{ history: true }` et le SDK fait le reste :

```typescript
const channel = client.realtime.channel("doc:42", { history: true });

// Handlers receive replayed messages exactly like live ones, in order.
channel.onBroadcast("op", (payload) => {
    applyOperation(payload);
});

await channel.join();
```

Au `join()` et après chaque reconnexion, le SDK demande au serveur tout ce qui suit le dernier numéro de séquence qu'il a vu, et livre le résultat via les mêmes gestionnaires. Il n'y a pas de second chemin de code à écrire : un gestionnaire qui applique correctement une opération en direct l'applique correctement au rattrapage.

### Numéros de séquence

Chaque diffusion sur un canal avec conservation porte un `seq` — par canal, sans trou et croissant. C'est le point de reprise du client.

```typescript
channel.onBroadcast((event) => {
    console.log(event.seq);       // 1, 2, 3, …
    console.log(event.replayed);  // true when delivered by catch-up
});

console.log(channel.sequence); // highest seq delivered so far
```

Conservez `channel.sequence` si vous voulez que le rattrapage survive aussi à un rechargement de page, et renvoyez-le via `history({ sinceSeq })`.

### Récupérer l'historique explicitement

```typescript
const { messages, retained, latestSeq } = await channel.history({
    sinceSeq: 0,
    limit: 100
});
```

`retained: false` signifie que le canal ne conserve aucun historique et n'en conservera jamais — une réponse explicite, pour que vous puissiez distinguer « vous n'avez rien manqué » de « ce canal n'a pas de règle de conservation ». Dans le second cas, un client qui doit converger doit se rabattre sur une resynchronisation complète.

`latestSeq` est la séquence la plus élevée que détient le serveur, que ce lot l'ait atteinte ou non. Si elle dépasse largement votre dernier `seq` livré, vous avez plus d'une page de retard et une resynchronisation peut coûter moins cher qu'une pagination.

:::note[Les rejeux peuvent se chevaucher, et c'est normal]
Le serveur ne peut pas savoir exactement quels messages vous sont parvenus avant la coupure, donc une plage de rattrapage peut en inclure que vous avez déjà appliqués. Le SDK écarte tout ce qui est à ou en dessous de la séquence déjà livrée, de sorte que les gestionnaires ne voient jamais deux fois le même message.

Vos propres messages ne sont **pas** filtrés d'un rejeu : une reconnexion attribue un nouvel identifiant client, donc le cas même pour lequel le rattrapage existe est celui où ce filtre échouerait. Rendez les opérations idempotentes si réappliquer les vôtres posait problème.
:::
## Suivi de présence

La présence vous permet de suivre quels utilisateurs sont en ligne et de synchroniser un état partagé entre tous les participants :

```typescript
const channel = client.realtime.channel("editors");

// Publish your presence. This is also what opens the connection.
await channel.track({
    userId: currentUser.id,
    status: "editing",
    cursor: { x: 100, y: 200 }
});

// One handler for every change. `presences` is always the full roster;
// `diff` is what changed, when you only care about the delta.
channel.onPresence((presences, diff) => {
    console.log("Online users:", Object.keys(presences));
    if (diff) {
        console.log("joined:", Object.keys(diff.joins));
        console.log("left:", Object.keys(diff.leaves));
    }
});

// Calling track() again replaces your state — this is how you publish a
// moving cursor.
await channel.track({ userId: currentUser.id, status: "idle" });

// Stop publishing without leaving the channel.
await channel.untrack();
```

La présence est construite sur les canaux de diffusion avec un diff automatique de l'état — seuls les changements sont transmis.

## Quand utiliser le temps réel

| Cas d'usage | Méthode |
|----------|--------|
| Tableau de bord avec données en direct | `listen()` avec filtres |
| Chat ou messagerie | `channel.broadcast()` |
| Édition collaborative / flux d'opérations | `channel(name, { history: true })` |
| Indicateurs de frappe / statut en ligne | `channel.track()` + `channel.onPresence()` |
| Page de détail avec mises à jour en direct | `listenById()` |
| Surveillance du panneau d'administration | `listen()` avec `orderBy` et `limit` |

> **Astuce :** Pour des récupérations de données ponctuelles, utilisez plutôt `find()` ou `findById()`. Les abonnements sont préférables pour les données qui changent fréquemment et doivent être reflétées immédiatement dans l'interface.

## Étapes suivantes

- **[Interroger les données](/docs/sdk/querying)** — Opérations CRUD et constructeur de requêtes
- **[Authentification](/docs/sdk/authentication)** — Connexion et gestion des sessions
- **[Temps réel côté backend](/docs/backend/realtime)** — Configuration WebSocket côté serveur
