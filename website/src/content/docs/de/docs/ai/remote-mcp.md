---
sourceHash: 4c9e8266acfba86f
title: Der Remote-MCP-Endpunkt
sidebar_label: Remote-MCP-Endpunkt
description: Stellen Sie MCP über ein bereitgestelltes Backend unter /mcp bereit, damit die Personen, die Ihre App nutzen, Claude oder Cursor als sie selbst verbinden können – OAuth mit Zustimmungsbildschirm, siebzehn Tools unter drei Scopes, jeder Aufruf unter deren eigener Row-Level Security.
---

:::tip[Claude mit Ihren eigenen Projekten verbinden?]
Das ist der [Rebase-Connector](/docs/ai/rebase-connector/): ein Connector für
alle, und ein selbst gehosteter Server verbindet sich über `rebase cloud connect` damit. Diese
Seite ist für die Personen gedacht, die Ihre App **nutzen**.
:::

Der [MCP-Server](/docs/ai/mcp/) ist ein Entwicklertool: Er läuft auf Ihrem Rechner und enthält einen Service-Key
oder einen API-Key. Ein bereitgestelltes Backend kann MCP auch selbst unter `/mcp` für
die Personen bereitstellen, die Ihre Anwendung nutzen. Ein Assistent, den eine dieser Personen verbindet, liest und
schreibt das Projekt **als diese Person**, und jeder Aufruf wird unter deren eigener
Row-Level Security ausgeführt.

Er ist standardmäßig deaktiviert, und beide Variablen sind erforderlich:

```bash
REBASE_MCP_ENABLED=true
REBASE_PUBLIC_URL=https://app.example.com   # this deployment's real origin
```

Ohne `REBASE_PUBLIC_URL`, ein JWT-Secret oder einen Datentreiber, der eine Abfrage
auf einen Benutzer beschränken kann, weigert sich der Endpunkt zu mounten und gibt den Grund im
Boot-Log an. Keine `REBASE_ROLE` schaltet ihn ein.

- **OAuth mit einem Zustimmungsbildschirm.** Ein Client findet den Autorisierungsserver
  über `/.well-known/oauth-protected-resource`, registriert sich selbst (dynamische
  Registrierung ist standardmäßig aktiviert; `REBASE_MCP_OPEN_REGISTRATION=false` beschränkt sie
  auf von Ihnen registrierte Clients) und leitet die Person zu einem Zustimmungsbildschirm (Consent Screen) weiter,
  der sie über Ihr bestehendes `/auth/login` anmeldet. Ein Konto mit einem zweiten Faktor
  wird dann über die bestehenden `/auth/mfa/challenge`-Routen nach seinem Authenticator-Code
  oder einem Recovery-Code gefragt. Wenn das Frontend Ihrer eigenen App
  eine Sitzung im selben Browser hält, bietet der Bildschirm dieses Konto an, und
  „Zulassen“ stimmt als dieses Konto ohne Passwort zu; so verbindet sich jemand, der sich nur
  mit Google, GitHub oder einem E-Mail-Link anmeldet. Andernfalls erfolgt die Anmeldung mit einem
  Passwort, und jemand ohne Passwort legt zuerst eines über `/auth/forgot-password`
  fest (das „Passwort vergessen“ Ihrer App); der Bildschirm weist darauf hin. Er nennt auch den Host, an den der Autorisierungscode gesendet
  wird, und weist darauf hin, dass dieser Host nicht verifiziert ist: Jeder kann einen Client unter
  beliebigem Namen registrieren, daher ist der Host der Teil, den eine Person überprüfen kann.
- **Siebzehn Tools, drei Scopes.** <span class="since-badge" data-since="0.31">Seit 0.31</span> Dieselben [Scopes](/docs/backend/roles-and-scopes/),
  die jedes Credential verwendet. `data:read` bietet `list_tables`, `describe_table`,
  `query_table`, `count_rows`, `aggregate_rows`, `get_row`, die drei Views
  `show_table`, `show_record` und `show_app`, `show_app_guide` sowie die experimentellen
  `list_apps` und `open_app`; `data:write` fügt `create_row`, `update_row` und die
  experimentellen `save_app` und `delete_app` hinzu; `data:delete` fügt `delete_row` hinzu. Ein Client, der nichts
  anfordert, erhält `data:read`. Jeder Scope lässt sich auf eine Tabelle eingrenzen: `data:read:posts`
  listet, beschreibt und liest `posts` und nichts sonst. Ein Scope bestimmt, welche Tools
  angeboten werden und welche Tabellen sie erreichen, nicht welche Zeilen: Eine leere Liste kann das
  Ergebnis von RLS sein, und `data:write` kann weiterhin keine Zeile schreiben, die die Person selbst nicht schreiben könnte.
