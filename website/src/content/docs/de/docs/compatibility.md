---
slug: de/docs/compatibility
title: Kompatibilität
description: Was Rebase über Versionen hinweg verspricht und was nicht – die sechs versionierten Verträge, wie jeder fehlschlägt und was sich in einem Minor-Release noch ändern kann.
---

Was Rebase über Versionen hinweg verspricht und was nicht.

Dies ist das Dokument, das Sie lesen sollten, bevor Sie etwas ändern, von dem ein
bereitgestelltes Projekt oder ein laufender Rebase Cloud-Tenant bereits abhängt.
Es ist auch die ehrliche Antwort auf die Frage: „Wenn ich heute auf Rebase aufbaue,
was bricht mir später weg?“

## Was „Beta“ hier bedeutet

Rebase befindet sich in der öffentlichen Beta-Phase. Die meisten Projekte verwenden
dieses Wort im Sinne von „alles kann kaputtgehen“, was dem Leser nichts sagt,
worauf er planen kann. Hier ist also die Grenze, die dieses Projekt tatsächlich zieht:

> **Die API, gegen die Sie programmieren, kann sich in einer Minor-Version mit
> einem Changelog-Eintrag ändern. Ihre Daten dürfen nicht stillschweigend kaputtgehen.**

Die erste Hälfte ist gewöhnliches `0.x`-Verhalten und wird unten beschrieben. Die
zweite Hälfte ist der Teil, den es zu prüfen lohnt, da es sich um eine Behauptung
über Mechanismen und nicht über Absichten handelt: Die versionierten Verträge
(Contracts) im nächsten Abschnitt sind jeweils in ein Artefakt oder eine Datenbank
gestempelt, werden jeweils beim Booten oder bei der Aufnahme geprüft und **schlagen
jeweils laut und spezifisch fehl**, anstatt schleichend zu degradieren. Ein Schema-Push,
der eine Spalte löschen würde, wird durch ein destruktives Gate verweigert
(`packages/server-postgres/test/e2e/db-push-safety.test.ts`), und der Upgrade-Pfad
selbst ist ein Test: `upgrade-e2e.test.ts` stellt Datenbanken so wieder her, wie
ältere Releases sie hinterlassen haben, führt den aktuellen Migrationspfad über jede
einzelne aus und stellt sicher, dass die Zeilen überleben – nicht nur, dass das
Booten erfolgreich war.

Was Beta tatsächlich bedeutet: Funktionen fehlen noch, einige Subsysteme sind neuer
als andere, und die Form von Ecken und Kanten besteht darin, dass etwas fehlt oder
umständlich ist, nicht darin, dass es stillschweigend etwas beschädigt. Welche
Subsysteme welchen Status haben, wird veröffentlicht und datiert, anstatt es der
Entdeckung zu überlassen.

## Das 0.x-Versprechen

Rebase ist `0.x` – 0.16 zum Zeitpunkt der Erstellung dieses Dokuments. Dieser
Abschnitt ist so verfasst, dass er für jedes 0.x-Release gilt und nicht nur für eines,
damit er nicht mit jedem Release veraltet. **Breaking Changes an der erstellten
TypeScript-API sind in einer Minor-Version weiterhin zulässig**, und das Changelog
ist der Ort, an dem sie angekündigt werden. Was *nicht* stillschweigend kaputtgehen
darf, ist die Reihe der nachfolgend aufgeführten versionierten Verträge: Jeder ist in
ein Artefakt oder eine Datenbank gestempelt, jeder wird beim Booten oder bei der
Aufnahme geprüft, und jeder schlägt **laut und spezifisch fehl**, anstatt
schleichend zu degradieren.

Diese Unterscheidung macht das gesamte Versprechen aus. Ein umbenannter Export
kostet Sie einen Kompilierungsfehler und fünf Minuten. Ein Bundle, das gegen die
falsche Runtime bootet und subtil falsche Daten liefert, kostet Sie einen Vorfall
(Incident) – und die Verträge existieren, damit die zweite Kategorie nicht
stillschweigend eintreten kann.

Rebase Cloud verwendet genau diese Verträge und nichts anderes. Alles, was hier
nicht aufgeführt ist, ist ein Implementierungsdetail, von dem die Plattform
nicht abhängt.

## Die versionierten Verträge

