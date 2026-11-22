---
sourceHash: 45b2459dff0e5ec4
title: Live-Schema-Bearbeitung
description: Erstellen und Ändern von Tabellen auf einem laufenden Backend – die Änderung wird in backend/schema geschrieben, zuerst in Ihr Repository committet und anschließend angewendet.
---

Der Source-Only-Schema-Editor, `/api/admin/schema-editor/*`, schreibt die
Tabellendateien in `backend/schema` neu und fasst sonst nichts an. Das funktioniert auf Ihrem
Rechner und nirgendwo sonst: Die Dateien eines bereitgestellten Servers werden bei jedem Deploy
aus Ihrem Repository neu gebaut, sodass eine dort vorgenommene Änderung beim nächsten
Verwerfen würde.

Die Live-Schema-Bearbeitung ist die Lösung dafür. Sie **committet die Änderung in Ihr
Repository und wendet dann das DDL an** – so übersteht die Änderung das nächste Deploy,
weil das Deploy daraus gebaut wird. Der RLS-Editor von Studio speichert die Policies
einer Tabelle über diese Routen – geplant, als SQL angezeigt, bestätigt, dann
angewendet – und ein Skript oder Agent mit dem entsprechenden Scope kann dieselben Änderungen senden.

```
GET  /api/admin/schema/status   whether this backend can do it, and whether you may
POST /api/admin/schema/plan     what would happen, without doing it
POST /api/admin/schema/apply    commit, then apply
```

