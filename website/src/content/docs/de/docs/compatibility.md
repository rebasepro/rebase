---
sourceHash: 574dcb0aad3f6719
slug: de/docs/compatibility
title: Kompatibilität
description: Was Rebase über Versionen hinweg verspricht und was nicht – die sechs versionierten Verträge, wie jeder einzelne fehlschlägt und was sich in einem Minor-Release noch ändern kann.
---

Was Rebase über Versionen hinweg verspricht und was nicht.

Dies ist das Dokument, das Sie lesen sollten, bevor Sie etwas ändern, von dem ein
bereitgestelltes Projekt oder ein laufender Rebase Cloud-Tenant bereits abhängt. Es
ist auch die ehrliche Antwort auf die Frage: „Wenn ich heute auf Rebase baue, was
bricht mir später unter den Füßen weg?“

## Was „Beta“ hier bedeutet

Rebase befindet sich in der öffentlichen Beta. Die meisten Projekte verwenden dieses
Wort im Sinne von „alles kann kaputtgehen“, was dem Leser keine verlässliche
Planungsgrundlage bietet. Hier ist also die Grenze, die dieses Projekt tatsächlich zieht:

> **Die API, gegen die Sie entwickeln, kann sich in einem Minor-Release mit einem
> Changelog-Eintrag ändern. Ihre Daten können nicht still und leise Schaden nehmen.**

Die erste Hälfte ist gewöhnliches `0.x`-Verhalten und wird weiter unten beschrieben.
Die zweite Hälfte ist der Teil, der eine genauere Betrachtung lohnt, da es sich um eine
Aussage über Mechanismen und nicht über Absichten handelt: Die versionierten Verträge
im nächsten Abschnitt sind jeweils in einem Artefakt oder einer Datenbank fest verankert,
jeder wird beim Booten oder beim Einlesen überprüft, und jeder **schlägt laut und
präzise fehl**, anstatt schleichend zu degradieren. Ein Schema-Push, der eine Spalte
löschen würde, wird durch ein destruktives Gate abgelehnt
(`packages/server-postgres/test/e2e/db-push-safety.test.ts`), und der Upgrade-Pfad
selbst ist ein Test: `upgrade-e2e.test.ts` stellt Datenbanken so wieder her, wie
ältere Releases sie hinterlassen haben, führt den aktuellen Migrationspfad über jede
einzelne aus und stellt sicher, dass die Zeilen überleben – und nicht bloß der Boot-Vorgang.

Was Beta tatsächlich bedeutet: Features fehlen noch, manche Subsysteme sind neuer
als andere, und die Beschaffenheit einer Ecke und Kante besteht darin, dass etwas fehlt
oder unhandlich ist – nicht darin, dass im Stillen Daten korrumpiert werden. Welche
Subsysteme wie eingestuft sind, wird veröffentlicht und datiert, anstatt dem Zufall
überlassen zu werden – die nachfolgende Tabelle stellt diese Veröffentlichung dar.

## Reifegrad nach Subsystem

**Zuletzt überarbeitet am 14. September 2026, bezogen auf 0.21.0.** Lesen Sie dies
bei jedem Minor-Release erneut; eine Einstufung, die sich in drei Releases nicht
geändert hat, ist entweder gefestigt oder vergessen – und dieser Hinweis steht hier,
damit der Unterschied überprüft wird.

Die drei Einstufungen bedeuten:

- **Stabil** — Die Form ist festgelegt und durch ein Gate in der CI abgedeckt. Es
  können weiterhin Features hinzukommen; sie wird innerhalb von 0.x nicht grundlegend
  neu gestaltet, und eine Änderung, die Breaking Changes mit sich bringt, wird im
  Changelog angekündigt.
- **Beta** — Es funktioniert und wird in der Produktion eingesetzt, und es ist
  bekannt, dass bestimmte Aspekte noch unausgereift sind: ein Limit, an das Sie
  stoßen können, eine unpraktische Kante oder eine noch nicht getroffene
  Designentscheidung. Der unausgereifte Teil wird in den Notizen benannt, da „Beta“
  alleine keine verlässliche Planungsgrundlage bietet.
- **Experimentell** — Veröffentlicht, damit es verwendet und evaluiert werden kann.
  Stellen Sie sich darauf ein, auf Bereiche zu stoßen, die noch niemand betreten hat.

