---
sourceHash: eb2b1e4f16ef2812
title: Cron entre instâncias
sidebar_label: Cron entre instâncias
description: "Como os cron jobs se comportam com mais de um processo de servidor: uma execução por slot, um slot perdido por reinicialização, uma pausa que todas as réplicas respeitam e execuções que nunca se sobrepõem."
---

Os [cron jobs](/docs/backend/cron-jobs) rodam em cada processo cujo agendador está ativo:
todas as réplicas por padrão, ou apenas o worker em um
[deployment dividido](/docs/deployment/split-processes/). Cada um desses processos
arma os mesmos timers, e o banco de dados é o que os impede de interferir uns nos
outros — uma reivindicação (claim) por `(job, slot)`, para que um slot seja executado uma vez; uma recuperação (catch-up) para um slot que
uma reinicialização descartou; e uma linha por job em `rebase.cron_job_state`, mantendo a
pausa que todas as réplicas leem e o lease que uma execução retém enquanto roda.

As tabelas estão listadas sob o
[Database Persistence Schema](/docs/backend/cron-jobs/#database-persistence-schema).
Com `cronPersistence: false`, nada coordena os processos:
cada um deles executa todos os jobs; portanto, ative o agendador em apenas um deles
(`REBASE_CRON_SCHEDULER`).

## Recuperando Slots Perdidos

Como o agendador calcula o próximo slot a partir de *agora* em cada inicialização, um slot só é disparado se alguma instância estivesse ativa e funcionando quando o momento chegou. Qualquer coisa que substitua o processo durante um slot — um rolling deploy, um crash, uma plataforma reciclando o container — descarta essa execução, e o substituto agenda o slot *posterior* a ele. Nada gera erro; a execução simplesmente nunca acontece.

Isso **não** é apenas um problema de escala para zero (scale-to-zero). Um serviço fixado em uma instância ativa (warm) ainda perde execuções, pois a plataforma tem a liberdade de desativar a instância que mantém o timer e iniciar uma nova.

Defina `catchUpWindowSeconds` para uma janela confortavelmente maior do que o tempo de um reinício, e a inicialização executará um slot que encontrar não reivindicado dentro dessa janela:

```typescript
export default defineCron({
    schedule: "0 6 * * *",       // daily at 06:00
    name: "Scrape Listings",
    catchUpWindowSeconds: 3600,  // tolerate an hour of downtime around 06:00
    handler: async (ctx) => { /* … */ }
});
```

Três coisas que você deve saber:

- **Desativado por padrão.** Sem `catchUpWindowSeconds`, o comportamento permanece inalterado.
- **Apenas o slot perdido mais recente é executado.** Inicializar após uma interrupção de seis horas recupera um job horário uma única vez, não seis vezes. O catch-up impede que uma execução seja perdida; ele não reproduz o histórico.
- **É necessário um armazenamento compatível com claims.** O catch-up reivindica o slot por meio da mesma chave `(job_id, slot)` que o caminho agendado utiliza, que é a única coisa que distingue "este slot nunca foi executado" de "este slot já foi executado na instância que está sendo substituída". Sem um store conectado, o catch-up é ignorado e um aviso é registrado no log — caso contrário, uma instância reciclada a cada 30 minutos executaria novamente o mesmo job horário toda vez que inicializasse.

No caso comum — uma reinicialização minutos após um slot ter sido executado normalmente — o slot mais recente já foi reivindicado, portanto o catch-up custa uma verificação de claim por job por inicialização e não faz nada.

O agendador exclui claims com mais de sete dias quando inicia e, posteriormente, a cada hora, mas sempre mantém o mais recente de cada job, independentemente da sua idade. Esse claim é o registro de que o slot já foi executado, de modo que um job mensal com uma janela de catch-up de um mês não seja reexecutado por um deploy no dia 10.

Uma execução recuperada é uma entrada normal em `cron_logs` (`manual` é `false`), com uma primeira linha de log registrando o slot que foi recuperado e o quanto ele estava atrasado:

```
⏰ Catch-up run for missed slot 2026-07-29T06:00:00.000Z (612s late)
```

---

## Pausando um job em todos os processos

Uma pausa é armazenada
em `rebase.cron_job_state`, e não na memória do processo que a atendeu, portanto
ela alcança todas as réplicas — e, em um [deployment dividido](/docs/deployment/split-processes/),
o worker, quando a requisição foi atendida por um processo `api` que não executa timers.
Ela também sobrevive a reinicializações e novos deploys: um job pausado no Studio permanece pausado.

`$TOKEN` é um token de acesso de administrador e `$API_URL` é o endereço exibido
pelo `rebase dev` — consulte a [REST API](/docs/backend/cron-jobs-api/).

```bash
# Pause, for every process, until someone resumes it
curl -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d '{ "enabled": false }' "$API_URL/api/admin/cron/health-check"

# Stop overriding: follow the `enabled` the job's file declares again
curl -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d '{ "enabled": null }' "$API_URL/api/admin/cron/health-check"
```

`true` e `false` sobrescrevem o `enabled` no arquivo do job; `null` remove a
sobrescrita. A linha registra quem fez a alteração e quando.

Cada agendador lê o estado quando um slot vence, antes de reivindicar o
slot — uma consulta por disparo — para que um job pausado não gaste seu slot, e um job
retomado em uma réplica seja executado em seu próximo slot em qualquer réplica que o reivindicar.
O catch-up na inicialização também o lê.

Se o estado não puder ser lido — a tabela estiver ausente, o banco de dados estiver temporariamente
inacessível — o agendador recorre ao `enabled` no arquivo do job e registra
um aviso. Isso é deliberado: uma execução agendada opera em modo fail-open, assim como faz quando
a tabela de claims não responde, porque uma tabela corrompida não deve interromper silenciosamente
todos os jobs. Se a alteração em si não puder ser salva, o `PUT` responde com `503` e nenhum
processo é modificado.

Com `cronPersistence: false` não há
onde manter o estado: uma pausa se aplica ao processo que a atendeu e
desaparece após a reinicialização.

---

## Proteção contra Concorrência

Para garantir a estabilidade ao executar operações com uso intenso de recursos, o Rebase implementa um rigoroso **bloqueio de execução de concorrência única** por ID de job:
- **Sobreposições Agendadas**: Se o tick agendado de um job disparar enquanto a execução anterior ainda estiver em andamento, o agendador pula o tick e agenda imediatamente a próxima execução candidata.
- **Colisões de Disparos Manuais**: Se um operador disparar manualmente um job em execução por meio do Rebase Studio ou da REST API, a requisição responde com `409` e o código `CRON_JOB_ALREADY_EXECUTING`, protegendo o worker ativo. `details.log` é a entrada de skip descrita abaixo.

De qualquer forma, uma linha é gravada em `rebase.cron_logs`, de modo que o skip fica no
histórico de execução e não apenas no log do processo:

```json
{
  "jobId": "expire-users",
  "success": true,
  "result": { "skipped": true, "reason": "already_executing" },
  "logs": ["Skipped: the previous run has not finished"]
}
```

`success: true` porque nada falhou — `result.skipped` é o que o sinaliza. Uma
sequência desses seguidos é a assinatura de um job que ultrapassou o tempo do seu agendamento,
e esse é um padrão que você só pode identificar se os skips forem registrados.

O bloqueio funciona
entre processos, não apenas dentro de um. Toda execução — agendada, manual ou um
catch-up — adquire um **run lease** em `rebase.cron_job_state` antes que seu handler
seja iniciado, e o libera quando a execução termina. Portanto, um disparo manual a partir do processo
`api` enquanto o worker está executando o job responde com `409`, e um slot que
vence enquanto uma execução manual mantém o lease em outro processo é ignorado (skipped). A linha de
log do skip informa o nome do processo que retém o lease.

Um lease dura o `timeoutSeconds` do job mais 30 segundos, o que também é o que
libera um job cujo processo travou no meio da execução. Um job com `timeoutSeconds: Infinity`
o retém por no máximo uma hora: uma falha (crash), portanto, bloqueia o job por uma hora em
vez de para sempre, e uma execução que ainda esteja rodando após uma hora não impede mais outro
processo de iniciar o job. Um job que legitimamente roda por horas deve
fornecer um `timeoutSeconds` finito, o qual o lease então acompanhará. Se o lease não
puder ser obtido porque o banco de dados não responde, a execução prossegue com um aviso,
assim como faz uma execução agendada quando seu claim não pode ser lido.
