---
sourceHash: f64124003b7de5a4
title: Schema-Generierung
sidebar_label: Schema-Generierung
description: Generieren Sie Drizzle-ORM-Schemas aus Collection-Definitionen, erstellen Sie SQL-Migrationen und halten Sie Ihre Datenbank mit der Rebase-CLI synchron.
---

## Überblick

Rebase verwendet eine **Schema-as-Code**-Pipeline, bei der Ihre TypeScript-Collection-Definitionen die einzige Quelle der Wahrheit sind. Die CLI transformiert sie durch eine deterministische Pipeline:

```
Collections (TypeScript) → Drizzle Schema → SQL Migrations → PostgreSQL
```

Diese Seite behandelt jeden CLI-Befehl, der an dieser Pipeline beteiligt ist.

## Die Pipeline

### 1. Collections → Drizzle-Schema

Ihre Collection-Definitionen in `config/collections/` beschreiben Tabellen, Spalten, Typen, Relationen und Enums. Der Befehl `schema generate` liest diese und gibt eine Drizzle-ORM-Schemadatei aus.

### 2. Drizzle-Schema → Migrationen

Aus dem generierten Drizzle-Schema vergleicht `db generate` mit den Migrationen, die bereits in `drizzle/migrations/` liegen, auf einer Scratch-Datenbank nachgespielt, und erzeugt zeitgestempelte SQL-Migrationsdateien. Es liest Ihre Datenbank nie: Eine Spalte, die der Boot oder `db push` bereits hinzugefügt hat, kommt trotzdem als `ADD COLUMN` heraus.

### 3. Migrationen → PostgreSQL

Der Befehl `db migrate` wendet ausstehende Migrationen auf Ihre PostgreSQL-Datenbank an.

## Befehle

### `rebase schema generate`

Generieren Sie eine Drizzle-ORM-Schemadatei aus Ihren Collection-Definitionen:

```bash
rebase schema generate
```

**Was er tut:**
- Liest alle Collections aus `config/collections/`
- Generiert `backend/src/schema.generated.ts` mit Drizzle-Tabellendefinitionen, Enums und Relationen

**Optionen:**

| Flag | Beschreibung |
|------|-------------|
| `--collections, -c` | Collections-Verzeichnis (Standard: `config/collections/`); relative Pfade werden ausgehend vom Verzeichnis aufgelöst, in dem Sie den Befehl ausführen |
| `--output, -o` | Ausgabepfad für die generierte Schemadatei; relative Pfade werden ausgehend vom Verzeichnis aufgelöst, in dem Sie den Befehl ausführen |
| `--watch, -w` | Auf Änderungen achten und automatisch neu generieren |

Der **Watch-Modus** ist während der Entwicklung nützlich — bearbeiten Sie eine Collection-Datei und das Schema wird sofort neu generiert:

```bash
rebase schema generate --watch
```

### `rebase schema stale`

Prüfen Sie, ob das generierte Schema noch zu den Collections passt:

```bash
rebase schema stale          # report, and exit 1 if anything is stale
rebase schema stale --fix    # regenerate the file instead
```

**Was er tut:**
- Rendert, was die Collections in `config/collections/` erzeugen, und vergleicht es Deklaration für Deklaration mit `backend/src/schema.generated.ts`
- Benennt jeden Unterschied — eine fehlende Tabelle, eine umgetypte Spalte, ein entferntes Enum-Label oder Fremdschlüssel, die so benannt sind, wie ein früheres Release sie abgeleitet hat — und endet mit einem Exit-Code ungleich null
- Mit `--fix` wird die Datei stattdessen neu generiert, statt zu berichten

`rebase dev` hält die Datei von selbst aktuell, dies ist also die Prüfung für einen Build
oder einen CI-Schritt. Er nimmt `--collections` und `--output` wie `rebase schema generate`.

### `rebase schema introspect`

Rekonstruieren Sie Collection-Definitionen aus einer bestehenden PostgreSQL-Datenbank:

```bash
rebase schema introspect
```

**Was er tut:**
- Verbindet sich mit Ihrer Datenbank (mit der Verbindungszeichenfolge aus Ihrer `.env`)
- Inspiziert alle Tabellen, Spalten, Typen und Fremdschlüssel
- Generiert Collection-Definitionsdateien
- <span class="since-badge" data-since="0.25">Seit 0.25</span> Liest die
  Row-Level-Security-Policies jeder Tabelle in die `securityRules` ihrer Collection:
  Name, Befehl, Modus, `TO`-Liste, `USING` und `WITH CHECK`. Die
  `<table>_default_*`-Policies, die Rebase selbst hinzufügt, bleiben außen vor. So legt
  das `db push` danach jede Policy so neu an, wie sie war. Unter 0.24 bleiben die Policies
  aus den Dateien heraus, und ein Push kann eine löschen, deren Name die Form einer
  generierten Policy hat (`<table>_<op>_<hash>`)
