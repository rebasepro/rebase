---
sourceHash: d08c6bb1dfd3357e
title: Données côté serveur typées
sidebar_label: Données côté serveur typées
description: "Enregistrez votre type Database généré une seule fois, et context.data, rebase.dataAsAdmin ainsi que le rebase reçu par une fonction ou un cron sont typés à partir de celui-ci : lignes, filtres, tris, includes et entrées d'écriture."
---

<span class="since-badge" data-since="0.31">Depuis la version 0.31</span>

Le client navigateur est typé en passant votre `Database` générée à
`createRebaseClient<Database>()` (voir [Génération du SDK typé](/docs/sdk#typed-sdk-generation)).
Les surfaces de données côté serveur ne disposent pas d'un tel appel auquel la transmettre :

- `context.data` dans un [hook de table](/docs/collections/callbacks),
- `rebase.dataAsAdmin` sur le singleton `rebase`,
- le `rebase` transmis à une [fonction personnalisée](/docs/backend/custom-functions) ou à une
  [tâche cron](/docs/backend/cron-jobs).

Vous devez donc indiquer à TypeScript une seule fois, pour l'ensemble du projet, quelle `Database` elles desservent.
Tant que vous ne le faites pas, elles restent non typées : n'importe quelle table sous n'importe quel nom, les lignes sous forme de
`Record<string, unknown>`. Rien ne change pour un projet qui n'enregistre rien.

Il existe deux manières de procéder à l'enregistrement : la `Database` générée, qui est exacte, ou
votre module `backend/schema` lui-même, qui ne nécessite aucune exécution de génération de code.

## Enregistrer la `Database` générée

<span class="since-badge" data-since="0.31">Depuis la version 0.31</span>

```bash
rebase generate-sdk --register
```

En plus du SDK dans `generated/sdk/`, cette commande écrit deux fichiers dans
`backend/generated/` : une copie de `database.types.ts`, et un fichier `register.ts` qui
déclare l'enregistrement :

```ts
import type { Database } from "./database.types";

declare module "@rebasepro/types" {
    interface Register {
        database: Database;
    }
}
```

Ils résident dans `backend/` car c'est le programme dans lequel les hooks, fonctions et
crons qu'ils typent sont compilés, et les types sont copiés aux côtés de
l'enregistrement plutôt qu'importés depuis `generated/sdk/`, qui se trouve en dehors du
`rootDir` du backend. Il s'agit uniquement d'une déclaration : le runtime fonctionne exactement comme
avant. `--register` refuse d'écraser un fichier `register.ts` qu'il n'a pas
écrit lui-même.

Le flag est mémorisé dans `rebase.json`, sous la forme `"registerDatabase": true` sur
l'application backend, de sorte que chaque futur `rebase generate-sdk`, ainsi que `rebase dev` à chaque
modification sous `backend/schema/`, maintient les deux fichiers à jour. Le `.gitignore`
du scaffold ignore les répertoires `generated/`, donc un clone tout juste créé n'aura aucun
des deux fichiers jusqu'à ce qu'une commande les réécrive. `rebase build` (et
`rebase cloud deploy`, qui génère le même bundle) les génère à partir des
tables avant la compilation, de sorte qu'un job CI qui exécute `rebase build` sur un clone
frais compile les hooks typés. Une étape CI qui compile le backend d'une autre manière
(`tsc`, `pnpm build`) nécessite toujours l'exécution préalable de `rebase generate-sdk`, sans quoi les hooks qui
lisent des lignes typées compileront contre le `context.data` non typé et échoueront. Un projet
dépourvu de `rebase.json` continue d'enregistrer tant que
`backend/generated/register.ts` est présent. Pour revenir à des données côté serveur
non typées, retirez `registerDatabase` et supprimez `backend/generated/`.

## Enregistrer le schéma, sans génération de code

<span class="since-badge" data-since="0.31">Depuis la version 0.31</span>

Un projet qui n'a rien généré enregistre plutôt son module de schéma,
et se retrouve directement typé à partir de ses `defineTable` :

```ts
// backend/rebase-env.d.ts
declare module "@rebasepro/types" {
    interface Register {
        tables: typeof import("./schema");
    }
}
```

Chaque export du module qui est une table ou une vue est typé sous son
accesseur (`orderItems` pour `order_items`), avec les types `Row`, `Insert` et `Update`
que le générateur émettrait — exacts pour chaque colonne déclarée. Cela s'avère plus souple sur
les relations, car la cible d'une relation se trouve derrière un thunk non typé : une clé
étrangère dérivée est `string | number`, une ligne incluse est `Record<string, unknown>`,
et un `include` imbriqué n'est pas vérifié. La `Database` générée est exacte pour tous
ces éléments, et prévaut lorsque les deux sont enregistrés. La documentation sur les [Types
inférés](/docs/schema/types/) détaille ce que `DatabaseOf` peut et ne peut pas savoir.

Une seule surface est typée uniquement à partir de la `Database` générée : `context.data` à l'intérieur
des hooks de table de ce même schéma, car typer les hooks d'un schéma à partir de ce même
schéma constitue une référence circulaire que TypeScript refuse.

## Ce qui est typé

<span class="since-badge" data-since="0.31">Depuis la version 0.31</span>

```ts
// backend/schema/orders.ts — un hook
import { defineTable, col } from "@rebasepro/server/schema";

export const orders = defineTable("orders", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        total: col.numeric().notNull(),
    },
    rls: "admin-only",
    hooks: {
        async beforeSave({ context, values }) {
            const { data } = await context.data.customers.find({
                where: { email: ["==", "ada@example.com"] },  // `email` est une colonne de customers
            });
            data[0]?.email;                      // auto-complété depuis le type Row de customers
            return values;
        },
    },
});
```

Une fois la `Database` générée enregistrée, `context.data.customer` (table inexistante)
dans ce hook produit une erreur de type.

```ts
// backend/functions/stats.ts
import { defineFunction } from "@rebasepro/server/functions";

export default defineFunction((app, { rebase }) => {
    app.get("/", async (c) => {
        const { data } = await rebase.dataAsAdmin.orders.find({
            where: { status: ["==", "paid"] },   // `status` et ses valeurs sont vérifiés
        });
        return c.json({ paid: data.length });
    });
});
```

```ts
// backend/crons/cleanup.ts
import { defineCron } from "@rebasepro/server";

export default defineCron({
    name: "Cleanup",
    schedule: "0 3 * * *",
    async handler({ rebase }) {
        // `create` prend le type Insert de la table : les colonnes requises sont obligatoires.
        await rebase.dataAsAdmin.auditLog.create({ action: "cleanup" });
    },
});
```

Chaque accesseur est typé de la même manière que pour le client navigateur : `find`, `findById`
et `listen` renvoient le type `Row` de la table ; `where` et `orderBy` ont pour
clés ses colonnes ; `include` cible ses relations ; `create` prend son type
`Insert` et `update` son `Update`. Les accesseurs utilisent les noms en camelCase provenant du
fichier généré (`order_items` devient `orderItems`).
Le serveur résout ces noms à travers les tables servies, ainsi une table dont
le slug est `my-notes` (stockée dans une table `notes`) devient `context.data.myNotes`.

`table(slug)` avec un slug déclaré par la `Database` est typé de la même façon :
`context.data.table("my-notes")` équivaut à `context.data.myNotes`. Un slug que
vous calculez à l'exécution, ou que le schéma ne déclare pas, obtient le client
non typé.

## Une fonction unique, sans l'enregistrement

`defineFunction` et `defineCron` acceptent également le type comme argument, ce qui prévaut
sur l'enregistrement. Utilisez-le pour typer un seul fichier, ou pour tester les données typées avant
de procéder à l'enregistrement :

```ts
import type { Database } from "../../generated/sdk/database.types";

export default defineFunction<Database>((app, { rebase }) => {
    // rebase.dataAsAdmin est typé à partir de Database ici
});
```

## Fonctions utilitaires qui reçoivent l'objet de données

Une fonction utilitaire recevant `context.data` ou `rebase.dataAsAdmin` nomme le
type enregistré, restant ainsi typée tout en acceptant les deux :

```ts
import type { RebaseSdkData, RegisteredDatabase } from "@rebasepro/types";

export async function paidOrders(data: RebaseSdkData<RegisteredDatabase>) {
    return data.orders.find({ where: { status: ["==", "paid"] } });
}
```

Une fonction d'aide déclarée avec un `RebaseSdkData` simple conserve le type non typé, et un
objet de données typé ne pourra pas lui être assigné. Modifiez le paramètre comme ci-dessus lorsque
vous effectuez l'enregistrement.
