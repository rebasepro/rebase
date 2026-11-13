---
sourceHash: 5f05a6b3c8a0e4b3
title: Captura de alterações do banco de dados
sidebar_label: Captura de alterações do banco de dados
description: "Eventos em tempo real para cada gravação com commit, independentemente de como foi feita: os triggers de captura, a configuração REALTIME_CDC e o que eles precisam."
---

**O Change Data Capture está ativado por padrão.** O Rebase captura alterações no banco de dados e emite eventos em tempo real para **cada gravação com commit, independentemente de como foi feita** — REST, SDK, Studio, `psql`, um cron job em outro serviço, Drizzle/SQL puro ou o **editor SQL** do Studio. Este é o mesmo modelo do Supabase Realtime seguindo o write-ahead log.

Nenhuma configuração é necessária. Em uma conexão de banco de dados que a suporta, o CDC se autoprovisiona na inicialização; em uma que não suporta (por exemplo, uma role restrita que não pode criar triggers), o Rebase silenciosamente usa o realtime no nível da aplicação — nada para ativar, nada que quebre.

## Configuração

O CDC é controlado pela variável de ambiente `REALTIME_CDC`:

| Valor | Comportamento |
| --- | --- |
| `auto` *(padrão)* | Habilita a captura em nível de banco de dados onde a conexão suportar; **recorre silenciosamente (fallback)** para o realtime em nível de aplicação caso contrário. Zero configuração. |
| `trigger` | Força a captura baseada em triggers. Funciona em qualquer PostgreSQL, incluindo instâncias gerenciadas sem replicação lógica. Emite um aviso (em vez de recorrer silenciosamente ao fallback) se não conseguir provisionar. |
| `wal` | Lê alterações do write-ahead log por meio de replicação lógica em vez de triggers, de modo que uma gravação não executa nenhum trigger e não envia `NOTIFY`. Requer `wal_level=logical` e uma role com permissão de replicação; recorre a `trigger`, com um aviso, quando qualquer um estiver ausente. Consulte [Captura a partir do WAL](#captura-a-partir-do-wal). |
| `off` | Apenas realtime em nível de aplicação. Use isso para evitar a sobrecarga de triggers por gravação em cargas de trabalho intensivas em escrita. Uma inicialização com `off` que possui o esquema também **remove** os triggers e funções de captura instalados por uma inicialização anterior e registra quantos removeu; desative essa opção e a próxima inicialização os instalará novamente. |

A mesma configuração é a opção `realtime.cdc` do adaptador Postgres, para um servidor que a configura no código. `REALTIME_CDC`, quando definida, tem precedência.

Na inicialização, você verá uma linha de log indicando o modo ativo, por exemplo:

```
📡 [CDC] Realtime source = database-level change capture (mode: trigger).
   All writes now emit realtime events regardless of origin.
```

Se a conexão não puder suportá-lo, `auto` registra uma linha informativa e continua com o realtime em nível de aplicação:

```
ℹ️ [CDC] Database-level change capture unavailable (likely insufficient
   privileges to create triggers…) — using app-level realtime.
```

## Como funciona

1. **Autoprovisionamento** — Na inicialização (contexto de servidor/proprietário), o Rebase instala triggers idempotentes `AFTER INSERT/UPDATE/DELETE/TRUNCATE` em cada tabela gerenciada. Eles são disparados uma vez por instrução e emitem notificações de alteração no canal `rebase_cdc` que identificam as linhas alteradas por sua chave — a chave primária, mais as duas colunas de ID para uma tabela de junção muitos-para-muitos — e não carregam **nenhuma outra coluna**. Uma instrução que alterou muitas linhas as identifica em lotes de cerca de mil chaves, de modo que um `UPDATE` de 1M de linhas envia cerca de 1.000 notificações em vez de um milhão; uma instrução que alterou uma linha envia uma notificação, e uma que não alterou nenhuma não envia nada. Um `TRUNCATE` é anunciado como uma alteração em todas as linhas da tabela. Uma tabela particionada mantém um trigger por linha, porque o PostgreSQL copia um trigger de linha para cada partição e uma gravação feita diretamente em uma partição ainda é detectada. O PostgreSQL não impõe privilégios no `LISTEN`, portanto qualquer role que possa se conectar ao banco de dados pode ler esse canal; ela descobre quais chaves foram alteradas, nunca o conteúdo que elas contêm. Uma chave grande demais para o limite de 8&nbsp;KB do `NOTIFY` do PostgreSQL é enviada sem chave (uma alteração em toda a tabela, o que faz com que cada assinatura de lista e de linha única nela busque os dados novamente), garantindo que o CDC nunca aborte a gravação que disparou o trigger. As funções são substituídas a cada inicialização que provisiona, de modo que um banco de dados instrumentado por uma versão mais antiga — cujo trigger enviava linhas inteiras — é atualizado na próxima inicialização; uma inicialização com `REALTIME_CDC=off` as remove.

   **Atualização.** Um banco de dados instrumentado por uma versão anterior ao suporte a lotes possui um trigger por linha; a primeira inicialização de uma versão mais recente o substitui pelos triggers por instrução. Durante 24 horas após isso, os novos triggers ainda enviam uma notificação por linha, como os antigos faziam, para que instâncias da versão mais antiga ainda em execução durante um deploy contínuo (rolling deploy) ou após um rollback recebam cada linha. Após essa janela, eles passam a processar em lotes. Todas as versões com suporte a lotes leem ambos os formatos.
2. **Captura** — Um cliente `LISTEN` dedicado e sem pool por instância consome o `rebase_cdc`, mapeia a tabela alterada de volta para a tabela que atende e envia a alteração para o mesmo pipeline do `RealtimeService` usado pelas mutações da API. Assim como o listener entre instâncias, ele prefere `DATABASE_DIRECT_URL` e se reconecta automaticamente.
3. **Entrega segura em relação ao RLS** — A linha bruta do fluxo de alterações **nunca** é encaminhada aos assinantes. A alteração é marcada como invalidada e cada assinatura relê a linha sob seu **próprio** contexto de autenticação. A filtragem é, portanto, por assinante, nunca por publicador: um cliente só recebe linhas permitidas por suas políticas de RLS.
4. **Entre instâncias** — Como cada instância observa cada commit por meio do fluxo de alterações, o CDC também *é* o canal entre instâncias; a transmissão legada por mutação `rebase_entity_changes` não é usada enquanto o CDC estiver ativo.
5. **Deduplicação** — Uma mutação feita por meio da API do Rebase agenda uma nova busca (refetch) para os assinantes locais no instante em que é confirmada (commit) e também é ecoada de volta pelo fluxo de alterações. A instância de origem suprime um eco que chegue dentro da janela de debounce de refetch (um registro de curta duração de suas próprias emissões), portanto uma gravação via API normalmente produz um único frame. Um eco que chegue depois disso dispara mais uma nova busca, que entrega as mesmas linhas novamente: inofensivo, mas um assinante pode ver um frame idêntico duas vezes.

## Captura a partir do WAL

`REALTIME_CDC=wal` lê alterações do write-ahead log do PostgreSQL por meio de replicação lógica (o plugin nativo `pgoutput`) em vez de triggers. Dessa forma, uma gravação não executa triggers e não envia `NOTIFY`, o que é importante quando as gravações são concorrentes: uma transação que chamou `NOTIFY` obtém um bloqueio (lock) em todo o servidor no momento do commit e o mantém durante a gravação em disco (disk flush), portanto, na captura por trigger, esses commits acontecem um de cada vez. Medido no PostgreSQL 18 com 32 gravadores concorrentes e um flush de disco de 1&nbsp;ms, a captura por trigger limitou as inserções a cerca de um décimo da taxa que a captura por WAL atingiu.

É necessário:

- `wal_level = logical` no servidor, o que exige uma reinicialização. No Amazon RDS, defina `rds.logical_replication = 1`; no Cloud SQL, `cloudsql.logical_decoding = on`.
- Uma role que possa replicar: `ALTER ROLE <role> REPLICATION`, ou o equivalente do provedor (no RDS, associação a `rds_replication`).
- Um slot de replicação e WAL sender livres por instância de servidor (`max_replication_slots` e `max_wal_senders`, ambos 10 por padrão).
- Uma conexão direta (`DATABASE_DIRECT_URL`): um pooler não suporta o protocolo de replicação.

Quando qualquer um desses requisitos estiver ausente, a inicialização registra o motivo no log e usa a captura por trigger.

O que uma inicialização faz:

- Cria uma publicação chamada `rebase_cdc` e adiciona a ela cada tabela atendida e cada tabela de junção muitos-para-muitos. As tabelas são apenas adicionadas, de modo que uma versão mais antiga ainda em execução durante um deploy contínuo não pode remover a tabela de uma versão mais nova.
- Uma tabela sem chave primária, ou com `REPLICA IDENTITY NOTHING`, é deixada de fora com um aviso: o PostgreSQL recusa `UPDATE` e `DELETE` em uma tabela publicada que não pode indicar qual linha foi alterada. Gravações feitas nela fora do Rebase não são capturadas.
- Cada instância consome o fluxo da publicação por meio de seu próprio slot de replicação **temporário**, que o PostgreSQL descarta quando a conexão é fechada, evitando que uma instância com falha deixe um slot para trás retendo o WAL até que o disco encha. Uma reconexão inicia um novo slot, e cada assinatura busca os dados novamente, já que o que foi confirmado no intervalo não é reproduzido.
- Assim que o fluxo é aberto, uma inicialização que tanto provisiona quanto consome remove os triggers de captura, assim como o modo `off` faz. Durante um deploy contínuo migrando da captura por trigger, as instâncias que ainda a executam param de receber gravações feitas em outros lugares até serem substituídas; suas próprias gravações ainda chegam aos seus assinantes. Um processo que apenas provisiona, como o job de migração de uma [implantação dividida](/docs/deployment/split-processes/), mantém os triggers para consumidores que não conseguem fazer streaming e recorrem ao fallback para eles.

Os gravadores mantêm sua velocidade máxima sob rajadas, mas um WAL sender decodifica cada slot, portanto, acima de vários milhares de gravações por segundo sustentadas, os eventos podem chegar com atraso. Uma role com `REPLICATION` pode ler todas as linhas de uma tabela publicada por meio de um slot próprio; o fluxo permanece dentro do servidor, e os assinantes ainda relêem cada linha sob seu próprio RLS.

## Requisitos e observações

- O CDC requer uma string de conexão direta (`DATABASE_DIRECT_URL`, a opção `directConnectionString` do adaptador ou a conexão primária) para o cliente `LISTEN` — poolers de conexão em modo de transação não suportam sessões de `LISTEN` de longa duração.
- Os triggers são instalados apenas nas tabelas atendidas pelo backend e nas tabelas de junção de seus relacionamentos muitos-para-muitos. Gravações em tabelas não mapeadas são ignoradas.
- Uma tabela atendida que ainda não foi criada é ignorada com um aviso, em vez de bloquear o CDC para as demais.

## Próximos passos

- [Realtime e WebSocket](/docs/backend/realtime) — assinaturas, canais e presença, que são alimentados por esses eventos.
- [Realtime entre instâncias](/docs/backend/realtime-transports) — o barramento que transporta alterações entre processos do servidor.
