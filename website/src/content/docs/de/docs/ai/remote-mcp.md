---
sourceHash: aa952b8682070ef6
title: Der Remote-MCP-Endpunkt
sidebar_label: Remote-MCP-Endpunkt
description: Stellen Sie MCP von einem bereitgestellten Backend unter /mcp bereit, sodass die Benutzer Ihrer App Claude oder Cursor als sie selbst verbinden können – OAuth mit Zustimmungsbildschirm, zwölf Tools unter drei Scopes, jeder Aufruf unter ihrer eigenen Row-Level-Security.
---

:::tip[Claude mit Ihren eigenen Projekten verbinden?]
Dafür gibt es den [Rebase-Connector](/docs/ai/rebase-connector/): ein Connector für
alle Projekte, und ein selbst gehosteter Server verbindet sich über `rebase cloud connect`. Diese
Seite richtet sich an die Personen, die Ihre App **nutzen**.
:::

Der [MCP-Server](/docs/ai/mcp/) ist ein Entwickler-Tool: Er läuft auf Ihrem Rechner und enthält einen Service-Key
oder einen API-Key. Ein bereitgestelltes Backend kann MCP auch selbst unter `/mcp` bereitstellen, für
die Personen, die Ihre Anwendung nutzen. Ein Assistent, den einer von ihnen verbindet, liest und
schreibt im Projekt **als diese Person**, und jeder Aufruf wird unter deren eigener
Row-Level-Security (RLS) ausgeführt.

Die Funktion ist standardmäßig deaktiviert; beide Variablen sind erforderlich:

```bash
REBASE_MCP_ENABLED=true
REBASE_PUBLIC_URL=https://app.example.com   # this deployment's real origin
```

Ohne `REBASE_PUBLIC_URL`, ein JWT-Secret oder einen Datentreiber, der eine Abfrage
auf einen Benutzer beschränken kann, verweigert der Endpunkt das Laden und gibt den Grund im Boot-Log an. Kein
`REBASE_ROLE` schaltet ihn ein.

- **OAuth mit Zustimmungsbildschirm.** Ein Client ermittelt den Autorisierungsserver
  über `/.well-known/oauth-protected-resource`, registriert sich selbst (dynamische
  Registrierung ist standardmäßig aktiv; `REBASE_MCP_OPEN_REGISTRATION=false` beschränkt sie
  auf von Ihnen registrierte Clients) und leitet die Person zu einem Zustimmungsbildschirm weiter, der
  sie über Ihr bestehendes `/auth/login` anmeldet. Ein Konto mit einem zweiten Faktor
  wird dann über die bestehenden `/auth/mfa/challenge`-Routen nach seinem Authenticator-Code oder einem Wiederherstellungscode
  gefragt. Wenn das eigene Frontend Ihrer App
  eine Sitzung im selben Browser hält, schlägt der Bildschirm dieses Konto vor, und
  „Zulassen“ stimmt als dieses ohne Passwort zu; so verbindet sich jemand, der sich nur
  über Google, GitHub oder einen E-Mail-Link anmeldet. Andernfalls erfolgt die Anmeldung mit einem
  Passwort; wer keines hat, legt zuerst eines über `/auth/forgot-password`
  fest (das „Passwort vergessen“ Ihrer App); der Bildschirm weist darauf hin. Er nennt auch den Host, an den der Autorisierungscode gesendet wird,
  und weist darauf hin, dass dieser Host nicht verifiziert ist: Jeder kann einen Client unter
  beliebigem Namen registrieren, daher ist der Host der Teil, den eine Person überprüfen kann.
- **Zwölf Tools, drei Scopes.** <span class="since-badge" data-since="0.29">Seit 0.29</span> Dieselben [Scopes](/docs/backend/roles-and-scopes/),
  die jede Anmeldeinformation verwendet. `data:read` bietet `list_collections`, `describe_collection`,
  `query_collection`, `count_documents`, `aggregate_documents`, `get_document` und die drei Views
  `show_collection`, `show_record` und `show_app`; `data:write` fügt `create_document` und
  `update_document` hinzu; `data:delete` fügt `delete_document` hinzu. Ein Client, der
  nichts anfordert, erhält `data:read`. Jeder Scope lässt sich auf eine Collection eingrenzen: `data:read:posts`
  listet, beschreibt und liest `posts` und sonst nichts. Ein Scope entscheidet, welche Tools
  angeboten werden und welche Collections sie erreichen, nicht welche Zeilen: Eine leere Liste kann
  auf greifende RLS zurückzuführen sein, und `data:write` kann weiterhin keine Zeile schreiben, die die Person nicht schreiben dürfte.
