---
sourceHash: 8443765eb7147143
slug: de/docs/rls-check
title: rls-check
description: Überprüfe Row-Level Security auf jeder PostgreSQL-Datenbank — Supabase, Neon, RDS oder deinem eigenen Server. Schreibgeschützt, keine Registrierung, kein Rebase erforderlich.
---

# rls-check

`rls-check` liest den Katalog einer PostgreSQL-Datenbank aus und meldet, was tatsächlich freigegeben ist: Tabellen, die ohne Row-Level Security bereitgestellt werden, Richtlinien (Policies), die für jeden als `true` ausgewertet werden, Views, die direkt an der RLS ihrer Basistabellen vorbeilesen, und Join-Tabellen, die vergessen wurden, während beide Endpunkte abgesichert wurden.

Es funktioniert mit **jeder** Postgres — Supabase, Neon, RDS, Cloud SQL oder einem Server, den du selbst betreibst. Es erfordert kein Rebase und ist nützlich, unabhängig davon, ob du Rebase jemals einsetzt.

```bash
npx @rebasepro/rls-check
```

Führe es in deinem Projektverzeichnis aus, und es findet die Datenbank selbst: `DATABASE_URL`, dann
`POSTGRES_URL`, dann eine `.env` daneben. Übergib die Verbindungszeichenfolge nur dann als Argument,
wenn das nicht möglich ist — npm gibt die Befehlszeile aus, bevor das Programm startet, und deine
Shell zeichnet sie auf, sodass ein Passwort in einem Argument an zwei Stellen landet, die `rls-check`
nicht schwärzen kann. `$DATABASE_URL` ist dort nicht sicherer: Die Shell expandiert es, bevor npm es
überhaupt sieht.

Es ist bauartbedingt schreibgeschützt: Es öffnet eine schreibgeschützte Transaktion und führt Katalogabfragen aus. Es schreibt nichts und sendet nichts irgendwohin — es gibt keine Telemetrie und keinen Netzwerkaufruf außer dem zu deiner Datenbank.

## Ausführung

```bash
# From the environment — DATABASE_URL, then POSTGRES_URL, then a .env in the cwd
npx @rebasepro/rls-check

# For a database that is not the one in your environment
DATABASE_URL="postgres://user:pass@host:5432/dbname" npx @rebasepro/rls-check

# As an argument. Works, but see the warning above about where the password lands
npx @rebasepro/rls-check "postgres://user:pass@host:5432/dbname"
```

Wenn dein Passwort `@`, `:`, `/`, `?` oder `#` enthält, kodierte es als Percent-Encoding (Prozent-Kodierung). Das ist bei weitem die häufigste Ursache für einen Authentifizierungsfehler an dieser Stelle, und `rls-check` weist darauf hin, anstatt dich raten zu lassen.

### Optionen

| Option | Bedeutung |
| --- | --- |
| `--json` | Maschinenlesbare Ausgabe auf stdout und sonst nichts auf stdout |
| `--html <pfad>` | Schreibt zusätzlich einen eigenständigen HTML-Bericht dorthin. Eine Datei, keine Netzwerkaufrufe |
| `--schema <name>` | Scan auf ein Schema beschränken. Wiederholbar oder durch Kommas getrennt |
| `--role <name>` | Diese Rolle als eine behandeln, unter der ein nicht vertrauenswürdiger Aufrufer ankommt — zusätzlich zu `anon`, `authenticated`, `web_anon` und `rebase_user`. Wiederholbar oder durch Kommas getrennt |
| `--fail-on <severity>` | Beenden mit Code 1 bei oder über dieser Schwere (Severity). Standard `high`; `none` schlägt nie fehl |
| `--only <id>` | Nur diese Prüfungen ausführen. Wiederholbar oder durch Kommas getrennt |
| `--skip <id>` | Diese Prüfungen überspringen. Wiederholbar oder durch Kommas getrennt |
| `--list-checks` | Den Katalog ausgeben und beenden |
| `--timeout <ms>` | Statement-Timeout, Standard 15000 |
| `--quiet` | Nur Ergebnisse — kein Banner, keine Zusammenfassung |
| `--no-color` | ANSI-Farben deaktivieren (berücksichtigt auch `NO_COLOR` und nicht-TTY stdout) |

