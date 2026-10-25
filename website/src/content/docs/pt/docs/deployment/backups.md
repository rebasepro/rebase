---
sourceHash: edbdf58fb055d26f
title: Backups e restauração
sidebar_label: Backups
description: Crie, agende, liste e restaure backups do banco de dados com pg_dump — o que um backup contém, o arquivo de roles que viaja com ele, e a única coisa que ele não cobre, seus arquivos enviados.
---

## Visão geral

O Rebase faz backup de um banco de dados Postgres com `pg_dump` e o restaura
com `pg_restore`. Você pode fazer um backup manualmente, agendar um com um
cron job, listar o que você tem a partir da CLI ou do painel **Backups** do
Studio, e restaurar em um banco de dados novo sem tocar no banco em produção.

:::caution[Isso não faz backup dos seus arquivos]
Um backup contém o **banco de dados** e nada mais. Arquivos enviados ficam no
seu [backend de armazenamento](/docs/backend/storage/) — um bucket S3 ou GCS,
ou o diretório em `STORAGE_PATH` — não no Postgres, então um banco de dados
restaurado aponta para arquivos que apenas aquele backend possui.
Faça backup do bucket (versionamento ou replicação) ou do diretório de
uploads separadamente, em sua própria programação.
:::

## Início rápido

```bash
# Back up to a local directory (custom format, compressed)
rebase db backup --out ./backups

# Back up straight to private object storage
rebase db backup --out s3://my-private-bucket/backups

# List what you have
rebase db backups list

# Restore into a FRESH database (does not touch the live one)
rebase db restore ./backups/rebase-app-20260714T030000Z.dump \
  --create-db --target-db app_restored
```

O banco de dados é o mesmo que todo outro [comando `rebase db`](/docs/cli/database/)
resolve, na mesma ordem: `--database-url`, `DATABASE_URL` no shell, a
[branch](/docs/backend/branching/) para a qual o checkout foi trocado, `DATABASE_URL`
no `.env`, o Postgres em Docker (`--docker`, ou o último `rebase dev --docker`) e,
por fim, o banco de dados de desenvolvimento gerenciado, que o `restore` recusa.

Um `--out` relativo,
o padrão `./backups` e um caminho de dump passado ao `rebase db restore` são todos
resolvidos a partir do diretório em que você executa o `rebase`, normalmente a raiz
do projeto, de modo que `rebase db backup` e `rebase db backups list` se encontram
no mesmo lugar. Um `BACKUP_DESTINATION` relativo é resolvido a partir do diretório
do backend, onde o servidor também o lê. Os três comandos recusam uma opção que não
aceitam antes de executar qualquer coisa, e nomeiam a que você provavelmente quis
dizer. A senha vai para o `pg_dump`, o `pg_dumpall` e o `pg_restore` em `PGPASSWORD`,
nunca na linha de comando deles, de modo que nenhuma mensagem de erro nem lista de
processos a mostra. Na 0.24 o padrão era `backend/backups`, uma opção com erro de
grafia era ignorada, e uma restauração que falhava imprimia a string de conexão com
a sua senha.

## O que é um backup

O `rebase db backup` executa o `pg_dump` em formato customizado (`-Fc`), que é
compactado e pode ser restaurado seletivamente. Os arquivos são nomeados
`rebase-<db>-<YYYYMMDD>T<HHMMSS>Z.dump`; o timestamp UTC no nome é o que a
retenção e a listagem usam para ordenar.

