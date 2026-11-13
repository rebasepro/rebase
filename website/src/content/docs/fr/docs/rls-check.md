---
sourceHash: 313f8530404811bc
slug: fr/docs/rls-check
title: rls-check
description: Auditez la sécurité au niveau des lignes (RLS) sur n'importe quelle base PostgreSQL — Supabase, Neon, RDS ou votre propre serveur. En lecture seule, sans inscription, sans Rebase requis.
---

# rls-check

`rls-check` lit le catalogue d'une base de données PostgreSQL et signale ce qui est réellement exposé :
les tables servies avec la sécurité au niveau des lignes désactivée, les politiques qui s'évaluent à vrai pour
tout le monde, les vues qui contournent directement la RLS de leurs tables sous-jacentes, et les tables
de jointure oubliées alors que leurs deux extrémités étaient pourtant verrouillées.

Il fonctionne sur **n'importe quel** Postgres — Supabase, Neon, RDS, Cloud SQL ou un serveur que vous gérez vous-même. Il ne nécessite pas Rebase et s'avère utile que vous l'adoptiez un jour ou non.

```bash
npx @rebasepro/rls-check
```

Lancez-le dans le répertoire de votre projet et il trouvera la base de données de lui-même : `DATABASE_URL`,
puis `POSTGRES_URL`, puis un `.env` à proximité. Ne passez la chaîne de connexion en
argument que si vous ne pouvez pas faire autrement — npm réaffiche la ligne de commande avant que
le programme ne démarre, et votre shell l'enregistre ; un mot de passe en argument se retrouve donc à
deux endroits où `rls-check` ne peut pas le masquer. `$DATABASE_URL` n'est pas plus sûr à cet endroit : le shell
le développe avant même que npm ne le voie.

Il est conçu pour être en lecture seule par nature : il ouvre une transaction en lecture seule et exécute
des requêtes sur le catalogue. Il n'écrit rien et n'envoie rien nulle part — il n'y a aucune télémétrie et aucun
appel réseau autre que celui vers votre base de données.

## Exécution

```bash
# Depuis l'environnement — DATABASE_URL, puis POSTGRES_URL, puis un .env dans le répertoire courant
npx @rebasepro/rls-check

# Pour une base de données qui n'est pas celle de votre environnement
DATABASE_URL="postgres://user:pass@host:5432/dbname" npx @rebasepro/rls-check

# En argument. Fonctionne, mais lisez l'avertissement ci-dessus concernant l'exposition du mot de passe
npx @rebasepro/rls-check "postgres://user:pass@host:5432/dbname"
```

Si votre mot de passe contient `/`, `?` ou `#`, encodez-le en URL (percent-encoding). Ces trois caractères
terminent la section d'autorité de l'URL, ce qui coupe la chaîne au milieu de l'identifiant — plutôt que d'afficher des fragments
de mot de passe, `rls-check` rejette la chaîne et le signale.

`@` et `:` ne nécessitent aucun encodage : les informations utilisateur sont séparées au **dernier** `@` et l'utilisateur au
**premier** `:`, ce qui correspond également au comportement de `pg` ; ainsi, `postgres://user:pa@ss@host:5432/db` se connecte
à `host` avec le mot de passe `pa@ss`. Les encoder malgré tout n'est jamais une mauvaise chose.

### Options

| Option | Signification |
| --- | --- |
| `--json` | Sortie lisible par une machine sur stdout, et rien d'autre sur stdout |
| `--format <name>` | `text` (par défaut), `json` (identique à `--json`) ou `agent` : un document JSON unique pour un agent de codage, où chaque constatation contient la table et la politique défaillantes, le SQL qui la corrige et les `securityRules` Rebase équivalentes |
| `--html <path>` | Génère également un rapport HTML autonome à cet emplacement. Un seul fichier, aucune requête réseau |
| `--schema <name>` | Limite l'analyse à un schéma. Répétable ou séparé par des virgules |
| `--role <name>` | Considère ce rôle comme un rôle avec lequel arrive un appelant non approuvé, en plus de `anon`, `authenticated`, `web_anon` et `rebase_user`. Répétable ou séparé par des virgules |
| `--request-role <name>` | Le rôle sous lequel une application Rebase exécute les requêtes sur cette base, à la place de `rebase_user` (le paramètre `rls.requestRole`). Sans cette option, les rôles enregistrés dans `rebase.schema_meta` sont utilisés, puis `rebase_user`. Répétable ou séparé par des virgules |
| `--fail-on <severity>` | Renvoie le code de sortie 1 à partir de cette sévérité. Valeur par défaut : `high` ; `none` n'échoue jamais |
| `--only <id>` | Exécute uniquement ces vérifications. Répétable ou séparé par des virgules |
| `--skip <id>` | Ignore ces vérifications. Répétable ou séparé par des virgules |
| `--list-checks` | Affiche le catalogue et quitte |
| `--timeout <ms>` | Délai d'expiration des instructions (statement timeout), par défaut 15000 |
| `--quiet` | Constatations uniquement — sans bannière ni résumé |
| `--no-color` | Désactive les couleurs ANSI (respecte également `NO_COLOR` et un stdout non-TTY) |

