---
sourceHash: 3e450f0960514c50
title: "API de Cron Jobs"
sidebar_label: "API de Cron Jobs"
---

## REST API

Ler requer o escopo `cron:read`. Disparar, pausar e retomar requerem
`cron:write`. Um administrador tem os dois. Também os tem uma pessoa cujo papel os declara, e
uma chave de API criada com eles, que é o que um agendador externo deve carregar:

```bash
rebase api-keys create -n "Scheduler" --scopes cron:read,cron:write
```

Consulte [Papéis e escopos](/docs/backend/roles-and-scopes/).

| Método | Caminho | Descrição |
|--------|------|-------------|
| `GET` | `/api/admin/cron` | Lista todos os cron jobs registrados |
| `GET` | `/api/admin/cron/:id` | Obtém o status de um job individual |
| `POST` | `/api/admin/cron/:id/trigger` | Dispara um job manualmente — `409` enquanto ele já está em execução. `?async=1` responde `202` assim que a execução começou |
| `GET` | `/api/admin/cron/:id/logs` | Obtém o histórico de execução (`?limit=N`), dos últimos 30 dias. `503` quando `rebase.cron_logs` não pode ser lida, em vez de um histórico vazio |
| `PUT` | `/api/admin/cron/:id` | Pausa ou retoma um job em todos os processos (`{ "enabled": false }`); `null` volta a seguir o código |

### Exemplo: Listar Todos os Jobs

`$TOKEN` é um token de acesso de uma conta que tem `cron:read`: faça login e use o `accessToken` retornado na resposta do login. Uma chave de API que tenha o escopo funciona da mesma forma. `$API_URL` é a URL exibida pelo `rebase dev` — a porta é derivada do caminho do projeto, logo não há uma porta fixa.

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
    "note": "1 cron file(s) failed to load and 1 job(s) were refused — NOT scheduled. See `rejected` for the reason; the server log has the rest."
}
```

`rejected` indica o nome do job e o motivo. Um arquivo que falhou ao ser *carregado* exibe apenas uma contagem: a falha ocorreu antes que houvesse um job para identificar, portanto o motivo está no log do servidor.

A ocorrência mais comum aqui é a mostrada acima — seis campos, originados de uma expressão copiada de uma ferramenta que aceita segundos. O Rebase aceita cinco; remova o primeiro campo. Um `timeoutSeconds` igual a zero, negativo ou `NaN` também aparece aqui.

### Exemplo: Disparar um Job Manualmente

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
    "$API_URL/api/admin/cron/health-check/trigger"
```

Enquanto o job está em execução — aqui ou em qualquer outro processo —, a
resposta é `409` com o código `CRON_JOB_ALREADY_EXECUTING`; veja
[Proteção de Concorrência](/docs/backend/cron-across-instances/#concurrency-guarding).

A chamada espera a execução terminar e responde `200` com o seu log. Para um job que executa
por mais tempo do que um proxy na frente do servidor mantém uma requisição (muitos cortam aos 60 segundos), acrescente
`?async=1`. A resposta é então `202` assim que a execução começou:

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
    "$API_URL/api/admin/cron/nightly-report/trigger?async=1"
```

```json
{
    "accepted": true,
    "startedAt": "2026-04-24T08:21:04.512Z",
    "job": { "id": "nightly-report", "state": "running" }
}
```

A execução continua depois da resposta. O resultado está em `GET /api/admin/cron/:id/logs`, como a
entrada com `"manual": true` e o mesmo `startedAt`. Uma execução que não consegue começar ainda responde
`409`. `?async` aceita `1`, `true`, `0` ou `false`; qualquer outro valor é um `400`.

### Pausando um job

Uma pausa pelo Studio ou por
`PUT /api/admin/cron/:id` vale para todos os processos e se mantém após
reinicializações e novos deploys; `{ "enabled": null }` devolve o job ao
`enabled` declarado no seu arquivo. Como cada réplica a lê, e o que acontece
quando uma não consegue, está em
[Cron entre instâncias](/docs/backend/cron-across-instances/#pausing-a-job-across-every-process).

## SDK tipado

O SDK tipado do Rebase disponibiliza o namespace `cron` para todas as operações:

```typescript
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({ baseUrl: import.meta.env.VITE_API_URL });

// List all jobs, and the ones that did not register
const { jobs, rejected } = await client.cron.listJobs();

// Get a single job
const { job } = await client.cron.getJob("health-check");

// Trigger manually, and wait for the run
const { log, job: updated } = await client.cron.triggerJob("health-check");

// Trigger manually, and answer once the run has started
const { startedAt } = await client.cron.triggerJob("nightly-report", { async: true });

// View execution history
const { logs } = await client.cron.getJobLogs("health-check", { limit: 10 });

// Enable or disable
await client.cron.toggleJob("health-check", false); // pause
await client.cron.toggleJob("health-check", true);  // resume
```

`triggerJob()` espera a execução terminar e responde com o seu log. Um proxy na frente do
servidor pode cortar a resposta de um job longo (muitos o fazem aos 60 segundos) enquanto a
execução em si continua. Para um job assim, passe `{ async: true }`: a chamada responde assim que a execução começou,
e `getJobLogs()` tem o resultado, como a entrada com `manual: true` e o `startedAt` retornado.

`listJobs()` é tipado como `CronJobListing`: `jobs`, mais os campos `skipped`,
`rejected` e `note` descritos em [Jobs Que Não Estão Lá](#jobs-que-não-estão-lá).
