import client from "./client";

// Resolves to { notifications, unreadCount }
export const listNotificationsRequest = () => client.get("/notifications").then((r) => r.data);

export const unreadCountRequest = () => client.get("/notifications/unread-count").then((r) => r.data.unreadCount);

export const markNotificationReadRequest = (id) => client.post(`/notifications/${id}/read`);

export const markAllNotificationsReadRequest = () => client.post("/notifications/read-all");