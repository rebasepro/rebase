---
sourceHash: bdf9409c94709498
title: Mehrere Datenbanken und Buckets
sidebar_label: Mehrere Quellen
description: Tabellen an verschiedene Datenbanken und Storage-Spalten an verschiedene Buckets weiterleiten und jede einzelne über die Umgebung konfigurieren.
---

## Übersicht

Ein Projekt ist nicht auf eine Datenbank und ein Bucket beschränkt. Jedes benannte
Element, das ein Projekt benötigt – eine Datenbank, ein Bucket, ein Topic, eine Queue – wird
**mit einem Konstruktor in `backend/resources.ts` deklariert** und über die Umgebung durch eine
Variable konfiguriert, die von seinem Schlüssel abgeleitet ist. Crons und Functions sind Dateien
und treten unter dem Namen der Datei in denselben Graphen ein.

Eine Regel, unabhängig von der Art: Es gibt keinen zweiten Ort zum Nachschlagen und nichts,
das manuell synchron gehalten werden muss.

## Ressourcen deklarieren

Fügen Sie sie in `backend/resources.ts` ein. Sie zu exportieren ist eine bewährte Praxis – so haben
Sie etwas zum Importieren –, aber die Deklaration selbst ist das, was sie registriert.

```ts
// backend/resources.ts
import { bucket, database, queue, topic } from "@rebasepro/types";

/** The project's database. Reads DATABASE_URL, as it always did. */
export const main = database();

/** A second one. Reads DATABASE_URL__ANALYTICS. */
export const analytics = database("analytics", { label: "Analytics warehouse" });

/** A bucket. Reads S3_BUCKET__MEDIA. */
export const media = bucket("media", { engine: "s3", label: "Public media" });

/** A topic, delivered through the durable job queue. */
export const signups = topic<{ userId: string }>("signups");

signups.subscription("send-welcome", async (event) => {
    // …
});
```

`database()`, `bucket()` und `topic()` können seit Version 0.17 deklariert werden,
`queue()` seit Version 0.18.

Verweisen Sie dann über das Handle auf eine Tabelle – derselbe Name, nur einmal geschrieben:

<span class="since-badge" data-since="0.31">Seit 0.31</span>

```ts
// backend/schema/page_views.ts
import { defineTable, col } from "@rebasepro/server/schema";
import { analytics, media } from "../resources";

export const pageViews = defineTable("page_views", {
    database: analytics,
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        path: col.text().notNull(),
        // A file column, stored in the `media` bucket.
        screenshot: col.storage({ path: "screenshots/", source: media, accept: ["image/*"] })
    },
    rls: "admin-only"
});
```

Die kompilierte Tabelle speichert den Schlüssel des Handles, sodass es ab diesem Punkt reine
Daten sind – sie serialisieren sich, lassen sich vergleichen und erreichen das Admin-Panel über
`GET /api/schema/tables`. Die String-Form (`database: "analytics"`) funktioniert ebenfalls;
dem Handle folgt jedoch eine Umbenennung, und „Jump to Definition“ führt direkt dorthin.

In einer Function erreichen dieselben Handles die Ressource:

```ts
import { defineFunction } from "@rebasepro/server/functions";
import { analytics, media } from "../resources";

export default defineFunction((app, { rebase }) => {
    app.post("/report", async (c) => {
        const rows = await rebase.sql("select count(*) from page_views", { database: analytics });
        const file = new File([JSON.stringify(rows)], "report.json", { type: "application/json" });
        await rebase.bucket(media).putObject({ key: "report.json", file });
        return c.json({ ok: true });
    });
});
```

`{ database: analytics }` führt die Abfrage über die eigene Verbindung dieser Quelle aus –
worauf auch immer `DATABASE_URL__ANALYTICS` verweist, auf welchem Server auch immer – und ohne
Option wird sie auf der Standardverbindung ausgeführt. Ein Schlüssel, der keine konfigurierte Quelle
benennt, wird mit einem Fehler abgelehnt, der die vorhandenen Quellen auflistet.