Die folgenden Werte werden aus dem Quellcode ausgelesen; betrachten Sie die
Dateireferenzen als Wahrheit und diese Tabelle als Karte.

```bash
grep -rn "BUNDLE_FORMAT_VERSION =\|RUNTIME_CONTRACT_VERSION =" packages/types/src/types/project_manifest.ts
grep -n "AUTH_SCHEMA_VERSION =" packages/server-postgres/src/auth/schema-version.ts
```

| # | Vertrag | Deklariert in | Geprüft in | Kompatibilitätsrichtung |
|---|---|---|---|---|
| 1 | `rebase`-Bereich in `rebase.json` | Projekt des Nutzers | CLI beim Build | Projekt gibt an, welche Runtimes es akzeptiert |
| 2 | `BUNDLE_FORMAT_VERSION` | `packages/types/src/types/project_manifest.ts` | `packages/server/src/boot/bundle.ts` | **abwärtskompatibel** – neue Runtime liest alte Bundles |
| 3 | `RUNTIME_CONTRACT_VERSION` | selbe Datei | selbe Datei | **exakte Übereinstimmung, beide Richtungen** |
| 4 | `AUTH_SCHEMA_VERSION` | `packages/server-postgres/src/auth/schema-version.ts` | beim Booten gegen `rebase.schema_meta` | **nur vorwärts** – neue Runtime migriert alte Datenbanken |
| 5 | `manifest.schemaVersion` | ausgegeben durch `rebase build` | vom SDK als `x-rebase-schema` gesendet | informativ – identifiziert, gegen welches Schema ein Client gebaut wurde |
| 6 | Abgeleitete Datenbank-Bezeichner | `contracts/derived-names.txt` | `pnpm check:derived-names` | **eingefroren** – ein von einem Release ausgegebener Name wird niemals neu abgeleitet |

### 1 — `rebase` in `rebase.json`

Ein SemVer-Bereich, der wie `engines` in einer `package.json` gelesen wird: welche
Runtime-Versionen dieses Projekt akzeptiert. Bewusst `rebase` statt `runtime`
genannt, da `runtime` bei einer App bereits bedeutet, *wer den Prozess besitzt*
(`managed` | `custom`).

### 2 — `BUNDLE_FORMAT_VERSION` (aktuell 2)

Das On-Disk-Layout eines erstellten Bundles. Eine Runtime akzeptiert jedes Bundle,
dessen Format **kleiner oder gleich** ihrem eigenen ist. Dadurch kann die Managed-Ebene
einen Tenant auf ein neues Image migrieren, ohne dass jemand sein Projekt neu bauen muss.

- **1** – `mode: "cms" | "baas" | "static"`, `entry.static` ein einzelnes Verzeichnis,
  `entry.admin` für ein gebündeltes Admin-Interface.
- **2** – `kind: "backend" | "static"`, `entry.static` eine Liste, `entry.admin`
  entfernt. Format 1 wird weiterhin über `upgradeLegacyManifest` gelesen.

**Erhöhen (bump), wenn** sich das Layout so ändert, dass eine ältere Runtime ein
neueres Bundle falsch interpretieren würde. Die Erhöhung verwandelt ein „bootet
und liefert nichts aus“ in eine Startverweigerung.

### 3 — `RUNTIME_CONTRACT_VERSION` (aktuell 1)

Die Major-Version des Bundle↔Runtime-Vertrags. Zu unterscheiden von der
Paketversion von `@rebasepro/server`, für die beliebig viele Minor- und Patch-Versionen
veröffentlicht werden können, während diese hier unverändert bleibt.

**Lesen Sie dies, bevor Sie es anfassen.** Die Prüfung ist `!==`, nicht `>`:

> Ein Bundle, das auf Vertrag *N* abzielt, läuft **nur** auf einer Runtime, die *N* implementiert

Ein Erhöhen macht daher **jedes jemals erstellte Bundle** auf einen Schlag
ungültig, bis jedes neu gebaut wird. Das ist die beabsichtigte Härte – es ist der
Hebel für „hier kann nichts Altes mehr laufen“ –, bedeutet aber auch, dass ein
Bump eine flottenweite Migration ist und kein bloßer Release-Hinweis. Für die
Managed-Ebene muss dies mit einem Rebuild des Bundles jedes Tenants koordiniert werden.

