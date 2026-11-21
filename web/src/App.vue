<script setup>
import { RouterLink, RouterView } from 'vue-router';
import ToastNotification from './components/ToastNotification.vue';
import { useNotifications } from './composables/useNotifications.js';

const { toasts, dismiss } = useNotifications();
</script>

<template>
  <header class="site-header">
    <RouterLink to="/" class="brand">Campus Events</RouterLink>
    <nav>
      <RouterLink to="/">Events</RouterLink>
      <RouterLink to="/stats">Occupancy</RouterLink>
      <RouterLink to="/events/new" class="button button--small">New event</RouterLink>
    </nav>
  </header>
  <main class="page">
    <RouterView />
  </main>
  <ToastNotification :toasts="toasts" @dismiss="dismiss" />
</template>
