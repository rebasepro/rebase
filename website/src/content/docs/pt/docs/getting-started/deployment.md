---
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
    build:
      context: .
      dockerfile: backend/Dockerfile
    ports:
      - "3001:3001"
    environment:
      DATABASE_URL: postgresql://rebase_app:rebase@postgres:5432/rebase
      JWT_SECRET: ${JWT_SECRET}
      NODE_ENV: production
    depends_on:
      - postgres
    volumes:
      - uploads:/app/uploads

volumes:
  pgdata:
  uploads:
```

```bash
docker compose up -d
```

## Criar o Esquema do Banco de Dados

Ao iniciar, o Rebase cria automaticamente **apenas as tabelas de autenticação** — as tabelas das suas próprias coleções não são criadas sozinhas. Execute `pnpm run db:push` **uma vez** contra o banco de dados de produção; caso contrário, a aplicação sobe e o login funciona normalmente, mas toda coleção retorna um erro de tabela ausente ("missing table"):

```bash
DATABASE_URL="<sua string de conexão de produção>" pnpm run db:push
```

Rode isso a partir de um checkout do projeto ou da sua CI, com a `DATABASE_URL` apontando para produção — **não** dentro do contêiner, pois a imagem de produção não inclui a CLI. Para migrações versionadas, use `pnpm run db:generate` e depois `pnpm run db:migrate`.

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
| **Registro** | Defina `ALLOW_REGISTRATION=false` após criar sua conta de administrador |

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

Se você quiser que a Rebase rode em um subcaminho (por ex., `/admin`):

**Frontend** — Atualize o `basename` do `BrowserRouter`:

```tsx title="frontend/src/main.tsx"
<BrowserRouter basename="/admin">
    <App />
</BrowserRouter>
```

**Backend** — Atualize o caminho base:

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
const AdminApp = lazy(() => import("./AdminApp")); // renders <RebaseCMS basePath="/admin" />

if (isAdmin) {
    // The admin uses useBlocker → needs a data router
    const router = createBrowserRouter([{ path: "/admin/*", element: <AdminApp /> }]);
    root.render(<RouterProvider router={router} />);
} else {
    root.render(<BrowserRouter><ProductApp /></BrowserRouter>);
}
```

O backend não precisa de alterações para esse padrão — a API permanece em `/api` e o catch-all da SPA
serve `index.html` tanto para `/` quanto para `/admin/*`.

## Próximos Passos

- **[Visão Geral do Backend](/docs/backend)** — Configuração completa do backend
- **[Configuração de Armazenamento](/docs/backend/storage)** — Configuração de S3 para produção
