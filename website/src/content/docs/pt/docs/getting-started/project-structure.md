---
sourceHash: 8fb63312e30e41a2
title: Estrutura do Projeto
sidebar_label: Estrutura do Projeto
description: Entenda a estrutura de um projeto Rebase — frontend, backend e configuração de coleções.
---

:::note[Cinco palavras que esta página usa]
Cada uma delas significa algo específico aqui, e quatro delas significam outra coisa em outros lugares da indústria.

- **Collection** — uma tabela, descrita em TypeScript. O schema, a API e a tela de administração vêm todos do mesmo arquivo.
- **Studio** — a metade do desenvolvedor no painel de administração: editor de schema, console SQL, navegador de políticas. O mesmo aplicativo que sua equipe de conteúdo usa, atrás de um toggle.
- **Managed runtime** — a imagem publicada de `rebasepro/server` inicializa seu projeto. Você não escreve nenhum arquivo de servidor e obtém atualizações de runtime sem uma recompilação. A alternativa é o `rebase eject`, abaixo.
- **Bundle** — o que o `rebase build` produz: suas coleções, funções e crons compilados, com um manifesto indicando onde cada um está. É o que o runtime gerenciado inicializa.
- **Resource** — algo de que o projeto precisa de onde quer que seja executado: um banco de dados, um bucket, um tópico. Declarado em `config/resources.ts`, vinculado por variáveis de ambiente.
:::

Um projeto inicial do Rebase possui três pacotes interconectados:

```
my-app/
├── .env                    # Generated for you: JWT_SECRET, a database password, a free port
├── rebase.json             # Which apps this repository contains, and how each is built
├── package.json            # Root workspace config
├── docker-compose.yml      # Self-hosting: Postgres + the published runtime image
│
├── config/                 # Shared by the backend and the admin panel
│   ├── index.ts            # Re-exports what the runtime reads (collections, storageAuthorize)
│   ├── collections/        # Your data model
│   │   ├── index.ts        # Exports `collections` and the default security rules
│   │   ├── posts.ts        # Example collections
│   │   └── users.ts        # The auth collection
│   ├── resources.ts        # What this project needs from wherever it runs
│   ├── storage.ts          # Who may read, write and list files
│   └── cms.d.ts            # One line that makes the `admin` block legal here
│
├── backend/
│   ├── functions/          # Custom API routes, auto-mounted at /api/functions/<name>
│   │   └── hello.ts
│   └── src/
│       └── schema.generated.ts   # Drizzle schema, regenerated from your collections
│
└── frontend/               # The admin panel (React + Vite)
    ├── src/App.tsx
    ├── src/main.tsx
    └── vite.config.ts
```

:::note[Não há `backend/src/index.ts`]
E nenhum `Dockerfile`. Um projeto gerado declara `runtime: "managed"` no `rebase.json`, o que significa que a **imagem publicada de `rebasepro/server` inicializa seu projeto como um bundle** — o mesmo artefato, quer você faça auto-hospedagem ou implante no Rebase Cloud. Você configura o servidor através do `rebase.json`, `config/` e variáveis de ambiente, em vez de escrever um ponto de entrada.

Se você quiser ter o controle do processo — seus próprios middlewares, suas próprias rotas, sua própria configuração de autenticação — o `rebase eject` cria o ponto de entrada, um Dockerfile e um arquivo compose que os compila. Consulte [Integração de Servidor Personalizado](/docs/backend/custom-server).
:::

## Frontend (`frontend/`)

O frontend é uma aplicação padrão **Vite + React + TypeScript**. O arquivo principal é o `App.tsx`, que conecta todos os controladores do Rebase:

```typescript title="frontend/src/App.tsx"
import React from "react";

import "@fontsource/jetbrains-mono";
import "@fontsource-variable/inter";
import "@fontsource-variable/instrument-sans";

import { Rebase, RebaseAuth, useRebaseAuthController } from "@rebasepro/app";
import { RebaseCMS, RebaseShell } from "@rebasepro/cms";
import { ErrorBoundary } from "@rebasepro/ui";
import { RebaseStudio } from "@rebasepro/studio";
import { createRebaseClient } from "@rebasepro/client";
import { collections } from "virtual:rebase-collections";

// `rebase dev` injects VITE_API_URL with the port it actually bound, and that
// port is derived from this project's path rather than fixed — so a
// `http://localhost:3001` fallback here names a port nothing is listening on.
// A deployed build serves the admin from the same origin as the API, where an
// empty value is exactly what you want.
const API_URL = import.meta.env.VITE_API_URL;
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

