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
- **Docker** — para executar o contêiner PostgreSQL incluído. (Ou traga seu próprio PostgreSQL: instalação local, Neon, Supabase, etc.)
- **pnpm** (recomendado) ou npm

## Seu Ambiente Já Está Configurado

O `init` gera um arquivo `.env` pronto para uso na raiz do projeto, com um `JWT_SECRET` real, uma senha de banco de dados e uma porta de banco de dados local livre. Você não precisa criar nem editar nada para começar.

:::caution
Não execute `cp .env.example .env`. O `.env.example` é uma referência das variáveis disponíveis — copiá-lo sobre o seu `.env` descarta os segredos gerados e faz o `DATABASE_URL` apontar para um banco de dados que não existe. Edite o `.env` diretamente se quiser alterar algum valor.
:::

Se preferir apontar para o seu próprio PostgreSQL em vez do contêiner incluído, edite o `DATABASE_URL` no `.env`:

```bash
DATABASE_URL=postgresql://username:password@localhost:5432/your_database
```

## Inicie o Banco de Dados

A estrutura gerada inclui um `docker-compose.yml` com um serviço PostgreSQL. Inicie-o:

```bash
docker compose up -d db
```

(Pule esta etapa se você apontou o `DATABASE_URL` para o seu próprio banco de dados.)

## Crie as Tabelas

Envie suas coleções para o banco de dados. Isso cria as tabelas para as coleções de exemplo `posts`, `authors` e `tags`:

```bash
pnpm run db:push
```

Sem esta etapa o painel de administração ainda abre, mas todas as coleções ficam vazias e suas chamadas de API falham até que as tabelas existam.

## Introspecção de um Banco de Dados Existente (Opcional)

Se você estiver se conectando a um banco de dados existente com tabelas pré-existentes, poderá fazer a introspecção dele para gerar automaticamente seus arquivos de coleção do TypeScript:

```bash
pnpm rebase schema introspect
```

Isso analisará as tabelas do seu banco de dados e gerará os arquivos TypeScript correspondentes em `config/collections/`, para que você não precise escrevê-los manualmente.

## Inicie os Servidores de Desenvolvimento

```bash
pnpm dev
```

Isso inicia ambos juntos:
- **Backend** — REST API, autenticação, armazenamento, WebSocket
- **Frontend** — o painel de administração Rebase
- **Recarregamento rápido** para ambos — as alterações entram em vigor instantaneamente

Ambas as portas são **derivadas do caminho do projeto** em vez de fixas, então vários
projetos Rebase podem rodar ao mesmo tempo. `rebase dev` imprime as duas URLs às quais
se vinculou — use essas, não `localhost:3001`/`localhost:5173`. (`PORT` e
`VITE_API_URL` no `.env` configuram `rebase start`, o servidor de produção, e são
ignorados aqui.) Fixe uma porta com `rebase dev --port 3001`.

## Primeiro Login

Ao abrir a URL do frontend impressa pelo `rebase dev`, você verá a tela de login. O **primeiro usuário** a se registrar automaticamente se torna um administrador — este é o fluxo de inicialização.

1. Clique em **Cadastrar**
2. Digite seu e-mail e senha
3. Você está dentro — com acesso total de administrador

## Defina Sua Primeira Coleção

Abra `config/collections/` e crie um novo arquivo. Exporte a coleção como **exportação padrão** (`default export`) — é assim que o registro a reconhece:

```typescript title="config/collections/products.ts"
import { defineCollection } from "@rebasepro/cms-types";

const productsCollection = defineCollection({
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
            admin: { multiline: true }
        },
        active: {
            type: "boolean",
            name: "Active",
            defaultValue: true
        },
        createdAt: {
            type: "date",
            name: "Created At",
            autoValue: "on_create"
        }
    }
});

export default productsCollection;
```

Em seguida, registre-a em `config/collections/index.ts` para que tanto o backend quanto o painel de administração a conheçam:

```typescript title="config/collections/index.ts" {2,5}
// ...existing imports
import productsCollection from "./products.js";

export const collections = [
    postsCollection, authorsCollection, tagsCollection, usersCollection, productsCollection
];
```

## Crie a Tabela

Envie a nova coleção para o banco de dados:

```bash
pnpm run db:push
```

Isso regenera o esquema a partir das suas coleções e o aplica. Reinicie os servidores de desenvolvimento e sua nova coleção de **Produtos** aparecerá na navegação.

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
