---
sourceHash: 3bff62ceb5aceb62
title: Betrieb auf einer bestehenden oder geteilten Datenbank
sidebar_label: Bestehende oder geteilte Datenbank
description: Führen Sie Rebase auf einer PostgreSQL-Datenbank aus, die es nicht selbst besitzt – einem mit anderen Apps geteilten Cluster, einem zweiten Rebase-Projekt, Supabase oder einer von einem DBA abgesicherten Datenbank – mithilfe der rls-Einstellungen, rebase doctor --database und rebase db request-role migrate.
---

## Das Problem

Rebase führt jede authentifizierte und anonyme Anfrage als eine eingeschränkte
Postgres-Rolle namens `rebase_user` aus und überlässt es der Row-Level Security,
zu entscheiden, welche Zeilen diese Anfrage sieht. Die Verbindungsrolle besitzt
die Tabellen und umgeht RLS; jede Anfrage wechselt innerhalb ihrer Transaktion
zu `rebase_user`.

Das funktioniert auf einer Datenbank, die Rebase vollständig gehört: Rebase Cloud,
das von `rebase init` eingerichtete Docker-Setup oder die verwaltete Entwicklungsdatenbank.
Es beruht auf zwei Annahmen:

1. Nur der Server dieses Projekts kann zu `rebase_user` werden.
2. Nur `rebase_user` und der Tabelleneigentümer greifen auf die Tabellen von Rebase zu.

Eine Datenbank, die bereits anderweitig betrieben wird, verletzt häufig beide Annahmen:

- **Rollen gehören zum gesamten Cluster, nicht zu einer einzelnen Datenbank.** Zwei
  Rebase-Projekte auf einem Cluster teilen sich denselben `rebase_user`. Standardmäßig
  darf sich jede Rolle mit jeder Datenbank verbinden, und jeder kann die Session-Einstellungen
  setzen, die von den Rebase-Policies gelesen werden. So kann die Verbindung von Projekt A
  die Datenbank von Projekt B öffnen, zu `rebase_user` wechseln und die Policies von B
  als Admin von B erfüllen.
- **Berechtigungen (Grants) gelten für ganze Schemas.** Standardmäßig erteilt Rebase
  der Anfrage-Rolle `SELECT, INSERT, UPDATE, DELETE` auf jeder Tabelle in `public`,
  für die es Rechte vergeben darf – einschließlich Tabellen, die einer anderen Anwendung gehören.
- **Standard-Policies gelten `TO public`.** Die Basis-Policy, die Rebase jeder
  Tabelle hinzufügt, lässt jede Session zu, die Rebase-Identität nie gesetzt hat.
  So funktionieren die eigenen Abfragen des Servers, und es lässt auch jede andere Rolle
  zu, die Berechtigungen für die Tabelle besitzt, wie etwa Supabases `anon` über dessen Data-API.
- **Bestehende rollenbasierte Policies greifen nie.** Eine mit `TO authenticated`
  definierte Policy gilt nicht für `rebase_user`, da `rebase_user` die Privilegien
  anderer Rollen nicht erbt.
- **Manche Datenbanken erlauben der Anwendung überhaupt nicht, Rollen zu erstellen.**
  Ein DBA erstellt jede Rolle manuell, oder Rollen werden über Terraform verwaltet.

Für jeden dieser Punkte gibt es eine Einstellung. Jede Einstellung verwendet als
Standardwert das bisherige Verhalten von Rebase, sodass sich ein Projekt, das nichts
konfiguriert, exakt wie zuvor verhält.

## Zuerst die Datenbank prüfen

```bash
rebase doctor --database
```

Dieser Befehl liest den Systemkatalog der Projektdatenbank aus und ändert nichts.
Er meldet:

- ob jede Anfrage-Rolle existiert, eingeschränkt ist und ob diese Verbindung zu
  ihr wechseln darf;
