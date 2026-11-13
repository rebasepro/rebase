---
sourceHash: 7f137cdb15196a3e
title: Studio-Tools
sidebar_label: Studio
description: Rebase Studio bietet Entwickler-Tools für visuelle Schema-Bearbeitung, SQL-Abfragen, JavaScript-Scripting, RLS-Richtlinienverwaltung und das Durchsuchen von Speicher.
---

## Übersicht

Studio ist die Entwickler-Hälfte des Admin-Panels. Dieselbe Anwendung, die Ihr
Content-Team zum Bearbeiten von Zeilen verwendet, enthält auch einen Schema-Editor,
eine SQL-Konsole, ein JavaScript-Scratchpad, einen RLS-Richtlinien-Browser und
einen Storage-Browser – und Studio ist der Modus, der sie freischaltet. Nichts
zu installieren und nichts bereitzustellen: Es ist bereits im Panel vorhanden,
hinter dem Schalter im Drawer.

![Der Collection Editor, das Flaggschiff-Tool von Studio: ein visueller Schema-Editor, der Ihren TypeScript-Code zurückschreibt](/img/collection_editor.png)

Es existiert, weil die Alternative ein zweiter Satz von Anmeldedaten ist. Das
Bearbeiten einer Tabelle, das Überprüfen, was eine Richtlinie wirklich erlaubt,
oder das Ausführen einer einzelnen Abfrage gegen die Produktionsumgebung bedeutet
andernfalls einen Datenbank-Client, eine Kopie des Connection-Strings und einen
Audit-Trail, der bei „jemand mit psql“ endet. Studio erledigt all dies als
angemeldeter Administrator über dieselbe Autorisierung, die auch die API verwendet.

## Die zwei Modi

Das Panel hat zwei Modi – `"cms" | "studio"`:

- **CMS** (`"cms"`) – Für Content-Redakteure und Betriebsteams. Zeigt die Tabellen und die Datenverwaltung an. Dies ist der Standard.
- **Studio** (`"studio"`) – Für Entwickler. Schaltet die unten stehenden Tools frei.

Wechseln Sie zwischen ihnen über den Admin-Modus-Controller oder den Umschalter im
Drawer. Der gewählte Modus wird im `localStorage` unter `rebase-admin-mode`
gespeichert; ein Browser, der das Panel vor 0.17.0 verwendet hat, enthält den alten
Wert `"content"` und wird beim Lesen auf `"cms"` migriert.

## Integrierte Studio-Tools

### Collection Editor

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Ein visueller Editor für eine Tabelle und deren Darstellung im Panel. Ein Speichervorgang ist in zwei Teile aufgeteilt:

- **Schema-Fakten** – der Typ einer Spalte, Nullability, Standardwerte, Validierung,
  Enum-Werte, Storage, Relationen, Regeln, Beschreibung, Verlauf – werden zu
  `TablePatch`-Änderungen, die der Schema-Editor des Servers mit
  [ts-morph](https://ts-morph.com/) in `backend/schema/<table>.ts` schreibt,
  wobei nur der von der Bearbeitung benannte Code geändert wird und der Rest der
  Datei unverändert bleibt: Imports, Kommentare, Formatierung, Hooks, geteilte
  Spalten. Eine Bearbeitung, die in Code eingreift – eine durch einen Helper
  erstellte Spalte, in einer Variable gehaltene Regeln –, wird abgelehnt,
  zusammen mit dem Hinweis auf die Stelle, an der sie vorgenommen werden muss.
  Eine unberührte Regel wird exakt so zurückgesendet, wie sie bereitgestellt
  wurde, sodass sich ihr Richtlinienname nie ändert. Siehe
  [Live-Schema-Bearbeitung](/docs/backend/live-schema-editing/#the-edits-tablepatch).
- **Präsentation** – Labels, Icons, Ansichtsmodi, Spaltenreihenfolge, ausgeblendete
  Spalten, Breiten, Enum-Labels und -Farben, Kanban, Standard-Abfragen – ist eine
  UI-Einstellung, niemals eine Schema-Bearbeitung. Die Einstellungen eines
  Administrators gelten für den gesamten Workspace: Wo der Server den Quellcode des
  Projekts schreiben darf, landen sie in `frontend/src/cms/ui-config.json`, und bei
  einem Deployment über `/api/admin/ui-config` in der Tabelle `rebase.ui_preferences`.
  Individuelle Größenänderungen und Ansichtswechsel eines Benutzers bleiben dessen
  eigene.

Eine Änderung an Slug, SQL-Tabelle oder Datenbank wird als Migration abgelehnt.
Eine Tabelle, deren Regeln von `defaultRls` stammen, fragt nach, bevor sie eigene
Regeln übernimmt. Ein Aufrufer, dem geschwärzte Regeln ausgeliefert werden,
erhält einen schreibgeschützten Editor. Ein Speichervorgang, den der Server nicht
kompilieren kann, listet jedes Problem beim betreffenden Feld auf, und es wird
nichts geschrieben. Eine Datei, die sich seit dem Einlesen durch den Editor auf
der Festplatte geändert hat, bietet ein Neuladen an, anstatt die Änderung zu
überschreiben (`SCHEMA_EDIT_STALE_FILE`). Ein Feld, dessen Definition im Code
erstellt wurde – ein Helper, eine geteilte Variable –, wird schreibgeschützt mit
der entsprechenden Begründung angezeigt. Die Spaltenreihenfolge ist rein
präsentationsbezogen: Ein Neuanordnen verschiebt eine Spalte niemals in der
Tabelle. Es ist der Screenshot oben auf dieser Seite.

**Vorhandene Tabelle importieren.** Eine Tabelle, die in der Datenbank existiert,
aber in `backend/schema` nicht deklariert ist, wird unter „Import an existing
table“ aufgelistet; die Auswahl einer Tabelle schreibt deren `defineTable`-Datei
über die `adoptTable`-Bearbeitung exakt so, wie die Datenbank sie beschreibt –
Spalten, Schlüssel, Indizes, Row-Level Security. Die Übernahme ändert nichts in
der Datenbank: Sie plant kein DDL, und der erste Richtlinienschritt erstellt
einmalig eine identische Richtlinie neu, um sie zu stempeln. Die Sicherheitsstufe
der Row-Level Security wird niemals herabgesetzt: Eine Tabelle mit deaktiviertem
RLS oder ohne Richtlinien wird als `rls: "admin-only"` übernommen, worauf der
Dialog hinweist. Eine Tabelle ohne Primärschlüssel kann nicht übernommen werden.
Die Routen sind `GET /api/admin/schema-editor/unmapped-tables` und
`GET /api/admin/schema-editor/unmapped-tables/:schema/:table`.

**Firestore-Collections.** In der Entwicklungsumgebung bearbeitet der Collection
Editor auch Firestore-Collections: Ein Speichervorgang überschreibt den
`defineFirestoreCollection({...})`-Aufruf der Collection in `frontend/src/cms`
direkt vor Ort und ändert nur das, was Sie bearbeitet haben. Funktionen,
benutzerdefinierte Komponenten, Kommentare und Imports bleiben wie geschrieben
erhalten; im Code definierte Felder werden schreibgeschützt angezeigt. In der
Produktionsumgebung sind Firestore-Collections im Editor schreibgeschützt. Das
Erstellen einer Collection oder das Ändern ihres Slugs erfolgt im Code; um eine zu
löschen, entfernen Sie deren Datei und ihren Eintrag in `externalCollections`.

Der Editor ist überall dort aktiviert, wo Studio eingebunden ist – das
`<RebaseStudio/>` eines Scaffolds genügt, und es muss keine Prop hinzugefügt
werden. `collectionEditor` dient der Feinabstimmung, anstatt ihn zu aktivieren:

```tsx
import { RebaseCMS } from "@rebasepro/cms";
import { RebaseStudio } from "@rebasepro/studio";

// Studio is mounted, so the Collection Editor is available. Nothing else
// is needed for it.
<Rebase>
    <RebaseCMS tableCustomizations={tableCustomizations}/>
    <RebaseStudio/>
</Rebase>

// `collectionEditor` is for fine-tuning — a read-only editor, a different
// token — not for opting in.
<RebaseCMS
    tableCustomizations={tableCustomizations}
    collectionEditor={{
        getAuthToken: authController.getAuthToken
    }}
/>
```

Ob ein *Speichervorgang* erfolgreich angewendet wird, entscheidet der Server, nicht
das Panel: Der Editor schreibt `backend/schema` neu und ist daher unter
`NODE_ENV=production` deaktiviert (es sei denn, [Live-Schema-Bearbeitung](/docs/backend/live-schema-editing/)
benennt ein Repository), ebenso im `baas`-Modus und auf einem Server ohne
`schemaDir`. Das Panel ruft `GET /api/admin/schema-editor/status` ab und zeigt die
zurückgegebene Begründung neben dem deaktivierten Button an.

### Integrierte Tools

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Jedes Tool, das das Schema kennt, liest die vom Server bereitgestellten Tabellen
über `GET /api/schema/tables` aus, unabhängig davon, ob das CMS auf der Seite
vorhanden ist – so funktioniert Studio auch als Konsole eines Backends ohne
Admin-Panel. Bei einer Laufzeitumgebung, die älter als 0.31 ist und keine solche
Route besitzt, weisen die schema-bewussten Tools darauf hin, dass die
Laufzeitumgebung aktualisiert werden muss, anstatt Annahmen zu treffen; bei einem
Backend ohne Authentifizierung oder bei einem fehlerhaften Request gibt jedes Tool
den jeweiligen Grund an. Die SQL-Konsole, Logs, Storage und die anderen Tools, die
das Schema nicht lesen, funktionieren unabhängig davon.

Diese werden mit Studio ausgeliefert und per **Lazy-Loading von `RebaseStudio`
geladen** – jedes ist ein separater Chunk, der beim ersten Öffnen abgerufen wird.
Sie können nicht separat importiert werden: `@rebasepro/studio` exportiert bewusst
nur den Orchestrator, sodass eine Konsole, die Sie nie öffnen, keine Ressourcen
kostet.

| Tab | Slug | Gruppe | Funktion |
|-----|------|--------|----------|
| SQL Console | `sql` | Database | Führen Sie direktes SQL auf Ihrer PostgreSQL-Datenbank aus und sehen Sie die Ergebnisse in einer Tabelle ein. Die Tabelle zeigt das Ergebnis der letzten Anweisung an, bis zu den ersten 10.000 Zeilen oder 32 MB an Werten; bei einem größeren Ergebnis wird die Gesamtanzahl der Zeilen angegeben, und Kopieren sowie Exportieren umfassen nur die angezeigten Zeilen. Ein solches Ergebnis bietet zudem **Download full result as CSV**: Der Server streamt das gesamte Ergebnis über einen schreibgeschützten Cursor (`POST /api/admin/sql/csv`), eine Abfrage nach der anderen, auf einem eigenen Postgres-Server anstelle der In-Process-Entwicklungsdatenbank. Werte entsprechen dem Text der Datenbank, wie psql sie anzeigt, und **Export JSON** schreibt sie genau so; **Export typed JSON** schreibt jeden gelesenen Wert entsprechend seinem Spaltentyp – Integer und Numerics, die eine JSON-Zahl exakt darstellen kann, Booleans, `json`/`jsonb` als JSON – und belässt jeden anderen Wert als Text. In jeder CSV-Datei (Export, Kopieren und vollständiger Download) wird ein Wert, den ein Tabellenkalkulationsprogramm als Formel ausführen würde (beginnend mit `=`, `+`, `-`, `@`, einem Tabulator oder einem Wagenrücklauf, ausgenommen vorzeichenbehaftete Zahlen), mit einem vorangestellten `'` geschrieben, so wie es auch der Collection-Export tut. Während eine Ausführung läuft, gibt **Cancel run** die Konsole sofort wieder frei; ein Server, der den `CANCEL_SQL`-Frame des Sockets akzeptiert (er listet `cancel_sql` im `hello` auf, mit dem er den Socket beantwortet), bricht die Anweisung zusätzlich mit `pg_cancel_backend` ab. Die In-Process-Entwicklungsdatenbank kann nicht unterbrochen werden, und ein älterer Server wird die Anweisung innerhalb seines `statement_timeout` abschließen lassen |
| RLS Policies | `rls` | Database | Prüfen und verwalten Sie Row-Level-Security-Richtlinien für Ihre Tabellen. Die deklarierte Seite ist das, was der Server aus dem `rls` jeder Tabelle kompiliert hat (ausgeliefert an Aufrufer mit `schema:read`), verglichen mit `pg_policies` so, wie `rebase doctor` Abweichungen (Drift) beurteilt: Eine Richtlinie wird so aufgeführt, wie die Datenbank sie speichert, mit dem Badge **Differs from code** versehen, falls sie nicht der Projektdeklaration entspricht, und eine deklarierte Regel, die der Datenbank fehlt, wird als unapplied aufgeführt. Eine von Rebase generierte Richtlinie kann nicht direkt in der Datenbank bearbeitet werden, und bei einer von Rebase verwalteten Tabelle weist ein Banner darauf hin, dass jeder Serverstart und jedes `rebase db push` die deklarierten Richtlinien neu anwenden. Ein Aufrufer ohne `schema:read` sieht den Datenbankstand und erfährt, warum die Deklaration nicht angezeigt wird |
| Schema Visualizer | `schema-visualizer` | Database | Entitätsdiagramm Ihrer Tabellen und deren Relationen, gezeichnet aus den bereitgestellten Deskriptoren: SQL-Namen, Postgres-Typen, Nullability, Schlüssel, Enum-Werte, Fremdschlüssel und Verknüpfungen (Junctions) entsprechen den Deklarationen der Tabellen. Lediglich die RLS-Markierungen werden aus der Datenbank gelesen. Das Layout läuft in einem Web Worker, sodass die Seite auch beim Anordnen eines großen Diagramms reaktionsfähig bleibt. Ein Schema mit mehr als 300 Tabellen wird jeweils für die Nachbarschaft einer einzelnen Tabelle gezeichnet – die Tabellen, die eine oder zwei Relationen entfernt sind –, beginnend mit der Tabelle mit den meisten Verknüpfungen; wählen Sie eine andere Tabelle in der Liste aus, um zu navigieren |
| Branches | `branches` | Database | Erstellen und verwalten Sie [Datenbank-Branches](/docs/backend/branching) und überprüfen Sie diese wie einen Pull-Request: Schema- und RLS-Richtlinien-Änderungen nebeneinander, die eingefügten, aktualisierten und gelöschten Zeilen sowie ein Merge in die Ausgangsdatenbank, der festlegt, was vorrangig übernommen wird – siehe [Überprüfen und Zusammenführen eines Branches](/docs/backend/branching/#reviewing-and-merging-a-branch) |
| Backups | `backups` | Database | Datenbank-Backups durchsuchen und herunterladen |
| Logs Explorer | `logs` | Database | Live-Request-Log sowie alle Meldungen, die der Server unter Warn oder Error ausgibt – siehe unten |
| JS Console | `js` | Compute | Schreiben und führen Sie JavaScript über das Rebase SDK aus. Ein Skript empfängt `context.tables`, die bereitgestellten Deskriptoren (zuvor `context.collections`), und greift auf eine Tabelle über `client.data.<slug>` oder `client.data.table("<slug>")` zu |
| Cron Jobs | `cron` | Compute | [Geplante Aufgaben](/docs/backend/cron-jobs) einsehen und verwalten |
| Storage | `storage` | Storage | Dateien über Ihre Storage-Backends hinweg durchsuchen, hochladen und verwalten |
| API Explorer | `api` | API | Interaktive API-Dokumentation mit integriertem Request-Runner |
| API Keys | `api-keys` | Access Control | Erstellen und verwalten Sie berechtigungsspezifische (scoped) Service-API-Schlüssel; die Ziele eines `data:*`-Scopes sind die bereitgestellten Tabellen |

### Was der Logs Explorer anzeigt

Zwei Datenströme in einen Ringpuffer im Arbeitsspeicher (In-Memory-Ring), der im Serverprozess gehalten wird:

- **Jede Anfrage** – Methode, Pfad, Status, Dauer, die `X-Request-ID`, die
  Tabelle, sofern sich die Anfrage auf eine bezog, und im Fehlerfall der
  Fehler-`code` sowie die Meldung, die der Client empfangen hat. Eine
  fehlgeschlagene Anfrage wird unter `warn` (4xx) oder `error` (5xx) erfasst,
  sodass der Level-Filter sie findet. Die `source` stammt aus dem Pfad:
  `/api/auth/*` und `/api/oauth/*` sind `auth`, `/api/storage/*` ist `storage`
  und alles andere ist `api`, sodass der Source-Filter Anmeldungen unter Auth
  und Uploads unter Storage findet.
- **Alles, was der Server unter Warn oder Error meldet** – eine Schema-Warnung,
  eine Auth-Verweigerung, eine Treiber-Diagnose, ein Startfehler. Die `source`
  stammt aus dem Präfix der Meldung selbst (`[API]`, `[Auth]`, `[storage]`,
  `[realtime]`), und alles Unbekannte ist `system`.

Routinemäßige `info`-Meldungen werden bewusst weggelassen. Der Ringpuffer fasst
10.000 Einträge, und eine Flut von `200`-Statuscodes würde genau das verdrängen,
weswegen Sie das Panel geöffnet haben.

Eine benutzerdefinierte Funktion, die einen Fehler auslöst (throw), zeigt ihre
Meldung daher hier direkt bei der Anfrage an, die sie aufgerufen hat – genau dafür
ist diese Funktion gedacht.

Der Ringpuffer existiert pro Prozess und pro Systemstart: Er ist nicht persistent,
wird nicht zwischen Replikaten geteilt und wird bei einem Neustart geleert. Für
alles, was dauerhaft gespeichert werden muss, lesen Sie stdout des Prozesses aus,
das dieselben Zeilen und mehr enthält.

Der Explorer weist darauf hin. Er zeigt das Log derjenigen Serverinstanz, die ihn
bereitstellt, und nennt diese Instanz: Das `snapshot`-Event von
`GET /api/admin/logs/stream` enthält `instance`, den `HOSTNAME` des Prozesses
(den Pod-Namen unter Kubernetes, die Container-ID unter Docker) oder andernfalls
`pid-<n>`. Es gibt keine Ansicht über Replikate hinweg und auch nicht über die
`functions`- und `worker`-Prozesse eines [Split-Deployments](/docs/deployment/split-processes/).
Eine Neuverbindung, die auf einer anderen Instanz landet, ersetzt den Inhalt des
Fensters, anstatt die beiden Logs zu vermischen.

Der **Collection Editor** ist ebenfalls ein Studio-Tool, steht jedoch nicht in
dieser Liste, da er anders registriert wird: `RebaseStudio` lädt ihn nicht per
Lazy-Loading. Das Panel bindet ihn überall dort ein, wo Studio und das CMS
registriert sind, da er im Gegensatz zu den oben genannten Tools sowohl die vom
CMS gerenderte Präsentation als auch das Schema bearbeitet. Das ist ein Unterschied
in der Art und Weise, wie er eingebunden wird, nicht darin, was er ist – er
bearbeitet das Schema und gehört an die Seite der SQL- und RLS-Editoren.

## Studio aktivieren

Eine einzige Komponente an beliebiger Stelle innerhalb von `<Rebase>`. Sie rendert
selbst nichts – sie registriert die Tools, und `<RebaseShell>` stellt sie dar:

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
`<RebaseStudio>` komplett weglassen, liefern Sie ein reines Content-CMS aus: kein
Studio-Modus, kein Umschalter, kein Lazy-Loading.

## Eigene Tools hinzufügen

`devViews` platziert Ihre eigenen Ansichten neben den integrierten. Es handelt sich
dabei um gewöhnliche [`AppView`](/docs/frontend#custom-views)s – das Einzige, was
ein Studio-Tool von einer CMS-Ansicht unterscheidet, ist die Komponente, an der es
registriert ist:

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

| Registriert an | Erscheint in | Geeignet für |
|---|---|---|
| `<RebaseCMS views>` | Content-Modus | Dinge, die Personen beim Bearbeiten von Inhalten verwenden |
| `<RebaseStudio devViews>` | Studio-Modus | Dinge, die Sie für den Betrieb des Backends verwenden |

Eine Ansicht gehört genau zu einem von beiden – der Drawer sortiert danach, wer
sie registriert hat, sodass das Auflisten eines Slugs in beiden dazu führt, dass
sie im Content-Modus ausgeblendet wird.

Wie bei `tools` wird die Liste anhand ihres *Inhalts* ausgewertet: Sie inline zu
definieren ist sicher, und ein Re-Render der übergeordneten Komponente führt nicht
dazu, dass das aktuell angezeigte Tool neu gemountet wird. Das Umbenennen einer
Ansicht oder das Ändern ihrer Gruppe führt jedoch zu einer erneuten Registrierung.

### Auswählen, welche Tools angezeigt werden

Lassen Sie `tools` weg, werden alle oben genannten Tools registriert. Übergeben Sie
es, um eine Teilmenge zu registrieren – eine gehostete Konsole mit eigenem
Storage-Browser kann diesen beispielsweise weglassen:

```tsx
<RebaseStudio tools={["sql", "rls", "schema-visualizer", "api"]} />
```

Die Studio-Ansicht des Collection Editors ist das `"schema"`-Tool. Wenn Sie `tools`
weglassen, ist es vorhanden; übergeben Sie eine Liste ohne `"schema"`, wie oben
dargestellt, wird es weggelassen.

Die Liste wird anhand ihres *Inhalts* ausgewertet, nicht anhand der Identität,
sodass das Inline-Schreiben sicher ist: Ein Re-Render der Host-Komponente führt
nicht dazu, dass das gerade aktive Tool abgebaut und neu gemountet wird.

## Nächste Schritte

- **[Plugins](/docs/plugins)** – Erweitern Sie das Framework mit Plugins
- **[Tabellen](/docs/schema/)** – Deklarieren der Tabellen, die Studio liest
- **[Tabelle anpassen](/docs/frontend/customize-table/)** – Wie das Panel Tabellen darstellt
