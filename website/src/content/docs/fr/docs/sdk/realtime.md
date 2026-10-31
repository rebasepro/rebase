---
sourceHash: b9f712f58936dac9
title: Abonnements en temps réel
sidebar_label: Temps réel
description: Abonnez-vous aux modifications de données en direct avec le SDK typé Rebase grâce à des écouteurs temps réel basés sur WebSocket.
---

## Aperçu

Le SDK typé Rebase fournit des abonnements aux données en temps réel via WebSocket. Lorsque des enregistrements changent sur le serveur, vos callbacks abonnés se déclenchent immédiatement avec les données mises à jour.

La connexion WebSocket est établie automatiquement lorsqu'une `websocketUrl` est disponible (dérivée de `baseUrl` par défaut). La reconnexion et le rafraîchissement des jetons sont gérés pour vous. Une interruption qui dure plus d'environ 15 secondes est signalée une seule fois, au gestionnaire `onError` de chaque abonnement, sous la forme `CONNECTION_LOST` — voir [Authentification et reconnexion](#authentification-et-reconnexion).

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

`FindResult<M>` a la même structure que le retour de `find()` : des lignes plates dans `data`, et `{ total, limit, offset, hasMore, nextCursor }` dans `meta`.

### `listen()` accepte ce que `find()` accepte

`params` est un objet `FindParams` complet. Un abonnement est la même requête que le `find()` correspondant, il accepte donc les mêmes restrictions — `where`, `logical`, `orderBy`, `limit`, `offset`/`page`, `searchString`, **`include`** et **`fields`** :

```typescript
client.data.posts.listen(
    { where: { status: ["==", "published"] }, include: ["author"], limit: 20 },
    (result) => render(result.data)   // each row carries its author
);
```

Cela a plus d'importance qu'il n'y paraît. Auparavant, `include` et `fields` étaient ignorés silencieusement ici, de sorte que la même requête répondait sous une forme via `find()` et sous une autre via `listen()` — et un composant effectuant le rendu des deux voyait ses lignes changer de forme dès qu'une écriture survenait. Ils passent désormais par le même pipeline de lecture, donc `find({ q })` et `listen({ q })` renvoient des lignes identiques, champ par champ.

L'exception est `vectorSearch`, qui est **refusé** plutôt qu'ignoré : un abonnement est réexécuté à chaque écriture correspondante et rien n'y calcule les distances. Utilisez `.vectorSearch(…).find()` pour la requête et abonnez-vous sans celui-ci.

### Une émission par modification

Chaque push du serveur appelle votre callback **une seule fois**, avec des métadonnées décrivant les lignes associées. Il n'y a pas d'émission distincte pour le premier affichage et aucun indicateur à vérifier.

Les métadonnées arrivent **dans la même trame que les lignes** : le serveur effectue le décompte de la requête dans la même transaction soumise à la sécurité au niveau des lignes (RLS) que celle qui les a lues, de sorte que `meta.total`, `meta.hasMore` et `meta.nextCursor` décrivent exactement les lignes qui les accompagnent. (Auparavant, chaque push était suivi d'un `GET /count` de la part du client — un aller-retour supplémentaire par écriture et par abonné, et une fenêtre de temps durant laquelle le décompte et les lignes décrivaient des états différents de la collection.)

Deux solutions de repli, qui ne constituent pas des erreurs d'abonnement et n'appellent aucune d'entre elles `onError` :

- Si le **décompte du serveur a échoué**, la trame ne contient aucun total et le dernier reçu est réutilisé. Un décompte ayant échoué ne donne aucune indication sur la taille de la collection, il ne doit donc pas écraser une réponse valide.
- Si aucun total n'a jamais été reçu pour cet abonnement — cas d'un serveur plus ancien qui n'envoie aucune métadonnée — le client le demande une seule fois, lors du premier push. Si cela échoue également, `meta.total` est une **borne inférieure** : les lignes de cette page plus celles des pages précédentes parcourues pour les atteindre.

```typescript
client.data.products.listen(
    { where: { active: ["==", true] }, limit: 50 },
    (result) => {
        renderProducts(result.data);
        renderPager({ total: result.meta.total, hasMore: result.meta.hasMore });
    }
);
```

## S'abonner à une entité unique

Utilisez `listenById()` pour surveiller un enregistrement spécifique par son identifiant :

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
    onError?: (error: Error) => void,
    options?: { include?: IncludeSpec }
): () => void   // returns unsubscribe function
```

Le callback reçoit une ligne plate — pas une `Entity`, il n'y a donc pas de `.values` — et `undefined` lorsque l'enregistrement est supprimé.

Chaque trame inclut les relations désignées par `options.include`, chargées de la même manière que `find({ include })` les charge dans chaque ligne d'une liste. Une relation « to-many » (un-à-plusieurs) qui n'y est pas nommée est absente de la ligne, et non vide :

```typescript
client.data.posts.listenById(1, (post) => {
    console.log(post?.tags); // the post's tags, on every update
}, undefined, { include: ["tags"] });
```

**Limites.** Une trame est envoyée lorsque la ligne elle-même change, et chaque trame recharge ses relations incluses. Une modification apportée uniquement à une ligne liée n'envoie aucune trame : modifier le nom d'un tag n'actualise pas un article écouté avec `include: ["tags"]` tant que l'article ne change pas lui aussi. Pour suivre les lignes associées, écoutez également leur collection.

## Surveiller un décompte

`listenCount()` maintient un décompte à jour : le total correspondant au filtre d'une liste, pour une barre d'outils ou une option « sélectionner les N éléments » qui ne doit pas devenir obsolète pendant que d'autres personnes ajoutent ou suppriment des lignes. Le callback s'exécute avec le total dès qu'il est connu, puis à nouveau chaque fois qu'une écriture le modifie.

```typescript
const stop = client.data.orders.listenCount(
    { where: { status: ["==", "open"] } },
    (total) => console.log(`${total} open orders`),
    (error) => console.error(error)
);
```

Seul le filtre est pris en compte — `where`, `logical` et `searchString` ; `limit`, `offset` ou un tri sont ignorés. Le serveur ne lit aucune ligne à cet effet, seulement le décompte, sous l'identité de l'abonné comme pour toute autre trame. Un serveur antérieur à la version 0.25 ne reconnaît pas la requête ; il répond avec une seule ligne et le même total, et le SDK lit le total à partir de celle-ci. Sur un client sans socket, `listenCount()` est un bouchon qui lève une erreur, tout comme `listen()`. Avec le [support hors ligne](/docs/sdk/offline/) activé, le décompte est celui du serveur : les écritures en attente n'y figurent pas tant qu'elles n'ont pas été rejouées.

## Query Builder fluide

Vous pouvez également vous abonner via le query builder fluide. Cela équivaut à appeler `listen()` avec des paramètres, mais vous permet de chaîner `.where()`, `.orderBy()`, etc. :

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

Un abonnement accepte un tri sur plusieurs colonnes comme toute autre requête — soit via `orderBy: [["category", "asc"], ["createdAt", "desc"]]` dans les paramètres, soit via un deuxième appel à `.orderBy()`, qui ajoute un critère de départage au lieu de remplacer le premier. Voir [Tri](/docs/sdk/querying#sorting).

Le serveur vérifie la *structure* du `orderBy` d'un abonnement dès sa réception et refuse un tri mal formé avec une trame d'erreur plutôt que de valider l'abonnement. Dans le cas contraire, un tri qu'il ne pourrait pas lire diffuserait les lignes dans le désordre le plus total sans signaler d'anomalie — et une trame `collection_update` ne transporte que des lignes et rien d'autre, de sorte qu'un abonné n'aurait aucun moyen de s'en apercevoir.

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

Dans React, utilisez la fonction de nettoyage de `useEffect` :

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

- Lors de la **connexion** ou du **rafraîchissement de jeton**, un socket déjà ouvert prend en compte le nouveau jeton d'authentification. Un rafraîchissement, ou une connexion avec le compte déjà détenu, envoie le jeton dans un message `authenticate` ; une connexion sous un compte différent — y compris un visiteur qui se connecte — reconstruit le socket, qui s'authentifie sous ce compte et renvoie chaque abonnement et canal actif. Si aucun socket n'est ouvert, rien ne se passe — se connecter n'est pas une demande de temps réel, et un socket ouvert ultérieurement s'authentifiera de lui-même.
- Lors de la **déconnexion**, la connexion WebSocket est coupée. Le client reste utilisable ; un abonnement ultérieur se reconnectera de manière anonyme.
- Si la connexion est interrompue, le client **se reconnecte automatiquement** et rétablit tous les abonnements actifs. Il n'abandonne jamais tant qu'il existe un abonnement ou un canal rejoint ; le délai entre les tentatives augmente jusqu'à un maximum de 30 secondes.
- Si le serveur met fin à la session du socket — l'utilisateur s'est déconnecté partout, cette session a été révoquée, le compte a été supprimé ou le jeton a expiré avant qu'un rafraîchissement n'atteigne le socket — il ferme le socket avec le code `4001`. Le client se reconnecte comme après toute coupure, en s'authentifiant avec la session qu'il détient alors (rafraîchie si possible), ou de manière anonyme s'il n'en a aucune. La révocation d'un rôle ne ferme pas le socket : elle s'applique dès la trame suivante. Voir [Authentification & RLS](/docs/backend/realtime/#authentication--rls).
- Si la connexion reste interrompue pendant plus d'environ 15 secondes, le gestionnaire `onError` de chaque abonnement (et le `onError` de chaque canal rejoint) est appelé **une seule fois** avec une `RebaseApiError` dont le `code` est `CONNECTION_LOST`. L'abonnement n'est pas interrompu : continuez d'afficher ce que vous avez, marquez-le comme potentiellement obsolète, et attendez. Dès que le socket est de retour, le prochain `onUpdate` de l'abonnement transmet tout ce qui a été écrit entre-temps.
- `client.ws.state` représente l'état de la connexion — `idle`, `connecting`, `connected`, `reconnecting`, `disconnected` ou `closed` — et `client.ws.onStateChange(listener)` est notifié de chaque changement. `disconnected` est l'état dans lequel `CONNECTION_LOST` a été signalé.
- Les requêtes envoyées via le socket sont au format **at-most-once** (au plus une fois). Une requête envoyée au moment où la connexion a été coupée échoue avec `CONNECTION_LOST` et n'est jamais renvoyée, car le serveur a pu déjà l'exécuter. Une requête attendant toujours un socket au bout de 30 secondes échoue avec `REQUEST_TIMEOUT` sans avoir été envoyée.

Tous les éléments de cette liste situés après la déconnexion ont été introduits dans la version 0.24. Sur la version 0.23, le client abandonne après cinq tentatives de reconnexion infructueuses, met en file d'attente les requêtes effectuées pendant la déconnexion et les envoie lors de la reconnexion, ne possède pas de `client.ws.state`, et le serveur ne ferme jamais un socket dont la session s'est terminée.

```typescript
import { RebaseApiError } from "@rebasepro/client";

const unsubscribe = client.data.orders.listen(
    { where: { status: ["==", "open"] } },
    (response) => {
        setOrders(response.data);
        setStale(false);
    },
    (error) => {
        if (error instanceof RebaseApiError && error.code === "CONNECTION_LOST") {
            setStale(true); // keep the rows; the next update clears it
            return;
        }
        setError(error);
    }
);
```

### Quel jeton le socket envoie-t-il ?

Sur la version 0.24, le socket utilise uniquement la propre session du client et l'option `token` : un getter configuré avec `client.setAuthTokenGetter()` ne l'atteint jamais, de sorte qu'un hôte utilisant son propre fournisseur d'authentification obtient un socket anonyme.

Le socket s'authentifie avec le même jeton que celui qu'une requête HTTP transporterait. Il s'agit en priorité du getter configuré avec `client.setAuthTokenGetter()` ; lorsqu'il n'y en a pas, ou qu'il renvoie `null` ou lève une exception, c'est le jeton détenu par le client : celui de sa session, un jeton défini avec `client.setToken()`, ou l'option `token`. Avec le module intégré `client.auth`, il n'y a rien à configurer.

Pour un fournisseur d'authentification externe (Clerk, Firebase Auth, ou votre propre gestion de session), définissez le getter une seule fois. Il couvre à la fois HTTP et le socket :

```typescript
client.setAuthTokenGetter(() => provider.getToken());

// Optional: let the provider recover a refused token, on HTTP and the socket alike.
client.setOnUnauthorized(async () => {
    await provider.refresh();
    return true; // retry with the token resolved again
});
```

- `client.setOnUnauthorized(handler)` réagit à un jeton refusé dans les deux cas : une erreur 401 sur HTTP et une erreur d'authentification sur le socket. Renvoyez `true` pour réessayer après avoir résolu le jeton à nouveau. Cela remplace le rafraîchissement de session propre au client.
- Définir un getter ou appeler `client.setToken()` reconstruit un socket ouvert : le nouveau socket s'authentifie avec le nouvel identifiant et renvoie chaque abonnement et canal actif sous cette identité, sans conserver quoi que ce soit de la précédente. Si aucun socket n'est ouvert, le prochain s'authentifiera de lui-même.
- `client.ws.setAuthTokenGetter()` est obsolète. Il fonctionne toujours, en remplaçant uniquement le getter du socket, et émet un avertissement une seule fois. Utilisez `client.setAuthTokenGetter()`.

Voir [Utiliser votre propre fournisseur d'authentification](/docs/sdk/authentication#using-your-own-auth-provider).

### La connexion est établie à la demande (lazy)

Créer un client n'ouvre **aucun** WebSocket. Il n'est composé qu'à la première opération qui en a réellement besoin — un abonnement `listen()` / `listenById()`, ou une opération de canal telle que `join()`, `track()` ou `broadcast()`. Obtenir un canal ne signifie pas l'utiliser.

```typescript
const client = createRebaseClient({ baseUrl });   // no socket
const channel = client.realtime.channel("doc:1"); // still no socket
await channel.join();                             // socket opens here
```

Ceci est important pour les applications recevant un trafic significatif d'utilisateurs non connectés — pages marketing, vues publiques en lecture seule, outils conçus d'abord pour les utilisateurs anonymes — qui payaient auparavant le coût d'une connexion à chaque chargement de page simplement pour rendre le temps réel disponible.

Deux comportements associés :

- `realtime: false` reste une désactivation stricte : aucun socket ne sera jamais créé, et `client.realtime.channel()` lève une exception. Il en va de même pour `listen()` et `listenById()` — ils peuvent toujours être appelés, et sur un client sans socket, ils lèvent une `RebaseClientError` indiquant l'option qui permettrait de les activer. Ce n'est pas le cas de `observe()` : elle se dégrade en une simple requête de récupération (fetch).
- `client.close()` est définitif. Il libère le socket et son minuteur de reconnexion, et rien de ce qui est mis en file d'attente par la suite ne relancera la connexion. Dans Node, un socket ouvert maintient la boucle d'événements active, de sorte qu'un script qui ne l'appelle jamais ne s'arrêtera pas de lui-même.

### Conserver un groupe sur une seule instance

Avec plusieurs instances de serveur, les membres d'un canal peuvent se retrouver sur des instances différentes, et chaque message entre eux [traverse alors le bus de canaux](/docs/backend/realtime-transports/#channels-and-presence-across-instances). `affinity` nomme le groupe auquel appartient un socket, comme un salon ou un document, afin qu'une plateforme puisse router l'ensemble du groupe vers la même instance :

```typescript
const client = createRebaseClient({
    baseUrl,
    realtime: { affinity: roomCode }
});
```

Lorsque la clé n'est connue que plus tard, définissez-la avant l'ouverture du socket :

```typescript
const client = createRebaseClient({ baseUrl });

client.realtime.setAffinity(roomCode);          // no socket yet
await client.realtime.channel(roomCode).join(); // opens with the key
```

La clé est ajoutée à l'adresse du socket sous la forme `?affinity=`, et elle remplace celle qui se trouverait déjà sur une `websocketUrl` configurée par vos soins. `setAffinity(null)` la supprime.

- **C'est une optimisation.** Rebase Cloud l'utilise pour le routage lorsqu'un projet exécute plusieurs instances. En auto-hébergement, ou derrière un proxy qui ne calcule pas de hachage dessus, cela n'a aucun effet et les canaux fonctionnent de la même manière : le bus transporte toujours tout ce qui traverse les instances, y compris un groupe divisé par une montée en charge.
- **Cela prend effet lors de la connexion du socket.** Un socket déjà ouvert reste là où il est et utilisera la nouvelle clé lors de sa prochaine connexion. Pour déplacer un client qui est connecté, créez-en un nouveau, ou définissez la clé avant son premier appel à `join()` ou `listen()`.
- **Cela détermine où le socket atterrit, pas ce qu'il a le droit de rejoindre.** L'accès à un canal n'en dépend pas, et l'adresse apparaît dans les journaux d'accès, utilisez donc un code plutôt qu'un secret ou une information personnelle.

Pour vérifier si cela fonctionne, comparez ce que chaque instance publie et ignore : voir [Observer le comportement du bus](/docs/backend/realtime-transports/#seeing-what-the-bus-does).

## Canaux de diffusion

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

Les canaux sont légers et éphémères — ils existent tant qu'au moins un client y est abonné. Des appels répétés à `channel()` avec le même nom renvoient le **même** objet, de sorte que deux composants peuvent attacher des gestionnaires indépendamment sans que l'un ne coupe l'autre en quittant le canal.

Les trames de canal et de présence ne nécessitent pas de compte : les visiteurs anonymes peuvent rejoindre des canaux publics.

:::caution[Les canaux n'ont pas encore de règles d'accès]
La seule vérification effectuée par le serveur concerne l'**appartenance** : pour diffuser sur un canal, lire sa liste de présence ou rejouer son historique, un client doit d'abord avoir rejoint ce canal. Rejoindre un canal est une action ouverte — tout client capable de nommer un canal peut le rejoindre, qu'il soit connecté ou non.

Par conséquent, le nom d'un canal n'est ni un secret ni une permission. Ne mettez rien dans un canal (y compris l'historique conservé et l'état de présence) que tous les utilisateurs de votre application ne devraient pas voir, et ne dérivez pas le nom d'un canal de données que vous ne divulgueriez pas. Les règles d'autorisation par canal ne sont pas encore implémentées ; si vous en avez besoin aujourd'hui, conservez la partie sensible des échanges sur `client.data`, où s'applique la sécurité au niveau des lignes (RLS).
:::

> **Par défaut, les diffusions ne sont pas rejouées.** Elles n'atteignent que les membres actuellement connectés. C'est le comportement souhaité pour des notifications auto-correctrices — une alerte « quelqu'un a enregistré » est remplacée par le prochain enregistrement — et cela ne coûte rien. Pour un flux d'opérations où une interruption silencieuse entraîne une divergence, activez l'[historique des messages](#historique-des-messages-et-rattrapage-catch-up) sur le canal.

## Historique des messages et rattrapage (Catch-Up)

Un canal peut être configuré pour conserver ses diffusions, de sorte qu'un client qui se reconnecte rattrape ce qu'il a manqué au lieu de devoir se resynchroniser depuis le début. C'est ce qui permet d'utiliser les canaux comme moyen de transport pour l'édition collaborative.

La rétention est configurée **sur le serveur**, par motif de canal — voir [Backend temps réel](/docs/backend/realtime#channel-retention). Un client ne peut pas l'activer de lui-même, car un canal est créé par quiconque le nomme, et une profondeur d'historique choisie par le client permettrait à n'importe quel visiteur d'imposer un stockage illimité à votre backend.

Sur un canal avec rétention, passez `{ history: true }` et le SDK s'occupe du reste :

```typescript
const channel = client.realtime.channel("doc:42", { history: true });

// Handlers receive replayed messages exactly like live ones, in order.
channel.onBroadcast("op", (payload) => {
    applyOperation(payload);
});

await channel.join();
```

Lors du `join()` et après chaque reconnexion, le SDK demande au serveur tout ce qui suit le dernier numéro de séquence qu'il a vu, et transmet le résultat via les mêmes gestionnaires. Il n'y a aucun second chemin de code à écrire : un gestionnaire qui applique correctement une opération en direct l'appliquera tout aussi correctement lors du rattrapage.

### Numéros de séquence

Chaque diffusion sur un canal avec rétention porte un numéro `seq` — propre à chaque canal, sans trou et croissant. C'est le point de reprise du client.

```typescript
channel.onBroadcast((event) => {
    console.log(event.seq);       // 1, 2, 3, …
    console.log(event.replayed);  // true when delivered by catch-up
});

console.log(channel.sequence); // highest seq delivered so far
```

Persistez `channel.sequence` si vous souhaitez que le rattrapage survive aussi bien à un rechargement de page qu'à une reconnexion, et transmettez-le via `history({ sinceSeq })`.

### Récupérer l'historique explicitement

```typescript
const { messages, retained, latestSeq } = await channel.history({
    sinceSeq: 0,
    limit: 100
});
```

`retained: false` signifie que le canal ne conserve aucun historique et n'en conservera jamais — une réponse explicite qui permet de distinguer « vous n'avez rien manqué » de « ce canal n'a pas de règle de rétention ». Dans le second cas, un client devant converger doit se rabattre sur une resynchronisation complète.

`latestSeq` est la séquence la plus élevée détenue par le serveur, que ce lot l'ait atteinte ou non. S'il est bien supérieur à votre dernier `seq` reçu, vous avez plus d'une page de retard et une resynchronisation complète pourrait être plus économique que la pagination.

:::note[Les rejeux peuvent se chevaucher, et ce n'est pas un problème]
Le serveur ne peut pas savoir exactement quels messages vous sont parvenus avant la coupure du socket, de sorte qu'une plage de rattrapage peut inclure des messages que vous avez déjà appliqués. Le SDK ignore tout élément dont la séquence est inférieure ou égale à celle déjà délivrée, ainsi les gestionnaires ne voient jamais deux fois le même message.

Vos propres messages sont filtrés lors d'un rejeu, comme ils le sont en direct, y compris ceux envoyés avant qu'une reconnexion n'attribue un nouvel identifiant client au socket : le canal se souvient des identifiants depuis lesquels il a émis. Un nouvel objet canal — après un rechargement de page, par exemple — n'en garde aucun en mémoire, de sorte qu'un rattrapage dans ce cas délivre vos messages précédents comme ceux de n'importe qui d'autre, ce qui est nécessaire pour reconstruire l'état à partir de l'historique.
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

Le SDK gère la liste pour vous, ainsi `presences` est toujours complet et vous n'avez jamais besoin de le reconstituer à partir des différences (diffs).

Il gère également deux détails de protocole faciles à négliger lors d'une utilisation directe des WebSockets bruts :

- **La liste des présences n'est pas envoyée lors de la connexion.** Le premier `presence_diff` d'un client rejoignant le canal ne contient que lui-même ; la liste existante doit être demandée explicitement. `join()` s'en charge pour vous.
- **La présence expire après 30 secondes.** `track()` n'est pas un enregistrement persistant — sans un renvoi périodique, vous disparaissez silencieusement de la liste de tous les autres alors que vous êtes toujours connecté et sur la page. Le SDK émet un battement de cœur (heartbeat) toutes les 20 secondes, et s'arrête lors de `untrack()` / `leave()`.

Une reconnexion réinitialise également l'appartenance au canal et la présence côté serveur ; le SDK rejoint à nouveau le canal, redemande la liste et réactive automatiquement le suivi.

## Quand utiliser le temps réel

| Cas d'usage | Méthode |
|-------------|---------|
| Tableau de bord avec données en direct | `listen()` avec filtres |
| Chat ou messagerie | `channel.broadcast()` |
| Édition collaborative / flux d'opérations | `channel(name, { history: true })` |
| Indicateurs de frappe / statut en ligne | `channel.track()` + `channel.onPresence()` |
| Page de détails avec mises à jour en direct | `listenById()` |
| Surveillance de panneau d'administration | `listen()` avec `orderBy` et `limit` |
| Une liste devant survivre à une perte de connexion | `observe()` avec le mode [hors ligne](/docs/sdk/offline) activé |

> **Astuce :** Pour des récupérations ponctuelles de données, utilisez plutôt `find()` ou `findById()`. Les abonnements sont idéaux pour les données qui changent fréquemment et doivent être reflétées immédiatement dans l'interface utilisateur.

## `listen()` vs `observe()`

Tous deux maintiennent une requête à jour et tous deux renvoient une fonction de désabonnement — mais ils répondent à des besoins différents.

`listen()` concerne le socket : il délivre ce que le serveur transmet par push, et ne délivre rien lorsque le socket est interrompu.

`observe()` concerne la requête : avec le support [hors ligne](/docs/sdk/offline) activé, il émet d'abord à partir de la base de données locale — avant toute requête — et réémet lors d'écritures locales, lorsque des écritures en file d'attente atteignent le serveur, lors de rollbacks et lors d'événements en temps réel, auxquels il s'abonne lui-même à moins que vous ne passiez `{ realtime: false }`. Chaque résultat indique s'il provient du cache et s'il contient des écritures que le serveur n'a pas encore acceptées.

```typescript
const unsubscribe = client.data.products.observe(
    { where: { active: ["==", true] } },
    (result) => {
        render(result.data);
        setSaving(result.hasPendingWrites);
    }
);
```

Sans le mode hors ligne activé, `observe()` équivaut à `find()` et `listen()` en un seul appel, avec ces indicateurs toujours à `false`.

## Prochaines étapes

- **[Interroger les données](/docs/sdk/querying)** — Opérations CRUD et query builder
- **[Synchronisation hors ligne & Local-First](/docs/sdk/offline)** — Requêtes en direct qui survivent à une coupure de connexion
- **[Authentification](/docs/sdk/authentication)** — Connexion et gestion des sessions
- **[Backend temps réel](/docs/backend/realtime)** — Configuration WebSocket côté serveur
