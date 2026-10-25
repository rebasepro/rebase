---
sourceHash: 4b28c5fe78adb3d0
title: Mehrere Datenbanken und Buckets
sidebar_label: Mehrere Quellen
description: Leiten Sie Collections an verschiedene Datenbanken und Properties an verschiedene Storage-Buckets weiter und konfigurieren Sie jedes einzelne über die Umgebung.
---

## Übersicht

Ein Projekt ist nicht auf eine Datenbank und einen Bucket beschränkt. Jedes benannte
Element, das ein Projekt benötigt – eine Datenbank, ein Bucket, ein Topic, eine Queue – wird
**mit einem Konstruktor in Ihrer Konfiguration deklariert** und über die Umgebung durch eine
von seinem Schlüssel abgeleitete Variable konfiguriert. Crons und Funktionen sind Dateien,
und sie werden unter dem Namen der Datei in denselben Graphen aufgenommen.

Eine Regel, unabhängig vom Typ: Es gibt keinen zweiten Ort zum Nachschlagen und nichts,
das manuell synchron gehalten werden muss.

## Ressourcen deklarieren

Legen Sie sie in `config/resources.ts` ab. Der Export ist eine bewährte Praxis – so haben
Sie etwas zum Importieren –, aber die Deklaration selbst registriert sie.

```ts
// config/resources.ts
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
`queue()` seit 0.18.

Verweisen Sie dann über das Handle auf eine davon in einer Collection – derselbe Name, einmal geschrieben:

```ts
import { defineCollection } from "@rebasepro/cms-types";
import { analytics } from "../resources";

const pageViewsCollection = defineCollection({
    name: "Page Views",
    slug: "page_views",
    table: "page_views",
    dataSource: analytics,
    properties: { /* … */ }
});
```

...oder bei einer Datei-Property:

```ts
import { media } from "../resources";

coverImage: {
    name: "Cover image",
    type: "string",
    storage: { storagePath: "covers", storageSource: media, acceptedFiles: ["image/*"] }
}
```

`defineCollection` speichert den Schlüssel des Handles, sodass eine Collection ab diesem Punkt
einfache Daten sind – sie serialisiert, sie vergleicht, sie erreicht die Admin-UI. Die String-Form
(`dataSource: "analytics"`) funktioniert weiterhin; das Handle ist jedoch dasjenige, dem eine
Umbenennung folgt und auf dem die "Jump-to-Definition"-Navigation landet.

In einer Funktion greifen dieselben Handles auf die Ressource zu:

```ts
import { defineFunction } from "@rebasepro/server/functions";
import { analytics, media } from "../../config/resources";

export default defineFunction((app, { rebase }) => {
    app.post("/report", async (c) => {
        const rows = await rebase.sql("select count(*) from page_views", { database: analytics });
        const file = new File([JSON.stringify(rows)], "report.json", { type: "application/json" });
        await rebase.bucket(media).putObject({ key: "report.json", file });
        return c.json({ ok: true });
    });
});
```

### Sehen, was Sie deklariert haben

```bash
rebase resources            # list them
rebase resources --write    # regenerate rebase.resources.json
rebase resources --check    # fail if that file is stale
```

`rebase.resources.json` wird **generiert** und committet. Es ist das, was ein Host liest,
um zu entscheiden, was bereitgestellt werden muss, *bevor* er überhaupt etwas ausführt – so
kann eine Konsole beim ersten Deployment sagen: "Dieses Projekt benötigt einen `media`-Bucket,
hat aber keinen". Bearbeiten Sie die Deklarationen, niemals die Datei; `--check` lässt einen
Build fehlschlagen, wenn die beiden nicht übereinstimmen.

Jeder Eintrag erfasst auch, **wer ihn verwendet** – `collection:page_views` bei einer
Datenbank, `property:posts.cover` bei einem Bucket, `function:report` bei allem, was
die Funktion aus `resources.ts` importiert. Das ist die Zuordnung, die eine Konsole benötigt,
um die Frage "Was geht kaputt, wenn ich das entferne?" zu beantworten.

`rebase status` geht noch einen Schritt weiter: Für jede Deklaration gibt der Befehl an,
ob die Umgebung sie bindet, und nutzt dabei dieselben Resolver wie der Boot-Vorgang.
So kann er Sie nicht über ein Deployment in falscher Sicherheit wiegen, das kurz davor steht,
den Start zu verweigern.

### Eine Engine, von der der Build noch nie gehört hat

Jeder Typ verwaltet seine eigene Engine-Liste, und eine unbekannte Engine wird direkt
am Aufrufungsort abgewiesen, anstatt akzeptiert zu werden und später fehlzuschlagen.
Etwas, das wirklich außerhalb der Liste liegt, wird mit `custom:` angegeben:

```ts
export const objects = bucket("objects", { engine: "custom:minio" });
```

### Korrigieren eines Typs, der bereits ausgeliefert wurde

Für Driver-Autoren: Die registrierte Definition eines Ressourcentyps ist **eingefroren**,
sobald ein Paket veröffentlicht wurde, das ihn enthält. Jeder veröffentlichte Driver bindet
seine eigene Kopie von `@rebasepro/types` ein, und die Kopie vergleicht den Eintrag der
gemeinsamen Registry mit ihrem eigenen Literal und wirft bei jeder Abweichung einen Fehler.
Das Bearbeiten des Literals bricht daher jedes Bundle ab, das mit einem älteren Driver
beim Laden des Drivers erstellt wurde.

`amendResourceKind` korrigiert, was ein Typ *bindet* – seine Umgebungs-Basen, seine
Optionsschlüssel –, ohne das Literal zu berühren, das ältere Kopien vergleichen:

```ts
import { amendResourceKind } from "@rebasepro/types";

