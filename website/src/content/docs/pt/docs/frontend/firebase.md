---
sourceHash: 6995a63f34afa39a
title: Firestore ao lado do Postgres
sidebar_label: Firebase
description: "Exiba coleções do Firestore no CMS ao lado das suas tabelas Postgres: defineFirestoreCollection, useFirestoreDataSource, externalCollections e referências que cruzam documentos do Firestore e linhas do Postgres em ambas as direções."
---

<span class="since-badge" data-since="0.31">Since 0.31</span>

O `@rebasepro/firebase` permite que o CMS leia e escreva em coleções do Firestore
no navegador, por meio do Firebase SDK, ao lado das tabelas que seu backend Rebase
disponibiliza. Uma única navegação, uma única busca, um único seletor de referências: o
operador não precisa saber em qual engine um registro reside.

O Firestore é uma preocupação exclusiva do frontend aqui. O backend não sabe nada sobre ele, e
uma coleção do Firestore é declarada em `frontend/src/cms/`, nunca em
`backend/schema`.

:::caution[As coleções do Firestore são lidas diretamente do navegador]
Nada entre o navegador e o Firestore pertence ao Rebase: segurança em nível de linha (RLS), a
API REST, o SDK gerado, funções, crons e o modelo de acesso ao storage não
se aplicam a uma coleção do Firestore. Quem pode ler e escrever seus documentos é
definido pelas **Firebase Security Rules**, escritas e implantadas no Firebase.
:::

## Instalação

<span class="since-badge" data-since="0.31">Since 0.31</span>

```bash
pnpm add @rebasepro/firebase firebase
```

Dependências de pares (peer dependencies): `firebase` (10, 11 ou 12), `react` ≥ 19, `react-dom` ≥ 19 e,
opcionalmente, `typesense` para busca textual.

## Declarar uma coleção do Firestore

<span class="since-badge" data-since="0.31">Since 0.31</span>

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
| `slug` | O nome da coleção no painel: sua URL e o alvo que outras referências nomeiam. Deve ser diferente do slug de qualquer tabela. |
| `path` | Onde os documentos residem no Firestore, quando não for o mesmo que o slug. |
| `name` | O rótulo exibido na navegação. |
| `dataSource` | A chave da entrada `<Rebase dataSources>` que a lê: a `key` fornecida a `useFirestoreDataSource`. Omita apenas quando o Firestore for a fonte padrão. |
| `databaseId` | Um banco de dados do Firestore diferente do padrão. |
| `fields` | Os campos do documento, por chave. |
| `subcollections` | Coleções aninhadas sob cada documento, exibidas como abas do documento e armazenadas em `<path>/<id>/<child path>`. Cada uma também é um `defineFirestoreCollection`. |

O `type` de um campo é um dos tipos suportados pelo Firestore: `string`, `number`, `boolean`,
`date`, `geopoint`, `map`, `array`, `reference` ou `binary`. `required: true`
é a abreviação para um campo obrigatório. Uma `reference` define a coleção para a qual aponta
com `target`, em qualquer fonte de dados. Uma `relation` ou um `vector` pertence a uma
tabela Postgres e é recusado aqui, assim como `properties` e `engine`.

O tipo do documento é inferido a partir de `fields`, portanto, as opções da própria
coleção são validadas contra suas chaves. As opções de apresentação aceitas por uma coleção do
Firestore (ícone, grupo, visualizações) são as do modelo de coleção do painel, não
`customizeTable`, que é destinado a tabelas.

## Montar ao lado das tabelas

<span class="since-badge" data-since="0.31">Since 0.31</span>

Duas etapas: registrar o Firestore como fonte de dados em `<Rebase>` e passar a
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

