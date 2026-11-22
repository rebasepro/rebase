---
sourceHash: 21a2078200ddc8c0
title: Ambiente e Configuração
sidebar_label: Configuração
description: Todas as variáveis de ambiente e opções de configuração para projetos Rebase.
---

## Variáveis de Ambiente

Toda a configuração é feita por meio de variáveis de ambiente no seu arquivo `.env` na raiz do projeto.

> **Importante**: O Rebase valida variáveis de ambiente com o **Zod** na inicialização. Se
> algo obrigatório estiver faltando ou malformado (uma URL que não é uma URL, uma porta que
> não é um número), o servidor recusa a inicialização e informa o nome da variável.
>
> O local onde o schema reside depende de como você executa o backend. Um projeto inicializado
> pelo runtime — `rebase dev`, `rebase start`, a imagem publicada — usa o
> schema pertencente ao runtime (`loadBootEnv` em `@rebasepro/server`), que é a
> união de todas as tabelas abaixo. Um projeto que executou [`rebase eject`](/docs/cli)
> possui um `backend/src/env.ts` chamando `loadEnv({ extend })`, e pode adicionar suas próprias
> variáveis tipadas ali.

### Obrigatórias

| Variável | Descrição | Exemplo |
|----------|-----------|---------|
| `DATABASE_URL` | String de conexão do PostgreSQL. **Opcional em desenvolvimento** — quando não definida, `rebase dev` executa um PostgreSQL gerenciado para o projeto, com seus dados sob `.rebase/`. Obrigatória em todos os outros ambientes. | `postgresql://user:pass@localhost:5432/mydb` |
| `JWT_SECRET` | Chave secreta para assinatura de tokens JWT. Use uma string aleatória forte (mínimo de 32 caracteres). **Obrigatória em produção** (gerada automaticamente em desenvolvimento). | `a1b2c3d4e5...` |

> **Em um banco de dados gerenciado, `sslmode=require` pode não significar o que diz.**
>
> Para o `psql` e qualquer ferramenta libpq, `require` significa "criptografado, certificado não
> verificado". O driver Node no qual o Rebase roda o interpreta como `verify-full`, portanto, um
> banco de dados cujo certificado não foi assinado por nenhuma autoridade pública — comum em
> Postgres gerenciados — recusa o runtime com `self-signed certificate`, enquanto o `psql`
> se conecta com a mesma URL. O runtime e os comandos `rebase db` são interrompidos com uma
> mensagem informando isso.
>
> Escolha uma opção:
>
> - **`sslmode=no-verify`** — criptografado, não verificado: o que `require` significa para a
>   libpq. É uma grafia do node-postgres que falta na libpq, portanto, `psql`, `pg_dump`
>   e Atlas a recusam com `invalid sslmode value: "no-verify"`. Os próprios comandos do Rebase
>   (`rebase db push`, `rebase db backup`, `rebase db restore`) passam isso para eles como
>   `sslmode=require`, funcionando com a URL configurada; para usar o `psql` manualmente,
>   substitua por `sslmode=require`.
> - **`sslmode=verify-full&sslrootcert=/path/to/ca.pem`** — verificado contra o certificado da CA
>   do provedor. O mesmo para qualquer ferramenta.
>
> `uselibpqcompat=true&sslmode=require`, que o próprio aviso do driver Node sugere,
> também funciona para o runtime; os comandos do Rebase removem `uselibpqcompat` antes de
> repassar a URL para as ferramentas libpq, que o rejeitam.

### Frontend

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `VITE_API_URL` | URL da API de backend para o SDK tipado. **Defina apenas em desenvolvimento** — veja abaixo. | origem da página |
| `VITE_GOOGLE_CLIENT_ID` | ID de cliente OAuth do Google. Habilita o "Entrar com o Google". | — |

> **Deixe `VITE_API_URL` não definida em builds de produção.**
>
> Em desenvolvimento, o frontend e o backend são origens separadas, portanto, o servidor
> de desenvolvimento injeta isso. Em produção, o backend do Rebase serve a SPA, portanto, a
> API é a própria origem da página e o cliente a resolve dessa forma por conta própria.
>
> Fixar uma URL absoluta em um bundle de produção funciona até o momento em que um segundo
> hostname aponta para a mesma aplicação: um domínio personalizado carrega a página a partir
> de `example.com` e chama a API em `example.rebase.website`, o que é cross-origin, fazendo
> com que cada requisição falhe no preflight. Permitir a origem no CORS **não** resolve isso — o
> cookie de atualização é `SameSite=Lax` e não é enviado cross-site, então você limparia os
> erros do console e ainda teria a autenticação quebrada. Quando não definida, qualquer domínio
> apontando para a aplicação funciona sem nenhuma configuração de CORS.

