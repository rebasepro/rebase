---
sourceHash: 35b2f33f3e05ddce
slug: de/docs/compatibility
title: Kompatibilität
description: Was Rebase über Versionen hinweg verspricht und was nicht – die sechs versionierten Verträge, wie jeder einzelne fehlschlägt und was sich in einem Minor-Release noch ändern kann.
---

Was Rebase über Versionen hinweg verspricht und was nicht.

Dies ist das Dokument, das Sie lesen sollten, bevor Sie etwas ändern, von dem ein
bereitgestelltes Projekt oder ein laufender Rebase-Cloud-Tenant bereits abhängt. Es
ist auch die ehrliche Antwort auf die Frage: „Wenn ich heute auf Rebase aufbaue, was
bricht mir später unter den Füßen weg?“

## Was „Beta“ hier bedeutet

Rebase befindet sich in der Public Beta. Die meisten Projekte verwenden dieses Wort
im Sinne von „alles kann kaputtgehen“, was Lesenden nichts gibt, worauf sie planen
können. Hier ist also die Grenze, die dieses Projekt tatsächlich zieht:

> **Die API, gegen die Sie entwickeln, kann sich in einem Minor-Release mit einem
> Changelog-Eintrag ändern. Ihre Daten können nicht stillschweigend kaputtgehen.**

Die erste Hälfte ist gewöhnliches `0.x`-Verhalten und wird weiter unten beschrieben.
Die zweite Hälfte ist der Teil, den es zu prüfen lohnt, da es sich um eine Aussage
über Mechanismen und nicht über Absichten handelt: Die versionierten Verträge im
nächsten Abschnitt sind jeweils in einem Artefakt oder einer Datenbank festgeschrieben,
jeder wird beim Booten oder beim Intake überprüft, und jeder **schlägt laut und
spezifisch fehl**, anstatt schleichend zu degradieren. Ein Schema-Push, der eine
Spalte löschen würde, wird von einem Destructive Gate
(`packages/server-postgres/test/e2e/db-push-safety.test.ts`) abgelehnt, und der
Upgrade-Pfad selbst ist ein Test: `upgrade-e2e.test.ts` stellt Datenbanken so
wieder her, wie ältere Releases sie hinterlassen haben, führt den aktuellen
Migrationspfad über jede einzelne aus und stellt sicher, dass die Zeilen
überleben – nicht bloß der Boot-Vorgang.

Was Beta tatsächlich bedeutet: Features fehlen noch, manche Subsysteme sind neuer
als andere, und Ecken und Kanten äußern sich darin, dass etwas fehlt oder
umständlich ist – nicht darin, dass stillschweigend Daten beschädigt werden. Welche
Subsysteme welchen Status haben, wird veröffentlicht und datiert, statt dem Zufall
überlassen – die nachfolgende Tabelle ist diese Veröffentlichung.

## Reifegrad nach Subsystem

**Zuletzt überarbeitet am 14. September 2026, bezogen auf 0.21.0.** Lesen Sie dies
bei jedem Minor-Release erneut; eine Einstufung, die sich seit drei Releases nicht
geändert hat, ist entweder gefestigt oder vergessen – und dieser Hinweis steht hier,
damit der Unterschied überprüft wird.

Die drei Einstufungen bedeuten:

- **Stable** — die Form ist gefestigt und durch ein Gate in der CI abgesichert.
  Es können weiterhin Funktionen hinzukommen; es wird Ihnen innerhalb von 0.x
  nicht unangekündigt umgebaut, und jede Änderung, die Ihre Implementierung brechen
  würde, wird im Changelog angekündigt.
- **Beta** — es funktioniert und wird in der Produktion eingesetzt, aber bestimmte
  Aspekte gelten noch als unausgereift: ein Limit, an das man stoßen kann, ein
  unhandlicher Edge-Case, eine noch nicht getroffene Designentscheidung. Der
  unfertige Teil wird in den Anmerkungen benannt, da „Beta“ allein keine
  Grundlage für Planungen bietet.
- **Experimental** — veröffentlicht, damit es genutzt und Feedback dazu gegeben
  werden kann. Rechnen Sie damit, auf Stellen zu stoßen, die noch niemand betreten hat.

