---
sourceHash: ec729d5ce6fb4036
title: Mehrere Datenbanken und Buckets
sidebar_label: Mehrere Quellen
description: Leiten Sie Collections an verschiedene Datenbanken und Properties an verschiedene Storage-Buckets weiter und konfigurieren Sie jede einzelne über die Umgebung.
---

## Übersicht

Ein Projekt ist nicht auf eine Datenbank und einen Bucket beschränkt. Alles, was
ein Projekt benötigt und einen Namen hat — eine Datenbank, ein Bucket, ein
Topic, eine Queue — wird **mit einem Konstruktor in Ihrer Konfiguration
deklariert** und über eine aus seinem Schlüssel abgeleitete Umgebungsvariable
konfiguriert. Crons und Functions sind Dateien, und sie gelangen unter dem Namen
der Datei in denselben Graphen.

Eine Regel, unabhängig von der Art: Es gibt keine zweite Stelle, an der man
nachsehen müsste, und nichts, was von Hand synchron gehalten werden muss.

## Ressourcen deklarieren

Legen Sie sie in `config/resources.ts` ab. Sie zu exportieren ist gute Praxis —
so haben Sie etwas zum Importieren —, aber registriert werden sie durch die
Deklaration selbst.

```ts
// config/resources.ts
import { bucket, database, queue, topic } from "@rebasepro/types";

/** Die Datenbank des Projekts. Liest DATABASE_URL, wie bisher. */
export const main = database();

/** Eine zweite. Liest DATABASE_URL__ANALYTICS. */
export const analytics = database("analytics", { label: "Analytics warehouse" });

/** Ein Bucket. Liest S3_BUCKET__MEDIA. */
export const media = bucket("media", { engine: "s3", label: "Public media" });

/** Ein Topic, zugestellt über die dauerhafte Job-Queue. */
export const signups = topic<{ userId: string }>("signups");

signups.subscription("send-welcome", async (event) => {
    // …
});
```

`queue()` ist neu <span class="since-badge" data-since="0.18">Since 0.18</span>. `database()`, `bucket()` und `topic()`
lassen sich seit 0.17 deklarieren; ein Projekt auf der veröffentlichten Version
deklariert also diese drei und erreicht Hintergrundarbeit stattdessen über
`jobs.tasks`.

Richten Sie dann eine Collection über das Handle auf eine davon aus — derselbe
Name, einmal geschrieben:

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

...oder eine Datei-Property:

```ts
import { media } from "../resources";

coverImage: {
    name: "Cover image",
    type: "string",
    storage: { storageSource: media, acceptedFiles: ["image/*"] }
}
```

`defineCollection` hält den Schlüssel des Handles fest; ab diesem Punkt ist eine
Collection also einfache Daten — sie serialisiert, sie lässt sich vergleichen,
sie erreicht die Admin-UI. Die String-Form (`dataSource: "analytics"`)
funktioniert weiterhin; dem Handle folgt eine Umbenennung, und „Gehe zu
Definition“ landet dort.

In einer Function erreichen dieselben Handles die Ressource:

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

<span class="since-badge" data-since="0.18">Since 0.18</span>

```bash
rebase resources            # auflisten
rebase resources --write    # rebase.resources.json neu erzeugen
rebase resources --check    # fehlschlagen, wenn diese Datei veraltet ist
```

`rebase.resources.json` wird **generiert** und eingecheckt. Ein Host liest sie,
um zu entscheiden, was bereitzustellen ist, *bevor* er irgendetwas ausführt —
so kann eine Konsole beim ersten Deploy sagen „dieses Projekt möchte einen
`media`-Bucket und hat keinen“. Bearbeiten Sie die Deklarationen, nie die Datei;
`--check` bricht einen Build ab, wenn beide auseinanderlaufen.

Jeder Eintrag hält außerdem fest, **wer sie verwendet** — `collection:page_views`
an einer Datenbank, `property:posts.cover` an einem Bucket, `function:report` an
dem, was die Function aus `resources.ts` importiert. Das ist die Karte, die eine
Konsole braucht, um „was geht kaputt, wenn ich das entferne“ zu beantworten.

