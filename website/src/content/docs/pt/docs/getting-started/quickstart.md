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
- **pnpm** (recomendado) ou npm

Nenhum banco de dados para instalar, e **sem Docker**. O `rebase dev` executa um PostgreSQL gerenciado para o projeto, com os dados em `.rebase/`. Veja [Use seu PostgreSQL](#use-seu-postgresql) se preferir fornecer o seu — uma instalação local, Neon, Supabase ou o contêiner que esta estrutura inclui.

## Seu Ambiente Já Está Configurado

O `init` gera um arquivo `.env` pronto para uso na raiz do projeto, com um `JWT_SECRET` real, uma senha de banco de dados e uma porta de banco de dados local livre. Você não precisa criar nem editar nada para começar.

:::caution
Não execute `cp .env.example .env`. O `.env.example` é uma referência das variáveis disponíveis — copiá-lo sobre o seu `.env` descarta os segredos gerados e faz o `DATABASE_URL` apontar para um banco de dados que não existe. Edite o `.env` diretamente se quiser alterar algum valor.
:::

## Inicie os Servidores de Desenvolvimento

```bash
pnpm install   # only if you declined the install `init` offered
pnpm dev
```

Essa é a primeira execução inteira — não há banco de dados para iniciar nem etapa de esquema para lembrar. O `rebase dev` faz três coisas antes de servir:

1. Gera `backend/src/schema.generated.ts` a partir de `config/collections/`.
2. Inicia um PostgreSQL gerenciado para este projeto, com os dados em `.rebase/`.
3. Aplica suas coleções a ele, de modo que as tabelas de exemplo `posts`, `authors` e `tags` existam.

Depois ele inicia as duas metades juntas:

- **Backend** — REST API, autenticação, armazenamento, WebSocket
- **Frontend** — o painel de administração Rebase
- **Recarregamento rápido** para ambos — as alterações entram em vigor instantaneamente

Ambas as portas são **derivadas do caminho do projeto** em vez de fixas, então vários
projetos Rebase podem rodar ao mesmo tempo. `rebase dev` imprime as duas URLs às quais
se vinculou — use essas, não `localhost:3001`/`localhost:5173`. (`PORT` e
`VITE_API_URL` no `.env` configuram `rebase start`, o servidor de produção, e são
ignorados aqui.) Fixe uma porta com `rebase dev --port 3001`.

## Use seu PostgreSQL

O `DATABASE_URL` está comentado no `.env` de propósito — é isso que torna o banco gerenciado o padrão. Aponte-o para qualquer PostgreSQL que quiser (uma instalação local, Neon, Supabase) e ele prevalece sobre o gerenciado:

```bash
DATABASE_URL=postgresql://username:password@localhost:5432/your_database
```

A estrutura gerada também inclui um `docker-compose.yml` com um serviço PostgreSQL, e a URL que já está no `.env` aponta para ele. Descomente essa linha e então:

```bash
docker compose up -d db
pnpm run db:push
pnpm dev
```

O `db:push` é o que cria as tabelas das suas coleções em um banco de dados que o Rebase não gerencia para você.

:::caution
`db:push`, `db:generate` e `db:migrate` planejam suas mudanças com o [Atlas](https://atlasgo.io), que compara seu esquema com um segundo banco de dados vazio. O banco de desenvolvimento gerenciado serve exatamente um, então os três se recusam a rodar contra ele e dizem isso, em vez de falhar pela metade. Lá você não precisa deles — o `rebase dev` aplica suas coleções no boot. Recorra a eles quando estiver em um PostgreSQL próprio, e para migrações, remoções e renomeações de colunas.
:::

## Introspecção de um Banco de Dados Existente (Opcional)

Se você estiver se conectando a um banco de dados existente com tabelas pré-existentes, poderá fazer a introspecção dele para gerar automaticamente seus arquivos de coleção do TypeScript:

```bash
pnpm rebase schema introspect
```

Isso analisará as tabelas do seu banco de dados e gerará os arquivos TypeScript correspondentes em `config/collections/`, para que você não precise escrevê-los manualmente.

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

Reinicie o `rebase dev`. Ele regenera o esquema a partir das suas coleções e aplica a nova tabela antes de servir, de modo que **Produtos** aparece na navegação.

Em um PostgreSQL seu, esse é o trabalho do `db:push`:

```bash
pnpm run db:push
```

## Referência de Comandos do Banco de Dados

| Comando | Descrição |
|---------|-------------|
| `rebase schema generate` | Gera o esquema Drizzle a partir de suas coleções TypeScript. Não precisa de banco de dados — o `rebase dev` o executa para você |
| `rebase schema introspect` | Gerar coleções do TypeScript a partir de um banco de dados existente |
| `rebase db push` | Envia alterações de esquema diretamente para o banco de dados. Precisa do seu próprio PostgreSQL |
| `rebase db generate` | Gera arquivos de migração SQL. Precisa do seu próprio PostgreSQL |
| `rebase db migrate` | Executa migrações pendentes. Precisa do seu próprio PostgreSQL |

## O Que Vem a Seguir

- **[Estrutura do Projeto](/docs/getting-started/project-structure)** — Entenda o código gerado
- **[Coleções](/docs/collections)** — Aprofunde-se na definição do esquema
- **[Ambiente e Configuração](/docs/getting-started/configuration)** — Todas as opções de configuração
- **[Implantação](/docs/getting-started/deployment)** — Implante para produção

---
