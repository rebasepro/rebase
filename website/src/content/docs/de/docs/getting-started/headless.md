---
sourceHash: 8e1555899998c46c
title: Nur Backend (Headless)
sidebar_label: Nur Backend
description: Führen Sie Rebase als Headless Backend-as-a-Service über Ihrer eigenen PostgreSQL-Datenbank aus — eine REST-API, Authentifizierung, Storage und Realtime, ganz ohne Admin-Panel und ohne Collection-Dateien.
---

Rebase gibt es in zwei Varianten, und diese Seite beschreibt jene, die niemals einen Browser öffnet: eine
REST-API, Authentifizierung, Storage, Realtime und Backups über einer bereits vorhandenen
PostgreSQL-Datenbank. Kein Admin-Panel, keine Collection-Dateien. Wenn Sie eigentlich
Supabase oder PostgREST in Betracht gezogen haben, ist dies das vergleichbare Pendant.

Alles auf dieser Seite funktioniert auch im vollständigen Projekt — es handelt sich um denselben Server.
Was `--headless` entfernt, ist das Frontend-Paket und die Collection-Dateien, nicht
aber eine Funktionalität.

## Projekt gerüsten (Scaffolding)

```bash
pnpm dlx @rebasepro/cli init my-api --headless --yes
cd my-api
```

Zwei Workspaces, kein `frontend/`:

| Ordner | Was darin enthalten ist |
|--------|-------------------------|
| `backend/` | Ihre benutzerdefinierten Funktionen und Cronjobs. Es gibt keine Server-Datei — die veröffentlichte Runtime startet das Projekt |
| `config/` | `storageAuthorize` und alle Collections, die `--introspect` generiert |

`--template` hat hier keine Auswirkung: Ein Preset befüllt Collection-Dateien, und diese
Variante hat keine. Node 22.22+, dieselbe Mindestanforderung wie beim vollständigen Projekt — das
`package.json` des Headless-Overlays deklariert `"node": ">=22.22.0"` und ersetzt das darunterliegende.

## Auf Ihre Datenbank verweisen

`init` generiert eine sofort einsatzbereite `.env`. Um eine Datenbank zu nutzen, die Sie bereits betreiben,
übergeben Sie deren URL beim Erstellen des Gerüsts:

```bash
pnpm dlx @rebasepro/cli init my-api --headless --database-url "postgres://user:pass@host:5432/db" --yes
```

Oder setzen Sie `DATABASE_URL` anschließend in der `.env` — das Ergebnis ist dasselbe. Ohne
`DATABASE_URL` startet `rebase dev` eine verwaltete PostgreSQL (PGlite) im Projektverzeichnis,
was zum Ausprobieren der API nützlich ist, aber nicht dem Zweck dieser Variante entspricht.

Anschließend:

```bash
pnpm install
pnpm run dev
```

**Lesen Sie die URL aus der Ausgabe ab.** `rebase dev` leitet einen freien Port aus dem
Pfad des Projekts ab, anstatt einen festen zu verwenden, weshalb er sich von Projekt zu Projekt
und von Maschine zu Maschine unterscheidet.

## Woher die Collections stammen

Im Code gibt es keine. Der Server liest Ihr Datenbankschema beim Start aus und stellt
die gefundenen Tabellen bereit, sodass die API Ihren Migrationen folgt: Ändern Sie das Schema,
ändern sich auch die Endpunkte entsprechend.

Eine Tabelle wird bereitgestellt, sobald Row-Level Security auf ihr aktiviert ist. Ohne Policy
wird sie zwar bereitgestellt, gibt aber keine Zeilen zurück, worüber beim Start gewarnt wird; eine Policy öffnet sie:

```sql
ALTER TABLE your_table ENABLE ROW LEVEL SECURITY;
-- rebase.uid() is text: the cast makes this work for a uuid or integer column too.
CREATE POLICY your_table_owner ON your_table
    FOR ALL USING (user_id::text = rebase.uid());
```

`rebase.uid()`, `rebase.roles()` und `rebase.jwt()` werden von Rebase installiert und
lesen die Identität der authentifizierten Anfrage aus. Siehe
[Sicherheitsregeln](/docs/collections/security-rules/) für das Policy-Vokabular
und [rls-check](/docs/rls-check/) für ein Audit darüber, was Ihre Policies tatsächlich
erlauben.

Eine Tabelle ohne RLS wird ganz bewusst **übersprungen**: Jede authentifizierte Anfrage
wird als `rebase_user` ausgeführt. Würde eine Tabelle bereitgestellt, die nicht durch Row-Level Security
geschützt ist, hätte jeder angemeldete Aufrufer Zugriff auf jede Zeile. Jede übersprungene Tabelle wird beim Start zusammen mit dem SQL-Befehl genannt,
der sie schützen würde.

Eine Join-Tabelle wird in keinem Fall bereitgestellt, da sie niemals zu einer Collection wird.
Eine Join-Tabelle mit deaktiviertem RLS wird beim Start ebenfalls genannt.

