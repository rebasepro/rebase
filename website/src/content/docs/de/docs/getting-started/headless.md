---
sourceHash: 213cc853c469bd0c
title: Nur Backend (Headless)
sidebar_label: Nur Backend
description: Betreiben Sie Rebase als headless Backend-as-a-Service über Ihrer eigenen PostgreSQL-Datenbank – eine REST-API, Authentifizierung, Storage und Echtzeitfunktionen, ohne Admin-Panel und ohne Collection-Dateien.
---

Rebase gibt es in zwei Varianten, und diese Seite beschreibt diejenige, die niemals
einen Browser öffnet: eine REST-API, Authentifizierung, Storage, Echtzeitfunktionen
und Backups über eine bereits vorhandene PostgreSQL-Datenbank. Kein Admin-Panel,
keine Collection-Dateien. Wenn Sie bisher Supabase oder PostgREST in Betracht
gezogen haben, ist dies das vergleichbare Pendant.

Alles auf dieser Seite funktioniert auch im vollständigen Projekt – es handelt
sich um denselben Server. Was `--headless` entfernt, ist das Frontend-Package
und die Collection-Dateien, keine Funktionalität.

## Gerüst erstellen

```bash
pnpm dlx @rebasepro/cli init my-api --headless --yes
cd my-api
```

Zwei Workspaces, kein `frontend/`:

| Ordner | Was darin enthalten ist |
|--------|-------------------------|
| `backend/` | Ihre benutzerdefinierten Funktionen und Crons. Es gibt keine Server-Datei – die veröffentlichte Runtime startet das Projekt |
| `config/` | `storageAuthorize` und alle Collections, die `--introspect` generiert |

`--template` hat hier keine Auswirkung: Ein Preset befüllt Collection-Dateien,
und diese Variante hat keine. Node 22.22+, dieselbe Mindestanforderung wie beim
vollständigen Projekt – die `package.json` des Headless-Overlays deklariert
`"node": ">=22.22.0"` und ersetzt die darunterliegende.

## Mit Ihrer Datenbank verbinden

`init` generiert eine sofort einsatzbereite `.env`. Um eine Datenbank zu nutzen,
die Sie bereits betreiben, übergeben Sie deren URL beim Erstellen des Gerüsts:

```bash
pnpm dlx @rebasepro/cli init my-api --headless --database-url "postgres://user:pass@host:5432/db" --yes
```

Oder setzen Sie `DATABASE_URL` nachträglich in der `.env` – das macht keinen
Unterschied. Ohne `DATABASE_URL` startet `rebase dev` eine verwaltete
PostgreSQL-Instanz (PGlite) im Projektverzeichnis, was zum Ausprobieren der API
nützlich ist, aber nicht dem Zweck dieser Variante entspricht.

Danach:

```bash
pnpm install
pnpm run dev
```

**Lesen Sie die URL aus der Ausgabe ab.** `rebase dev` leitet einen freien Port
aus dem Pfad des Projekts ab, anstatt einen festen zu verwenden, sodass er sich
zwischen Projekten und Rechnern unterscheidet.

## Woher die Collections stammen

Im Code gibt es keine. Der Server liest Ihr Datenbankschema beim Start ein und
stellt die gefundenen Tabellen bereit, sodass die API Ihren Migrationen folgt:
Ändern Sie das Schema, ändern sich die Endpunkte automatisch mit.

Eine Tabelle wird bereitgestellt, sobald sie über ein Autorisierungsmodell
verfügt – Row-Level Security aktiviert, plus mindestens eine Policy:

```sql
ALTER TABLE your_table ENABLE ROW LEVEL SECURITY;
CREATE POLICY your_table_owner ON your_table
    FOR ALL USING (user_id = rebase.uid());
```

`rebase.uid()`, `rebase.roles()` und `rebase.jwt()` werden von Rebase
installiert und lesen die Identität der authentifizierten Anfrage aus. Siehe
[Security Rules](/docs/collections/security-rules/) für das Policy-Vokabular
und [rls-check](/docs/rls-check/) für ein Audit darüber, was Ihre Policies
tatsächlich erlauben.

Eine Tabelle ohne RLS wird ganz bewusst **übersprungen**: Jede authentifizierte
Anfrage wird als `rebase_user` ausgeführt. Das Bereitstellen einer Tabelle ohne
Policy würde somit jede Zeile an jeden angemeldeten Aufrufer übergeben. Jede
übersprungene Tabelle wird beim Start zusammen mit dem SQL benannt, das sie
schützen würde.

