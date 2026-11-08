---
sourceHash: 4abdf92eab306b1d
title: Der Remote-MCP-Endpunkt
sidebar_label: Remote-MCP-Endpunkt
description: Stellen Sie MCP von einem bereitgestellten Backend unter /mcp bereit, sodass Personen, die Ihre App nutzen, Claude oder Cursor als sie selbst verbinden können – OAuth mit einem Zustimmungsbildschirm, zwölf Tools unter drei Scopes, jeder Aufruf unter ihrer eigenen Row-Level-Security.
---

:::tip[Claude mit Ihren eigenen Projekten verbinden?]
Dafür gibt es den [Rebase connector](/docs/ai/rebase-connector/): ein Connector für
alle, und ein selbst gehosteter Server verbindet sich über `rebase cloud connect`. Diese
Seite richtet sich an Personen, die Ihre App **nutzen**.
:::

Der [MCP-Server](/docs/ai/mcp/) ist ein Entwickler-Tool: Er läuft auf Ihrem Rechner und enthält einen Service-Key
oder einen API-Key. Ein bereitgestelltes Backend kann MCP auch selbst unter `/mcp` für
Personen bereitstellen, die Ihre Anwendung nutzen. Ein Assistent, den eine dieser Personen verbindet, liest und
schreibt im Projekt **als diese Person**, und jeder Aufruf wird unter deren eigener
Row-Level-Security ausgeführt.

Er ist standardmäßig deaktiviert, und beide Variablen sind erforderlich:

```bash
REBASE_MCP_ENABLED=true
REBASE_PUBLIC_URL=https://app.example.com   # this deployment's real origin
```

Ohne `REBASE_PUBLIC_URL`, ein JWT-Secret oder einen Datentreiber, der eine Abfrage
auf einen Benutzer einschränken kann, verweigert der Endpunkt das Mounten und gibt den Grund im
Boot-Log an. Kein `REBASE_ROLE` schaltet ihn ein.

- **OAuth mit einem Zustimmungsbildschirm.** Ein Client findet den Autorisierungsserver
  über `/.well-known/oauth-protected-resource`, registriert sich selbst (dynamische
  Registrierung ist standardmäßig aktiviert; `REBASE_MCP_OPEN_REGISTRATION=false` beschränkt dies
  auf von Ihnen registrierte Clients) und leitet die Person zu einem Zustimmungsbildschirm weiter, der
  sie über Ihr bestehendes `/auth/login` anmeldet. Ein Konto mit einem zweiten Faktor
  wird anschließend über die bestehenden `/auth/mfa/challenge`-Routen nach seinem
  Authenticator-Code oder einem Wiederherstellungscode gefragt. Wenn das Frontend
  Ihrer eigenen App eine Sitzung im selben Browser hält, bietet der Bildschirm dieses Konto an, und
  „Zulassen“ erteilt die Zustimmung ohne Passwort; auf diese Weise verbindet sich jemand, der sich nur
  mit Google, GitHub oder einem E-Mail-Link anmeldet. Andernfalls erfolgt die Anmeldung mit einem
  Passwort, und jemand ohne Passwort legt zuerst eines über `/auth/forgot-password`
  fest (das „Passwort vergessen“ Ihrer App); der Bildschirm weist darauf hin. Er nennt auch den Host, an den der Autorisierungscode gesendet
  wird, und weist darauf hin, dass dieser Host nicht verifiziert ist: Jeder kann einen Client unter
  beliebigem Namen registrieren, daher ist der Host der Teil, den eine Person überprüfen kann.
- **Zwölf Tools, drei Scopes.** <span class="since-badge" data-since="0.29">Seit 0.29</span> Dieselben [Scopes](/docs/backend/roles-and-scopes/),
  die alle Anmeldeinformationen verwenden. `data:read` bietet `list_collections`, `describe_collection`,
  `query_collection`, `count_documents`, `aggregate_documents`, `get_document` sowie die drei Ansichten
  `show_collection`, `show_record` und `show_app`; `data:write` fügt `create_document` und
  `update_document` hinzu; `data:delete` ergänzt `delete_document`. Ein Client, der nichts anfordert,
  erhält `data:read`. Jeder Scope lässt sich auf eine Collection eingrenzen: `data:read:posts`
  listet, beschreibt und liest `posts` und sonst nichts. Ein Scope bestimmt, welche Tools angeboten
  werden und welche Collections sie erreichen, nicht welche Zeilen: Eine leere Liste kann bedeuten, dass
  RLS greift, und `data:write` kann weiterhin keine Zeile schreiben, zu der die Person nicht berechtigt ist.
