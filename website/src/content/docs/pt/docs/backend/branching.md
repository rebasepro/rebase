---
sourceHash: f9ad18cf03580c13
title: Branching de Banco de Dados
sidebar_label: Branching
description: Crie branches de banco de dados isoladas para desenvolvimento, homologação e testes usando o CREATE DATABASE ... TEMPLATE do PostgreSQL — cópias instantâneas e de total fidelidade sem tempo de inatividade.
---

## Visão Geral

O branching de banco de dados permite criar **cópias instantâneas e isoladas** de todo o seu banco de dados (tanto o esquema quanto os dados) para realizar com segurança tarefas de desenvolvimento, testes de migração e procedimentos de garantia de qualidade (QA).

Aproveitando os templates nativos do PostgreSQL, o Rebase provisiona bancos de dados clonados no nível do sistema de arquivos. Isso significa que você obtém uma réplica de fidelidade total contendo todas as tabelas, índices, tipos customizados, restrições (constraints) e políticas de Segurança em Nível de Linha (RLS, Row-Level Security) sem nenhuma sobrecarga de transferência de rede ou atrasos na configuração do esquema.

```
                  ┌────────────────────────┐
                  │ Production DB (rebase) │
                  └───────────┬────────────┘
                              │
               (CREATE DATABASE ... TEMPLATE)
                              │
            ┌─────────────────┴─────────────────┐
            ▼                                   ▼
┌───────────────────────┐           ┌───────────────────────┐
│ rb_feature_auth (Dev) │           │ rb_staging (Staging)  │
└───────────────────────┘           └───────────────────────┘
```

---

## Por Baixo dos Panos: Templating do PostgreSQL

Quando uma branch de banco de dados é criada, o `BranchService` do Rebase executa o seguinte SQL:

```sql
CREATE DATABASE "rb_feature_auth" TEMPLATE "rebase";
```

O PostgreSQL processa essa operação copiando os diretórios subjacentes do sistema de arquivos que contêm os arquivos do banco de dados de origem. Isso proporciona:
- **Clones em Menos de um Segundo**: Nenhuma geração de SQL ou carregamento de dados é realizado.
- **Esquemas e Dados Idênticos**: Cada linha, índice e constraint é duplicado instantaneamente.
- **Isolamento Completo**: Alterar o esquema ou inserir registros na branch não tem impacto no banco de dados de origem.

### A Proteção contra Limitação de Conexões

O PostgreSQL exige que **nenhuma outra conexão ativa** exista no banco de dados template (origem) ao executar o comando `CREATE DATABASE ... TEMPLATE`.

Para evitar falhas, o `DatabasePoolManager` do Rebase executa um processo ativo de expulsão (eviction) antes de clonar ou excluir uma branch:
1. **Loop de Expulsão**: Ele fecha e desconecta automaticamente todos os pools ociosos que apontam para o banco de dados de destino dentro do contexto da aplicação Rebase.
2. **Bloqueio de Conexões Externas**: Se clientes externos (como DBeaver, pgAdmin ou processos de backend externos) mantiverem transações ativas no banco de dados de origem, o PostgreSQL rejeitará a operação de template com um erro `"being accessed by other users"`.

A falha indica exatamente o que está conectado, em vez de deixar você adivinhando:

```
Cannot create branch: the source database "leadgen" has active connections.
  Connected right now:
    2 × psql
  A running `rebase dev` is the usual one — stop it, or re-run with --force to
  disconnect them for you.
```

O `--force` encerra essas sessões antes da criação do template, tanto no `create` quanto no `delete`. Ele nunca encerra a sessão que está executando o próprio comando.

