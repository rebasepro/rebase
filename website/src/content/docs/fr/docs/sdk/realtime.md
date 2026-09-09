---
sourceHash: f49369700dcdc098
title: Abonnements en temps réel
sidebar_label: Temps réel
description: Abonnez-vous aux modifications de données en direct avec le SDK Rebase Client à l'aide d'écouteurs en temps réel basés sur WebSocket.
---

## Vue d'ensemble

Le SDK Rebase Client fournit des abonnements aux données en temps réel via WebSocket. Lorsque des enregistrements changent sur le serveur, vos rappels (callbacks) abonnés se déclenchent immédiatement avec les données mises à jour.

La connexion WebSocket est établie automatiquement lorsqu'une `websocketUrl` est disponible (dérivée de `baseUrl` par défaut). La reconnexion et le rafraîchissement des jetons sont gérés de manière transparente.

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

`FindResult<M>` a la même structure que le retour de `find()` : des lignes plates dans `data`, et
`{ total, limit, offset, hasMore, nextCursor }` dans `meta`.

### `listen()` accepte ce que `find()` accepte

`params` est un `FindParams` complet. Un abonnement est la même requête que le
`find()` correspondant, il accepte donc les mêmes critères de restriction — `where`, `logical`,
`orderBy`, `limit`, `offset`/`page`, `searchString`, **`include`** et
**`fields`** :

```typescript
client.data.posts.listen(
    { where: { status: ["==", "published"] }, include: ["author"], limit: 20 },
    (result) => render(result.data)   // each row carries its author
);
```

Cela a plus d'importance qu'il n'y paraît. Auparavant, `include` et `fields` étaient silencieusement
ignorés ici, de sorte que la même requête renvoyait un format via `find()` et
un autre via `listen()` — et un composant effectuant le rendu des deux voyait la structure de ses lignes changer
dès qu'une écriture survenait. Ils passent désormais par le même pipeline de lecture, de sorte que `find({ q })` et `listen({ q })` renvoient des lignes identiques, champ par champ.

L'exception est `vectorSearch`, qui est **refusé** plutôt qu'ignoré : un
abonnement est réexécuté à chaque écriture correspondante et rien n'y calcule
de distances. Utilisez `.vectorSearch(…).find()` pour la requête et abonnez-vous sans ce paramètre.

### Une émission par modification

Chaque push du serveur appelle votre callback **une seule fois**, avec des métadonnées décrivant
les lignes associées. Il n'y a pas d'émission séparée au premier affichage et aucun drapeau à vérifier.

Les métadonnées arrivent **dans la même trame que les lignes** : le serveur effectue le comptage de la
requête au sein de la même transaction soumise à la sécurité au niveau des lignes (row-level security) qui les a lues, de sorte que
`meta.total`, `meta.hasMore` et `meta.nextCursor` décrivent exactement les lignes
qui les accompagnent. (Auparavant, chaque push était suivi d'un `GET /count` de la part du client
— un aller-retour supplémentaire par écriture et par abonné, créant un intervalle durant lequel le
total et les lignes décrivaient des états différents de la collection.)

Deux solutions de repli, qui ne constituent ni des erreurs d'abonnement ni des appels à
`onError` :

- Si le **comptage du serveur a échoué**, la trame ne contient aucun total et le dernier reçu
  est réutilisé. Un échec de comptage ne dit rien sur la taille de la
  collection, il ne doit donc pas écraser une réponse valide.
- Si aucun total n'a jamais été reçu pour cet abonnement — cas d'un serveur plus ancien qui
  n'envoie aucune métadonnée — le client en fait la demande une fois, lors du premier push. Si cela
  échoue également, `meta.total` est une **limite inférieure** : les lignes de cette page plus
  celles parcourues pour les atteindre.

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

Utilisez `listenById()` pour surveiller un enregistrement spécifique grâce à son identifiant :

