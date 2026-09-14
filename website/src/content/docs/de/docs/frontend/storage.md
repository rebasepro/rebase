---
sourceHash: 3e810cd447c9dd8a
title: Speicher & Datei-Uploads
sidebar_label: Speicher & Datei-Uploads
description: Fügen Sie Ihren Sammlungen Datei-Upload-Felder hinzu, verwalten Sie Dateien programmatisch und leiten Sie Uploads an verschiedene Speicher-Backends weiter.
---

## Übersicht

Rebase bietet integrierte Unterstützung für Datei-Uploads in Sammlungsformularen:

- **Drag-and-Drop**-Datei-Upload-Felder
- **Bildvorschauen** in Formularen und Tabellenzellen
- **Upload mehrerer Dateien** über Array-Eigenschaften
- **MIME-Typ-Filterung** und Größenbeschränkungen
- **Benutzerdefinierte Dateinamen** über Callback-Funktionen

## Datei-Upload-Felder

Ein Dateifeld ist eine String-Eigenschaft mit einem `storage`-Block oder ein Array davon für mehrere Dateien. [Datei-Upload-Felder](/docs/collections/file-uploads/) behandelt die Deklaration: jede `storage`-Option und welche davon serverseitig erzwungen werden und nicht nur durch den Uploader des Panels.

## Multi-Backend-Speicher

Wenn Ihr Backend über mehrere konfigurierte Speicher-Backends verfügt (z. B. lokal + S3 + GCS), können Sie einzelne Eigenschaften mithilfe von `storageSource` an bestimmte Backends weiterleiten:

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

Für **direkte** Speicher-Backends (z. B. Firebase Storage, bei dem der Browser direkt in die Cloud hochlädt), registrieren Sie diese über die `storageSources`-Prop auf `<Rebase>`:

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

| Eigenschaft | Typ | Beschreibung |
|-------------|------|-------------|
| `key` | `string` | Eindeutige Kennung – muss mit `storageSource` in den Eigenschaftskonfigurationen übereinstimmen |
| `engine` | `string` | Name der Speicher-Engine (z. B. `"firebase"`, `"gcs"`, `"s3"`) |
| `transport` | `"server" \| "direct"` | `"server"` leitet über das Backend weiter; `"direct"` lädt direkt aus dem Browser hoch |
| `source` | `StorageSource` | Clientseitige `StorageSource`-Implementierung (erforderlich für `"direct"`-Transport) |

Das System löst die richtige Quelle pro Eigenschaft automatisch auf – Sammlungs-Eigenschaften mit `storageSource: "firebase"` verwenden die passende direkte Quelle, während Eigenschaften ohne `storageSource` (oder mit `transport: "server"`) über das Rebase-Backend geleitet werden.

## useStorageSource-Hook

Für programmatische Dateioperationen außerhalb von Sammlungsformularen:

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
`useStorageSource()` gibt die **Standard**-Speicherquelle zurück. Bei Multi-Backend-Setups wird die Auflösung pro Eigenschaft automatisch durch die Formularfeld-Bindings und den `StorageSourcesContext` gehandhabt. In den meisten Fällen müssen Sie Quellen nicht manuell auflösen.
:::

## Nächste Schritte

- **[Backend-Speicherkonfiguration](/docs/backend/storage)** – Einrichtung von S3, GCS und lokalem Speicher
- **[Eigenschaften](/docs/collections/properties)** – Alle Eigenschaftstypen inklusive Speicher
