---
sourceHash: dde397d03ef58183
title: Speicherkonfiguration
sidebar_label: Speicherkonfiguration
description: Konfigurieren Sie lokales Dateisystem, S3-kompatible oder GCS/Firebase Storage-Backends für Datei-Uploads, Bilder und Medien.
---

## Übersicht

Rebase unterstützt drei Speicher-Backends:

- **Lokales Dateisystem** — Auf der Festplatte gespeicherte Dateien (ideal für die Entwicklung)
- **S3-kompatibel** — AWS S3, MinIO, Cloudflare R2, DigitalOcean Spaces
- **Google Cloud Storage / Firebase Storage** — Native GCS-Unterstützung über `@google-cloud/storage`

## Konfiguration

:::note[Wo dies hingehört]
**Managed Runtime** — die `STORAGE_*`-Variablen in `.env` (`STORAGE_TYPE`, `S3_BUCKET` / `GCS_BUCKET`, `STORAGE_PATH`, `STORAGE_PUBLIC_READ`, … — hängen Sie an jede beliebige davon das Suffix `__<KEY>` für eine benannte Quelle an), plus eine `bucket("<key>")`-Deklaration in `backend/resources.ts` für jeden Bucket neben dem Standard-Bucket, und `export const storageAuthorize` aus `backend/storage.ts`. `storageAuthorize` hat mit Absicht keine Form als Umgebungsvariable: Keine Variable kann ausdrücken: „Dieser Benutzer darf diesen Schlüssel lesen“.

**Ejected** — der `storage`-Block in `initializeRebaseBackend({ … })`. `storagePolicies` und `storageTriggers` sind nur für Ejected-Projekte verfügbar.

