---
sourceHash: 64dad399c92c2e1c
title: Auto-hospedagem
sidebar_label: Auto-hospedagem
description: Execute o Rebase em qualquer lugar com a imagem oficial de runtime e o bundle do seu projeto — Docker Compose, Fly, Railway ou uma VPS simples.
---

## Visão Geral

Auto-hospedar o Rebase significa executar duas coisas: um banco de dados Postgres e a
imagem oficial `rebasepro/server` com o bundle do seu projeto montado nela.

Não há **nenhuma imagem de aplicação para construir**. Seu projeto transita como um bundle,
o runtime é publicado e a atualização do Rebase é uma alteração de tag em vez de uma
reconstrução. Consulte [Runtime e bundles](/docs/architecture/runtime-and-bundles/) para
entender por que isso é dividido dessa forma.

## Docker Compose

**Se o seu projeto foi criado a partir de `rebase init`, use o próprio `docker-compose.yml` dele.**
Ele está no seu repositório, o `init` preencheu seus segredos, sua primeira conta de administrador
e a versão fixada do runtime, sendo este o arquivo que a seção de
[Implantação](/docs/getting-started/deployment/#docker-compose-recommended)
descreve:

```bash
rebase build
docker compose up -d
```

O restante desta página trata da mesma implantação sem uma estrutura inicial gerada por trás —
o projeto de outra pessoa, um bundle compilado em CI ou as duas coisas que o arquivo gerado
deliberadamente omite: um pooler de conexões e os formatos de processos divididos.
Esse arquivo reside no repositório, em
[`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml).
Use-o em vez de copiar um trecho desta página: ambos os arquivos são inicializados pelo
próprio portão de aceitação do projeto a cada push, portanto nenhum deles pode divergir do que
realmente funciona.

Os dois concordam em todas as variáveis de ambiente, exceto na senha do banco de dados, e
isso ocorre porque cada um foi escrito para o seu próprio gerador: este lê
`POSTGRES_PASSWORD`, que o `quickstart.sh` gera; o gerado lê
`DATABASE_PASSWORD`, que o `rebase init` também embute na `DATABASE_URL` que
grava no seu `.env`.

```bash
rebase build                    # produces ./dist-bundle
./infra/docker/quickstart.sh    # writes infra/docker/.env if absent, then brings it up
```

O `quickstart.sh` é um comando único que faz duas coisas óbvias e imprime ambas. A
forma longa, caso prefira gerenciar cada etapa manualmente:

```bash
docker compose -f infra/docker/docker-compose.selfhost.yml \
  --env-file infra/docker/.env up
```

Você não precisa iniciar o banco de dados separadamente — a `api` aguarda a sua
verificação de saúde (healthcheck).

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

Três segredos, uma definição e a conta com a qual você faz login:

- **`POSTGRES_PASSWORD`** — a senha do banco de dados. Alterá-la posteriormente significa
  alterá-la também no volume, portanto defina-a de uma vez.
- **`JWT_SECRET`** — assina cada sessão. Rotacioná-la desconecta todos os usuários.
- **`REBASE_SERVICE_KEY`** — a credencial que ignora a segurança em nível de linha (RLS) para
  chamadas de servidor para servidor. Trate-a como uma senha de root: qualquer entidade de posse dela pode
  ler todas as linhas.
- **`CORS_ORIGINS`** — as origens a partir das quais seu frontend é servido, separadas por vírgula.
  Não é um segredo e não é opcional: o runtime se recusa a iniciar em produção
  sem ela em vez de tentar adivinhar, pois uma API que adivinha suas origens
  permitidas eventualmente permitirá a errada.
- **`REBASE_ADMIN_EMAIL`** / **`REBASE_ADMIN_PASSWORD`** — o primeiro
  administrador. Um banco de dados novo não tem usuários e, fora de produção, a
  política de registro aceita o primeiro cadastro e o promove a administrador —
  caso contrário, um banco de dados vazio seria um beco sem saída, pois inicializar um admin
  exige um chamador que já esteja autenticado. No momento em que essa stack responde em um
  hostname, essa conveniência se torna uma corrida que o operador pode perder; portanto, em produção,
  a janela é fechada e a conta é definida aqui. O runtime a cria
  uma única vez, enquanto a tabela de usuários estiver vazia, e não faz nada em todas as inicializações
  subsequentes.

`JWT_SECRET` e `REBASE_SERVICE_KEY` devem ter cada um pelo menos 32 caracteres, e
a senha de admin, pelo menos 12. Use um endereço com ponto em seu domínio: `POST /auth/login` valida
seu corpo com `z.string().email()`, portanto o runtime se recusa a criar a conta
`admin@localhost` — uma conta na qual ninguém conseguiria entrar — e registra o
motivo em vez disso. O arquivo compose declara todos os seis com
`${VAR:?…}`, de modo que a ausência de um deles interrompe a stack com uma mensagem indicando-o
em vez de iniciar algo configurado pela metade — e o autorregistro vem desativado
(`DISABLE_SELF_REGISTRATION`, padrão `true`), para que nada fique desprotegido.

Faça login com essas credenciais e altere a senha: elas estão expostas em um
arquivo no host.

## Dependências

O comando `rebase build` **instala as dependências do seu projeto dentro do bundle** por
padrão, de modo que o `dist-bundle` já chega com `node_modules` e um `package-lock.json`
ao lado de seu `package.json`. Um bundle com dependências embutidas (vendored) inicia em cerca de cinco segundos.

Como elas já estão presentes, você pode montar o bundle como somente leitura — algo que vale
a pena fazer, já que um hook comprometido não poderá reescrever o código executado após o
próximo reinício:

```yaml
    volumes:
      - ./dist-bundle:/bundle:ro
```

O comando `rebase build --no-vendor` desativa isso e produz um bundle que instala suas
dependências na primeira inicialização, o que leva de 40 a 60 segundos por inicialização e
exige que o ponto de montagem tenha permissão de escrita.

Para uma implantação real, prefira empacotar ambos em uma imagem, o que também fixa com exatidão
o que é executado:

```dockerfile
FROM rebasepro/server:0.25.1
COPY dist-bundle /bundle
```

## Criando o schema

**O runtime cria tabelas ausentes na inicialização, incluindo as de suas coleções.**
`REBASE_MIGRATE_ON_BOOT` tem como padrão `ensure`, que é aditivo em todo o
schema: ele cria tabelas, colunas e tipos enum ausentes, e aplica sua
segurança em nível de linha. Uma primeira inicialização em um banco de dados vazio já sobe servindo
suas coleções, sem nenhuma etapa separada.

O que o `ensure` deliberadamente nunca faz é alterar algo que já existe. Ele
não altera o tipo de uma coluna, não remove tabelas ou colunas e não
edita os rótulos de um enum existente — pois o reinício de um contêiner não deve
ser capaz de remodelar um schema como efeito colateral de um deploy.

Portanto, `rebase db push` ainda vale a pena ser executado para o que a inicialização não mexe —
qualquer alteração que não seja puramente aditiva: uma coluna renomeada, um tipo restringido,
um campo removido.

```bash
rebase db push
```

Execute-o a partir de um checkout local ou de um job de CI, apontado para o banco de dados da implantação. Ele
executa previamente uma simulação (dry-run) da alteração, recusa mudanças destrutivas sem confirmação
explícita e pode gerar um backup antes de aplicar. O banco de dados expõe uma
porta no arquivo compose para que seja possível acessá-lo a partir do host; remova esse mapeamento
assim que o schema estiver configurado, caso o banco de dados não deva ser acessível externamente.

`REBASE_MIGRATE_ON_BOOT` aceita apenas `ensure` e `none` — a
imagem **recusa a inicialização** caso configurada com `push`, pelo motivo explicado acima.

## Quando só o seu processo de mudanças pode alterar o banco de dados

<span class="since-badge" data-since="0.26">A partir da versão 0.26</span>

`REBASE_MIGRATE_ON_BOOT=none` deixa suas coleções em paz. Não deixa o banco de dados em paz: as tabelas próprias do framework (auth, chaves de API, jobs, cron) continuam sendo criadas e mantidas atualizadas a cada boot. Quando o banco de dados só pode mudar por meio de um processo de mudanças revisado, defina `REBASE_PROVISION=false` em cada processo que serve:

| Configuração | Tabelas e políticas das coleções | Tabelas do framework |
|---|---|---|
| padrão (`REBASE_MIGRATE_ON_BOOT=ensure`) | criadas e mantidas atualizadas no boot | criadas e mantidas atualizadas |
| `REBASE_MIGRATE_ON_BOOT=none` | intactas | criadas e mantidas atualizadas |
| `REBASE_PROVISION=false` | intactas | intactas; o que faltar é nomeado no log |

Com o provisionamento desligado, o runtime não cria nem altera nada: nenhuma tabela, coluna, índice, função, trigger, política, role ou permissão. Isso vale no boot e depois, incluindo as tabelas que um processo que serve criaria no primeiro uso (chaves de idempotência, claims do cron, os contadores compartilhados de rate limit). Em vez disso, ele lê o que existe:

- **Faltam tabelas de auth, ou uma coluna que o auth lê:** o boot é recusado e cada uma é listada.
- **O role das requisições alcança uma tabela do framework** como `rebase.refresh_tokens` ou `rebase.api_keys`: o boot é recusado e imprime o `REVOKE` a executar. Um boot que provisiona retira esses privilégios sozinho. Com o provisionamento desligado, nada faz isso.
- **Falta uma tabela opcional** (chaves de API, chaves de idempotência, claims do cron, contadores de rate limit, presença, histórico de métricas): essa funcionalidade fica desligada, e o log diz qual tabela ela precisa.

As linhas continuam mudando, como em qualquer banco de dados: logins, sessões, uso de chaves de API, chaves de idempotência, claims do cron. A primeira conta de administrador (`REBASE_ADMIN_EMAIL`) é criada pela execução de provisionamento, não pelos processos que servem. A [edição de schema ao vivo](/docs/backend/live-schema-editing) ainda pode fazer commit de uma mudança como código-fonte, mas se recusa a aplicá-la ao banco de dados.

### A execução de provisionamento

<span class="since-badge" data-since="0.26">A partir da versão 0.26</span>

O schema vem de uma execução que o seu processo de mudanças controla. Use a mesma imagem e o mesmo bundle do servidor, com `REBASE_PROVISION_ONLY=true`, conectado como um role que pode criar no banco de dados. `REBASE_PROVISION_SQL_OUT` guarda cada mudança de schema que a execução fez, como um script SQL:

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

O script é um registro, não um plano: cada instrução nele foi executada, em ordem, e teve sucesso. Gravado contra um banco de dados vazio, é o schema inteiro de que a versão precisa. Gravado contra uma cópia restaurada da produção, é exatamente a atualização. As linhas que a execução escreveu não estão nele. Revise-o e depois aplique-o ao banco de dados real:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f out/rebase.sql
```

Faça isso de novo a cada atualização do Rebase, antes de implantar os processos que servem. Uma versão pode adicionar uma tabela ou uma coluna, e um processo que não pode criá-la a informa como ausente em vez de criá-la.

Um servidor que você mesmo constrói segue a mesma regra: `initializeRebaseBackend` lê `REBASE_PROVISION`, e `createRebaseBackend` aceita [`provision: false`](/docs/backend/custom-server#what-creating-a-backend-may-change-provision).

## Armazenamento de arquivos

O armazenamento fica **desativado** a menos que um bucket seja configurado, e isso é proposital: a
alternativa padrão seria o sistema de arquivos do contêiner, que perderia silenciosamente todos os
arquivos enviados no próximo reinício. Os uploads são recusados com
`501 STORAGE_NOT_CONFIGURED` até que você configure um.

Para usar um bucket, defina `STORAGE_TYPE=s3` (ou `gcs`) juntamente com seu bucket e credenciais —
o arquivo compose lista as variáveis comentadas. O `gcs` carrega
`@google-cloud/storage`, que a imagem oficial não inclui, então nessa imagem
acesse o Google Cloud Storage pelo seu endpoint compatível com S3
(`STORAGE_TYPE=s3`, `S3_ENDPOINT=https://storage.googleapis.com`, chaves HMAC).

Para disco local, o que só é apropriado quando o caminho for um volume real que
persista além da vida útil do contêiner:

```yaml
      STORAGE_TYPE: local
      # Each declared bucket gets a directory beside this one, bucket("media")
      # /storage/uploads__media, so the volume goes on their parent.
      STORAGE_PATH: /storage/uploads
      FORCE_LOCAL_STORAGE: "true"
    volumes:
      - storage:/storage
```

`FORCE_LOCAL_STORAGE` não é opcional nesse caso: em produção, um backend `local` é
descartado em vez de registrado, pois a alternativa seriam uploads bem-sucedidos
em um sistema de arquivos prestes a ser destruído. A variável é a forma de declarar que a montagem
é durável.

Monte o volume **acima** de `STORAGE_PATH`, e não diretamente nele. `STORAGE_PATH` é o
diretório do bucket padrão, e cada bucket declarado em `config/resources.ts`
ganha o seu próprio diretório ao lado, `<STORAGE_PATH>__<key>`. Um volume montado no próprio `STORAGE_PATH`
reterá apenas o bucket padrão. Todos os outros buckets gravarão no
sistema de arquivos do contêiner e perderão seus arquivos quando o contêiner for recriado.
`STORAGE_PATH__MEDIA` pode mover um bucket para outro local do volume. Ele não pode
movê-lo para dentro do diretório de outro bucket, como `/storage/uploads/media`,
pois o bucket padrão passaria a listar, servir e excluir seus arquivos.

A imagem cria
`/storage` para o usuário sem privilégios `node` sob o qual ela roda, razão pela qual o volume
deve apontar para lá. Um volume montado onde a imagem não possui diretório pertencerá ao root,
fazendo com que todo upload falhe com `EACCES`. O arquivo compose gerado por `rebase init`
o monta dessa forma.

### O armazenamento precisa de um modelo de controle de acesso

Assim que um bucket **está** configurado, o runtime **se recusa a iniciar em produção**
até que a implantação defina como os objetos são protegidos. O armazenamento não fica sob
a segurança em nível de linha (RLS) e suas chaves compartilham um único namespace simples; portanto, sem regras,
a única barreira separando os arquivos de dois usuários é a imprevisibilidade da chave — o que
`GET /storage/list?prefix=` quebra facilmente. Qualquer uma das opções a seguir atende a essa exigência:

- um **hook `storageAuthorize`** (ou `storagePolicies`) na configuração do seu projeto,
  que é a solução definitiva e o que o template inicial fornece em `config/storage.ts` —
  nenhuma variável de ambiente consegue expressar "este usuário pode ler esta chave";
- **`STORAGE_PUBLIC_READ=true`**, para um bucket que seja genuinamente uma CDN
  pública somente leitura;
- **`STORAGE_ALLOW_ANY_AUTHENTICATED=true`**, para uma aplicação single-tenant onde
  toda conta autenticada tem permissão de acesso a todos os arquivos.

Fora de produção, essa mesma condição gera um aviso visível em vez de uma recusa,
portanto essa falha de inicialização é algo com que você se depara no deploy e não no ambiente local.
Isso é intencional: a falha que ela substitui ocorreria de forma silenciosa.

Defina também `MFA_ENCRYPTION_KEY` caso utilize TOTP. Se não for definida, os segredos
armazenados dos autenticadores serão criptografados com `JWT_SECRET` — de modo que rotacioná-la desconectará todos os usuários
*e* tornará todos os dispositivos registrados indecifráveis.

## Outras plataformas

O runtime é um contêiner comum escutando na porta `$PORT`, portanto qualquer plataforma que execute
contêineres funcionará. Dois pontos que devem ser configurados corretamente em qualquer lugar:

1. O bundle deve estar presente em `/bundle` (ou onde quer que `REBASE_BUNDLE` aponte),
   com suas dependências instaladas ao lado — consulte [Dependências](#dependências).
2. Defina `CORS_ORIGINS`, `JWT_SECRET` e `DATABASE_URL`. O runtime se recusa a
   iniciar em produção sem essas variáveis em vez de tentar adivinhá-las.

### Fly.io

```toml
[build]
  dockerfile = "Dockerfile"   # FROM rebasepro/server:0.25.1 + COPY dist-bundle /bundle

[http_service]
  internal_port = 8080

[[http_service.checks]]
  path = "/livez"
```

Utilize o formato de imagem derivada demonstrado acima para que o bundle viaje junto com a aplicação e, em seguida, execute
`fly deploy`.

### Railway / Render

Aponte o serviço para a imagem derivada, defina as variáveis de ambiente e configure
o caminho de health check para `/livez`.

### VPS simples

```bash
npm install -g @rebasepro/server @rebasepro/server-postgres
rebase-server /srv/myapp/dist-bundle
```

O comando `rebase-server --help` lista as variáveis que ele lê. Sob o systemd — as
duas linhas `REBASE_ADMIN_*` exigem a versão 0.18 ou posterior e, na versão 0.17.3, a primeira conta a
se registrar torna-se administradora:

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

`NODE_ENV=production` não é apenas decorativo. Se omitido, o processo é executado em
modo de desenvolvimento: ele reflete origens de localhost, disponibiliza a especificação OpenAPI e
**deixa a janela do primeiro administrador aberta** — permitindo que o primeiro desconhecido que encontrar o
formulário de cadastro se torne o administrador. As duas linhas `REBASE_ADMIN_*` substituem
essa janela; consulte [Seu primeiro
administrador](/docs/getting-started/deployment/#your-first-admin).

`ALLOW_LOCALHOST_IN_PRODUCTION=true` está presente porque o banco de dados está na
mesma máquina. Em produção, o runtime recusa qualquer variável apontando para
localhost — em um contêiner, loopback refere-se ao próprio contêiner, logo esse endereço é
sempre um equívoco — e essa linha informa que o endereço é intencional. Remova-a quando o
banco de dados rodar em outro local.

Prefira usar `EnvironmentFile=/etc/rebase.env` com permissões em modo 0600 em vez de
linhas `Environment=` para os segredos: o arquivo de serviço (unit file) pode ser lido por qualquer usuário, e o
comando `systemctl show` exibe todos os valores de `Environment=`.

## Pool de conexões (Connection pooling)

O runtime mantém um pool pequeno e de longa duração, não necessitando de um pooler externo. O que realmente
precisa disso é qualquer outro serviço que se comunique com o mesmo banco de dados e não consiga manter conexões ativas:
uma serverless function, um script agendado, uma ferramenta de BI, um worker de fila que escala
para cinquenta instâncias. O `max_connections` do Postgres é um limite rígido na faixa de centenas baixas e
cada conexão é um *processo*, de modo que uma explosão de lambdas o esgota muito antes de
o banco de dados estar sobrecarregado.

O arquivo compose traz um serviço `pgbouncer` para esse tráfego, protegido por um profile
para que uma implantação sem esses consumidores não execute um processo desnecessário:

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

A autenticação dos clientes é gerada a partir de `DATABASE_URL` na inicialização, de modo que a
senha não é informada duas vezes. O pooler autentica-se no Postgres usando
`scram-sha-256`, suportado pelo Postgres 18 — o padrão `md5` da imagem falha no login do
*servidor* com `FATAL: server login failed: wrong password type`, o que
parece um erro de senha incorreta, mas não é.

Mantenha a soma de `PGBOUNCER_POOL_SIZE` entre todos os poolers confortavelmente abaixo do
`max_connections` do banco de dados — o runtime consome a partir dessa mesma cota.

### O que o pooling de transações muda

Um cliente em pool retém uma conexão de servidor pela duração de uma transação e
depois a devolve, o que permite que 500 clientes compartilhem 20 conexões. Três
recursos deixam de funcionar através dessa porta, e cada um deles é utilizado pelo próprio Rebase
— razão pela qual o runtime se conecta diretamente e esta porta é destinada a outros
consumidores:

- **`LISTEN`/`NOTIFY`.** O Realtime é construído sobre isso, e um listener precisa de uma
  conexão que dure mais do que uma transação. O `LISTEN` é *aceito* pelo
  pooler — ele responde ao `LISTEN`, mas nenhuma notificação chega.
- **Estado de sessão**: `SET` (ao contrário de `SET LOCAL`), advisory locks mantidos
  entre instruções, cursores `WITH HOLD`, tabelas temporárias. A próxima transação
  pode cair em uma conexão de servidor diferente, que não terá acesso a nada disso. Ambos
  falham de uma maneira pouco evidente: com apenas um cliente ocioso, o estado geralmente
  continua lá, funcionando durante os testes e quebrando sob
  a concorrência real para a qual você introduziu o pooler.
- **Prepared statements no nível de protocolo.** A maioria dos drivers pode ser configurada para não
  utilizá-los — o node-postgres não os usa por padrão; o asyncpg necessita de
  `statement_cache_size=0`.

`SET LOCAL` tem escopo restrito à transação e funciona normalmente, sendo usado para definir a
segurança em nível de linha (RLS) — portanto, o RLS se comporta de forma idêntica através da porta gerenciada pelo pool.

Deixe o profile desativado se nada fora do runtime se conectar ao seu banco de dados.
Uma porta não utilizada representa superfície de ataque.

## Verificações de saúde (Health checks)

| Caminho | Finalidade |
| --- | --- |
| `/livez` | Liveness. Responde se "este processo está vivo" sem tocar no banco de dados. |
| `/health` | Readiness. Executa um round-trip no banco de dados e informa a latência. |

Aponte as sondas de liveness para `/livez`. Uma sonda de liveness em `/health` reinicia um
processo perfeitamente saudável durante uma oscilação momentânea do banco de dados, o que é o oposto
do seu propósito.

## Métricas

```bash
REBASE_METRICS=true
REBASE_METRICS_TOKEN=<random string>
```

Expõe métricas do Prometheus em `/metrics`: contadores de requisições e histogramas de latência
detalhados por superfície de API (data, auth, storage, functions) e coleção, além de
indicadores de processo (gauges). Sem um token, o endpoint fica acessível para qualquer pessoa com acesso à
porta, portanto defina um a menos que esteja em uma rede privada.

`rebase_db_pool_wait_ms` é um histograma do tempo que cada consulta esperou por uma
conexão do pool do banco de dados, incluindo a abertura de uma nova conexão, rotulado pela chave da fonte
de dados (`source="(default)"` em projetos que não declaram fontes de dados adicionais). Um
pool saudável mantém esse valor próximo de zero. Uma cauda que
aumenta com o tráfego indica requisições enfileiradas aguardando conexões — frequentemente
retidas por callbacks de escrita que aguardam por operações lentas; consulte
[Um callback retém uma conexão](/docs/collections/context-data-api/#a-callback-holds-a-connection).

## Cabeçalhos de segurança

Todas as respostas incluem `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options:
nosniff`, uma `Referrer-Policy` e `Strict-Transport-Security: max-age=15552000`
(180 dias). O cabeçalho HSTS omite `includeSubDomains`: incluí-lo instruiria os
navegadores a recusarem HTTP simples em todos os subdomínios do seu domínio, inclusive naqueles com os quais
este servidor não tem relação, e o navegador reteria isso pelo período indicado no
cabeçalho.
Defina `REBASE_HSTS_INCLUDE_SUBDOMAINS=true` quando todos os subdomínios operarem exclusivamente em HTTPS;
até a versão 0.23 inclusive, o cabeçalho sempre incluía `includeSubDomains`.

As aplicações estáticas — o painel administrativo do CMS e qualquer frontend servido pelo bundle — também trazem
`Content-Security-Policy: frame-ancestors 'self'; object-src 'none'; base-uri
'self'`. Isso define quem pode renderizar a aplicação em frames, desativa plugins e fixa a tag `<base>`
na sua origem, sem restringir nada além disso, permitindo que scripts inline, workers e
logins de terceiros continuem funcionando. Respostas que definem sua própria política a mantêm.
Para qualquer regra mais restritiva, configure a política no reverse proxy à frente.

## Mais de uma instância

Um único contêiner é a configuração padrão e não exige configurações extras. Antes que uma segunda réplica
receba tráfego — ou que um deploy contínuo (rolling deploy) execute duas instâncias lado a lado — revise
[Executando mais de uma instância](/docs/deployment/multiple-instances/): rate
limits, canais de broadcast, arquivos locais, uploads retomáveis e cache de imagens
operam por processo até que uma configuração passe a compartilhá-los.

## Executando funções em seus próprios processos

Tudo o que foi abordado acima utiliza um contêiner atendendo a todo o projeto, que é o modelo
adequado para quase todas as implantações. Quando uma função customizada precisa parar de disputar o
event loop com a data API — ou precisa escalar, reiniciar e falhar de forma
independente — a mesma imagem e o mesmo bundle podem ser inicializados como múltiplos processos
cooperando entre si. Consulte [Processos divididos](/docs/deployment/split-processes/).

## Atualização

```yaml
image: rebasepro/server:0.25.1
```

Reinicie. O seu bundle permanece inalterado. Dentro da mesma versão principal (major) do contrato de runtime, um bundle devidamente
validado continua funcionando — consulte
[Compatibilidade](/docs/architecture/runtime-and-bundles/#compatibility).
