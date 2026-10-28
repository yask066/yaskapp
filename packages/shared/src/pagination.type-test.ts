import type {
  CreatePollCommentRequest,
  CursorPage,
  ListPollCommentRepliesResponse,
  ListPollCommentsResponse,
  ListPollsResponse,
  Poll,
  PollComment
} from './index.js';

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? true
    : false;
type Expect<Value extends true> = Value;
type IsRequired<Type, Key extends keyof Type> = {} extends Pick<Type, Key> ? false : true;
type IsOptional<Type, Key extends keyof Type> = {} extends Pick<Type, Key> ? true : false;

type PaginationContractChecks = [
  Expect<IsRequired<CursorPage<unknown>, 'nextCursor'>>,
  Expect<Equal<CursorPage<unknown>['nextCursor'], string | null>>,
  Expect<Equal<ListPollsResponse, CursorPage<Poll>>>,
  Expect<Equal<ListPollCommentsResponse, CursorPage<PollComment>>>,
  Expect<Equal<ListPollCommentRepliesResponse, CursorPage<PollComment>>>,
  Expect<IsRequired<PollComment, 'viewerHasLiked'>>,
  Expect<Equal<PollComment['viewerHasLiked'], boolean>>,
  Expect<IsRequired<PollComment, 'parentCommentId'>>,
  Expect<Equal<PollComment['parentCommentId'], string | null>>,
  Expect<IsRequired<PollComment, 'repliesCount'>>,
  Expect<Equal<PollComment['repliesCount'], number>>,
  Expect<IsOptional<CreatePollCommentRequest, 'parentCommentId'>>,
  Expect<Equal<CreatePollCommentRequest['parentCommentId'], string | undefined>>,
  Expect<{ body: string } extends CreatePollCommentRequest ? true : false>,
  Expect<{ body: string; parentCommentId: string } extends CreatePollCommentRequest ? true : false>
];
