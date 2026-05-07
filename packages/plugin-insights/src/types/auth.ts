export interface DecodedToken {
  [key: string]: any;
  aud: string; // this is the project id
  auth_time?: number;
  email?: string;
  email_verified?: boolean;
  exp: number;
  iat: number;
  iss: string;
  phone_number?: string;
  picture?: string;
  sub: string;
  uid: string;
}
