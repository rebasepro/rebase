---
sourceHash: 7262803dd6cb2e95
slug: de/docs/rls-check
title: rls-check
description: Überprüfen Sie Row-Level Security auf jeder PostgreSQL-Datenbank – Supabase, Neon, RDS oder Ihr eigener Server. Schreibgeschützt, keine Registrierung, kein Rebase erforderlich.
---

# rls-check

`rls-check` liest den Katalog einer PostgreSQL-Datenbank und meldet, was tatsächlich exponiert ist:
Tabellen, die mit deaktivierter Row-Level Security ausgeliefert werden, Policies, die für jeden als
wahr ausgewertet werden, Views, die direkt an der RLS ihrer Basistabellen vorbeilesen, und Join-Tabellen,
die vergessen wurden, während ihre beiden Endpunkte abgesichert wurden.

Es funktioniert auf **jedem** Postgres – Supabase, Neon, RDS, Cloud SQL oder einem Server, den Sie
selbst betreiben. Es erfordert kein Rebase und ist nützlich, unabhängig davon, ob Sie es jemals einsetzen.

```bash
npx @rebasepro/rls-check
```

Führen Sie es in Ihrem Projektverzeichnis aus, und es findet die Datenbank selbst: zuerst `DATABASE_URL`,
dann `POSTGRES_URL`, dann eine `.env` neben Ihnen. Übergeben Sie den Connection-String nur dann als
Argument, wenn dies nicht anders möglich ist – npm gibt die Befehlszeile vor dem Start des Programms
aus, und Ihre Shell zeichnet sie auf. Ein Passwort in einem Argument landet also an zwei Stellen, die
`rls-check` nicht schwärzen kann. `$DATABASE_URL` ist dort nicht sicherer: Die Shell expandiert es,
bevor npm es überhaupt sieht.

Es ist konstruktionsbedingt schreibgeschützt: Es öffnet eine Read-Only-Transaktion und setzt
Katalogabfragen ab. Es schreibt nichts und sendet nichts irgendwohin – es gibt keine Telemetrie und keinen
Netzwerkaufruf außer dem zu Ihrer Datenbank.

## Ausführung

```bash
# From the environment — DATABASE_URL, then POSTGRES_URL, then a .env in the cwd
npx @rebasepro/rls-check

# For a database that is not the one in your environment
DATABASE_URL="postgres://user:pass@host:5432/dbname" npx @rebasepro/rls-check

# As an argument. Works, but see the warning above about where the password lands
npx @rebasepro/rls-check "postgres://user:pass@host:5432/dbname"
```

Wenn Ihr Passwort `/`, `?` oder `#` enthält, kodieren Sie es per Prozentkodierung (Percent-Encoding). Diese
drei Zeichen beenden den Authority-Abschnitt der URL, sodass der Split innerhalb der Anmeldedaten landet –
anstatt Fragmente eines Passworts auszugeben, verweigert `rls-check` den String mit einer entsprechenden Meldung.

`@` und `:` benötigen keine Kodierung: Die Userinfo wird am **letzten** `@` getrennt und der Benutzer am
**ersten** `:`, genau wie es auch `pg` handhabt. Daher verbindet sich `postgres://user:pa@ss@host:5432/db`
mit dem Host `host` unter Verwendung des Passworts `pa@ss`. Sie dennoch zu kodieren, ist nie falsch.

### Optionen

