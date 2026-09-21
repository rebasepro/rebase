---
sourceHash: ec13f8f9c203aae2
slug: de/docs/compatibility
title: Kompatibilität
description: Was Rebase über Versionen hinweg verspricht und was nicht – die sechs versionierten Verträge, wie jeder einzelne fehlschlägt und was sich in einem Minor-Release noch ändern kann.
---

Was Rebase über Versionen hinweg verspricht und was nicht.

Dies ist das Dokument, das Sie lesen sollten, bevor Sie etwas ändern, von dem
ein bereitgestelltes Projekt oder ein laufender Rebase Cloud-Tenant bereits
abhängt. Es ist auch die ehrliche Antwort auf die Frage: „Wenn ich heute auf
Rebase aufbaue, was bricht mir später unter den Füßen weg?“

## Was „Beta“ hier bedeutet

Rebase befindet sich in der Public Beta. Die meisten Projekte verwenden dieses
Wort im Sinne von „alles kann kaputtgehen“, was einem Leser keinerlei
Planungssicherheit bietet. Hier ist also die Grenze, die dieses Projekt
tatsächlich zieht:

> **Die API, gegen die Sie entwickeln, kann sich in einem Minor-Release mit einem
> Changelog-Eintrag ändern. Ihre Daten können nicht still und leise
> kaputtgehen.**

Die erste Hälfte ist gewöhnliches `0.x`-Verhalten und wird weiter unten
beschrieben. Die zweite Hälfte ist der Teil, den es zu prüfen lohnt, da es sich
um eine Behauptung über Mechanismen und nicht über Absichten handelt: Die
versionierten Verträge im nächsten Abschnitt sind jeweils in einem Artefakt
oder einer Datenbank hinterlegt, jeder wird beim Booten oder beim Einlesen
überprüft, und jeder **schlägt laut und spezifisch fehl**, anstatt schleichend zu
degradieren. Ein Schema-Push, der eine Spalte löschen würde, wird durch ein
Destructive Gate (`packages/server-postgres/test/e2e/db-push-safety.test.ts`)
verweigert, und der Upgrade-Pfad selbst ist ein Test: `upgrade-e2e.test.ts`
stellt Datenbanken so wieder her, wie ältere Releases sie hinterlassen haben,
wendet den aktuellen Migrationspfad auf jede an und stellt sicher, dass die
Zeilen überleben – und nicht nur der Boot-Vorgang.

Was Beta tatsächlich bedeutet: Features fehlen noch, manche Subsysteme sind
neuer als andere, und Ecken und Kanten äußern sich darin, dass etwas fehlt oder
umständlich ist, nicht darin, dass stillschweigend Daten beschädigt werden.
Welche Subsysteme welchen Status haben, wird offengelegt und datiert, statt dem
Zufall überlassen – die folgende Tabelle ist diese Offenlegung.

## Reifegrad nach Subsystem

**Zuletzt überarbeitet am 14. September 2026, bezogen auf 0.21.0.** Lesen Sie
dies bei jedem Minor-Release erneut; eine Bewertung, die sich in drei Releases
nicht geändert hat, ist entweder gefestigt oder vergessen, und dieser Hinweis
steht hier, damit dieser Unterschied geprüft wird.

Die drei Bewertungen bedeuten:

- **Stable** — die Struktur ist gefestigt und durch ein Gate in der CI
  abgesichert. Es können weiterhin Features hinzukommen; es wird innerhalb von
  0.x nicht grundlegend umgestaltet, und eine Änderung, die Breaking Changes mit
  sich bringt, wird im Changelog angekündigt.
- **Beta** — es funktioniert und wird in der Produktion eingesetzt, und es ist
  bekannt, dass es noch Ecken und Kanten gibt: ein Limit, das man erreichen
  kann, ein umständlicher Randfall, eine noch nicht getroffene
  Designentscheidung. Der unfertige Teil wird in den Anmerkungen benannt, denn
  „Beta“ allein bietet keine Planungsgrundlage.
- **Experimental** — ausgeliefert, damit es genutzt und Feedback gesammelt
  werden kann. Rechnen Sie damit, auf Aspekte zu stoßen, die noch niemand
  getestet hat.

