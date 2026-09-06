---
sourceHash: 3e7cee199ce0ba69
slug: fr/docs/rls-check
title: rls-check
description: Auditez la sécurité au niveau des lignes (RLS) sur n'importe quelle base de données PostgreSQL — Supabase, Neon, RDS ou votre propre serveur. En lecture seule, sans inscription, sans Rebase requis.
---

# rls-check

`rls-check` lit le catalogue d'une base de données PostgreSQL et signale ce qui est réellement exposé :
tables servies sans sécurité au niveau des lignes (RLS), politiques évaluées à `true` pour
tout le monde, vues qui lisent directement au-delà de la RLS de leurs tables de base, et tables
de jonction oubliées alors que leurs deux extrémités étaient verrouillées.

Il fonctionne sur **n'importe quel** Postgres — Supabase, Neon, RDS, Cloud SQL, ou un serveur
que vous gérez vous-même. Il ne nécessite pas Rebase et s'avère utile que vous l'adoptiez ou non.

```bash
npx @rebasepro/rls-check
```

Lance-le dans le répertoire de ton projet et il trouvera la base de données tout seul : `DATABASE_URL`,
puis `POSTGRES_URL`, puis un `.env` à côté. Ne passe la chaîne de connexion en argument que si tu ne
peux pas faire autrement — npm affiche la ligne de commande avant que le programme ne démarre, et ton
shell l'enregistre, donc un mot de passe passé en argument se retrouve à deux endroits que `rls-check`
ne peut pas masquer. `$DATABASE_URL` n'y est pas plus sûr : le shell le développe avant même que npm
ne le voie.

Il est conçu en lecture seule par construction : il ouvre une transaction en lecture seule
et exécute des requêtes sur le catalogue. Il n'écrit rien et n'envoie rien nulle part — il
n'y a aucune télémétrie ni aucun appel réseau autre que celui vers votre base de données.

## Utilisation

```bash
# From the environment — DATABASE_URL, then POSTGRES_URL, then a .env in the cwd
npx @rebasepro/rls-check

# For a database that is not the one in your environment
DATABASE_URL="postgres://user:pass@host:5432/dbname" npx @rebasepro/rls-check

# As an argument. Works, but see the warning above about where the password lands
npx @rebasepro/rls-check "postgres://user:pass@host:5432/dbname"
```

Si votre mot de passe contient `@`, `:`, `/`, `?` ou `#`, encodez-le en pourcentage (percent-encoding).
C'est de loin la cause la plus fréquente d'échec d'authentification ici, et `rls-check` vous
l'indiquera plutôt que de vous laisser deviner.

### Options

| Option | Signification |
| --- | --- |
| `--json` | Sortie lisible par une machine sur stdout, et rien d'autre sur stdout |
| `--html <chemin>` | Écrit également un rapport HTML autonome à cet endroit. Un seul fichier, aucune requête réseau |
| `--schema <name>` | Restreindre le scan à un schéma. Répétable ou séparé par des virgules |
| `--role <name>` | Traiter ce rôle comme un rôle sous lequel un appelant non fiable arrive, en plus de `anon`, `authenticated`, `web_anon` et `rebase_user`. Répétable ou séparé par des virgules |
| `--fail-on <severity>` | Quitter avec le code 1 à partir de cette sévérité. Par défaut `high` ; `none` n'échoue jamais |
| `--only <id>` | Exécuter uniquement ces vérifications. Répétable ou séparé par des virgules |
| `--skip <id>` | Ignorer ces vérifications. Répétable ou séparé par des virgules |
| `--list-checks` | Afficher le catalogue et quitter |
| `--timeout <ms>` | Délai d'expiration de la requête (statement timeout), par défaut 15000 |
| `--quiet` | Résultats uniquement — pas de bannière, pas de résumé |
| `--no-color` | Désactiver les couleurs ANSI (respecte également `NO_COLOR` et un stdout non-TTY) |

