---
sourceHash: 00bc3369d6f3db69
title: Kubernetes
sidebar_label: Kubernetes
description: Déployez Rebase sur un cluster Kubernetes avec le chart Helm officiel — un ou plusieurs Deployments, un Job de migration qui gère le schéma, et des applications statiques sur le même hôte.
---

## Aperçu

Le chart officiel est le pendant Kubernetes de la configuration d'auto-hébergement
avec Docker Compose. Même idée, même image, même bundle : **le runtime est l'image,
votre projet est le bundle, et mettre à niveau Rebase consiste simplement à changer de tag.**

Il est publié sous forme d'artefact OCI aux côtés de l'image de runtime, et les deux portent
la même version — le chart qui déploie le runtime `0.17.3` *est* le chart `0.17.3`,
il n'y a donc qu'un seul numéro à suivre. Sans `--version`, vous obtenez la version la plus récente ;
figez-la pour un déploiement réel, de la même manière que vous figeriez `image.tag` :

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

Le chart est livré avec l'auto-inscription désactivée, une release doit donc spécifier le compte
avec lequel son opérateur se connecte — sinon elle démarre avec une table d'utilisateurs vide et
aucun moyen de créer le premier appelant authentifié. `config.adminPassword` doit comporter
au moins 12 caractères, et `config.adminEmail` nécessite un point dans son domaine : la
route de connexion valide son corps avec `z.string().email()`, donc `admin@localhost`
est un compte auquel personne ne pourrait se connecter et le runtime refuse de l'initialiser. Tous
deux sont des refus au moment du rendu (render-time) plutôt que de mauvaises surprises
à l'exécution — voir [ce que le chart refuse de générer](#ce-que-le-chart-refuse-de-générer). Connectez-vous
et modifiez le mot de passe ; ces valeurs sont stockées dans un Secret.

Gérez-les plutôt hors bande (out of band) en faisant pointer `existingSecret` vers un Secret
contenant `REBASE_ADMIN_EMAIL` et `REBASE_ADMIN_PASSWORD` aux côtés de
`DATABASE_URL` et du reste.

Le chart déploie **uniquement le runtime**. Il ne déploie pas Postgres — utilisez
CloudNativePG, une base de données managée ou votre propre StatefulSet, et faites pointer
`config.databaseUrl` vers celle-ci. Un chart qui gérerait également votre base de données prendrait
en charge vos sauvegardes et votre basculement (failover), ce qui représente un engagement
bien plus vaste que simplement « faire tourner l'application ».

> **Maturité.** Deux éléments distincts sont vérifiés en CI, et un troisième ne l'est pas.
> Le chart est vérifié par linting et généré avec Helm v4.2.4 — pour chaque
> topologie documentée sur cette page, y compris la commande d'installation ci-dessus, et un cas
> atteignant chaque refus listé ci-dessous. L'image de runtime déployée par le chart est
> construite et démarrée face à un vrai Postgres, selon les deux manières dont un bundle peut être fourni. Ce qui
> n'a **jamais été exécuté, c'est le chart sur un cluster actif** : rien n'a planifié
> ces manifestes, donc les probes, l'ordonnancement du Job de migration pre-install et
> l'ingress sont corrects sous forme de YAML mais non éprouvés en tant que déploiement. Considérez-le comme un
> point de départ bien testé plutôt que comme une configuration par défaut éprouvée pour la production, et consultez
> [Auto-hébergement](/docs/deployment/self-hosting) pour la voie qui l'est.

Pour travailler plutôt à partir d'un clone du dépôt — pour un chart modifié ou une installation isolée (air-gapped) —
`helm install rebase ./infra/charts/rebase` accepte les mêmes valeurs.

## Intégrer votre projet dans le pod

| `bundle.mode` | Comment | Quand |
|---|---|---|
| `image` (par défaut) | Construisez `FROM rebasepro/server` avec `COPY dist-bundle /bundle`, puis définissez `image.repository` | Presque toujours. Un seul artefact, immuable, aucune dépendance au runtime quant à la disponibilité d'une URL |
| `url` | Image standard ; le runtime télécharge une archive tarball à chaque démarrage de pod | Un plan de contrôle qui distribue les bundles hors bande |

## Un seul processus, ou plusieurs

Par défaut, un unique Deployment dessert tout — la même structure que celle
exécutée par le fichier Compose. Le découpage se fait en une seule valeur :

```yaml
split: true
functions:
  enabled: true
  replicas: 3
worker:
  enabled: true
```

Cela vous donne un palier `api`, un palier `functions` et un `worker`, tous issus
de la même image et du même bundle. Consultez [Processus séparés](/docs/deployment/split-processes)
pour découvrir le rôle de chacun et les raisons de les séparer.

Ce que le chart apporte de plus par rapport à une configuration manuelle, c'est qu'il **déduit les paramètres dont
le mode d'échec est silencieux**, à partir des valeurs que vous lui avez déjà fournies :

- `REBASE_ROLE` par unité — `all` sur l'api lorsqu'il n'y a pas d'unité functions, afin qu'elle serve toujours vos fonctions
- `REBASE_MIGRATE_ON_BOOT=none` partout, car le Job de migration prend en charge le schéma
- `REBASE_CRON_SCHEDULER=false` / `REBASE_JOB_WORKERS=false` sur l'api dès qu'un worker existe
- `TRUSTED_PROXY_HOPS` sur l'unité functions
- `REBASE_RATE_LIMIT_STORE=sql` dès qu'un second processus dessert du trafic HTTP

