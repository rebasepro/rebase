---
sourceHash: 51abd249a5639803
title: Kubernetes
sidebar_label: Kubernetes
description: Déployez Rebase sur un cluster Kubernetes avec le chart Helm officiel — un ou plusieurs Deployments, un Job de migration qui gère le schéma, et des applications statiques sur le même hôte.
---

## Vue d'ensemble

Le chart officiel est le pendant Kubernetes de la configuration auto-hébergée
avec Docker Compose. Même idée, même image, même bundle : **le runtime est
l'image, votre projet est le bundle, et mettre à niveau Rebase se résume à
changer de tag.**

Il est publié sous la forme d'un artefact OCI aux côtés de l'image de runtime,
et les deux portent la même version — le chart qui déploie le runtime `0.17.3`
*est* le chart `0.17.3`, il n'y a donc qu'un seul numéro à suivre. Sans
`--version`, vous obtenez la version la plus récente ; fixez-la pour un
déploiement réel, de la même manière que vous épingleriez `image.tag` :

```bash
helm install rebase oci://registry-1.docker.io/rebasepro/rebase \
  --set config.databaseUrl='postgres://user:pass@host:5432/db' \
  --set config.jwtSecret="$(openssl rand -hex 32)" \
  --set config.serviceKey="$(openssl rand -hex 32)" \
  --set config.adminEmail=you@example.com \
  --set config.adminPassword="$(openssl rand -hex 16)" \
  --set ingress.host=api.example.com \
  --set image.repository=my-registry/my-app
```

