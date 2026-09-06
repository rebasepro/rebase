---
sourceHash: 1134b2a4207579d3
title: Archiviazione e Caricamento File
sidebar_label: Archiviazione e Caricamento File
description: Aggiungi campi di caricamento file alle tue collezioni, gestisci i file programmaticamente e indirizza i caricamenti verso backend di archiviazione diversi.
---

## Panoramica

Rebase fornisce supporto integrato per il caricamento di file nei moduli di collezione:

- Campi di caricamento file **drag-and-drop**
- **Anteprime delle immagini** nei moduli e nelle celle della tabella
- **Caricamenti di più file** tramite proprietà array
- **Filtraggio per tipo MIME** e limiti di dimensione
- **Nomi file personalizzati** tramite funzioni di callback

## Campi di Caricamento File

Per aggiungere caricamenti di file a una collezione, usa la configurazione `storage` su una proprietà di tipo stringa:

```typescript
properties: {
    image: {
        type: "string",
        name: "Product Image",
        storage: {
            storagePath: "products",       // Subdirectory in storage
            acceptedFiles: ["image/*"],    // MIME type filter
            maxSize: 5 * 1024 * 1024,      // 5MB max
            fileName: (context) => {        // Custom filename
                return context.entityId + "_" + context.file.name;
            }
        }
    }
}
```

### Opzioni di Configurazione dello Storage

| Proprietà | Tipo | Descrizione |
|----------|------|-------------|
| `storagePath` | `string` | Sottodirectory all'interno del backend di archiviazione |
| `storageSource` | `string` | Sorgente di archiviazione con nome — indirizza i caricamenti verso un backend specifico (ad es. `"firebase"`, `"media"`). Vedi [Archiviazione Multi-Backend](#archiviazione-multi-backend). |
| `public` | `boolean` | Archivia i file sotto il prefisso `public/` e li serve tramite URL stabili, senza token, permanenti e memorizzabili nella CDN (sicuri da persistere e collegare direttamente). Il valore predefinito è `false` (i file privati usano URL firmati a breve durata). |
| `acceptedFiles` | `string[]` | Tipi MIME consentiti (ad es. `["image/*"]`, `["application/pdf"]`) |
| `maxSize` | `number` | Dimensione massima del file in byte |
| `fileName` | `function` | Generatore di nomi file personalizzato |
| `metadata` | `object` | Metadati aggiuntivi da archiviare con il file |
| `storeUrl` | `boolean` | Archivia l'URL completo invece del percorso relativo |

## Caricamenti di Più File

Avvolgi la proprietà storage in un array per caricare più file:

```typescript
photos: {
    type: "array",
    name: "Photos",
    of: {
        type: "string",
        storage: {
            storagePath: "photos",
            acceptedFiles: ["image/*"]
        }
    }
}
```

## Caricamenti di Documenti

Carica file non immagine come i PDF:

```typescript
documents: {
    type: "array",
    name: "Documents",
    of: {
        type: "string",
        storage: {
            storagePath: "documents",
            acceptedFiles: ["application/pdf", "image/*"]
        }
    }
}
```

## Archiviazione Multi-Backend

Quando il tuo backend ha più backend di archiviazione configurati (ad es. locale + S3 + GCS), puoi indirizzare singole proprietà verso backend specifici usando `storageSource`:

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

### Sorgenti Dirette del Frontend

Per backend di archiviazione **diretti** (ad es. Firebase Storage dove il browser carica direttamente nel cloud), registrali tramite la prop `storageSources` su `<Rebase>`:

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
|----------|------|-------------|
| `key` | `string` | Identificatore univoco — deve corrispondere a `storageSource` nelle configurazioni di proprietà |
| `engine` | `string` | Nome del motore di archiviazione (ad es. `"firebase"`, `"gcs"`, `"s3"`) |
| `transport` | `"server" \| "direct"` | `"server"` fa da proxy attraverso il backend; `"direct"` carica dal browser |
| `source` | `StorageSource` | Implementazione `StorageSource` lato client (richiesta per il transport `"direct"`) |

Il sistema risolve automaticamente la sorgente corretta per proprietà — le proprietà di collezione con `storageSource: "firebase"` useranno la sorgente diretta corrispondente, mentre le proprietà senza `storageSource` (o con `transport: "server"`) passeranno attraverso il backend di Rebase.

## Hook useStorageSource

Per operazioni sui file programmatiche al di fuori dei moduli di collezione:

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
`useStorageSource()` restituisce la sorgente di archiviazione **predefinita**. Per le configurazioni multi-backend, la risoluzione per proprietà è gestita automaticamente dai binding dei campi del modulo e dal `StorageSourcesContext`. Nella maggior parte dei casi non è necessario risolvere le sorgenti manualmente.
:::

## Prossimi Passi

- **[Configurazione dell'Archiviazione Backend](/docs/backend/storage)** — Configurazione di S3, GCS e archiviazione locale
- **[Proprietà](/docs/collections/properties)** — Tutti i tipi di proprietà, inclusa l'archiviazione
