<script setup>
defineProps({ toasts: { type: Array, required: true } });
defineEmits(['dismiss']);
</script>

<template>
  <div class="toast-region" aria-live="polite" aria-relevant="additions" aria-label="Notifications">
    <div v-for="toast in toasts" :key="toast.id" class="toast" role="status">
      <span>{{ toast.message }}</span>
      <button type="button" class="toast__close" aria-label="Dismiss notification" @click="$emit('dismiss', toast.id)">×</button>
    </div>
  </div>
</template>