amendResourceKind("database", {
    envBases: ["DATABASE_URL", "DATABASE_READ_URL", "ADMIN_CONNECTION_STRING"]
});
```

Die Änderung gilt nur für Lesevorgänge über diese Kopie, sodass ein älterer Driver die
Bindung weiterhin so vornimmt, wie es bei seiner Veröffentlichung der Fall war. Verwenden
Sie dies für jede Korrektur an einem bereits ausgelieferten Typ; verwenden Sie `registerResourceKind`
nur für einen Typ, den noch niemand veröffentlicht hat.

### Übergabe an das Frontend

Der `<Rebase>`-Provider muss wissen, welche Quellen existieren und wie jede erreicht
wird – eine `direct`-Quelle ist eine, mit der der Browser selbst kommuniziert. Er importiert
dasselbe Konfigurationspaket wie das Backend, sodass er die Deklarationen wiederverwenden
kann, anstatt sie zu wiederholen:

```tsx
import "../config/resources";                 // registers them
import { declaredDataSources, declaredStorageSources } from "@rebasepro/types";

<Rebase
    dataSources={declaredDataSources()}
    storageSources={declaredStorageSources()}
>
    {children}
</Rebase>
```

Der Side-Effect-Import ist beabsichtigt: Das Deklarieren registriert die Ressourcen. Ein Bundler,
der ein ungenutztes Modul verwirft, würde sonst beide Listen leer lassen.

## Jede Quelle konfigurieren

Namen von Umgebungsvariablen werden vom Ressourcenschlüssel abgeleitet, sodass nichts
manuell synchron gehalten werden muss:

```
<VARIABLE>              the default resource   DATABASE_URL, S3_BUCKET
<VARIABLE>__<KEY>       a named resource       DATABASE_URL__ANALYTICS, S3_BUCKET__MEDIA
```

Der Schlüssel wird in Großbuchstaben umgewandelt und nicht-alphanumerische Zeichen werden
zu Unterstrichen, sodass `media-cdn` den Wert `S3_BUCKET__MEDIA_CDN` liest.

Das Trennzeichen ist absichtlich ein **doppelter** Unterstrich. Ein einzelner würde mit
echten Variablennamen kollidieren – `S3_BUCKET_NAME` würde als Bucket für eine Quelle
namens `name` interpretiert werden.

### Datenbanken

```bash
DATABASE_URL=postgres://localhost/app
DATABASE_URL__ANALYTICS=postgres://warehouse.internal/analytics

