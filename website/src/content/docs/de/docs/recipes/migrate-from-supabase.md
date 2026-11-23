---
sourceHash: 4acb34e54a96f397
title: "Rezept: Migration von Supabase"
sidebar_label: Migration von Supabase
description: "Migrieren Sie ein Supabase-Projekt zu Rebase: Schema introspektieren, SQL-Objekte anwenden, die keine Tabellen sind, Daten unter Beibehaltung der Benutzer-IDs kopieren, Edge Functions portieren und deployen – alles über das CLI."
---

## Übersicht

Dies migriert ein Supabase-Projekt (Tabellen, Row-Level-Security, SQL-Funktionen und -Trigger, Benutzer, einen Storage-Bucket, Edge Functions) zu einem Rebase-Projekt – zuerst lokal und anschließend auf [Rebase Cloud](/docs/deployment/cloud/). Alles erfolgt über CLI-Befehle. Wenn Sie die Supabase-Datenbank weiterhin verwenden möchten, anstatt sie zu verlassen, lesen Sie [Supabase](/docs/deployment/existing-database/#supabase) auf der Seite zu bestehenden Datenbanken.

Die Reihenfolge ist wichtig: Generieren Sie die Tabellen aus der **Quelle** und richten Sie das Projekt dann auf das **Ziel** aus, bevor Schreibvorgänge stattfinden.

## 1. Tabellen generieren

Introspektieren Sie die Supabase-Datenbank oder eine lokale Kopie davon. `SUPABASE_DB_URL` unten ist deren direkter Connection-String für die Rolle `postgres` (Supabase-Dashboard: Connect → Direct connection); setzen Sie diese Variable zuerst in Ihrer Shell:

```bash
SUPABASE_DB_URL="postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres"
rebase schema introspect --database-url "$SUPABASE_DB_URL" --from supabase
```

`--from supabase` übersetzt, was eine Rebase-Datenbank nicht hat:

| In Supabase | Geschrieben als |
|---|---|
| `owner_id uuid default auth.uid()` | `col.text().onCreateUser().userId()`: Der Server schreibt die ID des Aufrufers |
| `owner_id uuid references auth.users(id)` | `col.text().userId()` und der Fremdschlüssel wird unter „Nicht übernommen“ aufgeführt |
| `auth.uid()` in einer Policy | `rebase.uid()` |
| `TO authenticated` / `TO anon` | Die Rolle wird verworfen und die Regel erfordert einen angemeldeten / abgemeldeten Aufrufer |
| Eine Policy nur `TO service_role` | Verworfen: Servercode wird im eigenen Kontext des Servers ausgeführt |
| Einfache Indizes | `indexes` der Tabelle |

Benutzer-ID-Spalten werden zu `text`, da `rebase.users.id` und `rebase.uid()` Text sind: Ein Vergleich einer `uuid`-Spalte mit `rebase.uid()` in einer Policy schlägt fehl.

Der Durchlauf endet mit einer Liste der Dinge, die **nicht** übernommen wurden (Funktionen, Trigger, Extensions, CHECK-Constraints, sonstige Indizes, zusammengesetzte Fremdschlüssel), und schreibt das entsprechende SQL nach `backend/sql/_introspected-left-behind.sql`, einen Entwurf, den `rebase db push` erst anwendet, wenn Sie ihn umbenennen.

## 2. Projekt auf die neue Datenbank ausrichten

`DATABASE_URL` verweist nach Schritt 1 immer noch auf Supabase, worauf die Introspect-Ausgabe auch hinweist. Ändern Sie dies (oder entfernen Sie die Variable, um die verwaltete Entwicklungsdatenbank zu nutzen), bevor Sie den ersten Push durchführen:

```bash
rebase db push
```

## 3. SQL-Objekte anwenden

Bearbeiten Sie `backend/sql/_introspected-left-behind.sql` analog zur Anpassung der Tabellen: `auth.uid()` → `rebase.uid()`, `auth.users` → `rebase.users`, kein `GRANT … TO anon, authenticated`. Funktionen, die `pg_net` aufgerufen haben, eignen sich besser als [Custom Function](/docs/backend/custom-functions/). Machen Sie jede Anweisung gefahrlos wiederholbar (`DROP TRIGGER IF EXISTS` vor jedem `CREATE TRIGGER`), benennen Sie die Datei dann ohne das führende `_` um und pushen Sie:

```bash
mv backend/sql/_introspected-left-behind.sql backend/sql/introspected.sql
rebase db push
```

`rebase db push` wendet jede `.sql`-Datei in `backend/sql` in Namensreihenfolge an, nach den Tabellen und vor den Policies, und erfasst jede per Hash in `rebase.sql_files`, sodass eine Datei nur erneut läuft, wenn sie sich ändert. Ein Deploy wendet sie genauso an (Schritt 8).

Eine Funktion, die der Browser mit `supabase.rpc('fn')` aufgerufen hat, wird mit [`defineRpc`](/docs/backend/rpc/) neben den Tabellen deklariert. Sie wird dann unter `POST /api/rpc/<name>` bereitgestellt und als Aufrufer unter Row-Level-Security ausgeführt, sodass sich eine `SECURITY DEFINER`-Funktion wie in Supabase verhält:

```ts
// backend/schema/rpc.ts, exported from backend/schema/index.ts
import { defineRpc, json } from "@rebasepro/server/schema";

export const getPublicProposal = defineRpc("get_public_proposal", {
    access: "public",                         // supabase's anon key; "authenticated" for signed-in only
    args: { token: json.string().required() } // validated before the function runs
});
```

```ts
// in the browser: supabase.rpc("get_public_proposal", { token })
const proposal = await rebase.rpc("get_public_proposal", { token });
```

Nur deklarierte Funktionen können aufgerufen werden, und jede mit `public` ist ratenbegrenzt. Eine schreibende Funktion benötigt `write: true`.

## 4. Daten unter Beibehaltung der Benutzer-IDs kopieren

Behalten Sie die Supabase-Benutzer-IDs bei, damit jede `owner_id` weiterhin auf ihren Benutzer verweist: Importieren Sie zuerst die Benutzer mit ihren IDs und danach die Anwendungstabellen. `rebase users import` erstellt die Konten mit den bestehenden IDs, ohne Passwort und ohne E-Mail-Versand, und überspringt Konten, deren ID oder E-Mail bereits vorhanden ist, sodass der Befehl wiederholt ausgeführt werden kann. Er erreicht Rebase Cloud wie jeder andere `rebase users`-Befehl (`--project <slug>` oder `--cloud` in einem verknüpften Verzeichnis).

```bash
SUPABASE_DB_URL="postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres"
psql "$SUPABASE_DB_URL" -c "\copy (select id, email, created_at, email_confirmed_at is not null as email_verified from auth.users) to users.csv csv header"
rebase users import users.csv --dry-run
rebase users import users.csv
```

Der Befehl meldet für jedes Konto, ob es erstellt, übersprungen oder fehlgeschlagen ist (mit Grund), und beendet mit Exit-Code 1, falls Fehler auftraten. Siehe [Konten importieren](/docs/cli/project/#importing-accounts) für die Spalten, die gelesen werden (auch `display_name` und `roles`).

Anschließend die Anwendungstabellen mittels `pg_dump` für die Quelle und das Ziel. `TARGET_URL` ist der Connection-String der neuen Datenbank: Ihre `DATABASE_URL` oder auf Rebase Cloud der `connectionString`, den `rebase cloud db connect --reveal` während der Ausführung ausgibt.

```bash
SUPABASE_DB_URL="postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres"
TARGET_URL="postgresql://…"   # the new database: your DATABASE_URL, or the tunnel's URL on Rebase Cloud
pg_dump "$SUPABASE_DB_URL" --data-only --schema=public --no-owner > data.sql
psql "$TARGET_URL" -f data.sql
```

Passwörter werden nicht übertragen. Ein importierter Benutzer meldet sich mit einem Magic-Link, einem E-Mail-Code oder einem Passwort-Reset an – unter derselben ID wie zuvor.

## 5. Storage

Ein öffentlicher Supabase-Bucket entspricht einer [Storage-Quelle](/docs/backend/storage/) mit Pfaden unter `public/`, die ohne Token ausgeliefert werden. Kopieren Sie die Objekte mit einem beliebigen S3-Client unter Beibehaltung ihrer Keys.

## 6. Edge Functions

Eine Deno Edge Function wird zu einer [Custom Function](/docs/backend/custom-functions/) in `backend/functions/`. Die üblichen Ersetzungen:

| Supabase | Rebase |
|---|---|
| `Deno.serve(handler)` | `defineFunction((app) => app.post("/", handler))` |
| `Deno.env.get("X")` | `requireEnv(c, "X")` innerhalb des Handlers |
| `createClient(url, serviceRoleKey)` | `rebase.dataAsAdmin` oder `rebase.sql` auf dem Server |
| Ein Client mit dem JWT des Benutzers | `getSql(c)`: SQL als Aufrufer unter Row-Level-Security |
| `EdgeRuntime.waitUntil(p)` | `waitUntil(c, p)` ([Hintergrundarbeiten](/docs/backend/background-work/)) |

Supabase erlaubt die Ausführung einer Edge Function für bis zu 150 s; der Rebase-Standardwert liegt bei 30 s. Eine Funktion, die ein LLM aufruft, deklariert ihr eigenes Timeout, welches der Server auf `REBASE_FUNCTIONS_MAX_TIMEOUT_MS` begrenzt (standardmäßig 300 s):

```ts
export default defineFunction((app) => {
    app.post("/", handler);
}, { timeoutMs: 150_000 });
```

Übergeben Sie `getSignal(c)` an das `fetch`, das das Modell aufruft, damit der Aufruf stoppt, wenn der Request beendet wird. Siehe [Eigenes Timeout einer Funktion](/docs/backend/custom-functions/#timeouts-and-rate-limits).

## 7. Anmelde-E-Mails

Die Anmeldung per Magic-Link und E-Mail-Code erfordert einen E-Mail-Dienst. Setzen Sie `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` und `SMTP_FROM` (mittels `rebase cloud env set` in der Cloud). Ohne diese Einstellungen antwortet die Route mit 503 und `rebase cloud status` meldet `blockedOn: email_not_configured`.

## 8. Deployment

```bash
rebase cloud projects create --name Triptelier --link
rebase cloud deploy
```

Der Deploy wendet `backend/sql` an wie `rebase db push`: Das Bundle enthält die Dateien, und der Boot der neuen Revision führt jede neue oder geänderte Datei einmal aus, nach den Tabellen und vor den Policies. Eine Datei, die fehlschlägt, stoppt den Boot und nennt die Datei, sodass sich ein Fehler darin im Deploy zeigt und nicht in einer laufenden App.