Un identifiant inconnu passé à `--only` ou `--skip` génère une erreur plutôt qu'une opération ignorée silencieusement,
car une faute de frappe affaiblirait discrètement la portée de l'analyse. Un rôle passé à `--role` ou `--request-role` qui n'existe pas dans `pg_roles`
déclenche une erreur pour la même raison : chaque vérification repose sur un grant accordé à un rôle exposé, un nom qui
ne correspond à rien supprimerait donc de la couverture sans avertissement. Il en va de même pour un `--schema` qui ne désigne aucun schéma,
ce qui analyserait le vide et le déclarerait sain. Les noms de schémas sont sensibles à la casse.

L'en-tête du rapport liste les rôles considérés comme exposés lors de l'exécution, afin que vous puissiez voir en un coup d'œil
si la mention `No findings` couvre bien le rôle sous lequel votre application se connecte :

```
Exposed   PUBLIC, anon, authenticated (add yours with --role)
```

Lorsque l'analyse se connecte avec un rôle que la sécurité au niveau des lignes *peut* contraindre — pas un superutilisateur, pas
un propriétaire, sans `BYPASSRLS` — ce rôle est ajouté à l'ensemble et le rapport l'indique. Réaliser l'analyse avec
le rôle propre à votre application est ce qui se rapproche le plus d'interroger la base de données sur ce que voit réellement votre API.

### Codes de sortie

| Code | Signification |
| --- | --- |
| `0` | Aucune anomalie détectée atteignant ou dépassant le seuil `--fail-on` |
| `1` | Au moins une anomalie détectée atteignant ou dépassant le seuil |
| `2` | L'analyse n'a pas pu s'exécuter — arguments invalides, connexion refusée, échec d'authentification, délai dépassé — ou est incomplète : une lecture de catalogue a échoué ou une vérification a planté (`diagnostics.degraded`). Ceci s'applique même avec `--fail-on none` |

Les codes `1` et `2` sont délibérément distincts : une connexion défaillante ne doit jamais passer pour
une base de données saine.

### En CI

```yaml
- name: Audit RLS
  run: npx @rebasepro/rls-check --fail-on high
  env:
    DATABASE_URL: ${{ secrets.DATABASE_URL }}
```

**Un nouveau projet Rebase ne passe pas ce test dès le premier jour, et ce n'est pas le but.** Le
modèle de départ (`defaultRls`) ouvre les lectures à tout le monde — `{ operation: "select", access:
"public" }` dans `backend/schema/index.ts`, hérité par `authors` et `tags` avec
`rls: "inherit"` — chacun remonte donc une anomalie critique `policy-always-true`. (`posts` déclare ses propres règles et ne lit que les lignes publiées.) `access: "public"` concerne les *lignes*, pas l'autorisation d'appeler
l'API : une requête sans jeton reçoit toujours une réponse 401 tant que `AUTH_REQUIRE` est actif. La constatation est
néanmoins correcte, car cette règle est la seule barrière protégeant la donnée.

Déterminez dans quelle situation vous vous trouvez avant d'intégrer cela dans votre CI :

- **les règles sont temporaires** — remplacez-les par celles dont vos données ont réellement besoin
  ([sécurité au niveau des lignes](/docs/collections/security-rules)), et les anomalies disparaîtront ;
- **les lignes sont véritablement accessibles à tous** — déclarez-le explicitement une fois avec
  `npx @rebasepro/rls-check --fail-on high --skip policy-always-true`, en mesurant ce que vous abandonnez : `--skip` désactive la vérification partout, y compris sur la table que vous ajouterez le mois prochain.

### Sortie JSON

