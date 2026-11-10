---
sourceHash: 31c288c62ca55c7e
title: Der Remote-MCP-Endpunkt
sidebar_label: Remote-MCP-Endpunkt
description: Stellen Sie MCP über ein deploytes Backend unter /mcp bereit, sodass die Nutzer Ihrer App Claude oder Cursor als sie selbst verbinden können – OAuth mit einem Zustimmungsbildschirm, siebzehn Tools unter drei Scopes, jeder Aufruf unter ihrer eigenen Row-Level-Security.
---

:::tip[Möchten Sie Claude mit Ihren eigenen Projekten verbinden?]
Dafür gibt es den [Rebase-Connector](/docs/ai/rebase-connector/): ein Connector für
alle Projekte, und ein selbst gehosteter Server verbindet sich mit `rebase cloud connect`. Diese
Seite richtet sich an die Personen, die Ihre App **nutzen**.
:::

Der [MCP-Server](/docs/ai/mcp/) ist ein Entwicklertool: Er läuft auf Ihrem Rechner und enthält einen Service-Key
oder einen API-Key. Ein deploytes Backend kann MCP unter `/mcp` auch selbst bereitstellen,
für die Personen, die Ihre Anwendung nutzen. Ein Assistent, den einer von ihnen verbindet, liest und
schreibt im Projekt **als diese Person**, und jeder Aufruf wird unter deren eigener
Row-Level-Security ausgeführt.

Es ist standardmäßig deaktiviert, und beide Variablen sind erforderlich:

```bash
REBASE_MCP_ENABLED=true
REBASE_PUBLIC_URL=https://app.example.com   # this deployment's real origin
```

Ohne `REBASE_PUBLIC_URL`, ein JWT-Secret oder einen Datentreiber, der eine Abfrage
auf einen einzelnen Benutzer einschränken kann, verweigert der Endpunkt das Einbinden und nennt die Begründung im Boot-Log. Keine
`REBASE_ROLE` aktiviert ihn.

- **OAuth mit einem Zustimmungsbildschirm.** Ein Client findet den Autorisierungsserver
  über `/.well-known/oauth-protected-resource`, registriert sich selbst (dynamische
  Registrierung ist standardmäßig aktiv; `REBASE_MCP_OPEN_REGISTRATION=false` beschränkt sie
  auf Clients, die Sie registrieren) und leitet die Person zu einem Zustimmungsbildschirm weiter, der sie
  über Ihr bestehendes `/auth/login` anmeldet. Ein Konto mit einem zweiten Faktor
  wird anschließend über die bestehenden `/auth/mfa/challenge`-Routen nach seinem Authenticator-Code oder einem Wiederherstellungscode
  gefragt. Wenn das Frontend Ihrer eigenen App
  eine Sitzung im selben Browser hält, bietet der Bildschirm dieses Konto an, und
  „Zulassen“ erteilt die Zustimmung ohne Passwort; so verbindet sich jemand, der sich nur
  mit Google, GitHub oder einem E-Mail-Link anmeldet. Andernfalls erfolgt die Anmeldung mit einem
  Passwort, und Personen ohne Passwort richten zuerst über `/auth/forgot-password`
  eines ein („Passwort vergessen“ Ihrer App); der Bildschirm weist sie darauf hin. Er nennt auch den Host, an den der Autorisierungscode gesendet
  wird, und weist darauf hin, dass dieser Host nicht verifiziert ist: Jeder kann einen Client unter
  einem beliebigen Namen registrieren, daher ist der Host der Teil, den eine Person überprüfen kann.
- **Siebzehn Tools, drei Scopes.** Dieselben [Scopes](/docs/backend/roles-and-scopes/),
  die alle Zugangsdaten verwenden. `data:read` bietet `list_collections`, `describe_collection`,
  `query_collection`, `count_documents`, `aggregate_documents`, `get_document`, die drei Ansichten,
  `show_collection`, `show_record` und `show_app`, `show_app_guide` sowie die experimentellen
  `list_apps` und `open_app`; `data:write` fügt `create_document`, `update_document` und die
  experimentellen `save_app` und `delete_app` hinzu; `data:delete` fügt `delete_document` hinzu. Ein Client, der
  nichts anfordert, erhält `data:read`. Jeder Scope lässt sich auf eine Collection eingrenzen: `data:read:posts`
  listet, beschreibt und liest `posts` und sonst nichts. Ein Scope entscheidet, welche Tools
  angeboten werden und welche Collections sie erreichen, nicht welche Zeilen: Eine leere Liste kann bedeuten,
  dass RLS greift, und `data:write` kann weiterhin keine Zeile schreiben, zu der die Person keine Berechtigung hat.
