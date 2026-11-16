/**
 * The browser's half of Web Push, for tests: RFC 8291's worked example, and a
 * decryptor written from the RFC independently of the server's encryptor.
 */
import { expect } from "@jest/globals";
import { createDecipheriv, createECDH, createHmac } from "node:crypto";

/** RFC 8291, Appendix A. */
export const RFC = {
    plaintext: "V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24",
    senderPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
    receiverPublic: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
    receiverPrivate: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
    salt: "DGv6ra1nlYgDCS1FRnbzlw",
    auth: "BTBZMqHH6r4Tts7J_aSIgg",
    header: "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
    ciphertext: "8pfeW0KbunFT06SuDKoJH9Ql87S1QUrdirN6GcG7sFz1y1sqLgVi1VhjVkHsUoEsbI_0LpXMuGvnzQ"
};

/** The browser's side: what a user agent does with a message, written from RFC 8291 independently of the encryptor. */
export function decryptAsBrowser(body: Buffer, receiverPrivate: Buffer, auth: Buffer): Buffer {
    const salt = body.subarray(0, 16);
    const idlen = body.readUInt8(20);
    const senderPublic = body.subarray(21, 21 + idlen);
    const ciphertext = body.subarray(21 + idlen);
    const receiver = createECDH("prime256v1");
    receiver.setPrivateKey(receiverPrivate);
    const hkdf = (salt: Buffer, ikm: Buffer, info: Buffer, length: number) => {
        const prk = createHmac("sha256", salt).update(ikm).digest();
        return createHmac("sha256", prk).update(Buffer.concat([info, Buffer.from([1])])).digest().subarray(0, length);
    };
    const ikm = hkdf(auth, receiver.computeSecret(senderPublic), Buffer.concat([Buffer.from("WebPush: info\0"), receiver.getPublicKey(), senderPublic]), 32);
    const cek = hkdf(salt, ikm, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
    const nonce = hkdf(salt, ikm, Buffer.from("Content-Encoding: nonce\0"), 12);
    const decipher = createDecipheriv("aes-128-gcm", cek, nonce);
    decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
    const padded = Buffer.concat([decipher.update(ciphertext.subarray(0, ciphertext.length - 16)), decipher.final()]);
    expect(padded[padded.length - 1]).toBe(2);
    return padded.subarray(0, padded.length - 1);
}

