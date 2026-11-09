---
sourceHash: 137350d3f13ed7f5
title: Trabalho em Segundo Plano
sidebar_label: Trabalho em Segundo Plano
description: "Execute trabalho depois que uma função personalizada respondeu: waitUntil, o que o host faz com ele no desligamento e o que se perde sem ele."
---

Trabalhos que devem continuar após a resposta ser enviada devem ser colocados em `waitUntil`:

```typescript
import { defineFunction, requireAuth, waitUntil } from "@rebasepro/server/functions";

export default defineFunction((app, { rebase }) => {
    app.post("/orders", requireAuth, async (c) => {
        const order = await c.req.json();
        // The caller does not wait for this, but shutdown does.
        waitUntil(c, rebase.email.send({
            to: "warehouse@example.com",
            subject: "New order",
            html: "<p>Pick and pack</p>"
        }));
        return c.json({ received: true });
    });
});
```

Uma promise sem `await` parece equivalente, mas não é. O `waitUntil` garante duas vantagens:

- **No Node**, a promise é rastreada, de modo que um encerramento gracioso (graceful shutdown) aguarda por ela em vez de finalizar o processo interrompendo um webhook pela metade. Uma promise solta em um `SIGTERM` é simplesmente perdida.
- **Em um host baseado em isolates**, o host é instruído a manter o isolate ativo até que a promise seja concluída. Sem isso, a execução é interrompida no momento em que a resposta é resolvida — silenciosamente, exibindo um 200 normal nos logs.

Uma rejeição é registrada em log em vez de ser deixada para o handler de unhandled-rejection, permitindo que a falha identifique a rota de onde se originou.

Código executado fora de qualquer requisição não possui um `c` para passar: um inicializador a nível de módulo, um helper compartilhado entre rotas e crons, ou uma tarefa iniciada por um cron que não é aguardada. Passe para o `waitUntil` apenas o trabalho:

```typescript no-verify
import { waitUntil } from "@rebasepro/server/functions";

let ready: Promise<void> | undefined;

export function ensureCatalogue(): Promise<void> {
    ready ??= loadCatalogue().then(() => {
        // No request to attach it to, but shutdown still waits for it.
        waitUntil(rateNewSongs());
    });
    return ready;
}
```

O trabalho é rastreado para o encerramento gracioso e eventuais rejeições são registradas em log, assim como com `c`. O que ele não consegue fazer é manter um isolate ativo, pois esse é o contexto de execução da requisição: passe `c` sempre que houver uma requisição disponível. Trabalhos que uma execução de cron, um job ou um handler de fila podem simplesmente aguardar com `await` devem ser aguardados diretamente; a execução é o que o encerramento aguarda, e seu resultado é registrado com ela.

O encerramento aguarda no máximo 5 segundos por essas tarefas. Trabalhos que levam minutos devem estar em um [cron job](/docs/backend/cron-jobs/) ou em um [job](/docs/backend/jobs/), que são registrados e reinicializáveis. Um cron job também roda [um de cada vez entre instâncias](/docs/backend/cron-across-instances/#concurrency-guarding), seja disparado pelo agendamento ou por acionamento manual.
