---
sourceHash: 9e21b0515cf58869
title: Jobs em Segundo Plano
sidebar_label: Jobs em Segundo Plano
description: Uma fila de jobs durável, baseada em Postgres — trabalho que sobrevive a reinicializações, com novas tentativas com backoff e falhas mantidas em vez de descartadas.
---

## Visão Geral

Um job é uma linha em `rebase.jobs`. Ele é reivindicado por exatamente um worker, repetido com um intervalo crescente se o seu handler lançar um erro, e mantido na tabela quando finalmente desiste para que alguém possa analisá-lo.

Não há nada para instalar e nada para executar junto com o Postgres. Um job enfileirado dentro de uma transação que sofre rollback nunca foi enfileirado.

Use-o para trabalhos que não podem ser perdidos e que não devem acontecer dentro de uma requisição: envio de e-mails, chamadas para terceiros, geração de arquivos, reconciliação com um sistema externo.

| | Execução | Sobrevive a uma reinicialização |
|---|---|---|
| [Cron](/docs/backend/cron-jobs) | Em um agendamento | Sim — o agendamento está no código |
| **Jobs** | Uma vez, assim que um worker estiver livre | **Sim — o job é uma linha** |
| Um `setTimeout` em um callback | Uma vez, neste processo | Não |

## Habilitação

:::note[Onde isso vai]
**Runtime gerenciado** — em nenhum lugar. `jobs` aceita *funções* de handler, as quais nenhuma variável de ambiente e nenhum export de `backend/storage.ts` ou `backend/hooks.ts` pode carregar, de modo que um projeto estruturado inicialmente (scaffolded) não pode habilitar a fila. Execute `rebase eject` (ou crie um [servidor customizado](/docs/backend/custom-server/)) para acessá-la. `REBASE_JOB_WORKERS` no `.env` apenas decide se os workers de uma fila já habilitada são executados *neste* processo.

**Ejetado** — o bloco `jobs` em `initializeRebaseBackend({ … })`, como mostrado abaixo.