Status und Plan erfordern den Scope `schema:read`, und Apply benötigt `schema:write`, wie
jeder andere `/api/admin`-Endpunkt, der einen Scope festlegt. Ein Administrator besitzt beide.
Das Anwenden erfordert außerdem noch eine Sache mehr als den Scope – siehe [Wer darf anwenden](#wer-darf-anwenden).

## Die Änderungen: `TablePatch`

Jede Route, die das Schema ändert, akzeptiert denselben Body, `{ patches }`: eine Liste
von Änderungen, die jeweils ihre Tabelle über den Slug benennen. Der Typ ist `TablePatch` aus
`@rebasepro/types`.

| `op` | Was es in `backend/schema` schreibt |
|---|---|
| `createTable` | eine neue Datei `backend/schema/<name>.ts`, die die Tabelle enthält und aus `index.ts` exportiert wird |
| `deleteTable` | entfernt die Datei und ihren Export |
| `addColumn` `{ key, column, before? }` | eine Spalte, vor der durch `before` benannten Spalte oder am Ende |
| `changeColumn` `{ key, column }` | schreibt die Builder-Chain einer Spalte neu; ein darauf definiertes `.transform()` bleibt erhalten |
| `renameColumn` `{ key, to, column }` | benennt den Schlüssel um, behält die SQL-Spalte bei |
| `removeColumn` `{ key }`, `moveColumn` `{ key, before? }` | entfernt eine Spalte oder ändert ihre Reihenfolge |
| `addRelation`, `changeRelation` `{ name, relation }`, `removeRelation` `{ name }` | ein `rel.*`-Eintrag; das `target` der Relation ist ein Slug |
| `setRls` `{ rls }` | die Haltung: `"admin-only"`, `"inherit"` oder eine Liste von Regeln |
| `addRule` `{ rule, index? }`, `replaceRule` `{ index, rule }`, `removeRule` `{ index }` | eine Regel aus der Liste |
| `setOption` `{ option, value }` | `description`, `tenant`, `softDelete`, `history`, `search`, `indexes`, `strictWrites`, `defaultPolicies` oder `metadata`; `null` entfernt die Option |

Eine Spalte wird als ihre Definition übergeben – der Postgres-Typ als `{ kind: … }` und die
Modifikatoren als Flags – ohne ihre `.transform()`-Hooks, bei denen es sich um Code handelt,
der dort verbleibt, wo er geschrieben wurde:

```json
{ "patches": [
    { "op": "addColumn", "table": "posts", "key": "subtitle",
      "column": { "type": { "kind": "text" } } }
] }
```

Es wird nur der Code neu geschrieben, den eine Änderung benennt. Alles andere bleibt unverändert –
Imports, Kommentare, Formatierung, eine aus einem anderen Modul geteilte Spalte. Der Editor
lehnt eine Änderung unter Nennung des Ausdrucks ab, wenn sie *in* etwas hineingreift, das im
Code definiert ist: eine mit Spread erstellte Tabelle, eine durch einen Helper gebaute Spalte, in
einer Variable gehaltene Regeln, ein berechneter Schlüssel oder eine Spalte, deren JSON-Struktur
Transforms enthält. Er benennt außerdem niemals einen Slug, eine Tabelle, ein Schema oder den Namen
einer Definition um (das verschiebt Daten: schreiben Sie eine Migration), entfernt niemals die
letzte Regel (nutzen Sie `setRls` mit `"admin-only"`), verweigert `rls` auf einer View und
verweigert das Löschen einer Tabelle, auf die andere Relationen verweisen. Eine Änderung, deren
Ergebnis nicht kompiliert, wird mit `SCHEMA_EDIT_DOES_NOT_COMPILE` und den Fehlern des Compilers
abgelehnt. Bei einer Ablehnung wird nichts geschrieben.

Wie eine Tabelle im Admin-Panel aussieht – Labels, Icons, Gruppen, Ansichtsmodi, Enum-Farben –
ist keine Schema-Änderung: Dies befindet sich in `frontend/src/cms` sowie den gespeicherten
Einstellungen des Panels, und nichts davon wird in einem `TablePatch` übertragen.

`$ADMIN_TOKEN` ist ein Access-Token – das `accessToken`, das ein Login zurückgibt – für einen
Account mit `schema:read`: ein Administrator oder eine Rolle, die dies deklariert. Nichts auf
dem Rechner setzt dies automatisch für Sie.

## Planen vor dem Anwenden

`/plan` hat keine Seiteneffekte. Senden Sie die Änderungen per POST, und der Endpunkt teilt Ihnen mit, was sie bedeuten:

```bash
curl -X POST https://your-app/api/admin/schema/plan \
  -H "authorization: Bearer $ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{"patches":[{"op":"addColumn","table":"posts","key":"subtitle","column":{"type":{"kind":"text"}}}]}'
```

```json
{
  "applicable": true,
  "verdict": "safe",
  "changes": [
    { "kind": "add-property", "verdict": "safe", "collection": "posts",
      "property": "subtitle", "detail": "New optional property subtitle …" }
  ],
  "statements": ["ALTER TABLE \"public\".\"posts\" ADD COLUMN IF NOT EXISTS \"subtitle\" TEXT;"],
  "files": ["backend/schema/posts.ts", "backend/src/schema.generated.ts"],
  "message": "…the commit message the apply would use…",
  "withheldConstraints": [],
  "followUp": []
}
```

`files` umfasst jede Datei, die das Apply committet: den Quellcode der Tabelle, sofern das
Backend ihn schreiben kann, und danach das generierte Schema. Die Änderungsdatensätze des
Planners behalten ihre Wire-Namen (`add-property`, `collection`, `property`).

Dies ist keine reine Annehmlichkeit. Zwei der drei Urteile sind Ablehnungen, und eines
davon ist eine Ablehnung, die Sie andernfalls erst bemerken würden, wenn Sie die Aktion auf einer
Live-Datenbank ausführen.

## Die drei Urteile

| Urteil | Bedeutung |
|---|---|
| `safe` | Der Ensure-Pfad beim Booten kann dies abbilden und das Ergebnis entspricht Ihrer Konfiguration. Angewendet. |
| `diverges` | Es wird *teilweise* angewendet und hinterlässt eine Datenbank, die nicht Ihrer Konfiguration entspricht – ohne dass etwas darüber berichtet. Abgelehnt. |
| `needs-migration` | Der Ensure-Pfad kann dies überhaupt nicht abbilden. Abgelehnt. |

`diverges` ist das Urteil, das man verstehen sollte, da diese Änderungen so aussehen, als
hätten sie funktioniert:

- **Eine Spalte mit `.notNull()`, die zu einer Tabelle hinzugefügt wird, die bereits Zeilen enthält**,
  wird als **nullable** angelegt. `NOT NULL` wird gegen jede bereits vorhandene Zeile geprüft, und Zeilen,
  die vor der Existenz der Spalte geschrieben wurden, haben keinen Wert dafür. Bei einer **leeren**
  Tabelle gibt es nichts zu prüfen, daher wird der Constraint angewendet und dies ist
  `safe`.
- **Eine bestehende Spalte zu `.notNull()` zu machen**, verhält sich genauso: `SET NOT NULL`
  scannt die Tabelle; daher ist es auf einer leeren Tabelle `safe` und auf einer befüllten
  `diverges`, bis Sie einen Backfill durchführen.

Zwei Änderungen, die früher `diverges` waren, sind jetzt `safe`, weil der Ensure-Pfad
sie durchführt:

- **Ein zu einem bestehenden Enum hinzugefügter Wert** wird über
  `ALTER TYPE … ADD VALUE IF NOT EXISTS` eingefügt. Früher wurde er zusammen mit dem
  gesamten Typ übersprungen, und die erste Zeile, die den neuen Wert verwendete, wurde von einem Typ
  abgelehnt, der ihn noch nicht kannte.
- **Das Lockern einer `.notNull()`-Spalte** entfernt das `NOT NULL`. Früher blieb es
  bestehen, sodass Schreibvorgänge, die die Spalte ausließen, weiterhin fehlschlugen.

### Angefragte und nicht angewendete Constraints

Eine Änderung kann anwendbar sein und dennoch eine Vorgabe Ihrer Konfiguration
nicht durchsetzen – eine `.notNull()`-Spalte auf einer befüllten Tabelle ist das typische Beispiel.
Das ist keine Ablehnung, daher erscheint es nicht in `changes`, sondern in
`withheldConstraints`, zusammen mit dem Hindernis und der Maßnahme zur Behebung:

```json
{
  "withheldConstraints": [
    {
      "target": "public.posts.author",
      "kind": "not-null",
      "reason": "\"author\" is required, but \"public.posts\" already holds rows …",
      "remedy": "Backfill the column, then apply this again."
    }
  ]
}
```

Der Ensure-Pfad beim Booten meldet denselben Sachverhalt als Warnung. Bis dies
eingeführt wurde, wurde ein zurückgehaltener Constraint stillschweigend übergangen.

`needs-migration` deckt alles ab, was der Ensure-Pfad nicht leisten kann: das Löschen einer
Tabelle oder Spalte, das Ändern des Spaltentyps (ein Integer-Schalter, ein String, der
zum Enum wird, der Elementtyp eines Arrays, die Länge eines Varchars), das Umbenennen einer
Spalte, das Ändern eines Primärschlüssels, das Entfernen eines Enum-Werts, das Setzen einer bestehenden
Spalte auf Unique und das Ändern einer Relation – deren Art, Ziel, `localKey`,
oder `onDelete`. Ein `hasMany` oder `hasOne`, dessen Verbindungspalte von nichts erzeugt wird,
wird ebenfalls abgelehnt. Jede Ablehnung benennt die Änderung und die alternative Vorgehensweise.

Das Urteil wird aus dem Schema abgelesen, das jede Seite erzeugt – derselbe Plan,
nach dem `schema.generated.ts` und `db push` gerendert werden –, sodass eine Änderung, die
die Datenbank verändert, nicht als "keine Änderung" gemeldet werden kann. Zwei Änderungen, die wie
Änderungen aussehen und nicht abgelehnt werden:

- **Das Umbenennen des Schlüssels einer Spalte unter Beibehaltung der SQL-Spalte** (`renameColumn`,
  wodurch der alte Name als erstes Argument des Builders geschrieben wird: `col.text("old_name")`)
  verschiebt keine Daten. Dies ist `safe`; API-Clients lesen den neuen Namen.
- **Das Setzen, Ändern oder Entfernen eines Default-Werts** bindet nur zukünftige Schreibvorgänge.
  Es ist `safe` und wird mit `ALTER COLUMN … SET DEFAULT` / `DROP DEFAULT` angewendet.

### Nur Quellcode bearbeiten (Source only)

Eine abgelehnte Änderung kann dennoch in `backend/schema` geschrieben und committet werden,
wobei die Datenbank unverändert bleibt – das Entfernen einer Spalte, die Sie nicht mehr bedienen,
ist der Regelfall. Senden Sie `/apply` mit `"sourceOnly": true`. Es wird nichts ausgeführt; die Commit-Nachricht
benennt, was die Datenbank behält, zum Beispiel
`chore(schema): remove sku from products (source only — column products.sku kept)`,
und jede Änderung im Plan enthält einen `sourceOnly`-Satz, der beschreibt, was
zurückbleibt – einschließlich des Falls, dass eine zurückgelassene Spalte `NOT NULL` ohne
Default ist, wodurch jeder spätere Insert fehlschlägt, bis sie gelöscht oder nullable
gemacht wird. Eine Änderung ohne solchen Hinweis (das Verschieben eines Primärschlüssels, eine Relation,
deren Verbindungspalte von nichts erzeugt wird) kann nicht ausschließlich in den Quellcode geschrieben werden.

Auf einem Deployment, das an seiner Datenbank nichts ändert (`REBASE_PROVISION=false`),
wird keine Änderung über das Panel angewendet, sodass jede Änderung diesen Weg nimmt: Der
Haupt-Button des Dialogs lautet **Commit** und sendet `"sourceOnly": true`, und der
Prozess, der diese Datenbank ändert, wendet das Schema an.

Das Löschen einer Tabelle nimmt denselben Weg: `/apply` mit einer
`deleteTable`-Änderung und `"sourceOnly": true` löscht die Datei der Tabelle und ihren
Export in `index.ts` und committet beides; die Tabelle und ihre Zeilen verbleiben in der
Datenbank. Es wird abgelehnt, solange eine Relation einer anderen Tabelle darauf verweist (unter Nennung
dieser Tabelle) – das Löschen würde verhindern, dass das Schema kompiliert.

## Was committet wird

Nicht nur die Tabellendatei. Das Drizzle-Schema wird daraus generiert, und eine
veraltete Version bringt das nächste Deploy zum Scheitern, daher gehören beide in denselben Commit:

- `backend/schema/<name>.ts` – die Tabelle selbst sowie `backend/schema/index.ts`, wenn eine Tabelle erstellt oder gelöscht wird
- `backend/src/schema.generated.ts` – das Drizzle-Schema

Diese Pfade sind relativ zu Ihrem **Projekt**, nicht zu Ihrem Repository. Wenn
beide identisch sind – ein `rebase init`-Projekt, was der Regelfall ist –, gibt es
nichts weiter zu beachten. Wenn sich Ihr Projekt in einem Unterverzeichnis eines größeren
Repositorys befindet, werden die Pfade mit diesem Pfad vorangestellt, indem vom Schema-Verzeichnis
aus nach oben zur nächsten `rebase.json` gesucht wird. Ein Projekt ohne
`rebase.json` behält die einfachen Pfade bei.

Es wird kein SQL in den Commit aufgenommen. `rebase db push` und `rebase db generate` schreiben
ihre Dateien bei jeder Ausführung aus den Tabellen heraus in `.rebase/sql/`, was in der `.gitignore` steht.

Die Commit-Nachricht beschreibt die Änderung, anstatt sie nur anzukündigen, und wird
der Person zugeschrieben, die sie vorgenommen hat – anhand des Anzeigenamens und der E-Mail-Adresse
des Accounts (ein Benutzer ohne diese Angaben wird als `<uid>@users.noreply.rebase.pro` committet).

Eine Schema-Änderung mit einem Autor und einem Diff in der Historie Ihres Projekts ist etwas,
das weder Firebase noch Supabase bieten – deren Tabellenbearbeitungen sind für
Ihr Repository unsichtbar.

## Wer darf anwenden

Der Besitz von `schema:read` reicht aus, um zu **planen**. Das Planen hat keine Seiteneffekte, und ein
CI-Job, der abfragt, ob eine vorgeschlagene Schema-Änderung anwendbar ist, ist ein guter Einsatzzweck
dafür.

Das Anwenden ist ein weiteres Privileg, denn das Anwenden schreibt einen Commit und ein Commit
trägt einen Autoren:

| Aufrufer | Plan | Apply |
|---|---|---|
| Eine angemeldete Person mit `schema:write` | ja | ja |
| Ein API-Key mit `schema:read` / `schema:write` | ja | nein |
| Der Service-Key des Servers | ja | nein |

Eine Anmeldeinformation ist kein Autor. `api-key:7c3f…` in Ihrer CI-Umgebung ist keine
Person, und ihm Schreibrechte auf Ihr Repository zu gewähren, erzeugt genau die
nicht zuordenbare Historie, zu deren Ablösung dieses Feature existiert.

Wenn eine automatisierte Schema-Änderung gewünscht ist – beispielsweise eine Migrations-Pipeline –,
aktivieren Sie dies bewusst:

```typescript no-verify
initializeRebaseBackend({
    // …the rest of your config
    liveSchema: { allowMachineApply: true }
})
```

oder über `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY=true`. Der Commit wird dann
dem Berechtigungsnachweis namentlich zugeordnet – `Rebase API key (7c3f)` –, sodass
Sie beim Lesen von `git log` einen Monat später immer noch erkennen können, welche Änderungen von einer Person vorgenommen wurden.

`GET /api/admin/schema/status` meldet, was *Sie* tun dürfen, und nicht nur, was der
Server unterstützt. So kann ein Panel das Steuerelement deaktivieren und den Grund angeben,
anstatt Sie erst nach Ihrer Entscheidung abzuweisen:

```json
{
  "enabled": true,
  "canPlan": true,
  "canApply": false,
  "applyRefusedCode": "SCHEMA_EDIT_REQUIRES_A_PERSON",
  "applyRefusedBecause": "This request is authenticated with an API key …"
}
```

## Wenn Ihr Projekt versionierte Migrationen nutzt

Das Anwenden hier schreibt **keine** Migration und kann dies auch nicht: Eine Migration liegt im
Format von Atlas mit einer Integritätsdatei vor, erstellt von einer externen Binärdatei gegen eine
Wegwerf-Datenbank – und ein laufender Server verfügt über keines von beidem.

Was committet wird, ist die Tabellendatei, und genau daraus
erstellt `rebase db generate` die Migration. Die Migration ist also nur einen Befehl entfernt:

```bash
rebase db generate
```

Sowohl der Plan als auch das Ergebnis weisen darauf hin, wenn Ihr Projekt Migrationen nutzt,
da der Fehler andernfalls unbemerkt bleibt: Ihre Datenbank enthält die Änderung und Ihr Repository
beschreibt sie, aber die nächste Umgebung, die durch das erneute Abspielen von Migrationen aufgebaut wird,
enthält sie nicht – und es gab keinerlei Hinweis.

Ein Projekt, das über Boot-Ensure bereitgestellt wird – die verwaltete Runtime sowie jedes Self-Hosting,
das `REBASE_MIGRATE_ON_BOOT` auf dem Standardwert belässt –, benötigt überhaupt keine Migration. Seine
Tabellen sind das Schema, und der nächste Boot gleicht alles ab.

## Erst committen, dann anwenden

Die Reihenfolge ist wichtig und nicht willkürlich gewählt.

Würde das DDL zuerst ausgeführt und der Commit schlüge fehl, hätte Ihre Datenbank eine Spalte,
die Ihr Repository nicht beschreibt. Der Ensure-Pfad löscht niemals etwas, sodass das
nächste Deploy die Spalte weder entfernen noch erwähnen würde – eine unsichtbare Spalte, die in
Ihren Tabellen fehlt, bis jemand danach sucht.

Zuerst zu committen führt zu einer anderen Fehlerkonstellation: Das Repository beschreibt etwas,
das die Datenbank noch nicht hat. Das ist der normale Zustand jedes Projekts zwischen
einer Bearbeitung und einem Deploy, und der Boot-Vorgang gleicht dies beim nächsten Start ab.

Daher ist ein fehlgeschlagenes Apply **kein Fehler**. Die Antwort verdeutlicht dies:

```json
{
  "applied": false,
  "applyError": "connection refused",
  "committed": { "sha": "1a2b3c4de", "branch": "main" },
  "summary": "Committed 1a2b3c4de on main, but the database was not changed. The change will be applied on the next boot."
}
```

## Regeln werden im selben Apply wirksam

Eine Änderung am `rls` einer Tabelle (oder eine neue Tabelle) wird im selben Apply durchgesetzt: Die
Policies der geänderten Tabellen werden direkt nach dem DDL in die Datenbank geschrieben,
und die Antwort gibt unter `policies` Auskunft darüber, was passiert ist:

```json
{ "policies": { "status": "applied", "tables": ["posts"], "statements": 3 } }
```

Wo Policies nicht geschrieben werden können – ein Backend, das nicht bereitstellen darf
(`provision.tables` deaktiviert) oder ein Treiber ohne diese Fähigkeit –, lautet der Status
`"deferred"`; schlägt das Schreiben fehl, lautet er `"failed"` mit dem entsprechenden Fehler. Beide
enthalten die Nachricht "Rules saved to source; they take effect on the next
deploy.", und das Panel zeigt bis dahin weiterhin die Regeln an, die Postgres erzwingt –
niemals Regeln, die nicht in Kraft sind.

Im Quellcode bearbeitete Hooks werden ebenfalls mit dem Apply wirksam: Der Server führt die
kompilierten Tabellen des bearbeiteten Schemas ohne Neustart aus.

## Auslieferung ohne Neustart

Eine über das Studio angewendete Änderung wird sofort ausgeliefert. Der Postgres-Treiber liest
die geänderten Tabellen aus der Datenbank zurück und tauscht sie im laufenden Betrieb aus: Die Data-API,
Includes, Hooks und Realtime sehen eine neue Tabelle, Spalte, Relation oder Junction
ohne Neustart, und eine neue Tabelle erhält ihre Berechtigungen (Grants) und Change Capture. Die
Antwort bestätigt dies unter `serving`:

```json
{ "serving": { "status": "now" } }
```

Bei einem Deployment, dessen Tabellen aus der Datenbank abgeleitet werden (kein
`backend/schema`), oder bei einem Treiber, der seine Tabellen nicht aktualisieren kann,
haben die Datenbank und der Quellcode zwar die Änderung, aber der Prozess bedient weiterhin
die Tabellen, mit denen er gestartet wurde. Der Status lautet dann `"after-restart"`, zusammen mit einer `message`,
die die Bestätigung im Studio als Warnung anzeigt; starten Sie den Prozess neu, um die
Änderung auszuliefern.

## Wenn sich die Datei während der Bearbeitung geändert hat

Eine Änderung wird auf Basis der Dateien in ihrem aktuellen Zustand vorbereitet. Ändert sich eine davon
auf der Festplatte, bevor die Bearbeitung angewendet wird – durch Speichern in einer IDE, einen anderen Prozess –,
schreibt das Apply nichts und antwortet mit 409 `SCHEMA_EDIT_STALE_FILE`. Nehmen Sie die Bearbeitung
erneut auf Basis der Datei vor, wie sie jetzt vorliegt.

## Wo dies funktioniert

Die Live-Schema-Bearbeitung schreibt `backend/schema` mit demselben Editor neu, den auch die
Source-Only-Speichervorgänge des Panels verwenden (hierfür muss `ts-morph` installiert sein). Woher dieser Quellcode
stammt, bestimmt, wo sie ausgeführt werden kann:

- **Auf der Festplatte** (`schemaDir`, der Standard): Sie läuft dort, wo der Source-Only-Editor
  läuft. Dieser Editor ist unter `NODE_ENV=production` deaktiviert, es sei denn, der Server
  setzt `schemaEditor: true`.
- **In einem von Ihnen benannten Repository** (`liveSchema.repository` oder
  `REBASE_LIVE_SCHEMA_REPOSITORY` für ein Bundle): Der Quellcode wird von
  GitHub gelesen und die Änderung dorthin zurückgecommittet, sodass dies überall funktioniert,
  einschließlich der Produktion. Dies ist das Opt-in für ein gebautes Bundle.

| Deployment | Funktioniert |
|---|---|
| `rebase dev` auf Ihrem Rechner | ja |
| Self-Host mit gemountetem Projekt und dessen Git-Working-Tree | ja, wenn `NODE_ENV` nicht `production` ist, oder mit `schemaEditor: true` |
| Ein gebautes Bundle: ein Self-Host, der einen Build ausliefert, oder das veröffentlichte Image | nur bei explizitem Opt-in über `REBASE_LIVE_SCHEMA_REPOSITORY` – siehe [Aus einem gebauten Bundle](#aus-einem-gebauten-bundle) |
| Jeder Server mit konfiguriertem `liveSchema.repository` | ja, einschließlich `NODE_ENV=production` |

Ein Bundle ist kompilierter Output, daher enthält es keinen `backend/schema`-Quellcode, und
die Runtime, die es ausführt, schaltet den Source-Only-Editor ab. Sofern kein
Repository angegeben ist, antwortet `/api/admin/schema/status` mit `enabled: false` und dem Code
`SCHEMA_EDITOR_DISABLED`: Bearbeiten Sie `backend/schema` in der Entwicklung, committen Sie und
führen Sie ein Deploy durch.

### Aus einem gebauten Bundle

Ein Bundle hat keinen eigenen Code zur Konfiguration, daher erfolgt das Opt-in über Umgebungsvariablen.
Für ein Bundle, das diese nicht setzt, ändert sich nichts.

```bash
REBASE_LIVE_SCHEMA_REPOSITORY=acme/storefront     # turns it on
REBASE_LIVE_SCHEMA_GITHUB_TOKEN=github_pat_…       # or the three _GITHUB_APP_* variables
# REBASE_LIVE_SCHEMA_BRANCH=main                   # default
# REBASE_LIVE_SCHEMA_PATH=backend/schema           # default
```

Die vollständige Liste finden Sie unter [Konfiguration](/docs/getting-started/configuration#live-schema-editing-from-a-bundle).
Ein angegebenes Repository ohne nutzbare Zugangsdaten (keine, beide Arten, eine unvollständige GitHub
App) oder ein Wert, der nicht dem Format `owner/name` entspricht, verweigert den Boot-Vorgang, anstatt
einen Editor bereitzustellen, der fehlschlägt, sobald jemand auf „Apply“ klickt. Dasselbe gilt für die entfernte
Variable `REBASE_LIVE_SCHEMA_COLLECTIONS_PATH`, mit einer Meldung, die auf
`REBASE_LIVE_SCHEMA_PATH` hinweist, sowie für Pfade, die das Repository verlassen.

Was gleich bleibt, wenn es aktiviert ist:

- Es ist eine `/api/admin`-Schnittstelle: überhaupt keine Antwort ohne `schema:read`, und
  `/apply` benötigt `schema:write` sowie eine reale Person (siehe [Wer darf anwenden](#wer-darf-anwenden)).
- Das Schreibziel ist ausschließlich das von Ihnen benannte Repository. Der Source-Only-Editor,
  der Dateien neben dem Prozess schreibt, bleibt deaktiviert.
- Jede Änderung wird geplant, angezeigt, committet und dann angewendet – genau wie auf Ihrem
  Rechner.

Der Prozess, der die Änderung angewendet hat, liefert sie sofort aus: Seine REST-Routen, die
`GET /api/schema/tables`-Deskriptoren und das Admin-Panel folgen der Bearbeitung
ohne Neustart. Andere Replikate sowie dieser Prozess nach einem Neustart liefern die
Tabellen aus, mit denen das Bundle gebaut wurde, bis Ihre Pipeline den Commit baut und ausrollt.

Eine Änderung wartet also darauf, dass die vorherige ausgeliefert wurde. Eine Änderung, die gegen
Tabellen geplant wurde, denen das Repository bereits voraus ist, würde generierte Schema-Dateien committen,
die die frühere Änderung auslassen. Bei jedem Apply wird daher
`schema.generated.ts` aus den Tabellen gerendert, die dieser Prozess bedient, und mit der
Kopie im Repository verglichen. Weichen sie voneinander ab, wird das Apply mit
`SCHEMA_CHANGE_FAILED` unter Nennung der Datei abgelehnt, bis ein Prozess, der diesen Commit ausführt,
diesen Prozess ersetzt. Die Prüfung liest das Repository, nicht den Speicher dieses Prozesses,
sodass sie über Neustarts, über Replikate hinweg und auch für Änderungen gilt, die ein Entwickler
gepusht hat, die aber noch nicht ausgerollt sind. Das Planen bleibt währenddessen verfügbar.

Die Kopien unterscheiden sich auch dann, wenn die Datei von einer anderen Rebase-Version generiert,
neu formatiert oder manuell bearbeitet wurde. Wenn nichts auf das Deployment wartet, führen Sie
`rebase schema generate` mit der Version aus, die das Deployment nutzt, committen Sie das
Ergebnis und deployen Sie es. Zeilenumbrüche und nachgestellte Leerzeichen gelten nicht als
Unterschied.

### Committen in ein Remote-Repository

`liveSchema.repository` veranlasst den Server, jede Änderung über die Git Data API in ein
GitHub-Repository zu committen, anstatt `git commit` in einem
Working-Tree auszuführen. Es hängt nicht davon ab, dass der Source-Only-Editor aktiv ist: Mit einem
konfigurierten Repository funktioniert das Live-Editing unter `NODE_ENV=production` und mit
`schemaEditor: false`, da auf diesem Rechner nichts geschrieben wird. Ein Bundle
konfiguriert dies über die oben genannten Variablen.

```typescript no-verify
initializeRebaseBackend({
    // …the rest of your config
    liveSchema: {
        repository: {
            kind: "github",
            owner: "acme",
            repo: "storefront",
            branch: "main",
            // Where backend/schema lives in that repository.
            // Defaults to "backend/schema".
            schemaPath: "backend/schema",
            auth: { kind: "token", token: process.env.GITHUB_TOKEN! }
        }
    }
})
```

Das Schema-Verzeichnis wird dann aus dem Repository gelesen, mit demselben Editor
neu geschrieben, der auch lokal läuft, und die Änderungen werden über die
Git Data API zurückgecommittet: ein Blob pro Datei, ein Tree, ein Commit und ein Ref-Update. Es wird nichts
geklont und nichts auf der Festplatte hinterlassen. Das gesamte Verzeichnis wird gelesen, nicht nur die
bearbeitete Datei, sodass eine Relation auf eine andere Tabelle verweisen kann und das Löschen einer Tabelle
genauso funktioniert wie lokal: abgelehnt, solange die Relation einer anderen Tabelle darauf verweist, und
im selben Commit aus `index.ts` entfernt. Da nur `backend/schema` abgerufen wird,
kann eine Tabellendatei, die etwas von außerhalb importiert, auf diese Weise nicht bearbeitet werden.

`auth` akzeptiert ein Token oder eine GitHub-App-Installation:

```typescript no-verify
auth: {
    kind: "app",
    appId: "123456",
    privateKey: process.env.GITHUB_APP_PRIVATE_KEY!,
    installationId: "987654"
}
```

Verwenden Sie das Token für ein einzelnes Projekt, das in ein Repository committet, das Sie bereits besitzen –
das Einrichten einer App, nur damit Ihr eigener Server darauf committen kann, ist viel Aufwand für
eine einzeilige Anmeldeinformation. Verwenden Sie die App für eine Control-Plane, die einen Schlüssel über
viele Projekte hinweg verwaltet, wie es Rebase Cloud tut: eine App, eine Installation pro
Projekt und kein kundenbezogenes Secret, das rotiert werden muss.

Das Token benötigt die Berechtigung `contents: read and write` für dieses Repository und nichts weiter.

Ohne `liveSchema.repository` ist der Commit ein einfacher Aufruf von `git commit` im
Working-Tree, der `schemaDir` enthält: keine Authentifizierung, kein Token, kein
Netzwerk.

Zwei Faktoren machen die Ausführung auf einem Repository sicher, an dem auch andere arbeiten:

- Es werden **nur** die generierten Dateien gestaged. Ein Schema-Commit, der
  halbfertige Arbeiten erfassen würde, wäre ein Commit, den niemand reviewen könnte; der Vorgang wird
  sofort verweigert, wenn im Tree bereits eine der eigenen Dateien modifiziert ist.
- Der Remote-Pfad führt niemals ein Force-Update einer Ref durch. Wenn während der
  Erstellung des Commits etwas übertragen wurde, wird das Update abgelehnt – das
  unbemerkte Überschreiben fremder Commits ist schlimmer als ein Fehlschlag.

## Einschränkungen

- Nur additive Änderungen. Alles andere wird mit einer Begründung abgelehnt, da der
  Ensure-Pfad das Einzige ist, was ein Schema ändert, und dieser nur hinzufügen kann.
- Es wird keine Migrationsdatei geschrieben. Ein über Boot-Ensure bereitgestelltes Projekt benötigt keine;
  ein über Migrationen bereitgestelltes Projekt sollte `rebase db generate` ausführen, wodurch
  eine Migration über Atlas mit dem erforderlichen Integritäts-Hash erstellt wird.
- Nur Postgres. Die Fähigkeit wird am Treiber erkannt, und ein Treiber
  ohne entsprechende Unterstützung antwortet mit `SCHEMA_EDITING_UNSUPPORTED`.
- Ein Deployment, dessen Tabellen aus der Datenbank abgeleitet werden, liefert eine angewendete
  Änderung erst nach dem nächsten Start aus (`serving.status: "after-restart"`, siehe
  [Auslieferung ohne Neustart](#auslieferung-ohne-neustart)).

## Verwandte Themen

- [Schema-Generierung](/docs/cli/schema/) – dieselben Änderungen über die Befehlszeile
- [Tabellen](/docs/schema/) – was der Editor umschreibt
- [Studio](/docs/studio/) – das Panel hinter diesen Routen
