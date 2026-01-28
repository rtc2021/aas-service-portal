/**
 * AAS Portal - Auth0 Authentication Module
 * Uses dynamic SDK loading for reliability
 */

const AUTH_CONFIG = {
  domain: 'dev-sug5bhfoekw1qquv.us.auth0.com',
  clientId: 'GKz9sYl80XVddHTTRKe82QFUpd85cl1W',
  audience: 'https://api.aas-portal.com',
  namespace: 'https://aas-portal.com'
};

// CDN URLs to try
const CDN_URLS = [
  'https://cdn.auth0.com/js/auth0-spa-js/2.1/auth0-spa-js.production.js',
  'https://cdn.jsdelivr.net/npm/@auth0/auth0-spa-js@2.1.3/dist/auth0-spa-js.production.js',
  'https://unpkg.com/@auth0/auth0-spa-js@2.1.3/dist/auth0-spa-js.production.js'
];

let auth0Client = null;
let sdkLoaded = false;

// Load SDK dynamically
function loadScript(url) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = url;
    script.onload = () => resolve(url);
    script.onerror = () => reject(url);
    document.head.appendChild(script);
  });
}

async function loadAuth0SDK() {
  if (sdkLoaded) return true;
  
  for (let i = 0; i < CDN_URLS.length; i++) {
    const url = CDN_URLS[i];
    try {
      await loadScript(url);
      await new Promise(r => setTimeout(r, 300));
      
      if (typeof createAuth0Client === 'function') {
        sdkLoaded = true;
        return true;
      } else if (typeof window.auth0 !== 'undefined' && typeof window.auth0.createAuth0Client === 'function') {
        window.createAuth0Client = window.auth0.createAuth0Client;
        sdkLoaded = true;
        return true;
      }
    } catch (e) {
      console.warn('[Auth] CDN failed:', url);
    }
  }
  return false;
}

// Initialize Auth0 client
async function initAuth() {
  if (auth0Client) return auth0Client;
  
  // Load SDK first
  const loaded = await loadAuth0SDK();
  if (!loaded) {
    console.error('[Auth] Failed to load Auth0 SDK from all CDNs');
    return null;
  }
  
  try {
    auth0Client = await createAuth0Client({
      domain: AUTH_CONFIG.domain,
      clientId: AUTH_CONFIG.clientId,
      authorizationParams: {
        redirect_uri: window.location.origin,
        audience: AUTH_CONFIG.audience
      },
      cacheLocation: 'localstorage',
      useRefreshTokens: true
    });
    
    // Handle callback
    if (window.location.search.includes('code=') && window.location.search.includes('state=')) {
      await auth0Client.handleRedirectCallback();
      window.history.replaceState({}, document.title, window.location.pathname);
    }
    
    return auth0Client;
  } catch (error) {
    console.error('[Auth] Init error:', error);
    return null;
  }
}

async function login() {
  const client = await initAuth();
  if (client) await client.loginWithRedirect();
}

async function logout() {
  const client = await initAuth();
  if (client) client.logout({ logoutParams: { returnTo: window.location.origin } });
}

async function isAuthenticated() {
  const client = await initAuth();
  return client ? await client.isAuthenticated() : false;
}

async function getUser() {
  const client = await initAuth();
  if (!client) return null;
  if (!(await client.isAuthenticated())) return null;
  return await client.getUser();
}

async function getUserRoles() {
  const client = await initAuth();
  if (!client) return [];
  try {
    const claims = await client.getIdTokenClaims();
    return claims?.[`${AUTH_CONFIG.namespace}/roles`] || [];
  } catch (e) { return []; }
}

async function getAccessToken() {
  const client = await initAuth();
  if (!client) return null;
  try {
    return await client.getTokenSilently();
  } catch (e) { return null; }
}

async function updateAuthUI() {
  const authenticated = await isAuthenticated();
  const user = authenticated ? await getUser() : null;
  const roles = authenticated ? await getUserRoles() : [];
  
  const loginBtn = document.getElementById('loginBtn');
  const logoutBtn = document.getElementById('logoutBtn');
  const userBadge = document.getElementById('userBadge');
  const userName = document.getElementById('userName');
  const userRole = document.getElementById('userRole');
  const userAvatar = document.getElementById('userAvatar');
  
  if (loginBtn) loginBtn.style.display = authenticated ? 'none' : 'flex';
  if (logoutBtn) logoutBtn.style.display = authenticated ? 'flex' : 'none';
  if (userBadge) userBadge.style.display = authenticated ? 'flex' : 'none';
  
  if (user && userName) userName.textContent = user.name || user.email || 'User';
  if (user && userAvatar) userAvatar.textContent = (user.name || user.email || 'U').charAt(0).toUpperCase();
  if (userRole) userRole.textContent = roles.length > 0 ? roles[0] : 'No role';
  
  const isAdmin = roles.includes('Admin');
  const isTech = roles.includes('Tech');
  const isCustomer = roles.includes('Customer');
  
  const techNav = document.getElementById('techNav');
  const customerNav = document.getElementById('customerNav');
  
  if (techNav) techNav.style.display = (authenticated && (isAdmin || isTech)) ? 'block' : 'none';
  if (customerNav) customerNav.style.display = (authenticated && (isAdmin || isCustomer)) ? 'block' : 'none';
  
  return { authenticated, user, roles };
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', async () => {
  await initAuth();
  await updateAuthUI();
  
  document.getElementById('loginBtn')?.addEventListener('click', (e) => { e.preventDefault(); login(); });
  document.getElementById('logoutBtn')?.addEventListener('click', (e) => { e.preventDefault(); logout(); });
});

// Export
window.AASAuth = { init: initAuth, login, logout, isAuthenticated, getUser, getUserRoles, getAccessToken, updateAuthUI };
