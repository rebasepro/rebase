---
sourceHash: dc15b1a8aff0e700
title: Cron Jobs
sidebar_label: Cron Jobs
description: Agende tarefas recorrentes em segundo plano com o sistema de cron jobs integrado do Rebase. Defina jobs como arquivos TypeScript, monitore-os no Studio e gerencie-os por meio da API REST.
---

## Visão Geral

O Rebase inclui um **agendador de cron jobs** integrado para executar tarefas recorrentes em segundo plano — limpeza de dados, geração de relatórios, verificações de integridade (health checks), sincronizações com APIs externas e muito mais.

Os cron jobs seguem o mesmo padrão de **descoberta baseada em arquivos** das funções personalizadas: adicione um arquivo TypeScript no seu diretório `crons/`, e o Rebase o registra e agenda automaticamente.

- **Zero dependências** — Nenhuma biblioteca externa de agendamento é necessária
- **API de administração** — Endpoints REST para listar, acionar, habilitar/desabilitar e visualizar logs
- **Painel do Studio** — Monitore todos os jobs, visualize o histórico de execução e acione execuções manualmente
- **Persistência em banco de dados** — Logs de execução armazenados no PostgreSQL, sobrevivendo a reinicializações
- **Cache em memória** — Ring buffer rápido (últimas 50 execuções) para o painel, apoiado pelo banco de dados

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

O `rebase dev` monitora o diretório de crons, portanto, um job adicionado enquanto ele está em execução é registrado na próxima recarga — sem reinicialização. (Ele precisa ser informado: o diretório é escaneado em vez de importado, de modo que o monitor não consegue inferi-lo.)

:::note
`defineCron` é uma função de identidade — ela retorna o mesmo objeto que você passa. Um objeto `CronJobDefinition` comum exportado por padrão funciona de forma idêntica; `defineCron` simplesmente fornece verificação de tipos em tempo de compilação e autocompletar no editor.
:::

O **nome do arquivo** (sem extensão) se torna o ID exclusivo do job — por exemplo, `health-check`.


## Configuração

:::note[Onde isso vai]
**Runtime gerenciado** — coloque os arquivos em `backend/crons/`; o runtime descobre esse diretório por conta própria, e `entry.crons` em `rebase.json` só é necessário se você o tiver movido. `REBASE_CRON_SCHEDULER` no `.env` decide se *este* processo executa os temporizadores.

**Ejetado** — `cronsDir` em `initializeRebaseBackend({ … })`, conforme abaixo, ou `crons` com os jobs como valores.

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

1. Escanear o diretório em busca de arquivos `.ts` / `.js`
2. Registrar cada exportação padrão como um cron job
3. Criar automaticamente as tabelas `rebase.cron_logs`, `rebase.cron_claims` e `rebase.cron_job_state` no PostgreSQL (se o driver suportar SQL)
4. Iniciar o agendador e preencher os contadores a partir dos logs existentes no banco de dados
5. Montar rotas REST de administração em `/api/admin/cron`

### Cron jobs como valores

`crons` recebe os jobs como um record do ID do job para a definição, ao lado de `tables`. Um diretório é uma forma de construí-lo: `loadCrons(dir)` lê um diretório exatamente nesse formato.

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

Informe `crons` ou `cronsDir`, não ambos: a inicialização recusa o par. Construir o backend registra os jobs; o que inicia seus temporizadores é `start()`, que `initializeRebaseBackend` chama para você. Com [`createRebaseBackend`](/docs/backend/custom-server/), você mesmo o chama no processo que deve executá-los. `loadCronJobsFromDirectory` e `loadCronJobsWithDiagnostics` ainda funcionam, estão obsoletos (deprecated) e exibem um aviso uma única vez.

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
| `0,30 * * * *` | A cada 30 minutos (nos minutos :00 e :30) |
| `0 9-17 * * 1-5` | De hora em hora, das 9h às 17h, somente em dias úteis |

Valores de passo (`*/n`), intervalos (`a-b`) e listas (`a,b,c`) são todos suportados.

Quando tanto o dia do mês quanto o dia da semana são restritos, um dia que coincida com qualquer um deles é correspondido, como no cron padrão: `0 9 1 * 1` é executado no dia 1º de cada mês e em todas as segundas-feiras. Quando qualquer um dos campos começa com `*`, o dia precisa corresponder a ambos.

Um agendamento é avaliado em relação ao relógio de parede (wall clock) de seu fuso horário. Durante uma mudança de horário de verão, isso significa que um job com horário fixo dentro da hora repetida (`30 2 * * *` onde os relógios atrasam às 03:00) é executado em ambas as passagens dessa hora, e um dentro da hora pulada, quando os relógios adiantam, não é executado naquele dia.

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

