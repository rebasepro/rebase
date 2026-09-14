---
sourceHash: 7253b4b5232fa542
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

Alle drei sind Admin-geschützt, genau wie jede andere `/api/admin`-Oberfläche. Das Anwenden erfordert
eine Sache mehr als nur Admin zu sein – siehe [Wer Änderungen anwenden darf](#wer-änderungen-anwenden-darf).

## Erst planen, dann anwenden

`/plan` hat keine Nebeneffekte. Senden Sie die Collection so, wie sie am Ende aussehen soll, und
der Endpunkt teilt Ihnen mit, was die Änderung bedeutet:

`$ADMIN_TOKEN` ist ein Admin-Zugriffstoken – das `accessToken`, das ein Sign-in für
ein Konto mit der Admin-Rolle zurückgibt. Nichts auf dem Rechner setzt es automatisch für Sie.

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
  "files": ["backend/src/schema.generated.ts", "drizzle/schema.sql"]
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
Collection oder Property, das Ändern eines Typs, das Umbenennen einer Spalte, das Ändern eines Primärschlüssels,
das Entfernen eines Enum-Werts. Jede Ablehnung benennt die Änderung und was stattdessen
zu tun ist.

## Was committet wird

Nicht nur die Collection-Datei. Eine Schemaänderung betrifft mehrere generierte
Artefakte, und ein veraltetes Artefakt bringt den nächsten Deploy zum Scheitern:

- `config/collections/<name>.ts` — die Collection selbst
- `backend/src/schema.generated.ts` — das Drizzle-Schema
- `drizzle/schema.sql`, `drizzle/policies.sql`, `drizzle/search.sql`

Diese Pfade sind relativ zu Ihrem **Projekt**, nicht zu Ihrem Repository. Wenn
beide identisch sind – ein `rebase init`-Projekt, was der Regelfall ist –, gibt es
nichts zu bedenken. Wenn sich Ihr Projekt in einem Unterverzeichnis eines größeren
Repositorys befindet, werden die Pfade mit diesem vorangestellt, ermittelt durch das Durchsuchen
von Ihrem Collections-Verzeichnis aufwärts zur nächsten `rebase.json`. Ein Projekt ohne
`rebase.json` behält die einfachen Pfade bei.

Die Commit-Nachricht beschreibt die Änderung, anstatt nur eine anzukündigen, und wird
dem Admin zugeschrieben, der sie vorgenommen hat. Eine Schemaänderung mit einem Autor und einem Diff
in der Historie Ihres Projekts ist etwas, das Ihnen weder Firebase noch Supabase bieten –
deren Tabellenbearbeitungen sind für Ihr Repository unsichtbar.

## Wer Änderungen anwenden darf

Ein Admin zu sein reicht aus, um zu **planen** (`plan`). Das Planen hat keine Nebeneffekte, und ein CI-Job,
der abfragt, ob eine vorgeschlagene Collection-Änderung anwendbar ist, ist ein guter Einsatzzweck dafür.

Das Anwenden (`apply`) ist ein zweites Privileg, da das Anwenden einen Commit schreibt und ein Commit
einen Autor trägt:

| Aufrufer | Plan | Apply |
|---|---|---|
| Ein angemeldeter Admin | ja | ja |
| Ein API-Key | ja | nein |
| Der Service-Key des Servers | ja | nein |

Ein Credential ist kein Autor. `api-key:7c3f…` in Ihrer CI-Umgebung ist nicht
eine reale Person, und wenn man diesem erlaubt, in Ihr Repository zu schreiben, entsteht genau die
nicht zuordenbare Historie, zu deren Ersatz dieses Feature existiert.

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

Was es jedoch schreibt, ist `drizzle/schema.sql` – was genau das ist, wogegen
`rebase db generate` ein Diff bildet. Die Migration ist also nur einen Befehl entfernt:

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
