---
sourceHash: da06ce7daeaa1c32
title: Der Remote-MCP-Endpunkt
sidebar_label: Remote-MCP-Endpunkt
description: Stellen Sie MCP über ein deploytes Backend unter /mcp bereit, sodass Personen, die Ihre App nutzen, Claude oder Cursor als sie selbst verbinden können – OAuth mit Zustimmungsbildschirm, 17 Tools unter drei Scopes, jeder Aufruf unter ihrer eigenen Row-Level-Security.
---

:::tip[Claude mit Ihren eigenen Projekten verbinden?]
Dafür gibt es den [Rebase connector](/docs/ai/rebase-connector/): ein Connector für
alle Projekte, und ein selbst gehosteter Server verbindet sich über `rebase cloud connect`. Diese
Seite richtet sich an Personen, die Ihre App **nutzen**.
:::

Der [MCP-Server](/docs/ai/mcp/) ist ein Entwicklertool: Er läuft auf Ihrem Rechner und hält einen
Service-Key oder einen API-Key. Ein bereitgestelltes Backend kann MCP auch selbst unter `/mcp` für
die Personen bereitstellen, die Ihre Anwendung nutzen. Ein Assistent, den jemand von ihnen verbindet,
liest und schreibt das Projekt **als diese Person**, und jeder Aufruf wird unter deren eigener
Row-Level-Security ausgeführt.

Er ist standardmäßig deaktiviert, es sei denn, Sie aktivieren ihn, und beide Variablen sind erforderlich:

```bash
REBASE_MCP_ENABLED=true
REBASE_PUBLIC_URL=https://app.example.com   # this deployment's real origin
```

Ohne `REBASE_PUBLIC_URL`, ein JWT-Secret oder einen Datentreiber, der eine Abfrage auf einen einzelnen
Benutzer beschränken kann, weigert sich der Endpunkt zu mounten und nennt den Grund im Boot-Log. Keine
`REBASE_ROLE` schaltet ihn ein.

- **OAuth mit einem Zustimmungsbildschirm.** Ein Client findet den Autorisierungsserver
  über `/.well-known/oauth-protected-resource`, registriert sich selbst (dynamische
  Registrierung ist standardmäßig aktiviert; `REBASE_MCP_OPEN_REGISTRATION=false` beschränkt sie
  auf Clients, die Sie registrieren) und leitet die Person zu einem Zustimmungsbildschirm weiter,
  der sie über Ihr bestehendes `/auth/login` anmeldet. Ein Konto mit einem zweiten Faktor
  wird dann über die bestehenden `/auth/mfa/challenge`-Routen nach seinem Authenticator-Code oder
  einem Wiederherstellungscode gefragt. Wenn das Frontend Ihrer eigenen App eine Sitzung im
  selben Browser hält, bietet der Bildschirm dieses Konto an, und „Zulassen“ erteilt die
  Zustimmung ohne Passwort; so verbindet sich jemand, der sich nur mit Google, GitHub oder einem
  E-Mail-Link anmeldet. Andernfalls erfolgt die Anmeldung mit einem Passwort, und wer keines hat,
  legt zuerst über `/auth/forgot-password` eines fest („Passwort vergessen“ Ihrer App); der
  Bildschirm weist darauf hin. Er nennt auch den Host, an den der Autorisierungscode gesendet wird,
  und weist darauf hin, dass dieser Host nicht verifiziert ist: Da jeder einen Client unter
  beliebigem Namen registrieren kann, ist der Host der Teil, den eine Person überprüfen kann.
- **Siebzehn Tools, drei Scopes.** Dieselben [Scopes](/docs/backend/roles-and-scopes/),
  die jedes Credential verwendet. `data:read` bietet `list_tables`, `describe_table`,
  `query_table`, `count_rows`, `aggregate_rows`, `get_row`, die drei Views,
  `show_table`, `show_record` und `show_app`, `show_app_guide` sowie die experimentellen
  `list_apps` und `open_app`; `data:write` fügt `create_row`, `update_row` und die
  experimentellen `save_app` und `delete_app` hinzu; `data:delete` fügt `delete_row` hinzu. Ein Client,
  der nichts anfordert, erhält `data:read`. Jeder Scope lässt sich auf eine Tabelle eingrenzen: `data:read:posts`
  listet, beschreibt und liest `posts` und nichts anderes. Ein Scope entscheidet darüber, welche Tools
  angeboten werden und welche Tabellen sie erreichen, nicht über die Zeilen: Eine leere Liste kann bedeuten,
  dass RLS greift, und `data:write` kann weiterhin keine Zeile schreiben, die die Person nicht schreiben dürfte.