O `create --force` também fecha a origem para novas conexões durante a cópia (`ALTER DATABASE … ALLOW_CONNECTIONS false`, executado a partir do banco de dados `postgres` do servidor) e a reabre em seguida: em caso de falha e em qualquer sinal que possa interceptar (fechamento do terminal, Ctrl-C, SIGTERM, SIGQUIT). Se for interrompido abruptamente (SIGKILL), ele deixa a origem fechada até o próximo comando `rebase db branch`, qualquer um deles, que primeiro a reabre e informa isso; `ALTER DATABASE "<db>" ALLOW_CONNECTIONS true`, executado a partir do banco de dados `postgres`, faz o mesmo manualmente. Enquanto um create forçado mantém sua origem fechada, ele mantém um advisory lock nela no banco de dados `postgres`, de modo que a reabertura não afete a origem de uma cópia em andamento, e um segundo create forçado a partir da mesma origem aguarde o término do primeiro. Um cliente que se reconecta assim que é desconectado, como faz um `rebase dev` em execução, não consegue se infiltrar antes do início da cópia. Isso requer o proprietário da origem; sem ele, e no `delete`, o `--force` desconecta as sessões até três vezes antes de desistir. Se uma sessão ainda permanecer após isso, o erro informa que ela se reconectou e que deve ser interrompida, e não para passar `--force` novamente.

O `DatabasePoolManager` desconecta seus próprios pools ociosos antes de clonar ou descartar — mas apenas os pools **dentro do processo que está realizando o trabalho**. O `rebase db branch` é executado como um processo próprio, portanto, isso não atinge nada mais na sua máquina:

- **Um `rebase dev` em execução bloqueia o branching.** Este é o caso comum, não um caso isolado: querer uma branch e executar a aplicação geralmente acontecem no mesmo momento. Pare o servidor de desenvolvimento, crie a branch e inicie-o novamente.
- **O mesmo vale para qualquer outro cliente.** DBeaver, pgAdmin, uma sessão do `psql`, uma segunda instância da aplicação — o PostgreSQL rejeita a operação com `is being accessed by other users` e essas conexões precisam ser encerradas manualmente.

Não há como contornar isso no próprio PostgreSQL; `CREATE DATABASE ... TEMPLATE` é uma cópia em nível de sistema de arquivos e o template deve permanecer inativo durante o processo.

---

## Esquema de Metadados

As configurações de branch são armazenadas no banco de dados padrão na tabela `rebase.branches`, que é provisionada durante o bootstrapping:

```sql
CREATE SCHEMA IF NOT EXISTS rebase;

CREATE TABLE IF NOT EXISTS rebase.branches (
    name         TEXT PRIMARY KEY,              -- Branch name as given (letters, digits, underscores, hyphens)
    db_name      TEXT NOT NULL UNIQUE,          -- Actual PostgreSQL database name (prefixed with 'rb_')
    parent_db    TEXT NOT NULL,                 -- Source database cloned from
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata     JSONB DEFAULT '{}'
);
```