- andere Login-Rollen, die in die Anfrage-Rolle wechseln können;
- ob sich jede Rolle auf dem Cluster mit dieser Datenbank verbinden darf;
- Tabellen in den Schemas von Rebase, die Rebase nicht bedient;
- andere Rollen, die Privilegien für die Tabellen von Rebase besitzen;
- Policies auf Rebase-Tabellen, die mit `TO` für eine Rolle definiert sind, die
  die Anfrage-Rolle nicht erbt;
- Standardberechtigungen (Default Privileges), die neue Tabellen an andere Rollen
  übergeben.

Jeder Befund enthält das SQL, das als Datenbankadministrator ausgeführt werden muss,
die Einstellung, mit der Rebase stattdessen an die Datenbank angepasst wird, oder
beides. Er beendet sich mit dem Exit-Code 1, wenn ein Befund ein Fehler ist, sodass
er als Prüfschritt (Gate) für ein Deployment dienen kann. Er gleicht die Datenbank
mit den sichtbaren Einstellungen ab: den `REBASE_RLS_*`-Variablen und anschließend
den Anfrage-Rollen, die ein Serverstart in der Datenbank hinterlegt hat.

`npx @rebasepro/rls-check` prüft die Policies selbst auf jeder beliebigen Postgres-Instanz.
Auf einer Rebase-Datenbank liest es die Anfrage-Rolle auf dieselbe Weise aus; geben Sie
sie mit `--request-role` an, falls sie noch nicht erfasst wurde.

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

Oder über Umgebungsvariablen, welche Vorrang vor der Deklaration haben. Die Umgebung
eignet sich für Werte, die sich zwischen zwei Deployments desselben Codes unterscheiden,
wie etwa der Rollenname, wenn Staging und Produktion sich einen Cluster teilen.

| Einstellung | Umgebungsvariable | Standardwert | Alternativen |
|---|---|---|---|
| `requestRole` | `REBASE_RLS_REQUEST_ROLE` (ein einzelner Name) | `"rebase_user"` | Beliebiger Rollenname. `{ anonymous, signedIn }`, um Aufrufer ohne Session als eine Rolle und angemeldete Aufrufer als eine andere auszuführen. Im Code des Treibers eine Funktion der Identität der Anfrage. |
| `requestRoles` | keine | abgeleitet aus `requestRole` | Jede Rolle, die ein funktionsbasiertes `requestRole` zurückgeben kann, damit jede bereitgestellt, berechtigt und geprüft werden kann. Erforderlich bei Verwendung einer Funktion. |
| `provisionRole` | `REBASE_RLS_PROVISION_ROLE` | `"auto"`: Rolle erstellen, falls fehlend, und dieser Verbindung das Recht gewähren, zu ihr zu wechseln | `"never"`: Rolle und Mitgliedschaft liegen in Ihrer Verantwortung. Der Start prüft beides und schlägt mit dem auszuführenden SQL fehl. |
| `grants` | `REBASE_RLS_GRANTS` | `"schema"`: jede Tabelle und Sequenz in den von Rebase bedienten Schemas, für die die Verbindung Rechte vergeben darf, plus Standardberechtigungen für später erstellte Tabellen | `"managed"`: nur die von Rebase bedienten Tabellen und keine Standardberechtigungen. `"none"`: Rebase vergibt keine Rechte; der Zugriff auf eine Tabelle, die Sie nicht berechtigt haben, wird verweigert. |
| `policyTarget` | `REBASE_RLS_POLICY_TARGET` | `"public"` | `"requestRole"`: permissive Policies gelten nur für die Anfrage-Rolle(n). Restriktive Policies gelten weiterhin für alle. |
| `adminPolicies` | `REBASE_RLS_ADMIN_POLICIES` | `"adminRole"`: Policies, die nur der Serverkontext oder ein Admin erfüllen kann (die Basis-Policy, `roles: ["admin"]`), werden mit `TO rebase_admin` definiert, und Admin-Anfragen laufen als `<request role>_admin` | `"public"`: Diese Policies lauten `TO public` und Admins laufen als die Anfrage-Rolle, wie vor Einführung dieser Einstellung. |
| `defaultPolicies` | `REBASE_RLS_DEFAULT_POLICIES` | `true` | `false`: Keine Tabelle erhält die Server-oder-Admin-Basis-Policy. Das eigene `defaultPolicies: false` einer Tabelle entscheidet weiterhin individuell. |
| `inheritRoles` | keine | `[]` | Rollen, die der Anfrage-Rolle `WITH INHERIT TRUE` gewährt werden, sodass für sie definierte Policies (`TO`) greifen. Bei einem `{ anonymous, signedIn }`-Paar erhält nur die angemeldete Rolle diese Rechte; bei einer Funktion wird die Einstellung abgelehnt. PostgreSQL 16 und neuer; wird unter Version 15 und älter verweigert. |
| `identity` | `REBASE_RLS_IDENTITY` (benannte Formen) | `"rebase"`: `app.uid`, `app.user_roles`, `app.is_anonymous`, `app.jwt` | `"supabase"`: zusätzlich `request.jwt.claims`, `request.jwt.claim.sub` und `request.jwt.claim.role`, damit `auth.uid()` und `auth.jwt()` den Aufrufer sehen. Im Code des Treibers eine Funktion, die zusätzliche Einstellungen zurückgibt. Die `app.*`-Einstellungen werden immer gesetzt. |
| `sharedRole` | `REBASE_RLS_SHARED_ROLE` | `"warn"` wenn ein anderes Login in die Anfrage-Rolle wechseln kann | `"refuse"`: Start fehlschlagen lassen. `"ignore"`: ignorieren. |

