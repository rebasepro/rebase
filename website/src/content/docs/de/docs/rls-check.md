---
sourceHash: 313f8530404811bc
slug: de/docs/rls-check
title: rls-check
description: Überprüfen Sie Row-Level Security auf jeder PostgreSQL-Datenbank – Supabase, Neon, RDS oder Ihrem eigenen Server. Schreibgeschützt, keine Registrierung, kein Rebase erforderlich.
---

# rls-check

`rls-check` liest den Katalog einer PostgreSQL-Datenbank aus und meldet, was tatsächlich offengelegt ist:
Tabellen, die mit deaktivierter Row-Level Security bereitgestellt werden, Policies, die für jeden
als wahr ausgewertet werden, Views, die direkt an der RLS ihrer Basistabellen vorbeilesen, und Join-Tabellen,
die vergessen wurden, während ihre beiden Endpunkte abgesichert wurden.

Es funktioniert mit **jedem** Postgres – Supabase, Neon, RDS, Cloud SQL oder einem Server, den Sie selbst betreiben. Es erfordert kein Rebase und ist nützlich, unabhängig davon, ob Sie es jemals einsetzen oder nicht.

```bash
npx @rebasepro/rls-check
```

Führen Sie es in Ihrem Projektverzeichnis aus, und es findet die Datenbank selbstständig: zuerst `DATABASE_URL`,
dann `POSTGRES_URL`, dann eine `.env`-Datei neben Ihnen. Übergeben Sie den Connection-String nur dann als
Argument, wenn Sie dies nicht tun können – npm gibt die Befehlszeile vor dem Start des Programms aus,
und Ihre Shell zeichnet sie auf. Ein Passwort in einem Argument landet daher an zwei Stellen, die
`rls-check` nicht unkenntlich machen kann. `$DATABASE_URL` ist dort nicht sicherer: Die Shell
löst die Variable auf, bevor npm sie überhaupt zu Gesicht bekommt.

Es ist konstruktionsbedingt schreibgeschützt: Es öffnet eine schreibgeschützte Transaktion und führt
Katalogabfragen aus. Es schreibt nichts und sendet nichts irgendwohin – es gibt keine Telemetrie und keine
Netzwerkaufrufe außer dem zu Ihrer Datenbank.

## Ausführung

```bash
# From the environment — DATABASE_URL, then POSTGRES_URL, then a .env in the cwd
npx @rebasepro/rls-check

# For a database that is not the one in your environment
DATABASE_URL="postgres://user:pass@host:5432/dbname" npx @rebasepro/rls-check

# As an argument. Works, but see the warning above about where the password lands
npx @rebasepro/rls-check "postgres://user:pass@host:5432/dbname"
```

Wenn Ihr Passwort `/`, `?` oder `#` enthält, kodieren Sie es per Prozentkodierung (Percent-Encoding). Diese drei Zeichen beenden den
Authority-Abschnitt der URL, sodass der Split innerhalb der Anmeldedaten landet – anstatt Fragmente eines
Passworts auszugeben, lehnt `rls-check` die Zeichenfolge ab und meldet dies.

`@` und `:` erfordern keine Kodierung: Die Benutzerinformationen werden am **letzten** `@` und der Benutzer am
**ersten** `:` getrennt, was auch `pg` so handhabt. Daher verbindet sich `postgres://user:pa@ss@host:5432/db` mit
`host` unter Verwendung des Passworts `pa@ss`. Sie dennoch zu kodieren, ist nie falsch.

### Optionen

| Option | Bedeutung |
| --- | --- |
| `--json` | Maschinenlesbare Ausgabe auf stdout und sonst nichts auf stdout |
| `--format <name>` | `text` (Standard), `json` (identisch mit `--json`) oder `agent`: ein einzelnes JSON-Dokument für einen Coding-Agenten, bei dem jeder Befund die fehlerhafte Tabelle und Policy, das behebende SQL sowie die entsprechenden Rebase-`securityRules` enthält |
| `--html <path>` | Schreibt zusätzlich einen in sich geschlossenen HTML-Bericht an diesen Pfad. Eine einzelne Datei, keine Netzwerkanfragen |
| `--schema <name>` | Beschränkt den Scan auf ein Schema. Wiederholbar oder kommagetrennt |
| `--role <name>` | Behandelt diese Rolle als eine, unter der ein nicht vertrauenswürdiger Aufrufer ankommt, zusätzlich zu `anon`, `authenticated`, `web_anon` und `rebase_user`. Wiederholbar oder kommagetrennt |
| `--request-role <name>` | Die Rolle, unter der eine Rebase-App auf dieser Datenbank Anfragen ausführt, anstelle von `rebase_user` (die Einstellung `rls.requestRole`). Ohne diese Angabe werden die Rollen verwendet, die die Datenbank in `rebase.schema_meta` aufgezeichnet hat, danach `rebase_user`. Wiederholbar oder kommagetrennt |
| `--fail-on <severity>` | Beendet mit Exit-Code 1 ab diesem Schweregrad oder höher. Standard ist `high`; `none` schlägt nie fehl |
| `--only <id>` | Führt nur diese Prüfungen aus. Wiederholbar oder kommagetrennt |
| `--skip <id>` | Überspringt diese Prüfungen. Wiederholbar oder kommagetrennt |
| `--list-checks` | Gibt den Katalog der Prüfungen aus und beendet das Programm |
| `--timeout <ms>` | Statement-Timeout, Standard ist 15000 |
| `--quiet` | Nur Befunde – kein Banner, keine Zusammenfassung |
| `--no-color` | Deaktiviert ANSI-Farben (berücksichtigt auch `NO_COLOR` und ein Nicht-TTY-stdout) |