- <span class="since-badge" data-since="0.25">Seit 0.25</span> Liest jeden
  Ausdruck (das `USING` einer Policy, einen CHECK, einen Spalten-Default) unter dem
  `search_path`, den der Server verwendet, `public`, sodass eine Funktion im Schema `rebase` als
  `rebase.roles()` geschrieben wird. Verbunden als eine Rolle namens `rebase` setzte der
  Standardpfad dieses Schema an die erste Stelle, und die Regel kam als `roles()` zurück, was der
  Push nicht finden konnte
- <span class="since-badge" data-since="0.25">Seit 0.25</span> Schreibt
  `disableDefaultPolicies: true` an eine Tabelle, die Row-Level-Security aktiviert hat und
  nicht die ganze [Admin-Basis](/docs/collections/security-rules/#policies-a-collection-gets-without-writing-them) hält,
  sodass der Push keine `<table>_default_admin_*`-Policy hinzufügt und der Zugriff auf die Tabelle
  bleibt, wie er war; jeder Teil der Basis, den die Tabelle hat, wird als Regel geschrieben.
  Löschen Sie die Zeile, um dem Server und Admins jede Zeile zu geben. Eine Tabelle mit
  ausgeschalteter RLS behält die Basis, und die Introspektion sagt einmal, welche Tabellen das sind:
  Der Push schaltet RLS ein, was auch immer eine Collection sagt. Unter 0.24 fügte der Push nach
  einer Introspektion jeder Tabelle die Basis hinzu
- <span class="since-badge" data-since="0.25">Seit 0.25</span> Generiert eine
  Tabelle, deren Policies jedem Benutzer seine eigenen Zeilen geben (sie lesen `rebase.uid()`,
  `app.uid` oder das JWT), als Entität in der Navigation, wie wenige Zeilen sie auch hat.
  Unter 0.24 ist eine kleine Tabelle eine Code-Liste, und eine Tabelle, die über eine andere
  besessen wird, ist als deren Kind verborgen
- <span class="since-badge" data-since="0.25">Seit 0.25</span> Gibt gegen eine
  Datenbank, die nicht läuft, einmal dasselbe Banner aus wie `db push` und legt nichts an.
  Es gibt das Ausgabeverzeichnis als absoluten Pfad aus
- <span class="since-badge" data-since="0.25">Seit 0.25</span> Lässt die CHECK- und EXCLUDE-Constraints einer
  Tabelle in der Datenbank, wo der darauffolgende `db push` sie behält. Eine Collection kann
  keines von beiden deklarieren; ein CHECK, den die Introspektion lesen kann (`total >= 0`),
  wird außerdem zur `validation` der Property. Unter 0.24 hat dieser Push sie gelöscht

**Optionen:**

| Flag | Beschreibung |
|------|-------------|
| `--output, -o` | Ausgabeverzeichnis für die generierten Collection-Dateien |
| `--schema` | Das zu lesende Postgres-Schema (Standard: `public`) |
| `--force, -f` | Überschreibt Collection-Dateien, die bereits existieren; ohne es wird eine vorhandene Datei übersprungen |

Dies ist nützlich, wenn Sie Rebase auf einer bestehenden Datenbank einführen — zuerst introspizieren, dann die generierten Collections anpassen.

**Introspektion, gefolgt von Push, ändert nichts.** Die generierten Eigenschaften geben exakt an, was jede Spalte ist — `columnType`, `precision`/`scale`, `defaultValue`, `required`, das `isId` eines Schlüssels (`"increment"` für eine ganzzahlige Identity, `columnType: "serial"` für ein Serial, `"manual"` für einen Schlüssel ohne Default), das `onDelete` einer Relation — und ihr `index: false`, wo der Datenbank der Index fehlt, den Rebase auf der Schlüsselspalte ableiten würde, da eine `belongsTo` [standardmäßig indiziert](/docs/backend/indexes#foreign-keys-are-indexed-for-you) wird. Wo kein Index der Spalte dient, sagt die Zeile das (löschen Sie sie, damit einer gebaut wird); <span class="since-badge" data-since="0.25">Seit 0.25</span> wo ein anderer Index bereits mit ihr beginnt (`orders_customer_id_idx`, ein zusammengesetzter, ein eindeutiger), nennt die Zeile diesen Index, und ohne sie würde der Push einen zweiten bauen. Unter 0.24 sagte sie in beiden Fällen, die Zeile zu löschen — sowie der `search`-Block einer Collection, zurückgelesen aus der Spalte, die er aufgebaut hat — daher plant `rebase db push --dry-run` direkt nach einer Introspektion keine Änderungen. Die Ausnahme ist eine Tabelle mit ausgeschalteter Row-Level-Security: Der Push schaltet sie ein, und der Dry Run führt das sowie die Admin-Basis auf, die er hinzufügt. Wo keine Eigenschaft eine Spalte vollständig abbilden kann — ein `timestamp` ohne Zeitzone, ein `interval`, ein `inet`, ein Enum-Typ, der nicht `<table>_<column>` heißt, ein Default wie `CURRENT_DATE` — weist die Introspektion pro Spalte darauf hin, im Terminal und am Anfang der Datei, mit dem, was ein Push damit tun würde, und, wenn vorhanden, dem Statement, das die beiden in Übereinstimmung bringt (`ALTER TYPE "mood" RENAME TO "customers_current_mood";`). Eine Tabelle, deren Schlüssel aus mehr als einer Spalte besteht, kommt als ein zusammengesetzter Schlüssel zurück, wobei jede Schlüsselspalte ihr `isId` trägt. Sie wird mit ihrem Grund ausgelassen, wenn eine Schlüsselspalte kein `isId` tragen kann (etwa ein Timestamp) oder der Fremdschlüssel einer anderen Tabelle auf sie verweist, was eine einspaltige Relation nicht kann; `db push` lässt eine Tabelle, die keine Collection ist, unangetastet. Auf 0.23 kann der Push direkt nach einer Introspektion weiterhin Typänderungen, entfernte Defaults und NOT NULLs sowie einen Phantom-`id`-Schlüssel planen.

**Wie die generierten Dateien aussehen**

Die Introspektion schreibt Collections gegen `defineCollection`, das die Property-Schlüssel *literal* hält — sodass `propertiesOrder`, `listProperties`, `sort` und `display.title` über Ihre eigenen Spaltennamen vervollständigen und ein Schlüssel, der von einer umbenannten Spalte übrig bleibt, ein Kompilierfehler ist statt einer Zeile, die stillschweigend nichts bewirkt. Welches davon sie importiert, hängt davon ab, wovon Ihr Projekt abhängt, und wird pro Lauf entschieden:

| Ihr Projekt deklariert | Generierte Collections verwenden | `admin`-Block |
|------|------|------|
| `@rebasepro/cms-types` (ein Projekt mit dem Panel) | `defineCollection` aus `@rebasepro/cms-types` | ja |
| `@rebasepro/common` (ein `--headless`-Projekt) | `defineCollection` aus `@rebasepro/common` | nein |
| keines von beiden | eine `PostgresCollectionConfig`-Annotation, mit einer Warnung | nein |

Ein Headless-Projekt hat kein Admin-Panel, und die Core-Typen deklarieren überhaupt kein `admin`-Feld — daher wird der Block dort nicht ausgegeben. Er ist Präsentation (`icon`, `propertiesOrder`, `multiline`); nichts am Schema, an der API oder an Ihren Daten hängt von ihm ab.

### `rebase db push`

Übertragen Sie Schemaänderungen direkt in die Datenbank ohne Migrationsdateien:

```bash
rebase db push
```

**Was er tut:**
- Liest das generierte Drizzle-Schema
- Wendet Änderungen direkt auf die Datenbank an (CREATE, ALTER, DROP)
- Führt den Plan zuerst als Dry-Run aus und hält vor jeder Änderung an, die Daten zerstört: eine gelöschte Tabelle, Spalte, View, ein gelöschtes Schema oder ein gelöschter Typ, ein `TRUNCATE` eine Änderung des Spaltentyps, bei der Werte verloren gehen können (`timestamptz` → `date`, `numeric` → `integer`), oder eine Änderung des Primärschlüssels – `(id)` → `(id, locale)` gibt jeder Zeile eine neue ID, sodass Links, Fremdschlüssel und anderswo gespeicherte IDs ihre Zeile nicht mehr finden. <span class="since-badge" data-since="0.25">Seit 0.25</span> Er hält außerdem vor dem Löschen eines CHECK- oder EXCLUDE-Constraints an, den die Datenbank enthält: Keine Zeile geht verloren, aber von da an nimmt die Datenbank Zeilen an, die sie zuvor abgelehnt hat. Im Terminal fragt er nach, wobei Strg-C oder Strg-D mit Nein antwortet, sonst verweigert er; `--allow-destructive` (oder `--yes`) wendet die Änderung trotzdem an. Ein Push, der dort anhält, löscht auf dem Weg hinaus seine Zwischendatenbank `<db>_dev_diff`
- Schaltet Row-Level Security für jede Collection-Tabelle ein, Junction-Tabellen eingeschlossen, direkt nach der Schemaänderung und vor jedem Schritt, der fehlschlagen kann – ein Push, der mittendrin abbricht, hinterlässt eine neue Tabelle also verweigernd statt offen für jede Anfrage
- Wendet die RLS-Policies Ihrer Collections an und **entfernt Policies, die ein früherer Push ersetzt hat**
- <span class="since-badge" data-since="0.25">Seit 0.25</span> Lässt jeden CHECK- und EXCLUDE-Constraint auf der
  Tabelle einer Collection unverändert. Eine Collection kann keines von beiden deklarieren, es sind
  also die eigenen Regeln der Datenbank, von Hand geschrieben oder mitgebracht von einer Datenbank,
  die `schema introspect` übernommen hat; um einen zu entfernen, löschen Sie ihn von Hand
  (`ALTER TABLE … DROP CONSTRAINT …`). Trigger und Funktionen, die Sie geschrieben haben, werden
  ebenfalls nicht angetastet. Unter 0.24 hat der erste Push nach einer Introspektion jeden CHECK-
  und EXCLUDE-Constraint ohne Rückfrage gelöscht
- <span class="since-badge" data-since="0.25">Seit 0.25</span> Gleicht den Namen von allem, was es in Ruhe lässt,
  exakt ab, auch wenn er ein `.`, `[`, `]` oder `*` enthält. Unter 0.24 wurde ein von Hand
  geschriebener Index mit einem Namen wie `orders_idx[v1]` ohne Rückfrage gelöscht, und ein `.` im
  Namen einer Tabelle oder eines Index ließ jeden Push mit `too many parts in pattern` scheitern
- <span class="since-badge" data-since="0.25">Seit 0.25</span> Baut jeden
  [von Rebase abgeleiteten Fremdschlüssel-Index](/docs/backend/indexes#foreign-keys-are-indexed-for-you),
  der einer vorhandenen Tabelle fehlt, **vor** der Planung mit
  `CREATE INDEX CONCURRENTLY`, sodass Schreibvorgänge auf die Tabelle während des Builds weiterlaufen;
  Atlas findet ihn dann vor. `--dry-run` nennt diese und baut nichts
- <span class="since-badge" data-since="0.25">Seit 0.25</span> Stempelt die
  Policies, die es anwendet, so wie der Boot des Servers, sodass der erste Boot nach einem
  Push sie in Ruhe lässt, statt jede neu anzulegen
- <span class="since-badge" data-since="0.25">Seit 0.25</span> `--dry-run`
  führt unter "Planned row-level security changes" die Row-Level-Security auf, die der Push
  ändern würde: die Tabellen, für die er RLS einschaltet, und jede Policy, die er anlegt, ersetzt
  oder löscht, ermittelt so, wie die eigenen Schritte des Pushs entscheiden. Er sagt "No changes"
  nur, wenn sich weder das Schema noch die Row-Level-Security ändern würde. Wo der Stempel einer
  Policy nicht zu ihrer Regel passt oder sie keinen hat (eine, die `db migrate` angelegt hat, eine
  von Hand geschriebene), legt der Dry Run sie aus ihrer Regel unter einem anderen Namen neu an, in
  einer Transaktion, die er zurückrollt, und vergleicht, was Postgres gespeichert hat: Eine, die
  gleich herauskommt, ist keine Änderung. So plant eine Regel, die `schema introspect` als SQL
  zurückgelesen hat, nichts, und ebenso wenig Policies, die `db migrate` angewendet hat. Nur eine,
  die er nicht vergleichen konnte (etwa weil die Sperre ihrer Tabelle nicht innerhalb von zwei
  Sekunden gewährt wurde), wird getrennt aufgeführt. Der Push selbst gibt eine Zeile aus, die die
  Änderungen zählt. Unter 0.24 zeigte der Dry Run nur den Plan von Atlas, in dem keine Policies
  stehen
- <span class="since-badge" data-since="0.25">Seit 0.25</span> Zeigt jedes
  Statement, das Atlas anwendet, einmal. Atlas verbindet sich ohne SSL mit einer Datenbank auf
  diesem Rechner (`localhost`, `127.x`, `::1`), deren URL kein `sslmode` nennt, wie es die App tut,
  statt an `SSL is not enabled on the server` zu scheitern; eine URL, die `sslmode` nennt, oder ein
  anderer Host wird so übergeben, wie er geschrieben ist. Ein Atlas-Lauf, der vor dem Planen
  scheitert, hinterlässt keine `<db>_dev_diff`-Datenbank
- <span class="since-badge" data-since="0.25">Seit 0.25</span> `--dry-run`
  schreibt nichts vom Projekt: `src/schema.generated.ts` bleibt, wie es ist,
  und die `drizzle/*.sql`-Kopien, die ein älteres Release committet hat, werden genannt, nicht
  gelöscht. Nur die Eingabe des Plans geht nach `.rebase/sql/`, das nicht committet wird
- Erstellt **keine** Migrationsdateien

**Wie lange es dauert.** Fast der gesamte Push ist Atlas, das den Plan berechnet: Es
baut Ihr gewünschtes Schema in einer Scratch-Datenbank auf und vergleicht es mit der echten,
und dieser Aufwand wächst schneller als die Anzahl der Tabellen — auf einem ruhigen Laptop
etwa 0,25 s pro Plan bei 11 Tabellen, 0,9 s bei 111 und 5,5 s bei 411. Ein Push, der
nichts ändert, plant einmal; einer, der etwas ändert, plant zweimal (der Dry-Run,
den das Gate für destruktive Änderungen liest, dann das Anwenden). Ein Push auf ein Schema mit
400 oder mehr Tabellen dauert also zehn Sekunden und mehr, auf einem ausgelasteten oder langsamen Rechner länger.
Diese Zeit gehört Atlas, nicht Ihrer Datenbank: Die Schritte drumherum — das Generieren des
SQL, die RLS-Sperre, Suche, Trigger, Policies, die Rolle — dauern bei dieser Größe wenige Sekunden,
über eine Verbindung zu Ihrer Datenbank.

**Die Dateien, die dabei entstehen**, alle unter `.rebase/sql/` im Backend-Verzeichnis. `db push` und `db generate` schreiben alle fünf bei jedem Lauf aus Ihren Collections, bevor sie eine davon lesen, daher würde eine committete Kopie von nichts gelesen. Das Verzeichnis bringt seine eigene `.gitignore` mit und wird nie committet.

| Datei | Enthält |
|------|-------|
| `schema.sql` | Tabellen, Spalten, Constraints und Indizes — der Soll-Zustand für Atlas und das Einzige, was Atlas vergleicht |
| `policies.sql` | Die RLS-Policies, zu denen Ihre `securityRules` kompiliert werden |
| `search.sql` | Die Volltextsuch-Funktionen und generierten Spalten für Collections mit einem `search`-Block |
| `vector.sql` | pgvector-Extensions und ANN-Indizes |
| `triggers.sql` | `rebase.set_updated_at()` und die `BEFORE UPDATE`-Trigger hinter `autoValue: "on_update"` |

Atlas verwaltet nur die erste Datei, deshalb wenden `db push` und der Schema-Abgleich beim Start die anderen vier selbst an. Ein Deployment **nur mit Migrationen** — eines, das `db migrate` ausführt und nie `db push` — muss diese vier von Hand in eine Migration übernehmen; `db generate` weist darauf hin, wenn eine Änderung für Atlas unsichtbar ist.

Hat ein Projekt diese Dateien unter einem früheren Release nach `drizzle/` committet, werden diese Kopien beim ersten Lauf gelöscht, und der Befehl nennt jede einzeln, damit Sie das Löschen committen können. Gelöscht werden nur Dateien, die mit dem Header des Generators beginnen. Eine Datei, die Sie selbst geschrieben haben, bleibt, ebenso `drizzle/migrations/`.

:::note[Eine Sicherheitsregel zu bearbeiten benennt ihre Policy um]
Eine Regel ohne expliziten `name` wird zu `<table>_<op>_<hash>` kompiliert, wobei der Hash die Semantik der Regel abdeckt — eine Regel zu *bearbeiten* (statt eine hinzuzufügen) erzeugt also eine Policy unter einem neuen Namen und lässt die alte zurück.

Früher war das sehr wichtig: Postgres verknüpft `PERMISSIVE`-Policies mit OR, daher gewährte ein ersetztes `USING (rebase.uid() IS NOT NULL)` weiterhin alles, egal wie streng seine Ersetzung war. Eine Regel zu verschärfen hatte keine Wirkung, und der Push meldete Erfolg.

`db push` gleicht das jetzt ab: Es löscht generierte Policies, die zu keiner Regel mehr passen, und meldet — ohne sie zu löschen — jede Policy mit eigenem Namen, die Ihre Collections nicht beschreiben, da sie sich nicht von SQL unterscheiden lässt, das jemand absichtlich geschrieben hat.

Um eine Datenbank zu prüfen, die vor dieser Änderung gepusht wurde, führen Sie `rebase doctor --policies` aus. Es funktioniert als CI-Gate: Es endet bei Drift mit einem Exit-Code ungleich null, und ebenso, wenn es die Prüfung gar nicht ausführen konnte — keine `DATABASE_URL`, ein `--collections`-Pfad, der sich nicht auflösen lässt, ein Lesen von `pg_policies`, das der CI-Rolle nicht erlaubt ist. Ein Gate, das nicht hinsehen konnte, hat nicht bestanden.

<span class="since-badge" data-since="0.25">Seit 0.25</span> `doctor` und `db push` unterscheiden die beiden Arten verwaister Policies. Eine Policy mit generiertem Namen wurde ersetzt, und der nächste Push löscht sie. Jeder andere Name wurde von Hand oder von einem anderen Werkzeug geschrieben und gilt weiterhin: Beschreiben Sie sie in den `securityRules` ihrer Collection, um sie zu behalten (die RLS-Ansicht von Studio importiert sie), oder löschen Sie sie von Hand, wenn sie veraltet ist. Unter 0.24 sind beide „von einem früheren Push zurückgelassen“.
:::

:::caution
`db push` modifiziert die Datenbank direkt. Verwenden Sie es nur in der Entwicklung. Für die Produktion verwenden Sie `db generate` + `db migrate`, um überprüfbare Migrationsdateien zu erstellen.
:::

### `rebase db generate`

Generieren Sie SQL-Migrationsdateien aus Schemaänderungen:

```bash
rebase db generate
```

**Was er tut:**
- Vergleicht das Drizzle-Schema mit dem Zustand, den die Migrationen in `drizzle/migrations/` aufbauen, nicht mit Ihrer Datenbank
- Erzeugt zeitgestempelte SQL-Migrationsdateien in `drizzle/migrations/`
- Dateien können überprüft, bearbeitet und in die Versionskontrolle committet werden
- <span class="since-badge" data-since="0.25">Seit 0.25</span> Nennt jede Anweisung der neuen Migration, die Daten zerstört, mit derselben Prüfung, die `db push` vor dem Anwenden ausführt: eine gelöschte Tabelle, Spalte, Schema, View oder ein gelöschter Typ, ein `TRUNCATE`, eine Änderung des Spaltentyps, die Werte verlieren kann, eine Änderung des Primärschlüssels oder das Löschen eines CHECK- oder EXCLUDE-Constraints, den die Datenbank enthält. Er schreibt die Datei trotzdem und endet mit Exit-Code 0, warnt also und verweigert nicht.
- <span class="since-badge" data-since="0.25">Seit 0.25</span> Endet mit dem,
  was als Nächstes zu tun ist: `rebase db migrate`, und für die erste Migration eines Projekts
  stattdessen das `--baseline <version>`, das eine Datenbank braucht, die der Boot bereits
  eingerichtet hat. Eine spätere Migration erhält keine Baseline-Zeile, da eine destruktive mit
  Baseline ihr `DROP` überspringen würde, und ein Lauf, der keine Migration schreibt, sagt nur das.

**Ein CHECK, den eine Ihrer Migrationen hinzugefügt hat, löscht die nächste.** `db generate`
vergleicht Ihre Migrationsdateien, nicht die Datenbank, und Atlas kann kein Objekt aus diesem
Vergleich ausnehmen. Ein CHECK- oder EXCLUDE-Constraint, den Sie von Hand in eine Migration
geschrieben haben und den keine Collection deklarieren kann, kommt deshalb in der nächsten
Migration, die er schreibt, als `ALTER TABLE … DROP CONSTRAINT …` zurück, in dasselbe Statement
eingefaltet wie die eigentliche Änderung. Der Bericht oben nennt dieses Löschen, wenn die
Datenbank den Constraint bereits enthält; aus der Datei nimmt er es nicht heraus. Löschen Sie die
Klausel vor `rebase db migrate`, oder lassen Sie `rebase db migrate --refuse-destructive` daran
anhalten. `db push` liest die Datenbank und behält den Constraint.

Die generierten Migrationen sind einfache SQL-Dateien — Sie können sie vor dem Anwenden inspizieren und ändern.

### `rebase db migrate`

Führen Sie alle ausstehenden Migrationen aus:

```bash
rebase db migrate
```

**Was er tut:**
- Liest `drizzle/migrations/` nach nicht angewendeten Migrationen
- Wendet sie der Reihe nach auf die Datenbank an
- Verfolgt, welche Migrationen angewendet wurden

<span class="since-badge" data-since="0.25">Seit 0.25</span> `--refuse-destructive`
lässt ihn stattdessen verweigern. Er führt zuerst einen Probelauf der ausstehenden Migrationen aus. Zerstört
eine Anweisung Daten, nach derselben Prüfung, die `db push` und `db generate` verwenden, listet er diese
Anweisungen auf und endet mit Exit-Code 1. Er wendet nichts an, auch nicht die Dateien
vor dieser Anweisung. Ohne das Flag verhält sich `db migrate` wie bisher und
wendet jede ausstehende Datei an:

```bash
rebase db migrate --refuse-destructive
```

Eine Migration, die eine Suchspalte neu aufbaut, löscht sie zuerst, daher verweigert dieses Flag
auch diese Migration. Lesen Sie die ausgegebene Liste und führen Sie dann `rebase db migrate`
ohne das Flag aus, um sie anzuwenden.

#### Baseline für eine Datenbank, gegen die Rebase bereits gebootet hat

Jeder Rebase-Start stellt das Schema sicher, und `rebase db push` wendet es direkt an. Eine Datenbank, gegen die je eines von beiden gelaufen ist, hat die Tabellen und Typen also bereits, die die erste Migration anlegen würde — und `rebase db migrate` bricht mit `pq: type "posts_status" already exists (42710)` ab.

An der Migration ist nichts falsch: Die Datenbank wurde auf einem anderen Weg bereitgestellt. Halten Sie fest, wo sie bereits steht, und migrieren Sie dann normal:

```bash
rebase db migrate --baseline 20260906101530
rebase db migrate
```

Die Version ist das Zahlenpräfix der Migrationsdatei, die den *aktuellen* Stand der Datenbank beschreibt. Diese Migration und alle davor gelten als angewendet; alles danach läuft. Gegen eine Datenbank, gegen die nie gebootet wurde, braucht es keine Baseline — migrieren Sie einfach direkt.

Dasselbe geschieht später im gewöhnlichen Ablauf: Bearbeiten Sie eine Collection, während `rebase dev` läuft, und der Boot fügt die Spalte hinzu, bevor `rebase db generate` die Migration schreibt, die sie hinzufügt, sodass `rebase db migrate` bei `column … already exists (42701)` anhält. Setzen Sie für diese Migration auf dieselbe Weise eine Baseline. <span class="since-badge" data-since="0.25">Seit 0.25</span> `--baseline` funktioniert auf einer Datenbank, die bereits Migrationen verzeichnet: Es markiert alles bis zur Version mit `atlas migrate set` als angewendet und sagt das, oder sagt, dass nichts zu verzeichnen ist, wenn die Historie sie bereits erreicht. Unter 0.24 ignoriert Atlas `--baseline`, sobald irgendeine Migration verzeichnet ist, sodass derselbe Fehler wiederkehrt. <span class="since-badge" data-since="0.25">Seit 0.25</span> Eine Version, die keine Datei in `drizzle/migrations` hat, wird verweigert, bevor irgendetwas läuft, und die vorhandenen Versionen werden genannt.

### `rebase db branch`

Datenbank-Branching für parallele Entwicklung:

```bash
rebase db branch create feature_auth
rebase db branch switch feature_auth
rebase db branch list
rebase db branch switch --off

rebase db branch info feature_auth
rebase db branch delete feature_auth
```

`rebase db branch switch` (und `switch --off`) und `rebase db branch prune` sind neu.
`create`, `list`, `info` und `delete` wurden mit 0.17 ausgeliefert.

Jeder Branch ist eine vollständige Kopie der Datenbank, erstellt mit
`CREATE DATABASE ... TEMPLATE`, braucht also einen echten PostgreSQL-Server und kostet
denselben Plattenplatz wie seine Quelle.

### `rebase doctor`

Erkennen Sie Drei-Wege-Drift zwischen Ihren Collection-Definitionen, dem generierten Drizzle-Schema und der laufenden PostgreSQL-Datenbank:

```bash
rebase doctor
```

**Was er prüft:**
- Collections ↔ Generiertes Schema — sind sie synchron?
- Generiertes Schema ↔ Datenbank — gibt es nicht angewendete Änderungen?
- Collections ↔ Datenbank — gibt es unerwarteten Drift?

Führen Sie `doctor` aus, wann immer sich etwas nicht synchron anfühlt. Es zeigt genau, wo die Diskrepanz liegt.

Der Datenbankvergleich braucht `DATABASE_URL` (oder `ADMIN_CONNECTION_STRING`). Ohne eine wird diese Phase als **übersprungen** gemeldet statt als bestanden, und der Lauf schließt nie mit „All schemas are in sync“ ab — eine Prüfung, die nicht stattgefunden hat, ist kein Gesundheitszeugnis.

<span class="since-badge" data-since="0.25">Seit 0.25</span> Es nennt außerdem jede Collection ohne [`search`-Block](/docs/backend/search), deren Tabelle mehr als etwa 10.000 Zeilen enthält. Eine Suche dort — das Suchfeld des Admins, `.search()`, `?searchString=` — ist `ILIKE '%term%'` über die Textspalten, was kein Index bedienen kann, sodass jede die ganze Tabelle liest und ihr Count sie erneut liest (etwa eine Drittelsekunde bei 100.000 Zeilen, mit der Tabelle wachsend). Die Zeilenzahl ist die eigene Schätzung von Postgres, die Prüfung scannt also nichts. Es ist ein Hinweis: Der Exit-Code ändert sich nicht, und nichts wird für Sie indiziert.

<span class="since-badge" data-since="0.25">Seit 0.25</span> Es nennt eine **verwaiste Junction**: eine `public`-Tabelle in der Form einer Many-to-many-Junction, die keine Collection deklariert. Die Form sind zwei Spalten, die zusammen den Primärschlüssel bilden und jeweils ein Fremdschlüssel auf die Tabelle einer Collection sind. Das Umbenennen oder Entfernen einer `manyToMany` lässt ihre alte Junction zurück, weil Push und Start nur Tabellen anlegen, und jede Verknüpfungszeile steckt weiterhin darin. Der Hinweis ist nur eine Information und ändert den Exit-Code nicht. Seine Abhilfe ist die `DROP TABLE`-Anweisung, die `doctor` anzeigt und nie ausführt.

### `rebase generate-sdk`

Generieren Sie ein typisiertes SDK aus Ihren Collection-Definitionen:

```bash
rebase generate-sdk
```

**Was er tut:**
- Liest jede Collection-Datei in `config/collections/` — die Dateien, die das Backend ausliefert, unabhängig davon, ob der `index.ts`-Barrel sie auflistet — und bricht bei einer Datei ab, die nicht geladen werden kann
- Generiert TypeScript-Typen für alle Entitäten in `generated/sdk/`
- Erzeugt eine `database.types.ts`-Datei zur Verwendung mit `createRebaseClient<Database>()`

`rebase dev` führt dies beim Start und bei jedem Speichern unter
`config/collections/` für Sie aus. Selbst ausführen müssen Sie es in CI, in einem
Repository ohne Collections (siehe `--from` unten) oder überall dort, wo
`rebase dev` nicht läuft.

Auf 0.23 liest der Befehl nur die Dateien, die der `index.ts`-Barrel auflistet,
überspringt eine nicht ladbare mit einer Warnung und verwendet das Verzeichnis
als `--collections-dir`; und `rebase dev` generiert dabei nur das Schema neu, sodass
die SDK-Typen von Ihnen neu zu generieren sind.

**Optionen:**

| Flag | Beschreibung |
|------|-------------|
| `-c`, `--collections` | Collections-Verzeichnis (Standard: `config/collections/`); relative Pfade werden ausgehend vom Verzeichnis aufgelöst, in dem Sie den Befehl ausführen. `--collections-dir` wird ebenfalls akzeptiert. |
| `-o`, `--output` | Ausgabeverzeichnis für das SDK (Standard: `generated/sdk/`) |
| `--from <link\|url>` | Liest das Schema von einem laufenden Projekt statt aus lokalem Quellcode. `link` verwendet das verknüpfte Projekt dieses Checkouts. |
| `--token` | Bearer-Token für den Contract-Endpunkt (Standard: `$REBASE_SERVICE_KEY` aus der Shell; `.env` wird nicht gelesen) |

Mit `--from` kann ein Repository ohne eigene Collections — ein separates Frontend, eine zweite Web-App, eine Mobile-App — einen typisierten Client für das Projekt generieren, mit dem es spricht. `REBASE_SERVICE_KEY` wird nur an das Projekt gesendet, mit dem dieses Checkout verknüpft ist; für jeden anderen Host ist `--token` explizit anzugeben. Der Schlüssel in `.env`
gehört zu Ihrem lokalen Backend und wird nie gesendet.
<span class="since-badge" data-since="0.25">Seit 0.25</span> Eine Ablehnung sagt, welcher
dieser Fälle eingetreten ist: ein abgelehntes `--token`, ein abgelehnter Shell-Schlüssel, ein
Schlüssel, der einem nicht verknüpften Host vorenthalten wurde, ein Schlüssel nur in `.env`
oder gar kein Schlüssel. Unter 0.24 heißt es immer, `--token` zu übergeben oder `REBASE_SERVICE_KEY` zu setzen.

**Verwendung nach der Generierung:**

```typescript
import { createRebaseClient } from "@rebasepro/client";
import { collectionsDictionary, type Database } from "./generated/sdk/database.types";

const client = createRebaseClient<Database>({
    baseUrl: import.meta.env.VITE_API_URL,
    collections: collectionsDictionary,
});

// Full type safety and autocomplete
const { data } = await client.data.products.find();
```

Feldnamen in den generierten Typen sind die, die die API liefert. Der Wire-Name eines Feldes ist sein Property-Schlüssel, und die API ist durchgehend camelCase: Die Introspektion generiert eine Spalte `created_at` als Property `createdAt` mit `columnName: "created_at"` und liefert sie als `row.createdAt`. Die Spalte selbst bleibt unberührt. Der Collection-*Accessor* wird auf dieselbe Weise in einen Property-Namen umgewandelt (`my-notes` → `client.data.myNotes`); genau diese Zuordnung stellt `collectionsDictionary` auf den Slug zurück.

## Entwicklungs-Workflow

Der Workflow für schnelle Iteration in der Entwicklung:

```bash
# 1. Edit your collection in config/collections/
# 2. Generate the Drizzle schema
rebase schema generate

# 3. Push directly to dev database
rebase db push
```

## Produktions-Workflow

Der sichere, überprüfbare Workflow für die Produktion:

```bash
# 1. Edit your collection in config/collections/
# 2. Generate the Drizzle schema
rebase schema generate

# 3. Generate SQL migration files
rebase db generate

# 4. Review the generated SQL in drizzle/migrations/
# 5. Commit the migration to version control
git add drizzle/migrations/

# 6. Apply in production
#    A database Rebase has already booted needs a baseline the first time —
#    see "Baselining a database Rebase has already booted" above.
rebase db migrate
```

## Fehlerbehebung

| Symptom | Lösung |
|---------|----------|
| `Could not detect an active database plugin` | Installieren Sie `@rebasepro/server-postgres` in `backend/package.json` |
| Schemadatei wird nicht aktualisiert | Prüfen Sie, ob der `--collections`-Pfad auf das richtige Verzeichnis zeigt |
| Migration zeigt unerwartete Änderungen | Führen Sie `rebase doctor` aus, um den Drift zu identifizieren |
| `db push` schlägt in der Produktion fehl | Verwenden Sie stattdessen `db generate` + `db migrate` |
| Eine Migration darf in CI oder Produktion keine Daten löschen | <span class="since-badge" data-since="0.25">Seit 0.25</span> `rebase db migrate --refuse-destructive` endet mit Exit-Code 1 und wendet nichts an, wenn eine ausstehende Anweisung Daten zerstört |
| `db migrate` scheitert mit `already exists (42710)` | Start oder `db push` haben das Schema bereits bereitgestellt — halten Sie es mit `rebase db migrate --baseline <version>` fest |
| `db migrate` scheitert mit `column … already exists (42701)` | `rebase dev` hat die Spalte beim Start hinzugefügt — setzen Sie für diese Migration auf dieselbe Weise eine Baseline |
| `db push` auf der verwalteten Datenbank scheitert mit `Error: EOF` | Atlas hat eine Verbindung verloren, die das laufende `rebase dev` hält. Führen Sie es erneut aus; scheitert es weiter, stoppen Sie zuerst `rebase dev` |

## Nächste Schritte

- **[Collections](/docs/collections)** — Definieren Sie Ihr Datenmodell
- **[CLI-Referenz](/docs/cli)** — Alle CLI-Befehle
- **[Typisiertes SDK](/docs/sdk)** — Verwenden Sie das generierte SDK