Die vollständige Übersicht finden Sie in der [Backend-Übersicht](/docs/backend/#where-each-option-lives).
:::

Speicher wird im `storage`-Block von `initializeRebaseBackend` konfiguriert:

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

Der lokale Speicher speichert die Metadaten jedes Objekts direkt daneben als `<key>.metadata.json`. Daher wird ein Schlüssel, dessen letztes Segment auf `.metadata.json` endet, auf jeder Route mit `400 INVALID_STORAGE_KEY` abgelehnt. S3 und GCS speichern Metadaten am Objekt selbst und können beliebige Schlüssel speichern. Auf einem Dateisystem ohne Berücksichtigung der Groß-/Kleinschreibung (standardmäßig bei macOS und Windows) sind `Avatar.png` und `avatar.png` dieselbe lokale Datei, aber zwei unterschiedliche Objekte auf S3, GCS oder einem Linux-Dateisystem; daher gibt der Server beim Starten eine Warnung aus, wenn sich der Speicherordner auf einem solchen Dateisystem befindet.

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

Auf GCP (Cloud Run, GCE, GKE) werden die Standard-Anmeldedaten des Dienstkontos automatisch verwendet. Außerhalb von GCP setzen Sie die Umgebungsvariable `GOOGLE_APPLICATION_CREDENTIALS` auf den Pfad Ihrer Dienstkonto-Schlüsseldatei.

### Mehrere Speicher-Backends

Sie können mehrere benannte Backends konfigurieren und verschiedene Felder an unterschiedliche Speicher weiterleiten:

```typescript
storage: {
    "(default)": { type: "local", basePath: "./uploads" },
    "media": { type: "s3", bucket: "media-bucket", region: "us-east-1", ... }
}
```

Verweisen Sie dann mit `source` von einer Storage-Spalte auf ein bestimmtes Backend:

```typescript
image: col.storage({ path: "products/", source: "media" }),  // Routes to the "media" S3 backend
```

## Speicher-Endpunkte

| Methode | Pfad | Beschreibung |
|--------|------|-------------|
| `POST` | `/api/storage/upload` | Direkter Datei-Upload, ein `multipart/form-data`-Body: `file` (erforderlich); `key`, der Objektschlüssel einschließlich Ordnern (`author_pictures/ada.jpg`), andernfalls der Name der Datei im Stammverzeichnis; `bucket`, andernfalls der Standard-Bucket; `storageId`; `collection` und `property`, wodurch die Datei an `maxSize` und `acceptedFiles` dieser Eigenschaft gebunden wird; sowie `metadata_<name>` für benutzerdefinierte Metadaten. Jedes andere Feld wird ignoriert: Es gibt kein `path`-Feld |
| `POST` | `/api/storage/upload?storageId=<key>` | Upload auf ein bestimmtes benanntes Backend |
| `GET` | `/api/storage/file/*` | Abrufen einer Datei — alles nach `/file/` ist der Objektschlüssel |
| `GET` | `/api/storage/file/*?storageId=<key>` | Abrufen einer Datei von einem bestimmten Backend |
| `GET` | `/api/storage/metadata/*` | Größe, Inhaltstyp und benutzerdefinierte Metadaten eines einzelnen Objekts ohne dessen Bytes, plus ein kurzlebiges Download-Token, wenn es privat ist |
| `POST` | `/api/storage/metadata` | Dasselbe für bis zu 100 Objekte einer Quelle: Body `{ keys, storageId? }` |
| `DELETE` | `/api/storage/file/*` | Löschen einer Datei |
| `GET` | `/api/storage/list` | Auflisten von Objekten unter einem Präfix (`prefix`, `bucket`, `maxResults`, `pageToken`, `storageId`). Ein `maxResults` unter 1 oder ein `pageToken`, den die Quelle nie ausgegeben hat, führt zu `400 INVALID_LIST_OPTIONS` |
| `POST` | `/api/storage/folder` | Erstellen einer leeren Ordnermarkierung |
| `GET` | `/api/storage/sources` | Die Speicherquellen, die dieses Backend bereitstellt, nach Schlüssel |
| `OPTIONS` | `/api/storage/tus` | Abfrage der unterstützten TUS-Protokollfunktionen |
| `POST` | `/api/storage/tus` | Initiieren einer fortsetzbaren TUS-Upload-Sitzung |
| `HEAD` | `/api/storage/tus/:id` | Upload-Fortschritt prüfen (Byte-Offset) |
| `PATCH` | `/api/storage/tus/:id` | Daten-Chunk an temporäre Datei anhängen |
| `DELETE` | `/api/storage/tus/:id` | TUS-Upload-Sitzung beenden/abbrechen |

**Was sie zurückgeben.** Einen Umschlag (Envelope), denselben, den auch `/api/data` verwendet: Die Nutzlast befindet sich unter `data`, und ein Fehler ist `{ "error": { message, code, requestId } }` mit den Codes aus der [Fehlerreferenz](/docs/backend/errors/). `/api/storage/file/*` ist die Ausnahme, da dessen Nutzlast die Datei selbst ist — dieser Endpunkt liefert die Rohdaten (Bytes) zusammen mit `Content-Type`, `Content-Length` und den Caching-Headern.

```json
// GET /api/storage/list?prefix=products/images/
{ "data": { "items": [ { "bucket": "default", "fullPath": "products/images/a.jpg", "name": "a.jpg",
  "size": 48213, "updated": "2026-10-01T12:00:00.000Z", "contentType": "image/jpeg" } ], "prefixes": [] } }
```

Eine Auflistung beschreibt jede zurückgegebene Datei: ihre `size` in Bytes und `updated`, wann sie zuletzt geschrieben wurde (bei lokalem Speicher, S3 und GCS), sowie ihren `contentType` (bei lokalem Speicher und GCS). Eine S3-Auflistung enthält den Typ nicht, daher fehlt er bei S3 und `/api/storage/metadata/*` gibt ihn weiterhin an. Ein Ordner in `prefixes` enthält keines dieser Felder, ebenso wie ein benutzerdefinierter `StorageController`, der sie nicht setzt.

`POST /api/storage/upload` antwortet mit `201` mit den Daten `{ key, bucket, storageUrl }` des gespeicherten Objekts unter `data`;
`GET /api/storage/metadata/*` liefert die Metadaten des Objekts und für ein privates Objekt das kurzlebige `token`; `POST
/api/storage/metadata` ein Objekt, das nach den übermittelten Pfaden indiziert ist und jeweils das enthält, was der `GET`-Aufruf dafür
zurückgegeben hätte (siehe unten). Ein Ordner ist kein Objekt: `/metadata` auf einem Schlüssel, der mit `/` endet, liefert bei jedem Speicher `404`, selbst wenn S3
oder GCS eine `folder/`-Markierung vorhält; daher wird für ein Präfix kein Download-Token erzeugt. `GET /api/storage/sources` gibt das Array der
konfigurierten Quellen mit `configured: true` zurück. Bei einem Deployment ganz ohne Speicher antwortet es mit `200 {"data": [],
"configured": false}`, während jede andere Route mit `501 STORAGE_NOT_CONFIGURED` antwortet. `GET /api/auth/config` meldet
dieselbe Tatsache als `storage: false`, sodass ein Client die Anfrage überspringen kann. `GET /api/storage/sources` ist öffentlich: Es antwortet
auch dann ohne Token, wenn `requireAuth` aktiviert ist. Es nennt die Quellen (deren Schlüssel, Engine, Transport und Label) und niemals
eine Datei, und das Client-SDK liest diesen Endpunkt aus, um seine Quellen zu verdrahten, was geschehen kann, bevor sich jemand angemeldet hat. Eine Anwendung, die
eine `direct`-Quelle anonym liest, benötigt dies ebenfalls. Jede Route, die eine Datei auflistet, liest oder schreibt, behält ihre Authentifizierung bei.
`DELETE /api/storage/file/*` und `POST /api/storage/folder` enthalten nur eine `message`, da es nichts zurückzugeben gibt.

Bei S3 und GCS muss ein `bucket` einer sein, den die Quelle bereitstellt – sowohl bei Schreib- als auch bei
Leseoperationen: Ein Upload, ein `POST /api/storage/folder` oder ein TUS-Upload, der einen anderen
Bucket angibt, antwortet mit `404 UNKNOWN_STORAGE_SOURCE`, genau wie das Listing. Der lokale Speicher
erstellt einen Bucket weiterhin beim ersten Schreibvorgang.

**Viele Objekte auf einmal.** `POST /api/storage/metadata` akzeptiert
`{ "keys": ["photos/a.png", "photos/b.png"], "storageId": "media" }` — bis zu 100
Objektpfade einer Quelle, jeweils so angegeben, wie `GET /api/storage/metadata/<key>`
sie erwartet — und liefert einen Eintrag pro Schlüssel zurück:

```json
{ "data": {
  "photos/a.png": { "fullPath": "photos/a.png", "size": 48213, "contentType": "image/png", "token": "…", "tokenExpiresIn": 300 },
  "photos/b.png": { "error": { "code": "FORBIDDEN", "message": "Not authorized for this object", "status": 403 } }
} }
```

Jeder Schlüssel wird genau so bewertet wie beim `GET`-Endpunkt — derselbe `storageAuthorize`-Hook
und Speicherbereich (Scope), dieselbe öffentliche Regel, ein eigenes Download-Token — und ein
Schlüssel, der abgelehnt wird, fehlt oder fehlerhaft ist, liefert einen eigenen `error`, ohne dass die gesamte
Anfrage fehlschlägt oder Informationen über die anderen Schlüssel preisgegeben werden. Ein Aufrufer ohne Sitzung in einem Deployment, das
eine erfordert, erhält den Status `401`, den auch `GET` zurückgeben würde, es sei denn, jeder Schlüssel ist öffentlich. Mehr als
100 Schlüssel oder ein Body ohne `keys` führt zu `400 BAD_REQUEST`. Der Rate-Limiter zählt
die Anfrage als ⌈N/10⌉ Anfragen für N Schlüssel; eine Seite mit 100 Thumbnails kostet also 10.
`client.storage.getSignedUrl()` und das Admin-Panel senden die Abfragen, die eine Seite benötigt,
gebündelt auf diese Weise und greifen auf einem Server ohne diese Route auf jeweils einen `GET`-Aufruf pro Datei zurück.

**Wie ein Datei-Lesezugriff autorisiert wird.** Die Lese-Routen — `/api/storage/file/*` und
`/api/storage/metadata/*` — akzeptieren das kurzlebige signierte Token, das
[`getSignedUrl()`](/docs/sdk/storage) erzeugt, übergeben als `?token=<token>` oder als
`Bearer`. Ein gewöhnliches Zugriffs-JWT wird auf `/file/*` mit `401
Unauthorized: Access JWT not allowed on file routes` **abgelehnt**: Das Token, das auf
jeder anderen Route funktioniert, funktioniert dort mit Absicht nicht, da eine Datei-URL
etwas ist, das an einen Browser, ein CDN oder ein `<img>`-Tag weitergegeben wird. Jede andere Zeile oben
akzeptiert das Zugriffs-JWT wie gewohnt.

## On-the-Fly-Bildtransformationen

Rebase enthält eine integrierte Bildverarbeitungspipeline auf Basis von **Sharp**. Bei der Auslieferung von Bild-Assets aus dem Speicher können Sie dynamische Operationen mithilfe von Query-Parametern anwenden:

```bash
# Serve image scaled to 300px width in webp format
GET /api/storage/file/products/laptop.jpg?width=300&format=webp
```

### Unterstützte Parameter

- `width`, `height`: Skalierungsgrenzen, `1`–`4096` (das Bild wird niemals vergrößert).
- `quality`: `1`–`100`.
- `format`: Konvertiert das Bildformat. Unterstützte Formate: `webp`, `jpeg`, `png`, `avif`.
- `fit`: `cover`, `contain`, `fill`, `inside` oder `outside`.

Ein Parameter außerhalb dieser Grenzen führt zu einem **400**-Fehler und nicht zu einem stillschweigend begrenzten Wert —
früher gab `?width=99999` ein 4096px-Bild zurück und `?format=tiff` ein WebP-Bild, ohne dass dies explizit mitgeteilt wurde.

Die Thumbnails gespeicherter Bilder im Admin-Panel nutzen diesen Endpunkt: Eine Tabellen- oder Karten-Vorschau
fordert eine WebP-Version in etwa doppelter Anzeigegröße (96–800px)
an Stelle des Originals an. SVG- und GIF-Dateien werden immer im Originalzustand angezeigt.
`sharp` ist optional:
Ohne Sharp liefert eine Transformationsanfrage das Original, und das Backend warnt einmalig mit dem Hinweis,
`pnpm add sharp` in `backend/` auszuführen.

### Performance & LRU-Caching

Transformationen sind CPU- und speicherintensiv, und bei einem öffentlichen Objekt ist der Endpunkt
anonym erreichbar. Daher ist die Arbeitslast begrenzt und nicht nur zwischengespeichert:
- **Kapazität**: Ein LRU-Cache, der global auf **500 Einträge** begrenzt ist, indiziert nach Speicherquelle, Bucket und kanonischem Schlüssel.
- **TTL (Time to Live)**: Zwischengespeicherte Varianten verfallen nach **1 Stunde**.
- Gleichzeitige Anfragen für dieselbe nicht zwischengespeicherte Variante führen zu **einer einzigen** Transformation, nicht zu jeweils einer pro Anfrage.
- Es wird nur eine geringe Anzahl von Transformationen gleichzeitig ausgeführt; ab einem begrenzten Backlog antwortet der Server mit **503 `TRANSFORM_OVERLOADED`**, anstatt Arbeit anzunehmen, die er nicht bewältigen kann.

Dieser Cache befindet sich im Prozessspeicher, was bedeutet, dass er nicht zwischen Instanzen geteilt wird
und einen Neustart nicht übersteht. Zwei Replikate berechnen jede Variante separat, und bei einem
Deployment wird alles verworfen.

### Bildvarianten, die einen Neustart überstehen

`storageRenditionCache` schreibt jedes abgeleitete Bild zurück in denselben Bucket wie seine
Quelle, sodass die Arbeit einmal für das gesamte Deployment erledigt wird und nicht einmal pro
Instanz und Release:

```ts
storageRenditionCache: { enabled: true }
```

oder `STORAGE_RENDITION_CACHE=true` für ein Bundle-Deployment. Varianten werden unter dem reservierten Präfix `_rebase/renditions/` gespeichert, indiziert nach der Version des Quellobjekts — das Ersetzen eines Bildes liefert somit sofort das neue Bild aus.

Drei Dinge, die Sie wissen sollten, bevor Sie dies aktivieren:

- **Ein Lesezugriff schreibt nun.** Jede neue Variante kostet einen `PUT`-Vorgang in Ihrem Bucket. Aus diesem Grund ist dies standardmäßig deaktiviert.
- **Ein fehlgeschlagener Schreibvorgang bedeutet keine fehlgeschlagene Anfrage.** Schreibgeschützte Zugangsdaten oder eine Bucket-Richtlinie, die das Präfix verweigert, fallen auf den prozessinternen Cache zurück; das Bild wird weiterhin ausgeliefert und der Grund einmalig protokolliert.
- **Veraltete Varianten werden nicht bereinigt.** Das Ersetzen eines Quellobjekts hinterlässt seine alten Varianten. Richten Sie eine Lifecycle-Regel für `_rebase/renditions/` ein — dieses Präfix ist fest vorgegeben und nicht konfigurierbar, genau damit eine Regel darauf verweisen kann.

Das Präfix kann nicht über die API adressiert werden. Das direkte Lesen oder Schreiben darauf
beantwortet der Server mit **400 `INVALID_STORAGE_KEY`**: Jede Zugriffsregel im Produkt —
sowohl `storageAuthorize` als auch die deklarativen Richtlinien — ist auf den
*Quell*-Schlüssel bezogen, und eine Variante, die unter ihrem eigenen Pfad bereitgestellt würde, würde eine Frage beantworten, die niemand gestellt hat.

`_rebase/maintenance/` ist auf dieselbe Weise reserviert. `rebase storage orphans` speichert
die Aufzeichnungen jedes Scans dort in der gescannten Quelle, sodass der Prozess, der
den Scan ausführt, und derjenige, der den Status abfragt, denselben Datensatz lesen. Ein
Aufrufer, der einen Datensatz schreiben könnte, könnte bestimmen, was ein späterer Löschvorgang entfernt; daher antwortet das Lesen, Schreiben oder Auflisten dieses Präfixes ebenfalls mit 400. Datensätze werden 7 Tage nach ihrem letzten Schreibvorgang gelöscht, wenn der nächste Scan dieser Quelle startet.

### Was ausgeliefert wird

Der gespeicherte Content-Type entspricht dem, was beim Hochladen angegeben wurde — die Bytes werden nicht automatisch analysiert (Sniffing) —, weshalb `/api/storage/file/*` nur eine **enge Allowlist** inline rendert:
Bilder, Videos, Audio, `application/pdf` und `text/plain`. Alles andere,
einschließlich `text/html`, wird als `application/octet-stream` mit
`Content-Disposition: attachment` ausgeliefert, und jede Antwort enthält
`X-Content-Type-Options: nosniff`. Storage ist kein Webhoster: Eine hochgeladene Seite,
die auf dem API-Origin gerendert wird, könnte Cookies dieses Origins auslesen und dessen Endpunkte aufrufen.

Eine SVG-Datei ist ein Bild, das gleichzeitig ein Dokument ist und `<script>` enthalten kann. Sie wird als `image/svg+xml` ausgeliefert — sodass sie in einem `<img>` und in den Thumbnails des Admin-Panels dargestellt werden kann —, versehen mit
`Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox`
bei jeder Antwort, einschließlich transformierter URLs und URLs mit Download-Token. Wird sie direkt geöffnet, wird sie mit deaktivierten Skripten und einem opaken Origin gerendert, sodass sie nicht auf die Cookies oder Endpunkte der API zugreifen kann.

## Wie groß eine Datei sein darf

Jede Speicherquelle akzeptiert Dateien bis zu ihrem eigenen Limit: **50 MB**, sofern
`STORAGE_MAX_FILE_SIZE` (Bytes, mit dem Suffix `__<KEY>` für eine benannte Quelle) oder das
`maxFileSize` der Quelle nichts anderes vorgibt. Jeder Zugangsweg beschränkt eine Datei auf denselben
Wert. `POST /api/storage/upload` antwortet bei Überschreitung mit `413 PAYLOAD_TOO_LARGE`; ein
fortsetzbarer Upload wird bereits bei der Erstellung abgelehnt, noch vor dem ersten Chunk; und
`OPTIONS /api/storage/tus` kündigt diesen Wert als `Tus-Max-Size` an — für die mit `?storageId=` angegebene Quelle, andernfalls für die Standardquelle.

```bash
STORAGE_MAX_FILE_SIZE=209715200          # (default): 200 MB
STORAGE_MAX_FILE_SIZE__MEDIA=1073741824  # media: 1 GB
```

Wie viel von einer Datei der Server gleichzeitig im Speicher vorhält, hängt vom Zugangsweg ab.
`POST /api/storage/upload` ist ein einzelner Multipart-Body, den der Server als Ganzes parst:
das Drei- bis Fünffache der Dateigröße im Arbeitsspeicher. Ein fortsetzbarer Upload (TUS) hält jeweils nur einen Chunk gleichzeitig im Speicher. `client.storage.putObject()` und das Admin-Panel übertragen Dateien über 8 MiB auf die fortsetzbare Weise. Siehe
[Resumable uploads (TUS)](/docs/backend/storage-resumable-uploads/) für das
Protokoll, die Rückgabewerte und das Verhalten über mehrere Instanzen hinweg.

## Umgebungsvariablen

| Variable | Beschreibung |
|----------|-------------|
| `STORAGE_TYPE` | `"local"`, `"s3"` oder `"gcs"` |
| `STORAGE_PATH` | Lokales Speicherverzeichnis (Standard: `<project>/uploads`, unter `rebase dev` und auf einem durch `rebase eject` erstellten Server gleichermaßen). Ein relativer Pfad wird ausgehend von dem Verzeichnis gelesen, in dem der Server ausgeführt wird (nach `rebase eject` ist dies `backend/`). Ein benannter lokaler Bucket speichert seine Dateien daneben in `<STORAGE_PATH>__<key>`, es sei denn, `STORAGE_PATH__<KEY>` gibt einen eigenen Pfad an |
| `S3_BUCKET` | S3-Bucket-Name |
| `S3_REGION` | AWS-Region (Standard: `"auto"`) |
| `S3_ACCESS_KEY_ID` | AWS Access Key |
| `S3_SECRET_ACCESS_KEY` | AWS Secret Key |
| `S3_ENDPOINT` | Benutzerdefinierter S3-Endpunkt (für MinIO, R2) |
| `S3_FORCE_PATH_STYLE` | Path-Style-URLs verwenden (erforderlich für MinIO) |
| `GCS_BUCKET` | Google Cloud Storage Bucket-Name |
| `GCS_PROJECT_ID` | GCP-Projekt-ID für GCS |
| `GCS_KEY_FILENAME` | Pfad zu einer GCP-Dienstkonto-Schlüsseldatei (auf GKE weglassen — Workload Identity/ADC liefert die Anmeldedaten) |
| `GOOGLE_APPLICATION_CREDENTIALS` | Standard-ADC-Variable, die vom Google SDK selbst gelesen wird (auf GCP mit Standardanmeldedaten nicht erforderlich) |
| `STORAGE_DOWNLOAD_TOKEN_TTL` | Wie lange die Download-URL einer privaten Datei gültig ist, in Sekunden — die Lebensdauer des Tokens, das `/api/storage/metadata/*` generiert (Standard `300`, maximal `604800`, eine Woche). Erhöhen Sie diesen Wert für private Video- und Audiodateien, die nach dem Rendern der Seite weiterhin Byte-Bereiche anfordern. Die Schreibweise als Umgebungsvariable für `storageDownloadTokenTtl` |
| `STORAGE_MAX_FILE_SIZE` | Größte Datei, die die Quelle akzeptiert, in Bytes (Standard `52428800`, 50 MB). Fügen Sie für eine benannte Quelle das Suffix `__<KEY>` an. Ein Wert, der keine ganze Zahl von Bytes ist, verweigert den Start. Siehe [Wie groß eine Datei sein darf](#wie-groß-eine-datei-sein-darf) |
| `FORCE_LOCAL_STORAGE` | Erlaubt `STORAGE_TYPE=local` in der Produktion — siehe unten |
| `STORAGE_PUBLIC_READ` | Liefert gespeicherte Objekte an nicht authentifizierte Leser aus. Die Schreibweise als Umgebungsvariable für `storagePublicRead` und eine der drei Möglichkeiten, die [Produktions-Startsicherung](#autorisierung-pro-objekt) zu erfüllen. |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Deaktiviert die Startsicherung und stellt das Verhalten wieder her, bei dem jeder angemeldete Benutzer jeden Schlüssel lesen, überschreiben, löschen oder auflisten darf. Die Schreibweise als Umgebungsvariable für `storageInsecureAllowAnyAuthenticated`. Nur vertretbar, wenn jedem angemeldeten Benutzer bei jeder Datei vertraut wird. |

## Mehrere Buckets

Ein Projekt kann mehr als einen Bucket haben. Deklarieren Sie jeden einzelnen in `backend/resources.ts`
— dem zentralen Ort, den die Plattform, die Runtime und die Konsole gleichermaßen lesen:

```ts
import { bucket } from "@rebasepro/types";

export const uploads = bucket({ engine: "s3" });    // the default one
export const media = bucket("media", { engine: "s3", label: "Media" });
```

Führen Sie dann `rebase resources --write` aus, wodurch `rebase.resources.json` neu generiert wird,
sodass ein Host Ihre Topologie lesen kann, ohne einen Build auszuführen. Siehe
[Multiple Sources](/docs/backend/multiple-sources) für Datenbanken, Buckets und
Topics im Zusammenspiel.

Jede Quelle wird über **dieselben Variablennamen konfiguriert, die jeweils ihr eigenes
Suffix tragen**. Die Standardquelle erfordert kein Suffix, sodass ein Projekt mit nur einem Bucket weiterhin
die einfachen oben genannten Namen verwendet und überhaupt nichts deklarieren muss; das Deklarieren
benannter Buckets daneben ändert daran nichts ([Details](/docs/backend/multiple-sources/#which-bucket-receives-an-unqualified-upload)):

```bash
S3_BUCKET=app-uploads             # (default)
S3_BUCKET__MEDIA=app-media        # media
S3_ACCESS_KEY_ID__MEDIA=…
S3_SECRET_ACCESS_KEY__MEDIA=…
```

Das Suffix wird aus dem Schlüssel abgeleitet: in Großbuchstaben umgewandelt, nicht-alphanumerische Zeichen zu
Unterstrichen zusammengefasst, hinter einem **doppelten** Unterstrich (`media-cdn` → `__MEDIA_CDN`). Ein
einzelner Unterstrich würde mit echten Variablennamen kollidieren — `S3_BUCKET_NAME`
würde als Bucket `name` geparst werden.

Leiten Sie eine Spalte mit `source` an eine Quelle weiter:

```ts
cover: col.storage({ path: "covers/", source: "media", accept: ["image/*"] }),
```

Eine Quelle, die Sie deklarieren, aber nie konfigurieren, wird **übersprungen** und ist nicht fatal: Uploads,
die an sie geleitet werden, antworten mit `501 STORAGE_SOURCE_NOT_CONFIGURED`. Das Deklarieren eines Buckets geschieht
normalerweise, bevor jemand Speicher daran anbindet, und ein Startfehler an dieser Stelle würde
das Backend in eine Crash-Schleife versetzen, bis dies jemand tut. Eine Quelle, die die Umgebung
*falsch* konfiguriert — ein Typ ohne Bucket oder ein Bucket ohne Anmeldedaten —, wird beim
Start abgewiesen, da es sich hierbei um einen Fehler und nicht um ein Fehlen handelt.

### Buckets, die sich ein Konto teilen

Anmeldedaten beschreiben normalerweise den **Provider**, nicht den Bucket. Fünfzehn Buckets auf
einer MinIO-Installation würden andernfalls fünfzehn Kopien desselben Zugriffsschlüssels bedeuten, und
eine Rotation würde fünfzehn paarweise Bearbeitungen erfordern. Benennen Sie stattdessen ein Konto:

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

Nur die auf Kontoebene definierten Variablen greifen auf den Fallback zurück — `S3_ACCESS_KEY_ID`,
`S3_SECRET_ACCESS_KEY`, `S3_ENDPOINT`, `S3_REGION`, `S3_FORCE_PATH_STYLE` sowie
das GCS-Paar `GCS_PROJECT_ID` / `GCS_KEY_FILENAME`. Der Bucket-Name tut dies nie:
Er unterscheidet eine Quelle von einer anderen. Ein Wert auf Bucket-Ebene hat weiterhin Vorrang,
sodass eine Quelle den Provider wechseln kann, ohne die anderen zu beeinträchtigen.

### Geplantes Löschen von Dateien, auf die keine Zeile verweist

Beim Löschen einer Zeile verbleiben deren Dateien im Bucket. Nichts wird zusammen mit der Zeile gelöscht:
Eine andere Zeile, eine Version im [Verlauf](/docs/backend/history/) oder Ihr eigener Code,
der den Schlüssel als einfachen String hält, könnte weiterhin auf die Datei verweisen. Ein Bucket kann stattdessen
die Bereinigung anfordern, die all diese Stellen berücksichtigt:

```ts
export const voice = bucket("voice", { engine: "s3", orphanSweep: { olderThanHours: 72 } });
export const media = bucket("media", { orphanSweep: true }); // a week, daily at 04:17 UTC
```

Jeder deklarierte Sweep ist ein Cron-Job, `storage-orphan-sweep-<bucket>`
(`storage-orphan-sweep-default` für den Standard-Bucket). Er führt den Scan hinter
`rebase storage orphans --delete` aus. Dieser Scan liest jede Zeile jeder
Tabelle und jeden Verlaufseintrag und behält:

- jede Datei, auf die noch irgendwo verwiesen wird;
- jede Datei, die neuer als `olderThanHours` ist (mindestens 24, standardmäßig eine Woche);
- alle Dateien für diesen Durchlauf, wenn eine Tabelle nicht gelesen werden kann.

Er überprüft dann jede Datei unmittelbar vor dem Löschen noch einmal. Setzen Sie `schedule` auf einen
Cron-Ausdruck (UTC), um zu ändern, wann er ausgeführt wird. Da es sich um einen Cron-Job handelt, läuft er auf einer
Instanz pro Zeitfenster. Sein Ausführungsverlauf zeichnet auf, wie viele Dateien gelöscht und behalten wurden,
und er kann über die Cron-Liste im Admin-Bereich pausiert oder manuell ausgeführt werden. Er erfordert einen
Bucket, den dieses Backend bereitstellt: Ein Bucket mit `transport: "direct"` wird beim Start mit
einer Warnung abgewiesen.

## Frontend-Speicherquellen

Das Frontend erfährt über `GET /api/storage/sources` von den Quellen des Servers, sodass eine `server`-Quelle keinen Eintrag benötigt. Übergeben Sie `storageSources` an den `<Rebase>`-Provider für eine `direct`-Quelle, die direkt zum Provider hochlädt, oder um ein Label bzw. den Transport selbst festzulegen:

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

Der `key` einer `server`-Quelle muss mit einem im `storage`-Mapping des Servers registrierten Backend-Schlüssel übereinstimmen. Der React-Kontext `StorageSourcesContext` ermittelt die aktive Quelle für jedes Upload-Feld.

## Caching und CDNs

Jedes Objekt wird über den Server weitergeleitet (Proxied), mit einem `ETag` für eine ressourcenschonende
Revalidierung, einem `Cache-Control`, das davon abhängt, wer es lesen darf, und Byte-Ranges
für das Vor- und Zurückspulen in Audio- und Videodateien. [Speicher-Caching und CDNs](/docs/backend/storage-caching/)
beschreibt die Header und was auf einem vorgeschalteten CDN konfiguriert werden sollte.

## Tipps für die Produktion

:::caution
**In der Produktion deaktiviert `type: "local"` die Dateispeicherung, anstatt sie zu verwenden.** Auf einer flüchtigen Plattform (Cloud Run, Heroku, ein Kubernetes-Pod) wird das Dateisystem bei jedem Deployment, Neustart und bei jeder Eviction gelöscht — Uploads wären also erfolgreich, ließen sich problemlos wieder auslesen und wären beim nächsten Rollout spurlos verschwunden, ohne dass zu irgendeinem Zeitpunkt ein Fehler aufgetreten wäre.

Daher wird der lokale Standard nicht registriert, und eine Anfrage an `/api/storage/*`, die keine Speicherquelle benennt, antwortet mit **`501 STORAGE_NOT_CONFIGURED`** und nennt die Quellen, die bereitgestellt werden. Eine benannte Quelle, die konfiguriert ist, wie beispielsweise `bucket("media", { engine: "s3" })`, wird weiterhin bedient. Uploads schlagen unübersehbar und wiederherstellbar fehl; der Rest der Anwendung läuft normal weiter. Dateispeicher ist in der Produktion opt-in: Er existiert erst, sobald ein Bucket vorhanden ist.

Setzen Sie `STORAGE_TYPE=s3` oder `gcs`. Wenn ein **dauerhaftes Volume (Durable Volume)** tatsächlich `STORAGE_PATH` enthält, setzen Sie `FORCE_LOCAL_STORAGE=true`, um dies explizit anzugeben. Hängen Sie es am übergeordneten Verzeichnis von `STORAGE_PATH` ein, damit das Verzeichnis `<STORAGE_PATH>__<key>` jedes benannten lokalen Buckets ebenfalls darauf liegt.
:::

- Binden Sie ein **persistentes Volume** über dem übergeordneten Verzeichnis von `STORAGE_PATH` ein, wenn Sie lokalen Speicher auf Docker/Kubernetes verwenden, und setzen Sie `FORCE_LOCAL_STORAGE=true` — siehe [Self-Hosting](/docs/deployment/self-hosting/#file-storage)
- Verwenden Sie **S3** oder kompatible Dienste (R2, MinIO) oder **GCS** für Produktions-Deployments
- Schalten Sie zur Leistungssteigerung ein **CDN** (CloudFront, Cloudflare) vor — siehe [Vorschalten eines CDN](/docs/backend/storage-caching/#putting-a-cdn-in-front)
- **Jede Anwendung mit Speicher in der Produktion muss ein Zugriffsmodell deklarieren** — siehe
  [Speicherautorisierung](/docs/backend/storage-authorization/).
  Nicht nur mandantenfähige Anwendungen: Der Server *verweigert den Start* ohne ein solches Modell.

## Autorisierung pro Objekt

Wer die einzelnen Schlüssel lesen, schreiben, löschen oder auflisten darf, wird durch `storagePolicies`
und den `storageAuthorize`-Hook bestimmt, und ein API-Schlüssel benötigt außerdem den passenden Storage-Scope für
die jeweilige Operation. In der Produktion wird der Start verweigert, wenn Speicher ohne ein Zugriffsmodell vorhanden ist. Siehe
[Speicherautorisierung](/docs/backend/storage-authorization/).

## Auf einen Upload reagieren

Auf jeden anderen Schreibvorgang in Rebase kann reagiert werden — eine Zeile hat `beforeSave` und
`afterSave`, ein Zeitplan hat einen Cron-Job — für einen Upload gab es jedoch nichts. Alles, was ein
Upload nach sich zog, musste vom Client in einem zweiten Aufruf erledigt werden, was bedeutet, dass
es überhaupt nicht ausgeführt wurde, wenn der Client in der Zwischenzeit die Verbindung trennte.

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

Die Mustersprache ist dieselbe wie bei `storagePolicies` — literale Segmente, `*`
für ein einzelnes Segment, `:name` zum Erfassen eines Segments, `**` für den Rest — und ein fehlerhaftes
Muster führt zum Fehlschlagen des Serverstarts, anstatt stillschweigend auf nichts zuzutreffen.

| Ereignis | Wann |
| --- | --- |
| `finalize` | nachdem das Objekt dauerhaft geschrieben wurde; niemals bei einem fehlgeschlagenen Schreibvorgang |
| `delete` | nachdem das Objekt entfernt wurde |

`finalize` wird sowohl für Multipart- als auch für fortsetzbare (TUS) Upload-Pfade ausgelöst — einmal
pro Upload, nicht einmal pro Chunk — und ein fortsetzbarer Upload meldet den Benutzer, der
ihn *erstellt* hat, da dies der Prinzipal ist, den die Autorisierung geprüft hat.

Was ein Handler nicht annehmen darf:

- **Ein Handler, der einen Fehler auslöst (throw), lässt die Anfrage nicht fehlschlagen.** Das Objekt ist zu dem Zeitpunkt,
  an dem er ausgeführt wird, bereits gespeichert. Dem Client mit einem Fehler zu antworten würde bedeuten, zu signalisieren, dass der
  Upload fehlgeschlagen sei, obwohl dies nicht der Fall war, und Clients wiederholen Uploads. Fehler werden protokolliert
  und die Antwort bleibt unverändert. Wenn die Arbeit zwingend ausgeführt werden muss, reihen Sie einen Job in eine Warteschlange ein.
- **Handler werden abgewartet (awaited)**, in der Reihenfolge ihrer Deklaration, bevor die Antwort gesendet wird —
  „Fire and Forget“ würde ein Promise hinterlassen, das eine serverlose Laufzeitumgebung mitten im Ablauf einfrieren könnte.
  Ein langsamer Handler führt daher zu einem langsamen Upload, was ein weiterer Grund ist, Arbeiten in eine Warteschlange einzureihen, anstatt sie direkt hier auszuführen.
- **Interne Schreibvorgänge lösen keine Trigger aus.** Der Cache für Bildvarianten schreibt
  abgeleitete Objekte direkt in den Storage-Controller; ein `**`-Trigger, der darauf ansprechen würde, würde auf seine eigene Ausgabe reagieren.

## Nächste Schritte

- **[Frontend Storage & File Uploads](/docs/frontend/storage)** — Datei-Upload-Felder und Hooks
- **[Columns](/docs/schema/columns/#storage-columns)** — `col.storage()` und dessen Optionen
