---
sourceHash: 166fe94f399384db
title: Der Remote-MCP-Endpunkt
sidebar_label: Remote-MCP-Endpunkt
description: Stellen Sie MCP von einem bereitgestellten Backend unter /mcp bereit, sodass die Personen, die Ihre App nutzen, Claude oder Cursor als sie selbst verbinden können – OAuth mit Zustimmungsbildschirm, neun Tools unter drei Scopes, jeder Aufruf unter deren eigener Row-Level Security.
---

:::tip[Claude mit Ihren eigenen Projekten verbinden?]
Dafür gibt es den [Rebase-Connector](/docs/ai/rebase-connector/): ein Connector für
alle Projekte, und ein selbst gehosteter Server verbindet sich über `rebase cloud connect` damit. Diese
Seite ist für die Personen gedacht, die Ihre App **nutzen**.
:::

Der [MCP-Server](/docs/ai/mcp/) ist ein Entwickler-Tool: Er läuft auf Ihrem Rechner und enthält einen Service-Key
oder einen API-Key. Ein bereitgestelltes Backend kann MCP unter `/mcp` auch selbst bereitstellen – für
die Personen, die Ihre Anwendung nutzen. Ein Assistent, den eine dieser Personen verbindet, liest und
schreibt das Projekt **als diese Person**, und jeder Aufruf unterliegt deren eigener
Row-Level Security.

Er ist standardmäßig deaktiviert, und beide Variablen sind erforderlich:

```bash
REBASE_MCP_ENABLED=true
REBASE_PUBLIC_URL=https://app.example.com   # this deployment's real origin
```

Ohne `REBASE_PUBLIC_URL`, ein JWT-Secret oder einen Datentreiber, der eine Abfrage
auf einen einzelnen Benutzer einschränken kann, verweigert der Endpunkt das Einbinden (Mounting) und gibt den Grund im Boot-Log an. Keine
`REBASE_ROLE` schaltet ihn ein.

- **OAuth mit Zustimmungsbildschirm.** Ein Client findet den Autorisierungsserver
  über `/.well-known/oauth-protected-resource`, registriert sich selbst (dynamische
  Registrierung ist standardmäßig aktiviert; `REBASE_MCP_OPEN_REGISTRATION=false` beschränkt sie
  auf Clients, die Sie registrieren) und leitet die Person zu einem Zustimmungsbildschirm weiter, der
  sie über Ihre bestehende Route `/auth/login` anmeldet. Ein Konto mit einem zweiten Faktor
  wird dann über die bestehenden `/auth/mfa/challenge`-Routen nach seinem Authenticator-Code oder einem Wiederherstellungscode
  gefragt. Wenn das eigene Frontend Ihrer App
  eine Sitzung im selben Browser hält, bietet der Bildschirm dieses Konto an, und
  „Zulassen“ erteilt die Zustimmung ohne Passworteingabe; auf diese Weise verbinden sich Personen, die sich ausschließlich
  mit Google, GitHub oder einem E-Mail-Link anmelden. Andernfalls erfolgt die Anmeldung mit einem
  Passwort; Personen ohne Passwort legen zuerst über `/auth/forgot-password` eines fest
  (die Funktion „Passwort vergessen“ Ihrer App); der Bildschirm weist sie darauf hin. Er nennt auch den Host, an den der Autorisierungscode gesendet
  wird, und weist darauf hin, dass dieser Host nicht verifiziert ist: Jeder kann einen Client unter
  einem beliebigen Namen registrieren, daher ist der Host der Teil, den eine Person überprüfen kann.
- **Zwölf Tools, drei Scopes.** Dieselben [Scopes](/docs/backend/roles-and-scopes/),
  die jede Anmeldeinformation verwendet. `data:read` bietet `list_collections`, `describe_collection`,
  `query_collection`, `count_documents`, `aggregate_documents`, `get_document` sowie die drei Ansichten
  `show_collection`, `show_record` und `show_app`; `data:write` fügt `create_document` und
  `update_document` hinzu; `data:delete` ergänzt `delete_document`. Ein Client, der
  keine Scopes anfordert, erhält `data:read`. Jeder Scope lässt sich auf eine Collection eingrenzen: `data:read:posts`
  listet, beschreibt und liest `posts` und nichts anderes. Ein Scope bestimmt, welche Tools
  angeboten werden und welche Collections sie erreichen, nicht welche Zeilen: Eine leere Liste kann
  bedeuten, dass RLS greift, und `data:write` kann weiterhin keine Zeile schreiben, zu der die Person nicht berechtigt ist.
