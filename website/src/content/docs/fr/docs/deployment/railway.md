---
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
Le Dockerfile du scaffold se trouve dans `backend/Dockerfile`, et non à la racine du dépôt, et son contexte de build doit être la **racine du dépôt** (il copie `pnpm-workspace.yaml`, `backend/` et `config/`). Dans les **Settings → Build** du service, définissez le **Dockerfile Path** sur `backend/Dockerfile` et laissez le **Root Directory** à la racine du dépôt. Sinon, Railway ne trouvera pas de Dockerfile — ou construira avec le mauvais contexte et échouera.
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