| Option | Bedeutung |
| --- | --- |
| `--json` | Maschinenlesbare Ausgabe auf stdout, und sonst nichts auf stdout |
| `--html <path>` | Schreibt zusätzlich einen in sich geschlossenen HTML-Bericht dorthin. Eine Datei, keine Netzwerkanfragen |
| `--schema <name>` | Beschränkt den Scan auf ein Schema. Wiederholbar oder kommagetrennt |
| `--role <name>` | Behandelt diese Rolle als eine, mit der ein nicht vertrauenswürdiger Aufrufer ankommt, zusätzlich zu `anon`, `authenticated`, `web_anon` und `rebase_user`. Wiederholbar oder kommagetrennt |
| `--fail-on <severity>` | Exit-Code 1 bei oder über diesem Schweregrad. Standard: `high`; `none` schlägt nie fehl |
| `--only <id>` | Führt nur diese Prüfungen aus. Wiederholbar oder kommagetrennt |
| `--skip <id>` | Überspringt diese Prüfungen. Wiederholbar oder kommagetrennt |
| `--list-checks` | Gibt den Katalog aus und beendet das Programm |
| `--timeout <ms>` | Statement-Timeout, Standard 15000 |
| `--quiet` | Nur Ergebnisse – kein Banner, keine Zusammenfassung |
| `--no-color` | Deaktiviert ANSI-Farben (berücksichtigt auch `NO_COLOR` und ein Nicht-TTY-stdout) |

Eine unbekannte ID, die an `--only` oder `--skip` übergeben wird, ist ein Fehler und kein stiller No-Op,
da ein Tippfehler an dieser Stelle den Scan unbemerkt schwächen würde. Eine `--role`, die nicht in
`pg_roles` vorhanden ist, führt aus demselben Grund zu einem Fehler: Jede Prüfung basiert auf einem
Grant an eine exponierte Rolle. Ein Name, der auf nichts zutrifft, würde daher unbemerkt die Abdeckung
verringern.

Der Header des Berichts nennt die Rollen, die beim Durchlauf als exponiert behandelt wurden, sodass Sie
auf einen Blick sehen können, ob `No findings` auch die Rolle abgedeckt hat, mit der sich Ihre Anwendung
verbindet:

```
Exposed   PUBLIC, anon, authenticated (add yours with --role)
```

Wenn sich der Scan als eine Rolle verbindet, die Row-Level Security einschränken *kann* – kein Superuser,
kein Eigentümer, kein `BYPASSRLS` –, wird diese Rolle dem Set hinzugefügt, und der Bericht weist darauf hin.
Ein Scan mit der tatsächlichen Rolle Ihrer Anwendung kommt der Frage am nächsten, was Ihre API in der
Datenbank tatsächlich sieht.

### Exit-Codes

| Code | Bedeutung |
| --- | --- |
| `0` | Keine Ergebnisse bei oder über dem `--fail-on`-Schwellenwert |
| `1` | Mindestens ein Ergebnis bei oder über dem Schwellenwert |
| `2` | Der Scan konnte nicht ausgeführt werden – ungültige Argumente, Verbindung verweigert, Authentifizierungsfehler, Timeout |

`1` und `2` sind bewusst unterschiedlich: Eine fehlerhafte Verbindung darf niemals wie eine saubere
Datenbank aussehen.

### In CI

```yaml
- name: Audit RLS
  run: npx @rebasepro/rls-check --fail-on high
  env:
    DATABASE_URL: ${{ secrets.DATABASE_URL }}
```

**Ein neues Rebase-Projekt besteht dies am ersten Tag nicht, und das ist auch so beabsichtigt.** Die
`defaultSecurityRules` der Vorlage öffnen Lesezugriffe für jeden – `{ operation: "select", access:
"public" }` in `config/collections/index.ts` –, sodass `posts`, `authors` und `tags` jeweils ein
kritisches `policy-always-true` melden. Bei `access: "public"` geht es um *Zeilen*, nicht darum, wer
die API aufrufen darf: Eine Anfrage ohne Token wird weiterhin mit 401 beantwortet, solange `AUTH_REQUIRE`
aktiviert ist. Das Ergebnis ist dennoch korrekt, da dies das Einzige ist, was vor den Daten steht.

Entscheiden Sie, welcher dieser beiden Fälle zutrifft, bevor Sie dies in CI einbinden:

- **Die Regeln sind ein Platzhalter** – ersetzen Sie sie durch diejenigen, die Ihre Daten tatsächlich
  benötigen ([Security Rules](/docs/collections/security-rules)), und die Befunde verschwinden;
