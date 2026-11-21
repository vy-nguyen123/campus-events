import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import App from '../src/App.vue';
import ToastNotification from '../src/components/ToastNotification.vue';
import { useNotifications } from '../src/composables/useNotifications.js';
import { subscribeToNotifications } from '../src/api/events.js';

class FakeEventSource {
  static instances = [];
  constructor(url) {
    this.url = url;
    this.listeners = new Map();
    this.close = vi.fn();
    FakeEventSource.instances.push(this);
  }
  addEventListener(name, listener) { this.listeners.set(name, listener); }
  removeEventListener(name) { this.listeners.delete(name); }
  receive(data) { this.listeners.get('notification')?.({ data }); }
}

const notification = (id = 'notification-one', type = 'registration.created') => ({
  id, type, eventId: 12, occurredAt: '2026-11-21T12:00:00.000Z'
});

describe('Real-time notifications', () => {
  let wrappers;

  beforeEach(() => {
    wrappers = [];
    FakeEventSource.instances = [];
    vi.useFakeTimers();
    vi.stubGlobal('EventSource', FakeEventSource);
  });

  afterEach(() => {
    wrappers.forEach((wrapper) => wrapper.unmount());
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function mountNotifications() {
    const Host = defineComponent({
      components: { ToastNotification },
      setup: useNotifications,
      template: '<ToastNotification :toasts="toasts" @dismiss="dismiss" />'
    });
    const wrapper = mount(Host);
    wrappers.push(wrapper);
    return wrapper;
  }

  it('opens one EventSource, parses notifications and closes it on unsubscribe', () => {
    const receive = vi.fn();
    const unsubscribe = subscribeToNotifications(receive);
    const source = FakeEventSource.instances[0];
    expect(source.url).toBe('/api/notifications');
    source.receive('{invalid json');
    expect(receive).not.toHaveBeenCalled();
    source.receive(JSON.stringify(notification()));
    expect(receive).toHaveBeenCalledExactlyOnceWith(notification());
    unsubscribe();
    expect(source.close).toHaveBeenCalledOnce();
    expect(source.listeners.size).toBe(0);
  });

  it('shows exactly one toast per received registration and suppresses duplicate IDs after dismissal', async () => {
    const wrapper = mountNotifications();
    const source = FakeEventSource.instances[0];
    source.receive(JSON.stringify(notification()));
    source.receive(JSON.stringify(notification()));
    await nextTick();
    expect(wrapper.findAll('[role="status"]')).toHaveLength(1);
    expect(wrapper.text()).toContain('A new registration was received for event #12.');
    await wrapper.get('button').trigger('click');
    source.receive(JSON.stringify(notification()));
    await nextTick();
    expect(wrapper.findAll('[role="status"]')).toHaveLength(0);
    source.receive(JSON.stringify(notification('notification-two')));
    await nextTick();
    expect(wrapper.findAll('[role="status"]')).toHaveLength(1);
  });

  it('shows both event types, ignores untrusted payload text, and dismisses after six seconds', async () => {
    const wrapper = mountNotifications();
    const source = FakeEventSource.instances[0];
    source.receive(JSON.stringify({ ...notification(), name: 'Private Person', email: 'secret@example.com', message: '<script>attack()</script>' }));
    source.receive(JSON.stringify(notification('created', 'event.created')));
    await nextTick();
    expect(wrapper.findAll('[role="status"]')).toHaveLength(2);
    expect(wrapper.text()).toContain('A new event was created (event #12).');
    expect(wrapper.text()).not.toContain('Private Person');
    expect(wrapper.text()).not.toContain('secret@example.com');
    expect(wrapper.find('script').exists()).toBe(false);
    await vi.advanceTimersByTimeAsync(6000);
    expect(wrapper.findAll('[role="status"]')).toHaveLength(0);
  });

  it('ignores malformed or unknown notifications and keeps its timers clean on unmount', async () => {
    const wrapper = mountNotifications();
    const source = FakeEventSource.instances[0];
    for (const invalid of [null, {}, { ...notification(), eventId: '<img>' }, { ...notification(), id: '' }, notification('x', 'constructor'), notification('x', 'unknown')]) {
      source.receive(JSON.stringify(invalid));
    }
    await nextTick();
    expect(wrapper.findAll('[role="status"]')).toHaveLength(0);
    source.receive(JSON.stringify(notification()));
    expect(vi.getTimerCount()).toBe(1);
    wrapper.unmount();
    wrappers = [];
    expect(source.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps a single root connection while navigating between pages', async () => {
    const Page = { template: '<p>Example page</p>' };
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/', component: Page }, { path: '/stats', component: Page }, { path: '/events/new', component: Page }]
    });
    await router.push('/');
    const wrapper = mount(App, { global: { plugins: [router] } });
    wrappers.push(wrapper);
    await router.push('/stats');
    await router.push('/events/new');
    expect(FakeEventSource.instances).toHaveLength(1);
    FakeEventSource.instances[0].receive(JSON.stringify(notification()));
    await nextTick();
    expect(wrapper.findAll('[role="status"]')).toHaveLength(1);
  });

  it('renders toast text safely and exposes an accessible dismiss button', async () => {
    const wrapper = mount(ToastNotification, { props: { toasts: [{ id: 'one', message: '<img src=x onerror=alert(1)>' }] } });
    wrappers.push(wrapper);
    expect(wrapper.find('[aria-live="polite"]').exists()).toBe(true);
    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.text()).toContain('<img src=x onerror=alert(1)>');
    await wrapper.get('button[aria-label="Dismiss notification"]').trigger('click');
    expect(wrapper.emitted('dismiss')).toEqual([['one']]);
  });
});
