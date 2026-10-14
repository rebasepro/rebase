---
sourceHash: 5be4e3768bac692e
title: Speicher-Konfiguration
sidebar_label: Speicher-Konfiguration
description: Konfigurieren Sie lokales Dateisystem, S3-kompatible Backends oder GCS/Firebase Storage für Datei-Uploads, Bilder und Medien.
---

## Übersicht

Rebase unterstützt drei Speicher-Backends:

- **Lokales Dateisystem** — Auf der Festplatte gespeicherte Dateien (ideal für die Entwicklung)
- **S3-kompatibel** — AWS S3, MinIO, Cloudflare R2, DigitalOcean Spaces
- **Google Cloud Storage / Firebase Storage** — Native GCS-Unterstützung über `@google-cloud/storage`

## Konfiguration

:::note[Wo dies hingehört]
**Managed Runtime** — die `STORAGE_*`-Variablen in `.env` (`STORAGE_TYPE`, `STORAGE_BUCKET` oder `S3_BUCKET` / `GCS_BUCKET`, `STORAGE_PATH`, `STORAGE_PUBLIC_READ`, … — fügen Sie an jede davon das Suffix `__<KEY>` für eine benannte Quelle an), plus eine `bucket("<key>")`-Deklaration in `config/resources.ts` für jedes Bucket über das Standard-Bucket hinaus, und `export const storageAuthorize` aus `config/index.ts`. `storageAuthorize` existiert bewusst nicht als Umgebungsvariable: Keine Variable kann ausdrücken: „Dieser Benutzer darf diesen Schlüssel lesen“.

**Ejected** — der `storage`-Block in `initializeRebaseBackend({ … })`. `storagePolicies` und `storageTriggers` sind nur im Ejected-Modus verfügbar.

