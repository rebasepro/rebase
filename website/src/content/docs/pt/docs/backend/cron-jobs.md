---
sourceHash: 82a8f59c5a0c5325
title: Cron Jobs
sidebar_label: Cron Jobs
description: Agende tarefas em segundo plano recorrentes com o sistema integrado de cron jobs do Rebase. Defina jobs como arquivos TypeScript, monitore-os no Studio e gerencie-os via REST API.
---

## Visão Geral

O Rebase inclui um **agendador de cron jobs integrado** para executar tarefas em segundo plano recorrentes — limpeza de dados, geração de relatórios, verificações de integridade (health checks), sincronizações com APIs externas e muito mais.

Os cron jobs seguem o mesmo padrão de **descoberta baseada em arquivos** das custom functions: adicione um arquivo TypeScript no diretório `crons/`, e o Rebase o registrará e agendará automaticamente.

- **Zero dependências** — Nenhuma biblioteca externa de agendamento necessária
- **Admin API** — Endpoints REST para listar, disparar, habilitar/desabilitar e visualizar logs
- **Painel do Studio** — Monitore todos os jobs, veja o histórico de execuções e dispare execuções manualmente
- **Persistência no banco de dados** — Logs de execução armazenados no PostgreSQL, sobrevivendo a reinicializações
- **Cache em memória** — Ring buffer rápido (últimas 50 execuções) para o painel, suportado pelo banco de dados

## Definindo um Cron Job

Crie um arquivo no seu diretório `backend/crons/` que faça a exportação padrão (`export default`) de uma definição de cron. Utilize o helper `defineCron` de `@rebasepro/server` para inferência de tipos e autocompletar:

```typescript
// backend/crons/health-check.ts
import { defineCron } from "@rebasepro/server";

export default defineCron({
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
});
```

O `rebase dev` observa o diretório de crons, portanto, um job adicionado enquanto ele está em execução é registrado na próxima recarga — sem necessidade de reinicialização. (Ele precisa ser informado: o diretório é escaneado em vez de importado, logo o observador não pode inferi-lo.)

:::note
`defineCron` é uma função de identidade — ela retorna exatamente o mesmo objeto que você passa para ela. Um objeto `CronJobDefinition` comum exportado por padrão funciona de forma idêntica; `defineCron` simplesmente fornece verificação de tipos em tempo de compilação e autocompletar no editor.
:::

O **nome do arquivo** (sem a extensão) torna-se o ID exclusivo do job — por exemplo, `health-check`.


## Configuração

:::note[Onde isso vai]
**Runtime gerenciado** — coloque os arquivos em `backend/crons/`; o runtime descobre esse diretório por conta própria, e `entry.crons` em `rebase.json` só é necessário se você o tiver movido. `REBASE_CRON_SCHEDULER` no `.env` define se *este* processo executará os timers.

**Ejetado** — `cronsDir` em `initializeRebaseBackend({ … })`, como mostrado abaixo.

