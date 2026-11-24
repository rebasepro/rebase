---
sourceHash: 76cb1578ad9289ff
title: "Rezept: Migration von Supabase"
sidebar_label: Migration von Supabase
description: "Ein Supabase-Projekt zu Rebase migrieren: Schema introspektieren, SQL-Objekte anwenden, die keine Tabellen sind, Daten unter Beibehaltung der Benutzer-IDs kopieren, Edge Functions portieren und deployen – alles über das CLI."
---

## Übersicht

Hierbei wird ein Supabase-Projekt (Tabellen, Row-Level Security, SQL-Funktionen und
-Trigger, Benutzer, ein Storage-Bucket, Edge Functions) in ein Rebase-Projekt migriert,
zuerst lokal und anschließend auf [Rebase Cloud](/docs/deployment/cloud/). Jeder Schritt
erfolgt über die CLI. Um die Supabase-Datenbank weiter zu verwenden, anstatt sie zu
verlassen, siehe [Supabase](/docs/deployment/existing-database/#supabase) auf der
Seite für bestehende Datenbanken.

Die Reihenfolge ist wichtig: Generieren Sie die Tabellen aus der **Quelle**, und richten
Sie das Projekt anschließend auf das **Ziel** aus, bevor Schreibvorgänge stattfinden.

## 1. Tabellen generieren

Führen Sie eine Introspektion der Supabase-Datenbank oder einer lokalen Kopie davon durch. `SUPABASE_DB_URL`
unten ist der direkte Verbindungsstring als `postgres`-Rolle (Supabase-Dashboard: Connect → Direct connection);
setzen Sie diesen zuerst in Ihrer Shell:

```bash
SUPABASE_DB_URL="postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres"
rebase schema introspect --database-url "$SUPABASE_DB_URL" --from supabase
```

`--from supabase` übersetzt das, was eine Rebase-Datenbank nicht hat:

| In Supabase | Geschrieben als |
|---|---|
| `owner_id uuid default auth.uid()` | `col.text().onCreateUser().userId()`: Der Server schreibt die ID des Aufrufers |
| `owner_id uuid references auth.users(id)` | `col.text().userId()` und der Fremdschlüssel unter „Nicht übernommen“ aufgeführt |
| `auth.uid()` in a policy | `rebase.uid()` |
| `TO authenticated` / `TO anon` | Die Rolle wird verworfen und die Regel erfordert einen angemeldeten / nicht angemeldeten Aufrufer |
| a policy only `TO service_role` | Verworfen: Servercode läuft im eigenen Kontext des Servers |
| plain indexes | Die `indexes` der Tabelle |

Benutzer-ID-Spalten werden zu `text`, da `rebase.users.id` und `rebase.uid()`
Text sind: Der Vergleich einer `uuid`-Spalte mit `rebase.uid()` in einer Policy schlägt fehl.

Der Durchlauf endet mit einer Liste dessen, was **nicht** übernommen wurde (Funktionen,
Trigger, Extensions, CHECK-Constraints, weitere Indizes, zusammengesetzte Fremdschlüssel),
und schreibt das SQL für jedes Element nach `backend/sql/_introspected-left-behind.sql` – einem
Entwurf, den `rebase db push` erst anwendet, wenn Sie die Datei umbenennen.

## 2. Projekt auf die neue Datenbank ausrichten

`DATABASE_URL` verweist nach Schritt 1 immer noch auf Supabase, worauf auch die Ausgabe der
Introspektion hinweist. Ändern Sie die Variable (oder entfernen Sie sie, um die verwaltete
Entwicklungsdatenbank zu nutzen), bevor Sie den ersten Push durchführen:

```bash
rebase db push
```

## 3. SQL-Objekte anwenden

Bearbeiten Sie `backend/sql/_introspected-left-behind.sql` so, wie die Tabellen
bearbeitet wurden: `auth.uid()` → `rebase.uid()`, `auth.users` → `rebase.users`, kein
`GRANT … TO anon, authenticated`. Funktionen, die `pg_net` aufgerufen haben, eignen sich besser als
[benutzerdefinierte Funktion](/docs/backend/custom-functions/). Stellen Sie sicher, dass jede Anweisung
erneut ausgeführt werden kann (`DROP TRIGGER IF EXISTS` vor jedem `CREATE TRIGGER`), benennen Sie
die Datei anschließend ohne das führende `_` um und führen Sie den Push aus:

```bash
mv backend/sql/_introspected-left-behind.sql backend/sql/introspected.sql
rebase db push
```

`rebase db push` wendet jede `.sql`-Datei in `backend/sql` in alphabetischer Reihenfolge nach
den Tabellen und vor den Policies an und erfasst jede Datei per Hash in
`rebase.sql_files`, sodass eine Datei nur dann erneut ausgeführt wird, wenn sie sich ändert. Ein Deployment wendet
sie auf dieselbe Weise an (Schritt 8).

Eine Funktion, die der Browser mit `supabase.rpc('fn')` aufgerufen hat, wird mit
[`defineRpc`](/docs/backend/rpc/) neben den Tabellen deklariert. Sie wird dann unter
`POST /api/rpc/<name>` bereitgestellt und unter Row-Level Security als Aufrufer ausgeführt, sodass sich eine
`SECURITY DEFINER`-Funktion wie auf Supabase verhält:

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

Nur deklarierte Funktionen können aufgerufen werden, und jede `public`-Funktion ist ratenbegrenzt.
Eine Funktion, die Schreibvorgänge durchführt, erfordert `write: true`.

## 4. Daten unter Beibehaltung der Benutzer-IDs kopieren

Behalten Sie die Supabase-Benutzer-IDs bei, damit jede `owner_id` weiterhin auf ihren Benutzer verweist:
Importieren Sie zuerst die Benutzer mit ihren IDs und anschließend die Anwendungstabellen.
`rebase users import` erstellt die Konten unter ihren bisherigen IDs, übernimmt mit der Option `--password-hashes bcrypt` die
Supabase-Passwort-Hashes, versendet keine E-Mails und überspringt Konten, deren ID oder E-Mail-Adresse bereits vorhanden ist,
sodass der Befehl wiederholt ausgeführt werden kann. Er erreicht Rebase Cloud wie jeder andere `rebase users`-Befehl
(`--project <slug>` oder `--cloud` in einem verknüpften Verzeichnis).

```bash
SUPABASE_DB_URL="postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres"
psql "$SUPABASE_DB_URL" -c "\copy (select id, email, created_at, email_confirmed_at is not null as email_verified, encrypted_password from auth.users) to users.csv csv header"
rebase users import users.csv --password-hashes bcrypt --dry-run
rebase users import users.csv --password-hashes bcrypt
rm users.csv
```

Der Befehl meldet jedes Konto als erstellt, übersprungen oder fehlgeschlagen mit dem entsprechenden Grund und
beendet sich mit Statuscode 1, falls Fehler aufgetreten sind. Siehe [Konten importieren](/docs/cli/project/#importing-accounts)
für die Spalten, die gelesen werden (auch `display_name` und `roles`).

Danach folgen die Anwendungstabellen mittels `pg_dump` für Quelle und
Ziel. `TARGET_URL` ist der Verbindungsstring der neuen Datenbank: Ihre
`DATABASE_URL` oder auf Rebase Cloud der `connectionString`, den
`rebase cloud db connect --reveal` während der Ausführung ausgibt.

```bash
SUPABASE_DB_URL="postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres"
TARGET_URL="postgresql://…"   # the new database: your DATABASE_URL, or the tunnel's URL on Rebase Cloud
pg_dump "$SUPABASE_DB_URL" --data-only --schema=public --no-owner > data.sql
psql "$TARGET_URL" -f data.sql
```

Passwörter werden als Hashes übertragen. Supabase speichert bcrypt in
`auth.users.encrypted_password`, sodass sich jeder Benutzer mit seinem bisherigen Passwort
unter derselben ID wie zuvor anmeldet; bei der ersten Anmeldung wird der Hash durch
den von Rebase ersetzt. Ein Konto ohne Passwort (Magic Link, ein
Provider) hat ein leeres `encrypted_password` und meldet sich wie gewohnt an. Lassen
Sie die Spalte und das Flag weg, um ohne Passwörter zu importieren: Diese Benutzer melden sich
dann über einen Magic Link, einen E-Mail-Code oder einen Passwort-Reset an.

## 5. Storage

Ein öffentlicher Supabase-Bucket entspricht einer [Storage-Quelle](/docs/backend/storage/)
mit Pfaden unter `public/`, die ohne Token bereitgestellt werden. Kopieren Sie die Objekte
mit einem beliebigen S3-Client unter Beibehaltung ihrer Keys.

## 6. Edge Functions

Eine Deno Edge Function wird zu einer [benutzerdefinierten Funktion](/docs/backend/custom-functions/)
in `backend/functions/`. Die üblichen Ersetzungen:

| Supabase | Rebase |
|---|---|
| `Deno.serve(handler)` | `defineFunction((app) => app.post("/", handler))` |
| `Deno.env.get("X")` | `requireEnv(c, "X")` inside the handler |
| `createClient(url, serviceRoleKey)` | `rebase.dataAsAdmin` oder `rebase.sql` auf dem Server |
| Ein Client mit dem JWT des Benutzers | `getSql(c)`: SQL als Aufrufer unter Row-Level Security |
| `EdgeRuntime.waitUntil(p)` | `waitUntil(c, p)` ([Hintergrundaufgaben](/docs/backend/background-work/)) |

Supabase erlaubt einer Edge Function eine Laufzeit von 150 s; der Standardwert bei Rebase beträgt 30 s. Eine
Funktion, die ein LLM aufruft, deklariert ihren eigenen Timeout, den der Server bei
`REBASE_FUNCTIONS_MAX_TIMEOUT_MS` (standardmäßig 300 s) begrenzt:

```ts
export default defineFunction((app) => {
    app.post("/", handler);
}, { timeoutMs: 150_000 });
```

Übergeben Sie `getSignal(c)` an den `fetch`-Aufruf für das Modell, damit der Aufruf stoppt,
wenn der Request abbricht. Siehe [Timeout einer Funktion](/docs/backend/custom-functions/#timeouts-and-rate-limits).

## 7. Anmelde-E-Mails

Die Anmeldung per Magic Link und E-Mail-Code erfordert einen E-Mail-Dienst. Konfigurieren Sie `SMTP_HOST`,
`SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` und `SMTP_FROM` (`rebase cloud env set`
in der Cloud). Ohne diese Einstellungen antwortet die Route mit 503 und `rebase cloud status`
meldet `blockedOn: email_not_configured`.

## 8. Deploy

```bash
rebase cloud projects create --name Triptelier --link
rebase cloud deploy
```

Das Deployment wendet `backend/sql` genauso an wie `rebase db push`: Das Bundle enthält
die Dateien, und beim Start der neuen Revision wird jede neue oder geänderte Datei einmal ausgeführt – nach
den Tabellen und vor den Policies. Schlägt eine Datei fehl, bricht der Start ab und der Dateiname wird
ausgegeben, sodass Fehler bereits beim Deployment sichtbar werden und nicht erst in einer laufenden Anwendung.
