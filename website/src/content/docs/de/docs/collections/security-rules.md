---
sourceHash: 22cf5bf2953fb715
title: Sicherheitsregeln (RLS)
sidebar_label: Sicherheitsregeln
description: Definieren Sie Row-Level-Security-Richtlinien für Ihre Collections mithilfe praktischer Shortcuts oder reiner SQL-Ausdrücke.
---

## Übersicht

Mit Sicherheitsregeln können Sie **Row Level Security (RLS)**-Richtlinien für Ihre PostgreSQL-Tabellen direkt in Ihren Collection-Definitionen festlegen. Wenn das Drizzle-Schema generiert wird, erstellt Rebase die entsprechenden `CREATE POLICY`-Anweisungen.

```typescript
import { defineCollection } from "@rebasepro/cms-types";
const postsCollection = defineCollection({
    slug: "posts",
    name: "Posts",
    table: "posts",
    properties: { /* ... */ },
    securityRules: [
        { operation: "select", access: "public" },
        { operations: ["insert", "update", "delete"], ownerField: "authorId" }
    ]
});
```

## Wie es funktioniert

1. Sie definieren `securityRules` in einer Collection
2. `rebase schema generate` erstellt das Drizzle-Schema mit aktiviertem RLS
3. `rebase db push` oder `rebase db migrate` wendet die Richtlinien auf PostgreSQL an
4. Jede Abfrage wird automatisch nach dem Kontext des aktuellen Benutzers gefiltert

Die Identität des authentifizierten Benutzers ist in SQL über Folgendes verfügbar:

| Funktion | Rückgabewert |
|----------|--------------|
| `rebase.uid()` | Die ID des aktuellen Benutzers |
| `rebase.roles()` | Kommagetrennte App-Rollen-IDs |
| `rebase.jwt()` | Vollständige JWT-Claims als JSONB |

Diese werden vom Rebase-Backend automatisch pro Transaktion gesetzt.

## Praktische Shortcuts

### Besitzerbasierter Zugriff

Das einfachste Muster — Benutzer können nur auf Zeilen zugreifen, die sie selbst besitzen:

```typescript
securityRules: [
    { operation: "all", ownerField: "user_id" }
]
```

Dies generiert: `USING (user_id = rebase.uid())`

### Öffentlicher Zugriff

Erlaubt jedem (einschließlich nicht authentifizierten Benutzern) das Lesen:

```typescript
securityRules: [
    { operation: "select", access: "public" }
]
```

Dies generiert: `USING (true)`

### Authentifizierter Zugriff

Erlaubt den Zugriff für jeden angemeldeten Benutzer. Dies ist eine `condition` und kein `access`-Shortcut — `access` hat genau einen Wert, nämlich `"public"` —, da „angemeldet“ eine Prüfung des Aufrufers darstellt und der Builder der Ort ist, an dem Prüfungen gegen den Aufrufer stattfinden:

```typescript
import { policy } from "@rebasepro/types";

securityRules: [
    { operation: "select", condition: policy.authenticated() }
]
```

`policy.authenticated()` ist auch für anonyme *Anmeldungen* (`sign-in`) wahr, bei denen eine echte Benutzerzeile und eine echte Sitzung erzeugt werden. Verwenden Sie `policy.registered()`, wenn ein Gast sich nicht qualifizieren soll — etwa beim Verfassen einer Bewertung, beim Beitreten zu einer Organisation oder beim Ausgeben von Geld.

### Rollenbasierter Zugriff

Beschränken Sie Operationen auf bestimmte Rollen:

```typescript
securityRules: [
    { operation: "all", roles: ["admin"] },
    { operation: "select", roles: ["editor", "viewer"] }
]
```

### Mitgliedschaftsbasierter / Relationaler Zugriff

Um den Zugriff basierend auf der Mitgliedschaft in einer *verwandten* Collection einzugrenzen — z. B. „nur Zeilen, zu deren Team der Aufrufer gehört“ —, verwenden Sie die strukturierte `condition` mit `policy.existsIn`. Dies wird zu einer einzelnen korrelierten `EXISTS`-Unterabfrage kompiliert (keine Abfragen pro Zeile) und ist die sichere First-Class-Alternative zum manuellen Schreiben des unten gezeigten reinen SQLs.

