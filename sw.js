// 『あの日の教室 ～消しゴム落とし～』 ホーム画面に追加（PWA）用の Service Worker
//
// 方針（更新の安全を最優先）：
//  - ゲーム本体（index.html / index.js / index.wasm / index.pck / 音の worklet）は、この Service Worker のキャッシュから出さない。
//    毎回ネットワークで確かめる（cache: 'no-cache'＝ブラウザの HTTP キャッシュも必ずサーバーに再確認する）。
//    → 公開版を更新したのに古いゲームが起動する、ということが起きない。
//  - キャッシュするのは、ネットワークが無い時に出す offline.html と、ホーム画面用のアイコンだけ。
//  - 同じ github.io ドメインには他のゲーム（手紙リレー等）もある。削除するのは、このゲーム専用の
//    PREFIX で始まる古い版のキャッシュだけ（CacheStorage を全部消すことはしない）。
//  - 困った時の非常口：この Service Worker を登録解除して自分のキャッシュだけ消す版に差し替えれば元に戻る。

const VERSION = '2026-09-27.pwa2-maskable-v2-build27fac1e7';   // 一時テスト用サイト（/anohi-keshigomu-otoshi-pwa-test/）   // PWA 版の改訂＋ゲーム本体の build（index.pck の SHA-256 の先頭）
const PREFIX = 'keshigomu-pwa-test-';   // 一時テスト用：本番（keshigomu-pwa-…）とは別の名前。消すのはこの接頭辞の古い版だけ
const CACHE = PREFIX + VERSION;
const OFFLINE_URL = 'offline.html';
const PRECACHE = [OFFLINE_URL, 'icon-192.png', 'icon-maskable-512-v2.png'];   // 2026-09-27：maskable アイコンを v2（約56%・Pixel 実機で外周が切れたため）へ

self.addEventListener('install', (event) => {
	event.waitUntil(
		caches.open(CACHE)
			.then((cache) => cache.addAll(PRECACHE.map((u) => new Request(u, { cache: 'reload' }))))
			.then(() => self.skipWaiting())
	);
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches.keys()
			.then((keys) => Promise.all(keys
				.filter((key) => key.startsWith(PREFIX) && key !== CACHE)   // このゲームの古い版だけ
				.map((key) => caches.delete(key))))
			.then(() => self.clients.claim())
	);
});

self.addEventListener('fetch', (event) => {
	const req = event.request;
	if (req.method !== 'GET') {
		return;
	}
	const url = new URL(req.url);
	const scopePath = new URL(self.registration.scope).pathname;
	if (url.origin !== self.location.origin || !url.pathname.startsWith(scopePath)) {
		return;   // このゲームの範囲外（他のゲーム・外部）には一切関わらない
	}
	if (req.mode === 'navigate') {
		// ページ（index.html）：毎回ネットワークで確かめる。つながらない時だけ offline.html
		event.respondWith(
			fetch(new Request(req, { cache: 'no-cache' })).catch(async () => {
				const cache = await caches.open(CACHE);
				return (await cache.match(OFFLINE_URL)) || Response.error();
			})
		);
		return;
	}
	// ゲーム本体・画像など：毎回ネットワークで確かめる（キャッシュから先に出すことはしない）。
	// つながらない時だけ、キャッシュ済みのアイコン等があればそれを返す（ゲーム本体はキャッシュしていないので返らない）
	event.respondWith(
		fetch(new Request(req, { cache: 'no-cache' })).catch(async () => {
			const cache = await caches.open(CACHE);
			return (await cache.match(req)) || Response.error();
		})
	);
});
