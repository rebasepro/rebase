---
title: Tarefas Cron
sidebar_label: Tarefas Cron
description: Agende tarefas em segundo plano recorrentes com o sistema de tarefas cron integrado do Rebase. Defina tarefas como arquivos TypeScript, monitore-as no Studio e gerencie-as via API REST.
---

## Visão Geral

Rebase inclui um **agendador de tarefas cron** integrado para executar tarefas em segundo plano recorrentes — limpeza de dados, geração de relatórios, verificações de integridade, sincronizações de API externas e muito mais.

As tarefas cron seguem o mesmo padrão de **descoberta baseada em arquivos** das funções personalizadas: coloque um arquivo TypeScript no seu diretório `crons/`, e o Rebase o registrará e agendará automaticamente.

- **Zero dependências** — Nenhuma biblioteca de agendador externa é necessária
- **API de Administração** — Endpoints REST para listar, acionar, habilitar/desabilitar e visualizar logs
- **Painel do Studio** — Monitore todas as tarefas, visualize o histórico de execução e acione execuções manualmente
- **Persistência em banco de dados** — Logs de execução armazenados no PostgreSQL, sobrevivendo a reinicializações
- **Cache em memória** — Buffer de anel rápido (últimas 50 execuções) para o painel, suportado pelo DB

## Definindo uma Tarefa Cron

Crie um arquivo no seu diretório `backend/crons/` que exporte por padrão uma `CronJobDefinition`:

```typescript
// backend/crons/health-check.ts
import type { CronJobDefinition } from "@rebasepro/types";

const job: CronJobDefinition = {
    schedule: "*/5 * * * *",     // every 5 minutes
    name: "System Health Check",
    description: "Monitors uptime and memory usage",

    async handler(ctx) {
        ctx.log("Running health check...");

        const uptime = process.uptime();
        const mem = process.memoryUsage();

        ctx.log(`Uptime: ${Math.round(uptime)}s`);
        ctx.log(`Heap: ${Math.round(mem.heapUsed / 1024 / 1024)}MB`);

        return {
            uptimeSeconds: Math.round(uptime),
            heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
        };
    },
};

export default job;
```

O **nome do arquivo** (sem extensão) torna-se o ID único da tarefa — por exemplo, `health-check`.

## Configuração

Habilite as tarefas cron adicionando `cronsDir` à sua configuração de backend:

```typescript no-verify
const instance = await initializeRebaseBackend({
    // ... other config
    functionsDir: path.resolve(__dirname, "../functions"),
    cronsDir: path.resolve(__dirname, "../crons"),  // ← add this
});
```

É isso. O Rebase irá:

1. Analisar o diretório em busca de arquivos `.ts` / `.js`
2. Registrar cada exportação padrão como uma tarefa cron
3. Criar automaticamente a tabela `rebase.cron_logs` no PostgreSQL (se o driver suportar SQL)
4. Iniciar o agendador e preencher contadores a partir de logs de DB existentes
5. Montar rotas REST de administração em `/api/cron`

## Sintaxe de Agendamento

As expressões cron usam o **formato padrão de 5 campos**:

```
┌───────────── minute (0–59)
│ ┌─────────── hour (0–23)
│ │ ┌───────── day of month (1–31)
│ │ │ ┌─────── month (1–12)
│ │ │ │ ┌───── day of week (0–6, Sunday = 0)
│ │ │ │ │
* * * * *
```

| Expressão | Significado |
|------------|---------|
| `* * * * *` | A cada minuto |
| `0 * * * *` | A cada hora |
| `0 3 * * *` | Diariamente às 3:00 AM |
| `0 0 * * 1` | Toda segunda-feira à meia-noite |
| `0 9 1 * *` | Primeiro dia de cada mês às 9:00 AM |
| `0,30 * * * *` | A cada 30 minutos (nos :00 e :30) |
| `0 9-17 * * 1-5` | De hora em hora, das 9 AM–5 PM, apenas em dias de semana |

Valores de passo (`*/n`), intervalos (`a-b`) e listas (`a,b,c`) são todos suportados.

## Referência de CronJobDefinition

```typescript
interface CronJobDefinition {
    // Cron schedule expression (5-field format)
    schedule: string;

    // Human-readable name shown in Studio
    name: string;

    // Optional description shown in Studio
    description?: string;

    // Whether the job starts enabled (default: true)
    enabled?: boolean;

    // Max execution time in seconds (default: 300)
    timeoutSeconds?: number;

    // The function to run on each tick
    handler: (ctx: CronJobContext) => Promise<unknown> | unknown;
}
```

## Contexto do Manipulador

Cada manipulador recebe um `CronJobContext`:

```typescript
interface CronJobContext {
    // The job's unique ID (derived from filename)
    jobId: string;

    // The scheduled tick timestamp
    scheduledAt: Date;

    // Logger — captured lines appear in Studio and the logs API
    log: (...args: unknown[]) => void;
}
```

Use `ctx.log()` para emitir saída estruturada. Essas linhas são capturadas no log de execução e visíveis no Studio e via API REST.

:::tip
O manipulador pode retornar qualquer valor JSON-serializável. Ele será armazenado na entrada do log como `result` e exibido no histórico de execução do Studio.
:::

