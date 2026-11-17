---
sourceHash: 5bab946153902c64
title: Ausführen auf einer bestehenden oder gemeinsam genutzten Datenbank
sidebar_label: Bestehende oder geteilte Datenbank
description: Führen Sie Rebase auf einer PostgreSQL-Datenbank aus, die es nicht selbst besitzt – einem mit anderen Apps geteilten Cluster, einem zweiten Rebase-Projekt, Supabase oder einer von einem DBA gesperrten Datenbank – mit den rls-Einstellungen, rebase doctor --database und rebase db request-role migrate.
---

## Das Problem

Rebase führt jede angemeldete und anonyme Anfrage als eine eingeschränkte Postgres-Rolle
aus, `rebase_user`, und überlässt es der Row-Level Security (RLS) zu entscheiden, welche
Zeilen diese Anfrage sieht. Die Verbindungsrolle besitzt die Tabellen und umgeht RLS; jede
Anfrage wechselt innerhalb ihrer Transaktion zu `rebase_user`.

Das funktioniert auf einer Datenbank, die Rebase vollständig gehört: Rebase Cloud, das von
`rebase init` eingerichtete Docker-Setup, die verwaltete Entwicklungsdatenbank. Es stützt
sich auf zwei Annahmen:

1. Nur der Server dieses Projekts kann zu `rebase_user` werden.
2. Nur `rebase_user` und der Tabelleneigentümer greifen auf die Tabellen von Rebase zu.

Eine Datenbank, die bereits anderweitig betrieben wird, bricht oft beide Annahmen:

- **Rollen gehören zum gesamten Cluster, nicht zu einer einzelnen Datenbank.** Zwei Rebase-Projekte
  auf demselben Cluster teilen sich denselben `rebase_user`. Standardmäßig darf sich jede Rolle
  mit jeder Datenbank verbinden, und jeder kann die Sitzungseinstellungen setzen, die die Policies
  von Rebase lesen. Somit kann die Verbindung von Projekt A die Datenbank von Projekt B öffnen, zu
  `rebase_user` wechseln und die Policies von B als Admin von B passieren.
- **Berechtigungen (Grants) gelten für ganze Schemas.** Standardmäßig gewährt Rebase der Request-Rolle
  `SELECT, INSERT, UPDATE, DELETE` auf jeder Tabelle in `public`, auf der es Rechte vergeben darf,
  einschließlich Tabellen, die einer anderen Anwendung gehören.
- **Standard-Policies gelten `TO public`.** Die Baseline-Policy, die Rebase zu jeder Tabelle hinzufügt,
  gewährt jeder Sitzung Zugriff, die Rebase' Identität nie gesetzt hat. Auf diese Weise werden die
  eigenen Abfragen des Servers durchgelassen, und es lässt auch jede andere Rolle herein, die ein
  Grant auf der Tabelle besitzt, wie z. B. Supabases `anon` über dessen Data-API.
- **Bestehende rollenbasierte Policies greifen nie.** Eine Policy, die `TO authenticated` geschrieben
  ist, gilt nicht für `rebase_user`, da `rebase_user` die Privilegien anderer Rollen nicht erbt.
- **Manche Datenbanken erlauben es der App überhaupt nicht, Rollen zu erstellen.** Ein DBA erstellt
  jede Rolle manuell, oder Rollen werden in Terraform verwaltet.

Für jeden dieser Punkte gibt es eine Einstellung. Jede Einstellung verwendet standardmäßig das, was
Rebase ohne sie tut, sodass sich ein Projekt, das nichts konfiguriert, genau wie zuvor verhält.

## Zuerst die Datenbank prüfen

```bash
rebase doctor --database
```

Es liest den Systemkatalog der Projektdatenbank aus und ändert nichts. Es meldet:

- ob jede Request-Rolle existiert, eingeschränkt ist und ob diese Verbindung zu ihr wechseln darf;
- andere Login-Rollen, die in die Request-Rolle wechseln können;
- ob sich jede Rolle auf dem Cluster mit dieser Datenbank verbinden darf;
- Tabellen in den Rebase-Schemas, die Rebase nicht bedient;
- andere Rollen, die Privilegien auf den Rebase-Tabellen besitzen;
- Policies auf Rebase-Tabellen, die `TO` für eine Rolle definiert sind, die die Request-Rolle nicht erbt;
- Standardprivilegien (Default Privileges), die neue Tabellen an andere Rollen übergeben.

