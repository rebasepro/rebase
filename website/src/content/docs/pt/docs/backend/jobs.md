---
sourceHash: cae2434b532cd67f
title: Tarefas em Segundo Plano
sidebar_label: Tarefas em Segundo Plano
description: Uma fila de jobs durável, baseada em Postgres — trabalho que sobrevive a reinicializações, com novas tentativas usando backoff e falhas mantidas em vez de descartadas.
---

## Visão Geral

Um job é uma linha em `rebase.jobs`. Ele é reivindicado por exatamente um worker, repetido com um atraso crescente se o seu handler lançar um erro, e mantido na tabela quando ele finalmente desiste para que alguém possa analisá-lo.

Não há nada para instalar e nada para executar junto com o Postgres. Um job enfileirado dentro de uma transação que sofre rollback nunca foi enfileirado.

Use-o para trabalhos que não podem ser perdidos e não devem acontecer dentro de uma requisição: envio de e-mails, chamadas a terceiros, geração de arquivos, reconciliação com um sistema externo.

| | Execuções | Sobrevive a uma reinicialização |
|---|---|---|
| [Cron](/docs/backend/cron-jobs) | Em um agendamento | Sim — o agendamento está no código |
| **Jobs** | Uma vez, assim que um worker estiver livre | **Sim — o job é uma linha** |
| Um `setTimeout` em um callback | Uma vez, neste processo | Não |

## Habilitando

:::note[Onde isso se aplica]
**Runtime gerenciado** — em lugar nenhum. `jobs` recebe *funções* handler, que nenhuma
variável de ambiente e nenhum export de `config/index.ts` consegue transportar, de modo que um
projeto gerado pelo scaffold não pode habilitar a fila. Execute `rebase eject` (ou escreva um
[servidor personalizado](/docs/backend/custom-server/)) para alcançá-la. `REBASE_JOB_WORKERS`
no `.env` apenas decide se os workers de uma fila já habilitada rodam *neste*
processo.

**Ejetado** — o bloco `jobs` em `initializeRebaseBackend({ … })`, como abaixo.

