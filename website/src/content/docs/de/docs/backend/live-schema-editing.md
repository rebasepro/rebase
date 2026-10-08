---
sourceHash: 564c58f7bc002c6f
title: Live-Schema-Bearbeitung
description: Erstellen und Ändern von Collections auf einem laufenden Backend – zuerst in Ihr Repository committet, dann angewendet.
---

Der Schema-Editor im Admin-Panel schreibt den Quellcode Ihrer Collection neu. Das funktioniert
auf Ihrem Rechner und sonst nirgends: Die Dateien eines bereitgestellten Servers werden bei jedem
Deploy aus Ihrem Repository neu gebaut, sodass eine dort vorgenommene Änderung beim nächsten
Deploy verworfen werden würde.

Live-Schema-Bearbeitung ist die Lösung dafür. Sie **committet die Änderung in Ihr
Repository und wendet dann das DDL an** – so überlebt die Änderung den nächsten Deploy,
weil der Deploy daraus gebaut wird.

```
GET  /api/admin/schema/status   whether this backend can do it, and whether you may
POST /api/admin/schema/plan     what would happen, without doing it
POST /api/admin/schema/apply    commit, then apply
```

Status und Plan brauchen den Scope `schema:read`, und Apply braucht `schema:write`, wie
jede andere `/api/admin`-Oberfläche, die einen Scope nennt. Ein Admin hält beide.
Das Anwenden erfordert außerdem eine Sache mehr als den Scope – siehe [Wer Änderungen anwenden darf](#wer-änderungen-anwenden-darf).

## Erst planen, dann anwenden

`/plan` hat keine Nebeneffekte. Senden Sie die Änderung, und der Endpunkt teilt Ihnen mit, was
die Änderung bedeutet. Eine Änderung an einer bestehenden Collection ist ein
`patch` — was sich geändert hat, als Operationen auf Pfaden von Schlüsseln — und eine neue
Collection ist die gesamte `collection`:

```json
{ "collectionId": "posts", "patch": [
    { "op": "set", "path": ["properties", "subtitle"], "value": { "name": "Subtitle", "type": "string" } },
    { "op": "remove", "path": ["admin", "group"] }
] }
```

Nur die Schlüssel, die ein Patch benennt, werden in die Collection-Datei geschrieben. Alles
andere bleibt, wie es ist — Imports, Kommentare, Formatierung, das `onClick` einer
Entity-Aktion, eine aus einem anderen Modul geteilte Property, ein von anderswo importiertes
Enum. Ein Patch, der *in* etwas hineinreicht, das im Code definiert ist
(`status: statusProperty`, `enum: LOCALE_ENUM`, ein `...spread`), wird mit dem Ausdruck
abgelehnt, auf den er gestoßen ist, sodass die Änderung dort vorgenommen wird, wo dieser Code
lebt. Eine vollständige `collection`, die für eine bestehende Collection gesendet wird, wird in
den Patch dessen umgewandelt, was sich von ihr unterscheidet, und ein Schlüssel, dessen Wert
Code ist, wird auf diesem Weg nie entfernt. Das Admin-Panel sendet Patches. Unter 0.23 nehmen
`/plan` und `/apply` nur die gesamte `collection` so, wie sie am Ende aussehen soll.

`$ADMIN_TOKEN` ist ein Zugriffstoken – das `accessToken`, das ein Sign-in zurückgibt – für ein
Konto, das `schema:read` hält: ein Admin oder eine Rolle, die den Scope deklariert. Nichts auf
dem Rechner setzt es automatisch für Sie.

```bash
curl -X POST https://your-app/api/admin/schema/plan \
  -H "authorization: Bearer $ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{"collectionId":"posts","collection":{}}'
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
  "files": ["backend/src/schema.generated.ts"]
}
```

Das ist keine bloße Bequemlichkeit. Zwei der drei Urteile sind Ablehnungen, und
eines davon ist eine Ablehnung, die Sie andernfalls erst bemerken würden, wenn Sie den Button
auf einer Live-Datenbank drücken.

## Die drei Urteile

| Urteil | Bedeutung |
|---|---|
| `safe` | Der Ensure-Pfad beim Booten bildet es ab und das Ergebnis entspricht Ihrer Konfiguration. Angewendet. |
| `diverges` | Es wird *teilweise* angewendet, hinterlässt jedoch eine Datenbank, die nicht Ihrer Konfiguration entspricht – und nichts meldet dies. Abgelehnt. |
| `needs-migration` | Der Ensure-Pfad kann dies überhaupt nicht abbilden. Abgelehnt. |

`diverges` ist dasjenige, das man verstehen sollte, da diese Änderungen so aussehen, als hätten sie
funktioniert:

- **Eine erforderliche Property, die einer Tabelle hinzugefügt wird, die bereits Zeilen enthält**, kommt
  als **nullable** an. `NOT NULL` wird gegen jede bereits vorhandene Zeile geprüft, und Zeilen,
  die geschrieben wurden, bevor die Property existierte, haben keinen Wert dafür. Auf einer **leeren**
  Tabelle gibt es nichts zu prüfen, daher wird das Constraint angewendet und dies ist
  `safe`.
- **Das Ändern einer bestehenden Property zu "required"** verhält sich genauso: `SET NOT NULL`
  scannt die Tabelle, daher ist es `safe` auf einer leeren und `diverges` auf einer befüllten,
  bis Sie ein Backfill durchführen.

Zwei Änderungen, die früher `diverges` waren, sind jetzt `safe`, da der Ensure-Pfad
sie ausführt:

- **Ein zu einem bestehenden Enum hinzugefügter Wert** wird übernommen, via
  `ALTER TYPE … ADD VALUE IF NOT EXISTS`. Früher wurde er zusammen mit dem
  gesamten Typ übersprungen, und die erste Zeile, die den neuen Wert verwendete, wurde von einem Typ
  abgewiesen, der noch nie davon gehört hatte.
- **Das Lockern einer erforderlichen Property** entfernt das `NOT NULL`. Früher wurde es
  beibehalten, sodass Schreibvorgänge, die die Property ausließen, weiterhin fehlschlugen.

### Constraints, die angefordert und nicht angewendet werden

Eine Änderung kann anwendbar sein und dennoch etwas, das Ihre Konfiguration verlangt,
nicht durchsetzen – eine erforderliche Property in einer befüllten Tabelle ist der Fall. Das ist
keine Ablehnung, daher erscheint es nicht in `changes`; es erscheint in
`withheldConstraints`, zusammen mit dem Hindernis und wie es behoben werden kann:

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

Der Ensure-Pfad beim Booten meldet dasselbe als Warnung. Bis es dies
gab, wurde ein zurückgehaltenes Constraint stillschweigend zurückgehalten.

`needs-migration` deckt alles ab, was der Ensure-Pfad nicht tun kann: das Löschen einer
Collection oder Property, das Ändern des Typs einer Spalte (ein Integer-Umschalter, ein String,
der zu einem Enum wird, der Elementtyp eines Arrays, die Breite eines Varchar), das Umbenennen
einer Spalte, das Ändern eines Primärschlüssels, das Entfernen eines Enum-Werts, das
nachträgliche Eindeutig-Machen einer bestehenden Spalte und das Ändern einer Relation — ihrer
Art, ihres Ziels, ihres `localKey`, ihres `onDelete`. Ein `hasMany` oder `hasOne`, dessen
Link-Spalte nichts erzeugt, wird ebenfalls abgelehnt. Jede Ablehnung benennt die Änderung und
was stattdessen zu tun ist.

Das Urteil wird aus dem Schema gelesen, das jede Seite erzeugt — demselben Plan, aus dem
`schema.generated.ts` und `db push` gerendert werden — sodass eine Änderung, die die Datenbank
verändert, nicht als „keine Änderung" gemeldet werden kann. Zwei Änderungen, die wie Änderungen
aussehen und nicht abgelehnt werden (; 0.23 meldet beide als migrationsbedürftig):

- **Das Umbenennen des Schlüssels einer Property bei gleichbleibender Spalte** (`columnName`
  auf die alte Spalte gesetzt) bewegt keine Daten. Es ist `safe`; API-Clients lesen den neuen
  Namen.
- **Das Setzen, Ändern oder Entfernen eines Standardwerts** bindet nur künftige
  Schreibvorgänge. Es ist `safe` und wird mit `ALTER COLUMN … SET DEFAULT` / `DROP DEFAULT`
  angewendet.

### Nur die Quelle bearbeiten

Eine abgelehnte Änderung kann trotzdem in Ihren Collection-Quellcode geschrieben und committet
werden, wobei die Datenbank bleibt, wie sie ist — das Entfernen einer Property, die Sie nicht
mehr bedienen, ist der übliche Fall. Senden Sie `/apply` mit `"sourceOnly": true`. Es
läuft nichts; die Commit-Nachricht benennt, was die Datenbank behält, zum Beispiel
`chore(schema): remove sku from products (source only — column products.sku kept)`, und jede
Änderung im Plan trägt einen `sourceOnly`-Satz, der sagt, was sie zurücklässt — auch wenn eine
zurückgelassene Spalte `NOT NULL` ohne Standardwert ist, was jeden späteren Insert fehlschlagen
lässt, bis sie entfernt oder nullable gemacht wird. Eine Änderung ohne einen solchen Satz (das
Verschieben eines Primärschlüssels, eine Relation, deren Link-Spalte nichts erzeugt) kann nicht
allein in die Quelle geschrieben werden.

Das Löschen einer Collection im Admin-Panel nimmt denselben Weg: `/apply` mit `"remove": true`
und `"sourceOnly": true` löscht die Datei der Collection und ihren Eintrag in `index.ts` und
committet beides; die Tabelle und ihre Zeilen bleiben. Es wird abgelehnt, solange eine andere
Collection die Datei importiert (eine Relation zu ihr), unter Angabe der importierenden
Collection — sie zu löschen würde das Laden jeder Collection stoppen.

Unter 0.23 nimmt `/apply` weder `sourceOnly` noch `remove`, und „Nur die Quelle bearbeiten" im
Panel schreibt die Datei ohne Commit.

## Was committet wird

Nicht nur die Collection-Datei. Das Drizzle-Schema wird aus ihr generiert, und ein
veraltetes Schema bringt den nächsten Deploy zum Scheitern, also landen beide im selben Commit:

- `config/collections/<name>.ts` — die Collection selbst
- `backend/src/schema.generated.ts` — das Drizzle-Schema

Diese Pfade sind relativ zu Ihrem **Projekt**, nicht zu Ihrem Repository. Wenn
beide identisch sind – ein `rebase init`-Projekt, was der Regelfall ist –, gibt es
nichts zu bedenken. Wenn sich Ihr Projekt in einem Unterverzeichnis eines größeren
Repositorys befindet, werden die Pfade mit diesem vorangestellt, ermittelt durch das Durchsuchen
von Ihrem Collections-Verzeichnis aufwärts zur nächsten `rebase.json`. Ein Projekt ohne
`rebase.json` behält die einfachen Pfade bei.

Kein SQL landet im Commit. `rebase db push` und `rebase db generate` schreiben ihr
SQL bei jedem Lauf aus den Collections nach `.rebase/sql/`, das von Git ignoriert wird.
Unter 0.23 trägt der Commit außerdem `drizzle/schema.sql`, `drizzle/policies.sql` und
`drizzle/search.sql`, geschrieben im Projekt-Root.

Die Commit-Nachricht beschreibt die Änderung, anstatt nur eine anzukündigen, und wird
der Person zugeschrieben, die sie vorgenommen hat. Eine Schemaänderung mit einem Autor und einem Diff
in der Historie Ihres Projekts ist etwas, das Ihnen weder Firebase noch Supabase bieten –
deren Tabellenbearbeitungen sind für Ihr Repository unsichtbar.

## Wer Änderungen anwenden darf

`schema:read` zu halten reicht aus, um zu **planen** (`plan`). Das Planen hat keine Nebeneffekte, und ein CI-Job,
der abfragt, ob eine vorgeschlagene Collection-Änderung anwendbar ist, ist ein guter Einsatzzweck dafür.

Das Anwenden (`apply`) ist ein zweites Privileg, da das Anwenden einen Commit schreibt und ein Commit
einen Autor trägt:

| Aufrufer | Plan | Apply |
|---|---|---|
| Eine angemeldete Person, die `schema:write` hält | ja | ja |
| Ein API-Key, der `schema:read` / `schema:write` hält | ja | nein |
| Der Service-Key des Servers | ja | nein |

Ein Credential ist kein Autor. `api-key:7c3f…` in Ihrer CI-Umgebung ist nicht
eine reale Person, und wenn man diesem erlaubt, in Ihr Repository zu schreiben, entsteht genau die
nicht zuordenbare Historie, zu deren Ersatz dieses Feature existiert.

Unter 0.23 verläuft die Grenze an der Rolle `admin`: Ein Admin plant und wendet an, und jeder
API-Key darf planen.

Wenn eine automatisierte Schemaänderung das ist, was Sie wollen – etwa eine Migrations-Pipeline –,
aktivieren Sie dies bewusst:

```typescript no-verify
initializeRebaseBackend({
    // …the rest of your config
    liveSchema: { allowMachineApply: true }
})
```

oder `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY=true`. Der Commit wird dann
dem Credential namentlich zugeschrieben – `Rebase API key (7c3f)` –, sodass das Lesen von `git log`
einen Monat später Ihnen immer noch mitteilt, welche Änderungen von einer Person vorgenommen wurden.

`GET /api/admin/schema/status` meldet, was *Sie* tun dürfen, nicht nur, was der
Server unterstützt. So kann ein Panel das Steuerelement deaktivieren und begründen, warum, anstatt
Sie abzuweisen, nachdem Sie die Entscheidung getroffen haben:

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

Das Anwenden hier schreibt **keine** Migration und kann dies auch nicht: Eine Migration entspricht Atlas'
Format mit einer Integritätsdatei, erzeugt von einer externen Binärdatei gegen eine temporäre
Wegwerf-Datenbank – und ein laufender Server hat keines von beiden.

Was es jedoch committet, ist die Collection – und genau daraus schreibt
`rebase db generate` die Migration. Die Migration ist also nur einen Befehl entfernt:

```bash
rebase db generate
```

Sowohl der Plan als auch das Ergebnis weisen darauf hin, wenn Ihr Projekt Migrationen verwendet, da
der Fehler andernfalls stillschweigend geschieht: Ihre Datenbank hat die Änderung und Ihr Repository
beschreibt sie, aber die nächste Umgebung, die durch das erneute Abspielen von Migrationen aufgebaut wird, hat sie nicht –
und nichts hat einen Hinweis darauf gegeben.

Ein Projekt, das über Boot-Ensure bereitgestellt wird – die Managed Runtime und jedes Self-Hosting,
das `REBASE_MIGRATE_ON_BOOT` auf dem Standardwert belässt –, benötigt überhaupt keine Migration. Seine
Collections sind das Schema, und der nächste Boot gleicht es ab.

## Zuerst committen, dann anwenden

Die Reihenfolge ist wichtig und nicht willkürlich gewählt.

Wenn das DDL zuerst ausgeführt würde und der Commit fehlschlagen würde, hätte Ihre Datenbank eine Spalte,
die Ihr Repository nicht beschreibt. Der Ensure-Pfad löscht niemals etwas, sodass der
nächste Deploy sie weder entfernen noch erwähnen würde – eine unsichtbare Spalte, die in
Ihren Collections fehlt, bis sich jemand auf die Suche macht.

Zuerst zu committen scheitert auf die umgekehrte Weise: Das Repository beschreibt etwas, das
die Datenbank noch nicht hat. Das ist der normale Zustand jedes Projekts zwischen
einer Bearbeitung und einem Deploy, und der Boot-Vorgang gleicht dies beim nächsten Start ab.

Ein fehlgeschlagenes Apply ist also **kein Fehler**. Die Antwort besagt:

```json
{
  "applied": false,
  "applyError": "connection refused",
  "committed": { "sha": "1a2b3c4de", "branch": "main" },
  "summary": "Committed 1a2b3c4de on main, but the database was not changed. The change will be applied on the next boot."
}
```

## Wo dies funktioniert

Die Trennlinie ist, ob der laufende Server Ihren **Quellcode auf der Festplatte** hat –
nicht, ob es sich um eine Produktionsumgebung handelt.

### MongoDB

Alles oben Beschriebene gilt für Postgres, wo eine Schemaänderung DDL bedeutet. Auf MongoDB
gibt es keine Tabelle zu ändern: Das Hinzufügen einer Property fügt nichts hinzu, das Entfernen entfernt
nichts, und ein gestern geschriebenes Dokument ist morgen noch gültig.

Jede Änderung ist also anwendbar, nichts wird jemals abgelehnt und der Plan hat keine
Statements – der Commit *ist* die Änderung. Das Panel sagt "Commit" statt
"Commit and apply" und behauptet nicht, dass irgendetwas gegen die Datenbank ausgeführt wurde.

Die eine Sache, die man sorgfältig lesen sollte, ist das Entfernen. Auf Postgres wird das Entfernen einer
Property abgelehnt, da dadurch eine Spalte gelöscht werden würde. Auf MongoDB bleibt das Feld
in jedem Dokument erhalten, das es besitzt; Ihre API liefert es lediglich nicht mehr aus. Die Änderung besagt
dies explizit, anstatt Sie die relationale Antwort vermuten zu lassen.

| Deployment | Funktioniert |
|---|---|
| `rebase dev` auf Ihrem Rechner | ja |
| Self-Hosting mit gemountetem Projekt | ja |
| Self-Hosting aus einem gebauten Bundle | ja, mit `liveSchema.repository` |
| Rebase Cloud oder jedes Bundle | ja, mit `liveSchema.repository` |

Ein Bundle ist kompilierte Ausgabe, daher befindet sich darin kein Collection-Quellcode. Konfigurieren
Sie `liveSchema.repository`, wird der Quellcode stattdessen aus Ihrem Repository abgerufen;
ohne dies antworten die Routen mit `SCHEMA_EDITING_NO_REPOSITORY` und nennen den Grund.

### Ein Deployment ohne Quellcode auf der Festplatte

Ein Bundle ist kompilierte Ausgabe – jeder Cloud-Tenant und jedes Self-Hosting, das einen
Build ausliefert. Es gibt keinen Collection-Quellcode, den der Editor neu schreiben könnte; verweisen Sie ihn
daher auf das Repository, in dem der Quellcode tatsächlich liegt:

```typescript no-verify
initializeRebaseBackend({
    // …the rest of your config
    liveSchema: {
        repository: {
            kind: "github",
            owner: "acme",
            repo: "storefront",
            branch: "main",
            // Where the collection source lives in that repository.
            // Defaults to "config/collections".
            collectionsPath: "config/collections",
            auth: { kind: "token", token: process.env.GITHUB_TOKEN! }
        }
    }
})
```

Die Änderung wird dann aus dem Repository gelesen, mit demselben Editor neu geschrieben, der
auch lokal ausgeführt wird, und über die Git Data API zurückgecommittet – ein Blob, ein Tree, ein
Commit und ein Ref-Update. Nichts wird geklont und nichts verbleibt auf der Festplatte.

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
eine App einzurichten, nur damit Ihr eigener Server dorthin committen kann, ist viel Aufwand für
ein einzeiliges Credential. Verwenden Sie die App für eine Control-Plane, die einen Schlüssel für
viele Projekte verwaltet, wie es Rebase Cloud tut: eine App, eine Installation pro
Projekt und kein Secret pro Kunde, das rotiert werden müsste.

Das Token benötigt `contents: read and write` für dieses Repository und sonst nichts.

Auf einem Rechner, der das Repository besitzt, ist der Commit ein einfaches `git commit` –
nichts zu authentifizieren, kein Token, kein Netzwerk. Ein Deployment ohne dieses committet
stattdessen über die Git Data API, ohne Klonen – siehe
[Ein Deployment ohne Quellcode auf der Festplatte](#ein-deployment-ohne-quellcode-auf-der-festplatte).

Zwei Dinge sorgen dafür, dass die Ausführung gegen ein Repository sicher ist, in dem auch andere
Personen arbeiten:

- Es werden **nur** die Dateien gestaged, die generiert wurden. Ein Schema-Commit, der
  halbfertige Arbeiten erfassen würde, wäre ein Commit, den niemand reviewen könnte, und der Vorgang bricht
  sofort ab, wenn im Tree bereits eine seiner eigenen Dateien modifiziert ist.
- Der Remote-Pfad führt niemals ein Force-Update einer Ref durch. Wenn etwas gelandet ist, während der
  Commit erstellt wurde, wird das Update abgelehnt – den Commit von jemandem stillschweigend
  zu verlieren ist schlimmer als ein Fehler.

## Einschränkungen

- Nur additive Änderungen. Alles andere wird mit einer Begründung abgelehnt, da der
  Ensure-Pfad die einzige Komponente ist, die ein Schema ändert, und er kann nur hinzufügen.
- Es wird keine Migrationsdatei geschrieben. Ein Projekt, das über Boot-Ensure bereitgestellt wird, benötigt keine;
  ein über Migrationen bereitgestelltes Projekt sollte `rebase db generate` ausführen, wodurch
  eine Migration über Atlas mit dem von Atlas geforderten Integritäts-Hash erstellt wird.
- Nur Postgres. Die Fähigkeit wird auf Treiberebene erkannt, und andere Engines
  antworten mit `SCHEMA_EDITING_UNSUPPORTED`.

## Verwandte Themen

- [Schema-Generierung](/docs/cli/schema/) — dieselben Bearbeitungen über die Befehlszeile
- [Collections definieren](/docs/collections/) — was der Editor neu schreibt
- [Studio](/docs/studio/) — das Panel, hinter dem diese Routen liegen
