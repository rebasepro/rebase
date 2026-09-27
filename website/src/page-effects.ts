// Copy buttons: `.copy-btn[data-command]` writes the command to the clipboard.
//
// One listener on the document, bound once, rather than one per button bound at
// page load. The per-button version silently skipped every button that did not
// exist at that moment — a hot-reloaded hero, an island that renders its own
// button — and a copy button that does nothing is worse than none.
//
// A button says it worked on itself: `data-copied` is set for 1.8s (global.css
// colours it; a component can style `group-data-copied:` children), the icons
// marked `data-copy-idle` / `data-copy-done` swap, and the text in
// `data-copy-label` reads the button's `data-copy-done-label`.
const COPY_CONFIRM_MS = 1800;
const copyResetTimers = new WeakMap<Element, number>();
const copyIdleLabels = new WeakMap<Element, string>();

function confirmCopy(button: HTMLElement) {
  const idle = button.querySelector("[data-copy-idle]");
  const done = button.querySelector("[data-copy-done]");
  const label = button.querySelector<HTMLElement>("[data-copy-label]");
  // Read the idle label once per button, never mid-confirmation — a second
  // click inside the window used to save "Copied" as the idle text for good.
  if (label && !copyIdleLabels.has(button)) copyIdleLabels.set(button, label.textContent ?? "");

  // The icons are <svg>, and `hidden` is an HTMLElement property: assigning it
  // on an SVGElement sets a plain JS field and changes nothing on screen. The
  // attribute is what the stylesheet reads.
  button.dataset.copied = "";
  if (idle && done) { idle.toggleAttribute("hidden", true); done.toggleAttribute("hidden", false); }
  if (label) label.textContent = button.dataset.copyDoneLabel || "Copied";

  const pending = copyResetTimers.get(button);
  if (pending) clearTimeout(pending);
  copyResetTimers.set(button, window.setTimeout(() => {
    delete button.dataset.copied;
    if (idle && done) { idle.toggleAttribute("hidden", false); done.toggleAttribute("hidden", true); }
    if (label) label.textContent = copyIdleLabels.get(button) ?? "";
    copyResetTimers.delete(button);
  }, COPY_CONFIRM_MS));
}

document.addEventListener("click", (event) => {
  const button = (event.target as Element | null)?.closest<HTMLElement>(".copy-btn[data-command]");
  if (!button) return;
  const command = button.dataset.command!;

  // `navigator.clipboard` is undefined on a non-secure origin, and rejects
  // when the document is not focused — both leave the reader with a button
  // that did nothing at all. Fall back to a selection copy.
  const fallback = () => {
    const scratch = document.createElement("textarea");
    scratch.value = command;
    scratch.setAttribute("readonly", "");
    scratch.style.cssText = "position:fixed;top:0;left:0;opacity:0";
    document.body.appendChild(scratch);
    scratch.select();
    try {
      if (document.execCommand("copy")) confirmCopy(button);
    } catch {
      /* nothing sensible left to try */
    }
    scratch.remove();
  };

  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(command).then(() => confirmCopy(button), fallback);
  } else {
    fallback();
  }
});

// Mouse spotlight effect for cards
function initPageEffects() {
  const cards = document.querySelectorAll("[data-spotlight-card]");

  cards.forEach(card => {
    const spotlight = card.querySelector("[data-spotlight]") as HTMLElement;
    if (!spotlight) return;

    card.addEventListener("mousemove", (e: Event) => {
      const mouseEvent = e as MouseEvent;
      const rect = card.getBoundingClientRect();
      const x = mouseEvent.clientX - rect.left;
      const y = mouseEvent.clientY - rect.top;

      // Create radial gradient that follows mouse
      spotlight.style.background = `radial-gradient(600px circle at ${x}px ${y}px, rgba(66, 189, 238, 0.10), transparent 40%)`;
    });

    card.addEventListener("mouseleave", () => {
      spotlight.style.background = "";
    });
  });

  // Intersection Observer for scroll animations
  if (window.pageObserver) {
    window.pageObserver.disconnect();
  }

  const observerOptions = {
    threshold: 0.15,
    rootMargin: "0px 0px -100px 0px"
  };

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add("in-view");
        // Unobserve after animation to improve performance
        observer.unobserve(entry.target);
      }
    });
  }, observerOptions);
  window.pageObserver = observer;

  // Observe all elements with animate-on-scroll class
  const animatedElements = document.querySelectorAll(".animate-on-scroll");
  animatedElements.forEach(el => {
    el.classList.remove("in-view");
    observer.observe(el);
  });

  // Lazy videos: heavy below-the-fold clips ship with `preload="none"` and a
  // poster, and only get a <source> once they are close to the viewport. The
  // margin is generous so the first frames are decoded before the user arrives.
  const lazyVideos = document.querySelectorAll<HTMLVideoElement>("video[data-lazy-video][data-src]");
  if (lazyVideos.length) {
    const videoObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const video = entry.target as HTMLVideoElement;
        videoObserver.unobserve(video);

        const src = video.dataset.src;
        if (!src) return;
        delete video.dataset.src;

        const source = document.createElement("source");
        source.src = src;
        if (video.dataset.type) source.type = video.dataset.type;
        video.appendChild(source);
        // The element was parsed with no <source>, so it never picked a
        // resource; load() is what makes it reconsider and start autoplay.
        video.load();
      });
    }, { rootMargin: "400px 0px" });

    lazyVideos.forEach(video => videoObserver.observe(video));
  }
}

// `astro:page-load` only fires once ClientRouter's own chunk has been fetched and
// run, and everything carrying `animate-on-scroll` sits at `opacity: 0` until
// this observer reaches it — so waiting on that event left whole sections blank
// for as long as the router took to arrive. This module is already deferred, so
// the DOM is parsed by the time it executes: run once now for the initial page,
// and keep the listener for subsequent client-side navigations.
//
// `astro:page-load` also fires on the initial load, so the flag keeps that from
// re-running over a DOM we just set up — a second pass strips `in-view` off
// elements that have already animated in, flashing them back to `opacity: 0`,
// and stacks a duplicate set of listeners on every card.
// `astro:before-swap` marks the point where the DOM is genuinely replaced.
let initialized = false;

function initOnce() {
  if (initialized) return;
  initialized = true;
  initPageEffects();
}

initOnce();
document.addEventListener("astro:before-swap", () => { initialized = false; });
document.addEventListener("astro:page-load", initOnce);

