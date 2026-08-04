/* net/supabase-transport.js — Supabase Realtime 브로드캐스트 전송체.

   설정 우선순위:
     1) window.TF_SUPABASE = { url, key }  (shell.html / 배포 HTML 에서 권장)
     2) 아래 URL / KEY 상수 (개발용 폴백)

   단일 파일 빌드 시 shell.html 에 supabase-js CDN 과 TF_SUPABASE 가 먼저 실린다.
   Realtime 브로드캐스트만 사용 — 테이블/RLS 불필요. 방 코드가 곧 비밀번호다. */
(function (root) {
  'use strict';

  var URL = '';
  var KEY = '';

  function cfg() {
    var c = root.TF_SUPABASE || {};
    return {
      url: (c.url || URL || '').trim(),
      key: (c.key || KEY || '').trim()
    };
  }

  root.makeTransport = function (code, role, cb) {
    var conf = cfg();
    if (!conf.url || !conf.key) {
      cb(new Error('Supabase URL/KEY 가 없습니다. shell.html 의 window.TF_SUPABASE 를 채우세요.'));
      return;
    }
    if (!root.supabase || !root.supabase.createClient) {
      cb(new Error('supabase-js 가 로드되지 않았습니다. CDN 스크립트를 확인하세요.'));
      return;
    }

    var client = root.supabase.createClient(conf.url, conf.key);
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
