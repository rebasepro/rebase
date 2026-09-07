---
sourceHash: f6312cfcb6187cea
title: Ambiente e Configuração
sidebar_label: Configuração
description: Todas as variáveis de ambiente e opções de configuração para projetos Rebase.
---

## Variáveis de Ambiente

Toda a configuração é feita através de variáveis de ambiente no seu arquivo `.env` na raiz do projeto.

> **Importante**: O Rebase valida as variáveis de ambiente com **Zod** no arranque.
> Se faltar algo obrigatório ou estiver malformado (um URL que não é um URL, uma
> porta que não é um número), o servidor recusa arrancar e nomeia a variável.
>
> Onde vive o esquema depende de como executa o backend. Um projeto arrancado pelo
> runtime — `rebase dev`, `rebase start`, a imagem publicada — usa o esquema do
> próprio runtime (`loadBootEnv` em `@rebasepro/server`), que é a união de todas as
> tabelas abaixo. Um projeto que executou [`rebase eject`](/docs/cli) possui o seu
> próprio `backend/src/env.ts` com `loadEnv({ extend })`, e pode acrescentar aí as
> suas variáveis tipadas.

### Obrigatórias

| Variável | Descrição | Exemplo |
|----------|-------------|---------|
| `DATABASE_URL` | String de conexão PostgreSQL. **Opcional em desenvolvimento** — sem ela, o `rebase dev` executa um PostgreSQL gerenciado para o projeto, com os dados em `.rebase/`. Obrigatória em todo o resto. | `postgresql://user:pass@localhost:5432/mydb` |
| `JWT_SECRET` | Chave secreta para assinar tokens JWT. Use uma string aleatória forte (mínimo 32 caracteres). **Obrigatória em produção** (gerada automaticamente em desenvolvimento). | `a1b2c3d4e5...` |

> **`sslmode=no-verify` é uma grafia do node-postgres, não do libpq.**
>
> O Rebase e o driver do Node a aceitam — cifrar, mas não verificar o
> certificado. `psql`, `pg_dump`, `pg_restore` e Atlas não, e não degradam: eles
> se recusam a iniciar com `invalid sslmode value: "no-verify"`.
>
> Os comandos do próprio Rebase (`rebase db push`, `rebase db backup`, `rebase db
> restore`) a reescrevem para o equivalente `sslmode=require` antes de chamar o
> binário, então funcionam com a URL tal como está configurada. Usar `psql` à mão
> não — troque ali por `sslmode=require`, que cifra sem verificar exatamente do
> mesmo jeito.

### Frontend

| Variável | Descrição | Padrão |
|----------|-------------|---------|
| `VITE_API_URL` | URL da API de backend para o SDK do cliente. **Defina-o apenas em desenvolvimento** — veja abaixo. | origem da página |
| `VITE_GOOGLE_CLIENT_ID` | ID do cliente Google OAuth. Habilita "Fazer login com o Google". | — |


> **Deixe `VITE_API_URL` sem definir nas builds de produção.**
>
> Em desenvolvimento o frontend e o backend são origens separadas, então o
> servidor de desenvolvimento a injeta. Em produção o backend do Rebase serve a
> SPA, então a API é a própria origem da página e o cliente a resolve assim
> sozinho.
>
> Assar uma URL absoluta num bundle de produção funciona até o momento em que um
> segundo hostname aponta para a mesma app: um domínio próprio carrega então a
> página a partir de `example.com` e chama a API em `example.rebase.website`, o
> que é cross-origin, então toda requisição falha no preflight. Permitir a origem
> no CORS também **não** resolve: o cookie de refresh é `SameSite=Lax` e não é
> enviado entre sites, então você teria limpado os erros do console e continuaria
> com a autenticação quebrada. Sem definir, qualquer domínio que aponte para a
> app funciona sem nenhuma configuração de CORS.

### Backend

| Variável | Descrição | Padrão |
|----------|-------------|---------|
| `PORT` | Porta para o servidor HTTP de backend. Lida por `rebase start`. O `rebase dev` lê-a **apenas do ambiente da shell** — uma `PORT` no `.env` não é lida aí, porque a porta é resolvida antes de esse ficheiro ser carregado — e caso contrário usa uma porta derivada do caminho do projeto, para que vários projetos possam correr ao mesmo tempo. `rebase dev --port` prevalece sobre ambas, e o banner de arranque indica que nível usou. | `3001` |
| `LOG_LEVEL` | Nível de verbosidade de log: `error`, `warn`, `info`, `debug` | `info` |
| `REBASE_LOG_RAW_QUERIES` | Mostra o SQL por trás de uma linha `Failed query: [redacted]`. Toda instrução que falha é ocultada por omissão, porque uma consulta falhada leva consigo os seus parâmetros ligados — um email, um hash de palavra-passe. Define-o como `true` enquanto diagnosticas uma falha de DDL, RLS ou captura de alterações. Ignorado quando `NODE_ENV=production`. | `false` |
| `NODE_ENV` | Ambiente: `development`, `production` ou `test` | `development` |
| `CORS_ORIGINS` | Lista de origens permitidas separadas por vírgulas. **Obrigatória em produção** se diferir do domínio do backend. Em desenvolvimento ela é *adicionada a* localhost — veja abaixo. | — |
| `FRONTEND_URL` | URL da app frontend. Usada como alternativa a `CORS_ORIGINS`, nos dois ambientes. | — |
| `ADMIN_CONNECTION_STRING` | String de conexão ao banco de dados em nível administrativo (usada para introspecção de esquema e operações administrativas). | `DATABASE_URL` |
| `DISABLE_DB_ROLE_SWITCHING` | Desativa a troca de papel do PostgreSQL no Editor SQL (útil com autenticação própria em que os papéis do banco não estão mapeados). | `false` |

