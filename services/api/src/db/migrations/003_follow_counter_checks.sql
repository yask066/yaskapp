ALTER TABLE profiles
  ADD CONSTRAINT profiles_polls_count_non_negative_check
    CHECK (polls_count >= 0),
  ADD CONSTRAINT profiles_followers_count_non_negative_check
    CHECK (followers_count >= 0),
  ADD CONSTRAINT profiles_following_count_non_negative_check
    CHECK (following_count >= 0);