`rebase status` geht einen Schritt weiter: Für jede Deklaration sagt es, ob die
Umgebung sie bindet, und zwar mit denselben Resolvern, die auch der Start
verwendet — es kann Sie also nicht über eine Bereitstellung beruhigen, die
gleich den Start verweigern wird.

### Eine Engine, von der der Build nie gehört hat

Jede Art besitzt ihre eigene Engine-Liste, und eine unbekannte wird an der
Aufrufstelle abgelehnt, statt angenommen und später zum Fehler zu werden. Etwas,
das wirklich außerhalb der Liste liegt, schreibt man `custom:`:

```ts
export const objects = bucket("objects", { engine: "custom:minio" });
```

### Eine bereits ausgelieferte Kind-Definition korrigieren

<span class="since-badge" data-since="0.18">Since 0.18</span>

Für Treiber-Autoren. Die registrierte Definition einer Ressourcen-Kind ist
**eingefroren**, sobald ein Paket damit veröffentlicht wurde: jeder
veröffentlichte Treiber trägt eine eigene Kopie von `@rebasepro/types` in sich,
und diese Kopie vergleicht den Eintrag der gemeinsamen Registry mit ihrem
eigenen Literal und wirft bei jeder Abweichung. Das Literal zu ändern tötet
also jedes Bundle, das mit einem älteren Treiber gebaut wurde, beim Laden des
Treibers.

`amendResourceKind` korrigiert, woran eine Kind *bindet* — ihre
Umgebungs-Basisnamen, ihre Options-Schlüssel — ohne das Literal anzufassen, das
eine ältere Kopie vergleicht:

```ts
import { amendResourceKind } from "@rebasepro/types";

amendResourceKind("database", {
    envBases: ["DATABASE_URL", "DATABASE_READ_URL", "ADMIN_CONNECTION_STRING"]
});
```

Die Korrektur gilt nur für Lesezugriffe über diese Kopie, ein älterer Treiber
bindet also weiter so wie zum Zeitpunkt seiner Veröffentlichung. Verwenden Sie
sie für jede Korrektur an einer ausgelieferten Kind; `registerResourceKind` nur
für eine Kind, die noch niemand veröffentlicht hat.

### Sie dem Frontend übergeben

Der `<Rebase>`-Provider muss wissen, welche Quellen es gibt und wie jede erreicht
wird — eine `direct`-Quelle ist eine, mit der der Browser selbst spricht. Er
importiert dasselbe Konfigurationspaket wie das Backend und kann die
Deklarationen daher wiederverwenden, statt sie zu wiederholen:

```tsx
import "../config/resources";                 // registriert sie
import { declaredDataSources, declaredStorageSources } from "@rebasepro/types";

<Rebase
    dataSources={declaredDataSources()}
    storageSources={declaredStorageSources()}
>
    {children}
</Rebase>
```

Der Seiteneffekt-Import ist Absicht: Das Deklarieren ist es, was registriert —
ein Bundler, der ein ungenutztes Modul entfernt, würde beide Listen leer lassen.

## Jede Quelle konfigurieren

Die Namen der Umgebungsvariablen werden vom Ressourcenschlüssel abgeleitet,
sodass nichts manuell synchronisiert werden muss:

```
<VARIABLE>              the default resource   DATABASE_URL, S3_BUCKET
<VARIABLE>__<KEY>       a named resource       DATABASE_URL__ANALYTICS, S3_BUCKET__MEDIA
```

Der Schlüssel wird in Großbuchstaben umgewandelt und nicht-alphanumerische Zeichen werden zu Unterstrichen, sodass
`media-cdn` zu `S3_BUCKET__MEDIA_CDN` wird.

Das Trennzeichen ist absichtlich ein **doppelter** Unterstrich. Ein einzelner würde mit echten
Variablennamen kollidieren — `S3_BUCKET_NAME` würde als Bucket für eine Quelle
namens `name` interpretiert werden.

### Datenbanken

