---
sourceHash: 448871502e7447b5
slug: de/docs/compatibility
title: Kompatibilität
description: Was Rebase über Versionen hinweg verspricht und was nicht — die sechs versionierten Verträge, wie jeder einzelne fehlschlägt und was sich in einem Minor-Release noch ändern kann.
---

Was Rebase über Versionen hinweg verspricht und was nicht.

Dies ist das Dokument, das Sie lesen sollten, bevor Sie etwas ändern, wovon ein deploytes Projekt oder ein laufender Rebase Cloud-Tenant bereits abhängt. Es ist auch die ehrliche Antwort auf die Frage: „Wenn ich heute auf Rebase aufbaue, was bricht später unter mir weg?“

## Was „Beta“ hier bedeutet

Rebase befindet sich in der Public Beta. Die meisten Projekte verwenden dieses Wort im Sinne von „alles kann kaputtgehen“, was Lesern keinerlei Planungssicherheit gibt. Hier ist die Grenze, die dieses Projekt tatsächlich zieht:

> **Die API, gegen die Sie entwickeln, kann sich in einem Minor-Release ändern – mit einem Eintrag im Changelog.
> Ihre Daten können nicht still und leise kaputtgehen.**

Die erste Hälfte ist gewöhnliches `0.x`-Verhalten und wird weiter unten beschrieben. Die zweite Hälfte ist der Teil, den es zu prüfen lohnt, da es sich um eine Aussage über Mechanismen und nicht über Absichten handelt: Die versionierten Verträge im nächsten Abschnitt sind jeweils in ein Artefakt oder eine Datenbank gestempelt, jeder wird beim Booten oder beim Intake überprüft und jeder **schlägt laut und spezifisch fehl**, anstatt stillschweigend zu degradieren. Ein Schema-Push, der eine Spalte löschen würde, wird durch ein Destructive Gate (`packages/server-postgres/test/e2e/db-push-safety.test.ts`) verweigert, und der Upgrade-Pfad selbst ist ein Test: `upgrade-e2e.test.ts` stellt Datenbanken so wieder her, wie ältere Releases sie hinterlassen haben, wendet den aktuellen Migrationspfad auf jede einzelne an und stellt sicher, dass die Zeilen überleben – nicht nur, dass das Booten erfolgreich war.

Was Beta tatsächlich bedeutet: Features fehlen noch, manche Subsysteme sind neuer als andere, und Ecken und Kanten äußern sich darin, dass etwas fehlt oder umständlich ist, nicht darin, dass etwas stillschweigend beschädigt wird. Welcher Zustand für welches Subsystem gilt, wird datiert veröffentlicht, anstatt es den Nutzern zur Entdeckung zu überlassen – die folgende Tabelle ist diese Veröffentlichung.

## Reifegrad nach Subsystem

**Zuletzt überarbeitet am 14. September 2026, bezogen auf 0.21.0.** Lesen Sie dies bei jedem Minor-Release erneut; eine Einstufung, die sich seit drei Releases nicht verändert hat, ist entweder gefestigt oder vergessen, und dieser Hinweis dient dazu, diesen Unterschied zu überprüfen.

Die drei Einstufungen bedeuten:

- **Stable** — Die Form ist gefestigt und durch ein Gate in CI abgedeckt. Es können weiterhin Features hinzukommen; es wird innerhalb von 0.x nicht grundlegend umgestaltet, und eine Änderung, die Sie beeinträchtigen würde, wird im Changelog angekündigt.
- **Beta** — Es funktioniert und wird in der Produktion eingesetzt, und es ist bekannt, dass manche Aspekte noch ungeschliffen sind: ein Limit, das erreicht werden kann, eine umständliche Kante, eine noch nicht getroffene Designentscheidung. Der ungeschliffene Teil wird in den Anmerkungen benannt, denn „Beta“ allein bietet keine Planungsgrundlage.
- **Experimental** — Veröffentlicht, damit es verwendet und Feedback gegeben werden kann. Rechnen Sie damit, auf Bereiche zu stoßen, die noch niemand betreten hat.

