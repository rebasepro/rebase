---
sourceHash: 7b2e4e449b0ca1dc
title: Início Rápido
sidebar_label: Início Rápido
description: Crie um novo projeto Rebase e coloque-o para rodar localmente em menos de 2 minutos.
---

## Criar um Novo Projeto

```bash
pnpm dlx @rebasepro/cli init my-app
```

Isso cria a estrutura de um projeto com três pacotes. Se algum dos termos *collection*, *Studio*,
*managed runtime*, *bundle* ou *resource* for novo para você, o quadro de cinco palavras em
[Estrutura do Projeto](/docs/getting-started/project-structure/) os define.



| Pasta | Descrição |
|--------|-------------|
| `frontend/` | React SPA — Vite + TypeScript com a UI de administração do Rebase |
| `backend/` | Suas funções personalizadas e crons, além do schema gerado do Drizzle. Não há arquivo de servidor — o runtime publicado inicializa o projeto |
| `config/` | Arquivos de configuração e definições de collections compartilhados por ambos os lados |

## Pré-requisitos

- **Node.js** 22.22+ — todo scaffold, incluindo headless, declara `"node": ">=22.22.0"`
- **pnpm** (recomendado) ou npm

Nenhum banco de dados para instalar e nada de Docker. O `rebase dev` executa um PostgreSQL gerenciado para o projeto, com seus dados sob `.rebase/`. Veja [Variante: use seu próprio PostgreSQL](#variante-use-seu-próprio-postgresql) se preferir fornecer um — uma instalação local, Neon, Supabase ou o contêiner que este scaffold fornece.

## Seu Ambiente Já Está Configurado

O `init` gera um `.env` pronto para execução na raiz do projeto com um `JWT_SECRET` real, uma senha de banco de dados e uma porta de banco de dados local livre. Você não precisa criar ou editar nada para começar.

:::caution
Não execute `cp .env.example .env`. O `.env.example` é uma referência para as variáveis disponíveis — copiá-lo sobre o seu `.env` descarta os segredos gerados e aponta o `DATABASE_URL` para um banco de dados que não existe. Edite o `.env` diretamente se quiser alterar um valor.
:::

## Iniciar os Servidores de Desenvolvimento

```bash
pnpm install
pnpm run dev
```

Essa é toda a primeira execução. Não há banco de dados para instalar e nenhuma etapa de schema:
sem `DATABASE_URL` configurada, o `rebase dev` inicia um **PostgreSQL gerenciado (PGlite)**
no diretório do projeto, gera o schema do Drizzle a partir de suas collections e
cria as tabelas na inicialização — incluindo os exemplos `posts`, `authors` e `tags`.

Ele inicia ambas as partes juntas:

- **Backend** — API REST, autenticação, armazenamento, WebSocket
- **Frontend** — o painel: Rebase CMS e Rebase Studio
- **Hot reload** para ambos

Ambas as portas são **derivadas do caminho deste projeto** em vez de serem fixas, de modo que vários
projetos Rebase podem rodar lado a lado. O `rebase dev` exibe as duas URLs às quais se vinculou —
**use essas**, não `localhost:3001` / `localhost:5173`. (`PORT` e `VITE_API_URL`
no `.env` configuram o `rebase start`, o servidor de produção, e são ignorados aqui.)
Fixe uma porta com `rebase dev --port 3001`.

### Flags que vale a pena conhecer

| Flag | Em | O que faz |
|---|---|---|
| `--yes` | `init` | Nunca solicitar confirmação. **Obrigatório quando não há terminal para responder**, como no CI. Ignora o git init e a instalação de dependências — os padrões interativos dizem sim para ambos, portanto passe `--git` / `--install` se quiser executá-los |
| `--headless` | `init` | Um backend sem arquivos de collection e sem UI — veja [Backend only](/docs/getting-started/headless/) |
| `--template <name>` | `init` | Começar a partir de um template diferente do padrão |
| `--install` / `--no-install` | `init` | Executar o gerenciador de pacotes para você, ou ignorar |
| `--docker` | `dev` | Usar o PostgreSQL em um contêiner em vez do gerenciado |
| `--no-db` | `dev` | Não iniciar nenhum banco de dados — nem o contêiner nem o gerenciado. Defina `DATABASE_URL` manualmente |

## Variante: use seu próprio PostgreSQL

O banco de dados gerenciado é uma conveniência, não um requisito. Para apontar o projeto para
um Postgres que você executa, descomente `DATABASE_URL` no `.env`:

```bash
DATABASE_URL=postgresql://username:password@localhost:5432/your_database
```

Em seguida, inicie os servidores de desenvolvimento como acima. Uma `DATABASE_URL` configurada nunca
é alterada, e qualquer uma que aponte para outro local que não seja esta máquina não é
modificada de forma alguma.

Com seu próprio banco de dados, você também obtém os comandos de migração, que o gerenciado
não pode oferecer — eles planejam alterações com o [Atlas](https://atlasgo.io/), o mecanismo de migração de schema
utilizado pelo Rebase, que precisa de um segundo banco de dados vazio
para comparação, e o PGlite atende exatamente a um:

```bash
pnpm run db:push
```

A inicialização já cria tabelas ausentes de forma aditiva, então o `db push` serve para as duas
coisas que ela deliberadamente ignora: [RLS](/docs/collections/security-rules/) em tabelas de junção
(junction tables) — o Row-Level Security do PostgreSQL, que é
como o Rebase impõe quem pode ler uma linha — em relações
muitos-para-muitos, e qualquer alteração que não seja puramente aditiva — uma coluna renomeada,
um tipo restringido, um campo removido.

O scaffold também inclui um `docker-compose.yml` com um serviço PostgreSQL, caso você
queira um contêiner em vez de um Postgres instalado:

```bash
docker compose up -d db
```

## Fazer Introspecção de um Banco de Dados Existente (Opcional)

Se estiver se conectando a um banco de dados existente com tabelas pré-existentes, você pode fazer a introspecção dele para gerar automaticamente seus arquivos de collection em TypeScript:

```bash
pnpm rebase schema introspect
```

Isso analisará as tabelas do seu banco de dados e gerará os arquivos TypeScript correspondentes em `config/collections/` para que você não precise escrevê-los manualmente.

## Primeiro Login

Quando você abrir a URL do frontend que o `rebase dev` exibiu, verá a tela de login. O **primeiro usuário** a se registrar torna-se automaticamente um administrador — este é o fluxo de inicialização (bootstrap).

1. Clique em **Sign Up**
2. Insira seu e-mail e senha
3. Pronto — com acesso total de administrador

O `rebase init` também gravou `REBASE_ADMIN_EMAIL` e um `REBASE_ADMIN_PASSWORD` gerado no `.env`. Essas não são suas credenciais aqui: o `rebase dev` as ignora e avisa isso na inicialização. Elas pertencem a uma inicialização em produção — `docker compose up`, ou qualquer coisa com `NODE_ENV=production` — onde essa janela de bootstrap é fechada, pois o servidor responde em um hostname antes que você tenha digitado qualquer coisa. Veja [Seu primeiro admin](/docs/getting-started/deployment#your-first-admin).

## Definir Sua Primeira Collection

Abra `config/collections/` e crie um novo arquivo. Exporte a collection como o **export padrão** (`default export`) — é assim que o registro a reconhece. O nome da tabela é opcional: seu padrão é o slug, portanto, defina-o apenas quando forem diferentes:

```typescript title="config/collections/products.ts"
import { defineCollection } from "@rebasepro/cms-types";

const productsCollection = defineCollection({
    slug: "products",
    name: "Products",
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

Em seguida, registre-a em `config/collections/index.ts` para que tanto o backend quanto o painel de administração saibam sobre ela:

```typescript title="config/collections/index.ts" {2,5}
// ...existing imports
import productsCollection from "./products.js";

export const collections = [
    postsCollection, authorsCollection, tagsCollection, usersCollection, productsCollection
];
```

## Criar a Tabela

Salve o arquivo. Essa é toda a etapa: o `rebase dev` regenera
`backend/src/schema.generated.ts` a partir de suas collections, reinicia o backend,
e a inicialização cria a nova tabela — assim, sua collection **Products** aparece na
navegação.

O mesmo vale para uma propriedade adicionada a uma collection que você já possui: salve,
e a coluna estará lá.

O `rebase db push` é para as alterações que a inicialização deliberadamente ignora — uma coluna
renomeada, um tipo restringido, um campo removido e RLS em tabelas de junção em
relações muitos-para-muitos. Ele requer o seu próprio PostgreSQL:

```bash
pnpm run db:push
```

## Referência de Comandos de Banco de Dados

| Comando | Descrição |
|---------|-------------|
| `rebase schema generate` | Gera o schema do Drizzle a partir de suas collections em TypeScript. Nenhum banco de dados é necessário — o `rebase dev` executa isso para você |
| `rebase schema introspect` | Gera collections em TypeScript a partir de um banco de dados existente |
| `rebase db push` | Aplica as alterações de schema diretamente ao banco de dados. Requer seu próprio PostgreSQL |
| `rebase db generate` | Gera arquivos de migração SQL. Requer seu próprio PostgreSQL |
| `rebase db migrate` | Executa migrações pendentes. Requer seu próprio PostgreSQL |

## Próximos Passos

- **[Estrutura do Projeto](/docs/getting-started/project-structure)** — Entenda o código gerado
- **[Collections](/docs/collections)** — Aprofunde-se na definição de schema
- **[Ambiente e Configuração](/docs/getting-started/configuration)** — Todas as opções de configuração
- **[Implantação](/docs/getting-started/deployment)** — Faça a implantação em produção
