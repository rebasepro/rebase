---
sourceHash: 9cda7971a27b0475
title: Backend only (headless)
sidebar_label: Backend only
description: Führen Sie Rebase als headless Backend-as-a-Service über Ihrer eigenen PostgreSQL-Datenbank aus – eine REST-API, Auth, Storage und Realtime, ohne Admin-Panel und ohne backend/schema/.
---

Rebase gibt es in zwei Varianten, und diese Seite beschreibt diejenige, die niemals einen Browser öffnet: eine
REST-API, Auth, Storage, Realtime und Backups über eine PostgreSQL-Datenbank,
die Sie bereits besitzen. Kein Admin-Panel, kein `backend/schema/`. Wenn Sie
Supabase oder PostgREST in Betracht gezogen haben, ist dies das vergleichbare Äquivalent.

Alles auf dieser Seite funktioniert auch im vollständigen Projekt – es ist derselbe Server.
Was `--headless` entfernt, ist das Frontend-Paket und die Tabellendateien, nicht
der Funktionsumfang.

## Grundgerüst erstellen

```bash
pnpm dlx @rebasepro/cli init my-api --headless --yes
cd my-api
```

Ein Workspace, kein `frontend/`:

| Ordner | Was darin enthalten ist |
|--------|-------------------------|
| `backend/` | `storage.ts` (`storageAuthorize`), Ihre benutzerdefinierten Funktionen und Crons sowie das `backend/schema/`, das `--introspect` schreibt, wenn Sie es anfordern. Es gibt keine Server-Datei – die veröffentlichte Runtime startet das Projekt |

`--template` hat hier keine Auswirkung: Ein Preset initialisiert Tabellen, und diese Variante hat
keine. Node 22.22+, dieselbe Mindestanforderung wie beim vollständigen Projekt – die `package.json`
des Headless-Overlays deklariert `"node": ">=22.22.0"` und ersetzt die
darunterliegende.

## Mit Ihrer Datenbank verbinden

`init` generiert eine betriebsbereite `.env`. Um eine Datenbank zu verwenden, die Sie bereits betreiben, übergeben
Sie deren URL beim Erstellen des Gerüsts:

```bash
pnpm dlx @rebasepro/cli init my-api --headless --database-url "postgres://user:pass@host:5432/db" --yes
```

Oder setzen Sie `DATABASE_URL` nachträglich in der `.env` – das Ergebnis ist dasselbe. Ohne
`DATABASE_URL` startet `rebase dev` eine verwaltete PostgreSQL-Instanz (PGlite) im Projektverzeichnis,
was nützlich ist, um die API auszuprobieren, aber nicht der eigentliche Zweck dieser
Variante ist.

Anschließend:

```bash
pnpm install
pnpm run dev
```

**Lesen Sie die URL aus der Ausgabe ab.** `rebase dev` leitet einen freien Port vom
Pfad des Projekts ab, anstatt einen festen zu verwenden, sodass er sich von Projekt zu Projekt und
zwischen verschiedenen Rechnern unterscheidet.

## Woher die Tabellen stammen

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Im Code gibt es keine: Ohne `backend/schema/index.ts` deklariert das Backend keine Tabellen. Der Server liest Ihr Datenbankschema beim Start ein und stellt
die gefundenen Tabellen bereit, sodass die API Ihren Migrationen folgt: Ändern Sie das Schema, und
die Endpunkte ändern sich mit ihm.

Eine Tabelle wird bereitgestellt, sobald Row-Level Security auf ihr aktiviert ist. Ohne Policy wird
sie bereitgestellt und gibt keine Zeilen zurück, worüber beim Start gewarnt wird; eine Policy öffnet sie:

```sql
ALTER TABLE your_table ENABLE ROW LEVEL SECURITY;
-- rebase.uid() is text: the cast makes this work for a uuid or integer column too.
CREATE POLICY your_table_owner ON your_table
    FOR ALL USING (user_id::text = rebase.uid());
```

`rebase.uid()`, `rebase.roles()` und `rebase.jwt()` werden von Rebase installiert und
lesen die Identität der authentifizierten Anfrage aus. Siehe
[Row-Level Security](/docs/collections/security-rules/) für das Policy-Vokabular
und [rls-check](/docs/rls-check/) für ein Audit dessen, was Ihre Policies tatsächlich
erlauben.

Eine Tabelle ohne RLS wird ganz bewusst **übersprungen**: Jede authentifizierte Anfrage
wird als `rebase_user` ausgeführt, sodass die Bereitstellung einer Tabelle, die nicht durch Row-Level Security geschützt ist,
jede Zeile an jeden angemeldeten Aufrufer übergeben würde. Jede übersprungene Tabelle wird beim Start zusammen mit dem SQL
genannt, das sie schützen würde.

Eine Join-Tabelle wird so oder so nicht bereitgestellt: Sie wird als Verknüpfung zwischen den beiden
Tabellen gelesen, die sie verbindet. Eine Join-Tabelle mit deaktiviertem RLS wird beim Start ebenfalls genannt.

Die Prüfung läuft beim Start. Wird RLS bei einer bereitgestellten Tabelle später deaktiviert, bleibt sie weiterhin
bereitgestellt, bis der nächste Start sie überspringt. Das [geplante Audit](/docs/rls-check/)
meldet dies früher und ist standardmäßig deaktiviert.

