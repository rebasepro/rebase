---
sourceHash: 145ba18b6f108fbd
title: Implantação
sidebar_label: Implantação
description: Faça o deploy do seu projeto Rebase em produção usando Docker, plataformas em nuvem ou configurações manuais.
---

## O que uma Implantação Serve

Um projeto Rebase é implantado como **um único servidor** (no Rebase Cloud: `https://<project>.rebase.website`). Esse servidor lida com:

- **`/api/*`** — a API de dados, autenticação, realtime e armazenamento
- **todo o resto** — seu `frontend/` compilado como uma SPA estática

Não há um serviço de administração separado: o painel de administração faz parte de um frontend, portanto onde ele aparece depende de como é o seu frontend e se você concede a ele um hostname próprio.

| Tipo de projeto | A URL raiz exibe | O painel de administração fica em |
|-----------------|------------------|-----------------------------------|
| Scaffold padrão (`rebase init`) | O painel de administração | `/` — o frontend **é** o admin |
| Frontend de produto personalizado | Seu aplicativo | Onde quer que você o monte, geralmente `/admin` — veja [Alterando a URL Base](#alterando-a-url-base) |
| Admin como um app em seu próprio hostname | Seu aplicativo | `https://admin.example.com/`, servido pelo mesmo servidor — veja [Alterando a URL Base](#alterando-a-url-base) |
| Projeto apenas de backend | Nada (apenas API) | Não implantado |

:::note[Primeira visita]
Uma nova implantação de **produção** não oferece uma tela de bootstrap, e seu primeiro registro é uma conta comum. Em vez disso, defina o administrador antes da primeira inicialização — veja [Seu primeiro admin](#seu-primeiro-admin).
:::

## Docker Compose (Recomendado)

O projeto gerado já inclui um `docker-compose.yml` funcional — **esse arquivo é o que deve ser usado para um projeto com scaffold**, exatamente como está, em vez de escrito manualmente ou copiado de outro lugar. O `rebase init` preencheu seus segredos, sua primeira conta de administrador e sua versão fixada do runtime, sendo inicializado pelo próprio gate de aceitação do framework a cada push. Ele executa **dois** containers: o Postgres e o runtime publicado do Rebase com seu bundle compilado montado nele. Não há imagem de aplicativo para compilar.

[Auto-hospedagem](/docs/deployment/self-hosting) cobre a mesma implantação sem um scaffold por trás, usando [`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml) do repositório do Rebase — e as duas coisas que este arquivo deliberadamente omite: um pooler de conexões e a execução de functions e do worker de jobs como seus próprios processos.

```bash
rebase build          # produces ./dist-bundle
docker compose up -d
```

Execute `rebase build` primeiro, sempre: o serviço `api` monta `./dist-bundle` e, sem ele, o container inicializa apontando para um diretório vazio.

O formato do arquivo gerado:

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

Veja [Seu primeiro admin](#seu-primeiro-admin) abaixo para as três linhas `REBASE_ADMIN_*` / `DISABLE_SELF_REGISTRATION`.

O bundle é montado como somente leitura. O `rebase build` instala as dependências declaradas do projeto em `dist-bundle`, a menos que você passe `--no-vendor`, caso em que o runtime as instala a cada inicialização e o ponto de montagem precisa ter permissão de escrita — remova o `:ro`. Veja [Auto-hospedagem](/docs/deployment/self-hosting/#dependencies).

O `rebase init` grava todas essas variáveis no `.env` para você, incluindo uma senha de administrador gerada. Cada uma é declarada com `${VAR:?…}`, de modo que uma variável ausente interrompe a stack com uma mensagem indicando seu nome em vez de iniciar algo parcialmente configurado — e o Compose interpola o arquivo inteiro antes de selecionar os serviços, portanto uma ausência também interrompe o comando `docker compose up -d db`.

Altere o e-mail do admin para o seu, faça login e altere a senha. Veja [Seu primeiro admin](#seu-primeiro-admin).

### O schema

<span class="since-badge" data-since="0.31">Desde 0.31</span>

O runtime cria tabelas ausentes na inicialização, **incluindo as declaradas em `backend/schema`** — `REBASE_MIGRATE_ON_BOOT` tem como padrão `ensure`, que é aditivo em todo o schema e aplica row-level security junto a ele. Uma primeira execução do `docker compose up` contra um banco de dados vazio já inicializa servindo suas tabelas.

O que a inicialização nunca faz é alterar algo que já existe: ela não altera o tipo de uma coluna, não remove nada nem edita os rótulos de um enum existente, porque o reinício de um container não deve remodelar um schema como efeito colateral de um deploy. Essas alterações são feitas pela CLI, a partir de um checkout local ou de um job de CI apontado para o banco de dados de produção:

```bash
pnpm run db:push
```

Execute isso para qualquer alteração que não seja puramente aditiva — uma coluna renomeada, um tipo mais restrito, um campo removido.

Para um **fluxo de trabalho de equipe com versionamento**, comite arquivos de migração com `pnpm run db:generate` e execute `pnpm run db:migrate` como uma etapa de release. De qualquer forma, ele é executado a partir de um checkout do projeto, não dentro do container em execução — a imagem do runtime é distribuída sem a CLI.

## Seu primeiro admin

**Configure `REBASE_ADMIN_EMAIL` e `REBASE_ADMIN_PASSWORD` antes da primeira inicialização.**
Todos os guias de plataforma deste site apontam para cá, pois este é o único passo sem recuperação a partir do exterior.

Um banco de dados novo não possui usuários, e fora de produção a política de registro aceita o primeiro cadastro e o promove a administrador. Tem que ser assim: fazer o bootstrap de um admin exige um chamador que já esteja autenticado, portanto um banco de dados vazio sem tal regra seria um beco sem saída. Em um laptop, a pessoa no teclado é o operador e isso funciona perfeitamente.

No entanto, isso é um grande erro em um host com um nome público. Os artefatos distribuídos sobem DNS e TLS antes que o operador tenha digitado qualquer coisa, então a janela fica aberta para a internet desde o primeiro segundo — e quem acessar o formulário de cadastro primeiro se torna dono da implantação.

Portanto, sob `NODE_ENV=production` essa janela fica fechada. Uma tabela de usuários vazia recusa o registro de bootstrap com `SETUP_REQUIRED`, uma conta criada por registro aberto é uma conta comum, `GET /api/auth/config` nunca informa `needsSetup` e `POST /api/admin/bootstrap` recusa a operação.

O `rebase dev` lê o mesmo `.env` e deliberadamente ignora ambas as variáveis, informando isso na inicialização: localmente, o primeiro registro ainda é o método de entrada. Os valores gravados pelo `rebase init` pertencem à inicialização de produção. Fazer o seed em ambos os lados consumiria a janela antes que o desenvolvedor pudesse abrir o app, o que fazia com que o próprio primeiro passo do quickstart gerasse uma conta sem roles.

Isso deixa duas formas de acesso, nenhuma das quais envolve uma corrida:

```bash
REBASE_ADMIN_EMAIL=you@example.com
REBASE_ADMIN_PASSWORD=<at least 12 characters>
DISABLE_SELF_REGISTRATION=true
```

O runtime cria essa conta uma única vez, enquanto a tabela de usuários estiver vazia, e não faz nada em todas as inicializações subsequentes. Ou atribua a role a um usuário existente com a chave de serviço, caso você faça o provisionamento de contas fora da aplicação.

Duas regras que o runtime impõe na inicialização, ambas resultando em uma conta inutilizável caso você erre:

- A senha deve ter **pelo menos 12 caracteres**, caso contrário ela é recusada e nenhuma conta é criada.
- O endereço deve ser um que o `POST /api/auth/login` aceite — ele valida o corpo com `z.string().email()`, portanto um domínio sem ponto (`admin@localhost`) é inserido normalmente no seed, mas depois responde com erro 400 a cada login. A inicialização também recusa esse endereço.

Defina ambos ou nenhum: metade de uma credencial é um erro de digitação, e a implantação resultante — auto-registro desativado, nenhum admin — exigirá um prompt do `psql` para ser recuperada. A inicialização avisa quando a tabela estiver vazia em produção e nenhum admin for especificado.

Faça login e altere a senha. Ela estará armazenada em texto simples onde quer que você tenha definido seu ambiente.

## Checklist de Produção

Antes de implantar em produção, certifique-se de:

| Item | Detalhes |
|------|---------|
| **Primeiro admin** | Configure `REBASE_ADMIN_EMAIL` e `REBASE_ADMIN_PASSWORD` **antes da primeira inicialização**, e `DISABLE_SELF_REGISTRATION=true`. Em produção, a primeira conta a se registrar não é promovida — veja [Seu primeiro admin](#seu-primeiro-admin). |
| **NODE_ENV** | `NODE_ENV=production`. É o que fecha a janela de bootstrap, recusa armazenamento local de arquivos, exige `CORS_ORIGINS` e desativa a documentação OpenAPI. Uma implantação deixada no padrão é executada em modo de desenvolvimento. |
| **Schema do banco de dados** | A inicialização cria suas tabelas declaradas e o RLS delas de forma aditiva. Execute `pnpm run db:push` (ou `pnpm run db:migrate`) para qualquer alteração que não seja puramente aditiva. |
| **JWT_SECRET** | Use uma string aleatória criptograficamente forte (≥ 32 caracteres). Nunca a reutilize entre ambientes. |
| **DATABASE_URL** | Use uma instância gerenciada de Postgres (Neon, Supabase, RDS) com TLS habilitado. |
| **CORS_ORIGINS** | Sempre, não apenas quando o frontend estiver em outro domínio. O runtime se recusa a iniciar em produção sem `CORS_ORIGINS` nem `FRONTEND_URL`, pois uma API que tenta adivinhar suas origens permitidas eventualmente permitirá a origem errada. |
| **Controle de acesso ao storage** | Um bucket configurado **recusa a inicialização em produção** sem um modelo de controle de acesso. O storage não está sob row-level security e suas chaves compartilham um namespace único e plano; portanto, um padrão que permite tudo autoriza qualquer usuário autenticado a listar (`GET /storage/list?prefix=`) e, em seguida, ler, sobrescrever ou excluir os arquivos de todos os outros usuários. Atenda a isso com um hook `storageAuthorize` ou `storagePolicies` (o scaffold inclui um hook em `backend/storage.ts`), ou declare a intenção com `STORAGE_PUBLIC_READ` para um CDN público legítimo, ou `STORAGE_ALLOW_ANY_AUTHENTICATED` para um aplicativo single-tenant onde toda conta é confiável para acessar qualquer arquivo. |
| **Backend de storage** | `STORAGE_TYPE=local` em produção é **ignorado**, e uploads respondem com `501 STORAGE_NOT_CONFIGURED` — o sistema de arquivos do container é destruído no próximo reinício, portanto um backend local resulta em perda silenciosa de dados. Use `s3` ou `gcs`, ou configure `FORCE_LOCAL_STORAGE=true` se o caminho for realmente um volume durável. |
| **MFA_ENCRYPTION_KEY** | Defina-o (32+ caracteres aleatórios) se você usar TOTP. Se não estiver definido, os segredos armazenados serão criptografados com o `JWT_SECRET` — portanto, rotacioná-lo desconectará todos os usuários *e* tornará todos os autenticadores cadastrados indecifráveis. |
| **HTTPS** | Faça a terminação de TLS no seu reverse proxy (nginx, Cloudflare, load balancer). |
| **Leituras públicas ainda precisam de um chamador** | `access: "public"` expande quais *linhas* um chamador pode ver, não quem tem permissão para chamar: uma requisição anônima para `/api/data/*` responde 401 enquanto `AUTH_REQUIRE` estiver ativado. Defina `AUTH_REQUIRE=false` para um site público que lê seu próprio backend e deixe apenas o RLS decidir. Essa é uma variável de ambiente, portanto um `.env` local que a define **não** acompanha seu deploy. |

## Módulos Nativos no Runtime Gerenciado

O runtime gerenciado do Rebase Cloud executa seu bundle dentro de uma imagem compartilhada. Ele não possui compilador nem forma de carregar um **módulo nativo** — qualquer coisa que distribua um binário `.node` pré-compilado. O mais comum, de longe, é o `sharp`, que também é a dependência óbvia para qualquer coisa que sirva imagens.

O `rebase cloud deploy` recusa isso antes do upload, em vez de depois:

```
This bundle depends on native modules (sharp), which the managed runtime cannot run
```

Existem três caminhos para resolver isso, na ordem em que costumam ser apropriados:

1. **Mova o trabalho para o tempo de build.** Redimensione e recodifique imagens na sua etapa de build e implante os resultados. Nada nativo é executado no caminho da requisição.
2. **Use um serviço.** Um CDN de imagens ou uma API de transformação realiza o mesmo trabalho atrás de uma URL.
3. **Execute seu próprio container.** Uma implantação auto-hospedada (Docker, Kubernetes, qualquer um dos [guias de plataforma](/docs/deployment/self-hosting)) utiliza sua própria imagem, portanto ela pode conter o que quiser.

Functions que apenas precisam do Node em vez de um binário nativo funcionam normalmente — o deploy relata essas separadamente (`1 of 3 function(s) depend on Node`) e as executa. O [Runtime de backend gerenciado](/docs/deployment/managed-runtime/) aborda o restante do que o runtime gerenciado permite: binários, memória, timeouts, sistema de arquivos, segredos, storage e rede de saída.

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

Dessa forma, você só precisa implantar um servidor que gerencia tanto a SPA quanto a API.

## Guias de Implantação por Plataforma

Guias detalhados passo a passo para cada plataforma:

| Plataforma | Tipo | Guia |
|------------|------|------|
| **AWS** | App Runner / ECS + RDS | [Deploy na AWS →](/docs/deployment/aws) |
| **Google Cloud** | Cloud Run + Cloud SQL | [Deploy no GCP →](/docs/deployment/gcp) |
| **Azure** | Container Apps + PostgreSQL | [Deploy no Azure →](/docs/deployment/azure) |
| **Hetzner Cloud** | VPS + Docker Compose | [Deploy na Hetzner →](/docs/deployment/hetzner) |
| **Scaleway** | Serverless Containers | [Deploy na Scaleway →](/docs/deployment/scaleway) |
| **Railway** | PaaS (detecção automática de Dockerfile) | [Deploy na Railway →](/docs/deployment/railway) |
| **Fly.io** | Container runtime | [Deploy no Fly.io →](/docs/deployment/flyio) |
| **InstaPods** | Node + PostgreSQL em um único pod, sem Docker | [Deploy no InstaPods →](/docs/deployment/instapods) |
| **Hostman** | App Platform + Managed PostgreSQL, ou uma VPS | [Deploy no Hostman →](/docs/deployment/hostman) |

:::caution
O Cloud Run e outras plataformas serverless são stateless. Use **armazenamento S3** em vez do sistema de arquivos local para upload de arquivos e defina `--min-instances 1` se você usar os recursos de realtime do Rebase (as conexões WebSocket são encerradas quando as instâncias reduzem para zero).
:::


## Alterando a URL Base

Se você deseja que o admin seja executado em um sub-path (ex: `/admin`), altere o `path` do aplicativo no `rebase.json`, e o `cms` junto com ele:

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

`cms` é onde fica o CMS para o qual o Rebase Cloud aponta os links, e ele deve estar dentro do `path` do aplicativo. O scaffold define ambos como `/`, portanto mover apenas o `path` é recusado — o CMS ficaria em `/`, fora de um aplicativo que agora começa em `/admin`.

Para fornecer ao admin um hostname próprio em vez de um sub-path, defina o `path` como uma URL completa — `"path": "https://admin.example.com"` — e deixe o `cms` como `"/"`. O admin passará a responder apenas naquele hostname, e não no endereço principal do projeto, ficando inacessível até que o DNS do hostname seja verificado. A API permanece em `/api` naquele hostname também. Veja [Um app em seu próprio hostname](/docs/architecture/apps-and-repositories/#an-app-on-its-own-hostname) para saber como as requisições são correspondidas e o que o deploy do Rebase Cloud faz com o hostname.

O `rebase build` passa o `path` para o Vite como `base` (via `REBASE_APP_BASE`), o Vite o devolve como `import.meta.env.BASE_URL`, e o `main.tsx` do scaffold já o fornece ao router — portanto, os assets, as rotas e o servidor concordam entre si sem a necessidade de escrever o prefixo três vezes:

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

Mantenha o admin em um **data router** — `createBrowserRouter` com `<RouterProvider>`, como o scaffold faz. Com ele, um registro com alterações não salvas também impede a navegação interna no app (um link no menu lateral, o botão voltar do navegador) e pede confirmação primeiro, por meio de `useBlocker`, que apenas um data router fornece.

O admin também funciona sob um `<BrowserRouter>` simples. Nesse caso, a proteção de alterações não salvas recorre ao diálogo padrão de saída de página do próprio navegador, que cobre recarregamento, fechamento da aba ou digitação de uma URL; a navegação dentro do app prossegue sem confirmação.

**Backend** — se você mover a API também, atualize seu caminho base:

```typescript no-verify
await initializeRebaseBackend({
    // ...
    basePath: "/admin/api"
});
```

:::note[Montagem sem um `basename` no router]
A abordagem com `basename` acima é a recomendada — o react-router remove o prefixo da localização, então o admin funciona inalterado. Se, em vez disso, você incorporar o admin dentro de uma **rota com prefixo de caminho** de uma aplicação maior (ex: `<Route path="/admin/*">`) sem `basename`, o caminho atual mantém seu prefixo `/admin`. Avise o CMS sobre isso para que a resolução URL⇄tabela leve o prefixo em consideração — caso contrário, as visualizações ficarão travadas em um spinner sem carregar dados:

```tsx
<RebaseCMS tableCustomizations={tableCustomizations} basePath="/admin" />
```

Defina **ou** o `basename` do router **ou** `RebaseCMS basePath` — não ambos, caso contrário o prefixo será aplicado duas vezes.
:::

### App de Produto + Admin em Uma Única Implantação

O motivo comum para mover o admin para `/admin` é distribuir seu **próprio aplicativo de produto** na raiz da mesma implantação. Uma única entrada do Vite pode servir ambos, divididos por URL, de modo que cada app seja carregado sob demanda (lazy-loaded) e os visitantes do produto nunca baixem o bundle do admin:

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

Um único router para ambas as partes: é melhor manter o admin em um data router, o que permite que alterações não salvas impeçam a navegação interna, e não há razão para o app de produto estar em um diferente.

O backend não precisa de alterações para esse padrão — a API permanece em `/api` e a rota catch-all da SPA serve o `index.html` tanto para `/` quanto para `/admin/*`.

## Próximos Passos

- **[Visão Geral do Backend](/docs/backend)** — Configuração completa do backend
- **[Configuração de Armazenamento](/docs/backend/storage)** — Configuração do S3 para produção
