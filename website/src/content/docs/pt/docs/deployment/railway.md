---
sourceHash: 4d7e2205e3aed6fc
title: Implementando o Rebase no Railway
description: Implemente o Rebase sem esforço com o Railway, que oferece suporte nativo à análise de Dockerfile. Mantenha o foco na UE.
sidebar_label: Railway
---

Railway é uma PaaS (Plataforma como Serviço) moderna incrivelmente popular que elimina a complexidade do DevOps. Ele detectará automaticamente o framework Node Rebase e o construirá sem problemas.

Além disso, o Railway oferece suporte total a regiões de implantação europeias (Amsterdã), o que significa que você ainda desfruta de uma estrita conformidade regional de hospedagem.

## 1. Crie um Projeto e uma Região da UE
1. Faça login na sua [Conta Railway](https://railway.app/).
2. Clique em **New Project**.
3. Vá para **Settings -> Default Region** e defina explicitamente como **Europe (Amsterdam)**. (Se você fizer isso *depois* de criar serviços, pode ser necessário migrá-los manualmente).

## 2. Provisione o PostgreSQL
1. Dentro do seu projeto, clique em **New** -> **Database** -> **Add PostgreSQL**.
2. Espere alguns segundos para o banco de dados ser provisionado.
3. Por padrão, o Railway fornece uma variável interna `DATABASE_URL`. Clique no widget do Postgres -> **Variables** para localizar esta string de conexão.

## 3. Implemente o Código Rebase
1. Clique em **New** -> **GitHub Repo**.
2. Selecione seu repositório Rebase.
3. O Railway detectará imediatamente o repositório e procurará por um `Dockerfile`. Espere o início da construção inicial.

:::caution
**Não há nenhuma imagem de aplicação para construir a partir do seu código**. O `rebase build` produz um diretório `dist-bundle` com as suas coleções, funções e crons compilados — e, se o projeto declarar uma app estática, o seu frontend construído. A imagem de runtime publicada executa-o:

```bash
rebase build
```

O Railway puxa de um registo, por isso incorpore o bundle numa imagem derivada. Três linhas, e fixa exatamente o que corre:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.17.3
COPY dist-bundle /bundle
```

Atualizar o Rebase mais tarde é uma alteração nessa linha `FROM`. O seu bundle fica intacto.
:::

## 4. Defina as Variáveis de Ambiente
A construção inicial pode falhar porque está completamente sem configuração. Vamos corrigir isso.

1. Clique no novo cartão de serviço GitHub do Rebase.
2. Vá para a aba **Variables**.
3. Clique em **New Variable** e adicione:
   - `JWT_SECRET`: Gere uma string aleatória segura de 32+ caracteres.
   - `NODE_ENV`: Defina como `production`
4. Clique em **Reference Variable** e selecione `DATABASE_URL` do serviço PostgreSQL que você provisionou. O Railway injetará com segurança a URL interna do Postgres em tempo de execução.

## 5. Exponha o Domínio
1. No cartão de serviço Rebase, navegue até a aba **Settings**.
2. Role para baixo até **Networking**.
3. Em **Public Networking**, clique em **Generate Domain**. O Railway fornecerá uma URL de teste `.up.railway.app`. Você também pode anexar com segurança um Domínio Personalizado aqui.

O Railway reconstruirá automaticamente com segurança. Sua plataforma hospedada na UE agora está totalmente ativa!

## 6. Criar o Esquema do Banco de Dados

Ao iniciar, o Rebase cria automaticamente **apenas as tabelas de autenticação**. As tabelas das suas próprias coleções **não** são criadas automaticamente. A aplicação sobe normalmente e o login funciona — por isso a armadilha passa despercebida —, mas toda coleção retorna um erro de tabela ausente ("missing table") até você aplicar o esquema.

Execute `pnpm run db:push` **uma vez** contra o banco de dados de produção:

```bash
DATABASE_URL="<string de conexão pública do Postgres>" pnpm run db:push
```

Rode isso a partir de um checkout do projeto ou da sua CI, com a `DATABASE_URL` apontando para produção — **não** dentro do contêiner, pois a imagem de produção não inclui a CLI. Use a string de conexão pública do serviço PostgreSQL do Railway (a aba **Variables** também expõe uma variável `DATABASE_PUBLIC_URL`) para alcançar o banco a partir da sua máquina.

Para migrações versionadas, use `pnpm run db:generate` seguido de `pnpm run db:migrate` em vez de `db:push`.

---
