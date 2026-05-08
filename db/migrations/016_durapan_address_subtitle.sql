-- Penrod (durapan): фактический адрес и единый подзаголовок карточки (как у других организаций).

UPDATE organization_profiles
SET
  address_text = 'г. Железнодорожный, ул. Гидрогородок д.15',
  updated_at = now()
WHERE org_id = 'durapan';

UPDATE organizations
SET
  subtitle = '+7 (495) 663-93-29' || E'\n' || 'penrod@penrod.ru' || E'\n' ||
    'г. Железнодорожный, ул. Гидрогородок д.15',
  updated_at = now()
WHERE id = 'durapan';

-- Убрать подписи-дубли типа «Телефон» / «E-mail» / «Сайт» — в сайдбаре остаются только значения.
UPDATE organization_public_contacts
SET contact_label = NULL
WHERE org_id = 'durapan'
  AND contact_type IN ('phone', 'email', 'website');