- **Drei Tools bringen Ihr Admin-Panel direkt zur Person.** In einem Client,
  der MCP Apps rendert (wie etwa Claude), öffnen sie die eigenen Ansichten des Admin-Panels in der
  Konversation, basierend auf Ihren Collections: deren Felder, Enums, Validierungen,
  Relationen, Formularabschnitte und Ansichtseinstellungen.
  - `show_collection` nimmt die Argumente von `query_collection` sowie `view`
    (`table`, `list`, `cards` oder `kanban`) entgegen und öffnet die Collection-Ansicht: Die
    Person kann suchen, filtern, sortieren, paginieren, das Formular einer Zeile öffnen und Zeilen hinzufügen.
  - `show_record` öffnet das Formular einer einzelnen Zeile (`id`) oder ein Formular für eine neue Zeile,
    das mit den vom Modell ausgefüllten `values` vorbefüllt ist, damit die Person diese selbst prüfen und
    speichern kann.
  - `show_app` führt eine App aus, die das Modell für die jeweilige Aufgabe schreibt: eine React-Komponente
    (`code`) und die `collections`, die sie liest. Sie importiert die Rebase-eigenen
    Pakete, sodass derselbe Code in Ihrem Projekt funktioniert:
    - `@rebasepro/app`: `useRows`, `useRow`, `useRowCount`, `useAggregate`
      und `useRowWrites` über die Zeilen des Projekts;
    - `@rebasepro/cms`: das `CollectionPanel` des Admin-Panels (mit
      `CollectionToolbar` und dessen Komponenten sowie `onRowClick`, das der
      App die angeklickte Zeile so übergibt, wie `useRows` sie liest), `EntityFormPanel` und `FormField`,
      `EntityViewPanel`, `FieldValue`, `useSidePanel` und
      `useCollectionRegistryController`, mit Ihren benutzerdefinierten Feldern, Ansichten und
      Aktionen;
    - `@rebasepro/ui`, das gesamte UI-Kit, einschließlich `SplitView` sowie KPI-Kacheln und
      Diagrammen.

    Der Server kompiliert die Komponente zuerst. Ein Syntaxfehler, ein Modul, das die Ansicht
    nicht bereitstellt, oder ein Name, der nicht von `@rebasepro/cms` oder
    `@rebasepro/app` bereitgestellt wird, führt direkt zu einem Fehler des Aufrufs mit Angabe der Zeilennummer. Ein Fehler während der
    Laufzeit wird an der entsprechenden Stelle angezeigt und dem Modell mit der nächsten
    Nachricht der Person mitgeteilt. Eine App darf nur die Collections verwenden, die sie auflistet. Ihre Styles sind
    die Standard-Utilities von Tailwind, die zusammen mit der Ansicht erstellt wurden, bevor eine App
    übertragen wird: Ein beliebiger Wert wie `h-[560px]` bewirkt dort nichts; eine
    exakte Größe muss daher als `style` angegeben werden.

  Jeder Lese- und Speichervorgang in der Ansicht entspricht einem Aufruf der Lese- und Schreib-Tools,
  ausgeführt als die jeweilige Person unter deren RLS. Ein Formular bietet daher nur das an,
  was der Verbindung gewährt wurde: Ohne `data:write` ist es schreibgeschützt, und ein Feld,
  das die Rollen der Person nicht lesen dürfen, ist darin nicht enthalten. Auf dem Bildschirm einer App wird eine Änderung,
  die der Code über `useRowWrites` vornimmt, der Person zur Bestätigung vorgelegt, bevor sie
  gesendet wird, da Code ohne Klick schreiben kann; eine Änderung, die die Person über die
  eigenen Steuerelemente des Admins vornimmt (das Speichern eines Formulars, ein Löschvorgang, eine Bearbeitung in der Tabelle), stammt von ihr selbst und
  wird nicht erneut abgefragt. Dem Modell wird mitgeteilt, was geändert wurde. Es liest die von den Tools zurückgegebenen Zeilen, nicht die Collection-Konfigurationen,
  mit denen die Ansicht gerendert wird. Ein Client ohne MCP Apps (wie Claude Code oder Cursor) zeigt nichts an,
  und das Modell liest dieselben Zeilen, die es auch von `query_collection` erhalten würde.
- **Vor Version 0.24 erteilte Berechtigungen behalten ihren Umfang.** `mcp:read` wird als
  `data:read` interpretiert und `mcp:write` als `data:write data:delete`, sowohl bei gespeicherten Berechtigungen
  als auch bei bereits ausgestellten Tokens.
