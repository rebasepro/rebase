---
sourceHash: a1afbafa7c27ef28
title: SDK Tipado — Primeiros Passos
sidebar_label: Primeiros Passos
description: Instale e configure o SDK tipado do Rebase para interagir com seu backend a partir de qualquer aplicação JavaScript ou TypeScript.
---

## Visão Geral

O pacote `@rebasepro/client` fornece um SDK JavaScript fortemente tipado (type-safe) para interagir com o seu backend Rebase. Ele gerencia:

- **Operações de dados** — CRUD com filtragem, ordenação e paginação
- **Busca de relações** — Inclua entidades relacionadas com `.include()`
- **Inscrições em tempo real** — Atualizações ao vivo baseadas em WebSocket
- **Sincronização offline e local-first** — Banco de dados local opcional de linhas, gravações offline instantâneas, consultas em tempo real
- **Autenticação** — Gerenciamento de tokens, login, cadastro, OAuth
- **Armazenamento** — Upload, download e gerenciamento de arquivos
- **Funções personalizadas** — Chame endpoints de servidor personalizados

## Instalação

```bash
pnpm add @rebasepro/client
```

## Criando um Cliente

O `rebase dev` deriva uma porta livre a partir do caminho do projeto em vez de usar uma fixa, portanto, **leia a `baseUrl` a partir da URL que ele imprimiu** — não há uma porta compartilhada por todos os projetos. Em um frontend Vite, essa é a `VITE_API_URL` que o scaffold grava no `.env`; em um script, uma variável de ambiente própria.

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
| `baseUrl` | `string` | URL do backend. Leia do que o `rebase dev` imprimiu ou do seu deploy |
| `websocketUrl` | `string` | URL do WebSocket — derivada automaticamente de `baseUrl` se omitida |
| `token` | `string` | Token JWT estático para chamadas de servidor para servidor |
| `apiPath` | `string` | Prefixo da API (padrão: `"/api"`) |
| `fetch` | `typeof fetch` | Implementação personalizada de fetch (ex.: para SSR) |
| `onUnauthorized` | `() => Promise<boolean>` | Manipulador de 401 personalizado — retorne `true` para tentar novamente |
| `realtime` | `boolean \| RealtimeClientOptions` | Abre o WebSocket (padrão `true`) — defina como `false` em scripts pontuais. `{ affinity }` [nomeia o grupo ao qual o socket pertence](/docs/sdk/realtime#keeping-a-group-on-one-instance) |
| `collections` | `Record<string, string>` | Mapeia nomes de acessores para slugs de coleções |
| `offline` | `boolean \| OfflineConfig` | [Sincronização local-first](/docs/sdk/offline) — desativada por padrão |
| `impersonate` | `string` | Executa cada requisição como este usuário, por uid, para verificar o que um usuário pode ver. Apenas uma sessão de administrador pode fazer isso: a API de dados, funções e realtime rodam como esse usuário, e todas as outras rotas recusam |
| `debug` | `boolean` | Registra o progresso da conexão de realtime com `console.debug` (padrão `false`) — consulte [Logs de conexão](#logs-de-conexão) |

### Logs de conexão

O cliente não imprime nada sobre sua conexão de realtime por padrão, portanto uma página pública não revela nada sobre seu backend no console do visitante. Avisos e erros são sempre exibidos. Para ver a conexão abrir, autenticar, cair e reconectar, passe `debug: true`, ou ative-o em um navegador sem alterar o site executando isto em seu console:

```js
localStorage.setItem("rebase_debug", "1"); // localStorage.removeItem("rebase_debug") to stop
```

Isso se aplica a partir da próxima linha que o cliente registrar, então uma página que já está conectada não precisa ser recarregada. Fora de um navegador, defina `globalThis.__REBASE_DEBUG__ = true`. Os navegadores mostram `console.debug` apenas no nível Detalhado (Verbose).

## Geração do SDK Tipado

Gere um cliente totalmente tipado a partir das definições das suas coleções:

```bash
rebase generate-sdk
```

Enquanto o `rebase dev` estiver em execução, você não precisa fazer isso: ele regenera os tipos em `generated/sdk/` na inicialização e a cada salvamento em `config/collections/`. Execute o comando você mesmo no CI, em um repositório de frontend que não possui coleções (`rebase generate-sdk --from link`), ou em qualquer lugar onde o `rebase dev` não esteja rodando. Na versão 0.23, o `rebase dev` não altera os tipos do SDK, portanto execute o comando após cada alteração de coleção.

Em seguida, passe o parâmetro de tipo `Database` para `createRebaseClient` para ter autocomplete completo:

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

Quando `Database` é fornecido, `createRebaseClient` retorna uma instância de `CreateRebaseClientResult<DB>`. Isso mapeia acessores de coleção em camelCase diretamente em `client.data` para seus tipos correspondentes, oferecendo autocomplete completo nas operações e tipos da coleção (por exemplo, `client.data.products.find()`).

`collectionsDictionary` mapeia cada acessor de volta para o slug que trafega na rede. **`collections` é obrigatório para um cliente tipado.** Os tipos oferecem todos os acessores, quer você o passe ou não, mas sem isso `client.data.myNotes` é enviado para `/data/my_notes`, o acessor em snake_case, fazendo com que um slug como `my-notes` ou um acessor renomeado retorne 404. O cliente emite um aviso uma única vez, indicando o acessor e a correção. Uma versão posterior tornará `collections` obrigatório nos tipos quando `Database` for fornecido.

Alguns nomes em `client.data` são reservados: `collection` é a função dinâmica `collection(slug)`, e `then`, `toJSON` e `$$typeof` são preservados para verificações de promises e serialização. Uma coleção cujo acessor seria um desses é gerada como `<name>Collection` — o slug `collection` vira `client.data.collectionCollection` — e o `generate-sdk` imprime um aviso indicando ambos. `client.data.collection("collection")` também pode acessá-la.

### Nomes dos campos

**O nome de um campo na rede é sua chave de propriedade**, e a API utiliza camelCase em toda a sua extensão. Uma propriedade `createdAt` armazenada em uma coluna `created_at` é `row.createdAt`, e a chave estrangeira de uma relação é `authorId`, mesmo que a coluna permaneça `author_id`. `where` e `orderBy` são baseados no mesmo tipo `Row`, de modo que o que compila é aquilo a que o backend responde.

Uma chave de propriedade que *você* escreveu é sua chave, independentemente do formato — nada renomeia um nome escolhido por você. As duas chaves que são derivadas em vez de declaradas, a chave estrangeira de uma relação e uma coluna lida por introspecção, são em camelCase.

`Row` descreve uma leitura, `Insert` um `create()` e `Update` um `update()` — eles não possuem a mesma estrutura. Uma coluna que não é obrigatória é `T | null` em todos os três, permitindo que uma escrita a limpe; a chave primária está sempre presente em uma leitura e nunca pode ser definida em uma atualização; o destino de um `belongsTo` pode ser escrito tanto como a relação (`{ author: 5 }`) quanto como sua chave estrangeira (`{ authorId: 5 }`), e uma relação obrigatória é satisfeita por qualquer uma das duas formas; um `hasOne` é escrito informando a linha de destino (`{ profile: 9 }`), ou `null` para desvinculá-la; um `via` de salto único (single-hop) é escrito como o tipo que ele representa (para-um: o id do destino ou `null`; para-muitos: uma lista de ids), e um de múltiplos saltos é somente leitura e não está presente em nenhum dos dois; e a associação `hasMany` ou `manyToMany` é escrita como uma lista de ids de destino ou objetos `{ id }` (`{ tags: ["t-1"] }`), cada um contendo um `_pivot` quando a junção declara colunas de payload. Um campo que ninguém pode escrever (`access: { write: [] }`) não está presente nem em `Insert` nem em `Update`. Uma coluna `date` é lida como uma string ISO, e a escrita aceita tanto essa string quanto um `Date`.

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
- **[Armazenamento e Arquivos](/docs/sdk/storage)** — Upload, download e gerenciamento de arquivos
