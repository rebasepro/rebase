---
sourceHash: 1fd0f89847e543c2
slug: de/docs/compatibility
title: Kompatibilität
description: Was Rebase über Versionen hinweg verspricht und was nicht – die sechs versionierten Verträge, wie jeder fehlschlägt und was sich in einem Minor-Release noch ändern kann.
---

Was Rebase über Versionen hinweg verspricht und was nicht.

Dies ist das Dokument, das gelesen werden sollte, bevor etwas geändert wird, wovon ein bereitgestelltes Projekt oder ein laufender Rebase-Cloud-Tenant bereits abhängt. Es ist auch die ehrliche Antwort auf die Frage: „Wenn ich heute auf Rebase aufbaue, was bricht mir später unter den Füßen weg?“

## Was „Beta“ hier bedeutet

Rebase befindet sich in der öffentlichen Beta. Die meisten Projekte verwenden dieses Wort im Sinne von „alles kann kaputtgehen“, was Lesenden keinerlei Planungssicherheit bietet. Hier ist also die Grenze, die dieses Projekt tatsächlich zieht:

> **Die API, gegen die du programmierst, kann sich in einem Minor-Release ändern – mit einem Eintrag im Changelog. Deine Daten können nicht still und leise kaputtgehen.**

Die erste Hälfte ist gewöhnliches `0.x`-Verhalten und wird weiter unten beschrieben. Die zweite Hälfte ist der Teil, der eine genaue Betrachtung wert ist, da es sich um eine Aussage über Mechanismen und nicht über Absichten handelt: Die versionierten Verträge im nächsten Abschnitt sind jeweils in einem Artefakt oder einer Datenbank festgeschrieben, jeder wird beim Booten oder bei der Annahme geprüft, und jeder **schlägt lautstark und spezifisch fehl**, anstatt schleichend zu degradieren. Ein Schema-Push, der eine Spalte löschen würde, wird durch ein destruktives Gate verweigert (`packages/server-postgres/test/e2e/db-push-safety.test.ts`), und der Upgrade-Pfad selbst ist ein Test: `upgrade-e2e.test.ts` stellt Datenbanken so wieder her, wie ältere Releases sie hinterlassen haben, führt den aktuellen Migrationspfad über jede einzelne aus und stellt sicher, dass die Zeilen überleben – nicht nur, dass der Boot-Vorgang erfolgreich war.

Was Beta tatsächlich bedeutet: Features fehlen noch, manche Subsysteme sind neuer als andere, und Ecken und Kanten äußern sich darin, dass etwas fehlt oder umständlich ist, nicht darin, dass stillschweigend Daten korrumpiert werden. Welche Subsysteme welchen Status haben, wird veröffentlicht und datiert, statt dem Zufall überlassen zu werden – die folgende Tabelle ist diese Veröffentlichung.

## Reifegrad nach Subsystem

**Zuletzt überarbeitet am 14. September 2026, bezogen auf 0.21.0.** Bei jedem Minor-Release erneut lesen; eine Einstufung, die sich über drei Releases hinweg nicht geändert hat, ist entweder stabilisiert oder vergessen worden – und dieser Hinweis steht hier, damit dieser Unterschied geprüft wird.

Die drei Einstufungen bedeuten:

- **Stable** — die Form ist festgelegt und durch ein Gate in der CI abgesichert. Es können weiterhin Features hinzukommen; es wird innerhalb von 0.x nicht grundlegend umgestaltet, und eine Änderung, die Kompatibilität brechen würde, wird im Changelog angekündigt.
- **Beta** — es funktioniert und wird in der Produktion eingesetzt, und bestimmte Aspekte sind bekanntermaßen noch ungeschliffen: ein Limit, an das man stoßen kann, eine umständliche Kante oder eine noch nicht getroffene Designentscheidung. Der unfertige Teil wird in den Anmerkungen benannt, da „Beta“ allein keine Planungssicherheit bietet.
- **Experimental** — ausgeliefert, damit es genutzt und Feedback gesammelt werden kann. Es ist damit zu rechnen, auf unbetretene Pfade zu stoßen.

