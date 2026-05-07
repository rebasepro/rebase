import { DatakiException } from "./exceptions";

export const tokenExpired = new DatakiException(
  401,
  "Firebase ID token has expired",
  "firebase-id-token-expired"
);

export const firebaseTokenInvalid = new DatakiException(
  401,
  "Firebase ID token is invalid",
  "firebase-id-token-invalid"
);

export const firebaseTokenMissing = new DatakiException(
  401,
  "Firebase ID must be specified in the Authorization header or the access_token query parameter",
  "firebase-id-token-not-provided"
);

export const userNotAuthorizedToPerformAction = new DatakiException(
  403,
  "User not authorized to perform action",
  "user-not-authorized-to-perform-action"
)
