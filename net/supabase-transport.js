/* net/supabase-transport.js — Supabase Realtime 브로드캐스트 전송체.

   설정 우선순위:
     1) window.TF_SUPABASE = { url, key }
     2) 아래 URL / KEY 상수

   CDN 은 UMD 빌드를 써야 window.supabase 가 생긴다.
   https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.1/dist/umd/supabase.js */
(function (root) {
  'use strict';

  var URL = 'https://ijmmqmarbkkkssciagof.supabase.co';
  var KEY = 'sb_publishable_-Yw_iVRLOGF0W1CFj_v9SA_PLm301S6';

  function cfg() {
    var c = root.TF_SUPABASE || {};
    return {
      url: (c.url || URL || '').trim(),
      key: (c.key || KEY || '').trim()
    };
  }

  function resolveCreateClient() {
    var s = root.supabase;
    if (!s) return null;
    if (typeof s.createClient === 'function') return s.createClient.bind(s);
    if (s.default && typeof s.default.createClient === 'function') return s.default.createClient.bind(s.default);
    if (typeof s === 'function') return s;
    return null;
  }

  root.makeTransport = function (code, role, cb) {
    var conf = cfg();
    if (!conf.url || !conf.key) {
      cb(new Error('Supabase URL/KEY 가 없습니다. index.html 의 window.TF_SUPABASE 를 채우세요.'));
      return;
    }
    var createClient = resolveCreateClient();
    if (!createClient) {
      cb(new Error('supabase-js 가 로드되지 않았습니다. 네트워크/CDN 차단 여부를 확인하세요.'));
      return;
    }

    var client = createClient(conf.url, conf.key);
    var ch = client.channel('tankfort-' + String(code).toUpperCase(), {
      config: { broadcast: { self: false, ack: true } }
    });

    var tr = {
      onMessage: null,
      send: function (o) { ch.send({ type: 'broadcast', event: 'm', payload: o }); },
      close: function () { try { client.removeChannel(ch); } catch (e) {} }
    };

    ch.on('broadcast', { event: 'm' }, function (p) {
      if (tr.onMessage) tr.onMessage(p.payload);
    });

    var done = false;
    ch.subscribe(function (status) {
      if (done) return;
      if (status === 'SUBSCRIBED') { done = true; cb(null, tr); }
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        done = true; cb(new Error('채널 연결 실패: ' + status));
      }
    });
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