```bash
DATABASE_URL=postgres://localhost/app
DATABASE_URL__ANALYTICS=postgres://warehouse.internal/analytics

# Optional, per source:
DB_POOL_MAX__ANALYTICS=5
REBASE_DRIVER__ANALYTICS=@rebasepro/server-postgres
```

Der Treiber wird aus dem deklarierten `engine` ausgewählt (`postgres` und `mongodb` sind
bekannt), und `REBASE_DRIVER__<KEY>` überschreibt ihn für alles andere.
`REBASE_DB_POOL_MAX` ist eine prozessweite Obergrenze, keine Bindung pro Quelle,
und nimmt daher kein Suffix.

In der Entwicklung stellen Sie davon nichts ein: `rebase dev` bedient jede
deklarierte Datenbank aus seinem verwalteten Postgres — eine zweite Instanz für
`analytics`, bei Bedarf gestartet — und exportiert `DATABASE_URL__ANALYTICS`
selbst. Eine von Hand gesetzte Variable wird nie überschrieben.

Tabellen und Row-Level-Security-Policies werden **pro Quelle** bereitgestellt:
Eine an `analytics` geleitete Collection bekommt ihre Tabelle und ihre Policies
in der Analytics-Datenbank.

### Storage

```bash
S3_BUCKET__MEDIA=my-media-bucket
S3_REGION__MEDIA=eu-central-1
S3_ACCESS_KEY_ID__MEDIA=…
S3_SECRET_ACCESS_KEY__MEDIA=…
```

Die Engine stammt aus der Deklaration, es gibt also kein `STORAGE_TYPE`, das
gesetzt werden müsste.

#### Welcher Bucket einen unqualifizierten Upload erhält

Eine Storage-Eigenschaft, die keine `storageSource` nennt, schreibt in den
**Standard**-Bucket, und ein Projekt mit benannten Buckets muss sagen, welcher
das ist. Entweder deklarieren Sie den Bucket mit dem Standardschlüssel —
`export const uploads = bucket();` — oder markieren einen der benannten:

```ts
export const media = bucket("media", { engine: "s3", default: true });
```

Ohne beides befördert der Start den zuerst deklarierten benannten Bucket und
warnt, wobei er beide Auswege nennt. Nehmen Sie einen davon: eine Beförderung
entscheidet anhand der Deklarationsreihenfolge, wo die Dateien eines Nutzers
landen, und sie fällt dies- und jenseits eines Deploys unterschiedlich aus, weil
der lokale Bucket, mit dem die Entwicklung einspringt, in der Produktion entfällt
— die Beförderung aber nicht.

### Mehrere Buckets auf einem Konto

Jede Variable wird pro Schlüssel gelesen. Für den *Namen* des Buckets ist das
richtig, für die Zugangsdaten falsch — fünfzehn Buckets auf derselben
MinIO-Installation hießen fünfzehn Kopien desselben Access Keys. Benenne ein
`account`, und die Variablen auf Provider-Ebene werden nur einmal gelesen:

```ts
export const media   = bucket("media",   { engine: "s3", account: "minio" });
export const avatars = bucket("avatars", { engine: "s3", account: "minio" });
```

```bash
S3_BUCKET__MEDIA=project-media       # pro Bucket, nie geteilt
S3_BUCKET__AVATARS=project-avatars
S3_ACCESS_KEY_ID__MINIO=…            # einmal gelesen, von beiden
S3_SECRET_ACCESS_KEY__MINIO=…
S3_ENDPOINT__MINIO=https://minio.internal
```

Die Konto-Form deckt die Variablen ab, die den *Provider* beschreiben:
`S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_ENDPOINT`, `S3_REGION`,
`S3_FORCE_PATH_STYLE`, `GCS_PROJECT_ID` und `GCS_KEY_FILENAME`. Der Bucket-Name
gehört nicht dazu und fällt nie auf das Konto zurück — täte er es, würden zwei
Buckets auf einem Konto stillschweigend zu einem.