O painel exibe todas as tabelas servidas pelo backend, com `postsCms` e
`customersCms` aplicados, e então `fs_events`, na mesma navegação. Um slug
identifica apenas uma coleção: uma coleção externa com o mesmo slug de uma tabela é recusada,
apontando o conflito (veja [colisões](/docs/frontend/#rebasecms-props)).

`useFirestoreDataSource` retorna o mesmo objeto em todas as renderizações enquanto suas
opções forem as mesmas, podendo assim ser definido inline em `dataSources`. Suas opções:

| Opção | O que faz |
|---|---|
| `key` | **Obrigatório.** O identificador que o `dataSource` de uma coleção referencia. |
| `firebaseApp` | A instância inicializada do app Firebase. Até ser definida, a fonte reporta que não está pronta. |
| `databaseId` | O banco de dados do Firestore, quando não for o padrão do app. O `databaseId` definido na própria coleção tem precedência. |
| `label` | Um rótulo para a fonte, onde o painel exibe nomes de fontes de dados. |
| `textSearchControllerBuilder` | Responde a buscas textuais com IDs de documentos (Algolia, Typesense, Pinecone, busca do Rebase). |
| `localTextSearchEnabled` | Busca no navegador diretamente nos próprios documentos quando nenhum controlador cobre a coleção. Lê todos os documentos: adequado para coleções pequenas. |
| `firestoreIndexesBuilder` | Os índices compostos que o banco possui, permitindo que o painel ofereça apenas os filtros e ordenações que o Firestore pode atender. |

Ele também registra os recursos que o Firestore suporta, de modo que suas coleções nunca
recebam abas de relacionamento ou filtros que o Firestore não consiga executar.

## Editando no editor de coleções

<span class="since-badge" data-since="0.31">Since 0.31</span>

Em ambiente de desenvolvimento, o [editor de coleções](/docs/studio/#collection-editor) edita
coleções do Firestore também: salvar reescreve a chamada
`defineFirestoreCollection({...})` da coleção diretamente em `frontend/src/cms`,
alterando apenas o que você editou. Funções, componentes customizados, comentários e
imports permanecem inalterados; campos definidos via código aparecem como somente leitura. Em
produção, as coleções do Firestore são somente leitura no editor. Para excluir uma,
remova seu arquivo e sua entrada em `externalCollections`.

## Do Firestore para uma tabela

<span class="since-badge" data-since="0.31">Since 0.31</span>

`customerId: { type: "reference", target: "customers" }` aponta para a
tabela `customers`. Quando um operador abre um evento e clica no chip do cliente,
ou seleciona um cliente, a busca é roteada pela fonte de dados do alvo: a
coleção `customers` é uma tabela, portanto vai para o backend Rebase, sob a
segurança em nível de linha (RLS) do chamador.

Uma referência a um registro em outra fonte de dados é armazenada no documento como o
**id** do registro, uma string, de forma que uma consulta no Firestore por `customerId == "42"`
corresponda a ele. Uma referência a um documento no mesmo banco de dados do Firestore é armazenada
como uma `DocumentReference` do Firestore, conforme esperado pela plataforma.

## De uma tabela para o Firestore

<span class="since-badge" data-since="0.31">Since 0.31</span>

Uma coluna de tabela que armazena o id de um documento do Firestore é uma coluna de texto simples
no backend. O `referenceTo` em seu `customizeTable` transforma essa coluna em uma referência no
painel:

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

O campo é renderizado e selecionado como uma referência para `fs_events`, e abri-lo
faz a leitura do documento por meio de `firestoreSource`. A coluna continua armazenando o id como
texto, e o backend continua enxergando uma coluna de texto. `referenceTo` se aplica a colunas
de texto e uuid; em qualquer outro tipo ele é ignorado, emitindo um aviso em
desenvolvimento.

## Um painel exclusivo para Firestore

<span class="since-badge" data-since="0.31">Since 0.31</span>

`RebaseFirebaseApp` é um painel completo construído unicamente sobre o Firebase: login via
Firebase Auth, roteamento e as coleções que você passar, sem a necessidade de um backend Rebase.

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
Nessa configuração, nada das páginas de backend desta documentação se aplica: as
Firebase Security Rules substituem o RLS (row-level security), o Firebase SDK substitui a API
REST e o SDK gerado, Cloud Functions substituem funções e crons, e o
Studio e o `rls-check` não têm nada a inspecionar.

## Relacionados

- [Tabelas no CMS](/docs/collections/): o que a parte Postgres exibe sem nenhuma configuração
- [customizeTable](/docs/frontend/customize-table/): `referenceTo` e todas as outras opções de tabelas
- [Visão Geral do Frontend](/docs/frontend/): propriedades de `<Rebase dataSources>` e `<RebaseCMS>`
- [Autenticação e Login](/docs/frontend/authentication/): a interface de login
