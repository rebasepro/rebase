// Reset timers for the copy buttons, keyed by button: a second click has to
// restart the confirmation window rather than let the first timeout clear a
// button that just re-copied.
const copyResetTimers = new WeakMap<Element, number>();

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
  if ((window as any).pageObserver) {
    (window as any).pageObserver.disconnect();
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
  (window as any).pageObserver = observer;

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

  // Global copy-btn logic.
  //
  // The confirmation used to be a `title` swap and a colour change, which means
  // the only unambiguous "it worked" signal lived in a tooltip the reader has to
  // hover to see. A button that can swap its own icon and label says so on the
  // button: mark the two icons `data-copy-idle` / `data-copy-done` and the text
  // node `data-copy-label`, and this handler drives them. Buttons without those
  // hooks keep the old colour-only behaviour.
  document.querySelectorAll(".copy-btn").forEach(button => {
    button.addEventListener("click", () => {
      const command = button.getAttribute("data-command");
      if (!command) return;

      const idle = button.querySelector<HTMLElement>("[data-copy-idle]");
      const done = button.querySelector<HTMLElement>("[data-copy-done]");
      const label = button.querySelector<HTMLElement>("[data-copy-label]");
      const idleLabel = label?.textContent ?? "";
      const originalTitle = button.getAttribute("title") || "Copy to clipboard";
      // One timer per button: clicking again mid-confirmation must restart the
      // window, not let the first timeout reset a button that just re-copied.
      const timers = copyResetTimers;

      const confirm = () => {
        button.setAttribute("title", "Copied!");
        button.classList.add("text-emerald-400");
        button.classList.remove("text-surface-500");
        if (idle && done) {
          idle.hidden = true;
          done.hidden = false;
        }
        if (label) label.textContent = button.getAttribute("data-copy-done-label") || "Copied";

        const pending = timers.get(button);
        if (pending) clearTimeout(pending);
        timers.set(button, window.setTimeout(() => {
          button.setAttribute("title", originalTitle);
          button.classList.remove("text-emerald-400");
          button.classList.add("text-surface-500");
          if (idle && done) {
            idle.hidden = false;
            done.hidden = true;
          }
          if (label) label.textContent = idleLabel;
          timers.delete(button);
        }, 1800));
      };

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
          document.execCommand("copy");
          confirm();
        } catch {
          /* nothing sensible left to try */
        }
        scratch.remove();
      };

      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(command).then(confirm, fallback);
      } else {
        fallback();
      }
    });
  });
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
// and stacks a duplicate set of listeners on every card and copy button.
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