```typescript
// The SDK hands back a flat row, not an `Entity` — there is no `.values`.
const unsubscribe = client.data
    .collection<{ id: number; name: string }>("products")
    .listenById(
    42,
    (product) => {
        if (product) {
            console.log("Product changed:", product.name);
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

```typescript no-verify
listenById(
    id: string | number,
    onUpdate: (row: M | undefined) => void,
    onError?: (error: Error) => void
): () => void   // returns unsubscribe function
```

Le callback reçoit une ligne plate — pas une `Entity`, il n'y a donc pas de `.values` —
et `undefined` lorsque l'enregistrement est supprimé.

## Générateur de requêtes fluide (Fluent Query Builder)

Vous pouvez également vous abonner via le générateur de requêtes fluide. Cela équivaut à appeler `listen()` avec des paramètres, mais vous permet d'enchaîner `.where()`, `.orderBy()`, etc. :

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

Un abonnement accepte un tri multi-colonnes comme toute autre requête — soit
`orderBy: [["category", "asc"], ["createdAt", "desc"]]` dans les paramètres, soit un
second appel à `.orderBy()`, qui ajoute un critère de départage plutôt que de remplacer le
premier. Voir [Tri](/docs/sdk/querying#sorting).

Le serveur vérifie la *forme* du `orderBy` d'un abonnement dès sa réception et
refuse toute formulation incorrecte avec une trame d'erreur plutôt que d'activer l'abonnement. Un tri qu'il
ne pourrait pas interpréter diffuserait des lignes sans aucun ordre tout en ne signalant
aucune erreur — et une trame `collection_update` ne transporte que des lignes et rien d'autre,
l'abonné n'aurait donc aucun moyen de s'en apercevoir.

## Se désabonner

Chaque abonnement renvoie une fonction `unsubscribe`. Appelez-la pour cesser de recevoir des mises à jour et libérer l'écouteur WebSocket :

```typescript
const unsubscribe = client.data.products.listen(
    undefined,
    (response) => { /* ... */ }
);

// Later, when the component unmounts or you no longer need updates:
unsubscribe();
```

Dans React, utilisez le nettoyage de `useEffect` :

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

- Lors de la **connexion** ou du **rafraîchissement de jeton**, le nouveau jeton est envoyé à un socket déjà ouvert via un message `authenticate`. Si aucun socket n'est ouvert, rien ne se passe — se connecter n'est pas une demande d'activation du temps réel, et un socket ouvert ultérieurement s'authentifie de lui-même.
- Lors de la **déconnexion**, la connexion WebSocket est coupée. Le client reste utilisable ; un abonnement ultérieur se reconnectera de façon anonyme.
- Si la connexion est perdue, le client **se reconnecte automatiquement** et rétablit tous les abonnements actifs.

Aucune gestion manuelle des jetons n'est nécessaire — l'intégration entre `client.auth` et la couche WebSocket est gérée en interne.

### La connexion est paresseuse (lazy)

La création d'un client n'ouvre **aucun** WebSocket. Il n'est initialisé qu'à la première opération qui en a réellement besoin — un abonnement `listen()` / `listenById()`, ou une opération de canal comme `join()`, `track()` ou `broadcast()`. Obtenir une instance de canal ne signifie pas l'utiliser.

```typescript
const client = createRebaseClient({ baseUrl });   // no socket
const channel = client.realtime.channel("doc:1"); // still no socket
await channel.join();                             // socket opens here
```

Ceci est important pour les applications avec un trafic déconnecté significatif — pages marketing, vues publiques en lecture seule, outils axés sur l'anonymat — qui payaient auparavant le coût d'une connexion à chaque chargement de page simplement pour rendre le temps réel disponible.

Deux comportements associés :

- `realtime: false` reste une désactivation explicite : aucun socket ne sera jamais ouvert, et `client.realtime.channel()` lèvera une erreur. Il en va de même pour `listen()` et `listenById()` — ils sont toujours accessibles à l'appel, et sur un client sans socket, ils lèvent une exception `RebaseClientError` indiquant l'option qui permettrait de les activer. `observe()` ne le fait pas : il se dégrade en une simple requête de récupération (fetch).
- `client.close()` est définitif. Il libère le socket et son minuteur de reconnexion, et rien de mis en file d'attente par la suite ne relancera la connexion. Dans Node, un socket ouvert maintient la boucle d'événements active ; ainsi, un script qui ne l'appelle jamais ne se terminera pas de lui-même.

## Canaux de diffusion (Broadcast Channels)

Les canaux de diffusion vous permettent d'envoyer des messages arbitraires entre les clients connectés — idéal pour le chat, les notifications ou les fonctionnalités collaboratives :

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

Les canaux sont légers et éphémères — ils existent tant qu'au moins un client y est abonné. Des appels répétés à `channel()` avec le même nom renvoient le **même** objet, ce qui permet à deux composants d'attacher des gestionnaires indépendamment sans que l'un ne déconnecte l'autre en quittant.

Les trames de canal et de présence ne nécessitent pas de compte : les visiteurs anonymes peuvent rejoindre des canaux publics.

:::caution[Les canaux n'ont pas encore de règles d'accès]
La seule vérification appliquée par le serveur est **l'appartenance** : pour diffuser dans un canal, lire sa liste de présence ou rejouer son historique, un client doit d'abord avoir rejoint ce canal. L'adhésion en elle-même est ouverte — tout client capable de nommer un canal peut le rejoindre, qu'il soit connecté ou non.

Le nom d'un canal n'est donc ni un secret, ni une permission. Ne placez rien dans un canal (y compris l'historique conservé et l'état de présence) que tous les utilisateurs de votre application ne devraient pas voir, et ne dérivez pas le nom d'un canal à partir de données que vous ne divulgueriez pas. Les règles d'autorisation par canal ne sont pas encore implémentées ; si vous en avez besoin dès aujourd'hui, conservez la partie sensible des échanges sur `client.data`, où s'applique la sécurité au niveau des lignes.
:::

> **Par défaut, les diffusions ne sont pas rejouées.** Elles n'atteignent que les membres actuellement connectés. C'est ce que l'on souhaite pour des notifications qui s'auto-corrigent — un signal « quelqu'un a enregistré » est remplacé par le prochain enregistrement — et cela ne coûte rien. Pour un flux d'opérations, où une interruption silencieuse provoque des divergences, activez [l'historique des messages](#message-history-and-catch-up) sur le canal.

## Historique des messages et rattrapage

Un canal peut être configuré pour conserver ses diffusions, de sorte qu'un client qui se reconnecte puisse rattraper ce qu'il a manqué au lieu de tout resynchroniser depuis le début. C'est ce qui rend les canaux exploitables comme moyen de transport pour l'édition collaborative.

La rétention est configurée **sur le serveur**, selon le modèle de canal — voir [Backend temps réel](/docs/backend/realtime#channel-retention). Un client ne peut pas l'activer de son propre chef, car un canal est créé par quiconque le nomme, et une profondeur d'historique choisie par le client permettrait à n'importe quel visiteur d'imposer un stockage illimité à votre backend.

Sur un canal avec rétention, passez `{ history: true }` et le SDK s'occupe du reste :

```typescript
const channel = client.realtime.channel("doc:42", { history: true });