### Deklarationen anzeigen

```bash
rebase resources            # list them
rebase resources --write    # regenerate rebase.resources.json
rebase resources --check    # fail if that file is stale
```

`rebase.resources.json` wird **generiert** und committet. Ein Host liest diese Datei,
um zu entscheiden, was bereitgestellt werden soll, *bevor* er etwas ausführt – so kann
eine Konsole bei einem ersten Deployment melden: „Dieses Projekt benötigt ein `media`-Bucket und hat keines“.
Bearbeiten Sie die Deklarationen, niemals die Datei; `--check` lässt einen Build fehlschlagen,
wenn die beiden nicht übereinstimmen.

Jeder Eintrag erfasst auch, **wer ihn verwendet** – `table:page_views` bei einer
Datenbank, `column:posts.cover` bei einem Bucket, `function:report` bei allem,
was die Funktion aus `resources.ts` importiert. Das ist die Übersicht, die eine Konsole benötigt,
um die Frage zu beantworten: „Was bricht ab, wenn ich dies entferne?“.

`rebase status` geht noch einen Schritt weiter: Für jede Deklaration wird angegeben,
ob die Umgebung sie bindet, wobei dieselben Resolver wie beim Booten verwendet werden,
sodass Sie sich nicht über ein Deployment wiegen können, das gleich den Start verweigern wird.

### Eine Engine, die der Build noch nie gesehen hat

Jede Art verwaltet ihre eigene Liste von Engines, und eine unbekannte Engine wird direkt
am Aufrufungsort abgelehnt, anstatt akzeptiert zu werden und später fehlzuschlagen. Etwas, das
wirklich außerhalb der Liste liegt, wird mit `custom:` angegeben:

```ts
export const objects = bucket("objects", { engine: "custom:minio" });
```

### Eine bereits veröffentlichte Art korrigieren

Für Treiber-Entwickler. Die registrierte Definition einer Ressourcenart ist **eingefroren**, sobald ein
Paket veröffentlicht wurde, das sie enthält: Jeder veröffentlichte Treiber bettet seine eigene Kopie von
`@rebasepro/types` ein, und diese Kopie vergleicht den Eintrag der gemeinsamen Registry mit ihrem
eigenen Literal und wirft bei jedem Unterschied einen Fehler. Die Bearbeitung des Literals
führt daher dazu, dass jedes Bundle, das mit einem älteren Treiber erstellt wurde, beim Laden des Treibers fehlschlägt.

`amendResourceKind` korrigiert, was eine Art *bindet* – ihre Umgebungs-Basen, ihre
Optionsschlüssel –, ohne das Literal zu berühren, das ältere Kopien vergleichen:

```ts
import { amendResourceKind } from "@rebasepro/types";

amendResourceKind("database", {
    envBases: ["DATABASE_URL", "DATABASE_READ_URL", "ADMIN_CONNECTION_STRING"]
});
```

Die Anpassung gilt nur für Lesevorgänge über diese Kopie, sodass ein älterer Treiber
weiterhin so bindet wie zum Zeitpunkt seiner Veröffentlichung. Verwenden Sie dies für jede Korrektur
an einer bereits veröffentlichten Art; verwenden Sie `registerResourceKind` nur für eine Art, die noch niemand veröffentlicht hat.

### Ressourcen an das Frontend übergeben

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Das Frontend importiert `backend/resources.ts` nicht: Ein Werte-Import von
Inhalten unter `backend/` aus `frontend/` wird von `pnpm check:frontend-backend-imports` abgelehnt,
da dadurch Servermodule an den Browser ausgeliefert würden. Das ist auch nicht erforderlich.
Der `<Rebase>`-Provider liest die Buckets, die das Backend bereitstellt, aus `GET /api/storage/sources`
und bindet jedes einzelne an. Jede Tabelle, die das Backend bereitstellt – egal in welcher Datenbank sie
liegt –, wird über die API erreicht.

