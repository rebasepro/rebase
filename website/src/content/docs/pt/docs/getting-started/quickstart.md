---
sourceHash: 04353ad7d35cfe5c
title: Início rápido
sidebar_label: Início rápido
description: Crie um novo projeto Rebase e execute-o localmente em menos de 2 minutos.
---

## Criar um novo projeto

```bash
pnpm dlx @rebasepro/cli init my-app
```

Isso cria o scaffold de um projeto com dois pacotes. Se termos como *table*, *collection*,
*Studio*, *managed runtime*, *bundle* ou *resource* forem novos para você, o quadro em
[Estrutura do projeto](/docs/getting-started/project-structure/) os define.

| Pasta | Descrição |
|--------|-------------|
| `backend/` | Suas tabelas (`backend/schema/`), o que o runtime lê além delas (`resources.ts`, `storage.ts`), suas funções e crons, e o schema Drizzle gerado. Não há arquivo de servidor — o runtime publicado inicializa o projeto |
| `frontend/` | SPA React — Vite + TypeScript com a UI de administração do Rebase e suas personalizações de tabela em `src/cms/` |

## Pré-requisitos

- **Node.js** 22.22+ — todo scaffold, inclusive o headless, declara `"node": ">=22.22.0"`
- **pnpm** (recomendado) ou npm

