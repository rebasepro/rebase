---
sourceHash: 35d04e650c33c5cb
title: SDK tipado — Primeiros passos
sidebar_label: Primeiros Passos
description: Instale e configure o Rebase Client SDK para interagir com seu backend a partir de qualquer aplicação JavaScript ou TypeScript.
---

## Visão Geral

O pacote `@rebasepro/client` fornece um SDK JavaScript type-safe para interagir com o seu backend Rebase. Ele lida com:

- **Operações de dados** — CRUD com filtragem, ordenação e paginação
- **Busca de relações** — Inclua entidades relacionadas com `.include()`
- **Inscrições em tempo real** — Atualizações ao vivo baseadas em WebSocket
- **Sincronização offline e local-first** — Banco de dados local de registros opt-in, gravações offline instantâneas, consultas em tempo real
- **Autenticação** — Gerenciamento de tokens, login, cadastro, OAuth
- **Armazenamento** — Upload, download e gerenciamento de arquivos
- **Funções customizadas** — Chame endpoints de servidor customizados

## Instalação

```bash
pnpm add @rebasepro/client
```

## Criando um Cliente

O `rebase dev` deriva uma porta livre a partir do caminho do projeto em vez de usar uma fixa, portanto **leia a `baseUrl` da URL que ele exibiu** — não há uma porta compartilhada por todos os projetos. Em um frontend Vite, essa é a `VITE_API_URL` que o scaffold escreve no `.env`; em um script, uma variável de ambiente própria.

```typescript
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({
    baseUrl: import.meta.env.VITE_API_URL,
});
```

A `websocketUrl` é derivada automaticamente de `baseUrl` (`http → ws`, `https → wss`). Você pode substituí-la explicitamente se necessário:

```typescript
const client = createRebaseClient({
    baseUrl: import.meta.env.VITE_API_URL,
    websocketUrl: import.meta.env.VITE_WS_URL,
});
```

### Opções de Configuração

| Opção | Tipo | Descrição |
|--------|------|-------------|
| `baseUrl` | `string` | URL do backend. Leia a partir do que o `rebase dev` exibiu, ou do seu deploy |
| `websocketUrl` | `string` | URL do WebSocket — derivada automaticamente de `baseUrl` se omitida |
| `token` | `string` | Token JWT estático para chamadas server-to-server |
| `apiPath` | `string` | Prefixo da API (padrão: `"/api"`) |
| `fetch` | `typeof fetch` | Implementação customizada de fetch (ex.: para SSR) |
| `onUnauthorized` | `() => Promise<boolean>` | Manipulador customizado de 401 — retorne `true` para tentar novamente |
| `realtime` | `boolean` | Abre o WebSocket (padrão `true`) — defina como `false` em scripts pontuais |
| `collections` | `Record<string, string>` | Mapeia nomes de acessadores para slugs de coleções |
| `offline` | `boolean \| OfflineConfig` | [Sincronização local-first](/docs/sdk/offline) — desativada por padrão |

## Geração de SDK Tipado

Gere um cliente totalmente tipado a partir das definições de suas coleções:

```bash
rebase generate-sdk
```

Em seguida, passe o parâmetro de tipo `Database` para `createRebaseClient` para obter autocompletar completo:

```typescript
import { createRebaseClient } from "@rebasepro/client";
import { collectionsDictionary, type Database } from "./generated/sdk/database.types";

const client = createRebaseClient<Database>({
    baseUrl: import.meta.env.VITE_API_URL,
    collections: collectionsDictionary,
});

// Full autocomplete on collection names and field types
const { data } = await client.data.products.find();
```

Quando `Database` é fornecido, o `createRebaseClient` retorna uma instância de `CreateRebaseClientResult<DB>`. Isso mapeia acessadores de coleção em camelCase diretamente em `client.data` para seus tipos correspondentes, oferecendo autocompletar completo em operações e tipos de coleção (ex.: `client.data.products.find()`).

O `collectionsDictionary` mapeia cada acessador de volta para o slug utilizado na comunicação (wire). Passe-o sempre que um slug não for um nome de propriedade válido — `my-notes` só é acessível como `client.data.myNotes` porque o dicionário especifica isso.

### Nomes de campos

**O nome de um campo na rede (wire) é a sua chave de propriedade**, e a API usa camelCase por padrão em toda a sua extensão. Uma propriedade `createdAt` armazenada em uma coluna `created_at` é `row.createdAt`, e a chave estrangeira de uma relação é `authorId` mesmo que a coluna permaneça `author_id`. O `where` e o `orderBy` são baseados no mesmo tipo `Row`, portanto o que compila é aquilo a que o backend responde.

Uma chave de propriedade que *você* escreveu é a sua chave, qualquer que seja seu formato — nada renomeia um nome que você escolheu. As duas chaves que são derivadas em vez de declaradas, a chave estrangeira de uma relação e uma coluna lida por introspecção, são camelCase.

`Row` descreve uma leitura, `Insert` um `create()` e `Update` um `update()` — eles não têm o mesmo formato. Colunas anuláveis são `T | null` em `Row`, a chave primária está sempre presente em uma leitura e nunca pode ser definida em uma atualização, e o alvo de um `belongsTo` pode ser escrito tanto como a relação (`{ author: 5 }`) quanto como sua chave estrangeira (`{ authorId: 5 }`).

## Exemplo Rápido

```typescript
// Create
const product = await client.data.products.create({
    name: "Camera",
    price: 299,
});

// Query with filters
const { data } = await client.data.products
    .where("price", ">=", 100)
    .orderBy("createdAt", "desc")
    .limit(10)
    .find();

// Real-time subscription
const unsubscribe = client.data.products.listen(
    { where: { active: ["==", true] } },
    (response) => console.log("Updated:", response.data)
);
```

## Usando com React

Em um frontend Rebase, o cliente é criado uma vez e compartilhado via contexto:

```tsx no-verify
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({ baseUrl: API_URL });

<Rebase client={client} ...>
```

Acesse-o a partir de qualquer componente:

```tsx
import { useRebaseClient } from "@rebasepro/app";

function MyComponent() {
    const client = useRebaseClient();
    // client.data, client.auth, client.storage, client.functions
}
```

## Próximos Passos

- **[Consultando Dados](/docs/sdk/querying)** — CRUD, filtros, paginação e relações
- **[Autenticação](/docs/sdk/authentication)** — Login, cadastro, OAuth, sessões
- **[Inscrições em Tempo Real](/docs/sdk/realtime)** — Dados em tempo real com WebSockets
- **[Sincronização Offline e Local-First](/docs/sdk/offline)** — Trabalhe sem conexão e sincronize quando ela retornar
- **[Armazenamento e Arquivos](/docs/sdk/storage)** — Faça upload, download e gerencie arquivos