| Subsystem | Einstufung | Worauf die Einstufung basiert |
|---|---|---|
| REST API + generated SDK | Stable | Der Wire-Contract ist versioniert und abgesichert; `client-sdk-e2e` durchläuft Registrierung → Anmeldung → RLS-eingeschränkte Lesezugriffe → Refresh → Storage → Realtime End-to-End |
| Auth — email/password, OAuth, OIDC, magic link, one-time code | Stable | Zwölf OAuth-Provider sind enthalten. Das Auth-Schema ist ein versionierter Vertrag, der beim Booten signiert und geprüft wird |
| Auth — MFA (TOTP) | Beta | Registrierung, Verifizierung und Wiederherstellung funktionieren und sind getestet. Schlüsselrotation ist für den Verschlüsselungsschlüssel implementiert; es gibt keine Admin-Oberfläche zum Zurücksetzen des Faktors eines ausgesperrten Benutzers |
| Row-level security | Stable | Das Kernstück des Produkts. `pnpm rls:check` prüft eine Live-Datenbank anhand von fünfzehn Checks, und die RLS-E2E-Suite läuft bei jedem Push |
| Storage | Stable | Lokal, S3 und GCS. Default-Deny in der Produktion seit 0.17.0, und das Scaffold liefert einen Authorize-Hook mit |
| Realtime | **Beta** | Abonnements werden nur nach Collection-Pfad abgeglichen, sodass N Abonnenten für eine Collection N RLS-eingeschränkte Re-Fetches pro Schreibvorgang kosten. Das begrenzt ein Deployment auf wenige hundert gleichzeitige Abonnenten. Korrekt in jedem Maßstab; darüber hinaus jedoch teuer |
| Vector search (pgvector) | Beta | Jede Vektorspalte erhält standardmäßig einen HNSW-Index für Kosinus-Distanz, anpassbar pro Property über `VectorIndexConfig` (Methode, Distanzen, Build-Parameter) oder deaktivierbar, was einen exakten Scan belässt. pgvector kann Spalten mit mehr als 2.000 Dimensionen nicht indizieren, daher bleiben diese unindiziert und werden gescannt |
| Offline sync | Beta | Mutationen enthalten Idempotenzschlüssel, die der Server berücksichtigt, und die im Juli-Audit festgestellten Datenverlustfehler sind behoben. Das Konfliktmodell ist Last-Write-Wins ohne feldweises Zusammenführen |
| Entity history | Stable | Snapshot-basiert, abgesichert durch eine eigene Testsuite |
| Functions and crons | Stable | Der portable Einstiegspunkt (`@rebasepro/server/functions`) ist ein versionierter Vertrag mit einem eigenen API-Surface-Abschnitt |
| MCP server + agent skills | Beta | `@rebasepro/mcp` läuft über stdio: zweiundvierzig Tools, Bearer-Auth pro Projekt, destruktive Tools verweigern nicht-lokale Ziele ohne Opt-in. Seit 0.21 kann der Server auch einen Remote-Endpunkt `/mcp` mounten – OAuth 2.1, sechs Daten-Tools, jeder Aufruf unter dem eigenen RLS des angemeldeten Benutzers – standardmäßig deaktiviert, es sei denn `REBASE_MCP_ENABLED=true`, und nur für Postgres |
| Studio (SQL, schema, RLS, API explorer) | Beta | Täglich in echten Projekten im Einsatz. Branching ist im OSS-Paket vorhanden und wird in Rebase Cloud bewusst nicht angeboten, da das Verschieben eines laufenden Deployments auf einen Branch noch nicht gelöst ist |
| CMS + admin panel | Beta | Vollständig für CRUD, Relationen, Storage-Felder und Rollen. **Die Datentabelle hat keine Grid-Semantik** – keine `role`, kein `aria-rowindex`, `tabIndex` entfernt – daher können Benutzer von Tastatur und Screenreadern die Hauptansicht nicht bedienen. Keine Entwürfe, keine länderspezifischen Inhalte (Locales), kein Block-Rich-Text |
| PGlite managed dev database | Beta | Zero-Setup `rebase dev` ohne Docker. Jeweils nur eine Session, sodass Anfragen serialisiert werden und Nebenläufigkeit damit nicht reproduziert werden kann; Atlas-basierte Befehle (`db push`, `generate`, `migrate`) funktionieren dort nicht und weisen darauf hin |
| Helm chart | Beta | Rendert die Split-Process-Topologie und wird bei jedem Release in der OCI-Registry veröffentlicht. Der Standard bleibt ein einzelner Container |
| `@rebasepro/server-mongo` | **Experimental** | Ein funktionierender Treiber mit Change-Stream-Echtzeit und Snapshot-Historie. **Keine Row-Level Security** – das gesamte oben beschriebene Isolationsmodell greift hier nicht – und keine Relationen. Change-Streams erfordern ein Replica Set: Auf einem eigenständigen `mongod` gibt es keinen Ersatz dafür, sodass ein Abonnement nur Schreibvorgänge sieht, die über diesen Rebase-Prozess ausgeführt wurden, und alle anderen verpasst. Kein MFA: Registrierung antwortet mit 501 und die Checks antworten mit „no factor“, sodass bei der Anmeldung nie danach gefragt wird. Das Admin-Aggregate kann keine Collection ansprechen – es liest den Namen aus einer `$from`-Stufe, die MongoDB nicht hat – und gibt daher nichts zurück |
| `@rebasepro/firebase` | Experimental | Führt das Admin-Panel und das SDK auf Firestore aus. Kein RLS, keine SQL-Oberfläche; der Postgres-Funktionsumfang wird nicht übertragen. Der Firestore-Treiber ignoriert `or(...)`/`and(...)`-Filtergruppen, sodass eine Abfrage, die eine solche verwendet, jede Zeile liest, die ihre einfachen Filter zulassen |
| Rebase Cloud | **Private beta** | Live, betreibt echte Mandanten, Freischaltung in Batches. Kein Self-Service |

