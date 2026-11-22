---
sourceHash: cd3015585fe4e355
title: Backups e restauração
sidebar_label: Backups
description: Crie, agende, liste e restaure backups de banco de dados com pg_dump — o que um backup contém, o arquivo de roles que o acompanha e a única coisa que ele não cobre, seus arquivos enviados.
---

## Visão geral

O Rebase faz backup de um banco de dados Postgres com `pg_dump` e o restaura com
`pg_restore`. Você pode fazer um backup manualmente, agendar um por meio de um cron job,
listar o que possui a partir da CLI ou do painel **Backups** do Studio, e restaurar
em um banco de dados novo sem tocar no banco ativo.

:::caution[Isto não faz backup dos seus arquivos]
Um backup contém o **banco de dados** e nada mais. Os arquivos enviados residem no seu
[backend de armazenamento](/docs/backend/storage/) — um bucket S3 ou GCS, ou o
diretório em `STORAGE_PATH` — e não no Postgres, portanto um banco de dados restaurado aponta apenas para os arquivos que aquele backend possui.
Faça backup do bucket (versionamento ou replicação) ou do diretório de uploads
separadamente, com um agendamento próprio.
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

O banco de dados é aquele que todos os outros [comandos `rebase db`](/docs/cli/database/)
resolvem, na mesma ordem: `--database-url`, `DATABASE_URL` no shell, a
[branch](/docs/backend/branching/) para a qual o checkout está apontado, `DATABASE_URL`
no `.env`, Postgres no Docker (`--docker`, ou o último `rebase dev --docker`),
e então o banco de dados de desenvolvimento gerenciado, que o `restore` recusa.

Um `--out` relativo, o padrão `./backups` e o caminho de dump fornecido para `rebase db restore`
são todos resolvidos em relação ao diretório de onde você executa o `rebase`, normalmente a raiz do projeto,
para que `rebase db backup` e `rebase db backups list` se encontrem no mesmo lugar. Um
`BACKUP_DESTINATION` relativo é resolvido em relação ao diretório do backend, de onde o
servidor também o lê. Todos os três comandos recusam qualquer opção não suportada
antes de executar qualquer ação, indicando aquela que você provavelmente pretendia usar. A senha é repassada
para `pg_dump`, `pg_dumpall` e `pg_restore` via `PGPASSWORD`, nunca em sua
linha de comando, para que nenhuma mensagem de erro ou lista de processos a exiba.

## O que é um backup

O `rebase db backup` executa o `pg_dump` no formato customizado (`-Fc`), que é compactado
e pode ser restaurado seletivamente. Os arquivos são nomeados como
`rebase-<db>-<YYYYMMDD>T<HHMMSS>Z.dump`; o timestamp UTC no nome é o que
a retenção e a listagem usam para ordenação.