Le chart est fourni avec l'auto-inscription désactivée, une release doit donc
désigner le compte avec lequel son opérateur se connecte — sinon, elle démarre
avec une table d'utilisateurs vide et aucun moyen de créer le premier appelant
authentifié. `config.adminPassword` doit comporter au moins 12 caractères, et
`config.adminEmail` nécessite un point dans son domaine : la route de connexion
valide son corps avec `z.string().email()`, donc `admin@localhost` est un compte
auquel personne ne pourrait se connecter et le runtime refuse de l'initialiser.
Ces deux cas sont des refus au moment du rendu plutôt que de mauvaises
surprises à l'exécution — consultez [ce que le chart refuse de
générer](#ce-que-le-chart-refuse-de-générer). Connectez-vous et modifiez le mot
de passe ; ces valeurs sont stockées dans un Secret.

Gérez-les plutôt hors bande en pointant `existingSecret` vers un Secret
contenant `REBASE_ADMIN_EMAIL` et `REBASE_ADMIN_PASSWORD` aux côtés de
`DATABASE_URL` et du reste.

Le chart déploie le **runtime uniquement**. Il ne déploie pas Postgres —
utilisez CloudNativePG, une base de données managée ou votre propre
StatefulSet, et faites pointer `config.databaseUrl` vers celle-ci. Un chart qui
prendrait également en charge votre base de données devrait gérer vos
sauvegardes et votre basculement (failover), ce qui représente un engagement
bien plus vaste que simplement « faire tourner l'application ».

> **Maturité.** Deux aspects distincts sont vérifiés dans la CI, et un troisième
> ne l'est pas. Le chart est vérifié (lint) et généré avec Helm v4.2.4 — chaque
> topologie documentée sur cette page, y compris la commande d'installation
> ci-dessus, ainsi qu'un cas atteignant chaque refus listé ci-dessous. L'image
> de runtime déployée par le chart est construite et démarrée sur une vraie base
> Postgres, pour les deux façons dont un bundle peut être fourni. Ce qui n'a
> **jamais tourné, c'est le chart sur un cluster actif** : rien n'a planifié
> ces manifestes, de sorte que les sondes, l'ordonnancement du Job de migration
> pre-install et l'ingress sont corrects en tant que YAML mais non éprouvés en
> tant que déploiement. Considérez-le comme un point de départ bien testé plutôt
> que comme une configuration éprouvée par défaut pour la production, et
> consultez [Auto-hébergement](/docs/deployment/self-hosting) pour la voie qui
> l'est.

Pour travailler directement à partir d'un clone du dépôt — un chart modifié ou
une installation air-gap — `helm install rebase ./infra/charts/rebase` accepte
les mêmes valeurs.

## Intégrer votre projet dans le pod

| `bundle.mode` | Comment | Quand |
|---|---|---|
| `image` (par défaut) | Construire avec `FROM rebasepro/server` et `COPY dist-bundle /bundle`, puis définir `image.repository` | Presque toujours. Un seul artefact, immuable, aucune dépendance d'exécution vis-à-vis de la disponibilité d'une URL |
| `url` | Image standard ; le runtime télécharge une archive tarball à chaque démarrage de pod | Un plan de contrôle qui distribue les bundles hors bande |

## Un seul processus, ou plusieurs

Par défaut, un unique Deployment dessert l'ensemble — la même structure que
celle exécutée par le fichier Compose. Le découpage ne requiert qu'une seule
valeur :

```yaml
split: true
functions:
  enabled: true
  replicas: 3
worker:
  enabled: true
```

Cela vous donne un palier `api`, un palier `functions` et un `worker`, tous
issus de la même image et du même bundle. Consultez [Processus séparés](/docs/deployment/split-processes)
pour découvrir le rôle de chacun et les raisons de les séparer.

Ce que le chart apporte de plus par rapport à une configuration manuelle, c'est
qu'il **déduit les paramètres dont le mode d'échec est silencieux**, à partir
des valeurs que vous lui avez déjà fournies :

- `REBASE_ROLE` par unité — `all` sur l'api lorsqu'il n'y a pas d'unité functions, pour qu'elle continue de servir vos fonctions
- `REBASE_MIGRATE_ON_BOOT=none` partout, car le Job de migration gère le schéma
- `REBASE_CRON_SCHEDULER=false` / `REBASE_JOB_WORKERS=false` sur l'api dès qu'un worker existe
- `TRUSTED_PROXY_HOPS` sur l'unité functions
- `REBASE_RATE_LIMIT_STORE=sql` dès qu'un deuxième processus sert du trafic HTTP

Un `REBASE_ROLE` erroné ne sert aucun trafic HTTP alors que `/health` répond
toujours, ce qui fait réussir le test de readiness tandis que chaque requête
renvoie une 404. Un `REBASE_MIGRATE_ON_BOOT` manquant provoque une boucle de
crash dont la cause se trouve dans un log que personne ne surveille. Le chart
les configure tous, et `config.env` ne peut pas les écraser.

### Séparer cron de l'exécution des jobs

Deux workers avec des attributions complémentaires — aucun nouveau rôle, et
aucun code :

```yaml
worker:
  enabled: true
  cronScheduler: true
  jobWorkers: false
```

## Le panneau d'administration, et tout autre front-end

Une application statique utilise la même image de runtime démarrant un bundle
`kind: static`. Ce chemin est court-circuité avant même que le runtime ne lise
`DATABASE_URL` ou `JWT_SECRET`, de sorte que ces pods ne contiennent
**absolument aucun secret**.

```yaml
staticApps:
  - name: admin
    path: /admin
    image:
      repository: my-registry/my-admin
      tag: "1.4.0"
```

L'ingress route `/admin` vers celle-ci et `/` vers l'API, sur le **même hôte**.
C'est délibéré : la même origine garantit que l'authentification par cookie et
les règles CORS restent exactement les mêmes, et la séparation demeure une
décision de topologie interne plutôt qu'une modification de la surface publique
de votre produit. La contrepartie est que les assets doivent être *compilés*
pour ce chemin, ce que le runtime vérifie au démarrage.

Déployer l'admin consiste alors simplement à mettre à jour le tag d'image sur un
seul Deployment. Le backend ne redémarre pas.

## Schéma

`migrationJob.enabled` (par défaut) exécute un Job `pre-install,pre-upgrade` qui
provisionne puis s'arrête, et chaque pod démarre avec
`REBASE_MIGRATE_ON_BOOT=none`. Rien sur le chemin des requêtes ne gère le schéma
des tables, ce qui constitue la réponse la plus propre à la règle « un seul et
unique processus provisionne le schéma » — cela cesse d'être une règle dont
quiconque doit se souvenir. Les pods maintiennent toujours à jour les tables
internes du framework (authentification, clés d'API, jobs, cron) au démarrage ;
`provision: false` désactive cela également, ne génère aucun Job, et laisse la
gestion du schéma à une
[exécution de provisionnement](/docs/deployment/self-hosting/#when-only-your-change-process-may-change-the-database)
gérée par votre propre processus de changement.

`mode: ensure` crée ce qui manque de manière additive, et c'est le seul mode
accepté par l'image de runtime. `push` est refusé au démarrage : appliquer des
modifications de schéma de table est destructif, et `rebase db push` depuis un
clone local ou dans la CI simule le changement, refuse les changements
destructifs sans confirmation et peut effectuer une sauvegarde au préalable —
autant de choses qu'un pod démarrant sans surveillance ne peut faire.

## Ce que le chart refuse de générer

Chacune de ces situations correspond à une configuration qui ne produit aucune
erreur à l'exécution — le déploiement se lance et quelque chose cesse
discrètement de fonctionner correctement. Au lieu de cela, `helm install` échoue
en indiquant la valeur à modifier :

- plus d'un processus HTTP avec `sharedState.rateLimitStore=memory`
- `functions.enabled` ou `worker.enabled` alors que `split=false`
- deux applications statiques revendiquant le même chemin, ou une revendiquant un chemin sous `/api`
- `bundle.mode=image` alors que `image.repository` est toujours l'image de runtime standard
- `ingress.enabled` sans hôte, ou `bundle.mode=url` sans URL
- une valeur non reconnue pour `migrationJob.mode` ou `sharedState.rateLimitStore`
- aucun `config.adminEmail` alors que l'auto-inscription est désactivée — une release à laquelle personne ne peut se connecter. Définissez les deux valeurs d'administration, ou `config.allowSelfRegistration=true` en sachant que la première personne à accéder au formulaire d'inscription en deviendra l'administrateur
- un `config.adminPassword` de moins de 12 caractères, ou un `config.adminEmail` dont le domaine ne comporte aucun point. Le runtime refuse d'initialiser l'un ou l'autre au démarrage, provoquant la même release inaccessible

## Ce que le chart ne peut pas faire pour vous

**Diffusion en temps réel (broadcast) et présence entre les répliques.** Le bus
de canaux par défaut du runtime est en mémoire ; par conséquent, avec plusieurs
répliques de l'API, un abonné sur un pod ne verra pas une diffusion publiée sur
un autre. La solution réside dans la configuration de votre projet, pas dans le
chart :

```ts
realtime: { bus: { type: "postgres" } }
```

Définissez `sharedState.channelBusConfigured: true` pour certifier que vous l'avez
fait — le chart l'utilise uniquement pour décider s'il doit émettre un
avertissement. Les abonnements classiques aux tables ne sont pas affectés ;
ceux-ci transitent par le CDC de Postgres.

Le reste de ce qu'un processus garde pour lui-même — fichiers locaux,
téléversements avec reprise, cache de transformation d'images, vue Logs de
Studio — est répertorié avec le paramètre permettant de partager chacun d'eux
dans [Exécuter plusieurs instances](/docs/deployment/multiple-instances/).
