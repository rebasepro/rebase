---
sourceHash: 4107937aed2a477c
title: Betrieb auf einer bestehenden oder geteilten Datenbank
sidebar_label: Bestehende oder geteilte Datenbank
description: Führen Sie Rebase auf einer PostgreSQL-Datenbank aus, die es nicht selbst besitzt – ein mit anderen Apps geteilter Cluster, ein zweites Rebase-Projekt, Supabase oder eine von einem DBA abgesicherte Datenbank – mit den rls-Einstellungen, rebase doctor --database und rebase db request-role migrate.
---

## Das Problem

Rebase führt jede angemeldete und anonyme Anfrage als eine eingeschränkte Postgres-Rolle
aus, `rebase_user`, und überlässt es Row-Level Security (RLS) zu entscheiden, welche
Zeilen diese Anfrage sieht. Die Verbindungsrolle ist Eigentümer der Tabellen und umgeht
RLS; jede Anfrage wechselt innerhalb ihrer Transaktion zu `rebase_user`.

Das funktioniert auf einer Datenbank, die Rebase vollständig gehört: Rebase Cloud, das
von `rebase init` erstellte Docker-Setup, die verwaltete Entwicklungsdatenbank. Es beruht
auf zwei Annahmen:

1. Nur der Server dieses Projekts kann zu `rebase_user` werden.
2. Nur `rebase_user` und der Tabelleneigentümer greifen auf die Tabellen von Rebase zu.

Eine Datenbank, die bereits betrieben wird, bricht oft mit beiden Annahmen:

- **Rollen gehören zum gesamten Cluster, nicht zu einer einzelnen Datenbank.** Zwei
  Rebase-Projekte auf einem Cluster teilen sich denselben `rebase_user`. Standardmäßig
  darf sich jede Rolle mit jeder Datenbank verbinden, und jeder kann die Session-Einstellungen
  setzen, die von den Policies von Rebase gelesen werden. So kann die Verbindung von Projekt A
  die Datenbank von Projekt B öffnen, zu `rebase_user` wechseln und die Policies von B als Admin
  von B passieren.
- **Berechtigungen (Grants) decken ganze Schemas ab.** Standardmäßig gewährt Rebase der
  Request-Rolle `SELECT, INSERT, UPDATE, DELETE` auf jeder Tabelle in `public`, auf die es
  Berechtigungen vergeben darf – einschließlich Tabellen, die einer anderen Anwendung gehören.
- **Standard-Policies gelten `TO public`.** Die Basis-Policy, die Rebase zu jeder Tabelle
  hinzufügt, lässt jede Session zu, die Rebase' Identität nie gesetzt hat. Dadurch passieren
  die servereigenen Abfragen, aber es lässt auch jede andere Rolle zu, die eine Berechtigung
  für die Tabelle besitzt, wie etwa Supabases `anon` über dessen Data-API.
- **Bestehende rollenbasierte Policies greifen nie.** Eine Policy, die mit `TO authenticated`
  definiert ist, gilt nicht für `rebase_user`, da `rebase_user` die Privilegien anderer Rollen
  nicht erbt.
- **Manche Datenbanken erlauben der App überhaupt nicht, Rollen zu erstellen.** Ein DBA
  erstellt jede Rolle manuell, oder Rollen werden in Terraform verwaltet.

Für jeden dieser Punkte gibt es eine Einstellung. Jede Einstellung verwendet als Standardwert
das, was Rebase ohne sie tut, sodass sich ein Projekt, das nichts konfiguriert, exakt wie zuvor
verhält.

## Zuerst die Datenbank überprüfen

```bash
rebase doctor --database
```

Es liest den Katalog der Projektdatenbank und ändert nichts. Es meldet:

- ob jede Request-Rolle existiert, eingeschränkt ist und ob diese Verbindung zu ihr wechseln
  darf;
- andere Login-Rollen, die in die Request-Rolle wechseln können;
- ob jede Rolle auf dem Cluster sich mit dieser Datenbank verbinden darf;
- Tabellen in den Schemas von Rebase, die Rebase nicht bedient;
- andere Rollen, die Privilegien auf den Tabellen von Rebase besitzen;
- Policies auf den Tabellen von Rebase, die mit `TO` für eine Rolle geschrieben wurden, die
  die Request-Rolle nicht erbt;
