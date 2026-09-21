<template>
  <div class="gallery">
    <div v-if="!images || !images.length" class="empty">暂无图片</div>
    <div v-else class="grid">
      <img
        v-for="(img, i) in images"
        :key="i"
        :src="img"
        class="thumb"
        alt="区域图片"
        loading="lazy"
        @click="open(i)"
      />
    </div>
    <div v-if="viewer !== null" class="lightbox" @click="viewer = null">
      <img :src="images[viewer]" class="lightbox-img" alt="预览" />
      <button class="close" @click.stop="viewer = null">×</button>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'

const props = defineProps({
  images: { type: Array, default: () => [] }
})

const viewer = ref(null)
function open(i) {
  viewer.value = i
}
</script>

<style scoped>
.gallery {
  width: 100%;
}
.empty {
  color: var(--text-1);
  font-size: 13px;
  padding: 8px 0;
}
.grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}
.thumb {
  width: 100%;
  height: 78px;
  object-fit: cover;
  border-radius: 8px;
  border: 1px solid rgba(56, 189, 248, 0.25);
  cursor: pointer;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}
.thumb:hover {
  transform: scale(1.04);
  box-shadow: 0 0 12px rgba(56, 189, 248, 0.5);
}
.lightbox {
  position: fixed;
  inset: 0;
  background: rgba(2, 6, 14, 0.86);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
  cursor: zoom-out;
}
.lightbox-img {
  max-width: 86vw;
  max-height: 86vh;
  border-radius: 10px;
  box-shadow: 0 0 40px rgba(56, 189, 248, 0.4);
}
.close {
  position: absolute;
  top: 24px;
  right: 32px;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: none;
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
  font-size: 22px;
  line-height: 1;
}
</style>