Die Funktionsformen von `requestRole` und `identity` werden nur im treibereigenen
`rls`-Block akzeptiert, der dieselben Einstellungen unterstützt. `policyTarget`,
`adminPolicies` und `defaultPolicies` verändern das Policy-SQL, das `rebase db generate`
erzeugt, und das CLI kann den Treibercode nicht lesen. Legen Sie diese daher in der
Deklaration oder in der Umgebung fest. Ein Startvorgang, der sie nur im Treibercode
vorfindet, verweigert den Dienst.

Beim Start listet die Zeile, die über die Isolierung von Anfragen berichtet, jede
Einstellung auf, die nicht ihrem Standardwert entspricht. Eine Einstellung, die eine
Aufgabe an Sie überträgt, wie etwa `grants: "none"`, weist einmalig darauf hin, um
welche Aufgabe es sich handelt.

Der erste Bereitstellungsstart hinterlegt die Anfrage-Rolle(n) in `rebase.schema_meta`.
Ein späterer Start, der mit einer anderen Rolle konfiguriert ist, verweigert den Start
und nennt den unten beschriebenen Befehl zur Migration der Datenbank. Ohne diese Prüfung
würde die alte Rolle ihre Berechtigungen behalten, während parallel eine neue eingerichtet
würde.

## Rezepte

### Ein mit anderen Apps oder Projekten geteilter Cluster

Weisen Sie jedem Projekt und jedem Deployment, das sich einen Cluster teilt, eine eigene
Rolle zu:

```bash
REBASE_RLS_REQUEST_ROLE=acme_prod_user
```

Eine Datenbank, die bereits als `rebase_user` gelaufen ist, hat dies gespeichert.
Migrieren Sie sie daher zuerst:

```bash
rebase db request-role migrate --to acme_prod_user --dry-run
rebase db request-role migrate --to acme_prod_user
```

Der Befehl erstellt die neue Rolle, falls sie fehlt, vergibt ausschließlich in dieser
Datenbank jede Berechtigung der alten Rolle neu (Tabellen, Spalten, Sequenzen, Schemas,
Funktionen, die von dieser Verbindung festgelegten Standardberechtigungen sowie
Mitgliedschaften), passt Policies an, die die alte Rolle benennen, und hinterlegt
die neue Rolle. Er wird in einer einzigen Transaktion ausgeführt. Die alte Rolle bleibt
unverändert, da eine andere Datenbank auf dem Cluster sie möglicherweise noch verwendet.
Nach Abschluss gibt der Befehl die `REVOKE`-Anweisungen aus, mit denen die Berechtigungen
der alten Rolle in dieser Datenbank entzogen werden können, sobald hier nichts mehr darauf
angewiesen ist. `--dry-run` gibt dieselben Anweisungen aus und ändert nichts. In einem
interaktiven Terminal fragt er vor der Ausführung nach; ohne Terminal verweigert er
die Ausführung ohne `--yes`.

