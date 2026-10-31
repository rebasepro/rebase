---
sourceHash: caa4e79614f7401e
title: Auto-hospedagem
sidebar_label: Auto-hospedagem
description: Execute o Rebase em qualquer lugar com a imagem oficial do runtime e o bundle do seu projeto — Docker Compose, Fly, Railway ou uma VPS comum.
---

## Visão geral

Fazer a auto-hospedagem do Rebase significa executar duas coisas: um banco de dados Postgres e a imagem oficial `rebasepro/server` com o bundle do seu projeto montado nela.

Não há **nenhuma imagem de aplicação para construir**. Seu projeto é distribuído como um bundle, o runtime é publicado e atualizar o Rebase é apenas uma mudança de tag em vez de uma reconstrução. Consulte [Runtime and bundles](/docs/architecture/runtime-and-bundles/) para entender por que ele é dividido dessa forma.

## Docker Compose

**Se o seu projeto foi criado com `rebase init`, use o próprio `docker-compose.yml` dele.**
Ele está no seu repositório, o `init` preencheu seus segredos, sua primeira conta de administrador e sua versão fixada do runtime, e é o arquivo descrito em
[Deployment](/docs/getting-started/deployment/#docker-compose-recommended):

```bash
rebase build
docker compose up -d
```

O restante desta página aborda a mesma implantação sem um scaffold por trás — o projeto de outra pessoa, um bundle construído em CI ou as duas coisas que o arquivo gerado deliberadamente omite: um pooler de conexões e os formatos de processos divididos. Esse arquivo fica no repositório, em
[`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml).
Use-o em vez de copiar um trecho desta página: ambos os arquivos são inicializados pelo próprio gate de aceitação do projeto a cada push, portanto nenhum deles pode divergir do que realmente funciona.

Os dois coincidem em todas as variáveis de ambiente, exceto a senha do banco de dados, e isso ocorre porque cada um foi escrito para seu próprio gerador: este lê `POSTGRES_PASSWORD`, que o `quickstart.sh` gera; o gerado lê `DATABASE_PASSWORD`, que o `rebase init` também embute na `DATABASE_URL` gravada no seu `.env`.

```bash
rebase build                    # produces ./dist-bundle
./infra/docker/quickstart.sh    # writes infra/docker/.env if absent, then brings it up
```

O `quickstart.sh` é um comando único que faz duas coisas óbvias e exibe ambas. A forma estendida, caso prefira controlar cada etapa:

```bash
docker compose -f infra/docker/docker-compose.selfhost.yml \
  --env-file infra/docker/.env up
```

Você não precisa iniciar o banco de dados separadamente — a `api` aguarda pelo healthcheck dele.

### Os seis valores necessários

O `quickstart.sh` gera estes valores para você. Para escrever o `.env` manualmente:

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

- **`POSTGRES_PASSWORD`** — a senha do banco de dados. Alterá-la mais tarde significa alterá-la também no volume, portanto, defina-a de uma vez.
- **`JWT_SECRET`** — assina todas as sessões. Rotacioná-lo desconecta todos os usuários.
- **`REBASE_SERVICE_KEY`** — a credencial que ignora a segurança em nível de linha (RLS) para chamadas de servidor para servidor. Trate-a como uma senha de root: qualquer coisa em posse dela pode ler todas as linhas.
- **`CORS_ORIGINS`** — as origens a partir das quais seu frontend é servido, separadas por vírgula. Não é um segredo e não é opcional: o runtime se recusa a iniciar em produção sem ele em vez de tentar adivinhar, porque uma API que tenta adivinhar suas origens permitidas acaba permitindo a origem errada.
- **`REBASE_ADMIN_EMAIL`** / **`REBASE_ADMIN_PASSWORD`** — o primeiro administrador. Um banco de dados novo não tem usuários e, fora de produção, a política de registro aceita o primeiro cadastro e o promove a administrador — caso contrário, um banco de dados vazio seria um beco sem saída, já que inicializar um admin requer um chamador já autenticado. No momento em que essa stack responde em um hostname público, essa conveniência se torna uma corrida que o operador pode perder; por isso, em produção, a janela é fechada e a conta é definida aqui. O runtime a cria uma única vez, enquanto a tabela de usuários estiver vazia, e não faz nada em todas as inicializações subsequentes.

`JWT_SECRET` e `REBASE_SERVICE_KEY` devem ter pelo menos 32 caracteres cada, e a senha do admin pelo menos 12. Use um endereço com um ponto no domínio: `POST /auth/login` valida o corpo com `z.string().email()`, portanto o runtime se recusa a criar `admin@localhost` — uma conta na qual ninguém conseguiria fazer login — e registra o motivo nos logs. O arquivo compose declara todas as seis variáveis com `${VAR:?…}`, de modo que a ausência de uma delas interrompe a stack com uma mensagem indicando qual está faltando em vez de iniciar algo configurado pela metade — e o autorregistro vem desativado por padrão (`DISABLE_SELF_REGISTRATION`, padrão `true`), para que nada fique desprotegido.

Faça login com essas credenciais e altere a senha: elas estão expostas em um arquivo no host.

## Dependências

O `rebase build` **instala as dependências do seu projeto dentro do bundle** por padrão, de modo que o `dist-bundle` vem com `node_modules` e um `package-lock.json` ao lado do seu `package.json`. Um bundle empacotado (vendored) inicia em cerca de cinco segundos.

Como elas já estão lá, você pode montar o bundle como somente leitura — algo que vale a pena fazer, já que um hook comprometido não poderá reescrever o código executado após a próxima reinicialização:

```yaml
    volumes:
      - ./dist-bundle:/bundle:ro
```

`rebase build --no-vendor` desativa essa opção e gera um bundle que instala suas dependências na primeira inicialização, o que leva de 40 a 60 segundos por inicialização e requer que o ponto de montagem tenha permissão de escrita.

Para uma implantação real, prefira embutir ambos em uma imagem, o que também fixa com precisão o que está sendo executado:

```dockerfile
FROM rebasepro/server:0.26.0
COPY dist-bundle /bundle
```

## Criando o schema

**O runtime cria as tabelas ausentes na inicialização, incluindo as das suas coleções.**
`REBASE_MIGRATE_ON_BOOT` tem como padrão `ensure`, que é aditivo em todo o schema: ele cria tabelas, colunas e tipos enum ausentes, e aplica suas políticas de segurança em nível de linha (RLS). A primeira inicialização em um banco de dados vazio já sobe servindo suas coleções, sem nenhuma etapa separada.

O que o `ensure` deliberadamente nunca faz é alterar algo que já existe. Ele não altera o tipo de uma coluna, não remove uma tabela ou coluna e não edita os rótulos de um enum existente — porque a reinicialização de um contêiner não deve ser capaz de remodelar um schema como efeito colateral de um deploy.

Portanto, ainda vale a pena executar o `rebase db push` para o que a inicialização não toca — qualquer alteração que não seja puramente aditiva: uma coluna renomeada, um tipo mais restrito, um campo removido.

```bash
rebase db push
```

Execute-o a partir de um checkout ou de um job de CI, apontando para o banco de dados da implantação. Ele executa uma simulação (dry-run) da alteração primeiro, recusa mudanças destrutivas sem confirmação explícita e pode fazer um backup antes de aplicar. O banco de dados publica uma porta no arquivo compose para que seja acessível pelo host; remova esse mapeamento assim que o schema estiver configurado caso o banco de dados não deva ser acessível externamente.

`REBASE_MIGRATE_ON_BOOT` aceita `ensure` e `none`, e nada mais — a imagem **se recusa a inicializar** com `push`, pelo motivo citado acima.

## Quando apenas o seu processo de mudanças pode alterar o banco de dados

`REBASE_MIGRATE_ON_BOOT=none` não mexe nas suas coleções. Mas não deixa o banco de dados intacto: as tabelas do próprio framework (auth, API keys, jobs, cron) ainda são criadas e mantidas atualizadas a cada inicialização. Quando o banco de dados só puder ser alterado por meio de um processo de mudanças revisado, defina `REBASE_PROVISION=false` em todos os processos que atendem requisições:

| Configuração | Tabelas e políticas de coleções | Tabelas do framework |
|---|---|---|
| padrão (`REBASE_MIGRATE_ON_BOOT=ensure`) | criadas e mantidas atualizadas na inicialização | criadas e mantidas atualizadas |
| `REBASE_MIGRATE_ON_BOOT=none` | intocadas | criadas e mantidas atualizadas |
| `REBASE_PROVISION=false` | intocadas | intocadas; o que estiver faltando é listado no log |

Com o provisionamento desativado, o runtime não cria nem altera nada: nenhuma tabela, coluna, índice, função, trigger, política, role ou permissão (grant). Isso se aplica na inicialização e posteriormente, incluindo as tabelas que um processo servidor criaria no primeiro uso (chaves de idempotência, claims de cron, contadores compartilhados de rate limit). Em vez disso, ele lê o que já existe:

- **Tabelas de autenticação, ou uma coluna lida pela autenticação, ausentes:** a inicialização é recusada e lista cada uma delas.
- **A role da requisição tem acesso a uma tabela do framework**, como `rebase.refresh_tokens` ou `rebase.api_keys`: a inicialização é recusada e exibe o comando `REVOKE` a ser executado. Uma inicialização com provisionamento remove esses privilégios por conta própria. Com o provisionamento desativado, nada faz isso.
- **Uma tabela opcional ausente** (chaves de API, chaves de idempotência, claims de cron, contadores de rate limit, presence, histórico de métricas): essa funcionalidade é desativada, e o log informa qual tabela é necessária.

As linhas ainda mudam, como em qualquer banco de dados: logins, sessões, uso de chaves de API, chaves de idempotência, claims de cron. A primeira conta de administrador (`REBASE_ADMIN_EMAIL`) é populada pela execução de provisionamento, não pelos processos que atendem requisições. A [Edição de schema ao vivo](/docs/backend/live-schema-editing) ainda pode commitar uma alteração como código-fonte, mas se recusa a aplicá-la ao banco de dados.

### A execução de provisionamento

O schema vem de uma execução controlada pelo seu processo de mudanças. Use a mesma imagem e bundle do servidor, com `REBASE_PROVISION_ONLY=true`, conectado como uma role que tenha permissão de criação no banco de dados. `REBASE_PROVISION_SQL_OUT` salva todas as alterações de schema feitas pela execução em um script SQL:

```bash
docker run --rm \
  -e DATABASE_URL="postgres://admin:…@scratch-db:5432/app" \
  -e JWT_SECRET="…" \
  -e REBASE_PROVISION_ONLY=true \
  -e REBASE_PROVISION_SQL_OUT=/out/rebase.sql \
  -v "$PWD/out:/out" \
  -v "$PWD/dist-bundle:/bundle" \
  "rebasepro/server:$REBASE_VERSION"
```

O script é um registro, não um plano: cada instrução contida nele foi executada, em ordem, e foi bem-sucedida. Registrado contra um banco de dados vazio, ele representa todo o schema que o release precisa. Registrado contra uma cópia restaurada de produção, ele é exatamente a atualização. As linhas gravadas pela execução não estão nele. Revise-o e, em seguida, aplique-o ao banco de dados real:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f out/rebase.sql
```

Repita isso para cada atualização do Rebase, antes que os processos servidores sejam atualizados (rolling deploy). Uma nova versão pode adicionar uma tabela ou coluna, e um processo que não pode criá-la relatará sua ausência em vez de criá-la.

Um servidor construído por você mesmo segue a mesma regra: `initializeRebaseBackend` lê `REBASE_PROVISION`, e `createRebaseBackend` aceita [`provision: false`](/docs/backend/custom-server#what-creating-a-backend-may-change-provision).

## Armazenamento de arquivos

O armazenamento fica **desativado** a menos que um bucket esteja configurado, e isso é deliberado: o padrão alternativo seria o sistema de arquivos do contêiner, que perderia silenciosamente todos os arquivos enviados no próximo reinício. Os uploads são recusados com `501 STORAGE_NOT_CONFIGURED` até que você configure um.

Para um bucket, defina `STORAGE_TYPE=s3` (ou `gcs`) juntamente com seu bucket e credenciais — o arquivo compose lista as variáveis comentadas. O `gcs` carrega o pacote `@google-cloud/storage`, que a imagem oficial não inclui; portanto, nessa imagem, acesse o Google Cloud Storage por meio de seu endpoint compatível com S3 (`STORAGE_TYPE=s3`, `S3_ENDPOINT=https://storage.googleapis.com`, chaves HMAC).

Para disco local, o que só é apropriado quando o caminho é um volume real que persiste além do ciclo de vida do contêiner:

```yaml
      STORAGE_TYPE: local
      # Each declared bucket gets a directory beside this one, bucket("media")
      # /storage/uploads__media, so the volume goes on their parent.
      STORAGE_PATH: /storage/uploads
      FORCE_LOCAL_STORAGE: "true"
    volumes:
      - storage:/storage
```

`FORCE_LOCAL_STORAGE` não é opcional nesse caso: em produção, um backend `local` é descartado em vez de registrado, pois a alternativa seriam uploads bem-sucedidos em um sistema de arquivos prestes a ser destruído. A variável é a forma de indicar que a montagem é durável.

Monte o volume **acima** de `STORAGE_PATH`, e não diretamente nele. `STORAGE_PATH` é o diretório do bucket padrão, e cada bucket declarado em `config/resources.ts` recebe seu próprio diretório ao lado deste, `<STORAGE_PATH>__<key>`. Um volume montado exatamente em `STORAGE_PATH` conterá apenas o bucket padrão. Todos os outros buckets gravarão no sistema de arquivos do contêiner e perderão seus arquivos quando o contêiner for recriado. `STORAGE_PATH__MEDIA` pode mover um bucket para outro local no volume. Ele não pode movê-lo para dentro do diretório de outro bucket, como `/storage/uploads/media`, porque o bucket padrão listaria, serviria e excluiria seus arquivos.

A imagem cria `/storage` para o usuário sem privilégios `node` sob o qual ela é executada, e é por isso que o volume vai para lá. Um volume montado onde a imagem não possui diretório pertencerá ao root, e todo upload falhará com `EACCES`. O arquivo compose gerado pelo `rebase init` monta-o dessa maneira.

### O armazenamento precisa de um modelo de controle de acesso

Assim que um bucket **está** configurado, o runtime **se recusa a inicializar em produção** até que a implantação declare como os objetos são protegidos. O armazenamento não está sob a segurança em nível de linha (RLS) e suas chaves compartilham um namespace plano único; portanto, sem uma regra, a única coisa que separa os arquivos de dois usuários é a impossibilidade de adivinhar a chave — o que o `GET /storage/list?prefix=` anula. Qualquer uma das seguintes opções satisfaz essa exigência:

- um **hook `storageAuthorize`** (ou `storagePolicies`) na configuração do seu projeto, que é a resposta real e o que o scaffold fornece em `config/storage.ts` — nenhuma variável de ambiente consegue expressar "este usuário pode ler esta chave";
- **`STORAGE_PUBLIC_READ=true`**, para um bucket que é genuinamente uma CDN somente leitura pública;
- **`STORAGE_ALLOW_ANY_AUTHENTICATED=true`**, para uma aplicação single-tenant onde qualquer conta autenticada tem permissão de acesso a todos os arquivos.

Fora de produção, a mesma condição gera um aviso visível em vez de uma recusa; portanto, essa é uma falha de inicialização que você encontrará no deploy e não no ambiente local. Isso é deliberado: a falha que ela substitui é silenciosa.

Defina também `MFA_ENCRYPTION_KEY` se você usa TOTP. Se deixado indefinido, os segredos de autenticador armazenados são criptografados com `JWT_SECRET` — portanto, rotacioná-lo desconecta todos os usuários *e* torna indecifrável qualquer dispositivo cadastrado.

## Outras plataformas

O runtime é um contêiner comum escutando na porta `$PORT`, portanto qualquer plataforma que execute contêineres funciona. Duas coisas para configurar corretamente em qualquer lugar:

1. O bundle deve estar presente em `/bundle` (ou onde `REBASE_BUNDLE` apontar), com suas dependências instaladas ao lado — veja [Dependências](#dependências).
2. Defina `CORS_ORIGINS`, `JWT_SECRET` e `DATABASE_URL`. O runtime se recusa a iniciar em produção sem eles em vez de tentar adivinhar.

### Fly.io

```toml
[build]
  dockerfile = "Dockerfile"   # FROM rebasepro/server:0.26.0 + COPY dist-bundle /bundle

[http_service]
  internal_port = 8080

[[http_service.checks]]
  path = "/livez"
```

Use o formato de imagem derivada acima para que o bundle seja entregue junto com a aplicação, depois execute `fly deploy`.

### Railway / Render

Aponte o serviço para a imagem derivada, defina as variáveis de ambiente e configure o caminho do health check para `/livez`.

### Uma VPS comum

```bash
npm install -g @rebasepro/server @rebasepro/server-postgres
rebase-server /srv/myapp/dist-bundle
```

O comando `rebase-server --help` lista as variáveis que ele lê. No systemd — as duas linhas `REBASE_ADMIN_*` exigem a versão 0.18 ou superior; na 0.17.3, a primeira conta a se registrar torna-se o administrador:

```ini title="/etc/systemd/system/rebase.service"
[Service]
ExecStart=/usr/bin/rebase-server /srv/myapp/dist-bundle
Restart=always
Environment=NODE_ENV=production
Environment=DATABASE_URL=postgresql://rebase:...@127.0.0.1:5432/rebase
Environment=ALLOW_LOCALHOST_IN_PRODUCTION=true
Environment=JWT_SECRET=...
Environment=REBASE_SERVICE_KEY=...
Environment=CORS_ORIGINS=https://app.example.com
Environment=DISABLE_SELF_REGISTRATION=true
Environment=REBASE_ADMIN_EMAIL=you@example.com
Environment=REBASE_ADMIN_PASSWORD=...
```

`NODE_ENV=production` não é enfeite. Se deixado indefinido, o processo roda em modo de desenvolvimento: ele reflete origens localhost, serve a especificação OpenAPI e **deixa a janela do primeiro admin aberta** — de modo que o primeiro estranho a encontrar o formulário de cadastro se torna o administrador. As duas linhas `REBASE_ADMIN_*` são o que substitui essa janela; veja [Seu primeiro admin](/docs/getting-started/deployment/#your-first-admin).

`ALLOW_LOCALHOST_IN_PRODUCTION=true` está presente porque o banco de dados está na mesma máquina. Em produção, o runtime recusa qualquer variável que aponte para localhost — em um contêiner, o loopback é o próprio contêiner, portanto esse endereço é sempre um erro — e essa linha informa que o endereço é intencional. Remova-a quando o banco de dados rodar em outro lugar.

Prefira `EnvironmentFile=/etc/rebase.env` com o arquivo em modo 0600 em vez de linhas `Environment=` para os segredos: um arquivo de unidade pode ser lido por qualquer usuário (`world-readable`), e o comando `systemctl show` exibe todos os valores de `Environment=`.

## Pool de conexões

O runtime mantém um pool pequeno e de longa duração e não precisa de um pooler. O que precisa é todo o restante que se comunica com o mesmo banco de dados e não pode manter uma conexão persistente: uma função serverless, um script agendado, uma ferramenta de BI, um worker de fila que escala para cinquenta instâncias. O `max_connections` do Postgres é um limite rígido na faixa de poucas centenas e cada conexão é um *processo*, de modo que uma explosão de lambdas (fan-out) esgota esse limite muito antes de o banco de dados estar sobrecarregado.

O arquivo compose inclui um serviço `pgbouncer` para esse tráfego, sob um profile para que uma implantação sem esses clientes não execute um processo desnecessário:

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

A autenticação do cliente é gerada a partir de `DATABASE_URL` na inicialização, portanto a senha não é escrita duas vezes. O pooler autentica no Postgres com `scram-sha-256`, que o Postgres 18 armazena — o padrão `md5` da imagem falha no login do *servidor* com `FATAL: server login failed: wrong password type`, o que parece uma senha incorreta, mas não é.

Mantenha a soma de `PGBOUNCER_POOL_SIZE` de todos os poolers confortavelmente abaixo do `max_connections` do banco de dados — o runtime consome do mesmo limite.

### O que o pool de transações muda

Um cliente com conexão em pool mantém uma conexão com o servidor pela duração de uma transação e depois a devolve, o que permite que 500 clientes compartilhem 20 conexões. Três recursos deixam de funcionar através dessa porta, e cada um deles é utilizado pelo próprio Rebase — exatamente por isso o runtime se conecta diretamente e essa porta é destinada a outros clientes:

- **`LISTEN`/`NOTIFY`.** O Realtime é construído sobre isso, e um ouvinte (listener) precisa de uma conexão que persista além de uma transação. O `LISTEN` é *aceito* através do pooler — ele responde a `LISTEN`, mas nenhuma notificação chega.
- **Estado de sessão**: `SET` (ao contrário de `SET LOCAL`), advisory locks mantidos entre instruções, cursores `WITH HOLD`, tabelas temporárias. A próxima transação pode cair em uma conexão de servidor diferente, que não verá nada disso. Ambos falham da mesma forma inconveniente: com apenas um cliente ocioso, o estado geralmente ainda está lá, funcionando durante os testes e parando de funcionar sob a concorrência para a qual você introduziu o pooler.
- **Prepared statements no nível do protocolo.** A maioria dos drivers pode ser configurada para não usá-los — o node-postgres não os usa por padrão; o asyncpg precisa de `statement_cache_size=0`.

`SET LOCAL` tem escopo de transação e funciona, sendo o mecanismo usado para definir a segurança em nível de linha — portanto, o RLS se comporta de forma idêntica através da porta do pool.

Mantenha o profile desativado se nada fora do runtime se conectar ao seu banco de dados. Uma porta não utilizada é superfície de ataque.

## Health checks

| Caminho | Finalidade |
| --- | --- |
| `/livez` | Liveness. Responde "este processo está vivo" sem tocar no banco de dados. |
| `/health` | Readiness. Realiza um round-trip no banco de dados e relata a latência. |

Aponte as sondas de liveness para `/livez`. Uma sonda de liveness em `/health` reinicia um processo perfeitamente saudável durante uma breve oscilação do banco de dados, o que é o oposto do seu propósito.

## Métricas

```bash
REBASE_METRICS=true
REBASE_METRICS_TOKEN=<random string>
```

Expõe métricas do Prometheus em `/metrics`: contagem de requisições e histogramas de latência detalhados por superfície de API (data, auth, storage, functions) e coleção, além de gauges do processo. Sem um token, o endpoint pode ser lido por qualquer pessoa que alcance a porta; portanto, configure um, a menos que esteja em uma rede privada.

`rebase_db_pool_wait_ms` é um histograma de quanto tempo cada consulta aguardou por uma conexão do pool do banco de dados, incluindo o tempo de abertura de uma conexão, rotulado pela chave da fonte de dados (`source="(default)"` em um projeto que não declara fontes de dados). Um pool saudável mantém esse valor próximo de zero. Uma cauda longa que cresce com o tráfego significa que as requisições estão formando fila para obter conexões — mais frequentemente retidas por callbacks de escrita que aguardam algo lento; consulte [A callback holds a connection](/docs/collections/context-data-api/#a-callback-holds-a-connection).

`rebase_realtime_*` relata os sockets abertos, canais e os frames enviados ao barramento de canais ou retidos por cada instância: consulte [Seeing what the bus does](/docs/backend/realtime-transports/#seeing-what-the-bus-does).

## Headers de segurança

Toda resposta inclui `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` e `Strict-Transport-Security: max-age=15552000` (180 dias). O header HSTS omite `includeSubDomains`: isso instruiria os navegadores a recusar HTTP simples em todos os subdomínios do seu domínio, incluindo aqueles com os quais este servidor não tem nenhuma relação, e o navegador mantém essa instrução pelo tempo indicado no header.
Defina `REBASE_HSTS_INCLUDE_SUBDOMAINS=true` quando todos os subdomínios forem exclusivamente HTTPS; até a versão 0.23 (inclusive), o header sempre incluía `includeSubDomains`.

`strict-origin-when-cross-origin` é o padrão dos próprios navegadores: uma requisição para outro site envia a sua origem e nunca o caminho ou query da página. Não é `no-referrer` porque verificações de origem precisam da origem — o botão de login do Google a compara com as origens JavaScript autorizadas do cliente OAuth, e sob `no-referrer` ele respondia "The given origin is not allowed for the given client ID" em qualquer aplicação, independentemente do que o cliente autorizava. Uma resposta que define sua própria política a mantém (a página de consentimento do MCP envia `no-referrer`); uma página que queira uma política mais restrita pode declará-la com `<meta name="referrer" content="no-referrer">`. `X-Frame-Options` funciona da mesma forma: `SAMEORIGIN`, a menos que a resposta defina o seu próprio valor, como a página de consentimento do MCP faz com `DENY`.

As aplicações estáticas — o painel do CMS e qualquer frontend servido pelo bundle — também incluem `Content-Security-Policy: frame-ancestors 'self'; object-src 'none'; base-uri 'self'`. Isso define quem pode renderizar a aplicação em frames, bloqueia plugins e fixa `<base>` na sua origem, sem restringir nada além disso, permitindo que scripts inline, workers e login de terceiros continuem funcionando. Uma resposta que define sua própria política a mantém. Para algo mais rigoroso, configure a política no proxy reverso à frente.

## Mais de uma instância

Um contêiner é o padrão e não precisa de mais nada. Antes que uma segunda réplica receba tráfego — ou que um deploy contínuo (rolling deploy) execute duas lado a lado —, consulte [Running more than one instance](/docs/deployment/multiple-instances/): limites de taxa (rate limits), canais de broadcast, arquivos locais, uploads retomáveis e cache de imagens são por processo até que uma configuração os compartilhe.

## Executando funções em seu próprio processo

Tudo acima consiste em um único contêiner atendendo a todo o projeto, o que é o formato ideal para quase todas as implantações. Quando uma função personalizada deve parar de competir com a API de dados pelo event loop — ou deve escalar, reiniciar e falhar de forma independente —, a mesma imagem e o mesmo bundle podem ser inicializados como vários processos cooperantes. Consulte [Split processes](/docs/deployment/split-processes/).

## Atualização

```yaml
image: rebasepro/server:0.26.0
```

Reinicie. Seu bundle permanece inalterado. Dentro de uma mesma versão major do contrato de runtime, um bundle validado continuará funcionando — consulte [Compatibility](/docs/architecture/runtime-and-bundles/#compatibility).
