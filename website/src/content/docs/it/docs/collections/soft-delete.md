---
sourceHash: 035955ac366c306b
title: Soft delete
sidebar_label: Soft delete
description: Trasforma l'eliminazione in un timestamp, nascondi le righe contrassegnate da ogni lettura e ripristinale con un normale aggiornamento.
---

## Cosa cambia

Con `softDelete` attivo, un'eliminazione **contrassegna una colonna invece di rimuovere la riga**,
e ogni operazione di lettura esclude le righe contrassegnate. Tutto il resto
dell'operazione rimane invariato: è richiesta la stessa autorizzazione, `beforeDelete` può
ancora porre il veto e `afterDelete` viene comunque eseguito. Dal punto di vista del chiamante
la riga è stata eliminata; il modo in cui la tabella registra l'operazione dipende da questo flag.

```typescript
import { defineCollection } from "@rebasepro/cms-types";

const invoices = defineCollection({
    slug: "invoices",
    name: "Invoices",
    table: "invoices",
    softDelete: true,
    properties: {
        reference: { name: "Reference", type: "string" },
        deletedAt: { name: "Deleted at", type: "date", admin: { readOnly: true } }
    }
});
```

`true` utilizza `deletedAt` (colonna `deleted_at`). La forma a oggetto consente di rinominarlo:
`softDelete: { field: "archivedAt" }`.

:::caution[La colonna deve essere dichiarata da te]
Il flag stabilisce il *significato* di una colonna; non ne crea una dal nulla.
Una collection che attiva `softDelete` senza dichiarare quella proprietà `date`
viene rifiutata all'avvio — deliberatamente in anticipo, poiché l'alternativa
sarebbe un errore riscontrato da chi prova a rimuovere una riga.
:::

Solo Postgres, come la [ricerca](/docs/backend/search) e
gli [indici](/docs/backend/indexes).

## Cosa vede una lettura

Le righe contrassegnate sono nascoste per impostazione predefinita da `find`, `findById`, `count`,
dalle aggregazioni, dal refetch in tempo reale e da questa collection caricata tramite
una relazione. Tale comportamento predefinito è fondamentale: il codice scritto prima
dell'introduzione del flag continua a funzionare e nessuno deve ricordarsi di filtrare.

Due parametri di query consentono di accedervi:

| Parametro | Risultati |
|-----------|-----------|
| `?deleted=include` | Righe attive **e** quelle contrassegnate |
| `?deleted=only` | Solo le righe contrassegnate — la vista cestino |

Qualsiasi altro valore restituisce un 400 invece di un fallback silenzioso. `?deleted=true` che
nasconde silenziosamente ogni riga eliminata sembrerebbe funzionare, ma risponderebbe
alla domanda opposta.

## Ripristino ed eliminazione definitiva

Un **ripristino** è un normale aggiornamento che reimposta il campo su `null`. Non esiste
un verbo speciale, perché non esiste uno stato speciale: la riga non è mai stata spostata altrove.

Una **vera** `DELETE` corrisponde a `?hard=true` nella chiamata di eliminazione. Richiede esattamente
gli stessi permessi di un'eliminazione ordinaria: si tratta dello stesso verbo e gestirlo
separatamente creerebbe una seconda superficie di controllo accessi per la medesima operazione. Ciò che
cambia è la possibilità che la riga venga recuperata. Solo il valore letterale `true` o `1`
significa sì; un errore di digitazione produce un 400, poiché un chiamante che ha richiesto di eliminare
definitivamente e ha ottenuto un soft delete crederebbe erroneamente che i dati siano spariti.

## Passaggi successivi

- **[Definire le Collection](/docs/collections)** — dove viene dichiarato `softDelete`
- **[API REST](/docs/backend/api)** — gli endpoint di eliminazione e query a cui appartengono questi parametri
- **[Regole di Sicurezza (RLS)](/docs/collections/security-rules)** — chi ha i permessi per eliminare una riga

---
