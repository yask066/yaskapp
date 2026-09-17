import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { followUser, getPublicProfile, listUserPolls, unfollowUser } from '../../api/profiles';
import type { FollowRelationship, PublicProfile } from '../../api/models';
import { useSession } from '../../app/session-provider';
import { AsyncState } from '../../components/AsyncState';
import { Avatar } from '../../components/Avatar';
import { PollCard } from '../../components/PollCard';

function replaceFollowState(profile: PublicProfile, relationship: FollowRelationship): PublicProfile { return { ...profile, viewerIsFollowing: relationship.following, profile: { ...profile.profile, followersCount: relationship.followeeFollowersCount } }; }

export function PublicProfilePage() {
  const { userId = '' } = useParams(); const { status, user } = useSession(); const queryClient = useQueryClient(); const navigate = useNavigate();
  const profileQuery = useQuery({ queryKey: ['profile', userId], queryFn: () => getPublicProfile(userId), enabled: Boolean(userId) && status !== 'loading' });
  const pollsQuery = useQuery({ queryKey: ['user-polls', userId], queryFn: () => listUserPolls(userId), enabled: Boolean(userId) && status !== 'loading' });
  const followMutation = useMutation({ mutationFn: (following: boolean) => following ? unfollowUser(userId) : followUser(userId), onSuccess: (relationship) => queryClient.setQueryData<PublicProfile>(['profile', userId], (profile) => profile ? replaceFollowState(profile, relationship) : profile) });
  if (user?.id === userId) return <Navigate to="/me" replace />;
  if (profileQuery.isPending) return <main id="main-content"><AsyncState state="loading" /></main>;
  if (profileQuery.isError || !profileQuery.data) return <main id="main-content"><AsyncState state="error" error={profileQuery.error} onRetry={() => void profileQuery.refetch()} /></main>;
  const profile = profileQuery.data; const name = profile.profile.displayName || profile.username;
  return <main id="main-content" className="profile-page">
    <section className="profile-header" aria-labelledby="profile-name">
      <Avatar name={name} src={profile.profile.avatarUrl} size={72} />
      <div><h1 id="profile-name">{name}</h1><p>@{profile.username}</p>{profile.profile.bio ? <p>{profile.profile.bio}</p> : null}{profile.profile.countryCode ? <p>Country: {profile.profile.countryCode}</p> : null}</div>
      <div className="profile-actions">{status === 'anonymous' ? <Link className="button" to={`/login?next=${encodeURIComponent(`/users/${userId}`)}`}>Login to follow</Link> : null}{user ? <button className="button" type="button" aria-pressed={profile.viewerIsFollowing} disabled={followMutation.isPending} onClick={() => followMutation.mutate(profile.viewerIsFollowing)}>{profile.viewerIsFollowing ? 'Following' : 'Follow'}</button> : null}<p className="profile-summary">{profile.profile.pollsCount} polls · {profile.profile.followersCount} followers · {profile.profile.followingCount} following</p></div>
    </section>
    <dl className="profile-stats" aria-label="Profile statistics"><div><dt>Polls</dt><dd>{profile.profile.pollsCount}</dd></div><div><dt>Followers</dt><dd>{profile.profile.followersCount}</dd></div><div><dt>Following</dt><dd>{profile.profile.followingCount}</dd></div></dl>
    {followMutation.isError ? <p role="alert">{followMutation.error instanceof Error ? followMutation.error.message : 'Could not update follow status.'}</p> : null}
    <section className="profile-polls" role="region" aria-label={`Polls by ${name}`}><h2 id="authored-polls">Polls by {name}</h2>{pollsQuery.isPending ? <AsyncState state="loading" /> : null}{pollsQuery.isError ? <AsyncState state="error" error={pollsQuery.error} onRetry={() => void pollsQuery.refetch()} /> : null}{pollsQuery.data?.map((poll) => <PollCard key={poll.id} poll={poll} viewerId={user?.id} onOpenComments={(openedPoll) => navigate(`/polls/${openedPoll.id}`)} />)}</section>
  </main>;
}