- Standard-Privilegien (Default Privileges), die neue Tabellen an andere Rollen übertragen.

Jeder Befund enthält das SQL, das als Datenbankadministrator ausgeführt werden muss, die
Einstellung, die Rebase stattdessen an die Datenbank anpasst, oder beides. Der Befehl beendet
sich mit Exit-Code 1, wenn ein Befund ein Fehler ist, sodass er als Deployment-Gate genutzt
werden kann. Er prüft die Datenbank gegen die Einstellungen, die er sehen kann: die
`REBASE_RLS_*`-Variablen und anschließend die Request-Rollen, die ein Serverstart in der
Datenbank aufgezeichnet hat.

`npx @rebasepro/rls-check` prüft die Policies selbst auf jeder beliebigen Postgres-Instanz.
Auf einer Rebase-Datenbank liest es die Request-Rolle auf dieselbe Weise; geben Sie sie mit
`--request-role` an, wenn sie noch nicht aufgezeichnet ist.

## Die Einstellungen

Legen Sie diese in der Datenbankdeklaration in `backend/resources.ts` fest:

```ts
import { database } from "@rebasepro/types";

export const main = database({
    rls: {
        requestRole: "acme_prod_user",
        grants: "managed"
    }
});
```

Oder über Umgebungsvariablen, die Vorrang vor der Deklaration haben. Umgebungsvariablen
sind das Mittel der Wahl für Werte, die sich zwischen zwei Deployments desselben Codes
unterscheiden, wie etwa der Rollenname, wenn Staging und Produktion sich einen Cluster teilen.

| Einstellung | Umgebungsvariable | Standardwert | Alternativen |
|---|---|---|---|
| `requestRole` | `REBASE_RLS_REQUEST_ROLE` (ein einzelner Name) | `"rebase_user"` | Ein beliebiger Rollenname. `{ anonymous, signedIn }`, um Aufrufer ohne Session als eine Rolle und angemeldete Aufrufer als eine andere auszuführen. Im Code des Treibers eine Funktion der Identität der Anfrage. |
| `requestRoles` | keine | abgeleitet von `requestRole` | Jede Rolle, die ein funktionswertiges `requestRole` zurückgeben kann, damit jede bereitgestellt, berechtigt und geprüft werden kann. Erforderlich bei Verwendung einer Funktion. |
| `provisionRole` | `REBASE_RLS_PROVISION_ROLE` | `"auto"`: Rolle erstellen, falls fehlend, und dieser Verbindung das Recht gewähren, zu ihr zu wechseln | `"never"`: Die Rolle und die Mitgliedschaft liegen in Ihrer Verantwortung. Der Start prüft beides und schlägt mit dem auszuführenden SQL fehl. |
| `grants` | `REBASE_RLS_GRANTS` | `"schema"`: Jede Tabelle und Sequenz in den von Rebase bedienten Schemas, für die die Verbindung Rechte vergeben darf, plus Standard-Privilegien für später erstellte Tabellen | `"managed"`: Nur die von Rebase bedienten Tabellen und keine Standard-Privilegien. `"none"`: Rebase vergibt keine Rechte; eine Tabelle, für die Sie keine Berechtigung erteilt haben, wird verweigert. |
| `policyTarget` | `REBASE_RLS_POLICY_TARGET` | `"public"` | `"requestRole"`: Permissive Policies gelten nur für die Request-Rolle(n). Restriktive Policies gelten weiterhin für alle. |
| `adminPolicies` | `REBASE_RLS_ADMIN_POLICIES` | `"adminRole"`: Policies, die nur der Serverkontext oder ein Admin passieren kann (die Basis, `roles: ["admin"]`), werden mit `TO rebase_admin` geschrieben, und Admin-Anfragen laufen als `<request role>_admin` | `"public"`: Diese Policies lauten `TO public` und Admins laufen als Request-Rolle, wie vor der Einführung dieser Einstellung. |
| `defaultPolicies` | `REBASE_RLS_DEFAULT_POLICIES` | `true` | `false`: Keine Tabelle erhält die Server-oder-Admin-Basis. Ein tabelleneigenes `defaultPolicies: false` entscheidet weiterhin individuell. |
| `required` | keine | `true`: Eine deklarierte Tabelle, die die Datenbank nicht schützt (Row-Level Security deaktiviert, deklarierte Policies fehlen), wird nicht bedient, wenn der Start nichts bereitstellt | `false`: Die Tabellen dieser Datenbank trotzdem bedienen und sie beim Start auflisten. Für ein Schema, das einem anderen Tool gehört, und eine App, die den Zugriff selbst durchsetzt; siehe unten „Ein anderes Tool besitzt das Schema“. Ein tabelleneigenes `rlsRequired` entscheidet individuell. |
| `inheritRoles` | keine | `[]` | Rollen, die der Request-Rolle `WITH INHERIT TRUE` gewährt werden, sodass für sie geschriebene `TO`-Policies gelten. Bei einer `{ anonymous, signedIn }`-Request-Rolle erhält nur die angemeldete Rolle diese; bei einer Funktion wird die Einstellung abgelehnt. PostgreSQL 16 und neuer; wird auf 15 und älter abgelehnt. |
| `identity` | `REBASE_RLS_IDENTITY` (benannte Formen) | `"rebase"`: `app.uid`, `app.user_roles`, `app.is_anonymous`, `app.jwt` | `"supabase"`: Zusätzlich `request.jwt.claims`, `request.jwt.claim.sub` und `request.jwt.claim.role`, damit `auth.uid()` und `auth.jwt()` den Aufrufer sehen. Im Code des Treibers eine Funktion, die zusätzliche Einstellungen zurückgibt. Die `app.*`-Einstellungen werden immer gesetzt. |
| `sharedRole` | `REBASE_RLS_SHARED_ROLE` | `"warn"`, wenn ein anderes Login in die Request-Rolle wechseln kann | `"refuse"`: Den Start abbrechen. `"ignore"`: Nichts ausgeben. |