- **Drei Tools bringen Ihr Admin-Panel direkt zur Person.** In einem Client, der
  MCP Apps rendert, wie etwa Claude, öffnen sie die viewspezifischen Ansichten des Admin-Panels direkt in der
  Konversation. Diese basieren auf den Tabellendeskriptoren, die das Backend für diese
  Person bereitstellt – Spalten, Enums, Validierung, Relationen – zusammen mit den UI-Präferenzen,
  die das Panel zusammensetzt: die im Bundle enthaltene `ui-config.json`, die des Workspaces und
  die der Person selbst (ein API-Key hat keine), sodass Beschriftungen (Labels), Spaltenreihenfolge, ausgeblendete
  Spalten und Enum-Labels mit dem Panel übereinstimmen. Die panelspezifischen
  Anpassungen Ihres Projekts werden dort angezeigt, wo das Backend seine MCP-Ansicht bereitstellt.
  - `show_table` nimmt die Argumente von `query_table` sowie `view`
    (`table`, `list`, `cards` oder `kanban`) entgegen und öffnet die Tabellenansicht: Die
    Person kann suchen, filtern, sortieren und paginieren, das Formular einer Zeile öffnen und Zeilen hinzufügen.
  - `show_record` öffnet das Formular einer einzelnen Zeile (`id`) oder ein Formular für eine neue Zeile,
    das mit den vom Modell ausgefüllten `values` vorausgefüllt ist, damit die Person diese selbst überprüfen
    und speichern kann.
  - `show_app` führt eine App aus, die das Modell für die jeweilige Aufgabe schreibt: eine React-Komponente
    (`code`) und die `tables`, die sie liest. Sie importiert die Rebase-eigenen
    Pakete, sodass derselbe Code in Ihrem Projekt funktioniert:
    - `@rebasepro/app`: `useRows`, `useRow`, `useRowCount`, `useAggregate`
      und `useRowWrites` über die Zeilen des Projekts;
    - `@rebasepro/cms`: das `CollectionPanel` des Admin-Panels (mit
      `CollectionToolbar` und dessen Bestandteilen sowie `onRowClick`, das der
      App die angeklickte Zeile so übergibt, wie `useRows` sie liest), `RecordForm` und `FormField`,
      `RecordDetail`, `FieldValue` und `useSidePanel`, jeweils unter Angabe der
      Tabelle per Pfad, mit Ihren benutzerdefinierten Feldern, Views und Aktionen;
    - `@rebasepro/ui`, das gesamte UI-Kit, einschließlich `SplitView` sowie den KPI-Kacheln und
      Diagrammen.

    Der Server kompiliert sie zuerst, sodass ein Syntaxfehler, ein Modul, das die Ansicht
    nicht bereitstellt, oder ein Name, den sie nicht aus `@rebasepro/cms` oder
    `@rebasepro/app` bereitstellt, der Fehler des Aufrufs ist, inklusive Zeilenangabe. Ein Fehler während
    der Ausführung wird an Ort und Stelle angezeigt und dem Modell mit der nächsten Nachricht der
    Person mitgeteilt. Eine App darf nur die Tabellen verwenden, die sie auflistet. Ihre Styles sind
    Tailwinds Standard-Utilities, die mit der View gebaut wurden, bevor eine App
    empfangen wird: Ein beliebiger Wert wie `h-[560px]` bewirkt dort nichts, daher ist eine
    genaue Größenangabe ein `style`.

    Die Beschreibung von `show_app` enthält nur das Wesentliche, da ein Client
    eine lange Tool-Beschreibung möglicherweise kürzt (claude.ai tut dies bei etwa 4.000
    Zeichen). Sie weist das Modell an, zuerst `show_app_guide` aufzurufen, das
    jeden Hook, jede Komponente und jede Prop zurückgibt, die eine App verwenden darf, zusammen mit einem
    ausgearbeiteten Beispiel. `show_app_guide` wird überall dort angeboten, wo auch `show_app` angeboten wird.

  Jeder Lese- und Speichervorgang in der View ist ein Aufruf der Lese- und Schreib-Tools,
  der als die Person unter deren RLS ausgeführt wird, sodass ein Formular nur das anbietet, was ihrer
  Verbindung gewährt wurde: Ohne `data:write` ist es schreibgeschützt, und ein Feld,
  das ihre Rollen nicht lesen können, ist darin nicht enthalten. Das ist auch die Grenze, innerhalb derer der Code
  einer App operiert: Er läuft in der View, daher ist jeder Aufruf, den er tätigt, eines
  dieser Tools als die Person, und er kann nichts tun, was das Modell nicht auch mit denselben Tools tun könnte.
  Auf dem gehosteten Connector wird jeder Schreibvorgang zudem vom Server geplant
  und bestätigt. Innerhalb dessen fragt `useRowWrites` die Person,
  bevor geschrieben wird, sodass eine App nicht ohne deren Klick schreibt; die
  eigenen Steuerelemente des Admins (das Speichern eines Formulars, ein Löschen, eine Tabellenbearbeitung) verhalten sich so
  wie auf einem `show_table`-Bildschirm. Dem Modell wird mitgeteilt, was geändert wurde. Es liest die Zeilen, die jedes Tool zurückgibt, nicht die Deskriptoren, mit denen die
  View gerendert wird. Ein Client ohne MCP Apps, wie etwa Claude Code oder Cursor, zeigt nichts an,
  und das Modell liest dieselben Zeilen, die es von `query_table` erhalten würde.
