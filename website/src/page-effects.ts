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

  // Global copy-btn logic
  document.querySelectorAll(".copy-btn").forEach(button => {
    button.addEventListener("click", () => {
      const command = button.getAttribute("data-command");
      if (command) {
        navigator.clipboard.writeText(command).then(() => {
          const originalText = button.getAttribute("title") || "Copy to clipboard";
          button.setAttribute("title", "Copied!");
          
          button.classList.add("text-emerald-400");
          button.classList.remove("text-surface-500");
          
          setTimeout(() => {
            button.setAttribute("title", originalText);
            button.classList.remove("text-emerald-400");
            button.classList.add("text-surface-500");
          }, 1500);
        });
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