| Subsystem | Einstufung | Worauf die Einstufung basiert |
|---|---|---|
| REST-API + generiertes SDK | Stable | Der Wire-Vertrag ist versioniert und gegatet; `client-sdk-e2e` steuert register → sign-in → RLS-bezogene Lesevorgänge → refresh → storage → realtime durchgängig end-to-end |
| Auth — E-Mail/Passwort, OAuth, OIDC, Magic Link, Einmalcode | Stable | Zwölf OAuth-Provider werden mitgeliefert. Das Auth-Schema ist ein versionierter Vertrag, der beim Booten gestempelt und geprüft wird |
| Auth — MFA (TOTP) | Beta | Registrierung (Enrolment), Verifizierung und Wiederherstellung funktionieren und sind getestet. Schlüsselrotation ist für den Verschlüsselungsschlüssel implementiert; es gibt keine Admin-Oberfläche zum Zurücksetzen des Faktors eines ausgesperrten Benutzers |
| Row-Level Security | Stable | Der Dreh- und Angelpunkt des Produkts. `pnpm rls:check` prüft eine Live-Datenbank anhand von fünfzehn Checks, und die RLS-E2E-Suite läuft bei jedem Push |
| Storage | Stable | Lokal, S3 und GCS. Default-Deny in der Produktion seit 0.17.0, und das Scaffold liefert einen Authorize-Hook mit |
| Realtime | **Beta** | Subscriptions werden ausschließlich über den Collection-Pfad abgeglichen, sodass N Abonnenten auf einer Collection N RLS-bezogene Refetches pro Schreibvorgang kosten. Das begrenzt ein Deployment auf wenige hundert gleichzeitige Abonnenten. Korrekt bei jeder Größenordnung; teuer jenseits dieses Limits |
| Vektorsuche (pgvector) | Beta | Jede Vektorspalte erhält standardmäßig einen HNSW-Index für Kosinus-Distanz, der über `VectorIndexConfig` pro Property anpassbar ist (Methode, Distanzen, Build-Parameter) oder deaktiviert werden kann, was einen exakten Scan hinterlässt. pgvector kann Spalten mit mehr als 2.000 Dimensionen nicht indizieren, daher bleiben diese unindiziert und nutzen einen Scan |
| Offline-Synchronisierung | Beta | Mutationen enthalten Idempotenzschlüssel, die der Server berücksichtigt, und die im Juli-Audit gefundenen Datenverlustfehler wurden behoben. Das Konfliktmodell ist Last-Write-Wins ohne Merge auf Feldebene |
| Entity-Historie | Stable | Snapshot-basiert, abgesichert durch eine eigene Test-Suite |
| Functions und Crons | Stable | Der portable Einstiegspunkt (`@rebasepro/server/functions`) ist ein versionierter Vertrag mit einem eigenen API-Surface-Abschnitt |
| MCP-Server + Agent Skills | Beta | `@rebasepro/mcp` läuft über stdio: 53 Tools, Bearer-Auth pro Projekt, destruktive Tools verweigern nicht-lokale Ziele, sofern nicht explizit aktiviert. Seit 0.21 kann der Server auch einen Remote-Endpunkt `/mcp` mounten — OAuth 2.1, neun Daten-Tools, jeder Aufruf unter dem RLS der angemeldeten Person — standardmäßig deaktiviert, es sei denn `REBASE_MCP_ENABLED=true`, und nur für Postgres |
| Studio (SQL, Schema, RLS, API-Explorer) | Beta | Täglich in echten Projekten im Einsatz. Branching ist im OSS-Paket vorhanden und wird in Rebase Cloud bewusst nicht bereitgestellt, da das Verschieben eines laufenden Deployments auf einen Branch noch kein definiertes Konzept hat |
| CMS + Admin-Panel | Beta | Vollständig für CRUD, Relationen, Storage-Felder und Rollen. **Die Datentabelle besitzt keine Grid-Semantik** — keine `role`, kein `aria-rowindex`, `tabIndex` entfernt — daher können Tastatur- und Screenreader-Benutzer die Hauptansicht nicht bedienen. Keine Entwürfe, keine Inhalte pro Locale, kein Block-Rich-Text |
| Verwaltete PGlite-Entwicklungsdatenbank | Beta | Zero-Setup `rebase dev` ohne Docker. Jeweils nur eine Session, daher serialisieren Anfragen und Nebenläufigkeit kann damit nicht reproduziert werden; auf Atlas basierende Befehle (`db push`, `generate`, `migrate`) planen gegen eine zweite, temporäre PGlite-Instanz, die für den Befehl gestartet wird (unter 0.24 verweigern sie die verwaltete Datenbank); `db branch` funktioniert dort nicht und weist darauf hin |
| Helm-Chart | Beta | Rendert die Split-Process-Topologie und wird bei jedem Release in der OCI-Registry veröffentlicht. Der Standard bleibt ein einzelner Container |
| `@rebasepro/server-mongo` | **Experimental** | Ein funktionierender Treiber mit Change-Stream-Echtzeit und Snapshot-Historie. **Keine Row-Level Security** — das gesamte oben beschriebene Isolationsmodell gilt hierfür nicht — und keine Relationen. Change Streams erfordern ein Replica Set: Auf einem Standalone-`mongod` gibt es keinen Ersatz dafür, sodass eine Subscription nur Schreibvorgänge sieht, die über diesen Rebase-Prozess getätigt wurden, und alle anderen verpasst. Kein MFA: Registrierung antwortet mit 501 und die Prüfungen mit „no factor“, sodass beim Anmelden nie danach gefragt wird. Das Admin-Aggregat kann keine Collection ansprechen — es liest den Namen aus einer `$from`-Stage, die MongoDB nicht besitzt —, daher gibt es nichts zurück |
| `@rebasepro/firebase` | Experimental | Führt das Admin-Panel und SDK gegen Firestore aus. Kein RLS, keine SQL-Oberfläche; der Postgres-Funktionsumfang überträgt sich nicht. Der Firestore-Treiber ignoriert `or(...)`/`and(...)`-Filtergruppen, sodass eine Abfrage, die eine solche verwendet, jede Zeile liest, die ihre einfachen Filter zulassen |
| Rebase Cloud | **Private Beta** | Live, betreibt echte Mandanten, Freischaltung in Batches. Kein Self-Service |