- **Drei Tools bringen Ihr Admin-Panel direkt zur Person.** In einem Client, der
  MCP-Apps rendert (wie Claude), öffnen sie die Ansichten des Admin-Panels direkt in der
  Konversation, basierend auf Ihren Collections: deren Felder, Enums, Validierungen,
  Relationen, Formularabschnitte und Ansichtseinstellungen.
  - `show_collection` übernimmt die Argumente von `query_collection`, plus `view`
    (`table`, `list`, `cards` oder `kanban`), und öffnet die Collection-Ansicht: Die
    Person kann suchen, filtern, sortieren, paginieren, das Formular einer Zeile öffnen und Zeilen hinzufügen.
  - `show_record` öffnet das Formular einer einzelnen Zeile (`id`) oder ein Formular für eine neue Zeile, das
    mit den vom Modell ausgefüllten `values` vorbefüllt ist, damit die Person diese selbst prüfen und
    speichern kann.
  - `show_app` führt eine App aus, die das Modell für die jeweilige Aufgabe schreibt: eine React-Komponente
    (`code`) und die `collections`, die sie liest. Sie importiert Rebase-eigene
    Pakete, sodass derselbe Code in Ihrem Projekt funktioniert:
    - `@rebasepro/app`: `useRows`, `useRow`, `useRowCount`, `useAggregate`
      und `useRowWrites` über die Zeilen des Projekts;
    - `@rebasepro/cms`: das `CollectionPanel` des Admin-Panels (mit
      `CollectionToolbar` und dessen Bestandteilen sowie `onRowClick`, das der
      App die angeklickte Zeile so übergibt, wie `useRows` sie liest), `EntityFormPanel` und `FormField`,
      `EntityViewPanel`, `FieldValue`, `useSidePanel` und
      `useCollectionRegistryController`, mit Ihren benutzerdefinierten Feldern, Ansichten und
      Aktionen;
    - `@rebasepro/ui`, das gesamte UI-Kit, inklusive `SplitView`, KPI-Kacheln und
      Diagrammen.

    Der Server kompiliert sie zuerst, sodass ein Syntaxfehler, ein Modul, das die Ansicht
    nicht bereitstellt, oder ein Name, den sie nicht aus `@rebasepro/cms` oder
    `@rebasepro/app` bereitstellt, als Fehler des Aufrufs samt Zeilenangabe zurückgegeben wird. Ein Laufzeitfehler
    wird an entsprechender Stelle angezeigt und dem Modell mit der nächsten
    Nachricht der Person mitgeteilt. Eine App darf nur die von ihr aufgelisteten Collections verwenden. Als Styles
    dienen die Standard-Utilities von Tailwind, die mit der Ansicht vorab gebaut
    wurden: Ein beliebiger Arbitrary Value wie `h-[560px]` bewirkt dort nichts, weshalb eine
    exakte Größe über `style` definiert werden muss.

  Jeder Lese- und Speichervorgang in der Ansicht ist ein Aufruf der Lese- und Schreib-Tools,
  der als die Person unter deren RLS ausgeführt wird. Daher bietet ein Formular nur das an, was für deren
  Verbindung gewährt wurde: Ohne `data:write` ist es schreibgeschützt, und ein Feld,
  das ihre Rollen nicht lesen dürfen, ist nicht enthalten. Das ist auch die Grenze, innerhalb derer der Code
  einer App arbeitet: Er läuft in der Ansicht, sodass jeder von ihm getätigte Aufruf einem
  dieser Tools als diese Person entspricht, und er kann nichts tun, was das Modell mit denselben Tools
  nicht auch tun könnte. Beim gehosteten Connector wird jeder Schreibvorgang zudem vom Server
  geplant und bestätigt. Innerhalb dieses Rahmens fragt `useRowWrites` die Person
  vor dem Schreiben, sodass eine App nicht ohne deren Klick schreibt; die
  bordeigenen Steuerelemente des Admin-Panels (das Speichern eines Formulars, ein Löschvorgang, eine Tabellenbearbeitung) verhalten sich
  genauso wie auf einem `show_collection`-Bildschirm. Dem Modell wird mitgeteilt, was geändert wurde. Es liest die von den Tools zurückgegebenen Zeilen, nicht die Collection-Konfigurationen, mit denen
  die Ansicht gerendert wird. Ein Client ohne MCP-Apps, wie Claude Code oder Cursor, zeigt nichts an,
  und das Modell liest dieselben Zeilen wie bei `query_collection`.
- **Vor Version 0.24 erteilte Berechtigungen behalten ihren Umfang.** `mcp:read` wird bei
  gespeicherten Grants und bereits ausgestellten Tokens als `data:read` interpretiert, und `mcp:write`
  als `data:write data:delete`.
