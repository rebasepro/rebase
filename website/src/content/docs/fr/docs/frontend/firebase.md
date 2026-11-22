---
sourceHash: ce9fefc61944ee85
title: Firestore aux côtés de Postgres
sidebar_label: Firebase
description: "Affichez les collections Firestore dans le CMS aux côtés de vos tables Postgres : defineFirestoreCollection, useFirestoreDataSource, externalCollections, et les références croisées entre documents Firestore et lignes Postgres dans les deux sens."
---

`@rebasepro/firebase` permet au CMS de lire et d'écrire dans les collections Firestore directement
depuis le navigateur, via le SDK Firebase, aux côtés des tables servies par votre backend
Rebase. Une seule navigation, une seule recherche, un seul sélecteur de références : un
opérateur n'a pas besoin de savoir dans quel moteur réside un enregistrement.

Firestore relève ici uniquement du frontend. Le backend n'en a aucune connaissance, et une
collection Firestore se déclare dans `frontend/src/cms/`, jamais dans
`backend/schema`.

:::caution[Les collections Firestore sont lues directement depuis le navigateur]
Rien de ce qui se trouve entre le navigateur et Firestore n'appartient à Rebase : la sécurité au niveau des lignes (RLS), l'API
REST, le SDK généré, les fonctions, les tâches cron et le modèle d'accès au stockage ne
s'appliquent pas à une collection Firestore. La détermination de qui peut lire et écrire ses documents est
régie par les **Firebase Security Rules**, écrites et déployées dans Firebase.
:::

## Installation

```bash
pnpm add @rebasepro/firebase firebase
```

Dépendances de type peer dependencies : `firebase` (10, 11 ou 12), `react` ≥ 19, `react-dom` ≥ 19, et
éventuellement `typesense` pour la recherche textuelle.

## Déclarer une collection Firestore

```ts
// frontend/src/cms/events.ts
import { defineFirestoreCollection } from "@rebasepro/firebase";

const eventTraces = defineFirestoreCollection({
    slug: "fs_event_traces",
    path: "traces",
    name: "Traces",
    dataSource: "firestore",
    fields: {
        step: { name: "Step", type: "string" },
        at:   { name: "At", type: "date" },
    },
});

export const firestoreEvents = defineFirestoreCollection({
    slug: "fs_events",
    path: "events",
    name: "Live Events (Firestore)",
    dataSource: "firestore",
    fields: {
        type:       { name: "Event Type", type: "string", required: true },
        payload:    { name: "Payload", type: "map" },
        // A reference to a row of the `customers` Postgres table.
        customerId: { name: "Customer", type: "reference", target: "customers" },
    },
    subcollections: () => [eventTraces],
});
```

| Clé | Rôle |
|---|---|
| `slug` | Le nom de la collection dans le panneau : son URL et la cible désignée par d'autres références. Il doit différer du slug de chaque table. |
| `path` | L'emplacement où résident les documents dans Firestore, lorsqu'il diffère du slug. |
| `name` | Le libellé affiché dans la navigation. |
| `dataSource` | La clé de l'entrée `<Rebase dataSources>` qui la lit : le `key` transmis à `useFirestoreDataSource`. À omettre uniquement lorsque Firestore est la source par défaut. |
| `databaseId` | Une base de données Firestore autre que celle par défaut. |
| `fields` | Les champs du document, par clé. |
| `subcollections` | Les collections imbriquées sous chaque document, affichées sous forme d'onglets du document et stockées à l'emplacement `<path>/<id>/<child path>`. Chacune est également un `defineFirestoreCollection`. |

Le `type` d'un champ correspond à l'un de ceux pris en charge par Firestore : `string`, `number`, `boolean`,
`date`, `geopoint`, `map`, `array`, `reference` ou `binary`. `required: true`
est un raccourci pour indiquer un champ obligatoire. Une `reference` spécifie la collection qu'elle pointe
à l'aide de `target`, quelle que soit la source de données. Une `relation` ou un `vector` appartient à une
table Postgres et sera refusé ici, tout comme `properties` et `engine`.

