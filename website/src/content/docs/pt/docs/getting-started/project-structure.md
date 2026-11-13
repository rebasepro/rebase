---
sourceHash: c6b361597710219f
title: Estrutura do Projeto
sidebar_label: Estrutura do Projeto
description: "A estrutura de um projeto Rebase — as tabelas em backend/schema, os módulos de backend lidos pelo runtime e as personalizações do painel administrativo em frontend/src/cms — com e sem o painel."
---

:::note[Seis palavras que esta página utiliza]
Cada uma delas tem um significado específico aqui, e a maioria significa algo
diferente em outros lugares da indústria.

- **Tabela** — uma tabela do Postgres, declarada em TypeScript com `defineTable` em
  `backend/schema/`. O SQL, as políticas de segurança a nível de linha (row-level security), a API,
  os tipos do SDK e os padrões do painel administrativo vêm todos dela.
- **Coleção** — o que o painel administrativo exibe: uma tabela renderizada como uma lista e um
  formulário, personalizada em `frontend/src/cms/`, ou uma coleção do Firestore que o painel
  lê diretamente.
- **Studio** — a parte do desenvolvedor do painel administrativo: editor de schema, console
  SQL, navegador de políticas. A mesma aplicação que sua equipe de conteúdo usa, atrás de um botão de alternância.
- **Runtime gerenciado** — a imagem publicada `rebasepro/server` inicializa seu
  projeto. Você não escreve nenhum arquivo de servidor e recebe atualizações de runtime sem
  necessidade de rebuild. A alternativa é `rebase eject`, abaixo.
- **Bundle** — o que o `rebase build` produz: suas tabelas, funções e crons,
  compilados, com um manifesto indicando onde cada um está. É o que o runtime
  gerenciado inicializa.
- **Recurso** — algo que o projeto precisa de onde quer que seja executado: um banco de dados,
  um bucket, um tópico. Declarado em `backend/resources.ts`, vinculado por variáveis
  de ambiente.
:::

<span class="since-badge" data-since="0.31">Desde 0.31</span>

O `rebase init` cria uma estrutura inicial com um de dois layouts. Ambos têm o mesmo `backend/`; a
diferença é se o projeto possui o painel administrativo.

**Com o painel administrativo** (o padrão):

```
my-app/
├── .env                    # Generated for you: JWT_SECRET, a database password, a free port
├── rebase.json             # Which apps this repository contains, and how each is built
├── package.json            # Root workspace config
├── tsconfig.json           # Typechecks scripts/; each workspace typechecks on its own
├── docker-compose.yml      # Self-hosting: Postgres + the published runtime image
├── scripts/
│   └── example.ts          # A health check and an SDK call to uncomment: `pnpm example`
│
├── backend/
│   ├── schema/             # Your tables
│   │   ├── index.ts        # Exports every table, and the optional defaultRls
│   │   ├── posts.ts        # defineTable("posts", …)
│   │   └── users.ts        # defineAuthTable("users", …)
│   ├── resources.ts        # What this project needs from wherever it runs
│   ├── storage.ts          # Who may read, write and list files (storageAuthorize)
│   ├── functions/          # Custom API routes, auto-mounted at /api/functions/<name>
│   │   └── hello.ts
│   └── src/
│       └── schema.generated.ts   # Drizzle schema, regenerated from your tables
│
└── frontend/               # The admin panel (React + Vite)
    ├── src/
    │   ├── App.tsx
    │   ├── main.tsx
    │   └── cms/            # How tables look in the panel: customizeTable(...)
    │       └── posts.tsx
    └── vite.config.ts
```

**Apenas backend** (`rebase init --headless`): o mesmo `backend/`, sem
`frontend/` — e também sem `backend/schema/`. O servidor lê as próprias tabelas
do banco de dados na inicialização e disponibiliza cada uma que tenha row-level security habilitada. Consulte
[Apenas backend](/docs/getting-started/headless/).

```
my-api/
├── .env
├── rebase.json
├── package.json
└── backend/
    ├── storage.ts
    └── functions/
```

Mais dois arquivos aparecem quando você precisar deles, e o runtime lê ambos:
`backend/hooks.ts`, cuja exportação `hooks` é executada para cada tabela
([Hooks globais](/docs/backend/hooks/)), e `backend/crons/`, para tarefas
agendadas. `rebase generate-sdk --register` adiciona `backend/generated/`.

O `tsc --noEmit` na raiz verifica `scripts/`; em `backend/` ou `frontend/`, ele
verifica esse workspace específico. Não há um pacote `config/` separado: o frontend
importa uma tabela de `backend/schema` apenas como tipo (`import type`). Importar
como valor qualquer coisa sob `backend/` enviaria código do servidor — hooks e os
segredos que eles leem — para o navegador, portanto o `rebaseBackendGuard()` de
`@rebasepro/app/vitePlugin`, no `frontend/vite.config.ts` do scaffolding, faz o
`vite build` e o `vite dev` falharem quando algo é resolvido em `backend/`, indicando o
importador, a importação e o arquivo. O `rebase build` recusa um frontend sem
isso. Para adicioná-lo a um projeto existente, importe-o e adicione `rebaseBackendGuard()`
a `plugins` em `frontend/vite.config.ts`.

