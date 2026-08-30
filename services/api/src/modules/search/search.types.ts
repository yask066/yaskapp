import type { Poll, PollOption } from '../polls/polls.repository.js';
import type { PublicProfile } from '../profiles/profiles.repository.js';

export type SearchType = 'all' | 'polls' | 'users';
export type SearchSort = 'relevance' | 'newest' | 'popular';

export type SearchCursor = {
  score?: number;
  createdAt: string;
  id: string;
  query?: string;
  type?: SearchType;
  sort?: SearchSort;
};

export type SearchInput = {
  viewerId: string;
  query: string;
  type: SearchType;
  sort: SearchSort;
  cursor?: SearchCursor;
  limit: number;
};

export type SearchPollRow = {
  id: string;
  author_id: string;
  author_username: string;
  author_display_name: string;
  author_avatar_object_key: string | null;
  question: string;
  description: string | null;
  image_object_key: string | null;
  visibility: 'public';
  options_count: number;
  votes_count: number;
  comments_count: number;
  likes_count: number;
  allow_vote_cancellation: boolean;
  options: PollOption[];
  created_at: Date;
  updated_at: Date;
  ends_at: Date | null;
  score: number;
};

export type SearchUserRow = {
  id: string;
  username: string;
  status: 'active';
  created_at: Date;
  updated_at: Date;
  display_name: string;
  bio: string | null;
  country_code: string | null;
  avatar_object_key: string | null;
  polls_count: number;
  followers_count: number;
  following_count: number;
  viewer_is_following: boolean;
  score: number;
};

export type SearchPollRecord = { poll: Poll; score: number };
export type SearchUserRecord = { user: PublicProfile; score: number };

export type SearchResult =
  | { type: 'poll'; poll: Poll; score: number }
  | { type: 'user'; user: PublicProfile; score: number };

export type SearchPage = {
  items: SearchResult[];
  nextCursor: string | null;
};
