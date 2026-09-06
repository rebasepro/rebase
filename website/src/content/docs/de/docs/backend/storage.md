---
sourceHash: 81774bf42418ed00
title: Speicherkonfiguration
sidebar_label: Speicherkonfiguration
description: Konfigurieren Sie lokale Dateisystem-, S3-kompatible oder GCS-/Firebase-Storage-Backends für Datei-Uploads, Bilder und Medien.
---

## Überblick

Rebase unterstützt drei Speicher-Backends:

- **Lokales Dateisystem** — Dateien auf der Festplatte gespeichert (ideal für die Entwicklung)
- **S3-kompatibel** — AWS S3, MinIO, Cloudflare R2, DigitalOcean Spaces
- **Google Cloud Storage / Firebase Storage** — Native GCS-Unterstützung über `@google-cloud/storage`

## Konfiguration

Der Speicher wird im `storage`-Block von `initializeRebaseBackend` konfiguriert:

### Lokaler Speicher

```typescript no-verify
const backend = await initializeRebaseBackend({
    // ...
    storage: {
        type: "local",
        basePath: "./uploads"   // Directory for file storage
    }
});
```

### S3-Speicher

```typescript no-verify
const backend = await initializeRebaseBackend({
    // ...
    storage: {
        type: "s3",
        bucket: env.S3_BUCKET!,
        region: env.S3_REGION || "auto",
        accessKeyId: env.S3_ACCESS_KEY_ID || "",
        secretAccessKey: env.S3_SECRET_ACCESS_KEY || "",
        endpoint: env.S3_ENDPOINT,          // For MinIO, R2, etc.
        forcePathStyle: env.S3_FORCE_PATH_STYLE  // Required for MinIO
    }
});
```

### GCS / Firebase Storage

```typescript no-verify
const backend = await initializeRebaseBackend({
    // ...
    storage: {
        type: "gcs",
        bucket: env.GCS_BUCKET!,
        projectId: env.GCS_PROJECT_ID,
    }
});
```

Auf GCP (Cloud Run, GCE, GKE) werden die Anmeldedaten des Standard-Dienstkontos automatisch verwendet. Außerhalb von GCP setzen Sie die Umgebungsvariable `GOOGLE_APPLICATION_CREDENTIALS` auf den Pfad zu Ihrer Dienstkonto-Schlüsseldatei.

### Mehrere Speicher-Backends

Sie können mehrere benannte Backends konfigurieren und verschiedene Felder an verschiedene Speicher weiterleiten:

```typescript
storage: {
    "(default)": { type: "local", basePath: "./uploads" },
    "media": { type: "s3", bucket: "media-bucket", region: "us-east-1", ... }
}
```

Verweisen Sie dann in Ihren Collection-Properties auf ein bestimmtes Backend:

```typescript
image: {
    type: "string",
    name: "Image",
    storage: {
        storagePath: "products",
        storageSource: "media"  // Routes to the "media" S3 backend
    }
}
```

## Speicher-Endpunkte

| Methode | Pfad | Beschreibung |
|--------|------|-------------|
| `POST` | `/api/storage/upload` | Direkter Datei-Upload |
| `POST` | `/api/storage/upload?storageId=<key>` | Upload zu einem bestimmten benannten Backend |
| `GET` | `/api/storage/files/:path` | Eine Datei abrufen |
| `GET` | `/api/storage/files/:path?storageId=<key>` | Eine Datei aus einem bestimmten Backend abrufen |
| `DELETE` | `/api/storage/files/:path` | Eine Datei löschen |
| `OPTIONS` | `/api/storage/tus` | Unterstützte Fähigkeiten des TUS-Protokolls abfragen |
| `POST` | `/api/storage/tus` | Eine fortsetzbare TUS-Upload-Sitzung starten |
| `HEAD` | `/api/storage/tus/:id` | Upload-Fortschritt prüfen (Byte-Offset) |
| `PATCH` | `/api/storage/tus/:id` | Datenblock an temporäre Datei anhängen |
| `DELETE` | `/api/storage/tus/:id` | TUS-Upload-Sitzung beenden/abbrechen |