O mapeamento completo está na [Visão Geral do Backend](/docs/backend/#where-each-option-lives).
:::

Habilite os cron jobs adicionando `cronsDir` à configuração do seu backend:

```typescript no-verify
const instance = await initializeRebaseBackend({
    // ... other config
    functionsDir: path.resolve(__dirname, "../functions"),
    cronsDir: path.resolve(__dirname, "../crons"),  // ← add this
});
```

Isso é tudo. O Rebase irá:

1. Escanear o diretório em busca de arquivos `.ts` / `.js`
2. Registrar cada exportação padrão como um cron job
3. Criar automaticamente a tabela `rebase.cron_logs` no PostgreSQL (se o driver suportar SQL)
4. Iniciar o agendador e preencher os contadores a partir dos logs existentes no banco de dados
5. Disponibilizar as rotas REST de administração em `/api/admin/cron`

## Sintaxe do Agendamento

As expressões Cron utilizam o **formato padrão de 5 campos**:

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
| `0 3 * * *` | Diariamente às 3:00 |
| `0 0 * * 1` | Toda segunda-feira à meia-noite |
| `0 9 1 * *` | Primeiro dia de cada mês às 9:00 |
| `0,30 * * * *` | A cada 30 minutos (nos minutos :00 e :30) |
| `0 9-17 * * 1-5` | A cada hora, das 9:00 às 17:00, apenas em dias úteis |

Valores de intervalo (`*/n`), faixas (`a-b`) e listas (`a,b,c`) são todos suportados.

## Referência de CronJobDefinition

`timezone` é novo — na versão 0.17.3, o agendamento é sempre interpretado no fuso horário do próprio host. Tudo o mais nesta interface já está disponível.

```typescript
interface CronJobDefinition {
    // Cron schedule expression (5-field format)
    schedule: string;

    // IANA zone the schedule is read in, e.g. "Europe/Madrid". Without it the
    // schedule is read in the host's own zone — UTC in nearly every container,
    // yours on a laptop — so name it. An unknown zone is refused when the job
    // loads rather than read as local time.
    timezone?: string;

    // Human-readable name shown in Studio
    name: string;

    // Optional description shown in Studio
    description?: string;

    // Whether the job starts enabled (default: true)
    enabled?: boolean;

    // Max execution time in seconds (default: 300)
    timeoutSeconds?: number;

    // How far back to look on startup for a slot that elapsed while no
    // instance was ticking (default: off). See "Recovering Missed Slots".
    catchUpWindowSeconds?: number;

    // The function to run on each tick
    handler: (ctx: CronJobContext) => Promise<unknown> | unknown;
}
```

## Contexto do Handler

Cada handler recebe um `CronJobContext` contendo métodos utilitários e a instância do Rebase Client:

```typescript no-verify
interface CronJobContext {
    // The job's unique ID (derived from filename)
    jobId: string;

    // The scheduled tick timestamp
    scheduledAt: Date;

    // Logger — captured lines appear in Studio and the logs API
    log: (...args: unknown[]) => void;

    // Aborted when the run exceeds `timeoutSeconds`
    signal: AbortSignal;

    // The server-side Rebase singleton — the same object `import { rebase }
    // from "@rebasepro/server"` returns, and the same one `defineFunction`
    // hands its callback.
    rebase: RebaseServerClient;
}
```

Use `ctx.log()` para gerar saídas estruturadas. Essas linhas são capturadas no log de execução e ficam visíveis no Studio e por meio da REST API.

### `ctx.signal` — interrompa o trabalho quando a execução parar

O timeout encerra a *execução*: o agendador para de esperar e registra uma falha. Ele não encerra o handler. Passe `ctx.signal` para qualquer chamada que o aceite, e o trabalho será interrompido junto com ele:

```typescript no-verify
export default defineCron({
    name: "Sync inventory",
    schedule: "*/15 * * * *",
    timeoutSeconds: 60,
    async handler({ signal, log }) {
        const res = await fetch("https://supplier.example.com/stock", { signal });
        log(`fetched ${res.status}`);
    }
});
```

Sem isso, um job cujo timeout coincida com seu intervalo deixa vazar uma requisição abandonada por tick — o que é invisível, já que cada execução já foi registrada como falha.

:::note[`ctx.client` foi removido]
Era um segundo nome para `ctx.rebase`, e seu tipo reexibia `client.data` — o alias que `RebaseServerClient` deliberadamente omite para que o plano privilegiado tenha exatamente um único nome. Um leitor que aprendesse `client.data` aqui levaria isso para um callback de collection, onde `context.data` é o plano com *escopo de usuário*: mesma grafia, privilégio oposto. Utilize `ctx.rebase.dataAsAdmin`.
:::

### Interagindo com o banco de dados e serviços via `ctx.rebase`

`ctx.rebase.dataAsAdmin` é o plano de dados com escopo administrativo. Um cron não possui um usuário por requisição, portanto não há alternativa com escopo de usuário aqui — você mesmo deve definir os filtros de cada consulta.

:::caution[Escopo de admin não ignora RLS]
`dataAsAdmin` é configurado uma vez, na inicialização, como `{ uid: "service", roles: ["admin"] }`. Cada leitura e escrita ainda é executada em uma transação que realizou `SET LOCAL ROLE rebase_user` com `app.uid = 'service'`, e **suas policies são avaliadas** — contra essa identidade. Ele passa pelas policies padrão integradas através da condição `rolesOverlap(['admin'])`, e é por isso que a diferença raramente é notada. Ela aparece quando você escreve as suas próprias: `policy.serverContext()` compila para `rebase.uid() IS NULL` e, portanto, é **falso** aqui. Assim, uma collection com `disableDefaultPolicies: true` cuja única regra seja `serverContext()` negará essas escritas e retornará zero linhas — HTTP 200, vazio — para essas leituras.

`rebase.sql()` *é* uma alternativa que ignora políticas incondicionalmente: conexão de proprietário (owner), sem policies.
:::

```typescript
// backend/crons/expire-users.ts
import { defineCron } from "@rebasepro/server";

