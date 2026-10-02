---
title: Vérification de l'e-mail
sidebar_label: Vérification de l'e-mail
description: "Comment un compte prouve son adresse e-mail : le lien envoyé à l'inscription, ce qu'en le suivant on conserve et on retire, et l'inscription à confirmation préalable avec requireEmailVerification."
---

<span class="since-badge" data-since="0.24">Depuis 0.24</span> Lorsque l'e-mail est configuré, l'inscription
envoie au nouveau compte un lien de vérification (`<frontend>/verify-email?token=…`, valide 24 heures),
afin que le titulaire prouve l'adresse à l'inscription, à son propre rythme. `POST /api/auth/send-verification`
l'envoie à nouveau. Rien n'est envoyé aux adresses synthétiques des invités et des comptes X (Twitter).

Le lien prouve la boîte de réception, pas qui a inscrit l'adresse. N'importe qui peut inscrire
l'adresse de quelqu'un d'autre avec un mot de passe et demander l'envoi du lien, si bien que
le suivre ne conserve que ce que la requête prouve aussi :

| En suivant le lien avec… | Ce qui se passe |
|---|---|
| une session active de ce compte (en-tête `Authorization`) | Vérifié. Rien n'est retiré : seul celui qui a inscrit le compte peut détenir sa session |
| le mot de passe du compte (`POST`, `password`) | Vérifié, le mot de passe conservé, une identité non garantie retirée, et l'appelant connecté |
| aucun des deux | Vérifié, et le mot de passe ainsi que chaque identité non garantie retirés, chaque session terminée. `POST` demande d'abord (`409 PROOF_REQUIRED`) sauf `removeUnproven: true` |

Ainsi, un titulaire qui suit le lien connecté, ou qui saisit le mot de passe qu'il a choisi,
le conserve ; quelqu'un dont l'adresse a été inscrite par un inconnu se vérifie sans lui, et
le moyen d'accès de l'inconnu disparaît. La réponse indique `passwordRemoved` quand elle en a
retiré un. Le CMS demande le mot de passe avant de vérifier.

## Inscription à confirmation préalable

`auth.requireEmailVerification: true` (ou `AUTH_REQUIRE_EMAIL_VERIFICATION=true`) change deux
choses :

- `POST /api/auth/register` ne connecte personne. Il répond `200 { confirmationRequired: true }`
  que l'adresse ait déjà un compte ou non, dans le même délai, afin de ne révéler à personne
  quelles adresses sont inscrites. Un compte existant qui n'a jamais confirmé reçoit à nouveau
  son lien par e-mail ; son mot de passe n'est pas modifié.
- `POST /api/auth/login` répond `403 EMAIL_NOT_CONFIRMED` pour un compte non vérifié,
  et seulement une fois le mot de passe correct, de sorte que la réponse ne révèle qu'au
  détenteur du mot de passe que l'adresse n'est pas confirmée. Il envoie à nouveau le lien, au
  plus une fois par minute.

La personne inscrite suit le lien et saisit son mot de passe
(`POST /api/auth/verify-email { token, password }`), ce qui vérifie l'adresse
et la connecte. Désactivé, ce qui est la valeur par défaut, une adresse qui a déjà
un compte répond `409 EMAIL_EXISTS`, comme avant.

Pour surmonter un rejet à l'étape 3, l'utilisateur se connecte avec sa méthode existante et appelle le point de terminaison explicite de liaison :

```http
POST /api/auth/link/google
Authorization: Bearer <access token>

{ "idToken": "..." }
```

La liaison en étant authentifié n'exige délibérément **pas** d'e-mail vérifié, et ne nécessite pas non plus que les e-mails correspondent — l'adresse Google d'un utilisateur n'est souvent pas son adresse sur l'application. Cette asymétrie est délibérée : lors de la connexion, l'e-mail du fournisseur est la seule preuve reliant l'identité entrante à un compte, tandis qu'ici, l'appelant a déjà prouvé sa légitimité en détenant une session valide. L'endpoint renvoie `409 IDENTITY_ALREADY_LINKED` si cette identité de fournisseur appartient à un autre utilisateur, et est idempotent si elle est déjà liée à l'appelant.

#### Le cas inverse

Un utilisateur qui s'est inscrit avec Google et n'a pas de mot de passe :

- **L'inscription avec le même e-mail** est refusée avec `409 EMAIL_EXISTS`.
- **`POST /api/auth/change-password`** renvoie `400 INVALID_ACCOUNT` — il n'y a aucun mot de passe existant à vérifier.
- **`forgot-password` → `reset-password` est la méthode prise en charge pour en ajouter un.** Elle prouve à nouveau la propriété de l'adresse par e-mail, après quoi le compte dispose des deux méthodes de connexion.


## Voir aussi

- [Authentification](/docs/backend/authentication/) : la configuration de l'authentification, la
  liaison de comptes OAuth, et pourquoi une première preuve de l'adresse retire ce que personne
  n'a prouvé.
- [Endpoints d'authentification](/docs/backend/auth-endpoints/) : `POST /api/auth/verify-email`
  et `POST /api/auth/send-verification` avec le reste des routes.
- [Authentification du SDK typé](/docs/sdk/authentication/#email-verification) :
  `verifyEmail` et `signUp` depuis le client.