- **Drei Tools bringen Ihr Admin-Panel direkt zur Person.** In einem Client,
  der MCP Apps rendert (wie Claude), öffnen sie die Ansichten des Admin-Panels direkt
  in der Konversation, basierend auf den Tabellen-Deskriptoren, die das Backend für diese
  Person bereitstellt – Spalten, Enums, Validierung, Relationen – zusammen mit den UI-Präferenzen,
  die das Panel zusammensetzt: die im Bundle mitgelieferte `ui-config.json`, die des Workspaces und
  die der Person selbst (ein API-Key hat keine), sodass Labels, Spaltenreihenfolge, ausgeblendete
  Spalten und Enum-Labels mit dem Panel übereinstimmen. Die eigenen Panel-Anpassungen Ihres Projekts
  werden dort angezeigt, wo das Backend seine MCP-Ansicht bereitstellt.
  - `show_table` nimmt die Argumente von `query_table` sowie `view`
    (`table`, `list`, `cards` oder `kanban`) entgegen und öffnet die Ansicht der Tabelle: Die
    Person kann suchen, filtern, sortieren und paginieren, das Formular einer Zeile öffnen und Zeilen hinzufügen.
  - `show_record` öffnet das Formular einer Zeile (`id`) oder ein Formular für eine neue Zeile,
    das mit den vom Modell ausgefüllten `values` vorbefüllt ist, damit die Person es selbst prüfen und
    speichern kann.
  - `show_app` führt eine App aus, die das Modell für die jeweilige Aufgabe schreibt: eine React-Komponente
    (`code`) und die `tables`, die sie liest. Sie importiert die Rebase-eigenen
    Pakete, sodass derselbe Code in Ihrem Projekt funktioniert:
    - `@rebasepro/app`: `useRows`, `useRow`, `useRowCount`, `useAggregate`
      und `useRowWrites` über die Zeilen des Projekts;
    - `@rebasepro/cms`: das `CollectionPanel` des Admin-Panels (mit
      `CollectionToolbar` und deren Bestandteilen sowie `onRowClick`, das der
      App die angeklickte Zeile so übergibt, wie `useRows` sie liest), `RecordForm` und `FormField`,
      `RecordDetail`, `FieldValue` und `useSidePanel`, jeweils mit Angabe der
      Tabelle per Pfad, mit Ihren benutzerdefinierten Feldern, Ansichten und Aktionen;
    - `@rebasepro/ui`, das gesamte UI-Kit, einschließlich `SplitView` sowie KPI-Kacheln und
      Diagrammen.

    Der Server kompiliert sie zuerst, sodass ein Syntaxfehler, ein Modul, das die Ansicht
    nicht bereitstellt, oder ein Name, der nicht aus `@rebasepro/cms` oder
    `@rebasepro/app` bereitgestellt wird, der Fehler des Aufrufs ist – inklusive Zeilenangabe. Ein Fehler während
    der Laufzeit wird an deren Stelle angezeigt und dem Modell mit der nächsten Nachricht der Person
    mitgeteilt. Eine App darf nur die Tabellen verwenden, die sie auflistet. Ihre Stile sind
    die Standard-Hilfsklassen von Tailwind, die mit der Ansicht gebaut wurden, bevor eine App
    geladen wird: Ein beliebiger Wert wie `h-[560px]` bewirkt dort nichts, daher ist eine
    exakte Größe als `style` anzugeben.

    Die Beschreibung von `show_app` enthält nur das Wesentliche, da ein Client
    eine lange Tool-Beschreibung kürzen kann (claude.ai tut dies ab etwa 4.000
    Zeichen). Sie weist das Modell an, zuerst `show_app_guide` aufzurufen, das
    jeden Hook, jede Komponente und jedes Prop zurückgibt, das eine App verwenden darf, mit einem
    ausgearbeiteten Beispiel. `show_app_guide` wird überall dort angeboten, wo auch `show_app` verfügbar ist.

  Jeder Lese- und Speichervorgang in der Ansicht ist ein Aufruf der Lese- und Schreib-Tools,
  ausgeführt als die Person unter deren RLS. Daher bietet ein Formular nur das an, was ihrer
  Verbindung gewährt wurde: Ohne `data:write` ist es schreibgeschützt, und ein Feld,
  das ihre Rollen nicht lesen dürfen, ist nicht darin enthalten. Das ist auch die Grenze, innerhalb
  derer der Code einer App arbeitet: Er läuft in der Ansicht, sodass jeder Aufruf, den er tätigt,
  eines dieser Tools ist – als die Person – und er nichts tun kann, was das Modell nicht auch mit
  denselben Tools tun könnte. Auf dem gehosteten Connector wird jeder Schreibvorgang zudem vom Server
  geplant und bestätigt. Innerhalb dessen fragt `useRowWrites` die Person vor dem Schreiben,
  sodass eine App nicht ohne deren Klick schreibt; die eigenen Steuerelemente des Admins
  (das Speichern eines Formulars, ein Löschvorgang, eine Tabellenbearbeitung) verhalten sich so wie auf
  einem `show_table`-Bildschirm. Dem Modell wird mitgeteilt, was geändert wurde. Es liest die Zeilen,
  die jedes Tool zurückgibt, nicht die Deskriptoren, mit denen die Ansicht zeichnet. Ein Client ohne
  MCP Apps (wie Claude Code oder Cursor) zeigt nichts an, und das Modell liest dieselben Zeilen,
  die es von `query_table` erhalten würde.
