---
sourceHash: 6d4d1426d30011ff
title: Comandos de Banco de Dados
sidebar_label: Comandos de Banco de Dados
description: Os comandos rebase db — push, generate e migrate, backups e restaurações, extração de cópia, a string de conexão, o banco de dados de desenvolvimento gerenciado e branches.
---

## Visão geral

`rebase db` é a família de comandos que acessa o banco de dados do projeto. Cada
um opera no banco de dados que o projeto resolve, na ordem listada em
[Database Branching](/docs/backend/branching/#cli-integration):
`--database-url`, depois `DATABASE_URL` no shell, a branch para a qual o checkout está
alternado, `DATABASE_URL` no `.env`, `--docker`, e, caso contrário, o banco de dados de
desenvolvimento gerenciado que o `rebase dev` inicia. O `rebase db url` exibe qual deles
é.

`request-role` e `provision` são para um banco de dados que o Rebase não possui por completo;
consulte [Running on an existing or shared database](/docs/deployment/existing-database/).
`push`, `generate` e `migrate` são descritos em detalhes em
[Schema Generation](/docs/cli/schema/), e todos os outros comandos estão na
[CLI reference](/docs/cli/).

## Comandos

### `rebase db push`

Envie alterações de schema diretamente para o banco de dados (somente desenvolvimento):

```bash
rebase db push
```

`--database-url <url>` define o banco de dados, e `--docker` o do compose, iniciado
se necessário. `generate`, `migrate`, `branch`, `backup` e `restore` também aceitam ambos.

Ele mantém intacto o que suas declarações de tabela não descrevem: outras tabelas e
views, índices que você criou e as restrições CHECK e EXCLUDE em uma tabela declarada,
que uma declaração não pode expressar. Consulte
[`rebase db push`](/docs/cli/schema/#rebase-db-push) para saber o que ele aplica e
antes do que ele para.

:::caution
O `db push` modifica o banco de dados diretamente sem arquivos de migração. Use `db generate` + `db migrate` para produção.
:::

### `rebase db generate`

Gere arquivos de migração SQL a partir de alterações de schema:

```bash
rebase db generate
```

Cria arquivos de migração com registro de data/hora em `backend/drizzle/migrations/` que podem ser revisados e commitados.

### `rebase db migrate`

Execute migrações de banco de dados pendentes:

```bash
rebase db migrate
```

Aplica todas as migrações não aplicadas ao banco de dados.

Em um banco de dados que já foi inicializado (boot), a primeira migração cria tabelas
que o boot já criou, portanto, o primeiro `db migrate` ali para com `already exists`.
Em vez disso, registre essa migração como aplicada uma única vez:

```bash
rebase db migrate --baseline <version>
```

A versão é o prefixo numérico do arquivo de migração; o `db generate` imprime o
comando já preenchido com ela. Consulte
[`--baseline`](/docs/cli/schema/#rebase-db-migrate) para um banco de dados que já
registra migrações.

Depois disso, o `db migrate` aplica o que o boot não aplicou, e em um banco de dados
servido pelo `rebase dev` isso é menos do que parece. O boot adiciona cada nova tabela,
coluna e valor de enum assim que a declaração de uma tabela é alterada, portanto, no momento
em que o `db generate` grava a migração que adiciona uma coluna, a coluna já está lá:
esse `db migrate` para novamente com `already exists` e indica o
`--baseline <version>` que a registra. Cada nova propriedade significa outro
baseline. Registre uma migração apenas quando o boot tiver feito todas as alterações
contidas nela. Uma migração que também remove (drop), renomeia ou restringe algo contém
instruções que o boot nunca executa, e registrá-la ignora essas instruções. Em desenvolvimento,
o `rebase db push` é o comando que altera o schema; reserve o `db generate` e o `db migrate`
para um banco de dados que o boot ainda não tenha alterado.

### `rebase db backup` / `backups` / `restore`

```bash
rebase db backup --out ./backups        # or s3://bucket/prefix, gs://bucket/prefix
rebase db backups list                  # list what is stored
rebase db restore ./backups/<file>.dump --yes
```

`backup` executa o `pg_dump`; `restore` executa o `pg_restore` e, por ser destrutivo,
solicita a digitação de `yes` em um terminal, ou aceita `--yes`; sem terminal e sem
`--yes`, ele recusa e informa que o parâmetro deve ser passado.
Em um banco de dados
que já contém o que o backup cria, o `restore` precisa de `--clean`. Sem
ele, ele recusa a execução antes que qualquer coisa seja aplicada, incluindo as roles
de cluster, e indica os objetos conflitantes e as duas formas de contorná-los: `--clean`, ou
`--create-db --target-db <novo nome>`.
Com `--clean`,
a restauração ocorre em uma única transação: ela remove (drop) os schemas do backup com tudo
o que estiver contido neles, restaura e faz o commit somente quando toda a restauração tiver
sido concluída com sucesso; portanto, uma falha deixa o banco de dados como estava. Antes de
solicitar confirmação, ele lista o que irá remover que não está contido no backup. Ele executa
o `psql`, que vem junto com o `pg_restore`.
O `restore` recusa
o banco de dados de desenvolvimento gerenciado: um backup transporta suas linhas como dados
COPY, os quais ele não consegue receber.
Restaure no Postgres no Docker (`rebase db restore <dump> --docker --clean --yes`)
e, em seguida, `rebase db pull --from "$(rebase db url --docker)" --yes` o copia para
o banco de dados gerenciado. Um backup do banco de dados gerenciado o deixa como estava.
Caminhos relativos
e o padrão `./backups` são resolvidos em relação ao diretório no qual você executa o
`rebase`, de modo que as três linhas acima se encontram em um único diretório; uma
opção não aceita por um comando é recusada antes que qualquer ação seja executada.
O dump e seu arquivo de roles têm permissão de leitura apenas para você (0600) e,
em um banco de dados que não está em execução, `backup` e `restore` exibem o
mesmo aviso que o `db push`.
O agendamento, o arquivo de roles que acompanha cada dump e o procedimento de restauração estão em [Backups and restore](/docs/deployment/backups/).

### `rebase db pull`

Copie outro banco de dados para o de desenvolvimento local:

```bash
rebase db pull --from postgres://…  [--anonymize]
```

`--from` aceita uma URL `postgres://` ou `postgresql://`, ou pares
`host=… port=… dbname=…` da libpq entre aspas como um único argumento. Qualquer outra coisa
é recusada antes que algo seja lido ou iniciado, sem repetir o valor.

`--anonymize` substitui campos pessoais durante a importação, permitindo trabalhar
localmente em uma cópia de produção sem levar dados reais de clientes para um laptop. Ele
faz a correspondência de colunas pelo nome e opera por melhor esforço. Uma coluna simples
`name` é substituída apenas em uma tabela de pessoas: uma chamada `users`, `authors`,
`customers` ou similar, ou qualquer tabela que também contenha uma coluna de endereço de e-mail.
Uma coluna com um índice exclusivo recebe um valor distinto por linha, e a passagem ocorre em
uma transação única: se falhar, as tabelas que teriam sido reescritas são esvaziadas e
listadas, e o comando é encerrado com status 1.

Uma flag não
aceita pelo `pull` é recusada antes que algo seja lido ou copiado, indicando aquela que
provavelmente era a pretendida: `--anonymise` responde "did you mean --anonymize?" e
sai com status 1.
No `pull` e em todos os outros comandos, uma chave informada com valor o interpreta:
`--anonymize=true` ou `=1` a ativa, `--anonymize=false` ou `=0` a desativa,
e qualquer outro valor é recusado.

O `pg_dump` remove privilégios, portanto a cópia chegaria com as políticas de RLS
da origem e nenhuma das concessões (grants) por trás delas — fazendo com que toda leitura
como `rebase_user` falhe com `permission denied`. O pull reprovisiona a role da aplicação
em seguida, usando a mesma rotina que o boot e o `rebase db push` utilizam, garantindo que
as tabelas internas do Rebase permaneçam revogadas como devem.

O destino é sempre o banco de dados de desenvolvimento local deste projeto e não pode ser
escolhido: `--database-url` é recusado em vez de aceito, portanto não há como
solicitar um "pull para produção". `--from` é a única direção.

Um pull substitui
o conteúdo do banco de dados local: ele esvazia primeiro cada schema que copia, de modo
que uma tabela que existe apenas localmente não sobrevive a ele. Para o banco de dados de
desenvolvimento gerenciado, as linhas trafegam como instruções `INSERT`, que ele aceita
nos casos em que o `COPY` falharia.

### `rebase db url`

Exiba a string de conexão que este projeto está usando, e nada mais, permitindo o
uso com pipes:

```bash
rebase db url
psql "$(rebase db url)"
```

O banco de dados de desenvolvimento gerenciado é o caso que necessita disso: o `.env` deixa
o `DATABASE_URL` comentado de propósito, e a porta é derivada do caminho do
projeto, portanto nada em disco a especifica.
Ele mantém essa
porta entre uma parada e uma inicialização, a menos que outro processo a tenha ocupado. Quando você tiver definido seu próprio `DATABASE_URL`,
é isso que este comando exibe — a ordem de resolução é a mesma que todos os outros
comandos seguem. Ele inicia o banco de dados gerenciado caso ainda não esteja em execução.

Após
`rebase dev --docker`, o `db url` e os outros comandos usam esse banco de dados Docker
(e informam isso no stderr) até que um `rebase dev` seja executado sem a flag. A escolha é
mantida em `.rebase/dev-database.json` e tem a mesma prioridade que `--docker`, abaixo de qualquer
string de conexão. Um `--docker` digitado que seja superado por uma string de conexão
não inicia nenhum container: uma linha no stderr informa que ele foi ignorado, indica o que
prevaleceu e diz como acessar o Docker em vez disso. Um `rebase dev --docker` superado dessa
forma mantém a escolha memorizada como estava; portanto, assim que a string de conexão for
removida, os comandos voltam a seguir o Docker.

O `rebase init`
atribui a cada projeto sua própria porta do compose, de 5433 a 5632 de acordo com o caminho
do projeto, e o `--docker` verifica se o que responde nela é o container `db` deste projeto.
Quando outro container ou um Postgres fora do Docker ocupa a porta, ele para e o
identifica em vez de se conectar ao banco de dados de outra pessoa. Para mover o
projeto, altere a porta do host do serviço `db` em `docker-compose.yml`, e o
`DATABASE_URL` se o `.env` definir um.

### `rebase db stop` / `rebase db reset`

Somente para o banco de dados de desenvolvimento gerenciado:

```bash
rebase db stop     # stop it; the data is kept
rebase db reset    # delete it and start over
```

Ele pertence ao projeto, não ao comando que o iniciou; portanto, parar o
`rebase dev` o mantém em execução para os outros comandos. Após 30 minutos com
nenhuma conexão, ele para automaticamente, e o próximo comando que precisar dele o iniciará
novamente. O `rebase dev`
avisa isso ao parar, informando como parar o banco de dados imediatamente.

O `db stop` sob um
`rebase dev` em execução avisa que seu backend não poderá alcançar o banco de dados até
que ele retorne. O próximo comando que precisar dele, como o `rebase db url`, o iniciará
na mesma porta, e o backend se reconecta sem a necessidade de reinicialização.

### `rebase db request-role migrate`

Migre as requisições deste banco de dados de uma role do Postgres para outra:

```bash
rebase db request-role migrate --to <role[,role]> [--dry-run] [--yes]
```

As requisições são executadas como `rebase_user`, a menos que o projeto especifique outra role
(`REBASE_RLS_REQUEST_ROLE` ou `rls.requestRole`). Uma role pertence a todo o
cluster, portanto projetos que compartilham um devem ter suas próprias roles. A primeira
inicialização de provisionamento registra a role no banco de dados, e uma inicialização posterior
configurada com outra role se recusará a iniciar até que o banco de dados seja migrado.

O comando faz a migração a partir da role registrada no banco de dados, ou `rebase_user`. Em
uma única transação, ele cria a nova role se ela estiver ausente, permite que a conexão
alterne para ela, reemite apenas neste banco de dados todas as permissões (grants) que a role antiga
possui, reaponta as políticas que a referenciam e registra a nova role. A role antiga é
mantida como está, pois outro banco de dados no cluster pode estar usando-a. Em seguida,
ele imprime as instruções `REVOKE` que revogam as concessões da role antiga aqui,
para serem executadas quando nada mais precisar delas.

`--dry-run` imprime as instruções e os `REVOKE`s sem alterar nada. Em um
terminal, ele pergunta primeiro; sem terminal, ele recusa a execução sem `--yes`. Em seguida,
defina `REBASE_RLS_REQUEST_ROLE` para a nova role em todos os servidores que utilizam o
banco de dados. Consulte [Running on an existing or shared database](/docs/deployment/existing-database/).

### `rebase db provision --print`

Exiba o SQL que configura a(s) role(s) de requisição para este banco de dados, para que um
administrador de banco de dados possa executá-lo:

```bash
rebase db provision --print > request-role.sql
```

Para cada role de requisição, ele imprime as instruções que criam a role, concedem à
role de conexão o direito de alternar para ela e, sob o padrão
`grants: "schema"`, concedem acesso aos schemas `public` e `rebase`. As roles correspondem
a `REBASE_RLS_REQUEST_ROLE` quando definida, ou àquelas que uma inicialização gravou no
banco de dados, ou `rebase_user`. A explicação é escrita como comentários em SQL, de
forma que a saída pode ser executada diretamente. Ele lê a role de conexão e não executa mais nada.
`--print` é obrigatório. Use em conjunto com `REBASE_RLS_PROVISION_ROLE=never` quando as roles
forem criadas por um DBA ou por código de infraestrutura.

### `rebase db branch`

```bash
rebase db branch create <name>
rebase db branch list
rebase db branch info <name>
rebase db branch diff <name> [--json] [--sample-limit <n>]
rebase db branch switch <name>     # work on it; every later command follows
rebase db branch switch            # say which branch you are on
rebase db branch switch --off      # back to the main database
rebase db branch delete <name>
rebase db branch prune [--older-than 14d] [--include-dev-diff]
```

O PostgreSQL não copia nem remove um banco de dados ao qual qualquer outro processo esteja conectado, e
o habitual "qualquer outro processo" é o seu próprio `rebase dev`. `create` e `delete`
identificam o que está mantendo o banco de dados aberto; `--force` desconecta essas sessões primeiro.

Cada branch é uma cópia completa em disco, portanto elas precisam ser limpas. O `prune` remove
três coisas: uma entrada cujo banco de dados foi excluído fora do Rebase, um banco de dados de
branch cuja entrada nunca foi registrada e — apenas com `--older-than` — branches que
ultrapassaram a idade especificada. Ele solicita confirmação antes de remover qualquer coisa, a menos que você passe `--yes`.
Sem um terminal para solicitar confirmação, como em ambientes de CI, ele não remove nada, indica que
`--yes` deve ser passado e encerra com status 1.
`list` e `info` realizam apenas leitura: um banco de dados no qual nenhuma branch foi criada não tem nenhuma, e
eles não criam nenhum schema `rebase` lá.

`diff` mostra o que uma branch alterou em relação ao banco de dados a partir do qual foi criada:
tabelas, colunas, restrições, índices, triggers, políticas de RLS, tipos enum,
views e funções adicionadas, removidas ou alteradas e, por tabela, as linhas inseridas,
atualizadas e excluídas. Linhas que o banco pai alterou por conta própria desde
então são contabilizadas separadamente, e linhas alteradas por ambos são conflitos. `--json` imprime
o diff completo, com até `--sample-limit` linhas por tabela (padrão 100). Ele lê
ambos os bancos de dados e não altera nenhum deles; a mesclagem (merge) é feita no Studio — consulte
[Reviewing and merging a branch](/docs/backend/branching/#reviewing-and-merging-a-branch).

O `switch` registra a branch em `.rebase/branch.json` e nunca edita o `.env`. Ele
tem precedência sobre o `DATABASE_URL` no `.env` e perde para `--database-url` ou um
`DATABASE_URL` no shell, portanto uma flag na linha de comando sempre se sobrepõe a uma
alternância feita anteriormente. O `delete` recusa a branch em que você está, já que todos os comandos
no checkout, inclusive a exclusão, estão apontados para ela: use `switch --off` primeiro
e, em seguida, exclua-a. O fluxo de trabalho completo está em [Database Branching](/docs/backend/branching/).

:::note[No banco de dados de desenvolvimento gerenciado]
`push`, `generate` e `migrate` funcionam aqui como em qualquer outro banco de dados.
O `push` e o `generate` planejam seu trabalho com o Atlas, que precisa de um segundo
banco de dados vazio para comparação — e o PGlite gerenciado atende a exatamente um. Portanto,
no banco de dados gerenciado, cada um deles inicia um segundo PGlite descartável na memória
para o Atlas e o interrompe quando o comando termina. É assim que uma coluna é removida,
renomeada ou restrita ali: o `rebase dev` apenas adiciona. A proteção contra operações destrutivas é a
mesma de qualquer outro lugar. Para que o Atlas faça o planejamento contra um banco de dados vazio
próprio, defina `REBASE_ATLAS_DEV_URL` para ele; o Rebase não cria nem remove um
banco de dados indicado dessa forma.

O comando `branch` é recusado nesse ambiente. `CREATE DATABASE ... TEMPLATE`
no PGlite apenas grava uma entrada no catálogo e não copia nada, de modo que a branch
resolveria para o banco de dados a partir do qual foi clonada — qualquer gravação que você pretendia
isolar cairia diretamente no seu banco de dados de desenvolvimento. `rebase dev --docker` fornece um
servidor real com o qual as branches funcionam.
:::

## Relacionados

- [CLI reference](/docs/cli/) — todos os outros comandos do `rebase`
- [Schema Generation](/docs/cli/schema/) — `db push`, `db generate`, `db migrate` e `db branch` em detalhes
- [Backups and restore](/docs/deployment/backups/) — agendamento, o arquivo de roles, restauração
- [Database Branching](/docs/backend/branching/) — como uma branch é criada e o que isso custa
- [Running on an existing or shared database](/docs/deployment/existing-database/) — a role de requisição, suas configurações e `rebase doctor --database`
- [Scripts and the Console](/docs/backend/scripts/) — o mesmo banco de dados a partir de um script ou de um REPL