| Subsystem | Einstufung | Worauf die Einstufung basiert |
|---|---|---|
| REST-API + generiertes SDK | Stabil | Der Wire-Vertrag ist versioniert und abgesichert; `client-sdk-e2e` steuert Registrierung → Anmeldung → RLS-bezogene Lesevorgänge → Refresh → Storage → Realtime durchgängig end-to-end |
| Auth — E-Mail/Passwort, OAuth, OIDC, Magic Link, Einmalcode | Stabil | Zwölf OAuth-Provider sind enthalten. Das Auth-Schema ist ein versionierter Vertrag, der beim Booten gestempelt und geprüft wird |
| Auth — MFA (TOTP) | Beta | Registrierung, Verifizierung und Wiederherstellung funktionieren und sind getestet. Die Schlüsselrotation für den Verschlüsselungsschlüssel ist implementiert; es gibt keine Admin-Oberfläche zum Zurücksetzen des Faktors eines ausgesperrten Benutzers |
| Row-Level Security | Stabil | Das Kernstück des Produkts. `pnpm rls:check` prüft eine aktive Datenbank anhand von fünfzehn Kontrollen, und die RLS-e2e-Suite wird bei jedem Push ausgeführt |
| Storage | Stabil | Lokal, S3 und GCS. Standardmäßig auf „deny“ in der Produktion seit 0.17.0, und das Scaffold enthält einen Authorize-Hook |
| Realtime | **Beta** | Jeder Frame ist ein Lesevorgang unter dem eigenen RLS-Geltungsbereich des Abonnenten. Sockets eines Benutzers auf einer Liste teilen sich diesen Lesevorgang, und eine Liste, die nach einer Spalte der Zeile gefiltert ist (`where owner == me`), wird nur abgefragt, wenn ein Schreibvorgang sie erreichen kann: 5.000 Benutzer, die jeweils ihre eigenen Zeilen beobachten, kosten **einen** Lesevorgang pro Schreibvorgang, Auslieferungszeit ~305 ms (gemessen, `tooling/scripts/bench-realtime-fanout.mts`). Die Grenze ist eine Liste, die ausschließlich durch RLS eingegrenzt wird: ein Lesevorgang pro eindeutigem Benutzer pro Schreibvorgang, d. h. 5.000 Benutzer auf derselben ungefilterten Liste bedeuten 5.000 Lesevorgänge und ~2,6 s, bis der Fan-Out abgeschlossen ist. Korrekt bei jeder Skalierung; filtern Sie nach der Spalte, die die Policy liest, um bei einem Lesevorgang zu bleiben |
| Vektorsuche (pgvector) | Beta | Jede Vektorspalte erhält standardmäßig einen HNSW-Index für Kosinus-Distanz, anpassbar pro Spalte über `col.vector({ dimensions, index })` (Methode, Distanzen, Build-Parameter) oder deaktivierbar, was einen exakten Scan hinterlässt. pgvector kann Spalten mit mehr als 2.000 Dimensionen nicht indizieren, weshalb diese unindiziert bleiben und gescannt werden |
| Offline-Sync | Beta | Mutationen enthalten Idempotenzschlüssel, die der Server berücksichtigt, und die beim Juli-Audit festgestellten Datenverlustfehler wurden behoben. Das Konfliktmodell ist Last-Write-Wins ohne feldweises Zusammenführen |
| Entity-Historie | Stabil | Snapshot-basiert, abgesichert durch eine eigene Suite |
| Funktionen und Crons | Stabil | Der portable Einstiegspunkt (`@rebasepro/server/functions`) ist ein versionierter Vertrag mit einem eigenen API-Surface-Abschnitt |
| MCP-Server + Agent-Skills | Beta | `@rebasepro/mcp` läuft über stdio: 53 Tools, Bearer-Authentifizierung pro Projekt, destruktive Tools verweigern nicht-lokale Ziele, sofern nicht ausdrücklich aktiviert. Seit 0.21 kann der Server auch einen Remote-Endpunkt `/mcp` einhängen — OAuth 2.1, 17 Daten-Tools (die vier für gespeicherte Apps sind experimentell), jeder Aufruf unter der RLS des angemeldeten Benutzers — standardmäßig deaktiviert, es sei denn `REBASE_MCP_ENABLED=true`, und nur für Postgres |
| Studio (SQL, Schema, RLS, API-Explorer) | Beta | Täglich im Einsatz bei echten Projekten. Branching ist im OSS-Paket vorhanden und in Rebase Cloud bewusst nicht freigeschaltet, da es für den Wechsel eines laufenden Deployments auf einen Branch noch kein Konzept gibt |
| CMS + Admin-Panel | Beta | Vollständig für CRUD, Relationen, Storage-Felder und Rollen. **Die Datentabelle besitzt keine Grid-Semantik** — kein `role`, kein `aria-rowindex`, `tabIndex` entfernt — daher können Tastatur- und Screenreader-Benutzer die Hauptansicht nicht bedienen. Keine Entwürfe, keine sprachspezifischen Inhalte, kein Block-Rich-Text |
| Verwaltete PGlite-Entwicklungsdatenbank | Beta | `rebase dev` ohne Konfigurationsaufwand und ohne Docker. Immer nur eine Sitzung gleichzeitig, sodass Anfragen serialisiert werden und Nebenläufigkeit damit nicht reproduziert werden kann; Ptah-basierte Befehle `db push` und `db generate` planen gegen eine separate Wegwerf-PGlite-Instanz; `db migrate` wendet die Migrationshistorie an; `db branch` funktioniert dort nicht und meldet dies auch. |
| Helm-Chart | Beta | Rendert die Split-Process-Topologie und wird bei jedem Release in der OCI-Registry veröffentlicht. Der Standard bleibt ein einzelner Container |
| `@rebasepro/firebase` | Experimentell | Firestore als Quelle, die das Admin-Panel direkt neben den Tabellen des Backends liest: `defineFirestoreCollection` in `frontend/src/cms`, übergeben als `externalCollections`. Kein RLS, keine SQL-Oberfläche; der Postgres-Funktionsumfang wird nicht übertragen. Der Firestore-Treiber ignoriert `or(...)`/`and(...)`-Filtergruppen, sodass eine Abfrage, die eine solche verwendet, jede Zeile liest, die ihre einfachen Filter zulassen |
| Rebase Cloud | **Private Beta** | Live, betreibt echte Mandanten, Zugang wird schrittweise freigeschaltet. Kein Self-Service |

