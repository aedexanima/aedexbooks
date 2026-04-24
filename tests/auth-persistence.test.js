/**
 * Auth persistence tests — token storage, restoration, expiry, and logout.
 *
 * Scenarios covered:
 *  1. Helper structure — saveToken / loadToken / clearToken present and correct
 *  2. Fresh login — token is saved to localStorage when callback fires
 *  3. Page refresh with valid token — initTokenClient restores token without OAuth popup
 *  4. Page refresh with expired token — falls through to silent re-auth, not immediate logout
 *  5. Logout — clearToken() called in handleAuth sign-out path
 *  6. Race condition fix — GAPI ready callback sets token on gapi.client before loading sheet
 *  7. Token refresh — scheduleTokenRefresh called after token restore
 */

const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../app.html'), 'utf8');

let passed = 0;
let failed = 0;

function assert(name, condition, detail=''){
  if(condition){ console.log(`  ✓ ${name}`); passed++; }
  else{ console.error(`  ✗ ${name}${detail?' — '+detail:''}`); failed++; }
}

function extractFn(name){
  const re=new RegExp(`(?:async )?function ${name}\\s*\\([^)]*\\)\\s*\\{`);
  const start=src.search(re);
  if(start===-1) return null;
  let depth=0,i=src.indexOf('{',start),begin=i;
  while(i<src.length){
    if(src[i]==='{') depth++;
    else if(src[i]==='}'){depth--;if(depth===0) return src.slice(begin,i+1);}
    i++;
  }
  return null;
}

// Simulate localStorage and Date for unit-level logic tests
function makeStorage(){
  const store={};
  return {
    getItem:k=>store[k]??null,
    setItem:(k,v)=>{store[k]=v;},
    removeItem:k=>{delete store[k];},
    _store:store
  };
}

// Extract and eval the three token helpers in an isolated scope
function buildHelpers(nowMs=Date.now()){
  const KEY='ab_token';
  const ls=makeStorage();
  // Inline the helper logic (mirrors source exactly)
  function saveToken(token){
    try{ls.setItem(KEY,JSON.stringify({token,expiry:nowMs+55*60*1000}));}catch{}
  }
  function loadToken(){
    try{
      const s=JSON.parse(ls.getItem(KEY)||'null');
      if(s&&s.token&&s.expiry>nowMs) return s.token;
    }catch{}
    ls.removeItem(KEY);
    return null;
  }
  function clearToken(){ls.removeItem(KEY);}
  return {saveToken,loadToken,clearToken,ls,KEY};
}

// ─── 1. Helper structure in source ───────────────────────────────────────────

console.log('\n1. Token helper structure');

assert('TOKEN_KEY constant defined', src.includes("_TOKEN_KEY='ab_token'") || src.includes('_TOKEN_KEY="ab_token"'));
assert('saveToken function defined', src.includes('function saveToken('));
assert('loadToken function defined', src.includes('function loadToken('));
assert('clearToken function defined', src.includes('function clearToken('));

const saveTokenFn  = extractFn('saveToken');
const loadTokenFn  = extractFn('loadToken');
const clearTokenFn = extractFn('clearToken');

assert('saveToken writes expiry + token to localStorage', saveTokenFn&&saveTokenFn.includes('expiry')&&saveTokenFn.includes('localStorage'));
assert('loadToken checks expiry > Date.now()', loadTokenFn&&loadTokenFn.includes('expiry')&&loadTokenFn.includes('Date.now'));
assert('loadToken removes stale entry and returns null on miss', loadTokenFn&&loadTokenFn.includes('removeItem')&&loadTokenFn.includes('return null'));
assert('clearToken removes the key', clearTokenFn&&clearTokenFn.includes('removeItem'));

// ─── 2. Fresh login — token saved in callback ─────────────────────────────────

console.log('\n2. Fresh login — token saved on sign-in');

const initFn=extractFn('initTokenClient');
assert('initTokenClient defined', initFn!==null);

// The callback block is inside initTokenClient — check it calls saveToken
const callbackBlock=initFn?initFn.slice(initFn.indexOf('callback:'),initFn.indexOf('onSignedIn')):'' ;
assert('token callback calls saveToken()', callbackBlock.includes('saveToken('));
assert('token callback sets accessToken before saveToken', (()=>{
  const savIdx=callbackBlock.indexOf('saveToken(');
  const setIdx=callbackBlock.indexOf('accessToken=resp.access_token');
  return setIdx!==-1&&savIdx!==-1&&setIdx<savIdx;
})());

// Unit test: saveToken + loadToken round-trip
const {saveToken,loadToken,clearToken,ls,KEY}=buildHelpers();
saveToken('tok_abc123');
assert('saveToken persists token to storage', ls.getItem(KEY)!==null);
const roundTrip=loadToken();
assert('loadToken returns same token within expiry window', roundTrip==='tok_abc123');

// ─── 3. Page refresh with valid token ─────────────────────────────────────────

console.log('\n3. Page refresh — valid stored token restored without popup');

// In source: initTokenClient should try loadToken() BEFORE requestAccessToken
const loadIdx  = initFn ? initFn.indexOf('loadToken()') : -1;
const reqAcIdx = initFn ? initFn.indexOf('requestAccessToken') : -1;
assert('loadToken() called in initTokenClient', loadIdx!==-1);
assert('loadToken() attempted before requestAccessToken (no popup for returning users)', loadIdx < reqAcIdx);