Eine unbekannte ID, die an `--only` oder `--skip` übergeben wird, führt zu einem Fehler anstatt eines
stillen No-Ops, da ein Tippfehler dort den Scan stillschweigend abschwächen würde. Ein `--role` oder
`--request-role`, der nicht in `pg_roles` vorhanden ist, führt aus demselben Grund zu einem Fehler: Jede
Prüfung setzt eine Berechtigung für eine exponierte Rolle voraus, sodass ein Name, der auf nichts zutrifft,
unbemerkt die Abdeckung reduzieren würde. Das Gleiche gilt für ein `--schema`, das kein Schema benennt, was
andernfalls dazu führen würde, dass nichts gescannt und das Ergebnis als sauber gemeldet wird. Bei
Schemanamen wird zwischen Groß- und Kleinschreibung unterschieden.

Der Header des Berichts nennt die Rollen, die beim Durchlauf als exponiert behandelt wurden, sodass Sie auf
einen Blick sehen können, ob `No findings` die Rolle abdeckt, unter der sich Ihre Anwendung verbindet:

```
Exposed   PUBLIC, anon, authenticated (add yours with --role)
```

Wenn sich der Scan als eine Rolle verbindet, die von Row-Level Security eingeschränkt werden *kann* – kein
Superuser, kein Eigentümer, kein `BYPASSRLS` –, wird diese Rolle der Menge hinzugefügt und der Bericht weist
darauf hin. Das Scannen unter der anwendungseigenen Rolle kommt der Frage an die Datenbank, was Ihre API
tatsächlich sieht, am nächsten.

### Exit-Codes

| Code | Bedeutung |
| --- | --- |
| `0` | Keine Befunde mit oder über dem Schwellenwert von `--fail-on` |
| `1` | Mindestens ein Befund mit oder über dem Schwellenwert |
| `2` | Der Scan konnte nicht ausgeführt werden – ungültige Argumente, Verbindungsaufbau verweigert, Authentifizierungsfehler, Timeout – oder war unvollständig: Ein Auslesen des Katalogs schlug fehl oder eine Prüfung stürzte ab (`diagnostics.degraded`). Dies gilt auch bei `--fail-on none` |

`1` und `2` sind bewusst voneinander getrennt: Eine fehlerhafte Verbindung darf niemals wie eine saubere
Datenbank aussehen.

### In CI

```yaml
- name: Audit RLS
  run: npx @rebasepro/rls-check --fail-on high
  env:
    DATABASE_URL: ${{ secrets.DATABASE_URL }}
```

**Ein neues Rebase-Projekt besteht dies am ersten Tag nicht, und das ist auch so beabsichtigt.** Das
`defaultRls` des Scaffolds öffnet den Lesezugriff für jeden – `{ operation: "select", access:
"public" }` in `backend/schema/index.ts`, was `authors` und `tags` mit `rls: "inherit"` übernehmen –,
sodass jeweils ein kritischer Befund `policy-always-true` gemeldet wird. (`posts` deklariert eigene
Regeln und liest nur veröffentlichte Zeilen.) Bei `access: "public"` geht es um *Zeilen*, nicht darum, wer
die API aufrufen darf: Eine Anfrage ohne Token wird weiterhin mit 401 beantwortet, solange `AUTH_REQUIRE`
aktiviert ist. Der Befund ist dennoch korrekt, da dies das Einzige ist, was vor den Daten steht.

Entscheiden Sie, welcher der beiden Fälle zutrifft, bevor Sie dies in CI einbinden:

- **Die Regeln sind ein Platzhalter** – ersetzen Sie sie durch diejenigen, die Ihre Daten tatsächlich benötigen
  ([Row-Level Security](/docs/collections/security-rules)), und die Befunde verschwinden;
- **Die Zeilen sind wirklich öffentlich lesbar** – legen Sie dies einmalig mit
  `npx @rebasepro/rls-check --fail-on high --skip policy-always-true` fest und seien Sie sich bewusst, worauf
  Sie verzichten: `--skip` schaltet die Prüfung überall ab, auch auf der Tabelle, die Sie nächsten Monat hinzufügen.

### JSON-Ausgabe

`--json` gibt ein stabiles Objekt aus: `scannedAt`, `database` (nur Host und Name – niemals
Anmeldedaten), `serverVersion`, `platform`, `scannerIsPrivileged`, `exposedRoles`, `stats`,
`findings` und `diagnostics`. Jeder Befund enthält `id`, `severity`, `title`, `target`,
`detail`, `impact`, `fix`, `docs` und `confidence`.

`exposedRoles` und `diagnostics` sind Teil des Vertrags, keine Extras: Jede Prüfung filtert nach
der Menge der exponierten Rollen, und über `diagnostics.degraded` unterscheidet ein Konsument zwischen
„es lag kein Problem vor“ und „der Scan konnte nicht prüfen“. `findings: []` ohne beides zu lesen bedeutet,
nur die halbe Antwort zu lesen.

### Agent-Ausgabe

