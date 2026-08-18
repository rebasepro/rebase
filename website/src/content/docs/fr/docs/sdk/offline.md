---
title: Hors ligne et synchronisation local-first
sidebar_label: Hors ligne
description: Activez le moteur de synchronisation local-first du SDK Client de Rebase — une base de données locale de lignes, des écritures hors ligne instantanées avec annulation, et des requêtes en direct réactives.
---

## Vue d'ensemble

La prise en charge du hors ligne transforme la couche de données du SDK en un **moteur de synchronisation local-first**. Au lieu d'un cache qui mémorise des réponses, le client conserve une petite base de données locale de lignes, y répond aux requêtes, et considère le réseau comme ce qui la remplit et finit par accepter vos écritures.

Trois conséquences en découlent :

- **Les lectures survivent à la disparition du réseau.** Une requête que le client peut évaluer localement est évaluée localement — filtres, tri et pagination compris — de sorte qu'une liste continue de s'afficher avec une connexion morte.
- **Les écritures sont décidées localement.** Une écriture effectuée hors ligne s'applique immédiatement, est mise en file d'attente, puis rejouée dans l'ordre au retour de la connexion. Si le serveur la rejette, la modification locale est annulée.
- **Les lectures sont réactives.** `observe()` émet d'abord depuis la base de données locale, puis réémet dès que quoi que ce soit modifie les lignes qu'elle couvre — vos propres écritures, une écriture en file d'attente qui aboutit, une annulation, un autre onglet du navigateur ou un événement temps réel.

C'est désactivé par défaut. Activez-le avec une seule option :

```typescript
const client = createRebaseClient({
    baseUrl: "https://api.example.com",
    offline: true
});
```

Dans le navigateur, tout est persisté dans IndexedDB : un rechargement conserve à la fois les lignes locales et les écritures non envoyées. Ailleurs (Node, tests), le SDK se rabat sur la mémoire ; d'autres environnements d'exécution peuvent fournir leur propre store.

## Ce qui change

Rien dans l'API que vous utilisez déjà ne change de forme. `find()`, `findById()`, `create()`, `update()`, `delete()` et le constructeur de requêtes fluide conservent leurs signatures et leurs types de retour — ils cessent simplement d'échouer quand le réseau échoue.

### Lectures

Une lecture réussie fusionne ses lignes dans la base de données locale et retient quels ids le serveur a renvoyés pour cette requête. Lorsqu'une lecture ne peut pas joindre le serveur, elle reçoit une réponse locale :

```typescript
const drafts = await client.data.posts
    .where("status", "==", "draft")
    .orderBy("updatedAt", "desc")
    .find();
```

Hors ligne, cela filtre et trie les lignes que le client détient. Cela inclut les lignes récupérées par *d'autres* requêtes — la base de données est normalisée, donc une ligne n'est stockée qu'une seule fois, quel que soit le nombre de listes où elle est apparue — ainsi que les lignes que vous avez créées hors ligne.

S'il n'y a véritablement rien pour répondre (une collection que l'application n'a jamais lue), la lecture lève une erreur reconnaissable plutôt qu'un simple `TypeError` :

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

Tant que la connexion est connue comme coupée, une écriture n'est même pas tentée — elle s'applique localement et se met en file d'attente, ce qui ne coûte rien au lieu d'un délai d'attente expiré :

```typescript
// Returns immediately, offline or not.
const post = await client.data.posts.create({ title: "Draft", status: "draft" });

// Shows up in every matching list, right away.
const drafts = await client.data.posts.where("status", "==", "draft").find();
```

Les lignes créées hors ligne reçoivent un id généré par le client. Si le serveur attribue le sien au moment du rejeu, la ligne locale et toutes les écritures en file d'attente qui pointent encore vers l'id temporaire sont basculées vers l'id réel.

Les écritures sont rejouées dans l'ordre où vous les avez faites, toutes collections confondues — ainsi une création dans une collection arrive toujours avant la ligne d'une autre collection qui la référence.