Ein Wert pro Bucket gewinnt weiterhin, eine einzelne Quelle lässt sich also zu
einem anderen Provider verschieben, ohne die übrigen von ihrem gemeinsamen Konto
zu trennen. Auf die Variable ohne Suffix wird bewusst nicht zurückgegriffen: sie
gehört der Standardquelle, und ließe man einen benannten Bucket sie erben, würde
ein vertippter Schlüssel mit den Zugangsdaten einer anderen Quelle signieren.

## Topics und Queues

Ein Topic wird über die dauerhafte Job-Queue zugestellt: Das Publizieren schreibt
**eine Zeile pro Subscription**, sodass jeder Abonnent nach seinem eigenen
Zeitplan erneut versucht und ein defekter weder die anderen blockiert noch sie
erneut laufen lässt.

```ts
await signups.publish({ userId });
```

Eine Queue ist die andere Form von Hintergrundarbeit: eine Arbeitsliste mit
**einem Handler**, bei der der Aufrufer die Id des Jobs behält. Queues sind neu
<span class="since-badge" data-since="0.18">Since 0.18</span> — Topics kamen mit 0.17.

```ts
export const thumbnails = queue<{ key: string }>("thumbnails");
thumbnails.handler(async ({ key }, { attempt }) => { /* … */ });

const { id } = await thumbnails.enqueue({ key }, { runAt: new Date(Date.now() + 60_000) });
```

Beide sind **at-least-once**. Ein Worker, der mit einem Job in der Hand stirbt,
gibt ihn frei, und der nächste startet den Handler von vorn — ein Handler muss
also vertragen, ein Ereignis zweimal zu sehen. In einer Transaktion, die
zurückgerollt wird, publiziert oder eingereiht zu haben, ist nie geschehen: Es
ist ein Zeilen-Insert.

Eines von beiden zu deklarieren schaltet die Job-Queue von selbst ein, auf jedem
Startpfad — ein Projekt auf der verwalteten Laufzeitumgebung, das keinen
Einstiegspunkt hat, um `jobs.tasks` durchzureichen, bekommt seine Handler auf
diesem Weg. In ein Topic zu publizieren, das niemand deklariert, oder in eine
Queue ohne Handler einzureihen, wirft einen Fehler, statt Zeilen zu schreiben,
die kein Worker abarbeitet.

## Crons und Functions

Beide sind Dateien — `backend/crons/<name>.ts`, `backend/functions/<name>.ts` —
und beide gelangen unter dem Namen der Datei in den Graphen, der zugleich die Id
ist, unter der der Scheduler einen Cron ausführt, und der Pfad, unter dem eine
Function eingebunden wird. Keines von beiden bindet aus der Umgebung; sie stehen
im Graphen, damit ein Host die Zeitpläne eines Projekts kennt, bevor er
irgendetwas ausführt.

```ts
export default defineCron({
    name: "Nightly cleanup",
    schedule: "0 3 * * *",
    timezone: "Europe/Madrid",
    async handler({ rebase }) { /* … */ }
});
```

Ohne `timezone` wird der Zeitplan in der Zone des Hosts gelesen — UTC in fast
jedem Container, Ihre eigene auf einem Laptop —, sodass `0 3 * * *` dies- und
jenseits eines Deploys eine andere Stunde bedeutet. Eine unbekannte Zone wird
abgelehnt, wenn der Job geladen wird.

## Fehlerverhalten

Eine deklarierte Datenquelle mit Server-Transport ohne Connection String **bricht den
Start ab** und nennt die einzustellende Variable. Dies geschieht absichtlich und ist wichtig zu verstehen:
Die Alternative wäre, dass Collections, die an die fehlende Quelle geleitet werden, stillschweigend auf die
Standard-Datenbank zurückgreifen. Das würde bedeuten, dass Daten an der falschen Stelle landen, während der Server sich
als betriebsbereit meldet — weit schlimmer als ein Container, der den Start verweigert.

Zwei Schlüssel, die denselben Variablennamen ableiten würden, werden ebenfalls abgelehnt, da einer
von ihnen stillschweigend die Konfiguration des anderen lesen würde.

Quellen, die mit `transport: "direct"` deklariert wurden, werden vollständig übersprungen: Der Client
kommuniziert mit diesen selbst, sodass das Backend keine Verbindung hält und keine Konfiguration für diese verlangt.