Um servidor em execução em uma branch mantém as branches no banco de dados a partir do qual a branch foi copiada. O próprio `rebase.branches` da branch é apenas um snapshot, tirado antes de sua linha ser gravada. Assim, o `rebase dev` em um checkout [alternado (switched)](#integração-com-a-cli) define `REBASE_BRANCH_PARENT_DATABASE` para o banco de dados que o `.env` especifica, e um servidor com essa variável lê e grava o registro lá, além de copiar novas branches a partir dele por padrão. O painel Branches do Studio em uma branch lista as branches do banco de dados principal, incluindo a atual, e uma branch criada lá é exibida por `rebase db branch list`.

---

## API Programática

A API de branching é exposta por meio do `BranchService` do backend. Abaixo está uma referência da interface principal:

### Criar uma Branch de Banco de Dados

Gera um novo banco de dados de branch a partir do banco de dados padrão ou de um template de origem explícito.

O padrão é o banco de dados no qual a própria conexão do servidor está conectada, ou `REBASE_BRANCH_PARENT_DATABASE` quando o servidor roda em uma branch. Nunca é o banco de dados que a `ADMIN_CONNECTION_STRING` define, quando for um banco diferente.

```typescript no-verify
import { initializeRebaseBackend } from "@rebasepro/server";

const backend = await initializeRebaseBackend({ /* ... */ });
const admin = backend.driver.admin;

// Create a branch from the default database
const newBranch = await admin.createBranch("feature_oauth");

// Create a branch from a specific staging database
const stagingBranch = await admin.createBranch("pr_review_42", { 
    source: "rb_staging" 
});
```

### Listar Branches Ativas

Recupera a lista de branches registradas juntamente com seus tamanhos físicos consultados através da função de sistema `pg_database_size` do PostgreSQL.

```typescript
const branches = await admin.listBranches();
/*
Output:
[
  {
    name: "feature_oauth",
    database: "rb_feature_oauth",
    parentDatabase: "rebase",
    createdAt: 2026-06-20T22:00:00.000Z,
    sizeBytes: 83886080 // 80 MB
  }
]
*/
```

`database` é o banco de dados PostgreSQL correspondente à branch, conforme consta em seu registro: ao que se conectar e o que passar como `source` para copiar a branch. Não é o nome da branch (`staging` é o banco de dados `rb_staging`).

### Obter Informações da Branch

Busca os metadados de uma única branch. Se a branch existir, o serviço tenta consultar seu uso atual de disco físico:

```typescript
const info = await admin.getBranchInfo("feature_oauth");
```

### Excluir uma Branch

Remove (drop) o banco de dados de destino do servidor e limpa seu registro na tabela de metadados `rebase.branches`.

```typescript
await admin.deleteBranch("feature_oauth");
```

> [!CAUTION]
> Proteção de Segurança: O banco de dados principal (nome do banco de dados padrão configurado nas strings de conexão) é protegido. Esse é o banco de dados no qual a própria conexão do servidor está, ou `REBASE_BRANCH_PARENT_DATABASE` em uma branch. Se você tentar excluir o banco de dados pai, o `BranchService` lançará um erro `"Cannot delete the main database"` e abortará.

---

## Integração com a CLI

As branches de banco de dados podem ser gerenciadas diretamente usando a CLI do Rebase.

```bash
# Create a new branch named 'dev_sandbox'
rebase db branch create dev_sandbox

# Clone from a database other than the default
rebase db branch create pr_review_42 --from rb_staging

# List all branches and disk utilization
rebase db branch list

# Work on it — every later command in this checkout uses it
rebase db branch switch dev_sandbox

# Which branch am I on?
rebase db branch switch

# Back to the main database
rebase db branch switch --off

# Show one branch's parent, age and size
rebase db branch info dev_sandbox

# What the branch changed: schema, RLS policies and rows (--json for all of it)
rebase db branch diff dev_sandbox

# Delete a branch
rebase db branch delete dev_sandbox
```

O `switch` é o que torna uma branch utilizável. Ele registra a branch em `.rebase/branch.json` — apenas um nome, nunca uma string de conexão, para que suas credenciais permaneçam exclusivamente no `.env` — e cada comando `rebase` nesse checkout passa a resolver o banco de dados da branch: `dev`, `db push`, `db migrate`, `db backup`. Um `rebase dev` que já esteja em execução mantém o banco de dados no qual foi iniciado até que você o reinicie, e o `switch` informa isso.

O `rebase db branch list` marca a branch em que este checkout está, e o `prune` nunca a remove, assim como o `delete` se recusa a fazê-lo: o plano a lista como mantida e informa para sair dela com `rebase db branch switch --off` primeiro.

Ele fica entre o shell e o arquivo de projeto na ordem de resolução:

1. `--database-url` na linha de comando
2. `DATABASE_URL` no ambiente do shell
3. **a branch para a qual este checkout foi alternado**
4. `DATABASE_URL` no `.env` do projeto
5. `--docker`, ou o último `rebase dev` tendo sido executado com ele
6. o banco de dados de desenvolvimento gerenciado

O nível 5 segue o último `rebase dev --docker`, portanto, um comando de branch executado após ele não precisa de `--docker` próprio, e um `--docker` superado por um nível acima não inicia nenhum contêiner e informa que foi ignorado.

Uma branch precisa ter prioridade sobre o `.env`, caso contrário a alternância não faria nada em nenhum projeto que defina `DATABASE_URL`; ela não deve ter prioridade sobre os dois níveis acima, porque uma flag nesta linha de comando é uma instrução mais imediata do que uma alternância feita ontem.

O diretório `.rebase/` está no .gitignore, portanto, a branch em que você está é uma configuração da sua máquina e nunca do projeto.

Em um checkout alternado, `rebase db branch create`, `list`, `info`, `delete` e `prune` operam no banco de dados principal, onde o registro reside, e informam isso. O `create` ainda copia a branch em que você está, a menos que passe `--from`; ela é registrada no banco de dados principal, então o `list` a exibe a partir de qualquer checkout.

As branches são bancos de dados PostgreSQL comuns nomeados a partir da branch com o prefixo `rb_`, de modo que `dev_sandbox` acima é o banco de dados `rb_dev_sandbox` no mesmo servidor.

Criar uma branch **não** altera com qual banco de dados seu projeto se comunica. O `rebase db branch create` faz a cópia e para por aí; nada é gravado no `.env`, e o próximo `rebase dev` continuará usando o banco de dados usado anteriormente. Para trabalhar na branch, mude para ela com `rebase db branch switch <name>`, como mostrado acima. Para acessá-la a partir de qualquer ferramenta que não seja um comando `rebase`, sua string de conexão é a mesma que você já possui, apenas trocando o nome do banco de dados:

```bash
postgresql://user:pass@localhost:5432/rb_dev_sandbox
```

---

## Revisão e merge de uma branch

Uma branch é onde um agente, ou uma migração sobre a qual você tem dúvidas, pode alterar um banco de dados sem mexer no banco real. Antes que qualquer alteração chegue ao banco de dados a partir do qual a branch foi criada, você pode ver o que mudou e fazer o merge a partir do [Studio](/docs/studio/): abra **Branches** e escolha uma.

- **Schema & RLS policies** lista todas as tabelas, colunas, chaves primárias, restrições (unique, foreign key, check, exclusion), índices, gatilhos (triggers), políticas, tipos enum (com seus rótulos), views e funções que a branch adicionou, removeu ou alterou, em SQL, com a definição do pai ao lado da definição da branch.
- **Data changes** contabiliza, por tabela, as linhas que a branch inseriu, atualizou e excluiu, comparadas pela chave primária, e exibe até 100 delas por tabela (no máximo 1.000 quando você solicita mais) com as colunas que foram alteradas. Uma coluna com nome de credencial — `password_hash`, um `*_token`, qualquer coisa com `secret`, um `*_hash` — exibe `[redacted]` em vez de seu valor.

Revisar uma branch requer o escopo `database:write`, aquele que executa SQL como o proprietário do banco de dados: as amostras são linhas de ambos os bancos de dados, lidas fora da segurança em nível de linha (RLS). O escopo `database:read` lista branches, mas não lê suas linhas.

O mesmo diff pode ser obtido com `rebase db branch diff <name>` no terminal, `GET /api/admin/branches/<name>/diff` via HTTP, a ferramenta MCP `rebase_db_branch_diff` e `admin.diffBranch(name)` no código. As tabelas do próprio Rebase (sessões, histórico, registro de branches) são deixadas de fora.

### Qual lado alterou uma linha

O pai continua recebendo gravações enquanto a branch é trabalhada, portanto "os dois bancos de dados diferem" não é o mesmo que "a branch alterou": uma linha inserida pelo pai depois que a branch foi criada se parece exatamente com uma linha que a branch excluiu. O Rebase as diferencia pelo momento em que cada linha foi gravada. Os IDs de transação pertencem ao servidor, não a um banco de dados específico, e a cópia de template os preserva; assim, uma linha gravada após a criação da branch — em qualquer um dos lados — é mais recente do que a transação que criou o banco de dados da branch. Essa transação é lida no momento em que a branch é criada e mantida em seu registro, de modo que um `GRANT` ou `ALTER DATABASE` posterior no banco de dados da branch não a altere.

| Linha da branch | Linha do pai | Contabilizada como |
| --- | --- | --- |
| gravada após a bifurcação | ausente | inserida pela branch |
| ausente | anterior à bifurcação | excluída pela branch |
| gravada após a bifurcação | anterior à bifurcação | atualizada pela branch |
| anterior à bifurcação, ou ausente | gravada após a bifurcação, ou ausente | alteração do pai: mantida |
| gravada após a bifurcação | gravada após a bifurcação | um **conflito** |

Dois casos se parecem e são interpretados de forma a não perder nada: uma linha que a branch excluiu e o pai alterou em seguida é mantida, e uma linha que o pai excluiu e a branch alterou em seguida é tratada como inserção da branch. Um `UPDATE` que grava os mesmos valores que uma linha já possuía ainda conta como uma gravação.

Uma branch criada antes de o Rebase registrar essa transação a lê da linha correspondente em `pg_database` do banco de dados da branch como está agora; qualquer coisa que tenha reescrito a linha desde então a desloca. Quando o ponto de bifurcação (fork) não puder ser lido de forma alguma — uma branch de longa duração cuja linha foi congelada por um vacuum —, o diff informa isso e considera todas as diferenças como sendo da branch.

### O que um merge faz

**O Merge** grava as linhas que a branch inseriu, atualizou e excluiu no pai. O que prevalece:

- **Linhas alteradas apenas pela branch** são gravadas: inseridas, sobrescritas ou excluídas.
- **Linhas alteradas apenas pelo pai** desde que a branch foi criada são mantidas exatamente como estão — a menos que uma delas referencie uma linha que a branch excluiu, o que é um conflito (abaixo).
- **Linhas que ambos alteraram** são conflitos. Por padrão, o merge não grava absolutamente nada; escolha `onConflict: "branch"` para gravar a linha da branch sobre a do pai, ou `"target"` para manter a do pai.
- **Uma linha que a branch excluiu e que linhas mais recentes do pai ainda referenciam** também é um conflito. Suponha que a branch tenha excluído um autor e o pai tenha, desde então, gravado um post dele: excluir o autor no pai causaria um efeito cascata nesse post, tornaria sua coluna nula ou falharia devido à chave estrangeira. O diff contabiliza o autor como um conflito e indica as linhas que o referenciam (`referencedBy`: a tabela, a chave estrangeira, seu `ON DELETE` e quantas linhas). Por padrão, o merge recusa a operação, informando a tabela, as linhas e a solução; `"target"` mantém o autor e, com ele, o post; `"branch"` exclui o autor, deixa a chave estrangeira agir conforme configurada e lista o que foi afetado em `warnings`.
- **Alterações de esquema e de políticas nunca sofrem merge.** Elas pertencem às definições das suas tabelas e às suas migrações: aplique-as com `rebase db push` (ou `migrate`) e, em seguida, faça o merge das linhas.

Uma tabela cujas linhas não podem ser combinadas bloqueia o merge: uma tabela que a branch adicionou ou removeu, uma cujas colunas ou chave primária diferem entre os dois, uma sem chave primária ou uma com mais de 100.000 linhas em um dos lados. Suas contagens indicam 0, pois não se sabe quais linhas foram alteradas; `rowCounts` fornece a contagem de linhas de cada lado. Uma tabela desse tipo que apenas o pai alterou — a branch não gravou nenhuma de suas linhas, e as anteriores à bifurcação são idênticas — não é bloqueada. Passe `skipBlocked` (no Studio, marque **Merge the other tables**) para fazer o merge das demais e ignorar essas.

Uma tabela reescrita desde a criação da branch também é bloqueada (`TABLE_REWRITTEN`). Uma alteração de tipo de coluna, um `ADD COLUMN` com valor padrão volátil, `VACUUM FULL` ou `CLUSTER` regrava todas as linhas novamente, de modo que cada linha é identificada como gravada após a bifurcação e já não é possível distinguir qual lado alterou o quê. Quando a branch alterar o tipo de uma coluna, faça o merge de suas linhas antes de aplicar essa alteração ao pai, ou recrie a branch depois de aplicá-la.

Cada gravação ocorre em uma única instrução no pai — tudo ou nada, com as chaves estrangeiras validadas ao final. Um merge carrega o `fingerprint` do diff que você revisou e não grava nada se qualquer um dos bancos de dados tiver sido alterado desde então: recarregue o diff e revise novamente. As sequências (sequences) são avançadas além de quaisquer IDs inseridos pelo merge.

```typescript
const diff = await admin.diffBranch("agent_run_17");
// …review diff.schema and diff.data…
const result = await admin.mergeBranch("agent_run_17", {
    expectedFingerprint: diff.fingerprint,
    onConflict: "abort" // or "branch", or "target"
});
```

O merge deliberadamente não é uma ferramenta MCP: um agente propõe alterações em sua branch, e uma pessoa faz o merge.

---

## O branching requer um servidor PostgreSQL real

O branching **não** funciona com o banco de dados de desenvolvimento gerenciado — o banco PGlite com configuração zero que o `rebase dev` inicia quando um projeto não possui `DATABASE_URL`.

O PGlite serve exatamente um único banco de dados. Executar `CREATE DATABASE ... TEMPLATE` nele grava uma entrada no catálogo e não copia nada, de forma que a "branch" resolve para o banco de dados a partir do qual foi clonada: gravações que você acredita estarem isoladas acabam no seu banco de dados de desenvolvimento, e não há uma segunda cópia para a qual retornar.

Use o branching com um servidor real — seu próprio PostgreSQL via `DATABASE_URL` ou `rebase dev --docker`, o qual os comandos de branch passarão a seguir.

---

## Melhores Práticas e Limitações

### Uso de Disco
Como o PostgreSQL duplica os arquivos em disco, cada branch consome um espaço igual ao do banco de dados de origem. Se você tiver um banco de dados de produção de 100 GB, criar 5 branches consumirá 500 GB adicionais de armazenamento. 
* *Recomendação*: Use bancos de dados com subconjuntos de dados (subsetted) ou templates leves de desenvolvimento como fontes de clonagem, em vez de clones integrais de produção.

O comando `rebase db branch prune` é como você recupera o espaço:

```bash
rebase db branch prune                      # orphans only — always safe
rebase db branch prune --older-than 2w      # and anything older than two weeks
```

Nada expira a menos que você solicite: uma branch pode ser a única cópia do trabalho de uma tarde inteira, portanto, o `--older-than` é opcional e as idades são arredondadas para baixo, e o comando exibe seu plano e pede confirmação antes de remover qualquer coisa, a menos que você passe `--yes`.

O prune também encontra as duas formas pelas quais as branches divergem de seus metadados — uma entrada cujo banco de dados foi excluído com SQL comum (o que o `list` continuaria exibindo indefinidamente) e um banco de dados de branch cuja entrada nunca foi gravada (uma falha entre as duas instruções executadas pelo `create`). Os bancos de dados temporários `<db>_dev_diff` do Atlas são reportados em conjunto, mas removidos apenas com `--include-dev-diff`: eles não são branches e um deles pode pertencer a um `db push` em execução no momento.

### Compatibilidade com pgBouncer
Ao fazer o deploy atrás do pgBouncer ou de poolers de conexão, certifique-se de que o pooler suporte operações administrativas de banco de dados. A criação e exclusão de bancos de dados contornam os pools padrão em nível de transação e exigem conexões diretas com o servidor Postgres (usando privilégios elevados de usuário) por meio da configuração `adminConnectionString`.

### Consultas Entre Bancos de Dados (Cross-Database Queries)
Como as branches são bancos de dados PostgreSQL separados, você não pode realizar instruções `JOIN` em SQL cruzando os limites das branches. Todos os relacionamentos devem estar contidos no escopo do único banco de dados da branch ativa.


## Relacionado

- [Comandos de Banco de Dados](/docs/cli/database/#rebase-db-branch) — `rebase db branch` e suas flags
- [Geração de Esquema](/docs/cli/schema/) — como o esquema que uma branch copia é produzido
- [Ambiente e Configuração](/docs/getting-started/configuration/) — `DATABASE_URL` e a prioridade de uma branch alternada
