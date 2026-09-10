---
sourceHash: aa153f3ab4c80526
title: Auto-hospedagem
sidebar_label: Auto-hospedagem
description: Execute o Rebase em qualquer lugar com a imagem oficial de runtime e o bundle do seu projeto — Docker Compose, Fly, Railway ou uma VPS comum.
---

## Visão geral

Fazer a auto-hospedagem do Rebase significa executar duas coisas: um banco de dados Postgres e a imagem oficial `rebasepro/server` com o bundle do seu projeto montado nela.

Não há **nenhuma imagem de aplicação para compilar**. Seu projeto é distribuído como um bundle, o runtime é publicado, e atualizar o Rebase é uma simples mudança de tag em vez de uma recompilação. Consulte [Runtime e bundles](/docs/architecture/runtime-and-bundles/) para entender por que essa divisão é feita dessa forma.

## Docker Compose

**Se o seu projeto foi criado a partir de `rebase init`, use o próprio `docker-compose.yml` dele.**
Ele está no seu repositório, o `init` preencheu seus segredos, sua primeira conta de administrador e sua versão fixada do runtime, e é o arquivo descrito em
[Implantação](/docs/getting-started/deployment/#docker-compose-recommended):

```bash
rebase build
docker compose up -d
```

O restante desta página trata do mesmo deploy sem um scaffold por trás — o projeto de outra pessoa, um bundle gerado em CI, ou os dois elementos que o arquivo gerado deliberadamente omite: um pooler de conexões e os formatos de processos divididos. Esse arquivo reside no repositório, em
[`infra/docker/docker-compose.selfhost.yml`](https://github.com/rebasepro/rebase/blob/main/infra/docker/docker-compose.selfhost.yml).
Use-o em vez de copiar um trecho desta página: ambos os arquivos são inicializados pelo próprio teste de aceitação do projeto a cada push, portanto nenhum deles fica desatualizado em relação ao que realmente funciona.

Os dois concordam em todas as variáveis de ambiente, exceto na senha do banco de dados, e isso porque cada um foi escrito para o seu respectivo gerador: este lê `POSTGRES_PASSWORD`, gerado pelo `quickstart.sh`; o gerado lê `DATABASE_PASSWORD`, que o `rebase init` também insere na `DATABASE_URL` gravada no seu `.env`.

```bash
rebase build                    # produces ./dist-bundle
./infra/docker/quickstart.sh    # writes infra/docker/.env if absent, then brings it up
```

O `quickstart.sh` é um único comando que faz duas coisas óbvias e exibe ambas. A forma estendida, caso prefira controlar cada etapa:

```bash
docker compose -f infra/docker/docker-compose.selfhost.yml \
  --env-file infra/docker/.env up
```

Você não precisa iniciar o banco de dados separadamente — o `api` aguarda o healthcheck dele.

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

Três segredos, um dado informativo e a conta com a qual você fará login:

- **`POSTGRES_PASSWORD`** — a senha do banco de dados. Alterá-la mais tarde significa alterá-la no volume também, portanto, escolha-a com cuidado.
- **`JWT_SECRET`** — assina cada sessão. Rotacioná-lo desconecta todos os usuários.
- **`REBASE_SERVICE_KEY`** — a credencial que ignora o row-level security para chamadas entre servidores (server-to-server). Trate-a como uma senha de root: qualquer coisa que a possua pode ler todas as linhas.
- **`CORS_ORIGINS`** — as origens a partir das quais seu frontend é servido, separadas por vírgula. Não é um segredo e não é opcional: o runtime se recusa a iniciar em produção sem isso em vez de tentar adivinhar, pois uma API que adivinha suas origens permitidas eventualmente permite a origem errada.
- **`REBASE_ADMIN_EMAIL`** / **`REBASE_ADMIN_PASSWORD`** — o primeiro administrador. Um banco de dados recém-criado não tem usuários, e fora de produção a política de registro aceita o primeiro cadastro e o promove a administrador — caso contrário, um banco de dados vazio seria um beco sem saída, já que a inicialização de um admin requer um chamador já autenticado. No momento em que essa stack passa a responder em um hostname, essa conveniência se torna uma corrida que o operador pode perder; portanto, em produção essa janela é fechada e a conta é definida aqui. O runtime a cria uma única vez, enquanto a tabela de usuários estiver vazia, e não faz nada nas inicializações seguintes.

Cada um dos três segredos deve ter pelo menos 32 caracteres, e a senha do admin pelo menos 12. Use um endereço com um ponto no domínio: `POST /auth/login` valida o corpo da requisição com `z.string().email()`, portanto `admin@localhost` criaria uma conta inicial e depois recusaria qualquer tentativa de uso. O arquivo compose declara todos os seis com `${VAR:?…}`, de modo que a ausência de um deles interrompe a stack com uma mensagem indicando o problema, em vez de iniciar algo parcialmente configurado — e o auto-registro vem desativado por padrão (`DISABLE_SELF_REGISTRATION`, padrão `true`), para que nada fique desprotegido.

Faça login com essas credenciais e altere a senha: elas estão armazenadas em um arquivo no host.

## Dependências

Por padrão, o `rebase build` **instala as dependências do seu projeto dentro do bundle**, de modo que o `dist-bundle` vem com um `node_modules` e um `package-lock.json` ao lado do seu `package.json`. Um bundle com dependências inclusas (vendored) inicia em cerca de cinco segundos.

Como elas já estão presentes, você pode montar o bundle como somente leitura (read-only) — algo recomendável, pois um hook comprometido não poderá reescrever o código executado após a próxima reinicialização:

```yaml
    volumes:
      - ./dist-bundle:/bundle:ro
```

O comando `rebase build --no-vendor` desativa essa opção e gera um bundle que instala suas dependências na primeira inicialização, o que leva de 40 a 60 segundos por inicialização e requer que o ponto de montagem tenha permissão de escrita.

Para um deploy em produção real, dê preferência a empacotar ambos em uma imagem, o que também fixa com exatidão o que é executado:

```dockerfile
FROM rebasepro/server:0.20.0
COPY dist-bundle /bundle
```

## Criando o schema

**O runtime cria as tabelas ausentes durante a inicialização, incluindo as das suas collections.**
`REBASE_MIGRATE_ON_BOOT` tem como padrão `ensure`, que é aditivo em todo o schema: ele cria tabelas, colunas e tipos enum ausentes, além de aplicar suas políticas de row-level security. Uma primeira inicialização em um banco de dados vazio já sobe servindo suas collections, sem etapas adicionais.

O que o `ensure` deliberadamente nunca faz é alterar o que já existe. Ele não altera o tipo de uma coluna, não exclui uma tabela ou coluna e não edita os valores de um enum existente — pois o reinício de um contêiner não deve ser capaz de remodelar um schema como efeito colateral de um deploy.

Portanto, ainda vale a pena executar `rebase db push` para os dois itens que a inicialização não toca:

```bash
rebase db push
```

- **RLS de tabelas de junção (junction-table)** para relações muitos-para-muitos (many-to-many).
- **Qualquer alteração que não seja puramente aditiva** — uma coluna renomeada, um tipo restringido, um campo removido.

Execute-o a partir de um checkout local ou de um job de CI, apontando para o banco de dados do deploy. Ele executa uma simulação (dry-run) da alteração primeiro, recusa operações destrutivas sem confirmação explícita e pode gerar um backup antes de aplicar. O banco de dados expõe uma porta no arquivo compose para que seja alcançável a partir do host; remova esse mapeamento assim que o schema estiver definido se o banco de dados não dever ser acessível externamente.

`REBASE_MIGRATE_ON_BOOT` aceita `ensure` e `none`, e nada mais — a imagem **se recusa a inicializar** com `push`, pelo motivo exposto acima.

## Armazenamento de arquivos

O armazenamento fica **desativado** a menos que um bucket seja configurado, e isso é proposital: a alternativa padrão seria o sistema de arquivos do contêiner, que perderia silenciosamente todos os arquivos enviados no próximo reinício. Os uploads são recusados com `501 STORAGE_NOT_CONFIGURED` até que você configure um.

Para um bucket, defina `STORAGE_TYPE=s3` (ou `gcs`) junto com o bucket e suas credenciais — o arquivo compose lista as variáveis comentadas.

Para disco local, o que só é apropriado quando o caminho é um volume real que persiste além do ciclo de vida do contêiner:

```yaml
      STORAGE_TYPE: local
      STORAGE_PATH: /data/uploads
      FORCE_LOCAL_STORAGE: "true"
    volumes:
      - uploads:/data/uploads
```

`FORCE_LOCAL_STORAGE` não é opcional nesse caso: em produção, um backend `local` é descartado em vez de registrado, pois a alternativa seria uploads bem-sucedidos em um sistema de arquivos prestes a ser destruído. Essa variável é a forma de declarar que o ponto de montagem é persistente.

### O armazenamento precisa de um modelo de controle de acesso

Uma vez que um bucket **está** configurado, o runtime **se recusa a inicializar em produção** até que o deploy defina como os objetos são protegidos. O storage não está sob row-level security e suas chaves compartilham um namespace único e plano; portanto, sem uma regra, a única coisa que separa os arquivos de dois usuários é a imprevisibilidade das chaves — algo que `GET /storage/list?prefix=` contorna. Qualquer uma das seguintes opções atende a essa exigência:

- um **hook `storageAuthorize`** (ou `storagePolicies`) na configuração do seu projeto, que é a solução real e o que o scaffold fornece em `config/storage.ts` — nenhuma variável de ambiente consegue expressar "este usuário pode ler esta chave";
- **`STORAGE_PUBLIC_READ=true`**, para um bucket que é genuinamente uma CDN pública somente leitura;
- **`STORAGE_ALLOW_ANY_AUTHENTICATED=true`**, para um aplicativo single-tenant onde qualquer conta autenticada tem permissão para acessar qualquer arquivo.

Fora de produção, a mesma condição gera um aviso visível em vez de uma recusa, portanto esta é uma falha de inicialização com a qual você se depara no deploy, e não no ambiente local. Isso é intencional: a falha que isso previne é silenciosa.

Defina também `MFA_ENCRYPTION_KEY` caso utilize TOTP. Se não for definida, os segredos armazenados do autenticador serão criptografados com `JWT_SECRET` — portanto, rotacioná-lo desconectará todos os usuários *e* tornará todos os dispositivos cadastrados indecifráveis.

## Outras plataformas

O runtime é um contêiner comum escutando na porta `$PORT`, portanto qualquer plataforma que execute contêineres funcionará. Dois pontos que devem estar corretos em qualquer lugar:

1. O bundle deve estar presente em `/bundle` (ou onde `REBASE_BUNDLE` apontar), com suas dependências instaladas ao lado dele — consulte [Dependências](#dependencies).
2. Defina `CORS_ORIGINS`, `JWT_SECRET` e `DATABASE_URL`. O runtime se recusa a iniciar em produção sem eles em vez de tentar adivinhar.

### Fly.io

```toml
[build]
  image = "rebasepro/server:0.20.0"

[http_service]
  internal_port = 8080

[[http_service.checks]]
  path = "/livez"
```

Use o formato de imagem derivada acima para que o bundle seja enviado com a aplicação e, em seguida, execute `fly deploy`.

### Railway / Render

Aponte o serviço para a imagem derivada, configure as variáveis de ambiente e defina o caminho de health check para `/livez`.

### Uma VPS comum

```bash
npm install -g @rebasepro/server @rebasepro/server-postgres
rebase-server /srv/myapp/dist-bundle
```

O comando `rebase-server --help` lista as variáveis que ele lê. No systemd — as três linhas de admin são recentes, e na versão 0.17.3 a primeira conta a se registrar torna-se o administrador:

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

`NODE_ENV=production` não é mero detalhe. Se não for definido, o processo será executado em modo de desenvolvimento: ele aceita origens de localhost, disponibiliza a especificação OpenAPI e **deixa a janela do primeiro administrador aberta** — de modo que o primeiro estranho que encontrar o formulário de cadastro se tornará o administrador. As duas linhas `REBASE_ADMIN_*` são o que substituem essa janela; consulte [Seu primeiro admin](/docs/getting-started/deployment/#your-first-admin).

Prefira `EnvironmentFile=/etc/rebase.env` com o arquivo em modo 0600 em vez de linhas `Environment=` para os segredos: um arquivo de unidade (unit file) pode ser lido por qualquer usuário, e o comando `systemctl show` exibe todos os valores de `Environment=`.

## Pooling de conexões

O runtime mantém um pool pequeno e de longa duração e não precisa de um pooler. Quem precisa é todo o restante que se comunica com o mesmo banco de dados e não pode reter uma conexão: uma função serverless, um script agendado, uma ferramenta de BI, um worker de fila que escala para cinquenta instâncias. O `max_connections` do Postgres é um limite rígido na faixa das centenas baixas e cada conexão é um *processo*, de modo que uma explosão de concorrência de lambdas o esgota muito antes de o banco de dados estar sobrecarregado.

O arquivo compose traz um serviço `pgbouncer` para esse tráfego, protegido por um profile para que um deploy sem esses clientes não execute um processo desnecessário:

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

A autenticação de clientes é gerada a partir da `DATABASE_URL` na inicialização, portanto a senha não precisa ser escrita duas vezes. O pooler se autentica no Postgres com `scram-sha-256`, suportado pelo Postgres 18 — o padrão `md5` da imagem falha no login do *servidor* com `FATAL: server login failed: wrong password type`, o que parece um erro de senha incorreta, mas não é.

Mantenha a soma de `PGBOUNCER_POOL_SIZE` em todos os poolers confortavelmente abaixo do `max_connections` do banco de dados — o runtime consome do mesmo limite.

### O que muda com o pooling de transações

Um cliente conectado via pool retém uma conexão com o servidor pela duração de uma transação e depois a devolve, permitindo que 500 clientes compartilhem 20 conexões. Três coisas deixam de funcionar através dessa porta, e todas são recursos utilizados pelo próprio Rebase — razão pela qual o runtime se conecta diretamente e essa porta é destinada a outros clientes:

- **`LISTEN`/`NOTIFY`.** O Realtime é baseado nisso, e um listener precisa de uma conexão que dure mais do que uma transação. O comando `LISTEN` é *aceito* através do pooler — ele responde com `LISTEN`, e nenhuma notificação chega.
- **Estado de sessão (session state)**: `SET` (em oposição a `SET LOCAL`), advisory locks mantidos entre declarações, cursores `WITH HOLD`, tabelas temporárias. A próxima transação pode cair em uma conexão de servidor diferente, que não verá nada disso. Ambos falham da mesma forma enganosa: com um único cliente ocioso o estado geralmente ainda persiste, funcionando durante os testes e parando de funcionar sob a concorrência para a qual você introduziu o pooler.
- **Prepared statements a nível de protocolo.** A maioria dos drivers pode ser configurada para não utilizá-los — o node-postgres não os usa por padrão; o asyncpg requer `statement_cache_size=0`.

`SET LOCAL` tem escopo de transação e funciona normalmente, sendo o mecanismo usado para definir o row-level security — logo, o RLS se comporta de forma idêntica através da porta de pooling.

Mantenha o profile desativado se nada fora do runtime se conectar ao seu banco de dados. Uma porta não utilizada é superfície de ataque.

## Health checks

| Caminho | Finalidade |
| --- | --- |
| `/livez` | Liveness. Responde "este processo está vivo" sem consultar o banco de dados. |
| `/health` | Readiness. Realiza um round-trip no banco de dados e relata a latência. |

Aponte as sondas de liveness para `/livez`. Uma sonda de liveness em `/health` reinicia um processo perfeitamente saudável durante uma oscilação breve do banco de dados, o que é o oposto do seu propósito.

## Métricas

```bash
REBASE_METRICS=true
REBASE_METRICS_TOKEN=<random string>
```

Expõe métricas do Prometheus em `/metrics`: contagem de requisições e histogramas de latência detalhados por superfície de API (data, auth, storage, functions) e collection, além de medidores (gauges) de processo. Sem um token, o endpoint fica acessível para leitura por qualquer pessoa que alcançar a porta, portanto defina um a menos que esteja em uma rede privada.

## Executando funções em seu próprio processo

Tudo o que foi descrito acima consiste em um único contêiner servindo todo o projeto, o que é o formato ideal para quase todos os deploys. Quando uma função customizada precisar parar de competir com a API de dados pelo event loop — ou precisar escalar, reiniciar e falhar de forma independente —, a mesma imagem e o mesmo bundle podem ser inicializados como vários processos cooperantes. Consulte [Processos divididos](/docs/deployment/split-processes/).

## Atualizando

```yaml
image: rebasepro/server:0.20.0
```

Reinicie. Seu bundle permanece inalterado. Dentro de uma mesma versão major do contrato de runtime, um bundle validado continuará funcionando — consulte [Compatibilidade](/docs/architecture/runtime-and-bundles/#compatibility).

---
