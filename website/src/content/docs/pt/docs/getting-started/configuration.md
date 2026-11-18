---
sourceHash: 807148298d75dcf8
title: Ambiente & Configuração
sidebar_label: Configuração
description: Todas as variáveis de ambiente e opções de configuração para projetos Rebase.
---

## Variáveis de Ambiente

Toda a configuração é feita por meio de variáveis de ambiente no arquivo `.env` na raiz do projeto.

> **Importante**: O Rebase valida variáveis de ambiente com o **Zod** na inicialização. Se
> algo obrigatório estiver ausente ou malformado (uma URL que não é uma URL, uma porta que
> não é um número), o servidor se recusa a inicializar e indica o nome da variável.
>
> O local onde o schema reside depende de como você executa o backend. Um projeto inicializado
> pelo runtime — `rebase dev`, `rebase start`, a imagem publicada — usa o
> schema de propriedade do runtime (`loadBootEnv` em `@rebasepro/server`), que é a
> união de todas as tabelas abaixo. Um projeto que executou [`rebase eject`](/docs/cli)
> possui um `backend/src/env.ts` chamando `loadEnv({ extend })`, e pode adicionar suas próprias
> variáveis tipadas ali.

### Obrigatórias

| Variável | Descrição | Exemplo |
|----------|-----------|---------|
| `DATABASE_URL` | String de conexão do PostgreSQL. **Opcional em desenvolvimento** — se não definida, o `rebase dev` executa um PostgreSQL gerenciado para o projeto, com seus dados sob `.rebase/`. Obrigatória em todos os outros ambientes. | `postgresql://user:pass@localhost:5432/mydb` |
| `JWT_SECRET` | Chave secreta para assinatura de tokens JWT. Use uma string aleatória forte (mín. 32 caracteres). **Obrigatória em produção** (gerada automaticamente em desenvolvimento). | `a1b2c3d4e5...` |

> **Em um banco de dados gerenciado, `sslmode=require` pode não significar o que parece.**
>
> Para o `psql` e todas as ferramentas baseadas em libpq, `require` significa "criptografado, certificado não
> verificado". O driver Node no qual o Rebase é executado o interpreta como `verify-full`, portanto, um
> banco de dados cujo certificado não foi assinado por nenhuma autoridade pública — comum em instâncias gerenciadas do
> Postgres — recusa o runtime com `self-signed certificate`, enquanto o `psql`
> se conecta com a mesma URL. O runtime e os comandos `rebase db` são interrompidos com uma
> mensagem informando isso.
>
> Escolha uma opção:
>
> - **`sslmode=no-verify`** — criptografado, não verificado: o que `require` significa para a
>   libpq. É uma sintaxe do node-postgres inexistente na libpq, portanto `psql`, `pg_dump`
>   e Atlas a recusam com `invalid sslmode value: "no-verify"`. Os próprios comandos do Rebase
>   (`rebase db push`, `rebase db backup`, `rebase db restore`) a repassam
>   como `sslmode=require`, funcionando com a URL configurada; para
>   usar o `psql` manualmente, substitua por `sslmode=require`.
> - **`sslmode=verify-full&sslrootcert=/path/to/ca.pem`** — verificado contra o
>   certificado da CA do provedor. O mesmo para todas as ferramentas.
>
> `uselibpqcompat=true&sslmode=require`, sugerido pelo próprio aviso do driver Node,
> também funciona no runtime; os comandos do Rebase removem `uselibpqcompat`
> antes de passar a URL para as ferramentas da libpq, que o rejeitam.

### Frontend

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `VITE_API_URL` | URL da API do backend para o SDK tipado. **Defina apenas em desenvolvimento** — veja abaixo. | origem da página |
| `VITE_GOOGLE_CLIENT_ID` | ID de cliente OAuth do Google. Habilita o "Fazer login com o Google". | — |


> **Deixe `VITE_API_URL` indefinida em builds de produção.**
>
> Em desenvolvimento, o frontend e o backend têm origens separadas, portanto o servidor
> de desenvolvimento injeta isso. Em produção, o backend do Rebase serve o SPA, portanto a
> API é a própria origem da página e o cliente a resolve dessa forma por conta própria.
>
> Embutir uma URL absoluta em um bundle de produção funciona até que um segundo
> hostname aponte para a mesma aplicação: um domínio customizado então carrega a página a partir de
> `example.com` e chama a API em `example.rebase.website`, o que é
> cross-origin, fazendo com que toda requisição falhe no preflight. Permitir a origem no CORS
> **não** resolve — o cookie de atualização é `SameSite=Lax` e não
> é enviado cross-site, então você limparia os erros do console e continuaria com
> a autenticação quebrada. Deixando indefinida, qualquer domínio que aponte para a aplicação funciona sem nenhuma
> configuração de CORS.