Die vollständige Übersicht finden Sie in der [Backend-Übersicht](/docs/backend/#where-each-option-lives).
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

Der lokale Speicher legt die Metadaten jedes Objekts direkt daneben ab, als `<key>.metadata.json`. Ein Schlüssel, dessen letztes Segment auf `.metadata.json` endet, wird daher auf jeder Route mit `400 INVALID_STORAGE_KEY` abgelehnt. S3 und GCS speichern Metadaten am Objekt selbst und können beliebige Schlüssel speichern. Auf einem Dateisystem ohne Berücksichtigung der Groß-/Kleinschreibung (standardmäßig unter macOS und Windows) sind `Avatar.png` und `avatar.png` dieselbe lokale Datei, aber zwei unterschiedliche Objekte auf S3, GCS oder einem Linux-Laufwerk. Daher warnt der Server beim Systemstart, wenn der Speicherordner auf einem solchen Dateisystem liegt.

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

Auf der GCP (Cloud Run, GCE, GKE) werden die Standard-Anmeldedaten des Dienstkontos automatisch verwendet. Außerhalb der GCP setzen Sie die Umgebungsvariable `GOOGLE_APPLICATION_CREDENTIALS` auf den Pfad Ihrer Dienstkonto-Schlüsseldatei.

### Mehrere Speicher-Backends

Sie können mehrere benannte Backends konfigurieren und verschiedene Felder an unterschiedliche Speicher weiterleiten:

```typescript
storage: {
    "(default)": { type: "local", basePath: "./uploads" },
    "media": { type: "s3", bucket: "media-bucket", region: "us-east-1", ... }
}
```

Verweisen Sie anschließend in Ihren Collection-Eigenschaften auf ein bestimmtes Backend:

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
| `POST` | `/api/storage/upload?storageId=<key>` | Upload in ein bestimmtes benanntes Backend |
| `GET` | `/api/storage/file/*` | Eine Datei abrufen — alles nach `/file/` ist der Objektschlüssel |
| `GET` | `/api/storage/file/*?storageId=<key>` | Eine Datei von einem bestimmten Backend abrufen |
| `GET` | `/api/storage/metadata/*` | Größe, Content-Type und benutzerdefinierte Metadaten eines Objekts ohne dessen Bytes, plus ein kurzlebiges Download-Token, falls es privat ist |
| `POST` | `/api/storage/metadata` | <span class="since-badge" data-since="0.25">Seit 0.25</span> Dasselbe für bis zu 100 Objekte einer Quelle: Body `{ keys, storageId? }` |
| `DELETE` | `/api/storage/file/*` | Eine Datei löschen |
| `GET` | `/api/storage/list` | Objekte unter einem Präfix auflisten (`prefix`, `bucket`, `maxResults`, `pageToken`, `storageId`). Ein `maxResults` kleiner als 1 oder ein `pageToken`, den die Quelle nie ausgestellt hat, ergibt `400 INVALID_LIST_OPTIONS` |
| `POST` | `/api/storage/folder` | Eine leere Ordnermarkierung erstellen |
| `GET` | `/api/storage/sources` | Die Speicherquellen, die dieses Backend bedient, nach Schlüssel |
| `OPTIONS` | `/api/storage/tus` | Unterstützte TUS-Protokollfunktionen abfragen |
| `POST` | `/api/storage/tus` | Eine fortsetzbare TUS-Upload-Sitzung initiieren |
| `HEAD` | `/api/storage/tus/:id` | Upload-Fortschritt prüfen (Byte-Offset) |
| `PATCH` | `/api/storage/tus/:id` | Daten-Chunk an temporäre Datei anhängen |
| `DELETE` | `/api/storage/tus/:id` | TUS-Upload-Sitzung beenden/abbrechen |

**Was sie antworten.** Ein einheitlicher Umschlag (Envelope), derselbe, den auch `/api/data` verwendet: Die Nutzlast
liegt unter `data`, und ein Fehler hat das Format `{ "error": { message, code, requestId } }`
mit den Codes aus der [Fehlerreferenz](/docs/backend/errors/). `/api/storage/file/*`
ist die Ausnahme, da dessen Nutzlast die Datei selbst ist — es antwortet mit den reinen Bytes sowie
`Content-Type`, `Content-Length` und den Caching-Headern.

```json
// GET /api/storage/list?prefix=products/images/
{ "data": { "items": [ { "bucket": "default", "fullPath": "products/images/a.jpg", "name": "a.jpg",
  "size": 48213, "updated": "2026-10-01T12:00:00.000Z", "contentType": "image/jpeg" } ], "prefixes": [] } }
```

<span class="since-badge" data-since="0.25">Seit 0.25</span> Eine Auflistung beschreibt jede Datei, die sie zurückgibt: ihre `size` in Bytes und
`updated`, wann sie zuletzt geschrieben wurde (im lokalen Speicher, auf S3 und GCS), sowie ihren
`contentType` im lokalen Speicher und auf GCS. Ein S3-Listing enthält den Typ nicht,
daher fehlt er bei S3 und `/api/storage/metadata/*` liefert ihn stattdessen. Ein Ordner in
`prefixes` enthält keines dieser Felder, ebenso wie ein benutzerdefinierter `StorageController`,
der sie nicht setzt.

`POST /api/storage/upload` antwortet mit `201` und `{ key, bucket, storageUrl }` des gespeicherten Objekts unter `data`;
`GET /api/storage/metadata/*` mit den Metadaten des Objekts und für private Objekte mit dem kurzlebigen `token`; `POST
/api/storage/metadata` mit einem Objekt, dessen Schlüssel die übergebenen Pfade sind und die jeweils das enthalten, was der `GET`-Endpunkt dafür
geantwortet hätte (siehe unten). Ein Ordner ist kein Objekt: Ein `/metadata`-Aufruf auf einen Schlüssel, der auf `/` endet, liefert auf jedem Speicher `404`,
selbst wenn S3 oder GCS eine `folder/`-Markierung vorhalten; es wird daher kein Download-Token für ein Präfix erzeugt.
`GET /api/storage/sources` liefert das Array der konfigurierten Quellen mit `configured: true`. In einem Deployment ganz ohne Speicher
antwortet es mit `200 {"data": [], "configured": false}`, während jede andere Route mit `501 STORAGE_NOT_CONFIGURED` antwortet. `GET /api/auth/config` meldet
dieselbe Tatsache als `storage: false`, sodass ein Client die Anfrage überspringen kann. `GET /api/storage/sources` ist öffentlich: Es antwortet
ohne Token, selbst wenn `requireAuth` aktiv ist. Es gibt lediglich die Quellen an (Schlüssel, Engine, Transport und Label) und niemals
eine Datei; das Client-SDK liest diesen Endpunkt aus, um seine Quellen zu verdrahten, was geschehen kann, bevor sich jemand angemeldet hat. Eine Anwendung,
die eine `direct`-Quelle anonym ausliest, benötigt dies ebenfalls. Jede Route, die eine Datei auflistet, liest oder schreibt, behält ihre Authentifizierung bei.
`DELETE /api/storage/file/*` und `POST /api/storage/folder` enthalten lediglich eine `message`, da es nichts zurückzugeben gibt.

Auf S3 und GCS muss ein `bucket` eines sein, das die Quelle bedient, sowohl bei Schreib- als auch bei
Leseoperationen: Ein Upload, ein `POST /api/storage/folder` oder ein TUS-Upload mit Angabe eines anderen
Buckets antwortet mit `404 UNKNOWN_STORAGE_SOURCE`, genau wie das Listing. Der lokale Speicher
erstellt ein Bucket weiterhin beim ersten Schreibvorgang automatisch.

**Viele Objekte auf einmal.** <span class="since-badge" data-since="0.25">Seit 0.25</span> `POST /api/storage/metadata` akzeptiert
`{ "keys": ["photos/a.png", "photos/b.png"], "storageId": "media" }` — bis zu 100
Objektpfade einer einzelnen Quelle, jeweils so formatiert, wie `GET /api/storage/metadata/<key>`
sie erwartet — und liefert einen Eintrag pro Schlüssel zurück:

```json
{ "data": {
  "photos/a.png": { "fullPath": "photos/a.png", "size": 48213, "contentType": "image/png", "token": "…", "tokenExpiresIn": 300 },
  "photos/b.png": { "error": { "code": "FORBIDDEN", "message": "Not authorized for this object", "status": 403 } }
} }
```

Jeder Schlüssel wird exakt so beurteilt wie beim `GET`-Endpunkt — derselbe `storageAuthorize`-Hook,
derselbe Speicher-Scope, dieselbe Public-Regel, ein eigenes Download-Token. Ein Schlüssel,
der abgelehnt wird, fehlt oder fehlerhaft ist, liefert seinen eigenen `error` zurück, ohne die anderen
abzubrechen oder preiszugeben. Ein Aufrufer ohne Sitzung in einem Deployment, das eine solche erfordert,
erhält den `401`, den auch der `GET`-Endpunkt liefern würde, es sei denn, jeder Schlüssel ist öffentlich. Mehr als
100 Schlüssel oder ein Body ohne `keys` führen zu `400 BAD_REQUEST`. Der Rate Limiter zählt
die Anfrage als ⌈N/10⌉ Anfragen für N Schlüssel; eine Seite mit 100 Thumbnails kostet also 10 Einheiten.
`client.storage.getSignedUrl()` und das Admin-Panel bündeln die Abfragen einer Seite
auf diese Weise und fallen auf einzelne `GET`-Aufrufe pro Datei zurück, falls der Server die
Route nicht unterstützt.

**Wie ein Lesezugriff auf eine Datei autorisiert wird.** Die Lese-Routen — `/api/storage/file/*` und
`/api/storage/metadata/*` — erwarten das kurzlebige, signierte Token, das
[`getSignedUrl()`](/docs/sdk/storage) generiert, übergeben als `?token=<token>` oder als
`Bearer`. Ein reguläres Zugriffs-JWT wird auf `/file/*` mit `401
Unauthorized: Access JWT not allowed on file routes` **abgelehnt**: Das Token, das auf
jeder anderen Route funktioniert, funktioniert dort bewusst nicht, da eine Datei-URL
an einen Browser, ein CDN oder ein `<img>`-Tag weitergegeben wird. Alle anderen oben aufgeführten
Routen akzeptieren wie gewohnt das Zugriffs-JWT.

## Bildtransformationen zur Laufzeit (On-the-Fly)

Rebase enthält eine integrierte Bildverarbeitungspipeline auf Basis von **Sharp**. Beim Ausliefern von Bild-Assets aus dem Speicher können Sie dynamische Operationen über Abfrageparameter anwenden:

```bash
# Serve image scaled to 300px width in webp format
GET /api/storage/file/products/laptop.jpg?width=300&format=webp
```

### Unterstützte Parameter

- `width`, `height`: Abmessungen für die Größenänderung, `1`–`4096` (das Bild wird niemals vergrößert).
- `quality`: `1`–`100`.
- `format`: Konvertiert das Bildformat. Unterstützte Formate: `webp`, `jpeg`, `png`, `avif`.
- `fit`: `cover`, `contain`, `fill`, `inside` oder `outside`.

Ein Parameter außerhalb dieser Grenzen führt zu einem **400**-Fehler und wird nicht stillschweigend begrenzt —
`?width=99999` lieferte früher ein Bild mit 4096px und `?format=tiff` ein WebP-Bild zurück,
ohne Rückmeldung darüber zu geben.

Die Thumbnails gespeicherter Bilder im Admin-Panel nutzen diesen Endpunkt: Eine Tabellen- oder Karten-Vorschau
fordert eine WebP-Version an, die etwa doppelt so groß wie ihre dargestellte Größe ist (96–800px),
anstatt des Originals. SVG- und GIF-Dateien werden immer unverändert angezeigt.
`sharp` ist optional: <span class="since-badge" data-since="0.25">Seit 0.25</span>
ohne es erhält eine Transformationsanfrage das Original, und das Backend warnt einmal,
`pnpm add sharp` in `backend/` auszuführen (unter 0.24 antwortet es mit 500, und das Panel zeigt die Originale).

### Performance & LRU-Caching

Das Transformieren ist CPU- und speicherintensiv, und bei einem öffentlichen Objekt ist der Endpunkt
anonym erreichbar. Daher ist die Arbeitslast begrenzt und nicht nur zwischengespeichert:
- **Kapazität**: Ein LRU-Cache, der global auf **500 Einträge** limitiert ist, aufgeschlüsselt nach Speicherquelle,
  Bucket und kanonischem Schlüssel.
- **TTL (Time to Live)**: Zwischengespeicherte Varianten laufen nach **1 Stunde** ab.
- Gleichzeitige Anfragen für dieselbe nicht zwischengespeicherte Variante erzeugen **eine** Transformation,
  nicht jeweils eine eigene.
- Eine kleine Anzahl von Transformationen läuft gleichzeitig; jenseits eines begrenzten Backlogs antwortet der Server mit
  **503 `TRANSFORM_OVERLOADED`**, anstatt Arbeit anzunehmen, die er nicht bewältigen kann.

Dieser Cache lebt im Prozess, was bedeutet, dass er nicht zwischen Instanzen geteilt wird
und einen Neustart nicht übersteht. Zwei Replikate berechnen jede Variante separat, und ein
Deployment verwirft den gesamten Cache.

### Renderings, die einen Neustart überstehen

`storageRenditionCache` schreibt jedes abgeleitete Bild zurück in dasselbe Bucket wie seine
Quelle, sodass die Arbeit einmal für das gesamte Deployment statt einmal pro
Instanz und Release ausgeführt wird:

```ts
storageRenditionCache: { enabled: true }
```

oder `STORAGE_RENDITION_CACHE=true` für ein Bundle-Deployment. Renderings werden unter dem
reservierten Präfix `_rebase/renditions/` gespeichert, verschlüsselt nach der Version des Quellobjekts
— das Ersetzen eines Bildes liefert also sofort das neue aus.

Drei Dinge, die Sie vor dem Aktivieren beachten sollten:

- **Ein Lesevorgang führt nun zu einem Schreibvorgang.** Jede neue Variante kostet einen `PUT`-Aufruf in Ihrem Bucket. Aus diesem Grund ist
  die Funktion standardmäßig deaktiviert.
- **Ein fehlgeschlagener Schreibvorgang ist keine fehlgeschlagene Anfrage.** Schreibgeschützte Anmeldedaten oder eine
  Bucket-Richtlinie, die das Präfix ablehnt, fallen auf den In-Process-Cache zurück; das Bild wird
  dennoch ausgeliefert und der Grund wird einmalig protokolliert.
- **Ersetzte Renderings werden nicht bereinigt.** Das Ersetzen eines Quellobjekts
  lässt alte Renderings verwaist zurück. Richten Sie eine Lifecycle-Regel für `_rebase/renditions/` ein
  — dieses Präfix ist fest vorgegeben und nicht konfigurierbar, damit eine Regel exakt darauf verweisen kann.

Das Präfix kann nicht über die API adressiert werden. Direktes Lesen oder Schreiben darauf
wird mit **400 `INVALID_STORAGE_KEY`** beantwortet: Jede Zugriffsregel im Produkt —
sowohl `storageAuthorize` als auch die deklarativen Richtlinien — bezieht sich auf den
*Quell*-Schlüssel, und ein Rendering, das unter seinem eigenen Pfad ausgeliefert wird, würde eine Anfrage beantworten,
die niemand gestellt hat.

### Was ausgeliefert wird

Der gespeicherte Content-Type entspricht dem, was der Uploader angegeben hat — die Bytes werden
nicht analysiert. Daher rendert `/api/storage/file/*` inline nur eine **enge Allowlist**:
Bilder, Video, Audio, `application/pdf` und `text/plain`. Alles andere,
einschließlich `text/html`, wird als `application/octet-stream` mit
`Content-Disposition: attachment` ausgeliefert, und jede Antwort enthält
`X-Content-Type-Options: nosniff`. Der Speicher ist kein Webserver: Eine hochgeladene HTML-Seite,
die auf dem API-Origin gerendert wird, könnte Cookies dieses Origins auslesen und dessen
Endpunkte aufrufen.

Ein SVG ist ein Bild, das gleichzeitig ein Dokument ist und `<script>` enthalten kann. Es wird
als `image/svg+xml` ausgeliefert — sodass es in einem `<img>` und in den Thumbnails des Admin-Panels gerendert wird —,
jedoch mit `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox`
bei jeder Antwort, einschließlich transformierter URLs und URLs mit Download-Token. Wird es
direkt geöffnet, rendert es mit deaktivierten Skripten und einem opaken Origin, sodass es weder auf die
Cookies noch auf die Endpunkte der API zugreifen kann.

## Maximale Dateigröße

Jede Speicherquelle akzeptiert Dateien bis zu ihrem eigenen Limit: **50 MB**, sofern nicht
`STORAGE_MAX_FILE_SIZE` (in Bytes, mit dem Suffix `__<KEY>` für eine benannte Quelle) oder das
`maxFileSize`-Feld der Quelle etwas anderes festlegt. Jeder Zugangsweg bindet eine Datei an denselben
Wert. `POST /api/storage/upload` antwortet bei Überschreitung mit `413 PAYLOAD_TOO_LARGE`; ein
fortsetzbarer Upload wird bereits bei der Erstellung abgelehnt, noch vor seinem ersten Chunk; und
`OPTIONS /api/storage/tus` meldet ihn als `Tus-Max-Size` — für die durch `?storageId=` benannte
Quelle bzw. andernfalls für die Standardquelle.

In Version 0.23 legt ausschließlich das Feld `maxFileSize` der Quelle das Limit fest; `STORAGE_MAX_FILE_SIZE` wird nicht ausgewertet.

```bash
STORAGE_MAX_FILE_SIZE=209715200          # (default): 200 MB
STORAGE_MAX_FILE_SIZE__MEDIA=1073741824  # media: 1 GB
```

Wie viel einer Datei der Server gleichzeitig im Arbeitsspeicher hält, hängt vom Eingangsweg ab.
`POST /api/storage/upload` ist ein einzelner Multipart-Body, den der Server vollständig parst:
das Drei- bis Fünffache der Dateigröße im Arbeitsspeicher. Ein fortsetzbarer Upload (TUS) verarbeitet
jeweils nur einen Chunk. <span class="since-badge" data-since="0.25">Seit 0.25</span> senden `client.storage.putObject()` und das Admin-Panel Dateien
über 8 MiB über das fortsetzbare Verfahren. Unter
[Fortsetzbare Uploads (TUS)](/docs/backend/storage-resumable-uploads/) finden Sie Informationen zum
Protokoll, zu den Antworten und zum Verhalten über mehrere Instanzen hinweg.

## Umgebungsvariablen

| Variable | Beschreibung |
|----------|-------------|
| `STORAGE_TYPE` | `"local"`, `"s3"` oder `"gcs"` |
| `STORAGE_PATH` | Verzeichnis für lokalen Speicher (Standard: `<project>/uploads`, unter `rebase dev` und in einem von `rebase eject` geschriebenen Server gleichermaßen). Ein relativer Pfad wird von dem Verzeichnis aus gelesen, in dem der Server läuft; nach `rebase eject` ist das `backend/`. Ein benanntes lokales Bucket speichert seine Dateien daneben in `<STORAGE_PATH>__<key>`, es sei denn, `STORAGE_PATH__<KEY>` definiert einen eigenen Pfad |
| `S3_BUCKET` | Name des S3-Buckets |
| `S3_REGION` | AWS-Region (Standard: `"auto"`) |
| `S3_ACCESS_KEY_ID` | AWS-Access-Key |
| `S3_SECRET_ACCESS_KEY` | AWS-Secret-Key |
| `S3_ENDPOINT` | Benutzerdefinierter S3-Endpunkt (für MinIO, R2) |
| `S3_FORCE_PATH_STYLE` | Path-Style-URLs erzwingen (erforderlich für MinIO) |
| `GCS_BUCKET` | Name des Google Cloud Storage Buckets |
| `GCS_PROJECT_ID` | GCP-Projekt-ID für GCS |
| `GCS_KEY_FILENAME` | Pfad zu einer GCP-Dienstkonto-Schlüsseldatei (auf GKE weglassen — Workload Identity/ADC stellt Zugangsdaten bereit) |
| `GOOGLE_APPLICATION_CREDENTIALS` | Standard-ADC-Variable, die vom Google-SDK selbst gelesen wird (auf GCP mit Standardanmeldedaten nicht erforderlich) |
| `STORAGE_DOWNLOAD_TOKEN_TTL` | Wie lange die Download-URL einer privaten Datei in Sekunden gültig ist — die Lebensdauer des Tokens, das `/api/storage/metadata/*` generiert (Standard `300`, maximal `604800`, d. h. eine Woche). Erhöhen Sie diesen Wert für private Videos und Audios, die nach dem Rendern der Seite weiterhin Byte-Ranges anfragen. Entspricht der Option `storageDownloadTokenTtl` |
| `STORAGE_MAX_FILE_SIZE` | Größte Datei, die die Quelle akzeptiert, in Bytes (Standard `52428800`, 50 MB). Suffix `__<KEY>` für eine benannte Quelle. Ein Wert, der keine ganze Byte-Zahl ist, verhindert den Systemstart. Siehe [Maximale Dateigröße](#maximale-dateigröße) |
| `FORCE_LOCAL_STORAGE` | Erlaubt `STORAGE_TYPE=local` in Produktionsumgebungen — siehe unten |
| `STORAGE_PUBLIC_READ` | Gespeicherte Objekte für unauthentifizierte Leser bereitstellen. Entspricht `storagePublicRead` und ist eine der drei Möglichkeiten, den [Boot-Guard für die Produktion](#objektbezogene-autorisierung) zu erfüllen. |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Deaktiviert den Boot-Guard und stellt das Verhalten wieder her, bei dem jeder angemeldete Benutzer jeden Schlüssel lesen, überschreiben, löschen oder auflisten darf. Entspricht `storageInsecureAllowAnyAuthenticated`. Nur vertretbar, wenn jedem angemeldeten Benutzer jede Datei anvertraut werden kann. |

## Mehrere Buckets

Ein Projekt kann mehr als ein Bucket haben. Deklarieren Sie jedes davon in `config/resources.ts`
— dem zentralen Ort, den die Plattform, die Runtime und die Konsole gemeinsam lesen:

```ts
import { bucket } from "@rebasepro/types";

export const uploads = bucket({ engine: "s3" });    // the default one
export const media = bucket("media", { engine: "s3", label: "Media" });
```

Führen Sie anschließend `rebase resources --write` aus. Dadurch wird `rebase.resources.json` neu generiert,
sodass ein Host Ihre Topologie ohne Build-Vorgang auslesen kann. Siehe
[Mehrere Quellen](/docs/backend/multiple-sources) für Datenbanken, Buckets und
Topics im Zusammenspiel.

Jede Quelle wird über **dieselben Variablennamen mit ihrem eigenen Suffix** konfiguriert.
Die Standardquelle verwendet kein Suffix, sodass ein Projekt mit nur einem Bucket weiterhin die
einfachen Namen von oben nutzen kann und gar nichts deklarieren muss, und benannte Buckets daneben zu
deklarieren ändert sie nicht (<span class="since-badge" data-since="0.25">Seit 0.25</span>, [Details](/docs/backend/multiple-sources/#which-bucket-receives-an-unqualified-upload)):

```bash
S3_BUCKET=app-uploads             # (default)
S3_BUCKET__MEDIA=app-media        # media
S3_ACCESS_KEY_ID__MEDIA=…
S3_SECRET_ACCESS_KEY__MEDIA=…
```

Das Suffix wird aus dem Schlüssel abgeleitet: Großbuchstaben, nicht-alphanumerische Zeichen durch
Unterstriche ersetzt, hinter einem **doppelten** Unterstrich (`media-cdn` → `__MEDIA_CDN`). Ein
einfacher Unterstrich würde mit echten Variablennamen kollidieren — `S3_BUCKET_NAME`
würde sonst fälschlicherweise als Bucket `name` interpretiert werden.

Leiten Sie eine Eigenschaft über `storageSource` an eine Quelle weiter:

```ts
{
    name: "Cover",
    dataType: "string",
    storage: { storageSource: "media", acceptedFiles: ["image/*"] }
}
```

Eine Quelle, die Sie deklarieren, aber nie konfigurieren, wird **übersprungen** und führt nicht zu einem Abbruch: Uploads,
die an sie weitergeleitet werden, antworten mit `501 STORAGE_SOURCE_NOT_CONFIGURED`. Das Deklarieren eines Buckets
erfolgt meist, bevor jemand Speicher dafür anhängt; ein Startfehler an dieser Stelle würde
das Backend in einer Crash-Schleife halten. Eine Quelle, die die Umgebung *falsch* konfiguriert
— ein Typ ohne Bucket oder ein Bucket ohne Anmeldedaten — führt hingegen zum Abbruch beim Start,
da es sich hierbei um einen Konfigurationsfehler und nicht um ein bewusstes Fehlen handelt.

### Buckets, die sich ein Konto teilen

Anmeldedaten beschreiben üblicherweise den **Provider**, nicht das Bucket. Fünfzehn Buckets auf
einer MinIO-Installation würden andernfalls fünfzehn Kopien desselben Zugriffsschlüssels bedeuten,
und eine Rotation erforderte fünfzehn synchrone Änderungen. Benennen Sie stattdessen ein Konto:

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

Nur Variablen mit Konto-Geltungsbereich fallen auf den Fallback zurück — `S3_ACCESS_KEY_ID`,
`S3_SECRET_ACCESS_KEY`, `S3_ENDPOINT`, `S3_REGION`, `S3_FORCE_PATH_STYLE` sowie
das GCS-Paar `GCS_PROJECT_ID` / `GCS_KEY_FILENAME`. Der Bucket-Name tut dies nie:
Er unterscheidet eine Quelle von der anderen. Ein Wert auf Bucket-Ebene hat immer Vorrang,
sodass eine Quelle den Provider wechseln kann, ohne die anderen zu beeinträchtigen.

## Frontend-Speicherquellen

Wenn Sie mehrere Speicher-Backends verwenden, übergeben Sie `storageSources` an den `<Rebase>`-Provider, damit das Frontend weiß, wie Uploads direkt weitergeleitet werden:

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

Der `key` jeder Quelle muss mit einem Backend-Schlüssel übereinstimmen, der in der `storage`-Map des Servers registriert ist. Der React-Kontext `StorageSourcesContext` löst die aktive Quelle für jedes Upload-Feld auf.

## Caching und CDNs

Jedes Objekt wird über den Server weitergeleitet — mit einem `ETag` für kostengünstige
Neuvalidierung, einem `Cache-Control`, das davon abhängt, wer die Datei lesen darf, und Byte-Ranges
für das Vor- und Zurückspulen in Audio- und Videodateien. Unter [Speicher-Caching und CDNs](/docs/backend/storage-caching/)
finden Sie die Header und Hinweise zur Konfiguration eines vorgelagerten CDNs.

## Tipps für die Produktion

:::caution
**In der Produktion deaktiviert `type: "local"` den Dateispeicher, anstatt ihn zu verwenden.** Auf einer flüchtigen Plattform (Cloud Run, Heroku, ein Kubernetes-Pod) wird das Dateisystem bei jedem Deployment, Neustart und bei jeder Eviction gelöscht — Uploads würden zwar gelingen und sich fehlerfrei auslesen lassen, wären aber beim nächsten Rollout spurlos verschwunden, ohne jegliche Fehlermeldung.

Daher wird der lokale Standardwert in der Produktion nicht registriert, und eine Anfrage an `/api/storage/*`, die keine Speicherquelle benennt, antwortet mit **`501 STORAGE_NOT_CONFIGURED`** und listet die tatsächlich verfügbaren Quellen auf. Eine benannte und konfigurierte Quelle, wie z. B. `bucket("media", { engine: "s3" })`, bleibt weiterhin aktiv. Uploads schlagen unübersehbar und nachvollziehbar fehl; der Rest der Anwendung läuft ungestört weiter. Dateispeicher ist in der Produktion ein Opt-in: Er existiert erst, sobald ein Bucket vorhanden ist.

Setzen Sie `STORAGE_TYPE=s3` oder `gcs`. Wenn ein **dauerhaftes Volume (Durable Volume)** `STORAGE_PATH` bereitstellt, setzen Sie `FORCE_LOCAL_STORAGE=true`, um dies explizit zu bestätigen. Hängen Sie es am übergeordneten Verzeichnis von `STORAGE_PATH` ein, damit das Verzeichnis `<STORAGE_PATH>__<key>` jedes benannten lokalen Buckets ebenfalls darauf liegt.
:::

- Binden Sie ein **persistentes Volume** über das übergeordnete Verzeichnis von `STORAGE_PATH` ein, wenn Sie lokalen Speicher unter Docker/Kubernetes verwenden, und setzen Sie `FORCE_LOCAL_STORAGE=true` — siehe [Self-Hosting](/docs/deployment/self-hosting/#file-storage)
- Verwenden Sie **S3** oder kompatible Dienste (R2, MinIO) bzw. **GCS** für Produktions-Deployments
- Schalten Sie aus Performancegründen ein **CDN** (CloudFront, Cloudflare) vor — siehe [Ein CDN vorschalten](/docs/backend/storage-caching/#putting-a-cdn-in-front)
- **Jede Anwendung mit Speicher in der Produktion muss ein Zugriffsmodell deklarieren** — siehe unten.
  Nicht nur mandantenfähige Anwendungen: Der Server *verweigert den Start* ohne ein solches Modell.

## Objektbezogene Autorisierung

### Richtlinien (Policies)

Die deklarative Form. Eine Liste von Pfadmustern, die ausgewertet wird, ohne Code auszuführen:

```ts
storagePolicies: [
    { path: "public/**", operations: ["read"], allow: "public" },
    { path: "users/:uid/**", allow: ({ params, user }) => user?.uid === params.uid }
]
```

**Ein Schlüssel, auf den keine Richtlinie zutrifft, wird abgelehnt.** Jede Lockerung erfordert eine explizite Zeile,
und ein Konfigurationsfehler verweigert den Zugriff, anstatt ihn versehentlich zu gewähren.

Muster matchen **nach Segmenten, niemals nach Teilzeichenfolgen** — `public/**` matcht nicht
auf `publicity/secret.png`:

| Muster | Treffer |
|---|---|
| `avatars/logo.png` | Exakt dieser Schlüssel |
| `users/*/avatar.png` | Genau ein Segment an der Stelle von `*` |
| `users/:uid/**` | Ein erfasstes Segment, danach der Rest — einschließlich leerer Pfade |

`**` ist nur als abschließendes Segment zulässig. `:name` erfasst ein Segment und erstreckt
sich nie über ein `/` hinweg; die Erfassungen werden als `params` an das Prädikat übergeben.

`allow` ist `"public"` (jeder), `"authenticated"` (jeder Aufrufer mit einer UID) oder ein
Prädikat, das die erfassten Parameter, den Benutzer, die Operation und das Bucket empfängt.
`operations` umfasst standardmäßig alle vier: `read`, `write`, `delete`, `list`.

Richtlinien erfüllen den Boot-Guard für die Produktion eigenständig, und ein fehlerhaftes Muster
lässt den Start scheitern, anstatt erst beim ersten Upload fehlzuschlagen.

### Der Hook

`requireAuth` und `publicRead` sind *globale* Schalter: Sie entscheiden, ob ein Aufrufer angemeldet sein muss, nicht worauf dieser Aufrufer zugreifen darf. Ohne einen Autorisierungs-Hook **kann jeder authentifizierte Benutzer jeden Schlüssel lesen, dessen Namen er kennt** — das Einzige, was die Dateien zweier Mandanten trennt, ist die Unvorhersehbarkeit der Schlüssel, was kein tragfähiges Zugriffskontrollmodell darstellt. Schlimmer noch: Sie können zuerst `GET /storage/list?prefix=` aufrufen, sodass Schlüssel nicht einmal erraten werden müssen.

:::caution[Speicher startet in der Produktion nicht ohne Modell]
Collections werden durch Row-Level Security geschützt; Speicher nicht. Es gibt kein
objektbezogenes Äquivalent im Bucket, daher *ist* dieser Hook das Modell — und
`initializeRebaseBackend` **wirft beim Starten** unter `NODE_ENV=production` einen Fehler,
wenn Speicher konfiguriert ist und keine der folgenden Optionen gesetzt wurde:

- `storageAuthorize` — Ein Hook pro Objekt. Empfohlen.
- `storagePublicRead: true` — Das Bucket dient tatsächlich als rein öffentliches Lese-CDN.
- `storageInsecureAllowAnyAuthenticated: true` — Eine Single-Tenant-Anwendung, bei der jedem
  angemeldeten Benutzer jede Datei anvertraut werden kann. Der Name soll zum zweimaligen Nachdenken anregen.

In der Entwicklungsumgebung wird stattdessen nur eine Warnung ausgegeben. Daher kann ein Projekt hier falsch
konfiguriert sein und lokal einwandfrei funktionieren, bis es produktiv ausgerollt wird. Ein neu generiertes Projekt
enthält in `config/storage.ts` bereits einen Hook — prüfen Sie diesen, bevor Sie ihn ersetzen. Beachten Sie,
dass dieser die *gemeinsame Medienbibliothek* eines CMS abbildet, was sich von benutzerspezifischen Dateien unterscheidet.
:::

`storageAuthorize` ist das Speicher-Pendant zu den Sicherheitsregeln einer Collection und wird nach der Authentifizierung auf jeder Speicher-Route ausgeführt:

```typescript no-verify
await initializeRebaseBackend({
    storage: { type: "s3", bucket: "app-files", /* ... */ },
    storageAuthorize: async ({ key, bucket, operation, user }) => {
        if (!user) return false;
        // Keys are laid out as `{teamId}/{docId}/...`
        const [teamId] = key.split("/");
        return isTeamMember(user.uid, teamId);
    }
});
```

| Feld | Beschreibung |
|-------|-------------|
| `key` | Objektschlüssel, bereinigt um das Bucket-Präfix und Pfad-Traversal-Muster |
| `bucket` | Aufgelöstes Bucket (`"default"`, wenn nicht angegeben) |
| `operation` | `"read"`, `"write"`, `"delete"` oder `"list"` |
| `user` | `{ uid, email?, roles? }`, oder `null`, falls die Route anonymen Zugriff erlaubt |
| `storageId` | Das benannte Backend, falls die Anfrage darauf abzielte — dessen kanonischer Schlüssel (`storageId=%20media` wird zu `"media"`). Fehlt für die Standardquelle, unabhängig davon, wie die Anfrage sie benannt hat (kein Parameter, leer oder `(default)`) |
| `data` | Vertrauenswürdiger Lesezugriff unter **Umgehung von RLS** — `data.collection(slug).find(query)` / `.findById(id)`. Die Eigentümerschaft ist in einem Datensatz hinterlegt, nicht in einem Schlüsselpräfix; der Hook benötigt daher eine Lesemöglichkeit, um zu prüfen: „Wem gehört dieses Objekt?“. Er umgeht die Row-Level Security bewusst: Dieser Hook *ist* die Autorisierungsentscheidung. Würde er über einen Leser laufen, der bereits durch die Rechte des Aufrufers eingeschränkt ist, ergäbe sich ein Zirkelschluss. Konzeptionsbedingt schreibgeschützt. |

Geben Sie `false` zurück, um mit **403** abzulehnen. Das Werfen eines Fehlers lehnt ebenfalls ab — eine Eigentumsprüfung, die fehlschlägt, öffnet das System nicht fälschlicherweise.

Wissenswertes:

- **Auf der Metadaten-Route wird der Lesezugriff tatsächlich entschieden.** Sie generiert das kurzlebige, pfadgebundene Download-Token, dem die Datei-Route vertraut; daher schützt der Hook den Zugriff dort. Zwei Lesearten überspringen den Hook bewusst: Erstens eine Anfrage mit einem solchen Token — der Hook hat die Anfrage beim Generieren des Tokens für genau diesen Pfad und diese Quelle freigegeben; ein Hook, der nun ablehnen würde (weil z. B. eine Mitgliedschaft inzwischen entzogen wurde), stoppt den Zugriff nicht, bevor das Token abläuft (`storageDownloadTokenTtl`, standardmäßig 300 Sekunden). Zweitens das Lesen eines Schlüssels unter `public/` durch einen Aufrufer ohne Anmeldedaten: Das Präfix deklariert, dass jeder die Datei lesen darf, einschließlich anonymer Besucher und CDNs. Ein angemeldeter Aufrufer wird dennoch geprüft, ein anonymer jedoch nicht; ein Hook kann einen `public/`-Schlüssel also nicht privat machen; speichern Sie die Datei stattdessen außerhalb von `public/`. Nur diese beiden Fälle überspringen den Hook: Ein Benutzer, den Ihr Auth-Adapter zufällig `public` nennt, wird wie jeder andere geprüft.
- **Ein Bucket, ein Name.** Auf S3 und GCS lautet das `bucket` des Hooks immer `"default"`, auch wenn eine Anfrage das Bucket des Providers nennt, da dieselben Objekte erreicht werden.
- **Ein Pfad ist öffentlich, wenn der referenzierte Schlüssel öffentlich ist.** Das `public/`-Präfix wird am kanonischen Schlüssel geprüft, den die Route ausliefert — nachdem ein führendes `default/`-Bucket-Segment entfernt und `//`, `./` sowie ein führendes `/` bereinigt wurden — niemals an der URL im Rohzustand. `/api/storage/file/notes://public/x.txt` referenziert den privaten Schlüssel `notes:/public/x.txt`, und der Schlüssel `default/public/x.txt` (aufgerufen als `/api/storage/file/default/default/public/x.txt`) liegt in einem Ordner namens `default`; beide sind nicht öffentlich. Prüfen Sie in einem Hook den übergebenen `key` mit `isPublicStorageKey` aus `@rebasepro/types` — `isPublicStoragePath` wertet clientseitige Pfade oder URLs aus und würde beide fälschlicherweise als öffentlich einstufen.
- **`list` wird am Präfix autorisiert.** Über Listenoperationen lassen sich Schlüssel finden, die einem sonst nicht bekannt wären.
- **Fortsetzbare (TUS) Uploads werden beim Erstellen autorisiert**, sodass ein abgelehnter Upload keine temporäre Datei hinterlässt.
- Das Weglassen des Hooks behält das bisherige Verhalten bei, sodass Single-Tenant-Anwendungen nicht beeinträchtigt werden.

### API-Schlüssel und Tokens

Ein angemeldeter Benutzer besitzt jeden Speicher-Scope, sodass der Hook und die obigen Richtlinien
für ihn entscheiden. Ein [API-Schlüssel](/docs/backend/api-keys/) benötigt zusätzlich den Speicher-Scope
für die jeweilige Operation auf der in der Anfrage benannten Quelle: `storage:read` für
Downloads, Metadaten und Listings; `storage:write` für Uploads, Ordner und alle
Schritte eines fortsetzbaren Uploads; `storage:delete` für Löschvorgänge. Das Ziel ist die
Quell-ID, und die Standardquelle lautet `(default)`: `storage:read:(default)`,
`storage:write:avatars`. Fehlt der Scope, lautet die Antwort `403 SCOPE_MISSING`. Ist er vorhanden,
wird der Hook dennoch ausgeführt — stellvertretend für die Identität des Schlüssels.

## Auf einen Upload reagieren

Auf jeden anderen Schreibvorgang in Rebase kann reagiert werden — eine Datenzeile bietet `beforeSave` und
`afterSave`, ein Zeitplan einen Cron-Job — für Uploads gab es bisher nichts. Alles, was ein
Upload nach sich zog, musste vom Client in einem zweiten Aufruf erledigt werden. Ging die Verbindung
des Clients dazwischen verloren, unterblieb die Aktion vollständig.

```ts
storageTriggers: [
    {
        path: "uploads/:uid/**",
        events: ["finalize"],
        handler: async ({ key, params, size, user }) => {
            await indexUpload.enqueue({ key, uid: params.uid, size }); // a `queue()` in config/resources.ts
        }
    }
]
```

Die Mustersyntax entspricht der von `storagePolicies` — literale Segmente, `*`
für ein einzelnes Segment, `:name` zur Erfassung eines Segments, `**` für den Rest. Ein fehlerhaftes
Muster verhindert den Systemstart, anstatt stillschweigend auf nichts zuzutreffen.

| Ereignis | Wann |
| --- | --- |
| `finalize` | Nachdem das Objekt dauerhaft geschrieben wurde; niemals bei einem fehlgeschlagenen Schreibvorgang |
| `delete` | Nachdem das Objekt gelöscht wurde |

`finalize` wird sowohl für Multipart- als auch für fortsetzbare (TUS) Upload-Pfade ausgelöst — einmal
pro Upload, nicht einmal pro Chunk. Ein fortsetzbarer Upload meldet den Benutzer, der ihn
*erstellt* hat, da dies der Principal ist, den die Autorisierung geprüft hat.

Was ein Handler nicht annehmen darf:

- **Ein Handler, der einen Fehler wirft, lässt die Anfrage nicht fehlschlagen.** Das Objekt ist zu dem
  Zeitpunkt, an dem der Handler läuft, bereits gespeichert. Eine Fehlermeldung an den Client würde
  fälschlicherweise signalisieren, dass der Upload gescheitert sei, woraufhin Clients Uploads wiederholen.
  Fehler werden protokolliert und die Antwort bleibt unberührt. Wenn die Aufgabe zwingend ausgeführt werden muss,
  reihen Sie einen Job in eine Warteschlange (Queue) ein.
- **Handler werden mit `await` blockierend ausgeführt**, in der Reihenfolge ihrer Deklaration, bevor die Antwort gesendet wird —
  Fire-and-Forget würde ein Promise hinterlassen, das eine Serverless-Laufzeitumgebung mitten in der Ausführung einfrieren könnte.
  Ein langsamer Handler führt daher zu einem langsamen Upload; dies ist ein weiterer Grund, Arbeiten in eine Queue auszulagern.
- **Interne Schreibvorgänge lösen keine Trigger aus.** Der Cache für Bildtransformationen schreibt
  abgeleitete Objekte direkt an den Speicher-Controller; ein `**`-Trigger, der darauf anspringen würde,
  würde auf seine eigene Ausgabe reagieren.

## Nächste Schritte

- **[Frontend-Speicher & Datei-Uploads](/docs/frontend/storage)** — Felder und Hooks für Datei-Uploads
- **[Eigenschaften](/docs/collections/properties)** — Konfiguration von Speicher-Eigenschaften
