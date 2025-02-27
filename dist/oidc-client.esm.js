/*!
 * @plusauth/oidc-client-js v1.2.0
 * https://github.com/PlusAuth/oidc-client-js
 * (c) 2023 @plusauth/oidc-client-js Contributors
 * Released under the MIT License
 */
/* eslint-disable @typescript-eslint/indent */ const Events = {
    USER_LOGOUT: 'user_logout',
    USER_LOGIN: 'user_login',
    SILENT_RENEW_SUCCESS: 'silent_renew_success',
    SILENT_RENEW_ERROR: 'silent_renew_error',
    SESSION_CHANGE: 'session_change'
};

class OIDCClientError extends Error {
    constructor(error, error_description){
        super(`${error}${error_description && ` - ${error_description}` || ''}`);
        this.name = 'OIDCClientError';
        this.error = error;
        this.error_description = error_description;
    }
}
class AuthenticationError extends OIDCClientError {
    constructor(error, error_description, state, error_uri){
        super(error, error_description);
        this.name = 'AuthenticationError';
        this.state = state;
        this.error_uri = error_uri;
    }
}
class InvalidJWTError extends OIDCClientError {
    constructor(details){
        super(details);
        this.name = 'InvalidJWTError';
        this.error_description = details;
    }
}
class InvalidIdTokenError extends InvalidJWTError {
    constructor(details){
        super(details);
        this.name = 'InvalidIdTokenError';
    }
}
class InteractionCancelled extends OIDCClientError {
    constructor(details){
        super(details);
        this.name = 'InteractionCancelled';
    }
}

class StateStore {
    constructor(prefix = ''){
        this.prefix = prefix;
    }
}

class LocalStorageStateStore extends StateStore {
    get(key) {
        return new Promise((resolve)=>{
            const value = window.localStorage.getItem(this.prefix + key);
            if (value) {
                resolve(JSON.parse(value));
            } else {
                resolve(null);
            }
        });
    }
    set(key, value) {
        return new Promise((resolve)=>{
            window.localStorage.setItem(this.prefix + key, JSON.stringify(value));
            resolve();
        });
    }
    del(key) {
        return new Promise((resolve)=>{
            window.localStorage.removeItem(this.prefix + key);
            resolve();
        });
    }
    clear(before) {
        return new Promise((resolve)=>{
            let i;
            const storedKeys = [];
            for(i = 0; i < window.localStorage.length; i++){
                const key = window.localStorage.key(i);
                // items only created by oidc client
                if ((key === null || key === void 0 ? void 0 : key.substring(0, this.prefix.length)) == this.prefix) {
                    storedKeys.push(key);
                }
            }
            for(i = 0; i < storedKeys.length; i++){
                if (before) {
                    try {
                        const storedItem = JSON.parse(window.localStorage.getItem(storedKeys[i]));
                        if (storedItem.created_at < before) {
                            window.localStorage.removeItem(storedKeys[i]);
                        }
                    } catch (e) {}
                } else {
                    window.localStorage.removeItem(storedKeys[i]);
                }
            }
            resolve();
        });
    }
    constructor(prefix = 'pa_oidc.'){
        super(prefix);
    }
}

class InMemoryStateStore extends StateStore {
    clear(before) {
        if (before) {
            this.map.forEach((val, ind)=>{
                if (val.created_at < before) {
                    this.map.delete(ind);
                }
            });
            return Promise.resolve();
        } else {
            return Promise.resolve(this.map.clear());
        }
    }
    del(key) {
        this.map.delete(key);
        return Promise.resolve();
    }
    get(key) {
        return Promise.resolve(this.map.get(key) || null);
    }
    set(key, value) {
        this.map.set(key, value);
        return Promise.resolve();
    }
    constructor(...args){
        super(...args);
        this.map = new Map();
    }
}

class EventEmitter {
    once(event, fn) {
        function on(...onArgs) {
            this.off(event, on);
            fn.apply(this, onArgs);
        }
        on.fn = fn;
        this.on(event, on);
        return this;
    }
    on(event, cb) {
        if (!this.callbacks[`$${event}`]) this.callbacks[`$${event}`] = [];
        this.callbacks[`$${event}`].push(cb);
        return this;
    }
    off(event, fn) {
        if (!event) {
            this.callbacks = {};
            return this;
        }
        // specific event
        const callbacks = this.callbacks[`$${event}`];
        if (!callbacks) return this;
        // remove all handlers
        if (!fn) {
            delete this.callbacks[`$${event}`];
            return this;
        }
        for(let i = 0; i < callbacks.length; i++){
            const cb = callbacks[i];
            if (cb === fn || cb.fn === fn) {
                callbacks.splice(i, 1);
                break;
            }
        }
        // Remove event specific arrays for event types that no
        // one is subscribed for to avoid memory leak.
        if (callbacks.length === 0) {
            delete this.callbacks[`$${event}`];
        }
        return this;
    }
    emit(event, ...args) {
        let cbs = this.callbacks[`$${event}`];
        if (cbs) {
            cbs = cbs.slice(0);
            for(let i = 0, len = cbs.length; i < len; ++i){
                cbs[i].apply(this, args);
            }
        }
        return this;
    }
    constructor(){
        this.callbacks = {};
    }
}

class Timer {
    start(duration, callback) {
        if (duration <= 0) {
            duration = 1;
        }
        const expiration = this.now() / 1000 + duration;
        if (this._expiration === expiration && this._timerHandle) {
            return;
        }
        this.stop();
        this._expiration = expiration;
        // prevent device sleep and delayed timers
        let timerDuration = 5;
        if (duration < timerDuration) {
            timerDuration = duration;
        }
        this._timerHandle = setInterval(()=>{
            if (this._expiration <= this.now() / 1000) {
                this.stop();
                callback();
            }
        }, timerDuration * 1000);
    }
    stop() {
        if (this._timerHandle) {
            clearInterval(this._timerHandle);
            this._timerHandle = null;
        }
    }
    constructor(currentTimeInMillisFunc = ()=>Date.now()){
        this.now = currentTimeInMillisFunc;
    }
}

