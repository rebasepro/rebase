---
sourceHash: 1b875d11f8a07037
title: Synchronisation hors ligne et « Local-First »
sidebar_label: Hors ligne
description: Activez le moteur de synchronisation local-first du SDK typé Rebase — une base de données locale de lignes, des écritures hors ligne instantanées avec rollback et des requêtes réactives en direct.
---

## Aperçu

La prise en charge du mode hors ligne transforme la couche de données du SDK en un **moteur de synchronisation local-first**. Au lieu d'un cache qui mémorise des réponses, le client conserve une petite base de données locale de lignes, répond aux requêtes à partir de celle-ci, et traite le réseau comme un moyen de l'alimenter et d'accepter à terme vos écritures.

Il en découle trois choses :

- **Les lectures survivent à la coupure du réseau.** Une requête que le client peut évaluer localement est évaluée localement — filtres, tri et pagination inclus — de sorte qu'une liste continue de s'afficher même avec une connexion interrompue.
- **Les écritures sont décidées localement.** Une écriture effectuée hors ligne s'applique immédiatement, est mise en file d'attente et est rejouée dans l'ordre lorsque la connexion est rétablie. Si le serveur la rejette, la modification locale fait l'objet d'un rollback.
- **Les lectures sont réactives.** `observe()` émet d'abord à partir de la base de données locale et réémet dès que quelque chose modifie les lignes qu'elle couvre — vos propres écritures, l'aboutissement d'une écriture en attente, un rollback, un autre onglet de navigateur ou un événement en temps réel.

Cette fonctionnalité est désactivée par défaut. Activez-la avec une seule option :

```typescript
const client = createRebaseClient({
    baseUrl: "https://api.example.com",
    offline: true
});
```

Dans le navigateur, tout persiste dans IndexedDB, de sorte qu'un rechargement conserve à la fois les lignes locales et les écritures non envoyées. Ailleurs (Node, tests), il bascule vers la mémoire ; d'autres environnements d'exécution peuvent fournir leur propre stockage.

## Ce qui change

Rien dans l'API que vous utilisez déjà ne change de forme. `find()`, `findById()`, `create()`, `update()`, `delete()` et le constructeur fluide (fluent builder) conservent leurs signatures et leurs types de retour — ils cessent simplement d'échouer lorsque le réseau tombe en panne.

### Lectures

Une lecture réussie fusionne ses lignes dans la base de données locale et mémorise les identifiants renvoyés par le serveur pour cette requête. Lorsqu'une lecture ne peut pas joindre le serveur, la réponse est apportée localement :

```typescript
const drafts = await client.data.posts
    .where("status", "==", "draft")
    .orderBy("updatedAt", "desc")
    .find();
```

Hors ligne, cela filtre et trie les lignes que le client détient. Cela inclut les lignes récupérées par *d'autres* requêtes — la base de données est normalisée, de sorte qu'une ligne n'est stockée qu'une seule fois, quel que soit le nombre de listes dans lesquelles elle est apparue — ainsi que les lignes que vous avez créées hors ligne.

S'il n'y a véritablement rien avec quoi répondre (une table que l'application n'a jamais lue), la lecture lève une erreur reconnaissable plutôt qu'une simple `TypeError` :

```typescript
import { isOfflineError } from "@rebasepro/client";

try {
    await client.data.posts.find();
} catch (error) {
    if (isOfflineError(error)) showOfflinePlaceholder();
    else throw error;
}
```

### Écritures

Tant que la connexion est identifiée comme interrompue, une écriture n'est même pas tentée — elle s'applique localement et se met en file d'attente, ce qui ne coûte rien au lieu de subir un délai d'attente dépassé (timeout) :

```typescript
// While offline, returns at once with the locally applied row.
const post = await client.data.posts.create({ title: "Draft", status: "draft" });

// Shows up in every matching list, right away.
const drafts = await client.data.posts.where("status", "==", "draft").find();
```

Les lignes créées hors ligne reçoivent un identifiant généré par le client, selon le type que possèdent déjà les identifiants de la table : un **entier négatif** lorsqu'il s'agit de nombres, une chaîne UUID lorsqu'il s'agit de chaînes. Le signe est le révélateur — une vraie clé n'est jamais négative — ainsi, une ligne qui n'a pas encore atteint le serveur est reconnaissable sans recherche, et le typage de `id` correspond toujours à ce que définit le `Row` généré. Sur une table que cet appareil n'a jamais lue, il n'y a rien de local d'où déduire le type, et l'identifiant est un UUID.

