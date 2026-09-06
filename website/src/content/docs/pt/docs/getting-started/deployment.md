---
sourceHash: b48cc9bf8ad4dcf3
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
| Frontend de produto personalizado | Sua app | Onde você o montar, comumente `/admin` — veja [Alterar a URL Base](#alterar-a-url-base) |
| Projeto somente backend | Nada (apenas API) | Não implantado |

:::note[Primeira visita]
Uma implantação de **produção** nova não oferece nenhuma tela de bootstrap, e o seu primeiro registro é uma conta comum. Nomeie o administrador antes do primeiro arranque — veja [Seu primeiro administrador](#seu-primeiro-administrador).
:::

## Docker Compose (Recomendado)

O projeto gerado já inclui um `docker-compose.yml` que funciona — **esse arquivo
é o que se deve usar num projeto criado pelo scaffold**, do jeito que está, em
vez de escrito à mão ou copiado de outro lugar. O `rebase init` preencheu os
seus segredos, a sua primeira conta de administrador e a sua versão de runtime
fixada, e ele é iniciado pelo próprio gate de aceitação do framework a cada
push. Ele roda **dois** contêineres: Postgres e o runtime Rebase publicado, com
o seu bundle compilado montado dentro. Não há nenhuma imagem de aplicação a
construir.

[Auto-hospedagem](/docs/deployment/self-hosting) cobre a mesma implantação sem um
scaffold por trás, usando
[`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml)
do repositório do Rebase — e as duas coisas que esse arquivo deixa de fora de
propósito: um pooler de conexões e rodar as funções e o worker de jobs como
processos próprios.

```bash
rebase build          # produz ./dist-bundle
docker compose up -d
```

`rebase build` primeiro, sempre: o serviço `api` monta `./dist-bundle`, e sem ele
o contêiner sobe contra um diretório vazio.

A forma do arquivo gerado:

```yaml title="docker-compose.yml (generated — abridged)"
services:
  db:
    image: pgvector/pgvector:pg18
    environment:
      POSTGRES_USER: rebase_app
      POSTGRES_PASSWORD: ${DATABASE_PASSWORD:-changeme}
      POSTGRES_DB: rebase
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U rebase_app -d rebase"]

  api:
    # The published runtime. Upgrading Rebase is a tag change, not a rebuild.
    image: rebasepro/server:${REBASE_VERSION:-latest}
    depends_on:
      db:
        condition: service_healthy
    ports:
      - "${PORT:-3001}:3001"
    environment:
      NODE_ENV: production
      DATABASE_URL: postgresql://rebase_app:${DATABASE_PASSWORD:-changeme}@db:5432/rebase
      JWT_SECRET: ${JWT_SECRET:?set JWT_SECRET in .env}
      REBASE_SERVICE_KEY: ${REBASE_SERVICE_KEY:?set REBASE_SERVICE_KEY in .env}
      CORS_ORIGINS: ${CORS_ORIGINS:?set CORS_ORIGINS in .env}
      # This service runs in production, where the first account to register is
      # not promoted to admin. So the admin is named instead.
      REBASE_ADMIN_EMAIL: ${REBASE_ADMIN_EMAIL:?set REBASE_ADMIN_EMAIL in .env}
      REBASE_ADMIN_PASSWORD: ${REBASE_ADMIN_PASSWORD:?set REBASE_ADMIN_PASSWORD in .env}
      DISABLE_SELF_REGISTRATION: ${DISABLE_SELF_REGISTRATION:-true}
    volumes:
      # Your built project, from `rebase build`. Read-only: the build vendors
      # the bundle's dependencies by default, so nothing has to write here.
      - ./dist-bundle:/bundle:ro

volumes:
  postgres_data:
```

As três linhas `REBASE_ADMIN_*` / `DISABLE_SELF_REGISTRATION` são novas <span class="since-badge" data-since="0.18">Since 0.18</span>
— na 0.17.3 a primeira conta registrada vira a administradora, em produção
também. Veja [Seu primeiro administrador](#seu-primeiro-administrador) abaixo.

O bundle é montado em modo apenas-leitura. O `rebase build` instala as
dependências declaradas do projeto em `dist-bundle`, a não ser que passe
`--no-vendor` — nesse caso o runtime instala-as em cada arranque e a montagem tem
de ser gravável: retire então o `:ro`. Veja
[Auto-alojamento](/docs/deployment/self-hosting/#dependencies).

O `rebase init` escreve tudo isso no `.env` por você, incluindo uma senha de
administrador gerada. Cada uma é declarada com `${VAR:?…}`, então uma que falte
interrompe a stack com uma mensagem que a nomeia em vez de subir algo meio
configurado — e o Compose interpola o arquivo inteiro antes de selecionar
serviços, então uma que falte interrompe também o `docker compose up -d db`.

Troque o e-mail do administrador pelo seu, entre e mude a senha. Veja [Seu
primeiro administrador](#seu-primeiro-administrador).

### O esquema

O runtime cria as tabelas que faltam no arranque, **inclusive as das suas
coleções** — `REBASE_MIGRATE_ON_BOOT` vale `ensure` por padrão, que é aditivo
sobre o esquema inteiro e aplica junto a segurança em nível de linha. Um primeiro
`docker compose up` contra um banco vazio sobe servindo as suas coleções.

O que o arranque nunca faz é mudar algo que já existe: ele não altera o tipo de
uma coluna, não descarta nada e não edita os rótulos de um enum existente, porque
o reinício de um contêiner não pode remodelar um esquema como efeito colateral de
uma implantação. Isso passa pela CLI, a partir de um checkout ou de um job de CI
apontado para o banco de dados de produção:

```bash
pnpm run db:push
```

Rode isso para a RLS das tabelas de junção em relações muitos-para-muitos, e para
qualquer mudança que não seja puramente aditiva: uma coluna renomeada, um tipo
estreitado, um campo removido.

Para um **fluxo de trabalho versionado e em equipe**, versione arquivos de
migração com `pnpm run db:generate` e rode `pnpm run db:migrate` como passo de
release. De qualquer forma, roda a partir de um checkout do projeto, não dentro
do contêiner em execução — a imagem de runtime não inclui a CLI.

## Seu primeiro administrador

<span class="since-badge" data-since="0.18">Since 0.18</span>

**Defina `REBASE_ADMIN_EMAIL` e `REBASE_ADMIN_PASSWORD` antes do primeiro arranque.** Todo guia por plataforma deste site aponta para cá, porque é o único passo que não tem conserto a partir de fora.

Um banco recém-criado não tem usuários e, fora de produção, a política de registro aceita o primeiro cadastro e o promove a administrador. Ela precisa: nomear um administrador exige um chamador já autenticado, então um banco vazio sem essa regra é um beco sem saída. Num notebook, quem está ao teclado é o operador, e isso está exatamente certo.

Está exatamente errado num host com nome público. Os artefatos publicados sobem DNS e TLS antes de o operador ter digitado qualquer coisa, então a janela fica aberta para a internet desde o primeiro segundo, e quem chegar primeiro ao formulário de cadastro passa a ser dono da implantação.

Por isso, sob `NODE_ENV=production` essa janela está fechada. Uma tabela de usuários vazia recusa o registro de bootstrap com `SETUP_REQUIRED`, uma conta criada por registro aberto é uma conta comum, `GET /api/auth/config` nunca anuncia `needsSetup` e `POST /api/admin/bootstrap` recusa. Em 0.17.3 e anteriores a janela também ficava aberta em produção: atualize antes de expor uma implantação nova.

O `rebase dev` lê o mesmo `.env`, mas ignora as duas variáveis de propósito e diz isso no arranque: localmente, o primeiro registro continua sendo a forma de entrar. Os valores que o `rebase init` escreveu pertencem ao arranque de produção. Semear dos dois lados gastaria a janela antes de a desenvolvedora ter aberto a app, que é justamente o que fazia o primeiro passo do próprio quickstart produzir uma conta sem papel.

Restam duas formas de entrar, e nenhuma delas é uma corrida:

```bash
REBASE_ADMIN_EMAIL=you@example.com
REBASE_ADMIN_PASSWORD=<at least 12 characters>
DISABLE_SELF_REGISTRATION=true
```

O runtime cria essa conta uma vez, enquanto a tabela de usuários está vazia, e não faz nada nos arranques seguintes. Ou atribua o papel a um usuário existente com a chave de serviço, se você provisiona contas por fora.

O runtime impõe duas regras no arranque, e sem elas a conta resultante é inutilizável:

- A senha precisa ter **pelo menos 12 caracteres**, ou é recusada e nenhuma conta é criada.
- O endereço precisa ser um que `POST /api/auth/login` aceite: a rota analisa o corpo com `z.string().email()`, então um domínio sem ponto (`admin@localhost`) é criado sem reclamação e depois responde 400 a cada login. O arranque também recusa esse endereço.

Defina as duas ou nenhuma: meia credencial é um erro de digitação, e a implantação que ela deixa — autorregistro fechado, sem administrador — só se recupera num console `psql`. O arranque avisa quando a tabela está vazia em produção e nenhum administrador foi nomeado.

Entre e troque a senha. Ela está em texto puro onde quer que você tenha colocado seu ambiente.

## Lista de Verificação para Produção

<span class="since-badge" data-since="0.18">Since 0.18</span>

Antes de implantar em produção, garanta:

| Item | Detalhes |
|------|---------|
| **Primeiro administrador** | Defina `REBASE_ADMIN_EMAIL` e `REBASE_ADMIN_PASSWORD` **antes do primeiro arranque**, junto com `DISABLE_SELF_REGISTRATION=true`. Em produção, a primeira conta registrada não é promovida — veja [Seu primeiro administrador](#seu-primeiro-administrador). |
| **NODE_ENV** | `NODE_ENV=production`. É o que fecha a janela de bootstrap, recusa o armazenamento local de arquivos, exige `CORS_ORIGINS` e desliga a documentação OpenAPI. Uma implantação deixada no valor padrão está rodando em modo de desenvolvimento. |
| **Esquema do banco de dados** | O arranque cria as tabelas das suas coleções de forma aditiva. Rode `pnpm run db:push` (ou `pnpm run db:migrate`) para a RLS das tabelas de junção e para tudo que não seja puramente aditivo. |
| **JWT_SECRET** | Use uma string aleatória criptograficamente forte (≥ 32 caracteres). Nunca reutilize entre ambientes. |
| **DATABASE_URL** | Use uma instância Postgres gerenciada (Neon, Supabase, RDS) com TLS habilitado |
| **CORS_ORIGINS** | Sempre, não só quando o frontend está em outro domínio. O runtime se recusa a iniciar em produção sem `CORS_ORIGINS` nem `FRONTEND_URL`, porque uma API que adivinha as suas origens permitidas acaba permitindo a errada. |
| **Controle de acesso ao armazenamento** | Um bucket configurado **se recusa a iniciar em produção** sem um modelo de controle de acesso. O armazenamento não está sob segurança em nível de linha e as suas chaves compartilham um único namespace plano, então um padrão que permite tudo deixa qualquer usuário autenticado listar (`GET /storage/list?prefix=`) e depois ler, sobrescrever ou apagar os arquivos de todos os outros. Satisfaça-o com um hook `storageAuthorize` ou com `storagePolicies` (o scaffold traz um hook em `config/storage.ts`), ou declare a intenção com `STORAGE_PUBLIC_READ` para uma CDN pública de verdade, ou `STORAGE_ALLOW_ANY_AUTHENTICATED` para uma app single-tenant em que toda conta é confiável com todo arquivo. |
| **Backend de armazenamento** | `STORAGE_TYPE=local` em produção é **descartado**, e os uploads respondem `501 STORAGE_NOT_CONFIGURED` — o sistema de arquivos do contêiner é destruído no próximo reinício, então um backend local é perda de dados silenciosa. Use `s3` ou `gcs`, ou defina `FORCE_LOCAL_STORAGE=true` se o caminho for mesmo um volume durável. |
| **MFA_ENCRYPTION_KEY** | Defina-a (32+ caracteres aleatórios) se você usa TOTP. Sem ela, os segredos armazenados são cifrados com `JWT_SECRET` — então rotacioná-lo desconecta todo mundo *e* torna indecifrável cada autenticador cadastrado. |
| **HTTPS** | Termine TLS no seu proxy reverso (nginx, Cloudflare, balanceador de carga) |
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
