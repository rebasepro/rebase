---
sourceHash: eb117d132ea516de
title: Abonnements en temps réel
sidebar_label: Temps réel
description: Abonnez-vous aux modifications de données en direct avec le SDK typé Rebase grâce aux écouteurs temps réel basés sur WebSocket.
---

## Vue d'ensemble

Le SDK typé Rebase fournit des abonnements aux données en temps réel via WebSocket. Lorsque des enregistrements changent sur le serveur, vos fonctions de rappel (callbacks) abonnées se déclenchent immédiatement avec les données mises à jour.

La connexion WebSocket est établie automatiquement lorsqu'une `websocketUrl` est disponible (dérivée de `baseUrl` par défaut). La reconnexion et le rafraîchissement du jeton sont gérés pour vous. Une panne durant plus d'environ 15 secondes est signalée une seule fois à chaque `onError` d'abonnement sous le code `CONNECTION_LOST` — voir [Authentification et reconnexion](#authentification-et-reconnexion).

## S'abonner à une table

Utilisez `listen()` pour vous abonner à une requête de table. Le callback se déclenche chaque fois que l'ensemble de données correspondant change :

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

`FindResult<M>` a la même structure que celle renvoyée par `find()` : des lignes plates dans `data`, et `{ total, limit, offset, hasMore, nextCursor }` dans `meta`.

### `listen()` prend ce que `find()` prend

`params` est un objet `FindParams` complet. Un abonnement est la même requête que le `find()` correspondant, il accepte donc les mêmes critères de restriction — `where`, `logical`, `orderBy`, `limit`, `offset`/`page`, `searchString`, **`include`** et **`fields`** :

```typescript
client.data.posts.listen(
    { where: { status: ["==", "published"] }, include: ["author"], limit: 20 },
    (result) => render(result.data)   // each row carries its author
);
```

Cela a plus d'importance qu'il n'y paraît. Auparavant, `include` et `fields` étaient ignorés silencieusement ici, de sorte que la même requête répondait sous une certaine structure via `find()` et sous une autre via `listen()` — et un composant affichant les deux voyait ses lignes changer de structure dès qu'une écriture survenait. Ils passent désormais par le même pipeline de lecture, de sorte que `find({ q })` et `listen({ q })` renvoient des lignes identiques champ pour champ.

L'exception est `vectorSearch`, qui est **refusé** plutôt qu'ignoré : un abonnement est réexécuté à chaque écriture correspondante et rien n'y calcule les distances. Utilisez `.vectorSearch(…).find()` pour la requête et abonnez-vous sans celui-ci.

### Une seule émission par modification

Chaque push du serveur appelle votre callback **une seule fois**, avec des métadonnées qui décrivent les lignes associées. Il n'y a pas d'émission séparée pour le premier affichage (first-paint) et aucun indicateur à vérifier.

