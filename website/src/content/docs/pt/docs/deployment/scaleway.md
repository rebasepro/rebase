---
sourceHash: a83732a379b7739b
title: Implementando Rebase no Scaleway
description: Aprenda como implementar o Rebase no Scaleway para uma infraestrutura de nuvem segura e baseada na França usando Containers Serverless.
sidebar_label: Scaleway
---

Scaleway é um provedor de nuvem europeu de destaque baseado na França, com datacenters em Paris, Amsterdã e Varsóvia. É uma excelente escolha para organizações que priorizam a soberania de dados da UE.

Recomendamos utilizar o **Managed Database** da Scaleway para um suporte Postgres confiável e **Serverless Containers** para escalar dinamicamente a aplicação Rebase Node.js.

## 1. Criar um Banco de Dados Postgres Gerenciado

Os Managed Databases da Scaleway oferecem backups automáticos e alta disponibilidade.

**Não há nenhuma imagem de aplicação para construir a partir do seu código**. O `rebase build` produz um diretório `dist-bundle` com as suas coleções, funções e crons compilados — e, se o projeto declarar uma app estática, o seu frontend construído. A imagem de runtime publicada executa-o:

```bash
rebase build
```

O Serverless Containers puxa de um registo, por isso incorpore o bundle numa imagem derivada. Três linhas, e fixa exatamente o que corre:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.17.3
COPY dist-bundle /bundle
```

Atualizar o Rebase mais tarde é uma alteração nessa linha `FROM`. O seu bundle fica intacto.

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
3. Construa e envie a partir da raiz do projeto:

```bash
docker build -t rg.fr-par.scw.cloud/rebase-apps/rebase-backend:latest .
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

## 4. Criar o Esquema do Banco de Dados

Ao iniciar, o Rebase cria automaticamente **apenas as tabelas de autenticação**. As tabelas das suas próprias coleções **não** são criadas automaticamente. A aplicação sobe normalmente e o login funciona — por isso a armadilha passa despercebida —, mas toda coleção retorna um erro de tabela ausente ("missing table") até você aplicar o esquema.

Execute `pnpm run db:push` **uma vez** contra o banco de dados de produção:

```bash
DATABASE_URL="<o URI do seu Postgres Gerenciado>" pnpm run db:push
```

Rode isso a partir de um checkout do projeto ou da sua CI, com a `DATABASE_URL` apontando para produção — **não** dentro do contêiner, pois a imagem de produção não inclui a CLI. O Managed Database da Scaleway expõe um endpoint público, então use a mesma string de conexão do passo do Postgres Gerenciado para executar o comando a partir da sua máquina.

Para migrações versionadas, use `pnpm run db:generate` seguido de `pnpm run db:migrate` em vez de `db:push`.

*Nota: Para conformidade de dados rigorosa, verifique se os detalhes da sua Organização Scaleway refletem sua entidade corporativa europeia.*
