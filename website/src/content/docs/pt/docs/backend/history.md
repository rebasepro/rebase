---
sourceHash: 4952ad745ea2bab4
title: Histórico de Entidades
sidebar_label: Histórico de Entidades
description: Rastreie todas as alterações em suas entidades com uma trilha de auditoria completa — quem alterou o quê, quando e a entidade completa antes/depois.
---

## Visão Geral

O histórico de entidades registra um snapshot dos valores da entidade em cada criação, atualização e exclusão. Isso fornece uma trilha de auditoria completa com diffs.

## Habilitando o Histórico

:::note[Onde isso fica]
**Runtime gerenciado** — ativado por padrão. `REBASE_HISTORY=false` no `.env` o desativa.

**Ejetado** — `history: true` em `initializeRebaseBackend({ … })`. A forma de objeto abaixo — `{ retention }` — é exclusiva para o modo ejetado; a variável de ambiente é um booleano.

O mapeamento completo está em [Visão Geral do Backend](/docs/backend/#where-each-option-lives).
:::

### Backend

:::note[Onde isso fica]
**Runtime gerenciado:** `REBASE_HISTORY` (`true` por padrão; defina como `false` para desativar). As configurações de retenção não têm formato de variável de ambiente — ejete para alterá-las.
**Ejetado:** `initializeRebaseBackend({ history })` em `backend/src/index.ts`.
:::

Habilite o histórico em `initializeRebaseBackend`:

```typescript no-verify
await initializeRebaseBackend({
    // ...
    history: true
});
```

Ou com um período de retenção personalizado:

```typescript
history: {
    retention: 30        // Days. Entries older than this are pruned (default: 90)
}
```

### Por Coleção

Marque quais coleções devem rastrear o histórico:

```typescript
import { defineCollection } from "@rebasepro/cms-types";
const ordersCollection = defineCollection({
    slug: "orders",
    name: "Orders",
    table: "orders",
    history: true,       // Enable for this collection
    properties: { /* ... */ }
});
```

## Como Funciona

1. O backend cria uma tabela `rebase.entity_history` automaticamente.
2. Em cada criação, atualização ou exclusão, uma entrada é registrada com:
   - ID da entidade e o slug da coleção (em `table_name`)
   - Os valores da entidade depois da alteração (`values`; em uma exclusão, a
     entidade que foi excluída)
   - Em uma atualização, o que os campos alterados continham antes (`previous_values`)
   - Timestamp e ID do usuário
   - A ação (`create`, `update`, `delete`)
   - Um array de `changed_fields` mostrando quais colunas foram modificadas

Os valores são a linha como a API REST a serve: suas colunas, datas como
timestamps, um `belongsTo` como sua chave estrangeira. É isso que um revert
grava de volta.

Uma entrada nunca guarda os valores de uma linha relacionada. Ler o histórico de uma
linha exige apenas acesso de leitura a essa linha, não às linhas para as quais ela
aponta, então uma relação é mantida como referência — `{ "__type": "relation", "id", "path" }` —
e nada mais. As entradas que versões antigas registraram com a linha relacionada
embutida (uma exclusão costumava armazenar a visão da linha do painel de administração)
são servidas da mesma forma: o endpoint de histórico descarta os valores embutidos antes
de responder.

Em uma coleção com [soft delete](/docs/collections/soft-delete/), uma exclusão
é registrada como `delete` e uma restauração (a atualização que redefine o
campo de soft delete para `null`) como `update`. O histórico de uma linha
permanece legível enquanto ela está na lixeira, e revertê-la para uma versão
anterior à exclusão a restaura.

### O que `previous_values` contém

<span class="since-badge" data-since="0.25">Desde 0.25</span> Uma entrada de
atualização guarda, em `previous_values`, apenas os campos listados em
`changed_fields`. Todos os outros campos tinham o mesmo valor antes e depois da
alteração, portanto já estão em `values`; guardar a linha inteira duas vezes custava,
para uma alteração de um campo em uma linha de 20 campos, 1.269 bytes, e agora custa 794.

As entradas registradas antes da 0.25 mantêm a linha anterior inteira. O `format` da
entrada diz qual é o caso:

| `format` | `previous_values` em uma atualização |
|---|---|
| `1` (entradas anteriores à 0.25) | A linha inteira antes da alteração |
| `2` | Apenas os `changed_fields`, cada um como a linha inteira o tinha |

A visão de histórico do admin e um revert leem ambos da mesma forma: a visão mostra o
valor anterior de cada campo alterado, e um revert grava os `values` da entrada escolhida,
que são completos nos dois formatos. Para reconstruir a linha como era antes de uma
alteração `format: 2`, pegue `values` e recoloque cada campo que `previous_values`
contém.

### Rastreamento de Diffs e Igualdade Estrutural Profunda

Para evitar o registro de logs redundantes onde campos são salvos mas nenhum valor é alterado, o `HistoryService` realiza uma comparação de igualdade estrutural profunda (deep equality) nas chaves de nível superior dos valores antigos e novos:
- Ele ignora propriedades de metadados do sistema que começam com `__`.
- Se diferenças forem encontradas, os nomes das propriedades modificadas são salvos na coluna `changed_fields` (`text[]`).
- Se a verificação de deep equality detectar zero alterações, a inserção no histórico é totalmente ignorada.

### Limpeza (Pruning)

A retenção é aplicada em dois lugares:
- **Após cada escrita**, para a entidade escrita: logo depois de ela ser salva ou
  excluída, o servidor remove as entradas dessa entidade além das 200 mais recentes,
  ou mais antigas que o período de retenção. Isso não segura a escrita.
- <span class="since-badge" data-since="0.25">Desde 0.25</span> **Uma vez por hora**,
  para todas as entidades: as entradas mais antigas que o período de retenção são
  excluídas, não importa a quem pertençam — inclusive entidades que nunca mais são
  escritas, como as excluídas. Veja [Mecânica do ciclo de vida da limpeza](#mecânica-do-ciclo-de-vida-da-limpeza).

## Endpoint REST

```
GET /api/data/:slug/:entityId/history
```

Retorna uma lista de entradas de histórico para uma entidade específica, ordenadas da mais recente para a mais antiga:

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

```
POST /api/data/:slug/:entityId/history/:historyId/revert
```

Grava os `values` da entrada de volta na linha pelo caminho normal de salvamento, de modo que
o revert é ele próprio registrado como um `update`. Responde com a linha salva em `data`
e `meta.reverted_from`, o id da entrada.

Entradas gravadas por versões antigas podem conter chaves para as quais a linha não tem coluna:
um campo que um `afterRead` calculou (antes da 0.24, um salvamento registrava a linha como o
`afterRead` a mostrava), ou uma relação armazenada como a visão dela no painel de administração.
Um revert grava as colunas da linha e deixa essas chaves de fora, com uma relação própria
voltando como sua chave estrangeira, e nomeia o que deixou de fora em
`meta.dropped_fields`. Um valor que um `afterRead` antigo mascarou (`********`) tem uma
coluna, então é gravado de volta como foi registrado.

## Configuração de Retenção

| Configuração | Padrão | Descrição |
|--------------|--------|-----------|
| `retention` | 90 | Entradas mais antigas do que esse número de dias são excluídas. |

Cada entidade também mantém no máximo suas **200** entradas mais recentes. Esse limite é fixo; não há configuração para ele.

### Mecânica do Ciclo de Vida da Limpeza

Após cada alteração que o servidor registra, a entidade alterada é limpa: suas entradas mais antigas que o período de retenção são removidas, e em seguida tudo além das 200 mais recentes. Isso roda de forma assíncrona e não segura a escrita.

Uma escrita feita pelo [`openRebase` ou pelo `rebase console`](/docs/backend/scripts/)
registra a sua entrada de histórico, mas não poda nada, porque um script não pode
saber a retenção com que o seu servidor está configurado. O servidor poda essa
entidade na próxima escrita nela, e na varredura de hora em hora abaixo.

<span class="since-badge" data-since="0.25">Desde 0.25</span> Uma vez por hora, o backend também exclui todas as entradas mais antigas que o período de retenção, de todas as entidades. Antes disso, o histórico de uma entidade que nunca mais era escrita — toda entidade excluída — não era limpo de forma alguma. A varredura:

- roda em uma instância da frota por hora, nos processos que executam os jobs agendados
  (ela reivindica sua hora em `rebase.cron_claims`, como uma execução de cron faz), a
  primeira vez quando o backend inicia;
- exclui em lotes de 5.000 entradas, uma instrução cada, até um lote voltar menor que o
  limite, ignorando as entradas que outra varredura segura — assim, uma primeira varredura
  sobre um grande acúmulo são muitas exclusões curtas, não uma longa;
- lê um índice em `updated_at`, `idx_history_updated_at`. Em um banco de dados criado antes
  da 0.25, ele é construído em segundo plano após a primeira inicialização, com
  `CREATE INDEX CONCURRENTLY`, sem bloquear leituras nem escritas — cerca de um segundo
  para cada 2 milhões de entradas.

A mesma inicialização remove `idx_history_entity` onde ele existe: `idx_history_time`
começa com as mesmas colunas e atende todas as leituras que ele atendia, de modo que ele
só deixava cada alteração registrada mais lenta. A remoção espera no máximo um segundo
por vez pelo lock da tabela, e uma tabela que algo mantém ocupada o tempo todo conserva o
índice até a próxima inicialização.

O limite de 200 entradas por entidade só é aplicado depois de uma escrita nessa entidade.

## Próximos Passos

- **[Entity Callbacks](/docs/collections/callbacks)** — Hooks de ciclo de vida
- **[Visão Geral do Backend](/docs/backend)** — Configuração completa do backend
