// Service Worker for Customer Auto Reply Phone Push Notifications

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Handle incoming VAPID Push Events from backend
self.addEventListener('push', (event) => {
  let data = {
    title: '🚨 Customer Alert!',
    body: 'New Instagram customer event received.',
    url: '/admin'
  };

  try {
    if (event.data) {
      data = event.data.json();
    }
  } catch (err) {
    if (event.data) {
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body || '🚨 Hurry up! There is a customer!',
    icon: 'https://cdn-icons-png.flaticon.com/512/2111/2111463.png',
    badge: 'https://cdn-icons-png.flaticon.com/512/2111/2111463.png',
    vibrate: [200, 100, 200, 100, 200],
    data: {
      url: data.url || '/admin'
    },
    actions: [
      { action: 'open', title: 'Open Dashboard' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(data.title || '🚨 Customer Alert!', options)
  );
});

// Handle notification tap / click
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/admin';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes('/admin') && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
