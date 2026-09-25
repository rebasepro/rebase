/**
 * The products shown as case studies — one list, two compositions.
 *
 * The home page's CaseStudiesCarousel shows each one as a screenshot slide;
 * /agencies shows the same list as a compact project index. SITE-STORY and the
 * landing rules forbid a deep page from mounting a home section with a switch
 * flipped: share the data so the facts cannot drift, and let the markup differ.
 * Copy lives in i18n under `showcase.<key>.{badge,title,desc}`.
 */
export interface CaseStudy {
    id: string;
    /** Screenshot for the carousel; null when there is nothing public to photograph. */
    image: string | null;
    /** i18n key stem: `showcase.<key>.badge|title|desc`. */
    key: string;
    /** Public address, or null for an internal tool with none. */
    href: string | null;
    /** What the browser chrome shows; for an internal tool, a label instead. */
    host: string;
    logo: string | null;
    logoClass: string;
    /** A square app mark rather than a wordmark: it gets empty alt text. */
    logoIsMark?: boolean;
    glow: string;
}

export const CASE_STUDIES: CaseStudy[] = [
    {
        id: "medicalmotion",
        image: "/img/showcase/medicalmotion.webp",
        key: "case2",
        href: "https://medicalmotion.com",
        host: "medicalmotion.com",
        logo: "/img/logos/medicalmotion_white.svg",
        // Artwork is tightly cropped in its viewBox.
        logoClass: "h-7 sm:h-8",
        glow: "from-rose-500/25 via-primary/15 to-transparent"
    },
    {
        id: "unfeigned",
        image: "/img/showcase/unfeigned.webp",
        key: "case5",
        href: "https://unfeignedgear.com",
        host: "unfeignedgear.com",
        logo: null,
        logoClass: "",
        glow: "from-cyan-500/25 via-primary/15 to-transparent"
    },
    {
        id: "sustentalent",
        image: "/img/showcase/sustentalent.webp",
        key: "case",
        href: "https://sustentalent.com",
        host: "sustentalent.com",
        logo: "/img/logos/sustentalent_white.svg",
        // Artwork occupies only the middle 50% of its viewBox, so it needs
        // roughly double the box height to read at the same optical size.
        logoClass: "h-14 sm:h-16 -my-3",
        glow: "from-emerald-500/25 via-primary/15 to-transparent"
    },
    {
        id: "dadaki",
        image: "/img/showcase/dadaki.webp",
        key: "case0",
        href: "https://dadaki.com",
        host: "dadaki.com",
        // The app mark from dadaki.com/logo.svg — a square tile rather than a
        // wordmark, so it is sized to sit level with the wordmarks beside it.
        logo: "/img/logos/dadaki.svg",
        logoClass: "h-9 sm:h-10",
        logoIsMark: true,
        glow: "from-violet-500/25 via-primary/15 to-transparent"
    },
    {
        id: "presupuestos",
        image: "/img/showcase/presupuestos.webp",
        key: "case3",
        href: "https://presupuestos.rebase.website",
        host: "presupuestos.rebase.website",
        // The app's own favicon: a square mark, so it is sized to sit level
        // with the wordmarks the way dadaki's does.
        logo: "/img/logos/presupuestos.svg",
        logoClass: "h-9 sm:h-10",
        logoIsMark: true,
        glow: "from-amber-500/25 via-primary/15 to-transparent"
    },
    {
        id: "prospector",
        image: "/img/showcase/prospector.webp",
        key: "case4",
        href: "https://prospector.rebase.website",
        host: "prospector.rebase.website",
        logo: null,
        logoClass: "",
        glow: "from-primary/25 via-violet-500/15 to-transparent"
    },
    {
        id: "edith",
        // No public address, so nothing to photograph: this one keeps a
        // drawn figure. See the note on `href` below.
        image: null,
        key: "case6",
        // A client's internal tool: there is no public address to send a reader
        // to, so this card carries no link and `host` labels the chrome instead
        // of naming a domain that does not answer.
        href: null,
        host: "internal · edith",
        logo: null,
        logoClass: "",
        glow: "from-indigo-500/25 via-primary/15 to-transparent"
    }
];