Setzen Sie anschließend `REBASE_RLS_REQUEST_ROLE` auf jedem Server, der die Datenbank
verwendet.

`rebase doctor --database` meldet auch, falls sich jede Rolle auf dem Cluster mit der
Datenbank verbinden darf, zusammen mit dem `REVOKE CONNECT … FROM PUBLIC`, das dies
unterbindet. Rebase führt dies auf einer Datenbank, die ihm nicht gehört, nicht selbst
aus.

### Supabase

Ein bestehendes Supabase-Schema enthält bereits `anon` und `authenticated` sowie
Policies, die mit `auth.uid()` darauf aufbauen. Damit diese Policies unverändert
für Rebase-Anfragen gelten:

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
- `identity: "supabase"` setzt die `request.jwt.*`-Einstellungen, die `auth.uid()`
  liest. Ohne diese schlägt jede Prüfung der Form `auth.uid() = owner_id` fehl oder
  ist erfolgreich, wenn sie es nicht sein sollte.
- `policyTarget: "requestRole"` verhindert, dass die eigenen Policies von Rebase
  auf Sessions angewendet werden, die keine Rebase-Anfragen sind, wie etwa über
  Supabases Data-API.

Da Anfragen selbst als `anon` und `authenticated` ausgeführt werden, gelten Policies
mit `TO anon` oder `TO authenticated` unverändert, und `inheritRoles` wird nicht
benötigt. Dies ist für ein Projekt gedacht, dessen Anfragen unter einer eigenen Rolle
laufen, wie etwa `requestRole: "acme_user", inheritRoles: ["authenticated"]`. Bei
einem `{ anonymous, signedIn }`-Paar wird es ausschließlich der angemeldeten Rolle
gewährt, niemals der anonymen.

Die standardmäßigen Default-Privilegien von Supabase gewähren `anon` und `authenticated`
Zugriff auf in `public` erstellte Tabellen; überprüfen Sie dies für Ihr Projekt.
Führen Sie nach dem ersten Start `rebase doctor --database` und `rls-check` aus,
um zu sehen, worauf diese Rollen zugreifen können.

### Ein Datenbankadministrator erstellt die Rollen

Wenn die Verbindung keine Rollen erstellen darf oder Rollen in Terraform verwaltet
werden:

```bash
REBASE_RLS_PROVISION_ROLE=never
```

Der Startvorgang prüft dann die Rolle und die Mitgliedschaft und schlägt mit dem
auszuführenden SQL fehl, anstatt zu versuchen, sie anzulegen. Um dieses SQL dem
Administrator vorab bereitzustellen:

```bash
rebase db provision --print > request-role.sql
```

Es gibt für jede Anfrage-Rolle die Anweisungen aus, um sie zu erstellen
(`NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT`), der Verbindungsrolle das Recht zu
erteilen, zu ihr zu wechseln (`WITH SET TRUE, INHERIT FALSE` unter PostgreSQL 16
und neuer), und ihr die Schemas unter `grants: "schema"` zuzuweisen. Die Erläuterungen
sind als SQL-Kommentare verfasst, sodass die Datei unverändert ausgeführt werden kann.
Es liest die Verbindungsrolle aus der Datenbank aus und führt nichts weiter aus.
Jede Anweisung kann gefahrlos wiederholt ausgeführt werden.

### Admin-Anfragen und `rebase_admin`

Postgres verknüpft permissive Policies, die für eine Rolle gelten, mit OR. Wäre die
Basis-Policy, die jede Tabelle besitzt (`rebase.uid() IS NULL OR` die `admin`-Rolle),
mit `TO public` definiert, würde sie auch für angemeldete Benutzer gelten. Ein OR,
dessen anderer Zweig für das gesamte Statement konstant ist, kann jedoch keinen Index
nutzen: Ein Abruf oder Zählvorgang (Count) eines Benutzers im Gültigkeitsbereich des
Eigentümers würde die gesamte Tabelle scannen. Daher werden Policies, die nur der
Serverkontext oder ein Admin erfüllen kann, mit `TO rebase_admin` geschrieben und
erreichen niemals den Abfrageplan eines normalen Benutzers.

