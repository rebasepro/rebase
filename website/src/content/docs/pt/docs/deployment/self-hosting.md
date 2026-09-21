---
sourceHash: c5827fa03f8801fd
title: Auto-Hospedagem
sidebar_label: Auto-Hospedagem
description: Execute o Rebase em qualquer lugar com a imagem de runtime oficial e o bundle do seu projeto — Docker Compose, Fly, Railway ou uma VPS comum.
---

## Visão geral

Fazer a auto-hospedagem do Rebase significa executar duas coisas: um banco de dados Postgres e a imagem oficial `rebasepro/server` com o bundle do seu projeto montado nela.

Não há **nenhuma imagem de aplicação para construir**. Seu projeto viaja como um bundle, o runtime é publicado, e atualizar o Rebase é uma alteração de tag em vez de um rebuild. Consulte [Runtime e bundles](/docs/architecture/runtime-and-bundles/) para entender por que ele é dividido dessa forma.

## Docker Compose

**Se o seu projeto veio de `rebase init`, use o próprio `docker-compose.yml` dele.**
Ele está no seu repositório, o `init` preencheu seus segredos, sua primeira conta de administrador e sua versão fixada do runtime, e é o arquivo descrito em
[Implantação](/docs/getting-started/deployment/#docker-compose-recommended):

```bash
rebase build
docker compose up -d
```

O restante desta página trata da mesma implantação sem um scaffold por trás — o projeto de outra pessoa, um bundle gerado em CI, ou as duas coisas que o arquivo gerado deliberadamente omite: um pooler de conexões e os formatos de processos divididos. Esse arquivo reside no repositório, em
[`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml).
Use-o em vez de copiar um trecho desta página: ambos os arquivos são inicializados pelo próprio acceptance gate do projeto a cada push, portanto nenhum deles pode divergir do que realmente funciona.

Os dois concordam em todas as variáveis de ambiente, exceto na senha do banco de dados, e isso porque cada um foi escrito para o seu próprio gerador: este lê `POSTGRES_PASSWORD`, que o `quickstart.sh` gera; o gerado lê `DATABASE_PASSWORD`, que o `rebase init` também embute no `DATABASE_URL` gravado no seu `.env`.

```bash
rebase build                    # produces ./dist-bundle
./infra/docker/quickstart.sh    # writes infra/docker/.env if absent, then brings it up
```

`quickstart.sh` é um comando único que faz duas coisas óbvias e imprime ambas. A versão detalhada, caso prefira controlar cada etapa:

```bash
docker compose -f infra/docker/docker-compose.selfhost.yml \
  --env-file infra/docker/.env up
```

Você não precisa iniciar o banco de dados separadamente — o `api` aguarda pelo seu healthcheck.

### Os seis valores necessários

O `quickstart.sh` gera estes valores para você. Para escrever o `.env` você mesmo:

```bash
cat > infra/docker/.env <<EOF
POSTGRES_PASSWORD=$(openssl rand -hex 32)
JWT_SECRET=$(openssl rand -hex 32)
REBASE_SERVICE_KEY=$(openssl rand -hex 32)
CORS_ORIGINS=https://app.example.com
REBASE_ADMIN_EMAIL=you@example.com
REBASE_ADMIN_PASSWORD=$(openssl rand -hex 16)
EOF
```

Três segredos, um fato e a conta com a qual você faz login:

- **`POSTGRES_PASSWORD`** — a senha do banco de dados. Alterá-la mais tarde significa alterá-la também no volume, então escolha-a uma vez.
- **`JWT_SECRET`** — assina cada sessão. Rotacioná-lo desconecta todos os usuários.
- **`REBASE_SERVICE_KEY`** — a credencial que ignora o row-level security para chamadas servidor-para-servidor. Trate-o como uma senha de root: qualquer coisa de posse dele pode ler todas as linhas.
- **`CORS_ORIGINS`** — as origens a partir das quais seu frontend é servido, separadas por vírgula. Não é um segredo e não é opcional: o runtime se recusa a iniciar em produção sem ele em vez de tentar adivinhar, porque uma API que adivinha suas origens permitidas eventualmente permite a origem errada.
- **`REBASE_ADMIN_EMAIL`** / **`REBASE_ADMIN_PASSWORD`** — o primeiro administrador. Um banco de dados novo não tem usuários e, fora de produção, a política de registro aceita o primeiro cadastro e o promove a administrador — caso contrário, um banco de dados vazio seria um beco sem saída, já que inicializar um admin requer um chamador que já esteja autenticado. No momento em que este stack responde em um hostname, essa conveniência torna-se uma corrida que o operador pode perder; portanto, em produção essa janela é fechada e a conta é especificada aqui. O runtime a cria uma vez, enquanto a tabela de usuários estiver vazia, e não faz nada em todas as inicializações subsequentes.

Cada um dos três segredos deve ter pelo menos 32 caracteres, e a senha de administrador pelo menos 12. Use um endereço com um ponto no domínio: `POST /auth/login` valida o corpo com `z.string().email()`, portanto `admin@localhost` criaria a conta inicial e depois recusaria qualquer tentativa de usá-la. O arquivo compose declara todos os seis com `${VAR:?…}`, portanto a ausência de um deles interrompe a stack com uma mensagem indicando-o em vez de iniciar algo parcialmente configurado — e o auto-registro vem desativado (`DISABLE_SELF_REGISTRATION`, padrão `true`), para que nada fique desprotegido.

Faça login com essas credenciais e altere a senha: elas estão gravadas em um arquivo no host.

## Dependências

O `rebase build` **instala as dependências do seu projeto dentro do bundle** por padrão, de modo que o `dist-bundle` vem com um `node_modules` e um `package-lock.json` ao lado do seu `package.json`. Um bundle com dependências embutidas (vendored) inicia em cerca de cinco segundos.

Como elas já estão lá, você pode montar o bundle como somente leitura (read-only) — algo que vale a pena fazer, pois um hook comprometido não poderá reescrever o código executado após o próximo reinício:

```yaml
    volumes:
      - ./dist-bundle:/bundle:ro
```

`rebase build --no-vendor` desativa isso e produz um bundle que instala suas dependências na primeira inicialização, o que leva de 40 a 60 segundos por inicialização e exige que a montagem seja gravável.

Para uma implantação real, prefira embutir ambos em uma imagem, o que também fixa exatamente o que é executado:

```dockerfile
FROM rebasepro/server:0.22.0
COPY dist-bundle /bundle
```

## Criando o schema

**O runtime cria as tabelas ausentes na inicialização, incluindo as das suas collections.**
O padrão de `REBASE_MIGRATE_ON_BOOT` é `ensure`, que é aditivo em todo o schema: ele cria tabelas, colunas e tipos enum ausentes, e aplica o row-level security correspondente. Uma primeira inicialização contra um banco de dados vazio já sobe servindo suas collections, sem nenhuma etapa separada.

O que o `ensure` deliberadamente nunca faz é alterar algo que já existe. Ele não altera o tipo de uma coluna, não exclui uma tabela ou coluna e não edita os rótulos de um enum existente — porque o reinício de um contêiner não deve ser capaz de remodelar um schema como efeito colateral de um deploy.

Portanto, ainda vale a pena executar `rebase db push` para as duas coisas que o boot não toca:

```bash
rebase db push
```

- **RLS de tabelas de junção** para relações many-to-many.
- **Qualquer alteração que não seja puramente aditiva** — uma coluna renomeada, um tipo restringido, um campo removido.

Execute-o a partir de um checkout ou de um job de CI, apontado para o banco de dados da implantação. Ele simula a alteração primeiro (dry-run), recusa alterações destrutivas sem confirmação explícita e pode fazer um backup antes de aplicar. O banco de dados publica uma porta no arquivo compose para que isso possa alcançá-lo a partir do host; remova esse mapeamento assim que o schema estiver definido caso o banco de dados não deva ser acessível externamente.

`REBASE_MIGRATE_ON_BOOT` aceita `ensure` e `none`, e nada mais — a imagem **recusa-se a inicializar** com `push`, pelo motivo citado acima.

## Armazenamento de arquivos

O armazenamento fica **desativado** a menos que um bucket seja configurado, e isso é intencional: a alternativa padrão seria o sistema de arquivos do contêiner, que perderia silenciosamente todos os arquivos enviados no próximo reinício. Os uploads são recusados com `501 STORAGE_NOT_CONFIGURED` até que você configure um.

Para um bucket, defina `STORAGE_TYPE=s3` (ou `gcs`) juntamente com seu bucket e credenciais — o arquivo compose lista as variáveis, comentadas.

Para disco local, o que só é apropriado quando o caminho for um volume real que persista além do contêiner:

```yaml
      STORAGE_TYPE: local
      STORAGE_PATH: /data/uploads
      FORCE_LOCAL_STORAGE: "true"
    volumes:
      - uploads:/data/uploads
```

`FORCE_LOCAL_STORAGE` não é opcional nesse caso: em produção, um backend `local` é descartado em vez de registrado, porque a alternativa seriam uploads bem-sucedidos em um sistema de arquivos prestes a ser destruído. A variável é a forma de declarar que a montagem é durável.

### O armazenamento precisa de um modelo de controle de acesso

Assim que um bucket **estiver** configurado, o runtime **recusa-se a inicializar em produção** até que a implantação defina como os objetos são protegidos. O armazenamento não está sob row-level security e suas chaves compartilham um único namespace simples (flat); portanto, sem regras, a única coisa que separa os arquivos de dois usuários é a impossibilidade de adivinhar as chaves — o que `GET /storage/list?prefix=` invalida. Qualquer uma das opções a seguir satisfaz essa exigência:

- um **hook `storageAuthorize`** (ou `storagePolicies`) na configuração do seu projeto, que é a resposta real e o que o scaffold fornece em `config/storage.ts` — nenhuma variável de ambiente pode expressar "este usuário pode ler esta chave";
- **`STORAGE_PUBLIC_READ=true`**, para um bucket que realmente seja uma CDN pública somente leitura;
- **`STORAGE_ALLOW_ANY_AUTHENTICATED=true`**, para uma aplicação single-tenant onde qualquer conta autenticada tem permissão para acessar qualquer arquivo.

Fora de produção, a mesma condição gera um aviso visível em vez de uma recusa, portanto esta é uma falha de inicialização com a qual você se depara no deploy e não no ambiente local. Isso é deliberado: a falha que ela substitui é silenciosa.

Defina também `MFA_ENCRYPTION_KEY` se você usar TOTP. Se deixado indefinido, os segredos de autenticador armazenados serão criptografados com `JWT_SECRET` — assim, rotacioná-lo desconecta todos *e* torna indecriptável qualquer dispositivo cadastrado.

## Outras plataformas

O runtime é um contêiner comum escutando em `$PORT`, portanto qualquer coisa que execute contêineres funcionará. Duas coisas que você deve configurar corretamente em qualquer lugar:

1. O bundle deve estar presente em `/bundle` (ou onde `REBASE_BUNDLE` apontar), com suas dependências instaladas ao lado dele — veja [Dependências](#dependências).
2. Defina `CORS_ORIGINS`, `JWT_SECRET` e `DATABASE_URL`. O runtime se recusa a iniciar em produção sem eles em vez de tentar adivinhar.

### Fly.io

```toml
[build]
  image = "rebasepro/server:0.22.0"

[http_service]
  internal_port = 8080

[[http_service.checks]]
  path = "/livez"
```

Use o formato de imagem derivada acima para que o bundle seja enviado com a aplicação e, em seguida, execute `fly deploy`.

### Railway / Render

Aponte o serviço para a imagem derivada, defina as variáveis de ambiente e configure o caminho do health check para `/livez`.

### Uma VPS comum

```bash
npm install -g @rebasepro/server @rebasepro/server-postgres
rebase-server /srv/myapp/dist-bundle
```

O comando `rebase-server --help` lista as variáveis que ele lê. No systemd — as três linhas de admin são novas; na versão 0.17.3, a primeira conta a se registrar torna-se a administradora:

```ini title="/etc/systemd/system/rebase.service"
[Service]
ExecStart=/usr/bin/rebase-server /srv/myapp/dist-bundle
Restart=always
Environment=NODE_ENV=production
Environment=DATABASE_URL=postgresql://rebase:...@127.0.0.1:5432/rebase
Environment=JWT_SECRET=...
Environment=REBASE_SERVICE_KEY=...
Environment=CORS_ORIGINS=https://app.example.com
Environment=DISABLE_SELF_REGISTRATION=true
Environment=REBASE_ADMIN_EMAIL=you@example.com
Environment=REBASE_ADMIN_PASSWORD=...
```

`NODE_ENV=production` não é enfeite. Se não for definido, o processo será executado em modo de desenvolvimento: ele reflete origens localhost, serve a especificação OpenAPI e **deixa a janela do primeiro admin aberta** — de modo que o primeiro estranho a encontrar o formulário de cadastro torna-se o administrador. As duas linhas `REBASE_ADMIN_*` são o que substitui essa janela; veja [Seu primeiro admin](/docs/getting-started/deployment/#your-first-admin).

Prefira `EnvironmentFile=/etc/rebase.env` com o arquivo em modo 0600 em vez de linhas `Environment=` para os segredos: um unit file pode ser lido por qualquer usuário (world-readable), e `systemctl show` exibe todos os valores de `Environment=`.

## Pool de conexões

O runtime mantém um pool pequeno e de longa duração e não precisa de um pooler. O que precisa é todo o restante que se comunica com o mesmo banco de dados e não pode reter uma conexão: uma função serverless, um script agendado, uma ferramenta de BI, um worker de fila que escala para cinquenta instâncias. O `max_connections` do Postgres é um limite rígido na faixa das poucas centenas e cada conexão é um *processo*, de modo que um fan-out de lambdas o esgota muito antes de o banco de dados estar sobrecarregado.

O arquivo compose inclui um serviço `pgbouncer` para esse tráfego, protegido por um profile para que uma implantação sem esses chamadores não execute um processo desnecessário:

```bash
docker compose --profile pooler up -d
```

```
postgres://rebase:$POSTGRES_PASSWORD@your-host:6432/rebase
```

```bash
PGBOUNCER_PORT=6432           # host port
PGBOUNCER_MAX_CLIENT_CONN=500 # client connections accepted
PGBOUNCER_POOL_SIZE=20        # server connections used to serve them
```

A autenticação de clientes é gerada a partir de `DATABASE_URL` na inicialização, portanto a senha não é gravada duas vezes. O pooler autentica no Postgres com `scram-sha-256`, que o Postgres 18 armazena — o padrão `md5` da imagem falha no login do *servidor* com `FATAL: server login failed: wrong password type`, o que parece uma senha incorreta, mas não é.

Mantenha a soma de `PGBOUNCER_POOL_SIZE` em todos os poolers confortavelmente abaixo do `max_connections` do banco de dados — o runtime está consumindo da mesma cota.

### O que o pooling de transações muda

Um cliente sob pooling mantém uma conexão com o servidor pela duração de uma transação e depois a devolve, que é o que permite que 500 clientes compartilhem 20 conexões. Três coisas param de funcionar através dessa porta, e cada uma delas é algo que o próprio Rebase utiliza — exatamente por isso o runtime se conecta diretamente e esta porta é destinada a outros clientes:

- **`LISTEN`/`NOTIFY`.** O recurso Realtime foi construído sobre isso, e um listener precisa de uma conexão que dure mais do que uma transação. O `LISTEN` é *aceito* através do pooler — ele responde `LISTEN`, e nenhuma notificação jamais é entregue.
- **Estado de sessão**: `SET` (ao contrário de `SET LOCAL`), advisory locks mantidos entre declarações, cursores `WITH HOLD`, tabelas temporárias. A próxima transação pode cair em uma conexão de servidor diferente, que não verá nada disso. Ambos falham da mesma forma enganosa: com apenas um cliente ocioso o estado geralmente continua lá, funcionando durante os seus testes e deixando de funcionar sob a concorrência para a qual você introduziu o pooler.
- **Prepared statements em nível de protocolo.** A maioria dos drivers pode ser configurada para não usá-los — o node-postgres não os usa por padrão; o asyncpg precisa de `statement_cache_size=0`.

`SET LOCAL` tem escopo de transação e funciona, sendo o mecanismo usado para definir o row-level security — logo, o RLS se comporta de maneira idêntica através da porta com pool.

Deixe o profile desativado se nada fora do runtime se conectar ao seu banco de dados. Uma porta não utilizada é superfície de ataque.

## Verificações de integridade

| Caminho | Usar para |
| --- | --- |
| `/livez` | Liveness. Responde se "este processo está vivo" sem tocar no banco de dados. |
| `/health` | Readiness. Executa um round-trip no banco de dados e relata a latência. |

Aponte os probes de liveness para `/livez`. Um probe de liveness em `/health` reiniciaria um processo perfeitamente saudável durante uma breve oscilação do banco de dados, o que é o oposto do seu propósito.

## Métricas

```bash
REBASE_METRICS=true
REBASE_METRICS_TOKEN=<random string>
```

Expõe métricas do Prometheus em `/metrics`: contagem de requisições e histogramas de latência detalhados por superfície de API (data, auth, storage, functions) e collection, além de medidores (gauges) de processo. Sem um token, o endpoint fica legível para qualquer pessoa que alcance a porta; portanto, configure um, a menos que esteja em uma rede privada.

## Executando functions em seu próprio processo

Tudo o que foi visto acima consiste em um único contêiner servindo todo o projeto, que é o formato ideal para quase todas as implantações. Quando uma função customizada precisa parar de competir com a API de dados pelo event loop — ou deve escalar, reiniciar e falhar de forma independente —, a mesma imagem e o mesmo bundle podem ser inicializados como vários processos cooperantes. Consulte [Processos divididos](/docs/deployment/split-processes/).

## Atualizando

```yaml
image: rebasepro/server:0.22.0
```

Reinicie. Seu bundle permanece inalterado. Dentro da mesma versão major do contrato de runtime, um bundle que foi validado continuará funcionando — veja [Compatibilidade](/docs/architecture/runtime-and-bundles/#compatibility).