## Requêtes en direct

`observe()` est la lecture réactive, et celle vers laquelle se tourner dans une interface :

```typescript
const unsubscribe = client.data.posts.observe(
    { where: { status: ["==", "draft"] }, orderBy: ["updatedAt", "desc"] },
    (result) => {
        render(result.data);
        setBadge(result.hasPendingWrites ? "saving…" : null);
    }
);
```

La première émission provient de la base de données locale, sans requête intermédiaire ; une revalidation suit en arrière-plan. Ensuite, elle réémet à chaque changement des lignes qu'elle couvre. Les émissions sont dédupliquées — un rafraîchissement qui ne change rien ne rappelle pas le callback — vous pouvez donc afficher directement à partir de là.

Chaque résultat porte ce dont une interface a besoin pour se décrire :

| Champ | Signification |
|-------|---------|
| `data`, `meta` | La même forme que celle renvoyée par `find()` |
| `fromCache` | Les lignes proviennent de la base de données locale, pas d'une requête aboutie |
| `hasPendingWrites` | Au moins une ligne ici porte une écriture que le serveur n'a pas acceptée |
| `partial` | La base de données locale ne détient peut-être pas toutes les lignes correspondantes — à traiter comme un résultat « au mieux » |
| `error` | La dernière revalidation a échoué |

`observeById()` fait de même pour une seule ligne, et passe `undefined` lorsqu'elle est supprimée.

Les deux se lient à l'abonnement temps réel lorsque le client en a un, de sorte que les changements effectués par d'autres utilisateurs arrivent aussi en flux. Passez `{ realtime: false }` pour un abonnement qui ne reflète que l'état local et les rafraîchissements explicites.

Sans `offline` activé, `observe()` existe quand même : il récupère les données une fois et reste en direct grâce au temps réel, les trois indicateurs restant à `false`.

## État de la synchronisation

`client.offline` expose le moteur, à partir duquel se construit un indicateur de synchronisation :

```typescript
const unsubscribe = client.offline!.onStatusChange((status) => {
    setOnline(status.online);
    setPending(status.pending);
    setSyncing(status.syncing);
});

// Or read it once
const { online, pending, syncing, lastSyncedAt, lastError } = client.offline!.status();
```

| Méthode | Rôle |
|--------|---------|
| `status()` | Connectivité actuelle, profondeur de la file d'attente, activité de synchronisation, dernière erreur |
| `onStatusChange(fn)` | S'abonner à ce qui précède |
| `onQueueChange(fn)` | Uniquement le nombre d'écritures non envoyées, pour un badge |
| `pending()` | Les mutations en file d'attente elles-mêmes, les plus anciennes d'abord |
| `sync()` | Rejouer maintenant — résout avec `{ flushed, remaining }` |
| `clear()` | Écarter les écritures en file d'attente **et** les lignes locales de l'utilisateur courant |

Le rejeu se déclenche de lui-même : quand le navigateur émet `online`, quand l'utilisateur se connecte, et selon un backoff exponentiel (une seconde, doublant jusqu'à une minute) tant que quelque chose reste en file d'attente. `sync()` sert à un bouton « réessayer maintenant ».

## Quand le serveur refuse

Une écriture en file d'attente peut être rejetée — validation, sécurité au niveau des lignes, une ligne que quelqu'un d'autre a supprimée. Ces cas ne se résolvent jamais d'eux-mêmes : le moteur ramène donc les lignes locales à leur état d'avant l'écriture, écarte les modifications en file d'attente qui s'appuyaient dessus, et vous prévient :

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

La cascade est étroite : un `update` est écarté en même temps que l'écriture qu'il modifiait, car il ne peut échouer que de la même manière. Un `create` ou un `delete` ultérieur portant sur la même ligne se suffit à lui-même et est conservé.

Un échec simplement temporaire — un 429, un 503, une connexion coupée — n'est pas un rejet. Ces écritures restent en file d'attente et sont réessayées ; ce n'est qu'après `maxRetries` reports qu'une écriture est annulée.