#### CORS em desenvolvimento

Desenvolvimento permite **localhost, mais o que `CORS_ORIGINS` (ou
`FRONTEND_URL`) nomear** — a mesma lista que a produção usa, com localhost
acrescentado em vez de substituído. Assim a variável funciona igual nos dois
ambientes, e os casos que precisam dela em desenvolvimento são os comuns:

```bash
# A phone on the LAN, a colleague's machine, an ngrok tunnel,
# a forwarded Codespaces port — all non-localhost origins.
CORS_ORIGINS=http://192.168.1.5:5173
```

Uma origem que não é localhost nem está listada é recusada, e a recusa é
registrada **uma vez por origem** com a linha exata que a permitiria. Recusar não
é cautela por si só: a API envia credenciais, então refletir um `Origin`
arbitrário deixaria qualquer site que a desenvolvedora visite fazer requisições
autenticadas contra o servidor de desenvolvimento com a sessão dela e ler as
respostas.

### Autenticação

| Variável | Descrição | Padrão |
|----------|-------------|---------|
| `JWT_SECRET` | Segredo para assinatura JWT (obrigatório em produção, gerado automaticamente em desenvolvimento) | — |
| `JWT_PRIVATE_KEY` | Chave privada PEM para assinar tokens de acesso de forma assimétrica (RS256), para que qualquer coisa que tenha o JWKS possa verificar uma sessão sem conseguir emitir uma. Aceita um PEM com quebras de linha reais, um PEM com escapes `\n`, ou o base64 do PEM inteiro. Sem ela os tokens continuam HS256. | — |
| `JWT_KEY_ID` | Nomeia `JWT_PRIVATE_KEY` no cabeçalho do token e no JWKS. Mude-o sempre que a chave mudar — a rotação depende de a antiga e a nova serem distinguíveis. | `default` |
| `JWT_ACCESS_EXPIRES_IN` | Tempo de vida do token de acesso | `1h` |
| `JWT_REFRESH_EXPIRES_IN` | Tempo de vida do token de atualização. Deslizante — cada rotação o renova, então ele governa quanto tempo uma sessão sobrevive à **inatividade**. | `400d` |
| `ALLOW_REGISTRATION` | Permitir que novos usuários se registrem (`true`/`false`). Fora de produção o **primeiro** usuário sempre pode se registrar, diga o que disser isto — uma tabela de usuários vazia tem de admitir alguém, e esse alguém vira o administrador. Em produção (`NODE_ENV=production`) essa janela está fechada: uma tabela vazia recusa o registro de bootstrap com `SETUP_REQUIRED`, uma primeira conta criada por registro aberto é uma conta comum, e o administrador é nomeado com `REBASE_ADMIN_EMAIL` abaixo ou atribuído com a chave de serviço. O `.env.example` do scaffold a define como `true`; o padrão do framework é desligado. | `false` |
| `DISABLE_SELF_REGISTRATION` <span class="since-badge" data-since="0.18">Since 0.18</span> | Interruptor de emergência. Fecha a janela de bootstrap do primeiro usuário que `ALLOW_REGISTRATION=false` deixa deliberadamente aberta fora de produção, de modo que o registro fica fechado mesmo contra um banco vazio. Combine-a com `REBASE_ADMIN_EMAIL` abaixo, ou a implantação não terá como produzir o seu primeiro chamador autenticado. Todo artefato de implantação publicado a define. | — |
| `REBASE_ADMIN_EMAIL` <span class="since-badge" data-since="0.18">Since 0.18</span> | E-mail da primeira conta de administrador, criada no arranque **enquanto a tabela de usuários ainda está vazia** e nunca depois. É assim que uma implantação de produção ganha o seu administrador: o operador nomeia a primeira conta em vez de disputá-la com a internet. O arranque avisa quando a tabela está vazia em produção e isto fica sem definir. | — |
| `REBASE_ADMIN_PASSWORD` <span class="since-badge" data-since="0.18">Since 0.18</span> | Senha dessa conta. Pelo menos 12 caracteres, ou é recusada e a conta não é criada. Troque-a após o primeiro login. | — |
| `MFA_ENCRYPTION_KEY` | Cifra todos os segredos TOTP armazenados. Sem definir, os segredos são cifrados com `JWT_SECRET` e o arranque avisa uma vez — então rotacionar `JWT_SECRET` desconecta todo mundo *e* deixa indecifrável cada autenticador cadastrado. Defina uma chave dedicada (32+ caracteres aleatórios) antes que alguém se cadastre. | — |
| `MFA_ENCRYPTION_KEY_PREVIOUS` | A chave da qual se está rotacionando *para longe*. Defina as duas durante uma rotação: os segredos novos são escritos com `MFA_ENCRYPTION_KEY` e os existentes continuam legíveis, então ninguém fica trancado para fora da própria conta no meio da rotação. Remova-a assim que todos os segredos forem recifrados. | — |
| `ALLOW_ANONYMOUS` | Habilita o login anônimo (`POST /api/auth/anonymous`). É opt-in, e deliberadamente não condicionado a `ALLOW_REGISTRATION`. | `false` |
| `AUTH_REQUIRE` | Exige autenticação para a API de dados. Defina `false` para uma superfície de leitura totalmente pública — a RLS continua valendo. | `true` |
| `AUTH_DEFAULT_ROLE` | Papel atribuído a um usuário recém-registrado quando nenhum é informado. | — |
| `AUTH_ALLOW_USER_LOOKUP` | Monta `POST /api/auth/find-user`, que resolve um e-mail para um perfil público mínimo (`uid`, `displayName`, `photoURL`) em fluxos de convite por e-mail. Apenas para chamadores autenticados, e nunca devolve o e-mail, os papéis ou os metadados do usuário encontrado. Desligado por padrão: é uma superfície de enumeração. | `false` |
| `AUTH_COOKIE_SAME_SITE` | `SameSite` no cookie de refresh: `Strict`, `Lax` ou `None`. `None` exige HTTPS e é só para um frontend genuinamente cross-site. | `Lax` |
| `AUTH_COOKIE_SECURE` | `Secure` no cookie de refresh. Ligado por padrão; `AUTH_COOKIE_SECURE=false` para http sem TLS — uma implantação em um endereço de rede local, onde o navegador descartaria o cookie e a sessão morreria na expiração do token de acesso, sem erro algum. A inicialização avisa. `http://localhost` não precisa disso. | `true` |
| `GOOGLE_CLIENT_ID` | ID do cliente Google OAuth (validação de backend) | — |
| `GOOGLE_CLIENT_SECRET` | Segredo do cliente Google OAuth | — |
| `GITHUB_CLIENT_ID` | ID do cliente GitHub OAuth | — |
| `GITHUB_CLIENT_SECRET` | Segredo do cliente GitHub OAuth | — |
| `MICROSOFT_CLIENT_ID` | ID do cliente Microsoft OAuth | — |
| `MICROSOFT_CLIENT_SECRET` | Segredo do cliente Microsoft OAuth | — |
| `LINKEDIN_CLIENT_ID` | ID do cliente LinkedIn OAuth | — |
| `LINKEDIN_CLIENT_SECRET` | Segredo do cliente LinkedIn OAuth | — |
| `FACEBOOK_CLIENT_ID` | ID do cliente Facebook OAuth | — |
| `FACEBOOK_CLIENT_SECRET` | Segredo do cliente Facebook OAuth | — |
| `TWITTER_CLIENT_ID` | ID do cliente X/Twitter OAuth | — |
| `TWITTER_CLIENT_SECRET` | Segredo do cliente X/Twitter OAuth | — |
| `DISCORD_CLIENT_ID` | ID do cliente Discord OAuth | — |
| `DISCORD_CLIENT_SECRET` | Segredo do cliente Discord OAuth | — |
| `GITLAB_CLIENT_ID` | ID do cliente GitLab OAuth. A `baseUrl` de uma instância auto-hospedada não tem grafia como variável de ambiente — configure o GitLab no bloco `auth` para isso. | — |
| `GITLAB_CLIENT_SECRET` | Segredo do cliente GitLab OAuth | — |
| `BITBUCKET_CLIENT_ID` | ID do cliente Bitbucket OAuth | — |
| `BITBUCKET_CLIENT_SECRET` | Segredo do cliente Bitbucket OAuth | — |
| `SLACK_CLIENT_ID` | ID do cliente Slack OAuth | — |
| `SLACK_CLIENT_SECRET` | Segredo do cliente Slack OAuth | — |
| `SPOTIFY_CLIENT_ID` | ID do cliente Spotify OAuth | — |
| `SPOTIFY_CLIENT_SECRET` | Segredo do cliente Spotify OAuth | — |
| `APPLE_CLIENT_ID` | Services ID da Apple. A Apple não tem segredo de cliente estático — o Rebase assina um JWT ES256 de vida curta a cada troca de token — então ela precisa dos quatro valores `APPLE_*`, e sem eles não configura nada. | — |
| `APPLE_TEAM_ID` | Team ID do Apple Developer, o emissor do JWT. | — |
| `APPLE_KEY_ID` | Key ID da chave privada registrada na Apple. | — |
| `APPLE_PRIVATE_KEY` | Conteúdo do arquivo de chave privada `.p8`, com quebras de linha e tudo (escapes `\n` são aceitos). | — |
| `REBASE_SERVICE_KEY` | Chave de API de administrador estática. Contorna a autenticação JWT normal para chamadas servidor a servidor quando passada como `Authorization: Bearer <key>`. (Gerada automaticamente em desenvolvimento). | — |
| `REBASE_RATE_LIMIT_STORE` | Onde vivem os contadores do rate limit de auth: `memory` (por processo) ou `sql` (compartilhados entre réplicas). Um processo não consegue ver a própria contagem de réplicas, então uma implantação com pares tem de dizer isso — três réplicas no padrão aplicam três vezes o limite. Qualquer outro valor **recusa iniciar** em vez de recorrer a outro, `postgres` incluído. | `memory` |
| `AUTH_MAGIC_LINK` | Monta o fluxo de login sem senha por link. Precisa de um serviço de e-mail configurado, ou o link não tem para onde ir. | `false` |
| `AUTH_EMAIL_OTP` | Monta o login sem senha com um código de seis dígitos enviado por e-mail. O mesmo requisito de e-mail acima. | `false` |
| `CAPTCHA_PROVIDER` | Liga a verificação de captcha nas rotas de auth: `turnstile` ou `hcaptcha`. Sem definir significa sem captcha. | — |
| `CAPTCHA_SECRET` | O segredo do provedor, usado no servidor para verificar o token que o navegador envia. Obrigatório assim que `CAPTCHA_PROVIDER` estiver definido. | — |
| `CAPTCHA_ROUTES` | Rotas de auth a proteger, separadas por vírgulas (por exemplo `register,login`). Sem definir protege o conjunto padrão do provedor. | — |