`--format agent` gibt ein einzelnes JSON-Dokument für einen Coding-Agenten aus, der das Gefundene behebt.
Jeder Befund nennt seine Prüfungs-ID und das fehlerhafte Objekt (`target.table`, `target.policy`, …) und
enthält eine `remediation`: `apply` (`sql`; `rebase-config`, wenn Rebase die Policy bei jedem Booten aus
dem `rls` einer Tabelle neu erstellt; oder `manual`), ausführbares `sql`, das pro Prüfung generiert wird,
die `placeholders`, die zuerst ausgefüllt werden müssen, und `rebase` – derselbe Fix als `rls` der Tabelle
mit einem Auszug von `defineTable(…, { rls })` für `backend/schema/`, oder die Begründung, warum Regeln
dies nicht ausdrücken können. Seit Version 0.31 lautet dieser Schlüssel `rebase.rls` (zuvor `rebase.securityRules`)
und die Formatversion des Dokuments ist 2. Der `key` jedes Befunds ist über Durchläufe hinweg stabil, sodass
ein erneuter Durchlauf zeigt, was behoben wurde. `--json` bleibt unverändert.

## Geplante Ausführung

Eine Prüfung, an deren Ausführung man sich erinnern muss, ist eine Prüfung, die
bis zu dem Tag, an dem es darauf ankommt, eine saubere Datenbank meldet. Das
Backend kann diese Prüfung für Sie ausführen und das Ergebnis im Admin-Panel bereitstellen:

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

Auf der Runtime – `rebase dev`, `rebase start` und dem veröffentlichten Server-Image –
gibt es kein solches Objekt zur Übergabe. Setzen Sie stattdessen `REBASE_RLS_AUDIT=true`
mit dem Standardintervall und -schwellenwert. Der Scanner muss dennoch aus Ihrem
Projekt stammen: Fügen Sie `@rebasepro/rls-check` zu seinen Abhängigkeiten hinzu, damit
das Bundle ihn enthält. Die Runtime liefert keine eigene Kopie mit, und ein Systemstart,
der das Audit ohne das Paket anfordert, verweigert den Dienst vor dem Öffnen einer Verbindung
und nennt das hinzuzufügende Paket.

Das Ergebnis wird unter `GET /api/admin/rls-audit` bereitgestellt, geschützt durch den
Scope `schema:read`, und jeder Durchlauf protokolliert eine Zeile – als `warn`, wenn ein Befund
`warnAtSeverity` erreicht, andernfalls als `info`:

```
⚠️  [rls-audit] RLS audit found 3 issue(s) — 1 critical, 2 medium. 1 table(s)
    without RLS. Read the detail at GET /api/admin/rls-audit, or run
    `npx @rebasepro/rls-check` for the full report.
```

### Warum Sie `scan` übergeben

`@rebasepro/server` besitzt keinen eigenen Datenbanktreiber; `@rebasepro/rls-check`
bringt `pg` mit, da es sich mit Postgres verbindet. Den Treiber innerhalb des Server-Pakets
zu importieren, würde bei jeder Installation einen zweiten Postgres-Treiber hinzufügen – für
ein Feature, das nur von einigen genutzt wird. Daher übergeben Sie die Funktion stattdessen von außen.

### In einem getrennten Deployment (Split Deployment)

Das Audit ist ein *besessenes* (owned) Singleton, ähnlich wie der Cron-Scheduler. Jeder
Prozess, der es besitzt, führt seinen eigenen Scan aus, was zwar schreibgeschützt und harmlos,
aber redundant ist – weisen Sie es einem einzelnen Prozess zu:

```ts
ownership: { rlsAudit: false }   // on every process but one
```

oder für eine über die Umgebung konfigurierte Runtime:

```bash
REBASE_RLS_AUDIT=false
```

Die Rolle `functions` besitzt es bereits als `false` – dieser Prozess führt überhaupt keine
Timer aus. Das Festlegen eines Ownership-Overrides ändert niemals einen anderen: Das Deaktivieren
von Cron lässt das Audit unberührt und umgekehrt.

Ein Prozess, der die Admin-Oberfläche bereitstellt, ohne den Scan zu besitzen, antwortet
dem Endpunkt wahrheitsgemäß, dass der Scan dort nicht läuft.

### Es ist ein Sicherheitsnetz, kein Monitoring-Tool

Das Standardintervall beträgt einen Tag, da das überwachte Objekt ein Schema ist:
Es ändert sich bei Deployments, nicht durch Datenverkehr. Ein fehlgeschlagener Scan wird
protokolliert und im Status festgehalten – es wird niemals eine Exception geworfen. Eine
Sicherheitsprüfung in eine neue Fehlerquelle zu verwandeln, durch die der Server abstürzen
könnte, wäre in beiden Richtungen ein schlechter Tausch.

## Wie der Bericht zu lesen ist

**Bestätigte Befunde stehen an erster Stelle; heuristische befinden sich in einem separaten
Abschnitt „prüfenswert“ (worth checking).** Eine heuristische Prüfung kann keine Absichten erkennen –
eine Verknüpfungstabelle, die Sie bewusst offen gelassen haben, ist kein Bug. Daher sind diese als
Fragen formuliert und werden niemals mit den gesicherten Befunden vermischt.

**Achten Sie auf den Berechtigungshinweis.** Wenn sich der Scan als Superuser, Tabelleneigentümer
oder als eine Rolle mit `BYPASSRLS` verbindet, wird dies angezeigt. Diese Rolle sieht den
tatsächlichen Katalog, was das Audit überhaupt erst möglich macht. Es bedeutet aber auch, dass
nichts im Bericht beschreibt, was *diese* Verbindung erlebt. Die Befunde beziehen sich darauf,
was andere Rollen erhalten.