Wenn eine Änderung *additiv* ist und alte Bundles weiterhin korrekt wären, gehört
dies in `BUNDLE_FORMAT_VERSION` (oder überhaupt nichts davon), nicht hierher.

### 4 — `AUTH_SCHEMA_VERSION` (aktuell 2)

In `rebase.schema_meta` eingestempelt und beim Booten verglichen. Eine Runtime
**verweigert den Start** gegenüber einer Datenbank, die von einer neueren
Framework-Version migriert wurde, anstatt auf einer Struktur zu operieren, die sie
nicht versteht – bei einem Rolling Deploy ist das der Unterschied zwischen einer
halben Flotte mit Fehlern und einer halben Flotte mit Datenbeschädigung.

Die Vorwärtsmigration erfolgt automatisch: `ensureAuthTablesExist` bringt eine
ältere Datenbank auf den neuesten Stand. Beachten Sie, dass dieser Migrationsblock
bewusst in `try/catch` gekapselt ist und protokolliert, anstatt Fehler zu werfen –
ein hinkender Boot ist besser als eine Crash-Schleife –, daher **beweist „es hat
gebootet“ gar nichts**. Jede Assertion in der Upgrade-Suite liest stattdessen den
Katalog oder die Daten aus.

**Erhöhen (bump), wenn** eine Migration von einer älteren Runtime nicht übersprungen
werden darf. Nicht für eine additive, abwärtskompatible Spalte erhöhen; ein
ausgearbeitetes Beispiel für diese Abwägung findet sich in
`packages/server-postgres/src/auth/ensure-tables.ts`.

### 5 — `manifest.schemaVersion`

Ein Hash der kompilierten Collection-Definitionen, der in das Bundle-Manifest
ausgegeben und von einem generierten SDK im Header `x-rebase-schema`
(`SCHEMA_VERSION_HEADER`) widergespiegelt wird. Er existiert, damit die Plattform
melden kann: „Diese App wurde gegen ein älteres Schema gebaut“, anstatt bei der
ersten Anfrage rätselhaft fehlzuschlagen.

Er deckt **nur Collections** ab. Das Bearbeiten eines Hooks oder einer Funktion
ändert den Vertrag des Clients nicht und darf nicht jedes generierte SDK
ungültig machen.

### 6 — Abgeleitete Datenbank-Bezeichner

Jeder Name, den dieses Framework selbstständig ermittelt, anstatt ihn vorgegeben
zu bekommen: eine Fremdschlüssel-Spalte, ein Fremdschlüssel-Constraint, eine
Junction-Tabelle und ihre beiden Schlüsselspalten, ein Enum-Typ, ein Policy-Name,
die `snake_case`-Spalte einer `camelCase`-Eigenschaft.

> **Ein abgeleiteter Bezeichner ist in dem Moment eingefroren, in dem ein Release ihn ausgibt.**

Nicht „eingefroren bis zum nächsten Major-Release“ – eingefroren. Die Begründung
unterscheidet sich von den anderen fünf Verträgen und ist gewichtiger. Jene sind
versioniert, sodass eine Diskrepanz *erkannt* und abgelehnt werden kann. Dieser
hier nicht: Der Name wird am Tag des Deployments in die Datenbank eines Kunden
geschrieben, und auf einer Spalte gibt es keinen Versionsstempel. Jede Datenbank,
die von einem jemals ausgelieferten Release bereitgestellt wurde, trägt das in sich,
was damals abgeleitet wurde, und kein Code in diesem Repository kann hineingreifen
und sie alle umbenennen.

0.13 ist das Paradebeispiel dafür. `generateForeignKeyName` lernte, Singularformen
korrekt zu bilden – `categorie_id` → `category_id`, `addres_id` → `address_id` –,
was unbestreitbar die bessere Ableitung ist, und es beschädigte jede ältere
Datenbank mit einem unregelmäßigen Plural. Boot-Ensure migrierte die Spalte, sodass
die Daten überlebten; das im Projekt eingecheckte `schema.generated.ts` tat dies
jedoch nicht, und der Boot-Vorgang brach wegen einer Spalte ab, die existierte.
Drei Commits, ein neuer Nahtstellen-Test (Seam Test) und ein dauerhafter Eintrag in
den Upgrade-Hinweisen, im Tausch gegen einen schöner aussehenden Spaltennamen, nach
dem niemand gefragt hatte.