Le type du document est déduit à partir de `fields`, de sorte que les options propres à la collection
sont validées par rapport à ses clés. Les options de présentation acceptées par une collection Firestore
(icône, groupe, vues) sont celles du modèle de collection du panneau, et non celles de
`customizeTable`, qui est réservé aux tables.

## Monter la collection aux côtés des tables

Deux étapes : enregistrer Firestore en tant que source de données sur `<Rebase>`, et transmettre la
collection à `<RebaseCMS externalCollections>`.

```tsx
// frontend/src/App.tsx
import React from "react";
import { initializeApp } from "firebase/app";
import { Rebase, RebaseAuth, useRebaseAuthController } from "@rebasepro/app";
import { RebaseCMS, RebaseShell } from "@rebasepro/cms";
import { RebaseStudio } from "@rebasepro/studio";
import { createRebaseClient } from "@rebasepro/client";
import { useFirestoreDataSource } from "@rebasepro/firebase";
import { postsCms } from "./cms/posts";
import { customersCms } from "./cms/customers";
import { firestoreEvents } from "./cms/events";

const rebaseClient = createRebaseClient({ baseUrl: import.meta.env.VITE_API_URL });
const firebaseApp = initializeApp({ projectId: "acme-ops", apiKey: "…", appId: "…" });

export function App() {
    const authController = useRebaseAuthController({ client: rebaseClient });
    const firestoreSource = useFirestoreDataSource({ key: "firestore", firebaseApp });

    return (
        <Rebase
            client={rebaseClient}            // the default data source: the Postgres backend
            dataSources={[firestoreSource]}  // a second, direct source: Firestore
            authController={authController}
        >
            <RebaseAuth/>
            <RebaseCMS
                tableCustomizations={[postsCms, customersCms]}
                externalCollections={[firestoreEvents]}
            />
            <RebaseStudio/>
            <RebaseShell title="Acme Ops"/>
        </Rebase>
    );
}
```