function createHiddenFrame() {
    const iframe = window.document.createElement('iframe');
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.position = 'absolute';
    iframe.style.visibility = 'hidden';
    iframe.style.display = 'none';
    iframe.title = '__pa_helper__hidden';
    iframe.ariaHidden = 'true';
    return iframe;
}
function runIframe(url, options) {
    return new Promise((resolve, reject)=>{
        let onLoadTimeoutId = null;
        const iframe = createHiddenFrame();
        const timeoutSetTimeoutId = setTimeout(()=>{
            reject(new OIDCClientError('Timed out'));
            removeIframe();
        }, (options.timeout || 10) * 1000);
        const iframeEventHandler = (e)=>{
            if (e.origin != options.eventOrigin) return;
            if (!e.data || e.data.type !== 'authorization_response') return;
            const eventSource = e.source;
            if (eventSource) {
                eventSource.close();
            }
            const resp = e.data.response || e.data;
            resp.error ? reject(new AuthenticationError(resp.error, resp.error_description, resp.state, resp.error_uri)) : resolve(e.data);
            clearTimeout(timeoutSetTimeoutId);
            removeIframe();
        };
        const removeIframe = ()=>{
            if (onLoadTimeoutId != null) {
                clearTimeout(onLoadTimeoutId);
            }
            if (window.document.body.contains(iframe)) {
                window.document.body.removeChild(iframe);
            }
            window.removeEventListener('message', iframeEventHandler, false);
        };
        const onLoadTimeout = ()=>setTimeout(()=>{
                reject(new OIDCClientError('Could not complete silent authentication', url));
                removeIframe();
            }, 300);
        window.addEventListener('message', iframeEventHandler, false);
        window.document.body.appendChild(iframe);
        iframe.setAttribute('src', url);
        /**
     * In case of wrong client id, wrong redirect_uri, in short when redirect did not happen
     * we assume flow failed.
     */ iframe.onload = function() {
            onLoadTimeoutId = onLoadTimeout();
        };
    });
}

function getAugmentedNamespace(n) {
  var f = n.default;
	if (typeof f == "function") {
		var a = function () {
			return f.apply(this, arguments);
		};
		a.prototype = f.prototype;
  } else a = {};
  Object.defineProperty(a, '__esModule', {value: true});
	Object.keys(n).forEach(function (k) {
		var d = Object.getOwnPropertyDescriptor(n, k);
		Object.defineProperty(a, k, d.get ? d : {
			enumerable: true,
			get: function () {
				return n[k];
			}
		});
	});
	return a;
}

function unfetch_module(e,n){return n=n||{},new Promise(function(t,r){var s=new XMLHttpRequest,o=[],u=[],i={},a=function(){return {ok:2==(s.status/100|0),statusText:s.statusText,status:s.status,url:s.responseURL,text:function(){return Promise.resolve(s.responseText)},json:function(){return Promise.resolve(s.responseText).then(JSON.parse)},blob:function(){return Promise.resolve(new Blob([s.response]))},clone:a,headers:{keys:function(){return o},entries:function(){return u},get:function(e){return i[e.toLowerCase()]},has:function(e){return e.toLowerCase()in i}}}};for(var l in s.open(n.method||"get",e,!0),s.onload=function(){s.getAllResponseHeaders().replace(/^(.*?):[^\S\n]*([\s\S]*?)$/gm,function(e,n,t){o.push(n=n.toLowerCase()),u.push([n,t]),i[n]=i[n]?i[n]+","+t:t;}),t(a());},s.onerror=r,s.withCredentials="include"==n.credentials,n.headers)s.setRequestHeader(l,n.headers[l]);s.send(n.body||null);})}

var unfetch_module$1 = /*#__PURE__*/Object.freeze({
__proto__: null,
default: unfetch_module
});

var require$$0 = /*@__PURE__*/getAugmentedNamespace(unfetch_module$1);

var browser = self.fetch || (self.fetch = require$$0.default || require$$0);

var fromByteArray_1 = fromByteArray;

var lookup = [];

var code = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
for (var i = 0, len = code.length; i < len; ++i) {
  lookup[i] = code[i];
}

function tripletToBase64 (num) {
  return lookup[num >> 18 & 0x3F] +
    lookup[num >> 12 & 0x3F] +
    lookup[num >> 6 & 0x3F] +
    lookup[num & 0x3F]
}

function encodeChunk (uint8, start, end) {
  var tmp;
  var output = [];
  for (var i = start; i < end; i += 3) {
    tmp =
      ((uint8[i] << 16) & 0xFF0000) +
      ((uint8[i + 1] << 8) & 0xFF00) +
      (uint8[i + 2] & 0xFF);
    output.push(tripletToBase64(tmp));
  }
  return output.join('')
}

function fromByteArray (uint8) {
  var tmp;
  var len = uint8.length;
  var extraBytes = len % 3; // if we have 1 byte left, pad 2 bytes
  var parts = [];
  var maxChunkLength = 16383; // must be multiple of 3

  // go through the array every three bytes, we'll deal with trailing stuff later
  for (var i = 0, len2 = len - extraBytes; i < len2; i += maxChunkLength) {
    parts.push(encodeChunk(uint8, i, (i + maxChunkLength) > len2 ? len2 : (i + maxChunkLength)));
  }

  // pad the end with zeros, but make sure to not forget the extra bytes
  if (extraBytes === 1) {
    tmp = uint8[len - 1];
    parts.push(
      lookup[tmp >> 2] +
      lookup[(tmp << 4) & 0x3F] +
      '=='
    );
  } else if (extraBytes === 2) {
    tmp = (uint8[len - 2] << 8) + uint8[len - 1];
    parts.push(
      lookup[tmp >> 10] +
      lookup[(tmp >> 4) & 0x3F] +
      lookup[(tmp << 2) & 0x3F] +
      '='
    );
  }

  return parts.join('')
}

