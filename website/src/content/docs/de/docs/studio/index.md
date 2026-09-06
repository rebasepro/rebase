---
sourceHash: c9634d9fe5d4bd79
title: Studio-Tools
sidebar_label: Studio
description: Rebase Studio bietet Entwickler-Tools für die visuelle Schema-Bearbeitung, SQL-Abfragen, JavaScript-Skripte, RLS-Richtlinienverwaltung und das Durchsuchen von Speichern.
---

## Übersicht

Studio ist die Entwicklerhälfte des Admin-Panels. Dieselbe Anwendung, mit der Ihr
Content-Team Zeilen bearbeitet, trägt auch einen Schema-Editor, eine SQL-Konsole,
einen JavaScript-Notizblock, einen RLS-Richtlinien-Browser und einen
Storage-Browser — und Studio ist der Modus, der sie freischaltet. Nichts zu
installieren und nichts zu deployen: Es steckt bereits im Panel, hinter dem
Schalter in der Schublade.

![Der Sammlungs-Editor, das Vorzeige-Tool von Studio: ein visueller Schema-Editor, der Ihr TypeScript zurückschreibt](/img/collection_editor.png)

Es gibt Studio, weil die Alternative ein zweiter Satz Zugangsdaten ist. Eine
Sammlung bearbeiten, nachsehen, was eine Richtlinie wirklich erlaubt, oder eine
einzige Abfrage gegen die Produktion laufen lassen heißt sonst: ein
Datenbank-Client, eine Kopie des Connection-Strings und ein Audit-Trail, der bei
„irgendwer mit psql“ endet. Studio erledigt all das als der angemeldete Admin,
über dieselbe Autorisierung, die auch die API verwendet.

## Die zwei Modi

Das Panel hat zwei Modi — `"cms" | "studio"`:

- **CMS** (`"cms"`) — Für Inhaltsredakteure und Betriebsteams. Zeigt Sammlungen und Datenverwaltung. Das ist die Voreinstellung.
- **Studio** (`"studio"`) — Für Entwickler. Schaltet die untenstehenden Tools frei.

Wechseln Sie zwischen ihnen über den Admin-Modus-Controller oder den Schalter in
der Schublade. Der gewählte Modus wird in `localStorage` unter
`rebase-admin-mode` gespeichert; ein Browser, der das Panel vor 0.17.0 benutzt
hat, hält noch den alten Wert `"content"` und wird beim Lesen auf `"cms"`
migriert.

## Integrierte Studio-Tools

### Sammlungs-Editor