Les métadonnées arrivent **dans la même trame que les lignes** : le serveur effectue le décompte de la requête au sein de la même transaction soumise à la sécurité au niveau des lignes (RLS) qui les a lues, de sorte que `meta.total`, `meta.hasMore` et `meta.nextCursor` décrivent exactement les lignes qui les accompagnent. (Auparavant, chaque push était suivi d'un `GET /count` de la part du client — un aller-retour supplémentaire par écriture, par abonné, et un intervalle durant lequel le décompte et les lignes décrivaient des états différents de la table.)

Deux solutions de repli, dont aucune n'est une erreur d'abonnement et aucune n'appelle `onError` :

- Si le **décompte du serveur échoue**, la trame ne contient aucun total et le dernier total reçu est réutilisé. Un décompte ayant échoué ne donne aucune indication sur la taille de la table, il ne doit donc pas écraser une réponse valide.
- Si aucun total n'a jamais été reçu pour cet abonnement — cas d'un serveur plus ancien qui n'envoie aucune métadonnée —, le client le demande une seule fois, lors du premier push. Si cela échoue également, `meta.total` est une **borne inférieure** : les lignes de cette page plus celles des pages précédentes parcourues pour les atteindre.

```typescript
client.data.products.listen(
    { where: { active: ["==", true] }, limit: 50 },
    (result) => {
        renderProducts(result.data);
        renderPager({ total: result.meta.total, hasMore: result.meta.hasMore });
    }
);
```

## S'abonner à une entité individuelle

Utilisez `listenById()` pour surveiller un enregistrement spécifique par son ID :

```typescript
// The SDK hands back a flat row, not an `Entity` — there is no `.values`.
const unsubscribe = client.data
    .table<{ id: number; name: string }>("products")
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

Chaque trame transporte les relations désignées par `options.include`, chargées de la même manière que `find({ include })` les charge dans chaque ligne d'une liste. Une relation « to-many » non spécifiée ici est absente de la ligne, et non vide :

```typescript
client.data.posts.listenById(1, (post) => {
    console.log(post?.tags); // the post's tags, on every update
}, undefined, { include: ["tags"] });
```

**Limites.** Une trame est envoyée lorsque la ligne elle-même change, et chaque trame recharge ses relations incluses. Une modification apportée uniquement à une ligne liée n'envoie aucune trame : modifier le nom d'un tag n'actualise pas un article écouté avec `include: ["tags"]` tant que l'article ne change pas lui aussi. Pour suivre les lignes liées, écoutez également leur table.

## Surveiller un décompte

`listenCount()` maintient un décompte à jour : le total des éléments correspondant au filtre d'une liste, idéal pour une barre d'outils ou une option « sélectionner les N éléments » qui ne doit pas devenir obsolète pendant que d'autres personnes ajoutent ou suppriment des lignes. Le callback s'exécute avec le total dès qu'il est connu, puis à chaque fois qu'une écriture le modifie.

```typescript
const stop = client.data.orders.listenCount(
    { where: { status: ["==", "open"] } },
    (total) => console.log(`${total} open orders`),
    (error) => console.error(error)
);
```

Seul le filtre est pris en compte — `where`, `logical` et `searchString` ; les paramètres `limit`, `offset` ou un tri sont ignorés. Le serveur ne lit aucune ligne pour cela, seulement le décompte, sous l'identité de l'abonné comme pour toute autre trame. Un serveur antérieur à la version 0.25 ne reconnaît pas la requête ; elle reçoit en réponse une ligne et le même total, et le SDK y lit le total. Sur un client sans socket, `listenCount()` est un bouchon qui lève une exception, tout comme `listen()`. Lorsque le [support hors ligne](/docs/sdk/offline/) est activé, le décompte est celui du serveur : les écritures en attente n'y figurent pas tant qu'elles n'ont pas été rejouées.

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

Un abonnement accepte un tri sur plusieurs colonnes comme n'importe quelle autre requête — soit via `orderBy: [["category", "asc"], ["createdAt", "desc"]]` dans les paramètres, soit via un deuxième appel à `.orderBy()`, qui ajoute un critère de départage plutôt que de remplacer le premier. Voir [Tri](/docs/sdk/querying#sorting).

Le serveur vérifie la *forme* du `orderBy` d'un abonnement dès son arrivée et refuse une forme incorrecte avec une trame d'erreur plutôt que de s'abonner. Un tri qu'il ne pourrait pas lire diffuserait sinon des lignes sans aucun ordre tout en ne signalant aucune erreur — et une trame `collection_update` transporte des lignes et rien d'autre, de sorte qu'un abonné n'a aucun moyen de s'en rendre compte.

## Se désabonner

Chaque abonnement renvoie une fonction `unsubscribe`. Appelez-la pour cesser de recevoir les mises à jour et nettoyer l'écouteur WebSocket :

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

- Lors de la **connexion** ou du **rafraîchissement du jeton**, un socket déjà ouvert prend en compte le nouvel identifiant. Un rafraîchissement, ou une connexion avec le compte déjà détenu, envoie le jeton dans un message `authenticate` ; une connexion avec un compte différent — y compris un visiteur qui se connecte — reconstruit le socket, qui s'authentifie sous ce compte et réémet chaque abonnement et canal actif. Si aucun socket n'est ouvert, rien ne se passe — se connecter n'est pas une demande de temps réel, et un socket ouvert ultérieurement s'authentifiera de lui-même.
- Lors de la **déconnexion**, la connexion WebSocket est coupée. Le client reste utilisable ; un abonnement ultérieur se reconnecte anonymement.
- Si la connexion est interrompue, le client **se reconnecte automatiquement** et rétablit tous les abonnements actifs. Il ne cesse jamais d'essayer tant qu'un abonnement ou un canal rejoint existe ; le délai entre les tentatives augmente jusqu'à un maximum de 30 secondes.
- Si le serveur met fin à la session du socket — l'utilisateur s'est déconnecté de partout, cette session a été révoquée, le compte a été supprimé ou le jeton a expiré avant qu'un rafraîchissement n'atteigne le socket —, il ferme le socket avec le code `4001`. Le client se reconnecte comme après n'importe quelle interruption, en s'authentifiant avec la session détenue à ce moment-là (rafraîchie si possible), ou de manière anonyme s'il n'y en a pas. La révocation d'un rôle ne ferme pas le socket : elle s'applique à partir de la trame suivante. Voir [Authentification & RLS](/docs/backend/realtime/#authentication--rls).
- Si la connexion reste interrompue pendant plus d'environ 15 secondes, le callback `onError` de chaque abonnement (et le `onError` de chaque canal rejoint) est appelé **une seule fois** avec une `RebaseApiError` dont le `code` est `CONNECTION_LOST`. L'abonnement n'est pas interrompu : continuez d'afficher ce que vous avez, marquez-le comme potentiellement obsolète et attendez. Lorsque le socket est de retour, le prochain `onUpdate` de l'abonnement transportera tout ce qui a été écrit entre-temps.
- `client.ws.state` représente l'état de la connexion — `idle`, `connecting`, `connected`, `reconnecting`, `disconnected` ou `closed` — et `client.ws.onStateChange(listener)` est notifié de chaque changement. `disconnected` est l'état dans lequel `CONNECTION_LOST` a été signalé.
- Les requêtes envoyées via le socket sont délivrées **au plus une fois (at-most-once)**. Une requête envoyée au moment de la perte de connexion échoue avec `CONNECTION_LOST` et n'est jamais renvoyée, car le serveur a pu déjà l'exécuter. Une requête attendant toujours un socket après 30 secondes échoue avec `REQUEST_TIMEOUT` sans avoir été envoyée.

Tous les éléments de la liste après la déconnexion ont été introduits dans la version 0.24.

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

### Quel jeton le socket envoie

Le socket s'authentifie avec le même jeton que celui qu'une requête HTTP transporterait. Il s'agit en priorité du getter configuré avec `client.setAuthTokenGetter()` ; s'il n'y en a pas, ou s'il renvoie `null` ou lève une exception, il s'agit du jeton détenu par le client : celui de sa session, un jeton défini avec `client.setToken()`, ou l'option `token`. Avec le module intégré `client.auth`, il n'y a rien à configurer.

Pour un fournisseur d'authentification externe (Clerk, Firebase Auth, votre propre session), définissez le getter une fois. Il couvre à la fois HTTP et le socket :

```typescript
client.setAuthTokenGetter(() => provider.getToken());

// Optional: let the provider recover a refused token, on HTTP and the socket alike.
client.setOnUnauthorized(async () => {
    await provider.refresh();
    return true; // retry with the token resolved again
});
```

- `client.setOnUnauthorized(handler)` réagit à un jeton refusé dans les deux cas : une erreur 401 sur HTTP, et une erreur d'authentification sur le socket. Renvoyez `true` pour réessayer après avoir résolu le jeton à nouveau. Cela remplace le rafraîchissement de session propre au client.
- Installer un getter ou appeler `client.setToken()` reconstruit un socket ouvert : le nouveau s'authentifie avec les nouveaux identifiants et réémet sous cette identité chaque abonnement et canal actif, et rien de ce que détenait l'identité précédente n'est conservé. Si aucun socket n'est ouvert, le suivant s'authentifiera de lui-même.
- `client.ws.setAuthTokenGetter()` est obsolète (deprecated). Il fonctionne toujours, en remplaçant uniquement le getter du socket, et émet un avertissement une fois. Utilisez `client.setAuthTokenGetter()`.

Voir [Votre propre fournisseur d'authentification](/docs/sdk/your-own-auth-provider/).

### La connexion est différée (lazy)

La création d'un client n'ouvre **aucun** WebSocket. La connexion n'est établie qu'à la première opération qui en a réellement besoin — un abonnement `listen()` / `listenById()`, ou une opération de canal telle que `join()`, `track()` ou `broadcast()`. Obtenir une référence à un canal ne constitue pas une utilisation de celui-ci.

```typescript
const client = createRebaseClient({ baseUrl });   // no socket
const channel = client.realtime.channel("doc:1"); // still no socket
await channel.join();                             // socket opens here
```

Cela est particulièrement important pour les applications recevant un trafic déconnecté significatif — pages marketing, vues publiques en lecture seule, outils orientés anonymat d'abord — qui payaient auparavant le coût d'une connexion à chaque chargement de page simplement pour rendre le temps réel disponible.

Deux comportements associés :

- `realtime: false` reste une désactivation explicite : aucun socket ne sera jamais ouvert, et `client.realtime.channel()` lève une exception. Il en va de même pour `listen()` et `listenById()` — ils peuvent toujours être appelés, et sur un client sans socket, ils lèvent une `RebaseClientError` indiquant l'option qui permettrait de les activer. `observe()` ne lève pas d'erreur : il se dégrade en une simple requête (fetch).
- `client.close()` est définitif. Il libère le socket et son minuteur de reconnexion, et rien de ce qui est mis en file d'attente par la suite ne relancera la connexion. Sous Node, un socket ouvert maintient la boucle d'événements active, de sorte qu'un script qui ne l'appelle jamais ne s'arrêtera pas de lui-même.

### Maintenir un groupe sur une seule instance

Avec plusieurs instances de serveur, les membres d'un canal peuvent se retrouver sur des instances différentes, et chaque message échangé entre eux doit alors [traverser le bus de canaux](/docs/backend/realtime-transports/#channels-and-presence-across-instances). `affinity` désigne le groupe auquel appartient un socket, comme un salon ou un document, afin qu'une plateforme puisse router tout le groupe vers la même instance :

```typescript
const client = createRebaseClient({
    baseUrl,
    realtime: { affinity: roomCode }
});
```

Lorsque la clé n'est connue que plus tard, définissez-la avant que le socket ne s'ouvre :

```typescript
const client = createRebaseClient({ baseUrl });

client.realtime.setAffinity(roomCode);          // no socket yet
await client.realtime.channel(roomCode).join(); // opens with the key
```

La clé est ajoutée à l'adresse du socket sous la forme `?affinity=`, et elle remplace celle qui se trouverait déjà dans une `websocketUrl` que vous avez définie. `setAffinity(null)` la réinitialise.

- **Il s'agit d'une optimisation.** Rebase Cloud l'utilise pour le routage lorsqu'un projet exécute plusieurs instances. En auto-hébergement, ou derrière un proxy qui n'effectue pas de hachage dessus, cela n'a aucun effet et les canaux fonctionnent à l'identique : le bus transporte toujours tout ce qui transite entre les instances, y compris un groupe divisé suite à une montée en charge (scale-up).
- **Elle prend effet lors de la connexion du socket.** Un socket déjà ouvert reste là où il est, et utilisera la nouvelle clé lors de sa prochaine connexion. Pour déplacer un client qui est connecté, créez-en un nouveau, ou définissez la clé avant son premier `join()` ou `listen()`.
- **Elle détermine où le socket atterrit, et non ce à quoi il a le droit d'accéder.** L'accès à un canal n'en dépend pas, et l'adresse se retrouve dans les journaux d'accès (logs) ; utilisez donc un code plutôt qu'un secret ou une information personnelle.

Pour vérifier si cela fonctionne, comparez ce que chaque instance publie et ignore : voir [Voir ce que fait le bus](/docs/backend/realtime-transports/#seeing-what-the-bus-does).

## Canaux de diffusion (Broadcast Channels)

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

Les canaux sont légers et éphémères — ils existent tant qu'au moins un client y est abonné. Des appels répétés à `channel()` avec le même nom renvoient le **même** objet, ce qui permet à deux composants d'attacher des gestionnaires indépendamment sans que l'un ne coupe l'autre en quittant.

Les trames de canal et de présence ne nécessitent aucun compte : les visiteurs anonymes peuvent rejoindre des canaux publics.

:::caution[Les canaux n'ont pas encore de règles d'accès]
La seule vérification appliquée par le serveur est **l'appartenance** : pour diffuser dans un canal, lire sa liste de présence ou rejouer son historique, un client doit d'abord avoir rejoint ce canal. L'adhésion elle-même est ouverte — tout client capable de nommer un canal peut le rejoindre, qu'il soit connecté ou non.

Un nom de canal n'est donc ni un secret ni une autorisation. Ne mettez rien dans un canal (y compris l'historique conservé et l'état de présence) que tous les utilisateurs de votre application ne devraient pas voir, et ne dérivez pas un nom de canal à partir de données que vous ne divulgueriez pas. Les règles d'autorisation par canal ne sont pas implémentées ; si vous en avez besoin aujourd'hui, conservez la partie sensible des échanges sur `client.data`, où s'applique la sécurité au niveau des lignes (RLS).
:::

> **Par défaut, les diffusions ne sont pas rejouées.** Elles n'atteignent que les membres actuellement connectés. C'est exactement ce qu'il faut pour des notifications qui s'auto-corrigent — une alerte « quelqu'un a enregistré » est rendue obsolète par l'enregistrement suivant — et cela ne coûte rien. Pour un flux d'opérations, où un manque silencieux entraîne une divergence, activez [l'historique des messages](#historique-des-messages-et-rattrapage) sur le canal.

## Historique des messages et rattrapage

Un canal peut être configuré pour conserver ses diffusions, de sorte qu'un client qui se reconnecte rattrape ce qu'il a manqué au lieu de tout resynchroniser depuis le début. C'est ce qui rend les canaux exploitables comme moyen de transport pour l'édition collaborative.

La rétention est configurée **sur le serveur**, par motif de canal (channel pattern) — voir [Backend temps réel](/docs/backend/realtime#channel-retention). Un client ne peut pas l'activer de lui-même, car un canal est créé par quiconque le nomme, et une profondeur d'historique choisie par le client permettrait à n'importe quel visiteur d'imposer un stockage illimité à votre backend.

Sur un canal avec rétention, passez `{ history: true }` et le SDK s'occupe du reste :

```typescript
const channel = client.realtime.channel("doc:42", { history: true });

// Handlers receive replayed messages exactly like live ones, in order.
channel.onBroadcast("op", (payload) => {
    applyOperation(payload);
});

await channel.join();
```

Lors de `join()` et après chaque reconnexion, le SDK demande au serveur tout ce qui suit le dernier numéro de séquence qu'il a vu, et délivre le résultat via les mêmes gestionnaires. Il n'y a pas de deuxième chemin de code à écrire : un gestionnaire qui applique correctement une opération en direct l'appliquera tout aussi correctement lors d'un rattrapage.

### Numéros de séquence

Chaque diffusion sur un canal avec rétention porte un numéro `seq` — par canal, sans lacune et croissant. Il s'agit du point de reprise du client.

```typescript
channel.onBroadcast((event) => {
    console.log(event.seq);       // 1, 2, 3, …
    console.log(event.replayed);  // true when delivered by catch-up
});

console.log(channel.sequence); // highest seq delivered so far
```

Persistez `channel.sequence` si vous souhaitez que le rattrapage survive à un rechargement de page ainsi qu'à une reconnexion, et transmettez-le à nouveau via `history({ sinceSeq })`.

### Récupérer l'historique explicitement

```typescript
const { messages, retained, latestSeq } = await channel.history({
    sinceSeq: 0,
    limit: 100
});
```

`retained: false` signifie que le canal ne conserve aucun historique et n'en conservera jamais — une réponse explicite, qui vous permet de distinguer « vous n'avez rien manqué » de « ce canal n'a pas de règle de rétention ». Dans le second cas, un client qui doit converger doit recourir à une resynchronisation complète.

`latestSeq` est la séquence la plus élevée que le serveur conserve, que ce lot l'ait atteinte ou non. S'il est bien supérieur à votre dernier `seq` reçu, votre retard dépasse une seule page et une resynchronisation complète pourrait être plus économique que de paginer.

:::note[Les rediffusions peuvent se chevaucher, et ce n'est pas un problème]
Le serveur ne peut pas savoir exactement quels messages vous ont atteint avant la coupure du socket, donc une plage de rattrapage peut inclure des messages que vous avez déjà appliqués. Le SDK rejette tout ce qui est inférieur ou égal à la séquence qu'il a déjà délivrée, de sorte que les gestionnaires ne voient jamais un message deux fois.

Vos propres messages sont exclus d'une rediffusion, tout comme en direct, y compris ceux envoyés avant qu'une reconnexion n'attribue un nouvel identifiant client au socket : le canal mémorise les identifiants depuis lesquels il a diffusé. Un nouvel objet de canal — après un rechargement de page, par exemple — n'en mémorise aucun, de sorte qu'un rattrapage délivrera alors vos messages antérieurs comme ceux de n'importe qui d'autre, ce qui est nécessaire pour reconstruire l'état à partir de l'historique.
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

Le SDK maintient la liste des présents (roster) pour vous, de sorte que `presences` est toujours complet et que vous n'avez jamais à le reconstituer à partir des diffs.

Il gère également deux détails de protocole faciles à négliger lors du travail direct avec le WebSocket brut :

- **La liste des présents n'est pas envoyée lors de l'adhésion.** Le premier `presence_diff` reçu par un client qui rejoint le canal ne contient que lui-même ; la liste existante doit être demandée explicitement. `join()` s'en charge pour vous.
- **La présence expire après 30 secondes.** `track()` n'est pas un enregistrement persistant — sans renvoi périodique, vous disparaissez silencieusement de la liste des autres participants tout en étant toujours connecté et toujours sur la page. Le SDK envoie un battement de cœur (heartbeat) toutes les 20 secondes, et s'arrête lors de `untrack()` / `leave()`.

Une reconnexion supprime également l'appartenance au canal et la présence côté serveur ; le SDK rejoint à nouveau le canal, redemande la liste et réenregistre la présence automatiquement.

## Quand utiliser le temps réel

| Cas d'utilisation | Méthode |
|-------------------|---------|
| Tableau de bord avec données en direct | `listen()` avec filtres |
| Chat ou messagerie | `channel.broadcast()` |
| Édition collaborative / flux d'opérations | `channel(name, { history: true })` |
| Indicateurs de saisie / statut en ligne | `channel.track()` + `channel.onPresence()` |
| Page de détails avec mises à jour en direct | `listenById()` |
| Surveillance de panneau d'administration | `listen()` avec `orderBy` et `limit` |
| Liste devant survivre à une perte de connexion | `observe()` avec le mode [hors ligne](/docs/sdk/offline) activé |

> **Astuce :** Pour les récupérations de données ponctuelles, utilisez plutôt `find()` ou `findById()`. Les abonnements sont idéaux pour les données qui changent fréquemment et doivent être reflétées immédiatement dans l'interface utilisateur.

## `listen()` vs `observe()`

Tous deux maintiennent une requête à jour et renvoient une fonction de désabonnement — mais ils répondent à des besoins différents.

`listen()` est lié au socket : il transmet ce que le serveur pousse, et ne transmet rien lorsque le socket est déconnecté.

`observe()` est lié à la requête : lorsque le mode [hors ligne](/docs/sdk/offline) est activé, il émet d'abord à partir de la base de données locale — avant toute requête — puis réémet lors d'écritures locales, lorsque des écritures en file d'attente atteignent le serveur, lors de rollbacks et lors d'événements en temps réel, auxquels il s'abonne lui-même à moins de passer `{ realtime: false }`. Chaque résultat indique s'il provient du cache et s'il contient des écritures que le serveur n'a pas encore acceptées.

```typescript
const unsubscribe = client.data.products.observe(
    { where: { active: ["==", true] } },
    (result) => {
        render(result.data);
        setSaving(result.hasPendingWrites);
    }
);
```

Sans l'activation du mode hors ligne, `observe()` équivaut à `find()` combiné à `listen()` en un seul appel, avec ces indicateurs toujours définis à `false`.

## Prochaines étapes

- **[Interroger les données](/docs/sdk/querying)** — Opérations CRUD et query builder
- **[Synchronisation hors ligne et local-first](/docs/sdk/offline)** — Requêtes en direct qui survivent à une coupure de connexion
- **[Authentification](/docs/sdk/authentication)** — Connexion et gestion des sessions
- **[Backend temps réel](/docs/backend/realtime)** — Configuration WebSocket côté serveur