## Onglets multiples

Les onglets d'une même application partagent une seule base IndexedDB : ils partagent donc les lignes locales et la file d'attente d'envoi. Une écriture dans l'un apparaît dans les autres, et un seul onglet à la fois rejoue la file d'attente. Rien à configurer.

## Utilisateurs

La base de données locale et la file d'attente d'envoi sont cloisonnées par utilisateur connecté. Les lignes en cache sont celles que la sécurité au niveau des lignes a laissé voir à cet utilisateur, et une écriture en file d'attente doit être rejouée en tant que son auteur — se déconnecter puis se reconnecter sous une autre identité ne mélange donc jamais les deux. La déconnexion n'a besoin de rien effacer.

## Configuration

```typescript
createRebaseClient({
    baseUrl: API_URL,
    offline: {
        store: myCustomStore,                 // default: IndexedDB in the browser, memory elsewhere
        maxCachedRowsPerCollection: 5000,     // rows with unsent writes are never evicted
        maxCachedQueriesPerCollection: 50,    // remembered server page compositions
        syncIntervalMs: 60_000,               // ceiling for the retry backoff; 0 disables auto-retry
        maxRetries: 5,                        // deferrals before a write is given up on
        crossTab: true,                       // default: on for IndexedDB, off for memory
        onSyncError: (error, mutation) => {}
    }
});
```

### Un store personnalisé

N'importe quel environnement peut persister la base de données locale en implémentant `OfflineStore` — une surface clé/valeur à espaces de noms, avec une zone de cache de lecture et une zone de file d'attente. C'est ainsi que vous l'adossez à AsyncStorage dans React Native, ou au système de fichiers dans Electron :

```typescript no-verify
import type { OfflineStore } from "@rebasepro/client";

class AsyncStorageOfflineStore implements OfflineStore {
    // Read cache: getCache, setCache, setCacheMany, deleteCache,
    //             listCache, listCacheEntries
    // Outbox:     enqueue, dequeue, listQueue
    // Both:       clear
}
```

Le seul contrat au-delà de l'évidence est que les listages par préfixe reviennent dans l'ordre lexicographique des clés — c'est ce qui fait de la file d'attente d'envoi une FIFO.

## Limites

Le client n'est pas une réplique de votre base de données, et il ne prétend pas l'être :

- **Seules les lignes que l'application a lues ou écrites sont locales.** Une requête que le client n'a jamais envoyée peut tout de même trouver réponse dans ce qu'il détient, mais il peut manquer à cette réponse des lignes que le serveur aurait renvoyées. Les résultats en direct le signalent via `partial`.
- **`searchString` est approximé** par un balayage de sous-chaîne insensible à la casse sur les champs texte en cache. Le serveur, lui, exécute une vraie recherche plein texte sur les colonnes configurées de la collection.
- **Les relations passées à `include` ne peuvent pas être évaluées localement** — les lignes liées vivent dans des collections que la requête n'a jamais chargées. Une telle requête est toujours marquée `partial` lorsqu'elle est servie depuis le cache.
- **Le rejeu est « au moins une fois ».** Une écriture qui atteint le serveur mais dont la réponse se perd peut être renvoyée. Préférez des écritures idempotentes (`createMany` avec `upsert`) là où des doublons poseraient problème.
- **Les lectures locales appliquent la sémantique de Postgres, pas les données de la base.** Les filtres sont évalués comme SQL le ferait — les comparaisons avec `NULL` sont inconnues, `ORDER BY` place les valeurs nulles en dernier en ordre croissant — mais sur la copie des lignes détenue par le client, qui peut être obsolète.

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

- [Interroger les données](/docs/sdk/querying) — la surface de requête qu'`observe()` partage avec `find()`
- [Abonnements en temps réel](/docs/sdk/realtime) — les mises à jour poussées par le serveur, sur lesquelles reposent les requêtes en direct
