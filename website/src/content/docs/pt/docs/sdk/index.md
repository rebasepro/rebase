---
sourceHash: d3b3f413d231c3d0
title: SDK Tipado — Primeiros Passos
sidebar_label: Primeiros Passos
description: Instale e configure o SDK tipado do Rebase para interagir com o seu backend a partir de qualquer aplicação JavaScript ou TypeScript.
---

## Visão Geral

O pacote `@rebasepro/client` fornece um SDK JavaScript com segurança de tipos (type-safe) para interagir com o seu backend Rebase. Ele lida com:

- **Operações de dados** — CRUD com filtragem, ordenação e paginação
- **Busca de relações** — Inclua entidades relacionadas com `.include()`
- **Subscrições em tempo real** — Atualizações ao vivo baseadas em WebSocket
- **Sincronização offline e local-first** — Banco de dados local opcional (opt-in), gravações offline instantâneas, consultas ao vivo
- **Autenticação** — Gerenciamento de tokens, login, cadastro (signup), OAuth
- **Armazenamento** — Upload, download e gerenciamento de arquivos
- **Funções customizadas** — Chame endpoints de servidor personalizados

## Instalação

```bash
pnpm add @rebasepro/client
```

## Criando um Cliente

O `rebase dev` obtém uma porta livre a partir do caminho do projeto em vez de usar uma
fixa, portanto, **leia `baseUrl` da URL exibida** — não há uma porta que todos os projetos
compartilhem. Em um frontend Vite, essa é a `VITE_API_URL` que o scaffold grava no
`.env`; em um script, use uma variável de ambiente própria.

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
| `baseUrl` | `string` | URL do backend. Obtenha-a a partir da saída exibida pelo `rebase dev` ou do seu deploy |
| `websocketUrl` | `string` | URL do WebSocket — derivada automaticamente de `baseUrl` se omitida |
| `token` | `string` | Token JWT estático para chamadas server-to-server |
| `apiPath` | `string` | Prefixo da API (padrão: `"/api"`) |
| `fetch` | `typeof fetch` | Implementação de fetch customizada (ex.: para SSR) |
| `onUnauthorized` | `() => Promise<boolean>` | Manipulador de 401 customizado — retorne `true` para tentar novamente |
| `realtime` | `boolean \| RealtimeClientOptions` | Abre o WebSocket (padrão `true`) — defina como `false` em scripts de execução única (one-shot). `{ affinity }` [define o nome do grupo ao qual o socket pertence](/docs/sdk/realtime#keeping-a-group-on-one-instance) |
| `tables` | `Record<string, string>` | <span class="since-badge" data-since="0.31">Desde 0.31</span> Mapeia nomes de acessores para slugs de tabelas — o `tablesDictionary` gerado |
| `offline` | `boolean \| OfflineConfig` | [Sincronização local-first](/docs/sdk/offline) — desativada por padrão |
| `impersonate` | `string` | Executa todas as requisições como este usuário, pelo uid, para verificar o que esse usuário pode ver. Apenas uma sessão de administrador pode fazer isso: a API de dados, funções e realtime rodam como esse usuário, e todas as outras rotas recusam |
| `debug` | `boolean` | Registra o progresso da conexão realtime com `console.debug` (padrão `false`) — consulte [Logs de conexão](#logs-de-conexão) |

### Logs de conexão

Por padrão, o cliente não exibe nada sobre sua conexão realtime, para que uma página pública não revele informações sobre seu backend no console do visitante. Avisos e erros são sempre exibidos. Para ver a conexão abrindo, autenticando, caindo e reconectando, passe `debug: true`, ou ative em um navegador específico sem alterar o site executando isto no console dele:

```js
localStorage.setItem("rebase_debug", "1"); // localStorage.removeItem("rebase_debug") to stop
```

Isso se aplica a partir da próxima linha que o cliente registrar, portanto, uma página que já está conectada não precisa ser recarregada. Fora de um navegador, defina `globalThis.__REBASE_DEBUG__ = true`. Os navegadores exibem o `console.debug` apenas no nível Verbose (detalhado).

## Geração de SDK Tipado

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Gere um cliente totalmente tipado a partir de suas tabelas:

```bash
rebase generate-sdk
```

Enquanto o `rebase dev` estiver em execução, você não precisa fazer isso: ele regenera os tipos em
`generated/sdk/` na inicialização e a cada salvamento em `backend/schema/`. Execute o comando
manualmente no CI, em um repositório de frontend que não tenha tabelas próprias
(`rebase generate-sdk --from link`), ou em qualquer lugar onde o `rebase dev` não esteja rodando.
O `generate-sdk` lê as tabelas que `backend/schema/index.ts` exporta, por meio do
mesmo carregador pelo qual o backend inicializa; `--from`, em vez disso, lê as `tables` de um
backend em execução em `/api/meta/contract`.

Em seguida, passe o parâmetro de tipo `Database` para `createRebaseClient` para obter autocompletar completo:

```typescript
import { createRebaseClient } from "@rebasepro/client";
import { tablesDictionary, type Database } from "./generated/sdk/database.types";

const client = createRebaseClient<Database>({
    baseUrl: import.meta.env.VITE_API_URL,
    tables: tablesDictionary,
});

// Full autocomplete on table names and field types
const { data } = await client.data.products.find();
```

Quando `Database` é fornecido, o `createRebaseClient` retorna uma instância de `CreateRebaseClientResult<DB>`. Isso mapeia os acessores de tabela em camelCase diretamente em `client.data` para seus tipos correspondentes, fornecendo autocompletar completo para operações e tipos de tabela (ex.: `client.data.products.find()`).

O `tablesDictionary` mapeia cada acessor de volta para o slug usado na comunicação (wire). O módulo gerado também exporta `TableName`, a união de todos os slugs, e o tipo `TablesDictionary`. **`tables` é obrigatório para um cliente tipado.** Os tipos oferecem todos os acessores, quer você os passe ou não, mas sem isso `client.data.myNotes` é enviado para `/data/my_notes`, o acessor em snake_case, de modo que um slug como `my-notes` ou um acessor renomeado responderá com 404. O cliente emite um aviso uma única vez, indicando o acessor e a correção. Com o dicionário, um acessor que não constar nele lançará um `RebaseClientError` com o código `UNKNOWN_TABLE` e uma sugestão. Uma versão futura tornará `tables` obrigatório nos tipos quando `Database` for fornecido.

Alguns nomes em `client.data` são reservados: `table` é a função dinâmica `table(slug)`, `batch` é [`client.batch`](/docs/sdk/writing/#writing-across-tables), e `then`, `toJSON` e `$$typeof` são preservados para verificações de promises e serialização. Uma tabela cujo acessor seria `table`, `then`, `toJSON` ou `$$typeof` é gerada como `<name>Table` — o slug `table` fica como `client.data.tableTable` — e o `generate-sdk` exibe um aviso mencionando ambos. `client.data.table("table")` também a acessa, e é assim que uma tabela cujo acessor seria `batch` pode ser acessada. O `data.table(slug)` recusa um slug com um segmento `.` ou `..`, que sairia de `/data`, gerando `INVALID_TABLE_PATH`.

### Nomes de campos

**O nome de um campo na transmissão (wire) é a chave de sua coluna**, e a API utiliza camelCase do início ao fim. Uma coluna `createdAt` armazenada como `created_at` é `row.createdAt`, e a chave estrangeira de uma relação é `authorId`, mesmo que a coluna permaneça como `author_id`. `where` e `orderBy` são baseados no mesmo tipo `Row`, de modo que o que compila é exatamente o que o backend atende.

Uma chave de coluna que *você* escreveu é sua chave, independentemente do formato — nada renomeia um nome que você escolheu. As duas chaves que são derivadas em vez de declaradas, a chave estrangeira de uma relação e uma coluna lida via introspecção, ficam em camelCase.

`Row` descreve uma leitura, `Insert` um `create()` e `Update` um `update()` — eles não possuem o mesmo formato. Uma coluna que não é obrigatória é `T | null` em todos os três, para que uma escrita possa limpá-la; a chave primária está sempre presente em uma leitura e nunca pode ser definida em uma atualização; o destino de um `belongsTo` pode ser escrito como a relação (`{ author: 5 }`) ou como sua chave estrangeira (`{ authorId: 5 }`), e uma relação obrigatória é satisfeita por qualquer uma das formas; um `hasOne` é escrito informando a linha de destino (`{ profile: 9 }`), ou `null` para desvinculá-la; um `via` de salto único (single-hop) é escrito como o tipo que ele representa (to-one: o id do destino ou `null`; to-many: uma lista de ids), e um de múltiplos saltos (multi-hop) é somente leitura e não está em nenhum dos dois; e a associação `hasMany` ou `manyToMany` é escrita como uma lista de ids de destino ou objetos `{ id }` (`{ tags: ["t-1"] }`), cada um contendo um `_pivot` quando a junção declara colunas de payload. Um campo que ninguém pode escrever (`.access({ write: [] })`) não está presente nem em `Insert` nem em `Update`. Uma coluna `date` é lida como uma string ISO, e a escrita aceita tanto essa string quanto um `Date`.

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

Em um frontend Rebase, o cliente é criado uma única vez e compartilhado via contexto:

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
- **[Subscrições em Tempo Real](/docs/sdk/realtime)** — Dados em tempo real com WebSockets
- **[Sincronização Offline e Local-First](/docs/sdk/offline)** — Trabalhe sem conexão e sincronize quando ela retornar
- **[Armazenamento e Arquivos](/docs/sdk/storage)** — Faça upload, download e gerencie arquivos
