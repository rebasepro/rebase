---
sourceHash: f7689301748e2ce5
title: Tabellen im CMS
sidebar_label: Tabellen im CMS
description: "Wie das CMS jede Postgres-Tabelle ohne Frontend-Konfiguration anzeigt: Labels, das Widget für jeden Spaltentyp, Pflicht- und schreibgeschützte Felder, Relationen, Anzeige-Slots sowie Steuerelemente zum Erstellen, Bearbeiten und Löschen gemäß der Row-Level-Security der Tabelle."
---

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Wenn Sie das CMS verwenden, beschreiben Sie ihm Ihre Tabellen nicht. Wenn sich jemand anmeldet, fragt das Panel das Backend nach den Tabellen ab, die diese Person sehen darf, und zeigt jede davon als **Collection** an: eine Seite in der Navigation mit einer Tabellenansicht, einem Formular, Filtern und den zugehörigen Zeilen des Datensatzes. Eine Tabelle ist das Backend-Objekt, das Sie in [`backend/schema`](/docs/schema/) deklarieren; eine Collection ist die Art und Weise, wie das Panel sie anzeigt.

```tsx
// frontend/src/App.tsx: nothing about posts, users or tags here.
<Rebase client={rebaseClient} authController={authController}>
    <RebaseAuth/>
    <RebaseCMS/>
    <RebaseShell title="Acme"/>
</Rebase>
```

Alles Folgende wird aus dem Deskriptor der Tabelle abgeleitet: ihren Spalten mit ihren Postgres-Typen, Nullable-Eigenschaften, Standardwerten, Validierungs- und Speicherregeln, ihren Relationen sowie ihrer Row-Level-Security-Konfiguration. Um etwas daran zu ändern, fügen Sie eine [`customizeTable`](/docs/frontend/customize-table/)-Datei hinzu; sie gibt nur an, was abweicht.

:::note[Kommen Sie von Collections?]
Früher las das Panel `config/collections` über ein Vite-Plugin. Jetzt liest es die vom Backend bereitgestellten Tabellen, und die Darstellung liegt in `frontend/src/cms/*.tsx`.
:::

## Woher die Tabellen stammen

<span class="since-badge" data-since="0.31">Seit 0.31</span>

`<RebaseCMS>` ruft `client.schema.tables()` auf, was `GET /api/schema/tables` abfragt. Die Antwort ist die Liste der Tabellendeskriptoren, bereinigt für den Aufrufer: Eine Tabelle, die er nicht lesen darf, fehlt, ebenso wie eine Spalte, die seine Rollen nicht lesen dürfen (siehe [Feldzugriff](/docs/collections/field-access/)). Hook-Code verlässt niemals den Server; der Deskriptor gibt lediglich an, welche Hooks existieren.

- Das Panel fragt an, sobald jemand angemeldet ist, und fragt erneut an, wenn sich der angemeldete Benutzer oder dessen Rollen ändern. Einem abgemeldeten Besucher wird keine Tabelle gesendet.
- Der Server versieht die Antwort mit einem `ETag`. Der Client behält die letzte Antwort und sendet das Tag zurück, sodass ein unverändertes Schema lediglich einen `304` verursacht.
- Das Aktualisieren der Navigation fragt erneut an. Der Schema-Editor tut dies, nachdem er eine Tabelle geändert hat.

Dieselben Deskriptoren steuern das Studio und die MCP-Apps, sodass alle drei dasselbe Verständnis davon haben, was eine Tabelle ist.

## Labels

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Jedes Label wird von einem Bezeichner abgeleitet, sodass sich eine Tabelle für jeden Aufrufer und bei jedem Laden gleich liest:

| Bezeichner | Label |
|---|---|
| Spalte `first_name`, `firstName` oder `FirstName` | First Name |
| Spalte `author_id`, `photoUrl`, `apiKey` | Author ID, Photo URL, API Key |
| Spalte `__order` | Order |
| Tabelle `order_items` | Order Items, ein Datensatz: Order Item |
| Tabelle `addresses`, `status_updates` | Addresses / Address, Status Updates / Status Update |
| Enum-Wert `needs_review` | Needs Review |

Die Labels der Tabelle stammen von dem Namen, unter dem sie definiert wurde, nicht von ihrem Slug oder SQL-Namen. `ID`, `IDs`, `URL`, `URLs`, `UUID`, `API` und `IP` behalten ihre Großschreibung. Die Singularform ändert nur das letzte Wort und lässt Wörter, die lediglich auf `s` enden, unverändert (`Status`, `Analysis`, `Address`).