- **Drei Tools bringen Ihr Admin-Panel direkt zur Person.** In einem Client,
  der MCP Apps rendert (wie etwa Claude), öffnen sie die Ansichten des Admin-Panels direkt in der
  Konversation, basierend auf Ihren Collections: deren Feldern, Enums, Validierungen,
  Relationen, Formularabschnitten und Ansichtseinstellungen.
  - `show_collection` akzeptiert die Argumente von `query_collection` sowie `view`
    (`table`, `list`, `cards` oder `kanban`) und öffnet die Collection-Ansicht: Die
    Person kann suchen, filtern, sortieren und paginieren, das Formular einer Zeile öffnen und Zeilen hinzufügen.
  - `show_record` öffnet das Formular einer Zeile (`id`) oder ein Formular für eine neue Zeile,
    das mit den vom Modell ausgefüllten `values` vorausgefüllt ist, damit die Person es selbst prüfen und
    speichern kann.
  - `show_app` führt eine App aus, die das Modell für die jeweilige Aufgabe schreibt: eine React-Komponente
    (`code`) und die `collections`, die sie liest. Sie importiert die Rebase-eigenen
    Pakete, sodass derselbe Code in Ihrem Projekt funktioniert:
    - `@rebasepro/app`: `useRows`, `useRow`, `useRowCount`, `useAggregate`
      und `useRowWrites` über die Zeilen des Projekts;
    - `@rebasepro/cms`: das `CollectionPanel` des Admin-Panels (mit
      `CollectionToolbar` und dessen Komponenten sowie `onRowClick`, das der
      App die angeklickte Zeile so übergibt, wie `useRows` sie liest), `RecordForm` und `FormField`,
      `RecordDetail`, `FieldValue` und `useSidePanel`, wobei jede Komponente ihre
      Collection über den Pfad benennt, mit Ihren benutzerdefinierten Feldern, Ansichten und Aktionen;
    - `@rebasepro/ui`: das gesamte UI-Kit, einschließlich `SplitView` sowie KPI-Kacheln und
      Diagrammen.

    Der Server kompiliert den Code zuerst; ein Syntaxfehler, ein Modul, das die Ansicht
    nicht bereitstellt, oder ein Name, den sie aus `@rebasepro/cms` oder
    `@rebasepro/app` nicht anbietet, führt zu einem Fehler beim Aufruf samt Zeilenangabe. Ein Fehler während der
    Ausführung wird an entsprechender Stelle angezeigt und dem Modell mit der nächsten Nachricht der Person
    mitgeteilt. Eine App darf nur die Collections verwenden, die sie auflistet. Für Styles
    werden die Standard-Utilities von Tailwind verwendet, die vor dem Laden der App mit der
    Ansicht gebaut werden: Ein willkürlicher Wert wie `h-[560px]` hat dort keine Wirkung,
    daher wird eine exakte Größe über `style` definiert.

    Die Beschreibung von `show_app` enthält nur das Wesentliche, weil ein Client
    eine lange Tool-Beschreibung abschneiden kann (claude.ai tut das bei etwa
    4.000 Zeichen). Sie weist das Modell an, zuerst `show_app_guide` aufzurufen;
    das liefert jeden Hook, jede Komponente und jede Prop, die eine App
    verwenden darf, samt einem durchgespielten Beispiel. `show_app_guide` wird
    überall angeboten, wo `show_app` angeboten wird.

  Jeder Lese- und Speichervorgang in der Ansicht ist ein Aufruf der Lese- und Schreib-Tools,
  ausgeführt als die Person unter ihrer RLS. Ein Formular bietet daher nur das, was für deren
  Verbindung autorisiert wurde: Ohne `data:write` ist es schreibgeschützt, und ein Feld,
  das ihre Rollen nicht lesen dürfen, ist darin nicht enthalten. Das ist auch die Grenze, innerhalb
  derer der Code einer App operiert: Er läuft in der Ansicht, sodass jeder Aufruf, den er tätigt, eines
  dieser Tools als die Person ausführt – er kann nichts tun, was das Modell nicht auch mit denselben
  Tools tun könnte. Auf dem gehosteten Connector wird jeder Schreibvorgang zudem vom Server geplant
  und bestätigt. Innerhalb dieses Rahmens fragt `useRowWrites` die Person vor dem Schreiben um Erlaubnis,
  sodass eine App nicht ohne deren Klick schreibt; die
  eigenen Steuerelemente des Admins (das Speichern eines Formulars, ein Löschvorgang, eine Tabellenbearbeitung) verhalten sich so,
  wie sie es auf einem `show_collection`-Bildschirm tun. Dem Modell wird mitgeteilt, was geändert wurde. Es liest die Zeilen, die jedes Tool zurückgibt, nicht die Collection-Konfigurationen, mit denen
  die Ansicht gerendert wird. Ein Client ohne MCP Apps (wie Claude Code oder Cursor) zeigt nichts an,
  und das Modell liest dieselben Zeilen, die es über `query_collection` erhalten würde.
