<script>
  import { onMount, tick } from "svelte";
  import { fly } from "svelte/transition";
  import {
    Images,
    Heart,
    Clock3,
    Folder,
    Plus,
    Search,
    Upload,
    ChevronDown,
    LayoutGrid,
    List,
    SlidersHorizontal,
    Settings2,
    CircleHelp,
    HardDrive,
    ArrowUpRight,
    X,
    Leaf,
    Sparkles,
    Copy,
    Check,
    ArrowLeft,
    ZoomIn,
    ZoomOut,
    Pencil,
    Trash2,
    Download,
    FolderPlus,
    ChevronRight,
    ChevronLeft,
    PanelLeft,
    ShieldCheck,
    ImagePlus,
    Sun,
    Moon,
    Ellipsis,
  } from "@lucide/svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Dialog from "$lib/components/ui/dialog/index.js";
  import { ContextMenu } from "bits-ui";
  import Select from "$lib/components/ui/select/select.svelte";
  import Hint from "$lib/components/ui/hint/hint.svelte";
  import { db, loadImages, importFiles, seedSamples } from "./lib/db.js";
  import { en, zh } from "./lib/i18n.js";
  import { matchesSearch } from "./lib/search.js";
  import { contrastText, isHex, surfaceTokens } from "./lib/color.js";

  let images = $state.raw([]),
    collections = $state.raw([]),
    thumbs = $state.raw({});
  let originals = $state.raw({});
  let loading = $state(true),
    busy = $state(false),
    progress = $state({ done: 0, total: 0 });
  let view = $state("all"),
    selectedId = $state(null),
    detailId = $state(null),
    selectedUrl = $state("");
  let query = $state(""),
    source = $state("all"),
    sort = $state("newest"),
    from = $state(""),
    to = $state("");
  let compact = $state(false),
    filtersOpen = $state(false),
    mobileNav = $state(false),
    limit = $state(60),
    zoom = $state(false),
    infoTab = $state("prompts");
  let fullImage = $state(null), panning = $state(false), panStart;
  let modalOpen = $state(false),
    modal = $state(""),
    formName = $state(""),
    formError = $state(""),
    chosenCollections = $state([]);
  let status = $state(""),
    error = $state(""),
    importErrors = $state([]),
    dragging = $state(false),
    copied = $state("");
  let fileInput = $state(),
    folderInput = $state(),
    searchInput = $state(),
    restoreFocus;
  let heroId = $state(null),
    intro = $state(true),
    cardNames = $state(false),
    queryText = $state(""),
    introTimer,
    popId = $state(null),
    persistFailed = $state(false),
    isMobile = $state(matchMedia("(max-width: 767px)").matches),
    sentinel = $state(),
    toastTimer;
  function loadPreferences() {
    const defaults = {
      lang: "en",
      theme: "system",
      accent: "#46765b",
      bg: "neutral",
      tint: 50,
      previewResolution: "normal",
    };
    try {
      const saved = JSON.parse(
        localStorage.getItem("muse-preferences") || "{}",
      );
      return {
        lang: ["en", "zh-TW"].includes(saved.lang) ? saved.lang : defaults.lang,
        theme: ["system", "light", "dark"].includes(saved.theme)
          ? saved.theme
          : defaults.theme,
        accent: isHex(saved.accent) ? saved.accent : defaults.accent,
        bg:
          ["accent", "neutral"].includes(saved.bg) || isHex(saved.bg)
            ? saved.bg
            : defaults.bg,
        tint: Number.isFinite(saved.tint)
          ? Math.min(100, Math.max(0, saved.tint))
          : defaults.tint,
        previewResolution: saved.previewResolution === "original" ? "original" : "normal",
        // Small screens start with the rail; the user's choice wins afterwards.
        collapsed:
          typeof saved.collapsed === "boolean"
            ? saved.collapsed
            : innerWidth <= 1100,
      };
    } catch {
      return { ...defaults, collapsed: false };
    }
  }
  let prefs = $state(loadPreferences());
  let systemDark = $state(matchMedia("(prefers-color-scheme: dark)").matches),
    sampleBanner = $state(true),
    protectedStorage = $state(false);
  const t = $derived(prefs.lang === "zh-TW" ? zh : en);
  const isDark = $derived(
    prefs.theme === "dark" || (prefs.theme === "system" && systemDark),
  );
  const surface = $derived(surfaceTokens(prefs, isDark));
  const sidebarLabel = $derived(
    isMobile
      ? t.library
      : prefs.collapsed
        ? t.expandSidebar
        : t.collapseSidebar,
  );
  const accentPresets = $derived([
    { color: "#46765b", name: t.colorGreen },
    { color: "#b34f73", name: t.colorRose },
    { color: "#416fac", name: t.colorBlue },
    { color: "#a36730", name: t.colorOrange },
    { color: "#7a5ea8", name: t.colorViolet },
    { color: "#2f7f86", name: t.colorTeal },
    { color: "#b8453a", name: t.colorBrick },
    { color: "#556070", name: t.colorSlate },
  ]);
  const bgPresets = $derived([
    { color: "#bcd0ea", name: t.bgMist },
    { color: "#e6d3b3", name: t.bgSand },
    { color: "#f0c4cf", name: t.bgBlush },
    { color: "#c4dcc8", name: t.bgSage },
    { color: "#d4c8ee", name: t.bgLilac },
  ]);
  const isPreset = (list, color) => list.some((p) => p.color === color);
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const motion = (ms) => (reduced.matches ? 0 : ms);
  /**
   * Runs a state change inside a View Transition (page cross-fade, plus a shared-image morph when
   * `hero` names the image involved). Falls back to a plain update without support or under reduced motion.
   */
  async function morph(update, hero = null, cards = false) {
    if (!document.startViewTransition || reduced.matches) return void update();
    if (hero || cards) {
      heroId = hero;
      cardNames = cards;
      await tick();
    }
    const transition = document.startViewTransition(async () => {
      update();
      await tick();
    });
    try {
      await transition.finished;
    } catch {
      // A newer transition replaced this one; its own state change already ran.
    } finally {
      heroId = null;
      cardNames = false;
    }
  }
  // List changes (sort, filter, add, remove) glide each card to its new place instead of snapping.
  const listChange = (update) => morph(update, null, true);
  $effect(() => {
    const text = queryText;
    const id = setTimeout(
      () => text !== query && listChange(() => (query = text)),
      160,
    );
    return () => clearTimeout(id);
  });
  function notify(message) {
    status = message;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (status = ""), 3600);
  }
  function toggleSidebar() {
    if (isMobile) mobileNav = !mobileNav;
    else prefs.collapsed = !prefs.collapsed; // the grid column animates; a page cross-fade would fight it
  }
  function toggleTheme() {
    const root = document.documentElement;
    if (!reduced.matches) {
      root.classList.add("theme-fade");
      setTimeout(() => root.classList.remove("theme-fade"), 300);
    }
    prefs.theme = isDark ? "light" : "dark";
  }
  const selected = $derived(
    images.find((i) => i.id === (detailId || selectedId)),
  );
  const activeCollection = $derived(collections.find((c) => c.id === view));
  const title = $derived(
    view === "all"
      ? t.all
      : view === "favorites"
        ? t.favorites
        : view === "recent"
          ? t.recent
          : activeCollection?.name || t.all,
  );
  // ponytail: filter metadata in memory; move search to a worker/index if very large libraries stall.
  const filtered = $derived.by(() => {
    let result = images.filter(
      (i) =>
        (view !== "favorites" || i.favorite) &&
        (["all", "favorites", "recent"].includes(view) ||
          i.collectionIds?.includes(view)) &&
        (source === "all" || i.source === source) &&
        (!from || i.date.slice(0, 10) >= from) &&
        (!to || i.date.slice(0, 10) <= to) &&
        matchesSearch(i, query),
    );
    const byName = (a, b) => a.name.localeCompare(b.name, prefs.lang, { numeric: true });
    return result.sort((a, b) => {
      if (sort === "name") return byName(a, b) || a.id.localeCompare(b.id);
      const dateKey = view === "recent" ? "importedAt" : "date";
      const order = (a[dateKey] || a.date).localeCompare(b[dateKey] || b.date) ||
        a.importedAt.localeCompare(b.importedAt) || byName(a, b) || a.id.localeCompare(b.id);
      return sort === "oldest" ? order : -order;
    });
  });
  const displayed = $derived(filtered.slice(0, limit));
  const sources = $derived([...new Set(images.map((i) => i.source))].sort());
  const totalBytes = $derived(
    images.reduce((sum, i) => sum + (i.size || 0), 0),
  );
  const favoriteCount = $derived(images.filter((i) => i.favorite).length);
  const hasFilters = $derived(!!query || source !== "all" || !!from || !!to);
  const detailIndex = $derived(
    detailId ? filtered.findIndex((i) => i.id === detailId) : -1,
  );
  function bytes(n) {
    return n < 1048576
      ? `${(n / 1024).toFixed(0)} KB`
      : `${(n / 1048576).toFixed(1)} MB`;
  }
  function dateLabel(date) {
    return new Date(date).toLocaleDateString(
      prefs.lang === "zh-TW" ? "zh-TW" : "en-US",
      { month: "short", day: "numeric", year: "numeric" },
    );
  }
  function openModal(kind) {
    restoreFocus = document.activeElement;
    modal = kind;
    formError = "";
    error = "";
    formName =
      kind === "edit"
        ? selected?.name || ""
        : kind === "manage"
          ? activeCollection?.name || ""
          : "";
    chosenCollections = [...(selected?.collectionIds || [])];
    modalOpen = true;
  }
  function closeModal() {
    modalOpen = false;
    restoreFocus?.focus?.();
  }
  function navigate(next, animate = true) {
    mobileNav = false;
    if (animate && next === view && !detailId) return;
    const update = () => {
      view = next;
      selectedId = null;
      limit = 60;
      if (detailId) {
        detailId = null;
        location.hash = "main";
      }
      // A fresh staggered reveal makes the switch read as a new page, not a silent swap.
      intro = true;
      clearTimeout(introTimer);
      introTimer = setTimeout(() => (intro = false), 900);
    };
    if (animate) morph(update);
    else update();
  }
  function openImage(image) {
    infoTab = "prompts";
    if (isMobile || matchMedia("(max-width: 1000px)").matches) {
      location.hash = `image/${image.id}`;
      return;
    }
    selectedId = image.id;
  }
  function imageModal(image, kind) {
    if (!detailId) selectedId = image.id;
    openModal(kind);
  }
  async function toggleCollection(image, id) {
    const ids = image.collectionIds || [];
    await action(() => patch(image, {
      collectionIds: ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id],
    }));
  }
  function startPan(event) {
    if (!zoom || event.button !== 0) return;
    event.preventDefault();
    const element = event.currentTarget;
    element.setPointerCapture(event.pointerId);
    panStart = { x: event.clientX, y: event.clientY, left: element.scrollLeft, top: element.scrollTop };
    panning = true;
  }
  function pan(event) {
    if (!panning) return;
    event.currentTarget.scrollLeft = panStart.left + panStart.x - event.clientX;
    event.currentTarget.scrollTop = panStart.top + panStart.y - event.clientY;
  }
  function endPan(event) {
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    panning = false;
    panStart = null;
  }
  function dragOver(event) {
    event.preventDefault();
    dragging = !busy && event.dataTransfer.types.includes("Files") &&
      !event.dataTransfer.types.includes("text/uri-list");
    event.dataTransfer.dropEffect = dragging ? "copy" : "none";
  }
  function clearFilters() {
    query = "";
    queryText = "";
    source = "all";
    from = "";
    to = "";
    limit = 60;
  }
  const resetFilters = () => listChange(clearFilters);
  function route(animate = true) {
    const match = location.hash.match(/^#image\/(.+)$/);
    const next = match ? decodeURIComponent(match[1]) : null;
    const prev = detailId;
    if (next === prev) return;
    const update = () => {
      detailId = next;
      zoom = false;
      if (!next) heroId = prev; // lets the closed image morph back into its card
    };
    // Only entering or leaving the full view morphs; paging between images (arrow keys) must stay instant.
    if (animate && (!prev || !next)) morph(update, next);
    else update();
  }
  async function refresh({ animate = false, before } = {}) {
    const rows = await loadImages();
    const old = thumbs;
    const next = Object.fromEntries(
      rows.map((i) => [
        i.id,
        old[i.id] || URL.createObjectURL(i.thumbnail || i.blob),
      ]),
    );
    const nextCollections = await db.collections.toArray();
    const commit = () => {
      before?.();
      thumbs = next;
      images = rows;
      collections = nextCollections;
      for (const [id, url] of Object.entries(old))
        if (!next[id]) URL.revokeObjectURL(url);
    };
    await (animate ? listChange(commit) : commit());
  }
  async function action(fn) {
    error = "";
    try {
      await fn();
    } catch (e) {
      error = `${t.error} ${e.message || ""}`;
    }
  }
  async function patch(image, changes) {
    await db.images.update(image.id, changes);
    const apply = () =>
      (images = images.map((i) =>
        i.id === image.id ? { ...i, ...changes } : i,
      ));
    const leavesView =
      (view === "favorites" && changes.favorite === false) ||
      (activeCollection &&
        changes.collectionIds &&
        !changes.collectionIds.includes(view));
    if (leavesView) await listChange(apply);
    else apply();
  }
  async function toggleFavorite(image) {
    popId = image.id;
    setTimeout(() => popId === image.id && (popId = null), 300);
    await action(() => patch(image, { favorite: !image.favorite }));
  }
  async function importImages(files) {
    if (busy) return;
    busy = true;
    progress = { done: 0, total: files.length };
    importErrors = [];
    error = "";
    closeModal();
    try {
      const result = await importFiles(
        Array.from(files),
        (p) => (progress = p),
      );
      importErrors = result.errors;
      notify(
        result.imported === 1
          ? t.importOneSuccess
          : t.importSuccess.replace("{count}", result.imported),
      );
      await refresh({
        animate: true,
        before: () => {
          navigate("all", false);
          clearFilters();
        },
      });
    } catch (e) {
      error = `${t.error} ${e.message || ""}`;
    } finally {
      busy = false;
      if (fileInput) fileInput.value = "";
      if (folderInput) folderInput.value = "";
    }
  }
  async function dropped(event) {
    event.preventDefault();
    dragging = false;
    if (busy || !event.dataTransfer.types.includes("Files") ||
      event.dataTransfer.types.includes("text/uri-list")) return;
    const entries = [...event.dataTransfer.items]
      .map((item) => item.webkitGetAsEntry?.())
      .filter(Boolean);
    async function collect(entry) {
      if (entry.isFile)
        return [
          await new Promise((resolve, reject) => entry.file(resolve, reject)),
        ];
      const reader = entry.createReader();
      let all = [];
      for (;;) {
        const batch = await new Promise((resolve, reject) =>
          reader.readEntries(resolve, reject),
        );
        if (!batch.length) break;
        all.push(...batch);
      }
      return (await Promise.all(all.map(collect))).flat();
    }
    await action(async () =>
      importImages(
        entries.length
          ? (await Promise.all(entries.map(collect))).flat()
          : [...event.dataTransfer.files],
      ),
    );
  }
  async function saveForm(event) {
    event.preventDefault();
    formError = "";
    if (!formName.trim() && ["edit", "collection", "manage"].includes(modal)) {
      formError = modal === "edit" ? t.nameRequired : t.collectionRequired;
      event.currentTarget.querySelector(".form-field input")?.focus();
      return;
    }
    await action(async () => {
      if (modal === "edit")
        await patch(selected, {
          name: formName.trim(),
        });
      if (modal === "collection") {
        const id = crypto.randomUUID();
        await db.collections.add({ id, name: formName.trim() });
        collections = await db.collections.toArray();
        navigate(id);
      }
      if (modal === "manage") {
        await db.collections.update(view, { name: formName.trim() });
        collections = await db.collections.toArray();
      }
      if (modal === "assign")
        await patch(selected, {
          collectionIds: [...chosenCollections],
        });
      if (modal === "delete") {
        await db.images.delete(selected.id);
        selectedId = null;
        if (detailId) location.hash = "";
        await refresh({ animate: true });
      }
      if (modal === "deleteCollection") {
        await db.transaction("rw", db.images, db.collections, async () => {
          for (const i of images.filter((i) => i.collectionIds?.includes(view)))
            await db.images.update(i.id, {
              collectionIds: i.collectionIds.filter((id) => id !== view),
            });
          await db.collections.delete(view);
        });
        await refresh({
          animate: true,
          before: () => navigate("all", false),
        });
      }
      if (modal === "samples") {
        await db.images.bulkDelete(
          images.filter((i) => i.sample).map((i) => i.id),
        );
        selectedId = null;
        if (selected?.sample) location.hash = "";
        await refresh({ animate: true });
      }
      closeModal();
    });
  }
  async function copy(text, kind) {
    await action(async () => {
      await navigator.clipboard.writeText(text);
      copied = kind;
      notify(t.copied);
    });
  }
  function move(delta) {
    const index = filtered.findIndex((i) => i.id === selected?.id),
      next = filtered[index + delta];
    if (next) {
      if (detailId) location.hash = `image/${next.id}`;
      else selectedId = next.id;
    }
  }
  function keydown(event) {
    if (document.querySelector('[data-context-menu-content]')) return;
    if (
      event.key === "Escape" &&
      !modalOpen &&
      !document.querySelector('[data-slot="dialog-content"]')
    ) {
      mobileNav = false;
      if (detailId) location.hash = "";
      else if (selectedId) selectedId = null;
    }
    if (event.target.closest("input,textarea,select") || modalOpen) return;
    if (
      event.key === "/" ||
      ((event.ctrlKey || event.metaKey) && event.key === "k")
    ) {
      event.preventDefault();
      searchInput?.focus();
    }
    if (selected && ["ArrowLeft", "ArrowRight"].includes(event.key)) {
      event.preventDefault();
      move(event.key === "ArrowLeft" ? -1 : 1);
    }
    if (event.key === "[") toggleSidebar();
  }
  $effect(() => {
    const image = selected;
    if (!image) {
      selectedUrl = "";
      return;
    }
    const url = URL.createObjectURL(image.blob);
    selectedUrl = url;
    copied = "";
    return () => URL.revokeObjectURL(url);
  });
  $effect(() => {
    if (prefs.previewResolution !== "original") {
      originals = {};
      return;
    }
    const urls = Object.fromEntries(displayed.map((image) => [image.id, URL.createObjectURL(image.blob)]));
    originals = urls;
    return () => Object.values(urls).forEach(URL.revokeObjectURL);
  });
  $effect(() => {
    selected?.id;
    zoom;
    panning = false;
    panStart = null;
    fullImage?.scrollTo(0, 0);
  });
  $effect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", isDark);
    root.lang = prefs.lang;
    for (const [name, value] of Object.entries(surface))
      root.style.setProperty(name, value);
    localStorage.setItem("muse-preferences", JSON.stringify(prefs));
    // index.html replays this before first paint so a dark or tinted library never flashes.
    localStorage.setItem(
      "muse-surface",
      JSON.stringify({ dark: isDark, ...surface }),
    );
  });
  $effect(() => {
    query;
    source;
    from;
    to;
    view;
    sort;
    limit = 60;
  });
  $effect(() => {
    // One staggered reveal when the library first appears, then the gallery stays still.
    if (loading) return;
    const id = setTimeout(() => (intro = false), 900);
    return () => clearTimeout(id);
  });
  $effect(() => {
    // Load the next page while the sentinel is within 600px; limit/length re-arm the observer.
    limit;
    filtered.length;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) limit += 60;
      },
      { rootMargin: "600px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  });
  onMount(() => {
    sampleBanner = localStorage.getItem("muse-hide-samples") !== "true";
    const dark = matchMedia("(prefers-color-scheme: dark)");
    const narrow = matchMedia("(max-width: 767px)");
    systemDark = dark.matches;
    isMobile = narrow.matches;
    const onDark = (e) => (systemDark = e.matches);
    const onNarrow = (e) => {
      isMobile = e.matches;
      if (!e.matches) mobileNav = false;
    };
    const onHash = () => route();
    dark.addEventListener("change", onDark);
    narrow.addEventListener("change", onNarrow);
    route(false);
    window.addEventListener("hashchange", onHash);
    action(async () => {
      await seedSamples();
      await refresh();
      protectedStorage = (await navigator.storage?.persisted?.()) || false;
    }).finally(() => (loading = false));
    return () => {
      dark.removeEventListener("change", onDark);
      narrow.removeEventListener("change", onNarrow);
      window.removeEventListener("hashchange", onHash);
      clearTimeout(toastTimer);
      Object.values(thumbs).forEach(URL.revokeObjectURL);
    };
  });
</script>

<svelte:window onkeydown={keydown} ondragstart={(event) => {
  if (event.target.closest?.(".app-shell") && event.target.closest?.("img,a"))
    event.preventDefault();
}} />
<svelte:head
  ><title
    >{selected && detailId
      ? `${selected.name} | Sparkle`
      : "Sparkle | Your prompt library"}</title
  ></svelte:head
>
<a class="skip-link" href="#main"
  >{prefs.lang === "en" ? "Skip to content" : "跳至主要內容"}</a
>
<input
  class="hidden"
  type="file"
  accept="image/*"
  multiple
  bind:this={fileInput}
  onchange={(e) => importImages(e.target.files)}
  aria-label={t.chooseImages}
/>
<input
  class="hidden"
  type="file"
  accept="image/*"
  multiple
  webkitdirectory=""
  bind:this={folderInput}
  onchange={(e) => importImages(e.target.files)}
  aria-label={t.chooseFolder}
/>

<div
  class="app-shell"
  class:with-inspector={!!selectedId && !detailId}
  class:collapsed={prefs.collapsed}
  inert={modalOpen}
>
  <aside id="sidebar" class="sidebar" class:mobile-open={mobileNav}>
    <a
      class="brand"
      href="#main"
      aria-label="Sparkle"
      onclick={() => navigate("all")}
      ><img
        class="brand-logo"
        src={`${import.meta.env.BASE_URL}sparkle-logo.png`}
        alt=""
        width="2172"
        height="724"
      /><img
        class="brand-mark"
        src={`${import.meta.env.BASE_URL}favicon-32x32.png`}
        alt=""
        width="32"
        height="32"
      /></a
    >
    <div class="sidebar-body">
      <div class="nav-label">{t.library}</div>
      <nav aria-label={t.library}>
        {#each [{ id: "all", label: t.all, icon: Images, count: images.length }, { id: "favorites", label: t.favorites, icon: Heart, count: favoriteCount }, { id: "recent", label: t.recent, icon: Clock3 }] as item}
          <button
            class="nav-item"
            class:active={view === item.id}
            aria-current={view === item.id ? "page" : undefined}
            onclick={() => navigate(item.id)}
            title={prefs.collapsed ? item.label : undefined}
            ><item.icon size={18} strokeWidth={1.7} /><span>{item.label}</span
            >{#if item.count !== undefined}<span class="nav-count"
                >{item.count}</span
              >{/if}</button
          >
        {/each}
      </nav>
      <div class="collection-heading">
        <span class="nav-label">{t.collections}</span><button
          class="small-icon"
          aria-label={t.newCollection}
          title={t.newCollection}
          onclick={() => openModal("collection")}><Plus size={16} /></button
        >
      </div>
      <nav class="collection-nav" aria-label={t.collections}>
        {#each collections as collection}
          <button
            class="nav-item"
            class:active={view === collection.id}
            aria-current={view === collection.id ? "page" : undefined}
            onclick={() => navigate(collection.id)}
            title={collection.name}
            ><Folder size={17} strokeWidth={1.6} /><span>{collection.name}</span
            ><span class="nav-count"
              >{images.filter((i) => i.collectionIds?.includes(collection.id))
                .length}</span
            ></button
          >
        {/each}
        <button
          class="nav-item add-collection"
          onclick={() => openModal("collection")}
          title={t.newCollection}
          ><Plus size={17} /><span>{t.newCollection}</span></button
        >
      </nav>
      <div class="privacy-note">
        <span class="privacy-icon"><Leaf size={19} strokeWidth={1.5} /></span>
        <h3>{t.private}</h3>
        <p>{t.privateBody}</p>
      </div>
    </div>
    <div class="sidebar-footer">
      <button
        class="nav-item"
        title={t.settings}
        onclick={() => openModal("settings")}
        ><Settings2 size={18} /><span>{t.settings}</span></button
      ><button class="nav-item" title={t.help} onclick={() => openModal("help")}
        ><CircleHelp size={18} /><span>{t.help}</span></button
      >
      <div class="device-status">
        <HardDrive size={14} /><span>{t.local}</span><ShieldCheck size={14} />
      </div>
    </div>
  </aside>
  {#if mobileNav}<button
      class="nav-scrim"
      aria-label={t.close}
      onclick={() => (mobileNav = false)}
    ></button>{/if}
  <div class="workspace">
    <header class="topbar">
      <div class="topbar-left">
        <button
          class="icon-button sidebar-toggle"
          aria-label={sidebarLabel}
          title={sidebarLabel}
          aria-controls="sidebar"
          aria-expanded={isMobile ? mobileNav : !prefs.collapsed}
          onclick={toggleSidebar}><PanelLeft size={19} /></button
        >
        <div class="breadcrumb">
          <span>{t.library}</span><ChevronRight size={14} /><strong
            >{detailId ? selected?.name || t.image : title}</strong
          >
        </div>
      </div>
      <div class="topbar-right">
        <span class="offline-label"><HardDrive size={14} />{t.privacy}</span>
        <button
          class="icon-button theme-toggle"
          aria-label={isDark ? t.light : t.dark}
          title={isDark ? t.light : t.dark}
          onclick={toggleTheme}
          ><Sun size={18} class="icon-sun" /><Moon
            size={18}
            class="icon-moon"
          /></button
        >
      </div>
    </header>
    <main id="main" class="main-content" class:detail-main={!!detailId}>
      {#if error}<div class="error-banner" role="alert">
          <span>{error}</span><button
            class="small-icon"
            aria-label={t.dismiss}
            onclick={() => (error = "")}><X size={16} /></button
          >
        </div>{/if}
      {#if importErrors.length}<div class="error-banner" role="alert">
          <details>
            <summary>{t.importErrors} ({importErrors.length})</summary
            >{#each importErrors as issue}<p>{issue}</p>{/each}
          </details>
          <button
            class="small-icon"
            aria-label={t.dismiss}
            onclick={() => (importErrors = [])}><X size={16} /></button
          >
        </div>{/if}
      {#if busy}<div class="import-progress" role="status">
          <Upload size={18} /><span>{t.importing}</span><strong
            >{progress.done} / {progress.total}</strong
          ><progress value={progress.done} max={progress.total || 1}></progress>
        </div>{/if}
      {#if detailId}
        {#if selected}
          <div class="detail-toolbar">
            <a href="#main" class="back-link"><ArrowLeft size={17} />{t.back}</a
            >
            <div class="toolbar-actions">
              {#if detailIndex >= 0}<div class="pager">
                  <button
                    class="icon-button"
                    aria-label={t.prevImage}
                    title={t.prevImage}
                    disabled={detailIndex === 0}
                    onclick={() => move(-1)}><ChevronLeft size={19} /></button
                  ><span class="pager-count"
                    >{detailIndex + 1} / {filtered.length}</span
                  ><button
                    class="icon-button"
                    aria-label={t.nextImage}
                    title={t.nextImage}
                    disabled={detailIndex === filtered.length - 1}
                    onclick={() => move(1)}><ChevronRight size={19} /></button
                  >
                </div>{/if}
              <Button
                variant="outline"
                onclick={() => {
                  zoom = !zoom;
                  if (zoom) notify(t.panHint);
                }}
                >{#if zoom}<ZoomOut size={16} />{t.fit}{:else}<ZoomIn
                    size={16}
                  />{t.zoom}{/if}</Button
              ><button
                class="icon-button"
                aria-label={selected.favorite ? t.unfavorite : t.favorite}
                onclick={() => toggleFavorite(selected)}
                ><Heart
                  size={19}
                  fill={selected.favorite ? "currentColor" : "none"}
                /></button
              >
            </div>
          </div>
          <div class="detail-layout">
            <ContextMenu.Root>
            <ContextMenu.Trigger
              class={`full-image${zoom ? " zoomed" : ""}${panning ? " panning" : ""}`}
              bind:ref={fullImage}
              role="region"
              tabindex="0"
              aria-label={`${selected.name}: ${t.panHint}`}
              onpointerdown={startPan}
              onpointermove={pan}
              onpointerup={endPan}
              onpointercancel={endPan}
              onlostpointercapture={() => { panning = false; panStart = null; }}
            >
              <img
                src={selectedUrl}
                alt={selected.name}
                draggable="false"
                style:width={zoom ? `${selected.width}px` : undefined}
                style:max-width={zoom ? "none" : undefined}
              />
            </ContextMenu.Trigger>
            {@render imageMenu(selected)}
            </ContextMenu.Root>
            <aside class="detail-info">
              {#key selected.id}<div class="info-swap">
                  {@render imageInfo(true)}
                </div>{/key}
            </aside>
          </div>
        {:else if !loading}<div class="empty-state">
            <Images size={36} />
            <h1>{t.missing}</h1>
            <p>{t.missingHint}</p>
            <Button href="#main">{t.back}</Button>
          </div>{/if}
      {:else}
        <section class="page-heading">
          {#key view}<div>
            <div class="page-title-row">
              <h1>{title}</h1>
              <span class="total-badge"
                >{view === "all" ? images.length : filtered.length}</span
              >
            </div>
            <p>
              {view === "all"
                ? t.subtitle
                : view === "favorites"
                  ? t.favoriteHint
                  : activeCollection
                    ? t.collectionHint
                    : t.title}
            </p>
          </div>{/key}
          <div class="heading-actions">
            {#if activeCollection}<button
                class="icon-button outlined"
                aria-label={t.manage}
                onclick={() => openModal("manage")}
                ><Ellipsis size={19} /></button
              >{/if}<Button
              class="import-button"
              onclick={() => openModal("import")}
              disabled={busy}><Plus size={17} />{t.import}</Button
            >
          </div>
        </section>
        <div class="gallery-toolbar">
          <label class="search-field"
            ><Search size={18} strokeWidth={1.7} /><span class="sr-only"
              >{t.search}</span
            ><input
              bind:this={searchInput}
              bind:value={queryText}
              placeholder={t.searchPlaceholder}
            />{#if queryText}<button
                class="small-icon"
                aria-label={t.clear}
                onclick={() => (queryText = "")}><X size={15} /></button
              >{:else}<kbd>/</kbd>{/if}</label
          >
          <div class="toolbar-controls">
            <button
              class="filter-button"
              class:enabled={filtersOpen || hasFilters}
              onclick={() => (filtersOpen = !filtersOpen)}
              aria-expanded={filtersOpen}
              ><SlidersHorizontal size={16} /><span>{t.filter}</span
              >{#if source !== "all" || from || to}<span class="filter-count"
                  >{Number(source !== "all") +
                    Number(!!from) +
                    Number(!!to)}</span
                >{/if}</button
            ><Select
              class="select-quiet"
              label={prefs.lang === "en" ? "Sort images" : "圖片排序"}
              value={sort}
              options={[
                { value: "newest", label: t.newest },
                { value: "oldest", label: t.oldest },
                { value: "name", label: t.nameSort },
              ]}
              onchange={(next) => listChange(() => (sort = next))}
            />
            <div class="view-toggle">
              <button
                class:chosen={!compact}
                aria-label={t.grid}
                aria-pressed={!compact}
                onclick={() => listChange(() => (compact = false))}
                ><LayoutGrid size={17} /></button
              ><button
                class:chosen={compact}
                aria-label={t.list}
                aria-pressed={compact}
                onclick={() => listChange(() => (compact = true))}><List size={18} /></button
              >
            </div>
          </div>
        </div>
        {#if filtersOpen}<div
            class="filter-panel"
            in:fly={{ y: -6, duration: motion(180) }}
          >
            <div class="field">
              <span>{t.source}</span><Select
                label={t.source}
                value={source}
                options={[
                  { value: "all", label: t.allTools },
                  ...sources.map((s) => ({ value: s, label: s })),
                ]}
                onchange={(next) => listChange(() => (source = next))}
              />
            </div>
            <label
              >{t.from}<input
                type="date"
                value={from}
                onchange={(e) =>
                  listChange(() => (from = e.currentTarget.value))}
              /></label
            ><label
              >{t.to}<input
                type="date"
                value={to}
                onchange={(e) => listChange(() => (to = e.currentTarget.value))}
              /></label
            ><Button variant="ghost" onclick={resetFilters}>{t.reset}</Button>
          </div>{/if}
        {#if sampleBanner && images.some((i) => i.sample) && view === "all" && !hasFilters}<div
            class="sample-banner"
          >
            <span class="sample-icon"
              ><Sparkles size={20} strokeWidth={1.5} /></span
            >
            <div>
              <strong>{t.samples}</strong>
              <p>{t.sampleBody}</p>
            </div>
            <button
              class="small-icon"
              aria-label={t.dismiss}
              onclick={() => {
                sampleBanner = false;
                localStorage.setItem("muse-hide-samples", "true");
              }}><X size={16} /></button
            >
          </div>{/if}
        <div
          class="gallery-region"
          ondragover={dragOver}
          ondragleave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget)) dragging = false;
          }}
          ondrop={dropped}
          role="region"
          aria-label={title}
        >
          {#if dragging}<div class="drop-overlay">
              <Upload size={34} /><strong>{t.drop}</strong>
            </div>{/if}
          {#key view}{#if loading}<div
              class="gallery skeleton-gallery"
              aria-label={t.loading}
            >
              {#each Array(8) as _, i}<div
                  class="skeleton-card"
                  style:height={`${[260, 320, 240, 290][i % 4]}px`}
                ></div>{/each}
            </div>
          {:else if !filtered.length}<div class="empty-state">
              {#if view === "favorites"}<Heart size={38} />{:else}<ImagePlus
                  size={38}
                />{/if}
              <h2>
                {hasFilters
                  ? t.noResults
                  : view === "favorites"
                    ? t.emptyFavorites
                    : activeCollection
                      ? t.emptyCollection
                      : t.noImages}
              </h2>
              <p>
                {hasFilters
                  ? t.noResultsHint
                  : view === "favorites"
                    ? t.favoriteHint
                    : activeCollection
                      ? t.collectionEmptyHint
                      : t.emptyHint}
              </p>
              <Button
                variant={hasFilters ? "outline" : "default"}
                onclick={() =>
                  hasFilters ? resetFilters() : openModal("import")}
                >{hasFilters ? t.clear : t.import}</Button
              >
            </div>
          {:else}<div class="gallery" class:compact class:intro>
              {#each displayed as image, index (image.id)}
                <ContextMenu.Root>
                <ContextMenu.Trigger>
                {#snippet child({ props })}
                <article {...props}
                  class="image-card"
                  class:selected={selectedId === image.id}
                  style:--i={index}
                  style:view-transition-name={cardNames
                    ? `c-${image.id}`
                    : undefined}
                >
                  <div class="image-frame">
                    <button
                      class="image-open"
                      aria-label={`${image.name}: ${t.prompts}`}
                      onclick={() => openImage(image)}
                      ><img
                        src={originals[image.id] || thumbs[image.id]}
                        alt={image.name}
                        draggable="false"
                        width={image.width}
                        height={image.height}
                        loading={index < 12 ? "eager" : "lazy"}
                        fetchpriority={index < 4 ? "high" : "auto"}
                        decoding="async"
                        style:view-transition-name={heroId === image.id &&
                        !selectedId
                          ? "hero-image"
                          : undefined}
                      /></button
                    ><button
                      class="favorite-button"
                      class:is-favorite={image.favorite}
                      class:pop={popId === image.id}
                      aria-label={image.favorite ? t.unfavorite : t.favorite}
                      aria-pressed={image.favorite}
                      onclick={() => toggleFavorite(image)}
                      ><Heart
                        size={17}
                        strokeWidth={1.7}
                        fill={image.favorite ? "currentColor" : "none"}
                      /></button
                    >{#if selectedId === image.id}<span class="selected-check"
                        ><Check size={14} /></span
                      >{/if}
                  </div>
                  <div class="card-info">
                    <button
                      class="card-name"
                      title={image.name}
                      onclick={() => openImage(image)}>{image.name}</button
                    >
                    <div class="card-meta">
                      <span class="source-tag">{image.source}</span>
                    </div>
                    {#if compact}<time datetime={image.date}
                        >{dateLabel(image.date)}</time
                      >{/if}
                  </div>
                </article>
                {/snippet}
                </ContextMenu.Trigger>
                {@render imageMenu(image)}
                </ContextMenu.Root>
              {/each}
            </div>{/if}{/key}
        </div>
        {#if !loading && filtered.length > limit}<div
            class="sentinel"
            bind:this={sentinel}
            aria-hidden="true"
          ></div>
          <div class="load-more">
            <Button variant="outline" onclick={() => (limit += 60)}
              >{t.loadMore}</Button
            ><span>{displayed.length} / {filtered.length}</span>
          </div>{/if}
        <footer class="gallery-footer">
          <span
            >{filtered.length}
            {filtered.length === 1 ? t.image : t.images}{#if hasFilters}<button
                onclick={resetFilters}>{t.clear}</button
              >{/if}</span
          ><span><ShieldCheck size={13} />{t.allLocal}</span>
        </footer>
      {/if}
    </main>
  </div>
  {#if selected && !detailId}<aside
      class="inspector"
      in:fly={{ x: 16, duration: motion(200) }}
    >
      <div class="inspector-top">
        <span>{t.details}</span>
        <div>
          <a
            class="icon-button"
            href={`#image/${selected.id}`}
            aria-label={t.fullView}
            title={t.fullView}><ArrowUpRight size={19} /></a
          ><button
            class="icon-button"
            aria-label={t.close}
            onclick={() => (selectedId = null)}><X size={18} /></button
          >
        </div>
      </div>
      <ContextMenu.Root>
      <ContextMenu.Trigger class="inspector-preview">
        <a href={`#image/${selected.id}`} aria-label={t.fullView}
          ><img src={prefs.previewResolution === "original" ? selectedUrl : thumbs[selected.id]} alt={selected.name} draggable="false" /></a
        >
      </ContextMenu.Trigger>
      {@render imageMenu(selected)}
      </ContextMenu.Root>
      <div class="inspector-content">
        {#key selected.id}<div class="info-swap">
            {@render imageInfo(false)}
          </div>{/key}
      </div>
    </aside>{/if}
</div>
<div class="toast-region" role="status" aria-live="polite">
  {#if status}
    <div class="toast" transition:fly={{ y: 12, duration: motion(220) }}>
      <Check size={16} />{status}
    </div>
  {/if}
</div>

{#snippet imageMenu(image)}
  <ContextMenu.Portal>
    <ContextMenu.Content class="image-context-menu">
      <ContextMenu.Item onSelect={() => (location.hash = `image/${image.id}`)}>
        <ArrowUpRight size={16} />{t.fullView}
      </ContextMenu.Item>
      <ContextMenu.Item onSelect={() => toggleFavorite(image)}>
        <Heart size={16} fill={image.favorite ? "currentColor" : "none"} />
        {image.favorite ? t.unfavorite : t.favorite}
      </ContextMenu.Item>
      <ContextMenu.Sub>
        <ContextMenu.SubTrigger><FolderPlus size={16} />{t.assign}<ChevronRight size={14} /></ContextMenu.SubTrigger>
        <ContextMenu.Portal>
          <ContextMenu.SubContent class="image-context-menu">
            {#each collections as collection}
              <ContextMenu.Item onSelect={() => toggleCollection(image, collection.id)}>
                <Folder size={16} /><span>{collection.name}</span>
                {#if image.collectionIds?.includes(collection.id)}<Check size={14} />{/if}
              </ContextMenu.Item>
            {/each}
            <ContextMenu.Item onSelect={() => imageModal(image, "assign")}>
              <SlidersHorizontal size={16} />{t.organize}
            </ContextMenu.Item>
          </ContextMenu.SubContent>
        </ContextMenu.Portal>
      </ContextMenu.Sub>
      <ContextMenu.Separator />
      <ContextMenu.Item onSelect={() => imageModal(image, "edit")}><Pencil size={16} />{t.rename}</ContextMenu.Item>
      <ContextMenu.Item class="destructive" onSelect={() => imageModal(image, "delete")}><Trash2 size={16} />{t.remove}</ContextMenu.Item>
    </ContextMenu.Content>
  </ContextMenu.Portal>
{/snippet}

{#snippet imageInfo(full)}
  {#if selected}
    <div class="info-title">
      {#if full}
        <h1>{selected.name}</h1>
      {:else}
        <h2>{selected.name}</h2>
      {/if}
      <button
        class="icon-button"
        aria-label={t.rename}
        onclick={() => openModal("edit")}><Pencil size={16} /></button
      >
    </div>
    <div class="info-meta-strip">
      <span class="source-tag">{selected.source}</span><span
        >{selected.width} × {selected.height}</span
      ><span>{bytes(selected.size)}</span>
    </div>
    <div class="info-actions">
      <Button variant="outline" onclick={() => toggleFavorite(selected)}
        ><Heart
          size={15}
          fill={selected.favorite ? "currentColor" : "none"}
        />{selected.favorite ? t.favorites : t.favorite}</Button
      ><button
        class="icon-button outlined"
        aria-label={t.assign}
        title={t.assign}
        onclick={() => openModal("assign")}><FolderPlus size={17} /></button
      ><a
        class="icon-button outlined"
        href={selectedUrl}
        download={selected.downloadName || selected.name}
        aria-label={t.download}
        title={t.download}><Download size={17} /></a
      >
    </div>
    {#if selected.sample}<div class="sample-disclaimer">
        <Sparkles size={14} /><span>{t.sample}</span><Hint
          text={t.sampleInfo}
          label={t.moreInfo}
        />
      </div>{/if}
    {#if !full}<div class="info-tabs">
        <button
          class:active={infoTab === "prompts"}
          onclick={() => (infoTab = "prompts")}>{t.prompts}</button
        ><button
          class:active={infoTab === "details"}
          onclick={() => (infoTab = "details")}>{t.details}</button
        >
      </div>{/if}
    {#key full ? "full" : infoTab}<div class="tab-swap">
    {#if full || infoTab === "details"}
      <div class="preview-resolution">
        <span class="row-with-hint"
          >{t.previewResolution}<Hint
            text={t.previewHint}
            label={t.moreInfo}
          /></span
        >
        <Select
          label={t.previewResolution}
          value={prefs.previewResolution}
          options={[
            { value: "normal", label: t.previewNormal },
            { value: "original", label: t.previewOriginal },
          ]}
          onchange={(next) => (prefs.previewResolution = next)}
        />
      </div>
    {/if}
    {#if full || infoTab === "prompts"}
      {#each [{ key: "positive", label: t.positive, value: selected.positive, empty: t.noPrompt }, { key: "negative", label: t.negative, value: selected.negative, empty: t.noNegative }] as prompt}
        <section class="prompt-section">
          <div class="prompt-label">
            <h3>{prompt.label}</h3>
            <button
              class="small-icon"
              disabled={!prompt.value}
              aria-label={copied === prompt.key ? t.copied : t.copy}
              onclick={() => copy(prompt.value, prompt.key)}
              >{#if copied === prompt.key}<Check size={15} />{:else}<Copy
                  size={15}
                />{/if}</button
            >
          </div>
          <p class="prompt-text" class:no-prompt={!prompt.value}>
            {prompt.value || prompt.empty}
          </p>
        </section>
      {/each}
    {/if}
    {#if full || infoTab === "details"}
      <section class="parameters">
        <h3>{t.generation}</h3>
        {#if Object.keys(selected.parameters || {}).length}<dl>
            {#each Object.entries(selected.parameters || {}) as [key, value]}<div
              >
                <dt>
                  {t.parameterLabels[key] || key}
                </dt>
                <dd>
                  {typeof value === "object"
                    ? JSON.stringify(value)
                    : String(value)}
                </dd>
              </div>{/each}
          </dl>{:else}<p class="muted">{t.noMetadata}</p>{/if}
      </section>
      <div class="file-details">
        <span>{t.date}</span><time datetime={selected.date}
          >{dateLabel(selected.date)}</time
        >
      </div>
      <div class="file-details"><span>{t.dimensions}</span><span>{selected.width} × {selected.height}</span></div>
      <div class="file-details"><span>{t.fileSize}</span><span>{bytes(selected.size)}</span></div>
      {#if selected.originalSize}
        <div class="file-details"><span>{t.originalFileSize}</span><span>{bytes(selected.originalSize)}</span></div>
      {/if}
      <div class="file-details"><span>{t.storedFormat}</span><span>{selected.blob.type || "—"}</span></div>
      {#if selected.warnings?.length}<div class="metadata-warning">
          <strong>{t.metadataWarning}</strong
          >{#each selected.warnings as warning}<p>{warning}</p>{/each}
        </div>{/if}
      <details class="raw-metadata">
        <summary>{t.raw}</summary>
        <pre>{JSON.stringify(selected.raw || {}, null, 2)}</pre>
      </details>
    {/if}
    </div>{/key}
    {#if selected.collectionIds?.length}<div class="image-collections">
        {#each selected.collectionIds as id}{@const collection =
            collections.find((c) => c.id === id)}{#if collection}<button
              onclick={() => {
                if (detailId) location.hash = "";
                navigate(id);
              }}><Folder size={13} />{collection.name}</button
            >{/if}{/each}
      </div>{/if}
    {#if !full}<Button
        variant="outline"
        class="full-view-button"
        href={`#image/${selected.id}`}
        >{t.fullView}<ArrowUpRight size={16} /></Button
      >{/if}
    <button class="remove-button" onclick={() => openModal("delete")}
      ><Trash2 size={15} />{t.remove}</button
    >
  {/if}
{/snippet}

<Dialog.Root bind:open={modalOpen}>
  <Dialog.Content class="app-dialog" showCloseButton={false}>
    <button
      class="dialog-close icon-button"
      aria-label={t.close}
      onclick={closeModal}><X size={18} /></button
    >
    <Dialog.Header
      ><Dialog.Title
        >{modal === "import"
          ? t.uploadTitle
          : modal === "collection"
            ? t.newCollection
            : modal === "manage"
              ? t.manage
              : modal === "assign"
                ? t.organize
                : modal === "edit"
                  ? t.rename
                  : modal === "delete"
                    ? t.remove
                    : modal === "deleteCollection"
                      ? t.deleteCollection
                      : modal === "samples"
                        ? t.deleteSamples
                        : modal === "settings"
                          ? t.settings
                          : t.help}</Dialog.Title
      ><Dialog.Description
        >{modal === "import"
          ? t.uploadHint
          : modal === "collection"
            ? t.collectionHint
            : modal === "assign"
              ? t.selectCollections
              : modal === "edit"
                ? t.editHint
                : modal === "delete"
                  ? t.deleteHint
                  : modal === "deleteCollection"
                    ? t.deleteCollectionHint
                    : modal === "samples"
                      ? t.deleteSamplesHint
                      : modal === "help"
                        ? t.helpBody
                        : modal === "manage"
                          ? t.collectionHint
                          : t.privateBody}</Dialog.Description
      ></Dialog.Header
    >
    {#if error}<p class="form-error" role="alert">{error}</p>{/if}
    {#if modal === "import"}
      <div
        class="import-dropzone"
        ondragover={dragOver}
        ondrop={dropped}
        role="region"
        aria-label={t.drop}
      >
        <span class="upload-illustration"
          ><Images size={39} strokeWidth={1.25} /><span><Plus size={16} /></span
          ></span
        >
        <h3>{t.drop}</h3>
        <p>{t.formats}</p>
        <Button onclick={() => fileInput.click()}
          ><Upload size={16} />{t.chooseImages}</Button
        ><Button variant="outline" onclick={() => folderInput.click()}
          ><Folder size={16} />{t.chooseFolder}</Button
        >
      </div>
      <p class="import-footnote">
        <ShieldCheck size={15} />{t.private}<Hint
          text={t.importNotice}
          label={t.moreInfo}
        />
      </p>
    {:else if modal === "settings"}
      <div class="settings-block">
        <h3>{t.appearance}</h3>
        <div class="setting-row">
          <span>{t.theme}</span><Select
            label={t.theme}
            value={prefs.theme}
            options={[
              { value: "system", label: t.system },
              { value: "light", label: t.light },
              { value: "dark", label: t.dark },
            ]}
            onchange={(next) => (prefs.theme = next)}
          />
        </div>
        <div class="palette-block">
          <span>{t.accent}</span>
          <div class="color-options">
            {#each accentPresets as option}<button
                class="color-swatch"
                class:chosen={prefs.accent === option.color}
                style:background={option.color}
                style:color={contrastText(option.color)}
                aria-label={option.name}
                aria-pressed={prefs.accent === option.color}
                title={option.name}
                onclick={() => (prefs.accent = option.color)}
                >{#if prefs.accent === option.color}<Check
                    size={16}
                  />{/if}</button
              >{/each}<label
              class="custom-color"
              class:chosen={!isPreset(accentPresets, prefs.accent)}
              style:background={!isPreset(accentPresets, prefs.accent)
                ? prefs.accent
                : undefined}
              style:color={contrastText(prefs.accent)}
              title={t.customColor}
              ><Plus size={16} /><span class="sr-only">{t.customColor}</span
              ><input type="color" bind:value={prefs.accent} /></label
            >
          </div>
        </div>
        <div class="palette-block">
          <span>{t.background}</span>
          <div class="color-options">
            <button
              class="chip"
              class:chosen={prefs.bg === "accent"}
              aria-pressed={prefs.bg === "accent"}
              onclick={() => (prefs.bg = "accent")}>{t.bgMatch}</button
            ><button
              class="chip"
              class:chosen={prefs.bg === "neutral"}
              aria-pressed={prefs.bg === "neutral"}
              onclick={() => (prefs.bg = "neutral")}>{t.bgNeutral}</button
            >{#each bgPresets as option}<button
                class="color-swatch"
                class:chosen={prefs.bg === option.color}
                style:background={option.color}
                style:color={contrastText(option.color)}
                aria-label={option.name}
                aria-pressed={prefs.bg === option.color}
                title={option.name}
                onclick={() => (prefs.bg = option.color)}
                >{#if prefs.bg === option.color}<Check size={16} />{/if}</button
              >{/each}<label
              class="custom-color"
              class:chosen={isHex(prefs.bg) && !isPreset(bgPresets, prefs.bg)}
              style:background={isHex(prefs.bg) &&
              !isPreset(bgPresets, prefs.bg)
                ? prefs.bg
                : undefined}
              style:color={isHex(prefs.bg) ? contrastText(prefs.bg) : undefined}
              title={t.bgCustom}
              ><Plus size={16} /><span class="sr-only">{t.bgCustom}</span><input
                type="color"
                value={isHex(prefs.bg) ? prefs.bg : "#bcd0ea"}
                oninput={(e) => (prefs.bg = e.currentTarget.value)}
              /></label
            >
          </div>
          <label class="tint-range"
            >{t.tint}<input
              type="range"
              min="0"
              max="100"
              step="5"
              bind:value={prefs.tint}
              disabled={prefs.bg === "neutral"}
            /></label
          >
        </div>
        <div class="setting-row">
          <span>{t.language}</span><Select
            label={t.language}
            value={prefs.lang}
            options={[
              { value: "en", label: "English" },
              { value: "zh-TW", label: "正體中文" },
            ]}
            onchange={(next) => (prefs.lang = next)}
          />
        </div>
        <div class="setting-row">
          <span class="row-with-hint"
            >{t.previewResolution}<Hint
              text={t.previewHint}
              label={t.moreInfo}
            /></span
          ><Select
            label={t.previewResolution}
            value={prefs.previewResolution}
            options={[
              { value: "normal", label: t.previewNormal },
              { value: "original", label: t.previewOriginal },
            ]}
            onchange={(next) => (prefs.previewResolution = next)}
          />
        </div>
      </div>
      <div class="settings-block storage-settings">
        <h3>
          <span class="row-with-hint"
            >{t.storage}<Hint text={t.storageHint} label={t.moreInfo} /></span
          ><span>{bytes(totalBytes)}</span>
        </h3>
        <Button
          variant="outline"
          onclick={() =>
            action(async () => {
              protectedStorage =
                (await navigator.storage?.persist?.()) || false;
              persistFailed = !protectedStorage;
              notify(protectedStorage ? t.persistent : t.persistDenied);
            })}
          ><ShieldCheck size={16} />{protectedStorage
            ? t.persistent
            : t.persist}</Button
        >{#if persistFailed}<p role="status">
            {t.persistDenied}
          </p>{/if}{#if images.some((i) => i.sample)}<button
            class="remove-button"
            onclick={() => openModal("samples")}>{t.deleteSamples}</button
          >{/if}
      </div>
    {:else if modal === "help"}
      <div class="shortcuts">
        <h3>{t.shortcuts}</h3>
        <div><span>{t.shortcutSearch}</span><kbd>/</kbd></div>
        <div><span>{t.shortcutClose}</span><kbd>Esc</kbd></div>
        <div>
          <span>{t.shortcutMove}</span><span><kbd>←</kbd> <kbd>→</kbd></span>
        </div>
        <div><span>{t.shortcutSidebar}</span><kbd>[</kbd></div>
        <div>
          <span>{t.zoom}</span><Hint text={t.panHint} label={t.moreInfo} />
        </div>
      </div>
      <div class="help-repository">
        <a href="https://github.com/AmeMizuki/sparkle" target="_blank" rel="noopener noreferrer">{t.repository}<ArrowUpRight size={16} /></a>
        <a href="https://github.com/AmeMizuki/sparkle/issues" target="_blank" rel="noopener noreferrer">{t.issueInvite}</a>
      </div>
      <p class="help-privacy">
        <HardDrive size={16} />{t.storage}<Hint
          text={t.storageHint}
          label={t.moreInfo}
        />
      </p>
    {:else}
      <form onsubmit={saveForm}>
        {#if ["edit", "collection", "manage"].includes(modal)}<label
            class="form-field"
            >{modal === "edit" ? t.name : t.collectionName}<input
              bind:value={formName}
              aria-invalid={!!formError}
              aria-describedby={formError ? "form-error" : undefined}
              placeholder={modal === "edit" ? "" : t.collectionPlaceholder}
              maxlength="200"
            />{#if formError}<span id="form-error" class="form-error"
                >{formError}</span
              >{/if}</label
          >{/if}
        {#if modal === "assign"}<div class="collection-choices">
            {#each collections as collection}<label
                ><input
                  type="checkbox"
                  value={collection.id}
                  bind:group={chosenCollections}
                /><Folder size={17} /><span>{collection.name}</span></label
              >{/each}{#if !collections.length}<p>{t.noCollections}</p>
              <Button variant="outline" onclick={() => openModal("collection")}
                >{t.newCollection}</Button
              >{/if}
          </div>{/if}
        <div class="form-actions">
          {#if modal === "manage"}<Button
              variant="destructive"
              onclick={() => openModal("deleteCollection")}
              ><Trash2 size={15} />{t.deleteCollection}</Button
            >{/if}<Button variant="outline" onclick={closeModal}
            >{t.cancel}</Button
          ><Button
            type="submit"
            variant={["delete", "deleteCollection", "samples"].includes(modal)
              ? "destructive"
              : "default"}
            >{modal === "collection"
              ? t.create
              : modal === "delete"
                ? t.delete
                : modal === "deleteCollection"
                  ? t.deleteCollection
                  : modal === "samples"
                    ? t.confirmRemove
                    : t.save}</Button
          >
        </div>
      </form>
    {/if}
  </Dialog.Content>
</Dialog.Root>
