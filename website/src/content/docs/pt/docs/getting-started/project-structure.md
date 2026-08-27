---
title: Estrutura do Projeto
sidebar_label: Estrutura do Projeto
description: Compreenda a estrutura de um projeto Rebase — frontend, backend e coleções compartilhadas.
---

Um projeto inicial Rebase possui três pacotes interconectados:

```
my-app/
├── .env                    # Variáveis de ambiente (DATABASE_URL, JWT_SECRET, etc.)
├── package.json            # Configuração do workspace raiz
│
├── frontend/               # Painel de administração React (Vite)
│   ├── src/
│   │   ├── App.tsx         # Componente principal da aplicação
│   │   ├── main.tsx        # Ponto de entrada do React
│   │   └── index.css       # Estilos globais
│   ├── package.json
│   └── vite.config.ts
│
├── backend/                # Servidor API Node.js (Hono)
│   ├── src/
│   │   ├── index.ts        # Ponto de entrada do servidor — inicializa o backend Rebase
│   │   └── schema.generated.ts  # Esquema Drizzle auto-gerado
│   ├── drizzle.config.ts   # Configuração do ORM Drizzle
│   ├── Dockerfile
│   └── package.json
│
└── config/                 # Definições de coleção
    └── collections/
        ├── index.ts        # Exporta todas as coleções
        └── products.ts     # Exemplo: coleção de produtos
```

## Frontend (`frontend/`)

O frontend é uma aplicação padrão **Vite + React + TypeScript**. O arquivo chave é `App.tsx`, que conecta todos os controladores Rebase:

```typescript title="frontend/src/App.tsx"
import { Rebase } from "@rebasepro/app";
import { Scaffold, AppBar, Drawer } from "@rebasepro/cms";
import { createRebaseClient } from "@rebasepro/client";
import { collections } from "virtual:rebase-collections";

// O cliente se conecta à sua API de backend e WebSocket
const rebaseClient = createRebaseClient({
    baseUrl: "http://localhost:3001",
    websocketUrl: "ws://localhost:3001"
});

// As coleções são importadas via um módulo virtual Vite
// que lê do diretório config/
```

### Conceitos Chave

- **`createRebaseClient`** — Cria o cliente SDK que lida com requisições HTTP, conexões WebSocket e gerenciamento de tokens de autenticação
- **`virtual:rebase-collections`** — Um plugin Vite que auto-importa suas coleções compartilhadas durante a compilação
- **Controladores** — `useBuildNavigationStateController`, `useBuildCollectionRegistryController`, etc. — estes configuram o roteamento, a resolução de coleções e a configuração da UI

## Backend (`backend/`)

O backend é um **servidor Node.js** construído sobre [Hono](https://hono.dev/) (um framework HTTP rápido e leve). O ponto de entrada `index.ts` inicializa tudo:

```typescript title="backend/src/index.ts"
import { initializeRebaseBackend } from "@rebasepro/server";
import { createPostgresAdapter } from "@rebasepro/server-postgres";
import { Hono } from "hono";
import type { HonoEnv } from "@rebasepro/server";

const app = new Hono<HonoEnv>();

await initializeRebaseBackend({
    app,
    server,
    collectionsDir: "./config/collections",
    database: createPostgresAdapter({
            connection: db,
            schema: { tables, enums, relations }
        }),
    auth: {
        jwtSecret: process.env.JWT_SECRET!,
        google: { clientId: process.env.GOOGLE_CLIENT_ID },
    },
    storage: {
        type: "local",
        basePath: "./uploads"
    },
    history: true
});
```

`initializeRebaseBackend` configura:
- Rotas de **REST API** em `/api/data/*` — CRUD auto-gerado para cada coleção
- Rotas de **Autenticação** em `/api/auth/*` — cadastro, login, refresh, Google OAuth
- Rotas de **Armazenamento** em `/api/storage/*` — upload/download de arquivos
- Servidor **WebSocket** — sincronização de entidades em tempo real via Postgres LISTEN/NOTIFY
- **Histórico** — registro de trilha de auditoria em cada alteração de entidade

## Coleções Compartilhadas (`config/`)

As coleções são a **única fonte de verdade** para o seu modelo de dados. Elas são definidas como TypeScript e consumidas tanto pelo frontend (para geração da UI) quanto pelo backend (para geração de esquema e roteamento da API).

```typescript title="config/collections/products.ts"
import { defineCollection } from "@rebasepro/cms-types";

export const productsCollection = defineCollection({
    slug: "products",
    name: "Products",
    table: "products",
    properties: {
        name: { type: "string", name: "Name" },
        price: { type: "number", name: "Price" }
    }
});
```

O `slug` se torna o caminho da URL na UI de administração e o endpoint da API REST (`/api/data/products`). A `table` mapeia para o nome da tabela PostgreSQL.

## Como Eles se Conectam

1. **Você define** coleções em `config/`
2. **O backend** as lê para gerar esquemas Drizzle e montar rotas REST
3. **O frontend** as lê (via plugin Vite) para renderizar tabelas, formulários e navegação
4. **A CLI** as lê para gerar arquivos de migração com `rebase schema generate`

As alterações nas coleções se propagam automaticamente para todos os lugares.

## Próximos Passos

- **[Início Rápido](/docs/getting-started/quickstart)** — Comece com um novo projeto Rebase
- **[Configuração](/docs/getting-started/configuration)** — Todas as variáveis de ambiente e opções

---
