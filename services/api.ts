
const API_URL = '/api';

export const api = {
    auth: {
        signup: async (data: any) => {
            const res = await fetch(`${API_URL}/auth/signup`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });
            return res.json();
        },
        login: async (data: any) => {
            const res = await fetch(`${API_URL}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });
            return res.json();
        },
        logout: async () => {
            const res = await fetch(`${API_URL}/auth/logout`, {
                method: 'POST',
            });
            return res.json();
        },
        me: async () => {
            const res = await fetch(`${API_URL}/auth/me`);
            if (res.status === 401) return null;
            return res.json();
        },
    },
};