# Optional, per source:
DB_POOL_MAX__ANALYTICS=5
REBASE_DRIVER__ANALYTICS=@rebasepro/server-postgres
```

Der Driver wird anhand der deklarierten `engine` ausgewählt (`postgres` und `mongodb` sind
bekannt), und `REBASE_DRIVER__<KEY>` überschreibt ihn für alles andere. `REBASE_DB_POOL_MAX`
ist eine prozessweite Obergrenze und keine quellenbezogene Bindung, weshalb es kein Suffix erhält.

In der Entwicklung müssen Sie nichts davon festlegen: `rebase dev` stellt jede deklarierte
Datenbank über seine verwaltete Postgres-Instanz bereit – eine zweite Instanz für `analytics`,
die bei Bedarf gestartet wird – und exportiert `DATABASE_URL__ANALYTICS` selbst. Eine Variable,
die Sie manuell setzen, wird niemals überschrieben.

Tabellen und Row-Level-Security-Richtlinien werden **pro Quelle** bereitgestellt: Eine Collection,
die an `analytics` weitergeleitet wird, erhält ihre Tabelle und ihre Richtlinien in der
Analytics-Datenbank.

### Storage

```bash
S3_BUCKET__MEDIA=my-media-bucket
S3_REGION__MEDIA=eu-central-1
S3_ACCESS_KEY_ID__MEDIA=…
S3_SECRET_ACCESS_KEY__MEDIA=…
```

Die Engine stammt aus der Deklaration, daher muss kein `STORAGE_TYPE` festgelegt werden.

#### Welcher Bucket empfängt einen nicht näher spezifizierten Upload

Eine Storage-Property, die keine `storageSource` angibt, schreibt in den **Standard**-Bucket.
Benannte Buckets zu deklarieren, verschiebt ihn nie. Der Standard behält seine eigene
Konfiguration, was auch immer `config/resources.ts` deklariert: `STORAGE_TYPE`,
`STORAGE_PATH` (`<project>/uploads`, wenn nicht gesetzt) und die Variablen `S3_*` / `GCS_*` ohne
Suffix. Wenn Sie `bucket("media", { engine: "s3" })` zu einem Projekt hinzufügen, das bereits
Dateien in `./uploads` hat, bleiben diese, wo sie sind, und werden weiterhin ausgeliefert.
`media` liest seine eigenen `__MEDIA`-Variablen und springt in der Entwicklung als eigenes
Verzeichnis ein, `uploads__media`.

Um nicht näher spezifizierte Uploads stattdessen an einen benannten Bucket zu schicken,
markieren Sie ihn:

```ts
export const media = bucket("media", { engine: "s3", default: true });
```

Der Standard *ist* dann `media`. Dateien, die der Standard zuvor hielt, bleiben, wo sie
sind, und werden nicht mehr darüber ausgeliefert, kopieren Sie sie daher zuerst hinüber:
`rebase storage move --from "(default)" --to media`.

Zwei Quellen dürfen sich keinen Speicherort teilen. Würde ein benannter Bucket auf das
Verzeichnis des Standards (oder eines darin) oder auf denselben Object-Store-Bucket am
selben Endpunkt auflösen, verweigert der Boot den Start und nennt die Variable, die zu
ändern ist.

Unter 0.24 wird in einem Projekt, das nur benannte Buckets deklariert, der erste deklarierte
beim Boot mit einer Warnung zum Standard befördert, sodass das Hinzufügen von
`bucket("media")` den Standard auf `uploads__media` verschiebt.

### Viele Buckets auf einem Account

Jede Variable wird pro Schlüssel gelesen, was für den Bucket-Namen richtig ist, aber falsch
für die Zugangsdaten – fünfzehn Buckets auf einer MinIO-Installation würden fünfzehn Kopien
desselben Zugriffsschlüssels bedeuten. Geben Sie einen `account` an, und die Variablen auf
Provider-Ebene werden nur einmal gelesen:

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
gehört nicht dazu und greift niemals auf einen Fallback zurück – andernfalls würden zwei
Buckets auf demselben Account stillschweigend zu einem einzigen verschmelzen.

Ein Wert pro Bucket hat weiterhin Vorrang, sofern Sie einen festlegen. So kann eine einzelne
Quelle zu einem anderen Provider migriert werden, ohne die anderen von ihrem gemeinsamen
Account zu trennen. Es gibt bewusst keinen Fallback auf die Variable ohne Suffix: Diese gehört
zur Standardquelle, und würde ein benannter Bucket sie erben, könnte ein Tippfehler im Schlüssel
dazu führen, dass mit den Zugangsdaten einer anderen Quelle signiert wird.

## Topics und Queues

Ein Topic wird über die langlebige Job-Queue zugestellt: Das Veröffentlichen schreibt
**eine Zeile pro Subscription**, sodass jeder Abonnent nach seinem eigenen Zeitplan
Wiederholungsversuche unternimmt. Ein fehlerhafter Abonnent blockiert weder die anderen,
noch führt er dazu, dass sie erneut ausgeführt werden.

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

Beide arbeiten nach dem **At-least-once**-Prinzip. Ein Worker, der abstürzt, während er
einen Job hält, gibt diesen wieder frei, und der nächste startet den Handler von vorn. Ein
Handler muss es also tolerieren können, ein Event zweimal zu sehen. Das Veröffentlichen oder
Einreihen in eine Queue innerhalb einer Transaktion, die zurückgerollt wird, hat nie stattgefunden
– es handelt sich um ein Einfügen einer Zeile (Row Insert).

Das Deklarieren von einem von beiden aktiviert die Job-Queue automatisch auf jedem Boot-Pfad – ein
Projekt auf der verwalteten Runtime, das keinen Einstiegspunkt hat, um `jobs.tasks` zu übergeben,
erhält seine Handler auf diese Weise. Das Veröffentlichen auf einem Topic, das von nichts
deklariert wird, oder das Einreihen in eine Queue ohne Handler wirft einen Fehler, anstatt
Zeilen zu schreiben, die kein Worker verarbeitet.

## Crons und Funktionen

Beide sind Dateien – `backend/crons/<name>.ts`, `backend/functions/<name>.ts` –
und beide werden unter dem Namen der Datei in den Graphen aufgenommen. Dies ist auch die ID,
unter der der Scheduler einen Cron ausführt, und der Pfad, unter dem eine Funktion gemountet wird.
Keines von beiden bindet Variablen aus der Umgebung; sie sind im Graphen enthalten, damit
ein Host die Zeitpläne eines Projekts kennt, bevor er etwas ausführt.

```ts
export default defineCron({
    name: "Nightly cleanup",
    schedule: "0 3 * * *",
    timezone: "Europe/Madrid",
    async handler({ rebase }) { /* … */ }
});
```

Ohne `timezone` wird der Zeitplan in der Zone des Hosts selbst interpretiert – UTC in fast
jedem Container, Ihre lokale Zeitzone auf dem Laptop. Daher bedeutet `0 3 * * *` vor und
nach einem Deployment eine andere Uhrzeit. Eine unbekannte Zeitzone wird beim Laden des Jobs
abgewiesen.

## Fehlerverhalten

Eine deklarierte Datenquelle mit Server-Transport ohne Verbindungszeichenfolge (Connection String)
**führt zum Fehlschlagen des Boot-Vorgangs** und nennt die Variable, die gesetzt werden muss.
Dies ist beabsichtigt und wichtig zu verstehen: Die Alternative bestünde darin, dass Collections,
die an die fehlende Quelle weitergeleitet werden, stillschweigend auf die Standarddatenbank
zurückgreifen. Das würde bedeuten, dass Daten an der falschen Stelle landen, während der Server
sich als fehlerfrei meldet – weitaus schlimmer als ein Container, der den Start verweigert.

Zwei Schlüssel, die denselben Variablennamen ableiten würden, werden ebenfalls abgelehnt,
da einer von ihnen stillschweigend die Konfiguration des anderen lesen würde.

Quellen, die mit `transport: "direct"` deklariert wurden, werden vollständig übersprungen:
Der Client kommuniziert direkt mit ihnen, sodass das Backend keine Verbindung hält und
keine Konfiguration für sie verlangt.

## Zugriffskontrolle für Storage

Storage-Schlüssel teilen sich einen einzigen flachen Namensraum und unterliegen keiner
Row-Level-Security. Ohne ein explizites Zugriffskontrollmodell wäre der Standard daher:
"Jeder angemeldete Benutzer darf jedes Objekt lesen, überschreiben, löschen oder auflisten".
Die Produktionsumgebung verweigert lieber den Start, als dies vorauszusetzen.

Der Weg, um festzulegen, was Zugriff für Ihr Projekt bedeutet, ist ein `storageAuthorize`-Export
aus dem Konfigurationspaket – eine Funktion, da keine Umgebungsvariable ausdrücken kann,
dass "dieser Benutzer diesen Schlüssel lesen darf":

```ts
// config/index.ts
import type { StorageAuthorize } from "@rebasepro/types";