export function App() {
    const rebaseClient = React.useMemo(() => createRebaseClient({
        baseUrl: API_URL,
        // Store the refresh token in an httpOnly cookie (XSS-safe) rather than
        // localStorage. The backend issues it via `auth.cookieAuth`.
        auth: { authFlowMode: "cookie" }
    }), []);

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
                <RebaseCMS
                    collections={collections}
                />
                <RebaseStudio/>
                <RebaseShell title="Rebase"/>
            </Rebase>
        </ErrorBoundary>
    );
}
```

O `main.tsx` o monta sob um `basename` do `react-router` obtido a partir de `import.meta.env.BASE_URL`, que o `rebase build` define a partir do `path` declarado por este aplicativo no `rebase.json` — para que os assets, o roteador e o servidor concordem em um único valor sem que ele precise ser escrito três vezes.

### Conceitos Principais

- **`createRebaseClient`** — Cria o cliente SDK que lida com requisições HTTP, conexões WebSocket e gerenciamento de tokens de autenticação
- **`virtual:rebase-collections`** — Um plugin do Vite que importa automaticamente suas coleções compartilhadas em tempo de build
- **`useRebaseAuthController`** — Mantém o usuário autenticado e o ciclo de vida do token, sendo o que o `<Rebase>` distribui para tudo abaixo dele

## Backend (`backend/`)

Não há nenhum arquivo de servidor para ler, e esse é o design pretendido: um projeto gerado declara `runtime: "managed"`, portanto a imagem publicada de `rebasepro/server` inicializa seu projeto. O que a pasta `backend/` contém é o código que o runtime utiliza:

| Caminho | O que é |
|---|---|
| `backend/functions/` | Rotas personalizadas, montadas automaticamente em `/api/functions/<filename>` |
| `backend/crons/` | Tarefas agendadas, descobertas da mesma forma (crie quando precisar de uma) |
| `backend/src/schema.generated.ts` | O schema do Drizzle, regenerado a partir de suas coleções a cada `rebase dev` e `rebase build` |

O runtime configura:

- **API REST** em `/api/data/*` — CRUD gerado para cada coleção
- **Autenticação** em `/api/auth/*` — cadastro, login, atualização de token (refresh), OAuth
- **Armazenamento (Storage)** em `/api/storage/*` — upload e download
- **WebSocket** — sincronização em tempo real via Postgres LISTEN/NOTIFY
- **Suas funções e crons**, a partir dos diretórios acima

A configuração vem de `rebase.json`, do diretório `config/` e de variáveis de ambiente. Consulte [Ambiente e Configuração](/docs/getting-started/configuration).

O `rebase build` transforma tudo isso em um **bundle** — as coleções, funções e crons compilados, além de um manifesto — que o runtime gerenciado inicializa. Nada no bundle é escrito manualmente; se você quiser ver um, [Runtime e Bundles](/docs/architecture/runtime-and-bundles/) mostra o que há nele.

O painel fornecido pelo frontend tem duas metades. O **Studio** é a parte voltada ao desenvolvedor — o editor de schema, o console SQL, o navegador de políticas de RLS — e está localizado atrás do toggle na gaveta lateral (drawer), não sendo uma implantação separada. Consulte [Studio](/docs/studio/).

Para assumir o controle do processo — seus próprios middlewares, rotas e estrutura de autenticação —, execute `rebase eject`. **Tudo abaixo deste parágrafo aplica-se apenas a projetos ejetados (ejected-only)**: um projeto recém-gerado não possui nenhum desses arquivos, e nada nele chama `initializeRebaseBackend`. O comando cria um ponto de entrada que chama `initializeRebaseBackend` diretamente, além de um Dockerfile e um arquivo compose que o compila; a partir de então, você mantém o servidor e as atualizações do runtime da plataforma não afetam mais o projeto. Essa interface está documentada em [Integração de Servidor Personalizado](/docs/backend/custom-server).

## Coleções (`config/collections/`)

As coleções são a **única fonte da verdade** para o seu modelo de dados. Elas são definidas em TypeScript e consumidas tanto pelo frontend (para geração da UI) quanto pelo backend (para geração do schema e roteamento da API).

```typescript title="config/collections/products.ts"
import { defineCollection } from "@rebasepro/cms-types";

const productsCollection = defineCollection({
    slug: "products",
    name: "Products",
    properties: {
        name: { type: "string", name: "Name" },
        price: { type: "number", name: "Price" }
    }
});

// The default export is what the registry picks up — every collection in the
// scaffold is written this way.
export default productsCollection;
```

O `slug` torna-se o caminho da URL na interface administrativa e o endpoint da API REST (`/api/data/products`), e o nome da tabela do PostgreSQL é definido com ele por padrão. Adicione `table` apenas quando forem diferentes.

## Como Eles se Conectam

1. **Você define** as coleções em `config/collections/`
2. **O backend** as lê para gerar schemas do Drizzle e montar rotas REST
3. **O frontend** as lê (via plugin do Vite) para renderizar tabelas, formulários e navegação
4. **A CLI** as lê para gerar arquivos de migração com `rebase schema generate`

Enquanto o `rebase dev` estiver em execução, salvar um arquivo em `config/collections/` regenera `backend/src/schema.generated.ts` e reinicia o backend, e a inicialização cria as tabelas e colunas que estiverem faltando. Fora do `rebase dev`, essa mesma etapa é realizada com `rebase schema generate`.

## Próximos Passos

- **[Início Rápido](/docs/getting-started/quickstart)** — Comece a usar um novo projeto Rebase
- **[Configuração](/docs/getting-started/configuration)** — Todas as variáveis de ambiente e opções
