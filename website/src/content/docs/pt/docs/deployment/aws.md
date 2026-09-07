---
sourceHash: 936afac32ad9dc9d
title: Implementando Rebase na AWS
description: Implante sua instância Rebase de forma segura na Amazon Web Services utilizando RDS e AWS App Runner com um forte foco europeu.
sidebar_label: AWS
---

A Amazon Web Services (AWS) oferece escalabilidade incrível e segurança de nível empresarial. Para uma implantação de produção do Rebase, recomendamos desacoplar a arquitetura usando o **Amazon RDS** para o banco de dados PostgreSQL e o **AWS App Runner** (ou ECS Fargate) para servir o backend Node.js.

Para manter a estrita conformidade de dados europeia, certifique-se de operar inteiramente dentro de uma região da UE, como **eu-central-1 (Frankfurt)**, **eu-west-1 (Irlanda)** ou **eu-west-3 (Paris)**.

## 1. Provisionar Amazon RDS (PostgreSQL)

1. Navegue até o console do **RDS** na sua região da UE selecionada.
2. Clique em **Criar banco de dados** e selecione **Criação padrão**.
3. Escolha o motor **PostgreSQL**.
4. Em Modelos, escolha **Produção** ou **Nível gratuito/Desenvolvimento** dependendo da sua carga.
5. Crie um Nome de Usuário Mestre (ex: `rebase_admin`) e gere uma Senha Mestra de forma segura.
6. Em Conectividade, certifique-se de que o banco de dados esteja dentro de uma **VPC** que sua futura instância do App Runner possa acessar com segurança (ou torne-o publicamente acessível se estiver controlando rigorosamente os intervalos de IP de entrada).
7. Uma vez provisionado, anote o **endereço do endpoint** e monte seu URI:
   `postgresql://rebase_admin:YOUR_PASSWORD@YOUR_ENDPOINT:5432/postgres`

## 2. Enviar Imagem para o ECR (Elastic Container Registry)

O AWS App Runner puxa diretamente do ECR.

**Não há nenhuma imagem de aplicação para construir a partir do seu código**. O `rebase build` produz um diretório `dist-bundle` com as suas coleções, funções e crons compilados — e, se o projeto declarar uma app estática, o seu frontend construído. A imagem de runtime publicada executa-o:

```bash
rebase build
```

O App Runner puxa de um registo, por isso incorpore o bundle numa imagem derivada. Três linhas, e fixa exatamente o que corre:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.17.3
COPY dist-bundle /bundle
```

Atualizar o Rebase mais tarde é uma alteração nessa linha `FROM`. O seu bundle fica intacto.

1. Navegue até o **Elastic Container Registry** e crie um novo repositório privado chamado `rebase-backend`.
2. Obtenha os comandos de push fornecidos pela AWS no console (que lidam com a autenticação Docker).
3. Construa e envie a partir da raiz do projeto:
   ```bash
   docker build -t rebase-backend .
   ```
4. Marque e envie-a para o seu repositório ECR recém-criado.

## 3. Implementar via AWS App Runner

O App Runner é a maneira mais simples de executar contêineres na AWS sem gerenciar orquestradores.

1. Navegue até o **AWS App Runner** e clique em **Criar serviço**.
2. Selecione **Registro de contêiner** e escolha **Amazon ECR**.
3. Procure e selecione sua imagem `rebase-backend`.
4. Em **Configurações do serviço**, defina a Porta para **3001**.
5. Adicione as Variáveis de Ambiente necessárias na aba de configuração:
   
| Chave | Valor |
|-----|-------|
| `DATABASE_URL` | Sua String de Conexão do RDS |
| `JWT_SECRET` | Um hash seguro gerado aleatoriamente (32+ caracteres) |
| `NODE_ENV` | `production` |

6. (Opcional) Se sua instância RDS for estritamente privada, configure a rede **VPC Personalizada** no App Runner para que o contêiner possa se comunicar com segurança com o banco de dados.
7. Clique em **Criar e implantar**.

A AWS lidará com a terminação TLS (fornecendo uma URL `https` pronta para uso) e iniciará o servidor Rebase.

## 4. Criar o Esquema do Banco de Dados

Ao iniciar, o Rebase cria automaticamente **apenas as tabelas de autenticação**. As tabelas das suas próprias coleções **não** são criadas automaticamente. A aplicação sobe normalmente e o login funciona — por isso a armadilha passa despercebida —, mas toda coleção retorna um erro de tabela ausente ("missing table") até você aplicar o esquema.

Execute `pnpm run db:push` **uma vez** contra o banco de dados de produção:

```bash
DATABASE_URL="<sua string de conexão do RDS>" pnpm run db:push
```

Rode isso a partir de um checkout do projeto ou da sua CI, com a `DATABASE_URL` apontando para produção — **não** dentro do contêiner, pois a imagem de produção não inclui a CLI. Como a instância RDS costuma ficar dentro de uma VPC privada, execute o comando a partir de uma máquina com acesso à rede (por exemplo, através de um host bastion) ou torne o endpoint do RDS temporariamente acessível a partir do seu IP.

Para migrações versionadas, use `pnpm run db:generate` seguido de `pnpm run db:migrate` em vez de `db:push`.

---