Cada handler recebe um `CronJobContext` contendo métodos utilitários e a instância do Rebase Server Client:

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

Use `ctx.log()` para emitir saídas estruturadas. Essas linhas são capturadas no log de execução e visíveis no Studio e por meio da API REST. Cada linha também é gravada no log do servidor no nível `info` com um campo `cron` contendo o ID do job, para que apareça onde quer que a saída do seu contêiner seja coletada, incluindo os logs de depuração do Rebase Cloud. Essa cópia é ofuscada (redacted) da mesma forma que as linhas de log do próprio servidor: os valores de chaves como `password` ou `apiKey`, bem como o SQL e parâmetros de uma consulta com falha, são substituídos. O log de execução armazena a linha sem essa ofuscação.

O log de execução mantém as primeiras 500 linhas de uma execução ou 64 KB delas, o que ocorrer primeiro, e depois inclui uma linha informando quantas outras existiam: `… 9500 more lines not kept — see the server log`. O log do servidor recebe todas as linhas. Um job que registra uma linha por item processado deve esperar que seu histórico mostre apenas o início da execução.

### `ctx.signal` — interrompa o trabalho quando a execução parar

O timeout encerra a *execução*: o agendador para de esperar e registra uma falha. Ele não encerra o handler. Passe `ctx.signal` para qualquer operação que aceite um sinal de cancelamento, e o trabalho será interrompido junto com ele:

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

Sem isso, um job cujo timeout coincide com seu intervalo vaza uma requisição abandonada por tick — de forma invisível, já que toda execução já foi registrada como falha.

:::note[`ctx.client` foi removido]
Era um segundo nome para `ctx.rebase`, e seu tipo reexpunha `client.data` — o alias que `RebaseServerClient` omite deliberadamente para que o plano privilegiado tenha exatamente um único nome. Um desenvolvedor que aprendesse `client.data` aqui o levaria para um hook de tabela, onde `context.data` é o plano com *escopo de usuário*: mesma grafia, privilégio oposto. Use `ctx.rebase.dataAsAdmin`.
:::

### Interagindo com o banco de dados e serviços via `ctx.rebase`

`ctx.rebase.dataAsAdmin` é o plano de dados com escopo de administrador. Um cron não possui um usuário por requisição, portanto não há alternativa com escopo de usuário aqui — defina o escopo dos filtros de cada consulta você mesmo.

:::caution[Escopo de administrador não ignora o RLS]
`dataAsAdmin` é delimitado uma vez, na inicialização, como `{ uid: "service", roles: ["admin"] }`. Cada leitura e escrita ainda é executada em uma transação que realizou `SET LOCAL ROLE rebase_user` com `app.uid = 'service'`, e **suas políticas são avaliadas** — em relação a essa identidade. Ela passa pelas políticas padrão integradas por meio de seu braço `rolesOverlap(['admin'])`, razão pela qual a diferença raramente se manifesta. Ela se manifesta quando você escreve suas próprias regras: `policy.serverContext()` é compilado para `rebase.uid() IS NULL` e, portanto, é **false** aqui, de modo que uma tabela com `disableDefaultPolicies: true` cuja única regra seja `serverContext()` negará essas escritas e retornará zero linhas — HTTP 200, vazio — para essas leituras.

`rebase.sql()` *é* um bypass incondicional: conexão do proprietário (owner), sem políticas.
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

A listagem, o acionamento, a pausa e a retomada de jobs via HTTP, bem como o `client.cron` do SDK tipado, estão documentados na [API de Cron Jobs](/docs/backend/cron-jobs-api/).

## Painel do Studio

Quando os cron jobs estão configurados, uma ferramenta **Cron Jobs** aparece no Rebase Studio sob **Compute**, ao lado do console JS. O painel oferece:

