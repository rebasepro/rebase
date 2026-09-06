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

- **Node.js** 22.22 ou mais recente (a versão no `.nvmrc`)
- **pnpm** (recomendado) ou npm

Nenhum banco de dados para instalar, e sem Docker. O `rebase dev` executa um PostgreSQL gerenciado para o projeto, com os dados em `.rebase/`. Veja [Variante: seu próprio PostgreSQL](#variante-seu-próprio-postgresql) se preferir fornecer o seu — uma instalação local, Neon, Supabase ou o contêiner que esta estrutura inclui.

## Seu Ambiente Já Está Configurado

O `init` gera um arquivo `.env` pronto para uso na raiz do projeto, com um `JWT_SECRET` real, uma senha de banco de dados e uma porta de banco de dados local livre. Você não precisa criar nem editar nada para começar.

:::caution
Não execute `cp .env.example .env`. O `.env.example` é uma referência das variáveis disponíveis — copiá-lo sobre o seu `.env` descarta os segredos gerados e faz o `DATABASE_URL` apontar para um banco de dados que não existe. Edite o `.env` diretamente se quiser alterar algum valor.
:::

## Inicie os Servidores de Desenvolvimento

```bash
pnpm install
pnpm run dev
```

É esse o primeiro start inteiro. Não há banco de dados para instalar nem passo de
schema: sem `DATABASE_URL` definida, o `rebase dev` sobe um **PostgreSQL
gerenciado (PGlite)** dentro da pasta do projeto, gera o schema do Drizzle a
partir das suas collections e cria as tabelas no boot — inclusive as de exemplo
`posts`, `authors` e `tags`.

As duas metades sobem juntas:

- **Backend** — API REST, auth, storage, WebSocket
- **Frontend** — o painel de administração do Rebase
- **Hot reload** para os dois

As duas portas são **derivadas do caminho deste projeto** em vez de fixas, então
vários projetos Rebase podem rodar lado a lado. O `rebase dev` imprime as duas
URLs às quais se ligou: **use essas**, não `localhost:3001` / `localhost:5173`.
(`PORT` e `VITE_API_URL` no `.env` configuram o `rebase start`, o servidor de
produção, e são ignorados aqui.) Fixe uma porta com `rebase dev --port 3001`.

### Flags que vale conhecer

| Flag | Em | O que faz |
|---|---|---|
| `--yes` | `init` | Aceita todos os padrões. **Obrigatório quando não há terminal para perguntar**, como em CI |
| `--headless` | `init` | Um backend sem arquivos de collection e sem UI |
| `--template <nome>` | `init` | Parte de um template diferente do padrão |
| `--install` / `--no-install` | `init` | Roda o gerenciador de pacotes por você, ou não |
| `--docker` | `dev` | Usa PostgreSQL em container em vez do gerenciado |
| `--no-db` | `dev` | Não toca em banco nenhum; você traz o seu |

## Variante: seu próprio PostgreSQL

O banco gerenciado é uma conveniência, não um requisito. Para apontar o projeto
para um PostgreSQL seu, descomente `DATABASE_URL` no `.env`:

```bash
DATABASE_URL=postgresql://username:password@localhost:5432/your_database
```

Depois suba os servidores como acima. Uma `DATABASE_URL` já definida nunca é
tocada, e uma que aponta para fora desta máquina é deixada inteiramente em paz.

Com um banco seu você ainda ganha os comandos de migração, que o gerenciado não
pode oferecer: eles planejam as mudanças com o Atlas, que precisa de um segundo
banco vazio para comparar, e o PGlite serve exatamente um:

```bash
pnpm run db:push
```

O boot já cria as tabelas que faltam de forma aditiva, então `db push` é para as
duas coisas que ele deixa de lado de propósito: a RLS das tabelas de junção em
relações muitos-para-muitos e qualquer mudança que não seja puramente aditiva —
uma coluna renomeada, um tipo restringido, um campo removido.

O scaffold também traz um `docker-compose.yml` com um serviço PostgreSQL, caso
você prefira um container a um Postgres instalado:

```bash
docker compose up -d db
```

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

<span class="since-badge" data-since="0.18">Since 0.18</span>

O `rebase init` também escreveu `REBASE_ADMIN_EMAIL` e uma `REBASE_ADMIN_PASSWORD` gerada no `.env`. Aqui elas **não** são as suas credenciais: o `rebase dev` as ignora e diz isso no arranque. Elas pertencem a um arranque de produção — `docker compose up`, ou qualquer coisa com `NODE_ENV=production` —, onde essa janela de inicialização está fechada, porque o servidor responde num hostname antes de você ter digitado qualquer coisa. Veja [Seu primeiro administrador](/pt/docs/getting-started/deployment#seu-primeiro-administrador).

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
