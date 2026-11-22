---
sourceHash: c423ff16c60af471
title: Nur Backend (Headless)
sidebar_label: Nur Backend
description: Betreiben Sie Rebase als headless Backend-as-a-Service über Ihrer eigenen PostgreSQL-Datenbank – eine REST-API, Authentifizierung, Storage und Echtzeit, ohne Admin-Panel und ohne backend/schema.
---

Rebase gibt es in zwei Varianten, und diese Seite beschreibt diejenige, die niemals einen Browser öffnet: eine REST-API, Auth, Storage, Realtime und Backups über einer PostgreSQL-Datenbank, die Sie bereits besitzen. Kein Admin-Panel, kein `backend/schema/`. Wenn Sie Supabase oder PostgREST in Betracht gezogen haben, ist dies das vergleichbare Äquivalent.

Alles auf dieser Seite funktioniert auch im vollständigen Projekt – es ist derselbe Server. Was `--headless` entfernt, sind das Frontend-Paket und die Tabellendateien, keine Funktionalität.

## Gerüst erstellen

```bash
pnpm dlx @rebasepro/cli init my-api --headless --yes
cd my-api
```

Ein Workspace, kein `frontend/`:

| Ordner | Inhalt |
|--------|--------|
| `backend/` | `storage.ts` (`storageAuthorize`), Ihre benutzerdefinierten Funktionen und Crons sowie das `backend/schema/`, das `--introspect` schreibt, wenn Sie es anfordern. Es gibt keine Serverdatei – die veröffentlichte Runtime startet das Projekt |

`--template` hat hier keine Auswirkung: Ein Preset befüllt Tabellen mit Seed-Daten, und diese Variante hat keine. Node 22.22+, dieselbe Mindestanforderung wie beim vollständigen Projekt – die `package.json` des Headless-Overlays deklariert `"node": ">=22.22.0"` und ersetzt die darunterliegende.

## Mit Ihrer Datenbank verbinden

`init` generiert eine sofort einsatzbereite `.env`. Um eine Datenbank zu verwenden, die Sie bereits betreiben, übergeben Sie deren URL bei der Projekterstellung:

```bash
pnpm dlx @rebasepro/cli init my-api --headless --database-url "postgres://user:pass@host:5432/db" --yes
```

Oder setzen Sie `DATABASE_URL` nachträglich in `.env` – das Ergebnis ist dasselbe. Ohne `DATABASE_URL` startet `rebase dev` ein verwaltetes PostgreSQL (PGlite) im Projektverzeichnis, was zum Ausprobieren der API nützlich ist, aber nicht dem Zweck dieser Variante entspricht.

Danach:

```bash
pnpm install
pnpm run dev
```

**Lesen Sie die URL aus der Ausgabe ab.** `rebase dev` ermittelt einen freien Port anhand des Projektpfads, anstatt einen festen zu verwenden, sodass er sich zwischen Projekten und Maschinen unterscheidet.

## Woher die Tabellen stammen

Es gibt keine im Code: Ohne `backend/schema/index.ts` deklariert das Backend keine Tabellen. Der Server liest Ihr Datenbankschema beim Start ein und stellt die gefundenen Tabellen bereit, sodass die API Ihren Migrationen folgt: Ändern Sie das Schema, ändern sich die Endpunkte entsprechend mit.

Eine Tabelle wird bereitgestellt, sobald Row-Level Security (RLS) für sie aktiviert ist. Ohne Policy wird sie bereitgestellt, gibt jedoch keine Zeilen zurück, worüber der Boot-Prozess eine Warnung ausgibt; eine Policy schaltet sie frei:

```sql
ALTER TABLE your_table ENABLE ROW LEVEL SECURITY;
-- rebase.uid() is text: the cast makes this work for a uuid or integer column too.
CREATE POLICY your_table_owner ON your_table
    FOR ALL USING (user_id::text = rebase.uid());
```

`rebase.uid()`, `rebase.roles()` und `rebase.jwt()` werden von Rebase installiert und lesen die Identität der authentifizierten Anfrage aus. Siehe [Row-Level Security](/docs/collections/security-rules/) für das Policy-Vokabular und [rls-check](/docs/rls-check/) für ein Audit dessen, was Ihre Policies tatsächlich erlauben.