:::note
`baas: { unprotectedTables: "serve" }` stellt sie trotzdem bereit. Dies ist eine
Option von `initializeRebaseBackend`, die erst nach `rebase eject` erreichbar
ist – die verwaltete Runtime liest sie weder aus `config/index.ts` noch aus der
Umgebung aus. Nur sinnvoll, wenn jedem Aufrufer bereits vertraut wird.
:::

### Stattdessen Collection-Dateien generieren

Wenn Sie die Tabellen lieber als TypeScript festgeschrieben haben möchten – für
Typen, für Callbacks, für Reviews –, können Sie sie per Introspektion erfassen:

```bash
pnpm dlx @rebasepro/cli init my-api --headless --database-url "postgres://…" --introspect --install
```

`--introspect` impliziert `--template blank` und erfordert `--install`, da es
gegen die installierte CLI ausgeführt wird. In einem bestehenden Projekt
entspricht dies Folgendem:

```bash
pnpm rebase schema introspect
```

Die Dateien landen in `config/collections/`. Ab diesem Zeitpunkt verfügt das
Projekt über Collections im Code, und die Introspektion beim Start bestimmt
nicht mehr die API.

## Verwendung

Über HTTP:

```bash
curl "$REBASE_URL/api/data/posts?limit=10"
```

Oder mit dem typsicheren Client, der bereits eine Abhängigkeit des
Headless-Scaffolds ist:

```typescript title="scripts/example.ts"
import { createRebaseClient } from "@rebasepro/client";

// The URL `rebase dev` printed, or your deployment's. `pnpm example` reads it
// from `.rebase-dev-url` when the variable is unset.
const rebase = createRebaseClient({ baseUrl: process.env.REBASE_URL! });

const { data: posts } = await rebase.data.collection("posts").find({
    where: { published: ["==", true] },
    limit: 10
});
```

- [REST-API](/docs/backend/api/) – die Endpunkt-Formate, Filter und Fehler
- [Client-SDK](/docs/sdk/) – Abfragen, Authentifizierung, Echtzeit, Storage
- `/api/docs` und `/api/swagger` – das OpenAPI-Dokument und dessen Viewer,
  bereitgestellt vom laufenden Backend, sobald es eine Collection hat. Ein
  Projekt ohne Collections liefert keines von beidem: Das Dokument wird aus den
  Collections generiert, daher gibt es nichts zu beschreiben, bis der obige
  Abschnitt ausgeführt wurde

## `404 NO_COLLECTIONS`

Wenn jede Datenanfrage hiermit antwortet:

```json
{
  "error": {
    "message": "This project serves no collections yet. …",
    "code": "NO_COLLECTIONS"
  }
}
```

dann deklariert das Projekt keine Collections im Code *und* die Datenbank
lieferte keine Daten, aus denen sie abgeleitet werden könnten. Dies ist die
erwartete erste Antwort eines Headless-Projekts, das auf eine leere Datenbank
verweist, und es handelt sich um einen 404- statt eines 500-Fehlers, da nichts
kaputt ist – es gibt schlicht noch nichts bereitzustellen.

Drei Schritte beheben dies, in der empfohlenen Prüfreihenfolge:

1. **Die Datenbank hat keine Tabellen.** Erstellen Sie diese – per Migration,
   einfachem SQL oder einer Collection-Datei plus `rebase db push` – und starten
   Sie neu.
2. **Die Tabellen haben keine RLS-Policy**, weshalb sie beim Start übersprungen
   wurden. Das Startprotokoll nennt jede einzelne davon. Fügen Sie eine Policy
   hinzu, wie oben beschrieben.
3. **`DATABASE_URL` verweist auf ein anderes Ziel** als gedacht. `rebase status`
   gibt die drei Dateien aus, die bestimmen, was das Backend erreicht.

## Später ein Admin-Panel hinzufügen

Nichts hier schließt Sie davon aus. Fügen Sie ein `config/collections/`-Verzeichnis
hinzu – manuell oder mit `rebase schema introspect` – und ein Frontend, das diese
rendert; das Backend ändert sich dadurch nicht. Unter
[Frontend-Einrichtung](/docs/frontend/) geht es damit los.

## Nächste Schritte

- [Authentifizierung](/docs/backend/authentication/) – Provider, Tokens, API-Schlüssel
- [Sicherheitsregeln (RLS)](/docs/collections/security-rules/) – das Zugriffsmodell
- [Benutzerdefinierte Funktionen](/docs/backend/custom-functions/) – eigene Routen
- [Bereitstellung](/docs/getting-started/deployment/) – der Weg in die Produktion

---
