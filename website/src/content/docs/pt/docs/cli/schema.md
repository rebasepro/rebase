---
sourceHash: 06945ca1e787897f
title: Geração de Esquema
sidebar_label: Geração de Esquema
description: Gere esquemas Drizzle ORM a partir das tabelas em backend/schema, crie migrações SQL, faça introspecção de um banco de dados existente em arquivos defineTable e mantenha seu banco de dados sincronizado com a Rebase CLI.
---

## Visão Geral

O Rebase usa um pipeline de **esquema como código** (schema-as-code) onde as tabelas declaradas com
`defineTable` em `backend/schema/` são a única fonte da verdade. A CLI
as transforma por meio de um pipeline determinístico:

```
Tables (backend/schema) → Drizzle Schema → SQL Migrations → PostgreSQL
```

Esta página cobre todos os comandos da CLI envolvidos nesse pipeline.

## O Pipeline

### 1. Tabelas → Esquema Drizzle

As tabelas exportadas por `backend/schema/index.ts` descrevem colunas, tipos, relações,
enums e segurança em nível de linha (row-level security - RLS). Cada comando abaixo as lê por meio do loader
usado na inicialização do backend, portanto, um esquema que não compila — uma tabela sem
`rls`, `"inherit"` sem `defaultRls`, um `defineTable` que o index não
exporta — interrompe o comando com um `SchemaDefinitionError` nomeando cada problema,
e nada é gravado. O comando `schema generate` gera um arquivo de esquema
Drizzle ORM a partir delas.

