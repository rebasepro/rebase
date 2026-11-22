---
sourceHash: 571b6448756b487e
title: Tarefas Cron
sidebar_label: Tarefas Cron
description: Agende tarefas recorrentes em segundo plano com o sistema de cron jobs integrado do Rebase. Defina tarefas como arquivos TypeScript, monitore-as no Studio e gerencie-as por meio da API REST.
---

## Visão Geral

O Rebase inclui um **agendador de tarefas cron integrado** para executar tarefas recorrentes em segundo plano — limpeza de dados, geração de relatórios, verificações de integridade (health checks), sincronizações de APIs externas e muito mais.

Os cron jobs seguem o mesmo padrão de **descoberta baseada em arquivos** das funções personalizadas: adicione um arquivo TypeScript no seu diretório `crons/`, e o Rebase o registra e o agenda automaticamente.

- **Zero dependências** — Nenhuma biblioteca externa de agendamento é necessária
- **API de Administração** — Endpoints REST para listar, disparar, habilitar/desabilitar e visualizar logs
- **Painel do Studio** — Monitore todas as tarefas, visualize o histórico de execução e dispare execuções manualmente
- **Persistência em banco de dados** — Logs de execução armazenados no PostgreSQL, sobrevivendo a reinicializações
- **Cache em memória** — Ring buffer rápido (últimas 50 execuções) para o painel, sustentado pelo banco de dados

## Definindo uma Tarefa Cron

Crie um arquivo no seu diretório `backend/crons/` que faça a exportação padrão (default export) de uma definição de cron. Use o helper `defineCron` de `@rebasepro/server` para inferência de tipos e autocompletar:

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

O `rebase dev` monitora o diretório crons, portanto, uma tarefa adicionada enquanto ele estiver em execução será
registrada no próximo recarregamento — sem reinicialização. (Ele precisa ser avisado: o diretório é
escaneado em vez de importado, então o monitor não consegue inferi-lo.)

:::note
`defineCron` é uma função de identidade — ela retorna o mesmo objeto que você passa para ela. Um objeto `CronJobDefinition` padrão simples exportado como default funciona de forma idêntica; `defineCron` apenas fornece checagem de tipos em tempo de compilação e autocompletar no editor.
:::

O **nome do arquivo** (sem extensão) se torna o ID exclusivo da tarefa — por exemplo, `health-check`.


## Configuração

:::note[Onde isso vai]
**Runtime gerenciado** — coloque os arquivos em `backend/crons/`; o runtime descobre esse diretório por conta própria, e `entry.crons` no `rebase.json` só é necessário se você o moveu de lugar. `REBASE_CRON_SCHEDULER` no `.env` decide se *este* processo executa os timers.

**Ejetado** — `cronsDir` em `initializeRebaseBackend({ … })`, conforme abaixo, ou `crons` com as tarefas como valores.

