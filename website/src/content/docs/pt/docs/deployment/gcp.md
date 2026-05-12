---
title: Implementando Rebase na Google Cloud Platform
description: Implemente sua instância Rebase de forma segura no GCP usando Cloud SQL e Cloud Run, com foco em regiões de data center da UE.
sidebar_label: Google Cloud
---

Google Cloud Platform (GCP) oferece uma experiência de desenvolvedor incrivelmente fluida para aplicações conteinerizadas. Para uma configuração de produção robusta, utilizamos o **Cloud SQL** para o banco de dados e o **Cloud Run** como a espinha dorsal de contêineres sem servidor.

Para manter a estrita conformidade de dados europeus, certifique-se de operar inteiramente dentro de uma região da UE, como **europe-west3 (Frankfurt)**, **europe-west9 (Paris)**, ou **europe-west1 (Bélgica)**.

## 1. Provisionar Cloud SQL (PostgreSQL)

1. Navegue até o console do **Cloud SQL** na sua região preferida da UE.
2. Clique em **Criar Instância** e selecione **PostgreSQL**.
3. Defina seu ID de Instância e gere uma senha segura integrada para o usuário `postgres`.
4. Expanda as **Opções de Configuração** para alocar o Tipo de Máquina correto (uma máquina padrão de 2 vCPUs é um ótimo começo).
5. Certifique-se de que o banco de dados esteja configurado para IP Privado ou redes de IP Público Autorizado, dependendo da sua configuração VCP com o Cloud Run.
6. Monte sua URI de conexão:
   `postgresql://postgres:YOUR_PASSWORD@YOUR_IP:5432/postgres`

## 2. Compilar e Implementar no Cloud Run

O Cloud Run dimensiona o backend Node.js do Rebase automaticamente para zero (se desejado) e gerencia o TLS de forma nativa. Você pode compilar e implementar a aplicação em um único movimento de CLI a partir do seu workspace local usando o Google Cloud Build.

Certifique-se de ter o CLI `gcloud` instalado e autenticado:

```bash
# Set your active GCP project
gcloud config set project YOUR_PROJECT_ID

# Submit the build to Cloud Build, which automatically creates the container image and stores it in Google Container Registry (GCR)
gcloud builds submit --tag gcr.io/YOUR_PROJECT_ID/rebase-backend ./backend

# Deploy the newly built image to Cloud Run
gcloud run deploy rebase-backend \
  --image gcr.io/YOUR_PROJECT_ID/rebase-backend \
  --region europe-west3 \
  --port 3001 \
  --set-env-vars DATABASE_URL="postgresql://...",JWT_SECRET="YOUR_SECURE_RANDOM_STRING",NODE_ENV="production" \
  --allow-unauthenticated
```

## 3. Gerenciar Armazenamento de Arquivos
Como as instâncias do Cloud Run são estritamente sem estado e efêmeras, você não pode usar armazenamento em disco local para uploads de arquivos do Rebase.

1. Navegue até o **Google Cloud Storage** e crie um novo bucket privado na região da UE escolhida.
2. Siga a [Documentação de Armazenamento do Rebase](/docs/storage) para configurar o Rebase para usar a API compatível com S3 fornecida pelo Google Cloud Storage em vez do sistema de arquivos local.

Sua instância Rebase está agora totalmente sem servidor e altamente escalável nativamente dentro da UE!
---
