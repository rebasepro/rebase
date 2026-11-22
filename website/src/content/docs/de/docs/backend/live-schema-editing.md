---
sourceHash: 972a11a8dc0defac
title: Live-Schema-Bearbeitung
description: Tabellen für ein laufendes Backend erstellen und ändern – die Bearbeitung wird in backend/schema geschrieben, zuerst in Ihr Repository committet und dann angewendet.
---

Der Schema-Editor im Admin-Panel überschreibt die Tabellendateien in
`backend/schema`. Das funktioniert auf Ihrem Rechner und sonst nirgends: Die
Dateien eines bereitgestellten Servers werden bei jedem Deploy aus Ihrem Repository
neu erstellt, sodass eine dort vorgenommene Bearbeitung beim nächsten Deploy
verworfen würde.

Die Live-Schema-Bearbeitung ist die Antwort darauf. Sie **committet die Änderung in
Ihr Repository und wendet dann die DDL an** – so übersteht die Bearbeitung das
nächste Deploy, da das Deployment daraus gebaut wird.

```
GET  /api/admin/schema/status   whether this backend can do it, and whether you may
POST /api/admin/schema/plan     what would happen, without doing it
POST /api/admin/schema/apply    commit, then apply
```

Status und Plan erfordern den `schema:read`-Scope, und Apply erfordert `schema:write`,
wie jeder andere `/api/admin`-Endpunkt, der einen Scope vorsieht. Ein Admin besitzt
beide. Das Anwenden erfordert zudem noch eine Sache mehr als nur den Scope – siehe
[Wer Änderungen anwenden darf](#wer-änderungen-anwenden-darf).

## Die Bearbeitungen: `TablePatch`

Jede Route, die das Schema ändert, akzeptiert denselben Body, `{ patches }`: eine Liste
von Änderungen, die jeweils ihre Tabelle über den Slug benennen. Der Typ ist `TablePatch`
aus `@rebasepro/types`.

| `op` | Was es in `backend/schema` schreibt |
|---|---|
| `createTable` | eine neue Datei `backend/schema/<name>.ts`, die die Tabelle enthält und aus `index.ts` exportiert wird |
| `deleteTable` | entfernt die Datei und ihren Export |
| `addColumn` `{ key, column, before? }` | eine Spalte vor der durch `before` benannten oder als letzte |
| `changeColumn` `{ key, column }` | schreibt die Builder-Kette einer Spalte neu; ein darauf definiertes `.transform()` bleibt erhalten |
| `renameColumn` `{ key, to, column }` | benennt den Schlüssel um, behält die SQL-Spalte bei |
| `removeColumn` `{ key }`, `moveColumn` `{ key, before? }` | entfernt eine Spalte oder ändert ihre Reihenfolge |
| `addRelation`, `changeRelation` `{ name, relation }`, `removeRelation` `{ name }` | ein `rel.*`-Eintrag; das `target` der Relation ist ein Slug |
| `setRls` `{ rls }` | das Verhalten: `"admin-only"`, `"inherit"` oder eine Liste von Regeln |
| `addRule` `{ rule, index? }`, `replaceRule` `{ index, rule }`, `removeRule` `{ index }` | eine Regel aus der Liste |
| `setOption` `{ option, value }` | `description`, `tenant`, `softDelete`, `history`, `search`, `indexes`, `strictWrites`, `defaultPolicies` oder `metadata`; `null` entfernt die Option |

Eine Spalte wird als ihre Definition übertragen – der Postgres-Typ als `{ kind: … }`
und die Modifikatoren als Flags – ohne ihre `.transform()`-Hooks, die Code sind und
dort bleiben, wo sie geschrieben wurden:

```json
{ "patches": [
    { "op": "addColumn", "table": "posts", "key": "subtitle",
      "column": { "type": { "kind": "text" } } }
] }
```

Es wird nur der Code umgeschrieben, den eine Bearbeitung benennt. Alles andere
bleibt unverändert – Imports, Kommentare, Formatierung, eine aus einem anderen Modul
geteilte Spalte. Der Editor verweigert – unter Nennung des Ausdrucks – eine Bearbeitung,
die *in* etwas hineinreicht, das im Code definiert ist: eine Tabelle, die mit einem
Spread-Operator erstellt wurde, eine von einem Helper erstellte Spalte, in einer Variable
gehaltene Regeln, ein berechneter Schlüssel, eine Spalte, deren JSON-Struktur Transforms
enthält. Er benennt auch niemals einen Slug, eine Tabelle, ein Schema oder den Namen einer
Definition um (das verschiebt Daten: schreiben Sie eine Migration), entfernt niemals die
letzte Regel (nutzen Sie stattdessen `setRls` mit `"admin-only"`), verweigert `rls` auf
einer View und verweigert das Löschen einer Tabelle, auf die andere Relationen verweisen.
Eine Bearbeitung, deren Ergebnis nicht kompiliert werden kann, wird mit
`SCHEMA_EDIT_DOES_NOT_COMPILE` und den Fehlern des Compilers abgelehnt. Bei einer
Verweigerung wird nichts geschrieben.

Wie eine Tabelle im Admin-Panel aussieht – Labels, Icons, Gruppen, Ansichtsmodi,
Enum-Farben – ist keine Schema-Bearbeitung: Dies liegt in `frontend/src/cms` sowie den
gespeicherten Einstellungen des Panels, und nichts davon wird in einem `TablePatch`
übertragen.

`$ADMIN_TOKEN` ist ein Access-Token – das `accessToken`, das ein Login zurückgibt – für
einen Account mit `schema:read`: ein Admin oder eine Rolle, die dies deklariert. Nichts auf
dem Rechner setzt dies automatisch für Sie.

## Vor dem Anwenden planen

`/plan` hat keine Nebeneffekte. Senden Sie die Änderungen per POST, und der Endpunkt
zeigt Ihnen, was sie bedeuten:

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

`files` enthält jede Datei, die beim Anwenden committet wird: der Quellcode der
Tabelle, sofern das Backend ihn schreiben kann, und anschließend das generierte Schema.
Die Änderungsdatensätze des Planners behalten ihre Wire-Namen (`add-property`,
`collection`, `property`) bei.

Das ist keine reine Bequemlichkeit. Zwei der drei Urteile (Verdicts) sind Verweigerungen,
und eine davon ist eine Verweigerung, die Sie sonst erst beim Klick auf die Schaltfläche
auf einer Live-Datenbank bemerkt hätten.

## Die drei Urteile (Verdicts)

| Urteil | Bedeutung |
|---|---|
| `safe` | Der Boot-Time-Ensure-Pfad kann dies abbilden und das Ergebnis entspricht Ihrer Konfiguration. Angewendet. |
| `diverges` | Es wird *teilweise* angewendet, hinterlässt jedoch eine Datenbank, die nicht Ihrer Konfiguration entspricht – und nichts meldet dies. Verweigert. |
| `needs-migration` | Der Ensure-Pfad kann dies überhaupt nicht abbilden. Verweigert. |

`diverges` ist das Urteil, das man verstehen sollte, denn diese Änderungen sehen
zunächst so aus, als hätten sie funktioniert:

- **Eine Spalte mit `.notNull()`, die zu einer Tabelle mit bereits vorhandenen Zeilen hinzugefügt wird**,
  wird als **nullable** angelegt. `NOT NULL` wird gegen jede bereits vorhandene Zeile
  geprüft, und Zeilen, die vor der Existenz der Spalte geschrieben wurden, haben keinen
  Wert dafür. Bei einer **leeren** Tabelle gibt es nichts zu prüfen, daher wird der
  Constraint angewendet und dies ist `safe`.
- **Das Setzen einer bestehenden Spalte auf `.notNull()`** verhält sich genauso: `SET NOT NULL`
  scannt die Tabelle, daher ist es bei einer leeren Tabelle `safe` und bei einer befüllten
  Tabelle `diverges`, bis Sie einen Backfill durchführen.

Zwei Änderungen, die früher `diverges` waren, sind jetzt `safe`, da der Ensure-Pfad
sie ausführt:

- **Ein zu einem bestehenden Enum hinzugefügter Wert** wird über
  `ALTER TYPE … ADD VALUE IF NOT EXISTS` eingefügt. Früher wurde dieser zusammen mit dem
  gesamten Typ übersprungen, und die erste Zeile, die den neuen Wert nutzte, wurde von einem
  Typ abgewiesen, der diesen noch nicht kannte.
- **Das Lockern einer `.notNull()`-Spalte** entfernt das `NOT NULL`. Früher blieb es
  bestehen, sodass Schreibvorgänge, die die Spalte ausließen, weiterhin fehlschlugen.

### Angefragte, aber nicht angewendete Constraints

Eine Änderung kann anwendbar sein und dennoch etwas unerzwungen lassen, was Ihre
Konfiguration verlangt – eine `.notNull()`-Spalte in einer bereits befüllten Tabelle
ist ein solcher Fall. Das ist keine Verweigerung, daher taucht es nicht in `changes` auf;
es erscheint in `withheldConstraints` zusammen mit dem Hindernis und der Maßnahme, um es
zu beheben:

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

Der Boot-Time-Ensure-Pfad meldet dasselbe als Warnung. Bis es dies gab, wurde ein
zurückgehaltener Constraint stillschweigend ignoriert.

`needs-migration` deckt alles ab, was der Ensure-Pfad nicht leisten kann: das Löschen
einer Tabelle oder Spalte, das Ändern des Typs einer Spalte (ein Integer-Toggle, ein
String, der zum Enum wird, der Elementtyp eines Arrays, die Breite eines Varchars),
das Umbenennen einer Spalte, das Ändern eines Primärschlüssels, das Entfernen eines
Enum-Werts, das Setzen einer bestehenden Spalte auf Unique sowie das Ändern einer Relation –
deren Art, Ziel, `localKey` oder `onDelete`. Ein `hasMany` oder `hasOne`, dessen
Verknüpfungsspalte von nichts erzeugt wird, wird ebenfalls verweigert. Jede Ablehnung
benennt die Änderung und die empfohlene Alternative.

Das Urteil wird aus dem Schema abgelesen, das jede Seite erzeugt – derselbe Plan, aus dem
auch `schema.generated.ts` und `db push` generiert werden –, sodass eine Bearbeitung,
die die Datenbank verändert, nicht als "keine Änderung" gemeldet werden kann. Zwei
Bearbeitungen, die wie Änderungen aussehen, aber nicht abgelehnt werden:

- **Das Umbenennen des Schlüssels einer Spalte unter Beibehaltung der SQL-Spalte** (`renameColumn`,
  wodurch der alte Name als erstes Argument des Builders geschrieben wird: `col.text("old_name")`)
  verschiebt keine Daten. Dies ist `safe`; API-Clients lesen den neuen Namen.
- **Das Setzen, Ändern oder Entfernen eines Default-Werts** bindet nur zukünftige Schreibvorgänge.
  Dies ist `safe` und wird mit `ALTER COLUMN … SET DEFAULT` / `DROP DEFAULT` angewendet.

### Nur den Quellcode bearbeiten

Eine abgelehnte Änderung kann dennoch in `backend/schema` geschrieben und committet werden,
wobei die Datenbank unverändert bleibt – das Entfernen einer Spalte, die Sie nicht mehr
ausliefern, ist der Regelfall. Senden Sie `/apply` per POST mit `"sourceOnly": true`.
Es wird nichts ausgeführt; die Commit-Nachricht nennt, was die Datenbank beibehält, zum Beispiel
`chore(schema): remove sku from products (source only — column products.sku kept)`,
und jede Änderung im Plan enthält einen `sourceOnly`-Hinweis, der angibt, was zurückbleibt –
einschließlich Fällen, in denen eine zurückbleibende Spalte `NOT NULL` ohne Default-Wert ist,
wodurch jeder spätere Insert fehlschlägt, bis sie gelöscht oder auf nullable gesetzt wird.
Eine Änderung ohne eine solche Entsprechung (das Verschieben eines Primärschlüssels, eine
Relation, deren Verknüpfungsspalte von nichts erzeugt wird) kann nicht allein in den
Quellcode geschrieben werden.

Bei einem Deployment, das nichts an seiner Datenbank ändert (`REBASE_PROVISION=false`),
wird keine Änderung über das Panel angewendet, sodass jede Änderung diesen Weg nimmt:
Die Hauptschaltfläche des Dialogs lautet **Commit** und sendet `"sourceOnly": true`, und
der Prozess, der die Datenbank ändert, wendet das Schema an.

Das Löschen einer Tabelle aus dem Admin-Panel erfolgt auf demselben Weg: `/apply` mit
einer `deleteTable`-Änderung und `"sourceOnly": true` löscht die Tabellendatei sowie
ihren Export in `index.ts` und committet beides; die Tabelle und ihre Zeilen verbleiben
in der Datenbank. Dies wird verweigert, solange eine Relation einer anderen Tabelle darauf
verweist, unter Nennung dieser Tabelle – das Löschen würde dazu führen, dass das Schema
nicht mehr kompiliert werden kann.

## Was committet wird

Nicht nur die Tabellendatei. Das Drizzle-Schema wird daraus generiert, und eine veraltete
Version würde das nächste Deployment verhindern. Daher landen beide im selben Commit:

- `backend/schema/<name>.ts` — die Tabelle selbst und `backend/schema/index.ts`, wenn eine Tabelle erstellt oder gelöscht wird
- `backend/src/schema.generated.ts` — das Drizzle-Schema

Diese Pfade sind relativ zu Ihrem **Projekt**, nicht zu Ihrem Repository. Wenn beides
identisch ist – ein `rebase init`-Projekt, was der Regelfall ist –, müssen Sie sich
darüber keine Gedanken machen. Wenn Ihr Projekt in einem Unterverzeichnis eines größeren
Repositorys liegt, werden die Pfade entsprechend vorangestellt, indem vom Schema-Verzeichnis
aus aufwärts nach der nächstgelegenen `rebase.json` gesucht wird. Ein Projekt ohne
`rebase.json` behält die einfachen Pfade bei.

Es wird kein SQL committet. `rebase db push` und `rebase db generate` schreiben ihr
SQL bei jeder Ausführung basierend auf den Tabellen nach `.rebase/sql/`, was in `.gitignore`
enthalten ist.

Die Commit-Nachricht beschreibt die Änderung, anstatt nur eine anzukündigen, und wird
der Person zugeordnet, die sie vorgenommen hat – über den Anzeigenamen und die E-Mail-Adresse
des Kontos (ein Benutzer ohne beides wird als `<uid>@users.noreply.rebase.pro` committet).

Eine Schema-Änderung mit einem Autor und einem Diff in der Historie Ihres Projekts bietet
Ihnen weder Firebase noch Supabase – deren Tabellenbearbeitungen sind für Ihr Repository
unsichtbar.

## Wer Änderungen anwenden darf

Der Besitz von `schema:read` reicht aus, um zu **planen** (`plan`). Die Planung hat keine
Nebeneffekte, und ein CI-Job, der prüft, ob eine vorgeschlagene Schema-Änderung anwendbar ist,
ist ein guter Einsatzzweck dafür.

Das Anwenden (`apply`) ist ein weiteres Privileg, da beim Anwenden ein Commit geschrieben
wird und ein Commit einen Autor benötigt:

| Aufrufer | Plan | Apply |
|---|---|---|
| Eine angemeldete Person mit `schema:write` | ja | ja |
| Ein API-Key mit `schema:read` / `schema:write` | ja | nein |
| Der Service-Key des Servers | ja | nein |

Zugangsdaten sind kein Autor. `api-key:7c3f…` in Ihrer CI-Umgebung ist keine Person, und
wenn Sie diesen in Ihr Repository schreiben lassen, entsteht genau die nicht zuordenbare
Historie, die diese Funktion ersetzen soll.

Wenn eine automatisierte Schema-Änderung das ist, was Sie möchten – beispielsweise in
einer Migrations-Pipeline –, aktivieren Sie dies bewusst:

```typescript no-verify
initializeRebaseBackend({
    // …the rest of your config
    liveSchema: { allowMachineApply: true }
})
```

oder über `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY=true`. Der Commit wird dann den Zugangsdaten
namentlich zugeordnet – `Rebase API key (7c3f)` –, sodass Sie beim Lesen von `git log`
einen Monat später immer noch erkennen können, welche Änderungen von einer echten Person
vorgenommen wurden.

`GET /api/admin/schema/status` meldet, was *Sie* tun dürfen, und nicht nur, was der Server
unterstützt. So kann ein Panel das Bedienelement deaktivieren und den Grund angeben, anstatt
Sie erst nach Ihrer Entscheidung abzuweisen:

```json
{
  "enabled": true,
  "canPlan": true,
  "canApply": false,
  "applyRefusedCode": "SCHEMA_EDIT_REQUIRES_A_PERSON",
  "applyRefusedBecause": "This request is authenticated with an API key …"
}
```

## Wenn Ihr Projekt versionierte Migrationen verwendet

Das Anwenden an dieser Stelle schreibt **keine** Migration und kann dies auch nicht:
Eine Migration verwendet das Atlas-Format mit einer Integritätsdatei, die von einer
externen Binärdatei gegen eine temporäre Datenbank generiert wird – und ein laufender
Server verfügt über keines von beidem.

Was committet wird, ist die Tabellendatei, und das ist die Basis, aus der
`rebase db generate` die Migration generiert. Die Migration ist also nur einen Befehl
entfernt:

```bash
rebase db generate
```

Sowohl der Plan als auch das Ergebnis weisen darauf hin, wenn Ihr Projekt Migrationen
verwendet, denn andernfalls bliebe der Fehler unbemerkt: Ihre Datenbank enthält die
Änderung und Ihr Repository beschreibt sie, aber die nächste Umgebung, die durch das
erneute Ausführen von Migrationen aufgebaut wird, enthält sie nicht – und niemand wurde gewarnt.

Ein Projekt, das über Boot-Ensure bereitgestellt wird – die Managed Runtime sowie jedes
Self-Hosting, das `REBASE_MIGRATE_ON_BOOT` auf dem Standardwert belässt –, benötigt
überhaupt keine Migrationen. Seine Tabellen sind das Schema, und beim nächsten Boot-Vorgang
wird der Abgleich durchgeführt.

## Zuerst committen, dann anwenden

Die Reihenfolge ist wichtig und nicht willkürlich gewählt.

Wenn die DDL zuerst ausgeführt würde und der Commit fehlschlüge, hätte Ihre Datenbank
eine Spalte, die in Ihrem Repository nicht beschrieben ist. Da der Ensure-Pfad niemals
etwas löscht, würde das nächste Deployment sie weder entfernen noch erwähnen – eine
unsichtbare Spalte, die in Ihren Tabellen fehlt, bis jemand gezielt danach sucht.

Wenn zuerst committet wird, schlägt es im umgekehrten Fall fehl: Das Repository beschreibt
etwas, das die Datenbank noch nicht hat. Das ist der ganz normale Zustand jedes Projekts
zwischen einer Bearbeitung und einem Deployment, und der Boot-Vorgang gleicht dies beim
nächsten Start ab.

Ein fehlgeschlagenes Anwenden ist daher **kein Fehler**. Die Antwort bestätigt dies:

```json
{
  "applied": false,
  "applyError": "connection refused",
  "committed": { "sha": "1a2b3c4de", "branch": "main" },
  "summary": "Committed 1a2b3c4de on main, but the database was not changed. The change will be applied on the next boot."
}
```

## Regeln werden im selben Apply wirksam

Eine Änderung am `rls` einer Tabelle (oder eine neue Tabelle) wird im selben Apply
durchgesetzt: Die Policies der geänderten Tabellen werden direkt nach der DDL in die
Datenbank geschrieben, und die Antwort gibt unter `policies` an, was passiert ist:

```json
{ "policies": { "status": "applied", "tables": ["posts"], "statements": 3 } }
```

Wenn Policies nicht geschrieben werden können – ein Backend, das nicht provisionieren darf
(`provision.tables` deaktiviert), oder ein Treiber ohne diese Funktion –, lautet der Status
`"deferred"`; schlägt das Schreiben fehl, lautet er `"failed"` mit der entsprechenden
Fehlermeldung. Beide enthalten die Meldung „Rules saved to source; they take effect on the next
deploy.“, und das Panel zeigt bis dahin weiterhin die Regeln an, die Postgres tatsächlich
erzwingt – niemals Regeln, die nicht aktiv sind.

Im Quellcode bearbeitete Hooks werden ebenfalls mit dem Apply wirksam: Der Server führt die
kompilierten Tabellen des bearbeiteten Schemas ohne Neustart aus.

## Ohne Neustart ausgeliefert

Eine über das Studio angewendete Änderung wird sofort bereitgestellt. Der Postgres-Treiber
liest die geänderten Tabellen aus der Datenbank zurück und tauscht sie aus: Die Daten-API,
Includes, Hooks und Realtime sehen eine neue Tabelle, Spalte, Relation oder Junction ohne
Neustart, und eine neue Tabelle erhält ihre Berechtigungen und Change Capture. Die Antwort
bestätigt dies unter `serving`:

```json
{ "serving": { "status": "now" } }
```

Bei einem Deployment, dessen Tabellen aus der Datenbank abgeleitet werden (kein
`backend/schema`), oder bei einem Treiber, der seine Tabellen nicht aktualisieren kann,
verfügen Datenbank und Quellcode zwar über die Änderung, der Prozess liefert jedoch weiterhin
die Tabellen aus, mit denen er gestartet wurde. Der Status lautet dann `"after-restart"`
mit einer `message`, die in der Bestätigung des Studios als Warnung angezeigt wird; starten
Sie den Prozess neu, um die Änderung bereitzustellen.

## Wenn sich die Datei während der Bearbeitung geändert hat

Eine Bearbeitung wird auf Basis der Dateien im aktuellen Zustand vorbereitet. Wenn sich
eine davon auf der Festplatte ändert, bevor die Bearbeitung angewendet wird – durch das
Speichern in einer IDE oder durch einen anderen Prozess –, schreibt Apply nichts und antwortet
mit 409 `SCHEMA_EDIT_STALE_FILE`. Nehmen Sie die Bearbeitung erneut auf Basis der aktuellen
Datei vor.

## Wo dies funktioniert

Die Live-Schema-Bearbeitung überschreibt `backend/schema` mit demselben Editor, den auch
die Source-only-Speichervorgänge des Panels verwenden (hierfür muss `ts-morph` installiert sein).
Woher dieser Quellcode stammt, entscheidet darüber, wo sie ausgeführt werden kann:

- **Auf der Festplatte** (`schemaDir`, der Standard): Sie läuft dort, wo der Source-only-Editor
  läuft. Dieser Editor ist unter `NODE_ENV=production` deaktiviert, es sei denn, der Server
  setzt `schemaEditor: true`.
- **In einem von Ihnen angegebenen Repository** (`liveSchema.repository` oder
  `REBASE_LIVE_SCHEMA_REPOSITORY` für ein Bundle): Der Quellcode wird von GitHub gelesen
  und die Änderung wird dorthin zurück committet. Daher funktioniert dies überall, auch
  in der Produktion. Dies ist das Opt-in für ein gebautes Bundle.

| Deployment | Funktioniert |
|---|---|
| `rebase dev` auf Ihrem Rechner | ja |
| Self-Host mit gemountetem Projekt und dessen Git-Working-Tree | ja, wenn `NODE_ENV` nicht `production` ist oder mit `schemaEditor: true` |
| Ein gebautes Bundle: Ein Self-Host, der einen Build ausliefert, oder das veröffentlichte Image | nur bei Opt-in über `REBASE_LIVE_SCHEMA_REPOSITORY` – siehe [Aus einem gebauten Bundle](#aus-einem-gebauten-bundle) |
| Jeder Server mit konfiguriertem `liveSchema.repository` | ja, einschließlich `NODE_ENV=production` |

Ein Bundle ist kompilierter Output, daher enthält es keinen `backend/schema`-Quellcode, und
die Runtime, die es ausliefert, deaktiviert den Source-only-Editor. Sofern kein Repository
angegeben ist, antwortet `/api/admin/schema/status` mit `enabled: false` und dem Code
`SCHEMA_EDITOR_DISABLED`: Bearbeiten Sie `backend/schema` in der Entwicklungsumgebung,
committen Sie die Änderungen und deployen Sie.

### Aus einem gebauten Bundle

Ein Bundle enthält keinen eigenen Code zur Konfiguration, daher erfolgt das Opt-in über
Umgebungsvariablen. Für ein Bundle, das diese nicht setzt, ändert sich nichts.

```bash
REBASE_LIVE_SCHEMA_REPOSITORY=acme/storefront     # turns it on
REBASE_LIVE_SCHEMA_GITHUB_TOKEN=github_pat_…       # or the three _GITHUB_APP_* variables
# REBASE_LIVE_SCHEMA_BRANCH=main                   # default
# REBASE_LIVE_SCHEMA_PATH=backend/schema           # default
```

Die vollständige Liste finden Sie unter [Konfiguration](/docs/getting-started/configuration#live-schema-editing-from-a-bundle).
Wird ein Repository ohne nutzbare Zugangsdaten angegeben (keine, beide Arten oder eine
unvollständige GitHub App) oder ein Wert, der nicht dem Schema `owner/name` entspricht,
verweigert der Server den Start, anstatt einen Editor bereitzustellen, der fehlschlägt,
sobald jemand auf „Apply“ klickt. Dasselbe gilt für die entfernte Variable
`REBASE_LIVE_SCHEMA_COLLECTIONS_PATH` (mit einer Meldung, die auf `REBASE_LIVE_SCHEMA_PATH`
verweist) sowie für Pfade, die außerhalb des Repositorys liegen.

Was unverändert bleibt, wenn es aktiviert ist:

- Es ist ein `/api/admin`-Endpunkt: ohne `schema:read` gibt es keinerlei Antwort, und
  `/apply` erfordert `schema:write` sowie eine reale Person (siehe [Wer Änderungen anwenden darf](#wer-änderungen-anwenden-darf)).
- Das Schreibziel ist ausschließlich das von Ihnen benannte Repository. Der Source-only-Editor,
  der Dateien neben dem Prozess schreibt, bleibt deaktiviert.
- Jede Änderung wird geplant, angezeigt, committet und dann angewendet – genau wie auf
  Ihrem lokalen Rechner.

Der Prozess, der die Änderung angewendet hat, liefert sie sofort aus: Seine REST-Routen,
die `GET /api/schema/tables`-Deskriptoren und das Admin-Panel übernehmen die Bearbeitung
ohne Neustart. Andere Replikate und dieser Prozess nach einem Neustart liefern weiterhin
die Tabellen aus, mit denen das Bundle gebaut wurde, bis Ihre Pipeline den Commit baut
und deployt.

Eine Änderung wartet also darauf, dass die vorherige bereitgestellt wird. Eine Änderung,
die auf Basis von Tabellen geplant wird, denen das Repository bereits voraus ist, würde
generierte Schemadateien committen, die die frühere Änderung auslassen. Jedes Apply rendert
daher `schema.generated.ts` aus den Tabellen, die dieser Prozess bereitstellt, und vergleicht
das Ergebnis mit der Kopie im Repository. Weichen sie voneinander ab, wird das Apply mit
`SCHEMA_CHANGE_FAILED` unter Nennung der Datei verweigert, bis ein Prozess, der diesen
Commit ausführt, den aktuellen ersetzt. Die Prüfung liest das Repository und nicht den
Speicher dieses Prozesses aus. Daher gilt sie über Neustarts hinweg, über Replikate hinweg
sowie für Änderungen, die ein Entwickler bereits gepusht hat, die jedoch noch nicht
bereitgestellt wurden. Das Planen bleibt währenddessen weiterhin möglich.

Die Kopien weichen auch dann voneinander ab, wenn die Datei von einer anderen Rebase-Version
generiert, neu formatiert oder manuell bearbeitet wurde. Wenn kein Deployment aussteht,
führen Sie `rebase schema generate` mit der Version aus, die das Deployment nutzt,
committen Sie das Ergebnis und deployen Sie es. Zeilenenden und nachgestellte Leerzeichen
gelten nicht als Unterschied.

### In ein Remote-Repository committen

`liveSchema.repository` veranlasst den Server, jede Änderung über die Git Data API in ein
GitHub-Repository zu committen, anstatt `git commit` in einem Working Tree auszuführen.
Dies hängt nicht davon ab, ob der Source-only-Editor aktiviert ist: Ist ein Repository
konfiguriert, funktioniert Live-Editing auch unter `NODE_ENV=production` und mit
`schemaEditor: false`, da auf diesem Rechner nichts geschrieben wird. Ein Bundle setzt
dies über die oben genannten Variablen.

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
umgeschrieben, der lokal ausgeführt wird, und die Änderungen werden über die Git Data API
zurück committet: ein Blob pro Datei, ein Tree, ein Commit und ein Ref-Update. Es wird
nichts geklont und nichts auf der Festplatte hinterlassen. Das gesamte Verzeichnis wird
gelesen, nicht nur die bearbeitete Datei, sodass eine Relation auf eine andere Tabelle
verweisen kann und das Löschen einer Tabelle genauso funktioniert wie lokal: Es wird
verweigert, solange eine Relation einer anderen Tabelle darauf verweist, und im selben
Commit aus `index.ts` entfernt. Da nur `backend/schema` abgerufen wird, kann eine Tabellendatei,
die etwas außerhalb dieses Verzeichnisses importiert, auf diese Weise nicht bearbeitet werden.

`auth` nimmt ein Token oder eine GitHub-App-Installation entgegen:

```typescript no-verify
auth: {
    kind: "app",
    appId: "123456",
    privateKey: process.env.GITHUB_APP_PRIVATE_KEY!,
    installationId: "987654"
}
```

Verwenden Sie das Token für ein einzelnes Projekt, das in ein Repository committet, das
Sie bereits besitzen – das Einrichten einer App, nur damit Ihr eigener Server committen
kann, ist viel Aufwand für eine einzeilige Zugangsdaten-Angabe. Verwenden Sie die App für
eine Control Plane, die einen einzigen Schlüssel für viele Projekte verwaltet, wie es
Rebase Cloud handhabt: eine App, eine Installation pro Projekt und kein kundenindividuelles
Secret, das rotiert werden müsste.

Das Token benötigt die Berechtigung `contents: read and write` für dieses Repository und nichts weiter.

Ohne `liveSchema.repository` ist der Commit ein normaler `git commit` im Working Tree,
der `schemaDir` enthält: keine Authentifizierung erforderlich, kein Token, kein Netzwerk.

Zwei Dinge sorgen dafür, dass die Ausführung in einem Repository, an dem auch andere
arbeiten, sicher ist:

- Es werden **nur** die generierten Dateien gestaged. Ein Schema-Commit, der halbfertige
  Arbeiten mitnehmen würde, wäre ein Commit, den niemand prüfen könnte; er wird sofort
  verweigert, wenn im Tree bereits eine der eigenen Dateien modifiziert ist.
- Der Remote-Pfad führt niemals einen Force-Update eines Refs aus. Wenn etwas committet
  wurde, während der Commit erstellt wurde, wird die Aktualisierung abgelehnt – den Commit
  von jemand anderem stillschweigend zu verlieren, ist schlimmer als ein Fehler.

## Einschränkungen

- Nur additive Änderungen. Alles andere wird mit einer Begründung verweigert, da der
  Ensure-Pfad das Einzige ist, was ein Schema verändert, und dieser nur hinzufügen kann.
- Es wird keine Migrationsdatei geschrieben. Ein Projekt, das über Boot-Ensure bereitgestellt
  wird, benötigt keine; ein Projekt, das über Migrationen bereitgestellt wird, sollte
  `rebase db generate` ausführen, wodurch eine Datei über Atlas mit dem von Atlas geforderten
  Integritäts-Hash erzeugt wird.
- Nur Postgres. Die Funktion wird auf Treiberebene erkannt, und ein Treiber ohne entsprechende
  Unterstützung antwortet mit `SCHEMA_EDITING_UNSUPPORTED`.
- Ein Deployment, dessen Tabellen aus der Datenbank abgeleitet werden, liefert eine angewendete
  Änderung erst nach dem nächsten Start aus (`serving.status: "after-restart"`, siehe
  [Ohne Neustart ausgeliefert](#ohne-neustart-ausgeliefert)).

## Verwandte Themen

- [Schema-Generierung](/docs/cli/schema/) — dieselben Änderungen über die Befehlszeile
- [Tabellen](/docs/schema/) — was der Editor umschreibt
- [Studio](/docs/studio/) — das Panel, hinter dem diese Routen liegen