Si le serveur attribue son propre identifiant lors du rejeu, la ligne locale et toutes les écritures en attente pointant encore vers l'identifiant temporaire sont mises à jour avec le véritable identifiant, dans toutes les tables : un post mis en attente avec `author_id` pointant vers un auteur créé hors ligne est envoyé avec l'identifiant que le serveur a attribué à l'auteur. Si le serveur refuse l'auteur à la place, les écritures qui y font référence sont abandonnées avec lui et signalées comme `DEPENDENCY_REJECTED` (voir [Quand le serveur dit non](#quand-le-serveur-dit-non)). D'ici là, ne persistez aucun identifiant temporaire en dehors de la base de données hors ligne — une clé étrangère ou une URL mise en favori contenant celui-ci pointerait vers une ligne sur le point d'être renumérotée.

Les écritures sont rejouées dans l'ordre où vous les avez effectuées, toutes tables confondues — ainsi, une création dans une table arrive toujours avant la ligne d'une autre table qui y fait référence.

Chaque écriture en file d'attente correspond à une seule requête par défaut, de sorte que 500 lignes saisies hors ligne nécessitent 500 allers-retours pour être vidées. Lorsque `replayBatchSize` est configuré (jusqu'à 1 000), une série de créations consécutives hors ligne dans une même table est rejouée sous forme d'un seul `createMany`. Seules les créations avec un identifiant généré sous forme de chaîne par le SDK sont regroupées, et jamais celles qui font référence à une autre ligne de la même série. Si le serveur refuse ou reporte la série pour une raison autre qu'une perte de connexion, rien n'est écrit (une écriture en masse constitue une seule transaction), et la série est rejouée une écriture à la fois, comme elle le ferait par défaut.

### Écritures mises en file d'attente par une version antérieure

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

La file d'attente stocke une écriture sous forme des valeurs qu'elle envoie — les clés pour les relations, les listes de nombres pour les vecteurs, `{ latitude, longitude }` pour les points, le texte ISO pour les dates — et les lignes en cache sous forme des lignes du serveur. Une écriture mise en file d'attente hors ligne par la version précédente du SDK, qui les stockait sous forme de classes (`EntityRelation`, `GeoPoint`, `Vector`), est convertie vers ces valeurs lors de sa relecture et rejouée comme d'habitude : rien de ce qui a été mis en attente avant la mise à niveau n'est perdu. Un SDK plus ancien rencontrant une écriture mise en attente par celui-ci la laisse dans la file.

## Requêtes en direct

`observe()` est la lecture réactive, et celle qu'il convient d'utiliser dans une interface utilisateur :

```typescript
const unsubscribe = client.data.posts.observe(
    { where: { status: ["==", "draft"] }, orderBy: ["updatedAt", "desc"] },
    (result) => {
        render(result.data);
        setBadge(result.hasPendingWrites ? "saving…" : null);
    }
);
```

La première émission provient de la base de données locale sans aucune requête préalable ; une revalidation s'ensuit en arrière-plan. Après cela, elle réémet à chaque modification apportée aux lignes qu'elle couvre. Les émissions sont dédupliquées — un rafraîchissement qui ne change rien ne déclenche pas de rappel — il est donc sûr de faire le rendu directement à partir de celle-ci.

Chaque résultat contient ce dont une interface utilisateur a besoin pour se décrire :

| Champ | Signification |
|-------|---------|
| `data`, `meta` | Le même format que celui renvoyé par `find()` |
| `fromCache` | Les lignes proviennent de la base de données locale, pas d'une requête aboutie |
| `hasPendingWrites` | Au moins une ligne ici comporte une écriture que le serveur n'a pas encore acceptée |
| `partial` | La base de données locale peut ne pas contenir toutes les lignes correspondantes — à considérer au mieux |
| `error` | La dernière revalidation a échoué |

`observeById()` fait de même pour une seule ligne, et transmet `undefined` lorsqu'elle est supprimée. Elle accepte `include` tout comme `findById()`, et chaque émission inclut ces relations :

```typescript
const stop = client.data.posts.observeById(postId, (post) => render(post), undefined, {
    include: ["tags"]
});
```

Les deux lient la souscription en temps réel lorsque le client en possède une, de sorte que les modifications apportées par d'autres utilisateurs affluent également. Passez `{ realtime: false }` pour obtenir un abonnement qui ne reflète que l'état local et les rafraîchissements explicites.

Même sans l'option `offline` activée, `observe()` existe toujours : elle effectue une récupération initiale et reste active grâce au temps réel, avec les trois drapeaux à `false`.

## État de synchronisation

`client.offline` expose le moteur, sur lequel s'appuie un indicateur de synchronisation :

```typescript
const unsubscribe = client.offline!.onStatusChange((status) => {
    setOnline(status.online);
    setPending(status.pending);
    setSyncing(status.syncing);
});

// Or read it once
const { online, pending, syncing, lastSyncedAt, lastError } = client.offline!.status();
```

| Méthode | Objectif |
|--------|---------|
| `status()` | Connectivité actuelle, taille de la file d'attente, activité de synchronisation, dernière erreur, et `persisted` : indique si le navigateur a accepté de conserver la base de données hors ligne (demandé lors de la mise en attente de la première écriture ; `false` signifie qu'elle peut être évincée en cas de pression sur le stockage, écritures non envoyées comprises). `unverifiedUser` vaut `true` lorsqu'un rechargement hors ligne affiche les données du dernier utilisateur sans session confirmée (voir [`keepLastUser`](#rechargements-hors-ligne-en-mode-cookie)) |
| `onStatusChange(fn)` | S'abonner aux éléments ci-dessus |
| `onQueueChange(fn)` | Uniquement le nombre d'écritures non envoyées, pour un badge |
| `pending()` | Les mutations en attente elles-mêmes, de la plus ancienne à la plus récente. `pending({ orphaned: true })` : celles mises en attente alors que l'utilisateur était déconnecté — voir [Utilisateurs](#utilisateurs) |
| `sync()` | Rejouer maintenant — se résout avec `{ flushed, remaining }` |
| `clear()` | Abandonner les écritures en attente de l'utilisateur actuel **et** les lignes locales. `clear({ orphaned: true })` : celles mises en attente pendant la déconnexion à la place |