- **Die Zeilen sind wirklich öffentlich lesbar** – legen Sie dies einmalig fest mit
  `npx @rebasepro/rls-check --fail-on high --skip policy-always-true`, und seien Sie sich bewusst, worauf
  Sie verzichten: `--skip` deaktiviert die Prüfung überall, auch für die Tabelle, die Sie nächsten Monat
  hinzufügen.

### JSON-Ausgabe

`--json` gibt ein stabiles Objekt aus: `scannedAt`, `database` (nur Host und Name – niemals
Anmeldedaten), `serverVersion`, `platform`, `scannerIsPrivileged`, `exposedRoles`, `stats`,
`findings` und `diagnostics`. Jeder Befund enthält `id`, `severity`, `title`, `target`,
`detail`, `impact`, `fix`, `docs` und `confidence`.

`exposedRoles` und `diagnostics` sind Teil des Vertrags, keine Extras: Jede Prüfung basiert auf
dem exponierten Set, und `diagnostics.degraded` zeigt einem Consumer, wie zwischen "alles war in Ordnung"
und "der Scan konnte nicht prüfen" unterschieden werden muss. `findings: []` ohne beides zu lesen,
bedeutet, nur die halbe Antwort zu kennen.

## Zeitgesteuerte Ausführung

Eine Prüfung, an deren Ausführung man selbst denken muss, ist eine Prüfung, die bis zu dem Tag, an dem
es darauf ankommt, eine saubere Datenbank meldet. Das Backend kann dies für Sie ausführen und das
Ergebnis im Admin-Panel bereitstellen:

```ts
import { scan } from "@rebasepro/rls-check";
import type { RebaseBackendConfig } from "@rebasepro/server";

const rlsAudit: RebaseBackendConfig["rlsAudit"] = {
    enabled: true,
    scan,
    intervalMs: 24 * 60 * 60 * 1000,  // the default
    warnAtSeverity: "high"            // the default
};
```

Übergeben Sie dies als `rlsAudit` in dem Objekt, das Sie an `initializeRebaseBackend` übergeben.

Das Ergebnis wird unter `GET /api/admin/rls-audit` bereitgestellt, per Admin-Berechtigung geschützt
wie jede andere Admin-Oberfläche, und jeder Durchlauf protokolliert eine Zeile – als `warn`, wenn ein
Befund `warnAtSeverity` erreicht, andernfalls als `info`:

```
⚠️  [rls-audit] RLS audit found 3 issue(s) — 1 critical, 2 medium. 1 table(s)
    without RLS. Read the detail at GET /api/admin/rls-audit.
```

### Warum Sie `scan` übergeben

`@rebasepro/server` enthält keinen Datenbanktreiber – das sorgt dafür, dass es mit Postgres, Mongo und
Firebase gleichermaßen nutzbar bleibt. `@rebasepro/rls-check` bringt `pg` mit, da es sich mit Postgres
verbindet. Wenn es innerhalb des Server-Pakets importiert würde, hätte jede Installation einen
Postgres-Treiber für ein Feature, das nur manche Installationen nutzen können. Daher übergeben Sie die
Funktion stattdessen von außen.

### In einem Split-Deployment

Das Audit ist ein *owned* Singleton, ähnlich wie der Cron-Scheduler. Jeder Prozess, der es besitzt,
führt seinen eigenen Scan aus, was zwar schreibgeschützt und harmlos, aber redundant ist – weisen Sie
es einem einzelnen Prozess zu:

```ts
ownership: { rlsAudit: false }   // on every process but one
```

oder für eine über die Umgebung konfigurierte Runtime:

```bash
REBASE_RLS_AUDIT=false
```

Die Rolle `functions` besitzt es standardmäßig bereits als `false` – dieser Prozess führt überhaupt
keine Timer aus. Das Überschreiben eines Ownership-Werts verändert niemals einen anderen: Das Abschalten
von Cron lässt das Audit unberührt und umgekehrt.

Ein Prozess, der die Admin-Oberfläche bereitstellt, ohne den Scan zu besitzen, antwortet dem Endpunkt
wahrheitsgemäß, dass der Scan dort nicht läuft.