:::note
`baas: { unprotectedTables: "serve" }` stellt sie trotzdem bereit. Dies ist eine
`initializeRebaseBackend`-Option, sie ist also erst nach einem `rebase eject` erreichbar –
die verwaltete Runtime liest sie weder aus einer Datei noch aus der Umgebung aus. Nur dann sinnvoll, wenn jeder Aufrufer bereits vertrauenswürdig ist.
:::

### Stattdessen Tabellendateien generieren

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Wenn Sie die Tabellen lieber als TypeScript festgehalten haben möchten – für Typen, für
Hooks, für Code-Reviews –, können Sie sie introspektieren:

```bash
pnpm dlx @rebasepro/cli init my-api --headless --database-url "postgres://…" --introspect --install
```

`--introspect` impliziert `--template blank` und erfordert `--install`, da es
über die installierte CLI ausgeführt wird. In einem bestehenden Projekt entspricht dies folgendem:

```bash
pnpm rebase schema introspect
```

Die Dateien landen in `backend/schema/`: ein `defineTable` pro Tabelle mit ihren Spalten,
Relationen und ihren Policies als `rls`, sowie eine `index.ts`, die sie exportiert. Ab
diesem Zeitpunkt verfügt das Projekt über Tabellen im Code, und die Introspektion beim Start bestimmt
nicht mehr die API.

Das Headless-Gerüst
installiert Atlas in `backend/`, sodass `rebase db push`, `rebase db generate`
und `pnpm run db:migrate` auf diesen Tabellen wie in jedem Projekt funktionieren.

## Verwendung

Über HTTP:

```bash
curl "$REBASE_URL/api/data/posts?limit=10"
```

Oder mit dem typsicheren Client, der bereits eine Dependency des Headless-Gerüsts
ist:

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

- [REST-API](/docs/backend/api/) – die Endpunkt-Formate, Filter und Fehler
- [Typisiertes SDK](/docs/sdk/) – Abfragen, Auth, Realtime, Storage
- `/api/docs` – das OpenAPI-Dokument, das vom laufenden Backend für einen angemeldeten Aufrufer
  bereitgestellt wird, sobald es eine Tabelle bereitstellt (die Tabellen, die der Aufrufer sehen darf). Setzen Sie
  `REBASE_ENABLE_SWAGGER=true`, um es für alle zu veröffentlichen, mit der Swagger-UI
  unter `/api/swagger` außerhalb der Produktionsumgebung. Ein Projekt ohne Tabellen stellt
  keines von beiden bereit: Das Dokument wird aus den Tabellen generiert

## `404 NO_TABLES`

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Wenn jede Datenanfrage hiermit antwortet:

```json
{
  "error": {
    "message": "This project serves no tables yet. …",
    "code": "NO_TABLES"
  }
}
```

dann deklariert das Projekt keine Tabellen im Code *und* die Datenbank lieferte
nichts, was bereitgestellt werden könnte. Vor 0.31 lautete der Code `NO_COLLECTIONS`. Dies ist die erwartete erste Antwort eines Headless-Projekts,
das auf eine leere Datenbank verweist, und es ist ein 404-Fehler statt eines 500-Fehlers, weil
nichts fehlerhaft ist – es gibt schlichtweg noch nichts bereitzustellen.

Drei Dinge beheben dies, in der Reihenfolge, in der sie geprüft werden sollten:

1. **Die Datenbank enthält keine Tabellen.** Erstellen Sie diese – über eine Migration, reines SQL oder eine
   `defineTable`-Datei plus `rebase db push` – und starten Sie neu.
2. **Für die Tabellen ist keine Row-Level Security aktiviert**, sodass der Start sie übersprungen
   hat. Das Start-Log nennt jede einzelne mitsamt dem SQL. Aktivieren Sie RLS und fügen Sie eine Policy hinzu,
   wie oben beschrieben. Die
   Antwort weist ebenfalls darauf hin: Ihre Meldung nennt die Tabellen und liefert das
   `ALTER TABLE … ENABLE ROW LEVEL SECURITY` für sie, und
   `details.unprotectedTables` listet sie auf.
3. **`DATABASE_URL` verweist auf ein anderes Ziel**, als Sie annehmen. `rebase status`
   gibt die drei Dateien aus, die bestimmen, worauf das Backend zugreift.

## Später ein Admin-Panel hinzufügen

Nichts hindert Sie daran, dies später zu tun. Fügen Sie ein `frontend/` hinzu, das `<RebaseCMS />` einbindet:
Es rendert jede vom Backend bereitgestellte Tabelle aus `GET /api/schema/tables`,
ohne eine separate Datei pro Tabelle. Erstellen Sie `backend/schema/` – von Hand oder mit
`rebase schema introspect` –, wenn Sie die Tabellen im Code haben möchten; die Anpassungen des Panels
selbst gehören nach `frontend/src/cms/`. [Frontend Setup](/docs/frontend/) ist der Ausgangspunkt dafür.

## Nächste Schritte

- [Authentifizierung](/docs/backend/authentication/) – Provider, Tokens, API-Keys
- [Row-Level Security](/docs/collections/security-rules/) – das Zugriffsmodell
- [Custom Functions](/docs/backend/custom-functions/) – eigene Routen
- [Deployment](/docs/getting-started/deployment/) – der Weg in die Produktion