Le rejeu s'effectue automatiquement : lorsque le navigateur émet l'événement `online`, lorsque l'utilisateur se connecte, et selon un intervalle exponentiel (une seconde, doublant jusqu'à une minute) tant que des éléments sont en attente. `sync()` est prévu pour un bouton « réessayer maintenant ».

## Quand le serveur dit non

Une écriture en attente peut être rejetée — validation, sécurité au niveau des lignes (row-level security), une ligne supprimée par quelqu'un d'autre. Ces situations ne se résolvent jamais d'elles-mêmes ; le moteur restaure donc les lignes locales dans l'état où elles se trouvaient avant l'écriture, abandonne les modifications en attente qui ont été construites par-dessus, et vous en informe :

```typescript
const client = createRebaseClient({
    baseUrl: API_URL,
    offline: {
        onSyncError: (error, mutation) => {
            toast(`Couldn't save your change to ${mutation.collection}: ${error.message}`);
        }
    }
});
```

Une ligne supprimée par quelqu'un d'autre est le seul cas où aucun rollback n'est effectué. Une suppression (`delete`) mise en file d'attente à son sujet a accompli son objectif, elle est donc considérée comme synchronisée et n'est pas signalée. Une modification en attente à son sujet est signalée, et la ligne est supprimée de la base de données locale au lieu d'être restaurée, car le serveur ne la possède plus.

La cascade est restreinte : une opération `update` est abandonnée en même temps que l'écriture qu'elle modifiait, car elle ne peut échouer que de la même manière. Un `create` ou un `delete` ultérieur pour la même ligne est indépendant et conservé. Un `create` refusé pour une ligne créée hors ligne emporte également avec lui toute écriture en attente, dans n'importe quelle table, dont les valeurs référencent l'identifiant temporaire de cette ligne. Une écriture abandonnée n'a jamais été envoyée. Elle est signalée avec une erreur `RebaseApiError` dont le `code` est `DEPENDENCY_REJECTED` et dont la `cause` est le refus initial qui l'a condamnée, vous permettant ainsi de la distinguer de l'écriture réellement refusée par le serveur.

Les modifications consécutives apportées à une même ligne hors ligne sont fusionnées en une seule écriture en attente, afin que la saisie dans un formulaire ne fasse pas gonfler la file d'attente. Une écriture que la file d'attente a commencé à envoyer n'est pas fusionnée : une modification apportée après une tentative de rejeu dont la réponse a été perdue se met en file d'attente comme une mise à jour distincte, et la suppression d'une ligne créée hors ligne est envoyée plutôt qu'annulée face à sa création, étant donné que le serveur peut déjà détenir la ligne. Si le serveur refuse l'écriture fusionnée en raison de son contenu (une erreur 400, 403 ou 422 — par exemple, un champ supprimé par une modification de schéma pendant que l'utilisateur était hors ligne), le moteur la sépare à nouveau en modifications distinctes et rejoue chacune d'elles. Seule la modification que le serveur refuse est annulée et signalée ; les autres sont conservées.

### Conflits

Par défaut, une modification mise en file d'attente hors ligne écrase ce que possède le serveur pour les champs qu'elle modifie, même si quelqu'un d'autre les a modifiés entre-temps. Pour être informé à la place, passez `onConflict`. Un `update` en attente est alors rejoué avec `If-Match`, la version de la ligne sur laquelle il s'est basé, et si la ligne a changé depuis, le serveur le refuse avec un code 412 et `onConflict` prend la décision :

```typescript
const client = createRebaseClient({
    baseUrl: API_URL,
    offline: {
        onConflict: async (error, mutation) =>
            (await askUser(`${mutation.collection} changed while you were offline. Keep your edit?`))
                ? "overwrite"
                : "discard"
    }
});
```

- `"overwrite"` renvoie la modification sans la précondition : le dernier rédacteur l'emporte (last writer wins), tout comme sans `onConflict`.
- `"discard"` abandonne la modification. La ligne revient à son état antérieur, comme lors d'un rejet, et est relue depuis le serveur. Cela n'est pas signalé à `onSyncError` ; les écritures mises en attente par-dessus le sont, sous la forme `DEPENDENCY_REJECTED`.

La file d'attente patiente pendant l'exécution de `onConflict`, ce qui lui permet d'interroger l'utilisateur. Si elle lève une erreur, la modification est écrasée.

La version sur laquelle se base une modification est celle rapportée par la dernière lecture de la ligne : `findById()`, une trame `listenById()`, ou la réponse à un `update()` précédent. Une ligne lue pour la dernière fois dans une liste issue de `find()` ou `listen()` n'a pas de version, tout comme une modification effectuée par-dessus une autre écriture en attente sur la même ligne. Celles-ci sont rejouées sans précondition. Un `ifMatch` que vous transmettez vous-même à `update()` ou `delete()` est conservé lorsque l'écriture est mise en file d'attente, avec ou sans `onConflict`, et `findById()` sur un client avec mode hors ligne activé renvoie la ligne avec sa version, de sorte que `etagOf(row)` fonctionne comme en ligne. Sans `onConflict`, une écriture en attente refusée en raison de votre propre `ifMatch` subit un rollback et est signalée à `onSyncError` avec un code 412 `PRECONDITION_FAILED`.

Une défaillance simplement temporaire — une erreur 429, 503 ou une coupure de connexion — ne constitue pas un rejet. Celles-ci restent en file d'attente et sont réessayées ; ce n'est qu'après `maxRetries` reports qu'une écriture subit un rollback.

## Plusieurs onglets

Les onglets d'une même application partagent une seule base de données IndexedDB, ils partagent donc les lignes locales et la boîte d'envoi (outbox). Une écriture dans l'un apparaît dans les autres, et un seul onglet à la fois rejoue la file d'attente. Rien n'est à configurer.

Cette dernière garantie provient de l'[API Web Locks](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API) du navigateur, qui n'existe que dans un contexte sécurisé (HTTPS ou `localhost`) et n'est pas disponible dans Safari avant la version 15.4 ni dans certaines webviews intégrées. En son absence, chaque onglet ouvert rejoue la file d'attente lors de sa synchronisation. Les créations, écritures en masse, mises à jour et suppressions sont toutes rejouées avec une clé d'idempotence, de sorte qu'un serveur qui enregistre les clés n'applique chacune d'elles qu'une seule fois ; ce que vous pouvez observer est simplement la même écriture envoyée depuis deux onglets.

## Utilisateurs

La base de données locale et la boîte d'envoi sont partitionnées par utilisateur connecté. Les lignes en cache correspondent à ce que la sécurité au niveau des lignes a permis à cet utilisateur de voir, et une écriture en attente doit être rejouée au nom de son auteur — ainsi, se déconnecter puis se reconnecter sous un autre compte ne mélange jamais les deux. La déconnexion n'a besoin de rien effacer.

### Pendant la restauration de la session

Tant que le client ne sait pas qui est connecté, il ne sait pas quelle base de données locale ni quelle boîte d'envoi utiliser, de sorte que les lectures et écritures hors ligne patientent. C'est le temps nécessaire à `auth.isInitialized()` : nul pour une session stockée encore valide, et une requête de rafraîchissement lorsque la session doit être récupérée depuis le serveur — en mode cookie, où rien n'est stocké sur l'appareil, c'est le cas à chaque chargement de page. Une écriture effectuée pendant cette fenêtre est mise en attente au nom de l'identité finale de la session, et une lecture répond depuis sa base de données locale. Une trame en temps réel qui arrive entre-temps est transmise à votre callback telle que le serveur l'a envoyée, et n'est conservée nulle part.

Si la session ne peut pas être restaurée — le rafraîchissement est refusé ou, en mode cookie, ne peut joindre le serveur — le client est déconnecté, et les lectures et écritures hors ligne sont celles de l'utilisateur déconnecté.

### Écritures effectuées en étant déconnecté

Les écritures mises en attente alors que personne n'était connecté ne sont pas rejouées lorsqu'un utilisateur se connecte. Cet utilisateur ne les a pas créées, et les rejouer avec ses identifiants attribuerait les modifications d'une personne au nom d'une autre — sur un appareil partagé, les écritures d'un visiteur se retrouveraient dans le compte de l'utilisateur suivant. Elles ne sont pas non plus déplacées dans la boîte d'envoi de l'utilisateur connecté. Elles sont conservées et répertoriées séparément afin que l'application puisse décider quoi en faire :

```typescript
client.auth.onAuthStateChange(async (event) => {
    if (event !== "SIGNED_IN") return;
    const orphaned = await client.offline!.pending({ orphaned: true });
    if (orphaned.length === 0) return;
    if (await askToKeep(orphaned.length)) {
        // Re-issue each one yourself, now as the signed-in user.
        for (const write of orphaned) await reissue(write);
    }
    await client.offline!.clear({ orphaned: true });
});
```

`clear({ orphaned: true })` les abandonne, ainsi que les lignes locales auxquelles elles ont été appliquées ; la boîte d'envoi de l'utilisateur connecté reste intacte. Si l'application n'en fait rien, elles sont rejouées la prochaine fois que personne n'est connecté. Tant que personne n'est connecté, elles constituent simplement la boîte d'envoi courante, et `pending({ orphaned: true })` ne renvoie rien.

### Rechargements hors ligne en mode cookie

En mode cookie, aucune information sur la session n'est stockée sur l'appareil, de sorte qu'un rechargement qui ne peut joindre le serveur n'a pas d'utilisateur. Par défaut, il est traité comme déconnecté : les lignes locales de l'utilisateur sont masquées, et les écritures effectuées à ce moment-là sont mises en file d'attente au nom de l'utilisateur déconnecté.

`keepLastUser: true` change ce comportement. Le client mémorise le dernier utilisateur connecté sur l'appareil (son identifiant uniquement), et un rechargement hors ligne ouvre la base de données locale de cet utilisateur à la place. Les écritures effectuées à ce moment-là sont mises en file d'attente en son nom, mais aucune n'est rejouée tant que la session n'est pas confirmée : lorsque la connexion revient, le client rafraîchit la session, et une connexion la confirme également. Si le serveur refuse la session, ou si quelqu'un d'autre se connecte, l'appareil change d'utilisateur, et les écritures en attente restent associées à leur auteur jusqu'à ce qu'il se reconnecte. Pendant ce temps, `status().unverifiedUser` est à `true`, et cela s'applique également en ligne : jusqu'à ce que le rafraîchissement réponde, les écritures sont mises en attente plutôt que de partir sans identifiants, et les lectures reçoivent une réponse à partir des lignes locales de l'utilisateur. Ce que le serveur renvoie à une requête sans session correspond à ce qu'un appelant déconnecté peut voir, et n'est donc pas conservé.

```typescript
createRebaseClient({
    baseUrl: API_URL,
    auth: { authFlowMode: "cookie" },
    offline: { keepLastUser: true }
});
```

Cette option est désactivée par défaut car sur un appareil partagé, elle permet de lire hors ligne les lignes en cache de l'utilisateur précédent sans session. Activez-la pour les installations appartenant à une seule personne. L'identifiant est oublié lors de la déconnexion et lorsque le serveur refuse la session. Il n'est jamais utilisé lorsque le serveur répond qu'il n'y a pas de session.

## Configuration

<span class="since-badge" data-since="0.31">Depuis 0.31</span> `maxCachedRowsPerTable` et `maxCachedQueriesPerTable` s'appelaient auparavant `…PerCollection`.

```typescript
createRebaseClient({
    baseUrl: API_URL,
    offline: {
        store: myCustomStore,                 // default: IndexedDB in the browser, memory elsewhere
        maxCachedRowsPerTable: 5000,          // rows with unsent writes are never evicted
        maxCachedQueriesPerTable: 50,         // remembered server page compositions
        syncIntervalMs: 60_000,               // ceiling for the retry backoff; 0 disables auto-retry
        maxRetries: 5,                        // deferrals before a write is given up on
        crossTab: true,                       // default: on for IndexedDB, off for memory
        keepLastUser: false,                  // open the last user's data on an offline reload (cookie mode)
        replayBatchSize: 1,                   // queued creates sent per request on replay (max 1000)
        onConflict: (error, mutation) => "overwrite", // or "discard"; default: no conflict check
        onSyncError: (error, mutation) => {}
    }
});
```

### Un store personnalisé

N'importe quel environnement peut rendre la base de données locale persistante en implémentant `OfflineStore` — une interface clé/valeur cloisonnée comportant une zone de cache de lecture et une zone de file d'attente. C'est ainsi que vous pouvez l'adosser à AsyncStorage dans React Native, ou au système de fichiers dans Electron :

```typescript no-verify
import type { OfflineStore } from "@rebasepro/client";