```typescript
import { policy } from "@rebasepro/types";

// documents visible only to members of the document's team:
securityRules: [
    {
        operation: "select",
        condition: policy.existsIn({
            collection: "team_members",         // the join / membership collection
            where: policy.and(
                // correlate to the row being checked:
                policy.compare(policy.field("team_id"), "eq", policy.outerField("team_id")),
                // …and to the caller:
                policy.compare(policy.field("user_id"), "eq", policy.authUid()),
            ),
        }),
    },
]
```

Innerhalb von `where` bezieht sich `policy.field(...)` auf eine Spalte der verknüpften Collection (`team_members`), während sich `policy.outerField(...)` auf eine Spalte der zu prüfenden Zeile (`documents`) bezieht. Kombinieren Sie dies mit `policy.authUid()`, um die Abfrage auf den aktuellen Benutzer einzugrenzen. Da dies von der Datenbank erzwungen wird, betrachtet die Admin-UI dies als serverseitig maßgeblich.

#### Der `policy`-Builder im Detail

Wird aus `@rebasepro/types` importiert. Ausdrücke lassen sich zusammensetzen; Operanden bilden die Blätter.

| Ausdruck | Kompiliert zu |
|---|---|
| `policy.true()` / `policy.false()` | `true` / `false` |
| `policy.and(…)` / `policy.or(…)` | Konjunktion / Disjunktion |
| `policy.not(e)` | Negation |
| `policy.compare(left, op, right)` | Ein Vergleich zwischen zwei Operanden |
| `policy.rolesOverlap(roles)` | Der Aufrufer hat **mindestens eine** dieser App-Rollen |
| `policy.rolesContain(roles)` | Der Aufrufer hat **alle** dieser App-Rollen |
| `policy.authenticated()` | Angemeldet — `rebase.uid()` ist gesetzt **und ist kein anonymer Sentinel-Wert**. `IS NOT NULL` allein wäre eine Tautologie, da ein anonymer Request einen Sentinel-Wert setzt, anstatt ihn ungesetzt zu lassen |
| `policy.registered()` | **Mit einem Konto** angemeldet — `authenticated()` und kein Gast. Siehe unten |
| `policy.serverContext()` | `rebase.uid() IS NULL` — siehe den Warnhinweis unten |
| `policy.existsIn({ collection, where })` | Eine korrelierte `EXISTS`-Unterabfrage |
| `policy.raw(sql)` | Ein Escape-Hatch, wird unverändert eingefügt |

| Operand | Bedeutung |
|---|---|
| `policy.field(name)` | Eine Spalte der zu prüfenden Collection — oder, innerhalb von `existsIn`, der gejointen Collection |
| `policy.outerField(name)` | Innerhalb von `existsIn`, eine Spalte der äußeren Zeile |
| `policy.literal(value)` | Ein String, eine Zahl, ein Boolean oder `null` |
| `policy.authUid()` | `rebase.uid()` |
| `policy.authRoles()` | `rebase.roles()` |

### `authenticated()` und `registered()`

Zwei unterschiedliche Dinge werden als anonym bezeichnet, und es lohnt sich, genau zu unterscheiden, was eine Regel meint.

Ein **nicht authentifizierter** Request besitzt keinerlei Session. Ihm wird eine Sentinel-ID zugewiesen, sodass `rebase.uid()` auf dem Benutzerpfad niemals `NULL` ist, und `policy.authenticated()` schließt ihn aus — genau das sorgt dafür, dass es „angemeldet“ bedeutet und nicht „jeder“.

Ein **Gast** ist das andere: eine Session ohne eine reale Person dahinter. `POST /auth/anonymous` generiert eine echte Benutzerzeile mit einer echten UID, sodass ein Gast jeden Test besteht, der die ID prüft. Das ist der Sinn des Features — ein Warenkorb vor dem Checkout, ein Entwurf vor der Registrierung — und es bedeutet, dass `authenticated()` für jeden wahr ist, der auf *Als Gast fortfahren* geklickt hat, was weder E-Mail noch Passwort noch die Zustimmung zu irgendetwas erfordert.

