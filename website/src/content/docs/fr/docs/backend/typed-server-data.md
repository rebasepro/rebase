---
sourceHash: e515564ee1857435
title: Données côté serveur typées
sidebar_label: Données côté serveur typées
description: "Enregistrez une fois votre type Database généré, et context.data, rebase.dataAsAdmin et le rebase que reçoit une fonction ou un cron sont typés à partir de lui : lignes, filtres, tris, includes et entrées d'écriture."
---

Le client navigateur est typé en passant votre `Database` générée à
`createRebaseClient<Database>()` (voir [Génération du SDK typé](/docs/sdk#typed-sdk-generation)).
Les surfaces de données côté serveur n'ont pas d'appel équivalent auquel la passer :

- `context.data` dans un [callback de collection](/docs/collections/callbacks),
- `rebase.dataAsAdmin` sur le singleton `rebase`,
- le `rebase` que reçoit une [fonction personnalisée](/docs/backend/custom-functions) ou une
  [tâche cron](/docs/backend/cron-jobs).

Vous indiquez donc à TypeScript, une fois pour tout le projet, quelle `Database` elles servent.
Tant que vous ne le faites pas, elles restent non typées : n'importe quelle collection sous n'importe quel nom, des lignes en
`Record<string, unknown>`. Rien ne change pour un projet qui n'enregistre rien.

## Enregistrer la `Database`

```bash
rebase generate-sdk --register
```

En plus du SDK dans `generated/sdk/`, cela écrit deux fichiers dans
`config/generated/` : une copie de `database.types.ts`, et un `register.ts` qui
déclare l'enregistrement :

```ts
import type { Database } from "./database.types";

declare module "@rebasepro/types" {
    interface Register {
        database: Database;
    }
}
```

Ils vivent dans `config/` parce que vos fichiers de collection sont compilés deux fois, par le
backend (dont le `tsconfig.json` inclut `../config/`) et par le `tsc` propre au package
`config`, et que `config/` est le seul répertoire que les deux lisent. Un
enregistrement placé ailleurs qui importerait `../generated/sdk/` ferait entrer dans la compilation de ce package un fichier
extérieur à `config/`, ce que TypeScript refuse. Un seul enregistrement type donc vos fonctions, vos tâches cron et les callbacks de vos
fichiers de collection, dans les deux compilations. C'est une simple déclaration : le runtime fait
exactement ce qu'il faisait avant.

Le choix est mémorisé dans `rebase.json`, sous la forme `"registerDatabase": true` sur l'application
backend, si bien que chaque `rebase generate-sdk` ultérieur, et `rebase dev` à chaque
changement de collection, maintient les deux fichiers à jour. Le `.gitignore` du scaffold
ignore les répertoires `generated/`, si bien qu'un clone neuf n'a aucun des deux fichiers tant que
quelque chose ne les réécrit pas. `rebase build` (et `rebase cloud deploy`, qui
compile le même bundle) les écrit à partir des collections avant de compiler,
de sorte qu'un job de CI qui exécute `rebase build` sur un clone neuf compile des callbacks typés.
Une étape de CI qui compile le backend ou le package `config` autrement
(`tsc`, `pnpm build`) a encore besoin de `rebase generate-sdk` au préalable, faute de quoi les callbacks
qui lisent des lignes typées se compilent contre le `context.data` non typé et échouent. Un
projet sans
`rebase.json` continue d'enregistrer tant que `config/generated/register.ts`
est présent. Pour revenir à des données côté serveur non typées, retirez `registerDatabase` et
supprimez `config/generated/`.

Vous pouvez aussi écrire vous-même l'enregistrement, dans n'importe quel fichier que le backend compile
(`backend/src/rebase-env.d.ts`, important `../../generated/sdk/database.types`).
Il n'atteint alors que la compilation du backend : dans le `tsc` propre au package `config`,
`context.data` reste l'objet non typé, les callbacks doivent donc compiler dans les deux cas.

## Ce qu'il type

```ts
// config/collections/orders.ts — a callback
callbacks: {
    async beforeSave({ context, values }) {
        const { data } = await context.data.customers.find({
            where: { email: ["==", "ada@example.com"] },  // `email` is a column of customers
        });
        data[0]?.email;                      // completes from the customers Row

        await context.data.customer.find();  // error: no collection `customer`
        return values;
    }
}
```

```ts
// backend/functions/stats.ts
import { defineFunction } from "@rebasepro/server/functions";

export default defineFunction((app, { rebase }) => {
    app.get("/", async (c) => {
        const { data } = await rebase.dataAsAdmin.orders.find({
            where: { status: ["==", "paid"] },   // `status` and its values are checked
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
        // `create` takes the collection's Insert type: required columns are required.
        await rebase.dataAsAdmin.auditLog.create({ action: "cleanup" });
    },
});
```

Chaque accesseur est typé comme celui du client navigateur : `find`, `findById`
et `listen` renvoient le `Row` de la collection ; `where` et `orderBy` sont
indexés par ses colonnes ; `include` nomme ses relations ; `create` prend son
`Insert` et `update` son `Update`. Les accesseurs sont les noms en camelCase du
fichier généré (`order_items` devient `orderItems`).
Le serveur résout ces noms à travers les collections enregistrées, si bien qu'une
collection `my-notes` stockée dans une table `notes` est `context.data.myNotes`.

`collection(slug)` avec un slug que la `Database` déclare est typé de la même façon :
`context.data.collection("my-notes")` est `context.data.myNotes`. Un slug calculé
à l'exécution, ou que le schéma ne déclare pas, obtient le client non typé.

## Une seule fonction, sans l'enregistrement

`defineFunction` et `defineCron` acceptent aussi le type en argument, qui l'emporte
sur l'enregistrement. Utilisez-le pour typer un seul fichier, ou pour essayer les données typées avant
d'enregistrer :

```ts
import type { Database } from "../../generated/sdk/database.types";

export default defineFunction<Database>((app, { rebase }) => {
    // rebase.dataAsAdmin is typed from Database here
});
```

## Les helpers qui prennent l'objet de données

Un helper qui reçoit `context.data` ou `rebase.dataAsAdmin` nomme le type
enregistré, ce qui le garde typé et lui fait accepter les deux :

```ts
import type { RebaseSdkData, RegisteredDatabase } from "@rebasepro/types";

export async function paidOrders(data: RebaseSdkData<RegisteredDatabase>) {
    return data.orders.find({ where: { status: ["==", "paid"] } });
}
```

Un helper déclaré avec un simple `RebaseSdkData` conserve le type non typé, et un
objet de données typé ne lui est pas assignable. Changez le paramètre comme ci-dessus
lorsque vous enregistrez.