`rebase_admin` besitzt keine Berechtigungen und kann sich nicht einloggen. Ein
Aufrufer mit der Rolle `admin`, einschließlich `rebase.dataAsAdmin`, wird als
`<request role>_admin` ausgeführt (standardmäßig `rebase_user_admin`), welche die
Anfrage-Rolle und `rebase_admin` erbt. Eine Verbindung, die selbst der Row-Level Security
unterliegt, erbt `rebase_admin` für den Serverkontext. Der Startvorgang richtet dies
alles automatisch ein, sofern die Verbindung Rollen erstellen darf. Erstellen Sie
diese unter `provisionRole: "never"` selbst:

```sql
CREATE ROLE rebase_admin NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
CREATE ROLE rebase_user_admin NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
GRANT rebase_user, rebase_admin TO rebase_user_admin WITH INHERIT TRUE, SET FALSE;
GRANT rebase_user_admin TO <connection role> WITH SET TRUE, INHERIT FALSE;
```

Unter PostgreSQL 15 und älter erstellen Sie `rebase_user_admin` mit `INHERIT` und
lassen die `WITH`-Optionen weg. Falls `rebase_admin` überhaupt nicht erstellt werden
kann, schreiben der Startvorgang und `rebase db push` diese Policies mit `TO public`,
wie es zuvor der Fall war, und Admins laufen weiterhin als die Anfrage-Rolle.
`rebase doctor --database` meldet, welche dieser Varianten bei Ihnen vorliegt.

#### Admin-Leseoperationen nutzen die Indizes des Eigentümers

Eine Policy, die keine Konstante ist, hindert Postgres daran, einen Index für einen
Operator zu nutzen, der nicht leakproof ist – wie etwa `&&` auf einem Array, `~`
oder ein JSONB-Operator. Ohne den folgenden Schritt scannte `tags && $1` eines Admins
die gesamte Tabelle, während dieselbe Abfrage als Eigentümer den GIN-Index nutzte.
Dies betraf `rebase.sqlAsAdmin`, `rebase.dataAsAdmin` und Admin-Benutzer gleichermaßen.

Daher versieht der Startvorgang jede Nur-Admin-Policy, die jeder Admin erfüllt, mit
einem Begleiter `TO rebase_admin_request USING (true)` mit dem Namen `<policy>_ar_<hash>`.
Bei einer Admin-Anfrage reduziert Postgres die Policies auf `true` und plant die
Abfrage genauso wie für den Eigentümer. Restriktive Policies gelten weiterhin. Nur
die `<request role>_admin`-Rollen dürfen `rebase_admin_request` besitzen. Bei jedem
Start prüft Rebase, welche Rollen dessen Privilegien innehaben. Falls eine andere
Rolle, die der Row-Level Security unterliegt, diese besitzt, erstellt der Start keine
Begleiter und entfernt alle vorhandenen. Begleiter erfordern PostgreSQL 16 oder neuer,
da unter Version 15 und älter die Verbindung die Rolle erben würde. Nur der Startvorgang
erstellt sie. `policies.sql` und Migrationen erstellen niemals Begleiter, entfernen
jedoch den Begleiter jeder von ihnen umgeschriebenen Policy, die keinen mehr beansprucht.
`rebase db push` und `rebase db migrate` entfernen ebenfalls jeden Begleiter, dessen
Regel entfallen ist. Eine eingeschränkte oder entfernte Admin-Regel gewährt somit nicht
länger jedem Admin Zugriff – selbst dort, wo der Startvorgang nichts bereitstellt.
Erstellen Sie die Rolle unter `provisionRole: "never"` selbst:

```sql
CREATE ROLE rebase_admin_request NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
GRANT rebase_admin_request TO rebase_user_admin WITH INHERIT TRUE, SET FALSE;
```

