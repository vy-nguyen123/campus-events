import { onMounted, onUnmounted, ref } from 'vue';
import { subscribeToNotifications } from '../api/events.js';

const messages = {
  'event.created': (id) => `A new event was created (event #${id}).`,
  'registration.created': (id) => `A new registration was received for event #${id}.`
};

export function useNotifications() {
  const toasts = ref([]);
  const seen = new Set();
  const timers = new Map();
  let unsubscribe;

  function dismiss(id) {
    clearTimeout(timers.get(id));
    timers.delete(id);
    toasts.value = toasts.value.filter((toast) => toast.id !== id);
  }

  function receive(notification) {
    if (!validNotification(notification) || seen.has(notification.id)) return;
    seen.add(notification.id);
    if (seen.size > 500) seen.delete(seen.values().next().value);
    const { id, type, eventId } = notification;
    toasts.value.push({ id, message: messages[type](eventId) });
    timers.set(id, setTimeout(() => dismiss(id), 6000));
  }

  onMounted(() => { unsubscribe = subscribeToNotifications(receive); });
  onUnmounted(() => {
    unsubscribe?.();
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
  });
  return { toasts, dismiss };
}

function validNotification(notification) {
  if (!notification || typeof notification !== 'object') return false;
  return typeof notification.id === 'string' && notification.id.length <= 100 && notification.id.length > 0
    && Object.hasOwn(messages, notification.type)
    && Number.isSafeInteger(notification.eventId) && notification.eventId > 0;
}
