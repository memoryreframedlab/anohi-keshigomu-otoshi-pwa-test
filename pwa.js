// 『あの日の教室 ～消しゴム落とし～』 ホーム画面に追加（PWA）の案内。ゲーム本体（Godot）には一切触れない。
//
//  Android（Chrome 等）：beforeinstallprompt を受け取れた時だけ［インストール］→ ブラウザ本来のインストール画面
//  iPhone／iPad：beforeinstallprompt は使わない。［追加方法］→ 小さな案内（Safari の手順・Safari 以外は「Safariで開いて」）
//  出す時：ゲームの読み込みが終わってタイトルが出ている間だけ。ゲームの画面を最初にタップしたら閉じる（ゲーム中には出さない）
//  出さない時：ホーム画面から起動中（standalone 等）・インストール済み・×／断った／追加方法を見た後の一定期間
//  保存：このゲーム専用のキー（同じ github.io の他のゲームとは共有しない）
(() => {
	'use strict';

	const STORE_KEY = 'anohi_keshigomu_otoshi_pwa_test_hint';   // 一時テスト用（本番の案内には影響しない）          // {until: ミリ秒, installed: bool}
	const SESSION_KEY = 'anohi_keshigomu_otoshi_pwa_test_closed';  // このタブ（セッション）では出さない
	const DAY = 24 * 60 * 60 * 1000;
	const SNOOZE_CLOSE = 14 * DAY;    // ×
	const SNOOZE_DECLINE = 14 * DAY;  // Android：インストール画面で断った
	const SNOOZE_HOWTO = 30 * DAY;    // iOS：追加方法を開いた
	const SHOW_DELAY = 700;           // タイトルが出てから少し待って出す（ミリ秒）

	// ---------------------------------------------------------------- 端末・ブラウザ
	const ua = navigator.userAgent || '';
	const isIPadOS = /Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1;   // iPad の Safari は Mac と名乗る
	const isIOS = /iPhone|iPad|iPod/.test(ua) || isIPadOS;
	const isIPad = /iPad/.test(ua) || isIPadOS;
	const iosBrowser = !isIOS ? '' :
		/Line\/|FBAN|FBAV|Instagram|Twitter|MicroMessenger|KAKAOTALK|GSA\//.test(ua) ? 'inapp' :
		/CriOS/.test(ua) ? 'chrome' :
		/FxiOS/.test(ua) ? 'firefox' :
		/EdgiOS/.test(ua) ? 'edge' :
		(/Version\/[\d.]+.*Safari\//.test(ua) ? 'safari' : 'other');

	function isStandalone() {
		if (navigator.standalone === true) {
			return true;   // iOS：ホーム画面から起動
		}
		return ['standalone', 'fullscreen', 'minimal-ui', 'window-controls-overlay']
			.some((m) => window.matchMedia && window.matchMedia('(display-mode: ' + m + ')').matches);
	}

	// ---------------------------------------------------------------- 表示しない期間の記録（使えない時も動作は止めない）
	function readStore() {
		try {
			return JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {};
		} catch (e) {
			return {};
		}
	}
	function writeStore(obj) {
		try {
			localStorage.setItem(STORE_KEY, JSON.stringify(Object.assign(readStore(), obj)));
		} catch (e) { /* 保存できなくても案内は閉じる */ }
	}
	function closedThisSession() {
		try {
			return sessionStorage.getItem(SESSION_KEY) === '1';
		} catch (e) {
			return false;
		}
	}
	function closeForSession() {
		try {
			sessionStorage.setItem(SESSION_KEY, '1');
		} catch (e) { /* 何もしない */ }
	}
	function suppressed() {
		const s = readStore();
		return s.installed === true || (typeof s.until === 'number' && Date.now() < s.until) || closedThisSession();
	}
	function snooze(ms) {
		writeStore({ until: Date.now() + ms });
		closeForSession();
	}

	// ---------------------------------------------------------------- 状態
	let deferredPrompt = null;      // Android：保持した beforeinstallprompt
	let gameReady = false;          // ゲームの読み込みが終わった（タイトルが出ている）
	let titlePhase = true;          // まだゲームの画面を触っていない（＝最初のタイトル）
	let banner = null;
	let sheet = null;

	// ---------------------------------------------------------------- 見た目（ゲームのボタンと同じ紙の色）。キャンバスの上に重ねるだけ
	const CSS = `
#kpwa-banner, #kpwa-sheet, #kpwa-backdrop { box-sizing: border-box; font-family: system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif; }
#kpwa-banner {
	position: fixed; z-index: 2147483000;
	top: calc(env(safe-area-inset-top, 0px) + 8px); left: 50%;
	width: calc(100% - 16px); max-width: 420px;
	transform: translate(-50%, calc(-100% - env(safe-area-inset-top, 0px) - 24px));
	transition: transform 0.28s ease-out;
	background: #faf2de; color: #472e1a;
	border: 2px solid #73512f; border-radius: 10px;
	box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
	padding: 10px 12px 10px 14px;
	display: flex; align-items: center; gap: 10px;
	touch-action: manipulation; -webkit-user-select: none; user-select: none;
}
#kpwa-banner.kpwa-in { transform: translate(-50%, 0); }
#kpwa-banner .kpwa-text { flex: 1 1 auto; min-width: 0; }
#kpwa-banner .kpwa-t1 { font-size: 15px; font-weight: 700; line-height: 1.35; }
#kpwa-banner .kpwa-t2 { font-size: 13px; line-height: 1.35; opacity: 0.85; }
#kpwa-banner button, #kpwa-sheet button {
	font: inherit; font-size: 15px; font-weight: 700;
	min-height: 44px; border-radius: 6px; cursor: pointer;
	-webkit-tap-highlight-color: transparent;
}
#kpwa-banner .kpwa-main, #kpwa-sheet .kpwa-main {
	padding: 6px 14px; background: #fffaf0; color: #472e1a; border: 2px solid #73512f; white-space: nowrap;
}
#kpwa-banner .kpwa-close {
	width: 44px; min-width: 44px; padding: 0; background: transparent; color: #472e1a; border: 1px solid rgba(115, 81, 47, 0.45);
	font-size: 20px; line-height: 1;
}
#kpwa-backdrop {
	position: fixed; inset: 0; z-index: 2147483001; background: rgba(0, 0, 0, 0.45);
	touch-action: manipulation;
}
#kpwa-sheet {
	position: fixed; z-index: 2147483002;
	left: 50%; top: calc(env(safe-area-inset-top, 0px) + 12px); transform: translateX(-50%);
	width: calc(100% - 24px); max-width: 400px;
	background: #faf2de; color: #472e1a;
	border: 2px solid #73512f; border-radius: 12px;
	box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4);
	padding: 16px 16px 14px;
	touch-action: manipulation; -webkit-user-select: none; user-select: none;
}
#kpwa-sheet h2 { font-size: 16px; margin: 0 0 10px; }
#kpwa-sheet ol { margin: 0 0 8px; padding-left: 1.5em; font-size: 15px; line-height: 1.7; }
#kpwa-sheet p { margin: 0 0 8px; font-size: 14px; line-height: 1.6; }
#kpwa-sheet .kpwa-sub { font-size: 13px; opacity: 0.85; }
#kpwa-sheet .kpwa-note { font-size: 13px; font-weight: 700; margin-top: 10px; padding-top: 8px; border-top: 1px solid rgba(115, 81, 47, 0.35); }
#kpwa-sheet .kpwa-row { display: flex; gap: 10px; justify-content: flex-end; margin-top: 12px; }
#kpwa-sheet .kpwa-sec { padding: 6px 14px; background: transparent; color: #472e1a; border: 1px solid rgba(115, 81, 47, 0.6); }
`;

	function el(tag, attrs, children) {
		const e = document.createElement(tag);
		Object.keys(attrs || {}).forEach((k) => {
			if (k === 'text') {
				e.textContent = attrs[k];
			} else if (k === 'onclick') {
				e.addEventListener('click', attrs[k]);
			} else {
				e.setAttribute(k, attrs[k]);
			}
		});
		(children || []).forEach((c) => e.appendChild(c));
		return e;
	}

	function injectStyle() {
		if (document.getElementById('kpwa-style')) {
			return;
		}
		document.head.appendChild(el('style', { id: 'kpwa-style', text: CSS }));
	}

	// ---------------------------------------------------------------- 上から出る小さな案内
	function mode() {
		if (isIOS) {
			return 'ios';
		}
		return deferredPrompt ? 'android' : '';
	}

	function canShow() {
		return gameReady && titlePhase && !isStandalone() && !suppressed() && mode() !== '' && !banner;
	}

	function showBanner() {
		if (!canShow()) {
			return;
		}
		injectStyle();
		const m = mode();
		const main = el('button', { type: 'button', class: 'kpwa-main', id: 'kpwa-main', text: m === 'android' ? 'インストール' : '追加方法' });
		const close = el('button', { type: 'button', class: 'kpwa-close', id: 'kpwa-close', 'aria-label': '閉じる', text: '×' });
		banner = el('div', { id: 'kpwa-banner', role: 'dialog', 'aria-label': 'ホーム画面に追加', 'data-mode': m }, [
			el('div', { class: 'kpwa-text' }, [
				el('div', { class: 'kpwa-t1', text: 'ホーム画面に追加できます' }),
				el('div', { class: 'kpwa-t2', text: 'アプリのようにすぐ遊べます' }),
			]),
			main, close,
		]);
		// 案内の上のタップがゲームに伝わらないように
		['pointerdown', 'mousedown', 'touchstart'].forEach((t) => banner.addEventListener(t, (e) => e.stopPropagation(), { passive: true }));
		close.addEventListener('click', () => {
			snooze(SNOOZE_CLOSE);
			hideBanner();
		});
		main.addEventListener('click', m === 'android' ? onInstall : onHowTo);
		document.body.appendChild(banner);
		requestAnimationFrame(() => requestAnimationFrame(() => banner && banner.classList.add('kpwa-in')));
	}

	function hideBanner() {
		if (!banner) {
			return;
		}
		const b = banner;
		banner = null;
		b.classList.remove('kpwa-in');
		setTimeout(() => b.remove(), 320);
	}

	// ---------------------------------------------------------------- Android：ブラウザ本来のインストール画面
	async function onInstall() {
		const ev = deferredPrompt;
		deferredPrompt = null;
		hideBanner();
		closeForSession();
		if (!ev) {
			return;
		}
		try {
			ev.prompt();
			const choice = await ev.userChoice;
			if (choice && choice.outcome === 'accepted') {
				writeStore({ installed: true });
			} else {
				snooze(SNOOZE_DECLINE);
			}
		} catch (e) {
			snooze(SNOOZE_DECLINE);
		}
	}

	// ---------------------------------------------------------------- iPhone／iPad：追加方法
	function onHowTo() {
		snooze(SNOOZE_HOWTO);
		hideBanner();
		openSheet();
	}

	function openSheet() {
		injectStyle();
		const backdrop = el('div', { id: 'kpwa-backdrop' });
		const body = [el('h2', { text: 'ホーム画面に追加する方法' })];
		if (iosBrowser === 'safari') {
			body.push(el('ol', {}, [
				el('li', { text: isIPad ? '画面右上の共有ボタンをタップ' : '共有ボタンをタップ' }),
				el('li', { text: '「ホーム画面に追加」を選ぶ' }),
				el('li', { text: '「追加」をタップ' }),
			]));
			body.push(el('p', { class: 'kpwa-sub', text: '共有が見つからない場合は「…」→「共有」' }));
		} else if (iosBrowser === 'inapp') {
			body.push(el('p', { text: 'このアプリの中の画面からは追加できません。Safariで開いてから追加してください。' }));
			body.push(el('p', { class: 'kpwa-sub', text: 'Safariで：共有 →「ホーム画面に追加」→「追加」' }));
		} else {
			body.push(el('p', { text: 'Safariで開いてから追加してください。' }));
			body.push(el('p', { class: 'kpwa-sub', text: 'Safariで：共有 →「ホーム画面に追加」→「追加」。このブラウザの共有メニューに「ホーム画面に追加」があれば、そこからでも追加できます。' }));
		}
		body.push(el('p', { class: 'kpwa-note', id: 'kpwa-save-note', text: 'ホーム画面から開くと、記録はブラウザ版とは別になります。' }));
		const row = el('div', { class: 'kpwa-row' });
		if (iosBrowser !== 'safari') {
			const copy = el('button', { type: 'button', class: 'kpwa-sec', id: 'kpwa-copy', text: 'URLをコピー' });
			copy.addEventListener('click', async () => {
				const url = location.href.split('#')[0];
				let ok = false;
				try {
					await navigator.clipboard.writeText(url);
					ok = true;
				} catch (e) {
					try {
						const ta = el('textarea', { readonly: '' });
						ta.value = url;
						ta.style.position = 'fixed';
						ta.style.opacity = '0';
						document.body.appendChild(ta);
						ta.select();
						ok = document.execCommand('copy');
						ta.remove();
					} catch (e2) { ok = false; }
				}
				copy.textContent = ok ? 'コピーしました' : 'コピーできませんでした';
			});
			row.appendChild(copy);
		}
		const done = el('button', { type: 'button', class: 'kpwa-main', id: 'kpwa-sheet-close', text: '閉じる' });
		row.appendChild(done);
		body.push(row);
		sheet = el('div', { id: 'kpwa-sheet', role: 'dialog', 'aria-label': 'ホーム画面に追加する方法', 'data-browser': iosBrowser }, body);
		const closeSheet = () => {
			backdrop.remove();
			if (sheet) {
				sheet.remove();
				sheet = null;
			}
		};
		done.addEventListener('click', closeSheet);
		backdrop.addEventListener('click', closeSheet);
		[backdrop, sheet].forEach((n) => ['pointerdown', 'mousedown', 'touchstart'].forEach((t) => n.addEventListener(t, (e) => e.stopPropagation(), { passive: true })));
		document.body.appendChild(backdrop);
		document.body.appendChild(sheet);
	}

	// ---------------------------------------------------------------- きっかけ
	window.addEventListener('beforeinstallprompt', (e) => {
		if (isIOS) {
			return;   // iOS では使わない
		}
		e.preventDefault();   // ブラウザの小さなバーは出さず、こちらの案内から出す
		deferredPrompt = e;
		showBanner();
	});
	window.addEventListener('appinstalled', () => {
		writeStore({ installed: true });
		deferredPrompt = null;
		hideBanner();
	});

	// ゲームの画面を最初に触ったら、最初のタイトルは終わり（案内は閉じ、このページではもう出さない）
	function endTitlePhase() {
		if (!titlePhase) {
			return;
		}
		titlePhase = false;
		hideBanner();
	}
	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'hidden') {
			endTitlePhase();
		}
	});

	function watchGame() {
		const canvas = document.getElementById('canvas');
		if (canvas) {
			['pointerdown', 'touchstart', 'mousedown'].forEach((t) => canvas.addEventListener(t, endTitlePhase, { capture: true, passive: true }));
		}
		// Godot の読み込みが終わると、読み込み中の表示（#status）が取り除かれる。それを待ってからタイトルとみなす
		const poll = () => {
			if (!document.getElementById('status')) {
				gameReady = true;
				setTimeout(showBanner, SHOW_DELAY);
				return;
			}
			setTimeout(poll, 250);
		};
		poll();
	}

	// ---------------------------------------------------------------- Service Worker（ゲーム本体はキャッシュしない。sw.js 参照）
	function registerSW() {
		if (!('serviceWorker' in navigator)) {
			return;
		}
		navigator.serviceWorker.register('sw.js', { scope: './' }).catch(() => { /* 登録できなくてもゲームは普段どおり */ });
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', watchGame);
	} else {
		watchGame();
	}
	window.addEventListener('load', registerSW);

	// 確認用（自動試験から状態を読むだけ。ゲームには影響しない）
	window.__kpwa = {
		state: () => ({ isIOS, isIPad, iosBrowser, standalone: isStandalone(), gameReady, titlePhase, hasPrompt: !!deferredPrompt, banner: banner ? banner.getAttribute('data-mode') : null, sheet: !!sheet, store: readStore(), closedThisSession: closedThisSession() }),
	};
})();