Die Funktionsformen von `requestRole` und `identity` werden nur im treibereigenen `rls`-Block
akzeptiert, der dieselben Einstellungen entgegennimmt. `policyTarget`, `adminPolicies` und
`defaultPolicies` verändern das Policy-SQL, das `rebase db generate` schreibt, und das CLI
kann den Treibercode nicht lesen; setzen Sie diese daher in der Deklaration oder in der
Umgebung. Ein Start, der sie nur im Treibercode vorfindet, verweigert die Ausführung.

Beim Start listet die Zeile, die über die Isolierung von Anfragen berichtet, jede Einstellung
auf, die nicht ihrem Standardwert entspricht. Eine Einstellung, die eine Aufgabe an Sie
überträgt, wie etwa `grants: "none"`, nennt einmalig diese Aufgabe.

Der erste bereitstellende Start zeichnet die Request-Rolle(n) in `rebase.schema_meta` auf.
Ein späterer Start, der mit einer anderen Rolle konfiguriert ist, verweigert den Start und
nennt den Befehl (siehe unten), der die Datenbank migriert. Ohne diese Prüfung würde die alte
Rolle ihre Berechtigungen behalten, während daneben eine neue eingerichtet würde.

## Rezepte

### Ein mit anderen Apps oder Projekten geteilter Cluster

Geben Sie jedem Projekt und jedem Deployment, das sich einen Cluster teilt, eine eigene
Rolle:

```bash
REBASE_RLS_REQUEST_ROLE=acme_prod_user
```

Eine Datenbank, die bereits als `rebase_user` gelaufen ist, zeichnet dies auf; migrieren Sie
sie daher zuerst:

```bash
rebase db request-role migrate --to acme_prod_user --dry-run
rebase db request-role migrate --to acme_prod_user
```