### Armazenamento

:::caution[O armazenamento não tem segurança em nível de linha, então precisa de um modelo de acesso]
As coleções são protegidas pela RLS do Postgres. O armazenamento de objetos não
tem equivalente — as chaves compartilham um único namespace plano — então, com um
bucket configurado e nenhum modelo de acesso, o servidor **recusa iniciar em
produção**. Satisfaça isso com exatamente um destes: um hook `storageAuthorize`
exportado de `config/index.ts` (o que o scaffold traz), `STORAGE_PUBLIC_READ` ou
`STORAGE_ALLOW_ANY_AUTHENTICATED`.
:::

| Variável | Descrição | Padrão |
|----------|-------------|---------|
| `STORAGE_TYPE` | Backend de armazenamento: `local`, `s3` ou `gcs`. Em produção, `local` desativa o armazenamento a menos que `FORCE_LOCAL_STORAGE=true` | `local` |
| `STORAGE_PATH` | Caminho base para armazenamento local | `./uploads` |
| `FORCE_LOCAL_STORAGE` | Permite armazenamento local em produção — apenas com um volume durável montado em `STORAGE_PATH` | `false` |
| `S3_BUCKET` | Nome do bucket S3 (quando `STORAGE_TYPE=s3`) | — |
| `S3_REGION` | Região AWS | — |
| `S3_ACCESS_KEY_ID` | Chave de acesso AWS | — |
| `S3_SECRET_ACCESS_KEY` | Chave secreta AWS | — |
| `S3_ENDPOINT` | Endpoint S3 personalizado (para MinIO, Cloudflare R2, etc.) | — |
| `S3_FORCE_PATH_STYLE` | Força URLs em estilo de caminho para o bucket S3 (`true`/`false`) | `false` |
| `GCS_BUCKET` | Nome do bucket GCS (quando `STORAGE_TYPE=gcs`) | — |
| `GCS_PROJECT_ID` | Projeto do GCP. Normalmente inferido das credenciais. | — |
| `GCS_KEY_FILENAME` | Caminho para um arquivo de chave de conta de serviço. Omita no GCP, onde a Workload Identity fornece as credenciais. | — |
| `STORAGE_PUBLIC_READ` | Serve todo objeto a qualquer um, sem token. Apenas para um bucket que realmente é uma CDN pública. Uma das três formas de satisfazer a verificação de arranque acima. | `false` |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Deixa qualquer chamador autenticado ler, escrever, listar e apagar todo objeto. Chamado de `INSECURE` no objeto de configuração por um motivo: só é defensável numa app single-tenant onde toda conta é confiável com todo arquivo. | `false` |
| `STORAGE_RENDITION_CACHE` | Guarda em cache as versões de imagem geradas (redimensionamentos, conversões de formato) em vez de produzi-las a cada requisição. | `false` |

