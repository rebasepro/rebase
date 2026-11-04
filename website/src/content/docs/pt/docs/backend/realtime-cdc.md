---
sourceHash: e3f0b557b79dc3c6
title: "Captura de alterações do banco de dados"
sidebar_label: "Captura de alterações do banco de dados"
description: "Eventos em tempo real para toda gravação confirmada, independentemente de como foi feita: os triggers de captura, a configuração REALTIME_CDC e o que eles exigem."
---

**O Change Data Capture vem ativado por padrão.** O Rebase captura alterações no banco de dados e emite eventos em tempo real para **toda gravação confirmada (committed), independentemente de como ela foi feita** — REST, SDK, Studio, `psql`, um cron job em outro serviço, Drizzle/SQL puro ou pelo **editor SQL** do Studio. Este é o mesmo modelo do Supabase Realtime monitorando o write-ahead log.

Nenhuma configuração é necessária. Em uma conexão de banco de dados que suporte o recurso, o CDC se autoprovisiona na inicialização; em uma que não suporte (por exemplo, uma role restrita que não pode criar triggers), o Rebase silenciosamente usa o tempo real em nível de aplicação — nada para ativar, nada que quebre.

## Configuração

O CDC é controlado pela variável de ambiente `REALTIME_CDC`:

| Valor | Comportamento |
| --- | --- |
| `auto` *(padrão)* | Habilita a captura a nível de banco de dados onde a conexão permitir; faz **fallback silencioso** para o tempo real a nível de aplicação caso contrário. Zero configuração. |
| `trigger` | Força a captura baseada em triggers. Funciona em qualquer PostgreSQL, incluindo instâncias gerenciadas sem replicação lógica. Emite aviso (em vez de fazer fallback silencioso) se não conseguir provisionar. |
| `wal` | Lê as alterações do write-ahead log por replicação lógica em vez de triggers, de modo que uma escrita não executa nenhum trigger nem envia `NOTIFY`. Requer `wal_level=logical` e um papel com permissão para replicar; recai para `trigger`, com um aviso, quando algum deles falta. Veja [Captura a partir do WAL](#captura-a-partir-do-wal). |
| `off` | Apenas tempo real a nível de aplicação. Use isso para evitar o overhead de triggers por gravação em cargas de trabalho com muitas gravações. Uma inicialização com `off` que é proprietária do schema também **remove** os triggers e funções de captura que uma inicialização anterior instalou, e registra em log quantos retirou; remova o `off` e a próxima inicialização os instala de novo. |

A mesma configuração é a opção `realtime.cdc` do adaptador Postgres, para um servidor que a configura em código. `REALTIME_CDC`, quando definida, prevalece.

Na inicialização, você verá uma linha de log informando o modo ativo, por exemplo:

```
📡 [CDC] Realtime source = database-level change capture (mode: trigger).
   All writes now emit realtime events regardless of origin.
```

Se a conexão não puder dar suporte, `auto` registra uma linha informativa em vez disso e continua com o tempo real a nível de aplicação:

```
ℹ️ [CDC] Database-level change capture unavailable (likely insufficient
   privileges to create triggers…) — using app-level realtime.
```

## Como Funciona

1. **Autoprovisionamento** — Na inicialização (contexto de servidor/proprietário), o Rebase instala triggers idempotentes `AFTER INSERT/UPDATE/DELETE/TRUNCATE` em cada tabela gerenciada. Eles disparam uma vez por instrução e emitem notificações de alteração no canal `rebase_cdc` que nomeiam as linhas alteradas pela sua chave — a chave primária, mais as duas colunas de id para uma tabela de junção muitos-para-muitos — e não carregam **nenhuma outra coluna**. Uma instrução que alterou muitas linhas as nomeia em lotes de cerca de mil chaves, de modo que um `UPDATE` de 1M de linhas envia cerca de 1.000 notificações em vez de um milhão; uma instrução que alterou uma linha envia uma notificação, e uma que não alterou nenhuma não envia nada. Um `TRUNCATE` é anunciado como uma alteração em todas as linhas da coleção. Uma tabela particionada mantém um trigger por linha, porque o PostgreSQL copia um trigger de linha para cada partição e uma gravação feita direto em uma partição ainda é vista. O PostgreSQL não impõe nenhum privilégio sobre `LISTEN`, então qualquer role que possa se conectar ao banco de dados pode ler esse canal; ela aprende quais chaves mudaram, nunca o que elas contêm. Uma chave grande demais para o limite de 8&nbsp;KB do `NOTIFY` do PostgreSQL é enviada como nenhuma chave (uma alteração na coleção inteira, que toda assinatura de lista e de linha única sobre ela busca de novo), garantindo que o CDC nunca aborte a gravação que disparou o trigger. As funções são substituídas em toda inicialização que provisiona, então um banco de dados instrumentado por uma versão mais antiga — cujo trigger enviava linhas inteiras — é atualizado pela próxima inicialização; uma inicialização com `REALTIME_CDC=off` as remove em vez disso.

   **Atualização.** Um banco de dados instrumentado por uma versão anterior ao agrupamento em lotes tem um trigger por linha; a primeira inicialização de uma versão mais nova o substitui pelos triggers por instrução. Durante 24 horas depois disso, os novos triggers ainda enviam uma notificação por linha, como faziam os antigos, de modo que as instâncias da versão mais antiga ainda em execução durante um deploy gradual (ou depois de um rollback) ouvem todas as linhas. Passada a janela, eles agrupam em lotes. Toda versão que agrupa em lotes lê os dois formatos.
2. **Captura** — Um cliente `LISTEN` dedicado e fora do pool por instância consome o `rebase_cdc`, mapeia a tabela alterada de volta para sua coleção e encaminha a alteração para o mesmo pipeline de `RealtimeService` usado pelas mutações da API. Assim como o listener entre instâncias, ele prioriza `DATABASE_DIRECT_URL` e se reconecta automaticamente.
3. **Entrega segura com RLS** — A linha bruta do fluxo de alterações **nunca** é encaminhada aos assinantes. A alteração é marcada como invalidada, e cada assinatura relê a linha sob seu **próprio** contexto de autenticação. A filtragem é, portanto, por assinante, nunca por publicador: um cliente só recebe linhas que suas políticas de RLS permitem.
4. **Entre instâncias** — Como cada instância observa cada commit através do fluxo de alterações, o CDC também *é* o canal entre instâncias; a transmissão legada `rebase_entity_changes` por mutação não é utilizada enquanto o CDC estiver ativo.
5. **Desduplicação** — Uma mutação feita por meio da API do Rebase agenda um refetch para os assinantes locais no instante em que é confirmada e também é refletida de volta pelo fluxo de alterações. A instância de origem suprime um eco que chega dentro da janela de debounce do refetch (um registro de curta duração de suas próprias emissões), de modo que uma gravação da API normalmente produz um único frame. Um eco que chega depois disso dispara mais um refetch, que entrega as mesmas linhas de novo: inofensivo, mas um assinante pode ver um frame idêntico duas vezes.

## Captura a partir do WAL

`REALTIME_CDC=wal` lê as alterações do write-ahead log do PostgreSQL por replicação lógica (o plugin nativo `pgoutput`) em vez de triggers. Uma escrita então não executa nenhum trigger nem envia `NOTIFY`, o que importa assim que as escritas são concorrentes: uma transação que chamou `NOTIFY` adquire no commit um lock para o servidor inteiro e o mantém durante a gravação em disco, de modo que, com a captura por triggers, esses commits acontecem um de cada vez. Medido no PostgreSQL 18 com 32 escritores concorrentes e um flush em disco de 1&nbsp;ms, a captura por triggers limitou as inserções a cerca de um décimo da taxa alcançada pela captura a partir do WAL.

Requisitos:

- `wal_level = logical` no servidor, o que exige reinício. No Amazon RDS, defina `rds.logical_replication = 1`; no Cloud SQL, `cloudsql.logical_decoding = on`.
- Um papel com permissão para replicar: `ALTER ROLE <role> REPLICATION`, ou o equivalente do provedor (no RDS, ser membro de `rds_replication`).
- Um slot de replicação e um WAL sender livres por instância do servidor (`max_replication_slots` e `max_wal_senders`, ambos 10 por padrão).
- Uma conexão direta (`DATABASE_DIRECT_URL`): um pooler não transporta o protocolo de replicação.

Quando algum deles falta, a inicialização registra o motivo e usa a captura por triggers.

O que uma inicialização faz:

- Cria uma publicação chamada `rebase_cdc` e adiciona a ela a tabela de cada coleção e cada tabela de junção de uma relação muitos-para-muitos. As tabelas só são adicionadas, de modo que uma versão mais antiga ainda em execução durante um deploy gradual não pode retirar dela a tabela de uma coleção mais nova.
- Uma tabela sem chave primária, ou com `REPLICA IDENTITY NOTHING`, fica de fora com um aviso: o PostgreSQL recusa `UPDATE` e `DELETE` em uma tabela publicada que não consegue dizer qual linha mudou. Escritas nela feitas fora do Rebase não são capturadas.
- Cada instância lê a publicação pelo seu próprio slot de replicação **temporário**, que o PostgreSQL remove quando a conexão fecha, então uma instância que cai não pode deixar para trás um slot retendo WAL até encher o disco. Uma reconexão inicia um slot novo e cada inscrição busca os dados de novo, porque o que foi confirmado durante a interrupção não é reproduzido.
- Assim que seu fluxo está aberto, uma inicialização que provisiona e consome ao mesmo tempo remove os triggers de captura, como faz `off`. Durante um deploy gradual que abandona a captura por triggers, as instâncias que ainda a usam deixam de ouvir as escritas feitas em outro lugar até serem substituídas; as escritas delas mesmas continuam chegando aos seus inscritos. Um processo que apenas provisiona, como o job de migração de um [deploy dividido](/docs/deployment/split-processes/), mantém os triggers para os consumidores que não conseguem ler o fluxo e recaem para eles.

Os escritores mantêm toda a velocidade durante um pico, mas um único WAL sender decodifica cada slot, então acima de vários milhares de escritas por segundo sustentadas os eventos podem chegar atrasados. Um papel com `REPLICATION` pode ler cada linha de uma tabela publicada por um slot próprio; o fluxo fica dentro do servidor, e os inscritos continuam relendo cada linha sob seu próprio RLS.

## Requisitos & Observações

`directConnectionString` é a opção do adaptador; na 0.24 use `DATABASE_DIRECT_URL`.

- O CDC requer uma connection string direta (`DATABASE_DIRECT_URL`, o `directConnectionString` do adaptador ou a conexão primária) para o cliente `LISTEN` — poolers de conexão em modo de transação não oferecem suporte a sessões de `LISTEN` de longa duração.
- Os triggers são instalados apenas em tabelas associadas a uma coleção registrada, e nas tabelas de junção das suas relações muitos-para-muitos. Gravações em tabelas não mapeadas são ignoradas.
- Uma coleção cuja tabela ainda não foi migrada é ignorada com um aviso, em vez de bloquear o CDC para as demais.

## Próximos Passos

- [Tempo Real & WebSocket](/docs/backend/realtime) — assinaturas, canais e presença, que esses eventos alimentam.
- [Tempo real entre instâncias](/docs/backend/realtime-transports) — o barramento que leva as alterações entre processos do servidor.
