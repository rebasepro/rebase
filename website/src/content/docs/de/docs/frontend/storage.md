---
sourceHash: 11a70a4f7a976bf5
title: Storage & Datei-Uploads
sidebar_label: Storage & Datei-Uploads
description: Fügen Sie Ihren Collections Datei-Upload-Felder hinzu, verwalten Sie Dateien programmatisch und leiten Sie Uploads an verschiedene Storage-Backends weiter.
---

## Übersicht

Rebase bietet integrierte Unterstützung für Datei-Uploads in Collection-Formularen:

- **Drag-and-Drop**-Datei-Upload-Felder
- **Bildvorschauen** in Formularen und Tabellenzellen
- **Upload mehrerer Dateien** über Array-Properties
- **MIME-Type-Filterung** und Größenbeschränkungen
- **Benutzerdefinierte Dateinamen** über Callback-Funktionen

## Datei-Upload-Felder

Ein Dateifeld ist eine String-Property mit einem `storage`-Block oder ein Array davon für mehrere Dateien. [Datei-Upload-Felder](/docs/collections/file-uploads/) beschreibt die Deklaration: alle `storage`-Optionen und welche davon serverseitig erzwungen werden und nicht nur vom Uploader des Panels.

## Multi-Backend-Storage

Wenn für Ihr Backend mehrere Storage-Backends konfiguriert sind (z. B. lokal + S3 + GCS), können Sie einzelne Properties mithilfe von `storageSource` an bestimmte Backends weiterleiten:

```typescript
image: {
    type: "string",
    name: "Product Image",
    storage: {
        storageSource: "firebase",     // Routes to the "firebase" backend
        storagePath: "products/{id}",
        acceptedFiles: ["image/*"],
    }
}
```

### Frontend Direct Sources

Für **direkte** Storage-Backends (z. B. Firebase Storage, bei dem der Browser direkt in die Cloud hochlädt), registrieren Sie diese über die `storageSources`-Prop an `<Rebase>`:

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
| `key` | `string` | Eindeutiger Bezeichner – muss mit `storageSource` in den Property-Konfigurationen übereinstimmen |
| `engine` | `string` | Name der Storage-Engine (z. B. `"firebase"`, `"gcs"`, `"s3"`) |
| `transport` | `"server" \| "direct"` | `"server"` leitet Anfragen über das Backend weiter; `"direct"` lädt direkt über den Browser hoch |
| `source` | `StorageSource` | Client-seitige `StorageSource`-Implementierung (erforderlich für den `"direct"`-Transport) |

Das System ermittelt automatisch die korrekte Quelle pro Property – Collection-Properties mit `storageSource: "firebase"` verwenden die passende direkte Quelle, während Properties ohne `storageSource` (oder mit `transport: "server"`) über das Rebase-Backend weitergeleitet werden.

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
`useStorageSource()` gibt die **Standard**-Storage-Quelle zurück. Bei Setups mit mehreren Backends wird die Auflösung pro Property automatisch von den Formularfeld-Bindings und dem `StorageSourcesContext` übernommen. In den meisten Fällen müssen Sie Quellen nicht manuell auflösen.
:::

## Nächste Schritte

- **[Backend-Storage-Konfiguration](/docs/backend/storage)** — Einrichtung von S3, GCS und lokalem Storage
- **[Properties](/docs/collections/properties)** — Alle Property-Typen einschließlich Storage