## Bildtransformationen im Handumdrehen

Rebase enthält eine integrierte Bildverarbeitungspipeline auf Basis von **Sharp**. Beim Ausliefern von Bild-Assets aus dem Speicher können Sie dynamische Operationen über Query-Parameter anwenden:

```bash
# Serve image scaled to 300px width in webp format
GET /api/storage/files/products/laptop.jpg?width=300&format=webp
```

### Unterstützte Parameter

- `width`: Skaliert das Bild auf die angegebene Breite (unter Beibehaltung des Seitenverhältnisses).
- `format`: Konvertiert das Bildformat. Unterstützte Formate: `webp`, `jpeg`, `png`, `avif`.

### Leistung & LRU-Caching

Um eine hohe CPU-Auslastung und Skalierungslatenz bei hohem Datenaufkommen zu vermeiden, werden verarbeitete Bilder in einem speichergestützten **LRU-Cache** abgelegt:
- **Kapazität**: Global auf **500 Einträge** begrenzt.
- **TTL (Time to Live)**: Zwischengespeicherte Varianten laufen nach **1 Stunde** ab.
- Nachfolgende Anfragen für dieselbe Größen-/Format-Kombination treffen den LRU-Cache sofort und verhindern redundante Dateimanipulation.

## TUS-Protokoll für fortsetzbare Uploads

Zum Hochladen großer Dateien (bis zu **5 GB**) oder zum Umgang mit instabilen Netzwerkbedingungen implementiert Rebase das offene Protokoll **TUS v1.0.0** einschließlich der Erweiterungen `Creation` und `Termination`.

```
Client                                                   Rebase Server
  │                                                           │
  │─── POST /api/storage/tus (Upload-Length: 50000000) ──────>│ (Generates session ID)
  │<── 201 Created (Location: /api/storage/tus/uuid-abc) ────│
  │                                                           │
  │─── PATCH /api/storage/tus/uuid-abc (Upload-Offset: 0) ───>│ (Appends chunk via open/write)
  │<── 204 No Content (Upload-Offset: 1500000) ───────────────│
  │                                                           │
  │─── PATCH /api/storage/tus/uuid-abc (Upload-Offset: 1.5M) ─>│ (Upload finishes)
  │<── 204 No Content (Upload-Offset: 50000000) ──────────────│ (Copies to storage, unlinks temp)
```

### Mechanik des Upload-Lebenszyklus

1. **Sitzungsinitialisierung (`POST`)**: Der Client sendet die Gesamtgröße der Datei im Header `Upload-Length` und Base64-Metadaten über `Upload-Metadata`. Der Server erstellt eine leere Platzhalterdatei unter einem versteckten temporären Verzeichnis `.tus-uploads/` und gibt die Upload-URL zurück.
2. **Fortschrittsabfragen (`HEAD`)**: Wird ein Upload unterbrochen, fragt der Client die Upload-URL mit einer `HEAD`-Anfrage ab. Der Server gibt die aktuelle Byte-Position im Header `Upload-Offset` zurück.
3. **Daten anhängen (`PATCH`)**: Der Client setzt das Senden binärer Daten ab dem zurückgegebenen Offset mit `Content-Type: application/offset+octet-stream` fort. Der Server schreibt eingehende Blöcke direkt in die temporäre Datei mithilfe der Low-Level-Dateisystem-APIs `open` und `write` von Node am angegebenen Byte-Offset.
4. **Finalisierung**: Wenn der akkumulierte `Upload-Offset` mit der deklarierten `Upload-Length` übereinstimmt, liest Rebase die fertige temporäre Datei, verpackt sie als standardmäßiges JavaScript-`File`-Objekt und speichert sie im konfigurierten Speicher-Backend (lokale Festplatte oder S3). Die temporäre Datei wird anschließend gelöscht.
5. **Periodische Bereinigung**: Ein Hintergrund-Cleaner läuft alle **60 Sekunden**, um verwaiste, unvollständige temporäre Uploads zu löschen, die die **24-Stunden**-Aufbewahrungsschwelle überschritten haben.

