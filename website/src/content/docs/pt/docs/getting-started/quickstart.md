---
title: Início Rápido
sidebar_label: Início Rápido
description: Crie um novo projeto Rebase e execute-o localmente em menos de 2 minutos.
---

## Crie um Novo Projeto

```bash
pnpm dlx @rebasepro/cli init my-app
```

Isso estrutura um projeto com três pacotes:

| Pasta | Descrição |
|--------|-------------|
| `frontend/` | SPA React — Vite + TypeScript com a interface de administração Rebase |
| `backend/` | Servidor Node.js — Hono, PostgreSQL via Drizzle ORM, WebSocket |
| `config/` | Definições de coleção TypeScript compartilhadas por ambos os lados |

## Pré-requisitos

- **Node.js** 18+
- **PostgreSQL** — instalação local, Docker, ou qualquer banco de dados gerenciado (Neon, Supabase, etc.)
- **pnpm** (recomendado) ou npm

## Configure Seu Ambiente

Após a estruturação, edite o arquivo `.env` na raiz do projeto:

```bash
# PostgreSQL connection string
DATABASE_URL=postgresql://username:password@localhost:5432/your_database

# JWT secret for authentication (generate a strong random string)
JWT_SECRET=change-me-to-a-random-secret

# Frontend URL for CORS
VITE_API_URL=http://localhost:3001

# Optional: Google OAuth client ID
# VITE_GOOGLE_CLIENT_ID=your-google-client-id
```

## Inicie os Servidores de Desenvolvimento

```bash
pnpm dev
```

Isso inicia:
- **Backend** em `http://localhost:3001` — REST API, autenticação, armazenamento, WebSocket
- **Frontend** em `http://localhost:5173` — painel de administração Rebase
- **Recarregamento rápido** para ambos — as alterações entram em vigor instantaneamente

Você também pode iniciá-los individualmente:

```bash
pnpm dev:backend   # Backend only
pnpm dev:frontend  # Frontend only
```

## Introspecção de um Banco de Dados Existente (Opcional)

Se você estiver se conectando a um banco de dados existente com tabelas pré-existentes, poderá fazer a introspecção dele para gerar automaticamente seus arquivos de coleção do TypeScript:

```bash
pnpm rebase schema introspect
```

Isso analisará as tabelas, enums e relações do seu banco de dados e gravará os arquivos de coleção correspondentes em `config/collections/`.

## Primeiro Login

Ao abrir `http://localhost:5173`, você verá a tela de login. O **primeiro usuário** a se registrar automaticamente se torna um administrador — este é o fluxo de inicialização.

1. Clique em **Cadastrar**
2. Digite seu e-mail e senha
3. Você está dentro — com acesso total de administrador

## Defina Sua Primeira Coleção

Abra `config/collections/` e crie um novo arquivo:

```typescript title="config/collections/products.ts"
import { CollectionConfig } from "@rebasepro/types";

export const productsCollection: CollectionConfig = {
    slug: "products",
    name: "Products",
    singularName: "Product",
    table: "products",
    properties: {
        name: {
            type: "string",
            name: "Name",
            validation: { required: true }
        },
        price: {
            type: "number",
            name: "Price",
            validation: { required: true, min: 0 }
        },
        description: {
            type: "string",
            name: "Description",
            multiline: true
        },
        active: {
            type: "boolean",
            name: "Active",
            defaultValue: true
        },
        created_at: {
            type: "date",
            name: "Created At",
            autoValue: "on_create"
        }
    }
};
```

## Gere o Esquema do Banco de Dados

```bash
rebase schema generate   # Generate Drizzle schema from your collections
rebase db push           # Push the schema to your database
```

Reinicie os servidores de desenvolvimento e sua nova coleção de **Produtos** aparecerá na navegação.

## Referência de Comandos do Banco de Dados

| Comando | Descrição |
|---------|-------------|
| `rebase schema generate` | Gera o esquema Drizzle a partir de suas coleções TypeScript |
| `rebase schema introspect` | Gerar coleções do TypeScript a partir de um banco de dados existente |
| `rebase db push` | Envia alterações de esquema diretamente para o banco de dados (somente desenvolvimento) |
| `rebase db generate` | Gera arquivos de migração SQL |
| `rebase db migrate` | Executa migrações pendentes |

## O Que Vem a Seguir

- **[Estrutura do Projeto](/docs/getting-started/project-structure)** — Entenda o código gerado
- **[Coleções](/docs/collections)** — Aprofunde-se na definição do esquema
- **[Ambiente e Configuração](/docs/getting-started/configuration)** — Todas as opções de configuração
- **[Implantação](/docs/getting-started/deployment)** — Implante para produção

---