| Opção | Descrição |
| --- | --- |
| `--out`, `-o` | Um caminho local ou uma URL `s3://bucket/prefix` / `gs://bucket/prefix`. O padrão é `$BACKUP_DESTINATION`, depois `./backups` no diretório a partir do qual você executa o `rebase`. |
| `--exclude-schema <s>` | Exclui um schema do dump (repetível). Um padrão que corresponda a `rebase` é recusado — veja abaixo. |
| `--no-owner` | Omite comandos de propriedade (ownership), para restaurar como uma role diferente. |
| `--enable-row-security` | Faz o dump como um sujeito admin em vez de falhar devido à segurança em nível de linha (row-level security). **Pode gerar um dump parcial** — veja [Segurança em nível de linha](#segurança-em-nível-de-linha-e-o-dump-silenciosamente-incompleto). |
| `--row-security-role <r>` | A role para leitura ao usar a flag acima. O padrão é `admin`. |

Um dump é validado antes que o comando informe sucesso: o `pg_restore --list`
deve ser capaz de ler todo o arquivo compactado.

Para destinos `s3://`, a CLI constrói seu cliente de armazenamento a partir das mesmas
variáveis `S3_*` que seu backend utiliza (`S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`,
`S3_REGION`, `S3_ENDPOINT`, `S3_FORCE_PATH_STYLE`).

### O arquivo de roles

Cada backup grava um segundo arquivo ao lado do dump:
`rebase-<db>-<…>Z.globals.sql`, gerado por
`pg_dumpall --globals-only --no-role-passwords`. Um `pg_dump` específico de banco de dados
não pode incluir roles do cluster inteiro, e as concessões (grants) e políticas de segurança
em nível de linha do dump mencionam uma delas — `rebase_user`. Restaurado em um novo Postgres sem ela,
o primeiro `GRANT` para essa role falha e a restauração é interrompida.

Mantenha os dois arquivos juntos. A CLI faz o upload e os restaura como um par, um
backup agendado expurga ambos juntos, e o `rebase db restore` procura pelo `.globals.sql` no mesmo
diretório ou prefixo do `.dump`. As roles são recriadas **sem senhas**;
defina-as novamente após uma restauração em um novo cluster. O `PG_DUMPALL_PATH` aponta para um
binário `pg_dumpall` específico.

### O que está incluído

Todo o banco de dados, incluindo o schema `rebase`. Esse schema contém todas as
contas de usuário e o restante da autenticação, chaves de API, histórico de registros, a fila de jobs,
logs de cron e as funções que suas políticas RLS e triggers de captura de alterações
chamam. Um dump sem ele não contém usuários e não pode ser restaurado de forma alguma em um banco de
dados vazio: as tabelas que ele contém possuem políticas que chamam funções
que ele não possui.

Portanto, o `rebase db backup` recusa um `--exclude-schema` que corresponda a `rebase`, de acordo
com as próprias regras de padrão do pg_dump (incluindo `reb*` e `*`), antes de executar qualquer coisa.
Essas regras passam a sintaxe de expressão regular adiante fora de aspas duplas, então
`[r]ebase` e `audit|rebase` também são recusados, e o servidor é consultado sobre
cada padrão antes de o `pg_dump` ser executado, usando o mesmo mecanismo de expressão regular
que a própria consulta do `pg_dump` utiliza.

Como ele armazena todos os hashes de senha e chave, um dump local e seu `.globals.sql` são criados
com permissão de leitura exclusiva para o proprietário (0600), antes que o `pg_dump` escreva neles; os
arquivos locais de um backup agendado também são criados dessa forma.

## Backups agendados

Um backup agendado é um [cron job](/docs/backend/cron-jobs/) que faz o dump do
banco de dados, envia o resultado para `BACKUP_DESTINATION` e expurga backups antigos.
Coloque um arquivo em `backend/crons/` exportando um como default:

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

O controller de armazenamento é passado diretamente em vez de ser obtido a partir do contexto do job,
pois o `rebase.storage` do contexto é a API de armazenamento do lado do cliente, e não um
controller para o bucket de backup.

Um backup não está sujeito aos limites de upload do controller. `maxFileSize` (50 MB,
a menos que configurado) e `allowedMimeTypes` se aplicam ao que os usuários enviam, portanto, um dump de qualquer
tamanho pode ser enviado, inclusive aquele gravado por meio do controller que serve os
arquivos do seu aplicativo.

| Variável | Significado |
| --- | --- |
| `BACKUP_SCHEDULE` | Expressão cron, ex.: `0 3 * * *` para 03:00 diariamente. Não definir desativa os backups agendados. |
| `BACKUP_DESTINATION` | Um caminho local ou `s3://bucket/prefix` / `gs://bucket/prefix`. |
| `BACKUP_RETENTION_DAYS` | Exclui backups anteriores a este número de dias. Não definir ou usar `0` mantém tudo. |
| `BACKUP_KEEP_MINIMUM` | Sempre mantém pelo menos esse número de backups recentes, não importa a idade — para que uma interrupção prolongada não apague tudo. |

Cada novo dump é validado **antes** que qualquer coisa seja expurgada, de modo que um dump corrompido
nunca seja a causa da exclusão do seu último backup válido. A remoção atinge
apenas arquivos cujos nomes correspondam ao padrão de backup; qualquer outro item compartilhando o
bucket ou prefixo é mantido intacto.

O cron executa o `pg_dump` dentro do processo do servidor. A imagem de
runtime oficial (`rebasepro/server`, consulte [Auto-hospedagem](/docs/deployment/self-hosting/))
inclui as ferramentas de cliente do PostgreSQL 18 para isso.
Em qualquer outro lugar — uma VPS, sua própria imagem —
instale você mesmo as ferramentas de cliente (consulte a próxima seção).

## Compatibilidade de versões

O `pg_dump` e o `pg_restore` devem ser da **mesma versão major que o servidor ou
mais recente**. O `rebase db backup` e o `rebase db restore` verificam a versão major do cliente
em relação ao `server_version_num` do servidor ativo antes de fazer o dump ou restaurar, e
interrompem a operação indicando a solução caso sejam incompatíveis ou caso
o binário esteja ausente:

```
✗ Client tool is Postgres 15 but the server is Postgres 16. pg_dump/pg_restore
  must be the same major version as the server or newer. Install Postgres 16
  client tools.
```

Instale-os com `brew install libpq` ou `apt-get install postgresql-client-18`
(a partir do repositório apt do PostgreSQL, já que o próprio do Debian é mais antigo), ou aponte para um
binário específico com `PG_DUMP_PATH`, `PG_RESTORE_PATH` e `PG_DUMPALL_PATH`.
O `restore --clean` também executa o `psql`, que vem com eles; o `PSQL_PATH` indica
outro binário.

## Segurança em nível de linha e o dump silenciosamente incompleto

Em um Postgres gerenciado — Cloud SQL, RDS e afins — não há um superuser disponível,
portanto, a role com a qual você se conecta geralmente não é proprietária de nenhuma das suas tabelas e não
possui `BYPASSRLS`. A segurança em nível de linha se aplica a ela, e o `pg_dump` recusa a operação:

```
pg_dump: error: query failed: ERROR: query would be affected by row-level
security policy for table "company_leads"
```

Essa recusa é o comportamento seguro. Adicionar `--enable-row-security` ao `pg_dump`
manualmente é a opção perigosa: ela é bem-sucedida, sai com código 0, e o dump contém silenciosamente
apenas as linhas que as políticas da role que faz o dump permitem. Há duas saídas reais:

1. **Conceda à role de backup `BYPASSRLS`, ou torne-a proprietária das tabelas.** O
   dump então conterá todas as linhas.

   ```sql
   ALTER ROLE my_backup_role BYPASSRLS;
   ```

2. **`rebase db backup --enable-row-security`.** O Rebase define `app.uid` e
   `app.user_roles` para que a política gerada `admin_full_access` permita o
   dump, e exibe um aviso informando a troca feita: uma tabela cujas
   políticas não incluam nenhuma regra de admin sairá incompleta, e nada alertará sobre isso.

## Restauração

```bash
rebase db restore <backup> [--target-db <name>] [--create-db] [--clean] [--yes]
```

O `restore` executa o `pg_restore` e é destrutivo, por isso nunca é automático:
sem `--yes`, ele solicita uma confirmação interativa com `yes`, e em um shell
não interativo ele é interrompido e orienta a passar `--yes`. `<backup>` é um `.dump` local ou uma chave `s3://…` / `gs://…`,
baixada primeiro.

Ao restaurar em um banco de dados que já contém o que o backup cria, ele requer `--clean`: sem isso,
ele se recusa a executar antes de iniciar qualquer ação, listando os schemas e tabelas em conflito, e
informa para passar `--clean` ou restaurar em um novo banco de dados com
`--create-db --target-db <name>`. Ele recusa o
banco de dados de desenvolvimento gerenciado, que não aceita os dados de COPY de um dump; restaure
no Postgres em Docker com `--docker` em vez disso.

Com `--clean`, a restauração substitui o conteúdo mantido pelo backup em uma única transação. Ela remove por completo cada
schema que o backup cria (por exemplo, `rebase`) e cada tabela que o backup
cria em um schema que ele não recria por inteiro (`public`), com `CASCADE`, e em seguida restaura o
dump na mesma transação. Antes de pedir confirmação, ela lista o que será removido que o
backup não contém, como `rebase.atlas_schema_revisions` de
`rebase db migrate`, uma função, tipo ou sequência em um schema substituído, ou uma
view ou chave estrangeira em outro local que faça referência a uma das tabelas do backup. Uma restauração que falhe em qualquer ponto sofre rollback, e é informado que
o banco de dados mantém o estado que tinha antes. Ela executa o dump por meio do `psql`, que
vem acompanhado do `pg_restore` (`PSQL_PATH` aponta para outro), e aguarda no máximo
15 segundos por um lock, que uma instância em execução do `rebase dev` pode estar segurando.
O `--continue-on-error` ainda executa o próprio `--clean` do pg_restore.

Antes de restaurar, ela recria as roles do cluster a partir do `.globals.sql` do backup
— uma role existente é ignorada, sem gerar erro — para que as concessões (grants) e
políticas do dump sejam aplicadas. Em seguida, ela para no primeiro erro (`--exit-on-error`,
ou `ON_ERROR_STOP` com `--clean`): uma restauração que
registrasse um `GRANT` com falha e continuasse informaria sucesso com a segurança em
nível de linha não aplicada. Sem um `.globals.sql` ao lado do backup, ela avisa que
roles podem estar faltando.

| Opção | Descrição |
| --- | --- |
| `--target-db <name>` | Restaura neste banco de dados em vez daquele em `DATABASE_URL`. |
| `--create-db` | Cria o banco de dados de destino primeiro se ele não existir. |
| `--clean` | Substitui o que o backup contém, em uma única transação com a restauração: seus schemas por inteiro e suas tabelas em outros locais. Informa primeiro o que isso removerá além do backup. |
| `--no-owner` | Ignora a propriedade (ownership) registrada no dump. |
| `--continue-on-error` | Registra no log e continua após erros. **Pode deixar a RLS sem aplicação**; use apenas se souber o motivo. |
| `--yes`, `-y` | Ignora a confirmação. |

O procedimento seguro é restaurar ao lado do banco de dados ativo, verificá-lo e só
então migrar o aplicativo:

1. `rebase db restore <backup> --create-db --target-db app_restored`
2. Aponte um processo temporário (ou `psql`) para `app_restored` e verifique a contagem de linhas,
   um login e as tabelas com as quais você mais se importa.
3. Redirecione `DATABASE_URL` para ele, ou renomeie os bancos de dados, durante uma breve
   janela de manutenção.
4. Restaure seus arquivos enviados a partir do backup próprio deles, o mais próximo possível
   do mesmo ponto no tempo.

## O painel Backups

O painel **Backups** do Studio, no grupo *Database*, lista os backups em
`BACKUP_DESTINATION`, do mais novo para o mais antigo, com seu horário (e seu tamanho, para um
destino local). **Download**
baixa o dump; **Roles file** baixa seu `.globals.sql`. Baixe ambos e
mantenha-os em um único diretório. Um backup marcado como **No roles file** não possui o arquivo complementar:
recrie suas roles manualmente antes de restaurá-lo em um novo Postgres.

Acima da lista, o painel exibe o job de backup agendado e sua última execução. Uma execução com falha é exibida como um
erro com sua mensagem, de modo que um backup noturno que não possa ser executado fique visível onde
os backups são listados, e não apenas no painel Tarefas agendadas.

O que ele exibe sobre o job:

- **Last scheduled backup** é a última execução feita pelo agendamento. Uma execução iniciada
  manualmente desde então (**Run Now** em Tarefas agendadas) ganha uma linha própria, para que uma
  execução de teste bem-sucedida não oculte uma falha noturna, e uma que falhou não seja
  reportada como a noturna.
- Um job declarado como `enabled: false` é interpretado como backups agendados **desativados**.
  É isso que o arquivo de cron acima exporta enquanto `BACKUP_SCHEDULE` não estiver definido, e
  definir `BACKUP_SCHEDULE` os ativa. **Paused** significa que um admin pausou o
  job em Tarefas agendadas, e retomá-lo por lá o ativa novamente.
- Um job que o agendador recusou, por agendamento inválido, fuso horário ou timeout,
  é reportado com o motivo. Ele nunca é executado até que seu arquivo de cron seja corrigido.
- Quando o histórico de execução em `rebase.cron_logs` não puder ser lido, o painel informa
  isso, em vez de dizer que o backup ainda não foi executado.

A lista é lida pelo processo do servidor que responde a `GET /api/admin/backups`,
e esse nem sempre é o processo que executa o agendamento:

- Um destino `s3://` é listado e baixado por meio de um cliente para aquele
  bucket, configurado a partir das mesmas variáveis `S3_*` que o cron de backup usa. Um
  destino `gs://` usa Application Default Credentials. Forneça-as a **todos** os processos que
  atendem a `/api/admin`, incluindo a role `api` de uma
  [implantação dividida](/docs/deployment/split-processes/), não apenas àquele
  que executa o cron. Um destino que o processo não consiga ler responde `503`
  com o destino e o motivo, e o painel exibe isso em vez de uma lista vazia.
- Um caminho local é o disco do próprio processo. Quando o agendamento roda em outro
  processo (um `api` com `REBASE_CRON_SCHEDULER=false` ao lado de um `worker`), o
  painel informa que está listando o disco deste processo: os backups agendados aparecem
  lá apenas se ambos os processos montarem o mesmo diretório. Uma implantação dividida
  deve fazer backup no armazenamento de objetos.

Os downloads são transmitidos via stream por `GET /api/admin/backups/download?key=…`, restrito a admins,
para que o bucket nunca precise ser público; uma chave fora do prefixo do destino é
recusada. Com `BACKUP_DESTINATION` não definido, o painel informa que os backups não
estão configurados.

### Baixar um backup

Um navegador não pode incluir um header `Authorization` em um download, então o Studio e o SDK solicitam um
link primeiro. O endpoint `POST /api/admin/backups/download-url` com `{ "key": "…" }` (mesmo
escopo de admin e verificações de chave do download) responde com
`{ url, token, expiresIn }`: uma URL cujo token substitui o header, para
aquele backup específico no destino atual, durante 60 segundos. O token é
recusado em qualquer outro lugar — como sessão, como token de download de storage, para outro
backup — e assim que expirar. O navegador então faz o stream do dump diretamente para o
disco, de modo que um backup do tamanho do seu banco de dados nunca precise caber na memória de uma aba.

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

O `backups.download(key)` salva o arquivo no navegador e lança um erro em outros ambientes; use `stream(key)`
no Node. Ao interagir com um servidor sem links de download (versão anterior a 0.25, ou um
sem segredo JWT para assiná-los), o `download()` faz fallback para a leitura dos próprios bytes.

## Mantenha os backups privados

Um backup contém todos os seus dados, incluindo credenciais e dados pessoais.

- Nunca use um bucket público. Mantenha o acesso privado e monitore os logs.
- Ative a criptografia em repouso: criptografia do lado do servidor do S3,
  criptografia padrão do GCS ou criptografia de disco para um diretório local.
- Restrinja quem pode ler o local do backup e faça a rotação das credenciais.
- Dê preferência a um bucket dedicado, separado dos uploads de usuários.

## Recuperação point-in-time

Um backup feito com `pg_dump` restaura o estado referente ao momento em que o dump foi executado. Recuperar para qualquer
segundo intermediário requer arquivamento de WAL e base backups, o que a
distribuição open-source não executa para você. Se você precisar disso em auto-hospedagem, execute o `pgBackRest`
ou `wal-g` ao lado do seu Postgres e mantenha esses dumps como uma segunda cópia portátil.