### Email (Opcional)

| Variável | Descrição |
|----------|-------------|
| `SMTP_HOST` | Host do servidor SMTP |
| `SMTP_PORT` | Porta do servidor SMTP |
| `SMTP_SECURE` | Habilitar conexão segura (`true`/`false`) |
| `SMTP_USER` | Nome de usuário SMTP |
| `SMTP_PASS` | Senha SMTP |
| `SMTP_FROM` | Endereço do remetente para e-mails do sistema |
| `SMTP_NAME` | Nome exibido no endereço do remetente |
| `APP_NAME` | Nome do produto usado nos assuntos e corpos dos e-mails (padrão: `Rebase`) |
| `EMAIL_LOGO_URL` | Logo exibido no topo dos modelos de e-mail padrão. PNG ou JPG `http(s)` absoluto — os clientes removem SVG e bloqueiam URIs `data:`. Sem definir, uma app ainda chamada `Rebase` recebe a marca do Rebase e uma renomeada não recebe nenhuma |

### Pool de conexões do banco de dados

| Variável | Descrição | Padrão |
|----------|-------------|---------|
| `DB_POOL_MAX` | Máximo de conexões no pool | `20` |
| `DB_POOL_IDLE_TIMEOUT` | Milissegundos que uma conexão ociosa é mantida | `30000` |
| `DB_POOL_CONNECT_TIMEOUT` | Milissegundos de espera por uma conexão | `10000` |
| `DATABASE_DIRECT_URL` | Conexão direta (sem pool). O [Realtime](/docs/backend/realtime) precisa de uma: `LISTEN`/`NOTIFY` não sobrevive a um pooler de transações como o PgBouncer, e sem ela as notificações de mudança são desativadas com um aviso em vez de se perderem em silêncio. | — |
| `DATABASE_READ_URL` | Réplica de leitura. As leituras vão para lá quando está definida e difere de `DATABASE_URL`; se a conexão falhar, tudo recorre à primária com um aviso. | — |
| `REBASE_DB_POOL_MAX` | Um teto sobre todos os pools do processo, aplicado independentemente do que cada um pediu. Só dígitos: um valor malformado é ignorado em vez de serializar o servidor em silêncio. | — |

