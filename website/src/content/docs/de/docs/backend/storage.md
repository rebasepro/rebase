---
sourceHash: 68889c97cefde465
title: Storage-Konfiguration
sidebar_label: Storage-Konfiguration
description: Konfigurieren Sie lokales Dateisystem, S3-kompatible oder GCS/Firebase Storage-Backends für Datei-Uploads, Bilder und Medien.
---

## Übersicht

Rebase unterstützt drei Storage-Backends:

- **Lokales Dateisystem** — Auf der Festplatte gespeicherte Dateien (ideal für die Entwicklung)
- **S3-kompatibel** — AWS S3, MinIO, Cloudflare R2, DigitalOcean Spaces
- **Google Cloud Storage / Firebase Storage** — Native GCS-Unterstützung über `@google-cloud/storage`

## Konfiguration

:::note[Wo dies hingehört]
**Managed Runtime** — die `STORAGE_*`-Variablen in `.env` (`STORAGE_TYPE`, `STORAGE_BUCKET` oder `S3_BUCKET` / `GCS_BUCKET`, `STORAGE_PATH`, `STORAGE_PUBLIC_READ`, … — fügen Sie an beliebige davon das Suffix `__<KEY>` für eine benannte Quelle an), plus eine `bucket("<key>")`-Deklaration in `config/resources.ts` für jeden Bucket neben dem Standard-Bucket, und `export const storageAuthorize` aus `config/index.ts`. `storageAuthorize` existiert bewusst nicht als Umgebungsvariable: Keine Variable kann ausdrücken „dieser Benutzer darf diesen Schlüssel lesen“.

**Ejected** — der `storage`-Block in `initializeRebaseBackend({ … })`. `storagePolicies` und `storageTriggers` sind nur im Ejected-Modus verfügbar.