export default defineCron({
    schedule: "0 0 * * *", // Daily at midnight
    name: "Expire Inactive Accounts",
    
    async handler(ctx) {
        ctx.log("Checking for expired trial users...");

        // Fetch using the pre-initialized data driver. `collection<Row>(slug)`
        // gives the query builder the row type — `where` keys are checked
        // against it. Every filter is an `[operator, value]` tuple; a bare
        // value is passed straight through and builds a malformed query.
        const users = ctx.rebase.dataAsAdmin.collection<{
            id: string;
            email: string;
            trial_status: string;
            trial_ends_at: string;
            status: string;
        }>("users");

        const { data: trials } = await users.find({
            where: {
                trial_status: ["==", "active"],
                trial_ends_at: ["<", new Date().toISOString()]
            }
        });

        ctx.log(`Found ${trials.length} users with expired trials.`);

        for (const user of trials) {
            await users.update(user.id, {
                trial_status: "expired",
                status: "disabled"
            });
            
            // Send email notification using the Rebase email service
            await ctx.rebase.email.send({
                to: user.email,
                subject: "Your trial has expired",
                html: "<p>Please upgrade your subscription to continue.</p>"
            });
        }
    }
});
```

:::tip
O handler pode retornar qualquer valor serializável em JSON. Ele será armazenado na entrada de log como `result` e exibido no histórico de execuções do Studio.
:::

## REST API

Todas as rotas de cron exigem **autenticação de administrador** (`requireAuth` + `requireAdmin`).

| Método | Caminho | Descrição |
|--------|------|-------------|
| `GET` | `/api/admin/cron` | Lista todos os cron jobs registrados |
| `GET` | `/api/admin/cron/:id` | Obtém o status de um job individual |
| `POST` | `/api/admin/cron/:id/trigger` | Dispara um job manualmente |
| `GET` | `/api/admin/cron/:id/logs` | Obtém o histórico de execução (`?limit=N`) |
| `PUT` | `/api/admin/cron/:id` | Habilita/desabilita um job (`{ "enabled": true }`) |

### Exemplo: Listar Todos os Jobs

`$TOKEN` é um token de acesso de administrador: faça login e use o `accessToken` retornado na resposta do login. `$API_URL` é a URL exibida pelo `rebase dev` — a porta é derivada do caminho do projeto, logo não há uma porta fixa.

```bash
curl -H "Authorization: Bearer $TOKEN" "$API_URL/api/admin/cron"
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

### Jobs Que Não Estão Lá

Um job que nunca é executado não aparece em `jobs` — nada o registrou —, então "meu cron está ausente" e "meu cron nunca executará" parecem idênticos a partir deste endpoint, a menos que ele indique o contrário. E ele indica:

```json
{
    "jobs": [],
    "skipped": 2,
    "rejected": [
        {
            "id": "nightly-report",
            "name": "Nightly report",
            "schedule": "0 0 3 * * *",
            "reason": "Expected 5 fields, got 6"
        }
    ],
    "note": "1 cron file(s) failed to load and 1 job(s) have an invalid schedule — NOT scheduled. See `rejected` for the reason; the server log has the rest."
}
```