- **Experimentell: Im Projekt gespeicherte Apps.** `save_app` behält eine App, die das
  Modell mit `show_app` erstellt hat, damit sie erneut geöffnet werden kann: Es kompiliert den Code wie
  `show_app` und speichert ihn mit `title`, `tables` und
  `visibility`, was `personal` (ihr Eigentümer, Standard), `roles` (jeder
  mit einer ihrer `roles`) oder `team` (jeder, der sich anmeldet) sein kann. Das Speichern für
  mehr Personen als sich selbst erfordert die Admin-Rolle, da eine geteilte App Code ist, den eine KI
  geschrieben hat und der für andere Personen ausgeführt wird. Nur ihr Eigentümer oder ein Admin kann eine App ersetzen
  (`id`) oder löschen, und eine Person kann höchstens 200 behalten. `list_apps` listet
  die Apps auf, die der Aufrufer öffnen darf, `open_app` öffnet eine App so wie `show_app`, und
  `delete_app` entfernt eine. Eine App zu sehen bedeutet nicht, Zugriff auf deren Daten zu haben: Eine geöffnete
  App liest und schreibt über die oben genannten Tools als diejenige Person, die sie öffnet, unter
  deren RLS. Die Apps befinden sich in `rebase.saved_apps`, das das Backend
  beim ersten Verwenden durch ein Tool erstellt und keinem Endbenutzer gewährt.
  Das Admin-Panel öffnet dieselben Apps: Fügen Sie `savedAppsView` aus
  `@rebasepro/cms` zu Ihren `views` hinzu. Es führt eine App in einem iframe aus, der
  ohne `allow-same-origin` und ohne eigenes Netzwerk isoliert ist, und leitet deren
  Tool-Aufrufe an `POST /api/admin/apps/mcp` weiter – dieselben Tools für die Sitzung des
  Admin-Panels, die unabhängig davon, ob `REBASE_MCP_ENABLED` gesetzt ist, mit den Admin-Routen
  gemountet wird. Die Namen und Formen der Tools können sich noch ändern.
- **Vor 0.24 erteilte Berechtigungen behalten ihren Umfang.** `mcp:read` wird bei
  gespeicherten Grants und bereits ausgestellten Tokens als `data:read` interpretiert, und `mcp:write` als `data:write data:delete`.
