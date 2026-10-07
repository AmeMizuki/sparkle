<script>
  import { Popover } from "bits-ui";
  import { Info } from "@lucide/svelte";
  let { text, label, side = "top" } = $props();
  let open = $state(false),
    pinned = false,
    timer;
  // Mouse hover previews the hint; click/Enter pins it (touch and keyboard); outside click or Esc closes.
  const show = (e) => {
    if (e.pointerType !== "mouse") return;
    clearTimeout(timer);
    open = true;
  };
  const hide = (e) => {
    if (e.pointerType !== "mouse" || pinned) return;
    timer = setTimeout(() => (open = false), 120);
  };
  function toggle(e) {
    e.preventDefault();
    pinned = !(open && pinned);
    open = pinned;
  }
</script>

<Popover.Root bind:open onOpenChange={(next) => !next && (pinned = false)}>
  <Popover.Trigger
    class="hint-trigger"
    aria-label={label}
    onpointerenter={show}
    onpointerleave={hide}
    onclick={toggle}><Info size={14} /></Popover.Trigger
  >
  <Popover.Portal>
    <Popover.Content
      class="hint-content"
      {side}
      sideOffset={8}
      collisionPadding={12}
      trapFocus={false}
      onOpenAutoFocus={(e) => e.preventDefault()}
      onCloseAutoFocus={(e) => e.preventDefault()}
      onpointerenter={show}
      onpointerleave={hide}>{text}</Popover.Content
    >
  </Popover.Portal>
</Popover.Root>
