// Scroll animations, the header's scroll behaviour and the mobile menu.
// Shared by every public page.

const motion = document.documentElement.classList.contains('motion');

// ---------- Reveal on scroll ----------
// Any element with [data-reveal] fades/wipes in the first time it scrolls into view.
// Elements added later (car cards loaded from the API) are picked up automatically.
const revealObserver =
  motion && 'IntersectionObserver' in window
    ? new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            entry.target.classList.add('is-visible');
            revealObserver.unobserve(entry.target);
          }
        },
        { rootMargin: '0px 0px -8% 0px', threshold: 0.12 },
      )
    : null;

function watch(root) {
  const items = root.matches?.('[data-reveal]') ? [root] : [];
  items.push(...(root.querySelectorAll?.('[data-reveal]') ?? []));
  for (const el of items) {
    if (revealObserver) revealObserver.observe(el);
    else el.classList.add('is-visible');
  }
}

watch(document.body);
new MutationObserver((mutations) => {
  for (const m of mutations) for (const node of m.addedNodes) if (node.nodeType === 1) watch(node);
}).observe(document.body, { childList: true, subtree: true });

// ---------- Parallax ----------
// Modern browsers do this in CSS (animation-timeline: view()); this is the fallback.
if (motion && !CSS.supports('animation-timeline: view()')) {
  let ticking = false;
  const update = () => {
    ticking = false;
    const vh = window.innerHeight;
    for (const el of document.querySelectorAll('[data-parallax]')) {
      const rect = el.parentElement.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > vh) continue;
      // -1 when the section enters at the bottom, +1 when it leaves at the top
      const progress = (vh - rect.top) / (vh + rect.height) * 2 - 1;
      el.style.transform = `translate3d(0, ${(progress * 10).toFixed(2)}%, 0) scale(1.2)`;
    }
  };
  window.addEventListener('scroll', () => {
    if (!ticking) requestAnimationFrame(update);
    ticking = true;
  }, { passive: true });
  update();
}

// ---------- Background videos ----------
// Videos load only when motion is allowed and the visitor isn't saving data. They play while
// on screen and pause off screen. The photo underneath shows until the video is ready.
const saveData = navigator.connection?.saveData === true;
const videos = [...document.querySelectorAll('video.bg-video[data-src]')];

if (motion && !saveData && videos.length && 'IntersectionObserver' in window) {
  const PAUSE_ICON = '<svg viewBox="0 0 12 12" aria-hidden="true"><rect x="2" y="1" width="3" height="10"/><rect x="7" y="1" width="3" height="10"/></svg>';
  const PLAY_ICON = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 1l9 5-9 5z"/></svg>';
  let userPaused = false;
  const buttons = [];

  const setButton = (button) => {
    button.innerHTML = `${userPaused ? PLAY_ICON : PAUSE_ICON}<span>${userPaused ? 'Play video' : 'Pause video'}</span>`;
    button.setAttribute('aria-pressed', String(userPaused));
  };

  const onScreen = new IntersectionObserver(
    (entries) => {
      for (const { target: video, isIntersecting } of entries) {
        if (isIntersecting && !video.src) {
          video.src = video.dataset.src;
        }
        if (isIntersecting && !userPaused) video.play().catch(() => {});
        else video.pause();
      }
    },
    { rootMargin: '200px 0px' },
  );

  for (const video of videos) {
    video.addEventListener('playing', () => video.classList.add('is-playing'), { once: true });
    onScreen.observe(video);

    // One pause button per section; pausing applies to every background video on the page
    const section = video.closest('.hero, .feature');
    if (section) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'video-toggle';
      setButton(button);
      button.addEventListener('click', () => {
        userPaused = !userPaused;
        for (const b of buttons) setButton(b);
        for (const v of videos) {
          if (userPaused) v.pause();
          else if (v.src && v.getBoundingClientRect().bottom > 0 && v.getBoundingClientRect().top < innerHeight) v.play().catch(() => {});
        }
      });
      buttons.push(button);
      section.append(button);
    }
  }
}

// ---------- Header: solid after scrolling, tucks away going down, returns going up ----------
const header = document.querySelector('.site-header');
if (header) {
  let lastY = window.scrollY;
  const onScroll = () => {
    const y = window.scrollY;
    header.classList.toggle('is-solid', y > 40 || document.body.classList.contains('no-hero'));
    const menuOpen = document.body.classList.contains('menu-open');
    header.classList.toggle('is-hidden', !menuOpen && y > lastY && y > 320);
    lastY = y;
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  // Show the header again when keyboard focus moves into it
  header.addEventListener('focusin', () => header.classList.remove('is-hidden'));
}

// ---------- Mobile menu (hamburger) ----------
const toggle = document.querySelector('.menu-toggle');
const menu = document.getElementById('mobile-menu');
if (toggle && menu) {
  // Visibility is handled in CSS (.mobile-menu.is-open), so it works with or without animation
  const setOpen = (open) => {
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    menu.classList.toggle('is-open', open);
    document.body.classList.toggle('menu-open', open);
    if (open) requestAnimationFrame(() => menu.querySelector('a')?.focus());
  };

  toggle.addEventListener('click', () => setOpen(toggle.getAttribute('aria-expanded') !== 'true'));
  menu.addEventListener('click', (event) => {
    if (event.target.closest('a')) setOpen(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
      setOpen(false);
      toggle.focus();
    }
  });
  // Close it if the window is widened to desktop
  window.matchMedia('(min-width: 761px)').addEventListener('change', (e) => e.matches && setOpen(false));
}