Jeder Befund enthält das SQL, das als Datenbankadministrator ausgeführt werden muss, die
Einstellung, die Rebase stattdessen an die Datenbank anpasst, oder beides. Es beendet sich mit
Exit-Code 1, wenn ein Befund ein Fehler ist, sodass es als Deployment-Gate dienen kann. Es
prüft die Datenbank anhand der Einstellungen, die es sehen kann: die `REBASE_RLS_*`-Variablen
und anschließend die Request-Rollen, die ein Serverstart in der Datenbank aufgezeichnet hat.

`npx @rebasepro/rls-check` auditiert die Policies selbst auf jedem beliebigen Postgres. Auf
einer Rebase-Datenbank liest es die Request-Rolle auf dieselbe Weise; geben Sie sie mit
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

Oder über die Umgebungsvariablen, welche Vorrang vor der Deklaration haben. Die Umgebung eignet
sich für Werte, die sich zwischen zwei Deployments desselben Codes unterscheiden, wie etwa der
Rollenname, wenn Staging und Produktion sich einen Cluster teilen.

| Einstellung | Umgebungsvariable | Standard | Alternativen |
|---|---|---|---|
| `requestRole` | `REBASE_RLS_REQUEST_ROLE` (ein einzelner Name) | `"rebase_user"` | Beliebiger Rollenname. `{ anonymous, signedIn }`, um Aufrufer ohne Sitzung als eine Rolle und angemeldete Aufrufer als eine andere auszuführen. Im Code des Treibers eine Funktion der Identität der Anfrage. |
| `requestRoles` | keine | aus `requestRole` abgeleitet | Jede Rolle, die ein funktionsbasiertes `requestRole` zurückgeben kann, damit jede bereitgestellt, berechtigt und geprüft werden kann. Erforderlich bei Verwendung einer Funktion. |
| `provisionRole` | `REBASE_RLS_PROVISION_ROLE` | `"auto"`: Erstellt die Rolle, falls sie fehlt, und gewährt dieser Verbindung das Recht, zu ihr zu wechseln | `"never"`: Die Rolle und die Mitgliedschaft liegen in Ihrer Verantwortung. Der Start prüft beides und schlägt mit dem auszuführenden SQL fehl. |
| `grants` | `REBASE_RLS_GRANTS` | `"schema"`: Jede Tabelle und Sequenz in den von Rebase bedienten Schemas, auf denen die Verbindung Berechtigungen vergeben darf, plus Standardprivilegien für später erstellte Tabellen | `"managed"`: Nur die Tabellen, die Rebase bedient, und keine Standardprivilegien. `"none"`: Rebase vergibt keine Berechtigungen; eine Tabelle, für die Sie keine Rechte vergeben haben, wird verweigert. |
| `policyTarget` | `REBASE_RLS_POLICY_TARGET` | `"public"` | `"requestRole"`: Permissive Policies gelten nur für die Request-Rolle(n). Restriktive Policies gelten weiterhin für alle. |
| `adminPolicies` | `REBASE_RLS_ADMIN_POLICIES` | `"adminRole"`: Policies, die nur der Serverkontext oder ein Admin passieren kann (die Baseline, `roles: ["admin"]`), werden `TO rebase_admin` geschrieben, und Admin-Anfragen laufen als `<request role>_admin` | `"public"`: Diese Policies lauten `TO public` und Admins laufen als Request-Rolle, wie vor der Existenz dieser Einstellung. |
| `defaultPolicies` | `REBASE_RLS_DEFAULT_POLICIES` | `true` | `false`: Keine Tabelle erhält die Server-oder-Admin-Baseline. Ein tabelleneigenes `defaultPolicies: false` entscheidet weiterhin individuell. |
| `required` | keine | `true`: Eine deklarierte Tabelle, die die Datenbank nicht schützt (Row-Level Security deaktiviert, deklarierte Policies fehlen), wird nicht bedient, wenn der Start nichts bereitstellt | `false`: Tabellen dieser Datenbank trotzdem bedienen und beim Start benennen. Für ein Schema, das einem anderen Tool gehört, und eine App, die den Zugriff selbst durchsetzt; siehe „Ein anderes Tool besitzt das Schema“ unten. Das tabelleneigene `rlsRequired` entscheidet individuell. |
| `inheritRoles` | keine | `[]` | Rollen, die der Request-Rolle `WITH INHERIT TRUE` gewährt werden, sodass für sie geschriebene `TO`-Policies greifen. Bei einer `{ anonymous, signedIn }`-Request-Rolle erhält nur die angemeldete Rolle diese; bei einer Funktion wird die Einstellung abgelehnt. PostgreSQL 16 und neuer; auf 15 und älter abgelehnt. |
| `identity` | `REBASE_RLS_IDENTITY` (benannte Formen) | `"rebase"`: `app.uid`, `app.user_roles`, `app.is_anonymous`, `app.jwt` | `"supabase"`: Zusätzlich `request.jwt.claims`, `request.jwt.claim.sub` und `request.jwt.claim.role`, sodass `auth.uid()` und `auth.jwt()` den Aufrufer sehen. Im Code des Treibers eine Funktion, die zusätzliche Einstellungen zurückgibt. Die `app.*`-Einstellungen werden immer gesetzt. |
| `sharedRole` | `REBASE_RLS_SHARED_ROLE` | `"warn"`, wenn ein anderes Login in die Request-Rolle wechseln kann | `"refuse"`: Start fehlschlagen lassen. `"ignore"`: Nichts melden. |

