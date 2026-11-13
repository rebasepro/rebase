---
sourceHash: aaaaecaefd6bb6c4
title: L'API context.data
sidebar_label: API context.data
description: Lisez et écrivez dans d'autres tables depuis un hook de table avec context.data — ses méthodes, les privilèges avec lesquels il s'exécute, la sémantique des transactions et la connexion maintenue par un hook.
---

Chaque [hook de table](/docs/collections/callbacks/) reçoit un objet `context` qui inclut `context.data` : la couche de données permettant de lire et d'écrire dans **d'autres tables** depuis l'intérieur du hook.

## Accéder aux tables

`context.data` utilise un Proxy JavaScript, vous pouvez donc accéder à n'importe quelle table via son slug sous forme de propriété :

```typescript
afterSave: async ({ values, id, context }) => {
    // Dynamic property access — works for any table slug
    const jobs = context.data.jobs;
    const users = context.data.users;

    // Alternatively, use the .table() method for dynamic slugs
    const slug = "jobs";
    const accessor = context.data.table(slug);
}
```

Une propriété est l'accesseur de la table, le nom que le SDK généré lui attribue : `context.data.myNotes` correspond à la table dont le slug est `my-notes`, quelle que soit la table SQL dans laquelle elle est stockée. Un nom qui ne correspond à aucun accesseur de table est interprété en snake_case, ainsi `context.data.auditLog` devient `audit_log`.

Les lignes ne sont pas typées (`Record<string, unknown>`) jusqu'à ce que le projet enregistre sa `Database` générée ; dès lors, chaque accesseur est typé à partir de celle-ci. Voir [Données typées côté serveur](/docs/backend/typed-server-data).

## Méthodes disponibles

Chaque accesseur de table (`context.data.<slug>`) fournit ces méthodes :

