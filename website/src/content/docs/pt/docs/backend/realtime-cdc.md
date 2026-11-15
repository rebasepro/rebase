---
sourceHash: a04d0760ffb715cb
title: Captura de alterações do banco de dados
sidebar_label: Captura de alterações do banco de dados
description: "Eventos em tempo real para cada gravação confirmada, independentemente de como foi feita: os gatilhos de captura, a configuração REALTIME_CDC e o que eles precisam."
---

**O Change Data Capture está ativado por padrão.** O Rebase captura alterações no banco de dados e emite eventos em tempo real para **cada gravação confirmada, independentemente de como foi feita** — REST, SDK, Studio, `psql`, um cron job em outro serviço, Drizzle/SQL puro ou o **editor SQL** do Studio. Este é o mesmo modelo do Supabase Realtime acompanhando o write-ahead log.

Nenhuma configuração é necessária. Em uma conexão de banco de dados compatível, o CDC é provisionado automaticamente na inicialização; em uma que não seja (por exemplo, uma role restrita que não pode criar triggers), o Rebase utiliza silenciosamente o realtime em nível de aplicação — nada para ativar, nada que quebre.

## Configuração

O CDC é controlado pela variável de ambiente `REALTIME_CDC`:

| Valor | Comportamento |
| --- | --- |
| `auto` *(padrão)* | Lê as alterações do WAL quando o banco de dados permitir; caso contrário, usa os triggers de captura; se não, recorre ao realtime em nível de aplicação como fallback. Cada fallback é uma linha de log informativa, não um aviso. Zero configuração. Consulte [Captura a partir do WAL](#captura-a-partir-do-wal). |
| `trigger` | Força a captura baseada em triggers. Funciona em qualquer PostgreSQL, incluindo instâncias gerenciadas sem replicação lógica. Emite um aviso (em vez de fazer fallback silencioso) se não conseguir provisionar. |
| `wal` | Lê as alterações do write-ahead log por meio de replicação lógica em vez de triggers, para que uma gravação não execute nenhum trigger e não envie nenhum `NOTIFY`. Requer `wal_level=logical` e uma role com permissão de replicação; recorre a `trigger`, com um aviso, caso algum deles esteja ausente. Consulte [Captura a partir do WAL](#captura-a-partir-do-wal). |
| `off` | Apenas realtime em nível de aplicação. Use isso para evitar a sobrecarga de triggers por gravação em cargas de trabalho com muitas gravações. Uma inicialização com `off` que seja proprietária do schema também **remove** os triggers e funções de captura instalados por uma inicialização anterior e registra quantos removeu; remova a definição da variável e a próxima inicialização os instalará novamente. |

A mesma configuração é a opção `realtime.cdc` do adaptador Postgres, para um servidor que a configura em código. `REALTIME_CDC`, quando definida, tem precedência.

Na inicialização, você verá uma linha de log indicando o modo ativo, por exemplo:

```
📡 [CDC] Realtime source = database-level change capture (mode: trigger).
   All writes now emit realtime events regardless of origin.
```

Se a conexão não puder suportá-lo, o modo `auto` registrará uma linha informativa e continuará com o realtime em nível de aplicação:

```
ℹ️ [CDC] Database-level change capture unavailable (likely insufficient
   privileges to create triggers…) — using app-level realtime.
```

## Como funciona

1. **Autoprovisionamento** — Na inicialização (contexto de servidor/proprietário), o Rebase instala triggers idempotentes de `AFTER INSERT/UPDATE/DELETE/TRUNCATE` em cada tabela gerenciada. Eles disparam uma vez por instrução e emitem notificações de alteração no canal `rebase_cdc` que identificam as linhas alteradas por sua chave — a chave primária, mais as duas colunas de id para uma tabela de junção muitos-para-muitos — e **nenhuma outra coluna**. Uma instrução que alterou muitas linhas as identifica em lotes de cerca de mil chaves, de modo que um `UPDATE` de 1 milhão de linhas envia cerca de 1.000 notificações em vez de um milhão; uma instrução que alterou uma linha envia uma notificação, e uma que não alterou nenhuma não envia nada. Um `TRUNCATE` é anunciado como uma alteração em todas as linhas da tabela. Uma tabela particionada mantém um trigger por linha, porque o PostgreSQL copia um trigger de linha em cada partição e uma gravação feita diretamente em uma partição ainda é detectada. O PostgreSQL não impõe privilégios no `LISTEN`, portanto qualquer role que possa se conectar ao banco de dados pode ler este canal; ela descobre quais chaves foram alteradas, mas nunca o conteúdo delas. Uma chave grande demais para o limite de 8&nbsp;KB do `NOTIFY` do PostgreSQL é enviada sem chave (uma alteração em toda a tabela, o que faz com que cada assinatura de lista e de linha única nela busque os dados novamente), para que o CDC nunca aborte a gravação que disparou o evento. As funções são substituídas a cada inicialização que provisiona, de modo que um banco de dados instrumentado por uma versão mais antiga — cujo trigger enviava linhas inteiras — é atualizado na próxima inicialização; uma inicialização com `REALTIME_CDC=off`, por sua vez, os remove.

   **Atualização.** Um banco de dados instrumentado por uma versão anterior ao suporte a lotes possui um trigger por linha; a primeira inicialização de uma versão mais recente o substitui pelos triggers por instrução. Por 24 horas após isso, os novos triggers ainda enviam uma notificação por linha, como os antigos faziam, para que instâncias da versão mais antiga ainda em execução durante um rolling deploy (ou após um rollback) recebam todas as linhas. Após essa janela, eles passam a agrupar em lotes. Todas as versões com suporte a lotes conseguem ler ambos os formatos.
2. **Captura** — Um cliente `LISTEN` dedicado e sem pool por instância consome o `rebase_cdc`, mapeia a tabela alterada de volta para a tabela que ela atende e envia a alteração para o mesmo pipeline de `RealtimeService` usado por mutações de API. Assim como o ouvinte entre instâncias, ele prioriza a `DATABASE_DIRECT_URL` e se reconecta automaticamente.
3. **Entrega segura com RLS** — A linha bruta do fluxo de alterações **nunca** é encaminhada aos assinantes. A alteração é marcada como invalidada, e cada assinatura lê a linha novamente sob seu **próprio** contexto de autenticação. A filtragem é, portanto, por assinante, nunca por publicador: um cliente recebe apenas as linhas permitidas por suas políticas de RLS.
4. **Entre instâncias** — Como cada instância observa cada commit por meio do fluxo de alterações, o CDC também *é* o canal entre instâncias; a transmissão legada por mutação `rebase_entity_changes` não é usada enquanto o CDC estiver ativo.
5. **Desduplicação** — Uma mutação feita pela API do Rebase agenda uma nova busca (refetch) para os assinantes locais no instante em que é confirmada e também é ecoada de volta pelo fluxo de alterações. A instância de origem suprime um eco que chegue dentro da janela de debounce de refetch (um registro de curta duração de suas próprias emissões), de modo que uma gravação via API normalmente produz um único quadro. Um eco que chegue depois disso dispara mais uma nova busca, que entrega as mesmas linhas novamente: inofensivo, mas um assinante pode ver um quadro idêntico duas vezes.

## Captura a partir do WAL

`REALTIME_CDC=wal`, e `auto` onde quer que o banco de dados permita, lê alterações do write-ahead log do PostgreSQL por meio de replicação lógica (o plugin integrado `pgoutput`) em vez de triggers. Uma gravação então não executa nenhum trigger e não envia nenhum `NOTIFY`, o que faz diferença quando as gravações são concorrentes: uma transação que invocou `NOTIFY` obtém um lock para todo o servidor no momento do commit e o mantém durante o flush no disco, portanto, sob captura por trigger, esses commits ocorrem um de cada vez. Medido no PostgreSQL 18 com 32 gravadores concorrentes e um flush de disco de 1&nbsp;ms, a captura por trigger limitou as inserções a cerca de um décimo da taxa alcançada pela captura via WAL.

Requisitos:

- `wal_level = logical` no servidor, o que requer uma reinicialização. No Amazon RDS, defina `rds.logical_replication = 1`; no Cloud SQL, `cloudsql.logical_decoding = on`.
- Uma role que possa replicar: `ALTER ROLE <role> REPLICATION`, ou o equivalente do provedor (no RDS, pertencer ao grupo `rds_replication`).
- Um replication slot livre e um WAL sender por instância do servidor (`max_replication_slots` e `max_wal_senders`, ambos 10 por padrão).
- Uma conexão direta (`DATABASE_DIRECT_URL`): um pooler não suporta o protocolo de replicação.

Quando qualquer um desses requisitos estiver ausente, a inicialização registrará o motivo no log e usará a captura por trigger: um aviso sob o modo `wal`, uma linha informativa sob `auto`, já que a maioria dos bancos de dados não está configurada para decodificação lógica e esse é o resultado esperado nesses casos.

O que uma inicialização faz:

- Cria uma publicação chamada `rebase_cdc` e adiciona a ela cada tabela atendida e cada tabela de junção muitos-para-muitos. As tabelas são apenas adicionadas, de modo que uma versão mais antiga ainda em execução durante um rolling deploy não pode remover a tabela de uma versão mais nova.
- Uma tabela sem chave primária, ou com `REPLICA IDENTITY NOTHING`, é deixada de fora com um aviso: o PostgreSQL recusa `UPDATE` e `DELETE` em uma tabela publicada que não consegue informar qual linha foi alterada. Gravações nela feitas fora do Rebase não são capturadas.
- Cada instância transmite a publicação por meio de seu próprio replication slot **temporário**, que o PostgreSQL descarta quando a conexão é encerrada; assim, uma instância que trave não deixa para trás um slot retendo o WAL até que o disco fique cheio. Uma reconexão inicia um novo slot e todas as assinaturas refazem a busca, pois o que foi confirmado durante o intervalo não é reproduzido.
- Assim que o fluxo é aberto, uma inicialização que tanto provisiona quanto consome remove os triggers de captura, como faz o modo `off`, mas somente quando nenhuma outra instância ainda estiver escutando neles. Caso contrário, uma instância que tenha recorrido à captura por trigger (por exemplo, se não encontrou um replication slot livre) ou uma versão mais antiga ainda em execução durante um rolling deploy pararia de receber gravações feitas em outros lugares. Cada conexão de realtime se identifica em `application_name` (`rebase-realtime:<instance>:cdc`, `:wal` ou `:entity`), portanto a inicialização lê `pg_stat_activity` para ver quem ainda está escutando. A conexão de uma versão mais antiga, que não carrega sufixo, conta como escutando. Enquanto alguém estiver escutando, ou quando a verificação não puder ser feita, os triggers permanecem e são mantidos atualizados. A cada cinco minutos a instância verifica novamente e os remove assim que ninguém mais estiver escutando. Um processo que apenas provisiona, como o job de migração de um [split deployment](/docs/deployment/split-processes/), mantém os triggers para consumidores que não conseguem usar stream e recorrem a eles.

Os gravadores mantêm sua velocidade máxima sob picos, mas um WAL sender decodifica cada slot, portanto, acima de vários milhares de gravações por segundo sustentadas, os eventos podem chegar com atraso. Uma role com `REPLICATION` pode ler todas as linhas de uma tabela publicada por meio de um slot próprio; o fluxo permanece dentro do servidor, e os assinantes continuam relendo cada linha sob seu próprio RLS.

## Requisitos e observações

- O CDC requer uma string de conexão direta (`DATABASE_DIRECT_URL`, o `directConnectionString` do adaptador ou a conexão primária) para o cliente `LISTEN` — poolers de conexão em modo de transação não suportam sessões `LISTEN` de longa duração.
- Os triggers são instalados apenas nas tabelas atendidas pelo backend e nas tabelas de junção de suas relações muitos-para-muitos. Gravações em tabelas não mapeadas são ignoradas.
- Uma tabela atendida que ainda não tenha sido criada é ignorada com um aviso, em vez de bloquear o CDC para as demais.

## Próximos passos

- [Realtime e WebSocket](/docs/backend/realtime) — assinaturas, canais e presença, que são alimentados por esses eventos.
- [Realtime entre instâncias](/docs/backend/realtime-transports) — o barramento que transporta alterações entre processos do servidor.
