---
title: Histórico da Entidade
sidebar_label: Histórico da Entidade
description: Acompanhe todas as alterações nas suas entidades com um rasto de auditoria completo — quem mudou o quê, quando e o instantâneo completo antes/depois.
---

## Visão Geral

O histórico da entidade regista um instantâneo dos valores da entidade em cada criação, atualização e eliminação. Isso fornece um rasto de auditoria completo com as diferenças.

## Ativar o Histórico

### Backend

Ative o histórico em `initializeRebaseBackend`:

```typescript no-verify
await initializeRebaseBackend({
    // ...
    history: true
});
```

Ou com configurações de retenção personalizadas:

```typescript
history: {
    maxEntries: 200,     // Per entity, oldest pruned first (default: 200)
    ttlDays: 90          // Entries older than this are pruned (default: 90)
}
```

### Por Coleção

Marque quais coleções devem rastrear o histórico:

```typescript
import { defineCollection } from "@rebasepro/admin-types";
const ordersCollection = defineCollection({
    slug: "orders",
    name: "Orders",
    table: "orders",
    history: true,       // Ativar para esta coleção
    properties: { /* ... */ }
});
```

## Como Funciona

1. O backend cria uma tabela `rebase.entity_history` automaticamente
2. Em cada criação, atualização ou eliminação, um instantâneo é registado com:
   - ID da entidade, slug da coleção e nome da tabela
   - Os valores completos da entidade (antes e depois)
   - Carimbo de data/hora e ID do utilizador
   - Tipo de operação (`insert`, `update`, `delete`)
3. Entradas antigas são removidas periodicamente (a cada 6 horas)

## Endpoint REST

```
GET /api/data/:slug/:entityId/history
```

Retorna uma lista de entradas de histórico para uma entidade específica, ordenadas pelas mais recentes primeiro:

```json
{
    "data": [
        {
            "id": 42,
            "entity_id": "123",
            "collection_slug": "orders",
            "operation": "update",
            "values": { "status": "shipped", "total": 99.99 },
            "previous_values": { "status": "pending", "total": 99.99 },
            "userId": "admin-user-id",
            "createdAt": "2025-01-15T10:30:00Z"
        }
    ]
}
```

## Configuração de Retenção

| Definição | Padrão | Descrição |
|---------|---------|-------------|
| `maxEntries` | 200 | Número máximo de entradas por entidade. As mais antigas são removidas. |
| `ttlDays` | 90 | Entradas mais antigas do que este período são eliminadas. |

O backend executa uma varredura global de remoção a cada 6 horas.

## Próximos Passos

- **[Callbacks da Entidade](/docs/collections/callbacks)** — Ganchos de ciclo de vida
- **[Visão Geral do Backend](/docs/backend)** — Configuração completa do backend

---