Was das Frontend selbst deklariert, ist eine `direct`-Quelle – eine Quelle, mit der der Browser
ohne das Backend kommuniziert, wie z. B. Firestore –, die als Live-Instanz über `dataSources` oder
`storageSources` an `<Rebase>` übergeben wird. Siehe
[Firebase](/docs/frontend/firebase/).

## Jede Quelle konfigurieren

Namen von Umgebungsvariablen werden aus dem Ressourcenschlüssel abgeleitet, sodass nichts
manuell synchron gehalten werden muss:

```
<VARIABLE>              the default resource   DATABASE_URL, S3_BUCKET
<VARIABLE>__<KEY>       a named resource       DATABASE_URL__ANALYTICS, S3_BUCKET__MEDIA
```

Der Schlüssel wird in Großbuchstaben umgewandelt und nicht-alphanumerische Zeichen werden zu Unterstrichen,
sodass `media-cdn` den Wert aus `S3_BUCKET__MEDIA_CDN` liest.

Das Trennzeichen ist mit Absicht ein **doppelter** Unterstrich. Ein einfacher Unterstrich würde mit
echten Variablennamen kollidieren – `S3_BUCKET_NAME` würde als das Bucket für eine Quelle namens `name` geparst werden.

### Datenbanken

```bash
DATABASE_URL=postgres://localhost/app
DATABASE_URL__ANALYTICS=postgres://warehouse.internal/analytics

# Optional, per source:
DB_POOL_MAX__ANALYTICS=5
REBASE_DRIVER__ANALYTICS=@rebasepro/server-postgres
```

Der Treiber wird anhand der deklarierten `engine` ausgewählt – `postgres` ist die Engine,
für die Rebase einen Server-Treiber bereitstellt, und die einzige, an die eine Tabelle weitergeleitet werden kann –,
und `REBASE_DRIVER__<KEY>` überschreibt ihn für einen eigenen Treiber. Eine Firestore-Datenbank
ist keine Backend-Ressource: Das CMS liest sie aus dem Browser über
[`defineFirestoreCollection`](/docs/frontend/firebase/).
`REBASE_DB_POOL_MAX` ist eine prozessweite Obergrenze, kein quellenspezifisches Binding,
und hat daher kein Suffix.

In der Entwicklung müssen Sie nichts davon festlegen: `rebase dev` stellt jede deklarierte
Datenbank über seine verwaltete Postgres-Instanz bereit – eine zweite Instanz für `analytics`,
die bei Bedarf gestartet wird – und exportiert `DATABASE_URL__ANALYTICS` selbst. Eine Variable,
die Sie manuell setzen, wird niemals überschrieben.

Tabellen und Row-Level-Security-Policies werden **pro Quelle** bereitgestellt: Eine Tabelle,
die an `analytics` weitergeleitet wird, erhält ihre Tabelle und ihre Policies in der Analytics-Datenbank.

### Storage

```bash
S3_BUCKET__MEDIA=my-media-bucket
S3_REGION__MEDIA=eu-central-1
S3_ACCESS_KEY_ID__MEDIA=…
S3_SECRET_ACCESS_KEY__MEDIA=…
```

Die Engine stammt aus der Deklaration, daher muss kein `STORAGE_TYPE` gesetzt werden.

#### Welches Bucket einen nicht näher spezifizierten Upload empfängt

Eine Storage-Spalte, die keine `source` angibt, schreibt in das **Standard**-Bucket.
Die Deklaration benannter Buckets verschiebt dies niemals. Das Standard-Bucket behält seine eigene
Konfiguration, unabhängig davon, was `backend/resources.ts` deklariert: `STORAGE_TYPE`,
`STORAGE_PATH` (`<project>/uploads`, wenn nicht festgelegt) und die Variablen `S3_*` / `GCS_*` ohne Suffix.
Das Hinzufügen von `bucket("media", { engine: "s3" })` zu einem Projekt, das bereits Dateien in
`./uploads` enthält, belässt diese dort, wo sie sind, und sie werden weiterhin ausgeliefert. `media`
liest seine eigenen `__MEDIA`-Variablen und dient in der Entwicklung als sein eigenes Verzeichnis, `uploads__media`.

