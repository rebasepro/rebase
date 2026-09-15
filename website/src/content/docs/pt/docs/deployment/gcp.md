---
sourceHash: d94623367174cfaa
title: Implantando o Rebase no Google Cloud Platform
description: Implante sua instância do Rebase com segurança no GCP usando Cloud SQL e Cloud Run, com foco em regiões de data center da UE.
sidebar_label: Google Cloud
---

O Google Cloud Platform (GCP) oferece uma experiência de desenvolvedor fluida para aplicações conteinerizadas. Para uma configuração de produção robusta, use o **Cloud SQL** para o banco de dados e o **Cloud Run** para o runtime.

Para manter a conformidade estrita com as regulamentações europeias de dados, opere inteiramente dentro de uma região da UE, como **europe-west3 (Frankfurt)**, **europe-west9 (Paris)** ou **europe-west1 (Bélgica)**.

Nada nesta página é específico do GCP em relação ao seu projeto. Uma implantação do Rebase é composta por duas partes separáveis — a imagem de runtime publicada e o **bundle** que o `rebase build` produz — e o mesmo bundle pode ser executado no Docker Compose em um computador pessoal, no Rebase Cloud, através do [Helm chart](/docs/deployment/kubernetes) e aqui.

## 1. Provisionar o Cloud SQL (PostgreSQL)

1. Navegue até o console do **Cloud SQL** na sua região preferida da UE.
2. Clique em **Create Instance** e selecione **PostgreSQL**.
3. Defina o seu Instance ID e gere uma senha segura para o usuário `postgres`.
4. Expanda **Configuration Options** para escolher um tipo de máquina (duas vCPUs é um bom começo).
5. Configure um IP Privado ou uma rede pública autorizada, dependendo de como o Cloud Run irá acessá-lo.
6. Monte a sua URI de conexão:
   `postgresql://postgres:YOUR_PASSWORD@YOUR_IP:5432/postgres`

Se suas coleções declararem uma propriedade `vector`, habilite a extensão uma vez: execute `CREATE EXTENSION vector;` no banco de dados.

## 2. Construir o bundle e empacotá-lo em uma imagem

Não há **nenhuma imagem de aplicação para construir a partir do seu código-fonte**. O `rebase build` produz um diretório `dist-bundle` com suas coleções compiladas, funções, crons e — se o seu projeto declarar um app estático — seu frontend compilado. A imagem de runtime publicada o executa:

```bash
rebase build
```

O Cloud Run baixa imagens de um registro (registry), portanto, empacote o bundle em uma imagem derivada. Três linhas são suficientes para fixar exatamente o que será executado:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.21.1
COPY dist-bundle /bundle
```

```bash
# Set your active GCP project
gcloud config set project YOUR_PROJECT_ID

# Create an Artifact Registry repository (one-time)
gcloud artifacts repositories create rebase --repository-format=docker --location=europe-west3

# Authenticate Docker to Artifact Registry (one-time)
gcloud auth configure-docker europe-west3-docker.pkg.dev

# Build from the project root and push
docker build -t europe-west3-docker.pkg.dev/YOUR_PROJECT_ID/rebase/backend:latest .
docker push europe-west3-docker.pkg.dev/YOUR_PROJECT_ID/rebase/backend:latest
```

Atualizar o Rebase posteriormente se resume a alterar essa linha `FROM`. O seu bundle permanece intocado.

## 3. Fazer o deploy no Cloud Run

```bash
gcloud run deploy rebase-backend \
  --image europe-west3-docker.pkg.dev/YOUR_PROJECT_ID/rebase/backend:latest \
  --region europe-west3 \
  --set-env-vars NODE_ENV="production",CORS_ORIGINS="https://yourdomain.com",FRONTEND_URL="https://yourdomain.com",DISABLE_SELF_REGISTRATION="true",REBASE_ADMIN_EMAIL="you@yourdomain.com" \
  --set-secrets DATABASE_URL=rebase-database-url:latest,JWT_SECRET=rebase-jwt-secret:latest,REBASE_SERVICE_KEY=rebase-service-key:latest,REBASE_ADMIN_PASSWORD=rebase-admin-password:latest \
  --allow-unauthenticated
