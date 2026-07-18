/* CTG HR OS — service worker for Web Push clock-in reminders.
   Payloadless push: the push event carries no data, so the text lives here (fixed, which is all a
   clock-in reminder needs). Kept intentionally tiny — no offline caching, so it never serves stale app code. */
'use strict';

self.addEventListener('install', function(){ self.skipWaiting(); });
self.addEventListener('activate', function(e){ e.waitUntil(self.clients.claim()); });

self.addEventListener('push', function(event){
  // Payloadless push can't carry different text per event, so the message is neutral: it covers both
  // the shift-start (clock in) and shift-end (clock out) reminders. Opening the app shows the right button.
  var title = '⏰ Time Clock reminder';
  var body  = 'Open HR OS to clock in or out for your shift.';
  // If a payload ever is sent, use it; otherwise fall back to the fixed reminder text.
  try { if (event.data){ var d = event.data.json(); if (d && d.title) title = d.title; if (d && d.body) body = d.body; } } catch (_e) {}
  event.waitUntil(self.registration.showNotification(title, {
    body: body,
    icon: './logo.png',
    badge: './logo.png',
    tag: 'ctg-clockin',
    renotify: true,
    requireInteraction: false,
    data: { url: './hros.html#clock' }
  }));
});

self.addEventListener('notificationclick', function(event){
  event.notification.close();
  var target = (event.notification.data && event.notification.data.url) || './hros.html#clock';
  event.waitUntil(self.clients.matchAll({ type:'window', includeUncontrolled:true }).then(function(list){
    for (var i=0;i<list.length;i++){ if (list[i].url.indexOf('hros.html') >= 0 && 'focus' in list[i]) return list[i].focus(); }
    if (self.clients.openWindow) return self.clients.openWindow(target);
  }));
});
