---
title: Mehrere Datenbanken und Buckets
sidebar_label: Mehrere Quellen
description: Leiten Sie Collections an verschiedene Datenbanken und Properties an verschiedene Storage-Buckets weiter und konfigurieren Sie jede einzelne über die Umgebung.
---

## Übersicht

Ein Projekt ist nicht auf eine Datenbank und einen Bucket beschränkt. Collections
leiten bereits über `dataSource` weiter und Datei-Properties über `storageSource`; auf dieser Seite geht
es darum, wie jede benannte Quelle ihre Konfiguration erhält.

Zwei Schritte: **Deklarieren** Sie die Quellen in Ihrem Konfigurationspaket und **konfigurieren** Sie
dann jede einzelne mit Umgebungsvariablen, die von ihrem Schlüssel abgeleitet werden.

## Quellen deklarieren

Exportieren Sie `dataSources` und `storageSources` aus der `index.ts` Ihres Konfigurationspakets.
Diese werden mit dem Frontend geteilt, das dieselben Deklarationen verwendet, um zu entscheiden,
ob es mit einer Quelle über die Rebase-API oder direkt kommuniziert.

```ts
// config/index.ts
import type { DataSourceDefinition, StorageSourceDefinition } from "@rebasepro/types";

export const dataSources: DataSourceDefinition[] = [
    { key: "(default)", engine: "postgres" },
    { key: "analytics", engine: "postgres", label: "Analytics warehouse" }
];

export const storageSources: StorageSourceDefinition[] = [
    { key: "(default)", engine: "local", transport: "server" },
    { key: "media", engine: "s3", transport: "server", label: "Public media" }
];
```

Richten Sie dann eine Collection auf eine davon aus:

```ts
import { defineCollection } from "@rebasepro/admin-types";
const pageViewsCollection = defineCollection({
    name: "Page Views",
    slug: "page_views",
    table: "page_views",
    dataSource: "analytics",
    properties: { /* … */ }
});
```

...oder eine Datei-Property:

```ts
coverImage: {
    name: "Cover image",
    type: "string",
    storage: { storageSource: "media", acceptedFiles: ["image/*"] }
}
```

## Jede Quelle konfigurieren

Die Namen der Umgebungsvariablen werden vom Quellschlüssel abgeleitet, sodass nichts
manuell synchronisiert werden muss:

```
<VARIABLE>              the default source     DATABASE_URL, S3_BUCKET
<VARIABLE>__<KEY>       a named source         DATABASE_URL__ANALYTICS, S3_BUCKET__MEDIA
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
ADMIN_CONNECTION_STRING__ANALYTICS=postgres://…
REBASE_DRIVER__ANALYTICS=@rebasepro/server-postgres
```

Der Treiber wird aus dem deklarierten `engine` ausgewählt (`postgres` und `mongodb` sind
bekannt), und `REBASE_DRIVER__<KEY>` überschreibt ihn für alles andere.

### Storage

```bash
STORAGE_TYPE__MEDIA=s3
S3_BUCKET__MEDIA=my-media-bucket
S3_REGION__MEDIA=eu-central-1
S3_ACCESS_KEY_ID__MEDIA=…
S3_SECRET_ACCESS_KEY__MEDIA=…
```

`STORAGE_TYPE__<KEY>` kann weggelassen werden, wenn die Deklaration die Engine
bereits benennt.

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

Eine Konsequenz, die Sie wissen sollten, wenn Sie Storage-Quellen explizit deklarieren: Es wird kein
Standard-Bucket für Sie erstellt. Wenn Sie nur eine `media`-Quelle deklarieren, bedeutet das, dass es keine
`(default)`-Quelle gibt, und eine Property, die keine benennt, hat keinen Zielort — beabsichtigt und
identisch in Entwicklung und Produktion. Deklarieren Sie auch `(default)`, wenn Sie eine möchten.

---