```

O Cloud Run injeta a variável `PORT` e o runtime vincula-se a ela, portanto, não há porta a ser configurada. Aponte a probe de inicialização (startup probe) para `/livez` em vez de `/health`: a segunda realiza uma operação completa de ida e volta ao banco de dados (round-trip), fazendo com que uma verificação de liveness reinicie uma revisão perfeitamente saudável durante uma breve instabilidade no banco de dados.

`REBASE_ADMIN_EMAIL` e `REBASE_ADMIN_PASSWORD` são a maneira pela qual este serviço recebe um administrador: em produção, a primeira conta a se registrar não é promovida automaticamente, portanto nada mais gerará o primeiro usuário autenticado. Defina essas variáveis antes que a primeira revisão comece a receber tráfego — consulte [Seu primeiro administrador](/docs/getting-started/deployment/#your-first-admin).

`--set-env-vars` substitui **todo** o bloco de ambiente a cada deploy, o que significa que um deploy futuro que omita uma variável irá desativá-la silenciosamente. Mantenha a lista completa no seu script de deploy.

O acesso a uma instância privada do Cloud SQL exige `--add-cloudsql-instances YOUR_PROJECT:REGION:INSTANCE` e uma `DATABASE_URL` no formato de socket; uma instância pública com rede autorizada não requer nenhum dos dois.

## 4. O schema

**O runtime cria as tabelas ausentes durante a inicialização, incluindo as de suas coleções.** O valor padrão de `REBASE_MIGRATE_ON_BOOT` é `ensure`, que é aditivo em todo o schema — ele cria tabelas, colunas e tipos enum ausentes, além de aplicar a segurança em nível de linha (RLS) correspondente — de modo que a primeira inicialização em uma instância vazia já sobe pronta para servir suas coleções.

O que o `ensure` nunca faz é alterar algo que já existe: ele não altera o tipo de uma coluna, não exclui nada nem modifica os valores de um enum existente, pois uma revisão em processo de inicialização não deve remodelar o schema como efeito colateral de um deploy.

Por essa razão, dois cenários ainda exigem a CLI, executada localmente ou em um job de CI:

```bash
rebase db push
```

- **RLS em tabelas de junção (junction tables)** para relações muitos-para-muitos.
- **Qualquer alteração que não seja puramente aditiva** — renomear uma coluna, restringir um tipo de dado ou remover um campo.

A partir da sua máquina, conecte-se por meio do [Cloud SQL Auth Proxy](https://cloud.google.com/sql/docs/postgres/sql-proxy) e aponte `DATABASE_URL` para `localhost`. A imagem de runtime é distribuída sem a CLI, portanto esse comando nunca é executado dentro do contêiner do Cloud Run. Para migrações versionadas, faça commit dos arquivos de migração com `rebase db generate` e execute `rebase db migrate` como uma etapa da sua release.

## Armazenamento de arquivos

As instâncias do Cloud Run são stateless e efêmeras, portanto o armazenamento de arquivos local causará perda silenciosa de dados e o runtime o recusa em produção.

1. Crie um bucket privado no Google Cloud Storage na região da UE de sua escolha.
2. Defina `STORAGE_TYPE=gcs` e especifique o bucket — consulte [Armazenamento](/docs/backend/storage). No Cloud Run, a conta de serviço associada ao ambiente fornece as credenciais automaticamente, dispensando configurações adicionais.

:::caution
O Cloud Run escala para zero. Se o seu projeto usa assinaturas em tempo real (realtime subscriptions), defina `--min-instances 1` — conexões WebSocket são encerradas quando uma instância é desativada por escala reduzida.
:::

## Próximos passos

- [Implantação](/docs/getting-started/deployment) — o checklist de produção e as regras para o primeiro administrador comuns a todas as plataformas.
- [Configuração](/docs/getting-started/configuration) — todas as variáveis de ambiente lidas pelo runtime.