- **Experimentell: Im Projekt gespeicherte Apps.** `save_app` speichert eine App, die das
  Modell mit `show_app` erstellt hat, damit sie erneut geöffnet werden kann: Es kompiliert den Code wie
  `show_app` und speichert ihn mit `title`, `tables` und `visibility`,
  was `personal` (Besitzer, der Standard), `roles` (jeder mit einer der angegebenen `roles`)
  oder `team` (jeder, der sich anmeldet) sein kann. Das Speichern für mehr als sich selbst erfordert
  die Admin-Rolle, da eine geteilte App von einer KI geschriebener Code ist, der für andere Personen
  ausgeführt wird. Nur der Besitzer oder ein Admin kann eine App ersetzen (`id`) oder löschen,
  und eine Person kann höchstens 200 behalten. `list_apps` listet die Apps auf, die der Aufrufer
  öffnen darf, `open_app` öffnet eine wie `show_app`, und `delete_app` entfernt eine. Eine App zu
  sehen bedeutet nicht, Zugriff auf deren Daten zu haben: Eine geöffnete App liest und schreibt über
  die oben genannten Tools, als die Person, die sie öffnet, unter deren RLS. Die Apps befinden sich
  in `rebase.saved_apps`, das das Backend beim ersten Aufruf durch ein Tool erstellt und keinem
  Endbenutzer direkt gewährt.
  Das Admin-Panel öffnet dieselben Apps: Fügen Sie Ihren `views` die `savedAppsView` aus
  `@rebasepro/cms` hinzu. Es führt eine App in einem iframe aus, der ohne `allow-same-origin`
  und ohne eigenes Netzwerk isoliert ist, und leitet deren Tool-Aufrufe an `POST /api/admin/apps/mcp`
  weiter – dieselben Tools für die Sitzung des Admin-Panels, die unabhängig von `REBASE_MCP_ENABLED`
  mit den Admin-Routen gemountet wird. Die Namen und Signaturen der Tools können sich noch ändern.
- **Vor Version 0.24 erteilte Berechtigungen behalten ihren Umfang.** `mcp:read` wird bei
  gespeicherten Grants und bereits ausgestellten Tokens als `data:read` interpretiert, und `mcp:write`
  als `data:write data:delete`.