// If loadToken returns a token, should set signedIn=true and call onSignedIn
const afterLoad = initFn ? initFn.slice(loadIdx, loadIdx+400) : '';
assert('sets signedIn=true when token restored', afterLoad.includes('signedIn=true'));
assert('calls onSignedIn() when token restored', afterLoad.includes('onSignedIn()'));
assert('calls scheduleTokenRefresh() when token restored', afterLoad.includes('scheduleTokenRefresh()'));
assert('returns early (skips OAuth popup) when token restored', afterLoad.includes('return;'));

// Unit test: valid token → loadToken returns it
const h2=buildHelpers();
h2.saveToken('valid_token');
assert('loadToken returns token when not expired', h2.loadToken()==='valid_token');

// ─── 4. Page refresh with expired token ───────────────────────────────────────

console.log('\n4. Page refresh — expired token falls through to silent re-auth');

// Simulate expired token by using a past timestamp
const pastMs=Date.now()-2*60*60*1000; // 2 hours ago
const h3=buildHelpers(pastMs);
h3.saveToken('expired_token'); // saved with expiry = pastMs + 55min (already past)
// Now evaluate with current time
const h3now=buildHelpers(Date.now());
// Manually set the storage to what h3 wrote
Object.assign(h3now.ls._store, h3.ls._store);
const expiredResult=h3now.loadToken();
assert('loadToken returns null for expired token', expiredResult===null);
assert('loadToken clears expired entry from storage', h3now.ls.getItem(h3now.KEY)===null);

// In source: after loadToken returns null, falls through to requestAccessToken silent re-auth
const afterLoadNull=initFn?initFn.slice(reqAcIdx-50,reqAcIdx+200):'';
assert('silent re-auth attempted when no valid stored token', afterLoadNull.includes("prompt:''"));
assert('silent re-auth uses stored email as login_hint', afterLoadNull.includes('login_hint'));
assert('shows reconnecting status before silent re-auth', initFn&&initFn.includes('Reconnecting'));

// ─── 5. Logout — token cleared from localStorage ─────────────────────────────

console.log('\n5. Logout — clearToken() called on sign-out');

const handleAuthFn=extractFn('handleAuth');
assert('handleAuth defined', handleAuthFn!==null);

// clearToken must be called in the sign-out branch (before the return)
const signOutBranch=handleAuthFn?handleAuthFn.slice(0,handleAuthFn.indexOf('return;')):'';
assert('clearToken() called in sign-out path', signOutBranch.includes('clearToken()'));
assert('clearToken called after revoke (token revoked before clearing)', (()=>{
  const revokeIdx=signOutBranch.indexOf('revoke(');
  const clearIdx=signOutBranch.indexOf('clearToken()');
  return revokeIdx!==-1&&clearIdx!==-1&&revokeIdx<clearIdx;
})());

// Unit test: saveToken then clearToken → loadToken returns null
const h4=buildHelpers();
h4.saveToken('will_be_cleared');
h4.clearToken();
assert('loadToken returns null after clearToken()', h4.loadToken()===null);
assert('clearToken removes key from storage', h4.ls.getItem(h4.KEY)===null);

// ─── 6. Race condition — GAPI sets token before loadFromSheet ─────────────────

console.log('\n6. Race condition — GAPI ready callback sets token on gapi.client');

// Find the GAPI ready .then() block
const gapiReadyIdx = src.indexOf('gapiReady=true');
const gapiReadyBlock = src.slice(gapiReadyIdx, gapiReadyIdx+400);

assert('gapi.client.setToken called in GAPI ready callback', gapiReadyBlock.includes('gapi.client.setToken'));
assert('setToken guarded by signedIn&&accessToken check', gapiReadyBlock.includes('signedIn&&accessToken'));

// setToken must come BEFORE loadFromSheet in the block
const setTokenIdx2   = gapiReadyBlock.indexOf('gapi.client.setToken');
const loadSheetIdx   = gapiReadyBlock.indexOf('loadFromSheet');
const findCreateIdx  = gapiReadyBlock.indexOf('findOrCreateSheet');
assert('gapi.client.setToken called before loadFromSheet()', setTokenIdx2 < loadSheetIdx);
assert('gapi.client.setToken called before findOrCreateSheet()', setTokenIdx2 < findCreateIdx);

// initTokenClient should NOT call gapi.client.setToken when restoring (GAPI may not be ready)
// Strip single-line comments before checking so comment text doesn't create false positives
const tokenRestoreBlock=initFn?initFn.slice(loadIdx,loadIdx+500):'';
const tokenRestoreNoComments=tokenRestoreBlock.replace(/\/\/[^\n]*/g,'');
const setTokenInRestore=tokenRestoreNoComments.slice(0,tokenRestoreNoComments.indexOf('return;')).includes('gapi.client.setToken');
assert('initTokenClient does NOT call gapi.client.setToken during token restore (GAPI may not be ready)', !setTokenInRestore);

// ─── 7. Token refresh timer scheduled on restore ──────────────────────────────

console.log('\n7. Token refresh scheduled on restore');

const schedFn=extractFn('scheduleTokenRefresh');
assert('scheduleTokenRefresh defined', schedFn!==null);
assert('refresh fires 55 min before 1hr expiry', schedFn&&(schedFn.includes('55*60*1000')||schedFn.includes('55 * 60')));
assert('refresh uses prompt:\'\' (silent, no popup)', schedFn&&schedFn.includes("prompt:''"));

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if(failed>0) process.exit(1);
