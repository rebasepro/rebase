---
sourceHash: fb9fac4af8dcfaaf
slug: de/docs/compatibility
title: Kompatibilität
description: Was Rebase über Versionen hinweg verspricht und was nicht – die sechs versionierten Verträge, wie jeder einzelne fehlschlägt und was sich in einer Minor-Version noch ändern kann.
---

Was Rebase über Versionen hinweg verspricht und was nicht.

Dies ist das Dokument, das Sie lesen sollten, bevor Sie etwas ändern, von dem ein
bereitgestelltes Projekt oder ein laufender Rebase Cloud-Tenant bereits abhängt.
Es ist auch die ehrliche Antwort auf die Frage: „Wenn ich heute auf Rebase aufbaue,
was bricht mir später weg?“

## Was „Beta“ hier bedeutet

Rebase befindet sich in der öffentlichen Beta-Phase. Die meisten Projekte verwenden
dieses Wort im Sinne von „alles kann kaputtgehen“, was Lesern keinerlei Planungssicherheit
gibt. Hier ist die Grenze, die dieses Projekt tatsächlich zieht:

> **Die API, gegen die Sie entwickeln, kann sich in einer Minor-Version mit einem Changelog-Eintrag ändern.
> Ihre Daten können nicht unbemerkt kaputtgehen.**

Die erste Hälfte ist gewöhnliches `0.x`-Verhalten und wird unten beschrieben. Die
zweite Hälfte ist der Teil, den es zu prüfen lohnt, da es sich um eine Behauptung über
Mechanismen und nicht über Absichten handelt: Die versionierten Verträge im nächsten
Abschnitt sind jeweils in einem Artefakt oder einer Datenbank hinterlegt, jeder wird
beim Booten oder beim Empfang geprüft, und jeder **schlägt laut und spezifisch fehl**,
anstatt stillschweigend zu degradieren. Ein Schema-Push, der eine Spalte löschen würde,
wird durch ein Destructive-Gate verweigert
(`packages/server-postgres/test/e2e/db-push-safety.test.ts`), und der Upgrade-Pfad
selbst ist ein Test: `upgrade-e2e.test.ts` stellt Datenbanken so wieder her, wie
ältere Releases sie hinterlassen haben, führt den aktuellen Migrationspfad über jede
einzelne aus und stellt sicher, dass die Zeilen überleben – nicht nur, dass der
Bootvorgang erfolgreich war.

Was Beta tatsächlich bedeutet: Features fehlen noch, manche Subsysteme sind neuer
als andere, und Ecken und Kanten äußern sich darin, dass etwas fehlt oder umständlich
ist – nicht darin, dass stillschweigend Daten beschädigt werden. Welche Subsysteme
welchen Status haben, wird veröffentlicht und datiert, anstatt es dem Zufall zu
überlassen – die folgende Tabelle ist diese Veröffentlichung.

## Reifegrad nach Subsystem

<span class="since-badge" data-since="0.31">Seit 0.31</span>

**Zuletzt überarbeitet am 14. September 2026, bezogen auf 0.21.0.** Lesen Sie dies
bei jeder Minor-Version erneut; eine Einstufung, die sich über drei Releases hinweg
nicht geändert hat, ist entweder stabilisiert oder vergessen, und dieser Hinweis
dient dazu, dass der Unterschied geprüft wird.

Die drei Einstufungen bedeuten:

- **Stabil** — die Struktur ist gefestigt und durch ein Gate in der CI abgesichert.
  Es können weiterhin Features hinzukommen; sie wird innerhalb von 0.x nicht
  umfassend überarbeitet, und eine Änderung, die Sie beeinträchtigen würde, wird im
  Changelog angekündigt.
- **Beta** — es funktioniert und wird in der Produktion eingesetzt, und es ist
  bekannt, dass es noch Ecken und Kanten gibt: ein Limit, an das man stoßen kann,
  eine unpraktische Handhabung, eine noch nicht getroffene Designentscheidung. Der
  unfertige Teil wird in den Hinweisen benannt, da „Beta“ allein keine
  Planungssicherheit bietet.
- **Experimentell** — ausgeliefert, damit es genutzt und Feedback gegeben werden
  kann. Stellen Sie sich darauf ein, auf Bereiche zu stoßen, die bisher kaum jemand
  genutzt hat.