| Subsystem | Einstufung | Worauf die Einstufung basiert |
|---|---|---|
| REST API + generiertes SDK | Stable | Der Wire-Vertrag ist versioniert und durch Gates abgesichert; `client-sdk-e2e` steuert Registrierung → Anmeldung → RLS-eingeschränkte Lesezugriffe → Refresh → Storage → Realtime Ende-zu-Ende |
| Auth — E-Mail/Passwort, OAuth, OIDC, Magic Link, Einmalcode | Stable | Zwölf OAuth-Provider werden mitgeliefert. Das Auth-Schema ist ein versionierter Vertrag, festgeschrieben und beim Booten geprüft |
| Auth — MFA (TOTP) | Beta | Registrierung, Verifizierung und Wiederherstellung funktionieren und sind getestet. Schlüsselrotation ist für den Verschlüsselungsschlüssel implementiert; es gibt keine Admin-Oberfläche zum Zurücksetzen des Faktors eines ausgesperrten Benutzers |
| Row-Level Security | Stable | Der Kern des Produkts. `pnpm rls:check` prüft eine Live-Datenbank anhand von fünfzehn Checks, und die RLS-E2E-Suite läuft bei jedem Push |
| Storage | Stable | Lokal, S3 und GCS. Default-Deny in der Produktion seit 0.17.0, und das Gerüst bringt einen Authorize-Hook mit |
| Realtime | **Beta** | Abonnements werden ausschließlich nach Collection-Pfad abgeglichen, sodass N Abonnenten einer Collection bei jedem Schreibvorgang N RLS-eingeschränkte Refetches verursachen. Das begrenzt ein Deployment auf wenige hundert gleichzeitige Abonnenten. Korrekt auf jeder Skalierungsstufe; darüber hinaus jedoch teuer |
| Vektorsuche (pgvector) | Beta | Jede Vektorspalte erhält standardmäßig einen HNSW-Index für Kosinus-Distanz, anpassbar pro Eigenschaft über `VectorIndexConfig` (Methode, Distanzen, Build-Parameter) oder abschaltbar, was einen exakten Scan hinterlässt. pgvector kann keine Spalten mit mehr als 2.000 Dimensionen indizieren, daher bleiben diese unindiziert und werden gescannt |
| Offline-Synchronisierung | Beta | Mutationen enthalten Idempotenzschlüssel, die vom Server berücksichtigt werden, und die beim Juli-Audit festgestellten Datenverlustfehler sind behoben. Das Konfliktmodell ist Last-Write-Wins ohne feldweises Merging |
| Entitätshistorie | Stable | Snapshot-basiert, durch eine eigene Suite abgesichert |
| Functions und Crons | Stable | Der portable Einstiegspunkt (`@rebasepro/server/functions`) ist ein versionierter Vertrag mit einem eigenen API-Surface-Abschnitt |
| MCP-Server + Agent Skills | Beta | `@rebasepro/mcp` läuft über stdio: 53 Tools, Bearer-Authentifizierung pro Projekt, destruktive Tools verweigern nicht-lokale Ziele ohne explizites Opt-in. Seit 0.21 kann der Server auch einen Remote-Endpunkt `/mcp` mounten – OAuth 2.1, elf Daten-Tools, jeder Aufruf unter der eigenen RLS der angemeldeten Person – standardmäßig deaktiviert, es sei denn `REBASE_MCP_ENABLED=true`, und nur Postgres |
| Studio (SQL, Schema, RLS, API-Explorer) | Beta | Täglich in echten Projekten im Einsatz. Branching ist im OSS-Paket vorhanden und in Rebase Cloud bewusst nicht freigegeben, da es noch kein Konzept dafür gibt, ein laufendes Deployment auf einen Branch umzuziehen |
| CMS + Admin-Panel | Beta | Vollständig für CRUD, Relationen, Storage-Felder und Rollen. **Die Datentabelle besitzt keine Grid-Semantik** – kein `role`, kein `aria-rowindex`, `tabIndex` entfernt – daher können Tastatur- und Screenreader-Nutzende die Hauptansicht nicht bedienen. Keine Entwürfe, keine sprachspezifischen Inhalte, kein Block-Rich-Text |
| Verwaltete PGlite-Entwicklungsdatenbank | Beta | Zero-Setup `rebase dev` ohne Docker. Jeweils nur eine Session, daher werden Anfragen serialisiert und Nebenläufigkeit kann damit nicht reproduziert werden; Atlas-gestützte Befehle (`db push`, `generate`, `migrate`) planen gegen eine zweite, temporäre PGlite-Instanz, die für den Befehl gestartet wird (unter 0.24 verweigern sie die verwaltete Datenbank); `db branch` funktioniert dort nicht und meldet dies auch |
| Helm-Chart | Beta | Rendert die Split-Process-Topologie und wird bei jedem Release in der OCI-Registry veröffentlicht. Der Standard bleibt ein einzelner Container |
| `@rebasepro/server-mongo` | **Experimental** | Ein funktionierender Treiber mit Change-Stream-Echtzeit und Snapshot-Historie. **Keine Row-Level Security** – das gesamte obige Isolationsmodell greift hier nicht – und keine Relationen. Change Streams erfordern ein Replica Set: Auf einem Standalone-`mongod` gibt es keinen Ersatz dafür, sodass ein Abonnement nur Schreibvorgänge sieht, die über diesen Rebase-Prozess getätigt wurden, und alle anderen verpasst. Kein MFA: Registrierung antwortet mit 501, und die Prüfungen melden „kein Faktor“, sodass die Anmeldung nie danach fragt. Das Admin-Aggregat kann keine Collection ansteuern – es liest den Namen aus einer `$from`-Stufe, die MongoDB nicht besitzt – und gibt daher nichts zurück |
| `@rebasepro/firebase` | Experimental | Führt das Admin-Panel und SDK gegen Firestore aus. Kein RLS, keine SQL-Oberfläche; der Postgres-Funktionsumfang überträgt sich nicht. Der Firestore-Treiber ignoriert `or(...)`/`and(...)`-Filtergruppen, sodass eine Abfrage, die eine solche verwendet, jede Zeile liest, die ihre einfachen Filter zulassen |
| Rebase Cloud | **Private beta** | Live, betreibt echte Mandanten, Freischaltung in Batches. Kein Self-Service |