## Welches Feld jede Spalte erhält

<span class="since-badge" data-since="0.31">Seit 0.31</span>

| Spalte | Feld im Formular | Hinweise |
|---|---|---|
| `col.text()`, `col.varchar({ length })`, `col.char({ length })`, `col.uuid()` | Texteingabe | `varchar` und `char` begrenzen die Länge |
| eine Textspalte mit `.validate({ email: true })` | E-Mail-Eingabe | als E-Mail validiert |
| eine Textspalte mit `.validate({ url: true })` | URL-Eingabe, mit Link-Vorschau | als URL validiert |
| eine Textspalte mit `{ enum: [...] }`, eine Zahlenspalte mit `.oneOf([...])` | Select | eine Option pro Wert |
| eine Text- oder UUID-Spalte mit `.userId()` | Benutzerauswahl | der Wert ist die ID des Benutzers |
| `col.enum([...])`, eine `pgEnum`-Spalte | Select, dargestellt als farbiger Chip | eine Farbe pro Wert, abgeleitet aus dem Wert selbst |
| `col.smallint()` … `col.bigserial({ mode: "number" })` | Zahleneingabe | nur ganze Zahlen |
| `col.real()`, `col.doublePrecision()`, `col.numeric({ precision, scale })` | Zahleneingabe | |
| `col.boolean()` | Schalter | |
| `col.timestamp({ withTimezone: true })` | Datums- und Uhrzeitauswahl | |
| `col.date()` | Datumsauswahl | |
| `col.time()` | Uhrzeit | |
| `col.storage(…)` | Upload-Feld mit Vorschau | `.multiple()` ist ein Mehrfachdatei-Feld |
| `<item>.array()` | wiederholbare Liste des Feldes des Elements | ein Array aus `{ enum: [...] }`-Text ist eine Mehrfachauswahl |
| `col.jsonb().$type<T>()`, `col.json().$type<T>()` | Key/Value-Editor | der Typ `T` wird zur Laufzeit gelöscht |
| `col.jsonb(json.object({…}))` | eine Gruppe typisierter Felder | Listen, typisierte Blöcke und Dateien darin, basierend auf der Struktur |
| `col.geopoint()` | Breitengrad und Längengrad | |
| `col.vector({ dimensions })` | Vektoreingabe | |
| `col.bytea()` | Binärfeld | Base64 bei der Übertragung |

Ein Enum-Wert behält seine Farbe, wo immer er erscheint: im Select, auf dem Chip der Tabelle und als Kanban-Spalte. Die Farbe hängt ausschließlich vom Wert ab, daher führt das Hinzufügen eines Werts niemals dazu, dass die anderen umgefärbt werden. `customizeTable` kann die gewünschten Labels und Farben über `enumLabels` festlegen; ein Wert, den Sie nicht benennen, behält seinen abgeleiteten Wert.

Eine `jsonb`-Spalte, die mit einer [`json.*`-Struktur](/docs/schema/json/) deklariert ist, erhält ein echtes Formular: Ein Objekt ist eine Gruppe von Feldern, ein Array wiederholt sein Element, ein Array von `json.oneOf` ist ein Block-Editor und `json.storage()` ist ein darin enthaltenes Upload-Feld. Ohne eine Struktur kann das Panel das Dokument nicht kennen und bietet eine freie Key/Value-Bearbeitung an.

Jeder Spaltentyp, sein Widget und die Optionen zu dessen Anpassung finden sich unter [Felder](/docs/collections/properties/).

## Pflichtfelder, Standardwerte und schreibgeschützte Felder

<span class="since-badge" data-since="0.31">Seit 0.31</span>

