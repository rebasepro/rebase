---
sourceHash: 9dc4adc1ff3c773b
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

Desativado a menos que você solicite: um worker faz polling no banco de dados continuamente, o que não é um padrão que qualquer um escolheria. Ele precisa de um driver capaz de executar SQL — em um que não suporte (MongoDB), a fila fica indisponível e você é avisado na inicialização em vez de no primeiro enfileiramento.

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

Linhas com falha são mantidas por 30 dias; as bem-sucedidas, por 3.

## O que acontece quando um worker morre

Um processo encerrado no meio de um job não pode liberar sua reivindicação, então nada além de um timeout liberará a linha. Jobs reivindicados por mais tempo do que `visibilityTimeoutMs` (padrão de 5 minutos) são recuperados — voltando para `pending` se ainda tiverem tentativas restantes, ou enviados para dead-letter com um erro explicando o ocorrido.

É também por isso que o timeout deve exceder o seu handler mais lento: passado esse tempo, um segundo worker pode iniciar um job que o primeiro ainda está executando.

```typescript no-verify
jobs: {
    enabled: true,
    concurrency: 5,              // jobs at once, per instance
    pollIntervalMs: 2_000,       // when the last look found nothing
    visibilityTimeoutMs: 300_000 // must exceed the slowest handler
}
```

## Várias instâncias

Seguro por construção. Os workers realizam a reivindicação com `SELECT … FOR UPDATE SKIP LOCKED`, de modo que cada job vai para exatamente um deles e os outros passam para a próxima linha em vez de ficarem esperando em fila atrás dele. Não é necessário eleger nenhum líder.

Durante um rolling deploy, uma instância executando código antigo receberá jobs cuja tarefa ela não implementa. Esses jobs são devolvidos à fila em vez de falharem, para que sejam executados assim que um par atualizado os assumir.

## Webhooks duráveis

O [`WebhookDispatcher`](/docs/recipes/webhooks) enfileira suas entregas em memória por padrão, o que significa que uma falha ou um deploy entre a alteração e a entrega descarta o evento. Ao fornecer a fila para ele, cada entrega se torna uma linha:

```typescript no-verify
import { WebhookDispatcher, WEBHOOK_DELIVERY_TASK } from "@rebasepro/server";

const { jobQueue } = await initializeRebaseBackend({ jobs: { enabled: true } });

const dispatcher = new WebhookDispatcher({ jobQueue });
dispatcher.setWebhooks(myWebhooks);

jobQueue?.register(WEBHOOK_DELIVERY_TASK, ctx => dispatcher.deliverQueuedJob(ctx.payload as never));
```

Apenas o **id** do webhook é armazenado no job, nunca o webhook em si — caso contrário, seu segredo de assinatura ficaria em texto não criptografado em `rebase.jobs` pelo tempo que a retenção mantiver a linha, e um webhook editado entre o enfileiramento e a entrega deve ser enviado com as configurações atuais.

## Encerramento

O `shutdown()` impede que o worker reivindique novos jobs e aguarda os que estão em andamento, para que um deploy não execute o final de um lote duas vezes. Qualquer coisa que ainda esteja em execução quando o processo for encerrado mantém sua reivindicação e é recuperada pelo timeout de visibilidade.

## Próximos Passos

- **[Cron Jobs](/docs/backend/cron-jobs)** — trabalho agendado
- **[Webhooks](/docs/recipes/webhooks)** — notifique outros sistemas sobre alterações

---
