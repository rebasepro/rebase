---
sourceHash: f385a35cc59df9c6
title: Row-Level-Security
sidebar_label: Row-Level-Security
description: "Jede Tabelle deklariert ihre RLS-Grundhaltung – admin-only, inherit oder eine Liste von Regeln – und Rebase kompiliert sie zu Postgres-Row-Level-Security-Policies. Regelformen, Kurzschreibweisen für Bedingungen, defaultRls und was fail-closed ist."
---

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Jede Tabelle legt in ihrem `rls`-Schlüssel fest, wer auf ihre Zeilen zugreifen kann. Rebase kompiliert dies in Postgres-Row-Level-Security: `ENABLE ROW LEVEL SECURITY` auf der Tabelle und ein `CREATE POLICY` pro Regel und Operation. Postgres filtert dann jede Anweisung auf jeder Route – REST, Realtime, MCP, dem CMS und SQL, das im Kontext des Aufrufers ausgeführt wird –, da sich die Regeln in der Datenbank und nicht im Anwendungscode befinden.

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const posts = defineTable("posts", {
    columns: {
        id:       col.uuid().primaryKey().defaultRandom(),
        status:   col.enum(["draft", "published"]).notNull().default("draft"),
        authorId: col.uuid().notNull().onCreateUser(),
    },
    rls: [
        // Anyone reads the published posts.
        { operation: "select", access: "public", condition: { status: "published" } },
        // Authors read and edit their own, drafts included.
        { operations: ["select", "insert", "update"], ownerField: "authorId" },
        // Editors may delete.
        { operation: "delete", roles: ["editor"] },
    ],
});
```

`rls` hat keinen Standardwert. Das Weglassen ist ein Typfehler, und eine Tabelle, die den Compiler ohne eine verwendbare Grundhaltung erreicht, wird abgelehnt. Siehe [Was fail-closed ist](#was-fail-closed-ist).

:::note[Umstieg von Collections?]
`rls` ersetzt `securityRules` und ist erforderlich. Eine für `securityRules` geschriebene Regel ist unverändert ein gültiger Eintrag für `rls`. Der Upgrade-Leitfaden für dieses Release behandelt `defaultSecurityRules` und `disableDefaultPolicies`.
:::

## Die drei Grundhaltungen

<span class="since-badge" data-since="0.31">Seit 0.31</span>

| `rls` | Bedeutung |
|---|---|
| `"admin-only"` | Row-Level-Security aktiviert und nur die Admin-Baseline-Policies: Die `admin`-Rolle und der eigene Code des Servers erreichen Zeilen. Jeder andere Aufrufer erhält keine Zeilen, und Schreibzugriffe werden abgewiesen. |
| `"inherit"` | Das aus `backend/schema/index.ts` exportierte `defaultRls`. Wird abgelehnt, wenn keines vorhanden ist. |
| eine Liste von Regeln | Die zu generierenden Policies, eine oder mehrere. `[]` wird abgelehnt: Verwenden Sie `"admin-only"`, um eine Tabelle auf Admins zu beschränken. |

`"admin-only"` ist die Grundhaltung, mit der eine Tabelle gestartet werden sollte, wenn Sie noch nicht entschieden haben, wer darauf zugreifen darf. Nichts wird freigegeben, bis Sie die Regeln schreiben, die den Zugriff erlauben.

### `defaultRls`

<span class="since-badge" data-since="0.31">Seit 0.31</span>

`backend/schema/index.ts` kann eine Grundhaltung für die Tabellen exportieren, die `rls: "inherit"` angeben:

```ts
// backend/schema/index.ts
import type { DefaultRls } from "@rebasepro/server/schema";

export { posts } from "./posts";
export { comments } from "./comments";

