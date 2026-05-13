export const TEST_EMAIL = 'e2e@test.local'
export const TEST_PASSWORD = 'e2epassword123'

// Separate user for auth-flow tests (sign in / sign out) so that signing out
// during those tests does not invalidate the session saved in e2e/.auth/user.json
export const AUTH_TEST_EMAIL = 'e2e-auth@test.local'
export const AUTH_TEST_PASSWORD = 'e2epassword123'