Cada comando que lê o esquema aceita `--schema-dir <dir>` para projetos
que mantêm suas tabelas em outro local; o padrão é `backend/schema`, ou a
chave `tables` do app backend em `rebase.json`. `--collections` / `-c`, a
flag anterior à versão 0.31, é recusada com uma mensagem indicando o codemod
([`rebase migrate collections-to-tables`](#rebase-migrate)), assim como um
projeto que ainda possui `config/collections`.

### 2. Esquema Drizzle → Migrações

A partir do esquema Drizzle gerado, `db generate` calcula a diferença em relação às migrações já existentes em `backend/drizzle/migrations/`, reproduzidas em um banco de dados temporário, e produz arquivos de migração SQL com carimbo de data/hora (timestamp). Ele nunca lê o seu banco de dados: uma coluna que a inicialização ou o `db push` já adicionou ainda será gerada como `ADD COLUMN`.

### 3. Migrações → PostgreSQL

O comando `db migrate` aplica migrações pendentes ao seu banco de dados PostgreSQL.

## Comandos

### `rebase schema generate`

Gera um arquivo de esquema Drizzle ORM a partir de suas tabelas:

```bash
rebase schema generate
```

**O que faz:**
- Lê as tabelas que `backend/schema/index.ts` exporta
- Gera `backend/src/schema.generated.ts` com definições de tabela, enums e relações do Drizzle

**Opções:**

| Flag | Descrição |
|------|-------------|
| `--schema-dir` | O diretório do esquema (padrão: `backend/schema`); caminhos relativos são resolvidos a partir de onde você executa o comando |
| `--output, -o` | Caminho de saída para o arquivo de esquema gerado; caminhos relativos são resolvidos a partir de onde você executa o comando |
| `--watch, -w` | Monitora alterações e regenera automaticamente |

O **modo watch** é útil durante o desenvolvimento — edite um arquivo de tabela e o esquema é regenerado instantaneamente:

```bash
rebase schema generate --watch
```

### `rebase schema stale`

Verifica se o esquema gerado ainda corresponde às tabelas:

```bash
rebase schema stale          # relata e encerra com código 1 se algo estiver desatualizado
rebase schema stale --fix    # regenera o arquivo em vez de apenas relatar
```

**O que faz:**
- Renderiza o que as tabelas em `backend/schema/` geram e compara, declaração por declaração, com `backend/src/schema.generated.ts`
- Nomeia cada diferença — uma tabela ausente, uma coluna com tipo alterado, um rótulo de enum removido ou chaves estrangeiras nomeadas da forma como uma versão anterior as derivava — e encerra com código diferente de zero
- Com `--fix`, regenera o arquivo em vez de apenas relatar

O `rebase dev` mantém o arquivo atualizado sozinho, portanto, esta é a verificação ideal para um build
ou uma etapa de CI. Ele aceita `--schema-dir` e `--output` assim como o `rebase schema generate`.

### `rebase schema reconcile`

Relaxa e remove o que a inicialização não remove, depois que você tiver revisado o plano:

```bash
rebase schema reconcile                         # relaxa NOT NULL em colunas tornadas anuláveis ou removidas
rebase schema reconcile --drop voice_cache.wav  # e remove uma coluna que nenhuma tabela declara
```

**O que faz:**
- Solicita ao backend em execução que faça o planejamento contra seu próprio banco de dados. Esse é o banco para o qual o `.env` do backend e o link da nuvem apontam, funcionando inclusive no Rebase Cloud, onde nada mais alcança o banco de dados.
- Planeja `DROP NOT NULL` para cada coluna que uma tabela declara como anulável mas que o banco de dados ainda exige.
- Lista todas as colunas que nenhuma tabela declara. Uma coluna `NOT NULL` sem valor padrão bloqueia qualquer inserção, portanto, ela também é relaxada, e seus dados são mantidos. Remove apenas as colunas especificadas com `--drop <table>.<column>`, e exibe quantas linhas contêm valor em cada uma.
- Aplica as alterações assim que você digita `yes`. O servidor executa o plano apenas com base no resumo (digest) daquele que você visualizou; portanto, se o banco de dados ou as tabelas mudarem nesse meio-tempo, ele se recusa e você deve revisar novamente. `--yes` pula a confirmação.

A inicialização apenas adiciona elementos; logo, após remover uma coluna do seu `defineTable`, a coluna permanece no banco de dados, junto com seus dados. Uma coluna `NOT NULL` sem valor padrão fará com que qualquer inserção falhe, e o log de inicialização indicará este comando: sem `--drop` para manter os dados, com ele para remover a coluna. Faça o deploy da alteração da tabela primeiro, pois o reconcile faz o planejamento contra o que o backend está executando. Ele requer `REBASE_SERVICE_KEY` no `.env`. Localmente, o `rebase db push` cobre o mesmo cenário por meio de sua barreira de alterações destrutivas.

### `rebase schema introspect`

Gera arquivos `defineTable` a partir de um banco de dados PostgreSQL existente:

```bash
rebase schema introspect
```

**O que faz:**
- Conecta-se ao banco de dados deste projeto, aquele que `rebase db url` exibe (o banco gerenciado é iniciado se for o caso); `--database-url` especifica outro, e `--docker` usa o do Compose
- Lê cada tabela, coluna, tipo, chave estrangeira e política, e grava
  `backend/schema/<table>.ts` — um `defineTable` por tabela — e o arquivo
  `backend/schema/index.ts` que as exporta (mesclado em um índice já existente)
- Declara cada coluna com seu tipo Postgres: `col.uuid()`, `col.varchar({ length })`,
  `col.numeric({ precision, scale })`, um enum com seus rótulos e nome de tipo real
  (um `pgEnum` quando o tipo é compartilhado), um array como `<item>.array()`,
  `col.vector({ dimensions })`, chaves identity e serial, valores padrão — exatamente
  como o Drizzle os define. Um tipo não reconhecido por nenhum builder torna-se
  `col.custom({ dataType: "<sql type>" })`, o qual o Rebase entrega conforme o
  driver o retorna; `db generate` e `db push` o recusam até que o planejador
  possa interpretá-lo
- Declara a coluna de chave estrangeira, o `belongsTo` nela e o `hasMany` reverso
  no alvo; uma tabela de junção se torna um `manyToMany`, com suas próprias
  colunas atuando como `pivot`
- Lê as políticas de segurança em nível de linha de cada tabela para o seu `rls`: nome,
  comando, modo, lista `TO`, `USING` e `WITH CHECK`. As políticas
  `<table>_default_*` adicionadas pelo próprio Rebase são omitidas, de modo que o
  `db push` subsequente recria cada política como estava. Uma tabela com RLS
  ativo e nenhuma política é gravada como `rls: "admin-only"`
- Lê cada expressão (o `USING` de uma política, um CHECK, um padrão de coluna) sob
  o `search_path` utilizado pelo servidor, `public`, de forma que uma função no
  esquema `rebase` é escrita como `rebase.roles()`
- Transforma um CHECK passível de leitura (`total >= 0`) no `.validate()` da coluna, mantendo a restrição no banco de dados, onde o push subsequente a preserva. Todo CHECK também é listado sob "Not carried over" com seu SQL: um push em um banco de dados *novo* cria a validação, não a restrição
- Declara cada índice simples (apenas colunas, btree, gin ou brin, sem predicado) em `indexes` da tabela. Um índice exclusivo em uma coluna de chave estrangeira é deixado a cargo da relação, que cria um automaticamente
- Com `--from supabase`, converte as convenções do Supabase para um banco de dados do qual você está migrando: um padrão de coluna `auth.uid()` torna-se `.onCreateUser()` (o servidor grava o ID do chamador), uma coluna com o ID de usuário do Supabase (aquele padrão, ou uma chave estrangeira para `auth.users`) torna-se `col.text().userId()`, já que `rebase.users.id` e `rebase.uid()` são texto, e uma política `TO authenticated` / `TO anon` perde a role (um banco Rebase não possui nenhuma das duas) e passa a exigir um chamador autenticado/não autenticado; políticas exclusivas para `service_role` são descartadas. Cada alteração é destacada no topo do arquivo da tabela. Sem a flag, tudo é mantido como está (o Rebase em execução no mesmo banco ao lado do Supabase ainda precisa delas), e a execução indica quando as detecta
- Finaliza apresentando o que **não** foi transferido: funções, triggers, extensões, CHECKs, índices que `indexes` não consegue expressar, chaves estrangeiras compostas ou para outro schema. O SQL que recria cada item que o Postgres consegue exibir é gravado em `backend/sql/_introspected-left-behind.sql`, como rascunho: revise-o, torne-o seguro para execuções repetidas e renomeie-o sem o `_` inicial; assim, `rebase db push` e cada deploy o aplicarão sempre que houver alterações
- Lembra que `DATABASE_URL` ainda aponta para o banco de dados lido: em uma migração essa é a origem, e um `db push` imediato gravaria nele
- Em um projeto headless, substitui o arquivo `ai-instructions.md` do scaffold ("the database is the schema") pelas regras de esquema em código exclusivas de backend enquanto o arquivo estiver exatamente como gerado pelo scaffold; se tiver sido editado, é mantido inalterado, e o comando aponta quais regras deixaram de valer
- Insere o que não pôde determinar com precisão em um comentário no topo do arquivo da tabela e no terminal — um conjunto fechado de strings em uma coluna de texto, uma coluna gerada cuja expressão não foi lida, um tipo customizado — detalhando o que um push faria com isso
- Com `--data-inference`, analisa uma amostra de até 100 linhas por tabela e grava o que
  identificou como apresentação — títulos, ícones, boards, ordenações, opções de campos — em
  `frontend/src/cms/<table>.tsx` como um `customizeTable`, caso o frontend do projeto
  dependa de `@rebasepro/cms`. Projetos headless não recebem nada
- Em relação a um banco de dados que não está em execução, exibe o mesmo aviso
  que o `db push`, uma única vez, e não cria nada. Exibe o diretório de saída como
  um caminho absoluto

**Opções:**

| Flag | Descrição |
|------|-------------|
| `--schema-dir` | Onde gravar os arquivos de tabela (padrão: `backend/schema`). `--output` foi removido |
| `--schema` | O schema Postgres a ser lido (padrão: `public`) |
| `--force, -f` | Sobrescreve arquivos de tabela existentes; sem esta flag, arquivos existentes são ignorados |
| `--database-url` | Lê este banco de dados em vez do banco do próprio projeto |
| `--docker` | Lê o banco de dados do compose, iniciando-o se necessário |
| `--from supabase` | Converte as convenções do Supabase (padrões `auth.uid()`, chaves estrangeiras `auth.users`, `TO anon` / `TO authenticated`) para um banco de dados Rebase. Deixe desmarcado quando o Rebase rodar no mesmo banco ao lado do Supabase |
| `--data-inference` / `--no-data-inference` | Amostra até 100 linhas por tabela para detectar formatos, restrições e configurações de painel, ou lê apenas a estrutura. Sem nenhuma das flags, o comando solicita confirmação; sem um terminal interativo, lê apenas a estrutura |
| `--users` | Também cria `users.ts` para `rebase.users`, como um `defineAuthTable` correspondente à tabela criada pela autenticação. Isso exibe Usuários no painel admin como uma tabela na qual você pode adicionar colunas. Sem isso, as contas são gerenciadas em Users & Roles no Studio |

Isso é útil ao adotar o Rebase em um banco de dados existente — execute a introspecção
primeiro e, em seguida, edite as tabelas geradas. Uma tabela com RLS desativado é
gerada como qualquer outra, com seu `rls`; o push ativará o RLS, e o dry run
avisará sobre isso. Um backend executado sem nenhum `backend/schema` consome o
banco de dados diretamente — consulte [Apenas backend](/docs/getting-started/headless/).
Migrando do Supabase? Consulte [Migrando do Supabase](/docs/recipes/migrate-from-supabase/).

### `rebase db push`

Envia alterações de esquema diretamente para o banco de dados sem arquivos de migração:

```bash
rebase db push
```

**O que faz:**
- Lê o esquema Drizzle gerado
- Aplica alterações diretamente ao banco de dados (CREATE, ALTER, DROP)
- Executa um dry-run do plano primeiro e é interrompido antes de qualquer ação que destrua dados:
  remoção de tabela, coluna, schema, view ou tipo, um `TRUNCATE`, ou uma alteração de tipo
  de coluna que possa ocasionar perda de valores (`timestamptz` → `date`, `numeric` → `integer`),
  ou uma alteração de chave primária — `(id)` → `(id, locale)` atribui a cada linha um novo ID, fazendo com que
  links, chaves estrangeiras e IDs armazenados externamente deixem de encontrar sua respectiva linha.
  Também é interrompido antes da remoção de uma restrição CHECK ou EXCLUDE presente no banco: nenhuma
  linha é perdida, mas a partir de então o banco passa a aceitar linhas antes rejeitadas.
  Ele solicita confirmação no terminal (onde Ctrl-C ou Ctrl-D responde negativamente) e recusa a operação
  caso contrário; `--allow-destructive` aplica mesmo assim. `--yes` ainda funciona nesta versão,
  mas emite um aviso de depreciação; a partir da próxima versão, ele aprovará apenas pushes que não
  destruam dados. Um push interrompido nesse ponto remove o banco de dados temporário `<db>_dev_diff`
  ao finalizar
- Ativa a segurança em nível de linha (RLS) para todas as tabelas declaradas, inclusive junções, logo após a
  alteração de esquema e antes de qualquer etapa suscetível a falhas, garantindo que um push interrompido no meio do caminho
  deixe uma nova tabela negando todas as requisições em vez de deixá-la exposta
- Aplica as políticas de RLS resultantes da compilação do `rls` das suas tabelas e **remove políticas substituídas por um push anterior**
- <span class="since-badge" data-since="0.35">Desde 0.35</span> Com `--prune-policies`, também remove as políticas em tabelas declaradas que nenhuma tabela declara — aquelas que o dry run lista como "left in force", tais como políticas próprias do banco de dados após uma tabela migrar para `rls: "admin-only"` — na mesma transação que aplica as declaradas. O dry run lista cada uma sob "Planned row-level security changes", e o push as protege assim como faz com uma coluna removida (solicita confirmação no terminal e, fora dele, exige `--allow-destructive`): remover uma política altera quem pode ler e gravar as linhas, e remover uma política `RESTRICTIVE` amplia o acesso. Tabelas não declaradas em `backend/schema` e o schema `rebase` nunca são afetados
- Mantém inalterada qualquer restrição CHECK e EXCLUDE em tabelas declaradas. Como tabelas não podem
  declarar nenhuma das duas, elas são consideradas regras próprias do banco, criadas manualmente
  ou herdadas por um banco integrado via `schema introspect`; para remover uma delas, faça isso
  manualmente (`ALTER TABLE … DROP CONSTRAINT …`). Triggers e funções criadas por você
  também não são modificados
- Faz a correspondência exata do nome de todos os itens deixados intactos, incluindo
  caracteres como `.`, `[`, `]` ou `*`
- Cria qualquer
  [índice de chave estrangeira derivado pelo Rebase](/docs/backend/indexes#foreign-keys-are-indexed-for-you)
  ausente em uma tabela existente **antes** do planejamento, utilizando
  `CREATE INDEX CONCURRENTLY`, para que as gravações na tabela continuem durante o processo;
  o Atlas então o encontra já aplicado. `--dry-run` lista esses índices e não cria nada
- Aplica uma marcação (stamp) nas políticas aplicadas da mesma forma que a inicialização do servidor faz,
  garantindo que o primeiro boot após um push as mantenha intactas em vez de recriar cada uma
- `--dry-run`
  lista a segurança em nível de linha que o push alteraria, sob "Planned
  row-level security changes": as tabelas nas quais o RLS será ativado e cada
  política criada, substituída ou removida, determinadas da mesma forma que as
  etapas do próprio push decidem. A mensagem "No changes" só é exibida se nem o esquema
  nem o RLS forem alterados. Onde o stamp de uma política não corresponder à sua
  regra, ou onde ele inexistir (uma política criada por `db migrate` ou escrita manualmente), o dry
  run a recria a partir da regra sob outro nome, em uma transação revertida (rollback),
  e compara com o que o Postgres armazenou: se o resultado for idêntico, não há
  alteração. Assim, uma regra lida pelo `schema introspect` como SQL não gera alterações planejadas,
  assim como políticas aplicadas por `db migrate`. Apenas aquelas que não puderam ser comparadas (bloqueio
  da tabela não concedido em até dois segundos, por exemplo) são listadas separadamente. O push
  em si imprime uma única linha contabilizando as alterações
- Informa quando uma instância do `rebase dev` estiver rodando no mesmo banco de dados: ele aplica novas tabelas e colunas conforme você salva o código, de forma que "No changes" pode significar que ele já as aplicou
- Exibe cada instrução aplicada pelo Atlas uma única vez. O Atlas conecta-se sem SSL a bancos de dados nesta
  máquina local (`localhost`, `127.x`, `::1`) cuja URL não especifique `sslmode`, assim como a aplicação
  faz, em vez de falhar com `SSL is not enabled on the server`; uma URL que
  especifique `sslmode`, ou outro host, é repassada exatamente como definida. Uma execução do Atlas
  que falha antes do planejamento não deixa o banco de dados `<db>_dev_diff` para trás
- `--dry-run`
  não grava nada no projeto: `src/schema.generated.ts` é mantido inalterado,
  e cópias em `drizzle/*.sql` commitadas por versões antigas são listadas, não
  excluídas. Apenas o arquivo de entrada do plano vai para `.rebase/sql/`, que não é versionado
- **Não** cria arquivos de migração

**Tempo de execução.** Quase todo o tempo de um push é consumido pelo Atlas calculando o plano: ele
constrói o esquema desejado em um banco de dados temporário e faz a comparação com o banco real,
e esse custo cresce mais rápido que o número de tabelas — em um laptop sem carga pesada,
cerca de 0,25 s por plano com 11 tabelas, 0,9 s com 111 e 5,5 s com 411. Um push sem alterações
faz o planejamento uma vez; um push com alterações faz o planejamento duas vezes (o dry-run
lido pela barreira de alterações destrutivas e, depois, a aplicação). Portanto, um push em um esquema com
400 ou mais tabelas leva dezenas de segundos, demorando mais em máquinas lentas ou ocupadas.
Esse tempo pertence ao Atlas, não ao seu banco de dados: as etapas adicionais — geração do
SQL, bloqueio de RLS, busca, triggers, políticas, role — levam poucos segundos nessa
escala, usando uma única conexão ao seu banco.

**Arquivos gerados no processo**, todos sob `.rebase/sql/` no diretório do backend.
`db push` e `db generate` gravam todos os cinco arquivos a partir das suas tabelas em
cada execução, antes de ler qualquer um deles, portanto, uma cópia commitada não seria
lida por nada. O diretório contém seu próprio `.gitignore` e nunca deve ser versionado.

| Arquivo | Conteúdo |
|------|-------|
| `schema.sql` | Tabelas, colunas, restrições e índices — o estado desejado pelo Atlas, e o único que ele compara |
| `policies.sql` | As políticas de RLS resultantes da compilação do `rls` das suas tabelas |
| `search.sql` | As funções de busca textual (full-text search) e colunas geradas, para tabelas com bloco `search` |
| `vector.sql` | Extensões pgvector e índices ANN |
| `triggers.sql` | `rebase.set_updated_at()` e as triggers `BEFORE UPDATE` associadas a `.onUpdateNow()` |

O Atlas gerencia apenas o primeiro arquivo; portanto, o `db push` e a verificação de esquema
na inicialização aplicam os outros quatro por conta própria. Um deploy baseado **apenas em migrações** — que
executa `db migrate` e nunca `db push` — precisa consolidar esses quatro arquivos em uma
migração manualmente; o `db generate` avisa quando uma alteração for invisível para o Atlas.

Projetos que comitaram esses arquivos em `drizzle/` em versões anteriores terão
essas cópias excluídas na primeira execução, e o comando nomeia cada arquivo para que você possa
comitar a exclusão. Ele remove apenas arquivos que começam com o cabeçalho
do gerador. Arquivos criados manualmente permanecem intactos, assim como `drizzle/migrations/`.

:::note[Editar uma regra de segurança renomeia sua política]
Uma regra sem um `name` explícito é compilada para `<table>_<op>_<hash>`, onde o hash reflete a semântica da regra — portanto, *editar* uma regra (em vez de adicionar uma nova) produz uma política com um novo nome e mantém a anterior.

Isso costumava ser um grande problema: o Postgres avalia políticas `PERMISSIVE` com o operador OR, logo, uma regra anterior com `USING (rebase.uid() IS NOT NULL)` continuava concedendo acesso amplo, independentemente do quão restritiva fosse a nova regra substituta. Tornar a regra mais rígida não surtia efeito, e o push relatava sucesso.

O `db push` agora resolve isso: ele remove políticas geradas que não correspondem mais a nenhuma regra e lista — sem remover — qualquer política com nome customizado não descrita em suas tabelas, já que essas são indistinguíveis de instruções SQL escritas deliberadamente por alguém.

Para auditar um banco de dados que recebeu push antes dessa implementação, execute `rebase doctor --policies`. Ele funciona como uma barreira de CI: encerra com código diferente de zero se houver divergência, e também caso não consiga executar a checagem — ausência de `DATABASE_URL`, caminho `--schema-dir` inválido ou permissão negada à role do CI para leitura de `pg_policies`. Uma verificação que não pôde ser executada não é considerada aprovada.

O `doctor` e o `db push` diferenciam esses dois tipos de órfãos. Uma política com nome gerado automaticamente foi substituída, e o próximo push a removerá. Qualquer outro nome foi escrito manualmente ou por outra ferramenta e permanece em vigor: descreva-a no `rls` da respectiva tabela para mantê-la (a visualização de RLS do Studio faz essa importação) ou remova-a com `rebase db push --prune-policies` caso esteja obsoleta.
:::

:::caution
O `db push` modifica o banco de dados diretamente. Use-o apenas em ambiente de desenvolvimento. Para produção, utilize `db generate` + `db migrate` para gerar arquivos de migração passiveis de revisão.
:::

### `rebase db generate`

Gera arquivos de migração SQL a partir de alterações no esquema:

```bash
rebase db generate
```

**O que faz:**
- Compara o esquema Drizzle com o estado consolidado pelas migrações em `drizzle/migrations/`, e não com seu banco de dados
- Produz arquivos de migração SQL com timestamp em `backend/drizzle/migrations/`
- Os arquivos podem ser revisados, editados e versionados no controle de código
- Aponta todas as
  instruções na nova migração que destroem dados, usando a mesma verificação que o `db push`
  executa antes da aplicação: remoção de tabela, coluna, schema, view ou tipo, um
  `TRUNCATE`, alteração de tipo de coluna com risco de perda de valores, alteração
  de chave primária ou remoção de restrição CHECK ou EXCLUDE existente no banco. Ele
  ainda assim grava o arquivo e encerra com código 0, funcionando como um aviso sem bloquear a execução.
- Conclui indicando os
  próximos passos: `rebase db migrate` e, no caso da primeira migração de um projeto, a instrução
  `--baseline <version>` necessária caso o banco já tenha sido inicializado anteriormente pelo boot.
  Migrações posteriores não recebem indicação de baseline, visto que definir baseline para uma operação destrutiva
  pularia seu `DROP`, e execuções que não geram novas migrações apenas relatam esse fato.

**Um CHECK adicionado por uma migração sua é removido pela migração seguinte.** O `db generate`
compara seus arquivos de migração, não o banco de dados, e o Atlas não possui uma forma de excluir um
objeto dessa comparação. Portanto, uma restrição CHECK ou EXCLUDE inserida manualmente em uma
migração, e que nenhuma tabela consegue declarar, retorna como
`ALTER TABLE … DROP CONSTRAINT …` na próxima migração gerada, agrupada
na mesma instrução da alteração real. O relatório acima aponta essa remoção quando
o banco de dados já possui a restrição; ele não a remove do
arquivo. Exclua a cláusula antes de executar `rebase db migrate`, ou utilize
`rebase db migrate --refuse-destructive` para interromper a execução nela. O `db push` lê o
banco de dados e mantém a restrição intacta.

As migrações geradas são arquivos SQL comuns — você pode inspecioná-los e modificá-los antes de aplicá-los.

### `rebase db migrate`

Executa todas as migrações pendentes:

```bash
rebase db migrate
```

**O que faz:**
- Lê `drizzle/migrations/` em busca de migrações não aplicadas
- Aplica-as em ordem no banco de dados
- Rastreia quais migrações já foram aplicadas
- Aplica uma marcação (stamp) nas
  políticas de segurança em nível de linha da mesma forma que o `db push` e a inicialização do servidor fazem,
  de modo que o primeiro boot após o migrate as mantenha intactas em vez de recriar cada
  uma. Uma migração foi escrita a partir das tabelas da sua respectiva época, logo uma política só
  recebe o stamp se for idêntica ao que sua regra produz atualmente: o migrate a recria
  a partir de sua regra com outro nome, em uma transação revertida (rollback), e
  compara com o que o Postgres armazenou, exatamente como o `db push --dry-run` faz. Uma política
  com diferenças não recebe o stamp, e a próxima inicialização reaplica sua tabela

`--refuse-destructive`
faz com que o comando aborte a operação diante de alterações destrutivas. Ele executa um dry-run das migrações pendentes primeiro. Se alguma
instrução destruir dados, com base na mesma verificação utilizada por `db push` e `db generate`, ele
lista essas instruções e encerra com código 1. Nada é aplicado, nem mesmo os arquivos
anteriores àquela instrução. Sem essa flag, o `db migrate` opera normalmente e
aplica todos os arquivos pendentes:

```bash
rebase db migrate --refuse-destructive
```

Uma migração que reconstrói uma coluna de busca remove a coluna primeiro, portanto essa flag recusará
essa migração também. Revise a lista exibida e execute `rebase db migrate`
sem a flag para aplicá-la.

#### Fazendo o baseline de um banco de dados já inicializado pelo Rebase

Toda inicialização do Rebase valida o esquema, e o `rebase db push` o aplica diretamente. Logo, um banco de dados que já executou qualquer um dos dois já possui as tabelas e tipos que a primeira migração criaria, fazendo com que o `rebase db migrate` falhe com `pq: type "posts_status" already exists (42710)`.

Não há nada de errado com a migração — o banco de dados simplesmente foi provisionado por outro meio. Registre em qual versão ele já se encontra e migre normalmente:

```bash
rebase db migrate --baseline 20260906101530
rebase db migrate
```

A versão corresponde ao prefixo numérico do arquivo de migração que descreve o que está no banco de dados *neste momento*. Essa migração e todas as anteriores são registradas como aplicadas; tudo o que vier depois será executado. Em um banco de dados contra o qual nada foi inicializado previamente, não é necessário fazer baseline — basta rodar a migração imediatamente.

O mesmo acontece mais tarde no fluxo de desenvolvimento comum: edite uma tabela enquanto o `rebase dev` estiver em execução, e a inicialização adicionará a coluna antes que o `rebase db generate` gere a migração que a adiciona, fazendo com que o `rebase db migrate` falhe com `column … already exists (42701)`. Faça o baseline dessa migração da mesma maneira. O `--baseline` funciona em bancos que já registram migrações: ele marca tudo até a versão especificada como aplicado usando `atlas migrate set` e exibe a confirmação, ou informa que não há nada a registrar caso o histórico já tenha alcançado essa versão. Versões não presentes em `drizzle/migrations` são recusadas antes de qualquer execução, listando as versões válidas existentes.

### `rebase db branch`

Ramificação de banco de dados (branching) para desenvolvimento paralelo:

```bash
rebase db branch create feature_auth
rebase db branch switch feature_auth
rebase db branch list
rebase db branch switch --off

rebase db branch info feature_auth
rebase db branch delete feature_auth
```

`rebase db branch switch` (e `switch --off`) e `rebase db branch prune`
são novidades. `create`, `list`, `info` e `delete` foram introduzidos na versão 0.17.

Cada branch é uma cópia completa do banco de dados criada com `CREATE DATABASE ... TEMPLATE`,
portanto, requer um servidor PostgreSQL real e consome o mesmo espaço em disco que a sua origem.

### `rebase doctor`

Detecta divergências triplas entre suas tabelas, o esquema Drizzle gerado e o banco de dados PostgreSQL ativo:

```bash
rebase doctor
```

**O que ele verifica:**
- Tabelas ↔ Esquema gerado — estão sincronizados?
- Esquema gerado ↔ Banco de dados — existem alterações não aplicadas?
- Tabelas ↔ Banco de dados — existe alguma divergência inesperada?

Execute o `doctor` sempre que notar inconsistências. Ele aponta com exatidão onde está o descompasso.

A comparação com o banco de dados inclui a mesma validação que a inicialização faz antes de alertar que `schema.generated.ts` e o banco discordam, executada pelo mesmo código. Assim, todas as diferenças alertadas no boot também constam no relatório, com as mesmas palavras: uma coluna NOT NULL de um lado e anulável do outro, e uma coluna ainda presente no banco de dados que não está no arquivo (a inicialização nunca remove nada, portanto renomear uma propriedade mantém a coluna antiga). Cada item é um aviso, e a solução indica o uso de `rebase db push`.

A comparação com o banco de dados lê o banco do projeto, resolvido da forma como `rebase db url` o resolve — em um scaffold limpo, o banco gerenciado, o qual o `doctor` inicializa. Quando nenhum puder ser resolvido, essa fase é indicada como **ignorada (skipped)** em vez de aprovada, e a execução nunca é concluída com "All schemas are in sync" — uma checagem que não ocorreu não equivale a uma validação de sucesso.

Ele também aponta todas as tabelas sem o [bloco `search`](/docs/backend/search) que contenham mais de aproximadamente 10.000 linhas. Uma busca nessas tabelas — pelo campo de busca do admin, `.search()`, `?searchString=` — opera como `ILIKE '%term%'` sobre as colunas de texto, algo que nenhum índice consegue otimizar; assim, cada busca lê a tabela inteira, e a contagem a lê novamente (cerca de um terço de segundo com 100.000 linhas, aumentando conforme a tabela cresce). A contagem de linhas baseia-se na própria estimativa do Postgres, de modo que a verificação não faz varredura completa. Trata-se de uma recomendação: não altera o código de saída e nada é indexado automaticamente.

Ele também alerta sobre uma **junção órfã**: uma tabela no schema `public` com formato de junção many-to-many que nenhuma tabela declara. Essa estrutura consiste em duas colunas que juntas formam a chave primária, sendo cada uma delas uma chave estrangeira para uma tabela declarada. Renomear ou remover um `manyToMany` deixa a junção antiga para trás, pois o push e a inicialização apenas criam tabelas, mantendo todas as linhas de vínculo intactas. Este aviso tem caráter puramente informativo e não afeta o código de saída. A correção sugerida é a instrução `DROP TABLE`, exibida pelo `doctor` mas nunca executada por ele.

### `rebase generate-sdk`

Gera um SDK tipado a partir das suas tabelas:

```bash
rebase generate-sdk
```

**O que faz:**
- Lê as tabelas que `backend/schema/index.ts` exporta, por meio do loader usado no boot do backend, garantindo que o SDK descreva exatamente as tabelas servidas; um esquema que não compila interrompe a execução
- Gera tipos TypeScript para cada tabela em `generated/sdk/`
- Produz um arquivo `database.types.ts` para uso com `createRebaseClient<Database>()`: o tipo `Database`, `TableName` (a união de todos os slugs), e `tablesDictionary` / `TablesDictionary`, o mapeamento do accessor para o slug

O `rebase dev` executa isso automaticamente na inicialização e a cada alteração salva em
`backend/schema/`. Execute manualmente em CI, em repositórios que não possuem
tabelas próprias (veja `--from` abaixo) ou em qualquer ambiente onde o `rebase dev` não esteja rodando.

**Opções:**

| Flag | Descrição |
|------|-------------|
| `--schema-dir` | O diretório do esquema (padrão: `backend/schema`, ou a chave `tables` em `rebase.json`); caminhos relativos são calculados a partir de onde o comando é executado |
| `-o`, `--output` | Diretório de saída do SDK (padrão: `generated/sdk/`) |
| `--from <link\|url>` | Lê o esquema de um projeto em execução em vez do código-fonte local. `link` usa o projeto vinculado a este checkout. |
| `--token` | Token Bearer para o endpoint de contrato (padrão: `$REBASE_SERVICE_KEY` do ambiente do shell; o arquivo `.env` não é lido) |
| `--register` | Também tipa os dados do lado do servidor: grava os tipos e uma declaração `Register` em `backend/generated/`, salvando a preferência em `rebase.json` — consulte [Dados tipados do lado do servidor](/docs/backend/typed-server-data/) |

`--from` permite que um repositório sem tabelas próprias — um frontend separado,
uma segunda aplicação web, um aplicativo móvel — gere um cliente tipado a partir do
projeto com o qual se comunica: ele lê as `tables` expostas em
`/api/meta/contract` no backend em execução. A chave `REBASE_SERVICE_KEY` só é enviada ao projeto
ao qual este checkout está vinculado; passe `--token` explicitamente para qualquer outro host. A chave no
`.env` pertence ao seu backend local e nunca é transmitida.
Uma recusa aponta
qual das seguintes situações ocorreu: um `--token` recusado, uma chave do shell recusada, uma chave
retida por se tratar de host não vinculado, uma chave presente apenas no `.env` ou nenhuma chave fornecida.

**Uso após a geração:**

```typescript
import { createRebaseClient } from "@rebasepro/client";
import { tablesDictionary, type Database } from "./generated/sdk/database.types";

const client = createRebaseClient<Database>({
    baseUrl: import.meta.env.VITE_API_URL,
    tables: tablesDictionary,
});

// Segurança total de tipos e autocompletar
const { data } = await client.data.products.find();
```

Os nomes dos campos nos tipos gerados correspondem aos servidos pela API. O nome
trafegado de um campo é a chave da sua coluna, e a API adota camelCase por padrão: a introspecção
escreve uma coluna `created_at` como `createdAt: col.timestamp({ withTimezone: true })`, cujo nome SQL
é o snake_case da chave, fornecendo-a como `row.createdAt`. A coluna
em si permanece inalterada. O *accessor* da tabela é convertido em nome de propriedade da
mesma forma (`my-notes` → `client.data.myNotes`), sendo esse o valor que o `tablesDictionary`
mapeia de volta para o slug.

### `rebase migrate`

`rebase migrate collections-to-tables [dir]` move `config/collections` para
`backend/schema` (um `defineTable` por collection, cada coluna explicitada na
sua posição original, na sintaxe do Drizzle, e o `index.ts` com
`defaultRls`) e para `frontend/src/cms` (um `customizeTable` por collection customizada,
arquivos `defineFirestoreCollection`, `ui-config.json`), gera
`backend/resources.ts`, `backend/storage.ts` e `backend/generated/register.ts`,
adiciona `rebaseBackendGuard()` ao `vite.config.ts` do scaffold e, em seguida, executa
`rebase migrate sdk-calls`, que reescreve chamadas `.collection(` para `.table(`, realiza
as demais renomeações de SDK e fontes de regras `existsIn` / `membership` no seu código,
e atualiza os imports com nomes que a versão 0.31 transferiu para outros pacotes
([veja a lista](/docs/upgrading/0-30-to-0-31-imports/)), incluindo o novo pacote nas
dependências ("Dependencies added": execute `pnpm install`). Atualize todos os pacotes `@rebasepro` para a versão 0.31 antes de executar.
Toda execução revalida o resultado: o SQL gerado — DDL, políticas, search,
vector, triggers, views, o esquema Drizzle — deve ser idêntico byte a byte, caso contrário
todos os arquivos originais são restaurados. O que não puder ser convertido é recusado apontando o arquivo e a linha, e
o que depender de intervenção sua é exibido como etapas manuais numeradas, finalizando com
`rebase skills install` caso o projeto contenha skills de agentes. Seus próprios módulos em
`config/` permanecem; o comando imprime a linha de `git rm` para os itens substituídos. Ele também
contempla collections do Firestore geradas por funções, aliases de caminhos, painéis montados
fora de `App.tsx` e qualquer app estático sem guard ([consulte a lista completa](/docs/upgrading/0-30-to-0-31/#108-tables-in-backendschema-replace-configcollections--run-the-codemod-first)).
Após o `git rm`, o comando `--check` relata `already-migrated`.

| Flag | Efeito |
|---|---|
| `--dry-run` | Exibe arquivos, recusas, observações e etapas manuais; não grava nada. Comece por aqui. |
| `--check` | Em um projeto já migrado: comprova que `backend/schema` ainda produz o mesmo SQL. Encerra com código 1 exibindo o diff, ou se alguma regra mudar de significado. |
| `--accept-rule-changes` | Com `--check`: confirma que as regras sob "Review before deploying" foram revisadas. |
| `--json` / `--force` / `--skip-sdk-calls` | Exibe o relatório em JSON (com `ruleChanges`); execute em uma árvore com alterações pendentes ou sobre saídas já editadas; mantém seu código intocado. |

Acompanhe duas listas geradas na saída do SDK: **"Rewritten by name — review"** (receptores
sem tipagem, data slots, dublês de teste) e **"Left unchanged — check each"**
(renomeie os que fizerem parte do SDK; [uma busca](/docs/upgrading/0-30-to-0-31-by-hand/#sdk-calls-no-type-checker-sees) localiza os demais).

A checagem de SQL garante que a conversão foi fiel estruturalmente, mas não que uma regra continua mantendo o
mesmo comportamento de antes. A seção final do log, **"Review before deploying: these rules change meaning"**,
lista todas as regras cuja política agora concede permissões diferentes
— uma declaração isolada de `access: "authenticated"` não concedia nada e agora passa a permitir qualquer
chamador autenticado ([veja os quatro formatos](/docs/upgrading/0-30-to-0-31/#review-before-deploying-these-rules-change-meaning)).
Em seguida, valide contra o banco de dados: `rebase db push --dry-run` deve retornar "No
changes: the database already matches these tables.", e
`rebase doctor --policies` não deve apontar divergências.

## Fluxo de Desenvolvimento

O fluxo de iteração rápida para desenvolvimento:

```bash
# 1. Edite uma tabela em backend/schema/
# 2. Gere o esquema Drizzle
rebase schema generate

# 3. Aplique diretamente no banco de desenvolvimento
rebase db push
```

## Fluxo de Produção

O fluxo seguro e auditável para produção:

```bash
# 1. Edite uma tabela em backend/schema/
# 2. Gere o esquema Drizzle
rebase schema generate

# 3. Gere os arquivos de migração SQL
rebase db generate

# 4. Revise o SQL gerado em backend/drizzle/migrations/
# 5. Comite a migração no controle de versão
git add backend/drizzle/migrations/

# 6. Aplique em produção
#    Um banco de dados já inicializado pelo Rebase necessita de baseline na primeira execução —
#    veja "Fazendo o baseline de um banco de dados já inicializado pelo Rebase" acima.
rebase db migrate
```

## Solução de Problemas

| Sintoma | Solução |
|---------|----------|
| `Could not detect an active database plugin` | Instale `@rebasepro/server-postgres` em `backend/package.json` |
| Arquivo de esquema não atualiza | Verifique se o caminho `--schema-dir` (ou a chave `tables` em `rebase.json`) aponta para o diretório correto |
| Migração exibe alterações inesperadas | Execute `rebase doctor` para identificar a divergência |
| `db push` falha em produção | Use `db generate` + `db migrate` em vez de push |
| Uma migração não pode apagar dados em CI ou produção | `rebase db migrate --refuse-destructive` encerra com código 1 e não aplica nada caso uma instrução pendente destrua dados |
| `db migrate` falha com `already exists (42710)` | O boot ou o `db push` já criaram o esquema — registre essa etapa com `rebase db migrate --baseline <version>` |
| `db migrate` falha com `column … already exists (42701)` | O `rebase dev` adicionou a coluna durante o boot — faça o baseline dessa migração da mesma forma |
| `db push` no banco de dados gerenciado falha com `Error: EOF` | O Atlas perdeu uma conexão retida pelo `rebase dev` em execução. Execute novamente; se persistir, pare o `rebase dev` primeiro |

## Próximos Passos

- **[Tabelas](/docs/schema/)** — Defina seu modelo de dados
- **[Referência da CLI](/docs/cli)** — Todos os comandos da CLI
- **[SDK Tipado](/docs/sdk)** — Utilize o SDK gerado