Um nicht näher spezifizierte Uploads stattdessen an ein benanntes Bucket zu senden, markieren Sie es:

```ts
export const media = bucket("media", { engine: "s3", default: true });
```

Der Standard *ist* dann `media`. Dateien, die der Standard zuvor enthielt, bleiben dort, wo sie
sind, und werden nicht mehr darüber bereitgestellt; kopieren Sie sie daher vorher herüber:
`rebase storage move --from "(default)" --to media`.

Zwei Quellen dürfen sich keinen Speicherort teilen. Wenn ein benanntes Bucket zum Verzeichnis
des Standards (oder einem Verzeichnis darin) oder zum selben Object-Store-Bucket auf demselben
Endpunkt aufgelöst werden würde, verweigert der Boot-Vorgang den Start und nennt die zu ändernde Variable.

### Viele Buckets auf einem Account

Jede Variable wird pro Schlüssel gelesen, was für den Bucket-Namen richtig und für die Zugangsdaten
falsch ist – fünfzehn Buckets auf einer MinIO-Installation würden fünfzehn Kopien desselben Zugriffsschlüssels bedeuten.
Geben Sie einen `account` an, und die Variablen auf Provider-Ebene werden einmal gelesen:

```ts
export const media   = bucket("media",   { engine: "s3", account: "minio" });
export const avatars = bucket("avatars", { engine: "s3", account: "minio" });
```

```bash
S3_BUCKET__MEDIA=project-media       # per bucket, never shared
S3_BUCKET__AVATARS=project-avatars
S3_ACCESS_KEY_ID__MINIO=…            # read once, by both
S3_SECRET_ACCESS_KEY__MINIO=…
S3_ENDPOINT__MINIO=https://minio.internal
```

Die Account-Form deckt die Variablen ab, die den *Provider* beschreiben:
`S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_ENDPOINT`, `S3_REGION`,
`S3_FORCE_PATH_STYLE`, `GCS_PROJECT_ID` und `GCS_KEY_FILENAME`. Der Bucket-Name
gehört nicht dazu und greift nie auf einen Fallback zurück – andernfalls würden zwei
Buckets auf einem Account stillschweigend zu einem einzigen werden.

Ein Wert pro Bucket hat weiterhin Vorrang, wenn Sie einen festlegen, sodass eine einzelne Quelle
zu einem anderen Anbieter verschoben werden kann, ohne die anderen von ihrem gemeinsamen Account zu trennen.
Es gibt ganz bewusst keinen Fallback auf die Variable ohne Suffix: Diese gehört zur Standardquelle,
und wenn ein benanntes Bucket sie erben würde, würde ein falsch geschriebener Schlüssel mit den
Zugangsdaten einer anderen Quelle signieren.

## Topics und Queues

Ein Topic wird über die durable Job-Queue zugestellt: Das Veröffentlichen schreibt **eine Zeile
pro Subscription**, sodass jeder Subscriber nach seinem eigenen Zeitplan Wiederholungsversuche unternimmt
und ein fehlerhafter Subscriber weder die anderen blockiert noch dazu führt, dass sie erneut ausgeführt werden.

```ts
await signups.publish({ userId });
```

Eine Queue ist die andere Form von Hintergrundarbeit: eine Arbeitsliste mit **einem
Handler**, bei der der Aufrufer die ID des Jobs hält. Queues wurden in 0.18 eingeführt,
Topics in 0.17.

```ts
export const thumbnails = queue<{ key: string }>("thumbnails");
thumbnails.handler(async ({ key }, { attempt }) => { /* … */ });

const { id } = await thumbnails.enqueue({ key }, { runAt: new Date(Date.now() + 60_000) });
```