## Zugriffskontrolle für Storage

Storage-Schlüssel teilen sich einen einzigen flachen Namensraum und unterliegen keiner Row-Level-Security. Ohne ein
explizites Zugriffskontrollmodell wäre die Standardeinstellung daher „jeder angemeldete Benutzer
darf jedes Objekt lesen, überschreiben, löschen oder auflisten“. Die Produktionsumgebung verweigert den Start,
anstatt dies einfach anzunehmen.

Um festzulegen, was Zugriff für Ihr Projekt bedeutet, nutzen Sie einen `storageAuthorize`-Export
aus dem Konfigurationspaket — eine Funktion, da keine Umgebungsvariable ausdrücken kann
„dieser Benutzer darf diesen Schlüssel lesen“:

```ts
// config/index.ts
import type { StorageAuthorize } from "@rebasepro/types";

export const storageAuthorize: StorageAuthorize = async ({ key, user, operation }) => {
    if (!user) return false;
    const [ownerId] = key.split("/");
    return ownerId === user.uid || operation === "read";
};
```

Für Fälle, in denen dies wirklich das Modell ist, gibt es zwei Ausnahmen über Umgebungsvariablen:

- `STORAGE_PUBLIC_READ=true` — Der Bucket ist ein öffentliches CDN mit Nur-Lese-Zugriff. Schreib-,
  Lösch- und Auflistvorgänge erfordern weiterhin eine Authentifizierung.
- `STORAGE_ALLOW_ANY_AUTHENTICATED=true` — Jedem angemeldeten Benutzer wird mit
  jeder Datei vertraut. Vertretbar für eine Single-Tenant-App, niemals für eine Multi-Tenant-App.

## Storage in der Produktionsumgebung

Wenn kein Bucket konfiguriert ist, ist Storage in der Produktionsumgebung **deaktiviert** und Uploads antworten
mit `501`. Die lokale Festplatte ist das Dateisystem des Containers, daher verschwinden dort geschriebene Dateien
beim nächsten Neustart — ein Upload, der mit einem deutlichen Fehler fehlschlägt, kann erneut versucht werden; ein Upload, der auf
einer Festplatte erfolgreich war, die kurz vor dem Löschen steht, nicht. Setzen Sie `FORCE_LOCAL_STORAGE=true` nur, wenn
wirklich ein dauerhaftes Volume eingebunden ist.

Eine Konsequenz, die Sie wissen sollten, wenn Sie Buckets explizit deklarieren:
Es wird kein Standard-Bucket für Sie erfunden. Nur `bucket("media")` zu
deklarieren bedeutet, dass es keinen Standard-Bucket gibt, und eine Property,
die keinen benennt, hat keinen Zielort — beabsichtigt und identisch in
Entwicklung und Produktion. Deklarieren Sie zusätzlich `bucket()`, wenn Sie
einen möchten.

In der Entwicklung ist ein deklarierter Bucket, den nichts bindet, ein lokales
Verzeichnis — `uploads__media` neben dem Standard `uploads` —, welche Engine er
auch deklariert; `bucket("media", { engine: "s3" })` plus `rebase dev` genügt
also, um eine Datei hochzuladen. Der Start sagt, für welche Engine das
Verzeichnis einspringt, und `rebase status` zeigt es gelb neben dem Häkchen. In
der Produktion geschieht das nie, ebenso wenig auf der verwalteten
Laufzeitumgebung: Ein dort erfundener Bucket schriebe Uploads in ein
Container-Dateisystem, das beim nächsten Rollout verschwindet — ein ungebundener
Bucket bleibt daher ungebunden und antwortet mit 501.

## Verwandte Themen

- [Backend-Überblick](/docs/backend/) — `dataSources` und wo die Deklaration lebt
- [Storage-Konfiguration](/docs/backend/storage/) — dieselbe Form für Buckets
- [Umgebung & Konfiguration](/docs/getting-started/configuration/) — die `__SUFFIX`-Konvention, die eine Quelle an ihre Variablen bindet

---
