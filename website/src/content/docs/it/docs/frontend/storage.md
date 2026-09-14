---
sourceHash: 3e810cd447c9dd8a
title: Storage e caricamento file
sidebar_label: Storage e caricamento file
description: Aggiungi campi per il caricamento di file alle tue collezioni, gestisci i file a livello programmatico e instrada i caricamenti verso diversi backend di storage.
---

## Panoramica

Rebase offre il supporto integrato per il caricamento dei file nei moduli delle collezioni:

- Campi di caricamento file **drag-and-drop**
- **Anteprime delle immagini** nei moduli e nelle celle delle tabelle
- **Caricamento di file multipli** tramite proprietà di tipo array
- **Filtraggio per tipo MIME** e limiti di dimensione
- **Nomi di file personalizzati** tramite funzioni di callback

## Campi per il caricamento di file

Un campo file è una proprietà stringa con un blocco `storage`, oppure un array di essi per gestire più file. La sezione [Campi di caricamento file](/docs/collections/file-uploads/) spiega come dichiararne uno: ogni opzione di `storage` e quali di queste vengono applicate dal server anziché solo dall'uploader del pannello.

## Storage multi-backend

Quando il tuo backend ha più backend di storage configurati (es. locale + S3 + GCS), puoi instradare le singole proprietà verso backend specifici utilizzando `storageSource`:

```typescript
image: {
    type: "string",
    name: "Product Image",
    storage: {
        storageSource: "firebase",     // Routes to the "firebase" backend
        storagePath: "products/{entityId}",
        acceptedFiles: ["image/*"],
    }
}
```

### Sorgenti dirette lato frontend

Per i backend di storage **diretti** (ad es. Firebase Storage, dove il browser esegue l'upload direttamente sul cloud), registrali tramite la prop `storageSources` su `<Rebase>`:

```tsx
import type { RebaseStorageSource } from "@rebasepro/app";

<Rebase
    client={rebaseClient}
    storageSources={[
        { key: "firebase", engine: "firebase", transport: "direct", source: firebaseStorageSource }
    ]}
>
    {/* your app */}
    …
</Rebase>
```

| Proprietà | Tipo | Descrizione |
|-----------|------|-------------|
| `key` | `string` | Identificatore univoco — deve corrispondere a `storageSource` nelle configurazioni delle proprietà |
| `engine` | `string` | Nome del motore di storage (es. `"firebase"`, `"gcs"`, `"s3"`) |
| `transport` | `"server" \| "direct"` | `"server"` esegue il proxy tramite il backend; `"direct"` carica dal browser |
| `source` | `StorageSource` | Implementazione lato client di `StorageSource` (richiesta per il trasporto `"direct"`) |

Il sistema risolve automaticamente la sorgente corretta per ciascuna proprietà: le proprietà della collezione con `storageSource: "firebase"` utilizzeranno la sorgente diretta corrispondente, mentre le proprietà senza `storageSource` (o con `transport: "server"`) passeranno attraverso il backend di Rebase.

## Hook useStorageSource

Per operazioni programmatiche sui file al di fuori dei moduli delle collezioni:

```typescript
import { useStorageSource } from "@rebasepro/app";

// Returns the default storage source
const storageSource = useStorageSource();

// Upload a file — the object is addressed by `key`
const result = await storageSource.putObject({
    file,
    key: "documents/my-file.pdf"
});

// Get a download URL
const { url } = await storageSource.getSignedUrl(result.key);
```

:::tip
`useStorageSource()` restituisce la sorgente di storage **predefinita**. Per le configurazioni multi-backend, la risoluzione per singola proprietà è gestita automaticamente dai binding dei campi del modulo e dallo `StorageSourcesContext`. Nella maggior parte dei casi non è necessario risolvere manualmente le sorgenti.
:::

## Passaggi successivi

- **[Configurazione dello storage di backend](/docs/backend/storage)** — Configurazione di S3, GCS e storage locale
- **[Proprietà](/docs/collections/properties)** — Tutti i tipi di proprietà, incluso lo storage
