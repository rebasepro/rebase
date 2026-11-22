---
sourceHash: 1eae92c45ebedd91
title: Speicher-Konfiguration
sidebar_label: Speicher-Konfiguration
description: Konfigurieren Sie lokales Dateisystem, S3-kompatible oder GCS/Firebase Storage-Backends für Datei-Uploads, Bilder und Medien.
---

## Übersicht

Rebase unterstützt drei Storage-Backends:

- **Lokales Dateisystem** — Auf der Festplatte gespeicherte Dateien (ideal für die Entwicklung)
- **S3-kompatibel** — AWS S3, MinIO, Cloudflare R2, DigitalOcean Spaces
- **Google Cloud Storage / Firebase Storage** — Native GCS-Unterstützung via `@google-cloud/storage`

## Konfiguration

<span class="since-badge" data-since="0.35">Seit 0.35</span>

:::note[Wo dies hingehört]
**Managed-Runtime** — die `STORAGE_*`-Variablen in `.env` (`STORAGE_TYPE`, `S3_BUCKET` / `GCS_BUCKET`, `STORAGE_PATH`, `STORAGE_PUBLIC_READ`, … — versehen Sie jede davon mit dem Suffix `__<KEY>` für eine benannte Quelle), plus eine `bucket("<key>")`-Deklaration in `backend/resources.ts` für jeden Bucket über den Standard-Bucket hinaus, sowie `export const storageAuthorize` aus `backend/storage.ts`. Regeln pro Objekt können auch als Daten in `STORAGE_POLICIES` festgelegt werden — "public", "authenticated", "owner" (das `:uid`-Segment des Schlüssels ist der Aufrufer) und Rollen — siehe [Speicher-Autorisierung](/docs/backend/storage-authorization/#as-data-storage_policies).

**Ejected** — der `storage`-Block in `initializeRebaseBackend({ … })`. `storagePolicies` und `storageTriggers` stehen nur im Ejected-Modus zur Verfügung.

Die vollständige Zuordnung finden Sie in der [Backend-Übersicht](/docs/backend/#where-each-option-lives).
:::

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

Lokaler Speicher speichert die Metadaten jedes Objekts daneben als `<key>.metadata.json`. Daher wird ein Schlüssel, dessen letztes Segment auf `.metadata.json` endet, auf jeder Route mit `400 INVALID_STORAGE_KEY` abgelehnt. S3 und GCS speichern Metadaten am Objekt selbst und können beliebige Schlüssel speichern. Auf einem Dateisystem ohne Berücksichtigung der Groß-/Kleinschreibung (case-insensitive, standardmäßig unter macOS und Windows) sind `Avatar.png` und `avatar.png` dieselbe lokale Datei, aber zwei unterschiedliche Objekte auf S3, GCS oder einem Linux-Datenträger. Daher warnt der Server beim Booten, wenn sich der Speicherordner auf einem solchen Dateisystem befindet.

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

### GCS- / Firebase-Speicher

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

Auf GCP (Cloud Run, GCE, GKE) werden die Standard-Anmeldeinformationen des Dienstkontos automatisch verwendet. Außerhalb von GCP setzen Sie die Umgebungsvariable `GOOGLE_APPLICATION_CREDENTIALS` auf den Pfad Ihrer Dienstkonto-Schlüsseldatei.

### Mehrere Storage-Backends

Sie können mehrere benannte Backends konfigurieren und verschiedene Felder an unterschiedliche Speicher routen:

```typescript
storage: {
    "(default)": { type: "local", basePath: "./uploads" },
    "media": { type: "s3", bucket: "media-bucket", region: "us-east-1", ... }
}
```

Anschließend verweisen Sie mit `source` von einer Storage-Spalte auf ein bestimmtes Backend:

```typescript
image: col.storage({ path: "products/", source: "media" }),  // Routes to the "media" S3 backend
```

## Storage-Endpunkte

| Methode | Pfad | Beschreibung |
|--------|------|-------------|
| `POST` | `/api/storage/upload` | Direkter Datei-Upload, ein einzelner `multipart/form-data`-Body: `file` (erforderlich); `key`, der Objektschlüssel einschließlich Verzeichnissen (`author_pictures/ada.jpg`), andernfalls der Dateiname im Stammverzeichnis; `bucket`, andernfalls der Standard-Bucket; `storageId`; `collection` und `property`, wodurch die Datei an `maxSize` und `acceptedFiles` dieser Eigenschaft gebunden wird; und `metadata_<name>` für benutzerdefinierte Metadaten. Jedes andere Feld wird ignoriert: Es gibt kein `path`-Feld |
| `POST` | `/api/storage/upload?storageId=<key>` | Upload in ein bestimmtes benanntes Backend |
| `GET` | `/api/storage/file/*` | Datei abrufen — alles nach `/file/` ist der Objektschlüssel |
| `GET` | `/api/storage/file/*?storageId=<key>` | Datei von einem bestimmten Backend abrufen |
| `GET` | `/api/storage/metadata/*` | Größe, Content-Type und benutzerdefinierte Metadaten eines Objekts ohne dessen Bytes, plus ein kurzlebiges Download-Token, wenn es privat ist |
| `POST` | `/api/storage/metadata` | Dasselbe für bis zu 100 Objekte einer Quelle: Body `{ keys, storageId? }` |
| `DELETE` | `/api/storage/file/*` | Datei löschen |
| `GET` | `/api/storage/list` | Objekte unter einem Präfix auflisten (`prefix`, `bucket`, `maxResults`, `pageToken`, `storageId`). Ein `maxResults` kleiner als 1 oder ein `pageToken`, der von der Quelle nie ausgestellt wurde, führt zu `400 INVALID_LIST_OPTIONS` |
| `POST` | `/api/storage/folder` | Leere Verzeichnismarkierung erstellen |
| `GET` | `/api/storage/sources` | Die Speicherquellen, die dieses Backend bereitstellt, nach Schlüssel |
| `OPTIONS` | `/api/storage/tus` | Unterstützte TUS-Protokollfunktionen abfragen |
| `POST` | `/api/storage/tus` | Wiederaufnehmbare TUS-Upload-Sitzung initiieren |
| `HEAD` | `/api/storage/tus/:id` | Upload-Fortschritt prüfen (Byte-Offset) |
| `PATCH` | `/api/storage/tus/:id` | Daten-Chunk an temporäre Datei anhängen |
| `DELETE` | `/api/storage/tus/:id` | TUS-Upload-Sitzung beenden/abbrechen |

**Was sie antworten.** Ein Umschlag (Envelope), derselbe, den auch `/api/data` verwendet: Die Nutzlast befindet sich unter `data`, und ein Fehler ist `{ "error": { message, code, requestId } }` mit den Codes aus der [Fehlerreferenz](/docs/backend/errors/). `/api/storage/file/*` ist die Ausnahme, da dessen Nutzlast die Datei selbst ist — es antwortet mit den Bytes samt `Content-Type`, `Content-Length` und den Caching-Headern.

```json
// GET /api/storage/list?prefix=products/images/
{ "data": { "items": [ { "bucket": "default", "fullPath": "products/images/a.jpg", "name": "a.jpg",
  "size": 48213, "updated": "2026-10-01T12:00:00.000Z", "contentType": "image/jpeg" } ], "prefixes": [] } }
```

Ein Listing beschreibt jede zurückgegebene Datei: ihre `size` in Bytes und `updated`, wann sie zuletzt geschrieben wurde, bei lokalem Speicher, S3 und GCS, sowie ihren `contentType` bei lokalem Speicher und GCS. Ein S3-Listing enthält den Typ nicht, daher fehlt er bei S3 und `/api/storage/metadata/*` gibt ihn weiterhin an. Ein Ordner in `prefixes` enthält keines davon, ebenso wenig wie ein benutzerdefinierter `StorageController`, der sie nicht setzt.

`POST /api/storage/upload` antwortet mit `201` und dem `{ key, bucket, storageUrl }` des gespeicherten Objekts unter `data`; `GET /api/storage/metadata/*` mit den Metadaten des Objekts und, bei einem privaten Objekt, dem kurzlebigen `token`; `POST /api/storage/metadata` mit einem Objekt, dessen Schlüssel die übergebenen Pfade sind, wobei jeder Eintrag das enthält, was das `GET` dafür geantwortet hätte (siehe unten). Ein Ordner ist kein Objekt: `/metadata` auf einem Schlüssel, der mit `/` endet, liefert auf jedem Speicher `404`, selbst wenn S3 oder GCS eine `folder/`-Markierung vorhalten, sodass für ein Präfix kein Download-Token erzeugt wird; `GET /api/storage/sources` gibt das Array der konfigurierten Quellen mit `configured: true` zurück. Bei einem Deployment ganz ohne Speicher antwortet es mit `200 {"data": [], "configured": false}`, während jede andere Route `501 STORAGE_NOT_CONFIGURED` zurückgibt. `GET /api/auth/config` meldet dieselbe Tatsache als `storage: false`, sodass ein Client sich die Anfrage sparen kann. `GET /api/storage/sources` ist öffentlich: Es antwortet auch dann ohne Token, wenn `requireAuth` aktiviert ist. Es nennt die Quellen (ihren Schlüssel, ihre Engine, ihren Transport und ihr Label) und niemals eine Datei, und das Client-SDK liest es aus, um seine Quellen zu verdrahten, was geschehen kann, bevor sich jemand angemeldet hat. Eine App, die eine `direct`-Quelle anonym liest, benötigt dies ebenfalls. Jede Route, die eine Datei auflistet, liest oder schreibt, behält ihre Authentifizierung bei. `DELETE /api/storage/file/*` und `POST /api/storage/folder` enthalten lediglich eine `message`, da es nichts zurückzugeben gibt.

Auf S3 und GCS muss ein `bucket` einer sein, den die Quelle bedient, sowohl bei Schreib- als auch bei Leseoperationen: Ein Upload, ein `POST /api/storage/folder` oder ein TUS-Upload, der einen anderen Bucket angibt, antwortet mit `404 UNKNOWN_STORAGE_SOURCE`, genau wie das Listing. Lokaler Speicher erstellt beim ersten Schreibvorgang weiterhin einen Bucket.

**Viele Objekte auf einmal.** `POST /api/storage/metadata` akzeptiert `{ "keys": ["photos/a.png", "photos/b.png"], "storageId": "media" }` — bis zu 100 Objektpfade einer Quelle, jeweils so angegeben, wie `GET /api/storage/metadata/<key>` sie erwartet — und antwortet mit einem Eintrag pro Schlüssel:

```json
{ "data": {
  "photos/a.png": { "fullPath": "photos/a.png", "size": 48213, "contentType": "image/png", "token": "…", "tokenExpiresIn": 300 },
  "photos/b.png": { "error": { "code": "FORBIDDEN", "message": "Not authorized for this object", "status": 403 } }
} }
```

Jeder Schlüssel wird genau so beurteilt wie beim `GET` — derselbe `storageAuthorize`-Hook und Storage-Scope, dieselbe Public-Regel, ein eigenes Download-Token — und ein Schlüssel, der abgelehnt wird, fehlt oder ungültig ist, antwortet mit seinem eigenen `error`, ohne fehlzuschlagen oder die anderen preiszugeben. Ein Aufrufer ohne Sitzung in einem Deployment, das eine erfordert, erhält das `401`, das das `GET` antworten würde, es sei denn, jeder Schlüssel ist öffentlich. Mehr als 100 Schlüssel oder ein Body ohne `keys` führt zu `400 BAD_REQUEST`. Der Rate Limiter zählt die Anfrage als ⌈N/10⌉ Anfragen für N Schlüssel, sodass eine Seite mit 100 Thumbnails 10 Anfragen kostet. `client.storage.getSignedUrl()` und das Admin-Panel fassen die Abfragen einer Seite auf diese Weise zusammen und greifen auf einem Server ohne diese Route auf ein einzelnes `GET` pro Datei zurück.

**Wie ein Lesezugriff auf eine Datei autorisiert wird.** Die Lese-Routen — `/api/storage/file/*` und `/api/storage/metadata/*` — akzeptieren das kurzlebige signierte Token, das [`getSignedUrl()`](/docs/sdk/storage) generiert, übergeben als `?token=<token>` oder als `Bearer`. Ein gewöhnliches Zugriffs-JWT wird auf `/file/*` mit `401 Unauthorized: Access JWT not allowed on file routes` **abgelehnt**: Das Token, das auf jeder anderen Route funktioniert, funktioniert dort mit Absicht nicht, da eine Datei-URL an einen Browser, ein CDN oder ein `<img>`-Tag übergeben wird. Jede andere Zeile oben akzeptiert das Zugriffs-JWT wie gewohnt.

## On-the-Fly-Bildtransformationen

Rebase enthält eine integrierte Bildverarbeitungspipeline, die von **Sharp** angetrieben wird. Beim Ausliefern von Bild-Assets aus dem Speicher können Sie dynamische Operationen über Abfrageparameter anwenden:

```bash
# Serve image scaled to 300px width in webp format
GET /api/storage/file/products/laptop.jpg?width=300&format=webp
```

### Unterstützte Parameter

- `width`, `height`: Größenbegrenzungen, `1`–`4096` (das Bild wird niemals vergrößert).
- `quality`: `1`–`100`.
- `format`: Konvertiert das Bildformat. Unterstützte Formate: `webp`, `jpeg`, `png`, `avif`.
- `fit`: `cover`, `contain`, `fill`, `inside` oder `outside`.

Ein Parameter außerhalb dieser Grenzen führt zu einem **400**, nicht zu einem stillschweigend begrenzten Wert — `?width=99999` lieferte früher ein 4096px-Bild und `?format=tiff` ein WebP-Bild zurück, ohne dass dies signalisiert wurde.

Die Thumbnails des Admin-Panels für gespeicherte Bilder nutzen diesen Endpunkt: Eine Tabellen- oder Kartenvorschau fordert eine WebP-Version in etwa der doppelten gerenderten Größe (96–800px) anstelle des Originals an. SVG- und GIF-Dateien werden immer im Originalzustand angezeigt. `sharp` ist optional: Ohne dieses Paket liefert eine Transformationsanfrage das Original und das Backend warnt einmalig, `pnpm add sharp` in `backend/` auszuführen.

### Performance & LRU-Caching

Transformationen sind CPU- und arbeitsspeicherintensiv, und bei einem öffentlichen Objekt ist der Endpunkt anonym erreichbar, sodass die Arbeit begrenzt und nicht bloß zwischengespeichert wird:
- **Kapazität**: Ein LRU-Cache, der global auf **500 Einträge** begrenzt ist, verschlüsselt nach Speicherquelle, Bucket und kanonischem Schlüssel.
- **TTL (Time to Live)**: Gecachte Varianten laufen nach **1 Stunde** ab.
- Gleichzeitige Anfragen für dieselbe nicht gecachte Variante erzeugen **eine einzige** Transformation, nicht jeweils eine pro Anfrage.
- Es wird nur eine geringe Anzahl an Transformationen gleichzeitig ausgeführt; bei Überschreiten einer begrenzten Warteschlange antwortet der Server mit **503 `TRANSFORM_OVERLOADED`**, anstatt Arbeit anzunehmen, die er nicht zeitnah bewältigen kann.

Dieser Cache lebt im Prozess, was bedeutet, dass er nicht zwischen Instanzen geteilt wird und einen Neustart nicht übersteht. Zwei Replikate berechnen jede Variante separat, und ein Deployment verwirft den gesamten Cache.

### Bildvarianten (Renditions), die einen Neustart überstehen

`storageRenditionCache` schreibt jedes abgeleitete Bild zurück in denselben Bucket wie seine Quelle, sodass die Arbeit einmal für das gesamte Deployment erledigt wird anstatt einmal pro Instanz und Release:

```ts
storageRenditionCache: { enabled: true }
```

oder `STORAGE_RENDITION_CACHE=true` für ein Bundle-Deployment. Renditions werden unter dem reservierten Präfix `_rebase/renditions/` gespeichert, verschlüsselt nach der Version des Quellobjekts — das Ersetzen eines Bildes liefert also sofort das neue Bild aus.

Drei Dinge sollten Sie wissen, bevor Sie dies aktivieren:

- **Ein Lesezugriff schreibt nun.** Jede neue Variante kostet einen `PUT` in Ihrem Bucket. Aus diesem Grund ist die Option standardmäßig deaktiviert.
- **Ein fehlgeschlagener Schreibvorgang ist keine fehlgeschlagene Anfrage.** Schreibgeschützte Anmeldedaten oder eine Bucket-Policy, die das Präfix verweigert, fallen auf den prozessinternen Cache zurück; das Bild wird weiterhin ausgeliefert und der Grund einmalig protokolliert.
- **Abgelöste Renditions werden nicht automatisch bereinigt.** Das Ersetzen eines Quellobjekts hinterlässt seine alten Renditions. Richten Sie eine Lifecycle-Regel für `_rebase/renditions/` ein — dieses Präfix ist fest vorgegeben und nicht konfigurierbar, genau damit eine Regel darauf verweisen kann.

Das Präfix ist über die API nicht adressierbar. Ein direkter Lese- oder Schreibzugriff darauf antwortet mit **400 `INVALID_STORAGE_KEY`**: Jede Zugriffsregel im Produkt — `storageAuthorize` ebenso wie die deklarativen Richtlinien — wird gegen den *Quell*-Schlüssel geschrieben, und eine unter ihrem eigenen Pfad ausgelieferte Rendition würde eine Frage beantworten, die niemand gestellt hat.

`_rebase/maintenance/` ist auf dieselbe Weise reserviert. `rebase storage orphans` speichert das Protokoll jedes Scans dort, in der gescannten Quelle, sodass der Prozess, der den Scan durchführt, und derjenige, der seinen Status abfragt, dasselbe Protokoll lesen. Ein Aufrufer, der ein Protokoll schreiben könnte, könnte auswählen, was ein späterer Löschvorgang entfernt. Daher führt das Lesen, Schreiben oder Auflisten dieses Präfixes ebenfalls zu einem 400-Fehler. Protokolle werden 7 Tage nach ihrem letzten Schreibvorgang gelöscht, wenn der nächste Scan dieser Quelle startet.

### Was ausgeliefert wird

Der gespeicherte Content-Type entspricht den Angaben des Uploaders — die Bytes werden nicht analysiert —, sodass `/api/storage/file/*` nur eine **strenge Allowlist** inline rendert: Bilder, Video, Audio, `application/pdf` und `text/plain`. Alles andere, einschließlich `text/html`, wird als `application/octet-stream` mit `Content-Disposition: attachment` ausgeliefert, und jede Antwort enthält `X-Content-Type-Options: nosniff`. Storage ist kein Webhoster: Eine hochgeladene Seite, die auf dem API-Origin gerendert wird, könnte Cookies dieses Origins auslesen und dessen Endpunkte aufrufen.

Ein SVG ist ein Bild, das zugleich ein Dokument ist und `<script>` enthalten kann. Es wird als `image/svg+xml` ausgeliefert — sodass es in einem `<img>` und in den Thumbnails des Admin-Panels gerendert wird — mit `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox` bei jeder Antwort, einschließlich transformierter URLs und URLs mit Download-Token. Direkt geöffnet wird es mit deaktivierten Skripten und einem opaken Origin gerendert, sodass es weder auf Cookies noch auf Endpunkte der API zugreifen kann.

## Wie groß eine Datei sein darf

Jede Speicherquelle akzeptiert Dateien bis zu ihrem eigenen Limit: **50 MB**, es sei denn, `STORAGE_MAX_FILE_SIZE` (in Bytes, mit dem Suffix `__<KEY>` für eine benannte Quelle) oder das `maxFileSize` der Quelle gibt etwas anderes vor. Jeder Zugriffsweg bindet eine Datei an denselben Wert. `POST /api/storage/upload` antwortet darüber mit `413 PAYLOAD_TOO_LARGE`; ein wiederaufnehmbarer Upload wird bei der Erstellung vor seinem ersten Chunk abgelehnt; und `OPTIONS /api/storage/tus` kündigt dies als `Tus-Max-Size` an — für die mit `?storageId=` benannte Quelle, andernfalls für die Standardquelle.

```bash
STORAGE_MAX_FILE_SIZE=209715200          # (default): 200 MB
STORAGE_MAX_FILE_SIZE__MEDIA=1073741824  # media: 1 GB
```

Wie viel von einer Datei der Server gleichzeitig im Speicher hält, hängt vom Zugriffsweg ab. `POST /api/storage/upload` ist ein einzelner Multipart-Body, den der Server vollständig parst: das Drei- bis Fünffache der Dateigröße im Arbeitsspeicher. Ein wiederaufnehmbarer (TUS-)Upload hält jeweils nur einen Chunk im Speicher. `client.storage.putObject()` und das Admin-Panel senden Dateien über 8 MiB über den wiederaufnehmbaren Pfad. Siehe [Wiederaufnehmbare Uploads (TUS)](/docs/backend/storage-resumable-uploads/) für das Protokoll, die Antworten und das Verhalten über Instanzen hinweg.

## Umgebungsvariablen

<span class="since-badge" data-since="0.35">Seit 0.35</span>

| Variable | Beschreibung |
|----------|-------------|
| `STORAGE_TYPE` | `"local"`, `"s3"` oder `"gcs"` |
| `STORAGE_PATH` | Lokales Speicherverzeichnis (Standard: `<project>/uploads`, sowohl unter `rebase dev` als auch in einem von `rebase eject` erstellten Server). Ein relativer Pfad wird ausgehend von dem Verzeichnis gelesen, in dem der Server ausgeführt wird, was nach `rebase eject` `backend/` ist. Ein benannter lokaler Bucket speichert seine Dateien daneben in `<STORAGE_PATH>__<key>`, es sei denn, `STORAGE_PATH__<KEY>` definiert einen eigenen Pfad |
| `S3_BUCKET` | S3-Bucket-Name |
| `S3_REGION` | AWS-Region (Standard: `"auto"`) |
| `S3_ACCESS_KEY_ID` | AWS-Access-Key |
| `S3_SECRET_ACCESS_KEY` | AWS-Secret-Key |
| `S3_ENDPOINT` | Benutzerdefinierter S3-Endpunkt (für MinIO, R2) |
| `S3_FORCE_PATH_STYLE` | Path-Style-URLs verwenden (erforderlich für MinIO) |
| `GCS_BUCKET` | Google Cloud Storage-Bucket-Name |
| `GCS_PROJECT_ID` | GCP-Projekt-ID für GCS |
| `GCS_KEY_FILENAME` | Pfad zu einer GCP-Dienstkonto-Schlüsseldatei (auf GKE weglassen — Workload Identity/ADC stellt Anmeldeinformationen bereit) |
| `GOOGLE_APPLICATION_CREDENTIALS` | Standard-ADC-Variable, die vom Google-SDK selbst gelesen wird (auf GCP mit Standard-Anmeldeinformationen nicht erforderlich) |
| `STORAGE_DOWNLOAD_TOKEN_TTL` | Wie lange die Download-URL einer privaten Datei gültig ist, in Sekunden — die Lebensdauer des Tokens, das `/api/storage/metadata/*` generiert (Standard `300`, maximal `604800`, eine Woche). Erhöhen Sie diesen Wert für private Videos und Audiodateien, die nach dem Rendern der Seite fortlaufend Ranges anfordern. Die Env-Schreibweise von `storageDownloadTokenTtl` |
| `STORAGE_MAX_FILE_SIZE` | Maximale Dateigröße, die die Quelle akzeptiert, in Bytes (Standard `52428800`, 50 MB). Fügen Sie das Suffix `__<KEY>` für eine benannte Quelle an. Ein Wert, der keine ganze Anzahl an Bytes ist, verweigert den Bootvorgang. Siehe [Wie groß eine Datei sein darf](#wie-groß-eine-datei-sein-darf) |
| `FORCE_LOCAL_STORAGE` | Erlaubt `STORAGE_TYPE=local` in der Produktion — siehe unten |
| `STORAGE_PUBLIC_READ` | Gespeicherte Objekte für nicht authentifizierte Leser bereitstellen. Die Env-Schreibweise von `storagePublicRead` und eine der drei Möglichkeiten, die [Production Boot Guard](#autorisierung-pro-objekt) zu erfüllen. |
| `STORAGE_POLICIES` | Speicherzugriffsregeln als JSON: `[{ "path", "operations"?, "allow" }]`, wobei `allow` entweder `"public"`, `"authenticated"`, `"owner"` oder `{ "roles": [...] }` ist. Standardmäßig wird der Zugriff verweigert (Deny by default); erfüllt die [Production Boot Guard](#autorisierung-pro-objekt). Eine ungültige Liste verhindert den Bootvorgang. Siehe [Speicher-Autorisierung](/docs/backend/storage-authorization/#as-data-storage_policies). |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Deaktiviert die Boot Guard und stellt das Verhalten wieder her, bei dem jeder angemeldete Benutzer jeden Schlüssel lesen, überschreiben, löschen oder auflisten darf. Die Env-Schreibweise von `storageInsecureAllowAnyAuthenticated`. Nur vertretbar, wenn jedem angemeldeten Benutzer jede Datei anvertraut werden kann. |

## Mehrere Buckets

Ein Projekt kann mehr als einen Bucket besitzen. Deklarieren Sie jeden einzelnen in `backend/resources.ts` — der zentralen Stelle, die Plattform, Runtime und Konsole gleichermaßen auslesen:

```ts
import { bucket } from "@rebasepro/types";

export const uploads = bucket({ engine: "s3" });    // the default one
export const media = bucket("media", { engine: "s3", label: "Media" });
```

Führen Sie dann `rebase resources --write` aus, wodurch `rebase.resources.json` neu generiert wird, sodass ein Host Ihre Topologie ohne Build auslesen kann. Siehe [Mehrere Quellen](/docs/backend/multiple-sources) für Datenbanken, Buckets und Topics zusammen.

Jede Quelle wird über **dieselben Variablennamen konfiguriert, die ihr eigenes Suffix tragen**. Die Standardquelle erhält kein Suffix, sodass ein Projekt mit nur einem Bucket weiterhin die einfachen obigen Namen verwendet und gar nichts deklarieren muss. Das Deklarieren benannter Buckets daneben ändert daran nichts ([Details](/docs/backend/multiple-sources/#which-bucket-receives-an-unqualified-upload)):

```bash
S3_BUCKET=app-uploads             # (default)
S3_BUCKET__MEDIA=app-media        # media
S3_ACCESS_KEY_ID__MEDIA=…
S3_SECRET_ACCESS_KEY__MEDIA=…
```

Das Suffix wird aus dem Schlüssel abgeleitet: in Großbuchstaben umgewandelt, nicht-alphanumerische Zeichen zu Unterstrichen zusammengefasst, nach einem **doppelten** Unterstrich (`media-cdn` → `__MEDIA_CDN`). Ein einzelner Unterstrich würde mit echten Variablennamen kollidieren — `S3_BUCKET_NAME` würde sonst als Bucket `name` geparst.

Routen Sie eine Spalte mit `source` zu einer Quelle:

```ts
cover: col.storage({ path: "covers/", source: "media", accept: ["image/*"] }),
```

Eine Quelle, die Sie deklarieren, aber nie konfigurieren, wird **übersprungen** und führt nicht zu einem fatalen Fehler: Uploads, die an sie geroutet werden, antworten mit `501 STORAGE_SOURCE_NOT_CONFIGURED`. Das Deklarieren eines Buckets geschieht in der Regel, bevor jemand Speicher daran anbindet, und ein Boot-Fehler an dieser Stelle würde das Backend in eine Crash-Schleife versetzen, bis dies erledigt ist. Eine Quelle, die die Umgebung *falsch* konfiguriert — ein Typ ohne Bucket oder ein Bucket ohne Anmeldedaten —, wird beim Booten abgelehnt, da es sich dabei um einen Fehler und nicht um ein Fehlen handelt.

### Buckets, die sich ein Konto teilen

Anmeldedaten beschreiben üblicherweise den **Provider**, nicht den Bucket. Fünfzehn Buckets auf einer einzigen MinIO-Installation würden andernfalls fünfzehn Kopien desselben Zugriffsschlüssels bedeuten, und eine Rotation erforderte fünfzehn paarweise Änderungen. Benennen Sie stattdessen ein Konto:

```ts
export const media = bucket("media", { engine: "s3", account: "minio" });
export const avatars = bucket("avatars", { engine: "s3", account: "minio" });
```

```bash
S3_BUCKET__MEDIA=b-media          # per bucket, always
S3_BUCKET__AVATARS=b-avatars
S3_ACCESS_KEY_ID__MINIO=…         # shared by both
S3_SECRET_ACCESS_KEY__MINIO=…
S3_ENDPOINT__MINIO=https://minio.internal
```

Nur die auf das Konto bezogenen Variablen nutzen den Fallback — `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_ENDPOINT`, `S3_REGION`, `S3_FORCE_PATH_STYLE` sowie das GCS-Paar `GCS_PROJECT_ID` / `GCS_KEY_FILENAME`. Der Bucket-Name greift niemals darauf zurück: Er unterscheidet eine Quelle von der anderen. Ein Wert pro Bucket hat weiterhin Vorrang, sodass eine Quelle den Provider wechseln kann, ohne die anderen zu beeinträchtigen.

### Nicht mehr referenzierte Dateien nach Zeitplan löschen

Das Löschen einer Zeile belässt deren Dateien im Bucket. Mit der Zeile wird nichts gelöscht: Eine andere Zeile, eine Version im [Verlauf](/docs/backend/history/) oder Ihr eigener Code, der den Schlüssel in einem einfachen String hält, könnte die Datei noch referenzieren. Ein Bucket kann stattdessen die Bereinigung anfordern, die all diese Stellen berücksichtigt:

```ts
export const voice = bucket("voice", { engine: "s3", orphanSweep: { olderThanHours: 72 } });
export const media = bucket("media", { orphanSweep: true }); // a week, daily at 04:17 UTC
```

Jeder deklarierte Sweep ist ein Cron-Job namens `storage-orphan-sweep-<bucket>` (`storage-orphan-sweep-default` für den Standard-Bucket). Er führt den Scan hinter `rebase storage orphans --delete` aus. Dieser Scan liest jede Zeile jeder Tabelle und jeden Verlaufseintrag und behält Folgendes:

- eine Datei, die noch irgendwo referenziert wird;
- eine Datei, die neuer ist als `olderThanHours` (mindestens 24, standardmäßig eine Woche);
- alle Dateien, für diesen Lauf, wenn eine Tabelle nicht gelesen werden kann.

Anschließend prüft er jede Datei unmittelbar vor dem Löschen erneut. Setzen Sie `schedule` auf einen Cron-Ausdruck (UTC), um zu ändern, wann er ausgeführt wird. Da es sich um einen Cron-Job handelt, läuft er auf einer Instanz pro Slot. Sein Ausführungsverlauf zeichnet auf, wie viele Dateien gelöscht und behalten wurden, und er kann über die Cron-Liste des Admins angehalten oder manuell gestartet werden. Er erfordert einen Bucket, den dieses Backend bedient: Ein Bucket mit `transport: "direct"` wird beim Booten mit einer Warnung abgewiesen.

## Frontend-Speicherquellen

Das Frontend erfährt die Quellen des Servers über `GET /api/storage/sources`, sodass eine `server`-Quelle keinen Eintrag benötigt. Übergeben Sie `storageSources` an den `<Rebase>`-Provider für eine `direct`-Quelle, die direkt zu ihrem Provider hochlädt, oder um ein Label bzw. den Transport selbst festzulegen:

```tsx
import { Rebase } from "@rebasepro/app";

<Rebase
    apiUrl="https://api.example.com"
    storageSources={[
        // `engine` names the provider, `transport` says who talks to it:
        // "server" proxies through the Rebase backend, "direct" goes
        // client-to-provider (and needs a `source` implementation).
        { key: "media", engine: "s3", transport: "server", label: "Media CDN" },
        { key: "firebase", engine: "firebase", transport: "server", label: "Firebase Storage" },
    ]}
>
    {() => <MyApp />}
</Rebase>
```

Der `key` einer `server`-Quelle muss mit einem Backend-Schlüssel übereinstimmen, der in der `storage`-Map des Servers registriert ist. Der React-Kontext `StorageSourcesContext` löst die aktive Quelle für jedes Upload-Feld auf.

## Caching und CDNs

Jedes Objekt wird über den Server weitergeleitet, mit einem `ETag` für eine ressourcenschonende Revalidierung, einem `Cache-Control`-Header, der davon abhängt, wer es lesen darf, und Byte-Ranges für das Vor- und Zurückspulen in Audio und Video. Unter [Storage-Caching und CDNs](/docs/backend/storage-caching/) finden Sie die Header und Hinweise dazu, was auf einem vorgeschalteten CDN konfiguriert werden sollte.

## Tipps für die Produktion

:::caution
**In der Produktion deaktiviert `type: "local"` den Dateispeicher, anstatt ihn zu verwenden.** Auf einer flüchtigen Plattform (Cloud Run, Heroku, ein Kubernetes-Pod) wird das Dateisystem bei jedem Deploy, Neustart und Eviction-Vorgang gelöscht — Uploads würden also erfolgreich sein, sich problemlos zurücklesen lassen und beim nächsten Rollout spurlos verschwunden sein, ohne dass zu irgendeinem Zeitpunkt ein Fehler auftritt.

Aus diesem Grund wird der lokale Standardwert nicht registriert, und eine Anfrage an `/api/storage/*`, die keine Speicherquelle benennt, antwortet mit **`501 STORAGE_NOT_CONFIGURED`** und nennt die Quellen, die bedient werden. Eine benannte Quelle, die konfiguriert ist, wie z. B. `bucket("media", { engine: "s3" })`, wird weiterhin bereitgestellt. Uploads schlagen unmissverständlich und wiederherstellbar fehl; der Rest der App läuft weiter. Dateispeicher ist in der Produktion Opt-in: Er existiert erst, sobald ein Bucket existiert.

Setzen Sie `STORAGE_TYPE=s3` oder `gcs`. Wenn ein **dauerhaftes Volume** tatsächlich `STORAGE_PATH` bereitstellt, setzen Sie `FORCE_LOCAL_STORAGE=true`, um dies explizit anzugeben. Hängen Sie es an das übergeordnete Verzeichnis von `STORAGE_PATH` an, sodass sich das Verzeichnis `<STORAGE_PATH>__<key>` jedes benannten lokalen Buckets ebenfalls darauf befindet.
:::

- Binden Sie ein **persistentes Volume** über das übergeordnete Verzeichnis von `STORAGE_PATH` ein, wenn Sie lokalen Speicher auf Docker/Kubernetes verwenden, und setzen Sie `FORCE_LOCAL_STORAGE=true` — siehe [Self-Hosting](/docs/deployment/self-hosting/#file-storage)
- Verwenden Sie **S3** oder kompatible Lösungen (R2, MinIO) oder **GCS** für Produktions-Deployments
- Konfigurieren Sie ein **CDN** (CloudFront, Cloudflare) davor, um die Performance zu steigern — siehe [Ein CDN vorschalten](/docs/backend/storage-caching/#putting-a-cdn-in-front)
- **Jede App mit Speicher in der Produktion muss ein Zugriffsmodell deklarieren** — siehe [Speicher-Autorisierung](/docs/backend/storage-authorization/). Dies gilt nicht nur für mandantenfähige Anwendungen: Der Server *verweigert den Bootvorgang* ohne ein solches Modell.

## Autorisierung pro Objekt

Wer jeden Schlüssel lesen, schreiben, löschen oder auflisten darf, wird durch `storagePolicies` und den `storageAuthorize`-Hook bestimmt, und ein API-Key benötigt zusätzlich den Storage-Scope für die jeweilige Operation. In der Produktion verweigert das System den Bootvorgang, wenn Speicher ohne Zugriffsmodell konfiguriert ist. Siehe [Speicher-Autorisierung](/docs/backend/storage-authorization/).

## Auf einen Upload reagieren

Auf jeden anderen Schreibvorgang in Rebase kann reagiert werden — eine Tabellenzeile besitzt `beforeSave` und `afterSave`, ein Zeitplan hat einen Cron-Job —, doch ein Upload bot bisher keine Hooks. Alles, was ein Upload nach sich zog, musste vom Client in einem zweiten Aufruf erledigt werden. Das führte dazu, dass es gar nicht ausgeführt wurde, wenn der Client zwischenzeitlich abbrach.

```ts
storageTriggers: [
    {
        path: "uploads/:uid/**",
        events: ["finalize"],
        handler: async ({ key, params, size, user }) => {
            await indexUpload.enqueue({ key, uid: params.uid, size }); // a `queue()` in backend/resources.ts
        }
    }
]
```

Die Mustersprache entspricht der von `storagePolicies` — literale Segmente, `*` für ein einzelnes Segment, `:name` zum Erfassen eines Segments, `**` für den Rest — und ein fehlerhaftes Muster bricht den Bootvorgang ab, anstatt stillschweigend auf nichts zu matchen.

| Ereignis | Wann |
| --- | --- |
| `finalize` | nachdem das Objekt dauerhaft geschrieben wurde; niemals bei einem fehlgeschlagenen Schreibvorgang |
| `delete` | nachdem das Objekt entfernt wurde |

`finalize` wird sowohl für Multipart- als auch für wiederaufnehmbare (TUS-)Pfade ausgelöst — einmal pro Upload, nicht einmal pro Chunk. Ein wiederaufnehmbarer Upload meldet den Benutzer, der ihn *erstellt* hat, da dies der Principal ist, den die Autorisierung geprüft hat.

Was ein Handler nicht annehmen darf:

- **Ein fehlerhafter Handler lässt die Anfrage nicht fehlschlagen.** Das Objekt ist zum Zeitpunkt der Ausführung bereits gespeichert. Eine Fehlerantwort an den Client würde signalisieren, dass der Upload fehlgeschlagen ist, obwohl dies nicht der Fall war, woraufhin Clients Uploads wiederholen. Fehler werden protokolliert und die Antwort bleibt unverändert. Wenn die Arbeit zwingend erfolgen muss, stellen Sie einen Job in die Warteschlange.
- **Handler werden mit `await` abgewartet**, in der Reihenfolge ihrer Deklaration, bevor die Antwort gesendet wird — "Fire-and-Forget" würde ein Promise hinterlassen, das eine Serverless-Runtime jederzeit mittendrin einfrieren kann. Ein langsamer Handler bedeutet daher einen langsamen Upload, was ein weiterer Grund dafür ist, Aufgaben in eine Queue einzureihen, anstatt sie direkt hier auszuführen.
- **Interne Schreibvorgänge lösen keine Trigger aus.** Der Cache für Bildvarianten schreibt abgeleitete Objekte direkt in den Storage-Controller; ein `**`-Trigger, der darauf anspringen würde, würde auf seine eigene Ausgabe reagieren.

## Nächste Schritte

- **[Frontend-Storage & Datei-Uploads](/docs/frontend/storage)** — Datei-Upload-Felder und Hooks
- **[Spalten](/docs/schema/columns/#storage-columns)** — `col.storage()` und seine Optionen