Der Befehl erstellt die neue Rolle, falls sie fehlt, vergibt nur in dieser Datenbank jedes
Recht der alten Rolle neu (Tabellen, Spalten, Sequenzen, Schemas, Funktionen, die von dieser
Verbindung gesetzten Standard-Privilegien und Mitgliedschaften), biegt Policies um, die die
alte Rolle nennen, und zeichnet die neue Rolle auf. Er läuft in einer einzigen Transaktion ab.
Die alte Rolle bleibt unverändert bestehen, da eine andere Datenbank auf dem Cluster sie
möglicherweise noch verwendet. Nach Abschluss gibt er die `REVOKE`-Anweisungen aus, die die
Berechtigungen der alten Rolle in dieser Datenbank entziehen – zur Ausführung, sobald hier
nichts mehr darauf angewiesen ist. `--dry-run` gibt dieselben Anweisungen aus und ändert nichts.
In einem Terminal fragt der Befehl vor der Ausführung nach; ohne Terminal verweigert er die
Ausführung ohne `--yes`.

Setzen Sie anschließend `REBASE_RLS_REQUEST_ROLE` auf jedem Server, der die Datenbank verwendet.

`rebase doctor --database` meldet auch, wenn sich jede Rolle auf dem Cluster mit der Datenbank
verbinden darf, zusammen mit dem `REVOKE CONNECT … FROM PUBLIC`, das dies unterbindet. Rebase
führt dies auf einer Datenbank, die es nicht selbst besitzt, nicht eigenständig aus.

### Supabase

Ein bestehendes Supabase-Schema verfügt bereits über `anon` und `authenticated` sowie über
Policies, die mit `auth.uid()` darauf abgestimmt sind. Damit diese Policies unverändert für
Rebase-Anfragen gelten:

```ts
import { database } from "@rebasepro/types";

export const main = database({
    rls: {
        requestRole: { anonymous: "anon", signedIn: "authenticated" },
        identity: "supabase",
        policyTarget: "requestRole"
    }
});
```

- `requestRole` führt Aufrufer ohne Session als `anon` und alle angemeldeten Benutzer
  (einschließlich Gäste) als `authenticated` aus.
- `identity: "supabase"` setzt die `request.jwt.*`-Einstellungen, die `auth.uid()` liest.
  Ohne sie schlägt jede `auth.uid() = owner_id`-Prüfung fehl oder ist erfolgreich, wenn sie
  es nicht sein sollte.
- `policyTarget: "requestRole"` verhindert, dass die eigenen Policies von Rebase auf
  Sessions angewendet werden, die keine Rebase-Anfragen sind, wie beispielsweise die Data-API
  von Supabase.

Da Anfragen selbst als `anon` und `authenticated` ausgeführt werden, gelten Policies, die mit
`TO anon` oder `TO authenticated` geschrieben wurden, genau so wie sie sind, und `inheritRoles`
wird nicht benötigt. Dies ist für Projekte gedacht, deren Anfragen als eine eigene Rolle
ausgeführt werden, wie etwa `requestRole: "acme_user", inheritRoles: ["authenticated"]`. Bei
einem `{ anonymous, signedIn }`-Paar wird es nur der angemeldeten Rolle gewährt, niemals der
anonymen.

Die Standard-Privilegien von Supabase haben in `public` erstellte Tabellen an `anon` und
`authenticated` vergeben; prüfen Sie dies für Ihr Projekt. Führen Sie nach dem ersten Start
`rebase doctor --database` und `rls-check` aus, um zu sehen, worauf diese Rollen zugreifen
können.

### Ein anderes Tool besitzt das Schema, und die App setzt den Zugriff durch

Manche Datenbanken unterliegen nicht der Absicherung durch Rebase. Alembic, Prisma oder ein
DBA besitzen die Tabellen, nichts dort aktiviert Row-Level Security, und die App entscheidet
selbst, wer was sieht: Nur Mitarbeiter können sich anmelden, Hooks prüfen jeden Schreibvorgang,
ein Scope sichert jede Route ab.

Deklarieren Sie dieses Verhalten direkt an der Tabelle:

```ts
export const invoices = defineTable("invoices", {
    columns: { id: col.uuid().primaryKey().defaultRandom(), total: col.numeric() },
    rls: "unmanaged"
});
```

