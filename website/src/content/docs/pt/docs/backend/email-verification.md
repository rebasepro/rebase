---
sourceHash: 3d6a5a62a25e5b8c
title: Verificação de e-mail
sidebar_label: Verificação de e-mail
description: "Como uma conta comprova seu endereço de e-mail: o link enviado no registro, o que segui-lo mantém e remove, e o registro confirm-first com requireEmailVerification."
---

Quando o e-mail está configurado, o registro
envia à nova conta um link de verificação (`<frontend>/verify-email?token=…`, válido por 24 horas),
de modo que o proprietário comprove o endereço no cadastro, em seus próprios termos. `POST /api/auth/send-verification`
o envia novamente. Nada é enviado aos endereços sintéticos de convidados e contas do X (Twitter).

O link comprova a caixa de entrada, não quem registrou o endereço. Qualquer um pode registrar
o endereço de outra pessoa com uma senha e pedir que o link seja enviado, então
segui-lo mantém apenas o que a requisição também comprova:

| Seguir o link com… | O que acontece |
|---|---|
| uma sessão ativa dessa conta (header `Authorization`) | Verificado. Nada removido: apenas quem registrou a conta pode possuir sua sessão |
| a senha da conta (`POST`, `password`) | Verificado, a senha mantida, uma identidade não garantida removida, e o chamador conectado |
| nenhuma das duas | Verificado, e a senha e toda identidade não garantida removidas, toda sessão encerrada. `POST` pergunta primeiro (`409 PROOF_REQUIRED`) a menos que `removeUnproven: true` |

Então um proprietário que segue o link conectado, ou digita a senha que escolheu,
a mantém; alguém cujo endereço um estranho registrou verifica sem ela, e
a forma de acesso do estranho desaparece. A resposta diz `passwordRemoved` quando
removeu uma. O CMS pede a senha antes de verificar.

## Registro confirm-first

`auth.requireEmailVerification: true` (ou `AUTH_REQUIRE_EMAIL_VERIFICATION=true`) altera duas
coisas:

- `POST /api/auth/register` não conecta ninguém. Ele responde `200 { confirmationRequired: true }`
  independentemente de o endereço já ter uma conta, no mesmo tempo, então
  não revela a ninguém quais endereços estão registrados. Uma conta existente que
  nunca confirmou recebe seu link novamente por e-mail; sua senha não é alterada.
- `POST /api/auth/login` responde `403 EMAIL_NOT_CONFIRMED` para uma conta não verificada,
  e somente depois que a senha estiver correta, então a resposta não revela a ninguém além do
  titular da senha que o endereço não está confirmado. Ela envia o link novamente, no
  máximo uma vez por minuto.

Quem se registrou segue o link e informa sua senha
(`POST /api/auth/verify-email { token, password }`), o que verifica o endereço
e faz login. Com isso desativado, que é o padrão, um endereço que já
tem uma conta recebe `409 EMAIL_EXISTS`, como antes.

Para se recuperar de uma rejeição do passo 3, o usuário entra com seu método
existente e chama o endpoint explícito de vinculação:

```http
POST /api/auth/link/google
Authorization: Bearer <access token>

{ "idToken": "..." }
```

A vinculação enquanto autenticado intencionalmente **não** exige um e-mail
verificado, e não exige que os e-mails coincidam — o endereço do Google de um
usuário frequentemente não é o endereço dele no aplicativo. A assimetria é
deliberada: no login, o e-mail do provedor é a única evidência que vincula a
identidade recebida a uma conta, enquanto aqui o solicitante já comprovou a posse
da conta por possuir uma sessão válida. Retorna `409 IDENTITY_ALREADY_LINKED` se
essa identidade do provedor pertencer a outro usuário, e é idempotente se já
estiver vinculada ao solicitante.

#### A direção inversa

Um usuário que se cadastrou com o Google e não possui senha:

- **Registrar-se com o mesmo e-mail** é recusado com `409 EMAIL_EXISTS`.
- **`POST /api/auth/change-password`** retorna `400 INVALID_ACCOUNT` — não há
  senha existente para validação.
- **`forgot-password` → `reset-password` é a forma suportada de adicionar uma.**
  Ela comprova novamente a titularidade do endereço por e-mail, após o que a
  conta passa a ter ambos os métodos de login.


## Veja também

- [Autenticação](/docs/backend/authentication/): a configuração de auth, a
  vinculação de contas OAuth, e por que a primeira prova de endereço remove o que
  ninguém provou.
- [Endpoints de autenticação](/docs/backend/auth-endpoints/): `POST /api/auth/verify-email`
  e `POST /api/auth/send-verification` com o restante das rotas.
- [Autenticação no SDK](/docs/sdk/authentication/#email-verification):
  `verifyEmail` e `signUp` a partir do cliente.
