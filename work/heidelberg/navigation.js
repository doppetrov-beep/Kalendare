(() => {
  const content = document.querySelector(".wrap main");
  let visible = content.querySelector("iframe");
  const guide = content.dataset.guide;
  const russian = document.querySelector("#ruButton");
  const english = document.querySelector("#enButton");
  const status = document.querySelector("#langStatus");
  let language = "ru";
  let current = new URL(visible.src);
  let loading = null;
  const article = new RegExp(`/(?:original|russian)_${guide}/(x-\\d+)(?:\\.html)?$`);

  function localized(url) {
    const match = url.pathname.match(article);
    if (!match) return url;
    const folder = language === "ru" ? "russian" : "original";
    return new URL(`${folder}_${guide}/${match[1]}.html${url.search}${url.hash}`, document.baseURI);
  }

  function open(url) {
    current = localized(url);
    loading?.remove();
    const next = document.createElement("iframe");
    next.className = "article-loading";
    next.title = visible.title;
    next.src = current.href;
    loading = next;
    next.addEventListener("load", () => {
      if (loading !== next) return;
      next.name = "content";
      next.className = "";
      visible.remove();
      visible = next;
      loading = null;
      watchArticle(next);
    }, { once: true });
    content.append(next);
  }

  function follow(event, outer = false) {
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest?.("a[href]");
    if (!link || link.hasAttribute("download")) return;
    if (outer ? link.target !== "content" : link.target && link.target !== "_self" && link.target !== "content") return;
    const url = new URL(link.href);
    if (url.origin !== location.origin || (!outer && !article.test(url.pathname))) return;
    if (!outer && url.hash && url.pathname.match(article)?.[1] === current.pathname.match(article)?.[1]) return;
    event.preventDefault();
    open(url);
  }

  function watchArticle(frame) {
    frame.contentDocument?.addEventListener("click", event => follow(event));
  }

  function setLanguage(next) {
    if (language === next) return;
    language = next;
    russian.setAttribute("aria-pressed", String(next === "ru"));
    english.setAttribute("aria-pressed", String(next === "en"));
    status.textContent = next === "ru" ? "Русский перевод" : "Английский оригинал";
    document.querySelectorAll("#tree [data-en]").forEach(link => { link.textContent = link.dataset[next]; });
    if (article.test(current.pathname)) {
      const displayed = visible.contentDocument?.URL;
      if (!loading && displayed) current.hash = new URL(displayed).hash;
      open(current);
    }
  }

  russian.addEventListener("click", () => setLanguage("ru"));
  english.addEventListener("click", () => setLanguage("en"));
  document.querySelector("aside").addEventListener("click", event => follow(event, true));
  if (visible.contentDocument?.readyState === "complete" && visible.contentDocument.URL !== "about:blank") watchArticle(visible);
  else visible.addEventListener("load", () => watchArticle(visible), { once: true });
  russian.setAttribute("aria-pressed", "true");
  english.setAttribute("aria-pressed", "false");
})();