`policy.registered()` ist `authenticated()` plus „kein Gast“. Verwenden Sie es überall dort, wo es in einer Regel um eine Person geht, die für etwas zur Verantwortung gezogen werden könnte: das Verfassen einer Bewertung, der Beitritt zu einer Organisation, das Ausgeben von Geld. Greifen Sie zu `authenticated()`, wenn Gäste ausdrücklich willkommen sind.

```ts
// Anyone with a session, guests included — a draft cart.
{ operation: "insert", check: policy.authenticated() }

// Someone with an account.
{ operation: "insert", check: policy.registered() }
```

Unter der Haube reist das Gast-Flag mit der Session mit — es befindet sich im Access Token und gelangt als `rebase.is_anonymous()` in die Datenbank —, sodass eine Richtlinie diese Frage ohne Lookup stellen kann. Eine Datenbank, die von einem Server bedient wird, der zu alt ist, um dies zu setzen, interpretiert jede Session als Konto; genau dieses Verhalten hatte das betreffende Deployment bereits zuvor.

:::caution[`serverContext()` wird durch das Server-Singleton nicht erfüllt]
Es kompiliert zu `rebase.uid() IS NULL`, und `rebase.dataAsAdmin` läuft als `uid: "service"` — es ist also **falsch** für den Zugriffspunkt, den die meisten Leute mit „dem Server“ meinen. Eine Collection mit `disableDefaultPolicies: true`, deren einzige Regel `serverContext()` ist, verweigert diese Schreibzugriffe (`42501`) und gibt null Zeilen zurück — HTTP 200, leer — für diese Lesezugriffe. `rebase.sql()` ist der Zugriffspunkt, der Richtlinien tatsächlich umgeht.
:::

## Reine SQL-Ausdrücke

Für komplexe Logik verwenden Sie `using` und `withCheck`:

```typescript
securityRules: [
    {
        operation: "select",
        using: "EXISTS (SELECT 1 FROM org_members WHERE org_members.org_id = {org_id} AND org_members.user_id = rebase.uid())"
    }
]
```

- **`using`** — Filtert, welche bestehenden Zeilen sichtbar sind (gilt für SELECT, UPDATE, DELETE)
- **`withCheck`** — Validiert neue Zeilenwerte (gilt für INSERT, UPDATE)

Spaltenreferenzen verwenden die Syntax `{column_name}`, die zur vollständig tabellenqualifizierten Spalte aufgelöst wird.

## Shortcuts und SQL kombinieren

Kombinieren Sie praktische Shortcuts mit reinem SQL:

```typescript
securityRules: [
    // Admins can do anything
    { operation: "all", roles: ["admin"], using: "true" },
    // Regular users can only see their own rows
    { operation: "select", ownerField: "user_id" },
    // Users can insert, but only for themselves
    { operation: "insert", withCheck: "{user_id} = rebase.uid()" },
    // Locked rows cannot be updated
    { operation: "update", mode: "restrictive", using: "{is_locked} = false" }
]
```

## Permissiv vs. Restriktiv

PostgreSQL bietet zwei Richtlinien-Modi:

- **Permissive** (Standard) — Mehrere permissive Richtlinien werden mit **ODER (OR)** verknüpft. Wenn eine davon zutrifft, wird der Zugriff gewährt.
- **Restrictive** — Restriktive Richtlinien werden mit **UND (AND)** verknüpft. Alle müssen zutreffen.

```typescript
securityRules: [
    // Permissive: owners can access their rows
    { operation: "all", ownerField: "user_id" },
    // Restrictive: but locked rows cannot be updated
    { operation: "update", mode: "restrictive", using: "{is_locked} = false", withCheck: "{is_locked} = false" }
]
```

## Operationen

| Operation | SQL-Äquivalent | Beschreibung |
|-----------|----------------|--------------|
| `"select"` | `SELECT` | Zeilen lesen |
| `"insert"` | `INSERT` | Neue Zeilen erstellen |
| `"update"` | `UPDATE` | Bestehende Zeilen ändern |
| `"delete"` | `DELETE` | Zeilen entfernen |
| `"all"` | Alle oben genannten | Kurzform für alle Operationen |

Sie können auch `operations` (Plural) verwenden, um eine Regel auf mehrere Operationen anzuwenden:

```typescript
{ operations: ["insert", "update", "delete"], ownerField: "authorId" }
```

## Vollständiges SecurityRule-Interface

