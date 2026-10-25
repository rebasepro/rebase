---
sourceHash: d672b029e72aca9e
title: L'API context.data
sidebar_label: API context.data
description: Lisez et écrivez d'autres collections depuis un callback avec context.data — ses méthodes, les privilèges avec lesquels il s'exécute, la sémantique transactionnelle et la connexion qu'un callback retient.
---

Chaque callback reçoit un objet `context` qui inclut `context.data` — une couche d'accès aux données unifiée pour effectuer des **opérations inter-collections** depuis les hooks de cycle de vie.

## Accéder aux collections

`context.data` utilise un Proxy JavaScript, vous pouvez donc accéder à n'importe quelle collection via son slug en tant que propriété :

```typescript
afterSave: async ({ values, id, context }) => {
    // Dynamic property access — works for any collection slug
    const jobs = context.data.jobs;
    const users = context.data.users;

    // Alternatively, use the .collection() method for dynamic slugs
    const collectionName = "jobs";
    const accessor = context.data.collection(collectionName);
}
```

Une propriété est l'accesseur de la collection, le nom que lui donne le SDK généré : `context.data.myNotes` est la collection `my-notes`, quelle que soit la table où elle est stockée. Un nom qui n'est l'accesseur d'aucune collection est lu en snake_case, si bien que `context.data.auditLog` est `audit_log`.

Les lignes ne sont pas typées (`Record<string, unknown>`) tant que le projet n'a pas enregistré sa `Database` générée ; chaque accesseur est alors typé à partir d'elle. Voir [Données côté serveur typées](/docs/backend/typed-server-data).

## Méthodes disponibles

Chaque accesseur de collection (`context.data.<slug>`) fournit ces méthodes :

| Méthode | Signature | Description |
|---|---|---|
| `.find()` | `find(params?: FindParams) → FindResult` | Interroger les entités avec des filtres, du tri et de la pagination |
| `.findById()` | `findById(id: string \| number) → Row \| undefined` | Récupérer une ligne unique par son ID |
| `.create()` | `create(data: Insert, id?: string \| number) → Row` | Créer une nouvelle ligne, et la renvoyer telle qu'elle est stockée |
| `.update()` | `update(id: string \| number, data: Update) → Row` | Mettre à jour une ligne existante, et la renvoyer telle qu'elle est stockée |
| `.delete()` | `delete(id: string \| number) → void` | Supprimer un enregistrement |
| `.count()` | `count(params?: FindParams) → number` | Compter les entités correspondantes |
| `.listen()` | `listen(params, onUpdate, onError?) → unsubscribe` | Abonnement en temps réel (si pris en charge) |
| `.listenById()` | `listenById(id, onUpdate, onError?) → unsubscribe` | Écouter une entité unique |
| `.trash` | `trash.find()`, `.count()`, `.restore(id)`, `.restoreMany(ids)`, `.purge(id)`, `.purgeMany(ids)` | Les lignes qu'une [suppression logique](/docs/collections/soft-delete#from-the-sdk) a marquées |

## Interroger avec `.find()`

La méthode `find()` filtre avec des tuples `[operator, value]` — la forme typée de la chaîne de requête `?status=eq.published` que l'API REST lit :

```typescript
afterSave: async ({ values, context }) => {
    // Equality
    const { data: activeJobs } = await context.data.jobs.find({
        where: { status: ["==", "published"] },
        limit: 10,
        orderBy: ["createdAt", "desc"]
    });

    // Several conditions, AND-ed
    const { data: expensiveJobs } = await context.data.jobs.find({
        where: {
            salary: [">=", 100000],
            role: ["in", ["admin", "manager"]]
        }
    });
}
```

## Créer des entités