Bevor Sie ein Rollback auf ein Release durchführen, das älter ist als dasjenige,
mit dem Begleiter eingeführt wurden, sollten Sie diese deaktivieren. Eine ältere
Runtime kennt sie nicht und entfernt sie nie. Eine später geänderte Regel würde
daher dazu führen, dass ihr Begleiter weiterhin jedem Admin Zugriff auf jede Zeile
gewährt. Eine einzige Anweisung pro Admin-Anfrage-Rolle stellt sicher, dass kein
Begleiter mehr Zugriff gewährt:

```sql
REVOKE rebase_admin_request FROM rebase_user_admin;
```

Oder löschen Sie diese: jede Policy, deren Name auf `_ar_` gefolgt von acht
Hexadezimalziffern endet und deren Rolle `rebase_admin_request` ist.

### Ein geteiltes `public`-Schema

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Wenn `public` Tabellen enthält, auf die Rebase nicht zugreifen soll:

```bash
REBASE_RLS_GRANTS=managed
```

Rebase gewährt der Anfrage-Rolle dann nur Zugriff auf die Tabellen, die es tatsächlich
bedient: deklarierte Tabellen, Zwischentabellen (Junction Tables) und seine eigenen
zeilengeschützten Tabellen. Es setzt keine Standardberechtigungen in geteilten Schemas
und entzieht keine bereits vergebenen Rechte. `rebase doctor --database` listet die
Tabellen in den Schemas von Rebase auf, die es nicht bedient.

Ein anderer Ausweg ist ein eigenes Schema für Rebase: Setzen Sie `schema` bei jedem
`defineTable`.

## Provider

Welche Aktionen die Verbindungsrolle ausführen darf, unterscheidet sich je nach Provider
und bestimmt, ob Rebase die Anfrage-Rolle selbst anlegen kann. Die folgenden Hinweise
entsprechen unseren Erfahrungswerten; prüfen Sie diese bei Ihrem Provider.

| Provider | Übliche Verbindungsrolle | Hinweise |
|---|---|---|
| Supabase | `postgres` (kein Superuser, besitzt CREATEROLE) | Eine Datenbank pro Projekt. `anon`, `authenticated` und `authenticator` sind vorhanden, mit Standardberechtigungen in `public`. Siehe das Supabase-Rezept oben. |
| Neon | der Projekteigentümer, Mitglied von `neon_superuser` | Rollen gehören zu einem Branch, und jede Datenbank auf einem Branch teilt sie sich. Zwei Rebase-Datenbanken in einem Neon-Projekt teilen sich `rebase_user`; legen Sie `requestRole` daher pro Datenbank fest. |
| AWS RDS / Aurora | der Master-Benutzer, Mitglied von `rds_superuser` | Besitzt CREATEROLE, ist jedoch kein Superuser. Instanzen werden häufig von mehreren Apps geteilt. |
| Google Cloud SQL | `postgres`, Mitglied von `cloudsqlsuperuser` | Wie RDS. |
| Azure Flexible Server | der Admin-Benutzer, Mitglied von `azure_pg_admin` | Wie RDS. |
| InstaPods | `instapod`; Superuser über `sudo -u postgres` | Der [Leitfaden für InstaPods](/docs/deployment/instapods/) erstellt die Rolle im Voraus. |
| Hostman | `gen_user`; CREATE ROLE über das Panel gewährt | Im kleinsten Tarif nicht verfügbar. Der [Leitfaden für Hostman](/docs/deployment/hostman/) erstellt die Rolle im Voraus. |

## Verwandte Themen

- [Datenbank-Befehle](/docs/cli/database/): `rebase db request-role` und
  `rebase db provision`
- [CLI-Referenz](/docs/cli/#rebase-doctor): `rebase doctor --database`
- [rls-check](/docs/rls-check/): Policies auf jeder beliebigen Postgres-Instanz prüfen
- [Sicherheitsregeln (RLS)](/docs/collections/security-rules/): Die Policies,
  die Rebase für jede Tabelle schreibt