`SecurityRule` ist eine **Union**, kein einzelnes offenes Objekt: Eine Regel wählt genau eine Möglichkeit, ihr Prädikat auszudrücken; die anderen sind mit `never` typisiert, sodass ihre Vermischung ein Compilerfehler ist, anstatt einer Richtlinie, die die Hälfte dessen, was Sie geschrieben haben, stillschweigend ignoriert.

```typescript no-verify
// Shared by every variant
interface SecurityRuleBase {
    name?: string;                        // Policy name. Omit it and one is derived
    operation?: SecurityOperation;        // "select" | "insert" | "update" | "delete" | "all"
    operations?: SecurityOperation[];     // …or several at once
    mode?: "permissive" | "restrictive";  // Default: "permissive"
    roles?: string[];                     // App roles, via rebase.roles()
    pgRoles?: string[];                   // Native Postgres roles — the CREATE POLICY `TO` clause.
                                          // NOT the same as `roles`. Default: ["public"]
}

// …plus exactly one of:
{ ownerField: string }                        // <column> = rebase.uid()
{ access: "public" }                          // the one shortcut — "no row filter"
{ condition: PolicyExpression;                // the structured builder — `policy.*`
  check?: PolicyExpression }                  // defaults to `condition`, as Postgres does
{ using?: string; withCheck?: string }        // raw SQL
```

`roles` und `pgRoles` werden häufig verwechselt. `roles` ist eine Anwendungsrolle, die *innerhalb* der `USING`- / `WITH CHECK`-Klausel über `rebase.roles()` erzwungen wird. `pgRoles` ist eine Datenbankrolle und steuert, an welche Verbindungen die Richtlinie überhaupt angehängt wird. Fast jedes Projekt benötigt `roles`.

