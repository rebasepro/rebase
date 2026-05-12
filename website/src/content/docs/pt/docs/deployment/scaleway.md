---
title: Implementando Rebase no Scaleway
description: Aprenda como implementar o Rebase no Scaleway para uma infraestrutura de nuvem segura e baseada na França usando Containers Serverless.
sidebar_label: Scaleway
---

Scaleway é um provedor de nuvem europeu de destaque baseado na França, com datacenters em Paris, Amsterdã e Varsóvia. É uma excelente escolha para organizações que priorizam a soberania de dados da UE.

Recomendamos utilizar o **Managed Database** da Scaleway para um suporte Postgres confiável e **Serverless Containers** para escalar dinamicamente a aplicação Rebase Node.js.

## 1. Criar um Banco de Dados Postgres Gerenciado

Os Managed Databases da Scaleway oferecem backups automáticos e alta disponibilidade.

1. No Console Scaleway, vá para **PostgreSQL**.
2. Clique em **Criar uma Instância de Banco de Dados**.
3. Escolha uma Região (ex: Paris - `PAR1`).
4. Selecione um Tipo de Nó (um padrão **Play2-Pico** ou **Pro2-XXS** funciona bem).
5. Adicione um nome de banco de dados (`rebase_db`) e defina uma senha de usuário incrivelmente segura.
6. Após a implantação, anote a **string de conexão** (URI) do painel. Ela terá a seguinte aparência:
   `postgres://user:password@ip:port/rebase_db`

## 2. Construir e Enviar o Contêiner

Os Scaleway Serverless Containers executam imagens Docker padrão. Primeiro, construa o backend Rebase localmente e envie-o para o Scaleway Container Registry.

1. Vá para **Container Registry** no Console Scaleway e crie um Namespace (ex: `rebase-apps`).
2. Faça login no registro a partir do seu terminal local usando as instruções fornecidas.
3. Construa sua aplicação Rebase usando o `Dockerfile` gerado:

```bash
docker build -t rg.fr-par.scw.cloud/rebase-apps/rebase-backend:latest ./backend
```

4. Envie a imagem:

```bash
docker push rg.fr-par.scw.cloud/rebase-apps/rebase-backend:latest
```

## 3. Implementar Contêiner Serverless

Agora implemente a imagem de forma totalmente serverless sem gerenciar infraestrutura.

1. Navegue até **Serverless Containers**.
2. Clique em **Criar um Contêiner**.
3. Escolha a imagem que você acabou de enviar do Container Registry.
4. Defina a Porta para **3001**.
5. Em Variáveis de Ambiente, adicione o seguinte de forma segura:

| Chave | Valor |
|-----|-------|
| `DATABASE_URL` | O URI da sua etapa de Postgres Gerenciado |
| `JWT_SECRET` | Uma string aleatória segura de 32+ caracteres para assinar tokens de autenticação |
| `NODE_ENV` | `production` |

6. Clique em **Implementar Contêiner**.

A Scaleway provisionará imediatamente o contêiner e fornecerá um URL de endpoint público (ex: `https://rebase-backend-xxxx.functions.fnc.fr-par.scw.cloud`).

*Nota: Para conformidade de dados rigorosa, verifique se os detalhes da sua Organização Scaleway refletem sua entidade corporativa europeia.*
