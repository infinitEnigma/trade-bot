export const getWebSocketUrl = (): string => {
    return import.meta.env.VITE_WEBSOCKET_URL || "http://localhost";
};