Ein visueller Schema-Editor, mit dem Sie Sammlungen über eine Drag-and-Drop-Benutzeroberfläche erstellen und ändern können. Wenn Sie Änderungen speichern, verwendet er [ts-morph](https://ts-morph.com/), um Ihre TypeScript-Quelldateien über AST-Manipulation zu aktualisieren – wobei der gesamte vorhandene Code und die benutzerdefinierte Logik erhalten bleiben. Er ist der Screenshot oben auf dieser Seite.

Der Editor ist überall dort aktiv, wo Studio eingebunden ist — das `<RebaseStudio/>` eines Scaffolds genügt, und es gibt keine Prop, die man hinzufügen müsste. `collectionEditor` stellt ihn ein, statt ihn einzuschalten:

```tsx
import { RebaseCMS } from "@rebasepro/cms";
import { RebaseStudio } from "@rebasepro/studio";

// Studio ist eingebunden, also steht der Sammlungs-Editor zur Verfügung.
// Mehr ist dafür nicht nötig.
<Rebase>
    <RebaseCMS collections={collections}/>
    <RebaseStudio/>
</Rebase>

// `collectionEditor` dient der Feinabstimmung — ein schreibgeschützter
// Editor, ein anderes Token — nicht dem Einschalten.
<RebaseCMS
    collections={collections}
    collectionEditor={{
        getAuthToken: authController.getAuthToken
    }}
/>
```

Ob ein *Speichern* ankommt, entscheidet der Server und nicht das Panel: Der Editor schreibt die Quelldateien der Sammlungen, also ist er unter `NODE_ENV=production`, im `baas`-Modus und auf einem Server ohne `collectionsDir` aus. Das Panel fragt `GET /api/schema-editor/status` ab und zeigt den zurückgegebenen Grund neben der deaktivierten Schaltfläche an.

### Integrierte Werkzeuge

Sie gehören zu Studio und werden **von `RebaseStudio` lazy geladen** — jedes ist ein eigener Chunk, der beim ersten Öffnen geholt wird. Einzeln importierbar sind sie nicht: `@rebasepro/studio` exportiert bewusst nur den Orchestrator, damit eine nie geöffnete Konsole nichts kostet.

| Tab | Slug | Gruppe | Funktion |
|-----|------|--------|----------|
| SQL-Konsole | `sql` | Datenbank | Rohes SQL gegen Ihre PostgreSQL-Datenbank ausführen und Ergebnisse als Tabelle lesen |
| RLS-Richtlinien | `rls` | Datenbank | Row-Level-Security-Richtlinien Ihrer Tabellen prüfen und verwalten |
| Schema-Visualizer | `schema-visualizer` | Datenbank | Interaktives ERD der Tabellen und Beziehungen |
| Branches | `branches` | Datenbank | [Datenbank-Branches](/docs/backend/branching) anlegen und verwalten |
| Backups | `backups` | Datenbank | Datenbank-Backups durchsuchen und herunterladen |
| Logs-Explorer | `logs` | Datenbank | Live-Request-Log, dazu alles, was der Server auf warn oder error meldet — siehe unten |
| JS-Konsole | `js` | Compute | JavaScript über das Rebase-SDK schreiben und ausführen |
| Cron-Jobs | `cron` | Compute | [Geplante Aufgaben](/docs/backend/cron-jobs) prüfen und verwalten |
| Storage | `storage` | Storage | Dateien in Ihren Storage-Backends durchsuchen, hochladen und verwalten |
| API-Explorer | `api` | API | Interaktive API-Dokumentation samt Request-Runner |
| API-Schlüssel | `api-keys` | Zugriffskontrolle | Service-API-Schlüssel mit Scopes anlegen und verwalten |

### Was der Logs-Explorer zeigt

Zwei Ströme in einem In-Memory-Ring, gehalten im Serverprozess:

- **Jeder Request** — Methode, Pfad, Status, Dauer, die `X-Request-ID`, die
  Sammlung, sofern der Request eine betraf, und, wenn er fehlschlug, der
  Fehler-`code` und die Meldung, die der Client erhalten hat. Ein
  fehlgeschlagener Request wird auf `warn` (4xx) oder `error` (5xx)
  aufgezeichnet, damit der Level-Filter ihn findet.
- **Alles, was der Server auf warn oder error meldet** — eine Schema-Warnung,
  eine Auth-Ablehnung, eine Treiber-Diagnose, ein Boot-Fehler. `source` ergibt
  sich aus dem Präfix der Meldung (`[API]`, `[Auth]`, `[storage]`,
  `[realtime]`), und alles Unbekannte wird `system`.

Routinemäßiges `info`-Geplauder bleibt bewusst draußen. Der Ring fasst 10.000
Einträge, und eine Wand aus `200`ern verdrängt genau das, wofür Sie das Panel
geöffnet haben.

Eine benutzerdefinierte Function, die wirft, zeigt ihre eigene Meldung deshalb
hier — bei dem Request, der sie aufgerufen hat. Genau dafür gibt es das.

Der Ring gilt pro Prozess und pro Boot: Er ist nicht dauerhaft, wird nicht
zwischen Replicas geteilt, und ein Neustart leert ihn. Für alles, was Sie
aufbewahren müssen, lesen Sie das stdout des Prozesses, das dieselben Zeilen und
mehr trägt.

Der **Sammlungs-Editor** ist ebenfalls ein Studio-Tool, steht aber nicht in dieser
Liste, weil er anders registriert wird: `RebaseStudio` lädt ihn nicht lazy. Das
Panel bindet ihn überall dort ein, wo Studio registriert ist, denn anders als die
Tools oben braucht er die Sammlungsquellen des Projekts zur Hand, um in sie
zurückzuschreiben. Das ist ein Unterschied darin, wie er eingebunden wird, nicht
darin, was er ist — er bearbeitet Schema und gehört neben die SQL- und
RLS-Editoren.

## Studio einschalten

Eine Komponente, irgendwo innerhalb von `<Rebase>`. Sie rendert nichts — sie
registriert die Tools, und `<RebaseShell>` zeichnet sie:

```tsx
import { RebaseStudio } from "@rebasepro/studio";

export function App() {
    return (
        <Rebase client={client} authController={authController}>
            <RebaseCMS collections={collections}/>
            <RebaseStudio/>
            <RebaseShell title="My App"/>
        </Rebase>
    );
}
```

Die Tools erscheinen in der Schublade, solange der Studio-Modus aktiv ist. Lassen
Sie `<RebaseStudio>` ganz weg, liefern Sie ein reines Content-CMS aus: kein
Studio-Modus, kein Schalter, nichts lazy geladen.

## Ein eigenes Tool hinzufügen

`devViews` stellt Ihre eigenen Ansichten neben die eingebauten. Es sind ganz
gewöhnliche [`AppView`](/docs/frontend#custom-views)s — das Einzige, was eine
davon zu einem Studio-Tool statt zu einer CMS-Ansicht macht, ist die Komponente,
auf der sie registriert wird:

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

| Registriert auf | Erscheint in | Für |
|---|---|---|
| `<RebaseCMS views>` | Content-Modus | Dinge, die die Leute nutzen, die Inhalte pflegen |
| `<RebaseStudio devViews>` | Studio-Modus | Dinge, mit denen Sie das Backend betreiben |

Eine Ansicht gehört in genau eines von beiden — die Schublade sortiert danach,
wer sie registriert hat, sodass ein Slug in beiden Listen sie aus dem
Content-Modus verschwinden lässt.

Wie `tools` wird die Liste über ihren *Inhalt* gelesen: Sie inline zu schreiben
ist unbedenklich, und ein Re-Render des Hosts hängt das gerade sichtbare Tool
nicht aus. Eine Ansicht umzubenennen oder ihre Gruppe zu ändern registriert sie
dagegen neu.

### Auswählen, welche Tools erscheinen

Lassen Sie `tools` weg, werden alle Tools von oben registriert. Übergeben Sie es,
um eine Teilmenge zu registrieren — eine gehostete Konsole mit eigenem
Storage-Browser kann diesen etwa weglassen:

```tsx
<RebaseStudio tools={["sql", "rls", "schema-visualizer", "api"]} />
```

Die Liste wird über ihren *Inhalt* gelesen, nicht über ihre Identität; sie inline
zu schreiben ist also unbedenklich: Ein Re-Render des Hosts reißt das gerade
sichtbare Tool nicht ab und hängt es nicht neu ein.

## Nächste Schritte

- **[Plugins](/docs/plugins)** — Erweitern Sie das Framework mit Plugins
- **[Sammlungen](/docs/collections)** — Sammlungs-Konfiguration