O mapa completo está na [Visão Geral do Backend](/docs/backend/#where-each-option-lives).
:::

```typescript no-verify
await initializeRebaseBackend({
    jobs: {
        enabled: true,
        tasks: {
            "send-welcome": async ({ payload }) => {
                await sendEmail((payload as { email: string }).email);
            }
        }
    }
});
```

Desativado a menos que você solicite: um worker continua procurando trabalho enquanto o processo viver, o que não é um padrão que qualquer um escolheria. Ele precisa de um driver capaz de executar SQL — em um que não suporte (MongoDB), a fila fica indisponível e você é avisado na inicialização em vez de no primeiro enfileiramento.

Um worker ocioso não faz polling a cada dois segundos. Cada enfileiramento envia um
`NOTIFY` no canal `rebase_jobs` quando é confirmado, e um worker que mantém um
`LISTEN` nele reivindica na hora — um job enfileirado por outro processo (o papel
`api`, outra réplica) começa em milissegundos, e um job com atraso começa quando
vence. Por trás disso, ele procura a cada 30 segundos de qualquer forma. Um job que este processo
enfileira, uma nova tentativa que ele agendou e um job que ele recuperou o acordam sem
uma notificação.

O `LISTEN` precisa de uma conexão própria, encontrada do mesmo modo que o realtime
encontra uma: `DATABASE_DIRECT_URL` quando definida, senão `DATABASE_URL`. Atrás de um
pooler em modo de transação como o PgBouncer, defina `DATABASE_DIRECT_URL`: um pooler não mantém um
`LISTEN`, e os jobs de outros processos esperariam então pela busca de 30 segundos.
Onde não há nenhuma conexão desse tipo (o banco de dados de desenvolvimento em processo),
um worker ocioso recua: ele procura depois de `pollIntervalMs` (2 segundos),
depois o dobro do tempo a cada busca que não encontrou nada, até 30 segundos, e
recomeça sempre que encontra trabalho. Um worker ocioso faz cerca de 2.900 reivindicações por
dia em vez de 43.200.

## Enfileirando

```typescript no-verify
const { jobQueue } = await initializeRebaseBackend({ jobs: { enabled: true, tasks } });

await jobQueue?.enqueue("send-welcome", { email: "ada@example.com" });
```

### Opções

```typescript no-verify
await jobQueue?.enqueue("send-digest", { userId: "u7" }, {
    delayMs: 60_000,               // not before a minute from now
    maxAttempts: 5,                // default 3
    idempotencyKey: "digest:u7"    // at most one *unfinished* job with this key
});
```

A `idempotencyKey` unifica um clique duplo, uma requisição repetida e duas instâncias reagindo ao mesmo evento em um único job. Ela tem como escopo trabalhos não finalizados, de modo que a chave se torna reutilizável assim que o job é concluído — caso contrário, "o resumo noturno para o usuário 7" só poderia ser enviado exatamente uma vez na vida. Um enfileiramento duplicado resolve para `null` em vez de lançar um erro: o trabalho solicitado está enfileirado, que é o resultado esperado.

## Falhas

Um handler falha lançando uma exceção. Não há `return false` — um booleano seria silenciosamente ignorado por qualquer handler que esquecesse de retornar um, e a falha precisa ser o comportamento padrão.

- **Tentativas restantes** → volta para `pending`, com `run_at` postergado pelo backoff (1s, 5s, 25s … limitado a uma hora; sobrescreva com `backoff`).
- **Sem tentativas restantes** → `failed`, e a linha *permanece*. Uma fila que descarta silenciosamente o que não conseguiu entregar é indistinguível de uma fila sem nada para fazer.

```sql
SELECT task, attempts, last_error, updated_at
FROM rebase.jobs WHERE status = 'failed'
ORDER BY updated_at DESC;
```

Linhas com falha são mantidas por 30 dias; as bem-sucedidas, por 3. Cada worker apaga
as linhas expiradas ao iniciar e depois a cada hora, em lotes, fora do caminho da
requisição.

## O que acontece quando um worker morre

Um processo encerrado no meio de um job não pode liberar sua reivindicação, então nada além de um timeout liberará a linha. Enquanto um handler é executado, seu worker renova a reivindicação a cada terço de `visibilityTimeoutMs` (padrão de 5 minutos). Uma reivindicação que passou todo esse tempo sem ser renovada é recuperada — voltando para `pending` se o job ainda tiver tentativas restantes, ou enviada para dead-letter com um erro explicando o ocorrido.

Assim, um handler lento em um worker vivo mantém seu job, por mais tempo que leve, e o timeout só decide quão cedo os jobs de um worker morto voltam. Uma tentativa que perdeu sua reivindicação também não pode sobrescrever o resultado do job: seu sucesso ou falha é registrado no log e descartado, e quem decide é a tentativa que detém a reivindicação.

```typescript no-verify
jobs: {
    enabled: true,
    concurrency: 5,              // jobs at once, per instance
    pollIntervalMs: 2_000,       // the first wait after a look that found nothing; it doubles up to 30 s
    visibilityTimeoutMs: 300_000 // how long an unrenewed claim holds
}
```

### Um handler que nunca termina

O outro lado da moeda: um handler que aguarda um `fetch` que nunca responde segura seu
slot de worker, e sua reivindicação, enquanto o processo viver — cinco deles e o
worker não executa mais nada, enquanto o `/health` continua verde.
`timeoutMs`
limita uma tentativa. No prazo final a tentativa falha — repetida enquanto restarem
tentativas, como qualquer exceção —, seu slot é liberado e o `signal` do handler é
abortado. Repasse o signal, para que o trabalho também pare; um handler que o ignora
continua em execução em segundo plano sem que nada registre seu resultado.

Se omitido, são 15 minutos (`900_000`), e o worker avisa isso em uma linha de log
quando inicia. Um job que legitimamente roda por mais tempo define seu próprio valor,
e `timeoutMs: 0` remove o limite.

```typescript no-verify
jobs: {
    enabled: true,
    timeoutMs: 120_000,          // one attempt; 15 minutes when left out, 0 for no limit
    tasks: {
        "sync-crm": async ({ payload, signal }) => {
            await fetch(crmUrl, { method: "POST", body: JSON.stringify(payload), signal });
        }
    }
}
```

Os handlers de fila e as assinaturas de tópicos recebem o mesmo `signal` em seu contexto.

## Várias instâncias

Seguro por construção. Os workers realizam a reivindicação com `SELECT … FOR UPDATE SKIP LOCKED`, de modo que cada job vai para exatamente um deles e os outros passam para a próxima linha em vez de ficarem esperando em fila atrás dele. Não é necessário eleger nenhum líder.

Uma instância só reivindica as tarefas para as quais tem um handler. Durante um rolling deploy, uma instância executando código antigo deixa de lado os jobs cuja tarefa só o código novo implementa: eles permanecem `pending`, sem gastar tentativas, até que um par atualizado os reivindique. Uma tarefa que nenhuma instância implementa também permanece `pending`, em vez de ir para a dead-letter.

## Varreduras de órfãos do storage

O `rebase storage orphans` roda nesta fila quando ela está ativada: cada varredura, e cada
exclusão a partir de uma varredura, é um job `storage.orphans`, com uma tentativa. O backend
registra o handler por conta própria, em todo processo com storage configurado, e só
os processos cujos workers de job estão ativados o executam. Uma varredura é limitada por
`timeoutMs` como qualquer job, então uma fonte grande demais para ser varrida em 15 minutos precisa de um
`timeoutMs` maior, ou 0. Sem a fila, o servidor executa a varredura dentro do
próprio processo. Veja [a CLI](/docs/cli/#rebase-storage).

## Webhooks duráveis

O [`WebhookDispatcher`](/docs/recipes/webhooks) enfileira suas entregas em memória por padrão, o que significa que uma falha ou um deploy entre a alteração e a entrega descarta o evento. Ao fornecer a fila para ele, cada entrega se torna uma linha:

```typescript no-verify
import { WebhookDispatcher, WEBHOOK_DELIVERY_TASK } from "@rebasepro/server";

const { jobQueue } = await initializeRebaseBackend({ jobs: { enabled: true } });

const dispatcher = new WebhookDispatcher({ jobQueue });
dispatcher.setWebhooks(myWebhooks);

jobQueue?.register(WEBHOOK_DELIVERY_TASK, ctx => dispatcher.deliverQueuedJob(ctx.payload as never, ctx));
```

Apenas o **id** do webhook é armazenado no job, nunca o webhook em si — caso contrário, seu segredo de assinatura ficaria em texto não criptografado em `rebase.jobs` pelo tempo que a retenção mantiver a linha, e um webhook editado entre o enfileiramento e a entrega deve ser enviado com as configurações atuais. Passar `ctx` como segundo argumento faz cada tentativa enviar seu próprio `X-Webhook-Attempt`; todas as tentativas de uma mesma entrega enviam o mesmo `X-Webhook-Delivery`, para que um receptor possa deduplicar as novas tentativas.

Uma entrega que o dispatcher se recusa a enviar (um destino loopback, link-local, privado ou que não seja `http(s)`), ou uma que o receptor responde com um redirecionamento, falha da mesma forma todas as vezes. Ela vai para a dead-letter após uma única tentativa, com o motivo em `last_error`. Qualquer outra falha é repetida como em qualquer job.

## Encerramento

O `shutdown()` impede que o worker reivindique novos jobs e aguarda os que estão em andamento, para que um deploy não execute o final de um lote duas vezes. A espera é limitada a dois terços do timeout de encerramento (10 segundos dos 15 padrão), para que um handler que nunca termina não possa segurar o encerramento. Um job ainda em execução depois disso mantém sua reivindicação e é recuperado pelo timeout de visibilidade.

## Próximos Passos

- **[Cron Jobs](/docs/backend/cron-jobs)** — trabalho agendado
- **[Webhooks](/docs/recipes/webhooks)** — notifique outros sistemas sobre alterações