Un identifiant inconnu transmis à `--only` ou `--skip` génère une erreur plutôt qu'une
ignorance silencieuse, car une faute de frappe affaiblirait discrètement le scan. Un `--role`
absent de `pg_roles` est une erreur pour la même raison : chaque vérification s'appuie sur un
privilège accordé à un rôle exposé, donc un nom qui ne correspond à rien retire de la couverture
sans le dire.

L'en-tête du rapport nomme les rôles que l'exécution a traités comme exposés, pour que vous voyiez
d'un coup d'œil si `No findings` couvrait le rôle avec lequel votre application se connecte :

```
Exposed   PUBLIC, anon, authenticated (add yours with --role)
```

Lorsque le scan se connecte avec un rôle que la sécurité au niveau des lignes *peut* réellement
contraindre — ni superutilisateur, ni propriétaire, sans `BYPASSRLS` — ce rôle est ajouté à
l'ensemble et le rapport le signale. Scanner avec le rôle de votre propre application est ce qui
se rapproche le plus de demander à la base de données ce que votre API voit.

### Codes de sortie

| Code | Signification |
| --- | --- |
| `0` | Aucun résultat égal ou supérieur au seuil `--fail-on` |
| `1` | Au moins un résultat égal ou supérieur au seuil |
| `2` | Le scan n'a pas pu s'exécuter — mauvais arguments, connexion refusée, échec d'authentification, délai dépassé |

`1` et `2` sont délibérément distincts : une connexion interrompue ne doit jamais ressembler à une base de données saine.

### En CI

```yaml
- name: Audit RLS
  run: npx @rebasepro/rls-check --fail-on high
  env:
    DATABASE_URL: ${{ secrets.DATABASE_URL }}
```

### Sortie JSON

`--json` émet un objet stable : `scannedAt`, `database` (hôte et nom uniquement — jamais
les identifiants), `serverVersion`, `platform`, `scannerIsPrivileged`, `exposedRoles`, `stats`,
`findings` et `diagnostics`. Chaque résultat contient `id`, `severity`, `title`, `target`,
`detail`, `impact`, `fix`, `docs` et `confidence`.

`exposedRoles` et `diagnostics` font partie du contrat, ce ne sont pas des extras : chaque
vérification s'appuie sur l'ensemble des rôles exposés, et `diagnostics.degraded` est ce qui
permet de distinguer « rien n'allait mal » de « le scan n'a pas pu regarder ».

## Comment lire le rapport

**Les résultats confirmés apparaissent en premier ; les résultats heuristiques se trouvent dans une section séparée « worth checking » (à vérifier).** Une vérification heuristique ne peut pas deviner l'intention — une table de jonction que vous avez délibérément laissée ouverte n'est pas un bug — ces éléments sont donc formulés sous forme de questions et ne sont jamais mélangés avec les certitudes.

**Faites attention à la note sur les privilèges.** Si le scan se connecte en tant que superutilisateur, propriétaire de table, ou avec un rôle possédant `BYPASSRLS`, cela sera indiqué. Ce rôle voit le catalogue réel, ce qui rend l'audit possible, mais cela signifie aussi que rien dans le rapport ne décrit ce que *cette* connexion expérimente. Les résultats concernent ce que les autres rôles obtiennent.

## Les vérifications

Les sévérités ci-dessous sont les valeurs par défaut ; plusieurs vérifications ajustent leur propre sévérité en fonction de ce qu'elles trouvent, et le rapport en indique toujours la raison.

### rls-disabled

**Table exposée sans sécurité au niveau des lignes.** Critique.

La table a la RLS désactivée *et* accorde `SELECT`/`INSERT`/`UPDATE`/`DELETE` à un rôle qu'un
appelant non autorisé peut atteindre (`anon`, `PUBLIC`, `web_anon`, `rebase_user`). Postgres
n'applique aucun filtre par ligne, donc les politiques — s'il en existe — ne sont jamais consultées.

Une table dont la RLS est désactivée mais sans privilège accordé à un rôle exposé n'est *pas*
signalée. Elle n'est pas accessible, et la signaler constituerait un bruit inutile.

