---
title: Implementando o Rebase no Microsoft Azure
description: Implante sua instância Rebase de forma segura no Azure usando o Azure Database for PostgreSQL e o Azure Container Apps.
sidebar_label: Azure
---

O Microsoft Azure oferece integrações rigorosas e conformidade empresarial. A arquitetura ideal para executar o Rebase no Azure envolve o uso do **Azure Database for PostgreSQL - Flexible Server** para a camada de dados e do **Azure Container Apps** para hospedar o contêiner de backend.

Para aderir à conformidade de dados europeia e tempos de resposta locais rápidos, provisione seus recursos em regiões como **Europa Ocidental (Amesterdã)**, **Europa do Norte (Irlanda)** ou **França Central (Paris)**.

## 1. Provisionar Servidor Flexível PostgreSQL

1. No Portal do Azure, procure e selecione **servidores do Azure Database for PostgreSQL**.
2. Clique em **Criar** e selecione **Servidor Flexível**.
3. Escolha seu Grupo de Recursos e defina sua Região da UE preferida.
4. Selecione seu tamanho de Computação (por exemplo, Uso Geral ou Burstable `B2s` para implantações menores).
5. Configure a guia **Autenticação** com um nome de usuário de Administrador e uma senha segura.
6. Em **Rede**, certifique-se de que "Permitir acesso público de qualquer serviço do Azure dentro do Azure a este servidor" esteja marcado para que seu Aplicativo de Contêiner possa se conectar, ou configure uma VNet segura.
7. Anote o nome do seu servidor e monte o URI de conexão:
   `postgresql://your_admin:YOUR_PASSWORD@your-server-name.postgres.database.azure.com:5432/postgres`

## 2. Compilar e Enviar para o Azure Container Registry (ACR)

Os Aplicativos de Contêiner do Azure puxarão sua imagem Docker do ACR.
1. Crie um novo **Registro de Contêiner** na região da UE escolhida.
2. Faça login a partir da sua CLI:
   ```bash
   az acr login --name YourRegistryName
   ```
3. Compile e envie a imagem Rebase do seu repositório local:
   ```bash
   docker build -t yourregistryname.azurecr.io/rebase-backend:latest ./backend
   docker push yourregistryname.azurecr.io/rebase-backend:latest
   ```

## 3. Implantar o Aplicativo de Contêiner do Azure

O Azure Container Apps fornece um ambiente de contêiner sem servidor com ingresso HTTPS integrado.

1. Pesquise no portal por **Container Apps** e clique em **Criar**.
2. Crie um novo Ambiente de Container Apps na sua região da UE.
3. Na guia **Contêiner**, aponte para o seu registro ACR e selecione a imagem `rebase-backend:latest`.
4. Defina as **Variáveis de ambiente**:

| Nome | Valor |
|------|-------|
| `DATABASE_URL` | Sua string de conexão do Azure Postgres |
| `JWT_SECRET` | Uma string segura aleatória com 32+ caracteres |
| `NODE_ENV` | `production` |

5. Na guia **Ingresso**, habilite explicitamente o Ingresso.
6. Defina a Porta de Destino para **3001**.
7. Conclua a criação. O Azure provisionará automaticamente o contêiner e fornecerá uma URL de aplicativo protegida com TLS!