### Auf einer Rebase-Datenbank die Regel ändern, nicht die Policy

Jede Policy auf einem Rebase-Deployment wird aus dem `rls` einer Tabelle kompiliert, und die
Runtime **überprüft diese bei jedem Start**: Jede generierte Policy trägt einen Stempel (einen
`rebase:<hash>`-Kommentar) dessen, was kompiliert und was von Postgres gespeichert wurde. Eine
Tabelle, deren Policies nicht mehr damit übereinstimmen, wird anhand der Konfiguration neu angewendet.
Ein `ALTER POLICY`, das auf eine dieser Policies angewendet wird, übersteht daher genau die Zeit bis
zum nächsten Neustart, und der Befund kehrt damit zurück – nachdem Sie zugesehen haben, wie er verschwand.

`rls-check` erkennt diese Policies (anhand eines Namens wie `<table>_<operation>_<hash>` oder eines
Aufrufs von `rebase.uid()` / `rebase.roles()` im Ausdruck) und empfiehlt die Regel anstelle von SQL.
Wenn Sie einen Fix sehen, der dies angibt:

1. Suchen Sie die genannte Tabelle unter `backend/schema/`;
2. Ändern Sie deren `rls` – siehe [Row-Level Security](/docs/collections/security-rules);
3. Wenn die Tabelle `rls: "inherit"` angibt, übernimmt sie `defaultRls` aus
   `backend/schema/index.ts`, und dies ist die zu bearbeitende Datei;
4. Führen Sie ein erneutes Deployment durch – beim Booten werden die Policies neu angewendet – oder
   führen Sie `rebase db push` aus.

Eine Policy, die Sie manuell in einer Migration geschrieben haben, wird von all dem nicht berührt,
und ihr Fix besteht weiterhin aus dem auszuführenden SQL.

## Die Prüfungen

Die unten angegebenen Schweregrade sind die Standardwerte; einige Prüfungen passen ihren Schweregrad
basierend auf ihren Funden selbst an, und der Bericht gibt immer den Grund an.

### rls-disabled

**Tabelle ohne Row-Level Security exponiert.** Kritisch.

Die Tabelle hat RLS deaktiviert *und* gewährt `SELECT`/`INSERT`/`UPDATE`/`DELETE` für eine Rolle, die
ein nicht vertrauenswürdiger Aufrufer erreichen kann (`anon`, `PUBLIC`, `web_anon`, `rebase_user`).
Postgres wendet keinerlei zeilenweisen Filter an, sodass Policies – falls vorhanden – niemals
konsultiert werden.

Eine Fremdtabelle mit einem solchen Grant wird ebenfalls gemeldet. Postgres kann RLS auf einer Fremdtabelle
nicht aktivieren, daher liefert der Grant alles aus, was der Remote-Server zurückgibt, und der
vorgeschlagene Fix widerruft stattdessen den Grant.

Eine Tabelle mit deaktiviertem RLS, aber ohne Grant für eine exponierte Rolle wird *nicht* gemeldet,
und ebenso wenig eine in einem Schema, auf dem diese Rolle kein `USAGE` besitzt – Postgres antwortet
mit „permission denied for schema“, bevor es die Tabelle überhaupt betrachtet. Sie ist nicht erreichbar,
und sie zu melden wäre reines Rauschen.

```sql
ALTER TABLE "public"."your_table" ENABLE ROW LEVEL SECURITY;
```

