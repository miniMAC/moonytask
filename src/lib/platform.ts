// su Android/iOS alcune funzioni desktop (export su cartella, watcher app)
// non hanno senso: le viste le nascondono in base a questo flag
export const isMobilePlatform = /Android|iPhone|iPad/i.test(
  navigator.userAgent,
);
