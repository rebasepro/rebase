---
title: Implementando Rebase na Hetzner Cloud
description: Aprenda como implementar o Rebase na Hetzner Cloud usando Docker Compose para excelente desempenho baseado na UE e soberania de dados.
sidebar_label: Nuvem Hetzner
---

A Hetzner Cloud é amplamente reconhecida por oferecer incríveis relações desempenho-preço e é uma das principais escolhas para projetos que exigem estrita soberania de dados europeia e conformidade com o GDPR (com datacenters em Nuremberg, Falkenstein e Helsinque).

Implementar o Rebase na Hetzner é mais fácil via Docker Compose em uma instância de nuvem Ubuntu padrão.

## 1. Provisionar um Servidor

1. Faça login no seu Console Hetzner Cloud.
2. Clique em **Adicionar Servidor**.
3. Escolha sua Localização preferida (ex: **Falkenstein** ou **Nuremberg**).
4. Escolha uma Imagem: Selecione **Ubuntu 24.04** ou **Aplicativo -> Docker CE** (isso pré-instala o Docker para você).
5. Escolha um Tipo: Um `CPX21` (3 núcleos, 4GB RAM) ou `CX32` (4 núcleos, 8GB RAM) oferece excelente capacidade computacional de base para executar o Rebase + Postgres.
6. Adicione sua chave SSH e clique em **Criar**.

## 2. SSH e Configuração

Assim que seu servidor for provisionado, obtenha o endereço IP público.

```bash
ssh root@<your-server-ip>
```

Se você não escolheu a imagem Docker, instale o Docker e o Docker Compose explicitamente:

```bash
apt update && apt install docker.io docker-compose-v2 -y
```

## 3. Clonar e Configurar o Rebase

Clone seu projeto Rebase diretamente na instância do servidor. 

```bash
git clone https://github.com/your-username/your-rebase-repo.git /opt/rebase
cd /opt/rebase
```

O Rebase fornece um `docker-compose.yml` pronto para uso. Você precisará definir suas variáveis de ambiente de produção. Crie um arquivo `.env.production`:

```bash
nano .env.production
```

Adicione seus segredos:

```env
DATABASE_URL=postgresql://rebase_app:your_secure_db_password@postgres:5432/rebase
JWT_SECRET=generate_a_very_long_secure_random_string_here
NODE_ENV=production
```

*Certifique-se de atualizar `docker-compose.yml` se quiser puxar a senha do Postgres de uma variável de ambiente.*

## 4. Executar a Pilha

Coloque a pilha online usando o modo desanexado:

```bash
docker compose --env-file .env.production up -d --build
```

O Docker construirá seu backend Node.js a partir do `Dockerfile` local e iniciará o contêiner Postgres. Uma vez concluído, seu aplicativo estará em execução em `http://localhost:3001` (interno ao servidor).

## 5. Criar o Esquema do Banco de Dados

Ao iniciar, o Rebase cria automaticamente **apenas as tabelas de autenticação**. As tabelas das suas próprias coleções **não** são criadas automaticamente. A aplicação sobe normalmente e o login funciona — por isso a armadilha passa despercebida —, mas toda coleção retorna um erro de tabela ausente ("missing table") até você aplicar o esquema.

Execute `pnpm run db:push` **uma vez** contra o banco de dados de produção. Na Hetzner você já tem o repositório clonado no servidor (`/opt/rebase`), então rode o comando ali mesmo, a partir desse checkout, com a `DATABASE_URL` apontando para o contêiner Postgres pela porta publicada:

```bash
cd /opt/rebase
DATABASE_URL="postgresql://rebase_app:your_secure_db_password@localhost:5432/rebase" pnpm run db:push
```

Execute isso a partir de um checkout do projeto (aqui, o que já está no servidor) — **não** dentro do contêiner da aplicação, pois a imagem de produção não inclui a CLI.

Para migrações versionadas, use `pnpm run db:generate` seguido de `pnpm run db:migrate` em vez de `db:push`.

## 6. Expor via Caddy ou Nginx

Você nunca deve expor a porta 3001 diretamente à internet sem SSL. Recomendamos colocar o **Caddy** na frente da sua instância Rebase para provisionar automaticamente certificados Let's Encrypt.

Instale o Caddy:
```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install caddy
```

Edite seu Caddyfile:
```bash
nano /etc/caddy/Caddyfile
```

Adicione o seguinte (substitua pelo seu domínio, que deve ter seu registro A apontando para este IP da Hetzner):

```caddyfile
admin.yourdomain.com {
    reverse_proxy localhost:3001
}
```

Reinicie o Caddy:
```bash
systemctl restart caddy
```

É isso! Sua plataforma Rebase está hospedada de forma segura inteiramente dentro da UE.

---