:::tip[Befüllen der Spalte, die `ownerField` benennt]
`ownerField` vergleicht eine Spalte mit `rebase.uid()`; es trägt dort nichts ein. Deklarieren Sie diese Spalte als String mit [`autoValue: "user_on_create"`](/docs/collections/properties#audit-columns), und der Treiber stempelt beim Einfügen die UID des agierenden Benutzers ein, wodurch alles überschrieben wird, was der Request-Body gesendet hat — was die Prämisse der Richtlinie wahr macht. Eine Spalte, die der Aufrufer bereitstellt, ist eine Spalte, bei der der Aufrufer lügen kann.
:::

## Beispiele

### Blog-Plattform

```typescript
securityRules: [
    // Anyone can read published posts
    { operation: "select", using: "{status} = 'published'" },
    // Authors can see their own drafts
    { operation: "select", ownerField: "authorId" },
    // Authors can create and edit their own posts
    { operations: ["insert", "update"], ownerField: "authorId" },
    // Only admins can delete
    { operation: "delete", roles: ["admin"] }
]
```

### Mandantenfähiges SaaS

```typescript
securityRules: [
    {
        operation: "all",
        using: "EXISTS (SELECT 1 FROM org_members WHERE org_members.org_id = {org_id} AND org_members.user_id = rebase.uid())"
    }
]
```

## Anonymer Zugriff (Öffentliche Inserts)

Eine häufige Anforderung besteht darin, **nicht authentifizierten Benutzern** das Übermitteln von Daten zu erlauben — Kontaktformulare, Newsletter-Anmeldungen, öffentliche Bewerbungen. Rebase bietet hierfür ein sauberes Muster.

### Empfohlen: Eine reine `withCheck`-Regel

```typescript
import { defineCollection } from "@rebasepro/cms-types";

const contactMessagesCollection = defineCollection({
    slug: "contact_messages",
    name: "Contact Messages",
    table: "contact_messages",
    securityRules: [
        // Anyone can submit a contact message
        {
            operation: "insert",
            // A raw rule carries `using` (which rows are visible) and `withCheck`
            // (what a write must satisfy); an insert only exercises the latter.
            using: "true",
            withCheck: "true"
        },
        // Only admins can read, update, or delete messages
        { operations: ["select", "update", "delete"], roles: ["admin"] }
    ],
    properties: {
        email: { name: "Email", type: "string" }
    }
});
```

Der `access: "public"`-Shortcut generiert eine Richtlinie, die die Operation ohne erforderliche Authentifizierung erlaubt.

### Für Lead-Erfassung / Registrierungen

```typescript
import { defineCollection } from "@rebasepro/cms-types";

const leadSignupsCollection = defineCollection({
    slug: "lead_magnet_signups",
    name: "Lead Magnet Signups",
    table: "lead_magnet_signups",
    securityRules: [
        // Allow anonymous inserts
        { operation: "insert", using: "true", withCheck: "true" },
        // Admins can view all signups
        { operation: "select", roles: ["admin"] }
    ],
    properties: {
        email: { name: "Email", type: "string" }
    }
});
```

### Wie anonyme Anfragen funktionieren

Wenn eine Anfrage ohne JWT-Token eintrifft, setzt das Rebase-Backend die PostgreSQL-Sitzungsvariablen auf:

| Variable | Wert |
|----------|------|
| `app.user_id` | `'anonymous'` |
| `app.user_roles` | `''` (leer) |

Das bedeutet:

- `rebase.uid()` gibt `'anonymous'` zurück
- `rebase.roles()` gibt einen leeren String zurück
- `access: "public"`-Richtlinien sind erfolgreich, da sie `USING (true)` / `WITH CHECK (true)` erzeugen
- `policy.authenticated()`-Bedingungen schlagen fehl, da sie nach einer echten Benutzer-ID prüfen
- `ownerField`-Richtlinien schlagen fehl, da keine Zeile `user_id = 'anonymous'` haben wird (sofern nicht explizit festgelegt)

### Erweitert: Reines SQL für anonyme Zugriffe

Wenn Sie eine granularere Kontrolle benötigen, verwenden Sie reines SQL:

```typescript
securityRules: [
    {
        operation: "insert",
        withCheck: "rebase.uid() = 'anonymous' OR rebase.uid() IS NOT NULL"
    }
]
```

:::tip
Vermeiden Sie das veraltete Muster, `string_to_array(rebase.roles(), ',')` für den anonymen Zugriff zu prüfen. Der `access: "public"`-Shortcut ist einfacher und generiert automatisch die korrekte Richtlinie.
:::

## Zeilen hier, Felder nebenan

Sicherheitsregeln beantworten eine Frage: **Welche Zeilen** erreicht dieser Aufrufer. Sie werden von Postgres selbst bei jeder Anweisung durchgesetzt, unabhängig von der Route — weshalb sie das Autorisierungsmodell darstellen und alles darüber reine Bequemlichkeit ist.

Sie sagen nichts über die *Spalten* einer Zeile aus, die ein Aufrufer tatsächlich erreicht. Eine Richtlinie, die es einem Mitarbeiter erlaubt, die Zeilen seines Teams zu lesen, erlaubt es ihm, jedes Feld dieser Zeilen zu lesen, einschließlich des Gehalts. Genau dafür gibt es das Eigenschafts-basierte [`access`](/docs/collections/field-access/):

```typescript
salary: {
    type: "number",
    // Everyone the rules above let read the row; only HR gets this column.
    access: { read: ["hr"], write: [] }
}
```

Beide ergänzen sich und widersprechen sich nie: Eine Feldregel kann den Zeilenzugriff nicht erweitern, und eine Zeile, die Sie nicht lesen können, besitzt keine Felder, über die man sprechen könnte. Rollen sind dieselben Rollen — `rebase.roles()` innerhalb einer Richtlinie, `user.roles` im Request —, sodass `rolesOverlap(['hr'])` in einer Regel und `access: { read: ["hr"] }` auf einer Eigenschaft dasselbe `hr` bedeuten. Feldregeln werden vom Server und nicht von Postgres angewendet, sodass sie die API-Oberfläche abdecken; eine Abfrage, die über `rebase.sql()` ausgeführt wird, sieht jede Spalte, genau so, wie sie RLS umgeht.

## Nächste Schritte

- **[Feldzugriff](/docs/collections/field-access)** — Lese-/Schreibrollen pro Feld
- **[Relationen](/docs/collections/relations)** — Fremdschlüssel und Joins
- **[Entity-Callbacks](/docs/collections/callbacks)** — Lifecycle-Hooks
- **[Custom Functions](/docs/backend/custom-functions)** — Benutzerdefinierte API-Endpunkte
