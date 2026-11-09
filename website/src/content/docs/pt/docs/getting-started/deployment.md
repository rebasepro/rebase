---
sourceHash: 0d34ea230c0dfdc6
title: Implantação
sidebar_label: Implantação
description: Implante seu projeto Rebase em produção usando Docker, plataformas em nuvem ou configurações manuais.
---

## O que uma Implantação Serve

Um projeto Rebase é implantado como **um único servidor** (no Rebase Cloud: `https://<project>.rebase.website`). Esse servidor gerencia:

- **`/api/*`** — a API de dados, autenticação, realtime e armazenamento
- **todo o resto** — seu `frontend/` compilado como uma SPA estática

Não há um serviço de administração separado: o painel administrativo faz parte de um frontend, portanto, onde ele aparece depende de qual é o seu frontend e se você atribui a ele um hostname próprio.

| Tipo de projeto | A URL raiz exibe | O painel admin está em |
|-----------------|------------------|------------------------|
| Scaffold padrão (`rebase init`) | O painel de administração | `/` — o frontend **é** o admin |
| Frontend customizado do produto | Seu aplicativo | Onde quer que você o monte, comumente `/admin` — consulte [Alterando a URL Base](#alterando-a-url-base) |
| Admin como um app em seu próprio hostname | Seu aplicativo | `https://admin.example.com/`, servido pelo mesmo servidor — consulte [Alterando a URL Base](#alterando-a-url-base) |
| Projeto somente backend | Nada (apenas API) | Não implantado |

:::note[Primeira visita]
Uma nova implantação de **produção** não oferece uma tela de bootstrap, e seu primeiro registro é uma conta comum. Em vez disso, defina o administrador antes da primeira inicialização — consulte [Seu primeiro admin](#seu-primeiro-admin).
:::

## Docker Compose (Recomendado)

O projeto gerado já inclui um `docker-compose.yml` funcional — **esse arquivo é o que deve ser usado para um projeto gerado por scaffolding**, no estado em que se encontra, em vez de escrito manualmente ou copiado de outro lugar. O `rebase init` preencheu seus segredos, sua primeira conta de administrador e sua versão fixada de runtime, e ele é inicializado pelo próprio acceptance gate do framework a cada push. Ele executa **dois** contêineres: o Postgres e o runtime publicado do Rebase com seu bundle compilado montado nele. Não há imagem de aplicativo para construir.

[Auto-hospedagem](/docs/deployment/self-hosting) cobre a mesma implantação sem um scaffold por trás, usando [`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml) do repositório do Rebase — e as duas coisas que este arquivo deliberadamente omite: um pooler de conexões e a execução de funções e do job worker como processos próprios.

```bash
rebase build          # produces ./dist-bundle
docker compose up -d
```

`rebase build` primeiro, sempre: o serviço `api` monta `./dist-bundle` e, sem ele, o contêiner inicia apontando para um diretório vazio.

A estrutura do arquivo gerado:

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

As três linhas `REBASE_ADMIN_*` / `DISABLE_SELF_REGISTRATION` são novas — na versão 0.17.3, a primeira conta a se registrar se tornava a administradora, inclusive em produção. Veja [Seu primeiro admin](#seu-primeiro-admin) abaixo.

O bundle é montado como somente leitura. O `rebase build` instala as dependências declaradas do projeto em `dist-bundle`, a menos que você passe `--no-vendor`, caso em que o runtime as instala a cada inicialização e a montagem precisa ser gravável — remova o `:ro`. Consulte [Auto-hospedagem](/docs/deployment/self-hosting/#dependencies).

O `rebase init` grava tudo isso no `.env` para você, incluindo uma senha de admin gerada. Cada uma é declarada com `${VAR:?…}`, de modo que uma variável ausente interrompe a stack com uma mensagem indicando-a, em vez de iniciar algo configurado pela metade — e o Compose interpola o arquivo inteiro antes de selecionar os serviços, portanto, uma variável ausente também interrompe `docker compose up -d db`.

Altere o e-mail do admin para o seu, faça login e altere a senha. Consulte [Seu primeiro admin](#seu-primeiro-admin).

### O schema

O runtime cria tabelas ausentes na inicialização, **incluindo as de suas coleções** — `REBASE_MIGRATE_ON_BOOT` tem como padrão `ensure`, que é aditivo em todo o schema e aplica segurança em nível de linha (RLS) junto com ele. Um primeiro `docker compose up` em um banco de dados vazio já inicializa servindo suas coleções.

O que a inicialização nunca faz é alterar algo que já existe: ela não altera o tipo de uma coluna, não remove nada nem edita os rótulos de um enum existente, porque a reinicialização de um contêiner não deve remodelar um schema como efeito colateral de um deploy. Essas alterações passam pela CLI, a partir de um checkout ou de um job de CI apontado para o banco de dados de produção:

```bash
pnpm run db:push
```

Execute-o para qualquer alteração que não seja puramente aditiva — uma coluna renomeada, um tipo mais restrito, um campo removido.

Para um **fluxo de trabalho de equipe versionado**, faça commit dos arquivos de migração com `pnpm run db:generate` e execute `pnpm run db:migrate` como uma etapa de release. De qualquer forma, ele é executado a partir de um checkout do projeto, não dentro do contêiner em execução — a imagem do runtime é distribuída sem a CLI.

## Seu primeiro admin

**Defina `REBASE_ADMIN_EMAIL` e `REBASE_ADMIN_PASSWORD` antes da primeira inicialização.** Todos os guias de plataforma neste site apontam para cá, porque este é o único passo que não tem recuperação pelo lado de fora.

Um banco de dados novo não tem usuários e, fora de produção, a política de registro admite o primeiro cadastro e o promove a administrador. Tem que ser assim: inicializar um admin requer um solicitante que já esteja conectado, de modo que um banco de dados vazio sem essa regra seria um beco sem saída. Em um laptop, a pessoa no teclado é o operador e isso é exatamente o esperado.

Isso é completamente incorreto em um host com um nome público. Os artefatos fornecidos colocam o DNS e o TLS no ar antes que o operador tenha digitado qualquer coisa, portanto, a janela fica aberta para a internet desde o primeiro segundo — e quem acessar o formulário de cadastro primeiro se torna dono da implantação.

Portanto, sob `NODE_ENV=production`, essa janela é fechada. Uma tabela de usuários vazia recusa o registro de bootstrap com `SETUP_REQUIRED`, uma conta criada por meio de registro aberto é uma conta comum, `GET /api/auth/config` nunca anuncia `needsSetup`, e `POST /api/admin/bootstrap` recusa. Na versão 0.17.3 e anteriores, a janela ficava aberta em produção também, portanto atualize antes de expor uma nova implantação.

O `rebase dev` lê o mesmo `.env` e deliberadamente ignora ambas as variáveis, avisando isso na inicialização: localmente, o primeiro registro ainda é a porta de entrada. Os valores que o `rebase init` escreveu pertencem à inicialização de produção. Fazer o seed em ambos os lados fecharia a janela antes que o desenvolvedor abrisse o aplicativo, o que fazia com que o primeiro passo do próprio quickstart gerasse uma conta sem função (role).

Isso deixa duas formas de acesso, nenhuma das quais é uma corrida:

```bash
REBASE_ADMIN_EMAIL=you@example.com
REBASE_ADMIN_PASSWORD=<at least 12 characters>
DISABLE_SELF_REGISTRATION=true
```

O runtime cria essa conta uma única vez, enquanto a tabela de usuários estiver vazia, e não faz nada em todas as inicializações subsequentes. Ou atribua a role a um usuário existente com a chave de serviço, se você provisionar contas fora de banda.

Duas regras que o runtime impõe na inicialização, ambas resultando em uma conta que ninguém pode usar se você errar:

- A senha deve ter **pelo menos 12 caracteres**, caso contrário será recusada e nenhuma conta será criada.
- O endereço deve ser aceito por `POST /api/auth/login` — ele valida o corpo com `z.string().email()`, então um domínio sem ponto (`admin@localhost`) faz o seed normalmente e depois responde 400 em todas as tentativas de login. A inicialização também recusa esse endereço.

Defina ambos ou nenhum: meia credencial é um erro de digitação, e a implantação resultante — auto-registro desativado, sem admin — precisará de um prompt do `psql` para recuperação. A inicialização avisa quando a tabela está vazia em produção e nenhum admin é especificado.

Faça login e altere a senha. Ela está em texto simples onde quer que você tenha colocado seu ambiente.

## Checklist de Produção

Antes de implantar em produção, certifique-se de:

| Item | Detalhes |
|------|----------|
| **Primeiro admin** | Defina `REBASE_ADMIN_EMAIL` e `REBASE_ADMIN_PASSWORD` **antes da primeira inicialização**, e `DISABLE_SELF_REGISTRATION=true`. Em produção, a primeira conta a se registrar não é promovida — consulte [Seu primeiro admin](#seu-primeiro-admin). |
| **NODE_ENV** | `NODE_ENV=production`. É o que fecha a janela de bootstrap, recusa armazenamento de arquivos local, exige `CORS_ORIGINS` e desativa a documentação do OpenAPI. Uma implantação deixada no padrão estará rodando em modo de desenvolvimento. |
| **Schema do banco de dados** | A inicialização cria as tabelas das suas coleções e o RLS delas de forma aditiva. Execute `pnpm run db:push` (ou `pnpm run db:migrate`) para qualquer coisa que não seja puramente aditiva. |
| **JWT_SECRET** | Use uma string aleatória criptograficamente forte (≥ 32 caracteres). Nunca reutilize entre ambientes. |
| **DATABASE_URL** | Use uma instância gerenciada do Postgres (Neon, Supabase, RDS) com TLS ativado |
| **CORS_ORIGINS** | Sempre, não apenas quando o frontend estiver em outro domínio. O runtime se recusa a iniciar em produção se não tiver nem `CORS_ORIGINS` nem `FRONTEND_URL`, porque uma API que adivinha suas origens permitidas eventualmente permitirá a origem errada. |
| **Controle de acesso ao armazenamento** | Um bucket configurado **recusa a inicialização em produção** sem um modelo de controle de acesso. O armazenamento não está sob segurança em nível de linha (RLS) e suas chaves compartilham um namespace plano único; portanto, um padrão de permitir tudo deixa qualquer usuário autenticado listar (`GET /storage/list?prefix=`) e, em seguida, ler, sobrescrever ou excluir os arquivos de todos os outros usuários. Atenda a isso com um hook `storageAuthorize` ou `storagePolicies` (o scaffold inclui um hook em `config/storage.ts`), ou declare a intenção com `STORAGE_PUBLIC_READ` para uma CDN pública legítima, ou `STORAGE_ALLOW_ANY_AUTHENTICATED` para um aplicativo single-tenant onde toda conta é confiável para acessar qualquer arquivo. |
| **Backend de armazenamento** | `STORAGE_TYPE=local` em produção é **ignorado**, e os uploads respondem `501 STORAGE_NOT_CONFIGURED` — o sistema de arquivos do contêiner é destruído na próxima reinicialização, portanto um backend local resulta em perda silenciosa de dados. Use `s3` ou `gcs`, ou defina `FORCE_LOCAL_STORAGE=true` se o caminho for realmente um volume durável. |
| **MFA_ENCRYPTION_KEY** | Defina-o (mais de 32 caracteres aleatórios) se você usar TOTP. Se não definido, os segredos armazenados serão criptografados com `JWT_SECRET` — portanto, rotacioná-lo desconecta todos os usuários *e* torna qualquer autenticador cadastrado indecifrável. |
| **HTTPS** | Termine o TLS no seu proxy reverso (nginx, Cloudflare, balanceador de carga) |
| **Leituras públicas ainda precisam de um chamador** | `access: "public"` expande quais *linhas* um solicitante vê, não quem pode chamar: uma requisição anônima para `/api/data/*` responde 401 enquanto `AUTH_REQUIRE` estiver ativado. Defina `AUTH_REQUIRE=false` para um site público que lê seu próprio backend e deixe apenas o RLS decidir. Como é uma variável de ambiente, um `.env` local que a define **não** é enviado com o seu deploy. |

## Módulos Nativos no Runtime Gerenciado

O runtime gerenciado do Rebase Cloud executa seu bundle dentro de uma imagem compartilhada. Ele não possui compilador e não tem como carregar um **módulo nativo** — qualquer coisa que forneça um binário `.node` pré-compilado. O mais comum, de longe, é o `sharp`, que também é a dependência óbvia para qualquer coisa que sirva imagens.

O `rebase cloud deploy` recusa isso antes do upload, e não depois:

```
This bundle depends on native modules (sharp), which the managed runtime cannot run
```

Três maneiras de resolver isso, na ordem em que costumam ser as mais adequadas:

1. **Mova o trabalho para o momento da compilação.** Redimensione e recodifique imagens na sua etapa de build e implante os resultados. Nada nativo é executado no caminho da requisição.
2. **Use um serviço.** Uma CDN de imagens ou uma API de transformação faz o mesmo trabalho por trás de uma URL.
3. **Execute seu próprio contêiner.** Uma implantação auto-hospedada (Docker, Kubernetes, qualquer um dos [guias de plataforma](/docs/deployment/self-hosting)) usa a sua imagem, portanto, pode conter o que quiser.

Funções que apenas precisam do Node em vez de um binário nativo funcionam normalmente — o deploy relata essas separadamente (`1 of 3 function(s) depend on Node`) e as executa. O [Runtime de backend gerenciado](/docs/deployment/managed-runtime/) cobre o restante do que o runtime gerenciado permite: binários, memória, timeouts, sistema de arquivos, segredos, armazenamento e rede de saída.

## Servindo o Frontend

Em produção, o backend pode servir o frontend como uma SPA estática:

```typescript
import { serveSPA } from "@rebasepro/server";
import path from "path";

// After initializeRebaseBackend()
serveSPA(app, { frontendPath: path.resolve(process.cwd(), "../frontend/dist") });
```

Faça a compilação do frontend primeiro:

```bash
cd frontend && pnpm build
```

Dessa forma, você só precisa implantar um servidor que gerencia tanto a SPA quanto a API.

## Guias de Implantação por Plataforma

Guias passo a passo detalhados para cada plataforma:

| Plataforma | Tipo | Guia |
|------------|------|------|
| **AWS** | App Runner / ECS + RDS | [Deploy on AWS →](/docs/deployment/aws) |
| **Google Cloud** | Cloud Run + Cloud SQL | [Deploy on GCP →](/docs/deployment/gcp) |
| **Azure** | Container Apps + PostgreSQL | [Deploy on Azure →](/docs/deployment/azure) |
| **Hetzner Cloud** | VPS + Docker Compose | [Deploy on Hetzner →](/docs/deployment/hetzner) |
| **Scaleway** | Serverless Containers | [Deploy on Scaleway →](/docs/deployment/scaleway) |
| **Railway** | PaaS (auto-detect Dockerfile) | [Deploy on Railway →](/docs/deployment/railway) |
| **Fly.io** | Container runtime | [Deploy on Fly.io →](/docs/deployment/flyio) |
| **InstaPods** | Node + PostgreSQL in one pod, no Docker | [Deploy on InstaPods →](/docs/deployment/instapods) |
| **Hostman** | App Platform + Managed PostgreSQL, or a VPS | [Deploy on Hostman →](/docs/deployment/hostman) |

:::caution
O Cloud Run e outras plataformas serverless são stateless. Use **armazenamento S3** em vez do sistema de arquivos local para upload de arquivos, e defina `--min-instances 1` se você usar recursos em tempo real do Rebase (as conexões WebSocket são encerradas quando as instâncias escalam para baixo).
:::


## Alterando a URL Base

Se você quiser que o admin seja executado em um subcaminho (por exemplo, `/admin`), altere o `path` do app no `rebase.json`, e o `cms` junto com ele:

```json title="rebase.json"
"admin": {
    "type": "static",
    "root": "frontend",
    "build": "npm run build --workspace frontend",
    "output": "frontend/dist",
    "path": "/admin",
    "cms": "/admin"
}
```

O `cms` é onde o CMS está, para onde o Rebase Cloud aponta, e ele deve estar dentro do `path` do app. O scaffold define ambos como `/`, portanto mover apenas o `path` é recusado — o CMS ficaria em `/`, fora de um aplicativo que agora começa em `/admin`.

Para fornecer ao admin um hostname próprio em vez de um subcaminho, faça do `path` uma URL completa — `"path": "https://admin.example.com"` — e deixe `cms` em `"/"`. O admin então responderá apenas nesse hostname, e não no endereço do próprio projeto, ficando inacessível até que o DNS do hostname seja verificado. A API também permanece em `/api` nesse hostname. Consulte [Um app em seu próprio hostname](/docs/architecture/apps-and-repositories/#an-app-on-its-own-hostname) para entender como as requisições são associadas e o que um deploy no Rebase Cloud faz com o hostname.

O `rebase build` passa `path` para o Vite como `base` (via `REBASE_APP_BASE`), o Vite o devolve como `import.meta.env.BASE_URL`, e o `main.tsx` do scaffold já o fornece ao router — assim, os assets, as rotas e o servidor entram em acordo sem que o prefixo precise ser escrito três vezes:

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

Mantenha o admin em um **data router** — `createBrowserRouter` com `<RouterProvider>`, como o scaffold faz. Com ele, um registro com alterações não salvas também bloqueia a navegação interna do aplicativo (um link no menu lateral, o botão voltar do navegador) e pede confirmação antes, por meio do `useBlocker`, recurso que apenas um data router fornece.

O admin também pode ser executado em um `<BrowserRouter>` simples. Nesse caso, a proteção de alterações não salvas recorre ao diálogo padrão do próprio navegador ao sair da página, o que cobre recarregar a página, fechar a aba ou digitar uma URL; a navegação interna no aplicativo prossegue sem confirmação. Na versão 0.24, o admin lança um erro se estiver fora de um data router.

**Backend** — se você mover a API também, atualize o caminho base dela:

```typescript no-verify
await initializeRebaseBackend({
    // ...
    basePath: "/admin/api"
});
```

:::note[Montagem sem um `basename` no router]
A abordagem com `basename` descrita acima é a recomendada — o react-router remove o prefixo da localização, permitindo que o admin funcione sem alterações. Se, em vez disso, você incorporar o admin dentro de uma **rota com prefixo de caminho** de uma aplicação maior (por exemplo, `<Route path="/admin/*">`) sem `basename`, o caminho atual mantém o prefixo `/admin`. Informe isso ao CMS para que a resolução URL⇄coleção leve o prefixo em consideração — caso contrário, as visualizações ficarão presas em um spinner sem buscar dados:

```tsx
<RebaseCMS collections={collections} basePath="/admin" />
```

Defina **ou** o `basename` do router **ou** o `basePath` do `RebaseCMS` — não ambos, caso contrário o prefixo será aplicado duas vezes.
:::

### App do Produto + Admin em uma Única Implantação

A razão comum para mover o admin para `/admin` é disponibilizar seu **próprio app de produto** na raiz da mesma implantação. Uma única entrada do Vite pode servir ambos, dividida por URL, de modo que cada app seja carregado sob demanda (lazy loading) e os visitantes do produto nunca baixem o bundle do admin:

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

Um roteador para ambas as metades: o admin funciona melhor em um data router, o que permite que alterações não salvas impeçam a navegação interna no app, e não há motivo para o app do produto usar um roteador diferente.

O backend não precisa de alterações para esse padrão — a API permanece em `/api` e o catch-all da SPA serve `index.html` tanto para `/` quanto para `/admin/*`.

## Próximos Passos

- **[Visão Geral do Backend](/docs/backend)** — Configuração completa do backend
- **[Configuração de Armazenamento](/docs/backend/storage)** — Configuração do S3 para produção
