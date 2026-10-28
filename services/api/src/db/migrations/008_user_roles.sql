CREATE TYPE user_role AS ENUM ('user', 'moderator', 'superadmin');

ALTER TABLE users
  ADD COLUMN role user_role NOT NULL DEFAULT 'user';

CREATE INDEX users_role_status_created_at_idx
  ON users (role, status, created_at DESC);