```sql
ALTER TABLE "public"."your_table" ENABLE ROW LEVEL SECURITY;
```

Activer la RLS sans politique refuse l'accès à toutes les lignes pour tout le monde sauf le
propriétaire, ajoutez donc la politique souhaitée dans la même migration — sinon vous aurez
échangé une exposition contre une panne silencieuse. Voir [rls-enabled-no-policies](#rls-enabled-no-policies).

### policy-always-true

**La politique accorde un accès inconditionnel.** Critique.

Une politique permissive dont l'expression `USING` ou `WITH CHECK` est une vérité constante — `true`,
`(true)`, `1 = 1`. Les politiques permissives sont combinées avec l'opérateur OU (OR), donc une seule
d'entre elles satisfait le filtre de ligne de la table, peu importe la rigueur de toutes les autres politiques.

Si une politique `RESTRICTIVE` couvre la même commande, la sévérité est rétrogradée à moyenne et
signalée comme un point à vérifier plutôt qu'une certitude, car les politiques restrictives s'appliquent avec
l'opérateur ET (AND) après les permissives en OU (OR).

```sql
ALTER POLICY "your_policy" ON "public"."your_table"
    USING (user_id = rebase.uid());
```

### policy-anonymous-tautology

**La politique vérifie uniquement l'existence d'un identifiant d'appelant.** La sévérité dépend de la plateforme.

L'expression est de la forme `rebase.uid() IS NOT NULL` (ou `auth.uid()` sur Supabase, et sur une
base de données Rebase provisionnée avant la version 1.0) : elle sépare les appelants connectés des
appelants déconnectés, mais ne restreint aucune ligne. Chaque utilisateur connecté accède à toutes les
lignes couvertes par la politique.

La sévérité dépend de la plateforme, et cette distinction est importante :

- **Sur Supabase**, `auth.uid()` renvoie `NULL` pour les appelants anonymes, c'est donc une vérification
  valide réservée aux utilisateurs authentifiés. Signalé comme **faible** (low) — un écart de restriction de
  données entre utilisateurs connectés, pas une faille d'accès anonyme.
- **Sur Rebase ou PostgREST**, où un identifiant d'appelant vide est converti en valeur sentinelle `'anonymous'`,
  l'expression est *vraie aussi pour les appelants non connectés*. Signalé comme **critique**.
- **Sur une plateforme non reconnue**, signalé comme **moyen** (medium), car le fait qu'il s'agisse d'une faille
  dépend de l'utilisation ou non d'une telle sentinelle par votre infrastructure.

```sql
-- Scope to the row's owner rather than to the existence of an id
ALTER POLICY "your_policy" ON "public"."your_table"
    USING (user_id = rebase.uid());

-- Or, if "any signed-in user" really is the intent, reject the sentinel explicitly
--     USING (rebase.uid() IS NOT NULL AND rebase.uid() <> 'anonymous');
```

Le code SQL suggéré est affiché avec la fonction d'identifiant d'appelant que possède réellement votre base de données :
`rebase.uid()` sur une base de données Rebase, `auth.uid()` sur Supabase et PostgREST. Les deux orthographes
sont reconnues lors de la lecture des politiques, ainsi une base de données Rebase en cours de migration depuis
le schéma `auth` antérieur à la version 1.0 reste contrôlée.

### view-bypasses-rls

**La vue lit au-delà de la RLS de sa table de base.** Critique.

Une vue accordée à un rôle non autorisé qui fait un SELECT sur une table protégée par RLS sans
`security_invoker = true`. La vue s'exécute avec les privilèges de son **propriétaire**, elle lit donc la
table de base en tant que propriétaire et les politiques de l'appelant ne s'appliquent jamais. C'est le
moyen le plus courant par lequel une table soigneusement verrouillée fuit.

```sql
ALTER VIEW "public"."your_view" SET (security_invoker = true);
```

Sur PostgreSQL antérieur à la version 15, cette option n'existe pas du tout, donc chaque vue de ce type
se comporte ainsi. Dans ce cas, le résultat est signalé comme heuristique, et la solution consiste à déplacer la
logique dans une fonction ou à mettre à jour PostgreSQL.

