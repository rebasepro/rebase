---
sourceHash: 68cf15088ac8b29f
title: Comandos de Banco de Dados
sidebar_label: Comandos de Banco de Dados
description: Os comandos rebase db — push, generate e migrate, backups e restaurações, puxando uma cópia, a string de conexão, o banco de dados de desenvolvimento gerenciado e branches.
---

## Visão Geral

`rebase db` é a família de comandos que acessam o banco de dados do projeto. Cada
um opera no banco de dados que o projeto resolve, na ordem listada em
[Database Branching](/docs/backend/branching/#cli-integration):
`--database-url`, depois `DATABASE_URL` no shell, o branch para o qual o checkout foi
alternado, `DATABASE_URL` no `.env`, `--docker`, e, caso contrário, o banco de
dados de desenvolvimento gerenciado iniciado pelo `rebase dev`. `rebase db url` exibe qual
deles é.

`request-role` e `provision` são destinados a um banco de dados que o Rebase não possui integralmente;
consulte [Running on an existing or shared database](/docs/deployment/existing-database/).
`push`, `generate` e `migrate` são descritos detalhadamente em
[Schema Generation](/docs/cli/schema/), e todos os outros comandos estão na
[CLI reference](/docs/cli/).

## Comandos

### `rebase db push`

Envie alterações de schema diretamente para o banco de dados (apenas desenvolvimento):

```bash
rebase db push
```

`--database-url <url>` especifica o banco de dados, e `--docker` o do compose, iniciado
se necessário. `generate`, `migrate`, `branch`, `backup` e `restore` também aceitam ambos.

Ele não altera o que as declarações de tabela não descrevem: outras tabelas e
views, índices que você escreveu e restrições CHECK e EXCLUDE em uma tabela declarada,
que uma declaração não consegue expressar. Consulte
[`rebase db push`](/docs/cli/schema/#rebase-db-push) para saber o que ele aplica e
antes do que ele é interrompido.

O SQL que uma declaração de tabela não consegue expressar (funções, triggers, restrições
CHECK, grants) fica em `backend/sql/*.sql`. O push aplica esses arquivos
em ordem alfabética de nome, após as tabelas e views e antes das políticas, de modo
que uma política possa chamar uma função definida por um arquivo. Cada arquivo é registrado por nome e hash em
`rebase.sql_files` e é executado novamente apenas quando é alterado, em sua própria transação:
um arquivo que falhar sofre rollback e interrompe o push. Escreva arquivos que sejam seguros
para serem executados novamente (`CREATE OR REPLACE FUNCTION`, `DROP TRIGGER IF EXISTS` antes de
`CREATE TRIGGER`). Um arquivo cujo nome começa com `_` é um rascunho e não é
aplicado. Remover um arquivo não desfaz nada do que ele fez. `--dry-run` lista os arquivos que
seriam aplicados.

Um deploy aplica os mesmos arquivos: `rebase build` os inclui no bundle, e a
inicialização do servidor executa cada arquivo novo ou modificado após as tabelas e autenticação e
antes das políticas, registrado no mesmo `rebase.sql_files`. A transação de cada
arquivo obtém um advisory lock primeiro, garantindo que várias instâncias inicializando
juntas, ou um push durante um deploy, executem cada arquivo apenas uma vez. Um arquivo pode ser executado por
até 15 minutos. Um arquivo que falhar interrompe a inicialização e indica o nome do arquivo. `rebase dev` também os aplica na inicialização. Uma
aplicação que constrói seu próprio backend define o diretório com
`createPostgresAdapter({ sqlDir: "backend/sql" })`. Nada é aplicado com
`REBASE_PROVISION=false` ou `REBASE_MIGRATE_ON_BOOT=none`.

:::caution
`db push` modifica o banco de dados diretamente sem arquivos de migração. Use `db generate` + `db migrate` para produção.
:::

### `rebase db generate`

Gere arquivos de migração SQL a partir de alterações no schema:

```bash
rebase db generate
```

Cria arquivos de migração com carimbo de data/hora em `backend/drizzle/migrations/` que podem ser revisados e commitados.

### `rebase db migrate`

Execute migrações de banco de dados pendentes:

```bash
rebase db migrate
```

Aplica todas as migrações não aplicadas ao banco de dados.

Em um banco de dados que já foi inicializado, a primeira migração cria tabelas que a inicialização
já criou, portanto o primeiro `db migrate` nele é interrompido antes de executar qualquer coisa e
imprime a baseline a ser executada. Em vez disso, registre essa migração como aplicada uma única vez:

```bash
rebase db migrate --baseline <version>
```

A versão é o prefixo numérico do arquivo de migração; o `db generate` imprime o
comando com ela preenchida. Consulte
[`--baseline`](/docs/cli/schema/#rebase-db-migrate) para um banco de dados que já
registra migrações.

Depois disso, o `db migrate` aplica o que a inicialização não aplicou, e em um banco de dados
servido pelo `rebase dev` isso é menos do que parece. A inicialização adiciona cada nova tabela,
coluna e valor de enum assim que a declaração de uma tabela muda, então, no momento em que
o `db generate` grava a migração que adiciona uma coluna, a coluna já está
lá: esse `db migrate` é interrompido novamente em `already exists` e indica o
`--baseline <version>` para registrá-lo. Cada nova propriedade significa outra
baseline. Registre uma migração apenas quando a inicialização tiver feito todas as alterações contidas nela. Uma
migração que também remove, renomeia ou restringe algo contém instruções que a inicialização nunca executa, e
registrá-la as ignoraria. No desenvolvimento, `rebase db push` é o comando que
altera o schema; reserve `db generate` e `db migrate` para um banco de dados que a inicialização
ainda não tenha alterado.

### `rebase db backup` / `backups` / `restore`

```bash
rebase db backup --out ./backups        # or s3://bucket/prefix, gs://bucket/prefix
rebase db backups list                  # list what is stored
rebase db restore ./backups/<file>.dump --yes
```

`backup` executa o `pg_dump`; `restore` executa o `pg_restore` e, por ser destrutivo,
solicita a digitação de `yes` em um terminal ou aceita `--yes`; sem um terminal e sem
`--yes`, ele recusa a operação e avisa para informá-lo.
Em um banco de dados
que já contém o que o backup cria, o `restore` precisa de `--clean`. Sem
ele, a operação é recusada antes que qualquer coisa seja aplicada, incluindo as roles do cluster, e
lista os objetos conflitantes e as duas maneiras de contorná-los: `--clean` ou
`--create-db --target-db <new name>`.
Com `--clean`,
a restauração é uma única transação: ela remove os schemas do backup com tudo
dentro deles, restaura e só faz o commit quando toda a restauração for bem-sucedida, de
modo que uma falha deixa o banco de dados como estava. Antes de solicitar confirmação, ele lista o que irá remover
que o backup não contém. Ele executa o `psql`, fornecido junto com o `pg_restore`.
`restore` recusa
o banco de dados de desenvolvimento gerenciado: um backup transporta suas linhas como dados COPY, que
ele não pode receber.
Restaure no Postgres no Docker (`rebase db restore <dump> --docker --clean --yes`),
e depois `rebase db pull --from "$(rebase db url --docker)" --yes` copia os dados para
o banco de dados gerenciado. Um backup do banco de dados gerenciado o deixa inalterado.
Caminhos relativos,
e o padrão `./backups`, são resolvidos em relação ao diretório de onde você executa o `rebase`,
de modo que as três linhas acima convergem em um único diretório; uma opção que um comando não
aceita é recusada antes que qualquer operação seja executada.
O dump e seu arquivo de roles podem ser lidos apenas por você (0600) e,
contra um banco de dados que não está em execução, `backup` e `restore` exibem o
mesmo aviso que `db push`.
Agendamento, o arquivo de roles que acompanha cada dump e o procedimento de restauração estão em [Backups and restore](/docs/deployment/backups/).

### `rebase db pull`

Copie outro banco de dados para o banco de dados de desenvolvimento local:

```bash
rebase db pull --from postgres://…  [--anonymize]
```

`--from` aceita uma URL `postgres://` ou `postgresql://`, ou pares
`host=… port=… dbname=…` da libpq entre aspas como um único argumento. Qualquer outra coisa é recusada
antes que qualquer dado seja lido ou iniciado, sem repetir o valor.

`--anonymize` substitui campos pessoais durante a importação, para que uma cópia de produção possa ser
trabalhada localmente sem levar dados reais de clientes para um laptop. Ele faz a correspondência de
colunas por nome com base em melhor esforço (best-effort). Uma coluna simples chamada `name` é substituída apenas em
tabelas de pessoas: chamada de `users`, `authors`, `customers` ou similar, ou qualquer
tabela que também contenha uma coluna de endereço de e-mail.
Uma coluna com um índice exclusivo recebe um valor distinto por linha, e a passagem ocorre em uma única
transação: se falhar, as tabelas que teriam sido reescritas são esvaziadas e
nomeadas, e o comando é encerrado com código 1.

Uma flag não aceita pelo
`pull` é recusada antes que qualquer dado seja lido ou copiado, sugerindo a que
provavelmente se pretendia usar: `--anonymise` responde "did you mean --anonymize?" e
sai com código 1.
No `pull` e em todos os outros comandos, uma chave com um valor atribuído o interpreta:
`--anonymize=true` ou `=1` ativa, `--anonymize=false` ou `=0` desativa,
e qualquer outro valor é recusado.

O `pg_dump` remove privilégios, portanto a cópia chegaria com as políticas de RLS de
origem e nenhuma das permissões (grants) por trás delas — cada leitura como `rebase_user` falhando
com `permission denied`. O pull reprovisiona a role da aplicação em seguida, usando
a mesma rotina que a inicialização e o `rebase db push` usam, para que as tabelas internas do Rebase permaneçam
revogadas como devem ser.

O destino é sempre o banco de dados de desenvolvimento local deste projeto e não pode
ser escolhido: `--database-url` é recusado em vez de aceito, de modo que não há como
expressar "pull para produção". `--from` é a única direção.

Um pull substitui
o conteúdo do banco de dados local: ele esvazia primeiro cada schema copiado, de modo que uma
tabela que exista apenas localmente não sobrevive a ele. Para o banco de dados de desenvolvimento
gerenciado, as linhas trafegam como instruções `INSERT`, que ele aceita nos casos onde o `COPY`
falharia. Ele aceita apenas dumps em UTF8: um pull de um banco de dados em outra
codificação, digamos LATIN1, é recusado antes que algo seja esvaziado. Faça o pull desse banco
para o Postgres no Docker (`rebase db pull --docker` com o mesmo `--from`), ou para um
Postgres especificado por `DATABASE_URL`.

### `rebase db url`

Exiba a string de conexão que este projeto está usando, e nada mais, permitindo
pipes:

```bash
rebase db url
psql "$(rebase db url)"
```

O banco de dados de desenvolvimento gerenciado é o caso que precisa disso: o `.env` deixa o
`DATABASE_URL` comentado propositalmente, e a porta é derivada do
caminho do projeto, portanto nada no disco a especifica.
Ele mantém essa
porta entre paradas e inicializações, a menos que outro processo a tenha ocupado. Quando você define um `DATABASE_URL`
próprio, é isso que ele imprime — a ordem de resolução é a mesma que
todos os outros comandos seguem. Ele inicia o banco de dados gerenciado caso ainda não
esteja em execução.

Após
`rebase dev --docker`, `db url` e os outros comandos usam esse banco de dados Docker
(e informam isso no stderr) até que um `rebase dev` seja executado sem a flag. A escolha é
mantida em `.rebase/dev-database.json` e tem a mesma prioridade que `--docker`, abaixo de qualquer
string de conexão. Um `--docker` digitado que for superado por uma string de conexão
não inicializa nenhum contêiner: uma linha no stderr informa que foi ignorado, indica qual venceu
e explica como acessar o Docker em vez disso. Um `rebase dev --docker` superado dessa
forma mantém a escolha memorizada como estava, de modo que, assim que a string de conexão for
removida, os comandos voltam a seguir o Docker.

`rebase init`
atribui a cada projeto sua própria porta compose, de 5433 a 5632 com base no caminho do projeto,
e `--docker` verifica se quem responde nela é o contêiner `db` deste projeto.
Quando outro contêiner ou um Postgres fora do Docker ocupa a porta, ele para e
informa o nome em vez de se conectar ao banco de dados de outra pessoa. Para mover o
projeto, altere a porta do host do serviço `db` em `docker-compose.yml`, e
`DATABASE_URL` se o `.env` definir um.

### `rebase db stop` / `rebase db reset`

Apenas para o banco de dados de desenvolvimento gerenciado:

```bash
rebase db stop     # stop it; the data is kept
rebase db reset    # delete it and start over
```

Ele pertence ao projeto, não ao comando que o iniciou, portanto parar o
`rebase dev` o mantém em execução para os outros comandos. Após 30 minutos sem
nenhuma conexão, ele para automaticamente, e o próximo comando que precisar dele o inicia
novamente. O `rebase dev`
informa isso ao parar, indicando como parar o banco de dados imediatamente.

O `db stop` sob um
`rebase dev` em execução avisa que o backend não poderá acessar o banco de dados até que ele
retorne. O próximo comando que precisar dele, como `rebase db url`, o iniciará
na mesma porta, e o backend se reconectará sem necessidade de reinicialização.

### `rebase db request-role migrate`

Migre as requisições deste banco de dados de uma role do Postgres para outra:

```bash
rebase db request-role migrate --to <role[,role]> [--dry-run] [--yes]
```

As requisições são executadas como `rebase_user`, a menos que o projeto especifique outra role
(`REBASE_RLS_REQUEST_ROLE` ou `rls.requestRole`). Uma role pertence a todo o
cluster, portanto projetos que compartilham um devem ter cada um a sua própria. A primeira
inicialização de provisionamento registra a role no banco de dados, e uma inicialização posterior
configurada com outra role recusa-se a iniciar até que o banco de dados seja migrado.

O comando migra a partir da role registrada pelo banco de dados ou `rebase_user`. Em
uma única transação, ele cria a nova role se ela estiver ausente, permite que a conexão
alterne para ela, reemite apenas neste banco de dados todas as concessões (grants) que a role antiga possui,
reaponta as políticas que a referenciam e registra a nova role. A role antiga é
mantida como está, pois outro banco de dados no cluster pode estar usando-a. Em seguida,
ele imprime as instruções `REVOKE` que retiram as concessões da role antiga aqui,
para serem executadas quando nada mais precisar delas.

`--dry-run` imprime as instruções e os `REVOKE`s sem alterar nada. Em um
terminal, ele solicita confirmação primeiro; sem terminal, recusa a execução sem `--yes`. Em seguida, defina
`REBASE_RLS_REQUEST_ROLE` para a nova role em todos os servidores que usam o
banco de dados. Consulte [Running on an existing or shared database](/docs/deployment/existing-database/).

### `rebase db provision --print`

Exiba o SQL que configura a(s) role(s) de requisição para este banco de dados, para que um
administrador de banco de dados execute:

```bash
rebase db provision --print > request-role.sql
```

Para cada role de requisição, ele imprime as instruções que criam a role, concedem à
role de conexão o direito de alternar para ela e, sob o padrão
`grants: "schema"`, concedem permissão aos schemas `public` e `rebase`. As roles são
`REBASE_RLS_REQUEST_ROLE` quando definida, caso contrário as registradas por uma inicialização no
banco de dados, caso contrário `rebase_user`. A explicação é escrita como comentários em SQL, de
forma que a saída pode ser executada como está. Ele lê a role de conexão e não executa mais nada.
`--print` é obrigatório. Combine-o com `REBASE_RLS_PROVISION_ROLE=never` quando as roles
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
o "outro processo" habitual é o seu próprio `rebase dev`. `create` e `delete` identificam
o que está mantendo o banco de dados aberto; `--force` desconecta essas sessões primeiro.

Cada branch é uma cópia completa em disco, portanto eles precisam de limpeza. `prune` remove
três coisas: uma entrada cujo banco de dados foi excluído fora do Rebase, um
banco de dados de branch cuja entrada nunca foi gravada e — somente com `--older-than` — branches
mais antigos que o período especificado. Ele solicita confirmação antes de remover qualquer coisa, a menos que você informe `--yes`.
Sem um terminal para perguntar, como em CI, ele não remove nada, instrui a
informar `--yes` e sai com código 1.
`list` e `info` realizam apenas leitura: um banco de dados sobre o qual nenhum branch foi criado não possui nenhum, e
eles não criam nenhum schema `rebase` nele.

`diff` mostra o que um branch alterou em relação ao banco de dados a partir do qual foi criado:
tabelas, colunas, restrições, índices, triggers, políticas de RLS, tipos enum,
views e funções adicionadas, removidas ou alteradas e, por tabela, as linhas que ele
inseriu, atualizou e deletou. Linhas que o banco pai alterou por conta própria desde
então são contabilizadas à parte, e linhas que ambos alteraram são conflitos. `--json` imprime o
diff completo, com até `--sample-limit` linhas por tabela (padrão 100). Ele lê
ambos os bancos de dados e não altera nenhum; o merge é feito no Studio — consulte
[Reviewing and merging a branch](/docs/backend/branching/#reviewing-and-merging-a-branch).

`switch` registra o branch em `.rebase/branch.json` e nunca edita o `.env`. Ele
tem precedência sobre `DATABASE_URL` no `.env` e perde para `--database-url` ou um
`DATABASE_URL` no shell, portanto uma flag na linha de comando sempre tem prioridade sobre uma
alternância feita anteriormente. `delete` recusa o branch em que você está no momento, pois todos os comandos
no checkout, inclusive a exclusão, estão apontados para ele: execute `switch --off` primeiro e
depois exclua-o. Todo o fluxo de trabalho está em [Database Branching](/docs/backend/branching/).

#### `rebase db branch merge`

```bash
rebase db branch merge <name> [--on-conflict abort|branch|target] [--skip-blocked] [--yes]
```

Grava as linhas que um branch inseriu, atualizou e deletou no banco de dados a partir do qual ele foi criado. Ele imprime o diff primeiro e pede confirmação, depois mescla exatamente esse diff: o merge identifica a impressão digital (fingerprint) do diff, de modo que um pai que foi alterado desde então é recusado em vez de mesclado. `--on-conflict` decide o que fazer com uma linha alterada em ambos os lados — `abort` (o padrão) não grava nada, `branch` assume a linha do branch, `target` mantém a do pai — e `--skip-blocked` mescla as tabelas possíveis e pula o restante. Alterações de schema e políticas nunca são mescladas: as migrações cuidam disso. `delete` também pede confirmação primeiro, e `--yes` confirma ambos para um script.

:::note[No banco de dados de desenvolvimento gerenciado]
`push`, `generate` e `migrate` funcionam aqui como em qualquer banco de dados.
`push` e `generate` planejam seu trabalho com o Atlas, que precisa de um segundo
banco de dados vazio para comparar — e o PGlite gerenciado atende a exatamente um. Portanto,
no banco de dados gerenciado, cada um deles inicia um segundo PGlite descartável na memória
para o Atlas e o encerra quando o comando termina. É assim que uma coluna é removida,
renomeada ou restrita ali: o `rebase dev` apenas adiciona. A proteção contra alterações destrutivas é a
mesma de qualquer outro lugar. Para que o Atlas planeje em relação a um banco de dados vazio seu,
defina `REBASE_ATLAS_DEV_URL` apontando para ele; o Rebase não cria nem remove um
banco de dados indicado dessa forma.

`branch` é recusado nele. `CREATE DATABASE ... TEMPLATE`
no PGlite grava uma entrada de catálogo e não copia nada, portanto o branch
seria resolvido para o banco de dados do qual foi clonado — cada gravação que você pretendia isolar
iria parar no seu banco de dados de desenvolvimento. `rebase dev --docker` fornece um
servidor real no qual os branches funcionam.
:::

## Relacionados

- [CLI reference](/docs/cli/) — todos os outros comandos do `rebase`
- [Schema Generation](/docs/cli/schema/) — `db push`, `db generate`, `db migrate` e `db branch` em detalhes
- [Backups and restore](/docs/deployment/backups/) — agendamento, o arquivo de roles, restauração
- [Database Branching](/docs/backend/branching/) — como um branch é criado e o que ele consome
- [Running on an existing or shared database](/docs/deployment/existing-database/) — a role de requisição, suas configurações e `rebase doctor --database`
- [Scripts and the Console](/docs/backend/scripts/) — o mesmo banco de dados a partir de um script ou de um REPL
