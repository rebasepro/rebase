---
sourceHash: 20ed1243d65e4ebe
title: Comandos de Banco de Dados
sidebar_label: Comandos de Banco de Dados
description: Os comandos rebase db — push, generate e migrate, backups e restaurações, importar uma cópia, a string de conexão, o banco de dados de desenvolvimento gerenciado e os branches.
---

## Visão Geral

`rebase db` é a família de comandos que alcançam o banco de dados do projeto. Cada
um atua sobre o banco de dados que o projeto resolve, na ordem que
[Branching de Banco de Dados](/docs/backend/branching/#cli-integration) lista:
`--database-url`, depois `DATABASE_URL` no shell, o branch para o qual o checkout foi
alternado, `DATABASE_URL` no `.env`, `--docker` e, por fim, o banco de dados de
desenvolvimento gerenciado que o `rebase dev` inicia. O `rebase db url` imprime qual
deles é.

`push`, `generate` e `migrate` são descritos em profundidade em
[Geração de Esquema](/docs/cli/schema/), e todos os outros comandos estão na
[Referência da CLI](/docs/cli/).

## Comandos

### `rebase db push`

Envia alterações de schema diretamente para o banco de dados (somente desenvolvimento):

```bash
rebase db push
```

`--database-url <url>` indica o banco de dados, e `--docker` o do compose, iniciado
se necessário. `generate`, `migrate`, `branch`, `backup` e `restore` também aceitam ambos.

Ele deixa em paz o que suas coleções não descrevem: outras tabelas e views, índices que você
escreveu e as restrições CHECK e EXCLUDE da tabela de uma coleção, que uma coleção não pode
declarar. Veja [`rebase db push`](/docs/cli/schema/#rebase-db-push) para saber o que ele aplica
e diante do que ele para.

:::caution
`db push` modifica o banco de dados diretamente sem arquivos de migração. Use `db generate` + `db migrate` para produção.
:::

### `rebase db generate`

Gera arquivos de migração SQL a partir de alterações de schema:

```bash
rebase db generate
```

Cria arquivos de migração com carimbo de data/hora em `drizzle/migrations/` que podem ser revisados e comitados.

### `rebase db migrate`

Executa migrações pendentes do banco de dados:

```bash
rebase db migrate
```

Aplica todas as migrações não aplicadas ao banco de dados.

Em um banco de dados em que o servidor já inicializou, a primeira migração cria tabelas
que a inicialização já criou, então o primeiro `db migrate` ali para em `already exists`.
Em vez disso, registre essa migração como aplicada, uma única vez:

```bash
rebase db migrate --baseline <version>
```

A versão é o prefixo numérico do arquivo de migração; o `db generate` imprime o
comando com ela já preenchida. Veja
[`--baseline`](/docs/cli/schema/#rebase-db-migrate) para um banco de dados que já
registra migrações.

Depois disso, o `db migrate` aplica o que a inicialização não aplicou, e em um banco de dados
que o `rebase dev` serve isso é menos do que parece. A inicialização adiciona cada nova tabela,
coluna e valor de enum assim que uma coleção muda, então, quando o
`db generate` escreve a migração que adiciona uma coluna, a coluna já está
lá: esse `db migrate` para em `already exists` de novo e nomeia o
`--baseline <version>` que a registra. Cada nova propriedade significa mais um
baseline. Registre uma migração apenas quando a inicialização fez todas as mudanças dela. Uma que
também remove, renomeia ou estreita algo contém instruções que a inicialização nunca executa, e
registrá-la as pula. Em desenvolvimento, o `rebase db push` é o comando que
muda o schema; deixe o `db generate` e o `db migrate` para um banco de dados que a inicialização
ainda não mudou.

### `rebase db backup` / `backups` / `restore`

```bash
rebase db backup --out ./backups        # or s3://bucket/prefix, gs://bucket/prefix
rebase db backups list                  # list what is stored
rebase db restore ./backups/<file>.dump --yes
```

`backup` executa o `pg_dump`; `restore` executa o `pg_restore` e, por ser destrutivo,
pede que você digite `yes` em um terminal, ou aceita `--yes`; sem terminal e sem
`--yes` ele recusa e diz para passá-lo.
<span class="since-badge" data-since="0.25">Desde 0.25</span> Em um banco de dados
que já contém o que o backup cria, o `restore` precisa de `--clean`. Sem ele, o
comando recusa antes de aplicar qualquer coisa, inclusive as roles do cluster, e
nomeia os objetos no caminho e as duas formas de contorná-los: `--clean`, ou
`--create-db --target-db <new name>`. Na 0.24 ele aplicava as roles e depois
falhava com o `schema "rebase" already exists` do pg_restore.
<span class="since-badge" data-since="0.25">Desde 0.25</span> Com `--clean`
a restauração é uma única transação: ela remove os schemas do backup com tudo
o que há neles, restaura, e faz o commit somente depois que a restauração inteira teve
sucesso, então uma falha deixa o banco de dados como estava. Antes de perguntar, ela
nomeia o que remove e que o backup não contém. Ela executa o `psql`, que vem junto com o `pg_restore`.
Na 0.24 uma restauração com `--clean` em um banco de dados com uma tabela que faltava no backup,
como a tabela de revisões do Atlas depois de um `db migrate`, removia tudo e não restaurava
nada.
<span class="since-badge" data-since="0.25">Desde 0.25</span> O `restore` recusa
o banco de dados de desenvolvimento gerenciado: um backup traz as suas linhas como dados
de COPY, que ele não consegue receber, e na 0.24 a restauração o deixava travado até
que fosse parado. Restaure no Postgres em Docker (`rebase db restore <dump> --docker --clean --yes`),
e então `rebase db pull --from "$(rebase db url --docker)" --yes` o copia para o
banco de dados gerenciado. Um backup do banco de dados gerenciado o deixa como estava; na
0.24 as configurações que o `pg_dump` fazia ficavam nele, e toda requisição à API falhava
até um `rebase db stop`.
<span class="since-badge" data-since="0.25">Desde 0.25</span> Os caminhos relativos,
e o padrão `./backups`, são resolvidos a partir do diretório em que você executa o
`rebase`, de modo que as três linhas acima se encontram em um único diretório; uma
opção que um comando não aceita é recusada antes de qualquer execução. Na 0.24 o
padrão é `backend/backups`, então liste-o com `--out ./backups`.
<span class="since-badge" data-since="0.25">Desde 0.25</span> O dump e seu arquivo de roles podem ser lidos somente por você (0600), e
contra um banco de dados que não está em execução, `backup` e `restore` imprimem o
banner que o `db push` imprime. Na 0.24 os dumps são 0644.
O agendamento, o arquivo de roles que acompanha cada dump, e o procedimento de restauração estão em [Backups e restauração](/docs/deployment/backups/).

### `rebase db pull`

Copia outro banco de dados para o banco de dados de desenvolvimento local:

```bash
rebase db pull --from postgres://…  [--anonymize]
```

`--anonymize` substitui campos pessoais durante a importação, para que uma cópia de produção possa ser trabalhada localmente sem levar dados reais de clientes para um laptop. Ele associa as colunas pelo nome e
funciona no melhor esforço (best-effort). <span class="since-badge" data-since="0.25">Desde 0.25</span>
Uma coluna sob um índice único recebe um valor distinto por linha, e a passagem é uma
única transação: se ela falha, as tabelas que ela teria reescrito são esvaziadas e
nomeadas, e o comando termina com código 1. Na 0.24 ele falhava em `token_hash` depois
que os usuários tinham feito login duas vezes, deixando dados reais para trás.

<span class="since-badge" data-since="0.25">Desde 0.25</span> Uma flag que o `pull`
não aceita é recusada antes de qualquer coisa ser lida ou copiada, nomeando a que
provavelmente se pretendia: `--anonymise` responde "did you mean --anonymize?" e
termina com código 1. Na 0.24 uma flag escrita errado era ignorada, então `--anonymise`, `--anon` ou
`--schem` executavam o pull sem ela, e os dados pessoais chegavam como estavam.

O `pg_dump` remove privilégios, então a cópia chegaria com as políticas de RLS da origem e nenhuma das concessões (grants) por trás delas — fazendo com que cada leitura como `rebase_user` falhe com `permission denied`. O pull provisiona novamente a role do app em seguida, usando a mesma rotina que a inicialização e o `rebase db push` utilizam, garantindo que as tabelas internas do Rebase permaneçam revogadas como devem ser.

O destino é sempre o banco de dados de desenvolvimento local deste projeto e não pode ser escolhido: `--database-url` é recusado em vez de aceito, logo não há como solicitar um "pull para produção". `--from` é a única direção.

<span class="since-badge" data-since="0.25">Desde 0.25</span> Um pull substitui
o conteúdo do banco de dados local: ele primeiro esvazia cada schema que copia, então
uma tabela que existe só localmente não sobrevive a ele. No banco de dados de
desenvolvimento gerenciado as linhas chegam como instruções `INSERT`, que ele aceita
onde um `COPY` o travaria. Na 0.24 um pull para o banco gerenciado falhava na primeira
tabela e o deixava sem responder nada até ser encerrado à força.

### `rebase db url`

Imprime a string de conexão que este projeto está usando, e nada mais, permitindo o uso com pipes:

```bash
rebase db url
psql "$(rebase db url)"
```

O banco de dados de desenvolvimento gerenciado é o caso de uso que necessita disso: o `.env` deixa o `DATABASE_URL` comentado propositalmente, e a porta é derivada do caminho do projeto, portanto nada no disco a especifica diretamente. <span class="since-badge" data-since="0.25">Desde 0.25</span> Ele mantém essa porta entre uma parada e um novo início, a menos que outra coisa a tenha ocupado; na 0.24 cada início escolhia uma nova. Quando você define um `DATABASE_URL` próprio, é isso que este comando imprime — a ordem de resolução é a mesma que todos os outros comandos seguem. Ele inicia o banco de dados gerenciado caso ainda não esteja em execução.

<span class="since-badge" data-since="0.25">Desde 0.25</span> Depois de
`rebase dev --docker`, o `db url` e os demais comandos usam esse banco de dados Docker
(e dizem isso no stderr) até que um `rebase dev` rode sem a flag. A escolha fica guardada
em `.rebase/dev-database.json` e tem a precedência que o `--docker` tem, abaixo de toda
string de conexão. Um `--docker` que você digita e que uma string de conexão supera não
inicia nenhum container: uma linha no stderr diz que ele foi ignorado, nomeia o que
venceu e diz como alcançar o Docker em vez disso. Um `rebase dev --docker` superado
dessa forma mantém a escolha guardada como estava, então, quando a string de conexão
some, os comandos voltam a seguir o Docker. Na 0.24 cada comando precisa do seu
próprio `--docker`, e um superado ainda inicia o container.

<span class="since-badge" data-since="0.25">Desde 0.25</span> O `rebase init`
dá a cada projeto a sua própria porta do compose, de 5433 a 5632 conforme o caminho do
projeto, e o `--docker` verifica se o que responde nela é o container `db` deste projeto.
Quando outro container ou um Postgres fora do Docker ocupa a porta, ele para e o
nomeia em vez de fazer login no banco de dados de outra pessoa. Para mudar a porta do
projeto, altere a porta do host do serviço `db` no `docker-compose.yml`, e o
`DATABASE_URL` se o `.env` definir um. Na 0.24 todo scaffold pegava a primeira porta
livre a partir de 5432, então projetos criados lado a lado podiam compartilhar uma.

### `rebase db stop` / `rebase db reset`

Apenas para o banco de dados de desenvolvimento gerenciado:

```bash
rebase db stop     # stop it; the data is kept
rebase db reset    # delete it and start over
```

Ele pertence ao projeto, não ao comando que o iniciou, então parar o
`rebase dev` o deixa em execução para os outros comandos. Depois de 30 minutos sem
nada conectado ele para sozinho, e o próximo comando que precisar dele o inicia de
novo. <span class="since-badge" data-since="0.25">Desde 0.25</span> O `rebase dev`
diz isso ao parar, junto com como parar o banco de dados agora; na 0.24 ele não dizia nada.

<span class="since-badge" data-since="0.25">Desde 0.25</span> O `db stop` com um
`rebase dev` em execução diz que o backend dele não consegue alcançar o banco de dados
até que ele volte. O próximo comando que precisar dele, o `rebase db url` por exemplo,
o inicia na mesma porta, e o backend se reconecta sem reiniciar. Na 0.24 ele voltava
em outra porta, e o backend respondia 503 até o `rebase dev` ser reiniciado.

### `rebase db branch`

```bash
rebase db branch create <name>
rebase db branch list
rebase db branch info <name>
rebase db branch switch <name>     # work on it; every later command follows
rebase db branch switch            # say which branch you are on
rebase db branch switch --off      # back to the main database
rebase db branch delete <name>
rebase db branch prune [--older-than 14d] [--include-dev-diff]
```

O PostgreSQL não copia nem descarta um banco de dados ao qual qualquer outro processo esteja conectado, e o habitual "qualquer outro processo" é o seu próprio `rebase dev`. `create` e `delete` informam o que está mantendo o banco de dados aberto; `--force` desconecta essas sessões primeiro.

Cada branch é uma cópia completa em disco, por isso elas precisam ser limpas. `prune` remove três coisas: uma entrada cujo banco de dados foi excluído fora do Rebase, um banco de dados de branch cuja entrada nunca foi gravada e — apenas com `--older-than` — branches que ultrapassaram a idade informada. Ele solicita confirmação antes de remover qualquer item, a menos que você passe `--yes`.
<span class="since-badge" data-since="0.25">Desde 0.25</span> Sem um terminal para perguntar, como no CI, ele não remove nada, diz para
passar `--yes` e termina com código 1; na 0.24 ele diz "Nothing was changed." e termina com código 0.
`list` e `info` apenas leem: um banco de dados em que nenhum branch foi criado não tem nenhum, e
eles não criam o schema `rebase` ali. Na 0.24 eles criam o registro.

`switch` registra o branch em `.rebase/branch.json` e nunca edita o `.env`. Ele tem precedência sobre `DATABASE_URL` no `.env` e perde para `--database-url` ou um `DATABASE_URL` definido no shell; portanto, uma flag na linha de comando sempre sobrepõe uma troca feita anteriormente. `delete` recusa o branch em que você está, já que todo comando no checkout, inclusive o delete, aponta para ele: primeiro `switch --off`, depois exclua-o. O fluxo completo está em [Branching de Banco de Dados](/docs/backend/branching/).

:::note[No banco de dados de desenvolvimento gerenciado]
<span class="since-badge" data-since="0.25">Desde 0.25</span> `push`, `generate` e `migrate` funcionam aqui como em qualquer banco de dados.
`push` e `generate` planejam seu trabalho com o Atlas, que precisa de um segundo banco de dados vazio para comparação — e o PGlite gerenciado atende a exatamente um. Por isso, no banco gerenciado, cada um deles inicia um segundo PGlite descartável, em memória, para o Atlas, e o encerra quando o comando termina. É assim que uma coluna é removida, renomeada ou estreitada lá: o `rebase dev` só adiciona. O portão destrutivo é o mesmo de todo lugar. Para que o Atlas planeje contra um banco de dados vazio seu, defina `REBASE_ATLAS_DEV_URL` com ele; o Rebase não cria nem remove um banco de dados com esse nome.

`branch` é recusado lá. `CREATE DATABASE ... TEMPLATE` no PGlite grava uma entrada de catálogo e não copia nada, de modo que o branch apontaria para o banco de dados do qual foi clonado — qualquer gravação que você pretendesse isolar acabaria no seu banco de dados de desenvolvimento. `rebase dev --docker` fornece um servidor real compatível com branches.
:::

## Relacionado

- [Referência da CLI](/docs/cli/) — todos os outros comandos `rebase`
- [Geração de Esquema](/docs/cli/schema/) — `db push`, `db generate`, `db migrate` e `db branch` em profundidade
- [Backups e restauração](/docs/deployment/backups/) — agendamento, o arquivo de roles, restauração
- [Branching de Banco de Dados](/docs/backend/branching/) — como um branch é criado e quanto custa
- [Scripts e o Console](/docs/backend/scripts/) — o mesmo banco de dados a partir de um script ou de um REPL