Die vollständige Übersicht finden Sie in der [Backend-Übersicht](/docs/backend/#where-each-option-lives).
:::

Storage wird im `storage`-Block von `initializeRebaseBackend` konfiguriert:

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

Auf GCP (Cloud Run, GCE, GKE) werden automatisch die Anmeldedaten des Standard-Dienstkontos verwendet. Setzen Sie außerhalb von GCP die Umgebungsvariable `GOOGLE_APPLICATION_CREDENTIALS` auf den Pfad Ihrer Dienstkonto-Schlüsseldatei.

### Mehrere Storage-Backends

Sie können mehrere benannte Backends konfigurieren und verschiedene Felder an unterschiedliche Speicher weiterleiten:

```typescript
storage: {
    "(default)": { type: "local", basePath: "./uploads" },
    "media": { type: "s3", bucket: "media-bucket", region: "us-east-1", ... }
}
```

Verweisen Sie anschließend in Ihren Collection-Properties auf ein bestimmtes Backend:

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

## Storage-Endpunkte

| Methode | Pfad | Beschreibung |
|--------|------|-------------|
| `POST` | `/api/storage/upload` | Direkter Datei-Upload |
| `POST` | `/api/storage/upload?storageId=<key>` | Upload in ein bestimmtes benanntes Backend |
| `GET` | `/api/storage/file/*` | Datei abrufen — alles nach `/file/` ist der Objektschlüssel |
| `GET` | `/api/storage/file/*?storageId=<key>` | Datei von einem bestimmten Backend abrufen |
| `GET` | `/api/storage/metadata/*` | Größe, Content-Type und letzte Änderung eines Objekts ohne dessen Bytes |
| `DELETE` | `/api/storage/file/*` | Datei löschen |
| `GET` | `/api/storage/list` | Objekte unter einem Präfix auflisten (`prefix`, `bucket`, `maxResults`, `pageToken`, `storageId`). Ein `maxResults` unter 1 oder ein `pageToken`, den die Quelle nie ausgegeben hat, ergibt `400 INVALID_LIST_OPTIONS` |
| `POST` | `/api/storage/folder` | Leere Ordnermarkierung erstellen |
| `GET` | `/api/storage/sources` | Die Storage-Quellen, die dieses Backend bedient, nach Schlüssel |
| `OPTIONS` | `/api/storage/tus` | Unterstützte TUS-Protokollfunktionen abfragen |
| `POST` | `/api/storage/tus` | Resumable TUS-Upload-Sitzung initiieren |
| `HEAD` | `/api/storage/tus/:id` | Upload-Fortschritt prüfen (Byte-Offset) |
| `PATCH` | `/api/storage/tus/:id` | Daten-Chunk an temporäre Datei anhängen |
| `DELETE` | `/api/storage/tus/:id` | TUS-Upload-Sitzung beenden/abbrechen |

**Was sie zurückgeben.** Eine einheitliche Envelope-Struktur, dieselbe wie bei `/api/data`: Die Nutzlast befindet sich unter `data`, und ein Fehler ist `{ "error": { message, code, requestId } }` mit den Codes aus der [Fehlerreferenz](/docs/backend/errors/). `/api/storage/file/*` ist die Ausnahme, da die Nutzlast die Datei selbst ist — der Endpunkt liefert die Bytes mit `Content-Type`, `Content-Length` und den Caching-Headern zurück.

```json
// GET /api/storage/list?prefix=products/images/
{ "data": { "items": [ { "bucket": "default", "fullPath": "products/images/a.jpg", "name": "a.jpg" } ], "prefixes": [] } }
```

`POST /api/storage/upload` antwortet mit `201` und den `{ key, bucket, storageUrl }` des gespeicherten Objekts unter `data`; `GET /api/storage/metadata/*` mit den Metadaten des Objekts und, bei einem privaten Objekt, dem kurzlebigen `token`; `GET /api/storage/sources` mit dem Array der konfigurierten Quellen. `DELETE /api/storage/file/*` und `POST /api/storage/folder` übertragen lediglich eine `message`, da es nichts zurückzugeben gibt.

Bei S3 und GCS muss ein `bucket` einer sein, den die Quelle bedient, bei Schreib- wie bei Lesezugriffen: Ein Upload, ein `POST /api/storage/folder` oder ein TUS-Upload, der einen anderen Bucket nennt, antwortet mit `404 UNKNOWN_STORAGE_SOURCE`, wie die Auflistung. Lokaler Storage legt einen Bucket weiterhin beim ersten Schreiben an.

**Wie ein Lesezugriff auf Dateien autorisiert wird.** Die Lese-Routen — `/api/storage/file/*` und `/api/storage/metadata/*` — akzeptieren das kurzlebige signierte Token, das von [`getSignedUrl()`](/docs/sdk/storage) generiert wird, übergeben als `?token=<token>` oder als `Bearer`. Ein gewöhnliches Zugriffs-JWT wird auf `/file/*` mit `401 Unauthorized: Access JWT not allowed on file routes` **abgelehnt**: Das Token, das auf jeder anderen Route funktioniert, funktioniert hier mit Absicht nicht, da eine Datei-URL etwas ist, das an einen Browser, ein CDN oder ein `<img>`-Tag weitergegeben wird. Alle anderen oben aufgeführten Zeilen akzeptieren das Zugriffs-JWT wie gewohnt.

## On-the-Fly-Bildtransformationen

Rebase enthält eine integrierte Bildverarbeitungspipeline auf Basis von **Sharp**. Beim Ausliefern von Bild-Assets aus dem Speicher können Sie dynamische Operationen über Query-Parameter anwenden:

```bash
# Serve image scaled to 300px width in webp format
GET /api/storage/file/products/laptop.jpg?width=300&format=webp
```

### Unterstützte Parameter

- `width`, `height`: Begrenzungen für die Größenänderung, `1`–`4096` (das Bild wird niemals vergrößert).
- `quality`: `1`–`100`.
- `format`: Konvertiert das Bildformat. Unterstützte Formate: `webp`, `jpeg`, `png`, `avif`.
- `fit`: `cover`, `contain`, `fill`, `inside` oder `outside`.

Ein Parameter außerhalb dieser Grenzen führt zu einem **400**-Fehler, nicht zu einem stillschweigend gekappten Wert — `?width=99999` lieferte früher ein 4096px großes Bild zurück und `?format=tiff` ein WebP-Bild, ohne dass dies mitgeteilt wurde.

### Performance & LRU-Caching

Das Transformieren ist CPU- und speicherintensiv, und bei einem öffentlichen Objekt ist der Endpunkt anonym erreichbar. Daher ist der Arbeitsaufwand begrenzt und nicht bloß zwischengespeichert:
- **Kapazität**: Ein global auf **500 Einträge** begrenzter LRU-Cache, indiziert nach Storage-Quelle, Bucket und kanonischem Schlüssel.
- **TTL (Time to Live)**: Zwischengespeicherte Varianten laufen nach **1 Stunde** ab.
- Parallele Anfragen für dieselbe, noch nicht zwischengespeicherte Variante erzeugen **eine** Transformation, nicht jeweils eine pro Anfrage.
- Es wird nur eine geringe Anzahl von Transformationen gleichzeitig ausgeführt; ab einem bestimmten Backlog antwortet der Server mit **503 `TRANSFORM_OVERLOADED`**, anstatt Arbeit anzunehmen, die er nicht bewältigen kann.

Dieser Cache liegt im Prozess, was bedeutet, dass er nicht zwischen Instanzen geteilt wird und einen Neustart nicht übersteht. Zwei Replikate berechnen jede Variante separat, und ein Deployment verwirft den gesamten Cache.

### Renditions, die einen Neustart überstehen

`storageRenditionCache` schreibt jedes abgeleitete Bild zurück in denselben Bucket wie seine Quelle, sodass die Arbeit einmal für das gesamte Deployment erledigt wird und nicht einmal pro Instanz und Release:

```ts
storageRenditionCache: { enabled: true }
```

oder `STORAGE_RENDITION_CACHE=true` für ein Bundle-Deployment. Renditions werden unter dem reservierten Präfix `_rebase/renditions/` gespeichert, indiziert nach der Version des Quellobjekts — das Ersetzen eines Bildes liefert somit sofort das neue aus.

Drei Dinge, die Sie vor der Aktivierung wissen sollten:

- **Ein Lesevorgang schreibt nun.** Jede neue Variante kostet einen `PUT`-Aufruf in Ihrem Bucket. Aus diesem Grund ist die Option standardmäßig deaktiviert.
- **Ein fehlgeschlagener Schreibvorgang ist kein fehlgeschlagener Request.** Read-only-Anmeldedaten oder eine Bucket-Policy, die das Präfix ablehnt, fallen auf den prozessinternen Cache zurück; das Bild wird weiterhin ausgeliefert und die Ursache wird einmalig protokolliert.
- **Ersetzte Renditions werden nicht automatisch bereinigt.** Das Ersetzen eines Quellobjekts hinterlässt dessen alte Renditions. Richten Sie eine Lifecycle-Regel für `_rebase/renditions/` ein — dieses Präfix ist fest vorgegeben und nicht konfigurierbar, genau damit eine Regel darauf verweisen kann.

Das Präfix kann nicht über die API adressiert werden. Ein direkter Lese- oder Schreibzugriff darauf antwortet mit **400 `INVALID_STORAGE_KEY`**: Jede Zugriffsregel im Produkt — sowohl `storageAuthorize` als auch die deklarativen Policies — wird gegen den *Quell*-Schlüssel definiert, und eine Rendition, die unter ihrem eigenen Pfad bereitgestellt wird, würde eine Frage beantworten, die niemand gestellt hat.

### Was ausgeliefert wird

Der gespeicherte Content-Type entspricht dem, was der Uploader deklariert hat — nichts analysiert die Bytes. Daher rendert `/api/storage/file/*` nur eine **strenge Allowlist** inline: Bilder (außer SVG), Video, Audio, `application/pdf` und `text/plain`. Alles andere, einschließlich `text/html` und `image/svg+xml`, wird als `application/octet-stream` mit `Content-Disposition: attachment` ausgeliefert, und jede Antwort enthält `X-Content-Type-Options: nosniff`. Storage ist kein Webhost: Eine hochgeladene Seite, die auf dem API-Origin gerendert wird, könnte die Cookies dieses Origins auslesen und dessen Endpunkte aufrufen.

## TUS-Protokoll für fortsetzbare Uploads

Für das Hochladen großer Dateien (bis zu **5 GB**) oder bei instabilen Netzwerkbedingungen implementiert Rebase das offene Protokoll **TUS v1.0.0** einschließlich der Erweiterungen `Creation` und `Termination`.

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

1. **Sitzungsinitialisierung (`POST`)**: Der Client sendet die gesamte Dateigröße im `Upload-Length`-Header und Base64-Metadaten über `Upload-Metadata`. Der Server erstellt eine leere Platzhalterdatei unter einem versteckten temporären Verzeichnis `.tus-uploads/` und gibt die Upload-URL zurück.
2. **Fortschrittsabfragen (`HEAD`)**: Wird ein Upload unterbrochen, fragt der Client die Upload-URL mittels einer `HEAD`-Anfrage ab. Der Server gibt die aktuelle Byte-Position im `Upload-Offset`-Header zurück.
3. **Daten anhängen (`PATCH`)**: Der Client setzt das Senden der Binärdaten ab dem zurückgegebenen Offset mit `Content-Type: application/offset+octet-stream` fort. Der Server schreibt eingehende Chunks über Nodes Low-Level-Dateisystem-APIs `open` und `write` direkt an den angegebenen Byte-Offset der temporären Datei.
4. **Finalisierung**: Wenn der akkumulierte `Upload-Offset` mit der deklarierten `Upload-Length` übereinstimmt, liest Rebase die fertige temporäre Datei ein, verpackt sie als Standard-JavaScript-`File`-Objekt und speichert sie im konfigurierten Storage-Backend (lokale Festplatte oder S3). Die temporäre Datei wird anschließend gelöscht.
5. **Regelmäßige Bereinigung**: Ein Hintergrundprozess läuft alle **60 Sekunden**, um verwaiste, unvollständige temporäre Uploads zu löschen, die das Aufbewahrungslimit von **24 Stunden** überschritten haben.

## Umgebungsvariablen

| Variable | Beschreibung |
|----------|-------------|
| `STORAGE_TYPE` | `"local"`, `"s3"` oder `"gcs"` |
| `STORAGE_PATH` | Lokales Speicherverzeichnis (Standard: `./uploads`) |
| `S3_BUCKET` | S3-Bucket-Name |
| `S3_REGION` | AWS-Region (Standard: `"auto"`) |
| `S3_ACCESS_KEY_ID` | AWS-Access-Key |
| `S3_SECRET_ACCESS_KEY` | AWS-Secret-Key |
| `S3_ENDPOINT` | Benutzerdefinierter S3-Endpunkt (für MinIO, R2) |
| `S3_FORCE_PATH_STYLE` | Pfad-basierte URLs verwenden (für MinIO erforderlich) |
| `GCS_BUCKET` | Google Cloud Storage Bucket-Name |
| `GCS_PROJECT_ID` | GCP-Projekt-ID für GCS |
| `GCS_KEY_FILENAME` | Pfad zu einer GCP-Dienstkonto-Schlüsseldatei (auf GKE weglassen — Workload Identity/ADC liefert Anmeldedaten) |
| `GOOGLE_APPLICATION_CREDENTIALS` | Standard-ADC-Variable, die vom Google-SDK selbst gelesen wird (auf GCP mit Standardanmeldedaten nicht erforderlich) |
| `FORCE_LOCAL_STORAGE` | `STORAGE_TYPE=local` in der Produktion erlauben — siehe unten |
| `STORAGE_PUBLIC_READ` | Gespeicherte Objekte für unauthentifizierte Leser bereitstellen. Die Entsprechung von `storagePublicRead` als Umgebungsvariable und eine von drei Möglichkeiten, den [Boot-Schutz für die Produktion](#autorisierung-auf-objektebene) zu erfüllen. |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Deaktiviert den Boot-Schutz und stellt das Verhalten wieder her, bei dem jeder angemeldete Benutzer jeden Schlüssel lesen, überschreiben, löschen oder auflisten darf. Die Entsprechung von `storageInsecureAllowAnyAuthenticated` als Umgebungsvariable. Nur vertretbar, wenn jedem angemeldeten Benutzer jede Datei anvertraut werden kann. |

## Mehrere Buckets

Ein Projekt kann mehr als einen Bucket besitzen. Deklarieren Sie jeden davon in `config/resources.ts` — der zentralen Stelle, die von der Plattform, der Runtime und der Konsole gemeinsam gelesen wird:

```ts
import { bucket } from "@rebasepro/types";

export const uploads = bucket({ engine: "s3" });    // the default one
export const media = bucket("media", { engine: "s3", label: "Media" });
```

Führen Sie anschließend `rebase resources --write` aus, wodurch `rebase.resources.json` neu generiert wird, damit ein Host Ihre Topologie auslesen kann, ohne einen Build auszuführen. Siehe [Mehrere Quellen](/docs/backend/multiple-sources) für Datenbanken, Buckets und Topics im Zusammenspiel.

Jede Quelle wird über **dieselben Variablennamen konfiguriert, ergänzt um ihr eigenes Suffix**. Die Standardquelle erhält kein Suffix, sodass ein Projekt mit nur einem Bucket weiterhin die einfachen Namen von oben verwendet und überhaupt nichts deklarieren muss:

```bash
S3_BUCKET=app-uploads             # (default)
S3_BUCKET__MEDIA=app-media        # media
S3_ACCESS_KEY_ID__MEDIA=…
S3_SECRET_ACCESS_KEY__MEDIA=…
```

Das Suffix wird aus dem Schlüssel abgeleitet: Großbuchstaben, nicht-alphanumerische Zeichen durch Unterstriche ersetzt, hinter einem **doppelten** Unterstrich (`media-cdn` → `__MEDIA_CDN`). Ein einzelner Unterstrich würde mit echten Variablennamen kollidieren — `S3_BUCKET_NAME` würde sonst als Bucket `name` geparst werden.

Leiten Sie eine Eigenschaft mit `storageSource` an eine Quelle weiter:

```ts
{
    name: "Cover",
    dataType: "string",
    storage: { storageSource: "media", acceptedFiles: ["image/*"] }
}
```

Eine Quelle, die Sie deklarieren, aber nie konfigurieren, wird **übersprungen** und führt nicht zu einem fatalen Fehler: Uploads, die an sie weitergeleitet werden, antworten mit `501 STORAGE_SOURCE_NOT_CONFIGURED`. Das Deklarieren eines Buckets erfolgt normalerweise, bevor jemand Speicher daran bindet, und ein Boot-Fehler an dieser Stelle würde das Backend in eine Crash-Schleife versetzen, bis dies nachgeholt wird. Eine Quelle, die von der Umgebung *falsch* konfiguriert wurde — ein Typ ohne Bucket oder ein Bucket ohne Anmeldedaten —, wird beim Booten abgewiesen, da es sich hierbei um einen Fehler und nicht um ein Fehlen handelt.

### Buckets, die sich ein Konto teilen

Anmeldedaten beschreiben üblicherweise den **Provider**, nicht den Bucket. Fünfzehn Buckets auf einer MinIO-Installation würden andernfalls fünfzehn Kopien desselben Zugriffsschlüssels bedeuten, und eine Schlüsselrotation erforderte fünfzehn synchrone Anpassungen. Vergeben Sie stattdessen einen Kontonamen:

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

Nur die Variablen auf Kontoebene greifen auf den Fallback zurück — `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_ENDPOINT`, `S3_REGION`, `S3_FORCE_PATH_STYLE` sowie das GCS-Paar `GCS_PROJECT_ID` / `GCS_KEY_FILENAME`. Der Bucket-Name tut dies nie: Er ist das, was eine Quelle von einer anderen unterscheidet. Ein Wert pro Bucket hat immer Vorrang, sodass eine Quelle den Provider wechseln kann, ohne die übrigen zu beeinträchtigen.

## Frontend-Storage-Quellen

Wenn Sie mehrere Storage-Backends verwenden, übergeben Sie `storageSources` an den `<Rebase>`-Provider, damit das Frontend weiß, wie Uploads direkt weitergeleitet werden:

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

Der `key` jeder Quelle muss mit einem Backend-Schlüssel übereinstimmen, der in der `storage`-Map des Servers registriert ist. Der React-Kontext `StorageSourcesContext` ermittelt die aktive Quelle für jedes Upload-Feld.

## Caching und CDNs

Jedes Objekt wird über den Server weitergeleitet, anstatt auf eine signierte URL umzuleiten — eine signierte URL schlägt bei Mixed Content (eine HTTPS-Seite, ein HTTP-MinIO) und bei Endpunkten fehl, die nur der Cluster erreichen kann. Die Response-Header sind daher der Schlüssel für ein funktionierendes Caching.

Jede Antwort enthält ein schwaches `ETag` und `Last-Modified`, basierend auf Größe und Änderungszeitpunkt des Objekts. Ein Client, der das Objekt bereits besitzt, sendet `If-None-Match` und erhält ein **304 ohne Body**, sodass ein erneutes Laden lediglich einen Roundtrip anstelle eines Transfers kostet.

`Cache-Control` richtet sich danach, wer das Objekt lesen darf:

| Objekt | Header |
|---|---|
| Unter dem Präfix `public/` oder `publicRead: true` | `public, max-age=60, stale-while-revalidate=86400, must-revalidate` |
| Alles andere | `private, max-age=60, must-revalidate` |
| Bildtransformationen | dasselbe mit `max-age=3600` |

`private` ist eine bewusste Entscheidung: Ein Objekt, für dessen Abruf Anmeldedaten erforderlich waren, darf nicht in einem gemeinsam genutzten Cache gespeichert werden, da ein CDN sonst die Datei eines Benutzers an den nächsten Aufrufer ausliefern könnte. Aus demselben Grund wird `Vary: Authorization` gesendet.

Nichts wird jemals als `immutable` markiert. Ein Storage-Schlüssel kann überschrieben werden — das Schreiben auf einen bestehenden Schlüssel ist ein gewöhnlicher Vorgang —, weshalb das Versprechen, niemals eine Revalidierung vorzunehmen, dazu führen würde, dass eine ersetzte Datei bis zum Ablauf des Fensters unsichtbar bliebe.

### Spulen in Audio und Video

Jede Objektantwort enthält `Accept-Ranges: bytes`, und eine `Range`-Anfrage wird mit `206 Partial Content` und einem `Content-Range` beantwortet. Ohne diesen Header gestattet ein Browser bei einem hierüber bereitgestellten Medienelement kein Spulen — und Safari weigert sich, ein `<video>` abzuspielen, dessen erste Antwort kein `206` ist. Bei Medieninhalten entscheidet dies also über einen funktionierenden oder defekten Player.

- Ein Bereich pro Anfrage: `bytes=0-499`, `bytes=500-`, `bytes=-500`. Das ist das Format, das Browser für die Wiedergabe senden.
- Mehrere Bereiche in einem Header werden mit dem gesamten Objekt und einem `200` beantwortet, was stets zulässig ist. Relevante Clients senden diese Variante nicht.
- Ein Bereich, der hinter dem Dateiende beginnt, liefert ein `416` mit `Content-Range: bytes */<size>`, keine stillschweigende Auslieferung der gesamten Datei.
- Revalidierung hat Vorrang vor einem Bereich: Eine Anfrage, die sowohl `If-None-Match` als auch `Range` enthält, erhält den `304`-Status.

Bei lokalem Speicher wird nur der angeforderte Ausschnitt von der Festplatte gelesen. Bei S3 und GCS wird das Objekt weiterhin vollständig abgerufen — ein `StorageController` verfügt über keinen Bereichslesezugriff —, sodass die Einsparung bei der Antwort und nicht Upstream erzielt wird.

### Ein CDN vorschalten

Da öffentliche Objekte mit `public`, einem `stale-while-revalidate`-Fenster und einem Validator ausgeliefert werden, kann jeder reguläre Reverse-Proxy oder jedes CDN sie ohne zusätzliche Konfiguration zwischenspeichern. Richten Sie ihn auf den API-Origin aus und lassen Sie ihn die Header verarbeiten.

Zwei Dinge sollten am CDN selbst konfiguriert werden:

- **`Vary: Authorization` berücksichtigen** oder authentifizierte Routen überhaupt nicht zwischenspeichern. Ein CDN, das `Vary` ignoriert und `private` Antworten zwischenspeichert, erzeugt genau das Problem, zu dessen Vermeidung dieser Header existiert.
- **Mit Revalidierungen rechnen.** Das kurze `max-age` führt dazu, dass das CDN regelmäßig nachfragt; diese Anfragen sind schlanke 304-Antworten und sorgen dafür, dass ein überschriebenes Objekt nicht veraltet ausgeliefert wird.

## Tipps für die Produktion

:::caution
**In der Produktion deaktiviert `type: "local"` den Dateispeicher, anstatt ihn zu verwenden.** Auf einer kurzlebigen Plattform (Cloud Run, Heroku, ein Kubernetes-Pod) wird das Dateisystem bei jedem Deploy, Neustart und Eviction gelöscht — Uploads wären somit erfolgreich, ließen sich problemlos auslesen und wären beim nächsten Rollout spurlos verschwunden, ohne dass jemals ein Fehler aufgetreten wäre.

Daher wird der lokale Standard nicht registriert, und eine Anfrage an `/api/storage/*`, die keine Storage-Quelle nennt, antwortet mit **`501 STORAGE_NOT_CONFIGURED`** und nennt die bedienten Quellen. Eine benannte Quelle, die konfiguriert ist, etwa `bucket("media", { engine: "s3" })`, bedient weiter. Uploads schlagen unübersehbar und wiederherstellbar fehl; der Rest der Anwendung läuft weiter. Dateispeicher ist in der Produktion ein Opt-in-Feature: Er existiert erst, sobald ein Bucket vorhanden ist.

Setzen Sie `STORAGE_TYPE=s3` oder `gcs`. Wenn unter `STORAGE_PATH` tatsächlich ein **persistentes Volume** gemountet ist, setzen Sie `FORCE_LOCAL_STORAGE=true`, um dies explizit anzugeben.
:::

- Binden Sie ein **persistentes Volume** ein, wenn Sie lokalen Speicher auf Docker/Kubernetes verwenden, und setzen Sie `FORCE_LOCAL_STORAGE=true`
- Verwenden Sie **S3** oder kompatible Dienste (R2, MinIO) oder **GCS** für Produktionsumgebungen
- Schalten Sie ein **CDN** (CloudFront, Cloudflare) vor Ihren Bucket, um die Performance zu optimieren
- **Jede App mit Speicher in der Produktion muss ein Zugriffsmodell deklarieren** — siehe unten. Dies gilt nicht nur für mandantenfähige Anwendungen: Der Server *weigert sich zu starten*, wenn keines vorhanden ist.

## Autorisierung auf Objektebene

### Policies

Die deklarative Variante. Eine Liste von Pfadmustern, die ausgewertet wird, ohne Code auszuführen:

```ts
storagePolicies: [
    { path: "public/**", operations: ["read"], allow: "public" },
    { path: "users/:uid/**", allow: ({ params, user }) => user?.uid === params.uid }
]
```

**Ein Schlüssel, auf den keine Policy zutrifft, wird abgelehnt.** Jede Berechtigungserweiterung muss explizit formuliert werden; ein Versehen führt zur Verweigerung statt zur Freigabe.

Muster vergleichen **nach Pfadsegmenten, niemals nach Teilzeichenketten** — `public/**` passt nicht auf `publicity/secret.png`:

| Muster | Passt auf |
|---|---|
| `avatars/logo.png` | exakt diesen Schlüssel |
| `users/*/avatar.png` | genau ein Segment an der Stelle des `*` |
| `users/:uid/**` | ein erfasstes Segment, danach der Rest — einschließlich nichts |

`**` ist nur als abschließendes Segment zulässig. `:name` erfasst ein einzelnes Segment und erstreckt sich niemals über ein `/`; die erfassten Werte stehen als `params` im Prädikat bereit.

`allow` kann den Wert `"public"` (jeder), `"authenticated"` (jeder Aufrufer mit einer uid) oder ein Prädikat annehmen, das die erfassten Parameter, den Benutzer, die Operation und den Bucket übergeben bekommt. `operations` ist standardmäßig auf alle vier Operationen gesetzt — `read`, `write`, `delete`, `list`.

Policies erfüllen den Boot-Schutz für die Produktion eigenständig; ein fehlerhaftes Muster lässt bereits den Start fehlschlagen und nicht erst den ersten Upload.

### Der Hook

`requireAuth` und `publicRead` sind *globale* Schalter: Sie entscheiden, ob ein Aufrufer angemeldet sein muss, nicht jedoch, worauf dieser Aufrufer zugreifen darf. Ohne einen Autorisierungs-Hook **kann jeder authentifizierte Benutzer jeden Schlüssel lesen, dessen Namen er kennt** — das Einzige, was die Dateien zweier Mandanten trennt, ist die Unvorhersehbarkeit des Schlüssels, was kein Zugriffskontrollmodell darstellt. Schlimmer noch: Sie können zuvor `GET /storage/list?prefix=` ausführen, sodass die Schlüssel nicht einmal erraten werden müssen.

:::caution[Storage startet in der Produktion nicht ohne einen Hook]
Collections werden durch Row-Level Security geschützt; Storage wird das nicht. Es gibt im Bucket kein Äquivalent auf Objektebene, daher *ist* dieser Hook das Modell — und `initializeRebaseBackend` **wirft beim Start eine Exception** unter `NODE_ENV=production`, wenn Storage konfiguriert ist und keine der folgenden Optionen gesetzt wurde:

- `storageAuthorize` — ein Hook pro Objekt. Empfohlen.
- `storagePublicRead: true` — der Bucket ist tatsächlich ein öffentliches Read-only-CDN.
- `storageInsecureAllowAnyAuthenticated: true` — eine Single-Tenant-Anwendung, bei der jedem angemeldeten Benutzer jede Datei anvertraut werden kann. Der Name wurde bewusst so gewählt.

In der Entwicklungsumgebung wird stattdessen eine Warnung ausgegeben, sodass ein Projekt in diesem Punkt fehlerhaft konfiguriert sein und lokal einwandfrei funktionieren kann — bis es deployed wird. Ein neu generiertes Projekt enthält in `config/storage.ts` bereits einen Hook — prüfen Sie diesen, bevor Sie ihn ersetzen, und beachten Sie, dass er die *gemeinsame Medienbibliothek* eines CMS abbildet, was nicht der Struktur benutzerbezogener Dateien entspricht.
:::

`storageAuthorize` ist das Storage-Äquivalent zu den Sicherheitsregeln einer Collection und wird nach der Authentifizierung auf jeder Storage-Route ausgeführt:

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
| `key` | Objektschlüssel, Bucket-Präfix entfernt und Pfad-Traversierung bereinigt |
| `bucket` | Aufgelöster Bucket (`"default"`, wenn nicht angegeben) |
| `operation` | `"read"`, `"write"`, `"delete"` oder `"list"` |
| `user` | `{ uid, email?, roles? }` oder `null`, falls die Route anonymen Zugriff erlaubt |
| `storageId` | Das benannte Backend, sofern die Anfrage an eines gerichtet war |
| `data` | Vertrauenswürdiger, **RLS-umgehender** Lesezugriff — `data.collection(slug).find(query)` / `.findById(id)`. Die Eigentümerschaft ist in einer Tabellenzeile hinterlegt, nicht in einem Schlüsselpräfix; der Hook benötigt daher eine Lesemöglichkeit, um zu ermitteln: „Wem gehört dieses Objekt?“. Er umgeht Row-Level Security ganz bewusst: Dieser Hook *ist* die Autorisierungsentscheidung, und eine Abfrage über eine Instanz vorzunehmen, die bereits durch die Berechtigungen des Aufrufers eingeschränkt ist, wäre zirkulär. Vom Design her rein lesend. |

Geben Sie `false` zurück, um mit einem **403** abzuweisen. Das Werfen einer Exception führt ebenfalls zur Verweigerung — ein Eigentümerabgleich, der fehlschlägt, öffnet nicht fahrlässig den Zugriff.

Wissenswertes:

- **Die Metadaten-Route entscheidet maßgeblich über den Lesezugriff.** Sie generiert das kurzlebige, pfadgebundene Download-Token, dem die Datei-Route vertraut; daher schützt der Hook den Zugriff bereits hier. Anfragen, die bereits ein solches Token mitführen oder einen deklarierten öffentlichen Pfad aufrufen, überspringen den Hook — das Token wurde unter seiner Kontrolle ausgestellt und ist ausschließlich für den eigenen Pfad gültig.
- **`list` wird anhand des Präfixes geprüft.** Über das Auflisten lassen sich Schlüssel ermitteln, die einem zuvor nicht bekannt waren.
- **Fortsetzbare (TUS) Uploads werden bereits bei der Erstellung geprüft**, sodass ein abgelehnter Upload keine temporären Dateien hinterlässt.
- Das Weglassen des Hooks behält das bisherige Verhalten bei, sodass Single-Tenant-Anwendungen davon unberührt bleiben.

## Auf einen Upload reagieren

Auf jeden anderen Schreibvorgang in Rebase kann reagiert werden — eine Tabellenzeile bietet `beforeSave` und `afterSave`, ein Zeitplan besitzt einen Cronjob — ein Upload bot bisher nichts. Alles, was aus einem Upload folgte, musste vom Client in einem zweiten Aufruf erledigt werden. Ging die Verbindung zum Client dazwischen verloren, unterblieb die Aktion vollständig.

```ts
storageTriggers: [
    {
        path: "uploads/:uid/**",
        events: ["finalize"],
        handler: async ({ key, params, size, user }) => {
            await jobs.enqueue("index-upload", { key, uid: params.uid, size });
        }
    }
]
```

Die Mustersprache ist identisch mit `storagePolicies` — Literalsegmente, `*` für ein einzelnes Segment, `:name` zum Erfassen eines Segments, `**` für den Rest — und ein fehlerhaftes Muster lässt den Serverstart fehlschlagen, anstatt stillschweigend auf nichts zu passen.

| Ereignis | Wann |
| --- | --- |
| `finalize` | nachdem das Objekt dauerhaft geschrieben wurde; niemals bei einem fehlgeschlagenen Schreibvorgang |
| `delete` | nachdem das Objekt gelöscht wurde |

`finalize` wird sowohl für reguläre Multipart- als auch für fortsetzbare (TUS) Upload-Pfade ausgelöst — genau einmal pro Upload, nicht einmal pro Chunk. Ein fortsetzbarer Upload übergibt dabei den Benutzer, der ihn *erstellt* hat, da dieser der Akteur war, den die Autorisierungsprüfung validiert hat.

Was ein Handler nicht voraussetzen darf:

- **Ein Handler, der eine Exception wirft, lässt den Request nicht fehlschlagen.** Das Objekt ist zu dem Zeitpunkt, an dem der Handler läuft, bereits gespeichert; dem Client einen Fehler zu melden, würde fälschlicherweise signalisieren, der Upload sei fehlgeschlagen, woraufhin Clients Uploads wiederholen. Fehler werden protokolliert und die HTTP-Antwort bleibt unberührt. Wenn die Folgeverarbeitung zwingend stattfinden muss, reihen Sie einen Job in die Warteschlange ein.
- **Handler werden sequenziell abgewartet**, in der Reihenfolge ihrer Deklaration, bevor die Antwort gesendet wird — ein Fire-and-Forget-Ansatz würde ein Promise hinterlassen, das eine Serverless-Laufzeitumgebung jederzeit mitten in der Ausführung einfrieren könnte. Ein langsamer Handler verlangsamt folglich den gesamten Upload. Dies ist ein weiterer Grund, Arbeit per Queue auszulagern, anstatt sie direkt hier auszuführen.
- **Interne Schreibvorgänge lösen keine Trigger aus.** Der Cache für Bildtransformationen schreibt abgeleitete Objekte direkt in den Storage-Controller; ein `**`-Trigger, der darauf anspringen würde, würde auf seine eigene Ausgabe reagieren.

## Nächste Schritte

- **[Frontend Storage & Datei-Uploads](/docs/frontend/storage)** — Datei-Upload-Felder und Hooks
- **[Properties](/docs/collections/properties)** — Konfiguration von Storage-Properties
