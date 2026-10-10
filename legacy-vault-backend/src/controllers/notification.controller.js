const notificationService = require("../services/notification.service");

async function list(req, res, next) {
  try {
    const { notifications, unreadCount } = await notificationService.listNotifications(req.user.sub);
    res.status(200).json({ notifications, unreadCount });
  } catch (err) {
    next(err);
  }
}

async function unreadCount(req, res, next) {
  try {
    const count = await notificationService.countUnread(req.user.sub);
    res.status(200).json({ unreadCount: count });
  } catch (err) {
    next(err);
  }
}

async function markRead(req, res, next) {
  try {
    await notificationService.markRead(req.user.sub, req.params.id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

async function markAllRead(req, res, next) {
  try {
    await notificationService.markAllRead(req.user.sub);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

module.exports = { list, unreadCount, markRead, markAllRead };