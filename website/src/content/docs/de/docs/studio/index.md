---
sourceHash: f1cd90a07e447c9a
title: Studio-Werkzeuge
sidebar_label: Studio
description: Rebase Studio bietet Entwicklerwerkzeuge für SQL-Abfragen, JavaScript-Scripting, RLS-Policy-Management, ein Schema-Diagramm und einen Storage-Browser.
---

## Übersicht

Studio ist der Entwicklerteil des Admin-Panels. Dieselbe Anwendung, die Ihr
Content-Team zum Bearbeiten von Zeilen verwendet, enthält auch eine SQL-Konsole, ein
JavaScript-Scratchpad, einen RLS-Policy-Editor, ein Schema-Diagramm und einen
Storage-Browser – und Studio ist der Modus, der sie freischaltet. Nichts zu
installieren und nichts zu deployen: Es ist bereits im Panel vorhanden, hinter
dem Umschalter in der Drawer-Seitenleiste.

Es existiert, weil die Alternative ein zweiter Satz von Anmeldedaten wäre. Das
Bearbeiten einer Tabelle, das Überprüfen dessen, was eine Policy wirklich erlaubt,
oder das Ausführen einer einzelnen Abfrage auf der Produktionsumgebung bedeutet
andernfalls einen Datenbank-Client, eine Kopie des Connection-Strings und einen
Audit-Trail, der bei „jemand mit psql“ endet. Studio erledigt all das als der
angemeldete Administrator über dieselbe Autorisierung, die auch die API nutzt.

## Die zwei Modi

Das Panel verfügt über zwei Modi – `"cms" | "studio"`:

- **CMS** (`"cms"`) – Für Content-Redakteure und Operations-Teams. Zeigt die Tabellen und die Datenverwaltung an. Dies ist der Standard.
- **Studio** (`"studio"`) – Für Entwickler. Schaltet die unten aufgeführten Werkzeuge frei.

Wechseln Sie zwischen ihnen über den Admin-Modus-Controller oder den Umschalter im Drawer.
Der gewählte Modus wird im `localStorage` unter `rebase-admin-mode` gespeichert; ein
Browser, der das Panel vor Version 0.17.0 verwendet hat, behält den alten Wert `"content"`
und wird beim Lesen auf `"cms"` migriert.

## Integrierte Studio-Werkzeuge

Das Schema einer Tabelle ist Code: `defineTable` in `backend/schema` oder – für
ein Projekt, das keines deklariert – das, was die Datenbank enthält, geändert über
SQL oder eine Migration. Studio verfügt über keinen visuellen Tabellen-Editor; das
Collections-Werkzeug, das dies einmal war, wurde entfernt, da die Spalten einer Tabelle
und deren Darstellung im Panel voneinander entkoppelt wurden und ein einziges Formular
zur Bearbeitung beider keinem von beidem mehr gerecht wurde. Der RLS-Editor speichert
Policies in der Entwicklung weiterhin in `backend/schema`, und zwar über denselben
Ablauf aus Planen → Bestätigen → Anwenden wie die
[Live-Schema-Bearbeitung](/docs/backend/live-schema-editing/).

### Integrierte Werkzeuge

Jedes Werkzeug, das das Schema kennt, liest die vom Server bereitgestellten Tabellen
über `GET /api/schema/tables`, unabhängig davon, ob das CMS auf der Seite vorhanden
ist oder nicht – Studio funktioniert also als Konsole für ein Backend ohne Admin-Panel.
Bei einer Runtime älter als 0.31, die keine solche Route hat, raten die schemabezogenen
Werkzeuge nicht, sondern weisen darauf hin, dass die Runtime aktualisiert werden muss;
bei einem Backend ohne Authentifizierung oder bei einem Fehlschlagen der Anfrage wird
jeweils der genaue Grund genannt. Die SQL-Konsole, Logs, Storage und die anderen
Werkzeuge, die das Schema nicht lesen, funktionieren unabhängig davon.

Diese werden mit Studio ausgeliefert und per **Lazy Loading über `RebaseStudio`**
geladen – jedes Werkzeug ist ein separater Chunk, der erst beim ersten Öffnen abgerufen
wird. Sie können nicht einzeln importiert werden: `@rebasepro/studio` exportiert
absichtlich nur den Orchestrator, sodass eine Konsole, die Sie nie öffnen, keine
Performance kostet.

