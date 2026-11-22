---
sourceHash: ce9fefc61944ee85
title: Firestore ao lado do Postgres
sidebar_label: Firebase
description: "Exiba coleções do Firestore no CMS ao lado das suas tabelas Postgres: defineFirestoreCollection, useFirestoreDataSource, externalCollections e referências que cruzam documentos do Firestore e linhas do Postgres em ambas as direções."
---

O `@rebasepro/firebase` permite que o CMS leia e escreva em coleções do Firestore no
navegador, por meio do Firebase SDK, ao lado das tabelas que seu backend Rebase
fornece. Uma única navegação, uma única busca, um único seletor de referências: o operador
não precisa saber em qual mecanismo o registro reside.

O Firestore aqui é uma responsabilidade do frontend. O backend não sabe nada sobre ele, e uma
coleção do Firestore é declarada em `frontend/src/cms/`, nunca em
`backend/schema`.

:::caution[Coleções do Firestore são lidas diretamente do navegador]
Nada entre o navegador e o Firestore pertence ao Rebase: row-level security, a
API REST, o SDK gerado, functions, crons e o modelo de acesso ao storage não
se aplicam a uma coleção do Firestore. Quem pode ler e escrever seus documentos é
decidido pelas **Firebase Security Rules**, escritas e publicadas no Firebase.
:::

## Instalação

```bash
pnpm add @rebasepro/firebase firebase
```

Dependências de pares (peer dependencies): `firebase` (10, 11 ou 12), `react` ≥ 19, `react-dom` ≥ 19 e,
opcionalmente, `typesense` para busca textual.

## Declarar uma coleção do Firestore

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

| Chave | O que faz |
|---|---|
| `slug` | O nome da coleção no painel: sua URL e o destino apontado por outras referências. Deve ser diferente do slug de todas as tabelas. |
| `path` | Onde os documentos residem no Firestore, quando não for o slug. |
| `name` | O rótulo na navegação. |
| `dataSource` | A chave da entrada `<Rebase dataSources>` que a lê: a `key` fornecida para `useFirestoreDataSource`. Omita apenas quando o Firestore for a fonte padrão. |
| `databaseId` | Um banco de dados do Firestore diferente do padrão. |
| `fields` | Os campos do documento, por chave. |
| `subcollections` | Coleções aninhadas sob cada documento, exibidas como abas do documento e armazenadas em `<path>/<id>/<child path>`. Cada uma também é um `defineFirestoreCollection`. |

O `type` de um campo é um dos tipos suportados pelo Firestore: `string`, `number`, `boolean`,
`date`, `geopoint`, `map`, `array`, `reference` ou `binary`. `required: true`
é o atalho para um campo obrigatório. Uma `reference` indica a coleção para a qual aponta
usando `target`, em qualquer fonte de dados. Uma `relation` ou um `vector` pertence a uma
tabela Postgres e é rejeitado aqui, assim como `properties` e `engine`.

O tipo do documento é inferido a partir de `fields`, portanto, as opções da própria coleção são
verificadas em relação às suas chaves. As opções de apresentação que uma coleção do Firestore aceita
(icon, group, views) são as do modelo de coleção do painel, não do
`customizeTable`, que é destinado a tabelas.

## Montá-la ao lado das tabelas

Dois passos: registre o Firestore como fonte de dados no `<Rebase>` e passe a
coleção para `<RebaseCMS externalCollections>`.

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