Zwei der obigen Einträge sind der ehrliche Preis für die Veröffentlichung dieser
Tabelle: Der Realtime-Fan-Out für Listen, die nur durch RLS eingegrenzt werden, und
die Barrierefreiheit der Datentabelle sind bekannte Einschränkungen, keine Roadmap-Punkte,
und beide werden aufgeführt, statt dem Leser erst bei der Nutzung aufzufallen.

Diese Tabelle zeigt, was existiert. Was noch nicht existiert, steht auf der
[Roadmap](https://rebase.pro/roadmap), ein Eintrag pro GitHub-Issue, wobei die für
1.0 erforderliche Teilmenge markiert ist.

## Das 0.x-Versprechen

Rebase ist `0.x`. Dieser Abschnitt ist so verfasst, dass er für jedes 0.x-Release
Gültigkeit hat und nicht nur für eines, damit er nicht mit jeder Version veraltet.
**Breaking Changes an der bereitgestellten TypeScript-API sind in einem Minor-Release
weiterhin zulässig**, und das Changelog ist der Ort, an dem sie angekündigt werden.
Was *nicht* stillschweigend kaputtgehen darf, ist die Reihe der nachfolgenden
versionierten Verträge: Jeder ist fest in ein Artefakt oder eine Datenbank
eingeprägt, jeder wird beim Booten oder Einlesen überprüft, und jeder schlägt
**laut und eindeutig fehl**, anstatt schleichend zu degradieren.

Dieser Unterschied macht das gesamte Versprechen aus. Ein umbenannter Export kostet
Sie einen Kompilierfehler und fünf Minuten. Ein Bundle, das gegen die falsche Runtime
startet und subtil falsche Daten ausliefert, kostet Sie einen Incident – und die
Verträge existieren, damit die zweite Kategorie niemals still und leise auftreten kann.

Rebase Cloud verwendet exakt diese Verträge und nichts sonst. Alles, was hier nicht
aufgeführt ist, ist ein Implementierungsdetail, von dem die Plattform nicht abhängt.

### Versions-Badges und Canaries

Die Dokumentation wird aus `main` heraus veröffentlicht, daher kann eine Seite
etwas beschreiben, das noch in keinem stabilen Release enthalten ist. Ein *Since*-Badge
nennt das erste stabile Release, das die Funktion enthält, und der Text daneben
erläutert das Verhalten des vorherigen Releases.

Ein Canary ist ein Build von `main`, nummeriert nach dem Release, auf das er
zusteuert: `0.25.0-canary.g<commit>` ist `main` bei diesem Commit, nach 0.24.0 und
vor 0.25.0, und `rebase upgrade --to canary` installiert die neueste Version. Er
enthält alles, was `main` zum Zeitpunkt des Builds erreicht hatte; ein Badge mit
dieser Version gilt also für Sie, und der Hinweis zum vorherigen Release beschreibt
das stabile Release, von dem Sie gekommen sind.

## Die versionierten Verträge

Die untenstehenden Werte werden aus dem Quellcode ausgelesen; betrachten Sie die
Dateireferenzen als maßgebliche Wahrheit und diese Tabelle als Übersicht.

```bash
grep -rn "BUNDLE_FORMAT_VERSION =\|RUNTIME_CONTRACT_VERSION =" packages/types/src/types/project_manifest.ts
grep -n "AUTH_SCHEMA_VERSION =" packages/server-postgres/src/auth/schema-version.ts
```

| # | Vertrag | Deklariert in | Geprüft in | Kompatibilitätsrichtung |
|---|---|---|---|---|
| 1 | `rebase`-Bereich in `rebase.json` | Projekt des Benutzers | CLI beim Build | Projekt gibt an, welche Runtimes es akzeptiert |
| 2 | `BUNDLE_FORMAT_VERSION` | `packages/types/src/types/project_manifest.ts` | `packages/server/src/boot/bundle.ts` | **abwärtskompatibel**, wo das Layout es erlaubt — Format 3 weist die Formate 1 und 2 ab |
| 3 | `RUNTIME_CONTRACT_VERSION` | dieselbe Datei | dieselbe Datei | **exakte Übereinstimmung, in beide Richtungen** |
| 4 | `AUTH_SCHEMA_VERSION` | `packages/server-postgres/src/auth/schema-version.ts` | beim Booten, gegen `rebase.schema_meta` | **nur vorwärtskompatibel** — neue Runtime migriert alte Datenbanken |
| 5 | `manifest.schemaVersion` | ausgegeben von `rebase build` | vom SDK als `x-rebase-schema` gesendet, sofern konfiguriert | informativ — identifiziert, gegen welches Schema ein Client gebaut wurde |
| 6 | Abgeleitete Datenbank-Bezeichner | `contracts/derived-names.txt` | `pnpm check:derived-names` | **eingefroren** — ein Name, den ein Release einmal erzeugt hat, wird niemals neu abgeleitet |

### 1 — `rebase` in `rebase.json`

Ein SemVer-Bereich, ähnlich zu lesen wie `engines` in einer `package.json`: welche
Runtime-Versionen dieses Projekt akzeptiert. Er heißt bewusst `rebase` und nicht
`runtime`, da `runtime` bei einer App bereits angibt, *wer den Prozess besitzt*
(`managed` | `custom`).

### 2 — `BUNDLE_FORMAT_VERSION` (aktuell 3)

Das On-Disk-Layout eines erstellten Bundles. Eine Runtime verweigert ein Bundle,
dessen Format neuer ist als ihr eigenes, und liest ein älteres, sofern das Layout
dies zulässt. Dadurch kann die Managed-Ebene einen Mandanten auf ein neues Image
umstellen, ohne dass jemand sein Projekt neu bauen muss.

- **1** — `mode: "cms" | "baas" | "static"`, `entry.static` ein einzelnes Verzeichnis,
  `entry.admin` für ein gebündeltes Admin-Panel.
- **2** — `kind: "backend" | "static"`, `entry.static` eine Liste, `entry.admin`
  entfernt.
- **3** (0.31) — Das Schema ist `entry.tables`, das kompilierte `backend/schema`,
  neben `entry.resources`, `entry.storage` und `entry.hooks`; `entry.config`,
  `entry.collections` und `entry.usersCollection` wurden entfernt. **Die Formate 1
  und 2 werden abgewiesen, nicht aktualisiert**: Sie enthalten `config/collections`,
  womit eine Runtime, die `backend/schema` liest, nichts anfangen kann; ihr Start
  würde die Datenbank introspektieren und eine abweichende API bereitstellen. Die
  Abweisung verweist auf `rebase migrate collections-to-tables`; migrieren Sie den
  Quellcode und bauen Sie neu. Dies war der einzige Bruch der Abwärtskompatibilität,
  der zusammen mit der unten genannten Erhöhung des Runtime-Vertrags vorgenommen wurde.

**Wann erhöhen?** Wenn sich das Layout so ändert, dass eine ältere Runtime ein
neueres Bundle falsch interpretieren würde. Die Erhöhung verwandelt ein „startet
und liefert nichts aus“ in eine explizite Startverweigerung.

### 3 — `RUNTIME_CONTRACT_VERSION` (aktuell 2)

Die Major-Version des Bundle↔Runtime-Vertrags. Sie unterscheidet sich von der
Version des `@rebasepro/server`-Pakets, das beliebig viele Minor- und Patch-Releases
erhalten kann, während diese Version unverändert bleibt.

**Vor Änderungen unbedingt lesen.** Die Prüfung lautet `!==`, nicht `>`:

> Ein Bundle, das auf Vertrag *N* abzielt, läuft **ausschließlich** auf einer Runtime, die *N* implementiert

Eine Erhöhung macht daher **jedes jemals erstellte Bundle** auf einen Schlag
ungültig, bis jedes einzelne neu gebaut wurde. Dies ist der beabsichtigte
Schweregrad – es ist der Hebel für „nichts Altes darf hier laufen“ –, bedeutet
jedoch auch, dass eine Erhöhung eine flottenweite Migration darstellt und keine
bloße Release-Notiz. Für die Managed-Ebene muss dies mit einem Rebuild der
Bundles aller Mandanten synchronisiert werden.

Wenn eine Änderung *additiv* ist und alte Bundles weiterhin korrekt funktionieren
würden, betrifft dies `BUNDLE_FORMAT_VERSION` (oder gar nichts) und nicht diese
Konstante. Version 0.31 hat sie auf 2 erhöht, zusammen mit Bundle-Format 3: Das
Schema-Modell hat sich geändert, und das Bundle jedes Mandanten wird aus dem
migrierten Quellcode neu gebaut.

### 4 — `AUTH_SCHEMA_VERSION` (aktuell 2)

Wird in `rebase.schema_meta` eingetragen und beim Booten verglichen. Eine Runtime
**verweigert den Start** gegen eine Datenbank, die von einer neueren
Framework-Version migriert wurde, anstatt auf einer Datenstruktur zu operieren, die
sie nicht versteht – bei einem Rolling Deploy ist das der Unterschied zwischen der
Hälfte der Flotte, die Fehler ausgibt, und der Hälfte der Flotte, die Daten korrumpiert.

Die Vorwärtsmigration erfolgt automatisch: `ensureAuthTablesExist` aktualisiert
eine ältere Datenbank. Beachten Sie, dass dieser Migrationsblock bewusst in ein
`try/catch` gekapselt ist und loggt, anstatt Exceptions zu werfen – ein humpelnder
Start ist besser als ein Crash-Loop –, weshalb **„er ist hochgefahren“ nichts
beweist**. Jede Assertion in der Upgrade-Suite liest stattdessen den Katalog oder
die Daten aus.

**Wann erhöhen?** Wenn eine Migration von einer älteren Runtime keinesfalls
übersprungen werden darf. Erhöhen Sie sie nicht bei einer additiven,
abwärtskompatiblen Spalte; ein praktisches Beispiel für diese Abwägung findet sich
in `packages/server-postgres/src/auth/ensure-tables.ts`.

### 5 — `manifest.schemaVersion`

Ein Hash der kompilierten Tabellen-Deskriptoren (`v2:…` seit 0.31), der im
Bundle-Manifest ausgegeben und von einem generierten SDK im Header `x-rebase-schema`
(`SCHEMA_VERSION_HEADER`) zurückgegeben wird. Er existiert, damit die Plattform
melden kann: „Diese App wurde gegen ein älteres Schema gebaut“, anstatt beim ersten
Request rätselhaft fehlzuschlagen.

`rebase generate-sdk` schreibt den Wert in `schema.meta.ts`; übergeben Sie ihn an
den Client, um ihn zu übermitteln:

```typescript
import { SCHEMA_VERSION } from "./generated/sdk/schema.meta";

const rebase = createRebaseClient<Database>({
    baseUrl: "http://localhost:3001",
    tables: tablesDictionary,
    schemaVersion: SCHEMA_VERSION,
});
```

Das Backend liest diesen Header bei jedem Datenaufruf aus. Ein Schema-Drift führt
niemals zur Ablehnung eines Aufrufs – ein SDK, das ein Schema hinterherhinkt, ist
meist dennoch kompatibel, und das Backend vor dem Frontend auszurollen ist die
übliche Deployment-Reihenfolge. Wenn ein Aufruf jedoch mit einem 400 oder 404
fehlschlägt, enthält der Fehler den Drift als Ursache:

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

Eine umbenannte Spalte wird so als „Ihr SDK ist veraltet, bitte neu generieren“
interpretiert und nicht als ein Feld, von dessen Existenz Ihre eigenen Typen
fälschlicherweise ausgehen. Ein erfolgreicher Request erfährt davon nichts.

Dies gilt **ausschließlich für Tabellen** – deren kompilierte Deskriptoren, in
denen ein Hook lediglich als Presence-Flag enthalten ist. Der Code eines Hooks
oder die Bearbeitung einer Funktion ändert den Vertrag des Clients nicht und darf
nicht jedes generierte SDK entwerten. Da 0.31 den Hash von Collections auf
Deskriptoren umgestellt hat, meldet jede mit `v1:` gestempelte Datenbank die
Änderung genau einmal bei der Neu-Stempelung (Boot des Schema-Owners oder
`rebase db push`), und jedes generierte SDK gilt einmalig als veraltet.

### Wer ruft an?

Zwei weitere Identifikationssignale, von denen keines für sich genommen den Zugriff
beschränkt:

- **`GET /api/meta/schema-version`** ist unauthentifiziert und antwortet mit der
  `schemaVersion` des Projekts *und* seiner `runtime` (`version` und `contract`).
  Ein CI-Job, der sein generiertes SDK mit einem Live-Projekt vergleicht, benötigt
  keine Zugangsdaten, ebenso wenig wie ein Client, der wissen möchte, mit welcher
  Runtime er kommuniziert.
- **`User-Agent: rebase-cli/<version>`** wird bei jedem `rebase cloud`-Request
  mitgesendet. Das Wire-Format der Control Plane entwickelt sich schneller als das,
  was auf npm veröffentlicht wird. Sie muss daher in der Lage sein, einem alten
  Client mit `CLI_TOO_OLD` und der Mindestversion zu antworten – was sie nur für
  Aufrufer tun kann, die sich zu erkennen geben.

### 6 — Abgeleitete Datenbank-Bezeichner

Jeder Name, den dieses Framework eigenständig ermittelt, anstatt ihn vorgegeben
zu bekommen: eine Foreign-Key-Spalte, ein Foreign-Key-Constraint, eine
Junction-Tabelle und ihre beiden Schlüsselspalten, ein Enum-Typ, ein Policy-Name,
die `snake_case`-Spalte eines `camelCase`-Spaltenschlüssels. Seit 0.31 werden
Tabellen mit `defineTable` deklariert, was exakt dieselben Namen ableitet, die eine
Collection für ein äquivalentes Schema abgeleitet hat; `rebase migrate collections-to-tables`
weist dies pro Projekt nach, indem das generierte SQL Byte für Byte verglichen wird.

> **Ein abgeleiteter Bezeichner ist in dem Moment eingefroren, in dem ein Release ihn ausgibt.**

Nicht „eingefroren bis zum nächsten Major-Release“ – sondern dauerhaft eingefroren.
Die Begründung unterscheidet sich von den anderen fünf Verträgen und wiegt
schwerer. Jene sind versioniert, sodass eine Diskrepanz *erkannt* und abgewiesen
werden kann. Dieser hier nicht: Der Name wird an dem Tag, an dem deployed wird,
in die Kundendatenbank geschrieben, und eine Spalte trägt keinen Versionsstempel.
Jede Datenbank, die jemals von einem ausgelieferten Release bereitgestellt wurde,
behält die Namen, die damals abgeleitet wurden, und kein Code in diesem Repository
kann eingreifen und sie alle nachträglich umbenennen.

Version 0.13 ist das Paradebeispiel dafür. `generateForeignKeyName` lernte,
unregelmäßige Pluralformen korrekt in den Singular zu überführen –
`categorie_id` → `category_id`, `addres_id` → `address_id` –, was unbestreitbar die
bessere Namensableitung darstellt, jedoch jede bestehende Datenbank mit einem
unregelmäßigen Plural beschädigte. Boot-Ensure migrierte die Spalte, die Daten
blieben also erhalten; die im Projekt eingecheckte `schema.generated.ts` tat dies
jedoch nicht, und der Boot-Vorgang schlug an einer Spalte fehl, die vorhanden war.
Drei Commits, ein neuer Nahtstellentest und ein dauerhafter Eintrag in den
Upgrade-Hinweisen – im Austausch für einen schöner aussehenden Spaltennamen, nach
dem niemand gefragt hatte.

**Wenn eine Ableitung nachweislich fehlerhaft ist**, wird sie für Tabellen
geändert, die *danach* erstellt werden, gesteuert über eine im Projekt
hinterlegte Namensstrategie – niemals rückwirkend und niemals als Nebeneffekt
einer Optimierung der zugrundeliegenden Funktion.

**Die einzige legitime Ausnahme** ist eine Änderung, die den Code mit einem Namen
in Einklang bringt, den die Datenbank *bereits besitzt*. Das Praxisbeispiel ist
die Kürzung von Bezeichnern: Postgres kürzt Bezeichner stillschweigend auf 63
Bytes, sodass ein längerer abgeleiteter Constraint-Name im Katalog niemals so
hieß – die Ableitung beschrieb ein Objekt, das unter dieser Schreibweise gar
nicht existierte, und Boot-Ensure führte bei jedem einzelnen Start erneut
`ADD CONSTRAINT` aus, da der Vergleich niemals zutreffen konnte. Eine Kürzung bei
der Erstellung ändert, was dieses Repo *ableitet*, und ändert absolut nichts daran,
was eine bereitgestellte Datenbank *enthält*. Das ist das anzuwendende Kriterium:
nicht „ist der neue Name besser“, sondern „muss sich eine bestehende Datenbank
ändern“.

Der andere Fall, in dem sich ein Name ändern darf, ist eine Gruppe von Namen, die
niemals alle gleichzeitig existieren konnten. Eine Regel über mehrere Operationen
auf einer Tabelle mit 42 Bytes oder mehr leitete
`<table>_default_admin_write_insert`, `_update` und `_delete` ab, und alle drei
wurden auf dieselben 63 Bytes gekürzt. Postgres speicherte eine einzige Policy,
DELETE, und verweigerte jedes Admin-INSERT und -UPDATE. Nur wenn die Namen einer
Regel auf diese Weise kollidieren, werden sie Suffix-orientiert abgeleitet, als
`<head>_<hash8>_<op>`. Jeder Name, der heute funktioniert, behält seine
Schreibweise. Beim nächsten Boot oder Push wird die eine abgeschnittene Policy
entfernt und eine Policy für jede Operation angelegt.

Was immer sicher ist: einen alten Namen zu *erkennen*, um ihn zu migrieren.
`legacyForeignKeyName` existiert, um erkannt zu werden, niemals um generiert zu
werden, und die Baseline fixiert auch diese Erkennungen. Das Entfernen einer
Erkennung würde jede Datenbank, die diese Schreibweise noch nutzt, stillschweigend
wieder in einen unmigrierten Zustand versetzen.

**Das Gate.** `tooling/scripts/derived-names.mts` schleust eine Naming-Stress-Fixture
– unregelmäßige Pluralformen, eine `ss`-Endung, ein Akronym, eine Junction über
einen Plural-Slug, explizite Overrides, ein Slug, der lang genug ist, um gekürzt
zu werden – durch beide Generatoren für Schema-DDL und gibt jeden Bezeichner aus,
den einer von beiden erzeugt:

```bash
pnpm check:derived-names
```

Eine geänderte oder entfernte Zeile schlägt als Vertragsbruch fehl, wobei die alte
und neue Schreibweise nebeneinander dargestellt werden. Eine rein additive Änderung
schlägt ebenfalls fehl, jedoch mit dem Hinweis „regenerate“ – damit die Baseline
nicht unbemerkt abdriften kann.

Es stellt außerdem sicher, dass `rebase db push` und das Boot-Ensure der Managed
Runtime dieselben Namen ableiten – was einen zweiten Vertrag darstellt, der im
ersten verborgen liegt: Beide kompilieren dieselben Tabellen über unterschiedlichen
Code, und ein Projekt, das einmal per Push übertragen und später gebootet wird, darf
nicht am Ende zwei verschiedene Schemata aufweisen.

## Was *nicht* eingefroren ist

Klar und deutlich formuliert, damit niemand ein Versprechen hineininterpretiert,
das nie gegeben wurde:

- Die bereitgestellte TypeScript-API — `defineTable` und `customizeTable`,
  `initializeRebaseBackend`-Optionen, Admin-Props, SDK-Methodennamen. Version 0.31
  hat Collections in einem Minor-Release durch Tables ersetzt, mit einem Codemod,
  der belegt, dass das generierte SQL unverändert bleibt. Breaking Changes erfolgen
  in Minor-Releases und werden im Changelog angekündigt.
- `@rebasepro/studio`, `@rebasepro/mcp`, `@rebasepro/inference`,
  `@rebasepro/plugin-*` — diese entwickeln sich am schnellsten und haben die
  wenigsten Verwender.
- Alles unterhalb des `src/` eines Pakets, das nicht aus dessen Barrel re-exportiert
  wird. `packages/client/src/index.ts` enthält einen Hinweis, der erklärt, dass
  seine Export-Liste genau deshalb kuratiert ist, damit ein interner Export nicht
  versehentlich öffentlich werden kann.
- Das Datenbankschema *Ihrer* Tabellen. Das gehört Ihnen; Rebase besitzt nur das
  `rebase`-Schema (und bei einer vor 0.13 bereitgestellten Datenbank das alte
  `auth`-Schema, bis das Booten dieses ablöst).

## Die Gates, die diese Verträge absichern

Nichts von alledem ist bloße Konvention – hinter jedem Punkt steht ein Test, der
fehlschlägt, sobald er verletzt wird:

| Gate | Was es absichert |
|---|---|
| `pnpm verify:corpus` | Jede Bundle-Form, die jemals ausgeliefert wurde, gestartet auf der heutigen Runtime. Fixtures in `tests/fixtures/bundles/` sind **manuell erstellt und eingefroren** — ein Fixture, das der Builder neu generiert, würde sich jedes Mal verändern, wenn sich der Builder ändert |
| `pnpm verify:selfhost` | Ein echtes Bundle, gebaut, zusammengefasst, gebootet und abgerufen, wie es ein Browser tun würde |
| `upgrade-e2e.test.ts` | Alte Datenbankschemata (`schema-snapshots/`), verarbeitet durch die aktuelle Runtime |
| `tests/e2e/tests/cli-init-e2e.ts` | Ein Scaffold-Projekt, installiert aus **echten Tarballs**, nicht aus Workspace-Links |
| `tests/e2e/tests/client-sdk-e2e.ts` | Der Endbenutzer-Pfad: Registrieren → Anmelden → RLS-bezogene Lesevorgänge → Refresh → Storage → Realtime |
| `pnpm check:derived-names` | Jeder Spalten-, Constraint-, Junction-, Enum- und Policy-Name, den das Framework ableitet – und dass Boot und `db push` diese identisch ableiten |
| `pnpm rls:check` | Die Policies des generierten Schemas |
| `pnpm check:api-surface` | Jeder Export und dessen Member der fünf Pakete, die das Image bereitstellt — `@rebasepro/server`, `types`, `client`, `common`, `utils` — plus der Einstiegspunkt `@rebasepro/server/functions`, abgeglichen gegen die sechs Abschnitte von `contracts/server.api.txt`. Dies sind die Pakete, die `infra/docker/entrypoint.mjs` per Symlink über die eigenen Kopien eines bereitgestellten Bundles legt. Das Entfernen eines Exports aus einem dieser Pakete führt bei niemandem zu einem Kompilierfehler — sondern zu einem Boot-Fehler in der gesamten Flotte während eines Rollouts, den niemand angefordert hat |
| `pnpm test:gates` | Die eigenen Tests der Gates anhand von Fixtures — 47 Dateien, darunter `check:api-surface` und die unten beschriebene Release-Bump-Prüfung —, sodass ein Gate, das den zu schützenden Bereich nicht mehr erfasst, hier fehlschlägt. `check:api-surface` konnte während seiner gesamten bisherigen Laufzeit nicht feststellen, wenn ein Member aus `const rebase` verschwand |
| `node tooling/scripts/check-release-bump.mjs` | Dass die Bump-Stufe, unter der ein Release ausgeliefert wird, zu den Änderungen passt, die das Release an den obigen Baselines vorgenommen hat — ausgeführt von `publish.yml`, bevor das Changelog gestempelt wird |
| saas CI | Die Control Plane, gebaut gegen den `main`-Branch dieses Repositories, bei eigenen Pushes und nächtlich |

**Erstellen Sie pro Release genau einmal ein Bundle-Fixture und einen Schema-Snapshot.**
Der Wert beider Sammlungen hängt ausschließlich davon ab, wie weit die älteste
Version zurückreicht, und keine von beiden kann im Nachhinein rekonstruiert werden.

### Noch nicht durch Gates abgesichert

Die obige Tabelle zeigt, was abgesichert ist. Dies sind die Teile der Richtlinie,
die noch von keinem Gate geschützt werden – aufgeführt, damit niemand unberechtigte
Zusagen hineinliest:

- **Keine Deprecation- oder Support-Fristen.** Solange Rebase `0.x` ist, gibt es
  keine schriftliche Regelung darüber, wie lange ein als deprecated markierter
  Export vor seiner Entfernung erhalten bleibt oder wie lange ein älteres
  Minor-Release Fixes erhält. Sicherheitsfixes fließen ausschließlich in das
  neueste Minor-Release ein.
- **Das HTTP-Wire-Format besitzt kein Gate.** Kein `check:*`-Skript vergleicht
  Request- und Response-Formate mit einer Baseline, so wie `check:api-surface`
  Exporte vergleicht; ein geändertes Response-Format wird nur von einer e2e-Suite
  bemerkt, die dieses Format zufällig ausliest.
- **CLI-Flags besitzen keine Kompatibilitäts-Baseline.** Der Docs-Verifier schlägt
  fehl, wenn ein Flag verschwindet, das die Skills, Beispiele oder die Marketing-Website
  verwenden; ansonsten bemerkt nichts das Verschwinden eines Flags oder die
  Bedeutungsänderung eines Flags.
- **Ein CI-Release erfasst keinen der beiden Korpora.** Der Publish-Workflow
  zeichnet weder ein Bundle-Fixture noch einen Schema-Snapshot auf; nur das lokale
  Release-Skript versucht dies und warnt lediglich, statt abzubrechen, falls es
  nicht möglich ist. Die Versionen 0.18 bis 0.21 besitzen keinen aufgezeichneten
  Projekt-Snapshot.
- **Die Export-Oberfläche ist ein Gate, kein Vertrag.** Ob die öffentlichen
  Exporte der von der Runtime bereitgestellten Pakete zu einem siebten nummerierten
  Vertrag werden – deklariert als die Baseline von `check:api-surface`, additiv
  kompatibel innerhalb eines Vertrags-Majors –, ist eine offene Entscheidung.

## Einen Vertrag ändern

1. Entscheiden Sie, um welchen der sechs Verträge es sich handelt. Die meisten
   Änderungen betreffen keinen von ihnen – doch „keiner der sechs“ bedeutet nicht
   „unkritisch“. Das Entfernen oder Umbenennen eines Exports von `@rebasepro/server`
   oder eines Members davon betrifft keinen der sechs und ist die gefährlichste
   Änderung im gesamten Repository, da der Code, der dadurch bricht, bereits gebaut
   ist und nicht neu kompiliert wird. `pnpm check:api-surface` ist der Mechanismus,
   der diese Grenze absichert; ob daraus ein siebter nummerierter Vertrag wird,
   ist eine offene Entscheidung (siehe *Noch nicht durch Gates abgesichert* oben).
2. Fügen Sie zuerst ein Fixture oder einen Snapshot für die **alte** Form hinzu
   und vergewissern Sie sich, dass der Test erfolgreich durchläuft.
3. Nehmen Sie die Änderung vor und erhöhen Sie die Konstante.
4. Bestätigen Sie, dass das alte Fixture weiterhin erfolgreich durchläuft oder
   dass es nun *mit genau der Meldung fehlschlägt, die ein Benutzer benötigt*.
   Beides sind gültige Ergebnisse; stilles Fehlverhalten ist es nicht.
5. Planen Sie bei Vertrag 3 den Rebuild jedes bereitgestellten Bundles vor dem Mergen.
6. Vertrag 6 ist die Ausnahme zu den Schritten 3 und 4: Es gibt keine Konstante,
   die erhöht werden könnte, und keine Version, anhand derer abgewiesen werden
   könnte, da eine Spalte keinen Versionsstempel trägt. Der Schritt, der sie ersetzt,
   besteht darin, zu entscheiden, die Änderung nicht vorzunehmen – siehe den
   obigen Abschnitt darüber, wie die Alternative aussieht.

## Verwandte Themen

- [Upgrading](/docs/upgrading/) — Was sich von Release zu Release tatsächlich geändert hat
- [Changelog](/docs/changelog/) — Jede Änderung, einschließlich derjenigen, die abwärtskompatibel waren
- [Runtime & Bundles](/docs/architecture/runtime-and-bundles/) — Vertrag 3 — Das Bundle-Format, gegen das ein bereitgestelltes Projekt bereits gebaut ist