:::note[Não há backend/src/index.ts]
E nenhum `Dockerfile`. Um projeto gerado declara `runtime: "managed"` no
`rebase.json`, o que significa que a **imagem publicada `rebasepro/server` inicializa seu
projeto como um bundle** — o mesmo artefato, quer você faça self-hosting ou faça deploy
no Rebase Cloud. Você configura o servidor através do `rebase.json`, dos arquivos em
`backend/` e de variáveis de ambiente, em vez de escrever um ponto de entrada.

Se quiser ter o controle total do processo — seus próprios middlewares, suas próprias rotas, sua própria
configuração de autenticação — o `rebase eject` cria o ponto de entrada, um Dockerfile e um arquivo compose
que os compila. Consulte [Integração de Servidor Customizado](/docs/backend/custom-server).
:::

## Tabelas (`backend/schema/`)

<span class="since-badge" data-since="0.31">Desde 0.31</span>

As tabelas são a **fonte única da verdade** para o seu modelo de dados:

```typescript title="backend/schema/products.ts"
import { defineTable, col } from "@rebasepro/server/schema";

export const products = defineTable("products", {
    columns: {
        id:    col.uuid().primaryKey().defaultRandom(),
        name:  col.text().notNull(),
        price: col.numeric(),
    },
    rls: "admin-only",
});
```

O nome torna-se o endpoint REST (`/api/data/products`), o nome da tabela no
Postgres e a rota do painel; `table` e `slug` os sobrescrevem. `rls` é
obrigatório. Uma tabela é considerada assim que `backend/schema/index.ts` a exporta — um
`defineTable` que o index omitir impedirá a inicialização. [Tabelas](/docs/schema/)
cobre todas as opções.

## Frontend (`frontend/`)

O frontend é uma aplicação padrão **Vite + React + TypeScript**. O arquivo principal é o `App.tsx`, que conecta todos os controladores do Rebase:

```tsx title="frontend/src/App.tsx"
import "@fontsource/jetbrains-mono";
import "@fontsource-variable/inter";
import "@fontsource-variable/instrument-sans";

import { Rebase, RebaseAuth, useRebaseAuthController } from "@rebasepro/app";
import { RebaseCMS, RebaseShell } from "@rebasepro/cms";
import { ErrorBoundary } from "@rebasepro/ui";
import { RebaseStudio } from "@rebasepro/studio";
import { createRebaseClient } from "@rebasepro/client";
import { postsCms } from "./cms/posts";
import { authorsCms } from "./cms/authors";
import { tagsCms } from "./cms/tags";
import { usersCms } from "./cms/users";
// How the collection editor laid out the tables in development (labels, columns, views).
import uiConfig from "./cms/ui-config.json";

// `rebase dev` injects VITE_API_URL with the port it actually bound, and that
// port is derived from this project's path rather than fixed — so a
// `http://localhost:3001` fallback here names a port nothing is listening on.
// A deployed build serves the admin from the same origin as the API, where an
// empty value is exactly what you want.
const API_URL = import.meta.env.VITE_API_URL;
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

// One client for the page, created when this module loads. Inside a component,
// even in a `useMemo`, `<React.StrictMode>` builds a second one in development,
// and both restore the session and open their own connections.
const rebaseClient = createRebaseClient({
    baseUrl: API_URL,
    // Store the refresh token in an httpOnly cookie (XSS-safe) rather than
    // localStorage. The backend issues it via `auth.cookieAuth`.
    auth: { authFlowMode: "cookie" }
});

