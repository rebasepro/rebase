---
sourceHash: 3346d2728eb8f2e4
title: Ambiente e Configuração
sidebar_label: Configuração
description: Todas as variáveis de ambiente e opções de configuração para projetos Rebase.
---

## Variáveis de Ambiente

Toda a configuração é feita através de variáveis de ambiente no seu arquivo `.env` na raiz do projeto.

> **Importante**: O Rebase valida as variáveis de ambiente com **Zod** no arranque.
> Se faltar algo obrigatório ou estiver malformado (um URL que não é um URL, uma
> porta que não é um número), o servidor recusa arrancar e nomeia a variável.
>
> Onde vive o esquema depende de como executa o backend. Um projeto arrancado pelo
> runtime — `rebase dev`, `rebase start`, a imagem publicada — usa o esquema do
> próprio runtime (`loadBootEnv` em `@rebasepro/server`), que é a união de todas as
> tabelas abaixo. Um projeto que executou [`rebase eject`](/docs/cli) possui o seu
> próprio `backend/src/env.ts` com `loadEnv({ extend })`, e pode acrescentar aí as
> suas variáveis tipadas.

### Obrigatórias

| Variável | Descrição | Exemplo |
|----------|-------------|---------|
| `DATABASE_URL` | String de conexão PostgreSQL | `postgresql://user:pass@localhost:5432/mydb` |
| `JWT_SECRET` | Chave secreta para assinar tokens JWT. Use uma string aleatória forte (mínimo 32 caracteres). | `a1b2c3d4e5...` |

### Frontend

| Variável | Descrição | Padrão |
|----------|-------------|---------|
| `VITE_API_URL` | URL da API de backend para o SDK do cliente. **Defina-o apenas em desenvolvimento.** | origem da página |
| `VITE_GOOGLE_CLIENT_ID` | ID do cliente Google OAuth. Habilita "Fazer login com o Google". | — |

### Backend

| Variável | Descrição | Padrão |
|----------|-------------|---------|
| `PORT` | Porta para o servidor HTTP de backend | `3001` |
| `LOG_LEVEL` | Nível de verbosidade de log: `error`, `warn`, `info`, `debug` | `info` |
| `NODE_ENV` | Ambiente: `development` ou `production` | `development` |

### Autenticação

| Variável | Descrição | Padrão |
|----------|-------------|---------|
| `JWT_SECRET` | Segredo para assinatura JWT (obrigatório se a autenticação estiver habilitada) | — |
| `JWT_ACCESS_EXPIRES_IN` | Tempo de vida do token de acesso | `1h` |
| `JWT_REFRESH_EXPIRES_IN` | Tempo de vida do token de atualização | `30d` |
| `ALLOW_REGISTRATION` | Permitir que novos usuários se registrem (`true`/`false`). O primeiro usuário sempre pode se registrar. | `true` |
| `GOOGLE_CLIENT_ID` | ID do cliente Google OAuth (validação de backend) | — |

### Armazenamento

| Variável | Descrição | Padrão |
|----------|-------------|---------|
| `STORAGE_TYPE` | Backend de armazenamento: `local` ou `s3` | `local` |
| `STORAGE_PATH` | Caminho base para armazenamento local | `./uploads` |
| `S3_BUCKET` | Nome do bucket S3 (quando `STORAGE_TYPE=s3`) | — |
| `S3_REGION` | Região AWS | — |
| `S3_ACCESS_KEY_ID` | Chave de acesso AWS | — |
| `S3_SECRET_ACCESS_KEY` | Chave secreta AWS | — |
| `S3_ENDPOINT` | Endpoint S3 personalizado (para MinIO, Cloudflare R2, etc.) | — |

### Email (Opcional)

| Variável | Descrição |
|----------|-------------|
| `SMTP_HOST` | Host do servidor SMTP |
| `SMTP_PORT` | Porta do servidor SMTP |
| `SMTP_SECURE` | Enable secure connection (`true`/`false`) |
| `SMTP_USER` | Nome de usuário SMTP |
| `SMTP_PASS` | Senha SMTP |
| `EMAIL_FROM` | Endereço do remetente para e-mails do sistema |

## Objeto de Configuração do Backend

O `RebaseBackendConfig` passado para `initializeRebaseBackend()` fornece controle programático:

```typescript
import { initializeRebaseBackend } from "@rebasepro/server";
import { createPostgresAdapter } from "@rebasepro/server-postgres";
import { env } from "./env";

await initializeRebaseBackend({
    app,
    server,
    collectionsDir: "./config/collections",
    basePath: "/api",        // Base path for all API routes (default: "/api")

    database: createPostgresAdapter({
        connection: db,
        schema: { tables, enums, relations }
    }),

    auth: {                  // Authentication config
        jwtSecret: env.JWT_SECRET,
        accessExpiresIn: env.JWT_ACCESS_EXPIRES_IN,
        refreshExpiresIn: env.JWT_REFRESH_EXPIRES_IN,
        requireAuth: true,    // Require auth for data API (default: true)
        allowRegistration: env.ALLOW_REGISTRATION,
        google: env.GOOGLE_CLIENT_ID
            ? {
                clientId: env.GOOGLE_CLIENT_ID,
                clientSecret: env.GOOGLE_CLIENT_SECRET
            }
            : undefined,
        serviceKey: env.REBASE_SERVICE_KEY
    },

    storage: env.STORAGE_TYPE === "s3"
        ? {
            type: "s3",
            bucket: env.S3_BUCKET!,
            region: env.S3_REGION,
            accessKeyId: env.S3_ACCESS_KEY_ID,
            secretAccessKey: env.S3_SECRET_ACCESS_KEY,
            endpoint: env.S3_ENDPOINT
        }
        : {
            type: "local",
            basePath: env.STORAGE_PATH || "./uploads"
        },

    history: true,           // Enable entity change history

    enableSwagger: true,     // Enable OpenAPI docs at /api/docs

    logging: {
        level: "info"
    }
});
```

## Próximos Passos

- **[Implantação](/docs/getting-started/deployment)** — Guia de implantação em produção
- **[Visão Geral do Backend](/docs/backend)** — Referência completa de configuração do backend
---