### Backend

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `PORT` | Porta para o servidor HTTP de backend. Lida por `rebase start`. O `rebase dev` a lê **apenas do ambiente do shell** — um `PORT` no `.env` não é lido lá, pois a porta é resolvida antes de esse arquivo ser carregado — e, caso contrário, vincula uma porta derivada do caminho do projeto, permitindo que vários projetos rodem ao mesmo tempo. `rebase dev --port` tem precedência sobre ambos, e o banner de inicialização informa a porta utilizada. | `3001` |
| `LOG_LEVEL` | Nível de detalhamento dos logs: `error`, `warn`, `info`, `debug` | `info` |
| `REBASE_LOG_RAW_QUERIES` | Exibe o SQL por trás de uma linha `Failed query: [redacted]`. Cada declaração com falha é redigida por padrão, porque uma consulta com falha carrega seus parâmetros vinculados — um e-mail, um hash de senha. Defina como `true` ao diagnosticar uma falha de DDL, RLS ou captura de alterações. Ignorado quando `NODE_ENV=production`. | `false` |
| `NODE_ENV` | Ambiente: `development`, `production` ou `test` | `development` |
| `CORS_ORIGINS` | Lista separada por vírgulas de origens permitidas. **Obrigatório em produção**, a menos que `FRONTEND_URL` esteja definido: uma inicialização em produção sem nenhum dos dois se recusa a iniciar. Em desenvolvimento, é *adicionado ao* localhost — veja abaixo. | — |
| `FRONTEND_URL` | URL do app frontend. Usado como alternativa ao CORS_ORIGINS, em ambos os ambientes. | — |
| `ADMIN_CONNECTION_STRING` | String de conexão do banco de dados com nível de administrador (usada para introspecção de schema e operações administrativas). O banco de dados informado não é aquele que o console SQL considera atual, nem o que uma nova branch copia por padrão: ambos são o banco de dados em que a própria conexão do app está (consulte `REBASE_BRANCH_PARENT_DATABASE` para um servidor em uma branch). | `DATABASE_URL` |
| `DISABLE_DB_ROLE_SWITCHING` | Desativa a troca de papéis do PostgreSQL no SQL Editor (útil para autenticação personalizada onde os papéis do BD não estão mapeados). O console SQL do Studio então informa que as linhas foram lidas como o proprietário da conexão, exibe seu nome e desabilita o seletor de papéis. | `false` |
| `REBASE_BRANCH_PARENT_DATABASE` | O banco de dados do qual a branch em que este servidor está rodando foi copiada. `rebase dev` o define em um checkout [alternado para uma branch](/docs/backend/branching/#cli-integration). Um servidor com ele mantém o registro de branches nesse banco de dados e copia novas branches a partir dele por padrão, de modo que o painel Branches do Studio exibe as branches do banco de dados principal. | — |

#### CORS em desenvolvimento

O desenvolvimento permite **localhost, mais o que estiver listado em `CORS_ORIGINS` (ou `FRONTEND_URL`)** — a mesma lista usada em produção, com localhost adicionado em vez de substituído. Dessa forma, a variável funciona da mesma maneira em ambos os ambientes, e os casos que precisam dela em desenvolvimento são os usuais:

```bash
# A phone on the LAN, a colleague's machine, an ngrok tunnel,
# a forwarded Codespaces port — all non-localhost origins.
CORS_ORIGINS=http://192.168.1.5:5173
```

Uma origem que não seja localhost nem esteja listada é recusada, e a recusa é
registrada em log **uma vez por origem** com a linha exata que a permitiria. A recusa não
é cautela desnecessária: a API envia credenciais, portanto, refletir um `Origin`
arbitrário permitiria que qualquer site visitado pelo desenvolvedor fizesse
requisições autenticadas contra o servidor de desenvolvimento com a sessão dele e
lesse as respostas.

### Autenticação

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `JWT_SECRET` | Segredo para assinatura de JWT (obrigatório em produção, gerado automaticamente em desenvolvimento) | — |
| `JWT_PRIVATE_KEY` | Chave privada PEM para assinar tokens de acesso assimetricamente (RS256), de modo que qualquer entidade que possua o JWKS possa verificar uma sessão sem poder emitir uma. Aceita um PEM com quebras de linha reais, um PEM com escapes `\n` ou base64 do PEM completo. Sem ela, os tokens permanecem em HS256. | — |
| `JWT_KEY_ID` | Identifica `JWT_PRIVATE_KEY` no cabeçalho do token e no JWKS. Altere-o sempre que a chave for alterada — a rotação depende da distinção entre a antiga e a nova. | `default` |
| `JWT_ACCESS_EXPIRES_IN` | Tempo de vida do token de acesso | `1h` |
| `JWT_REFRESH_EXPIRES_IN` | Tempo de vida do token de atualização (refresh token). Deslizante — cada rotação o renova, determinando quanto tempo uma sessão sobrevive à **inatividade**. Defina `400d` para sessões que sobrevivem a uma longa ausência; os navegadores limitam o cookie de atualização a esse período. | `30d` |
| `ALLOW_REGISTRATION` | Permite o registro de novos usuários (`true`/`false`). Fora de produção, o **primeiro** usuário sempre pode se registrar, independentemente desta configuração — uma tabela de usuários vazia precisa admitir alguém, e esse alguém se torna o administrador. Em produção (`NODE_ENV=production`), essa janela é fechada: uma tabela vazia recusa o registro de bootstrap com `SETUP_REQUIRED`, uma primeira conta criada por meio de registro aberto é uma conta comum, e o administrador é definido com `REBASE_ADMIN_EMAIL` abaixo ou atribuído com a chave de serviço. O `.env.example` do scaffold define como `true`; o padrão do framework é desativado. | `false` |
| `DISABLE_SELF_REGISTRATION` | Chave de desativação total (kill switch). Fecha a janela de bootstrap do primeiro usuário que `ALLOW_REGISTRATION=false` deliberadamente deixa aberta fora de produção, de modo que o registro seja bloqueado mesmo contra um banco de dados vazio. Combine com `REBASE_ADMIN_EMAIL` abaixo, caso contrário, o deployment não terá como produzir seu primeiro usuário autenticado. Todos os artefatos de deployment distribuídos o definem. | — |
| `REBASE_ADMIN_EMAIL` | E-mail da primeira conta de administrador, criada na inicialização **enquanto a tabela de usuários ainda estiver vazia** e nunca depois disso. É assim que um deployment de produção obtém seu administrador: o operador define a primeira conta em vez de disputar contra a internet. A inicialização avisa quando a tabela está vazia em produção e isso não está definido. | — |
| `REBASE_ADMIN_PASSWORD` | Senha para essa conta. Pelo menos 12 caracteres, caso contrário, é recusada e a conta não é criada. Altere-a após o primeiro login. | — |
| `MFA_ENCRYPTION_KEY` | Criptografa todos os segredos TOTP armazenados. Se não estiver definida, os segredos serão criptografados com `JWT_SECRET` e a inicialização emitirá um aviso — assim, rotacionar o `JWT_SECRET` desconecta todos *e* torna todos os autenticadores cadastrados indecifráveis. Defina uma chave dedicada (32+ caracteres aleatórios) antes que alguém se cadastre. | — |
| `MFA_ENCRYPTION_KEY_PREVIOUS` | A chave da qual se está rotacionando *para sair*. Defina ambas durante uma rotação: novos segredos são gravados com `MFA_ENCRYPTION_KEY` e os existentes ainda podem ser lidos, para que ninguém seja bloqueado de sua própria conta no meio da rotação. Remova-a assim que todos os segredos forem recriptografados. | — |
| `ALLOW_ANONYMOUS` | Habilita login anônimo (`POST /api/auth/anonymous`). Opcional (opt-in) e deliberadamente não bloqueado por `ALLOW_REGISTRATION`. | `false` |
| `AUTH_REQUIRE` | Exige autenticação para a API de dados. Defina como `false` para uma superfície de leitura totalmente pública — o RLS ainda se aplica. | `true` |
| `AUTH_DEFAULT_ROLE` | Papel atribuído a um usuário recém-registrado quando nenhum é fornecido. | — |
| `AUTH_ALLOW_USER_LOOKUP` | Monta a rota `POST /api/auth/find-user`, que resolve um e-mail para um perfil público mínimo (`uid`, `displayName`, `photoURL`) para fluxos de convite por e-mail. Apenas chamadores autenticados, e nunca retorna o e-mail, funções ou metadados do usuário encontrado. Desativado por padrão: é uma superfície de enumeração. | `false` |
| `AUTH_COOKIE_SAME_SITE` | `SameSite` no cookie de atualização: `Strict`, `Lax` ou `None`. `None` requer HTTPS e é apenas para um frontend genuinamente cross-site. | `Lax` |
| `AUTH_COOKIE_SECURE` | `Secure` no cookie de atualização. Seguro por padrão; `AUTH_COOKIE_SECURE=false` para http simples — um deployment em um endereço de LAN onde o navegador, de outra forma, descartaria o cookie e a sessão expiraria junto com o token de acesso sem erro. Um aviso é emitido na inicialização. `http://localhost` não precisa disso. | `true` |
| `GOOGLE_CLIENT_ID` | ID de cliente OAuth do Google (validação no backend) | — |
| `GOOGLE_CLIENT_SECRET` | Segredo de cliente OAuth do Google | — |
| `GITHUB_CLIENT_ID` | ID de cliente OAuth do GitHub | — |
| `GITHUB_CLIENT_SECRET` | Segredo de cliente OAuth do GitHub | — |
| `MICROSOFT_CLIENT_ID` | ID de cliente OAuth da Microsoft | — |
| `MICROSOFT_CLIENT_SECRET` | Segredo de cliente OAuth da Microsoft | — |
| `LINKEDIN_CLIENT_ID` | ID de cliente OAuth do LinkedIn | — |
| `LINKEDIN_CLIENT_SECRET` | Segredo de cliente OAuth do LinkedIn | — |
| `FACEBOOK_CLIENT_ID` | ID de cliente OAuth do Facebook | — |
| `FACEBOOK_CLIENT_SECRET` | Segredo de cliente OAuth do Facebook | — |
| `TWITTER_CLIENT_ID` | ID de cliente OAuth do X/Twitter | — |
| `TWITTER_CLIENT_SECRET` | Segredo de cliente OAuth do X/Twitter | — |
| `DISCORD_CLIENT_ID` | ID de cliente OAuth do Discord | — |
| `DISCORD_CLIENT_SECRET` | Segredo de cliente OAuth do Discord | — |
| `GITLAB_CLIENT_ID` | ID de cliente OAuth do GitLab. O `baseUrl` de uma instância auto-hospedada não possui representação por variável de ambiente — configure o GitLab no bloco `auth` para isso. | — |
| `GITLAB_CLIENT_SECRET` | Segredo de cliente OAuth do GitLab | — |
| `BITBUCKET_CLIENT_ID` | ID de cliente OAuth do Bitbucket | — |
| `BITBUCKET_CLIENT_SECRET` | Segredo de cliente OAuth do Bitbucket | — |
| `SLACK_CLIENT_ID` | ID de cliente OAuth do Slack | — |
| `SLACK_CLIENT_SECRET` | Segredo de cliente OAuth do Slack | — |
| `SPOTIFY_CLIENT_ID` | ID de cliente OAuth do Spotify | — |
| `SPOTIFY_CLIENT_SECRET` | Segredo de cliente OAuth do Spotify | — |
| `APPLE_CLIENT_ID` | Services ID da Apple, para login via web. É público e publicado em `GET /auth/config`. A Apple não possui segredo de cliente estático, pois o Rebase assina um JWT ES256 de curta duração para cada troca de token. Portanto, a Apple necessita de `APPLE_TEAM_ID`, `APPLE_KEY_ID` e `APPLE_PRIVATE_KEY`, além deste ou de `APPLE_BUNDLE_IDS`, e não configura nada sem eles. | — |
| `APPLE_BUNDLE_IDS` | IDs de bundle separados por vírgula dos aplicativos nativos para iOS/macOS cujos códigos do Sign in with Apple são aceitos. | — |
| `APPLE_TEAM_ID` | Team ID do Apple Developer, emissor do JWT. | — |
| `APPLE_KEY_ID` | Key ID da chave privada registrada na Apple. | — |
| `APPLE_PRIVATE_KEY` | Conteúdo do arquivo de chave privada `.p8`, incluindo quebras de linha (escapes `\n` são aceitos). | — |
| `REBASE_SERVICE_KEY` | Chave de API estática de administrador. Ignora a autenticação JWT normal para chamadas servidor-para-servidor quando enviada como `Authorization: Bearer <key>`. (Gerada automaticamente em desenvolvimento). | — |
| `REBASE_PLATFORM_TOKEN_KEY` | A chave pública da plataforma de hospedagem (PEM, EC P-256) contra a qual os tokens de plataforma `rpt_` são verificados; vários blocos PEM durante uma rotação de chave. A plataforma a define no deploy e ela não contém nada secreto. Juntamente com `REBASE_PLATFORM_TOKEN_AUDIENCE`, permite que a barreira de administração aceite um token de plataforma para `cron:read` e para nada mais. | — |
| `REBASE_PLATFORM_TOKEN_AUDIENCE` | O id do projeto ao qual o `aud` de um token de plataforma deve ser igual, para que um token emitido para outro projeto seja recusado. Com apenas uma das duas variáveis definida, o servidor inicia, registra um aviso e responde a cada token `rpt_` com `401 PLATFORM_TOKENS_OFF`. | — |
| `REBASE_PLATFORM_SIGNIN_URL` | Para onde vai o **Continue with Rebase Cloud** do painel de administração: a página do projeto no console da plataforma, que autentica os proprietários do projeto e retorna. A plataforma a define no deploy junto com as duas acima; com elas, `POST /api/auth/platform-signin` aceita o token `auth:admin-signin` de um minuto da plataforma e abre uma sessão de administrador. Sem ela, o acesso ainda funciona a partir do **Open CMS** do console, e a tela de login apenas explica isso. | — |
| `REBASE_RATE_LIMIT_STORE` | Onde residem os contadores de rate limit, para as rotas de autenticação e para `rateLimit` em funções customizadas: `memory` (por processo) ou `sql` (compartilhado entre réplicas). Um processo não pode ver sua própria contagem de réplicas, portanto, um deployment com pares deve declarar isso — três réplicas no padrão aplicam três vezes o limite. Qualquer outro valor **recusa a inicialização** em vez de adotar um fallback, incluindo `postgres`. | `memory` |
| `AUTH_MAGIC_LINK` | Monta o fluxo de link de autenticação sem senha (magic link). Requer um serviço de e-mail configurado, caso contrário, o link não tem para onde ir. | `false` |
| `AUTH_EMAIL_OTP` | Monta a autenticação sem senha com um código de seis dígitos enviado por e-mail. Mesma exigência de e-mail acima. | `false` |
| `AUTH_MAGIC_LINK_CREATES_USERS` | Cadastro sem senha: uma solicitação de magic link ou código por e-mail para um endereço desconhecido cria a conta, enquanto o registro estiver aberto. | `false` |
| `AUTH_REFRESH_TOKEN_REUSE` | O que um refresh token reproduzido após sua janela de reutilização faz: `reject` (recusa-o, mantém a sessão) ou `revoke-session` (encerra a sessão). Qualquer outro valor causa falha na inicialização. | `reject` |
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | Registro com confirmação prévia: nenhum login com senha até que o endereço seja verificado. Requer e-mail; a inicialização recusa sem ele. | `false` |
| `CAPTCHA_PROVIDER` | Ativa a verificação por captcha nas rotas de autenticação: `turnstile` ou `hcaptcha`. Não definido significa sem captcha. | — |
| `CAPTCHA_SECRET` | O segredo do provedor, usado no servidor para verificar o token que o navegador envia. Obrigatório quando `CAPTCHA_PROVIDER` estiver definido. | — |
| `CAPTCHA_ROUTES` | Rotas de autenticação separadas por vírgula para proteger (por exemplo, `register,login`). Não definido protege o conjunto padrão do provedor. | — |

### Armazenamento

:::caution[O armazenamento não tem segurança em nível de linha, portanto precisa de um modelo de acesso]
As tabelas são protegidas pelo RLS do Postgres. O armazenamento de objetos não tem
equivalente — as chaves compartilham um único namespace plano — portanto, com um
bucket configurado e nenhum modelo de acesso, o servidor **recusa a inicialização em produção**.
Satisfaça-o com exatamente um destes: um hook `storageAuthorize` exportado de
`backend/storage.ts` (o que o scaffold disponibiliza), `STORAGE_PUBLIC_READ` ou
`STORAGE_ALLOW_ANY_AUTHENTICATED`.
:::

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `STORAGE_TYPE` | Backend de armazenamento: `local`, `s3` ou `gcs`. Em produção, `local` desativa o armazenamento, a menos que `FORCE_LOCAL_STORAGE=true` | `local` |
| `STORAGE_PATH` | Caminho base para armazenamento local. Um caminho relativo é lido a partir do diretório em que o servidor executa: a raiz do projeto em `rebase dev`, `backend/` em um servidor gerado por `rebase eject` | `<project>/uploads` |
| `FORCE_LOCAL_STORAGE` | Permite armazenamento local em produção — somente com um volume persistente contendo `STORAGE_PATH` e os diretórios `<STORAGE_PATH>__<key>` dos buckets locais nomeados ao lado | `false` |
| `STORAGE_DOWNLOAD_TOKEN_TTL` | Segundos em que a URL de download de um arquivo privado funciona — o token que `getSignedUrl()` insere nela. No máximo `604800` (uma semana) | `300` |
| `STORAGE_MAX_FILE_SIZE` | Maior arquivo que a fonte aceita, em bytes, em cada caminho de upload — `__<KEY>` para uma fonte nomeada. Um valor que não seja um número inteiro de bytes recusa a inicialização | `52428800` (50 MB) |
| `S3_BUCKET` | Nome do bucket S3 (quando `STORAGE_TYPE=s3`) | — |
| `S3_REGION` | Região da AWS | — |
| `S3_ACCESS_KEY_ID` | Chave de acesso da AWS | — |
| `S3_SECRET_ACCESS_KEY` | Chave secreta da AWS | — |
| `S3_ENDPOINT` | Endpoint S3 personalizado (para MinIO, Cloudflare R2, etc.) | — |
| `S3_FORCE_PATH_STYLE` | Forçar URLs no formato path-style para o bucket S3 (`true`/`false`) | `false` |
| `GCS_BUCKET` | Nome do bucket GCS (quando `STORAGE_TYPE=gcs`) | — |
| `GCS_PROJECT_ID` | Projeto do GCP. Geralmente inferido das credenciais. | — |
| `GCS_KEY_FILENAME` | Caminho para um arquivo de chave de conta de serviço. Omita no GCP, onde o Workload Identity fornece as credenciais. | — |
| `STORAGE_PUBLIC_READ` | Serve todos os objetos para qualquer pessoa, sem token. Apenas para um bucket que seja genuinamente uma CDN pública. Uma das três maneiras de satisfazer a proteção de inicialização abaixo. | `false` |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Permite que qualquer chamador autenticado leia, grave, liste e exclua todos os objetos. Nomeado como `INSECURE` no objeto de configuração por um motivo: só é defensável em uma aplicação single-tenant onde todas as contas têm permissão total sobre todos os arquivos. | `false` |
| `STORAGE_RENDITION_CACHE` | Armazena em cache rendições de imagens geradas (redimensionamentos, conversões de formato) em vez de produzi-las por requisição. | `false` |

### E-mail (Opcional)
`MAGIC_LINK_URL`.

| Variável | Descrição |
|----------|-----------|
| `SMTP_HOST` | Host do servidor SMTP |
| `SMTP_PORT` | Porta do servidor SMTP |
| `SMTP_SECURE` | Habilitar conexão segura (`true`/`false`) |
| `SMTP_USER` | Usuário SMTP |
| `SMTP_PASS` | Senha SMTP |
| `SMTP_FROM` | Endereço do remetente para e-mails do sistema |
| `SMTP_NAME` | Nome de exibição no endereço do remetente |
| `APP_NAME` | Nome do produto usado nos assuntos e corpos dos e-mails (padrão: `Rebase`) |
| `EMAIL_LOGO_URL` | Logo exibido no topo dos modelos de e-mail padrão. PNG ou JPG absoluto `http(s)` — os clientes de e-mail removem SVG e bloqueiam URIs `data:`. Não definido, um app ainda chamado `Rebase` recebe a marca do Rebase e um renomeado não recebe nenhum |
| `MAGIC_LINK_URL` | Para onde aponta um magic link enviado por e-mail. Uma base recebe `/auth/magic-link?token=…` anexado; uma URL contendo `{token}` é o link completo, para um frontend que não serve `/auth/magic-link`. Coloque entre aspas no `.env`, onde um `#` sem aspas inicia um comentário: `MAGIC_LINK_URL="https://app.example.com/app.html#ml={token}"`. Um valor com hash ou caminho de arquivo e sem `{token}` emite um aviso na inicialização. Não definido, a base é `FRONTEND_URL` |

### Pool de conexões do banco de dados

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `DB_POOL_MAX` | Máximo de conexões no pool | `20` |
| `DB_POOL_IDLE_TIMEOUT` | Milissegundos em que uma conexão ociosa é mantida | `30000` |
| `DB_POOL_CONNECT_TIMEOUT` | Milissegundos de espera por uma conexão | `10000` |
| `DATABASE_DIRECT_URL` | Conexão direta (não agrupada em pool). O [Realtime](/docs/backend/realtime) precisa de uma: `LISTEN`/`NOTIFY` não sobrevive a um pooler de transação como o PgBouncer e, sem ela, notificações de alteração são desativadas com um aviso em vez de serem perdidas silenciosamente. O [job worker](/docs/backend/jobs) também mantém seu `LISTEN` de ativação nela. Preenche o `directConnectionString` do adaptador Postgres quando não estiver definido. | — |
| `DATABASE_READ_URL` | Réplica de leitura, como um hot standby. Quando aponta para outro servidor, leituras autenticadas (listas, linhas individuais, contagens, agregações) são atendidas lá sob a mesma segurança em nível de linha; gravações, login, realtime, crons, jobs, o console SQL e `rebase.sql` permanecem no primário. Um leitor que acabou de gravar lê do primário durante `REBASE_READ_STICKY_MS`, e todos o fazem enquanto a réplica estiver com atraso superior a `REBASE_READ_MAX_LAG_MS` ou com falha. Preenche o `readConnectionString` do adaptador Postgres quando não estiver definido; até a versão 0.28 (inclusive), o pool da réplica era aberto e nunca lido. | — |
| `REBASE_READ_STICKY_MS` | Após uma gravação, por quanto tempo as leituras do mesmo usuário vão para o primário, para que um salvamento seguido de uma listagem mostre a alteração. Por instância do servidor. | `5000` |
| `REBASE_READ_MAX_LAG_MS` | Atraso (lag) da réplica a partir do qual todas as leituras vão para o primário. | `1000` |
| `DATABASE_POOLED` | `true` quando `DATABASE_URL` passa por um pooler em modo de transação como o PgBouncer. O pool não envia `search_path` ou `statement_timeout` na conexão (o pooler os recusaria ou descartaria) e define ambos em cada transação; a inicialização define um `search_path` padrão de `public` para a role do banco de dados em instruções fora de uma transação. `DATABASE_DIRECT_URL` torna-se obrigatória, e realtime, a ativação do job worker, criações de índice, ramificações (branching) e o console SQL usam-na. A URL da réplica também é considerada em pool. `DATABASE_POOLED__<KEY>` para outra fonte de dados. | — |
| `REBASE_DB_POOL_MAX` | Um limite máximo para todos os pools no processo, aplicado independentemente do que cada um solicitou. Apenas dígitos puros: um valor malformado é ignorado em vez de serializar silenciosamente o servidor. | — |

### Comportamento do runtime

Lido pelo runtime — `rebase dev`, `rebase start` e a imagem de servidor publicada.
Um projeto que foi ejetado controla essas decisões em seu próprio código.

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `REBASE_RLS_AUDIT` | `true` executa a [auditoria agendada de segurança em nível de linha](/docs/rls-check#running-it-on-a-schedule), que relata tabelas servidas sem políticas. O projeto deve declarar `@rebasepro/rls-check` entre suas dependências: o runtime não inclui uma cópia e, sem o pacote, a inicialização é recusada, informando o nome dele. `false` mantém a verificação desativada neste processo. | — |
| `REBASE_RLS_REQUEST_ROLE` | O papel (role) do Postgres sob o qual requisições autenticadas e anônimas são executadas. Atribua a cada projeto em um cluster compartilhado o seu próprio. Um banco de dados registra o papel sob o qual roda, e uma inicialização configurada para outro se recusa a iniciar até que `rebase db request-role migrate` o migre. Consulte [Executando em um banco de dados existente ou compartilhado](/docs/deployment/existing-database/). | `rebase_user` |
| `REBASE_RLS_PROVISION_ROLE` | `auto` cria o papel da requisição e permite que a conexão alterne para ele; `never` deixa ambos a seu encargo e apenas os verifica. | `auto` |
| `REBASE_RLS_GRANTS` | O que o Rebase concede ao papel da requisição: `schema` (todas as tabelas nos schemas que ele serve, mais privilégios padrão), `managed` (apenas as tabelas que ele serve) ou `none`. | `schema` |
| `REBASE_RLS_POLICY_TARGET` | `requestRole` restringe as políticas permissivas do Rebase ao(s) papel(is) de requisição, de modo que outros papéis que leiam as mesmas tabelas não recebam nada delas. | `public` |
| `REBASE_RLS_ADMIN_POLICIES` | `public` grava as políticas que apenas o contexto do servidor ou um administrador podem satisfazer `TO public`, e executa administradores com o papel da requisição. Por padrão, elas são `TO rebase_admin`, para que leituras no escopo do proprietário por usuários autenticados possam usar o índice do proprietário. Consulte [Requisições administrativas e `rebase_admin`](/docs/deployment/existing-database/#admin-requests-and-rebase_admin). | `adminRole` |
| `REBASE_RLS_DEFAULT_POLICIES` | `false` remove a política básica de servidor-ou-administrador de todas as tabelas. | `true` |
| `REBASE_RLS_IDENTITY` | `supabase` também define `request.jwt.claims` e `request.jwt.claim.*`, para que políticas escritas com `auth.uid()` vejam o chamador. | `rebase` |
| `REBASE_RLS_SHARED_ROLE` | O que a inicialização faz quando outro login pode alternar para o papel da requisição: `warn`, `refuse` ou `ignore`. | `warn` |
| `REBASE_BASE_PATH` | Caminho base para todas as rotas da API. O cliente deve ser configurado com o mesmo valor — veja [Alterando `basePath`](#alterando-o-basepath). | `/api` |
| `REBASE_SERVE_STATIC` | Serve os assets estáticos/de administração do bundle a partir deste processo. Desative quando houver uma CDN à frente. | `true` |
| `REBASE_STUDIO` | Serve o console standalone integrado do Rebase Studio em `/_studio` quando um bundle estático do Studio estiver disponível. Defina como `false` para desativar. | `true` |
| `REBASE_STUDIO_DIR` | Diretório contendo a SPA pré-compilada standalone do Rebase Studio servida em `/_studio`. O padrão é `/studio` na imagem de container. | `/studio` |
| `REBASE_HISTORY` | Registra o [histórico de alterações de entidades](/docs/backend/history). | `true` |
| `REBASE_COMPRESSION` | Respostas comprimidas com gzip/brotli. | `true` |
| `REBASE_PUSH` | `true` ativa [notificações push](/docs/backend/push-notifications/): as rotas `/api/push`, a tabela `rebase.push_subscriptions` e `rebase.push`. | `false` |
| `REBASE_VAPID_PUBLIC_KEY`, `REBASE_VAPID_PRIVATE_KEY` | O par de chaves VAPID com o qual as mensagens push são assinadas. Fora de produção, um par é gerado e mantido em `.rebase-dev-secrets.json` quando não definido; em produção, o push permanece desativado sem elas. | — |
| `REBASE_VAPID_SUBJECT` | Um endereço `mailto:` ou URL `https://` que os serviços de push podem contatar. O padrão é a origem de um `REBASE_PUBLIC_URL` em `https`. | — |
| `REBASE_MAX_BODY_SIZE` | Tamanho máximo do corpo da requisição, **em bytes** (`10485760`, não `10MB` — um valor que não seja numérico recusa a inicialização em vez de remover silenciosamente o limite). `0` desativa o limite. | `10485760` (10 MiB) |
| `REBASE_ENABLE_SWAGGER` | A superfície OpenAPI. Tri-estado. Não definido, em qualquer ambiente: `/api/docs` é servido aos chamadores para os quais `GET /api/schema/tables` descreve tabelas, cada um recebendo o documento das tabelas descritas, e não há interface Swagger UI. `true` publica o documento inteiro para todos, com a Swagger **UI** em `/api/swagger` fora de produção (nunca em produção). `false` mantém o documento protegido pela autenticação de administrador. | — |
| `REBASE_METRICS` | Expõe métricas do Prometheus em `/metrics`. | `false` |
| `REBASE_HSTS_INCLUDE_SUBDOMAINS` | Adiciona `includeSubDomains` ao cabeçalho `Strict-Transport-Security`, fazendo com que os navegadores recusem HTTP simples em todos os subdomínios do host por seis meses — incluindo hosts não servidos por este processo. Ative somente quando todos os subdomínios do domínio forem exclusivos para HTTPS. Qualquer valor diferente de `true`/`false` recusa a inicialização. Consulte [Cabeçalhos de segurança](/docs/deployment/self-hosting/#security-headers). | `false` |
| `REBASE_METRICS_TOKEN` | Token Bearer protegendo `/metrics`. Não definido deixa o endpoint aberto a qualquer um que alcance a porta — adequado em uma rede privada, inadequado em uma rede pública, e os logs de inicialização alertam sobre isso. | — |
| `REBASE_MIGRATE_ON_BOOT` | O que o runtime pode fazer com o schema das tabelas na inicialização. `ensure` (o padrão, em todos os lugares — inclusive produção) executa a passagem **aditiva**: cria tabelas, colunas e tipos enum ausentes, nunca descartando ou reescrevendo nada. `none` mantém intacto o schema das tabelas declaradas, mas as tabelas do próprio framework (autenticação, chaves de API, jobs, cron) ainda são criadas e mantidas atualizadas; `REBASE_PROVISION=false` desativa essas também. A imagem publicada aceita apenas essas duas opções e **recusa a inicialização com `push`**. Em um [deployment dividido](/docs/deployment/split-processes), exatamente um processo pode provisionar, portanto, qualquer outra função deve definir `none` ou terá sua inicialização recusada. | `ensure` |
| `REBASE_PROVISION` | `false` faz com que o runtime não altere nada no banco de dados: nenhuma tabela, coluna, índice, função, trigger, política, role ou concessão (grant), na inicialização ou posteriormente, incluindo os do próprio framework. Em vez disso, ele relata nominalmente o que estiver ausente. Para um banco de dados que só pode ser alterado pelo seu processo de mudanças. Consulte [Quando apenas seu processo de mudanças pode alterar o banco de dados](/docs/deployment/self-hosting/#when-only-your-change-process-may-change-the-database). Apenas `true` e `false` são aceitos. | `true` |
| `REBASE_REQUIRE_SCHEMA_MATCH` | Recusa a inicialização quando o banco de dados foi provisionado pela última vez a partir de um conjunto de tabelas diferente daquele com o qual este processo foi construído. Não definido (ou qualquer valor diferente de `true`/`1`) apenas emite um aviso. | warn |
| `REBASE_REQUIRE_FILES_LOADED` | Recusa a inicialização quando um arquivo de função ou cron lança um erro ou falha no parse durante a importação, indicando cada arquivo e o motivo, para que um deploy gradual (rolling deploy) mantenha a versão antiga em execução. Um reinício também é submetido a isso. Não definido (ou qualquer valor diferente de `true`) pula o arquivo e serve o restante. Um arquivo que é importado sem erros e não exporta nenhuma função ou job é sempre ignorado, não recusado. | skip |
| `REALTIME_CDC` | Captura de alterações no nível do banco de dados (CDC): `auto` (lê alterações do WAL onde o banco de dados permitir, senão usa triggers, senão faz fallback para o nível de aplicação, registrando cada fallback como info), `trigger` (força o uso de triggers, avisa se impossível), `wal` (lê alterações do log de gravação antecipada/write-ahead log em vez de triggers; requer `wal_level=logical` e uma role com permissão de replicação, caso contrário faz fallback para `trigger`), `off`. Consulte [Realtime](/docs/backend/realtime-cdc/). Tem precedência sobre `realtime.cdc`. | `auto` |
| `REALTIME_CHANNEL_BUS` | Transporte entre instâncias para canais de broadcast e presença: `memory` ou `postgres`. Ignorado quando `realtime.bus` receber um transporte construído. | `memory` |
| `REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET` | Quantas inscrições um socket de realtime pode manter; a próxima é recusada com `TOO_MANY_SUBSCRIPTIONS`. Um número inteiro positivo — qualquer outro valor interrompe o servidor na inicialização. Tem precedência sobre `realtime.maxSubscriptionsPerSocket`. Consulte [Realtime](/docs/backend/realtime#what-a-write-costs-and-the-limits). | `1000` |
| `REALTIME_MAX_SOCKETS_PER_USER` | Quantos sockets de realtime um usuário, ou uma chave de API, pode manter abertos em uma instância do servidor. Sockets de impersonação de um administrador contam contra o administrador. O login do próximo é recusado com `TOO_MANY_SOCKETS` e o socket é fechado (4002); o SDK continua tentando novamente, conectando-se assim que outro for fechado. Um número inteiro positivo — qualquer outro valor interrompe o servidor na inicialização. Tem precedência sobre `realtime.maxSocketsPerUser`. | Sem limite |
| `REALTIME_REFETCH_MAX_WAIT_MS` | O tempo máximo que uma alteração espera pela nova busca (refetch) que a entrega aos inscritos ativos, em ms. Um refetch aguarda 300 ms sem nenhuma alteração, e no máximo este tempo sob um fluxo constante de gravações. Um número inteiro positivo — qualquer outro valor interrompe o servidor na inicialização. Tem precedência sobre `realtime.refetchMaxWaitMs`. | `1000` |
| `REALTIME_RECOUNT_INTERVAL_MS` | Por quanto tempo o total de uma inscrição de lista grande pode ser reutilizado antes de ser contado novamente, em ms; frames que o reutilizam trazem `meta.totalAsOf`. Não definido, cada frame faz uma nova contagem. Tem precedência sobre `realtime.recountIntervalMs`. | Não definido |
| `REALTIME_RECOUNT_MIN_ROWS` | A menor contagem total anterior à qual `REALTIME_RECOUNT_INTERVAL_MS` se aplica; listas menores são contadas a cada frame. Tem precedência sobre `realtime.recountMinRows`. | `100000` |
| `ALLOW_LOCALHOST_IN_PRODUCTION` | Permite valores de `localhost`/loopback sob `NODE_ENV=production`. Desativado, para que uma inicialização de produção falhe ruidosamente em vez de se conectar a um banco de dados inexistente. | `false` |
| `REBASE_PROVISION_ONLY` | `1`/`true` executa a passagem de schema e encerra sem abrir um socket — o formato exigido por um Job de migração, a partir da mesma imagem e do mesmo bundle que o servidor que o sucede. Também cria as tabelas que um processo servidor criaria no primeiro uso e não inicia nenhuma fila de cron ou jobs. Um valor vazio é considerado *não definido*, para que um `${SOMETHING}` não substituído em um arquivo compose não transforme um deploy comum em um que migra e se recusa a servir. Recusado em conjunto com `REBASE_PROVISION=false`. | — |
| `REBASE_PROVISION_SQL_OUT` | Um caminho de arquivo. Uma execução de provisionamento (`REBASE_PROVISION_ONLY=true`) grava nela todas as alterações de schema realizadas, em ordem, como um script SQL para revisão e aplicação com `psql`. As linhas gravadas não são incluídas. Recusado em um processo que serve requisições. | — |
| `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` | `true` permite que uma máquina — um agente, um job de CI — *aplique* uma alteração de schema por meio de `/api/admin/schema`, não apenas planeje uma. Desativado a menos que solicitado: a credencial que faria tal alteração é a mais propensa a estar armazenada em uma variável de CI. | `false` |
| `REBASE_FUNCTIONS_TIMEOUT_MS` | Por quanto tempo uma função customizada pode executar antes que sua requisição seja abortada. O mesmo controle que a opção `functionsTimeoutMs`. `0` desativa. Uma função que declara seu próprio tempo (`defineFunction(…, { timeoutMs })`) usa o seu valor. | `30000` |
| `REBASE_FUNCTIONS_MAX_TIMEOUT_MS` | O maior tempo limite que uma função pode declarar para si mesma com `defineFunction(…, { timeoutMs })`, em ms; uma função que solicite mais recebe este valor. Um número positivo; qualquer outra coisa é interpretada como não definida. | `300000` |
| `REBASE_EXIT_ON_UNHANDLED_REJECTION` | `true` faz com que uma rejeição de promise não tratada finalize o processo em vez de registrá-la em log. Ativado sob um orquestrador que o reiniciará; desativado onde uma reinicialização for pior do que um vazamento (leak). | `false` |
| `REBASE_CRON_ALWAYS_ON` | Silencia o aviso de inicialização em uma plataforma que o runtime detecta como escala-até-zero (scale-to-zero), onde um timer que dispara em uma instância ociosa não dispara em nenhuma instância. Não altera mais nada: ative-o quando você mantiver pelo menos uma instância sempre em execução. | — |
| `TRUSTED_PROXY_HOPS` | Quantos proxies estão à frente deste servidor, para que o limitador de taxa (rate limiter) possa ler o endereço real do cliente a partir de `X-Forwarded-For`. Padrão à prova de falhas `0`: sem nenhum proxy, confiar no cabeçalho permitiria que qualquer chamador forjasse uma identidade. | `0` |

:::note[O provisionamento na inicialização é aditivo e não é uma ferramenta de migração]
A passagem de inicialização é executada sem intervenção humana e sem ninguém analisando
um diff, portanto, ela nunca removerá uma coluna, restringirá um tipo ou reescreverá uma tabela.
É por isso também que a imagem recusa `REBASE_MIGRATE_ON_BOOT=push`: um push completo calcula
um diff e executará `DROP COLUMN` sem hesitar, e a reinicialização de um container nunca
deve ser capaz de destruir uma coluna de produção como efeito colateral de um reagendamento.

Alterações destrutivas ou de reformulação permanecem onde possam ser revisadas: `rebase db
generate` + `rebase db migrate`, ou `rebase db push` a partir de um checkout ou CI,
que executa um teste preliminar (dry-run) da alteração, recusa as destrutivas sem confirmação e
pode fazer um backup antes.
:::

### Deployments divididos

Uma única imagem e um único bundle podem ser inicializados várias vezes, cada um servindo
uma parte diferente do projeto. Uma linha para cada uma aqui, pois esta página lista todas
as variáveis; o que cada combinação *monta e possui* — e quais combinações recusam a inicialização —
está em **[Processos Divididos](/docs/deployment/split-processes)**.

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `REBASE_ROLE` | Qual parte este processo serve: `all`, `api`, `functions` ou `worker`. | `all` |
| `REBASE_CRON_SCHEDULER` | Sobrescreve se *este* processo executa os timers de cron. Não definido segue o papel (`role`). | — |
| `REBASE_JOB_WORKERS` | Sobrescreve se este processo executa os workers de fila de jobs. Não definido segue o papel (`role`). | — |
| `REBASE_FUNCTIONS_ONLY` | Serve apenas as funções customizadas nomeadas neste processo. | — |
| `REBASE_FUNCTIONS_EXCLUDE` | Serve todas as funções customizadas, exceto as nomeadas. | — |
| `REBASE_FUNCTIONS_UPSTREAM` | Para onde o processo da API encaminha uma solicitação de função que ele próprio não atende. Em um `worker`, para onde vão suas próprias chamadas `rebase.functions`. Uma URL `http(s)`. | — |

### Superfície MCP

Um endpoint opcional (opt-in) do Model Context Protocol em `/mcp`, para que um cliente
de IA possa ler e gravar neste projeto **como o usuário autenticado**. Desativado a menos
que configurado e — ao contrário de qualquer outra superfície — nenhum `REBASE_ROLE` o
ativa: os outros descrevem a forma do processo, enquanto este é uma decisão de conceder
credenciais a software de terceiros, e deve ser tomada por uma pessoa em vez de herdada
da atribuição de um container.

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `REBASE_MCP_ENABLED` | Monta a superfície MCP. Requer `REBASE_PUBLIC_URL`; sem ela, a superfície recusa a montagem e informa isso no log de inicialização. | `false` |
| `REBASE_PUBLIC_URL` | A origem acessível externamente desta implantação, por exemplo, `https://app.example.com`. A superfície MCP não pode derivá-la — obter a origem a partir do cabeçalho `Host` tornaria a identidade do emissor, e a audiência contra a qual seus próprios tokens são verificados, um valor fornecido pelo chamador. | — |
| `REBASE_MCP_VIEW` | Caminho para a própria visualização MCP App do projeto (`rebase-view.html`, gerada por `rebaseMcpViewPlugin()`), servida ao Claude no lugar da visualização genérica para que suas visualizações, campos e ações personalizados sejam o que ele renderiza. Sem isso, o backend procura ao lado do frontend que ele serve. | — |
| `REBASE_MCP_OPEN_REGISTRATION` | Permite o registro dinâmico de clientes OAuth (RFC 7591), para que um cliente possa se inscrever sozinho. Defina como `false` para exigir que os clientes sejam registrados previamente. | `true` |

### Edição dinâmica de schema a partir de um bundle

Desativada a menos que `REBASE_LIVE_SCHEMA_REPOSITORY` esteja definido. Um bundle compilado
não possui o código-fonte de `backend/schema` para editar, portanto, com essas variáveis
definidas, o editor de schema lê o código-fonte a partir do repositório, faz o commit de cada
alteração de volta e executa seu DDL neste banco de dados. Exclusivo para administradores e
aplicado por uma pessoa, a menos que `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` declare o contrário.
Um repositório nomeado sem nenhuma credencial utilizável recusa a inicialização. Consulte
[Edição dinâmica de schema](/docs/backend/live-schema-editing#from-a-built-bundle).

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `REBASE_LIVE_SCHEMA_REPOSITORY` | O repositório do GitHub no qual fazer o commit das alterações de schema, no formato `proprietario/nome`. Defini-lo é o que ativa o recurso. | — |
| `REBASE_LIVE_SCHEMA_BRANCH` | A branch na qual o commit é aplicado. | `main` |
| `REBASE_LIVE_SCHEMA_PATH` | Onde `backend/schema` reside nesse repositório, relativo à raiz do repositório. Um caminho que saia do repositório recusa a inicialização, assim como o descontinuado `REBASE_LIVE_SCHEMA_COLLECTIONS_PATH`. | `backend/schema` |
| `REBASE_LIVE_SCHEMA_GITHUB_TOKEN` | Um token granular com acesso de leitura e gravação ao conteúdo do repositório. Defina esta variável ou as três variáveis `_GITHUB_APP_*`, não ambas. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_ID` | O ID de um GitHub App, para realizar o commit como o aplicativo em vez de usar um token. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_INSTALLATION_ID` | A instalação do aplicativo no repositório. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_PRIVATE_KEY` | A chave privada do aplicativo: PEM, PEM com quebras de linha escapadas ou base64. | — |

### Backups

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `BACKUP_SCHEDULE` | Expressão cron para backups agendados. Não definido significa que backups agendados estão desativados. | — |
| `BACKUP_DESTINATION` | Caminho local ou uma URL `s3://bucket/prefix` / `gs://bucket/prefix`. Obrigatório com `BACKUP_SCHEDULE`, que se recusa a executar sem ele. `rebase db backup` usa `./backups` como fallback onde foi executado. | — |
| `BACKUP_RETENTION_DAYS` | Exclui backups com mais de N dias. Não definido ou `0` mantém tudo. | — |
| `BACKUP_KEEP_MINIMUM` | Sempre retém pelo menos N dos backups mais recentes, independentemente do que a retenção definir. | — |
| `PG_DUMP_PATH` | Sobrescreve o binário `pg_dump` — deve ser a versão principal do servidor ou mais recente. | — |
| `PG_RESTORE_PATH` | Sobrescreve o binário `pg_restore`. | — |
| `PSQL_PATH` | Sobrescreve o binário `psql` que `rebase db restore --clean` executa para tornar a restauração uma única transação. | — |
| `PG_DUMPALL_PATH` | Onde reside o `pg_dumpall`, quando não estiver no `PATH`. Sem ele — e sem as ferramentas de cliente do PostgreSQL instaladas — o backup global falha com um erro indicando esta variável. | — |

A imagem oficial de runtime (`rebasepro/server`) inclui as ferramentas de cliente do
PostgreSQL 18, de modo que um backup agendado é executado nela contra qualquer servidor
até o Postgres 18. Fora da imagem, instale-as você mesmo (`apt-get install postgresql-client-18`,
`brew install libpq`).

Backups contêm segredos e dados pessoais (PII). Use um destino privado com
criptografia em repouso.

### Entrega de bundle

Um deployment gerenciado não carrega seu código na imagem: o runtime busca um
bundle na inicialização. Estas variáveis decidem qual e como.

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `REBASE_BUNDLE` | Caminho para um diretório de bundle já extraído. O que o `rebase start` define localmente. | — |
| `REBASE_BUNDLE_URL` | De onde buscar o arquivo do bundle, quando não houver um local. | — |
| `REBASE_BUNDLE_TOKEN` | A credencial Bearer para essa busca. Trate-a como um segredo: é o que autoriza um tenant a baixar seu próprio código. | — |
| `REBASE_BUNDLE_FETCH_DIR` | Onde um bundle buscado é extraído. Deve ter permissão de escrita e persistir entre a busca e a inicialização. | — |
| `REBASE_RUNTIME_MODULES` | Módulos extras que a imagem de runtime fornece ao bundle, além daqueles que ele próprio declara. | — |

### Vinculações de recursos

Cada banco de dados, bucket e tópico declarado por um projeto em `backend/resources.ts` é
vinculado por variáveis de ambiente com nomes baseados nele. Os nomes base estão abaixo; um
recurso não padrão anexa `__` e sua chave em letras maiúsculas, portanto, um bucket chamado
`media` lê `S3_BUCKET__MEDIA`. O comando `rebase status` exibe, para cada recurso,
a variável exata que está sendo lida e se ela está definida.

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `REBASE_DRIVER` | O pacote npm que implementa o driver de uma fonte de dados, quando não for o padrão do Postgres. Sufixado por fonte: `REBASE_DRIVER__ANALYTICS`. | — |
| `REBASE_TOPIC_URL` | A string de conexão para um tópico declarado. Sufixado por tópico. | — |

### O ambiente da própria CLI

Lido pelo `rebase`, não pelo servidor. Nada aqui afeta um deployment.

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `REBASE_BASE_URL` | Para onde `rebase api-keys`, `rebase storage` e `rebase auth reset-password` enviam a chave de serviço, no shell ou no `.env`. Defina quando o servidor rodar de outra forma que não seja `rebase dev` neste projeto: `rebase start`, um container, outro host. Não definido, eles usam o servidor gravado pelo `rebase dev` enquanto esse servidor estiver rodando, e não enviam nada quando não estiver. | — |
| `REBASE_SERVICE_KEY` | A chave de serviço com a qual esses comandos se autenticam, lida do `.env`: a mesma variável que o servidor lê (veja acima). | — |
| `SERVICE_KEY` | Um nome antigo para essa chave. Quando o `.env` a define, `rebase api-keys` e `rebase storage` a leem em vez de `REBASE_SERVICE_KEY`. | — |
| `REBASE_ENV_FILE_PATH` | Qual arquivo `.env` a CLI lê e grava, quando não for o do projeto. | — |
| `REBASE_ROOT_RULES` | `0` impede que `rebase init` e `rebase skills install` gravem as regras do projeto nos arquivos `CLAUDE.md` e `AGENTS.md` na raiz do repositório, para uma raiz cujos arquivos de agentes você mantém manualmente. | on |
| `REBASE_CLOUD_URL` | O plano de controle com o qual o `rebase cloud` se comunica. | — |
| `REBASE_CLOUD_EMAIL` | A conta com a qual o `rebase cloud login` se autentica, em vez de solicitar interação. | — |
| `REBASE_CLOUD_PASSWORD` | Sua senha, para que um cofre de segredos possa fornecê-la sem que ela fique registrada no histórico do shell. | — |
| `REBASE_TOKEN` | Um token gerado por `rebase cloud tokens create`. Quando definido, qualquer comando `rebase cloud` se autentica com ele em vez da sessão de `rebase cloud login`, e nunca lê ou grava a sessão armazenada. Em um diretório vinculado por `rebase cloud init --claim`, ele é reservado para o próprio token daquele projeto quando não possui escopo no projeto. A forma de executar o `rebase cloud` em CI — consulte [CI e agentes](/docs/deployment/cloud/#ci-and-agents). O [servidor MCP](/docs/ai/mcp/) o repassa para a CLI que suas ferramentas de nuvem inicializam e nunca o envia para a aplicação: defina `REBASE_API_TOKEN` para isso. | — |
| `REBASE_DEBUG` | `1` exibe o erro subjacente e os detalhes da requisição em vez da mensagem curta. A primeira coisa a definir quando um comando `rebase cloud` falhar sem detalhes úteis. | — |
| `REBASE_ATLAS_DEV_URL` | O banco de dados vazio contra o qual `rebase db push`, `db generate` e `db migrate` planejam alterações, em vez do `<db>_dev_diff` que eles criam ao lado de `DATABASE_URL`. O Rebase não cria nem descarta um banco de dados especificado aqui e recusa um que seja igual a `DATABASE_URL`. No banco de dados gerenciado de desenvolvimento, a CLI o define para um PGlite temporário em memória próprio. Defina onde `CREATE DATABASE` não for concedido. | `<db>_dev_diff` |
| `REBASE_DEV_NO_DB` | `rebase dev` não inicia nenhum banco de dados e não provisiona nada — você fornece o seu próprio. O mesmo que `--no-db`. | — |
| `REBASE_FRONTEND_PORT` | Fixa a porta do servidor de desenvolvimento frontend, que de outra forma o `rebase dev` deriva do caminho do projeto. | — |
| `REBASE_DEV_READY_TIMEOUT_MS` | Quanto tempo o `rebase dev` espera pelo anúncio do backend antes de informar que ele não iniciou. `0` desativa o relatório. | `30000` |
| `DATABASE_PASSWORD` | A senha que `rebase dev --docker` insere na string de conexão derivada do `docker-compose.yml`. | — |
| `DO_NOT_TRACK` | A convenção entre ferramentas. Defina com qualquer valor diferente de `0` e a CLI não enviará telemetria. | — |
| `REBASE_TELEMETRY_DISABLED` | O mesmo, especificamente para o Rebase. Não requer arquivo, motivo pelo qual é o indicado para uso em CI e em imagens. | — |
| `REBASE_TELEMETRY_ENDPOINT` | Para onde a telemetria é enviada, no caso de um coletor auto-hospedado. | — |

## Segredos em desenvolvimento

`JWT_SECRET` é obrigatório em produção. Ele e `REBASE_SERVICE_KEY` são
gerados para você fora dela, para que você possa começar sem precisar configurar nada.

Esses valores gerados ficam armazenados em cache em `.rebase-dev-secrets.json`, ao lado
de `.rebase-dev-port` e `.rebase-dev-url` e ignorados pelo git juntamente com eles. Anteriormente,
eles eram gerados novamente a cada inicialização — fazendo com que reiniciar o servidor de
desenvolvimento desconectasse você do seu próprio app e invalidasse qualquer chave de API recém-criada.

- Defina qualquer uma das variáveis explicitamente e a sua será usada; nada é armazenado em cache ou lido.
- Aponte o cache para outro local com `REBASE_DEV_SECRETS_FILE` — um caminho, e a
  única variável nesta seção que você definiria deliberadamente.
- Exclua o arquivo para renovar ambos os segredos. A próxima inicialização gravará um novo.
- Se o arquivo não puder ser gravado — em um container somente leitura, por exemplo —, o servidor inicia
  mesmo assim com um segredo efêmero, exatamente como costumava fazer.

Nada é armazenado em cache em produção ou sob um executor de testes (test runner). Em produção
nada é gerado: uma inicialização sem `JWT_SECRET` falha, indicando o nome da variável, e
isso permanece inalterado:

```
The environment is not valid:
  JWT_SECRET: is required
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
    schemaDir: "./schema",     // The backend/schema directory: the tables, and what the schema editor writes
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

    enableSwagger: true,     // Publish the whole OpenAPI document at /api/docs to everyone

    logging: {
        level: "info"
    }
});
```

As mesmas opções, sem `app`, `server` e `basePath` e com um `provision` obrigatório,
constroem um backend que não serve nada até que você o monte: `createRebaseBackend`. Consulte
[Integração de Servidor Customizado](/docs/backend/custom-server/).

### Alterando o `basePath`

`basePath` move todas as rotas da API, portanto, o cliente deve ser configurado da mesma
forma — caso contrário, ele continuará solicitando `/api/...` e receberá um 404 para tudo:

```typescript
import { createRebaseClient } from "@rebasepro/client";

export const rebase = createRebaseClient({
    baseUrl: "https://api.example.com",
    apiPath: "/v1"          // must match the backend's basePath
});
```

O painel de administração obtém isso do cliente fornecido a ele; nada mais precisa
ser configurado. Se você construir uma URL de requisição manualmente, concatene-a a partir
do cliente em vez de escrever `/api` você mesmo:

```typescript
import { useApiBase } from "@rebasepro/app";

function Widget() {
    const apiBase = useApiBase();   // e.g. "https://api.example.com/v1"
    // fetch(`${apiBase}/data/products`)
}
```

## Solução de Problemas

### Permissão Negada no SQL Editor (`permission denied for table <name>`)

* **Sintomas:** Consultas personalizadas executadas no editor SQL do Rebase Studio falham com `cause: error: permission denied for table <name>`, embora a visualização de planilha do CMS carregue os dados com sucesso.
* **Causa:** Por padrão, o Rebase tenta executar consultas no SQL Editor alternando temporariamente os papéis do banco de dados para corresponder ao papel do usuário ativo na aplicação (por exemplo, `SET LOCAL ROLE "admin"`). Se você estiver usando autenticação personalizada onde os papéis existem apenas em tabelas do banco de dados e não como papéis reais do PostgreSQL, a troca de papéis falha ou privilégios de banco de dados ficam ausentes. A visualização de planilha do CMS é executada sob o usuário padrão proprietário da conexão e ignora isso.
* **Solução:** Adicione `DISABLE_DB_ROLE_SWITCHING=true` à configuração `.env` do seu backend. Isso força o Rebase a executar consultas do SQL Editor usando os privilégios do proprietário da conexão (geralmente um superusuário/owner). O SQL Editor passa a indicar, acima dos resultados, que eles foram lidos como o proprietário da conexão e desabilita o seletor de papéis.

### Falha na Obtenção de Schema no SQL Editor (`Cross-database execution requires adminConnectionString`)

* **Sintomas:** O Studio falha ao carregar a árvore de schemas, ou o SQL Editor lança o erro `Failed to fetch schema: Cross-database execution requires adminConnectionString to be configured in the backend.`
* **Causa:** O Rebase requer privilégios administrativos para consultar os catálogos do sistema do banco de dados e executar comandos administrativos. Se `adminConnectionString` não for fornecido ao bootstrapper, ou se `getAdmin()` for sobrescrito para retornar `undefined`, essas operações falham.
* **Solução:** Certifique-se de que `adminConnectionString` esteja configurado durante a inicialização do bootstrapper do backend:
  ```typescript
  createPostgresBootstrapper({
      connection: db,
      schema: { tables, enums, relations },
      adminConnectionString: process.env.ADMIN_CONNECTION_STRING || process.env.DATABASE_URL
  })
  ```

## Próximos Passos

- **[Deploy](/docs/getting-started/deployment)** — Guia de implantação em produção
- **[Visão Geral do Backend](/docs/backend)** — Referência completa de configuração do backend
