---
sourceHash: cae06a81ae018c4f
title: Cron entre instâncias
sidebar_label: Cron entre instâncias
description: "Como os cron jobs se comportam com mais de um processo de servidor: uma execução por slot, um slot perdido em uma reinicialização, uma pausa que toda réplica respeita e execuções que nunca se sobrepõem."
---

Os [cron jobs](/docs/backend/cron-jobs) rodam em todo processo cujo agendador
está ligado: em todas as réplicas por padrão, ou só no worker em um
[deploy dividido](/docs/deployment/split-processes/). Cada um desses processos
arma os mesmos timers, e é o banco de dados que impede que eles atrapalhem uns
aos outros — um claim por `(job, slot)`, para que um slot rode uma vez; uma
recuperação para um slot perdido em uma reinicialização; e uma linha por job em
`rebase.cron_job_state`, com a pausa que toda réplica lê e o lease que uma
execução detém enquanto dura.

Tudo isso exige um banco de dados SQL; as tabelas estão listadas em
[Esquema de Persistência no Banco de Dados](/docs/backend/cron-jobs/#database-persistence-schema).
No MongoDB, ou com `cronPersistence: false`, nada coordena os processos: cada um
executa todos os jobs, então ligue o agendador em apenas um deles
(`REBASE_CRON_SCHEDULER`).

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

Na inicialização, as reivindicações com mais de sete dias são apagadas, mas a mais recente de cada job é sempre mantida, qualquer que seja a sua idade. Essa reivindicação é o registro de que o slot já foi executado, então um job mensal com uma janela de catch-up de um mês não é executado de novo por um deploy no dia 10.

Uma execução recuperada é uma entrada comum em `cron_logs` (`manual` é `false`), com uma primeira linha de log registrando o slot recuperado e o tempo de atraso:

```
⏰ Catch-up run for missed slot 2026-07-29T06:00:00.000Z (612s late)
```

---

## Pausando um job em todos os processos

<span class="since-badge" data-since="0.23">Since 0.23</span> Uma pausa é guardada em
`rebase.cron_job_state`, e não na memória do processo que atendeu a requisição,
então ela chega a todas as réplicas — e, em um
[deploy dividido](/docs/deployment/split-processes/), ao worker, quando a
requisição foi atendida por um processo `api` que não executa timers. Ela também
sobrevive a reinicializações e novos deploys: um job pausado no Studio continua
pausado.

`$TOKEN` é um token de acesso de administrador e `$API_URL` o endereço que o
`rebase dev` exibiu; veja a [REST API](/docs/backend/cron-jobs/#rest-api).

```bash
# Pausar, para todos os processos, até alguém retomá-lo
curl -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d '{ "enabled": false }' "$API_URL/api/admin/cron/health-check"

# Parar de sobrescrever: voltar a seguir o `enabled` declarado no arquivo do job
curl -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d '{ "enabled": null }' "$API_URL/api/admin/cron/health-check"
```

`true` e `false` sobrescrevem o `enabled` do arquivo do job; `null` remove a
sobrescrita. A linha registra quem fez a alteração e quando.

Cada agendador lê o estado quando um slot vence, antes de reivindicá-lo — uma
consulta por disparo —, de modo que um job pausado não gasta seu slot, e um job
retomado em uma réplica roda no próximo slot na réplica que o reivindicar. A
recuperação na inicialização também o lê.

Se o estado não puder ser lido — a tabela ausente, o banco de dados
momentaneamente inacessível —, o agendador recorre ao `enabled` do arquivo do job
e registra um aviso. Isso é deliberado: uma execução agendada falha de forma
aberta, como quando a tabela de claims não consegue responder, porque uma tabela
quebrada não deve parar silenciosamente todos os jobs. Se a própria alteração não
puder ser salva, o `PUT` responde `503` e nenhum processo é alterado.

Sem um banco de dados SQL (MongoDB) ou com `cronPersistence: false`, não há onde
guardar o estado: uma pausa vale para o processo que a atendeu e se perde na
reinicialização.

---

## Proteção de Concorrência

Para garantir a estabilidade ao executar operações que demandam muitos recursos, o Rebase implementa um **bloqueio estrito de concorrência única** por ID de job:
- **Sobreposições Agendadas**: Se o tick agendado de um job disparar enquanto a execução anterior ainda estiver em andamento, o agendador ignora o tick e agenda imediatamente a próxima execução candidata.
- **Colisões por Disparo Manual**: Se um operador disparar manualmente um job em execução por meio do Rebase Studio ou da REST API, a requisição responde `409` com o código `CRON_JOB_ALREADY_EXECUTING`, protegendo o worker ativo. `details.log` é a entrada de descarte descrita abaixo.

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

<span class="since-badge" data-since="0.23">Since 0.23</span> O bloqueio vale entre processos, não
só dentro de um. Cada execução — agendada, manual ou de recuperação — obtém um
**lease de execução** em `rebase.cron_job_state` antes de seu handler começar, e
o libera quando a execução termina. Assim, um disparo manual a partir do processo
`api` enquanto o worker executa o job responde `409`, e um slot que vence
enquanto uma execução manual detém o lease em outro processo é ignorado. A linha
de log do descarte nomeia o processo que detém o lease.

Um lease dura o `timeoutSeconds` do job mais 30 segundos, e é isso também que
libera um job cujo processo caiu no meio de uma execução. Um job com
`timeoutSeconds: Infinity` o detém por no máximo uma hora: uma queda bloqueia
então o job por uma hora em vez de para sempre, e uma execução ainda em andamento
depois de uma hora deixa de impedir que outro processo inicie o job. Um job que
legitimamente dura horas deve informar um `timeoutSeconds` finito, que seu lease
então segue. Se o lease não puder ser obtido porque o banco de dados não
responde, a execução segue adiante com um aviso, como uma execução agendada cujo
claim não pode ser lido.
