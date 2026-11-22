---
sourceHash: 042c679d9fdfa2aa
title: Studio-Tools
sidebar_label: Studio
description: Rebase Studio bietet Entwickler-Tools für SQL-Abfragen, JavaScript-Scripting, die Verwaltung von RLS-Policies, ein Schema-Diagramm und das Durchsuchen von Storage.
---

## Übersicht

Studio ist die Entwickler-Hälfte des Admin-Panels. Dieselbe Anwendung, die Ihr
Content-Team zum Bearbeiten von Zeilen verwendet, enthält auch eine SQL-Konsole,
ein JavaScript-Scratchpad, einen RLS-Policy-Editor, ein Schema-Diagramm und einen
Storage-Browser – und Studio ist der Modus, der sie freischaltet. Nichts zu
installieren und nichts bereitzustellen: Es ist bereits im Panel vorhanden,
hinter dem Umschalter im Drawer.

Es existiert, weil die Alternative ein zweiter Satz von Anmeldedaten wäre. Das
Bearbeiten einer Tabelle, das Überprüfen, was eine Policy wirklich erlaubt, oder
das Ausführen einer einzelnen Abfrage auf der Produktionsumgebung bedeutet
andernfalls einen Datenbank-Client, eine Kopie der Verbindungszeichenfolge und
einen Audit-Trail, der bei „jemand mit psql“ endet. Studio erledigt all dies als
angemeldeter Administrator über dieselbe Autorisierung, die auch die API verwendet.

## Die zwei Modi

Das Panel verfügt über zwei Modi – `"cms" | "studio"`:

- **CMS** (`"cms"`) – Für Content-Redakteure und Operations-Teams. Zeigt die Tabellen und Datenverwaltung an. Dies ist der Standard.
- **Studio** (`"studio"`) – Für Entwickler. Schaltet die unten aufgeführten Tools frei.

Wechseln Sie zwischen ihnen über den Admin-Modus-Controller oder den Drawer-Umschalter.
Der gewählte Modus wird im `localStorage` unter `rebase-admin-mode` gespeichert; ein
Browser, der das Panel vor Version 0.17.0 verwendet hat, enthält den alten Wert
`"content"` und wird beim Lesen zu `"cms"` migriert.

## Integrierte Studio-Tools

Das Schema einer Tabelle ist Code: `defineTable` in `backend/schema` oder – für
ein Projekt, das keines deklariert – das, was die Datenbank enthält, geändert über
SQL oder eine Migration. Studio verfügt über keinen visuellen Tabelleneditor; das
Collections-Tool, das einst einer war, wurde entfernt, da die Spalten einer
Tabelle und deren Panel-Darstellung entkoppelt wurden und ein einziges Formular,
das beides bearbeitet, zu keinem von beiden mehr passte. Der RLS-Editor speichert
Policies in der Entwicklung weiterhin in `backend/schema`, über denselben
Plan → Bestätigen → Anwenden-Schritt wie beim
[Live-Schema-Editing](/docs/backend/live-schema-editing/).

### Integrierte Tools

Jedes Tool, das das Schema kennt, liest die vom Server bereitgestellten Tabellen
über `GET /api/schema/tables` aus, unabhängig davon, ob das CMS auf der Seite
vorhanden ist oder nicht – Studio funktioniert also auch als Konsole eines
Backends ohne Admin-Panel. Bei einer Runtime, die älter als 0.31 ist und über
keine solche Route verfügt, weisen die schema-fähigen Tools darauf hin, dass ein
Upgrade der Runtime erforderlich ist, anstatt Vermutungen anzustellen; bei einem
Backend ohne Authentifizierung oder bei Fehlschlagen der Anfrage gibt jedes Tool
den entsprechenden Grund an. Die SQL-Konsole, Logs, Storage und die anderen Tools,
die das Schema nicht lesen, funktionieren unabhängig davon.

Diese werden mit Studio mitgeliefert und werden von **`RebaseStudio` per Lazy Loading
geladen** – jedes ist ein separater Chunk, der beim ersten Öffnen abgerufen wird.
Sie können nicht einzeln importiert werden: `@rebasepro/studio` exportiert ganz bewusst
nur den Orchestrator, sodass eine Konsole, die Sie nie öffnen, keine Ressourcen kostet.