| Opção | Descrição |
| --- | --- |
| `--out`, `-o` | Um caminho local, ou uma URL `s3://bucket/prefix` / `gs://bucket/prefix`. O padrão é `$BACKUP_DESTINATION`, depois `./backups` no diretório em que você executa o `rebase`. |
| `--exclude-schema <s>` | Deixa de fora um schema do dump (repetível). Um padrão que corresponde a `rebase` é recusado — veja abaixo. |
| `--no-owner` | Omite comandos de ownership, para restaurar como uma role diferente. |
| `--enable-row-security` | Faz o dump como um subject admin em vez de falhar por row-level security. **Pode produzir um dump parcial** — veja [Row-level security](#row-level-security-e-o-dump-que-fica-incompleto-silenciosamente). |
| `--row-security-role <r>` | A role com a qual ler ao usar a flag acima. O padrão é `admin`. |

Um dump é validado antes de o comando reportar sucesso: o `pg_restore --list`
precisa conseguir ler o arquivo inteiro.

Para destinos `s3://`, a CLI monta seu cliente de armazenamento a partir das
mesmas variáveis `S3_*` que seu backend usa (`S3_ACCESS_KEY_ID`,
`S3_SECRET_ACCESS_KEY`, `S3_REGION`, `S3_ENDPOINT`, `S3_FORCE_PATH_STYLE`).

### O arquivo de roles

Todo backup grava um segundo arquivo ao lado do dump:
`rebase-<db>-<…>Z.globals.sql`, produzido pelo
`pg_dumpall --globals-only --no-role-passwords`. Um `pg_dump` por banco de
dados não pode incluir roles de todo o cluster, e os grants e as políticas de
row-level security do dump nomeiam uma — `rebase_user`. Restaurado em um
Postgres novo sem ela, o primeiro `GRANT` para essa role falha e a
restauração para.

Mantenha os dois arquivos juntos. A CLI faz upload e restaura
ambos como um par, um backup agendado os descarta como um só, e o `rebase db restore` procura o `.globals.sql` no mesmo
diretório ou prefixo do `.dump`. As roles são recriadas **sem senhas**;
defina-as novamente após uma restauração em um cluster novo. `PG_DUMPALL_PATH`
aponta para um binário específico do `pg_dumpall`.

### O que está nele

Todo o banco de dados, incluindo o schema `rebase`. Esse schema contém cada
conta de usuário e o restante da autenticação, chaves de API, histórico de
registros, a fila de jobs, logs de cron, e as funções que suas políticas de
RLS e os triggers de change-capture chamam. Um dump sem ele não tem usuários,
e não pode ser restaurado em um banco de dados vazio de forma alguma: as
tabelas que ele contém têm políticas que chamam funções que ele não tem.

Por isso o
`rebase db backup` recusa um `--exclude-schema` que corresponde a `rebase`, pelas
próprias regras de padrão do pg_dump (`reb*` e `*` incluídos), antes de executar qualquer coisa.
Essas regras repassam a sintaxe de expressão regular fora de aspas duplas, então
`[r]ebase` e `audit|rebase` também são recusados, e o servidor é consultado sobre
cada padrão antes de o `pg_dump` rodar, no mesmo mecanismo de expressões regulares que
a própria consulta do `pg_dump` usa.
Na 0.24 ele escrevia o dump e o validava, e só a restauração falhava.

Como contém todas as
senhas e hashes de chaves, um dump local e o seu `.globals.sql` são criados legíveis
apenas pelo seu dono (0600), antes de o `pg_dump` escrever neles; os arquivos locais de
um backup agendado também são. Na 0.24 eles são 0644.

## Backups agendados

Um backup agendado é um [cron job](/docs/backend/cron-jobs/) que faz o dump do
banco de dados, envia o resultado para `BACKUP_DESTINATION` e descarta backups
antigos. Coloque um arquivo em `backend/crons/` que exporte um por padrão:

```ts
// backend/crons/backup.ts
import { backupStorageFromEnv, type StorageController } from "@rebasepro/server";
import { createBackupCron, backupCronConfigFromEnv } from "@rebasepro/server-postgres";

const resolved = backupCronConfigFromEnv(process.env);
if (resolved.error) throw new Error(resolved.error);

function backupStorage(): StorageController | undefined {
    const destination = resolved.config?.destination;
    if (!destination || destination.kind === "local") return undefined; // local: written to disk directly
    // The same S3_* (or application-default GCS) client the CLI and the Backups panel build.
    return backupStorageFromEnv(destination, process.env);
}

// With BACKUP_SCHEDULE unset, export a disabled job so discovery still works.
export default resolved.config
    ? createBackupCron({ ...resolved.config, storage: backupStorage() })
    : createBackupCron({
        schedule: "0 3 * * *",
        connectionString: process.env.DATABASE_URL ?? "",
        destination: { kind: "local", path: "./backups" },
        enabled: false
    });
```

O controller de armazenamento é passado explicitamente em vez de ser obtido do
contexto do job, porque o `rebase.storage` do contexto é a API de storage do
lado do cliente, não um controller para o bucket de backup.

Um backup não está sujeito aos limites de upload do controller. `maxFileSize` (50 MB
a menos que definido) e `allowedMimeTypes` valem para o que os usuários enviam, então um dump de
qualquer tamanho é enviado, e o mesmo vale para um escrito por meio do controller que serve os
arquivos da sua aplicação.

| Variável | Significado |
| --- | --- |
| `BACKUP_SCHEDULE` | Expressão cron, por exemplo `0 3 * * *` para 03:00 diariamente. Não definida desativa os backups agendados. |
| `BACKUP_DESTINATION` | Um caminho local, ou `s3://bucket/prefix` / `gs://bucket/prefix`. |
| `BACKUP_RETENTION_DAYS` | Exclui backups mais antigos que esta quantidade de dias. Não definida ou `0` mantém tudo. |
| `BACKUP_KEEP_MINIMUM` | Sempre mantém pelo menos esta quantidade de backups recentes, independentemente da idade — assim uma interrupção longa não descarta tudo. |

Cada novo dump é validado **antes** de qualquer descarte, então um dump
corrompido nunca pode ser o motivo pelo qual seu último backup bom foi
excluído. O descarte toca apenas arquivos cujos nomes correspondem ao padrão
de backup; qualquer outra coisa que compartilhe o bucket ou o prefixo é
deixada intacta.

O cron executa o `pg_dump` dentro do processo do servidor. A imagem de
runtime oficial (`rebasepro/server`, veja [Auto-hospedagem](/docs/deployment/self-hosting/))
inclui as ferramentas de cliente do PostgreSQL 18 para isso;
na 0.23 e anteriores ela não tinha nenhuma, e toda execução agendada falhava
com `Could not find the 'pg_dump' binary`. Em qualquer outro lugar — um VPS,
sua própria imagem —, instale as ferramentas de cliente você mesmo (veja a
próxima seção).

## Compatibilidade de versões

O `pg_dump` e o `pg_restore` precisam ser da **mesma versão principal do
servidor, ou mais recentes**. `rebase db backup` e `rebase db restore` verificam a versão
principal do cliente contra o `server_version_num` do servidor em execução antes de
fazer o dump ou a restauração, e param com a solução caso não combinem, ou se o binário estiver ausente:

```
✗ Client tool is Postgres 15 but the server is Postgres 16. pg_dump/pg_restore
  must be the same major version as the server or newer. Install Postgres 16
  client tools.
```

Instale-as com `brew install libpq` ou `apt-get install postgresql-client-18`
(a partir do repositório apt do PostgreSQL, onde o da Debian é mais antigo),
ou apontando para um binário específico com `PG_DUMP_PATH`, `PG_RESTORE_PATH`
e `PG_DUMPALL_PATH`. O `restore --clean` também executa o `psql`, que vem junto com
eles; `PSQL_PATH` aponta para outro.

## Row-level security, e o dump que fica incompleto silenciosamente

Em um Postgres gerenciado — Cloud SQL, RDS e os demais — não há um superuser
para distribuir, então a role com a qual você se conecta geralmente não é
proprietária de nenhuma das suas tabelas e não tem `BYPASSRLS`. O row-level
security se aplica a ela, e o `pg_dump` se recusa:

```
pg_dump: error: query failed: ERROR: query would be affected by row-level
security policy for table "company_leads"
```

Essa recusa é o resultado seguro. Adicionar `--enable-row-security` ao
`pg_dump` manualmente é o caminho perigoso: ele é bem-sucedido, sai com código
0, e o dump silenciosamente contém apenas as linhas que as políticas da role
que fez o dump admitem. Duas saídas reais:

1. **Conceda à role que faz o dump o privilégio `BYPASSRLS`, ou torne-a
   proprietária das tabelas.** O dump então contém todas as linhas.

   ```sql
   ALTER ROLE my_backup_role BYPASSRLS;
   ```

2. **`rebase db backup --enable-row-security`.** O Rebase define `app.uid` e
   `app.user_roles` para que a política `admin_full_access` gerada admita o
   dump, e imprime um aviso dizendo o que você negociou: uma tabela cujas
   políticas não incluem uma regra de admin sai incompleta, e nada avisa
   sobre isso.

## Restauração

```bash
rebase db restore <backup> [--target-db <name>] [--create-db] [--clean] [--yes]
```

O `restore` executa o `pg_restore`, e é destrutivo, então nunca é automático:
sem `--yes` ele pede uma confirmação interativa `yes`, e em um shell não
interativo ele para e diz para passar `--yes`. `<backup>` é um `.dump` local ou uma chave `s3://…` /
`gs://…`, baixada primeiro.

Em um banco de dados
que já contém o que o backup cria, ele precisa de `--clean`: sem ele, o
comando recusa antes de qualquer execução, nomeando os schemas e as tabelas no caminho, e
diz para passar `--clean` ou restaurar em um banco de dados novo com
`--create-db --target-db <name>`. Na 0.24 ele recriava as roles e depois
parava com o `schema "rebase" already exists` do pg_restore. Ele recusa o
banco de dados de desenvolvimento gerenciado, que não consegue receber os dados de COPY
de um dump; restaure no Postgres em Docker com `--docker` em vez disso.

Com `--clean`,
a restauração substitui o que o backup contém em uma única transação. Ela remove por inteiro cada
schema que o backup cria (`rebase`, por exemplo), e cada tabela que o backup
cria em um schema que ele não cria (`public`), com `CASCADE`, e então restaura o
dump na mesma transação. Antes de perguntar, ela nomeia o que isso remove e que o
backup não contém, como a `rebase.atlas_schema_revisions` do
`rebase db migrate`, uma função, um tipo ou uma sequence em um schema substituído, ou uma view ou chave estrangeira em outro lugar que referencia uma das
tabelas do backup. Uma restauração que para em qualquer ponto sofre rollback, e ela diz
que o banco de dados contém o que continha antes. Ela executa o dump pelo `psql`, que
vem junto com o `pg_restore` (`PSQL_PATH` aponta para outro), e espera no máximo
15 segundos por um lock, que um `rebase dev` em execução pode estar segurando. Na 0.24, o `--clean`
era o do próprio pg_restore, uma instrução de cada vez: uma tabela que faltava no backup em
`rebase` o parava em `DROP SCHEMA rebase`, depois de todas as tabelas terem sido removidas.
O `--continue-on-error` ainda executa o `--clean` do próprio pg_restore.

Antes de restaurar, ele recria as roles do cluster a partir do
`.globals.sql` do backup — uma role já existente é ignorada, não é um erro —
para que os grants e as políticas do dump se apliquem. Em seguida, ele
para no primeiro erro (`--exit-on-error`,
ou `ON_ERROR_STOP` com `--clean`): uma restauração que registrasse um `GRANT`
falho e continuasse reportaria sucesso com o row-level security não aplicado.
Sem um `.globals.sql` ao lado do backup, ele avisa que roles podem estar
faltando.

| Opção | Descrição |
| --- | --- |
| `--target-db <name>` | Restaura neste banco de dados em vez do que está em `DATABASE_URL`. |
| `--create-db` | Cria o banco de dados de destino primeiro, se ele não existir. |
| `--clean` | Substitui o que o backup contém, em uma única transação com a restauração: os seus schemas por inteiro, e as suas tabelas em outros schemas. Diz antes o que isso remove além do backup. |
| `--no-owner` | Ignora o ownership registrado no dump. |
| `--continue-on-error` | Registra e continua após erros. **Pode deixar o RLS não aplicado**; use apenas quando souber o motivo. |
| `--yes`, `-y` | Pula a confirmação. |

O procedimento seguro é restaurar ao lado do banco de dados em produção,
verificá-lo, e só então mover a aplicação:

1. `rebase db restore <backup> --create-db --target-db app_restored`
2. Aponte um processo avulso (ou o `psql`) para `app_restored` e verifique
   contagens de linhas, um login e as tabelas que mais importam para você.
3. Reaponte o `DATABASE_URL` para ele, ou renomeie os bancos de dados, durante
   uma janela de manutenção curta.
4. Restaure seus arquivos enviados a partir de seu próprio backup, o mais
   próximo possível do mesmo ponto no tempo.

## O painel Backups

O painel **Backups** do Studio, no grupo *Database*, lista os backups em
`BACKUP_DESTINATION`, do mais recente para o mais antigo, com seu horário (e seu
tamanho, para um destino local). **Download** busca o dump; **Roles file** busca seu `.globals.sql`.
Baixe os dois e mantenha-os no mesmo diretório. Um backup marcado como **No
roles file** não tem o complemento: recrie suas roles manualmente antes de
restaurá-lo em um Postgres novo.

Acima da lista, o painel reporta o job de backup agendado e sua última execução. Uma execução
falha é exibida como um erro com sua mensagem, então um backup noturno que
não conseguiu rodar fica visível onde os backups são listados, não apenas no
painel Cron Jobs.

O que ele diz sobre o job:

- **Last scheduled backup** é a última execução feita pelo agendamento. Uma execução
  iniciada manualmente depois disso (**Run Now** em Cron Jobs) ganha uma linha própria,
  de modo que uma execução de teste que funcionou não esconde um backup noturno que
  falhou, e uma que falhou não é reportada como o backup noturno.
- Um job declarado com `enabled: false` aparece como backups agendados **desligados**.
  É isso que o arquivo de cron acima exporta enquanto `BACKUP_SCHEDULE` não está
  definida, e definir `BACKUP_SCHEDULE` os liga. **Em pausa** significa que um admin
  pausou o job em Cron Jobs, e retomá-lo ali os liga de novo.
- Um job que o agendador recusou, por um agendamento, fuso horário ou timeout
  inválido, é reportado com o motivo. Ele nunca é executado até que seu arquivo de
  cron seja corrigido.
- Quando o histórico de execuções em `rebase.cron_logs` não pode ser lido, o painel
  diz isso, em vez de dizer que o backup ainda não foi executado.

A lista é lida pelo processo do servidor que responde a `GET /api/admin/backups`,
e esse nem sempre é o processo que executa o agendamento:

- Um destino `s3://` é listado e baixado por meio de um cliente para esse
  bucket, montado a partir das mesmas variáveis `S3_*` que o cron de backup usa. Um
  `gs://` usa as credenciais padrão da aplicação. Forneça-as a **todo** processo que
  serve `/api/admin`, incluindo o papel `api` de uma
  [implantação dividida](/docs/deployment/split-processes/), e não apenas ao que
  executa o cron. Um destino que o processo não consegue ler responde `503` com o
  destino e o motivo, e o painel mostra isso em vez de uma lista vazia.
- Um caminho local é o disco do próprio processo. Quando o agendamento roda em outro
  processo (um `api` com `REBASE_CRON_SCHEDULER=false` ao lado de um `worker`), o
  painel diz que está listando o disco deste processo: os backups agendados só
  aparecem ali se os dois processos montarem o mesmo diretório. Uma implantação
  dividida deve fazer backup em armazenamento de objetos.

Os downloads passam por `GET /api/admin/backups/download?key=…`, somente para
admin, então o bucket nunca precisa ser público; uma chave fora do prefixo do
destino é recusada. Com `BACKUP_DESTINATION` não definida, o painel informa
que os backups não estão configurados.

### Baixar um backup

Um navegador não consegue
colocar um cabeçalho `Authorization` em um download, então o Studio e o SDK pedem um
link primeiro. `POST /api/admin/backups/download-url` com `{ "key": "…" }` (o mesmo
escopo de admin e as mesmas verificações de chave do download) responde
`{ url, token, expiresIn }`: uma URL cujo token faz as vezes do cabeçalho, para
aquele único backup no destino atual, por 60 segundos. O token é
recusado em qualquer outro lugar — como sessão, como token de download de storage, para outro
backup — e depois que expira. O navegador então transmite o dump direto para o
disco, de modo que um backup do tamanho do seu banco de dados nunca precisa caber em uma aba.

```ts
// In a browser: the browser saves the file.
await client.backups.download(key);

// Anywhere: a link that needs no header, for 60 seconds.
const { url } = await client.backups.downloadUrl(key);

// In Node: stream the bytes to a file.
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const { stream, name } = await client.backups.stream(key);
await pipeline(Readable.fromWeb(stream), createWriteStream(name));
```

Na 0.24 e anteriores, `backups.download(key)` respondia um `Blob` com o dump inteiro.
Agora ele salva o arquivo em um navegador e lança um erro em outros lugares; use `stream(key)`
no Node. Contra um servidor sem links de download (um anterior à 0.25, ou um
sem segredo JWT para assiná-los), `download()` recorre a ler os bytes
por conta própria.

## Mantenha os backups privados

Um backup contém todos os seus dados, incluindo credenciais e dados pessoais.

- Nunca use um bucket público. Mantenha seu acesso privado e registre-o em
  log.
- Ative a criptografia em repouso: criptografia do lado do servidor do S3,
  criptografia padrão do GCS, ou criptografia de disco para um diretório
  local.
- Restrinja quem pode ler o local do backup, e rotacione suas credenciais.
- Prefira um bucket próprio, separado dos uploads dos usuários.

## Recuperação para um ponto no tempo

Um backup de `pg_dump` restaura para o momento em que o dump foi executado.
Recuperar para qualquer segundo entre um e outro requer arquivamento de WAL e
backups base, o que a distribuição open-source não executa para você. Se você
precisar disso em auto-hospedagem, execute o `pgBackRest` ou o `wal-g` ao lado
do seu Postgres e mantenha estes dumps como uma segunda cópia portátil.