| Method | Signature | Description |
|--------|-----------|-------------|
| `.find()` | `find(params?: FindParams) → FindResult` | Interroger des lignes avec filtres, tri et pagination |
| `.findById()` | `findById(id: string \| number) → Row \| undefined` | Récupérer une seule ligne par son ID |
| `.create()` | `create(data: Insert, id?: string \| number) → Row` | Créer une nouvelle ligne et la renvoyer telle qu'elle a été enregistrée |
| `.update()` | `update(id: string \| number, data: Update) → Row` | Mettre à jour une ligne existante et la renvoyer telle qu'elle a été enregistrée |
| `.delete()` | `delete(id: string \| number) → void` | Supprimer un enregistrement |
| `.count()` | `count(params?: FindParams) → number` | Compter les lignes correspondantes |
| `.listen()` | `listen(params, onUpdate, onError?) → unsubscribe` | Abonnement en temps réel (si pris en charge) |
| `.listenById()` | `listenById(id, onUpdate, onError?) → unsubscribe` | Écouter une seule ligne |
| `.trash` | `trash.find()`, `.count()`, `.restore(id)`, `.restoreMany(ids)`, `.purge(id)`, `.purgeMany(ids)` | Les lignes marquées par une [suppression réversible (soft delete)](/docs/collections/soft-delete#from-the-sdk) |

### Limites connues in-process

La même surface via HTTP (`@rebasepro/client`) réalise certaines choses que celle in-process (`context.data`, `rebase.data`, `rebase.dataAsAdmin`) ne fait pas. Rien de tout cela n'est nouveau dans la version 0.31 :

- Une ligne in-process ne comporte aucun `_matches` de recherche ni aucune version : `etagOf(row)` vaut `undefined`, passez donc `ifMatch` à partir d'une ligne lue via HTTP.
- `listenCount()` n'est pas disponible in-process : elle lève l'erreur « Realtime is not available ».
- Le raccourci de table `.search(text)` n'accepte pas `{ explain }` (celui du query builder l'accepte, mais in-process, il n'y a aucun `_matches` à retourner).

## Interroger avec `.find()`

La méthode `find()` filtre à l'aide de tuples `[opérateur, valeur]` — la forme typée de la chaîne de requête `?status=eq.published` lue par l'API REST :

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

## Créer des lignes

`.create()` et `.update()` prennent les valeurs à écrire, selon les signatures ci-dessus.
[Écrire dans d'autres tables](/docs/collections/callbacks/#writing-to-other-tables) utilise les deux : une soumission approuvée crée une offre d'emploi publiée et lui est reliée.

## Sécurité : avec quels privilèges `context.data` s'exécute

:::important
**`context.data` hérite des privilèges de ce qui a déclenché le hook.** Il ne s'agit pas d'un niveau de confiance fixe.

- Déclenché par une **requête utilisateur** (REST, temps réel, modification dans le CMS) → **portée utilisateur (user-scoped)**. Le hook s'exécute au sein de la transaction soumise au RLS ouverte pour cette requête, les politiques s'appliquent donc aux lectures *et* aux écritures. Un hook ne peut pas voir une ligne que son appelant ne pourrait pas voir.
- Déclenché par **`rebase.dataAsAdmin` ou une tâche cron** (le même singleton) → **portée administrateur (admin-scoped)**, et non sans portée (unscoped). Ce pilote est délimité en tant que `{ uid: "service", roles: ["admin"] }`, le hook s'exécute donc toujours sur une transaction liée au RLS — vos politiques sont évaluées par rapport à cette identité.
- Déclenché par **le pilote de base** (flux d'authentification intégrés, migrations) → **sans portée (unscoped)**. Il s'exécute sur la connexion propriétaire et contourne le RLS.
:::

Cela a surtout de l'importance dans le cas où l'échec est silencieux. Le RLS *filtre*, il ne lève pas d'exception — ainsi, un hook qui lit une ligne parente ou liée la trouvera lorsqu'une tâche d'administration effectue une sauvegarde, mais pourra ne rien trouver lorsqu'un utilisateur final sauvegarde, sans qu'aucune erreur ne soit générée dans les deux cas. Écrivez des hooks qui tolèrent un résultat vide, ou accédez délibérément au plan administrateur :

```typescript
afterSave: async ({ context }) => {
    // User-scoped when a user triggered this save: RLS applies.
    await context.data.audit_logs.create({ action: "approved" });

    // Deliberately admin-scoped — for work the caller genuinely may not see,
    // such as an audit trail they must not be able to read or edit. Note this
    // is an admin's reach, not a bypass: a table whose only rule is
    // `policy.serverContext()` stays closed to it, since that compiles to
    // `rebase.uid() IS NULL` and this accessor's uid is `service`.
    // `dataAsAdmin` is always there server-side; its type allows for the
    // browser SDK, which has none — hence the `!`.
    await context.client.dataAsAdmin!.audit_logs.create({ action: "approved" });
}
```

:::caution[`dataAsAdmin` est une seconde connexion, ne faisant pas partie de cette écriture]
`context.client.dataAsAdmin` au sein du hook d'une requête s'exécute dans sa propre transaction, sur une autre connexion du pool, pendant que la transaction de l'écriture déclenchante est toujours ouverte. Elle effectue donc son commit de manière autonome, et persiste même si l'écriture est annulée (rollback). Elle ne peut pas non plus voir la ligne en cours de sauvegarde, qui n'est pas encore validée (committed), et ne doit pas y écrire :

- Une écriture administrateur avec une clé étrangère référençant cette ligne (un champ `audit_logs.article_id` faisant référence à `articles`) échouera lors de la vérification de contrainte de clé, et l'écriture de l'appelant échouera avec elle.
- Une écriture administrateur sur la ligne en cours de sauvegarde, ou sur toute ligne verrouillée par cette écriture, attend le verrou de l'écriture pendant que l'écriture attend le hook. Postgres ne peut pas détecter cela comme un interblocage (deadlock), la requête reste donc suspendue jusqu'à l'expiration de `statement_timeout` (30 secondes par défaut), puis échoue.

Pour un enregistrement qui doit faire référence à la ligne, écrivez-le avec `context.data`, qui s'exécute au sein de la transaction de l'écriture, ou mettez en file d'attente un [job](/docs/backend/jobs) : un job mis en file d'attente depuis le hook est validé (commit) avec l'écriture, et son gestionnaire s'exécute après le commit.
:::

:::caution[Cette page indiquait auparavant le contraire]
Les versions précédentes de cette page indiquaient que les hooks (alors appelés callbacks) contournaient toujours le RLS et disposaient d'un « accès complet à la base de données sans tenir compte des autorisations de l'utilisateur déclencheur ». C'était incorrect, et trompeur sur le plan de la sécurité — cela incitait à écrire des hooks en partant du principe qu'ils pouvaient toujours tout voir.

Le comportement décrit ci-dessus est vérifié de bout en bout avec Postgres par le cas de test `"scopes context.data to the caller when a callback runs on a user request"` dans la suite de tests d'application du RLS de `@rebasepro/server-postgres`.
:::

## Sémantique des transactions

:::important
**Les écritures `context.data` d'un hook font partie intégrante de l'écriture qui l'a déclenché.** `beforeSave`, la sauvegarde et `afterSave` — ou `beforeDelete`, la suppression et `afterDelete` — s'exécutent au sein d'une seule transaction, chaque hook étant attendu avant le commit, et `context.data` écrit via cette même transaction.
:::

Ainsi, l'écriture déclenchante et tout ce que ses hooks ont écrit sont validés ensemble ou pas du tout :

- Une exception levée depuis `afterSave` ou `afterDelete` annule (rollback) l'écriture déclenchante, ainsi que toutes les écritures `context.data` effectuées par les hooks. L'appelant reçoit la réponse **400 `CALLBACK_REJECTED`** avec `details.stage` indiquant le nom du hook — ou avec le code d'état propre à l'erreur lorsqu'elle en possède un : une `RebaseApiError` que vous avez levée, ou le code 409 en cas de violation d'unicité.
- Les abonnés temps réel ne sont informés de la ligne qu'après le commit, de sorte qu'une écriture annulée n'est jamais annoncée.
- Un hook maintient la transaction ouverte pendant son exécution ; un hook lent maintient donc un verrou et monopolise une connexion du pool — `beforeSave` et `beforeDelete` tout autant que les hooks `after`. Voir [A hook holds a connection](#a-hook-holds-a-connection).
- Une écriture `context.data` exécute également les hooks de la table cible, si bien qu'un `afterSave` mettant à jour sa propre ligne se réexécute lui-même. Les écritures imbriquées sur plus de 16 niveaux sont refusées avec l'erreur **500 `CALLBACK_RECURSION`**, nommant le hook et la table, et l'écriture entière est annulée (rollback). Rendez une telle écriture conditionnelle, comme le montre l'exemple ci-dessous.

Laissez une exception être levée lorsqu'un échec ne doit pas permettre à l'écriture déclenchante de subsister. Interceptez-la lorsqu'elle le doit, mais uniquement autour d'une **écriture** `context.data` : une création, une mise à jour ou une suppression refusée par la base de données (violation de contrainte d'unicité ou de clé étrangère, déclencheur) est annulée isolément, et le reste est validé (commit).

Toute autre instruction qui échoue sur la transaction de l'écriture — une recherche, la lecture effectuée par un update ou un delete pour trouver sa ligne (un id que la colonne de clé ne peut pas contenir), une mise en file d'attente de job refusée par la base de données — interrompt cette transaction dans Postgres, et intercepter l'erreur en JavaScript n'annule pas cet état. L'écriture est refusée avec l'erreur **500 `TRANSACTION_ABORTED`** et rien n'est enregistré, plutôt que de renvoyer un succès pour une écriture qui a été annulée. Laissez une telle erreur se propager ou vérifiez la condition avant d'exécuter l'instruction.

```typescript
afterSave: async ({ values, id, status, context }) => {
    // The update below saves this table again, which runs this hook
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

Le travail qui doit sortir de la base de données — un e-mail, un webhook, un appel à une API tierce — n'a pas sa place dans le corps du hook. Cela maintiendrait la transaction ouverte le temps d'un aller-retour réseau, et rien ne pourra l'annuler en cas de rollback de l'écriture. Mettez en file d'attente un [job](/docs/backend/jobs) pour cela, ou effectuez-le une fois que l'écriture a retourné son résultat : publiez sur un [canal temps réel](/docs/backend/realtime), ou utilisez `waitUntil` dans une [fonction personnalisée](/docs/backend/custom-functions). La page [Hooks](/docs/backend/hooks#side-effects-that-must-not-hold-the-transaction) détaille la solution adaptée à chaque cas.

## A hook holds a connection

Une écriture s'exécute sur une connexion empruntée au pool de la base de données, et chaque hook s'exécute dessus : `beforeSave` et `beforeDelete` après le début de la transaction, `afterSave` et `afterDelete` avant son commit. Tant qu'un hook s'exécute — en attendant une recherche, un calcul ou quoi que ce soit d'autre —, cette connexion ne sert à rien d'autre, et les verrous posés par l'écriture restent actifs : dans `afterSave`, la ligne qui vient d'être écrite ; dans une écriture en bloc (bulk) ou [`_batch`](/docs/backend/writes/#cross-table-batches), chaque ligne écrite par la transaction avant celle-ci.

Le coût correspond à la durée d'exécution du hook lui-même, et les écritures concurrentes les cumulent :

- Le pool contient 20 connexions par défaut (`DB_POOL_MAX`). 25 sauvegardes simultanées dont le `beforeSave` attendait 300 ms ont fait durer une lecture non liée d'une seule ligne 290 ms, la quasi-totalité de ce temps étant passée à attendre une connexion.
- Une création en bloc de 100 lignes dont le `beforeSave` attend 50 ms correspond à une transaction ouverte pendant 5,3 s, mobilisant sa connexion et les verrous de chaque ligne écrite jusqu'alors pendant toute cette durée.

Ainsi :

- Éloignez tout traitement lent des hooks. Un appel à un autre service a sa place dans un [job](/docs/backend/jobs), ou après le retour de l'écriture.
- Récupérez ce dont un hook a besoin avant l'écriture lorsque c'est possible — côté client ou dans une [fonction personnalisée](/docs/backend/custom-functions) qui procède ensuite à l'écriture.
- Envoyez les lignes dont les hooks sont lents par lots plus petits.
- Si de nombreux hooks lents doivent s'exécuter simultanément par conception, augmentez `DB_POOL_MAX`, dans la limite de ce que `max_connections` de la base de données autorise pour chaque instance.
- Avec `REBASE_METRICS=true`, `/metrics` rapporte `rebase_db_pool_wait_ms` : le temps d'attente de chaque requête pour obtenir une connexion. Un pool sain maintient cette valeur proche de zéro ; une traîne qui augmente avec le trafic indique des requêtes faisant la queue pour des connexions monopolisées par des hooks. Voir [Metrics](/docs/deployment/self-hosting/#metrics).