| Subsystem | Einstufung | Worauf die Einstufung basiert |
|---|---|---|
| REST-API + generiertes SDK | Stable | Der Wire-Contract ist versioniert und abgesichert (gated); `client-sdk-e2e` testet Registrierung → Anmeldung → RLS-gefilterte Lesezugriffe → Refresh → Storage → Realtime durchgängig |
| Auth — E-Mail/Passwort, OAuth, OIDC, Magic Link, Einmalcode | Stable | Zwölf OAuth-Provider werden mitgeliefert. Das Auth-Schema ist ein versionierter Vertrag, festgeschrieben und beim Booten geprüft |
| Auth — MFA (TOTP) | Beta | Registrierung, Verifizierung und Wiederherstellung funktionieren und sind getestet. Die Schlüsselrotation ist für den Verschlüsselungsschlüssel implementiert; es gibt keine Admin-Oberfläche, um den Faktor eines ausgesperrten Benutzers zurückzusetzen |
| Row-Level Security | Stable | Das Kernstück des Produkts. `pnpm rls:check` prüft eine Live-Datenbank anhand von 15 Kontrollen, und die RLS-E2E-Suite läuft bei jedem Push |
| Storage | Stable | Lokal, S3 und GCS. Default-Deny in der Produktion seit 0.17.0, und das Scaffold liefert einen Authorize-Hook mit |
| Realtime | **Beta** | Abonnements werden nur nach Collection-Pfad abgeglichen, sodass N Abonnenten einer Collection N RLS-gefilterte Refetches pro Schreibvorgang kosten. Das begrenzt ein Deployment auf einige hundert gleichzeitige Abonnenten. Korrekt in jedem Maßstab; teuer jenseits dieser Grenze |
| Vektorsuche (pgvector) | Beta | Jede Vektorspalte erhält standardmäßig einen HNSW-Index für Kosinus-Distanz, anpassbar pro Eigenschaft über `VectorIndexConfig` (Methode, Distanzen, Build-Parameter) oder deaktivierbar, was einen exakten Scan belässt. pgvector kann Spalten mit mehr als 2.000 Dimensionen nicht indizieren, daher bleiben diese unindiziert und werden gescannt |
| Offline-Synchronisierung | Beta | Mutationen enthalten Idempotenz-Schlüssel, die der Server berücksichtigt, und die beim Juli-Audit festgestellten Datenverlust-Fehler sind behoben. Das Konfliktmodell ist Last-Write-Wins ohne zellenweises Mergen |
| Entitätshistorie | Stable | Snapshot-basiert, abgesichert durch eine eigene Testsuite |
| Functions und Cronjobs | Stable | Der portable Einstiegspunkt (`@rebasepro/server/functions`) ist ein versionierter Vertrag mit eigenem API-Surface-Abschnitt |
| MCP-Server + Agent Skills | Beta | `@rebasepro/mcp` läuft über stdio: 53 Tools, Bearer-Authentifizierung pro Projekt, destruktive Tools verweigern nicht-lokale Ziele, sofern nicht explizit aktiviert. Seit 0.21 kann der Server auch einen Remote-Endpunkt `/mcp` einbinden – OAuth 2.1, 12 Daten-Tools, jeder Aufruf unter dem eigenen RLS der angemeldeten Person – standardmäßig deaktiviert, es sei denn, `REBASE_MCP_ENABLED=true`, und nur für Postgres |
| Studio (SQL, Schema, RLS, API-Explorer) | Beta | Täglich im Einsatz gegen echte Projekte. Branching ist im OSS-Paket vorhanden und in Rebase Cloud bewusst nicht exponiert, da es noch kein Konzept gibt, um ein laufendes Deployment auf einen Branch zu verschieben |
| CMS + Admin-Panel | Beta | Vollständig für CRUD, Relationen, Storage-Felder und Rollen. **Die Datentabelle besitzt keine Grid-Semantik** – keine `role`, kein `aria-rowindex`, `tabIndex` entfernt – daher können Tastatur- und Screenreader-Benutzer die Hauptansicht nicht bedienen. Keine Entwürfe, keine sprachspezifischen Inhalte, kein Block-Rich-Text |
| Verwaltete PGlite-Entwicklungsdatenbank | Beta | Zero-Setup-`rebase dev` ohne Docker. Jeweils nur eine Sitzung, daher werden Anfragen serialisiert und Nebenläufigkeit kann dagegen nicht reproduziert werden; Atlas-gestützte Befehle (`db push`, `generate`, `migrate`) planen gegen eine zweite, verworfene PGlite-Instanz, die für den Befehl gestartet wird (unter 0.24 verweigern sie die verwaltete Datenbank); `db branch` funktioniert dort nicht und meldet dies auch |
| Helm-Chart | Beta | Bildet die Split-Process-Topologie ab und wird bei jedem Release in der OCI-Registry veröffentlicht. Der Standard bleibt ein einzelner Container |
| `@rebasepro/server-mongo` | **Experimental** | Ein funktionierender Treiber mit Change-Stream-Realtime und Snapshot-Historie. **Keine Row-Level Security** – das gesamte obige Isolationsmodell gilt hierfür nicht – und keine Relationen. Change-Streams erfordern ein Replica Set: Auf einem eigenständigen `mongod` gibt es keinen Ersatz dafür, sodass ein Abonnement nur Schreibvorgänge sieht, die über diesen Rebase-Prozess ausgeführt wurden, und alle anderen verpasst. Keine MFA: Die Registrierung antwortet mit 501, und die Prüfungen melden „kein Faktor“, sodass beim Login nie danach gefragt wird. Das Admin-Aggregat kann keine Collection ansteuern – es liest den Namen aus einer `$from`-Stage, die MongoDB nicht hat –, sodass es nichts zurückgibt |
| `@rebasepro/firebase` | Experimental | Führt das Admin-Panel und das SDK gegen Firestore aus. Kein RLS, keine SQL-Oberfläche; der Postgres-Funktionsumfang wird nicht übertragen. Der Firestore-Treiber ignoriert `or(...)`/`and(...)`-Filtergruppen, sodass eine Abfrage, die eine solche verwendet, jede Zeile liest, die ihre einfachen Filter zulassen |
| Rebase Cloud | **Private Beta** | Live, betreibt echte Tenants, schrittweise freigeschaltet. Kein Self-Service |