- **Lista de jobs** — Todos os jobs registrados com indicadores de status em tempo real
- **Painel de detalhes** — Agendamento, próxima/última execução, duração e informações de erro
- **Histórico de execução** — Entradas de log expansíveis com saídas e resultados capturados
- **Acionamento manual** — Execute qualquer job sob demanda com um clique. O painel aguarda a conclusão da execução e informa como ela ocorreu: uma execução com falha exibe seu erro
- **Habilitar/desabilitar** — Pause e retome jobs sem reiniciar o servidor, para todos os processos de uma vez; uma pausa permanece ativa entre reinicializações e deploys
- **Jobs que não estão presentes** — cada job recusado pelo agendador, com seu agendamento e o motivo, e quantos arquivos de cron falharam ao carregar. Nenhum deles é agendado; consulte [Jobs que não estão presentes](/docs/backend/cron-jobs-api/#jobs-that-are-not-there)

O painel é atualizado automaticamente a cada 15 segundos.

O painel exibe as mesmas informações independentemente de qual processo o atenda. Um job executado por outro processo é exibido como em execução.
Em todo processo que possui um store, a contagem de execuções, a contagem de falhas e a última execução são lidas do banco de dados, onde as execuções de todos os processos são contabilizadas. Os contadores próprios de um processo registram apenas as execuções que ele próprio realizou: a role `api` ao lado de um worker não executa nada e, entre duas réplicas que agendam tarefas, nenhuma vê os slots que a outra reivindicou. Somente quando o banco de dados não puder ser lido o card recorrerá aos contadores locais deste processo, exibindo um aviso no log do servidor.

As contagens abrangem todo o período histórico; o histórico corresponde aos últimos 30 dias. A linha de cada execução em `rebase.cron_logs` é excluída 30 dias após seu início, por meio de uma varredura horária, enquanto as contagens de execuções e falhas continuam a contabilizá-la. Uma execução ignorada conta como uma execução, como sempre aconteceu: ela é uma linha no histórico.

## Validação de Agendamento e Análise de AST

Na inicialização do backend, o Rebase analisa todas as programações de cron registradas usando um expansor de cron baseado em JS sem dependências:
- **Verificação de sintaxe**: Verifica se a string contém exatamente 5 campos separados por espaço em branco (`minute`, `hour`, `day of month`, `month`, `day of week`).
- **Expansão de intervalos**: Decompõe passos (`*/15`), intervalos (`9-17`) e listas separadas por vírgula (`0,30`) em arrays explícitos de inteiros válidos mapeados para seus respectivos limites (por exemplo, minutos `0-59`, horas `0-23`, meses `1-12`).
- **Tokens inteiros**: Todo número, limite de intervalo e passo deve ser um número inteiro: `5abc`, `*/5x` e `1.5` são recusados, assim como um intervalo invertido (`5-1`).
- Se qualquer expressão cron falhar na validação, o Rebase rejeita a definição, registra um erro de inicialização e se recusa a registrar o job para evitar falhas de execução em tempo de execução.

---

## Sob o Capô: Correção de Desvio de Relógio (Clock-Drift)

Agendadores padrão baseados em intervalos (como `setInterval`) sofrem desvios com o tempo e causam picos significativos de CPU devido a atrasos de agendamento no event loop no nível do sistema operacional. Para garantir a precisão da execução, o Rebase implementa um **loop dinâmico de cálculo de tempo-alvo**:
1. **Cálculo de candidato**: Ao concluir um job ou iniciar o agendador, o Rebase calcula o timestamp exato do *próximo* minuto candidato correspondente.
2. **Espera dinâmica**: Ele calcula a diferença em milissegundos (`nextRun.getTime() - now.getTime()`) e agenda um único `setTimeout`.
3. **Limite de segurança contra desvio**: Um buffer de espera mínimo (`MIN_SCHEDULE_INTERVAL_MS`) de **5.000ms** é aplicado. Se um tick do agendador for concluído com extrema rapidez, esse limite evita disparos duplos quase instantâneos.
4. **Amigável ao encerramento**: Os identificadores de temporizadores são desvinculados explicitamente do event loop do Node.js usando `timer.unref()`, garantindo que os agendadores de cron em segundo plano não bloqueiem o encerramento limpo do processo durante os deploys.

---

## Mais de um processo

Cada processo cujo agendador está ativo arma os mesmos temporizadores; o banco de dados decide qual deles executa cada slot. Como um slot é executado apenas uma vez, como um slot perdido por uma reinicialização é recuperado, como uma pausa chega a todas as réplicas e por que um acionamento manual nunca é executado em paralelo com uma execução agendada estão documentados em [Cron entre instâncias](/docs/backend/cron-across-instances).

---

## Timeouts e Isolamento de Erros

- **Disputa forçada de timeout**: Blocos de execução são envolvidos em uma `Promise.race` contra um temporizador de timeout derivado de `timeoutSeconds` (padrão: `300` segundos / 5 minutos; `Infinity` para nenhum). Se o handler travar além desse limite, `ctx.signal` é abortado e a promise é rejeitada, lançando:
  `Error: Cron job "<id>" timed out after <N>ms`
  O aborto é a parte que interrompe o *trabalho*; a rejeição apenas impede o agendador de continuar esperando. Um handler que ignora `ctx.signal` continua executando além do término da sua execução.
- **Encerramento (Shutdown)**: `backend.shutdown()` aguarda uma execução em andamento dentro do mesmo limite de tempo da fila de jobs (dois terços do timeout de desligamento). Uma execução ainda em andamento quando esse tempo expirar terá seu `ctx.signal` abortado e será registrada como falha, acompanhada do motivo. Seu slot permanece reivindicado, garantindo que nenhuma outra instância o execute novamente.
- **Try/Catch à prova de falhas**: Cada handler de job é executado dentro de um wrapper isolado. Quaisquer exceções não capturadas são interceptadas, gravando a mensagem do erro (ofuscada) como string, definindo o status do job como `"error"` e atualizando o contador de falhas do job. Uma falha inesperada dentro de uma única tarefa cron nunca derrubará o loop do agendador ou o servidor web HTTP Hono principal.
- **Ring Buffer em memória**: O agendador mantém um ring buffer contendo as últimas **50 execuções** por job. Esse buffer é mantido na memória para permitir leituras quase instantâneas a partir do Rebase Studio.

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

Cada uma é criada na inicialização se estiver ausente, portanto, um banco de dados anterior a ela a receberá no próximo deploy. Nenhuma delas é uma tabela declarada, e a role de usuário final `rebase_user` não possui privilégios sobre nenhuma delas: uma `cron_job_state` com permissão de escrita permitiria que um usuário autenticado pausasse um job para todos, ou retivesse seu lease para que nada o executasse.

A linha de uma execução e sua contagem são gravadas em uma única instrução: a inserção em `cron_logs` e um upsert dos contadores do job em `cron_job_state`. Uma listagem lê uma linha de `cron_job_state` por job, independentemente da extensão do histórico, assim como o agendador faz ao preencher `totalRuns` e `totalFailures` na inicialização. As gravações de log não travam a execução; se uma falhar, o agendador registra o erro e prossegue, mantendo a execução no ring buffer em memória.

Uma vez por hora, e ao iniciar, o agendador exclui as linhas do histórico com mais de 30 dias e contabiliza qualquer execução que ainda não tenha sido contada, ambos em lotes de 5.000 linhas. Um histórico gravado antes da versão 0.24 é contabilizado pela primeira dessas varreduras, fora do caminho crítico de boot. Até que ela termine, a listagem adiciona as execuções ainda não contabilizadas aos contadores, para que os números não mudem durante uma atualização. O mesmo se aplica a uma execução registrada por um servidor mais antigo durante um rolling deploy.

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

Cada arquivo de cron também é uma declaração. O comando `rebase resources` o lista sob o nome do arquivo — o mesmo ID usado pelo agendador para executá-lo e exibido no Studio — com sua programação e fuso horário, de modo que o host leia as programações de um projeto antes de executar qualquer coisa. Um cron não se vincula a nenhuma variável de ambiente; o comando `rebase status` o exibe em verde, sem nada para configurar.

Ler a programação significa importar o arquivo, e `rebase resources` é uma etapa de build: sem `.env`, sem secrets. Portanto, mantenha o **escopo do módulo** de um cron livre de qualquer elemento que leia configurações durante a importação — como um cliente de banco de dados instanciado no topo de um arquivo utilitário ou um `env.ts` que valide `DATABASE_URL`. Em vez disso, importe esse trabalho dentro do handler:

```ts
async handler({ log }) {
    const { runSeed } = await import("../src/seed.js");
    await runSeed();
    log("done");
}
```

O handler é executado no ambiente de implantação, onde essas variáveis existem. Uma importação no nível superior do mesmo módulo tornaria o grafo derivável apenas em uma máquina que por acaso possuísse um `.env` — além de carregar toda a dependência em cada inicialização que apenas registra o job.

Carregar um cron não declara nada. Uma etapa de build própria que precise dos crons no grafo declara isso explicitamente com `declareCrons`:

```ts
import { declareCrons, loadCrons } from "@rebasepro/server";

declareCrons(await loadCrons("./crons", { onSkip: (problem) => console.warn(problem) }));
```

## Próximos Passos

- **[Visão Geral do Backend](/docs/backend)** — Referência completa de configuração do backend
- **[Hooks de tabela](/docs/collections/callbacks)** — Execute lógica em alterações de dados
- **[Integração com Webhooks](/docs/recipes/webhooks)** — Envie notificações em eventos
- **[Cron entre instâncias](/docs/backend/cron-across-instances)** — Uma execução por slot, slots perdidos, pausar em todos os lugares e execuções concorrentes
