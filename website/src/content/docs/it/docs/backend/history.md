---
sourceHash: f0cc4de3a8c82b82
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
2. A ogni creazione, aggiornamento o eliminazione, viene registrata una voce contenente:
   - ID dell'entità e slug della collection (in `table_name`)
   - I valori dell'entità dopo la modifica (`values`; per un'eliminazione,
     l'entità eliminata)
   - Su un aggiornamento, ciò che i campi modificati contenevano prima (`previous_values`)
   - Timestamp e ID utente
   - L'azione (`create`, `update`, `delete`)
   - Un array di `changed_fields` che mostra quali colonne sono state modificate

I valori sono la riga come la serve l'API REST: le sue colonne, le date come
timestamp, un `belongsTo` come la sua foreign key. È ciò che un revert scrive
indietro.

Una voce non contiene mai i valori di una riga correlata. Leggere la cronologia di
una riga richiede solo l'accesso in lettura a quella riga, non alle righe a cui
punta, quindi una relazione viene conservata come riferimento —
`{ "__type": "relation", "id", "path" }` — e nient'altro. Le voci che versioni
precedenti hanno registrato con la riga correlata incorporata (un'eliminazione
memorizzava la vista della riga del pannello di amministrazione) vengono servite
allo stesso modo: l'endpoint della cronologia scarta i valori incorporati prima di
rispondere.

Su una collection con [soft delete](/docs/collections/soft-delete/), una
eliminazione viene registrata come `delete` e un ripristino (l'aggiornamento che
riporta il campo di soft delete a `null`) come `update`. La cronologia di una
riga resta leggibile mentre la riga è nel cestino, e ripristinarla a una
versione precedente all'eliminazione la fa tornare attiva.

### Cosa contiene `previous_values`

<span class="since-badge" data-since="0.25">Da 0.25</span> Una voce di aggiornamento
conserva, in `previous_values`, solo i campi elencati in `changed_fields`. Ogni
altro campo conteneva lo stesso valore prima e dopo la modifica, quindi è già in
`values`; memorizzare due volte l'intera riga costava 1.269 byte per la modifica
di un campo in una riga di 20 campi, mentre ora ne costa 794.

Le voci registrate prima della 0.25 conservano l'intera riga precedente. Il
`format` della voce dice quale delle due è:

| `format` | `previous_values` su un aggiornamento |
|---|---|
| `1` (voci precedenti alla 0.25) | L'intera riga prima della modifica |
| `2` | Solo i `changed_fields`, ciascuno come lo aveva l'intera riga |

La vista cronologia dell'admin e un revert leggono entrambi i formati allo stesso
modo: la vista mostra il valore precedente di ciascun campo modificato, e un
revert scrive i `values` della voce scelta, che sono interi in entrambi i
formati. Per ricostruire la riga com'era prima di una modifica `format: 2`,
prendi `values` e rimetti ciascun campo contenuto in `previous_values`.

### Tracciamento dei diff e uguaglianza strutturale profonda

Per evitare di registrare log ridondanti quando i campi vengono salvati senza modifiche ai valori, il servizio `HistoryService` esegue un confronto di uguaglianza strutturale profonda (deep equality) sulle chiavi di primo livello dei vecchi e nuovi valori:
- Ignora le proprietà dei metadati di sistema che iniziano con `__`.
- Se vengono rilevate differenze, i nomi delle proprietà modificate vengono salvati nella colonna `changed_fields` (`text[]`).
- Se il controllo di deep equality rileva zero modifiche, l'inserimento nella cronologia viene completamente ignorato.

### Pruning

La retention viene applicata in due punti:
- **Dopo ogni scrittura**, per l'entità scritta: subito dopo che è stata salvata
  o eliminata, il server esegue il pruning delle voci di quell'entità oltre le 200
  più recenti, o più vecchie del periodo di retention. Non fa attendere la scrittura.