Beide arbeiten nach dem **At-least-once**-Prinzip. Ein Worker, der abstürzt, während er einen Job hält,
gibt diesen frei, und der nächste startet den Handler von vorne; ein Handler muss es also tolerieren,
ein Ereignis zweimal zu sehen. Das Veröffentlichen oder Einreihen innerhalb einer Transaktion, die zurückgerollt wird,
hat nie stattgefunden – es handelt sich um das Einfügen einer Tabellenzeile.

Die Deklaration von beiden aktiviert die Job-Queue automatisch auf jedem Boot-Pfad – ein Projekt
auf der verwalteten Runtime, das keinen Entrypoint hat, um `jobs.tasks` zu übergeben, erhält
seine Handler auf diese Weise. Das Veröffentlichen auf einem Topic, das von nichts deklariert wird,
oder das Einreihen in eine Queue ohne Handler wirft einen Fehler, anstatt Zeilen zu schreiben, die kein Worker verarbeitet.

## Crons und Functions

Beide sind Dateien – `backend/crons/<name>.ts`, `backend/functions/<name>.ts` –
und beide treten unter dem Namen der Datei in den Graphen ein, der auch die ID ist, unter der
der Scheduler einen Cron ausführt, und der Pfad, unter dem eine Function gemountet wird. Keines von beiden
bindet Werte aus der Umgebung; sie sind im Graphen enthalten, damit ein Host die Zeitpläne eines Projekts
kennt, bevor er etwas ausführt.

```ts
export default defineCron({
    name: "Nightly cleanup",
    schedule: "0 3 * * *",
    timezone: "Europe/Madrid",
    async handler({ rebase }) { /* … */ }
});
```

Ohne `timezone` wird der Zeitplan in der zeitzoneneigenen Zeitzone des Hosts gelesen – UTC in fast
jedem Container, Ihre lokale Zeitzone auf einem Laptop – sodass `0 3 * * *` vor und nach einem Deploy
eine andere Stunde bedeuten kann. Eine unbekannte Zeitzone wird beim Laden des Jobs abgewiesen.

## Fehlerverhalten

Eine deklarierte Datenquelle mit Server-Transport ohne Connection-String **bringt den
Boot-Vorgang zum Scheitern** und nennt die zu setzende Variable. Das ist Absicht und wichtig zu verstehen:
Die Alternative bestünde darin, dass Tabellen, die an die fehlende Quelle weitergeleitet werden,
stillschweigend auf die Standarddatenbank zurückgreifen. Das würde bedeuten, dass Daten an der falschen Stelle landen,
während ein Server sich als funktionstüchtig meldet – weit schlimmer als ein Container, der den Start verweigert.

Zwei Schlüssel, die denselben Variablennamen ableiten würden, werden ebenfalls abgelehnt,
da einer von ihnen stillschweigend die Konfiguration des anderen lesen würde.

Quellen, die mit `transport: "direct"` deklariert wurden, werden vollständig übersprungen: Der Client
kommuniziert selbst mit ihnen, sodass das Backend keine Verbindung hält und keine Konfiguration für sie verlangt.

## Zugriffskontrolle für Storage

Storage-Schlüssel teilen sich einen gemeinsamen, flachen Namensraum und unterliegen nicht der Row-Level Security.
Ohne ein explizites Zugriffskontrollmodell wäre die Standardeinstellung daher: „Jeder angemeldete Benutzer
darf jedes Objekt lesen, überschreiben, löschen oder auflisten“. Die Produktionsumgebung verweigert lieber den Start,
als dies anzunehmen.

Um zu definieren, was Zugriff für Ihr Projekt bedeutet, verwenden Sie einen `storageAuthorize`-Export
aus `backend/storage.ts` – eine Funktion, da keine Umgebungsvariable ausdrücken kann:
„Dieser Benutzer darf diesen Schlüssel lesen“:

```ts
// backend/storage.ts
import type { StorageAuthorize } from "@rebasepro/types";

export const storageAuthorize: StorageAuthorize = async ({ key, user, operation }) => {
    if (!user) return false;
    const [ownerId] = key.split("/");
    return ownerId === user.uid || operation === "read";
};
```