export function App() {
    const authController = useRebaseAuthController({
        client: rebaseClient,
        googleClientId: GOOGLE_CLIENT_ID
    });

    return (
        <ErrorBoundary fullPage>
            <Rebase
                client={rebaseClient}
                authController={authController}
            >
                {/* The sign-in screen. On its own this changes nothing —
                    it is where you pass `loginView` to replace it. */}
                <RebaseAuth />
                {/* Every table the backend serves gets an admin view with no
                    code. A file in ./cms changes how one of them looks:
                    labels, icons, enum colours, custom fields and actions. */}
                <RebaseCMS tableCustomizations={[postsCms, authorsCms, tagsCms, usersCms]} uiConfig={uiConfig} />
                <RebaseStudio/>
                <RebaseShell title="Rebase"/>
            </Rebase>
        </ErrorBoundary>
    );
}
```

O `main.tsx` o monta sob um `basename` do `react-router` obtido de
`import.meta.env.BASE_URL`, que o `rebase build` define a partir do `path` que este app
declara no `rebase.json` — assim, os assets, o roteador e o servidor concordam em
um único valor sem a necessidade de escrevê-lo três vezes.

### Conceitos-Chave

<span class="since-badge" data-since="0.31">Desde 0.31</span>

- **`createRebaseClient`** — Cria o cliente do SDK que gerencia requisições HTTP, conexões WebSocket e o gerenciamento de tokens de autenticação. Chame-o uma única vez, no escopo do módulo: dentro de um componente, mesmo em um `useMemo`, o `<React.StrictMode>` cria um segundo cliente em desenvolvimento
- **`<RebaseCMS tableCustomizations>`** — o painel renderiza cada tabela que o backend disponibiliza em `GET /api/schema/tables`; os objetos `customizeTable` de `frontend/src/cms/` alteram a aparência de alguns deles, e `uiConfig` contém o que o editor de coleções salvou em desenvolvimento. Consulte [Personalizando uma tabela](/docs/frontend/customize-table/#customizations-ui-configjson-and-preferences)
- **`useRebaseAuthController`** — Mantém o usuário autenticado e o ciclo de vida do token, e é o que o `<Rebase>` distribui para tudo abaixo dele

## Backend (`backend/`)

Não há arquivo de servidor para ler, e esse é o design pretendido: um projeto gerado
declara `runtime: "managed"`, portanto a imagem publicada `rebasepro/server` inicializa
seu projeto. O que `backend/` contém é o código que o runtime carrega:

| Caminho | O que é |
|---|---|
| `backend/schema/` | As tabelas e o `defaultRls` que o index delas exporta |
| `backend/resources.ts`, `backend/storage.ts`, `backend/hooks.ts` | Recursos declarados, `storageAuthorize` e hooks globais de tabela |
| `backend/functions/` | Rotas customizadas, montadas automaticamente em `/api/functions/<filename>` |
| `backend/crons/` | Tarefas agendadas, descobertas da mesma forma (crie quando precisar de uma) |
| `backend/src/schema.generated.ts` | O schema do Drizzle das suas tabelas: gerado pelo `rebase init` e regenerado a cada `rebase dev` e `rebase build` |

O runtime configura:

- **API REST** em `/api/data/*` — CRUD gerado para cada tabela
- **Autenticação (Auth)** em `/api/auth/*` — cadastro, login, refresh, OAuth
- **Armazenamento (Storage)** em `/api/storage/*` — upload e download
- **WebSocket** — sincronização em tempo real via Postgres LISTEN/NOTIFY
- **Suas funções e crons**, a partir dos diretórios acima

A configuração vem de `rebase.json`, dos arquivos em `backend/` e de variáveis
de ambiente. Consulte [Ambiente e Configuração](/docs/getting-started/configuration).

O `rebase build` transforma tudo isso em um **bundle** — as tabelas compiladas,
funções e crons, além de um manifesto — que o runtime gerenciado inicializa. Nada
no bundle é escrito manualmente; se quiser ver um,
[Runtime e Bundles](/docs/architecture/runtime-and-bundles/) descreve o que há nele.

O painel servido pelo frontend tem duas partes. O **Studio** é a parte do desenvolvedor —
o editor de schema, o console SQL, o navegador de políticas RLS — e fica atrás
do botão de alternância na barra lateral, não sendo uma implantação separada. Consulte [Studio](/docs/studio/).

Para assumir o controle do processo — seus próprios middlewares, rotas e configuração
de autenticação —, execute `rebase eject`. **Tudo abaixo deste parágrafo aplica-se apenas a projetos que passaram por eject**:
um projeto recém-criado não tem nenhum desses arquivos, e nada nele chama
`initializeRebaseBackend`. Ele grava um ponto de entrada que chama
`initializeRebaseBackend` diretamente, além de um Dockerfile e um arquivo compose que o
compila; a partir de então, você mantém o servidor e as atualizações de runtime da plataforma
não afetam mais o projeto. Essa superfície está documentada em
[Integração de Servidor Customizado](/docs/backend/custom-server).

## Como Eles se Conectam

<span class="since-badge" data-since="0.31">Desde 0.31</span>

1. **Você declara** tabelas em `backend/schema/`
2. **O backend** as compila, cria as tabelas e políticas, e monta rotas REST, de tempo real e MCP
3. **O painel administrativo** as lê a partir de `GET /api/schema/tables` e renderiza uma visualização para cada uma, modificada pelos arquivos em `frontend/src/cms/`
4. **A CLI** as lê para gerar o schema do Drizzle (`rebase schema generate`), os tipos do SDK (`rebase generate-sdk`) e, a partir desse schema, os arquivos de migração (`rebase db generate`)

Enquanto o `rebase dev` estiver em execução, salvar um arquivo em `backend/schema/`
regenera o `backend/src/schema.generated.ts` e os tipos do SDK em
`generated/sdk/`, reinicia o backend, e a inicialização cria as tabelas e colunas
ausentes. Fora do `rebase dev`, essas mesmas etapas são `rebase schema generate`
e `rebase generate-sdk`.

Um projeto anterior à versão 0.31 possui um diretório `config/collections/`. Qualquer
comando o recusará e indicará `rebase migrate collections-to-tables`, que realiza a
migração — consulte [o guia de atualização](/docs/upgrading/0-30-to-0-31/).

## Próximos Passos

- **[Início Rápido](/docs/getting-started/quickstart)** — Comece com um novo projeto Rebase
- **[Tabelas](/docs/schema/)** — Declare seu modelo de dados
- **[Configuração](/docs/getting-started/configuration)** — Todas as variáveis de ambiente e opções