**Wenn eine Ableitung wirklich falsch ist**, ändert sie sich nur für Collections,
die *danach* erstellt werden, hinter einer im Projekt festgehaltenen Naming Strategy –
niemals rückwirkend und niemals als Nebeneffekt der Verbesserung der zugrunde
liegenden Funktion.

**Die einzige legitime Ausnahme** ist eine Änderung, die dafür sorgt, dass der Code
mit einem Namen übereinstimmt, den die Datenbank *bereits hat*. Das Paradebeispiel
ist das Abschneiden von Bezeichnern (Identifier Truncation): Postgres schneidet
Bezeichner stillschweigend auf 63 Bytes ab, sodass ein längerer abgeleiteter
Constraint-Name nie der tatsächliche Name im Katalog war – die Ableitung beschrieb
ein Objekt, das unter dieser Schreibweise gar nicht existierte, und Boot-Ensure
führte bei jedem einzelnen Bootvorgang erneut `ADD CONSTRAINT` aus, da der Vergleich
niemals übereinstimmen konnte. Das Abschneiden bei der Erstellung ändert, was dieses
Repo *ableitet*, und ändert nichts daran, was eine bereitgestellte Datenbank
*enthält*. Das ist das Kriterium, das anzuwenden ist: nicht „ist der neue Name
besser“, sondern „muss sich irgendeine bestehende Datenbank ändern“.
Die eine Sache, die immer sicher ist, besteht darin, einen alten Namen zu
*erkennen*, um ihn zu migrieren: `legacyForeignKeyName` existiert, um erkannt zu
werden, niemals um generiert zu werden, und die Baseline sichert auch diese
Erkennungen ab. Das Entfernen einer solchen Erkennung macht stillschweigend die
Migration jeder Datenbank rückgängig, die diese Schreibweise noch verwendet.

**Das Gate.** `scripts/derived-names.mts` führt ein Naming-Stresstest-Fixture aus –
unregelmäßige Plurale, eine `ss`-Endung, ein Akronym, eine Junction von einem
Plural-Slug, explizite Overrides, ein Slug, der lang genug ist, um abgeschnitten
zu werden – durch beide Erzeuger von Schema-DDL und gibt jeden Bezeichner aus,
den einer von beiden benennt:

```bash
pnpm check:derived-names
```

Eine geänderte oder entfernte Zeile schlägt als Vertragsbruch fehl, wobei die alte
und die neue Schreibweise nebeneinander dargestellt werden. Eine rein additive
Änderung schlägt ebenfalls fehl, jedoch mit „regenerate“ – so kann die Baseline
für niemanden unbemerkt driften.

Es stellt außerdem sicher, dass `rebase db push` und das Boot-Ensure der Managed
Runtime dieselben Namen ableiten, was ein zweiter Vertrag ist, der sich im ersten
verbirgt: Sie kompilieren dieselben Collections durch unterschiedlichen Code, und
ein Projekt, das einmal gepusht und später gebootet wird, darf nicht mit zwei
Schemas enden.

## Was *nicht* eingefroren ist

Klar formuliert, damit niemand ein Versprechen hineininterpretiert, das nie gegeben wurde:

- Die verfasste TypeScript-API – Collection-Konfiguration, `initializeRebaseBackend`-Optionen,
  Admin-Props, SDK-Methodennamen. Breaking Changes erscheinen in Minor-Releases
  und werden im Changelog angekündigt.
- `@rebasepro/studio`, `@rebasepro/mcp`, `@rebasepro/inference`,
  `@rebasepro/plugin-*` – diese verändern sich am schnellsten und haben die
  wenigsten Nutzer.
- Alles unter `src/` eines Pakets, das nicht aus dessen Barrel re-exportiert wird.
  `packages/client/src/index.ts` enthält einen Hinweis, der erklärt, dass dessen
  Export-Liste genau so kuratiert ist, dass ein interner Export nicht versehentlich
  öffentlich werden kann.
- Das Datenbankschema *Ihrer* Collections. Das gehört Ihnen; Rebase besitzt nur
  die Schemas `rebase` und `auth`.

## Die Gates, die dies absichern

Nichts des Obenstehenden ist reine Konvention – für alles gibt es einen Test, der
fehlschlägt, wenn etwas bricht:

