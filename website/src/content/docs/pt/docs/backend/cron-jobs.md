---
sourceHash: d47ac3d32c961db1
title: Cron Jobs
sidebar_label: Cron Jobs
description: Agende tarefas em segundo plano recorrentes com o sistema integrado de cron jobs do Rebase. Defina jobs como arquivos TypeScript, monitore-os no Studio e gerencie-os por meio da API REST.
---

## Visão Geral

O Rebase inclui um **agendador de cron jobs integrado** para executar tarefas em segundo plano recorrentes — limpeza de dados, geração de relatórios, verificações de integridade (health checks), sincronizações com APIs externas e muito mais.

Os cron jobs seguem o mesmo padrão de **descoberta baseada em arquivos** das funções personalizadas: adicione um arquivo TypeScript no seu diretório `crons/`, e o Rebase o registra e agenda automaticamente.

- **Zero dependências** — Nenhuma biblioteca externa de agendamento necessária
- **Admin API** — Endpoints REST para listar, acionar, habilitar/desabilitar e visualizar logs
- **Painel do Studio** — Monitore todos os jobs, visualize o histórico de execuções e acione execuções manualmente
- **Persistência em banco de dados** — Logs de execução armazenados no PostgreSQL, sobrevivendo a reinicializações
- **Cache em memória** — Ring buffer rápido (últimas 50 execuções) para o painel, suportado pelo banco de dados

## Definindo um Cron Job

Crie um arquivo no seu diretório `backend/crons/` que exporte por padrão (default export) uma definição de cron. Use o helper `defineCron` de `@rebasepro/server` para inferência de tipos e autocompletar:

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

O `rebase dev` monitora o diretório de crons, portanto, um job adicionado enquanto ele está em execução é registrado na próxima recarga — sem reinicialização. (Ele precisa ser informado: o diretório é verificado em vez de importado, então o watcher não pode inferir isso.)

:::note
`defineCron` é uma função de identidade — ela retorna o mesmo objeto que você passa. Um objeto `CronJobDefinition` comum exportado por padrão funciona de forma idêntica; `defineCron` simplesmente fornece verificação de tipos em tempo de compilação e autocompletar no editor.
:::

O **nome do arquivo** (sem a extensão) se torna o ID exclusivo do job — por exemplo, `health-check`.


## Configuração

:::note[Onde isso fica]
**Runtime gerenciado** — coloque os arquivos em `backend/crons/`; o runtime descobre esse diretório por conta própria, e `entry.crons` no `rebase.json` só é necessário se você o moveu. `REBASE_CRON_SCHEDULER` no `.env` decide se *este* processo executa os temporizadores.

**Ejetado** — `cronsDir` em `initializeRebaseBackend({ … })`, como mostrado abaixo, ou `crons` com os jobs como valores.

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

É isso. O Rebase irá:

1. Varrer o diretório em busca de arquivos `.ts` / `.js`
2. Registrar cada exportação padrão como um cron job
3. Criar automaticamente as tabelas `rebase.cron_logs`, `rebase.cron_claims` e `rebase.cron_job_state` no PostgreSQL (se o driver tiver suporte a SQL)
4. Iniciar o agendador e preencher os contadores a partir dos logs existentes no banco de dados
5. Montar rotas REST de administração em `/api/admin/cron`

### Cron jobs como valores

`crons` recebe os jobs como um registro do ID do job para a definição, ao lado de `collections`. Um diretório é uma forma de construí-lo: `loadCrons(dir)` lê um diretório exatamente nesse formato.

```typescript
import path from "path";
import { defineCron, initializeRebaseBackend, loadCrons } from "@rebasepro/server";

const nightlyReport = defineCron({
    schedule: "0 3 * * *",
    async handler({ log }) {
        log("building the report");
    }
});

await initializeRebaseBackend({ app, server, crons: { "nightly-report": nightlyReport } });
// the same as cronsDir:
await initializeRebaseBackend({ app, server, crons: await loadCrons(path.resolve(__dirname, "../crons")) });
```