Zwei Einträge oben sind der ehrliche Preis für die Veröffentlichung dieser Tabelle überhaupt: Das Refetching in Realtime und die Barrierefreiheit der Datentabelle sind offene Mängel, keine Roadmap-Punkte, und beide werden aufgeführt, anstatt darauf zu warten, dass ein Leser sie selbst entdeckt.

Diese Tabelle zeigt, was existiert. Was es noch nicht gibt, steht auf der [Roadmap](https://rebase.pro/roadmap), ein Eintrag pro GitHub-Issue, wobei die für Version 1.0 erforderliche Teilmenge gekennzeichnet ist.

## Das 0.x-Versprechen

Rebase ist `0.x`. Dieser Abschnitt ist so verfasst, dass er für jedes 0.x-Release gilt und nicht nur für ein bestimmtes, damit er nicht mit jedem Schnitt veraltet. **Breaking Changes an der geschriebenen TypeScript-API sind in Minor-Releases weiterhin zulässig**, und sie werden im Changelog angekündigt. Was *nicht* stillschweigend kaputtgehen darf, ist die Reihe der unten aufgeführten versionierten Verträge: Jeder einzelne ist in ein Artefakt oder eine Datenbank gestempelt, jeder wird beim Booten oder beim Intake überprüft und jeder schlägt **laut und spezifisch fehl**, anstatt stillschweigend zu degradieren.

Diese Unterscheidung macht das gesamte Versprechen aus. Ein umbenannter Export kostet Sie einen Kompilierfehler und fünf Minuten. Ein Bundle, das gegen die falsche Runtime bootet und subtil falsche Daten ausliefert, kostet Sie einen Incident – und die Verträge existieren, damit die zweite Kategorie niemals still und leise auftreten kann.

Rebase Cloud nutzt exakt diese Verträge und nichts anderes. Alles, was hier nicht aufgeführt ist, ist ein Implementierungsdetail, von dem die Plattform nicht abhängt.

### Versions-Badges und Canaries

Die Dokumentation wird aus `main` veröffentlicht, daher kann eine Seite etwas beschreiben, das noch kein stabiles Release enthält. Ein *Since*-Badge nennt das erste stabile Release, das die Funktion enthält, und der Text daneben beschreibt, wie sich das Release davor verhält.

Ein Canary ist ein Build von `main`, nummeriert nach dem Release, auf das er zusteuert: `0.25.0-canary.g<commit>` ist `main` auf diesem Commit, nach 0.24.0 und vor 0.25.0, und `rebase upgrade --to canary` installiert die neueste Version. Er enthält alles, was zum Zeitpunkt des Builds auf `main` gelandet war, sodass ein Badge mit dieser Version (Since 0.25) für Sie gilt, und die Anmerkung zum vorherigen Release (unter 0.24) das stabile Release beschreibt, von dem Sie kamen. Canaries vor 0.25.0 wurden stattdessen nach dem letzten Release nummeriert: `0.24.1-canary.g<commit>` ist ebenfalls eine Vorschau auf 0.25.

## Die versionierten Verträge

Die folgenden Werte werden aus dem Quellcode ausgelesen; betrachten Sie die Dateireferenzen als die Wahrheit und diese Tabelle als die Karte.

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
| 5 | `manifest.schemaVersion` | ausgegeben von `rebase build` | vom SDK als `x-rebase-schema` gesendet, wenn konfiguriert | informativ — identifiziert, gegen welches Schema ein Client gebaut wurde |
| 6 | Abgeleitete Datenbank-Identifier | `contracts/derived-names.txt` | `pnpm check:derived-names` | **eingefroren** — ein Name, den ein Release ausgegeben hat, wird niemals neu abgeleitet |

### 1 — `rebase` in `rebase.json`

Ein SemVer-Bereich, der ähnlich wie `engines` in einer `package.json` gelesen wird: welche Runtime-Versionen dieses Projekt akzeptiert. Er heißt bewusst `rebase` statt `runtime`, da `runtime` bei einer App bereits bedeutet, *wer den Prozess besitzt* (`managed` | `custom`).

### 2 — `BUNDLE_FORMAT_VERSION` (aktuell 2)

Das On-Disk-Layout eines gebauten Bundles. Eine Runtime akzeptiert jedes Bundle, dessen Format **kleiner oder gleich** dem eigenen ist. Dadurch kann der Managed-Tier einen Mandanten auf ein neues Image umziehen, ohne dass jemand sein Projekt neu bauen muss.

- **1** — `mode: "cms" | "baas" | "static"`, `entry.static` ein einzelnes Verzeichnis, `entry.admin` für ein gebündeltes Admin.
- **2** — `kind: "backend" | "static"`, `entry.static` eine Liste, `entry.admin` entfernt. Format 1 wird weiterhin über `upgradeLegacyManifest` gelesen.

**Erhöhen (bump), wenn** sich das Layout so ändert, dass eine ältere Runtime ein neueres Bundle falsch interpretieren würde. Die Erhöhung verwandelt ein „bootet und liefert nichts aus“ in eine Startverweigerung.

### 3 — `RUNTIME_CONTRACT_VERSION` (aktuell 1)

Die Hauptversion (Major) des Bundle↔Runtime-Vertrags. Zu unterscheiden von der Paketversion von `@rebasepro/server`, von der beliebig viele Minors und Patches veröffentlicht werden können, während diese unverändert bleibt.

**Lesen Sie dies, bevor Sie es anfassen.** Die Prüfung lautet `!==`, nicht `>`:

> Ein Bundle, das auf Vertrag *N* abzielt, läuft **ausschließlich** auf einer Runtime, die *N* implementiert

Eine Erhöhung macht also **jedes jemals gebaute Bundle** auf einen Schlag ungültig, bis jedes einzelne neu gebaut wird. Das ist die beabsichtigte Härte — es ist der Hebel für „hier kann nichts Altes laufen“ —, aber es bedeutet auch, dass ein Bump eine flottenweite Migration erfordert und keine bloße Release-Notiz ist. Für den Managed-Tier muss dies mit einem Rebuild der Bundles jedes Mandanten abgestimmt werden.

Wenn eine Änderung *additiv* ist und alte Bundles weiterhin korrekt wären, gehört sie zu `BUNDLE_FORMAT_VERSION` (oder überhaupt nicht versioniert), nicht hierhin.

### 4 — `AUTH_SCHEMA_VERSION` (aktuell 2)

Wird in `rebase.schema_meta` gestempelt und beim Booten verglichen. Eine Runtime **verweigert den Start** gegen eine Datenbank, die von einer neueren Framework-Version migriert wurde, anstatt auf einer Struktur zu operieren, die sie nicht versteht – bei einem Rolling Deploy ist das der Unterschied dazwischen, ob die halbe Flotte Fehler wirft oder die halbe Flotte Daten korrumpiert.

Die Vorwärtsmigration erfolgt automatisch: `ensureAuthTablesExist` aktualisiert eine ältere Datenbank. Beachten Sie, dass dieser Migrationsblock bewusst in `try/catch` gekapselt ist und loggt, anstatt einen Fehler zu werfen – ein humpelnder Boot ist besser als ein Crash-Loop –, sodass **„es hat gebootet“ nichts beweist**. Jede Assertion in der Upgrade-Suite liest stattdessen den Katalog oder die Daten.

**Erhöhen (bump), wenn** eine Migration von einer älteren Runtime keinesfalls übersprungen werden darf. Erhöhen Sie sie nicht für eine additive, abwärtskompatible Spalte; ein detailliertes Beispiel für diese Abwägung findet sich in `packages/server-postgres/src/auth/ensure-tables.ts`.

### 5 — `manifest.schemaVersion`

Ein Hash der kompilierten Collection-Definitionen, der in das Bundle-Manifest ausgegeben und von einem generierten SDK im Header `x-rebase-schema` (`SCHEMA_VERSION_HEADER`) zurückgesendet wird. Er existiert, damit die Plattform melden kann: „Diese App wurde für ein älteres Schema gebaut“, anstatt bei der ersten Anfrage rätselhaft fehlzuschlagen.

`rebase generate-sdk` schreibt den Wert in `schema.meta.ts`; übergeben Sie ihn an den Client, um ihn zu senden:

```typescript
import { SCHEMA_VERSION } from "./generated/sdk/schema.meta";

const rebase = createRebaseClient<Database>({
    baseUrl: "http://localhost:3001",
    collections: collectionsDictionary,
    schemaVersion: SCHEMA_VERSION,
});
```

Das Backend liest diesen Header bei jeder Datenanfrage. Ein Drift verweigert niemals einen Aufruf — ein SDK, das ein Schema hinterherhinkt, ist in der Regel immer noch kompatibel, und das Ausrollen des Backends vor dem Frontend ist die normale Bereitstellungsreihenfolge —, aber wenn eine Anfrage mit einem 400 oder 404 fehlschlägt, enthält der Fehler den Drift als Ursache:

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

So liest sich eine umbenannte Spalte als „Ihr SDK ist veraltet, generieren Sie es neu“ und nicht als ein Feld, von dessen Existenz die eigenen Typen felsenfest überzeugt sind. Eine erfolgreiche Anfrage erfährt davon nichts.

Es deckt **ausschließlich Collections** ab. Das Bearbeiten eines Hooks oder einer Function ändert den Vertrag des Clients nicht und darf nicht jedes generierte SDK entwerten.

### Wer der Aufrufer ist

Zwei weitere Identifikationssignale, von denen keines für sich allein als Gate fungiert:

- **`GET /api/meta/schema-version`** erfordert keine Authentifizierung und antwortet mit der `schemaVersion` des Projekts *und* seiner `runtime` (`version` und `contract`). Ein CI-Job, der sein generiertes SDK mit einem Live-Projekt vergleicht, benötigt keine Anmeldedaten – ebenso wenig wie ein Client, der anfragt, mit welcher Runtime er kommuniziert.
- **`User-Agent: rebase-cli/<version>`** wird bei jeder `rebase cloud`-Anfrage mitgesendet. Das Wire-Format der Control Plane eilt dem voraus, was auf npm veröffentlicht ist, daher muss sie in der Lage sein, einem alten Client mit `CLI_TOO_OLD` und der Mindestversion zu antworten – was sie nur für Aufrufer tun kann, die sich zu erkennen geben.

### 6 — Abgeleitete Datenbank-Identifier

Jeder Name, den dieses Framework selbst ermittelt, anstatt ihn explizit vorgegeben zu bekommen: eine Fremdschlüsselspalte, ein Foreign-Key-Constraint, eine Junction-Tabelle und ihre beiden Schlüsselspalten, ein Enum-Typ, ein Policy-Name, die `snake_case`-Spalte einer `camelCase`-Eigenschaft.

> **Ein abgeleiteter Identifier ist in dem Moment eingefroren, in dem ein Release ihn ausgibt.**

Nicht „eingefroren bis zum nächsten Major-Release“ — eingefroren. Die Begründung unterscheidet sich von den anderen fünf Verträgen und ist gewichtiger. Jene sind versioniert, sodass eine Diskrepanz *erkannt* und abgewiesen werden kann. Dieser hier nicht: Der Name wird an dem Tag in die Datenbank eines Kunden geschrieben, an dem er deployt, und auf einer Spalte existiert kein Versionsstempel. Jede Datenbank, die von irgendeinem jemals veröffentlichten Release bereitgestellt wurde, enthält genau das, was damals abgeleitet wurde, und kein Code in diesem Repository kann eingreifen und sie alle umbenennen.

0.13 ist das Paradebeispiel dafür. `generateForeignKeyName` lernte, korrekte Singularformen zu bilden — `categorie_id` → `category_id`, `addres_id` → `address_id` —, was unbestreitbar die bessere Ableitung ist, und es zerstörte jede ältere Datenbank mit unregelmäßigen Pluralen. Boot-Ensure migrierte die Spalte, sodass die Daten überlebten; das im Projekt eingecheckte `schema.generated.ts` tat dies nicht, und das Booten scheiterte an einer Spalte, die eigentlich existierte. Drei Commits, ein neuer Seam Test und ein dauerhafter Eintrag in den Upgrade-Hinweisen – als Gegenwert für einen schöner aussehenden Spaltennamen, nach dem niemand gefragt hatte.

**Wenn eine Ableitung wirklich falsch ist**, ändert sie sich nur für Collections, die *danach* erstellt werden, hinter einer im Projekt hinterlegten Naming Strategy – niemals rückwirkend und niemals als Nebeneffekt einer Verbesserung der zugrunde liegenden Funktion.

**Die einzige legitime Ausnahme** ist eine Änderung, die den Code mit einem Namen in Einklang bringt, den die Datenbank *bereits besitzt*. Das Paradebeispiel ist das Abschneiden von Identifiern: Postgres kürzt einen Identifier stillschweigend auf 63 Bytes. Ein längerer abgeleiteter Constraint-Name war also nie der tatsächliche Name im Katalog – die Ableitung beschrieb ein Objekt, das unter dieser Schreibweise gar nicht existierte, und Boot-Ensure führte bei jedem einzelnen Bootvorgang erneut `ADD CONSTRAINT` aus, weil der Vergleich niemals übereinstimmen konnte. Das Abschneiden bei der Konstruktion ändert, was dieses Repo *ableitet*, ändert aber rein gar nichts daran, was eine deployte Datenbank *enthält*. Das ist der Maßstab, den man anlegen muss: Nicht „ist der neue Name besser?“, sondern „muss sich irgendeine bestehende Datenbank ändern?“.

Der andere Fall, in dem sich ein Name ändern darf, betrifft eine Gruppe von Namen, die unmöglich alle gleichzeitig existieren konnten. Eine Regel, die sich über mehrere Operationen auf einer Tabelle mit 42 oder mehr Bytes erstreckte, leitete `<table>_default_admin_write_insert`, `_update` und `_delete` ab, und alle drei wurden auf dieselben 63 Bytes abgeschnitten. Postgres speicherte eine einzige Policy, DELETE, und verweigerte jedes Admin-INSERT und -UPDATE. Nur wenn die Namen einer Regel auf diese Weise kollidieren, werden sie Suffix-zuerst als `<head>_<hash8>_<op>` abgeleitet. Jeder Name, der heute funktioniert, behält seine Schreibweise. Beim nächsten Boot oder Push wird die eine abgeschnittene Policy gelöscht und für jede Operation eine eigene Policy erstellt.

Die eine Sache, die immer sicher ist: einen alten Namen zu *erkennen*, um ihn zu migrieren. `legacyForeignKeyName` existiert, um erkannt zu werden, niemals um generiert zu werden, und die Baseline fixiert diese Erkennungen ebenfalls. Das Entfernen einer solchen Erkennung macht stillschweigend die Migration jeder Datenbank rückgängig, die diese Schreibweise noch verwendet.

**Das Gate.** `tooling/scripts/derived-names.mts` schleust ein Naming-Stresstest-Fixture — unregelmäßige Plurale, eine `ss`-Endung, ein Akronym, eine Junction über einen Plural-Slug, explizite Overrides, ein Slug, der lang genug ist, um abgeschnitten zu werden — durch beide Generatoren von Schema-DDL und gibt jeden Identifier aus, den einer von beiden benennt:

```bash
pnpm check:derived-names
```

Eine geänderte oder entfernte Zeile schlägt als Vertragsbruch fehl, wobei die alte und die neue Schreibweise nebeneinander dargestellt werden. Eine rein additive Änderung schlägt ebenfalls fehl, allerdings mit der Aufforderung zum „Regenerate“ – sodass die Baseline niemandem unbemerkt weggleiten kann.

Es stellt außerdem sicher, dass `rebase db push` und das Boot-Ensure der verwalteten Runtime exakt *dieselben* Namen ableiten, was ein zweiter Vertrag ist, der sich im ersten verbirgt: Sie kompilieren dieselben Collections über unterschiedlichen Code, und ein Projekt, das einmal gepusht und später gebootet wird, darf am Ende nicht mit zwei Schemas enden.

## Was *nicht* eingefroren ist

Klar und deutlich formuliert, damit niemand ein Versprechen hineininterpretiert, das nie gegeben wurde:

- Die geschriebene TypeScript-API — Collection-Konfiguration, Optionen für `initializeRebaseBackend`, Admin-Props, SDK-Methodennamen. Breaking Changes erscheinen in Minor-Releases und werden im Changelog angekündigt.
- `@rebasepro/studio`, `@rebasepro/mcp`, `@rebasepro/inference`, `@rebasepro/plugin-*` — diese entwickeln sich am schnellsten und haben die wenigsten Nutzer.
- Alles unterhalb des `src/` eines Pakets, das nicht aus dessen Barrel re-exportiert wird. `packages/client/src/index.ts` enthält einen Hinweis, der erklärt, dass seine Exportliste präzise kuratiert ist, damit ein interner Export nicht versehentlich öffentlich wird.
- Das Datenbankschema *Ihrer* Collections. Das gehört Ihnen; Rebase besitzt nur das `rebase`-Schema (und bei einer vor 0.13 bereitgestellten Datenbank das alte `auth`-Schema, bis das Booten dieses ablöst).

## Die Gates, die dies absichern

Nichts von alledem ist bloße Konvention – hinter jedem Punkt steht ein Test, der fehlschlägt, wenn er verletzt wird:

| Gate | Was es fixiert |
|---|---|
| `pnpm verify:corpus` | jede jemals ausgelieferte Bundle-Form, gebootet auf der heutigen Runtime. Fixtures in `tests/fixtures/bundles/` sind **von Hand geschrieben und eingefroren** — ein Fixture, das der Builder neu generiert, würde sich jedes Mal ändern, wenn sich der Builder ändert |
| `pnpm verify:selfhost` | ein echtes Bundle, gebaut, gefaltet, gebootet und so abgerufen, wie ein Browser es tun würde |
| `upgrade-e2e.test.ts` | alte Datenbankschemas (`schema-snapshots/`), die auf die aktuelle Runtime treffen |
| `tests/e2e/tests/cli-init-e2e.ts` | ein erstelltes Scaffold-Projekt, installiert aus **echten Tarballs**, nicht über Workspace-Links |
| `tests/e2e/tests/client-sdk-e2e.ts` | der Endbenutzer-Pfad: Registrieren → Anmelden → RLS-bezogene Lesevorgänge → Refresh → Storage → Realtime |
| `pnpm check:derived-names` | jeder Spalten-, Constraint-, Junction-, Enum- und Policy-Name, den das Framework ableitet — und dass Boot und `db push` sie identisch ableiten |
| `pnpm rls:check` | die Policies des generierten Schemas |
| `pnpm check:api-surface` | jeder Export und dessen Member der fünf vom Image bereitgestellten Pakete — `@rebasepro/server`, `types`, `client`, `common`, `utils` — plus der Einstiegspunkt `@rebasepro/server/functions`, abgeglichen gegen die sechs Abschnitte von `contracts/server.api.txt`. Dies sind die Pakete, die `infra/docker/entrypoint.mjs` per Symlink über die eigenen Kopien eines deployten Bundles legt; das Entfernen eines Exports aus einem dieser Pakete führt daher bei niemandem zu einem Kompilierungsfehler — es führt zu einem flottenweiten Boot-Fehler während eines Rollouts, den niemand angefordert hat |
| `pnpm test:gates` | die eigenen Tests der Gates anhand von Fixtures — 47 Dateien, darunter `check:api-surface` und die unten beschriebene Release-Bump-Prüfung —, sodass ein Gate, das nicht mehr erkennt, was es schützen soll, hier fehlschlägt. `check:api-surface` verbrachte seine gesamte bisherige Existenz damit, nicht erkennen zu können, wenn ein Member aus `const rebase` verschwand |
| `node tooling/scripts/check-release-bump.mjs` | dass die Versionserhöhungsstufe (Bump Level), unter der ein Release ausgeliefert wird, zu den Änderungen passt, die das Release an den obigen Baselines vorgenommen hat — ausgeführt von `publish.yml`, bevor der Changelog gestempelt wird |
| saas CI | die Control Plane, gebaut gegen das `main` dieses Repositories, bei eigenen Pushes und im nächtlichen Build |

**Zeichnen Sie einmal pro Release ein Bundle-Fixture und einen Schema-Snapshot auf.** Der Wert beider Korpora liegt einzig und allein darin, wie weit das älteste Exemplar zurückreicht, und keines von beiden kann im Nachhinein nachträglich aufgefüllt werden.

### Noch nicht durch Gates abgesichert

Die obige Tabelle zeigt, was abgesichert ist. Dies sind die Teile der Richtlinie, die bisher noch von nichts abgesichert werden – aufgeführt, damit niemand ein Versprechen hineinliest:

- **Keine Deprecation- oder Support-Fristen.** Solange Rebase `0.x` ist, gibt es keine schriftliche Regelung darüber, wie lange ein veralteter Export vor der Entfernung überlebt oder wie lange ein älteres Minor-Release Fixes erhält. Sicherheitsfixes landen ausschließlich auf dem neuesten Minor-Release.
- **Das HTTP-Wire-Format besitzt kein Gate.** Kein `check:*`-Skript vergleicht Request- und Response-Formen mit einer Baseline, so wie `check:api-surface` Exporte vergleicht; eine geänderte Response-Form wird nur von einer E2E-Suite abgefangen, die sie zufällig ausliest.
- **CLI-Flags haben keine Kompatibilitäts-Baseline.** Der Dokumentationsprüfer schlägt fehl, wenn ein Flag verschwindet, das die Skills, die Beispiele oder die Marketing-Website verwenden; nichts bemerkt das Verschwinden anderer Flags oder wenn ein Flag seine Bedeutung ändert.
- **Ein CI-Release zeichnet keines der beiden Korpora auf.** Der Publish-Workflow zeichnet weder ein Bundle-Fixture noch einen Schema-Snapshot auf; nur das lokale Release-Skript versucht dies und warnt lediglich, anstatt abzubrechen, wenn es dies nicht kann. Für 0.18 bis 0.21 existiert kein aufgezeichneter Projekt-Snapshot.
- **Die Export-Oberfläche ist ein Gate, kein Vertrag.** Ob die öffentlichen Exporte der von der Runtime bereitgestellten Pakete zu einem siebten nummerierten Vertrag werden — deklariert als die Baseline von `check:api-surface`, additiv kompatibel innerhalb einer Contract-Major-Version —, ist eine noch offene Entscheidung.

## Ändern eines Vertrags

1. Entscheiden Sie, welcher der sechs Verträge betroffen ist. Die meisten Änderungen betreffen keinen von ihnen – aber „keiner der sechs“ bedeutet nicht „unkritisch“. Das Entfernen oder Umbenennen eines Exports von `@rebasepro/server` oder eines Members davon betrifft keinen der sechs und ist die mit Abstand gefährlichste Änderung im gesamten Repository, da der Code, den sie bricht, bereits gebaut ist und nicht neu kompiliert wird. `pnpm check:api-surface` hält diese Linie; ob daraus ein siebter nummerierter Vertrag wird, ist eine offene Entscheidung (siehe *Noch nicht durch Gates abgesichert*, oben).
2. Fügen Sie zuerst ein Fixture oder einen Snapshot für die **alte** Form hinzu und stellen Sie sicher, dass der Test erfolgreich durchläuft.
3. Nehmen Sie die Änderung vor und erhöhen Sie die Konstante.
4. Bestätigen Sie, dass das alte Fixture immer noch besteht oder dass es nun *mit genau der Meldung fehlschlägt, die ein Benutzer benötigen würde*. Beide Ergebnisse sind valide; stillschweigendes Verhalten ist es nicht.
5. Planen Sie für Vertrag 3 den Rebuild jedes deployten Bundles vor dem Mergen.
6. Vertrag 6 ist die Ausnahme zu den Schritten 3 und 4: Es gibt keine Konstante zu erhöhen und keine Version, anhand derer abgewiesen werden könnte, da eine Spalte keinen Versionsstempel trägt. Der Schritt, der sie ersetzt, besteht darin, die Änderung gar nicht erst vorzunehmen – siehe den obigen Abschnitt darüber, wie die Alternative aussieht.

## Verwandte Themen

- [Upgrading](/docs/upgrading/) — was tatsächlich gebrochen ist, Release für Release
- [Changelog](/docs/changelog/) — jede Änderung, einschließlich derer, die nichts beschädigt haben
- [Runtime & Bundles](/docs/architecture/runtime-and-bundles/) — Vertrag 3 — das Bundle-Format, gegen das ein deploytes Projekt bereits gebaut ist
