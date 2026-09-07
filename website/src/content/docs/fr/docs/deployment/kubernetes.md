---
sourceHash: 1c7b378353d6058e
title: Kubernetes
sidebar_label: Kubernetes
description: Déployez Rebase sur un cluster Kubernetes avec le chart Helm officiel — un ou plusieurs Deployments, un Job de migration qui gère le schéma, et des applications statiques sur le même hôte.
---

## Vue d'ensemble

Le chart officiel est le pendant Kubernetes de la configuration d'auto-hébergement
avec Docker Compose. Même idée, même image, même bundle : **le runtime est l'image,
votre projet est le bundle, et la mise à niveau de Rebase se résume à un changement de tag.**

Il est publié en tant qu'artefact OCI aux côtés de l'image du runtime, et les deux
portent la même version — le chart qui déploie le runtime `0.17.3` *est* le chart
`0.17.3`, il n'y a donc qu'un seul numéro à suivre. Sans `--version`, vous obtenez
la plus récente ; figez-la pour un déploiement réel, de la même manière que vous
figeriez `image.tag` :

```bash
helm install rebase oci://registry-1.docker.io/rebasepro/rebase \
  --set config.databaseUrl='postgres://user:pass@host:5432/db' \
  --set config.jwtSecret="$(openssl rand -hex 32)" \
  --set config.serviceKey="$(openssl rand -hex 32)" \
  --set ingress.host=api.example.com \
  --set image.repository=my-registry/my-app
```

Le chart déploie le **runtime uniquement**. Il ne déploie pas Postgres — utilisez
CloudNativePG, une base de données managée, ou votre propre StatefulSet, et faites
pointer `config.databaseUrl` vers celle-ci. Un chart qui prendrait également en
charge votre base de données devrait gérer vos sauvegardes et votre basculement
(failover), ce qui représente une promesse bien plus vaste que « faire tourner l'application ».

> **Maturité.** Le chart est analysé et généré en CI avec Helm v4.2.4 —
> pour chaque topologie documentée, ainsi qu'un cas couvrant chaque refus listé
> ci-dessous. Il n'a **pas encore été éprouvé sur un cluster réel**. Considérez-le
> comme un point de départ bien testé plutôt que comme un choix par défaut éprouvé
> en production, et consultez [Self-Hosting](/docs/deployment/self-hosting) pour la
> voie qui l'est.

Pour travailler à partir d'un checkout local — un chart modifié ou une installation
en environnement isolé (air-gap) — `helm install rebase ./charts/rebase` accepte
les mêmes valeurs.

## Intégrer votre projet dans le pod

| `bundle.mode` | Comment | Quand |
|---|---|---|
| `image` (par défaut) | Construisez `FROM rebasepro/server` avec `COPY dist-bundle /bundle`, puis définissez `image.repository` | Presque toujours. Un seul artefact, immuable, sans dépendance au runtime quant à la disponibilité d'une URL |
| `url` | Image standard ; le runtime télécharge une archive tarball à chaque démarrage de pod | Un plan de contrôle (control plane) qui distribue les bundles hors bande |

## Un seul processus, ou plusieurs

Par défaut, un seul Deployment gère tout — la même structure que celle
exécutée par le fichier Compose. Pour séparer les rôles, une seule valeur suffit :

```yaml
split: true
functions:
  enabled: true
  replicas: 3
worker:
  enabled: true
```

Cela vous donne un niveau `api`, un niveau `functions` et un `worker`, tous issus
de la même image et du même bundle. Consultez [Split Processes](/docs/deployment/split-processes)
pour savoir ce que fait chaque rôle et pourquoi vous devriez les séparer.

L'avantage du chart par rapport à une configuration manuelle est qu'il **déduit
les paramètres dont le mode d'échec est silencieux**, à partir des valeurs que
vous lui avez déjà fournies :

- `REBASE_ROLE` par unité
- `REBASE_MIGRATE_ON_BOOT=none` partout, car le Job de migration gère le schéma
- `REBASE_CRON_SCHEDULER=false` / `REBASE_JOB_WORKERS=false` sur l'api dès qu'un worker existe
- `TRUSTED_PROXY_HOPS` sur l'unité functions
- `REBASE_RATE_LIMIT_STORE=sql` dès qu'un second processus sert du HTTP