Eine Tabelle ohne RLS wird ganz bewusst **übersprungen**: Jede authentifizierte Anfrage wird als `rebase_user` ausgeführt, sodass die Bereitstellung einer Tabelle ohne Schutz durch Row-Level Security jede Zeile an jeden angemeldeten Aufrufer übergeben würde. Jede übersprungene Tabelle wird beim Booten zusammen mit dem SQL genannt, das sie schützen würde.

Eine Verknüpfungstabelle (Join-Tabelle) wird ohnehin nicht bereitgestellt: Sie wird als Verknüpfung zwischen den beiden Tabellen interpretiert, die sie verbindet. Eine solche Tabelle mit deaktiviertem RLS wird beim Booten ebenfalls gemeldet.

Die Prüfung läuft beim Booten. Wenn RLS für eine bereitgestellte Tabelle später deaktiviert wird, bleibt sie bereitgestellt, bis der nächste Startvorgang sie überspringt. Das [geplante Audit](/docs/rls-check/) meldet dies früher und ist standardmäßig deaktiviert.

:::note
`baas: { unprotectedTables: "serve" }` stellt sie trotzdem bereit. Dies ist eine Option von `initializeRebaseBackend` und daher erst nach `rebase eject` erreichbar – die verwaltete Runtime liest sie weder aus einer Datei noch aus der Umgebung aus. Nur sinnvoll, wenn jedem Aufrufer bereits vertraut wird.
:::

### Stattdessen Tabellendateien generieren

Wenn Sie die Tabellen lieber als TypeScript festgeschrieben haben möchten – für Typen, für Hooks, für Reviews –, können Sie sie introspektieren:

```bash
pnpm dlx @rebasepro/cli init my-api --headless --database-url "postgres://…" --introspect --install
```

`--introspect` impliziert `--template blank` und erfordert `--install`, da es gegen die installierte CLI ausgeführt wird. In einem bestehenden Projekt entspricht dies folgendem Befehl:

```bash
pnpm rebase schema introspect
```

Dateien landen in `backend/schema/`: ein `defineTable` pro Tabelle mit ihren Spalten, Relationen und ihren Policies als `rls` sowie eine `index.ts`, die diese exportiert. Ab diesem Punkt existieren Tabellen im Code des Projekts, und die Introspektion beim Start definiert nicht länger die API.

Das Headless-Scaffolding installiert Atlas in `backend/`, sodass `rebase db push`, `rebase db generate` und `pnpm run db:migrate` wie in jedem Projekt auf diesen Tabellen funktionieren.

## Verwendung

Über HTTP:

```bash
curl "$REBASE_URL/api/data/posts?limit=10"
```

Oder mit dem typsicheren Client, der bereits eine Abhängigkeit des Headless-Scaffolds ist:

```typescript title="scripts/example.ts"
import { createRebaseClient } from "@rebasepro/client";

// The URL `rebase dev` printed, or your deployment's. `pnpm example` reads it
// from `.rebase-dev-url` when the variable is unset.
const rebase = createRebaseClient({ baseUrl: process.env.REBASE_URL! });

const { data: posts } = await rebase.data.table("posts").find({
    where: { published: ["==", true] },
    limit: 10
});
```

- [REST-API](/docs/backend/api/) – Aufbau der Endpunkte, Filter und Fehler
- [Typisiertes SDK](/docs/sdk/) – Abfragen, Auth, Realtime, Storage
- `/api/docs` – das OpenAPI-Dokument, das vom laufenden Backend bereitgestellt wird, sobald es eine Tabelle serviert, und zwar für einen angemeldeten Aufrufer (die Tabellen, die dieser sehen darf). Setzen Sie `REBASE_ENABLE_SWAGGER=true`, um es für alle zu veröffentlichen, mit der Swagger-UI unter `/api/swagger` außerhalb der Produktionsumgebung. Ein Projekt ohne Tabelle stellt keines von beiden bereit: Das Dokument wird aus den Tabellen generiert.

## `404 NO_TABLES`

Wenn jede Datenanfrage hiermit antwortet:

```json
{
  "error": {
    "message": "This project serves no tables yet. …",
    "code": "NO_TABLES"
  }
}
```

dann deklariert das Projekt keine Tabellen im Code *und* die Datenbank lieferte nichts zur Bereitstellung. Vor Version 0.31 lautete der Code `NO_COLLECTIONS`. Dies ist die erwartete erste Antwort eines Headless-Projekts, das auf eine leere Datenbank verweist. Es ist ein 404- und kein 500-Fehler, weil nichts kaputt ist – es gibt lediglich noch nichts bereitzustellen.

