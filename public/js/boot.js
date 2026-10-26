// Loaded synchronously in <head> so elements that animate in start hidden, with no flash.
// Visitors who ask their device for reduced motion get the page without animation.
if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  document.documentElement.classList.add('motion');
}
