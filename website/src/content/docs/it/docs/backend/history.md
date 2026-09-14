---
sourceHash: 2c6e24a9d83f64ab
title: Cronologia entità
sidebar_label: Cronologia entità
description: Traccia ogni modifica apportata alle tue entità con un audit trail completo — chi ha modificato cosa, quando e l'entità completa prima/dopo.
---

## Panoramica

La cronologia delle entità registra uno snapshot dei valori dell'entità a ogni creazione, aggiornamento ed eliminazione. Ciò fornisce un audit trail completo con i diff.

## Abilitazione della cronologia

:::note[Dove va inserito]
**Runtime gestito** — attivo per impostazione predefinita. `REBASE_HISTORY=false` in `.env` lo disattiva.

**Ejected** — `history: true` in `initializeRebaseBackend({ … })`. Il formato a oggetto riportato di seguito — `{ retention }` — è disponibile solo in modalità ejected; la variabile d'ambiente è un booleano.

La mappatura completa è disponibile in [Panoramica backend](/docs/backend/#where-each-option-lives).
:::

### Backend

:::note[Dove va inserito]
**Runtime gestito:** `REBASE_HISTORY` (`true` per impostazione predefinita; imposta `false` per disattivarlo). Le impostazioni di retention non hanno una variabile d'ambiente corrispondente — esegui l'eject per modificarle.
**Ejected:** `initializeRebaseBackend({ history })` in `backend/src/index.ts`.
:::

Abilita la cronologia in `initializeRebaseBackend`:

```typescript no-verify
await initializeRebaseBackend({
    // ...
    history: true
});
```

Oppure con un periodo di conservazione personalizzato:

```typescript
history: {
    retention: 30        // Days. Entries older than this are pruned (default: 90)
}
```

### Per singola collection

Indica quali collection devono tracciare la cronologia:

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

## Come funziona

1. Il backend crea automaticamente una tabella `rebase.entity_history`.
2. A ogni creazione, aggiornamento o eliminazione, viene registrato uno snapshot contenente:
   - ID dell'entità e slug della collection (in `table_name`)
   - I valori completi dell'entità (prima e dopo)
   - Timestamp e ID utente
   - L'azione (`create`, `update`, `delete`)
   - Un array di `changed_fields` che mostra quali colonne sono state modificate

### Tracciamento dei diff e uguaglianza strutturale profonda

Per evitare di registrare log ridondanti quando i campi vengono salvati senza modifiche ai valori, il servizio `HistoryService` esegue un confronto di uguaglianza strutturale profonda (deep equality) sulle chiavi di primo livello dei vecchi e nuovi valori:
- Ignora le proprietà dei metadati di sistema che iniziano con `__`.
- Se vengono rilevate differenze, i nomi delle proprietà modificate vengono salvati nella colonna `changed_fields` (`text[]`).
- Se il controllo di deep equality rileva zero modifiche, l'inserimento nella cronologia viene completamente ignorato.

### Pruning post-salvataggio non bloccante

A differenza dei sistemi tradizionali che si basano interamente su lenti script batch periodici, Rebase applica le policy di conservazione continuamente:
- Subito dopo il salvataggio o l'eliminazione di un'entità, il server pianifica un'operazione di **pulizia asincrona inline (sweep)** in una promise non bloccante di tipo fire-and-forget.
- Questa pulizia verifica immediatamente i limiti di retention per quello specifico ID entità e rimuove le voci oltre le 200 più recenti o più vecchie del periodo di retention.

## Endpoint REST

```
GET /api/data/:slug/:entityId/history
```

Restituisce un elenco di voci di cronologia per un'entità specifica, ordinate a partire dalla più recente:

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

## Configurazione della retention

| Impostazione | Predefinito | Descrizione |
|--------------|-------------|-------------|
| `retention` | 90 | Le voci più vecchie di questo numero di giorni vengono eliminate. |

Ciascuna entità mantiene inoltre al massimo le sue **200** voci più recenti. Questo limite è fisso e non prevede alcuna impostazione.

### Meccanica del ciclo di vita del pruning

Il pruning avviene solo inline. Viene eseguito in modo asincrono subito dopo ciascuna modifica registrata, per l'entità che è stata modificata: vengono eliminate le voci più vecchie del periodo di retention, e successivamente tutto ciò che eccede le 200 più recenti. Non esiste una pulizia periodica programmata, quindi la cronologia di un'entità che non viene mai più riscritta non viene sottoposta a pruning — le sue vecchie voci rimangono fino alla successiva modifica di tale entità, oppure finché non le elimini manualmente da `rebase.entity_history`.

## Passaggi successivi

- **[Callback delle entità](/docs/collections/callbacks)** — Hook del ciclo di vita
- **[Panoramica backend](/docs/backend)** — Configurazione completa del backend
