---
sourceHash: 1fb30b9d3983d379
title: Implantação
sidebar_label: Implantação
description: Implante seu projeto Rebase em produção usando Docker, plataformas em nuvem ou configurações manuais.
---

## O Que uma Implantação Serve

Um projeto Rebase é implantado como **um único servidor** (no Rebase Cloud: `https://<projeto>.rebase.website`). Esse servidor lida com:

- **`/api/*`** — a API de dados, autenticação, realtime e storage
- **todo o resto** — seu `frontend/` compilado como uma SPA estática

Não há um serviço de administração separado: o painel administrativo faz parte de um frontend, portanto, onde ele aparece depende de qual é o seu frontend e se você define um hostname próprio para ele.

| Tipo de projeto | A URL raiz exibe | O painel admin fica em |
|-----------------|------------------|------------------------|
| Scaffold padrão (`rebase init`) | O painel admin | `/` — o frontend **é** o admin |
| Frontend de produto personalizado | Sua aplicação | Onde quer que você o monte, geralmente `/admin` — veja [Alterando a URL Base](#alterando-a-url-base) |
| Admin como um app em seu próprio hostname | Sua aplicação | `https://admin.example.com/`, servido pelo mesmo servidor — veja [Alterando a URL Base](#alterando-a-url-base) |
| Projeto apenas backend | Nada (apenas API) | Não implantado |

:::note[Primeiro acesso]
Uma implantação **de produção** nova não oferece uma tela de bootstrap, e seu primeiro registro é uma conta comum. Em vez disso, defina o administrador antes da primeira inicialização — veja [Seu primeiro admin](#seu-primeiro-admin).
:::

## Docker Compose (Recomendado)

O projeto gerado já inclui um `docker-compose.yml` funcional — **esse
arquivo é o que deve ser usado para um projeto criado a partir de scaffold**, tal como está,
em vez de ser escrito manualmente ou copiado de outro lugar. O comando `rebase init` preencheu
seus segredos, sua primeira conta de administrador e sua versão fixada do runtime, e ele é
inicializado pela própria barreira de aceitação do framework a cada push. Ele executa
**dois** contêineres: o Postgres e o runtime publicado do Rebase com seu bundle compilado
montado nele. Não há imagem de aplicação para compilar.

O guia de [Auto-hospedagem](/docs/deployment/self-hosting) aborda a mesma implantação sem
um scaffold por trás, usando
[`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml)
do repositório do Rebase — e os dois pontos que este arquivo omite deliberadamente: um pooler de conexões
e a execução de functions e do job worker como processos próprios.

```bash
rebase build          # produces ./dist-bundle
docker compose up -d
```

Execute `rebase build` primeiro, sempre: o serviço `api` monta `./dist-bundle`, e
sem ele o contêiner inicia apontando para um diretório vazio.

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

As três linhas `REBASE_ADMIN_*` / `DISABLE_SELF_REGISTRATION` são novas
— na versão 0.17.3, a primeira conta a se registrar torna-se a administradora,
inclusive em produção. Veja [Seu primeiro admin](#seu-primeiro-admin) abaixo.

O bundle é montado como somente leitura. O comando `rebase build` instala as dependências
declaradas do projeto em `dist-bundle`, a menos que você passe `--no-vendor`, caso em que o
runtime as instala a cada inicialização e a montagem precisa ser gravável — remova o
`:ro`. Veja [Auto-hospedagem](/docs/deployment/self-hosting/#dependencies).

O `rebase init` grava tudo isso no arquivo `.env` para você, incluindo uma senha de
administrador gerada. Cada uma é declarada com `${VAR:?…}`, de modo que uma variável ausente
interrompe a stack com uma mensagem indicando-a, em vez de iniciar algo configurado pela metade —
e o Compose interpola o arquivo inteiro antes de selecionar os serviços, portanto, uma ausência
interrompe o `docker compose up -d db` também.

Altere o e-mail do admin para o seu, faça login e altere a senha. Veja [Seu
primeiro admin](#seu-primeiro-admin).

### O schema

O runtime cria as tabelas ausentes na inicialização, **incluindo as de suas collections** —
`REBASE_MIGRATE_ON_BOOT` tem como padrão `ensure`, que é aditivo em todo o
schema e aplica a row-level security junto com ele. Um primeiro `docker compose up`
em um banco de dados vazio inicia servindo suas collections.

O que a inicialização nunca faz é alterar algo que já existe: ela não altera
o tipo de uma coluna, não remove nada nem edita os labels de um enum existente, porque o
reinício de um contêiner não deve remodelar um schema como efeito colateral de um deploy. Essas
mudanças passam pela CLI, a partir de um checkout local ou de um job de CI apontado para o
banco de dados de produção:

```bash
pnpm run db:push
```

Execute-o para qualquer alteração que não seja puramente aditiva — uma coluna renomeada,
um tipo restrito, um campo removido.

Para um **fluxo de trabalho versionado e em equipe**, faça o commit dos arquivos de migração com
`pnpm run db:generate` e execute `pnpm run db:migrate` como uma etapa de release.
De qualquer forma, isso é executado a partir de um checkout do projeto, e não dentro do contêiner em execução —
a imagem de runtime é distribuída sem a CLI.

## Seu primeiro admin

**Configure `REBASE_ADMIN_EMAIL` e `REBASE_ADMIN_PASSWORD` antes da primeira inicialização.**
Todos os guias de plataforma deste site apontam para cá, pois este é o único passo que
não possui recuperação externa.

Um banco de dados novo não tem usuários, e fora de produção a política de registro
aceita o primeiro cadastro e o promove a admin. Tem que ser assim: fazer o bootstrap de um
admin requer um chamador que já esteja autenticado, portanto, um banco de dados vazio sem essa
regra seria um beco sem saída. Em um notebook, a pessoa no teclado é o operador e
isso faz todo sentido.

Mas está completamente errado em um host com um domínio público. Os artefatos distribuídos
colocam o DNS e o TLS no ar antes que o operador digite qualquer coisa, de modo que a janela fica aberta
para a internet desde o primeiro segundo — e quem acessar o formulário de cadastro primeiro
assume o controle da implantação.

Portanto, sob `NODE_ENV=production`, essa janela fica fechada. Uma tabela de usuários vazia
recusa o registro de bootstrap com `SETUP_REQUIRED`, uma conta criada
por meio de registro aberto torna-se uma conta comum, `GET /api/auth/config` nunca
anuncia `needsSetup`, e `POST /api/admin/bootstrap` recusa a requisição. Na versão 0.17.3 e
anteriores, a janela também ficava aberta em produção, então atualize antes de expor uma
nova implantação.

O comando `rebase dev` lê o mesmo `.env` e ignora deliberadamente ambas as variáveis,
avisando isso na inicialização: localmente, o primeiro registro ainda é o meio de entrada. Os valores
que o `rebase init` gravou pertencem à inicialização em produção. Fazer o seed em ambos os lados
esgotaria a janela antes mesmo de o desenvolvedor abrir a aplicação, o que fazia com que o
primeiro passo do próprio quickstart gerasse uma conta sem permissões.

Isso deixa duas formas de entrada, nenhuma das quais envolve uma disputa de velocidade (race condition):

```bash
REBASE_ADMIN_EMAIL=you@example.com
REBASE_ADMIN_PASSWORD=<at least 12 characters>
DISABLE_SELF_REGISTRATION=true
```

O runtime cria essa conta uma única vez, enquanto a tabela de usuários estiver vazia, e não faz
nada em todas as inicializações posteriores. Ou atribua a role a um usuário existente com
a service key, caso você provisione contas por outros canais.

Duas regras que o runtime impõe na inicialização, ambas resultando em uma conta que ninguém
consegue usar caso você cometa um erro:

- A senha deve ter **pelo menos 12 caracteres**, caso contrário será recusada e nenhuma
  conta será criada.
- O endereço de e-mail deve ser um que o `POST /api/auth/login` aceite — ele valida o corpo
  da requisição com `z.string().email()`, portanto um domínio sem ponto (`admin@localhost`) é
  inserido sem erros mas responde 400 em todas as tentativas de login. A inicialização também recusa esse endereço.

Configure ambas ou nenhuma: meia credencial é um erro de digitação, e a implantação resultante
— com autorregistro desativado e sem admin — exigirá um terminal `psql` para recuperação. O boot emite
um aviso quando a tabela estiver vazia em produção e nenhum admin for informado.

Faça login e altere a senha. Ela estará armazenada em texto simples onde quer que você coloque
suas variáveis de ambiente.

## Checklist de Produção

Antes de implantar em produção, certifique-se de:

| Item | Detalhes |
|------|---------|
| **Primeiro admin** | Configure `REBASE_ADMIN_EMAIL` e `REBASE_ADMIN_PASSWORD` **antes da primeira inicialização**, e `DISABLE_SELF_REGISTRATION=true`. Em produção, a primeira conta a se registrar não é promovida — veja [Seu primeiro admin](#seu-primeiro-admin). |
| **NODE_ENV** | `NODE_ENV=production`. É o que fecha a janela de bootstrap, recusa armazenamento de arquivos local, exige `CORS_ORIGINS` e desativa a documentação OpenAPI. Uma implantação deixada no padrão é executada em modo de desenvolvimento. |
| **Schema do banco de dados** | A inicialização cria as tabelas de suas collections e suas RLS de forma aditiva. Execute `pnpm run db:push` (ou `pnpm run db:migrate`) para qualquer coisa que não seja puramente aditiva. |
| **JWT_SECRET** | Use uma string aleatória criptograficamente forte (≥ 32 caracteres). Nunca reutilize entre ambientes. |
| **DATABASE_URL** | Use uma instância gerenciada do Postgres (Neon, Supabase, RDS) com TLS ativado |
| **CORS_ORIGINS** | Sempre, não apenas quando o frontend estiver em outro domínio. O runtime se recusa a iniciar em produção sem `CORS_ORIGINS` nem `FRONTEND_URL`, pois uma API que tenta adivinhar suas origens permitidas eventualmente permitirá a incorreta. |
| **Controle de acesso ao storage** | Um bucket configurado **recusa a inicialização em produção** sem um modelo de controle de acesso. O storage não está sob row-level security e suas chaves compartilham um namespace único e plano, de modo que um padrão que permite tudo autoriza qualquer usuário autenticado a listar (`GET /storage/list?prefix=`) e, em seguida, ler, sobrescrever ou excluir os arquivos de todos os outros usuários. Resolva isso com um hook `storageAuthorize` ou `storagePolicies` (o scaffold inclui um hook em `config/storage.ts`), ou declare a intenção com `STORAGE_PUBLIC_READ` para uma CDN pública legítima, ou `STORAGE_ALLOW_ANY_AUTHENTICATED` para um app single-tenant onde todas as contas têm permissão total sobre todos os arquivos. |
| **Backend de storage** | `STORAGE_TYPE=local` em produção é **ignorado**, e os uploads respondem `501 STORAGE_NOT_CONFIGURED` — o sistema de arquivos do contêiner é destruído no próximo reinício, portanto um backend local resulta em perda silenciosa de dados. Use `s3` ou `gcs`, ou configure `FORCE_LOCAL_STORAGE=true` se o caminho for realmente um volume durável. |
| **MFA_ENCRYPTION_KEY** | Configure-a (32+ caracteres aleatórios) se você usar TOTP. Se não configurada, os segredos armazenados serão criptografados com o `JWT_SECRET` — portanto, rotacioná-lo desconectará todos os usuários *e* tornará todos os autenticadores configurados indecifráveis. |
| **HTTPS** | Faça a terminação TLS no seu proxy reverso (nginx, Cloudflare, load balancer) |
| **Leituras públicas ainda precisam de um chamador** | `access: "public"` amplia quais *linhas* um chamador pode ver, não quem tem permissão para chamar: uma requisição anônima para `/api/data/*` responde 401 enquanto `AUTH_REQUIRE` estiver ativo. Configure `AUTH_REQUIRE=false` para um site público que lê seu próprio backend, e deixe o RLS decidir sozinho. Esta é uma variável de ambiente, portanto um `.env` local que a define **não** é enviado junto com o seu deploy. |

## Módulos Nativos no Runtime Gerenciado

O runtime gerenciado do Rebase Cloud executa seu bundle dentro de uma imagem compartilhada. Ele não possui
um compilador nem meios para carregar um **módulo nativo** — qualquer biblioteca que venha com um binário
`.node` pré-compilado. O mais comum de longe é o `sharp`, que também é a dependência
óbvia para qualquer aplicação que processe imagens.

O comando `rebase cloud deploy` recusa isso antes do upload, em vez de falhar depois:

```
This bundle depends on native modules (sharp), which the managed runtime cannot run
```

Existem três maneiras de resolver, na ordem em que costumam ser mais adequadas:

1. **Mova o processamento para o momento da compilação.** Redimensione e recodifique imagens na etapa
   de build e implante os resultados. Nada nativo roda no caminho da requisição.
2. **Use um serviço.** Uma CDN de imagens ou uma API de transformação faz o mesmo trabalho através
   de uma URL.
3. **Execute seu próprio contêiner.** Uma implantação auto-hospedada (Docker, Kubernetes, qualquer
   um dos [guias de plataforma](/docs/deployment/self-hosting)) utiliza sua própria imagem, podendo
   conter o que você desejar.

Functions que apenas precisam de Node em vez de um binário nativo funcionam normalmente — o
deploy as reporta separadamente (`1 of 3 function(s) depend on Node`) e as
executa. O guia de [Runtime de backend gerenciado](/docs/deployment/managed-runtime/) aborda o
restante do que o runtime gerenciado permite: binários, memória, timeouts, o
sistema de arquivos, segredos, storage e rede de saída.

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
| **AWS** | App Runner / ECS + RDS | [Implantar na AWS →](/docs/deployment/aws) |
| **Google Cloud** | Cloud Run + Cloud SQL | [Implantar no GCP →](/docs/deployment/gcp) |
| **Azure** | Container Apps + PostgreSQL | [Implantar no Azure →](/docs/deployment/azure) |
| **Hetzner Cloud** | VPS + Docker Compose | [Implantar na Hetzner →](/docs/deployment/hetzner) |
| **Scaleway** | Serverless Containers | [Implantar na Scaleway →](/docs/deployment/scaleway) |
| **Railway** | PaaS (detecção automática de Dockerfile) | [Implantar no Railway →](/docs/deployment/railway) |
| **Fly.io** | Runtime de contêineres | [Implantar no Fly.io →](/docs/deployment/flyio) |

:::caution
O Cloud Run e outras plataformas serverless são stateless. Use o **armazenamento S3** em vez do sistema de arquivos local para uploads de arquivos, e configure `--min-instances 1` se você utiliza os recursos realtime do Rebase (as conexões WebSocket são encerradas quando as instâncias diminuem na escala).
:::


## Alterando a URL Base

Se você deseja que o admin seja executado em um subcaminho (por exemplo, `/admin`), altere o
`path` do app no `rebase.json`, e o seu `cms` juntamente:

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

`cms` é onde o CMS está localizado, para o qual o Rebase Cloud aponta os links, e ele deve estar contido
dentro do `path` do app. O scaffold configura ambos como `/`, portanto, alterar apenas o `path` é
recusado — o CMS ficaria em `/`, fora de um app que agora inicia em `/admin`.

Para fornecer ao admin um hostname próprio em vez de um subcaminho, defina `path` como uma
URL completa — `"path": "https://admin.example.com"` — e deixe `cms` como `"/"`.
O admin responderá apenas nesse hostname, e não no endereço principal do projeto,
ficando inacessível até que o DNS do hostname seja verificado. A API permanece
em `/api` também nesse hostname. Veja
[Um app em seu próprio hostname](/docs/architecture/apps-and-repositories/#an-app-on-its-own-hostname)
para saber como as requisições são correspondidas e o que uma implantação no Rebase Cloud faz com o
hostname.

O comando `rebase build` passa `path` para o Vite como `base` (via `REBASE_APP_BASE`), o Vite o
disponibiliza de volta como `import.meta.env.BASE_URL`, e o arquivo `main.tsx` do scaffold já
o repassa ao roteador — assim, os assets, as rotas e o servidor permanecem alinhados
sem que o prefixo precise ser definido em três lugares diferentes:

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

Mantenha o admin em um **data router** — `createBrowserRouter` com
`<RouterProvider>`, como o scaffold faz. Sob ele, um registro com alterações
não salvas também interrompe a navegação interna da aplicação (um link no menu lateral, o botão
de voltar do navegador) e pergunta primeiro, através do `useBlocker`, recurso que apenas
um data router fornece.

O admin também
pode ser executado sob um `<BrowserRouter>` simples. Nele, a proteção contra alterações não salvas
recorre ao aviso padrão de saída de página do próprio navegador, que cobre recarregamentos, fechamento de
aba ou digitação de URL; navegar dentro da aplicação continuará sem confirmação. Na
versão 0.24, o admin lança um erro se estiver fora de um data router.

**Backend** — se você mover a API também, atualize seu caminho base:

```typescript no-verify
await initializeRebaseBackend({
    // ...
    basePath: "/admin/api"
});
```

:::note[Montagem sem um `basename` no router]
A abordagem com `basename` acima é a recomendada — o react-router remove o
prefixo da localização, de modo que o admin funcione sem alterações. Se, em vez disso, você incorporar o
admin dentro de uma **rota com prefixo de caminho** de uma aplicação maior (por exemplo, `<Route path="/admin/*">`)
sem um `basename`, o caminho atual manterá seu prefixo `/admin`. Notifique o CMS sobre
isso para que a resolução URL⇄collection considere o prefixo — caso contrário, as telas travarão em um
indicador de carregamento sem realizar a busca de dados:

```tsx
<RebaseCMS collections={collections} basePath="/admin" />
```

Configure **ou** o `basename` do router **ou** o `RebaseCMS basePath` — não ambos, caso contrário o
prefixo será aplicado duas vezes.
:::

### App do Produto + Admin em uma Única Implantação

O motivo mais comum para mover o admin para `/admin` é disponibilizar sua **própria aplicação de produto**
na raiz da mesma implantação. Uma única entrada do Vite pode servir a ambos, divididos por URL,
de modo que cada aplicação seja carregada sob demanda (lazy loading) e os visitantes do produto nunca baixem o bundle do admin:

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

Um roteador para ambas as metades: o admin funciona melhor em um data router, o que
permite que alterações não salvas impeçam a navegação dentro do app, e não há razão para o
app do produto utilizar um diferente.

O backend não precisa de alterações para esse padrão — a API permanece em `/api` e o fallback
da SPA serve o `index.html` tanto para `/` quanto para `/admin/*`.

## Próximos Passos

- **[Visão Geral do Backend](/docs/backend)** — Configuração completa do backend
- **[Configuração de Storage](/docs/backend/storage)** — Configuração do S3 para produção