`.create()` et `.update()` prennent les valeurs à écrire, avec les signatures ci-dessus. [Synchroniser des données entre collections](/docs/collections/callbacks#syncing-data-between-collections) utilise les deux : une soumission approuvée crée une offre publiée et est reliée à celle-ci en retour.

## Sécurité : avec quels privilèges `context.data` s'exécute-t-il

:::important
**`context.data` hérite des privilèges de ce qui a déclenché le callback.** Il ne s'agit pas d'un niveau de confiance fixe.

- Déclenché par une **requête utilisateur** (REST, temps réel, modification dans le panneau d'administration) → **portée utilisateur (user-scoped)**. Le callback s'exécute dans la transaction soumise à RLS ouverte pour cette requête, les politiques s'appliquent donc aux lectures *et* aux écritures. Un callback ne peut pas voir une ligne que son appelant ne pourrait pas voir.
- Déclenché par **`rebase.dataAsAdmin` ou une tâche cron** (le même singleton) → **portée administrateur (admin-scoped)**, et non sans portée. Ce pilote a pour portée `{ uid: "service", roles: ["admin"] }`, le callback s'exécute donc toujours sur une transaction soumise à RLS — vos politiques sont évaluées par rapport à cette identité.
- Déclenché par **le pilote de base** (flux d'authentification intégrés, migrations) → **sans portée (unscoped)**. Il s'exécute sur la connexion propriétaire et contourne RLS.
:::

Cela a le plus d'importance dans la direction où les échecs sont silencieux. RLS *filtre*, il ne lève pas d'erreur — ainsi, un callback qui lit une ligne sœur la trouvera lorsqu'une tâche d'administration enregistre, et pourra ne rien trouver lorsqu'un utilisateur final enregistre, sans qu'aucune erreur ne soit générée dans les deux cas. Écrivez des callbacks qui tolèrent un résultat vide, ou accédez délibérément au plan d'administration :

```typescript
afterSave: async ({ context }) => {
    // User-scoped when a user triggered this save: RLS applies.
    await context.data.audit_logs.create({ action: "approved" });

    // Deliberately admin-scoped — for work the caller genuinely may not see,
    // such as an audit trail they must not be able to read or edit. Note this
    // is an admin's reach, not a bypass: a collection whose only rule is
    // `policy.serverContext()` stays closed to it, since that compiles to
    // `rebase.uid() IS NULL` and this accessor's uid is `service`.
    // `dataAsAdmin` is always there server-side; its type allows for the
    // browser SDK, which has none — hence the `!`.
    await context.client.dataAsAdmin!.audit_logs.create({ action: "approved" });
}
```

:::caution[`dataAsAdmin` est une seconde connexion, pas une partie de cette écriture]
Sur Postgres, `context.client.dataAsAdmin` dans le callback d'une requête s'exécute dans une transaction qui lui est propre, sur une autre connexion du pool, alors que la transaction de l'écriture déclencheuse est encore ouverte. Il est donc validé (commit) de son côté, et subsiste si l'écriture est annulée (rollback). Il ne peut pas non plus voir la ligne en cours d'enregistrement, qui n'est pas encore validée, et ne doit pas l'écrire :

- Une écriture administrateur dotée d'une clé étrangère pointant vers cette ligne (un `audit_logs.article_id` qui référence `articles`) échoue à la vérification de sa clé, et l'écriture de l'appelant échoue avec elle.
- Une écriture administrateur sur la ligne en cours d'enregistrement, ou sur toute ligne verrouillée par cette écriture, attend le verrou de l'écriture pendant que l'écriture attend le callback. Postgres ne peut pas détecter cela comme un interblocage (deadlock), de sorte que la requête reste bloquée jusqu'à `statement_timeout` (30 secondes par défaut), puis échoue.

Pour un enregistrement qui doit référencer la ligne, écrivez-le avec `context.data`, qui passe par la transaction de l'écriture, ou mettez en file d'attente un [job](/docs/backend/jobs) : un job mis en file d'attente depuis le callback est validé avec l'écriture, et son gestionnaire s'exécute après le commit.
:::

:::caution[Cette page indiquait auparavant le contraire]
Les versions précédentes de cette page indiquaient que les callbacks contournaient toujours RLS et disposaient d'un « accès complet à la base de données indépendamment des permissions de l'utilisateur déclencheur ». C'était incorrect, et incorrect dans le sens le moins sûr — cela incitait à écrire des callbacks en partant du principe qu'ils pouvaient toujours tout voir.

Le comportement ci-dessus est vérifié de bout en bout sur Postgres par le cas de test `"scopes context.data to the caller when a callback runs on a user request"` dans la suite de tests d'application de RLS de `@rebasepro/server-postgres`.
:::

## Sémantique des transactions

:::important
**Les écritures `context.data` d'un callback font partie intégrante de l'écriture qui l'a déclenché.** Sur Postgres, `beforeSave`, l'enregistrement et `afterSave` — ou `beforeDelete`, la suppression et `afterDelete` — s'exécutent au sein d'une seule et même transaction, chaque callback étant attendu (`await`) avant le commit, et `context.data` écrivant à travers cette même transaction.
:::

Ainsi, l'écriture déclencheuse et tout ce que ses callbacks ont écrit sont validés ensemble (commit) ou pas du tout :

- Une exception levée depuis `afterSave` ou `afterDelete` annule (rollback) l'écriture déclencheuse ainsi que chaque écriture `context.data` effectuée par les callbacks. L'appelant reçoit la réponse **400 `CALLBACK_REJECTED`** avec `details.stage` indiquant le nom du hook — ou avec le propre statut de l'erreur lorsqu'elle en comporte un : une `RebaseApiError` que vous avez levée, un 409 de violation d'unicité.
- Les abonnés en temps réel ne sont informés de la ligne qu'après le commit, de sorte qu'une écriture annulée n'est jamais annoncée.
- Un callback maintient la transaction ouverte pendant son exécution, donc un callback lent équivaut à un verrou maintenu et une connexion du pool monopolisée — `beforeSave` et `beforeDelete` autant que les hooks `after`. Voir [Un callback retient une connexion](#un-callback-retient-une-connexion).
- Une écriture `context.data` exécute aussi les callbacks de la collection ciblée, donc un `afterSave` qui met à jour sa propre ligne se redéclenche lui-même. Les écritures imbriquées sur plus de 16 niveaux sont refusées avec **500 `CALLBACK_RECURSION`**, qui nomme le hook et la collection, et l'écriture entière est annulée (rollback). Rendez une telle écriture conditionnelle, comme le fait l'exemple ci-dessous.

Laissez une défaillance lever une exception lorsque l'écriture déclencheuse ne doit pas lui survivre. Interceptez-la lorsqu'elle le doit, mais uniquement autour d'une **écriture** `context.data` : une création, une mise à jour ou une suppression que la base de données refuse (violation d'unicité ou de clé étrangère, déclencheur) est annulée isolément, et le reste est validé.

Toute autre instruction qui échoue dans la transaction de l'écriture — une recherche, la lecture qu'une mise à jour ou une suppression effectue pour trouver sa ligne (un id que la colonne de clé ne peut pas contenir), une mise en file d'attente de job refusée par la base de données — interrompt cette transaction dans Postgres, et intercepter l'erreur en JavaScript n'y change rien. L'écriture est refusée avec **500 `TRANSACTION_ABORTED`** et rien n'est enregistré, plutôt que de répondre par un succès pour une écriture qui a été annulée. Laissez un tel échec lever une exception, ou vérifiez la condition avant d'exécuter l'instruction.

```typescript
afterSave: async ({ values, id, status, context }) => {
    // The update below saves this collection again, which runs this callback
    // again: act on creates only, or it never stops.
    if (status !== "new") return;
    try {
        await context.data.jobs.create({ title: values.title, status: "published" });
    } catch (error) {
        // Only the failed create is undone. The submission and this marker commit.
        await context.data.job_submissions.update(id, {
            promotion_status: "failed",
            promotion_error: String(error)
        });
    }
}
```

Tout traitement qui doit sortir de la base de données — un e-mail, un webhook, un appel à une API tierce — n'a pas sa place dans le corps d'un callback. Cela maintiendrait la transaction ouverte le temps d'un aller-retour réseau, et rien ne pourra l'annuler si l'écriture fait l'objet d'un rollback. Mettez en file d'attente un [job](/docs/backend/jobs) pour cela, ou réalisez-le après le retour de l'écriture : publiez sur un [canal temps réel](/docs/backend/realtime), ou utilisez `waitUntil` dans une [fonction personnalisée](/docs/backend/custom-functions). [Hooks](/docs/backend/hooks#side-effects-that-must-not-hold-the-transaction) détaille l'option la plus adaptée.

Sur MongoDB, rien de tout cela ne s'applique. Ce pilote exécute les mêmes callbacks sans transaction, de sorte que l'écriture est déjà enregistrée lorsque `afterSave` s'exécute, et une exception à cet endroit signale l'échec sans l'annuler.

## Un callback retient une connexion

Sur Postgres, une écriture s'exécute sur une connexion prélevée dans le pool de la base de données, et
chaque callback s'exécute dessus : `beforeSave` et `beforeDelete` après le début de la transaction,
`afterSave` et `afterDelete` avant son commit. Tant qu'un callback s'exécute — qu'il attende une
recherche, un calcul, n'importe quoi — cette connexion ne sert rien d'autre, et les verrous que l'écriture
a pris restent pris : dans `afterSave`, la ligne qui vient d'être écrite ; dans une écriture en masse ou
[`_batch`](/docs/backend/writes/#cross-collection-batches), chaque ligne que la transaction a écrite
auparavant.

Le coût est la durée propre du callback, et les écritures concurrentes s'additionnent :

- Le pool contient 20 connexions par défaut (`DB_POOL_MAX`). 25 enregistrements simultanés dont le
  `beforeSave` attendait 300 ms ont fait qu'une lecture d'une seule ligne sans rapport a pris 290 ms,
  presque entièrement passées à attendre une connexion.
- Une création en masse de 100 lignes dont le `beforeSave` attend 50 ms est une transaction ouverte
  pendant 5,3 s, qui retient sa connexion et les verrous de chaque ligne déjà écrite pendant tout ce temps.

Donc :

- Gardez tout ce qui est lent hors des callbacks. Un appel à un autre service a sa place dans un
  [job](/docs/backend/jobs), ou après le retour de l'écriture.
- Recherchez ce dont un hook a besoin avant l'écriture quand vous le pouvez — dans le client, ou dans une
  [fonction personnalisée](/docs/backend/custom-functions) qui écrit ensuite.
- Envoyez les lignes dont les hooks sont lents en lots plus petits.
- Si de nombreux hooks lents s'exécutent en même temps par conception, augmentez `DB_POOL_MAX`, dans la
  limite de ce que le `max_connections` de la base de données autorise pour chaque instance.
- Avec `REBASE_METRICS=true`, `/metrics` expose `rebase_db_pool_wait_ms` : le temps
  qu'a attendu chaque requête pour obtenir une connexion. Un pool sain le maintient près de zéro ; une
  traîne qui grandit avec le trafic correspond à des requêtes en file d'attente pour des connexions que
  des callbacks retiennent. Voir [Métriques](/docs/deployment/self-hosting/#metrics).