- **Ein API-Key funktioniert ebenfalls.** `/mcp` akzeptiert auch `Authorization: Bearer rk_…` für
  einen Client, der über einen Header statt über einen OAuth-Flow konfiguriert ist. Der Key erreicht
  die Tools, die durch seine `data:*`-Scopes abgedeckt sind, im Namen dessen, für den er agiert: ein
  [persönlicher Key](/docs/backend/api-keys/#personal-keys) als sein Besitzer, ein Service-Key
  als `api-key:<id>`.
- **Das Vokabular des SDK, die Antworten von REST.** Die Tools akzeptieren dieselben Parameter wie das SDK –
  `where` (`{"status": ["==", "paid"]}`), `orderBy` (`["created_at", "desc"]` oder
  `"created_at:desc"`), `limit`, `offset`, `searchString` und `data` für Schreibvorgänge –
  und lesen über den Pfad `GET /api/data/<table>`, sodass eine Zeile so zurückgegeben wird,
  wie REST sie bereitstellt (ISO-Datumsangaben, ein `belongsTo` als Fremdschlüssel, z. B.
  `authorId`), und in einer Aktualisierung unverändert zurückgesendet werden kann. `query_table`
  antwortet mit `{ data, meta }` inklusive `meta.total` und `meta.hasMore`, und `count_rows` mit
  `{ count }`; `tools/list` liefert für beide sowie für `aggregate_rows` und `get_row`
  ein `outputSchema`, das flexibel gehalten ist, wo Antworten variieren. `aggregate_rows` entspricht `GET /api/data/<table>/aggregate`:
  `select` ist eine Liste in der REST-Grammatik (`["count()", "sum(total)"]`), `groupBy`
  eine Liste von Feldern, und die Antwort ist `{ data }` mit einer Zeile pro Gruppe sowie
  `meta.hasMore` bei einem gruppierten Aufruf, dessen Gruppen mit `limit` und `offset` paginiert
  und mit `orderBy` sortiert werden können. Bei einer Tabelle, die durch einen `afterRead`-Hook umgeschrieben wird,
  liefert es `count()` allein zurück, genau wie REST. Wie bei REST werden ein `limit` über 1000, ein nicht deklariertes
  Argument sowie das Bearbeiten oder Löschen einer im Papierkorb befindlichen Zeile (404) abgelehnt; das Setzen des
  Soft-Delete-Feldes auf `null` stellt sie wieder her. `deleted: "only"` (oder `"include"`) bei
  `query_table`, `count_rows` und `aggregate_rows` liest den Papierkorb aus, genau wie `?deleted=` bei REST,
  sodass eine von `delete_row` gelöschte Zeile wiedergefunden und wiederhergestellt werden kann. Die Beschreibung
  weist das Modell darauf hin, dass der Löschvorgang nur dann dauerhaft ist, wenn die Tabelle kein Soft-Delete-Feld hat.
- **Die Auflistung nennt die Tabellen; `describe_table` liefert das Schema.**
  `list_tables` liefert `{ tables: [{ name, description, kind? }] }` – ohne Label –
  und `describe_table { table }` die OpenAPI-Schemas `row` (die Spalten, die diesem Aufrufer bereitgestellt werden)
  und `create` (die beschreibbaren) dieser Tabelle, ihren `primaryKey`, bereitgestellte `relations` und `rls` (rohes SQL,
  ohne `schema:read` unkenntlich gemacht), plus `softDeleteField`, falls Zeilen in einen Papierkorb verschoben werden,
  sowie die Darstellungsvorgaben aus den UI-Präferenzen des Aufrufers: `title` und pro Spalte `label`, `valueLabels`,
  `hidden`, `hiddenInForm`, `readOnly`. Was eine Verbindung über das Schema erfahren darf, wird durch denselben Serializer
  entschieden, den auch `GET /api/schema/tables` verwendet. Die Tool-Beschreibungen weisen das Modell an,
  eine Tabelle zu beschreiben, bevor es in sie schreibt. Die Auflistung eines Projekts mit 200 Tabellen umfasst
  etwa 5.000 Tokens, und jede Beschreibung unter 1.000 Tokens; wenn jedes Schema in der Auflistung enthalten wäre,
  läge sie bei etwa 150.000 Tokens.
- **Ein Token nur für diesen Endpunkt.** Ein MCP-Access-Token wird von
  `/api/data`, `/api/admin` und dem WebSocket abgelehnt, sodass die Verbindung eines Assistenten diesem
  keine allgemeine Sitzung überlässt.

Jede Anfrage an `/mcp` liest das Konto der Person erneut aus. Ein gelöschtes oder deaktiviertes
Konto, ein „Überall abmelden“ oder eine Passwortänderung nach Ausstellung des Tokens stoppt einen
verbundenen Client sofort mit einem 401-Fehler. Eine Herabstufung von Rechten wird beim nächsten
Tool-Aufruf wirksam. Jeder Refresh führt dieselben Prüfungen durch und verweigert eine solche Autorisierung
dauerhaft. Eine Gastsitzung kann überhaupt keine Zustimmung erteilen.

Eine Einschränkung: Das Trennen eines Clients (`DELETE /api/oauth/grants/:clientId` mit der eigenen
Sitzung der Person) widerruft dessen Refresh-Tokens sofort, aber ein bereits ausgestelltes Access-Token
funktioniert weiter, bis es abläuft (innerhalb einer Stunde).

## Skills

Der Endpunkt kann auch [Agent Skills](https://agentskills.io/specification)
über MCP bereitstellen: Anweisungen, die ein Assistent lädt, wenn die Aufgabe es erfordert, beispielsweise
wie Ihr Team eine Bestellung anlegt oder was ein bestimmtes Feld bedeutet. Platzieren Sie jeden Skill in einem
eigenen Ordner mit einer `SKILL.md`, deren Frontmatter einen zum Ordner passenden `name` und eine `description`
enthält, zusammen mit allen verlinkten Dateien. Geben Sie dann den übergeordneten Ordner in der Backend-Konfiguration an:

```ts
// skills/order-intake/SKILL.md, skills/order-intake/references/fields.md, …
createRebaseBackend({
    ...options, // the rest of your backend config
    mcp: { skills: "./skills" }
});
```

Der Pfad ist relativ zum Arbeitsverzeichnis. Die Daten-Tools bleiben unverändert,
und `skills` befindet sich neben `tools`, wenn ein Backend eigene mitbringt.

- **Was ein Client sieht.** Clients mit Protokollversion 2026-07-28 oder neuer
  (Claude Code, Claude) listen die Skills auf und laden einen, wenn er relevant ist.
  Claude Code benennt jeden einzelnen als `<connector>:<skill>`. Diese werden über
  die MCP-Skills-Erweiterung (`io.modelcontextprotocol/skills`) bereitgestellt: `skills/list`,
  `skills/get` und `resources/read` von `skill://<name>/…`. Jeder Skill wird mit einem
  SHA-256-Manifest seiner Dateien ausgeliefert. Der Client gleicht jede Datei mit diesem
  Manifest ab, und die Zustimmung der Person ist daran gebunden.
- **Wer sie lesen kann.** Jede authentifizierte Verbindung, unabhängig von ihren Scopes.
  Packen Sie nichts in einen Skill, das nicht für jeden bestimmt ist, der sich verbindet.
- **Wann sie sich ändern.** Der Ordner wird bei der ersten Anfrage gelesen, die ihn benötigt,
  sodass eine Änderung beim nächsten Deployment oder Neustart wirksam wird. Eine Datei, die sich
  vorher auf der Festplatte ändert, wird abgelehnt und nicht anhand eines Manifests ausgeliefert,
  zu dem sie nicht mehr passt.
- **Was ausgelassen wird.** Ein Skill, der gegen eine Regel verstößt, wird übersprungen, und
  das Boot-Log gibt den Grund an. Die Regeln: kein Frontmatter, ein Name, der vom Ordnernamen
  abweicht, ein symbolischer Link innerhalb des Ordners oder mehr als 512 Dateien bzw. 16 MiB.
  Versteckte Dateien wie `.gitkeep` werden niemals bereitgestellt. Ein Skill, der die Grenzen von
  Claude Code überschreitet (100 KB pro Datei, 400 KB insgesamt), wird mit einer Warnung
  bereitgestellt, da Claude Code ihn nicht laden wird.

Der Endpunkt unterstützt beide Protokoll-Ären. Ein Client aus der 2025er-Ära startet wie
bisher mit `initialize`. Ein 2026-07-28-Client sendet keinen Handshake. Jede Anfrage übermittelt
ihre Protokollversion und Capabilities in `params._meta` sowie über die Header `MCP-Protocol-Version`,
`Mcp-Method` und `Mcp-Name`, die mit dem Body übereinstimmen müssen. Die Capabilities stammen aus
`server/discover`. Skills werden ausschließlich dort deklariert.

Die Routen finden Sie unter [Endpoints](/docs/backend/endpoints/#mcp-surface) und die
Variablen unter [Configuration](/docs/getting-started/configuration/#mcp-surface).
