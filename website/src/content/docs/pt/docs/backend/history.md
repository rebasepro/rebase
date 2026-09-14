---
sourceHash: 2c6e24a9d83f64ab
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
2. Em cada criação, atualização ou exclusão, um snapshot é registrado com:
   - ID da entidade e o slug da coleção (em `table_name`)
   - Os valores completos da entidade (antes e depois)
   - Timestamp e ID do usuário
   - A ação (`create`, `update`, `delete`)
   - Um array de `changed_fields` mostrando quais colunas foram modificadas

### Rastreamento de Diffs e Igualdade Estrutural Profunda

Para evitar o registro de logs redundantes onde campos são salvos mas nenhum valor é alterado, o `HistoryService` realiza uma comparação de igualdade estrutural profunda (deep equality) nas chaves de nível superior dos valores antigos e novos:
- Ele ignora propriedades de metadados do sistema que começam com `__`.
- Se diferenças forem encontradas, os nomes das propriedades modificadas são salvos na coluna `changed_fields` (`text[]`).
- Se a verificação de deep equality detectar zero alterações, a inserção no histórico é totalmente ignorada.

### Limpeza (Pruning) Não Bloqueante Pós-Salvamento

Diferente dos sistemas tradicionais que dependem inteiramente de scripts periódicos em lote (batch) lentos, o Rebase aplica suas políticas de retenção continuamente:
- Logo após uma entidade ser salva ou excluída, o servidor agenda uma **varredura assíncrona em linha** em uma promise "fire-and-forget" não bloqueante.
- Esta varredura verifica imediatamente os limites de retenção para aquele ID de entidade específico e remove entradas além das 200 mais recentes, ou mais antigas que o período de retenção.

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
            "previous_values": { "status": "pending", "total": 99.99 },
            "updated_by": "admin-user-id",
            "updated_at": "2025-01-15T10:30:00Z"
        }
    ],
    "meta": { "total": 1, "limit": 20, "offset": 0, "hasMore": false }
}
```

## Configuração de Retenção

| Configuração | Padrão | Descrição |
|--------------|--------|-----------|
| `retention` | 90 | Entradas mais antigas do que esse número de dias são excluídas. |

Cada entidade também mantém no máximo suas **200** entradas mais recentes. Esse limite é fixo; não há configuração para ele.

### Mecânica do Ciclo de Vida da Limpeza

A limpeza (pruning) é apenas inline. Ela é executada de forma assíncrona logo após cada alteração registrada, para a entidade que foi alterada: entradas mais antigas que o período de retenção são removidas, e em seguida tudo além das 200 mais recentes. Não há varredura periódica, portanto o histórico de uma entidade que nunca mais for alterada não é limpo — suas entradas antigas permanecem até a próxima alteração nessa entidade, ou até que você mesmo as exclua de `rebase.entity_history`.

## Próximos Passos

- **[Entity Callbacks](/docs/collections/callbacks)** — Hooks de ciclo de vida
- **[Visão Geral do Backend](/docs/backend)** — Configuração completa do backend