| Subsystem | Einstufung | Worauf die Einstufung beruht |
|---|---|---|
| REST-API + generiertes SDK | Stabil | Der Wire-Vertrag ist versioniert und über Gates abgesichert; `client-sdk-e2e` steuert Registrierung → Anmeldung → RLS-bezogene Lesevorgänge → Refresh → Storage → Realtime durchgängig (End-to-End). |
| Auth — E-Mail/Passwort, OAuth, OIDC, Magic-Link, Einmalcode | Stabil | Zwölf OAuth-Provider werden mitgeliefert. Das Auth-Schema ist ein versionierter Vertrag, gestempelt und beim Booten geprüft. |
| Auth — MFA (TOTP) | Beta | Registrierung, Verifizierung und Wiederherstellung funktionieren und sind getestet. Schlüsselrotation ist für den Verschlüsselungsschlüssel implementiert; es gibt keine Admin-Oberfläche zum Zurücksetzen des Faktors eines ausgesperrten Benutzers. |
| Row-Level Security | Stabil | Das Herzstück des Produkts. `pnpm rls:check` prüft eine Live-Datenbank anhand von 15 Prüfungen, und die RLS-E2E-Suite läuft bei jedem Push. |
| Storage | Stabil | Lokal, S3 und GCS. Default-Deny in der Produktion seit 0.17.0, und das Scaffold liefert einen Authorize-Hook mit. |
| Realtime | **Beta** | Abonnements werden nur nach Tabellenpfad abgeglichen, sodass N Abonnenten auf einer Tabelle N RLS-bezogene Refetches pro Schreibvorgang kosten. Das begrenzt ein Deployment auf wenige hundert gleichzeitige Abonnenten. Korrekt in jeder Größenordnung; darüber hinaus jedoch teuer. |
| Vektorsuche (pgvector) | Beta | Jede Vektorspalte erhält standardmäßig einen HNSW-Index für Kosinus-Distanz, anpassbar pro Spalte über `col.vector({ dimensions, index })` (Methode, Distanzen, Build-Parameter) oder deaktivierbar, was einen exakten Scan belässt. pgvector kann Spalten mit mehr als 2.000 Dimensionen nicht indizieren, weshalb diese unindiziert bleiben und gescannt werden. |
| Offline-Synchronisierung | Beta | Mutationen enthalten Idempotenz-Schlüssel, die der Server berücksichtigt, und die beim Juli-Audit festgestellten Datenverlust-Fehler sind behoben. Das Konfliktmodell ist Last-Write-Wins ohne feldweises Mergen. |
| Entitätsverlauf | Stabil | Snapshot-basiert, durch eine eigene Suite abgesichert. |
| Functions und Crons | Stabil | Der portable Einstiegspunkt (`@rebasepro/server/functions`) ist ein versionierter Vertrag mit einem eigenen API-Surface-Abschnitt. |
| MCP-Server + Agent-Skills | Beta | `@rebasepro/mcp` läuft über stdio: 53 Tools, Bearer-Auth pro Projekt, destruktive Tools verweigern nicht-lokale Ziele, sofern nicht explizit aktiviert. Seit 0.21 kann der Server auch einen Remote-Endpunkt `/mcp` bereitstellen – OAuth 2.1, 17 Daten-Tools (die vier für gespeicherte Apps sind experimentell), jeder Aufruf unter dem eigenen RLS der angemeldeten Person – standardmäßig deaktiviert, außer wenn `REBASE_MCP_ENABLED=true`, und nur für Postgres. |
| Studio (SQL, Schema, RLS, API-Explorer) | Beta | Wird täglich mit echten Projekten verwendet. Branching ist im OSS-Paket vorhanden und wird in Rebase Cloud bewusst nicht bereitgestellt, da das Verschieben eines laufenden Deployments auf einen Branch noch nicht gelöst ist. |
| CMS + Admin-Panel | Beta | Vollständig für CRUD, Relationen, Storage-Felder und Rollen. **Die Datentabelle besitzt keine Grid-Semantik** – kein `role`, kein `aria-rowindex`, `tabIndex` entfernt – Tastatur- und Screenreader-Nutzer können die Hauptansicht daher nicht bedienen. Keine Entwürfe, keine sprachspezifischen Inhalte, kein Block-Rich-Text. |
| Verwaltete PGlite-Entwicklungsdatenbank | Beta | `rebase dev` ohne Konfigurationsaufwand und ohne Docker. Immer nur eine Sitzung gleichzeitig, sodass Anfragen serialisiert werden und Nebenläufigkeit damit nicht reproduziert werden kann; auf Atlas basierende Befehle (`db push`, `generate`, `migrate`) planen gegen eine separate Wegwerf-PGlite-Instanz, die für den Befehl gestartet wird; `db branch` funktioniert dort nicht und meldet dies auch. |
| Helm-Chart | Beta | Rendert die Split-Process-Topologie und wird bei jedem Release in der OCI-Registry veröffentlicht. Der Standard bleibt ein einzelner Container. |
| `@rebasepro/firebase` | Experimentell | Firestore als Datenquelle, die das Admin-Panel direkt neben den Tabellen des Backends liest: `defineFirestoreCollection` in `frontend/src/cms`, übergeben als `externalCollections`. Kein RLS, keine SQL-Oberfläche; der Postgres-Funktionsumfang wird nicht übertragen. Der Firestore-Treiber ignoriert `or(...)`/`and(...)`-Filtergruppen, sodass eine Abfrage, die eine solche verwendet, jede Zeile liest, die ihre einfachen Filter zulassen. |
| Rebase Cloud | **Private Beta** | Live, betreibt echte Tenants, schrittweise freigeschaltet. Kein Self-Service. |

