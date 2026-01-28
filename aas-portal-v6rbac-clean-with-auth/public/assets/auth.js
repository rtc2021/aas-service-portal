/**
 * AAS Portal - Auth0 Authentication Module
 * Role-based access control
 */

const AUTH_CONFIG = {
  domain: 'dev-sug5bhfoekw1qquv.us.auth0.com',
  clientId: 'GKz9sYl80XVddHTTRKe82QFUpd85cl1W',
  audience: 'https://api.aas-portal.com',
  namespace: 'https://aas-portal.com'
};

// Page access rules by role
const PAGE_ACCESS = {
  '/': { roles: ['Admin'], redirect: '/tech/parts' }, // Dashboard = Admin only, others go to parts
  '/tech/command': { roles: ['Admin'], redirect: '/tech/parts' },
  '/tech/parts': { roles: ['Admin', 'Tech'] },
  '/tech/manuals': { roles: ['Admin', 'Tech'] },
  '/tech/doors': { roles: ['Admin', 'Tech'] },
  '/door': { roles: ['Admin', 'Tech', 'Customer'] },
  '/service': { roles: ['Admin', 'Tech', 'Customer'] },
  '/customer': { roles: ['Admin', 'Customer'] },
};

const CDN_URLS = [
  'https://cdn.auth0.com/js/auth0-spa-js/2.1/auth0-spa-js.production.js',
  'https://cdn.jsdelivr.net/npm/@auth0/auth0-spa-js@2.1.3/dist/auth0-spa-js.production.js',
  'https://unpkg.com/@auth0/auth0-spa-js@2.1.3/dist/auth0-spa-js.production.js'
];

let auth0Client = null;
let sdkLoaded = false;

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
  for (const url of CDN_URLS) {
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

async function initAuth() {
  if (auth0Client) return auth0Client;
  const loaded = await loadAuth0SDK();
  if (!loaded) {
    console.error('[Auth] Failed to load Auth0 SDK');
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

// Check if user has access to current page
function checkPageAccess(roles) {
  const path = window.location.pathname;
  
  // Find matching rule
  let rule = PAGE_ACCESS[path];
  
  // Try prefix match for nested paths
  if (!rule) {
    for (const [key, value] of Object.entries(PAGE_ACCESS)) {
      if (path.startsWith(key) && key !== '/') {
        rule = value;
        break;
      }
    }
  }
  
  if (!rule) return { allowed: true }; // No rule = allow
  
  const hasAccess = rule.roles.some(r => roles.includes(r));
  return {
    allowed: hasAccess,
    redirect: rule.redirect
  };
}

// Get default landing page for role
function getDefaultPage(roles) {
  if (roles.includes('Admin')) return '/';
  if (roles.includes('Tech')) return '/tech/parts';
  if (roles.includes('Customer')) return '/customer';
  return '/';
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
  
  // Navigation visibility
  const mainNav = document.getElementById('mainNav');
  const adminNav = document.getElementById('adminNav');
  const techNav = document.getElementById('techNav');
  const customerNav = document.getElementById('customerNav');
  
  // Main section (Dashboard) - Admin only
  if (mainNav) mainNav.style.display = isAdmin ? 'block' : 'none';
  
  // Admin section (Command Center)
  if (adminNav) adminNav.style.display = isAdmin ? 'block' : 'none';
  
  // Tech section (Parts, Manuals, Door Browser) - visible to Admin and Tech
  if (techNav) techNav.style.display = (authenticated && (isAdmin || isTech)) ? 'block' : 'none';
  
  // Customer section - visible to Admin and Customer
  if (customerNav) customerNav.style.display = (authenticated && (isAdmin || isCustomer)) ? 'block' : 'none';
  
  // Hide specific nav items based on role
  const commandCenterLink = document.querySelector('a[href="/tech/command"]');
  if (commandCenterLink) {
    commandCenterLink.style.display = isAdmin ? 'flex' : 'none';
  }
  
  // Dashboard link - Admin only
  const dashboardLink = document.querySelector('a[href="/"]');
  if (dashboardLink && dashboardLink.textContent.trim() === 'Dashboard') {
    dashboardLink.style.display = isAdmin ? 'flex' : 'none';
  }
  
  return { authenticated, user, roles };
}

async function updateAuthOverlay() {
  const overlay = document.getElementById('authOverlay');
  const loadingText = document.getElementById('authLoadingText');
  const authLoginBtn = document.getElementById('authLoginBtn');
  const accessDenied = document.getElementById('accessDenied');
  const authCard = document.querySelector('.auth-card');
  
  if (!overlay) return;
  
  const authenticated = await isAuthenticated();
  const roles = authenticated ? await getUserRoles() : [];
  
  if (!authenticated) {
    // Not logged in - show login
    overlay.classList.remove('hidden');
    if (loadingText) loadingText.style.display = 'none';
    if (accessDenied) accessDenied.style.display = 'none';
    if (authLoginBtn) {
      authLoginBtn.style.display = 'inline-flex';
      authLoginBtn.onclick = () => login();
    }
    return;
  }
  
  // Check page access
  const access = checkPageAccess(roles);
  
  if (access.allowed) {
    overlay.classList.add('hidden');
  } else {
    // Access denied - redirect or show message
    if (access.redirect) {
      window.location.href = access.redirect;
    } else {
      // Show access denied
      overlay.classList.remove('hidden');
      if (authCard) {
        authCard.innerHTML = `
          <h1 class="auth-title">Access Denied</h1>
          <p class="auth-subtitle">You don't have permission to access this page.</p>
          <p class="auth-subtitle">Your role: <strong>${roles.join(', ') || 'None'}</strong></p>
          <button class="auth-btn" onclick="window.location.href='${getDefaultPage(roles)}'">
            Go to Home
          </button>
          <button class="auth-btn" style="background:#ff4757; margin-top:10px;" onclick="window.AASAuth.logout()">
            Sign Out
          </button>
        `;
      }
    }
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  await initAuth();
  await updateAuthUI();
  await updateAuthOverlay();
  
  document.getElementById('loginBtn')?.addEventListener('click', (e) => { e.preventDefault(); login(); });
  document.getElementById('logoutBtn')?.addEventListener('click', (e) => { e.preventDefault(); logout(); });
});

window.AASAuth = { 
  init: initAuth, 
  login, 
  logout, 
  isAuthenticated, 
  getUser, 
  getUserRoles, 
  getAccessToken, 
  updateAuthUI,
  checkPageAccess,
  getDefaultPage
};