| Die Spalte | Im Formular |
|---|---|
| `.notNull()` | erforderlich, mit der `requiredMessage` von `.validate()`, sofern vorhanden |
| `.default(literal)` | ein neuer Datensatz öffnet sich mit diesem Wert; beim Bearbeiten weiterhin erforderlich |
| `` .default(sql`…`) ``, `.defaultNow()`, `.dbDefault()` | kann beim Erstellen leer gelassen werden, damit die Datenbank ihn ausfüllt |
| `.unique()` | das Formular prüft vor dem Speichern, ob der Wert unbenutzt ist |
| ein generierter Primärschlüssel (`.defaultRandom()`, `.generatedByDefaultAsIdentity()`, ein Serial) | nicht bearbeitbar; ein Primärschlüssel ohne Standardwert wird beim Erstellen eingetippt |
| `.onCreateNow()`, `.onUpdateNow()` | schreibgeschützt und aus den Standard-Tabellenspalten ausgeschlossen |
| `.onCreateUser()`, `.onUpdateUser()` | schreibgeschützt |
| `.readOnly()`, `.generatedAlwaysAs(…)` | schreibgeschützt |
| das `tenant`-Feld der Tabelle | wird beim Erstellen vom Server ausgefüllt und aus den Standard-Tabellenspalten weggelassen; weiterhin bearbeitbar für einen Aufrufer, der Schreibrechte darauf hat |
| `.private()` | wird nie ausgeliefert, daher nie angezeigt |

Die `.validate()`-Regeln einer Spalte werden vom Formular vor dem Speichern überprüft, so wie der Server sie beim Eintreffen prüft. Siehe [Validierung und Bedingungen](/docs/collections/validation-and-conditions/).

Die ID des Datensatzes und seine Zeitstempel von `.onCreateNow()` und `.onUpdateNow()` werden im schreibgeschützten Block am unteren Rand der Seitenleiste (Rail) des Formulars angezeigt.

## Relationen

<span class="since-badge" data-since="0.31">Seit 0.31</span>

- Ein `belongsTo` ist eine Auswahl der verknüpften Zeile anstelle ihrer Fremdschlüssel-Spalte: Das Formular zeigt **Author** anstelle von **Author ID**. Es ist ein Pflichtfeld, wenn der Fremdschlüssel `NOT NULL` ohne Standardwert ist. Ein Fremdschlüssel, der Teil des Primärschlüssels ist, bleibt ein eigenes Feld neben der Auswahl.
- Ein `hasOne` ist eine Auswahl der einen verknüpften Zeile.
- Ein `hasMany`, ein `manyToMany` und ein To-Many-`via` sind **Reiter (Tabs)** des Datensatzes, die die verknüpften Zeilen auflisten. Die Auswahl neben dem Tab wird ausgeblendet.
- Ein `via` ist schreibgeschützt, es sei denn, es ist beschreibbar.
- Eine Relation zu einer Tabelle, die dem Aufrufer nicht ausgeliefert wird, wird ausgelassen: Das Panel kann keine Tabelle öffnen, die es nicht hat. Ein `belongsTo` behält seinen Fremdschlüssel dann als einfaches Feld bei, sodass der Wert sichtbar bleibt.

Siehe [Relationen im Panel](/docs/collections/relations-in-the-admin-panel/).

