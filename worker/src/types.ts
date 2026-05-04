export type Hyperdrive = { connectionString: string };

export interface Env {
  HYPERDRIVE?: Hyperdrive;
  /** Только для `wrangler dev` через `.dev.vars`. В проде — Hyperdrive. */
  DATABASE_URL?: string;
  ALLOWED_ORIGIN?: string;
  /** Публичный URL сайта (редиректы после OAuth / верификации). По умолчанию ALLOWED_ORIGIN или katalog-uslug.pro */
  PUBLIC_SITE_URL?: string;
  /** Подпись OTP/SMS (обязательно задать в проде). */
  AUTH_PEPPER?: string;
  /** Resend: отправка писем подтверждения / сброса пароля */
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  /** Только dev: в ответе register вернуть ссылку подтверждения вместо отправки письма */
  DEV_RETURN_EMAIL_LINK?: string;
  /** SMS.RU api_id */
  SMSRU_API_ID?: string;
  /** Служебный ключ для bootstrap-входа разработчика (опционально) */
  DEV_BOOTSTRAP_KEY?: string;
  YANDEX_CLIENT_ID?: string;
  YANDEX_CLIENT_SECRET?: string;
  /** Зарегистрированный в приложении Яндекс redirect URI (должен совпадать с callback URL воркера) */
  YANDEX_REDIRECT_URI?: string;
  /** ЕСИА: после получения доступа от Госуслуг — client_id, discovery URL и т.д. */
  ESIA_CLIENT_ID?: string;
  ESIA_REDIRECT_URI?: string;
  /** Включить реальные маршруты ЕСИА (обмен кода); до готовности не ставить в прод. */
  ESIA_FULL_IMPLEMENTATION?: string;
}
