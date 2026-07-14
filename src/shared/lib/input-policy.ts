export const MAX_TEXT_LENGTH = 10_000;
export const MAX_NAME_LENGTH = 200;
export const MAX_URL_LENGTH = 2_048;

export type ProductUrlValidation =
  | { ok: true; url: string }
  | { ok: false; message: string };

export function validateProductUrl(value: string): ProductUrlValidation {
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, url: "" };
  if (trimmed.length > MAX_URL_LENGTH) return { ok: false, message: `제품 URL은 ${MAX_URL_LENGTH.toLocaleString("ko-KR")}자 이하여야 합니다.` };
  try {
    const url = new URL(trimmed);
    if (!["http:", "https:"].includes(url.protocol)) return { ok: false, message: "제품 URL은 HTTP 또는 HTTPS 주소여야 합니다." };
    if (url.username || url.password) return { ok: false, message: "사용자 이름이나 비밀번호가 포함된 URL은 사용할 수 없습니다." };
    return { ok: true, url: url.toString() };
  } catch {
    return { ok: false, message: "제품 URL 형식을 확인하세요." };
  }
}
