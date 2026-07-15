import axios from 'axios';

const defaultApiBaseUrl = import.meta.env.DEV
  ? '/api'
  : 'https://social-run-backend.vercel.app/api';

export const API_BASE_URL = (import.meta.env.VITE_API_URL || defaultApiBaseUrl).replace(/\/$/, '');
export const SOCKET_URL = (import.meta.env.VITE_SOCKET_URL || (import.meta.env.DEV
  ? 'http://localhost:5000'
  : 'https://social-run-backend.vercel.app')).replace(/\/$/, '');

const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      const path = window.location.pathname;
      const isAuthCheckRequest = error.config?.url === '/auth/me';
      if (path !== '/' && path !== '/login' && path !== '/signup' && !isAuthCheckRequest) {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

export default api;