Die Funktionsformen von `requestRole` und `identity` werden nur im treibereigenen `rls`-Block
akzeptiert, der dieselben Einstellungen annimmt. `policyTarget`, `adminPolicies` und
`defaultPolicies` ändern das Policy-SQL, das `rebase db generate` schreibt, und das CLI kann
den Treibercode nicht lesen; definieren Sie diese daher in der Deklaration oder in der
Umgebung. Ein Systemstart, der sie nur im Treibercode findet, verweigert den Start.

Beim Start führt die Zeile, die berichtet, wie Anfragen isoliert sind, jede Einstellung auf,
die nicht dem Standard entspricht. Eine Einstellung, die Ihnen eine Aufgabe überträgt, wie z. B.
`grants: "none"`, gibt einmalig an, um welche Aufgabe es sich handelt.

Der erste bereitstellende Start zeichnet die Request-Rolle(n) in `rebase.schema_meta` auf. Ein
späterer Start, der mit einer anderen Rolle konfiguriert ist, verweigert den Start und nennt
den Befehl (siehe unten), der die Datenbank migriert. Ohne diese Prüfung würde die alte Rolle
ihre Grants behalten, während daneben eine neue eingerichtet würde.

## Anleitungen

### Ein mit anderen Apps oder Projekten geteilter Cluster

Geben Sie jedem Projekt und jedem Deployment, das sich einen Cluster teilt, eine eigene Rolle:

```bash
REBASE_RLS_REQUEST_ROLE=acme_prod_user
```

Eine Datenbank, die bereits als `rebase_user` gelaufen ist, hat dies aufgezeichnet; migrieren
Sie sie daher zuerst:

```bash
rebase db request-role migrate --to acme_prod_user --dry-run
rebase db request-role migrate --to acme_prod_user
```

Der Befehl erstellt die neue Rolle, falls sie fehlt, vergibt nur in dieser Datenbank jeden
Grant neu, den die alte Rolle besitzt (Tabellen, Spalten, Sequenzen, Schemas, Funktionen, die
von dieser Verbindung festgelegten Standardprivilegien und Mitgliedschaften), passt Policies
an, die die alte Rolle benennen, und zeichnet die neue Rolle auf. Er läuft in einer einzigen
Transaktion. Die alte Rolle bleibt unverändert, da eine andere Datenbank auf dem Cluster sie
möglicherweise noch verwendet. Nach Abschluss gibt der Befehl die `REVOKE`-Anweisungen aus,
die die Berechtigungen der alten Rolle in dieser Datenbank entziehen, sobald hier nichts mehr
darauf angewiesen ist. `--dry-run` gibt dieselben Anweisungen aus und ändert nichts. In einem
Terminal fragt der Befehl vor der Ausführung nach Bestätigung; ohne Terminal bricht er ohne
`--yes` ab.

Setzen Sie anschließend `REBASE_RLS_REQUEST_ROLE` auf jedem Server, der die Datenbank verwendet.

`rebase doctor --database` meldet auch, wenn sich jede Rolle auf dem Cluster mit der Datenbank
verbinden darf, zusammen mit dem `REVOKE CONNECT … FROM PUBLIC`, das dies unterbindet. Rebase
führt dies auf einer Datenbank, die es nicht selbst besitzt, nicht eigenständig aus.

### Supabase

Ein bestehendes Supabase-Schema verfügt bereits über `anon` und `authenticated` sowie über
Policies, die mit `auth.uid()` dagegen geschrieben wurden. Damit diese Policies unverändert
für die Anfragen von Rebase gelten:

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

