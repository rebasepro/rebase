---
sourceHash: 1134b2a4207579d3
title: Speicher & Datei-Uploads
sidebar_label: Speicher & Datei-Uploads
description: Fügen Sie Ihren Collections Datei-Upload-Felder hinzu, verwalten Sie Dateien programmatisch und leiten Sie Uploads an verschiedene Speicher-Backends weiter.
---

## Überblick

Rebase bietet integrierte Datei-Upload-Unterstützung in Collection-Formularen:

- **Drag-and-Drop**-Datei-Upload-Felder
- **Bildvorschauen** in Formularen und Tabellenzellen
- **Uploads mehrerer Dateien** über Array-Properties
- **MIME-Typ-Filterung** und Größenbeschränkungen
- **Benutzerdefinierte Dateinamen** über Callback-Funktionen

## Datei-Upload-Felder

Um Datei-Uploads zu einer Collection hinzuzufügen, verwenden Sie die `storage`-Konfiguration auf einer String-Property:

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

### Storage-Konfigurationsoptionen

| Property | Typ | Beschreibung |
|----------|------|-------------|
| `storagePath` | `string` | Unterverzeichnis innerhalb des Speicher-Backends |
| `storageSource` | `string` | Benannte Speicherquelle — leitet Uploads an ein bestimmtes Backend weiter (z. B. `"firebase"`, `"media"`). Siehe [Multi-Backend-Speicher](#multi-backend-speicher). |
| `public` | `boolean` | Speichert Dateien unter dem `public/`-Präfix und stellt sie über stabile, tokenlose, dauerhafte, CDN-cachefähige URLs bereit (sicher zum Persistieren und Direktverlinken). Standard ist `false` (private Dateien verwenden kurzlebige signierte URLs). |
| `acceptedFiles` | `string[]` | Erlaubte MIME-Typen (z. B. `["image/*"]`, `["application/pdf"]`) |
| `maxSize` | `number` | Maximale Dateigröße in Bytes |
| `fileName` | `function` | Generator für benutzerdefinierte Dateinamen |
| `metadata` | `object` | Zusätzliche Metadaten, die mit der Datei gespeichert werden |
| `storeUrl` | `boolean` | Speichert die vollständige URL statt des relativen Pfads |

## Uploads mehrerer Dateien

Umschließen Sie die Storage-Property mit einem Array, um mehrere Dateien hochzuladen:

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

## Dokument-Uploads

Laden Sie Nicht-Bild-Dateien wie PDFs hoch:

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

## Multi-Backend-Speicher

Wenn Ihr Backend mehrere Speicher-Backends konfiguriert hat (z. B. lokal + S3 + GCS), können Sie einzelne Properties mit `storageSource` an bestimmte Backends weiterleiten:

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

### Direkte Frontend-Quellen

Für **direkte** Speicher-Backends (z. B. Firebase Storage, bei dem der Browser direkt in die Cloud hochlädt) registrieren Sie diese über die `storageSources`-Prop auf `<Rebase>`:

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

| Property | Typ | Beschreibung |
|----------|------|-------------|
| `key` | `string` | Eindeutige Kennung — muss mit `storageSource` in den Property-Konfigurationen übereinstimmen |
| `engine` | `string` | Name der Speicher-Engine (z. B. `"firebase"`, `"gcs"`, `"s3"`) |
| `transport` | `"server" \| "direct"` | `"server"` leitet über das Backend weiter; `"direct"` lädt vom Browser hoch |
| `source` | `StorageSource` | Clientseitige `StorageSource`-Implementierung (erforderlich für den `"direct"`-Transport) |

Das System löst die richtige Quelle pro Property automatisch auf — Collection-Properties mit `storageSource: "firebase"` verwenden die passende direkte Quelle, während Properties ohne `storageSource` (oder mit `transport: "server"`) über das Rebase-Backend geleitet werden.

## useStorageSource-Hook

Für programmatische Dateioperationen außerhalb von Collection-Formularen:

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
`useStorageSource()` gibt die **Standard**-Speicherquelle zurück. Für Multi-Backend-Setups wird die Auflösung pro Property automatisch von den Formularfeld-Bindings und dem `StorageSourcesContext` gehandhabt. In den meisten Fällen müssen Sie Quellen nicht manuell auflösen.
:::

## Nächste Schritte

- **[Backend-Speicherkonfiguration](/docs/backend/storage)** — Einrichtung von S3, GCS und lokalem Speicher
- **[Properties](/docs/collections/properties)** — Alle Property-Typen einschließlich Storage