Oder für das gesamte Projekt über `defaultRls = "unmanaged"` in `backend/schema/index.ts`
zusammen mit `rls: "inherit"` an jeder Tabelle. Rebase erzeugt kein
`ENABLE ROW LEVEL SECURITY` oder Policy-DDL für `"unmanaged"`-Tabellen (bei `db push` oder
bereitstellenden Starts), bedient sie ohne Einschränkung und listet sie beim Start einmalig
auf. Behalten Sie Anmeldung, Rollen, Scopes und Hooks bei, um den Zugriff durchzusetzen.

Falls Postgres auf diesen Tabellen Row-Level Security **tatsächlich** erzwingt – mit Policies,
die in SQL-Migrationen, Supabase oder Terraform statt in Rebase verfasst wurden –, verwenden
Sie stattdessen `rls: "external"`:

```ts
export const invoices = defineTable("invoices", {
    columns: { id: col.uuid().primaryKey().defaultRandom(), total: col.numeric() },
    rls: "external"
});
```

Rebase erzeugt kein RLS- oder Policy-DDL für `"external"`-Tabellen und entfernt deren
Policies niemals (`--prune-policies`), während der Start und `rebase doctor` weiterhin
verifizieren, dass `ENABLE ROW LEVEL SECURITY` auf der Tabelle in Postgres aktiv ist.

Für Tabellen, die weiterhin Rebase-Regeln auf einer Datenbank deklarieren, die einem anderen
Tool gehört, bedient `rlsRequired: false` (oder `database({ rls: { required: false } })` für
die gesamte Datenbank) diese bei einem nicht-bereitstellenden Start, selbst wenn die
deklarierten Policies nicht vorhanden sind, und nennt sie in einer Warnung:

```ts
// backend/resources.ts
export const main = database({ rls: { required: false } });
```

Ein tabelleneigenes `rlsRequired: true` sorgt dafür, dass die Tabelle auch unter einer
Datenbank mit `required: false` erforderlich bleibt. Bei deaktivierter Row-Level Security
wird eine deklarierte Regel von Postgres nicht durchgesetzt: Stellen Sie sicher, dass
Anmeldung, Rollen und Hooks diese Aufgabe übernehmen.

### Ein Datenbankadministrator erstellt die Rollen

Wenn die Verbindung keine Rollen erstellen darf oder Rollen in Terraform verwaltet werden:

```bash
REBASE_RLS_PROVISION_ROLE=never
```

Der Start prüft dann die Rolle und die Mitgliedschaft und bricht mit dem auszuführenden SQL
ab, anstatt zu versuchen, sie zu erstellen. Um dieses SQL dem Administrator vorab zu übergeben:

```bash
rebase db provision --print > request-role.sql
```

Es gibt für jede Request-Rolle die Anweisungen aus, die diese erstellen
(`NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT`), der Verbindungsrolle das Recht geben, zu ihr
zu wechseln (`WITH SET TRUE, INHERIT FALSE` unter PostgreSQL 16 und neuer), und ihr unter
`grants: "schema"` Rechte auf den Schemas gewähren. Die Erklärung ist als SQL-Kommentare
formuliert, sodass die Datei direkt unverändert ausgeführt werden kann. Der Befehl liest die
Verbindungsrolle aus der Datenbank und führt ansonsten nichts aus. Jede Anweisung kann
gefahrlos erneut ausgeführt werden.

### Admin-Anfragen und `rebase_admin`

Postgres verknüpft die für eine Rolle geltenden permissiven Policies mit OR. Wenn sie mit
`TO public` verfasst sind, würde die Basis-Policy jeder Tabelle (`rebase.uid() IS NULL OR`
die `admin`-Rolle) auch für angemeldete Benutzer gelten, und ein OR, dessen anderer Zweig für
das gesamte Statement konstant ist, kann keinen Index nutzen: Die Abfrage oder Zählung eines
Benutzers auf eigene Datensätze würde die gesamte Tabelle scannen. Daher werden Policies, die
nur der Serverkontext oder ein Admin passieren kann, mit `TO rebase_admin` geschrieben und
gelangen nie in den Abfrageplan eines Benutzers.