Le panneau affiche toutes les tables servies par le backend, avec `postsCms` et
`customersCms` appliqués, puis `fs_events`, au sein de la même navigation. Un slug
identifie une seule collection : une collection externe portant le slug d'une table est refusée,
en mentionnant les deux (voir les [collisions](/docs/frontend/#rebasecms-props)).

`useFirestoreDataSource` renvoie le même objet à chaque rendu tant que ses
options restent identiques, ce qui permet de le placer directement en ligne dans `dataSources`. Ses options :

| Option | Rôle |
|---|---|
| `key` | **Obligatoire.** La valeur désignée par le `dataSource` d'une collection. |
| `firebaseApp` | L'application Firebase initialisée. Tant qu'elle n'est pas définie, la source se signale comme non prête. |
| `databaseId` | La base de données Firestore, lorsqu'il ne s'agit pas de celle par défaut de l'application. Le `databaseId` propre à une collection prévaut. |
| `label` | Un libellé pour la source, là où le panneau nomme les sources de données. |
| `textSearchControllerBuilder` | Répond aux recherches textuelles avec des identifiants de documents (Algolia, Typesense, Pinecone, recherche Rebase). |
| `localTextSearchEnabled` | Effectue une recherche dans le navigateur sur les documents eux-mêmes lorsqu'aucun contrôleur ne prend en charge une collection. Lit chaque document : adapté aux petites collections. |
| `firestoreIndexesBuilder` | Les index composites dont dispose la base de données, permettant au panneau de ne proposer que les filtres et les tris que Firestore peut exécuter. |

Il enregistre également les capacités de Firestore, de sorte que ses collections ne se voient jamais
proposer d'onglets de relation ou de filtres que Firestore ne peut pas exécuter.

## Modification

Une collection Firestore correspond à son appel `defineFirestoreCollection({...})` dans
`frontend/src/cms` : modifiez-la directement à cet endroit. Pour en supprimer une, supprimez son fichier ainsi que son
entrée dans `externalCollections`.

## De Firestore vers une table

`customerId: { type: "reference", target: "customers" }` pointe vers la
table `customers`. Lorsqu'un opérateur ouvre un événement et clique sur la pastille du client,
ou sélectionne un client, la recherche est routée selon la source de données de la cible : la
collection `customers` étant une table, la requête est transmise au backend Rebase, sous le contrôle
de la sécurité au niveau des lignes (RLS) de l'appelant.

Une référence vers un enregistrement situé sur une autre source de données est stockée dans le document sous la forme de l'**identifiant**
de cet enregistrement (une chaîne de caractères), de sorte qu'une requête Firestore telle que `customerId == "42"`
y corresponde. Une référence vers un document de la même base de données Firestore est stockée
sous la forme d'une `DocumentReference` Firestore, comme attendu par Firestore.

## D'une table vers Firestore

Une colonne de table qui contient l'identifiant d'un document Firestore est une simple colonne de texte
sur le backend. La propriété `referenceTo` dans son `customizeTable` la transforme en référence dans
le panneau :

```ts
// backend/schema/customers.ts
import { defineTable, col } from "@rebasepro/server/schema";

export const customers = defineTable("customers", {
    columns: {
        id:             col.uuid().primaryKey().defaultRandom(),
        name:           col.text().notNull(),
        // The id of this customer's document in the Firestore `fs_events` collection.
        lastEventDocId: col.text(),
    },
    rls: "admin-only",
});
```

```tsx
// frontend/src/cms/customers.tsx
import { customizeTable } from "@rebasepro/cms";
import type { customers } from "../../../backend/schema/customers";

export const customersCms = customizeTable<typeof customers>("customers", {
    fields: {
        lastEventDocId: { name: "Last event", referenceTo: "fs_events" },
    },
});
```

Le champ est représenté et sélectionné comme une référence vers `fs_events`, et son ouverture
lit le document via `firestoreSource`. La colonne continue de stocker l'identifiant sous forme
de texte, et le backend voit toujours une colonne de texte. `referenceTo` s'applique aux colonnes
de type texte et uuid ; pour tout autre type, il est ignoré, avec un avertissement en
développement.

## Un panneau exclusivement Firestore

`RebaseFirebaseApp` est un panneau complet fonctionnant uniquement sur Firebase : authentification
Firebase Auth, routage et collections fournies, sans aucun backend Rebase.

```tsx
import React from "react";
import { RebaseFirebaseApp, defineFirestoreCollection } from "@rebasepro/firebase";

const firebaseConfig = { projectId: "acme-ops", apiKey: "…", appId: "…" };

// No `dataSource`: here Firestore is the default source.
const events = defineFirestoreCollection({
    slug: "events",
    name: "Events",
    fields: {
        type: { name: "Event Type", type: "string", required: true },
    },
});

export default function App() {
    return <RebaseFirebaseApp
        name="My Project"
        firebaseConfig={firebaseConfig}
        collections={[events]}
    />;
}
```

Un exemple fonctionnel est disponible dans
[`examples/firebase`](https://github.com/rebasepro/rebase/tree/main/examples/firebase).
Dans cette configuration, rien de ce qui concerne les pages backend de ce site ne s'applique : les
Firebase Security Rules remplacent la sécurité au niveau des lignes, le SDK Firebase remplace l'API
REST et le SDK généré, les Cloud Functions remplacent les fonctions et les tâches cron, et le
Studio ainsi que `rls-check` n'ont rien à inspecter.

## Voir aussi

- [Tables dans le CMS](/docs/collections/) : ce que la partie Postgres affiche sans configuration
- [customizeTable](/docs/frontend/customize-table/) : `referenceTo` et toutes les autres options de table
- [Vue d'ensemble du Frontend](/docs/frontend/) : props de `<Rebase dataSources>` et `<RebaseCMS>`
- [Authentification et connexion](/docs/frontend/authentication/) : l'interface de connexion
