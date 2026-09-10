---
sourceHash: 8b0308f7ee06d77a
title: Tempo real entre instâncias
sidebar_label: Tempo real entre instâncias
description:"\"Como canais de broadcast e presença sobrevivem a mais de um processo de servidor: o barramento LISTEN/NOTIFY, o que pertence a cada instância e como escrever seu próprio transporte.\""
---

## Transmissão entre instâncias e arquitetura LISTEN/NOTIFY

Para ambientes de cluster com múltiplas instâncias (por exemplo, executando dentro do Kubernetes ou contêineres Docker atrás de um balanceador de carga), o Rebase depende do `LISTEN/NOTIFY` do PostgreSQL para sincronizar **alterações de linhas** entre instâncias. Assinaturas de coleções e entidades, portanto, abrangem instâncias sem nenhuma configuração — é isso que esta seção descreve.

**Canais de broadcast e presença são separados** e funcionam por instância até que você ative um barramento de canais. Consulte [Canais e presença entre instâncias](#channels-and-presence-across-instances) abaixo.

### Ignorando pools do pgBouncer

Como poolers de conexão como o **pgBouncer** não suportam o modelo de conexão persistente necessário para sessões SQL `LISTEN` de longa duração, o supervisor de tempo real abre um cliente Postgres dedicado e sem pool (`PgClient`) diretamente com o banco de dados. Essa conexão direta utiliza a variável de ambiente `DATABASE_DIRECT_URL`, se configurada, garantindo estabilidade e evitando o esgotamento do pool ou quedas abruptas.

### Mecânica de notificação e estrutura do payload

Quando um registro é modificado na Instância A, ele transmite uma notificação no canal `rebase_entity_changes`. Para minimizar a sobrecarga do banco de dados e a largura de banda da rede, o payload da notificação é mantido extremamente compacto:

```json
{
  "sid": "inst_7a9c1b",
  "p": "posts",
  "eid": "45",
  "db": null
}
```

*Nota: `sid` representa o ID aleatório exclusivo da instância do servidor gerado na inicialização, `p` é o slug da coleção (caminho) e `eid` é o ID da entidade de destino.*

- **Autofiltragem**: Ao receber uma mensagem, cada instância lê o `sid`. Se ele coincidir com o seu próprio ID de instância, o servidor descarta a notificação para evitar loops infinitos de roteamento.
- **Retransmissão e Fan-out**: Se a notificação veio de outra instância, o servidor agenda uma nova busca com debounce e retransmite a atualização para seus assinantes WebSocket conectados localmente.
- **Loop de reconexão do supervisor**: Se a conexão com o banco de dados cair, um supervisor de conexão em segundo plano monitora o estado e dispara uma sequência de reconexão automática após um atraso fixo de **3 segundos**, restaurando o loop do `LISTEN` sem afetar o ciclo de vida principal da aplicação Hono.

## Canais e presença entre instâncias

Alterações de linha cruzam instâncias por conta própria (acima). Canais de broadcast e presença **não**: por padrão, eles são distribuídos apenas para os clientes conectados à instância que os recebeu.

Em uma única instância, isso é perfeito e não custa nada. Atrás de um balanceador de carga, é um bug que você não verá no desenvolvimento: dois colaboradores caem em réplicas diferentes, entram no mesmo canal e veem uma sala vazia enquanto transmitem perfeitamente um para o outro. Nenhum erro é disparado.

A solução é um **barramento de canal** — um transporte opcional que transmite frames de canais e presença entre instâncias:

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

O transporte também pode ser definido por implantação com
`REALTIME_CHANNEL_BUS=memory|postgres`, para que possa ser alterado sem a necessidade de um rebuild.
Ele substitui um built-in **nomeado** (`bus: { type: "memory" }`) e é
deliberadamente **ignorado** quando uma *instância* construída de `ChannelBus`
for passada para `realtime.bus` — a variável só pode nomear transportes que este pacote
sabe como construir, portanto, honrá-la nesse caso significaria descartar silenciosamente o
objeto fornecido pela aplicação. Esse caso registra um aviso nomeando ambos, e um
valor não reconhecido volta para o que foi configurado em vez de reverter para memória.

### Por que não há uma opção com Redis nativa

O Rebase é implantado como Postgres + backend + frontend. Um barramento que precisasse de um message broker colocaria um segundo serviço com estado em cada `docker-compose.yml` que a CLI gera, para um recurso que a maioria das aplicações nunca usa — portanto, o critério para adicionar um é que o banco de dados genuinamente não consiga suportar a carga.

E ele consegue. Medido em duas instâncias de backend contra um único contêiner Postgres, o barramento Postgres entregou **~10.000 mensagens entre instâncias por segundo sem perdas**, e se manteve estável até **oito instâncias** (14.000 entregas, sem perdas). Vinte pessoas arrastando cursores a 60 fps geram cerca de 1.200 mensagens por segundo — aproximadamente um oitavo disso.

O limite que vale a pena monitorar não é a capacidade, mas o fato de que cada notificação é uma consulta ao seu banco de dados primário, competindo com as consultas reais da sua aplicação. O barramento Postgres, portanto, **coalesce** (agrupa) frames de saída (veja abaixo), que é o que mantém esse custo proporcional ao tempo decorrido em vez da contagem de mensagens.

Por cliente, o socket aceita até **7.200 frames de canal por minuto** (120/s — 60 fps de transmissões de cursor mais a atualização de presença que cada uma carrega), contados separadamente do orçamento que as consultas e assinaturas compartilham. Frames que excedem esse limite são recusados com um erro `RATE_LIMITED` em vez de serem enfileirados.

A recusa chega em `channel.onError()`, e não como um `broadcast()` rejeitado — consulte [Quando um frame de canal é recusado](#when-a-channel-frame-is-refused).

Se ainda assim você estiver atingindo o limite, aplique throttle nos eventos do tipo cursor no cliente (o estado last-write-wins não precisa de 60 atualizações por segundo) e considere rotear os colaboradores de um documento para a mesma instância — o roteamento persistente (sticky routing) reduz o tráfego entre instâncias a quase nada, independentemente da contagem de usuários. Somente além desse ponto outro transporte passa a valer a pena, e então a resposta é um pacote de transporte, não um fork. Consulte [Escrevendo seu próprio transporte](#writing-your-own-transport).

### Coalescência

Frames publicados enquanto uma janela curta está aberta saem juntos em uma única notificação. A janela é do tipo **leading-edge**: um frame que chega quando nenhuma janela está aberta é enviado imediatamente, portanto um canal ocioso não sofre latência adicional e apenas fluxos sustentados são agrupados em lote.

Medido em duas instâncias, 3.000 broadcasts, todos entregues em todos os casos:

| Perfil de tráfego | Coalescência desativada | Coalescência ativada | Redução |
|---|---|---|---|
| Burst (o mais rápido possível) | 3.000 consultas | 68 consultas | **44×** |
| Compassado (~500 msg/s, distribuído) | 3.000 consultas | 240 consultas | **12,5×** |

O caso de burst também terminou ~11× mais rápido em tempo real decorrido (wall-clock), porque as viagens de ida e volta (round-trips) ao banco de dados eram o gargalo, e não o processamento em si.

A janela tem como padrão 10 ms e não é uma configuração sensível — 5 ms, 10 ms e 20 ms produziram contagens de consulta idênticas em ambos os perfis, porque um lote é limitado pelo teto de payload de 8 KB ou pelo padrão natural do tráfego bem antes de o temporizador fazer diferença. Altere isso apenas se tiver um motivo:

```typescript
realtime: {
    bus: { type: "postgres", batchWindowMs: 20 }   // 0 disables coalescing
}
```

Uma observação sobre a implantação: um lote viaja em um formato de rede diferente de um frame único, e uma instância executando uma versão mais antiga não o compreenderá. Frames individuais são sempre enviados desencapsulados, portanto um rolling deploy só corre o risco de perder frames se o cluster estiver sob carga sustentada *durante* a reinicialização — e canais retidos se reparam por meio de replay de histórico de qualquer forma.

## Escrevendo seu próprio transporte

`realtime.bus` aceita qualquer objeto que implemente a interface `ChannelBus`, permitindo que um transporte seja distribuído como seu próprio pacote — `@rebasepro/types` declara o contrato e nada mais é necessário para implementá-lo:

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

Passe a instância no lugar onde iria o nome nativo:

```typescript
database: createPostgresAdapter({
    connection: db,
    schema: { tables, enums, relations },
    realtime: { bus: new MyChannelBus(process.env.MY_TRANSPORT_URL!) }
})
```

**O que a sua implementação deve garantir:** `start()` rejeita quando o transporte estiver inutilizável; `publish()` alcança todas as outras instâncias ou rejeita; `stop()` é idempotente; e uma mensagem malformada é descartada e registrada em log em vez de lançar um erro, para que um frame corrompido não derrube o listener.

**O que ela não precisa garantir:** ordenação (canais retidos trazem `seq` e o SDK ordena por ele), durabilidade (um frame perdido é apenas uma atualização ao vivo perdida, reparada pelo replay do histórico do cliente) ou entrega exatamente uma vez (frames retidos são desduplicados por `seq`; diffs de presença são idempotentes).

`maxFrameBytes` é como o framework sabe se deve enviar uma mensagem retida grande inline ou como um ponteiro. Retorne `Infinity` quando seu transporte não tiver um teto significativo, para que o caminho de ponteiro nunca seja utilizado desnecessariamente.

A entrega aos clientes locais não é sua preocupação — o serviço de tempo real é o responsável por decidir quais assinantes recebem um frame. Um transporte apenas move frames entre instâncias.

### O limite de 8 KB no barramento Postgres

O `pg_notify` recusa um payload de 8.000 bytes ou mais. Cursores e presença cabem com folga; o snapshot de um documento não. O Rebase lida com isso da mesma forma que lida com grandes alterações de entidade — enviando um endereço em vez de um corpo:

- **Em um canal retido** (consulte [Retenção de canais](#channel-retention)), a mensagem já está armazenada com um número de sequência, portanto a notificação carrega apenas `(channel, seq)` e cada instância receptora lê o corpo de volta. Não há nenhum limite de tamanho.
- **Em um canal efêmero**, não há nada para o que apontar. O broadcast é entregue localmente, o remetente recebe um erro `CHANNEL_BUS_PAYLOAD_TOO_LARGE` em `channel.onError()`, e um aviso informa o nome do canal — em vez de a mensagem alcançar silenciosamente apenas metade do cluster.

Se você transmite mensagens grandes, atribua uma regra de retenção a esse canal. Essa é toda a solução.

### Presença é estado compartilhado, não apenas fan-out

`presence_state` precisa responder "quem está neste canal?" para todo o cluster, o que a memória isolada por instância não consegue fazer. Quando um barramento está ativo, o Rebase mantém a lista em `rebase.channel_presence` (criada automaticamente) e responde às solicitações de lista a partir dela.

| Coluna        | Conteúdo                                       |
|---------------|------------------------------------------------|
| `channel`     | Nome do canal                                  |
| `client_id`   | O cliente monitorado                           |
| `instance_id` | A qual instância de backend ele está conectado |
| `state`       | O estado de presença do cliente                |
| `last_seen`   | Atualizado pelo heartbeat de presença do SDK   |

O SDK envia heartbeats de presença a cada ~20 segundos contra um timeout de 30 segundos. Linhas que deixam de ser atualizadas são limpas e as saídas são anunciadas para todas as instâncias — o que também funciona como recuperação de falhas: um pod que morre deixa para trás linhas que, após uma janela de timeout, se parecem exatamente com qualquer outro cliente que ficou inativo. Um encerramento gracioso (graceful shutdown) limpa suas próprias linhas imediatamente, de modo que um rolling deploy não exiba uma janela de clientes "fantasmas".

:::caution[A conexão LISTEN deve contornar o seu pooler]
`LISTEN` é um estado de sessão, portanto o barramento Postgres precisa de uma conexão direta — não do pgBouncer ou de qualquer pooler em modo de transação. O Rebase usa `DATABASE_DIRECT_URL` quando ela estiver definida; atrás de um pooler, aponte-a diretamente para o serviço de banco de dados. Sem uma URL direta utilizável, o barramento registra um aviso e permanece no modo de memória.
:::

## Próximos passos

- [Realtime & WebSocket](/docs/backend/realtime/) — assinaturas, canais e presença em uma única instância
- [Split Processes](/docs/deployment/split-processes/) — o modelo de implantação para o qual isso é relevante
- [Self-hosting](/docs/deployment/self-hosting/) — executando o runtime você mesmo

---
