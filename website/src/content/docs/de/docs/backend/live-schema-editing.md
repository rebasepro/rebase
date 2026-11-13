---
sourceHash: a8ca2780e6bbad15
title: Live-Schema-Bearbeitung
description: Tabellen für ein laufendes Backend erstellen und ändern – die Bearbeitung wird in backend/schema geschrieben, zuerst in Ihr Repository committet und dann angewendet.
---

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Der Schema-Editor im Admin-Panel schreibt die Tabellendateien in
`backend/schema` neu. Das funktioniert auf Ihrem Rechner und sonst nirgends: Die
Dateien eines bereitgestellten Servers werden bei jedem Deployment aus Ihrem
Repository neu erstellt, sodass eine dort vorgenommene Bearbeitung beim nächsten
Deployment verworfen werden würde.

Die Live-Schema-Bearbeitung ist die Lösung dafür. Sie **committet die Änderung in
Ihr Repository und wendet dann das DDL an** – so übersteht die Bearbeitung das
nächste Deployment, da das Deployment darauf aufbaut.

```
GET  /api/admin/schema/status   whether this backend can do it, and whether you may
POST /api/admin/schema/plan     what would happen, without doing it
POST /api/admin/schema/apply    commit, then apply
```

Status und Plan erfordern den Scope `schema:read`, und Apply erfordert `schema:write`,
wie jeder andere `/api/admin`-Bereich, der einen Scope benennt. Ein Admin
besitzt beide. Das Anwenden erfordert außerdem noch eines mehr als den Scope – siehe
[Wer anwenden darf](#wer-anwenden-darf).

## Die Bearbeitungen: `TablePatch`

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Jede Route, die das Schema ändert, akzeptiert denselben Body, `{ patches }`: eine
Liste von Bearbeitungen, von denen jede ihre Tabelle per Slug benennt. Der Typ ist
`TablePatch` aus `@rebasepro/types`.

| `op` | Was es in `backend/schema` schreibt |
|---|---|
| `createTable` | ein neues `backend/schema/<name>.ts`, das die Tabelle enthält und aus `index.ts` exportiert wird |
| `deleteTable` | entfernt die Datei und ihren Export |
| `addColumn` `{ key, column, before? }` | eine Spalte, vor der durch `before` benannten oder als letzte |
| `changeColumn` `{ key, column }` | schreibt die Builder-Kette einer Spalte neu; ein darauf definiertes `.transform()` wird beibehalten |
| `renameColumn` `{ key, to, column }` | benennt den Schlüssel um, behält die SQL-Spalte bei |
| `removeColumn` `{ key }`, `moveColumn` `{ key, before? }` | entfernt oder ordnet eine Spalte neu an |
| `addRelation`, `changeRelation` `{ name, relation }`, `removeRelation` `{ name }` | ein `rel.*`-Eintrag; das `target` der Relation ist ein Slug |
| `setRls` `{ rls }` | die Richtlinie: `"admin-only"`, `"inherit"` oder eine Liste von Regeln |
| `addRule` `{ rule, index? }`, `replaceRule` `{ index, rule }`, `removeRule` `{ index }` | eine Regel der Liste |
| `setOption` `{ option, value }` | `description`, `tenant`, `softDelete`, `history`, `search`, `indexes`, `strictWrites`, `defaultPolicies` oder `metadata`; `null` entfernt es |

Eine Spalte wird als ihre Definition übergeben – der Postgres-Typ als `{ kind: … }`
und die Modifikatoren als Flags – ohne ihre `.transform()`-Hooks, die Code sind
und dort verbleiben, wo sie geschrieben wurden:

```json
{ "patches": [
    { "op": "addColumn", "table": "posts", "key": "subtitle",
      "column": { "type": { "kind": "text" } } }
] }
```

Es wird nur der Code umgeschrieben, den eine Bearbeitung benennt. Alles andere
bleibt unverändert – Imports, Kommentare, Formatierung, eine aus einem anderen
Modul geteilte Spalte. Der Editor lehnt unter Angabe des Ausdrucks Bearbeitungen ab,
die in etwas hineingreifen (*reach into*), das im Code definiert ist: eine mit
einem Spread erstellte Tabelle, eine durch einen Helper erstellte Spalte, in
einer Variable gehaltene Regeln, ein berechneter Schlüssel, eine Spalte, deren
JSON-Shape Transformationen enthält. Er benennt auch niemals einen Slug, eine
Tabelle, ein Schema oder den Namen einer Definition um (das verschiebt Daten:
schreiben Sie eine Migration), entfernt niemals die letzte Regel (nutzen Sie
`setRls` mit `"admin-only"`), verweigert `rls` auf einem View und verweigert das
Löschen einer Tabelle, auf die andere Relationen verweisen. Eine Bearbeitung, deren
Ergebnis nicht kompiliert, wird mit `SCHEMA_EDIT_DOES_NOT_COMPILE` und den
Fehlern des Compilers abgelehnt. Bei einer Ablehnung wird nichts geschrieben.

Wie eine Tabelle im Admin-Panel aussieht – Beschriftungen, Icons, Gruppen,
Ansichtsmodi, Enum-Farben – ist keine Schema-Bearbeitung: Dies liegt in
`frontend/src/cms` und den gespeicherten Einstellungen des Panels, und nichts
davon wird in einem `TablePatch` übertragen.

`$ADMIN_TOKEN` ist ein Access-Token – das `accessToken`, das ein Login
zurückgibt – für einen Account mit `schema:read`: ein Admin oder eine Rolle,
die dies deklariert. Nichts auf dem Rechner setzt dies automatisch für Sie.

## Planen vor dem Anwenden

<span class="since-badge" data-since="0.31">Seit 0.31</span>

`/plan` hat keine Nebeneffekte. Senden Sie die Bearbeitungen per POST, und es
teilt Ihnen mit, was sie bedeuten:

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

`files` umfasst jede Datei, die das Apply committet: den Quellcode der Tabelle
(wenn das Backend ihn schreiben kann) und anschließend das generierte Schema.
Die Änderungsdatensätze des Planners behalten ihre Wire-Namen (`add-property`,
`collection`, `property`).

Dies ist kein bloßer Komfort. Zwei der drei Ergebnisse (Verdicts) sind
Ablehnungen, und eine davon ist eine Ablehnung, die Sie sonst erst beim Klick
auf die Schaltfläche an einer Live-Datenbank bemerken würden.

## Die drei Verdicts

| Verdict | Bedeutung |
|---|---|
| `safe` | Der Boot-Time-Ensure-Pfad kann es abbilden und das Ergebnis entspricht Ihrer Konfiguration. Angewendet. |
| `diverges` | Es wird *teilweise* angewendet, hinterlässt jedoch eine Datenbank, die nicht Ihrer Konfiguration entspricht – und nichts meldet dies. Abgelehnt. |
| `needs-migration` | Der Ensure-Pfad kann dies überhaupt nicht abbilden. Abgelehnt. |

`diverges` ist dasjenige, das man verstehen sollte, da diese Änderungen so
aussehen, als hätten sie funktioniert:

- **Eine zu einer Tabelle mit bereits vorhandenen Zeilen hinzugefügte `.notNull()`-Spalte**
  wird als **nullable** angelegt. `NOT NULL` wird für jede bereits vorhandene Zeile
  geprüft, und Zeilen, die vor der Existenz der Spalte geschrieben wurden, haben keinen
  Wert dafür. Bei einer **leeren** Tabelle gibt es nichts zu prüfen, daher wird das
  Constraint angewendet und dies ist `safe`.
- **Eine bestehende Spalte zu `.notNull()` zu machen**, verhält sich genauso:
  `SET NOT NULL` scannt die Tabelle, daher ist es bei einer leeren Tabelle `safe`
  und bei einer befüllten `diverges`, bis Sie die Werte nachpflegen (Backfill).

Zwei Änderungen, die früher `diverges` waren, sind jetzt `safe`, da der Ensure-Pfad
sie ausführt:

- **Ein zu einem bestehenden Enum hinzugefügter Wert** wird über
  `ALTER TYPE … ADD VALUE IF NOT EXISTS` übernommen. Früher wurde er zusammen
  mit dem gesamten Typ übersprungen, und die erste Zeile, die den neuen Wert
  verwendete, wurde von einem Typ abgewiesen, der ihn nicht kannte.
- **Das Lockern einer `.notNull()`-Spalte** entfernt das `NOT NULL`. Früher blieb
  es bestehen, sodass Schreibvorgänge, die die Spalte ausließen, weiterhin
  fehlschlugen.

### Constraints, die angefordert, aber nicht angewendet wurden

Eine Änderung kann anwendbar sein und dennoch etwas nicht durchsetzen, was Ihre
Konfiguration verlangt – eine `.notNull()`-Spalte in einer befüllten Tabelle ist ein
solcher Fall. Das ist keine Ablehnung, daher erscheint es nicht in `changes`; es
erscheint in `withheldConstraints` zusammen mit dem Hindernis und der Maßnahme
zu dessen Behebung:

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
zurückgehaltenes Constraint stillschweigend ignoriert.

`needs-migration` deckt alles ab, was der Ensure-Pfad nicht tun kann: das Löschen
einer Tabelle oder Spalte, das Ändern des Typs einer Spalte (ein Integer-Toggle,
ein String, der zum Enum wird, der Elementtyp eines Arrays, die Breite eines
Varchars), das Umbenennen einer Spalte, das Ändern eines Primärschlüssels, das
Entfernen eines Enum-Werts, das Setzen einer bestehenden Spalte auf Unique und
das Ändern einer Relation – deren Art, Ziel, `localKey` oder `onDelete`. Ein
`hasMany` oder `hasOne`, dessen Verknüpfungsspalte von nichts erzeugt wird, wird
ebenfalls abgelehnt. Jede Ablehnung benennt die Änderung und die empfohlene
Alternative.

Das Verdict wird aus dem Schema abgelesen, das jede Seite erzeugt – derselbe Plan,
aus dem `schema.generated.ts` und `db push` gerendert werden –, sodass eine
Bearbeitung, die die Datenbank ändert, nicht als änderungsfrei gemeldet werden
kann. Zwei Bearbeitungen, die wie Änderungen aussehen und nicht abgelehnt werden:

- **Das Umbenennen des Schlüssels einer Spalte unter Beibehaltung ihrer SQL-Spalte**
  (`renameColumn`, wodurch der alte Name als erstes Argument des Builders
  geschrieben wird: `col.text("old_name")`) verschiebt keine Daten. Es ist
  `safe`; API-Clients lesen den neuen Namen.
- **Das Setzen, Ändern oder Entfernen eines Default-Werts** bindet nur zukünftige
  Schreibvorgänge. Es ist `safe` und wird mit `ALTER COLUMN … SET DEFAULT` /
  `DROP DEFAULT` angewendet.

### Nur Quellcode bearbeiten

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Eine abgelehnte Änderung kann dennoch in `backend/schema` geschrieben und committet
werden, wobei die Datenbank unverändert bleibt – das Entfernen einer Spalte, die Sie
nicht mehr bereitstellen, ist der typische Fall. Senden Sie `/apply` per POST mit
`"sourceOnly": true`. Es wird nichts ausgeführt; die Commit-Nachricht nennt das,
was die Datenbank behält, zum Beispiel
`chore(schema): remove sku from products (source only — column products.sku kept)`,
und jede Änderung im Plan enthält einen `sourceOnly`-Satz, der angibt, was
zurückbleibt – einschließlich des Falls, wenn eine zurückgelassene Spalte `NOT NULL`
ohne Standardwert ist, was jeden späteren Insert fehlschlagen lässt, bis sie gelöscht
oder auf nullable gesetzt wird. Eine Änderung ohne solchen Satz (Verschieben eines
Primärschlüssels, eine Relation, deren Verknüpfungsspalte von nichts erzeugt wird)
kann nicht allein im Quellcode geschrieben werden.

Bei einem Deployment, das nichts an seiner Datenbank ändert (`REBASE_PROVISION=false`),
wird keine Änderung über das Panel angewendet, sodass jede Änderung diesen Weg nimmt:
Die Hauptschaltfläche des Dialogs lautet **Commit** und sendet `"sourceOnly": true`,
und der Prozess, der diese Datenbank ändert, wendet das Schema an.

Das Löschen einer Tabelle über das Admin-Panel nimmt denselben Weg: `/apply` mit
einer `deleteTable`-Bearbeitung und `"sourceOnly": true` löscht die Datei der Tabelle
sowie deren Export in `index.ts` und committet beides; die Tabelle und ihre Zeilen
verbleiben in der Datenbank. Dies wird abgelehnt, solange eine Relation einer anderen
Tabelle darauf verweist, unter Nennung dieser Tabelle – das Löschen würde dazu
führen, dass das Schema nicht mehr kompiliert.

## Was committet wird

Nicht nur die Tabellendatei. Das Drizzle-Schema wird daraus generiert, und ein
veraltetes Schema führt beim nächsten Deployment zu Fehlern, daher wandern beide in
denselben Commit:

- `backend/schema/<name>.ts` – die Tabelle selbst, und `backend/schema/index.ts`, wenn eine Tabelle erstellt oder gelöscht wird
- `backend/src/schema.generated.ts` – das Drizzle-Schema

Diese Pfade beziehen sich auf Ihr **Projekt**, nicht auf Ihr Repository. Wenn beides
dasselbe ist – ein `rebase init`-Projekt, was der Regelfall ist –, müssen Sie sich
darüber keine Gedanken machen. Befindet sich Ihr Projekt in einem Unterverzeichnis
eines größeren Repositorys, wird den Pfaden dieses vorangestellt, indem vom
Schema-Verzeichnis aus aufwärts nach der nächstgelegenen `rebase.json` gesucht wird.
Ein Projekt ohne `rebase.json` behält die einfachen Pfade bei.

Es fließt kein SQL in den Commit. `rebase db push` und `rebase db generate` schreiben
ihr SQL bei jedem Durchlauf anhand der Tabellen in `.rebase/sql/`, welches in der
`.gitignore` enthalten ist.

Die Commit-Nachricht beschreibt die Änderung, anstatt nur eine anzukündigen, und
wird über den Anzeigenamen und die E-Mail-Adresse des Accounts der Person
zugeordnet, die sie vorgenommen hat (ein Benutzer ohne beides wird als
`<uid>@users.noreply.rebase.pro` committet).

Eine Schema-Änderung mit Autor und Diff in der Historie Ihres Projekts ist etwas,
das weder Firebase noch Supabase bieten – deren Tabellenbearbeitungen sind für
Ihr Repository unsichtbar.

## Wer anwenden darf

Der Besitz von `schema:read` reicht zum **Planen** aus. Das Planen hat keine
Nebeneffekte, und ein CI-Job, der prüft, ob eine vorgeschlagene Schema-Änderung
anwendbar ist, ist ein guter Anwendungsfall dafür.

Das Anwenden ist ein separates Privileg, da das Anwenden einen Commit schreibt
und ein Commit einen Autor trägt:

| Aufrufer | Planen | Anwenden |
|---|---|---|
| Eine angemeldete Person mit `schema:write` | ja | ja |
| Ein API-Key mit `schema:read` / `schema:write` | ja | nein |
| Der Service-Key des Servers | ja | nein |

Ein Credential ist kein Autor. `api-key:7c3f…` in Ihrer CI-Umgebung ist keine
Person, und wenn man ihm erlaubt, in Ihr Repository zu schreiben, entsteht genau
die nicht zuordenbare Historie, die dieses Feature ersetzen soll.

Wenn Sie automatisierte Schema-Änderungen wünschen – beispielsweise eine
Migrations-Pipeline –, aktivieren Sie dies bewusst:

```typescript no-verify
initializeRebaseBackend({
    // …the rest of your config
    liveSchema: { allowMachineApply: true }
})
```

oder `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY=true`. Der Commit wird dann dem
Credential namentlich zugeordnet – `Rebase API key (7c3f)` –, sodass Sie beim
Lesen von `git log` einen Monat später immer noch sehen können, welche Änderungen
von einer Person vorgenommen wurden.

`GET /api/admin/schema/status` meldet, was *Sie* tun dürfen, und nicht nur, was
der Server unterstützt. So kann ein Panel das Steuerelement deaktivieren und den
Grund angeben, anstatt Sie erst nach Ihrer Entscheidung abzuweisen:

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

Das Anwenden an dieser Stelle schreibt **keine** Migration und kann dies auch
nicht: Eine Migration liegt im Format von Atlas mit einer Integritätsdatei vor,
die von einer externen Binärdatei gegen eine temporäre Wegwerf-Datenbank erzeugt
wird – und ein laufender Server besitzt keines von beidem.

Was committet wird, ist die Tabellendatei, und genau daraus schreibt
`rebase db generate` die Migration. Die Migration ist also nur einen Befehl
entfernt:

```bash
rebase db generate
```

Sowohl der Plan als auch das Ergebnis weisen darauf hin, wenn Ihr Projekt
Migrationen nutzt, da der Fehler andernfalls unbemerkt bliebe: Ihre Datenbank
enthält die Änderung und Ihr Repository beschreibt sie, aber die nächste Umgebung,
die durch das erneute Abspielen von Migrationen aufgebaut wird, enthält sie nicht –
und es gab keinerlei Hinweis.

Ein Projekt, das über Boot-Ensure bereitgestellt wird – die Managed Runtime sowie
jedes Self-Hosting, das `REBASE_MIGRATE_ON_BOOT` auf dem Standardwert belässt –,
benötigt überhaupt keine Migration. Seine Tabellen sind das Schema, und der
nächste Systemstart führt den Abgleich durch.

## Zuerst committen, dann anwenden

Die Reihenfolge ist wichtig und keineswegs willkürlich.

Würde das DDL zuerst ausgeführt und der Commit schlüge fehl, hätte Ihre
Datenbank eine Spalte, die Ihr Repository nicht beschreibt. Der Ensure-Pfad
löscht niemals etwas, sodass das nächste Deployment sie weder entfernen noch
erwähnen würde – eine unsichtbare Spalte, die in Ihren Tabellen fehlt, bis
jemand gezielt danach sucht.

Wenn zuerst committet wird, schlägt es im umgekehrten Fall fehl: Das Repository
beschreibt etwas, das die Datenbank noch nicht hat. Das ist der normale Zustand
jedes Projekts zwischen einer Bearbeitung und einem Deployment, und der
Boot-Vorgang gleicht dies beim nächsten Start ab.

Ein fehlgeschlagenes Anwenden ist daher **kein Fehler**. Die Antwort besagt
genau das:

```json
{
  "applied": false,
  "applyError": "connection refused",
  "committed": { "sha": "1a2b3c4de", "branch": "main" },
  "summary": "Committed 1a2b3c4de on main, but the database was not changed. The change will be applied on the next boot."
}
```

## Regeln werden im selben Apply wirksam

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Eine Änderung am `rls` einer Tabelle (oder eine neue Tabelle) wird im selben Apply
durchgesetzt: Die Policies der geänderten Tabellen werden direkt nach dem DDL in
die Datenbank geschrieben, und die Antwort gibt unter `policies` an, was passiert
ist:

```json
{ "policies": { "status": "applied", "tables": ["posts"], "statements": 3 } }
```

Können Policies nicht geschrieben werden – etwa bei einem Backend, das nicht
provisionieren darf (`provision.tables` deaktiviert), oder einem Treiber ohne diese
Fähigkeit –, lautet der Status `"deferred"`; schlägt das Schreiben fehl, lautet er
`"failed"` mit der Fehlermeldung. Beide enthalten die Nachricht „Rules saved to
source; they take effect on the next deploy.“, und das Panel zeigt bis dahin
weiterhin die Regeln an, die Postgres tatsächlich durchsetzt, niemals Regeln, die
nicht in Kraft sind.

Im Quellcode bearbeitete Hooks werden ebenfalls mit dem Apply wirksam: Der Server
führt die kompilierten Tabellen des bearbeiteten Schemas ohne Neustart aus.

## Bereitstellung ohne Neustart

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Eine über das Studio angewendete Änderung wird sofort bereitgestellt. Der
Postgres-Treiber liest die geänderten Tabellen aus der Datenbank zurück und
tauscht sie aus: Die Daten-API, Includes, Hooks und Realtime erkennen eine neue
Tabelle, Spalte, Relation oder Junction ohne Neustart, und eine neue Tabelle
erhält ihre Berechtigungen (Grants) und Change Capture. Die Antwort bestätigt
dies unter `serving`:

```json
{ "serving": { "status": "now" } }
```

Bei einem Deployment, dessen Tabellen aus der Datenbank abgeleitet werden (kein
`backend/schema`), oder bei einem Treiber, der seine Tabellen nicht aktualisieren
kann, verfügen die Datenbank und der Quellcode zwar über die Änderung, der Prozess
stellt jedoch weiterhin die Tabellen bereit, mit denen er gestartet wurde. Der
Status lautet dann `"after-restart"`, mit einer `message`, die in der Bestätigung
des Studios als Warnung angezeigt wird; starten Sie den Prozess neu, um die
Änderung bereitzustellen.

## Wenn sich die Datei während der Bearbeitung geändert hat

Eine Bearbeitung wird auf Basis der Dateien in ihrem aktuellen Zustand vorbereitet.
Wenn sich eine davon vor dem Anwenden der Bearbeitung auf der Festplatte ändert –
durch Speichern in einer IDE, einen anderen Prozess –, schreibt das Apply nichts
und antwortet mit 409 `SCHEMA_EDIT_STALE_FILE`. Der Collection-Editor bietet ein
Neuladen (Reload) an; führen Sie die Bearbeitung erneut auf Basis der Datei in
ihrem aktuellen Zustand durch.

## Wo dies funktioniert

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Die Live-Schema-Bearbeitung schreibt `backend/schema` mit demselben Editor neu,
den auch die Source-Only-Speichervorgänge des Panels verwenden (erfordert die
Installation von `ts-morph`). Woher dieser Quellcode stammt, entscheidet darüber,
wo sie ausgeführt werden kann:

- **Auf der Festplatte** (`schemaDir`, der Standard): Es läuft dort, wo der
  Source-Only-Editor läuft. Dieser Editor ist unter `NODE_ENV=production`
  deaktiviert, es sei denn, der Server setzt `schemaEditor: true`.
- **In einem von Ihnen angegebenen Repository** (`liveSchema.repository` oder
  `REBASE_LIVE_SCHEMA_REPOSITORY` für ein Bundle): Der Quellcode wird von
  GitHub gelesen und die Änderung dorthin zurückgecommittet, sodass es überall
  läuft, einschließlich der Produktion. Dies ist das Opt-in für ein gebautes Bundle.

| Deployment | Funktioniert |
|---|---|
| `rebase dev` auf Ihrem Rechner | ja |
| Self-Hosting mit gemountetem Projekt und dessen Git-Working-Tree | ja, wenn `NODE_ENV` nicht `production` ist, oder mit `schemaEditor: true` |
| Ein gebautes Bundle: ein Self-Hosting, das einen Build bereitstellt, oder das veröffentlichte Image | nur bei Opt-in über `REBASE_LIVE_SCHEMA_REPOSITORY` – siehe [Aus einem gebauten Bundle](#aus-einem-gebauten-bundle) |
| Jeder Server mit konfiguriertem `liveSchema.repository` | ja, einschließlich `NODE_ENV=production` |

Ein Bundle ist kompilierte Ausgabe, daher enthält es keinen `backend/schema`-Quellcode,
und die Runtime, die es ausführt, deaktiviert den Source-Only-Editor. Sofern kein
Repository angegeben ist, antwortet `/api/admin/schema/status` mit `enabled: false`
und dem Code `SCHEMA_EDITOR_DISABLED`: Bearbeiten Sie `backend/schema` in der
Entwicklungsumgebung, committen Sie und führen Sie ein Deployment durch.

### Aus einem gebauten Bundle

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Ein Bundle besitzt keinen eigenen Code zur Konfiguration, daher erfolgt das
Opt-in über Umgebungsvariablen. Für ein Bundle, das diese nicht setzt, ändert
sich nichts.

```bash
REBASE_LIVE_SCHEMA_REPOSITORY=acme/storefront     # turns it on
REBASE_LIVE_SCHEMA_GITHUB_TOKEN=github_pat_…       # or the three _GITHUB_APP_* variables
# REBASE_LIVE_SCHEMA_BRANCH=main                   # default
# REBASE_LIVE_SCHEMA_PATH=backend/schema           # default
```

Die vollständige Liste finden Sie unter [Konfiguration](/docs/getting-started/configuration#live-schema-editing-from-a-bundle).
Ein angegebenes Repository ohne verwendbare Zugangsdaten (keine, beide Arten, eine
unvollständige GitHub-App) oder mit einem Wert, der nicht `owner/name` entspricht,
verweigert den Start, anstatt einen Editor bereitzustellen, der fehlschlägt,
sobald jemand auf Apply klickt. Dasselbe gilt für das entfernte
`REBASE_LIVE_SCHEMA_COLLECTIONS_PATH` mit einer Meldung, die auf
`REBASE_LIVE_SCHEMA_PATH` hinweist, sowie für Pfade, die außerhalb des
Repositorys liegen.

Was gleich bleibt, wenn es aktiviert ist:

- Es ist eine `/api/admin`-Schnittstelle: keinerlei Antwort ohne `schema:read`,
  und `/apply` erfordert `schema:write` sowie eine Person (siehe [Wer anwenden darf](#wer-anwenden-darf)).
- Das Schreibziel ist ausschließlich das von Ihnen angegebene Repository. Der
  Source-Only-Editor, der Dateien neben dem Prozess schreibt, bleibt deaktiviert.
- Jede Änderung wird geplant, angezeigt, committet und dann angewendet, genau
  wie auf Ihrem lokalen Rechner.

Der Prozess, der die Änderung angewendet hat, stellt sie sofort bereit: Seine
REST-Routen, die `GET /api/schema/tables`-Deskriptoren und das Admin-Panel
folgen der Bearbeitung ohne Neustart. Andere Replikate sowie dieser Prozess nach
einem Neustart stellen die Tabellen bereit, mit denen das Bundle gebaut wurde,
bis Ihre Pipeline den Commit baut und deployt.

Eine Änderung wartet daher darauf, dass die vorherige bereitgestellt wird. Eine
Änderung, die gegen Tabellen geplant wird, denen das Repository bereits voraus ist,
würde generierte Schema-Dateien committen, welche die frühere Änderung auslassen.
Jedes Apply rendert daher `schema.generated.ts` aus den Tabellen, die dieser
Prozess bereitstellt, und vergleicht sie mit der Kopie des Repositorys. Wenn sie
sich unterscheiden, wird das Apply mit `SCHEMA_CHANGE_FAILED` unter Nennung der
Datei abgelehnt, bis ein Prozess, der diesen Commit ausführt, diesen hier ersetzt.
Die Prüfung liest das Repository und nicht den Speicher dieses Prozesses, sodass
sie über Neustarts, über Replikate hinweg und auch für Änderungen gilt, die ein
Entwickler gepusht hat, die aber noch nicht deployt wurden. Das Planen bleibt
währenddessen verfügbar.

Die Kopien unterscheiden sich auch dann, wenn die Datei von einer anderen
Rebase-Version generiert, neu formatiert oder manuell bearbeitet wurde. Wenn
nichts auf das Deployment wartet, führen Sie `rebase schema generate` mit der
Version aus, die das Deployment nutzt, committen Sie das Ergebnis und deployen
Sie es. Zeilenumbrüche und nachgestellte Leerzeichen zählen nicht als Unterschied.

### Committen in ein Remote-Repository

<span class="since-badge" data-since="0.31">Seit 0.31</span>

`liveSchema.repository` veranlasst den Server dazu, jede Änderung über die Git
Data API in ein GitHub-Repository zu committen, anstatt `git commit` in einem
Working-Tree auszuführen. Dies hängt nicht davon ab, ob der Source-Only-Editor
aktiviert ist: Bei konfiguriertem Repository funktioniert Live-Editing auch
unter `NODE_ENV=production` und mit `schemaEditor: false`, da auf diesem Rechner
nichts geschrieben wird. Ein Bundle setzt dies über die oben genannten Variablen.

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

Das Schema-Verzeichnis wird dann aus dem Repository gelesen, mit demselben
Editor umgeschrieben, der lokal läuft, und die Änderungen werden über die
Git Data API zurückgecommittet: ein Blob pro Datei, ein Tree, ein Commit und
ein Ref-Update. Es wird nichts geklont und nichts auf der Festplatte hinterlassen.
Das gesamte Verzeichnis wird gelesen, nicht nur die bearbeitete Datei, sodass
eine Relation auf eine andere Tabelle verweisen kann und das Löschen einer
Tabelle wie lokal funktioniert: abgelehnt, solange die Relation einer anderen
Tabelle darauf verweist, und im selben Commit aus `index.ts` entfernt. Da nur
`backend/schema` abgerufen wird, kann eine Tabellendatei, die etwas außerhalb
davon importiert, auf diese Weise nicht bearbeitet werden.

`auth` akzeptiert ein Token oder eine GitHub-App-Installation:

```typescript no-verify
auth: {
    kind: "app",
    appId: "123456",
    privateKey: process.env.GITHUB_APP_PRIVATE_KEY!,
    installationId: "987654"
}
```

Verwenden Sie das Token für ein einzelnes Projekt, das in ein Repository
committet, das Sie bereits besitzen – das Einrichten einer App, nur damit Ihr
eigener Server committen kann, ist viel Aufwand für ein einzeiliges Credential.
Verwenden Sie die App für eine Control Plane, die einen Schlüssel über viele
Projekte hinweg verwaltet, wie es Rebase Cloud tut: eine App, eine Installation
pro Projekt und kein kundenindividuelles Secret, das rotiert werden muss.

Das Token benötigt `contents: read and write` für dieses Repository und nichts
weiter.

Ohne `liveSchema.repository` ist der Commit ein gewöhnlicher `git commit` im
Working-Tree, der `schemaDir` enthält: nichts zu authentifizieren, kein Token,
kein Netzwerk.

Zwei Dinge sorgen dafür, dass die Ausführung gegen ein Repository, an dem gerade
jemand anderes arbeitet, sicher ist:

- Es staged **ausschließlich** die generierten Dateien. Ein Schema-Commit, der
  halbfertige Arbeiten miterfassen würde, wäre ein Commit, den niemand reviewen
  könnte, und der Vorgang wird sofort verweigert, wenn im Tree bereits eine seiner
  eigenen Dateien modifiziert ist.
- Der Remote-Pfad führt niemals ein Force-Update einer Ref durch. Wenn etwas
  eingecheckt wurde, während der Commit erstellt wurde, wird das Update abgelehnt –
  den Commit von jemandem stillschweigend zu verlieren, ist schlimmer als ein
  Fehlschlag.

## Einschränkungen

- Nur additive Änderungen. Alles andere wird mit einer Begründung abgelehnt, da
  der Ensure-Pfad das Einzige ist, was ein Schema ändert, und er kann nur hinzufügen.
- Es wird keine Migrationsdatei geschrieben. Ein über Boot-Ensure bereitgestelltes
  Projekt benötigt keine; ein über Migrationen bereitgestelltes Projekt sollte
  `rebase db generate` ausführen, wodurch eine Migration über Atlas mit dem von
  Atlas geforderten Integritäts-Hash erstellt wird.
- Nur Postgres. Die Fähigkeit wird am Treiber erkannt, und ein Treiber ohne diese
  Funktion antwortet mit `SCHEMA_EDITING_UNSUPPORTED`.
- Ein Deployment, dessen Tabellen aus der Datenbank abgeleitet werden, stellt
  eine angewendete Änderung nach dem nächsten Start bereit
  (`serving.status: "after-restart"`, siehe
  [Bereitstellung ohne Neustart](#bereitstellung-ohne-neustart)).

## Verwandte Themen

- [Schema-Generierung](/docs/cli/schema/) – dieselben Bearbeitungen über die Befehlszeile
- [Tabellen](/docs/schema/) – was der Editor umschreibt
- [Studio](/docs/studio/) – das Panel, hinter dem diese Routen liegen