`--json` génère un objet stable : `scannedAt`, `database` (hôte et nom uniquement — jamais
d'identifiants), `serverVersion`, `platform`, `scannerIsPrivileged`, `exposedRoles`, `stats`,
`findings` et `diagnostics`. Chaque constatation contient `id`, `severity`, `title`, `target`,
`detail`, `impact`, `fix`, `docs` et `confidence`.

`exposedRoles` et `diagnostics` font partie du contrat et ne sont pas des extras : chaque vérification s'appuie sur
l'ensemble des rôles exposés, et `diagnostics.degraded` permet au consommateur de distinguer "aucun problème détecté"
d'un "l'analyseur n'a pas pu vérifier". Lire `findings: []` sans ces deux champs revient à ne lire que la moitié de la réponse.

### Sortie Agent

`--format agent` affiche un document JSON unique conçu pour un agent de codage qui corrige ce qu'il trouve. Chaque
constatation indique l'id de la vérification et l'objet défaillant (`target.table`, `target.policy`, …) et contient
une `remediation` : `apply` (`sql` ; `rebase-config` lorsque Rebase régénère la politique à partir du `rls`
d'une table à chaque démarrage ; ou `manual`), du code `sql` exécutable rédigé par vérification, les
`placeholders` à renseigner au préalable, et `rebase` — le correctif équivalent sous forme de `rls` pour la table, avec un
extrait `defineTable(…, { rls })` pour `backend/schema/`, ou la raison pour laquelle les règles ne peuvent pas l'exprimer. Depuis
la version 0.31, cette clé est `rebase.rls` (auparavant `rebase.securityRules`) et la version du format du document est 2. La
`key` de chaque constatation est stable d'une exécution à l'autre, ce qui permet à une ré-exécution de montrer ce qui a été résolu. `--json` reste inchangé.

## Planifier son exécution

Une vérification qu'il faut penser à exécuter manuellement est une vérification qui déclarera une base saine
jusqu'au jour précis où l'incident surviendra. Le backend peut exécuter celle-ci pour vous et
fournir le résultat au panneau d'administration :

```ts
import { scan } from "@rebasepro/rls-check";
import type { RebaseBackendConfig } from "@rebasepro/server";

const rlsAudit: RebaseBackendConfig["rlsAudit"] = {
    enabled: true,
    scan,
    intervalMs: 24 * 60 * 60 * 1000,  // la valeur par défaut
    warnAtSeverity: "high"            // la valeur par défaut
};
```

Passez cela en tant que `rlsAudit` dans l'objet transmis à `initializeRebaseBackend`.

Sur l'environnement d'exécution — `rebase dev`, `rebase start` et l'image serveur officielle —
il n'y a pas d'objet de ce type à fournir ; définissez plutôt `REBASE_RLS_AUDIT=true`,
avec l'intervalle et le seuil par défaut. L'analyseur doit toujours provenir de votre
projet : ajoutez `@rebasepro/rls-check` à ses dépendances pour que le bundle l'embarque.
Le runtime ne livre aucune copie de son côté, et un démarrage demandant l'audit sans
le paquet échouera avant d'ouvrir la moindre connexion, en indiquant le paquet à installer.

Le résultat est exposé sur `GET /api/admin/rls-audit`, restreint au scope
`schema:read`, et chaque passage consigne une seule ligne de log — au niveau `warn` lorsqu'une anomalie atteint
`warnAtSeverity`, à `info` dans le cas contraire :

```
⚠️  [rls-audit] RLS audit found 3 issue(s) — 1 critical, 2 medium. 1 table(s)
    without RLS. Read the detail at GET /api/admin/rls-audit, or run
    `npx @rebasepro/rls-check` for the full report.
```

### Pourquoi devez-vous injecter `scan`

`@rebasepro/server` ne possède pas de pilote de base de données en propre ; `@rebasepro/rls-check`
embarque `pg` parce qu'il se connecte à Postgres. L'importer directement au sein du paquet serveur
ajouterait un second pilote Postgres dans chaque installation pour une fonctionnalité que seules
certaines utilisent ; vous lui transmettez donc la fonction à la place.

### Dans un déploiement distribué

L'audit est un singleton *à propriétaire exclusif* (owned singleton), tout comme le planificateur cron. Chaque processus qui
en a la charge exécute sa propre analyse, ce qui est en lecture seule et sans danger mais redondant — attribuez-le
à un seul processus :

```ts
ownership: { rlsAudit: false }   // sur chaque processus sauf un
```

ou, pour un runtime configuré par variables d'environnement :

```bash
REBASE_RLS_AUDIT=false
```

Le rôle `functions` le possède déjà à `false` — ce processus n'exécute aucun timer.
Redéfinir une appartenance n'affecte jamais les autres : désactiver le cron ne touche pas
à l'audit, et inversement.

Un processus qui sert l'interface d'administration sans détenir la tâche d'analyse répondra
en toute transparence sur le endpoint que l'analyse ne tourne pas sur cette instance.

### C'est un filet de sécurité, pas un système de monitoring

L'intervalle par défaut est d'une journée, car l'élément surveillé est un schéma :
il évolue lors des déploiements, pas au gré du trafic. Une analyse en échec est journalisée et inscrite
dans le statut — aucune exception n'est levée. Transformer un contrôle de sécurité en une nouvelle opportunité
de faire planter le serveur serait préjudiciable sur tous les plans.

## Comment lire le rapport

**Les constatations confirmées apparaissent en premier ; les détections heuristiques figurent dans une section distincte "à vérifier" (worth checking).** Une analyse heuristique ne peut deviner l'intention — une table de jonction
délibérément laissée ouverte n'est pas un bug — ces points sont donc formulés sous forme de questions et ne sont jamais mélangés
aux certitudes.

**Prêtez attention à la note sur les privilèges.** Si l'analyse se connecte en tant que superutilisateur, propriétaire de la table ou
avec un rôle doté de `BYPASSRLS`, elle l'indique. Ce rôle a une vision exacte du catalogue, ce qui rend
l'audit possible, mais cela implique aussi que rien dans le rapport ne décrit ce dont *cette* connexion
fait l'expérience. Les constats décrivent ce que les autres rôles obtiennent.

### Sur une base de données Rebase, modifiez la règle, pas la politique

Chaque politique sur un déploiement Rebase est compilée depuis la configuration `rls` d'une table, et le
runtime **les valide à chaque démarrage** : chaque politique générée porte une empreinte (un
commentaire `rebase:<hash>`) de ce qui a été compilé et de ce que Postgres a enregistré, et une table dont
les politiques ne correspondent plus est réalignée d'après la configuration. Un `ALTER POLICY` appliqué manuellement
sur l'une d'entre elles ne survit donc que jusqu'au prochain redémarrage, et l'anomalie réapparaîtra
aussitôt — après que vous l'avez vue disparaître.

`rls-check` reconnaît ces politiques (un nom sous la forme `<table>_<operation>_<hash>`, ou un appel à
`rebase.uid()` / `rebase.roles()` dans l'expression) et préconise de modifier la règle plutôt que d'exécuter du SQL.
Lorsque vous voyez un correctif l'indiquant :

1. trouvez la table mentionnée, sous `backend/schema/` ;
2. modifiez son paramètre `rls` — consultez la documentation [sécurité au niveau des lignes](/docs/collections/security-rules) ;
3. si la table indique `rls: "inherit"`, elle hérite de `defaultRls` depuis
   `backend/schema/index.ts`, et c'est ce fichier qu'il faut éditer ;
4. redéployez — le démarrage réapplique les politiques — ou exécutez `rebase db push`.

Une politique rédigée à la main dans une migration n'est pas concernée par ce mécanisme, et sa solution
reste l'instruction SQL à exécuter.

## Les vérifications

Les sévérités ci-dessous sont les valeurs par défaut ; plusieurs vérifications ajustent leur propre niveau selon
leurs découvertes, et le rapport en explique systématiquement la raison.

### rls-disabled

**Table exposée sans sécurité au niveau des lignes.** Critique.

La table a la RLS désactivée *et* accorde `SELECT`/`INSERT`/`UPDATE`/`DELETE` à un rôle qu'un
appelant non approuvé peut utiliser (`anon`, `PUBLIC`, `web_anon`, `rebase_user`). Postgres n'applique
aucun filtre ligne par ligne, les politiques — si tant est qu'il en existe — ne sont donc jamais consultées.

Une table étrangère (foreign table) disposant d'un tel privilège est également signalée. Postgres ne pouvant activer la RLS sur ce type d'objet,
le grant expose l'intégralité de ce que renvoie le serveur distant, et le correctif suggéré révoque
le grant.

Une table sans RLS mais sans privilège accordé à un rôle exposé n'est *pas* signalée, de même qu'une table située dans
un schéma sur lequel ce rôle ne dispose pas de `USAGE` — Postgres renvoie "permission denied for schema" avant même
d'examiner la table. Elle n'est pas accessible, la signaler ne ferait que générer du bruit.

```sql
ALTER TABLE "public"."your_table" ENABLE ROW LEVEL SECURITY;
```

Activer la RLS sans aucune politique refuse l'accès à toutes les lignes pour tout le monde sauf le propriétaire ; ajoutez donc la politique
souhaitée dans la même migration — sinon, vous aurez échangé une faille d'exposition contre une interruption
de service silencieuse. Voir [rls-enabled-no-policies](#rls-enabled-no-policies).

### policy-always-true

**La politique accorde un accès inconditionnel.** Critique.

Une politique permissive dont l'expression `USING` ou `WITH CHECK` est une vérité constante : `true`,
`(true)`, `1 = 1`, `1 > 0`, `NOT false`, `true OR <anything>`, ou une constante comparée à
elle-même via un cast. Les politiques permissives sont combinées avec l'opérateur OR, il suffit donc d'une seule règle
de ce type pour valider le filtre de ligne de la table, quelle que soit la sévérité des autres politiques.

Comme chaque vérification, elle ne signale une exposition que lorsqu'un rôle concerné peut effectivement accéder à la table :
il doit détenir le privilège requis par la commande et disposer du droit `USAGE` sur le schéma. Un `USING (true) TO anon` sur une
table sur laquelle `anon` n'a aucun droit recevra une réponse "permission denied" avant que la politique ne soit évaluée.
Cette politique est classée en **info**, sous le statut *latent* : rien n'atteint la table par son biais
aujourd'hui, mais un simple `GRANT` la transformerait en une exposition critique sans modifier la politique. Le niveau Info se situe
en dessous de tous les seuils `--fail-on` excepté `info`, il ne fait donc jamais échouer une exécution par défaut.

Lorsque seul le `WITH CHECK` d'une politique `UPDATE` est constant — `USING (user_id = rebase.uid())
WITH CHECK (true)` — la sévérité est **high** : `USING` continue de déterminer les lignes modifiables, mais la
vérification permet à une ligne modifiée de prendre n'importe quelle valeur, par exemple l'associer à un autre utilisateur. Sur une politique `FOR ALL`,
cette même condition autorise également n'importe quel `INSERT`, la sévérité reste donc critique.

Si des politiques `RESTRICTIVE` sur la même commande (`ALL` pour un `ALL` permissif) s'appliquent à tous
les rôles exposés que la politique permissive atteint, ce constat est rétrogradé à moyen (medium) et présenté comme
un point à vérifier plutôt qu'une certitude, car les politiques restrictives s'appliquent avec un AND après le OR
des politiques permissives. Une politique restrictive ciblant d'autres rôles ou une autre commande n'est pas prise en
compte : elle laisserait la politique permissive ouverte à tous ceux qu'elle ne couvre pas.

```sql
ALTER POLICY "your_policy" ON "public"."your_table"
    USING (user_id = rebase.uid());
```

Sur une base de données Rebase, le correctif se fait au niveau de la règle de la table plutôt que via cette instruction — voir
[modifiez la règle, pas la politique](#sur-une-base-de-données-rebase-modifiez-la-règle-pas-la-politique). Un
projet tout juste initialisé remonte délibérément cette alerte sur `posts`, `authors` et `tags`.

### policy-anonymous-tautology

**La politique vérifie seulement l'existence d'un identifiant d'appelant.** La sévérité dépend de la plateforme.

L'expression a la forme `rebase.uid() IS NOT NULL` (ou `auth.uid()` sur Supabase, ainsi que sur une
base Rebase déployée avant la version 1.0) : elle sépare les appelants authentifiés de ceux qui ne le sont pas, mais
ne filtre aucune ligne. Chaque utilisateur connecté a accès à l'ensemble des lignes couvertes par la politique.

La sévérité varie selon la plateforme, et cette distinction est essentielle :

- **Sur Supabase**, `auth.uid()` renvoie `NULL` pour les appelants anonymes ; il s'agit donc d'une vérification
  fonctionnelle réservée aux authentifiés. Classé en **low** — un défaut de cloisonnement des données entre
  utilisateurs connectés, et non une brèche d'accès anonyme. Cela s'applique uniquement à `auth.uid()` (et au claim `sub`
  qu'il lit) : une requête non authentifiée porte malgré tout la clé anon du projet, ainsi `auth.role()`
  vaut `'anon'` et `auth.jwt()` contient les claims de cette clé. La même structure basée sur l'un d'eux est
  *vraie pour les appelants non connectés*, et passe en **critical**.
- **Sur Rebase ou PostgREST**, où un identifiant vide est converti en valeur sentinelle `'anonymous'`,
  l'expression est *vraie également pour les appelants non authentifiés*. Classé en **critical**.
- **Sur une plateforme non reconnue**, classé en **medium**, la présence d'une brèche dépendant du fait
  que votre infrastructure utilise ou non une telle sentinelle.

Une base est considérée comme Rebase lorsqu'elle comporte le schéma `rebase`. Le rôle `rebase_user`
ne suffit pas à trancher, car les rôles sont transversaux au serveur, et un serveur hébergeant une
application Rebase peut contenir d'autres bases de données.

```sql
-- Restreindre au propriétaire de la ligne plutôt qu'à la simple existence d'un identifiant
ALTER POLICY "your_policy" ON "public"."your_table"
    USING (user_id = rebase.uid());

-- Ou, si l'objectif est réellement d'autoriser "tout utilisateur connecté", rejeter explicitement la sentinelle
--     USING (rebase.uid() IS NOT NULL AND rebase.uid() <> 'anonymous');
```

Le SQL suggéré est généré avec la fonction d'identifiant propre à votre base :
`rebase.uid()` sur une base Rebase, `auth.uid()` sur Supabase et PostgREST. Les deux
syntaxes sont reconnues lors de l'analyse des politiques, ce qui permet de continuer à vérifier une base Rebase en cours de migration depuis
le schéma `auth` antérieur à la 1.0.

### policy-authenticated-tautology

**La politique accorde à chaque appelant connecté l'accès à toutes les lignes.** High ; critique pour la vérification par rôle ci-dessous.

Il s'agit de la version corrigée du test précédent — `rebase.uid() IS NOT NULL AND rebase.uid() <>
'anonymous'` — et l'endroit où la plupart des gens s'arrêtent. Elle exclut bel et bien les appelants anonymes. En revanche,
elle ne restreint aucune ligne : la règle se résume à *tout compte enregistré peut lire l'intégralité des lignes
de cette table*, ce qui traduit rarement l'intention originelle. Sur un
projet Rebase, cela correspond à une règle dont la `condition` est `policy.authenticated()` sans rien d'autre,
ce que la base stocke sous la forme `rebase.uid() <> ALL (ARRAY['anonymous', 'anon'])`.
Une règle ayant pour seule condition `policy.registered()` est également signalée : son exclusion
`NOT rebase.is_anonymous()` écarte les invités mais ne filtre toujours aucune ligne ; chaque compte qui n'est pas un invité
accède donc à toutes les lignes. Avec le seuil par défaut `--fail-on high`, un pipeline CI analysant une telle politique échouera.

Une politique dont l'expression teste uniquement le rôle de l'appelant — `auth.role() = 'authenticated'`,
`(auth.jwt() ->> 'role') = 'authenticated'`, dans un sens ou dans l'autre — est aussi répertoriée sous cet identifiant. C'est l'équivalent
d'un `TO authenticated USING (true)` écrit sous forme d'expression ; elle hérite donc de la sévérité
que lui attribue [`policy-always-true`](#policy-always-true) : critique, ou high lorsque seul le
`WITH CHECK` d'une politique `UPDATE` réalise ce contrôle de rôle.

C'est typiquement la structure qui transforme une table `users` en annuaire exhaustif de toutes les adresses de la
plateforme, accessible par quiconque s'inscrit — et dès lors que l'inscription est ouverte, "quiconque s'inscrit" désigne
absolument n'importe qui. Ce cas est traité séparément de la forme anonyme car la correction
diffère, tout comme la sévérité, et vous pouvez légitimement souhaiter masquer
l'un sans masquer l'autre.

```sql
-- Restreindre à la ligne concernée
ALTER POLICY "your_policy" ON "public"."your_table"
    USING (user_id = rebase.uid());

-- Ou, si les membres d'un groupe partagé peuvent réellement voir les lignes des autres, expliciter le groupe
--     USING (EXISTS (SELECT 1 FROM memberships m
--                    WHERE m.org_id = your_table.org_id AND m.user_id = rebase.uid()));
```

Si la table a réellement vocation à être lue par n'importe quel compte — un barème public, une liste
de pays — conservez la politique et ignorez le constat avec
`rls-check --skip policy-authenticated-tautology`.

### view-bypasses-rls

**La vue contourne la RLS de sa table sous-jacente.** Critique.

Une vue accessible par un rôle non approuvé qui effectue un `SELECT` sur une table protégée par RLS sans
`security_invoker = true`. La vue s'exécute avec les privilèges de son **propriétaire**, elle lit donc la
table de base en tant que propriétaire et les politiques de l'appelant ne sont jamais appliquées. C'est la cause la plus fréquente
de fuite de données sur une table pourtant rigoureusement verrouillée.

```sql
ALTER VIEW "public"."your_view" SET (security_invoker = true);
```

Sur PostgreSQL avant la version 15, cette option n'existe pas, toutes les vues de ce genre adoptent
donc ce comportement. Sur ces versions, le constat est signalé comme heuristique, et la solution consiste à déplacer la logique dans
une fonction ou à mettre à jour PostgreSQL.

Le propriétaire est normalement exempté des politiques de la table de base, mais pas toujours. Lorsque le propriétaire de la vue
n'est pas superutilisateur, ne possède pas `BYPASSRLS` et n'est pas le propriétaire de la table de base (ou la possède
avec `FORCE ROW LEVEL SECURITY`), les politiques s'appliquent à lui. La vue renvoie alors les
lignes que ces politiques accordent au propriétaire, de façon identique pour tous les appelants. Il peut s'agir de moins de lignes
que ce qu'un appelant devrait voir, ou de davantage. L'anomalie reste signalée, car les lignes ne dépendent pas
de l'identité du demandeur, mais de manière heuristique plutôt que certaine. Le correctif reste le même.

### matview-bypasses-rls

**La vue matérialisée expose des données protégées par RLS.** High.

Les vues matérialisées ne peuvent pas implémenter la sécurité au niveau des lignes, et les données qu'elles contiennent représentent
un instantané figé par l'entité qui en a déclenché le rafraîchissement. Si des droits sont accordés à un rôle non approuvé et que sa
requête de définition interroge une table protégée par RLS, aucune politique ne pourra vous protéger — révoquez l'accès ou déplacez
la vue matérialisée dans un schéma hors de portée des rôles non approuvés. Le correctif proposé révoque chaque
droit atteignant un rôle non approuvé, au niveau du rôle ciblé par chaque grant : un grant accordé à un rôle dont
`anon` hérite ne sera pas supprimé par un simple `REVOKE … FROM anon`.

```sql
REVOKE ALL ON "public"."your_matview" FROM "anon";
```

### anonymous-write-allowed

**Les appelants non authentifiés peuvent écrire.** High.

Une politique permissive `INSERT`/`UPDATE`/`DELETE`/`ALL` accessible sans authentification dont
l'expression de validation accepte n'importe quelle ligne, appuyée par un privilège correspondant.

La condition "accepte n'importe quelle ligne" est cruciale et délibérément stricte. Supabase accorde par défaut les pleins droits DML à `anon`
et `authenticated`, une politique ciblant ces rôles ne pose donc pas de problème en soi — un exemple d'école comme
`FOR INSERT TO public WITH CHECK (user_id = auth.uid())` est parfaitement valide
et n'est pas signalé.

Une politique est accessible à un appelant non authentifié via `TO public`, via un rôle nommé
`anon` ou `web_anon`, ou via un rôle dont l'un d'eux est membre : `TO app_writer`
est pris en compte dès lors que `anon` hérite de `app_writer`.

Sur Rebase, il n'existe pas de rôle `anon`. Chaque requête s'exécute en tant que `rebase_user`, y compris
les requêtes anonymes lorsque l'API les autorise (`AUTH_REQUIRE=false`, ou `auth.requireAuth: false`)
et chaque compte invité issu d'une connexion anonyme. La base de données ne pouvant pas déduire ce paramètre, un accès
en écriture accessible uniquement à `rebase_user` est signalé comme heuristique sur Rebase. Lorsque la restriction API est active
et l'accès invité désactivé, seuls les utilisateurs connectés atteignent la politique, et ils peuvent toujours écrire
n'importe quelle ligne. Restreignez la règle d'écriture de la table à l'appelant (un `ownerField`) ou aux `roles`.

### unqualified-column-in-subquery

**Colonne non préfixée au sein d'une sous-requête de politique.** High, heuristique.

Un nom de colonne brut dans une sous-requête `EXISTS`/`IN` qui existe *à la fois* sur la relation interne
et sur la propre table de la politique. Postgres la rattache à la table **interne** ; la corrélation avec
la ligne externe que vous souhaitiez cibler disparaît silencieusement et le prédicat devient trivialement
satisfait — ou trivialement faux, bloquant toutes les lignes pour tout le monde.

```sql
-- L'erreur : `id` se rattache à memberships, et non à organizations
USING (EXISTS (SELECT 1 FROM memberships WHERE id = organizations.id ...))

-- Avec la qualification de table
USING (EXISTS (SELECT 1 FROM memberships m WHERE m.org_id = organizations.id ...))
```

**Ce que le catalogue affiche n'est pas ce que vous avez écrit.** `pg_policies.qual` est la représentation
reconstruite par Postgres de l'arbre syntaxique, et il préfixe toujours les références de colonnes au sein d'une
sous-requête ; le nom brut n'est donc plus visible au moment où le catalogue est lu. Ce qui subsiste
est sa conséquence : le `org_id` brut a été lié à la table interne, et le prédicat
enregistré compare la colonne de cette table avec elle-même —
`m.org_id = m.org_id`. C'est cette auto-comparaison que la vérification traque sur une base active.

**L'absence de ce constat ne prouve pas l'absence de bug.** Un nom brut comparé à une colonne interne
*différente* (`organization_id = id`) sera stocké comme `m.organization_id = m.id`,
ce qui ressemble en tout point à une comparaison voulue. Lorsque cette vérification se déclenche, elle fournit une
preuve formelle ; lorsqu'elle reste muette, elle ne garantit rien.

### junction-table-unprotected

**Table de jointure plusieurs-à-plusieurs sans RLS.** High, heuristique.

Une table qui se résume essentiellement aux deux extrémités de deux clés étrangères pointant toutes deux
vers des tables *protégées* par RLS, sans sécurité au niveau des lignes pour elle-même — et accessible en lecture
ou en écriture par un rôle utilisé par un appelant non approuvé. Les deux côtés de la relation
sont verrouillés mais la liaison intermédiaire reste ouverte — ce qui suffit pour énumérer la relation
alors même qu'aucune des tables cibles ne peut être lue.

Cette détection est heuristique car une table de jointure est déduite à partir de sa structure. Si la vôtre doit rester délibérément
publique, utilisez `--skip junction-table-unprotected`.

### rls-enabled-not-forced

**RLS activée mais non forcée pour le propriétaire de la table.** Medium, high ou critical.

Sans la clause `FORCE`, le propriétaire de la table n'est pas soumis à ses propres politiques, de même que n'importe quel membre
du rôle propriétaire. Cela ne pose pas de problème quand le propriétaire est un rôle technique d'administration auquel personne
ne se connecte, mais cela devient critique si votre application se connecte avec ce compte — la sévérité est donc **critical** lorsqu'un
rôle utilisé par un appelant non approuvé possède la table ou fait partie du rôle propriétaire,
**high** lorsque le rôle propriétaire peut se connecter ou qu'un rôle pouvant le faire en est membre, et
**medium** dans les autres cas.

Si le propriétaire est un superutilisateur ou dispose de `BYPASSRLS`, le niveau reste medium et l'indique clairement : la commande `FORCE`
ne peut pas contraindre un tel rôle, et prétendre le contraire serait trompeur.

```sql
ALTER TABLE "public"."your_table" FORCE ROW LEVEL SECURITY;
```

### rls-enabled-no-policies

**RLS activée sans aucune politique.** Medium.

Il ne s'agit pas d'une faille de sécurité, bien au contraire. La RLS activée sans politique interdit l'accès à toutes
les lignes pour tout le monde excepté le propriétaire. L'anomalie est signalée car elle provoque un dysfonctionnement *silencieux* : l'API renvoie `[]`, et
une table vide est indiscernable d'une table dont les lignes sont filtrées. Ce cas de figure a déjà causé l'exposition
silencieuse de tables vides en production pendant des semaines.

### policy-role-unreachable

**Les politiques ciblent des rôles auxquels personne ne se connecte.** Medium.

Toutes les politiques sur la table référencent des rôles qui n'existent pas, ne peuvent pas se connecter et dont aucun rôle
de connexion n'hérite de façon transitive. Les politiques paraissent correctes mais ne s'appliquent à personne, ce qui rend
la table apparemment vide à la lecture.

Le cas typique correspond à des politiques écrites avec `TO authenticated` — une convention propre à Supabase — sur une base
de données dont les requêtes proviennent en réalité d'un tout autre rôle.

### grant-to-public

**Privilèges de table accordés à PUBLIC.** Medium.

Un privilège DML accordé à `PUBLIC`, sur une table ou une table étrangère. Même avec la RLS activée, cela
étend le périmètre des utilisateurs pour lesquels les politiques sont évaluées, ce qui n'est pratiquement jamais souhaité.

```sql
REVOKE ALL ON "public"."your_table" FROM PUBLIC;
```

### security-definer-mutable-search-path

**Fonction SECURITY DEFINER avec un search_path modifiable.** Medium.

La fonction s'exécute avec les privilèges de son créateur — souvent un superutilisateur — tandis que l'appelant garde le contrôle
sur la résolution de ses identifiants. Il s'agit du scénario classique d'élévation de privilèges : tout ce que
la routine manipule est lu avec les droits du propriétaire, contournant ainsi la RLS.

```sql
ALTER FUNCTION "public"."your_function"() SET search_path = pg_catalog, public;
```

### current-setting-throws

**La politique appelle `current_setting()` sans le paramètre `missing_ok`.** Low, heuristique.

`current_setting('app.tenant_id')` avec un seul argument *déclenche une exception* lorsque le paramètre n'est pas défini,
au lieu de renvoyer `NULL`. Ainsi, au lieu de masquer la ligne, la requête échoue en erreur — l'appelant
reçoit une erreur 500 plutôt qu'un résultat vide, et un middleware réessayant sur du 5xx relancera indéfiniment une requête
qui ne pourra jamais aboutir.

```sql
ALTER POLICY "your_policy" ON "public"."your_table"
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
```

## Ce que cet outil ne fait pas

Être transparent sur ses limites est indispensable — un outil de sécurité qui surestime sa couverture est
pire que l'absence d'outil.

- **Il s'agit d'un audit statique de catalogue.** Il consulte `pg_class`, `pg_policies`, `pg_depend` et
  les tables associées. Il ne se connecte pas avec votre rôle `anon` pour tenter de lire vos données, il ne peut donc pas
  garantir qu'une exposition soit concrètement exploitable depuis votre API.
- **Il ne peut pas prouver la justesse fonctionnelle d'une politique.** Il recherche des structures identifiées comme erronées. Une
  politique validant l'ensemble des vérifications peut malgré tout formuler une mauvaise règle métier.
- **Un rapport vierge ne constitue pas une certification de sécurité.** En particulier, reportez-vous à la section sur
  [unqualified-column-in-subquery](#unqualified-column-in-subquery) : Postgres réécrit les expressions
  des politiques, certains dysfonctionnements ne sont donc plus du tout décelables au niveau du catalogue.
- **Il ne contrôle pas l'authentification applicative**, les clés d'API, l'exposition réseau,
  la gestion des secrets, ni aucun élément extérieur à la base de données.

## Voir aussi

- [Sécurité au niveau des lignes](/docs/collections/security-rules) — le paramètre `rls` d'une table Rebase, qui
  génère les politiques auditées par cet outil.
- [Backend only](/docs/getting-started/headless/) — pourquoi une table sans politique n'est
  absolument pas exposée dans un projet headless.
- [API REST](/docs/backend/api/) — la surface de données qu'une politique permissive expose.