Forneça `crons` ou `cronsDir`, não ambos: a inicialização recusa a combinação. A construção do backend registra os jobs; o que inicia seus temporizadores é `start()`, que `initializeRebaseBackend` chama para você. Com [`createRebaseBackend`](/docs/backend/custom-server/), você mesmo o chama, no processo que deve executá-los. `loadCronJobsFromDirectory` e `loadCronJobsWithDiagnostics` ainda funcionam, estão obsoletos (deprecated) e emitem um aviso uma única vez.

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
| `0 3 * * *` | Diariamente às 3:00 |
| `0 0 * * 1` | Toda segunda-feira à meia-noite |
| `0 9 1 * *` | Primeiro dia de cada mês às 9:00 |
| `0,30 * * * *` | A cada 30 minutos (em :00 e :30) |
| `0 9-17 * * 1-5` | De hora em hora, das 9h às 17h, apenas em dias úteis |

Valores de passo (`*/n`), intervalos (`a-b`) e listas (`a,b,c`) são todos suportados.

Quando tanto o dia do mês quanto o dia da semana são restritos, um dia que corresponda a qualquer um deles é considerado correspondente, como no cron padrão: `0 9 1 * 1` é executado no 1º dia de cada mês e em todas as segundas-feiras. Quando qualquer um dos campos começa com `*`, o dia deve corresponder a ambos.

Um agendamento é comparado com o horário oficial (wall clock) de seu fuso horário. Em uma mudança de horário de verão, isso significa que um job com horário fixo dentro da hora repetida (`30 2 * * *` onde os relógios voltam às 03:00) é executado em ambas as passagens dessa hora, e um dentro da hora pulada, quando os relógios avançam, não é executado naquele dia.

## Referência de CronJobDefinition