Das Aktivieren von RLS ohne Policies verweigert jede Zeile für jeden außer dem Eigentümer. Fügen Sie daher
die beabsichtigte Policy in derselben Migration hinzu – andernfalls haben Sie eine Sicherheitslücke gegen
einen stillen Ausfall eingetauscht. Siehe [rls-enabled-no-policies](#rls-enabled-no-policies).

### policy-always-true

**Policy gewährt bedingungslosen Zugriff.** Kritisch.

Eine permissive Policy, deren `USING`- oder `WITH CHECK`-Ausdruck eine konstante Wahrheit ist: `true`,
`(true)`, `1 = 1`, `1 > 0`, `NOT false`, `true OR <anything>` oder eine Konstante, die über einen Cast
mit sich selbst verglichen wird. Permissive Policies werden mit ODER verknüpft, sodass eine einzige
dieser Bedingungen den Zeilenfilter der Tabelle erfüllt, unabhängig davon, wie streng jede andere Policy ist.

Wie jede Prüfung meldet sie eine Gefährdung nur dann, wenn eine Rolle, auf die sie zutrifft, die Tabelle
auch erreichen kann: das für ihren Befehl erforderliche Privileg besitzt sowie `USAGE` auf dem Schema.
Ein `USING (true) TO anon` auf einer Tabelle, auf der `anon` über keinerlei Rechte verfügt, wird mit
„permission denied“ beantwortet, bevor die Policy überhaupt konsultiert wird. Eine solche Policy wird als
**Info** unter dem Titel *latent* gemeldet: Heute erreicht niemand die Tabelle darüber, und ein einzelnes
`GRANT` würde daraus eine kritische Exposition machen, ohne dass die Policy geändert wird. Info liegt unter
jedem `--fail-on`-Wert außer `info`, sodass ein Standarddurchlauf dadurch nie fehlschlägt.

Wenn nur das `WITH CHECK` einer `UPDATE`-Policy konstant ist – `USING (user_id = rebase.uid())
WITH CHECK (true)` –, wird dies als **hoch** eingestuft: `USING` bestimmt weiterhin, welche Zeilen
verändert werden dürfen, aber die Prüfung erlaubt es, dass eine veränderte Zeile jeden beliebigen Zustand
annimmt, wie etwa den eines anderen Benutzers. Bei einer `FOR ALL`-Policy lässt dieselbe Prüfung auch
jedes `INSERT` zu, weshalb dies kritisch bleibt.

Wenn `RESTRICTIVE`-Policies für denselben Befehl (`ALL` bei einem permissiven `ALL`) für jede exponierte
Rolle gelten, die die permissive Policy erreicht, wird dies auf „mittel“ herabgestuft und als etwas
gemeldet, das überprüft werden sollte, anstatt als Gewissheit, da restriktive Policies mit UND verknüpft
werden, nachdem die permissiven mit ODER ausgewertet wurden. Eine restriktive Policy, die andere Rollen
oder einen anderen Befehl betrifft, zählt nicht: Sie lässt die permissive Policy für alle offen, die sie
nicht abdeckt.

```sql
ALTER POLICY "your_policy" ON "public"."your_table"
    USING (user_id = rebase.uid());
```

Auf einer Rebase-Datenbank ist der Fix die Regel der Tabelle anstelle dieses Statements – siehe
[Ändern Sie die Regel, nicht die Policy](#auf-einer-rebase-datenbank-die-regel-ändern-nicht-die-policy). Ein
Standard-Scaffold meldet diese Prüfung für `posts`, `authors` und `tags` standardmäßig.

### policy-anonymous-tautology

**Policy prüft nur, ob eine Aufrufer-ID vorhanden ist.** Schweregrad hängt von der Plattform ab.

Der Ausdruck hat die Form `rebase.uid() IS NOT NULL` (oder `auth.uid()` auf Supabase und auf einer vor
Version 1.0 bereitgestellten Rebase-Datenbank): Er trennt angemeldete von nicht angemeldeten Aufrufern,
grenzt jedoch keine Zeilen ein. Jeder angemeldete Benutzer erreicht jede Zeile, die die Policy abdeckt.

Der Schweregrad ist plattformabhängig, und diese Unterscheidung ist wichtig:

- **Auf Supabase** gibt `auth.uid()` für anonyme Aufrufer `NULL` zurück, sodass dies eine funktionierende
  Prüfung darstellt, die nur für authentifizierte Benutzer gilt. Gemeldet als **niedrig** – eine Lücke
  bei der Datenabgrenzung zwischen angemeldeten Benutzern, keine Lücke für anonymen Zugriff. Dies gilt nur
  für `auth.uid()` (und den `sub`-Claim, den es liest): Eine nicht angemeldete Anfrage trägt immer noch den
  Anon-Key des Projekts, sodass `auth.role()` gleich `'anon'` ist und `auth.jwt()` den Claims dieses
  Schlüssels entspricht. Die gleiche Form, aufgebaut auf einem von beiden, ist *für nicht angemeldete
  Aufrufer wahr* und wird als **kritisch** gemeldet.
- **Auf Rebase oder PostgREST**, wo eine leere Aufrufer-ID in einen `'anonymous'`-Sentinel umgewandelt
  wird, ist der Ausdruck *auch für nicht angemeldete Aufrufer wahr*. Gemeldet als **kritisch**.
- **Auf einer nicht erkannten Plattform** wird dies als **mittel** gemeldet, da die Frage, ob es sich
  um eine Lücke handelt, davon abhängt, ob Ihr Stack einen solchen Sentinel verwendet.

Eine Datenbank gilt als Rebase-Datenbank, wenn sie das `rebase`-Schema besitzt. Die Rolle `rebase_user`
entscheidet dies nicht, da Rollen dem gesamten Server gehören und ein Server, der eine Rebase-App hostet,
auch andere Datenbanken enthalten kann.

```sql
-- Scope to the row's owner rather than to the existence of an id
ALTER POLICY "your_policy" ON "public"."your_table"
    USING (user_id = rebase.uid());

-- Or, if "any signed-in user" really is the intent, reject the sentinel explicitly
--     USING (rebase.uid() IS NOT NULL AND rebase.uid() <> 'anonymous');
```

Das vorgeschlagene SQL wird mit der Funktion für die Aufrufer-ID ausgegeben, die Ihre Datenbank tatsächlich
besitzt: `rebase.uid()` auf einer Rebase-Datenbank, `auth.uid()` auf Supabase und PostgREST. Beide Schreibweisen
werden beim Lesen von Policies erkannt, sodass eine Rebase-Datenbank, die sich mitten in der Migration vom
Vor-1.0-Schema `auth` befindet, weiterhin überprüft wird.

### policy-authenticated-tautology

**Policy gewährt jedem angemeldeten Aufrufer Zugriff auf jede Zeile.** Hoch; kritisch für die unten beschriebene Form der Rollenprüfung.

Die korrigierte Form der obigen Prüfung – `rebase.uid() IS NOT NULL AND rebase.uid() <>
'anonymous'` – und die Stelle, an der Entwickler oft stehenbleiben. Sie schließt nicht angemeldete Aufrufer
tatsächlich aus. Was sie jedoch nicht tut, ist, Zeilen einzugrenzen: Übrig bleibt *jedes registrierte Konto
darf jede Zeile dieser Tabelle lesen*, was eine andere Aussage ist als die, die normalerweise beabsichtigt
war. In einem Rebase-Projekt ist dies eine Regel, deren `condition` aus `policy.authenticated()` und nichts
anderem besteht, was die Datenbank als `rebase.uid() <> ALL (ARRAY['anonymous', 'anon'])` speichert.
Eine Regel, deren Bedingung lediglich `policy.registered()` lautet, wird ebenfalls gemeldet: Ihr zusätzliches
`NOT rebase.is_anonymous()` hält Gäste fern und grenzt ebenfalls keine Zeilen ein, sodass jedes Konto, das
kein Gast ist, jede Zeile liest. Mit dem Standardwert `--fail-on high` schlägt ein CI-Lauf, der eine solche
Policy scannt, nun fehl.

Eine Policy, deren Ausdruck lediglich die Rolle des Aufrufers prüft – `auth.role() = 'authenticated'`,
`(auth.jwt() ->> 'role') = 'authenticated'`, in beliebiger Reihenfolge –, wird ebenfalls unter dieser ID
gemeldet. Es handelt sich um ein als Ausdruck geschriebenes `TO authenticated USING (true)`, weshalb es den
Schweregrad erhält, den [`policy-always-true`](#policy-always-true) dafür vergibt: kritisch, oder hoch,
wenn nur das `WITH CHECK` einer `UPDATE`-Policy die Rollenprüfung darstellt.

Das ist das Muster, das eine `users`-Tabelle in ein Verzeichnis aller Adressen auf der Plattform verwandelt,
lesbar für jeden, der sich registriert hat – und wo die Registrierung offen ist, ist „jeder, der sich registriert hat“
schlichtweg jeder. Es wird separat von der anonymen Form gemeldet, da sich sowohl der Fix als auch der
Schweregrad unterscheiden und Sie berechtigterweise die eine Meldung unterdrücken möchten und die andere nicht.

```sql
-- Scope to the row
ALTER POLICY "your_policy" ON "public"."your_table"
    USING (user_id = rebase.uid());

-- Or, where members of a shared group really may see each other's rows, say which group
--     USING (EXISTS (SELECT 1 FROM memberships m
--                    WHERE m.org_id = your_table.org_id AND m.user_id = rebase.uid()));
```

Wenn die Tabelle tatsächlich für jedes Konto lesbar sein soll – eine gemeinsame Preisliste, eine Liste
von Ländern –, behalten Sie die Policy bei und unterdrücken Sie den Befund mit
`rls-check --skip policy-authenticated-tautology`.

### view-bypasses-rls

**View liest an der RLS ihrer Basistabelle vorbei.** Kritisch.

Eine View, die einer nicht vertrauenswürdigen Rolle gewährt wurde und ohne `security_invoker = true`
Daten aus einer durch RLS geschützten Tabelle abfragt. Die View wird mit den Rechten ihres **Eigentümers**
ausgeführt, liest die Basistabelle also als Eigentümer, und die Policies des Aufrufers werden niemals
angewendet. Dies ist der häufigste Weg, auf dem eine sorgfältig abgesicherte Tabelle Daten leckt.

```sql
ALTER VIEW "public"."your_view" SET (security_invoker = true);
```

Unter PostgreSQL-Versionen vor 15 existiert diese Option überhaupt nicht, sodass sich jede derartige View
so verhält. Dort wird der Befund als heuristisch gemeldet, und der Fix besteht darin, die Logik in eine
Funktion zu verlagern oder ein Upgrade durchzuführen.

Der Eigentümer ist normalerweise von den Policies der Basistabelle ausgenommen, aber nicht immer. Wenn der
Eigentümer der View kein Superuser ist, kein `BYPASSRLS` besitzt und nicht der Eigentümer der Basistabelle
ist (oder sie mit `FORCE ROW LEVEL SECURITY` besitzt), gelten die Policies für den Eigentümer. Die View gibt
dann jedem Aufrufer gleichermaßen diejenigen Zeilen zurück, die diese Policies dem Eigentümer gewähren.
Das können weniger Zeilen sein, als ein Aufrufer sehen sollte, oder mehr. Der Befund wird dennoch gemeldet,
da die Zeilen nicht davon abhängen, wer die Abfrage stellt, allerdings als heuristisch statt als gesichert.
Der Fix ist derselbe.

### matview-bypasses-rls

**Materialized View legt durch RLS geschützte Daten offen.** Hoch.

Materialized Views können keine Row-Level Security haben, und die darin enthaltenen Daten sind ein
gespeicherter Snapshot, der von derjenigen Person erstellt wurde, die den Refresh durchgeführt hat.
Wenn einer nicht vertrauenswürdigen Rolle Rechte darauf gewährt werden und die definierende Abfrage eine
durch RLS geschützte Tabelle liest, kann keine Policy helfen – widerrufen Sie den Grant oder verschieben
Sie die Materialized View in ein Schema, das für nicht vertrauenswürdige Rollen nicht erreichbar ist.
Der vorgeschlagene Fix widerruft jeden Grant, der eine nicht vertrauenswürdige Rolle erreicht, von der
jeweils im Grant genannten Rolle: Ein Grant an eine Rolle, die `anon` erbt, wird durch `REVOKE … FROM anon`
nicht entfernt.

```sql
REVOKE ALL ON "public"."your_matview" FROM "anon";
```

### anonymous-write-allowed

**Nicht authentifizierte Aufrufer können schreiben.** Hoch.

Eine permissive `INSERT`/`UPDATE`/`DELETE`/`ALL`-Policy, die ohne Authentifizierung erreichbar ist,
deren Check-Ausdruck jede Zeile akzeptiert und die durch einen passenden Grant gestützt wird.

Die Bedingung „akzeptiert jede Zeile“ ist wesentlich und bewusst eng gefasst. Supabase gewährt `anon`
und `authenticated` standardmäßig volle DML-Rechte; eine Policy, die auf diese Rollen abzielt, ist daher
für sich genommen kein Problem – ein lehrbuchmäßiges `FOR INSERT TO public WITH CHECK (user_id = auth.uid())`
ist korrekt und wird nicht gemeldet.

Eine Policy erreicht einen nicht authentifizierten Aufrufer über `TO public`, über eine Rolle namens
`anon` oder `web_anon` oder über eine Rolle, deren Mitglied eine dieser Rollen ist: `TO app_writer`
zählt, wenn `anon` die Rolle `app_writer` erbt.

Auf Rebase gibt es keine `anon`-Rolle. Jede Anfrage wird als `rebase_user` ausgeführt, einschließlich
einer nicht angemeldeten Anfrage, wenn die API dies zulässt (`AUTH_REQUIRE=false` oder `auth.requireAuth: false`),
und jedes Gastkonto aus einer anonymen Anmeldung. Die Datenbank kann diese Einstellung nicht sehen, daher
wird auf Rebase ein Schreibvorgang, den nur `rebase_user` erreicht, als heuristisch gemeldet. Wenn das API-Gate
aktiviert und die Gast-Anmeldung deaktiviert ist, erreichen nur angemeldete Benutzer die Policy – und diese
können weiterhin jede beliebige Zeile schreiben. Grenzen Sie die Schreibregel der Tabelle auf den Aufrufer
(ein `ownerField`) oder auf `roles` ein.

### unqualified-column-in-subquery

**Nicht qualifizierte Spalte innerhalb einer Policy-Unterabfrage.** Hoch, heuristisch.

Ein einfacher Spaltenname innerhalb einer `EXISTS`/`IN`-Unterabfrage, der *sowohl* in der inneren Relation
als auch in der Tabelle der Policy selbst existiert. Postgres bindet ihn an die **innere** Tabelle, sodass
die Korrelation zur äußeren Zeile, die Sie eigentlich schreiben wollten, stillschweigend verloren geht
und das Prädikat trivial erfüllbar wird – oder trivial unerfüllbar, wodurch jede Zeile für jeden verweigert wird.

```sql
-- The bug: `id` binds to memberships, not organizations
USING (EXISTS (SELECT 1 FROM memberships WHERE id = organizations.id ...))

-- Qualify it
USING (EXISTS (SELECT 1 FROM memberships m WHERE m.org_id = organizations.id ...))
```

**Was der Katalog zeigt, ist nicht das, was Sie geschrieben haben.** `pg_policies.qual` ist Postgres' eigene
Neudarstellung des Parse-Baums, und innerhalb einer Unterabfrage werden Spaltenreferenzen immer qualifiziert,
sodass der einfache Name zum Zeitpunkt des Auslesens des Katalogs nicht mehr sichtbar ist. Was überlebt, ist
seine Auswirkung: Das unqualifizierte `org_id` wurde an die innere Tabelle gebunden, und das gespeicherte
Prädikat vergleicht die Spalte dieser Tabelle mit sich selbst –
`m.org_id = m.org_id`. Dieser Selbstvergleich ist das, was diese Prüfung auf einer laufenden Datenbank findet.

**Das Fehlen dieses Befunds ist kein Beweis für Sicherheit.** Ein unqualifizierter Name, der mit einer
*anderen* inneren Spalte verglichen wird (`organization_id = id`), wird als `m.organization_id = m.id`
gespeichert, was genau wie ein beabsichtigter Vergleich aussieht. Wenn diese Prüfung anschlägt, ist dies ein
starker Hinweis; wenn sie es nicht tut, beweist dies nichts.

### junction-table-unprotected

**Many-to-Many-Join-Tabelle ohne RLS.** Hoch, heuristisch.

Eine Tabelle, die im Wesentlichen nur aus den beiden Endpunkten zweier Fremdschlüssel besteht, die beide
auf Tabellen verweisen, die *tatsächlich* RLS besitzen, während sie selbst über keine Row-Level Security
verfügt – und die für eine Rolle lesbar oder beschreibbar ist, unter der ein nicht vertrauenswürdiger Aufrufer
ankommt. Beide Seiten der Relation sind geschützt und die Kante dazwischen ist offen – was ausreicht, um die
Relation zu enumerieren, selbst wenn keiner der Endpunkte gelesen werden kann.

Heuristisch, da eine Verknüpfungstabelle anhand ihrer Form abgeleitet wird. Wenn Ihre absichtlich
öffentlich ist, verwenden Sie `--skip junction-table-unprotected`.

### rls-enabled-not-forced

**RLS aktiviert, aber für den Tabelleneigentümer nicht erzwungen.** Mittel, hoch oder kritisch.

Ohne `FORCE` ist der Eigentümer der Tabelle von seinen eigenen Policies ausgenommen, ebenso wie jedes
Mitglied der Eigentümerrolle. Das ist harmlos, wenn der Eigentümer eine Provisionierungsrolle ist, unter der
sich nichts verbindet, und schwerwiegend, wenn sich Ihre Anwendung als Eigentümer verbindet – daher ist
dies **kritisch**, wenn eine Rolle, unter der ein nicht vertrauenswürdiger Aufrufer ankommt, die Tabelle
besitzt oder Mitglied der Eigentümerrolle ist, **hoch**, wenn sich die Eigentümerrolle anmelden kann oder
eine Rolle, die dies kann, Mitglied davon ist, und andernfalls **mittel**.

Wenn der Eigentümer ein Superuser ist oder `BYPASSRLS` besitzt, bleibt es bei „mittel“ und weist darauf hin:
`FORCE` kann eine solche Rolle nicht einschränken, und etwas anderes zu suggerieren wäre irreführend.

```sql
ALTER TABLE "public"."your_table" FORCE ROW LEVEL SECURITY;
```

### rls-enabled-no-policies

**RLS aktiviert ohne Policies.** Mittel.

Keine Sicherheitslücke – das Gegenteil. RLS aktiviert mit null Policies verweigert jede Zeile für jeden
außer dem Eigentümer. Es wird gemeldet, weil es sich um einen *unsichtbaren* Fehler handelt: Die API gibt
`[]` zurück, und eine leere Tabelle ist nicht von einer gefilterten Tabelle zu unterscheiden. Diese Konfiguration
hat in der Produktion schon wochenlang stillschweigend leere Tabellen ausgeliefert.

### policy-role-unreachable

**Policies zielen auf Rollen ab, unter denen sich nichts verbindet.** Mittel.

Jede Policy auf der Tabelle benennt Rollen, die nicht existieren, sich nicht anmelden können und die keine
Login-Rolle transitiv erbt. Die Policies sehen korrekt aus, gelten aber für niemanden, sodass die Tabelle
als leer gelesen wird.

Der klassische Fall sind Policies, die mit `TO authenticated` – einem Supabase-Rollennamen – auf einer
Datenbank geschrieben wurden, deren Anfragen tatsächlich unter einer anderen Rolle eingehen.

### grant-to-public

**Tabellenprivilegien an PUBLIC gewährt.** Mittel.

Ein DML-Privileg, das `PUBLIC` gewährt wurde, auf einer Tabelle oder einer Fremdtabelle. Selbst bei aktivierter
RLS erweitert dies den Kreis derjenigen, für *die* Policies ausgewertet werden, und es ist fast nie beabsichtigt.

```sql
REVOKE ALL ON "public"."your_table" FROM PUBLIC;
```

### security-definer-mutable-search-path

**SECURITY DEFINER-Routine mit veränderbarem search_path.** Mittel.

Die Routine wird als ihr Eigentümer ausgeführt – oft ein Superuser –, während der Aufrufer steuert, wie ihre
Bezeichner aufgelöst werden. Das ist das Standardmuster für Privilege Escalation, und alles, worauf die Routine
zugreift, wird mit den Rechten des Eigentümers gelesen, wodurch RLS umgangen wird.

```sql
ALTER FUNCTION "public"."your_function"() SET search_path = pg_catalog, public;
```

### current-setting-throws

**Policy ruft `current_setting()` ohne `missing_ok` auf.** Niedrig, heuristisch.

`current_setting('app.tenant_id')` mit einem einzigen Argument löst eine Exception aus, wenn die
Einstellung nicht gesetzt ist, anstatt `NULL` zurückzugeben. Anstatt also die Zeile zu verweigern,
schlägt die Anfrage fehl – der Aufrufer sieht einen 500-Fehler anstelle eines leeren Ergebnisses, und
Middleware, die 5xx-Fehler wiederholt, wird eine Anfrage wiederholen, die niemals erfolgreich sein kann.

```sql
ALTER POLICY "your_policy" ON "public"."your_table"
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
```

## Was dieses Tool nicht tut

Klarheit über die Grenzen zu schaffen, ist der Punkt – ein Sicherheitstool, das seine Abdeckung überschätzt,
ist schlechter als gar keines.

- **Es ist ein statisches Audit des Katalogs.** Es liest `pg_class`, `pg_policies`, `pg_depend` und verwandte
  Tabellen. Es verbindet sich nicht als Ihre `anon`-Rolle und versucht nicht, Ihre Daten zu lesen, sodass es nicht
  bestätigen kann, dass eine Exposition über Ihre API erreichbar ist.
- **Es kann nicht beweisen, dass eine Policy korrekt ist.** Es findet Muster, von denen bekannt ist, dass sie
  falsch sind. Eine Policy, die jede Prüfung hier besteht, kann dennoch die falsche Geschäftslogik ausdrücken.
- **Ein sauberer Bericht ist keine Sicherheitszertifizierung.** Beachten Sie insbesondere den Hinweis zu
  [unqualified-column-in-subquery](#unqualified-column-in-subquery): Postgres schreibt Policy-Ausdrücke um,
  sodass einige Fehler im Katalog überhaupt nicht mehr sichtbar sind.
- **Es prüft keine Autorisierung auf Anwendungsebene**, API-Keys, Netzwerkexposition, den Umgang mit Secrets
  oder irgendetwas außerhalb der Datenbank.

## Verwandte Themen

- [Row-Level Security](/docs/collections/security-rules) – das `rls` einer Rebase-Tabelle, das zu den
  von diesem Tool überprüften Policies kompiliert wird.
- [Nur Backend](/docs/getting-started/headless/) – warum eine Tabelle ohne Policy in einem Headless-Projekt
  überhaupt nicht ausgeliefert wird.
- [REST-API](/docs/backend/api/) – die Angriffsfläche, die eine permissive Policy offenlegt.