- **Ein API-Key funktioniert ebenfalls.** `/mcp` akzeptiert auch `Authorization: Bearer rk_…` für
  Clients, die mit einem Header statt über einen OAuth-Flow konfiguriert sind. Der Key erreicht
  die Tools, die seine `data:*`-Scopes abdecken, als derjenige, als der er agiert: ein
  [persönlicher Key](/docs/backend/api-keys/#personal-keys) als sein Eigentümer, ein Service-Key
  als `api-key:<id>`.
- **Das Vokabular des SDKs, die Antworten von REST.** Die Tools akzeptieren das, was das SDK akzeptiert –
  `where` (`{"status": ["==", "paid"]}`), `orderBy` (`["created_at", "desc"]` oder
  `"created_at:desc"`), `limit`, `offset`, `searchString` und `data` für
  Schreibvorgänge – und lesen über den Pfad von `GET /api/data/<table>`, sodass eine Zeile so
  zurückgegeben wird, wie REST sie ausliefert (ISO-Datumsangaben, ein `belongsTo` als Foreign Key, z. B.
  `authorId`), und in einem Update unverändert zurückgesendet werden kann. `query_table`
  antwortet mit `{ data, meta }` mit `meta.total` und `meta.hasMore`, und `count_rows` mit
  `{ count }`; `tools/list` stellt für beide sowie für `aggregate_rows` und `get_row`
  ein `outputSchema` bereit, das dort flexibel gehalten ist, wo eine Antwort variiert. `aggregate_rows` entspricht `GET /api/data/<table>/aggregate`:
  `select` ist eine Liste in der REST-Grammatik (`["count()", "sum(total)"]`), `groupBy`
  eine Liste von Feldern, und die Antwort ist `{ data }` mit einer Zeile pro Gruppe sowie
  `meta.hasMore` bei einem gruppierten Aufruf, dessen Gruppen mit `limit` und `offset` paginiert
  und mit `orderBy` sortiert werden können. Bei einer Tabelle, die durch einen `afterRead`-Hook umgeschrieben wird,
  liefert es nur `count()` aus, genau wie REST. Wie bei REST werden ein `limit` über 1000, ein nicht deklariertes Argument sowie das
  Bearbeiten oder Löschen einer im Papierkorb befindlichen Zeile (404) abgelehnt; das Setzen des Soft-Delete-Felds
  auf `null` stellt sie wieder her. `deleted: "only"` (oder `"include"`) bei
  `query_table`, `count_rows` und `aggregate_rows` liest den Papierkorb aus, genau wie RESTs
  `?deleted=`, sodass eine Zeile, die von `delete_row` in den Papierkorb verschoben wurde, wiedergefunden und
  wiederhergestellt werden kann. Seine Beschreibung teilt dem Modell mit, dass das Löschen nur dann dauerhaft ist, wenn
  die Tabelle kein Soft-Delete-Feld hat.
- **Die Auflistung nennt die Tabellen; `describe_table` liefert das Schema einer Tabelle.**
  `list_tables` antwortet mit `{ tables: [{ name, description, kind? }] }` – ohne Label –
  und `describe_table { table }` mit den OpenAPI-Schemas `row` (die Spalten, die für diesen Aufrufer bereitgestellt werden)
  und `create` (die beschreibbaren Spalten) der Tabelle, ihrem `primaryKey`, bereitgestellten `relations` und `rls` (rohes SQL
  ohne `schema:read` unkenntlich gemacht), plus `softDeleteField`, wenn Zeilen in den
  Papierkorb wandern, sowie der Darstellung, die sich aus den UI-Präferenzen des Aufrufers ergibt: `title` und
  pro Spalte `label`, `valueLabels`, `hidden`, `hiddenInForm`, `readOnly`. Was eine
  Verbindung über das Schema erfahren darf, wird durch denselben Serializer bestimmt, den
  `GET /api/schema/tables` verwendet. Die Tool-Beschreibungen weisen das Modell an,
  eine Tabelle vor dem Schreiben zu beschreiben. Die Auflistung eines Projekts mit 200 Tabellen umfasst
  etwa 5.000 Tokens und jede Beschreibung
  unter 1.000; wären alle Schemas in der Auflistung enthalten, wären es etwa 150.000 gewesen.
- **Ein Token nur für diesen Endpunkt.** Ein MCP-Access-Token wird von
  `/api/data`, `/api/admin` und dem WebSocket abgelehnt, sodass das Verbinden eines Assistenten diesem
  keine Sitzung überlässt.

Jede Anfrage an `/mcp` liest das Konto der Person neu ein. Ein gelöschtes oder deaktiviertes
Konto, ein „Überall abmelden“ oder eine Passwortänderung nach Ausstellung des Tokens
stoppt einen verbundenen Client sofort mit einem 401. Eine Herabstufung wird beim
nächsten Tool-Aufruf wirksam. Jeder Refresh führt dieselben Prüfungen durch und verweigert eine solche Berechtigung
endgültig. Eine Gastsitzung kann überhaupt keine Zustimmung erteilen.

Eine Einschränkung: Das Trennen eines Clients (`DELETE /api/oauth/grants/:clientId`, mit der
eigenen Sitzung der Person) widerruft dessen Refresh-Tokens sofort, ein bereits ausgestelltes Access-Token
bleibt jedoch bis zu seinem Ablauf innerhalb einer Stunde gültig.

Die Routen finden Sie unter [Endpoints](/docs/backend/endpoints/#mcp-surface) und die
Variablen unter [Configuration](/docs/getting-started/configuration/#mcp-surface).
