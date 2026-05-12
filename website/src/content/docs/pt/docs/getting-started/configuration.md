---
title: Ambiente e Configuração
sidebar_label: Configuração
slug: docs/getting-started/configuration
description: Todas as variáveis de ambiente e opções de configuração para projetos Rebase.
---

## Variáveis de Ambiente

Toda a configuração é feita através de variáveis de ambiente no seu arquivo `.env` na raiz do projeto.

> **Importante**: Rebase utiliza **Zod** para validar variáveis de ambiente na inicialização em `src/env.ts`. Se alguma variável obrigatória estiver faltando ou formatada incorretamente (como URLs ou portas), o servidor não conseguirá iniciar e fornecerá uma mensagem de erro clara.

### Obrigatórias

| Variável | Descrição | Exemplo |
|----------|-------------|---------|
| `DATABASE_URL` | String de conexão PostgreSQL | `postgresql://user:pass@localhost:5432/mydb` |
| `JWT_SECRET` | Chave secreta para assinar tokens JWT. Use uma string aleatória forte (mínimo 32 caracteres). | `a1b2c3d4e5...` |

### Frontend

| Variável | Descrição | Padrão |
|----------|-------------|---------|
| `VITE_API_URL` | URL da API de backend. Usada pelo SDK do cliente. | `http://localhost:3001` |
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
| `STORAGE_BASE_PATH` | Caminho base para armazenamento local | `./uploads` |
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
| `SMTP_USER` | Nome de usuário SMTP |
| `SMTP_PASS` | Senha SMTP |
| `EMAIL_FROM` | Endereço do remetente para e-mails do sistema |

## Objeto de Configuração do Backend

O `RebaseBackendConfig` passado para `initializeRebaseBackend()` fornece controle programático:

```typescript
import { env } from "./env";

await initializeRebaseBackend({
    app,
    server,
    collections,
    basePath: "/api",        // Caminho base para todas as rotas da API (padrão: "/api")

    bootstrappers: [         // Bootstrappers de banco de dados e serviço
        createPostgresBootstrapper({
            connection: db,
            schema: { tables, enums, relations }
        })
    ],

    auth: {                  // Configuração de autenticação
        jwtSecret: env.JWT_SECRET,
        accessExpiresIn: env.JWT_ACCESS_EXPIRES_IN,
        refreshExpiresIn: env.JWT_REFRESH_EXPIRES_IN,
        requireAuth: true,    // Exigir autenticação para a API de dados (padrão: true)
        allowRegistration: env.ALLOW_REGISTRATION,
        google: {
            clientId: env.GOOGLE_CLIENT_ID
        }
    },

    storage: {               // Configuração de armazenamento de arquivos
        type: "local",
        basePath: "./uploads"
    },

    history: true,           // Habilitar histórico de alterações de entidade

    enableSwagger: true,     // Habilitar documentação OpenAPI em /api/data/docs

    logging: {
        level: "info"
    }
});
```

## Próximos Passos

- **[Implantação](/docs/getting-started/deployment)** — Guia de implantação em produção
- **[Visão Geral do Backend](/docs/backend)** — Referência completa de configuração do backend
---
