(function() {
	if (document.getElementById("web-panel-dev")) return;

	const VERSION = "1.1.8";

	const networkLog = [];

	const _fetch = window.fetch;
	window.fetch = async function(...args) {
		const input = args[0];
		const init = args[1] || {};

		let url;
		if (typeof input === "string") {
			url = input;
		} else if (input instanceof Request) {
			url = input.url;
		} else if (input instanceof URL) {
			url = input.href;
		} else {
			url = String(input);
		}

		if (url && !url.startsWith('http') && !url.startsWith('//')) {
			url = new URL(url, location.href).href;
		}

		const method = init?.method || (input instanceof Request ? input.method : "GET");
		const headers = {};

		if (init?.headers) {
			if (init.headers instanceof Headers) {
				init.headers.forEach((v, k) => headers[k] = v);
			} else if (typeof init.headers === "object") {
				Object.assign(headers, init.headers);
			}
		}

		if (input instanceof Request && input.headers) {
			input.headers.forEach((v, k) => {
				if (!headers[k]) headers[k] = v;
			});
		}

		const body = init?.body || (input instanceof Request ? input.body : null);

		const params = {};
		try {
			const urlObj = new URL(url, location.href);
			urlObj.searchParams.forEach((v, k) => params[k] = v);
		} catch (_) {}

		const logEntry = {
			url: url || "unknown",
			method: method || "GET",
			headers,
			body,
			type: "fetch",
			timestamp: Date.now(),
			params
		};

		networkLog.push(logEntry);

		try {
			const response = await _fetch.apply(this, args);

			const clonedResponse = response.clone();

			logEntry.responseStatus = response.status;
			logEntry.responseStatusText = response.statusText;
			logEntry.responseHeaders = {};

			response.headers.forEach((v, k) => {
				logEntry.responseHeaders[k] = v;
			});

			logEntry.responseContentType = response.headers.get('content-type');
			logEntry.responseTimestamp = Date.now();

			try {
				const contentType = response.headers.get('content-type') || '';
				if (contentType.includes('application/json')) {
					logEntry.responseBody = await clonedResponse.json();
				} else if (contentType.includes('text/')) {
					logEntry.responseBody = await clonedResponse.text();
				} else {
					const blob = await clonedResponse.blob();
					logEntry.responseBody = `[Binary data: ${blob.size} bytes]`;
				}
			} catch (e) {
				logEntry.responseBody = `[Failed to read: ${e.message}]`;
			}

			return response;
		} catch (error) {
			logEntry.responseStatus = 0;
			logEntry.responseStatusText = `Error: ${error.message}`;
			logEntry.responseTimestamp = Date.now();
			throw error;
		}
	};

	const _open = XMLHttpRequest.prototype.open;
	const _send = XMLHttpRequest.prototype.send;
	const _setHeader = XMLHttpRequest.prototype.setRequestHeader;

	XMLHttpRequest.prototype.open = function(method, url) {
		this._wpLog = {
			method,
			url: url?.toString() || "unknown",
			headers: {},
			body: null,
			type: "xhr",
			timestamp: Date.now(),
			params: {}
		};

		try {
			const urlObj = new URL(this._wpLog.url, location.href);
			urlObj.searchParams.forEach((v, k) => this._wpLog.params[k] = v);
		} catch (_) {}

		return _open.apply(this, arguments);
	};

	XMLHttpRequest.prototype.setRequestHeader = function(k, v) {
		if (this._wpLog) this._wpLog.headers[k] = v;
		return _setHeader.apply(this, arguments);
	};

	XMLHttpRequest.prototype.send = function(body) {
		if (this._wpLog) {
			this._wpLog.body = body || null;

			const originalOnLoad = this.onload;
			const self = this;

			this.onload = function() {
				if (self._wpLog) {
					self._wpLog.responseStatus = self.status;
					self._wpLog.responseStatusText = self.statusText;
					self._wpLog.responseHeaders = {};
					self._wpLog.responseTimestamp = Date.now();

					const headerStr = self.getAllResponseHeaders();
					if (headerStr) {
						headerStr.split('\r\n').forEach(line => {
							const [k, v] = line.split(': ');
							if (k && v) self._wpLog.responseHeaders[k] = v;
						});
					}

					try {
						self._wpLog.responseBody = self.response;
					} catch (e) {
						self._wpLog.responseBody = `[Failed to read: ${e.message}]`;
					}
				}

				if (originalOnLoad) originalOnLoad.apply(this, arguments);
			};

			networkLog.push(this._wpLog);
		}
		return _send.apply(this, arguments);
	};

	/* ─── PLUGIN REGISTRY ─────────────────────────────────────────── */
	const registry = [];

	function registerPlugin(plugin) {
		registry.push(plugin);
	}

	registerPlugin({
		id: "cookie",
		label: "Cookie Viewer",
		color: "#1a6e2e",
		fetchData() {
			const raw = document.cookie;
			if (!raw) return "No cookies found.";
			const lines = raw.split(";").map((c) => {
				const [key, ...rest] = c.trim().split("=");
				return `${key.trim()}: ${rest.join("=").trim()}`;
			});
			return `=== COOKIES (${lines.length}) ===\n${lines.join("\n")}`;
		},
	});

	registerPlugin({
		id: "local",
		label: "Local Storage",
		color: "#1565c0",
		fetchData() {
			const s = localStorage;
			if (!s.length) return "localStorage is empty.";
			const lines = [];
			for (let i = 0; i < s.length; i++) {
				const k = s.key(i),
					v = s.getItem(k);
				let d = v;
				try {
					d = JSON.stringify(JSON.parse(v), null, 2);
				} catch (_) {}
				lines.push(`[${k}]\n${d}`);
			}
			return `=== LOCAL STORAGE (${lines.length} keys) ===\n\n${lines.join("\n\n")}`;
		},
	});

	registerPlugin({
		id: "session",
		label: "Session Storage",
		color: "#c62828",
		fetchData() {
			const s = sessionStorage;
			if (!s.length) return "sessionStorage is empty.";
			const lines = [];
			for (let i = 0; i < s.length; i++) {
				const k = s.key(i),
					v = s.getItem(k);
				let d = v;
				try {
					d = JSON.stringify(JSON.parse(v), null, 2);
				} catch (_) {}
				lines.push(`[${k}]\n${d}`);
			}
			return `=== SESSION STORAGE (${lines.length} keys) ===\n\n${lines.join("\n\n")}`;
		},
	});

	registerPlugin({
		id: "sitekey",
		label: "Get Sitekey V1",
		color: "#6a1b9a",
		async fetchData() {
			const results = [];
			const scannedUrls = new Set();
			const scannedScripts = new Set();

			const patterns = {
				hCaptcha: [
					/hcaptcha\.com\/1\/api\.js\?[^"']*sitekey=([0-9a-f-]{36})/gi,
					/["']sitekey["']\s*:\s*["']([0-9a-f-]{36})["']/gi,
					/data-sitekey=["']([0-9a-f-]{36})["']/gi,
					/h-captcha[^>]+data-sitekey=["']([0-9a-f-]{36})["']/gi,
					/hcaptcha\.execute\(["']([0-9a-f-]{36})["']/gi,
					/hcaptcha\.render\([^)]*["']([0-9a-f-]{36})["']/gi,
				],
				reCAPTCHA: [
					/recaptcha\/api\.js\?[^"']*render=([0-9A-Za-z_-]{40})/gi,
					/["']sitekey["']\s*:\s*["']([0-9A-Za-z_-]{40})["']/gi,
					/data-sitekey=["']([0-9A-Za-z_-]{40})["']/gi,
					/grecaptcha\.render\([^)]*["']([0-9A-Za-z_-]{40})["']/gi,
					/grecaptcha\.execute\(["']([0-9A-Za-z_-]{40})["']/gi,
					/grecaptcha\.ready\([^)]*["']([0-9A-Za-z_-]{40})["']/gi,
					/grecaptcha\.enterprise\.render\([^)]*["']([0-9A-Za-z_-]{40})["']/gi,
				],
				Turnstile: [
					/challenges\.cloudflare\.com\/turnstile[^"']*sitekey=([0-9A-Za-z_-]{40,60})/gi,
					/["']sitekey["']\s*:\s*["']([0-1][A-Za-z0-9_-]{39,59})["']/gi,
					/data-sitekey=["']([0-1][A-Za-z0-9_-]{39,59})["']/gi,
					/turnstile\.render\([^)]*sitekey\s*:\s*["']([0-9A-Za-z_-]{40,60})["']/gi,
					/turnstile\.ready\([^)]*["']([0-9A-Za-z_-]{40,60})["']/gi,
					/cf-turnstile[^>]+data-sitekey=["']([0-9A-Za-z_-]{40,60})["']/gi,
				],
				generic: [
					/sitekey["']?\s*[:=]\s*["']([0-9A-Za-z_-]{20,60})["']/gi,
					/data-sitekey=["']([0-9A-Za-z_-]{20,60})["']/gi,
					/["']site_key["']\s*:\s*["']([0-9A-Za-z_-]{20,60})["']/gi,
					/captchaSiteKey["']?\s*[:=]\s*["']([0-9A-Za-z_-]{20,60})["']/gi,
					/g-recaptcha-response["']?\s*[:=]\s*["']([0-9A-Za-z_-]{20,60})["']/gi,
				]
			};

			function classify(key) {
				if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key))
					return "hCaptcha";
				if (/^[01][A-Za-z0-9_-]{39,}$/.test(key))
					return "Turnstile";
				if (/^6L[A-Za-z0-9_-]{38}$/.test(key))
					return "reCAPTCHA";
				if (/^6L[A-Za-z0-9_-]{38}$/.test(key))
					return "reCAPTCHA";
				if (/^6L[A-Za-z0-9_-]{30,50}$/.test(key))
					return "reCAPTCHA Enterprise?";
				return "Unknown";
			}

			function isValidSitekey(key, type) {
				if (!key || key.length < 20) return false;
				if (key.includes(" ") || key.includes("\n")) return false;

				if (type === "reCAPTCHA") return /^6L[A-Za-z0-9_-]{30,50}$/.test(key);
				if (type === "hCaptcha") return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key);
				if (type === "Turnstile") return /^[01][A-Za-z0-9_-]{39,59}$/.test(key);
				return /^[A-Za-z0-9_-]{20,60}$/.test(key);
			}

			function scanText(text, sourceName, depth = 0) {
				const found = new Map();
				const indent = "  ".repeat(depth);

				for (const [type, patList] of Object.entries(patterns)) {
					for (const pat of patList) {
						pat.lastIndex = 0;
						let m;
						while ((m = pat.exec(text)) !== null) {
							const key = m[1];
							if (!key || key.length < 20) continue;
							if (key.includes(" ") || key.includes("\n") || key.includes("<")) continue;

							const detectedType = classify(key);
							if (!isValidSitekey(key, detectedType)) continue;

							if (!found.has(key)) {
								found.set(key, {
									type: detectedType,
									source: sourceName,
									depth: depth
								});
							}
						}
					}
				}
				return found;
			}

			function scanDocument(doc, sourceName, depth = 0) {
				const results = [];

				scanText(doc.documentElement?.innerHTML || "", `${sourceName} (HTML)`, depth)
					.forEach((val, key) => results.push({
						key,
						...val
					}));

				doc.querySelectorAll("script:not([src])").forEach((s, i) => {
					const content = s.textContent || "";
					if (content.trim() && !scannedScripts.has(content)) {
						scannedScripts.add(content);
						scanText(content, `${sourceName} (Inline Script #${i})`, depth)
							.forEach((val, key) => results.push({
								key,
								...val
							}));
					}
				});

				return results;
			}

			async function scanIframes(depth = 0) {
				if (depth > 3) return [];

				const results = [];
				const iframes = document.querySelectorAll("iframe");

				for (let i = 0; i < iframes.length; i++) {
					const iframe = iframes[i];
					try {
						const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
						if (iframeDoc) {
							const iframeResults = scanDocument(iframeDoc, `Iframe #${i}`, depth + 1);
							results.push(...iframeResults);

							const nestedResults = await scanIframes(depth + 1);
							results.push(...nestedResults);
						}
					} catch (e) {
						if (iframe.src && !scannedUrls.has(iframe.src)) {
							scannedUrls.add(iframe.src);
							try {
								const res = await fetch(iframe.src);
								const text = await res.text();
								scanText(text, `Iframe #${i} (cross-origin src)`, depth + 1)
									.forEach((val, key) => results.push({
										key,
										...val
									}));
							} catch (_) {}
						}
					}
				}
				return results;
			}

			function scanShadowDOM(element = document.body, depth = 0) {
				if (depth > 5) return [];
				const results = [];

				if (element.shadowRoot) {
					scanText(element.shadowRoot.innerHTML, `Shadow DOM (depth ${depth})`, depth)
						.forEach((val, key) => results.push({
							key,
							...val
						}));

					element.shadowRoot.querySelectorAll("*").forEach(child => {
						results.push(...scanShadowDOM(child, depth + 1));
					});
				}

				element.querySelectorAll("*").forEach(child => {
					if (child.shadowRoot) {
						results.push(...scanShadowDOM(child, depth + 1));
					}
				});

				return results;
			}

			async function scanExternalResources() {
				const results = [];
				const resources = [];

				document.querySelectorAll("script[src]").forEach(s => {
					if (!scannedUrls.has(s.src)) {
						scannedUrls.add(s.src);
						resources.push({
							url: s.src,
							type: "JS"
						});
					}
				});

				document.querySelectorAll("link[rel='stylesheet']").forEach(s => {
					if (s.href && !scannedUrls.has(s.href)) {
						scannedUrls.add(s.href);
						resources.push({
							url: s.href,
							type: "CSS"
						});
					}
				});

				for (const res of resources) {
					try {
						const controller = new AbortController();
						const timeout = setTimeout(() => controller.abort(), 5000);

						const response = await fetch(res.url, {
							signal: controller.signal
						});
						clearTimeout(timeout);

						const text = await response.text();
						scanText(text, `${res.type}: ${res.url.split('/').pop()}`)
							.forEach((val, key) => {
								if (!results.find(r => r.key === key)) {
									results.push({
										key,
										...val
									});
								}
							});
					} catch (e) {
						// Silent fail
					}
				}

				return results;
			}

			function scanRuntimeObjects() {
				const results = [];

				const globalsToCheck = [
					'grecaptcha', 'hcaptcha', 'turnstile',
					'___grecaptcha_cfg', '___hcaptcha_cfg',
					'window.__recaptcha_api_rendered_widgets',
					'window.hcaptchaConfig', 'window.turnstileConfig'
				];

				globalsToCheck.forEach(name => {
					try {
						const parts = name.split('.');
						let obj = window;
						for (const part of parts) {
							if (part === 'window') continue;
							obj = obj?.[part];
						}

						if (obj) {
							const str = JSON.stringify(obj);
							scanText(str, `Runtime: ${name}`)
								.forEach((val, key) => results.push({
									key,
									...val
								}));
						}
					} catch (_) {}
				});

				[localStorage, sessionStorage].forEach((store, idx) => {
					const name = idx === 0 ? "localStorage" : "sessionStorage";
					for (let i = 0; i < store.length; i++) {
						const key = store.key(i);
						const val = store.getItem(key);
						if (val) {
							scanText(val, `${name}[${key}]`)
								.forEach((v, k) => results.push({
									key: k,
									...v
								}));
						}
					}
				});

				return results;
			}

			function scanWebSockets() {
				const results = [];
				return results;
			}

			results.push(...scanDocument(document, "Main Document"));
			results.push(...await scanIframes());
			results.push(...scanShadowDOM());
			results.push(...await scanExternalResources());
			results.push(...scanRuntimeObjects());

			const uniqueResults = [];
			const seenKeys = new Set();
			results.forEach(r => {
				if (!seenKeys.has(r.key)) {
					seenKeys.add(r.key);
					uniqueResults.push(r);
				}
			});

			if (!uniqueResults.length) {
				return "=== DEEP SCAN RESULTS ===\n\nNo sitekeys found.\n\nScanned:\n- Main document HTML & inline scripts\n- All iframes (including cross-origin)\n- Shadow DOM trees\n- External JS/CSS files\n- Runtime JavaScript objects\n- Web Storage (localStorage/sessionStorage)";
			}

			const grouped = {};
			uniqueResults.forEach(r => {
				if (!grouped[r.type]) grouped[r.type] = [];
				grouped[r.type].push(r);
			});

			let out = `=== DEEP SCAN RESULTS (${uniqueResults.length} found) ===\n\n`;
			out += "Scan coverage:\n";
			out += "  ✓ Main document & inline scripts\n";
			out += "  ✓ Iframes (recursive, depth 3)\n";
			out += "  ✓ Shadow DOM trees\n";
			out += "  ✓ External JS/CSS resources\n";
			out += "  ✓ Runtime JS objects\n";
			out += "  ✓ Web Storage\n\n";

			for (const [type, items] of Object.entries(grouped)) {
				out += `── ${type} (${items.length}) ──\n`;
				items.forEach(item => {
					out += `  Key    : ${item.key}\n`;
					out += `  Source : ${item.source}\n`;
					if (item.depth > 0) out += `  Depth  : ${item.depth}\n`;
					out += `\n`;
				});
			}
			return out.trim();
		},
	});

	registerPlugin({
		id: "cf-intercept",
		label: "Get Sitekey V2",
		color: "#e65100",

		captured: [],
		hooked: false,

		autoDownload(data) {
			try {
				const json = JSON.stringify(data, null, 2);
				const blob = new Blob([json], {
					type: "application/json"
				});
				const url = URL.createObjectURL(blob);
				const a = document.createElement("a");
				a.href = url;
				a.download = "sitekey-" + location.hostname + "-" + Date.now() + ".json";
				document.body.appendChild(a);
				a.click();
				setTimeout(() => {
					URL.revokeObjectURL(url);
					a.remove();
				}, 1000);
			} catch (_) {}
		},

		installHook() {
			if (this.hooked) return;
			this.hooked = true;

			const self = this;

			const scanExisting = () => {
				document.querySelectorAll('.cf-turnstile, [data-sitekey], iframe[src*="turnstile"]').forEach(el => {
					const sitekey = el.getAttribute('data-sitekey') ||
						el.dataset.sitekey ||
						(el.src && el.src.match(/sitekey=([^&]+)/)?.[1]);

					if (sitekey && !self.captured.find(c => c.sitekey === sitekey)) {
						const entry = {
							type: 'turnstile-dom',
							sitekey: sitekey,
							action: el.getAttribute('data-action') || el.dataset.action || '',
							time: Date.now(),
							source: 'dom-scan'
						};
						self.captured.push(entry);
						self.autoDownload({
							host: location.hostname,
							url: location.href,
							capturedAt: new Date().toISOString(),
							entries: self.captured
						});
					}
				});
			};

			const hook = () => {
				if (window.turnstile && !window.turnstile.__wpHooked) {
					const origRender = window.turnstile.render.bind(window.turnstile);

					window.turnstile.render = function(container, params) {
						if (params?.sitekey) {
							const entry = {
								type: 'turnstile-hook',
								sitekey: params.sitekey,
								action: params.action || '',
								callback: typeof params.callback === 'function' ? 'function' : 'none',
								cData: params.cData || null,
								execution: params.execution || null,
								theme: params.theme || 'auto',
								time: Date.now()
							};
							self.captured.push(entry);
							self.autoDownload({
								host: location.hostname,
								url: location.href,
								capturedAt: new Date().toISOString(),
								entries: self.captured
							});
						}
						return origRender(container, params);
					};

					const origReady = window.turnstile.ready?.bind(window.turnstile);
					if (origReady) {
						window.turnstile.ready = function(callback) {
							console.log('[CF Intercept] turnstile.ready() called');
							return origReady(callback);
						};
					}

					window.turnstile.__wpHooked = true;
					console.log('[CF Intercept] Hook installed');
				}
			};

			scanExisting();
			hook();

			const poll = setInterval(() => {
				scanExisting();
				hook();
			}, 100);

			setTimeout(() => clearInterval(poll), 30000);

			if (window.MutationObserver) {
				const observer = new MutationObserver((mutations) => {
					let shouldScan = false;
					mutations.forEach(m => {
						if (m.addedNodes.length) shouldScan = true;
					});
					if (shouldScan) scanExisting();
				});
				observer.observe(document.body, {
					childList: true,
					subtree: true
				});
			}
		},

		fetchData() {
			this.installHook();

			if (this.captured.length === 0) {
				return "⏳ Menunggu challenge...\n\nga muncul atau ga kedownload sitekey nya? refresh lalu cepet buka panel dan pencet button cf intercept\n\nIt didn’t appear or the sitekey didn’t get downloaded? Refresh the page, then quickly open the panel and press the CF Intercept button.";
			}

			let out = `=== CAPTURED (${this.captured.length}) ===\n\n`;

			this.captured.forEach((c, i) => {
				out += `[${i+1}] ${c.type}\n`;
				out += `  Sitekey: ${c.sitekey}\n`;
				out += `  Action: ${c.action || '(none)'}\n`;
				out += `  Source: ${c.source || 'hook'}\n`;
				if (c.execution) out += `  Execution: ${c.execution}\n`;
				out += `  Time: ${new Date(c.time).toLocaleTimeString()}\n`;
				out += `\n`;
			});

			return out;
		},

		async execute() {
			if (this.captured.length === 0) {
				return "❌ Belum ada sitekey!";
			}

			const last = this.captured[this.captured.length - 1];

			if (last.type.includes('turnstile') && window.turnstile) {
				return new Promise((resolve) => {
					const overlay = document.createElement('div');
					overlay.style.cssText = `
                    position: fixed;
                    top: 0; left: 0; right: 0; bottom: 0;
                    background: rgba(0,0,0,0.5);
                    z-index: 999998;
                `;

					const div = document.createElement('div');
					div.style.cssText = `
                    position: fixed;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    z-index: 999999;
                    background: #fff;
                    padding: 30px;
                    border-radius: 12px;
                    box-shadow: 0 10px 40px rgba(0,0,0,0.4);
                    min-width: 300px;
                    text-align: center;
                `;

					const title = document.createElement('h3');
					title.textContent = 'Solving Turnstile...';
					title.style.margin = '0 0 15px 0';

					const closeBtn = document.createElement('button');
					closeBtn.textContent = '✕ Cancel';
					closeBtn.style.cssText = `
                    position: absolute;
                    top: 10px;
                    right: 10px;
                    border: none;
                    background: #ff4444;
                    color: white;
                    cursor: pointer;
                    padding: 5px 12px;
                    border-radius: 6px;
                    font-weight: bold;
                `;

					const status = document.createElement('div');
					status.style.cssText = 'margin: 15px 0; font-family: monospace; font-size: 12px; color: #666;';
					status.textContent = 'Rendering CAPTCHA...';

					const container = document.createElement('div');
					container.style.cssText = 'margin: 20px 0; min-height: 65px;';

					div.append(closeBtn, title, container, status);
					document.body.append(overlay, div);

					let resolved = false;
					const cleanup = (result) => {
						if (!resolved) {
							resolved = true;
							overlay.remove();
							div.remove();
							resolve(result);
						}
					};

					closeBtn.onclick = () => cleanup("❌ Dibatalkan user");

					const timeout = setTimeout(() => {
						cleanup("⏰ Timeout: 2 menit tanpa respons");
					}, 120000);

					try {
						window.turnstile.render(container, {
							sitekey: last.sitekey,
							action: last.action || undefined,
							cData: last.cData || undefined,
							execution: last.execution || undefined,
							theme: 'light',
							callback: (token) => {
								clearTimeout(timeout);
								status.innerHTML = '<span style="color:green">✓ Success!</span>';
								status.innerHTML += `<br><small>Token: ${token.substring(0, 20)}...</small>`;
								self.autoDownload({
									host: location.hostname,
									url: location.href,
									solvedAt: new Date().toISOString(),
									sitekey: last.sitekey,
									token
								});
								setTimeout(() => cleanup(`✅ TOKEN:\n${token}`), 1000);
							},
							'error-callback': (err) => {
								clearTimeout(timeout);
								status.innerHTML = `<span style="color:red">✗ Error: ${err}</span>`;
								setTimeout(() => cleanup(`❌ ERROR: ${err}`), 2000);
							},
							'expired-callback': () => {
								status.innerHTML = '<span style="color:orange">⚠ Token expired</span>';
							}
						});
					} catch (err) {
						clearTimeout(timeout);
						cleanup(`💥 EXCEPTION: ${err.message}`);
					}
				});
			}

			return "❌ Library turnstile tidak tersedia";
		},

		clear() {
			this.captured = [];
			return "✅ Cleared";
		}
	});

	registerPlugin({
		id: "network",
		label: "Network Monitor",
		color: "#00695c",

		_searchQuery: "",
		_caseSensitive: false,
		_useRegex: false,
		_allMatches: [],
		_currentMatchIdx: 0,

		_buildSearchPattern(query) {
			const flags = this._caseSensitive ? "g" : "gi";
			if (this._useRegex) return new RegExp(query, flags);
			const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
			return new RegExp(escaped, flags);
		},

		fetchData() {
			if (!networkLog.length) {
				return "No network requests captured yet.\n\nNote: Interceptor must be loaded before requests are made.\n\nTry refreshing the page with this panel open, or wait for new requests.";
			}

			if (this._allMatches.length > 0) {
				return this._renderCurrentMatch();
			}

			let out = `=== NETWORK LOG (${networkLog.length} requests) ===\n\n`;
			out += "💡 Click 'Search' to find requests · 'Download' to export\n\n";

			networkLog.forEach((req, idx) => {
				out += this._formatRequest(req, idx);
				out += "\n";
			});

			out += "─".repeat(60);
			return out.trim();
		},

		_formatRequest(req, idx) {
			const time = new Date(req.timestamp || Date.now()).toLocaleTimeString();
			const status = req.responseStatus ? ` [${req.responseStatus}]` : " [pending]";
			const duration = req.responseTimestamp && req.timestamp ?
				` ${req.responseTimestamp - req.timestamp}ms` :
				"";

			let out = `${"─".repeat(60)}\n`;
			out += `[${idx + 1}] ${req.type.toUpperCase()} ${req.method}${status}${duration} · ${time}\n`;
			out += `URL    : ${req.url}\n`;

			const params = req.params || {};
			if (Object.keys(params).length) {
				out += `Params (${Object.keys(params).length}):\n`;
				Object.entries(params).forEach(([k, v]) => {
					out += `  ${k}: ${String(v).slice(0, 80)}\n`;
				});
			}

			const reqHeaders = req.headers || {};
			if (Object.keys(reqHeaders).length) {
				out += `Request Headers (${Object.keys(reqHeaders).length}):\n`;
				Object.entries(reqHeaders).forEach(([k, v]) => {
					out += `  ${k}: ${String(v).slice(0, 80)}\n`;
				});
			}

			const resHeaders = req.responseHeaders || {};
			if (Object.keys(resHeaders).length) {
				out += `Response Headers (${Object.keys(resHeaders).length}):\n`;
				Object.entries(resHeaders).forEach(([k, v]) => {
					out += `  ${k}: ${String(v).slice(0, 80)}\n`;
				});
			}

			if (req.body != null) {
				const bodyStr = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
				if (bodyStr && bodyStr !== "null") {
					const preview = bodyStr.length > 200 ? `${bodyStr.slice(0, 200)}...` : bodyStr;
					out += `Request Body: ${preview}\n`;
				}
			}

			if (req.responseBody != null) {
				const respStr = typeof req.responseBody === "string" ? req.responseBody : JSON.stringify(req.responseBody);
				if (respStr && respStr !== "null") {
					const preview = respStr.length > 200 ? `${respStr.slice(0, 200)}...` : respStr;
					out += `Response Body: ${preview}\n`;
				}
			}

			return out;
		},

		_renderCurrentMatch() {
			if (!this._allMatches.length) return null;

			const match = this._allMatches[this._currentMatchIdx];
			const req = networkLog[match.reqIdx];

			const time = new Date(req.timestamp || Date.now()).toLocaleTimeString();
			const status = req.responseStatus ? ` [${req.responseStatus}]` : " [pending]";
			const duration = req.responseTimestamp && req.timestamp ?
				` ${req.responseTimestamp - req.timestamp}ms` :
				""
                
			const fileDiv = document.createElement("div");
			Object.assign(fileDiv.style, {
				marginBottom: "12px",
				border: "1px solid #2a2a2a",
				borderRadius: "6px",
				overflow: "hidden",
				background: "#161616"
			});
            
			const hdr = document.createElement("div");
			Object.assign(hdr.style, {
				background: "#212121",
				padding: "6px 10px",
				display: "flex",
				flexDirection: "column",
				gap: "4px",
				borderBottom: "1px solid #333",
			});

			const hdrTop = document.createElement("div");
			Object.assign(hdrTop.style, {
				display: "flex",
				justifyContent: "space-between",
				alignItems: "center"
			});
            
			const typeBadge = document.createElement("span");
			typeBadge.textContent = req.type.toUpperCase();
			Object.assign(typeBadge.style, {
				fontSize: "9px",
				fontWeight: "bold",
				padding: "2px 7px",
				borderRadius: "3px",
				letterSpacing: "0.8px",
				textTransform: "uppercase",
				background: req.type === "fetch" ? "#00695c" : "#bf360c",
				color: "#fff",
			});
            
			const matchCounter = document.createElement("span");
			matchCounter.textContent = `${this._currentMatchIdx + 1} / ${this._allMatches.length}`;
			Object.assign(matchCounter.style, {
				fontSize: "10px",
				color: "#f9a825",
				fontWeight: "bold"
			});

			hdrTop.append(typeBadge, matchCounter);

			const urlEl = document.createElement("div");
			urlEl.textContent = req.url;
			Object.assign(urlEl.style, {
				fontSize: "10px",
				color: "#64b5f6",
				wordBreak: "break-all",
				fontFamily: "monospace",
				lineHeight: "1.4",
			});
			const metaEl = document.createElement("div");
			metaEl.textContent = `${req.method}${status}${duration} · ${time} · Field: ${match.field} · Line: ${match.lineNumber}`;
			Object.assign(metaEl.style, {
				fontSize: "9px",
				color: "#888",
				marginTop: "2px"
			});

			hdr.append(hdrTop, urlEl, metaEl);

			const contentDiv = document.createElement("div");
			Object.assign(contentDiv.style, {
				display: "flex",
				alignItems: "flex-start",
				padding: "4px 0",
				borderTop: "1px solid #1a1a1a",
				fontFamily: "monospace",
				fontSize: "11px",
				color: "#ccc",
				cursor: "pointer",
				whiteSpace: "pre-wrap",
				wordBreak: "break-all",
				lineHeight: "1.6",
			});

			const lineNum = document.createElement("span");
			lineNum.textContent = match.lineNumber; 
			Object.assign(lineNum.style, {
				color: "#555",
				minWidth: "36px",
				textAlign: "right",
				paddingRight: "10px",
				userSelect: "none",
				flexShrink: "0",
				borderRight: "1px solid #2a2a2a",
				marginRight: "10px",
				paddingTop: "0",
			});

			const codeEl = document.createElement("span");

			let safeText = match.text
				.replace(/&/g, "&amp;")
				.replace(/</g, "&lt;")
				.replace(/>/g, "&gt;");

			const escapedQuery = this._useRegex ?
				this._searchQuery :
				this._searchQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

			try {
				const pattern = new RegExp(
					"(" + escapedQuery + ")",
					this._caseSensitive ? "g" : "gi"
				);
				safeText = safeText.replace(pattern,
					'<mark style="background:#f9a825;color:#000;padding:0 2px;border-radius:2px;font-weight:bold;outline:1.5px solid #f57f17;">$1</mark>'
				);
			} catch (_) {}

			codeEl.innerHTML = safeText;
			Object.assign(codeEl.style, {
				flex: "1",
				paddingRight: "8px"
			});

			contentDiv.append(lineNum, codeEl);

			contentDiv.onmouseover = () => contentDiv.style.background = "#1c2333";
			contentDiv.onmouseout = () => contentDiv.style.background = "transparent";
			contentDiv.onclick = () => {
				navigator.clipboard.writeText(match.fullText || match.text);
				contentDiv.style.background = "#1b3a1b";
				setTimeout(() => contentDiv.style.background = "transparent", 700);
			};

			fileDiv.append(hdr, contentDiv);

			return fileDiv;
		},

		renderCurrentMatchToContainer(container) {
			container.innerHTML = "";
			if (!this._allMatches.length) {
				container.innerHTML = '<div style="color:#888;padding:20px;text-align:center;">No matches found</div>';
				return;
			}
			const el = this._renderCurrentMatch();
			if (el) container.appendChild(el);
		},

		search(query, caseSensitive = false, useRegex = false) {
			if (!query.trim()) {
				this.clearSearch();
				return {
					count: 0,
					total: networkLog.length
				};
			}

			this._searchQuery = query;
			this._caseSensitive = caseSensitive;
			this._useRegex = useRegex;

			let pattern;
			try {
				pattern = this._buildSearchPattern(query);
			} catch (e) {
				return {
					error: `Invalid regex: ${e.message}`,
					count: 0,
					total: networkLog.length
				};
			}

			this._allMatches = [];

			networkLog.forEach((req, reqIdx) => {
				const fields = [{
						name: 'url',
						value: req.url
					},
					{
						name: 'method',
						value: req.method
					},
					{
						name: 'type',
						value: req.type
					},
					{
						name: 'req-headers',
						value: JSON.stringify(req.headers || {}, null, 2)
					},
					{
						name: 'res-headers',
						value: JSON.stringify(req.responseHeaders || {}, null, 2)
					},
					{
						name: 'params',
						value: JSON.stringify(req.params || {}, null, 2)
					},
					{
						name: 'req-body',
						value: typeof req.body === 'string' ? req.body : JSON.stringify(req.body || '', null, 2)
					},
					{
						name: 'res-body',
						value: typeof req.responseBody === 'string' ? req.responseBody : JSON.stringify(req.responseBody || '', null, 2)
					},
				];

				fields.forEach(field => {
					const lines = field.value.split('\n');

					lines.forEach((line, lineIdx) => {
						pattern.lastIndex = 0;
						const matchResult = pattern.exec(line);
						if (matchResult) {
							const contextLen = 100;
							const matchPos = matchResult.index;
							const start = Math.max(0, matchPos - contextLen);
							const end = Math.min(line.length, matchPos + matchResult[0].length + contextLen);
							const snippet = (start > 0 ? "…" : "") +
								line.substring(start, end) +
								(end < line.length ? "…" : "");

							this._allMatches.push({
								reqIdx: reqIdx,
								field: field.name,
								text: snippet,
								fullText: field.value,
								lineNumber: lineIdx + 1,
								matchPos: matchPos - start + (start > 0 ? 1 : 0),
								matchLength: matchResult[0].length
							});
						}
					});
				});
			});

			this._currentMatchIdx = 0;

			const uniqueRequests = [...new Set(this._allMatches.map(m => m.reqIdx))].length;

			return {
				count: this._allMatches.length,
				total: networkLog.length,
				uniqueRequests: uniqueRequests
			};
		},

		clearSearch() {
			this._searchQuery = "";
			this._caseSensitive = false;
			this._useRegex = false;
			this._allMatches = [];
			this._currentMatchIdx = 0;
		},

		navigatePrev() {
			if (!this._allMatches.length) return null;
			if (this._currentMatchIdx > 0) this._currentMatchIdx--;
			return this._renderCurrentMatch();
		},

		navigateNext() {
			if (!this._allMatches.length) return null;
			if (this._currentMatchIdx < this._allMatches.length - 1) this._currentMatchIdx++;
			return this._renderCurrentMatch();
		},

		getNavCounter() {
			if (!this._allMatches.length) return "0 / 0";
			return `${this._currentMatchIdx + 1} / ${this._allMatches.length}`;
		},

		async downloadAll() {

			if (!networkLog.length) {
				alert("No requests to download.");
				return;
			}

			const plugin = registry.find(p => p.id === "network");

			const {
				indices
			} = plugin?._getActiveLog?.() ?? {
				indices: networkLog.map((_, i) => i)
			};

			const total = indices.length;

			if (!confirm(`Export ${total} request${total === 1 ? "" : "s"}?`)) return;

			const exportData = {
				exportedAt: new Date().toISOString(),
				panelVersion: typeof VERSION !== "undefined" ? VERSION : "unknown",
				host: location.hostname,
				totalCaptured: networkLog.length,
				exported: total,

				requests: indices.map(idx => {

					const req = networkLog[idx];

					return {
						index: idx + 1,
						method: req.method,
						url: req.url,
						type: req.type,

						time: new Date(req.timestamp).toLocaleString(),
						timestamp: req.timestamp,

						params: req.params || {},

						headers: {
							request: req.headers || {},
							response: req.responseHeaders || {}
						},

						body: {
							request: req.body ?? null,
							response: req.responseBody ?? null
						},

						response: {
							status: req.responseStatus ?? null,
							statusText: req.responseStatusText ?? null,
							contentType: req.responseContentType ?? null
						},

						timing: {
							startTime: req.timestamp ?? null,
							endTime: req.responseTimestamp ?? null,
							duration: req.responseTimestamp && req.timestamp ?
								req.responseTimestamp - req.timestamp :
								null
						}
					};

				})
			};

			const json = JSON.stringify(exportData, null, 2);

			try {

				const blob = new Blob([json], {
					type: "application/json"
				});

				const url = URL.createObjectURL(blob);

				const win = window.open(url, "_blank");

				if (!win) {
					alert("Popup blocked by browser");
					return;
				}

				setTimeout(() => {
					URL.revokeObjectURL(url);
				}, 10000);

				const msg = `✓ Opened JSON export (${total} requests)`;

				if (currentPlugin?.id === "network") {
					textarea.value += `\n\n${msg}`;
				}

				return msg;

			} catch (e) {

				alert("Export failed: " + e.message);
				return "Export failed";

			}
		},
	});

	registerPlugin({
		id: "csp_analyzer",
		label: "CSP Analyzer",
		color: "#c0392b",

		fetchData() {

			if (!window.networkLog || !networkLog.length)
				return "No network data.";

			let csp = null;
			let headersFound = null;

			for (const req of networkLog) {

				const headers = req.responseHeaders || req.headers || {};

				if (typeof headers === "string") {
					const m = headers.match(/content-security-policy:\s*([^\n]+)/i);
					if (m) {
						csp = m[1].trim();
						headersFound = headers;
						break;
					}
				}

				if (headers["content-security-policy"]) {
					csp = headers["content-security-policy"];
					headersFound = headers;
					break;
				}

				if (headers["Content-Security-Policy"]) {
					csp = headers["Content-Security-Policy"];
					headersFound = headers;
					break;
				}
			}

			if (!csp)
				return "No CSP header detected.";

			const directives = {};
			const parts = csp.split(";").map(x => x.trim()).filter(Boolean);

			parts.forEach(p => {
				const [name, ...rest] = p.split(/\s+/);
				directives[name] = rest;
			});

			let out = "=== CSP DIRECTIVES ===\n\n";

			Object.keys(directives).forEach(k => {
				out += k + "\n";
				directives[k].forEach(v => {
					out += "  - " + v + "\n";
				});
				out += "\n";
			});

			out += "=== SECURITY ANALYSIS ===\n";

			if (csp.includes("'unsafe-inline'"))
				out += "⚠ unsafe-inline detected\n";

			if (csp.includes("'unsafe-eval'"))
				out += "⚠ unsafe-eval detected\n";

			if (csp.includes("*"))
				out += "⚠ wildcard source detected\n";

			if (csp.includes("data:"))
				out += "⚠ data: scheme allowed\n";

			if (csp.includes("blob:"))
				out += "⚠ blob: scheme allowed\n";

			if (csp.includes("'strict-dynamic'"))
				out += "✔ strict-dynamic enabled\n";

			if (csp.includes("'nonce-"))
				out += "✔ nonce based CSP\n";

			if (!directives["object-src"])
				out += "⚠ object-src not defined\n";

			if (!directives["frame-ancestors"])
				out += "⚠ frame-ancestors missing\n";

			out += "\n=== THIRD PARTY DOMAINS ===\n";

			const domains = new Set();

			Object.values(directives).forEach(arr => {
				arr.forEach(v => {
					if (v.startsWith("http"))
						domains.add(v);
				});
			});

			if (domains.size === 0) {
				out += "None\n";
			} else {
				domains.forEach(d => {
					out += d + "\n";
				});
			}

			out += "\n=== SECURITY HEADERS ===\n";

			if (headersFound) {

				const check = [
					"strict-transport-security",
					"x-frame-options",
					"x-content-type-options",
					"referrer-policy",
					"permissions-policy"
				];

				check.forEach(h => {
					const v = headersFound[h] || headersFound[h.toLowerCase()];
					if (v) out += `${h}: ${v}\n`;
				});

				if (headersFound["server"])
					out += `server: ${headersFound["server"]}\n`;

				if (headersFound["x-powered-by"])
					out += `powered-by: ${headersFound["x-powered-by"]}\n`;
			}

			return out;
		}
	});

	registerPlugin({
		id: "get_html",
		label: "Get HTML",
		color: "#8e44ad",

		async fetchData() {

			function waitRender() {
				return new Promise(resolve => {
					let last = Date.now();

					const obs = new MutationObserver(() => {
						last = Date.now();
					});

					obs.observe(document.documentElement, {
						childList: true,
						subtree: true,
						attributes: true
					});

					const check = setInterval(() => {
						if (Date.now() - last > 2000) {
							clearInterval(check);
							obs.disconnect();
							resolve();
						}
					}, 500);
				});
			}

			await waitRender();

			const html = "<!DOCTYPE html>\n" + document.documentElement.outerHTML;

			const blob = new Blob([html], {
				type: "text/html"
			});
			const url = URL.createObjectURL(blob);

			const a = document.createElement("a");
			a.href = url;
			a.download = "rendered_page.html";
			document.body.appendChild(a);
			a.click();

			setTimeout(() => {
				URL.revokeObjectURL(url);
				a.remove();
			}, 1000);

			setTimeout(() => {
				if (window.showMenu) window.showMenu();
			}, 1200);

			return "Downloading rendered HTML...";
		}
	});

	registerPlugin({
		id: "script_dependency_viewer",
		label: "Script Dependency Viewer",
		color: "#3498db",

		fetchData() {

			const scripts = Array.from(document.querySelectorAll("script"));
			const links = Array.from(document.querySelectorAll("link[rel='stylesheet']"));

			let out = "=== SCRIPT DEPENDENCIES ===\n";

			if (!scripts.length) {
				out += "No scripts found\n";
			} else {
				scripts.forEach((s, i) => {
					const src = s.src || "[inline script]";
					out += `${i+1}. ${src}\n`;
				});
			}

			out += "\n=== STYLESHEETS ===\n";

			if (!links.length) {
				out += "No stylesheets found\n";
			} else {
				links.forEach((l, i) => {
					out += `${i+1}. ${l.href}\n`;
				});
			}

			out += "\n=== RESOURCE SUMMARY ===\n";
			out += `scripts: ${scripts.length}\n`;
			out += `stylesheets: ${links.length}\n`;

			try {

				const resources = performance.getEntriesByType("resource");

				const js = resources.filter(r => r.initiatorType === "script").length;
				const css = resources.filter(r => r.initiatorType === "link").length;

				out += `network js resources: ${js}\n`;
				out += `network css resources: ${css}\n`;

			} catch (e) {}

			return out;
		}
	});

	registerPlugin({
		id: "performance_snapshot",
		label: "Performance Snapshot",
		color: "#27ae60",

		fetchData() {

			if (!window.performance)
				return "Performance API not supported.";

			const nav = performance.getEntriesByType("navigation")[0];
			const resources = performance.getEntriesByType("resource");

			let out = "=== PERFORMANCE SNAPSHOT ===\n";

			if (nav) {
				out += `\nDOMContentLoaded: ${Math.round(nav.domContentLoadedEventEnd)} ms\n`;
				out += `Load Event: ${Math.round(nav.loadEventEnd)} ms\n`;
				out += `First Byte: ${Math.round(nav.responseStart)} ms\n`;
			}

			const paint = performance.getEntriesByType("paint");

			paint.forEach(p => {
				out += `${p.name}: ${Math.round(p.startTime)} ms\n`;
			});

			out += `\nTotal Requests: ${resources.length}\n`;

			let js = 0,
				css = 0,
				img = 0,
				fetch = 0;

			resources.forEach(r => {
				if (r.initiatorType === "script") js++;
				if (r.initiatorType === "link") css++;
				if (r.initiatorType === "img") img++;
				if (r.initiatorType === "fetch" || r.initiatorType === "xmlhttprequest") fetch++;
			});

			out += `JS files: ${js}\n`;
			out += `CSS files: ${css}\n`;
			out += `Images: ${img}\n`;
			out += `API calls: ${fetch}\n`;

			let size = 0;

			resources.forEach(r => {
				if (r.transferSize) size += r.transferSize;
			});

			out += `\nTransfer Size: ${(size/1024).toFixed(1)} KB\n`;

			return out;
		}
	});

	registerPlugin({
		id: "websocket_sniffer",
		label: "WebSocket Sniffer",
		color: "#2bb3ff",

		init() {

			if (window.__wsSnifferInstalled) return;
			window.__wsSnifferInstalled = true;

			window.wsLog = [];

			const OriginalWS = window.WebSocket;

			window.WebSocket = function(url, protocols) {

				const ws = protocols ? new OriginalWS(url, protocols) : new OriginalWS(url);

				const entry = {
					url,
					messages: []
				};

				window.wsLog.push(entry);

				const origSend = ws.send;

				ws.send = function(data) {

					entry.messages.push({
						type: "send",
						data: typeof data === "string" ? data : "[binary]"
					});

					return origSend.apply(this, arguments);
				};

				ws.addEventListener("message", (event) => {

					entry.messages.push({
						type: "receive",
						data: typeof event.data === "string" ? event.data : "[binary]"
					});

				});

				return ws;
			};

		},

		fetchData() {

			if (!window.wsLog || wsLog.length === 0)
				return "No WebSocket activity.";

			let out = "=== WEBSOCKET CONNECTIONS ===\n";

			wsLog.forEach((conn, i) => {

				out += `\n[${i+1}] ${conn.url}\n`;

				conn.messages.forEach(m => {
					out += `  ${m.type === "send" ? "→" : "←"} ${m.data}\n`;
				});

			});

			return out;
		}
	});

	registerPlugin({
		id: "api_mapper",
		label: "API Mapper+",
		color: "#8b3dff",

		fetchData() {
			const logs = typeof networkLog !== "undefined" && Array.isArray(networkLog) ?
				networkLog : [];

			if (!logs.length) return "No network data.";

			const domainMap = {};
			const pathTree = {};
			const queryList = [];
			const errorList = [];
			const methodCount = {};
			const typeCount = {};
			const slowList = [];
			const uniqueIPs = new Set();

			logs.forEach(req => {
				if (!req?.url) return;
				try {
					const url = new URL(req.url, location.origin);
					const domain = url.hostname;
					const method = (req.method || "GET").toUpperCase();
					const path = url.pathname;
					const query = url.search || "";
					const status = req.responseStatus ?? null;
					const type = (req.type || "fetch").toLowerCase();
					const duration = req.responseTimestamp && req.timestamp ?
						req.responseTimestamp - req.timestamp : null;
					const ct = (req.responseContentType || "").split(";")[0].trim() || "unknown";

					methodCount[method] = (methodCount[method] || 0) + 1;
					typeCount[type] = (typeCount[type] || 0) + 1;

					if (!domainMap[domain]) domainMap[domain] = {};
					const key = `${method} ${path}${query}`;
					if (!domainMap[domain][key]) {
						domainMap[domain][key] = {
							method,
							path,
							query,
							count: 0,
							statuses: [],
							durations: [],
							contentTypes: new Set(),
						};
					}
					const entry = domainMap[domain][key];
					entry.count++;
					if (status !== null) entry.statuses.push(status);
					if (duration !== null) entry.durations.push(duration);
					entry.contentTypes.add(ct);

					const parts = path.split("/").filter(Boolean);
					let node = pathTree;
					parts.forEach(p => {
						if (!node[p]) node[p] = {};
						node = node[p];
					});

					if (query) queryList.push({
						method,
						path,
						query,
						status,
						duration
					});

					if (status !== null && (status === 0 || status >= 400)) {
						errorList.push({
							method,
							path: path + query,
							domain,
							status,
							duration
						});
					}

					if (duration !== null && duration > 2000) {
						slowList.push({
							method,
							url: req.url,
							duration,
							status
						});
					}
				} catch (_) {}
			});

			const avg = arr => arr.length ?
				Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null;

			const statusLabel = s => {
				if (s === 0) return "ERR";
				if (s >= 500) return `${s} ✗`;
				if (s >= 400) return `${s} ✗`;
				if (s >= 300) return `${s} ↗`;
				if (s >= 200) return `${s} ✓`;
				return `${s}`;
			};

			function renderTree(node, prefix = "") {
				let out = "";
				const keys = Object.keys(node);
				keys.forEach((k, i) => {
					const last = i === keys.length - 1;
					out += `${prefix}${last ? "└" : "├"}─ ${k}\n`;
					out += renderTree(node[k], prefix + (last ? "   " : "│  "));
				});
				return out;
			}

			const totalReqs = logs.length;
			const uniqueDomains = Object.keys(domainMap).length;
			const uniqueEndpoints = Object.values(domainMap)
				.reduce((a, d) => a + Object.keys(d).length, 0);

			const allDurations = logs
				.filter(r => r.responseTimestamp && r.timestamp)
				.map(r => r.responseTimestamp - r.timestamp);
			const avgAll = avg(allDurations);
			const maxAll = allDurations.length ? Math.max(...allDurations) : null;

			let out = "=== API MAPPER+ ===\n\n";
			out += `Total Requests  : ${totalReqs}\n`;
			out += `Unique Domains  : ${uniqueDomains}\n`;
			out += `Unique Endpoints: ${uniqueEndpoints}\n`;
			out += `Errors (4xx/5xx): ${errorList.length}\n`;
			out += `Slow (>2s)      : ${slowList.length}\n`;
			out += `Methods         : ${Object.entries(methodCount).map(([k,v]) => `${k}×${v}`).join("  ")}\n`;
			out += `Types           : ${Object.entries(typeCount).map(([k,v]) => `${k}×${v}`).join("  ")}\n`;
			if (avgAll !== null) out += `Avg Duration    : ${avgAll}ms  (max: ${maxAll}ms)\n`;

			out += "\n\n=== DOMAIN GROUPING ===\n";
			Object.keys(domainMap).sort().forEach(domain => {
				const entries = Object.values(domainMap[domain]);
				entries.sort((a, b) => b.count - a.count);
				out += `\n▸ ${domain} (${entries.length} endpoint${entries.length > 1 ? "s" : ""})\n`;
				entries.forEach(e => {
					const statuses = [...new Set(e.statuses)].map(statusLabel).join(", ") || "pending";
					const avgMs = avg(e.durations);
					const ct = [...e.contentTypes].filter(c => c !== "unknown").join(", ") || "";
					out += `  ${e.method.padEnd(7)} ${e.path}${e.query}\n`;
					out += `    hits:${e.count}  status:[${statuses}]`;
					if (avgMs !== null) out += `  avg:${avgMs}ms`;
					if (ct) out += `  type:${ct}`;
					out += "\n";
				});
			});

			out += "\n=== ENDPOINT TREE ===\n/\n";
			out += renderTree(pathTree);

			out += "\n=== ENDPOINTS WITH QUERY PARAMS ===\n";
			if (queryList.length) {
				const seen = new Set();
				queryList.forEach(q => {
					const key = `${q.method} ${q.path}${q.query}`;
					if (seen.has(key)) return;
					seen.add(key);
					const s = q.status !== null ? `  [${statusLabel(q.status)}]` : "";
					const d = q.duration !== null ? `  ${q.duration}ms` : "";
					out += `  ${q.method.padEnd(7)} ${q.path}${q.query}${s}${d}\n`;
				});
			} else {
				out += "  None\n";
			}

			out += "\n=== FAILED REQUESTS (4xx / 5xx / ERR) ===\n";
			if (errorList.length) {
				errorList.forEach(e => {
					const d = e.duration !== null ? `  ${e.duration}ms` : "";
					out += `  [${statusLabel(e.status)}] ${e.method.padEnd(7)} ${e.domain}${e.path}${d}\n`;
				});
			} else {
				out += "  None ✓\n";
			}

			out += "\n=== SLOW REQUESTS (>2000ms) ===\n";
			if (slowList.length) {
				slowList
					.sort((a, b) => b.duration - a.duration)
					.forEach(r => {
						const s = r.status !== null ? `  [${statusLabel(r.status)}]` : "";
						out += `  ${r.duration}ms  ${r.method.padEnd(7)} ${r.url}${s}\n`;
					});
			} else {
				out += "  None ✓\n";
			}

			const jsPatterns = [
				/(?:\/(?:api|v\d+|rest|gql|graphql|rpc|service|endpoint|backend)(?:\/[a-zA-Z0-9_\-]+)+)/g,
				/["'`](\/[a-zA-Z0-9_\-]+(?:\/[a-zA-Z0-9_\-]+){2,})["'`]/g,
			];
			const found = new Set();
			document.querySelectorAll("script").forEach(s => {
				const text = s.textContent || "";
				jsPatterns.forEach(r => {
					r.lastIndex = 0;
					let m;
					while ((m = r.exec(text)) !== null) {
						const val = m[1] || m[0];
						if (val && val.length > 4) found.add(val);
					}
				});
			});
			out += "\n=== HIDDEN API (JS SCAN) ===\n";
			out += found.size ?
				Array.from(found).sort().map(x => `  ${x}`).join("\n") + "\n" :
				"  None\n";

			return out.trim();
		},
	});

	// =========================================================
	// TEMA & GAYA (DARK/LIGHT MODE & FONT DEFAULT)
	// =========================================================
	const styleEl = document.createElement("style");
	styleEl.textContent = `
		:root {
			--wp-bg: #ffffff;
			--wp-hdr: #f1f5f9;
			--wp-txt: #0f172a;
			--wp-border: #cbd5e1;
			--wp-content: #f8fafc;
			--wp-btn: #e2e8f0;
			--wp-btn-txt: #0f172a;
			--wp-code: #047857; /* Hijau gelap untuk teks output */
		}
		@media (prefers-color-scheme: dark) {
			:root {
				--wp-bg: #1e1e1e;
				--wp-hdr: #2a2a2a;
				--wp-txt: #ffffff;
				--wp-border: #555555;
				--wp-content: #111111;
				--wp-btn: #444444;
				--wp-btn-txt: #ffffff;
				--wp-code: #0f0; /* Hijau terang untuk teks output */
			}
		}
		#web-panel-dev, #web-panel-dev button, #web-panel-dev input {
			font-family: system-ui, -apple-system, sans-serif !important;
		}
		#web-panel-dev textarea, 
		#web-panel-dev .monospace-text,
		#network-search-results * {
			font-family: monospace !important;
		}
	`;
	document.head.appendChild(styleEl);

	function makeBtn(label, bg) {
		const b = document.createElement("button");
		b.textContent = label;
		Object.assign(b.style, {
			flex: "1",
			padding: "8px",
			border: "none",
			cursor: "pointer",
			background: bg || "var(--wp-btn)",
			color: bg ? "#fff" : "var(--wp-btn-txt)",
			borderRadius: "6px",
			fontSize: "12px",
			transition: "all 0.2s",
		});
		return b;
	}

	// =========================================================
	// RESPONSIVE SIZING (MOBILE VS DESKTOP)
	// =========================================================
	const isMobile = window.innerWidth <= 600;
	const pWidth = isMobile ? (window.innerWidth - 30) + "px" : "450px";
	const pHeight = isMobile ? "400px" : "400px";
	const pLeft = isMobile ? "15px" : "50px";
	const pTop = isMobile ? "50px" : "100px";

	const panel = document.createElement("div");
	panel.id = "web-panel-dev";
	Object.assign(panel.style, {
		position: "fixed",
		top: pTop,
		left: pLeft,
		width: pWidth,
		height: pHeight,
		background: "var(--wp-bg)",
		color: "var(--wp-txt)",
		border: "1px solid var(--wp-border)",
		borderRadius: "12px",
		zIndex: "999999999",
		boxShadow: "0 5px 20px rgba(0,0,0,0.5)",
		display: "flex",
		flexDirection: "column",
		transition: "left .25s ease, top .25s ease",
	});

	const header = document.createElement("div");
	header.textContent = `Web Panel by Hann Universe  v${VERSION}`;
	Object.assign(header.style, {
		padding: "10px",
		cursor: "move",
		background: "var(--wp-hdr)",
		fontWeight: "bold",
		touchAction: "none",
		display: "flex",
		justifyContent: "space-between",
		alignItems: "center",
		borderRadius: "12px 12px 0 0",
		userSelect: "none",
		color: "var(--wp-txt)"
	});

	const minimizeBtn = document.createElement("span");
	minimizeBtn.textContent = "−";
	Object.assign(minimizeBtn.style, {
		cursor: "pointer",
		fontSize: "18px",
		padding: "0 5px",
		flexShrink: "0"
	});
	header.appendChild(minimizeBtn);

	const content = document.createElement("div");
	Object.assign(content.style, {
		flex: "1",
		display: "flex",
		flexDirection: "column",
		overflow: "hidden"
	});

	const textarea = document.createElement("textarea");
	textarea.placeholder = "Welcome To Web Panel by Hann Universe\n\nSelect a data source below:";
	Object.assign(textarea.style, {
		flex: "1",
		background: "var(--wp-content)",
		color: "var(--wp-code)",
		border: "none",
		padding: "10px",
		resize: "none",
		fontSize: "12px",
		display: "none",
		outline: "none",
	});

	const searchContainer = document.createElement("div");
	Object.assign(searchContainer.style, {
		display: "none",
		flexDirection: "column",
		flex: "1",
		overflow: "hidden"
	});

	const searchInputRow = document.createElement("div");
	Object.assign(searchInputRow.style, {
		display: "flex",
		gap: "5px",
		padding: "8px",
		background: "var(--wp-hdr)",
		borderBottom: "1px solid var(--wp-border)",
	});

	const searchInput = document.createElement("input");
	searchInput.type = "text";
	searchInput.placeholder = "Search...";
	Object.assign(searchInput.style, {
		flex: "1",
		padding: "8px",
		background: "var(--wp-content)",
		color: "var(--wp-txt)",
		border: "1px solid var(--wp-border)",
		borderRadius: "4px",
		fontSize: "12px",
		outline: "none",
	});

	const searchExecBtn = makeBtn("Search", "#1565c0");
	searchExecBtn.style.flex = "0 0 60px";

	const caseSensitiveBtn = makeBtn("Aa", null);
	caseSensitiveBtn.style.flex = "0 0 35px";
	caseSensitiveBtn.title = "Case sensitive";
	let caseSensitive = false;

	const regexBtn = makeBtn(".*", null);
	regexBtn.style.flex = "0 0 35px";
	regexBtn.title = "Use regex";
	let useRegex = false;

	searchInputRow.append(searchInput, searchExecBtn, caseSensitiveBtn, regexBtn);

	const searchResults = document.createElement("div");
	Object.assign(searchResults.style, {
		flex: "1",
		overflow: "auto",
		background: "var(--wp-content)",
		padding: "5px",
		fontSize: "11px"
	});

	const searchStatus = document.createElement("div");
	Object.assign(searchStatus.style, {
		padding: "5px 10px",
		background: "var(--wp-bg)",
		borderTop: "1px solid var(--wp-border)",
		fontSize: "11px",
		color: "var(--wp-txt)",
	});
	searchStatus.textContent = "Ready to search";

	searchContainer.append(searchInputRow, searchResults, searchStatus);
	content.append(textarea, searchContainer);

	const mainBtnRow = document.createElement("div");
	Object.assign(mainBtnRow.style, {
		display: "flex",
		gap: "4px",
		padding: "4px",
		background: "var(--wp-bg)",
		flexWrap: "wrap",
		borderTop: "1px solid var(--wp-border)"
	});

	const actionBtnRow = document.createElement("div");
	Object.assign(actionBtnRow.style, {
		display: "none",
		gap: "4px",
		padding: "4px",
		background: "var(--wp-bg)",
		borderTop: "1px solid var(--wp-border)"
	});
    
	const searchBtnRow = document.createElement("div");
	Object.assign(searchBtnRow.style, {
		display: "none",
		gap: "4px",
		padding: "4px",
		background: "var(--wp-bg)",
		borderTop: "1px solid var(--wp-border)"
	});

	const btnSearchBack = makeBtn("Back", null);
	const btnClearSearch = makeBtn("Clear", null);
	const btnCopySearch = makeBtn("Copy Results", null);

	searchBtnRow.append(btnSearchBack, btnClearSearch, btnCopySearch);
    
	const networkSearchBtnRow = document.createElement("div");
	Object.assign(networkSearchBtnRow.style, {
		display: "none",
		gap: "4px",
		padding: "4px",
		background: "var(--wp-bg)",
		borderTop: "1px solid var(--wp-border)"
	});

	const btnNetworkBack = makeBtn("Back", null);
	const btnNetworkClear = makeBtn("Clear", null);
	const btnNetworkPrev = makeBtn("◀ Prev", "#37474f");
	const btnNetworkNext = makeBtn("Next ▶", "#37474f");
	const networkNavCounter = document.createElement("span");
	Object.assign(networkNavCounter.style, {
		color: "var(--wp-txt)",
		fontSize: "11px",
		fontFamily: "monospace",
		alignSelf: "center",
		minWidth: "60px",
		textAlign: "center",
		flexShrink: "0",
	});
	networkNavCounter.textContent = "0 / 0";

	networkSearchBtnRow.append(btnNetworkBack, btnNetworkClear, btnNetworkPrev, networkNavCounter, btnNetworkNext);

	const btnBack = makeBtn("Back", null);
	const btnRefresh = makeBtn("Refresh", null);
	const btnCopy = makeBtn("Copy", null);
	const btnDownloadAll = makeBtn("⬇️ Download", "#2e7d32");
	const btnNetworkSearch = makeBtn("🔍 Search", "#6a1b9a");

	actionBtnRow.append(btnBack, btnRefresh, btnCopy, btnDownloadAll, btnNetworkSearch);

	let currentPlugin = null;
	let isNetworkSearchMode = false;

	function renderPluginButtons() {
		while (mainBtnRow.firstChild) mainBtnRow.removeChild(mainBtnRow.firstChild);
		registry.forEach((plugin) => {
			const btn = makeBtn(plugin.label, plugin.color);
			btn.onclick = async () => {
				currentPlugin = plugin;
				isNetworkSearchMode = false;
				showActionButtons();
				textarea.value = "Loading...";
				try {
					const res = plugin.fetchData();
					textarea.value = (res instanceof Promise) ? await res : res;
				} catch (e) {
					textarea.value = "Error: " + e.message;
				}
			};
			mainBtnRow.appendChild(btn);
		});
		const btnSearch = makeBtn("🔍 Search", "#6a1b9a");
		btnSearch.onclick = showGlobalSearchMode;
		mainBtnRow.appendChild(btnSearch);
	}

	function showMainButtons() {
		mainBtnRow.style.display = "flex";
		actionBtnRow.style.display = "none";
		searchBtnRow.style.display = "none";
		networkSearchBtnRow.style.display = "none";
		textarea.style.display = "none";
		searchContainer.style.display = "none";
		searchResults.style.display = "none";
		textarea.value = "";
		currentPlugin = null;
		isNetworkSearchMode = false;
	}

	function showActionButtons() {
		mainBtnRow.style.display = "none";
		actionBtnRow.style.display = "flex";
		searchBtnRow.style.display = "none";
		networkSearchBtnRow.style.display = "none";
		textarea.style.display = "block";
		searchContainer.style.display = "none";
		searchResults.style.display = "none";
		btnNetworkSearch.style.display = currentPlugin?.id === "network" ? "" : "none";
		isNetworkSearchMode = false;
	}

	function showGlobalSearchMode() {
		mainBtnRow.style.display = "none";
		actionBtnRow.style.display = "none";
		searchBtnRow.style.display = "flex";
		networkSearchBtnRow.style.display = "none";
		textarea.style.display = "none";
		searchContainer.style.display = "flex";
		searchResults.style.display = "block";
        
		const networkResultsDiv = document.getElementById("network-search-results");
		if (networkResultsDiv) networkResultsDiv.style.display = "none";

		currentPlugin = null;
		searchStatus.textContent = "Ready to search";
		searchInput.focus();

		searchExecBtn.onclick = performGlobalSearch;
		btnSearchBack.onclick = () => {
			searchInput.value = "";
			searchResults.innerHTML = "";
			searchStatus.textContent = "Ready to search";
			showMainButtons();
		};
	}

	function showNetworkSearchMode() {
		mainBtnRow.style.display = "none";
		actionBtnRow.style.display = "none";
		searchBtnRow.style.display = "none";
		networkSearchBtnRow.style.display = "flex";
		searchContainer.style.display = "flex";
		textarea.style.display = "none";
		searchResults.style.display = "none";
        
		let networkResultsDiv = document.getElementById("network-search-results");
		if (!networkResultsDiv) {
			networkResultsDiv = document.createElement("div");
			networkResultsDiv.id = "network-search-results";
			Object.assign(networkResultsDiv.style, {
				flex: "1",
				overflow: "auto",
				background: "var(--wp-content)",
				padding: "5px",
				fontSize: "11px",
				display: "none"
			});
			content.appendChild(networkResultsDiv);
		}
		networkResultsDiv.style.display = "block";

		const networkPlugin = registry.find(p => p.id === "network");
		updateNetworkNav(networkPlugin);

		searchExecBtn.onclick = () => {
			const query = searchInput.value.trim();
			if (!networkPlugin || !query) return;

			const result = networkPlugin.search(query, caseSensitive, useRegex);

			if (result.error) {
				searchStatus.textContent = `Error: ${result.error}`;
				networkResultsDiv.innerHTML = `<div style="color:var(--wp-error);padding:20px;text-align:center;">${result.error}</div>`;
				networkNavCounter.textContent = "0 / 0";
				return;
			}

			if (result.count === 0) {
				searchStatus.textContent = `No matches in ${result.total} requests`;
				networkResultsDiv.innerHTML = '<div style="color:var(--wp-txt);padding:20px;text-align:center;">No matches found</div>';
				networkNavCounter.textContent = "0 / 0";
			} else {
				searchStatus.textContent = `Found ${result.count} matches in ${result.uniqueRequests} requests`;
				networkPlugin.renderCurrentMatchToContainer(networkResultsDiv);
				networkNavCounter.textContent = networkPlugin.getNavCounter();
			}

			updateNetworkNav(networkPlugin);
		};
        
		btnNetworkPrev.onclick = () => {
			if (!networkPlugin) return;
			const success = networkPlugin.navigatePrev();
			if (success !== null) {
				networkPlugin.renderCurrentMatchToContainer(networkResultsDiv);
				networkNavCounter.textContent = networkPlugin.getNavCounter();
				updateNetworkNav(networkPlugin);
			}
		};
        
		btnNetworkNext.onclick = () => {
			if (!networkPlugin) return;
			const success = networkPlugin.navigateNext();
			if (success !== null) {
				networkPlugin.renderCurrentMatchToContainer(networkResultsDiv);
				networkNavCounter.textContent = networkPlugin.getNavCounter();
				updateNetworkNav(networkPlugin);
			}
		};

		btnNetworkBack.onclick = () => {
			networkPlugin?.clearSearch();
			searchInput.value = "";
			networkResultsDiv.innerHTML = "";
			networkResultsDiv.style.display = "none";
			networkNavCounter.textContent = "0 / 0";
			searchStatus.textContent = "Ready to search";
			showActionButtons();
			if (currentPlugin) {
				textarea.value = currentPlugin.fetchData();
			}
		};

		btnNetworkClear.onclick = () => {
			networkPlugin?.clearSearch();
			searchInput.value = "";
			networkResultsDiv.innerHTML = "";
			networkNavCounter.textContent = "0 / 0";
			searchStatus.textContent = "Ready to search";
			updateNetworkNav(networkPlugin);
			searchInput.focus();
		};

		searchInput.focus();
	}

	function updateNetworkNav(plugin) {
		const hasMatches = plugin && plugin._allMatches && plugin._allMatches.length > 0;
		const current = hasMatches ? plugin._currentMatchIdx : -1;
		const total = hasMatches ? plugin._allMatches.length : 0;

		btnNetworkPrev.disabled = !hasMatches || current <= 0;
		btnNetworkNext.disabled = !hasMatches || current >= total - 1;

		btnNetworkPrev.style.opacity = btnNetworkPrev.disabled ? "0.35" : "1";
		btnNetworkNext.style.opacity = btnNetworkNext.disabled ? "0.35" : "1";
	}

	btnBack.onclick = showMainButtons;
	btnRefresh.onclick = async () => {
		if (currentPlugin) {
			textarea.value = "Loading...";
			try {
				const res = currentPlugin.fetchData();
				textarea.value = (res instanceof Promise) ? await res : res;
			} catch (e) {
				textarea.value = "Error: " + e.message;
			}
		}
		btnRefresh.textContent = "Refreshed ✓";
		setTimeout(() => (btnRefresh.textContent = "Refresh"), 1000);
	};

	btnCopy.onclick = async () => {
		await navigator.clipboard.writeText(textarea.value);
		btnCopy.textContent = "Copied ✓";
		setTimeout(() => (btnCopy.textContent = "Copy"), 1000);
	};

	btnDownloadAll.onclick = () => {
		const networkPlugin = registry.find(p => p.id === "network");
		if (networkPlugin && networkPlugin.downloadAll) {
			const result = networkPlugin.downloadAll();
			if (currentPlugin?.id === "network") {
				textarea.value += "\n\n" + result;
			}
			btnDownloadAll.textContent = "✓ Done";
			setTimeout(() => (btnDownloadAll.textContent = "⬇️ Download"), 2000);
		}
	};

	btnNetworkSearch.onclick = showNetworkSearchMode;

	btnClearSearch.onclick = () => {
		searchInput.value = "";
		searchResults.innerHTML = "";
		searchStatus.textContent = "Ready to search";
		searchInput.focus();
	};

	btnCopySearch.onclick = () => {
		const allText = Array.from(searchResults.querySelectorAll("div")).map((d) => d.textContent).join("\n");
		if (allText) {
			navigator.clipboard.writeText(allText);
			btnCopySearch.textContent = "Copied ✓";
			setTimeout(() => (btnCopySearch.textContent = "Copy Results"), 1000);
		}
	};

	caseSensitiveBtn.onclick = () => {
		caseSensitive = !caseSensitive;
		caseSensitiveBtn.style.background = caseSensitive ? "#1565c0" : "var(--wp-btn)";
		caseSensitiveBtn.style.color = caseSensitive ? "#fff" : "var(--wp-btn-txt)";
	};

	regexBtn.onclick = () => {
		useRegex = !useRegex;
		regexBtn.style.background = useRegex ? "#1565c0" : "var(--wp-btn)";
		regexBtn.style.color = useRegex ? "#fff" : "var(--wp-btn-txt)";
	};

	async function performGlobalSearch() {
		// ... (Kode Logika Global Search sama persis seperti sebelumnya)
		const query = searchInput.value.trim();
		if (!query) return;

		searchStatus.textContent = "Searching...";
		searchResults.innerHTML = "";

		const resources = [];
		document.querySelectorAll("script[src]").forEach((s) => resources.push({ type: "JS", url: s.src }));
		document.querySelectorAll("link[rel='stylesheet']").forEach((s) => resources.push({ type: "CSS", url: s.href }));
		resources.push({ type: "HTML", url: location.href });
		document.querySelectorAll("script:not([src])").forEach((s, i) => {
			if (s.textContent.trim()) resources.push({ type: "INLINE-JS", url: `inline-script-${i}`, content: s.textContent });
		});
		document.querySelectorAll("style").forEach((s, i) => {
			if (s.textContent.trim()) resources.push({ type: "INLINE-CSS", url: `inline-style-${i}`, content: s.textContent });
		});

		const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const searchPattern = useRegex ? new RegExp(query, caseSensitive ? "g" : "gi") : new RegExp(escapedQuery, caseSensitive ? "g" : "gi");

		let totalMatches = 0, searchedCount = 0;
		const results = [];

		for (const res of resources) {
			try {
				let text = res.content;
				if (!text) {
					const r = await fetch(res.url);
					text = await r.text();
				}
				const lines = text.split("\n");
				const fileMatches = [];
				lines.forEach((line, idx) => {
					searchPattern.lastIndex = 0;
					const matchResult = searchPattern.exec(line);
					if (matchResult) {
						const matchPos = matchResult.index;
						const contextPad = 80;
						const start = Math.max(0, matchPos - contextPad);
						const end = Math.min(line.length, matchPos + matchResult[0].length + contextPad);
						const snippet = (start > 0 ? "…" : "") + line.substring(start, end) + (end < line.length ? "…" : "");
						fileMatches.push({ line: idx + 1, text: snippet, matchPos: matchPos - start + (start > 0 ? 1 : 0) });
						totalMatches++;
					}
				});
				if (fileMatches.length) results.push({ ...res, matches: fileMatches });
				searchedCount++;
				searchStatus.textContent = `Searching... ${searchedCount}/${resources.length} files`;
			} catch (_) {
				searchedCount++;
			}
		}

		if (!results.length) {
			searchResults.innerHTML = '<div style="color:var(--wp-txt);padding:20px;text-align:center;">No matches found</div>';
		} else {
			results.forEach((result) => {
				const fileDiv = document.createElement("div");
				Object.assign(fileDiv.style, {
					marginBottom: "12px", border: "1px solid var(--wp-border)", borderRadius: "6px", overflow: "hidden", background: "var(--wp-bg)"
				});

				const hdr = document.createElement("div");
				Object.assign(hdr.style, {
					background: "var(--wp-hdr)", padding: "6px 10px", display: "flex", flexDirection: "column", gap: "4px", borderBottom: "1px solid var(--wp-border)",
				});

				const hdrTop = document.createElement("div");
				Object.assign(hdrTop.style, { display: "flex", justifyContent: "space-between", alignItems: "center" });

				const typeBadge = document.createElement("span");
				typeBadge.textContent = result.type;
				Object.assign(typeBadge.style, {
					fontSize: "9px", fontWeight: "bold", padding: "2px 7px", borderRadius: "3px", letterSpacing: "0.8px", textTransform: "uppercase",
					background: result.type.includes("CSS") ? "#0d47a1" : result.type.includes("JS") ? "#bf360c" : "#1b5e20", color: "#fff",
				});

				const matchCount = document.createElement("span");
				matchCount.textContent = result.matches.length + " match" + (result.matches.length > 1 ? "es" : "");
				Object.assign(matchCount.style, { fontSize: "10px", color: "#f9a825", fontWeight: "bold" });

				hdrTop.append(typeBadge, matchCount);

				const isInline = result.url.startsWith("inline");
				const urlEl = document.createElement("a");
				urlEl.textContent = result.url;
				urlEl.href = isInline ? "#" : result.url;
				if (!isInline) urlEl.target = "_blank";
				Object.assign(urlEl.style, {
					fontSize: "10px", color: "#64b5f6", textDecoration: "none", wordBreak: "break-all", fontFamily: "monospace", lineHeight: "1.4",
				});
				urlEl.onmouseover = () => { urlEl.style.textDecoration = "underline"; urlEl.style.color = "#90caf9"; };
				urlEl.onmouseout = () => { urlEl.style.textDecoration = "none"; urlEl.style.color = "#64b5f6"; };

				hdr.append(hdrTop, urlEl);

				const matchesDiv = document.createElement("div");
				result.matches.forEach((match) => {
					const matchLine = document.createElement("div");
					Object.assign(matchLine.style, {
						padding: "4px 0", borderTop: "1px solid var(--wp-border)", fontFamily: "monospace", fontSize: "11px", color: "var(--wp-txt)",
						cursor: "pointer", whiteSpace: "pre-wrap", wordBreak: "break-all", lineHeight: "1.6", display: "flex", alignItems: "flex-start",
					});

					const lineNum = document.createElement("span");
					lineNum.textContent = match.line;
					Object.assign(lineNum.style, {
						color: "var(--wp-txt)", minWidth: "36px", textAlign: "right", paddingRight: "10px", userSelect: "none", flexShrink: "0", borderRight: "1px solid var(--wp-border)", marginRight: "10px", paddingTop: "0", opacity: "0.6"
					});

					const codeEl = document.createElement("span");
					let safe = match.text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
					try {
						const pat = useRegex ? new RegExp("(" + query + ")", caseSensitive ? "g" : "gi") : new RegExp("(" + escapedQuery + ")", caseSensitive ? "g" : "gi");
						safe = safe.replace(pat, '<mark style="background:#f9a825;color:#000;padding:0 2px;border-radius:2px;font-weight:bold;outline:1.5px solid #f57f17;">$1</mark>');
					} catch (_) {}
					codeEl.innerHTML = safe;
					Object.assign(codeEl.style, { flex: "1", paddingRight: "8px" });

					matchLine.append(lineNum, codeEl);

					matchLine.onmouseover = () => matchLine.style.background = "var(--wp-hdr)";
					matchLine.onmouseout = () => matchLine.style.background = "transparent";
					matchLine.onclick = () => {
						navigator.clipboard.writeText(match.text);
						matchLine.style.background = "var(--wp-bg)";
						setTimeout(() => matchLine.style.background = "transparent", 700);
					};

					matchesDiv.appendChild(matchLine);
				});

				fileDiv.append(hdr, matchesDiv);
				searchResults.appendChild(fileDiv);
			});
		}

		searchStatus.textContent = `Found ${totalMatches} matches in ${results.length} files (searched ${searchedCount} files)`;
	}

	searchExecBtn.onclick = performGlobalSearch;
	searchInput.onkeydown = (e) => {
		if (e.key === "Enter") performGlobalSearch();
	};

	panel.append(header, content, mainBtnRow, actionBtnRow, searchBtnRow, networkSearchBtnRow);
	document.body.appendChild(panel);
	renderPluginButtons();

	// =========================================================
	// LOGIKA DRAG & DROP (TIDAK NEMPEL PINGGIR LAGI)
	// =========================================================
	let isDrag = false, offsetX = 0, offsetY = 0;

	function startDrag(e) {
		if (e.target === minimizeBtn) return;
		isDrag = true;
		panel.style.transition = "none";
		const x = e.touches ? e.touches[0].clientX : e.clientX;
		const y = e.touches ? e.touches[0].clientY : e.clientY;
		offsetX = x - panel.offsetLeft;
		offsetY = y - panel.offsetTop;
	}

	function moveDrag(e) {
		if (!isDrag) return;
		e.preventDefault();
		const x = e.touches ? e.touches[0].clientX : e.clientX;
		const y = e.touches ? e.touches[0].clientY : e.clientY;
		panel.style.left = (x - offsetX) + "px";
		panel.style.top = (y - offsetY) + "px";
	}

	function endDrag() {
		if (!isDrag) return;
		isDrag = false;
		panel.style.transition = "left .25s ease, top .25s ease";
		
		const rect = panel.getBoundingClientRect();
		let newLeft = rect.left;
		let newTop = rect.top;

		// Hanya memastikan panel tidak bablas keluar layar, TIDAK akan sembunyi ke pinggir lagi
		if (newLeft < 0) newLeft = 0;
		if (newTop < 0) newTop = 0;
		if (newLeft + rect.width > window.innerWidth) newLeft = window.innerWidth - rect.width;
		if (newTop + rect.height > window.innerHeight) newTop = window.innerHeight - rect.height;

		panel.style.left = newLeft + "px";
		panel.style.top = newTop + "px";
	}

	header.addEventListener("mousedown", startDrag);
	document.addEventListener("mousemove", moveDrag);
	document.addEventListener("mouseup", endDrag);
	header.addEventListener("touchstart", startDrag, { passive: false });
	document.addEventListener("touchmove", moveDrag, { passive: false });
	document.addEventListener("touchend", endDrag);

	let minimized = false, prevHeight = panel.style.height;

	function toggleMin() {
		if (!minimized) {
			prevHeight = panel.style.height;
			panel.style.height = "40px";
			content.style.display = "none";
			mainBtnRow.style.display = actionBtnRow.style.display = searchBtnRow.style.display = networkSearchBtnRow.style.display = "none";
			minimized = true;
			minimizeBtn.textContent = "+";
		} else {
			panel.style.height = prevHeight;
			content.style.display = "flex";
			if (!currentPlugin) {
				mainBtnRow.style.display = "flex";
			} else {
				actionBtnRow.style.display = "flex";
				textarea.style.display = "block";
			}
			minimized = false;
			minimizeBtn.textContent = "−";
		}
	}

	minimizeBtn.onclick = toggleMin;
	header.addEventListener("dblclick", toggleMin);
	let lastTap = 0;
	header.addEventListener("touchend", () => {
		const now = Date.now();
		if (now - lastTap < 300) toggleMin();
		lastTap = now;
	});

	// =========================================================
	// FITUR RESIZE PANEL (Tuas di Pojok Kanan Bawah)
	// =========================================================
	const resizeHandle = document.createElement("div");
	Object.assign(resizeHandle.style, {
		position: "absolute", bottom: "0", right: "0", width: "25px", height: "25px",
		cursor: "nwse-resize", background: "linear-gradient(135deg, transparent 50%, var(--wp-border) 50%)",
		borderBottomRightRadius: "12px", zIndex: "10", touchAction: "none"
	});
	panel.appendChild(resizeHandle);

	let isResizing = false;
	let startWidth, startHeight, startMouseX, startMouseY;

	function startResize(e) {
		isResizing = true;
		e.stopPropagation(); 
		const clientX = e.touches ? e.touches[0].clientX : e.clientX;
		const clientY = e.touches ? e.touches[0].clientY : e.clientY;
		startMouseX = clientX; startMouseY = clientY;
		const rect = panel.getBoundingClientRect();
		startWidth = rect.width; startHeight = rect.height;
		panel.style.transition = "none";
	}

	function doResize(e) {
		if (!isResizing) return;
		e.preventDefault(); 
		const clientX = e.touches ? e.touches[0].clientX : e.clientX;
		const clientY = e.touches ? e.touches[0].clientY : e.clientY;
		const newWidth = Math.max(300, startWidth + (clientX - startMouseX));
		const newHeight = Math.max(250, startHeight + (clientY - startMouseY));
		panel.style.width = newWidth + "px";
		panel.style.height = newHeight + "px";
	}

	function stopResize() {
		if (!isResizing) return;
		isResizing = false;
		panel.style.transition = "left .25s ease, top .25s ease"; 
	}

	resizeHandle.addEventListener("mousedown", startResize);
	document.addEventListener("mousemove", doResize);
	document.addEventListener("mouseup", stopResize);
	resizeHandle.addEventListener("touchstart", startResize, { passive: false });
	document.addEventListener("touchmove", doResize, { passive: false });
	document.addEventListener("touchend", stopResize);

})();