// Handlers receive replayed messages exactly like live ones, in order.
channel.onBroadcast("op", (payload) => {
    applyOperation(payload);
});

await channel.join();
```

Lors du `join()` et après chaque reconnexion, le SDK demande au serveur tout ce qui s'est produit après le dernier numéro de séquence observé, et transmet le résultat via les mêmes gestionnaires. Il n'y a pas de second chemin de code à écrire : un gestionnaire qui applique correctement une opération en direct l'applique tout aussi correctement lors d'un rattrapage.

### Numéros de séquence

Chaque diffusion sur un canal avec rétention comporte un `seq` — propre au canal, sans interruption et incrémentiel. C'est le point de reprise du client.

```typescript
channel.onBroadcast((event) => {
    console.log(event.seq);       // 1, 2, 3, …
    console.log(event.replayed);  // true when delivered by catch-up
});

console.log(channel.sequence); // highest seq delivered so far
```

Persistez `channel.sequence` si vous souhaitez que le rattrapage survive à un rechargement de page en plus d'une reconnexion, et transmettez-le via `history({ sinceSeq })`.

### Récupération explicite de l'historique

```typescript
const { messages, retained, latestSeq } = await channel.history({
    sinceSeq: 0,
    limit: 100
});
```

`retained: false` signifie que le canal ne conserve aucun historique et n'en conservera jamais — une réponse explicite, afin que vous puissiez distinguer « vous n'avez rien manqué » de « ce canal n'a pas de règle de rétention ». Dans le second cas, un client qui doit converger doit se replier sur une resynchronisation complète.

`latestSeq` est la séquence la plus élevée que détient le serveur, que ce lot l'ait atteinte ou non. Si elle dépasse largement votre dernier `seq` reçu, votre retard est supérieur à une seule page et une resynchronisation complète pourrait être plus économique qu'une pagination.

:::note[Les rediffusions peuvent se chevaucher, et cela ne pose aucun problème]
Le serveur ne peut pas savoir précisément quels messages vous sont parvenus avant la coupure du socket ; ainsi, une plage de rattrapage peut inclure des éléments que vous avez déjà appliqués. Le SDK rejette tout message dont la séquence est inférieure ou égale à celle déjà traitée, garantissant que les gestionnaires ne voient jamais un message deux fois.

Vos propres messages ne sont **pas** filtrés d'une rediffusion : une reconnexion attribue un nouvel identifiant client, ce qui correspond précisément au scénario pour lequel le rattrapage existe et où ce filtre échouerait. Rendez vos opérations idempotentes si le fait de réappliquer vos propres messages pose problème.
:::

## Suivi de présence

La présence vous permet de savoir quels utilisateurs sont en ligne et de synchroniser un état partagé entre tous les participants :

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

Le SDK maintient la liste des membres pour vous, de sorte que `presences` est toujours complet et que vous n'avez jamais besoin de le reconstituer à partir des deltas.

Il gère également deux détails de protocole faciles à négliger lors d'une utilisation directe de WebSocket brut :

- **La liste n'est pas envoyée automatiquement lors du join.** Le premier `presence_diff` reçu par un client qui rejoint ne contient que lui-même ; la liste existante doit être demandée explicitement. `join()` s'en charge pour vous.
- **La présence expire au bout de 30 secondes.** `track()` n'est pas un enregistrement persistant — sans renvoi périodique, vous disparaissez silencieusement de la liste des autres participants tout en étant toujours connecté et présent sur la page. Le SDK émet un battement de cœur (heartbeat) toutes les 20 secondes, et s'arrête lors d'un appel à `untrack()` ou `leave()`.

Une reconnexion réinitialise également l'appartenance au canal et la présence côté serveur ; le SDK rejoint à nouveau le canal, redemande la liste et republie la présence automatiquement.

## Quand utiliser le temps réel

| Cas d'utilisation | Méthode |
|-------------------|---------|
| Tableau de bord avec données en direct | `listen()` avec filtres |
| Chat ou messagerie | `channel.broadcast()` |
| Édition collaborative / flux d'opérations | `channel(name, { history: true })` |
| Indicateurs de saisie / statut en ligne | `channel.track()` + `channel.onPresence()` |
| Page de détails avec mises à jour en direct | `listenById()` |
| Surveillance de panneau d'administration | `listen()` avec `orderBy` et `limit` |
| Une liste qui doit survivre à une perte de connexion | `observe()` avec le mode [hors ligne](/docs/sdk/offline) activé |

> **Astuce :** Pour les récupérations de données ponctuelles, utilisez plutôt `find()` ou `findById()`. Les abonnements conviennent mieux aux données qui changent fréquemment et doivent être reflétées immédiatement dans l'interface utilisateur.

## `listen()` vs `observe()`

Les deux maintiennent une requête à jour et renvoient chacun une fonction de désabonnement — mais ils répondent à des besoins différents.

`listen()` est lié au socket : il transmet ce que le serveur envoie par push, et ne transmet rien lorsque le socket est inactif.

`observe()` est lié à la requête : avec le mode [hors ligne](/docs/sdk/offline) activé, il émet d'abord à partir de la base de données locale — avant toute requête réseau — et émet à nouveau lors d'écritures locales, lorsque des écritures en attente atteignent le serveur, lors de rollbacks et lors d'événements en temps réel, auxquels il s'abonne lui-même à moins que vous ne passiez `{ realtime: false }`. Chaque résultat indique s'il provient du cache et s'il comporte des écritures que le serveur n'a pas encore acceptées.

```typescript
const unsubscribe = client.data.products.observe(
    { where: { active: ["==", true] } },
    (result) => {
        render(result.data);
        setSaving(result.hasPendingWrites);
    }
);
```

Sans le mode hors ligne activé, `observe()` correspond à `find()` combiné à `listen()` en un seul appel, avec ces indicateurs toujours à `false`.

## Prochaines étapes

- **[Interroger des données](/docs/sdk/querying)** — Opérations CRUD et générateur de requêtes
- **[Synchronisation hors ligne & Local-First](/docs/sdk/offline)** — Requêtes en direct qui survivent à une interruption de connexion
- **[Authentification](/docs/sdk/authentication)** — Connexion et gestion des sessions
- **[Backend temps réel](/docs/backend/realtime)** — Configuration WebSocket côté serveur

---