function isValidIssuer(issuer) {
    try {
        const url = new URL(issuer);
        if (![
            'http:',
            'https:'
        ].includes(url.protocol)) {
            return false;
        }
        if (url.search !== '' || url.hash !== '') {
            return false;
        }
        return true;
    } catch (e) {
        return false;
    }
}
function buildEncodedQueryString(obj, appendable = true) {
    if (!obj) return '';
    const ret = [];
    for(const d in obj){
        if (obj.hasOwnProperty(d) && obj[d]) {
            ret.push(`${encodeURIComponent(d)}=${encodeURIComponent(typeof obj[d] === 'object' ? JSON.stringify(obj[d]) : obj[d])}`);
        }
    }
    return `${appendable ? '?' : ''}${ret.join('&')}`;
}
function parseQueryUrl(value) {
    const result = {};
    value = value.trim().replace(/^(\?|#|&)/, '');
    const params = value.split('&');
    for(let i = 0; i < params.length; i += 1){
        const paramAndValue = params[i];
        const parts = paramAndValue.split('=');
        const key = decodeURIComponent(parts.shift());
        const value1 = parts.length > 0 ? parts.join('=') : '';
        result[key] = decodeURIComponent(value1);
    }
    return result;
}
function urlSafe(buffer) {
    const encoded = fromByteArray_1(new Uint8Array(buffer));
    return encoded.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function request(options) {
    let body = null;
    let headers = options.headers || {};
    if (options.method === 'POST') {
        headers = {
            'Content-Type': options.requestType === 'form' ? 'application/x-www-form-urlencoded;charset=UTF-8' : 'application/json;charset=UTF-8',
            ...headers
        };
    }
    if (options.body) {
        body = options.requestType === 'form' ? buildEncodedQueryString(options.body, false) : JSON.stringify(options.body);
    }
    return new Promise((resolve, reject)=>{
        browser(options.url, {
            method: options.method,
            body: body,
            headers
        }).then((value)=>resolve(value.json())).catch(reject);
    });
}

const CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
function getRandomBytes(n) {
    // @ts-ignore
    const crypto1 = self.crypto || self.msCrypto, QUOTA = 65536;
    const a = new Uint8Array(n);
    for(let i = 0; i < n; i += QUOTA){
        crypto1.getRandomValues(a.subarray(i, i + Math.min(n - i, QUOTA)));
    }
    return a;
}
function generateRandom(length) {
    let out = '';
    const charsLen = CHARSET.length;
    const maxByte = 256 - 256 % charsLen;
    while(length > 0){
        const buf = getRandomBytes(Math.ceil(length * 256 / maxByte));
        for(let i = 0; i < buf.length && length > 0; i++){
            const randomByte = buf[i];
            if (randomByte < maxByte) {
                out += CHARSET.charAt(randomByte % charsLen);
                length--;
            }
        }
    }
    return out;
}
function deriveChallenge(code) {
    if (code.length < 43 || code.length > 128) {
        return Promise.reject(new OIDCClientError(`Invalid code length: ${code.length}`));
    }
    return new Promise((resolve, reject)=>{
        crypto.subtle.digest('SHA-256', new TextEncoder().encode(code)).then((buffer)=>{
            return resolve(urlSafe(new Uint8Array(buffer)));
        }, function(error) {
            /* istanbul ignore next */ return reject(error);
        });
    });
}
// https://datatracker.ietf.org/doc/html/rfc4648#section-5
const urlDecodeB64 = (input)=>decodeURIComponent(atob(input.replace(/_/g, '/').replace(/-/g, '+')).split('').map((c)=>{
        return `%${`00${c.charCodeAt(0).toString(16)}`.slice(-2)}`;
    }).join(''));
function parseJwt(jwt) {
    try {
        const parts = jwt.split('.');
        if (parts.length !== 3) {
            throw new Error('Wrong JWT format');
        }
        return {
            header: JSON.parse(urlDecodeB64(parts[0])),
            payload: JSON.parse(urlDecodeB64(parts[1]))
        };
    } catch (e) {
        throw new InvalidJWTError('Failed to parse jwt');
    }
}
function validateIdToken(id_token, nonce, options) {
    if (!nonce) {
        throw new OIDCClientError('No nonce on state');
    }
    try {
        const jwt = parseJwt(id_token);
        if (nonce !== jwt.payload.nonce) {
            throw new Error(`Invalid nonce in id_token: ${jwt.payload.nonce}`);
        }
        validateJwt(id_token, options, true);
        // @ts-ignore
        if (!jwt.payload['sub']) {
            throw new Error('No Subject (sub) present in id_token');
        }
        return jwt.payload;
    } catch (e) {
        throw new InvalidIdTokenError(e.message);
    }
}
function validateJwt(jwt, options, isIdToken = false) {
    // eslint-disable-next-line prefer-const
    let { clockSkew , currentTimeInMillis , issuer , audience , client_id  } = options;
    if (!clockSkew) {
        clockSkew = 0;
    }
    const now = (currentTimeInMillis && currentTimeInMillis() || Date.now()) / 1000;
    const payload = parseJwt(jwt).payload;
    if (!payload.iss) {
        throw new InvalidJWTError('Issuer (iss) was not provided');
    }
    if (payload.iss !== issuer) {
        throw new InvalidJWTError(`Invalid Issuer (iss) in token: ${payload.iss}`);
    }
    if (!payload.aud) {
        throw new InvalidJWTError('Audience (aud) was not provided');
    }
    // Audience must be equal to client_id in id_token
    // https://openid.net/specs/openid-connect-core-1_0.html#IDToken
    if (Array.isArray(payload.aud) ? payload.aud.indexOf(isIdToken ? client_id : audience || client_id) == -1 : payload.aud !== (isIdToken ? client_id : audience || client_id)) {
        throw new InvalidJWTError(`Invalid Audience (aud) in token: ${payload.aud}`);
    }
    if (payload.azp && payload.azp !== client_id) {
        throw new InvalidJWTError(`Invalid Authorized Party (azp) in token: ${payload.azp}`);
    }
    const lowerNow = Math.ceil(now + clockSkew);
    const upperNow = Math.floor(now - clockSkew);
    if (!payload.iat) {
        throw new InvalidJWTError('Issued At (iat) was not provided');
    }
    if (lowerNow < payload.iat) {
        throw new InvalidJWTError(`Issued At (iat) is in the future: ${payload.iat}`);
    }
    if (payload.nbf && lowerNow < payload.nbf) {
        throw new InvalidJWTError(`Not Before time (nbf) is in the future: ${payload.nbf}`);
    }
    if (!payload.exp) {
        throw new InvalidJWTError('Expiration Time (exp) was not provided');
    }
    if (payload.exp < upperNow) {
        throw new InvalidJWTError(`Expiration Time (exp) is in the past: ${payload.exp}`);
    }
    return payload;
}
// Retrieved from https://www.iana.org/assignments/jwt/jwt.xhtml
const nonUserClaims = [
    'iss',
    // 'sub',
    'aud',
    'exp',
    'nbf',
    'iat',
    'jti',
    'azp',
    'nonce',
    'auth_time',
    'at_hash',
    'c_hash',
    'acr',
    'amr',
    'sub_jwk',
    'cnf',
    'sip_from_tag',
    'sip_date',
    'sip_callid',
    'sip_cseq_num',
    'sip_via_branch',
    'orig',
    'dest',
    'mky',
    'events',
    'toe',
    'txn',
    'rph',
    'sid',
    'vot',
    'vtm',
    'attest',
    'origid',
    'act',
    'scope',
    'client_id',
    'may_act',
    'jcard',
    'at_use_nbr'
];

const DEFAULT_CHECK_INTERVAL = 2000;
function createSessionCheckerFrame(options) {
    const { url , callback , client_id , checkInterval  } = options;
    let internalSessionState;
    const idx = url.indexOf('/', url.indexOf('//') + 2);
    const frameOrigin = url.substr(0, idx);
    const frame = createHiddenFrame();
    let timer;
    const load = ()=>{
        return new Promise((resolve)=>{
            window.document.body.appendChild(frame);
            window.addEventListener('message', iframeEventHandler, false);
            frame.onload = ()=>{
                resolve(null);
            };
        });
    };
    const start = (sessionState)=>{
        load().then(()=>{
            if (sessionState && internalSessionState !== sessionState) {
                stop();
                internalSessionState = sessionState;
                const send = ()=>{
                    frame.contentWindow.postMessage(`${client_id} ${internalSessionState}`, frameOrigin);
                };
                send();
                timer = window.setInterval(send, checkInterval || DEFAULT_CHECK_INTERVAL);
            }
        });
    };
    const stop = ()=>{
        internalSessionState = null;
        if (timer) {
            window.clearInterval(timer);
            timer = null;
        }
    };
    const iframeEventHandler = (e)=>{
        if (e.origin === frameOrigin && e.source === frame.contentWindow) {
            if (e.data === 'error') {
                stop();
                callback(e.data);
            } else if (e.data === 'changed') {
                stop();
                callback();
            }
        }
    };
    frame.setAttribute('src', url);
    return {
        stop,
        start
    };
}

const isResponseType = (type, response_type)=>response_type && response_type.split(/\s+/g).filter((rt)=>rt === type).length > 0;
const isScopeIncluded = (scope, scopes)=>scopes && scopes.split(' ').indexOf(scope) > -1;

const openPopup = (url, width = 400, height = 600)=>{
    const left = window.screenX + (window.innerWidth - width) / 2;
    const top = window.screenY + (window.innerHeight - height) / 2;
    return window.open(url, 'oidc-login-popup', `left=${left},top=${top},width=${width},height=${height},resizable,scrollbars=yes,status=1`);
};
function runPopup(url, options) {
    let popup = options.popup;
    if (popup) {
        popup.location.href = url;
    } else {
        popup = openPopup(url);
    }
    if (!popup) {
        /* istanbul ignore next */ throw new Error('Could not open popup');
    }
    let timeoutId;
    let closeId;
    return new Promise((resolve, reject)=>{
        function clearHandlers() {
            clearInterval(closeId);
            clearTimeout(timeoutId);
            window.removeEventListener('message', messageListener);
        }
        timeoutId = setTimeout(()=>{
            clearHandlers();
            reject(new OIDCClientError('Timed out'));
        }, options.timeout || 60 * 1000);
        closeId = setInterval(function() {
            if (popup.closed) {
                clearHandlers();
                reject(new InteractionCancelled('user closed popup'));
            }
        }, 300);
        window.addEventListener('message', messageListener);
        function messageListener(e) {
            if (!e.data || e.data.type !== 'authorization_response') return;
            clearHandlers();
            popup.close();
            const data = e.data.response || e.data;
            data.error ? reject(new OIDCClientError(data.error, data.error_description)) : resolve(e.data);
        }
    });
}

/*
Jitbit TabUtils - helper for multiple browser tabs. version 1.0
https://github.com/jitbit/TabUtils
- executing "interlocked" function call - only once per multiple tabs
- broadcasting a message to all tabs (including the current one) with some message "data"
- handling a broadcasted message
MIT license: https://github.com/jitbit/TabUtils/blob/master/LICENSE
*/ const currentTabId = `${performance.now()}:${Math.random() * 1000000000 | 0}`;
const handlers = {};
class TabUtils {
    //runs code only once in multiple tabs
    //the lock holds for 4 seconds (in case the function is async and returns right away, for example, an ajax call intiated)
    //then it is cleared
    CallOnce(lockname, fn, timeout = 3000) {
        if (!lockname) throw 'empty lockname';
        if (!window.localStorage) {
            fn();
            return;
        }
        const localStorageKey = this.keyPrefix + lockname;
        localStorage.setItem(localStorageKey, currentTabId);
        //re-read after a delay (after all tabs have saved their tabIDs into ls)
        setTimeout(()=>{
            if (localStorage.getItem(localStorageKey) == currentTabId) fn();
        }, 150);
        //cleanup - release the lock after 3 seconds and on window unload (just in case user closed the window while the lock is still held)
        setTimeout(function() {
            localStorage.removeItem(localStorageKey);
        }, timeout);
    }
    BroadcastMessageToAllTabs(messageId, eventData) {
        //now we also need to manually execute handler in the current tab too, because current tab does not get 'storage' events
        try {
            handlers[messageId](eventData);
        } catch (x) {}
        if (!window.localStorage) return; //no local storage. old browser
        const data = {
            data: eventData,
            timeStamp: new Date().getTime()
        }; //add timestamp because overwriting same data does not trigger the event
        //this triggers 'storage' event for all other tabs except the current tab
        localStorage.setItem(`${this.keyPrefix}event${messageId}`, JSON.stringify(data));
        //cleanup
        setTimeout(()=>{
            localStorage.removeItem(`${this.keyPrefix}event${messageId}`);
        }, 3000);
    }
    OnBroadcastMessage(messageId, fn) {
        handlers[messageId] = fn;
        if (!window.localStorage) return; //no local storage. old browser
        //first register a handler for "storage" event that we trigger above
        window.addEventListener('storage', (ev)=>{
            if (ev.key != `${this.keyPrefix}event${messageId}`) return; // ignore other keys
            if (!ev.newValue) return; //called by cleanup?
            const messageData = JSON.parse(ev.newValue);
            fn(messageData.data);
        });
    }
    constructor(kid){
        this.keyPrefix = kid;
    }
}

var ref;
/**
 * `OIDCClient` provides methods for interacting with OIDC/OAuth2 authorization server. Those methods are signing a
 * user in, signing out, managing the user's claims, checking session and managing tokens returned from the
 * OIDC/OAuth2 provider.
 *
 */ class OIDCClient extends EventEmitter {
    /**
   * Initialize the library with this method. It resolves issuer configuration, jwks keys which are necessary for
   * validating tokens returned from provider and checking if a user is already authenticated in provider.
   *
   * @param checkLogin Make this `false` if you don't want to check user authorization status in provider while
   * initializing. Defaults to `true`
   */ async initialize(checkLogin = true) {
        if (this.initialized) {
            return this;
        }
        if (this.__initializePromise) {
            return this.__initializePromise;
        } else {
            this.__initializePromise = new Promise(async (resolve, reject)=>{
                try {
                    if (this.stateStore.init) {
                        await this.stateStore.init();
                    }
                    if (this.authStore.init) {
                        await this.authStore.init();
                    }
                    if (!this.options.endpoints || Object.keys(this.options.endpoints).length === 0) {
                        await this.fetchFromIssuer();
                    }
                    this.initialized = true;
                    try {
                        if (checkLogin) {
                            if (!(window === null || window === void 0 ? void 0 : window.frameElement)) {
                                await this.silentLogin();
                            }
                        }
                    } catch (e) {
                        await this.authStore.clear();
                    }
                    resolve(this);
                } catch (e1) {
                    if (e1 instanceof OIDCClientError) {
                        reject(e1);
                    } else {
                        reject(new OIDCClientError(e1.message));
                    }
                } finally{
                    this.__initializePromise = undefined;
                }
            });
        }
        return this.__initializePromise;
    }
    /**
   * Redirect to provider's authorization endpoint using provided parameters. You can override any parameter defined
   * in `OIDCClient`. If you don't provide `state`, `nonce` or `code_verifier` they will be generated automatically
   * in a random and secure way.
   *
   * @param options
   * @param localState
   */ async login(options = {}, localState = {}) {
        window.location.assign(await this.createAuthRequest(options, localState));
    }
    /**
   * Open a popup with the provider's authorization endpoint using provided parameters. You can override any
   * parameter defined in `OIDCClient`. If you don't provide `state`, `nonce` or `code_verifier` they will be
   * generated automatically in a random and secure way. You can also override popup options.
   *
   * NOTE: Most browsers block popups if they are not happened as a result of user actions. In order to display
   * login popup you must call this method in an event handler listening for a user action like button click.
   *
   * @param options
   * @param popupOptions
   */ async loginWithPopup(options = {}, popupOptions = {}) {
        const url = await this.createAuthRequest({
            response_mode: 'fragment',
            ...options,
            display: 'popup',
            request_type: 'p'
        });
        const { response , state  } = await runPopup(url, popupOptions);
        const { authParams , localState  } = !state || typeof state === 'string' ? await this.loadState(state || response.state) : state;
        const tokenResult = await this.handleAuthResponse(response, authParams, localState);
        const authObject = await this.handleTokenResult(tokenResult, authParams, Object.assign({}, this.options, authParams));
        authObject.session_state = response.session_state;
        this.synchronizer.BroadcastMessageToAllTabs(Events.USER_LOGIN, authObject);
        return localState;
    }
    /**
   * After a user successfully authorizes an application, the authorization server will redirect the user back to
   * the application with either an authorization code or access token in the URL. In the callback page you should
   * call this method.
   *
   * @param url Full url which contains authorization request result parameters. Defaults to `window.location.href`
   */ async loginCallback(url = window === null || window === void 0 ? void 0 : (ref = window.location) === null || ref === void 0 ? void 0 : ref.href) {
        if (!url) {
            return Promise.reject(new OIDCClientError('Url must be passed to handle login redirect'));
        }
        let parsedUrl;
        try {
            parsedUrl = new URL(url);
        } catch (e) {
            return Promise.reject(new OIDCClientError(`Invalid callback url passed: "${url}"`));
        }
        const responseParams = parseQueryUrl(parsedUrl.search || parsedUrl.hash);
        const rawStoredState = await this.loadState(responseParams.state);
        const { authParams , localState , request_type  } = rawStoredState;
        url = url || window.location.href;
        switch(request_type){
            case 's':
                if (window === null || window === void 0 ? void 0 : window.frameElement) {
                    if (url) {
                        window.parent.postMessage({
                            type: 'authorization_response',
                            response: responseParams,
                            state: rawStoredState
                        }, `${location.protocol}//${location.host}`);
                    }
                }
                return;
            case 'p':
                if (window.opener && url) {
                    window.opener.postMessage({
                        type: 'authorization_response',
                        response: responseParams,
                        state: rawStoredState
                    }, `${location.protocol}//${location.host}`);
                }
                return;
            default:
                if (responseParams.error) {
                    return Promise.reject(new AuthenticationError(responseParams.error, responseParams.error_description));
                }
                const tokenResult = await this.handleAuthResponse(responseParams, authParams, localState);
                const authObject = await this.handleTokenResult(tokenResult, authParams, Object.assign({}, this.options, authParams));
                authObject.session_state = responseParams.session_state;
                this.synchronizer.BroadcastMessageToAllTabs(Events.USER_LOGIN, authObject);
                return localState;
        }
    }
    /**
   * Redirect to provider's `end_session_endpoint` with provided parameters. After logout provider will redirect to
   * provided `post_logout_redirect_uri` if it provided.
   * @param options
   */ async logout(options = {}) {
        if (!options.localOnly) {
            const storedAuth = await this.authStore.get('auth');
            const id_token_hint = options.id_token_hint || (storedAuth === null || storedAuth === void 0 ? void 0 : storedAuth.id_token_raw);
            window.location.assign(await this.createLogoutRequest({
                ...options,
                id_token_hint
            }));
        }
        await this.authStore.clear();
    }
    /**
   * OAuth2 token revocation implementation method. See more at [tools.ietf.org/html/rfc7009](https://tools.ietf.org/html/rfc7009)
   * @param token Token to be revoked
   * @param type Passed token's type. It will be used to provide `token_type_hint` parameter.
   * @param options If necessary override options passed to `OIDCClient` by defining them here.
   */ async revokeToken(token, type = 'access_token', options = {}) {
        if (!this.options.endpoints.revocation_endpoint) {
            return Promise.reject(new OIDCClientError('"revocation_endpoint" doesn\'t exist'));
        }
        const finalOptions = {
            client_id: options.client_id || this.options.client_id,
            client_secret: options.client_secret || this.options.client_secret,
            token_type_hint: type,
            token: token
        };
        return this.http({
            method: 'POST',
            requestType: 'form',
            url: this.options.endpoints.revocation_endpoint,
            body: finalOptions
        });
    }
    /**
   * Login without having an interaction. If refresh tokens are used and there is a stored refresh token it will
   * exchange refresh token to receive new access token. If not it silently makes a request the provider's
   * authorization endpoint using provided parameters. You can override any parameter defined in `OIDCClient`. If
   * you don't provide `state`, `nonce` or `code_verifier` they will be generated automatically in a random and
   * secure way.
   *
   * @param options
   * @param localState
   */ async silentLogin(options = {}, localState = {}) {
        await this.initialize(false);
        let tokenResult;
        let finalState = {};
        const storedAuth = await this.authStore.get('auth') || {};
        const finalOptions = Object.assign({}, this.options, options);
        if (finalOptions.silent_redirect_uri) {
            finalOptions.redirect_uri = finalOptions.silent_redirect_uri;
        }
        if (this.options.useRefreshToken && (storedAuth === null || storedAuth === void 0 ? void 0 : storedAuth.refresh_token)) {
            // TODO: deep merge
            finalState.authParams = Object.assign({}, (storedAuth === null || storedAuth === void 0 ? void 0 : storedAuth.authParams) || {}, finalState.authParams || {});
            tokenResult = await this.exchangeRefreshToken({
                ...finalOptions,
                refresh_token: storedAuth.refresh_token
            });
        } else {
            const authUrl = await this.createAuthRequest({
                response_mode: 'query',
                display: 'page',
                prompt: 'none',
                ...finalOptions,
                request_type: 's'
            }, localState);
            const { response , state  } = await runIframe(authUrl, {
                timeout: finalOptions.silentRequestTimeout,
                eventOrigin: window.location.origin
            });
            tokenResult = await this.handleAuthResponse(response, finalOptions, localState);
            storedAuth.session_state = response.session_state;
            finalState = state;
        }
        const authObject = await this.handleTokenResult(tokenResult, finalState.authParams, finalOptions);
        authObject.session_state = storedAuth.session_state;
        this.synchronizer.BroadcastMessageToAllTabs(Events.USER_LOGIN, authObject);
        return finalState.localState;
    }
    /**
   * Retrieve logged in user's access token if it exists.
   */ async getAccessToken() {
        var ref;
        return (ref = await this.authStore.get('auth')) === null || ref === void 0 ? void 0 : ref.access_token;
    }
    /**
   * Retrieve logged in user's refresh token if it exists.
   */ async getRefreshToken() {
        var ref;
        return (ref = await this.authStore.get('auth')) === null || ref === void 0 ? void 0 : ref.refresh_token;
    }
    /**
   * Retrieve logged in user's parsed id token if it exists.
   */ async getIdToken() {
        var ref;
        return (ref = await this.authStore.get('auth')) === null || ref === void 0 ? void 0 : ref.id_token;
    }
    /**
   * Retrieve access token's expiration.
   */ async getExpiresAt() {
        var ref;
        return (ref = await this.authStore.get('auth')) === null || ref === void 0 ? void 0 : ref.expires_at;
    }
    /**
   * Retrieve logged in user's id token in raw format if it exists.
   */ async getIdTokenRaw() {
        var ref;
        return (ref = await this.authStore.get('auth')) === null || ref === void 0 ? void 0 : ref.id_token_raw;
    }
    /**
   * Retrieve logged in user's scopes if it exists.
   */ async getScopes() {
        var ref, ref1;
        return (ref = await this.authStore.get('auth')) === null || ref === void 0 ? void 0 : (ref1 = ref.scope) === null || ref1 === void 0 ? void 0 : ref1.split(' ');
    }
    /**
   * Retrieve logged in user's profile.
   */ async getUser() {
        var ref;
        return (ref = await this.authStore.get('auth')) === null || ref === void 0 ? void 0 : ref.user;
    }
    /**
   * If there is a user stored locally return true. Otherwise it will make a silentLogin to check if End-User is
   * logged in provider.
   *
   * @param localOnly Don't check provider
   */ async isLoggedIn(localOnly = false) {
        const existsOnLocal = !!await this.getUser();
        if (!existsOnLocal && !localOnly) {
            try {
                await this.silentLogin();
                return true;
            } catch (e) {
                return false;
            }
        }
        return existsOnLocal;
    }
    /**
   * Create authorization request with provided options.
   *
   * @param options
   * @param localState
   * @private
   */ async createAuthRequest(options = {}, localState = {}) {
        var ref;
        if (!((ref = this.options.endpoints) === null || ref === void 0 ? void 0 : ref.authorization_endpoint)) {
            await this.initialize(false);
        }
        // TODO: deep merge for extra params
        const finalOptions = Object.assign({}, this.options, options);
        localState.code_verifier = generateRandom(72);
        const authParams = {
            client_id: finalOptions.client_id,
            state: generateRandom(10),
            scope: finalOptions.scope,
            audience: finalOptions.audience,
            redirect_uri: finalOptions.redirect_uri,
            response_mode: finalOptions.response_mode,
            response_type: finalOptions.response_type || 'code',
            ui_locales: finalOptions.ui_locales,
            prompt: finalOptions.prompt,
            display: finalOptions.display,
            claims: finalOptions.claims,
            claims_locales: finalOptions.claims_locales,
            acr_values: finalOptions.acr_values,
            registration: finalOptions.registration,
            login_hint: finalOptions.login_hint,
            id_token_hint: finalOptions.id_token_hint,
            web_message_uri: finalOptions.web_message_uri,
            web_message_target: finalOptions.web_message_target,
            ...finalOptions.extraParams && finalOptions.extraParams
        };
        if (isResponseType('id_token', authParams.response_type) || isScopeIncluded('openid', authParams.scope)) {
            authParams.nonce = generateRandom(10);
        }
        if (isResponseType('code', authParams.response_type)) {
            authParams.code_challenge = await deriveChallenge(localState.code_verifier);
            authParams.code_challenge_method = finalOptions.code_challenge_method || 'S256';
        }
        const now = this.options.currentTimeInMillis && this.options.currentTimeInMillis() || Date.now();
        const fragment = finalOptions.fragment ? `#${finalOptions.fragment}` : '';
        const authParamsString = buildEncodedQueryString(authParams);
        const url = `${this.options.endpoints.authorization_endpoint}${authParamsString}${fragment}`;
        // clear 1 day old state entries
        this.stateStore.clear(now - 86400000);
        await this.stateStore.set(authParams.state, {
            created_at: now,
            authParams,
            localState,
            request_type: finalOptions.request_type
        });
        return url;
    }
    /**
   * Create a logout request with given options
   *
   * @param options
   * @private
   */ async createLogoutRequest(options = {}) {
        var ref;
        if (!((ref = this.options.endpoints) === null || ref === void 0 ? void 0 : ref.end_session_endpoint)) {
            await this.fetchFromIssuer();
        }
        const finalOptions = Object.assign({}, this.options, options);
        const logoutParams = {
            id_token_hint: finalOptions.id_token_hint,
            post_logout_redirect_uri: finalOptions.post_logout_redirect_uri,
            ...finalOptions.extraLogoutParams && finalOptions.extraLogoutParams
        };
        return `${this.options.endpoints.end_session_endpoint}${buildEncodedQueryString(logoutParams)}`;
    }
    /**
   * Exchange authorization code retrieved from auth request result.
   * @param options
   * @private
   */ async exchangeAuthorizationCode(options) {
        var ref;
        if (!((ref = this.options.endpoints) === null || ref === void 0 ? void 0 : ref.token_endpoint)) {
            await this.fetchFromIssuer();
        }
        const extraTokenHeaders = options.extraTokenHeaders;
        options = Object.assign({}, options, options.extraTokenParams || {});
        delete options.extraTokenParams;
        delete options.extraTokenHeaders;
        options.grant_type = options.grant_type || 'authorization_code';
        options.client_id = options.client_id || this.options.client_id;
        options.redirect_uri = options.redirect_uri || this.options.redirect_uri;
        if (!options.code) {
            return Promise.reject(new Error('"code" is required'));
        }
        if (!options.redirect_uri) {
            return Promise.reject(new Error('"redirect_uri" is required'));
        }
        if (!options.code_verifier) {
            return Promise.reject(new Error('"code_verifier" is required'));
        }
        if (!options.client_id) {
            return Promise.reject(new Error('"client_id" is required'));
        }
        return this.http({
            url: `${this.options.endpoints.token_endpoint}`,
            method: 'POST',
            requestType: 'form',
            body: options,
            headers: extraTokenHeaders
        });
    }
    /**
   * Exchange refresh token with given options
   * @param options
   * @private
   */ async exchangeRefreshToken(options) {
        var ref;
        if (!((ref = this.options.endpoints) === null || ref === void 0 ? void 0 : ref.token_endpoint)) {
            await this.fetchFromIssuer();
        }
        const extraTokenHeaders = options.extraTokenHeaders;
        options = Object.assign({}, options, options.extraTokenParams || {});
        options.grant_type = options.grant_type || 'refresh_token';
        options.client_id = options.client_id || this.options.client_id;
        options.client_secret = options.client_secret || this.options.client_secret;
        if (!options.refresh_token) {
            return Promise.reject(new Error('"refresh_token" is required'));
        }
        if (!options.client_id) {
            return Promise.reject(new Error('"client_id" is required'));
        }
        return this.http({
            url: `${this.options.endpoints.token_endpoint}`,
            method: 'POST',
            requestType: 'form',
            body: options,
            headers: extraTokenHeaders
        });
    }
    /**
   * Fetch OIDC configuration from the issuer.
   */ async fetchFromIssuer() {
        try {
            const requestUrl = `${this.options.issuer}/.well-known/openid-configuration`;
            const response = await this.http({
                url: requestUrl,
                method: 'GET',
                requestType: 'json'
            });
            this.issuer_metadata = response;
            const endpoints = {};
            for (const prop of Object.keys(this.issuer_metadata)){
                if (prop.endsWith('_endpoint') || prop.indexOf('_session') > -1 || prop.indexOf('_uri') > -1) {
                    endpoints[prop] = this.issuer_metadata[prop];
                }
            }
            this.options.endpoints = endpoints;
            return this.issuer_metadata;
        } catch (e) {
            throw new OIDCClientError('Loading metadata failed', e.message);
        }
    }
    /**
   * Handle auth request result. If there is `code` exchange it.
   * @param response
   * @param finalOptions
   * @param localState
   * @private
   */ async handleAuthResponse(response, finalOptions, localState = {}) {
        if (response.code) {
            return this.exchangeAuthorizationCode({
                redirect_uri: finalOptions.redirect_uri,
                client_id: finalOptions.client_id,
                code_verifier: localState.code_verifier,
                grant_type: 'authorization_code',
                code: response.code
            });
        } else {
            return response;
        }
    }
    /**
   * Handle OAuth2 auth request result
   * @param tokenResult
   * @param authParams
   * @param finalOptions
   * @private
   */ async handleTokenResult(tokenResult, authParams, finalOptions) {
        await this.initialize(false);
        let user = {};
        if (tokenResult.error) {
            throw new AuthenticationError(tokenResult.error, tokenResult.error_description);
        }
        let parsedIDToken;
        if (tokenResult.id_token) {
            parsedIDToken = await validateIdToken(tokenResult.id_token, authParams.nonce, finalOptions);
            if (finalOptions.idTokenValidator && !await finalOptions.idTokenValidator(tokenResult.id_token)) {
                return Promise.reject(new InvalidIdTokenError('Id Token validation failed'));
            }
            Object.keys(parsedIDToken).forEach((key)=>{
                if (!nonUserClaims.includes(key)) {
                    user[key] = parsedIDToken[key];
                }
            });
        }
        if (tokenResult.access_token) {
            var ref;
            if (finalOptions.requestUserInfo && ((ref = this.options.endpoints) === null || ref === void 0 ? void 0 : ref.userinfo_endpoint)) {
                const userInfoResult = await this.fetchUserInfo(tokenResult.access_token);
                if (!userInfoResult.error) {
                    user = {
                        ...user,
                        ...userInfoResult
                    };
                }
            }
        }
        return {
            authParams,
            user,
            ...tokenResult,
            id_token: parsedIDToken,
            id_token_raw: tokenResult.id_token,
            scope: tokenResult.scope || authParams.scope
        };
    }
    /**
   * Load stored state
   *
   * @param state
   * @private
   */ async loadState(state) {
        const rawStoredState = await this.stateStore.get(state);
        if (!rawStoredState) {
            return Promise.reject(new AuthenticationError('State not found'));
        } else {
            await this.stateStore.del(state);
        }
        return rawStoredState;
    }
    /**
   * Load user info by making request to providers `userinfo_endpoint`
   *
   * @param accessToken
   * @private
   */ async fetchUserInfo(accessToken) {
        return this.http({
            method: 'GET',
            url: `${this.options.endpoints.userinfo_endpoint}`,
            requestType: 'json',
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        });
    }
    /**
   * Start monitoring End-User's session if the OIDC provider supports session management. See more at [OIDC Session
   * Management](https://openid.net/specs/openid-connect-session-1_0.html)
   *
   * @param sub End-User's id to for monitoring session
   * @param session_state string that represents the End-User's login state at the OP
   */ monitorSession({ sub , session_state  }) {
        const { client_id , endpoints  } = this.options;
        if (!(endpoints === null || endpoints === void 0 ? void 0 : endpoints.check_session_iframe)) {
            console.warn('"check_session_iframe" endpoint missing or session management is not supported by provider');
            return;
        }
        if (!this.sessionCheckerFrame) {
            const sessionCheckCallback = async (err)=>{
                if (err) {
                    this.emit(Events.USER_LOGOUT);
                } else {
                    this.emit(Events.SESSION_CHANGE);
                    try {
                        await this.silentLogin({}, {});
                        const storedAuth = await this.authStore.get('auth');
                        if (storedAuth) {
                            if ((storedAuth === null || storedAuth === void 0 ? void 0 : storedAuth.user.sub) === sub) {
                                this.sessionCheckerFrame.start(storedAuth.session_state);
                            }
                        } else {
                            this.emit(Events.USER_LOGOUT, null);
                        }
                    } catch (e) {
                        this.emit(Events.USER_LOGOUT);
                        return;
                    }
                }
            };
            this.sessionCheckerFrame = createSessionCheckerFrame({
                url: endpoints.check_session_iframe,
                client_id: client_id,
                callback: sessionCheckCallback,
                checkInterval: this.options.checkSessionInterval
            });
        }
        this.sessionCheckerFrame.start(session_state);
    }
    async onUserLogin(authObj) {
        const { expires_in , user , scope , access_token , id_token , refresh_token , session_state , id_token_raw  } = authObj;
        await this.authStore.set('auth', authObj);
        this.user = user;
        this.scopes = scope === null || scope === void 0 ? void 0 : scope.split(' ');
        this.accessToken = access_token;
        this.idToken = id_token;
        this.idTokenRaw = id_token_raw;
        this.refreshToken = refresh_token;
        this.emit(Events.USER_LOGIN, authObj);
        if (!(window === null || window === void 0 ? void 0 : window.frameElement)) {
            if (this.options.checkSession) {
                this.monitorSession({
                    sub: user.sub || user.id,
                    session_state
                });
            }
            if (expires_in !== undefined && this.options.autoSilentRenew) {
                const expiration = Number(expires_in) - this.options.secondsToRefreshAccessTokenBeforeExp;
                if (expiration >= 0) {
                    this._accessTokenExpireTimer.start(expiration, async ()=>{
                        this.synchronizer.CallOnce('silent-login', async ()=>{
                            try {
                                await this.silentLogin();
                                this.emit(Events.SILENT_RENEW_SUCCESS, null);
                            } catch (e) {
                                this.emit(Events.SILENT_RENEW_ERROR, e);
                            }
                        });
                    });
                }
            }
        }
    }
    constructor(options){
        super();
        if (!isValidIssuer(options.issuer)) {
            throw new OIDCClientError('"issuer" must be a valid uri.');
        }
        this.synchronizer = new TabUtils(btoa(options.issuer));
        this.options = Object.assign({
            secondsToRefreshAccessTokenBeforeExp: 60,
            autoSilentRenew: true,
            checkSession: true
        }, options, {
            // remove last slash for consistency across the lib
            issuer: options.issuer.endsWith('/') ? options.issuer.slice(0, -1) : options.issuer
        });
        this.http = this.options.httpClient || request;
        this.stateStore = this.options.stateStore || new LocalStorageStateStore('pa_oidc.state.');
        this.authStore = this.options.authStore || new InMemoryStateStore();
        if (this.options.autoSilentRenew) {
            this._accessTokenExpireTimer = new Timer();
        }
        this.on(Events.USER_LOGOUT, async ()=>{
            this.user = undefined;
            this.scopes = undefined;
            this.accessToken = undefined;
            this.idToken = undefined;
            this.refreshToken = undefined;
            await this.authStore.clear();
        });
        this.synchronizer.OnBroadcastMessage(Events.USER_LOGIN, this.onUserLogin.bind(this));
    }
}

/**
 * Create OIDC client with initializing it. It resolves issuer metadata, jwks keys and check if user is
 * authenticated in OpenId Connect provider.
 */ function createOIDCClient(options) {
    return new OIDCClient(options).initialize();
}

export { AuthenticationError, EventEmitter, Events, InMemoryStateStore, InteractionCancelled, InvalidIdTokenError, InvalidJWTError, LocalStorageStateStore, OIDCClient, OIDCClientError, StateStore, createOIDCClient as default };
//# sourceMappingURL=oidc-client.esm.js.map
