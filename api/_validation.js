export class HttpError extends Error {
  constructor(status, message, details = undefined) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export function requireObject(value, name = "请求数据") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, `${name}必须是对象。`);
  }
  return value;
}

export function validateDay(value) {
  const day = Number(value);
  if (!Number.isInteger(day) || day < 1 || day > 30) throw new HttpError(400, "day 必须是 1 到 30 的整数。");
  return day;
}

export function validateIndex(value) {
  const index = Number(value);
  if (!Number.isInteger(index) || index < 0 || index > 99) throw new HttpError(400, "图片序号无效。");
  return index;
}

export function validateVersion(value) {
  const version = Number(value);
  if (!Number.isInteger(version) || version < 0) throw new HttpError(400, "version 必须是非负整数。");
  return version;
}

export function validatePatch(body) {
  requireObject(body);
  const changes = requireObject(body.changes, "changes");
  if (Object.keys(changes).length === 0) throw new HttpError(400, "changes 不能为空。");
  return { version: validateVersion(body.version), changes };
}

export function validateString(value, name, max = 200) {
  if (typeof value !== "string" || value.length > max) throw new HttpError(400, `${name}格式无效。`);
  return value;
}