| Tab | Slug | Gruppe | Funktion |
|-----|------|-------|--------------|
| Tabellen | `tables` | Datenbank | Erstellen und Ändern von PostgreSQL-Tabellen, Spalten, Indizes und Tabellen-Metadaten (`rebase.table_meta`), direktes Bearbeiten von Zeilen und Freigeben von Tabellen über REST, Realtime, OpenAPI und MCP ohne jeglichen Code |
| SQL-Konsole | `sql` | Datenbank | Führen Sie reines SQL auf Ihrer PostgreSQL-Datenbank aus und lesen Sie die Ergebnisse in einer Tabelle. Die Tabelle zeigt das Ergebnis der letzten Anweisung an, bis zu den ersten 10.000 Zeilen oder 32 MB an Werten; ein umfangreicheres Ergebnis gibt an, wie viele Zeilen vorhanden waren, und Kopieren sowie Exportieren umfassen nur die angezeigten Zeilen. Ein solches Ergebnis bietet zudem **Download full result as CSV**: Der Server streamt das gesamte Ergebnis über einen schreibgeschützten Cursor (`POST /api/admin/sql/csv`), eine Abfrage nach der anderen, auf einem eigenen Postgres-Server anstelle der In-Process-Entwicklungsdatenbank. Die Werte entsprechen dem Text der Datenbank, wie psql sie anzeigt, und **Export JSON** schreibt sie so; **Export typed JSON** schreibt jeden gelesenen Wert gemäß dem Typ seiner Spalte – Ganzzahlen und numerische Werte, die eine JSON-Zahl exakt abbilden kann, Booleans, `json`/`jsonb` als JSON – und behält alle anderen Werte als Text bei. In jeder CSV (Export, Kopieren und vollständiger Download) wird ein Wert, den ein Tabellenkalkulationsprogramm als Formel interpretieren würde (ein Wert, der mit `=`, `+`, `-`, `@`, einem Tabulator oder einem Wagenrücklauf beginnt, außer einer Zahl mit Vorzeichen), mit einem führenden `'` geschrieben, so wie es auch beim Collection-Export geschieht. Während eine Ausführung läuft, gibt **Cancel run** die Konsole sofort wieder frei; ein Server, der den `CANCEL_SQL`-Frame des Sockets akzeptiert (er listet `cancel_sql` im `hello` auf, mit dem er dem Socket antwortet), stoppt die Anweisung zusätzlich mit `pg_cancel_backend`. Die In-Process-Entwicklungsdatenbank kann nicht unterbrochen werden, und ein älterer Server wird angewiesen, die Anweisung innerhalb seines `statement_timeout` zu beenden |
| RLS-Policies | `rls` | Datenbank | Prüfen und verwalten Sie Row-Level-Security-Policies für Ihre Tabellen. Die deklarierte Seite entspricht dem, was der Server aus dem `rls` jeder Tabelle kompiliert hat (bereitgestellt für Aufrufer mit `schema:read`), verglichen mit `pg_policies` auf die Weise, wie `rebase doctor` Abweichungen beurteilt: Eine Policy wird so aufgelistet, wie die Datenbank sie enthält, gekennzeichnet mit dem Badge **Differs from code**, wenn dies nicht dem entspricht, was das Projekt deklariert. Eine deklarierte Regel, die in der Datenbank fehlt, wird als nicht angewendet aufgeführt. Eine von Rebase generierte Policy kann nicht direkt in der Datenbank bearbeitet werden, und bei einer von Rebase verwalteten Tabelle weist ein Banner darauf hin, dass jeder Serverstart und jeder `rebase db push` die deklarierten Policies erneut anwendet. Ein Aufrufer ohne `schema:read` sieht den aktuellen Stand der Datenbank und erfährt, warum die Deklaration nicht angezeigt wird |
| Schema-Visualizer | `schema-visualizer` | Datenbank | Entity-Diagramm Ihrer Tabellen und deren Beziehungen, gezeichnet aus den bereitgestellten Deskriptoren: SQL-Namen, Postgres-Typen, Nullable-Eigenschaften, Schlüssel, Enum-Werte, Fremdschlüssel und Verknüpfungen entsprechen den Deklarationen der Tabellen. Lediglich die RLS-Markierungen werden aus der Datenbank gelesen. Das Layout läuft in einem Web Worker, sodass die Seite reaktionsfähig bleibt, während ein großes Diagramm angeordnet wird. Ein Schema mit mehr als 300 Tabellen wird jeweils für die Nachbarschaft einer einzelnen Tabelle gezeichnet – die Tabellen, die ein oder zwei Relationen entfernt sind –, beginnend mit der Tabelle mit den meisten Verbindungen; wählen Sie eine andere Tabelle in der Liste aus, um zu wechseln |
| Branches | `branches` | Datenbank | Erstellen und verwalten Sie [Datenbank-Branches](/docs/backend/branching) und überprüfen Sie diese wie einen Pull Request: Schema- und RLS-Policy-Änderungen nebeneinander, die eingefügten, aktualisierten und gelöschten Zeilen sowie ein Merge in die Ursprungsdatenbank, der festlegt, was Vorrang hat – siehe [Überprüfen und Zusammenführen eines Branches](/docs/backend/branching/#reviewing-and-merging-a-branch) |
| Backups | `backups` | Datenbank | Durchsuchen und Herunterladen von Datenbank-Backups |
| Logs-Explorer | `logs` | Datenbank | Live-Request-Log sowie alles, was der Server mit 'warn' oder 'error' meldet – siehe unten |
| JS-Konsole | `js` | Compute | Schreiben und Ausführen von JavaScript über das Rebase SDK. Ein Skript erhält `context.tables`, die bereitgestellten Deskriptoren (zuvor `context.collections`), und greift als `client.data.<slug>` oder `client.data.table("<slug>")` auf eine Tabelle zu |
| Cron-Jobs | `cron` | Compute | Überprüfen und verwalten Sie [geplante Aufgaben](/docs/backend/cron-jobs), einschließlich Zero-Code-SQL- und HTTP-Cron-Jobs |
| Storage | `storage` | Storage | Durchsuchen, Hochladen und Verwalten von Dateien über Ihre Storage-Backends hinweg und Konfigurieren deklarativer Storage-Zugriffsrichtlinien |
| API-Explorer | `api` | API | Interaktive API-Dokumentation mit einem Request-Runner |
| Webhooks | `webhooks` | API | Konfigurieren und Testen von Datenbank-Webhooks, die beim Einfügen, Aktualisieren und Löschen von Zeilen ausgelöst werden |
| Benutzer & Rollen | `users` | Zugriffskontrolle | Verwalten von Benutzerkonten, Rollenzuweisungen und Zero-Code-RBAC-Rollenscopes |
| API-Schlüssel | `api-keys` | Zugriffskontrolle | Erstellen und Verwalten berechtigungsbeschränkter Service-API-Schlüssel; Ziele eines `data:*`-Scopes sind die bereitgestellten Tabellen |

### Was der Logs-Explorer anzeigt

Zwei Streams in einem ringförmigen In-Memory-Puffer (Ringpuffer), der im Serverprozess gehalten wird:

- **Jede Anfrage** – Methode, Pfad, Status, Dauer, die `X-Request-ID`, die
  Tabelle (sofern sich die Anfrage auf eine bezog) und bei fehlgeschlagenen Anfragen
  der Fehler-`code` sowie die Nachricht, die der Client erhalten hat. Eine
  fehlgeschlagene Anfrage wird als `warn` (4xx) oder `error` (5xx) erfasst,
  sodass der Level-Filter sie findet.
  Die `source` stammt aus dem Pfad: `/api/auth/*` und `/api/oauth/*` sind
  `auth`, `/api/storage/*` ist `storage`, und alles andere ist `api`, sodass der
  Source-Filter Anmeldungen unter Auth und Uploads unter Storage findet.
- **Alles, was der Server unter warn oder error meldet** – eine Schema-Warnung,
  eine Auth-Verweigerung, eine Treiberdiagnose, ein Startfehler. Die `source`
  stammt aus dem eigenen Präfix der Nachricht (`[API]`, `[Auth]`, `[storage]`,
  `[realtime]`), und alles Unbekannte ist `system`.

Routinemäßige `info`-Meldungen werden bewusst weggelassen. Der Ringpuffer fasst
10.000 Einträge, und eine Flut von `200`ern würde genau das verdrängen,
weswegen Sie das Panel geöffnet haben.

Eine benutzerdefinierte Funktion, die einen Fehler wirft, zeigt ihre eigene
Nachricht daher hier an, zugeordnet zu der Anfrage, die sie aufgerufen hat –
genau der Anwendungsfall, für den dies gedacht ist.

Der Ringpuffer existiert pro Prozess und pro Systemstart: Er ist nicht persistent,
wird nicht zwischen Replikaten geteilt und ein Neustart leert ihn. Für alles,
was Sie dauerhaft aufbewahren müssen, lesen Sie das stdout des Prozesses aus, das
dieselben Zeilen und mehr enthält.

Der Explorer weist darauf hin. Er zeigt das Log der einzelnen Serverinstanz an,
die ihn bedient, und benennt diese Instanz: Das `snapshot`-Event von
`GET /api/admin/logs/stream` enthält `instance`, den `HOSTNAME` des Prozesses
(den Pod-Namen auf Kubernetes, die Container-ID unter Docker) oder andernfalls
`pid-<n>`. Es gibt keine Ansicht über Replikate hinweg und auch nicht über die
`functions`- und `worker`-Prozesse eines
[Split Deployments](/docs/deployment/split-processes/). Ein Reconnect, der auf
einer anderen Instanz landet, ersetzt den Inhalt des Fensters, anstatt die beiden
Logs zu vermischen.

## Studio aktivieren

Eine Komponente, an beliebiger Stelle innerhalb von `<Rebase>`. Sie rendert nichts –
sie registriert die Tools, und `<RebaseShell>` stellt sie dar:

```tsx
import { RebaseStudio } from "@rebasepro/studio";

export function App() {
    return (
        <Rebase client={client} authController={authController}>
            <RebaseCMS tableCustomizations={tableCustomizations}/>
            <RebaseStudio/>
            <RebaseShell title="My App"/>
        </Rebase>
    );
}
```

Die Tools erscheinen im Drawer, solange der Studio-Modus aktiv ist. Wenn Sie
`<RebaseStudio>` komplett weglassen, liefern Sie ein reines Content-CMS aus:
kein Studio-Modus, kein Umschalter, kein Lazy Loading.

## Eigene Tools hinzufügen

`devViews` platziert Ihre eigenen Views neben den integrierten. Es handelt sich um
ganz normale [`AppView`](/docs/frontend#custom-views)s – das Einzige, was eine View
zu einem Studio-Tool anstelle einer CMS-View macht, ist die Komponente, bei der
sie registriert wird:

```tsx
import type { AppView } from "@rebasepro/cms-types";

const queues: AppView = {
    slug: "queues",
    name: "Queues",
    group: "Compute",
    icon: "ListOrdered",
    description: "Depth and failures, per queue",
    view: <QueuesView/>
};

<RebaseStudio devViews={[queues]}/>
```

| Registriert bei | Erscheint in | Verwendungszweck |
|---|---|---|
| `<RebaseCMS views>` | Content-Modus | Dinge, die Personen nutzen, die Inhalte bearbeiten |
| `<RebaseStudio devViews>` | Studio-Modus | Dinge, die Sie für den Betrieb des Backends verwenden |

Eine View gehört genau in eine davon – der Drawer sortiert danach, wer sie
registriert hat; wird ein Slug in beiden aufgeführt, wird er im Content-Modus
ausgeblendet.

Wie `tools` wird die Liste anhand ihres *Inhalts* ausgewertet: Sie inline zu
schreiben ist sicher, und ein Re-Render des Hosts führt nicht dazu, dass das
aktuell angezeigte Tool neu gemountet wird. Das Umbenennen einer View oder das
Ändern ihrer Gruppe führt jedoch zu einer erneuten Registrierung.

### Auswählen, welche Tools angezeigt werden

Lassen Sie `tools` weg, werden alle oben genannten Tools registriert. Übergeben
Sie die Eigenschaft, um eine Untermenge zu registrieren – eine gehostete Konsole,
die beispielsweise über einen eigenen Storage-Browser verfügt, kann diesen
weglassen:

```tsx
<RebaseStudio tools={["sql", "rls", "schema-visualizer", "api"]} />
```

`"schema"`, das Collections-Tool, wird nicht mehr akzeptiert: Das Tool wurde
entfernt.

Die Liste wird nach ihrem *Inhalt* und nicht nach Identität ausgewertet, daher ist
es sicher, sie inline zu schreiben: Ein Re-Render des Hosts führt nicht dazu, dass
das aktuell angezeigte Tool abgebaut und neu gemountet wird.

## Nächste Schritte

- **[Plugins](/docs/plugins)** – Erweitern Sie das Framework mit Plugins
- **[Tabellen](/docs/schema/)** – Deklarieren der Tabellen, die Studio liest
- **[Anpassen einer Tabelle](/docs/frontend/customize-table/)** – Wie das Panel sie darstellt