Nenhum banco de dados para instalar e sem Docker. O `rebase dev` executa um PostgreSQL gerenciado para o projeto, com seus dados sob `.rebase/`. Consulte [Variante: use seu próprio PostgreSQL](#variante-use-seu-próprio-postgresql) caso prefira fornecer um — uma instalação local, Neon, Supabase ou o contêiner fornecido por este scaffold.

## Seu ambiente já está configurado

O `init` gera um `.env` pronto para uso na raiz do projeto com um `JWT_SECRET` real, uma senha de banco de dados e uma porta de banco de dados local livre. Você não precisa criar ou editar nada para começar.

:::caution
Não execute `cp .env.example .env`. O `.env.example` é uma referência para as variáveis disponíveis — copiá-lo sobre o seu `.env` descarta os segredos gerados — `JWT_SECRET`, a chave de serviço, a senha do banco de dados e as credenciais do primeiro administrador, todas em branco ou comentadas lá. Edite o `.env` diretamente se quiser alterar um valor.
:::

## Iniciar os servidores de desenvolvimento

```bash
cd my-app
pnpm install
pnpm run dev
```

Essa é toda a primeira execução. Não há banco de dados para instalar nem etapa de schema:
sem nenhuma `DATABASE_URL` configurada, o `rebase dev` inicia um **PostgreSQL gerenciado (PGlite)**
no diretório do projeto, gera o schema Drizzle a partir das suas tabelas e
cria as tabelas na inicialização — incluindo os exemplos `posts`, `authors` e `tags`.

Ele inicia ambas as partes juntas:

- **Backend** — API REST, autenticação, storage, WebSocket
- **Frontend** — o painel: Rebase CMS e Rebase Studio
- **Hot reload** para ambos

Ambas as portas são **derivadas do caminho deste projeto** em vez de fixas, portanto vários
projetos Rebase podem rodar lado a lado. O `rebase dev` imprime as duas URLs às quais se vinculou —
**use essas**, não `localhost:3001` / `localhost:5173`. (`PORT` e `VITE_API_URL`
no `.env` configuram o `rebase start`, que executa o bundle compilado, e são ignorados aqui.)
Fixe uma porta com `rebase dev --port 3001`.

### Flags que vale a pena conhecer

| Flag | Em | O que faz |
|---|---|---|
| `--yes` | `init` | Nunca solicitar confirmações. **Obrigatório quando não houver terminal para responder**, como no CI. Ignora a inicialização do git e a instalação de dependências — os padrões interativos dizem sim para ambos, portanto passe `--git` / `--install` se desejar executá-los |
| `--headless` | `init` | Um backend sem `backend/schema/` e sem UI, servindo as próprias tabelas do seu banco de dados — consulte [Apenas backend](/docs/getting-started/headless/) |
| `--template <name>` | `init` | Iniciar a partir de um template diferente do padrão |
| `--install` / `--no-install` | `init` | Executar o gerenciador de pacotes para você ou ignorar |
| `--docker` | `dev` | Usar PostgreSQL em um contêiner em vez do gerenciado. Os outros comandos o seguem até que `rebase dev` seja executado sem ele. Uma `DATABASE_URL` tem precedência: nesse caso, ele não inicia nada e avisa sobre isso |
| `--no-db` | `dev` | Não iniciar nenhum banco de dados — nem o contêiner nem o gerenciado. Defina a `DATABASE_URL` você mesmo |

## Variante: use seu próprio PostgreSQL

O banco de dados gerenciado é uma conveniência, não um requisito. Para apontar o projeto para
um Postgres que você gerencia, descomente a `DATABASE_URL` no `.env`:

```bash
DATABASE_URL=postgresql://username:password@localhost:5432/your_database
```

Em seguida, inicie os servidores de desenvolvimento como acima. Uma `DATABASE_URL` definida nunca
é alterada, e uma que aponte para qualquer lugar além desta máquina é completamente
ignorada.

Os comandos de migração planejam alterações com o [Atlas](https://atlasgo.io/), o
mecanismo de migração de schema utilizado pelo Rebase, que precisa de um segundo banco de dados vazio para
comparação. No seu próprio banco de dados, o Rebase cria um ao lado dele; no gerenciado,
que serve exatamente a um banco de dados, ele inicia um PGlite descartável durante o
tempo de execução do comando.
De qualquer forma:

```bash
pnpm run db:push
```

A inicialização já cria tabelas ausentes — e suas
políticas de [RLS](/docs/collections/security-rules/), o row-level security do PostgreSQL,
que é como o Rebase controla quem pode ler uma linha — de forma aditiva, portanto
o `db push` serve para o que é deliberadamente ignorado: qualquer alteração que não seja
puramente aditiva — uma coluna renomeada, um tipo restringido, um campo removido.

O scaffold também inclui um `docker-compose.yml` com um serviço PostgreSQL, caso você
prefira um contêiner em vez de um Postgres instalado:

```bash
docker compose up -d db
```

## Fazer introspecção de um banco de dados existente (opcional)

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Se você estiver se conectando a um banco de dados existente com tabelas pré-existentes, pode fazer a introspecção dele para gerar um arquivo `defineTable` para cada uma:

```bash
pnpm rebase schema introspect
```

Isso lê cada tabela, coluna, chave estrangeira e política de row-level security e grava `backend/schema/<table>.ts` e o `index.ts` que as exporta, para que você não precise escrevê-los manualmente. Consulte [`schema introspect`](/docs/cli/schema/#rebase-schema-introspect).

## Primeiro login

Ao abrir a URL do frontend impressa pelo `rebase dev`, você verá a tela de login. O **primeiro usuário** a se registrar torna-se automaticamente um administrador — este é o fluxo de inicialização (bootstrap).

1. A tela abre em **Welcome!**, o formulário para essa primeira conta
2. Insira seu e-mail e senha e clique em **Create account**
3. Você está conectado — com acesso total de administrador

O `rebase init` também gravou `REBASE_ADMIN_EMAIL` e um `REBASE_ADMIN_PASSWORD` gerado no `.env`. Essas não são as suas credenciais aqui: o `rebase dev` as ignora e avisa sobre isso na inicialização. Elas pertencem a uma inicialização em produção — `docker compose up`, ou qualquer coisa com `NODE_ENV=production` — onde essa janela de bootstrap fica fechada, porque o servidor responde em um hostname antes que você tenha digitado qualquer coisa. Consulte [Seu primeiro admin](/docs/getting-started/deployment#your-first-admin).

## Definir sua primeira tabela

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Crie um arquivo em `backend/schema/`:

```typescript title="backend/schema/products.ts"
import { defineTable, col } from "@rebasepro/server/schema";

export const products = defineTable("products", {
    columns: {
        id:          col.uuid().primaryKey().defaultRandom(),
        name:        col.text().notNull(),
        price:       col.numeric().notNull().validate({ min: 0 }),
        description: col.text(),
        active:      col.boolean().default(true),
        createdAt:   col.timestamp({ withTimezone: true }).onCreateNow(),
    },
    // Takes the defaultRls the scaffold's index.ts exports: everyone reads, admins write.
    rls: "inherit",
});
```

Em seguida, exporte-o a partir de `backend/schema/index.ts`. O index é o que o backend,
a CLI e o gerador de SDK leem: um `defineTable` que não for exportado por ele recusa
a inicialização, indicando o nome do arquivo.

```typescript title="backend/schema/index.ts"
// ...existing exports
export { products } from "./products";
```

## Criar a tabela

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Salve o arquivo. Essa é toda a etapa: o `rebase dev` regenera
`backend/src/schema.generated.ts` e os tipos do SDK em `generated/sdk/` a partir das suas
tabelas, reinicia o backend, e a inicialização cria a nova tabela e suas políticas de
row-level security — e **Products** aparece na navegação do painel de administração,
com uma lista, um formulário e filtros derivados das colunas.

O mesmo se aplica a uma coluna adicionada a uma tabela que você já possui: salve, e a
coluna estará lá.

Para alterar a aparência da tabela no painel — um editor multilinha para
`description`, um ícone, um grupo — adicione um arquivo em `frontend/src/cms/` e passe-o
para `<RebaseCMS tableCustomizations>` em `App.tsx`:

```tsx title="frontend/src/cms/products.tsx"
import { customizeTable } from "@rebasepro/cms";
import type { products } from "../../../backend/schema/products";

export const productsCms = customizeTable<typeof products>("products", {
    icon: "ShoppingCart",
    fields: {
        description: { multiline: true },
    },
});
```

Consulte [Personalizando uma tabela](/docs/frontend/customize-table/).

O `rebase db push` serve para as alterações que a inicialização deliberadamente ignora — uma coluna
renomeada, um tipo restringido, um campo removido:

```bash
pnpm run db:push
```

Ele é executado tanto no banco de dados gerenciado quanto no seu próprio.

## Referência de comandos de banco de dados

<span class="since-badge" data-since="0.31">Desde 0.31</span>

| Comando | Descrição |
|---------|-------------|
| `rebase schema generate` | Gera o schema Drizzle a partir de suas tabelas. Nenhum banco de dados é necessário — o `rebase dev` executa para você |
| `rebase schema introspect` | Grava arquivos `defineTable` a partir de um banco de dados existente |
| `rebase db push` | Envia alterações de schema diretamente para o banco de dados, incluindo o gerenciado |
| `rebase db generate` | Gera arquivos de migração SQL |
| `rebase db migrate` | Executa migrações pendentes |

Os três comandos `db` funcionam no banco de dados gerenciado.

## O que vem a seguir

- **[Estrutura do projeto](/docs/getting-started/project-structure)** — Entenda o código gerado
- **[Tabelas](/docs/schema/)** — Aprofunde-se na definição de schemas
- **[Ambiente e configuração](/docs/getting-started/configuration)** — Todas as opções de configuração
- **[Implantação](/docs/getting-started/deployment)** — Implante em produção