- <span class="since-badge" data-since="0.25">Da 0.25</span> **Una volta all'ora**,
  per ogni entità: le voci più vecchie del periodo di retention vengono eliminate
  qualunque entità le possieda — comprese quelle che non vengono mai più scritte,
  come le entità eliminate. Vedi [Meccanica del ciclo di vita del pruning](#meccanica-del-ciclo-di-vita-del-pruning).

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

Riscrive i `values` della voce sulla riga attraverso il normale percorso di salvataggio,
quindi il revert viene a sua volta registrato come `update`. Risponde con la riga salvata
sotto `data` e con `meta.reverted_from`, l'id della voce.

Le voci scritte da versioni precedenti possono contenere chiavi per cui la riga non ha
colonna: un campo calcolato da un `afterRead` (prima della 0.24, un salvataggio registrava la
riga come la mostrava `afterRead`), o una relazione memorizzata come vista della riga del
pannello di amministrazione. Un revert scrive le colonne della riga e lascia fuori quelle
chiavi, con una relazione di proprietà che torna come foreign key, e nomina ciò che ha
lasciato fuori in `meta.dropped_fields`. Un valore che un vecchio `afterRead` aveva
mascherato (`********`) ha una colonna, quindi viene riscritto così com'era stato registrato.

## Configurazione della retention

| Impostazione | Predefinito | Descrizione |
|--------------|-------------|-------------|
| `retention` | 90 | Le voci più vecchie di questo numero di giorni vengono eliminate. |

Ciascuna entità mantiene inoltre al massimo le sue **200** voci più recenti. Questo limite è fisso e non prevede alcuna impostazione.

### Meccanica del ciclo di vita del pruning

Dopo ogni modifica che il server registra viene eseguito il pruning dell'entità modificata: vengono eliminate le sue voci più vecchie del periodo di retention, e successivamente tutto ciò che eccede le sue 200 più recenti. Questo avviene in modo asincrono e non fa attendere la scrittura.

Una scrittura fatta tramite [`openRebase` o `rebase console`](/docs/backend/scripts/)
registra la propria voce di cronologia ma non elimina nulla, perché uno script non può
conoscere la retention con cui è configurato il tuo server. Il server esegue il pruning di
quell'entità alla sua prossima scrittura su di essa, e nella pulizia oraria qui sotto.

<span class="since-badge" data-since="0.25">Da 0.25</span> Una volta all'ora, il
backend elimina inoltre ogni voce più vecchia del periodo di retention, di ogni
entità. Prima di questo, la cronologia di un'entità che non veniva mai più
riscritta — ogni entità eliminata — non veniva sottoposta a pruning affatto. La
pulizia:

- viene eseguita da un'istanza della flotta all'ora, sui processi che eseguono i
  job pianificati (rivendica la sua ora in `rebase.cron_claims`, come fa
  un'esecuzione cron), la prima volta all'avvio del backend;
- elimina a lotti di 5.000 voci, un'istruzione ciascuno, finché un lotto non
  torna più corto, saltando le voci che un'altra pulizia tiene — quindi una prima
  pulizia su un grande arretrato è fatta di molte eliminazioni brevi, non di una lunga;
- legge un indice su `updated_at`, `idx_history_updated_at`. Su un database
  creato prima della 0.25 viene costruito in background dopo il primo avvio,
  `CREATE INDEX CONCURRENTLY`, senza bloccare letture o scritture — circa un
  secondo ogni 2 milioni di voci.

Lo stesso avvio elimina `idx_history_entity` dove esiste: `idx_history_time`
inizia con le stesse colonne e serve ogni lettura che serviva lui, quindi non
faceva che rallentare ogni modifica registrata. L'eliminazione attende al massimo
un secondo alla volta il lock della tabella, e una tabella che qualcosa tiene
occupata per tutto il tempo mantiene l'indice fino all'avvio successivo.

Il limite di 200 voci per entità viene applicato solo dopo una scrittura su quell'entità.

## Passaggi successivi

- **[Callback delle entità](/docs/collections/callbacks)** — Hook del ciclo di vita
- **[Panoramica backend](/docs/backend)** — Configurazione completa del backend