O mapa completo está na [Visão Geral do Backend](/docs/backend/#where-each-option-lives).
:::

Habilite as tarefas cron adicionando `cronsDir` à configuração do seu backend:

```typescript no-verify
const instance = await initializeRebaseBackend({
    // ... other config
    functionsDir: path.resolve(__dirname, "../functions"),
    cronsDir: path.resolve(__dirname, "../crons"),  // ← add this
});
```

É só isso. O Rebase irá:

1. Escanear o diretório em busca de arquivos `.ts` / `.js`
2. Registrar cada exportação padrão como uma tarefa cron
3. Criar automaticamente as tabelas `rebase.cron_logs`, `rebase.cron_claims` e `rebase.cron_job_state` no PostgreSQL (se o driver suportar SQL)
4. Iniciar o agendador e preencher os contadores a partir dos logs existentes no banco de dados
5. Montar as rotas REST de administração em `/api/admin/cron`

### Tarefas cron como valores

`crons` recebe as tarefas como um registro do ID da tarefa para a definição, ao lado de `tables`. Um diretório é uma forma de criá-lo: `loadCrons(dir)` lê um diretório exatamente nesse formato.

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

Passe `crons` ou `cronsDir`, não ambos: a inicialização recusa o par. A construção do backend registra as tarefas; o que inicia seus timers é o `start()`, que o `initializeRebaseBackend` chama para você. Com [`createRebaseBackend`](/docs/backend/custom-server/) você mesmo o chama, no processo que deve executá-los. `loadCronJobsFromDirectory` e `loadCronJobsWithDiagnostics` ainda funcionam, estão obsoletos (deprecated) e emitem um aviso uma única vez.

## Sintaxe de Agendamento

Expressões cron usam o **formato padrão de 5 campos**:

```
┌───────────── minuto (0–59)
│ ┌─────────── hora (0–23)
│ │ ┌───────── dia do mês (1–31)
│ │ │ ┌─────── mês (1–12)
│ │ │ │ ┌───── dia da semana (0–6, Domingo = 0)
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
| `0,30 * * * *` | A cada 30 minutos (no minuto :00 e :30) |
| `0 9-17 * * 1-5` | De hora em hora, das 9:00 às 17:00, apenas em dias de semana |

Valores de passo (`*/n`), intervalos (`a-b`) e listas (`a,b,c`) são todos suportados.

Quando o dia do mês e o dia da semana são restritos, um dia que coincida com qualquer um deles é correspondido, como no cron padrão: `0 9 1 * 1` roda no primeiro dia de cada mês e em todas as segundas-feiras. Quando qualquer um dos campos começa com `*`, o dia deve coincidir com ambos.

Um agendamento é avaliado em relação ao relógio de parede de seu fuso horário. Em uma mudança de
horário de verão, isso significa que uma tarefa em horário fixo dentro da hora repetida
(`30 2 * * *` onde os relógios atrasam às 03:00) executa em ambas as passagens daquela hora,
e uma dentro da hora pulada, quando os relógios adiantam, não executa naquele
dia.

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

Use `ctx.log()` para emitir saídas estruturadas. Essas linhas são capturadas no log de execução e ficam visíveis no Studio e através da API REST. Cada linha também é gravada no log do servidor no nível `info` com um campo `cron` contendo o ID da tarefa, de modo que apareça onde a saída do seu container for coletada, incluindo os logs de depuração do Rebase Cloud. Essa cópia é redigida da mesma forma que as próprias linhas de log do servidor: os valores de chaves como `password` ou `apiKey`, e o SQL e parâmetros de uma consulta com falha, são substituídos. O log de execução armazena a linha sem essa censura.

O log de execução mantém as primeiras 500 linhas ou 64 KB de uma execução, o que ocorrer primeiro, e depois uma linha informando quantas outras existiram: `… 9500 more lines not kept — see the server log`. O log do servidor recebe todas as linhas. Uma tarefa que registra uma linha por item processado deve esperar que seu histórico mostre o início da execução.

### `ctx.signal` — interromper o trabalho quando a execução parar

O tempo limite encerra a *execução*: o agendador para de esperar e registra uma falha.
Ele não encerra o handler. Passe `ctx.signal` para qualquer coisa que aceite um, e
o trabalho será interrompido junto com ele:

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

Sem isso, uma tarefa cujo tempo limite coincide com o seu intervalo vaza uma requisição abandonada
a cada ciclo — invisível, porque cada execução já foi registrada como com falha.

:::note[`ctx.client` foi removido]
Era um segundo nome para `ctx.rebase`, e seu tipo reexibia `client.data` —
o alias `RebaseServerClient` omite isso deliberadamente para que o plano privilegiado
tenha exatamente um nome. Um leitor que aprendesse `client.data` aqui o levaria para um
hook de tabela, onde `context.data` é o plano com *escopo de usuário*: mesma
grafia, privilégio oposto. Use `ctx.rebase.dataAsAdmin`.
:::

### Interagindo com o banco de dados e serviços via `ctx.rebase`

`ctx.rebase.dataAsAdmin` é o plano de dados com escopo de administração. Uma tarefa cron não tem
usuário por requisição, então não há alternativa com escopo de usuário aqui — aplique o escopo
dos filtros de cada consulta você mesmo.

:::caution[Escopo de administrador não significa ignorar o RLS]
`dataAsAdmin` recebe escopo uma vez, na inicialização, como `{ uid: "service", roles: ["admin"] }`.
Cada leitura e gravação ainda é executada em uma transação que executou `SET LOCAL ROLE
rebase_user` com `app.uid = 'service'`, e **suas políticas são avaliadas** —
contra essa identidade. Ela passa pelas políticas padrão integradas por meio do
braço `rolesOverlap(['admin'])`, motivo pelo qual a diferença raramente aparece. Ela
aparece quando você escreve as suas próprias: `policy.serverContext()` compila para
`rebase.uid() IS NULL` e, portanto, é **falso** aqui, de modo que uma tabela com
`defaultPolicies: false` cuja única regra seja `serverContext()` negará essas
gravações e retornará zero linhas — HTTP 200, vazio — para essas leituras.

`rebase.sql()` *é* um bypass incondicional: conexão do proprietário, sem políticas.
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

Listar, acionar, pausar e retomar tarefas via HTTP, bem como o `client.cron` tipado do SDK, estão em [API de Tarefas Cron](/docs/backend/cron-jobs-api/).

## Painel do Studio

Quando tarefas cron estão configuradas, uma ferramenta de **Tarefas agendadas** aparece no Rebase Studio sob **Computação**, ao lado do console JS. O painel oferece:

- **Lista de tarefas** — Todas as tarefas registradas com indicadores de status em tempo real
- **Painel de detalhes** — Agendamento, próxima/última execução, duração e informações de erro
- **Histórico de execução** — Entradas de log expansíveis com saídas capturadas e resultados
- **Disparo manual** — Execute qualquer tarefa sob demanda com um clique. O painel aguarda a conclusão da execução e informa o resultado: uma execução que falhou exibe seu erro
- **Habilitar/desabilitar** — Pause e retome tarefas sem reiniciar o servidor, para todos os processos de uma vez; uma pausa permanece ativa entre reinicializações e deploys
- **Tarefas inexistentes** — cada tarefa que o agendador recusou, com seu agendamento e o motivo, e quantos arquivos de cron falharam ao carregar. Nenhuma delas é agendada; consulte [Tarefas inexistentes](/docs/backend/cron-jobs-api/#jobs-that-are-not-there)

O painel é atualizado automaticamente a cada 15 segundos.

O painel exibe a mesma informação independentemente de qual processo a esteja servindo. Uma tarefa que outro
processo está executando aparece como em execução.
Em todo processo que possui um store, a contagem de execuções, a contagem de falhas e a última execução são lidas do banco de dados, onde as execuções de cada processo são contabilizadas. Os contadores próprios de um processo mantêm apenas as execuções que ele próprio realizou: a role `api` ao lado de um worker não executa nada, e de duas réplicas que agendam, nenhuma vê os slots que a outra reivindicou. Apenas quando o banco de dados não puder ser lido o card recorre aos contadores locais deste processo, emitindo um aviso no log do servidor.

As contagens são históricas (de todos os tempos); o histórico refere-se aos últimos 30 dias. A linha de cada execução em `rebase.cron_logs` é excluída 30 dias após o seu início por uma varredura horária, enquanto as contagens de execução e de falhas continuam computando-a. Uma execução ignorada conta como uma execução, como sempre aconteceu: é uma linha do histórico.

## Validação de Agendamento e Análise AST

Na inicialização do backend, o Rebase analisa todos os agendamentos de cron registrados usando um expandidor de cron baseado em JS com zero dependências:
- **Verificação de Sintaxe**: Verifica se a string contém exatamente 5 campos separados por espaço em branco (`minuto`, `hora`, `dia do mês`, `mês`, `dia da semana`).
- **Expansão de Intervalos**: Desconstrói passos (`*/15`), intervalos (`9-17`) e listas separadas por vírgula (`0,30`) em arrays explícitos de inteiros válidos mapeados para seus respectivos limites (por exemplo, minutos `0-59`, horas `0-23`, meses `1-12`).
- **Tokens Inteiros**: Cada número, limite de intervalo e passo deve ser um número inteiro: `5abc`, `*/5x` e `1.5` são recusados, assim como um intervalo invertido (`5-1`).
- Se alguma expressão cron falhar na validação, o Rebase rejeita a definição, registra um erro de inicialização e se recusa a registrar a tarefa para evitar falhas de execução em tempo de execução.

---

## Por Baixo dos Panos: Correção de Desvio de Relógio (Clock-Drift)

Agendadores padrão baseados em intervalo (como `setInterval`) sofrem desvio ao longo do tempo e causam picos significativos de CPU devido a atrasos de agendamento no event loop do sistema operacional. Para garantir a precisão da execução, o Rebase implementa um **loop de cálculo dinâmico de tempo-alvo**:
1. **Cálculo de Candidato**: Ao concluir uma tarefa ou iniciar o agendador, o Rebase calcula o timestamp exato do *próximo* minuto candidato correspondente.
2. **Espera Dinâmica (Sleep)**: Ele calcula a diferença em milissegundos (`nextRun.getTime() - now.getTime()`) e agenda um único `setTimeout`.
3. **Limite Seguro contra Desvios**: Um buffer mínimo de espera (`MIN_SCHEDULE_INTERVAL_MS`) de **5.000ms** é imposto. Se um ciclo do agendador for concluído extremamente rápido, esse limite impede disparos duplos quase instantâneos.
4. **Encerramento Amigável**: Os identificadores de timer são explicitamente desvinculados do event loop do Node.js usando `timer.unref()`, garantindo que os agendadores de cron em segundo plano não bloqueiem encerramentos limpos de processos durante deploys.

---

## Mais de um processo

Cada processo cujo agendador está ativo arma os mesmos timers; o banco de dados decide
qual deles executa cada slot. Como um slot roda uma única vez, como um slot perdido por uma reinicialização
é recuperado, como uma pausa alcança todas as réplicas e por que um disparo manual nunca
roda ao lado de uma execução agendada estão em [Cron em várias instâncias](/docs/backend/cron-across-instances).

---

## Limites de Tempo e Isolamento de Erros

- **Disputa Forçada por Timeout**: Blocos de execução são encapsulados em um `Promise.race` contra um timer de tempo limite derivado de `timeoutSeconds` (padrão: `300` segundos / 5 minutos; `Infinity` para nenhum). Se o handler travar além desse limite, o `ctx.signal` é abortado e a promise é rejeitada, lançando:
  `Error: Cron job "<id>" timed out after <N>ms`
  A anulação é a metade que interrompe o *trabalho*; a rejeição apenas faz o agendador parar de esperar. Um handler que ignora `ctx.signal` continua executando além de sua própria execução.
- **Desligamento (Shutdown)**: `backend.shutdown()` aguarda uma execução em andamento, dentro do mesmo orçamento da fila de tarefas (dois terços do tempo limite de desligamento). Uma execução que ainda esteja rodando quando o tempo expira tem seu `ctx.signal` abortado e é registrada como falha, com o motivo. Seu slot continua reservado, portanto nenhuma outra instância irá reexecutá-lo.
- **Try/Catch à Prova de Falhas**: Cada handler de tarefa roda dentro de um invólucro isolado. Quaisquer exceções não capturadas são interceptadas, gravando a mensagem do erro (redigida) como uma string, definindo o status da tarefa para `"error"` e atualizando o contador de falhas da tarefa. Uma falha dentro de uma única tarefa cron nunca causará a queda do loop do agendador ou do servidor HTTP principal do Hono.
- **Ring Buffer em Memória**: O agendador mantém um ring buffer contendo as últimas **50 execuções** por tarefa. Esse buffer é mantido em memória para permitir leituras quase instantâneas a partir do Rebase Studio.

---

## Esquema de Persistência no Banco de Dados

Quando adaptadores de banco de dados que suportam SQL (por exemplo, PostgreSQL) estão ativos, o Rebase provisiona a tabela `rebase.cron_logs`:

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

Cada uma é criada na inicialização se estiver ausente, de modo que um banco de dados anterior à sua existência a
receba no próximo deploy. Nenhuma delas é uma tabela declarada, e o papel de usuário final
`rebase_user` não tem privilégios em nenhuma delas: um `cron_job_state` com permissão de escrita
permitiria que um usuário autenticado pausasse uma tarefa para todos, ou segurasse seu lease para que nada
a executasse.

A linha de uma execução e sua contagem são gravadas em uma única instrução: o insert em `cron_logs` e um upsert dos contadores da tarefa em `cron_job_state`. Uma listagem lê uma linha de `cron_job_state` por tarefa, independentemente do tamanho do histórico, e o mesmo faz o agendador ao inicializar `totalRuns` e `totalFailures` na partida. Gravações de logs não atrasam a execução; se uma falhar, o agendador registra o erro e continua, mantendo a execução no ring buffer em memória.

Uma vez por hora, e quando inicializa, o agendador exclui as linhas de histórico com mais de 30 dias e contabiliza qualquer execução que ainda não tenha sido contada, ambas as ações em lotes de 5.000 linhas. Um histórico gravado antes da versão 0.24 é contabilizado pela primeira dessas varreduras, fora do caminho crítico de inicialização. Até que ela termine, uma listagem adiciona as execuções ainda não computadas aos contadores, de modo que os números não se alterem na atualização. O mesmo vale para uma execução que um servidor mais antigo registre durante um deploy contínuo (rolling deploy).

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

## Tarefas Cron no Grafo de Recursos

Cada arquivo de cron é também uma declaração. O comando `rebase resources` o lista sob o
nome do arquivo — o mesmo ID com o qual o agendador o executa e o Studio exibe —
com seu agendamento e fuso horário, para que um host leia os agendamentos de um projeto antes
de executar qualquer coisa. Um cron não se vincula a nenhuma variável de ambiente; `rebase status`
o mostra verde sem nada a ser configurado.

Ler o agendamento significa importar o arquivo, e `rebase resources` é uma etapa de
build: sem `.env`, sem segredos. Portanto, mantenha o **escopo de módulo** de um cron livre de qualquer coisa
que leia configurações na importação — um cliente de banco de dados construído no topo de um
helper, um `env.ts` que valide `DATABASE_URL`. Em vez disso, importe esse trabalho dentro do
handler:

```ts
async handler({ log }) {
    const { runSeed } = await import("../src/seed.js");
    await runSeed();
    log("done");
}
```

O handler é executado na implantação, onde essas variáveis existem. Uma importação
de nível superior (top-level) do mesmo módulo torna o grafo derivável apenas em uma máquina que
por acaso possua um `.env` — e carrega toda a dependência em cada inicialização
que apenas registra a tarefa.

Carregar um cron
não declara nada. Um passo de build personalizado seu que queira crons no grafo informa
isso usando `declareCrons`:

```ts
import { declareCrons, loadCrons } from "@rebasepro/server";

declareCrons(await loadCrons("./crons", { onSkip: (problem) => console.warn(problem) }));
```

## Próximos Passos

- **[Visão Geral do Backend](/docs/backend)** — Referência completa de configuração do backend
- **[Hooks de tabela](/docs/collections/callbacks)** — Execute lógica em alterações de dados
- **[Integração com Webhooks](/docs/recipes/webhooks)** — Envie notificações em eventos
- **[Cron em várias instâncias](/docs/backend/cron-across-instances)** — Uma execução por slot, slots perdidos, pausando em todos os lugares e execuções concorrentes