O painel exibe todas as tabelas fornecidas pelo backend, com `postsCms` e
`customersCms` aplicados, e depois `fs_events`, na mesma navegação. Um slug
identifica exclusivamente uma coleção: uma coleção externa com o mesmo slug de uma tabela é recusada,
indicando ambos (consulte [collisions](/docs/frontend/#rebasecms-props)).

O `useFirestoreDataSource` retorna o mesmo objeto em cada renderização enquanto suas
opções forem as mesmas, para que possa ser definido diretamente em `dataSources`. Suas opções:

| Opção | O que faz |
|---|---|
| `key` | **Obrigatório.** O nome correspondente a `dataSource` da coleção. |
| `firebaseApp` | O app Firebase inicializado. Até que seja definido, a fonte reporta que não está pronta. |
| `databaseId` | O banco de dados Firestore, quando não for o padrão do app. O `databaseId` da própria coleção tem precedência. |
| `label` | Um rótulo para a fonte, onde o painel exibe o nome das fontes de dados. |
| `textSearchControllerBuilder` | Responde a buscas de texto com IDs de documentos (Algolia, Typesense, Pinecone, Rebase search). |
| `localTextSearchEnabled` | Busca no navegador diretamente nos próprios documentos quando nenhum controlador cobre a coleção. Lê todos os documentos: adequado para coleções pequenas. |
| `firestoreIndexesBuilder` | Os índices compostos que o banco de dados possui, para que o painel ofereça apenas os filtros e ordenações que o Firestore suporta. |

Ele também registra o que o Firestore suporta, de modo que suas coleções nunca exibam
abas de relações ou filtros que o Firestore não consiga executar.

## Editando-a

Uma coleção do Firestore é definida por sua chamada `defineFirestoreCollection({...})` em
`frontend/src/cms`: edite-a lá. Para excluir uma, remova o seu arquivo e sua
entrada em `externalCollections`.

## Do Firestore para uma tabela

`customerId: { type: "reference", target: "customers" }` aponta para a
tabela `customers`. Quando um operador abre um evento e clica no chip do cliente,
ou seleciona um cliente, a consulta é roteada pela fonte de dados de destino: como a
coleção `customers` é uma tabela, ela vai para o backend do Rebase, sob a
segurança em nível de linha (RLS) de quem faz a requisição.

Uma referência a um registro em outra fonte de dados é armazenada no documento como o
**id** do registro (uma string), para que uma consulta no Firestore por `customerId == "42"`
encontre o registro correspondente. Já uma referência a um documento no mesmo banco de dados do Firestore
é armazenada como um `DocumentReference` do Firestore, como esperado por ele.

## De uma tabela para o Firestore

Uma coluna de tabela que armazena o id de um documento do Firestore é uma coluna de
texto simples no backend. O uso de `referenceTo` no seu `customizeTable` a transforma em uma referência
no painel:

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

O campo é renderizado e selecionado como uma referência a `fs_events`, e abri-lo
lê o documento por meio de `firestoreSource`. A coluna continua armazenando o id como
texto, e o backend continua enxergando uma coluna de texto. `referenceTo` se aplica a colunas
de tipo text e uuid; em qualquer outro tipo, ele é ignorado com um aviso em
ambiente de desenvolvimento.

## Um painel apenas com Firestore

O `RebaseFirebaseApp` é um painel completo baseado exclusivamente no Firebase: login com
Firebase Auth, roteamento e as coleções que você passar, sem a necessidade de nenhum backend Rebase.

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

Um exemplo funcional está disponível em
[`examples/firebase`](https://github.com/rebasepro/rebase/tree/main/examples/firebase).
Nessa configuração, nada nas páginas de backend deste site se aplica: as Firebase
Security Rules substituem o row-level security, o Firebase SDK substitui a API REST
e o SDK gerado, Cloud Functions substituem functions e crons, e o
Studio e `rls-check` não têm nada para inspecionar.

## Relacionados

- [Tabelas no CMS](/docs/collections/): o que o lado do Postgres exibe sem nenhuma configuração
- [customizeTable](/docs/frontend/customize-table/): `referenceTo` e todas as outras opções de tabela
- [Visão geral do frontend](/docs/frontend/): propriedades de `<Rebase dataSources>` e `<RebaseCMS>`
- [Autenticação e Login](/docs/frontend/authentication/): a interface de autenticação
