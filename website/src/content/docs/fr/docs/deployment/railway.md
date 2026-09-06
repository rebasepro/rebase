---
sourceHash: 4d7e2205e3aed6fc
title: Déploiement de Rebase sur Railway
description: Déployez Rebase sans effort grâce au parsing de Dockerfile nativement pris en charge par Railway. Maintenez une orientation UE.
sidebar_label: Railway
---

Railway est un PaaS (Platform as a Service) moderne incroyablement populaire qui simplifie considérablement le DevOps. Il détectera automatiquement le framework Node Rebase et le construira de manière transparente.

De plus, Railway prend entièrement en charge les régions de déploiement européennes (Amsterdam), ce qui signifie que vous bénéficiez toujours d'une stricte conformité d'hébergement régional.

## 1. Créer un Projet et une Région UE
1. Connectez-vous à votre [Compte Railway](https://railway.app/).
2. Cliquez sur **Nouveau Projet**.
3. Allez dans **Paramètres -> Région par défaut**, et définissez-le explicitement sur **Europe (Amsterdam)**. (Si vous faites cela *après* avoir créé des services, vous devrez peut-être les migrer manuellement).

## 2. Provisionner PostgreSQL
1. Dans votre projet, cliquez sur **Nouveau** -> **Base de données** -> **Ajouter PostgreSQL**.
2. Attendez quelques secondes pour que la base de données soit provisionnée.
3. Par défaut, Railway fournit une variable interne `DATABASE_URL`. Cliquez sur le widget Postgres -> **Variables** pour localiser cette chaîne de connexion.

## 3. Déployer le code Rebase
1. Cliquez sur **Nouveau** -> **Dépôt GitHub**.
2. Sélectionnez votre dépôt Rebase.
3. Railway détectera immédiatement le dépôt et recherchera un `Dockerfile`. Attendez que la construction initiale commence.

:::caution[Pointez Railway vers le Dockerfile du backend]
Il n'y a **aucune image applicative à construire depuis vos sources**. `rebase build` produit un répertoire `dist-bundle` avec vos collections, fonctions et crons compilés — et, si votre projet déclare une app statique, votre frontend construit. L'image de runtime publiée l'exécute :

```bash
rebase build
```

Railway tire depuis un registre : intégrez donc le bundle dans une image dérivée. Trois lignes, et cela fige exactement ce qui tourne :

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.17.3
COPY dist-bundle /bundle
```

Mettre Rebase à niveau plus tard revient à changer cette ligne `FROM`. Votre bundle reste intact.
:::

## 4. Définir les Variables d'Environnement
La construction initiale pourrait échouer car il manque entièrement de configuration. Corrigeons cela.

1. Cliquez sur la nouvelle carte de service GitHub Rebase.
2. Allez à l'onglet **Variables**.
3. Cliquez sur **Nouvelle Variable** et ajoutez :
   - `JWT_SECRET` : Générez une chaîne aléatoire sécurisée de plus de 32 caractères.
   - `NODE_ENV` : Définissez sur `production`
4. Cliquez sur **Référencer la Variable** et sélectionnez `DATABASE_URL` à partir du service PostgreSQL que vous avez provisionné. Railway injectera de manière sécurisée l'URL interne de Postgres à l'exécution.

## 5. Exposer le Domaine
1. Dans la carte de service Rebase, naviguez vers l'onglet **Paramètres**.
2. Faites défiler jusqu'à **Mise en réseau**.
3. Sous **Mise en réseau publique**, cliquez sur **Générer un Domaine**. Railway fournira une URL de test `.up.railway.app`. Vous pouvez également attacher de manière sécurisée un Domaine Personnalisé ici.

Railway reconstruira automatiquement en toute sécurité. Votre plateforme hébergée dans l'UE est maintenant entièrement en ligne !

## 6. Créer le schéma de base de données

L'application est en cours d'exécution, mais Rebase ne crée automatiquement que les tables d'**authentification** au démarrage — les tables de vos propres collections ne sont **pas** créées automatiquement. Exécutez cette commande une fois sur la base de données de production, sinon chaque collection renverra une erreur « missing table » :

```bash
pnpm run db:push
```

Exécutez-la depuis un checkout de votre projet (ou depuis votre job CI) avec `DATABASE_URL` définie sur la chaîne de connexion **publique** de votre service Postgres (disponible sous le widget Postgres → **Connect** ; la variable interne `DATABASE_URL` référencée n'est accessible que depuis l'intérieur de Railway). L'image déployée n'inclut pas la CLI, cette commande ne s'exécute donc pas à l'intérieur du conteneur. Pour des migrations versionnées, validez les fichiers de migration avec `pnpm run db:generate` et exécutez `pnpm run db:migrate` à la place.

---
