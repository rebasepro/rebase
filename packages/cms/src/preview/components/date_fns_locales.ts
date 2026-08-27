import type { Locale as LocaleKey } from "@rebasepro/cms-types";
import type { Locale as DateFnsLocale } from "date-fns";

/**
 * One date-fns locale, fetched when the admin is actually configured to use it.
 *
 * `DatePreview` used to open with:
 *
 *     import * as locales from "date-fns/locale";
 *
 * and then index that namespace with the configured locale. A namespace import
 * of a barrel is a reference to every member of it, so all ~77 locales were
 * bundled — 640 kB, in the entry chunk's static graph, to format dates in the
 * one locale a given deployment has configured (and `undefined`, meaning
 * en-US, for nearly all of them).
 *
 * A map of thunks is written out rather than derived from the locale key,
 * because `import(`date-fns/locale/${name}`)` is not statically analysable:
 * the bundler cannot see which modules it must emit, and the import fails at
 * runtime in a build. Each entry below is its own async chunk, and exactly one
 * of them is ever fetched.
 *
 * `fil` is in the `Locale` union and has no date-fns locale to import; it
 * resolved to `undefined` through the namespace too, so it still does.
 */
const dateFnsLocaleLoaders: Partial<Record<LocaleKey, () => Promise<DateFnsLocale>>> = {
    af: () => import("date-fns/locale/af").then(m => m.af),
    ar: () => import("date-fns/locale/ar").then(m => m.ar),
    arDZ: () => import("date-fns/locale/ar-DZ").then(m => m.arDZ),
    arMA: () => import("date-fns/locale/ar-MA").then(m => m.arMA),
    arSA: () => import("date-fns/locale/ar-SA").then(m => m.arSA),
    az: () => import("date-fns/locale/az").then(m => m.az),
    be: () => import("date-fns/locale/be").then(m => m.be),
    bg: () => import("date-fns/locale/bg").then(m => m.bg),
    bn: () => import("date-fns/locale/bn").then(m => m.bn),
    ca: () => import("date-fns/locale/ca").then(m => m.ca),
    cs: () => import("date-fns/locale/cs").then(m => m.cs),
    cy: () => import("date-fns/locale/cy").then(m => m.cy),
    da: () => import("date-fns/locale/da").then(m => m.da),
    de: () => import("date-fns/locale/de").then(m => m.de),
    el: () => import("date-fns/locale/el").then(m => m.el),
    enAU: () => import("date-fns/locale/en-AU").then(m => m.enAU),
    enCA: () => import("date-fns/locale/en-CA").then(m => m.enCA),
    enGB: () => import("date-fns/locale/en-GB").then(m => m.enGB),
    enIN: () => import("date-fns/locale/en-IN").then(m => m.enIN),
    enNZ: () => import("date-fns/locale/en-NZ").then(m => m.enNZ),
    enUS: () => import("date-fns/locale/en-US").then(m => m.enUS),
    eo: () => import("date-fns/locale/eo").then(m => m.eo),
    es: () => import("date-fns/locale/es").then(m => m.es),
    et: () => import("date-fns/locale/et").then(m => m.et),
    eu: () => import("date-fns/locale/eu").then(m => m.eu),
    faIR: () => import("date-fns/locale/fa-IR").then(m => m.faIR),
    fi: () => import("date-fns/locale/fi").then(m => m.fi),
    fr: () => import("date-fns/locale/fr").then(m => m.fr),
    frCA: () => import("date-fns/locale/fr-CA").then(m => m.frCA),
    frCH: () => import("date-fns/locale/fr-CH").then(m => m.frCH),
    gd: () => import("date-fns/locale/gd").then(m => m.gd),
    gl: () => import("date-fns/locale/gl").then(m => m.gl),
    gu: () => import("date-fns/locale/gu").then(m => m.gu),
    he: () => import("date-fns/locale/he").then(m => m.he),
    hi: () => import("date-fns/locale/hi").then(m => m.hi),
    hr: () => import("date-fns/locale/hr").then(m => m.hr),
    hu: () => import("date-fns/locale/hu").then(m => m.hu),
    hy: () => import("date-fns/locale/hy").then(m => m.hy),
    id: () => import("date-fns/locale/id").then(m => m.id),
    is: () => import("date-fns/locale/is").then(m => m.is),
    it: () => import("date-fns/locale/it").then(m => m.it),
    ja: () => import("date-fns/locale/ja").then(m => m.ja),
    ka: () => import("date-fns/locale/ka").then(m => m.ka),
    kk: () => import("date-fns/locale/kk").then(m => m.kk),
    kn: () => import("date-fns/locale/kn").then(m => m.kn),
    ko: () => import("date-fns/locale/ko").then(m => m.ko),
    lb: () => import("date-fns/locale/lb").then(m => m.lb),
    lt: () => import("date-fns/locale/lt").then(m => m.lt),
    lv: () => import("date-fns/locale/lv").then(m => m.lv),
    mk: () => import("date-fns/locale/mk").then(m => m.mk),
    ms: () => import("date-fns/locale/ms").then(m => m.ms),
    mt: () => import("date-fns/locale/mt").then(m => m.mt),
    nb: () => import("date-fns/locale/nb").then(m => m.nb),
    nl: () => import("date-fns/locale/nl").then(m => m.nl),
    nlBE: () => import("date-fns/locale/nl-BE").then(m => m.nlBE),
    nn: () => import("date-fns/locale/nn").then(m => m.nn),
    pl: () => import("date-fns/locale/pl").then(m => m.pl),
    pt: () => import("date-fns/locale/pt").then(m => m.pt),
    ptBR: () => import("date-fns/locale/pt-BR").then(m => m.ptBR),
    ro: () => import("date-fns/locale/ro").then(m => m.ro),
    ru: () => import("date-fns/locale/ru").then(m => m.ru),
    sk: () => import("date-fns/locale/sk").then(m => m.sk),
    sl: () => import("date-fns/locale/sl").then(m => m.sl),
    sr: () => import("date-fns/locale/sr").then(m => m.sr),
    srLatn: () => import("date-fns/locale/sr-Latn").then(m => m.srLatn),
    sv: () => import("date-fns/locale/sv").then(m => m.sv),
    ta: () => import("date-fns/locale/ta").then(m => m.ta),
    te: () => import("date-fns/locale/te").then(m => m.te),
    th: () => import("date-fns/locale/th").then(m => m.th),
    tr: () => import("date-fns/locale/tr").then(m => m.tr),
    ug: () => import("date-fns/locale/ug").then(m => m.ug),
    uk: () => import("date-fns/locale/uk").then(m => m.uk),
    uz: () => import("date-fns/locale/uz").then(m => m.uz),
    vi: () => import("date-fns/locale/vi").then(m => m.vi),
    zhCN: () => import("date-fns/locale/zh-CN").then(m => m.zhCN),
    zhTW: () => import("date-fns/locale/zh-TW").then(m => m.zhTW),
};

const cache = new Map<LocaleKey, DateFnsLocale>();

/** The locale if it has already been fetched, otherwise `undefined`. Never fetches. */
export function getLoadedDateFnsLocale(locale: LocaleKey | undefined): DateFnsLocale | undefined {
    return locale ? cache.get(locale) : undefined;
}

/**
 * Fetch a date-fns locale. Resolves to `undefined` for a locale date-fns does
 * not ship, which is what indexing the namespace used to yield.
 */
export async function loadDateFnsLocale(locale: LocaleKey | undefined): Promise<DateFnsLocale | undefined> {
    if (!locale) return undefined;
    const cached = cache.get(locale);
    if (cached) return cached;
    const loader = dateFnsLocaleLoaders[locale];
    if (!loader) return undefined;
    const loaded = await loader();
    cache.set(locale, loaded);
    return loaded;
}
