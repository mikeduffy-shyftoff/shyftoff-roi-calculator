export const fmt = (n) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n);

export const fmtD = (n, d = 1) =>
  new Intl.NumberFormat("en-US", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  }).format(n);

export const fmtCur = (n) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);

export const fmtCurD = (n, d = 2) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  }).format(n);