### Es ist ein Sicherheitsnetz, kein Monitor

Das Standardintervall beträgt einen Tag, da das überwachte Objekt ein Schema ist: Es ändert sich bei
Deployments, nicht durch Traffic. Ein fehlgeschlagener Scan wird protokolliert und im Status erfasst –
es wird niemals ein Fehler geworfen. Eine Sicherheitsprüfung in eine neue Ursache für Serverabstürze zu
verwandeln, wäre in jeder Hinsicht ein schlechter Kompromiss.

## Wie der Bericht zu lesen ist

**Bestätigte Befunde stehen an erster Stelle; heuristische Befunde befinden sich in einem separaten
Abschnitt "worth checking".** Eine heuristische Prüfung kann keine Absicht erkennen – eine Junction-Table,
die Sie bewusst offengehalten haben, ist kein Bug. Daher sind diese als Fragen formuliert und niemals
mit den eindeutigen Befunden vermischt.

**Achten Sie auf den Berechtigungshinweis.** Wenn sich der Scan als Superuser, Tabelleneigentümer oder
als Rolle mit `BYPASSRLS` verbindet, wird dies angezeigt. Diese Rolle sieht den tatsächlichen Katalog,
was das Audit überhaupt erst möglich macht, aber es bedeutet auch, dass nichts im Bericht beschreibt,
was *diese* Verbindung erlebt. Die Befunde beziehen sich darauf, was andere Rollen erhalten.

### Auf einer Rebase-Datenbank: Ändern Sie die Regel, nicht die Policy

Jede Policy in einem Rebase-Deployment wird aus den `securityRules` einer Collection kompiliert, und
die Runtime **wendet sie bei jedem Start neu an**: Sie löscht jede generierte Policy und erstellt sie
aus der Konfiguration neu. Ein `ALTER POLICY`, das auf eine dieser Policies angewendet wird, überlebt
daher exakt bis zum nächsten Neustart, und der Befund kehrt zurück – nachdem Sie zugesehen haben,
wie er verschwand.

`rls-check` erkennt diese Policies (an einem Namen im Format `<table>_<operation>_<hash>` oder einem
Aufruf von `rebase.uid()` / `rebase.roles()` im Ausdruck) und gibt die Regel anstelle von SQL vor.
Wenn Sie einen Fix sehen, der dies besagt:

1. Finden Sie die Collection, deren Tabelle genannt wird, unter `config/collections/`;
2. Ändern Sie deren `securityRules` – siehe [Security Rules](/docs/collections/security-rules);
3. Wenn die Collection keine eigenen deklariert, erbt sie `defaultSecurityRules` aus
   `config/collections/index.ts`, und dies ist die zu bearbeitende Datei;
4. Rollen Sie neu aus – der Start wendet die Policies neu an – oder führen Sie `rebase db push` aus.

Eine Policy, die Sie manuell in einer Migration geschrieben haben, wird von alldem nicht berührt,
und ihr Fix besteht nach wie vor in dem auszuführenden SQL.

## Die Prüfungen

Die folgenden Schweregrade sind die Standardwerte; einige Prüfungen passen ihren Schweregrad basierend
auf den Funden an, und der Bericht nennt stets den Grund.

### rls-disabled

**Tabelle ohne Row-Level Security exponiert.** Critical.

Für die Tabelle ist RLS deaktiviert *und* sie gewährt `SELECT`/`INSERT`/`UPDATE`/`DELETE` für eine Rolle,
die ein nicht vertrauenswürdiger Aufrufer erreichen kann (`anon`, `PUBLIC`, `web_anon`, `rebase_user`).
Postgres wendet keinerlei zeilenbasierte Filter an, sodass Policies – falls vorhanden – niemals
konsultiert werden.

Eine Tabelle mit deaktivierter RLS, aber ohne Berechtigung für eine exponierte Rolle, wird *nicht*
gemeldet. Sie ist nicht erreichbar, und ein Hinweis darauf wäre reines Rauschen.

```sql
ALTER TABLE "public"."your_table" ENABLE ROW LEVEL SECURITY;
```