## API REST

Todas as rotas cron exigem **autenticação de administrador** (`requireAuth` + `requireAdmin`).

| Método | Caminho | Descrição |
|--------|------|-------------|
| `GET` | `/api/cron` | Listar todas as tarefas cron registradas |
| `GET` | `/api/cron/:id` | Obter o status de uma única tarefa |
| `POST` | `/api/cron/:id/trigger` | Acionar uma tarefa manualmente |
| `GET` | `/api/cron/:id/logs` | Obter histórico de execução (`?limit=N`) |
| `PUT` | `/api/cron/:id` | Habilitar/desabilitar uma tarefa (`{ "enabled": true }`) |

### Exemplo: Listar Todas as Tarefas

```bash
curl -H "Authorization: Bearer $TOKEN" http://localhost:3001/api/cron
```

```json
{
    "jobs": [
        {
            "id": "health-check",
            "name": "System Health Check",
            "schedule": "*/5 * * * *",
            "enabled": true,
            "state": "idle",
            "totalRuns": 12,
            "totalFailures": 0,
            "lastRunAt": "2026-04-24T08:15:00.000Z",
            "nextRunAt": "2026-04-24T08:20:00.000Z",
            "lastDurationMs": 3
        }
    ]
}
```

### Exemplo: Acionar uma Tarefa Manualmente

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
    http://localhost:3001/api/cron/health-check/trigger
```

## SDK do Cliente

O SDK do cliente Rebase expõe um namespace `cron` para todas as operações:

```typescript
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({ baseUrl: "http://localhost:3001" });

// List all jobs
const { jobs } = await client.cron.listJobs();

// Get a single job
const { job } = await client.cron.getJob("health-check");

// Trigger manually
const { log, job: updated } = await client.cron.triggerJob("health-check");

// View execution history
const { logs } = await client.cron.getJobLogs("health-check", { limit: 10 });

// Enable or disable
await client.cron.toggleJob("health-check", false); // pause
await client.cron.toggleJob("health-check", true);  // resume
```

## Painel do Studio

Quando as tarefas cron são configuradas, uma ferramenta **Tarefas Cron** aparece no Rebase Studio sob a seção **Automação**. O painel oferece:

- **Lista de tarefas** — Todas as tarefas registradas com indicadores de status em tempo real
- **Painel de detalhes** — Agendamento, próxima/última execução, duração e informações de erro
- **Histórico de execução** — Entradas de log expansíveis com saída e resultados capturados
- **Acionamento manual** — Execute qualquer tarefa sob demanda com um clique
- **Habilitar/desabilitar** — Pause e retome tarefas sem reiniciar o servidor

O painel é atualizado automaticamente a cada 15 segundos.

## Persistência

Quando o driver do banco de dados suporta SQL (por exemplo, PostgreSQL), os logs de execução são **automaticamente persistidos** em uma tabela `rebase.cron_logs`. Isso significa:

- O histórico de execução **sobrevive a reinicializações** de servidor e implantações
- Os contadores `totalRuns` e `totalFailures` são **preenchidos a partir do banco de dados** na inicialização
- O endpoint `/api/cron/:id/logs` consulta o banco de dados, não apenas a memória
- Múltiplas instâncias de servidor compartilham o mesmo histórico de execução

A tabela é criada automaticamente na primeira inicialização — sem necessidade de migrações.

:::tip
A persistência não é bloqueante. Se uma gravação no banco de dados falhar, o agendador continua executando e o buffer de log em memória ainda está disponível como um fallback.
:::

## Tratamento de Erros e Timeouts

- Se um manipulador **lançar um erro**, o erro é capturado na entrada do log e o estado da tarefa é definido como `"error"`. O agendador continua executando — o próximo tick agendado ainda será disparado.
- Se um manipulador exceder `timeoutSeconds` (padrão: 300), ele é terminado com um erro de timeout.
- Todas as métricas de execução (contagem de sucesso, contagem de falhas, último erro) são rastreadas por tarefa e acessíveis via API.
- Gravações de persistência com falha são logadas, mas nunca travam o agendador.

## Exemplo: Tarefa de Limpeza Diária

```typescript
// backend/crons/cleanup-sessions.ts
import type { CronJobDefinition } from "@rebasepro/types";
import { rebase } from "@rebasepro/server";

const job: CronJobDefinition = {
    schedule: "0 3 * * *",  // daily at 3 AM
    name: "Cleanup Expired Sessions",
    description: "Removes user sessions older than 30 days",

    async handler(ctx) {
        ctx.log("Starting session cleanup...");

        // Use the rebase singleton for admin-level database access
        const count = Math.floor(Math.random() * 50); // placeholder

        ctx.log(`Cleaned up ${count} expired sessions`);

        return { deletedSessions: count };
    },
};

export default job;
```

## Próximos Passos

- **[Visão Geral do Backend](/docs/backend)** — Referência completa de configuração do backend
- **[Callbacks de Entidade](/docs/collections/callbacks)** — Execute lógica em mudanças de dados
- **[Integração de Webhook](/docs/recipes/webhooks)** — Envie notificações sobre eventos
---