## Anzeige-Slots

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Jede Oberfläche, die einen Datensatz darstellt, verwendet einige von sechs Slots: title, subtitle, image, status, date und tags (siehe [Anzeige-Slots](/docs/frontend/view-modes/#display-slots)). Ein Slot wird nur dann aus einer Spalte gefüllt, wenn die Spalte eindeutig dorthin gehört; die erste passende Spalte in Deklarationsreihenfolge gewinnt:

| Slot | Spalte |
|---|---|
| title | eine Textspalte ohne geschlossene Wertemenge und ohne Datei, deren Schlüssel `title`, `name`, `label`, `displayName`, `fullName`, `heading`, `subject` oder `username` lautet (Groß-/Kleinschreibung und Trennzeichen werden ignoriert) |
| image | eine einzelne `col.storage()`-Spalte, deren `accept` einen Bildtyp benennt |
| status | eine Spalte namens `status` mit einer geschlossenen Wertemenge |
| date | eine Datums- oder Zeitstempel-Spalte, die der Server nicht automatisch stempelt (`publishDate`); andernfalls der Aktualisierungszeitstempel, danach der Erstellungszeitstempel |

Ein Slot, den keine Spalte füllt, wird der Interpretation des Datensatzes durch das Panel selbst überlassen (für den Titel: das erste kurze Textfeld). `display` in `customizeTable` legt jeden Slot explizit fest.

## Wer welche Steuerelemente sieht

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Das Panel blendet **Create**, **Edit** und **Delete** aus, wenn der angemeldete Benutzer diese nicht ausführen darf. Es entscheidet dies, indem es die Row-Level-Security der Tabelle im Browser evaluiert, und zwar mit demselben Policy-Modell, das nach Postgres kompiliert wird:

- die Regeln, die Sie in `rls` deklariert haben, plus die Policies, die Rebase zusätzlich hinzufügt: die Admin-Baseline (sofern nicht `defaultPolicies: false`), die Lese-Zugriffsberechtigung für eigene Benutzerdaten und die Admin-Schreibschranke der Benutzertabelle sowie die Mandantenregel (siehe [Policies, die eine Tabelle automatisch erhält](/docs/collections/security-rules/#policies-a-table-gets-without-writing-them));
- `rls: "admin-only"`: Nur Admins sehen die Steuerelemente;
- eine in reinem SQL geschriebene Regel kann im Browser nicht beurteilt werden, und dasselbe gilt für eine Klausel, die der Server diesem Aufrufer vorenthalten hat: Das Steuerelement wird angezeigt, und die Datenbank entscheidet, sobald der Schreibvorgang eintrifft;
- ein SQL-View ist schreibgeschützt. Ein normaler View wird aufgeführt und die von ihm abgefragten Tabellen entscheiden, welche Zeilen zurückgegeben werden; ein Materialized View wird für die Rollen aufgeführt, die er benennt (`["admin"]`, wenn er keine benennt).

Dies entscheidet lediglich darüber, was dargestellt wird. Jeder Schreibvorgang wird von Postgres erneut überprüft, sodass ein Steuerelement, das nicht hätte angezeigt werden dürfen, zu einem abgewiesenen Schreibvorgang führt – niemals zu einem Schreibvorgang, der nicht hätte stattfinden dürfen.

## Reihenfolge und Standardwerte

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Tabellen erscheinen in der Navigation in der Reihenfolge, in der das Backend sie ausliefert – der Reihenfolge, in der sie aus `backend/schema/index.ts` exportiert werden. Jede öffnet sich in der Tabellenansicht. `customizeTable` legt `group`, `icon`, `defaultViewMode` und den Rest fest; `<RebaseCMS navigationGroupMappings>` ordnet Gruppen über Tabellen hinweg an.

## Ladevorgang und Fehler

<span class="since-badge" data-since="0.31">Seit 0.31</span>

- **Während die Tabellen laden**, zeigt eine Route zu einer Collection den Ladezustand an, nicht „Collection nicht gefunden“, und ein Deep-Link öffnet sich, sobald die Collection existiert.
- **Wenn die Tabellen nicht geladen werden können**, informieren die Startseite und die Collection-Route darüber, was fehlgeschlagen ist, und bieten einen erneuten Versuch an. Wenn der Server die Sitzung nicht mehr akzeptiert, fordert die Meldung dazu auf, sich erneut anzumelden.
- **Ein Backend, das keine Tabellen ausliefert** (eines ohne konfigurierte Authentifizierung oder älter als die Route), ist kein Fehler: Das Panel zeigt die [externen Collections](/docs/frontend/firebase/) und sonst nichts.

Anpassungen, die eine Tabelle benennen, die dem Aufrufer nicht bereitgestellt wird, werden ignoriert, mit einer Warnung in der Entwicklungsumgebung. Siehe [Was abgelehnt und was übersprungen wird](/docs/frontend/customize-table/#what-is-refused-and-what-is-skipped).

## Viele Tabellen

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Die Anzahl der Tabellen ist nicht begrenzt. Das Panel benötigt jede Collection, um die Navigation darzustellen, daher werden die Deskriptoren nach der Anmeldung abgerufen; was das Öffnen einer Collection erfordert (die Tabelle, die Datensatzansichten, das Formular), lädt erst dann. Ein großes Schema verlangsamt `rebase db push` mehr als das Panel: Bei 400 oder mehr Tabellen dauert ein Push mehrere zehn Sekunden; siehe [Wie lange ein Push dauert](/docs/cli/schema#rebase-db-push).

## Nächste Schritte

<span class="since-badge" data-since="0.31">Seit 0.31</span>

- [customizeTable](/docs/frontend/customize-table/): Beliebiges davon pro Tabelle anpassen
- [Felder](/docs/collections/properties/): Widget und Optionen für jeden Spaltentyp
- [Ansichtsmodi](/docs/frontend/view-modes/): Tabelle, Karten, Kanban, Anzeige-Slots und Filter
- [Relationen im Panel](/docs/collections/relations-in-the-admin-panel/): Tabs, Auswahlen und Zwischentabellen (Pivots)
- [Firestore neben Postgres](/docs/frontend/firebase/): Collections aus einer anderen Datenquelle
