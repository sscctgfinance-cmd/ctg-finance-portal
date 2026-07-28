/* CTG HR OS — service worker for Web Push clock-in reminders.
   Payloadless push: the push event carries no data, so the text lives here (fixed, which is all a
   clock-in reminder needs). Kept intentionally tiny — no offline caching, so it never serves stale app code. */
'use strict';

self.addEventListener('install', function(){ self.skipWaiting(); });
self.addEventListener('activate', function(e){ e.waitUntil(self.clients.claim()); });

var API = 'https://cmostxcjtbuhbzfojuid.supabase.co/functions/v1/portal';

// v172: the push carries no data, so ASK the server what this one is about — an approval waiting, or a
// clock reminder. A service worker cannot read localStorage, so it has no session token; it identifies
// itself with its OWN push subscription endpoint, which the server already stores against an employee.
// The server returns display text only, never anything that could act on a claim.
function describe(){
  return self.registration.pushManager.getSubscription().then(function(sub){
    if (!sub) return null;
    return fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api: 'push_pending', endpoint: sub.endpoint })
    }).then(function(r){ return r.json(); });
  }).catch(function(){ return null; });
}

self.addEventListener('push', function(event){
  // Fallback if the lookup fails for any reason — a notification that says nothing useful still beats none.
  var title = '⏰ Time Clock reminder';
  var body  = 'Open HR OS to clock in or out for your shift.';
  var url   = './hros.html#clock';
  // An encrypted payload would win if one is ever sent.
  try { if (event.data){ var d = event.data.json(); if (d && d.title) title = d.title; if (d && d.body) body = d.body; if (d && d.url) url = d.url; } } catch (_e) {}

  event.waitUntil(describe().then(function(info){
    if (info && info.ok && info.title){ title = info.title; body = info.body || body; url = info.url || url; }
    return self.registration.showNotification(title, {
      body: body,
      icon: './logo.png',
      badge: './logo.png',
      // Approvals get their own tag so a pending-approval nudge never silently replaces a clock reminder.
      tag: (url.indexOf('#claims') >= 0 ? 'ctg-approval' : 'ctg-clockin'),
      renotify: true,
      requireInteraction: false,
      data: { url: url }
    });
  }));
});

self.addEventListener('notificationclick', function(event){
  event.notification.close();
  var target = (event.notification.data && event.notification.data.url) || './hros.html#clock';
  var hash = target.indexOf('#') >= 0 ? target.slice(target.indexOf('#')) : '';
  event.waitUntil(self.clients.matchAll({ type:'window', includeUncontrolled:true }).then(function(list){
    for (var i=0;i<list.length;i++){
      if (list[i].url.indexOf('hros.html') >= 0 && 'focus' in list[i]){
        if (hash && 'navigate' in list[i]) { try { return list[i].navigate(list[i].url.split('#')[0] + hash).then(function(c){ return c && c.focus(); }); } catch(_e){} }
        return list[i].focus();
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(target);
  }));
});