### matview-bypasses-rls

**La vue matérialisée expose des données protégées par RLS.** Élevé.

Les vues matérialisées ne peuvent pas avoir de sécurité au niveau des lignes, et les données qu'elles
contiennent sont un instantané stocké créé par la personne qui l'a rafraîchi. Si l'une d'elles est accordée
à un rôle non autorisé et que sa requête de définition lit une table protégée par RLS, aucune politique
ne peut aider — révoquez l'accès ou déplacez la vue matérialisée dans un schéma inaccessible aux rôles
non autorisés.

```sql
REVOKE ALL ON "public"."your_matview" FROM "anon";
```

### anonymous-write-allowed

**Les appelants non authentifiés peuvent écrire.** Élevé.

Une politique permissive `INSERT`/`UPDATE`/`DELETE`/`ALL` accessible sans authentification dont l'expression de contrôle accepte n'importe quelle ligne, appuyée par un privilège correspondant.

La condition « accepte n'importe quelle ligne » est essentielle et délibérément stricte. Supabase accorde par
défaut les privilèges DML complets à `anon` et `authenticated`, donc une politique ciblant ces rôles n'est pas
un problème en soi — un exemple typique comme `FOR INSERT TO public WITH CHECK (userId = auth.uid())` est
correct et n'est pas signalé.

### unqualified-column-in-subquery

**Colonne non qualifiée à l'intérieur d'une sous-requête de politique.** Élevé, heuristique.

Un nom de colonne simple à l'intérieur d'une sous-requête `EXISTS`/`IN` qui existe sur la relation interne *et*
sur la table de la politique. Postgres le lie à la table **interne**, ainsi la corrélation avec la ligne externe
que vous souhaitiez écrire disparaît silencieusement et le prédicat devient trivialement satisfaisable — ou
trivialement insatisfaisable, refusant toutes les lignes à tout le monde.

```sql
-- The bug: `id` binds to memberships, not organizations
USING (EXISTS (SELECT 1 FROM memberships WHERE id = organizations.id ...))

-- Qualify it
USING (EXISTS (SELECT 1 FROM memberships m WHERE m.org_id = organizations.id ...))
```

**L'absence de ce résultat n'est pas une preuve de sécurité.** `pg_policies.qual` est le rendu propre à Postgres de
l'arbre d'analyse (parse tree), et il requalifie généralement les références de colonnes — ainsi, le nom simple
d'origine n'est fréquemment plus visible au moment où le catalogue est lu. Lorsque cette vérification se
déclenche, c'est une preuve solide ; lorsqu'elle ne se déclenche pas, cela ne prouve rien.

### junction-table-unprotected

**Table de jonction plusieurs-à-plusieurs sans RLS.** Élevé, heuristique.

Une table qui se résume essentiellement aux deux extrémités de deux clés étrangères, pointant toutes deux
vers des tables qui possèdent *effectivement* la RLS, sans sécurité au niveau des lignes qui lui soit propre. Les
deux côtés de la relation sont verrouillés et la liaison entre eux est ouverte — ce qui suffit pour énumérer la
relation même si aucune des deux extrémités ne peut être lue.

Heuristique car une table de jonction est déduite de sa structure. Si la vôtre est délibérément publique,
utilisez `--skip junction-table-unprotected`.

### rls-enabled-not-forced

**RLS activée mais non forcée pour le propriétaire de la table.** Moyen, ou élevé.

Sans `FORCE`, le propriétaire de la table est exempté de ses propres politiques. C'est inoffensif lorsque le
propriétaire est un rôle de provisionnement auquel rien ne se connecte, mais grave lorsque votre application se
connecte en tant que propriétaire — ce résultat est donc **élevé** (high) lorsque le rôle propriétaire peut se
connecter, et **moyen** (medium) sinon.

Si le propriétaire est un superutilisateur ou possède `BYPASSRLS`, cela reste moyen et le précise : `FORCE` ne
peut pas contraindre un tel rôle, et prétendre le contraire serait trompeur.