- **Ein API-Key funktioniert ebenfalls.** `/mcp` akzeptiert auch `Authorization: Bearer rk_…` für
  einen Client, der über einen Header statt über einen OAuth-Flow konfiguriert ist. Der Key erreicht
  die Tools, die seine `data:*`-Scopes abdecken, und agiert als die entsprechende Identität: ein
  [persönlicher Key](/docs/backend/api-keys/#personal-keys) als sein Eigentümer, ein Service-Key
  als `api-key:<id>`.
- **Das Vokabular des SDKs, die Antworten von REST.** Die Tools akzeptieren dieselben Parameter wie das SDK –
  `where` (`{"status": ["==", "paid"]}`), `orderBy` (`["created_at", "desc"]` oder
  `"created_at:desc"`), `limit`, `offset`, `searchString` sowie `data` für Schreiboperationen –
  und lesen über den Pfad `GET /api/data/<collection>`, sodass eine Zeile so
  zurückgegeben wird, wie REST sie ausliefert (ISO-Datumsangaben, ein `belongsTo` als Fremdschlüssel, z. B.
  `authorId`), und unverändert in einem Update zurückgesendet werden kann. `query_collection`
  antwortet mit `{ data, meta }` inklusive `meta.total` und `meta.hasMore`, und `count_documents`
  mit `{ count }`. `aggregate_documents` entspricht `GET /api/data/<collection>/aggregate`:
  `select` ist eine Liste in der Syntax von REST (`["count()", "sum(total)"]`), `groupBy`
  eine Liste von Feldern, und die Antwort ist `{ data }` mit einer Zeile pro Gruppe sowie
  `meta.hasMore` bei einem gruppierten Aufruf, dessen Gruppen über `limit` und `offset`
  paginiert und über `orderBy` sortiert werden. Bei einer Collection, die durch einen `afterRead`-Callback umgeschrieben wird,
  liefert es wie REST ausschließlich `count()`. Wie bei REST werden ein `limit` über 1000, ein nicht deklariertes Argument sowie das
  Bearbeiten oder Löschen einer Zeile im Papierkorb (404) abgelehnt; das Setzen des Soft-Delete-Felds
  auf `null` stellt sie wieder her. `deleted: "only"` (oder `"include"`) bei
  `query_collection`, `count_documents` und `aggregate_documents` liest den Papierkorb aus, genau wie `?deleted=`
  in REST, sodass eine von `delete_document` in den Papierkorb verschobene Zeile wiedergefunden und
  wiederhergestellt werden kann. Die Beschreibung weist das Modell darauf hin, dass der Löschvorgang nur dann dauerhaft ist,
  wenn die Collection kein Soft-Delete-Feld besitzt.
- **Die Auflistung nennt die Collections; `describe_collection` liefert das Schema einer Collection.**
  `list_collections` liefert `name`, `title` und `description` jeder Collection zurück,
  und `describe_collection { collection }` die OpenAPI-Schemas `row` und
  `create` dieser Collection sowie `softDeleteField`, sofern Zeilen in einen Papierkorb verschoben werden. Die Tool-Beschreibungen
  weisen das Modell an, eine Collection zu beschreiben, bevor es Schreiboperationen darauf ausführt. Die Auflistung
  eines Projekts mit 200 Collections umfasst etwa 5.000 Tokens, und jede Beschreibung
  unter 1.000 Tokens; wären alle Schemas in der Auflistung enthalten, läge der Umfang bei rund 150.000 Tokens.
- **Ein Token ausschließlich für diesen Endpunkt.** Ein MCP-Access-Token wird von
  `/api/data`, `/api/admin` und dem WebSocket abgelehnt; das Verbinden eines Assistenten
  übergibt diesem also keine Sitzung.

Jede Anfrage an `/mcp` liest das Konto der Person erneut aus. Ein gelöschtes oder deaktiviertes
Konto sowie ein „Überall abmelden“ oder eine Passwortänderung nach Ausstellung des
Tokens stoppen einen verbundenen Client sofort mit einem 401-Fehler. Eine Herabstufung von Berechtigungen wird beim
nächsten Tool-Aufruf wirksam. Jeder Refresh führt dieselben Prüfungen durch und verweigert
eine solche Autorisierung dauerhaft. Eine Gastsitzung kann überhaupt keine Zustimmung erteilen.

Eine Einschränkung: Das Trennen eines Clients (`DELETE /api/oauth/grants/:clientId` mit der
eigenen Sitzung der Person) widerruft dessen Refresh-Tokens sofort, ein bereits
ausgestelltes Access-Token bleibt jedoch bis zu seinem Ablauf innerhalb einer Stunde gültig.

Die Routen finden Sie unter [Endpoints](/docs/backend/endpoints/#mcp-surface) und die
Variablen unter [Configuration](/docs/getting-started/configuration/#mcp-surface).
