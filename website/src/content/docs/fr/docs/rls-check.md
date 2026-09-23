---
sourceHash: 3165c5299e4bc1f3
slug: fr/docs/rls-check
title: rls-check
description: Auditez la sécurité au niveau des lignes (RLS) sur n'importe quelle base de données PostgreSQL — Supabase, Neon, RDS ou votre propre serveur. En lecture seule, sans inscription, sans Rebase requis.
---

# rls-check

`rls-check` lit le catalogue d'une base de données PostgreSQL et signale ce qui est réellement exposé :
des tables servies avec la sécurité au niveau des lignes (RLS) désactivée, des stratégies qui s'évaluent
à vrai pour tout le monde, des vues qui contournent directement le RLS de leurs tables sous-jacentes,
et des tables de jointure oubliées alors que leurs deux extrémités sont verrouillées.

Il fonctionne sur **n'importe quel** Postgres — Supabase, Neon, RDS, Cloud SQL ou un serveur
que vous gérez vous-même. Il ne nécessite pas Rebase et reste utile, que vous l'adoptiez un jour ou non.

```bash
npx @rebasepro/rls-check
```

Lancez-le dans le répertoire de votre projet et il trouvera la base de données de lui-même : `DATABASE_URL`,
puis `POSTGRES_URL`, puis un fichier `.env` à proximité. Ne passez la chaîne de connexion en argument
que si vous ne pouvez pas faire autrement — npm affiche la ligne de commande avant le démarrage du programme,
et votre shell l'enregistre, de sorte qu'un mot de passe passé en argument se retrouve à deux endroits que
`rls-check` ne peut pas masquer. `$DATABASE_URL` n'est pas plus sûr à cet endroit : le shell la développe
avant même que npm ne la voie.

Il est en lecture seule par conception : il ouvre une transaction en lecture seule et exécute des requêtes
sur le catalogue. Il n'écrit rien et n'envoie rien nulle part — il n'y a aucune télémétrie ni aucun appel réseau
autre que celui vers votre base de données.

## Exécution

```bash
# From the environment — DATABASE_URL, then POSTGRES_URL, then a .env in the cwd
npx @rebasepro/rls-check

# For a database that is not the one in your environment
DATABASE_URL="postgres://user:pass@host:5432/dbname" npx @rebasepro/rls-check

# As an argument. Works, but see the warning above about where the password lands
npx @rebasepro/rls-check "postgres://user:pass@host:5432/dbname"
```

Si votre mot de passe contient `/`, `?` ou `#`, encodez-le en pourcentage (percent-encoding). Ces trois caractères
marquent la fin de la section d'autorité de l'URL, ce qui coupe l'identifiant — plutôt que d'afficher des fragments
de mot de passe, `rls-check` refuse la chaîne et le signale.

`@` et `:` ne nécessitent aucun encodage : les informations d'authentification sont découpées au **dernier** `@`
et l'utilisateur au **premier** `:`, ce que fait également `pg`, de sorte que `postgres://user:pa@ss@host:5432/db`
se connecte à `host` avec le mot de passe `pa@ss`. Les encoder malgré tout n'est jamais une erreur.

### Options