export const storageAuthorize: StorageAuthorize = async ({ key, user, operation }) => {
    if (!user) return false;
    const [ownerId] = key.split("/");
    return ownerId === user.uid || operation === "read";
};
```

Es gibt zwei Umgebungs-Ausnahmen für Fälle, in denen dies wirklich dem Modell entspricht:

- `STORAGE_PUBLIC_READ=true` – der Bucket ist ein öffentliches, schreibgeschütztes CDN.
  Ohne einen `storageAuthorize`-Hook sind Schreib-, Lösch- und Auflistvorgänge nur für Admins.
- `STORAGE_ALLOW_ANY_AUTHENTICATED=true` – jedem angemeldeten Benutzer wird bezüglich jeder
  Datei vertraut. Vertretbar für eine Single-Tenant-App, niemals für eine Multi-Tenant-App.

## Storage in der Produktion

Wenn kein Bucket konfiguriert ist, ist der Speicher in der Produktion **deaktiviert** und Uploads
antworten mit `501`. Die lokale Festplatte ist das Dateisystem des Containers, daher verschwinden
dort geschriebene Dateien beim nächsten Neustart – ein Upload, der deutlich fehlschlägt, kann
wiederholt werden; einer, der auf einer Festplatte erfolgreich war, die gleich gelöscht wird,
nicht. Setzen Sie `FORCE_LOCAL_STORAGE=true` nur dann, wenn wirklich ein persistentes Volume
gemountet ist.

Dieses Volume muss jeden lokalen Bucket aufnehmen, nicht nur den Standard-Bucket. Das Verzeichnis
eines benannten lokalen Buckets liegt neben dem des Standard-Buckets: `<STORAGE_PATH>__<key>`.
Mit `STORAGE_PATH=/storage/uploads` schreibt `bucket("media", { engine: "local" })`
nach `/storage/uploads__media`. Mounten Sie das Volume auf deren übergeordnetem Verzeichnis,
`/storage`, wie es die von `rebase init` erstellte Compose-Datei tut, und nicht auf
`STORAGE_PATH` selbst. `STORAGE_PATH__MEDIA` legt das Verzeichnis eines Buckets explizit fest.
Siehe [Self-Hosting](/docs/deployment/self-hosting/#file-storage).

Buckets zu deklarieren ändert
den Standard-Bucket nicht. Wenn nur `bucket("media")` deklariert ist, liest der Standard
weiterhin seine eigenen Variablen. In der Entwicklung ist er `./uploads`. In der Produktion
ist er ungebunden aus, wie jeder ungebundene Bucket: Uploads, die keine `storageSource`
angeben, antworten mit `501 STORAGE_NOT_CONFIGURED`. Der Boot sagt das einmal, mit beiden
Lösungswegen: ihn binden (`STORAGE_TYPE=s3` und `S3_BUCKET` oder `STORAGE_TYPE=gcs` und
`GCS_BUCKET`) oder einen benannten Bucket mit `default: true` markieren.

In der Entwicklung ist ein deklarierter Bucket, den nichts bindet, ein lokales Verzeichnis –
`uploads__media` neben dem Standard-`uploads` –, unabhängig davon, welche Engine er deklariert.
Daher reicht `bucket("media", { engine: "s3" })` zusammen mit `rebase dev` aus, um eine Datei
hochzuladen. Der Boot-Vorgang zeigt an, für welche Engine das Verzeichnis einspringt, und
`rebase status` zeigt dies in Gelb neben dem Häkchen an. Das passiert niemals in der Produktion
oder auf der verwalteten Runtime: Ein dort erfundener Bucket würde Uploads in ein Container-Dateisystem
schreiben, das beim nächsten Rollout verschwindet. Daher bleibt ein ungebundener Bucket
ungebunden und antwortet mit 501.

## Verwandte Themen

- [Backend-Übersicht](/docs/backend/) – `dataSources` und wo die Deklaration liegt
- [Storage-Konfiguration](/docs/backend/storage/) – derselbe Aufbau für Buckets
- [Umgebung & Konfiguration](/docs/getting-started/configuration/) – die `__SUFFIX`-Konvention, die eine Quelle an ihre Variablen bindet
