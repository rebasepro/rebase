---
sourceHash: 77b432f86f85bc82
title: Ce que la version bêta de Rebase Cloud n'inclut pas
sidebar_label: Limites de la version bêta Cloud
description: Ce que la version bêta privée de Rebase Cloud ne prend pas encore en charge — régions, accès en libre-service, SLA, déploiements de branches, identités de machine, endpoint public de base de données — et ce qu'implique un déploiement avec des secrets de production.
---

[Rebase Cloud](/docs/deployment/cloud/) est en version bêta privée. Disons-le clairement, car le découvrir plus tard est pire :

- **Pas de choix de région.** Tout s'exécute aujourd'hui dans une seule région. Le modèle
  de placement existe au sein de la plateforme, mais un projet ne peut pas choisir de région.
  `projects create --provider` et `--region` ne sont pas l'exception qu'ils paraissent
  être : ils enregistrent à quelle cible de déploiement répertoriée du plan de contrôle
  appartient un projet, et il n'y en a qu'une seule ; les deux prennent donc cette valeur par défaut
  et aucun ne déplace le projet ailleurs. `rebase cloud projects create --help` indique la même chose.
- **Pas de libre-service.** Les accès sont accordés par vagues ; il n'est pas possible de s'inscrire et de payer directement.
- **Aucun SLA publié**, et pas de certification SOC 2. Si vous avez besoin de l'un ou de l'autre,
  précisez-le lors de votre demande d'accès plutôt que de le présumer.
- **Pas de déploiements de branches**, ni d'application GitHub officielle. Les deploy hooks — des URL
  secrètes vers lesquelles vous pointez un webhook de dépôt — constituent l'automatisation prise en charge. Les [déploiements de prévisualisation](/docs/deployment/cloud/#preview-a-change)
  sont en cours de déploiement et sont déclenchés depuis la CLI.
- **Les jetons agissent en tant que personne.** Un [jeton](/docs/deployment/cloud-agents/#ci-and-agents) est généré par un compte
  et agit en son nom ; il n'existe pas encore d'identité machine appartenant à une organisation. Si vous
  vous connectez plutôt depuis un environnement de CI, transmettez `REBASE_CLOUD_EMAIL` et `REBASE_CLOUD_PASSWORD`
  à partir d'un gestionnaire de secrets — `--password` place le mot de passe dans l'historique de votre shell et
  dans la table des processus, et vous en avertit avant la connexion. Si le fichier `.rebase/cloud.json`
  du dépôt mentionne un plan de contrôle autre que celui de la plateforme, transmettez-le
  également avec `--url` : en l'absence de terminal, `login` refuse d'envoyer un mot de passe à un
  hôte qui n'a été spécifié que par le fichier extrait du dépôt.
- **Pas d'endpoint de base de données public.** Une base de données managée n'est pas exposée à
  Internet ; l'hôte affiché par la console correspond donc à l'adresse utilisée par votre backend pour la joindre et
  ne résout rien sur votre machine locale. `rebase cloud db connect` ouvre un port local
  qui correspond à cette base de données, tunnellisée à travers le plan de contrôle, aussi longtemps
  que vous le laissez tourner — mais il n'y a aucun nom d'hôte permanent auquel un service
  tiers peut se connecter. Pour exécuter du code SQL sans client Postgres local,
  `rebase cloud db query "<sql>"` ou `rebase cloud db query --file file.sql` ouvre le
  même tunnel pour une seule requête, exécute le texte en tant que script unique (en s'arrêtant à la première
  erreur) et affiche la réponse de chaque instruction (`--json` pour un script). Ce tunnel, ainsi que le mot de passe accessible via
  `rebase cloud db info --reveal`, requièrent tous deux le rôle owner ou admin de l'organisation :
  le même que celui requis par l'éditeur SQL de Studio, car les trois débouchent sur une
  session sur vos données de production.
- **Déployer revient à exécuter du code avec les secrets de production.** L'environnement
  de l'application contient `REBASE_SERVICE_KEY` (administrateur sur sa propre API),
  `DATABASE_URL` et `JWT_SECRET` ; le code déployé par un membre peut donc les lire,
  même si seuls les owners et les admins peuvent les révéler dans la console. N'invitez
  en tant que membre qu'une personne à qui vous feriez confiance avec ces valeurs.
- **La clé de service peut être remplacée.** Les **Settings** du projet
  (ou `rebase cloud service-key rotate`) génèrent une nouvelle `REBASE_SERVICE_KEY`
  et redémarrent l'application dessus. L'ancienne clé fonctionne jusqu'à ce que le redémarrage soit
  terminé, et plus du tout après ; tout ce qui l'a copiée sera donc rejeté à
  partir de ce moment-là. Revendiquer un projet fait de même.

## Prochaines étapes

- [Rebase Cloud](/docs/deployment/cloud/) : liaison, déploiement et le reste des fonctionnalités.
- [Auto-hébergement](/docs/deployment/self-hosting/) : la même image et le même bundle, exécutés par vos soins.