export const defaultRls: DefaultRls = [
    { operation: "select", access: "authenticated" },
    { operations: ["insert", "update", "delete"], roles: ["editor"] },
];
```

`defaultRls` ist `"admin-only"` oder eine nicht-leere Liste von Regeln. Es gilt nur für Tabellen, die `"inherit"` definieren; eine Tabelle mit eigenen Regeln übernimmt keine davon, und die beiden Listen werden niemals zusammengeführt. `rls: "inherit"` ohne exportiertes `defaultRls` bricht `rebase db generate`, `rebase db push` und den Systemstart mit einem Fehler ab, der dazu auffordert, eines zu exportieren.

## Policies, die eine Tabelle automatisch erhält

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Die Policies auf einer Tabelle umfassen mehr als nur ihre eigenen Regeln:

- **Die Admin-Baseline.** Jede Tabelle erhält `<table>_default_admin_read`- und `<table>_default_admin_write`-Policies für Insert, Update und Delete. Sie sind permissiv und lassen den Serverkontext sowie die `admin`-Rolle zu, sodass Administratoren jede Zeile lesen und schreiben können. Permissive Policies werden mit ODER verknüpft, sodass die Baseline alles erweitert, was Ihre Regeln erlauben; sie schränkt sie niemals ein.
- **Die Benutzertabelle.** Eine mit [`defineAuthTable`](/docs/schema/auth-table/) deklarierte Tabelle erhält außerdem eine Policy, die es angemeldeten Benutzern erlaubt, ihre eigene Zeile zu lesen, sowie eine restriktive Schranke, die unabhängig von ihren Regeln nur Administratoren das Schreiben der Berechtigungsspalten (`roles`) erlaubt.
- **Mandantenfähigkeit (Tenancy).** Eine Tabelle mit [`tenant`](/docs/collections/tenancy/) erhält eine restriktive Policy, die jede Operation auf den Mandanten des Aufrufers beschränkt.
- **Verbindungstabellen.** Die Verbindungstabelle einer [`manyToMany`](/docs/collections/relations/#manytomany--through-a-junction)-Beziehung erhält eigene Policies.

`defaultPolicies: false` an einer Tabelle entfernt die permissive Admin-Baseline und behält die restriktiven Schranken bei, sodass die Tabelle genau die Regeln hat, die Sie definiert haben. In Kombination mit `"admin-only"` wird dies abgelehnt, da dies nur die Baseline und sonst nichts darstellt: Diese Kombination würde eine Tabelle hinterlassen, auf die kein Aufrufer zugreifen kann, Administratoren eingeschlossen.

Das generierte DDL markiert jede injizierte Policy, und `rebase db push` stellt manuell gelöschte Policies wieder her.

## Regelformen

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Eine Regel entspricht einer dieser Formen. Das Mischen von zweien in einer Regel ist ein Typfehler, und der Compiler lehnt dies ebenfalls ab, sodass auch JavaScript und Typ-Casts abgefangen werden: `access` neben `ownerField`, `using` oder `withCheck`; `ownerField` neben `using`, `withCheck`, `condition` oder `check`; `condition` oder `check` neben `using` oder `withCheck`. Ebenso verhält es sich mit Werten außerhalb der Liste für `access`, `mode`, `operation(s)` oder `roles` (ein falsch geschriebenes `"restrictive"` wird abgelehnt, nicht als permissiv interpretiert). Eine Regel wird niemals zu einer Policy, die stillschweigend die Hälfte dessen ignoriert, was definiert wurde.

| Form | Beispiel | `USING` (welche Zeilen) | `WITH CHECK` (was geschrieben werden darf) |
|---|---|---|---|
| Owner | `{ ownerField: "authorId" }` | Spalte entspricht der ID des Aufrufers | identisch |
| Public | `{ access: "public" }` | jede Zeile | jede Zeile |
| Angemeldet | `{ access: "authenticated" }` | jede Zeile, für angemeldete Aufrufer | identisch |
| Mit Account angemeldet | `{ access: "registered" }` | jede Zeile, für angemeldete Aufrufer, die kein Gast sind | identisch |
| Zugriff mit Bedingung | `{ access: "public", condition: { status: "published" } }` | die Bedingung (und angemeldet für `"authenticated"` und `"registered"`) | `check`, andernfalls die Bedingung, auf dieselbe Weise abgesichert |
| Zugriff mit Check | `{ access: "authenticated", check: { state: "open" } }` | nur die Zugriffsprüfung | der Check, abgesichert durch die Zugriffsprüfung |
| Strukturiert | `{ condition: policy.rolesOverlap(["moderator"]) }` | die Bedingung | `check`, andernfalls die Bedingung |
| Reines SQL | `{ using: "{published_at} > now() - interval '30 days'" }` | das SQL | `withCheck`, andernfalls `using` |
| Nur reiner Check | `{ operation: "insert", withCheck: "{owner_id} = rebase.uid()" }` | keine Zeilen | das SQL |
| Nur Rollen | `{ operation: "delete", roles: ["admin"] }` | jede Zeile, für die Rollen | identisch |

Jede Form akzeptiert auch die gemeinsamen Schlüssel:

| Schlüssel | Standard | Was er bewirkt |
|---|---|---|
| `operation` | `"all"` | `"select"`, `"insert"`, `"update"`, `"delete"` oder `"all"`. |
| `operations` | | Mehrere Operationen gleichzeitig; pro Operation wird eine Policy generiert. Hat Vorrang vor `operation`. |
| `roles` | | Anwendungsrollen; die Regel gilt nur für Aufrufer, die eine dieser Rollen innehaben. Wird mit dem Rest der Regel mit UND verknüpft. |
| `mode` | `"permissive"` | `"restrictive"` macht die Regel zu einer Schranke, die ebenfalls erfüllt sein muss. Siehe [Permissiv und restriktiv](#permissiv-und-restriktiv). |
| `name` | abgeleitet | Der Policy-Name. Ohne diesen wird der Name aus der Tabelle, der Operation und einem Hash der Regel abgeleitet, sodass das Bearbeiten einer Regel deren Policy umbenennt. |
| `pgRoles` | `["public"]` | Native Postgres-Rollen: die `TO`-Klausel von `CREATE POLICY`. Nicht identisch mit `roles`. |

`roles` sind Rebase-Anwendungsrollen, die in der Spalte `roles` der Benutzertabelle gespeichert und innerhalb einer Policy über `rebase.roles()` ausgelesen werden. Es sind keine Postgres-Rollen: Namen wie `anon` oder `authenticated` gehören zu `pgRoles`, und unter `roles` erzeugen sie eine Bedingung, die kein Benutzer erfüllt. Nahezu jedes Projekt benötigt `roles`.

:::note[Aus Version 0.30 migrierte Regeln]
Der 0.30-Compiler hat nur eine Klausel einer Regel gelesen und kannte außer `"public"` keinen `access`-Wert, sodass vier Varianten jetzt etwas anderes gewähren – ein einfaches `access: "authenticated"` gewährte zuvor nichts und lässt nun jeden angemeldeten Aufrufer zu. `rebase migrate collections-to-tables` listet jeden dieser Fälle unter „Review before deploying“ auf; siehe [den Upgrade-Leitfaden](/docs/upgrading/0-30-to-0-31/#review-before-deploying-these-rules-change-meaning).
:::

### Owner

<span class="since-badge" data-since="0.31">Seit 0.31</span>

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const notes = defineTable("notes", {
    columns: {
        id:      col.uuid().primaryKey().defaultRandom(),
        ownerId: col.uuid().notNull().onCreateUser(),
        body:    col.text(),
    },
    rls: [{ operation: "all", ownerField: "ownerId" }],
});
```

