---
title: Integração de Servidor Personalizado
sidebar_label: Servidor Personalizado (Express)
description: Como incorporar os serviços Rebase Database e Realtime no seu próprio backend Node.js sem usar Hono ou o coordenador Rebase.
---

# Integração de Servidor Personalizado

O Rebase foi construído para ser completamente modular. Embora o coordenador `initializeRebaseBackend` forneça um backend completo com Hono, você pode ignorá-lo completamente e incorporar o **Adaptador de Banco de Dados** principal e os **WebSockets em Tempo Real** diretamente na sua própria aplicação Node.js (como Express, Fastify ou HTTP do Node.js nativo).

O pacote `@rebasepro/server-postgres` é totalmente agnóstico em relação a frameworks. Ele depende apenas do Drizzle ORM e do `http.Server` padrão do Node.js.

## Configuração do Ambiente

O Rebase fornece um utilitário centralizado `loadEnv()` em `@rebasepro/server` que valida suas variáveis de ambiente em relação a um esquema estrito do Zod. Chame-o **depois** de carregar seu arquivo `.env`:

```typescript
import dotenv from "dotenv";
import { loadEnv } from "@rebasepro/server";

dotenv.config({ path: "../../.env" });

// Básico — apenas variáveis de ambiente do Rebase:
export const env = loadEnv();

// Estendido — adicione suas próprias variáveis tipadas:
import { z } from "@rebasepro/server";
export const env = loadEnv({
    extend: z.object({
        SMTP_HOST: z.string().optional(),
        SMTP_PORT: z.string().default("587").transform(Number),
        STRIPE_SECRET_KEY: z.string(),
    })
});
// env.SMTP_HOST  → string | undefined  (totalmente tipado)
// env.STRIPE_SECRET_KEY → string        (validado, obrigatório)
```

**Principais comportamentos:**
- Gera automaticamente segredos efêmeros `JWT_SECRET` e `REBASE_SERVICE_KEY` em desenvolvimento para que você possa iniciar sem configuração manual.
- Bloqueia segredos gerados automaticamente em produção — você deve defini-los explicitamente.
- Valida se `CORS_ORIGINS` ou `FRONTEND_URL` está definido em produção.

Consulte o arquivo `.env.example` na aplicação gerada para obter a lista completa de variáveis suportadas.

## Usando Rebase com Express

Aqui está um exemplo completo de como inicializar o adaptador PostgreSQL do Rebase e os WebSockets em tempo real dentro de uma aplicação Express padrão.

### 1. Instalar Dependências

Você precisará do pacote do servidor Postgres juntamente com o Express:

```bash
npm install @rebasepro/server-postgres @rebasepro/types express
```

### 2. Exemplo de Inicialização

```typescript
import express from 'express';
import { createServer } from 'http';
import { createPostgresBootstrapper } from '@rebasepro/server-postgres';

async function startServer() {
    const app = express();
    
    // 1. Você DEVE criar o servidor HTTP nativo do Node para que o servidor WebSocket possa se associar a ele
    const server = createServer(app);

    // 2. Inicialize o Postgres Bootstrapper diretamente
    const bootstrapper = createPostgresBootstrapper({
        connectionString: process.env.DATABASE_URL,
        // Opcional: defina qualquer esquema do Drizzle aqui se quiser relações/consultas tipadas
        // schema: { tables: { ... } } 
    });

    // 3. Inicialize o driver (conecta ao banco de dados, inicia os listeners de replicação lógica)
    const { driver, realtimeProvider } = await bootstrapper.initializeDriver({
        collections: [] // Passe suas coleções do Rebase aqui se estiver usando
    });

    // 4. Associe os WebSockets do Rebase ao seu servidor HTTP
    await bootstrapper.initializeWebsockets(
        server, 
        realtimeProvider, 
        driver
    );

    // --- Rotas Express ---
    app.use(express.json());

    app.get('/', (req, res) => {
        res.send('Servidor Express rodando com Rebase incorporado!');
    });

    // Você pode interagir diretamente com o driver do Rebase em qualquer lugar nas suas rotas Express
    app.post('/custom-data', async (req, res) => {
        try {
            // Use o driver de banco de dados nativo do Rebase
            const result = await driver.save({
                collection: 'products',
                entity: req.body
            });
            res.json({ success: true, data: result });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // 5. Inicie a escuta usando a instância do servidor nativa (NÃO app.listen)
    server.listen(3000, () => {
        console.log('Express e Rebase Realtime rodando na porta 3000');
    });
}

startServer();
```

## Principais Conceitos

### Servidor HTTP Nativo
Como os WebSockets exigem uma solicitação de `Upgrade` HTTP, você **deve** associar o Rebase à instância nativa do `http.Server` do Node.js. Se você apenas chamar `app.listen(3000)` no Express, não terá acesso ao objeto do servidor subjacente necessário para `initializeWebsockets()`.

### Ignorando o Hono
Ao invocar diretamente `createPostgresBootstrapper()` e chamar manualmente `initializeDriver()` e `initializeWebsockets()`, você está ignorando completamente o coordenador do Rebase (`initializeRebaseBackend`). Isso significa que nenhuma dependência do Hono é carregada, e as APIs REST geradas automaticamente, as rottes do Admin UI e os endpoints de autenticação não são montados.

Isso lhe dá controle total sobre sua API, enquanto continua aproveitando o poderoso motor de WebSockets de replicação lógica e o driver baseado no Drizzle do Rebase.