Un `REBASE_ROLE` incorrect ne sert aucun trafic HTTP alors que `/health` répond
toujours, ce qui fait que le test de readiness réussit et que chaque requête
renvoie une 404. Un `REBASE_MIGRATE_ON_BOOT` manquant provoque une boucle de
plantage (crash loop) dont la cause se trouve dans un journal que personne ne
regarde. Le chart configure tout cela automatiquement, et `config.env` ne peut
pas les écraser.

### Séparer le cron de l'exécution des tâches

Deux workers aux responsabilités opposées — aucun nouveau rôle, et aucun code :

```yaml
worker:
  enabled: true
  cronScheduler: true
  jobWorkers: false
```

## Le panneau d'administration et tout autre front-end

Une application statique utilise la même image de runtime démarrant un bundle
`kind: static`. Ce chemin est court-circuité avant que le runtime ne lise
`DATABASE_URL` ou `JWT_SECRET`, de sorte que ces pods ne contiennent **aucun secret**.

```yaml
staticApps:
  - name: admin
    path: /admin
    image:
      repository: my-registry/my-admin
      tag: "1.4.0"
```

L'ingress route `/admin` vers celle-ci et `/` vers l'API, sur le **même hôte**.
C'est délibéré : la même origine signifie que l'authentification par cookie et le
CORS restent exactement identiques, et la séparation demeure une décision de
topologie interne plutôt qu'une modification de la surface publique de votre
produit. La contrepartie est que les assets doivent être *compilés* pour ce
chemin, ce que le runtime vérifie au démarrage.

Le déploiement de l'admin se résume alors à une mise à jour du tag d'image sur un
seul Deployment. Le backend ne redémarre pas.

## Schéma

`migrationJob.enabled` (par défaut) exécute un Job `pre-install,pre-upgrade` qui
provisionne le schéma et se termine, et chaque pod démarre avec `REBASE_MIGRATE_ON_BOOT=none`.
Aucun élément sur le chemin des requêtes n'exécute de DDL, ce qui constitue la
réponse la plus propre à la règle « un seul et unique processus provisionne le schéma » —
cela cesse d'être une règle dont quiconque doit se souvenir.

`mode: ensure` crée ce qui est manquant. `mode: push` applique également les
modifications de schéma des collections et **est destructif** ; ce n'est pas le
comportement par défaut.

## Ce que le chart refuse de générer

Chacune de ces situations correspond à une configuration qui ne produit aucune
erreur à l'exécution — le déploiement démarre et quelque chose cesse discrètement
de fonctionner correctement. `helm install` échoue à la place, en indiquant la
valeur à modifier :

- plus d'un processus HTTP avec `sharedState.rateLimitStore=memory`
- `functions.enabled` ou `worker.enabled` alors que `split=false`
- deux applications statiques revendiquant le même chemin, ou une revendiquant un chemin sous `/api`
- `bundle.mode=image` alors que `image.repository` est toujours l'image standard du runtime
- `ingress.enabled` sans hôte, ou `bundle.mode=url` sans URL
- un `migrationJob.mode` ou `sharedState.rateLimitStore` non reconnu

## Ce que le chart ne peut pas faire pour vous

**Diffusion en temps réel (realtime broadcast) et présence entre réplicas.** Le
bus de canaux par défaut du runtime est en mémoire ; par conséquent, avec plusieurs
réplicas d'API, un abonné sur un pod ne recevra pas une diffusion publiée sur un
autre. La solution réside dans la configuration de votre projet, et non dans le chart :

```ts
realtime: { bus: { type: "postgres" } }
```

Définissez `sharedState.channelBusConfigured: true` pour confirmer que vous l'avez
configuré — le chart ne l'utilise que pour décider d'émettre un avertissement ou
non. Les abonnements classiques aux collections ne sont pas affectés ; ceux-ci
transitent par le CDC de Postgres.

---