Dies generiert `USING ((owner_id)::text = (SELECT rebase.uid()))`.
`ownerField` benennt einen Spaltenschlüssel, eine SQL-Spalte oder eine `belongsTo`-Relation (deren Fremdschlüsselspalte). Es vergleicht die Spalte mit der ID des Aufrufers; es befüllt sie nicht. `.onCreateUser()` veranlasst den Server, beim Erstellen die ID des Aufrufers zu schreiben – unabhängig davon, was im Request gesendet wurde –, was dem Vergleich überhaupt erst Bedeutung verleiht.

### Öffentlicher Zugriff

<span class="since-badge" data-since="0.31">Seit 0.31</span>

`{ operation: "select", access: "public" }` generiert `USING (true)`: kein Zeilenfilter bei Lesezugriffen, sodass jeder Aufrufer, den die API durchlässt, jede Zeile lesen kann.

Es erweitert, welche Zeilen ein Aufrufer sieht, nicht wer anfragen darf. Standardmäßig antwortet die API bei einem Request ohne Token weiterhin mit 401. Setzen Sie `AUTH_REQUIRE=false` (`auth.requireAuth: false`), um diese Schranke zu entfernen und ausschließlich die Policies entscheiden zu lassen; dann kann auch ein nicht authentifizierter Aufrufer diese Zeilen lesen.

