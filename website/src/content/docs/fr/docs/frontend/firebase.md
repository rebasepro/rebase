---
sourceHash: 6995a63f34afa39a
title: Firestore aux côtés de Postgres
sidebar_label: Firebase
description: "Affichez des collections Firestore dans le CMS aux côtés de vos tables Postgres : defineFirestoreCollection, useFirestoreDataSource, externalCollections, et des références croisées entre documents Firestore et lignes Postgres dans les deux sens."
---

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

`@rebasepro/firebase` permet au CMS de lire et d'écrire dans les collections
Firestore directement depuis le navigateur, via le SDK Firebase, aux côtés des
tables servies par votre backend Rebase. Une seule navigation, une seule
recherche, un seul sélecteur de référence : l'opérateur n'a pas besoin de savoir
dans quel moteur réside un enregistrement.

Firestore relève ici du frontend. Le backend n'en a aucune connaissance, et une
collection Firestore est déclarée dans `frontend/src/cms/`, jamais dans
`backend/schema`.

:::caution[Les collections Firestore sont lues directement depuis le navigateur]
Rien de ce qui se trouve entre le navigateur et Firestore n'appartient à Rebase :
la sécurité au niveau des lignes (row-level security), l'API REST, le SDK
généré, les fonctions, les crons et le modèle d'accès au stockage ne s'appliquent
pas à une collection Firestore. Les autorisations de lecture et d'écriture de
ses documents sont définies par les **règles de sécurité Firebase** (Firebase
Security Rules), écrites et déployées dans Firebase.
:::

## Installation

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

```bash
pnpm add @rebasepro/firebase firebase
```

Dépendances homologues : `firebase` (10, 11 ou 12), `react` ≥ 19, `react-dom` ≥ 19, et
optionnellement `typesense` pour la recherche textuelle.

## Déclarer une collection Firestore

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

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

| Clé | Description |
|---|---|
| `slug` | Le nom de la collection dans le panneau : son URL et la cible référencée par d'autres références. Il doit différer du slug de chaque table. |
| `path` | L'emplacement des documents dans Firestore, lorsqu'il diffère du slug. |
| `name` | Le libellé dans la navigation. |
| `dataSource` | La clé de l'entrée `<Rebase dataSources>` qui la lit : la `key` fournie à `useFirestoreDataSource`. À omettre uniquement lorsque Firestore est la source par défaut. |
| `databaseId` | Une base de données Firestore autre que celle par défaut. |
| `fields` | Les champs du document, par clé. |
| `subcollections` | Collections imbriquées sous chaque document, affichées sous forme d'onglets du document et stockées à l'emplacement `<path>/<id>/<child path>`. Chacune est également un `defineFirestoreCollection`. |

Le `type` d'un champ correspond à l'un de ceux stockés par Firestore : `string`,
`number`, `boolean`, `date`, `geopoint`, `map`, `array`, `reference` ou
`binary`. `required: true` indique un champ obligatoire. Une `reference`
spécifie la collection ciblée avec `target`, sur n'importe quelle source de
données. Une `relation` ou un `vector` appartient à une table Postgres et est
refusé ici, tout comme `properties` et `engine`.

Le type de document est inféré à partir de `fields`, de sorte que les options
propres à la collection sont validées par rapport à ses clés. Les options de
présentation acceptées par une collection Firestore (icône, groupe, vues) sont
celles du modèle de collection du panneau, et non `customizeTable`, qui est
réservé aux tables.