- `requestRole` führt Aufrufer ohne Sitzung als `anon` und alle angemeldeten Benutzer
  (einschließlich Gäste) als `authenticated` aus.
- `identity: "supabase"` setzt die `request.jwt.*`-Einstellungen, die `auth.uid()` liest.
  Ohne sie schlägt jede Prüfung der Form `auth.uid() = owner_id` fehl oder ist erfolgreich,
  wenn sie es nicht sein sollte.
- `policyTarget: "requestRole"` verhindert, dass die eigenen Policies von Rebase auf
  Sitzungen angewendet werden, die keine Rebase-Anfragen sind, wie beispielsweise Supabases
  Data-API.

Da Anfragen selbst als `anon` und `authenticated` ausgeführt werden, gelten Policies, die
`TO anon` oder `TO authenticated` definiert sind, direkt wie sie sind, und `inheritRoles` wird
nicht benötigt. Dies ist für Projekte gedacht, deren Anfragen unter einer eigenen Rolle laufen,
wie etwa `requestRole: "acme_user", inheritRoles: ["authenticated"]`. Bei einem
`{ anonymous, signedIn }`-Paar wird dies nur der angemeldeten Rolle gewährt, niemals der
anonymen.

Die standardmäßigen Default-Privileges von Supabase haben in `public` erstellte Tabellen für
`anon` und `authenticated` freigegeben; prüfen Sie die Ihres Projekts. Führen Sie nach dem
ersten Start `rebase doctor --database` und `rls-check` aus, um zu sehen, worauf diese Rollen
zugreifen können.

### Ein anderes Tool besitzt das Schema, und die App erzwingt den Zugriff

Manche Datenbanken unterliegen nicht der Absicherung durch Rebase. Alembic, Prisma oder ein
DBA besitzen die Tabellen, nichts dort aktiviert Row-Level Security, und die App entscheidet
selbst, wer was sieht: Nur Mitarbeiter können sich anmelden, Hooks prüfen jeden Schreibvorgang,
ein Scope schützt jede Route. Ein Systemstart, der nichts bereitstellt (`REBASE_PROVISION=false`,
`REBASE_MIGRATE_ON_BOOT=none`), hält standardmäßig jede solche Tabelle zurück (`503 TABLE_WITHHELD`),
da Postgres sonst jedem angemeldeten Aufrufer jede Zeile aushändigen würde.

Geben Sie stattdessen an, dass die App den Zugriff selbst durchsetzt, für die gesamte Datenbank:

```ts
// backend/resources.ts
export const main = database({ rls: { required: false } });
```

oder für eine einzelne Tabelle:

```ts
export const invoices = defineTable("invoices", {
    columns: { /* … */ },
    rls: "admin-only",
    rlsRequired: false
});
```

Die Tabellen werden dann ausgeliefert, unabhängig davon, was der Katalog sagt, und der
Startvorgang listet sie in einer Warnung auf. Das `rlsRequired: true` einer Tabelle sorgt dafür,
dass sie auch bei einer Datenbank mit `required: false` erforderlich bleibt. In der Datenbank
ändert sich dadurch nichts: Ein Start, der Bereitstellungen durchführt, aktiviert weiterhin
Row-Level Security und schreibt die deklarierten Policies, und `rebase doctor` meldet die
Tabellen weiterhin als ungeschützt.

Wenn Row-Level Security deaktiviert ist, wird das deklarierte `rls` nicht von Postgres
erzwungen: `"admin-only"` hält einen angemeldeten Nicht-Admin nicht auf. Stellen Sie sicher,
dass Login, Rollen und Hooks diese Aufgabe übernehmen.

### Ein Datenbankadministrator erstellt die Rollen

Wenn die Verbindung keine Rollen erstellen darf oder Rollen in Terraform verwaltet werden:

```bash
REBASE_RLS_PROVISION_ROLE=never
```

Der Start prüft dann die Rolle und die Mitgliedschaft und schlägt mit dem auszuführenden
SQL fehl, anstatt zu versuchen, sie zu erstellen. Um dieses SQL dem Administrator vorab
zu übergeben:

```bash
rebase db provision --print > request-role.sql
```