| Gate | Was es absichert |
|---|---|
| `pnpm verify:corpus` | Jede jemals ausgelieferte Bundle-Form, gebootet auf der heutigen Runtime. Fixtures in `fixtures/bundles/` sind **von Hand erstellt und eingefroren** – ein Fixture, das der Builder neu generiert, ändert sich jedes Mal, wenn sich der Builder ändert |
| `pnpm verify:selfhost` | Ein echtes Bundle, gebaut, gefaltet, gebootet und abgerufen, wie es ein Browser tun würde |
| `upgrade-e2e.test.ts` | Alte Datenbankschemas (`schema-snapshots/`), auf die die aktuelle Runtime trifft |
| `e2e/tests/cli-init-e2e.ts` | Ein per Scaffolding erstelltes Projekt, installiert aus **echten Tarballs**, nicht aus Workspace-Links |
| `e2e/tests/client-sdk-e2e.ts` | Der Endnutzer-Pfad: Registrieren → Anmelden → RLS-eingeschränkte Lesezugriffe → Aktualisieren → Storage → Realtime |
| `pnpm check:derived-names` | Jeden Spalten-, Constraint-, Junction-, Enum- und Policy-Namen, den das Framework ableitet – und dass Boot und `db push` sie identisch ableiten |
| `pnpm rls:check` | Die Policies des generierten Schemas |
| `pnpm check:api-surface` | Jeden Export von `@rebasepro/server` und dessen Member gegen `contracts/server.api.txt`. Dies ist das Paket, das `infra/docker/entrypoint.mjs` per Symlink über die eigene Kopie eines bereitgestellten Bundles legt. Das Entfernen eines Exports führt daher bei niemandem zu einem Kompilierungsfehler – sondern zu einem flottenweiten Boot-Fehler während eines Rollouts, den niemand wollte |
| `pnpm test:gates` | Die beiden obigen Gates über Fixtures. `check:api-surface` konnte bisher nicht erkennen, wenn ein Member aus `const rebase` verschwand |
| `node scripts/check-release-bump.mjs` | Dass die Bump-Stufe, unter der ein Release veröffentlicht wird, dem entspricht, was das Release an den obigen Baselines geändert hat – ausgeführt von `publish.yml`, bevor das Changelog abgestempelt wird |
| SaaS-CI | Die Control Plane, gebaut gegen `main` dieses Repositories, bei eigenen Pushes und nächtlich |

**Zeichnen Sie einmal pro Release ein Bundle-Fixture und einen Schema-Snapshot auf.**
Der Wert beider Korpora liegt einzig darin, wie weit das älteste zurückreicht,
und keines von beiden kann nachträglich nachgepflegt werden.

## Einen Vertrag ändern

1. Entscheiden Sie, um welchen der sechs Verträge es sich handelt. Die meisten
   Änderungen betreffen keinen davon – aber „keiner der sechs“ bedeutet nicht
   „unkritisch“. Das Entfernen oder Umbenennen eines Exports von `@rebasepro/server`
   oder eines Members davon ist keiner der sechs und die mit Abstand gefährlichste
   Änderung im Repository, da der Code, den sie bricht, bereits gebaut ist und
   nicht neu kompiliert wird. `pnpm check:api-surface` sichert diese Grenze ab;
   ob daraus ein siebter nummerierter Vertrag wird, ist eine offene Entscheidung
   (`docs/audits/81-compat-policy.md`).
2. Fügen Sie zuerst ein Fixture oder einen Snapshot für die **alte** Form hinzu
   und stellen Sie sicher, dass der Test erfolgreich durchläuft.
3. Nehmen Sie die Änderung vor und erhöhen Sie die Konstante (Bump).
4. Bestätigen Sie, dass das alte Fixture weiterhin durchläuft oder dass es jetzt
   *mit der Meldung fehlschlägt, die ein Benutzer benötigen würde*. Beides sind
   gültige Ergebnisse; Stillschweigen ist es nicht.
5. Planen Sie für Vertrag 3 den Rebuild jedes bereitgestellten Bundles vor dem
   Mergen ein.
6. Vertrag 6 ist die Ausnahme zu den Schritten 3 und 4: Es gibt keine Konstante
   zum Erhöhen und keine Version, anhand derer verweigert werden kann, da eine
   Spalte keinen Versionsstempel trägt. Der Schritt, der sie ersetzt, ist die
   Entscheidung, die Änderung nicht vorzunehmen – siehe den obigen Abschnitt,
   wie die Alternative aussieht.

---