Eine unbekannte ID, die an `--only` oder `--skip` übergeben wird, führt zu einem Fehler statt zu einem stillschweigenden No-Op, da ein Tippfehler an dieser Stelle den Scan unbemerkt schwächen würde. Eine `--role`, die nicht in `pg_roles` steht, ist aus demselben Grund ein Fehler: Jede Prüfung setzt an einer Berechtigung für eine exponierte Rolle an, also entfernt ein Name, der auf nichts passt, stillschweigend Abdeckung.

Der Kopf des Berichts nennt die Rollen, die der Lauf als exponiert behandelt hat — so siehst du auf einen Blick, ob `No findings` die Rolle abgedeckt hat, mit der deine Anwendung verbindet:

```
Exposed   PUBLIC, anon, authenticated (add yours with --role)
```

Verbindet sich der Scan mit einer Rolle, die Row-Level Security tatsächlich einschränken *kann* — kein Superuser, kein Eigentümer, kein `BYPASSRLS` —, wird sie der Menge hinzugefügt, und der Bericht sagt das. Ein Scan mit der Rolle deiner eigenen Anwendung kommt dem, die Datenbank zu fragen, was deine API sieht, am nächsten.

### Exit-Codes

| Code | Bedeutung |
| --- | --- |
| `0` | Keine Ergebnisse bei oder über dem `--fail-on`-Schwellenwert |
| `1` | Mindestens ein Ergebnis bei oder über dem Schwellenwert |
| `2` | Der Scan konnte nicht ausgeführt werden — ungültige Argumente, Verbindung abgelehnt, Authentifizierungsfehler, Timeout |

`1` und `2` sind bewusst unterschiedlich: Eine fehlerhafte Verbindung darf niemals wie eine saubere Datenbank aussehen.

### In CI

```yaml
- name: Audit RLS
  run: npx @rebasepro/rls-check --fail-on high
  env:
    DATABASE_URL: ${{ secrets.DATABASE_URL }}
```

**Ein neues Rebase-Projekt besteht das am ersten Tag nicht, und das ist Absicht.** Die `defaultSecurityRules` des Scaffolds öffnen Lesezugriffe für alle — `{ operation: "select", access: "public" }` in `config/collections/index.ts` —, sodass `posts`, `authors` und `tags` jeweils ein kritisches `policy-always-true` melden. `access: "public"` betrifft *Zeilen*, nicht die Frage, wer die API aufrufen darf: Eine Anfrage ohne Token wird weiterhin mit 401 beantwortet, solange `AUTH_REQUIRE` aktiv ist. Der Befund ist trotzdem richtig, denn das ist das Einzige, was vor den Daten steht.

Entscheide, welcher der beiden Fälle vorliegt, bevor du das in CI einbaust:

- **Die Regeln sind ein Platzhalter** — ersetze sie durch die, die deine Daten wirklich brauchen ([Sicherheitsregeln](/docs/collections/security-rules)), und die Befunde verschwinden;
- **Die Zeilen sind wirklich für alle lesbar** — sage das einmal, mit `npx @rebasepro/rls-check --fail-on high --skip policy-always-true`, und wisse, was du aufgibst: `--skip` schaltet die Prüfung überall ab, auch für die Tabelle, die du nächsten Monat hinzufügst.

### JSON-Ausgabe

`--json` gibt ein stabiles Objekt aus: `scannedAt`, `database` (nur Host und Name — niemals Zugangsdaten), `serverVersion`, `platform`, `scannerIsPrivileged`, `exposedRoles`, `stats`, `findings` und `diagnostics`. Jedes Ergebnis (Finding) enthält `id`, `severity`, `title`, `target`, `detail`, `impact`, `fix`, `docs` und `confidence`.

`exposedRoles` und `diagnostics` gehören zum Vertrag, sie sind kein Beiwerk: Jede Prüfung setzt an der Menge der exponierten Rollen an, und `diagnostics.degraded` ist das, woran ein Konsument „nichts war falsch“ von „der Scan konnte nicht nachsehen“ unterscheidet.

## So liest du den Bericht

**Bestätigte Ergebnisse kommen zuerst; heuristische befinden sich in einem separaten Abschnitt „Prüfung wert“ (worth checking).** Eine heuristische Prüfung kann die Absicht nicht erkennen — eine Verknüpfungstabelle (Junction Table), die du absichtlich offen gelassen hast, ist kein Fehler —, daher sind diese als Fragen formuliert und werden niemals mit den definitiven Befunden vermischt.