Zwei der obigen Einträge sind der ehrliche Preis für die Veröffentlichung dieser
Tabelle: Der Realtime-Refetch und die Barrierefreiheit der Datentabelle sind
offene Fehler, keine Roadmap-Punkte, und beide sind aufgeführt, statt dem Leser
zur eigenen Entdeckung überlassen zu werden.

Diese Tabelle zeigt, was existiert. Was noch nicht existiert, steht auf der
[Roadmap](https://rebase.pro/roadmap), ein Eintrag pro GitHub-Issue, wobei die
für 1.0 erforderliche Teilmenge gekennzeichnet ist.

## Das 0.x-Versprechen

Rebase ist `0.x`. Dieser Abschnitt ist so verfasst, dass er für jedes 0.x-Release
gilt und nicht nur für ein einzelnes, damit er nicht mit jedem Release veraltet.
**Breaking Changes an der erstellten TypeScript-API sind in einem Minor-Release
weiterhin zulässig**, und das Changelog ist der Ort, an dem sie angekündigt
werden. Was *nicht* stillschweigend brechen darf, ist die Reihe der unten
aufgeführten versionierten Verträge: Jeder ist in einem Artefakt oder einer
Datenbank hinterlegt, jeder wird beim Booten oder Einlesen überprüft, und jeder
schlägt **laut und spezifisch fehl**, anstatt schleichend zu degradieren.

Diese Unterscheidung ist das eigentliche Versprechen. Ein umbenannter Export
kostet Sie einen Compiler-Fehler und fünf Minuten. Ein Bundle, das gegen die
falsche Runtime bootet und subtil falsche Daten ausliefert, kostet Sie einen
Incident. Die Verträge existieren, damit die zweite Kategorie nicht unbemerkt
eintreten kann.

Rebase Cloud stützt sich exakt auf diese Verträge und auf nichts anderes.
Alles, was hier nicht aufgeführt ist, ist ein Implementierungsdetail, von dem
die Plattform nicht abhängt.

## Die versionierten Verträge

Die unten stehenden Werte werden aus dem Quellcode ausgelesen; betrachten Sie die
Dateiverweise als maßgeblich und diese Tabelle als Orientierung.

```bash
grep -rn "BUNDLE_FORMAT_VERSION =\|RUNTIME_CONTRACT_VERSION =" packages/types/src/types/project_manifest.ts
grep -n "AUTH_SCHEMA_VERSION =" packages/server-postgres/src/auth/schema-version.ts
```

| # | Vertrag | Deklariert in | Geprüft in | Kompatibilitätsrichtung |
|---|---|---|---|---|
| 1 | `rebase`-Bereich in `rebase.json` | Projekt des Nutzers | CLI beim Build | Projekt gibt an, welche Runtimes es akzeptiert |
| 2 | `BUNDLE_FORMAT_VERSION` | `packages/types/src/types/project_manifest.ts` | `packages/server/src/boot/bundle.ts` | **abwärtskompatibel** — neue Runtime liest alte Bundles |
| 3 | `RUNTIME_CONTRACT_VERSION` | dieselbe Datei | dieselbe Datei | **exakte Übereinstimmung, beide Richtungen** |
| 4 | `AUTH_SCHEMA_VERSION` | `packages/server-postgres/src/auth/schema-version.ts` | beim Booten, gegen `rebase.schema_meta` | **nur vorwärts** — neue Runtime migriert alte Datenbanken |
| 5 | `manifest.schemaVersion` | ausgegeben von `rebase build` | vom SDK als `x-rebase-schema` gesendet, falls konfiguriert | informativ — identifiziert, gegen welches Schema ein Client gebaut wurde |
| 6 | Abgeleitete Datenbankbezeichner | `contracts/derived-names.txt` | `pnpm check:derived-names` | **eingefroren** — ein von einem Release ausgegebener Name wird niemals neu abgeleitet |

### 1 — `rebase` in `rebase.json`

Ein Semver-Bereich, der wie `engines` in einer `package.json` gelesen wird:
welche Runtime-Versionen dieses Projekt akzeptiert. Ganz bewusst `rebase` statt
`runtime` genannt, da `runtime` bei einer App bereits bedeutet, *wer den Prozess
besitzt* (`managed` | `custom`).

### 2 — `BUNDLE_FORMAT_VERSION` (aktuell 2)

Das On-Disk-Layout eines erstellten Bundles. Eine Runtime akzeptiert jedes Bundle,
dessen Format **kleiner oder gleich** ihrem eigenen ist. Dadurch kann der Managed
Tier einen Tenant auf ein neues Image umziehen, ohne dass jemand sein Projekt neu
bauen muss.

- **1** — `mode: "cms" | "baas" | "static"`, `entry.static` ein einzelnes
  Verzeichnis, `entry.admin` für ein gebündeltes Admin-Panel.
- **2** — `kind: "backend" | "static"`, `entry.static` eine Liste, `entry.admin`
  entfernt. Format 1 wird weiterhin über `upgradeLegacyManifest` gelesen.

**Erhöhen, wenn** sich das Layout so ändert, dass eine ältere Runtime ein
neueres Bundle falsch interpretieren würde. Die Erhöhung verwandelt ein „bootet
und liefert nichts aus“ in eine Verweigerung des Systemstarts.

### 3 — `RUNTIME_CONTRACT_VERSION` (aktuell 1)

Die Major-Version des Bundle↔Runtime-Vertrags. Zu unterscheiden von der
Paketversion von `@rebasepro/server`, die beliebig viele Minors und Patches
veröffentlichen kann, während dieser Wert unverändert bleibt.

**Vor dem Ändern lesen.** Die Prüfung erfolgt über `!==`, nicht `>`:

> Ein Bundle, das auf Vertrag *N* abzielt, läuft **nur** auf einer Runtime, die
> *N* implementiert

Eine Erhöhung macht daher **jedes jemals erstellte Bundle** auf einen Schlag
ungültig, bis jedes einzelne neu gebaut wurde. Das ist die beabsichtigte Härte –
es ist der Hebel für „hier kann nichts Altes laufen“ –, aber es bedeutet auch,
dass eine Erhöhung eine flottenweite Migration darstellt und keine einfache
Release-Notiz ist. Für den Managed Tier muss dies mit einem Rebuild der Bundles
aller Tenants koordiniert werden.

Wenn eine Änderung *additiv* ist und alte Bundles weiterhin korrekt wären,
gehört dies in `BUNDLE_FORMAT_VERSION` (oder überhaupt nichts davon), nicht
hierher.

### 4 — `AUTH_SCHEMA_VERSION` (aktuell 2)

In `rebase.schema_meta` hinterlegt und beim Booten verglichen. Eine Runtime
**verweigert den Start** bei einer Datenbank, die von einer neueren
Framework-Version migriert wurde, anstatt mit einer Struktur zu arbeiten, die
sie nicht versteht – bei einem Rolling Deployment ist das der Unterschied
dazwischen, ob die halbe Flotte Fehler wirft oder die halbe Flotte Daten
beschädigt.

Die Vorwärtsmigration erfolgt automatisch: `ensureAuthTablesExist` bringt eine
ältere Datenbank auf den neuesten Stand. Beachten Sie, dass dieser
Migrationsblock bewusst in ein `try/catch` gehüllt ist und loggt, anstatt
Fehler zu werfen – ein humpelnder Boot-Vorgang ist besser als ein Crash-Loop –,
daher beweist **„es hat gebootet“ gar nichts**. Jede Assertion in der
Upgrade-Suite liest stattdessen den Katalog oder die Daten aus.

**Erhöhen, wenn** eine Migration von einer älteren Runtime keinesfalls
übersprungen werden darf. Erhöhen Sie den Wert nicht für eine additive,
abwärtskompatible Spalte; ein detailliertes Beispiel für diese Abwägung findet
sich in `packages/server-postgres/src/auth/ensure-tables.ts`.

### 5 — `manifest.schemaVersion`

Ein Hash der kompilierten Collection-Definitionen, der in das Bundle-Manifest
ausgegeben und von einem generierten SDK im Header `x-rebase-schema`
(`SCHEMA_VERSION_HEADER`) zurückgesendet wird. Er existiert, damit die Plattform
melden kann: „Diese App wurde gegen ein älteres Schema gebaut“, anstatt bei der
ersten Anfrage rätselhaft fehlzuschlagen.

`rebase generate-sdk` schreibt den Wert in `schema.meta.ts`; übergeben Sie ihn
an den Client, um ihn zu senden:

```typescript
import { SCHEMA_VERSION } from "./generated/sdk/schema.meta";

const rebase = createRebaseClient<Database>({
    baseUrl: "http://localhost:3001",
    collections: collectionsDictionary,
    schemaVersion: SCHEMA_VERSION,
});
```

Das Backend liest diesen Header bei jeder Datenanfrage. Ein Drift verweigert
niemals den Aufruf – ein SDK, das ein Schema hinterherhinkt, ist normalerweise
immer noch kompatibel, und das Ausrollen des Backends vor dem Frontend ist die
normale Deployment-Reihenfolge –, aber wenn eine Anfrage mit einem 400 oder 404
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

Eine umbenannte Spalte wird somit als „Ihr SDK ist veraltet, generieren Sie es
neu“ interpretiert und nicht als ein Feld, von dessen Existenz die eigenen
Typen felsenfest ausgehen. Eine erfolgreiche Anfrage erfährt davon nichts.

Dies betrifft **ausschließlich Collections**. Die Bearbeitung eines Hooks oder
einer Function ändert den Vertrag des Clients nicht und darf nicht jedes
generierte SDK für ungültig erklären.

### Wer anfragt

Zwei weitere identifizierende Signale, von denen keines für sich genommen etwas
blockiert:

- **`GET /api/meta/schema-version`** erfordert keine Authentifizierung und
  antwortet mit der `schemaVersion` des Projekts *und* dessen `runtime`
  (`version` und `contract`). Ein CI-Job, der sein generiertes SDK mit einem
  Live-Projekt vergleicht, benötigt keine Anmeldedaten, ebenso wenig wie ein
  Client, der abfragt, mit welcher Runtime er kommuniziert.
- **`User-Agent: rebase-cli/<version>`** wird bei jeder `rebase cloud`-Anfrage
  mitgeschickt. Das Wire-Format der Control Plane ist dem voraus, was auf npm
  veröffentlicht ist; daher muss sie einem alten Client mit `CLI_TOO_OLD` und
  der Mindestversion antworten können – was nur bei einem Aufrufer möglich ist,
  der sich zu erkennen gibt.

### 6 — Abgeleitete Datenbankbezeichner

Jeder Name, den dieses Framework selbst ermittelt, statt ihn vorgegeben zu
bekommen: eine Fremdschlüsselspalte, ein Fremdschlüssel-Constraint, eine
Zwischentabelle (Junction Table) und ihre zwei Schlüsselspalten, ein Enum-Typ,
ein Policy-Name, die `snake_case`-Spalte einer `camelCase`-Property.

> **Ein abgeleiteter Bezeichner ist in dem Moment eingefroren, in dem ein Release
> ihn ausgibt.**

Nicht „eingefroren bis zum nächsten Major“ – eingefroren. Die Begründung
unterscheidet sich von den anderen fünf Verträgen und wiegt schwerer. Jene sind
versioniert, sodass eine Diskrepanz *erkannt* und abgewiesen werden kann. Dieser
hier nicht: Der Name wird an dem Tag, an dem der Kunde deployt, in dessen
Datenbank geschrieben, und es gibt keinen Versionsstempel auf einer Spalte.
Jede Datenbank, die von irgendeinem jemals ausgelieferten Release bereitgestellt
wurde, enthält genau das, was damals abgeleitet wurde, und kein Code in diesem
Repository kann hineingreifen und sie alle umbenennen.

0.13 ist das Paradebeispiel dafür. `generateForeignKeyName` lernte, korrekte
Einzahlformen zu bilden – `categorie_id` → `category_id`, `addres_id` →
`address_id` –, was unzweifelhaft die bessere Ableitung ist, und es zerstörte
jede ältere Datenbank mit einem unregelmäßigen Plural. Boot-Ensure migrierte die
Spalte, sodass die Daten überlebten; das eingecheckte `schema.generated.ts` des
Projekts tat dies nicht, und der Boot-Vorgang scheiterte an einer Spalte, die
existierte. Drei Commits, ein neuer Seam-Test und ein dauerhafter Eintrag in den
Upgrade-Hinweisen – im Tausch gegen einen schöner aussehenden Spaltennamen, nach
dem niemand gefragt hatte.

**Wenn eine Ableitung wirklich falsch ist**, ändert sie sich nur für
Collections, die *danach* erstellt werden, gesteuert über eine im Projekt
hinterlegte Naming Strategy – niemals rückwirkend und niemals als Nebeneffekt
der Verbesserung der zugrunde liegenden Funktion.

**Die einzige legitime Ausnahme** ist eine Änderung, die dafür sorgt, dass der
Code mit einem Namen übereinstimmt, den die Datenbank *bereits hat*. Das
Paradebeispiel dafür ist das Abschneiden von Bezeichnern (Identifier
Truncation): Postgres schneidet Bezeichner stillschweigend auf 63 Bytes ab. Ein
längerer abgeleiteter Constraint-Name war also nie der tatsächliche Name im
Katalog – die Ableitung beschrieb ein Objekt, das unter dieser Schreibweise gar
nicht existierte, und Boot-Ensure führte bei jedem einzelnen Boot-Vorgang erneut
ein `ADD CONSTRAINT` aus, da der Vergleich niemals übereinstimmen konnte. Das
Abschneiden bei der Konstruktion ändert, was dieses Repository *ableitet*, und
ändert nichts daran, was eine deployte Datenbank *enthält*. Das ist der Maßstab,
den man anlegen muss: Nicht „ist der neue Name besser?“, sondern „muss sich
irgendeine bestehende Datenbank ändern?“.
Was immer sicher ist: einen alten Namen zu *erkennen*, um ihn zu migrieren.
`legacyForeignKeyName` existiert, um erkannt zu werden, niemals um generiert zu
werden, und die Baseline fixiert auch diese Erkennungen. Eine davon zu
entfernen, macht die Migration für jede Datenbank stillschweigend rückgängig,
die diese Schreibweise noch trägt.

**Das Gate.** `tooling/scripts/derived-names.mts` jagt eine Naming-Stress-Fixture
– unregelmäßige Plurale, eine `ss`-Endung, ein Akronym, eine Junction über einen
Plural-Slug, explizite Overrides, ein Slug, der lang genug ist, um abgeschnitten
zu werden – durch beide Erzeuger von Schema-DDL und gibt jeden Bezeichner aus,
den einer von beiden benennt:

```bash
pnpm check:derived-names
```

Eine geänderte oder entfernte Zeile schlägt als Vertragsbruch fehl, wobei die
alte und die neue Schreibweise nebeneinander aufgeführt werden. Eine rein
additive Änderung schlägt ebenfalls fehl, allerdings mit dem Hinweis
„regenerate“ – damit die Baseline niemandem unbemerkt wegläuft.

Es stellt außerdem sicher, dass `rebase db push` und das Boot-Ensure der
verwalteten Runtime dieselben Namen ableiten, was ein zweiter Vertrag ist, der
sich im ersten verbirgt: Sie kompilieren dieselben Collections über
unterschiedlichen Code, und ein Projekt, das einmal per Push übertragen und
später gebootet wird, darf nicht mit zwei Schemas enden.

## Was *nicht* eingefroren ist

Klar gesagt, damit niemand ein Versprechen hineininterpretiert, das nie gegeben
wurde:

- Die verfasste TypeScript-API – Collection-Konfiguration,
  `initializeRebaseBackend`-Optionen, Admin-Props, SDK-Methodennamen. Breaking
  Changes erscheinen in Minor-Releases und werden im Changelog angekündigt.
- `@rebasepro/studio`, `@rebasepro/mcp`, `@rebasepro/inference`,
  `@rebasepro/plugin-*` – diese entwickeln sich am schnellsten und haben die
  wenigsten Nutzer.
- Alles unter `src/` eines Pakets, das nicht aus dessen Barrel re-exportiert
  wird. `packages/client/src/index.ts` enthält einen Hinweis, der erklärt, dass
  die Exportliste genau deshalb kuratiert ist, damit ein interner Export nicht
  versehentlich öffentlich wird.
- Das Datenbankschema *Ihrer* Collections. Das gehört Ihnen; Rebase besitzt nur
  die Schemas `rebase` und `auth`.

## Die Gates, die dies absichern

Nichts davon ist bloße Konvention – hinter jedem Punkt steht ein Test, der
fehlschlägt, wenn er verletzt wird:

| Gate | Was es absichert |
|---|---|
| `pnpm verify:corpus` | jede jemals ausgelieferte Bundle-Form, gebootet auf der heutigen Runtime. Fixtures in `tests/fixtures/bundles/` sind **handgeschrieben und eingefroren** – eine Fixture, die der Builder neu generiert, würde sich jedes Mal verändern, wenn sich der Builder ändert |
| `pnpm verify:selfhost` | ein echtes Bundle, gebaut, gefaltet, gebootet und abgerufen, wie es ein Browser tun würde |
| `upgrade-e2e.test.ts` | alte Datenbankschemas (`schema-snapshots/`), ausgeführt mit der aktuellen Runtime |
| `tests/e2e/tests/cli-init-e2e.ts` | ein per Scaffold erstelltes Projekt, installiert aus **echten Tarballs**, nicht über Workspace-Links |
| `tests/e2e/tests/client-sdk-e2e.ts` | der Endbenutzer-Pfad: Registrierung → Anmeldung → RLS-eingeschränkte Lesezugriffe → Refresh → Storage → Realtime |
| `pnpm check:derived-names` | jeder Spalten-, Constraint-, Junction-, Enum- und Policy-Name, den das Framework ableitet – und dass Boot und `db push` diese identisch ableiten |
| `pnpm rls:check` | die Policies des generierten Schemas |
| `pnpm check:api-surface` | jeder Export und dessen Member der fünf Pakete, die das Image bereitstellt – `@rebasepro/server`, `types`, `client`, `common`, `utils` – plus der Einstiegspunkt `@rebasepro/server/functions`, abgeglichen mit den sechs Abschnitten von `contracts/server.api.txt`. Dies sind die Pakete, die `infra/docker/entrypoint.mjs` über die eigenen Kopien eines deployten Bundles verlinkt (symlink). Das Entfernen eines Exports aus einem dieser Pakete ist daher für niemanden ein Compile-Fehler – es ist ein flottenweiter Boot-Fehler während eines Rollouts, um den niemand gebeten hat |
| `pnpm test:gates` | die eigenen Tests der Gates über Fixtures – elf Dateien, darunter `check:api-surface` und der Release-Bump-Check weiter unten –, damit ein Gate, das nicht mehr erkennt, was es schützen soll, hier fehlschlägt. `check:api-surface` konnte während seiner gesamten Existenz nicht erkennen, wenn ein Member aus `const rebase` verschwand |
| `node tooling/scripts/check-release-bump.mjs` | dass das Bump-Level, unter dem ein Release veröffentlicht wird, dem entspricht, was das Release an den obigen Baselines geändert hat – ausgeführt von `publish.yml`, bevor das Changelog gestempelt wird |
| saas CI | die Control Plane, gebaut gegen den `main`-Branch dieses Repositories, bei eigenen Pushes und nächtlich (nightly) |

**Zeichnen Sie einmal pro Release eine Bundle-Fixture und einen Schema-Snapshot
auf.** Der Wert beider Corpora liegt ausschließlich darin, wie weit die älteste
zurückreicht, und keines von beiden kann nachträglich aufgefüllt werden.

### Noch nicht abgesichert

Die obige Tabelle zeigt, was abgesichert ist. Dies sind die Teile der
Richtlinie, die noch durch nichts abgesichert sind – aufgeführt, damit niemand
ein Versprechen hineininterpretiert:

- **Kein Deprecation- oder Support-Fenster.** Solange Rebase `0.x` ist, gibt es
  keine feste Regelung dafür, wie lange ein als deprecated markierter Export vor
  seiner Entfernung überlebt oder wie lange ein älteres Minor-Release Fixes
  erhält. Sicherheits-Fixes landen ausschließlich im neuesten Minor-Release.
- **Das HTTP-Wire-Format hat kein Gate.** Kein `check:*`-Skript vergleicht
  Request- und Response-Formate mit einer Baseline, so wie `check:api-surface`
  Exporte vergleicht; eine veränderte Response-Struktur wird nur von einer
  E2E-Suite bemerkt, die sie zufällig liest.
- **CLI-Flags haben keine Kompatibilitäts-Baseline.** Der
  Dokumentations-Verifier schlägt fehl, wenn ein Flag verschwindet, das von den
  Skills, den Beispielen oder der Marketing-Website verwendet wird; ansonsten
  bemerkt nichts das Verschwinden eines anderen Flags oder die
  Bedeutungsänderung eines Flags.
- **Ein CI-Release zeichnet keines der beiden Corpora auf.** Der Publish-Workflow
  zeichnet weder eine Bundle-Fixture noch einen Schema-Snapshot auf; nur das
  lokale Release-Skript versucht dies und warnt lediglich, statt abzubrechen,
  wenn es fehlschlägt. Für 0.18 bis 0.21 gibt es keinen aufgezeichneten
  Projekt-Snapshot.
- **Die Export-Surface ist ein Gate, kein Vertrag.** Ob die öffentlichen Exporte
  der von der Runtime bereitgestellten Pakete zu einem siebten nummerierten
  Vertrag werden – deklariert als die `check:api-surface`-Baseline, additiv
  kompatibel innerhalb einer Major-Vertragsversion –, ist eine offene
  Entscheidung.

## Einen Vertrag ändern

1. Entscheiden Sie, welcher der sechs Verträge betroffen ist. Die meisten
   Änderungen betreffen keinen von ihnen – aber „keiner der sechs“ bedeutet nicht
   „unkritisch“. Das Entfernen oder Umbenennen eines Exports von
   `@rebasepro/server` oder eines Members davon betrifft keinen der sechs
   Verträge und ist dennoch die mit Abstand gefährlichste Änderung im Repository,
   da der Code, den sie bricht, bereits gebaut ist und nicht neu kompiliert wird.
   `pnpm check:api-surface` sichert diese Grenze ab; ob daraus ein siebter
   nummerierter Vertrag wird, ist eine offene Entscheidung (siehe *Noch nicht
   abgesichert* oben).
2. Fügen Sie zuerst eine Fixture oder einen Snapshot für die **alte** Form hinzu
   und stellen Sie sicher, dass der Test erfolgreich durchläuft.
3. Führen Sie die Änderung durch und erhöhen Sie die Konstante.
4. Bestätigen Sie, dass die alte Fixture weiterhin erfolgreich durchläuft oder
   dass sie nun *mit genau der Meldung fehlschlägt, die ein Benutzer benötigen
   würde*. Beides sind gültige Ergebnisse; Stillschweigen ist es nicht.
5. Bei Vertrag 3: Planen Sie den Rebuild jedes deployten Bundles vor dem Mergen
   ein.
6. Vertrag 6 ist die Ausnahme zu den Schritten 3 und 4: Es gibt keine Konstante
   zum Erhöhen und keine Version, anhand derer verweigert werden kann, da eine
   Spalte keinen Versionsstempel trägt. Der Schritt, der sie ersetzt, besteht
   darin, die Änderung gar nicht erst vorzunehmen – wie die Alternative
   aussieht, erfahren Sie im obigen Abschnitt.

## Verwandte Themen

- [Upgraden](/docs/upgrading/) — was tatsächlich gebrochen ist, Release für Release
- [Changelog](/docs/changelog/) — jede Änderung, einschließlich derer, die nichts gebrochen haben
- [Runtime & Bundles](/docs/architecture/runtime-and-bundles/) — Vertrag 3 — das Bundle-Format, gegen das ein deploytes Projekt bereits gebaut ist