Un `REBASE_ROLE` incorrect ne sert aucun trafic HTTP alors que `/health` répond toujours, de sorte que le test de readiness
réussit et que chaque requête renvoie une 404. Un `REBASE_MIGRATE_ON_BOOT` manquant est une boucle de crash (crash loop)
dont la cause se trouve dans un log que personne ne surveille. Le chart les écrit tous, et
`config.env` ne peut pas les écraser.

### Séparer cron de l'exécution des jobs

Deux workers aux attributions opposées — aucun nouveau rôle et aucun code :

```yaml
worker:
  enabled: true
  cronScheduler: true
  jobWorkers: false
```

## Le panneau d'administration, et tout autre front-end

Une application statique utilise la même image de runtime démarrant un bundle `kind: static`. Ce chemin
est court-circuité avant que le runtime ne lise `DATABASE_URL` ou `JWT_SECRET`, de sorte que ces
pods ne contiennent **strictement aucun secret**.

```yaml
staticApps:
  - name: admin
    path: /admin
    image:
      repository: my-registry/my-admin
      tag: "1.4.0"
```

L'ingress route `/admin` vers celle-ci et `/` vers l'API, sur le **même hôte**. C'est
délibéré : une même origine (same origin) signifie que l'authentification par cookie et le CORS restent exactement ce qu'ils étaient,
et la séparation reste une décision de topologie interne plutôt qu'un changement de la
surface publique de votre produit. La contrepartie est que les assets doivent être *compilés* pour ce
chemin, ce que le runtime vérifie au démarrage.

Déployer l'interface d'administration revient alors simplement à incrémenter le tag d'image sur un Deployment. Le backend
ne redémarre pas.

## Schéma

`migrationJob.enabled` (par défaut) exécute un Job `pre-install,pre-upgrade` qui
effectue le provisionnement et se termine, et chaque pod démarre avec `REBASE_MIGRATE_ON_BOOT=none`.
Rien sur le chemin des requêtes ne gère le schéma des tables, ce qui constitue la réponse la plus propre
à la règle « un seul processus provisionne le schéma » — cela cesse d'être
une contrainte dont quiconque doit se souvenir. Les pods maintiennent toujours à jour les tables propres au framework
(authentification, clés d'API, jobs, cron) au démarrage ; `provision: false` désactive cela également,
ne génère aucun Job et confie la gestion du schéma à une
[exécution de provisionnement](/docs/deployment/self-hosting/#when-only-your-change-process-may-change-the-database)
selon votre propre processus de gestion des changements.

`mode: ensure` crée ce qui manque, de manière additive, et c'est le seul mode accepté
par l'image de runtime. `push` est refusé au démarrage : l'application de modifications du schéma des tables
est destructive, et `rebase db push` exécuté depuis un clone local ou en CI simule la
modification (dry-run), refuse les opérations destructives sans confirmation et peut effectuer une sauvegarde
au préalable — autant de choses qu'un pod démarrant de manière autonome et sans surveillance ne peut pas faire.

## Ce que le chart refuse de générer

Chacune de ces configurations ne produit aucune erreur à l'exécution — le
déploiement se lance et quelque chose cesse discrètement de fonctionner comme prévu. `helm install` échoue
à la place, en indiquant la valeur à modifier :

- plus d'un processus HTTP avec `sharedState.rateLimitStore=memory`
- `functions.enabled` ou `worker.enabled` alors que `split=false`
- deux applications statiques revendiquant le même chemin, ou une revendiquant un chemin sous `/api`
- `bundle.mode=image` alors que `image.repository` est toujours l'image de runtime standard
- `ingress.enabled` sans hôte, ou `bundle.mode=url` sans URL
- un `migrationJob.mode` ou `sharedState.rateLimitStore` non reconnu
- aucun `config.adminEmail` avec l'auto-inscription désactivée — une release à laquelle personne ne peut
  se connecter. Définissez les deux valeurs d'administration, ou `config.allowSelfRegistration=true`
  en comprenant bien que la première personne à accéder au formulaire d'inscription en deviendra
  l'administrateur
- un `config.adminPassword` de moins de 12 caractères, ou un `config.adminEmail` dont le
  domaine ne comporte pas de point. Le runtime refuse d'initialiser l'un comme l'autre au démarrage, provoquant la
  même impossibilité d'accès à la release

## Ce que le chart ne peut pas faire pour vous

**Diffusion en temps réel (realtime broadcast) et présence entre réplicas.** Le bus de
canaux par défaut du runtime est en mémoire ; par conséquent, avec plusieurs réplicas d'API, un abonné sur un
pod ne verra pas une diffusion publiée sur un autre. La solution réside dans la configuration de votre
projet, et non dans le chart :

```ts
realtime: { bus: { type: "postgres" } }
```

Définissez `sharedState.channelBusConfigured: true` pour confirmer que vous l'avez fait — le chart
s'en sert uniquement pour décider s'il doit émettre un avertissement. Les abonnements classiques aux tables ne sont
pas affectés ; ceux-ci transitent par le CDC de Postgres.

Le reste de ce qu'un processus garde pour lui-même — fichiers locaux, téléversements avec reprise (resumable uploads),
le cache de transformation d'images, l'explorateur de logs — est répertorié avec le paramètre qui
permet de partager chacun d'eux dans [Exécuter plusieurs instances](/docs/deployment/multiple-instances/).
