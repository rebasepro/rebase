---
sourceHash: 54382ae26efa26ea
title: Implantação
sidebar_label: Implantação
description: Implante seu projeto Rebase em produção usando Docker, plataformas em nuvem ou configurações manuais.
---

## O que uma Implantação Serve

Um projeto Rebase é implantado como **um único servidor** (no Rebase Cloud: `https://<projeto>.rebase.website`). Esse servidor lida com:

- **`/api/*`** — a API de dados, autenticação, tempo real (realtime) e armazenamento (storage)
- **todo o restante** — seu `frontend/` compilado como uma SPA estática

Não há um serviço de administração separado: o painel administrativo faz parte de um frontend, portanto, onde ele aparece depende de qual é o seu frontend e se você define um hostname próprio para ele.

| Tipo de projeto | URL raiz exibe | Painel administrativo fica em |
|-----------------|----------------|-------------------------------|
| Scaffold padrão (`rebase init`) | O painel administrativo | `/` — o frontend **é** o admin |
| Frontend de produto personalizado | Sua aplicação | Onde quer que você o monte, comumente `/admin` — consulte [Alterando a URL Base](#alterando-a-url-base) |
| Admin como uma aplicação em seu próprio hostname | Sua aplicação | `https://admin.exemplo.com/`, servido pelo mesmo servidor — consulte [Alterando a URL Base](#alterando-a-url-base) |
| Projeto somente backend | Nada (apenas API) | Não implantado |

:::note[Primeira visita]
Uma nova implantação em **produção** não oferece uma tela de bootstrap (inicialização rápida), e seu primeiro registro é uma conta comum. Em vez disso, defina o administrador antes da primeira inicialização — consulte [Seu primeiro admin](#seu-primeiro-admin).
:::

## Docker Compose (Recomendado)

O projeto gerado já inclui um arquivo `docker-compose.yml` funcional — **esse arquivo é o que deve ser usado para um projeto baseado no scaffold**, no formato em que se encontra, em vez de ser escrito à mão ou copiado de outro lugar. O comando `rebase init` preencheu seus segredos, sua primeira conta de administrador e sua versão fixada do runtime, sendo inicializado pelo próprio gate de aceitação do framework a cada push. Ele executa **dois** contêineres: Postgres e o runtime publicado do Rebase com seu bundle compilado montado nele. Não há imagem de aplicação para compilar.

[Auto-hospedagem (Self-Hosting)](/docs/deployment/self-hosting) aborda a mesma implantação sem um scaffold de base, usando [`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml) do repositório Rebase — e os dois pontos que este arquivo deixa de fora deliberadamente: um pooler de conexões e a execução de functions e do job worker como processos próprios.

```bash
rebase build          # produces ./dist-bundle
docker compose up -d
```

Execute `rebase build` primeiro, sempre: o serviço `api` monta `./dist-bundle` e, sem ele, o contêiner inicia apontando para um diretório vazio.

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

Consulte [Seu primeiro admin](#seu-primeiro-admin) abaixo para detalhes sobre as três linhas `REBASE_ADMIN_*` / `DISABLE_SELF_REGISTRATION`.

O bundle é montado como somente leitura. `rebase build` instala as dependências declaradas do projeto no diretório `dist-bundle`, a menos que você passe a flag `--no-vendor`; nesse caso, o runtime as instala a cada inicialização e o ponto de montagem precisará ter permissão de escrita — remova o `:ro`. Consulte [Auto-hospedagem](/docs/deployment/self-hosting/#dependencies).

O comando `rebase init` grava tudo isso no arquivo `.env` para você, incluindo uma senha de administrador gerada. Cada variável é declarada com `${VAR:?…}`, de modo que a ausência de alguma interrompe a inicialização da stack com uma mensagem indicando o item ausente, em vez de iniciar um ambiente parcialmente configurado — e como o Compose interpola o arquivo inteiro antes de selecionar os serviços, a ausência de uma variável interrompe até mesmo `docker compose up -d db`.

Altere o e-mail do admin para o seu, faça login e altere a senha. Consulte [Seu primeiro admin](#seu-primeiro-admin).

### O schema

O runtime cria as tabelas ausentes na inicialização, **incluindo aquelas declaradas em `backend/schema`** — `REBASE_MIGRATE_ON_BOOT` tem como padrão `ensure`, que atua de forma aditiva em todo o schema e aplica segurança em nível de linha (RLS) junto a ele. Uma primeira execução de `docker compose up` em um banco de dados vazio já inicializa disponibilizando suas tabelas.

O que a inicialização nunca faz é alterar algo que já existe: ela não altera o tipo de uma coluna, não remove nada e não edita os rótulos de um enum existente, pois o reinício de um contêiner não deve remodelar um schema como efeito colateral de um deploy. Essas alterações são feitas por meio da CLI, a partir de um checkout local ou de um job de CI apontado para o banco de dados de produção:

```bash
pnpm run db:push
```

Execute isso para qualquer alteração que não seja puramente aditiva — uma coluna renomeada, um tipo restringido ou um campo removido.

Para um **fluxo de trabalho de equipe com controle de versão**, versione os arquivos de migração com `pnpm run db:generate` e execute `pnpm run db:migrate` como uma etapa de release. De qualquer forma, ele é executado a partir do checkout do projeto, não dentro do contêiner em execução — a imagem do runtime não inclui a CLI.

## Seu primeiro admin

**Defina `REBASE_ADMIN_EMAIL` e `REBASE_ADMIN_PASSWORD` antes da primeira inicialização.**
Todos os guias de plataformas neste site apontam para cá, pois este é o único passo que não permite recuperação externa direta.

No Rebase Cloud, não há nada para configurar: os proprietários e administradores da organização dona do projeto abrem seu painel administrativo a partir da página do projeto no console (**Open CMS**, ou **Continue with Rebase Cloud** na própria tela de login do admin) e já entram autenticados como administradores. Esta seção se destina a qualquer outro ambiente onde você execute o Rebase.

Um banco de dados novo não tem usuários e, fora de produção, a política de registro aceita o primeiro cadastro e o promove a administrador. Tem que ser assim: a inicialização de um admin requer um solicitante que já esteja autenticado, portanto, um banco vazio sem essa regra seria um beco sem saída. Em um laptop, a pessoa no teclado é o operador e isso funciona perfeitamente.

No entanto, isso é um erro crítico em um host com um nome público. Os artefatos entregues sobem o DNS e o TLS antes que o operador tenha digitado qualquer coisa, deixando a janela aberta para a internet desde o primeiro segundo — e quem acessar o formulário de cadastro primeiro se torna dono da implantação.

Portanto, sob `NODE_ENV=production`, essa janela fica fechada. Uma tabela de usuários vazia recusa o registro de bootstrap com `SETUP_REQUIRED`, uma conta criada por registro aberto é uma conta comum, `GET /api/auth/config` nunca informa `needsSetup` e `POST /api/admin/bootstrap` é recusado.

O comando `rebase dev` lê o mesmo arquivo `.env`, ignora deliberadamente ambas as variáveis e informa isso na inicialização: localmente, o primeiro registro continua sendo a porta de entrada. Os valores gravados por `rebase init` pertencem à inicialização em produção. Inserir dados iniciais (seeding) em ambos os lados consumiria essa janela antes que o desenvolvedor abrisse o app, o que fazia com que o primeiro passo do quickstart gerasse uma conta sem perfil/papel.

Isso deixa dois caminhos de entrada, nenhum dos quais envolve condição de corrida:

```bash
REBASE_ADMIN_EMAIL=you@example.com
REBASE_ADMIN_PASSWORD=<at least 12 characters>
DISABLE_SELF_REGISTRATION=true
```

O runtime cria essa conta uma única vez enquanto a tabela de usuários estiver vazia, e não faz nada em todas as inicializações subsequentes. Outra opção é atribuir o perfil a um usuário existente utilizando a chave de serviço (service key), caso você faça o provisionamento de contas fora da aplicação.

Duas regras que o runtime impõe na inicialização, e que geram uma conta inutilizável caso você erre:

- A senha deve ter **pelo menos 12 caracteres**, caso contrário será recusada e nenhuma conta será criada.
- O endereço de e-mail deve ser aceito por `POST /api/auth/login` — a validação do corpo da requisição é feita com `z.string().email()`, portanto, um domínio sem ponto (`admin@localhost`) é inserido sem problemas no banco, mas responderá 400 em todas as tentativas de login. A inicialização também recusa esse tipo de endereço.

Defina ambos ou nenhum: fornecer apenas metade das credenciais é considerado um erro de digitação, e o estado resultante — auto-registro desativado, nenhum admin — exigirá acesso direto via prompt do `psql` para recuperação. O processo de inicialização emite um aviso quando a tabela estiver vazia em produção e nenhum admin tiver sido especificado.

Faça login e altere a senha. Ela permanece em texto simples onde quer que suas variáveis de ambiente estejam salvas.

## Checklist de Produção

Antes de implantar em produção, certifique-se de verificar:

| Item | Detalhes |
|------|----------|
| **Primeiro admin** | Defina `REBASE_ADMIN_EMAIL` e `REBASE_ADMIN_PASSWORD` **antes da primeira inicialização**, e `DISABLE_SELF_REGISTRATION=true`. Em produção, a primeira conta a se registrar não é promovida — consulte [Seu primeiro admin](#seu-primeiro-admin). |
| **NODE_ENV** | `NODE_ENV=production`. É isso que fecha a janela de bootstrap, recusa armazenamento local de arquivos, exige `CORS_ORIGINS` e desativa a documentação OpenAPI. Uma implantação deixada no padrão é executada em modo de desenvolvimento. |
| **Schema do banco de dados** | A inicialização cria suas tabelas declaradas e seu RLS de forma aditiva. Execute `pnpm run db:push` (ou `pnpm run db:migrate`) para qualquer modificação que não seja puramente aditiva. |
| **JWT_SECRET** | Use uma string aleatória criptograficamente forte (≥ 32 caracteres). Nunca reutilize entre ambientes. |
| **DATABASE_URL** | Use uma instância gerenciada de Postgres (Neon, Supabase, RDS) com TLS habilitado. |
| **CORS_ORIGINS** | Sempre configure, não apenas quando o frontend estiver em outro domínio. O runtime se recusa a iniciar em produção sem `CORS_ORIGINS` ou `FRONTEND_URL`, pois uma API que tenta adivinhar suas origens permitidas eventualmente autorizará a origem errada. |
| **Controle de acesso ao storage** | Um bucket configurado **recusa-se a inicializar em produção** sem um modelo de controle de acesso. O storage não está sob segurança em nível de linha (RLS) e suas chaves compartilham um namespace único e plano; portanto, um padrão que permite tudo autoriza qualquer usuário autenticado a listar (`GET /storage/list?prefix=`) e, em seguida, ler, sobrescrever ou excluir arquivos de todos os outros usuários. Resolva isso com um hook `storageAuthorize` ou `storagePolicies` (o scaffold inclui um hook em `backend/storage.ts`), ou declare explicitamente a intenção com `STORAGE_PUBLIC_READ` para um CDN verdadeiramente público, ou `STORAGE_ALLOW_ANY_AUTHENTICATED` para um app single-tenant onde todas as contas têm permissão total sobre qualquer arquivo. |
| **Backend de storage** | `STORAGE_TYPE=local` em produção é **ignorado**, e uploads respondem com `501 STORAGE_NOT_CONFIGURED` — o sistema de arquivos do contêiner é destruído no próximo reinício, o que significa perda silenciosa de dados com o backend local. Use `s3` ou `gcs`, ou defina `FORCE_LOCAL_STORAGE=true` caso o caminho aponte de fato para um volume persistente. |
| **MFA_ENCRYPTION_KEY** | Configure esta variável (32+ caracteres aleatórios) se você usa TOTP. Se não definida, os segredos armazenados serão criptografados com `JWT_SECRET` — fazendo com que a rotação desta deslogue todos os usuários *e* torne indecifrável qualquer autenticador cadastrado. |
| **HTTPS** | Faça a terminação TLS no seu proxy reverso (nginx, Cloudflare, load balancer). |
| **Leituras públicas ainda exigem autenticação** | `access: "public"` expande quais *linhas* o chamador pode ver, não quem pode chamar a API: uma requisição anônima para `/api/data/*` responde com 401 enquanto `AUTH_REQUIRE` estiver ativado. Defina `AUTH_REQUIRE=false` para um site público que consome seu próprio backend, deixando que apenas o RLS decida o acesso. Por ser uma variável de ambiente, um `.env` local contendo essa opção **não** viaja automaticamente com o seu deploy. |

## Módulos Nativos no Runtime Gerenciado

O runtime gerenciado do Rebase Cloud executa seu bundle dentro de uma imagem compartilhada. Ele não possui compilador nem capacidade de carregar um **módulo nativo** — qualquer item que forneça um binário `.node` pré-compilado. O exemplo mais comum, de longe, é o `sharp`, que costuma ser a dependência padrão para qualquer serviço que manipule imagens.

O comando `rebase cloud deploy` bloqueia essa ação antes do upload em vez de falhar depois:

```
This bundle depends on native modules (sharp), which the managed runtime cannot run
```

Três formas de resolver, na ordem em que costumam ser mais adequadas:

1. **Mova o processamento para a etapa de compilação (build time).** Redimensione e recodifique imagens durante a etapa de build e implante os resultados prontos. Nada nativo precisa rodar no caminho da requisição.
2. **Use um serviço externo.** Uma CDN de imagens ou uma API de transformação executa o mesmo trabalho por trás de uma URL.
3. **Execute seu próprio contêiner.** Uma implantação auto-hospedada (Docker, Kubernetes ou qualquer um dos [guias de plataformas](/docs/deployment/self-hosting)) utiliza a sua própria imagem, podendo incluir o que for necessário.

Functions que necessitam apenas do Node sem exigir um binário nativo funcionam normalmente — o deploy relata essas ocorrências separadamente (`1 of 3 function(s) depend on Node`) e as executa. O guia [Runtime de backend gerenciado](/docs/deployment/managed-runtime/) cobre as demais permissões do runtime gerenciado: binários, memória, tempos limite (timeouts), sistema de arquivos, segredos, armazenamento e rede de saída.

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
| **Railway** | PaaS (detecção automática de Dockerfile) | [Implantar na Railway →](/docs/deployment/railway) |
| **Fly.io** | Runtime de contêineres | [Implantar na Fly.io →](/docs/deployment/flyio) |
| **InstaPods** | Node + PostgreSQL em um pod, sem Docker | [Implantar no InstaPods →](/docs/deployment/instapods) |
| **Hostman** | App Platform + PostgreSQL Gerenciado, ou VPS | [Implantar no Hostman →](/docs/deployment/hostman) |

:::caution
O Cloud Run e outras plataformas serverless são stateless. Use **armazenamento S3** em vez do sistema de arquivos local para upload de arquivos, e configure `--min-instances 1` caso você utilize os recursos de realtime do Rebase (conexões WebSocket são finalizadas quando as instâncias escalam para zero).
:::

## Alterando a URL Base

Se você deseja que o admin rode em um sub-caminho (por exemplo, `/admin`), altere o `path` da aplicação em `rebase.json`, e o `cms` juntamente com ele:

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

O parâmetro `cms` indica onde o CMS está localizado — para onde o Rebase Cloud aponta os links — e ele deve estar contido dentro do `path` da aplicação. O scaffold define ambos como `/`, portanto, alterar apenas o `path` será recusado — caso contrário, o CMS ficaria em `/`, fora de uma aplicação que agora inicia em `/admin`.

Para fornecer ao admin um hostname próprio em vez de um sub-caminho, defina `path` como uma URL completa — `"path": "https://admin.exemplo.com"` — e mantenha `cms` como `"/"`. Assim, o admin responderá exclusivamente naquele hostname, e não no endereço principal do projeto, tornando-se inacessível até que o DNS do hostname seja propagado e validado. A API continuará disponível em `/api` também sob esse hostname. Consulte [Uma aplicação em seu próprio hostname](/docs/architecture/apps-and-repositories/#an-app-on-its-own-hostname) para saber como as requisições são roteadas e o que o deploy do Rebase Cloud faz com o hostname.

O comando `rebase build` passa o `path` para o Vite como `base` (via `REBASE_APP_BASE`), o Vite o expõe como `import.meta.env.BASE_URL`, e o arquivo `main.tsx` do scaffold já o encaminha para o roteador — garantindo que assets, rotas e o servidor fiquem alinhados sem a necessidade de duplicar o prefixo em múltiplos lugares:

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

Mantenha o painel administrativo em um **data router** — `createBrowserRouter` com `<RouterProvider>`, exatamente como o scaffold faz. Dessa forma, qualquer registro com alterações pendentes interrompe a navegação interna do app (um link no menu lateral, o botão voltar do navegador) e solicita confirmação antes de prosseguir, utilizando `useBlocker` — recurso exclusivo de um data router.

O admin também
pode ser executado sob um `<BrowserRouter>` simples. Nesse caso, a proteção contra perda de dados recorre ao prompt nativo do navegador para saída da página, que cobre situações como recarregar, fechar a aba ou digitar uma nova URL; a navegação interna entre páginas do app ocorrerá sem solicitar confirmação.

**Backend** — se você mover a API também, atualize o caminho base dela:

```typescript no-verify
await initializeRebaseBackend({
    // ...
    basePath: "/admin/api"
});
```

:::note[Montagem sem um `basename` no roteador]
A abordagem com `basename` apresentada acima é a recomendada — o react-router remove o prefixo da localização, permitindo que o admin funcione sem alterações. Se, em vez disso, você incorporar o admin dentro de uma **rota com prefixo de caminho** em uma aplicação maior (por exemplo, `<Route path="/admin/*">`) sem `basename`, o caminho atual manterá o prefixo `/admin`. Notifique o CMS sobre isso para que a correspondência URL⇄tabela considere o prefixo — caso contrário, as telas travarão em um carregamento infinito sem buscar os dados:

```tsx
<RebaseCMS tableCustomizations={tableCustomizations} basePath="/admin" />
```

Configure **ou** o `basename` do roteador **ou** o `basePath` do `RebaseCMS` — nunca ambos, sob risco de duplicar o prefixo.
:::

### Aplicação Principal + Admin em uma Única Implantação

O motivo mais comum para mover o admin para `/admin` é disponibilizar a **sua própria aplicação de produto** na raiz da mesma implantação. Uma única entrada do Vite pode atender a ambos, dividindo pelo caminho da URL, garantindo que cada app seja carregado sob demanda (lazy-loaded) e que os usuários comuns do seu produto nunca façam o download do bundle do admin:

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

Um único roteador para ambas as metades: o painel administrativo opera melhor em um data router, permitindo que alterações pendentes bloqueiem navegações internas indevidas, e não há motivo para a aplicação de produto rodar sobre um modelo diferente.

O backend não precisa de alterações para esse padrão — a API permanece em `/api` e a regra de fallback (catch-all) da SPA serve o `index.html` tanto para `/` quanto para `/admin/*`.

## Próximos Passos

- **[Visão Geral do Backend](/docs/backend)** — Configuração completa do backend
- **[Configuração de Armazenamento](/docs/backend/storage)** — Configuração do S3 para produção