**Achte auf den Hinweis zu Berechtigungen.** Wenn der Scan als Superuser, Tabelleneigentümer oder als Rolle mit `BYPASSRLS` eine Verbindung herstellt, wird dies gemeldet. Diese Rolle sieht den tatsächlichen Katalog, was das Audit überhaupt erst möglich macht, bedeutet aber auch, dass nichts im Bericht das beschreibt, was *diese* Verbindung erlebt. Die Ergebnisse beziehen sich darauf, was andere Rollen erhalten.

### Auf einer Rebase-Datenbank die Regel ändern, nicht die Policy

Jede Policy in einem Rebase-Deployment wird aus den `securityRules` einer Collection kompiliert, und die Runtime **wendet sie bei jedem Start erneut an**: Sie verwirft jede generierte Policy und erstellt sie aus der Konfiguration neu. Ein `ALTER POLICY` gegen eine davon überlebt daher genau bis zum nächsten Neustart, und der Befund kommt mit zurück — nachdem du zugesehen hast, wie er verschwand.

`rls-check` erkennt diese Policies (ein Name der Form `<tabelle>_<operation>_<hash>` oder ein Aufruf von `rebase.uid()` / `rebase.roles()` im Ausdruck) und schlägt statt SQL die Regel vor. Wenn ein Fix das sagt:

1. Suche die Collection, deren Tabelle er nennt, unter `config/collections/`;
2. ändere ihre `securityRules` — siehe [Sicherheitsregeln](/docs/collections/security-rules);
3. deklariert die Collection keine eigenen, erbt sie `defaultSecurityRules` aus `config/collections/index.ts`, und das ist die Datei, die du bearbeiten musst;
4. deploye neu — der Start wendet die Policies erneut an — oder führe `rebase db push` aus.

Eine Policy, die du selbst in einer Migration geschrieben hast, wird davon nicht berührt, und ihr Fix bleibt das auszuführende SQL.

## Die Prüfungen

Die folgenden Schweregrade (Severities) sind die Standardwerte; mehrere Prüfungen passen ihren Schweregrad basierend auf ihren Funden selbst an, und der Bericht gibt immer den Grund an.

### rls-disabled

**Tabelle ohne Row-Level Security offengelegt.** Kritisch.

Bei der Tabelle ist RLS deaktiviert *und* sie gewährt `SELECT`/`INSERT`/`UPDATE`/`DELETE` einer Rolle, die ein nicht vertrauenswürdiger Aufrufer erreichen kann (`anon`, `PUBLIC`, `web_anon`, `rebase_user`). Postgres wendet überhaupt keinen Filter pro Zeile an, sodass Policies — falls vorhanden — nie konsultiert werden.

Eine Tabelle mit deaktivierter RLS, aber ohne Rechtevergabe an eine exponierte Rolle wird *nicht* gemeldet. Sie ist nicht erreichbar, und eine Meldung wäre nur störendes Rauschen.

```sql
ALTER TABLE "public"."your_table" ENABLE ROW LEVEL SECURITY;
```

