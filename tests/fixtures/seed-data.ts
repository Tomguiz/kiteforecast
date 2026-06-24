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

// public_profiles rows for nickname + premium display.
// Ruben is premium (gets a crown); Nikite is not.
export const publicProfileRows = [
  { email: 'ruben@test.dev', nickname: 'Ruben', is_premium: true },
  { email: 'nikite@test.dev', nickname: 'Nikite', is_premium: false },
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

// Canned roster for the admin Users section (admin_list_users RPC).
export const adminUserRows = [
  { email: 'newbie@example.com', created_at: '2026-06-22T10:00:00Z', last_seen_at: null,                 nickname: null },
  { email: 'alice@example.com',  created_at: '2026-06-20T09:00:00Z', last_seen_at: '2026-06-23T08:00:00Z', nickname: 'Alice' },
  { email: 'admin@test.dev',     created_at: '2026-01-01T00:00:00Z', last_seen_at: '2026-06-24T07:00:00Z', nickname: 'Boss' },
];

// Per-user favourites / followed spots for the admin Users expand view.
export const adminFavourites: Record<string, Array<{spot_name:string; spot_label:string|null}>> = {
  'alice@example.com': [
    { spot_name: 'Knokke',   spot_label: null },
    { spot_name: 'Oostende', spot_label: 'Oostende beach' },
  ],
  'newbie@example.com': [],
};
export const adminReminders: Record<string, Array<{spot_name:string}>> = {
  'alice@example.com': [
    { spot_name: 'Knokke' }, { spot_name: 'Knokke' }, // 3 rows, Knokke dup → de-dups to 2 distinct
    { spot_name: 'De Panne' },
  ],
  'newbie@example.com': [],
};
