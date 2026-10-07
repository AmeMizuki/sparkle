<script>
  import { Select } from "bits-ui";
  import { ChevronDown, Check } from "@lucide/svelte";
  let { value, options, onchange, label, class: className = "" } = $props();
  const current = $derived(options.find((o) => o.value === value));
</script>

<Select.Root
  type="single"
  {value}
  items={options}
  onValueChange={(next) => next && next !== value && onchange(next)}
>
  <Select.Trigger class={`select-trigger ${className}`} aria-label={label}>
    <span>{current?.label ?? ""}</span><ChevronDown size={14} />
  </Select.Trigger>
  <Select.Portal>
    <Select.Content class="select-content" sideOffset={6}>
      <Select.Viewport>
        {#each options as option (option.value)}
          <Select.Item
            class="select-item"
            value={option.value}
            label={option.label}
          >
            {#snippet children({ selected })}
              <span>{option.label}</span
              >{#if selected}<Check size={14} />{/if}
            {/snippet}
          </Select.Item>
        {/each}
      </Select.Viewport>
    </Select.Content>
  </Select.Portal>
</Select.Root>