Zwei der obigen Einträge sind der ehrliche Preis für die Veröffentlichung dieser
Tabelle: Der Realtime-Refetch und die Barrierefreiheit der Datentabelle sind offene
Mängel, keine Roadmap-Punkte, und beide werden aufgeführt, anstatt sie den Lesern
zur Selbstentdeckung zu überlassen.

Diese Tabelle zeigt, was existiert. Was noch nicht existiert, steht auf der
[Roadmap](https://rebase.pro/roadmap), ein Eintrag pro GitHub-Issue, wobei die für
Version 1.0 erforderliche Teilmenge markiert ist.

## Das 0.x-Versprechen

Rebase befindet sich in Version `0.x`. Dieser Abschnitt ist so verfasst, dass er für
jedes 0.x-Release gilt und nicht nur für eines, damit er nicht mit jedem Release
veraltet. **Breaking Changes an der bereitgestellten TypeScript-API sind in einer
Minor-Version weiterhin zulässig**, und das Changelog ist der Ort, an dem sie
angekündigt werden. Was *nicht* unbemerkt kaputtgehen darf, ist die Reihe der
unten aufgeführten versionierten Verträge: Jeder einzelne ist in einem Artefakt oder
einer Datenbank hinterlegt, jeder wird beim Booten oder beim Empfang geprüft, und
jeder schlägt **laut und spezifisch** fehl, anstatt stillschweigend zu degradieren.

Dieser Unterschied ist das gesamte Versprechen. Ein umbenannter Export kostet Sie
einen Kompilierungsfehler und fünf Minuten. Ein Bundle, das gegen die falsche
Runtime startet und subtil falsche Daten ausliefert, kostet Sie einen Vorfall (Incident),
und die Verträge existieren, damit diese zweite Kategorie niemals unbemerkt eintreten
kann.

Rebase Cloud nutzt exakt diese Verträge und nichts anderes. Alles, was hier nicht
aufgeführt ist, ist ein Implementierungsdetail, von dem die Plattform nicht abhängt.

### Versions-Badges und Canaries

Die Dokumentation wird von `main` aus veröffentlicht, daher kann eine Seite etwas
beschreiben, das noch kein stabiles Release enthält. Ein *Seit*-Badge nennt das
erste stabile Release, das die Funktion enthält, und der Text daneben beschreibt das
Verhalten des vorherigen Releases.

Ein Canary ist ein Build von `main`, nummeriert nach dem Release, auf das er zusteuert:
`0.25.0-canary.g<commit>` ist `main` bei diesem Commit, nach 0.24.0 und vor
0.25.0, und `rebase upgrade --to canary` installiert die neueste Version. Er enthält
alles, was zum Zeitpunkt des Builds auf `main` gelandet war. Ein Badge mit dieser
Versionsnummer gilt also für Sie, und der Hinweis auf das vorherige Release beschreibt
das stabile Release, von dem Sie kommen.

## Die versionierten Verträge

Die folgenden Werte werden aus dem Quellcode ausgelesen; betrachten Sie die
Dateiverweise als verbindliche Wahrheit und diese Tabelle als Übersicht.

```bash
grep -rn "BUNDLE_FORMAT_VERSION =\|RUNTIME_CONTRACT_VERSION =" packages/types/src/types/project_manifest.ts
grep -n "AUTH_SCHEMA_VERSION =" packages/server-postgres/src/auth/schema-version.ts
```

| # | Vertrag | Deklariert in | Geprüft in | Kompatibilitätsrichtung |
|---|---|---|---|---|
| 1 | `rebase`-Bereich in `rebase.json` | Projekt des Nutzers | CLI beim Build | Projekt gibt an, welche Runtimes es akzeptiert |
| 2 | `BUNDLE_FORMAT_VERSION` | `packages/types/src/types/project_manifest.ts` | `packages/server/src/boot/bundle.ts` | **abwärtskompatibel**, wo das Layout es erlaubt – Format 3 verweigert Formate 1 und 2 |
| 3 | `RUNTIME_CONTRACT_VERSION` | selbe Datei | selbe Datei | **exakte Übereinstimmung, in beide Richtungen** |
| 4 | `AUTH_SCHEMA_VERSION` | `packages/server-postgres/src/auth/schema-version.ts` | beim Booten, gegen `rebase.schema_meta` | **nur vorwärtskompatibel** – neue Runtime migriert alte Datenbanken |
| 5 | `manifest.schemaVersion` | ausgegeben von `rebase build` | vom SDK als `x-rebase-schema` gesendet, wenn konfiguriert | informativ – identifiziert, gegen welches Schema ein Client gebaut wurde |
| 6 | Abgeleitete Datenbank-Bezeichner | `contracts/derived-names.txt` | `pnpm check:derived-names` | **eingefroren** – ein Name, den ein Release ausgegeben hat, wird niemals neu abgeleitet |

### 1 — `rebase` in `rebase.json`

Ein SemVer-Bereich, der wie `engines` in einer `package.json` interpretiert wird:
welche Runtime-Versionen dieses Projekt akzeptiert. Bewusst `rebase` statt
`runtime` genannt, da `runtime` bei einer App bereits angibt, *wer den Prozess
besitzt* (`managed` | `custom`).

### 2 — `BUNDLE_FORMAT_VERSION` (derzeit 3)

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Das On-Disk-Layout eines erstellten Bundles. Eine Runtime verweigert ein Bundle,
dessen Format neuer ist als ihr eigenes, und liest ein älteres, sofern das Layout
dies zulässt. Dadurch kann die Managed-Plattform einen Tenant auf ein neues Image
umziehen, ohne dass jemand sein Projekt neu bauen muss.

- **1** — `mode: "cms" | "baas" | "static"`, `entry.static` ein einzelnes Verzeichnis,
  `entry.admin` für ein gebündeltes Admin-Panel.
- **2** — `kind: "backend" | "static"`, `entry.static` eine Liste, `entry.admin`
  entfernt.
- **3** (0.31) — das Schema ist `entry.tables`, das kompilierte `backend/schema`,
  neben `entry.resources`, `entry.storage` und `entry.hooks`; `entry.config`,
  `entry.collections` und `entry.usersCollection` sind entfallen. **Formate 1 und 2
  werden abgewiesen, nicht migriert**: Sie enthalten `config/collections`, womit
  eine Runtime, die `backend/schema` liest, nichts anfangen kann; ein Start würde
  die Datenbank introspektieren und eine abweichende API bereitstellen. Die Fehlermeldung
  verweist auf `rebase migrate collections-to-tables`; migrieren Sie den Quellcode und
  bauen Sie neu. Dies war der einzige Bruch der Abwärtskompatibilität, der zusammen
  mit der unten stehenden Erhöhung des Runtime-Vertrags vorgenommen wurde.

**Erhöhen, wenn** sich das Layout so ändert, dass eine ältere Runtime ein neueres
Bundle falsch interpretieren würde. Die Erhöhung wandelt ein „startet und liefert
nichts aus“ in eine Startverweigerung um.

### 3 — `RUNTIME_CONTRACT_VERSION` (derzeit 2)

Die Major-Version des Bundle↔Runtime-Vertrags. Zu unterscheiden von der Paketversion
von `@rebasepro/server`, die beliebig viele Minor- und Patch-Releases veröffentlichen
kann, während dieser Wert unverändert bleibt.

**Lesen Sie dies, bevor Sie diesen Wert ändern.** Die Prüfung lautet `!==`, nicht `>`:

> Ein Bundle für Vertrag *N* läuft **ausschließlich** auf einer Runtime, die *N* implementiert

Eine Erhöhung macht daher **jedes jemals erstellte Bundle** auf einen Schlag
ungültig, bis jedes einzelne neu gebaut wurde. Das ist die beabsichtigte Härte –
es ist der Hebel für „hier kann nichts Altes mehr laufen“ –, bedeutet aber auch,
dass eine Erhöhung eine flottenweite Migration darstellt und nicht bloß eine
Release-Notiz. Für die Managed-Plattform muss dies mit einem Rebuild der Bundles
aller Tenants synchronisiert werden.

Wenn eine Änderung *additiv* ist und alte Bundles weiterhin korrekt wären, gehört
dies in `BUNDLE_FORMAT_VERSION` (oder erfordert gar keine Änderung), nicht hierher.
Version 0.31 erhöhte dies auf 2, zusammen mit Bundle-Format 3: Das Schemamodell
änderte sich, und das Bundle jedes Tenants wird aus dem migrierten Quellcode neu
gebaut.

### 4 — `AUTH_SCHEMA_VERSION` (derzeit 2)

Wird in `rebase.schema_meta` hinterlegt und beim Booten verglichen. Eine Runtime
**verweigert den Start** an einer Datenbank, die von einer neueren Framework-Version
migriert wurde, anstatt mit einer Struktur zu arbeiten, die sie nicht versteht –
bei einem Rolling Deploy ist das der Unterschied zwischen einer Flotte, die zur
Hälfte Fehler wirft, und einer, die zur Hälfte Daten beschädigt.

Vorwärtsmigrationen erfolgen automatisch: `ensureAuthTablesExist` aktualisiert eine
ältere Datenbank. Beachten Sie, dass dieser Migrationsblock bewusst in ein
`try/catch` gekapselt ist und loggt, anstatt einen Fehler zu werfen – ein
humpelnder Start ist besser als eine Crash-Schleife –, daher **beweist „es ist
gestartet“ überhaupt nichts**. Jede Assertion in der Upgrade-Suite liest stattdessen
den Katalog oder die Daten aus.

**Erhöhen, wenn** eine Migration von einer älteren Runtime keinesfalls übersprungen
werden darf. Erhöhen Sie den Wert nicht für eine additive, abwärtskompatible
Spalte; ein detailliertes Praxisbeispiel für diese Abwägung findet sich in
`packages/server-postgres/src/auth/ensure-tables.ts`.

### 5 — `manifest.schemaVersion`

Ein Hash der kompilierten Tabellen-Deskriptoren (`v2:…` seit 0.31), der in das
Bundle-Manifest geschrieben und von einem generierten SDK im Header `x-rebase-schema`
(`SCHEMA_VERSION_HEADER`) mitgesendet wird. Er existiert, damit die Plattform
mitteilen kann: „Diese App wurde für ein älteres Schema gebaut“, anstatt bei der
ersten Anfrage auf rätselhafte Weise fehlzuschlagen.

`rebase generate-sdk` schreibt den Wert in `schema.meta.ts`; übergeben Sie ihn an
den Client, um ihn mitzusenden:

```typescript
import { SCHEMA_VERSION } from "./generated/sdk/schema.meta";

const rebase = createRebaseClient<Database>({
    baseUrl: "http://localhost:3001",
    tables: tablesDictionary,
    schemaVersion: SCHEMA_VERSION,
});
```

Das Backend liest diesen Header bei jeder Datenanfrage. Eine Schema-Abweichung (Drift)
blockiert niemals eine Anfrage – ein SDK, das ein Schema hinterherhinkt, ist in der
Regel immer noch kompatibel, und das Ausrollen des Backends vor dem Frontend ist die
übliche Deployment-Reihenfolge. Wenn eine Anfrage jedoch mit einem 400- oder 404-Fehler
fehlschlägt, enthält der Fehler die Abweichung als Ursache:

```json
{
  "error": {
    "code": "BAD_REQUEST",
    "message": "Unknown field \"authorName\" on table \"posts\"",
    "cause": {
      "code": "SCHEMA_DRIFT",
      "clientSchema": "v2:0e1c…",
      "serverSchema": "v2:9ab4…",
      "message": "This client was generated against schema v2:0e1c…; this backend serves v2:9ab4…"
    }
  }
}
```

Eine umbenannte Spalte wird somit als „Ihr SDK ist veraltet, generieren Sie es neu“
gemeldet, anstatt als ein Feld, von dessen Existenz die eigenen Typen felsenfest
überzeugt sind. Eine erfolgreiche Anfrage wird darüber nicht benachrichtigt.

Er deckt **nur Tabellen** ab – deren kompilierte Deskriptoren, in denen ein Hook
lediglich ein Präsenz-Flag ist. Der Code eines Hooks oder die Bearbeitung einer
Function ändert nicht den Vertrag des Clients und darf nicht jedes generierte SDK
entwerten. Da 0.31 den Hash von Collections auf Deskriptoren umgestellt hat, meldet
jede mit `v1:` gestempelte Datenbank die Änderung einmalig bei der Neubestempelung
(Booten des Schema-Owners oder `rebase db push`), und jedes generierte SDK gilt
einmalig als veraltet.

### Wer die Anfrage stellt

Zwei weitere Identifikationssignale, von denen keines für sich genommen den Zugriff
beschränkt:

- **`GET /api/meta/schema-version`** ist nicht authentifiziert und antwortet mit
  der `schemaVersion` des Projekts *und* dessen `runtime` (`version` und `contract`).
  Ein CI-Job, der sein generiertes SDK mit einem Live-Projekt vergleicht, benötigt
  keine Zugangsdaten, ebenso wenig wie ein Client, der abfragt, mit welcher Runtime
  er kommuniziert.
- **`User-Agent: rebase-cli/<version>`** wird bei jeder `rebase cloud`-Anfrage
  mitgesendet. Das Wire-Format der Control-Plane eilt dem voraus, was auf npm
  veröffentlicht ist; sie muss daher in der Lage sein, einem alten Client mit
  `CLI_TOO_OLD` und der Mindestversion zu antworten – was sie nur für Aufrufer tun
  kann, die sich zu erkennen geben.

### 6 — Abgeleitete Datenbank-Bezeichner

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Jeder Name, den dieses Framework selbstständig ermittelt, anstatt ihn vorgegeben
zu bekommen: eine Fremdschlüssel-Spalte, ein Fremdschlüssel-Constraint, eine
Zwischentabelle (Junction Table) samt ihren zwei Schlüsselspalten, ein Enum-Typ,
ein Policy-Name, die `snake_case`-Spalte eines `camelCase`-Spaltenschlüssels. Seit
0.31 werden Tabellen mit `defineTable` deklariert, was exakt dieselben Namen
ableitet wie zuvor eine Collection für ein gleichwertiges Schema;
`rebase migrate collections-to-tables` belegt dies pro Projekt durch den
byteweisen Vergleich des generierten SQL.

> **Ein abgeleiteter Bezeichner ist in dem Moment eingefroren, in dem ein Release ihn ausgibt.**

Nicht „eingefroren bis zur nächsten Major-Version“ – eingefroren. Die Begründung
unterscheidet sich von den anderen fünf Verträgen und wiegt schwerer. Jene sind
versioniert, sodass eine Abweichung *erkannt* und abgewiesen werden kann. Dieser
hier nicht: Der Name wird an dem Tag, an dem ein Kunde deployt, in dessen
Datenbank geschrieben, und es gibt keinen Versionsstempel auf einer Spalte. Jede
Datenbank, die von irgendeinem jemals ausgelieferten Release bereitgestellt wurde,
trägt die jeweils abgeleiteten Namen, und kein Code in diesem Repository kann
eingreifen und sie alle umbenennen.

Version 0.13 ist das Praxisbeispiel. `generateForeignKeyName` lernte, korrekte
Singularformen zu bilden – `categorie_id` → `category_id`, `addres_id` → `address_id` –
was unbestreitbar die bessere Ableitung war, aber jede ältere Datenbank mit
unregelmäßigen Pluralen beschädigte. Boot-Ensure migrierte die Spalte, die Daten
überlebten also; das eingecheckte `schema.generated.ts` des Projekts tat dies jedoch
nicht, und der Bootvorgang scheiterte an einer Spalte, die bereits existierte. Drei
Commits, ein neuer Schnittstellentest (Seam Test) und ein permanenter Eintrag in den
Upgrade-Hinweisen, im Tausch gegen einen schöner aussehenden Spaltennamen, nach dem
niemand gefragt hatte.

**Wenn eine Ableitung grundlegend falsch ist**, ändert sie sich nur für *danach*
erstellte Tabellen, geschützt durch eine im Projekt hinterlegte Benennungsstrategie –
niemals rückwirkend und niemals als Nebeneffekt einer Verbesserung der zugrunde
liegenden Funktion.

**Die einzige legitime Ausnahme** ist eine Änderung, die den Code mit einem Namen
in Einklang bringt, den die Datenbank *bereits besitzt*. Das Praxisbeispiel hierfür
ist das Abschneiden von Bezeichnern (Identifier Truncation): Postgres schneidet
Bezeichner stillschweigend auf 63 Bytes ab, weshalb ein längerer abgeleiteter
Constraint-Name niemals der tatsächliche Name im Katalog war – die Ableitung
beschrieb ein Objekt, das unter dieser Schreibweise gar nicht existierte, und
Boot-Ensure führte bei jedem einzelnen Start `ADD CONSTRAINT` erneut aus, da der
Abgleich niemals übereinstimmen konnte. Das Abschneiden bei der Erstellung ändert
lediglich, was dieses Repository *ableitet*, ändert aber nichts daran, was eine
deployte Datenbank *enthält*. Das ist der anzuwendende Prüfstein: nicht „ist der
neue Name besser?“, sondern „muss sich irgendeine bestehende Datenbank ändern?“.

Der andere Fall, in dem sich ein Name ändern kann, ist eine Gruppe von Namen, die
unmöglich alle gleichzeitig koexistieren konnten. Eine Regel, die sich über mehrere
Operationen auf einer Tabelle mit 42 oder mehr Bytes erstreckte, leitete
`<table>_default_admin_write_insert`, `_update` und `_delete` ab, und alle drei
wurden auf dieselben 63 Bytes gekürzt. Postgres speicherte nur eine Policy, DELETE,
und verweigerte alle Admin-INSERTs und -UPDATEs. Nur wenn die Namen einer Regel auf
diese Weise kollidieren, werden sie Suffix-orientiert als `<head>_<hash8>_<op>`
abgeleitet. Jeder Name, der heute funktioniert, behält seine Schreibweise bei. Der
nächste Boot oder Push entfernt die eine abgeschnittene Policy und erstellt eine
Policy für jede einzelne Operation.

Das Einzige, was immer sicher ist, ist das *Erkennen* eines alten Namens, um ihn
zu migrieren: `legacyForeignKeyName` existiert, um erkannt zu werden, niemals, um
generiert zu werden, und die Baseline sichert auch diese Erkennungen ab. Das
Entfernen einer Erkennung würde stillschweigend die Migration jeder Datenbank
rückgängig machen, die noch diese Schreibweise verwendet.

**Das Gate.** `tooling/scripts/derived-names.mts` schleust eine Naming-Stress-Fixture –
unregelmäßige Plurale, eine `ss`-Endung, ein Akronym, eine Junction über einen
Plural-Slug, explizite Überschreibungen, einen Slug, der lang genug ist, um
abgeschnitten zu werden – durch beide Erzeuger von Schema-DDL und gibt jeden
Bezeichner aus, den einer von beiden benennt:

```bash
pnpm check:derived-names
```

Eine geänderte oder entfernte Zeile schlägt als Vertragsbruch fehl, wobei die alte
und die neue Schreibweise nebeneinander aufgeführt werden. Eine rein additive
Änderung schlägt ebenfalls fehl, allerdings mit dem Hinweis „regenerate“ – so kann
die Baseline niemandem unbemerkt weglaufen.

Es stellt außerdem sicher, dass `rebase db push` und das Boot-Ensure der verwalteten
Runtime *dieselben* Namen ableiten, was ein zweiter Vertrag ist, der sich im ersten
verbirgt: Sie kompilieren dieselben Tabellen über unterschiedlichen Code, und ein
Projekt, das einmal gepusht und später gebootet wird, darf nicht in zwei verschiedenen
Schemas enden.

## Was *nicht* eingefroren ist

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Klar formuliert, damit niemand Zusagen hineininterpretiert, die nie gemacht wurden:

- Die von Ihnen geschriebene TypeScript-API – `defineTable` und `customizeTable`,
  Optionen für `initializeRebaseBackend`, Admin-Props, SDK-Methodennamen. 0.31
  ersetzte Collections durch Tables in einer Minor-Version, mit einem Codemod, der
  beweist, dass das generierte SQL unverändert bleibt. Breaking Changes erscheinen
  in Minor-Versionen und werden im Changelog angekündigt.
- `@rebasepro/studio`, `@rebasepro/mcp`, `@rebasepro/inference`,
  `@rebasepro/plugin-*` – diese entwickeln sich am schnellsten und haben die
  wenigsten Nutzer.
- Alles unter dem `src/`-Verzeichnis eines Pakets, das nicht über dessen Barrel-Datei
  re-exportiert wird. `packages/client/src/index.ts` enthält einen Hinweis, der
  erklärt, dass seine Exportliste bewusst kuratiert wird, damit ein interner Export
  nicht versehentlich öffentlich wird.
- Das Datenbankschema *Ihrer* Tabellen. Dieses gehört Ihnen; Rebase besitzt
  ausschließlich das `rebase`-Schema (sowie auf Datenbanken, die vor 0.13
  bereitgestellt wurden, das alte `auth`-Schema, bis der Bootvorgang es außer Dienst
  stellt).

## Die Gates, die dies absichern

Nichts davon ist bloße Konvention – hinter jedem Punkt steht ein Test, der
fehlschlägt, sobald dagegen verstoßen wird:

| Gate | Was es absichert |
|---|---|
| `pnpm verify:corpus` | jede jemals ausgelieferte Bundle-Form, gebootet auf der heutigen Runtime. Fixtures in `tests/fixtures/bundles/` sind **von Hand erstellt und eingefroren** – eine Fixture, die der Builder neu generiert, verändert sich jedes Mal, wenn der Builder verändert wird |
| `pnpm verify:selfhost` | ein echtes Bundle, gebaut, zusammengefasst, gebootet und so abgerufen, wie ein Browser es tun würde |
| `upgrade-e2e.test.ts` | alte Datenbankschemas (`schema-snapshots/`), verarbeitet von der aktuellen Runtime |
| `tests/e2e/tests/cli-init-e2e.ts` | ein gescavoldetes Projekt, installiert aus **echten Tarballs**, nicht über Workspace-Links |
| `tests/e2e/tests/client-sdk-e2e.ts` | der Endbenutzer-Pfad: Registrierung → Anmeldung → RLS-bezogene Lesevorgänge → Refresh → Storage → Realtime |
| `pnpm check:derived-names` | jeden Spalten-, Constraint-, Junction-, Enum- und Policy-Namen, den das Framework ableitet – und dass Boot und `db push` diese identisch ableiten |
| `pnpm rls:check` | die Policies des generierten Schemas |
| `pnpm check:api-surface` | jeden Export und dessen Member der fünf vom Image bereitgestellten Pakete – `@rebasepro/server`, `types`, `client`, `common`, `utils` – sowie des Einstiegspunkts `@rebasepro/server/functions`, gegen die sechs Abschnitte von `contracts/server.api.txt`. Dies sind die Pakete, die `infra/docker/entrypoint.mjs` per Symlink über die eigenen Kopien eines deployten Bundles legt; das Entfernen eines Exports aus einem dieser Pakete ist für niemanden ein Kompilierungsfehler – es ist ein flottenweiter Boot-Fehler während eines Rollouts, den niemand angefordert hat |
| `pnpm test:gates` | die Tests der Gates selbst über Fixtures – 47 Dateien, darunter `check:api-surface` und die unten genannte Release-Bump-Prüfung –, sodass ein Gate, das das nicht mehr sieht, was es schützen soll, hier fehlschlägt. `check:api-surface` konnte lange Zeit nicht erkennen, wenn ein Member aus `const rebase` verschwand |
| `node tooling/scripts/check-release-bump.mjs` | dass die Versionsstufe (Bump Level), unter der ein Release veröffentlicht wird, dem entspricht, was das Release an den obigen Baselines geändert hat – ausgeführt von `publish.yml`, bevor das Changelog gestempelt wird |
| saas CI | die Control-Plane gebaut gegen `main` dieses Repositories, bei eigenen Pushes und nächtlich |

**Zeichnen Sie einmal pro Release eine Bundle-Fixture und einen Schema-Snapshot auf.**
Der Wert beider Corpora liegt ausschließlich darin, wie weit die älteste zurückreicht,
und keines von beiden kann nachträglich aufgefüllt werden.

### Noch nicht durch Gates abgesichert

Die obige Tabelle zeigt, was verbindlich abgesichert ist. Dies sind die Teile der
Richtlinie, die noch durch nichts abgesichert sind – aufgeführt, damit niemand
unberechtigte Erwartungen daran knüpft:

- **Kein Deprecation- oder Support-Fenster.** Solange Rebase bei `0.x` steht, gibt es
  keine schriftliche Regelung darüber, wie lange ein veralteter (deprecated) Export vor
  seiner Entfernung erhalten bleibt oder wie lange eine ältere Minor-Version
  Fehlerbehebungen erhält. Sicherheits-Fixes landen ausschließlich auf der neuesten
  Minor-Version.
- **Das HTTP-Wire-Format besitzt kein Gate.** Kein `check:*`-Skript vergleicht Request-
  und Response-Formen mit einer Baseline, so wie `check:api-surface` es für Exporte tut;
  eine veränderte Response-Form wird nur von einer E2E-Suite bemerkt, die diese zufällig
  liest.
- **CLI-Flags haben keine Kompatibilitäts-Baseline.** Der Dokumentationsprüfer schlägt
  fehl, wenn ein Flag verschwindet, das von den Skills, den Beispielen oder der
  Marketing-Website verwendet wird; ansonsten bemerkt nichts, wenn ein anderes Flag
  wegfällt oder seine Bedeutung ändert.
- **Ein CI-Release zeichnet keines der beiden Corpora auf.** Der Publish-Workflow
  zeichnet weder eine Bundle-Fixture noch einen Schema-Snapshot auf; nur das lokale
  Release-Skript versucht dies und warnt lediglich, anstatt abzubrechen, wenn es
  fehlschlägt. Die Versionen 0.18 bis 0.21 verfügen über keinen aufgezeichneten
  Projekt-Snapshot.
- **Die Export-Oberfläche ist ein Gate, kein Vertrag.** Ob die öffentlichen Exporte
  der von der Runtime bereitgestellten Pakete zu einem siebten nummerierten Vertrag
  werden – deklariert als die `check:api-surface`-Baseline, additiv kompatibel
  innerhalb einer Major-Vertragsversion –, ist eine offene Entscheidung.

## Einen Vertrag ändern

1. Bestimmen Sie, welcher der sechs Verträge betroffen ist. Die meisten Änderungen
   betreffen keinen von ihnen – aber „keiner der sechs“ bedeutet nicht „unkritisch“.
   Das Entfernen oder Umbenennen eines Exports von `@rebasepro/server` oder eines
   Members daraus betrifft keinen der sechs und ist dennoch die mit Abstand
   gefährlichste Änderung im Repository, da der Code, den sie bricht, bereits gebaut
   ist und nicht neu kompiliert wird. `pnpm check:api-surface` sichert diese Grenze ab;
   ob daraus ein siebter nummerierter Vertrag wird, ist eine offene Entscheidung (siehe
   *Noch nicht durch Gates abgesichert* oben).
2. Fügen Sie zuerst eine Fixture oder einen Snapshot für die **alte** Struktur hinzu
   und verifizieren Sie, dass der Test erfolgreich durchläuft.
3. Nehmen Sie die Änderung vor und erhöhen Sie die Konstante.
4. Bestätigen Sie, dass die alte Fixture weiterhin erfolgreich durchläuft oder dass
   sie nun *mit genau der Meldung fehlschlägt, die ein Benutzer benötigt*. Beides
   sind gültige Ergebnisse; stilles Fehlschlagen ist es nicht.
5. Planen Sie für Vertrag 3 vor dem Mergen den Rebuild jedes deployten Bundles ein.
6. Vertrag 6 ist die Ausnahme zu den Schritten 3 und 4: Es gibt keine Konstante, die
   erhöht werden kann, und keine Version, anhand derer der Dienst verweigert werden
   könnte, da eine Spalte keinen Versionsstempel trägt. Der Schritt, der diese ersetzt,
   besteht darin, die Änderung gar nicht erst vorzunehmen – siehe den obigen Abschnitt
   dazu, wie die Alternative aussieht.

## Verwandte Themen

- [Upgraden](/docs/upgrading/) — was tatsächlich kaputtging, Release für Release
- [Changelog](/docs/changelog/) — jede Änderung, einschließlich derjenigen, die nichts beschädigt haben
- [Runtime & Bundles](/docs/architecture/runtime-and-bundles/) — Vertrag 3 — das Bundle-Format, gegen das ein deploytes Projekt bereits gebaut ist
