---
sourceHash: a05da9682df4f23a
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
| `wal` | Dá preferência à replicação lógica WAL. Ainda não empacotado nativamente — degrada para `trigger` e registra o modo ativo nos logs. |
| `off` | Apenas tempo real a nível de aplicação. Use isso para evitar o overhead de triggers por gravação em cargas de trabalho com muitas gravações. Uma inicialização com `off` que é proprietária do schema também **remove** os triggers e funções de captura que uma inicialização anterior instalou, e registra em log quantos retirou; remova o `off` e a próxima inicialização os instala de novo. |

<span class="since-badge" data-since="0.25">Desde 0.25</span> A mesma configuração é a opção `realtime.cdc` do adaptador Postgres, para um servidor que a configura em código. `REALTIME_CDC`, quando definida, prevalece.

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

   <span class="since-badge" data-since="0.25">Desde 0.25</span> **Atualização.** Um banco de dados instrumentado por uma versão anterior ao agrupamento em lotes tem um trigger por linha; a primeira inicialização de uma versão mais nova o substitui pelos triggers por instrução. Durante 24 horas depois disso, os novos triggers ainda enviam uma notificação por linha, como faziam os antigos, de modo que as instâncias da versão mais antiga ainda em execução durante um deploy gradual (ou depois de um rollback) ouvem todas as linhas. Passada a janela, eles agrupam em lotes. Toda versão que agrupa em lotes lê os dois formatos.
2. **Captura** — Um cliente `LISTEN` dedicado e fora do pool por instância consome o `rebase_cdc`, mapeia a tabela alterada de volta para sua coleção e encaminha a alteração para o mesmo pipeline de `RealtimeService` usado pelas mutações da API. Assim como o listener entre instâncias, ele prioriza `DATABASE_DIRECT_URL` e se reconecta automaticamente.
3. **Entrega segura com RLS** — A linha bruta do fluxo de alterações **nunca** é encaminhada aos assinantes. A alteração é marcada como invalidada, e cada assinatura relê a linha sob seu **próprio** contexto de autenticação. A filtragem é, portanto, por assinante, nunca por publicador: um cliente só recebe linhas que suas políticas de RLS permitem.
4. **Entre instâncias** — Como cada instância observa cada commit através do fluxo de alterações, o CDC também *é* o canal entre instâncias; a transmissão legada `rebase_entity_changes` por mutação não é utilizada enquanto o CDC estiver ativo.
5. **Desduplicação** — Uma mutação feita por meio da API do Rebase é entregue localmente no instante em que é confirmada e também é refletida de volta pelo fluxo de alterações. A instância de origem suprime um eco que chega dentro da janela de debounce do refetch (um registro de curta duração de suas próprias emissões), de modo que uma gravação da API normalmente produz um único frame. Um eco que chega depois disso dispara mais um refetch, que entrega as mesmas linhas de novo: inofensivo, mas um assinante pode ver um frame idêntico duas vezes.

## Requisitos & Observações

<span class="since-badge" data-since="0.25">Desde 0.25</span> `directConnectionString` é a opção do adaptador; na 0.24 use `DATABASE_DIRECT_URL`.

- O CDC requer uma connection string direta (`DATABASE_DIRECT_URL`, o `directConnectionString` do adaptador ou a conexão primária) para o cliente `LISTEN` — poolers de conexão em modo de transação não oferecem suporte a sessões de `LISTEN` de longa duração.
- Os triggers são instalados apenas em tabelas associadas a uma coleção registrada. Gravações em tabelas não mapeadas são ignoradas.
- Uma coleção cuja tabela ainda não foi migrada é ignorada com um aviso, em vez de bloquear o CDC para as demais.
- O streaming de replicação lógica nativa do WAL (`wal2json`/`pgoutput`) está planejado; atualmente `REALTIME_CDC=wal` degrada para o caminho baseado em triggers, que oferece cobertura equivalente a nível de banco de dados.

## Próximos Passos

- [Tempo Real & WebSocket](/docs/backend/realtime) — assinaturas, canais e presença, que esses eventos alimentam.
- [Tempo real entre instâncias](/docs/backend/realtime-transports) — o barramento que leva as alterações entre processos do servidor.
