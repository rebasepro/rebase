---
sourceHash: dae0d9a7e36f01c4
title: Ambiente & Configuração
sidebar_label: Configuração
description: Todas as variáveis de ambiente e opções de configuração para projetos Rebase.
---

## Variáveis de Ambiente

Toda a configuração é feita por meio de variáveis de ambiente no seu arquivo `.env` na raiz do projeto.

> **Importante**: O Rebase valida as variáveis de ambiente com o **Zod** na inicialização. Se
> algo obrigatório estiver ausente ou malformado (uma URL que não é uma URL, uma porta que
> não é um número), o servidor recusa a inicialização e informa o nome da variável.
>
> O local onde o esquema reside depende de como você executa o backend. Um projeto inicializado
> pelo runtime — `rebase dev`, `rebase start`, a imagem publicada — usa o
> esquema pertencente ao runtime (`loadBootEnv` em `@rebasepro/server`), que é a
> união de todas as tabelas abaixo. Um projeto que executou [`rebase eject`](/docs/cli)
> possui um `backend/src/env.ts` chamando `loadEnv({ extend })` e pode adicionar suas próprias
> variáveis tipadas lá.

### Obrigatórias

| Variável | Descrição | Exemplo |
|----------|-----------|---------|
| `DATABASE_URL` | String de conexão do PostgreSQL. **Opcional em desenvolvimento** — se não definida, o `rebase dev` executa um PostgreSQL gerenciado para o projeto, com seus dados sob `.rebase/`. Obrigatória em qualquer outro ambiente. | `postgresql://user:pass@localhost:5432/mydb` |
| `JWT_SECRET` | Chave secreta para assinar tokens JWT. Use uma string aleatória forte (mínimo de 32 caracteres). **Obrigatória em produção** (gerada automaticamente em desenvolvimento). | `a1b2c3d4e5...` |

> **Em um banco de dados gerenciado, `sslmode=require` pode não significar o que diz.**
>
> Para o `psql` e todas as ferramentas baseadas em libpq, `require` significa "criptografado, certificado não
> verificado". O driver Node no qual o Rebase é executado interpreta isso como `verify-full`, de modo que um
> banco de dados cujo certificado não foi assinado por nenhuma autoridade pública — comum em instâncias gerenciadas do
> Postgres — rejeita o runtime com `self-signed certificate`, enquanto o `psql`
> se conecta usando a mesma URL. O runtime e os comandos `rebase db` são interrompidos com uma
> mensagem informando isso.
>
> Escolha uma das opções:
>
> - **`sslmode=no-verify`** — criptografado, não verificado: o que `require` significa para
>   a libpq. Trata-se de uma grafia do node-postgres inexistente na libpq, portanto `psql`, `pg_dump`
>   e Atlas a recusam com `invalid sslmode value: "no-verify"`. Os comandos próprios do Rebase
>   (`rebase db push`, `rebase db backup`, `rebase db restore`) repassam isso
>   para eles como `sslmode=require`, funcionando com a URL conforme configurada; para
>   executar `psql` manualmente, alterne para `sslmode=require`.
> - **`sslmode=verify-full&sslrootcert=/path/to/ca.pem`** — verificado contra o
>   certificado da CA do provedor. Igual para todas as ferramentas.
>
> `uselibpqcompat=true&sslmode=require`, sugerido pelo próprio aviso do driver Node,
> também funciona para o runtime; os comandos do Rebase removem `uselibpqcompat`
> antes de repassar a URL para as ferramentas da libpq, que caso contrário a rejeitariam.

### Frontend

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `VITE_API_URL` | URL da API do backend para o SDK tipado. **Defina apenas em desenvolvimento** — veja abaixo. | origem da página |
| `VITE_GOOGLE_CLIENT_ID` | Client ID do Google OAuth. Habilita o "Sign in with Google". | — |


> **Deixe `VITE_API_URL` não definida em builds de produção.**
>
> Em desenvolvimento, o frontend e o backend operam em origens distintas, por isso o servidor
> de desenvolvimento injeta esse valor. Em produção, o backend do Rebase serve a SPA, portanto
> a API é a própria origem da página e o cliente a resolve dessa forma por conta própria.
>
> Fixar uma URL absoluta em um bundle de produção funciona até o momento em que um segundo
> hostname aponta para a mesma aplicação: um domínio personalizado então carrega a página a partir de
> `example.com` e chama a API em `example.rebase.website`, o que configura cross-origin,
> fazendo com que todas as requisições falhem no preflight. Permitir a origem no CORS
> **não** resolve o problema — o cookie de atualização é `SameSite=Lax` e não
> é enviado cross-site, portanto os erros de console desapareceriam, mas a
> autenticação continuaria quebrada. Deixando-a indefinida, qualquer domínio apontando para a aplicação funcionará
> sem nenhuma configuração de CORS adicional.