Das Aktivieren von RLS ohne Policies verweigert jedem außer dem Eigentümer den Zugriff auf jede Zeile. Füge daher die beabsichtigte Policy in derselben Migration hinzu — andernfalls hast du ein Sicherheitsrisiko gegen einen stillschweigenden Ausfall eingetauscht. Siehe [rls-enabled-no-policies](#rls-enabled-no-policies).

### policy-always-true

**Policy gewährt bedingungslosen Zugriff.** Kritisch.

Eine erlaubende (permissive) Policy, deren `USING`- oder `WITH CHECK`-Ausdruck eine ständige Wahrheit ist — `true`, `(true)`, `1 = 1`. Erlaubende Policies werden mit ODER verknüpft, sodass eine einzige dieser Policies den Zeilenfilter der Tabelle erfüllt, egal wie streng alle anderen Policies sind.

Wenn eine `RESTRICTIVE`-Policy denselben Befehl abdeckt, wird dies auf „Mittel“ (Medium) herabgestuft und als etwas zu Überprüfendes statt als Gewissheit gemeldet, da restriktive Policies mit UND verknüpft werden, nachdem die erlaubenden mit ODER verknüpft wurden.

```sql
ALTER POLICY "your_policy" ON "public"."your_table"
    USING (user_id = rebase.uid());
```

Auf einer Rebase-Datenbank ist der Fix die Regel der Collection statt dieses Statements — siehe „Auf einer Rebase-Datenbank die Regel ändern, nicht die Policy“. Ein unverändertes Scaffold meldet diese Prüfung bewusst für `posts`, `authors` und `tags`.

### policy-anonymous-tautology

**Policy prüft nur, ob eine Aufrufer-ID existiert.** Schweregrad hängt von der Plattform ab.

Der Ausdruck hat die Form `rebase.uid() IS NOT NULL` (oder `auth.uid()` auf Supabase und auf einer Rebase-Datenbank, die vor 1.0 bereitgestellt wurde): Er trennt angemeldete von abgemeldeten Aufrufern, schränkt jedoch keine Zeilen ein. Jeder angemeldete Benutzer erreicht jede Zeile, die die Policy abdeckt.

Der Schweregrad ist plattformabhängig, und dieser Unterschied ist wichtig:

- **Auf Supabase** gibt `auth.uid()` für anonyme Aufrufer `NULL` zurück, sodass dies eine funktionierende Prüfung nur für authentifizierte Benutzer ist. Gemeldet als **niedrig** — eine Lücke bei der Datenabgrenzung zwischen angemeldeten Benutzern, kein Sicherheitsloch für anonymen Zugriff.
- **Auf Rebase oder PostgREST**, wo eine leere Aufrufer-ID in einen `'anonymous'`-Platzhalter umgewandelt wird, ist der Ausdruck *auch für abgemeldete Aufrufer true*. Gemeldet als **kritisch**.
- **Auf einer nicht erkannten Plattform** gemeldet als **mittel**, da die Frage, ob es sich um ein Sicherheitsloch handelt, davon abhängt, ob dein Stack einen solchen Platzhalter verwendet.

```sql
-- Scope to the row's owner rather than to the existence of an id
ALTER POLICY "your_policy" ON "public"."your_table"
    USING (user_id = rebase.uid());

-- Or, if "any signed-in user" really is the intent, reject the sentinel explicitly
--     USING (rebase.uid() IS NOT NULL AND rebase.uid() <> 'anonymous');
```

Das vorgeschlagene SQL wird mit der Aufrufer-ID-Funktion ausgegeben, die deine Datenbank tatsächlich besitzt: `rebase.uid()` auf einer Rebase-Datenbank, `auth.uid()` auf Supabase und PostgREST. Beide Schreibweisen werden beim Lesen von Policies erkannt, sodass eine Rebase-Datenbank in der Migration vom Schema `auth` vor 1.0 weiterhin überprüft wird.

### view-bypasses-rls

**View liest an der RLS ihrer Basistabelle vorbei.** Kritisch.

Eine View, die einer nicht vertrauenswürdigen Rolle gewährt wurde und aus einer durch RLS geschützten Tabelle ohne `security_invoker = true` liest. Die View wird mit den Berechtigungen ihres **Eigentümers** ausgeführt, sodass sie die Basistabelle als Eigentümer liest und die Policies des Aufrufers nie angewendet werden. Das ist der häufigste Weg, wie eine sorgfältig abgesicherte Tabelle Daten leakt.

```sql
ALTER VIEW "public"."your_view" SET (security_invoker = true);
```

Unter PostgreSQL vor Version 15 existiert die Option überhaupt nicht, sodass sich jede solche View so verhält. Dort wird das Ergebnis als heuristisch gemeldet, und die Lösung besteht darin, die Logik in eine Funktion zu verlagern oder ein Upgrade durchzuführen.

### matview-bypasses-rls

**Materialized View legt durch RLS geschützte Daten offen.** Hoch.

Materialized Views können keine Row-Level Security haben, und die Daten darin sind ein gespeicherter Schnappschuss, der von der Person/Rolle erstellt wurde, die ihn aktualisiert hat. Wenn eine solche View einer nicht vertrauenswürdigen Rolle gewährt wird und ihre definierende Abfrage eine RLS-geschützte Tabelle liest, kann keine Policy helfen — widerrufe die Rechtevergabe oder verschiebe die Materialized View in ein Schema, das für nicht vertrauenswürdige Rollen unerreichbar ist.

```sql
REVOKE ALL ON "public"."your_matview" FROM "anon";
```

### anonymous-write-allowed

**Nicht authentifizierte Aufrufer können schreiben.** Hoch.

Eine erlaubende `INSERT`/`UPDATE`/`DELETE`/`ALL`-Policy, die ohne Authentifizierung erreichbar ist und deren Prüfausdruck jede Zeile akzeptiert, unterstützt durch eine entsprechende Rechtevergabe.

Die Bedingung „akzeptiert jede Zeile“ ist essenziell und bewusst eng gefasst. Supabase gewährt `anon` und `authenticated` standardmäßig vollständige DML-Rechte, sodass eine Policy, die auf diese Rollen abzielt, für sich genommen kein Problem darstellt — ein Lehrbuchbeispiel wie `FOR INSERT TO public WITH CHECK (userId = auth.uid())` ist korrekt und wird nicht gemeldet.

### unqualified-column-in-subquery

**Unqualifizierte Spalte innerhalb einer Policy-Unterabfrage.** Hoch, heuristisch.

Ein bloßer Spaltenname innerhalb einer `EXISTS`/`IN`-Unterabfrage, der sowohl in der *inneren* Relation als auch in der eigenen Tabelle der Policy existiert. Postgres bindet ihn an die **innere** Tabelle, sodass die Korrelation zur äußeren Zeile, die du schreiben wolltest, stillschweigend verschwindet und das Prädikat trivial erfüllbar wird — oder trivial unerfüllbar, was allen den Zugriff auf jede Zeile verweigert.

```sql
-- The bug: `id` binds to memberships, not organizations
USING (EXISTS (SELECT 1 FROM memberships WHERE id = organizations.id ...))

-- Qualify it
USING (EXISTS (SELECT 1 FROM memberships m WHERE m.org_id = organizations.id ...))
```

**Das Fehlen dieses Befundes ist kein Sicherheitsnachweis.** `pg_policies.qual` ist die Postgres-eigene Neudarstellung des Syntaxbaums (Parse Tree) und qualifiziert Spaltenreferenzen in der Regel neu — sodass der ursprüngliche bloße Name zum Zeitpunkt des Lesens des Katalogs häufig nicht mehr sichtbar ist. Wenn diese Prüfung anschlägt, ist das ein starker Indikator; wenn sie es nicht tut, beweist das nichts.

### junction-table-unprotected

**N:M-Verknüpfungstabelle (Junction Table) ohne RLS.** Hoch, heuristisch.

Eine Tabelle, die im Grunde nur aus den beiden Endpunkten zweier Fremdschlüssel besteht, die beide auf Tabellen verweisen, die *sehr wohl* RLS besitzen, jedoch selbst keine Row-Level Security aufweist. Beide Seiten der Beziehung sind gesperrt, aber die Verbindung dazwischen ist offen — was ausreicht, um die Beziehung aufzuzählen, selbst wenn keiner der beiden Endpunkte gelesen werden kann.

Heuristisch, weil eine Verknüpfungstabelle anhand ihrer Struktur abgeleitet wird. Wenn deine absichtlich öffentlich ist, verwende `--skip junction-table-unprotected`.

### rls-enabled-not-forced

**RLS aktiviert, aber für den Tabelleneigentümer nicht erzwungen.** Mittel oder Hoch.

Ohne `FORCE` ist der Eigentümer der Tabelle von den eigenen Policies ausgenommen. Das ist harmlos, wenn der Eigentümer eine Provisionierungsrolle ist, mit der sich nichts verbindet, und schwerwiegend, wenn sich deine Anwendung als Eigentümer verbindet — daher ist dies **hoch**, wenn sich die Eigentümerrolle anmelden kann, und andernfalls **mittel**.

Wenn der Eigentümer ein Superuser ist oder `BYPASSRLS` besitzt, bleibt es bei mittel und weist darauf hin: `FORCE` kann eine solche Rolle nicht einschränken, und etwas anderes anzudeuten wäre irreführend.

```sql
ALTER TABLE "public"."your_table" FORCE ROW LEVEL SECURITY;
```

### rls-enabled-no-policies

**RLS aktiviert ohne Policies.** Mittel.

Kein Sicherheitsloch — das Gegenteil. RLS mit null Policies verweigert jedem außer dem Eigentümer den Zugriff auf jede Zeile. Es wird gemeldet, weil es ein *unsichtbarer* Fehler ist: Die API gibt `[]` zurück, und eine leere Tabelle ist nicht von einer gefilterten zu unterscheiden. Diese Konfiguration hat in der Produktion stellenweise wochenlang stillschweigend leere Collections geliefert.

### policy-role-unreachable

**Policies zielen auf Rollen ab, mit denen sich nichts verbindet.** Mittel.

Jede Policy für die Tabelle benennt Rollen, die nicht existieren, sich nicht anmelden können und die keine Anmelderolle transitiv erbt. Die Policies sehen korrekt aus, gelten jedoch für niemanden, sodass die Tabelle als leer gelesen wird.

Der klassische Fall sind Policies, die mit `TO authenticated` — einem Supabase-Rollennamen — auf einer Datenbank geschrieben wurden, deren Anfragen tatsächlich als eine andere Rolle eingehen.

### grant-to-public

**Tabellenrechte an PUBLIC vergeben.** Mittel.

Ein DML-Recht, das `PUBLIC` gewährt wurde. Selbst bei aktivierter RLS erweitert dies den Kreis derjenigen, für die Policies ausgewertet werden, und das geschieht fast nie absichtlich.

```sql
REVOKE ALL ON "public"."your_table" FROM PUBLIC;
```

### security-definer-mutable-search-path

**SECURITY DEFINER-Routine mit veränderbarem search_path.** Mittel.

Die Routine wird als ihr Eigentümer ausgeführt — oft ein Superuser —, während der Aufrufer steuert, wie ihre Bezeichner aufgelöst werden. Das ist das klassische Muster für Rechteausweitung (Privilege Escalation), und alles, worauf die Routine zugreift, wird mit den Rechten des Eigentümers gelesen, wodurch RLS umgangen wird.

```sql
ALTER FUNCTION "public"."your_function"() SET search_path = pg_catalog, public;
```

### current-setting-throws

**Policy ruft `current_setting()` ohne `missing_ok` auf.** Niedrig, heuristisch.

`current_setting('app.tenant_id')` mit einem einzigen Argument *löst einen Fehler aus*, wenn die Einstellung nicht gesetzt ist, anstatt `NULL` zurückzugeben. Anstatt also die Zeile zu verweigern, schlägt die Anfrage fehl — der Aufrufer sieht einen 500er-Fehler statt eines leeren Ergebnisses, und Middleware, die 5xx-Fehler erneut versucht, wiederholt eine Anfrage, die niemals erfolgreich sein kann.

```sql
ALTER POLICY "your_policy" ON "public"."your_table"
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
```

## Was dieses Tool nicht tut

Klarheit über die Grenzen zu haben, ist entscheidend — ein Sicherheitstool, das seine Abdeckung überschätzt, ist schlimmer als gar keines.

- **Es ist ein statisches Katalog-Audit.** Es liest `pg_class`, `pg_policies`, `pg_depend` und verwandte Tabellen. Es verbindet sich nicht als deine `anon`-Rolle und versucht nicht, deine Daten zu lesen, sodass es nicht bestätigen kann, ob eine Offenlegung über deine API erreichbar ist.
- **Es kann nicht beweisen, dass eine Policy korrekt ist.** Es findet Muster, die bekanntermaßen falsch sind. Eine Policy, die jede Prüfung hier besteht, kann dennoch die falsche Geschäftslogik ausdrücken.
- **Ein sauberer Bericht ist kein Sicherheitszertifikat.** Siehe insbesondere den Hinweis zu [unqualified-column-in-subquery](#unqualified-column-in-subquery): Postgres schreibt Policy-Ausdrücke um, sodass einige Fehler im Katalog überhaupt nicht mehr sichtbar sind.
- **Es prüft keine Autorisierung auf Anwendungsebene**, keine API-Schlüssel, keine Netzwerkkonfiguration/Exposition, keine Handhabung von Geheimnissen (Secrets) oder irgendetwas außerhalb der Datenbank.

## Verwandte Themen

- [Sicherheitsregeln (RLS)](/docs/collections/security-rules) — Definieren von Row-Level Security in Rebase Collections, was zu den Policies kompiliert wird, die dieses Tool auditiert.