```typescript
interface CronJobDefinition {
    // Cron schedule expression (5-field format)
    schedule: string;

    // IANA zone the schedule is read in, e.g. "Europe/Madrid". Without it the
    // schedule is read in the host's own zone — UTC in nearly every container,
    // yours on a laptop — so name it. An unknown zone is refused when the job
    // loads rather than read as local time.
    timezone?: string;

    // Human-readable name shown in Studio (default: the job id, the file's name)
    name?: string;

    // Optional description shown in Studio
    description?: string;

    // Whether the job runs (default: true). A pause or a resume from Studio
    // or the admin API overrides it, for every process, until reset.
    enabled?: boolean;

    // Max execution time in seconds (default: 300). Infinity means no
    // timeout; 0, a negative number or NaN is refused when the job loads.
    timeoutSeconds?: number;

    // How far back to look on startup for a slot that elapsed while no
    // instance was ticking (default: off). See "Cron across instances".
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

    // The slot this run fires for: a catch-up run gets the slot it
    // missed, a manual trigger the moment it started
    scheduledAt: Date;

    // Logger — lines appear in Studio, the logs API and the server log
    log: (...args: unknown[]) => void;

    // Aborted when the run exceeds `timeoutSeconds`, or when a shutdown's
    // wait for it runs out
    signal: AbortSignal;

    // The server-side Rebase singleton — the same object `import { rebase }
    // from "@rebasepro/server"` returns, and the same one `defineFunction`
    // hands its callback.
    rebase: RebaseServerClient;
}
```

Use `ctx.log()` para emitir saída estruturada. Essas linhas são capturadas no log de execução e ficam visíveis no Studio e por meio da API REST. Cada linha também é gravada no log do servidor no nível `info` com um campo `cron` contendo o ID do job, portanto ela aparece onde quer que a saída do seu contêiner seja coletada, incluindo os logs de depuração do Rebase Cloud. Essa cópia é redigida da mesma forma que as próprias linhas de log do servidor: os valores de chaves como `password` ou `apiKey`, e o SQL e parâmetros de uma consulta que falhou, são substituídos. O log de execução armazena a linha sem essa redação.

O log de execução mantém as primeiras 500 linhas de uma execução ou 64 KB delas, o que ocorrer primeiro, e depois uma linha informando quantas outras existiam: `… 9500 more lines not kept — see the server log`. O log do servidor recebe todas as linhas. Um job que registra uma linha por item processado deve esperar que seu histórico mostre o início da execução.

### `ctx.signal` — interrompa o trabalho quando a execução parar

O timeout encerra a *execução*: o agendador para de esperar e registra uma falha. Ele não encerra o handler. Passe `ctx.signal` para qualquer coisa que aceite um, e o trabalho é interrompido junto com ele:

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

Sem isso, um job cujo timeout coincide com seu intervalo vaza uma requisição abandonada por ciclo — de forma invisível, já que toda execução já foi registrada como falha.

:::note[`ctx.client` foi removido]
Era um segundo nome para `ctx.rebase`, e seu tipo reexpunha `client.data` — o alias que `RebaseServerClient` omite deliberadamente para que o plano privilegiado tenha exatamente um nome. Um leitor que aprendesse `client.data` aqui o levaria para um callback de collection, onde `context.data` é o plano com *escopo de usuário*: mesma grafia, privilégio oposto. Use `ctx.rebase.dataAsAdmin`.
:::

### Interagindo com o banco de dados e serviços via `ctx.rebase`

`ctx.rebase.dataAsAdmin` é o plano de dados com escopo de administrador. Um cron não possui um usuário por requisição, portanto não há alternativa com escopo de usuário aqui — defina o escopo dos filtros de cada consulta você mesmo.

:::caution[Escopo de admin não ignora RLS]
`dataAsAdmin` tem o escopo definido uma vez, na inicialização, como `{ uid: "service", roles: ["admin"] }`.
Cada leitura e escrita ainda é executada em uma transação que executou `SET LOCAL ROLE rebase_user` com `app.uid = 'service'`, e **suas políticas são avaliadas** — em relação a essa identidade. Ela passa pelas políticas padrão integradas por meio do branch `rolesOverlap(['admin'])`, e é por isso que a diferença raramente aparece. Ela se manifesta quando você escreve suas próprias regras: `policy.serverContext()` é compilado para `rebase.uid() IS NULL` e, portanto, é **falso** aqui; logo, uma collection com `disableDefaultPolicies: true` cuja única regra seja `serverContext()` negará essas escritas e retornará zero linhas — HTTP 200, vazio — para essas leituras.

`rebase.sql()` *é* uma evasão incondicional: conexão de proprietário (owner), sem políticas.
:::

```typescript
// backend/crons/expire-users.ts
import { defineCron } from "@rebasepro/server";

