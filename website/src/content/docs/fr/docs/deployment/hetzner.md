---
title: Déploiement de Rebase sur Hetzner Cloud
description: Découvrez comment déployer Rebase sur Hetzner Cloud en utilisant Docker Compose pour d'excellentes performances basées dans l'UE et une souveraineté des données.
sidebar_label: Hetzner Cloud
---

Hetzner Cloud est largement reconnu pour offrir d'incroyables ratios performance/prix et constitue un choix de premier ordre pour les projets nécessitant une stricte souveraineté des données européennes et une conformité au RGPD (avec des centres de données à Nuremberg, Falkenstein et Helsinki).

Le déploiement de Rebase sur Hetzner est plus facile via Docker Compose sur une instance cloud Ubuntu standard.

## 1. Provisionner un serveur

1. Connectez-vous à votre console Hetzner Cloud.
2. Cliquez sur **Ajouter un serveur**.
3. Choisissez votre emplacement préféré (par exemple, **Falkenstein** ou **Nuremberg**).
4. Choisissez une image : Sélectionnez **Ubuntu 24.04** ou **App -> Docker CE** (cela pré-installe Docker pour vous).
5. Choisissez un type : Un `CPX21` (3 cœurs, 4 Go de RAM) ou `CX32` (4 cœurs, 8 Go de RAM) offre une excellente base de calcul pour l'exécution de Rebase + Postgres.
6. Ajoutez votre clé SSH et cliquez sur **Créer**.

## 2. SSH et configuration

Une fois votre serveur provisionné, récupérez l'adresse IP publique.

```bash
ssh root@<your-server-ip>
```

Si vous n'avez pas choisi l'image Docker, installez Docker et Docker Compose explicitement :

```bash
apt update && apt install docker.io docker-compose-v2 -y
```

## 3. Cloner et configurer Rebase

Clonez votre projet Rebase directement sur l'instance du serveur. 

```bash
git clone https://github.com/your-username/your-rebase-repo.git /opt/rebase
cd /opt/rebase
```

Rebase fournit un `docker-compose.yml` prêt à l'emploi. Vous devrez définir vos variables d'environnement de production. Créez un fichier `.env.production` :

```bash
nano .env.production
```

Ajoutez vos secrets :

```env
DATABASE_URL=postgresql://rebase_app:your_secure_db_password@postgres:5432/rebase
JWT_SECRET=generate_a_very_long_secure_random_string_here
NODE_ENV=production
```

*Assurez-vous de mettre à jour `docker-compose.yml` si vous souhaitez extraire le mot de passe Postgres d'une variable d'environnement.*

## 4. Exécuter la pile

Mettez la pile en ligne en utilisant le mode détaché :

```bash
docker compose --env-file .env.production up -d --build
```

Docker construira votre backend Node.js à partir du `Dockerfile` local et démarrera le conteneur Postgres. Une fois terminé, votre application fonctionnera sur `http://localhost:3001` (interne au serveur).

## 5. Exposer via Caddy ou Nginx

Vous ne devriez jamais exposer le port 3001 directement à Internet sans SSL. Nous recommandons de placer **Caddy** devant votre instance Rebase pour provisionner automatiquement les certificats Let's Encrypt.

Installer Caddy :
```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install caddy
```

Modifiez votre Caddyfile :
```bash
nano /etc/caddy/Caddyfile
```

Ajoutez ce qui suit (remplacez par votre domaine, dont l'enregistrement A doit pointer vers cette IP Hetzner) :

```caddyfile
admin.yourdomain.com {
    reverse_proxy localhost:3001
}
```

Redémarrez Caddy :
```bash
systemctl restart caddy
```

Et voilà ! Votre plateforme Rebase est hébergée en toute sécurité entièrement au sein de l'UE.

## 6. Créer le schéma de base de données

La pile est en cours d'exécution, mais Rebase ne crée automatiquement que les tables d'**authentification** au démarrage — les tables de vos propres collections ne sont **pas** créées automatiquement. Exécutez cette commande une fois sur la base de données de production, sinon chaque collection renverra une erreur « missing table ». Depuis le checkout de votre projet sur le serveur (avec les dépendances installées), faites pointer `DATABASE_URL` vers le conteneur Postgres et poussez le schéma :

```bash
pnpm run db:push
```

Pour des migrations versionnées, validez les fichiers de migration avec `pnpm run db:generate` et exécutez `pnpm run db:migrate` à la place. Au démarrage, le serveur affiche un avertissement encadré indiquant exactement quelles tables sont manquantes et la commande à exécuter.

---