Die Prüfung läuft beim Booten. Wird RLS auf einer bereitgestellten Tabelle später deaktiviert,
bleibt sie bis zum nächsten Start bereitgestellt, der sie dann überspringt. Das [geplante Audit](/docs/rls-check/)
meldet dies früher und ist standardmäßig deaktiviert.

:::note
`baas: { unprotectedTables: "serve" }` stellt sie dennoch bereit. Dies ist eine
Option von `initializeRebaseBackend`, die erst nach `rebase eject` erreichbar ist —
die verwaltete Runtime liest sie weder aus `config/index.ts` noch aus der
Umgebung. Dies ist nur dann sinnvoll, wenn jedem Aufrufer bereits vertraut wird.
:::

### Stattdessen Collection-Dateien generieren

Wenn Sie die Tabellen lieber als TypeScript festgehalten haben möchten — für Typen, für
Callbacks, für Code-Reviews —, können Sie diese introspektieren:

```bash
pnpm dlx @rebasepro/cli init my-api --headless --database-url "postgres://…" --introspect --install
```

`--introspect` impliziert `--template blank` und erfordert `--install`, da es
gegen die installierte CLI ausgeführt wird. In einem bestehenden Projekt lautet der Befehl:

```bash
pnpm rebase schema introspect
```

Die Dateien landen in `config/collections/`. Ab diesem Zeitpunkt verfügt das Projekt über Collections
im Code, und die Introspektion beim Start bestimmt nicht mehr die API.

Das Headless-Gerüst
installiert Atlas in `backend/`, sodass `rebase db push`, `rebase db generate`
und `pnpm run db:migrate` auf diesen Collections wie in jedem anderen Projekt funktionieren.

## Verwendung

Über HTTP:

```bash
curl "$REBASE_URL/api/data/posts?limit=10"
```

Oder mit dem typsicheren Client, der im Headless-Gerüst bereits als Abhängigkeit enthalten ist:

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

- [REST-API](/docs/backend/api/) — die Endpunkt-Formate, Filter und Fehler
- [Typisiertes SDK](/docs/sdk/) — Abfragen, Authentifizierung, Realtime, Storage
- `/api/docs` und `/api/swagger` — das OpenAPI-Dokument und dessen Viewer, die
  vom laufenden Backend bereitgestellt werden, sobald es eine Collection gibt. Ein Projekt ohne Collections liefert
  keines von beiden aus: Das Dokument wird aus den Collections generiert, weshalb es nichts
  zu beschreiben gibt, bis der obige Abschnitt ausgeführt wurde

## `404 NO_COLLECTIONS`

Wenn jede Datenanfrage mit Folgendem antwortet:

```json
{
  "error": {
    "message": "This project serves no collections yet. …",
    "code": "NO_COLLECTIONS"
  }
}
```

dann deklariert das Projekt keine Collections im Code *und* die Datenbank lieferte
nichts, woraus sie abgeleitet werden könnten. Dies ist die erwartete erste Antwort eines Headless-Projekts,
das auf eine leere Datenbank verweist. Es handelt sich um einen 404- und nicht um einen 500-Fehler,
da nichts defekt ist — es gibt schlichtweg noch nichts bereitzustellen.

Drei Dinge können dies beheben, in sinnvoller Prüfreihenfolge:

1. **Die Datenbank hat keine Tabellen.** Erstellen Sie diese — über eine Migration, einfaches SQL oder eine
   Collection-Datei plus `rebase db push` — und starten Sie neu.
2. **Auf den Tabellen ist Row-Level Security nicht aktiviert**, weshalb der Start sie
   übersprungen hat. Das Startprotokoll nennt jede einzelne davon samt SQL. Aktivieren Sie RLS und fügen Sie eine Policy hinzu,
   wie oben beschrieben. Auch die
   Antwort weist darauf hin: Ihre Fehlermeldung nennt die Tabellen und liefert das passende
   `ALTER TABLE … ENABLE ROW LEVEL SECURITY` mit, und
   `details.unprotectedTables` listet sie auf.
3. **`DATABASE_URL` verweist auf ein anderes Ziel** als vermutet. `rebase status`
   gibt die drei Dateien aus, die bestimmen, was das Backend erreicht.

## Später ein Admin-Panel hinzufügen

Nichts hier hindert Sie daran. Fügen Sie ein Verzeichnis `config/collections/` hinzu —
manuell oder mit `rebase schema introspect` — sowie ein Frontend, das diese darstellt; das
Backend ändert sich nicht. [Frontend-Einrichtung](/docs/frontend/) ist der Ausgangspunkt dafür.

## Nächste Schritte

- [Authentifizierung](/docs/backend/authentication/) — Provider, Tokens, API-Schlüssel
- [Sicherheitsregeln (RLS)](/docs/collections/security-rules/) — das Zugriffsmodell
- [Benutzerdefinierte Funktionen](/docs/backend/custom-functions/) — Ihre eigenen Routen
- [Bereitstellung](/docs/getting-started/deployment/) — der Schritt in die Produktion