`rejected` indica o nome do job e o motivo. Um arquivo que falhou ao ser *carregado* exibe apenas uma contagem: a falha ocorreu antes que houvesse um job para identificar, portanto o motivo está no log do servidor.

A ocorrência mais comum aqui é a mostrada acima — seis campos, originados de uma expressão copiada de uma ferramenta que aceita segundos. O Rebase aceita cinco; remova o primeiro campo.

### Exemplo: Disparar um Job Manualmente

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
    "$API_URL/api/admin/cron/health-check/trigger"
```

## SDK do Cliente

O SDK do cliente Rebase disponibiliza o namespace `cron` para todas as operações:

```typescript
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({ baseUrl: import.meta.env.VITE_API_URL });

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

Quando os cron jobs estão configurados, uma ferramenta **Cron Jobs** aparece no Rebase Studio sob **Compute**, ao lado do console JS. O painel disponibiliza:

- **Lista de jobs** — Todos os jobs registrados com indicadores de status em tempo real
- **Painel de detalhes** — Agendamento, próxima/última execução, duração e detalhes de erro
- **Histórico de execuções** — Entradas de log expansíveis com saídas e resultados capturados
- **Disparo manual** — Execute qualquer job sob demanda com um único clique
- **Habilitar/desabilitar** — Pause e retome jobs sem reiniciar o servidor

O painel é atualizado automaticamente a cada 15 segundos.

## Validação de Agendamento e Análise AST

Na inicialização do backend, o Rebase analisa todos os agendamentos de cron registrados usando um expansor de cron em JS com zero dependências:
- **Verificação de Sintaxe**: Garante que a string contenha exatamente 5 campos separados por espaços (`minuto`, `hora`, `dia do mês`, `mês`, `dia da semana`).
- **Expansão de Intervalos**: Decompõe passos (`*/15`), faixas (`9-17`) e listas separadas por vírgulas (`0,30`) em arrays explícitos de inteiros válidos mapeados para seus respectivos limites (ex.: minutos `0-59`, horas `0-23`, meses `1-12`).
- Se alguma expressão de cron falhar na validação, o Rebase rejeita a definição, grava um erro de inicialização no log e recusa registrar o job para evitar falhas durante o tempo de execução.

---

## Nos Bastidores: Correção de Desvio de Relógio (Clock-Drift)

Agendadores padrão baseados em intervalos (como `setInterval`) sofrem desvio ao longo do tempo e causam picos significativos de CPU devido a atrasos de agendamento no event loop do sistema operacional. Para garantir a precisão da execução, o Rebase implementa um **loop dinâmico de cálculo do tempo-alvo**:
1. **Cálculo do Candidato**: Ao concluir um job ou iniciar o agendador, o Rebase calcula o timestamp exato do *próximo* minuto candidato correspondente.
2. **Espera Dinâmica**: Ele calcula a diferença em milissegundos (`nextRun.getTime() - now.getTime()`) e agenda um único `setTimeout`.
3. **Limite de Segurança contra Desvio**: Um buffer mínimo de espera (`MIN_SCHEDULE_INTERVAL_MS`) de **5.000ms** é imposto. Se um tick do agendador for concluído com extrema rapidez, esse limite evita disparos duplos quase instantâneos.
4. **Encerramento Amigável**: Os timers são explicitamente desacoplados do event loop do Node.js usando `timer.unref()`, garantindo que agendadores de cron em segundo plano não bloqueiem o encerramento limpo de processos durante deploys.

---

## Recuperando Slots Perdidos

Como o agendador calcula o próximo slot a partir do momento atual (*now*) a cada inicialização, um slot só é executado se alguma instância estiver ativa e operando quando chegar a sua vez. Qualquer coisa que substitua o processo durante um slot — um deploy contínuo (rolling deploy), uma pane (crash), a reciclagem do container pela plataforma — descarta essa execução, e o substituto agendará o slot *seguinte*. Nenhum erro é emitido; a execução simplesmente nunca acontece.

Isso **não** é um problema exclusivo do scale-to-zero. Um serviço fixado em uma instância ativa (warm instance) ainda assim perde execuções, pois a plataforma tem a liberdade de desligar a instância que mantém o timer e iniciar uma nova.