`{ access: "authenticated" }` entspricht dem mit einer Prüfung auf Anmeldung: Der Aufrufer verfügt über eine Sitzung. Ein über die anonyme Anmeldung erstellter Gast besitzt eine solche. `{ access: "registered" }` schließt Gäste zusätzlich aus; bevorzugen Sie dies in Projekten mit anonymer Anmeldung. Beide lassen sich wie `"public"` mit `condition` und `check` kombinieren. Siehe [`authenticated()` und `registered()`](#authenticated-und-registered).

### Bedingungen

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Eine `condition` legt fest, welche vorhandenen Zeilen eine Regel abdeckt; ein `check` definiert, welche neuen oder aktualisierten Werte sie zulässt, und verwendet standardmäßig die Bedingung. Beide akzeptieren die Kurzschreibweise als Objekt oder einen strukturierten Ausdruck.

Die **Kurzschreibweise** ist ein einfaches Objekt aus Spaltenschlüsseln und Literalwerten. Sie gilt, wenn jede Spalte ihrem Wert entspricht, und ein `null`-Wert bedeutet `IS NULL`:

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const reports = defineTable("reports", {
    columns: {
        id:        col.uuid().primaryKey().defaultRandom(),
        state:     col.enum(["open", "closed"]).notNull().default("open"),
        public:    col.boolean().notNull().default(false),
        deletedAt: col.timestamp({ withTimezone: true }),
    },
    rls: [
        // Anyone reads public reports that are not deleted.
        { operation: "select", access: "public", condition: { public: true, deletedAt: null } },
        // Signed-in callers may file a report, but only as an open one.
        { operation: "insert", access: "authenticated", check: { state: "open" } },
    ],
});
```

Die Kurzschreibweise erfordert mindestens einen Schlüssel, und kein Schlüssel darf `kind` heißen (daran wird ein strukturierter Ausdruck erkannt; vergleichen Sie eine Spalte namens `kind` mit der ausführlichen Form). Ihre Schlüssel werden beim Kompilieren des Schemas gegen die Tabelle geprüft: Ein Schlüssel, der keiner Spalte entspricht, wird abgelehnt, wobei die Tabelle und der Schlüssel im Fehler genannt werden.

Eine **strukturierte** Bedingung wird mit `policy` erstellt, das aus `@rebasepro/types` importiert wird. Sie wird für die Datenbank zu SQL kompiliert und vom CMS in JavaScript ausgewertet, sodass das CMS niemals eine Aktion anbietet, die von der Datenbank abgelehnt werden würde:

```ts
import { defineTable, col } from "@rebasepro/server/schema";
import { policy } from "@rebasepro/types";

export const documents = defineTable("documents", {
    columns: {
        id:     col.uuid().primaryKey().defaultRandom(),
        teamId: col.uuid().notNull(),
        userId: col.uuid().notNull(),
    },
    rls: [
        // The owner, or anyone holding `moderator`.
        {
            operation: "update",
            condition: policy.or(
                policy.compare(policy.field("userId"), "eq", policy.authUid()),
                policy.rolesOverlap(["moderator"])
            ),
        },
        // Members of the document's team read it.
        {
            operation: "select",
            condition: policy.existsIn({
                table: "team_members",
                where: policy.and(
                    policy.compare(policy.field("team_id"), "eq", policy.outerField("teamId")),
                    policy.compare(policy.field("user_id"), "eq", policy.authUid())
                ),
            }),
        },
    ],
});
```

Innerhalb von `existsIn` benennt `policy.field()` eine Spalte der anderen Tabelle und `policy.outerField()` eine Spalte der geprüften Zeile. Es wird zu einer korrelierten `EXISTS`-Unterabfrage kompiliert.

| Ausdruck | Kompiliert zu |
|---|---|
| `policy.true()` / `policy.false()` | `true` / `false` |
| `policy.and(…)` / `policy.or(…)` / `policy.not(e)` | Konjunktion, Disjunktion, Negation |
| `policy.compare(left, op, right)` | ein Vergleich; `op` ist `"eq"`, `"neq"`, `"lt"`, `"lte"`, `"gt"` oder `"gte"` |
| `policy.rolesOverlap(roles)` | der Aufrufer besitzt **eine beliebige** dieser Rollen |
| `policy.rolesContain(roles)` | der Aufrufer besitzt **alle** dieser Rollen |
| `policy.authenticated()` | ein angemeldeter Aufrufer |
| `policy.registered()` | ein angemeldeter Aufrufer mit Account, kein Gast |
| `policy.serverContext()` | `rebase.uid() IS NULL`; siehe den Sicherheitshinweis unten |
| `policy.existsIn({ table, where })` | ein korreliertes `EXISTS` über eine andere Tabelle; ohne `table` wird beim Kompilieren des Schemas abgelehnt |
| `policy.raw(sql)` | das SQL, unverändert eingefügt |

| Operand | Bedeutung |
|---|---|
| `policy.field(name)` | eine Spalte der geprüften Zeile oder innerhalb von `existsIn` der anderen Tabelle |
| `policy.outerField(name)` | innerhalb von `existsIn`, eine Spalte der geprüften Zeile |
| `policy.literal(value)` | ein String, eine Zahl, ein Boolean oder `null` |
| `policy.authUid()` | `rebase.uid()` |
| `policy.authRoles()` | die Rollen des Aufrufers als Array |
| `policy.authClaim(name)` | ein benutzerdefinierter Claim auf dem Session-Token, gecastet auf den Typ der verglichenen Spalte |

`existsIn`, `raw` und `authClaim` werden ausschließlich von der Datenbank ausgewertet; das CMS behandelt sie als unbekannt und spiegelt wider, was der Server meldet.

### Reines SQL

<span class="since-badge" data-since="0.31">Seit 0.31</span>

`using` und `withCheck` akzeptieren SQL. `{column}` wird zur Spalte der Tabelle aufgelöst, und der Aufrufer ist als `rebase.uid()`, `rebase.roles()` (kommagetrennte Rollen) und `rebase.jwt()` (die Claims des Tokens als `jsonb`) verfügbar:

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const tasks = defineTable("tasks", {
    columns: {
        id:       col.uuid().primaryKey().defaultRandom(),
        orgId:    col.uuid().notNull(),
        isLocked: col.boolean().notNull().default(false),
    },
    rls: [
        {
            operation: "select",
            using: "EXISTS (SELECT 1 FROM org_members m WHERE m.org_id = {org_id} AND m.user_id = rebase.uid())",
        },
        { operation: "update", mode: "restrictive", using: "{is_locked} = false", withCheck: "{is_locked} = false" },
    ],
});
```

Reines SQL wird allein von Postgres durchgesetzt: Das CMS kann es nicht auswerten. Bevorzugen Sie die Kurzschreibweise oder eine strukturierte Bedingung, wo immer sich dasselbe ausdrücken lässt.

## Einmal pro Anweisung ausgewertet

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Jeder Teil einer Regel, der die Zeile nicht liest – die ID des Aufrufers, eine Rollenprüfung, ein Claim, `serverContext()` –, wird innerhalb einer skalaren Unterabfrage kompiliert. Eine Owner-Regel wird zu `(user_id)::text = (SELECT rebase.uid())`. Postgres berechnet eine solche Unterabfrage einmal pro Anweisung statt einmal pro Zeile und plant so, als ob die Prüfung die Hälfte der Tabelle statt 1,5 % davon passiert, wodurch auch tiefe Seiten einer großen Tabelle auf ihrem Index bleiben. Wer was lesen oder schreiben darf, bleibt unverändert.

Reines SQL wird genauso behandelt, wenn Rebase seine Struktur lesen kann (`owner_id = rebase.uid()` tut dies). Alles andere wird unverändert eingefügt; kapseln Sie die Aufrufe daher selbst: `(SELECT rebase.uid())`.

## `authenticated()` und `registered()`

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Einem Request ganz ohne Sitzung wird eine Sentinel-ID zugewiesen, sodass `rebase.uid()` bei einem Request niemals `NULL` ist und `policy.authenticated()` (wie `access: "authenticated"`) diesen ausschließt.

Ein **Gast** verhält sich anders: `POST /auth/anonymous` erstellt eine echte Benutzerzeile mit einer echten Sitzung, sodass ein Gast jede Prüfung besteht, die auf die ID schaut. `policy.registered()` (und `access: "registered"`) entspricht `authenticated()` plus „kein Gast“. Verwenden Sie dies überall dort, wo eine Regel eine Person betrifft, die zur Verantwortung gezogen werden könnte – das Verfassen einer Bewertung, der Beitritt zu einer Organisation, das Ausgeben von Geld –, und `authenticated()`, wo Gäste willkommen sind: ein Warenkorb vor dem Checkout, ein Entwurf vor der Registrierung.

:::caution[`serverContext()` wird durch `dataAsAdmin` nicht erfüllt]
Es kompiliert zu `rebase.uid() IS NULL`, was nur für integrierte Abläufe gilt, die ohne Benutzer ausgeführt werden (Registrierung, Migrationen). `rebase.dataAsAdmin` läuft als `uid: "service"` mit der Rolle `admin`, daher ist es dort **false**. Eine Tabelle mit `defaultPolicies: false`, deren einzige Regel `serverContext()` ist, weist diese Schreibvorgänge ab und liefert für diese Lesevorgänge keine Zeilen zurück. `rebase.sql()` ist der Zugriffsweg, der Policies umgeht.
:::

## Permissiv und restriktiv

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Permissive Regeln (Standard) werden mit ODER verknüpft: Eine Zeile wird erreicht, sobald eine beliebige dieser Regeln den Zugriff gewährt. Restriktive Regeln werden mit ihnen durch UND verknüpft: Jede restriktive Regel muss ebenfalls erfüllt sein. Eine permissive Regel erweitert den Zugriff; eine restriktive kann ihn nur einschränken. Mandantenfähigkeit (Tenancy) ist aus diesem Grund eine restriktive Regel: Eine `access: "public"`-Regel an anderer Stelle der Tabelle kann die Mandantengrenze nicht aufheben.

## Was fail-closed ist

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Eine Tabelle kann nicht versehentlich erreichbar werden:

- **Im Editor:** `rls` ist erforderlich und `[]` ist kein gültiger Wert.
- **Beim Laden des Moduls:** `defineTable` wirft einen Fehler, wenn `rls` fehlt, leer ist oder nicht einer der drei Grundhaltungen entspricht, sodass auch JavaScript-Fehler und Casts abgefangen werden.
- **Beim Kompilieren des Schemas** – `rebase db generate`, `rebase db push`, `rebase doctor` und beim Serverstart – wird das Schema abgelehnt bei `"inherit"` ohne `defaultRls`, bei `"admin-only"` mit `defaultPolicies: false` sowie bei einer Regel, die eine Spalte benennt, die die Tabelle nicht besitzt (in `ownerField`, einem Schlüssel der Kurzschreibweise oder einem `policy.field()`). Ein Tippfehler in einer Regel würde andernfalls `CREATE POLICY` erreichen und dort fehlschlagen – bei einer Tabelle, deren Row-Level-Security bereits aktiviert ist, wodurch sie für jeden gesperrt bliebe.
- **Ohne ein Schema**, wenn das Backend die Tabellen aus der Datenbank liest, wird eine Tabelle ohne `ENABLE ROW LEVEL SECURITY` nicht bereitgestellt. Der Startvorgang benennt sie zusammen mit dem `ALTER TABLE … ENABLE ROW LEVEL SECURITY`, das sie schützt. Siehe [Backend only](/docs/getting-started/headless/).

Jeder Request führt seine Anweisungen unter einer Datenbankrolle aus, für die Row-Level-Security gilt, innerhalb einer Transaktion, die die ID, Rollen und Claims des Aufrufers enthält. Dies ist es, was `rebase.uid()`, `rebase.roles()` und `rebase.jwt()` auslesen.

## Requests ohne Sitzung

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Ein Request ohne Token erreicht die Policies nur dann, wenn `AUTH_REQUIRE=false` gesetzt ist; andernfalls antwortet die API vorab mit 401. Er wird dann mit `rebase.uid()` gesetzt auf `'anonymous'` und ohne Rollen ausgeführt: `access: "public"`-Regeln gewähren Zugriff, `access: "authenticated"`- und Owner-Regeln hingegen nicht.

Ein Kontaktformular nimmt Inserts von jedermann entgegen und wird nur von Admins gelesen:

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const contactMessages = defineTable("contact_messages", {
    columns: {
        id:      col.uuid().primaryKey().defaultRandom(),
        email:   col.text().notNull().validate({ email: true }),
        message: col.text().notNull().validate({ max: 5000 }),
    },
    rls: [
        { operation: "insert", access: "public" },
        { operations: ["select", "update", "delete"], roles: ["admin"] },
    ],
});
```

## Zeilen hier, Spalten nebenan

<span class="since-badge" data-since="0.31">Seit 0.31</span>

`rls` entscheidet, welche Zeilen ein Aufrufer erreicht. Es trifft keine Aussage über die Spalten einer Zeile, die erreicht wird: Eine Regel, die es einem Mitarbeiter erlaubt, die Zeilen seines Teams zu lesen, erlaubt ihm das Lesen jeder Spalte dieser Zeilen, einschließlich des Gehalts. Regeln pro Spalte werden über [`.access()`](/docs/collections/field-access/) an der Spalte definiert:

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const staff = defineTable("staff", {
    columns: {
        id:     col.integer().primaryKey().generatedByDefaultAsIdentity(),
        name:   col.text().notNull(),
        // Everyone the rules let read the row; only HR receives this column.
        salary: col.numeric({ precision: 10, scale: 2 }).access({ read: ["hr"], write: [] }),
    },
    rls: [{ operation: "select", access: "authenticated" }],
});
```

Die Rollen sind dieselben Rollen: `policy.rolesOverlap(["hr"])` in einer Regel und `.access({ read: ["hr"] })` an einer Spalte bedeuten dasselbe `hr`. Spaltenregeln werden vom Server angewendet, sodass sie jede API-Route abdecken; eine über `rebase.sql()` ausgeführte Abfrage sieht jede Spalte, da sie die Row-Level-Security umgeht.

## Nächste Schritte

<span class="since-badge" data-since="0.31">Seit 0.31</span>

- [Feldzugriff](/docs/collections/field-access/): Lese- und Schreibrollen pro Spalte
- [Mandantenfähigkeit (Tenancy)](/docs/collections/tenancy/): eine restriktive Grenze pro Mandant
- [Rollen und Scopes](/docs/backend/roles-and-scopes/): woher Rollen stammen
- [Die Benutzertabelle](/docs/schema/auth-table/): die Policies, die `defineAuthTable` hinzufügt