Es gibt für jede Request-Rolle die Anweisungen aus, die sie erstellen (`NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT`),
der Verbindungsrolle das Recht geben, zu ihr zu wechseln (`WITH SET TRUE, INHERIT FALSE` unter
PostgreSQL 16 und neuer), und ihr unter `grants: "schema"` Rechte auf die Schemas gewähren. Die
Erklärung ist als SQL-Kommentare formuliert, sodass die Datei direkt so ausgeführt werden kann.
Sie liest die Verbindungsrolle aus der Datenbank und führt nichts weiter aus. Jede Anweisung
kann gefahrlos wiederholt ausgeführt werden.

### Admin-Anfragen und `rebase_admin`

Postgres verknüpft die permissiven Policies, die für eine Rolle gelten, mit ODER (OR). Wenn sie
`TO public` geschrieben sind, würde die Baseline, die jede Tabelle besitzt (`rebase.uid() IS NULL OR`
die `admin`-Rolle), auch für angemeldete Benutzer gelten. Ein ODER, dessen anderer Zweig für das
gesamte Statement konstant ist, kann keinen Index verwenden: Das Auflisten oder Zählen von Einträgen
im Gültigkeitsbereich des Benutzers (Owner-Scope) würde die gesamte Tabelle scannen. Daher werden
Policies, die nur der Serverkontext oder ein Admin erfüllen kann, `TO rebase_admin` geschrieben und
erreichen niemals den Ausführungsplan eines regulären Benutzers.

`rebase_admin` besitzt keine Privilegien und kann sich nicht anmelden. Ein Aufrufer mit der
`admin`-Rolle, einschließlich `rebase.dataAsAdmin`, läuft als `<request role>_admin`
(standardmäßig `rebase_user_admin`), was die Request-Rolle und `rebase_admin` erbt. Eine
Verbindung, die selbst der Row-Level Security unterliegt, erbt `rebase_admin` für den
Serverkontext. Der Startvorgang richtet dies alles ein, sofern die Verbindung Rollen erstellen
darf. Unter `provisionRole: "never"` erstellen Sie diese selbst:

```sql
CREATE ROLE rebase_admin NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
CREATE ROLE rebase_user_admin NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
GRANT rebase_user, rebase_admin TO rebase_user_admin WITH INHERIT TRUE, SET FALSE;
GRANT rebase_user_admin TO <connection role> WITH SET TRUE, INHERIT FALSE;
```

Unter PostgreSQL 15 und älter erstellen Sie `rebase_user_admin` mit `INHERIT` und lassen die
`WITH`-Optionen weg. Wo `rebase_admin` überhaupt nicht erstellt werden kann, schreiben der
Startvorgang und `rebase db push` diese Policies `TO public`, so wie es zuvor war, und Admins
laufen weiterhin als Request-Rolle. `rebase doctor --database` meldet, welche dieser Varianten
bei Ihnen vorliegt.

#### Admin-Lesezugriffe nutzen die Indizes des Eigentümers

Eine Policy, die keine Konstante ist, hindert Postgres daran, einen Index für einen Operator zu
verwenden, der nicht leakproof ist, wie z. B. `&&` auf einem Array, `~` oder ein JSONB-Operator.
Ohne den folgenden Schritt scannte `tags && $1` eines Admins die gesamte Tabelle, während dieselbe
Abfrage als Eigentümer den GIN-Index nutzte. Dies betraf `rebase.sqlAsAdmin`, `rebase.dataAsAdmin`
und Admin-Benutzer gleichermaßen.

Daher weist der Start jeder reinen Admin-Policy, die jeder Admin besteht, eine Begleit-Policy
(Companion) `TO rebase_admin_request USING (true)` mit dem Namen `<policy>_ar_<hash>` zu. Bei
einer Admin-Anfrage reduziert Postgres die Policies auf `true` und plant die Abfrage genauso wie
für den Eigentümer. Restriktive Policies gelten weiterhin. Nur die `<request role>_admin`-Rollen
dürfen `rebase_admin_request` besitzen. Bei jedem Start prüft Rebase, welche Rollen dessen
Privilegien besitzen. Falls eine andere Rolle, die der Row-Level Security unterliegt, diese besitzt,
schreibt der Start keine Begleit-Policies und entfernt alle, die er findet. Begleit-Policies
erfordern PostgreSQL 16 oder neuer, da auf Version 15 und älter die Verbindung die Rolle erben
würde. Nur der Serverstart schreibt sie. `policies.sql` und Migrationen erstellen niemals welche,
entfernen jedoch die Begleit-Policy jeder von ihnen umgeschriebenen Policy, die keine mehr rechtfertigt.
`rebase db push` und `rebase db migrate` verwerfen ebenfalls jede Begleit-Policy, deren Regel
weggefallen ist. Eine eingeschränkte oder entfernte Admin-Regel lässt somit nicht mehr jeden
Admin zu, selbst wenn der Startvorgang nichts bereitstellt. Unter `provisionRole: "never"`
erstellen Sie die Rolle selbst:

```sql
CREATE ROLE rebase_admin_request NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
GRANT rebase_admin_request TO rebase_user_admin WITH INHERIT TRUE, SET FALSE;
```

Bevor Sie auf ein Release zurückrollen, das älter ist als jenes, mit dem Begleit-Policies
eingeführt wurden, setzen Sie diese außer Kraft. Eine ältere Laufzeitumgebung weiß nicht,
worum es sich dabei handelt, und löscht sie nie, sodass eine später geänderte Regel mit ihrer
Begleit-Policy weiterhin jedem Admin Zugriff auf jede Zeile gewähren würde. Eine Anweisung pro
Admin-Request-Rolle sorgt dafür, dass keine Begleit-Policy mehr Zugriff gewährt:

```sql
REVOKE rebase_admin_request FROM rebase_user_admin;
```

Oder löschen Sie diese: Jede Policy, deren Name auf `_ar_` und acht Hex-Ziffern endet und deren
Rolle `rebase_admin_request` ist.

### Ein gemeinsam genutztes `public`-Schema

Wenn `public` Tabellen enthält, auf die Rebase keinen Zugriff haben soll:

```bash
REBASE_RLS_GRANTS=managed
```

Rebase gewährt der Request-Rolle dann nur Zugriff auf die Tabellen, die es bedient: deklarierte
Tabellen, Junction-Tabellen und seine eigenen zeilengesicherten Tabellen. Es richtet keine
Standardprivilegien in gemeinsam genutzten Schemas ein und widerruft nichts, was bereits gewährt
wurde. `rebase doctor --database` listet die Tabellen in Rebase' Schemas auf, die es nicht bedient.

Ein anderer Ausweg ist ein eigenes Schema für Rebase: Setzen Sie `schema` bei jedem `defineTable`.

## Provider

Was die Verbindungsrolle tun kann, unterscheidet sich zwischen den Providern und bestimmt, ob
Rebase die Request-Rolle selbst erstellen kann. Die folgenden Hinweise spiegeln unsere
Erwartungen wider; überprüfen Sie diese bei Ihrem Provider.

| Provider | Übliche Verbindungsrolle | Hinweise |
|---|---|---|
| Supabase | `postgres` (kein Superuser, besitzt CREATEROLE) | Eine Datenbank pro Projekt. `anon`, `authenticated` und `authenticator` existieren, mit Standardprivilegien in `public`. Siehe die Supabase-Anleitung oben. |
| Neon | der Projekteigentümer, Mitglied von `neon_superuser` | Rollen gehören zu einem Branch, und jede Datenbank auf einem Branch teilt sie sich. Zwei Rebase-Datenbanken in einem Neon-Projekt teilen sich `rebase_user`, setzen Sie `requestRole` daher pro Datenbank. |
| AWS RDS / Aurora | der Master-Benutzer, Mitglied von `rds_superuser` | Besitzt CREATEROLE, ist aber kein Superuser. Instanzen werden häufig von mehreren Apps geteilt. |
| Google Cloud SQL | `postgres`, Mitglied von `cloudsqlsuperuser` | Wie RDS. |
| Azure Flexible Server | der Admin-Benutzer, Mitglied von `azure_pg_admin` | Wie RDS. |
| InstaPods | `instapod`; Superuser über `sudo -u postgres` | [Der InstaPods-Leitfaden](/docs/deployment/instapods/) erstellt die Rolle im Voraus. |
| Hostman | `gen_user`; CREATE ROLE über das Panel gewährt | Im kleinsten Tarif nicht verfügbar. [Der Hostman-Leitfaden](/docs/deployment/hostman/) erstellt die Rolle im Voraus. |

## Verwandte Themen

- [Datenbank-Befehle](/docs/cli/database/): `rebase db request-role` und `rebase db provision`
- [CLI-Referenz](/docs/cli/#rebase-doctor): `rebase doctor --database`
- [rls-check](/docs/rls-check/): Policies auf beliebigem Postgres auditieren
- [Sicherheitsregeln (RLS)](/docs/collections/security-rules/): die Policies, die Rebase für jede Tabelle schreibt