- **Experimentell: im Projekt gespeicherte Apps.** <span class="since-badge" data-since="0.30">Since 0.30</span> `save_app` bewahrt eine App, die das
  Modell mit `show_app` gebaut hat, damit sie sich erneut öffnen lässt: Es kompiliert den Code wie
  `show_app` und speichert ihn mit `title`, `collections` und `visibility`, also `personal` (ihr
  Eigentümer, der Standard), `roles` (wer eine ihrer `roles` hat) oder `team` (alle, die sich
  anmelden). Für mehr als sich selbst zu speichern erfordert die Admin-Rolle, denn eine geteilte App
  ist Code, den eine KI geschrieben hat und der für andere Menschen läuft. Nur ihr Eigentümer oder
  ein Admin ersetzt (`id`) oder löscht eine App, und eine Person behält höchstens 200. `list_apps`
  listet die Apps, die der Aufrufer öffnen darf, `open_app` öffnet eine, wie es `show_app` täte, und
  `delete_app` entfernt eine. Eine App zu sehen heißt nicht, ihre Daten zu erreichen: Eine geöffnete
  App liest und schreibt über die obigen Tools, als die Person, die sie öffnet, unter deren RLS. Die
  Apps liegen in `rebase.saved_apps`, das das Backend beim ersten Gebrauch durch ein Tool anlegt und
  keinem Endnutzer gewährt.
  Das Admin-Panel öffnet dieselben Apps: Fügen Sie `savedAppsView` aus `@rebasepro/cms` zu Ihren
  `views` hinzu. Es führt eine App in einem iframe aus, das ohne `allow-same-origin` und ohne eigenes
  Netzwerk sandboxed ist, und leitet ihre Tool-Aufrufe an `POST /api/admin/apps/mcp` weiter,
  dieselben Tools für die Sitzung des Admin-Panels, das mit den Admin-Routen eingebunden wird, ob
  `REBASE_MCP_ENABLED` gesetzt ist oder nicht. Namen und Formen der Tools können sich noch ändern.
- **Vor 0.24 erteilte Berechtigungen behalten ihren Umfang.** `mcp:read` wird als
  `data:read` interpretiert, und `mcp:write` als `data:write data:delete` – sowohl bei gespeicherten Berechtigungen
  als auch bei bereits ausgestellten Tokens.