### Backend

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `PORT` | Porta para o servidor HTTP do backend. Lida por `rebase start`. O `rebase dev` a lê **apenas do ambiente do shell** — um `PORT` no `.env` não é lido ali, pois a porta é resolvida antes de o arquivo ser carregado — e, caso contrário, vincula uma porta derivada do caminho do projeto, para que vários projetos possam rodar ao mesmo tempo. `rebase dev --port` tem precedência sobre ambos, e o banner de inicialização informa qual foi utilizado. | `3001` |
| `LOG_LEVEL` | Nível de detalhamento dos logs: `error`, `warn`, `info`, `debug` | `info` |
| `REBASE_LOG_RAW_QUERIES` | Exibe o SQL por trás de uma linha `Failed query: [redacted]`. Cada instrução que falha é ocultada por padrão, pois uma query com falha carrega seus parâmetros vinculados — um e-mail, um hash de senha. Defina como `true` durante o diagnóstico de falhas de DDL, RLS ou change-capture. Ignorado quando `NODE_ENV=production`. | `false` |
| `NODE_ENV` | Ambiente: `development`, `production` ou `test` | `development` |
| `CORS_ORIGINS` | Lista separada por vírgulas de origens permitidas. **Obrigatória em produção**, a menos que `FRONTEND_URL` esteja definida: uma inicialização de produção sem nenhuma das duas se recusa a iniciar. Em desenvolvimento, ela é *adicionada* ao localhost — veja abaixo. | — |
| `FRONTEND_URL` | URL da aplicação frontend. Usada como alternativa ao CORS_ORIGINS em ambos os ambientes. | — |
| `ADMIN_CONNECTION_STRING` | String de conexão com o banco de dados em nível de administrador (usada para introspecção de schema e operações administrativas). O banco de dados informado não é o que o console SQL considera atual, nem o que uma nova branch copia por padrão: ambos são o banco de dados no qual a conexão da própria aplicação está (consulte `REBASE_BRANCH_PARENT_DATABASE` para um servidor em uma branch). | `DATABASE_URL` |
| `DISABLE_DB_ROLE_SWITCHING` | Desativa a alternância de roles do PostgreSQL no Editor SQL (útil para autenticação personalizada onde as roles do banco de dados não estão mapeadas). O console SQL do Studio indicará que as linhas foram lidas como o proprietário da conexão, informará o nome dele e desabilitará o seletor de roles. | `false` |
| `REBASE_BRANCH_PARENT_DATABASE` | O banco de dados a partir do qual a branch na qual este servidor roda foi copiada. `rebase dev` o define em um checkout [alternado para uma branch](/docs/backend/branching/#cli-integration). Um servidor com ela configurada mantém o registro de branches nesse banco de dados e copia novas branches a partir dele por padrão, permitindo que o painel Branches do Studio exiba as branches do banco de dados principal. | — |

#### CORS em desenvolvimento

O desenvolvimento permite **localhost, além de qualquer valor especificado em `CORS_ORIGINS` (ou `FRONTEND_URL`)**
— a mesma lista utilizada em produção, com o localhost adicionado em vez de
substituído. Dessa forma, a variável funciona da mesma maneira em ambos os ambientes, e os
casos necessários em desenvolvimento são os comuns:

```bash
# A phone on the LAN, a colleague's machine, an ngrok tunnel,
# a forwarded Codespaces port — all non-localhost origins.
CORS_ORIGINS=http://192.168.1.5:5173
```

Uma origem que não seja localhost nem esteja listada é recusada, e a recusa é
registrada em log **uma vez por origem** com a linha exata que a permitiria. Recusar não é
apenas cautela: a API envia credenciais, portanto refletir um
`Origin` arbitrário permitiria que qualquer site visitado pelo desenvolvedor fizesse
requisições autenticadas contra o servidor de desenvolvimento com sua sessão e lesse as
respostas.

### Autenticação

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `JWT_SECRET` | Segredo para assinatura de JWT (obrigatório em produção, gerado automaticamente em desenvolvimento) | — |
| `JWT_PRIVATE_KEY` | Chave privada PEM para assinar tokens de acesso assimetricamente (RS256), permitindo que qualquer parte que possua o JWKS verifique uma sessão sem poder emitir novos tokens. Aceita PEM com quebras de linha reais, PEM com escapes `\n` ou base64 do PEM completo. Sem isso, os tokens permanecem como HS256. | — |
| `JWT_KEY_ID` | Identifica a `JWT_PRIVATE_KEY` no cabeçalho do token e no JWKS. Altere sempre que a chave for alterada — a rotação depende da distinção entre a antiga e a nova. | `default` |
| `JWT_ACCESS_EXPIRES_IN` | Tempo de expiração do token de acesso | `1h` |
| `JWT_REFRESH_EXPIRES_IN` | Tempo de expiração do token de atualização (refresh token). Janela deslizante — cada rotação o renova, portanto determina quanto tempo uma sessão sobrevive à **inatividade**. Defina `400d` para sessões que sobrevivem a longos períodos de ausência; navegadores limitam o cookie de atualização a esse valor. | `30d` |
| `ALLOW_REGISTRATION` | Permite o registro de novos usuários (`true`/`false`). Fora de produção, o **primeiro** usuário sempre pode se registrar, independentemente desta configuração — uma tabela de usuários vazia precisa admitir alguém, e esse alguém se torna o admin. Em produção (`NODE_ENV=production`), essa janela é fechada: uma tabela vazia recusa o registro de bootstrap com `SETUP_REQUIRED`, uma primeira conta criada por registro aberto é uma conta comum, e o admin é definido com `REBASE_ADMIN_EMAIL` abaixo ou atribuído via service key. O `.env.example` do scaffold o define como `true`; o padrão do framework é desativado. | `false` |
| `DISABLE_SELF_REGISTRATION` | Botão de desativação total (kill switch). Fecha a janela de bootstrap do primeiro usuário que `ALLOW_REGISTRATION=false` deliberadamente deixa aberta fora de produção, bloqueando o registro mesmo contra um banco de dados vazio. Combine-o com `REBASE_ADMIN_EMAIL` abaixo, ou a implantação não terá como produzir seu primeiro usuário autenticado. Todos os artefatos de implantação fornecidos o definem. | — |
| `REBASE_ADMIN_EMAIL` | E-mail da primeira conta de administrador, criada na inicialização **enquanto a tabela de usuários ainda estiver vazia** e nunca depois disso. É assim que uma implantação de produção obtém seu admin: o operador define a primeira conta em vez de disputá-la na internet. A inicialização emite um aviso quando a tabela estiver vazia em produção e isso não estiver configurado. | — |
| `REBASE_ADMIN_PASSWORD` | Senha para essa conta. Pelo menos 12 caracteres, caso contrário é recusada e a conta não é criada. Altere-a após o primeiro login. | — |
| `MFA_ENCRYPTION_KEY` | Criptografa cada segredo TOTP armazenado. Se não configurado, os segredos são criptografados com `JWT_SECRET` e o boot emite um aviso único — fazendo com que rotacionar o `JWT_SECRET` desconecte todos *e* torne todos os autenticadores cadastrados indecifráveis. Defina uma chave dedicada (32+ caracteres aleatórios) antes de qualquer usuário se cadastrar. | — |
| `MFA_ENCRYPTION_KEY_PREVIOUS` | A chave anterior da qual se está migrando durante uma rotação. Defina ambas durante uma rotação: novos segredos são gravados com `MFA_ENCRYPTION_KEY` e os existentes continuam legíveis, para que ninguém perca o acesso à sua conta durante o processo. Remova-a após todos os segredos terem sido recriptografados. | — |
| `ALLOW_ANONYMOUS` | Habilita o login anônimo (`POST /api/auth/anonymous`). Opcional (opt-in) e deliberadamente não condicionado a `ALLOW_REGISTRATION`. | `false` |
| `AUTH_REQUIRE` | Exige autenticação para a API de dados. Defina como `false` para uma superfície de leitura totalmente pública — RLS ainda se aplica. | `true` |
| `AUTH_DEFAULT_ROLE` | Role atribuída a um usuário recém-registrado quando nenhuma for informada. | — |
| `AUTH_ALLOW_USER_LOOKUP` | Disponibiliza `POST /api/auth/find-user`, que resolve um e-mail para um perfil público mínimo (`uid`, `displayName`, `photoURL`) para fluxos de convite por e-mail. Apenas chamadores autenticados, e nunca retorna o e-mail, roles ou metadados do usuário encontrado. Desativado por padrão: é uma superfície de enumeração. | `false` |
| `AUTH_COOKIE_SAME_SITE` | `SameSite` no cookie de atualização: `Strict`, `Lax` ou `None`. `None` exige HTTPS e destina-se apenas a um frontend genuinamente cross-site. | `Lax` |
| `AUTH_COOKIE_SECURE` | `Secure` no cookie de atualização. Seguro por padrão; `AUTH_COOKIE_SECURE=false` para HTTP comum — uma implantação em endereço de rede local (LAN) onde o navegador, de outra forma, descartaria o cookie e a sessão expiraria junto com o token de acesso sem erro. Emite um aviso no boot. `http://localhost` não precisa disso. | `true` |
| `GOOGLE_CLIENT_ID` | ID de cliente OAuth do Google (validação no backend) | — |
| `GOOGLE_CLIENT_SECRET` | Segredo do cliente OAuth do Google | — |
| `GITHUB_CLIENT_ID` | ID de cliente OAuth do GitHub | — |
| `GITHUB_CLIENT_SECRET` | Segredo do cliente OAuth do GitHub | — |
| `MICROSOFT_CLIENT_ID` | ID de cliente OAuth da Microsoft | — |
| `MICROSOFT_CLIENT_SECRET` | Segredo do cliente OAuth da Microsoft | — |
| `LINKEDIN_CLIENT_ID` | ID de cliente OAuth do LinkedIn | — |
| `LINKEDIN_CLIENT_SECRET` | Segredo do cliente OAuth do LinkedIn | — |
| `FACEBOOK_CLIENT_ID` | ID de cliente OAuth do Facebook | — |
| `FACEBOOK_CLIENT_SECRET` | Segredo do cliente OAuth do Facebook | — |
| `TWITTER_CLIENT_ID` | ID de cliente OAuth do X/Twitter | — |
| `TWITTER_CLIENT_SECRET` | Segredo do cliente OAuth do X/Twitter | — |
| `DISCORD_CLIENT_ID` | ID de cliente OAuth do Discord | — |
| `DISCORD_CLIENT_SECRET` | Segredo do cliente OAuth do Discord | — |
| `GITLAB_CLIENT_ID` | ID de cliente OAuth do GitLab. A `baseUrl` de uma instância auto-hospedada não possui variável de ambiente — configure o GitLab no bloco `auth` para isso. | — |
| `GITLAB_CLIENT_SECRET` | Segredo do cliente OAuth do GitLab | — |
| `BITBUCKET_CLIENT_ID` | ID de cliente OAuth do Bitbucket | — |
| `BITBUCKET_CLIENT_SECRET` | Segredo do cliente OAuth do Bitbucket | — |
| `SLACK_CLIENT_ID` | ID de cliente OAuth do Slack | — |
| `SLACK_CLIENT_SECRET` | Segredo do cliente OAuth do Slack | — |
| `SPOTIFY_CLIENT_ID` | ID de cliente OAuth do Spotify | — |
| `SPOTIFY_CLIENT_SECRET` | Segredo do cliente OAuth do Spotify | — |
| `APPLE_CLIENT_ID` | Apple Services ID, para login via web. É público e publicado em `GET /auth/config`. A Apple não possui um client secret estático, pois o Rebase assina um JWT ES256 de curta duração para cada troca de token. Portanto, a Apple requer `APPLE_TEAM_ID`, `APPLE_KEY_ID` e `APPLE_PRIVATE_KEY`, além deste ou de `APPLE_BUNDLE_IDS`, e nada é configurado sem eles. | — |
| `APPLE_BUNDLE_IDS` | IDs de bundle separados por vírgula dos aplicativos nativos iOS/macOS cujos códigos do Sign in with Apple são aceitos. | — |
| `APPLE_TEAM_ID` | Apple Developer Team ID, o emissor (issuer) do JWT. | — |
| `APPLE_KEY_ID` | ID da chave privada registrada na Apple. | — |
| `APPLE_PRIVATE_KEY` | Conteúdo do arquivo de chave privada `.p8`, incluindo quebras de linha (escapes `\n` são aceitos). | — |
| `REBASE_SERVICE_KEY` | Chave de API estática de administrador. Ignora a autenticação JWT padrão para chamadas servidor-a-servidor quando passada como `Authorization: Bearer <key>`. (Gerada automaticamente em desenvolvimento). | — |
| `REBASE_PLATFORM_TOKEN_KEY` | A chave pública da plataforma de hospedagem (PEM, EC P-256) contra a qual os tokens de plataforma `rpt_` são verificados; múltiplos blocos PEM durante uma rotação de chave. A plataforma a define no deploy e ela não contém nada secreto. Juntamente com `REBASE_PLATFORM_TOKEN_AUDIENCE`, permite que o controle de admin aceite um token de plataforma para `cron:read` e nada mais. | — |
| `REBASE_PLATFORM_TOKEN_AUDIENCE` | O ID do projeto com o qual o `aud` do token de plataforma deve ser idêntico, para que um token emitido para outro projeto seja recusado. Com apenas uma das duas variáveis configurada, o servidor inicializa, registra um aviso e responde a cada token `rpt_` com `401 PLATFORM_TOKENS_OFF`. | — |
| `REBASE_PLATFORM_SIGNIN_URL` | Para onde o botão **Continue with Rebase Cloud** do painel de administração direciona: a página do projeto no console da plataforma, que autentica os proprietários do projeto e retorna. A plataforma a define no deploy junto com as duas acima; com elas, `POST /api/auth/platform-signin` aceita o token de um minuto `auth:admin-signin` da plataforma e abre uma sessão de administrador. Sem ela, o acesso ainda funciona via **Open CMS** do console, e a tela de login apenas explica a situação. | — |
| `REBASE_RATE_LIMIT_STORE` | Onde os contadores de rate limit residem, para rotas de autenticação e para `rateLimit` em funções customizadas: `memory` (por processo) ou `sql` (compartilhado entre réplicas). Um processo não consegue ver sua própria contagem de réplicas, portanto uma implantação com instâncias paralelas precisa declarar isso — três réplicas no padrão aplicam três vezes o limite. Qualquer outro valor **se recusa a inicializar** em vez de usar fallback, incluindo `postgres`. | `memory` |
| `AUTH_MAGIC_LINK` | Habilita o fluxo de login sem senha via link (magic link). Requer um serviço de e-mail configurado, caso contrário o link não terá para onde ir. | `false` |
| `AUTH_EMAIL_OTP` | Habilita o login sem senha com um código de seis dígitos enviado por e-mail. Mesma exigência de e-mail acima. | `false` |
| `AUTH_MAGIC_LINK_CREATES_USERS` | Cadastro sem senha: uma solicitação de magic link ou código por e-mail para um endereço desconhecido cria a conta, enquanto o registro estiver aberto. | `false` |
| `AUTH_REFRESH_TOKEN_REUSE` | O que acontece quando um token de atualização é reutilizado após sua janela de reutilização: `reject` (recusa, mantém a sessão) ou `revoke-session` (encerra a sessão). Qualquer outro valor causa falha na inicialização. | `reject` |
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | Registro com confirmação prévia: nenhum login por senha até que o endereço seja verificado. Requer e-mail; a inicialização é recusada sem ele. | `false` |
| `CAPTCHA_PROVIDER` | Ativa a verificação de captcha nas rotas de autenticação: `turnstile` ou `hcaptcha`. Deixar indefinido significa sem captcha. | — |
| `CAPTCHA_SECRET` | Segredo do provedor, usado no servidor para verificar o token enviado pelo navegador. Obrigatório quando `CAPTCHA_PROVIDER` estiver definido. | — |
| `CAPTCHA_ROUTES` | Rotas de autenticação separadas por vírgula a serem protegidas (por exemplo, `register,login`). Indefinido protege o conjunto padrão do provedor. | — |

### Storage

:::caution[O Storage não possui segurança em nível de linha (RLS), portanto necessita de um modelo de acesso]
As tabelas são protegidas pelo RLS do Postgres. O armazenamento de objetos não possui equivalente —
as chaves compartilham um único namespace simples —, portanto, com um bucket configurado e nenhum modelo de acesso,
o servidor **se recusa a inicializar em produção**. Atenda a essa exigência com exatamente um dos seguintes itens:
um hook `storageAuthorize` exportado de `backend/storage.ts` (o que o scaffold
inclui), `STORAGE_PUBLIC_READ` ou `STORAGE_ALLOW_ANY_AUTHENTICATED`.
:::

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `STORAGE_TYPE` | Backend de armazenamento: `local`, `s3` ou `gcs`. Em produção, `local` desativa o armazenamento a menos que `FORCE_LOCAL_STORAGE=true` | `local` |
| `STORAGE_PATH` | Caminho base para armazenamento local. Um caminho relativo é lido a partir do diretório em que o servidor executa: a raiz do projeto em `rebase dev`, `backend/` em um servidor gerado por `rebase eject` | `<project>/uploads` |
| `FORCE_LOCAL_STORAGE` | Permite armazenamento local em produção — apenas com um volume persistente contendo `STORAGE_PATH` e os diretórios `<STORAGE_PATH>__<key>` dos buckets locais nomeados ao lado dele | `false` |
| `STORAGE_DOWNLOAD_TOKEN_TTL` | Segundos em que a URL de download de um arquivo privado funciona — o token que `getSignedUrl()` insere nela. No máximo `604800` (uma semana) | `300` |
| `STORAGE_MAX_FILE_SIZE` | Tamanho máximo de arquivo que a fonte aceita, em bytes, em todas as rotas de upload — `__<KEY>` para uma fonte nomeada. Um valor que não seja um número inteiro de bytes recusa a inicialização | `52428800` (50 MB) |
| `S3_BUCKET` | Nome do bucket S3 (quando `STORAGE_TYPE=s3`) | — |
| `S3_REGION` | Região da AWS | — |
| `S3_ACCESS_KEY_ID` | Chave de acesso da AWS | — |
| `S3_SECRET_ACCESS_KEY` | Chave secreta da AWS | — |
| `S3_ENDPOINT` | Endpoint customizado do S3 (para MinIO, Cloudflare R2, etc.) | — |
| `S3_FORCE_PATH_STYLE` | Força URLs em formato path-style para o bucket S3 (`true`/`false`) | `false` |
| `GCS_BUCKET` | Nome do bucket GCS (quando `STORAGE_TYPE=gcs`) | — |
| `GCS_PROJECT_ID` | Projeto no GCP. Geralmente inferido das credenciais. | — |
| `GCS_KEY_FILENAME` | Caminho para o arquivo de chave da conta de serviço (service account). Omita no GCP, onde o Workload Identity fornece as credenciais. | — |
| `STORAGE_PUBLIC_READ` | Serve qualquer objeto para qualquer pessoa, sem token. Apenas para um bucket que seja genuinamente uma CDN pública. Uma das três maneiras de satisfazer a validação de inicialização abaixo. | `false` |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Permite que qualquer chamador autenticado leia, grave, liste e exclua todos os objetos. Nomeado como `INSECURE` no objeto de configuração por um motivo: só é defensável em uma aplicação single-tenant onde todas as contas têm permissão total sobre todos os arquivos. | `false` |
| `STORAGE_RENDITION_CACHE` | Armazena em cache rendições de imagem geradas (redimensionamentos, conversões de formato) em vez de processá-las por requisição. | `false` |

### E-mail (Opcional)
<span class="since-badge" data-since="0.34">Desde 0.34</span> `MAGIC_LINK_URL`.

| Variável | Descrição |
|----------|-----------|
| `SMTP_HOST` | Host do servidor SMTP |
| `SMTP_PORT` | Porta do servidor SMTP |
| `SMTP_SECURE` | Habilita conexão segura (`true`/`false`) |
| `SMTP_USER` | Usuário SMTP |
| `SMTP_PASS` | Senha SMTP |
| `SMTP_FROM` | Endereço do remetente para e-mails do sistema |
| `SMTP_NAME` | Nome de exibição no endereço do remetente |
| `APP_NAME` | Nome do produto usado em assuntos e corpos de e-mail (padrão: `Rebase`) |
| `EMAIL_LOGO_URL` | Logo exibido no topo dos modelos de e-mail padrão. PNG ou JPG com `http(s)` absoluto — clientes de e-mail removem SVG e bloqueiam URIs `data:`. Se não configurado, uma aplicação ainda chamada `Rebase` exibe o símbolo do Rebase e uma renomeada não exibe nenhum |
| `MAGIC_LINK_URL` | Para onde um magic link enviado por e-mail aponta. Uma base terá `/auth/magic-link?token=…` anexado; uma URL contendo `{token}` representa o link completo, para um frontend que não atende em `/auth/magic-link`. Coloque entre aspas no `.env`, onde um `#` sem aspas inicia um comentário: `MAGIC_LINK_URL="https://app.example.com/app.html#ml={token}"`. Um valor com hash ou caminho de arquivo sem `{token}` gera um aviso na inicialização. Se não configurado, a base é `FRONTEND_URL` |

### Pool de conexões do banco de dados

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `DB_POOL_MAX` | Máximo de conexões no pool | `20` |
| `DB_POOL_IDLE_TIMEOUT` | Milissegundos em que uma conexão ociosa é mantida | `30000` |
| `DB_POOL_CONNECT_TIMEOUT` | Milissegundos de espera por uma conexão | `10000` |
| `DATABASE_DIRECT_URL` | Conexão direta (sem pooler). O [Realtime](/docs/backend/realtime) necessita de uma: `LISTEN`/`NOTIFY` não sobrevive a um pooler em modo transação como o PgBouncer, e sem ela as notificações de alteração são desativadas com um aviso em vez de serem perdidas silenciosamente. O [job worker](/docs/backend/jobs) também mantém seu `LISTEN` de ativação nela. Preenche o `directConnectionString` do adaptador Postgres quando não estiver configurado. | — |
| `DATABASE_READ_URL` | Réplica de leitura, como um hot standby. Quando especifica outro servidor, leituras autenticadas (listagens, linhas individuais, contagens, agregações) são atendidas por ela sob a mesma segurança em nível de linha (RLS); escritas, autenticação, realtime, crons, jobs, o console SQL e `rebase.sql` permanecem no primário. Um leitor que acabou de escrever lê do primário durante `REBASE_READ_STICKY_MS`, e todos leem do primário enquanto a réplica estiver com atraso superior a `REBASE_READ_MAX_LAG_MS` ou falhando. Preenche o `readConnectionString` do adaptador Postgres quando não estiver configurado; até a versão 0.28 (inclusive), o pool da réplica era aberto e nunca lido. | — |
| `REBASE_READ_STICKY_MS` | Após uma escrita, tempo durante o qual as leituras do mesmo usuário vão para o primário, garantindo que um salvamento seguido de uma listagem exiba a alteração. Por instância do servidor. | `5000` |
| `REBASE_READ_MAX_LAG_MS` | Atraso (lag) da réplica a partir do qual todas as leituras são direcionadas ao primário. | `1000` |
| `DATABASE_POOLED` | `true` quando `DATABASE_URL` passa por um pooler em modo transação como o PgBouncer. O pool, então, não envia `search_path` ou `statement_timeout` na conexão (o pooler os recusaria ou descartaria) e define ambos em cada transação; a inicialização define para a role do banco de dados um `search_path` padrão de `public` para instruções fora de uma transação. `DATABASE_DIRECT_URL` torna-se obrigatória, e realtime, ativação de job worker, criação de índices, branching e o console SQL usam-na. A URL da réplica também é considerada como pooled. `DATABASE_POOLED__<KEY>` para outra fonte de dados. | — |
| `REBASE_DB_POOL_MAX` | Um teto para todos os pools no processo, aplicado independentemente do solicitado por cada um. Apenas dígitos: um valor malformado é ignorado em vez de serializar silenciosamente o servidor. | — |

### Comportamento do runtime

Lido pelo runtime — `rebase dev`, `rebase start` e a imagem de servidor
publicada. Um projeto ejetado assume essas decisões em seu próprio código.

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `REBASE_RLS_AUDIT` | `true` executa a [auditoria de row-level security](/docs/rls-check#running-it-on-a-schedule) agendada, que relata tabelas servidas sem políticas. O projeto deve declarar `@rebasepro/rls-check` entre suas dependências: o runtime não inclui nenhuma cópia e, sem o pacote, a inicialização é recusada, indicando o nome dele. `false` mantém a varredura desativada neste processo. | — |
| `REBASE_RLS_REQUEST_ROLE` | A role do Postgres com a qual requisições autenticadas e anônimas são executadas. Atribua uma específica para cada projeto em um cluster compartilhado. Um banco de dados registra a role com a qual opera, e uma inicialização configurada para outra se recusa a iniciar até que `rebase db request-role migrate` a transfira. Consulte [Executando em um banco de dados existente ou compartilhado](/docs/deployment/existing-database/). | `rebase_user` |
| `REBASE_RLS_PROVISION_ROLE` | `auto` cria a role de requisição e permite que a conexão alterne para ela; `never` deixa ambas sob sua responsabilidade e apenas as verifica. | `auto` |
| `REBASE_RLS_GRANTS` | O que o Rebase concede à role de requisição: `schema` (todas as tabelas nos schemas que ele atende, mais privilégios padrão), `managed` (apenas as tabelas que ele atende) ou `none`. | `schema` |
| `REBASE_RLS_POLICY_TARGET` | `requestRole` restringe as políticas permissivas do Rebase à(s) role(s) de requisição, para que outras roles que leem as mesmas tabelas não recebam nada delas. | `public` |
| `REBASE_RLS_ADMIN_POLICIES` | `public` grava as políticas que apenas o contexto do servidor ou um administrador podem passar `TO public`, e executa administradores como a role de requisição. Por padrão, são `TO rebase_admin`, permitindo que leituras de usuários autenticados com escopo do proprietário utilizem o índice do proprietário. Consulte [Requisições de administrador e `rebase_admin`](/docs/deployment/existing-database/#admin-requests-and-rebase_admin). | `adminRole` |
| `REBASE_RLS_DEFAULT_POLICIES` | `false` remove a política de base do servidor ou administrador de todas as tabelas. | `true` |
| `REBASE_RLS_IDENTITY` | `supabase` também define `request.jwt.claims` e `request.jwt.claim.*`, para que políticas escritas com `auth.uid()` identifiquem o chamador. | `rebase` |
| `REBASE_RLS_SHARED_ROLE` | O que a inicialização faz quando outro login pode alternar para a role de requisição: `warn`, `refuse` ou `ignore`. | `warn` |
| `REBASE_BASE_PATH` | Caminho base para todas as rotas da API. O cliente deve ser configurado com o mesmo valor — veja [Alterando `basePath`](#alterando-basepath). | `/api` |
| `REBASE_SERVE_STATIC` | Serve os assets estáticos/admin do bundle a partir deste processo. Desative quando houver uma CDN à frente. | `true` |
| `REBASE_HISTORY` | Registra o [histórico de alterações de entidades](/docs/backend/history). | `true` |
| `REBASE_COMPRESSION` | Respostas comprimidas com gzip/brotli. | `true` |
| `REBASE_PUSH` | `true` ativa [notificações push](/docs/backend/push-notifications/): as rotas `/api/push`, a tabela `rebase.push_subscriptions` e `rebase.push`. | `false` |
| `REBASE_VAPID_PUBLIC_KEY`, `REBASE_VAPID_PRIVATE_KEY` | O par de chaves VAPID com o qual as mensagens push são assinadas. Fora de produção, um par é gerado e mantido em `.rebase-dev-secrets.json` quando não definido; em produção, o push permanece desativado sem elas. | — |
| `REBASE_VAPID_SUBJECT` | Um endereço `mailto:` ou URL `https://` que os serviços de push podem contatar. O padrão é a origem de um `REBASE_PUBLIC_URL` com `https`. | — |
| `REBASE_MAX_BODY_SIZE` | Corpo máximo da requisição, **em bytes** (`10485760`, não `10MB` — um valor que não seja número recusa a inicialização em vez de remover o limite silenciosamente). `0` desativa o limite. | `10485760` (10 MiB) |
| `REBASE_ENABLE_SWAGGER` | A superfície OpenAPI. Três estados (tri-state). Indefinido, em todos os ambientes: `/api/docs` é servido aos chamadores para os quais `GET /api/schema/tables` descreve tabelas, cada um recebendo o documento das tabelas descritas para si, e não há interface Swagger UI. `true` publica o documento completo para todos, com a **UI** do Swagger em `/api/swagger` fora de produção (nunca em produção). `false` mantém o documento protegido pelo controle de admin. | — |
| `REBASE_METRICS` | Expõe métricas do Prometheus em `/metrics`. | `false` |
| `REBASE_HSTS_INCLUDE_SUBDOMAINS` | Adiciona `includeSubDomains` ao cabeçalho `Strict-Transport-Security`, fazendo com que navegadores recusem HTTP simples em todos os subdomínios do host por seis meses — incluindo hosts não atendidos por este processo. Ative apenas quando todos os subdomínios do domínio forem exclusivos via HTTPS. Qualquer valor diferente de `true`/`false` recusa a inicialização. Consulte [Cabeçalhos de segurança](/docs/deployment/self-hosting/#security-headers). | `false` |
| `REBASE_METRICS_TOKEN` | Bearer token protegendo `/metrics`. Indefinido deixa o endpoint acessível a qualquer um que alcance a porta — adequado em uma rede privada, não em uma pública, e os logs de boot alertam sobre isso. | — |
| `REBASE_MIGRATE_ON_BOOT` | O que o runtime pode fazer com o schema das tabelas no boot. `ensure` (o padrão, em todos os lugares — inclusive produção) executa o passo **aditivo**: cria tabelas, colunas e tipos enum ausentes, nunca remove ou reescreve nenhum. `none` mantém inalterado o schema das tabelas declaradas, mas as tabelas do próprio framework (auth, chaves de API, jobs, cron) continuam sendo criadas e mantidas atualizadas; `REBASE_PROVISION=false` desativa essas também. A imagem publicada aceita apenas essas duas opções e **se recusa a inicializar em `push`**. Em uma [implantação dividida](/docs/deployment/split-processes), exatamente um processo pode provisionar, portanto todos os outros papéis devem definir `none` ou se recusarão a inicializar. | `ensure` |
| `REBASE_PROVISION` | `false` faz com que o runtime não altere nada no banco de dados: nenhuma tabela, coluna, índice, função, trigger, política, role ou concessão (grant), no boot ou posteriormente, incluindo as do próprio framework. Em vez disso, ele relata nominalmente o que estiver faltando. Para bancos de dados que somente o seu processo de mudanças pode alterar. Consulte [Quando apenas seu processo de mudanças pode alterar o banco de dados](/docs/deployment/self-hosting/#when-only-your-change-process-may-change-the-database). Apenas `true` e `false` são aceitos. | `true` |
| `REBASE_REQUIRE_SCHEMA_MATCH` | Recusa a inicialização se o banco de dados tiver sido provisionado pela última vez a partir de um conjunto de tabelas diferente daquele para o qual este processo foi compilado. Indefinido (ou qualquer valor diferente de `true`/`1`) apenas emite um aviso. | warn |
| `REBASE_REQUIRE_FILES_LOADED` | Recusa a inicialização quando um arquivo de função ou cron lança um erro ou falha no parse durante a importação, identificando cada arquivo e o motivo, para que um deploy rolling mantenha a versão antiga em execução. Um reinício também é submetido a isso. Indefinido (ou qualquer valor diferente de `true`) ignora o arquivo e serve os demais. Um arquivo que importa sem problemas e não exporta nenhuma função ou job é sempre ignorado, não recusado. | skip |
| `REALTIME_CDC` | Captura de alterações no nível do banco de dados: `auto` (lê alterações do WAL quando o banco permitir, caso contrário usa triggers, e se não for possível recorre ao nível de aplicação, registrando cada fallback como info), `trigger` (força o uso de triggers, alerta se impossível), `wal` (lê alterações do write-ahead log em vez de triggers; requer `wal_level=logical` e uma role com permissão de replicação, caso contrário recorre a `trigger`), `off`. Consulte [Realtime](/docs/backend/realtime-cdc/). Tem precedência sobre `realtime.cdc`. | `auto` |
| `REALTIME_CHANNEL_BUS` | Transporte entre instâncias para canais de broadcast e presence: `memory` ou `postgres`. Ignorado quando `realtime.bus` receber um transporte já instanciado. | `memory` |
| `REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET` | Quantas inscrições um socket de realtime pode manter; a próxima é recusada com `TOO_MANY_SUBSCRIPTIONS`. Um número inteiro positivo — qualquer outro valor interrompe o servidor na inicialização. Tem precedência sobre `realtime.maxSubscriptionsPerSocket`. Consulte [Realtime](/docs/backend/realtime#what-a-write-costs-and-the-limits). | `1000` |
| `REALTIME_MAX_SOCKETS_PER_USER` | Quantos sockets de realtime um usuário, ou uma chave de API, pode manter abertos em uma instância de servidor. Sockets de personificação de um administrador contam contra o administrador. A autenticação do próximo é recusada com `TOO_MANY_SOCKETS` e o socket é fechado (4002); o SDK continua tentando novamente, conectando-se assim que outro fechar. Um número inteiro positivo — qualquer outro valor interrompe o servidor na inicialização. Tem precedência sobre `realtime.maxSocketsPerUser`. | Sem limite |
| `REALTIME_REFETCH_MAX_WAIT_MS` | O tempo máximo que uma alteração aguarda pela re-busca (refetch) que a entrega aos inscritos ativos, em ms. Uma re-busca aguarda 300 ms sem alterações, e no máximo este tempo sob um fluxo constante de escritas. Um número inteiro positivo — qualquer outro valor interrompe o servidor na inicialização. Tem precedência sobre `realtime.refetchMaxWaitMs`. | `1000` |
| `REALTIME_RECOUNT_INTERVAL_MS` | Por quanto tempo o total de uma inscrição de listagem grande pode ser reutilizado antes de ser recalculado, em ms; frames que o reutilizam trazem `meta.totalAsOf`. Indefinido, todos os frames recalculam. Tem precedência sobre `realtime.recountIntervalMs`. | Indefinido |
| `REALTIME_RECOUNT_MIN_ROWS` | O menor total recente ao qual `REALTIME_RECOUNT_INTERVAL_MS` se aplica; listas menores são contadas a cada frame. Tem precedência sobre `realtime.recountMinRows`. | `100000` |
| `ALLOW_LOCALHOST_IN_PRODUCTION` | Permite valores de `localhost`/loopback sob `NODE_ENV=production`. Desativado por padrão, para que uma inicialização em produção falhe expressamente em vez de se conectar a um banco de dados inexistente. | `false` |
| `REBASE_PROVISION_ONLY` | `1`/`true` executa a etapa de schema e encerra sem abrir um socket — exatamente o formato necessário para um Job de migração, a partir da mesma imagem e do mesmo bundle do servidor subsequente. Também cria as tabelas que um processo servidor criaria no primeiro uso e não inicializa nenhum agendador cron ou fila de jobs. Um valor vazio é considerado *indefinido*, impedindo que um `${SOMETHING}` não substituído em um arquivo compose transforme uma implantação comum em uma que apenas migra e se recusa a servir requisições. Recusado juntamente com `REBASE_PROVISION=false`. | — |
| `REBASE_PROVISION_SQL_OUT` | Um caminho de arquivo. Uma execução de provisionamento (`REBASE_PROVISION_ONLY=true`) grava nele todas as alterações de schema realizadas, em ordem, como um script SQL para revisão e aplicação com `psql`. As linhas gravadas não são incluídas. Recusado em processos que servem requisições. | — |
| `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` | `true` permite que uma máquina — um agente, um job de CI — *aplique* uma alteração de schema por meio de `/api/admin/schema`, não apenas a planeje. Desativado a menos que solicitado: a credencial necessária para tal alteração é justamente a mais propensa a estar armazenada em uma variável de CI. | `false` |
| `REBASE_FUNCTIONS_TIMEOUT_MS` | Quanto tempo uma função personalizada pode executar antes de sua requisição ser abortada. Mesmo parâmetro que a opção `functionsTimeoutMs`. `0` desativa o limite. | `30000` |
| `REBASE_EXIT_ON_UNHANDLED_REJECTION` | `true` faz com que uma rejeição de promise não tratada encerre o processo em vez de apenas registrá-la em log. Recomendado sob um orquestrador que fará o reinício; desative onde um reinício for pior que um leak. | `false` |
| `REBASE_CRON_ALWAYS_ON` | Silencia o aviso de inicialização em plataformas detectadas pelo runtime como scale-to-zero, onde um timer acionado em uma instância ociosa não é executado em nenhuma instância. Não altera mais nada: ative quando mantiver pelo menos uma instância em execução contínua. | — |
| `TRUSTED_PROXY_HOPS` | Quantos proxies estão à frente deste servidor, permitindo que o limitador de taxa (rate limiter) obtenha o endereço real do cliente a partir de `X-Forwarded-For`. Padrão seguro `0`: sem proxy, confiar no cabeçalho permitiria que qualquer chamador falsificasse uma identidade. | `0` |

:::note[O provisionamento na inicialização é aditivo e não é uma ferramenta de migração]
A etapa de inicialização executa de forma autônoma sem ninguém inspecionando um diff, portanto nunca removerá
uma coluna, restringirá um tipo ou reescreverá uma tabela. É também por isso que a imagem recusa
`REBASE_MIGRATE_ON_BOOT=push`: um push completo calcula um diff e executará alegremente
`DROP COLUMN`, e o reinício de um container nunca deve ser capaz de destruir uma
coluna em produção como efeito colateral de um reagendamento.

Alterações destrutivas ou de reformulação permanecem onde possam ser revisadas: `rebase db
generate` + `rebase db migrate`, ou `rebase db push` a partir de um checkout ou CI,
que executa uma simulação (dry-run) da alteração, recusa alterações destrutivas sem confirmação e
pode criar um backup prévio.
:::

### Implantações divididas (Split deployments)

Uma única imagem e um único bundle podem ser inicializados várias vezes, cada um
atendendo a uma parte diferente do projeto. Uma linha para cada aqui, pois esta página se
propõe a listar todas as variáveis; o que cada combinação *monta e gerencia* — e quais
combinações se recusam a inicializar — está em
**[Processos Divididos](/docs/deployment/split-processes)**.

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `REBASE_ROLE` | Qual parte este processo atende: `all`, `api`, `functions` ou `worker`. | `all` |
| `REBASE_CRON_SCHEDULER` | Substitui a definição de se *este* processo executa os agendadores de cron. Indefinido segue o papel (`role`). | — |
| `REBASE_JOB_WORKERS` | Substitui a definição de se este processo executa os workers da fila de jobs. Indefinido segue o papel (`role`). | — |
| `REBASE_FUNCTIONS_ONLY` | Serve apenas as funções personalizadas especificadas neste processo. | — |
| `REBASE_FUNCTIONS_EXCLUDE` | Serve todas as funções personalizadas, exceto as especificadas. | — |
| `REBASE_FUNCTIONS_UPSTREAM` | Para onde o processo de API encaminha uma requisição de função que ele próprio não atende. Em um `worker`, para onde vão suas próprias chamadas `rebase.functions`. Uma URL `http(s)`. | — |

### Superfície MCP

Um endpoint opcional do Model Context Protocol em `/mcp`, permitindo que um cliente de IA leia
e escreva neste projeto **como o usuário autenticado**. Desativado a menos que configurado e — ao
contrário de qualquer outra superfície — nenhum `REBASE_ROLE` o ativa: os outros descrevem a
arquitetura do processo, enquanto este representa a decisão de conceder credenciais a um software de terceiros,
devendo ser tomada por uma pessoa em vez de herdada da
função de um container.

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `REBASE_MCP_ENABLED` | Disponibiliza a superfície MCP. Requer `REBASE_PUBLIC_URL`; sem ela, a superfície não é montada e isso é registrado no log de inicialização. | `false` |
| `REBASE_PUBLIC_URL` | A origem publicamente acessível desta implantação, por exemplo `https://app.example.com`. A superfície MCP não pode inferi-la — extrair a origem do cabeçalho `Host` tornaria a identidade do emissor e a audiência contra a qual seus próprios tokens são validados um valor fornecido pelo chamador. | — |
| `REBASE_MCP_VIEW` | Caminho para a visualização MCP App personalizada do projeto (`rebase-view.html`, gerada por `rebaseMcpViewPlugin()`), servida ao Claude no lugar da visualização genérica para que suas views, campos e ações customizados sejam renderizados. Sem isso, o backend procura ao lado do frontend que ele atende. | — |
| `REBASE_MCP_OPEN_REGISTRATION` | Permite o registro dinâmico de clientes OAuth (RFC 7591), para que um cliente possa se autoinscrever. Defina como `false` para exigir que os clientes sejam registrados com antecedência. | `true` |

### Edição de schema ao vivo a partir de um bundle

Desativado a menos que `REBASE_LIVE_SCHEMA_REPOSITORY` esteja definido. Um bundle compilado não possui o
código-fonte de `backend/schema` para edição, portanto, com essas variáveis configuradas, o editor de schema lê
o código-fonte do repositório, realiza o commit de cada alteração de volta e executa seu DDL
neste banco de dados. Exclusivo para administradores e aplicado por uma pessoa, a menos que
`REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` indique o contrário. Um repositório especificado
sem credenciais utilizáveis recusa a inicialização. Consulte
[Edição de schema ao vivo](/docs/backend/live-schema-editing#from-a-built-bundle).

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `REBASE_LIVE_SCHEMA_REPOSITORY` | O repositório do GitHub no qual realizar commits das alterações de schema, como `proprietario/nome`. Definir esta variável ativa a funcionalidade. | — |
| `REBASE_LIVE_SCHEMA_BRANCH` | A branch onde o commit será aplicado. | `main` |
| `REBASE_LIVE_SCHEMA_PATH` | Onde `backend/schema` fica localizado nesse repositório, relativo à raiz dele. Um caminho que aponte para fora do repositório recusa a inicialização, assim como a variável removida `REBASE_LIVE_SCHEMA_COLLECTIONS_PATH`. | `backend/schema` |
| `REBASE_LIVE_SCHEMA_GITHUB_TOKEN` | Um token de granularidade fina (fine-grained) com acesso de leitura e escrita ao conteúdo do repositório. Defina esta variável ou as três variáveis `_GITHUB_APP_*`, não ambas. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_ID` | ID de um GitHub App, para realizar commits como o aplicativo em vez de usar um token. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_INSTALLATION_ID` | A instalação do aplicativo no repositório. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_PRIVATE_KEY` | Chave privada do aplicativo: PEM, PEM com quebras de linha escapadas ou base64. | — |

### Backups

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `BACKUP_SCHEDULE` | Expressão cron para backups agendados. Indefinido significa que backups agendados estão desativados. | — |
| `BACKUP_DESTINATION` | Caminho local ou uma URL `s3://bucket/prefix` / `gs://bucket/prefix`. Obrigatório junto com `BACKUP_SCHEDULE`, que se recusa a executar sem ele. `rebase db backup` usa `./backups` como fallback no diretório onde foi executado. | — |
| `BACKUP_RETENTION_DAYS` | Exclui backups com mais de N dias. Indefinido ou `0` mantém tudo. | — |
| `BACKUP_KEEP_MINIMUM` | Sempre retém pelo menos N backups mais recentes, independentemente da retenção. | — |
| `PG_DUMP_PATH` | Substitui o binário do `pg_dump` — deve ser da versão principal do servidor ou mais recente. | — |
| `PG_RESTORE_PATH` | Substitui o binário do `pg_restore`. | — |
| `PSQL_PATH` | Substitui o binário do `psql` executado por `rebase db restore --clean` para realizar a restauração em uma única transação. | — |
| `PG_DUMPALL_PATH` | Localização do `pg_dumpall`, quando não estiver no `PATH`. Sem ele — e sem as ferramentas de cliente do PostgreSQL instaladas — o backup de globais falha com um erro indicando esta variável. | — |

A imagem oficial do runtime (`rebasepro/server`) inclui as ferramentas de cliente do PostgreSQL 18,
de modo que um backup agendado pode ser executado nela contra qualquer servidor até o Postgres 18.
Fora da imagem, instale-as você mesmo (`apt-get install postgresql-client-18`,
`brew install libpq`).

Os backups contêm segredos e dados pessoais identificáveis (PII). Utilize um destino privado com
criptografia em repouso.

### Entrega de bundles (Bundle delivery)

Uma implantação gerenciada não carrega seu código na imagem: o runtime busca um
bundle na inicialização. Estas variáveis definem qual bundle e como obtê-lo.

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `REBASE_BUNDLE` | Caminho para um diretório de bundle já extraído. O que `rebase start` define localmente. | — |
| `REBASE_BUNDLE_URL` | De onde baixar o arquivo compactado do bundle, quando não houver um local. | — |
| `REBASE_BUNDLE_TOKEN` | Credencial bearer para esse download. Trate-a como um segredo: é ela que autoriza um tenant a baixar seu próprio código. | — |
| `REBASE_BUNDLE_FETCH_DIR` | Onde um bundle baixado é extraído. Deve ter permissão de escrita e persistir entre o download e a inicialização. | — |
| `REBASE_RUNTIME_MODULES` | Módulos adicionais que a imagem do runtime fornece ao bundle, além dos declarados por ele mesmo. | — |

### Vinculação de recursos (Resource bindings)

Cada banco de dados, bucket e tópico declarado por um projeto em `backend/resources.ts` é
vinculado por meio de variáveis de ambiente com nomes baseados nele. Os nomes base estão abaixo; um
recurso não padrão anexa `__` e sua chave em letras maiúsculas, portanto um bucket chamado
`media` lê `S3_BUCKET__MEDIA`. O comando `rebase status`
exibe, para cada recurso,
a variável exata que está sendo lida e se ela está configurada.

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `REBASE_DRIVER` | O pacote npm que implementa o driver de uma fonte de dados, quando não for o driver padrão do Postgres. Sufixado por fonte: `REBASE_DRIVER__ANALYTICS`. | — |
| `REBASE_TOPIC_URL` | A string de conexão para um tópico declarado. Sufixada por tópico. | — |

### Ambiente próprio da CLI

Lido pelo `rebase`, não pelo servidor. Nada aqui afeta uma implantação.

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `REBASE_BASE_URL` | Para onde `rebase api-keys`, `rebase storage` e `rebase auth reset-password` enviam a service key, no shell ou no `.env`. Defina quando o servidor rodar de outra forma que não seja `rebase dev` neste projeto: `rebase start`, um container, outro host. Indefinido, eles usam o servidor registrado pelo `rebase dev` enquanto esse servidor estiver rodando, e não enviam nada quando não estiver. | — |
| `REBASE_SERVICE_KEY` | A chave de serviço com a qual esses comandos se autenticam, lida do `.env`: a mesma variável que o servidor lê (veja acima). | — |
| `SERVICE_KEY` | Um nome legado para essa chave. Quando definida no `.env`, `rebase api-keys` e `rebase storage` a leem no lugar de `REBASE_SERVICE_KEY`. | — |
| `REBASE_ENV_FILE_PATH` | Qual arquivo `.env` a CLI lê e escreve, quando não for o do projeto. | — |
| `REBASE_ROOT_RULES` | `0` impede que `rebase init` e `rebase skills install` gravem as regras do projeto nos arquivos `CLAUDE.md` e `AGENTS.md` na raiz do repositório, útil para raízes cujos arquivos de agentes são mantidos manualmente. | on |
| `REBASE_CLOUD_URL` | O plano de controle com o qual `rebase cloud` se comunica. | — |
| `REBASE_CLOUD_EMAIL` | A conta com a qual `rebase cloud login` se conecta, em vez de solicitar interativamente. | — |
| `REBASE_CLOUD_PASSWORD` | Sua senha, permitindo que um gerenciador de segredos a forneça sem expô-la no histórico do shell. | — |
| `REBASE_TOKEN` | Um token gerado por `rebase cloud tokens create`. Quando definido, todos os comandos `rebase cloud` se autenticam com ele em vez da sessão de `rebase cloud login`, nunca lendo ou gravando a sessão armazenada. Em um diretório vinculado por `rebase cloud init --claim`, ele é reservado para o próprio token do projeto quando não tiver escopo sobre o projeto. A forma recomendada de executar `rebase cloud` em CI — consulte [CI e agentes](/docs/deployment/cloud/#ci-and-agents). O [servidor MCP](/docs/ai/mcp/) o passa para a CLI instanciada por suas ferramentas em nuvem, e nunca o envia para a aplicação: defina `REBASE_API_TOKEN` para isso. | — |
| `REBASE_DEBUG` | `1` imprime o erro subjacente e os detalhes da requisição em vez da mensagem curta. A primeira coisa a configurar quando um comando `rebase cloud` falhar sem detalhes úteis. | — |
| `REBASE_ATLAS_DEV_URL` | O banco de dados vazio contra o qual `rebase db push`, `db generate` e `db migrate` fazem o planejamento, em vez do `<db>_dev_diff` criado ao lado de `DATABASE_URL`. O Rebase não cria nem remove o banco de dados aqui informado, e recusa um valor igual a `DATABASE_URL`. No banco de desenvolvimento gerenciado, a CLI o define para uma instância temporária em memória do PGlite. Configure onde a permissão `CREATE DATABASE` não for concedida. | `<db>_dev_diff` |
| `REBASE_DEV_NO_DB` | `rebase dev` não inicializa nenhum banco de dados e não provisiona nada — você fornece o seu próprio. Equivalente a `--no-db`. | — |
| `REBASE_FRONTEND_PORT` | Fixa a porta do servidor de desenvolvimento do frontend, que caso contrário o `rebase dev` deduz a partir do caminho do projeto. | — |
| `REBASE_DEV_READY_TIMEOUT_MS` | Tempo que o `rebase dev` aguarda o backend se anunciar antes de informar que ele não iniciou. `0` desativa o relatório. | `30000` |
| `DATABASE_PASSWORD` | A senha que `rebase dev --docker` insere na string de conexão derivada do `docker-compose.yml`. | — |
| `DO_NOT_TRACK` | A convenção entre ferramentas. Defina com qualquer valor diferente de `0` e a CLI não enviará telemetria. | — |
| `REBASE_TELEMETRY_DISABLED` | O mesmo, especificamente para o Rebase. Não requer arquivo, motivo pelo qual é a opção recomendada para CI e imagens. | — |
| `REBASE_TELEMETRY_ENDPOINT` | Para onde a telemetria é enviada, no caso de um coletor auto-hospedado. | — |

## Segredos em desenvolvimento

`JWT_SECRET` é obrigatório em produção. Ele e `REBASE_SERVICE_KEY` são
gerados para você fora dela, para que você possa começar sem precisar configurar nada.

Esses valores gerados ficam em cache em `.rebase-dev-secrets.json`, ao lado de
`.rebase-dev-port` e `.rebase-dev-url`, e são ignorados pelo git junto com eles. Anteriormente, eram
regenerados a cada inicialização — fazendo com que reiniciar o servidor de desenvolvimento desconectasse você da
sua própria aplicação e invalidasse qualquer chave de API recém-criada.

- Defina qualquer uma das variáveis explicitamente e o seu valor será usado; nada será armazenado em cache ou lido.
- Aponte o cache para outro local com `REBASE_DEV_SECRETS_FILE` — um caminho, e a
  única variável nesta seção que você configuraria deliberadamente.
- Exclua o arquivo para rotacionar ambos os segredos. A próxima inicialização gerará um novo arquivo.
- Se o arquivo não puder ser gravado — em um container somente leitura, por exemplo —, o servidor iniciará
  mesmo assim com um segredo efêmero, exatamente como antes.

Nada é armazenado em cache em produção ou sob um executor de testes. Em produção, nada
é gerado automaticamente: uma inicialização sem `JWT_SECRET` falha, indicando o nome da variável, e
isso permanece inalterado:

```
The environment is not valid:
  JWT_SECRET: is required
```

## Objeto de Configuração do Backend

O `RebaseBackendConfig` passado para `initializeRebaseBackend()` oferece controle programático:

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

As mesmas opções,
sem `app`, `server` e `basePath` e com um `provision` obrigatório, criam um
backend que não serve nada até que você o monte: `createRebaseBackend`. Consulte
[Integração de Servidor Customizado](/docs/backend/custom-server/).

### Alterando `basePath`

`basePath` move todas as rotas da API, portanto o cliente precisa ser configurado da mesma forma —
caso contrário, continuará solicitando `/api/...` e receberá 404 para tudo:

```typescript
import { createRebaseClient } from "@rebasepro/client";

export const rebase = createRebaseClient({
    baseUrl: "https://api.example.com",
    apiPath: "/v1"          // must match the backend's basePath
});
```

O painel de administração obtém isso do cliente que lhe for fornecido; nada mais precisa ser
configurado. Se você construir uma URL de requisição manualmente, concatene-a a partir do cliente em vez
de escrever `/api` diretamente:

```typescript
import { useApiBase } from "@rebasepro/app";

function Widget() {
    const apiBase = useApiBase();   // e.g. "https://api.example.com/v1"
    // fetch(`${apiBase}/data/products`)
}
```

## Solução de Problemas

### Permissão Negada no Editor SQL (`permission denied for table <name>`)

* **Sintomas:** Queries customizadas executadas no editor SQL do Rebase Studio falham com `cause: error: permission denied for table <name>`, embora a visualização em planilha do CMS carregue os dados com sucesso.
* **Causa:** Por padrão, o Rebase tenta executar queries do Editor SQL alternando temporariamente as roles do banco de dados para corresponder à role da aplicação do usuário ativo (por exemplo, `SET LOCAL ROLE "admin"`). Se você estiver usando autenticação customizada em que as roles existem apenas em tabelas do banco de dados em vez de roles reais do PostgreSQL, a alternância de role falha ou faltam privilégios no banco de dados. A visualização em planilha do CMS é executada com o usuário proprietário da conexão padrão e ignora essa restrição.
* **Solução:** Adicione `DISABLE_DB_ROLE_SWITCHING=true` à configuração do seu `.env` no backend. Isso força o Rebase a executar queries do Editor SQL usando os privilégios do proprietário da conexão (geralmente um superuser/owner). O Editor SQL então indica, acima dos resultados, que eles foram lidos como o proprietário da conexão, e desabilita seu seletor de roles.

### Falha ao Buscar Schema no Editor SQL (`Cross-database execution requires adminConnectionString`)

* **Sintomas:** O Studio falha ao carregar a árvore de schemas, ou o Editor SQL lança `Failed to fetch schema: Cross-database execution requires adminConnectionString to be configured in the backend.`
* **Causa:** O Rebase requer privilégios administrativos para consultar catálogos do sistema do banco de dados e executar comandos administrativos. Se `adminConnectionString` não for fornecido ao bootstrapper, ou se `getAdmin()` for sobrescrito para retornar `undefined`, essas operações falham.
* **Solução:** Garanta que `adminConnectionString` esteja configurado durante a inicialização do bootstrapper do backend:
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