- **Drei Tools bringen Ihr Admin-Panel direkt zur Person.** In einem Client,
  der MCP-Apps rendert (wie etwa Claude), öffnen sie die panel-eigenen Views im
  Gespräch, generiert aus Ihren Collections: deren Felder, Enums, Validierungen,
  Relationen, Formularabschnitte und View-Einstellungen.
  - `show_collection` nimmt die Argumente von `query_collection` entgegen, plus `view`
    (`table`, `list`, `cards` oder `kanban`), und öffnet die Collection-View: Die
    Person kann suchen, filtern, sortieren und paginieren, das Formular einer Zeile öffnen und Zeilen hinzufügen.
  - `show_record` öffnet das Formular einer Zeile (`id`) oder ein Formular für eine neue Zeile,
    das mit den vom Modell ausgefüllten `values` vorbefüllt ist, damit die Person diese selbst prüfen und
    speichern kann.
  - `show_app` führt eine App aus, die das Modell für die jeweilige Aufgabe schreibt: eine React-Komponente
    (`code`) und die `collections`, die sie liest. Sie importiert Rebase-eigene
    Pakete, sodass derselbe Code auch in Ihrem Projekt funktioniert:
    - `@rebasepro/app`: `useRows`, `useRow`, `useRowCount`, `useAggregate`
      und `useRowWrites` über die Zeilen des Projekts;
    - `@rebasepro/cms`: das `CollectionPanel` des Admin-Panels (mit
      `CollectionToolbar` und deren Komponenten sowie `onRowClick`, das der
      App die angeklickte Zeile so übergibt, wie `useRows` sie liest), `EntityFormPanel` und `FormField`,
      `RecordDetail`, `FieldValue` und `useSidePanel`, jeweils mit Angabe der
      Collection über den Pfad, inklusive Ihrer benutzerdefinierten Felder, Views und Aktionen;
    - `@rebasepro/ui`: das gesamte UI-Kit, einschließlich `SplitView` sowie KPI-Kacheln und
      -Diagrammen.

    Der Server kompiliert den Code vorab, sodass ein Syntaxfehler, ein Modul, das die View
    nicht bereitstellt, oder ein Name, der von `@rebasepro/cms` oder
    `@rebasepro/app` nicht exportiert wird, als Fehler des Aufrufs mit Zeilenangabe gemeldet wird. Ein Fehler während
    der Ausführung wird an entsprechender Stelle angezeigt und dem Modell mit der nächsten
    Nachricht der Person mitgeteilt. Eine App darf nur die Collections verwenden, die sie auflistet. Ihre Stile
    entsprechen den Standard-Utilities von Tailwind, die mit der View gebaut werden, bevor eine App
    übertragen wird: Ein beliebiger Wert wie `h-[560px]` bewirkt dort nichts; eine
    exakte Größe muss daher als `style` angegeben werden.

  Jeder Lese- und Speichervorgang in der View ist ein Aufruf eines der Lese- und Schreib-Tools,
  ausgeführt als die Person unter ihrer RLS. Ein Formular bietet daher nur das an,
  was für deren Verbindung freigegeben wurde: Ohne `data:write` ist es schreibgeschützt, und ein Feld,
  das die Rollen der Person nicht lesen dürfen, wird nicht angezeigt. Das ist dieselbe Grenze, innerhalb derer
  auch der Code einer App arbeitet: Er läuft in der View, sodass jeder Aufruf über eines
  dieser Tools im Namen der Person erfolgt, und er kann nichts tun, was das Modell nicht auch
  mit denselben Tools tun könnte. Auf dem gehosteten Connector wird jeder Schreibvorgang zudem vom Server
  geplant und bestätigt. Innerhalb dessen fragt `useRowWrites` die Person
  vor dem Schreiben um Erlaubnis, sodass eine App nicht ohne deren Klick schreibt; die
  eigenen Steuerelemente des Admins (das Speichern eines Formulars, ein Löschvorgang, eine Tabellenbearbeitung) verhalten sich genauso
  wie auf einem `show_collection`-Bildschirm. Dem Modell wird mitgeteilt, was geändert wurde. Es liest die von jedem Tool zurückgegebenen Zeilen, nicht die Collection-Konfigurationen, mit denen
  die View gezeichnet wird. Ein Client ohne Unterstützung für MCP-Apps, wie z. B. Claude Code oder Cursor, zeigt nichts an,
  und das Modell liest dieselben Zeilen, die es von `query_collection` erhalten würde.
- **Vor 0.24 erteilte Berechtigungen behalten ihren Umfang.** `mcp:read` wird als
  `data:read` interpretiert und `mcp:write` als `data:write data:delete`, sowohl bei gespeicherten Berechtigungen
  als auch bei bereits ausgestellten Tokens.