Zwei Einträge oben sind der ehrliche Preis für die Veröffentlichung dieser Tabelle:
Der Realtime-Refetch und die Barrierefreiheit der Datentabelle sind offene Mängel,
keine Roadmap-Punkte, und beide werden aufgeführt, anstatt Lesende sie selbst
entdecken zu lassen.

Diese Tabelle zeigt, was existiert. Was es noch nicht gibt, steht auf der
[Roadmap](https://rebase.pro/roadmap), ein Eintrag pro GitHub-Issue, wobei die für
1.0 erforderliche Teilmenge gekennzeichnet ist.

## Das 0.x-Versprechen

Rebase befindet sich in der Version `0.x`. Dieser Abschnitt ist so verfasst, dass er
für jedes 0.x-Release gilt und nicht nur für eines, damit er nicht mit jedem Release
veraltet. **Breaking Changes an der erstellten TypeScript-API sind in Minor-Releases
weiterhin zulässig**, und das Changelog ist der Ort, an dem sie angekündigt werden.
Was *nicht* stillschweigend kaputtgehen darf, sind die folgenden versionierten
Verträge: Jeder einzelne ist in einem Artefakt oder einer Datenbank verankert, jeder
wird beim Booten oder beim Intake überprüft, und jeder schlägt **laut und
spezifisch** fehl, anstatt schleichend zu degradieren.

Diese Unterscheidung macht das gesamte Versprechen aus. Ein umbenannter Export kostet
Sie einen Compiler-Fehler und fünf Minuten. Ein Bundle, das gegen die falsche
Laufzeitumgebung bootet und subtil falsche Daten liefert, kostet Sie einen Incident –
und die Verträge existieren, damit die zweite Kategorie nicht unbemerkt eintreten kann.

Rebase Cloud konsumiert genau diese Verträge und nichts anderes. Alles, was hier nicht
aufgeführt ist, ist ein Implementierungsdetail, von dem die Plattform nicht abhängt.

### Versions-Badges und Canaries

Die Dokumentation wird aus `main` veröffentlicht, daher kann eine Seite etwas
beschreiben, das noch kein stabiles Release enthält. Ein *Since*-Badge nennt das
erste stabile Release, das es enthält, und der Text daneben beschreibt das Verhalten
des Releases davor.

Ein Canary ist ein Build von `main`, nummeriert nach dem Release, auf das er
zusteuert: `0.25.0-canary.g<commit>` ist `main` bei diesem Commit, nach 0.24.0 und
vor 0.25.0, und `rebase upgrade --to canary` installiert den neuesten. Er enthält
alles, was zum Zeitpunkt des Builds in `main` eingeflossen war, sodass ein Badge mit
seiner Version (Since 0.25) für Sie gilt und die Notiz über das vorherige Release
(unter 0.24) das stabile Release beschreibt, von dem Sie kamen. Canaries vor 0.25.0
wurden stattdessen nach dem letzten Release nummeriert: `0.24.1-canary.g<commit>` ist
ebenfalls eine 0.25-Vorschau.

## Die versionierten Verträge

Die nachfolgenden Werte werden aus dem Quellcode ausgelesen; betrachten Sie die
Dateiverweise als die Wahrheit und diese Tabelle als die Orientierungskarte.

```bash
grep -rn "BUNDLE_FORMAT_VERSION =\|RUNTIME_CONTRACT_VERSION =" packages/types/src/types/project_manifest.ts
grep -n "AUTH_SCHEMA_VERSION =" packages/server-postgres/src/auth/schema-version.ts
```

| # | Vertrag | Deklariert in | Geprüft in | Kompatibilitätsrichtung |
|---|---|---|---|---|
| 1 | `rebase`-Bereich in `rebase.json` | Projekt des Nutzers | CLI beim Build | Projekt gibt an, welche Runtimes es akzeptiert |
| 2 | `BUNDLE_FORMAT_VERSION` | `packages/types/src/types/project_manifest.ts` | `packages/server/src/boot/bundle.ts` | **abwärtskompatibel** — neue Runtime liest alte Bundles |
| 3 | `RUNTIME_CONTRACT_VERSION` | selbe Datei | selbe Datei | **exakte Übereinstimmung, beide Richtungen** |
| 4 | `AUTH_SCHEMA_VERSION` | `packages/server-postgres/src/auth/schema-version.ts` | beim Booten, gegen `rebase.schema_meta` | **nur vorwärtskompatibel** — neue Runtime migriert alte Datenbanken |
| 5 | `manifest.schemaVersion` | ausgegeben von `rebase build` | vom SDK als `x-rebase-schema` gesendet, falls konfiguriert | informativ — identifiziert, gegen welches Schema ein Client gebaut wurde |
| 6 | Abgeleitete Datenbankbezeichner | `contracts/derived-names.txt` | `pnpm check:derived-names` | **eingefroren** — ein von einem Release erzeugter Name wird niemals neu abgeleitet |

### 1 — `rebase` in `rebase.json`

Ein SemVer-Bereich, der wie `engines` in einer `package.json` gelesen wird: welche
Runtime-Versionen dieses Projekt akzeptiert. Bewusst `rebase` statt `runtime`
genannt, da `runtime` bei einer App bereits bedeutet, *wer den Prozess besitzt*
(`managed` | `custom`).

### 2 — `BUNDLE_FORMAT_VERSION` (aktuell 2)

Das On-Disk-Layout eines erstellten Bundles. Eine Runtime akzeptiert jedes Bundle,
dessen Format **kleiner oder gleich** dem eigenen ist. Dadurch kann die Managed-Ebene
einen Tenant auf ein neues Image verschieben, ohne dass das Projekt neu gebaut
werden muss.

- **1** — `mode: "cms" | "baas" | "static"`, `entry.static` ein einzelnes Verzeichnis,
  `entry.admin` für ein gebündeltes Admin-Panel.
- **2** — `kind: "backend" | "static"`, `entry.static` eine Liste, `entry.admin`
  entfernt. Format 1 wird weiterhin über `upgradeLegacyManifest` gelesen.

**Erhöhen, wenn** sich das Layout so ändert, dass eine ältere Runtime ein neueres
Bundle falsch interpretieren würde. Die Erhöhung macht aus „bootet und liefert
nichts aus“ eine Verweigerung des Starts.

### 3 — `RUNTIME_CONTRACT_VERSION` (aktuell 1)

Die Major-Version des Bundle↔Runtime-Vertrags. Zu unterscheiden von der
Paketversion von `@rebasepro/server`, die beliebig viele Minors und Patches
veröffentlichen kann, während diese unverändert bleibt.

**Vor Änderungen unbedingt lesen.** Die Prüfung lautet `!==`, nicht `>`:

> Ein Bundle, das auf Vertrag *N* abzielt, läuft **ausschließlich** auf einer
> Runtime, die *N* implementiert.

Eine Erhöhung macht daher **jedes jemals gebaute Bundle** auf einen Schlag
ungültig, bis jedes einzelne neu gebaut wurde. Das ist die beabsichtigte Härte –
es ist der Hebel „hier darf nichts Altes laufen“ –, aber das bedeutet auch, dass
eine Erhöhung eine flottenweite Migration ist und keine bloße Release-Notiz. Für
die Managed-Ebene muss sie mit einem Rebuild des Bundles jedes Tenants koordiniert
werden.

Wenn eine Änderung *additiv* ist und alte Bundles weiterhin korrekt wären, gehört
dies in `BUNDLE_FORMAT_VERSION` (oder überhaupt nirgendwohin), nicht hierher.

### 4 — `AUTH_SCHEMA_VERSION` (aktuell 2)

Wird in `rebase.schema_meta` gestempelt und beim Booten verglichen. Eine Runtime
**verweigert den Start** mit einer Datenbank, die von einer neueren Framework-Version
migriert wurde, anstatt mit einer Struktur zu arbeiten, die sie nicht versteht – bei
einem Rolling Deploy ist das der Unterschied dazwischen, ob die halbe Flotte Fehler
wirft oder die halbe Flotte Daten beschädigt.

Die Vorwärtsmigration erfolgt automatisch: `ensureAuthTablesExist` bringt eine
ältere Datenbank auf den neuesten Stand. Beachten Sie, dass dieser Migrationsblock
bewusst in `try/catch` gekapselt ist und loggt, anstatt eine Exception zu werfen –
ein holpriger Boot-Vorgang ist besser als ein Crash-Loop –, sodass **„es hat
gebootet“ nichts beweist**. Jede Assertion in der Upgrade-Suite liest stattdessen
den Katalog oder die Daten.

**Erhöhen, wenn** eine Migration von einer älteren Runtime keinesfalls übersprungen
werden darf. Nicht bei einer additiven, rückwärtskompatiblen Spalte erhöhen; ein
ausgearbeitetes Beispiel für diese Abwägung findet sich in
`packages/server-postgres/src/auth/ensure-tables.ts`.

### 5 — `manifest.schemaVersion`

Ein Hash der kompilierten Collection-Definitionen, der in das Bundle-Manifest
geschrieben und von einem generierten SDK im Header `x-rebase-schema`
(`SCHEMA_VERSION_HEADER`) mitgesendet wird. Er existiert, damit die Plattform
melden kann: „Diese App wurde gegen ein älteres Schema gebaut“, anstatt bei der
ersten Anfrage rätselhaft fehlzuschlagen.

`rebase generate-sdk` schreibt den Wert in `schema.meta.ts`; übergeben Sie ihn an
den Client, damit er gesendet wird:

```typescript
import { SCHEMA_VERSION } from "./generated/sdk/schema.meta";

const rebase = createRebaseClient<Database>({
    baseUrl: "http://localhost:3001",
    collections: collectionsDictionary,
    schemaVersion: SCHEMA_VERSION,
});
```

Das Backend liest diesen Header bei jeder Datenanfrage. Ein Schema-Drift verweigert
niemals einen Aufruf – ein SDK, das ein Schema hinterherhinkt, ist in der Regel noch
kompatibel, und das Ausliefern des Backends vor dem Frontend ist die normale
Bereitstellungsreihenfolge –, aber wenn eine Anfrage mit einem 400- oder 404-Fehler
fehlschlägt, enthält der Fehler den Drift als Ursache:

```json
{
  "error": {
    "code": "BAD_REQUEST",
    "message": "Unknown field \"authorName\" on collection \"posts\"",
    "cause": {
      "code": "SCHEMA_DRIFT",
      "clientSchema": "v1:0e1c…",
      "serverSchema": "v1:9ab4…",
      "message": "This client was generated against schema v1:0e1c…; this backend serves v1:9ab4…"
    }
  }
}
```

Eine umbenannte Spalte wird somit als „Ihr SDK ist veraltet, generieren Sie es neu“
gemeldet und nicht als ein Feld, von dem die eigenen Typen fälschlicherweise
behaupten, dass es existiert. Bei einer erfolgreichen Anfrage wird dies nie mitgeteilt.

Dies betrifft **ausschließlich Collections**. Die Bearbeitung eines Hooks oder einer
Function ändert den Vertrag des Clients nicht und darf nicht jedes generierte SDK
ungültig machen.

### Wer ruft an?

Zwei weitere identifizierende Signale, von denen keines für sich genommen etwas
blockiert:

- **`GET /api/meta/schema-version`** erfordert keine Authentifizierung und antwortet
  mit der `schemaVersion` des Projekts *und* seiner `runtime` (`version` und
  `contract`). Ein CI-Job, der sein generiertes SDK mit einem Live-Projekt
  abgleicht, benötigt keine Anmeldedaten – ebenso wenig wie ein Client, der anfragt,
  mit welcher Runtime er kommuniziert.
- **`User-Agent: rebase-cli/<version>`** wird bei jeder `rebase cloud`-Anfrage
  mitgesendet. Das Wire-Format der Control-Plane ist dem voraus, was auf npm
  veröffentlicht wird, daher muss sie einem alten Client mit `CLI_TOO_OLD` und der
  Mindestversion antworten können – was sie nur für einen Aufrufer tun kann, der
  sich zu erkennen gibt.

### 6 — Abgeleitete Datenbankbezeichner

Jeder Name, den dieses Framework selbst ermittelt, anstatt vorgegeben zu bekommen:
eine Fremdschlüsselspalte, ein Fremdschlüssel-Constraint, eine Junction-Tabelle und
ihre beiden Schlüsselspalten, ein Enum-Typ, ein Policy-Name, die `snake_case`-Spalte
einer `camelCase`-Eigenschaft.

> **Ein abgeleiteter Bezeichner ist in dem Moment eingefroren, in dem ein Release
> ihn erzeugt.**

Nicht „eingefroren bis zum nächsten Major“ – eingefroren. Die Begründung unterscheidet
sich von den anderen fünf Verträgen und wiegt schwerer. Jene sind versioniert, sodass
eine Diskrepanz *erkannt* und abgelehnt werden kann. Bei diesem ist das nicht möglich:
Der Name wird an dem Tag, an dem deployed wird, in die Datenbank eines Kunden
geschrieben, und auf einer Spalte gibt es keinen Versionsstempel. Jede Datenbank,
die von irgendeinem jemals veröffentlichten Release bereitgestellt wurde, behält die
Bezeichner, die damals abgeleitet wurden, und kein Code in diesem Repository kann
nachträglich eingreifen und sie alle umbenennen.

0.13 ist das Paradebeispiel dafür. `generateForeignKeyName` lernte die korrekte
Singularbildung – `categorie_id` → `category_id`, `addres_id` → `address_id` –, was
unbestreitbar die bessere Ableitung war, und es beschädigte jede bestehende
Datenbank mit einem unregelmäßigen Plural. Boot-Ensure migrierte die Spalte, sodass
die Daten überlebten; das im Projekt eingecheckte `schema.generated.ts` tat dies
jedoch nicht, und der Boot-Vorgang scheiterte an einer Spalte, die existierte. Drei
Commits, ein neuer Schnittstellentest (Seam Test) und ein dauerhafter Eintrag in den
Upgrade-Hinweisen – im Austausch für einen schöner aussehenden Spaltennamen, nach
dem niemand gefragt hatte.

**Wenn eine Ableitung nachweislich falsch ist**, ändert sie sich für Collections,
die *danach* erstellt werden, hinter einer im Projekt hinterlegten Naming-Strategy –
niemals rückwirkend und niemals als Nebeneffekt einer Optimierung der zugrunde
liegenden Funktion.

**Die einzige legitime Ausnahme** ist eine Änderung, die den Code mit einem Namen
in Einklang bringt, den die Datenbank *bereits hat*. Das praktische Beispiel dafür
ist das Abschneiden von Bezeichnern (Identifier Truncation): Postgres kürzt
Bezeichner stillschweigend auf 63 Bytes, sodass ein längerer abgeleiteter
Constraint-Name im Katalog nie existierte – die Ableitung beschrieb ein Objekt, das
unter dieser Schreibweise gar nicht vorhanden war, und Boot-Ensure führte bei jedem
einzelnen Boot-Vorgang erneut `ADD CONSTRAINT` aus, weil der Vergleich niemals
übereinstimmen konnte. Ein Abschneiden bei der Erzeugung ändert, was dieses Repo
*ableitet*, ändert aber rein gar nichts daran, was eine bereitgestellte Datenbank
*enthält*. Das ist der Maßstab: Nicht „ist der neue Name besser?“, sondern „muss sich
an irgendeiner bestehenden Datenbank etwas ändern?“.

Der andere Fall, in dem sich ein Name ändern darf, betrifft eine Gruppe von Namen,
die unmöglich alle gleichzeitig existieren konnten. Eine Regel, die sich über
mehrere Operationen auf einer Tabelle von 42 Bytes oder mehr erstreckte, leitete
`<table>_default_admin_write_insert`, `_update` und `_delete` ab, und alle drei
wurden auf dieselben 63 Bytes gekürzt. Postgres speicherte genau eine Policy,
DELETE, und verweigerte jedes Admin-INSERT und -UPDATE. Nur wenn die Namen einer
Regel auf diese Weise kollidieren, werden sie Suffix-orientiert als
`<head>_<hash8>_<op>` abgeleitet. Jeder Name, der heute funktioniert, behält seine
Schreibweise. Beim nächsten Booten oder Push wird die eine abgeschnittene Policy
verworfen und eine Policy für jede Operation erstellt.

Die einzige Sache, die immer sicher ist, besteht darin, einen alten Namen zu
*erkennen*, um ihn zu migrieren: `legacyForeignKeyName` existiert, um erkannt zu
werden, niemals um generiert zu werden, und die Baseline fixiert auch diese
Erkennungen. Das Entfernen einer solchen Erkennung macht stillschweigend die
Migration jeder Datenbank rückgängig, die diese Schreibweise noch verwendet.

**Das Gate.** `tooling/scripts/derived-names.mts` jagt eine Naming-Stresstest-Fixture –
unregelmäßige Plurale, eine `ss`-Endung, ein Akronym, eine Junction über einen
Plural-Slug, explizite Overrides, einen Slug, der lang genug ist, um gekürzt zu
werden – durch beide Generatoren von Schema-DDL und gibt jeden Bezeichner aus, den
einer von beiden vergibt:

```bash
pnpm check:derived-names
```

Eine geänderte oder entfernte Zeile schlägt als Vertragsbruch fehl, wobei die alte
und die neue Schreibweise nebeneinander aufgeführt werden. Eine rein additive
Änderung schlägt ebenfalls fehl, allerdings mit dem Hinweis „regenerate“ – so kann
die Baseline für niemanden unbemerkt driften.

Es stellt außerdem sicher, dass `rebase db push` und das Boot-Ensure der verwalteten
Runtime dieselben Namen ableiten, was ein zweiter Vertrag ist, der im ersten verborgen
liegt: Sie kompilieren dieselben Collections über unterschiedlichen Code, und ein
Projekt, das einmal per Push übertragen und später gebootet wird, darf nicht mit zwei
verschiedenen Schemas enden.

## Was *nicht* eingefroren ist

Klar und deutlich formuliert, damit niemand ein Versprechen hineininterpretiert,
das nie gegeben wurde:

- Die verfasste TypeScript-API – Collection-Konfiguration, Optionen für
  `initializeRebaseBackend`, Admin-Props, SDK-Methodennamen. Breaking Changes
  erscheinen in Minor-Releases und werden im Changelog angekündigt.
- `@rebasepro/studio`, `@rebasepro/mcp`, `@rebasepro/inference`,
  `@rebasepro/plugin-*` – diese entwickeln sich am schnellsten und haben die
  wenigsten Nutzer.
- Alles unterhalb des `src/`-Verzeichnisses eines Pakets, das nicht aus dessen
  Barrel re-exportiert wird. `packages/client/src/index.ts` enthält einen Hinweis,
  der erklärt, dass die Exportliste eigens kuratiert wird, damit ein interner Export
  nicht versehentlich öffentlich wird.
- Das Datenbankschema *Ihrer* Collections. Das liegt in Ihrer Verantwortung; Rebase
  besitzt lediglich das `rebase`-Schema (und bei einer vor 0.13 bereitgestellten
  Datenbank das alte `auth`-Schema, bis der Boot-Vorgang es ablöst).

## Die Gates, die diese Vorgaben absichern

Nichts davon ist bloße Konvention – hinter jedem Punkt steht ein Test, der
fehlschlägt, wenn er verletzt wird:

| Gate | Was abgesichert wird |
|---|---|
| `pnpm verify:corpus` | jede jemals ausgelieferte Bundle-Form, gebootet auf der heutigen Runtime. Fixtures in `tests/fixtures/bundles/` sind **von Hand erstellt und eingefroren** — eine Fixture, die der Builder neu generiert, ändert sich jedes Mal, wenn sich der Builder ändert |
| `pnpm verify:selfhost` | ein echtes Bundle, gebaut, gefaltet, gebootet und so abgerufen, wie ein Browser es tun würde |
| `upgrade-e2e.test.ts` | alte Datenbankschemas (`schema-snapshots/`), auf die die aktuelle Runtime trifft |
| `tests/e2e/tests/cli-init-e2e.ts` | ein generiertes Projekt, installiert aus **echten Tarballs**, nicht aus Workspace-Links |
| `tests/e2e/tests/client-sdk-e2e.ts` | der Endnutzer-Pfad: Registrieren → Anmelden → RLS-gefilterte Lesezugriffe → Refresh → Storage → Realtime |
| `pnpm check:derived-names` | jeder Spalten-, Constraint-, Junction-, Enum- und Policy-Name, den das Framework ableitet — und dass Boot und `db push` diese identisch ableiten |
| `pnpm rls:check` | die Policies des generierten Schemas |
| `pnpm check:api-surface` | jeder Export und dessen Member der fünf vom Image bereitgestellten Pakete — `@rebasepro/server`, `types`, `client`, `common`, `utils` — sowie der Einstiegspunkt `@rebasepro/server/functions`, abgeglichen mit den sechs Abschnitten von `contracts/server.api.txt`. Dies sind die Pakete, die `infra/docker/entrypoint.mjs` per Symlink über die eigenen Kopien eines bereitgestellten Bundles legt; das Entfernen eines Exports aus einem dieser Pakete ist daher für niemanden ein Compile-Fehler — es ist ein flottenweiter Boot-Fehler während eines Rollouts, den niemand angefordert hat |
| `pnpm test:gates` | die eigenen Tests der Gates anhand von Fixtures — 47 Dateien, darunter `check:api-surface` und die unten stehende Release-Bump-Prüfung —, sodass ein Gate, das nicht mehr erkennt, was es schützen soll, hier fehlschlägt. `check:api-surface` konnte während seiner gesamten Lebensdauer nicht erkennen, wenn ein Member aus `const rebase` verschwand |
| `node tooling/scripts/check-release-bump.mjs` | dass die Bump-Stufe, unter der ein Release ausgeliefert wird, dem entspricht, was das Release an den obigen Baselines geändert hat — ausgeführt von `publish.yml`, bevor das Changelog gestempelt wird |
| saas CI | die Control-Plane, gebaut gegen das `main` dieses Repos, bei eigenen Pushes und nächtlich |

**Zeichnen Sie einmal pro Release eine Bundle-Fixture und einen Schema-Snapshot auf.**
Der Wert beider Corpora liegt ausschließlich darin, wie weit die älteste zurückreicht,
und keines von beiden kann nachträglich aufgefüllt werden.

### Noch nicht abgesichert

Die obige Tabelle zeigt, was abgesichert ist. Dies sind die Teile der Richtlinie,
die noch durch nichts abgesichert sind – aufgeführt, damit niemand ein falsches
Versprechen hineinliest:

- **Kein Deprecation- oder Support-Zeitfenster.** Solange Rebase `0.x` ist, gibt es
  keine schriftliche Regelung darüber, wie lange ein als veraltet (deprecated)
  markierter Export vor seiner Entfernung überlebt oder wie lange ein älteres
  Minor-Release Fixes erhält. Sicherheitsfixes landen ausschließlich auf dem
  neuesten Minor-Release.
- **Das HTTP-Wire-Format besitzt kein Gate.** Kein `check:*`-Skript vergleicht
  Request- und Response-Formate mit einer Baseline, so wie `check:api-surface`
  Exporte vergleicht; ein geändertes Response-Format wird nur von einer E2E-Suite
  abgefangen, die es zufällig liest.
- **CLI-Flags besitzen keine Kompatibilitäts-Baseline.** Der Docs-Verifier schlägt
  fehl, wenn ein Flag verschwindet, das von den Skills, den Beispielen oder der
  Marketing-Website verwendet wird; ansonsten bemerkt niemand das Verschwinden eines
  Flags oder die Änderung seiner Bedeutung.
- **Ein CI-Release zeichnet keines der beiden Corpora auf.** Der Publish-Workflow
  zeichnet weder eine Bundle-Fixture noch einen Schema-Snapshot auf; nur das lokale
  Release-Skript versucht dies und warnt, statt abzubrechen, wenn es fehlschlägt.
  Für 0.18 bis 0.21 existiert kein aufgezeichneter Projekt-Snapshot.
- **Die Export-Surface ist ein Gate, kein Vertrag.** Ob die öffentlichen Exporte
  der von der Runtime bereitgestellten Pakete zu einem siebten nummerierten
  Vertrag werden – deklariert als die `check:api-surface`-Baseline, additiv
  kompatibel innerhalb einer Major-Vertragsversion –, ist eine offene Entscheidung.

## Einen Vertrag ändern

1. Entscheiden Sie, um welchen der sechs Verträge es sich handelt. Die meisten
   Änderungen betreffen keinen von ihnen – aber „keiner der sechs“ bedeutet nicht
   „unkritisch“. Das Entfernen oder Umbenennen eines Exports von `@rebasepro/server`
   oder eines Members davon betrifft keinen der sechs und ist die mit Abstand
   gefährlichste Änderung im Repository, da der Code, den sie bricht, bereits
   gebaut ist und nicht neu kompiliert wird. `pnpm check:api-surface` sichert
   diese Grenze ab; ob daraus ein siebter nummerierter Vertrag wird, ist eine
   offene Entscheidung (siehe *Noch nicht abgesichert* oben).
2. Fügen Sie zuerst eine Fixture oder einen Snapshot für die **alte** Struktur
   hinzu und prüfen Sie, ob der Test besteht.
3. Nehmen Sie die Änderung vor und erhöhen Sie die Konstante.
4. Bestätigen Sie, dass die alte Fixture weiterhin besteht oder dass sie jetzt
   *mit der Fehlermeldung fehlschlägt, die ein Benutzer benötigen würde*. Beides
   sind gültige Ergebnisse; lautloses Scheitern ist es nicht.
5. Planen Sie für Vertrag 3 den Rebuild jedes bereitgestellten Bundles vor dem Mergen.
6. Vertrag 6 bildet die Ausnahme zu den Schritten 3 und 4: Es gibt keine Konstante
   zum Erhöhen und keine Version, anhand derer verweigert werden könnte, da eine
   Spalte keinen Versionsstempel trägt. Der Schritt, der diese ersetzt, ist die
   Entscheidung, die Änderung gar nicht erst vorzunehmen – siehe den obigen
   Abschnitt dazu, wie die Alternative aussieht.

## Verwandte Themen

- [Upgrading](/docs/upgrading/) — was sich tatsächlich geändert hat und gebrochen ist, Release für Release
- [Changelog](/docs/changelog/) — jede Änderung, einschließlich derer, die nichts beschädigt haben
- [Runtime & Bundles](/docs/architecture/runtime-and-bundles/) — Vertrag 3 — das Bundle-Format, gegen das ein bereitgestelltes Projekt bereits gebaut ist