```sql
ALTER TABLE "public"."your_table" FORCE ROW LEVEL SECURITY;
```

### rls-enabled-no-policies

**RLS activée sans aucune politique.** Moyen.

Ce n'est pas une faille de sécurité — c'est le contraire. La RLS activée sans aucune politique refuse toutes les
lignes à tout le monde sauf au propriétaire. C me signalé car il s'agit d'une défaillance *invisible* : l'API renvoie
`[]`, et une table vide ne se distingue pas d'une table filtrée. Cette configuration a déjà servi silencieusement des
collections vides en production pendant des semaines entières.

### policy-role-unreachable

**Les politiques ciblent des rôles avec lesquels rien ne se connecte.** Moyen.

Chaque politique de la table nomme des rôles qui n'existent pas, ne peuvent pas se connecter et qu'aucun
rôle de connexion n'hérite de manière transitive. Les politiques semblent correctes et ne s'appliquent à personne,
la table apparaît donc comme vide.

Le cas classique concerne les politiques écrites avec `TO authenticated` — un nom de rôle Supabase — sur une base
de données dont les requêtes arrivent en réalité sous un autre rôle.

### grant-to-public

**Privilèges de table accordés à PUBLIC.** Moyen.

Un privilège DML accordé à `PUBLIC`. Même avec la RLS activée, cela élargit les utilisateurs pour lesquels les
politiques sont évaluées, et ce n'est presque jamais délibéré.

```sql
REVOKE ALL ON "public"."your_table" FROM PUBLIC;
```

### security-definer-mutable-search-path

**Routine SECURITY DEFINER avec un search_path mutable.** Moyen.

La routine s'exécute en tant que son propriétaire — souvent un superutilisateur — tandis que l'appelant contrôle
la manière dont ses identifiants sont résolus. C'est la structure classique d'élévation de privilèges, et tout ce
à quoi la routine touche est lu avec les droits du propriétaire, en contournant la RLS.

```sql
ALTER FUNCTION "public"."your_function"() SET search_path = pg_catalog, public;
```

### current-setting-throws

**La politique appelle `current_setting()` sans `missing_ok`.** Faible, heuristique.

`current_setting('app.tenant_id')` avec un seul argument *lève une erreur* lorsque le paramètre n'est pas défini,
au lieu de renvoyer `NULL`. Ainsi, au lieu de refuser la ligne, la requête échoue — l'appelant voit une erreur 500
plutôt qu'un résultat vide, et un middleware qui réessaie les erreurs 5xx réessaiera une requête qui ne pourra jamais
réussir.

```sql
ALTER POLICY "your_policy" ON "public"."your_table"
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
```

## Ce que cet outil ne fait pas

Être clair sur les limites est essentiel — un outil de sécurité qui exagère sa couverture est pire qu'aucun outil.

- **C'est un audit statique du catalogue.** Il lit `pg_class`, `pg_policies`, `pg_depend` et autres tables système. Il
  ne se connecte pas avec votre rôle `anon` pour tenter de lire vos données, il ne peut donc pas confirmer qu'une
  exposition est accessible via votre API.
- **Il ne peut pas prouver qu'une politique est correcte.** Il identifie des structures connues pour être erronées. Une
  politique qui réussit toutes les vérifications ici peut tout de même exprimer une mauvaise règle métier.
- **Un rapport sans avertissement n'est pas une certification de sécurité.** En particulier, consultez la note sur
  [unqualified-column-in-subquery](#unqualified-column-in-subquery) : Postgres réécrit les expressions de politique,
  de sorte que certains bugs ne sont plus du tout visibles dans le catalogue.
- **Il ne vérifie pas l'autorisation au niveau de l'application**, les clés d'API, l'exposition réseau, la gestion des
  secrets, ni quoi que ce soit d'autre en dehors de la base de données.

## En lien

- [Security Rules (RLS)](/docs/collections/security-rules) — définir la sécurité au niveau des lignes dans les collections
  Rebase, qui est compilée dans les politiques que cet outil audite.

---