- **Ein API-Key funktioniert ebenfalls.** `/mcp` akzeptiert auch `Authorization: Bearer rk_…` für
  einen Client, der über einen Header statt über einen OAuth-Flow konfiguriert ist. Der Schlüssel erreicht
  die Tools, die von seinen `data:*`-Scopes abgedeckt werden, in der jeweiligen Rolle: ein
  [persönlicher Schlüssel](/docs/backend/api-keys/#personal-keys) als dessen Eigentümer, ein Service-Key
  als `api-key:<id>`.
- **Das Vokabular des SDKs, die Antworten von REST.** Die Tools akzeptieren dieselben Parameter wie das SDK –
  `where` (`{"status": ["==", "paid"]}`), `orderBy` (`["created_at", "desc"]` oder
  `"created_at:desc"`), `limit`, `offset`, `searchString` und `data` für
  Schreibvorgänge – und lesen über den Pfad von `GET /api/data/<collection>`, sodass eine Zeile
  so zurückgegeben wird, wie REST sie ausliefert (ISO-Datumsangaben, ein `belongsTo` als Fremdschlüssel, z. B.
  `authorId`), und in einem Update unverändert zurückgesendet werden kann. `query_collection`
  antwortet mit `{ data, meta }` inklusive `meta.total` und `meta.hasMore`, und `count_documents`
  mit `{ count }`. `aggregate_documents` entspricht `GET /api/data/<collection>/aggregate`:
  `select` ist eine Liste in der REST-Grammatik (`["count()", "sum(total)"]`), `groupBy`
  eine Liste von Feldern, und die Antwort ist `{ data }` mit einer Zeile pro Gruppe, plus
  `meta.hasMore` bei einem gruppierten Aufruf, dessen Gruppen mit `limit` und `offset` paginiert
  und mit `orderBy` sortiert werden. Bei einer Collection, die durch einen `afterRead`-Callback umgeschrieben wird,
  liefert sie `count()` allein zurück, genau wie REST. Wie bei REST werden ein `limit` über 1000, ein nicht deklariertes Argument sowie das
  Bearbeiten oder Löschen einer im Papierkorb befindlichen Zeile abgelehnt (404); das Setzen des Soft-Delete-Felds
  auf `null` stellt sie wieder her. `deleted: "only"` (oder `"include"`) bei
  `query_collection`, `count_documents` und `aggregate_documents` liest den Papierkorb aus, genau wie `?deleted=`
  in REST, sodass eine durch `delete_document` gelöschte Zeile zur Wiederherstellung wiedergefunden
  werden kann. Die Beschreibung des Tools teilt dem Modell mit, dass das Löschen nur dann permanent ist,
  wenn die Collection kein Soft-Delete-Feld besitzt.
- **Die Auflistung nennt die Collections; `describe_collection` liefert das Schema einer Collection.**
  `list_collections` liefert `name`, `title` und `description` jeder Collection zurück,
  und `describe_collection { collection }` die OpenAPI-Schemas `row` und
  `create` dieser Collection sowie `softDeleteField`, falls Zeilen in einen Papierkorb verschoben werden. Die
  Tool-Beschreibungen weisen das Modell an, eine Collection vor dem Schreiben zu beschreiben. Die
  Auflistung eines Projekts mit 200 Collections umfasst etwa 5.000 Tokens, und jede Beschreibung
  unter 1.000; wären alle Schemas in der Auflistung enthalten, läge der Umfang bei etwa 150.000 Tokens.
- **Ein Token ausschließlich für diesen Endpunkt.** Ein MCP-Access-Token wird von
  `/api/data`, `/api/admin` und dem WebSocket abgelehnt, sodass die Anbindung eines Assistenten
  diesem keine reguläre Sitzung übergibt.

Jede Anfrage an `/mcp` prüft das Konto der Person erneut. Ein gelöschtes oder deaktiviertes
Konto, ein „Überall abmelden“ oder eine Passwortänderung nach Ausstellung des Tokens
sperrt einen verbundenen Client sofort mit einem 401-Fehler. Eine Herabstufung von Berechtigungen greift beim
nächsten Tool-Aufruf. Jeder Refresh führt dieselben Prüfungen durch und verweigert eine solche Autorisierung
dauerhaft. Eine Gastsitzung kann überhaupt keine Zustimmung erteilen.

Eine Einschränkung: Das Trennen eines Clients (`DELETE /api/oauth/grants/:clientId` mit der
eigenen Sitzung der Person) widerruft dessen Refresh-Tokens sofort; ein bereits ausgestelltes
Access-Token bleibt jedoch bis zu seinem Ablauf innerhalb einer Stunde weiterhin gültig.

Die Routen finden Sie unter [Endpunkte](/docs/backend/endpoints/#mcp-surface) und die
Variablen unter [Konfiguration](/docs/getting-started/configuration/#mcp-surface).
