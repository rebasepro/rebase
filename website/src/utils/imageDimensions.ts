/**
 * Intrinsic pixel dimensions for images whose `src` is supplied by a variable.
 *
 * A literal <img src="/img/foo.png"> can carry width/height inline, but images
 * rendered from a data array cannot — and without them the browser reserves no
 * box, so every one of these shifted layout as it loaded. That is the single
 * biggest source of CLS left on the site.
 *
 * These are the browser's naturalWidth/naturalHeight, read off the real files.
 * ClientLogos.astro keeps its own copy of this idea for the logo wall, and its
 * warning applies here too: five logo files carry width/height attributes that
 * disagree with their viewBox, and layout follows the attributes. If a file is
 * replaced, re-read the numbers rather than parsing the markup by hand.
 *
 * Generated from website/public/img — see scripts if these need refreshing.
 */
export const IMAGE_DIMENSIONS: Record<string, [number, number]> = {
    "/img/competitors/Retool_Logo_0.svg": [87, 17],
    "/img/competitors/contentful-light.svg": [157, 32],
    "/img/competitors/directus-logo-light.svg": [64, 39],
    "/img/competitors/django-logo-negative.svg": [504, 216],
    "/img/competitors/firebase-lockup-dark.svg": [749, 205],
    "/img/competitors/google-firebase-icon.svg": [512, 512],
    "/img/competitors/hasura-logo-primary-darkbg.svg": [197, 60],
    "/img/competitors/nextjs-icon.svg": [512, 512],
    "/img/competitors/payload-logo-light.svg": [193, 44],
    "/img/competitors/strapi-full-logo-light.svg": [2500, 605],
    "/img/competitors/supabase-icon-5uqgeeqeknngv9las8zeef.webp": [300, 300],
    "/img/competitors/supabase-logo-wordmark-dark.svg": [581, 113],
    "/img/demo/products/aviator-rb3025.jpg": [679, 337],
    "/img/demo/products/baseball-cap.jpg": [552, 879],
    "/img/demo/products/casio-collection.jpg": [104, 200],
    "/img/demo/products/chess-set.jpg": [679, 679],
    "/img/demo/products/corkscrew.jpg": [248, 879],
    "/img/demo/products/invisible-shelf.jpg": [679, 679],
    "/img/demo/products/pimentero.jpg": [670, 879],
    "/img/demo/products/predator-2.jpg": [679, 312],
    "/img/demo/products/wine-decanter.jpg": [631, 879],
    "/img/mm_app.png": [654, 1336],
    "/img/mm_app.webp": [654, 1336],
    "/img/mm_dark.png": [2336, 1348],
    "/img/oikos_aviation_demo.png": [3018, 1528],
    "/img/overlay.png": [2476, 1394],
    "/img/overlay.webp": [2476, 1394],
    "/img/prime_um.png": [2862, 1510],
    "/img/product_logo_tee.png": [1024, 1024],
    "/img/product_logo_tee.webp": [1024, 1024],
};

/** Returns { width, height } for a known src, or an empty object to spread safely. */
export function imgDims(src: string): { width?: number; height?: number } {
    const d = IMAGE_DIMENSIONS[src?.split("?")[0]];
    return d ? { width: d[0], height: d[1] } : {};
}