O mapeamento completo está em [Visão Geral do Backend](/docs/backend/#where-each-option-lives).
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

Desativado a menos que você solicite: um worker continua procurando por trabalho enquanto o processo estiver ativo, o que não é um padrão que qualquer pessoa escolheria. Ele precisa de um driver capaz de executar SQL — em um que não seja capaz, a fila fica indisponível e você é avisado na inicialização em vez de no primeiro enfileiramento.

Um worker ocioso não faz polling a cada dois segundos. Cada enfileiramento envia um `NOTIFY` no canal `rebase_jobs` quando realiza o commit, e um worker mantendo um `LISTEN` nele faz a reivindicação imediatamente — um job enfileirado por outro processo (a role `api`, outra réplica) inicia em milissegundos, e um com atraso quando seu prazo chegar. Por trás disso, ele faz uma verificação a cada 30 segundos de qualquer forma. Um job que este processo enfileira, uma nova tentativa que ele agendou e um job que ele recuperou o acordam sem precisar de notificação.

O `LISTEN` precisa de uma conexão própria, encontrada da mesma forma que o realtime encontra uma: `DATABASE_DIRECT_URL` quando definido, caso contrário `DATABASE_URL`. Atrás de um pooler em modo de transação como o PgBouncer, defina `DATABASE_DIRECT_URL`: um pooler não mantém um `LISTEN`, e os jobs de outros processos teriam que aguardar pela verificação de 30 segundos. Onde não houver nenhuma conexão desse tipo (o banco de dados de desenvolvimento em processo), um worker ocioso aplica um backoff: ele verifica após `pollIntervalMs` (2 segundos), e depois o dobro do tempo após cada verificação que não encontrou nada, até 30 segundos, reiniciando o ciclo sempre que encontrar trabalho. Um worker ocioso faz cerca de 2.900 tentativas de reivindicação por dia em vez de 43.200.

## Enfileiramento

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

`idempotencyKey` unifica um clique duplo, uma requisição repetida e duas instâncias reagindo ao mesmo evento em um único job. Seu escopo é limitado a trabalhos não finalizados, de modo que a chave se torna reutilizável assim que o job for concluído — caso contrário, "o resumo noturno para o usuário 7" só poderia ser enviado exatamente uma vez na história. Um enfileiramento duplicado resolve para `null` em vez de lançar um erro: o trabalho solicitado já está na fila, que é o resultado esperado.

## Falhas

Um handler falha ao lançar um erro. Não existe `return false` — um booleano seria silenciosamente ignorado por qualquer handler que esquecesse de retornar um, e a falha precisa ser o que você obtém por padrão.

- **Tentativas restantes** → volta para `pending`, com `run_at` adiado pelo backoff (1s, 5s, 25s … limitado a uma hora; sobrescreva com `backoff`).
- **Sem tentativas restantes** → `failed`, e a linha *permanece*. Uma fila que descarta silenciosamente o que não pôde entregar é indistinguível de uma fila sem nada para fazer.
- **Uma falha que nenhuma nova tentativa pode resolver** → lance `PermanentJobError`, de `@rebasepro/server`: o job vai para `failed` nesta tentativa, com a mensagem como seu `last_error`, em vez de consumir suas tentativas restantes.

```sql
SELECT task, attempts, last_error, updated_at
FROM rebase.jobs WHERE status = 'failed'
ORDER BY updated_at DESC;
```

Linhas com falha são mantidas por 30 dias; as bem-sucedidas por 3. Cada worker exclui as linhas expiradas quando inicializa e, depois, a cada hora, em lotes, fora do ciclo da requisição.

## O que acontece quando um worker morre

Um processo encerrado no meio de um job não pode liberar sua reivindicação, portanto nada além de um timeout liberará a linha. Enquanto um handler é executado, seu worker renova a reivindicação a cada terço de `visibilityTimeoutMs` (padrão de 5 minutos). Uma reivindicação que ficou esse tempo todo sem ser renovada é recuperada — voltando para `pending` se o job tiver tentativas restantes, ou enviada para dead-letter com um erro informando o que aconteceu.

Assim, um handler lento em um worker ativo mantém seu job, não importa quanto tempo leve, e o timeout apenas define a rapidez com que os jobs de um worker inativo retornam. Uma tentativa que perdeu sua reivindicação também não pode sobrescrever o resultado do job: seu sucesso ou falha é registrado no log e descartado, e a tentativa que detiver a reivindicação decide o resultado.

```typescript no-verify
jobs: {
    enabled: true,
    concurrency: 5,              // jobs at once, per instance
    pollIntervalMs: 2_000,       // the first wait after a look that found nothing; it doubles up to 30 s
    visibilityTimeoutMs: 300_000 // how long an unrenewed claim holds
}
```

### Um handler que nunca termina

O outro lado: um handler aguardando um `fetch` que nunca responde ocupa seu slot no worker, e sua reivindicação, enquanto o processo durar — cinco desses e o worker não executa mais nada, enquanto `/health` continua verde.
`timeoutMs` limita uma tentativa. No prazo final, a tentativa falha — repetida enquanto houver tentativas restantes, como qualquer lançamento de erro — seu slot é liberado e o `signal` do handler é abortado. Repasse o signal adiante para que o trabalho também seja interrompido; um handler que o ignora continuará rodando em segundo plano sem nada para registrar seu resultado.

Se omitido, o padrão é 15 minutos (`900_000`), e o worker informa isso em uma linha de log ao iniciar. Um job que legitimamente precise de mais tempo define seu próprio valor, e `timeoutMs: 0` remove o limite.

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

Handlers de fila e inscrições de tópicos recebem o mesmo `signal` em seu contexto.

## Várias instâncias

Seguro por concepção. Os workers fazem reivindicações com `SELECT … FOR UPDATE SKIP LOCKED`, de modo que cada job vai para exatamente um deles e os outros passam para a próxima linha em vez de enfileirar atrás dele. Nenhuma eleição de líder é necessária.

Uma instância reivindica apenas as tasks para as quais possui um handler. Durante um deploy gradual, uma instância executando código mais antigo não mexe nos jobs cujas tasks são implementadas apenas pelo código mais novo: eles permanecem como `pending`, com suas tentativas intactas, até que um par atualizado os reivindique. Uma task que nenhuma instância implementa também permanece como `pending`, em vez de ir para dead-letter.

## Varreduras de órfãos no storage

`rebase storage orphans` roda nesta fila quando ela está ativada: cada varredura e cada exclusão resultante de uma varredura é um job `storage.orphans`, com uma tentativa. O backend registra o handler por conta própria em cada processo com storage configurado, e somente os processos cujos workers de jobs estão ativados o executam. Uma varredura é limitada por `timeoutMs` como qualquer job, portanto, uma fonte grande demais para ser varrida em 15 minutos precisa de um `timeoutMs` maior, ou 0. Sem a fila, o servidor executa a varredura dentro do seu próprio processo. Consulte [a CLI](/docs/cli/#rebase-storage).

## Webhooks duráveis

O [`WebhookDispatcher`](/docs/recipes/webhooks) enfileira suas entregas na memória por padrão, o que significa que uma falha ou um deploy entre a alteração e a entrega descarta o evento. Forneça a ele a fila e cada entrega se tornará uma linha:

```typescript no-verify
import { WebhookDispatcher, WEBHOOK_DELIVERY_TASK } from "@rebasepro/server";

const { jobQueue } = await initializeRebaseBackend({ jobs: { enabled: true } });

const dispatcher = new WebhookDispatcher({ jobQueue });
dispatcher.setWebhooks(myWebhooks);

jobQueue?.register(WEBHOOK_DELIVERY_TASK, ctx => dispatcher.deliverQueuedJob(ctx.payload as never, ctx));
```

Apenas o **id** do webhook é armazenado no job, nunca o webhook em si — caso contrário, seu segredo de assinatura ficaria exposto em texto simples em `rebase.jobs` pelo tempo em que a retenção mantiver a linha, além de que um webhook editado entre o enfileiramento e a entrega deve ser enviado com as informações atuais. Passar `ctx` como segundo argumento faz com que cada tentativa envie seu próprio `X-Webhook-Attempt`; todas as tentativas de uma mesma entrega enviam o mesmo `X-Webhook-Delivery`, permitindo que o destinatário faça a desduplicação das novas tentativas.

Uma entrega que o dispatcher recusa enviar (um destino loopback, link-local, privado ou que não seja `http(s)`), ou uma na qual o destinatário responde com um redirecionamento, falha da mesma maneira todas as vezes. Ela é movida para dead-letter após uma tentativa, com o motivo registrado em `last_error`. Qualquer outra falha passa por novas tentativas como qualquer outro job.

## Encerramento

`shutdown()` impede que o worker reivindique novos jobs e aguarda aqueles em andamento, evitando que um deploy execute o final de um lote duas vezes. A espera é limitada a dois terços do timeout de encerramento (10 segundos do padrão de 15), para que um único handler que nunca finalize não trave o shutdown. Um job que continuar em execução após esse período mantém sua reivindicação e é recuperado pelo timeout de visibilidade.

## Próximos Passos

- **[Cron Jobs](/docs/backend/cron-jobs)** — trabalho agendado
- **[Webhooks](/docs/recipes/webhooks)** — notifique outros sistemas em caso de alterações
