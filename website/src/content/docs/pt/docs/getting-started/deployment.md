---
title: Implantação
sidebar_label: Implantação
description: Implante seu projeto Rebase em produção usando Docker, plataformas de nuvem ou configurações manuais.
---

## Docker Compose (Recomendado)

O projeto gerado inclui um `Dockerfile` e `docker-compose.yml`. Esta é a maneira mais simples de implantar:

```yaml title="docker-compose.yml"
services:
  postgres:
    image: postgres:18-alpine
    environment:
      POSTGRES_USER: rebase
      POSTGRES_PASSWORD: rebase
      POSTGRES_DB: rebase
    volumes:
      - pgdata:/var/lib/postgresql/data
    ports:
      - "5432:5432"

  app:
    build: ./backend
    ports:
      - "3001:3001"
    environment:
      DATABASE_URL: postgresql://rebase:rebase@postgres:5432/rebase
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

## Lista de Verificação de Produção

Antes de implantar em produção, certifique-se:

| Item | Detalhes |
|------|---------|
| **JWT_SECRET** | Use uma string aleatória criptograficamente forte (≥ 32 caracteres). Nunca reutilize entre ambientes. |
| **DATABASE_URL** | Use uma instância Postgres gerenciada (Neon, Supabase, RDS) com TLS ativado |
| **CORS** | Configure as origens permitidas no seu backend se o frontend e o backend estiverem em domínios diferentes |
| **Volumes de armazenamento** | Monte volumes persistentes para uploads de arquivos. Ou mude para S3 para produção. |
| **HTTPS** | Termine o TLS no seu proxy reverso (nginx, Cloudflare, balanceador de carga) |
| **Registro** | Defina `ALLOW_REGISTRATION=false` após criar sua conta de administrador |

## Servindo o Frontend

Em produção, o backend pode servir o frontend como uma SPA estática:

```typescript
import { serveSPA } from "@rebasepro/server";

// After initializeRebaseBackend()
import path from "path";

// After initializeRebaseBackend()
serveSPA(app, { frontendPath: path.resolve(process.cwd(), "../frontend/dist") });
```

Primeiro, construa o frontend:

```bash
cd frontend && pnpm build
```

Dessa forma, você só precisa implantar um servidor que lida com SPA e API.

## Plataformas de Nuvem

### Railway / Render / Fly.io

1. Envie seu código para um repositório Git
2. Conecte o repositório à sua plataforma de nuvem
3. Defina as variáveis de ambiente (`DATABASE_URL`, `JWT_SECRET`, etc.)
4. O `Dockerfile` incluído será detectado automaticamente

### Google Cloud Run

```bash
# Build the container
docker build -t gcr.io/YOUR_PROJECT/rebase-backend ./backend

# Push to Container Registry
docker push gcr.io/YOUR_PROJECT/rebase-backend

# Deploy
gcloud run deploy rebase-backend \
  --image gcr.io/YOUR_PROJECT/rebase-backend \
  --set-env-vars DATABASE_URL=...,JWT_SECRET=... \
  --allow-unauthenticated
```

:::caution
Instâncias do Cloud Run são sem estado. Use **armazenamento S3** em vez de sistema de arquivos local para uploads de arquivos, e habilite **tempo real entre instâncias** fornecendo uma `connectionString` em seu `PostgresBootstrapper` para que as atualizações do WebSocket se propaguem entre as réplicas.
:::

## Alterando a URL Base

Se você quiser que o Rebase seja executado em um subcaminho (por exemplo, `/admin`):

**Frontend** — Atualize o `basename` do `BrowserRouter`:

```tsx title="frontend/src/main.tsx"
<BrowserRouter basename="/admin">
    <App />
</BrowserRouter>
```

**Backend** — Atualize o caminho base:

```typescript
await initializeRebaseBackend({
    // ...
    basePath: "/admin/api"
});
```

## Próximos Passos

- **[Visão Geral do Backend](/docs/backend)** — Configuração completa do backend
- **[Configuração de Armazenamento](/docs/storage)** — Configuração S3 para produção

---
