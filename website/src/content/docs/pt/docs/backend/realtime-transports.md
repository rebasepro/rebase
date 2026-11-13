---
sourceHash: 1b7c64b3c001f57d
title: Tempo real entre instâncias
sidebar_label: Tempo real entre instâncias
description: "Como canais de broadcast e presença sobrevivem a mais de um processo de servidor: o barramento LISTEN/NOTIFY, o que cada instância possui e como escrever seu próprio transporte."
---

## Broadcasting entre instâncias e arquitetura LISTEN/NOTIFY

Para ambientes de cluster com múltiplas instâncias (por exemplo, executando dentro do Kubernetes ou em contêineres Docker atrás de um balanceador de carga), o Rebase depende do `LISTEN/NOTIFY` do PostgreSQL para sincronizar **alterações de linhas** entre instâncias. Portanto, as inscrições de tabelas e entidades abrangem instâncias sem necessidade de configuração — é isso o que esta seção descreve.

**Canais de broadcast e presença são separados** e funcionam por instância até que você ative um barramento de canais. Consulte [Canais e presença entre instâncias](#canais-e-presença-entre-instâncias) abaixo.

### Ignorando pools do pgBouncer

Como os pools de conexão como o **pgBouncer** não suportam o modelo de conexão persistente exigido para sessões SQL `LISTEN` de longa duração, o supervisor de tempo real abre um cliente Postgres dedicado e sem pool (`PgClient`) diretamente com o banco de dados. Essa conexão direta utiliza a variável de ambiente `DATABASE_DIRECT_URL`, se configurada, garantindo estabilidade e evitando o esgotamento do pool ou quedas abruptas.

### Mecânica de notificação e estrutura do payload

Com a [captura de alterações no banco de dados](/docs/backend/realtime-cdc/) ativa — o padrão onde quer que a role do banco de dados possa criar gatilhos (triggers) — cada instância escuta cada commit no canal `rebase_cdc`, e nada abaixo é enviado. Sem ela, quando um registro é modificado na Instância A, ele transmite uma notificação no canal `rebase_entity_changes`. Para minimizar a sobrecarga do banco de dados e a largura de banda da rede, o payload de notificação é mantido extremamente compacto:

```json
{
  "sid": "inst_7a9c1b",
  "p": "posts",
  "eid": "45",
  "db": null
}
```

*Nota: `sid` representa o ID de instância aleatório e exclusivo do servidor gerado na inicialização, `p` é o slug da tabela (caminho) e `eid` é o ID da entidade de destino.*

Alterações feitas no mesmo instante — uma gravação em lote anuncia cada linha que escreveu — saem juntas, em tão poucas notificações quanto couberem no limite de 8.000 bytes do NOTIFY do Postgres, cada uma listando suas alterações como triplas `[p, eid, db]`:

```json
{
  "sid": "inst_7a9c1b",
  "c": [["posts", "45", null], ["posts", "46", null]]
}
```

Uma única alteração mantém o formato acima, de modo que uma instância mais antiga ainda possa lê-la durante um rolling deploy.

- **Autofiltragem**: Ao receber uma mensagem, cada instância lê o `sid`. Se ele corresponder ao seu próprio ID de instância, o servidor descarta a notificação para evitar loops infinitos de roteamento.
- **Retransmissão e Fan-out**: Se a notificação veio de outra instância, o servidor agenda uma nova busca (refetch) com debounce para seus assinantes conectados localmente a cada alteração. Ele não lê nada no recebimento: cada frame é uma nova busca sob o próprio escopo de seu assinante.
- **Loop de reconexão do supervisor**: Se a conexão com o banco de dados cair, um supervisor de conexão em segundo plano monitora o estado e dispara uma sequência de reconexão automática após um atraso fixo de **3 segundos**, restaurando o loop de `LISTEN` sem afetar o ciclo de vida da aplicação Hono principal. Cada inscrição ativa na instância é então recarregada (refetched), porque tudo o que foi publicado enquanto a conexão estava inativa não alcançou ninguém. Se o banco de dados não puder ser alcançado na inicialização, a conexão será tentada novamente da mesma maneira.
- **Heartbeat**: Uma conexão `LISTEN` é ociosa por natureza, e um timeout de fluxo ocioso em um balanceador de carga ou NAT pode derrubá-la sem nenhum erro em ambos os lados (uma conexão half-open). Portanto, ela opera com TCP keepalive e deve responder a um `SELECT 1` a cada 30 segundos dentro de 10 segundos. Uma conexão que falhar nessa resposta é substituída conforme descrito acima. Enquanto a conexão estiver inativa, o `/health` a lista como `cross-instance`, e quando ela estiver inativa por 60 segundos, a verificação falha.

## Canais e presença entre instâncias

As alterações de linha cruzam instâncias por conta própria (acima). Canais de broadcast e presença **não**: por padrão, eles fazem fan-out apenas para os clientes conectados à instância que os recebeu.

Em uma única instância, isso é perfeito e não custa nada. Atrás de um balanceador de carga, é um bug que você não verá em desenvolvimento: dois colaboradores caem em réplicas diferentes, entram no mesmo canal e veem uma sala vazia enquanto transmitem perfeitamente entre si. Nenhum erro é disparado.

A solução é um **barramento de canais** — um transporte opcional que transporta frames de canal e presença entre instâncias:

```typescript
database: createPostgresAdapter({
    connection: db,
    schema: { tables, enums, relations },
    realtime: {
        bus: { type: "postgres" }
    }
})
```

| Barramento   | Quando usar                                                                                          |
|--------------|------------------------------------------------------------------------------------------------------|
| `memory`     | **Padrão.** Instância única. Sem entrega entre instâncias, sem sobrecarga.                           |
| `postgres`   | Duas ou mais instâncias. Usa `LISTEN/NOTIFY` no banco de dados que você já possui — nenhum novo serviço para implantar. |

O transporte também pode ser configurado por implantação com
`REALTIME_CHANNEL_BUS=memory|postgres`, podendo ser alterado sem uma recompilação.
Ele substitui um recurso integrado **nomeado** (`bus: { type: "memory" }`) e é
deliberadamente **ignorado** quando `realtime.bus` recebe uma *instância* construída de
`ChannelBus` — a variável só pode nomear transportes que este pacote
sabe como construir, portanto, honrá-la nesse cenário significaria descartar silenciosamente o
objeto fornecido pela aplicação. Esse caso registra um aviso nomeando ambos, e um
valor não reconhecido faz fallback para o que foi configurado em vez de reverter para memória.

### Por que não há uma opção com Redis inclusa

O Rebase é implantado como Postgres + backend + frontend. Um barramento que precisasse de um message broker colocaria um segundo serviço com estado (stateful) em cada `docker-compose.yml` gerado pela CLI, para um recurso que a maioria das aplicações nunca usa — portanto, o critério para adicionar um é que o banco de dados genuinamente não consiga suportar a carga.

E ele consegue. Medido em duas instâncias de backend contra um único contêiner Postgres, o barramento Postgres entregou **~10.000 mensagens entre instâncias por segundo sem perdas**, e manteve-se estável até **oito instâncias** (14.000 entregas, sem perdas). Vinte pessoas arrastando cursores a 60 fps geram cerca de 1.200 mensagens por segundo — aproximadamente um oitavo disso.

O limite que vale a pena monitorar não é a capacidade, mas o fato de que cada notificação é uma consulta ao seu banco de dados primário, competindo com as consultas reais da sua aplicação. O barramento Postgres, portanto, **agrupa (coalesces)** os frames de saída (veja abaixo), que é o que mantém esse custo proporcional ao tempo decorrido em vez da contagem de mensagens.

Por cliente, o socket aceita até **7.200 frames de canal por minuto** (120/s — 60 fps de transmissões de cursor mais a atualização de presença que cada uma carrega), contabilizados separadamente do limite compartilhado por consultas e inscrições. Frames que excederem esse limite são recusados com um erro `RATE_LIMITED` em vez de serem enfileirados.

A recusa chega em `channel.onError()`, não como um `broadcast()` rejeitado — consulte [Quando um frame de canal é recusado](/docs/backend/realtime#when-a-channel-frame-is-refused).

Se você ainda estiver no limite depois disso, limite a taxa (throttle) de eventos de cursor no cliente (o estado last-write-wins não precisa de 60 atualizações por segundo) e considere rotear os colaboradores de um documento para a mesma instância com [`affinity`](/docs/sdk/realtime#keeping-a-group-on-one-instance) — o roteamento persistente (sticky routing) reduz o tráfego entre instâncias para quase zero, independentemente da contagem de usuários. Apenas além disso vale a pena adotar outro transporte e, nesse caso, a resposta é um pacote de transporte, não um fork. Consulte [Escrevendo seu próprio transporte](#escrevendo-seu-próprio-transporte).

### Vendo o que o barramento faz

Com `REBASE_METRICS=true`, cada instância relata o que está transportando em `/metrics`:

| Métrica | Tipo | Significado |
|---------|------|-------------|
| `rebase_realtime_sockets` | gauge | Sockets abertos nesta instância |
| `rebase_realtime_channels` | gauge | Canais com um membro nesta instância |
| `rebase_realtime_bus_frames_published_total` | counter | Frames que esta instância enviou para o barramento, por `kind`: `broadcast`, `broadcast_ref`, `presence_diff` e `channels`, as instâncias informando umas às outras o que atendem |
| `rebase_realtime_bus_frames_skipped_total` | counter | Transmissões e alterações de presença não enviadas porque nenhuma outra instância tinha membros no canal |

Os contadores iniciam do zero junto com a instância e contam frames, dos quais o barramento pode agrupar vários em uma única notificação. Mensagens retidas sempre trafegam, portanto nunca são ignoradas. No barramento `memory` padrão, ambos permanecem em zero.

Colete métricas (scrape) de cada instância em vez de um balanceador de carga à frente delas: os números são por processo. Um grupo que permanece em uma única instância é exibido com o `skipped` aumentando enquanto `broadcast` e `presence_diff` permanecem estáveis, e os sockets distribuem-se entre as instâncias. Broadcasts que aumentam em todas as instâncias significam que os canais se estendem por elas. No Rebase Cloud, `rebase cloud metrics` mostra as mesmas contagens por instância.

### Coalescing

Frames publicados enquanto uma janela curta está aberta saem juntos em uma única notificação. A janela é de **borda de subida (leading-edge)**: um frame que chega quando nenhuma janela está aberta é enviado imediatamente, de modo que um canal ocioso não sofre latência adicional e apenas um fluxo sustentado é agrupado em lotes.

Medido em duas instâncias, 3.000 broadcasts, todos entregues em todos os casos:

| Perfil de tráfego | Coalescing desativado | Coalescing ativado | Redução |
|---|---|---|---|
| Burst (o mais rápido possível) | 3.000 consultas | 68 consultas | **44×** |
| Ritmo constante (~500 msg/s, distribuído) | 3.000 consultas | 240 consultas | **12,5×** |

O caso de burst também terminou cerca de 11× mais rápido em tempo real decorrido, porque os round-trips ao banco de dados eram o gargalo, e não o processamento em si.

A janela tem como padrão 10 ms e não é uma configuração sensível — 5 ms, 10 ms e 20 ms produziram contagens de consultas idênticas em ambos os perfis, porque um lote é limitado pelo teto de payload de 8 KB ou pelo perfil natural do tráfego bem antes de o temporizador importar. Altere isso apenas se tiver um motivo:

```typescript
realtime: {
    bus: { type: "postgres", batchWindowMs: 20 }   // 0 disables coalescing
}
```

Uma observação de implantação: um lote trafega em um formato de rede diferente de um frame individual, e uma instância executando uma versão mais antiga não o compreenderá. Frames individuais são sempre enviados desencapsulados, portanto, um rolling deploy só corre o risco de perder frames se o cluster estiver sob carga constante *durante* a reinicialização — e canais retidos se reparam por meio da reprodução do histórico independentemente disso.

## Escrevendo seu próprio transporte

`realtime.bus` aceita qualquer objeto que implemente a interface `ChannelBus`, de modo que um transporte pode ser distribuído como seu próprio pacote — `@rebasepro/types` declara o contrato, e nada mais é necessário para implementá-lo:

```typescript
import type { ChannelBus, ChannelBusFrame, ChannelBusHandler } from "@rebasepro/types";

export class MyChannelBus implements ChannelBus {
    readonly kind = "my-transport";
    readonly maxFrameBytes = Infinity;

    async start(handler: ChannelBusHandler): Promise<void> {
        // Connect. Reject if you cannot — the caller falls back to in-process
        // delivery, which is far better than a cluster that believes it is
        // connected and silently is not.
    }

    async publish(frame: ChannelBusFrame): Promise<void> {
        // Reach every other instance, or reject.
    }

    async stop(): Promise<void> {
        // Idempotent; release anything holding the event loop open.
    }
}
```

Passe a instância onde iria um nome integrado:

```typescript
database: createPostgresAdapter({
    connection: db,
    schema: { tables, enums, relations },
    realtime: { bus: new MyChannelBus(process.env.MY_TRANSPORT_URL!) }
})
```

**O que sua implementação deve garantir:** `start()` rejeita quando o transporte for inutilizável; `publish()` alcança todas as outras instâncias ou rejeita; `stop()` é idempotente; e uma mensagem malformada é descartada e registrada em log em vez de lançar um erro, para que um frame defeituoso não derrube o listener.

**O que ela não precisa garantir:** ordenação (canais retidos carregam `seq` e o SDK ordena por ele), durabilidade (um frame perdido é uma atualização ao vivo perdida, reparada pela reprodução do histórico do cliente) ou entrega exatamente uma vez (frames retidos são desduplicados por `seq`; diffs de presença são idempotentes).

`maxFrameBytes` é como o framework sabe se deve enviar uma mensagem retida grande inline ou como um ponteiro. Retorne `Infinity` quando seu transporte não tiver um teto significativo, para que o caminho de ponteiro nunca seja utilizado desnecessariamente.

A entrega aos clientes locais não é sua preocupação — o serviço de tempo real é o responsável por definir quais assinantes recebem um frame. Um transporte apenas move frames entre instâncias.

### O limite de 8 KB no barramento Postgres

`pg_notify` recusa um payload de 8.000 bytes ou mais. Cursores e presença cabem com folga; um snapshot de documento não. O Rebase lida com isso da mesma forma que lida com grandes alterações de entidade — enviando um endereço em vez de um corpo:

- **Em um canal retido** (consulte [Retenção de canais](/docs/backend/realtime#channel-retention)), a mensagem já está armazenada com um número de sequência, portanto a notificação transporta apenas `(channel, seq)` e cada instância de recebimento lê o corpo de volta. Não há limite de tamanho. Isso se aplica a todas as mensagens retidas, pequenas ou grandes: qualquer login no banco de dados pode executar `LISTEN`, de modo que o corpo nunca trafega na notificação. Isso custa uma leitura de chave primária por mensagem em cada instância com um membro no canal.
- **Transmissões efêmeras e presença** ainda trafegam na própria notificação, portanto qualquer login no banco de dados pode lê-las. Coloque qualquer coisa que não deva ser legível dessa forma em um canal retido.
- **Em um canal efêmero** não há nada para o que apontar. A transmissão é entregue localmente, o remetente recebe um erro `CHANNEL_BUS_PAYLOAD_TOO_LARGE` em `channel.onError()`, e um aviso indica o nome do canal — em vez de a mensagem atingir silenciosamente apenas metade do cluster.

Se você transmite mensagens grandes, dê a esse canal uma regra de retenção. Essa é a solução completa.

### Presença é estado compartilhado, não apenas fan-out

`presence_state` precisa responder "quem está neste canal?" para todo o cluster, o que a memória por instância não consegue fazer. Quando um barramento está ativo, o Rebase mantém a lista (roster) em `rebase.channel_presence` (criada automaticamente) e responde às requisições de lista a partir dela.

| Coluna        | Conteúdo                                       |
|---------------|------------------------------------------------|
| `channel`     | Nome do canal                                  |
| `client_id`   | O cliente rastreado                            |
| `instance_id` | A qual instância de backend ele está conectado |
| `state`       | O estado de presença do cliente                |
| `last_seen`   | Atualizado pelo heartbeat de presença do SDK   |

O SDK envia heartbeats de presença a cada ~20 segundos contra um timeout de 30 segundos. Linhas que param de ser atualizadas são eliminadas, e as saídas são anunciadas para todas as instâncias — o que também funciona como recuperação de falhas: um pod que morre deixa linhas para trás que parecem, após uma janela de timeout, exatamente como qualquer outro cliente que ficou inativo. Um encerramento gracioso (graceful shutdown) limpa suas próprias linhas imediatamente, para que um rolling deploy não exiba uma janela de 'fantasmas'.

:::caution[The LISTEN connection must bypass your pooler]
`LISTEN` é um estado de sessão, portanto o barramento Postgres precisa de uma conexão direta — e não do pgBouncer ou de qualquer pooler em modo de transação. O Rebase usa `DATABASE_DIRECT_URL` quando configurado; atrás de um pooler, aponte-o diretamente para o serviço de banco de dados. Sem uma URL direta utilizável, o barramento registra um aviso e permanece no modo de memória.
:::

## Próximos passos

- [Realtime & WebSocket](/docs/backend/realtime/) — inscrições, canais e presença em uma única instância
- [Processos divididos](/docs/deployment/split-processes/) — o modelo de implantação para o qual isso é relevante
- [Auto-hospedagem](/docs/deployment/self-hosting/) — executando o runtime você mesmo