## L'intégrer aux côtés des tables

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Deux étapes : enregistrer Firestore en tant que source de données sur `<Rebase>`,
et transmettre la collection à `<RebaseCMS externalCollections>`.

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
désigne une seule collection : une collection externe portant le slug d'une table
est refusée en mentionnant les deux (voir [collisions](/docs/frontend/#rebasecms-props)).

`useFirestoreDataSource` renvoie le même objet à chaque rendu tant que ses
options ne changent pas, il peut donc être placé en ligne dans `dataSources`. Ses
options :

| Option | Description |
|---|---|
| `key` | **Obligatoire.** La valeur référencée par le `dataSource` d'une collection. |
| `firebaseApp` | L'application Firebase initialisée. Tant qu'elle n'est pas définie, la source se signale comme non prête. |
| `databaseId` | La base de données Firestore, lorsqu'il ne s'agit pas de celle par défaut de l'application. Le `databaseId` propre à une collection prévaut. |
| `label` | Un libellé pour la source, aux endroits où le panneau nomme les sources de données. |
| `textSearchControllerBuilder` | Répond aux recherches textuelles avec des identifiants de documents (Algolia, Typesense, Pinecone, Rebase search). |
| `localTextSearchEnabled` | Recherche dans le navigateur directement sur les documents lorsqu'aucun contrôleur ne couvre une collection. Lit l'intégralité des documents : adapté pour une petite collection. |
| `firestoreIndexesBuilder` | Les index composites de la base de données, permettant au panneau de ne proposer que les filtres et les tris que Firestore peut traiter. |

Elle enregistre également les capacités de Firestore, afin que ses collections ne
se voient jamais proposer d'onglets de relation ou de filtres que Firestore ne
peut pas exécuter.

## Édition dans l'éditeur de collections

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

En développement, l'[éditeur de collections](/docs/studio/#collection-editor)
permet également d'éditer les collections Firestore : la sauvegarde réécrit sur
place l'appel `defineFirestoreCollection({...})` de la collection dans
`frontend/src/cms`, en ne modifiant que ce que vous avez édité. Les fonctions,
les composants personnalisés, les commentaires et les imports restent inchangés ;
les champs définis dans le code apparaissent en lecture seule. En production, les
collections Firestore sont en lecture seule dans l'éditeur. Pour en supprimer
une, supprimez son fichier et son entrée dans `externalCollections`.

## De Firestore vers une table

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

`customerId: { type: "reference", target: "customers" }` pointe vers la table
`customers`. Lorsqu'un opérateur ouvre un événement et clique sur la pastille
client, ou sélectionne un client, la recherche est routée selon la source de
données de la cible : la collection `customers` étant une table, elle s'adresse
au backend Rebase, sous le contrôle de la sécurité au niveau des lignes de
l'appelant.

Une référence vers un enregistrement d'une autre source de données est stockée
dans le document sous forme de l'**identifiant** de l'enregistrement (une chaîne
de caractères), de sorte qu'une requête Firestore avec `customerId == "42"`
corresponde. Une référence à un document dans la même base de données Firestore
est stockée sous la forme d'un `DocumentReference` Firestore, comme l'attend
Firestore.

## D'une table vers Firestore

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Une colonne de table qui contient l'identifiant d'un document Firestore est une
simple colonne de texte sur le backend. `referenceTo` dans son `customizeTable`
en fait une référence dans le panneau :

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

Le champ est affiché et sélectionné comme une référence vers `fs_events`, et son
ouverture lit le document via `firestoreSource`. La colonne stocke toujours
l'identifiant sous forme de texte, et le backend voit toujours une colonne de
texte. `referenceTo` s'applique aux colonnes de type texte et uuid ; pour tout
autre type, il est ignoré, avec un avertissement en développement.

## Un panneau exclusivement Firestore

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

`RebaseFirebaseApp` est un panneau complet reposant uniquement sur Firebase :
connexion Firebase Auth, routage et collections fournies, sans aucun backend
Rebase.

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
Dans cette configuration, rien de ce qui concerne le backend sur ce site ne
s'applique : les règles de sécurité Firebase remplacent la sécurité au niveau des
lignes, le SDK Firebase remplace l'API REST et le SDK généré, Cloud Functions
remplace les fonctions et les crons, et le Studio ainsi que `rls-check` n'ont
rien à inspecter.

## Voir aussi

- [Tables dans le CMS](/docs/collections/) : ce que le côté Postgres affiche sans aucune configuration
- [customizeTable](/docs/frontend/customize-table/) : `referenceTo` et toutes les autres options de table
- [Vue d'ensemble du frontend](/docs/frontend/) : props de `<Rebase dataSources>` et `<RebaseCMS>`
- [Authentification et connexion](/docs/frontend/authentication/) : l'interface de connexion
