ALTER TABLE profiles
  ADD COLUMN country_code CHAR(2);

ALTER TABLE profiles
  ADD CONSTRAINT profiles_country_code_format_check
  CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$');