class AsyncStorageOfflineStore implements OfflineStore {
    // Read cache: getCache, setCache, setCacheMany, deleteCache,
    //             listCache, listCacheEntries
    // Outbox:     enqueue, dequeue, listQueue
    // Both:       clear
}
```

Le seul contrat au-delà des évidences est que les listages par préfixe reviennent dans l'ordre lexicographique des clés — c'est ce qui fait de la boîte d'envoi une file FIFO.

## Limites

Le client n'est pas un réplica de votre base de données, et ne prétend pas l'être :

- **Seules les lignes que l'application a lues ou écrites sont locales.** Une requête que le client n'a jamais envoyée peut toujours recevoir une réponse à partir de ce qu'il détient, mais la réponse peut omettre des lignes que le serveur aurait renvoyées. Les résultats en direct l'indiquent via `partial`.
- **`findAll()` et `iterate()` ne lisent que les pages auxquelles le serveur a répondu sur cet appareil.** Un parcours se poursuit tant que chaque page indique qu'il y a d'autres éléments, et seul le serveur peut l'indiquer. Hors ligne, un parcours nécessitant une page que cet appareil n'a jamais récupérée échoue avec l'erreur `OFFLINE` (`isOfflineError`) au lieu de renvoyer une partie de la table comme s'il s'agissait de l'intégralité.
- **`count()` hors ligne nécessite un décompte que le serveur a fourni à cet appareil pour la même requête.** Les écritures mises en attente depuis lors le font évoluer : les créations, les modifications qui font entrer ou sortir une ligne du filtre, et les suppressions. Sans cela, l'opération échoue avec l'erreur `OFFLINE` plutôt que de compter les lignes que cet appareil détient par hasard.
- **`searchString` est une approximation** effectuée sous la forme d'une recherche insensible à la casse de sous-chaînes sur les champs textuels en cache. Le serveur exécute une véritable recherche plein texte sur les colonnes configurées de la table.
- **Les relations spécifiées dans `include` ne peuvent pas être évaluées localement** — les lignes associées résident dans des tables que la requête n'a jamais chargées. Une telle requête est toujours marquée comme `partial` lorsqu'une réponse est apportée à partir du cache.
- **Les conflits sont résolus selon la règle du dernier rédacteur (last-writer-wins), champ par champ, sauf si vous transmettez `onConflict`.** Un `update` rejoué envoie uniquement les champs modifiés par l'utilisateur et rien d'autre, de sorte que les champs auxquels il n'a pas touché conservent les valeurs du serveur. Pour un champ qu'il a *effectivement* modifié, une modification effectuée par un tiers sur le serveur pendant qu'il était hors ligne est écrasée lors du rejeu de la file d'attente, sans qu'aucun des utilisateurs n'en soit averti. Avec [`onConflict`](#conflits), une modification dont la version de ligne est connue est comparée à celle du serveur, et l'application décide. Les créations, suppressions et écritures en masse ne sont jamais vérifiées.
- **Le rejeu s'effectue au moins une fois (at-least-once).** Une écriture qui atteint le serveur mais dont la réponse est perdue peut être envoyée de nouveau. Privilégiez les écritures idempotentes (`createMany` avec `upsert`) là où les doublons poseraient problème.
- **La corbeille nécessite le serveur.** La base de données locale ne conserve que les lignes actives, ainsi `trash.find()`, `trash.count()`, `trash.restore()` et `trash.purge()` (voir [suppression réversible](/docs/collections/soft-delete#from-the-sdk)) ne reçoivent jamais de réponse locale et ne sont pas mis en file d'attente : hors ligne, ils échouent avec l'erreur `OFFLINE`. Une restauration ou une purge d'une ligne ayant une écriture encore en attente synchronise d'abord la file d'attente, et est refusée avec `TRASH_PENDING_WRITE` si l'écriture ne peut pas encore être envoyée.
- **Un upsert sur une clé naturelle nécessite le serveur.** La détermination de la ligne désignée par une cible `onConflict` incombe au serveur, ainsi un `upsert()` sur une clé naturelle (ou sans l'identifiant de la ligne) et un `createMany()` avec `onConflict` qui n'a jamais été envoyé sont refusés hors ligne avec `OFFLINE_UPSERT_UNSUPPORTED`. Un upsert sur la clé primaire, avec la clé présente dans chaque ligne, est mis en file d'attente.
- **Les lectures locales appliquent la sémantique de Postgres, et non les données de la base de données.** Les filtres sont évalués de la même façon que le ferait le SQL — les comparaisons avec `NULL` sont inconnues, `ORDER BY` place les valeurs nulles en dernier dans l'ordre croissant et départage les ex-æquo restants sur l'identifiant de ligne par ordre décroissant, exactement comme le fait le serveur — mais sur la copie des lignes détenue par le client, qui peut être obsolète.
- **Un tri que le client ne peut pas reproduire n'est pas appliqué.** Le tri de chaînes de caractères incombe au serveur : PostgreSQL les trie selon le collationnement de la *base de données*, qui n'a jamais été communiqué à ce processus, et sous la collation C, `Banana` se classe avant `apple`, alors qu'un comparateur JavaScript indique le contraire. Lorsqu'une colonne de tri ne peut pas être comparée numériquement, les lignes conservent l'ordre renvoyé par le serveur, et le résultat est marqué comme `partial` plutôt que d'être présenté sous la forme de la page triée demandée. Chaque clé d'un tri multicolonne doit être reproductible, pas seulement la première — un tri sur lequel le côté local ne peut concorder que jusqu'à sa deuxième colonne est un tri avec lequel il n'est pas en accord.

## Recette : un indicateur hors ligne

```tsx
import React from "react";
import type { CreateRebaseClientResult } from "@rebasepro/client";

export function SyncIndicator({ client }: { client: CreateRebaseClientResult }) {
    const offline = client.offline!;
    const [status, setStatus] = React.useState(offline.status());
    React.useEffect(() => offline.onStatusChange(setStatus), [offline]);

    if (!status.online) {
        return <span className="badge warning">
            Offline{status.pending ? ` · ${status.pending} unsaved` : ""}
        </span>;
    }
    if (status.syncing) return <span className="badge">Syncing…</span>;
    if (status.pending) return <span className="badge">{status.pending} unsaved</span>;
    return null;
}
```

## Voir aussi

- [Interroger les données](/docs/sdk/querying) — la surface d'interrogation que `observe()` partage avec `find()`
- [Abonnements temps réel](/docs/sdk/realtime) — mises à jour poussées par le serveur, sur lesquelles reposent les requêtes en direct