Es gibt zwei Umgebungs-Ausweichmöglichkeiten für Fälle, in denen dies wirklich das gewünschte Modell ist:

- `STORAGE_PUBLIC_READ=true` – Das Bucket ist ein öffentliches CDN mit reinem Lesezugriff. Ohne einen
  `storageAuthorize`-Hook sind Schreib-, Lösch- und Auflistungsvorgänge nur für Admins möglich.
- `STORAGE_ALLOW_ANY_AUTHENTICATED=true` – Jedem angemeldeten Benutzer wird für jede Datei vertraut.
  Vertretbar für eine Single-Tenant-App, niemals für eine Multi-Tenant-App.

## Storage in der Produktion

Wenn kein Bucket konfiguriert ist, ist Storage in der Produktion **deaktiviert** und Uploads antworten
mit `501`. Der lokale Datenträger ist das Dateisystem des Containers, daher verschwinden dort geschriebene Dateien
beim nächsten Neustart – ein Upload, der deutlich sichtbar fehlschlägt, kann wiederholt werden; ein Upload,
der auf einer Festplatte erfolgreich war, die gleich gelöscht wird, nicht. Setzen Sie `FORCE_LOCAL_STORAGE=true`
nur dann, wenn wirklich ein persistentes Volume gemountet ist.

Dieses Volume muss jedes lokale Bucket enthalten, nicht nur das Standard-Bucket. Das Verzeichnis
eines benannten lokalen Buckets befindet sich neben dem des Standards, `<STORAGE_PATH>__<key>`.
Mit `STORAGE_PATH=/storage/uploads` schreibt `bucket("media", { engine: "local" })`
nach `/storage/uploads__media`. Mounte das Volume auf deren übergeordnetes Verzeichnis,
`/storage`, wie es die Compose-Datei tut, die `rebase init` schreibt, und nicht auf
`STORAGE_PATH` selbst. `STORAGE_PATH__MEDIA` legt das Verzeichnis eines Buckets explizit fest.
Siehe [Self-Hosting](/docs/deployment/self-hosting/#file-storage).

Das Deklarieren von Buckets ändert nichts am Standard-Bucket. Wenn nur `bucket("media")`
deklariert ist, liest der Standard weiterhin seine eigenen Variablen. In der Entwicklung ist das
`./uploads`. In der Produktion ist er, wenn er ungebunden ist, deaktiviert wie jedes ungebundene Bucket:
Uploads, die keine `source` angeben, antworten mit `501 STORAGE_NOT_CONFIGURED`. Der Boot-Prozess
weist einmal darauf hin und nennt beide Lösungen: Binden Sie es (`STORAGE_TYPE=s3` und `S3_BUCKET` oder
`STORAGE_TYPE=gcs` und `GCS_BUCKET`) oder markieren Sie ein benanntes Bucket mit `default: true`.

In der Entwicklung ist ein deklariertes Bucket, das an nichts gebunden ist, ein lokales Verzeichnis –
`uploads__media` neben dem Standard-Verzeichnis `uploads` – unabhängig davon, welche Engine es deklariert.
Daher reicht `bucket("media", { engine: "s3" })` zusammen mit `rebase dev` aus, um eine Datei
hochzuladen. Der Boot-Prozess teilt mit, für welche Engine das Verzeichnis einspringt, und `rebase status`
zeigt dies in Gelb neben dem Häkchen an. Das geschieht niemals in der Produktion oder auf der verwalteten
Runtime: Ein dort fingiertes Bucket würde Uploads in ein Container-Dateisystem schreiben, das beim nächsten
Rollout verschwindet, sodass ein ungebundenes Bucket ungebunden bleibt und mit 501 antwortet.

## Verwandte Themen

- [Backend-Übersicht](/docs/backend/) – Wo jede Deklaration zu finden ist
- [Storage-Konfiguration](/docs/backend/storage/) – Dasselbe Schema für Buckets
- [Umgebung & Konfiguration](/docs/getting-started/configuration/) – Die `__SUFFIX`-Konvention, die eine Quelle an ihre Variablen bindet
