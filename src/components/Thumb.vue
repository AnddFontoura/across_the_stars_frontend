<script setup>
/**
 * Small square thumbnail. Renders the image when `src` is provided, otherwise
 * a photo-emoji placeholder (🖼️). Real image upload is a later feature.
 */
defineProps({
  src: { type: String, default: null },
  alt: { type: String, default: '' },
  size: { type: Number, default: 40 },
})
</script>

<template>
  <span
    class="thumb"
    :style="{ width: size + 'px', height: size + 'px', fontSize: Math.round(size * 0.5) + 'px' }"
  >
    <img v-if="src" :src="src" :alt="alt" />
    <span v-else class="ph">🖼️</span>
  </span>
</template>

<style scoped>
.thumb {
  display: inline-grid;
  place-items: center;
  border-radius: 8px;
  overflow: hidden;
  background: #0e1420;
  border: 1px solid rgba(120, 160, 220, 0.25);
  flex: none;
  vertical-align: middle;
}
.thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.ph {
  line-height: 1;
}
</style>