### Comportamento do runtime

Lido pelo runtime — `rebase dev`, `rebase start` e a imagem de servidor
publicada. Um projeto que fez eject é dono dessas decisões no próprio código.

| Variável | Descrição | Padrão |
|----------|-------------|---------|
| `REBASE_RLS_AUDIT` | Executa a auditoria de segurança em nível de linha no arranque e monta o seu endpoint, que reporta tabelas servidas sem políticas. | — |
| `REBASE_BASE_PATH` | Caminho base de toda rota da API. É preciso dizer o mesmo ao cliente — veja [Alterar `basePath`](#alterar-basepath). | `/api` |
| `REBASE_SERVE_STATIC` | Serve os assets estáticos/de administração do bundle a partir deste processo. Desligue quando houver uma CDN na frente. | `true` |
| `REBASE_HISTORY` | Registra o [histórico de mudanças de entidades](/docs/backend/history). | `true` |
| `REBASE_COMPRESSION` | Respostas com gzip/brotli. | `true` |
| `REBASE_MAX_BODY_SIZE` | Corpo máximo da requisição, **em bytes** (`10485760`, não `10MB` — um valor que não é um número recusa iniciar em vez de remover o limite em silêncio). | — |
| `REBASE_ENABLE_SWAGGER` | A superfície OpenAPI. Três estados: sem definir significa ligada em desenvolvimento e desligada em produção; `false` desliga as duas em qualquer lugar. Note que `true` em produção serve a **especificação** em `/api/docs` mas não a **UI** do Swagger em `/api/swagger` — a UI depende de `NODE_ENV` separadamente. | — |
| `REBASE_METRICS` | Expõe métricas do Prometheus em `/metrics`. | `false` |
| `REBASE_METRICS_TOKEN` | Token bearer que protege `/metrics`. Sem definir, deixa o endpoint aberto a qualquer coisa que alcance a porta — tudo bem numa rede privada, não numa pública, e os logs de arranque dizem isso. | — |
| `REBASE_MIGRATE_ON_BOOT` | O que o runtime pode fazer ao esquema no arranque. `ensure` (o padrão, em toda parte — produção incluída) roda a passagem **aditiva**: criar tabelas, colunas e tipos enum que faltam, nunca descartar nem reescrever um. `none` não toca em nada. A imagem publicada aceita apenas esses dois e **recusa iniciar com `push`**. Numa [implantação dividida](/docs/deployment/split-processes) exatamente um processo pode aprovisionar, então todo outro papel precisa definir `none` ou recusar iniciar. | `ensure` |
| `REBASE_REQUIRE_SCHEMA_MATCH` | Recusa iniciar quando o banco foi aprovisionado pela última vez a partir de um conjunto de coleções diferente daquele com que este processo foi construído. Sem definir (ou com qualquer coisa diferente de `true`/`1`) avisa em vez disso. | avisa |
| `REALTIME_CDC` | Captura de mudanças em nível de banco: `auto` (ligar onde a conexão suportar, recorrer em silêncio caso contrário), `trigger` (forçar, avisar se for impossível), `wal` (hoje degrada para `trigger`), `off`. Veja [Realtime](/docs/backend/realtime#database-level-change-capture-cdc). | `auto` |
| `REALTIME_CHANNEL_BUS` | Transporte entre instâncias para canais de broadcast e presença: `memory` ou `postgres`. Ignorado quando a `realtime.bus` foi dado um transporte já construído. | `memory` |
| `ALLOW_LOCALHOST_IN_PRODUCTION` | Permite valores `localhost`/loopback sob `NODE_ENV=production`. Desligado, para que um arranque de produção falhe alto em vez de conectar a um banco que não está lá. | `false` |
| `REBASE_STRICT_COLLECTION_CONFIG` | O que o arranque faz com uma chave nas suas coleções que esta versão não lê: `warn`, `error` (recusar iniciar — vale a pena ligar em CI) ou `off`. Só governa as chaves que ele não *reconhece*, que costumam ser um erro de digitação e ocasionalmente metadados deliberados; uma chave que ele sabe que mudou de lugar é sempre fatal, porque senão o recurso que ela configurava some em silêncio. | `warn` |
| `REBASE_PROVISION_ONLY` | `1`/`true` roda a passagem de esquema e sai sem abrir um socket — o formato que um Job de migração quer, a partir da mesma imagem e do mesmo bundle do servidor que vem depois. Um valor vazio conta como *não definido*, então um `${SOMETHING}` não substituído num arquivo de compose não pode transformar uma implantação comum numa que migra e recusa servir. | — |
| `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` | `true` deixa uma máquina — um agente, um job de CI — *aplicar* uma mudança de esquema através de `/api/admin/schema`, não apenas planejá-la. Desligado a menos que seja pedido: a credencial que faria essa mudança é a que mais provavelmente está numa variável de CI. | `false` |
| `REBASE_FUNCTIONS_TIMEOUT_MS` | Por quanto tempo uma função personalizada pode rodar antes de a sua requisição ser abortada. O mesmo botão que a opção `functionsTimeoutMs`. | — |
| `REBASE_EXIT_ON_UNHANDLED_REJECTION` | `true` faz uma rejeição de promise não tratada terminar o processo em vez de registrá-la. Ligado sob um orquestrador que vai reiniciá-lo; desligado onde um reinício é pior que um vazamento. | `false` |
| `REBASE_CRON_ALWAYS_ON` | Mantém o agendador de cron rodando numa plataforma que o runtime detectaria como scale-to-zero, onde um timer que dispara numa instância ociosa não dispara em instância nenhuma. | — |
| `TRUSTED_PROXY_HOPS` | Quantos proxies ficam na frente deste servidor, para que o limitador de taxa possa ler o endereço real do cliente em `X-Forwarded-For`. Padrão seguro `0`: sem proxy, confiar no cabeçalho deixaria qualquer chamador forjar uma identidade. | `0` |

:::note[O aprovisionamento no arranque é aditivo, e não é uma ferramenta de migração]
A passagem de arranque roda sem supervisão, sem ninguém lendo um diff, então ela
nunca vai descartar uma coluna, estreitar um tipo ou reescrever uma tabela. É
também por isso que a imagem recusa `REBASE_MIGRATE_ON_BOOT=push`: um push
completo calcula um diff e fará um `DROP COLUMN` sem hesitar, e o reinício de um
contêiner nunca pode ser capaz de destruir uma coluna de produção como efeito
colateral de um reagendamento.

Mudanças destrutivas ou que remodelam ficam onde podem ser revisadas: `rebase db
generate` + `rebase db migrate`, ou `rebase db push` a partir de um checkout ou
da CI, que ensaia a mudança, recusa as destrutivas sem confirmação e pode fazer
um backup antes.
:::

### Implantações divididas

Uma imagem e um bundle podem ser iniciados várias vezes, cada uma servindo uma
parte diferente do projeto. Uma linha para cada aqui, porque esta página afirma
listar todas as variáveis; o que cada combinação *monta e possui* — e quais
combinações recusam iniciar — está em
**[Processos divididos](/docs/deployment/split-processes)**.

| Variável | Descrição | Padrão |
|----------|-------------|---------|
| `REBASE_ROLE` | Que parte este processo serve: `all`, `api`, `functions` ou `worker`. | `all` |
| `REBASE_CRON_SCHEDULER` | Sobrepõe se *este* processo roda os timers de cron. Sem definir, segue o papel. | — |
| `REBASE_JOB_WORKERS` | Sobrepõe se este processo roda workers da fila de jobs. Sem definir, segue o papel. | — |
| `REBASE_FUNCTIONS_ONLY` | Serve neste processo apenas as funções personalizadas nomeadas. | — |
| `REBASE_FUNCTIONS_EXCLUDE` | Serve todas as funções personalizadas exceto as nomeadas. | — |
| `REBASE_FUNCTIONS_UPSTREAM` | Para onde o processo de API encaminha uma requisição de função que ele mesmo não serve. | — |

### Backups

| Variável | Descrição | Padrão |
|----------|-------------|---------|
| `BACKUP_SCHEDULE` | Expressão cron para backups agendados. Sem definir significa que os backups agendados estão desligados. | — |
| `BACKUP_DESTINATION` | Caminho local, ou uma URL `s3://bucket/prefix` / `gs://bucket/prefix`. | `./backups` |
| `BACKUP_RETENTION_DAYS` | Apaga backups com mais de N dias. Sem definir ou `0` mantém tudo. | — |
| `BACKUP_KEEP_MINIMUM` | Mantém sempre pelo menos N dos backups mais recentes, diga o que disser a retenção. | — |
| `PG_DUMP_PATH` | Substitui o binário `pg_dump` — ele precisa corresponder à versão maior do servidor. | — |
| `PG_RESTORE_PATH` | Substitui o binário `pg_restore`. | — |

Backups contêm segredos e dados pessoais. Use um destino privado com criptografia
em repouso.
| `PG_DUMPALL_PATH` | Onde vive o `pg_dumpall`, quando não está no `PATH`. Sem ele — e sem as ferramentas cliente do PostgreSQL instaladas — um backup dos globals falha com um erro que nomeia esta variável. | — |

### Entrega do bundle

Uma implantação gerenciada não carrega o seu código na imagem: o runtime busca um
bundle no arranque. Estas variáveis decidem qual e como.

| Variável | Descrição | Padrão |
|----------|-------------|---------|
| `REBASE_BUNDLE` | Caminho para um diretório de bundle já extraído. O que o `rebase start` define localmente. | — |
| `REBASE_BUNDLE_URL` | De onde buscar o arquivo do bundle, quando não há um local. | — |
| `REBASE_BUNDLE_TOKEN` | A credencial bearer dessa busca. Trate-a como um segredo: é o que autoriza um tenant a baixar o próprio código. | — |
| `REBASE_BUNDLE_FETCH_DIR` | Onde um bundle baixado é extraído. Precisa ser gravável e sobreviver entre a busca e o arranque. | — |
| `REBASE_RUNTIME_MODULES` | Módulos extras que a imagem do runtime fornece ao bundle, além dos que ela mesma declara. | — |

### Vínculos de recursos

Cada banco de dados, bucket e tópico que um projeto declara em
`config/resources.ts` é vinculado por variáveis de ambiente nomeadas a partir
dele. Os nomes base estão abaixo; um recurso que não é o padrão acrescenta `__` e
a sua chave em maiúsculas, então um bucket chamado `media` lê
`S3_BUCKET__MEDIA`. O `rebase status`
<span class="since-badge" data-since="0.18">Since 0.18</span> imprime, por
recurso, a variável exata que está lendo e se ela está definida.

| Variável | Descrição | Padrão |
|----------|-------------|---------|
| `REBASE_DRIVER` | O pacote npm que implementa o driver de uma fonte de dados, quando não é o do Postgres padrão. Com sufixo por fonte: `REBASE_DRIVER__ANALYTICS`. | — |
| `REBASE_TOPIC_URL` | A string de conexão de um tópico declarado. Com sufixo por tópico. | — |

### O ambiente da própria CLI

Lido pelo `rebase`, não pelo servidor. Nada daqui afeta uma implantação.

| Variável | Descrição | Padrão |
|----------|-------------|---------|
| `REBASE_BASE_URL` | O backend com que o `rebase auth` e o `rebase api-keys` conversam, em vez de derivá-lo do projeto. | — |
| `REBASE_PORT` | A porta que esses comandos assumem ao derivar essa URL. | — |
| `SERVICE_KEY` | A chave de serviço com que eles se autenticam, em vez de perguntar. | — |
| `REBASE_ENV_FILE_PATH` | Qual `.env` a CLI lê e escreve, quando não é o do projeto. | — |
| `REBASE_CLOUD_URL` | O control plane com que o `rebase cloud` conversa. | — |
| `REBASE_CLOUD_EMAIL` | A conta com que o `rebase cloud login` entra, em vez de perguntar. | — |
| `REBASE_CLOUD_PASSWORD` | A senha dela, para que um cofre de segredos possa entregá-la sem que ela chegue ao histórico do shell. | — |
| `REBASE_DEBUG` | `1` imprime o erro subjacente e o detalhe da requisição em vez da mensagem curta. A primeira coisa a definir quando um comando `rebase cloud` falha de forma pouco útil. | — |
| `REBASE_DEV_NO_DB` | O `rebase dev` não sobe banco nenhum e não aprovisiona nada — você traz o seu. O mesmo que `--no-db`. | — |
| `REBASE_FRONTEND_PORT` | Fixa a porta do servidor de desenvolvimento do frontend, que o `rebase dev` de outro modo deriva do caminho do projeto. | — |
| `REBASE_DEV_READY_TIMEOUT_MS` | Quanto tempo o `rebase dev` espera o backend se anunciar antes de dizer que ele não subiu. `0` desliga o relatório. | `30000` |
| `DATABASE_PASSWORD` | A senha que o `rebase dev --docker` coloca na string de conexão que deriva do `docker-compose.yml`. | — |
| `DO_NOT_TRACK` | A convenção comum entre ferramentas. Definida como qualquer coisa diferente de `0` e a CLI não envia telemetria. | — |
| `REBASE_TELEMETRY_DISABLED` | O mesmo, específico para o Rebase. Não precisa de arquivo nenhum, e é por isso que é a indicada em CI e numa imagem. | — |
| `REBASE_TELEMETRY_ENDPOINT` | Para onde a telemetria é enviada, para um coletor auto-hospedado. | — |

## Segredos em desenvolvimento

`JWT_SECRET` e `REBASE_SERVICE_KEY` são obrigatórios em produção e gerados para
você fora dela, então dá para começar sem configurar nada.

Esses valores gerados ficam em cache em `.rebase-dev-secrets.json`, ao lado de
`.rebase-dev-port` e `.rebase-dev-url` e gitignorados junto com eles. Antes eles
eram regerados a cada arranque — então reiniciar o servidor de desenvolvimento
deslogava você da sua própria app e invalidava qualquer chave de API que você
tivesse acabado de criar.

- Defina qualquer uma das duas variáveis explicitamente e a sua é usada; nada é
  posto em cache nem lido.
- Aponte o cache para outro lugar com `REBASE_DEV_SECRETS_FILE` — um caminho, e a
  única variável desta seção que você definiria de propósito.
- Apague o arquivo para rotacionar os dois segredos. O arranque seguinte escreve
  um novo.
- Se o arquivo não puder ser escrito — um contêiner somente leitura, digamos — o
  servidor sobe mesmo assim com um segredo efêmero, exatamente como antes.

Nada é posto em cache em produção, nem sob um executor de testes. Em produção um
arranque que teve de gerar qualquer um dos dois segredos continua falhando,
nomeando a variável, e isso não mudou:

```
JWT_SECRET must be explicitly set in production.
Do not rely on auto-generated secrets outside development.
```

## Objeto de Configuração do Backend

O `RebaseBackendConfig` passado para `initializeRebaseBackend()` fornece controle programático:

```typescript
import { initializeRebaseBackend } from "@rebasepro/server";
import { createPostgresAdapter } from "@rebasepro/server-postgres";
import { env } from "./env";

await initializeRebaseBackend({
    app,
    server,
    collectionsDir: "./config/collections",
    basePath: "/api",        // Base path for all API routes (default: "/api")

    database: createPostgresAdapter({
        connection: db,
        schema: { tables, enums, relations }
    }),

    auth: {                  // Authentication config
        jwtSecret: env.JWT_SECRET,
        accessExpiresIn: env.JWT_ACCESS_EXPIRES_IN,
        refreshExpiresIn: env.JWT_REFRESH_EXPIRES_IN,
        requireAuth: true,    // Require auth for data API (default: true)
        allowRegistration: env.ALLOW_REGISTRATION,
        google: env.GOOGLE_CLIENT_ID
            ? {
                clientId: env.GOOGLE_CLIENT_ID,
                clientSecret: env.GOOGLE_CLIENT_SECRET
            }
            : undefined,
        serviceKey: env.REBASE_SERVICE_KEY
    },

    // No bucket configured in production means storage is off, not local:
    // uploads answer 501 rather than landing on a filesystem that is erased
    // on the next redeploy.
    storage: env.STORAGE_TYPE === "s3"
        ? {
            type: "s3",
            bucket: env.S3_BUCKET!,
            region: env.S3_REGION,
            accessKeyId: env.S3_ACCESS_KEY_ID,
            secretAccessKey: env.S3_SECRET_ACCESS_KEY,
            endpoint: env.S3_ENDPOINT
        }
        : env.STORAGE_TYPE === "gcs"
            ? {
                type: "gcs",
                bucket: env.GCS_BUCKET!,
                projectId: env.GCS_PROJECT_ID,
                keyFilename: env.GCS_KEY_FILENAME
            }
            : isProduction && !env.FORCE_LOCAL_STORAGE
                ? undefined
                : {
                    type: "local",
                    basePath: env.STORAGE_PATH || "./uploads"
                },

    history: true,           // Enable entity change history

    enableSwagger: true,     // Enable OpenAPI docs at /api/docs

    logging: {
        level: "info"
    }
});
```

### Alterar `basePath`

`basePath` move toda rota da API, então é preciso dizer o mesmo ao cliente — caso
contrário ele continua pedindo `/api/...` e recebe um 404 para tudo:

```typescript
import { createRebaseClient } from "@rebasepro/client";

export const rebase = createRebaseClient({
    baseUrl: "https://api.example.com",
    apiPath: "/v1"          // must match the backend's basePath
});
```

O painel de administração pega isso do cliente que recebe; nada mais precisa ser
configurado. Se você montar uma URL de requisição à mão, componha-a a partir do
cliente em vez de escrever `/api` você mesmo:

```typescript
import { useApiBase } from "@rebasepro/app";

function Widget() {
    const apiBase = useApiBase();   // e.g. "https://api.example.com/v1"
    // fetch(`${apiBase}/data/products`)
}
```

## Solução de problemas

### Permissão negada no Editor SQL (`permission denied for table <name>`)

* **Sintomas:** Consultas personalizadas executadas no Editor SQL do Rebase Studio falham com `cause: error: permission denied for table <name>`, mesmo que a visão de planilha do CMS carregue os dados sem problema.
* **Causa:** Por padrão, o Rebase tenta executar as consultas do Editor SQL trocando temporariamente de papel de banco de dados para corresponder ao papel de aplicação do usuário ativo (por exemplo, `SET LOCAL ROLE "admin"`). Se você usa autenticação própria em que os papéis existem apenas em tabelas do banco em vez de papéis reais do PostgreSQL, a troca de papel falha ou faltam privilégios. A visão de planilha do CMS roda sob o usuário dono da conexão e contorna isso.
* **Solução:** Adicione `DISABLE_DB_ROLE_SWITCHING=true` à configuração `.env` do seu backend. Isso força o Rebase a rodar as consultas do Editor SQL com os privilégios do dono da conexão (tipicamente um superusuário/dono).

### Falha ao buscar o esquema no Editor SQL (`Cross-database execution requires adminConnectionString`)

* **Sintomas:** O Studio não carrega a árvore de esquema, ou o Editor SQL lança `Failed to fetch schema: Cross-database execution requires adminConnectionString to be configured in the backend.`
* **Causa:** O Rebase precisa de privilégios administrativos para consultar os catálogos de sistema do banco e rodar comandos administrativos. Se `adminConnectionString` não for fornecido ao bootstrapper, ou `getAdmin()` for sobrescrito para devolver `undefined`, essas operações falham.
* **Solução:** Garanta que `adminConnectionString` esteja configurado na inicialização do bootstrapper do backend:
  ```typescript
  createPostgresBootstrapper({
      connection: db,
      schema: { tables, enums, relations },
      adminConnectionString: process.env.ADMIN_CONNECTION_STRING || process.env.DATABASE_URL
  })
  ```

## Próximos Passos

- **[Implantação](/docs/getting-started/deployment)** — Guia de implantação em produção
- **[Visão Geral do Backend](/docs/backend)** — Referência completa de configuração do backend
---
