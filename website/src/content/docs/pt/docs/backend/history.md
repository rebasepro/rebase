---
sourceHash: 37c268f3d4b76c7f
title: Histórico de Entidades
sidebar_label: Histórico de Entidades
description: Rastreie cada alteração em suas entidades com uma trilha de auditoria completa — quem alterou o quê, quando e a entidade completa antes/depois.
---

## Visão Geral

O histórico de entidades registra um snapshot dos valores da entidade a cada criação, atualização e exclusão. Isso fornece uma trilha de auditoria completa com diffs.

## Ativando o Histórico

:::note[Onde isso é configurado]
**Runtime gerenciado** — ativado por padrão. `REBASE_HISTORY=false` no `.env` o desativa.

**Ejetado** — `history: true` em `initializeRebaseBackend({ … })`. A forma de objeto abaixo — `{ retention }` — é exclusiva para o modo ejetado; a variável de ambiente é um booleano.

O mapeamento completo está em [Visão Geral do Backend](/docs/backend/#where-each-option-lives).
:::

### Backend

:::note[Onde isso é configurado]
**Runtime gerenciado:** `REBASE_HISTORY` (`true` por padrão; defina como `false` para desativar). As configurações de retenção não possuem formato de variável de ambiente — ejete para alterá-las.
**Ejetado:** `initializeRebaseBackend({ history })` em `backend/src/index.ts`.
:::

Ative o histórico em `initializeRebaseBackend`:

```typescript no-verify
await initializeRebaseBackend({
    // ...
    history: true
});
```

Ou com um período de retenção personalizado:

```typescript
history: {
    retention: 30        // Dias. Entradas mais antigas que isso são removidas (padrão: 90)
}
```

### Por tabela

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Marque quais tabelas rastreiam o histórico com `history: true`:

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const orders = defineTable("orders", {
    columns: {
        id:     col.uuid().primaryKey().defaultRandom(),
        status: col.enum(["open", "paid", "shipped"]).notNull().default("open"),
        total:  col.numeric({ precision: 10, scale: 2 }).notNull(),
    },
    history: true,
    rls: "admin-only",
});
```

Uma view não pode rastrear histórico: ela nunca é gravada.

## Como Funciona

1. O backend cria uma tabela `rebase.entity_history` automaticamente.
2. A cada criação, atualização ou exclusão, uma entrada é registrada com:
   - ID da entidade e o slug da tabela (em `table_name`)
   - Os valores da entidade após a alteração (`values`; para uma exclusão, a entidade
     que foi excluída)
   - Em uma atualização, o que os campos alterados continham antes dela (`previous_values`)
   - Timestamp e ID do usuário
   - A ação (`create`, `update`, `delete`)
   - Um array de `changed_fields` mostrando quais colunas foram modificadas

Os valores correspondem à linha conforme a API REST a serve: suas colunas, datas como
timestamps, um `belongsTo` como sua chave estrangeira. Isso é o que uma reversão grava de volta.

Uma entrada nunca mantém os valores de uma linha relacionada. Ler o histórico de uma linha precisa apenas
de acesso de leitura a essa linha, não às linhas para as quais ela aponta, portanto, um `belongsTo` é mantido
como sua chave estrangeira e nada mais.

Entradas que versões mais antigas registraram por meio da visualização da linha no painel administrativo
(uma exclusão costumava armazená-la) são servidas, e revertidas, como a linha que representam:
um envelope `{ "__type": "date", "value" }` como seu valor, uma
ref `{ "__type": "relation" }` de uma relação proprietária como a chave estrangeira sob
o próprio nome da chave, qualquer outra ref de relação como a chave da linha relacionada, e uma
linha relacionada incorporada pela ref nunca é servida. Reverter tal entrada grava
esses valores simples; uma lista to-many que ela contenha não é gravada e é nomeada em
`dropped_fields`.

Em uma tabela com [soft delete](/docs/collections/soft-delete/), uma exclusão é
registrada como `delete` e uma restauração (a atualização que redefine o campo de soft-delete
de volta para `null`) como `update`. O histórico de uma linha permanece legível enquanto a linha estiver
na lixeira, e revertê-la para uma versão anterior à exclusão a restaura.

### O que `previous_values` contém

Uma entrada de atualização
mantém, em `previous_values`, apenas os campos listados em `changed_fields`. Todos os
outros campos mantiveram o mesmo valor antes e depois da alteração, portanto já estão em
`values`; armazenar a linha inteira duas vezes custava a uma alteração de um único campo em uma
linha de 20 campos 1.269 bytes, onde agora custa 794.

Entradas registradas antes da versão 0.25 mantêm a linha anterior inteira. O `format` da entrada
indica qual é:

| `format` | `previous_values` em uma atualização |
|---|---|
| `1` (entradas anteriores a 0.25) | A linha inteira antes da alteração |
| `2` | Apenas os `changed_fields`, cada um como a linha inteira continha |

A visualização de histórico do admin e uma reversão leem ambos da mesma forma: a visualização mostra o
valor anterior de cada campo alterado, e uma reversão grava os `values` da entrada escolhida,
que são completos em ambos os formatos. Para reconstruir a linha como era antes de uma
alteração com `format: 2`, pegue `values` e recoloque cada campo que
`previous_values` contém.

### Rastreamento de Diffs e Igualdade Estrutural Profunda (Deep Equality)

Para evitar o registro de logs redundantes onde campos são salvos mas nenhum valor é alterado, o `HistoryService` realiza uma comparação de igualdade estrutural profunda nas chaves de nível superior dos valores antigos e novos:
- Ignora campos de metadados do sistema que começam com `__`.
- Se forem encontradas diferenças, os nomes dos campos modificados são salvos na coluna `changed_fields` (`text[]`).
- Se a verificação de deep equality detectar zero alterações, a inserção do histórico é totalmente ignorada.

### Remoção (Pruning)

A retenção é aplicada em dois locais:
- **Após cada gravação**, para a entidade gravada: logo após ela ser salva ou
  excluída, o servidor remove as entradas dessa entidade além das 200 mais recentes, ou
  mais antigas que o período de retenção. Isso não atrasa a gravação.
- **Uma vez por hora**,
  para cada entidade: entradas mais antigas que o período de retenção são excluídas
  independentemente de a quem pertençam — incluindo entidades que nunca mais serão gravadas,
  como as excluídas. Consulte [Mecânica do ciclo de vida da remoção](#mecânica-do-ciclo-de-vida-da-remoção).

## Endpoint REST

```
GET /api/data/:slug/:entityId/history
```

Retorna uma lista de entradas de histórico para uma entidade específica, ordenada a partir da mais recente. <span class="since-badge" data-since="0.31">Desde 0.31</span> Entradas que uma transação registra — uma criação e a atualização seguinte em um único `_batch`, uma reversão e a reversão dela — retornam na ordem em que foram gravadas: o `updated_at` de cada entrada é posterior à entrada anterior da linha. Um banco de dados existente obtém isso em sua próxima inicialização de provisionamento, ou em uma execução com `REBASE_PROVISION_ONLY=true`, que substitui a função `rebase.record_history`; um deployment que nunca provisiona mantém a ordenação antiga até lá. Entradas registradas antes disso mantêm sua ordem.

```json
{
    "data": [
        {
            "id": "5b0e7c2e-…",
            "table_name": "orders",
            "entity_id": "123",
            "action": "update",
            "changed_fields": ["status"],
            "values": { "status": "shipped", "total": 99.99 },
            "previous_values": { "status": "pending" },
            "updated_by": "admin-user-id",
            "updated_at": "2025-01-15T10:30:00Z",
            "format": 2
        }
    ],
    "meta": { "total": 1, "limit": 20, "offset": 0, "hasMore": false }
}
```

### As entradas são servidas como leituras

<span class="since-badge" data-since="0.31">Desde 0.31</span>

As entradas de histórico são servidas da mesma forma que a linha: controle de acesso a nível de campo primeiro, depois
`afterRead` (global, tabela, coluna), dentro da transação somente leitura do chamador. Uma coluna que um hook ou um `.transform({ afterRead })` mascara é mascarada
em `values` e `previous_values`; uma coluna que as roles do chamador não podem ler é
ocultada e deixada de fora de `changed_fields`; chaves de colunas que a tabela não
possui mais são ocultadas. Qualquer pessoa autorizada a ler a linha agora pode ver seu histórico, e
`updated_by` é mantido. Um hook que lança um erro em um snapshot antigo falha a requisição
em vez de servi-la sem máscara, e o histórico de uma linha excluída permanentemente (hard-deleted) responde
404 ("No row with id '…' in table '…'").

O driver do Postgres faz isso; um driver personalizado serve o histórico implementando
`DataDriver.serveStoredRows(path, rows)`, e sem isso as rotas de histórico
respondem 501. Antes da versão 0.31, as entradas eram servidas exatamente como armazenadas.

```
POST /api/data/:slug/:entityId/history/:historyId/revert
```

Grava os `values` da entrada de volta na linha por meio do fluxo normal de salvamento, de modo que a
reversão é ela própria registrada como um `update`. Ela responde a linha salva sob `data`
e `meta.reverted_from`, o id da entrada. Uma reversão nunca grava uma coluna que o chamador
não possa ler: essas mantêm seu valor atual.

Entradas gravadas por versões mais antigas podem conter chaves para as quais a linha não tem coluna: um
campo computado por um `afterRead` (antes de 0.24, um salvamento registrava a linha conforme
o `afterRead` a exibia), ou uma relação armazenada como a visualização dela no painel administrativo.
Uma reversão grava as colunas da linha e omite essas chaves, com uma relação proprietária
retornando como sua chave estrangeira, e indica o que foi omitido em
`meta.dropped_fields`. Um valor mascarado por um `afterRead` antigo (`********`) possui uma
coluna, portanto é gravado de volta como foi registrado.

## Configuração de Retenção

| Configuração | Padrão | Descrição |
|---------|---------|-------------|
| `retention` | 90 | Entradas mais antigas que essa quantidade de dias são excluídas. |

Cada entidade também mantém no máximo suas **200** entradas mais recentes. Esse limite é fixo; ele
não possui configuração.

### Mecânica do Ciclo de Vida da Remoção

Após cada alteração que o servidor registra, a entidade que mudou passa por remoção: suas
entradas mais antigas que o período de retenção são removidas, e em seguida tudo o que estiver além de suas 200 mais
recentes. Isso roda de forma assíncrona e não atrasa a gravação.

Uma gravação feita por meio de [`openRebase` ou `rebase console`](/docs/backend/scripts/)
registra sua entrada de histórico, mas não remove nada, porque um script não pode saber a
retenção com a qual seu servidor está configurado. O servidor remove as entradas dessa entidade em sua
próxima gravação nela, e na varredura horária descrita abaixo.

Uma vez por hora, o
backend também exclui todas as entradas mais antigas que o período de retenção, de todas as
entidades. Antes disso, o histórico de uma entidade que nunca mais era gravada —
todas as excluídas — não era limpo. A varredura:

- roda em uma instância da frota por hora, nos processos que executam os
  jobs agendados (ela reivindica sua hora em `rebase.cron_claims`, como faz uma execução de cron),
  pela primeira vez quando o backend inicializa;
- exclui em lotes de 5.000 entradas, uma instrução cada, até que um lote retorne
  com menos registros, ignorando entradas retidas por outra varredura — portanto, uma primeira varredura sobre um
  grande acúmulo consiste em muitas exclusões curtas, e não em uma única longa;
- lê um índice em `updated_at`, `idx_history_updated_at`. Em um banco de dados
  criado antes de 0.25, ele é construído em segundo plano após a primeira inicialização,
  `CREATE INDEX CONCURRENTLY`, sem bloquear leituras ou gravações — cerca de um
  segundo por 2 milhões de entradas.

A mesma inicialização remove `idx_history_entity` onde ele existir: `idx_history_time`
inicia com as mesmas colunas e atende a todas as leituras que o outro atendia, logo ele apenas tornava mais lenta cada
alteração registrada. A remoção aguarda no máximo um segundo por vez pelo lock da tabela,
e uma tabela retida por algo durante todo o processo mantém o índice até a próxima inicialização.

O limite de 200 entradas por entidade é aplicado somente após uma gravação nessa entidade.

## Próximos Passos

- **[Hooks de tabela](/docs/collections/callbacks/)** — Hooks de ciclo de vida
- **[Visão Geral do Backend](/docs/backend)** — Configuração completa do backend
