export const getWebSocketUrl = (): string => {
    const baseUrl = import.meta.env.VITE_WEBSOCKET_URL || "http://localhost";
    // Convert http:// to ws:// and https:// to wss://
    // return baseUrl.replace(/^http(s)?:\/\//, (_: string, ssl: string | undefined) => ssl ? "wss://" : "ws://");
    return baseUrl;
};
