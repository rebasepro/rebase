---
sourceHash: f2cfc1c2f8667566
title: Rebase Cloud
sidebar_label: Rebase Cloud
description: Rebase Cloud est le même Rebase, opéré pour vous. Ce qu'il est, comment lier et déployer un projet, et ce que la bêta privée n'inclut pas encore.
---

Rebase Cloud exécute le même Rebase open source que vous auto-hébergeriez — la même
image publiée `rebasepro/server`, le même bundle, le même Postgres. La
différence réside dans qui l'opère.

:::note[Bêta privée]
Rebase Cloud est en **bêta privée**. Il fait tourner de véritables tenants aujourd'hui et s'ouvre par
vagues. [Demander un accès](https://rebase.pro/pricing).

Il n'est pas en libre-service ; les commandes ci-dessous nécessitent donc un compte ayant obtenu l'accès.
Tout le reste sur ce site fonctionne sans compte.
:::

## De quoi s'agit-il

Un **projet** Cloud correspond à trois éléments que la plateforme gère pour vous :

| | Ce que vous obtenez |
|---|---|
| **App** | Votre bundle, tournant sur l'image de runtime publiée. Les déploiements sont un téléversement de bundle, pas une compilation de conteneur |
| **Base de données** | Un PostgreSQL managé, avec sauvegardes automatisées et restauration à un instant précis (point-in-time recovery) |
| **Stockage** | Votre propre bucket sur [Rebase Storage](/docs/deployment/rebase-storage/), si votre projet utilise le stockage de fichiers |

L'application et la base de données sont provisionnées lors de votre premier déploiement ; un bucket uniquement
lorsque vous en demandez un ([Stockage de fichiers](#stockage-de-fichiers)). Chacun est facturé en fonction de ce qu'il
réserve plutôt que par utilisateur (seat).

**Rien ne change dans votre projet pour y fonctionner.** Le même dépôt
s'auto-héberge avec `docker compose`, et l'échappatoire est bien réelle : `rebase build`
génère un bundle qui démarre partout où l'image de runtime s'exécute.

## Lier un projet

Depuis le répertoire d'un projet :

```bash
rebase cloud login
rebase cloud billing setup
rebase cloud projects create --name "My app" --subdomain my-app --link
```

`login` ouvre la console dans votre navigateur et affiche un code court. Vérifiez que
la console affiche le même code, et validez la connexion à cet endroit : le terminal
récupère la session et l'enregistre dans `~/.rebase/credentials.json`. Si vous n'êtes
pas connecté à la console, connectez-vous-y d'abord avec le service de votre choix, Google
et GitHub inclus. Via SSH, `rebase cloud login --no-browser` affiche le lien
à ouvrir sur votre propre machine.

`projects create` ne prend aucun argument positionnel. Le nom et le sous-domaine sont
des options (flags), et tous deux sont obligatoires — dans un terminal, ils vous sont demandés,
et une exécution non interactive qui omet l'un ou l'autre se termine par `input_required` plutôt que d'en inventer
un. **Le sous-domaine n'est pas modifiable par la suite :** il s'agit de l'hôte
`<slug>.rebase.website` sur lequel le projet répond, choisissez-le donc méticuleusement.

`--link` associe ce répertoire au projet au sein du même appel, évitant ainsi une étape
`link` séparée. Il écrit `.rebase/cloud.json`, qui enregistre l'identifiant et le slug du projet.
Ce fichier n'est pas un secret et ne contient pas vos identifiants — ceux-ci résident
dans `~/.rebase/credentials.json`, créé par `login`.

Il est néanmoins versionné avec le code, de sorte qu'un dépôt cloné puisse désigner n'importe
quel plan de contrôle. Lorsque l'hôte provient uniquement de ce fichier, et qu'il ne s'agit ni de celui
de la plateforme ni d'un hôte auquel vous vous êtes déjà connecté auparavant, `login` le nomme et demande confirmation
avant de lui envoyer votre e-mail et votre mot de passe. Sans terminal, ou avec
`--json`, il refuse avec `unknown_control_plane` ; passez `--url <host>` (ou définissez
`REBASE_CLOUD_URL`) pour vous y connecter explicitement.

Pour vous connecter sans navigateur, renseignez votre e-mail : `rebase cloud login --email
me@example.com` vous demande votre mot de passe. **Inscrit avec Google, GitHub ou
LinkedIn ?** Votre compte ne possède pas de mot de passe, utilisez donc un code à la place :

```bash
rebase cloud login --code --email me@example.com
```

Le plan de contrôle vous envoie par e-mail un code à 6 chiffres, valable dix minutes, que vous saisissez
à l'invite. Avec `--email` et sans mot de passe, `rebase cloud login` vous demande
s'il faut utiliser votre mot de passe ou un code. L'envoi de codes nécessite que le plan de contrôle soit en mesure d'envoyer des
e-mails ; si ce n'est pas le cas, `--code` l'indique et se termine avec `otp_unavailable`.

Si vous avez activé l'authentification à deux facteurs, `login` vous demande ensuite le code de
votre application d'authentification, ou l'un de vos codes de secours, quelle que soit la méthode de connexion
utilisée. Via le navigateur, la console vous le demande lors de votre authentification. Ni un code de connexion ni un second facteur ne peuvent être saisis sans terminal.
Pour un script, créez un jeton d'accès dans la console (**Settings → Access
tokens**) et définissez `REBASE_TOKEN` ; consultez [CI et agents](/docs/deployment/cloud-agents/#ci-and-agents).

Un mot de passe erroné renvoie `invalid_credentials` avec les deux mêmes méthodes de connexion, étant donné
que la cause habituelle est un compte n'en ayant jamais eu.

`billing setup` associe une carte à l'organisation, une seule fois. Cette commande est intentionnellement placée
en premier dans la séquence : le premier déploiement d'un projet est refusé sans moyen de paiement, et
le découvrir après la fin du téléversement d'un bundle est particulièrement frustrant.

Par la suite, la page **Billing** de la console répertorie les factures de l'organisation,
chacune avec la page hébergée et le PDF Stripe, et donne un aperçu de la prochaine facture de chaque
projet. `rebase cloud billing invoices` et `rebase cloud billing upcoming`
affichent les mêmes informations. Tous deux s'adressent aux propriétaires et administrateurs de l'organisation. Lorsque la
plateforme le propose, **Manage billing** ouvre le portail client Stripe pour gérer
la carte, les coordonnées de facturation et les factures passées.

Avec une carte déjà enregistrée, créer un autre projet dans la console ne requiert
aucun paiement supplémentaire : le projet est facturé sur cette carte et déployé. Si la carte
est refusée, ou si la banque exige une confirmation du paiement, la console vous redirige vers
**Billing**, où **Fix your card** permet d'enregistrer une autre carte et **Complete the
payment** ouvre la facture Stripe.

L'utilisation d'un projet apparaît sur sa vue d'ensemble, sous **Usage this month**, ainsi
que pour l'ensemble des projets sur la page **Billing** : requêtes consommées par rapport au quota
inclus (la barre devient orange à 80 %), erreurs 5xx, dépassement actuel
et projection pour la fin du mois à ce rythme. Le dépassement est calculé par
le même code qui le transmet à Stripe, c'est donc ce montant qui figurera sur la facture ; il
apparaît sur la facture du mois suivant. `rebase cloud usage` affiche la
même chose, et `rebase cloud usage org` pour toute l'organisation. Tout membre peut
le consulter. Les chiffres précisent ce qui n'est pas encore visible : le stockage d'objets est mesuré mais
pas encore facturé ([Rebase Storage](/docs/deployment/rebase-storage/) indique son
tarif) ; tant qu'un projet exécute deux pods applicatifs ou plus,
ses requêtes ne sont pas comptabilisées ; et une journée avec des échantillons manquants entraîne un sous-comptage. Un
projet avec autoscaling affiche également les pods exécutés au-delà de `--replicas`, en heures-pods,
ce qu'ils coûtent selon ses propres tarifs et si cette plateforme les facture déjà. Un
projet réclamé depuis un agent ne compte que les jours à partir de la réclamation : avant
celle-ci, le projet appartenait à la plateforme.

Un projet existant peut être lié sans avoir à en créer un nouveau :

```bash
rebase cloud projects list
rebase cloud link --project my-app
```

## Déployer

```bash
rebase cloud deploy
```

Une seule commande, et aucune option à retenir. Le fichier `rebase.json` d'un projet initialisé déclare
`runtime: "managed"` pour son backend, et `deploy` lit cette déclaration — il
l'indique au passage (`rebase.json declares runtime: managed — deploying a
bundle`), compile l'application dans `dist-bundle`, téléverse le bundle, l'exécute sur
l'image de runtime publiée, et suit le déploiement jusqu'à son état final. Le code de
sortie sert de verdict, ainsi la même ligne fonctionne de manière autonome en CI.

Elle se termine en indiquant où chaque application répond désormais et si la nouvelle version y
est active :

```text
  ✓ Deployed songbuzz in 1m 12s  (deployment fb3c7442-9937-4179-8d3c-88a106da149d)

    game     static   https://songbuzz.rebase.website      live
    backend  backend  https://songbuzz.rebase.website/api  live

  ✓ Live: the new version answers on every address above.
  Something wrong? `rebase cloud rollback` puts the previous deployment back.
```

« Live » signifie que l'adresse a répondu après le build : le `/health` d'un backend a
renvoyé `ok`, et la page d'une application statique s'est chargée (depuis ce déploiement, lorsque la
plateforme la dessert). La vérification attend jusqu'à `--live-timeout` secondes, 60 par
défaut ; `0` l'ignore. Si une application ne répond pas à temps, le déploiement se termine tout de même avec
un code zéro, car le déploiement a réussi, et la dernière ligne précise quelle application n'a pas
répondu et pourquoi. Un déploiement en échec se termine plutôt sur une seule ligne, précisant l'application et la
raison, avec `rebase cloud logs` pour consulter l'intégralité du journal de build.

Les scripts peuvent utiliser `--json` pour obtenir un objet unique contenant les mêmes informations — `apps`, `hosts`,
`live`, `liveChecks`, `durationMs` et l'identifiant du déploiement. Contrairement au reste de
`rebase cloud`, `deploy` ne bascule pas automatiquement au format JSON lorsqu'il est redirigé via un tube (pipe).

Ce que ce runtime permet — paquets et modules natifs, mémoire et instances,
timeouts et tailles de corps, système de fichiers, secrets, stockage et réseau
sortant — est décrit sur sa propre page :
[Runtime backend managé](/docs/deployment/managed-runtime/).

Pour déployer un artefact compilé précédemment — par exemple dans un job CI qui compile une fois et
déploie deux fois —, pointez vers le répertoire au lieu de recompiler :

```bash
rebase build
rebase cloud deploy --bundle-dir dist-bundle
```

Sortir du runtime managé s'effectue via une option dédiée, `--eject`, et rien d'autre ne le
demande : un build qui ferait passer un projet managé sur une image de conteneur dont il
devient responsable est refusé tant que vous ne l'avez pas explicitement confirmé. `--force` avait autrefois ce rôle,
ce qui regroupait l'action la moins réversible de la CLI sous le même terme que « écraser ce
fichier » ; il s'agit désormais d'une option inconnue plutôt que d'un alias, de sorte qu'un script l'employant
s'interrompra.

### La vérification de syntaxe avant le téléversement

Les fichiers d'une application statique sont servis exactement tels quels. Lorsque son `build` se contente
de copier des scripts écrits manuellement dans `output`, aucun parseur ne les a vérifiés, et un fichier
contenant une coquille part en production et empêche le chargement de la page. C'est pourquoi, avant tout
téléversement, `deploy` analyse chaque fichier `.js`, `.mjs` et `.cjs` dans le dossier `output` de chaque
application statique, ainsi que chaque `<script>` inline de ses fichiers `.html`. Cela
s'applique tant aux applications statiques déployées individuellement qu'à celles intégrées dans le
bundle du backend. Une erreur de syntaxe interrompt le déploiement en indiquant le fichier, la ligne et la colonne :

```
✗ A syntax error in the static output, so nothing was deployed:
    web/cloud.js:42:23  Unexpected token
        42 |     return fetch("/api";
Fix it and deploy again, or pass --no-verify to deploy anyway.
```

Avec `--json`, le champ `code` de l'erreur est `syntax_error`. Les scripts inline qu'un navigateur
n'exécute pas en tant que JavaScript sont ignorés : JSON, import maps, templates et tout
autre `type` non-JavaScript, un `<script src>`, ainsi qu'un script contenant encore du
balisage de template non rendu tel que `{{ }}`. Un fichier `.js` est accepté s'il est valide
soit en tant que script classique, soit en tant que module, le choix final revenant à la page. Rien dans
`node_modules` n'est lu, pas plus qu'un `--bundle-dir` précompilé.
`--no-verify` permet d'ignorer cette vérification pour un déploiement spécifique.

Suivez son exécution :

```bash
rebase cloud logs               # the build log
rebase cloud logs --runtime -f  # what the running app prints, live, until Ctrl-C
rebase cloud status             # what the platform thinks the project is doing
```

`status` indique `blockedOn` et `nextAction`. Lorsque `blockedOn` est `null`, la
plateforme travaille activement et scruter l'état (polling) est le bon comportement ; lorsqu'il mentionne
un élément, c'est que cet élément attend une action de votre part.

L'un d'eux est `email_not_configured` : l'application a activé l'authentification par magic-link ou par code
e-mail (`AUTH_MAGIC_LINK`, `AUTH_EMAIL_OTP`) mais ne dispose d'aucun service d'e-mail configuré ; le déploiement est donc en ligne mais
personne ne peut s'y connecter. Rebase Cloud n'envoie pas d'e-mails à la place de votre application : définissez `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` et
`SMTP_FROM` avec `rebase cloud env set`, puis déployez. `status` lit cette information depuis l'endpoint
`GET /api/auth/config` de l'application elle-même (son champ `unavailable`), et `deploy` affiche
la même remarque sous sa vérification de disponibilité.

## Plus d'une base de données

Le PostgreSQL managé d'un projet est un **serveur de bases de données**, et il peut héberger plusieurs
bases de données. Déclarez chacune d'elles dans votre code, comme vous le feriez n'importe où ailleurs
([Bases de données et buckets multiples](/docs/backend/multiple-sources/)) :

```ts
// backend/resources.ts
import { database } from "@rebasepro/types";

export const main = database();
export const analytics = database("analytics");
```

Au déploiement suivant, la plateforme crée une base de données nommée `analytics` sur le serveur
du projet et la lie à votre application sous le nom `DATABASE_URL__ANALYTICS`, la même variable que lit
un backend auto-hébergé. Rien d'autre ne change :

- **Facturation.** Toutes les bases de données du serveur partagent son CPU, sa mémoire et son disque,
  qui constituent ce qui est facturé au projet. Une deuxième base de données ne coûte rien en soi ; les
  données qu'elle contient font grossir le disque, et le disque est facturé selon sa taille.
  Dimensionnez le serveur pour l'ensemble d'entre elles sous **Compute**.
- **Sauvegardes et restauration.** Elles font partie des sauvegardes du serveur et le suivent lors d'une
  [restauration à un instant précis](#restaurer-la-base-de-données-à-un-instant-précis-pitr).
- **Connexion.** `rebase cloud db list` les affiche, et `db info`, `db connect`
  et `db query` acceptent `--database <key>` :

  ```bash
  rebase cloud db connect --database analytics
  ```

- **Suppression.** Un déploiement ne supprime jamais une base de données. Une base que votre code cesse
  de déclarer reste sur le serveur jusqu'à ce que vous exécutiez `rebase cloud resources prune database analytics`.

Une variable que vous définissez vous-même l'emporte : avec votre propre `DATABASE_URL__ANALYTICS` dans
l'environnement du projet, la plateforme ne crée rien pour cette clé. Sur un projet qui apporte son propre
serveur de bases de données, aucune base n'est créée ; définissez plutôt une `DATABASE_URL__<KEY>`
pour chacune.

## Stockage de fichiers

Un nouveau projet ne possède aucun bucket : les téléversements sont rejetés avec l'erreur `501 STORAGE_NOT_CONFIGURED`,
et le récapitulatif du déploiement le signale, plutôt que d'écrire sur un disque remplacé à chaque déploiement.

Associez-lui l'une des deux options suivantes, puis déployez à nouveau pour que l'application la prenne en compte :

```bash
# A bucket Rebase runs for you. The console's Storage page does the same.
rebase cloud storage create

# Or your own S3-compatible bucket: AWS S3, Cloudflare R2, Backblaze B2, MinIO…
rebase cloud storage attach --bucket <name> \
  --access-key-id <id> --secret-access-key <secret> \
  --endpoint <url>        # omit for AWS; add --force-path-style for MinIO

rebase cloud deploy
```

`rebase cloud storage` liste les buckets du projet. Un projet peut en avoir autant qu'il en déclare :
dès que son bucket par défaut tourne sur Rebase Storage, chaque `bucket("media")` de son code obtient son
propre bucket au déploiement suivant, lié sous `S3_BUCKET__MEDIA` et le reste de ses variables `__MEDIA`.
Les octets stockés sont mesurés par projet, sur l'ensemble de ses buckets
([Rebase Storage](/docs/deployment/rebase-storage/) indique à partir de quand ils sont facturés). Avec vos
propres buckets, attachez chacun d'eux avec `--source <key>` ; un projet configurant son stockage dans le code n'a besoin ni de l'un ni de l'autre.

## Prévisualiser une modification

```bash
rebase cloud deploy --preview
```

Cette commande compile et téléverse exactement la même chose que `deploy`, mais le rend accessible à une adresse
propre, par exemple `https://shop--k3x9ab.rebase.website`. La production continue
de servir ce qu'elle servait auparavant. Le déploiement affiche l'adresse de la prévisualisation une fois
la compilation achevée.

Pour conserver une adresse identique entre plusieurs déploiements, nommez la prévisualisation. Déployer avec le même nom
la mettra à jour :

```bash
rebase cloud deploy --preview-name new-checkout
```

Les services avec lesquels une prévisualisation communique dépendent de ce qui a été déployé :

- **`rebase cloud deploy --preview`** prévisualise le backend, avec ses applications statiques
  intégrées, exactement comme la production les exécute. Il bénéficie de son propre backend sur
  une **base de données vide dédiée**, jamais celle de production. Démarrer sur la base
  de données de production y appliquerait le schéma et les règles d'accès de la prévisualisation.
- **`rebase cloud deploy web --preview`** prévisualiserait une application statique isolée,
  ses pages appelant le backend de **production**. Cela requiert un plan de contrôle
  capable de servir des sites statiques de manière autonome, ce que Rebase Cloud ne prend pas encore en charge : il
  refuse avec `PREVIEW_STATIC_UNSERVED` et ne publie rien. Prévisualisez plutôt le
  backend, qui dessert les applications statiques qui y sont intégrées ; un projet dépourvu
  de backend managé ne peut pas être prévisualisé pour le moment.

Une prévisualisation ne téléverse aucun code source et n'enregistre aucune application ni aucun nom d'hôte, car chacun
d'eux modifierait le projet de production. `--source` et `--eject` ne peuvent pas être
associés à `--preview`. Tous deux compilent une image de conteneur pour la production.

```bash
rebase cloud previews                      # name, address, app, backend, expiry
rebase cloud logs --preview new-checkout   # its build log; -f follows a build still running
rebase cloud logs --runtime --preview new-checkout -f  # what its backend prints
rebase cloud previews delete new-checkout  # stops serving it and drops its database
```

`rebase cloud logs` sans l'option `--preview` concerne toujours la production.

La page **Deployments** de la console liste ces mêmes prévisualisations, et permet d'ouvrir, de consulter le
journal de build ou de supprimer chacune d'elles. La création reste quant à elle une étape CLI.

Une prévisualisation expire une semaine après son dernier déploiement.

Une fois terminé, le déploiement vérifie que l'adresse de la prévisualisation répond, à l'instar d'un
déploiement en production (`--live-timeout <seconds>`, `0` pour ignorer). La génération du certificat d'une nouvelle
prévisualisation pouvant prendre une ou deux minutes, un déploiement réussi peut
indiquer que l'adresse ne répond pas encore.

Une prévisualisation de backend est facturée comme une unité d'application à la taille par défaut (100m de CPU
et 384 Mio de mémoire, au tarif appliqué à votre application pour sa région et sa capacité),
au prorata de sa durée de vie, et apparaît dans le devis
mensuel du projet au sein de la console. `rebase cloud deploy --preview` affiche cette même estimation
par mois (`cost` sous `--json`). En démarrer une exige une carte enregistrée, tout comme
un déploiement en production. Un premier déploiement qui
échoue avant que quoi que ce soit ne s'exécute est supprimé sans être facturé. Un projet peut exécuter
jusqu'à trois prévisualisations de backend simultanément.

Chaque nouvelle adresse de prévisualisation reçoit son propre certificat TLS émis par Let's Encrypt,
qui accorde 50 nouveaux certificats par semaine pour un domaine, partagés avec l'ensemble des sites
de production hébergés dessus. Les prévisualisations peuvent en consommer 20 par tranche de 7 jours, pour toute la plateforme. Au-delà,
toute nouvelle prévisualisation est rejetée (`429`, `preview_cert_budget`) en indiquant le moment où elle pourra
être déployée ; redéployer une prévisualisation existante n'est jamais décompté.

La base de données d'une prévisualisation de backend est une seconde base de données sur l'instance Postgres de **production** :
elle dispose de ses propres données, mais partage la même instance et le même disque. Elle est restreinte à 10
connexions, afin que les prévisualisations n'épuisent pas celles de la production, et plafonnée à 2 Go : une prévisualisation
dont la base dépasse ce volume est suspendue. Son backend s'arrête, son adresse cesse
de répondre, `rebase cloud previews` ainsi que la console l'affichent comme `paused` avec le
motif, et les propriétaires et administrateurs du projet en sont notifiés (`preview.paused`). Ses
données sont préservées jusqu'à son expiration. Déployez-la à nouveau pour la relancer (elle sera suspendue à nouveau
si la base reste trop volumineuse), ou supprimez-la. Une prévisualisation en pause reste
facturée jusqu'à sa suppression ou son expiration. Supprimez les prévisualisations devenues inutiles. Les extensions installées en production ne sont pas
installées dans la base de données d'une prévisualisation.

Le déploiement des prévisualisations est progressif. Un plan de contrôle ne les prenant pas encore en charge refusera
`--preview` avec le code `previews_unavailable` et ne déploiera rien.

## Rollback

```bash
rebase cloud deployments
rebase cloud rollback
```

Un rollback réoriente le projet vers ce qu'un précédent déploiement réussi avait
publié, et ne recompile jamais — tout l'intérêt d'un rollback réside dans le fait de distribuer un
artefact qui a déjà tourné avec succès.

Les déploiements éligibles dépendent du mode de déploiement du projet, et les deux approches
fonctionnent :

| Mode de déploiement | Ce qui est restauré |
|---|---|
| `rebase cloud deploy` (build depuis les sources) | L'image publiée par ce build |
| `rebase cloud deploy --bundle` (runtime de la plateforme) | Le bundle livré par ce déploiement, sur la version de runtime actuellement utilisée par le projet |

Les applications statiques intégrées dans le bundle du backend (un simple `rebase cloud deploy` sur un
projet avec backend) font partie intégrante de ce bundle ; elles font donc l'objet du rollback en même temps que lui.

Une application statique déployée indépendamment (`rebase cloud deploy <app>`) ne peut pas faire l'objet d'un rollback
pour l'instant. Son déploiement enregistre l'application publiée, mais aucun bundle ; le
plan de contrôle ne dispose donc d'aucune source pour la restaurer. La solution consiste à déployer à nouveau la dernière
version fonctionnelle, par exemple depuis le commit précédant l'erreur. Après un tel
déploiement, `deploy` signale cette situation au lieu d'orienter vers `rollback`, et exécuter `rollback`
sans identifiant refuse l'opération plutôt que de redéployer le backend en cours d'exécution.

Un rollback nécessite donc un déploiement ayant consigné l'un de ces deux artefacts, ce qui implique un
projet ayant été déployé avec succès au moins deux fois. `rebase cloud deployments`
met en évidence ceux qui sont éligibles, et `--json` renvoie `rollbackable` par ligne ainsi
que l'`image` ou le `bundle` qui serait restauré.

Deux types de déploiements sont refusés, la CLI précisant lequel est concerné : un déploiement qui n'a pas abouti,
et un déploiement antérieur à la prise en charge de l'enregistrement des artefacts par la plateforme. Rien ne peut être
laissé au hasard dans un cas comme dans l'autre — deviner reviendrait à livrer ce qui a été compilé ou téléversé le plus
récemment tout en prétendant restaurer celui-ci — déployez donc plutôt la version désirée.

Chaque déploiement réussi se termine en indiquant la commande de retour en arrière (`rebase cloud rollback`),
afin qu'elle reste bien en vue dès lors qu'une version défectueuse est identifiée.

Un rollback ajoute un nouveau déploiement plutôt que de réécrire l'historique, et attend que
la version restaurée réponde avant de confirmer le succès. Suivez l'opération avec
`rebase cloud logs -f`.

## Restaurer la base de données à un instant précis (PITR)

Une base de données managée peut être restaurée à n'importe quelle minute comprise dans sa fenêtre de rétention,
depuis **Database → Backups** dans la console ou via la CLI :
`rebase cloud db pitr status | restore --target <ISO> | cutover | discard`.
L'opération se déroule en deux étapes. Tout d'abord, une copie restaurée est préparée aux côtés de la base de données en production ;
votre application continue de tourner sur la base active, et le stockage de la copie vous est facturé jusqu'à
ce que vous procédiez au basculement (cutover) ou que vous l'abandonniez (discard).
Ensuite, une fois la copie prête, le basculement redirige l'application vers celle-ci et la redémarre.
Toutes les écritures postérieures à l'heure cible ne figureront pas dans la copie. La base de données
d'origine est conservée comme voie de repli et son stockage continue d'être facturé ; revenir en arrière,
la supprimer ou demander une seconde restauration nécessite de contacter le support. Seul un propriétaire ou un administrateur
peut préparer, basculer ou abandonner la copie, et la console demande de saisir le nom du projet
avant de valider le basculement.

## Sécuriser votre compte

Votre compte console permet d'accéder aux bases de données de production, aux secrets et à la facturation ;
protégez-le en conséquence. Ouvrez **Account security** depuis le menu situé sous votre avatar
dans la console (ou rendez-vous sur `/account`). Cette page vous est propre et ne dépend pas d'une
organisation : les réglages définis s'appliquent à l'ensemble des organisations auxquelles vous appartenez.

- **Validation en deux étapes.** Activez-la avec l'application d'authentification de votre choix (1Password,
  Google Authenticator, Authy). La page présente une clé de configuration à ajouter dans l'application, ou un
  lien ouvrant l'application avec la clé préremplie sur mobile, puis demande
  le code à 6 chiffres affiché par l'application. Dès lors, chaque connexion exigera un code,
  que vous vous connectiez par mot de passe, Google ou GitHub.
- **Codes de secours.** L'activation génère dix codes à usage unique, présentés une seule fois.
  Chacun d'eux permet de vous connecter en lieu et place du code de l'application si vous perdez votre
  téléphone ; enregistrez-les donc avant de fermer la boîte de dialogue. **New recovery codes**
  les remplace, invalidant immédiatement les anciens. La désactivation de la validation en deux étapes
  tout comme la génération de nouveaux codes exigent préalablement la saisie d'un code.
- **Mot de passe.** Le modifier vous déconnecte de tous les autres appareils. Un compte
  créé via Google, GitHub ou LinkedIn ne possède pas de mot de passe ; la page propose de
  vous envoyer un lien par e-mail afin d'en définir un.
- **Appareils connectés.** L'ensemble des navigateurs et terminaux connectés à votre compte,
  avec leur adresse IP et la date de connexion. Déconnectez tout appareil que vous ne
  reconnaissez pas, ou déconnectez-les tous simultanément.

Les [jetons d'accès](/docs/deployment/cloud-agents/#ci-and-agents) ne constituent pas des sessions et ne requièrent aucun second
facteur ; la CI continuera donc de déployer une fois l'authentification à deux facteurs activée. Révoquez tout jeton auquel vous ne
faites plus confiance sous **Settings → Access tokens**.

## Inviter votre équipe

**Members → Add member** permet d'ajouter une personne disposant déjà d'un compte Rebase avec
une adresse e-mail vérifiée, en tant qu'administrateur ou membre ; un propriétaire pourra ensuite lui attribuer le rôle de propriétaire.
L'accès est immédiat et aucun e-mail n'est envoyé. Rebase Cloud n'envoie pas encore d'invitations ;
demandez donc à un collaborateur sans compte de s'inscrire et de
faire vérifier son adresse au préalable. Depuis un terminal :
[`rebase cloud orgs members invite <email>`](/docs/cli/cloud/#organizations), qui
vous préviendra si l'adresse ne correspond à aucun compte existant.

## Accès Cloud et utilisateurs de votre application

Deux groupes d'utilisateurs distincts interviennent, comme sur Firebase ou Supabase :

- **L'accès Cloud** détermine qui peut intervenir sur le projet dans Rebase Cloud. Les
  propriétaires et administrateurs d'une organisation sont `admin` sur chaque projet qu'elle détient, et
  ses membres sont `developer`. Un projet peut également accorder un rôle propre à une personne
  donnée, `admin`, `developer` ou `viewer`, par le biais d'une invitation par e-mail, sans
  l'ajouter comme membre de l'organisation. Le rôle le plus élevé prévaut.
  [`rebase cloud access`](/docs/cli/cloud/#project-access) permet de gérer ces accès.
- **Les utilisateurs de votre application** résident dans la base de données propre à l'application, avec son propre système d'inscription
  et ses rôles. Cloud ne les liste ni ne les modifie jamais.

L'unique point de jonction est le bouton **Open admin panel**. Il connecte une personne disposant d'un
accès Cloud `admin` au panneau d'administration de l'application, via la correspondance de son adresse e-mail vérifiée : l'application
retrouve ou crée le compte associé à cette adresse, lui attribue le rôle `admin`,
et consigne que ce rôle provient de Rebase Cloud (l'interface Users & roles de Studio
l'indique). Si cette personne perd son accès Cloud `admin` au projet, Rebase
Cloud demande à l'application de révoquer ce rôle `admin`
et met fin à ses sessions dans l'application. Un rôle octroyé manuellement dans l'application,
y compris un statut `admin` détenu avant la première utilisation de Open admin panel, est préservé, et le
compte n'est jamais supprimé.

## Suivre l'activité

La page **Activity** de la console ainsi que la commande `rebase cloud activity` permettent aux
propriétaires et administrateurs de l'organisation de voir qui a déployé, défini ou consulté une variable
d'environnement (par son nom, jamais par sa valeur), modifié un domaine, restauré une sauvegarde,
redimensionné, interrompu ou supprimé un projet, mis à jour le rôle d'un membre ou créé un
jeton, ainsi que la date associée. L'onglet **Settings** d'un projet renvoie à ses propres entrées ; les événements
liés à un projet supprimé restent conservés. Un script peut les consulter à l'aide d'un jeton configuré avec
la permission `--can audit` sur l'organisation. Les entrées sont conservées pendant un an. Les options de filtrage sont détaillées dans
[`rebase cloud`](/docs/cli/cloud/#organizations).

## CI et agents

Un job CI ou un agent ne doit pas détenir votre mot de passe. Attribuez-lui un jeton restreint à
quelques actions sur un projet spécifique, généré depuis un terminal authentifié via
`rebase cloud tokens create --project shop --can deploy,logs`, et définissez-le dans
`REBASE_TOKEN`. La facturation, le journal d'activité et les paramètres de notification
d'une organisation constituent des permissions distinctes (`--can billing`, `audit`,
`notifications`) qu'un jeton ne détient que si elles sont expressément requises. Le détail des permissions, un
exemple de workflow GitHub Actions ainsi que ce qui reste rattaché à une personne authentifiée sont décrits dans
[CI et agents](/docs/deployment/cloud-agents/#ci-and-agents).

## Un backend sans compte

`rebase cloud init --claim` fournit à une application un backend fonctionnel avant même que quiconque ne se soit
inscrit, et affiche une URL de revendication (claim URL) permettant à l'utilisateur de le conserver ; un projet que personne ne revendique
dans les 72 heures est détruit. Les actions autorisées pour le jeton d'un projet non revendiqué, la variable
`REBASE_API_TOKEN` qu'il renseigne et ce que modifie la revendication sont décrits dans
[Un backend sans compte](/docs/deployment/cloud-agents/#a-backend-with-no-account).

## Ressources de calcul et tarification

Le coût d'un projet est déterminé par ce qu'il réserve, et non par un forfait rigide. La commande `compute` affiche
chaque curseur de configuration ainsi que le devis détaillé établi par le plan de contrôle. (`rebase cloud
resources` correspond à autre chose : les bases de données et buckets déclarés par le code,
et l'état de provisionnement de chacun — voir la [référence CLI](/docs/cli/cloud/).)

```bash
rebase cloud compute
rebase cloud compute set --cpu 500m --memory 2Gi
```

| Curseur | Unité et signification |
|---|---|
| `--cpu`, `--memory` | Demande (request) applicative par instance, ex. `500m` et `2Gi`. Vide correspond à la valeur par défaut de la plateforme, qui dépend de la région (voir plus bas) |
| `--replicas` | Nombre d'instances garanties en permanence : le seuil minimal de l'autoscaler, et la base facturée mensuellement par l'abonnement du projet |
| `--autoscale-max` | 1–16. Le plafond maximal atteignable. Les instances ajoutées par l'autoscaler au-delà de `--replicas` sont décomptées à la seconde-pod aux mêmes tarifs, et facturées uniquement là où la plateforme a activé cette option ; **Usage this month** l'indique. `--no-autoscale` désactive cette fonctionnalité |
| `--autoscale-cpu-target` | 10–95. Le taux d'utilisation CPU visé par l'autoscaler, mesuré par rapport à la demande (request) et non à la limite. Laisser vide applique 70 |
| `--spot` | `true` ou `false`. Capacité préemptible : plus économique, mais susceptible d'être redémarrée sans préavis |
| `--db-instances` | 1–3. `1` correspond à une instance isolée sans basculement automatique ; `2` ajoute une instance de secours (standby) automatique |
| `--db-cpu`, `--db-memory` | Par instance de base de données. Laisser vide applique `160m` et `1Gi` |

Laisser un curseur vide n'est pas équivalent à le fixer à la même valeur numérique : un curseur vide
s'aligne sur la configuration par défaut de la plateforme et évolue en même temps qu'elle.

En Belgique (europe-west1), la configuration par défaut réserve 100m CPU et 384 Mio et peut monter en pointe (burst)
jusqu'à 2 CPU et 2 Gio ; à Falkenstein et Helsinki, la mémoire peut atteindre 1,4× la
demande initiale et le CPU jusqu'à 10× (au maximum 1,7 vCPU). `rebase cloud compute` affiche les valeurs applicables à votre projet.

Aucune validation n'est opérée par la CLI, de manière délibérée — les limites relèvent du cluster sur lequel
le projet s'exécute, et varient d'un fournisseur à l'autre. Le plan de contrôle rejettera toute
valeur qu'il ne peut honorer en désignant le champ incriminé. Exécutez `rebase cloud compute` pour visualiser
le montant en €/mois avant et après ; une modification s'applique immédiatement, au prorata à compter d'aujourd'hui.
Une modification de la base de données prend effet immédiatement, facturée à la taille actuelle jusqu'à son déploiement complet.
Modifier l'allocation CPU ou mémoire de la base de données, ou réduire son nombre d'instances, entraîne son redémarrage (environ
30 secondes à 3 minutes ; les connexions sont interrompues puis rétablies) : `compute set`
vous en avertit et sollicite votre accord ; en mode non interactif, `--yes` fait office de consentement. Si ce redémarrage
échoue, `rebase cloud compute apply` tente à nouveau l'opération.

## Vue d'ensemble des commandes

| Groupe de commandes | Ce qu'il couvre |
|---|---|
| `login`, `logout`, `whoami`, `access-token` | Votre session ; `access-token` affiche le jeton porteur (bearer) que la CLI transmettrait actuellement, pour vos scripts et le serveur MCP |
| `tokens` | Jetons pour la CI et les agents, restreints chacun à un projet unique. Voir [CI et agents](/docs/deployment/cloud-agents/#ci-and-agents) |
| `link`, `unlink`, `use`, `open` | Liaison de ce répertoire à un projet, sélection d'une organisation, ouverture de la console |
| `connect` | Ajout d'un serveur Rebase auto-hébergé à votre compte, permettant au [connecteur Rebase](/docs/ai/rebase-connector/#add-your-self-hosted-instances) dans Claude d'y accéder aux côtés de vos projets Cloud. `--list` les affiche, `--remove` en retire un. Réservé aux propriétaires et admins |
| `init`, `claim` | Avec `--claim` : provisionne un backend fonctionnel sans compte préalable, et fournit un lien pour le revendiquer ; `claim` affiche à nouveau ce lien. Voir [Un backend sans compte](/docs/deployment/cloud-agents/#a-backend-with-no-account) |
| `projects` | Créer, lister, inspecter, supprimer |
| `deploy`, `logs`, `deployments`, `rollback`, `cancel` | Déploiement et supervision |
| `deploy-hooks` | URLs secrètes appelées par un hébergeur git ou un outil de CI pour déployer le projet : lister, créer (l'URL est montrée une seule fois), révoquer |
| `previews` | Versions servies sur leur propre adresse via `deploy --preview`, et leur suppression. Voir [Prévisualiser une modification](#prévisualiser-une-modification) |
| `sleep` | Mise en veille lors des périodes d'inactivité : `on [--after 15m\|30m\|1h\|4h]`, `off`, `wake`, et `status` (par défaut). Endormi, un projet ne mobilise ni CPU ni mémoire et la requête suivante le réveille ; les tâches planifiées et traitements de fond ne s'exécutent pas pendant ce temps. Si un projet ne peut pas être mis en veille, le plan de contrôle le refuse et explique pourquoi |
| `start`, `stop`, `restart` | Suspendre un projet et le relancer. Un projet arrêté conserve son abonnement, sauf si la plateforme facture les projets arrêtés au seul titre du stockage et des frais de plateforme ; la ligne **Billing** de la console l'indique si c'est le cas |
| `status`, `metrics`, `debug` | État actuel du projet et causes d'éventuels blocages |
| `alerts` | Incidents ouverts sur le projet, prise en compte (acknowledgement) ou mise en sourdine |
| `cron` | Tâches cron de l'application déployée et historique de leurs exécutions, consultables avec votre identifiant `rebase cloud`. En lecture seule |
| `env` | Variables d'environnement. `list` n'affiche jamais les valeurs ; `--secret` est en écriture seule |
| `app-key` | Clé enregistrée dans `.env` sous `REBASE_API_TOKEN` par `init --claim`, transmise lors de la revendication ; `rotate` la remplace et révoque la précédente. Réservé aux propriétaires et admins |
| `service-key` | `REBASE_SERVICE_KEY`, clé admin de l'API de l'application : date de dernière rotation ; `rotate` en attribue une nouvelle à l'application. Réservé aux propriétaires et admins |
| `domains` | Domaines personnalisés, enregistrements DNS requis et validation. Un projet peut répondre sur plusieurs domaines, chacun vérifié indépendamment ; `verify` et `remove` prennent le domaine concerné, qu'on ne peut omettre que lorsqu'il n'en existe qu'un (pour `verify`, un seul en attente). Chaque domaine vérifié dessert le projet directement ; `primary <domain>` définit le domaine canonique et `redirect <domain>` redirige un autre domaine vers lui par un code 308, en préservant le chemin et les paramètres de requête (`--off` le dessert à nouveau normalement) — configurez ceci pour un sous-domaine `www.` à côté de l'apex, les connexions Google, cookies et clés d'accès (passkeys) étant liés à l'origine. Un domaine sur lequel une application est isolée (une directive applicative `path` avec nom d'hôte) n'est jamais redirigé. Un domaine apex (`example.com`, sans sous-domaine) exige un enregistrement **A**, le DNS interdisant les CNAME à la racine. Cette adresse correspond à l'ingress de la plateforme et n'est pas garantie d'être immuable : si la plateforme migre, l'enregistrement A continuera de pointer vers l'ancienne adresse. Si votre hébergeur DNS propose l'aplatissement CNAME (ALIAS, ANAME ou CNAME flattening) sur l'apex, faites pointer l'apex vers le `tenantHost` du projet, qui s'adapte aux évolutions de la plateforme. Le CNAME d'un sous-domaine suit déjà ce comportement. `list` affiche `verified, certificate pending` jusqu'à ce que le trafic HTTPS réponde avec un certificat réel. `list --json` retourne `{ projectId, tenantHost, domains: [...] }` |
| `db` | Attacher ou créer une base de données, s'y connecter depuis votre machine, sauvegardes, restauration et point-in-time recovery |
| `guests` | Utilisateurs invités générés par les connexions anonymes : les dénombrer, en supprimer un, purger ceux inactifs depuis longtemps. Voir [Guests](/docs/cli/cloud/#guests). Réservé aux propriétaires et admins |
| `extensions` | Liste blanche des extensions Postgres |
| `storage` | Buckets du projet et leurs clés d'accès, sur [Rebase Storage](/docs/deployment/rebase-storage/) |
| `resources` | Bases de données et buckets gérés par la plateforme, en regard de ce que déclare le code |
| `compute` | Ressources réservées pour ce projet, détails des coûts et ajustement des curseurs |
| `events` | Chronologie des événements du backend, du plus récent au plus ancien : redimensionnement applicatif, modifications planifiées ou appliquées sur la base de données, basculement vers une instance standby, extension de disque |
| `usage` | Requêtes consommées ce mois-ci par rapport au quota inclus, et dépassement actuel, tel que pris en compte pour la facturation. `usage org` liste l'ensemble des projets de l'organisation |
| `clusters` | Clusters hébergeant les tenants. Réservé aux administrateurs de la plateforme |
| `settings`, `orgs`, `access`, `billing` | Paramètres du projet, organisations, gestion des membres et invitations, contrôle des accès au projet, facturation |
| `activity` | Journal d'audit de l'organisation : qui a déployé, modifié une variable d'environnement (par son nom), un domaine, une sauvegarde, un membre ou un jeton. Réservé aux propriétaires et admins. Voir [Suivre l'activité](#suivre-lactivité) |
| `notifications` | Cibles où les événements du projet sont envoyés par POST : Slack, Discord ou toute URL https ([Notifications Cloud](/docs/deployment/cloud-notifications/)) |

Chaque groupe de cette liste répond à l'option `--help` en fournissant une page dédiée — ligne d'utilisation,
options disponibles et exemples — et `--help` n'exécute jamais la commande. Un test automatisé vérifie
l'index de ces pages, de sorte qu'un groupe ajouté sans documentation fait échouer la compilation au lieu de
renvoyer la table des matières. La commande `verify:docs` contraint ce tableau à concorder rigoureusement
avec cet index : chaque commande gérée par la CLI figure ici exactement une fois, et l'ajout d'une commande
sans ligne correspondante fait également échouer la compilation.

Lorsqu'elle est redirigée dans un pipe, l'option `--help` renvoie du JSON : la même ligne d'utilisation, les mêmes options et exemples
structurés sous forme de données à analyser, plutôt que soixante lignes de séquences d'échappement pour terminal.

## Ce que la bêta n'inclut pas

Pas de sélection de région, pas d'inscription en libre-service, pas de SLA contractuel publié, pas de déploiements par branche,
des jetons agissant sous l'identité d'une personne physique, et aucun endpoint public direct vers la base de données. [Ce que la bêta
n'inclut pas](/docs/deployment/cloud-beta-limits/) détaille chacun de ces points en toute transparence,
ainsi que les implications d'un déploiement avec les secrets de production.

## L'auto-hébergement comme alternative

Aucun verrouillage propriétaire (lock-in) n'est imposé ici. Le [guide d'auto-hébergement](/docs/deployment/self-hosting/)
permet d'exécuter la même image et le même bundle avec `docker compose`, et le
[guide Kubernetes](/docs/deployment/kubernetes/) déploie une topologie identique à l'aide
du chart Helm.