### Backend

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `PORT` | Porta para o servidor HTTP do backend. Lida por `rebase start`. O `rebase dev` a lê **apenas do ambiente do shell** — um `PORT` definido no `.env` não é lido lá, pois a porta é resolvida antes do carregamento do arquivo — e, caso contrário, vincula uma porta derivada do caminho do projeto, permitindo que vários projetos rodem ao mesmo tempo. `rebase dev --port` tem precedência sobre ambos, e o banner de inicialização informa a porta utilizada. | `3001` |
| `LOG_LEVEL` | Verbosidade do log: `error`, `warn`, `info`, `debug` | `info` |
| `REBASE_LOG_RAW_QUERIES` | Exibe o SQL por trás de uma linha `Failed query: [redacted]`. Toda instrução que falha é ocultada por padrão, pois uma query com falha carrega seus parâmetros vinculados — um e-mail, um hash de senha. Defina como `true` durante o diagnóstico de falhas em DDL, RLS ou captura de alterações. Ignorado quando `NODE_ENV=production`. | `false` |
| `NODE_ENV` | Ambiente: `development`, `production` ou `test` | `development` |
| `CORS_ORIGINS` | Lista separada por vírgulas de origens permitidas. **Obrigatória em produção**, a menos que `FRONTEND_URL` esteja definida: uma inicialização em produção sem nenhuma das duas recusará a iniciar. Em desenvolvimento, ela é *adicionada ao* localhost — veja abaixo. | — |
| `FRONTEND_URL` | URL da aplicação frontend. Usada como alternativa ao CORS_ORIGINS, em ambos os ambientes. | — |
| `ADMIN_CONNECTION_STRING` | String de conexão com o banco de dados em nível de administrador (usada para introspecção de esquema e operações administrativas). O banco de dados especificado não é o que o console SQL considera o atual, nem o que uma nova branch copia por padrão: ambos correspondem ao banco em que a conexão da própria aplicação está estabelecida (consulte `REBASE_BRANCH_PARENT_DATABASE` para um servidor em uma branch). | `DATABASE_URL` |
| `DISABLE_DB_ROLE_SWITCHING` | Desativa a alternância de papéis (roles) do PostgreSQL no Editor SQL (útil para autenticação personalizada onde os papéis do banco não são mapeados). O console SQL do Studio passa a informar que as linhas foram lidas como o proprietário da conexão, exibe seu nome e desabilita o seletor de papéis. | `false` |
| `REBASE_BRANCH_PARENT_DATABASE` | O banco de dados do qual a branch na qual este servidor é executado foi copiada. O `rebase dev` a define em um checkout [alternado para uma branch](/docs/backend/branching/#cli-integration). Um servidor configurado com ela mantém o registro de branches naquele banco de dados e copia novas branches a partir dele por padrão, permitindo que o painel Branches do Studio exiba as branches do banco principal. | — |

#### CORS em desenvolvimento

O ambiente de desenvolvimento permite **o localhost, somado a tudo que `CORS_ORIGINS` (ou `FRONTEND_URL`)
especificar** — a mesma lista utilizada em produção, com o localhost adicionado em vez de
substituído. Portanto, a variável funciona da mesma forma em ambos os ambientes, e os
casos que precisam dela em desenvolvimento são os comuns:

```bash
# A phone on the LAN, a colleague's machine, an ngrok tunnel,
# a forwarded Codespaces port — all non-localhost origins.
CORS_ORIGINS=http://192.168.1.5:5173
```

Uma origem que não seja o localhost nem esteja listada será recusada, e a recusa será
registrada em log **uma vez por origem** com a linha exata que permitiria seu acesso. A recusa
não é mera cautela: a API envia credenciais, portanto refletir um
`Origin` arbitrário permitiria que qualquer site visitado pelo desenvolvedor fizesse
requisições autenticadas contra o servidor de desenvolvimento usando sua sessão e lesse as
respostas.

### Autenticação

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `JWT_SECRET` | Chave secreta para assinatura de JWT (obrigatória em produção, gerada automaticamente em desenvolvimento) | — |
| `JWT_PRIVATE_KEY` | Chave privada PEM para assinar tokens de acesso assimetricamente (RS256), para que qualquer serviço com a JWKS possa verificar uma sessão sem conseguir forjar uma. Aceita um PEM com quebras de linha reais, um PEM com escapes `\n` ou base64 do PEM completo. Sem ela, os tokens permanecem em HS256. | — |
| `JWT_KEY_ID` | Identifica a `JWT_PRIVATE_KEY` no cabeçalho do token e na JWKS. Altere-a sempre que a chave for trocada — a rotação depende da distinção entre a antiga e a nova. | `default` |
| `JWT_ACCESS_EXPIRES_IN` | Tempo de vida do token de acesso | `1h` |
| `JWT_REFRESH_EXPIRES_IN` | Tempo de vida do token de atualização (refresh). Deslizante — cada rotação o renova, controlando o tempo de sobrevivência de uma sessão mediante **inatividade**. Defina `400d` para sessões que devam durar após uma longa ausência; navegadores limitam o cookie de atualização a esse período. | `30d` |
| `ALLOW_REGISTRATION` | Permite o registro de novos usuários (`true`/`false`). Fora de produção, o **primeiro** usuário sempre pode se registrar, independentemente desta opção — uma tabela de usuários vazia precisa admitir alguém, e essa pessoa se torna o administrador. Em produção (`NODE_ENV=production`), essa janela é fechada: uma tabela vazia recusa o registro de bootstrap com `SETUP_REQUIRED`, uma primeira conta criada por registro aberto é uma conta comum, e o administrador deve ser definido com `REBASE_ADMIN_EMAIL` abaixo ou atribuído via chave de serviço. O `.env.example` do scaffold define como `true`; o padrão do framework é desativado. | `false` |
| `DISABLE_SELF_REGISTRATION` | Botão de desligamento de emergência (kill switch). Fecha a janela de bootstrap do primeiro usuário que `ALLOW_REGISTRATION=false` mantém deliberadamente aberta fora de produção, impedindo o registro mesmo contra um banco de dados vazio. Combine com `REBASE_ADMIN_EMAIL` abaixo, caso contrário o deploy não terá meios de gerar seu primeiro usuário autenticado. Todos os artefatos de deploy distribuídos a definem. | — |
| `REBASE_ADMIN_EMAIL` | E-mail da primeira conta de administrador, criada na inicialização **enquanto a tabela de usuários ainda estiver vazia** e nunca após isso. É assim que uma implantação em produção obtém seu administrador: o operador define a primeira conta em vez de disputar contra a internet aberta. A inicialização emite um aviso quando a tabela estiver vazia em produção e este valor não estiver configurado. | — |
| `REBASE_ADMIN_PASSWORD` | Senha para essa conta. Deve conter pelo menos 12 caracteres, caso contrário será recusada e a conta não será criada. Altere-a após o primeiro login. | — |
| `MFA_ENCRYPTION_KEY` | Criptografa todos os segredos TOTP armazenados. Se não configurada, os segredos são criptografados com `JWT_SECRET` e a inicialização emite um aviso — o que significa que rotacionar o `JWT_SECRET` desconectará todos *e* tornará todos os autenticadores configurados indecifráveis. Defina uma chave dedicada (32+ caracteres aleatórios) antes de qualquer usuário configurar MFA. | — |
| `MFA_ENCRYPTION_KEY_PREVIOUS` | A chave da qual se está migrando na *rotação*. Defina ambas durante o processo de rotação: novos segredos serão gravados com `MFA_ENCRYPTION_KEY` e os existentes continuarão legíveis, evitando o bloqueio de contas durante a rotação. Remova-a assim que todos os segredos tiverem sido recriptografados. | — |
| `ALLOW_ANONYMOUS` | Habilita o login anônimo (`POST /api/auth/anonymous`). Ativação opcional (opt-in) e deliberadamente não condicionada a `ALLOW_REGISTRATION`. | `false` |
| `AUTH_REQUIRE` | Exige autenticação para a API de dados. Defina como `false` para uma superfície de leitura totalmente pública — o RLS continuará sendo aplicado. | `true` |
| `AUTH_DEFAULT_ROLE` | Papel (role) atribuído a um usuário recém-registrado quando nenhum for especificado. | — |
| `AUTH_ALLOW_USER_LOOKUP` | Habilita `POST /api/auth/find-user`, que resolve um e-mail para um perfil público mínimo (`uid`, `displayName`, `photoURL`) para fluxos de convite por e-mail. Apenas chamadores autenticados têm acesso, e a rota nunca retorna o e-mail, papéis ou metadados do usuário localizado. Desativado por padrão: representa uma superfície para enumeração. | `false` |
| `AUTH_COOKIE_SAME_SITE` | `SameSite` no cookie de atualização: `Strict`, `Lax` ou `None`. `None` exige HTTPS e destina-se apenas a um frontend genuinamente cross-site. | `Lax` |
| `AUTH_COOKIE_SECURE` | Flag `Secure` no cookie de atualização. Seguro por padrão; use `AUTH_COOKIE_SECURE=false` para HTTP simples — como em uma implantação em endereço de rede local (LAN) onde o navegador descartaria o cookie e a sessão terminaria com a expiração do token de acesso sem erros aparentes. Um aviso é emitido na inicialização. `http://localhost` não requer essa alteração. | `true` |
| `GOOGLE_CLIENT_ID` | Client ID do Google OAuth (validação no backend) | — |
| `GOOGLE_CLIENT_SECRET` | Client Secret do Google OAuth | — |
| `GITHUB_CLIENT_ID` | Client ID do GitHub OAuth | — |
| `GITHUB_CLIENT_SECRET` | Client Secret do GitHub OAuth | — |
| `MICROSOFT_CLIENT_ID` | Client ID da Microsoft OAuth | — |
| `MICROSOFT_CLIENT_SECRET` | Client Secret da Microsoft OAuth | — |
| `LINKEDIN_CLIENT_ID` | Client ID do LinkedIn OAuth | — |
| `LINKEDIN_CLIENT_SECRET` | Client Secret do LinkedIn OAuth | — |
| `FACEBOOK_CLIENT_ID` | Client ID do Facebook OAuth | — |
| `FACEBOOK_CLIENT_SECRET` | Client Secret do Facebook OAuth | — |
| `TWITTER_CLIENT_ID` | Client ID do X/Twitter OAuth | — |
| `TWITTER_CLIENT_SECRET` | Client Secret do X/Twitter OAuth | — |
| `DISCORD_CLIENT_ID` | Client ID do Discord OAuth | — |
| `DISCORD_CLIENT_SECRET` | Client Secret do Discord OAuth | — |
| `GITLAB_CLIENT_ID` | Client ID do GitLab OAuth. A `baseUrl` de uma instância self-hosted não possui variável de ambiente correspondente — configure o GitLab no bloco `auth` para esse propósito. | — |
| `GITLAB_CLIENT_SECRET` | Client Secret do GitLab OAuth | — |
| `BITBUCKET_CLIENT_ID` | Client ID do Bitbucket OAuth | — |
| `BITBUCKET_CLIENT_SECRET` | Client Secret do Bitbucket OAuth | — |
| `SLACK_CLIENT_ID` | Client ID do Slack OAuth | — |
| `SLACK_CLIENT_SECRET` | Client Secret do Slack OAuth | — |
| `SPOTIFY_CLIENT_ID` | Client ID do Spotify OAuth | — |
| `SPOTIFY_CLIENT_SECRET` | Client Secret do Spotify OAuth | — |
| `APPLE_CLIENT_ID` | Apple Services ID, para login via web. É público e disponibilizado em `GET /auth/config`. A Apple não utiliza um client secret estático, pois o Rebase assina um JWT ES256 de curta duração para cada troca de token. Portanto, a Apple requer `APPLE_TEAM_ID`, `APPLE_KEY_ID` e `APPLE_PRIVATE_KEY`, além deste valor ou de `APPLE_BUNDLE_IDS`, não configurando nada sem eles. | — |
| `APPLE_BUNDLE_IDS` | IDs de bundle (separados por vírgula) dos aplicativos nativos para iOS/macOS cujos códigos do Sign in with Apple são aceitos. | — |
| `APPLE_TEAM_ID` | Team ID da Apple Developer, emissor do JWT. | — |
| `APPLE_KEY_ID` | Key ID da chave privada registrada na Apple. | — |
| `APPLE_PRIVATE_KEY` | Conteúdo do arquivo de chave privada `.p8`, incluindo as quebras de linha (escapes `\n` são aceitos). | — |
| `REBASE_SERVICE_KEY` | Chave estática de API para administração. Ignora a autenticação JWT normal para chamadas entre servidores (server-to-server) quando enviada como `Authorization: Bearer <key>`. (Gerada automaticamente em desenvolvimento). | — |
| `REBASE_PLATFORM_TOKEN_KEY` | Chave pública da plataforma de hospedagem (PEM, EC P-256) contra a qual os tokens de plataforma `rpt_` são validados; vários blocos PEM durante rotações de chave. A plataforma a define no deploy, e ela não contém dados secretos. Junto com `REBASE_PLATFORM_TOKEN_AUDIENCE`, permite que a barreira administrativa aceite um token de plataforma para `cron:read`, e para nada além disso. | — |
| `REBASE_PLATFORM_TOKEN_AUDIENCE` | O ID do projeto com o qual o `aud` do token de plataforma deve coincidir, para que um token gerado para outro projeto seja rejeitado. Se apenas uma das duas variáveis estiver definida, o servidor inicia, registra um aviso e responde a qualquer token `rpt_` com `401 PLATFORM_TOKENS_OFF`. | — |
| `REBASE_PLATFORM_SIGNIN_URL` | O destino do botão **Continue with Rebase Cloud** no painel de administração: a página do projeto no console da plataforma, que autentica os proprietários do projeto e retorna. A plataforma a define no deploy juntamente com as duas opções acima; com elas, o endpoint `POST /api/auth/platform-signin` aceita o token de um minuto `auth:admin-signin` da plataforma e inicia uma sessão administrativa. Sem ela, o acesso ainda funciona via **Open CMS** no console, e a tela de login apenas explica essa instrução. | — |
| `REBASE_RATE_LIMIT_STORE` | Onde os contadores de limite de taxa (rate limit) residem, para as rotas de autenticação e para o `rateLimit` em funções personalizadas: `memory` (por processo) ou `sql` (compartilhado entre réplicas). Um processo não enxerga a contagem de suas próprias réplicas, portanto um deploy com múltiplos nós deve explicitar isso — três réplicas no padrão aplicam três vezes o limite pretendido. Qualquer outro valor **recusa a inicialização** em vez de aplicar fallback, incluindo `postgres`. | `memory` |
| `AUTH_MAGIC_LINK` | Habilita o fluxo de login sem senha via link (magic link). Requer um serviço de e-mail configurado, caso contrário o link não terá como ser enviado. | `false` |
| `AUTH_EMAIL_OTP` | Habilita o login sem senha por meio de código de seis dígitos enviado por e-mail. Mesma exigência de configuração de e-mail descrita acima. | `false` |
| `AUTH_MAGIC_LINK_CREATES_USERS` | Cadastro sem senha: uma solicitação de magic link ou código por e-mail para um endereço desconhecido cria a conta automaticamente, desde que os registros estejam abertos. | `false` |
| `AUTH_REFRESH_TOKEN_REUSE` | Ação tomada quando um token de atualização é reutilizado fora da sua janela de tolerância: `reject` (recusa a requisição, mantém a sessão) ou `revoke-session` (encerra a sessão autenticada). Qualquer outro valor impede a inicialização. | `reject` |
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | Registro com confirmação prévia: nenhum login por senha é permitido até que o endereço de e-mail seja verificado. Requer e-mail configurado; a inicialização será recusada sem isso. | `false` |
| `CAPTCHA_PROVIDER` | Habilita a verificação por captcha nas rotas de autenticação: `turnstile` ou `hcaptcha`. Deixar em branco desativa o captcha. | — |
| `CAPTCHA_SECRET` | O segredo do provedor, utilizado pelo servidor para validar o token enviado pelo navegador. Obrigatório quando `CAPTCHA_PROVIDER` for configurado. | — |
| `CAPTCHA_ROUTES` | Rotas de autenticação (separadas por vírgula) que devem ser protegidas (por exemplo, `register,login`). Se não definido, protege o conjunto padrão do provedor. | — |

### Armazenamento

:::caution[O armazenamento não possui segurança a nível de linha, portanto precisa de um modelo de acesso]
Tabelas são protegidas pelo RLS do Postgres. O armazenamento de objetos não possui mecanismo equivalente —
as chaves compartilham um namespace único e plano — portanto, com um bucket configurado e sem um modelo de acesso,
o servidor **recusa a inicialização em produção**. Atenda a essa exigência com exatamente uma das seguintes opções:
um hook `storageAuthorize` exportado de `backend/storage.ts` (modelo padrão do scaffold),
`STORAGE_POLICIES`, `STORAGE_PUBLIC_READ` ou `STORAGE_ALLOW_ANY_AUTHENTICATED`.
:::

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `STORAGE_TYPE` | Backend de armazenamento: `local`, `s3`, `gcs` ou `platform` (arquivos em um prefixo pertencente à plataforma de hospedagem, transferidos via URLs assinadas por seu broker de armazenamento; configurado pela plataforma). Em produção, `local` desativa o armazenamento a menos que `FORCE_LOCAL_STORAGE=true` | `local` |
| `STORAGE_PATH` | Caminho base para armazenamento local. Um caminho relativo é interpretado a partir do diretório em que o servidor é executado: a raiz do projeto no `rebase dev`, ou `backend/` em um servidor gerado por `rebase eject` | `<project>/uploads` |
| `FORCE_LOCAL_STORAGE` | Permite armazenamento local em produção — apenas com um volume persistente mantendo o `STORAGE_PATH` e os diretórios `<STORAGE_PATH>__<key>` dos buckets locais nomeados ao lado dele | `false` |
| `STORAGE_DOWNLOAD_TOKEN_TTL` | Segundos durante os quais a URL de download de um arquivo privado permanece válida — o token adicionado por `getSignedUrl()`. Máximo de `604800` (uma semana) | `300` |
| `STORAGE_MAX_FILE_SIZE` | Tamanho máximo de arquivo aceito pela fonte, em bytes, em todos os caminhos de upload — `__<KEY>` para uma fonte nomeada. Um valor que não seja um número inteiro de bytes recusa a inicialização | `52428800` (50 MB) |
| `S3_BUCKET` | Nome do bucket S3 (quando `STORAGE_TYPE=s3`) | — |
| `S3_REGION` | Região AWS | — |
| `S3_ACCESS_KEY_ID` | Chave de acesso AWS | — |
| `S3_SECRET_ACCESS_KEY` | Chave secreta AWS | — |
| `S3_ENDPOINT` | Endpoint S3 personalizado (para MinIO, Cloudflare R2, etc.) | — |
| `S3_FORCE_PATH_STYLE` | Força URLs no estilo path-style para o bucket S3 (`true`/`false`) | `false` |
| `GCS_BUCKET` | Nome do bucket GCS (quando `STORAGE_TYPE=gcs`) | — |
| `GCS_PROJECT_ID` | Projeto GCP. Geralmente inferido a partir das credenciais. | — |
| `GCS_KEY_FILENAME` | Caminho para o arquivo de chave de service-account. Omita no GCP se o Workload Identity fornecer as credenciais. | — |
| `STORAGE_PUBLIC_READ` | Serve todos os objetos para qualquer pessoa, sem exigência de token. Indicado apenas para buckets que operem autenticamente como uma CDN pública. Uma das formas de satisfazer a trava de inicialização mencionada acima. | `false` |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Permite que qualquer usuário autenticado leia, grave, liste e exclua todos os objetos. Nomeado como `INSECURE` no objeto de configuração por um motivo: defensável apenas em aplicações single-tenant onde todas as contas têm autorização para acessar qualquer arquivo. | `false` |
| `STORAGE_POLICIES` | Regras de acesso ao armazenamento em JSON: `[{ "path", "operations"?, "allow" }]`, onde `allow` pode ser `"public"`, `"authenticated"`, `"owner"` ou `{ "roles": [...] }`. Bloqueia o acesso por padrão (deny by default) e satisfaz a trava de inicialização. Uma lista inválida recusa o boot. Consulte [Autorização de armazenamento](/docs/backend/storage-authorization/#as-data-storage_policies). | — |
| `STORAGE_BROKER_URL` | O broker de armazenamento da plataforma, para `STORAGE_TYPE=platform`. Configurado pela plataforma que executa o broker. | — |
| `STORAGE_BROKER_PROJECT` | O ID do projeto ao qual o broker delimita o escopo dos arquivos deste deploy, para `STORAGE_TYPE=platform`. Configurado pela plataforma. | — |
| `STORAGE_RENDITION_CACHE` | Armazena em cache rendições de imagens geradas (redimensionamentos, conversões de formato) em vez de gerá-las a cada requisição. | `false` |

### E-mail (Opcional)
`MAGIC_LINK_URL`.

| Variável | Descrição |
|----------|-----------|
| `SMTP_HOST` | Host do servidor SMTP |
| `SMTP_PORT` | Porta do servidor SMTP |
| `SMTP_SECURE` | Habilita conexão segura (`true`/`false`) |
| `SMTP_USER` | Usuário SMTP |
| `SMTP_PASS` | Senha SMTP |
| `SMTP_FROM` | Endereço do remetente para e-mails do sistema |
| `SMTP_NAME` | Nome de exibição no endereço do remetente |
| `APP_NAME` | Nome do produto utilizado nos assuntos e corpos dos e-mails (padrão: `Rebase`) |
| `EMAIL_LOGO_URL` | Logotipo exibido no topo dos modelos de e-mail padrão. PNG ou JPG com URL absoluta em `http(s)` — clientes de e-mail removem SVG e bloqueiam URIs `data:`. Se não definido, um app que mantiver o nome `Rebase` exibirá a marca do Rebase e um app renomeado não exibirá nenhuma |
| `MAGIC_LINK_URL` | O destino de um magic link enviado por e-mail. Se for informada uma URL base, ela terá `/auth/magic-link?token=…` anexado; uma URL contendo `{token}` será tratada como o link completo, para um frontend que não responda em `/auth/magic-link`. Use aspas no `.env`, pois um caractere `#` sem aspas inicia um comentário: `MAGIC_LINK_URL="https://app.example.com/app.html#ml={token}"`. Um valor contendo hash ou caminho de arquivo sem `{token}` emitirá um aviso na inicialização. Se não configurado, a base será `FRONTEND_URL` |

### Pool de conexões do banco de dados

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `DB_POOL_MAX` | Número máximo de conexões no pool | `20` |
| `DB_POOL_IDLE_TIMEOUT` | Tempo em milissegundos que uma conexão ociosa é mantida | `30000` |
| `DB_POOL_CONNECT_TIMEOUT` | Tempo limite em milissegundos para aguardar uma conexão | `10000` |
| `DATABASE_DIRECT_URL` | Conexão direta (sem pooler). O recurso de [Realtime](/docs/backend/realtime) necessita de uma: `LISTEN`/`NOTIFY` não funciona através de poolers em modo transação como o PgBouncer, e sem ela as notificações de alterações são desativadas com um aviso em vez de serem perdidas silenciosamente. O [job worker](/docs/backend/jobs) também mantém seu `LISTEN` de ativação através dela. Preenche a opção `directConnectionString` do adaptador Postgres quando ela estiver indefinida. | — |
| `DATABASE_READ_URL` | Réplica de leitura, como um hot standby. Quando aponta para outro servidor, leituras autenticadas (listas, linhas únicas, contagens, agregações) são atendidas por ele sob a mesma segurança a nível de linha; operações de escrita, autenticação, realtime, crons, jobs, o console SQL e `rebase.sql` permanecem no nó primário. Um leitor que acabou de gravar lê do nó primário pelo intervalo de `REBASE_READ_STICKY_MS`, e todos passam a ler do primário se a réplica estiver com atraso superior a `REBASE_READ_MAX_LAG_MS` ou apresentar falhas. Preenche a opção `readConnectionString` do adaptador Postgres quando ela estiver indefinida; até a versão 0.28 (inclusive), o pool da réplica era aberto mas nunca lido. | — |
| `REBASE_READ_STICKY_MS` | Após uma gravação, tempo em que as leituras do mesmo usuário continuam sendo direcionadas ao nó primário, garantindo que um salvamento seguido de uma listagem reflita as alterações. Definido por instância de servidor. | `5000` |
| `REBASE_READ_MAX_LAG_MS` | Limite de atraso (lag) da réplica a partir do qual todas as leituras são redirecionadas ao nó primário. | `1000` |
| `DATABASE_POOLED` | `true` quando `DATABASE_URL` passar por um pooler em modo transação como o PgBouncer. O pool deixa de enviar `search_path` ou `statement_timeout` na conexão (o pooler os recusaria ou descartaria) e define ambos em cada transação; a inicialização define o `search_path` padrão do papel do banco de dados como `public` para instruções fora de transações. `DATABASE_DIRECT_URL` torna-se obrigatória, e realtime, a ativação do job worker, criações de índices, branching e o console SQL passam a usá-la. A URL da réplica também é considerada sob pool. Use `DATABASE_POOLED__<KEY>` para outra fonte de dados. | — |
| `REBASE_DB_POOL_MAX` | Teto global para todos os pools no processo, aplicado independentemente do solicitado por cada um. Apenas dígitos numéricos: um valor malformado é ignorado em vez de serializar silenciosamente as operações do servidor. | — |

### Comportamento em tempo de execução (Runtime)

Lido pelo runtime — `rebase dev`, `rebase start` e a imagem oficial do servidor.
Um projeto que passou por eject gerencia essas decisões diretamente em seu próprio código.

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `REBASE_RLS_AUDIT` | `true` executa a auditoria agendada de [row-level security](/docs/rls-check#running-it-on-a-schedule), que relata tabelas servidas sem políticas associadas. O projeto deve declarar `@rebasepro/rls-check` entre suas dependências: o runtime não inclui uma cópia e, sem o pacote, o boot recusa a inicialização apontando o pacote faltante. `false` desativa a verificação neste processo. | — |
| `REBASE_RLS_REQUEST_ROLE` | O papel (role) do Postgres com o qual requisições autenticadas e anônimas são executadas. Defina um específico para cada projeto em um cluster compartilhado. O banco de dados registra o papel utilizado, e uma inicialização configurada para outro papel recusa-se a iniciar até que `rebase db request-role migrate` faça a migração. Consulte [Executando em um banco de dados existente ou compartilhado](/docs/deployment/existing-database/). | `rebase_user` |
| `REBASE_RLS_PROVISION_ROLE` | `auto` cria o papel de requisição e permite a alternância de conexão para ele; `never` deixa a criação e permissão a seu encargo, realizando apenas a checagem. | `auto` |
| `REBASE_RLS_GRANTS` | O que o Rebase concede ao papel de requisição: `schema` (todas as tabelas nos esquemas servidos, além de privilégios padrão), `managed` (apenas as tabelas servidas por ele) ou `none`. | `schema` |
| `REBASE_RLS_POLICY_TARGET` | `requestRole` restringe as políticas permissivas do Rebase ao(s) papel(is) de requisição, evitando que outros papéis que leem as mesmas tabelas obtenham acesso através delas. | `public` |
| `REBASE_RLS_ADMIN_POLICIES` | `public` escreve as políticas que apenas o contexto do servidor ou um administrador podem satisfazer `TO public`, e executa administradores sob o papel de requisição. Por padrão são definidas `TO rebase_admin`, permitindo que leituras com escopo de proprietário feitas por usuários autenticados aproveitem o índice de proprietário. Consulte [Requisições de administração e `rebase_admin`](/docs/deployment/existing-database/#admin-requests-and-rebase_admin). | `adminRole` |
| `REBASE_RLS_DEFAULT_POLICIES` | `false` remove a política padrão de baseline do servidor-ou-administrador de todas as tabelas. | `true` |
| `REBASE_RLS_IDENTITY` | `supabase` também define `request.jwt.claims` e `request.jwt.claim.*`, de modo que políticas escritas com `auth.uid()` consigam identificar o chamador. | `rebase` |
| `REBASE_RLS_SHARED_ROLE` | Comportamento da inicialização quando outro usuário do banco puder alternar para o papel de requisição: `warn`, `refuse` ou `ignore`. | `warn` |
| `REBASE_BASE_PATH` | Caminho base para todas as rotas da API. O cliente deve ser configurado com o mesmo valor — veja [Alterando `basePath`](#alterando-o-basepath). | `/api` |
| `REBASE_SERVE_STATIC` | Serve os assets estáticos/administrativos do bundle a partir deste processo. Desative se houver uma CDN à frente. | `true` |
| `REBASE_STUDIO` | Disponibiliza o painel de administração integrado em `/_studio` quando seu bundle estático estiver acessível: as tabelas do projeto como coleções, seus usuários e papéis, e a interface do Studio. É a ferramenta pela qual um projeto sem código é gerenciado. Defina como `false` para desativar. | `true` |
| `REBASE_STUDIO_DIR` | Diretório contendo o painel de administração pré-compilado servido em `/_studio`. O padrão é `/studio` na imagem de container. | `/studio` |
| `REBASE_HISTORY` | Registra o [histórico de alterações de entidades](/docs/backend/history). | `true` |
| `REBASE_COMPRESSION` | Ativa a compactação gzip/brotli nas respostas. | `true` |
| `REBASE_PUSH` | `true` ativa o envio de [notificações push](/docs/backend/push-notifications/): as rotas `/api/push`, a tabela `rebase.push_subscriptions` e `rebase.push`. | `false` |
| `REBASE_VAPID_PUBLIC_KEY`, `REBASE_VAPID_PRIVATE_KEY` | Par de chaves VAPID com as quais mensagens push são assinadas. Fora de produção, um par é gerado e mantido em `.rebase-dev-secrets.json` caso não informado; em produção, o push permanece desativado sem elas. | — |
| `REBASE_VAPID_SUBJECT` | Um endereço `mailto:` ou URL `https://` para contato pelos serviços de push. O padrão é a origem de uma `REBASE_PUBLIC_URL` sob `https`. | — |
| `REBASE_MAX_BODY_SIZE` | Tamanho máximo do corpo da requisição, **em bytes** (`10485760`, não `10MB` — um valor que não seja um número recusa o boot em vez de desativar o limite silenciosamente). `0` remove o limite. | `10485760` (10 MiB) |
| `REBASE_ENABLE_SWAGGER` | Superfície OpenAPI. Estado triplo. Se não definido, em qualquer ambiente: `/api/docs` é disponibilizado para os chamadores para os quais `GET /api/schema/tables` descreve tabelas, contendo o documento das tabelas às quais têm acesso, e não há interface Swagger UI. `true` publica o documento completo publicamente, com a **Swagger UI** em `/api/swagger` fora de produção (nunca em produção). `false` mantém o documento protegido sob a barreira de admin. | — |
| `REBASE_DEPLOYMENT_ID` | Identificador da implantação que este processo executa, conforme nomeado pela plataforma; indicado na linha de log que confirma a escuta do runtime. Configurado pelo Rebase Cloud. | — |
| `REBASE_METRICS` | Expõe métricas do Prometheus no endpoint `/metrics`. | `false` |
| `REBASE_HSTS_INCLUDE_SUBDOMAINS` | Adiciona `includeSubDomains` ao cabeçalho `Strict-Transport-Security`, fazendo com que os navegadores recusem HTTP simples em todos os subdomínios do host por seis meses — incluindo hosts não atendidos por este processo. Ative apenas quando todos os subdomínios utilizarem estritamente HTTPS. Qualquer valor diferente de `true`/`false` recusa a inicialização. Consulte [Cabeçalhos de segurança](/docs/deployment/self-hosting/#security-headers). | `false` |
| `REBASE_METRICS_TOKEN` | Bearer token que protege `/metrics`. Se não definido, deixa o endpoint acessível a qualquer serviço com alcance à porta — aceitável em rede privada, inadequado em rede pública, conforme alertado nos logs de inicialização. | — |
| `REBASE_MIGRATE_ON_BOOT` | O que o runtime pode fazer com o esquema das tabelas na inicialização. `ensure` (o padrão, em qualquer lugar — inclusive em produção) executa a passagem **aditiva**: cria tabelas, colunas e tipos enum ausentes, nunca descartando ou reescrevendo estruturas existentes. `none` não altera o esquema das tabelas declaradas, mas as tabelas do próprio framework (auth, chaves de API, jobs, cron) continuam sendo criadas e atualizadas; `REBASE_PROVISION=false` desativa essas também. A imagem publicada aceita apenas essas duas opções e **recusa a inicialização com `push`**. Em um [deploy dividido (split deployment)](/docs/deployment/split-processes), exatamente um processo pode provisionar; todos os outros papéis devem definir `none` ou o boot falhará. | `ensure` |
| `REBASE_PROVISION` | `false` impede o runtime de modificar qualquer elemento em seu banco de dados: nenhuma tabela, coluna, índice, função, trigger, política, papel ou grant, seja no boot ou posteriormente, incluindo os do próprio framework. Em vez disso, reporta nominalmente o que está faltando. Indicado para bancos de dados onde alterações só podem ser feitas pelo seu processo formal de migração. Consulte [Quando apenas seu processo de mudanças pode alterar o banco de dados](/docs/deployment/self-hosting/#when-only-your-change-process-may-change-the-database). Apenas `true` e `false` são aceitos. | `true` |
| `REBASE_REQUIRE_SCHEMA_MATCH` | Recusa o boot quando o banco de dados tiver sido provisionado pela última vez a partir de um conjunto de tabelas diferente daquele para o qual este processo foi compilado. Se indefinido (ou qualquer valor diferente de `true`/`1`), apenas emite um aviso. | warn |
| `REBASE_REQUIRE_FILES_LOADED` | Recusa o boot quando um arquivo de função ou cron lançar erro ou não puder ser analisado durante a importação, apontando cada arquivo e a causa, garantindo que um deploy progressivo (rolling deploy) mantenha a versão antiga servindo requisições. Uma reinicialização também respeita essa trava. Se indefinido (ou qualquer valor diferente de `true`), ignora o arquivo com erro e serve o restante. Um arquivo importado sem falhas que não exporte funções ou jobs é sempre ignorado, sem recusa. | skip |
| `REALTIME_CDC` | Captura de alterações a nível de banco de dados (Change Data Capture): `auto` (lê alterações do WAL onde o banco permitir; caso contrário usa triggers; em última instância adota o nível de aplicação, registrando cada fallback como info), `trigger` (força o uso de triggers, emite aviso se impossível), `wal` (lê alterações do write-ahead log em vez de triggers; exige `wal_level=logical` e um papel com permissão de replicação, recorrendo a `trigger` caso contrário), `off`. Consulte [Realtime](/docs/backend/realtime-cdc/). Tem precedência sobre `realtime.cdc`. | `auto` |
| `REALTIME_CHANNEL_BUS` | Transporte entre instâncias para canais de broadcast e presença: `memory` ou `postgres`. Ignorado caso um transporte instanciado tenha sido informado em `realtime.bus`. | `memory` |
| `REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET` | Quantidade máxima de inscrições que um único socket realtime pode manter; a próxima inscrição é recusada com `TOO_MANY_SUBSCRIPTIONS`. Requer um número inteiro positivo — qualquer outro valor interrompe o servidor no boot. Tem precedência sobre `realtime.maxSubscriptionsPerSocket`. Consulte [Realtime](/docs/backend/realtime#what-a-write-costs-and-the-limits). | `1000` |
| `REALTIME_MAX_SOCKETS_PER_USER` | Quantidade máxima de sockets realtime que um único usuário, ou uma chave de API, pode manter abertos em uma instância de servidor. Sockets com personificação de administradores contam contra o próprio administrador. A próxima conexão é recusada com `TOO_MANY_SOCKETS` e o socket é encerrado (4002); o SDK continuará tentando se reconectar, obtendo acesso assim que outro socket for fechado. Requer um número inteiro positivo — qualquer outro valor interrompe o servidor na inicialização. Tem precedência sobre `realtime.maxSocketsPerUser`. | Sem limite |
| `REALTIME_REFETCH_MAX_WAIT_MS` | Tempo máximo que uma alteração aguarda pela reconsulta (refetch) que a entrega aos inscritos ativos, em ms. Uma reconsulta aguarda 300 ms sem novas alterações, e no máximo este tempo sob fluxo constante de escritas. Deve ser um número inteiro positivo — qualquer outro valor interrompe o servidor no boot. Tem precedência sobre `realtime.refetchMaxWaitMs`. | `1000` |
| `REALTIME_RECOUNT_INTERVAL_MS` | Intervalo em ms durante o qual o total de uma inscrição de listagem grande pode ser reutilizado antes de ser recalculado; frames que o reutilizam contêm `meta.totalAsOf`. Se não definido, cada frame realiza a contagem. Tem precedência sobre `realtime.recountIntervalMs`. | Indefinido |
| `REALTIME_RECOUNT_MIN_ROWS` | O menor total anterior ao qual `REALTIME_RECOUNT_INTERVAL_MS` se aplica; listas menores têm seus registros contados em cada frame. Tem precedência sobre `realtime.recountMinRows`. | `100000` |
| `ALLOW_LOCALHOST_IN_PRODUCTION` | Permite valores de `localhost`/loopback sob `NODE_ENV=production`. Desativado por padrão, garantindo que uma inicialização em produção falhe expressivamente em vez de conectar-se a um banco de dados inexistente. | `false` |
| `REBASE_PROVISION_ONLY` | `1`/`true` executa a validação/aplicação do esquema e encerra sem abrir nenhum socket — o formato ideal para um Job de migração, a partir da mesma imagem e do mesmo bundle do servidor subsequente. Também cria as tabelas que um processo de atendimento criaria em seu primeiro uso, e não inicia filas de cron ou jobs. Um valor vazio é considerado *indefinido*, impedindo que um `${SOMETHING}` não substituído em um arquivo compose transforme um deploy comum em um processo de migração que recusa conexões. Recusado se utilizado em conjunto com `REBASE_PROVISION=false`. | — |
| `REBASE_PROVISION_SQL_OUT` | Caminho de arquivo. Uma execução de provisionamento (`REBASE_PROVISION_ONLY=true`) grava nela todas as alterações de esquema realizadas, em ordem cronológica, como um script SQL para revisão e aplicação via `psql`. Linhas de dados inseridas não são incluídas. Recusado em um processo que atende requisições. | — |
| `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` | `true` permite que uma máquina — um agente, um job de CI — *aplique* alterações de esquema por meio de `/api/admin/schema`, não apenas as planeje. Desativado a menos que expressamente solicitado: a credencial que realizaria tal alteração é a mais propensa a estar armazenada em uma variável de CI. | `false` |
| `REBASE_FUNCTIONS_TIMEOUT_MS` | Tempo máximo de execução de uma função personalizada antes do cancelamento da requisição. Possui o mesmo efeito da opção `functionsTimeoutMs`. `0` desativa o timeout. Uma função que declare seu próprio timeout (`defineFunction(…, { timeoutMs })`) usará seu valor específico. | `30000` |
| `REBASE_FUNCTIONS_MAX_TIMEOUT_MS` | O timeout mais longo que uma função pode declarar para si mesma via `defineFunction(…, { timeoutMs })`, em ms; uma função que solicite mais receberá este teto. Deve ser um número positivo; qualquer outro valor é interpretado como indefinido. | `300000` |
| `REBASE_EXIT_ON_UNHANDLED_REJECTION` | `true` faz com que uma rejeição de promise não tratada encerre o processo em vez de apenas registrá-la em log. Recomendado sob orquestradores que realizem o reinício do processo; desative onde uma reinicialização for mais prejudicial do que um vazamento. | `false` |
| `REBASE_CRON_ALWAYS_ON` | Silencia o aviso de inicialização em plataformas identificadas pelo runtime como scale-to-zero, onde um timer acionado em uma instância inativa seria disparado em nenhuma instância. Não altera nenhum outro comportamento: ative se mantiver pelo menos uma instância sempre ativa. | — |
| `TRUSTED_PROXY_HOPS` | Quantidade de proxies à frente deste servidor, permitindo que o rate limiter extraia o endereço IP real do cliente a partir do cabeçalho `X-Forwarded-For`. Padrão seguro `0`: sem nenhum proxy intermediário, confiar nesse cabeçalho permitiria a qualquer chamador forjar sua identidade. | `0` |

:::note[O provisionamento de inicialização é aditivo e não uma ferramenta de migração]
A etapa de inicialização executa de forma desacompanhada sem que ninguém avalie um diff, portanto nunca
removerá uma coluna, restringirá um tipo de dado ou reescreverá uma tabela. É também por isso que a imagem recusa
`REBASE_MIGRATE_ON_BOOT=push`: um push completo calcula um diff e executará alegremente
`DROP COLUMN`, e o reinício de um container nunca deve ser capaz de destruir uma
coluna em produção como efeito colateral de um reagendamento de pods.

Alterações destrutivas ou de reformulação devem permanecer em locais onde possam ser revisadas: `rebase db
generate` + `rebase db migrate`, ou `rebase db push` a partir de um checkout ou CI,
que simula a alteração (dry-run), recusa comandos destrutivos sem confirmação e
pode realizar um backup previamente.
:::

### Implantações divididas (Split deployments)

Uma mesma imagem e um mesmo bundle podem ser inicializados diversas vezes, cada instância
atendendo a uma parte distinta do projeto. Abaixo listamos as variáveis resumidamente;
o escopo do que cada combinação *carrega e gerencia* — e quais
combinações recusam a inicialização — está documentado em
**[Processos Divididos](/docs/deployment/split-processes)**.

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `REBASE_ROLE` | Qual função este processo atende: `all`, `api`, `functions` ou `worker`. | `all` |
| `REBASE_CRON_SCHEDULER` | Sobrescreve se *este* processo executa os agendadores de cron. Se indefinido, segue o papel definido em `REBASE_ROLE`. | — |
| `REBASE_JOB_WORKERS` | Sobrescreve se este processo executa os workers da fila de jobs. Se indefinido, segue o papel definido em `REBASE_ROLE`. | — |
| `REBASE_FUNCTIONS_ONLY` | Atende exclusivamente as funções personalizadas especificadas neste processo. | — |
| `REBASE_FUNCTIONS_EXCLUDE` | Atende todas as funções personalizadas, exceto as especificadas. | — |
| `REBASE_FUNCTIONS_UPSTREAM` | Para onde o processo de API encaminha requisições de funções que ele próprio não atende. Em um `worker`, para onde suas próprias chamadas a `rebase.functions` são direcionadas. Uma URL `http(s)`. | — |

### Superfície MCP

Um endpoint opcional de Model Context Protocol em `/mcp`, permitindo que clientes de IA leiam
e gravem neste projeto **atuando como o usuário autenticado**. Desativado por padrão e — ao
contrário de outras interfaces — nenhum `REBASE_ROLE` o ativa automaticamente: os outros papéis
descrevem a estrutura do processo, enquanto este representa a decisão deliberada de fornecer credenciais a
softwares de terceiros, devendo ser uma escolha feita por uma pessoa em vez de herdada da
função de um container.

O comando `rebase dev` define `REBASE_MCP_ENABLED=true` para o backend que inicializa, a menos
que o shell ou o `.env` já contenham uma linha a respeito, e esse backend define seu próprio
`http://localhost:<port>` como URL pública quando `REBASE_PUBLIC_URL` não for fornecida.
Nenhum outro comando faz isso: processos de produção exigem a definição de ambas as variáveis.

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `REBASE_MCP_ENABLED` | Habilita a superfície MCP. Requer `REBASE_PUBLIC_URL`; sem ela, o endpoint não é montado e um alerta é emitido no log de inicialização. | `false` |
| `REBASE_PUBLIC_URL` | A origem acessível externamente deste deploy, por exemplo, `https://app.example.com`. A superfície MCP não consegue derivá-la — obter a origem do cabeçalho `Host` tornaria a identidade do emissor, bem como o público (audience) contra o qual seus tokens são verificados, um valor fornecido pelo chamador. | — |
| `REBASE_MCP_VIEW` | Caminho para a visualização do próprio MCP App do projeto (`rebase-view.html`, gerado por `rebaseMcpViewPlugin()`), servido ao Claude no lugar da visualização genérica, exibindo suas views, campos e ações customizadas. Sem ela, o backend busca o arquivo junto ao frontend que serve. | — |
| `REBASE_MCP_OPEN_REGISTRATION` | Permite o registro dinâmico de clientes OAuth (RFC 7591), permitindo que um cliente se registre automaticamente. Defina como `false` para exigir o registro prévio de clientes. | `true` |

### Edição de esquema em tempo real a partir de um bundle

Desativada a menos que `REBASE_LIVE_SCHEMA_REPOSITORY` esteja definida. Um bundle compilado não contém o
código fonte em `backend/schema` para edição, portanto, com essas variáveis configuradas, o editor de esquema lê
o fonte a partir do repositório, realiza o commit de volta de cada alteração e aplica seu DDL
neste banco de dados. Exclusivo para administradores, e aplicado manualmente por uma pessoa, a menos que
`REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` determine o contrário. Um repositório configurado
sem credenciais válidas recusa o boot. Consulte
[Edição de esquema em tempo real](/docs/backend/live-schema-editing#from-a-built-bundle).

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `REBASE_LIVE_SCHEMA_REPOSITORY` | O repositório do GitHub no qual aplicar os commits de alterações de esquema, no formato `owner/name`. A definição desta variável ativa a funcionalidade. | — |
| `REBASE_LIVE_SCHEMA_BRANCH` | A branch na qual o commit será realizado. | `main` |
| `REBASE_LIVE_SCHEMA_PATH` | Onde `backend/schema` está localizado no repositório, relativo à raiz do repositório. Um caminho que aponte para fora do repositório recusa a inicialização, assim como o antigo `REBASE_LIVE_SCHEMA_COLLECTIONS_PATH`. | `backend/schema` |
| `REBASE_LIVE_SCHEMA_GITHUB_TOKEN` | Um token de acesso granular (fine-grained token) com permissões de leitura e escrita no conteúdo do repositório. Defina este token ou as três variáveis `_GITHUB_APP_*`, nunca ambos os métodos. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_ID` | O ID do GitHub App, para realizar commits como o aplicativo em vez de usar um token. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_INSTALLATION_ID` | O ID de instalação do aplicativo no repositório em questão. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_PRIVATE_KEY` | A chave privada do aplicativo: PEM, PEM com quebras de linha escapadas ou base64. | — |

### Backups

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `BACKUP_SCHEDULE` | Expressão cron para backups agendados. Não definida significa backups agendados desativados. | — |
| `BACKUP_DESTINATION` | Caminho local ou uma URL `s3://bucket/prefix` / `gs://bucket/prefix`. Obrigatória junto com `BACKUP_SCHEDULE`, que não é executado sem ela. O comando `rebase db backup` usa por padrão `./backups` no local de execução. | — |
| `BACKUP_RETENTION_DAYS` | Exclui backups com mais de N dias. Não definido ou `0` mantém todos os backups. | — |
| `BACKUP_KEEP_MINIMUM` | Mantém sempre pelo menos N dos backups mais recentes, independentemente da retenção configurada. | — |
| `PG_DUMP_PATH` | Sobrescreve o binário `pg_dump` — deve corresponder à versão principal do servidor ou mais recente. | — |
| `PG_RESTORE_PATH` | Sobrescreve o binário `pg_restore`. | — |
| `PSQL_PATH` | Sobrescreve o binário `psql` executado por `rebase db restore --clean` para processar a restauração em uma única transação. | — |
| `PG_DUMPALL_PATH` | Onde o binário `pg_dumpall` está localizado, quando ausente no `PATH`. Sem ele — e sem as ferramentas de cliente do PostgreSQL instaladas — um backup global falhará com erro apontando esta variável. | — |

A imagem de runtime oficial (`rebasepro/server`) inclui as ferramentas de
cliente do PostgreSQL 18, de forma que um backup agendado é executado nela contra qualquer servidor até o Postgres 18.
Fora dessa imagem, instale-as manualmente (`apt-get install postgresql-client-18`,
`brew install libpq`).

Backups contêm dados sigilosos e PII. Utilize um destino privado com
criptografia em repouso (encryption-at-rest).

### Entrega de bundles

Um deploy gerenciado não inclui seu código na imagem: o runtime faz o download de um
bundle durante a inicialização. As variáveis a seguir determinam qual bundle obter e como.

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `REBASE_BUNDLE` | Caminho para um diretório de bundle já descompactado. Valor configurado localmente pelo comando `rebase start`. | — |
| `REBASE_BUNDLE_URL` | De onde fazer o download do arquivo compactado do bundle, quando não houver um local. | — |
| `REBASE_BUNDLE_TOKEN` | A credencial bearer para essa requisição de download. Trate-a como um segredo: é ela que autoriza o tenant a baixar seu próprio código. | — |
| `REBASE_BUNDLE_FETCH_DIR` | Onde o bundle baixado é extraído. Deve ter permissão de escrita e persistir entre o download e a inicialização. | — |
| `REBASE_RUNTIME_MODULES` | Módulos adicionais que a imagem de runtime disponibiliza para o bundle, além dos declarados por ele próprio. | — |

### Vinculação de recursos (Resource bindings)

Cada banco de dados, bucket e tópico declarado por um projeto em `backend/resources.ts` é
vinculado por variáveis de ambiente correspondentes ao seu nome. Os nomes base encontram-se abaixo; um
recurso personalizado anexa `__` e sua respectiva chave em letras maiúsculas, de forma que um bucket chamado
`media` lerá `S3_BUCKET__MEDIA`. O comando `rebase status`
exibe, para cada recurso,
a variável exata consultada e se ela está configurada.

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `REBASE_DRIVER` | O pacote npm que implementa o driver de uma fonte de dados, quando não for o padrão Postgres. Com sufixo por fonte: `REBASE_DRIVER__ANALYTICS`. | — |
| `REBASE_TOPIC_URL` | A string de conexão para um tópico declarado. Com sufixo por tópico. | — |

### O ambiente da própria CLI

Lido pelo comando `rebase`, e não pelo servidor. Nada nesta seção afeta uma implantação em produção.

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `REBASE_BASE_URL` | Onde os comandos `rebase api-keys`, `rebase storage` e `rebase auth reset-password` enviam a chave de serviço, seja no shell ou via `.env`. Defina se o servidor for executado de forma diferente de `rebase dev` neste projeto: como `rebase start`, em container ou em outro host. Se não definido, eles usam o servidor registrado pelo `rebase dev` enquanto ele estiver ativo, e nada enviam se não estiver. | — |
| `REBASE_SERVICE_KEY` | A chave de serviço com a qual esses comandos se autenticam, lida do `.env`: a mesma variável lida pelo servidor (veja acima). | — |
| `SERVICE_KEY` | Nomenclatura legada dessa chave. Quando definida no `.env`, `rebase api-keys` e `rebase storage` a utilizam no lugar de `REBASE_SERVICE_KEY`. | — |
| `REBASE_ENV_FILE_PATH` | Qual arquivo `.env` a CLI lê e grava, caso seja diferente do arquivo padrão do projeto. | — |
| `REBASE_ROOT_RULES` | `0` impede que `rebase init` e `rebase skills install` escrevam as regras do projeto nos arquivos `CLAUDE.md` e `AGENTS.md` na raiz do repositório, útil para repositórios onde os arquivos de agentes são mantidos manualmente. | on |
| `REBASE_CLOUD_URL` | O control plane com o qual o `rebase cloud` se comunica. | — |
| `REBASE_CLOUD_EMAIL` | A conta com a qual `rebase cloud login` autentica, em vez de solicitar interativamente. | — |
| `REBASE_CLOUD_PASSWORD` | A senha dessa conta, permitindo que um gerenciador de segredos a forneça sem expô-la no histórico do shell. | — |
| `REBASE_TOKEN` | Um token gerado por `rebase cloud tokens create`. Quando definido, todos os comandos `rebase cloud` se autenticam com ele no lugar da sessão de `rebase cloud login`, sem nunca ler ou gravar a sessão local. Em um diretório vinculado via `rebase cloud init --claim`, ele é reservado para o próprio token daquele projeto caso não possua escopo sobre ele. A forma indicada para rodar `rebase cloud` em CI — consulte [CI e agentes](/docs/deployment/cloud/#ci-and-agents). O [servidor MCP](/docs/ai/mcp/) o repassa para a CLI invocada pelas suas ferramentas de cloud, nunca o enviando para o aplicativo: use `REBASE_API_TOKEN` para essa finalidade. | — |
| `REBASE_DEBUG` | `1` exibe o erro subjacente e os detalhes completos da requisição em vez de apenas a mensagem curta. Primeira opção a ser definida quando um comando `rebase cloud` falhar sem detalhes suficientes. | — |
| `REBASE_ATLAS_DEV_URL` | O banco de dados vazio contra o qual `rebase db push`, `db generate` e `db migrate` calculam o planejamento, em vez do `<db>_dev_diff` criado ao lado de `DATABASE_URL`. O Rebase não cria nem descarta o banco nomeado aqui, e recusa um valor idêntico a `DATABASE_URL`. No banco de desenvolvimento gerenciado, a CLI o define para uma instância descartável em memória do PGlite. Defina em ambientes onde a permissão `CREATE DATABASE` não for concedida. | `<db>_dev_diff` |
| `REBASE_DEV_NO_DB` | Faz com que `rebase dev` não inicie nenhum banco de dados nem provisione nada — você traz sua própria instância. O mesmo que `--no-db`. | — |
| `REBASE_FRONTEND_PORT` | Fixa a porta do servidor de desenvolvimento do frontend, que de outro modo o `rebase dev` deriva a partir do caminho do projeto. | — |
| `REBASE_DEV_READY_TIMEOUT_MS` | Quanto tempo o `rebase dev` aguarda o backend anunciar que está pronto antes de acusar que ele não foi iniciado. `0` desativa o alerta. | `30000` |
| `DATABASE_PASSWORD` | A senha que `rebase dev --docker` injeta na string de conexão derivada do `docker-compose.yml`. | — |
| `DO_NOT_TRACK` | Convenção comum entre ferramentas. Se definido para qualquer valor diferente de `0`, a CLI não envia telemetria. | — |
| `REBASE_TELEMETRY_DISABLED` | O mesmo efeito, especificamente para o Rebase. Não requer arquivo físico, sendo o indicado para ambientes de CI e imagens Docker. | — |
| `REBASE_TELEMETRY_ENDPOINT` | Para onde a telemetria é enviada, para o caso de coletores auto-hospedados (self-hosted). | — |
| `REBASE_NO_UPDATE_CHECK` | `1` impede que a CLI consulte o registro npm (ou `npm_config_registry`), uma vez ao dia em segundo plano, pelas dist-tags do `@rebasepro/cli`, ocultando o aviso "Rebase X is out; this CLI is Y" exibido no stderr ao final de qualquer comando que não seja `rebase upgrade`. A resposta é armazenada em `~/.rebase/release-check.json`, e a requisição não trafega nenhum outro dado. Já vem desativado em ambientes de CI; `NO_UPDATE_NOTIFIER` produz o mesmo efeito. | — |
| `REBASE_RELEASE_NOTICE_SHOWN` | Definido pela CLI para os processos iniciados por ela, de forma que comandos subsequentes exibam o aviso "Rebase X is out" apenas uma vez. Definir manualmente oculta a linha para aquele processo, assim como faz `REBASE_NO_UPDATE_CHECK`. | — |

## Segredos em desenvolvimento

O `JWT_SECRET` é obrigatório em produção. Ele e o `REBASE_SERVICE_KEY` são
gerados automaticamente fora dela, para que você possa iniciar o desenvolvimento sem nenhuma configuração prévia.

Esses valores gerados ficam salvos em cache no arquivo `.rebase-dev-secrets.json`, ao lado de
`.rebase-dev-port` e `.rebase-dev-url`, ignorados pelo git juntamente com eles. Anteriormente, eram
recriados a cada inicialização — o que fazia com que reiniciar o servidor de desenvolvimento desconectasse você
da sua própria aplicação e invalidasse qualquer chave de API recém-criada.

- Defina qualquer uma das variáveis explicitamente e o seu valor será usado; nada será armazenado ou lido do cache.
- Aponte o cache para outro local usando `REBASE_DEV_SECRETS_FILE` — um caminho de arquivo, e a
  única variável desta seção que você definiria de forma deliberada.
- Exclua o arquivo para rotacionar ambos os segredos. A próxima inicialização gerará um arquivo novo.
- Se o arquivo não puder ser gravado — como em um container somente leitura —, o servidor iniciará
  normalmente com segredos efêmeros, exatamente como funcionava antes.

Nada é mantido em cache em produção ou sob executores de testes (test runners). Em produção, nenhum valor
é gerado automaticamente: uma inicialização sem `JWT_SECRET` falhará informando a variável ausente:

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

As mesmas opções,
sem `app`, `server` e `basePath` e com um parâmetro obrigatório `provision`, compilam um
backend que não atende nenhuma rota até que você faça a montagem manual: `createRebaseBackend`. Consulte
[Integração com Servidor Customizado](/docs/backend/custom-server/).

### Alterando o `basePath`

`basePath` altera o prefixo de todas as rotas da API, portanto o cliente deve ser informado da mesma alteração —
caso contrário, continuará chamando `/api/...` e recebendo respostas 404 para todas as requisições:

```typescript
import { createRebaseClient } from "@rebasepro/client";

export const rebase = createRebaseClient({
    baseUrl: "https://api.example.com",
    apiPath: "/v1"          // must match the backend's basePath
});
```

O painel administrativo obtém essa definição automaticamente a partir do cliente que lhe é fornecido; nenhuma outra
configuração é necessária. Caso você monte uma URL de requisição manualmente, concatene-a a partir do cliente em
vez de escrever `/api` no código:

```typescript
import { useApiBase } from "@rebasepro/app";

function Widget() {
    const apiBase = useApiBase();   // e.g. "https://api.example.com/v1"
    // fetch(`${apiBase}/data/products`)
}
```

## Solução de Problemas

### Permissão Negada no Editor SQL (`permission denied for table <name>`)

* **Sintomas:** Queries personalizadas executadas no editor SQL do Rebase Studio falham com `cause: error: permission denied for table <name>`, mesmo que a visualização de planilha do CMS carregue os dados normalmente.
* **Causa:** Por padrão, o Rebase tenta executar consultas no Editor SQL alternando temporariamente os papéis do banco de dados para corresponder ao papel da aplicação do usuário ativo (por exemplo, `SET LOCAL ROLE "admin"`). Se você utiliza autenticação customizada onde os papéis existem somente em tabelas do banco em vez de papéis reais do PostgreSQL, a alternância de papel falha ou faltam privilégios no banco. A visão de planilha do CMS roda sob o usuário proprietário da conexão padrão, contornando essa exigência.
* **Solução:** Adicione `DISABLE_DB_ROLE_SWITCHING=true` à configuração do seu `.env` no backend. Isso força o Rebase a executar as consultas do Editor SQL usando os privilégios do proprietário da conexão (geralmente um superuser/owner). O Editor SQL passa a exibir, acima dos resultados, que eles foram lidos como o proprietário da conexão, e desabilita o seletor de papéis.

### Falha ao Carregar o Esquema no Editor SQL (`Cross-database execution requires adminConnectionString`)

* **Sintomas:** O Studio falha ao carregar a árvore de esquema, ou o Editor SQL retorna `Failed to fetch schema: Cross-database execution requires adminConnectionString to be configured in the backend.`
* **Causa:** O Rebase necessita de privilégios administrativos para consultar os catálogos de sistema do banco de dados e executar comandos de administração. Se `adminConnectionString` não for fornecida ao bootstrapper, ou se `getAdmin()` for sobrescrito para retornar `undefined`, essas operações falharão.
* **Solução:** Certifique-se de que `adminConnectionString` esteja configurada durante a inicialização do bootstrapper do backend:
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
