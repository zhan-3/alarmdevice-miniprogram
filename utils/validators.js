// 手机号：1开头，第二位3-9，共11位
export const PHONE_REGEX = /^1[3-9]\d{9}$/;

// 设备SN码：大写字母、数字、短横线或下划线，1-32位（与后端及微信 scene 限制一致）
export const SN_REGEX = /^[A-Z0-9_-]{1,32}$/;

export function isValidPhone(phone) {
  return PHONE_REGEX.test(phone);
}

export function isValidSN(sn) {
  return SN_REGEX.test(sn);
}
