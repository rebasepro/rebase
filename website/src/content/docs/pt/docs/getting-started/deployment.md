---
sourceHash: 215da7d8e962efb0
title: Implantação
sidebar_label: Implantação
description: Implante seu projeto Rebase em produção usando Docker, plataformas de nuvem ou configurações manuais.
---

## O que uma Implantação Serve

Um projeto Rebase é implantado como **um servidor em uma URL** (na Rebase Cloud: `https://<project>.rebase.website`). Esse servidor cuida de:

- **`/api/*`** — a API de dados, autenticação, tempo real e armazenamento
- **todo o resto** — o seu `frontend/` compilado como uma SPA estática

Não há uma URL de administração separada: o painel de administração faz parte do seu frontend, então onde ele aparece depende do que o seu frontend é.

| Tipo de projeto | A URL raiz mostra | O painel de administração está em |
|--------------|----------------|-------------------|
| Scaffold padrão (`rebase init`) | O painel de administração | `/` — o frontend **é** o admin |
| Frontend de produto personalizado | Sua app | Onde você o montar, comumente `/admin` — veja [Alterar a URL Base](#changing-the-base-url) |
| Projeto somente backend | Nada (apenas API) | Não implantado |

:::note[Primeira visita]
Na primeira visita ao admin de uma implantação nova, a Rebase mostra uma tela de bootstrap para **criar sua conta de administrador**. A primeira conta registrada recebe privilégios de administrador — reivindique-a logo após a implantação.
:::

## Docker Compose (Recomendado)

O projeto gerado inclui um `Dockerfile` e um `docker-compose.yml`. Use o `docker-compose.yml` gerado como fonte da verdade — o exemplo abaixo mostra apenas os campos essenciais. Esta é a forma mais simples de implantar:

```yaml title="docker-compose.yml"
services:
  postgres:
    image: pgvector/pgvector:pg18
    environment:
      POSTGRES_USER: rebase_app
      POSTGRES_PASSWORD: rebase
      POSTGRES_DB: rebase
    volumes:
      - pgdata:/var/lib/postgresql/data
    ports:
      - "5432:5432"

  app:
    # A imagem de runtime publicada. Atualizar o Rebase é uma mudança de tag, não uma recompilação.
    image: rebasepro/server:${REBASE_VERSION:-latest}
    ports:
      - "3001:3001"
    environment:
      DATABASE_URL: postgresql://rebase_app:rebase@postgres:5432/rebase
      JWT_SECRET: ${JWT_SECRET}
      NODE_ENV: production
    depends_on:
      - postgres
    volumes:
      # O seu projeto construído, a partir do `rebase build`.
      - ./dist-bundle:/bundle:ro
      - uploads:/app/uploads

volumes:
  pgdata:
  uploads:
```

```bash
rebase build
docker compose up -d
```

O bundle é montado em modo apenas-leitura. O `rebase build` instala as
dependências declaradas do projeto em `dist-bundle`, a não ser que passe
`--no-vendor` — nesse caso o runtime instala-as em cada arranque e a montagem tem
de ser gravável: retire então o `:ro`. Veja
[Auto-alojamento](/docs/deployment/self-hosting/).

## Criar o Esquema do Banco de Dados

Ao iniciar, o Rebase cria automaticamente **apenas as tabelas de autenticação** — as tabelas das suas próprias coleções não são criadas sozinhas. Execute `pnpm run db:push` **uma vez** contra o banco de dados de produção; caso contrário, a aplicação sobe e o login funciona normalmente, mas toda coleção retorna um erro de tabela ausente ("missing table"):

```bash
DATABASE_URL="<sua string de conexão de produção>" pnpm run db:push
```

Rode isso a partir de um checkout do projeto ou da sua CI, com a `DATABASE_URL` apontando para produção — **não** dentro do contêiner, pois a imagem de produção não inclui a CLI. Para migrações versionadas, use `pnpm run db:generate` e depois `pnpm run db:migrate`.

## Seu primeiro administrador

<span class="since-badge" data-since="0.18">Since 0.18</span>

**Defina `REBASE_ADMIN_EMAIL` e `REBASE_ADMIN_PASSWORD` antes do primeiro arranque.** É o único passo que não tem conserto a partir de fora.

Um banco recém-criado não tem usuários e, fora de produção, a política de registro aceita o primeiro cadastro e o promove a administrador. Ela precisa: nomear um administrador exige um chamador já autenticado, então um banco vazio sem essa regra é um beco sem saída. Num notebook, quem está ao teclado é o operador, e isso está exatamente certo.

Está exatamente errado num host com nome público. Os artefatos publicados sobem DNS e TLS antes de o operador ter digitado qualquer coisa, então a janela fica aberta para a internet desde o primeiro segundo, e quem chegar primeiro ao formulário de cadastro passa a ser dono da implantação.

Por isso, sob `NODE_ENV=production` essa janela está fechada. Uma tabela de usuários vazia recusa o registro de bootstrap com `SETUP_REQUIRED`, uma conta criada por registro aberto é uma conta comum, `GET /api/auth/config` nunca anuncia `needsSetup` e `POST /api/admin/bootstrap` recusa. Em 0.17.3 e anteriores a janela também ficava aberta em produção: atualize antes de expor uma implantação nova.

O `rebase dev` lê o mesmo `.env`, mas ignora as duas variáveis de propósito e diz isso no arranque: localmente, o primeiro registro continua sendo a forma de entrar. Os valores que o `rebase init` escreveu pertencem ao arranque de produção.

Restam duas formas de entrar, e nenhuma delas é uma corrida:

```bash
REBASE_ADMIN_EMAIL=voce@example.com
REBASE_ADMIN_PASSWORD=<pelo menos 12 caracteres>
DISABLE_SELF_REGISTRATION=true
```

O runtime cria essa conta uma vez, enquanto a tabela de usuários está vazia, e não faz nada nos arranques seguintes. Ou atribua o papel a um usuário existente com a chave de serviço, se você provisiona contas por fora.

O runtime impõe duas regras no arranque, e sem elas a conta resultante é inutilizável:

- A senha precisa ter **pelo menos 12 caracteres**, ou é recusada e nenhuma conta é criada.
- O endereço precisa ser um que `POST /api/auth/login` aceite: a rota analisa o corpo com `z.string().email()`, então um domínio sem ponto (`admin@localhost`) é criado sem reclamação e depois responde 400 a cada login. O arranque também recusa esse endereço.

Defina as duas ou nenhuma: meia credencial é um erro de digitação, e a implantação que ela deixa — autorregistro fechado, sem administrador — só se recupera num console `psql`. O arranque avisa quando a tabela está vazia em produção e nenhum administrador foi nomeado.

Entre e troque a senha. Ela está em texto puro onde quer que você tenha colocado seu ambiente.

## Lista de Verificação para Produção

Antes de implantar em produção, garanta:

| Item | Detalhes |
|------|---------|
| **JWT_SECRET** | Use uma string aleatória criptograficamente forte (≥ 32 caracteres). Nunca reutilize entre ambientes. |
| **DATABASE_URL** | Use uma instância Postgres gerenciada (Neon, Supabase, RDS) com TLS habilitado |
| **Esquema do banco de dados** | Execute `pnpm run db:push` uma vez contra o banco de produção — o boot cria apenas as tabelas de autenticação, não as das suas coleções |
| **CORS** | Configure as origens permitidas no seu backend se o frontend e o backend estiverem em domínios diferentes |
| **Volumes de armazenamento** | Monte volumes persistentes para os uploads de arquivos. Ou mude para S3 na produção. |
| **HTTPS** | Termine TLS no seu proxy reverso (nginx, Cloudflare, balanceador de carga) |
| **Primeiro administrador** | Defina `REBASE_ADMIN_EMAIL` e `REBASE_ADMIN_PASSWORD` **antes do primeiro arranque**, junto com `DISABLE_SELF_REGISTRATION=true`. Em produção, a primeira conta registrada não é promovida — veja [Seu primeiro administrador](#seu-primeiro-administrador). |

| **Leituras públicas ainda precisam de um chamador** | `access: "public"` amplia quais *linhas* um chamador vê, não quem pode chamar: uma requisição anônima para `/api/data/*` responde 401 enquanto `AUTH_REQUIRE` estiver ativo. Defina `AUTH_REQUIRE=false` para um site público que lê o próprio backend e deixe o RLS decidir sozinho. É uma variável de ambiente, então um `.env` local que a define **não** viaja com sua implantação. |

## Módulos Nativos no Runtime Gerenciado

O runtime gerenciado do Rebase Cloud executa seu bundle dentro de uma imagem
compartilhada. Ele não tem compilador nem forma de carregar um **módulo nativo**
— ou seja, qualquer coisa que traga um binário `.node` pré-compilado. O mais
comum de longe é o `sharp`, que também é a dependência óbvia para qualquer coisa
que sirva imagens.

`rebase cloud deploy` recusa isso antes do upload, e não depois:

```
This bundle depends on native modules (sharp), which the managed runtime cannot run
```

Três saídas, na ordem em que costumam ser a certa:

1. **Mova o trabalho para o build.** Redimensione e recodifique as imagens no
   seu passo de build e implante os resultados. Nada nativo roda no caminho da
   requisição.
2. **Use um serviço.** Uma CDN de imagens ou uma API de transformação faz o
   mesmo trabalho atrás de uma URL.
3. **Rode seu próprio contêiner.** Uma implantação auto-hospedada (Docker,
   Kubernetes, qualquer um dos
   [guias por plataforma](/docs/deployment/self-hosting)) é a sua imagem, então
   pode levar o que quiser.

Funções que precisam apenas do Node, e não de um binário nativo, não são
problema — a implantação as reporta separadamente (`1 of 3 function(s) depend on
Node`) e as executa.

## Servindo o Frontend

Em produção, o backend pode servir o frontend como uma SPA estática:

```typescript
import { serveSPA } from "@rebasepro/server";
import path from "path";

// After initializeRebaseBackend()
serveSPA(app, { frontendPath: path.resolve(process.cwd(), "../frontend/dist") });
```

Compile o frontend primeiro:

```bash
cd frontend && pnpm build
```

Dessa forma, você só precisa implantar um servidor que cuide tanto da SPA quanto da API.

## Guias de Implantação por Plataforma

Guias detalhados passo a passo para cada plataforma:

| Plataforma | Tipo | Guia |
|----------|------|-------|
| **AWS** | App Runner / ECS + RDS | [Implantar na AWS →](/docs/deployment/aws) |
| **Google Cloud** | Cloud Run + Cloud SQL | [Implantar no GCP →](/docs/deployment/gcp) |
| **Azure** | Container Apps + PostgreSQL | [Implantar no Azure →](/docs/deployment/azure) |
| **Hetzner Cloud** | VPS + Docker Compose | [Implantar na Hetzner →](/docs/deployment/hetzner) |
| **Scaleway** | Contêineres Serverless | [Implantar na Scaleway →](/docs/deployment/scaleway) |
| **Railway** | PaaS (detecção automática do Dockerfile) | [Implantar na Railway →](/docs/deployment/railway) |
| **Fly.io** | Runtime de contêineres | [Implantar no Fly.io →](/docs/deployment/flyio) |

:::caution
Cloud Run e outras plataformas serverless são sem estado. Use **armazenamento S3** em vez do sistema de arquivos local para os uploads de arquivos, e defina `--min-instances 1` se você usar os recursos de tempo real da Rebase (as conexões WebSocket são encerradas quando as instâncias são reduzidas).
:::


## Alterar a URL Base

Se quiser que a administração seja executada num sub-caminho (por ex. `/admin`), mude uma linha — o `path` da app em `rebase.json`:

```json title="rebase.json"
"admin": {
    "type": "static",
    "root": "frontend",
    "build": "npm run build --workspace frontend",
    "output": "frontend/dist",
    "path": "/admin"
}
```

`rebase build` passa-o ao Vite como `base` (através de `REBASE_APP_BASE`), o Vite devolve-o como `import.meta.env.BASE_URL`, e o `main.tsx` do scaffold já o entrega ao router — assim os assets, as rotas e o servidor concordam sem que o prefixo esteja escrito em três sítios:

```tsx title="frontend/src/main.tsx"
// At "/" this is "".
const basename = import.meta.env.BASE_URL.replace(/\/$/, "");

const router = createBrowserRouter([
    {
        path: "/*",
        element: <App/>
    }
], { basename });
```

A administração precisa de um **data router** — `createBrowserRouter`, não o simples `BrowserRouter` — porque o bloqueio de alterações não guardadas usa `useBlocker`, que só o data router fornece.

**Backend** — se também mover a API, actualize o seu caminho base:

```typescript no-verify
await initializeRebaseBackend({
    // ...
    basePath: "/admin/api"
});
```

:::note[Montando sem um `basename` de router]
A abordagem `basename` acima é a recomendada — o react-router remove o
prefixo da location, então o admin funciona sem alterações. Se, em vez disso, você embutir o
admin dentro de uma **rota com prefixo de caminho** de uma app maior (por ex. `<Route path="/admin/*">`)
sem `basename`, o caminho atual mantém seu prefixo `/admin`. Informe o CMS sobre
isso para que a resolução URL⇄coleção considere o prefixo — caso contrário, as visões ficam presas em um
spinner sem buscar dados:

```tsx
<RebaseCMS collections={collections} basePath="/admin" />
```

Defina **ou** o `basename` do router **ou** `RebaseCMS basePath` — não ambos, senão o
prefixo é aplicado duas vezes.
:::

### App de Produto + Admin em uma Única Implantação

O motivo comum para mover o admin para `/admin` é entregar a sua **própria app de produto**
na raiz da mesma implantação. Um único ponto de entrada Vite pode servir ambos, divididos por URL,
de modo que cada app seja carregada de forma preguiçosa e os visitantes do produto nunca baixem o bundle do admin:

```tsx title="frontend/src/main.tsx"
const isAdmin = window.location.pathname.startsWith("/admin");

const ProductApp = lazy(() => import("./App"));
const AdminApp = lazy(() => import("./AdminApp"));

const router = isAdmin
    // The admin lives under /admin, and `basename` is how the router is told.
    ? createBrowserRouter([{ path: "/*", element: <AdminApp/> }], { basename: "/admin" })
    : createBrowserRouter([{ path: "/*", element: <ProductApp/> }]);

root.render(<RouterProvider router={router}/>);
```

Um só router para as duas metades: a administração precisa do data router de qualquer forma, e não há razão para a app de produto estar noutro.

O backend não precisa de alterações para esse padrão — a API permanece em `/api` e o catch-all da SPA
serve `index.html` tanto para `/` quanto para `/admin/*`.

## Próximos Passos

- **[Visão Geral do Backend](/docs/backend)** — Configuração completa do backend
- **[Configuração de Armazenamento](/docs/backend/storage)** — Configuração de S3 para produção
