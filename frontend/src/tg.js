// Telegram's own script (loaded in index.html) provides window.Telegram.WebApp
const tg = window.Telegram?.WebApp;
const noop = () => {};

const WebApp = tg || {
  initData: "",
  ready: noop,
  expand: noop,
  openLink: (u) => window.open(u, "_blank"),
  openTelegramLink: (u) => window.open(u, "_blank"),
  HapticFeedback: { notificationOccurred: noop },
  BackButton: { show: noop, hide: noop, onClick: noop, offClick: noop },
};

export default WebApp;