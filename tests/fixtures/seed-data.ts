export const TEST_EMAIL = 'user@test.dev';
export const ADMIN_EMAIL = 'admin@test.dev';

export const profileRow = (over: Record<string, unknown> = {}) => ({
  email: TEST_EMAIL,
  is_premium: false,
  is_admin: false,
  sms_enabled: false,
  phone_number: null,
  nickname: 'Tester',
  friend_session_notifs: true,
  notify_friends_on_confirm: true,
  avatar_url: null,
  contribution_points: 0,
  premium_until: null,
  digest_enabled: false,
  ...over,
});

// friendships: one accepted + one pending-incoming for the signed-in user
export const friendshipsRows = (email: string) => [
  { id: 'f1', requester: 'ruben@test.dev', recipient: email, status: 'accepted' },
  { id: 'f2', requester: 'nikite@test.dev', recipient: email, status: 'pending' },
];

// public_profiles rows for nickname display
export const publicProfileRows = [
  { email: 'ruben@test.dev', nickname: 'Ruben' },
  { email: 'nikite@test.dev', nickname: 'Nikite' },
];

// one pending spot suggestion whose name contains an apostrophe (regression input)
export const spotSuggestionRows = [
  {
    id: 's1',
    suggested_name: "Surfer's Paradise",
    location: 'Knokke, Belgium',
    lat: 51.36, lon: 3.32,
    note: 'Dirs: SW, W | Business: Test | Website: https://x.be',
    submitted_by: 'someone@test.dev',
    reviewed: false, approved: false,
    created_at: '2026-06-01T10:00:00Z',
  },
];

export const emptyArray: unknown[] = [];
