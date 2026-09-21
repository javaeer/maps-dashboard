<template>
  <div class="crumb">
    <template v-for="(item, i) in items" :key="i">
      <span
        class="node"
        :class="{ active: i === items.length - 1, clickable: i < items.length - 1 }"
        @click="i < items.length - 1 && $emit('select', i)"
        >{{ item }}</span
      >
      <span v-if="i < items.length - 1" class="sep">›</span>
    </template>
  </div>
</template>

<script setup>
defineProps({
  items: { type: Array, default: () => [] }
})
defineEmits(['select'])
</script>

<style scoped>
.crumb {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
}
.node {
  color: var(--text-1);
  transition: color 0.2s ease;
}
.node.clickable {
  cursor: pointer;
}
.node.clickable:hover {
  color: var(--accent-2);
}
.node.active {
  color: var(--text-0);
  font-weight: 700;
  text-shadow: 0 0 12px rgba(56, 189, 248, 0.5);
}
.sep {
  color: rgba(159, 179, 200, 0.5);
}
</style>