Die Benutzertabelle ist die Ausnahme. Auth liest und schreibt sie im Serverkontext über
die eigene Rolle der Verbindung, die nicht zu `rebase_admin` gewechselt wird, sodass ihre
Policies unabhängig von der Einstellung `TO public` bleiben: Hinter einer Verbindungsrolle,
die nicht Eigentümer der Tabelle ist, funktionieren Registrierung und Anmeldung dennoch
gleichermaßen.

`rebase_admin` besitzt keine Privilegien und kann sich nicht einloggen. Ein Aufrufer mit
der Rolle `admin`, einschließlich `rebase.dataAsAdmin`, läuft als `<request role>_admin`
(standardmäßig `rebase_user_admin`), was die Request-Rolle und `rebase_admin` erbt. Eine
Verbindung, die selbst Row-Level Security unterliegt, erbt `rebase_admin` für den
Serverkontext. Der Start erstellt all dies, sofern die Verbindung Rollen erstellen darf.
Unter `provisionRole: "never"` erstellen Sie diese selbst:

```sql
CREATE ROLE rebase_admin NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
CREATE ROLE rebase_user_admin NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
GRANT rebase_user, rebase_admin TO rebase_user_admin WITH INHERIT TRUE, SET FALSE;
GRANT rebase_user_admin TO <connection role> WITH SET TRUE, INHERIT FALSE;
```

Unter PostgreSQL 15 und älter erstellen Sie `rebase_user_admin` mit `INHERIT` und lassen die
`WITH`-Optionen weg. Wo `rebase_admin` überhaupt nicht erstellt werden kann, schreiben der
Start und `rebase db push` diese Policies mit `TO public`, wie es zuvor der Fall war, und
Admins laufen weiterhin als Request-Rolle. `rebase doctor --database` meldet, welche dieser
Varianten bei Ihnen vorliegt.

#### Lesezugriffe von Admins nutzen die Indizes des Eigentümers

Eine Policy, die keine Konstante ist, hindert Postgres daran, einen Index für einen Operator
zu verwenden, der nicht leakproof ist – wie etwa `&&` auf einem Array, `~` oder ein
JSONB-Operator. Ohne den folgenden Schritt führte das `tags && $1` eines Admins zu einem Scan
der gesamten Tabelle, während dieselbe Abfrage als Tabelleneigentümer den GIN-Index nutzte.
Dies betraf `rebase.sqlAsAdmin`, `rebase.dataAsAdmin` und Admin-Benutzer gleichermaßen.

Daher versieht der Start jede reine Admin-Policy, die jeder Admin passiert, mit einer
Begleit-Policy (Companion) `TO rebase_admin_request USING (true)`, benannt als
`<policy>_ar_<hash>`. Bei einer Admin-Anfrage reduziert Postgres die Policies auf `true` und
plant die Abfrage wie für den Eigentümer. Restriktive Policies gelten weiterhin. Nur die
`<request role>_admin`-Rollen dürfen `rebase_admin_request` besitzen. Bei jedem Start prüft
Rebase, welche Rollen dessen Privilegien halten. Falls irgendeine andere Rolle, die Row-Level
Security unterliegt, diese hält, schreibt der Start keine Begleit-Policies und entfernt alle,
die er findet. Begleit-Policies erfordern PostgreSQL 16 oder neuer, da unter Version 15 und
älter die Verbindung die Rolle erben würde. Nur der Serverstart schreibt sie. `policies.sql`
und Migrationen erstellen niemals solche Begleit-Policies, entfernen aber die Begleit-Policy
jeder von ihnen neu geschriebenen Policy, die keine mehr rechtfertigt. `rebase db push` und
`rebase db migrate` entfernen ebenfalls jede Begleit-Policy, deren Regel entfallen ist. Eine
eingeschränkte oder entfernte Admin-Regel lässt somit nicht mehr jeden Admin zu, selbst wenn
der Start nichts bereitstellt. Unter `provisionRole: "never"` erstellen Sie die Rolle selbst:

```sql
CREATE ROLE rebase_admin_request NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
GRANT rebase_admin_request TO rebase_user_admin WITH INHERIT TRUE, SET FALSE;
```

Bevor Sie ein Rollback auf ein Release durchführen, das älter ist als jenes, das Begleit-Policies
eingeführt hat, sollten Sie diese deaktivieren. Eine ältere Runtime kennt sie nicht und löscht
sie nie, sodass eine später geänderte Regel dazu führen würde, dass deren Begleit-Policy
weiterhin jedem Admin Zugriff auf jede Zeile gewährt. Eine einzige Anweisung pro
Admin-Request-Rolle sorgt dafür, dass keine Begleit-Policy mehr jemanden zulässt:

```sql
REVOKE rebase_admin_request FROM rebase_user_admin;
```

Oder löschen Sie sie: Jede Policy, deren Name auf `_ar_` und acht Hex-Ziffern endet und deren
Rolle `rebase_admin_request` ist.

### Ein geteiltes `public`-Schema

Wenn `public` Tabellen enthält, auf die Rebase nicht zugreifen soll:

```bash
REBASE_RLS_GRANTS=managed
```

Rebase erteilt der Request-Rolle dann nur Berechtigungen für die Tabellen, die es selbst bedient:
deklarierte Tabellen, Junction-Tabellen und seine eigenen zeilengesicherten Tabellen. Es setzt
keine Standard-Privilegien in geteilten Schemas und entzieht nichts, was bereits gewährt wurde.
`rebase doctor --database` listet die Tabellen in den Schemas von Rebase auf, die es nicht bedient.

Ein anderer Ausweg ist ein eigenes Schema für Rebase: Setzen Sie `schema` an jedem `defineTable`.

## Provider

Welche Rechte die Verbindungsrolle besitzt, unterscheidet sich je nach Provider und entscheidet
darüber, ob Rebase die Request-Rolle selbst erstellen kann. Die folgenden Hinweise entsprechen
unseren Erwartungen; überprüfen Sie diese mit Ihrem Provider.

| Provider | Übliche Verbindungsrolle | Hinweise |
|---|---|---|
| Supabase | `postgres` (kein Superuser, besitzt CREATEROLE) | Eine Datenbank pro Projekt. `anon`, `authenticated` und `authenticator` existieren, mit Standard-Privilegien in `public`. Siehe das Supabase-Rezept oben. |
| Neon | Der Projekt-Eigentümer, Mitglied von `neon_superuser` | Rollen gehören zu einem Branch, und jede Datenbank auf einem Branch teilt sie sich. Zwei Rebase-Datenbanken in einem Neon-Projekt teilen sich `rebase_user`, setzen Sie daher `requestRole` pro Datenbank. |
| AWS RDS / Aurora | Der Master-Benutzer, Mitglied von `rds_superuser` | Besitzt CREATEROLE, ist aber kein Superuser. Instanzen werden häufig zwischen Apps geteilt. |
| Google Cloud SQL | `postgres`, Mitglied von `cloudsqlsuperuser` | Wie RDS. |
| Azure Flexible Server | Der Admin-Benutzer, Mitglied von `azure_pg_admin` | Wie RDS. |
| InstaPods | `instapod`; Superuser über `sudo -u postgres` | [Der InstaPods-Leitfaden](/docs/deployment/instapods/) erstellt die Rolle vorab. |
| Hostman | `gen_user`; CREATE ROLE über das Panel gewährt | Nicht verfügbar im kleinsten Tarif. [Der Hostman-Leitfaden](/docs/deployment/hostman/) erstellt die Rolle vorab. |

## Verwandte Themen

- [Datenbank-Befehle](/docs/cli/database/): `rebase db request-role` und
  `rebase db provision`
- [CLI-Referenz](/docs/cli/#rebase-doctor): `rebase doctor --database`
- [rls-check](/docs/rls-check/): Überprüfung der Policies auf jedem Postgres
- [Sicherheitsregeln (RLS)](/docs/collections/security-rules/): Die Policies, die
  Rebase für jede Tabelle schreibt