Zwei Einträge oben sind der ehrliche Preis für die Veröffentlichung dieser Tabelle: Der Realtime-Refetch und die Barrierefreiheit der Datentabelle sind bekannte Mängel, keine Roadmap-Punkte, und beide sind aufgeführt, anstatt darauf zu warten, dass Lesende sie selbst entdecken.

Diese Tabelle zeigt, was existiert. Was noch nicht existiert, steht auf der [Roadmap](https://rebase.pro/roadmap) – ein Eintrag pro GitHub-Issue, wobei die für 1.0 erforderliche Teilmenge markiert ist.

## Das 0.x-Versprechen

Rebase ist `0.x`. Dieser Abschnitt ist so verfasst, dass er für jedes 0.x-Release gilt und nicht nur für eines, damit er nicht mit jedem Release veraltet. **Breaking Changes an der verfassten TypeScript-API sind in einem Minor-Release weiterhin zulässig**, und das Changelog ist der Ort, an dem sie angekündigt werden. Was *nicht* unbemerkt brechen darf, ist die Reihe der unten aufgeführten versionierten Verträge: Jeder einzelne ist in einem Artefakt oder einer Datenbank festgeschrieben, jeder wird beim Booten oder beim Einlesen geprüft, und jeder schlägt **lautstark und spezifisch fehl**, anstatt schleichend zu degradieren.

Diese Unterscheidung ist das ganze Versprechen. Ein umbenannter Export kostet einen Compiler-Fehler und fünf Minuten Zeit. Ein Bundle, das mit der falschen Runtime bootet und subtil falsche Daten ausliefert, kostet einen Incident – und die Verträge existieren, damit diese zweite Kategorie nicht im Stillen passieren kann.

Rebase Cloud stützt sich exakt auf diese Verträge und auf nichts anderes. Alles, was hier nicht aufgeführt ist, ist ein Implementierungsdetail, von dem die Plattform nicht abhängt.

### Versions-Badges und Canaries

Die Dokumentation wird von `main` veröffentlicht, daher kann eine Seite etwas beschreiben, das noch kein stabiles Release enthält. Ein *Since*-Badge nennt das erste stabile Release, das es beinhaltet, und der Text daneben beschreibt das Verhalten des vorherigen Releases.

Ein Canary ist ein Build von `main`, der nach dem Release nummeriert ist, auf das er zusteuert: `0.25.0-canary.g<commit>` ist `main` auf diesem Commit, nach 0.24.0 und vor 0.25.0, und `rebase upgrade --to canary` installiert die neueste Version. Er enthält alles, was `main` zum Zeitpunkt des Builds erreicht hatte, sodass ein Badge mit dieser Version (Since 0.25) zutrifft und der Hinweis auf das vorherige Release (unter 0.24) das stabile Release beschreibt, von dem man kommt. Canaries vor 0.25.0 wurden stattdessen nach dem letzten Release nummeriert: `0.24.1-canary.g<commit>` ist ebenfalls eine Vorschau auf 0.25.

## Die versionierten Verträge

Die folgenden Werte werden aus dem Quellcode gelesen; betrachte die Dateiverweise als Quelle der Wahrheit und diese Tabelle als Wegweiser.

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
| 5 | `manifest.schemaVersion` | ausgegeben von `rebase build` | vom SDK als `x-rebase-schema` gesendet, wenn konfiguriert | informativ — identifiziert, gegen welches Schema ein Client gebaut wurde |
| 6 | Abgeleitete Datenbank-Bezeichner | `contracts/derived-names.txt` | `pnpm check:derived-names` | **eingefroren** — ein von einem Release ausgegebener Name wird niemals neu abgeleitet |

### 1 — `rebase` in `rebase.json`

Ein SemVer-Bereich, der wie `engines` in einer `package.json` interpretiert wird: welche Runtime-Versionen dieses Projekt akzeptiert. Bewusst `rebase` statt `runtime` genannt, da `runtime` bei einer App bereits bedeutet, *wer den Prozess besitzt* (`managed` | `custom`).

### 2 — `BUNDLE_FORMAT_VERSION` (aktuell 2)

Das On-Disk-Layout eines erstellten Bundles. Eine Runtime akzeptiert jedes Bundle, dessen Format **kleiner oder gleich** ihrem eigenen ist. Dadurch kann der Managed-Tier einen Tenant auf ein neues Image umziehen, ohne dass das Projekt neu gebaut werden muss.

- **1** — `mode: "cms" | "baas" | "static"`, `entry.static` ein einzelnes Verzeichnis, `entry.admin` für ein gebündeltes Admin-Panel.
- **2** — `kind: "backend" | "static"`, `entry.static` eine Liste, `entry.admin` entfernt. Format 1 wird weiterhin über `upgradeLegacyManifest` gelesen.

**Zu erhöhen, wenn** sich das Layout so ändert, dass eine ältere Runtime ein neueres Bundle falsch interpretieren würde. Die Erhöhung wandelt ein „bootet und liefert nichts aus“ in eine Startverweigerung um.

### 3 — `RUNTIME_CONTRACT_VERSION` (aktuell 1)

Die Major-Version des Bundle↔Runtime-Vertrags. Zu unterscheiden von der Paketversion von `@rebasepro/server`, die beliebig viele Minor- und Patch-Releases veröffentlichen kann, während dieser Wert unverändert bleibt.

**Vor Änderungen unbedingt lesen.** Die Prüfung erfolgt auf `!==`, nicht auf `>`:

> Ein Bundle, das auf Vertrag *N* abzielt, läuft **ausschließlich** auf einer Runtime, die *N* implementiert

Eine Erhöhung macht also **jedes jemals erstellte Bundle** auf einen Schlag ungültig, bis jedes einzelne neu gebaut wird. Das ist die beabsichtigte Härte – es ist der Hebel für „nichts Altes darf hier laufen“ –, bedeutet aber auch, dass eine Erhöhung eine flottenweite Migration darstellt und keine bloße Release-Notiz. Für die Managed-Ebene muss dies mit einem Rebuild der Bundles aller Tenants abgestimmt werden.

Wenn eine Änderung *additiv* ist und alte Bundles weiterhin korrekt wären, gehört sie zu `BUNDLE_FORMAT_VERSION` (oder benötigt gar keine Anpassung), nicht hierher.

### 4 — `AUTH_SCHEMA_VERSION` (aktuell 2)

In `rebase.schema_meta` gestempelt und beim Booten verglichen. Eine Runtime **verweigert den Start** gegen eine Datenbank, die von einer neueren Framework-Version migriert wurde, anstatt auf einer Struktur zu arbeiten, die sie nicht versteht – bei einem Rolling Deploy ist das der Unterschied dazwischen, ob die halbe Flotte Fehler wirft oder die halbe Flotte Daten beschädigt.

Die Vorwärtsmigration erfolgt automatisch: `ensureAuthTablesExist` aktualisiert eine ältere Datenbank. Zu beachten ist, dass dieser Migrationsblock bewusst in ein `try/catch` gehüllt ist und loggt, statt einen Fehler zu werfen – ein holpriger Boot ist besser als ein Crash-Loop –, weshalb **„er hat gebootet“ nichts beweist**. Jede Assertion in der Upgrade-Suite liest stattdessen den Katalog oder die Daten.

**Zu erhöhen, wenn** eine Migration von einer älteren Runtime keinesfalls übersprungen werden darf. Nicht bei einer additiven, abwärtskompatiblen Spalte erhöhen; ein praktisches Beispiel für diese Abwägung findet sich in `packages/server-postgres/src/auth/ensure-tables.ts`.

### 5 — `manifest.schemaVersion`

Ein Hash der kompilierten Collection-Definitionen, der in das Bundle-Manifest ausgegeben und von einem generierten SDK im Header `x-rebase-schema` (`SCHEMA_VERSION_HEADER`) widergespiegelt wird. Er existiert, damit die Plattform melden kann: „Diese App wurde gegen ein älteres Schema gebaut“, anstatt bei der ersten Anfrage rätselhaft fehlzuschlagen.

`rebase generate-sdk` schreibt den Wert in `schema.meta.ts`; übergib ihn an den Client, damit er mitgesendet wird:

```typescript
import { SCHEMA_VERSION } from "./generated/sdk/schema.meta";

const rebase = createRebaseClient<Database>({
    baseUrl: "http://localhost:3001",
    collections: collectionsDictionary,
    schemaVersion: SCHEMA_VERSION,
});
```

Das Backend liest diesen Header bei jeder Datenanfrage. Eine Abweichung (Drift) blockiert Aufrufe grundsätzlich nicht – ein SDK, das ein Schema hinterherhinkt, ist meist noch kompatibel, und das Backend vor dem Frontend auszuliefern, ist die normale Deploy-Reihenfolge. Wenn eine Anfrage jedoch mit einem 400 oder 404 fehlschlägt, enthält der Fehler die Abweichung als Ursache:

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

Eine umbenannte Spalte wird somit als „Dein SDK ist veraltet, bitte neu generieren“ gemeldet, statt als ein Feld, von dessen Existenz die eigenen Typen felsenfest ausgehen. Einer erfolgreichen Anfrage wird dies nie mitgeteilt.

Er deckt **ausschließlich Collections** ab. Das Bearbeiten eines Hooks oder einer Function ändert nicht den Vertrag des Clients und darf nicht jedes generierte SDK entwerten.

### Wer ruft an

Zwei weitere identifizierende Signale, von denen keines für sich genommen etwas sperrt:

- **`GET /api/meta/schema-version`** ist nicht authentifiziert und antwortet mit der `schemaVersion` des Projekts *und* seiner `runtime` (`version` und `contract`). Ein CI-Job, der sein generiertes SDK mit einem Live-Projekt vergleicht, benötigt keine Zugangsdaten, ebenso wenig wie ein Client, der anfragt, mit welcher Runtime er kommuniziert.
- **`User-Agent: rebase-cli/<version>`** wird bei jeder `rebase cloud`-Anfrage mitgesendet. Das Wire-Format der Control Plane ist dem auf npm veröffentlichten Stand oft voraus; daher muss sie in der Lage sein, einem alten Client mit `CLI_TOO_OLD` und der Mindestversion zu antworten – was sie nur für Aufrufer tun kann, die sich zu erkennen geben.

### 6 — Abgeleitete Datenbank-Bezeichner

Jeder Name, den dieses Framework selbstständig ermittelt, anstatt ihn vorgegeben zu bekommen: eine Fremdschlüsselspalte, ein Fremdschlüssel-Constraint, eine Zwischentabelle (Junction Table) und ihre beiden Schlüsselspalten, ein Enum-Typ, ein Policy-Name, die `snake_case`-Spalte einer `camelCase`-Eigenschaft.

> **Ein abgeleiteter Bezeichner ist in dem Moment eingefroren, in dem ein Release ihn ausgibt.**

Nicht „eingefroren bis zum nächsten Major“ – eingefroren. Die Begründung unterscheidet sich von den anderen fünf Verträgen und wiegt schwerer. Jene sind versioniert, sodass eine Diskrepanz *erkannt* und abgelehnt werden kann. Dieser hier nicht: Der Name wird am Tag des Deployments in die Datenbank eines Kunden geschrieben, und es gibt keinen Versionsstempel auf einer Spalte. Jede Datenbank, die jemals von einem ausgelieferten Release bereitgestellt wurde, behält die einmal abgeleiteten Namen, und kein Code in diesem Repository kann hineingreifen und sie alle umbenennen.

0.13 ist das Paradebeispiel dafür. `generateForeignKeyName` lernte, korrekte Singularformen zu bilden – `categorie_id` → `category_id`, `addres_id` → `address_id` –, was unbestreitbar die bessere Ableitung war, und dennoch jede ältere Datenbank mit unregelmäßigem Plural beschädigte. Boot-ensure migrierte die Spalte, die Daten überlebten also; das eingecheckte `schema.generated.ts` des Projekts tat dies nicht, und der Boot-Vorgang brach wegen einer Spalte ab, die eigentlich existierte. Drei Commits, ein neuer Seam-Test und ein dauerhafter Eintrag in den Upgrade-Hinweisen – im Austausch für einen schöneren Spaltennamen, nach dem niemand gefragt hatte.

**Wenn eine Ableitung wirklich fehlerhaft ist**, ändert sie sich nur für *danach* erstellte Collections hinter einer im Projekt festgehaltenen Naming-Strategy – niemals rückwirkend und niemals als Nebeneffekt einer Verbesserung der zugrunde liegenden Funktion.

**Die einzige legitime Ausnahme** ist eine Änderung, die den Code mit einem Namen in Einklang bringt, den die Datenbank *bereits hat*. Das praktische Beispiel dafür ist das Abschneiden von Bezeichnern (Identifier Truncation): Postgres kürzt Bezeichner stillschweigend auf 63 Bytes. Ein längerer abgeleiteter Constraint-Name war also nie der tatsächliche Name im Systemkatalog – die Ableitung beschrieb ein Objekt, das unter dieser Schreibweise gar nicht existierte, und Boot-ensure führte bei jedem einzelnen Boot erneut `ADD CONSTRAINT` aus, weil der Vergleich niemals übereinstimmen konnte. Das Abschneiden bei der Erstellung ändert, was dieses Repo *ableitet*, ändert aber rein gar nichts daran, was eine bereitgestellte Datenbank *enthält*. Das ist der Maßstab: Nicht „ist der neue Name besser?“, sondern „muss sich irgendeine bestehende Datenbank ändern?“.

Der andere Fall, in dem sich ein Name ändern darf, ist eine Gruppe von Namen, die unmöglich alle gleichzeitig existieren konnten. Eine Regel, die sich über mehrere Operationen auf einer Tabelle mit 42 Bytes oder mehr erstreckte, leitete `<table>_default_admin_write_insert`, `_update` und `_delete` ab, und alle drei wurden auf dieselben 63 Bytes gekürzt. Postgres speicherte eine einzige Policy, DELETE, und verweigerte jedes Admin-INSERT und -UPDATE. Nur wenn die Namen einer Regel auf diese Weise kollidieren, werden sie suffix-first als `<head>_<hash8>_<op>` abgeleitet. Jeder Name, der heute funktioniert, behält seine Schreibweise. Der nächste Boot oder Push entfernt die eine abgeschnittene Policy und erstellt eine Policy für jede Operation.

Das Einzige, was immer sicher ist, ist das *Wiedererkennen* eines alten Namens, um ihn zu migrieren: `legacyForeignKeyName` existiert, um erkannt zu werden, niemals um generiert zu werden, und die Baseline fixiert diese Erkennungen ebenfalls. Das Entfernen einer Erkennung macht stillschweigend die Migration jeder Datenbank rückgängig, die diese Schreibweise noch verwendet.

**Das Gate.** `tooling/scripts/derived-names.mts` schleust eine Naming-Stresstest-Fixture – unregelmäßige Plurale, eine `ss`-Endung, ein Akronym, eine Zwischentabelle von einem Plural-Slug, explizite Overrides, ein Slug, der lang genug zum Abschneiden ist – durch beide Erzeuger von Schema-DDL und rendert jeden Bezeichner, den einer von beiden benennt:

```bash
pnpm check:derived-names
```

Eine geänderte oder entfernte Zeile schlägt als Vertragsbruch fehl, wobei die alte und die neue Schreibweise nebeneinander aufgeführt werden. Eine rein additive Änderung schlägt ebenfalls fehl, allerdings mit dem Hinweis „regenerate“ – so kann die Baseline für niemanden unbemerkt abdriften.

Es stellt außerdem sicher, dass `rebase db push` und das Boot-ensure der Managed-Runtime dieselben Namen ableiten. Dies ist ein zweiter Vertrag, der im ersten verborgen liegt: Sie kompilieren dieselben Collections über unterschiedlichen Code, und ein Projekt, das einmal per Push übertragen und später gebootet wird, darf nicht mit zwei verschiedenen Schemas enden.

## Was *nicht* eingefroren ist

Klar und deutlich formuliert, damit niemand ein Versprechen hineininterpretiert, das nie gegeben wurde:

- Die verfasste TypeScript-API – Collection-Konfiguration, `initializeRebaseBackend`-Optionen, Admin-Props, SDK-Methodennamen. Breaking Changes fließen in Minor-Releases ein und werden im Changelog angekündigt.
- `@rebasepro/studio`, `@rebasepro/mcp`, `@rebasepro/inference`, `@rebasepro/plugin-*` – diese entwickeln sich am schnellsten und haben die wenigsten Nutzer.
- Alles unter dem `src/` eines Pakets, das nicht aus dessen Barrel re-exportiert wird. `packages/client/src/index.ts` enthält einen Hinweis, der erklärt, dass seine Exportliste präzise kuratiert ist, damit ein interner Export nicht versehentlich öffentlich werden kann.
- Das Datenbankschema *deiner* Collections. Das gehört dir; Rebase besitzt nur das `rebase`-Schema (und auf einer vor 0.13 bereitgestellten Datenbank das alte `auth`-Schema, bis das Booten es ablöst).

## Die Gates, die dies absichern

Nichts von alledem ist bloße Konvention – hinter jedem steht ein Test, der fehlschlägt, sobald etwas bricht:

| Gate | Was es absichert |
|---|---|
| `pnpm verify:corpus` | Jede jemals ausgelieferte Bundle-Form, gebootet auf der heutigen Runtime. Fixtures in `tests/fixtures/bundles/` sind **handgeschrieben und eingefroren** – eine vom Builder neu generierte Fixture verändert sich jedes Mal, wenn sich der Builder ändert |
| `pnpm verify:selfhost` | Ein echtes Bundle, gebaut, zusammengefasst, gebootet und so abgerufen, wie es ein Browser tun würde |
| `upgrade-e2e.test.ts` | Alte Datenbankschemas (`schema-snapshots/`), auf die die aktuelle Runtime trifft |
| `tests/e2e/tests/cli-init-e2e.ts` | Ein Scaffold-Projekt, installiert aus **echten Tarballs**, nicht über Workspace-Links |
| `tests/e2e/tests/client-sdk-e2e.ts` | Der Endnutzer-Pfad: Registrierung → Anmeldung → RLS-eingeschränkte Lesezugriffe → Refresh → Storage → Realtime |
| `pnpm check:derived-names` | Jeder Spalten-, Constraint-, Junction-, Enum- und Policy-Name, den das Framework ableitet – und dass Boot und `db push` sie identisch ableiten |
| `pnpm rls:check` | Die Policies des generierten Schemas |
| `pnpm check:api-surface` | Jeder Export und seine Member der fünf vom Image bereitgestellten Pakete – `@rebasepro/server`, `types`, `client`, `common`, `utils` – plus der Einstiegspunkt `@rebasepro/server/functions`, abgeglichen mit den sechs Abschnitten von `contracts/server.api.txt`. Dies sind die Pakete, die `infra/docker/entrypoint.mjs` per Symlink über die eigenen Kopien eines bereitgestellten Bundles legt. Das Entfernen eines Exports führt daher bei niemandem zu einem Compile-Fehler – es führt zu einem Boot-Fehler in der gesamten Flotte während eines Rollouts, den niemand angefordert hat |
| `pnpm test:gates` | Die eigenen Tests der Gates anhand von Fixtures – 47 Dateien, darunter `check:api-surface` und die unten stehende Release-Bump-Prüfung –, damit ein Gate, das das zu Schützende nicht mehr erkennt, hier fehlschlägt. `check:api-surface` war zeitlebens nicht in der Lage zu bemerken, wenn ein Member aus `const rebase` verschwand |
| `node tooling/scripts/check-release-bump.mjs` | Dass die Bump-Stufe, unter der ein Release ausgeliefert wird, dem entspricht, was das Release an den obigen Baselines verändert hat – ausgeführt von `publish.yml`, bevor das Changelog abgestempelt wird |
| saas CI | Die Control Plane, gebaut gegen `main` dieses Repositories, bei eigenen Pushes und nightly |

**Ein Bundle-Fixture und einen Schema-Snapshot einmal pro Release aufzeichnen.** Der Wert beider Corpora liegt einzig darin, wie weit das älteste Exemplar zurückreicht – und keines von beiden kann im Nachhinein nachgepflegt werden.

### Noch nicht durch Gates abgesichert

Die obige Tabelle zeigt, was abgesichert ist. Dies sind die Teile der Richtlinie, die noch durch nichts abgesichert werden, hier aufgeführt, damit niemand ein Versprechen hineininterpretiert:

- **Keine Deprecation- oder Support-Fristen.** Solange Rebase sich in `0.x` befindet, gibt es keine schriftliche Regelung darüber, wie lange ein als deprecated markierter Export vor seiner Entfernung überlebt oder wie lange ein älteres Minor-Release Fixes erhält. Sicherheits-Fixes landen ausschließlich im neuesten Minor-Release.
- **Das HTTP-Wire-Format besitzt kein Gate.** Kein `check:*`-Skript gleicht Anfrage- und Antwortstrukturen mit einer Baseline ab, so wie `check:api-surface` Exporte vergleicht; eine geänderte Antwortstruktur wird nur von einer E2E-Suite bemerkt, die sie zufällig ausliest.
- **CLI-Flags haben keine Kompatibilitäts-Baseline.** Der Dokumentations-Verifier schlägt fehl, wenn ein Flag verschwindet, das von den Skills, den Beispielen oder der Marketing-Website verwendet wird; ansonsten bemerkt nichts das Verschwinden eines Flags oder eine Bedeutungsänderung.
- **Ein CI-Release zeichnet keines der beiden Corpora auf.** Der Veröffentlichungs-Workflow zeichnet weder Bundle-Fixture noch Schema-Snapshot auf; nur das lokale Release-Skript versucht dies und warnt lediglich, statt abzubrechen, wenn es fehlschlägt. 0.18 bis 0.21 besitzen keinen aufgezeichneten Projekt-Snapshot.
- **Die Export-Oberfläche ist ein Gate, kein Vertrag.** Ob die öffentlichen Exporte der von der Runtime bereitgestellten Pakete zu einem siebten nummerierten Vertrag werden – deklariert als die `check:api-surface`-Baseline, additiv kompatibel innerhalb einer Major-Vertragsversion –, ist eine offene Entscheidung.

## Einen Vertrag ändern

1. Entscheiden, um welchen der sechs es sich handelt. Die meisten Änderungen betreffen keinen von ihnen – aber „keiner der sechs“ bedeutet nicht „unkritisch“. Das Entfernen oder Umbenennen eines Exports von `@rebasepro/server` oder eines seiner Member betrifft keinen der sechs und ist die mit Abstand gefährlichste Änderung im Repository, da der Code, den sie bricht, bereits gebaut ist und nicht neu kompiliert wird. `pnpm check:api-surface` sichert diese Grenze ab; ob daraus ein siebter nummerierter Vertrag wird, ist eine offene Entscheidung (siehe *Noch nicht durch Gates abgesichert* oben).
2. Zuerst eine Fixture oder einen Snapshot für die **alte** Form hinzufügen und sicherstellen, dass der Test besteht.
3. Die Änderung vornehmen und die Konstante erhöhen.
4. Bestätigen, dass die alte Fixture immer noch erfolgreich durchläuft oder dass sie nun *mit der Fehlermeldung fehlschlägt, die ein Benutzer benötigt*. Beides sind gültige Ergebnisse; Stillschweigen ist keines.
5. Für Vertrag 3 den Rebuild jedes bereitgestellten Bundles vor dem Mergen planen.
6. Vertrag 6 ist die Ausnahme zu den Schritten 3 und 4: Es gibt keine Konstante zum Erhöhen und keine Version, anhand derer verweigert werden könnte, da eine Spalte keinen Versionsstempel trägt. Der Schritt, der sie ersetzt, ist die Entscheidung, die Änderung nicht durchzuführen – siehe den obigen Abschnitt für mögliche Alternativen.

## Verwandte Themen

- [Upgrading](/docs/upgrading/) — was sich Release für Release tatsächlich geändert hat und gebrochen ist
- [Changelog](/docs/changelog/) — jede Änderung, einschließlich derjenigen, die nichts gebrochen haben
- [Runtime & Bundles](/docs/architecture/runtime-and-bundles/) — Vertrag 3 — das Bundle-Format, gegen das ein bereitgestelltes Projekt bereits gebaut wurde
