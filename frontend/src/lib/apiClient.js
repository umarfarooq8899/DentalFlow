const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api/v1';

let isRefreshing = false;
let refreshSubscribers = [];

function subscribeTokenRefresh(cb) {
  refreshSubscribers.push(cb);
}

function onRefreshed(token) {
  refreshSubscribers.forEach((cb) => cb(token));
  refreshSubscribers = [];
}

export const apiClient = {
  getAccessToken() {
    return localStorage.getItem('accessToken');
  },

  getRefreshToken() {
    return localStorage.getItem('refreshToken');
  },

  setTokens(accessToken, refreshToken) {
    if (accessToken) localStorage.setItem('accessToken', accessToken);
    if (refreshToken) localStorage.setItem('refreshToken', refreshToken);
  },

  clearTokens() {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
  },

  async request(endpoint, options = {}) {
    const url = `${API_BASE_URL}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    const token = apiClient.getAccessToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    let response = await fetch(url, {
      ...options,
      headers,
    });

    // Handle 401 Unauthorized -> Attempt token refresh
    if (response.status === 401 && !options._retry && !endpoint.includes('/auth/')) {
      options._retry = true;
      const currentRefreshToken = apiClient.getRefreshToken();

      if (!currentRefreshToken) {
        apiClient.clearTokens();
        window.dispatchEvent(new Event('auth:unauthorized'));
        throw new Error('Session expired. Please log in again.');
      }

      if (!isRefreshing) {
        isRefreshing = true;

        try {
          const refreshRes = await fetch(`${API_BASE_URL}/auth/refresh`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken: currentRefreshToken }),
          });

          if (!refreshRes.ok) {
            throw new Error('Refresh failed');
          }

          const refreshData = await refreshRes.json();
          const { accessToken, refreshToken: newRefreshToken } = refreshData.data;

          apiClient.setTokens(accessToken, newRefreshToken);
          onRefreshed(accessToken);
          isRefreshing = false;

          headers['Authorization'] = `Bearer ${accessToken}`;
          return fetch(url, { ...options, headers }).then((res) => res.json());
        } catch (err) {
          isRefreshing = false;
          apiClient.clearTokens();
          window.dispatchEvent(new Event('auth:unauthorized'));
          throw new Error('Session expired. Please log in again.');
        }
      } else {
        // Wait for active refresh to complete
        return new Promise((resolve) => {
          subscribeTokenRefresh((newToken) => {
            headers['Authorization'] = `Bearer ${newToken}`;
            resolve(fetch(url, { ...options, headers }).then((res) => res.json()));
          });
        });
      }
    }

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const errorMsg = data?.error?.message || `HTTP error ${response.status}`;
      const err = new Error(errorMsg);
      err.code = data?.error?.code;
      err.details = data?.error?.details;
      err.status = response.status;
      throw err;
    }

    return data;
  },

  get(endpoint, options) {
    return this.request(endpoint, { ...options, method: 'GET' });
  },

  post(endpoint, body, options) {
    return this.request(endpoint, {
      ...options,
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  put(endpoint, body, options) {
    return this.request(endpoint, {
      ...options,
      method: 'PUT',
      body: JSON.stringify(body),
    });
  },

  delete(endpoint, options) {
    return this.request(endpoint, { ...options, method: 'DELETE' });
  },
};