Defina `catchUpWindowSeconds` com um intervalo confortavelmente maior do que o tempo de reinicialização, e a inicialização executará um slot que encontrar não reivindicado dentro desse intervalo:

```typescript
export default defineCron({
    schedule: "0 6 * * *",       // daily at 06:00
    name: "Scrape Listings",
    catchUpWindowSeconds: 3600,  // tolerate an hour of downtime around 06:00
    handler: async (ctx) => { /* … */ }
});
```

Três pontos importantes:

- **Desativado por padrão.** Sem `catchUpWindowSeconds`, o comportamento permanece inalterado.
- **Apenas o slot perdido mais recente é executado.** Iniciar após uma interrupção de seis horas compensará um job de frequência horária uma única vez, e não seis vezes. O catch-up impede que uma execução seja perdida; ele não recria o histórico.
- **É necessário um repositório capaz de registrar reivindicações (claims).** O catch-up reivindica o slot por meio da mesma chave `(job_id, slot)` que o fluxo agendado utiliza, que é o único elemento que distingue "este slot nunca foi executado" de "este slot já foi executado na instância que está sendo substituída". Sem um repositório conectado, o catch-up é ignorado e um aviso é registrado no log — caso contrário, uma instância reciclada a cada 30 minutos executaria novamente o mesmo job horário a cada inicialização.

No caso comum — uma reinicialização minutos após um slot ter sido executado normalmente —, o slot mais recente já foi reivindicado, de modo que o catch-up custa apenas uma verificação por job a cada inicialização e não realiza ação adicional.

Uma execução recuperada é uma entrada comum em `cron_logs` (`manual` é `false`), com uma primeira linha de log registrando o slot recuperado e o tempo de atraso:

```
⏰ Catch-up run for missed slot 2026-07-29T06:00:00.000Z (612s late)
```

---

## Proteção de Concorrência

Para garantir a estabilidade ao executar operações que demandam muitos recursos, o Rebase implementa um **bloqueio estrito de concorrência única** por ID de job:
- **Sobreposições Agendadas**: Se o tick agendado de um job disparar enquanto a execução anterior ainda estiver em andamento, o agendador ignora o tick e agenda imediatamente a próxima execução candidata.
- **Colisões por Disparo Manual**: Se um operador disparar manualmente um job em execução por meio do Rebase Studio ou da REST API, a requisição retorna imediatamente com uma carga indicando o descarte (skipped), protegendo o worker ativo.

Em ambos os casos, uma linha é gravada em `rebase.cron_logs`, de modo que a supressão fica registrada no histórico de execuções em vez de constar apenas no log do processo:

```json
{
  "jobId": "expire-users",
  "success": true,
  "result": { "skipped": true, "reason": "already_executing" },
  "logs": ["Skipped: the previous run has not finished"]
}
```

`success: true` porque nada falhou — `result.skipped` é o que indica a situação. Uma sequência consecutiva dessas ocorrências é o indício característico de um job que ultrapassou a capacidade do seu intervalo de agendamento, e esse é um padrão que você só pode identificar se os descartes forem devidamente registrados.

---

## Timeouts e Isolamento de Erros

- **Corrida de Timeout Forçada**: Os blocos de execução são encapsulados em um `Promise.race` contra um timer de timeout baseado em `timeoutSeconds` (padrão: `300` segundos / 5 minutos). Se o handler travar além desse limite, `ctx.signal` é abortado e a promise é rejeitada, disparando:
  `Error: Cron job "<id>" timed out after <N>ms`
  A ação de abortar é a parte que realmente interrompe o *trabalho*; a rejeição apenas faz o agendador parar de esperar. Um handler que ignora `ctx.signal` continua sendo executado além de sua própria execução.
