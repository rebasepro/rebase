---
sourceHash: 0633ef5ec34074cf
title: Deploy do Rebase no Google Cloud Platform
description: Implante sua instância do Rebase com segurança no GCP usando Cloud SQL e Cloud Run, com foco em regiões de data center da UE.
sidebar_label: Google Cloud
---

O Google Cloud Platform (GCP) oferece uma experiência de desenvolvimento integrada para aplicações em contêineres. Para uma configuração robusta de produção, use o **Cloud SQL** para o banco de dados e o **Cloud Run** para o runtime.

Para manter uma conformidade rigorosa com as regulamentações europeias de dados, opere inteiramente dentro de uma região da UE, como **europe-west3 (Frankfurt)**, **europe-west9 (Paris)** ou **europe-west1 (Bélgica)**.

Nada nesta página é específico do GCP em relação ao seu projeto. Um deploy do Rebase é composto por duas partes separáveis — a imagem de runtime publicada e o **bundle** que o `rebase build` produz — e o mesmo bundle roda no Docker Compose em um notebook, no Rebase Cloud, sob o [Helm chart](/docs/deployment/kubernetes) e aqui.

## 1. Provisionar o Cloud SQL (PostgreSQL)

1. Navegue até o console do **Cloud SQL** na sua região preferida da UE.
2. Clique em **Create Instance** e selecione **PostgreSQL**.
3. Defina o ID da sua instância e gere uma senha segura para o usuário `postgres`.
4. Expanda **Configuration Options** para escolher um tipo de máquina (duas vCPUs é um bom começo).
5. Configure um IP privado ou uma rede pública autorizada, dependendo de como o Cloud Run irá acessá-lo.
6. Monte sua URI de conexão:
   `postgresql://postgres:YOUR_PASSWORD@YOUR_IP:5432/postgres`

Se as suas coleções declararem uma propriedade `vector`, habilite a extensão uma vez no banco de dados: `CREATE EXTENSION vector;`.

## 2. Compilar o bundle e incorporá-lo a uma imagem

Não há **nenhuma imagem de aplicação para compilar a partir do seu código-fonte**. O comando `rebase build` gera um diretório `dist-bundle` com suas coleções compiladas, funções, crons e — se o seu projeto declarar um app estático — seu frontend compilado. A imagem de runtime publicada é responsável por executá-lo:

```bash
rebase build
```

O Cloud Run baixa imagens de um registro (registry), portanto, incorpore o bundle em uma imagem derivada. São apenas três linhas, e isso fixa com precisão o que será executado:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.20.0
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

Atualizar o Rebase no futuro exige apenas a alteração dessa linha `FROM`. O seu bundle permanece inalterado.

## 3. Fazer o deploy no Cloud Run

```bash
gcloud run deploy rebase-backend \
  --image europe-west3-docker.pkg.dev/YOUR_PROJECT_ID/rebase/backend:latest \
  --region europe-west3 \
  --set-env-vars NODE_ENV="production",CORS_ORIGINS="https://yourdomain.com",FRONTEND_URL="https://yourdomain.com",DISABLE_SELF_REGISTRATION="true",REBASE_ADMIN_EMAIL="you@yourdomain.com" \
  --set-secrets DATABASE_URL=rebase-database-url:latest,JWT_SECRET=rebase-jwt-secret:latest,REBASE_SERVICE_KEY=rebase-service-key:latest,REBASE_ADMIN_PASSWORD=rebase-admin-password:latest \
  --allow-unauthenticated
```

O Cloud Run injeta a variável `PORT` e o runtime se vincula a ela, portanto não há porta a ser configurada. Aponte a probe de inicialização (startup probe) para `/livez` em vez de `/health`: a segunda executa uma viagem de ida e volta ao banco de dados, de modo que uma liveness probe configurada nela reiniciaria uma revisão saudável durante uma breve oscilação do banco.

`REBASE_ADMIN_EMAIL` e `REBASE_ADMIN_PASSWORD` são a única forma pela qual este serviço recebe um administrador: em produção, a primeira conta registrada não é promovida automaticamente, portanto nada mais gerará o primeiro usuário autenticado. Defina-os antes que a primeira revisão comece a receber tráfego — veja [Seu primeiro admin](/docs/getting-started/deployment/#your-first-admin).

A flag `--set-env-vars` substitui **todo** o bloco de ambiente a cada deploy; portanto, um deploy posterior que omita uma variável irá removê-la silenciosamente. Mantenha a lista completa no seu script de deploy.

O acesso a uma instância privada do Cloud SQL requer `--add-cloudsql-instances YOUR_PROJECT:REGION:INSTANCE` e uma `DATABASE_URL` no formato de socket; uma instância pública com uma rede autorizada não necessita de nenhum dos dois.

## 4. O schema

**O runtime cria tabelas ausentes durante a inicialização, incluindo as de suas coleções.** A variável `REBASE_MIGRATE_ON_BOOT` tem como padrão `ensure`, que é aditiva em todo o schema — ela cria tabelas, colunas e tipos enum ausentes, além de aplicar suas políticas de segurança a nível de linha (RLS) —, de modo que a primeira inicialização em uma instância vazia já entra em operação atendendo suas coleções.

O que o `ensure` nunca faz é alterar algo que já existe: ele não altera o tipo de uma coluna, não remove nada nem edita os rótulos de um enum existente, pois uma revisão inicializando não deve remodelar um schema como efeito colateral de um deploy.

Portanto, duas situações ainda exigem a CLI, executada a partir de uma cópia local ou de um job de CI:

```bash
rebase db push
```

- **RLS em tabelas de junção (junction tables)** para relações muitos-para-muitos.
- **Qualquer alteração que não seja puramente aditiva** — uma coluna renomeada, um tipo restringido, um campo removido.

A partir da sua máquina, conecte-se usando o [Cloud SQL Auth Proxy](https://cloud.google.com/sql/docs/postgres/sql-proxy) e aponte a `DATABASE_URL` para `localhost`. A imagem de runtime é distribuída sem a CLI, portanto isso nunca roda dentro do contêiner do Cloud Run. Para migrações versionadas, faça o commit dos arquivos de migração com `rebase db generate` e execute `rebase db migrate` como uma etapa da release.

## Armazenamento de arquivos

Instâncias do Cloud Run são efêmeras e não guardam estado (stateless), portanto o armazenamento local de arquivos resulta em perda silenciosa de dados e o runtime o recusa em produção.

1. Crie um bucket privado no Google Cloud Storage na sua região escolhida da UE.
2. Defina `STORAGE_TYPE=gcs` e o respectivo bucket — veja [Armazenamento](/docs/backend/storage). No Cloud Run, a conta de serviço do próprio ambiente fornece as credenciais necessárias, então não há mais nada a configurar.

:::caution
O Cloud Run reduz instâncias a zero (scale to zero). Se o seu projeto usa assinaturas em tempo real, defina `--min-instances 1` — as conexões WebSocket são encerradas quando uma instância sofre redução de escala.
:::

## Próximos passos

- [Deploy](/docs/getting-started/deployment) — o checklist de produção e as regras para o primeiro admin comuns a todas as plataformas.
- [Configuração](/docs/getting-started/configuration) — todas as variáveis de ambiente lidas pelo runtime.

---
