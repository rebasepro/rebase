/**
 * What a record's relation tab says before the record exists.
 *
 * Opening a related tab (a post's Tags) on a post that has not been saved yet
 * said "You need to save your entity before adding additional collections".
 * "Entity" and "collections" are the code's words; the panel calls the thing a
 * *record* everywhere else ("Remove from this record", "Records in this view"),
 * and what the tab adds is related records, not collections. Every locale had
 * the same two words in its own language.
 *
 * Each locale is checked against its own word for "record", the one its
 * `remove_from_record` uses, so the message speaks the vocabulary the rest of
 * that translation does.
 */
import type { RebaseTranslations } from "@rebasepro/cms-types";
import { de } from "../src/locales/de";
import { en } from "../src/locales/en";
import { es } from "../src/locales/es";
import { fr } from "../src/locales/fr";
import { hi } from "../src/locales/hi";
import { it as itLocale } from "../src/locales/it";
import { pt } from "../src/locales/pt";

interface Vocabulary {
    /** The locale's word for a record, as `remove_from_record` uses it. */
    record: string;
    /** Its words for "entity" and "collection", which the message must not use. */
    internal: RegExp;
}

const LOCALES: [string, RebaseTranslations, Vocabulary][] = [
    ["en", en, { record: "record", internal: /entit|collection/i }],
    ["de", de, { record: "Datensatz", internal: /entität|sammlung/i }],
    ["es", es, { record: "registro", internal: /entidad|colecci/i }],
    ["fr", fr, { record: "enregistrement", internal: /entité|collection/i }],
    ["hi", hi, { record: "रिकॉर्ड", internal: /एंटिटी|इकाई|संग्रह/ }],
    ["it", itLocale, { record: "record", internal: /entità|raccolt|collezion/i }],
    ["pt", pt, { record: "registo", internal: /entidade|coleç/i }]
];

/** Both keys say it: the one the record views use, and its older twin. */
const KEYS = ["save_entity_before_subcollections", "youd_need_to_save_before_additional_collections"] as const;

describe.each(LOCALES)("%s: a relation tab on an unsaved record", (_name, translations, vocabulary) => {
    it.each(KEYS)("%s speaks of records", (key) => {
        const message = translations[key];
        expect(translations.remove_from_record).toContain(vocabulary.record);
        expect(message).toContain(vocabulary.record);
        expect(message).not.toMatch(vocabulary.internal);
    });
});