- **Try/Catch com Proteção contra Falhas**: Cada handler de job roda dentro de um wrapper isolado. Quaisquer exceções não tratadas são interceptadas, formatando o rastreamento do erro (traceback) em uma string, alterando o status do job para `"error"` e atualizando os contadores de falhas em `rebase.cron_logs`. Uma pane dentro de uma tarefa de cron específica nunca derrubará o loop do agendador ou o servidor web HTTP Hono principal.
- **Ring Buffer em Memória**: O agendador mantém um ring buffer contendo as últimas **50 execuções** de cada job. Esse buffer permanece em memória para viabilizar leituras quase instantâneas a partir do Rebase Studio.

---

## Esquema de Persistência no Banco de Dados

Quando adaptadores de banco de dados compatíveis com SQL (por exemplo, PostgreSQL) estão ativos, o Rebase provisiona a tabela `rebase.cron_logs`:

```sql
CREATE SCHEMA IF NOT EXISTS rebase;

CREATE TABLE IF NOT EXISTS rebase.cron_logs (
    id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    job_id       TEXT NOT NULL,
    started_at   TIMESTAMPTZ NOT NULL,
    finished_at  TIMESTAMPTZ NOT NULL,
    duration_ms  INTEGER NOT NULL,
    success      BOOLEAN NOT NULL DEFAULT true,
    error        TEXT,                                 -- Stack trace or error message
    result       JSONB,                                -- Return value of handler
    logs         JSONB,                                -- Ring buffer array of ctx.log outputs
    manual       BOOLEAN NOT NULL DEFAULT false        -- True if triggered from Studio/REST
);

CREATE INDEX IF NOT EXISTS idx_cron_logs_job ON rebase.cron_logs(job_id, started_at DESC);
```

Na inicialização, o agendador lê as estatísticas dessa tabela por meio de consultas agregadas (`COUNT(*)`, `SUM(CASE WHEN success = false THEN 1 ELSE 0 END)`) para preencher o histórico de `totalRuns` e `totalFailures`. As inserções de log são executadas em um fluxo assíncrono não bloqueante; se a gravação no banco de dados falhar, o agendador registra o erro e continua a operação normal usando o ring buffer em memória como contingência.

## Exemplo: Job Diário de Limpeza

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

        // Admin-scoped data access — see `ctx.rebase` above.
        const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const expired = await ctx.rebase.dataAsAdmin.sessions.findAll({
            where: { last_seen_at: ["<", cutoff] }
        });
        for (const session of expired) {
            await ctx.rebase.dataAsAdmin.sessions.delete(session.id as string);
        }

        ctx.log(`Cleaned up ${expired.length} expired sessions`);

        return { deletedSessions: expired.length };
    },
};

export default job;
```

## Crons no Grafo de Recursos

Cada arquivo de cron é também uma declaração. O comando `rebase resources` o lista sob o nome do arquivo — o mesmo ID usado pelo agendador para executá-lo e exibido no Studio — junto com seu agendamento e fuso horário, permitindo que o host conheça os cronogramas de um projeto antes de executar qualquer rotina. Um cron não se vincula a nenhuma variável de ambiente; o `rebase status` o exibe em verde sem necessidade de configuração adicional.

Ler o agendamento requer importar o arquivo, e o `rebase resources` é uma etapa de build: sem `.env`, sem segredos. Portanto, mantenha o **escopo do módulo** de um cron livre de qualquer código que leia configurações no momento da importação — como um cliente de banco de dados instanciado no topo de um helper ou um `env.ts` que valida `DATABASE_URL`. Em vez disso, importe esse tipo de operação dentro do handler:

```ts
async handler({ log }) {
    const { runSeed } = await import("../src/seed.js");
    await runSeed();
    log("done");
}
```

O handler é executado na instância de implantação, onde essas variáveis de fato existem. Um import no nível raiz do mesmo módulo tornaria o grafo derivável apenas em uma máquina que por acaso possuísse um `.env` — além de carregar todas as dependências a cada inicialização que simplesmente registre o job.

## Próximos Passos

- **[Visão Geral do Backend](/docs/backend)** — Referência completa de configuração do backend
- **[Callbacks de Entidades](/docs/collections/callbacks)** — Execute lógicas baseadas em alterações de dados
- **[Integração com Webhooks](/docs/recipes/webhooks)** — Envie notificações a partir de eventos
