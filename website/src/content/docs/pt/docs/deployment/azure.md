---
sourceHash: 44b8d8c5aa0525b6
title: Implementando o Rebase no Microsoft Azure
description: Implante sua instância Rebase de forma segura no Azure usando o Azure Database for PostgreSQL e o Azure Container Apps.
sidebar_label: Azure
---

O Microsoft Azure oferece integrações rigorosas e conformidade empresarial. A arquitetura ideal para executar o Rebase no Azure envolve o uso do **Azure Database for PostgreSQL - Flexible Server** para a camada de dados e do **Azure Container Apps** para hospedar o contêiner de backend.

Para aderir à conformidade de dados europeia e tempos de resposta locais rápidos, provisione seus recursos em regiões como **Europa Ocidental (Amesterdã)**, **Europa do Norte (Irlanda)** ou **França Central (Paris)**.

## 1. Provisionar Servidor Flexível PostgreSQL

**Não há nenhuma imagem de aplicação para construir a partir do seu código**. O `rebase build` produz um diretório `dist-bundle` com as suas coleções, funções e crons compilados — e, se o projeto declarar uma app estática, o seu frontend construído. A imagem de runtime publicada executa-o:

```bash
rebase build
```

O Container Apps puxa de um registo, por isso incorpore o bundle numa imagem derivada. Três linhas, e fixa exatamente o que corre:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.17.3
COPY dist-bundle /bundle
```

Atualizar o Rebase mais tarde é uma alteração nessa linha `FROM`. O seu bundle fica intacto.

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
3. Construa e envie a partir da raiz do projeto:
   ```bash
   docker build -t yourregistryname.azurecr.io/rebase-backend:latest .
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

## 4. Criar o Esquema do Banco de Dados

Ao iniciar, o Rebase cria automaticamente **apenas as tabelas de autenticação**. As tabelas das suas próprias coleções **não** são criadas automaticamente. A aplicação sobe normalmente e o login funciona — por isso a armadilha passa despercebida —, mas toda coleção retorna um erro de tabela ausente ("missing table") até você aplicar o esquema.

Execute `pnpm run db:push` **uma vez** contra o banco de dados de produção:

```bash
DATABASE_URL="<sua string de conexão do Azure Postgres>" pnpm run db:push
```

Rode isso a partir de um checkout do projeto ou da sua CI, com a `DATABASE_URL` apontando para produção — **não** dentro do contêiner, pois a imagem de produção não inclui a CLI. Se o seu Flexible Server restringe o acesso público, adicione uma regra de firewall temporária para o seu IP no portal do Azure antes de executar o comando.

Para migrações versionadas, use `pnpm run db:generate` seguido de `pnpm run db:migrate` em vez de `db:push`.