- **Ein API-Key funktioniert ebenfalls.** `/mcp` akzeptiert auch `Authorization: Bearer rk_…` für
  einen Client, der über einen Header statt über einen OAuth-Flow konfiguriert ist. Der Key erreicht
  die Tools, die durch seine `data:*`-Scopes abgedeckt sind, in der jeweiligen Rolle: ein
  [persönlicher Key](/docs/backend/api-keys/#personal-keys) als sein Eigentümer, ein Service-Key
  als `api-key:<id>`.
- **Das Vokabular des SDKs, die Antworten von REST.** Die Tools akzeptieren dieselben Parameter wie das SDK –
  `where` (`{"status": ["==", "paid"]}`), `orderBy` (`["created_at", "desc"]` oder
  `"created_at:desc"`), `limit`, `offset`, `searchString` sowie `data` für Schreibvorgänge
  – und lesen über den Pfad `GET /api/data/<collection>`, sodass eine Zeile so zurückgegeben
  wird, wie REST sie liefert (ISO-Datumsangaben, ein `belongsTo` als Fremdschlüssel, z. B.
  `authorId`), und in einem Update unverändert zurückgesendet werden kann. `query_collection`
  antwortet mit `{ data, meta }` inklusive `meta.total` und `meta.hasMore`, und `count_documents` mit
  `{ count }`; `tools/list` gibt beiden, `aggregate_documents` und `get_document`
  ein `outputSchema`, locker, wo eine Antwort variiert. `aggregate_documents` entspricht `GET /api/data/<collection>/aggregate`:
  `select` ist eine Liste in der REST-Grammatik (`["count()", "sum(total)"]`), `groupBy`
  eine Liste von Feldern, und die Antwort ist `{ data }` mit einer Zeile pro Gruppe, plus
  `meta.hasMore` bei einem gruppierten Aufruf, dessen Gruppen mit `limit` und `offset` paginiert
  und mit `orderBy` sortiert werden. Bei einer Collection, die durch einen `afterRead`-Callback umgeschrieben wird,
  liefert es nur `count()`, genau wie REST. Wie bei REST werden ein `limit` über 1000, ein nicht deklariertes Argument sowie das
  Bearbeiten oder Löschen einer im Papierkorb befindlichen Zeile (404) abgelehnt; das Setzen des Soft-Delete-Feldes
  auf `null` stellt sie wieder her. `deleted: "only"` (oder `"include"`) bei
  `query_collection`, `count_documents` und `aggregate_documents` liest den Papierkorb aus, wie es auch RESTs
  `?deleted=` tut, sodass eine durch `delete_document` in den Papierkorb verschobene Zeile zum
  Wiederherstellen wiedergefunden werden kann. Die Beschreibung weist das Modell darauf hin, dass der Löschvorgang nur dann dauerhaft ist,
  wenn die Collection kein Soft-Delete-Feld hat.
- **Die Auflistung nennt die Collections; `describe_collection` liefert das Schema einer Collection.**
  `list_collections` gibt für jede Collection `name`, `title` und `description` zurück,
  und `describe_collection { collection }` liefert die OpenAPI-Schemas `row` und
  `create` dieser Collection sowie `softDeleteField`, falls Zeilen in einen Papierkorb verschoben werden. Die
  Tool-Beschreibungen weisen das Modell an, eine Collection vor dem Schreiben zu beschreiben. Die
  Auflistung eines Projekts mit 200 Collections umfasst etwa 5k Tokens, und jede Beschreibung
  unter 1k; wären alle Schemas in der Auflistung enthalten, wären es etwa 150k.
- **Ein Token ausschließlich für diesen Endpunkt.** Ein MCP-Access-Token wird von
  `/api/data`, `/api/admin` und dem WebSocket abgelehnt, sodass das Verbinden eines Assistenten diesem
  keine reguläre Sitzung übergibt.

Jede Anfrage an `/mcp` liest das Konto der Person erneut ein. Ein gelöschtes oder deaktiviertes
Konto oder ein „Überall abmelden“ bzw. eine Passwortänderung nach Ausstellung des
Tokens stoppt einen verbundenen Client sofort mit einem 401. Eine Herabstufung von Berechtigungen greift ab dem
nächsten Tool-Aufruf. Jeder Refresh führt dieselben Prüfungen durch und verweigert eine solche Autorisierung
dauerhaft. Eine Gastsitzung kann überhaupt keine Zustimmung erteilen.

Eine Einschränkung: Das Trennen eines Clients (`DELETE /api/oauth/grants/:clientId` mit der
eigenen Sitzung der Person) widerruft dessen Refresh-Tokens sofort, ein bereits ausgestelltes
Access-Token bleibt jedoch bis zu seinem Ablauf (innerhalb einer Stunde) gültig.

Die Routen finden Sie unter [Endpunkte](/docs/backend/endpoints/#mcp-surface) und die
Variablen unter [Konfiguration](/docs/getting-started/configuration/#mcp-surface).