| Tab | Slug | Gruppe | Funktion |
|-----|------|-------|--------------|
| Tabellen | `tables` | Datenbank | Jede Tabelle und Sicht des Schemas. Für die ausgewählte: **Daten** liest ihre Zeilen als Datenbankeigentümer über `/api/admin/db` (auch nicht bereitgestellte Tabellen und Sichten) mit serverseitigem Blättern, Sortieren und Filtern, Fremdschlüsselzellen, die die Zeile öffnen, auf die sie zeigen, einem Wertebetrachter, Bearbeitung in der Zeile und für mehrere Zeilen sowie CSV-Import und -Export, und **Lesen als** ein API-Nutzer zeigt die Zeilen, die dessen Row Level Security liefert; **Struktur** bearbeitet Spalten (Name, Typ, Nullbarkeit, Standardwert), Indizes (mit Größe und Scans), Constraints (Fremdschlüssel, eindeutig, Prüfung) und Trigger; **Policies** ist der Editor des Policies-Werkzeugs für diese Tabelle, mit ihren Rechten; **Beziehungen** listet Fremdschlüssel in beide Richtungen und zeichnet die Umgebung der Tabelle; **Statistiken** zeigt Größen, die Zeilenschätzung, Scans, tote Zeilen und das letzte Vacuum und Analyze, mit **Analysieren** und **Vacuum**; **Einstellungen** enthält die Metadaten der Tabelle (`rebase.table_meta`), Umbenennen und Löschen. **SQL anzeigen** zeigt die Definition der Tabelle als ein Skript. Ein Umschalter über der Liste zeichnet das ganze Schema als **Diagramm**. Jede Schemaänderung zeigt vorher das SQL, das sie ausführt. Die Auswahl steht in der URL (`?table=schema.name&tableTab=…`), sodass andere Ansichten direkt auf eine Tabelle verlinken |
| SQL-Editor | `sql` | Datenbank | Ausführen von nativem SQL auf Ihrer PostgreSQL-Datenbank und Anzeige der Ergebnisse in einer Tabelle. Jede Anweisung eines Laufs erhält einen eigenen Ergebnis-Tab mit ihrem Befehl und ihrer Zeilenzahl, und die Anweisungen teilen sich ein Budget von 10.000 Zeilen oder 32 MB an Werten; ein umfangreicheres Ergebnis gibt an, wie viele Zeilen vorhanden waren, und Kopieren sowie Exportieren umfassen nur die angezeigten Zeilen. Ein solches Ergebnis bietet zudem **Download full result as CSV**: Der Server streamt das gesamte Ergebnis über einen schreibgeschützten Cursor (`POST /api/admin/sql/csv`), Abfrage für Abfrage, auf einem eigenen Postgres-Server statt der In-Process-Entwicklungsdatenbank. Werte entsprechen dem Text der Datenbank, wie psql sie anzeigt, und **Export JSON** gibt sie genau so aus; **Export typed JSON** schreibt jeden gelesenen Wert entsprechend dem Typ seiner Spalte – Integers und Numerics, die eine JSON-Zahl exakt abbilden kann, Booleans, `json`/`jsonb` als JSON – und behält alle anderen Werte als Text bei. In jeder CSV (Export, Kopie und vollständiger Download) wird ein Wert, den ein Tabellenkalkulationsprogramm als Formel interpretieren würde (beginnend mit `=`, `+`, `-`, `@`, einem Tabulator oder einem Zeilenumbruch, abgesehen von einer Zahl mit Vorzeichen), mit einem vorangestellten `'` geschrieben, genau wie beim Collection-Export. Während eine Ausführung läuft, gibt **Cancel run** die Konsole sofort wieder frei; ein Server, der den `CANCEL_SQL`-Frame des Sockets akzeptiert (er führt `cancel_sql` im `hello` auf, mit dem er den Socket beantwortet), bricht die Anweisung zusätzlich per `pg_cancel_backend` ab. Die In-Process-Entwicklungsdatenbank kann nicht unterbrochen werden, und ein älterer Server wird belassen, um die Anweisung innerhalb seines `statement_timeout` zu beenden. **Explain analyze** führt eine Anweisung in einer Transaktion aus, die zurückgerollt wird, und zeigt für jeden Schritt die tatsächliche Zeit, Zeilen, Schleifen und Puffer. Ein `:name`-Platzhalter erhält ein Feld über dem Editor. Snippets werden im Projekt gespeichert, geteilt oder persönlich, und ein Ergebnis lässt sich als Balken- oder Liniendiagramm zeichnen. |
| Richtlinien | `rls` | Datenbank | Überprüfen und Verwalten von Row-Level-Security-Policies für Ihre Tabellen. Die deklarierte Seite ist das, was der Server aus dem `rls` der jeweiligen Tabelle kompiliert hat (bereitgestellt für Aufrufer mit `schema:read`), verglichen mit `pg_policies`, analog dazu, wie `rebase doctor` Abweichungen (Drift) bewertet: Eine Policy wird so aufgeführt, wie die Datenbank sie hält, versehen mit dem Badge **Differs from code**, falls dies nicht mit der Projektdeklaration übereinstimmt; eine deklarierte Regel, die in der Datenbank fehlt, wird als nicht angewendet aufgeführt. Eine von Rebase generierte Policy kann nicht direkt in der Datenbank bearbeitet werden, und bei einer von Rebase verwalteten Tabelle weist ein Banner darauf hin, dass jeder Serverstart und jeder Aufruf von `rebase db push` die deklarierten Policies erneut anwendet. Ein Aufrufer ohne `schema:read` sieht den Inhalt der Datenbank und erfährt, warum die Deklaration nicht angezeigt wird |
| Schema | `schema-visualizer` | Datenbank | Entity-Diagramm Ihrer Tabellen und ihrer Beziehungen: die bereitgestellten Deskriptoren (SQL-Namen, Postgres-Typen, Schlüssel, Enum-Werte, Fremdschlüssel, Zwischentabellen) und, auf einem Backend, das `/api/admin/db` bereitstellt, der Katalog der Datenbank — Tabellen, die der Server nicht bereitstellt, als nicht bereitgestellt gezeichnet, und Fremdschlüssel, die der Code nicht deklariert. Wo das Tabellen-Werkzeug registriert ist, ist das Diagramm dessen **Diagramm**-Modus, und dieses Werkzeug bleibt aus der Navigation, während seine Route weiter funktioniert. Das Layout läuft in einem Web Worker, sodass die Seite reaktionsfähig bleibt, während ein großes Diagramm angeordnet wird. Ein Schema mit mehr als 300 Tabellen wird jeweils als Umgebung einer Tabelle gezeichnet — die Tabellen eine oder zwei Beziehungen entfernt —, beginnend bei der am stärksten verbundenen Tabelle |
| Branches | `branches` | Datenbank | Erstellen und Verwalten von [Datenbank-Branches](/docs/backend/branching) und Überprüfen dieser wie bei einem Pull Request: Schema- und RLS-Policy-Änderungen nebeneinander, eingefügte, aktualisierte und gelöschte Zeilen sowie ein Merge in die Ursprungsdatenbank, der angibt, was Priorität hat – siehe [Reviewing and merging a branch](/docs/backend/branching/#reviewing-and-merging-a-branch) |
| Sicherungen | `backups` | Datenbank | Durchsuchen und Herunterladen von Datenbank-Backups |
| Datenbank | `database` | Datenbank | Die Datenbank als Ganzes. **Advisors** listet Sicherheitsbefunde aus [`rls-check`](/docs/rls-check) und Performance-Befunde — ungenutzte und doppelte Indizes, Fremdschlüssel ohne Index, Tabellen ohne Primärschlüssel, große Tabellen, die per vollständigem Scan gelesen werden, Tabellen mit vielen toten Zeilen und Suchen, die eine ganze große Tabelle lesen —, jeweils mit dem SQL, das sie behebt, zum Öffnen im SQL-Editor. **Query performance** zeigt die wichtigsten Anweisungen aus `pg_stat_statements` nach Gesamtzeit, mittlerer Zeit oder Aufrufen und installiert die Erweiterung, wo der Server sie mitliefert. **Activity** listet die Sitzungen dieser Datenbank, die gerade etwas tun, alle fünf Sekunden aktualisiert, solange sie offen ist, mit dem, worauf jede wartet, und der Sitzung, die sie blockiert; eine Abfrage lässt sich abbrechen und eine Sitzung beenden. **Functions**, **Triggers**, **Types** und **Extensions** listen diese Objekte, entfernen eine Funktion, fügen einem Enum einen Wert hinzu und installieren oder entfernen eine Erweiterung, jeweils mit vorheriger SQL-Vorschau. Stellt das Backend mehr als eine Datenbank bereit (die Standarddatenbank und jede mit `database("…")` deklarierte), wählt eine Auswahl in der Kopfzeile, welche jeder Abschnitt liest und ändert. Die eingebettete Entwicklungsdatenbank sammelt keine Abfragestatistiken und hat keine anderen Sitzungen |
| JS-Konsole | `js` | Rechenleistung | Schreiben und Ausführen von JavaScript über das Rebase SDK. Ein Skript empfängt `context.tables`, die bereitgestellten Deskriptoren (zuvor `context.collections`), und greift auf eine Tabelle über `client.data.<slug>` oder `client.data.table("<slug>")` zu |
| Geplante Jobs | `cron` | Rechenleistung | Überprüfen und Verwalten von [geplanten Aufgaben](/docs/backend/cron-jobs), einschließlich No-Code-SQL- und HTTP-Cron-Jobs |
| Speicher | `storage` | Speicher | Durchsuchen, Hochladen und Verwalten von Dateien über Ihre Storage-Backends hinweg sowie Konfigurieren deklarativer Speicherzugriffsrichtlinien |
| API | `api` | API | Interaktive API-Dokumentation mit einem Request-Runner |
| Webhooks | `webhooks` | API | Konfigurieren und Testen von Datenbank-Webhooks, die beim Einfügen, Aktualisieren und Löschen von Zeilen ausgelöst werden |
| Logs | `logs` | API | Live-Request-Log sowie alles, was der Server mit der Stufe Warn oder Error meldet – siehe unten |
| Benutzer & Rollen | `users` | Zugriffskontrolle | Verwalten von Benutzerkonten, Rollenzuweisungen und No-Code-RBAC-Rollenscopes |
| API-Schlüssel | `api-keys` | Zugriffskontrolle | Erstellen und Verwalten von berechtigungseingeschränkten Service-API-Keys; die Ziele eines `data:*`-Scopes sind die bereitgestellten Tabellen |

### Was die Logs-Ansicht anzeigt

Zwei Streams in einem In-Memory-Ringpuffer, der auf dem Serverprozess gehalten wird:

- **Jeder Request** – Methode, Pfad, Status, Dauer, die `X-Request-ID`, die
  Tabelle (sofern sich die Anfrage auf eine bezog) und, falls die Anfrage fehlschlug,
  der Fehler-`code` und die Nachricht, die der Client empfangen hat. Eine fehlgeschlagene
  Anfrage wird als `warn` (4xx) oder `error` (5xx) erfasst, sodass der Level-Filter
  sie findet. Die `source` leitet sich aus dem Pfad ab: `/api/auth/*` und
  `/api/oauth/*` sind `auth`, `/api/storage/*` ist `storage` und alles andere ist
  `api`, sodass der Source-Filter Anmeldungen unter Auth und Uploads unter Storage findet.
- **Alles, was der Server als Warn oder Error meldet** – eine Schema-Warnung, eine
  Auth-Verweigerung, eine Treiberdiagnose, ein Startfehler. Die `source` stammt
  aus dem Präfix der Nachricht selbst (`[API]`, `[Auth]`, `[storage]`, `[realtime]`),
  und alles Unbekannte ist `system`.

Routinemäßige `info`-Meldungen werden bewusst weggelassen. Der Ringpuffer fasst 10.000
Einträge, und eine Flut von `200`-Statuscodes würde genau das verdrängen, weswegen
Sie das Panel geöffnet haben.

Eine benutzerdefinierte Funktion, die einen Fehler wirft, zeigt ihre Nachricht daher
hier direkt bei der Anfrage an, die sie aufgerufen hat – genau der Anwendungsfall,
für den dies existiert.

Der Ringpuffer gilt pro Prozess und pro Start: Er ist nicht persistent, wird nicht
zwischen Replikaten geteilt und ein Neustart leert ihn. Für alles, was Sie aufbewahren
müssen, sollten Sie das stdout des Prozesses auslesen, das dieselben Zeilen und mehr
enthält.

Der Explorer weist darauf hin. Er zeigt das Protokoll derjenigen Server-Instanz, die
ihn bedient, und benennt diese Instanz: Das `snapshot`-Event von
`GET /api/admin/logs/stream` enthält `instance`, den `HOSTNAME` des Prozesses (der
Pod-Name auf Kubernetes, die Container-ID unter Docker) oder andernfalls `pid-<n>`.
Es gibt keine Ansicht über Replikate hinweg, ebenso wenig über die `functions`- und
`worker`-Prozesse eines
[Split Deployments](/docs/deployment/split-processes/). Ein Reconnect, der auf einer
anderen Instanz landet, ersetzt das Fenster, anstatt die beiden Protokolle zu vermischen.

## Studio aktivieren

Eine einzige Komponente, an beliebiger Stelle innerhalb von `<Rebase>`. Sie rendert
nichts – sie registriert die Werkzeuge, und `<RebaseShell>` stellt sie dar:

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

Die Werkzeuge erscheinen in der Drawer-Seitenleiste, solange der Studio-Modus aktiv
ist. Lassen Sie `<RebaseStudio>` komplett weg, liefern Sie ein reines Content-CMS
aus: kein Studio-Modus, kein Umschalter, kein Lazy Loading.

## Eigene Werkzeuge hinzufügen

Über `devViews` können Sie eigene Ansichten neben den integrierten platzieren. Es
handelt sich um gewöhnliche [`AppView`](/docs/frontend#custom-views)s – der einzige
Unterschied zwischen einem Studio-Werkzeug und einer CMS-Ansicht ist die Komponente,
an der es registriert wird:

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

| Registriert an | Erscheint in | Für |
|---|---|---|
| `<RebaseCMS views>` | Content-Modus | Dinge, die Personen nutzen, die Inhalte bearbeiten |
| `<RebaseStudio devViews>` | Studio-Modus | Dinge, die Sie zur Verwaltung des Backends nutzen |

Eine Ansicht gehört genau in eine von beiden – der Drawer sortiert danach, wer
sie registriert hat. Wird ein Slug in beiden aufgeführt, wird er im Content-Modus
ausgeblendet.

Wie `tools` wird die Liste anhand ihres *Inhalts* ausgewertet: Sie inline zu definieren
ist sicher, und ein Re-Render der Host-Komponente mountet das gerade angezeigte
Werkzeug nicht neu. Das Umbenennen einer Ansicht oder das Ändern ihrer Gruppe führt
jedoch zu einer erneuten Registrierung.

### Auswählen, welche Werkzeuge angezeigt werden

Wird `tools` weggelassen, werden alle oben genannten Werkzeuge registriert. Übergeben
Sie die Eigenschaft, um eine Untermenge zu registrieren – eine gehostete Konsole mit
eigenem Storage-Browser kann diesen beispielsweise weglassen:

```tsx
<RebaseStudio tools={["sql", "rls", "schema-visualizer", "api"]} />
```

`"schema"`, das Collections-Werkzeug, wird nicht mehr akzeptiert: Das Werkzeug wurde entfernt.

Die Liste wird anhand ihres *Inhalts* und nicht ihrer Referenzidentität ausgewertet,
sodass die Inline-Definition sicher ist: Ein Re-Render der Host-Komponente führt nicht
dazu, dass das aktuell geöffnete Werkzeug unmounted und neu geladen wird.

## Nächste Schritte

- **[Plugins](/docs/plugins)** – Das Framework mit Plugins erweitern
- **[Tabellen](/docs/schema/)** – Deklarieren der Tabellen, die Studio liest
- **[Anpassen einer Tabelle](/docs/frontend/customize-table/)** – Wie das Panel sie darstellt