export default defineCron({
    schedule: "0 0 * * *", // Daily at midnight
    name: "Expire Inactive Accounts",
    
    async handler(ctx) {
        ctx.log("Checking for expired trial users...");

        // Fetch using the pre-initialized data driver. `table<Row>(slug)`
        // gives the query builder the row type — `where` keys are checked
        // against it. Every filter is an `[operator, value]` tuple; a bare
        // value is passed straight through and builds a malformed query.
        const users = ctx.rebase.dataAsAdmin.table<{
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
O handler pode retornar qualquer valor serializável em JSON. Ele será armazenado na entrada de log como `result` e exibido no histórico de execução do Studio.
:::

## API REST

A listagem, o acionamento, a pausa e a retomada de jobs via HTTP, bem como o `client.cron` do SDK tipado, estão na [Cron Jobs API](/docs/backend/cron-jobs-api/).

## Painel do Studio

Quando os cron jobs estão configurados, uma ferramenta **Cron Jobs** aparece no Rebase Studio sob **Compute**, ao lado do console JS. O painel oferece:

- **Lista de jobs** — Todos os jobs registrados com indicadores de status em tempo real
- **Painel de detalhes** — Agendamento, próxima/última execução, duração e informações de erro
- **Histórico de execução** — Entradas de log expansíveis com saída capturada e resultados
- **Acionamento manual** — Execute qualquer job sob demanda com um clique. O painel aguarda a conclusão da execução e informa como ela ocorreu: uma execução que falhou exibe seu erro
- **Habilitar/desabilitar** — Pause e retome jobs sem reiniciar o servidor, para todos os processos de uma só vez; uma pausa permanece ativa entre reinicializações e deploys
- **Jobs que não estão lá** — Cada job que o agendador recusou, com seu agendamento e o motivo, e quantos arquivos de cron falharam ao carregar. Nenhum deles é agendado; veja [Jobs que não estão lá](/docs/backend/cron-jobs-api/#jobs-that-are-not-there)

O painel é atualizado automaticamente a cada 15 segundos.

O painel mostra a mesma coisa, independentemente de qual processo o atende. Um job que outro processo esteja executando aparece como em execução.
Em todo processo que possui um store, a contagem de execuções, a contagem de falhas e a última execução são lidas do banco de dados, onde as execuções de todos os processos são contabilizadas. Os contadores próprios de um processo contêm apenas as execuções que ele mesmo realizou: a role `api` ao lado de um worker não executa nada e, entre duas réplicas que agendam tarefas, nenhuma vê os slots reivindicados pela outra. Somente quando o banco de dados não puder ser lido é que o card recorrerá aos contadores próprios deste processo, com um aviso no log do servidor.

As contagens são de todo o período (all-time); o histórico abrange os últimos 30 dias. A linha de cada execução em `rebase.cron_logs` é excluída 30 dias após seu início, por uma varredura horária, enquanto as contagens de execuções e de falhas continuam a contabilizá-la. Uma execução ignorada conta como uma execução, como sempre aconteceu: ela é uma linha do histórico.

## Validação de Agendamento e Análise de AST

Na inicialização do backend, o Rebase analisa todos os agendamentos de cron registrados usando um expansor de cron baseado em JS sem dependências:
- **Verificação de Sintaxe**: Verifica se a string contém exatamente 5 campos separados por espaços em branco (`minute`, `hour`, `day of month`, `month`, `day of week`).
- **Expansão de Intervalos**: Decompõe passos (`*/15`), intervalos (`9-17`) e listas separadas por vírgulas (`0,30`) em arrays explícitos de inteiros válidos mapeados para seus respectivos limites (por exemplo, minutos `0-59`, horas `0-23`, meses `1-12`).
- **Tokens Inteiros**: Todo número, limite de intervalo e passo deve ser um número inteiro: `5abc`, `*/5x` e `1.5` são recusados, assim como um intervalo em ordem decrescente (`5-1`).
- Se qualquer expressão cron falhar na validação, o Rebase rejeita a definição, registra um erro de inicialização e se recusa a registrar o job para evitar falhas de execução em tempo de execução.

---

## Por Baixo dos Panos: Correção de Desvio de Relógio (Clock-Drift)

Agendadores padrão baseados em intervalos (como `setInterval`) sofrem desvio ao longo do tempo e causam picos significativos de CPU devido a atrasos de agendamento do event loop no nível do sistema operacional. Para garantir a precisão da execução, o Rebase implementa um **loop dinâmico de cálculo de tempo-alvo**:
1. **Cálculo de Candidato**: Ao concluir um job ou iniciar o agendador, o Rebase calcula o timestamp exato do *próximo* minuto candidato correspondente.
2. **Espera Dinâmica**: Calcula a diferença em milissegundos (`nextRun.getTime() - now.getTime()`) e agenda um único `setTimeout`.
3. **Limite de Segurança contra Desvio**: Um buffer mínimo de espera (`MIN_SCHEDULE_INTERVAL_MS`) de **5.000 ms** é aplicado. Se um ciclo do agendador for concluído extremamente rápido, esse limite evita disparos duplos quase instantâneos.
4. **Compatibilidade com Desligamento (Shutdown)**: Os identificadores de temporizador são explicitamente desvinculados do event loop do Node.js usando `timer.unref()`, garantindo que os agendadores de cron em segundo plano não bloqueiem o encerramento limpo de processos durante deploys.

---

## Mais de um processo

Cada processo cujo agendador está ativo arma os mesmos temporizadores; o banco de dados decide qual deles executa cada slot. Como um slot é executado apenas uma vez, como um slot perdido por reinicialização é recuperado, como uma pausa chega a todas as réplicas e por que um acionamento manual nunca é executado lado a lado com uma execução agendada estão documentados em [Cron entre instâncias](/docs/backend/cron-across-instances).

---

## Timeouts e Isolamento de Erros

- **Disputa Forçada por Timeout**: Blocos de execução são encapsulados em um `Promise.race` contra um temporizador de timeout derivado de `timeoutSeconds` (padrão: `300` segundos / 5 minutos; `Infinity` para nenhum). Se o handler travar além desse limite, `ctx.signal` é abortado e a promise é rejeitada, lançando:
  `Error: Cron job "<id>" timed out after <N>ms`
  O aborto é a parte que interrompe o *trabalho*; a rejeição apenas faz o agendador parar de esperar. Um handler que ignora `ctx.signal` continuará em execução além de sua própria execução.
- **Encerramento (Shutdown)**: `backend.shutdown()` aguarda uma execução em andamento, dentro do mesmo limite de tempo (budget) da fila de jobs (dois terços do timeout de shutdown). Uma execução que ainda esteja ocorrendo quando esse tempo se esgotar tem o `ctx.signal` abortado e é registrada como com falha, com o motivo. Seu slot permanece reivindicado, garantindo que nenhuma outra instância o execute novamente.
- **Try/Catch à Prova de Falhas**: Cada handler de job é executado dentro de um wrapper isolado. Quaisquer exceções não capturadas são interceptadas, gravando a mensagem do erro (redigida) como uma string, definindo o status do job como `"error"` e atualizando o contador de falhas do job. Uma falha inesperada (crash) dentro de uma única tarefa cron nunca derrubará o loop do agendador ou o servidor web HTTP principal do Hono.
- **Ring Buffer em Memória**: O agendador mantém um buffer circular contendo as últimas **50 execuções** por job. Esse buffer é mantido na memória para permitir leituras quase instantâneas a partir do Rebase Studio.

---

## Esquema de Persistência no Banco de Dados

Quando adaptadores de banco de dados com suporte a SQL (por exemplo, PostgreSQL) estão ativos, o Rebase provisiona a tabela `rebase.cron_logs`:

```sql
CREATE SCHEMA IF NOT EXISTS rebase;

CREATE TABLE IF NOT EXISTS rebase.cron_logs (
    id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    job_id       TEXT NOT NULL,
    started_at   TIMESTAMPTZ NOT NULL,
    finished_at  TIMESTAMPTZ NOT NULL,
    duration_ms  INTEGER NOT NULL,
    success      BOOLEAN NOT NULL DEFAULT true,
    error        TEXT,                                 -- The error's message, redacted
    result       JSONB,                                -- Return value of handler
    logs         JSONB,                                -- Ring buffer array of ctx.log outputs
    manual       BOOLEAN NOT NULL DEFAULT false        -- True if triggered from Studio/REST
);

ALTER TABLE rebase.cron_logs ADD COLUMN IF NOT EXISTS counted BOOLEAN;  -- the run is in the counters below

CREATE INDEX IF NOT EXISTS idx_cron_logs_job ON rebase.cron_logs(job_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_cron_logs_started ON rebase.cron_logs(started_at);
CREATE INDEX IF NOT EXISTS idx_cron_logs_uncounted ON rebase.cron_logs(job_id, started_at DESC) WHERE counted IS NULL;

CREATE TABLE IF NOT EXISTS rebase.cron_job_state (
    job_id            TEXT PRIMARY KEY,
    enabled           BOOLEAN,       -- NULL: follow the job's own `enabled`
    updated_at        TIMESTAMPTZ,   -- when `enabled` was last set, and by whom
    updated_by        TEXT,
    running_until     TIMESTAMPTZ,   -- the run lease: live while in the future
    running_by        TEXT,
    total_runs        BIGINT NOT NULL DEFAULT 0,   -- all-time, skips included
    total_failures    BIGINT NOT NULL DEFAULT 0,
    last_run_at       TIMESTAMPTZ,                 -- the most recently started run
    last_duration_ms  INTEGER,
    last_success      BOOLEAN,
    last_error        TEXT
);
```

Cada uma é criada na inicialização se estiver ausente, de modo que um banco de dados anterior a ela a receba no próximo deploy. Nenhuma delas é uma collection, e a role de usuário final `rebase_user` não tem privilégios em nenhuma delas: uma `cron_job_state` com permissão de escrita permitiria que um usuário autenticado pausasse um job para todos, ou mantivesse sua concessão (lease) para que nada o executasse.

A linha de uma execução e sua contagem são gravadas em uma única instrução: o insert em `cron_logs` e um upsert dos contadores do job em `cron_job_state`. Uma listagem lê uma linha de `cron_job_state` por job, independentemente do tamanho do histórico, e o mesmo faz o agendador ao inicializar `totalRuns` e `totalFailures` na inicialização. As gravações de log não travam a execução; se uma falhar, o agendador registra o erro e continua, com a execução ainda preservada no ring buffer em memória.

Uma vez por hora e quando é iniciado, o agendador exclui as linhas de histórico com mais de 30 dias e contabiliza qualquer execução que ainda não tenha sido contada, ambos em lotes de 5.000 linhas. Um histórico gravado antes da versão 0.24 é contabilizado pela primeira dessas varreduras, fora do caminho crítico de inicialização. Até que ela termine, uma listagem adiciona as execuções ainda não contadas aos contadores, para que os números não sejam alterados na atualização. O mesmo se aplica a uma execução registrada por um servidor mais antigo durante um rolling deploy.

## Exemplo: Job de Limpeza Diária

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

## Crons no grafo de recursos

Cada arquivo de cron também é uma declaração. O comando `rebase resources` o lista sob o nome do arquivo — o mesmo ID com o qual o agendador o executa e o Studio o exibe — com seu agendamento e fuso horário, para que um host leia os agendamentos de um projeto antes de executar qualquer coisa. Um cron não se vincula a nenhuma variável de ambiente; o `rebase status` o mostra verde sem nada para configurar.

Ler o agendamento significa importar o arquivo, e `rebase resources` é uma etapa de build: sem `.env`, sem segredos. Portanto, mantenha o **escopo de módulo** de um cron livre de qualquer coisa que leia configurações na importação — um cliente de banco de dados instanciado no topo de um helper, um `env.ts` que valida `DATABASE_URL`. Em vez disso, importe esse trabalho dentro do handler:

```ts
async handler({ log }) {
    const { runSeed } = await import("../src/seed.js");
    await runSeed();
    log("done");
}
```

O handler é executado na implantação (deployment), onde essas variáveis existem. Uma importação de nível superior do mesmo módulo torna o grafo derivável apenas em uma máquina que por acaso tenha um `.env` — e carrega toda a dependência em cada inicialização que meramente registra o job.

Carregar um cron não declara nada. Uma etapa de build personalizada que queira incluir crons no grafo declara isso explicitamente com `declareCrons`:

```ts
import { declareCrons, loadCrons } from "@rebasepro/server";

declareCrons(await loadCrons("./crons", { onSkip: (problem) => console.warn(problem) }));
```

## Próximos Passos

- **[Visão Geral do Backend](/docs/backend)** — Referência completa de configuração do backend
- **[Hooks de tabela](/docs/collections/callbacks)** — Execute lógica em alterações de dados
- **[Integração com Webhooks](/docs/recipes/webhooks)** — Envie notificações em eventos
- **[Cron entre instâncias](/docs/backend/cron-across-instances)** — Uma execução por slot, slots perdidos, pausa global e execuções sobrepostas