| Option | Signification |
| --- | --- |
| `--json` | Sortie lisible par une machine sur stdout, et rien d'autre sur stdout |
| `--html <path>` | Écrit également un rapport HTML autonome à cet emplacement. Un seul fichier, aucune requête réseau |
| `--schema <name>` | Restreint l'analyse à un schéma. Répétable, ou séparé par des virgules |
| `--role <name>` | Traite ce rôle comme un rôle avec lequel un appelant non approuvé arrive, en plus de `anon`, `authenticated`, `web_anon` et `rebase_user`. Répétable, ou séparé par des virgules |
| `--fail-on <severity>` | Quitte avec le code 1 à ce niveau de gravité ou supérieur. Par défaut `high` ; `none` n'échoue jamais |
| `--only <id>` | Exécute uniquement ces vérifications. Répétable, ou séparé par des virgules |
| `--skip <id>` | Ignore ces vérifications. Répétable, ou séparé par des virgules |
| `--list-checks` | Affiche le catalogue et quitte |
| `--timeout <ms>` | Délai d'expiration de l'instruction (statement timeout), 15000 par défaut |
| `--quiet` | Constats uniquement — pas de bannière, pas de résumé |
| `--no-color` | Désactive les couleurs ANSI (respecte également `NO_COLOR` et un stdout qui n'est pas un TTY) |

Un identifiant inconnu passé à `--only` ou `--skip` génère une erreur plutôt qu'une opération sans
effet silencieuse, car une faute de frappe affaiblirait discrètement l'analyse. Un `--role` qui ne
figure pas dans `pg_roles` est une erreur pour la même raison : chaque vérification s'appuie sur un
privilège (grant) accordé à un rôle exposé, donc un nom qui ne correspond à rien réduirait la
couverture sans avertir. Il en va de même d'un `--schema` qui ne désigne aucun schéma, qui sinon
n'analyserait rien et le signalerait comme sain. Les noms de schéma sont sensibles à la casse :
`Public` n'est pas `public`.

L'en-tête du rapport liste les rôles que l'exécution a considérés comme exposés, afin que vous puissiez voir d'un coup
d'œil si `No findings` couvrait bien le rôle avec lequel votre application se connecte :

```
Exposed   PUBLIC, anon, authenticated (add yours with --role)
```

Lorsque l'analyse se connecte avec un rôle que la sécurité au niveau des lignes *peut* contraindre — pas un superutilisateur,
pas un propriétaire, sans `BYPASSRLS` — ce rôle est ajouté à l'ensemble et le rapport le précise. Effectuer l'analyse
avec le propre rôle de votre application est ce qui se rapproche le plus de demander à la base de données ce que voit votre API.

### Codes de sortie

| Code | Signification |
| --- | --- |
| `0` | Aucun constat atteignant ou dépassant le seuil de `--fail-on` |
| `1` | Au moins un constat atteignant ou dépassant le seuil |
| `2` | L'analyse n'a pas pu s'exécuter — arguments invalides, connexion refusée, échec d'authentification, délai dépassé |

`1` et `2` sont délibérément distincts : une connexion défaillante ne doit jamais donner l'illusion d'une base de données saine.

### Dans l'intégration continue (CI)

```yaml
- name: Audit RLS
  run: npx @rebasepro/rls-check --fail-on high
  env:
    DATABASE_URL: ${{ secrets.DATABASE_URL }}
```

**Un nouveau projet Rebase ne passe pas ce test dès le premier jour, et ce n'est pas son but.** Les
`defaultSecurityRules` du scaffold ouvrent les lectures à tout le monde — `{ operation: "select", access:
"public" }` dans `config/collections/index.ts` — donc `posts`, `authors` et `tags` signalent chacun une alerte
critique `policy-always-true`. `access: "public"` concerne les *lignes*, pas l'autorisation d'appeler l'API :
une requête sans jeton reçoit toujours une réponse 401 tant que `AUTH_REQUIRE` est actif. Le constat reste
néanmoins correct, car c'est la seule protection devant les données.

Déterminez dans lequel de ces deux cas vous vous trouvez avant d'intégrer cela à votre CI :

- **les règles sont un espace réservé temporaire** — remplacez-les par celles dont vos données ont réellement
  besoin ([règles de sécurité](/docs/collections/security-rules)), et les constats disparaîtront ;
- **les lignes sont réellement lisibles par tout le monde** — indiquez-le une bonne fois pour toutes avec
  `npx @rebasepro/rls-check --fail-on high --skip policy-always-true`, en sachant ce que vous abandonnez :
  `--skip` désactive la vérification partout, y compris sur la table que vous ajouterez le mois prochain.

### Sortie JSON

`--json` émet un objet stable : `scannedAt`, `database` (hôte et nom uniquement — jamais d'identifiants),
`serverVersion`, `platform`, `scannerIsPrivileged`, `exposedRoles`, `stats`, `findings` et `diagnostics`.
Chaque constat comporte `id`, `severity`, `title`, `target`, `detail`, `impact`, `fix`, `docs` et `confidence`.

`exposedRoles` et `diagnostics` font partie intégrante du contrat, ce ne sont pas des suppléments : chaque
vérification s'appuie sur l'ensemble exposé, et `diagnostics.degraded` permet au consommateur de distinguer
« rien d'anormal » de « l'analyse n'a pas pu vérifier ». Consulter `findings: []` sans ces deux éléments revient
à ne lire que la moitié de la réponse.

## Exécution planifiée

Une vérification qu'il faut penser à exécuter manuellement est une vérification qui déclarera une base
de données saine jusqu'au jour où un problème surviendra. Le backend peut exécuter celle-ci pour vous
et transmettre le résultat au panneau d'administration :

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

Passez cela en tant que `rlsAudit` dans l'objet fourni à `initializeRebaseBackend`.

Le résultat est servi sur `GET /api/admin/rls-audit`, restreint aux administrateurs comme toute autre
surface d'administration, et chaque exécution journalise une ligne — au niveau `warn` lorsqu'un constat
atteint `warnAtSeverity`, à `info` sinon :

```
⚠️  [rls-audit] RLS audit found 3 issue(s) — 1 critical, 2 medium. 1 table(s)
    without RLS. Read the detail at GET /api/admin/rls-audit.
```

### Pourquoi vous devez injecter `scan`

`@rebasepro/server` ne possède aucun pilote de base de données — c'est ce qui lui permet d'être utilisable
aussi bien avec Postgres, Mongo que Firebase. `@rebasepro/rls-check` embarque `pg`, car il se connecte à Postgres.
L'importer au sein du package serveur intégrerait un pilote Postgres dans chaque installation, pour une
fonctionnalité que seules certaines d'entre elles utilisent ; vous injectez donc la fonction à la place.

### Dans un déploiement scindé

L'audit est un singleton avec *propriétaire* (owned), comme le planificateur cron. Chaque processus qui
en a la propriété exécute sa propre analyse, qui est en lecture seule et inoffensive mais redondante — confiez-la
à un seul processus :

```ts
ownership: { rlsAudit: false }   // on every process but one
```

ou, pour un environnement d'exécution configuré par variables d'environnement :

```bash
REBASE_RLS_AUDIT=false
```

Le rôle `functions` le définit déjà avec `false` — ce processus n'exécute aucun minuteur. Spécifier une
substitution de propriété n'en affecte jamais une autre : désactiver cron ne modifie pas l'audit, et inversement.

Un processus qui dessert l'interface d'administration sans posséder l'analyse répondra honnêtement sur
le point de terminaison en indiquant que l'analyse ne s'exécute pas sur celui-ci.

### C'est un filet de sécurité, pas un outil de monitoring

L'intervalle par défaut est d'un jour, car l'élément surveillé est un schéma : il évolue lors des déploiements,
pas avec le trafic. Une analyse ayant échoué est journalisée et enregistrée dans le statut — elle n'est jamais
levée comme une exception. Transformer un contrôle de sécurité en une nouvelle cause de panne pour le serveur
serait un mauvais calcul sur tous les plans.

## Comment lire le rapport

**Les constats confirmés apparaissent en premier ; les constats heuristiques se trouvent dans une section
distincte « à vérifier » (worth checking).** Une vérification heuristique ne peut pas deviner l'intention — une
table de jonction que vous avez délibérément laissée ouverte n'est pas un bogue — ceux-ci sont donc formulés
sous forme de questions et ne sont jamais mélangés aux certitudes.

**Attention à la remarque sur les privilèges.** Si l'analyse se connecte en tant que superutilisateur, propriétaire
d'une table ou avec un rôle doté de `BYPASSRLS`, elle le signale. Ce rôle a accès au véritable catalogue, ce qui
rend l'audit possible, mais cela signifie également que rien dans le rapport ne décrit ce dont *cette* connexion
fait l'expérience. Les constats portent sur ce à quoi les autres rôles ont accès.

### Sur une base de données Rebase, modifiez la règle, pas la stratégie

Chaque stratégie sur un déploiement Rebase est compilée à partir des `securityRules` d'une collection, et le
runtime **les réapplique à chaque démarrage** : il supprime chaque stratégie générée et la recrée à partir de la
configuration. Un `ALTER POLICY` exécuté sur l'une d'elles ne survit donc que jusqu'au prochain redémarrage, et le
constat réapparaît aussitôt — après l'avoir pourtant vu disparaître.

`rls-check` reconnaît ces stratégies (un nom du type `<table>_<operation>_<hash>`, ou un appel à `rebase.uid()` /
`rebase.roles()` dans l'expression) et recommande de modifier la règle plutôt que le SQL. Lorsque vous voyez
une correction qui l'indique :

1. localisez la collection correspondant à la table nommée, sous `config/collections/` ;
2. modifiez ses `securityRules` — voir [règles de sécurité](/docs/collections/security-rules) ;
3. si la collection n'en déclare aucune qui lui soit propre, elle hérite de `defaultSecurityRules` depuis
   `config/collections/index.ts`, et c'est ce fichier qu'il faut modifier ;
4. redéployez — le démarrage réapplique les stratégies — ou exécutez `rebase db push`.

Une stratégie que vous avez écrite à la main, dans une migration, n'est aucunement touchée par tout cela, et sa
correction reste la commande SQL à exécuter.

## Les vérifications

Les niveaux de gravité ci-dessous sont ceux par défaut ; plusieurs vérifications ajustent leur propre niveau en
fonction de leurs découvertes, et le rapport en précise systématiquement la raison.

### rls-disabled

**Table exposée sans sécurité au niveau des lignes.** Critique.

La table a le RLS désactivé *et* accorde les privilèges `SELECT`/`INSERT`/`UPDATE`/`DELETE` à un rôle auquel un
appelant non approuvé peut accéder (`anon`, `PUBLIC`, `web_anon`, `rebase_user`). Postgres n'applique aucun filtre
par ligne, de sorte que les stratégies — s'il en existe — ne sont jamais consultées.

Une table étrangère (foreign table) avec un tel privilège est également signalée. Postgres ne peut
pas activer le RLS sur une telle table, donc le privilège livre tout ce que renvoie le serveur
distant, et le correctif proposé révoque plutôt le privilège.

Une table avec le RLS désactivé mais sans privilège accordé à un rôle exposé n'est *pas* signalée. Elle n'est
pas accessible, et la signaler ne ferait qu'ajouter du bruit.

```sql
ALTER TABLE "public"."your_table" ENABLE ROW LEVEL SECURITY;
```

Activer le RLS sans aucune stratégie refuse chaque ligne à tout le monde sauf au propriétaire. Ajoutez donc la
stratégie souhaitée dans la même migration — sinon vous aurez échangé une exposition contre une panne silencieuse.
Voir [rls-enabled-no-policies](#rls-enabled-no-policies).

### policy-always-true

**La stratégie accorde un accès inconditionnel.** Critique.

Une stratégie permissive dont l'expression `USING` ou `WITH CHECK` est une constante vraie — `true`,
`(true)`, `1 = 1`. Les stratégies permissives sont combinées avec un opérateur OU (OR), de sorte qu'une seule d'entre
elles suffit à satisfaire le filtre de ligne de la table, quelle que soit la rigueur de toutes les autres stratégies.

Si des stratégies `RESTRICTIVE` sur la même commande (`ALL` pour un `ALL` permissif) s'appliquent à
chaque rôle exposé qu'atteint la stratégie permissive, ce constat est rétrogradé au niveau moyen et
signalé comme un élément à vérifier plutôt que comme une certitude, car les stratégies restrictives
s'appliquent avec un ET (AND) après la combinaison OU des stratégies permissives. Une stratégie
restrictive qui protège d'autres rôles ou une autre commande ne compte pas : elle laisse la
stratégie permissive ouverte à tous ceux qu'elle ne couvre pas.

```sql
ALTER POLICY "your_policy" ON "public"."your_table"
    USING (user_id = rebase.uid());
```

Sur une base de données Rebase, la correction réside dans la règle de la collection plutôt que dans cette
instruction — voir [modifiez la règle, pas la stratégie](#sur-une-base-de-données-rebase-modifiez-la-règle-pas-la-stratégie).
Un scaffold standard signale cette vérification sur `posts`, `authors` et `tags` par conception.

### policy-anonymous-tautology

**La stratégie vérifie uniquement l'existence d'un identifiant d'appelant.** La gravité dépend de la plateforme.

L'expression a une forme de type `rebase.uid() IS NOT NULL` (ou `auth.uid()` sur Supabase, ainsi que sur une base
de données Rebase provisionnée avant la version 1.0) : elle sépare les appelants connectés des appelants déconnectés,
mais ne restreint aucune ligne. Chaque utilisateur connecté accède à chaque ligne couverte par la stratégie.

La gravité dépend de la plateforme, et cette distinction a son importance :

- **Sur Supabase**, `auth.uid()` renvoie `NULL` pour les appelants anonymes, c'est donc une vérification fonctionnelle
  réservée aux utilisateurs authentifiés. Signalé comme **faible** (low) — un défaut de restriction des données entre
  utilisateurs connectés, et non une faille d'accès anonyme.
- **Sur Rebase ou PostgREST**, où un identifiant d'appelant vide est converti en valeur sentinelle `'anonymous'`,
  l'expression est *vraie également pour les appelants déconnectés*. Signalé comme **critique** (critical).
- **Sur une plateforme non reconnue**, signalé comme **moyen** (medium), car le fait qu'il s'agisse d'une faille
  dépend de l'utilisation ou non d'une telle sentinelle par votre pile.

```sql
-- Scope to the row's owner rather than to the existence of an id
ALTER POLICY "your_policy" ON "public"."your_table"
    USING (user_id = rebase.uid());

-- Or, if "any signed-in user" really is the intent, reject the sentinel explicitly
--     USING (rebase.uid() IS NOT NULL AND rebase.uid() <> 'anonymous');
```

Le code SQL suggéré est affiché avec la fonction d'identifiant d'appelant présente sur votre base de données :
`rebase.uid()` sur une base Rebase, `auth.uid()` sur Supabase et PostgREST. Les deux syntaxes sont reconnues lors
de la lecture des stratégies, de sorte qu'une base Rebase en cours de migration depuis le schéma `auth` antérieur
à la version 1.0 est toujours vérifiée.

### policy-authenticated-tautology

**La stratégie autorise chaque appelant connecté à accéder à toutes les lignes.** Élevé.

La forme corrigée de la vérification précédente — `rebase.uid() IS NOT NULL AND rebase.uid() <> 'anonymous'` —
et l'endroit où l'on s'arrête souvent par erreur. Elle exclut effectivement les appelants déconnectés. Ce qu'elle
ne fait pas, en revanche, c'est restreindre les lignes : ce qui reste revient à dire que *chaque compte enregistré
peut lire chaque ligne de cette table*, ce qui est une affirmation bien différente de celle généralement visée.

C'est cette structure qui transforme une table `users` en un annuaire de toutes les adresses de la plateforme,
lisible par quiconque s'inscrit — et là où l'inscription est ouverte, « quiconque s'inscrit » désigne n'importe qui.
Elle est signalée séparément de la version anonyme car la correction est différente, tout comme la gravité, et parce
que vous pouvez légitimement souhaiter ignorer l'une sans ignorer l'autre.

```sql
-- Scope to the row
ALTER POLICY "your_policy" ON "public"."your_table"
    USING (user_id = rebase.uid());

-- Or, where members of a shared group really may see each other's rows, say which group
--     USING (EXISTS (SELECT 1 FROM memberships m
--                    WHERE m.org_id = your_table.org_id AND m.user_id = rebase.uid()));
```

Si la table est véritablement destinée à être lue par tous les comptes — une grille tarifaire partagée, une liste
de pays — conservez la stratégie et masquez le constat avec `rls-check --skip policy-authenticated-tautology`.

### view-bypasses-rls

**La vue contourne le RLS de sa table sous-jacente.** Critique.

Une vue accordée à un rôle non approuvé qui sélectionne des données dans une table protégée par RLS sans
`security_invoker = true`. La vue s'exécute avec les privilèges de son **propriétaire**, elle lit donc la table
sous-jacente en tant que propriétaire et les stratégies de l'appelant ne s'appliquent jamais. C'est la façon la plus
courante dont une table pourtant soigneusement verrouillée subit une fuite.

```sql
ALTER VIEW "public"."your_view" SET (security_invoker = true);
```

Sur PostgreSQL antérieur à la version 15, cette option n'existe pas du tout, de sorte que chaque vue de ce type
se comporte ainsi. Dans ce cas, le constat est signalé comme heuristique, et la solution consiste à déplacer la
logique dans une fonction ou à mettre à niveau votre version de PostgreSQL.

### matview-bypasses-rls

**La vue matérialisée expose des données protégées par RLS.** Élevé.

Les vues matérialisées ne peuvent pas bénéficier de la sécurité au niveau des lignes, et les données qu'elles
contiennent constituent un instantané statique pris par quiconque l'a rafraîchi. Si une vue matérialisée est
accordée à un rôle non approuvé et que sa requête de définition lit une table protégée par RLS, aucune stratégie
ne peut intervenir — révoquez le privilège ou déplacez la vue matérialisée dans un schéma inaccessible aux rôles
non approuvés.

```sql
REVOKE ALL ON "public"."your_matview" FROM "anon";
```

### anonymous-write-allowed

**Les appelants non authentifiés peuvent écrire.** Élevé.

Une stratégie permissive `INSERT`/`UPDATE`/`DELETE`/`ALL` accessible sans authentification dont l'expression de
contrôle accepte n'importe quelle ligne, assortie d'un privilège (grant) correspondant.

La condition « accepte n'importe quelle ligne » est essentielle et délibérément stricte. Supabase accorde par
défaut à `anon` et `authenticated` tous les droits DML, de sorte qu'une stratégie ciblant ces rôles ne pose pas
de problème en soi — une stratégie classique `FOR INSERT TO public WITH CHECK (user_id = auth.uid())` est correcte
et n'est pas signalée.

### unqualified-column-in-subquery

**Colonne non qualifiée dans une sous-requête de stratégie.** Élevé, heuristique.

Un nom de colonne non préfixé à l'intérieur d'une sous-requête `EXISTS`/`IN` qui existe à la fois sur la relation
interne et sur la table propre à la stratégie. Postgres la lie à la table **interne**, de sorte que la corrélation
avec la ligne externe que vous vouliez écrire disparaît silencieusement et le prédicat devient trivialement
satisfaisable — ou trivialement insatisfaisable, refusant chaque ligne à tout le monde.

```sql
-- The bug: `id` binds to memberships, not organizations
USING (EXISTS (SELECT 1 FROM memberships WHERE id = organizations.id ...))

-- Qualify it
USING (EXISTS (SELECT 1 FROM memberships m WHERE m.org_id = organizations.id ...))
```

**L'absence de ce constat ne constitue pas une preuve de sécurité.** `pg_policies.qual` est le rendu propre à
Postgres de l'arbre syntaxique, et il requalifie généralement les références de colonnes — le nom simple d'origine
n'est donc souvent plus visible au moment où le catalogue est lu. Lorsque cette vérification se déclenche, il
s'agit d'une preuve solide ; lorsqu'elle ne se déclenche pas, cela ne prouve rien.

### junction-table-unprotected

**Table de jointure plusieurs-à-plusieurs sans RLS.** Élevé, heuristique.

Une table qui ne contient pour l'essentiel que les deux extrémités de deux clés étrangères, pointant toutes deux
vers des tables qui *ont* un RLS, sans avoir de sécurité au niveau des lignes elle-même. Les deux côtés de la
relation sont verrouillés tandis que le lien entre eux reste ouvert — ce qui suffit pour énumérer la relation même
lorsque ni l'une ni l'autre des extrémités ne peut être lue.

Heuristique, car une table de jointure est déduite de sa structure. Si la vôtre est délibérément publique,
utilisez `--skip junction-table-unprotected`.

### rls-enabled-not-forced

**RLS activé mais non forcé pour le propriétaire de la table.** Moyen, élevé ou critique.

Sans `FORCE`, le propriétaire de la table est dispensé de ses propres stratégies, tout comme chaque
membre du rôle propriétaire. Cela est sans danger lorsque le propriétaire est un rôle de
provisionnement avec lequel rien ne se connecte, mais grave lorsque votre application se connecte en
tant que propriétaire — ce constat est donc **critique** (critical) lorsqu'un rôle sous lequel
arrive un appelant non approuvé possède la table ou est membre du rôle propriétaire, **élevé**
(high) lorsque le rôle propriétaire peut se connecter ou qu'un rôle qui le peut en est membre, et
**moyen** (medium) dans le cas contraire.

Si le propriétaire est un superutilisateur ou possède `BYPASSRLS`, il reste moyen et le mentionne : `FORCE` ne
peut pas contraindre un tel rôle, et laisser entendre le contraire serait trompeur.

```sql
ALTER TABLE "public"."your_table" FORCE ROW LEVEL SECURITY;
```

### rls-enabled-no-policies

**RLS activé sans aucune stratégie.** Moyen.

Il ne s'agit pas d'une faille de sécurité — bien au contraire. Un RLS actif avec zéro stratégie refuse chaque
ligne à tout le monde, excepté au propriétaire. Ce cas est signalé car il s'agit d'un échec *invisible* : l'API
renvoie `[]`, et une table vide ne se distingue pas d'une table filtrée. Cette configuration a déjà servi
silencieusement des collections vides en production pendant des semaines entières.

### policy-role-unreachable

**Les stratégies ciblent des rôles avec lesquels rien ne se connecte.** Moyen.

Toutes les stratégies de la table désignent des rôles qui n'existent pas, qui ne peuvent pas se connecter, et
dont aucun rôle de connexion n'hérite de manière transitive. Les stratégies paraissent correctes et ne s'appliquent
à personne, de sorte que la table apparaît vide lors de la lecture.

Le cas classique concerne des stratégies écrites avec `TO authenticated` — un nom de rôle Supabase — sur une
base de données dont les requêtes arrivent en réalité sous un autre rôle.

### grant-to-public

**Privilèges de table accordés à PUBLIC.** Moyen.

Un privilège DML accordé à `PUBLIC`, sur une table ou une table étrangère. Même lorsque le RLS est
activé, cela élargit les personnes pour lesquelles les stratégies sont évaluées, et ce n'est presque
jamais délibéré.

```sql
REVOKE ALL ON "public"."your_table" FROM PUBLIC;
```

### security-definer-mutable-search-path

**Routine SECURITY DEFINER avec un search_path modifiable.** Moyen.

La routine s'exécute avec les droits de son propriétaire — souvent un superutilisateur — tandis que l'appelant
contrôle la résolution de ses identifiants. Il s'agit de la forme classique d'escalade de privilèges, et tout ce
que la routine touche est lu avec les droits du propriétaire, contournant le RLS.

```sql
ALTER FUNCTION "public"."your_function"() SET search_path = pg_catalog, public;
```

### current-setting-throws

**La stratégie appelle `current_setting()` sans `missing_ok`.** Faible, heuristique.

`current_setting('app.tenant_id')` avec un seul argument *lève une exception* lorsque le paramètre n'est pas
défini, au lieu de renvoyer `NULL`. Ainsi, au lieu de refuser la ligne, la requête échoue — l'appelant reçoit une
erreur 500 plutôt qu'un résultat vide, et un middleware qui réessaie les erreurs 5xx retentera une requête qui
ne pourra jamais aboutir.

```sql
ALTER POLICY "your_policy" ON "public"."your_table"
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
```

## Ce que cet outil ne fait pas

Être clair sur les limites est primordial — un outil de sécurité qui surestime sa couverture est pire que pas
d'outil du tout.

- **Il s'agit d'un audit statique du catalogue.** Il lit `pg_class`, `pg_policies`, `pg_depend` et leurs équivalents.
  Il ne se connecte pas sous votre rôle `anon` pour tenter de lire vos données, il ne peut donc pas confirmer qu'une
  exposition est exploitable via votre API.
- **Il ne peut pas prouver qu'une stratégie est correcte.** Il détecte des modèles reconnus comme incorrects. Une
  stratégie qui réussit toutes les vérifications présentées ici peut tout de même exprimer une mauvaise règle métier.
- **Un rapport sans anomalie n'est pas une certification de sécurité.** En particulier, reportez-vous à la remarque sur
  [unqualified-column-in-subquery](#unqualified-column-in-subquery) : Postgres réécrit les expressions des stratégies,
  de sorte que certains bogues ne sont plus du tout visibles dans le catalogue.
- **Il ne vérifie pas l'autorisation au niveau applicatif**, les clés d'API, l'exposition réseau, la gestion des secrets
  ou tout autre élément extérieur à la base de données.

## Voir aussi

- [Règles de sécurité (RLS)](/docs/collections/security-rules) — définir la sécurité au niveau des lignes dans les
  collections Rebase, qui sont compilées dans les stratégies auditées par cet outil.
- [Backend uniquement](/docs/getting-started/headless/) — pourquoi une table sans stratégie n'est pas servie du tout
  dans un projet headless.
- [API REST](/docs/backend/api/) — la surface qu'une stratégie permissive expose.