## Umgebungsvariablen

| Variable | Beschreibung |
|----------|-------------|
| `STORAGE_TYPE` | `"local"`, `"s3"` oder `"gcs"` |
| `STORAGE_PATH` | Lokales Speicherverzeichnis (Standard: `./uploads`) |
| `S3_BUCKET` | Name des S3-Buckets |
| `S3_REGION` | AWS-Region (Standard: `"auto"`) |
| `S3_ACCESS_KEY_ID` | AWS-Access-Key |
| `S3_SECRET_ACCESS_KEY` | AWS-Secret-Key |
| `S3_ENDPOINT` | Benutzerdefinierter S3-Endpunkt (für MinIO, R2) |
| `S3_FORCE_PATH_STYLE` | Path-Style-URLs verwenden (erforderlich für MinIO) |
| `GCS_BUCKET` | Name des Google-Cloud-Storage-Buckets |
| `GCS_PROJECT_ID` | GCP-Projekt-ID für GCS |
| `GOOGLE_APPLICATION_CREDENTIALS` | Pfad zur GCP-Dienstkonto-Schlüsseldatei (auf GCP mit Standard-Anmeldedaten nicht erforderlich) |

## Frontend-Speicherquellen

Wenn Sie mehrere Speicher-Backends verwenden, übergeben Sie `storageSources` an den `<Rebase>`-Provider, damit das Frontend weiß, wie Uploads direkt weitergeleitet werden:

```tsx
import { Rebase } from "@rebasepro/app";

<Rebase
    apiUrl="https://api.example.com"
    storageSources={[
        { key: "media", label: "Media CDN" },
        { key: "firebase", label: "Firebase Storage" },
    ]}
>
    {/* ... */}
</Rebase>
```

Der `key` jeder Quelle muss mit einem im `storage`-Map des Servers registrierten Backend-Schlüssel übereinstimmen. Der React-Kontext `StorageSourcesContext` löst die aktive Quelle für jedes Upload-Feld auf.

## Tipps für die Produktion

:::caution
**In der Produktion deaktiviert `type: "local"` den Dateispeicher, statt ihn zu verwenden.** Auf ephemeren Plattformen (Cloud Run, Heroku, ein Kubernetes-Pod) wird das Dateisystem bei jedem Deployment, Neustart und Eviction gelöscht — Uploads würden also erfolgreich sein, sich sauber lesen lassen und beim nächsten Rollout verschwunden sein, ohne jede Fehlermeldung.

Deshalb wird kein Speicher-Backend registriert und `/api/storage/*` antwortet mit **`501 STORAGE_NOT_CONFIGURED`**. Uploads scheitern sichtbar und behebbar, und der Rest der Anwendung läuft weiter.

Setzen Sie `STORAGE_TYPE=s3` oder `gcs`. Wenn wirklich ein **dauerhaftes Volume** unter `STORAGE_PATH` eingebunden ist, sagen Sie das explizit mit `FORCE_LOCAL_STORAGE=true`.
:::

- Binden Sie ein **persistentes Volume** ein, wenn Sie lokalen Speicher auf Docker/Kubernetes verwenden, und setzen Sie `FORCE_LOCAL_STORAGE=true`
- Verwenden Sie **S3** oder Kompatibles (R2, MinIO) für Produktionsbereitstellungen
- Konfigurieren Sie ein **CDN** (CloudFront, Cloudflare) vor Ihrem S3-Bucket für die Leistung

## Nächste Schritte

- **[Frontend-Speicher & Datei-Uploads](/docs/frontend/storage)** — Datei-Upload-Felder und Hooks
- **[Properties](/docs/collections/properties)** — Konfiguration der Storage-Property