Drei Dinge lösen das Problem, in der Reihenfolge, in der eine Überprüfung sinnvoll ist:

1. **Die Datenbank enthält keine Tabellen.** Erstellen Sie diese – über eine Migration, einfaches SQL oder eine `defineTable`-Datei plus `rebase db push` – und starten Sie neu.
2. **Für die Tabellen ist keine Row-Level Security aktiviert**, weshalb der Startvorgang sie übersprungen hat. Das Boot-Log nennt jede einzelne mitsamt dem SQL. Aktivieren Sie RLS und fügen Sie wie oben beschrieben eine Policy hinzu. Die Antwort weist ebenfalls darauf hin: Ihre Fehlermeldung nennt die Tabellen und gibt das entsprechende `ALTER TABLE … ENABLE ROW LEVEL SECURITY` an, und `details.unprotectedTables` listet sie auf.
3. **`DATABASE_URL` verweist woanders hin**, als Sie denken. `rebase status` gibt die drei Dateien aus, die bestimmen, worauf das Backend zugreift.

## Später ein Admin-Panel hinzufügen

Nichts hier schließt Sie davon aus. Ein einziger Befehl fügt das `frontend/` hinzu, das `rebase init` ohne `--headless` erstellt hätte, mitsamt seinem Workspace und seiner App in `rebase.json`:

```bash
pnpm rebase apps add admin               # at /, or at /admin when another app is at /
pnpm rebase apps add admin --path /admin
pnpm install
pnpm run dev
```

Es schreibt das, was `rebase init` ohne `--headless` geschrieben hätte, aus denselben Templates:

- `frontend/` mit `rebaseBackendGuard()` in der Vite-Konfiguration. Der Admin rendert jede Tabelle, die das Backend bereitstellt, aus `GET /api/schema/tables`, ohne eine Datei pro Tabelle; die Anpassung für `users` wird nur dann mitgeliefert, wenn `backend/schema/users.ts` die Auth-Tabelle deklariert, wie es das Gerüst tut. Eigene Anpassungen des Panels gehören nach `frontend/src/cms/`.
- die `admin`-App in `rebase.json`, mit `cms` unter ihrem Pfad und einem Build-Befehl im Paketmanager des Projekts. Ein Projekt ohne `rebase.json` erhält eine.
- `frontend` in den `workspaces` der `package.json` und in `pnpm-workspace.yaml`.
- bei Tabellen im Code (`backend/schema/index.ts`, manuell oder per `rebase schema introspect`), die `db:push`-, `db:generate`- und `schema:generate`-Skripte des Scaffolds, der Backend-Build, der zuerst `rebase schema generate` ausführt, sowie `ts-morph`. Ein von Ihnen geändertes Skript wird beibehalten und namentlich genannt.

Jedes `@rebasepro/*`-Paket wird auf die Version festgelegt, die das Projekt bereits verwendet (an erster Stelle sein `@rebasepro/server`), nicht auf die der CLI. Ein Projekt, das nur `link:`- oder `workspace:`-Spezifikationen festlegt, erhält die Version der CLI und wird darüber informiert.

Der Vorgang wird abgelehnt, wenn `frontend/` bereits existiert, wenn eine App bereits `admin` heißt oder das CMS deklariert, oder wenn `--path` bereits vergeben ist bzw. keinen Pfad darstellt, unter dem eine App bereitgestellt werden kann. Eine Verweigerung ändert nichts, und ebenso wenig ein Schreibvorgang, der mittendrin fehlschlägt: Alle Dateien werden zurückgesetzt. Mit `--json` wird ausgegeben, was geschrieben wurde, oder das Fehler-Envelope angezeigt. Siehe [Frontend-Einrichtung](/docs/frontend/) für das Frontend selbst.

## Nächste Schritte

- [Authentifizierung](/docs/backend/authentication/) – Provider, Tokens, API-Schlüssel
- [Row-Level Security](/docs/collections/security-rules/) – das Zugriffsmodell
- [Custom Functions](/docs/backend/custom-functions/) – Ihre eigenen Routen
- [Deployment](/docs/getting-started/deployment/) – Bereitstellung für die Produktion
