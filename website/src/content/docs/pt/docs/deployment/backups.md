---
sourceHash: 6c9aa0d1c19006ba
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
# Backup para um diretório local (formato customizado, compactado)
rebase db backup --out ./backups

# Backup direto para armazenamento de objetos privado
rebase db backup --out s3://my-private-bucket/backups

# Listar o que você tem
rebase db backups list --out ./backups

# Restaurar em um banco de dados NOVO (não toca no banco em produção)
rebase db restore ./backups/rebase-app-20260714T030000Z.dump \
  --create-db --target-db app_restored
```

A string de conexão vem do ambiente do seu projeto, como em qualquer outro
[comando `rebase db`](/docs/cli/): `DATABASE_URL`, recorrendo a
`ADMIN_CONNECTION_STRING` como alternativa.

## O que é um backup

O `rebase db backup` executa o `pg_dump` em formato customizado (`-Fc`), que é
compactado e pode ser restaurado seletivamente. Os arquivos são nomeados
`rebase-<db>-<YYYYMMDD>T<HHMMSS>Z.dump`; o timestamp UTC no nome é o que a
retenção e a listagem usam para ordenar.

| Opção | Descrição |
| --- | --- |
| `--out`, `-o` | Um caminho local, ou uma URL `s3://bucket/prefix` / `gs://bucket/prefix`. O padrão é `$BACKUP_DESTINATION`, depois `./backups`. |
| `--exclude-schema <s>` | Deixa de fora um schema do dump (repetível). Nunca deixe de fora o `rebase` — veja abaixo. |
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

Mantenha os dois arquivos juntos. A CLI faz upload, lista, descarta e restaura
ambos como um par, e o `rebase db restore` procura o `.globals.sql` no mesmo
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

## Backups agendados

Um backup agendado é um [cron job](/docs/backend/cron-jobs/) que faz o dump do
banco de dados, envia o resultado para `BACKUP_DESTINATION` e descarta backups
antigos. Coloque um arquivo em `backend/crons/` que exporte um por padrão:

```ts
// backend/crons/backup.ts
import { GCSStorageController, S3StorageController, type StorageController } from "@rebasepro/server";
import { createBackupCron, backupCronConfigFromEnv } from "@rebasepro/server-postgres";

const resolved = backupCronConfigFromEnv(process.env);
if (resolved.error) throw new Error(resolved.error);

function backupStorage(): StorageController | undefined {
    const destination = resolved.config?.destination;
    if (destination?.kind === "gcs") {
        return new GCSStorageController({ type: "gcs", bucket: destination.bucket });
    }
    if (destination?.kind !== "s3") return undefined; // local: written to disk directly
    return new S3StorageController({
        type: "s3",
        bucket: destination.bucket,
        region: process.env.S3_REGION || "auto",
        accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
        endpoint: process.env.S3_ENDPOINT,
        forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true"
    });
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

O cron executa o `pg_dump` dentro do processo do servidor.
<span class="since-badge" data-since="0.24">Desde 0.24</span> a imagem de
runtime oficial (`rebasepro/server`, veja [Auto-hospedagem](/docs/deployment/self-hosting/))
inclui as ferramentas de cliente do PostgreSQL 18 para isso;
na 0.23 e anteriores ela não tinha nenhuma, e toda execução agendada falhava
com `Could not find the 'pg_dump' binary`. Em qualquer outro lugar — um VPS,
sua própria imagem —, instale as ferramentas de cliente você mesmo (veja a
próxima seção).

## Compatibilidade de versões

O `pg_dump` e o `pg_restore` precisam ser da **mesma versão principal do
servidor, ou mais recentes**. Todo comando verifica primeiro a versão
principal do cliente contra o `server_version_num` do servidor em execução e
para com a solução caso não combinem, ou se o binário estiver ausente:

```
✗ Client tool is Postgres 15 but the server is Postgres 16. pg_dump/pg_restore
  must be the same major version as the server or newer. Install Postgres 16
  client tools.
```

Instale-as com `brew install libpq` ou `apt-get install postgresql-client-18`
(a partir do repositório apt do PostgreSQL, onde o da Debian é mais antigo),
ou apontando para um binário específico com `PG_DUMP_PATH`, `PG_RESTORE_PATH`
e `PG_DUMPALL_PATH`.

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
interativo ele para. `<backup>` é um `.dump` local ou uma chave `s3://…` /
`gs://…`, baixada primeiro.

Antes de restaurar, ele recria as roles do cluster a partir do
`.globals.sql` do backup — uma role já existente é ignorada, não é um erro —
para que os grants e as políticas do dump se apliquem. Em seguida, ele
executa com `--exit-on-error`: uma restauração que registrasse um `GRANT`
falho e continuasse reportaria sucesso com o row-level security não aplicado.
Sem um `.globals.sql` ao lado do backup, ele avisa que roles podem estar
faltando.

| Opção | Descrição |
| --- | --- |
| `--target-db <name>` | Restaura neste banco de dados em vez do que está em `DATABASE_URL`. |
| `--create-db` | Cria o banco de dados de destino primeiro, se ele não existir. |
| `--clean` | Descarta os objetos existentes antes de recriá-los (`--clean --if-exists`). |
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
`BACKUP_DESTINATION`, do mais recente para o mais antigo, com seu tamanho e
horário. **Download** busca o dump; **Roles file** busca seu `.globals.sql`.
Baixe os dois e mantenha-os no mesmo diretório. Um backup marcado como **No
roles file** não tem o complemento: recrie suas roles manualmente antes de
restaurá-lo em um Postgres novo.

<span class="since-badge" data-since="0.24">Desde 0.24</span> acima da lista
ele reporta o job de backup agendado e sua última execução. Uma execução
falha é exibida como um erro com sua mensagem, então um backup noturno que
não conseguiu rodar fica visível onde os backups são listados, não apenas no
painel Cron Jobs.

<span class="since-badge" data-since="0.24">Desde 0.24</span> o que ele diz sobre o job:

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

<span class="since-badge" data-since="0.24">Desde 0.24</span> a lista é lida
pelo processo do servidor que responde a `GET /api/admin/backups`, e esse nem
sempre é o processo que executa o agendamento:

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