- **Ein API-Key funktioniert ebenfalls.** `/mcp` akzeptiert auch `Authorization: Bearer rk_…` für
  Clients, die über einen Header statt über einen OAuth-Flow konfiguriert sind. Der Key erreicht
  die Tools, die durch seine `data:*`-Scopes abgedeckt sind, handelnd als der jeweilige Akteur: ein
  [persönlicher Key](/docs/backend/api-keys/#personal-keys) als sein Eigentümer, ein Service-Key
  als `api-key:<id>`.
- **Das Vokabular des SDKs, die Antworten von REST.** Die Tools akzeptieren dieselben Parameter wie das SDK –
  `where` (`{"status": ["==", "paid"]}`), `orderBy` (`["created_at", "desc"]` oder
  `"created_at:desc"`), `limit`, `offset`, `searchString` sowie `data` für
  Schreibvorgänge – und lesen über den Pfad von `GET /api/data/<collection>`, sodass eine Zeile so
  zurückgegeben wird, wie REST sie ausliefert (ISO-Datumsangaben, ein `belongsTo` als Fremdschlüssel, z. B.
  `authorId`), und unverändert in einem Update zurückgesendet werden kann. `query_collection`
  antwortet mit `{ data, meta }` samt `meta.total` und `meta.hasMore`, und `count_documents`
  mit `{ count }`. `aggregate_documents` entspricht `GET /api/data/<collection>/aggregate`:
  `select` ist eine Liste in REST-Syntax (`["count()", "sum(total)"]`), `groupBy`
  eine Liste von Feldern, und die Antwort ist `{ data }` mit einer Zeile pro Gruppe sowie
  `meta.hasMore` bei einem gruppierten Aufruf, dessen Gruppen mit `limit` und `offset`
  paginiert und mit `orderBy` sortiert werden. Bei einer Collection, die durch einen `afterRead`-Callback umgeschrieben wird,
  liefert es `count()` allein, genau wie REST. Wie bei REST werden ein `limit` über 1000, ein nicht deklariertes Argument sowie das
  Bearbeiten oder Löschen einer im Papierkorb befindlichen Zeile (404) abgelehnt; das Setzen des Soft-Delete-Feldes
  auf `null` stellt sie wieder her. `deleted: "only"` (oder `"include"`) bei
  `query_collection`, `count_documents` und `aggregate_documents` liest den Papierkorb, genau wie `?deleted=` bei REST,
  sodass eine durch `delete_document` in den Papierkorb verschobene Zeile zum
  Wiederherstellen wiedergefunden werden kann. Die Tool-Beschreibung weist das Modell darauf hin, dass das Löschen nur dann permanent ist,
  wenn die Collection kein Soft-Delete-Feld besitzt.
- **Die Auflistung nennt die Collections; `describe_collection` liefert das jeweilige Schema.**
  `list_collections` antwortet mit `name`, `title` und `description` jeder Collection,
  und `describe_collection { collection }` mit den OpenAPI-Schemas `row` und
  `create` dieser Collection, plus `softDeleteField`, falls Zeilen in einen Papierkorb verschoben werden. Die Tool-Beschreibungen
  weisen das Modell an, eine Collection zu beschreiben, bevor darin geschrieben wird. Die
  Auflistung eines Projekts mit 200 Collections umfasst etwa 5.000 Tokens, jede Beschreibung
  unter 1.000; wären alle Schemas in der Auflistung enthalten, wären es etwa 150.000 gewesen.
- **Ein Token ausschließlich für diesen Endpunkt.** Ein MCP-Access-Token wird von
  `/api/data`, `/api/admin` und dem WebSocket abgelehnt, sodass das Verbinden eines Assistenten diesem keine vollständige Sitzung übergibt.

Jede Anfrage an `/mcp` liest das Konto der Person neu ein. Ein gelöschtes oder deaktiviertes
Konto, ein „Überall abmelden“ oder eine Passwortänderung nach Ausstellung des Tokens stoppt einen
verbundenen Client sofort mit einem 401-Fehler. Eine Herabstufung von Rechten wird beim nächsten
Tool-Aufruf wirksam. Jeder Refresh führt dieselben Prüfungen durch und verweigert eine solche Berechtigung
dauerhaft. Eine Gastsitzung kann überhaupt keine Zustimmung erteilen.

Eine Einschränkung: Das Trennen eines Clients (`DELETE /api/oauth/grants/:clientId` mit der
eigenen Sitzung der Person) widerruft dessen Refresh-Tokens sofort, ein bereits ausgestelltes Access-Token
bleibt jedoch bis zu seinem Ablauf innerhalb einer Stunde gültig.

Die Routen finden Sie unter [Endpunkte](/docs/backend/endpoints/#mcp-surface) und die
Variablen unter [Konfiguration](/docs/getting-started/configuration/#mcp-surface).