Das Aktivieren von RLS ohne Policies verweigert jede Zeile für jeden außer dem Eigentümer. Fügen Sie
die beabsichtigte Policy daher in derselben Migration hinzu – andernfalls haben Sie eine Sicherheitslücke
gegen einen stillen Ausfall eingetauscht. Siehe [rls-enabled-no-policies](#rls-enabled-no-policies).

### policy-always-true

**Policy gewährt bedingungslosen Zugriff.** Critical.

Eine permissive Policy, deren `USING`- oder `WITH CHECK`-Ausdruck eine konstante Wahrheit ist – `true`,
`(true)`, `1 = 1`. Permissive Policies werden mit ODER verknüpft, sodass eine einzige dieser Regeln
den Zeilenfilter der Tabelle erfüllt, ganz gleich, wie streng jede andere Policy ist.

Wenn eine `RESTRICTIVE`-Policy denselben Befehl abdeckt, wird dies auf "medium" herabgestuft und als
etwas gemeldet, das überprüft werden sollte, statt als Gewissheit, da restriktive Policies mit UND
nach den mit ODER verknüpften permissiven Policies angewendet werden.

```sql
ALTER POLICY "your_policy" ON "public"."your_table"
    USING (user_id = rebase.uid());
```

Auf einer Rebase-Datenbank ist der Fix die Regel der Collection anstelle dieses Statements – siehe
[Ändern Sie die Regel, nicht die Policy](#auf-einer-rebase-datenbank-ändern-sie-die-regel-nicht-die-policy).
Ein Standard-Projektgerüst meldet diese Prüfung für `posts`, `authors` und `tags` standardmäßig.

### policy-anonymous-tautology

**Policy prüft nur, ob eine Aufrufer-ID existiert.** Schweregrad hängt von der Plattform ab.

Der Ausdruck hat die Form `rebase.uid() IS NOT NULL` (oder `auth.uid()` auf Supabase sowie auf einer
Rebase-Datenbank, die vor 1.0 bereitgestellt wurde): Er trennt angemeldete von abgemeldeten Aufrufern,
grenzt jedoch keine Zeilen ein. Jeder angemeldete Benutzer erreicht jede Zeile, die die Policy abdeckt.

Der Schweregrad ist plattformabhängig, und diese Unterscheidung ist wichtig:

- **Auf Supabase** gibt `auth.uid()` für anonyme Aufrufer `NULL` zurück, sodass dies eine funktionierende
  Prüfung nur für authentifizierte Benutzer ist. Gemeldet als **low** – eine Lücke bei der Datenabgrenzung
  zwischen angemeldeten Benutzern, keine Lücke für anonymen Zugriff.
- **Auf Rebase oder PostgREST**, wo eine leere Aufrufer-ID in einen `'anonymous'`-Sentinel umgewandelt
  wird, ist der Ausdruck *auch für abgemeldete Aufrufer wahr*. Gemeldet als **critical**.
- **Auf einer nicht erkannten Plattform** gemeldet als **medium**, da es davon abhängt, ob Ihr Stack
  einen solchen Sentinel verwendet, ob es sich um eine Lücke handelt.

```sql
-- Scope to the row's owner rather than to the existence of an id
ALTER POLICY "your_policy" ON "public"."your_table"
    USING (user_id = rebase.uid());

-- Or, if "any signed-in user" really is the intent, reject the sentinel explicitly
--     USING (rebase.uid() IS NOT NULL AND rebase.uid() <> 'anonymous');
```

Das vorgeschlagene SQL wird mit der Aufrufer-ID-Funktion ausgegeben, die Ihre Datenbank tatsächlich besitzt:
`rebase.uid()` auf einer Rebase-Datenbank, `auth.uid()` auf Supabase und PostgREST. Beide Schreibweisen
werden beim Lesen von Policies erkannt, sodass eine Rebase-Datenbank während der Migration vom Schema
`auth` vor Version 1.0 weiterhin geprüft wird.

### policy-authenticated-tautology

**Policy gewährt jedem angemeldeten Aufrufer Zugriff auf jede Zeile.** High.

Die korrigierte Form der obigen Prüfung – `rebase.uid() IS NOT NULL AND rebase.uid() <> 'anonymous'` –
und die Stelle, an der viele aufhören. Sie schließt abgemeldete Aufrufer aus. Was sie jedoch nicht tut,
ist das Eingrenzen von Zeilen: Was übrig bleibt, ist *jedes registrierte Konto darf jede Zeile dieser
Tabelle lesen*, was eine andere Aussage ist als die, die normalerweise beabsichtigt war.

Das ist das Muster, das eine `users`-Tabelle in ein Verzeichnis aller Adressen auf der Plattform verwandelt,
lesbar für jeden, der sich registriert hat – und wo die Registrierung offen ist, ist "jeder, der sich
registriert hat", einfach jeder. Dies wird getrennt von der anonymen Form gemeldet, da der Fix und der
Schweregrad unterschiedlich sind und Sie möglicherweise berechtigterweise die eine Warnung stummschalten
möchten und die andere nicht.

```sql
-- Scope to the row
ALTER POLICY "your_policy" ON "public"."your_table"
    USING (user_id = rebase.uid());

-- Or, where members of a shared group really may see each other's rows, say which group
--     USING (EXISTS (SELECT 1 FROM memberships m
--                    WHERE m.org_id = your_table.org_id AND m.user_id = rebase.uid()));
```

Wenn die Tabelle tatsächlich von jedem Konto gelesen werden darf – eine gemeinsame Preisliste, eine Liste
von Ländern –, behalten Sie die Policy bei und unterdrücken Sie den Befund mit
`rls-check --skip policy-authenticated-tautology`.

### view-bypasses-rls

**View liest an der RLS ihrer Basistabelle vorbei.** Critical.

Eine View, die einer nicht vertrauenswürdigen Rolle gewährt wird und aus einer RLS-geschützten Tabelle
ohne `security_invoker = true` selektiert. Die View wird mit den Rechten ihres **Eigentümers** ausgeführt,
sodass sie die Basistabelle als Eigentümer liest und die Policies des Aufrufers niemals angewendet werden.
Dies ist der häufigste Weg, wie eine sorgfältig abgesicherte Tabelle Daten leakt.

```sql
ALTER VIEW "public"."your_view" SET (security_invoker = true);
```

Unter PostgreSQL vor Version 15 existiert diese Option überhaupt nicht, sodass sich jede solche View so
verhält. Dort wird der Befund als heuristisch gemeldet, und die Lösung besteht darin, die Logik in eine
Funktion zu verlagern oder ein Upgrade durchzuführen.

### matview-bypasses-rls

**Materialized View exponiert RLS-geschützte Daten.** High.

Materialized Views können keine Row-Level Security haben, und die darin enthaltenen Daten sind ein
gespeicherter Snapshot, der von derjenigen Person/Rolle erstellt wurde, die den Refresh durchgeführt hat.
Wenn eine solche View einer nicht vertrauenswürdigen Rolle zugänglich gemacht wird und ihre definierende
Abfrage eine RLS-geschützte Tabelle liest, kann keine Policy helfen – entziehen Sie das Grant oder
verschieben Sie die Materialized View in ein Schema, das nicht vertrauenswürdige Rollen nicht erreichen können.

```sql
REVOKE ALL ON "public"."your_matview" FROM "anon";
```

### anonymous-write-allowed

**Nicht authentifizierte Aufrufer können schreiben.** High.

Eine permissive `INSERT`/`UPDATE`/`DELETE`/`ALL`-Policy, die ohne Authentifizierung erreichbar ist und
deren Check-Ausdruck jede Zeile akzeptiert, gestützt durch ein entsprechendes Grant.

Die Bedingung "akzeptiert jede Zeile" ist essenziell und bewusst eng gefasst. Supabase gewährt `anon`
und `authenticated` standardmäßig volle DML-Rechte; eine Policy, die auf diese Rollen abzielt, ist daher
für sich genommen kein Problem – ein klassisches `FOR INSERT TO public WITH CHECK (user_id = auth.uid())`
ist korrekt und wird nicht gemeldet.

### unqualified-column-in-subquery

**Unqualifizierte Spalte innerhalb einer Policy-Subquery.** High, heuristisch.

Ein reiner Spaltenname innerhalb einer `EXISTS`/`IN`-Subquery, der *sowohl* in der inneren Relation als
auch in der Tabelle der Policy selbst existiert. Postgres bindet diesen an die **innere** Tabelle, sodass
die beabsichtigte Korrelation zur äußeren Zeile stillschweigend verloren geht und das Prädikat trivial
erfüllbar wird – oder trivial unerfüllbar, wodurch jeder Zeilenzugriff für alle verweigert wird.

```sql
-- The bug: `id` binds to memberships, not organizations
USING (EXISTS (SELECT 1 FROM memberships WHERE id = organizations.id ...))

-- Qualify it
USING (EXISTS (SELECT 1 FROM memberships m WHERE m.org_id = organizations.id ...))
```

**Das Fehlen dieses Befundes ist kein Sicherheitsbeweis.** `pg_policies.qual` ist die von Postgres
selbst neu gerenderte Form des Parse-Trees und re-qualifiziert Spaltenreferenzen meist – daher ist der
ursprüngliche unqualifizierte Name häufig nicht mehr sichtbar, wenn der Katalog ausgelesen wird. Wenn
diese Prüfung anschlägt, ist dies ein starker Hinweis; schlägt sie nicht an, beweist dies nichts.

### junction-table-unprotected

**Many-to-Many-Join-Tabelle ohne RLS.** High, heuristisch.

Eine Tabelle, die im Wesentlichen nur aus den beiden Endpunkten zweier Fremdschlüssel besteht, die beide
auf Tabellen verweisen, die RLS *haben*, selbst jedoch über keine Row-Level Security verfügt. Beide Seiten
der Relation sind gesperrt und die Verknüpfung dazwischen ist offen – was ausreicht, um die Relation zu
enumerieren, selbst wenn keiner der Endpunkte gelesen werden kann.

Heuristisch, da eine Junction-Table anhand ihrer Struktur abgeleitet wird. Wenn Ihre Tabelle bewusst
öffentlich ist: `--skip junction-table-unprotected`.

### rls-enabled-not-forced

**RLS aktiviert, aber für den Tabelleneigentümer nicht erzwungen.** Medium oder High.

Ohne `FORCE` ist der Eigentümer der Tabelle von den eigenen Policies ausgenommen. Das ist harmlos, wenn
der Eigentümer eine Provisioning-Rolle ist, mit der sich nichts verbindet, und schwerwiegend, wenn sich
Ihre Anwendung als Eigentümer verbindet – daher ist dies **high**, wenn sich die Eigentümerrolle einloggen
kann, und andernfalls **medium**.

Wenn der Eigentümer ein Superuser ist oder `BYPASSRLS` besitzt, bleibt es auf "medium" mit entsprechendem
Hinweis: `FORCE` kann eine solche Rolle nicht einschränken, und etwas anderes zu suggerieren, wäre
irreführend.

```sql
ALTER TABLE "public"."your_table" FORCE ROW LEVEL SECURITY;
```

### rls-enabled-no-policies

**RLS ohne Policies aktiviert.** Medium.

Keine Sicherheitslücke – das Gegenteil. RLS ohne Policies verweigert jede Zeile für jeden außer dem
Eigentümer. Es wird gemeldet, da es sich um einen *unsichtbaren* Fehler handelt: Die API gibt `[]` zurück,
und eine leere Tabelle ist nicht von einer gefilterten zu unterscheiden. Diese Konfiguration hat in
Produktionsumgebungen schon wochenlang unbemerkt leere Collections ausgeliefert.

### policy-role-unreachable

**Policies zielen auf Rollen ab, mit denen sich nichts verbindet.** Medium.

Jede Policy auf der Tabelle benennt Rollen, die nicht existieren, sich nicht einloggen können und die
keine Login-Rolle transitiv erbt. Die Policies sehen korrekt aus, gelten aber für niemanden, sodass
die Tabelle als leer gelesen wird.

Der klassische Fall sind Policies, die mit `TO authenticated` geschrieben wurden – ein Supabase-Rollenname
– auf einer Datenbank, deren Anfragen tatsächlich als eine andere Rolle ankommen.

### grant-to-public

**Tabellenberechtigungen an PUBLIC vergeben.** Medium.

Ein DML-Privileg, das an `PUBLIC` vergeben wurde. Selbst bei aktivierter RLS erweitert dies den Kreis
derer, für die Policies ausgewertet werden, und ist fast nie beabsichtigt.

```sql
REVOKE ALL ON "public"."your_table" FROM PUBLIC;
```

### security-definer-mutable-search-path

**SECURITY DEFINER Routine mit veränderbarem search_path.** Medium.

Die Routine wird als ihr Eigentümer ausgeführt – oft ein Superuser –, während der Aufrufer steuert, wie
ihre Bezeichner aufgelöst werden. Dies ist das Standardmuster für Privilege-Escalation, und alles, was
die Routine anfasst, wird mit den Rechten des Eigentümers unter Umgehung von RLS gelesen.

```sql
ALTER FUNCTION "public"."your_function"() SET search_path = pg_catalog, public;
```

### current-setting-throws

**Policy ruft `current_setting()` ohne `missing_ok` auf.** Low, heuristisch.

`current_setting('app.tenant_id')` mit einem einzelnen Argument löst einen Fehler aus (*raises*), wenn
die Einstellung nicht gesetzt ist, anstatt `NULL` zurückzugeben. Anstatt die Zeile zu verweigern,
schlägt die Anfrage fehl – der Aufrufer sieht einen 500-Fehler statt eines leeren Ergebnisses, und
Middleware mit Retry-Logik für 5xx-Fehler wiederholt eine Anfrage, die niemals erfolgreich sein kann.

```sql
ALTER POLICY "your_policy" ON "public"."your_table"
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
```

## Was dieses Tool nicht tut

Klarheit über die Grenzen zu schaffen, ist der entscheidende Punkt – ein Sicherheitstool, das seine
Abdeckung überschätzt, ist schlimmer als gar keines.

- **Es ist ein statisches Katalog-Audit.** Es liest `pg_class`, `pg_policies`, `pg_depend` und
  Verwandte. Es verbindet sich nicht als Ihre `anon`-Rolle, um zu versuchen, Ihre Daten zu lesen;
  daher kann es nicht bestätigen, ob eine Schwachstelle über Ihre API erreichbar ist.
- **Es kann nicht beweisen, dass eine Policy korrekt ist.** Es findet Strukturen, von denen bekannt ist,
  dass sie falsch sind. Eine Policy, die jede Prüfung hier besteht, kann dennoch die falsche
  Geschäftslogik ausdrücken.
- **Ein sauberer Bericht ist keine Sicherheitszertifizierung.** Beachten Sie insbesondere den Hinweis zu
  [unqualified-column-in-subquery](#unqualified-column-in-subquery): Postgres schreibt Policy-Ausdrücke
  um, sodass manche Fehler im Katalog gar nicht mehr sichtbar sind.
- **Es prüft keine Autorisierung auf Anwendungsebene**, keine API-Keys, keine Netzwerkfreigaben, keine
  Handhabung von Secrets oder irgendetwas außerhalb der Datenbank.

## Verwandte Themen

- [Security Rules (RLS)](/docs/collections/security-rules) – Definieren von Row-Level Security in
  Rebase-Collections, die zu den Policies kompiliert werden, die dieses Tool prüft.
- [Nur Backend](/docs/getting-started/headless/) – Warum eine Tabelle ohne Policy in einem Headless-Projekt
  überhaupt nicht bereitgestellt wird.
- [REST-API](/docs/backend/api/) – Die Angriffsfläche, die eine permissive Policy exponiert.
